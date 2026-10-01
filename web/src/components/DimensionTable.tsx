import { Fragment } from 'react';
import { dimensionLabel, SCORE_LABELS } from '../constants.ts';
import { fmtDateTime, fmtScore } from '../format.ts';
import type { DimensionResult, DimensionScore, Override } from '../types.ts';
import { BandChip } from './BandChip.tsx';
import { SourceLink } from './ContextPanel.tsx';

// Three-column truth (UX U1): AI recommendation · Current (human) · Control → Inherent / Residual (rules).

export type DimensionTableProps = {
  rows: DimensionResult[];
  scores: DimensionScore[];
  overrides: Override[];
  totals: {
    inherent_score: number;
    inherent_band: string;
    residual_score: number;
    residual_band: string;
  } | null;
  onOverride?: (dimension: string) => void;
  onSetControl?: (dimension: string) => void;
};

function scoreLabel(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n} ${SCORE_LABELS[n] ?? ''}`.trim();
}

export function DimensionTable(p: DimensionTableProps) {
  const latestOverride = (dim: string) => [...p.overrides].reverse().find((o) => o.dimension === dim);
  return (
    <div>
      <table className="table" aria-label="Dimension table">
        <thead>
          <tr>
            <th>Dimension</th>
            <th className="num">Weight</th>
            <th className="col-ai">AI rec.</th>
            <th className="col-human">Current</th>
            <th className="col-human">Control</th>
            <th className="num col-rules">Inherent</th>
            <th className="num col-rules">Residual</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => {
            const s = p.scores.find((x) => x.dimension === r.dimension);
            const o = latestOverride(r.dimension);
            const current = s?.current_score ?? r.score;
            const overridden =
              s &&
              s.ai_recommended !== null &&
              s.current_score !== null &&
              s.ai_recommended !== s.current_score;
            const control = s?.control_rating ?? r.control;
            return (
              <Fragment key={r.dimension}>
                <tr data-testid={`dimension-row-${r.dimension}`}>
                  <td>
                    <strong>{dimensionLabel(r.dimension)}</strong>
                  </td>
                  <td className="num">{r.weight}%</td>
                  <td className="col-ai">
                    <span className="chip chip-ai" title="AI recommendation (advisory)">
                      <span className="chip-icon" aria-hidden="true">
                        ✦
                      </span>
                      {scoreLabel(s?.ai_recommended)}
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <strong>{scoreLabel(current)}</strong>
                      {overridden && (
                        <span className="chip chip-info" title="Overridden by a human">
                          ✎ overridden
                        </span>
                      )}
                      {p.onOverride && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => p.onOverride?.(r.dimension)}
                          data-testid={`override-btn-${r.dimension}`}
                          aria-label={`Override ${dimensionLabel(r.dimension)}`}
                        >
                          ✎ Override
                        </button>
                      )}
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span>
                        {control} <span className="muted small">({r.effectiveness.toFixed(1)})</span>
                      </span>
                      {control === 'unverified' && (
                        <span
                          className="chip chip-warning"
                          title="Vendor-asserted control not verified; counts as none"
                        >
                          ⚠ set control
                        </span>
                      )}
                      {p.onSetControl && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => p.onSetControl?.(r.dimension)}
                          data-testid={`control-btn-${r.dimension}`}
                          aria-label={`Set control rating for ${dimensionLabel(r.dimension)}`}
                        >
                          Set rating
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="num">{fmtScore(r.inherent)}</td>
                  <td className="num">
                    <strong>{fmtScore(r.residual)}</strong>
                  </td>
                </tr>
                {o && (
                  <tr className="sub-row">
                    <td colSpan={7}>
                      └ Overridden {o.previous_score} → {o.new_score} by {o.user_role}{' '}
                      {fmtDateTime(o.created_at)} — “{o.rationale}”{' '}
                      <SourceLink
                        content={{
                          title: `Override — ${dimensionLabel(o.dimension)}`,
                          subtitle: `${o.user_role} · ${fmtDateTime(o.created_at)} · risk model v${o.risk_model_version}`,
                          quotes: [
                            { label: `Score ${o.previous_score} → ${o.new_score}`, quote: o.rationale },
                          ],
                        }}
                      />
                    </td>
                  </tr>
                )}
                {s?.control_rationale && (
                  <tr className="sub-row">
                    <td colSpan={7}>
                      └ Control rated “{control}” — “{s.control_rationale}”
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {p.totals && (
        <div className="totals" data-testid="risk-totals">
          <span>
            INHERENT {fmtScore(p.totals.inherent_score)} <BandChip band={p.totals.inherent_band} large />
          </span>
          <span className="arrow" aria-hidden="true">
            →
          </span>
          <span>
            RESIDUAL {fmtScore(p.totals.residual_score)} <BandChip band={p.totals.residual_band} large />
          </span>
        </div>
      )}
    </div>
  );
}
