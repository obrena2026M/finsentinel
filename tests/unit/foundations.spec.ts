import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { documentBlock, estimateTokens, evidenceBlocks } from '../../src/agents/context-builder.ts';
import { caseFixtureKey, documentFixtureKey, slug } from '../../src/agents/fixture-keys.ts';
import { dedupeContradictions } from '../../src/agents/merge.ts';
import { loadEnv } from '../../src/config/env.ts';
import { costUsd, loadLlmConfig } from '../../src/config/llm-config.ts';
import { openDatabase, runMigrations, transaction } from '../../src/db/connection.ts';
import { seedReference } from '../../src/db/seed.ts';
import { seedDemoCases } from '../../src/db/seed-demo.ts';
import { AuthorizationError, allowedRoles, isAllowed } from '../../src/domain/rbac.ts';
import { eventForDecision } from '../../src/domain/workflow.ts';
import { addUsage, LlmError, ZERO_USAGE } from '../../src/llm/gateway.ts';
import { MockGateway } from '../../src/llm/mock-gateway.ts';
import { activePromptVersions, loadPrompt } from '../../src/llm/prompts.ts';
import { createTestContext } from '../helpers/app.ts';

test.describe('config', () => {
  test('loadEnv rejects invalid values and anthropic without a key', () => {
    expect(() => loadEnv({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadEnv({ SESSION_SECRET: 'x'.repeat(40), LLM_GATEWAY: 'anthropic' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    const ok = loadEnv({
      SESSION_SECRET: 'x'.repeat(40),
      LLM_GATEWAY: 'anthropic',
      ANTHROPIC_API_KEY: 'k',
      PORT: '4000',
    });
    expect(ok.PORT).toBe(4000);
  });

  // DEP-05 / DEP-07: deployment flags are strict booleans and production refuses demo seeding.
  test('loadEnv parses deployment flags strictly and guards production seeding', () => {
    const base = { SESSION_SECRET: 'x'.repeat(40) };
    expect(loadEnv({ ...base, SEED_ON_START: '0' }).SEED_ON_START).toBe(false);
    expect(loadEnv({ ...base, SEED_ON_START: 'false' }).SEED_ON_START).toBe(false);
    expect(loadEnv({ ...base, SEED_ON_START: '1', TRUST_PROXY: 'true', COOKIE_SECURE: 'yes' })).toMatchObject(
      {
        SEED_ON_START: true,
        TRUST_PROXY: true,
        COOKIE_SECURE: true,
      },
    );
    expect(() => loadEnv({ ...base, COOKIE_SECURE: 'maybe' })).toThrow(/COOKIE_SECURE/);
    const d = loadEnv(base);
    expect(d.HOST).toBe('127.0.0.1');
    expect(d.TRUST_PROXY).toBe(false);
    expect(d.COOKIE_SECURE).toBe(false);
    expect(d.corsOrigins).toBe(true);
    expect(loadEnv({ ...base, CORS_ORIGIN: 'https://a.example, https://b.example' }).corsOrigins).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', SEED_ON_START: '1' })).toThrow(/ALLOW_SEED/);
    expect(
      loadEnv({ ...base, NODE_ENV: 'production', SEED_ON_START: '1', ALLOW_SEED: '1' }).SEED_ON_START,
    ).toBe(true);
    expect(loadEnv({ ...base, NODE_ENV: 'production', SEED_ON_START: '0' }).SEED_ON_START).toBe(false);
    expect(loadEnv({ ...base, BUILD_SHA: 'e068543' }).BUILD_SHA).toBe('e068543');
    expect(loadEnv(base).BUILD_SHA).toBeUndefined();
  });

  test('llm config loads and prices unknown models at zero', () => {
    const cfg = loadLlmConfig();
    expect(cfg.agents.assessment.model).toBe('claude-opus-5');
    expect(
      costUsd(cfg, 'claude-haiku-4-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }),
    ).toBe(1);
    expect(costUsd(cfg, 'unknown-model', { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 })).toBe(0);
  });
});

test.describe('database connection', () => {
  test('file database opens in WAL mode, migrations are idempotent, transactions roll back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'finsentinel-db-'));
    const path = join(dir, 'x.db');
    const db = openDatabase(path);
    expect(existsSync(path)).toBe(true);
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    const first = runMigrations(db);
    expect(first.length).toBeGreaterThan(0);
    expect(runMigrations(db)).toEqual([]);
    expect(() =>
      transaction(db, () => {
        db.prepare(
          "INSERT INTO users (id, username, display_name, role, role_description, created_at) VALUES ('u','u','U','analyst','d','t')",
        ).run();
        // nested join
        transaction(db, () => {
          throw new Error('boom');
        });
      }),
    ).toThrow('boom');
    expect((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n).toBe(0);
    db.close();
  });

  test('seedReference is idempotent and seedDemoCases creates two cases once', async () => {
    const ctx = createTestContext();
    const again = seedReference(ctx.db);
    expect(again.users).toBe(0);
    const r = await seedDemoCases(ctx);
    expect(r.created).toEqual(['RA-1001', 'RA-1002']);
    expect((await seedDemoCases(ctx)).created).toEqual([]);
  });
});

test.describe('domain helpers', () => {
  test('rbac helpers', () => {
    expect(allowedRoles('decision.record')).toEqual(['committee']);
    const e = new AuthorizationError('analyst', 'decision.record');
    expect(e.message).toMatch(/not permitted/);
    expect(isAllowed('admin', 'case.create')).toBe(false);
  });
  test('workflow eventForDecision maps every type', () => {
    expect(eventForDecision('APPROVE')).toBe('approve');
    expect(eventForDecision('APPROVE_WITH_CONDITIONS')).toBe('approve_with_conditions');
    expect(eventForDecision('REJECT')).toBe('reject');
    expect(eventForDecision('DEFER')).toBe('defer');
  });
  test('fixture keys are content derived', () => {
    expect(slug('Product Proposal: International Instant Payments for SMB Customers')).toBe(
      'product-proposal-international-instant-payments',
    );
    expect(caseFixtureKey('Savings Goal feature in mobile app')).toBe('savings-goal-feature');
    expect(documentFixtureKey('other', [{ heading: null, text: 'first line here\nsecond' }])).toBe(
      'other__first-line-here',
    );
    expect(documentFixtureKey('other', [])).toBe('other__');
  });
  test('dedupeContradictions keeps first per field', () => {
    const a = [{ field: 'geographies', candidates: [], detected_by: 'rule', explanation: 'a' }] as never;
    const b = [
      { field: 'geographies', candidates: [], detected_by: 'llm', explanation: 'b' },
      { field: 'channel', candidates: [], detected_by: 'llm', explanation: 'c' },
    ] as never;
    const out = dedupeContradictions(a, b);
    expect(out).toHaveLength(2);
    expect(out[0]!.detected_by).toBe('rule');
  });
});

test.describe('llm plumbing', () => {
  test('usage arithmetic and LlmError defaults', () => {
    expect(addUsage(ZERO_USAGE, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })).toEqual({
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
    });
    const e = new LlmError('timeout', 'slow');
    expect(e.model).toBe('unknown');
    expect(e.attempts).toBe(1);
  });
  test('prompts load by version and expose active versions', () => {
    const p = loadPrompt('assessment', 'v1');
    expect(p.sha256).toHaveLength(64);
    expect(loadPrompt('assessment')).toBe(p); // cached
    expect(activePromptVersions().extraction).toBe('v1');
    expect(() => loadPrompt('nope' as never)).toThrow();
  });
  test('mock gateway: missing fixture → empty error; responders override files; injection lowers scores', async () => {
    const gw = new MockGateway({ latencyMs: 0 });
    const base = {
      model: 'm',
      effort: 'low' as const,
      maxTokens: 10,
      system: [],
      user: '',
      schemaName: 'S',
      caseId: null,
      promptVersion: 'v1',
      promptSha256: 'x',
    };
    await expect(gw.complete({ ...base, agent: 'grounding', schema: z.object({}) })).rejects.toMatchObject({
      outcome: 'empty',
    });
    const gw2 = new MockGateway({
      latencyMs: 0,
      responders: {
        scoping: () => ({
          dimensions: [{ dimension: 'geography', triggered_by_fields: ['geographies'], rationale: 'r' }],
        }),
      },
    });
    const r = await gw2.complete({
      ...base,
      agent: 'scoping',
      schema: z.object({ dimensions: z.array(z.object({ dimension: z.string() })) }),
    });
    expect(r.data.dimensions[0]!.dimension).toBe('geography');
    // schema mismatch from a responder surfaces as schema_invalid
    const gw3 = new MockGateway({ latencyMs: 0, responders: { scoping: () => ({ wrong: true }) } });
    await expect(
      gw3.complete({ ...base, agent: 'scoping', schema: z.object({ dimensions: z.array(z.string()) }) }),
    ).rejects.toMatchObject({ outcome: 'schema_invalid' });
    gw3.setBehaviour('scoping', 'timeout');
    await expect(gw3.complete({ ...base, agent: 'scoping', schema: z.object({}) })).rejects.toMatchObject({
      outcome: 'timeout',
    });
  });
});

test.describe('context builder', () => {
  test('documentBlock truncates by token budget and evidenceBlocks drops lowest relevance first', () => {
    const chunks = Array.from({ length: 20 }, (_, i) => ({
      chunk_ix: i,
      heading: `H${i}`,
      text: 'x'.repeat(400),
    }));
    const block = documentBlock({ id: 'd', kind: 'other', name: 'n"<', chunks }, 600);
    expect(block).toContain('<truncated remaining_chunks=');
    expect(block).toContain('&quot;');
    const ev = [
      { evidenceId: 'E1', source: 'AML §1', version: 'v1', body: 'a'.repeat(800), score: 5 },
      { evidenceId: 'E2', source: 'AML §2', version: 'v1', body: 'b'.repeat(800), score: 1 },
    ];
    const { included } = evidenceBlocks(ev, estimateTokens('a'.repeat(800)) + 40);
    expect(included).toEqual(['E1']);
  });
});
