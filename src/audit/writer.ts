import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.ts';
import { nowIso } from '../db/connection.ts';

// Append-only audit with SHA-256 hash chain — FR-AUD-01..06, Architecture §10.

export type AuditActorRole = 'product_owner' | 'analyst' | 'committee' | 'admin' | 'system';

export type AuditInput = {
  caseId?: string | null;
  actorUserId?: string | null;
  actorRole: AuditActorRole;
  action: string;
  entityType?: string;
  entityId?: string;
  previous?: unknown;
  next?: unknown;
  reason?: string | null;
  riskModelVersion?: string | null;
  policyVersion?: string | null;
  modelVersion?: string | null;
  promptVersion?: string | null;
  refersToEventId?: string | null;
};

export type AuditEvent = {
  id: string;
  seq: number;
  case_id: string | null;
  actor_user_id: string | null;
  actor_role: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  previous_json: string | null;
  new_json: string | null;
  reason: string | null;
  risk_model_version: string | null;
  policy_version: string | null;
  model_version: string | null;
  prompt_version: string | null;
  refers_to_event_id: string | null;
  prev_hash: string | null;
  hash: string;
  created_at: string;
};

/** Deterministic JSON: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function computeHash(prevHash: string | null, ev: Omit<AuditEvent, 'hash' | 'prev_hash'>): string {
  return createHash('sha256')
    .update(prevHash ?? '')
    .update(canonicalJson(ev))
    .digest('hex');
}

export function appendAuditEvent(db: Db, input: AuditInput): AuditEvent {
  const caseId = input.caseId ?? null;
  const last = (
    caseId
      ? db.prepare('SELECT hash FROM audit_events WHERE case_id = ? ORDER BY seq DESC LIMIT 1').get(caseId)
      : db.prepare('SELECT hash FROM audit_events WHERE case_id IS NULL ORDER BY seq DESC LIMIT 1').get()
  ) as { hash: string } | undefined;
  const seqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM audit_events').get() as {
    seq: number;
  };

  const base: Omit<AuditEvent, 'hash' | 'prev_hash'> = {
    id: randomUUID(),
    seq: seqRow.seq,
    case_id: caseId,
    actor_user_id: input.actorUserId ?? null,
    actor_role: input.actorRole,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    previous_json: input.previous === undefined ? null : canonicalJson(input.previous),
    new_json: input.next === undefined ? null : canonicalJson(input.next),
    reason: input.reason ?? null,
    risk_model_version: input.riskModelVersion ?? null,
    policy_version: input.policyVersion ?? null,
    model_version: input.modelVersion ?? null,
    prompt_version: input.promptVersion ?? null,
    refers_to_event_id: input.refersToEventId ?? null,
    created_at: nowIso(),
  };
  const prev_hash = last?.hash ?? null;
  const hash = computeHash(prev_hash, base);
  const ev: AuditEvent = { ...base, prev_hash, hash };

  db.prepare(
    `INSERT INTO audit_events (id, seq, case_id, actor_user_id, actor_role, action, entity_type, entity_id,
       previous_json, new_json, reason, risk_model_version, policy_version, model_version, prompt_version,
       refers_to_event_id, prev_hash, hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ev.id,
    ev.seq,
    ev.case_id,
    ev.actor_user_id,
    ev.actor_role,
    ev.action,
    ev.entity_type,
    ev.entity_id,
    ev.previous_json,
    ev.new_json,
    ev.reason,
    ev.risk_model_version,
    ev.policy_version,
    ev.model_version,
    ev.prompt_version,
    ev.refers_to_event_id,
    ev.prev_hash,
    ev.hash,
    ev.created_at,
  );
  return ev;
}

export function listAuditEvents(db: Db, caseId: string): AuditEvent[] {
  return db
    .prepare('SELECT * FROM audit_events WHERE case_id = ? ORDER BY seq ASC')
    .all(caseId) as AuditEvent[];
}

export type IntegrityReport = { ok: boolean; count: number; firstBrokenSeq: number | null };

export function verifyChain(db: Db, caseId: string): IntegrityReport {
  const events = listAuditEvents(db, caseId);
  let prev: string | null = null;
  for (const ev of events) {
    const { hash, prev_hash, ...rest } = ev;
    if (prev_hash !== prev) return { ok: false, count: events.length, firstBrokenSeq: ev.seq };
    const expected = computeHash(prev_hash, rest);
    if (expected !== hash) return { ok: false, count: events.length, firstBrokenSeq: ev.seq };
    prev = hash;
  }
  return { ok: true, count: events.length, firstBrokenSeq: null };
}
