import { expect, test } from '@playwright/test';
import { users } from '../../src/db/repos/core.ts';
import { createCase } from '../../src/services/case.ts';
import { createTestApp, login } from '../helpers/app.ts';

// Table-driven role × route matrix (FR-RBAC-01..07, TEST-016/017/030, NFR-SEC-02/03).

const ROLES = ['owner.pat', 'analyst.kim', 'committee.lee', 'admin.raj'] as const;
type U = (typeof ROLES)[number];

type Route = {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  url: (caseId: string) => string;
  payload?: Record<string, unknown>;
  allowed: U[];
};

const ROUTES: Route[] = [
  {
    name: 'create case',
    method: 'POST',
    url: () => '/api/cases',
    payload: { title: 'x', change_type: 'product', description: 'd' },
    allowed: ['owner.pat'],
  },
  { name: 'view case', method: 'GET', url: (id) => `/api/cases/${id}`, allowed: [...ROLES] },
  {
    name: 'run pipeline',
    method: 'POST',
    url: (id) => `/api/cases/${id}/pipeline/run`,
    allowed: ['owner.pat', 'analyst.kim'],
  },
  {
    name: 'manual continue',
    method: 'POST',
    url: (id) => `/api/cases/${id}/pipeline/continue-manually`,
    payload: { rationale: 'r' },
    allowed: ['analyst.kim'],
  },
  {
    name: 'enter fact',
    method: 'POST',
    url: (id) => `/api/cases/${id}/facts`,
    payload: { field: 'channel', value: 'API', rationale: 'r' },
    allowed: ['analyst.kim'],
  },
  {
    name: 'override',
    method: 'POST',
    url: (id) => `/api/cases/${id}/overrides`,
    payload: { dimension: 'geography', new_score: 3, rationale: 'r' },
    allowed: ['analyst.kim'],
  },
  {
    name: 'set control',
    method: 'PATCH',
    url: (id) => `/api/cases/${id}/controls/geography`,
    payload: { rating: 'strong', rationale: 'r' },
    allowed: ['analyst.kim'],
  },
  {
    name: 'edit assessment',
    method: 'PATCH',
    url: (id) => `/api/cases/${id}/assessment`,
    payload: { summary: 's' },
    allowed: ['analyst.kim'],
  },
  { name: 'finalize', method: 'POST', url: (id) => `/api/cases/${id}/finalize`, allowed: ['analyst.kim'] },
  {
    name: 'decision',
    method: 'POST',
    url: (id) => `/api/cases/${id}/decision`,
    payload: { type: 'APPROVE', rationale: 'r' },
    allowed: ['committee.lee'],
  },
  {
    name: 'packet',
    method: 'GET',
    url: (id) => `/api/cases/${id}/packet`,
    allowed: ['analyst.kim', 'committee.lee'],
  },
  { name: 'audit', method: 'GET', url: (id) => `/api/cases/${id}/audit`, allowed: [...ROLES] },
  {
    name: 'publish risk model',
    method: 'PUT',
    url: () => '/api/admin/risk-model',
    payload: { model: {}, notes: 'n' },
    allowed: ['admin.raj'],
  },
  { name: 'view risk model', method: 'GET', url: () => '/api/admin/risk-model', allowed: [...ROLES] },
  { name: 'quality', method: 'GET', url: () => '/api/quality', allowed: [...ROLES] },
  {
    name: 'run adversarial',
    method: 'POST',
    url: () => '/api/quality/adversarial/missing_information/run',
    allowed: ['analyst.kim', 'admin.raj'],
  },
  { name: 'metrics', method: 'GET', url: () => '/api/metrics', allowed: [...ROLES] },
];

test.describe('RBAC route matrix', () => {
  test('forbidden roles get 403 and an authz_denied audit event; unauthenticated gets 401', async () => {
    const { app, ctx } = await createTestApp();
    const owner = users.byUsername(ctx.db, 'owner.pat')!;
    const c = createCase(
      ctx,
      { id: owner.id, username: owner.username, role: owner.role, display_name: owner.display_name },
      {
        title: 'RBAC fixture',
        change_type: 'product',
        description:
          'Fixture case used only to exercise role-based access control across every mutating and read route.',
      },
    );
    const sessions = Object.fromEntries(
      await Promise.all(ROLES.map(async (u) => [u, await login(app, u)])),
    ) as Record<U, Awaited<ReturnType<typeof login>>>;

    for (const route of ROUTES) {
      // Unauthenticated
      const anon = await app.inject({ method: route.method, url: route.url(c.id), payload: route.payload });
      expect(anon.statusCode, `${route.name} anonymous`).toBe(401);
      for (const u of ROLES) {
        const res = await app.inject({
          method: route.method,
          url: route.url(c.id),
          payload: route.payload,
          headers: { cookie: sessions[u].cookie },
        });
        if (route.allowed.includes(u)) {
          expect(
            res.statusCode,
            `${route.name} as ${u} should not be 401/403 (got ${res.statusCode}: ${res.body})`,
          ).not.toBe(403);
          expect(res.statusCode).not.toBe(401);
        } else {
          expect(
            res.statusCode,
            `${route.name} as ${u} must be forbidden (got ${res.statusCode}: ${res.body})`,
          ).toBe(403);
        }
      }
    }

    const denied = (
      ctx.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action = 'authz_denied'").get() as {
        n: number;
      }
    ).n;
    expect(denied).toBeGreaterThan(20);
    await app.close();
  });

  test('database trigger blocks a non-committee decision even if the API were bypassed (AD-09)', async () => {
    const { ctx, app } = await createTestApp();
    const analyst = users.byUsername(ctx.db, 'analyst.kim')!;
    const owner = users.byUsername(ctx.db, 'owner.pat')!;
    const c = createCase(
      ctx,
      { id: owner.id, username: owner.username, role: owner.role, display_name: owner.display_name },
      {
        title: 'Trigger fixture',
        change_type: 'product',
        description:
          'Fixture case used to prove the decisions table trigger rejects any actor whose role is not committee.',
      },
    );
    expect(() =>
      ctx.db
        .prepare(
          `INSERT INTO decisions (id, case_id, type, rationale, decided_by, decided_at) VALUES ('x', ?, 'APPROVE', 'bypass attempt with a long enough rationale', ?, '2026-01-01T00:00:00Z')`,
        )
        .run(c.id, analyst.id),
    ).toThrow(/only committee may decide/);
    await app.close();
  });

  test('sessions are httpOnly, sameSite and destroyed on logout (NFR-SEC-09)', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'analyst.kim' },
    });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const s = cookie.split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: s } })).statusCode).toBe(
      200,
    );
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: s } });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: s } })).statusCode).toBe(
      401,
    );
    await app.close();
  });

  // DEP-05: production profile behind a TLS-terminating proxy: Secure cookie, proxy trust, CORS allow-list.
  test('production flags: Secure cookie and CORS allow-list (NFR-SEC-09, DEP-05)', async () => {
    const { app } = await createTestApp(
      {},
      { COOKIE_SECURE: '1', TRUST_PROXY: '1', CORS_ORIGIN: 'https://finsentinel.example' },
    );
    // Over plain HTTP a Secure cookie is never issued: the login succeeds but no session is sent.
    const plain = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'analyst.kim' },
    });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['set-cookie']).toBeUndefined();
    // Behind the proxy (X-Forwarded-Proto: https, trusted) the cookie is issued with the Secure flag.
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'analyst.kim' },
      headers: { 'x-forwarded-proto': 'https' },
    });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/; Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/me',
      headers: { origin: 'https://finsentinel.example', 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://finsentinel.example');
    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/me',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();

    // Default (local) profile keeps the demo behaviour: cookie over HTTP without Secure, origin reflected.
    const { app: local } = await createTestApp();
    const r2 = await local.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'analyst.kim' },
    });
    expect(String(r2.headers['set-cookie'])).toMatch(/finsentinel.sid/);
    expect(String(r2.headers['set-cookie'])).not.toMatch(/; Secure/i);
    await local.close();
  });

  test('unknown user cannot sign in; 500s never leak stack traces', async () => {
    const { app } = await createTestApp();
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'nobody' } }))
        .statusCode,
    ).toBe(404);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 42 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toMatch(/at .*\.ts:\d+/);
    await app.close();
  });
});
