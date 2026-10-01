import type { CaseState, ControlRating, DecisionType, StepName } from './types.ts';

// Domain constants mirrored from src/ (the API validates; these drive labels and pickers only).

export const MIN_RATIONALE_LENGTH = 20;

export const CHANGE_TYPES = [
  'product',
  'feature',
  'process',
  'vendor',
  'geography',
  'customer_segment',
  'channel',
  'transaction',
] as const;

export const DOC_KINDS: Array<{ value: string; label: string }> = [
  { value: 'product_proposal', label: 'Product proposal' },
  { value: 'vendor_questionnaire', label: 'Vendor questionnaire' },
  { value: 'process_doc', label: 'Process document' },
  { value: 'other', label: 'Other' },
];

export const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.md', '.txt'];

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

export const DIMENSION_LABELS: Record<string, string> = {
  product: 'Product',
  customer: 'Customer',
  geography: 'Geography',
  channel: 'Channel',
  transaction: 'Transaction',
  third_party: 'Third party',
  technology: 'Technology',
  process: 'Process',
};

export const CONTROL_RATINGS: ControlRating[] = ['none', 'weak', 'adequate', 'strong', 'unverified'];

export const STEP_LABELS: Record<StepName, string> = {
  parse: 'Parse',
  extract: 'Extract',
  merge_contradict: 'Contradictions',
  missing_info: 'Missing info',
  scope: 'Scope',
  retrieve: 'Retrieve',
  assess: 'Assess',
  ground: 'Ground',
  score: 'Score',
  packet: 'Packet',
};

export const STATE_LABELS: Record<CaseState, string> = {
  SUBMITTED: 'Submitted',
  ASSESSMENT: 'Assessment',
  ANALYST_REVIEW: 'Analyst review',
  INFO_REQUESTED: 'Info requested',
  COMMITTEE_REVIEW: 'Committee review',
  DECIDED: 'Decided',
  CLOSED: 'Closed',
};

export const DECISION_TYPES: Array<{ value: DecisionType; label: string }> = [
  { value: 'APPROVE', label: 'Approve' },
  { value: 'APPROVE_WITH_CONDITIONS', label: 'Approve with conditions' },
  { value: 'DEFER', label: 'Defer' },
  { value: 'REJECT', label: 'Reject' },
];

export const SCORE_LABELS: Record<number, string> = {
  1: 'Very Low',
  2: 'Low',
  3: 'Moderate',
  4: 'High',
  5: 'Very High',
};

export function dimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? key.replace(/_/g, ' ');
}

export function fieldLabel(field: string): string {
  const s = field.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
