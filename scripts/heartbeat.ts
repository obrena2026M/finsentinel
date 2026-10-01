import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statfsSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { verifyChain } from '../src/audit/writer.ts';
import { loadEnv } from '../src/config/env.ts';
import { loadLlmConfig } from '../src/config/llm-config.ts';
import { nowIso, openDatabase } from '../src/db/connection.ts';
import type { LlmGateway } from '../src/llm/gateway.ts';
import type { AppContext } from '../src/services/context.ts';
import { metricsSnapshot } from '../src/services/metrics.ts';

// STAGE06 OPS-01/OPS-02: operational heartbeat. Runs every 15 minutes from Task Scheduler
// (scripts/ops.ps1) and from the nightly GitHub workflow on the production runner.
//   node --env-file=.env scripts/heartbeat.ts [--url=http://127.0.0.1:3000] [--out=shared/logs/heartbeat.jsonl] [--json]
// Checks: liveness, readiness, audit hash chain of every case, database integrity and size,
// backup age, disk free, and the 24 h metrics snapshot against config/ops.json thresholds.
// Persists the snapshot into metrics_snapshots (trend history) and appends one JSON line to --out.
// Exit 0 = OK or warnings only; exit 1 = at least one critical finding.

type Severity = 'ok' | 'warning' | 'critical';
type Finding = { check: string; severity: Severity; value: unknown; detail: string };

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ops = JSON.parse(readFileSync(join(ROOT, 'config', 'ops.json'), 'utf8')) as {
  heartbeat: Record<string, { warning?: number; critical?: number } | number>;
};
const hb = ops.heartbeat;
const arg = (n: string, d = '') =>
  process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const jsonOnly = process.argv.includes('--json');

const env = loadEnv();
const url = arg('url', `http://${env.HOST === '0.0.0.0' ? '127.0.0.1' : env.HOST}:${env.PORT}`).replace(
  /\/$/,
  '',
);
const out = arg('out', '');
const findings: Finding[] = [];
const add = (check: string, severity: Severity, value: unknown, detail: string) =>
  findings.push({ check, severity, value, detail });

/** Grade a numeric value where higher is worse (warning <= value < critical). */
function gradeHigh(
  check: string,
  value: number | null,
  rule: { warning?: number; critical?: number },
  unit = '',
) {
  if (value === null || value === undefined) return add(check, 'ok', null, 'no data in window');
  if (rule.critical !== undefined && value >= rule.critical)
    return add(check, 'critical', value, `${value}${unit} >= ${rule.critical}${unit}`);
  if (rule.warning !== undefined && value >= rule.warning)
    return add(check, 'warning', value, `${value}${unit} >= ${rule.warning}${unit}`);
  add(check, 'ok', value, `${value}${unit}`);
}
/** Grade a numeric value where lower is worse (critical < value <= warning). */
function gradeLow(
  check: string,
  value: number | null,
  rule: { warning?: number; critical?: number },
  unit = '',
) {
  if (value === null || value === undefined) return add(check, 'ok', null, 'no data');
  if (rule.critical !== undefined && value <= rule.critical)
    return add(check, 'critical', value, `${value}${unit} <= ${rule.critical}${unit}`);
  if (rule.warning !== undefined && value <= rule.warning)
    return add(check, 'warning', value, `${value}${unit} <= ${rule.warning}${unit}`);
  add(check, 'ok', value, `${value}${unit}`);
}
const rule = (k: string) => hb[k] as { warning?: number; critical?: number };

async function http(path: string) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), Number(hb.http_timeout_ms ?? 5000));
  try {
    const r = await fetch(`${url}${path}`, { signal: ctl.signal, headers: { connection: 'close' } });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch (e) {
    return { status: 0, body: { error: (e as Error).message } };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  // 1. HTTP liveness and readiness (NFR-OPS-02)
  const live = await http('/health/live');
  add(
    'http.live',
    live.status === 200 ? 'ok' : 'critical',
    live.status,
    live.status === 200
      ? `build ${live.body.build ?? 'n/a'}`
      : `HTTP ${live.status} ${live.body.error ?? ''}`,
  );
  const ready = await http('/health/ready');
  add(
    'http.ready',
    ready.status === 200 && ready.body.ok === true ? 'ok' : 'critical',
    ready.status,
    JSON.stringify(ready.body.checks ?? ready.body),
  );

  // 2. Database: integrity, size, audit chain per case (FR-AUD-03)
  if (env.DB_PATH === ':memory:') {
    add('db.integrity', 'warning', null, 'in-memory database; skipped');
  } else if (!existsSync(env.DB_PATH)) {
    add('db.integrity', 'critical', null, `database file missing: ${env.DB_PATH}`);
  } else {
    const db = openDatabase(env.DB_PATH);
    const quick = (db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
    add('db.integrity', quick === 'ok' ? 'ok' : 'critical', quick, quick);
    const sizeGb = statSync(env.DB_PATH).size / 1e9;
    gradeHigh('db.size_gb', Math.round(sizeGb * 1000) / 1000, rule('db_size_gb'), ' GB');
    const caseIds = db.prepare('SELECT id, ref FROM cases').all() as Array<{ id: string; ref: string }>;
    const broken = caseIds.filter((c) => !verifyChain(db, c.id).ok).map((c) => c.ref);
    add(
      'audit.chain',
      broken.length ? 'critical' : 'ok',
      { cases: caseIds.length, broken },
      broken.length ? `broken chain in ${broken.join(', ')}` : `${caseIds.length} cases verified`,
    );

    // 3. 24 h metrics snapshot against thresholds (FR-OBS-01..03), persisted for trends
    const ctx: AppContext = {
      db,
      env,
      llm: loadLlmConfig(),
      gateway: { kind: env.LLM_GATEWAY } as unknown as LlmGateway,
      log: pino({ level: 'silent' }),
    };
    const m = metricsSnapshot(ctx);
    gradeHigh('api.p95_ms', m.system.p95_ms, rule('api_p95_ms'), ' ms');
    gradeHigh(
      'api.error_rate_24h',
      m.system.error_rate === null ? null : Math.round(m.system.error_rate * 10000) / 10000,
      rule('error_rate_24h'),
    );
    gradeHigh(
      'pipeline.step_failures_24h',
      m.system.pipeline_step_failures_24h,
      rule('pipeline_step_failures_24h'),
    );
    gradeHigh('llm.failures_24h', m.ai.llm_failures_24h, rule('llm_failures_24h'));
    gradeHigh('ai.unsupported_claims_open', m.ai.unsupported_claims_open, rule('unsupported_claims_open'));
    gradeHigh('business.awaiting_committee', m.business.awaiting_committee, rule('awaiting_committee'));
    add(
      'business.cases_by_state',
      'ok',
      m.business.cases_by_state,
      `${m.business.cases_total} cases, ${m.business.cases_decided} decided`,
    );
    add(
      'ai.cost_usd_24h',
      'ok',
      m.ai.cost_usd_24h,
      `${m.ai.llm_calls_24h} calls, cache hit ${m.ai.cache_hit_rate === null ? 'n/a' : `${Math.round(m.ai.cache_hit_rate * 100)}%`}`,
    );
    db.prepare(
      'INSERT INTO metrics_snapshots (id, taken_at, system_json, ai_json, business_json) VALUES (?, ?, ?, ?, ?)',
    ).run(
      `hb-${Date.now().toString(36)}`,
      nowIso(),
      JSON.stringify(m.system),
      JSON.stringify(m.ai),
      JSON.stringify(m.business),
    );
    db.close();
  }

  // 4. Backup age (NFR-OPS-07)
  const backupDir = process.env.BACKUP_DIR || join('data', 'backups');
  const backups = existsSync(backupDir)
    ? readdirSync(backupDir)
        .filter((f) => /^finsentinel-.*\.db$/.test(f))
        .sort()
    : [];
  if (!backups.length) add('backup.age_hours', 'critical', null, `no backups in ${backupDir}`);
  else {
    const newest = backups[backups.length - 1]!;
    const ageH = (Date.now() - statSync(join(backupDir, newest)).mtimeMs) / 3_600_000;
    gradeHigh('backup.age_hours', Math.round(ageH * 10) / 10, rule('backup_max_age_hours'), ' h');
  }

  // 5. Disk free where the database lives
  const diskPath = env.DB_PATH === ':memory:' ? ROOT : dirname(env.DB_PATH);
  try {
    const s = statfsSync(existsSync(diskPath) ? diskPath : ROOT);
    gradeLow('disk.free_gb', Math.round((s.bavail * s.bsize) / 1e8) / 10, rule('disk_free_gb'), ' GB');
  } catch (e) {
    add('disk.free_gb', 'warning', null, (e as Error).message);
  }

  // Report
  const worst: Severity = findings.some((f) => f.severity === 'critical')
    ? 'critical'
    : findings.some((f) => f.severity === 'warning')
      ? 'warning'
      : 'ok';
  const record = { taken_at: nowIso(), url, status: worst, build: live.body.build ?? null, findings };
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    appendFileSync(out, `${JSON.stringify(record)}\n`);
  }
  if (jsonOnly) console.log(JSON.stringify(record, null, 2));
  else {
    console.log(`FinSentinel heartbeat ${record.taken_at} against ${url}`);
    for (const f of findings)
      console.log(`${f.severity.toUpperCase().padEnd(8)} ${f.check.padEnd(32)} ${f.detail}`);
    console.log(
      `\nstatus: ${worst.toUpperCase()} (${findings.filter((f) => f.severity === 'critical').length} critical, ${findings.filter((f) => f.severity === 'warning').length} warning)`,
    );
  }
  process.exitCode = worst === 'critical' ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
