-- FinSentinel schema v1 — STAGE02_Design_Data_Model.md
-- Conventions: TEXT PKs (UUIDv7), ISO-8601 UTC timestamps, JSON in TEXT columns validated by zod before write.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('product_owner','analyst','committee','admin')),
  role_description TEXT NOT NULL,
  password_hash TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE risk_model_versions (
  version TEXT PRIMARY KEY,
  model_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  published_by TEXT NULL REFERENCES users(id),
  published_at TEXT NOT NULL,
  notes TEXT
);
CREATE UNIQUE INDEX ux_riskmodel_active ON risk_model_versions(is_active) WHERE is_active = 1;

CREATE TABLE policy_versions (
  policy_id TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  source_file TEXT,
  sha256 TEXT,
  published_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (policy_id, version)
);

CREATE TABLE policy_chunks (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  section_ref TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  FOREIGN KEY (policy_id, policy_version) REFERENCES policy_versions(policy_id, version)
);

CREATE VIRTUAL TABLE policy_chunks_fts USING fts5(
  title, body, content='policy_chunks', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE TRIGGER policy_chunks_ai AFTER INSERT ON policy_chunks BEGIN
  INSERT INTO policy_chunks_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER policy_chunks_ad AFTER DELETE ON policy_chunks BEGIN
  INSERT INTO policy_chunks_fts(policy_chunks_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER policy_chunks_au AFTER UPDATE ON policy_chunks BEGIN
  INSERT INTO policy_chunks_fts(policy_chunks_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO policy_chunks_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TABLE prompt_versions (
  agent TEXT NOT NULL,
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent, version)
);

-- Case core ------------------------------------------------------------------

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('product','feature','process','vendor','geography','customer_segment','channel','transaction')),
  description TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('SUBMITTED','ASSESSMENT','ANALYST_REVIEW','INFO_REQUESTED','COMMITTEE_REVIEW','DECIDED','CLOSED')),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_cases_state ON cases(state);

CREATE TABLE case_versions (
  case_id TEXT PRIMARY KEY REFERENCES cases(id),
  risk_model_version TEXT NOT NULL REFERENCES risk_model_versions(version),
  policy_versions_json TEXT NOT NULL,
  prompt_versions_json TEXT NOT NULL,
  llm_models_json TEXT NOT NULL,
  frozen_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  kind TEXT NOT NULL CHECK (kind IN ('product_proposal','vendor_questionnaire','process_doc','other')),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('pending','parsed','parse_failed')) DEFAULT 'pending',
  parse_error TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);
CREATE INDEX ix_documents_case ON documents(case_id);

CREATE TABLE document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  chunk_ix INTEGER NOT NULL,
  heading TEXT,
  page INTEGER,
  text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  UNIQUE (document_id, chunk_ix)
);
CREATE INDEX ix_chunks_doc ON document_chunks(document_id);

CREATE TABLE document_flags (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  chunk_ix INTEGER NOT NULL,
  flag_type TEXT NOT NULL CHECK (flag_type IN ('instruction_like','approval_instruction','self_assertion')),
  matched_text TEXT NOT NULL,
  pattern TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Pipeline & LLM accounting ---------------------------------------------------

CREATE TABLE pipeline_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  mode TEXT NOT NULL CHECK (mode IN ('optimized','baseline')) DEFAULT 'optimized',
  gateway TEXT NOT NULL CHECK (gateway IN ('anthropic','mock')),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','manual_continue')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  triggered_by TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE pipeline_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
  step TEXT NOT NULL CHECK (step IN ('parse','extract','merge_contradict','missing_info','scope','retrieve','assess','ground','score','packet')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  attempt INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  error_message TEXT,
  summary_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  latency_ms INTEGER,
  UNIQUE (run_id, step, attempt)
);

CREATE TABLE llm_calls (
  id TEXT PRIMARY KEY,
  step_id TEXT NULL REFERENCES pipeline_steps(id),
  case_id TEXT NULL REFERENCES cases(id),
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  effort TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','schema_invalid','http_error','timeout','empty','refusal')),
  created_at TEXT NOT NULL
);
CREATE INDEX ix_llm_case ON llm_calls(case_id);
CREATE INDEX ix_llm_created ON llm_calls(created_at);

-- Facts, contradictions, information requests --------------------------------

CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  field TEXT NOT NULL,
  value_json TEXT NULL,
  confidence REAL,
  status TEXT NOT NULL CHECK (status IN ('extracted','low_confidence','confirmed','missing','conflicted','resolved','analyst_entered')),
  missing_reason TEXT,
  confirmed_by TEXT NULL REFERENCES users(id),
  confirmed_at TEXT,
  UNIQUE (case_id, field)
);
CREATE INDEX ix_facts_case ON facts(case_id);

CREATE TABLE fact_sources (
  id TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id),
  chunk_ix INTEGER NOT NULL,
  quote TEXT NOT NULL CHECK (length(quote) <= 300)
);

CREATE TABLE contradictions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  field TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  detected_by TEXT NOT NULL CHECK (detected_by IN ('rule','llm')),
  status TEXT NOT NULL CHECK (status IN ('open','resolved')) DEFAULT 'open',
  resolved_value_json TEXT,
  rationale TEXT,
  resolved_by TEXT NULL REFERENCES users(id),
  resolved_at TEXT
);

CREATE TABLE information_requests (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  field TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','answered','gap_accepted')) DEFAULT 'open',
  answer TEXT,
  answered_by TEXT NULL REFERENCES users(id),
  answered_at TEXT,
  accepted_rationale TEXT,
  accepted_by TEXT NULL REFERENCES users(id),
  accepted_at TEXT
);

-- Evidence, assessment, claims -------------------------------------------------

CREATE TABLE evidence_refs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  policy_chunk_id TEXT NOT NULL REFERENCES policy_chunks(id),
  dimension TEXT NOT NULL,
  bm25_score REAL NOT NULL,
  query TEXT NOT NULL,
  rank INTEGER NOT NULL,
  UNIQUE (case_id, policy_chunk_id, dimension)
);
CREATE INDEX ix_evidence_case ON evidence_refs(case_id);

CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  run_id TEXT NULL REFERENCES pipeline_runs(id),
  is_current INTEGER NOT NULL DEFAULT 1,
  summary TEXT NOT NULL,
  dimension_narratives_json TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_assessment_current ON assessments(case_id) WHERE is_current = 1;

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  dimension TEXT NOT NULL,
  text TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('SUPPORTED','UNSUPPORTED','WEAK')),
  verdict_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','removed')) DEFAULT 'active'
);
CREATE INDEX ix_claims_assessment ON claims(assessment_id);

CREATE TABLE claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(id),
  evidence_ref_id TEXT NOT NULL REFERENCES evidence_refs(id),
  quote TEXT NOT NULL,
  quote_verified INTEGER NOT NULL DEFAULT 0,
  added_by TEXT NOT NULL CHECK (added_by IN ('ai','analyst')),
  PRIMARY KEY (claim_id, evidence_ref_id)
);

-- Scores, overrides, calculations ----------------------------------------------

CREATE TABLE dimension_scores (
  case_id TEXT NOT NULL REFERENCES cases(id),
  dimension TEXT NOT NULL,
  ai_recommended INTEGER NULL CHECK (ai_recommended BETWEEN 1 AND 5),
  current_score INTEGER NULL CHECK (current_score BETWEEN 1 AND 5),
  control_rating TEXT NOT NULL CHECK (control_rating IN ('none','weak','adequate','strong','unverified')) DEFAULT 'unverified',
  control_rationale TEXT,
  control_set_by TEXT NULL REFERENCES users(id),
  control_set_at TEXT,
  PRIMARY KEY (case_id, dimension)
);

CREATE TABLE overrides (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  dimension TEXT NOT NULL,
  previous_score INTEGER NOT NULL,
  new_score INTEGER NOT NULL CHECK (new_score BETWEEN 1 AND 5),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) >= 20),
  user_id TEXT NOT NULL REFERENCES users(id),
  user_role TEXT NOT NULL,
  risk_model_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE risk_calculations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  risk_model_version TEXT NOT NULL REFERENCES risk_model_versions(version),
  trigger TEXT NOT NULL CHECK (trigger IN ('pipeline','override','control_change','contradiction_resolved','reapply_model','analyst_entered')),
  inputs_json TEXT NOT NULL,
  by_dimension_json TEXT NOT NULL,
  inherent_score REAL NOT NULL,
  residual_score REAL NOT NULL,
  inherent_band TEXT NOT NULL,
  residual_band TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1,
  computed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_calc_current ON risk_calculations(case_id) WHERE is_current = 1;
CREATE INDEX ix_calc_case_current ON risk_calculations(case_id, is_current);

-- Decisions --------------------------------------------------------------------

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES cases(id),
  type TEXT NOT NULL CHECK (type IN ('APPROVE','APPROVE_WITH_CONDITIONS','DEFER','REJECT')),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) >= 20),
  decided_by TEXT NOT NULL REFERENCES users(id),
  decided_at TEXT NOT NULL,
  risk_calculation_id TEXT NULL REFERENCES risk_calculations(id)
);
-- AD-09 / FR-WF-07: only a committee-role actor can write a decision.
CREATE TRIGGER decisions_committee_only BEFORE INSERT ON decisions
BEGIN
  SELECT RAISE(ABORT, 'only committee may decide')
  WHERE (SELECT role FROM users WHERE id = NEW.decided_by) IS NOT 'committee';
END;

CREATE TABLE decision_conditions (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  text TEXT NOT NULL,
  due_date TEXT,
  owner TEXT
);

-- Audit — append-only with hash chain ------------------------------------------

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  case_id TEXT NULL REFERENCES cases(id),
  actor_user_id TEXT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  previous_json TEXT,
  new_json TEXT,
  reason TEXT,
  risk_model_version TEXT,
  policy_version TEXT,
  model_version TEXT,
  prompt_version TEXT,
  refers_to_event_id TEXT NULL REFERENCES audit_events(id),
  prev_hash TEXT,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_audit_case_seq ON audit_events(case_id, seq);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

-- Quality, evaluation, metrics -------------------------------------------------

CREATE TABLE quality_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('playwright','eval','quality_gate','adversarial_live')),
  git_sha TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS','FAIL','RUNNING'))
);

CREATE TABLE eval_results (
  id TEXT PRIMARY KEY,
  quality_run_id TEXT NOT NULL REFERENCES quality_runs(id),
  golden_case_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE metrics_snapshots (
  id TEXT PRIMARY KEY,
  taken_at TEXT NOT NULL,
  system_json TEXT NOT NULL,
  ai_json TEXT NOT NULL,
  business_json TEXT NOT NULL
);

CREATE TABLE request_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_reqmetrics_created ON request_metrics(created_at);
