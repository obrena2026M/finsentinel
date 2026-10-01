import { appendAuditEvent } from '../audit/writer.ts';
import { transaction } from '../db/connection.ts';
import { calculations, overrides, scores } from '../db/repos/assessment.ts';
import { cases, riskModels } from '../db/repos/core.ts';
import { calculateRisk, validateScore } from '../domain/risk-engine.ts';
import {
  CONTROL_RATINGS,
  type ControlRatingOrUnverified,
  DIMENSION_KEYS,
  type DimensionKey,
} from '../domain/risk-model-schema.ts';
import { validateRationale } from '../domain/workflow.ts';
import type { Actor, AppContext } from './context.ts';
import { NotFoundError, ValidationError } from './context.ts';

// Overrides, control ratings and recalculation — FR-OVR, FR-RSK-10, Architecture §8.3.

function modelForCase(ctx: AppContext, caseId: string) {
  const v = cases.versions(ctx.db, caseId);
  return (v && riskModels.byVersion(ctx.db, v.risk_model_version)) || riskModels.active(ctx.db);
}

export function recalculate(ctx: AppContext, caseId: string, trigger: string) {
  const model = modelForCase(ctx, caseId);
  const rows = scores.forCase(ctx.db, caseId);
  if (rows.length === 0) return null;
  const inputs = Object.fromEntries(
    model.dimensions.map((d) => {
      const r = rows.find((x) => x.dimension === d.key);
      return [
        d.key,
        {
          score: r?.current_score ?? r?.ai_recommended ?? 3,
          control: (r?.control_rating ?? 'unverified') as ControlRatingOrUnverified,
        },
      ];
    }),
  ) as Record<DimensionKey, { score: number; control: ControlRatingOrUnverified }>;
  const calc = calculateRisk(model, inputs);
  const before = calculations.current(ctx.db, caseId);
  const row = calculations.insertCurrent(ctx.db, caseId, trigger, inputs, calc);
  appendAuditEvent(ctx.db, {
    caseId,
    actorRole: 'system',
    action: 'risk_recalculated',
    entityType: 'risk_calculation',
    entityId: row.id,
    riskModelVersion: model.version,
    previous: before
      ? {
          inherent: before.inherent_score,
          inherent_band: before.inherent_band,
          residual: before.residual_score,
          residual_band: before.residual_band,
        }
      : null,
    next: {
      inherent: calc.inherentScore,
      inherent_band: calc.inherentBand,
      residual: calc.residualScore,
      residual_band: calc.residualBand,
      trigger,
    },
  });
  return row;
}

export function override(
  ctx: AppContext,
  actor: Actor,
  caseId: string,
  dimension: string,
  newScore: number,
  rationale: string,
) {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  if (!(DIMENSION_KEYS as readonly string[]).includes(dimension))
    throw new ValidationError('unknown dimension');
  const model = modelForCase(ctx, caseId);
  validateScore(model, newScore);
  const reason = validateRationale(rationale);
  const row = scores.forCase(ctx.db, caseId).find((s) => s.dimension === dimension);
  if (!row) throw new ValidationError('no score to override yet — run the pipeline first');
  const previous = row.current_score ?? row.ai_recommended ?? 3;
  if (previous === newScore) throw new ValidationError('new score equals current score');

  return transaction(ctx.db, () => {
    scores.setCurrent(ctx.db, caseId, dimension, newScore);
    const o = overrides.insert(ctx.db, {
      case_id: caseId,
      dimension,
      previous_score: previous,
      new_score: newScore,
      rationale: reason,
      user_id: actor.id,
      user_role: actor.role,
      risk_model_version: model.version,
    });
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'override',
      entityType: 'dimension_score',
      entityId: `${caseId}:${dimension}`,
      previous: { [dimension]: previous },
      next: { [dimension]: newScore },
      reason,
      riskModelVersion: model.version,
    });
    const calc = recalculate(ctx, caseId, 'override');
    return { override: o, calculation: calc };
  });
}

export function setControl(
  ctx: AppContext,
  actor: Actor,
  caseId: string,
  dimension: string,
  rating: string,
  rationale: string,
) {
  if (!(DIMENSION_KEYS as readonly string[]).includes(dimension))
    throw new ValidationError('unknown dimension');
  if (!([...CONTROL_RATINGS, 'unverified'] as readonly string[]).includes(rating))
    throw new ValidationError('unknown control rating');
  const reason = validateRationale(rationale);
  const row = scores.forCase(ctx.db, caseId).find((s) => s.dimension === dimension);
  if (!row) throw new ValidationError('no score row yet — run the pipeline first');
  return transaction(ctx.db, () => {
    scores.setControl(ctx.db, caseId, dimension, rating as ControlRatingOrUnverified, reason, actor.id);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'control_rating_set',
      entityType: 'dimension_score',
      entityId: `${caseId}:${dimension}`,
      previous: { control: row.control_rating },
      next: { control: rating },
      reason,
    });
    const calc = recalculate(ctx, caseId, 'control_change');
    return { calculation: calc };
  });
}
