import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.ts';
import { nowIso } from '../db/connection.ts';
import type { LlmOutcome, Usage } from './gateway.ts';

// llm_calls is the source of truth for FR-TOK-01 / FR-OBS-02.

export type LlmCallRecord = {
  stepId: string | null;
  caseId: string | null;
  agent: string;
  model: string;
  promptVersion: string;
  promptSha256: string;
  effort: string;
  usage: Usage;
  latencyMs: number;
  stopReason: string | null;
  outcome: LlmOutcome;
};

export function recordLlmCall(db: Db, r: LlmCallRecord): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO llm_calls (id, step_id, case_id, agent, model, prompt_version, prompt_sha256, effort,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms, stop_reason, outcome, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    r.stepId,
    r.caseId,
    r.agent,
    r.model,
    r.promptVersion,
    r.promptSha256,
    r.effort,
    r.usage.input,
    r.usage.output,
    r.usage.cacheRead,
    r.usage.cacheWrite,
    r.latencyMs,
    r.stopReason,
    r.outcome,
    nowIso(),
  );
  return id;
}

export type CaseTokenTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
  byModel: Record<string, Usage>;
};

export function caseTokenTotals(db: Db, caseId: string): CaseTokenTotals {
  const rows = db
    .prepare(
      `SELECT model, SUM(input_tokens) i, SUM(output_tokens) o, SUM(cache_read_tokens) cr, SUM(cache_write_tokens) cw, COUNT(*) n
       FROM llm_calls WHERE case_id = ? GROUP BY model`,
    )
    .all(caseId) as Array<{ model: string; i: number; o: number; cr: number; cw: number; n: number }>;
  const totals: CaseTokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, byModel: {} };
  for (const r of rows) {
    totals.input += r.i;
    totals.output += r.o;
    totals.cacheRead += r.cr;
    totals.cacheWrite += r.cw;
    totals.calls += r.n;
    totals.byModel[r.model] = { input: r.i, output: r.o, cacheRead: r.cr, cacheWrite: r.cw };
  }
  return totals;
}
