import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { ErrorText, Json, Loading, Section } from '../components/common.tsx';
import { StatTile, statusChip, type TileStatus } from '../components/StatTile.tsx';
import { fmtDateTime, fmtInt, fmtPct } from '../format.ts';
import { can } from '../rbac.ts';
import type { AdversarialResult, Quality, SuiteCounts } from '../types.ts';

// FinSentinel Quality Center (UX §4.11). Every number comes from /api/quality; null → "No run yet".

const AI_LABELS: Record<string, string> = {
  extractionAccuracy: 'Fact extraction accuracy',
  retrievalPrecision: 'Retrieval precision',
  groundingSupportedRate: 'Evidence grounding',
  unsupportedClaimRate: 'Unsupported claims',
  bandAgreement: 'Band agreement',
  adversarialPassRate: 'Adversarial pass rate',
};

const SOFTWARE_LABELS: Record<string, string> = {
  unit: 'Unit',
  integration: 'Integration',
  security: 'Security',
  adversarial: 'Adversarial',
  e2e: 'E2E',
};

function suiteStatus(s: SuiteCounts | null | undefined): TileStatus {
  if (!s) return 'NO_RUN';
  return s.failed === 0 && s.total > 0 ? 'PASS' : 'FAIL';
}

function aggregate(e2e: Record<string, SuiteCounts> | null): SuiteCounts | null {
  if (!e2e) return null;
  return Object.values(e2e).reduce<SuiteCounts | null>(
    (a, s) =>
      a
        ? {
            passed: a.passed + s.passed,
            failed: a.failed + s.failed,
            skipped: a.skipped + s.skipped,
            total: a.total + s.total,
          }
        : s,
    null,
  );
}

export function QualityPage() {
  const { me } = useAuth();
  const [q, setQ] = useState<Quality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AdversarialResult | { error: string }>>({});
  const [showGates, setShowGates] = useState(false);

  const load = useCallback(
    () =>
      api
        .quality()
        .then(setQ)
        .catch((e) => setError(errorMessage(e))),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (testId: string) => {
    setRunning(testId);
    try {
      const r = await api.runAdversarial(testId);
      setResults((x) => ({ ...x, [testId]: r }));
      await load();
    } catch (e) {
      setResults((x) => ({ ...x, [testId]: { error: errorMessage(e) } }));
    } finally {
      setRunning(null);
    }
  };

  if (error) return <ErrorText error={error} />;
  if (!q) return <Loading what="Loading Quality Center" />;

  const software = { ...(q.software.projects ?? {}) };
  const e2eAgg = software.e2e ?? aggregate(q.software.e2e);
  const evaluated = q.gates.filter((g) => g.pass !== null);
  const passed = evaluated.filter((g) => g.pass).length;
  const tokens = (q.tokens ?? null) as Record<string, unknown> | null;
  const lastAdversarial = (testId: string) =>
    q.recent_runs.find(
      (r) =>
        r.source === 'adversarial_live' &&
        (r.summary as { test?: { id?: string } } | null)?.test?.id === testId,
    );

  return (
    <div>
      <div className="row row-between" style={{ marginBottom: 14 }}>
        <div>
          <h1>FinSentinel Quality Center</h1>
          <div className="muted small">
            generated {fmtDateTime(q.generated_at)}
            {q.eval_file ? ` · eval ${q.eval_file}` : ' · no evaluation run yet'}
          </div>
        </div>
        <div className="row">
          <span className="muted">RELEASE STATUS</span>
          <span data-testid="release-status" data-status={q.status}>
            {statusChip(q.status)}
          </span>
          <span className="muted small">
            ({passed}/{evaluated.length} gates evaluated
            {q.gates.length - evaluated.length > 0 ? `, ${q.gates.length - evaluated.length} not run` : ''})
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowGates((s) => !s)}
            aria-expanded={showGates}
          >
            {showGates ? 'Hide gate details' : 'Gate details'}
          </button>
        </div>
      </div>

      {showGates && (
        <Section title="Quality gates" testId="gate-details">
          <table className="table">
            <thead>
              <tr>
                <th>Gate</th>
                <th>Group</th>
                <th>Description</th>
                <th>Actual</th>
                <th>Threshold</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {q.gates.map((g) => (
                <tr key={g.id}>
                  <td className="mono small">{g.id}</td>
                  <td className="muted">{g.group}</td>
                  <td>{g.description}</td>
                  <td className="mono small">
                    {g.actual === null || g.actual === undefined
                      ? '—'
                      : typeof g.actual === 'object'
                        ? JSON.stringify(g.actual)
                        : String(g.actual)}
                  </td>
                  <td className="mono small">
                    {typeof g.threshold === 'object' ? JSON.stringify(g.threshold) : String(g.threshold)}
                  </td>
                  <td>{statusChip(g.pass === null ? 'NO_RUN' : g.pass ? 'PASS' : 'FAIL', true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Section title="Software">
          <div className="grid-tiles">
            {(['unit', 'integration', 'security', 'adversarial', 'e2e'] as const).map((name) => {
              const s = name === 'e2e' ? e2eAgg : software[name];
              return (
                <StatTile
                  key={name}
                  label={SOFTWARE_LABELS[name] ?? name}
                  value={s ? `${s.passed}/${s.total}` : null}
                  sub={s?.skipped ? `${s.skipped} skipped` : undefined}
                  status={suiteStatus(s)}
                  testId={`software-${name}`}
                />
              );
            })}
          </div>
        </Section>
        <Section title="AI quality (golden set)">
          <div className="grid-tiles">
            {Object.keys(AI_LABELS).map((k) => {
              const v = q.ai?.[k];
              const gate = q.gates.find((g) => g.id === `QG-ai-${k}`);
              return (
                <StatTile
                  key={k}
                  label={AI_LABELS[k] ?? k}
                  value={v === undefined || v === null ? null : fmtPct(v)}
                  status={gate ? (gate.pass === null ? 'NO_RUN' : gate.pass ? 'PASS' : 'FAIL') : null}
                  testId={`ai-${k}`}
                />
              );
            })}
            {q.ai &&
              Object.entries(q.ai)
                .filter(([k]) => !(k in AI_LABELS))
                .map(([k, v]) => (
                  <StatTile
                    key={k}
                    label={k}
                    value={typeof v === 'number' ? (v <= 1 ? fmtPct(v) : fmtInt(v)) : String(v)}
                  />
                ))}
          </div>
        </Section>
      </div>

      <Section title="Adversarial (live)" testId="adversarial-tests">
        <div className="stack">
          {q.adversarial_tests.map((t) => {
            const r = results[t.id];
            const last = lastAdversarial(t.id);
            return (
              <div
                key={t.id}
                className="card"
                style={{ boxShadow: 'none' }}
                data-testid={`adversarial-${t.id}`}
              >
                <div className="row row-between">
                  <div>
                    <strong>{t.label}</strong>
                    <div className="small muted">{t.description}</div>
                  </div>
                  <div className="row">
                    {r && 'pass' in r
                      ? statusChip(r.pass ? 'PASS' : 'FAIL', true)
                      : last
                        ? statusChip(last.status, true)
                        : statusChip('NO_RUN', true)}
                    {last && !r && <span className="small muted">last {fmtDateTime(last.started_at)}</span>}
                    {can(me?.role, 'quality.run_adversarial') && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={running !== null}
                        onClick={() => run(t.id)}
                        data-testid={`run-${t.id}`}
                      >
                        {running === t.id ? <span className="spinner" aria-hidden="true" /> : null} Run now
                      </button>
                    )}
                    {!can(me?.role, 'quality.run_adversarial') && (
                      <span className="btn-reason">Run available to analysts and admins</span>
                    )}
                    {running !== null && running !== t.id && can(me?.role, 'quality.run_adversarial') && (
                      <span className="btn-reason">Another test is running</span>
                    )}
                  </div>
                </div>
                {r && 'error' in r && <ErrorText error={r.error} />}
                {r && 'checks' in r && (
                  <div style={{ marginTop: 10 }}>
                    <div className="small muted">
                      Sandbox case{' '}
                      <Link to={`/cases/${r.case_id}#overview`} className="mono">
                        {r.case_ref}
                      </Link>{' '}
                      · state {r.state} · pipeline {r.pipeline.status}
                      {r.pipeline.failedStep ? ` at ${r.pipeline.failedStep}` : ''} · {fmtInt(r.duration_ms)}{' '}
                      ms
                    </div>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {r.checks.map((c) => (
                        <li key={c.name}>
                          <span
                            style={{ color: c.pass ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}
                          >
                            {c.pass ? '✓ PASS' : '✗ FAIL'}
                          </span>{' '}
                          {c.name} <span className="muted small">— {c.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Tokens (golden-set run)">
        {!tokens ? (
          <div className="muted">No run yet</div>
        ) : (
          <div className="grid-tiles">
            {Object.entries(tokens).map(([k, v]) => (
              <StatTile
                key={k}
                label={k.replace(/_/g, ' ')}
                value={
                  typeof v === 'number'
                    ? k.toLowerCase().includes('rate') ||
                      k.toLowerCase().includes('hit') ||
                      k.toLowerCase().includes('saving')
                      ? fmtPct(v)
                      : fmtInt(v)
                    : typeof v === 'object'
                      ? JSON.stringify(v)
                      : String(v)
                }
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent quality runs">
        {q.recent_runs.length === 0 ? (
          <div className="muted">No run yet</div>
        ) : (
          <RecentRuns runs={q.recent_runs} />
        )}
      </Section>
    </div>
  );
}

function RecentRuns({ runs }: { runs: Quality['recent_runs'] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Started</th>
          <th>Source</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td className="small">{fmtDateTime(r.started_at)}</td>
            <td>{r.source}</td>
            <td>{statusChip(r.status, true)}</td>
            <td>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setOpen(open === r.id ? null : r.id)}
              >
                {open === r.id ? 'Hide' : 'Summary'}
              </button>
              {open === r.id && <Json value={r.summary} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
