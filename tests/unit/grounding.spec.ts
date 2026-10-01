import { expect, test } from '@playwright/test';
import { groundClaims } from '../../src/agents/grounding.ts';
import type { RetrievedChunk } from '../../src/agents/retrieval.ts';

// AD-07: deterministic grounding verdicts.

const chunk = (id: string, body: string): RetrievedChunk => ({
  policy_chunk_id: id,
  policy_id: 'AML',
  policy_version: 'v3',
  section_ref: '§5.3',
  title: null,
  body,
  dimension: 'geography',
  score: 1,
  query: 'q',
  rank: 1,
});

const evidence = new Map([
  [
    'E1',
    chunk(
      'c1',
      'Mexico and Brazil are designated higher-risk jurisdictions for cross-border payment products.',
    ),
  ],
  ['E2', chunk('c2', 'Instant settlement increases exposure because funds cannot be recalled once settled.')],
]);

test('SUPPORTED when every cited quote is found in its evidence', () => {
  const [g] = groundClaims(
    [
      {
        dimension: 'geography',
        text: 'Mexico is higher risk.',
        citations: [{ evidence_id: 'E1', quote: 'Mexico and Brazil are designated higher-risk' }],
      },
    ],
    evidence,
  );
  expect(g!.verdict).toBe('SUPPORTED');
  expect(g!.reason).toBe('all_quotes_verified');
});

test('WEAK when some quotes verify and others do not', () => {
  const [g] = groundClaims(
    [
      {
        dimension: 'transaction',
        text: 'Instant is risky.',
        citations: [
          { evidence_id: 'E2', quote: 'funds cannot be recalled' },
          { evidence_id: 'E1', quote: 'this is not in E1' },
        ],
      },
    ],
    evidence,
  );
  expect(g!.verdict).toBe('WEAK');
  expect(g!.citations.map((c) => c.verified)).toEqual([true, false]);
});

test('UNSUPPORTED for no citation, unknown evidence id, or quote not found', () => {
  const out = groundClaims(
    [
      { dimension: 'third_party', text: 'Vendor has strong controls.', citations: [] },
      {
        dimension: 'third_party',
        text: 'Cites a ghost.',
        citations: [{ evidence_id: 'E9', quote: 'anything' }],
      },
      {
        dimension: 'third_party',
        text: 'Wrong quote.',
        citations: [{ evidence_id: 'E1', quote: 'completely different words' }],
      },
    ],
    evidence,
  );
  expect(out.map((g) => g.verdict)).toEqual(['UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED']);
  expect(out.map((g) => g.reason)).toEqual(['no_citation', 'unknown_evidence_id', 'quote_not_found']);
});
