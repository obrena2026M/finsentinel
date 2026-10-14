# FinSentinel — STAGE05 Database Deployment & Seeding Workflow

*FinSentinel — Financial Crime Risk Assessment Workbench*

| Field | Value |
|---|---|
| Stage | **STAGE05 — Deployment** (database migration, initialization and seed workflow) |
| Date | 2026-10-14 |
| Inputs | Architecture AD-01, §13 and §16; STAGE05 Deployment DEP-07, DEP-09, DEP-10, DEP-11, DEP-14; NFR-OPS-07, NFR-SEC-10 |
| Scope | Explain current SQLite behavior and define a safe deployment pattern for supported local or cloud-hosted database targets |
| Status | Current SQLite workflow is implemented; provider-independent/cloud-engine support is future work |

> **Short answer:** Yes, a database deployment workflow can run migrations and approved seed data against either a local or cloud-hosted database. The workflow must target a database engine the application supports. FinSentinel currently supports SQLite only; pointing `DB_PATH` at a SQLite file on persistent cloud storage is not the same as supporting a managed PostgreSQL, MySQL or other SQL service.

## 1. What happens today

FinSentinel's deployed database is a SQLite file selected by `DB_PATH`. The Stage 05 Windows deployment script stores it under the host's shared data directory so it survives release-directory changes. At application startup, FinSentinel applies pending SQLite migrations and idempotently initializes reference data. Demo-case seeding is a separate opt-in.

| Data or operation | Current behavior | Production default |
|---|---|---|
| Schema migrations | `runMigrations()` applies unapplied, ordered SQL files and records each applied filename in `schema_migrations`; application startup runs this automatically. | Runs as part of app startup after the deployment has taken a pre-deploy backup. |
| Reference data | `seedReference()` inserts missing synthetic role users, the initial risk model, prompt versions and policy corpus data. It is called during app startup. | Runs during startup; this is application reference data, not demo-case seeding. |
| Demo cases | `SEED_ON_START=1` asks the server to create the synthetic demo cases. `npm run seed` is an explicit command that also creates demo cases. | Disabled by default. Startup seeding uses strict environment-flag parsing and requires `ALLOW_SEED=1` when `NODE_ENV=production`. The CLI seed script currently checks only whether `ALLOW_SEED` is non-empty; it must not be used as a production gate until that check is hardened. |
| Backup / restore | The current scripts use SQLite `VACUUM INTO` for backups and SQLite file replacement for restore. | Backup is taken before release switch; restore is available for rollback. |

The Stage 05 deployment script creates initial configuration with seeding enabled for staging and disabled for production. An existing `shared\.env` is deliberately left untouched during subsequent deploys, so operators must verify its values rather than assume the script resets them.

Relevant implementation: `src/db/connection.ts`, `src/db/seed.ts`, `src/server.ts`, `scripts/seed.ts`, `scripts/backup.ts`, `scripts/restore.ts`, and `scripts/deploy.ps1`.

## 2. Safe workflow for the current SQLite deployment

Use the existing release workflow and deploy script for a local SQLite file or a SQLite file hosted on a cloud machine with durable storage:

1. **Build and verify the release.** CI must pass before a release tag can be deployed (DEP-02, DEP-03).
2. **Choose the environment.** Deploy to staging first. Production requires the configured human approval (DEP-04, DEP-06).
3. **Verify the database configuration.** Confirm `DB_PATH` resolves to the intended persistent SQLite file and that the service account can access its directory. Keep the database and uploads outside the immutable release directory.
4. **Keep seed policy explicit.** Staging may opt into synthetic demo cases. Production should use `SEED_ON_START=0` and `ALLOW_SEED=0` unless an approved, time-bounded operation specifically requires synthetic demo data. Never seed customer or other real financial-crime data from fixtures. Do not run `npm run seed` in production: its current guard treats any non-empty `ALLOW_SEED` value (including `0` or `false`) as opt-in.
5. **Back up before changing releases.** `scripts/deploy.ps1` takes an online SQLite backup before switching the active release (DEP-10).
6. **Apply migrations and initialize reference data.** The new application process currently runs these on startup. Migration failures stop startup; the smoke test must not be treated as successful unless the new release is serving (DEP-09).
7. **Verify the release.** Run the deployment smoke test and check the reported build identity. On failure, the existing deployment rollback restores the prior release and its SQLite recovery point (DEP-11).
8. **Review the result.** Confirm readiness, migration logs, expected reference data and that demo cases were not created in production.

For a developer-local database, `npm run migrate` and `npm run seed` operate on the configured `DB_PATH`. `npm run seed` is not a safe generic production initialization command: in production its current guard refuses only when `ALLOW_SEED` is unset, and when permitted it creates synthetic demo cases. Use the normal staged deployment path for deployed environments; harden the CLI guard before wiring it into any production workflow.

## 3. Extending the workflow to cloud databases

There are two different meanings of “cloud database”:

1. **SQLite on cloud-hosted compute or durable mounted storage.** This can use the current database code if the filesystem provides durable storage and correct SQLite locking/WAL semantics. Confirm the host's storage guarantees, single-writer behavior, backup/restore procedure and recovery behavior before production use. Do not assume an arbitrary network share is a safe SQLite database location.
2. **A managed database service using another engine.** This is **not supported by the current application**. A workflow alone cannot make it work. First add and test a database adapter/driver, engine-specific migrations and seed operations, transaction and locking behavior, full-text-search parity, and provider-appropriate backup/restore. The current SQLite `DB_PATH`, `VACUUM INTO`, WAL settings and file-based restore cannot be reused unchanged.

Once an engine is supported, its deployment workflow should separate schema migration from demo-data seeding. The migration command should use the application's database adapter, not hand-written SQL in the CI workflow. Prefer a one-off migration job with exclusive migration locking when multiple application instances can start concurrently; retain startup migrations only where the runtime and database locking model make that safe.

## 4. Target-independent deployment sequence

The following is the recommended shape for a future provider-aware workflow. Provider-specific commands, credentials and backup mechanisms must be supplied only after that provider is implemented and tested.

```text
release verification
        |
        v
select protected environment + database target
        |
        v
validate target identity, connectivity, permissions and engine compatibility
        |
        v
take provider-appropriate backup / recovery point
        |
        v
apply pending versioned migrations once, with concurrency protection
        |
        v
apply only approved, idempotent reference-data seeds
        |
        v
verify schema version, reference-data checks and database health
        |
        v
deploy application + run release-identity and health smoke tests
        |
        +---- failure ----> restore/roll forward using the approved recovery plan
```

Demo fixtures should be a distinct, non-production step:

```text
if target is local or staging and demo seeding is explicitly enabled:
    seed synthetic demo cases
else:
    skip demo fixtures
```

Do not put seed credentials or arbitrary target connection strings in workflow inputs, source files or logs. Store credentials in the protected environment's secret store, scope them to the target, and print only a redacted target identifier. Production seeding should require explicit approval and confirmation of both the environment and target; a typo or an untrusted workflow input must not be able to redirect seeds to production.

## 5. Safety, repeatability and recovery requirements

- **Separate data classes.** Schema migrations, reference data and demo fixtures have different purposes and must have separate controls. Seed scripts must never overwrite operational case, evidence, assessment, decision or audit data.
- **Make seeds safe to rerun.** Reference data should have stable natural keys or version identifiers, use insert-if-missing/update-by-version behavior, and report what changed. Do not rely on an environment being empty.
- **Version and review changes.** Keep migrations and seed definitions in reviewed source control. Do not run an unreviewed SQL string supplied by a workflow input.
- **Serialize writers.** Prevent two releases from applying the same migration or seed concurrently. For multiple application instances, use a dedicated migration lock/job and a compatible deployment strategy.
- **Back up and test recovery.** The backup must be usable with the target engine and version. Verify restore procedures periodically. Application rollback alone does not necessarily reverse a schema change; use backward-compatible expand/contract migrations or restore/forward-fix according to a tested recovery plan.
- **Fail visibly.** Connection, permission, migration, seed or verification failures must fail the job and block promotion. Do not turn a database failure into a successful deployment or silently skip an intended migration.
- **Verify the exact target.** Before writes, assert the selected environment, engine and a safe target identity (for example, an approved host/database identifier). After writes, verify expected migration version and seed counts/checksums without exposing secrets.
- **Protect synthetic-only policy.** Production remains unseeded with demo cases by default (DEP-07, NFR-SEC-10). An intentional exception must be explicit, approved, logged and reversible.

## 6. Implementation boundary and next step

The current release workflow already supports deploying the SQLite-backed application and uses pre-deploy backup, startup migrations, reference-data initialization and smoke-test rollback. It does **not** provide a general-purpose seed deployment job for arbitrary databases or cloud SQL providers.

Before enabling another database engine, implement and validate the adapter and engine-specific migration/seed/backup contracts, then add a protected workflow job that consumes those supported commands. Until then:

- Local SQLite: supported.
- SQLite file on a cloud host's suitable persistent storage: potentially usable, subject to storage and locking validation.
- Managed PostgreSQL, MySQL or other non-SQLite database: unsupported; do not point the current release workflow at it.
- Production demo-case seeding: off by default and not part of routine releases.
