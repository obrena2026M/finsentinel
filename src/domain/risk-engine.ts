import type { ControlRatingOrUnverified, DimensionKey, RiskModel } from './risk-model-schema.ts';

// Deterministic risk engine — FR-RSK-01..11, PR-05, Architecture §8.2.
// Pure functions, no I/O. All arithmetic rounded to 4 dp for reproducibility.

export type DimensionInput = {
  score: number; // 1..5 integer
  control: ControlRatingOrUnverified;
};

export type DimensionResult = {
  dimension: DimensionKey;
  weight: number;
  score: number;
  control: ControlRatingOrUnverified;
  effectiveness: number;
  inherent: number;
  residual: number;
};

export type RiskCalculation = {
  riskModelVersion: string;
  byDimension: DimensionResult[];
  inherentScore: number;
  residualScore: number;
  inherentBand: string;
  residualBand: string;
};

export class RiskEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiskEngineError';
  }
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export function bandFor(model: RiskModel, value: number): string {
  let label = model.bands[0]!.label;
  for (const b of model.bands) {
    if (value >= b.min) label = b.label;
  }
  return label;
}

function bandIndex(model: RiskModel, value: number): number {
  let idx = 0;
  model.bands.forEach((b, i) => {
    if (value >= b.min) idx = i;
  });
  return idx;
}

/** Lowest value allowed after dropping at most `maxBandDrop` bands from the band of `score`. */
function bandFloor(model: RiskModel, score: number, maxBandDrop: number): number {
  const idx = bandIndex(model, score);
  const target = Math.max(0, idx - maxBandDrop);
  return model.bands[target]!.min;
}

export function effectivenessFor(model: RiskModel, control: ControlRatingOrUnverified): number {
  if (control === 'unverified') return model.controls.ratings[model.controls.unverifiedCountsAs];
  return model.controls.ratings[control];
}

export function validateScore(model: RiskModel, score: number): void {
  if (!Number.isInteger(score) || score < model.scale.min || score > model.scale.max) {
    throw new RiskEngineError(`score ${score} outside scale ${model.scale.min}..${model.scale.max}`);
  }
}

export function residualFor(model: RiskModel, score: number, control: ControlRatingOrUnverified): number {
  validateScore(model, score);
  const e = effectivenessFor(model, control);
  const { floor, maxMitigation, maxBandDrop } = model.controls;
  let residual = score - (score - floor) * e * maxMitigation;
  residual = Math.max(residual, floor);
  residual = Math.max(residual, bandFloor(model, score, maxBandDrop));
  return round4(Math.min(residual, score));
}

export function calculateRisk(
  model: RiskModel,
  inputs: Record<DimensionKey, DimensionInput>,
): RiskCalculation {
  const byDimension: DimensionResult[] = model.dimensions.map((d) => {
    const input = inputs[d.key];
    if (!input) throw new RiskEngineError(`missing input for dimension ${d.key}`);
    validateScore(model, input.score);
    const effectiveness = effectivenessFor(model, input.control);
    return {
      dimension: d.key,
      weight: d.weight,
      score: input.score,
      control: input.control,
      effectiveness,
      inherent: input.score,
      residual: residualFor(model, input.score, input.control),
    };
  });

  const inherentScore = round4(byDimension.reduce((s, r) => s + r.inherent * r.weight, 0) / 100);
  const residualScore = round4(byDimension.reduce((s, r) => s + r.residual * r.weight, 0) / 100);

  return {
    riskModelVersion: model.version,
    byDimension,
    inherentScore,
    residualScore,
    inherentBand: bandFor(model, inherentScore),
    residualBand: bandFor(model, residualScore),
  };
}
