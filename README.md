# FinSentinel

**Financial Crime Risk Assessment Workbench** — hackathon build.

> AI prepares. Rules calculate. Humans decide.

FinSentinel helps Financial Crimes Risk Management analysts assess the financial-crime risk of new products and changes. AI agents extract facts from submitted documents, retrieve policy evidence, and draft an evidence-cited assessment. A deterministic risk engine calculates inherent and residual risk. Humans review, override with rationale, and decide. Every material action lands in an append-only, hash-chained audit trail. Only synthetic data is used.

## Quick start (Windows, Node 24)

One-shot install (checks Node ≥ 24, sets `NODE_USE_SYSTEM_CA=1`, creates `.env` with a generated secret, `npm ci`, migrates + seeds, builds the web app):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1            # add -RunTests, -WithChromium, -Start as needed
```

Or step by step:

```powershell
setx NODE_USE_SYSTEM_CA 1          # once: let Node trust the corporate proxy CA, then open a new terminal
copy .env.example .env             # mock LLM gateway by default; add ANTHROPIC_API_KEY + LLM_GATEWAY=anthropic for the real model
npm install
npm run build                      # React web app → web/dist
npm start                          # http://localhost:3000  (seeds demo cases RA-1001, RA-1002 on first run)
```

Sign in by choosing a role tile (simulation mode, no password): **Pat Owner** (Product Owner), **Kim Analyst** (FCRM Analyst), **Lee Committee** (Risk Committee), **Raj Admin** (FCRM Administrator).

## Verify

```powershell
npm test            # 52 tests: unit, integration, security, adversarial (Playwright, no browser)
npm run eval        # golden-dataset evaluation → evaluations/results/<timestamp>.json
npm run gate        # release gate: software + AI + governance gates → PASS/FAIL
npm run test:e2e    # Chromium walkthrough in light and dark themes (npx playwright install chromium first)
```

## Deploy (Stage 05)

A Git tag `v*` runs `.github/workflows/release.yml`: the CI gate again → versioned zip + SBOM + GitHub Release → staging deploy on a self-hosted Windows runner → smoke test → human approval on the `production` environment → production deploy with pre-deploy backup, smoke test and automatic rollback. GitHub set-up (branch protection, environments, variables, runner labels) is in `documents/STAGE05_Deployment.md` §5.

```powershell
.\scripts\deploy.ps1 -Environment staging -Ref v0.1.0          # clone tag → npm ci → build → backup → switch → start (Task Scheduler) → smoke
.\scripts\deploy.ps1 -Environment production -Status           # current release, task state, /health/ready
.\scripts\deploy.ps1 -Environment production -Rollback -RestoreDb
npm run smoke -- --url=http://127.0.0.1:3000                    # 8 post-deploy checks
npm run backup ; npm run restore -- --latest                   # VACUUM INTO backup; restore dry run (add --yes to apply)
```

## Where things are

| Area | Path |
|---|---|
| Requirements, design, tools | `documents/` (STAGE01 PRD, STAGE02 architecture / data model / UX, tools.md) |
| Testing report and user manual | `documents/STAGE04_Testing_Report.md`, `documents/STAGE04_User_Manual.md` + `.pdf` (screenshots + diagrams in `documents/manual/`; regenerate with `npm run manual:capture`, then `npm run manual:pdf`) |
| Deployment approach and go-live path | `documents/STAGE05_Deployment.md`; animated workflow `documents/STAGE05_Deployment_Workflow.html`; `.github/workflows/release.yml`, `scripts/deploy.ps1`, `scripts/smoke.ts`, `scripts/restore.ts`, `Dockerfile` |
| API + pipeline | `src/` (see `CLAUDE.md` for the layering rules and invariants) |
| Web app | `web/` |
| Prompts (versioned) | `prompts/<agent>/vN.md` |
| Synthetic policy corpus | `policies/*.md` |
| Risk model, LLM routing, quality gates | `config/` |
| Tests and fixtures | `tests/` |
| Golden dataset + evaluation runner | `evaluations/` |
| Token usage log for the submission | `logs/token_log.md` |

## Judging map

| Criterion | Where to look |
|---|---|
| AI harness & orchestration | `src/agents/orchestrator.ts`, `src/agents/context-builder.ts`, `src/llm/` |
| SDLC automation | `documents/`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `CLAUDE.md` |
| Human-in-the-loop & governance | `src/domain/rbac.ts`, `src/domain/workflow.ts`, `src/audit/writer.ts`, `src/services/decision.ts` |
| Evaluation framework | `evaluations/`, `config/quality-gates.json`, `src/services/quality.ts` |
| Context engineering | `src/agents/context-builder.ts`, `src/agents/retrieval.ts`, `src/agents/schemas/` |
| Production readiness | `/health/live`, `/health/ready`, `src/services/metrics.ts`, `scripts/backup.ts`, `scripts/restore.ts`, `scripts/deploy.ps1` (backup → deploy → smoke → rollback), `documents/STAGE05_Deployment.md` |
| Token efficiency | `llm_calls` table, `/api/metrics`, Quality Center tokens tile, `logs/token_log.md` |
| Engineering judgement | `src/domain/risk-engine.ts` (deterministic), fail-safe paths in `src/agents/orchestrator.ts` |
