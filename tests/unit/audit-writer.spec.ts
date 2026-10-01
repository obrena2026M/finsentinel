import { expect, test } from '@playwright/test';
import { appendAuditEvent, listAuditEvents, verifyChain } from '../../src/audit/writer.ts';
import { openDatabase, runMigrations } from '../../src/db/connection.ts';

function freshDb() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  db.prepare(
    `INSERT INTO users (id, username, display_name, role, role_description, created_at) VALUES ('u1','analyst.kim','Kim','analyst','x','2026-01-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO risk_model_versions (version, model_json, is_active, published_at) VALUES ('1.0','{}',1,'2026-01-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO cases (id, ref, title, change_type, description, state, submitted_by, created_at, updated_at)
     VALUES ('c1','RA-1','t','product','d','SUBMITTED','u1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
  ).run();
  return db;
}

test.describe('audit writer (FR-AUD)', () => {
  test('test_audit_event_created_for_override and chain verifies', () => {
    const db = freshDb();
    appendAuditEvent(db, { caseId: 'c1', actorUserId: 'u1', actorRole: 'analyst', action: 'case_created' });
    appendAuditEvent(db, {
      caseId: 'c1',
      actorUserId: 'u1',
      actorRole: 'analyst',
      action: 'override',
      previous: { geography: 4 },
      next: { geography: 3 },
      reason: 'Comparable existing products have established monitoring coverage.',
      riskModelVersion: '1.0',
    });
    const events = listAuditEvents(db, 'c1');
    expect(events).toHaveLength(2);
    expect(events[1]!.prev_hash).toBe(events[0]!.hash);
    expect(verifyChain(db, 'c1')).toEqual({ ok: true, count: 2, firstBrokenSeq: null });
  });

  test('test_historical_audit_event_cannot_be_modified (TEST-029): UPDATE and DELETE are rejected', () => {
    const db = freshDb();
    const ev = appendAuditEvent(db, { caseId: 'c1', actorRole: 'system', action: 'pipeline_started' });
    expect(() => db.prepare(`UPDATE audit_events SET reason = 'tampered' WHERE id = ?`).run(ev.id)).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM audit_events WHERE id = ?').run(ev.id)).toThrow(/append-only/);
    expect(listAuditEvents(db, 'c1')).toHaveLength(1);
  });

  test('tampering is detected by verifyChain even if triggers were bypassed', () => {
    const db = freshDb();
    appendAuditEvent(db, { caseId: 'c1', actorRole: 'system', action: 'a' });
    appendAuditEvent(db, { caseId: 'c1', actorRole: 'system', action: 'b' });
    db.exec('DROP TRIGGER audit_no_update');
    db.prepare(`UPDATE audit_events SET action = 'z' WHERE action = 'a'`).run();
    const report = verifyChain(db, 'c1');
    expect(report.ok).toBe(false);
    expect(report.firstBrokenSeq).toBe(1);
  });

  test('decisions trigger: only committee may decide (AD-09)', () => {
    const db = freshDb();
    const insert = db.prepare(
      `INSERT INTO decisions (id, case_id, type, rationale, decided_by, decided_at) VALUES ('d1','c1','APPROVE','Sufficient controls demonstrated for launch.','u1','2026-01-01T00:00:00Z')`,
    );
    expect(() => insert.run()).toThrow(/only committee may decide/);
  });

  test('override rationale is enforced at the database (FR-OVR-02)', () => {
    const db = freshDb();
    const insert = db.prepare(
      `INSERT INTO overrides (id, case_id, dimension, previous_score, new_score, rationale, user_id, user_role, risk_model_version, created_at)
       VALUES ('o1','c1','geography',4,3,'short','u1','analyst','1.0','2026-01-01T00:00:00Z')`,
    );
    expect(() => insert.run()).toThrow(/CHECK/);
  });
});
