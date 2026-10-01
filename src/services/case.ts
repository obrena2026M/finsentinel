import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { appendAuditEvent, listAuditEvents, verifyChain } from '../audit/writer.ts';
import { costUsd } from '../config/llm-config.ts';
import { transaction } from '../db/connection.ts';
import {
  assessments,
  calculations,
  contradictions,
  evidence,
  facts,
  infoRequests,
  overrides,
  scores,
} from '../db/repos/assessment.ts';
import { type CaseRow, cases, documents, pipeline, users } from '../db/repos/core.ts';
import { decisions } from '../db/repos/decisions.ts';
import { INJECTION_BANNER_TEXT } from '../domain/injection-detector.ts';
import { finalizeBlockers } from '../domain/workflow.ts';
import { caseTokenTotals } from '../llm/usage.ts';
import type { Actor, AppContext } from './context.ts';
import { NotFoundError, ValidationError } from './context.ts';

// Case intake, documents, and the aggregated read model — FR-INT, UX §4.4–4.10.

export const CHANGE_TYPES = [
  'product',
  'feature',
  'process',
  'vendor',
  'geography',
  'customer_segment',
  'channel',
  'transaction',
] as const;
export const DOC_KINDS = ['product_proposal', 'vendor_questionnaire', 'process_doc', 'other'] as const;

export function createCase(
  ctx: AppContext,
  actor: Actor,
  input: { title: string; change_type: string; description: string; ref?: string },
): CaseRow {
  if (input.title.trim().length < 3) throw new ValidationError('title is required');
  if (input.description.trim().length < 50)
    throw new ValidationError('description must be at least 50 characters');
  if (!(CHANGE_TYPES as readonly string[]).includes(input.change_type))
    throw new ValidationError('invalid change_type');
  return transaction(ctx.db, () => {
    const c = cases.insert(ctx.db, {
      title: input.title,
      change_type: input.change_type,
      description: input.description,
      submitted_by: actor.id,
      ref: input.ref,
    });
    appendAuditEvent(ctx.db, {
      caseId: c.id,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'case_created',
      entityType: 'case',
      entityId: c.id,
      next: { ref: c.ref, title: c.title, change_type: c.change_type },
    });
    return c;
  });
}

const ALLOWED: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function addDocument(
  ctx: AppContext,
  actor: Actor,
  caseId: string,
  file: { filename: string; buffer: Buffer; kind: string },
): Promise<{ id: string; original_name: string; mime: string; size_bytes: number }> {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  if (!(DOC_KINDS as readonly string[]).includes(file.kind))
    throw new ValidationError('invalid document kind');
  if (file.buffer.length === 0) throw new ValidationError('empty file');
  if (file.buffer.length > MAX_UPLOAD_BYTES) throw new ValidationError('file exceeds 20 MB');
  const ext = extname(file.filename).toLowerCase();
  const expected = ALLOWED[ext];
  if (!expected)
    throw new ValidationError(
      `Unsupported type (${ext || 'no extension'}). Allowed: PDF, DOCX, XLSX, MD, TXT`,
    );

  // Magic-byte check for binary formats (NFR-SEC-05).
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(file.buffer);
  if (ext === '.pdf' && detected?.mime !== 'application/pdf')
    throw new ValidationError('file content is not a valid PDF');
  if (
    (ext === '.docx' || ext === '.xlsx') &&
    detected?.mime !== 'application/zip' &&
    detected?.mime !== expected
  ) {
    throw new ValidationError(`file content is not a valid ${ext.slice(1).toUpperCase()}`);
  }

  const dir = join(ctx.env.UPLOAD_DIR, c.id);
  mkdirSync(dir, { recursive: true });
  const storagePath = join(dir, `${randomUUID()}${ext}`);
  writeFileSync(storagePath, file.buffer);
  const sha = createHash('sha256').update(file.buffer).digest('hex');

  return transaction(ctx.db, () => {
    const d = documents.insert(ctx.db, {
      case_id: c.id,
      kind: file.kind,
      original_name: file.filename.slice(0, 200),
      mime: expected,
      size_bytes: file.buffer.length,
      sha256: sha,
      storage_path: storagePath,
      uploaded_by: actor.id,
    });
    appendAuditEvent(ctx.db, {
      caseId: c.id,
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'document_uploaded',
      entityType: 'document',
      entityId: d.id,
      next: { name: d.original_name, kind: d.kind, sha256: sha },
    });
    cases.touch(ctx.db, c.id);
    return { id: d.id, original_name: d.original_name, mime: d.mime, size_bytes: d.size_bytes };
  });
}

export function listCases(ctx: AppContext) {
  return cases.list(ctx.db).map((c) => {
    const calc = calculations.current(ctx.db, c.id);
    const run = pipeline.latestRun(ctx.db, c.id);
    const steps = run ? pipeline.steps(ctx.db, run.id) : [];
    const done = steps.filter((s) => s.status === 'succeeded').length;
    return {
      id: c.id,
      ref: c.ref,
      title: c.title,
      change_type: c.change_type,
      state: c.state,
      residual_band: calc?.residual_band ?? null,
      residual_score: calc?.residual_score ?? null,
      pipeline: run ? { status: run.status, done, total: steps.length } : null,
      open_info_requests: infoRequests.openCount(ctx.db, c.id),
      updated_at: c.updated_at,
    };
  });
}

export function blockersFor(ctx: AppContext, caseId: string) {
  const factRows = facts.forCase(ctx.db, caseId);
  return finalizeBlockers({
    unsupportedClaims: assessments.unsupportedCount(ctx.db, caseId),
    openContradictions: contradictions.openCount(ctx.db, caseId),
    openRequiredInfoRequests: infoRequests.openCount(ctx.db, caseId),
    unconfirmedLowConfidenceFacts: factRows.filter((f) => f.status === 'low_confidence').length,
    hasCurrentCalculation: !!calculations.current(ctx.db, caseId),
  });
}

export function getCaseView(ctx: AppContext, caseId: string) {
  const c = cases.byId(ctx.db, caseId) ?? cases.byRef(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  const id = c.id;
  const run = pipeline.latestRun(ctx.db, id);
  const steps = run ? pipeline.steps(ctx.db, run.id) : [];
  const docs = documents.forCase(ctx.db, id);
  const flags = documents.flagsForCase(ctx.db, id);
  const a = assessments.current(ctx.db, id);
  const claims = a ? assessments.claims(ctx.db, a.id) : [];
  const calc = calculations.current(ctx.db, id);
  const tokens = caseTokenTotals(ctx.db, id);
  const cost = Object.entries(tokens.byModel).reduce(
    (s, [m, u]) => s + costUsd(ctx.llm, m.replace(/^mock:/, ''), u),
    0,
  );
  const submitter = users.byId(ctx.db, c.submitted_by);
  const versions = cases.versions(ctx.db, id);
  const decision = decisions.forCase(ctx.db, id);

  return {
    case: { ...c, submitted_by_name: submitter?.display_name ?? c.submitted_by },
    versions,
    pipeline: run
      ? {
          id: run.id,
          status: run.status,
          gateway: run.gateway,
          started_at: run.started_at,
          finished_at: run.finished_at,
          steps: steps.map((s) => ({
            step: s.step,
            status: s.status,
            summary: s.summary_json ? JSON.parse(s.summary_json) : null,
            error_code: s.error_code,
            error_message: s.error_message,
            latency_ms: s.latency_ms,
          })),
        }
      : null,
    documents: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      original_name: d.original_name,
      mime: d.mime,
      size_bytes: d.size_bytes,
      parse_status: d.parse_status,
      parse_error: d.parse_error,
      uploaded_at: d.uploaded_at,
    })),
    flags: flags.map((f) => ({
      id: f.id,
      document_id: f.document_id,
      document_name: f.original_name,
      chunk_ix: f.chunk_ix,
      flag_type: f.flag_type,
      matched_text: f.matched_text,
    })),
    injection_banner: flags.length > 0 ? INJECTION_BANNER_TEXT : null,
    facts: facts
      .forCase(ctx.db, id)
      .map((f) => ({ ...f, value: f.value_json ? JSON.parse(f.value_json) : null })),
    contradictions: contradictions.forCase(ctx.db, id).map((x) => ({
      ...x,
      candidates: JSON.parse(x.candidates_json),
      resolved_value: x.resolved_value_json ? JSON.parse(x.resolved_value_json) : null,
    })),
    information_requests: infoRequests.forCase(ctx.db, id),
    evidence: evidence.forCase(ctx.db, id),
    assessment: a
      ? {
          id: a.id,
          summary: a.summary,
          narratives: JSON.parse(a.dimension_narratives_json),
          model: a.model,
          prompt_version: a.prompt_version,
          created_at: a.created_at,
          claims,
        }
      : null,
    scores: scores.forCase(ctx.db, id),
    overrides: overrides.forCase(ctx.db, id),
    calculation: calc
      ? { ...calc, by_dimension: JSON.parse(calc.by_dimension_json), inputs: JSON.parse(calc.inputs_json) }
      : null,
    calculation_history: calculations.history(ctx.db, id).map((h) => ({
      id: h.id,
      trigger: h.trigger,
      inherent_score: h.inherent_score,
      inherent_band: h.inherent_band,
      residual_score: h.residual_score,
      residual_band: h.residual_band,
      computed_at: h.computed_at,
      risk_model_version: h.risk_model_version,
    })),
    decision,
    blockers: blockersFor(ctx, id),
    tokens: { ...tokens, cost_usd: Math.round(cost * 10_000) / 10_000 },
  };
}

export function getAudit(ctx: AppContext, caseId: string) {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  const userMap = new Map(users.list(ctx.db).map((u) => [u.id, u]));
  return listAuditEvents(ctx.db, c.id).map((e) => ({
    ...e,
    actor_name: e.actor_user_id ? (userMap.get(e.actor_user_id)?.username ?? e.actor_user_id) : 'system',
    previous: e.previous_json ? JSON.parse(e.previous_json) : null,
    next: e.new_json ? JSON.parse(e.new_json) : null,
  }));
}

export function verifyAudit(ctx: AppContext, caseId: string) {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  return verifyChain(ctx.db, c.id);
}

export function getPacket(ctx: AppContext, caseId: string) {
  const v = getCaseView(ctx, caseId);
  return {
    case: v.case,
    versions: v.versions,
    residual: v.calculation
      ? {
          score: v.calculation.residual_score,
          band: v.calculation.residual_band,
          inherent_score: v.calculation.inherent_score,
          inherent_band: v.calculation.inherent_band,
        }
      : null,
    dimensions: v.calculation?.by_dimension ?? [],
    overrides: v.overrides,
    unsupported_or_weak_claims:
      v.assessment?.claims.filter((c) => c.status === 'active' && c.verdict !== 'SUPPORTED') ?? [],
    evidence: v.evidence.map((e) => ({
      policy_id: e.policy_id,
      section_ref: e.section_ref,
      title: e.title,
      dimension: e.dimension,
    })),
    accepted_gaps: v.information_requests.filter((r) => r.status === 'gap_accepted'),
    resolved_contradictions: v.contradictions.filter((c) => c.status === 'resolved'),
    blockers: v.blockers,
    decision: v.decision,
    audit_integrity: verifyChain(ctx.db, v.case.id),
  };
}
