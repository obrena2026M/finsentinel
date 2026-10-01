import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { SourceLink } from '../../components/ContextPanel.tsx';
import { ErrorText, ReasonButton, Section } from '../../components/common.tsx';
import { RationaleDialog } from '../../components/RationaleDialog.tsx';
import { FACT_FIELDS, fieldLabel } from '../../constants.ts';
import { fmtDateTime, fmtValue } from '../../format.ts';
import { can } from '../../rbac.ts';
import type { Contradiction, Fact, FactStatus, InfoRequest } from '../../types.ts';
import { useCase } from './context.ts';

// Facts tab (UX §4.5): facts table, contradictions, information requests.

const STATUS_CHIP: Record<FactStatus, { cls: string; icon: string; label: string }> = {
  extracted: { cls: 'chip-success', icon: '✓', label: 'extracted' },
  confirmed: { cls: 'chip-success', icon: '✓', label: 'confirmed' },
  analyst_entered: { cls: 'chip-info', icon: '✎', label: 'analyst entered' },
  resolved: { cls: 'chip-info', icon: '✓', label: 'resolved' },
  low_confidence: { cls: 'chip-warning', icon: '⚠', label: 'low confidence' },
  conflicted: { cls: 'chip-warning', icon: '⚠', label: 'conflicted' },
  missing: { cls: 'chip-danger', icon: '✗', label: 'missing' },
};

function StatusChip({ status }: { status: FactStatus }) {
  const s = STATUS_CHIP[status] ?? { cls: 'chip-neutral', icon: '•', label: status };
  return (
    <span className={`chip ${s.cls}`} data-status={status}>
      <span className="chip-icon" aria-hidden="true">
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}

export function FactsTab() {
  const { view, me, caseId, mutate } = useCase();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [enter, setEnter] = useState<{ field: string; value: string } | null>(null);
  const [resolve, setResolve] = useState<Contradiction | null>(null);
  const [gap, setGap] = useState<InfoRequest | null>(null);

  const docName = (id: string) => view.documents.find((d) => d.id === id)?.original_name ?? id.slice(0, 8);
  const isAnalyst = can(me.role, 'fact.confirm');

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await mutate(fn);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const openContradictions = view.contradictions.filter((c) => c.status === 'open');
  const resolvedContradictions = view.contradictions.filter((c) => c.status === 'resolved');
  const openRequests = view.information_requests.filter((r) => r.status === 'open');
  const closedRequests = view.information_requests.filter((r) => r.status !== 'open');

  const sourceContent = (f: Fact) => ({
    title: fieldLabel(f.field),
    subtitle: `${f.sources.length} source${f.sources.length === 1 ? '' : 's'} · confidence ${f.confidence === null ? '—' : f.confidence.toFixed(2)}`,
    quotes: f.sources.map((s) => ({
      label: `${docName(s.document_id)} · chunk ${s.chunk_ix}`,
      quote: s.quote,
    })),
    meta: [['Value', fmtValue(f.value)] as [string, string], ['Status', f.status] as [string, string]],
  });

  return (
    <div>
      <ErrorText error={error} />
      <Section
        title={`Facts (${view.facts.length})`}
        testId="facts-table"
        right={
          isAnalyst && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setEnter({ field: FACT_FIELDS[0], value: '' })}
              data-testid="enter-fact-btn"
            >
              ✎ Enter value
            </button>
          )
        }
      >
        {view.facts.length === 0 ? (
          <div className="empty">No facts extracted yet. Run the pipeline.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
                <th className="num">Conf.</th>
                <th>Status</th>
                <th>Source</th>
                {isAnalyst && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {view.facts.map((f) => (
                <tr key={f.id} data-testid={`fact-row-${f.field}`} data-status={f.status}>
                  <td>
                    <strong>{fieldLabel(f.field)}</strong>
                  </td>
                  <td>
                    {f.value === null ? (
                      <span className="muted">
                        — {f.missing_reason ? <span className="small">({f.missing_reason})</span> : null}
                      </span>
                    ) : (
                      fmtValue(f.value)
                    )}
                  </td>
                  <td className="num">
                    {f.confidence === null || f.value === null ? '—' : f.confidence.toFixed(2)}
                  </td>
                  <td>
                    <StatusChip status={f.status} />
                  </td>
                  <td>
                    {f.sources.length > 0 ? (
                      <span className="row" style={{ gap: 4 }}>
                        <span className="small muted">
                          {f.sources.length === 1
                            ? `${docName(f.sources[0]!.document_id)} · chunk ${f.sources[0]!.chunk_ix}`
                            : `${f.sources.length} sources`}
                        </span>
                        <SourceLink
                          content={sourceContent(f)}
                          title={`Open sources for ${fieldLabel(f.field)}`}
                        />
                      </span>
                    ) : (
                      <span className="muted small">{f.status === 'analyst_entered' ? 'analyst' : '—'}</span>
                    )}
                  </td>
                  {isAnalyst && (
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        {f.status === 'low_confidence' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={busy !== null}
                            onClick={() => act(`confirm-${f.id}`, () => api.confirmFact(caseId, f.id))}
                            data-testid={`confirm-fact-${f.field}`}
                          >
                            {busy === `confirm-${f.id}` ? (
                              <span className="spinner" aria-hidden="true" />
                            ) : (
                              '✓'
                            )}{' '}
                            Confirm
                          </button>
                        )}
                        {(f.status === 'low_confidence' ||
                          f.status === 'missing' ||
                          f.status === 'extracted' ||
                          f.status === 'confirmed') && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() =>
                              setEnter({ field: f.field, value: f.value === null ? '' : fmtValue(f.value) })
                            }
                            data-testid={`edit-fact-${f.field}`}
                          >
                            ✎ {f.status === 'missing' ? 'Enter' : 'Edit'}
                          </button>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Contradictions (${openContradictions.length} open)`} testId="contradictions">
        {view.contradictions.length === 0 && <div className="muted">No contradictions detected.</div>}
        <div className="stack">
          {openContradictions.map((c) => (
            <div
              key={c.id}
              className="card"
              style={{ boxShadow: 'none', borderColor: 'var(--warning)' }}
              data-testid={`contradiction-${c.field}`}
            >
              <div className="row row-between">
                <strong>⚠ CONTRADICTION — {fieldLabel(c.field)}</strong>
                <span className="small muted">detected by {c.detected_by}</span>
              </div>
              {c.candidates.explanation && <p className="muted small">{c.candidates.explanation}</p>}
              <table className="table">
                <tbody>
                  {c.candidates.candidates.map((k) => (
                    <tr key={`${k.doc_id}:${k.chunk_ix}:${fmtValue(k.value)}`}>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                        {docName(k.doc_id)} · chunk {k.chunk_ix}
                      </td>
                      <td>
                        <strong>{fmtValue(k.value)}</strong>
                      </td>
                      <td className="small muted">
                        “{k.quote}”{' '}
                        <SourceLink
                          content={{
                            title: `${fieldLabel(c.field)} — candidate`,
                            subtitle: `${docName(k.doc_id)} · chunk ${k.chunk_ix}`,
                            quotes: [{ quote: k.quote }],
                            meta: [['Value', fmtValue(k.value)]],
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {can(me.role, 'contradiction.resolve') && (
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setResolve(c)}
                    data-testid={`resolve-${c.field}`}
                  >
                    Resolve…
                  </button>
                </div>
              )}
            </div>
          ))}
          {resolvedContradictions.map((c) => (
            <div key={c.id} className="small muted">
              ✓ {fieldLabel(c.field)} resolved as <strong>{fmtValue(c.resolved_value)}</strong>{' '}
              {fmtDateTime(c.resolved_at)} — “{c.rationale}”
            </div>
          ))}
        </div>
      </Section>

      <Section
        title={`Information requests (${openRequests.length} open)`}
        testId="information-requests"
        right={
          can(me.role, 'fact.enter') && openRequests.length > 0 && view.case.state === 'ANALYST_REVIEW' ? (
            <ReasonButton
              reason={null}
              onClick={() => act('request-info', () => api.requestInfo(caseId))}
              busy={busy === 'request-info'}
              className="btn btn-sm"
              testId="request-info-btn"
            >
              Send to owner → Info requested
            </ReasonButton>
          ) : null
        }
      >
        {view.information_requests.length === 0 && <div className="muted">No information requests.</div>}
        <div className="stack">
          {openRequests.map((r) => (
            <InfoRequestRow
              key={r.id}
              r={r}
              onAnswer={(answer) => act(`answer-${r.id}`, () => api.respondInfoRequest(caseId, r.id, answer))}
              busy={busy === `answer-${r.id}`}
              canAnswer={can(me.role, 'info_request.respond')}
              canAcceptGap={can(me.role, 'info_request.accept_gap')}
              onAcceptGap={() => setGap(r)}
            />
          ))}
          {closedRequests.map((r) => (
            <div
              key={r.id}
              className="small muted"
              data-testid={`info-request-${r.field}`}
              data-status={r.status}
            >
              {r.status === 'answered' ? '✓' : '◌'} {fieldLabel(r.field)} —{' '}
              {r.status === 'answered'
                ? `answered: “${r.answer}”`
                : `gap accepted: “${r.accepted_rationale}”`}
            </div>
          ))}
        </div>
      </Section>

      {enter && (
        <RationaleDialog
          title="Enter fact value"
          submitLabel="Save value"
          validate={() => (enter.value.trim() === '' ? 'Value is required' : null)}
          onClose={() => setEnter(null)}
          onSubmit={async (rationale) => {
            await mutate(() =>
              api.enterFact(caseId, { field: enter.field, value: parseValue(enter.value), rationale }),
            );
          }}
        >
          <div className="field">
            <label htmlFor="fact-field">Field</label>
            <select
              id="fact-field"
              className="select"
              value={enter.field}
              onChange={(e) => setEnter({ ...enter, field: e.target.value })}
            >
              {FACT_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {fieldLabel(f)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fact-value">Value*</label>
            <input
              id="fact-value"
              className="input"
              value={enter.value}
              onChange={(e) => setEnter({ ...enter, value: e.target.value })}
              data-testid="fact-value-input"
            />
            <div className="hint">
              Comma-separated values become a list; "yes"/"no" become booleans; numbers are parsed.
            </div>
          </div>
        </RationaleDialog>
      )}

      {resolve && (
        <ResolveDialog
          c={resolve}
          docName={docName}
          onClose={() => setResolve(null)}
          onSubmit={(value, rationale) =>
            mutate(() => api.resolveContradiction(caseId, resolve.id, { value, rationale }))
          }
        />
      )}

      {gap && (
        <RationaleDialog
          title={`Accept gap — ${fieldLabel(gap.field)}`}
          submitLabel="Accept gap"
          onClose={() => setGap(null)}
          onSubmit={async (rationale) => {
            await mutate(() => api.acceptGap(caseId, gap.id, rationale));
          }}
        >
          <p className="muted">“{gap.question}”</p>
          <p className="small muted">
            Accepting the gap records that the assessment proceeds without this fact. The value stays missing;
            it is never invented.
          </p>
        </RationaleDialog>
      )}
    </div>
  );
}

function parseValue(s: string): unknown {
  const t = s.trim();
  if (/^(yes|true)$/i.test(t)) return true;
  if (/^(no|false)$/i.test(t)) return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.includes(','))
    return t
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  return t;
}

function InfoRequestRow({
  r,
  onAnswer,
  busy,
  canAnswer,
  canAcceptGap,
  onAcceptGap,
}: {
  r: InfoRequest;
  onAnswer: (answer: string) => void;
  busy: boolean;
  canAnswer: boolean;
  canAcceptGap: boolean;
  onAcceptGap: () => void;
}) {
  const [answer, setAnswer] = useState('');
  return (
    <div
      className="card"
      style={{ boxShadow: 'none' }}
      data-testid={`info-request-${r.field}`}
      data-status={r.status}
    >
      <div className="row row-between">
        <strong>{fieldLabel(r.field)}</strong>
        <span className="chip chip-warning">
          <span className="chip-icon" aria-hidden="true">
            ⚠
          </span>
          open
        </span>
      </div>
      <p>“{r.question}”</p>
      {canAnswer && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim().length >= 2) onAnswer(answer.trim());
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Your answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            data-testid={`answer-input-${r.field}`}
          />
          <ReasonButton
            reason={answer.trim().length < 2 ? 'Enter an answer' : null}
            onClick={() => onAnswer(answer.trim())}
            busy={busy}
            className="btn btn-primary btn-sm"
            testId={`answer-btn-${r.field}`}
          >
            Answer
          </ReasonButton>
        </form>
      )}
      {canAcceptGap && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onAcceptGap}
          data-testid={`accept-gap-${r.field}`}
        >
          Accept gap with rationale
        </button>
      )}
    </div>
  );
}

function ResolveDialog({
  c,
  docName,
  onClose,
  onSubmit,
}: {
  c: Contradiction;
  docName: (id: string) => string;
  onClose: () => void;
  onSubmit: (value: unknown, rationale: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState<number | 'other'>(0);
  const [other, setOther] = useState('');
  const value = () => (choice === 'other' ? parseValue(other) : c.candidates.candidates[choice]?.value);
  return (
    <RationaleDialog
      title={`Resolve contradiction — ${fieldLabel(c.field)}`}
      submitLabel="Resolve"
      validate={() => (choice === 'other' && other.trim() === '' ? 'Enter the other value' : null)}
      onClose={onClose}
      onSubmit={(rationale) => onSubmit(value(), rationale)}
    >
      <div className="field">
        <span className="field-label" id="resolve-label">
          Resolve as
        </span>
        <div className="radio-stack" role="radiogroup" aria-labelledby="resolve-label">
          {c.candidates.candidates.map((k, i) => (
            <label key={`${k.doc_id}:${k.chunk_ix}:${fmtValue(k.value)}`}>
              <input type="radio" name="resolve" checked={choice === i} onChange={() => setChoice(i)} />
              <span>
                <strong>{fmtValue(k.value)}</strong>
                <div className="small muted">
                  {docName(k.doc_id)} · chunk {k.chunk_ix} — “{k.quote}”
                </div>
              </span>
            </label>
          ))}
          <label>
            <input
              type="radio"
              name="resolve"
              checked={choice === 'other'}
              onChange={() => setChoice('other')}
            />
            <span>
              Other:{' '}
              <input
                className="input"
                style={{ width: 260, display: 'inline-block' }}
                value={other}
                onChange={(e) => setOther(e.target.value)}
                onFocus={() => setChoice('other')}
              />
            </span>
          </label>
        </div>
      </div>
    </RationaleDialog>
  );
}
