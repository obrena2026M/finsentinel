import { costUsd } from '../config/llm-config.ts';
import { nowIso } from '../db/connection.ts';
import type { AppContext } from './context.ts';

// Observability read model — FR-OBS-01..03, Architecture §14.

export function recordRequest(
  ctx: AppContext,
  route: string,
  method: string,
  status: number,
  latencyMs: number,
): void {
  ctx.db
    .prepare(
      'INSERT INTO request_metrics (route, method, status, latency_ms, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(route, method, status, latencyMs, nowIso());
}

function pct(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? null;
}

export function metricsSnapshot(ctx: AppContext) {
  const db = ctx.db;
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const lat = (
    db
      .prepare('SELECT latency_ms FROM request_metrics WHERE created_at >= ? ORDER BY latency_ms')
      .all(since24h) as Array<{ latency_ms: number }>
  ).map((r) => r.latency_ms);
  const reqTotal = lat.length;
  const reqErrors = (
    db
      .prepare('SELECT COUNT(*) n FROM request_metrics WHERE created_at >= ? AND status >= 500')
      .get(since24h) as { n: number }
  ).n;
  const stepFailures = (
    db
      .prepare("SELECT COUNT(*) n FROM pipeline_steps WHERE status = 'failed' AND finished_at >= ?")
      .get(since24h) as { n: number }
  ).n;

  const llm = db
    .prepare(
      `SELECT model, outcome, COUNT(*) n, SUM(input_tokens) i, SUM(output_tokens) o, SUM(cache_read_tokens) cr, SUM(cache_write_tokens) cw, AVG(latency_ms) lat FROM llm_calls WHERE created_at >= ? GROUP BY model, outcome`,
    )
    .all(since24h) as Array<{
    model: string;
    outcome: string;
    n: number;
    i: number;
    o: number;
    cr: number;
    cw: number;
    lat: number;
  }>;
  const tokens = llm.reduce(
    (a, r) => ({
      input: a.input + r.i,
      output: a.output + r.o,
      cacheRead: a.cacheRead + r.cr,
      cacheWrite: a.cacheWrite + r.cw,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  const cost = llm.reduce(
    (s, r) =>
      s +
      costUsd(ctx.llm, r.model.replace(/^mock:/, ''), {
        input: r.i,
        output: r.o,
        cacheRead: r.cr,
        cacheWrite: r.cw,
      }),
    0,
  );
  const llmFailures = llm.filter((r) => r.outcome !== 'ok').reduce((s, r) => s + r.n, 0);
  const cacheHit =
    tokens.input + tokens.cacheRead > 0 ? tokens.cacheRead / (tokens.input + tokens.cacheRead) : null;

  const unsupported = (
    db.prepare("SELECT COUNT(*) n FROM claims WHERE verdict = 'UNSUPPORTED' AND status = 'active'").get() as {
      n: number;
    }
  ).n;
  const overrides7d = (
    db.prepare('SELECT COUNT(*) n FROM overrides WHERE created_at >= ?').get(since7d) as { n: number }
  ).n;
  const disagreement = db
    .prepare(
      'SELECT COUNT(*) total, SUM(CASE WHEN current_score IS NOT ai_recommended THEN 1 ELSE 0 END) changed FROM dimension_scores WHERE ai_recommended IS NOT NULL',
    )
    .get() as { total: number; changed: number | null };

  const byState = Object.fromEntries(
    (
      db.prepare('SELECT state, COUNT(*) n FROM cases GROUP BY state').all() as Array<{
        state: string;
        n: number;
      }>
    ).map((r) => [r.state, r.n]),
  );
  const decided = db
    .prepare(
      `SELECT AVG((julianday(d.decided_at) - julianday(c.created_at)) * 24 * 60) mins, COUNT(*) n FROM decisions d JOIN cases c ON c.id = d.case_id`,
    )
    .get() as { mins: number | null; n: number };

  return {
    generated_at: nowIso(),
    system: {
      requests_24h: reqTotal,
      p50_ms: pct(lat, 50),
      p95_ms: pct(lat, 95),
      errors_5xx_24h: reqErrors,
      error_rate: reqTotal ? reqErrors / reqTotal : null,
      pipeline_step_failures_24h: stepFailures,
      db_ok: true,
      llm_gateway: ctx.gateway.kind,
    },
    ai: {
      tokens_24h: tokens,
      cost_usd_24h: Math.round(cost * 10_000) / 10_000,
      cache_hit_rate: cacheHit,
      llm_calls_24h: llm.reduce((s, r) => s + r.n, 0),
      llm_failures_24h: llmFailures,
      avg_model_latency_ms: llm.length
        ? Math.round(llm.reduce((s, r) => s + r.lat * r.n, 0) / llm.reduce((s, r) => s + r.n, 0))
        : null,
      unsupported_claims_open: unsupported,
      overrides_7d: overrides7d,
      ai_analyst_disagreement_rate: disagreement.total
        ? (disagreement.changed ?? 0) / disagreement.total
        : null,
    },
    business: {
      cases_by_state: byState,
      cases_total: Object.values(byState).reduce((a, b) => a + b, 0),
      cases_decided: decided.n,
      mean_minutes_to_decision: decided.mins ? Math.round(decided.mins) : null,
      awaiting_info: byState.INFO_REQUESTED ?? 0,
      awaiting_analyst: byState.ANALYST_REVIEW ?? 0,
      awaiting_committee: byState.COMMITTEE_REVIEW ?? 0,
    },
  };
}
