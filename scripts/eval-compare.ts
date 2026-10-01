import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// STAGE06 OPS-03 / NFR-MNT-02: compare two evaluation runs (base vs head) and fail on regression.
//   node scripts/eval-compare.ts [--base=evaluations/baseline.json] [--head=<latest result>] [--out=compare.md]
// Default base: evaluations/baseline.json (the committed, human-approved reference for the current
// prompt/model/risk-model versions). Default head: newest file in evaluations/results/.
// Exit 0 = no regression beyond config/ops.json tolerances; exit 1 = regression; exit 2 = usage error.

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const arg = (n: string, d = '') =>
  process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;

type Run = {
  generated_at?: string;
  gateway?: string;
  summary: Record<string, number>;
  tokens?: { per_case?: Record<string, number>; cost_usd?: number };
  meta?: Record<string, unknown>;
};
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'ops.json'), 'utf8')).regression as {
  higher_is_better: string[];
  lower_is_better: string[];
  tolerance: Record<string, number>;
  tokens_per_case_increase_pct: number;
  cost_per_case_increase_pct: number;
};

function newestResult(): string | null {
  const dir = join(ROOT, 'evaluations', 'results');
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^\d{4}-.*\.json$/.test(f))
        .sort()
    : [];
  return files.length ? join(dir, files[files.length - 1]!) : null;
}
const basePath = arg('base', join(ROOT, 'evaluations', 'baseline.json'));
const headPath = arg('head', newestResult() ?? '');
if (!existsSync(basePath) || !headPath || !existsSync(headPath)) {
  console.error(
    `usage: eval-compare.ts --base=<run.json> --head=<run.json>  (missing: ${!existsSync(basePath) ? basePath : headPath})`,
  );
  process.exit(2);
}
const base = JSON.parse(readFileSync(basePath, 'utf8')) as Run;
const head = JSON.parse(readFileSync(headPath, 'utf8')) as Run;

const fmt = (v: number | undefined) =>
  v === undefined || v === null ? 'n/a' : Number.isInteger(v) ? String(v) : v.toFixed(4);
const rows: string[] = [];
const regressions: string[] = [];
const improvements: string[] = [];

for (const key of [...cfg.higher_is_better, ...cfg.lower_is_better]) {
  const b = base.summary?.[key];
  const h = head.summary?.[key];
  if (b === undefined && h === undefined) continue;
  const higher = cfg.higher_is_better.includes(key);
  const tol = cfg.tolerance[key] ?? cfg.tolerance.default ?? 0;
  const delta = h !== undefined && b !== undefined ? h - b : null;
  let verdict = '–';
  if (delta !== null) {
    const worse = higher ? delta < -tol : delta > tol;
    const better = higher ? delta > tol : delta < -tol;
    if (worse) {
      verdict = '**REGRESSION**';
      regressions.push(`${key}: ${fmt(b)} → ${fmt(h)} (tolerance ${tol})`);
    } else if (better) {
      verdict = 'improved';
      improvements.push(`${key}: ${fmt(b)} → ${fmt(h)}`);
    } else verdict = 'stable';
  }
  rows.push(
    `| ${key} | ${higher ? '↑' : '↓'} | ${fmt(b)} | ${fmt(h)} | ${delta === null ? 'n/a' : (delta >= 0 ? '+' : '') + fmt(delta)} | ${tol} | ${verdict} |`,
  );
}

// Token and cost per case (token efficiency, FR-TOK)
const costRows: string[] = [];
for (const [label, key, pct] of [
  ['tokens per case (input+output)', 'tokens', cfg.tokens_per_case_increase_pct],
  ['cost per case (USD)', 'cost_usd', cfg.cost_per_case_increase_pct],
] as const) {
  const pc = (r: Run) => {
    const p = r.tokens?.per_case;
    if (!p) return undefined;
    return key === 'tokens' ? (p.input ?? 0) + (p.output ?? 0) : p.cost_usd;
  };
  const b = pc(base);
  const h = pc(head);
  if (b === undefined || h === undefined) continue;
  const change = b > 0 ? ((h - b) / b) * 100 : 0;
  const worse = change > pct;
  if (worse) regressions.push(`${label}: ${fmt(b)} → ${fmt(h)} (+${change.toFixed(0)}% > ${pct}%)`);
  costRows.push(
    `| ${label} | ${fmt(b)} | ${fmt(h)} | ${change >= 0 ? '+' : ''}${change.toFixed(1)}% | ${pct}% | ${worse ? '**REGRESSION**' : 'ok'} |`,
  );
}

const md = [
  '# Evaluation comparison (NFR-MNT-02)',
  '',
  `| | Base | Head |`,
  `|---|---|---|`,
  `| file | \`${basePath.replace(ROOT, '')}\` | \`${headPath.replace(ROOT, '')}\` |`,
  `| generated | ${base.generated_at ?? 'n/a'} | ${head.generated_at ?? 'n/a'} |`,
  `| gateway | ${base.gateway ?? 'n/a'} | ${head.gateway ?? 'n/a'} |`,
  `| cases | ${fmt(base.summary?.cases)} | ${fmt(head.summary?.cases)} |`,
  '',
  '| Metric | Better | Base | Head | Δ | Tolerance | Verdict |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  ...(costRows.length
    ? [
        '| Consumption | Base | Head | Change | Max increase | Verdict |',
        '|---|---|---|---|---|---|',
        ...costRows,
        '',
      ]
    : []),
  regressions.length
    ? `**Result: REGRESSION** — ${regressions.join('; ')}`
    : `**Result: no regression**${improvements.length ? ` — improved: ${improvements.join('; ')}` : ''}`,
  '',
].join('\n');

const out = arg('out', '');
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
}
console.log(md);
process.exitCode = regressions.length ? 1 : 0;
