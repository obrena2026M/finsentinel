import type { RiskModel } from '../domain/risk-model-schema.ts';
import type { MergedFact } from './merge.ts';
import type { FactField } from './schemas/index.ts';

// Step 4 — deterministic missing-information detection (FR-MIS-01..03). Never invents values.

const QUESTIONS: Record<string, string> = {
  product_description:
    'Please describe the product or change in detail, including what is new versus existing.',
  customer_segment: 'Which customer segment(s) will use this (e.g. retail, SMB, commercial, wealth)?',
  geographies: 'In which countries or jurisdictions will this operate or send/receive funds?',
  channel: 'Through which channel(s) is this delivered (API, mobile, branch, web, partner)?',
  transaction_volume: 'What is the expected monthly transaction volume (count)?',
  transaction_value: 'What is the expected average and maximum transaction value?',
  transaction_velocity: 'What limits exist on transaction frequency or velocity per customer?',
  transaction_type: 'What transaction types are supported (e.g. instant payment, wire, card)?',
  third_party: 'Is a third party or vendor involved in delivering this? If so, who and in what role?',
  third_party_name: 'Please name the third party / vendor.',
  controls: 'What financial-crime controls apply (KYC, screening, transaction monitoring, limits)?',
  technology: 'What technology or platform changes are involved?',
  process_change: 'What operational or process changes are involved?',
  monitoring_coverage: 'Is this activity covered by existing transaction monitoring? Which scenarios/rules?',
};

export type InformationRequestDraft = { field: FactField; question: string; required: boolean };

export function detectMissing(model: RiskModel, facts: MergedFact[]): InformationRequestDraft[] {
  const required = new Set<string>(model.dimensions.flatMap((d) => d.requiredFacts));
  const present = new Map(facts.map((f) => [f.field, f]));
  const out: InformationRequestDraft[] = [];
  for (const field of required) {
    const f = present.get(field as FactField);
    if (!f || f.value === null) {
      out.push({
        field: field as FactField,
        question: QUESTIONS[field] ?? `Please provide ${field}.`,
        required: true,
      });
    }
  }
  return out;
}
