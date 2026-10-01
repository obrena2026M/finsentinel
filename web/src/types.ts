// API read-model types mirrored from src/services/*.ts (the Fastify API is the contract).

export type Role = 'product_owner' | 'analyst' | 'committee' | 'admin';

export type CaseState =
  | 'SUBMITTED'
  | 'ASSESSMENT'
  | 'ANALYST_REVIEW'
  | 'INFO_REQUESTED'
  | 'COMMITTEE_REVIEW'
  | 'DECIDED'
  | 'CLOSED';

export type DecisionType = 'APPROVE' | 'APPROVE_WITH_CONDITIONS' | 'DEFER' | 'REJECT';

export type Verdict = 'SUPPORTED' | 'UNSUPPORTED' | 'WEAK';

export type ControlRating = 'none' | 'weak' | 'adequate' | 'strong' | 'unverified';

export type StepName =
  | 'parse'
  | 'extract'
  | 'merge_contradict'
  | 'missing_info'
  | 'scope'
  | 'retrieve'
  | 'assess'
  | 'ground'
  | 'score'
  | 'packet';

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type AuthUser = {
  username: string;
  display_name: string;
  role: Role;
  role_label: string;
  role_description: string;
};

export type Me = {
  id: string;
  username: string;
  role: Role;
  display_name: string;
  role_label: string;
};

export type CaseListRow = {
  id: string;
  ref: string;
  title: string;
  change_type: string;
  state: CaseState;
  residual_band: string | null;
  residual_score: number | null;
  pipeline: { status: string; done: number; total: number } | null;
  open_info_requests: number;
  updated_at: string;
};

export type CaseRow = {
  id: string;
  ref: string;
  title: string;
  change_type: string;
  description: string;
  state: CaseState;
  submitted_by: string;
  submitted_by_name: string;
  created_at: string;
  updated_at: string;
};

export type CaseVersions = {
  risk_model_version: string;
  policy_versions: Record<string, string>;
  prompt_versions: Record<string, string>;
  llm_models: Record<string, string>;
  frozen_at: string;
};

export type PipelineStep = {
  step: StepName;
  status: StepStatus;
  summary: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
};

export type PipelineRun = {
  id: string;
  status: string;
  gateway: string;
  started_at: string;
  finished_at: string | null;
  steps: PipelineStep[];
};

export type DocumentView = {
  id: string;
  kind: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  parse_status: 'pending' | 'parsed' | 'parse_failed';
  parse_error: string | null;
  uploaded_at: string;
};

export type DocumentFlag = {
  id: string;
  document_id: string;
  document_name: string;
  chunk_ix: number;
  flag_type: string;
  matched_text: string;
};

export type FactStatus =
  | 'extracted'
  | 'low_confidence'
  | 'confirmed'
  | 'missing'
  | 'conflicted'
  | 'resolved'
  | 'analyst_entered';

export type FactSource = {
  id: string;
  fact_id: string;
  document_id: string;
  chunk_ix: number;
  quote: string;
};

export type Fact = {
  id: string;
  case_id: string;
  field: string;
  value: unknown;
  confidence: number | null;
  status: FactStatus;
  missing_reason: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  sources: FactSource[];
};

export type ContradictionCandidate = { value: unknown; doc_id: string; chunk_ix: number; quote: string };

export type Contradiction = {
  id: string;
  case_id: string;
  field: string;
  candidates: { candidates: ContradictionCandidate[]; explanation?: string };
  detected_by: 'rule' | 'llm';
  status: 'open' | 'resolved';
  resolved_value: unknown;
  rationale: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
};

export type InfoRequest = {
  id: string;
  case_id: string;
  field: string;
  question: string;
  status: 'open' | 'answered' | 'gap_accepted';
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  accepted_rationale: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
};

export type EvidenceRef = {
  id: string;
  case_id: string;
  policy_chunk_id: string;
  dimension: string;
  bm25_score: number;
  query: string;
  rank: number;
  policy_id: string;
  policy_version: string;
  section_ref: string;
  title: string | null;
  body: string;
};

export type ClaimEvidence = {
  claim_id: string;
  evidence_ref_id: string;
  quote: string;
  quote_verified: number;
  added_by: 'ai' | 'analyst';
  section_ref: string;
  policy_id: string;
};

export type Claim = {
  id: string;
  assessment_id: string;
  dimension: string;
  text: string;
  verdict: Verdict;
  verdict_reason: string | null;
  status: 'active' | 'removed';
  evidence: ClaimEvidence[];
};

export type Assessment = {
  id: string;
  summary: string;
  narratives: Record<string, string>;
  model: string | null;
  prompt_version: string | null;
  created_at: string;
  claims: Claim[];
};

export type DimensionScore = {
  case_id: string;
  dimension: string;
  ai_recommended: number | null;
  current_score: number | null;
  control_rating: ControlRating;
  control_rationale: string | null;
  control_set_by: string | null;
  control_set_at: string | null;
};

export type Override = {
  id: string;
  case_id: string;
  dimension: string;
  previous_score: number;
  new_score: number;
  rationale: string;
  user_id: string;
  user_role: string;
  risk_model_version: string;
  created_at: string;
};

export type DimensionResult = {
  dimension: string;
  weight: number;
  score: number;
  control: ControlRating;
  effectiveness: number;
  inherent: number;
  residual: number;
};

export type Calculation = {
  id: string;
  case_id: string;
  risk_model_version: string;
  trigger: string;
  by_dimension: DimensionResult[];
  inputs: Record<string, { score: number; control: ControlRating }>;
  inherent_score: number;
  residual_score: number;
  inherent_band: string;
  residual_band: string;
  is_current: number;
  computed_at: string;
};

export type CalculationHistoryRow = {
  id: string;
  trigger: string;
  inherent_score: number;
  inherent_band: string;
  residual_score: number;
  residual_band: string;
  computed_at: string;
  risk_model_version: string;
};

export type Condition = {
  id: string;
  decision_id: string;
  text: string;
  due_date: string | null;
  owner: string | null;
};

export type Decision = {
  id: string;
  case_id: string;
  type: DecisionType;
  rationale: string;
  decided_by: string;
  decided_at: string;
  risk_calculation_id: string | null;
  conditions: Condition[];
};

export type Tokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
  byModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
  cost_usd: number;
};

export type CaseView = {
  case: CaseRow;
  versions: CaseVersions | undefined;
  pipeline: PipelineRun | null;
  documents: DocumentView[];
  flags: DocumentFlag[];
  injection_banner: string | null;
  facts: Fact[];
  contradictions: Contradiction[];
  information_requests: InfoRequest[];
  evidence: EvidenceRef[];
  assessment: Assessment | null;
  scores: DimensionScore[];
  overrides: Override[];
  calculation: Calculation | null;
  calculation_history: CalculationHistoryRow[];
  decision: Decision | undefined;
  blockers: string[];
  tokens: Tokens;
};

export type PipelineStatus = {
  running: boolean;
  state: CaseState;
  pipeline: PipelineRun | null;
  blockers: string[];
  tokens: Tokens;
};

export type IntegrityReport = { ok: boolean; count: number; firstBrokenSeq: number | null };

export type Packet = {
  case: CaseRow;
  versions: CaseVersions | undefined;
  residual: { score: number; band: string; inherent_score: number; inherent_band: string } | null;
  dimensions: DimensionResult[];
  overrides: Override[];
  unsupported_or_weak_claims: Claim[];
  evidence: Array<{ policy_id: string; section_ref: string; title: string | null; dimension: string }>;
  accepted_gaps: InfoRequest[];
  resolved_contradictions: Contradiction[];
  blockers: string[];
  decision: Decision | undefined;
  audit_integrity: IntegrityReport;
};

export type AuditEvent = {
  id: string;
  seq: number;
  case_id: string | null;
  actor_user_id: string | null;
  actor_role: string;
  actor_name: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  previous: unknown;
  next: unknown;
  reason: string | null;
  risk_model_version: string | null;
  policy_version: string | null;
  model_version: string | null;
  prompt_version: string | null;
  prev_hash: string | null;
  hash: string;
  created_at: string;
};

export type SuiteCounts = { passed: number; failed: number; skipped: number; total: number };

export type GateResult = {
  id: string;
  group: 'software' | 'ai' | 'governance';
  description: string;
  pass: boolean | null;
  actual: unknown;
  threshold: unknown;
};

export type AdversarialTest = { id: string; label: string; description: string };

export type AdversarialCheck = { name: string; pass: boolean; detail: string };

export type AdversarialResult = {
  test: AdversarialTest;
  case_id: string;
  case_ref: string;
  pipeline: { runId: string; status: 'succeeded' | 'failed'; failedStep?: string; error?: string };
  state: CaseState;
  checks: AdversarialCheck[];
  pass: boolean;
  duration_ms: number;
};

export type QualityRun = {
  id: string;
  source: string;
  git_sha: string | null;
  started_at: string;
  finished_at: string | null;
  status: 'PASS' | 'FAIL';
  summary: unknown;
};

export type Quality = {
  status: 'PASS' | 'FAIL' | 'NO_RUN';
  gates: GateResult[];
  software: { projects: Record<string, SuiteCounts> | null; e2e: Record<string, SuiteCounts> | null };
  ai: Record<string, number> | null;
  eval_file: string | null;
  tokens: unknown;
  generated_at: string;
  recent_runs: QualityRun[];
  adversarial_tests: AdversarialTest[];
};

export type Metrics = {
  generated_at: string;
  system: {
    requests_24h: number;
    p50_ms: number | null;
    p95_ms: number | null;
    errors_5xx_24h: number;
    error_rate: number | null;
    pipeline_step_failures_24h: number;
    db_ok: boolean;
    llm_gateway: string;
  };
  ai: {
    tokens_24h: { input: number; output: number; cacheRead: number; cacheWrite: number };
    cost_usd_24h: number;
    cache_hit_rate: number | null;
    llm_calls_24h: number;
    llm_failures_24h: number;
    avg_model_latency_ms: number | null;
    unsupported_claims_open: number;
    overrides_7d: number;
    ai_analyst_disagreement_rate: number | null;
  };
  business: {
    cases_by_state: Record<string, number>;
    cases_total: number;
    cases_decided: number;
    mean_minutes_to_decision: number | null;
    awaiting_info: number;
    awaiting_analyst: number;
    awaiting_committee: number;
  };
};

export type RiskModel = {
  version: string;
  scale: { min: number; max: number };
  dimensions: Array<{
    key: string;
    label: string;
    weight: number;
    keywords: string[];
    requiredFacts: string[];
  }>;
  bands: Array<{ label: string; min: number }>;
  controls: {
    ratings: { none: number; weak: number; adequate: number; strong: number };
    maxMitigation: number;
    floor: number;
    maxBandDrop: number;
    unverifiedCountsAs: string;
  };
};

export type RiskModelAdmin = {
  active: RiskModel;
  versions: Array<{ version: string; is_active: number; published_at: string; notes: string | null }>;
};

/** GET /api/samples — one sample document set per change type (synthetic content). */
export type SampleSet = {
  change_type: string;
  title: string;
  description: string;
  documents: Array<{ kind: string; name: string }>;
};
