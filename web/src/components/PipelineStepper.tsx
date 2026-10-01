import { STEP_LABELS } from '../constants.ts';
import { fmtScore } from '../format.ts';
import type { PipelineRun, PipelineStep } from '../types.ts';

// Pipeline card (UX §4.4). Statuses + one-line summaries; failure card rendered by the parent.

const ICON: Record<PipelineStep['status'], string> = {
  pending: '○',
  running: '⟳',
  succeeded: '✓',
  failed: '✗',
  skipped: '–',
};

export function stepSummaryText(s: PipelineStep): string {
  const j = s.summary ?? {};
  const n = (k: string) => (typeof j[k] === 'number' ? (j[k] as number) : null);
  switch (s.step) {
    case 'parse':
      return s.summary
        ? `${n('parsed') ?? 0}/${n('documents') ?? 0} docs parsed${(n('instruction_like_flags') ?? 0) > 0 ? ` · ${n('instruction_like_flags')} flag(s)` : ''}`
        : '';
    case 'extract':
      return s.summary ? `${n('facts_extracted') ?? 0} facts from ${n('documents') ?? 0} docs` : '';
    case 'merge_contradict':
      return s.summary
        ? `${n('facts') ?? 0} facts · ${n('missing') ?? 0} missing · ${n('low_confidence') ?? 0} low-conf · ${n('contradictions') ?? 0} contradiction(s)`
        : '';
    case 'missing_info':
      return s.summary ? `${n('information_requests') ?? 0} information request(s)` : '';
    case 'scope': {
      const d = Array.isArray(j.dimensions) ? (j.dimensions as string[]) : [];
      return s.summary ? `${d.length} dimension(s)` : '';
    }
    case 'retrieve':
      return s.summary ? `${n('evidence') ?? 0} policy section(s)${j.empty ? ' · none matched' : ''}` : '';
    case 'assess':
      return s.summary ? `${n('claims') ?? 0} claim(s) · ${String(j.model ?? '')}` : '';
    case 'ground':
      return s.summary
        ? `${n('SUPPORTED') ?? 0} supported · ${n('WEAK') ?? 0} weak · ${n('UNSUPPORTED') ?? 0} unsupported`
        : '';
    case 'score':
      return s.summary
        ? `Inherent ${fmtScore(n('inherent'))} ${String(j.inherent_band ?? '')} → Residual ${fmtScore(n('residual'))} ${String(j.residual_band ?? '')}`
        : '';
    case 'packet':
      return s.summary ? 'Packet ready' : '';
    default:
      return '';
  }
}

export function PipelineStepper({ run }: { run: PipelineRun | null }) {
  if (!run) return <div className="empty">Pipeline has not run yet.</div>;
  return (
    <ul className="stepper" aria-label="Pipeline steps">
      {run.steps.map((s) => (
        <li
          key={s.step}
          className={`step step-${s.status}`}
          data-testid={`pipeline-step-${s.step}`}
          data-status={s.status}
        >
          <span className="step-icon" aria-hidden="true">
            {ICON[s.status]}
          </span>
          <div>
            <div className="step-name">
              {STEP_LABELS[s.step] ?? s.step} <span className="small muted">· {s.status}</span>
            </div>
            {s.status === 'failed' ? (
              <div className="step-summary error-text">
                {s.error_code}: {s.error_message}
              </div>
            ) : (
              <div className="step-summary">{stepSummaryText(s)}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
