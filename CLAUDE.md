# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

**FinSentinel** — Financial Crime Risk Assessment Workbench. A hackathon project: an AI-assisted platform that prepares evidence-backed financial-crime risk assessments for new products/changes, which humans then review and decide on. Guiding principle, enforced in design and code: **AI prepares. Rules calculate. Humans decide.**

Stages 01–05 are done: the design documents in `documents/`, a working implementation (Fastify API + pipeline + SQLite, React web app, Playwright test suites, evaluation runner, quality gate), the Stage 04 testing report and user manual, and the Stage 05 deployment pipeline (`documents/STAGE05_Deployment.md`, `.github/workflows/release.yml`, `scripts/deploy.ps1`). Read `documents/STAGE02_Design_Architecture.md` before changing behaviour; it is the authoritative design. Requirement IDs (`FR-…`, `AD-…`, `DEP-…`) appear in code comments and test names for traceability.

## Staged workflow (important)

Work is organised in six numbered stages defined in `documents/stages.txt`: 01 Requirements → 02 Design → 03 Development → 04 Testing → 05 Deployment → 06 Operations. Stage documents live in `documents/` named `STAGE<NN>_<Name>.md`.

- **Before producing any new document, ask the user which stage it is for**, unless they already named it.
- Carry requirement IDs forward for traceability: `PR-` principles, `FR-` functional, `NFR-` non-functional, `DR-` data, `EV-` evaluation, `QG-` quality gates, `AC-` acceptance (defined in the PRD), `AD-` architecture decisions (defined in the architecture doc), and `DEP-` deployment steps/gates (defined in `STAGE05_Deployment.md`). Code, tests and later docs should reference these IDs.
- `documents/hackathon_draft.txt` is the original source brief. Do not edit it.

## Criteria log (required at the end of every stage)

The judging criteria are in `documents/criteria.txt`. At the end of each stage, write `logs/criteria/STAGE<NN>.json` (schema in `logs/criteria/README.md`: per criterion — done, evidence, decisions with reasons, gaps, self-score) and run `npm run criteria:report` to regenerate `documents/FINAL_REPORT.md`. The panel probes decisions, so every entry needs a reason. `documents/CRITERIA_ALIGNMENT.md` is the alignment review after Stage 03.

## Token reporting (required after every task)

The user wants token usage logged per task for the submission. After finishing a task:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\token_report.ps1
```

Then append a per-task delta row and a cumulative row to `logs/token_log.md` (format is in the file), and report the delta in the reply. Do not run this mid-task.

## Environment constraints (verified on the dev machine)

- **Windows 11, Node 24.16, npm 11.13. No C++ build tools, no Docker, no Python in the toolchain.** Only pure-JS packages or Node built-ins. Never add a dependency that needs `node-gyp`.
- **npm is blocked by a Netskope TLS proxy unless Node trusts the Windows cert store.** Before any `npm install` / `npx playwright install`, ensure `NODE_USE_SYSTEM_CA=1` is set in the environment (a new terminal is needed after `setx`). Do not disable `strict-ssl`.
- Node runs `.ts` files natively (type stripping) — no transpile step for the server. `tsc --noEmit` is type-check only.
- Database is SQLite through the built-in `node:sqlite` (FTS5 and JSON1 confirmed available; see `scripts/probe_sqlite.mjs`). No external DB, no `better-sqlite3`.
- Only ~2.6 GB RAM free: hosted LLM API only, Chromium-only for Playwright.

## Stack and commands

Fastify 5 + zod (API), Vite + React 19 + react-router (web), `node:sqlite` (DB), `@anthropic-ai/sdk` (LLM), pdf-parse / mammoth / exceljs (parsers), Biome (lint+format), **Playwright Test as the single runner for all test levels** (unit, integration, security, adversarial in `playwright.config.ts` — no browser; e2e in `playwright.e2e.config.ts` — Chromium, light+dark, starts the server from `.env.test`), `c8` for coverage.

Always prefix npm/npx in PowerShell with `$env:NODE_USE_SYSTEM_CA='1';` (env vars do not persist between tool calls).

```powershell
npm start                                          # API + built web on :3000 (.env; mock gateway, seeds demo cases)
npm run dev:api ; npm run dev:web                  # watch API on :3000, Vite on :5173 proxying /api
npm run build                                      # web/dist (served by the API when present)
npm run lint ; npm run typecheck                   # biome check . ; tsc --noEmit
npm test                                           # unit + integration + security + adversarial (fast, no browser)
npx playwright test --project=unit                 # one level
npx playwright test tests/unit/risk-engine.spec.ts # one file
npx playwright test -g "cannot eliminate"          # one test by title
npm run test:e2e                                   # Chromium e2e (needs `npx playwright install chromium` once)
npm run eval                                       # golden-dataset evaluation → evaluations/results/<ts>.json
npm run gate                                       # quality gate PASS/FAIL from test-results + latest eval
npm run seed ; npm run backup ; npm run migrate
npm run restore -- --latest                        # restore from data/backups (dry run; add --yes); BACKUP_DIR overrides the folder
npm run smoke -- --url=http://127.0.0.1:3000       # post-deploy smoke test (DEP-09); exit 1 on any failed check
.\scripts\deploy.ps1 -Environment staging -Ref v0.1.0   # Windows host deploy: clone tag, npm ci, build, backup, switch, Task Scheduler start, smoke, auto-rollback (-Status, -Rollback)
npm run manual:capture                             # regenerate documents/STAGE04_User_Manual.md screenshots + diagrams (Chromium, serial, ~1 min)
npm run manual:pdf                                 # render the manual to documents/STAGE04_User_Manual.pdf (marked + Playwright Chromium)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1   # one-shot Windows install (see -RunTests, -WithChromium, -Start)
```

Tests build their own in-memory DB via `tests/helpers/app.ts` (`createTestContext` / `createTestApp` + `login`); integration tests hit routes with `app.inject()`.

**Mock LLM fixtures** live in `tests/fixtures/llm/<agent>/` and are selected by content-derived keys (`src/agents/fixture-keys.ts`): extraction by `<kind>__<slug of first heading>`, other agents by `<slug of first three title words>`, falling back to `default.json`. Assessment fixtures cite policy sections as `cite_source: "AML §5.3"`; the mock resolves them to runtime evidence ids, and unresolvable citations become UNSUPPORTED claims on purpose. When adding a demo case, add its documents under `tests/fixtures/cases/` and matching fixtures.

## Architecture in one screen (details in STAGE02 docs)

Single Node process: Fastify serves `/api/**` and the built React SPA; SQLite file DB; one outbound dependency (Anthropic API).

**Pipeline (code-orchestrated, fixed order, not an agent loop):** parse → extract → merge+contradict → missing-info → scope → retrieve (FTS5) → assess → ground → score → packet. Each step persists a `pipeline_steps` row; LLM steps return JSON validated by zod schemas in `src/agents/schemas/`. A failed LLM step leaves the case in `ASSESSMENT` with a manual-continue path — it never advances or decides.

**Layering rule:** `routes → services → (domain | agents | db/repos)`. `src/domain/` (risk engine, workflow state machine, RBAC matrix, injection detector) is pure and I/O-free. `db/repos/decisions.ts` is imported only by `services/decision.ts`; no pipeline or agent code may import it.

**LLM access** goes only through the `LlmGateway` interface (`src/llm/`): `AnthropicGateway` for real calls, `MockGateway` (fixtures + failure injection: 500, timeout, invalid JSON, refusal) for tests/CI. Model IDs and effort live in `config/llm.json`, never in agent code. Every call writes an `llm_calls` row with `usage` tokens.

**Invariants the design depends on (enforce in code and tests):**
- Residual risk ≤ inherent, ≥ configured floor (>0); controls mitigate, never eliminate. Formula in Architecture §8.2; all arithmetic 4-dp rounded.
- A fact with a non-null value must have ≥1 source (doc, chunk, quote). Missing values stay `null` with a `missing_reason` — never invented.
- Claims must cite evidence chunk IDs with quotes; the grounding verifier checks the quote exists in the chunk. No valid citation ⇒ `UNSUPPORTED`, which blocks finalization.
- `audit_events` is append-only (SQLite triggers + SHA-256 hash chain). Every mutating service method appends an audit event in the same transaction.
- `decisions` rows can only be written by a committee-role actor (DB trigger + RBAC preHandler). Override/resolve/accept-gap/decision all require a rationale (min 20 chars, DB-enforced for overrides).
- Document text is untrusted data: it is only ever placed inside `<evidence>`/`<document>` wrappers in prompts; instruction-like content is flagged, not obeyed.

**Sample documents:** `samples/manifest.json` maps each change type to a title, description and document files; `GET /api/samples` and `POST /api/cases/:id/documents/from-sample` back the "Use sample documents" action on New Case. Titles are fixed because mock fixtures key on them. `MOCK_LATENCY_MS` in `.env` (1800 for demos, 0 in tests) paces the mock gateway so the pipeline progress animation is visible.

**Auth is simulation mode:** sign-in is a user-picker over four seeded synthetic users (Product Owner, FCRM Analyst, Risk Committee, FCRM Admin); no password. RBAC still applies fully. Only synthetic data is permitted anywhere.

**Deployment (Stage 05):** the deployment unit is a Git tag `v*`. `release.yml` reuses `ci.yml` via `workflow_call`, packages a zip + SBOM + GitHub Release, deploys to staging on a self-hosted Windows runner (label `finsentinel-staging`), then waits for a human approval on the GitHub Environment `production` before `scripts/deploy.ps1` runs on the production runner (backup → switch immutable release dir → Task Scheduler start → smoke → automatic rollback). Deploy jobs are enabled by the repository variable `DEPLOY_ENABLED=true`. Env flags are strict booleans (`1/0/true/false`; do not use `z.coerce.boolean` for flags); `NODE_ENV=production` refuses `SEED_ON_START=1` unless `ALLOW_SEED=1`. Production-only env: `HOST`, `TRUST_PROXY`, `COOKIE_SECURE`, `CORS_ORIGIN`, `BACKUP_DIR`. The mock gateway needs `tests/fixtures/llm` at runtime, so release packages and the Dockerfile ship `tests/fixtures`.

## Naming

Product name is **FinSentinel** (subtitle "Financial Crime Risk Assessment Workbench"; dashboard "FinSentinel Quality Center"). "RiskForge" and bare "Risk Assessment Workbench" are retired names from the draft — do not reintroduce them.
