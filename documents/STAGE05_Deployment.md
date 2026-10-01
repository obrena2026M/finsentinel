# FinSentinel — STAGE05 Deployment

*FinSentinel — Financial Crime Risk Assessment Workbench*

| Field | Value |
|---|---|
| Stage | **STAGE05 — Deployment** (production deployment approach and go-live path) |
| Date | 2026-10-01 |
| Inputs | PRD NFR-OPS-01…08, NFR-CI-01…03, NFR-SEC-09/10, NFR-REL-02/03, AC-15/16; Architecture §13, §16; tools.md §2 (environment constraints); Stage 04 gaps ("CI still not executed on GitHub", "Linux/macOS deployment is Stage 05 work") |
| Hosting | GitHub (public repository), GitHub Actions, self-hosted Windows runners for staging and production |
| Result | Release pipeline (`.github/workflows/release.yml`) with two human gates; immutable-release Windows deployment (`scripts/deploy.ps1`) with backup, smoke test and automatic rollback, **verified end to end on the dev machine as staging** (three deploy runs, one manual rollback; two real defects found and fixed, §12); production hardening in code with tests (102 non-browser tests pass); animated workflow page `STAGE05_Deployment_Workflow.html`; GitHub set-up requirements in §5 |

New requirement IDs introduced in this stage use the prefix **`DEP-`** (deployment steps, gates and safeguards). They are referenced in workflow comments, script headers, code comments and test names.

---

## 1. Deployment approach in one paragraph

FinSentinel is one Node 24 process (Fastify API + built React app + SQLite file) with a single outbound dependency (the Anthropic API, or the fixture-backed mock gateway). The deployment unit is a **Git tag**. Every push already runs the full gate on GitHub Actions; a tag runs the same gate again, packages one immutable artefact, deploys it to **staging** on a self-hosted Windows runner, smoke-tests it, and then waits for a **human approval** on the GitHub `production` environment. The production job backs up the database, switches an immutable release directory, starts the app under Task Scheduler, runs the smoke test, and **rolls back automatically** (previous release + pre-deploy backup) if the smoke test fails. The go-live is a demo go-live on the mock gateway (user decision, §11); switching to the real Anthropic gateway is a configuration change with its own gate (§11.4).

Principles carried from the design, and how they show up here:

| Principle | Deployment consequence |
|---|---|
| AI prepares, rules calculate, humans decide (PR-01…) | Automation prepares and verifies a release; deterministic scripts deploy it; a named human approves production (DEP-06). No deployment step is driven by an LLM. |
| Single process, no Docker on the dev machine (AD-01, tools.md) | Primary profile is a Windows host with Node 24 and Git; nothing to compile, no container runtime needed. A container image is built only on GitHub runners (profile B). |
| Synthetic data only (NFR-SEC-10) | Production refuses to seed demo cases unless an operator opts in explicitly (DEP-07); the seeded users remain synthetic role tiles (AUTH_MODE=simulation). |
| Fail safe (NFR-REL-02) | Every deploy has a recovery point (backup) and an automatic return path (rollback). A failed deploy leaves the previous release running, never a half-upgraded one. |

---

## 2. Environments and promotion path

| Environment | Where | Purpose | Gateway | Seed | Config profile | Promoted by |
|---|---|---|---|---|---|---|
| Local | developer machine | build, `npm test`, manual checks | mock | demo cases | `.env` from `.env.example` | push |
| CI | GitHub-hosted `ubuntu-latest` | lint, types, tests + coverage, AI eval, e2e, quality gate | mock | in-memory | `.env.test` equivalent (job env) | merge to `main` after review (DEP-01) |
| Staging | self-hosted Windows runner, label `finsentinel-staging`, port 3001 | prove the release artefact deploys and runs under the production profile; UAT | mock | demo cases (opt-in `ALLOW_SEED=1`) | `NODE_ENV=production` | tag `v*` (DEP-03) |
| UAT sign-off | staging URL | role walkthrough per the user manual (Owner → Analyst → Committee → Admin) | mock | demo cases | — | human (DEP-06) |
| Production | self-hosted Windows runner, label `finsentinel-production`, port 3000 | live use | mock at go-live (§11); anthropic after the real-model gate | none by default | `NODE_ENV=production`, `SEED_ON_START=0` | GitHub Environment approval (DEP-06) |

Staging and production run the same script, the same artefact and the same profile; they differ only in `shared\.env` values (port, seed opt-in, later the API key).

---

## 3. Release pipeline (`.github/workflows/release.yml`)

The animated version of this table is `documents/STAGE05_Deployment_Workflow.html` (open it in any browser; no network needed; click a step for details).

| # | Step | Job / tool | Gate type | ID | What it produces or blocks |
|---|---|---|---|---|---|
| 1 | Push / pull request to `main` | developer, branch protection | — | DEP-01 | CI status check required; one approving review required |
| 2 | Lint + type-check | `ci.yml` (`npm ci`, Biome, `tsc --noEmit`) | automated | DEP-02 | fails on style/type errors |
| 3 | Tests + coverage, build, e2e | `ci.yml` (c8 + Playwright; Chromium light/dark) | automated | DEP-02, QG-01…05 | 102 non-browser tests, thresholds 95/80/95; 10 browser tests |
| 4 | AI evaluation + quality gate | `ci.yml` (`evaluations/run.ts --gateway=mock`, `scripts/quality-gate.ts`) | automated | DEP-02, QG-06…14 | PASS/FAIL across software, AI and governance thresholds |
| 5 | PR review and merge | reviewer | **human** | DEP-01, DEP-06 | nothing reaches `main` unreviewed |
| 6 | Tag `vX.Y.Z` on `main` | release manager | — | DEP-03 | the deployment unit |
| 7 | Verify + package | `release.yml` → `verify` (calls `ci.yml`), `package` | automated | DEP-02, DEP-03, DEP-12 | `finsentinel-vX.Y.Z.zip` + `.sha256` + `sbom.cyclonedx.json`, GitHub Release; optional GHCR image (`CONTAINER_IMAGE=true`) |
| 8 | Deploy to staging | `deploy-staging` on `[self-hosted, windows, finsentinel-staging]` | automated | DEP-04, DEP-08 | `scripts/deploy.ps1 -Environment staging -Ref vX.Y.Z` |
| 9 | Smoke test + UAT | `scripts/smoke.ts` (inside deploy), then people | automated + human | DEP-09 | 8 HTTP checks (§9.3); UAT per user manual |
| 10 | Production approval | GitHub Environment `production`, required reviewers | **human** | DEP-06 | job waits until a named reviewer approves |
| 11 | Back up database | `scripts/backup.ts` (VACUUM INTO) | safeguard | DEP-10 | recovery point for this deployment |
| 12 | Deploy to production | `deploy-production` on `[self-hosted, windows, finsentinel-production]` | automated | DEP-05, DEP-07, DEP-08, DEP-14 | new release directory, `current` junction switched, task restarted |
| 13 | Migrate + smoke test | app start (idempotent migrations) + `scripts/smoke.ts --expect-build=<sha>` | safeguard | DEP-09 | proves the *new* release answers (`BUILD_SHA` on `/health/live`); failure → automatic rollback (DEP-11) and red job |
| 14 | Go-live + hypercare | operations + FCRM Admin | **human** | DEP-13 | checklist §11.3 signed; hand-over to Stage 06 |

Workflow mechanics worth knowing:

- `verify` **reuses `ci.yml`** through `workflow_call`, so the release gate and the push gate cannot drift apart (DEP-02).
- `concurrency: release` serialises releases; a second tag queues behind the first.
- Deploy jobs are enabled by the repository variable `DEPLOY_ENABLED=true`. Until the runners exist, a tag still verifies and packages on GitHub-hosted runners and the deploy jobs are skipped rather than queued forever.
- `workflow_dispatch` allows a manual re-deploy of an existing ref to staging or production; it requires typing the ref into `confirm` so a mis-click cannot deploy.
- The `production` job needs `deploy-staging` to have succeeded in the same run: a release that never ran on staging cannot reach production.

---

## 4. Human gates and their rationale

The judging panel asks of every gate: what risk does it control, and why here? The answers for this stage:

| Gate | Where | Risk controlled | Why this position | Who |
|---|---|---|---|---|
| PR review (DEP-01) | before merge to `main` | Unreviewed logic reaching the release branch: risk engine, RBAC matrix, audit writer, prompts. Automation proves tests pass, not that the change is wanted. | Every release is cut from `main`; reviewing at merge is cheaper than reviewing at release. | any maintainer other than the author |
| UAT sign-off (DEP-06) | on staging, after smoke | Behaviour that passes tests but is wrong for the users: wording of AI claims, override flow, decision screen. | First point where the real artefact runs under the production profile with human-visible UI. | FCRM Analyst and Risk Committee users |
| Production approval (DEP-06) | between staging and production jobs | Deploying at the wrong moment (during a committee sitting), deploying a release UAT rejected, deploying with a configuration change not yet reviewed (`shared\.env`). | Last reversible moment before production data is touched; the approver sees staging results and release notes in one place. | operations lead or Risk Committee delegate (GitHub required reviewer) |
| Go-live sign-off (DEP-13) | after production smoke | Declaring live without verifying backup, audit chain and role access on the real host. | Health endpoints prove the process is up; the checklist proves the controls are up. | operations + FCRM Admin |

Automated safeguards are deliberately **not** human gates: backup (DEP-10), smoke test (DEP-09) and rollback (DEP-11) are deterministic and must run every time without waiting for someone.

---

## 5. GitHub requirements (what to configure)

Repository decision recorded with the user: **public repository**, which makes Environments with required reviewers, CodeQL and Dependabot available at no cost.

### 5.1 Repository

| Item | Setting | Why |
|---|---|---|
| Default branch | `main` (the initial commit was made on `main`) | `codeql.yml` and branch protection reference `main` |
| Branch protection on `main` | Require a pull request before merging (1 approval); require status check **`ci / pipeline`** to pass; require branches to be up to date; block force pushes | DEP-01, NFR-CI-02 |
| Tags | Protect `v*` tags (Settings → Tags → New rule) so only maintainers can create release tags | a tag is a deployment trigger |
| Actions permissions | Allow GitHub actions and reusable workflows; workflow permissions "Read repository contents" (the release workflow requests `contents: write` and `packages: write` itself) | least privilege |
| Releases | created automatically by `release.yml` from the tag with the zip, checksum and SBOM | DEP-03 |

### 5.2 Environments (Settings → Environments)

| Environment | Protection rules | Variables | Secrets |
|---|---|---|---|
| `staging` | none (deploys automatically after `package`) | `STAGING_PORT=3001`, `STAGING_URL=http://<staging-host>:3001` | none |
| `production` | **Required reviewers**: at least one named operations/committee user; optional wait timer; "Prevent self-review" on | `PRODUCTION_PORT=3000`, `PRODUCTION_URL=http://<prod-host>:3000` | `ANTHROPIC_API_KEY` only when switching the gateway (§11.4); otherwise none |

### 5.3 Repository variables (Settings → Secrets and variables → Actions → Variables)

| Variable | Value | Effect |
|---|---|---|
| `DEPLOY_ENABLED` | `true` once the runners are registered | enables `deploy-staging` and `deploy-production` |
| `CONTAINER_IMAGE` | `true` only if a Linux host will pull from GHCR | enables the `container` job (profile B) |

### 5.4 Secrets

No secret is needed for the default pipeline. `SESSION_SECRET` is **generated on the host** by `deploy.ps1` on the first deploy and lives only in `shared\.env` (DEP-14). CI jobs use a throw-away secret in the workflow file because they run on an in-memory database. When the real gateway is enabled, store `ANTHROPIC_API_KEY` as a **production environment secret** and copy it into `shared\.env` on the host by the deploy step, never into the repository.

### 5.5 Self-hosted runners (Settings → Actions → Runners → New self-hosted runner)

| Requirement | Staging host | Production host |
|---|---|---|
| OS | Windows 10/11 or Server 2019+ | same |
| Labels | `self-hosted`, `windows`, **`finsentinel-staging`** | `self-hosted`, `windows`, **`finsentinel-production`** |
| Software | Node ≥ 24 on PATH, Git on PATH, PowerShell 5.1+ | same |
| Runner service | install as a Windows service (`.\svc.cmd install` after `config.cmd`) running as a user that can register scheduled tasks | same |
| Network | outbound HTTPS to github.com and registry.npmjs.org (through the corporate proxy; `deploy.ps1` sets `NODE_USE_SYSTEM_CA=1`) | same, plus api.anthropic.com when the real gateway is enabled |
| Disk | ~1 GB for three retained releases plus data | same, sized for uploads and backups (§10) |
| Ports | 3001 free | 3000 free |

For the hackathon both labels can be registered on the **same machine** (two runner instances or one runner with both labels); the install directories (`C:\finsentinel\staging`, `C:\finsentinel\production`) and task names (`FinSentinel-staging`, `FinSentinel-production`) are distinct.

### 5.6 Security and hygiene

| Item | File | Note |
|---|---|---|
| Dependabot (npm + actions, weekly, grouped) | `.github/dependabot.yml` | DEP-12; each PR must pass the CI gate |
| CodeQL (JavaScript/TypeScript) | `.github/workflows/codeql.yml` | DEP-12; free for public repositories |
| Lockfile-exact installs | `npm ci` everywhere | supply-chain determinism |
| SBOM per release | `npm sbom --sbom-format cyclonedx --omit dev` | attached to the GitHub Release |
| Line endings | `.gitattributes` (`eol=lf`, `*.ps1 eol=crlf`) | same bytes on Windows dev, Ubuntu CI, Windows host |

### 5.7 First push (what has and has not been done)

Done in this stage: the repository was initialised on `main` with one commit containing Stages 01–05 (`git log --oneline` shows it). Not done, because it needs the user's GitHub account: creating the remote and pushing.

```powershell
git remote add origin https://github.com/<owner>/finsentinel.git
git push -u origin main
# then: branch protection (§5.1), environments (§5.2), variables (§5.3), runners (§5.5)
git tag -a v0.1.0 -m "FinSentinel 0.1.0" ; git push origin v0.1.0     # first release run
```

The commit author was set repo-locally to `OFBrena <OFBrena@users.noreply.github.com>`; amend with `git commit --amend --reset-author` after `git config user.name/user.email` if a different identity is wanted.

---

## 6. Host layout and deployment mechanics (`scripts/deploy.ps1`)

```
C:\finsentinel\<environment>\
  shared\.env                 environment configuration, created once with a generated SESSION_SECRET, never overwritten
  shared\data\finsentinel.db  SQLite database (+ -wal/-shm)
  shared\data\uploads\        uploaded documents
  shared\data\backups\        VACUUM INTO backups (BACKUP_DIR)
  shared\logs\                finsentinel-<yyyymmdd>.log / .err.log (pino JSON lines)
  releases\<ref>-<timestamp>\ git clone of the tag + node_modules + web\dist + copy of shared\.env
  current  →  releases\…      NTFS junction to the active release
  previous.txt                path of the release before the current one (rollback target)
```

Steps performed by one run of `deploy.ps1 -Environment <env> -Ref <tag>` (DEP-08):

1. **Preflight**: Node ≥ 24, npm, git on PATH; `NODE_USE_SYSTEM_CA=1` for the session; directory layout created.
2. **Fetch**: `git clone --depth 1 --branch <tag>` into a new release directory; the short SHA is printed.
3. **Configure**: create `shared\.env` on first deploy (profile per environment, §7), copy it into the release, and **validate it with the application's own schema** before anything is built (`loadEnv()`), so a bad configuration fails here and not after the switch.
4. **Build**: `npm ci` and `npm run build`; refuses to continue without `web\dist\index.html`.
5. **Backup** (DEP-10): `scripts/backup.ts` into `BACKUP_DIR`; the new file's path is the recovery point.
6. **Switch**: stop the previous server three ways (the scheduled task, any `node.exe` whose command line names this installation, and whatever process owns the port), wait until the port is free and **refuse to continue if it is still held**; then re-point `current` and record `previous.txt`.
7. **Start**: (re)register the Task Scheduler task `FinSentinel-<env>` (runs `scripts/service-run.ps1`, which starts `node --use-system-ca --env-file=.env src/server.ts` with stdout/stderr appended to `shared\logs`), trigger at logon, restart up to 3 times a minute apart, no execution time limit; then start it.
8. **Smoke** (DEP-09): `scripts/smoke.ts --expect-build=<sha>` against `http://127.0.0.1:<port>` with a 90 s start-up allowance. `BUILD_SHA` is appended to the release copy of `.env` in step 3 and reported by `/health/live`, so a leftover process from the previous release cannot pass the smoke test on behalf of the new one.
9. **Rollback on failure** (DEP-11): stop, restore the pre-deploy backup, switch `current` back, restart, smoke again, exit 1.
10. **Housekeeping**: keep the newest three releases (never the current or previous one).

Other entry points: `-Status` (current release, task state, process count, `/health/ready`), `-Rollback [-RestoreDb]` (manual return to `previous.txt`).

### 6.1 Why Task Scheduler rather than a Windows service wrapper

No service wrapper (NSSM, WinSW, `node-windows`) is in the approved toolchain, and the dev machine cannot compile native modules. Task Scheduler is built in, survives the deploying session (a process started by a GitHub runner job is killed when the job ends), restarts on failure and needs no admin rights when the trigger is "at logon of the deploying user". The trade-off is recorded in §13: on an unattended server the task should be re-registered as a service account with "Run whether user is logged on or not", which needs local admin once.

### 6.2 Profile B: container image (documented, built in CI only)

`Dockerfile` builds a two-stage `node:24-slim` image (build stage runs `npm ci` + `npm run build`; runtime stage installs production dependencies only, copies `src`, `config`, `prompts`, `policies`, `samples`, `tests/fixtures` (needed by the mock gateway) and `web/dist`, runs as the `node` user, declares `/data` as the volume for database, uploads and backups, exposes 3000 and defines a `HEALTHCHECK` on `/health/ready`). `HOST=0.0.0.0` inside the container; `SESSION_SECRET` must be passed at run time. The image is pushed to `ghcr.io/<owner>/finsentinel:<tag>` when `CONTAINER_IMAGE=true`. It is **not** tested in this stage because there is no Docker on the dev machine; the first GitHub run is its verification.

---

## 7. Configuration and secrets (NFR-OPS-05/06, DEP-05, DEP-14)

All configuration is environment variables validated by `src/config/env.ts` at start-up; an invalid value stops the process with a message naming the variable.

| Variable | Local / demo | Staging | Production | Added in Stage 05 |
|---|---|---|---|---|
| `NODE_ENV` | unset | `production` | `production` | guard semantics |
| `PORT` / `HOST` | 3000 / 127.0.0.1 | 3001 / 127.0.0.1 | 3000 / 127.0.0.1 (0.0.0.0 only in a container or behind a proxy on another host) | `HOST` ✓ |
| `DB_PATH`, `UPLOAD_DIR`, `BACKUP_DIR` | `./data/...` | `shared\data\...` | `shared\data\...` | `BACKUP_DIR` ✓ |
| `SESSION_SECRET` | from installer | generated by deploy | generated by deploy | — |
| `AUTH_MODE` | simulation | simulation | simulation (synthetic role tiles; `password` mode is reserved) | — |
| `LLM_GATEWAY` / `ANTHROPIC_API_KEY` | mock / — | mock / — | mock at go-live; anthropic + key after §11.4 | — |
| `SEED_ON_START` / `ALLOW_SEED` | 1 / — | 1 / 1 | **0 / 0** | `ALLOW_SEED` ✓, strict parsing ✓ |
| `MOCK_LATENCY_MS` | 1800 | 1800 | 1800 (demo pacing) | — |
| `TRUST_PROXY` | 0 | 0 | 1 when behind a TLS-terminating reverse proxy | ✓ |
| `COOKIE_SECURE` | 0 | 0 | 1 when served over HTTPS (the session cookie is then only issued on HTTPS requests) | ✓ |
| `CORS_ORIGIN` | unset (reflect) | unset | `https://<host>` allow-list | ✓ |
| `LOG_LEVEL` | info | info | info | — |

Secrets never live in the repository: `.env` is git-ignored, the installer and deploy script generate `SESSION_SECRET`, logs redact the API key and cookies (Architecture §13), and the only CI secret is a throw-away value for an in-memory database.

---

## 8. Production hardening done in this stage (code)

| Change | Files | Requirement | Test |
|---|---|---|---|
| Strict boolean parsing for env flags. **Defect found:** `z.coerce.boolean()` treats `"0"` and `"false"` as `true`, so `SEED_ON_START=0` would still have seeded demo cases. | `src/config/env.ts` | DEP-07, NFR-SEC-10 | `tests/unit/foundations.spec.ts` "parses deployment flags strictly" |
| Production seed guard at start-up: `NODE_ENV=production` + `SEED_ON_START=1` is refused unless `ALLOW_SEED=1` (the guard previously existed only in `scripts/seed.ts`, not in the server start path). | `src/config/env.ts` | DEP-07 | same |
| Bind address from `HOST`; start-up log shows host, port, gateway, auth mode and `NODE_ENV`. | `src/server.ts` | DEP-05, NFR-OPS-03 | e2e server start |
| `TRUST_PROXY`, `COOKIE_SECURE`, `CORS_ORIGIN` wired into Fastify, session cookie and CORS. Local defaults unchanged. | `src/app.ts` | DEP-05, NFR-SEC-09 | `tests/security/rbac-routes.spec.ts` "production flags: Secure cookie and CORS allow-list" |
| `BACKUP_DIR` for backup and restore; restore script with integrity check, dry run by default, pre-restore copy. | `scripts/backup.ts`, `scripts/restore.ts` | DEP-10, DEP-11, NFR-OPS-07 | exercised on the local database (§12) |
| Smoke test script (8 checks, 9 with `--expect-build`). Exit status via `process.exitCode`, requests with `Connection: close` (see §12, run 2). | `scripts/smoke.ts` | DEP-09, NFR-OPS-02 | exercised by the staging deploy (§12) |
| Release identity: `BUILD_SHA` env (optional) reported by `/health/live`; written by the deploy script. | `src/config/env.ts`, `src/routes/system.ts`, `scripts/deploy.ps1` | DEP-09 | `tests/integration/services-and-routes.spec.ts` "health/live reports the release build identity"; unit env test |
| `npm run start:prod` uses `--env-file-if-exists` so containers can run without a `.env` file. | `package.json` | DEP-05 | — |

---

## 9. Verification artefacts

### 9.1 Quality gate inputs (unchanged, re-run)

`npm test`: **102 passed** (99 before this stage + strict env flags unit test + production flags security test + release identity integration test). `npm run test:e2e`: 10 passed (light + dark). `npx tsc --noEmit`: clean. `biome check .`: clean (two pre-existing CSS specificity warnings).

### 9.2 Workflow files

All four YAML files parse (`yaml` package): `ci.yml` (`push`, `pull_request`, `workflow_call`), `release.yml` (jobs `verify`, `package`, `container`, `deploy-staging`, `deploy-production`), `codeql.yml`, `dependabot.yml`. They have not yet executed on GitHub (no remote yet, §5.7).

### 9.3 Smoke test checks (`scripts/smoke.ts`)

Eight checks; nine when `--expect-build=<sha>` is given, which the deploy script always does.

| Check | Pass condition |
|---|---|
| startup | `/health/live` answers 200 within `--wait` ms (default 60 s; deploy uses 90 s) |
| identity | `/health/live` reports `build` equal to `--expect-build` (the release just deployed) |
| readiness | `/health/ready` 200 with `ok: true` (db, active risk model, FTS index populated, LLM configured) |
| web | `/` is 200 `text/html`; a deep link such as `/cases/RA-0000/x` falls back to the SPA |
| auth | `/api/cases` without a session is 401; `/api/auth/users` lists ≥ 4 synthetic users |
| errors | unknown API route is a JSON 404 without a stack trace |
| rbac | `/api/metrics` anonymous is 401 |

---

## 10. Backup, restore and rollback (NFR-OPS-07, DEP-10, DEP-11)

| Topic | Approach |
|---|---|
| Backup mechanism | `VACUUM INTO` (online, consistent snapshot of one transaction boundary; works while the server runs). Written to `BACKUP_DIR` as `finsentinel-<ISO timestamp>.db`. |
| When | Automatically before every deploy; manually with `npm run backup`; recommended scheduled task daily (Stage 06). |
| Restore | `node --env-file=.env scripts/restore.ts --latest` (dry run: integrity check, case and audit counts) then `--yes`. Server must be stopped; the current file is kept as `.pre-restore-<ts>`. |
| Rollback | Automatic in `deploy.ps1` when the smoke test fails; manual with `-Rollback [-RestoreDb]`. Switches `current` to `previous.txt` and restarts; `-RestoreDb` also restores the newest backup. |
| Recovery point objective | Pre-deploy backup for deployments (seconds of data at risk); daily backup otherwise (Stage 06 to tighten). |
| Recovery time objective | Rollback ≈ 1 minute (no rebuild: the previous release directory is intact). Restore from backup ≈ 1 minute plus the stop/start. |
| Audit chain | A backup is a single snapshot, so the SHA-256 hash chain in `audit_events` stays verifiable after restore. Rolling back discards events written after the snapshot; the deploy log records the window. |
| Uploads | Stored under `shared\data\uploads`; not part of the SQLite backup. Back up the directory with the same schedule (Stage 06). |

---

## 11. Go-live path

### 11.1 Timeline

| When | Action | Owner | Gate |
|---|---|---|---|
| T-5 d | Push to GitHub, confirm `ci` is green on `main`; configure branch protection, environments, variables (§5) | maintainer | DEP-01 |
| T-4 d | Register the staging and production runners; set `DEPLOY_ENABLED=true` | operations | §5.5 |
| T-3 d | Tag `v0.1.0`; watch `release`: verify → package → staging; review `shared\.env` on the staging host | release manager | DEP-02…04 |
| T-2 d | UAT on staging per user manual (one journey per role); record findings; fix-forward with `v0.1.1` if needed | analyst, committee | DEP-06 |
| T-1 d | Approve `production` in GitHub; deploy; smoke passes; review `shared\.env` on the production host (seed flags 0/0) | approver, operations | DEP-06…09 |
| T-0 | Go-live checklist (§11.3) signed; announce; hypercare starts | operations, FCRM Admin | DEP-13 |
| T+1 w | Hypercare review → Stage 06 (monitoring, backup schedule, real-model gate) | operations | — |

### 11.2 Mock gateway at go-live (user decision)

The user chose a **demo go-live on the mock gateway**: no API key is needed, every pipeline run is deterministic (fixture-backed) and the quality gate thresholds in `config/quality-gates.json` remain those calibrated for the fixtures. Users see the full workflow, including grounding failures that the fixtures include on purpose. The switch to the real model is §11.4.

### 11.3 Go-live checklist (DEP-13)

| # | Check | Evidence |
|---|---|---|
| 1 | `release` run green through `deploy-production` | GitHub Actions run URL |
| 2 | `deploy.ps1 -Environment production -Status` shows the expected tag, task `Running`, `/health/ready` ok | console output |
| 3 | `shared\.env` reviewed: `NODE_ENV=production`, `SEED_ON_START=0`, `ALLOW_SEED=0`, `LLM_GATEWAY=mock`, `SESSION_SECRET` ≥ 32 chars | operator initials |
| 4 | Pre-deploy backup present in `shared\data\backups` and `restore.ts --latest` dry run reports integrity ok | console output |
| 5 | Role walkthrough: each of the four tiles signs in; Product Owner cannot see the decision block; only Committee can decide; override requires rationale | manual §4–§8 screenshots or live |
| 6 | Audit chain verified from the Ops/Quality screen or `verifyChain` | screenshot |
| 7 | Logs flowing to `shared\logs\finsentinel-<date>.log` (JSON lines, no secrets) | tail of the file |
| 8 | Rollback rehearsed once on staging (`-Rollback`) and documented timing | deploy log |
| 9 | Hypercare roster and escalation path agreed | names and hours |

### 11.4 Switching to the real Anthropic gateway (post go-live gate)

1. Store `ANTHROPIC_API_KEY` as a `production` environment secret; the operator writes it into `shared\.env` with `LLM_GATEWAY=anthropic`.
2. Run the evaluation on staging with the real model: `npm run eval -- --gateway=anthropic`; compare against the fixture baseline; tighten `unsupportedClaimRate` to 0.05 and `groundingSupportedRate` to 0.9 as the gate file notes.
3. Approve the configuration change like a release (same `production` environment reviewer), restart the task, smoke test, and watch `llm_calls` cost on the Quality Center tokens tile for the first day.

---

## 12. Verification performed on the dev machine

Staging deployments were executed on the development machine acting as the staging host, cloning the committed `main` branch into a scratch install directory (`...\finsentinel-staging`, port 3201, task `FinSentinel-staging`). Three runs were needed; each failure was a real defect that the pipeline would otherwise have carried to GitHub. Afterwards the scheduled task was unregistered, the server stopped and the scratch directory deleted, so the machine is left as found.

### 12.1 Runs

| Run | Ref | Outcome | Finding | Fix |
|---|---|---|---|---|
| 1 | `main @ 9dd7da8` | **failed** at step 3 | The configuration check imported the app's env schema before `npm ci`, so `zod` was missing. A local-path clone also warned that `--depth` is ignored. | Check moved after `npm ci`; shallow clone only for remote URLs; clean `FAILED:` output via `trap` |
| 2 | `main @ 9dd7da8` | **failed** at step 7 (8/8 checks had passed) | (a) `smoke.ts` crashed on exit with a libuv assertion (`UV_HANDLE_CLOSING`, exit 0xC0000409) because `process.exit()` ran while keep-alive sockets were closing. (b) Investigating the next run showed the server from this run was still bound to the port: `Stop-ScheduledTask` kills only the launcher and the stop logic matched the install path in the command line, which the launcher did not pass. The following deploy's server died with `EADDRINUSE` while the smoke test passed against the old process. | `process.exitCode` + `Connection: close`; launcher passes absolute paths; stop logic adds port-owner detection and waits for a free port; `BUILD_SHA` written to the release `.env`, reported by `/health/live`, asserted by `smoke.ts --expect-build` |
| 3 | `main @ 1726944` | **passed**: backup taken, old process (pid 17740) terminated by port owner, new release started, **9/9 checks** including `identity: expected 1726944, got 1726944`; `current` switched, `previous.txt` written | — | — |
| rollback | `-Rollback` | **passed** in 8 s wall time: task stopped, process terminated, `current` re-pointed to the previous release, restarted, 8/8 checks | The pre-BUILD_SHA release reports `build: null`, as expected | — |

`-Status` output after run 3: current and previous release paths, task `Running`, one node process, `/health/ready` 200 with all checks true. Start-up to `/health/live` took 19 s on the first start of a fresh database (migrations, reference seed, demo cases paced by `MOCK_LATENCY_MS`) and 3–4 s on later starts, within the 90 s allowance.

### 12.2 What this changed in the design

The smoke test now has to prove **which** release is answering, not only that something answers. That is the difference between "a deploy that works once" and a deployment that cannot silently keep the old code running.

---

## 13. Risks, limitations and open items

| Item | Impact | Mitigation / owner |
|---|---|---|
| The pipeline has not yet run on GitHub (no remote) | Workflows are YAML-validated and the deploy script is verified locally, but Actions-specific behaviour (environment approval UI, artifact upload, `gh release create`) is unexercised | First push and first tag are the first steps of §11.1; fix-forward with a patch tag |
| Task Scheduler task runs at logon of the deploying user | On an unattended server the app would not start after a reboot until someone logs on | Re-register the task with a service account and "run whether user is logged on or not" (needs admin once); or install a runner service account and use its logon |
| No TLS inside the process | Traffic between browser and host is plain HTTP on the intranet | Put IIS/ARR, nginx or a cloud load balancer in front; set `TRUST_PROXY=1`, `COOKIE_SECURE=1`, `CORS_ORIGIN` |
| SQLite single writer, single process | Horizontal scaling is not possible; vertical scaling and the 20 MB upload limit bound the load | Adequate for a workbench with tens of concurrent users; Stage 06 adds load measurement |
| Mock gateway in production at go-live | Assessments are fixture-backed, not model-generated | Deliberate demo scope; §11.4 is the gate for the real model |
| Container image untested locally | A Dockerfile mistake surfaces only in CI | `CONTAINER_IMAGE` is off by default; profile A is the verified path |
| `AUTH_MODE=simulation` | Anyone who can reach the port can pick a role tile | Intranet only, synthetic data only (NFR-SEC-10); `password` mode is the reserved upgrade (Architecture §13) |

---

## 14. Decisions in this stage (for the panel)

| Decision | Reason |
|---|---|
| Windows host via self-hosted GitHub runner as the implemented profile; container as documented profile B | Matches the only environment available (no Docker, no cloud account); verifiable end to end on the dev machine; a Dockerfile keeps the Linux path open at zero runtime cost |
| Reuse `ci.yml` through `workflow_call` instead of copying steps into `release.yml` | One gate definition; a tag cannot pass a weaker gate than a push |
| Tag is the deployment unit; staging and production deploy the same tag in the same run | Byte-identical code in both environments; production cannot run something staging did not |
| Human approval implemented as a GitHub Environment required reviewer | Native audit trail (who approved what, when), visible release notes and staging result at the point of decision, no custom code |
| Deploy jobs gated by `DEPLOY_ENABLED` | A tag pushed before the runners exist still produces a verified artefact instead of a job stuck in "queued" |
| Backup before switch, smoke after start, automatic rollback | Converts a failed deploy into a non-event; the recovery point is created by the same run that might need it |
| Task Scheduler instead of a service wrapper | Built in, no native dependency, no admin rights for the hackathon host; limitation recorded in §13 |
| Strict env flag parsing instead of documenting "use 1, not 0" | A deployment safeguard that depends on operators remembering a quirk is not a safeguard; the fix also removed a real bug |
| `SESSION_SECRET` generated on the host, not stored in GitHub | The secret never needs to exist anywhere but the host; rotation is "delete the line and redeploy" |
| Smoke test checks authorization and error shape, not only health | A release that is up but leaks stack traces or serves `/api/cases` anonymously must fail the deploy |
| Smoke test asserts the release identity (`BUILD_SHA`) | Found in verification: a leftover server passed the smoke test on behalf of a release that had crashed with `EADDRINUSE`; a deploy must prove the new code answers |
| Stop logic uses the port owner as the final authority | Task and command-line matching both failed once; the port is the one fact that cannot be wrong about which process serves traffic |

---

## 15. Traceability

| ID | Title | Satisfies | Evidence |
|---|---|---|---|
| DEP-01 | Protected `main`, required CI check, PR review | NFR-CI-01/02 | §5.1, `.gitattributes` |
| DEP-02 | Release re-runs the CI gate | NFR-CI-01/02/03, QG-01…14, AC-11/12 | `release.yml` job `verify` → `ci.yml` |
| DEP-03 | Immutable versioned artefact (zip, checksum, SBOM, GitHub Release) | NFR-OPS-01, AC-15 | `release.yml` job `package` |
| DEP-04 | Staging mirrors the production profile | NFR-OPS-01 | `release.yml` job `deploy-staging`, `deploy.ps1` profile |
| DEP-05 | Production configuration (`HOST`, `TRUST_PROXY`, `COOKIE_SECURE`, `CORS_ORIGIN`, `NODE_ENV`) | NFR-OPS-05, NFR-SEC-09 | `src/config/env.ts`, `src/app.ts`, security test |
| DEP-06 | Human gates: PR review, UAT, production approval | Human-in-the-loop criterion, AC-15 | §4, GitHub Environment `production` |
| DEP-07 | No demo seeding in production without explicit opt-in; strict flags | NFR-SEC-10 | `src/config/env.ts`, unit test |
| DEP-08 | Immutable release directories + Task Scheduler on the Windows host | NFR-OPS-01 | `scripts/deploy.ps1`, `scripts/service-run.ps1` |
| DEP-09 | Smoke test after every deploy, including release identity | NFR-OPS-02, NFR-OPS-08 | `scripts/smoke.ts`, `/health/live` `build` |
| DEP-10 | Pre-deploy backup as recovery point | NFR-OPS-07 | `scripts/backup.ts`, `deploy.ps1` step 5 |
| DEP-11 | Automatic and manual rollback; restore script | NFR-REL-02, NFR-OPS-07 | `deploy.ps1`, `scripts/restore.ts` |
| DEP-12 | Dependabot, CodeQL, lockfile installs, SBOM | Production readiness criterion | `.github/dependabot.yml`, `codeql.yml` |
| DEP-13 | Go-live checklist and hypercare hand-over | AC-15, AC-16 | §11.3 |
| DEP-14 | Secrets outside source; host-generated session secret | NFR-OPS-06 | §5.4, §7 |
