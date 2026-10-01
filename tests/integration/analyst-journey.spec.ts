import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createTestApp, FIXTURES, login, multipart } from '../helpers/app.ts';

// Full human journey over the HTTP API: PO submits → pipeline → analyst clears blockers, overrides →
// finalize → committee decides with conditions → audit chain verifies. (E2E-004/005, TEST-013..019)

test('analyst override → committee approval with conditions, fully audited', async () => {
  const { app, ctx } = await createTestApp();
  const po = await login(app, 'owner.pat');
  const analyst = await login(app, 'analyst.kim');
  const committee = await login(app, 'committee.lee');

  // Product owner creates the case and uploads documents (TEST-001/003).
  const created = await app.inject({
    method: 'POST',
    url: '/api/cases',
    headers: { cookie: po.cookie },
    payload: {
      title: 'International Instant Payments for SMB',
      change_type: 'product',
      description:
        'Launch near-instant cross-border payments for existing SMB customers in Canada and Mexico via the public API channel, executed by PayRail Inc.',
    },
  });
  expect(created.statusCode).toBe(201);
  const caseId = created.json().id as string;

  for (const [file, kind] of [
    ['product_proposal.md', 'product_proposal'],
    ['vendor_questionnaire.md', 'vendor_questionnaire'],
  ] as const) {
    const mp = multipart(
      { kind },
      {
        name: file,
        content: readFileSync(new URL(`RA-1001/${file}`, FIXTURES)),
        contentType: 'text/markdown',
      },
    );
    const up = await app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/documents`,
      headers: { cookie: po.cookie, ...mp.headers },
      payload: mp.payload,
    });
    expect(up.statusCode, up.body).toBe(201);
  }

  // Unsupported file is rejected (TEST-004).
  const bad = multipart({ kind: 'other' }, { name: 'malware.exe', content: Buffer.from('MZ....') });
  const badRes = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/documents`,
    headers: { cookie: po.cookie, ...bad.headers },
    payload: bad.payload,
  });
  expect(badRes.statusCode).toBe(400);
  expect(badRes.json().message).toMatch(/Unsupported type/);

  // Run the pipeline and poll until it finishes.
  const run = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/pipeline/run`,
    headers: { cookie: po.cookie },
  });
  expect(run.statusCode).toBe(202);
  // biome-ignore lint/suspicious/noExplicitAny: untyped JSON view model in an HTTP-level test
  let view: any = {};
  for (let i = 0; i < 200; i++) {
    const r = await app.inject({
      method: 'GET',
      url: `/api/cases/${caseId}`,
      headers: { cookie: analyst.cookie },
    });
    view = r.json();
    if (view.case.state === 'ANALYST_REVIEW') break;
    await new Promise((res) => setTimeout(res, 50));
  }
  expect(view.case.state).toBe('ANALYST_REVIEW');

  // Finalize is blocked while blockers exist.
  const early = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/finalize`,
    headers: { cookie: analyst.cookie },
  });
  expect(early.statusCode).toBe(409);

  // Clear blockers: confirm low-confidence facts.
  for (const f of view.facts.filter((f: { status: string }) => f.status === 'low_confidence')) {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/cases/${caseId}/facts/${f.id}/confirm`,
      headers: { cookie: analyst.cookie },
    });
    expect(r.statusCode).toBe(200);
  }
  // Resolve contradictions with rationale.
  for (const c of view.contradictions.filter((c: { status: string }) => c.status === 'open')) {
    const short = await app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/contradictions/${c.id}/resolve`,
      headers: { cookie: analyst.cookie },
      payload: { value: ['Canada', 'Mexico'], rationale: 'too short' },
    });
    expect(short.statusCode).toBe(409);
    const r = await app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/contradictions/${c.id}/resolve`,
      headers: { cookie: analyst.cookie },
      payload: {
        value: ['Canada', 'Mexico'],
        rationale:
          'Phase one scope per the approved proposal is Canada and Mexico; Brazil is out of scope until re-assessed.',
      },
    });
    expect(r.statusCode, r.body).toBe(200);
  }
  // Accept information gaps with rationale.
  for (const ir of view.information_requests.filter((r: { status: string }) => r.status === 'open')) {
    const r = await app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/information-requests/${ir.id}/accept-gap`,
      headers: { cookie: analyst.cookie },
      payload: {
        rationale:
          'Volume projections will be a launch condition; assessment proceeds on maximum value assumptions.',
      },
    });
    expect(r.statusCode).toBe(200);
  }
  // Remove the unsupported vendor claim.
  for (const k of view.assessment.claims.filter(
    (k: { verdict: string; status: string }) => k.verdict === 'UNSUPPORTED' && k.status === 'active',
  )) {
    const r = await app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/claims/${k.id}/remove`,
      headers: { cookie: analyst.cookie },
      payload: {
        rationale: 'Vendor self-assertion is not evidence of control effectiveness (Sanctions Policy §4.3).',
      },
    });
    expect(r.statusCode).toBe(200);
  }

  // Override geography 4 → 3 (TEST-013/014): without rationale rejected, with rationale recalculates.
  const before = (
    await app.inject({ method: 'GET', url: `/api/cases/${caseId}`, headers: { cookie: analyst.cookie } })
  ).json();
  const geo = before.scores.find((s: { dimension: string }) => s.dimension === 'geography');
  expect(geo.current_score).toBe(4);
  const noReason = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/overrides`,
    headers: { cookie: analyst.cookie },
    payload: { dimension: 'geography', new_score: 3, rationale: '' },
  });
  expect(noReason.statusCode).toBe(409);
  const ov = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/overrides`,
    headers: { cookie: analyst.cookie },
    payload: {
      dimension: 'geography',
      new_score: 3,
      rationale:
        'Comparable existing products have established monitoring coverage and similar geographic exposure.',
    },
  });
  expect(ov.statusCode, ov.body).toBe(201);
  expect(ov.json().calculation.inherent_score).toBeLessThan(before.calculation.inherent_score);

  // Strong control on channel reduces residual but never to floor (TEST-011/012).
  const ctl = await app.inject({
    method: 'PATCH',
    url: `/api/cases/${caseId}/controls/channel`,
    headers: { cookie: analyst.cookie },
    payload: {
      rating: 'strong',
      rationale:
        'Existing API gateway enforces OAuth client credentials and per-client velocity limits, tested in Q2.',
    },
  });
  expect(ctl.statusCode, ctl.body).toBe(200);
  const afterCtl = ctl.json().calculation;
  expect(afterCtl.residual_score).toBeLessThan(afterCtl.inherent_score);
  expect(afterCtl.residual_score).toBeGreaterThan(1);

  // Finalize → COMMITTEE_REVIEW.
  const fin = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/finalize`,
    headers: { cookie: analyst.cookie },
  });
  expect(fin.statusCode, fin.body).toBe(200);
  expect(fin.json().state).toBe('COMMITTEE_REVIEW');

  // Analyst cannot decide (TEST-017); committee approves with conditions (TEST-019).
  const denied = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/decision`,
    headers: { cookie: analyst.cookie },
    payload: { type: 'APPROVE', rationale: 'Analyst attempting to approve — must be denied by RBAC.' },
  });
  expect(denied.statusCode).toBe(403);
  const noCond = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/decision`,
    headers: { cookie: committee.cookie },
    payload: {
      type: 'APPROVE_WITH_CONDITIONS',
      rationale: 'Conditions are required for this decision type.',
      conditions: [],
    },
  });
  expect(noCond.statusCode).toBe(400);
  const dec = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/decision`,
    headers: { cookie: committee.cookie },
    payload: {
      type: 'APPROVE_WITH_CONDITIONS',
      rationale:
        'Residual risk is Moderate with analyst-verified controls; launch permitted subject to conditions.',
      conditions: [
        { text: 'Complete vendor sanctions control testing before launch' },
        { text: 'Monthly TM tuning review for first 6 months' },
      ],
    },
  });
  expect(dec.statusCode, dec.body).toBe(201);
  expect(dec.json().state).toBe('DECIDED');
  expect(dec.json().conditions).toHaveLength(2);

  // Packet and audit integrity (TEST-015, FR-AUD-06).
  const packet = await app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/packet`,
    headers: { cookie: committee.cookie },
  });
  expect(packet.statusCode).toBe(200);
  expect(packet.json().decision.type).toBe('APPROVE_WITH_CONDITIONS');
  const audit = await app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/audit`,
    headers: { cookie: po.cookie },
  });
  const actions = audit.json().map((e: { action: string }) => e.action);
  expect(actions).toEqual(
    expect.arrayContaining([
      'case_created',
      'document_uploaded',
      'pipeline_started',
      'assessment_drafted',
      'risk_calculated',
      'override',
      'risk_recalculated',
      'control_rating_set',
      'finalized',
      'decision',
    ]),
  );
  const verify = await app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/audit/verify`,
    headers: { cookie: po.cookie },
  });
  expect(verify.json().ok).toBe(true);

  // Governance gate: no unauthorized decision exists in the database.
  const rows = ctx.db
    .prepare(
      "SELECT COUNT(*) n FROM decisions d JOIN users u ON u.id = d.decided_by WHERE u.role <> 'committee'",
    )
    .get() as { n: number };
  expect(rows.n).toBe(0);
  await app.close();
});
