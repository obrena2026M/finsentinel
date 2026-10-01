import { readFileSync } from 'node:fs';
import { appendAuditEvent } from '../audit/writer.ts';
import { transaction } from '../db/connection.ts';
import {
  assessments,
  calculations,
  contradictions,
  evidence,
  facts,
  infoRequests,
  scores,
} from '../db/repos/assessment.ts';
import { type CaseRow, cases, documents, pipeline, type StepName } from '../db/repos/core.ts';
import { detectInjection } from '../domain/injection-detector.ts';
import { calculateRisk } from '../domain/risk-engine.ts';
import type { DimensionKey } from '../domain/risk-model-schema.ts';
import { transition } from '../domain/workflow.ts';
import { LlmError } from '../llm/gateway.ts';
import { activePromptVersions } from '../llm/prompts.ts';
import { assignEvidenceIds, draftAssessment } from './assessment.ts';
import { type ExtractedDocument, extractFacts } from './extraction.ts';
import { caseFixtureKey, documentFixtureKey } from './fixture-keys.ts';
import { groundClaims } from './grounding.ts';
import { dedupeContradictions, llmContradictions, type MergedFact, ruleMerge } from './merge.ts';
import { detectMissing } from './missing-info.ts';
import { ParseError, parseDocument } from './parser.ts';
import { retrieveEvidence } from './retrieval.ts';
import type { AgentRuntime } from './runtime.ts';
import { scopeDimensions } from './scoping.ts';

// Code-orchestrated pipeline — Architecture AD-02, §5.1. Fixed order, persisted step status,
// fail-closed: a failed LLM step leaves the case in ASSESSMENT with a manual path (FR-FAIL-02).
// This module has no import path to the decisions repository (AD-09).

export type PipelineOutcome = {
  runId: string;
  status: 'succeeded' | 'failed';
  failedStep?: StepName;
  error?: string;
};

export async function runPipeline(
  rt: AgentRuntime,
  caseId: string,
  triggeredBy: { id: string; role: string },
): Promise<PipelineOutcome> {
  const db = rt.db;
  const c = cases.byId(db, caseId);
  if (!c) throw new Error(`case ${caseId} not found`);

  // Freeze versions on first run (PR-06); transition to ASSESSMENT.
  const policyVersions = Object.fromEntries(
    (
      db.prepare('SELECT policy_id, version FROM policy_versions WHERE is_active = 1').all() as Array<{
        policy_id: string;
        version: string;
      }>
    ).map((p) => [p.policy_id, p.version]),
  );
  cases.freezeVersions(db, caseId, {
    riskModelVersion: rt.riskModel.version,
    policyVersions,
    promptVersions: activePromptVersions(),
    llmModels: Object.fromEntries(Object.entries(rt.llm.agents).map(([k, v]) => [k, v.model])),
  });
  cases.setState(db, caseId, transition(c.state, 'start_pipeline'));
  const run = pipeline.createRun(db, caseId, rt.gateway.kind, triggeredBy.id);
  appendAuditEvent(db, {
    caseId,
    actorUserId: triggeredBy.id,
    actorRole: triggeredBy.role as never,
    action: 'pipeline_started',
    entityType: 'pipeline_run',
    entityId: run.id,
    riskModelVersion: rt.riskModel.version,
  });

  const state: PipelineState = {
    case: c,
    extracted: [],
    merged: [],
    scoped: [],
    evidenceIds: new Map(),
    claims: [],
  };

  for (const step of STEPS) {
    const row = pipeline.step(db, run.id, step.name);
    pipeline.startStep(db, row.id);
    try {
      const summary = await step.run(rt, state, run.id, row.id);
      pipeline.finishStep(db, row.id, 'succeeded', summary);
    } catch (e) {
      const err = e as Error;
      const code = e instanceof LlmError ? e.outcome : e instanceof ParseError ? 'parse_error' : 'error';
      pipeline.finishStep(db, row.id, 'failed', undefined, { code, message: err.message });
      // Mark remaining steps skipped.
      for (const rest of STEPS.slice(STEPS.indexOf(step) + 1)) {
        const r = pipeline.step(db, run.id, rest.name);
        pipeline.finishStep(db, r.id, 'skipped', undefined);
      }
      pipeline.finishRun(db, run.id, 'failed');
      appendAuditEvent(db, {
        caseId,
        actorRole: 'system',
        action: 'pipeline_step_failed',
        entityType: 'pipeline_step',
        entityId: row.id,
        next: { step: step.name, code, message: err.message.slice(0, 300) },
      });
      rt.log.warn(
        { caseId, step: step.name, code, err: err.message },
        'pipeline step failed; case remains in ASSESSMENT',
      );
      return { runId: run.id, status: 'failed', failedStep: step.name, error: err.message };
    }
  }

  pipeline.finishRun(db, run.id, 'succeeded');
  cases.setState(db, caseId, transition('ASSESSMENT', 'pipeline_done'));
  appendAuditEvent(db, {
    caseId,
    actorRole: 'system',
    action: 'pipeline_completed',
    entityType: 'pipeline_run',
    entityId: run.id,
  });
  return { runId: run.id, status: 'succeeded' };
}

type PipelineState = {
  case: CaseRow;
  extracted: ExtractedDocument[];
  merged: MergedFact[];
  scoped: Array<{ dimension: DimensionKey; rationale: string }>;
  evidenceIds: ReturnType<typeof assignEvidenceIds>;
  evidenceRefIds?: Map<string, string>; // "E1" -> evidence_refs.id
  claims: ReturnType<typeof groundClaims>;
  assessmentModel?: string;
  assessmentPrompt?: string;
};

type Step = {
  name: StepName;
  run: (rt: AgentRuntime, s: PipelineState, runId: string, stepId: string) => Promise<unknown>;
};

const STEPS: Step[] = [
  {
    name: 'parse',
    async run(rt, s) {
      const docs = documents.forCase(rt.db, s.case.id);
      let parsed = 0;
      let failed = 0;
      let flags = 0;
      for (const d of docs) {
        try {
          const buf = readFileSync(d.storage_path);
          const chunks = await parseDocument(buf, d.mime, d.original_name);
          transaction(rt.db, () => {
            documents.setParsed(rt.db, d.id, chunks);
            documents.clearFlags(rt.db, d.id);
            for (const c of chunks) {
              for (const f of detectInjection(c.text)) {
                documents.addFlag(rt.db, d.id, c.chunk_ix, f.flagType, f.matchedText, f.pattern);
                flags++;
              }
            }
          });
          parsed++;
        } catch (e) {
          documents.setParseFailed(rt.db, d.id, (e as Error).message);
          appendAuditEvent(rt.db, {
            caseId: s.case.id,
            actorRole: 'system',
            action: 'document_parse_failed',
            entityType: 'document',
            entityId: d.id,
            next: { error: (e as Error).message.slice(0, 300) },
          });
          failed++;
        }
      }
      if (parsed === 0)
        throw new ParseError(failed > 0 ? 'no document could be parsed' : 'no documents uploaded');
      if (flags > 0)
        appendAuditEvent(rt.db, {
          caseId: s.case.id,
          actorRole: 'system',
          action: 'documents_processed',
          next: { parsed, failed, instruction_like_flags: flags },
        });
      return { documents: docs.length, parsed, failed, instruction_like_flags: flags };
    },
  },
  {
    name: 'extract',
    async run(rt, s, _runId, stepId) {
      const docs = documents.forCase(rt.db, s.case.id).filter((d) => d.parse_status === 'parsed');
      s.extracted = [];
      for (const d of docs) {
        const chunks = documents
          .chunks(rt.db, d.id)
          .map((c) => ({ chunk_ix: c.chunk_ix, heading: c.heading, text: c.text }));
        const out = await extractFacts(
          rt,
          s.case.id,
          stepId,
          { id: d.id, kind: d.kind, name: d.original_name, chunks },
          documentFixtureKey(d.kind, chunks),
        );
        s.extracted.push(out);
      }
      const total = s.extracted.reduce((n, d) => n + d.facts.filter((f) => f.value !== null).length, 0);
      return { documents: docs.length, facts_extracted: total };
    },
  },
  {
    name: 'merge_contradict',
    async run(rt, s, _runId, stepId) {
      const { facts: merged, contradictions: ruleC } = ruleMerge(s.extracted, rt.llm.confidence.lowThreshold);
      const llmC = await llmContradictions(rt, s.case.id, stepId, s.extracted, caseFixtureKey(s.case.title));
      const all = dedupeContradictions(ruleC, llmC);
      // Any LLM-detected field becomes conflicted too.
      for (const c of all) {
        const f = merged.find((m) => m.field === c.field);
        if (f && f.status !== 'missing') f.status = 'conflicted';
      }
      s.merged = merged;
      transaction(rt.db, () => {
        facts.replaceAll(
          rt.db,
          s.case.id,
          merged.map((f) => ({
            field: f.field,
            value: f.value,
            confidence: f.confidence,
            status: f.status,
            missing_reason: f.missing_reason,
            sources: f.sources,
          })),
        );
        contradictions.replaceOpen(
          rt.db,
          s.case.id,
          all.map((c) => ({
            field: c.field,
            candidates: { candidates: c.candidates, explanation: c.explanation },
            detected_by: c.detected_by,
          })),
        );
      });
      return {
        facts: merged.filter((f) => f.value !== null).length,
        missing: merged.filter((f) => f.value === null).length,
        low_confidence: merged.filter((f) => f.status === 'low_confidence').length,
        contradictions: all.length,
      };
    },
  },
  {
    name: 'missing_info',
    async run(rt, s) {
      const drafts = detectMissing(rt.riskModel, s.merged);
      infoRequests.replaceOpen(
        rt.db,
        s.case.id,
        drafts.map((d) => ({ field: d.field, question: d.question })),
      );
      // Ensure missing required facts exist as rows even if no document mentioned them.
      const present = new Set(s.merged.map((f) => f.field));
      for (const d of drafts) {
        if (!present.has(d.field))
          s.merged.push({
            field: d.field,
            value: null,
            confidence: 0,
            sources: [],
            missing_reason: 'required by risk model; not found in any document',
            status: 'missing',
          });
      }
      facts.replaceAll(
        rt.db,
        s.case.id,
        s.merged.map((f) => ({
          field: f.field,
          value: f.value,
          confidence: f.confidence,
          status: f.status,
          missing_reason: f.missing_reason,
          sources: f.sources,
        })),
      );
      return { information_requests: drafts.length, fields: drafts.map((d) => d.field) };
    },
  },
  {
    name: 'scope',
    async run(rt, s, _runId, stepId) {
      const dims = await scopeDimensions(rt, s.case.id, stepId, s.merged, caseFixtureKey(s.case.title));
      s.scoped = dims.map((d) => ({ dimension: d.dimension, rationale: d.rationale }));
      return { dimensions: s.scoped.map((d) => d.dimension) };
    },
  },
  {
    name: 'retrieve',
    async run(rt, s) {
      const dims = s.scoped.map((d) => d.dimension);
      const retrieved = retrieveEvidence(rt.db, rt.riskModel, dims, s.merged);
      const ids = evidence.replaceAll(
        rt.db,
        s.case.id,
        retrieved.map((r) => ({
          policy_chunk_id: r.policy_chunk_id,
          dimension: r.dimension,
          score: r.score,
          query: r.query,
          rank: r.rank,
        })),
      );
      s.evidenceIds = assignEvidenceIds(retrieved);
      s.evidenceRefIds = new Map([...s.evidenceIds.keys()].map((k, i) => [k, ids[i]!]));
      return {
        evidence: retrieved.length,
        sections: retrieved.map((r) => `${r.policy_id} ${r.section_ref}`),
        empty: retrieved.length === 0,
      };
    },
  },
  {
    name: 'assess',
    async run(rt, s, runId, stepId) {
      const res = await draftAssessment(
        rt,
        s.case.id,
        stepId,
        {
          ref: s.case.ref,
          title: s.case.title,
          change_type: s.case.change_type,
          description: s.case.description,
        },
        s.merged,
        s.scoped,
        s.evidenceIds,
        caseFixtureKey(s.case.title),
      );
      s.assessmentModel = res.model;
      s.claims = groundClaims(res.data.claims, s.evidenceIds);
      transaction(rt.db, () => {
        const a = assessments.createCurrent(rt.db, {
          case_id: s.case.id,
          run_id: runId,
          summary: res.data.summary,
          narratives: Object.fromEntries(res.data.dimensions.map((d) => [d.dimension, d.narrative])),
          model: res.model,
          prompt_version: activePromptVersions().assessment,
        });
        for (const d of res.data.dimensions)
          scores.upsertAi(rt.db, s.case.id, d.dimension, d.recommended_score);
        for (const g of s.claims) {
          assessments.addClaim(rt.db, {
            assessment_id: a.id,
            dimension: g.claim.dimension,
            text: g.claim.text,
            verdict: g.verdict,
            verdict_reason: g.reason,
            citations: g.citations
              .filter((c) => s.evidenceRefIds?.has(c.evidence_id))
              .map((c) => ({
                evidence_ref_id: s.evidenceRefIds!.get(c.evidence_id)!,
                quote: c.quote,
                verified: c.verified,
                added_by: 'ai' as const,
              })),
          });
        }
      });
      appendAuditEvent(rt.db, {
        caseId: s.case.id,
        actorRole: 'system',
        action: 'assessment_drafted',
        modelVersion: res.model,
        promptVersion: activePromptVersions().assessment,
        next: { claims: s.claims.length },
      });
      return {
        model: res.model,
        claims: s.claims.length,
        recommended: Object.fromEntries(res.data.dimensions.map((d) => [d.dimension, d.recommended_score])),
        tokens: res.usage,
      };
    },
  },
  {
    name: 'ground',
    async run(_rt, s) {
      const counts = { SUPPORTED: 0, UNSUPPORTED: 0, WEAK: 0 };
      for (const g of s.claims) counts[g.verdict]++;
      return counts;
    },
  },
  {
    name: 'score',
    async run(rt, s) {
      const rows = scores.forCase(rt.db, s.case.id);
      const inputs = Object.fromEntries(
        rt.riskModel.dimensions.map((d) => {
          const r = rows.find((x) => x.dimension === d.key);
          return [
            d.key,
            { score: r?.current_score ?? r?.ai_recommended ?? 3, control: r?.control_rating ?? 'unverified' },
          ];
        }),
      ) as Record<DimensionKey, { score: number; control: 'unverified' }>;
      const calc = calculateRisk(rt.riskModel, inputs);
      calculations.insertCurrent(rt.db, s.case.id, 'pipeline', inputs, calc);
      appendAuditEvent(rt.db, {
        caseId: s.case.id,
        actorRole: 'system',
        action: 'risk_calculated',
        riskModelVersion: rt.riskModel.version,
        next: {
          inherent: calc.inherentScore,
          inherent_band: calc.inherentBand,
          residual: calc.residualScore,
          residual_band: calc.residualBand,
        },
      });
      return {
        inherent: calc.inherentScore,
        inherent_band: calc.inherentBand,
        residual: calc.residualScore,
        residual_band: calc.residualBand,
      };
    },
  },
  {
    name: 'packet',
    async run() {
      return { ready: true };
    },
  },
];
