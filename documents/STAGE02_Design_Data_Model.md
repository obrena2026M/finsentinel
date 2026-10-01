# FinSentinel — Data Model Design

*FinSentinel — Financial Crime Risk Assessment Workbench*

| Field | Value |
|---|---|
| Stage | **STAGE02 — Design** (document 2 of 3: Data Model) |
| Companion docs | `STAGE02_Design_Architecture.md`, `STAGE02_Design_UX.md` |
| Storage | SQLite 3.53 via `node:sqlite` (WAL, `foreign_keys=ON`), FTS5, JSON1 |
| Version | 1.0 (2026-09-28) |

Conventions: `TEXT` primary keys are UUIDv7 (time-ordered). Timestamps are ISO-8601 UTC strings. JSON columns are validated by the zod schema named in the comment before write. All monetary/cost values are derived at read time, never stored.

---

## 1. Entity relationship overview

```
users ──────────< sessions
  │
  └──< audit_events (actor)

risk_model_versions ──< risk_calculations
policy_versions ─────< policy_chunks ──(fts)── policy_chunks_fts
                                  └──< evidence_refs >── cases

cases ──< documents ──< document_chunks
  │           └──< document_flags
  ├──< pipeline_runs ──< pipeline_steps ──< llm_calls
  ├──< facts ──< fact_sources
  ├──< contradictions
  ├──< information_requests
  ├──< assessments ──< claims ──< claim_evidence >── evidence_refs
  ├──< dimension_scores  (current per dimension: initial, override, control)
  ├──< overrides
  ├──< risk_calculations
  ├──< decisions ──< decision_conditions
  ├──< audit_events
  └──< case_versions   (which prompt / model / policy / risk-model versions apply)

prompt_versions
quality_runs, eval_results, metrics_snapshots
```

---

## 2. Reference and identity tables

### 2.1 `users`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| username | TEXT UNIQUE NOT NULL | synthetic: `owner.pat`, `analyst.kim`, `committee.lee`, `admin.raj` |
| display_name | TEXT NOT NULL | |
| role | TEXT NOT NULL CHECK IN ('product_owner','analyst','committee','admin') | |
| password_hash | TEXT NULL | scrypt via `node:crypto`; NULL in simulation mode (sign-in is a user picker, no password) |
| role_description | TEXT NOT NULL | shown on sign-in tiles |
| created_at | TEXT NOT NULL | |

### 2.2 `sessions`
| id TEXT PK | user_id FK users | expires_at TEXT | created_at TEXT |

### 2.3 `risk_model_versions`
| Column | Type | Notes |
|---|---|---|
| version | TEXT PK | "1.0", "1.3" |
| model_json | TEXT NOT NULL | zod `RiskModel` (Architecture §8.1) |
| is_active | INTEGER NOT NULL DEFAULT 0 | exactly one active (partial unique index `WHERE is_active=1`) |
| published_by | TEXT FK users | admin |
| published_at | TEXT NOT NULL | |
| notes | TEXT | |

### 2.4 `policy_versions`
| policy_id TEXT | version TEXT | title TEXT | source_file TEXT | published_at TEXT | is_active INTEGER | PK(policy_id, version) |

### 2.5 `policy_chunks`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| policy_id, policy_version | TEXT | FK policy_versions |
| section_ref | TEXT NOT NULL | "§5.3" |
| title | TEXT | |
| body | TEXT NOT NULL | |
| ordinal | INTEGER | |

### 2.6 `policy_chunks_fts` (virtual)
```sql
CREATE VIRTUAL TABLE policy_chunks_fts USING fts5(
  title, body, content='policy_chunks', content_rowid='rowid', tokenize='porter unicode61'
);
-- triggers keep it in sync on insert/update/delete of policy_chunks
```

### 2.7 `prompt_versions`
| agent TEXT | version TEXT | sha256 TEXT | path TEXT | created_at TEXT | PK(agent, version) |

---

## 3. Case core

### 3.1 `cases`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | display id `RA-1028` stored in `ref` |
| ref | TEXT UNIQUE NOT NULL | |
| title | TEXT NOT NULL | |
| change_type | TEXT NOT NULL CHECK IN ('product','feature','process','vendor','geography','customer_segment','channel','transaction') | |
| description | TEXT NOT NULL | mandatory (FR-INT-02) |
| state | TEXT NOT NULL CHECK IN ('SUBMITTED','ASSESSMENT','ANALYST_REVIEW','INFO_REQUESTED','COMMITTEE_REVIEW','DECIDED','CLOSED') | |
| submitted_by | TEXT FK users | |
| created_at, updated_at | TEXT | |

### 3.2 `case_versions` — reproducibility (PR-06, FR-VER-02/03)
| Column | Type | Notes |
|---|---|---|
| case_id | TEXT PK FK cases | |
| risk_model_version | TEXT FK | frozen at pipeline start |
| policy_versions_json | TEXT | `{ "AML": "v3", "TM": "v2", ... }` |
| prompt_versions_json | TEXT | `{ "extraction": "v2", "assessment": "v4" }` |
| llm_models_json | TEXT | `{ "extraction": "claude-haiku-4-5", "assessment": "claude-opus-5" }` |
| frozen_at | TEXT | |

Re-running the pipeline creates a new `pipeline_runs` row but does **not** change `case_versions` unless the analyst explicitly chooses "re-assess with current versions" (audited).

### 3.3 `documents`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| case_id | TEXT FK | |
| kind | TEXT CHECK IN ('product_proposal','vendor_questionnaire','process_doc','other') | |
| original_name | TEXT | |
| mime | TEXT | verified by magic bytes |
| size_bytes | INTEGER | |
| sha256 | TEXT | |
| storage_path | TEXT | `data/uploads/<case>/<uuid>` |
| parse_status | TEXT CHECK IN ('pending','parsed','parse_failed') | |
| parse_error | TEXT | |
| uploaded_by | TEXT FK users | |
| uploaded_at | TEXT | |

### 3.4 `document_chunks`
| id TEXT PK | document_id FK | chunk_ix INTEGER | heading TEXT | page INTEGER | text TEXT | char_count INTEGER | UNIQUE(document_id, chunk_ix) |

### 3.5 `document_flags` — injection and other content warnings
| id TEXT PK | document_id FK | chunk_ix INTEGER | flag_type TEXT CHECK IN ('instruction_like','approval_instruction','self_assertion') | matched_text TEXT | pattern TEXT | created_at TEXT |

---

## 4. Pipeline and LLM accounting

### 4.1 `pipeline_runs`
| id TEXT PK | case_id FK | mode TEXT ('optimized','baseline') | gateway TEXT ('anthropic','mock') | status TEXT ('running','succeeded','failed','manual_continue') | started_at | finished_at | triggered_by FK users |

### 4.2 `pipeline_steps`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| run_id | TEXT FK | |
| step | TEXT CHECK IN ('parse','extract','merge_contradict','missing_info','scope','retrieve','assess','ground','score','packet') | |
| status | TEXT CHECK IN ('pending','running','succeeded','failed','skipped') | |
| attempt | INTEGER | |
| error_code, error_message | TEXT | |
| started_at, finished_at | TEXT | |
| latency_ms | INTEGER | |
| UNIQUE(run_id, step, attempt) | | |

### 4.3 `llm_calls` — FR-TOK-01 source of truth
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| step_id | TEXT FK pipeline_steps | nullable for ad-hoc calls (e.g. grounding entailment on manual re-check) |
| case_id | TEXT FK | denormalized for fast per-case sums |
| agent | TEXT | |
| model | TEXT | as returned by API |
| prompt_version, prompt_sha256 | TEXT | |
| effort | TEXT | |
| input_tokens, output_tokens, cache_read_tokens, cache_write_tokens | INTEGER | from `usage` |
| latency_ms | INTEGER | |
| stop_reason | TEXT | `end_turn`, `max_tokens`, `refusal`, ... |
| outcome | TEXT CHECK IN ('ok','schema_invalid','http_error','timeout','empty','refusal') | |
| created_at | TEXT | |

Indexes: `(case_id)`, `(created_at)`, `(model, created_at)`.

---

## 5. Facts, contradictions, information requests

### 5.1 `facts` — merged, current view per case
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| case_id | TEXT FK | |
| field | TEXT NOT NULL | enum in zod `Fact.field` |
| value_json | TEXT | JSON-encoded value; NULL when missing |
| confidence | REAL | 0–1 |
| status | TEXT CHECK IN ('extracted','low_confidence','confirmed','missing','conflicted','resolved','analyst_entered') | |
| missing_reason | TEXT | |
| confirmed_by | TEXT FK users | |
| confirmed_at | TEXT | |
| UNIQUE(case_id, field) | | |

Constraint (trigger): `value_json IS NOT NULL` ⇒ at least one `fact_sources` row exists after the transaction (checked in the repository within the same transaction; DB trigger `AFTER INSERT` verifies via `RAISE` on violation).

### 5.2 `fact_sources`
| id TEXT PK | fact_id FK | document_id FK | chunk_ix INTEGER | quote TEXT (≤300) |

### 5.3 `contradictions`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| case_id | TEXT FK | |
| field | TEXT | |
| candidates_json | TEXT | `[{ value, document_id, chunk_ix, quote }]` |
| detected_by | TEXT CHECK IN ('rule','llm') | |
| status | TEXT CHECK IN ('open','resolved') | |
| resolved_value_json | TEXT | |
| rationale | TEXT | required when resolved (AD-14) |
| resolved_by FK users, resolved_at | | |

### 5.4 `information_requests`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| case_id | TEXT FK | |
| field | TEXT | missing fact |
| question | TEXT | generated targeted question |
| status | TEXT CHECK IN ('open','answered','gap_accepted') | |
| answer | TEXT | PO response |
| answered_by, answered_at | | |
| accepted_rationale | TEXT | when `gap_accepted` |
| accepted_by, accepted_at | | |

---

## 6. Evidence, assessment, claims

### 6.1 `evidence_refs` — retrieved for this case
| id TEXT PK | case_id FK | policy_chunk_id FK | dimension TEXT | bm25_score REAL | query TEXT | rank INTEGER | UNIQUE(case_id, policy_chunk_id, dimension) |

### 6.2 `assessments` — one current per case, history retained
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| case_id | TEXT FK | |
| run_id | TEXT FK pipeline_runs | |
| is_current | INTEGER | partial unique `WHERE is_current=1` per case |
| summary | TEXT | AI narrative (analyst-editable, edits audited) |
| dimension_narratives_json | TEXT | `{ geography: "…", … }` |
| created_at | TEXT | |

### 6.3 `claims`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| assessment_id | TEXT FK | |
| dimension | TEXT | |
| text | TEXT NOT NULL | |
| verdict | TEXT CHECK IN ('SUPPORTED','UNSUPPORTED','WEAK') | |
| verdict_reason | TEXT | e.g. `quote_not_found`, `no_citation`, `entailment_low` |
| status | TEXT CHECK IN ('active','removed') | analyst removal audited |

### 6.4 `claim_evidence`
| claim_id FK | evidence_ref_id FK | quote TEXT | quote_verified INTEGER | added_by TEXT ('ai','analyst') | PK(claim_id, evidence_ref_id) |

---

## 7. Scores, overrides, calculations

### 7.1 `dimension_scores` — current state per dimension
| Column | Type | Notes |
|---|---|---|
| case_id | TEXT FK | |
| dimension | TEXT | |
| ai_recommended | INTEGER CHECK 1–5 | from assessment; NULL if step failed |
| current_score | INTEGER CHECK 1–5 | = ai_recommended until overridden / analyst-entered |
| control_rating | TEXT CHECK IN ('none','weak','adequate','strong','unverified') DEFAULT 'unverified' | |
| control_rationale | TEXT | |
| control_set_by, control_set_at | | |
| PK(case_id, dimension) | | |

### 7.2 `overrides` — FR-OVR
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| case_id | TEXT FK | |
| dimension | TEXT | |
| previous_score | INTEGER | |
| new_score | INTEGER | |
| rationale | TEXT NOT NULL CHECK(length(trim(rationale)) >= 20) | DB-level enforcement of FR-OVR-02 |
| user_id | TEXT FK users | |
| user_role | TEXT | |
| risk_model_version | TEXT | |
| created_at | TEXT | |

### 7.3 `risk_calculations` — every calculation retained
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| case_id | TEXT FK | |
| risk_model_version | TEXT FK | |
| trigger | TEXT CHECK IN ('pipeline','override','control_change','contradiction_resolved','reapply_model') | |
| inputs_json | TEXT | per-dimension `{ score, control_rating }` |
| inherent_by_dim_json, residual_by_dim_json | TEXT | |
| inherent_score, residual_score | REAL | 4-dp |
| inherent_band, residual_band | TEXT | |
| is_current | INTEGER | partial unique per case |
| computed_at | TEXT | |

---

## 8. Decisions

### 8.1 `decisions`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| case_id | TEXT FK UNIQUE | one decision per case; amendments via audit |
| type | TEXT CHECK IN ('APPROVE','APPROVE_WITH_CONDITIONS','DEFER','REJECT') | |
| rationale | TEXT NOT NULL | |
| decided_by | TEXT FK users | trigger: role must be `committee` (join users) |
| decided_at | TEXT | |
| risk_calculation_id | TEXT FK | the calculation the committee saw |

Trigger `decisions_committee_only BEFORE INSERT`: `SELECT RAISE(ABORT,'only committee may decide') WHERE (SELECT role FROM users WHERE id = NEW.decided_by) <> 'committee';`

### 8.2 `decision_conditions`
| id TEXT PK | decision_id FK | text TEXT NOT NULL | due_date TEXT | owner TEXT |

Trigger: `APPROVE_WITH_CONDITIONS` requires ≥1 condition (checked in service transaction; DB trigger `AFTER INSERT ON decisions` deferred check via count at commit is not available in SQLite, so the service enforces it and a nightly integrity script verifies).

---

## 9. Audit — append-only with hash chain

### 9.1 `audit_events`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| seq | INTEGER UNIQUE | global monotonic (AUTOINCREMENT via shadow `audit_seq` table or `rowid`) |
| case_id | TEXT FK NULL | NULL for global events (risk model publish, authz denied without case) |
| actor_user_id | TEXT FK NULL | NULL for `system` |
| actor_role | TEXT | `product_owner`/`analyst`/`committee`/`admin`/`system` |
| action | TEXT NOT NULL | see 9.2 |
| entity_type, entity_id | TEXT | |
| previous_json, new_json | TEXT | |
| reason | TEXT | rationale |
| risk_model_version, policy_version, model_version, prompt_version | TEXT | where applicable |
| refers_to_event_id | TEXT FK audit_events | amendments |
| prev_hash | TEXT | hash of previous event in same case (or global chain) |
| hash | TEXT NOT NULL | sha256(prev_hash ‖ canonical JSON of all other columns) |
| created_at | TEXT NOT NULL | |

```sql
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
```

### 9.2 Action vocabulary
`case_created`, `document_uploaded`, `document_parse_failed`, `pipeline_started`, `pipeline_step_failed`, `pipeline_completed`, `manual_continue`, `fact_confirmed`, `fact_entered`, `contradiction_resolved`, `info_requested`, `info_answered`, `gap_accepted`, `claim_removed`, `claim_evidence_added`, `assessment_edited`, `control_rating_set`, `override`, `risk_recalculated`, `finalized`, `decision`, `deferred`, `closed`, `amendment`, `risk_model_published`, `authz_denied`, `login`, `logout`.

---

## 10. Quality, evaluation, metrics

### 10.1 `quality_runs`
| id TEXT PK | source TEXT ('playwright','eval','quality_gate') | git_sha TEXT | started_at | finished_at | summary_json TEXT | status TEXT ('PASS','FAIL') |

### 10.2 `eval_results`
| id TEXT PK | quality_run_id FK | golden_case_id TEXT | mode TEXT | metrics_json TEXT | tokens_in, tokens_out, cache_read, cache_write INTEGER | latency_ms INTEGER |

### 10.3 `metrics_snapshots`
| id TEXT PK | taken_at TEXT | system_json | ai_json | business_json |

The Quality Center reads the latest `quality_runs` per source. The Ops dashboard reads live aggregates plus the last snapshot.

---

## 11. Indexes

```sql
CREATE INDEX ix_cases_state ON cases(state);
CREATE INDEX ix_documents_case ON documents(case_id);
CREATE INDEX ix_chunks_doc ON document_chunks(document_id);
CREATE INDEX ix_facts_case ON facts(case_id);
CREATE INDEX ix_evidence_case ON evidence_refs(case_id);
CREATE INDEX ix_claims_assessment ON claims(assessment_id);
CREATE INDEX ix_calc_case_current ON risk_calculations(case_id, is_current);
CREATE INDEX ix_audit_case_seq ON audit_events(case_id, seq);
CREATE INDEX ix_llm_case ON llm_calls(case_id);
CREATE INDEX ix_llm_created ON llm_calls(created_at);
CREATE UNIQUE INDEX ux_riskmodel_active ON risk_model_versions(is_active) WHERE is_active = 1;
CREATE UNIQUE INDEX ux_assessment_current ON assessments(case_id) WHERE is_current = 1;
CREATE UNIQUE INDEX ux_calc_current ON risk_calculations(case_id) WHERE is_current = 1;
```

---

## 12. Migrations

- Files `src/db/migrations/NNNN_name.sql`, applied in order inside one transaction each; `schema_migrations(name, applied_at)` tracks state.
- Migrations are forward-only. A schema change to an audited table adds columns; it never rewrites rows.
- `0001_init.sql` creates everything above; `0002_seed_reference.sql` inserts users, risk model v1.0, prompt versions; policy corpus is loaded by `scripts/load-policies.ts` (idempotent by sha256).

---

## 13. Golden dataset file format (`evaluations/golden_dataset/RA-0NN.json`)

```json
{
  "case_id": "RA-001",
  "category": "high_risk",
  "title": "International Instant Payments for SMB",
  "change_type": "product",
  "description": "...",
  "documents": [
    { "kind": "product_proposal", "file": "RA-001/proposal.docx" },
    { "kind": "vendor_questionnaire", "file": "RA-001/vendor.xlsx" }
  ],
  "expected_facts": { "customer_segment": "SMB", "geographies": ["Canada","Mexico"], "channel": "API", "third_party": true },
  "expected_missing": ["transaction_volume"],
  "expected_contradictions": [],
  "expected_dimensions": ["geography","transaction","third_party","channel"],
  "expected_evidence": ["AML:§5.3","TM:§7"],
  "expected_band": "High",
  "adversarial": null
}
```

Adversarial cases set `"adversarial": { "type": "prompt_injection" | "approval_instruction" | "self_assertion" | "corrupt_file" | "llm_500" | "llm_timeout" | "invalid_json", "expect_flag": true }`.

---

## 14. Traceability (data model → PRD)

| Table(s) | PRD IDs |
|---|---|
| cases, documents, document_chunks | FR-INT-01…07 |
| document_flags | FR-ADV-01…03 |
| case_versions, prompt_versions, risk_model_versions, policy_versions | PR-06, FR-VER-01…04, TEST-027/028 |
| pipeline_runs, pipeline_steps | FR-ARC-04, FR-FAIL-02 |
| llm_calls | FR-TOK-01, FR-OBS-02 |
| facts, fact_sources | FR-EXT-01…04, PR-04 |
| contradictions | FR-CON-01…03 |
| information_requests | FR-MIS-01…04, FR-INT-08 |
| policy_chunks(+fts), evidence_refs | FR-RET-01…05 |
| assessments, claims, claim_evidence | FR-ASM-01…07 |
| dimension_scores, overrides, risk_calculations | FR-RSK, FR-OVR-01…08 |
| decisions, decision_conditions | FR-WF-03…07, FR-RBAC-04 |
| audit_events + triggers | FR-AUD-01…06, NFR-SEC-08 |
| quality_runs, eval_results, metrics_snapshots | FR-QC, EV-09, FR-OBS |
