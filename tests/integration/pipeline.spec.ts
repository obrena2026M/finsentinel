import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { users } from '../../src/db/repos/core.ts';
import { addDocument, createCase, getCaseView } from '../../src/services/case.ts';
import type { Actor } from '../../src/services/context.ts';
import { runPipelineNow } from '../../src/services/pipeline.ts';
import { createTestContext, FIXTURES } from '../helpers/app.ts';

function owner(ctx: ReturnType<typeof createTestContext>): Actor {
  const u = users.byUsername(ctx.db, 'owner.pat')!;
  return { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
}

async function seedHighRisk(ctx: ReturnType<typeof createTestContext>) {
  const actor = owner(ctx);
  const c = createCase(ctx, actor, {
    ref: 'RA-1001',
    title: 'International Instant Payments for SMB customers',
    change_type: 'product',
    description:
      'Launch near-instant cross-border payments for existing SMB customers in Canada and Mexico via the public API channel, executed by PayRail.',
  });
  await addDocument(ctx, actor, c.id, {
    filename: 'product_proposal.md',
    buffer: readFileSync(new URL('RA-1001/product_proposal.md', FIXTURES)),
    kind: 'product_proposal',
  });
  await addDocument(ctx, actor, c.id, {
    filename: 'vendor_questionnaire.md',
    buffer: readFileSync(new URL('RA-1001/vendor_questionnaire.md', FIXTURES)),
    kind: 'vendor_questionnaire',
  });
  const outcome = await runPipelineNow(ctx, actor, c.id);
  return { c, outcome, actor };
}

test.describe('pipeline integration (FR-ARC, FR-EXT, FR-CON, FR-MIS, FR-RET, FR-ASM, FR-RSK)', () => {
  test('E2E-002 high-risk cross-border product runs end to end on the mock gateway', async () => {
    const ctx = createTestContext();
    const { c, outcome } = await seedHighRisk(ctx);
    expect(outcome.status).toBe('succeeded');

    const v = getCaseView(ctx, c.id);
    expect(v.case.state).toBe('ANALYST_REVIEW');
    expect(v.pipeline?.steps.every((s) => s.status === 'succeeded')).toBe(true);

    // Extraction: provenance preserved, SMB / Canada+Mexico / API present.
    const byField = Object.fromEntries(v.facts.map((f) => [f.field, f]));
    expect(byField.customer_segment?.value).toBe('SMB');
    expect(byField.channel?.value).toBe('API');
    expect(byField.customer_segment?.sources.length).toBeGreaterThan(0);

    // Contradiction on geographies (Canada+Mexico vs Canada+Mexico+Brazil) — TEST-023.
    expect(v.contradictions.some((x) => x.field === 'geographies' && x.status === 'open')).toBe(true);
    expect(byField.geographies?.status).toBe('conflicted');

    // Missing information — TEST-024 analogue: transaction_volume was never stated.
    expect(v.information_requests.some((r) => r.field === 'transaction_volume' && r.status === 'open')).toBe(
      true,
    );
    expect(byField.transaction_volume?.value).toBeNull();

    // Retrieval produced evidence with explainable queries — TEST-008.
    expect(v.evidence.length).toBeGreaterThan(3);
    expect(v.evidence[0]!.query).toContain('OR');

    // Grounding: the vendor self-assertion claim is UNSUPPORTED, policy-cited claims are SUPPORTED — TEST-009.
    const claims = v.assessment!.claims;
    const unsupported = claims.filter((k) => k.verdict === 'UNSUPPORTED');
    expect(unsupported.map((k) => k.text)).toContain('Vendor has strong sanctions controls.');
    expect(claims.filter((k) => k.verdict === 'SUPPORTED').length).toBeGreaterThanOrEqual(4);

    // Deterministic scoring with unverified controls → residual equals inherent — TEST-010.
    expect(v.calculation).not.toBeNull();
    expect(v.calculation!.residual_score).toBe(v.calculation!.inherent_score);
    expect(['High', 'Moderate']).toContain(v.calculation!.inherent_band);

    // Token accounting recorded for every LLM call (FR-TOK-01).
    expect(v.tokens.calls).toBeGreaterThanOrEqual(4);
    expect(v.tokens.output).toBeGreaterThan(0);

    // Blockers stop finalization (Architecture §9.1 guards).
    expect(v.blockers.length).toBeGreaterThanOrEqual(3);
  });

  test('E2E-001 low-risk domestic feature lands in a low band with no blockers except confidence', async () => {
    const ctx = createTestContext();
    const actor = owner(ctx);
    const c = createCase(ctx, actor, {
      title: 'Savings Goal feature',
      change_type: 'feature',
      description:
        'Add a Savings Goal feature to the existing mobile banking app for existing retail customers in Canada; no third party involved.',
    });
    await addDocument(ctx, actor, c.id, {
      filename: 'product_proposal.md',
      buffer: readFileSync(new URL('RA-LOW/product_proposal.md', FIXTURES)),
      kind: 'product_proposal',
    });
    const outcome = await runPipelineNow(ctx, actor, c.id);
    expect(outcome.status).toBe('succeeded');
    const v = getCaseView(ctx, c.id);
    expect(['Very Low', 'Low']).toContain(v.calculation!.inherent_band);
    expect(v.contradictions).toHaveLength(0);
    expect(v.assessment!.claims.every((k) => k.verdict === 'SUPPORTED')).toBe(true);
  });

  test('versions are frozen per case (FR-VER-02/03, TEST-027/028)', async () => {
    const ctx = createTestContext();
    const { c } = await seedHighRisk(ctx);
    const v = getCaseView(ctx, c.id);
    expect(v.versions?.risk_model_version).toBe('1.0');
    expect(v.versions?.prompt_versions.assessment).toBe('v1');
    expect(Object.keys(v.versions?.policy_versions ?? {})).toEqual(
      expect.arrayContaining(['AML', 'TM', 'SANCTIONS']),
    );
  });
});
