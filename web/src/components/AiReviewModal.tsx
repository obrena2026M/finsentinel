import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { STEP_LABELS } from '../constants.ts';
import type { PipelineRun, StepName } from '../types.ts';

// Global "AI Review In Progress" modal. Any Run / Re-run button calls start(caseId, ref): the modal
// opens immediately, triggers the run, polls the server, and animates through the ten steps at a
// human-visible pace (≥ STEP_MS per bullet, never ahead of real server progress). It closes only
// after every bullet is checked and the server has finished. Presentational only — nothing here decides.

const STEP_MS = 1700;
const POLL_MS = 700;

const STEPS: StepName[] = [
  'parse',
  'extract',
  'merge_contradict',
  'missing_info',
  'scope',
  'retrieve',
  'assess',
  'ground',
  'score',
  'packet',
];

const MESSAGE: Record<StepName, string> = {
  parse: 'Reading the uploaded documents…',
  extract: 'AI is extracting facts with supporting quotes…',
  merge_contradict: 'Cross-checking documents for contradictions…',
  missing_info: 'Checking for missing information…',
  scope: 'AI is identifying the relevant risk dimensions…',
  retrieve: 'Searching policies for evidence…',
  assess: 'AI is drafting the assessment with citations…',
  ground: 'Verifying every claim against the evidence…',
  score: 'Calculating inherent and residual risk (deterministic)…',
  packet: 'Preparing the committee packet…',
};

const DETAIL: Record<StepName, string> = {
  parse: 'Opening each file and splitting it into sections',
  extract: 'Customer, geography, channel, transaction, vendor and control facts, each with a quote',
  merge_contradict: 'Comparing facts across documents and flagging disagreements',
  missing_info: 'Listing required facts that no document provides',
  scope: 'Deciding which of the eight risk dimensions this change touches',
  retrieve: 'Full-text search over the policy corpus for applicable sections',
  assess: 'Writing the assessment and citing evidence for every claim',
  ground: 'Checking that every cited quote exists in the evidence',
  score: 'Applying the risk model: inherent → controls → residual',
  packet: 'Assembling the committee packet',
};

type Phase = 'starting' | 'running' | 'ready' | 'failed' | 'error';

type State = {
  open: boolean;
  caseId: string;
  ref: string;
  phase: Phase;
  displayDone: number;
  serverDone: number;
  failedStep: StepName | null;
  failedMessage: string | null;
  error: string | null;
  startedAt: number;
};

const idle: State = {
  open: false,
  caseId: '',
  ref: '',
  phase: 'starting',
  displayDone: 0,
  serverDone: 0,
  failedStep: null,
  failedMessage: null,
  error: null,
  startedAt: 0,
};

type Ctx = { start: (caseId: string, ref: string) => Promise<void>; active: boolean };
const AiReviewContext = createContext<Ctx>({ start: async () => {}, active: false });

export function useAiReview(): Ctx {
  return useContext(AiReviewContext);
}

function serverProgress(run: PipelineRun | null): {
  done: number;
  failed: PipelineRun['steps'][number] | null;
  finished: boolean;
} {
  if (!run) return { done: 0, failed: null, finished: false };
  const failed = run.steps.find((s) => s.status === 'failed') ?? null;
  if (run.status === 'succeeded') return { done: STEPS.length, failed: null, finished: true };
  if (run.status === 'failed' || run.status === 'manual_continue') {
    return {
      done: failed
        ? run.steps.findIndex((s) => s.step === failed.step)
        : run.steps.filter((s) => s.status === 'succeeded').length,
      failed,
      finished: true,
    };
  }
  return { done: run.steps.filter((s) => s.status === 'succeeded').length, failed: null, finished: false };
}

export function AiReviewProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<State>(idle);
  const navigate = useNavigate();
  const pollRef = useRef<number | null>(null);
  const runIdRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  const start = useCallback(
    async (caseId: string, ref: string) => {
      stopPolling();
      runIdRef.current = null;
      setS({ ...idle, open: true, caseId, ref, phase: 'starting', startedAt: Date.now() });
      // Remember the run that existed before we start, so the new run is recognised by id even if the
      // server finishes it before our first poll (fast mock runs).
      let previousRunId: string | null = null;
      try {
        previousRunId = (await api.pipelineStatus(caseId)).pipeline?.id ?? null;
      } catch {
        previousRunId = null;
      }
      try {
        await api.runPipeline(caseId);
      } catch (e) {
        setS((p) => ({ ...p, phase: 'error', error: errorMessage(e) }));
        return;
      }
      const tick = async () => {
        try {
          const st = await api.pipelineStatus(caseId);
          const run = st.pipeline;
          // The new run is any run row whose id differs from the one seen before starting.
          if (run && runIdRef.current === null && run.id !== previousRunId) runIdRef.current = run.id;
          const isNew = !!run && runIdRef.current === run.id;
          const prog = isNew ? serverProgress(run) : { done: 0, failed: null, finished: false };
          setS((p) => ({
            ...p,
            phase: prog.finished ? (prog.failed ? 'failed' : 'ready') : 'running',
            serverDone: prog.done,
            failedStep: prog.failed?.step ?? null,
            failedMessage: prog.failed
              ? (prog.failed.error_message ?? prog.failed.error_code ?? 'error')
              : null,
          }));
          if (!(isNew && prog.finished)) pollRef.current = window.setTimeout(tick, POLL_MS);
        } catch (e) {
          setS((p) => ({ ...p, phase: 'error', error: errorMessage(e) }));
        }
      };
      pollRef.current = window.setTimeout(tick, POLL_MS);
    },
    [stopPolling],
  );

  // Paced bullet animation: advance one step per STEP_MS, never beyond the server's real progress.
  useEffect(() => {
    if (!s.open) return;
    const t = window.setInterval(() => {
      setS((p) => (p.displayDone < p.serverDone ? { ...p, displayDone: p.displayDone + 1 } : p));
    }, STEP_MS);
    return () => window.clearInterval(t);
  }, [s.open]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const reachedEnd = (s.phase === 'ready' || s.phase === 'failed') && s.displayDone >= s.serverDone;
  const total = STEPS.length;
  const pct = Math.round((s.displayDone / total) * 100);
  const currentStep = s.displayDone < total ? STEPS[s.displayDone]! : null;
  const elapsed = s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0;

  const close = () => {
    stopPolling();
    setS(idle);
  };

  const ctx = useMemo<Ctx>(() => ({ start, active: s.open }), [start, s.open]);

  return (
    <AiReviewContext.Provider value={ctx}>
      {children}
      {s.open && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog pipeline-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-review-title"
            data-testid="ai-review-modal"
          >
            <div className="pipeline-modal-head">
              <span className="ai-spinner" aria-hidden="true">
                <span className={`ai-spinner-ring ${reachedEnd ? 'ai-spinner-done' : ''}`} />
                <span className="ai-spinner-pct">{reachedEnd && s.phase === 'ready' ? '✓' : `${pct}%`}</span>
              </span>
              <div style={{ flex: 1 }}>
                <h2 id="ai-review-title" style={{ margin: 0 }}>
                  {s.phase === 'error'
                    ? 'Could not start the AI review'
                    : reachedEnd && s.phase === 'failed'
                      ? 'AI Review stopped — case stays pending'
                      : reachedEnd
                        ? 'AI Review complete'
                        : 'AI Review In Progress'}
                </h2>
                <div className="muted small" data-testid="ai-review-message">
                  <span className="mono">{s.ref}</span> ·{' '}
                  {s.phase === 'error'
                    ? s.error
                    : reachedEnd && s.phase === 'failed'
                      ? `${s.failedStep ? STEP_LABELS[s.failedStep] : 'A step'} failed: ${s.failedMessage}. No decision was made.`
                      : reachedEnd
                        ? 'All steps checked. Rules calculated the risk; a human decides next.'
                        : currentStep
                          ? MESSAGE[currentStep]
                          : 'Finishing up…'}
                </div>
              </div>
              <span className="muted small mono" title="Elapsed time">
                {elapsed}s
              </span>
            </div>

            <div
              className="progress-track progress-animated"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="progress-fill"
                style={{ width: `${Math.max(pct, s.phase === 'starting' ? 3 : 0)}%` }}
              />
            </div>

            <ol className="pipeline-modal-steps" aria-label="Pipeline steps">
              {STEPS.map((step, i) => {
                const status =
                  reachedEnd && s.phase === 'failed' && s.failedStep === step
                    ? 'failed'
                    : i < s.displayDone
                      ? 'done'
                      : i === s.displayDone && !reachedEnd && s.phase !== 'error'
                        ? 'checking'
                        : 'pending';
                return (
                  <li
                    key={step}
                    className={`pm-step pm-step-${status}`}
                    data-testid={`ai-review-step-${step}`}
                    data-status={status}
                  >
                    <span className="pm-icon" aria-hidden="true">
                      {status === 'done' ? (
                        '✓'
                      ) : status === 'checking' ? (
                        <span className="pm-mini-spinner" />
                      ) : status === 'failed' ? (
                        '✗'
                      ) : (
                        '○'
                      )}
                    </span>
                    <span className="pm-body">
                      <span className="pm-label">{STEP_LABELS[step]}</span>
                      <span className="pm-detail muted small">{DETAIL[step]}</span>
                    </span>
                    <span className="pm-status small">
                      {status === 'done'
                        ? 'checked'
                        : status === 'checking'
                          ? 'checking…'
                          : status === 'failed'
                            ? 'failed'
                            : ''}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="dialog-actions">
              <span className="muted small" style={{ flex: 1 }}>
                AI prepares · Rules calculate · Humans decide
              </span>
              {reachedEnd || s.phase === 'error' ? (
                <>
                  <button type="button" className="btn" onClick={close} data-testid="ai-review-close">
                    Close
                  </button>
                  {s.phase === 'ready' && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      data-testid="ai-review-open-case"
                      onClick={() => {
                        const id = s.caseId;
                        close();
                        navigate(`/cases/${id}#overview`);
                      }}
                    >
                      Review assessment
                    </button>
                  )}
                </>
              ) : (
                <button type="button" className="btn" onClick={close} data-testid="ai-review-background">
                  Continue in background
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AiReviewContext.Provider>
  );
}
