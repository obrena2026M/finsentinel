import { loadPrompt } from '../llm/prompts.ts';
import { compactJson, systemBlocks } from './context-builder.ts';
import type { MergedFact } from './merge.ts';
import { type AgentRuntime, callAgent } from './runtime.ts';
import { ScopingOutput } from './schemas/index.ts';

// Step 5 — risk-factor identification (FR-SCP-01..03).

export async function scopeDimensions(
  rt: AgentRuntime,
  caseId: string,
  stepId: string,
  facts: MergedFact[],
  fixtureKey: string,
) {
  const prompt = loadPrompt('scoping');
  const system = systemBlocks(prompt.text, rt.riskModel);
  const known = facts.filter((f) => f.value !== null).map((f) => ({ field: f.field, value: f.value }));
  const missing = facts.filter((f) => f.value === null).map((f) => f.field);
  const user = `Known facts: ${compactJson(known)}\nMissing facts: ${compactJson(missing)}\n\nIdentify which risk dimensions are relevant and which facts trigger each.`;
  const res = await callAgent(rt, {
    agent: 'scoping',
    schema: ScopingOutput,
    schemaName: 'ScopingOutput',
    system,
    user,
    caseId,
    stepId,
    fixtureKey,
  });
  // De-duplicate by dimension, keep first rationale.
  const seen = new Set<string>();
  return res.data.dimensions.filter((d) => {
    if (seen.has(d.dimension)) return false;
    seen.add(d.dimension);
    return true;
  });
}
