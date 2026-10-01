import { loadPrompt } from '../llm/prompts.ts';
import { type DocumentForPrompt, documentBlock, systemBlocks } from './context-builder.ts';
import { containsNormalized } from './parser.ts';
import { type AgentRuntime, callAgent } from './runtime.ts';
import { ExtractionOutput, type Fact } from './schemas/index.ts';

// Step 2 — per-document fact extraction (FR-EXT-01..04). Provenance is verified against the document:
// quotes that cannot be found lower confidence; doc_id is taken from context, never from the model.

export type ExtractedDocument = { docId: string; facts: Fact[]; instructionLikeDetected: boolean };

export async function extractFacts(
  rt: AgentRuntime,
  caseId: string,
  stepId: string,
  doc: DocumentForPrompt,
  fixtureKey: string,
): Promise<ExtractedDocument> {
  const prompt = loadPrompt('extraction');
  const cfg = rt.llm.agents.extraction;
  const system = systemBlocks(prompt.text, rt.riskModel);
  const user = `${documentBlock(doc, cfg.maxContextTokens)}\n\nExtract every fact field you can support with a verbatim quote from this document (doc_id="${doc.id}"). Fields you cannot support must have value null and a missing_reason.`;

  const res = await callAgent(rt, {
    agent: 'extraction',
    schema: ExtractionOutput,
    schemaName: 'ExtractionOutput',
    system,
    user,
    caseId,
    stepId,
    fixtureKey,
  });

  const lowThreshold = rt.llm.confidence.lowThreshold;
  const facts: Fact[] = res.data.facts.map((f) => {
    if (f.value === null) return { ...f, sources: [] };
    const sources = f.sources.map((s) => {
      // Trust context for doc identity; remap chunk to the one that actually contains the quote.
      const ix = doc.chunks.find((c) => containsNormalized(c.text, s.quote))?.chunk_ix;
      return { doc_id: doc.id, chunk_ix: ix ?? s.chunk_ix, quote: s.quote, verified: ix !== undefined };
    });
    const anyVerified = sources.some((s) => s.verified);
    const confidence = anyVerified ? f.confidence : Math.min(f.confidence, lowThreshold - 0.01);
    return { ...f, confidence, sources: sources.map(({ verified: _v, ...rest }) => rest) };
  });

  return { docId: doc.id, facts, instructionLikeDetected: res.data.instruction_like_content_detected };
}
