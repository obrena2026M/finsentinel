import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { BandChip } from '../../components/BandChip.tsx';
import { ErrorText, Loading, ReasonButton, Section } from '../../components/common.tsx';
import { DimensionTable } from '../../components/DimensionTable.tsx';
import { VerdictBadge } from '../../components/VerdictBadge.tsx';
import { DECISION_TYPES, dimensionLabel, fieldLabel, MIN_RATIONALE_LENGTH } from '../../constants.ts';
import { fmtDateTime, fmtScore, fmtValue } from '../../format.ts';
import { can } from '../../rbac.ts';
import type { Decision, DecisionType, Packet } from '../../types.ts';
import { useCase } from './context.ts';

// Committee tab (UX §4.9): read-only packet; decision block only for the committee role. No auto-approve anywhere.

export function CommitteeTab() {
  const { view, me, caseId, mutate } = useCase();
  const [packet, setPacket] = useState<Packet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canSeePacket = can(me.role, 'packet.view');
  // Re-fetch the packet whenever the case state or decision changes.
  const refreshKey = `${view.case.state}:${view.decision?.id ?? ''}:${view.overrides.length}`;

  useEffect(() => {
    if (!canSeePacket) return;
    let alive = true;
    void refreshKey;
    api
      .packet(caseId)
      .then((p) => alive && setPacket(p))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [caseId, canSeePacket, refreshKey]);

  return (
    <div>
      {!canSeePacket && (
        <div className="banner banner-info">
          <span className="banner-icon" aria-hidden="true">
            ℹ
          </span>
          <div>
            The committee packet is available to analysts and committee members. Decision status is shown
            below.
          </div>
        </div>
      )}
      <ErrorText error={error} />
      {canSeePacket && !packet && !error && <Loading what="Loading packet" />}
      {packet && <PacketView packet={packet} />}

      {view.decision && <DecisionView decision={view.decision} />}

      {can(me.role, 'decision.record') && view.case.state === 'COMMITTEE_REVIEW' && (
        <DecisionBlock onSubmit={(body) => mutate(() => api.decide(caseId, body))} />
      )}
      {can(me.role, 'decision.record') && view.case.state === 'DECIDED' && (
        <Section title="Close case">
          <p className="muted">
            The decision is recorded. Closing archives the case; the audit trail is preserved.
          </p>
          <ReasonButton reason={null} onClick={() => mutate(() => api.close(caseId))} testId="close-case-btn">
            Close case
          </ReasonButton>
        </Section>
      )}
      {!view.decision && view.case.state !== 'COMMITTEE_REVIEW' && !can(me.role, 'decision.record') && (
        <div className="muted small" style={{ marginTop: 12 }}>
          {view.case.state === 'CLOSED'
            ? 'Case closed.'
            : `No decision yet. The committee can decide once the case is finalized (currently ${view.case.state}).`}
        </div>
      )}
      {view.case.state === 'COMMITTEE_REVIEW' && !can(me.role, 'decision.record') && (
        <div className="banner banner-info" style={{ marginTop: 12 }}>
          <span className="banner-icon" aria-hidden="true">
            ⚖
          </span>
          <div>Awaiting a Risk Committee decision. Only the committee role can record one.</div>
        </div>
      )}
    </div>
  );
}

function PacketView({ packet }: { packet: Packet }) {
  const { view } = useCase();
  return (
    <div>
      <Section title="Committee packet" testId="packet">
        <div className="row row-between">
          <div>
            <strong className="mono">{packet.case.ref}</strong> {packet.case.title}
            <div className="small muted">
              {packet.case.change_type.replace(/_/g, ' ')} · submitted by {packet.case.submitted_by_name} ·
              risk model v{packet.versions?.risk_model_version ?? '?'}
            </div>
          </div>
          {packet.residual ? (
            <div className="row">
              <span>
                Inherent {fmtScore(packet.residual.inherent_score)}{' '}
                <BandChip band={packet.residual.inherent_band} />
              </span>
              <span className="arrow" aria-hidden="true">
                →
              </span>
              <span>
                <strong>Residual {fmtScore(packet.residual.score)}</strong>{' '}
                <BandChip band={packet.residual.band} large />
              </span>
            </div>
          ) : (
            <BandChip band={null} large />
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className={`chip ${packet.audit_integrity.ok ? 'chip-success' : 'chip-danger'}`}>
            {packet.audit_integrity.ok ? '✓' : '✗'} Audit integrity{' '}
            {packet.audit_integrity.ok ? 'verified' : 'BROKEN'} · {packet.audit_integrity.count} events
          </span>
          <span className={`chip ${packet.blockers.length === 0 ? 'chip-success' : 'chip-warning'}`}>
            {packet.blockers.length === 0 ? '✓ No blockers' : `⚠ ${packet.blockers.length} blocker(s)`}
          </span>
          <span
            className={`chip ${packet.unsupported_or_weak_claims.length === 0 ? 'chip-success' : 'chip-warning'}`}
          >
            {packet.unsupported_or_weak_claims.length === 0
              ? '✓ All claims supported'
              : `⚠ ${packet.unsupported_or_weak_claims.length} unsupported/weak claim(s)`}
          </span>
        </div>
      </Section>

      <Section title="Dimensions">
        {packet.dimensions.length === 0 ? (
          <div className="muted">No calculation.</div>
        ) : (
          <DimensionTable
            rows={packet.dimensions}
            scores={view.scores}
            overrides={packet.overrides}
            totals={
              packet.residual
                ? {
                    inherent_score: packet.residual.inherent_score,
                    inherent_band: packet.residual.inherent_band,
                    residual_score: packet.residual.score,
                    residual_band: packet.residual.band,
                  }
                : null
            }
          />
        )}
      </Section>

      <div className="grid-2">
        <Section title={`Overrides (${packet.overrides.length})`}>
          {packet.overrides.length === 0 ? (
            <div className="muted">None.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {packet.overrides.map((o) => (
                <li key={o.id}>
                  <strong>{dimensionLabel(o.dimension)}</strong> {o.previous_score} → {o.new_score} by{' '}
                  {o.user_role} {fmtDateTime(o.created_at)} — “{o.rationale}”
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={`Unsupported / weak claims (${packet.unsupported_or_weak_claims.length})`}>
          {packet.unsupported_or_weak_claims.length === 0 ? (
            <div className="muted">None — every active claim is supported.</div>
          ) : (
            packet.unsupported_or_weak_claims.map((c) => (
              <div key={c.id} className="claim">
                <VerdictBadge verdict={c.verdict} /> <span>{c.text}</span>
              </div>
            ))
          )}
        </Section>
        <Section title={`Evidence (${packet.evidence.length})`}>
          {packet.evidence.length === 0 ? (
            <div className="muted">None.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {packet.evidence.map((e) => (
                <li key={`${e.policy_id}:${e.section_ref}:${e.dimension}`}>
                  {e.policy_id} <span className="mono">{e.section_ref}</span> {e.title ? `— ${e.title}` : ''}{' '}
                  <span className="muted small">({dimensionLabel(e.dimension)})</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={`Accepted information gaps (${packet.accepted_gaps.length})`}>
          {packet.accepted_gaps.length === 0 ? (
            <div className="muted">None.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {packet.accepted_gaps.map((g) => (
                <li key={g.id}>
                  <strong>{fieldLabel(g.field)}</strong> — “{g.accepted_rationale}”
                </li>
              ))}
            </ul>
          )}
          {packet.resolved_contradictions.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>
                Resolved contradictions ({packet.resolved_contradictions.length})
              </h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {packet.resolved_contradictions.map((c) => (
                  <li key={c.id}>
                    <strong>{fieldLabel(c.field)}</strong> = {fmtValue(c.resolved_value)} — “{c.rationale}”
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

function DecisionView({ decision }: { decision: Decision }) {
  return (
    <Section title="Decision" testId="decision-recorded">
      <div className="row">
        <span
          className={`chip chip-lg ${decision.type === 'REJECT' ? 'chip-danger' : decision.type === 'APPROVE_WITH_CONDITIONS' ? 'chip-warning' : 'chip-success'}`}
          data-testid="decision-type"
        >
          {decision.type === 'REJECT' ? '✗' : '✓'} {decision.type.replace(/_/g, ' ')}
        </span>
        <span className="muted small">{fmtDateTime(decision.decided_at)}</span>
      </div>
      <p style={{ marginTop: 10 }}>“{decision.rationale}”</p>
      {decision.conditions.length > 0 && (
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          {decision.conditions.map((c) => (
            <li key={c.id}>{c.text}</li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function DecisionBlock({
  onSubmit,
}: {
  onSubmit: (body: {
    type: DecisionType;
    rationale: string;
    conditions?: Array<{ text: string }>;
  }) => Promise<void>;
}) {
  const { me } = useCase();
  const [type, setType] = useState<DecisionType | null>(null);
  const [conditions, setConditions] = useState<string[]>(['']);
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filled = conditions.map((c) => c.trim()).filter(Boolean);
  const reason = !type
    ? 'Choose a decision'
    : type === 'APPROVE_WITH_CONDITIONS' && filled.length === 0
      ? 'Add at least one condition'
      : rationale.trim().length < MIN_RATIONALE_LENGTH
        ? `Rationale needs ${MIN_RATIONALE_LENGTH - rationale.trim().length} more character(s)`
        : null;

  const submit = async () => {
    if (reason || !type) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        type,
        rationale: rationale.trim(),
        conditions: type === 'APPROVE_WITH_CONDITIONS' ? filled.map((text) => ({ text })) : undefined,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Decision" testId="decision-block">
      <div className="radio-row" role="radiogroup" aria-label="Decision">
        {DECISION_TYPES.map((d) => (
          <label key={d.value}>
            <input
              type="radio"
              name="decision"
              value={d.value}
              checked={type === d.value}
              onChange={() => setType(d.value)}
              data-testid={`decision-${d.value}`}
            />
            <span>{d.label}</span>
          </label>
        ))}
      </div>
      {type === 'APPROVE_WITH_CONDITIONS' && (
        <div className="field" style={{ marginTop: 12 }}>
          <span className="field-label" id="conditions-label">
            Conditions*
          </span>
          <div className="stack">
            {conditions.map((c, i) => (
              // Index keys are intentional: conditions are positional, editable text rows.
              // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
              <div key={i} className="row">
                <span className="muted">{i + 1}.</span>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={c}
                  onChange={(e) => setConditions((cs) => cs.map((x, ix) => (ix === i ? e.target.value : x)))}
                  data-testid={`condition-${i}`}
                  placeholder="e.g. Complete vendor sanctions control testing before launch"
                />
                {conditions.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setConditions((cs) => cs.filter((_, ix) => ix !== i))}
                    aria-label={`Remove condition ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setConditions((cs) => [...cs, ''])}
              data-testid="add-condition"
            >
              + condition
            </button>
          </div>
        </div>
      )}
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="decision-rationale">
          Rationale* <span className="hint">(min {MIN_RATIONALE_LENGTH} chars)</span>
        </label>
        <textarea
          id="decision-rationale"
          className="textarea"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          data-testid="rationale-input"
        />
      </div>
      {type === 'DEFER' && (
        <p className="small muted">
          Defer returns the case to Analyst review; no decision row is stored, the deferral is recorded in
          history.
        </p>
      )}
      <ErrorText error={error} />
      <div className="row" style={{ marginTop: 8 }}>
        <span className="muted small">
          Deciding as {me.username} · {me.role_label}
        </span>
        <ReasonButton reason={reason} onClick={submit} busy={busy} testId="record-decision-btn">
          Record decision
        </ReasonButton>
      </div>
    </Section>
  );
}
