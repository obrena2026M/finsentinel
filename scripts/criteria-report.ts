import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Renders documents/FINAL_REPORT.md from logs/criteria/STAGE0N.json + logs/token_log.md.
// node scripts/criteria-report.ts   (npm run criteria:report)

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOG_DIR = join(ROOT, 'logs', 'criteria');
const OUT = join(ROOT, 'documents', 'FINAL_REPORT.md');

const CRITERIA = [
  { key: 'ai_harness', label: 'AI harness and agent orchestration', weight: 30 },
  { key: 'sdlc_automation', label: 'SDLC automation', weight: 20 },
  { key: 'human_in_loop', label: 'Human-in-the-loop and governance', weight: 15 },
  { key: 'evaluation', label: 'Evaluation framework', weight: 10 },
  { key: 'context_engineering', label: 'Context engineering and requirement expansion', weight: 10 },
  { key: 'production_readiness', label: 'Production readiness', weight: 5 },
  { key: 'token_efficiency', label: 'Token efficiency', weight: 5 },
  { key: 'engineering_judgement', label: 'Engineering judgement', weight: 5 },
] as const;

const Entry = z.object({
  done: z.array(z.string()),
  evidence: z.array(z.string()),
  decisions: z.array(z.object({ decision: z.string(), reason: z.string() })),
  gaps: z.array(z.string()),
  self_score: z.number().int().min(0).max(5),
});
const StageLog = z.object({
  stage: z.string(),
  name: z.string(),
  date: z.string(),
  ai_usage: z.string(),
  criteria: z.object(
    Object.fromEntries(CRITERIA.map((c) => [c.key, Entry])) as Record<
      (typeof CRITERIA)[number]['key'],
      typeof Entry
    >,
  ),
  tokens: z.object({
    task_ids: z.array(z.number()),
    output: z.number(),
    cache_read: z.number(),
    cache_write: z.number(),
    subagents: z.number(),
  }),
});
type StageLog = z.infer<typeof StageLog>;

const files = readdirSync(LOG_DIR)
  .filter((f) => /^STAGE\d\d\.json$/.test(f))
  .sort();
const stages: StageLog[] = files.map((f) => {
  const r = StageLog.safeParse(JSON.parse(readFileSync(join(LOG_DIR, f), 'utf8')));
  if (!r.success)
    throw new Error(`${f}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
});
if (stages.length === 0) throw new Error('no stage logs found');

const n = (x: number) => x.toLocaleString('en-US');
const lines: string[] = [];
lines.push('# FinSentinel — Final Report against the Judging Criteria');
lines.push('');
lines.push(
  `Generated ${new Date().toISOString().slice(0, 10)} from \`logs/criteria/*.json\` by \`scripts/criteria-report.ts\`. Stages covered: ${stages.map((s) => `${s.stage} ${s.name}`).join(', ')}.`,
);
lines.push('');
lines.push('> AI prepares. Rules calculate. Humans decide.');
lines.push('');

// Weighted self-assessment
lines.push('## 1. Weighted self-assessment');
lines.push('');
lines.push(`| Criterion | Weight | ${stages.map((s) => `S${s.stage}`).join(' | ')} | Latest | Weighted |`);
lines.push(`|---|---|${stages.map(() => '---').join('|')}|---|---|`);
let total = 0;
for (const c of CRITERIA) {
  const scores = stages.map((s) => s.criteria[c.key].self_score);
  const latest = scores[scores.length - 1]!;
  const weighted = (latest / 5) * c.weight;
  total += weighted;
  lines.push(`| ${c.label} | ${c.weight}% | ${scores.join(' | ')} | ${latest}/5 | ${weighted.toFixed(1)} |`);
}
lines.push(
  `| **Total** | **100%** | ${stages.map(() => '').join(' | ')} | | **${total.toFixed(1)} / 100** |`,
);
lines.push('');
lines.push(
  'Self-scores are the team\'s own 0–5 estimate per stage; the "Latest" column drives the weighted total. They are a planning aid, not a prediction of the panel\'s scores.',
);
lines.push('');

// SDLC flow
lines.push('## 2. How AI was applied in each stage (SDLC automation, 20%)');
lines.push('');
for (const s of stages) {
  lines.push(`### Stage ${s.stage} — ${s.name} (${s.date})`);
  lines.push('');
  lines.push(s.ai_usage);
  lines.push('');
  lines.push(
    `Build tokens: output ${n(s.tokens.output)}, cache read ${n(s.tokens.cache_read)}, cache write ${n(s.tokens.cache_write)}${s.tokens.subagents ? `, sub-agents ${n(s.tokens.subagents)}` : ''} (token log tasks ${s.tokens.task_ids.join(', ')}).`,
  );
  lines.push('');
}

// Per criterion
lines.push('## 3. Evidence and decisions per criterion');
lines.push('');
for (const c of CRITERIA) {
  lines.push(`### ${c.label} — ${c.weight}%`);
  lines.push('');
  for (const s of stages) {
    const e = s.criteria[c.key];
    lines.push(`**Stage ${s.stage} ${s.name}** (self-score ${e.self_score}/5)`);
    lines.push('');
    for (const d of e.done) lines.push(`- ${d}`);
    if (e.evidence.length) lines.push(`- Evidence: ${e.evidence.map((x) => `\`${x}\``).join(', ')}`);
    lines.push('');
  }
  const decisions = stages.flatMap((s) => s.criteria[c.key].decisions.map((d) => ({ stage: s.stage, ...d })));
  if (decisions.length) {
    lines.push('| Stage | Decision | Reason |');
    lines.push('|---|---|---|');
    for (const d of decisions) lines.push(`| ${d.stage} | ${d.decision} | ${d.reason} |`);
    lines.push('');
  }
  const gaps = stages.flatMap((s) => s.criteria[c.key].gaps.map((g) => `S${s.stage}: ${g}`));
  if (gaps.length) {
    lines.push(`Open gaps: ${gaps.join('; ')}`);
    lines.push('');
  }
}

// Token summary
lines.push('## 4. Build token consumption (token efficiency, 5%)');
lines.push('');
const tot = stages.reduce(
  (a, s) => ({
    output: a.output + s.tokens.output,
    cache_read: a.cache_read + s.tokens.cache_read,
    cache_write: a.cache_write + s.tokens.cache_write,
    subagents: a.subagents + s.tokens.subagents,
  }),
  { output: 0, cache_read: 0, cache_write: 0, subagents: 0 },
);
lines.push('| Stage | Output | Cache read | Cache write | Sub-agents |');
lines.push('|---|---|---|---|---|');
for (const s of stages)
  lines.push(
    `| ${s.stage} ${s.name} | ${n(s.tokens.output)} | ${n(s.tokens.cache_read)} | ${n(s.tokens.cache_write)} | ${n(s.tokens.subagents)} |`,
  );
lines.push(
  `| **Total** | **${n(tot.output)}** | **${n(tot.cache_read)}** | **${n(tot.cache_write)}** | **${n(tot.subagents)}** |`,
);
lines.push('');
lines.push(
  'Where consumption concentrated: cache reads dominate because each turn re-reads the growing session context; output tokens concentrate in Stage 03 where ~90 source files were written. Mitigations used: delegating the web app to a fresh sub-agent, and per-task logging in `logs/token_log.md`. Application-side consumption per case is recorded in the `llm_calls` table and reported by the evaluation runner.',
);
lines.push('');
const tokenLog = join(ROOT, 'logs', 'token_log.md');
if (existsSync(tokenLog)) lines.push(`Full per-task log: \`logs/token_log.md\`.`);
lines.push('');

writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`wrote ${OUT} (${stages.length} stages, weighted self-assessment ${total.toFixed(1)}/100)`);
