# FinSentinel — Alignment Review Against the Judging Criteria

| Field | Value |
|---|---|
| Source | `documents/criteria.txt` (How You Will Be Judged) |
| Reviewed after | STAGE01 Requirements, STAGE02 Design, STAGE03 Development |
| Date | 2026-09-28 |
| Companion | `logs/criteria/STAGE0N.json` (per-stage criteria log) → `npm run criteria:report` → `documents/FINAL_REPORT.md` |

The panel will "probe decisions rather than features". This review therefore lists, per criterion, the decisions we can defend, where the evidence lives, and what is still missing before Stages 04–06.

Legend: **✓ aligned** · **◐ partly** · **✗ gap**

---

## 30% — AI harness and agent orchestration

| Sub-criterion | Status | Evidence | Defensible decision |
|---|---|---|---|
| Architecture | ✓ | `STAGE02_Design_Architecture.md` §1–§5, AD-01…AD-15 | Code-orchestrated fixed pipeline, not an autonomous agent loop, because step order is itself a governance control (AD-02). |
| How work is orchestrated | ✓ | `src/agents/orchestrator.ts`, `pipeline_steps` table | Every step persists status/summary/error; a failed LLM step fails closed and exposes a manual path. |
| How context is managed | ✓ | `src/agents/context-builder.ts`, `src/agents/schemas/` | Structured intermediate state (zod facts with provenance) instead of re-sending documents; stable blocks first for prompt caching; evidence truncated by relevance, never facts. |
| Data foundation | ✓ | `STAGE02_Design_Data_Model.md`, `src/db/migrations/0001_init.sql` | SQLite with FTS5 for retrieval, append-only audit with hash chain, frozen versions per case. |
| Instruction design | ✓ | `prompts/<agent>/v1.md`, `UNTRUSTED_CONTENT_RULE` | One agent = one job = one schema; untrusted-content rule in every prompt; prompts versioned and hashed onto every output. |
| Division between AI and people | ✓ | PR-08, `src/domain/rbac.ts`, `src/services/decision.ts` | AI extracts/retrieves/drafts; rules score/validate/gate; humans confirm, override, decide. Structurally enforced (no import path from agents to decisions). |
| **Gap** | ◐ | — | Real-model run not yet executed; prompt tuning evidence will come in Stage 04. Baseline-vs-optimised context comparison (`--mode=baseline`) is designed but not implemented. |

## 20% — SDLC automation

| Sub-criterion | Status | Evidence | Note |
|---|---|---|---|
| AI applied in each of six stages | ◐ | Stages 01–03 produced with Claude Code; `logs/token_log.md`; this criteria log | Stages 04–06 not yet run. |
| Stages connect into a coherent flow | ✓ | Requirement IDs (PR/FR/NFR/EV/QG/AC) → AD decisions → code comments → test names → quality gates → Quality Center | Traceability is the connective tissue; `README.md` judging map. |
| **Gap** | ✗ | — | Until now there was no single artefact recording *how AI was used per stage*. The criteria logger created with this review closes that gap and must be appended after every stage. |

## 15% — Human-in-the-loop and governance

| Gate | Risk controlled | Why placed here | Evidence |
|---|---|---|---|
| Low-confidence fact confirmation | Acting on a weak extraction | Before scoring, because scores consume facts | AD-12, `facts.status='low_confidence'`, finalize guard |
| Contradiction resolution with rationale | Silent selection of one source | Before finalization; analyst, not AI, resolves | FR-CON, `contradictions` table, guard |
| Missing-info request / accepted gap with rationale | Inventing values | Pipeline never fills gaps; only a human may accept one | FR-MIS, `information_requests.gap_accepted` |
| Unsupported-claim block | Fluent hallucination reaching committee | Before finalization; deterministic verifier | AD-07, `claims.verdict`, guard |
| Override requires rationale ≥20 chars | Untraceable rating change | DB CHECK + service + UI, so it cannot be bypassed | FR-OVR-02, `overrides` CHECK |
| Finalize guard | Incomplete case to committee | Single choke point before COMMITTEE_REVIEW | `src/services/workflow.ts` |
| Committee-only decision | AI or analyst approving | RBAC preHandler **and** DB trigger; no pipeline import path | AD-09, `decisions_committee_only` trigger |
| Append-only audit + hash chain | Silent history edits | Storage layer, not application layer | AD-08, triggers, `verifyChain` |
| **Status** | ✓ | All gates tested (52 tests incl. RBAC matrix, trigger bypass, chain tamper). | |

## 10% — Evaluation framework

| Sub-criterion | Status | Evidence |
|---|---|---|
| What we measure | ✓ | extraction accuracy, hallucinated facts, missing-info recall, invented values, contradiction recall, scoping F1, retrieval P/R, grounding supported/unsupported rate, band agreement, adversarial pass, tokens/cost per case (`evaluations/run.ts`) |
| How we measure | ✓ | Golden dataset (3 cases) through the real pipeline; Playwright JSON → gates; governance gates read the database itself |
| Failures feed back | ◐ | Two concrete loops already happened in Stage 03: (1) fixture keying bug found by eval (extraction accuracy 0.67 → 1.0), (2) grounding threshold tuned with a written note. Needs a formal "eval → issue → change → re-eval" log in Stage 04. |
| **Gap** | ✗ | Golden dataset is 3 cases vs PRD target 30–50; no real-model run; no expert-agreement measurement yet. |

## 10% — Context engineering and requirement expansion

| Sub-criterion | Status | Evidence |
|---|---|---|
| Researched an incomplete requirement | ✓ | `hackathon_draft.txt` (a test plan) expanded into a PRD with 10 open questions, each closed by an explicit design decision (Architecture §17) |
| Layered in domain knowledge | ✓ | Synthetic policy corpus (AML, TM, Sanctions, TPRM, KYC) written to mirror real FCRM structure; risk taxonomy with 8 dimensions, EDD, higher-risk jurisdictions, vendor-assertion rule |
| Maintained context across the workflow | ✓ | Requirement IDs carried from PRD → design → code → tests; `CLAUDE.md` + memory notes so future sessions inherit conventions; `case_versions` freezes prompts/policies/model per case |
| **Gap** | ◐ | The environment research (proxy CA, no compiler, SQLite FTS5 probe) is recorded in `tools.md`; the *domain* research sources are not cited (synthetic corpus authored from general knowledge). Add a short "domain assumptions" note in Stage 04. |

## 5% — Production readiness

| Sub-criterion | Status | Evidence / honest limit |
|---|---|---|
| Security | ✓ | RBAC matrix, httpOnly/sameSite sessions, magic-byte upload checks, size limits, redaction, no stack traces, rate-limit plugin registered |
| Reliability | ✓ | Fail-closed pipeline, transactional writes, health probes, backup script, CI workflow |
| Architectural standards | ✓ | Layering rule enforced by convention and documented; zod at every boundary; Biome + tsc clean |
| Scalability | ◐ | Single Node process, in-process job queue, SQLite file. Adequate for a demo and small team; documented path is Postgres + external queue. Not load-tested. |
| "Works once is not the bar" | ✓ | 60 automated tests, run repeatedly; CI defined (not yet executed on GitHub). |

## 5% — Token efficiency

| Sub-criterion | Status | Evidence |
|---|---|---|
| Which models | ✓ | Haiku 4.5 for extraction/scoping/contradiction; Opus 5 for assessment/grounding (`config/llm.json`, AD-04) |
| Where consumption concentrated | ✓ | Per-call `llm_calls` table; eval reports per-case tokens; **build-time** consumption in `logs/token_log.md` shows cache reads dominate (92.7M read vs 3.2M output) — concentrated in long sessions with large documents in context |
| What we did to optimise | ✓ / ◐ | App: structured state instead of documents, targeted FTS retrieval, cache breakpoints on stable blocks, low effort on cheap steps, per-agent context caps. Build: sub-agent for the web app to avoid re-caching the main context. **Not yet measured on the real model.** |

## 5% — Engineering judgement

| Problem | Chosen approach | Why |
|---|---|---|
| Risk scoring | Deterministic engine | Must be reproducible, explainable, unit-testable; LLM would vary |
| Workflow, RBAC, audit | Code + SQL constraints | Governance cannot depend on a probabilistic component |
| Grounding | Deterministic quote verification first; LLM entailment optional | Cannot be talked out of it by fluent prose |
| Missing-info detection | Rule: required facts from risk model | Simple set difference; no model needed |
| Contradiction detection | Rule pre-check + LLM for semantic conflicts | Rule catches value mismatches cheaply; LLM only for meaning |
| Retrieval | FTS5 BM25 | Explainable queries shown in UI; corpus small; embeddings unnecessary |
| Extraction, scoping, drafting | LLM | Genuinely linguistic tasks |
| Injection defence | Heuristic detector + prompt rule + closed schemas | Detector flags for humans; schema removes any path from text to action |
| **Status** | ✓ | Documented in AD-08 and Architecture §5.1; tested. |

---

## Summary and actions before Stage 04

| Criterion | Weight | Alignment | Action |
|---|---|---|---|
| AI harness | 30 | ✓ | Run real model; implement `--mode=baseline` comparison |
| SDLC automation | 20 | ◐ | **Criteria log per stage (created now); keep appending** |
| Human-in-the-loop | 15 | ✓ | Add gate-rationale table to demo script |
| Evaluation | 10 | ◐ | Grow golden set; formal feedback log; real-model run |
| Context engineering | 10 | ✓ | Add domain-assumptions note |
| Production readiness | 5 | ◐ | Execute CI on GitHub; document scaling path |
| Token efficiency | 5 | ◐ | Real-model measurement; baseline vs optimised |
| Engineering judgement | 5 | ✓ | None |
