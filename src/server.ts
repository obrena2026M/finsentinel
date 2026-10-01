import pino from 'pino';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { loadLlmConfig } from './config/llm-config.ts';
import { openDatabase, runMigrations } from './db/connection.ts';
import { seedReference } from './db/seed.ts';
import { seedDemoCases } from './db/seed-demo.ts';
import { AnthropicGateway } from './llm/anthropic-gateway.ts';
import type { LlmGateway } from './llm/gateway.ts';
import { MockGateway } from './llm/mock-gateway.ts';
import type { AppContext } from './services/context.ts';

// node --env-file=.env src/server.ts

export async function createContext(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<AppContext> {
  const env = loadEnv({ ...process.env, ...overrides });
  const log = pino({
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'ANTHROPIC_API_KEY'],
    ...(env.NODE_ENV !== 'production' && process.stdout.isTTY
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
      : {}),
  });
  const db = openDatabase(env.DB_PATH);
  const ran = runMigrations(db);
  if (ran.length) log.info({ migrations: ran }, 'migrations applied');
  const seeded = seedReference(db);
  log.info(seeded, 'reference data ready');
  const llm = loadLlmConfig();
  const gateway: LlmGateway =
    env.LLM_GATEWAY === 'anthropic'
      ? new AnthropicGateway({
          apiKey: env.ANTHROPIC_API_KEY,
          maxRetries: llm.retry.httpMaxRetries,
          timeoutMs: llm.retry.timeoutMs,
          schemaInvalidRetries: llm.retry.schemaInvalidRetries,
        })
      : new MockGateway({ latencyMs: env.MOCK_LATENCY_MS });
  return { db, env, llm, gateway, log };
}

async function main() {
  const ctx = await createContext();
  if (ctx.env.SEED_ON_START) {
    const r = await seedDemoCases(ctx);
    ctx.log.info(r, 'demo cases ready');
  }
  const app = await buildApp(ctx);
  await app.listen({ port: ctx.env.PORT, host: ctx.env.HOST });
  ctx.log.info(
    {
      host: ctx.env.HOST,
      port: ctx.env.PORT,
      gateway: ctx.gateway.kind,
      auth: ctx.env.AUTH_MODE,
      env: ctx.env.NODE_ENV ?? 'development',
    },
    'FinSentinel listening',
  );

  const shutdown = async () => {
    ctx.log.info('shutting down');
    await app.close();
    ctx.db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain = process.argv[1] && /server\.ts$/.test(process.argv[1]);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
