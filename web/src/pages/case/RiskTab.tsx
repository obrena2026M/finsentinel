import { useState } from 'react';
import { api } from '../../api.ts';
import { Section } from '../../components/common.tsx';
import { DimensionTable } from '../../components/DimensionTable.tsx';
import { RationaleDialog } from '../../components/RationaleDialog.tsx';
import { CONTROL_RATINGS, dimensionLabel, SCORE_LABELS } from '../../constants.ts';
import { fmtDateTime, fmtScore } from '../../format.ts';
import { can } from '../../rbac.ts';
import type { ControlRating } from '../../types.ts';
import { useCase } from './context.ts';

// Risk tab (UX §4.8): the demo centrepiece. Rules calculate; humans override with rationale.

export function RiskTab() {
  const { view, me, caseId, mutate } = useCase();
  const [override, setOverride] = useState<string | null>(null);
  const [control, setControl] = useState<string | null>(null);
  const [showFormula, setShowFormula] = useState(false);
  const calc = view.calculation;
  const modelVersion = calc?.risk_model_version ?? view.versions?.risk_model_version ?? '?';

  if (!calc) {
    return (
      <div className="empty" data-testid="no-calculation">
        No risk calculation yet.{' '}
        {view.scores.length === 0
          ? 'Run the pipeline to obtain AI-recommended scores; the rules engine then calculates inherent and residual risk.'
          : 'Scores exist but no calculation was produced — re-run the pipeline or set a control rating to trigger recalculation.'}
      </div>
    );
  }

  const canOverride =
    can(me.role, 'override.create') && view.case.state !== 'DECIDED' && view.case.state !== 'CLOSED';
  const canControl =
    can(me.role, 'control.set') && view.case.state !== 'DECIDED' && view.case.state !== 'CLOSED';
  const dimScore = (d: string) => view.scores.find((s) => s.dimension === d);

  return (
    <div>
      <Section
        title="Risk"
        testId="risk-table"
        right={
          <span className="small muted">
            Risk model v{modelVersion} · Calculation #{view.calculation_history.length} (
            {calc.trigger.replace(/_/g, ' ')}, {fmtDateTime(calc.computed_at)})
          </span>
        }
      >
        <div className="row small muted" style={{ marginBottom: 8 }}>
          <span className="chip chip-ai">✦ AI prepared</span>
          <span className="chip chip-info">✎ Human decided</span>
          <span className="chip chip-success">Σ Rules calculated</span>
        </div>
        <DimensionTable
          rows={calc.by_dimension}
          scores={view.scores}
          overrides={view.overrides}
          totals={calc}
          onOverride={canOverride ? setOverride : undefined}
          onSetControl={canControl ? setControl : undefined}
        />
        <p className="muted small" style={{ marginTop: 8 }}>
          Controls reduce but never eliminate risk (floor {calc.by_dimension.length ? '1.00' : '—'}, residual
          ≤ inherent). Unverified controls count as none.
        </p>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setShowFormula((s) => !s)}
          aria-expanded={showFormula}
          data-testid="show-formula-btn"
        >
          {showFormula ? 'Hide formula' : 'Show formula'}
        </button>
        {showFormula && (
          <div className="formula" style={{ marginTop: 10 }} data-testid="formula">
            <div>
              <strong>Per dimension</strong> (all arithmetic rounded to 4 dp):
            </div>
            <code>
              residual = max(score − (score − floor) × effectiveness × maxMitigation, floor, bandFloor(score,
              maxBandDrop)); residual ≤ score
            </code>
            <div style={{ marginTop: 8 }}>
              <strong>Totals</strong>: <code>inherent = Σ(score × weight) / 100</code> ·{' '}
              <code>residual = Σ(residual × weight) / 100</code> · band = highest band whose min ≤ value
            </div>
            <table className="table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Dimension</th>
                  <th className="num">score</th>
                  <th>control → eff.</th>
                  <th className="num">residual</th>
                  <th className="num">× weight</th>
                  <th className="num">inherent contrib.</th>
                  <th className="num">residual contrib.</th>
                </tr>
              </thead>
              <tbody>
                {calc.by_dimension.map((d) => (
                  <tr key={d.dimension}>
                    <td>{dimensionLabel(d.dimension)}</td>
                    <td className="num">{d.score}</td>
                    <td>
                      {d.control} → {d.effectiveness.toFixed(2)}
                    </td>
                    <td className="num">{d.residual.toFixed(4)}</td>
                    <td className="num">{d.weight}%</td>
                    <td className="num">{((d.inherent * d.weight) / 100).toFixed(4)}</td>
                    <td className="num">{((d.residual * d.weight) / 100).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total</td>
                  <td className="num">
                    {fmtScore(calc.inherent_score)} {calc.inherent_band}
                  </td>
                  <td className="num">
                    {fmtScore(calc.residual_score)} {calc.residual_band}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>

      <div className="grid-2">
        <Section title={`Overrides (${view.overrides.length})`} testId="overrides-list">
          {view.overrides.length === 0 ? (
            <div className="muted">No overrides. Current scores equal the AI recommendation.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Dimension</th>
                  <th>Change</th>
                  <th>By</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {view.overrides.map((o) => (
                  <tr key={o.id}>
                    <td className="small">{fmtDateTime(o.created_at)}</td>
                    <td>{dimensionLabel(o.dimension)}</td>
                    <td>
                      {o.previous_score} → <strong>{o.new_score}</strong>
                    </td>
                    <td className="small muted">{o.user_role}</td>
                    <td className="small">“{o.rationale}”</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title={`Calculation history (${view.calculation_history.length})`}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>When</th>
                <th>Trigger</th>
                <th className="num">Inherent</th>
                <th className="num">Residual</th>
              </tr>
            </thead>
            <tbody>
              {view.calculation_history.map((h, i) => (
                <tr key={h.id}>
                  <td className="muted">{i + 1}</td>
                  <td className="small">{fmtDateTime(h.computed_at)}</td>
                  <td>{h.trigger.replace(/_/g, ' ')}</td>
                  <td className="num">
                    {fmtScore(h.inherent_score)} {h.inherent_band}
                  </td>
                  <td className="num">
                    {fmtScore(h.residual_score)} {h.residual_band}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      {override && (
        <OverrideDialog
          dimension={override}
          ai={dimScore(override)?.ai_recommended ?? null}
          current={
            dimScore(override)?.current_score ??
            calc.by_dimension.find((d) => d.dimension === override)?.score ??
            null
          }
          modelVersion={modelVersion}
          onClose={() => setOverride(null)}
          onSubmit={(newScore, rationale) =>
            mutate(() => api.override(caseId, { dimension: override, new_score: newScore, rationale }))
          }
        />
      )}
      {control && (
        <ControlDialog
          dimension={control}
          current={dimScore(control)?.control_rating ?? 'unverified'}
          modelVersion={modelVersion}
          onClose={() => setControl(null)}
          onSubmit={(rating, rationale) =>
            mutate(() => api.setControl(caseId, control, { rating, rationale }))
          }
        />
      )}
    </div>
  );
}

function OverrideDialog({
  dimension,
  ai,
  current,
  modelVersion,
  onClose,
  onSubmit,
}: {
  dimension: string;
  ai: number | null;
  current: number | null;
  modelVersion: string;
  onClose: () => void;
  onSubmit: (newScore: number, rationale: string) => Promise<void>;
}) {
  const [score, setScore] = useState<number | null>(null);
  return (
    <RationaleDialog
      title={`Override — ${dimensionLabel(dimension)}`}
      submitLabel="Save override"
      contextLine={`risk model v${modelVersion}`}
      validate={() =>
        score === null ? 'Choose a new score' : score === current ? 'New score equals current score' : null
      }
      onClose={onClose}
      onSubmit={(rationale) => onSubmit(score!, rationale)}
    >
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="chip chip-ai">
          ✦ AI recommended: {ai === null ? '—' : `${ai} ${SCORE_LABELS[ai] ?? ''}`}
        </span>
        <span className="chip chip-neutral">
          Current: {current === null ? '—' : `${current} ${SCORE_LABELS[current] ?? ''}`}
        </span>
      </div>
      <div className="field">
        <span className="field-label">New score*</span>
        <div className="radio-row" role="radiogroup" aria-label="New score">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n}>
              <input
                type="radio"
                name="new-score"
                value={n}
                checked={score === n}
                onChange={() => setScore(n)}
                data-testid={`score-${n}`}
              />
              <span>
                {n} {SCORE_LABELS[n]}
              </span>
            </label>
          ))}
        </div>
      </div>
    </RationaleDialog>
  );
}

function ControlDialog({
  dimension,
  current,
  modelVersion,
  onClose,
  onSubmit,
}: {
  dimension: string;
  current: ControlRating;
  modelVersion: string;
  onClose: () => void;
  onSubmit: (rating: string, rationale: string) => Promise<void>;
}) {
  const [rating, setRating] = useState<ControlRating>(current);
  const desc: Record<ControlRating, string> = {
    none: 'No mitigating control',
    weak: 'Control exists but limited coverage or untested',
    adequate: 'Control designed and operating, evidence available',
    strong: 'Control tested, monitored and independently assured',
    unverified: 'Asserted (e.g. by vendor) but not verified — counts as none',
  };
  return (
    <RationaleDialog
      title={`Control rating — ${dimensionLabel(dimension)}`}
      submitLabel="Save rating"
      contextLine={`risk model v${modelVersion}`}
      validate={() => (rating === current ? 'Choose a different rating' : null)}
      onClose={onClose}
      onSubmit={(rationale) => onSubmit(rating, rationale)}
    >
      <div className="field">
        <span className="field-label">Rating* (current: {current})</span>
        <div className="radio-stack" role="radiogroup" aria-label="Control rating">
          {CONTROL_RATINGS.map((r) => (
            <label key={r}>
              <input
                type="radio"
                name="rating"
                value={r}
                checked={rating === r}
                onChange={() => setRating(r)}
                data-testid={`rating-${r}`}
              />
              <span>
                <strong>{r}</strong> <span className="small muted">— {desc[r]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </RationaleDialog>
  );
}
