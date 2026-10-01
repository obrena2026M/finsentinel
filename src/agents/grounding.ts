import type { EvidenceIdMap } from './assessment.ts';
import { containsNormalized } from './parser.ts';
import type { Claim } from './schemas/index.ts';

// Step 8 — deterministic grounding (FR-ASM-02/03, EV-04, Architecture §7 / AD-07).

export type Verdict = 'SUPPORTED' | 'UNSUPPORTED' | 'WEAK';

export type GroundedClaim = {
  claim: Claim;
  verdict: Verdict;
  reason: string;
  citations: Array<{ evidence_id: string; quote: string; verified: boolean }>;
};

export function groundClaims(claims: Claim[], evidence: EvidenceIdMap): GroundedClaim[] {
  return claims.map((claim) => {
    const citations = claim.citations.map((c) => {
      const chunk = evidence.get(c.evidence_id);
      const verified = !!chunk && containsNormalized(chunk.body, c.quote);
      return { evidence_id: c.evidence_id, quote: c.quote, verified };
    });
    if (citations.length === 0) return { claim, verdict: 'UNSUPPORTED', reason: 'no_citation', citations };
    const verified = citations.filter((c) => c.verified).length;
    if (verified === citations.length)
      return { claim, verdict: 'SUPPORTED', reason: 'all_quotes_verified', citations };
    if (verified > 0) return { claim, verdict: 'WEAK', reason: 'some_quotes_not_found', citations };
    const unknownId = citations.some((c) => !evidence.has(c.evidence_id));
    return {
      claim,
      verdict: 'UNSUPPORTED',
      reason: unknownId ? 'unknown_evidence_id' : 'quote_not_found',
      citations,
    };
  });
}
