import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { bandFor, calculateRisk, RiskEngineError, residualFor } from '../../src/domain/risk-engine.ts';
import { type DimensionKey, parseRiskModel } from '../../src/domain/risk-model-schema.ts';

const model = parseRiskModel(
  JSON.parse(readFileSync(new URL('../../config/risk-model.v1.0.json', import.meta.url), 'utf8')),
);

const allDims = (score: number, control: 'none' | 'weak' | 'adequate' | 'strong' | 'unverified') =>
  Object.fromEntries(model.dimensions.map((d) => [d.key, { score, control }])) as Record<
    DimensionKey,
    { score: number; control: typeof control }
  >;

test.describe('risk engine (FR-RSK, PR-05)', () => {
  test('test_high_product_risk: all 4 + no control → High, deterministic', () => {
    const a = calculateRisk(model, allDims(4, 'none'));
    const b = calculateRisk(model, allDims(4, 'none'));
    expect(a.inherentScore).toBe(4);
    expect(a.residualScore).toBe(4);
    expect(a.inherentBand).toBe('High');
    expect(a).toEqual(b);
  });

  test('test_invalid_score_rejected', () => {
    expect(() => residualFor(model, 0, 'none')).toThrow(RiskEngineError);
    expect(() => residualFor(model, 6, 'none')).toThrow(RiskEngineError);
    expect(() => residualFor(model, 2.5, 'none')).toThrow(RiskEngineError);
  });

  test('test_control_reduces_residual_risk: strong < adequate < weak < none', () => {
    const none = residualFor(model, 4, 'none');
    const weak = residualFor(model, 4, 'weak');
    const adequate = residualFor(model, 4, 'adequate');
    const strong = residualFor(model, 4, 'strong');
    expect(none).toBe(4);
    expect(weak).toBeLessThan(none);
    expect(adequate).toBeLessThan(weak);
    expect(strong).toBeLessThan(adequate);
  });

  test('test_control_cannot_eliminate_inherent_risk (TEST-012): HIGH + STRONG never reaches floor/No Risk', () => {
    const r = residualFor(model, 4, 'strong');
    // 4 − (4−1)×0.9×0.5 = 2.65 → Moderate
    expect(r).toBe(2.65);
    expect(bandFor(model, r)).toBe('Moderate');
    expect(r).toBeGreaterThan(model.controls.floor);
    for (const s of [1, 2, 3, 4, 5]) {
      expect(residualFor(model, s, 'strong')).toBeGreaterThanOrEqual(model.controls.floor);
      expect(residualFor(model, s, 'strong')).toBeLessThanOrEqual(s);
    }
  });

  test('unverified control counts as none (FR-ADV-04 / §7 grounding)', () => {
    expect(residualFor(model, 4, 'unverified')).toBe(residualFor(model, 4, 'none'));
  });

  test('maxBandDrop caps the reduction to 2 bands', () => {
    // 5 (Very High) with strong: 5 − 4×0.9×0.5 = 3.2 → High (one band drop) — within cap
    expect(residualFor(model, 5, 'strong')).toBe(3.2);
    // Force a stronger model to check the cap engages
    const aggressive = parseRiskModel({
      ...model,
      controls: {
        ...model.controls,
        maxMitigation: 0.75,
        ratings: { none: 0, weak: 0.5, adequate: 0.8, strong: 1 },
      },
    });
    // 5 − 4×1×0.75 = 2.0 → Low would be a 3-band drop; capped at Moderate min 2.5
    expect(residualFor(aggressive, 5, 'strong')).toBe(2.5);
  });

  test('boundary tests come from the configured model (FR-RSK-06)', () => {
    const cases: Array<[number, string]> = [
      [1.49, 'Very Low'],
      [1.5, 'Low'],
      [2.49, 'Low'],
      [2.5, 'Moderate'],
      [3.49, 'Moderate'],
      [3.5, 'High'],
      [4.49, 'High'],
      [4.5, 'Very High'],
    ];
    for (const [v, band] of cases) expect(bandFor(model, v), `value ${v}`).toBe(band);
  });

  test('weighted aggregation and 4-dp rounding', () => {
    const inputs = allDims(3, 'none');
    inputs.geography = { score: 5, control: 'none' };
    const r = calculateRisk(model, inputs);
    // 3 everywhere except geography (weight 20) at 5: 3 + 0.2×2 = 3.4
    expect(r.inherentScore).toBe(3.4);
    expect(r.inherentBand).toBe('Moderate');
  });

  test('missing dimension input is rejected', () => {
    const inputs = allDims(3, 'none') as Partial<Record<DimensionKey, { score: number; control: 'none' }>>;
    delete inputs.process;
    expect(() => calculateRisk(model, inputs as never)).toThrow(RiskEngineError);
  });
});
