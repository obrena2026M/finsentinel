import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { users } from '../../src/db/repos/core.ts';
import { addDocument, createCase, getCaseView } from '../../src/services/case.ts';
import type { Actor } from '../../src/services/context.ts';
import { runPipelineNow } from '../../src/services/pipeline.ts';
import { override, setControl } from '../../src/services/scoring.ts';
import { createTestApp, createTestContext, FIXTURES, login } from '../helpers/app.ts';

// Remaining service branches and system routes: information-request round trip, analyst fact entry,
// assessment edits, evidence attachment, DEFER/REJECT/close, admin risk-model publishing, health,
// metrics, quality, auth edge cases, error mapping.

function actorOf(ctx: ReturnType<typeof createTestContext>, username: string): Actor {
  const u = users.byUsername(ctx.db, username)!;
  return { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
}

async function seededCase(ctx: ReturnType<typeof createTestContext>) {
  const owner = actorOf(ctx, 'owner.pat');
  const c = createCase(ctx, owner, {
    title: 'International Instant Payments for SMB customers',
    change_type: 'product',
    description:
      'Launch near-instant cross-border payments for existing SMB customers in Canada and Mexico via the public API channel, executed by PayRail Inc.',
  });
  await addDocument(ctx, owner, c.id, {
    filename: 'product_proposal.md',
    buffer: readFileSync(new URL('RA-1001/product_proposal.md', FIXTURES)),
    kind: 'product_proposal',
  });
  await addDocument(ctx, owner, c.id, {
    filename: 'vendor_questionnaire.md',
    buffer: readFileSync(new URL('RA-1001/vendor_questionnaire.md', FIXTURES)),
    kind: 'vendor_questionnaire',
  });
  await runPipelineNow(ctx, owner, c.id);
  return c;
}

test('information request round trip: analyst sends to owner, owner answers, case returns to review', async () => {
  const { app, ctx } = await createTestApp();
  const c = await seededCase(ctx);
  const analyst = await login(app, 'analyst.kim');
  const po = await login(app, 'owner.pat');

  const sent = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/request-info`,
    headers: { cookie: analyst.cookie },
  });
  expect(sent.statusCode, sent.body).toBe(200);
  expect(sent.json().state).toBe('INFO_REQUESTED');

  const view = getCaseView(ctx, c.id);
  for (const r of view.information_requests.filter((x) => x.status === 'open')) {
    const empty = await app.inject({
      method: 'POST',
      url: `/api/cases/${c.id}/information-requests/${r.id}/respond`,
      headers: { cookie: po.cookie },
      payload: { answer: ' ' },
    });
    expect(empty.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: `/api/cases/${c.id}/information-requests/${r.id}/respond`,
      headers: { cookie: po.cookie },
      payload: { answer: 'Approximately 12,000 payments per month at launch.' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('answered');
  }
  expect(getCaseView(ctx, c.id).case.state).toBe('ANALYST_REVIEW');
  // Nothing left to send.
  const again = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/request-info`,
    headers: { cookie: analyst.cookie },
  });
  expect(again.statusCode).toBe(400);
  // Unknown request id → 404.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/cases/${c.id}/information-requests/nope/respond`,
        headers: { cookie: po.cookie },
        payload: { answer: 'x y' },
      })
    ).statusCode,
  ).toBe(404);
  await app.close();
});

test('analyst enters a fact, edits the summary, attaches evidence to a claim; validation paths', async () => {
  const { app, ctx } = await createTestApp();
  const c = await seededCase(ctx);
  const analyst = await login(app, 'analyst.kim');

  // Enter a value for the missing transaction_volume (closes its open request).
  const bad = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/facts`,
    headers: { cookie: analyst.cookie },
    payload: { field: 'not_a_field', value: 1, rationale: 'x'.repeat(25) },
  });
  expect(bad.statusCode).toBe(400);
  const noValue = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/facts`,
    headers: { cookie: analyst.cookie },
    payload: { field: 'transaction_volume', value: '', rationale: 'x'.repeat(25) },
  });
  expect(noValue.statusCode).toBe(400);
  const entered = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/facts`,
    headers: { cookie: analyst.cookie },
    payload: {
      field: 'transaction_volume',
      value: '12,000 per month',
      rationale: 'Provided by the payments product team by email on 2026-09-27.',
    },
  });
  expect(entered.statusCode, entered.body).toBe(200);
  expect(entered.json().status).toBe('analyst_entered');
  const v1 = getCaseView(ctx, c.id);
  expect(v1.information_requests.find((r) => r.field === 'transaction_volume')?.status).toBe('answered');
  // Entering a brand-new field creates a row.
  const created = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/facts`,
    headers: { cookie: analyst.cookie },
    payload: {
      field: 'transaction_velocity',
      value: 'max 20 per day',
      rationale: 'Confirmed with API gateway configuration export.',
    },
  });
  expect(created.statusCode).toBe(200);

  // Edit summary.
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/cases/${c.id}/assessment`,
        headers: { cookie: analyst.cookie },
        payload: { summary: 'short' },
      })
    ).statusCode,
  ).toBe(400);
  const edited = await app.inject({
    method: 'PATCH',
    url: `/api/cases/${c.id}/assessment`,
    headers: { cookie: analyst.cookie },
    payload: { summary: 'Analyst-edited summary that is comfortably longer than twenty characters.' },
  });
  expect(edited.statusCode).toBe(200);
  expect(edited.json().summary).toMatch(/Analyst-edited/);

  // Attach evidence to the unsupported claim: wrong quote rejected, verified quote flips verdict.
  const unsupported = v1.assessment!.claims.find((k) => k.verdict === 'UNSUPPORTED')!;
  const ev = v1.evidence.find((e) => e.policy_id === 'SANCTIONS' && e.section_ref === '§4.3')!;
  const wrong = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/claims/${unsupported.id}/evidence`,
    headers: { cookie: analyst.cookie },
    payload: { evidence_ref_id: ev.id, quote: 'this sentence is not in the policy' },
  });
  expect(wrong.statusCode).toBe(400);
  const right = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/claims/${unsupported.id}/evidence`,
    headers: { cookie: analyst.cookie },
    payload: {
      evidence_ref_id: ev.id,
      quote: "A vendor's self-assessment or questionnaire response is not evidence of control effectiveness",
    },
  });
  expect(right.statusCode, right.body).toBe(200);
  expect(right.json().verdict).toBe('SUPPORTED');
  // Unknown claim / evidence → 404.
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/cases/${c.id}/claims/nope/evidence`,
        headers: { cookie: analyst.cookie },
        payload: { evidence_ref_id: ev.id, quote: 'abc' },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/cases/${c.id}/claims/${unsupported.id}/remove`,
        headers: { cookie: analyst.cookie },
        payload: { rationale: 'short' },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/cases/${c.id}/facts/nope/confirm`,
        headers: { cookie: analyst.cookie },
      })
    ).statusCode,
  ).toBe(404);
  await app.close();
});

test('committee DEFER returns the case to analyst review; REJECT stores a decision; close moves to CLOSED', async () => {
  const { app, ctx } = await createTestApp();
  const c = await seededCase(ctx);
  const analyst = actorOf(ctx, 'analyst.kim');
  // Clear blockers quickly through services.
  const v = getCaseView(ctx, c.id);
  const { confirmFact, resolveContradiction, acceptGap, removeClaim } = await import(
    '../../src/services/analysis.ts'
  );
  for (const f of v.facts.filter((f) => f.status === 'low_confidence')) confirmFact(ctx, analyst, c.id, f.id);
  for (const x of v.contradictions.filter((x) => x.status === 'open'))
    resolveContradiction(
      ctx,
      analyst,
      c.id,
      x.id,
      ['Canada', 'Mexico'],
      'Phase one scope is Canada and Mexico per the approved proposal.',
    );
  for (const r of v.information_requests.filter((r) => r.status === 'open'))
    acceptGap(
      ctx,
      analyst,
      c.id,
      r.id,
      'Volume will be a launch condition; proceeding on maximum value assumptions.',
    );
  for (const k of v.assessment!.claims.filter((k) => k.verdict === 'UNSUPPORTED'))
    removeClaim(ctx, analyst, c.id, k.id, 'Vendor self-assertion is not evidence of control effectiveness.');
  const { finalize } = await import('../../src/services/workflow.ts');
  expect(finalize(ctx, analyst, c.id).state).toBe('COMMITTEE_REVIEW');

  const committee = await login(app, 'committee.lee');
  const bad = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/decision`,
    headers: { cookie: committee.cookie },
    payload: { type: 'MAYBE', rationale: 'x'.repeat(25) },
  });
  expect(bad.statusCode).toBe(400);
  const defer = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/decision`,
    headers: { cookie: committee.cookie },
    payload: { type: 'DEFER', rationale: 'Need vendor sanctions testing evidence before deciding.' },
  });
  expect(defer.statusCode, defer.body).toBe(201);
  expect(defer.json().state).toBe('ANALYST_REVIEW');
  expect(getCaseView(ctx, c.id).decision).toBeUndefined();

  // Back to committee and reject.
  expect(finalize(ctx, analyst, c.id).state).toBe('COMMITTEE_REVIEW');
  const closeEarly = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/close`,
    headers: { cookie: committee.cookie },
  });
  expect(closeEarly.statusCode).toBe(409);
  const reject = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/decision`,
    headers: { cookie: committee.cookie },
    payload: {
      type: 'REJECT',
      rationale: 'Residual risk remains High with an unverified third-party processor.',
    },
  });
  expect(reject.statusCode, reject.body).toBe(201);
  expect(reject.json().state).toBe('DECIDED');
  const closed = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/close`,
    headers: { cookie: committee.cookie },
  });
  expect(closed.statusCode).toBe(200);
  expect(closed.json().state).toBe('CLOSED');
  // A second decision on a closed case is a workflow error.
  const twice = await app.inject({
    method: 'POST',
    url: `/api/cases/${c.id}/decision`,
    headers: { cookie: committee.cookie },
    payload: { type: 'APPROVE', rationale: 'Attempting a second decision on a closed case.' },
  });
  expect(twice.statusCode).toBe(409);
  await app.close();
});

test('scoring service validation branches', async () => {
  const ctx = createTestContext();
  const analyst = actorOf(ctx, 'analyst.kim');
  const owner = actorOf(ctx, 'owner.pat');
  const fresh = createCase(ctx, owner, {
    title: 'No pipeline yet',
    change_type: 'process',
    description:
      'A case whose pipeline has not run; scoring actions must be rejected with clear validation errors.',
  });
  expect(() => override(ctx, analyst, fresh.id, 'geography', 3, 'x'.repeat(25))).toThrow(
    /run the pipeline first/,
  );
  expect(() => setControl(ctx, analyst, fresh.id, 'geography', 'strong', 'x'.repeat(25))).toThrow(
    /run the pipeline first/,
  );
  expect(() => override(ctx, analyst, 'missing-case', 'geography', 3, 'x'.repeat(25))).toThrow(/not found/);
  const c = await seededCase(ctx);
  expect(() => override(ctx, analyst, c.id, 'colour', 3, 'x'.repeat(25))).toThrow(/unknown dimension/);
  expect(() => override(ctx, analyst, c.id, 'geography', 9, 'x'.repeat(25))).toThrow(/outside scale/);
  expect(() => override(ctx, analyst, c.id, 'geography', 4, 'x'.repeat(25))).toThrow(/equals current/);
  expect(() => setControl(ctx, analyst, c.id, 'geography', 'excellent', 'x'.repeat(25))).toThrow(
    /unknown control rating/,
  );
  expect(() => setControl(ctx, analyst, c.id, 'nope', 'strong', 'x'.repeat(25))).toThrow(/unknown dimension/);
  const r = setControl(
    ctx,
    analyst,
    c.id,
    'geography',
    'weak',
    'Partial screening coverage confirmed by the vendor test report.',
  );
  expect(r.calculation?.trigger).toBe('control_change');
});

test('system routes: health, metrics, quality, admin risk model publish/validation', async () => {
  const { app, ctx } = await createTestApp();
  await seededCase(ctx);
  const admin = await login(app, 'admin.raj');
  const analyst = await login(app, 'analyst.kim');

  const ready = await app.inject({ method: 'GET', url: '/health/ready' });
  expect(ready.statusCode).toBe(200);
  expect(ready.json().checks.retrieval_index).toBe(true);

  const metrics = await app.inject({
    method: 'GET',
    url: '/api/metrics',
    headers: { cookie: analyst.cookie },
  });
  expect(metrics.statusCode).toBe(200);
  const m = metrics.json();
  expect(m.ai.llm_calls_24h).toBeGreaterThan(0);
  expect(m.business.cases_total).toBe(1);
  expect(m.system.requests_24h).toBeGreaterThanOrEqual(0);

  const quality = await app.inject({
    method: 'GET',
    url: '/api/quality',
    headers: { cookie: analyst.cookie },
  });
  expect(quality.statusCode).toBe(200);
  expect(['PASS', 'FAIL', 'NO_RUN']).toContain(quality.json().status);
  expect(quality.json().adversarial_tests.length).toBe(4);
  const advBad = await app.inject({
    method: 'POST',
    url: '/api/quality/adversarial/nope/run',
    headers: { cookie: admin.cookie },
  });
  expect(advBad.statusCode).toBe(400);

  const current = await app.inject({
    method: 'GET',
    url: '/api/admin/risk-model',
    headers: { cookie: analyst.cookie },
  });
  expect(current.json().active.version).toBe('1.0');
  const model = current.json().active;
  const invalid = await app.inject({
    method: 'PUT',
    url: '/api/admin/risk-model',
    headers: { cookie: admin.cookie },
    payload: {
      model: {
        ...model,
        version: '1.1',
        dimensions: model.dimensions.map((d: { weight: number }, i: number) =>
          i === 0 ? { ...d, weight: d.weight + 10 } : d,
        ),
      },
      notes: 'weights broken',
    },
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().error).toBe('invalid_risk_model');
  const dup = await app.inject({
    method: 'PUT',
    url: '/api/admin/risk-model',
    headers: { cookie: admin.cookie },
    payload: { model, notes: 'same version again' },
  });
  expect(dup.statusCode).toBe(400);
  const noNotes = await app.inject({
    method: 'PUT',
    url: '/api/admin/risk-model',
    headers: { cookie: admin.cookie },
    payload: { model: { ...model, version: '1.1' }, notes: 'x' },
  });
  expect(noNotes.statusCode).toBe(400);
  const ok = await app.inject({
    method: 'PUT',
    url: '/api/admin/risk-model',
    headers: { cookie: admin.cookie },
    payload: {
      model: { ...model, version: '1.1', controls: { ...model.controls, maxMitigation: 0.4 } },
      notes: 'Reduce max mitigation after committee feedback',
    },
  });
  expect(ok.statusCode, ok.body).toBe(201);
  const after = await app.inject({
    method: 'GET',
    url: '/api/admin/risk-model',
    headers: { cookie: analyst.cookie },
  });
  expect(after.json().active.version).toBe('1.1');
  expect(after.json().versions.length).toBe(2);
  // Existing case keeps v1.0 (FR-VER-03).
  const cases = await app.inject({ method: 'GET', url: '/api/cases', headers: { cookie: analyst.cookie } });
  const view = await app.inject({
    method: 'GET',
    url: `/api/cases/${cases.json()[0].id}`,
    headers: { cookie: analyst.cookie },
  });
  expect(view.json().versions.risk_model_version).toBe('1.0');
  await app.close();
});

test('auth and error mapping edge cases', async () => {
  const { app } = await createTestApp();
  expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
  // With web/dist present the root serves the SPA; without it, the API hint JSON.
  const root = await app.inject({ method: 'GET', url: '/' });
  expect(root.statusCode).toBe(200);
  expect(root.body).toMatch(/FinSentinel/);
  if (root.headers['content-type']?.toString().includes('text/html')) {
    // SPA fallback for client routes; API 404s stay JSON.
    const spa = await app.inject({ method: 'GET', url: '/cases/some-id' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toMatch(/<div id="root">|<html/);
  }
  const s = await login(app, 'analyst.kim');
  expect(
    (await app.inject({ method: 'GET', url: '/api/cases/does-not-exist', headers: { cookie: s.cookie } }))
      .statusCode,
  ).toBe(404);
  expect(
    (await app.inject({ method: 'GET', url: '/api/nope', headers: { cookie: s.cookie } })).statusCode,
  ).toBe(404);
  const malformed = await app.inject({
    method: 'POST',
    url: '/api/cases',
    headers: { cookie: (await login(app, 'owner.pat')).cookie, 'content-type': 'application/json' },
    payload: '{not json',
  });
  expect(malformed.statusCode).toBe(400);
  const noFile = await app.inject({
    method: 'POST',
    url: '/api/cases/x/documents',
    headers: {
      cookie: (await login(app, 'owner.pat')).cookie,
      'content-type': 'multipart/form-data; boundary=abc',
    },
    payload: '--abc--\r\n',
  });
  expect([400, 404, 406]).toContain(noFile.statusCode);
  await app.close();
});

test('password mode is reserved (501) and unknown user is 404', async () => {
  const { app, ctx } = await createTestApp();
  (ctx.env as { AUTH_MODE: string }).AUTH_MODE = 'password';
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'analyst.kim', password: 'x' },
      })
    ).statusCode,
  ).toBe(501);
  (ctx.env as { AUTH_MODE: string }).AUTH_MODE = 'simulation';
  expect(
    (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ghost' } })).statusCode,
  ).toBe(404);
  await app.close();
});

test('contradiction agent failure keeps rule-based results (step 3 degrade path)', async () => {
  const ctx = createTestContext({ behaviours: { contradiction: 'http500' } });
  const c = await seededCase(ctx);
  const v = getCaseView(ctx, c.id);
  expect(v.case.state).toBe('ANALYST_REVIEW');
  expect(v.contradictions.some((x) => x.field === 'geographies' && x.detected_by === 'rule')).toBe(true);
  expect(v.contradictions.some((x) => x.detected_by === 'llm')).toBe(false);
});
