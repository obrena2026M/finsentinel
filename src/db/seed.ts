import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendAuditEvent } from '../audit/writer.ts';
import { parseRiskModel } from '../domain/risk-model-schema.ts';
import { activePromptVersions, loadPrompt } from '../llm/prompts.ts';
import type { Db } from './connection.ts';
import { nowIso, transaction } from './connection.ts';
import { riskModels, users } from './repos/core.ts';

// Reference data: synthetic users, risk model v1.0, policy corpus, prompt versions. Idempotent.

const CONFIG_DIR = fileURLToPath(new URL('../../config/', import.meta.url));
const POLICIES_DIR = fileURLToPath(new URL('../../policies/', import.meta.url));

export const SEED_USERS = [
  {
    username: 'owner.pat',
    display_name: 'Pat Owner',
    role: 'product_owner',
    role_description:
      'Submits changes, uploads documents, answers information requests. Cannot approve or reject.',
  },
  {
    username: 'analyst.kim',
    display_name: 'Kim Analyst',
    role: 'analyst',
    role_description:
      'Reviews and challenges AI output, overrides with rationale, finalizes the assessment. Cannot decide.',
  },
  {
    username: 'committee.lee',
    display_name: 'Lee Committee',
    role: 'committee',
    role_description:
      'Reviews the packet and overrides; approves, approves with conditions, defers or rejects. Cannot edit evidence.',
  },
  {
    username: 'admin.raj',
    display_name: 'Raj Admin',
    role: 'admin',
    role_description: 'Publishes risk model versions, views Quality Center and Ops. Cannot assess or decide.',
  },
] as const;

export function seedReference(db: Db): {
  users: number;
  policies: number;
  chunks: number;
  riskModel: string;
} {
  return transaction(db, () => {
    let userCount = 0;
    for (const u of SEED_USERS) {
      if (!users.byUsername(db, u.username)) {
        users.insert(db, { ...u });
        userCount++;
      }
    }

    const model = parseRiskModel(JSON.parse(readFileSync(join(CONFIG_DIR, 'risk-model.v1.0.json'), 'utf8')));
    if (!riskModels.byVersion(db, model.version)) {
      riskModels.publish(db, model, null, 'Initial hackathon risk model');
      appendAuditEvent(db, {
        actorRole: 'system',
        action: 'risk_model_published',
        riskModelVersion: model.version,
        next: { version: model.version },
      });
    }

    for (const [agent, version] of Object.entries(activePromptVersions())) {
      const p = loadPrompt(agent as never, version);
      db.prepare(
        'INSERT OR IGNORE INTO prompt_versions (agent, version, sha256, path, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(agent, version, p.sha256, p.path, nowIso());
    }

    const { policies, chunks } = loadPolicies(db);
    return { users: userCount, policies, chunks, riskModel: model.version };
  });
}

/** policies/<POLICY_ID>.md — first line "# Title (vN)"; sections start with "## §x.y Title". */
export function loadPolicies(db: Db): { policies: number; chunks: number } {
  let policies = 0;
  let chunks = 0;
  for (const file of readdirSync(POLICIES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    const text = readFileSync(join(POLICIES_DIR, file), 'utf8');
    const sha = createHash('sha256').update(text).digest('hex');
    const policyId = file.replace(/\.md$/, '');
    const firstLine = text.split('\n')[0] ?? '';
    const m = /^#\s+(.*?)\s*\((v[\w.]+)\)\s*$/.exec(firstLine);
    const title = m?.[1] ?? policyId;
    const version = m?.[2] ?? 'v1';
    const existing = db
      .prepare('SELECT sha256 FROM policy_versions WHERE policy_id = ? AND version = ?')
      .get(policyId, version) as { sha256: string } | undefined;
    if (existing?.sha256 === sha) continue;
    if (existing) {
      db.prepare('DELETE FROM policy_chunks WHERE policy_id = ? AND policy_version = ?').run(
        policyId,
        version,
      );
      db.prepare(
        'UPDATE policy_versions SET sha256 = ?, title = ?, published_at = ? WHERE policy_id = ? AND version = ?',
      ).run(sha, title, nowIso(), policyId, version);
    } else {
      db.prepare('UPDATE policy_versions SET is_active = 0 WHERE policy_id = ?').run(policyId);
      db.prepare(
        'INSERT INTO policy_versions (policy_id, version, title, source_file, sha256, published_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
      ).run(policyId, version, title, file, sha, nowIso());
    }
    const ins = db.prepare(
      'INSERT INTO policy_chunks (id, policy_id, policy_version, section_ref, title, body, ordinal) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const sections = text.split(/\n(?=## )/).slice(1);
    sections.forEach((sec, i) => {
      const [head, ...body] = sec.split('\n');
      const hm = /^##\s+(§[\d.]+)\s*(.*)$/.exec(head ?? '');
      ins.run(
        randomUUID(),
        policyId,
        version,
        hm?.[1] ?? `§${i + 1}`,
        hm?.[2]?.trim() || null,
        body.join('\n').trim(),
        i,
      );
      chunks++;
    });
    policies++;
  }
  return { policies, chunks };
}
