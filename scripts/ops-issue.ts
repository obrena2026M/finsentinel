import { existsSync, readFileSync } from 'node:fs';

// STAGE06 OPS-04: alert channel = GitHub Issues. Opens or updates one issue per alert title while a
// check is failing, and closes it with a comment when the check recovers. Cross-platform (plain fetch),
// so it runs on Ubuntu runners and on the self-hosted Windows runner alike.
//   node scripts/ops-issue.ts --title="Nightly evaluation regression" --state=fail|ok [--body-file=compare.md] [--label=ops]
// Env: GITHUB_TOKEN (issues: write), GITHUB_REPOSITORY (owner/repo), GITHUB_SERVER_URL, GITHUB_RUN_ID (optional).

const arg = (n: string, d = '') =>
  process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const title = arg('title');
const state = arg('state');
const label = arg('label', 'ops');
const bodyFile = arg('body-file');
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!title || !['fail', 'ok'].includes(state) || !token || !repo) {
  console.error(
    'usage: ops-issue.ts --title=... --state=fail|ok [--body-file=...]; needs GITHUB_TOKEN and GITHUB_REPOSITORY',
  );
  process.exit(2);
}
const api = `https://api.github.com/repos/${repo}`;
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'finsentinel-ops',
  'content-type': 'application/json',
};
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;
const detail = bodyFile && existsSync(bodyFile) ? readFileSync(bodyFile, 'utf8').slice(0, 60_000) : '';
const stamp = new Date().toISOString();

async function gh(path: string, init: RequestInit = {}) {
  const r = await fetch(`${api}${path}`, { ...init, headers });
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  // Find an open issue with this exact title and label.
  const open = (await gh(`/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`)) as Array<{
    number: number;
    title: string;
  }>;
  const existing = open.find((i) => i.title === title);
  if (state === 'fail') {
    const body = `**${title}** detected at ${stamp}.${runUrl ? ` Workflow run: ${runUrl}` : ''}\n\n${detail}\n\n_Opened by scripts/ops-issue.ts (STAGE06 OPS-04). This issue closes automatically when the check recovers._`;
    if (existing) {
      await gh(`/issues/${existing.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: `Still failing at ${stamp}.${runUrl ? ` Run: ${runUrl}` : ''}\n\n${detail}`,
        }),
      });
      console.log(`updated issue #${existing.number}`);
    } else {
      // Make sure the label exists (ignore failure if it already does).
      await fetch(`${api}/labels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: label, color: 'B60205', description: 'Operational alert (STAGE06)' }),
      }).catch(() => undefined);
      const created = (await gh('/issues', {
        method: 'POST',
        body: JSON.stringify({ title, body, labels: [label] }),
      })) as { number: number; html_url: string };
      console.log(`opened issue #${created.number} ${created.html_url}`);
    }
  } else if (existing) {
    await gh(`/issues/${existing.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: `Recovered at ${stamp}.${runUrl ? ` Run: ${runUrl}` : ''}` }),
    });
    await gh(`/issues/${existing.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });
    console.log(`closed issue #${existing.number}`);
  } else {
    console.log('ok, no open issue');
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
