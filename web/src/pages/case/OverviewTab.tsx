import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useAiReview } from '../../components/AiReviewModal.tsx';
import { BlockersRail } from '../../components/BlockersRail.tsx';
import { ErrorText, ReasonButton, Section } from '../../components/common.tsx';
import { InjectionBanner } from '../../components/InjectionBanner.tsx';
import { elapsedSeconds, fmtSeconds, PipelineProgress } from '../../components/PipelineProgress.tsx';
import { PipelineStepper } from '../../components/PipelineStepper.tsx';
import { RationaleDialog } from '../../components/RationaleDialog.tsx';
import { STEP_LABELS } from '../../constants.ts';
import { fmtBytes, fmtDateTime, fmtTime, fmtTokens, fmtUsd } from '../../format.ts';
import { can } from '../../rbac.ts';
import { useCase } from './context.ts';

// Overview (UX §4.4): pipeline stepper, failure card, blockers rail, tokens tile, injection banner, finalize.

export function OverviewTab() {
  const { view, me, caseId, running, mutate } = useCase();
  const aiReview = useAiReview();
  const startRun = () => aiReview.start(caseId, view.case.ref);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const failed = view.pipeline?.steps.find((s) => s.status === 'failed') ?? null;
  const state = view.case.state;
  // Live panel while the server reports running=true or the run row is still 'running'.
  const serverBusy = running || view.pipeline?.status === 'running';
  // Hold the "AI is working" panel for at least MIN_SHOW_MS so a fast run is still visible, and show it
  // immediately when the user clicks Run/Re-run (before the first poll returns).
  const MIN_SHOW_MS = 5000;
  const [showUntil, setShowUntil] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (serverBusy) setShowUntil((prev) => Math.max(prev, Date.now() + MIN_SHOW_MS));
  }, [serverBusy]);
  useEffect(() => {
    if (Date.now() >= showUntil) return;
    const t = setTimeout(() => setTick((n) => n + 1), showUntil - Date.now() + 50);
    return () => clearTimeout(t);
  }, [showUntil]);
  const holding = Date.now() < showUntil;
  const inProgress = !!view.pipeline && (serverBusy || holding);
  const completedIn =
    view.pipeline && !inProgress && view.pipeline.finished_at
      ? elapsedSeconds(view.pipeline.started_at, view.pipeline.finished_at)
      : null;

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    if (name === 'run') setShowUntil(Date.now() + MIN_SHOW_MS);
    try {
      await mutate(fn);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const canRun = can(me.role, 'pipeline.run');
  const runReason = running
    ? 'Pipeline is already running'
    : ['COMMITTEE_REVIEW', 'DECIDED', 'CLOSED'].includes(state)
      ? `Cannot run in state ${state}`
      : null;

  const finalizeReason =
    state !== 'ANALYST_REVIEW'
      ? `Case must be in Analyst review (currently ${state})`
      : view.blockers.length > 0
        ? `Clear ${view.blockers.length} blocker${view.blockers.length === 1 ? '' : 's'} to finalize: ${view.blockers.join('; ')}`
        : null;

  return (
    <div>
      <InjectionBanner text={view.injection_banner} flags={view.flags} />
      <ErrorText error={error} />
      <div className="grid-2" style={{ gridTemplateColumns: '3fr 2fr' }}>
        <div>
          <Section
            title="Pipeline"
            testId="pipeline-card"
            right={
              <span className="row small muted">
                {view.pipeline ? (
                  <>
                    {view.pipeline.gateway} · {view.pipeline.status} · started{' '}
                    {fmtTime(view.pipeline.started_at)}
                    {view.pipeline.finished_at ? ` · finished ${fmtTime(view.pipeline.finished_at)}` : ''}
                  </>
                ) : null}
                {canRun && !view.pipeline && (
                  <ReasonButton
                    reason={runReason}
                    onClick={() => act('run', startRun)}
                    busy={busy === 'run'}
                    testId="run-pipeline-btn"
                    className="btn btn-primary btn-sm"
                  >
                    ▶ Run pipeline
                  </ReasonButton>
                )}
                {canRun &&
                  view.pipeline &&
                  view.pipeline.status !== 'running' &&
                  !failed &&
                  state !== 'COMMITTEE_REVIEW' &&
                  state !== 'DECIDED' &&
                  state !== 'CLOSED' && (
                    <ReasonButton
                      reason={runReason}
                      onClick={() => act('run', startRun)}
                      busy={busy === 'run'}
                      testId="rerun-pipeline-btn"
                      className="btn btn-sm"
                    >
                      ↻ Re-run
                    </ReasonButton>
                  )}
              </span>
            }
          >
            {inProgress && view.pipeline ? (
              <PipelineProgress run={view.pipeline} tokens={view.tokens} finishing={!serverBusy && holding} />
            ) : (
              <PipelineStepper run={view.pipeline} />
            )}
            {completedIn !== null && view.pipeline && (
              <div className="small muted" style={{ marginTop: 8 }} data-testid="pipeline-completed-in">
                {view.pipeline.status === 'succeeded' ? '✓ Completed' : `Run ${view.pipeline.status}`} in{' '}
                {fmtSeconds(completedIn)}
              </div>
            )}
            {failed && !inProgress && (
              <div className="failure-card" role="alert" data-testid="pipeline-failure-card">
                <div>
                  <strong>
                    ✗ {STEP_LABELS[failed.step]} —{' '}
                    {failed.error_code === 'http_error' ? 'LLM service unavailable' : failed.error_code}
                  </strong>{' '}
                  <span className="muted">
                    ({failed.error_message}
                    {view.pipeline?.finished_at ? `, ${fmtTime(view.pipeline.finished_at)}` : ''})
                  </span>
                </div>
                <div style={{ margin: '6px 0 10px' }}>
                  Case remains in <strong>{state}</strong>. No decision has been made.
                </div>
                <div className="row">
                  {canRun && (
                    <ReasonButton
                      reason={runReason}
                      onClick={() => act('run', startRun)}
                      busy={busy === 'run'}
                      testId="retry-step-btn"
                      className="btn"
                    >
                      ↻ Retry step
                    </ReasonButton>
                  )}
                  {can(me.role, 'pipeline.manual_continue') && (
                    <ReasonButton
                      reason={
                        state !== 'ASSESSMENT'
                          ? `Only available while in ASSESSMENT (currently ${state})`
                          : null
                      }
                      onClick={() => setManual(true)}
                      testId="continue-manually-btn"
                      className="btn btn-primary"
                    >
                      Continue manually → Analyst Review
                    </ReasonButton>
                  )}
                </div>
              </div>
            )}
            <div className="row" style={{ marginTop: 14 }} data-testid="tokens-tile">
              <span className="muted">Tokens this case:</span>
              <strong>{fmtTokens(view.tokens.input)}</strong> in ·{' '}
              <strong>{fmtTokens(view.tokens.output)}</strong> out ·{' '}
              <strong>{fmtTokens(view.tokens.cacheRead)}</strong> cache read ·{' '}
              <strong>{fmtTokens(view.tokens.cacheWrite)}</strong> cache write ·{' '}
              <strong>{fmtUsd(view.tokens.cost_usd)}</strong>
              <span className="muted small">
                ({view.tokens.calls} LLM call{view.tokens.calls === 1 ? '' : 's'})
              </span>
            </div>
          </Section>

          <Section title={`Documents (${view.documents.length})`}>
            {view.documents.length === 0 ? (
              <div className="empty">No documents uploaded.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Kind</th>
                    <th>Size</th>
                    <th>Parse</th>
                    <th>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {view.documents.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {d.original_name}
                        {view.flags.some((f) => f.document_id === d.id) && (
                          <span className="chip chip-warning" style={{ marginLeft: 8 }}>
                            ⚠ flagged
                          </span>
                        )}
                      </td>
                      <td className="muted">{d.kind.replace(/_/g, ' ')}</td>
                      <td className="muted">{fmtBytes(d.size_bytes)}</td>
                      <td>
                        {d.parse_status === 'parsed' ? (
                          <span className="chip chip-success">✓ parsed</span>
                        ) : d.parse_status === 'parse_failed' ? (
                          <span className="chip chip-danger" title={d.parse_error ?? ''}>
                            ✗ failed
                          </span>
                        ) : (
                          <span className="chip chip-neutral">○ pending</span>
                        )}
                      </td>
                      <td className="small muted">{fmtDateTime(d.uploaded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Description">
            <p style={{ whiteSpace: 'pre-wrap' }}>{view.case.description}</p>
          </Section>
        </div>

        <div>
          <Section title={`Blockers (${view.blockers.length})`} testId="blockers-rail">
            <BlockersRail blockers={view.blockers} caseId={caseId} />
            {can(me.role, 'case.finalize') && (
              <div style={{ marginTop: 14 }}>
                <ReasonButton
                  reason={finalizeReason}
                  onClick={() => act('finalize', () => api.finalize(caseId))}
                  busy={busy === 'finalize'}
                  testId="finalize-btn"
                >
                  Finalize → Committee
                </ReasonButton>
              </div>
            )}
          </Section>

          {view.calculation && (
            <Section title="Current calculation">
              <dl className="kv">
                <dt>Inherent</dt>
                <dd>
                  {view.calculation.inherent_score.toFixed(2)} {view.calculation.inherent_band}
                </dd>
                <dt>Residual</dt>
                <dd>
                  {view.calculation.residual_score.toFixed(2)} {view.calculation.residual_band}
                </dd>
                <dt>Trigger</dt>
                <dd>{view.calculation.trigger}</dd>
                <dt>Computed</dt>
                <dd>{fmtDateTime(view.calculation.computed_at)}</dd>
                <dt>Risk model</dt>
                <dd>v{view.calculation.risk_model_version}</dd>
              </dl>
            </Section>
          )}

          {view.versions && (
            <Section title="Frozen versions">
              <dl className="kv">
                <dt>Risk model</dt>
                <dd>v{view.versions.risk_model_version}</dd>
                <dt>Policies</dt>
                <dd>
                  {Object.entries(view.versions.policy_versions)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(', ') || '—'}
                </dd>
                <dt>Prompts</dt>
                <dd>
                  {Object.entries(view.versions.prompt_versions)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(', ') || '—'}
                </dd>
                <dt>Models</dt>
                <dd>{[...new Set(Object.values(view.versions.llm_models))].join(', ') || '—'}</dd>
                <dt>Frozen</dt>
                <dd>{fmtDateTime(view.versions.frozen_at)}</dd>
              </dl>
            </Section>
          )}
        </div>
      </div>

      {manual && (
        <RationaleDialog
          title="Continue manually → Analyst Review"
          submitLabel="Continue manually"
          onClose={() => setManual(false)}
          onSubmit={async (rationale) => {
            await mutate(() => api.continueManually(caseId, rationale));
          }}
        >
          <p className="muted">
            The failed step is not re-run. The case moves to Analyst review without an AI assessment; scores
            must be entered by hand. Nothing is decided.
          </p>
        </RationaleDialog>
      )}
    </div>
  );
}
