import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config/env.ts';
import { openDatabase } from '../src/db/connection.ts';

// STAGE06 OPS-05: continuous-improvement feedback export.
//   node --env-file=.env scripts/feedback-export.ts [--since=ISO] [--out=evaluations/feedback/<ts>.json]
// Collects the human corrections already recorded by the workflow (overrides with rationale, removed
// claims, resolved contradictions, accepted gaps, committee decisions vs AI band) and turns them into
// REVIEWABLE candidates: golden-dataset deltas for cases that match a golden case, new golden-case
// candidates for the rest, and prompt/risk-model signals where the same dimension is corrected
// repeatedly in the same direction. Nothing is applied automatically: a human reviews the file and
// opens a pull request (the Stage 05 gate) to change golden cases, prompts or the risk model.

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const arg = (n: string, d = '') =>
  process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const env = loadEnv();
const since = arg('since', '1970-01-01T00:00:00Z');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = arg('out', join(ROOT, 'evaluations', 'feedback', `${stamp}.json`));
const db = openDatabase(env.DB_PATH);

// Golden cases, matched to live cases by title (titles are fixed because mock fixtures key on them).
const goldenDir = join(ROOT, 'evaluations', 'golden_dataset');
const golden = (existsSync(goldenDir) ? readdirSync(goldenDir).filter((f) => f.endsWith('.json')) : []).map(
  (f) =>
    JSON.parse(readFileSync(join(goldenDir, f), 'utf8')) as {
      case_id: string;
      title: string;
      expected_band?: string;
    },
);
const goldenByTitle = new Map(golden.map((g) => [g.title.trim().toLowerCase(), g]));

type Row = Record<string, unknown>;
const q = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as Row[];

const overrides = q(
  `SELECT o.case_id, c.ref, c.title, o.dimension, o.previous_score, o.new_score, o.rationale, o.user_role, o.risk_model_version, o.created_at
   FROM overrides o JOIN cases c ON c.id = o.case_id WHERE o.created_at >= ? ORDER BY o.created_at`,
  since,
);
const removedClaims = q(
  `SELECT c.ref, c.title, cl.dimension, cl.text, cl.verdict, cl.verdict_reason, a.prompt_version, a.model
   FROM claims cl JOIN assessments a ON a.id = cl.assessment_id JOIN cases c ON c.id = a.case_id
   WHERE cl.status = 'removed' AND a.created_at >= ?`,
  since,
);
const unsupportedOpen = q(
  `SELECT c.ref, cl.dimension, cl.text, cl.verdict_reason, a.prompt_version
   FROM claims cl JOIN assessments a ON a.id = cl.assessment_id AND a.is_current = 1 JOIN cases c ON c.id = a.case_id
   WHERE cl.status = 'active' AND cl.verdict = 'UNSUPPORTED'`,
);
const contradictions = q(
  `SELECT c.ref, c.title, k.field, k.detected_by, k.resolved_value_json, k.rationale, k.resolved_at
   FROM contradictions k JOIN cases c ON c.id = k.case_id WHERE k.status = 'resolved' AND k.resolved_at >= ?`,
  since,
);
const gaps = q(
  `SELECT c.ref, c.title, r.field, r.question, r.status, r.accepted_rationale, r.accepted_at, r.answered_at
   FROM information_requests r JOIN cases c ON c.id = r.case_id WHERE r.status IN ('gap_accepted','answered') AND COALESCE(r.accepted_at, r.answered_at) >= ?`,
  since,
);
const decisions = q(
  `SELECT c.ref, c.title, d.type, d.rationale, d.decided_at, rc.residual_band, rc.inherent_band, rc.risk_model_version,
          (SELECT COUNT(*) FROM dimension_scores s WHERE s.case_id = c.id AND s.ai_recommended IS NOT NULL AND s.current_score IS NOT s.ai_recommended) changed_dimensions
   FROM decisions d JOIN cases c ON c.id = d.case_id LEFT JOIN risk_calculations rc ON rc.case_id = c.id AND rc.is_current = 1
   WHERE d.decided_at >= ? ORDER BY d.decided_at`,
  since,
);
const disagreement = q(
  `SELECT dimension, COUNT(*) total,
          SUM(CASE WHEN current_score > ai_recommended THEN 1 ELSE 0 END) raised,
          SUM(CASE WHEN current_score < ai_recommended THEN 1 ELSE 0 END) lowered
   FROM dimension_scores WHERE ai_recommended IS NOT NULL GROUP BY dimension`,
);
db.close();

// Candidates ---------------------------------------------------------------------------------------
type Candidate = {
  kind: string;
  target: string;
  case_ref: string;
  golden_case: string | null;
  proposal: string;
  evidence: Row;
};
const candidates: Candidate[] = [];
const goldenFor = (title: unknown) => goldenByTitle.get(String(title).trim().toLowerCase()) ?? null;

for (const o of overrides) {
  const g = goldenFor(o.title);
  candidates.push({
    kind: 'dimension_score',
    target: g ? `golden_dataset/${g.case_id}.json expected_dimensions / expected_band` : 'new golden case',
    case_ref: String(o.ref),
    golden_case: g?.case_id ?? null,
    proposal: `${o.user_role} moved ${o.dimension} from ${o.previous_score} to ${o.new_score}: "${o.rationale}". If the panel agrees, record the expected score and re-check the assessment prompt's treatment of ${o.dimension}.`,
    evidence: o,
  });
}
for (const r of removedClaims) {
  const g = goldenFor(r.title);
  candidates.push({
    kind: 'removed_claim',
    target: g ? `golden_dataset/${g.case_id}.json (expected unsupported claim)` : 'prompt review',
    case_ref: String(r.ref),
    golden_case: g?.case_id ?? null,
    proposal: `Analyst removed a ${r.verdict} claim in ${r.dimension} ("${String(r.text).slice(0, 120)}…"). Keep it as a negative example for prompt ${r.prompt_version}; if it recurs, tighten the citation instruction.`,
    evidence: r,
  });
}
for (const k of contradictions) {
  const g = goldenFor(k.title);
  candidates.push({
    kind: 'contradiction_resolution',
    target: g
      ? `golden_dataset/${g.case_id}.json expected_contradictions / expected_facts.${k.field}`
      : 'new golden case',
    case_ref: String(k.ref),
    golden_case: g?.case_id ?? null,
    proposal: `Contradiction on ${k.field} (detected by ${k.detected_by}) resolved to ${k.resolved_value_json}: "${k.rationale}". Record the resolved value as the expected fact.`,
    evidence: k,
  });
}
for (const gp of gaps) {
  const g = goldenFor(gp.title);
  candidates.push({
    kind: gp.status === 'gap_accepted' ? 'accepted_gap' : 'answered_request',
    target: g ? `golden_dataset/${g.case_id}.json expected_missing` : 'new golden case',
    case_ref: String(gp.ref),
    golden_case: g?.case_id ?? null,
    proposal:
      gp.status === 'gap_accepted'
        ? `Gap on ${gp.field} accepted: "${gp.accepted_rationale}". Keep ${gp.field} in expected_missing.`
        : `Owner answered ${gp.field}; the extraction prompt did not find it in the documents. Check whether the sample documents should contain it.`,
    evidence: gp,
  });
}
for (const d of decisions) {
  const g = goldenFor(d.title);
  if (g?.expected_band && d.residual_band !== g.expected_band) {
    candidates.push({
      kind: 'band_disagreement',
      target: `golden_dataset/${g.case_id}.json expected_band`,
      case_ref: String(d.ref),
      golden_case: g.case_id,
      proposal: `Final residual band ${d.residual_band} differs from golden expected_band ${g.expected_band} (decision ${d.type}, ${d.changed_dimensions} dimension(s) changed by analysts). Decide which is right.`,
      evidence: d,
    });
  }
}
const signals = disagreement
  .filter(
    (r) =>
      Number(r.total) >= 3 &&
      (Number(r.raised) / Number(r.total) >= 0.6 || Number(r.lowered) / Number(r.total) >= 0.6),
  )
  .map((r) => ({
    dimension: r.dimension,
    direction:
      Number(r.raised) >= Number(r.lowered) ? 'analysts raise the AI score' : 'analysts lower the AI score',
    total: r.total,
    raised: r.raised,
    lowered: r.lowered,
    proposal: `Systematic ${Number(r.raised) >= Number(r.lowered) ? 'under' : 'over'}-scoring of ${r.dimension}: review the assessment prompt guidance for this dimension and, if the committee agrees, the dimension weight in the next risk-model version (Admin publishes vN+1 with notes).`,
  }));

const report = {
  generated_at: new Date().toISOString(),
  since,
  db: env.DB_PATH,
  counts: {
    overrides: overrides.length,
    removed_claims: removedClaims.length,
    unsupported_claims_open: unsupportedOpen.length,
    contradictions_resolved: contradictions.length,
    information_requests: gaps.length,
    decisions: decisions.length,
    candidates: candidates.length,
    signals: signals.length,
  },
  review_instructions:
    'Review each candidate. Accepted golden-dataset changes go into evaluations/golden_dataset/*.json; prompt changes become prompts/<agent>/vN+1.md with the version switched in src/llm/prompts.ts; risk-model changes are published by the Admin as a new version. All go through a pull request so the CI gate (eval + quality gate) and a reviewer approve them (DEP-01). Then update evaluations/baseline.json from the new run (OPS-03).',
  candidates,
  signals,
  unsupported_claims_open: unsupportedOpen,
};
mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`feedback export written: ${out}`);
console.log(JSON.stringify(report.counts));
for (const s of signals)
  console.log(
    `SIGNAL ${s.dimension}: ${s.direction} (${s.raised}/${s.total} raised, ${s.lowered}/${s.total} lowered)`,
  );
