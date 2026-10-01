import { randomUUID } from 'node:crypto';
import type { DecisionType } from '../../domain/workflow.ts';
import type { Db } from '../connection.ts';
import { nowIso } from '../connection.ts';

// AD-09: this module is imported ONLY by services/decision.ts. No pipeline or agent code may import it.

export type DecisionRow = {
  id: string;
  case_id: string;
  type: DecisionType;
  rationale: string;
  decided_by: string;
  decided_at: string;
  risk_calculation_id: string | null;
};
export type ConditionRow = {
  id: string;
  decision_id: string;
  text: string;
  due_date: string | null;
  owner: string | null;
};

export const decisions = {
  insert(
    db: Db,
    d: {
      case_id: string;
      type: DecisionType;
      rationale: string;
      decided_by: string;
      risk_calculation_id: string | null;
      conditions: Array<{ text: string; due_date?: string | null; owner?: string | null }>;
    },
  ): DecisionRow & { conditions: ConditionRow[] } {
    const row: DecisionRow = {
      id: randomUUID(),
      case_id: d.case_id,
      type: d.type,
      rationale: d.rationale,
      decided_by: d.decided_by,
      decided_at: nowIso(),
      risk_calculation_id: d.risk_calculation_id,
    };
    db.prepare(
      'INSERT INTO decisions (id, case_id, type, rationale, decided_by, decided_at, risk_calculation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.case_id,
      row.type,
      row.rationale,
      row.decided_by,
      row.decided_at,
      row.risk_calculation_id,
    );
    const ins = db.prepare(
      'INSERT INTO decision_conditions (id, decision_id, text, due_date, owner) VALUES (?, ?, ?, ?, ?)',
    );
    const conditions: ConditionRow[] = d.conditions.map((c) => {
      const cr: ConditionRow = {
        id: randomUUID(),
        decision_id: row.id,
        text: c.text,
        due_date: c.due_date ?? null,
        owner: c.owner ?? null,
      };
      ins.run(cr.id, cr.decision_id, cr.text, cr.due_date, cr.owner);
      return cr;
    });
    return { ...row, conditions };
  },
  forCase(db: Db, caseId: string): (DecisionRow & { conditions: ConditionRow[] }) | undefined {
    const row = db.prepare('SELECT * FROM decisions WHERE case_id = ?').get(caseId) as
      | DecisionRow
      | undefined;
    if (!row) return undefined;
    const conditions = db
      .prepare('SELECT * FROM decision_conditions WHERE decision_id = ?')
      .all(row.id) as ConditionRow[];
    return { ...row, conditions };
  },
};
