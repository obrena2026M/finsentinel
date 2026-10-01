import { LlmError } from '../llm/gateway.ts';
import { loadPrompt } from '../llm/prompts.ts';
import { compactJson, systemBlocks } from './context-builder.ts';
import type { ExtractedDocument } from './extraction.ts';
import { type AgentRuntime, callAgent } from './runtime.ts';
import { ContradictionOutput, type Fact, type FactField } from './schemas/index.ts';

// Step 3 — merge per-document facts, detect contradictions (rule pre-check + optional LLM) — FR-CON-01/02.

export type MergedFact = Fact & { status: 'extracted' | 'low_confidence' | 'missing' | 'conflicted' };

export type Candidate = { value: unknown; doc_id: string; chunk_ix: number; quote: string };
export type DetectedContradiction = {
  field: FactField;
  candidates: Candidate[];
  detected_by: 'rule' | 'llm';
  explanation: string;
};

function normValue(v: unknown): string {
  if (Array.isArray(v))
    return [...v]
      .map((x) => String(x).trim().toLowerCase())
      .sort()
      .join('|');
  if (typeof v === 'string') return v.trim().toLowerCase();
  return JSON.stringify(v);
}

export function ruleMerge(
  docs: ExtractedDocument[],
  lowThreshold: number,
): { facts: MergedFact[]; contradictions: DetectedContradiction[] } {
  const byField = new Map<FactField, Fact[]>();
  for (const d of docs) for (const f of d.facts) byField.set(f.field, [...(byField.get(f.field) ?? []), f]);

  const facts: MergedFact[] = [];
  const contradictions: DetectedContradiction[] = [];

  for (const [field, list] of byField) {
    const valued = list.filter((f) => f.value !== null);
    if (valued.length === 0) {
      const reason = list.map((f) => f.missing_reason).filter(Boolean)[0] ?? 'not stated in any document';
      facts.push({
        field,
        value: null,
        confidence: 0,
        sources: [],
        missing_reason: reason,
        status: 'missing',
      });
      continue;
    }
    const distinct = new Map<string, Fact[]>();
    for (const f of valued)
      distinct.set(normValue(f.value), [...(distinct.get(normValue(f.value)) ?? []), f]);
    // Sort by confidence so the best-supported value is primary.
    const best = [...valued].sort((a, b) => b.confidence - a.confidence)[0]!;
    if (distinct.size > 1) {
      contradictions.push({
        field,
        detected_by: 'rule',
        explanation: `documents disagree on ${field}`,
        candidates: valued.map((f) => ({
          value: f.value,
          doc_id: f.sources[0]?.doc_id ?? '',
          chunk_ix: f.sources[0]?.chunk_ix ?? 0,
          quote: f.sources[0]?.quote ?? '',
        })),
      });
      facts.push({ ...best, sources: valued.flatMap((f) => f.sources), status: 'conflicted' });
    } else {
      const sources = valued.flatMap((f) => f.sources);
      const confidence = Math.max(...valued.map((f) => f.confidence));
      facts.push({
        ...best,
        sources,
        confidence,
        status: confidence < lowThreshold ? 'low_confidence' : 'extracted',
      });
    }
  }
  return { facts, contradictions };
}

/** LLM pass for semantic conflicts the rule check cannot see (e.g. "partial coverage" vs "fully monitored"). */
export async function llmContradictions(
  rt: AgentRuntime,
  caseId: string,
  stepId: string,
  docs: ExtractedDocument[],
  fixtureKey: string,
): Promise<DetectedContradiction[]> {
  if (docs.length < 2) return [];
  const prompt = loadPrompt('contradiction');
  const system = systemBlocks(prompt.text, rt.riskModel);
  const user = `Per-document facts (JSON):\n${compactJson(docs.map((d) => ({ doc_id: d.docId, facts: d.facts.filter((f) => f.value !== null) })))}\n\nList only genuine contradictions between documents about the same field.`;
  try {
    const res = await callAgent(rt, {
      agent: 'contradiction',
      schema: ContradictionOutput,
      schemaName: 'ContradictionOutput',
      system,
      user,
      caseId,
      stepId,
      fixtureKey,
    });
    return res.data.contradictions.map((c) => ({
      field: c.field,
      candidates: c.candidates,
      detected_by: 'llm' as const,
      explanation: c.explanation,
    }));
  } catch (e) {
    // Rule-based conflicts are still recorded (Architecture §5.1 step 3 failure behaviour).
    if (e instanceof LlmError) {
      rt.log.warn(
        { err: e.message, outcome: e.outcome },
        'contradiction agent failed; keeping rule-based results',
      );
      return [];
    }
    throw e;
  }
}

export function dedupeContradictions(
  a: DetectedContradiction[],
  b: DetectedContradiction[],
): DetectedContradiction[] {
  const seen = new Set(a.map((c) => c.field));
  return [...a, ...b.filter((c) => !seen.has(c.field))];
}
