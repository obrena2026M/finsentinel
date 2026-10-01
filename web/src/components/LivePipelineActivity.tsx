import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { ErrorText, Section } from '../components/common.tsx';
import type { CaseListRow } from '../types.ts';
import { ProgressBar } from './PipelineProgress.tsx';

// Ops (UX §4.12): live view of pipelines currently running. Polls GET /api/cases every 2 s.

const POLL_MS = 2000;

export function LivePipelineActivity() {
  const [rows, setRows] = useState<CaseListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .listCases()
        .then((r) => {
          if (!alive) return;
          setRows(r);
          setError(null);
        })
        .catch((e) => alive && setError(errorMessage(e)));
    void load();
    const t = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const running = (rows ?? []).filter((r) => r.pipeline?.status === 'running');

  return (
    <Section
      title="Live pipeline activity"
      testId="live-pipeline-activity"
      right={
        <span className="row small muted">
          {running.length > 0 && (
            <span className="chip chip-ai chip-pulse">
              <span className="pulse-dot" aria-hidden="true" />
              {running.length} running
            </span>
          )}
          <span>refreshes every 2 s</span>
        </span>
      }
    >
      <ErrorText error={error} />
      {rows && running.length === 0 && (
        <div className="muted small" data-testid="no-pipelines-running">
          No pipelines running.
        </div>
      )}
      {running.length > 0 && (
        <ul className="live-list" aria-live="polite">
          {running.map((r) => {
            const done = r.pipeline?.done ?? 0;
            const total = r.pipeline?.total ?? 0;
            return (
              <li key={r.id} className="live-row" data-testid={`live-row-${r.ref}`}>
                <div className="live-row-head">
                  <Link to={`/cases/${r.id}#overview`} className="mono">
                    {r.ref}
                  </Link>
                  <span className="live-row-title">{r.title}</span>
                  <span className="ai-working-label">
                    <span className="pulse-dot" aria-hidden="true" />
                    AI working…
                  </span>
                  <span className="muted small mono">
                    {done}/{total}
                  </span>
                </div>
                <ProgressBar
                  done={done}
                  total={total}
                  animated
                  label={`${r.ref} progress ${done} of ${total}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
