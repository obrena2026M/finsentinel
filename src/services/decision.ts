import { appendAuditEvent } from '../audit/writer.ts';
import { transaction } from '../db/connection.ts';
import { calculations } from '../db/repos/assessment.ts';
import { cases } from '../db/repos/core.ts';
import { decisions } from '../db/repos/decisions.ts';
import {
  DECISION_TYPES,
  type DecisionType,
  eventForDecision,
  transition,
  validateRationale,
} from '../domain/workflow.ts';
import type { Actor, AppContext } from './context.ts';
import { NotFoundError, ValidationError } from './context.ts';

// The ONLY module that imports the decisions repository (AD-09). The route guarding this service
// requires the committee role; the DB trigger enforces it again.

export function recordDecision(
  ctx: AppContext,
  actor: Actor,
  caseId: string,
  input: {
    type: string;
    rationale: string;
    conditions?: Array<{ text: string; due_date?: string | null; owner?: string | null }>;
  },
) {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  if (!(DECISION_TYPES as readonly string[]).includes(input.type))
    throw new ValidationError('invalid decision type');
  const type = input.type as DecisionType;
  const reason = validateRationale(input.rationale);
  const conditions = (input.conditions ?? [])
    .filter((x) => x.text?.trim())
    .map((x) => ({ ...x, text: x.text.trim() }));
  if (type === 'APPROVE_WITH_CONDITIONS' && conditions.length === 0)
    throw new ValidationError('APPROVE_WITH_CONDITIONS requires at least one condition');
  const next = transition(c.state, eventForDecision(type));
  const calc = calculations.current(ctx.db, caseId);

  return transaction(ctx.db, () => {
    if (type === 'DEFER') {
      cases.setState(ctx.db, caseId, next);
      appendAuditEvent(ctx.db, {
        caseId,
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'deferred',
        previous: { state: c.state },
        next: { state: next },
        reason,
      });
      return { type, state: next, conditions: [] };
    }
    const d = decisions.insert(ctx.db, {
      case_id: caseId,
      type,
      rationale: reason,
      decided_by: actor.id,
      risk_calculation_id: calc?.id ?? null,
      conditions,
    });
    cases.setState(ctx.db, caseId, next);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'decision',
      entityType: 'decision',
      entityId: d.id,
      previous: { state: c.state },
      next: {
        state: next,
        type,
        conditions: conditions.map((x) => x.text),
        residual_band: calc?.residual_band ?? null,
      },
      reason,
      riskModelVersion: calc?.risk_model_version ?? null,
    });
    return { ...d, state: next };
  });
}

export function closeCase(ctx: AppContext, actor: Actor, caseId: string) {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  const next = transition(c.state, 'close');
  return transaction(ctx.db, () => {
    cases.setState(ctx.db, caseId, next);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'closed',
      previous: { state: c.state },
      next: { state: next },
    });
    return { state: next };
  });
}
