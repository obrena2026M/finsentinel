import { DIMENSION_KEYS } from '../domain/risk-model-schema.ts';
import { loadPrompt } from '../llm/prompts.ts';
import { compactJson, type EvidenceForPrompt, evidenceBlocks, systemBlocks } from './context-builder.ts';
import type { MergedFact } from './merge.ts';
import type { RetrievedChunk } from './retrieval.ts';
import { type AgentRuntime, callAgent } from './runtime.ts';
import { AssessmentOutput } from './schemas/index.ts';

// Step 7 — assessment drafting with cited claims (FR-ASM-01..06). Evidence IDs E1..En map to evidence_refs.

export type EvidenceIdMap = Map<string, RetrievedChunk>; // "E1" -> chunk

export function assignEvidenceIds(evidence: RetrievedChunk[]): EvidenceIdMap {
  const m: EvidenceIdMap = new Map();
  for (const [i, e] of evidence.entries()) m.set(`E${i + 1}`, e);
  return m;
}

export async function draftAssessment(
  rt: AgentRuntime,
  caseId: string,
  stepId: string,
  caseHeader: { ref: string; title: string; change_type: string; description: string },
  facts: MergedFact[],
  scoped: Array<{ dimension: string; rationale: string }>,
  evidenceIds: EvidenceIdMap,
  fixtureKey: string,
) {
  const prompt = loadPrompt('assessment');
  const cfg = rt.llm.agents.assessment;
  const system = systemBlocks(prompt.text, rt.riskModel);

  const ev: EvidenceForPrompt[] = [...evidenceIds.entries()].map(([id, c]) => ({
    evidenceId: id,
    source: `${c.policy_id} ${c.section_ref}${c.title ? ` ${c.title}` : ''}`,
    version: c.policy_version,
    body: c.body,
    score: c.score,
  }));
  const { text: evidenceText } = evidenceBlocks(ev, Math.floor(cfg.maxContextTokens * 0.6));

  const user = [
    `CASE ${caseHeader.ref}: ${caseHeader.title} (${caseHeader.change_type})\n${caseHeader.description}`,
    `FACTS: ${compactJson(facts.map((f) => ({ field: f.field, value: f.value, status: f.status, confidence: f.confidence })))}`,
    `SCOPED DIMENSIONS: ${compactJson(scoped)}`,
    `EVIDENCE:\n${evidenceText || '(no policy evidence retrieved — any claim you make will be unsupported)'}`,
    `Draft the assessment. Provide a recommended_score for ALL ${DIMENSION_KEYS.length} dimensions (${DIMENSION_KEYS.join(', ')}). Every claim must cite evidence ids from the EVIDENCE block with a verbatim quote (≤200 chars). Do not invent facts; if a fact is missing, say so.`,
  ].join('\n\n');

  const res = await callAgent(rt, {
    agent: 'assessment',
    schema: AssessmentOutput.refine(
      (a) => new Set(a.dimensions.map((d) => d.dimension)).size === DIMENSION_KEYS.length,
      {
        message: `all ${DIMENSION_KEYS.length} dimensions must be scored exactly once`,
        path: ['dimensions'],
      },
    ),
    schemaName: 'AssessmentOutput',
    system,
    user,
    caseId,
    stepId,
    fixtureKey,
  });
  return res;
}
