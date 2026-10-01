import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parseRiskModel, RiskModelValidationError } from '../../src/domain/risk-model-schema.ts';

const base = JSON.parse(readFileSync(new URL('../../config/risk-model.v1.0.json', import.meta.url), 'utf8'));

test.describe('risk model validation (FR-RSK-05)', () => {
  test('test_weights_equal_100_percent: v1.0 config is valid', () => {
    const m = parseRiskModel(base);
    expect(m.dimensions.reduce((s, d) => s + d.weight, 0)).toBe(100);
  });

  test('rejects weights not totalling 100', () => {
    const bad = structuredClone(base);
    bad.dimensions[0].weight += 5;
    expect(() => parseRiskModel(bad)).toThrow(RiskModelValidationError);
    expect(() => parseRiskModel(bad)).toThrow(/weights must total 100/);
  });

  test('test_missing_dimension_rejected', () => {
    const bad = structuredClone(base);
    bad.dimensions.pop();
    expect(() => parseRiskModel(bad)).toThrow(RiskModelValidationError);
  });

  test('rejects invalid score range', () => {
    const bad = structuredClone(base);
    bad.scale.max = 10;
    expect(() => parseRiskModel(bad)).toThrow(RiskModelValidationError);
  });

  test('rejects missing control factor', () => {
    const bad = structuredClone(base);
    delete bad.controls.ratings.strong;
    expect(() => parseRiskModel(bad)).toThrow(RiskModelValidationError);
  });

  test('rejects non-ascending bands', () => {
    const bad = structuredClone(base);
    bad.bands[2].min = 1.2;
    expect(() => parseRiskModel(bad)).toThrow(RiskModelValidationError);
  });
});
