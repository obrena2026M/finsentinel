import { appendAuditEvent } from '../audit/writer.ts';
import { transaction } from '../db/connection.ts';
import { cases } from '../db/repos/core.ts';
import { transition, WorkflowError } from '../domain/workflow.ts';
import { blockersFor } from './case.ts';
import type { Actor, AppContext } from './context.ts';
import { NotFoundError } from './context.ts';

// Finalize guard — FR-WF-09, Architecture §9.1.

export function finalize(ctx: AppContext, actor: Actor, caseId: string) {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  const blockers = blockersFor(ctx, caseId);
  if (blockers.length > 0)
    throw new WorkflowError(c.state, 'finalize', `cannot finalize: ${blockers.join('; ')}`);
  const next = transition(c.state, 'finalize');
  return transaction(ctx.db, () => {
    cases.setState(ctx.db, caseId, next);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'finalized',
      previous: { state: c.state },
      next: { state: next },
    });
    return { state: next };
  });
}
