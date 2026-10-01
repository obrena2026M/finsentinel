import { containsNormalized } from '../agents/parser.ts';
import { FACT_FIELDS } from '../agents/schemas/index.ts';
import { appendAuditEvent } from '../audit/writer.ts';
import { transaction } from '../db/connection.ts';
import { assessments, contradictions, evidence, facts, infoRequests } from '../db/repos/assessment.ts';
import { cases } from '../db/repos/core.ts';
import { transition, validateRationale } from '../domain/workflow.ts';
import type { Actor, AppContext } from './context.ts';
import { NotFoundError, ValidationError } from './context.ts';
import { recalculate } from './scoring.ts';

// Analyst actions on facts, contradictions, information requests, assessment and claims. All audited.

export function confirmFact(ctx: AppContext, actor: Actor, caseId: string, factId: string) {
  const f = facts.byId(ctx.db, factId);
  if (!f || f.case_id !== caseId) throw new NotFoundError('fact');
  transaction(ctx.db, () => {
    facts.confirm(ctx.db, factId, actor.id);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'fact_confirmed',
      entityType: 'fact',
      entityId: factId,
      previous: { status: f.status },
      next: { status: 'confirmed', field: f.field },
    });
  });
  return facts.byId(ctx.db, factId);
}

export function enterFact(
  ctx: AppContext,
  actor: Actor,
  caseId: string,
  field: string,
  value: unknown,
  rationale: string,
) {
  if (!(FACT_FIELDS as readonly string[]).includes(field)) throw new ValidationError('unknown fact field');
  if (value === null || value === undefined || value === '') throw new ValidationError('value is required');
  const reason = validateRationale(rationale);
  return transaction(ctx.db, () => {
    const before = facts.forCase(ctx.db, caseId).find((f) => f.field === field);
    const row = facts.upsertAnalystValue(ctx.db, caseId, field, value, actor.id);
    // Close any open information request for this field.
    for (const r of infoRequests
      .forCase(ctx.db, caseId)
      .filter((r) => r.field === field && r.status === 'open'))
      infoRequests.answer(ctx.db, r.id, `Entered by analyst: ${JSON.stringify(value)}`, actor.id);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'fact_entered',
      entityType: 'fact',
      entityId: row.id,
      previous: before ? { value: before.value_json, status: before.status } : null,
      next: { field, value },
      reason,
    });
    return row;
  });
}

export function resolveContradiction(
  ctx: AppContext,
  actor: Actor,
  caseId: string,
  id: string,
  value: unknown,
  rationale: string,
) {
  const c = contradictions.byId(ctx.db, id);
  if (!c || c.case_id !== caseId) throw new NotFoundError('contradiction');
  if (c.status === 'resolved') throw new ValidationError('already resolved');
  const reason = validateRationale(rationale);
  transaction(ctx.db, () => {
    contradictions.resolve(ctx.db, id, value, reason, actor.id);
    const f = facts.forCase(ctx.db, caseId).find((x) => x.field === c.field);
    if (f) facts.setValue(ctx.db, f.id, value, 'resolved', actor.id);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'contradiction_resolved',
      entityType: 'contradiction',
      entityId: id,
      previous: JSON.parse(c.candidates_json),
      next: { field: c.field, value },
      reason,
    });
  });
  recalculate(ctx, caseId, 'contradiction_resolved');
  return contradictions.byId(ctx.db, id);
}

export function answerInfoRequest(ctx: AppContext, actor: Actor, caseId: string, id: string, answer: string) {
  const r = infoRequests.byId(ctx.db, id);
  if (!r || r.case_id !== caseId) throw new NotFoundError('information request');
  if (answer.trim().length < 2) throw new ValidationError('answer is required');
  transaction(ctx.db, () => {
    infoRequests.answer(ctx.db, id, answer.trim(), actor.id);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'info_answered',
      entityType: 'information_request',
      entityId: id,
      next: { field: r.field, answer: answer.trim() },
    });
    const c = cases.byId(ctx.db, caseId)!;
    if (c.state === 'INFO_REQUESTED' && infoRequests.openCount(ctx.db, caseId) === 0)
      cases.setState(ctx.db, caseId, transition(c.state, 'info_provided'));
  });
  return infoRequests.byId(ctx.db, id);
}

export function acceptGap(ctx: AppContext, actor: Actor, caseId: string, id: string, rationale: string) {
  const r = infoRequests.byId(ctx.db, id);
  if (!r || r.case_id !== caseId) throw new NotFoundError('information request');
  const reason = validateRationale(rationale);
  transaction(ctx.db, () => {
    infoRequests.acceptGap(ctx.db, id, reason, actor.id);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'gap_accepted',
      entityType: 'information_request',
      entityId: id,
      next: { field: r.field },
      reason,
    });
  });
  return infoRequests.byId(ctx.db, id);
}

export function requestInfo(ctx: AppContext, actor: Actor, caseId: string) {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  if (infoRequests.openCount(ctx.db, caseId) === 0) throw new ValidationError('no open information requests');
  const next = transition(c.state, 'request_info');
  cases.setState(ctx.db, caseId, next);
  appendAuditEvent(ctx.db, {
    caseId,
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'info_requested',
    previous: { state: c.state },
    next: { state: next },
  });
  return { state: next };
}

export function editSummary(ctx: AppContext, actor: Actor, caseId: string, summary: string) {
  const a = assessments.current(ctx.db, caseId);
  if (!a) throw new NotFoundError('assessment');
  if (summary.trim().length < 20) throw new ValidationError('summary too short');
  transaction(ctx.db, () => {
    assessments.updateSummary(ctx.db, a.id, summary.trim());
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'assessment_edited',
      entityType: 'assessment',
      entityId: a.id,
      previous: { summary: a.summary },
      next: { summary: summary.trim() },
    });
  });
  return assessments.current(ctx.db, caseId);
}

export function removeClaim(
  ctx: AppContext,
  actor: Actor,
  caseId: string,
  claimId: string,
  rationale: string,
) {
  const a = assessments.current(ctx.db, caseId);
  const cl = assessments.claimById(ctx.db, claimId);
  if (!a || !cl || cl.assessment_id !== a.id) throw new NotFoundError('claim');
  const reason = validateRationale(rationale);
  transaction(ctx.db, () => {
    assessments.removeClaim(ctx.db, claimId);
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'claim_removed',
      entityType: 'claim',
      entityId: claimId,
      previous: { text: cl.text, verdict: cl.verdict },
      reason,
    });
  });
  return assessments.claimById(ctx.db, claimId);
}

export function attachEvidence(
  ctx: AppContext,
  actor: Actor,
  caseId: string,
  claimId: string,
  evidenceRefId: string,
  quote: string,
) {
  const a = assessments.current(ctx.db, caseId);
  const cl = assessments.claimById(ctx.db, claimId);
  const ev = evidence.byId(ctx.db, evidenceRefId);
  if (!a || !cl || cl.assessment_id !== a.id) throw new NotFoundError('claim');
  if (!ev || ev.case_id !== caseId) throw new NotFoundError('evidence');
  const verified = containsNormalized(ev.body, quote);
  if (!verified) throw new ValidationError('quote was not found in the selected evidence section');
  transaction(ctx.db, () => {
    assessments.attachEvidence(ctx.db, claimId, evidenceRefId, quote, true);
    assessments.setClaimVerdict(ctx.db, claimId, 'SUPPORTED', 'analyst_attached_verified_quote');
    appendAuditEvent(ctx.db, {
      caseId,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'claim_evidence_added',
      entityType: 'claim',
      entityId: claimId,
      previous: { verdict: cl.verdict },
      next: { verdict: 'SUPPORTED', evidence: `${ev.policy_id} ${ev.section_ref}`, quote },
    });
  });
  return assessments.claimById(ctx.db, claimId);
}
