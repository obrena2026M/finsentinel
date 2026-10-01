import { expect, test } from '@playwright/test';
import { getCaseView } from '../../src/services/case.ts';
import { listSamples } from '../../src/services/samples.ts';
import { createTestApp, login } from '../helpers/app.ts';

// Every change type has a sample document set that runs through the whole pipeline on the mock
// gateway with resolvable fixtures: facts have provenance, claims are grounded, a band is produced.

test('GET /api/samples lists one sample per change type', async () => {
  const { app } = await createTestApp();
  const s = await login(app, 'owner.pat');
  const res = await app.inject({ method: 'GET', url: '/api/samples', headers: { cookie: s.cookie } });
  expect(res.statusCode).toBe(200);
  const types = res
    .json()
    .map((x: { change_type: string }) => x.change_type)
    .sort();
  expect(types).toEqual([
    'channel',
    'customer_segment',
    'feature',
    'geography',
    'process',
    'product',
    'transaction',
    'vendor',
  ]);
  await app.close();
});

for (const sample of listSamples()) {
  test(`sample ${sample.change_type}: create → attach samples → pipeline succeeds with grounded assessment`, async () => {
    const { app, ctx } = await createTestApp();
    const po = await login(app, 'owner.pat');
    const created = await app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: { cookie: po.cookie },
      payload: { title: sample.title, change_type: sample.change_type, description: sample.description },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const attached = await app.inject({
      method: 'POST',
      url: `/api/cases/${id}/documents/from-sample`,
      headers: { cookie: po.cookie },
      payload: { change_type: sample.change_type },
    });
    expect(attached.statusCode, attached.body).toBe(201);
    expect(attached.json()).toHaveLength(sample.documents.length);

    const { runPipelineNow } = await import('../../src/services/pipeline.ts');
    const outcome = await runPipelineNow(
      ctx,
      { id: po.user.id, username: 'owner.pat', role: 'product_owner', display_name: 'Pat' },
      id,
    );
    expect(outcome.status, JSON.stringify(outcome)).toBe('succeeded');

    const v = getCaseView(ctx, id);
    expect(v.case.state).toBe('ANALYST_REVIEW');
    const valued = v.facts.filter((f) => f.value !== null);
    expect(valued.length, `facts for ${sample.change_type}`).toBeGreaterThanOrEqual(5);
    // No fact without provenance (PR-04); no low-confidence downgrade caused by an unmatched quote in a fixture.
    expect(valued.every((f) => f.sources.length > 0)).toBe(true);
    expect(
      valued.filter((f) => f.status === 'low_confidence').map((f) => f.field),
      `unverified quotes for ${sample.change_type}`,
    ).toEqual(
      sample.change_type === 'product' ? ['transaction_velocity'] : sample.change_type === 'vendor' ? [] : [],
    );
    const claims = v.assessment!.claims;
    const retrieved = v.evidence.map((e) => `${e.policy_id} ${e.section_ref}`).join(', ');
    expect(
      claims.filter((k) => k.verdict === 'SUPPORTED').length,
      `supported claims for ${sample.change_type}: ${JSON.stringify(claims.map((k) => [k.verdict, k.text]))}; retrieved: ${retrieved}`,
    ).toBeGreaterThanOrEqual(2);
    expect(v.calculation?.inherent_band).toBeTruthy();
    await app.close();
  });
}

test('invalid change type for samples → 400', async () => {
  const { app } = await createTestApp();
  const po = await login(app, 'owner.pat');
  const created = await app.inject({
    method: 'POST',
    url: '/api/cases',
    headers: { cookie: po.cookie },
    payload: { title: 'x y z', change_type: 'product', description: 'd'.repeat(60) },
  });
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${created.json().id}/documents/from-sample`,
    headers: { cookie: po.cookie },
    payload: { change_type: 'nope' },
  });
  expect(res.statusCode).toBe(400);
  await app.close();
});
