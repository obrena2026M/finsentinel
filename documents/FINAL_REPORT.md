# FinSentinel — Final Report against the Judging Criteria

Generated 2026-09-30 from `logs/criteria/*.json` by `scripts/criteria-report.ts`. Stages covered: 01 Requirements, 02 Design, 03 Development, 04 Testing.

> AI prepares. Rules calculate. Humans decide.

## 1. Weighted self-assessment

| Criterion | Weight | S01 | S02 | S03 | S04 | Latest | Weighted |
|---|---|---|---|---|---|---|---|
| AI harness and agent orchestration | 30% | 4 | 5 | 4 | 4 | 4/5 | 24.0 |
| SDLC automation | 20% | 3 | 4 | 4 | 4 | 4/5 | 16.0 |
| Human-in-the-loop and governance | 15% | 4 | 5 | 5 | 5 | 5/5 | 15.0 |
| Evaluation framework | 10% | 3 | 4 | 4 | 4 | 4/5 | 8.0 |
| Context engineering and requirement expansion | 10% | 4 | 4 | 4 | 4 | 4/5 | 8.0 |
| Production readiness | 5% | 3 | 3 | 3 | 4 | 4/5 | 4.0 |
| Token efficiency | 5% | 4 | 4 | 3 | 3 | 3/5 | 3.0 |
| Engineering judgement | 5% | 4 | 5 | 5 | 5 | 5/5 | 5.0 |
| **Total** | **100%** |  |  |  |  | | **83.0 / 100** |

Self-scores are the team's own 0–5 estimate per stage; the "Latest" column drives the weighted total. They are a planning aid, not a prediction of the panel's scores.

## 2. How AI was applied in each stage (SDLC automation, 20%)

### Stage 01 — Requirements (2026-09-28)

Claude Code read the 2,800-line hackathon draft (a testing plan in two variants), reconciled the differences between them, and expanded it into a full PRD with numbered requirement IDs, a permission matrix, traceability tables for all 30 test cases and 10 E2E scenarios, a coverage checklist against every draft section, and 10 open questions with stated assumptions.

Build tokens: output 49,736, cache read 582,142, cache write 272,537 (token log tasks 1, 2).

### Stage 02 — Design (2026-09-28)

Claude Code surveyed the developer machine (tool versions, TLS proxy diagnosis, SQLite feature probe), wrote the tools recommendation, then produced the architecture, data model and UX design documents. It loaded the Claude API reference to use current model IDs, pricing, structured-output and caching rules rather than memory. All 10 PRD open questions were closed with numbered architecture decisions.

Build tokens: output 461,107, cache read 19,267,689, cache write 3,956,471, sub-agents 98,792 (token log tasks 3, 4, 5, 6, 7, 8, 9, 10, 11).

### Stage 03 — Development (2026-09-28)

Claude Code implemented the whole system from the design documents: scaffold, pure domain layer, SQLite schema with triggers, audit hash chain, LLM gateway (real + mock), seven agents and the orchestrator, services and routes, a synthetic policy corpus, demo documents and mock fixtures, four Playwright test projects, the evaluation runner, the quality gate, CI workflow and README. A separate sub-agent built the React web app against the API contract in parallel. Tests and the evaluation runner were used as the feedback loop; one fixture-keying defect was found by the evaluation and fixed.

Build tokens: output 2,654,996, cache read 72,813,472, cache write 14,212,940, sub-agents 262,616 (token log tasks 12).

### Stage 04 — Testing (2026-09-30)

Claude Code measured baseline coverage with c8 over the Playwright suites (89.2% statements, 76.1% branches), targeted the uncovered modules (binary document parsers, the real Anthropic gateway via an injected fake client, analyst/committee service branches, admin publishing, health/metrics/quality routes, DB and config foundations), and raised coverage to 98.6% statements / 82.9% branches with 37 new tests. The new tests exposed a genuine defect (exceljs CommonJS interop under native ESM) and dead code (an unused decisions.deleteForCase). Coverage thresholds are now enforced by c8 in CI and reported as a quality gate. The stage was completed on 2026-09-30 with user-facing validation: Claude Code wrote a serial Playwright walkthrough that performs the whole workflow per role through the real UI and captures 38 screenshots, generated three colour-coded workflow diagrams from the workflow and RBAC source, assembled them into documents/STAGE04_User_Manual.md with requirement traceability, and produced a one-shot Windows installer (scripts/install.ps1) verified end to end on the dev machine.

Build tokens: output 355,686, cache read 36,916,795, cache write 1,426,077 (token log tasks 14, 22, 23).

## 3. Evidence and decisions per criterion

### AI harness and agent orchestration — 30%

**Stage 01 Requirements** (self-score 4/5)

- Defined the two-class split (deterministic vs probabilistic) as principles PR-01..PR-08
- Specified agent pipeline and boundaries as requirements FR-ARC-01..06
- Evidence: `documents/STAGE01_System_Requirements_PRD.md §3, §6`

**Stage 02 Design** (self-score 5/5)

- 15 architecture decisions AD-01..AD-15
- 10-step code-orchestrated pipeline with per-step failure behaviour
- Context builder with cache breakpoints
- Model routing: Haiku 4.5 cheap steps, Opus 5 reasoning
- Gateway interface with mock for tests
- Evidence: `documents/STAGE02_Design_Architecture.md §1, §5`

**Stage 03 Development** (self-score 4/5)

- Orchestrator with persisted step status, skip-on-failure and fail-closed transitions
- Context builder with two cache breakpoints and evidence truncation by relevance
- zod schemas for all five agent outputs; facts without provenance rejected
- Mock gateway with failure injection and content-keyed fixtures
- Anthropic gateway using messages.parse + zodOutputFormat, adaptive thinking, effort, usage capture
- Evidence: `src/agents/orchestrator.ts`, `src/agents/context-builder.ts`, `src/agents/schemas/index.ts`, `src/llm/*.ts`, `tests/integration/pipeline.spec.ts`

**Stage 04 Testing** (self-score 4/5)

- Real Anthropic gateway fully unit-tested with an injected fake SDK client: success, schema retry with error feedback, refusal, max_tokens, HTTP error, timeout, haiku vs opus parameter split
- Grounding verdict matrix (SUPPORTED/WEAK/UNSUPPORTED × reasons) tested
- Contradiction-agent degrade path (rule results kept on LLM failure) tested
- Pipeline diagram generated from the orchestrator's fixed step order, distinguishing LLM steps from deterministic steps, published in the user manual
- Evidence: `tests/unit/anthropic-gateway.spec.ts`, `tests/unit/grounding.spec.ts`, `tests/integration/services-and-routes.spec.ts`, `documents/manual/diagrams/pipeline.png`

| Stage | Decision | Reason |
|---|---|---|
| 01 | Write requirements as IDs, not prose | So later stages can trace design, code and tests back to them |
| 02 | Workflow tier, not agent loop (AD-02) | Fixed order is a governance control and is testable |
| 02 | Structured JSON via zod at every agent boundary (AD-03) | Removes the invalid-JSON failure class and makes schemas the contract |
| 02 | Deterministic grounding first (AD-07) | A quote check cannot be fooled by fluent prose |
| 03 | doc_id and chunk provenance come from context, never from the model | The model should not name documents; quotes are re-verified against the document |
| 03 | Unverifiable fixture citations become UNSUPPORTED on purpose | Mock behaves like a hallucinating model so the grounding gate is exercised |
| 04 | Make the SDK client injectable instead of mocking the module | Keeps production construction unchanged and tests deterministic without network |

Open gaps: S03: No real-model run yet; S03: --mode=baseline not implemented; S04: Still no real-model run

### SDLC automation — 20%

**Stage 01 Requirements** (self-score 3/5)

- Stage produced end to end by AI from the draft
- Established the staged workflow and file naming
- Evidence: `documents/STAGE01_System_Requirements_PRD.md`, `logs/token_log.md entry 2`

**Stage 02 Design** (self-score 4/5)

- Design derived from PRD IDs; every section carries traceability tables
- Tools document selected the stack from a real environment survey
- Evidence: `documents/tools.md`, `Architecture §18, Data Model §14, UX §9`

**Stage 03 Development** (self-score 4/5)

- CI workflow: lint → typecheck → tests → eval → build → e2e → gate
- CLAUDE.md updated with commands and conventions
- Web app delegated to a sub-agent with the API as contract
- Evidence: `.github/workflows/ci.yml`, `CLAUDE.md`, `README.md`

**Stage 04 Testing** (self-score 4/5)

- c8 coverage with enforced thresholds in npm test:coverage and CI
- Coverage added as a quality gate
- Testing report produced from measured numbers
- User manual screenshots and diagrams regenerated by one command (npm run manual:capture) from a scripted Chromium walkthrough, so documentation cannot drift from the UI
- One-shot Windows installer (scripts/install.ps1) with toolchain checks, proxy CA trust, .env generation, SQLite capability probe, migrate/seed/build and optional tests
- Repo-wide biome check and tsc --noEmit brought back to green (formatting drift in four files, three strict-null errors in the manual tooling)
- User manual rendered to a 34-page A4 PDF by npm run manual:pdf (marked + Playwright Chromium, pure JS, no native tools), so the submission has a printable manual that regenerates from the same source
- Evidence: `.c8rc.json`, `.github/workflows/ci.yml`, `documents/STAGE04_Testing_Report.md`, `tests/manual/capture.spec.ts`, `scripts/manual/diagrams.ts`, `scripts/install.ps1`

| Stage | Decision | Reason |
|---|---|---|
| 01 | Ask which stage every document is for | Keeps the six-stage flow explicit rather than ad hoc |
| 02 | Playwright Test as the single runner for all test levels | One config, one report, one CI step; non-browser projects launch no browser |
| 03 | Fresh sub-agent for the web app instead of a fork | Avoids re-caching the large main context; API files were the contract |
| 04 | Thresholds 95/80/95 (lines/branches/functions) | Just below measured values so regressions fail fast without chasing unreachable branches |
| 04 | Keep the manual capture out of npm test and npm run test:e2e | It is serial and Chromium-bound (~1 min); the fast suite must stay fast, and the manual only needs regenerating when the UI changes |
| 04 | Installer never overwrites an existing .env | Re-running the installer must be safe on a configured machine; secrets and gateway choice are the user's |

Open gaps: S01: No per-stage criteria record existed yet (added retroactively in this file); S03: CI not yet executed on GitHub (repo has no remote/commits); S04: CI still not executed on GitHub

### Human-in-the-loop and governance — 15%

**Stage 01 Requirements** (self-score 4/5)

- Four roles and a permission matrix
- Override, rationale, committee decision and audit requirements
- Evidence: `PRD §4, §5.10, §5.11`

**Stage 02 Design** (self-score 5/5)

- Finalize guards, committee-only decision at DB trigger level, append-only audit with hash chain
- UX: three-column truth, blockers rail, shared rationale dialog, role tiles
- Evidence: `Architecture §9, §10`, `Data Model §8, §9`, `UX §1, §4.8, §4.9`

**Stage 03 Development** (self-score 5/5)

- RBAC preHandler with authz_denied audit
- Rationale minimum enforced in domain, DB CHECK and UI
- Committee-only trigger
- Finalize guards
- Append-only triggers + verifyChain endpoint
- Evidence: `tests/security/rbac-routes.spec.ts`, `tests/unit/audit-writer.spec.ts`, `tests/integration/analyst-journey.spec.ts`

**Stage 04 Testing** (self-score 5/5)

- DEFER returns to analyst review with no decision row; REJECT and close tested
- Information-request round trip owner↔analyst tested
- Second decision on closed case rejected
- User manual documents each role's journey with screenshots proving role-restricted controls: the Product Owner's Committee tab has no decision block, only the analyst sees override/control/finalize, only the committee sees the decision block, only the admin sees the risk model editor
- Case-lifecycle diagram shows every human gate (finalize guard, committee decision, defer) generated from the state machine
- Evidence: `tests/integration/services-and-routes.spec.ts`, `documents/STAGE04_User_Manual.md §4.5, §5.4, §6, §8`, `documents/manual/diagrams/case-lifecycle.png`

| Stage | Decision | Reason |
|---|---|---|
| 01 | Committee always required (OQ-04) | Hackathon scope; removes an ambiguous analyst-decides path |
| 02 | Simulation sign-in with role tiles, no password | Hackathon simulation; RBAC unaffected; one route to swap for real auth |
| 03 | decisions repo imported only by the decision service | Structural guarantee, checked by reading imports, that no pipeline path can decide |
| 04 | Manual walkthrough exercises override, control rating, claim removal, contradiction resolution and decision each with a real rationale | Screenshots must show the rationale requirement in action, not just describe it |

### Evaluation framework — 10%

**Stage 01 Requirements** (self-score 3/5)

- EV-01..10 evaluation requirements, QG-01..14 quality gates, golden dataset spec
- Evidence: `PRD §8.2, §9`

**Stage 02 Design** (self-score 4/5)

- Evaluation runner design, initial numeric thresholds, quality gate script design
- Evidence: `Architecture §15`, `config/quality-gates.json (Stage 03)`

**Stage 03 Development** (self-score 4/5)

- Golden dataset (3 cases: high, low, adversarial)
- Evaluation runner with 14 metrics and per-case tokens
- Quality gate reading Playwright JSON + latest eval + DB governance checks
- Quality Center API with live adversarial tests
- Evidence: `evaluations/run.ts`, `scripts/quality-gate.ts`, `src/services/quality.ts`, `src/services/adversarial.ts`

**Stage 04 Testing** (self-score 4/5)

- Coverage measured per file and reported
- Defects found by testing recorded with root cause and fix
- Quality Center and live adversarial run captured in the manual from a real run
- Evidence: `coverage/coverage-summary.json`, `documents/STAGE04_Testing_Report.md §5`, `documents/manual/screenshots/70-admin-quality-center.png`, `documents/manual/screenshots/71-admin-adversarial-prompt-injection-result.png`

| Stage | Decision | Reason |
|---|---|---|
| 01 | Thresholds left as 'agreed threshold' with OQ-03 | Cannot set numbers before a first run |
| 02 | Initial thresholds set, marked tunable after first run | Closes OQ-03 without pretending to precision |
| 03 | Loosen unsupportedClaimRate to 0.15 and groundingSupportedRate to 0.85 with written notes | Mock fixtures deliberately include unsupported claims; thresholds return to 0.05/0.90 with the real model |
| 04 | Exclude only src/server.ts and migrations from coverage | Entry point and SQL are exercised by the e2e server start, not unit-testable in isolation |

Open gaps: S01: No numeric thresholds; S03: 3 golden cases vs 30–50 target; S03: No expert-agreement metric; S04: Golden dataset still 3 cases; S04: No expert-agreement metric

### Context engineering and requirement expansion — 10%

**Stage 01 Requirements** (self-score 4/5)

- Reconciled .txt and .md draft variants (10 vs 5 E2E scenarios, RiskForge naming)
- Listed 10 open questions with assumptions
- Evidence: `PRD §17, §18`

**Stage 02 Design** (self-score 4/5)

- Environment research recorded (proxy CA fix, no compiler, SQLite FTS5 verified)
- Risk formula, retry, confidence, provider decisions made explicit
- Evidence: `documents/tools.md §1–§2`, `Architecture §8, §17`

**Stage 03 Development** (self-score 4/5)

- Synthetic policy corpus with section refs mirroring FCRM structure
- Prompts embed the untrusted-content rule and fact-field vocabulary
- case_versions freezes prompt/policy/model versions per case
- Evidence: `policies/*.md`, `prompts/*/v1.md`, `src/db/repos/core.ts cases.freezeVersions`

**Stage 04 Testing** (self-score 4/5)

- Generated real DOCX/XLSX/PDF fixtures in-test with pure-JS libraries to exercise parsers
- Manual shows the instruction-like-content banner and the unsupported vendor self-assertion being removed, i.e. document text handled as data
- Evidence: `tests/unit/parser.spec.ts`, `documents/manual/screenshots/15-owner-new-case-overview.png`, `documents/manual/screenshots/43-analyst-remove-claim-dialog.png`

| Stage | Decision | Reason |
|---|---|---|
| 01 | Keep all 10 E2E scenarios in scope | Superset is safer for a test-driven brief |
| 02 | Verify SDK usage from the reference, not memory | API shapes changed in 2025–2026; stale priors would break the gateway |
| 03 | Content-derived fixture keys (heading/title slugs) | Seed, tests and eval resolve the same fixture without coupling to generated ids |
| 04 | Generate binary fixtures at test time rather than committing files | Keeps fixtures readable and diffable |

Open gaps: S01: Domain sources not cited; S03: Domain sources for the corpus not cited

### Production readiness — 5%

**Stage 01 Requirements** (self-score 3/5)

- NFR-SEC, NFR-OPS, NFR-CI requirements
- Evidence: `PRD §7`

**Stage 02 Design** (self-score 3/5)

- Security design, health probes, deployment/config plan, backup approach
- Evidence: `Architecture §13, §16`

**Stage 03 Development** (self-score 3/5)

- Health live/ready probes
- Session hardening, upload magic-byte checks, redaction, correlation ids
- Backup script, migrations runner
- 60 automated tests green
- Evidence: `src/routes/system.ts`, `src/app.ts`, `scripts/backup.ts`, `test-results/*.json`

**Stage 04 Testing** (self-score 4/5)

- Health-ready checks, metrics snapshot, admin publishing and error mapping covered
- Static SPA fallback path tested when web/dist exists
- Windows installer verified twice end to end on the dev machine (existing .env path with 99 tests green; fresh .env path validated against the app's own env schema)
- User manual with troubleshooting table and Ops dashboard screenshot
- Evidence: `tests/integration/services-and-routes.spec.ts`, `scripts/install.ps1`, `documents/STAGE04_User_Manual.md §2, §10`, `documents/manual/screenshots/72-admin-ops-dashboard.png`

| Stage | Decision | Reason |
|---|---|---|
| 02 | Single process + SQLite file | No Docker or compiler available; documented upgrade path |
| 03 | In-process single-case queue for pipeline runs | Fits one process and the demo; documented as the first thing to externalise |
| 04 | Installer probes node:sqlite for FTS5 and JSON1 before migrating | Retrieval depends on FTS5; failing early with a clear message beats a runtime error on the first case |

Open gaps: S02: Scalability limits acknowledged, not tested; S03: Not load tested; single process; S04: No load or soak test; S04: Installer is Windows-only; Linux/macOS deployment is Stage 05 work

### Token efficiency — 5%

**Stage 01 Requirements** (self-score 4/5)

- FR-TOK-01..05 requirements
- Started per-task token logging for the build itself
- Evidence: `PRD §5.17`, `logs/token_log.md`

**Stage 02 Design** (self-score 4/5)

- Caching strategy AD-15, per-agent context caps, cost computed at read time from a price table
- Evidence: `Architecture §5.3, §5.6, §14`

**Stage 03 Development** (self-score 3/5)

- llm_calls table with usage per call including failures
- Per-case cost at read time
- Eval reports per-case tokens
- Build tokens logged per task
- Evidence: `src/llm/usage.ts`, `evaluations/results/*.json`, `logs/token_log.md entry 12`

**Stage 04 Testing** (self-score 3/5)

- Gateway usage mapping (input/output/cache read/cache write) asserted in tests
- Failed calls also recorded in llm_calls (asserted)
- Per-case token and cost line captured on the Overview screenshot
- Evidence: `tests/unit/anthropic-gateway.spec.ts`, `tests/adversarial/fail-safe.spec.ts`, `documents/manual/screenshots/15-owner-new-case-overview.png`

| Stage | Decision | Reason |
|---|---|---|
| 01 | Log build tokens per task from the session transcript | Token efficiency is judged; the build's own consumption is evidence |
| 02 | Measure Opus at low effort before adding model tiers | Caches are model-scoped; fewer models can be cheaper |
| 03 | Haiku 4.5 for extraction/scoping/contradiction, Opus 5 for assessment | Bounded JSON tasks do not need the strongest model |

Open gaps: S03: No real-model measurement; baseline vs optimised comparison pending; S04: No real-model measurement

### Engineering judgement — 5%

**Stage 01 Requirements** (self-score 4/5)

- PR-08 separation: LLM for extraction/retrieval/synthesis/drafting; rules for scoring/validation/permissions/workflow; humans for decisions
- Evidence: `PRD §3`

**Stage 02 Design** (self-score 5/5)

- Per-step 'kind' column (deterministic vs LLM) in the pipeline table
- Deterministic risk engine with bounded mitigation and a floor
- Evidence: `Architecture §5.1, §8`

**Stage 03 Development** (self-score 5/5)

- Risk engine, workflow, RBAC, injection detector, missing-info, grounding verifier and retrieval are all deterministic and unit-tested
- LLM used only for extraction, scoping, semantic contradictions and drafting
- Evidence: `src/domain/*.ts`, `tests/unit/*.spec.ts`

**Stage 04 Testing** (self-score 5/5)

- Deterministic modules at 100% statements: risk engine, RBAC, injection detector, schemas, usage, fixture keys
- Diagrams generated from the domain source rather than drawn, so they cannot contradict the code
- Diagram generator fixed to wrap or fit long labels after the first render showed clipped text
- Evidence: `coverage table in documents/STAGE04_Testing_Report.md`, `scripts/manual/diagrams.ts`, `documents/STAGE04_Testing_Report.md §8`

| Stage | Decision | Reason |
|---|---|---|
| 02 | Vendor-asserted controls count as 'unverified' = no mitigation | Self-assessment is not evidence (mirrors Sanctions §4.3) |
| 03 | Rule-based contradiction pre-check before the LLM pass | Value mismatches are cheap to detect; LLM only for meaning |
| 04 | Removed dead code found by coverage instead of writing a test for it | Tests should protect behaviour, not preserve unused paths |
| 04 | Playwright instead of a local MCP server for the simulated walkthrough | No MCP server is configured; Playwright is already the single runner, needs no new dependency and runs in CI |

## 4. Build token consumption (token efficiency, 5%)

| Stage | Output | Cache read | Cache write | Sub-agents |
|---|---|---|---|---|
| 01 Requirements | 49,736 | 582,142 | 272,537 | 0 |
| 02 Design | 461,107 | 19,267,689 | 3,956,471 | 98,792 |
| 03 Development | 2,654,996 | 72,813,472 | 14,212,940 | 262,616 |
| 04 Testing | 355,686 | 36,916,795 | 1,426,077 | 0 |
| **Total** | **3,521,525** | **129,580,098** | **19,868,025** | **361,408** |

Where consumption concentrated: cache reads dominate because each turn re-reads the growing session context; output tokens concentrate in Stage 03 where ~90 source files were written. Mitigations used: delegating the web app to a fresh sub-agent, and per-task logging in `logs/token_log.md`. Application-side consumption per case is recorded in the `llm_calls` table and reported by the evaluation runner.

Full per-task log: `logs/token_log.md`.

