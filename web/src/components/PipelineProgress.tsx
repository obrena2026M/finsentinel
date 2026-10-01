import { STEP_LABELS } from '../constants.ts';
import { fmtTokens, fmtUsd } from '../format.ts';
import type { PipelineRun, StepName, Tokens } from '../types.ts';

// "AI is working" panel shown while a pipeline run is in progress (UX §4.4 / §6).
// CSS-only animation (styles.css: .progress-*, .ai-scan), honours prefers-reduced-motion.
// The panel is purely informational: AI prepares, rules calculate, humans decide.

export const STEP_MESSAGES: Record<StepName, string> = {
  parse: 'Reading documents…',
  extract: 'AI is extracting facts from the documents…',
  merge_contradict: 'Cross-checking documents for contradictions…',
  missing_info: 'Checking for missing information…',
  scope: 'AI is identifying relevant risk dimensions…',
  retrieve: 'Searching policies for evidence…',
  assess: 'AI is drafting the assessment with citations…',
  ground: 'Verifying every claim against evidence…',
  score: 'Calculating inherent and residual risk (deterministic)…',
  packet: 'Preparing the committee packet…',
};

const AI_STEPS: ReadonlySet<StepName> = new Set<StepName>(['extract', 'merge_contradict', 'scope', 'assess']);

export function runProgress(run: Pick<PipelineRun, 'steps'>): { done: number; total: number; pct: number } {
  const total = run.steps.length;
  const done = run.steps.filter((s) => s.status === 'succeeded').length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Elapsed seconds between two ISO timestamps (end defaults to now). */
export function elapsedSeconds(startIso: string, endIso?: string | null): number {
  const a = new Date(startIso).getTime();
  const b = endIso ? new Date(endIso).getTime() : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, (b - a) / 1000);
}

export function fmtSeconds(s: number): string {
  return s >= 10 ? `${Math.round(s)} s` : `${s.toFixed(1)} s`;
}

export function ProgressBar({
  done,
  total,
  animated = false,
  label,
}: {
  done: number;
  total: number;
  animated?: boolean;
  label?: string;
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div
      className={`progress-track ${animated ? 'progress-animated' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label ?? `Pipeline progress ${done} of ${total} steps`}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PipelineProgress({
  run,
  tokens,
  finishing = false,
}: {
  run: PipelineRun;
  tokens: Tokens;
  /** True while the run has already completed but the panel is held for the minimum display time. */
  finishing?: boolean;
}) {
  // The server can report running=true a moment before the new run row replaces the previous
  // (finished) one; treat a non-running row as "starting" rather than flashing 100%.
  const starting = !finishing && run.status !== 'running';
  const progress = finishing
    ? { done: run.steps.length, total: run.steps.length, pct: 100 }
    : starting
      ? { done: 0, total: run.steps.length, pct: 0 }
      : runProgress(run);
  const { done, total, pct } = progress;
  const current = starting
    ? undefined
    : (run.steps.find((s) => s.status === 'running') ?? run.steps.find((s) => s.status === 'pending'));
  const message = finishing
    ? 'Assessment ready — handing over to the analyst…'
    : starting
      ? 'Starting a new run — loading documents…'
      : current
        ? STEP_MESSAGES[current.step]
        : 'Finishing up…';
  const isAi = finishing ? true : current ? AI_STEPS.has(current.step) : true;

  return (
    <div className="ai-working" role="status" aria-live="polite" data-testid="pipeline-progress">
      <div className="ai-working-head">
        <span className="ai-spinner" aria-hidden="true">
          <span className="ai-spinner-ring" />
          <span className="ai-spinner-pct">{pct}%</span>
        </span>
        <span className="ai-scan" aria-hidden="true">
          <span className="ai-scan-doc">
            <span className="ai-scan-line" />
            <span className="ai-scan-line" />
            <span className="ai-scan-line" />
          </span>
          <span className="ai-scan-beam" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ai-working-title">
            <span className="pulse-dot" aria-hidden="true" />
            {finishing ? 'AI finished' : isAi ? 'AI is working' : 'Pipeline is working'}
            <span className="muted small" style={{ fontWeight: 500 }}>
              · step {Math.min(done + (finishing ? 0 : 1), total)} of {total} · {pct}%
            </span>
          </div>
          <div className="ai-working-message" data-testid="pipeline-progress-message">
            {message}
          </div>
        </div>
        <div className="ai-working-tokens small muted" data-testid="pipeline-progress-tokens">
          <span className="mono">{fmtTokens(tokens.input + tokens.output)}</span> tokens ·{' '}
          <span className="mono">{tokens.calls}</span> LLM call{tokens.calls === 1 ? '' : 's'} ·{' '}
          <span className="mono">{fmtUsd(tokens.cost_usd)}</span>
        </div>
      </div>
      <ProgressBar done={done} total={total} animated />
      <ol className="progress-steps" aria-label="Pipeline steps">
        {run.steps.map((s) => {
          const status = finishing ? 'succeeded' : starting ? 'pending' : s.status;
          return (
            <li
              key={s.step}
              className={`progress-step progress-step-${status}`}
              data-testid={`pipeline-step-${s.step}`}
              data-status={status}
              title={`${STEP_LABELS[s.step]} · ${status}`}
            >
              <span className="progress-step-icon" aria-hidden="true">
                {status === 'succeeded' ? '✓' : status === 'running' ? '●' : status === 'failed' ? '✗' : '○'}
              </span>
              <span className="progress-step-name">{STEP_LABELS[s.step]}</span>
              <span className="visually-hidden"> {status}</span>
            </li>
          );
        })}
      </ol>
      <div className="small muted" style={{ marginTop: 8 }}>
        {starting
          ? 'Queued'
          : `Started ${
              elapsedSeconds(run.started_at) < 1
                ? 'just now'
                : `${fmtSeconds(elapsedSeconds(run.started_at))} ago`
            }`}{' '}
        · AI prepares, rules calculate, humans decide — nothing is decided by this run.
      </div>
    </div>
  );
}
