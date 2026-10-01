import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { users } from '../../src/db/repos/core.ts';
import type { MockBehaviour } from '../../src/llm/mock-gateway.ts';
import { ADVERSARIAL_TESTS, runAdversarial } from '../../src/services/adversarial.ts';
import { addDocument, createCase, getCaseView } from '../../src/services/case.ts';
import type { Actor } from '../../src/services/context.ts';
import { manualContinue, runPipelineNow } from '../../src/services/pipeline.ts';
import { createTestContext, FIXTURES } from '../helpers/app.ts';

// PRD §18 / §20: AI failures never become decisions; injected instructions are content, not commands.

function actorOf(ctx: ReturnType<typeof createTestContext>, username: string): Actor {
  const u = users.byUsername(ctx.db, username)!;
  return { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
}

async function newCase(
  ctx: ReturnType<typeof createTestContext>,
  vendorFile = 'RA-1001/vendor_questionnaire.md',
) {
  const actor = actorOf(ctx, 'owner.pat');
  const c = createCase(ctx, actor, {
    title: 'Adversarial fixture',
    change_type: 'product',
    description:
      'International instant payments for SMB customers in Canada and Mexico through PayRail via API; adversarial fixture case.',
  });
  await addDocument(ctx, actor, c.id, {
    filename: 'product_proposal.md',
    buffer: readFileSync(new URL('RA-1001/product_proposal.md', FIXTURES)),
    kind: 'product_proposal',
  });
  await addDocument(ctx, actor, c.id, {
    filename: 'vendor_questionnaire.md',
    buffer: readFileSync(new URL(vendorFile, FIXTURES)),
    kind: 'vendor_questionnaire',
  });
  return { c, actor };
}

for (const behaviour of ['http500', 'timeout', 'invalid_json', 'empty', 'refusal'] as MockBehaviour[]) {
  test(`LLM ${behaviour} on assessment → step failed, case pending, no decision, manual path (TEST-025/026, E2E-008)`, async () => {
    const ctx = createTestContext({ behaviours: { assessment: behaviour } });
    const { c, actor } = await newCase(ctx);
    const outcome = await runPipelineNow(ctx, actor, c.id);
    expect(outcome.status).toBe('failed');
    expect(outcome.failedStep).toBe('assess');
    const v = getCaseView(ctx, c.id);
    expect(v.case.state).toBe('ASSESSMENT');
    expect(v.calculation).toBeNull();
    expect(v.decision).toBeUndefined();
    const failed = v.pipeline!.steps.find((s) => s.step === 'assess');
    expect(failed?.status).toBe('failed');
    expect(v.pipeline!.steps.filter((s) => s.status === 'skipped').length).toBeGreaterThan(0);
    // The failure is recorded in llm_calls with the right outcome (FR-TOK-01 covers failures too).
    const rows = ctx.db
      .prepare("SELECT outcome FROM llm_calls WHERE case_id = ? AND agent = 'assessment'")
      .all(c.id) as Array<{ outcome: string }>;
    expect(rows.length).toBe(1);
    // Manual path remains available to the analyst.
    const r = manualContinue(
      ctx,
      actorOf(ctx, 'analyst.kim'),
      c.id,
      'LLM unavailable; proceeding with manual assessment per fail-safe procedure.',
    );
    expect(r.state).toBe('ANALYST_REVIEW');
  });
}

test('18.1 prompt injection: flagged, treated as content, analyst review still required', async () => {
  const ctx = createTestContext({ behaviours: { assessment: 'injection_followed' } });
  const { c, actor } = await newCase(ctx, 'RA-ADV/vendor_questionnaire_injected.md');
  const outcome = await runPipelineNow(ctx, actor, c.id);
  expect(outcome.status).toBe('succeeded');
  const v = getCaseView(ctx, c.id);
  expect(v.flags.map((f) => f.flag_type)).toEqual(
    expect.arrayContaining(['instruction_like', 'approval_instruction', 'self_assertion']),
  );
  expect(v.injection_banner).toMatch(/Not used as an instruction/);
  expect(v.case.state).toBe('ANALYST_REVIEW');
  expect(v.decision).toBeUndefined();
  // Even with every AI score driven to 1 by the "obedient" mock, the analyst sees ai_recommended and may override.
  expect(v.scores.every((s) => s.ai_recommended === 1)).toBe(true);
});

test('18.6 corrupt document → parse failure reported, no fabricated assessment', async () => {
  const ctx = createTestContext();
  const actor = actorOf(ctx, 'owner.pat');
  const c = createCase(ctx, actor, {
    title: 'Corrupt upload',
    change_type: 'vendor',
    description:
      'A case whose only document is a corrupt file; the pipeline must report the failure rather than invent an assessment.',
  });
  await expect(
    addDocument(ctx, actor, c.id, {
      filename: 'broken.pdf',
      buffer: Buffer.from('this is not a pdf at all'),
      kind: 'other',
    }),
  ).rejects.toThrow(/not a valid PDF/);
  await addDocument(ctx, actor, c.id, { filename: 'empty.md', buffer: Buffer.from('#'), kind: 'other' });
  const outcome = await runPipelineNow(ctx, actor, c.id);
  expect(outcome.status).toBe('failed');
  expect(outcome.failedStep).toBe('parse');
  const v = getCaseView(ctx, c.id);
  expect(v.documents[0]?.parse_status).toBe('parse_failed');
  expect(v.assessment).toBeNull();
});

test('Quality Center live adversarial tests all pass and are recorded', async () => {
  const ctx = createTestContext();
  const admin = actorOf(ctx, 'admin.raj');
  for (const t of ADVERSARIAL_TESTS) {
    const r = await runAdversarial(ctx, admin, t.id);
    expect(r.pass, `${t.id}: ${JSON.stringify(r.checks.filter((k) => !k.pass))}`).toBe(true);
  }
  const runs = (
    ctx.db
      .prepare("SELECT COUNT(*) n FROM quality_runs WHERE source = 'adversarial_live' AND status = 'PASS'")
      .get() as { n: number }
  ).n;
  expect(runs).toBe(ADVERSARIAL_TESTS.length);
});
