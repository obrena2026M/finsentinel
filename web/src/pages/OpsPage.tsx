import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { ErrorText, Loading, Section } from '../components/common.tsx';
import { LivePipelineActivity } from '../components/LivePipelineActivity.tsx';
import { StateChip } from '../components/StateChip.tsx';
import { StatTile } from '../components/StatTile.tsx';
import { fmtDateTime, fmtInt, fmtMs, fmtPct, fmtTokens, fmtUsd } from '../format.ts';
import type { Metrics } from '../types.ts';

// Operations dashboard (UX §4.12) from GET /api/metrics, plus /health probes.

export function OpsPage() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    live: boolean | null;
    ready: boolean | null;
    checks: Record<string, unknown> | null;
  }>({ live: null, ready: null, checks: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api.metrics();
        if (alive) setM(r);
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
      try {
        const live = await fetch('/health/live', { credentials: 'include' });
        const ready = await fetch('/health/ready', { credentials: 'include' });
        const body = (await ready.json().catch(() => null)) as { checks?: Record<string, unknown> } | null;
        if (alive) setHealth({ live: live.ok, ready: ready.ok, checks: body?.checks ?? null });
      } catch {
        if (alive) setHealth({ live: false, ready: false, checks: null });
      }
    };
    void load();
    const t = window.setInterval(load, 10000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  if (error && !m) {
    return (
      <div>
        <h1>Operations</h1>
        <LivePipelineActivity />
        <ErrorText error={error} />
      </div>
    );
  }
  if (!m) {
    return (
      <div>
        <h1>Operations</h1>
        <LivePipelineActivity />
        <Loading what="Loading metrics" />
      </div>
    );
  }

  const t = m.ai.tokens_24h;
  return (
    <div>
      <div className="row row-between" style={{ marginBottom: 14 }}>
        <h1>Operations</h1>
        <span className="muted small">generated {fmtDateTime(m.generated_at)} · refreshes every 10 s</span>
      </div>

      <LivePipelineActivity />

      <Section title="System">
        <div className="grid-tiles">
          <StatTile label="API p50 latency (24 h)" value={fmtMs(m.system.p50_ms)} />
          <StatTile label="API p95 latency (24 h)" value={fmtMs(m.system.p95_ms)} />
          <StatTile label="Requests (24 h)" value={fmtInt(m.system.requests_24h)} />
          <StatTile
            label="Error rate (5xx)"
            value={fmtPct(m.system.error_rate)}
            sub={`${fmtInt(m.system.errors_5xx_24h)} errors`}
            status={m.system.error_rate !== null && m.system.error_rate > 0.01 ? 'WARN' : 'OK'}
          />
          <StatTile
            label="Pipeline step failures (24 h)"
            value={fmtInt(m.system.pipeline_step_failures_24h)}
            status={m.system.pipeline_step_failures_24h > 0 ? 'WARN' : 'OK'}
          />
          <StatTile
            label="Database"
            value={m.system.db_ok ? 'OK' : 'DOWN'}
            status={m.system.db_ok ? 'OK' : 'FAIL'}
          />
          <StatTile
            label="LLM gateway"
            value={m.system.llm_gateway}
            sub={m.system.llm_gateway === 'mock' ? 'Mock gateway (no external calls)' : 'Anthropic API'}
            status="OK"
          />
          <StatTile
            label="Health endpoints"
            value={`${health.live === null ? '…' : health.live ? 'live ✓' : 'live ✗'} · ${health.ready === null ? '…' : health.ready ? 'ready ✓' : 'ready ✗'}`}
            status={health.live && health.ready ? 'OK' : health.live === null ? null : 'FAIL'}
          >
            {health.checks && (
              <div className="small muted">
                {Object.entries(health.checks)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(' · ')}
              </div>
            )}
          </StatTile>
        </div>
      </Section>

      <Section title="AI">
        <div className="grid-tiles">
          <StatTile
            label="Tokens today (24 h)"
            value={fmtTokens(t.input + t.output)}
            sub={`${fmtTokens(t.input)} in · ${fmtTokens(t.output)} out · ${fmtTokens(t.cacheRead)} cache read · ${fmtTokens(t.cacheWrite)} cache write`}
          />
          <StatTile label="Cost today (24 h)" value={fmtUsd(m.ai.cost_usd_24h)} />
          <StatTile label="Cache hit rate" value={fmtPct(m.ai.cache_hit_rate)} />
          <StatTile
            label="LLM calls (24 h)"
            value={fmtInt(m.ai.llm_calls_24h)}
            sub={`${fmtInt(m.ai.llm_failures_24h)} failed`}
            status={m.ai.llm_failures_24h > 0 ? 'WARN' : 'OK'}
          />
          <StatTile label="Avg model latency" value={fmtMs(m.ai.avg_model_latency_ms)} />
          <StatTile
            label="Unsupported claims open"
            value={fmtInt(m.ai.unsupported_claims_open)}
            status={m.ai.unsupported_claims_open > 0 ? 'WARN' : 'OK'}
          />
          <StatTile label="Overrides (7 d)" value={fmtInt(m.ai.overrides_7d)} />
          <StatTile
            label="AI / analyst disagreement"
            value={fmtPct(m.ai.ai_analyst_disagreement_rate)}
            sub="dimensions where current ≠ AI recommendation"
          />
        </div>
      </Section>

      <Section title="Business">
        <div className="grid-tiles">
          <StatTile label="Cases total" value={fmtInt(m.business.cases_total)} />
          <StatTile label="Cases decided" value={fmtInt(m.business.cases_decided)} />
          <StatTile
            label="Mean time to decision"
            value={
              m.business.mean_minutes_to_decision === null
                ? '—'
                : `${fmtInt(m.business.mean_minutes_to_decision)} min`
            }
          />
          <StatTile label="Awaiting info" value={fmtInt(m.business.awaiting_info)} />
          <StatTile label="Awaiting analyst" value={fmtInt(m.business.awaiting_analyst)} />
          <StatTile label="Awaiting committee" value={fmtInt(m.business.awaiting_committee)} />
        </div>
        <h3 style={{ marginTop: 16 }}>Cases by state</h3>
        <div className="row">
          {Object.entries(m.business.cases_by_state).length === 0 && (
            <span className="muted">No cases yet</span>
          )}
          {Object.entries(m.business.cases_by_state).map(([s, n]) => (
            <span key={s} className="row" style={{ gap: 6 }}>
              <StateChip state={s} /> <strong>{fmtInt(n)}</strong>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
