import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, errorMessage } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { BandChip } from '../components/BandChip.tsx';
import { ErrorText, Loading, ReasonButton, Section } from '../components/common.tsx';
import { fmtDateTime } from '../format.ts';
import { can } from '../rbac.ts';
import { useToast } from '../toast.tsx';
import type { RiskModel, RiskModelAdmin } from '../types.ts';

// Admin — risk model (UX §4.13, FR-RSK-04/05, FR-VER-03). Guided form instead of raw JSON:
// weights, bands and controls are edited; keywords/requiredFacts/scale are copied from the active
// model untouched. Validation mirrors src/domain/risk-model-schema.ts; the server stays authoritative
// and its 400 { error: 'invalid_risk_model', issues } is shown inline.

type Draft = {
  version: string;
  weights: Record<string, number>;
  bands: Array<{ label: string; min: number }>;
  maxMitigation: number;
  weak: number;
  adequate: number;
  strong: number;
  floor: number;
  maxBandDrop: number;
};

const PREVIEW_SCORE = 4;
const RATING_HELP: Record<'weak' | 'adequate' | 'strong', string> = {
  weak: 'Weak: a control that exists but has known gaps. Fraction of the maximum mitigation it earns.',
  adequate: 'Adequate: a control that works as designed and is verified. Fraction of the maximum mitigation.',
  strong: 'Strong: a verified, tested, independently assured control. Usually earns the full maximum.',
};

function bumpVersion(v: string): string {
  const m = /^(\d+)\.(\d+)$/.exec(v);
  if (!m) return `${v}-next`;
  return `${m[1]}.${Number(m[2]) + 1}`;
}

function draftFrom(active: RiskModel): Draft {
  return {
    version: bumpVersion(active.version),
    weights: Object.fromEntries(active.dimensions.map((d) => [d.key, d.weight])),
    bands: active.bands.map((b) => ({ ...b })),
    maxMitigation: active.controls.maxMitigation,
    weak: active.controls.ratings.weak,
    adequate: active.controls.ratings.adequate,
    strong: active.controls.ratings.strong,
    floor: active.controls.floor,
    maxBandDrop: active.controls.maxBandDrop,
  };
}

/** Assemble the model to publish: active model + edited weights/bands/controls + new version. */
function buildModel(active: RiskModel, d: Draft): RiskModel {
  return {
    ...active,
    version: d.version.trim(),
    dimensions: active.dimensions.map((dim) => ({ ...dim, weight: d.weights[dim.key] ?? dim.weight })),
    bands: d.bands.map((b) => ({ label: b.label, min: b.min })),
    controls: {
      ratings: { none: 0, weak: d.weak, adequate: d.adequate, strong: d.strong },
      maxMitigation: d.maxMitigation,
      floor: d.floor,
      maxBandDrop: d.maxBandDrop,
      unverifiedCountsAs: active.controls.unverifiedCountsAs,
    },
  };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function bandFor(bands: Draft['bands'], value: number): string {
  let label = bands[0]?.label ?? '';
  for (const b of bands) if (value >= b.min) label = b.label;
  return label;
}

/** Same arithmetic as src/domain/risk-engine.ts residualFor — preview only, the server recomputes. */
function previewResidual(d: Draft, score: number, effectiveness: number): number {
  let residual = score - (score - d.floor) * effectiveness * d.maxMitigation;
  residual = Math.max(residual, d.floor);
  let idx = 0;
  d.bands.forEach((b, i) => {
    if (score >= b.min) idx = i;
  });
  const bandFloor = d.bands[Math.max(0, idx - d.maxBandDrop)]?.min ?? d.floor;
  residual = Math.max(residual, bandFloor);
  return round4(Math.min(residual, score));
}

function num(e: ChangeEvent<HTMLInputElement>, fallback = 0): number {
  const v = Number(e.target.value);
  return Number.isFinite(v) ? v : fallback;
}

export function AdminRiskModelPage() {
  const { me } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<RiskModelAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const load = useCallback(
    () =>
      api
        .riskModel()
        .then((d) => {
          setData(d);
          setDraft(draftFrom(d.active));
        })
        .catch((e) => setError(errorMessage(e))),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = can(me?.role, 'risk_model.publish');

  const weightTotal = useMemo(
    () => (draft ? Object.values(draft.weights).reduce((s, w) => s + (Number.isFinite(w) ? w : 0), 0) : 0),
    [draft],
  );
  const weightsOk = Math.abs(weightTotal - 100) < 1e-9;

  if (error) return <ErrorText error={error} />;
  if (!data || !draft) return <Loading what="Loading risk model" />;

  const active = data.active;
  const bandsAscending = draft.bands.every((b, i) => i === 0 || b.min > draft.bands[i - 1]!.min);
  const firstBandOk = draft.bands[0]?.min === active.scale.min;
  const ratingsOrdered = draft.weak <= draft.adequate && draft.adequate <= draft.strong;
  const versionExists = data.versions.some((v) => v.version === draft.version.trim());
  const reason = !weightsOk
    ? `Weights total ${weightTotal}% — must be 100%`
    : !bandsAscending
      ? 'Band minimums must ascend'
      : !firstBandOk
        ? `First band must start at ${active.scale.min}`
        : !ratingsOrdered
          ? 'Control effectiveness must satisfy weak ≤ adequate ≤ strong'
          : draft.maxMitigation < 0 || draft.maxMitigation > 0.75
            ? 'Max mitigation must be between 0% and 75%'
            : draft.floor < 1
              ? 'Floor must be at least 1'
              : !Number.isInteger(draft.maxBandDrop) || draft.maxBandDrop < 0
                ? 'Max band drop must be a whole number ≥ 0'
                : draft.version.trim().length === 0
                  ? 'Version is required'
                  : versionExists
                    ? `Version ${draft.version.trim()} already exists`
                    : notes.trim().length < 5
                      ? 'Publish notes are required (min 5 chars)'
                      : null;

  const model = buildModel(active, draft);
  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const publish = async () => {
    if (reason) return;
    setBusy(true);
    setPublishError(null);
    setIssues([]);
    try {
      const r = await api.publishRiskModel(model, notes.trim());
      toast.show(`Risk model v${r.version} published — applies to new assessments`, 'success');
      setNotes('');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.issues?.length) {
        setPublishError(e.code === 'invalid_risk_model' ? 'The server rejected this model:' : e.message);
        setIssues(e.issues);
      } else {
        setPublishError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const preview = (['strong', 'adequate', 'weak', 'none'] as const).map((r) => {
    const eff = r === 'none' ? 0 : draft[r];
    const residual = previewResidual(draft, PREVIEW_SCORE, eff);
    return { rating: r, effectiveness: eff, residual, band: bandFor(draft.bands, residual) };
  });

  const readOnlySummary = (
    <>
      <Section title={`Active version ${active.version}`} testId="active-risk-model">
        <table className="table">
          <thead>
            <tr>
              <th>Dimension</th>
              <th className="num">Weight</th>
              <th>Required facts</th>
            </tr>
          </thead>
          <tbody>
            {active.dimensions.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{d.weight}%</td>
                <td className="small muted">{d.requiredFacts.join(', ')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{active.dimensions.reduce((s, d) => s + d.weight, 0)}%</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div className="small muted" style={{ marginTop: 8 }}>
          Bands: {active.bands.map((b) => `${b.label} ≥ ${b.min}`).join(' · ')}
          <br />
          Controls: none {active.controls.ratings.none} · weak {active.controls.ratings.weak} · adequate{' '}
          {active.controls.ratings.adequate} · strong {active.controls.ratings.strong} · max mitigation{' '}
          {Math.round(active.controls.maxMitigation * 100)}% · floor {active.controls.floor} · max band drop{' '}
          {active.controls.maxBandDrop}
        </div>
        <details style={{ marginTop: 10 }}>
          <summary>Active model JSON</summary>
          <pre>{JSON.stringify(active, null, 2)}</pre>
        </details>
      </Section>
      <Section title="Versions" testId="risk-model-versions">
        <table className="table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Published</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.versions.map((v) => (
              <tr key={v.version}>
                <td className="mono">{v.version}</td>
                <td className="small">{fmtDateTime(v.published_at)}</td>
                <td className="small muted">{v.notes ?? '—'}</td>
                <td>{v.is_active ? <span className="chip chip-success">● active</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );

  return (
    <div>
      <h1>Risk model</h1>
      <div className="banner banner-info" data-testid="risk-model-explainer">
        <span className="banner-icon" aria-hidden="true">
          ℹ
        </span>
        <div>
          <strong>What this is.</strong> The risk model is the rule book the deterministic engine uses.
          Publishing a new version changes how <strong>new</strong> assessments are scored. Cases already
          assessed keep the version they were scored with; their history is never rewritten.
          <div className="small muted" style={{ marginTop: 4 }}>
            Active version: <strong className="mono">{active.version}</strong> · versions published:{' '}
            {data.versions.map((v) => v.version).join(', ')}
          </div>
        </div>
      </div>

      {!isAdmin ? (
        <div className="grid-2">
          <div>{readOnlySummary}</div>
          <Section title="Publishing">
            <p className="muted">Only the FCRM Administrator can publish a new risk model version.</p>
          </Section>
        </div>
      ) : (
        <div className="grid-2">
          <div>{readOnlySummary}</div>
          <div data-testid="risk-model-editor">
            <Section
              title="Dimension weights"
              right={
                <span
                  className={`chip ${weightsOk ? 'chip-success' : 'chip-danger'}`}
                  data-testid="weights-hint"
                  data-ok={weightsOk ? 'true' : 'false'}
                >
                  <span className="chip-icon" aria-hidden="true">
                    {weightsOk ? '✓' : '✗'}
                  </span>
                  Total: {round4(weightTotal)}% (must be 100)
                </span>
              }
            >
              <p className="small muted">
                How much each dimension counts in the overall score. Keywords and required facts are kept from
                the active version.
              </p>
              <div className="weight-grid">
                {active.dimensions.map((d) => (
                  <label key={d.key} className="weight-row">
                    <span>
                      {d.label} <span className="muted small mono">({d.key})</span>
                    </span>
                    <span className="row" style={{ gap: 4 }}>
                      <input
                        type="number"
                        className="input weight-input"
                        min={0}
                        max={100}
                        step={1}
                        value={draft.weights[d.key] ?? 0}
                        onChange={(e) => update({ weights: { ...draft.weights, [d.key]: num(e) } })}
                        data-testid={`weight-${d.key}`}
                      />
                      <span className="muted">%</span>
                    </span>
                  </label>
                ))}
              </div>
            </Section>

            <Section title="Rating bands">
              <p className="small muted">
                A score maps to the highest band whose minimum it reaches. Bands must ascend; the first band
                starts at {active.scale.min}.
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Band</th>
                    <th className="num">Min value</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.bands.map((b, i) => {
                    const bad = i > 0 && b.min <= draft.bands[i - 1]!.min;
                    return (
                      <tr key={b.label}>
                        <td>
                          <BandChip band={b.label} />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            className={`input weight-input ${bad ? 'input-invalid' : ''}`}
                            step={0.1}
                            min={active.scale.min}
                            max={active.scale.max}
                            value={b.min}
                            disabled={i === 0}
                            title={i === 0 ? `First band is fixed at ${active.scale.min}` : undefined}
                            aria-label={`Minimum for ${b.label}`}
                            onChange={(e) =>
                              update({
                                bands: draft.bands.map((x, ix) =>
                                  ix === i ? { ...x, min: num(e, x.min) } : x,
                                ),
                              })
                            }
                            data-testid={`band-min-${i}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className={`hint ${bandsAscending ? '' : 'error-text'}`}>
                {bandsAscending ? 'Bands ascend ✓' : 'Bands must ascend — each minimum higher than the last'}
              </div>
            </Section>

            <Section title="Controls">
              <p className="small muted">
                Controls mitigate risk, never eliminate it: residual is always ≥ floor and ≤ inherent.
              </p>
              <div className="field">
                <label htmlFor="max-mitigation">
                  Max mitigation: <strong>{Math.round(draft.maxMitigation * 100)}%</strong>
                </label>
                <input
                  id="max-mitigation"
                  type="range"
                  min={0}
                  max={0.75}
                  step={0.05}
                  value={draft.maxMitigation}
                  onChange={(e) => update({ maxMitigation: num(e) })}
                  data-testid="max-mitigation"
                />
                <div className="hint">
                  The most a perfect control can reduce a dimension's score.{' '}
                  {Math.round(draft.maxMitigation * 100)}% means a {PREVIEW_SCORE} can become at best{' '}
                  {round4(PREVIEW_SCORE - (PREVIEW_SCORE - draft.floor) * draft.maxMitigation)} (before the
                  band-drop limit). Capped at 75%.
                </div>
              </div>

              <div className="field">
                <span className="field-label">Control rating effectiveness</span>
                <div className="hint">
                  None is fixed at 0 (an unverified control also counts as none). Each rating earns a fraction
                  of the maximum mitigation; they must not decrease from weak to strong.
                </div>
              </div>
              {(['weak', 'adequate', 'strong'] as const).map((r) => (
                <div className="field" key={r}>
                  <label htmlFor={`rating-${r}`}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}: <strong>{draft[r].toFixed(2)}</strong>
                  </label>
                  <input
                    id={`rating-${r}`}
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={draft[r]}
                    onChange={(e) => update({ [r]: num(e) } as Partial<Draft>)}
                    data-testid={`rating-${r}`}
                  />
                  <div className="hint">{RATING_HELP[r]}</div>
                </div>
              ))}
              {!ratingsOrdered && (
                <div className="error-text">Ratings must satisfy weak ≤ adequate ≤ strong</div>
              )}

              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label htmlFor="floor">Floor</label>
                  <input
                    id="floor"
                    type="number"
                    className="input"
                    min={1}
                    max={active.scale.max}
                    step={0.5}
                    value={draft.floor}
                    onChange={(e) => update({ floor: num(e, 1) })}
                    data-testid="floor"
                  />
                  <div className="hint">
                    The lowest residual any dimension can reach. Minimum 1 — risk never goes to zero.
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="max-band-drop">Max band drop</label>
                  <input
                    id="max-band-drop"
                    type="number"
                    className="input"
                    min={0}
                    max={draft.bands.length - 1}
                    step={1}
                    value={draft.maxBandDrop}
                    onChange={(e) => update({ maxBandDrop: Math.trunc(num(e)) })}
                    data-testid="max-band-drop"
                  />
                  <div className="hint">
                    How many rating bands controls can lower a dimension by, at most. 1 means High can become
                    Moderate but never Low.
                  </div>
                </div>
              </div>
            </Section>

            <Section
              title={`Preview: what a High (${PREVIEW_SCORE}) inherent score becomes`}
              testId="risk-model-preview"
            >
              <p className="small muted">
                Computed here with the same formula as the engine (residual = max(floor, score − (score −
                floor) × effectiveness × maxMitigation), limited by max band drop). Preview only — the server
                recalculates.
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Control</th>
                    <th className="num">Effectiveness</th>
                    <th className="num">Residual</th>
                    <th>Band</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.rating} data-testid={`preview-${p.rating}`}>
                      <td style={{ textTransform: 'capitalize' }}>{p.rating}</td>
                      <td className="num">{p.effectiveness.toFixed(2)}</td>
                      <td className="num">
                        <strong>{p.residual.toFixed(2)}</strong>
                      </td>
                      <td>
                        <BandChip band={p.band} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="Publish new version">
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label htmlFor="version">New version*</label>
                  <input
                    id="version"
                    className={`input mono ${versionExists ? 'input-invalid' : ''}`}
                    value={draft.version}
                    onChange={(e) => update({ version: e.target.value })}
                    data-testid="risk-model-version"
                  />
                  <div className="hint">Active is {active.version}; default bumps the minor number.</div>
                </div>
                <div className="field">
                  <label htmlFor="notes">Publish notes*</label>
                  <input
                    id="notes"
                    className="input"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Why this version changes (min 5 characters)"
                    data-testid="risk-model-notes"
                  />
                  <div className="hint">Recorded in the audit trail with the version.</div>
                </div>
              </div>
              <ErrorText error={publishError} />
              {issues.length > 0 && (
                <ul className="issue-list" data-testid="risk-model-issues">
                  {issues.map((i) => (
                    <li key={i} className="error-text">
                      {i}
                    </li>
                  ))}
                </ul>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <ReasonButton reason={reason} onClick={publish} busy={busy} testId="publish-risk-model-btn">
                  Publish new version {draft.version.trim()}
                </ReasonButton>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setDraft(draftFrom(active));
                    setIssues([]);
                    setPublishError(null);
                  }}
                  disabled={busy}
                >
                  Reset to active
                </button>
              </div>
              <details style={{ marginTop: 12 }}>
                <summary>Show JSON that will be published</summary>
                <pre data-testid="risk-model-json">{JSON.stringify(model, null, 2)}</pre>
              </details>
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
