import { z } from 'zod';

// FR-RSK-04/05, Architecture §8.1. Validation failures throw on load and on admin publish.

export const DIMENSION_KEYS = [
  'product',
  'customer',
  'geography',
  'channel',
  'transaction',
  'third_party',
  'technology',
  'process',
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const CONTROL_RATINGS = ['none', 'weak', 'adequate', 'strong'] as const;
export type ControlRating = (typeof CONTROL_RATINGS)[number];
/** 'unverified' = control asserted (e.g. by a vendor) but not verified by an analyst → counts as 'none'. */
export type ControlRatingOrUnverified = ControlRating | 'unverified';

export const RiskModelSchema = z
  .object({
    version: z.string().min(1),
    scale: z.object({ min: z.literal(1), max: z.literal(5) }),
    dimensions: z
      .array(
        z.object({
          key: z.enum(DIMENSION_KEYS),
          label: z.string().min(1),
          weight: z.number().min(0).max(100),
          keywords: z.array(z.string()).min(1),
          requiredFacts: z.array(z.string()),
        }),
      )
      .length(8),
    bands: z
      .array(z.object({ label: z.string().min(1), min: z.number() }))
      .min(2)
      .refine((b) => b.every((x, i) => i === 0 || x.min > b[i - 1]!.min), {
        message: 'bands must be strictly ascending',
      }),
    controls: z.object({
      ratings: z.object({
        none: z.literal(0),
        weak: z.number().min(0).max(1),
        adequate: z.number().min(0).max(1),
        strong: z.number().min(0).max(1),
      }),
      maxMitigation: z.number().min(0).max(0.75),
      floor: z.number().min(1),
      maxBandDrop: z.number().int().min(0),
      unverifiedCountsAs: z.literal('none'),
    }),
  })
  .superRefine((m, ctx) => {
    const sum = m.dimensions.reduce((s, d) => s + d.weight, 0);
    if (Math.abs(sum - 100) > 1e-9) {
      ctx.addIssue({ code: 'custom', message: `weights must total 100 (got ${sum})`, path: ['dimensions'] });
    }
    const keys = new Set(m.dimensions.map((d) => d.key));
    for (const k of DIMENSION_KEYS) {
      if (!keys.has(k))
        ctx.addIssue({ code: 'custom', message: `missing dimension ${k}`, path: ['dimensions'] });
    }
    const r = m.controls.ratings;
    if (!(r.weak <= r.adequate && r.adequate <= r.strong)) {
      ctx.addIssue({
        code: 'custom',
        message: 'control ratings must be non-decreasing weak ≤ adequate ≤ strong',
        path: ['controls', 'ratings'],
      });
    }
    if (m.bands[0]!.min !== m.scale.min) {
      ctx.addIssue({ code: 'custom', message: 'first band must start at scale.min', path: ['bands'] });
    }
  });

export type RiskModel = z.infer<typeof RiskModelSchema>;

export class RiskModelValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(`Invalid risk model: ${issues.join('; ')}`);
    this.name = 'RiskModelValidationError';
    this.issues = issues;
  }
}

export function parseRiskModel(input: unknown): RiskModel {
  const r = RiskModelSchema.safeParse(input);
  if (!r.success) {
    throw new RiskModelValidationError(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return r.data;
}
