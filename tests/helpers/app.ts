import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { buildApp } from '../../src/app.ts';
import { loadEnv } from '../../src/config/env.ts';
import { loadLlmConfig } from '../../src/config/llm-config.ts';
import { openDatabase, runMigrations } from '../../src/db/connection.ts';
import { seedReference } from '../../src/db/seed.ts';
import { MockGateway, type MockOptions } from '../../src/llm/mock-gateway.ts';
import type { AppContext } from '../../src/services/context.ts';

// Shared test harness: in-memory SQLite, mock gateway, seeded reference data, Fastify app for inject().

export function createTestContext(
  mock: MockOptions = {},
  envOverrides: Record<string, string> = {},
): AppContext & { gateway: MockGateway } {
  const env = loadEnv({
    PORT: '3999',
    DB_PATH: ':memory:',
    SESSION_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    AUTH_MODE: 'simulation',
    LLM_GATEWAY: 'mock',
    LOG_LEVEL: 'silent',
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'finsentinel-uploads-')),
    ...envOverrides,
  });
  const db = openDatabase(':memory:');
  runMigrations(db);
  seedReference(db);
  const gateway = new MockGateway({ latencyMs: 0, ...mock });
  return { db, env, llm: loadLlmConfig(), gateway, log: pino({ level: 'silent' }) };
}

export async function createTestApp(
  mock: MockOptions = {},
  envOverrides: Record<string, string> = {},
): Promise<{ app: FastifyInstance; ctx: AppContext & { gateway: MockGateway } }> {
  const ctx = createTestContext(mock, envOverrides);
  const app = await buildApp(ctx);
  await app.ready();
  return { app, ctx };
}

export type Session = { cookie: string; user: { id: string; username: string; role: string } };

export async function login(app: FastifyInstance, username: string): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username } });
  if (res.statusCode !== 200) throw new Error(`login failed for ${username}: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  return { cookie: raw.split(';')[0]!, user: res.json() };
}

export function multipart(
  fields: Record<string, string>,
  file: { name: string; content: Buffer | string; contentType?: string },
) {
  const boundary = `----finsentinel${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.contentType ?? 'application/octet-stream'}\r\n\r\n`,
    ),
  );
  parts.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export const FIXTURES = new URL('../fixtures/cases/', import.meta.url);

export async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout waiting for condition');
}
