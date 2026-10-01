# Development Tools — FinSentinel

*FinSentinel — Financial Crime Risk Assessment Workbench*

| Field | Value |
|---|---|
| Stage | STAGE01 — System Requirements (tooling companion) |
| Source PRD | `documents/STAGE01_System_Requirements_PRD.md` |
| Machine surveyed | Windows 11 Pro 10.0.26200, AMD64, 334 GB free disk, ~2.6 GB free RAM at time of survey |
| Survey date | 2026-09-28 |
| Target | Local web app, synthetic data, local database, local API server |
| Language decision | **TypeScript on Node.js, npm.** Python is installed but excluded from the toolchain to keep one language across app, tests, scripts and evaluation runner. |

---

## 1. Environment inventory (verified on this machine)

### 1.1 Installed and usable

| Tool | Version | Location | Notes |
|---|---|---|---|
| Node.js | v24.16.0 | `C:\Program Files\nodejs` | Runs `.ts` files natively (type stripping) — verified. Built-in `fetch`, `node:test`, `node:sqlite` — all verified. |
| npm | 11.13.0 | bundled with Node | Registry reachable **only** with `NODE_USE_SYSTEM_CA=1` (see §2.1). |
| npx | 11.13.0 | bundled with Node | |
| corepack | present | bundled with Node | Can enable pnpm/yarn if wanted; npm is sufficient. |
| Git | 2.54.0 | `%LOCALAPPDATA%\Programs\Git` | SSL backend = schannel (Windows cert store), so git over HTTPS works through the proxy. Project is **not yet a git repo**. |
| VS Code | 1.139.1 | `%LOCALAPPDATA%\Programs\Microsoft VS Code` | |
| winget | 1.29.380 | Windows | Package manager for any optional CLI installs. |
| curl / wget | present | Windows | curl fails TLS to npm registry directly (same proxy issue), fine for local API testing over `http://localhost`. |
| Python | 3.14.6 + pip 26.1.2 | `%LOCALAPPDATA%\Programs\Python\Python314` via `py` launcher | Works through the proxy (pip uses the Windows trust store). **Not used** — see language decision above. |

### 1.2 VS Code extensions already installed (relevant)

| Extension | Use in this project |
|---|---|
| `ms-playwright.playwright` | Test explorer, run/debug, trace viewer and codegen for **all** test levels (unit, integration, E2E) — see §3.4. |
| `cucumberopen.cucumber-official`, `alexkrechik.cucumberautocomplete` | Optional Gherkin/BDD layer over Playwright if the team wants readable scenario files for judges. |
| `anthropic.claude-code` | AI-assisted SDLC (20% judging criterion). |
| `ms-vscode.live-server` | Quick static preview; superseded by Vite dev server. |
| `ms-python.*` | Not needed for this stack. |

The full list of extensions to install for development is in §9. A `.vscode/extensions.json` in the repo carries the same list so VS Code prompts every team member to install them.

### 1.3 Not installed (and how we work around each)

| Missing | Impact | Workaround |
|---|---|---|
| C++ build tools (Visual Studio / `cl.exe`) | Cannot compile native Node addons (`node-gyp`) | **Use only pure-JS packages or built-ins.** `node:sqlite` replaces `better-sqlite3`. Document parsers chosen below are pure JS. |
| Docker / Podman | No containers, no Postgres/Redis in a box | File-based SQLite database. Single Node process for API + static frontend. |
| `sqlite3` CLI | No shell for inspecting the DB | Optional: `winget install SQLite.SQLite`. Or a tiny `scripts/db.ts` REPL, or the VS Code "SQLite Viewer" extension. |
| `gh` CLI | No GitHub PR/CI from terminal | Optional: `winget install GitHub.cli`. Git alone is enough to push. |
| `jq`, `make`, `pwsh` 7 | Convenience only | npm scripts replace `make`; Node replaces `jq`. |
| Ollama / local LLM | Only 2.6 GB RAM free | Use a hosted LLM API. Local models are not feasible on this machine. |
| Any `*_API_KEY` env var | No LLM provider configured yet | Must be set before the AI pipeline can run (PRD OQ-07). |

---

## 2. Blockers found and required fixes

### 2.1 npm registry blocked by corporate TLS interception (must fix first)

`npm ping` fails with `SELF_SIGNED_CERT_IN_CHAIN`. The certificate chain for `registry.npmjs.org` is issued by a Netskope proxy CA (`ca.myridius1.goskope.com` → `*.bom3.goskope.com`). Node ships its own CA bundle and ignores the Windows store by default, so it rejects the chain.

**Verified fix** — tell Node to trust the Windows certificate store. Both of these produced `npm notice PONG`:

```powershell
# Option A (recommended): environment variable, persists for the current user
setx NODE_USE_SYSTEM_CA 1

# Option B: equivalent via NODE_OPTIONS
setx NODE_OPTIONS --use-system-ca
```

Open a new terminal after `setx`. Do **not** use `npm config set strict-ssl false`; that disables certificate checking entirely.

Playwright browser downloads and any tool that uses Node's HTTPS client (Vite plugin installs, `npx create-*`) need the same setting. Non-Node tools (git, pip) already work because they use the Windows store.

### 2.2 No native compilation

Every package in §3 was chosen because it has no `node-gyp` build step. Before adding any dependency, check that it does not depend on `node-gyp`, `prebuild-install`, or `node-pre-gyp` unless it ships Windows x64 prebuilds.

### 2.3 Low free memory

Keep the dev loop to one Node process (API + Vite middleware) plus one browser. Avoid running the full Playwright matrix and a large model locally at the same time.

---

## 3. Recommended stack

Principle: fewest moving parts that still demonstrate every PRD requirement. Prefer Node built-ins, then small pure-JS libraries.

### 3.1 Core

| Layer | Choice | Why | PRD requirements served |
|---|---|---|---|
| Runtime | **Node.js 24** (installed) | Native TS execution, built-in SQLite, fetch, test runner. Zero install. | All |
| Language | **TypeScript 5.x** (`typescript` dev dep for type-checking only; Node runs the files) | Types for structured intermediate state, risk model config, audit events. | FR-EXT-02, FR-ARC |
| Package manager | **npm** (installed) | Present, lockfile, workspaces if we split `api/` and `web/`. | NFR-CI |
| API server | **Fastify 5** | Fast, schema-first, built-in request validation, plugins for cookies/sessions/static, pino logging out of the box. | FR-RBAC, NFR-SEC-03/04, NFR-OPS-03 |
| Validation | **zod** (+ `fastify-type-provider-zod`) | Single schema source for API bodies, LLM JSON outputs and risk-model config. Rejects invalid LLM JSON cleanly. | FR-INT-02, FR-RSK-05, FR-FAIL-01/03 |
| Database | **SQLite via `node:sqlite`** (built-in, verified: SQLite 3.53.0, FTS5, JSON1, R*Tree) | Local file DB, no native build, transactional, append-only audit via triggers, FTS5 for policy retrieval. | FR-AUD-03, FR-WF-08, NFR-REL-03, FR-RET |
| Migrations | Hand-written SQL files + a 40-line runner (`scripts/migrate.ts`) | ORMs targeting `node:sqlite` are still immature; raw SQL is transparent to judges. | FR-VER |
| Frontend | **Vite 6 + React 19 + TypeScript** | Fast dev server, static build served by Fastify in prod. | UX-01…08, FR-QC |
| UI components | Plain CSS or **Tailwind 4** (pure JS/CSS, no native) | Keep it light; Quality Center and dashboards need tables and status badges more than a design system. | FR-QC, FR-OBS-04 |
| Routing (web) | **react-router 7** | Case list, case detail, committee view, Quality Center, Ops dashboard. | UX |
| Auth / RBAC | **`@fastify/cookie` + `@fastify/session`** with seeded synthetic users, role checks in a Fastify `preHandler` | Four roles, no external IdP needed for hackathon. | FR-RBAC-01…07, NFR-SEC-01/02/09 |
| Logging | **pino** (Fastify default) + `pino-pretty` in dev | Structured JSON logs; redact secrets. | NFR-OPS-03, NFR-SEC-07 |
| Config / secrets | `.env` via Node's built-in `--env-file` (no dotenv package) + zod-validated config module | No secrets in source. | NFR-OPS-05/06 |

### 3.2 Document ingestion (all pure JS)

| Format | Package | Notes |
|---|---|---|
| PDF | **`pdf-parse`** (wraps pdf.js) or **`unpdf`** | Text extraction only; scanned PDFs are out of scope. |
| DOCX | **`mammoth`** | DOCX → text/HTML. |
| XLSX | **`exceljs`** or **`xlsx`** (SheetJS community build) | Pure JS. |
| Upload handling | **`@fastify/multipart`** | Size and MIME limits satisfy FR-INT-04/06. |
| Type sniffing | **`file-type`** | Reject renamed/unsupported files by magic bytes, not extension. |

Corrupt-file handling (FR-INT-05): wrap each parser in try/catch, persist a `parse_failed` status, never proceed to extraction.

### 3.3 AI pipeline

| Concern | Choice | Notes |
|---|---|---|
| LLM SDK | **`@anthropic-ai/sdk`** | Tool-use / structured outputs for extraction JSON; usage object returns input/output/cache tokens per call → feeds FR-TOK-01 directly. Provider is PRD OQ-07; this is the default assumption. |
| Model routing (FR-TOK-03) | Small model for extraction/classification, larger model for assessment drafting | Configure model IDs in the risk-model/prompt config, never hard-code. Record `model` on every output (FR-ASM-06). |
| Prompt versioning (FR-VER-01) | Prompts as files under `prompts/<agent>/v<N>.md`, hashed on load, hash stored on each output | No library needed. |
| Retrieval (FR-RET) | **SQLite FTS5** keyword search over policy sections, chunked by section heading | Verified available. Optional upgrade: store embeddings as JSON arrays and cosine-rank the FTS5 top-k in JS. No vector DB required. |
| Structured output validation | zod schemas per agent | Invalid JSON → bounded retry → surfaced error (FR-FAIL-03). |
| Injection defence (FR-ADV) | Document text always placed in a clearly delimited "evidence" block; system prompt states it is data; regex/heuristic detector flags instruction-like phrases for the UI banner (FR-ADV-03) | No package; design pattern. |
| Token accounting (FR-TOK-01) | `llm_calls` table: case_id, agent, model, prompt_version, input/output/cache tokens, latency_ms, cost | Read from SDK response `usage`. |

### 3.4 Testing and evaluation

**Decision: one test runner for everything — Playwright Test (`@playwright/test`).** It is a general-purpose runner, not only a browser tool. Tests that do not request the `page` fixture run as plain Node tests with no browser launched, so unit and integration tests cost nothing extra. Benefits: one config, one reporter, one VS Code Test Explorer, one HTML report for the Quality Center, and one CI step. The `ms-playwright.playwright` extension is already installed.

| Level | How it runs under Playwright Test | Notes |
|---|---|---|
| Unit | `tests/unit/**/*.spec.ts`, project `unit`, no browser. Import the risk engine, workflow state machine, RBAC matrix, validators directly and use `expect`. | Pure functions; `test.describe` per module. Boundary tests (FR-RSK-06) as `test.each`-style loops. |
| Integration | `tests/integration/**/*.spec.ts`, project `integration`, no browser. Build the Fastify app with an in-memory SQLite (`:memory:`) and call `app.inject()` or Playwright's `request` fixture against `app.listen()`. | Agent pipeline with the mock LLM client; audit persistence; workflow persistence. |
| Security / RBAC | `tests/security/**/*.spec.ts`, project `security`, no browser. Table-driven: role × route × expected status. | TEST-016/017/030, NFR-SEC. |
| Adversarial | `tests/adversarial/**/*.spec.ts`, project `adversarial`, no browser. Fixture documents with injection text, contradictions, corrupt files; mock LLM configured to return 500 / timeout / invalid JSON. | TEST-022…026, E2E-008…010 at API level. |
| E2E | `tests/e2e/**/*.spec.ts`, project `e2e`, **Chromium only**. `webServer` option starts the app. | E2E-001…010 through the real UI. `npx playwright install chromium` needs `NODE_USE_SYSTEM_CA=1`. |
| Component (optional) | `@playwright/experimental-ct-react` for isolated React components (Quality Center tiles, override form). | Only if UI unit coverage is wanted; otherwise E2E covers it. |
| BDD (optional) | **`@cucumber/cucumber`** or `playwright-bdd` on top of Playwright | Only if judges benefit from Gherkin files mirroring E2E-001…010. |
| AI evaluation runner | Custom `evaluations/run.ts` (a script, not a test) | Loads `evaluations/golden_dataset/*.json`, runs pipeline, computes accuracy / precision / recall / grounding / agreement, writes `evaluations/results/<timestamp>.json`. Quality Center reads the latest result (FR-QC-05, EV-09). A thin Playwright spec can assert results meet thresholds so it shows in the same report. |
| Mock LLM | Fixture-backed fake client implementing the SDK interface | Deterministic CI runs; also simulates HTTP 500, timeouts, invalid JSON (TEST-025/026, E2E-008). |
| Coverage | `c8` (pure JS, uses V8 built-in coverage) wrapping `playwright test` for the non-browser projects | Playwright has no built-in unit coverage; `c8 npx playwright test --project=unit --project=integration` produces lcov/HTML. |
| Reports | Playwright HTML + JSON reporters → `test-results/` | JSON report is what `scripts/quality-gate.ts` and the Quality Center consume (FR-QC-01). |

Sketch of `playwright.config.ts` projects:

```ts
projects: [
  { name: 'unit',        testDir: 'tests/unit' },
  { name: 'integration', testDir: 'tests/integration' },
  { name: 'security',    testDir: 'tests/security' },
  { name: 'adversarial', testDir: 'tests/adversarial' },
  { name: 'e2e',         testDir: 'tests/e2e', use: { ...devices['Desktop Chrome'] } },
],
webServer: { command: 'node --env-file=.env.test src/server.ts', url: 'http://localhost:3000/health/live' },
reporter: [['html'], ['json', { outputFile: 'test-results/results.json' }]],
```

Trade-off accepted: Playwright Test starts slower than `node:test` (roughly 1–2 s of overhead) and its `expect` is less rich than Vitest's. Neither matters for a hackathon, and the single-runner story is clearer for judges.

### 3.5 Code quality and CI

| Concern | Choice | Notes |
|---|---|---|
| Lint + format | **Biome** | One dependency, one config, ships Windows x64 binary via npm optional deps (no compile). Alternative: ESLint + Prettier. |
| Type check | `tsc --noEmit` in CI | Node strips types at run time and does not type-check. |
| Git hooks | Optional `simple-git-hooks` | Run Biome + tsc pre-commit. |
| CI | **GitHub Actions** (if repo is hosted on GitHub) | Pipeline per PRD §9.3: build → unit → integration → security → AI eval (mock LLM) → E2E → quality gate → deploy. Windows or Ubuntu runner both fine. |
| Quality gate | `scripts/quality-gate.ts` | Reads test + eval outputs, compares against thresholds in `quality-gates.json`, exits non-zero on failure (QG-01…14). Same script powers the Quality Center RELEASE STATUS. |

### 3.6 Observability and operations

| Concern | Choice | Notes |
|---|---|---|
| Health checks (NFR-OPS-02) | Fastify routes `/health/live`, `/health/ready` probing SQLite, LLM reachability, retrieval index | |
| Metrics (FR-OBS) | Counters/histograms stored in SQLite tables, exposed at `/metrics.json`; Ops dashboard page renders them | Avoid Prometheus stack (no Docker). Optional `prom-client` if a text `/metrics` endpoint is wanted. |
| Deployment (NFR-OPS-01) | `npm run build` → single Node process serving API + `web/dist`. For demo: local. Optional: package as a Windows service with `node-windows`, or deploy to any Node host. | |
| Backup (NFR-OPS-07) | SQLite `VACUUM INTO 'backup.db'` on a schedule via `scripts/backup.ts` | |

---

## 4. Dependency list (initial `package.json`)

Runtime:

```
fastify @fastify/cookie @fastify/session @fastify/multipart @fastify/static @fastify/cors
zod fastify-type-provider-zod
pino pino-pretty
@anthropic-ai/sdk
pdf-parse mammoth exceljs file-type
react react-dom react-router
```

Dev:

```
typescript @types/node @types/react @types/react-dom
vite @vitejs/plugin-react
@playwright/test          (unit + integration + security + adversarial + e2e)
c8                        (coverage for the non-browser Playwright projects)
@biomejs/biome
```

Optional dev: `@playwright/experimental-ct-react`, `playwright-bdd` or `@cucumber/cucumber`.

No dependency above requires a native build on Windows x64.

---

## 5. Setup sequence (first day)

```powershell
# 0. One-time: let Node trust the corporate proxy CA, then open a new terminal
setx NODE_USE_SYSTEM_CA 1

# 1. Verify registry access
npm ping                      # expect: npm notice PONG

# 2. Initialise repo
git init
npm init -y

# 3. Install stack (see §4)
npm install fastify @fastify/cookie @fastify/session @fastify/multipart @fastify/static @fastify/cors zod fastify-type-provider-zod pino pino-pretty @anthropic-ai/sdk pdf-parse mammoth exceljs file-type react react-dom react-router
npm install -D typescript @types/node @types/react @types/react-dom vite @vitejs/plugin-react @playwright/test c8 @biomejs/biome

# 4. Browsers for E2E (Chromium only)
npx playwright install chromium

# 5. Secrets (never committed)
#    .env  ->  ANTHROPIC_API_KEY=...   SESSION_SECRET=...   DB_PATH=./data/workbench.db
#    run with:  node --env-file=.env src/server.ts
```

Optional CLI installs via winget: `SQLite.SQLite`, `GitHub.cli`.

---

## 6. Proposed repository layout

```
sentinel1/
├── documents/                  STAGE docs, PRD, tools.md, hackathon_draft.txt
├── logs/                       token_log.md
├── scripts/                    token_report.ps1, probe_sqlite.mjs, migrate.ts, quality-gate.ts, backup.ts
├── src/
│   ├── server.ts               Fastify bootstrap, serves web/dist in prod
│   ├── config/                 zod-validated env + risk-model loader
│   ├── db/                     node:sqlite connection, migrations/*.sql, repositories
│   ├── domain/                 risk engine (pure functions), workflow state machine, RBAC matrix
│   ├── agents/                 parser, extraction, scoping, retrieval, assessment, context builder
│   ├── llm/                    SDK client, mock client, token accounting
│   ├── routes/                 cases, documents, assessments, decisions, audit, health, metrics, quality
│   └── audit/                  append-only event writer
├── web/                        Vite + React app
├── prompts/<agent>/v<N>.md     versioned prompts
├── policies/                   synthetic policy documents (AML Policy, TM Standard, Sanctions Policy)
├── evaluations/
│   ├── golden_dataset/         RA-001…RA-050 JSON cases
│   ├── run.ts                  evaluation runner
│   └── results/                timestamped outputs consumed by Quality Center
└── tests/
    ├── unit/  integration/  e2e/  security/  adversarial/
```

---

## 7. Tool → PRD traceability (summary)

| PRD area | Tooling |
|---|---|
| FR-INT intake & files | Fastify multipart, file-type, pdf-parse / mammoth / exceljs |
| FR-EXT / FR-SCP / FR-ASM agents | @anthropic-ai/sdk, zod schemas, versioned prompt files |
| FR-RET retrieval | SQLite FTS5 (built-in) |
| FR-RSK risk engine | Pure TypeScript module, unit-tested with node:test/Vitest |
| FR-WF / FR-RBAC / FR-OVR | Fastify preHandlers, session plugin, state machine module |
| FR-AUD immutable audit | SQLite table with `BEFORE UPDATE/DELETE` triggers that `RAISE(ABORT)` |
| FR-VER versioning | Prompt hashes, risk_model_versions and policy_versions tables |
| FR-FAIL / FR-ADV | Mock LLM client fixtures, zod validation, bounded retry, injection heuristic |
| FR-QC Quality Center | evaluations/results + test reports rendered in React |
| FR-OBS / NFR-OPS | pino, health routes, metrics tables, Ops dashboard page |
| FR-TOK token efficiency | llm_calls table from SDK usage; baseline vs optimized run in evaluations |
| EV-* evaluation | evaluations/run.ts + golden_dataset |
| QG-* / NFR-CI | scripts/quality-gate.ts + GitHub Actions |
| E2E-001…010 | Playwright (+ optional Cucumber) |

---

## 8. Decisions still open

| # | Decision | Default if not decided |
|---|---|---|
| T-01 | ~~Test runner~~ **Decided 2026-09-28: Playwright Test for all levels (unit, integration, security, adversarial, E2E).** | — |
| T-02 | LLM provider and model IDs for routing (PRD OQ-07) | Anthropic SDK; small model for extraction, larger for assessment |
| T-03 | Styling: plain CSS vs Tailwind | Plain CSS modules to start |
| T-04 | Monorepo with npm workspaces (`api/`, `web/`) vs single package | Single package, `src/` + `web/` |
| T-05 | BDD/Cucumber layer for E2E | Skip unless judges request readable scenarios |
| T-06 | Git hosting for CI (GitHub?) | GitHub + Actions |
| T-07 | Where `ANTHROPIC_API_KEY` comes from (personal vs team key) | Team decision; store in `.env`, never commit |

---

## 9. VS Code extensions for development

Marketplace IDs are given so they can be installed from the terminal. `.vscode/extensions.json` in the repo lists the same set under `recommendations`, so VS Code will prompt anyone who opens the folder.

### 9.1 Already installed on this machine

| Extension ID | Purpose |
|---|---|
| `ms-playwright.playwright` | Test Explorer, run/debug single tests, trace viewer, codegen, pick locator. Primary test tool for all levels. |
| `anthropic.claude-code` | AI-assisted requirements, design, development, testing (SDLC Automation criterion). |
| `cucumberopen.cucumber-official` | Gherkin support if the optional BDD layer is adopted. |
| `alexkrechik.cucumberautocomplete` | Step autocomplete for Gherkin. |
| `ms-vscode.live-server` | Not needed once Vite is running; harmless. |

### 9.2 To install (required)

| Extension ID | Purpose | PRD / workflow link |
|---|---|---|
| `biomejs.biome` | Lint + format on save for TS/JS/JSON; matches the Biome CLI used in CI. | Code quality, NFR-CI |
| `qwtel.sqlite-viewer` | Open the SQLite `.db` file read-only inside VS Code: inspect cases, audit events, llm_calls. Pure-JS, no native binary. | FR-AUD, FR-TOK debugging |
| `humao.rest-client` | `.http` files to exercise the Fastify API by role (login as Product Owner / Analyst / Committee, attempt forbidden actions). Requests live in the repo and double as API docs. | FR-RBAC, TEST-016/017/030 |
| `mikestead.dotenv` | Syntax highlighting for `.env`, `.env.test`. | NFR-OPS-05/06 |
| `usernamehw.errorlens` | Inline display of TS and Biome diagnostics. | Developer speed |
| `christian-kohler.npm-intellisense` | Autocomplete package names in imports. | Developer speed |
| `christian-kohler.path-intellisense` | Autocomplete file paths (prompts, policies, fixtures). | Developer speed |
| `eamodio.gitlens` | Blame, history, compare; useful when demonstrating SDLC traceability to judges. | SDLC Automation |
| `github.vscode-github-actions` | Author and monitor the CI pipeline from the editor. | NFR-CI |
| `github.vscode-pull-request-github` | Review PRs in-editor (only if hosted on GitHub). | SDLC Automation |
| `yzhang.markdown-all-in-one` | TOC, table formatting for the STAGE documents and PRD. | Documentation |
| `bierner.markdown-mermaid` | Render Mermaid diagrams (pipeline, workflow state machine) in stage docs. | Documentation |
| `streetsidesoftware.code-spell-checker` | Catches typos in prompts, policy documents, UI copy. | Quality of prompts and synthetic data |
| `editorconfig.editorconfig` | Consistent whitespace/line endings across the team (Windows CRLF vs LF). | Code quality |

### 9.3 To install (optional, by choice)

| Extension ID | Install when |
|---|---|
| `bradlc.vscode-tailwindcss` | If Tailwind is chosen for styling (T-03). |
| `dsznajder.es7-react-js-snippets` | If the team wants React snippets. |
| `formulahendry.auto-rename-tag` | JSX tag renaming convenience. |
| `ms-vscode.vscode-js-profile-flame` | Profiling the Node API if latency metrics (FR-OBS-01) look wrong. |
| `redhat.vscode-yaml` | Editing GitHub Actions workflow YAML with schema validation. |
| `tamasfe.even-better-toml` | Only if any TOML config appears (not expected). |

### 9.4 Not needed for this stack

| Extension ID | Reason |
|---|---|
| `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode` | Replaced by Biome. Do not install alongside to avoid format conflicts. |
| `vitest.explorer` | Vitest not used; Playwright is the runner. |
| `ms-python.*` | Python excluded from the toolchain. |
| `ms-azuretools.vscode-docker` | No Docker on this machine. |

### 9.5 Install commands

```powershell
# Required
code --install-extension biomejs.biome
code --install-extension qwtel.sqlite-viewer
code --install-extension humao.rest-client
code --install-extension mikestead.dotenv
code --install-extension usernamehw.errorlens
code --install-extension christian-kohler.npm-intellisense
code --install-extension christian-kohler.path-intellisense
code --install-extension eamodio.gitlens
code --install-extension github.vscode-github-actions
code --install-extension github.vscode-pull-request-github
code --install-extension yzhang.markdown-all-in-one
code --install-extension bierner.markdown-mermaid
code --install-extension streetsidesoftware.code-spell-checker
code --install-extension editorconfig.editorconfig
```

Extension downloads go through VS Code's own HTTPS client, which trusts the Windows certificate store, so they should work through the Netskope proxy without the Node workaround. If the Marketplace is blocked by policy, download the `.vsix` files and use `code --install-extension <file>.vsix`.
