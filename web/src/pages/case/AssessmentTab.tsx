import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { SourceLink } from '../../components/ContextPanel.tsx';
import { ErrorText, ReasonButton, Section } from '../../components/common.tsx';
import { RationaleDialog } from '../../components/RationaleDialog.tsx';
import { VerdictBadge } from '../../components/VerdictBadge.tsx';
import { dimensionLabel } from '../../constants.ts';
import { fmtDateTime } from '../../format.ts';
import { can } from '../../rbac.ts';
import type { Claim } from '../../types.ts';
import { useCase } from './context.ts';

// Assessment tab (UX §4.7): AI narrative (editable by analyst), claims with verdicts and citations.

export function AssessmentTab() {
  const { view, me, caseId, mutate } = useCase();
  const a = view.assessment;
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(a?.summary ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<Claim | null>(null);
  const [attach, setAttach] = useState<Claim | null>(null);

  if (!a) {
    return (
      <div className="empty">
        No AI assessment yet.{' '}
        {view.pipeline?.steps.find((s) => s.step === 'assess')?.status === 'failed'
          ? 'The assessment step failed — see Overview for the manual path.'
          : 'Run the pipeline to draft one.'}
      </div>
    );
  }

  const canEdit = can(me.role, 'assessment.edit');
  const active = a.claims.filter((c) => c.status === 'active');
  const removed = a.claims.filter((c) => c.status === 'removed');
  const counts = { SUPPORTED: 0, UNSUPPORTED: 0, WEAK: 0 };
  for (const c of active) counts[c.verdict]++;

  const saveSummary = async () => {
    setBusy(true);
    setError(null);
    try {
      await mutate(() => api.editAssessment(caseId, summary.trim()));
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const evidenceFor = (id: string) => view.evidence.find((e) => e.id === id);

  return (
    <div>
      <ErrorText error={error} />
      <Section
        title="AI assessment"
        testId="assessment-summary"
        right={
          <span className="row small muted">
            <span className="chip chip-ai">
              <span className="chip-icon" aria-hidden="true">
                ✦
              </span>
              AI PREPARED
            </span>
            {a.model ?? 'model'} · prompt {a.prompt_version ?? '?'} · {fmtDateTime(a.created_at)}
            {canEdit && !editing && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditing(true)}
                data-testid="edit-narrative-btn"
              >
                ✎ Edit narrative
              </button>
            )}
          </span>
        }
      >
        {editing ? (
          <div>
            <textarea
              className="textarea"
              style={{ minHeight: 140 }}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              data-testid="summary-input"
            />
            <div className="row" style={{ marginTop: 8 }}>
              <ReasonButton
                reason={
                  summary.trim().length < 20
                    ? 'Summary needs at least 20 characters'
                    : summary.trim() === a.summary
                      ? 'No changes'
                      : null
                }
                onClick={saveSummary}
                busy={busy}
                testId="save-summary-btn"
              >
                Save narrative
              </ReasonButton>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSummary(a.summary);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p style={{ whiteSpace: 'pre-wrap', fontSize: '1.02rem' }}>{a.summary}</p>
        )}
        {Object.keys(a.narratives).length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary>Dimension narratives ({Object.keys(a.narratives).length})</summary>
            <dl className="kv" style={{ marginTop: 8 }}>
              {Object.entries(a.narratives).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{dimensionLabel(k)}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </Section>

      <Section
        title={`Claims (${active.length})`}
        testId="claims"
        right={
          <span className="row small">
            <span className="chip verdict-supported">✓ {counts.SUPPORTED}</span>
            <span className="chip verdict-weak">~ {counts.WEAK}</span>
            <span className="chip verdict-unsupported">⚠ {counts.UNSUPPORTED}</span>
          </span>
        }
      >
        {active.length === 0 && <div className="muted">No active claims.</div>}
        {active.map((c) => (
          <div key={c.id} className="claim" data-testid={`claim-${c.id}`} data-verdict={c.verdict}>
            <div className="row">
              <VerdictBadge verdict={c.verdict} />
              <span className="muted small">{dimensionLabel(c.dimension)}</span>
            </div>
            <div className="claim-text">{c.text}</div>
            {c.evidence.length === 0 ? (
              <div className="citation error-text">
                No verifiable citation.{c.verdict_reason ? ` ${humanReason(c.verdict_reason)}` : ''}
              </div>
            ) : (
              c.evidence.map((ev) => {
                const ref = evidenceFor(ev.evidence_ref_id);
                return (
                  <div key={`${ev.evidence_ref_id}-${ev.quote}`} className="citation">
                    ↳ {ev.policy_id} {ev.section_ref}{' '}
                    {ev.quote_verified ? (
                      <span style={{ color: 'var(--success)' }}>✓ quote verified</span>
                    ) : (
                      <span style={{ color: 'var(--warning)' }}>~ quote not found</span>
                    )}{' '}
                    {ev.added_by === 'analyst' && <span className="chip chip-info">analyst-attached</span>} “
                    {ev.quote}”{' '}
                    {ref && (
                      <SourceLink
                        content={{
                          title: `${ref.policy_id} ${ref.section_ref}`,
                          subtitle: ref.title ?? undefined,
                          body: ref.body,
                          quotes: [{ quote: ev.quote }],
                        }}
                      />
                    )}
                  </div>
                );
              })
            )}
            {c.verdict !== 'SUPPORTED' && c.verdict_reason && c.evidence.length > 0 && (
              <div className="citation muted small">{humanReason(c.verdict_reason)}</div>
            )}
            {(can(me.role, 'claim.attach_evidence') || can(me.role, 'claim.remove')) && (
              <div className="row" style={{ marginTop: 6 }}>
                {can(me.role, 'claim.attach_evidence') && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setAttach(c)}
                    data-testid={`attach-evidence-${c.id}`}
                  >
                    Attach evidence
                  </button>
                )}
                {can(me.role, 'claim.remove') && (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => setRemove(c)}
                    data-testid={`remove-claim-${c.id}`}
                  >
                    Remove claim
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {removed.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="muted">{removed.length} removed claim(s)</summary>
            {removed.map((c) => (
              <div key={c.id} className="claim claim-removed">
                <div className="claim-text">{c.text}</div>
              </div>
            ))}
          </details>
        )}
      </Section>

      {remove && (
        <RationaleDialog
          title="Remove claim"
          submitLabel="Remove claim"
          onClose={() => setRemove(null)}
          onSubmit={async (rationale) => {
            await mutate(() => api.removeClaim(caseId, remove.id, rationale));
          }}
        >
          <p className="muted">“{remove.text}”</p>
        </RationaleDialog>
      )}

      {attach && (
        <AttachDialog
          claim={attach}
          onClose={() => setAttach(null)}
          onSubmit={(evidence_ref_id, quote) =>
            mutate(() => api.attachEvidence(caseId, attach.id, { evidence_ref_id, quote }))
          }
        />
      )}
    </div>
  );
}

function humanReason(r: string): string {
  const map: Record<string, string> = {
    no_citations: 'The model cited no evidence.',
    quote_not_found: 'The quoted text was not found in the cited section.',
    unknown_evidence_id: 'The cited evidence ID does not exist.',
    analyst_attached_verified_quote: 'Analyst attached a verified quote.',
  };
  return map[r] ?? r.replace(/_/g, ' ');
}

function AttachDialog({
  claim,
  onClose,
  onSubmit,
}: {
  claim: Claim;
  onClose: () => void;
  onSubmit: (evidenceRefId: string, quote: string) => Promise<void>;
}) {
  const { view } = useCase();
  const [refId, setRefId] = useState(view.evidence[0]?.id ?? '');
  const [quote, setQuote] = useState('');
  const ref = view.evidence.find((e) => e.id === refId);
  const found = ref
    ? ref.body.replace(/\s+/g, ' ').toLowerCase().includes(quote.trim().replace(/\s+/g, ' ').toLowerCase())
    : false;
  return (
    <RationaleDialog
      title="Attach evidence to claim"
      submitLabel="Attach and verify"
      withoutRationale
      validate={() =>
        !refId
          ? 'Choose an evidence section'
          : quote.trim().length < 3
            ? 'Quote needs at least 3 characters'
            : !found
              ? 'Quote must appear verbatim in the selected section'
              : null
      }
      onClose={onClose}
      onSubmit={() => onSubmit(refId, quote.trim())}
    >
      <p className="muted">“{claim.text}”</p>
      {view.evidence.length === 0 ? (
        <div className="error-text">
          No retrieved evidence to attach. Re-run the pipeline after adding documents.
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="evidence-ref">Evidence section</label>
            <select
              id="evidence-ref"
              className="select"
              value={refId}
              onChange={(e) => setRefId(e.target.value)}
            >
              {view.evidence.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.policy_id} {e.section_ref} — {e.title ?? ''} ({dimensionLabel(e.dimension)})
                </option>
              ))}
            </select>
          </div>
          {ref && (
            <div className="field">
              <span className="field-label">Section text (select the passage to quote)</span>
              <div className="formula" style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {ref.body}
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="quote">Quote* (verbatim)</label>
            <textarea
              id="quote"
              className="textarea"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              data-testid="quote-input"
            />
            <div className={`hint ${quote.trim().length >= 3 && !found ? 'error-text' : ''}`}>
              {quote.trim().length >= 3
                ? found
                  ? '✓ Quote found in section'
                  : '✗ Quote not found in section'
                : 'The grounding verifier checks the quote exists in the section.'}
            </div>
          </div>
        </>
      )}
    </RationaleDialog>
  );
}
