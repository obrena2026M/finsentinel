import { z } from 'zod';
import { DIMENSION_KEYS } from '../../domain/risk-model-schema.ts';

// zod contracts for every agent output — Architecture AD-03, §5.2. Facts without provenance cannot exist.

export const FACT_FIELDS = [
  'product_description',
  'customer_segment',
  'geographies',
  'channel',
  'transaction_volume',
  'transaction_value',
  'transaction_velocity',
  'transaction_type',
  'third_party',
  'third_party_name',
  'controls',
  'technology',
  'process_change',
  'monitoring_coverage',
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export const FactSource = z.object({
  doc_id: z.string().min(1),
  chunk_ix: z.number().int().min(0),
  quote: z.string().min(1).max(300),
});

export const FactValue = z.union([z.string(), z.number(), z.array(z.string()), z.boolean()]);

export const Fact = z
  .object({
    field: z.enum(FACT_FIELDS),
    value: FactValue.nullable(),
    confidence: z.number().min(0).max(1),
    sources: z.array(FactSource),
    missing_reason: z.string().nullable(),
  })
  .refine((f) => f.value === null || f.sources.length >= 1, {
    message: 'a fact with a value must cite at least one source (PR-04)',
    path: ['sources'],
  })
  .refine((f) => f.value !== null || f.missing_reason !== null, {
    message: 'a missing fact must state missing_reason',
    path: ['missing_reason'],
  });
export type Fact = z.infer<typeof Fact>;

/** Step 2 output — one call per document. */
export const ExtractionOutput = z.object({
  doc_id: z.string().min(1),
  facts: z.array(Fact),
  instruction_like_content_detected: z.boolean(),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutput>;

/** Step 3 (LLM part): semantic contradictions across documents. */
export const ContradictionOutput = z.object({
  contradictions: z.array(
    z.object({
      field: z.enum(FACT_FIELDS),
      candidates: z
        .array(
          z.object({
            value: FactValue,
            doc_id: z.string(),
            chunk_ix: z.number().int().min(0),
            quote: z.string().max(300),
          }),
        )
        .min(2),
      explanation: z.string().max(500),
    }),
  ),
});
export type ContradictionOutput = z.infer<typeof ContradictionOutput>;

/** Step 5 output. */
export const ScopingOutput = z.object({
  dimensions: z
    .array(
      z.object({
        dimension: z.enum(DIMENSION_KEYS),
        triggered_by_fields: z.array(z.enum(FACT_FIELDS)).min(1),
        rationale: z.string().max(400),
      }),
    )
    .min(1),
});
export type ScopingOutput = z.infer<typeof ScopingOutput>;

/** Step 7 output. Claims must cite evidence chunk IDs with quotes (Architecture §7). */
export const Claim = z.object({
  dimension: z.enum(DIMENSION_KEYS),
  text: z.string().min(5).max(500),
  citations: z.array(z.object({ evidence_id: z.string().min(1), quote: z.string().min(1).max(200) })),
});
export type Claim = z.infer<typeof Claim>;

export const AssessmentOutput = z.object({
  summary: z.string().min(20).max(3000),
  dimensions: z.array(
    z.object({
      dimension: z.enum(DIMENSION_KEYS),
      recommended_score: z.number().int().min(1).max(5),
      narrative: z.string().min(10).max(2000),
    }),
  ),
  claims: z.array(Claim),
});
export type AssessmentOutput = z.infer<typeof AssessmentOutput>;

/** Step 8 optional LLM entailment pass. */
export const GroundingOutput = z.object({
  verdicts: z.array(
    z.object({ claim_index: z.number().int().min(0), supported: z.boolean(), reason: z.string().max(300) }),
  ),
});
export type GroundingOutput = z.infer<typeof GroundingOutput>;
