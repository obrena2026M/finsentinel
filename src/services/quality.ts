import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChain } from '../audit/writer.ts';
import { nowIso } from '../db/connection.ts';
import type { AppContext } from './context.ts';

// Quality Center read model — FR-QC-01..05. All numbers come from real artefacts on disk or the DB;
// when an artefact is missing the tile reports null ("No run yet"), never a placeholder.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLAYWRIGHT_JSON = join(ROOT, 'test-results', 'results.json');
const E2E_JSON = join(ROOT, 'test-results', 'e2e-results.json');
const EVAL_DIR = join(ROOT, 'evaluations', 'results');
const GATES = join(ROOT, 'config', 'quality-gates.json');

type SuiteCounts = { passed: number; failed: number; skipped: number; total: number };

function readJson(p: string): unknown | null {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  } catch {
    return null;
  }
}

/** Playwright JSON reporter → per-project counts. */
export function summarizePlaywright(report: unknown): Record<string, SuiteCounts> | null {
  if (!report || typeof report !== 'object') return null;
  const out: Record<string, SuiteCounts> = {};
  const visit = (suite: {
    suites?: unknown[];
    specs?: Array<{
      tests: Array<{ projectName: string; status: string; results: Array<{ status: string }> }>;
    }>;
  }) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        const proj = t.projectName || 'default';
        out[proj] ??= { passed: 0, failed: 0, skipped: 0, total: 0 };
        const s = out[proj];
        s.total++;
        if (t.status === 'expected') s.passed++;
        else if (t.status === 'skipped') s.skipped++;
        else s.failed++;
      }
    }
    for (const child of (suite.suites ?? []) as never[]) visit(child);
  };
  for (const s of ((report as { suites?: unknown[] }).suites ?? []) as never[]) visit(s);
  return Object.keys(out).length ? out : null;
}

export function latestEval(): { file: string; data: Record<string, unknown> } | null {
  if (!existsSync(EVAL_DIR)) return null;
  const files = readdirSync(EVAL_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const f = files.at(-1);
  if (!f) return null;
  const data = readJson(join(EVAL_DIR, f));
  return data ? { file: f, data: data as Record<string, unknown> } : null;
}

export type GateResult = {
  id: string;
  group: 'software' | 'ai' | 'governance';
  description: string;
  pass: boolean | null;
  actual: unknown;
  threshold: unknown;
};

export function evaluateGates(ctx: AppContext) {
  const gates = readJson(GATES) as Record<string, Record<string, Record<string, unknown>>> | null;
  const pw = summarizePlaywright(readJson(PLAYWRIGHT_JSON));
  const e2e = summarizePlaywright(readJson(E2E_JSON));
  const ev = latestEval();
  const evalSummary = (ev?.data.summary ?? null) as Record<string, number> | null;
  const results: GateResult[] = [];

  const suite = (name: string) =>
    pw?.[name] ??
    (name === 'e2e'
      ? Object.values(e2e ?? {}).reduce<SuiteCounts | null>(
          (a, s) =>
            a
              ? {
                  passed: a.passed + s.passed,
                  failed: a.failed + s.failed,
                  skipped: a.skipped + s.skipped,
                  total: a.total + s.total,
                }
              : s,
          null,
        )
      : null);
  for (const name of ['unit', 'integration', 'security', 'adversarial', 'e2e']) {
    const s = suite(name);
    results.push({
      id: `QG-software-${name}`,
      group: 'software',
      description: `all ${name} tests pass`,
      pass: s ? s.failed === 0 && s.total > 0 : null,
      actual: s,
      threshold: 'allPass',
    });
  }
  // Coverage gate from c8's json-summary reporter (coverage/coverage-summary.json).
  const covRule = (gates?.software?.coverage ?? null) as {
    lines?: number;
    branches?: number;
    functions?: number;
  } | null;
  const covSummary = readJson(join(ROOT, 'coverage', 'coverage-summary.json')) as {
    total?: Record<string, { pct: number }>;
  } | null;
  if (covRule) {
    const t = covSummary?.total;
    const actual = t ? { lines: t.lines?.pct, branches: t.branches?.pct, functions: t.functions?.pct } : null;
    const pass = actual
      ? (covRule.lines === undefined || (actual.lines ?? 0) >= covRule.lines) &&
        (covRule.branches === undefined || (actual.branches ?? 0) >= covRule.branches) &&
        (covRule.functions === undefined || (actual.functions ?? 0) >= covRule.functions)
      : null;
    results.push({
      id: 'QG-software-coverage',
      group: 'software',
      description: 'code coverage thresholds (c8)',
      pass,
      actual,
      threshold: covRule,
    });
  }
  const aiGates = gates?.ai ?? {};
  for (const [key, rule] of Object.entries(aiGates)) {
    const actual = evalSummary?.[key];
    const min = (rule as { min?: number }).min;
    const max = (rule as { max?: number }).max;
    const pass =
      actual === undefined || actual === null
        ? null
        : (min === undefined || actual >= min) && (max === undefined || actual <= max);
    results.push({
      id: `QG-ai-${key}`,
      group: 'ai',
      description: key,
      pass,
      actual: actual ?? null,
      threshold: rule,
    });
  }
  // Governance gates come from the database itself.
  const unauthorized = (
    ctx.db
      .prepare(
        "SELECT COUNT(*) n FROM decisions d JOIN users u ON u.id = d.decided_by WHERE u.role <> 'committee'",
      )
      .get() as { n: number }
  ).n;
  const noRationale = (
    ctx.db.prepare('SELECT COUNT(*) n FROM overrides WHERE length(trim(rationale)) < 20').get() as {
      n: number;
    }
  ).n;
  results.push({
    id: 'QG-gov-unauthorized-decisions',
    group: 'governance',
    description: 'no decision by a non-committee actor',
    pass: unauthorized === 0,
    actual: unauthorized,
    threshold: 0,
  });
  results.push({
    id: 'QG-gov-override-rationale',
    group: 'governance',
    description: 'every override has a rationale',
    pass: noRationale === 0,
    actual: noRationale,
    threshold: 0,
  });
  const chains = ctx.db
    .prepare('SELECT DISTINCT case_id FROM audit_events WHERE case_id IS NOT NULL')
    .all() as Array<{ case_id: string }>;
  const broken = chains.filter((c) => !verifyChain(ctx.db, c.case_id).ok).length;
  results.push({
    id: 'QG-gov-audit-integrity',
    group: 'governance',
    description: 'audit hash chains verify for all cases',
    pass: chains.length === 0 ? null : broken === 0,
    actual: { cases: chains.length, broken },
    threshold: 'all',
  });

  const evaluated = results.filter((r) => r.pass !== null);
  const status = evaluated.length === 0 ? 'NO_RUN' : evaluated.every((r) => r.pass) ? 'PASS' : 'FAIL';
  return {
    status,
    gates: results,
    software: { projects: pw, e2e },
    ai: evalSummary,
    eval_file: ev?.file ?? null,
    tokens: (ev?.data.tokens ?? null) as unknown,
    generated_at: nowIso(),
  };
}

export function recordQualityRun(
  ctx: AppContext,
  source: 'playwright' | 'eval' | 'quality_gate' | 'adversarial_live',
  status: 'PASS' | 'FAIL',
  summary: unknown,
) {
  ctx.db
    .prepare(
      'INSERT INTO quality_runs (id, source, git_sha, started_at, finished_at, summary_json, status) VALUES (?, ?, NULL, ?, ?, ?, ?)',
    )
    .run(randomUUID(), source, nowIso(), nowIso(), JSON.stringify(summary), status);
}

export function recentQualityRuns(ctx: AppContext) {
  return (
    ctx.db.prepare('SELECT * FROM quality_runs ORDER BY started_at DESC LIMIT 20').all() as Array<
      { summary_json: string } & Record<string, unknown>
    >
  ).map((r) => ({ ...r, summary: JSON.parse(r.summary_json) }));
}
