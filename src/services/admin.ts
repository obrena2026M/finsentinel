import { appendAuditEvent } from '../audit/writer.ts';
import { transaction } from '../db/connection.ts';
import { riskModels } from '../db/repos/core.ts';
import { parseRiskModel } from '../domain/risk-model-schema.ts';
import type { Actor, AppContext } from './context.ts';
import { ValidationError } from './context.ts';

// Risk model publishing — FR-RSK-04/05, FR-RBAC-06. Existing cases keep their frozen version (FR-VER-03).

export function publishRiskModel(ctx: AppContext, actor: Actor, input: unknown, notes: string) {
  const model = parseRiskModel(input); // throws RiskModelValidationError → 400
  if (riskModels.byVersion(ctx.db, model.version))
    throw new ValidationError(`version ${model.version} already exists`);
  if (notes.trim().length < 5) throw new ValidationError('publish notes are required');
  return transaction(ctx.db, () => {
    const before = riskModels.active(ctx.db);
    riskModels.publish(ctx.db, model, actor.id, notes.trim());
    appendAuditEvent(ctx.db, {
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'risk_model_published',
      entityType: 'risk_model',
      entityId: model.version,
      previous: { version: before.version },
      next: { version: model.version },
      reason: notes.trim(),
      riskModelVersion: model.version,
    });
    return { version: model.version };
  });
}
