import { loadEnv } from '../src/config/env.ts';

// DEP-09 post-deployment smoke test (NFR-OPS-02, AC-15).
// node scripts/smoke.ts [--url=http://127.0.0.1:3000] [--wait=60000] [--expect-web=1]
// Exit 0 when every check passes; 1 otherwise. Prints one line per check.
//
// Exit is signalled through process.exitCode, never process.exit(): on Windows, exiting while
// undici keep-alive sockets are still closing trips a libuv assertion (UV_HANDLE_CLOSING) and the
// process dies with 0xC0000409 even though every check passed. Requests also send Connection: close.

function arg(name: string, fallback: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
}

function defaultUrl(): string {
  try {
    const env = loadEnv();
    const host = env.HOST === '0.0.0.0' ? '127.0.0.1' : env.HOST;
    return `http://${host}:${env.PORT}`;
  } catch {
    return 'http://127.0.0.1:3000';
  }
}

const base = arg('url', process.env.SMOKE_URL ?? defaultUrl()).replace(/\/$/, '');
const waitMs = Number(arg('wait', '60000'));
const expectWeb = arg('expect-web', '1') !== '0';
/** When set, /health/live must report this BUILD_SHA: proves the new release answers, not a leftover process. */
const expectBuild = arg('expect-build', '');

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
};

async function get(path: string) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    return await fetch(`${base}${path}`, {
      signal: ctl.signal,
      redirect: 'manual',
      headers: { connection: 'close' },
    });
  } finally {
    clearTimeout(t);
  }
}

async function waitForLive(): Promise<boolean> {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < waitMs) {
    try {
      const r = await get('/health/live');
      if (r.ok) {
        record('startup: /health/live reachable', true, `after ${((Date.now() - start) / 1000).toFixed(1)}s`);
        return true;
      }
      lastErr = `HTTP ${r.status}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  record('startup: /health/live reachable', false, `not live after ${waitMs} ms (${lastErr})`);
  return false;
}

function finish(): void {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

async function main() {
  console.log(`FinSentinel smoke test against ${base}`);
  if (!(await waitForLive())) return finish();

  if (expectBuild) {
    const live = (await (await get('/health/live')).json().catch(() => ({}))) as { build?: string | null };
    record(
      'identity: /health/live reports expected build',
      live.build === expectBuild,
      `expected ${expectBuild}, got ${live.build ?? 'null'}`,
    );
  }

  const ready = await get('/health/ready');
  const body = (await ready.json().catch(() => ({}))) as { ok?: boolean; checks?: Record<string, unknown> };
  record(
    'readiness: /health/ready (db, model, index, llm)',
    ready.status === 200 && body.ok === true,
    JSON.stringify(body.checks ?? {}),
  );

  const root = await get('/');
  const ct = root.headers.get('content-type') ?? '';
  if (expectWeb)
    record(
      'web: / serves the built SPA',
      root.status === 200 && ct.includes('text/html'),
      `${root.status} ${ct}`,
    );
  else record('web: / responds', root.status === 200, `${root.status} ${ct}`);

  const spa = await get('/cases/RA-0000/does-not-exist');
  record('web: SPA fallback for deep links', !expectWeb || spa.status === 200, `${spa.status}`);

  const anon = await get('/api/cases');
  record('auth: /api/cases requires sign-in', anon.status === 401, `${anon.status}`);

  const users = await get('/api/auth/users');
  const list = (await users.json().catch(() => [])) as unknown[];
  record(
    'auth: user picker lists synthetic users',
    users.status === 200 && Array.isArray(list) && list.length >= 4,
    `${Array.isArray(list) ? list.length : 0} users`,
  );

  const missing = await get('/api/definitely-not-a-route');
  const text = await missing.text();
  record(
    'errors: 404 is JSON without a stack trace',
    missing.status === 404 && !/at .*\.ts:\d+/.test(text),
    `${missing.status}`,
  );

  const metrics = await get('/api/metrics');
  record('rbac: /api/metrics denied anonymously', metrics.status === 401, `${metrics.status}`);

  finish();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
