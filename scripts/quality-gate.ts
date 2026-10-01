import pino from 'pino';
import { loadEnv } from '../src/config/env.ts';
import { loadLlmConfig } from '../src/config/llm-config.ts';
import { openDatabase, runMigrations } from '../src/db/connection.ts';
import { seedReference } from '../src/db/seed.ts';
import { MockGateway } from '../src/llm/mock-gateway.ts';
import { evaluateGates } from '../src/services/quality.ts';

// Release gate — QG-01..14, Architecture §15. Reads Playwright JSON + latest eval; exits non-zero on FAIL.
// Uses the configured DB_PATH so governance gates see real data (falls back to in-memory).

const env = loadEnv({
  ...process.env,
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'gate-secret-gate-secret-gate-secret-0123456789',
  LLM_GATEWAY: 'mock',
});
const db = openDatabase(process.env.DB_PATH ?? ':memory:');
runMigrations(db);
seedReference(db);
const ctx = { db, env, llm: loadLlmConfig(), gateway: new MockGateway(), log: pino({ level: 'silent' }) };
const r = evaluateGates(ctx);
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\nFINSENTINEL QUALITY GATE — ${r.status}\n`);
for (const g of r.gates) {
  const mark = g.pass === null ? '·' : g.pass ? '✓' : '✗';
  console.log(
    `${mark} ${pad(g.group, 10)} ${pad(g.id, 34)} ${g.pass === null ? 'NO RUN' : g.pass ? 'PASS' : 'FAIL'}  actual=${JSON.stringify(g.actual)} threshold=${JSON.stringify(g.threshold)}`,
  );
}
console.log(`\neval file: ${r.eval_file ?? 'none'}`);
process.exit(r.status === 'FAIL' ? 1 : 0);
