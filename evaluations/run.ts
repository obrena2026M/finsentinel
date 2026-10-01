import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { loadEnv } from '../src/config/env.ts';
import { loadLlmConfig } from '../src/config/llm-config.ts';
import { openDatabase, runMigrations } from '../src/db/connection.ts';
import { documents, users } from '../src/db/repos/core.ts';
import { seedReference } from '../src/db/seed.ts';
import { AnthropicGateway } from '../src/llm/anthropic-gateway.ts';
import type { LlmGateway } from '../src/llm/gateway.ts';
import { MockGateway } from '../src/llm/mock-gateway.ts';
import { addDocument, createCase, getCaseView } from '../src/services/case.ts';
import type { Actor, AppContext } from '../src/services/context.ts';
import { runPipelineNow } from '../src/services/pipeline.ts';

// Golden-dataset evaluation runner — EV-01..10, Architecture §15.
// node --env-file=.env evaluations/run.ts [--gateway=mock|anthropic] [--cases=RA-001,RA-002]
// Writes evaluations/results/<timestamp>.json; summary keys match config/quality-gates.json "ai".

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GOLDEN = join(ROOT, 'evaluations', 'golden_dataset');
const FIX = join(ROOT, 'tests', 'fixtures', 'cases');
const OUT = join(ROOT, 'evaluations', 'results');

type Golden = {
  case_id: string;
  category: string;
  title: string;
  change_type: string;
  description: string;
  documents: Array<{ kind: string; file: string }>;
  expected_facts: Record<string, unknown>;
  expected_missing: string[];
  expected_contradictions: string[];
  expected_dimensions: string[];
  expected_evidence: string[];
  expected_band: string[];
  adversarial: { type: string; expect_flag: boolean } | null;
};

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a?.split('=')[1];
}

function norm(v: unknown): string {
  if (Array.isArray(v))
    return [...v]
      .map((x) => String(x).toLowerCase().trim())
      .sort()
      .join('|');
  return String(v ?? '')
    .toLowerCase()
    .trim();
}

function setMetrics(expected: string[], actual: string[]) {
  const e = new Set(expected);
  const a = new Set(actual);
  const tp = [...a].filter((x) => e.has(x)).length;
  const precision = a.size ? tp / a.size : e.size === 0 ? 1 : 0;
  const recall = e.size ? tp / e.size : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

async function main() {
  const gatewayKind = (arg('gateway') ?? process.env.LLM_GATEWAY ?? 'mock') as 'mock' | 'anthropic';
  const only = arg('cases')?.split(',');
  const env = loadEnv({
    ...process.env,
    DB_PATH: ':memory:',
    LLM_GATEWAY: gatewayKind,
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'finsentinel-eval-')),
    SESSION_SECRET: process.env.SESSION_SECRET ?? 'eval-secret-eval-secret-eval-secret-0123456789',
  });
  const log = pino({ level: 'warn' });
  const db = openDatabase(':memory:');
  runMigrations(db);
  seedReference(db);
  const llm = loadLlmConfig();
  const gateway: LlmGateway =
    gatewayKind === 'anthropic'
      ? new AnthropicGateway({
          apiKey: env.ANTHROPIC_API_KEY,
          maxRetries: llm.retry.httpMaxRetries,
          timeoutMs: llm.retry.timeoutMs,
          schemaInvalidRetries: llm.retry.schemaInvalidRetries,
        })
      : new MockGateway({ latencyMs: 0 });
  const ctx: AppContext = { db, env, llm, gateway, log };
  const owner = users.byUsername(db, 'owner.pat')!;
  const actor: Actor = {
    id: owner.id,
    username: owner.username,
    role: owner.role,
    display_name: owner.display_name,
  };

  const files = readdirSync(GOLDEN)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const cases: Array<Record<string, unknown>> = [];
  const started = Date.now();

  for (const f of files) {
    const g = JSON.parse(readFileSync(join(GOLDEN, f), 'utf8')) as Golden;
    if (only && !only.includes(g.case_id)) continue;
    const t0 = Date.now();
    const c = createCase(ctx, actor, {
      title: g.title,
      change_type: g.change_type,
      description: g.description,
    });
    for (const d of g.documents)
      await addDocument(ctx, actor, c.id, {
        filename: d.file.split('/').pop()!,
        buffer: readFileSync(join(FIX, d.file)),
        kind: d.kind,
      });
    const outcome = await runPipelineNow(ctx, actor, c.id);
    const v = getCaseView(ctx, c.id);

    // Extraction accuracy: expected fields present with matching value.
    const factMap = new Map(v.facts.map((x) => [x.field, x]));
    const factChecks = Object.entries(g.expected_facts).map(([field, exp]) => ({
      field,
      expected: exp,
      actual: factMap.get(field)?.value ?? null,
      match: norm(factMap.get(field)?.value) === norm(exp),
    }));
    const extractionAccuracy = factChecks.length
      ? factChecks.filter((x) => x.match).length / factChecks.length
      : 1;
    const hallucinated = v.facts.filter((x) => x.value !== null && x.sources.length === 0).length;

    // Missing / contradictions.
    const missingDetected = v.information_requests.map((r) => r.field);
    const missing = setMetrics(g.expected_missing, missingDetected);
    const contradictionsDetected = [...new Set(v.contradictions.map((x) => x.field))];
    const contradiction = setMetrics(g.expected_contradictions, contradictionsDetected);
    const inventedMissing = g.expected_missing.filter(
      (fld) => factMap.get(fld)?.value !== null && factMap.get(fld)?.value !== undefined,
    );

    // Scoping.
    const scopeStep = v.pipeline?.steps.find((s) => s.step === 'scope');
    const scoped = ((scopeStep?.summary as { dimensions?: string[] } | null)?.dimensions ?? []) as string[];
    const scoping = setMetrics(g.expected_dimensions, scoped);

    // Retrieval.
    const retrieved = [...new Set(v.evidence.map((e) => `${e.policy_id} ${e.section_ref}`))];
    const retrieval = setMetrics(g.expected_evidence, retrieved);

    // Grounding.
    const claims = v.assessment?.claims ?? [];
    const supported = claims.filter((k) => k.verdict === 'SUPPORTED').length;
    const unsupported = claims.filter((k) => k.verdict === 'UNSUPPORTED').length;

    // Band agreement (inherent band, since controls are unverified at pipeline time).
    const band = v.calculation?.inherent_band ?? null;
    const bandAgree = band !== null && g.expected_band.includes(band);

    // Adversarial.
    let adversarialPass: boolean | null = null;
    if (g.adversarial) {
      const flagged = v.flags.length > 0;
      const decided = v.case.state === 'DECIDED' || v.case.state === 'CLOSED';
      adversarialPass = (!g.adversarial.expect_flag || flagged) && !decided;
    }

    cases.push({
      case_id: g.case_id,
      category: g.category,
      pipeline_status: outcome.status,
      state: v.case.state,
      extraction: {
        accuracy: extractionAccuracy,
        checks: factChecks,
        hallucinated_without_source: hallucinated,
      },
      missing_info: { ...missing, detected: missingDetected, invented: inventedMissing },
      contradictions: { ...contradiction, detected: contradictionsDetected },
      scoping: { ...scoping, detected: scoped },
      retrieval: { ...retrieval, retrieved },
      grounding: {
        claims: claims.length,
        supported,
        unsupported,
        weak: claims.length - supported - unsupported,
        supported_rate: claims.length ? supported / claims.length : null,
        unsupported_rate: claims.length ? unsupported / claims.length : null,
      },
      recommendation: {
        inherent_band: band,
        expected: g.expected_band,
        agree: bandAgree,
        residual_band: v.calculation?.residual_band ?? null,
      },
      adversarial: g.adversarial ? { ...g.adversarial, flags: v.flags.length, pass: adversarialPass } : null,
      tokens: v.tokens,
      latency_ms: Date.now() - t0,
      documents: documents
        .forCase(db, c.id)
        .map((d) => ({ name: d.original_name, parse_status: d.parse_status })),
    });
  }

  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => typeof x === 'number');
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10_000) / 10_000 : null;
  };
  const totalClaims = cases.reduce((s, c) => s + ((c.grounding as { claims: number }).claims ?? 0), 0);
  const totalUnsupported = cases.reduce(
    (s, c) => s + ((c.grounding as { unsupported: number }).unsupported ?? 0),
    0,
  );
  const totalSupported = cases.reduce(
    (s, c) => s + ((c.grounding as { supported: number }).supported ?? 0),
    0,
  );
  const adv = cases.filter((c) => c.adversarial);
  const summary = {
    cases: cases.length,
    extractionAccuracy: avg(cases.map((c) => (c.extraction as { accuracy: number }).accuracy)),
    hallucinatedFacts: cases.reduce(
      (s, c) => s + (c.extraction as { hallucinated_without_source: number }).hallucinated_without_source,
      0,
    ),
    missingInfoRecall: avg(cases.map((c) => (c.missing_info as { recall: number }).recall)),
    inventedMissingValues: cases.reduce(
      (s, c) => s + (c.missing_info as { invented: string[] }).invented.length,
      0,
    ),
    contradictionRecall: avg(cases.map((c) => (c.contradictions as { recall: number }).recall)),
    scopingF1: avg(cases.map((c) => (c.scoping as { f1: number }).f1)),
    retrievalPrecision: avg(cases.map((c) => (c.retrieval as { precision: number }).precision)),
    retrievalRecall: avg(cases.map((c) => (c.retrieval as { recall: number }).recall)),
    groundingSupportedRate: totalClaims ? Math.round((totalSupported / totalClaims) * 10_000) / 10_000 : null,
    unsupportedClaimRate: totalClaims ? Math.round((totalUnsupported / totalClaims) * 10_000) / 10_000 : null,
    bandAgreement: avg(cases.map((c) => ((c.recommendation as { agree: boolean }).agree ? 1 : 0))),
    adversarialPassRate: adv.length
      ? avg(adv.map((c) => ((c.adversarial as { pass: boolean }).pass ? 1 : 0)))
      : null,
    pipelineSuccessRate: avg(cases.map((c) => (c.pipeline_status === 'succeeded' ? 1 : 0))),
  };
  type Tok = { input: number; output: number; cacheRead: number; cacheWrite: number; cost_usd: number };
  const tokens = cases.reduce<Tok>(
    (a, c) => {
      const t = c.tokens as Tok;
      return {
        input: a.input + t.input,
        output: a.output + t.output,
        cacheRead: a.cacheRead + t.cacheRead,
        cacheWrite: a.cacheWrite + t.cacheWrite,
        cost_usd: a.cost_usd + t.cost_usd,
      };
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost_usd: 0 },
  );
  const result = {
    generated_at: new Date().toISOString(),
    gateway: gatewayKind,
    mode: 'optimized',
    prompt_versions: cases.length ? undefined : undefined,
    duration_ms: Date.now() - started,
    summary,
    tokens: {
      ...tokens,
      per_case: cases.length
        ? {
            input: Math.round(tokens.input / cases.length),
            output: Math.round(tokens.output / cases.length),
            cacheRead: Math.round(tokens.cacheRead / cases.length),
            cost_usd: Math.round((tokens.cost_usd / cases.length) * 10_000) / 10_000,
          }
        : null,
    },
    cases,
  };
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ file, summary, tokens: result.tokens }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
