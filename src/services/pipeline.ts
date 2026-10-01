import { runPipeline } from '../agents/orchestrator.ts';
import { appendAuditEvent } from '../audit/writer.ts';
import { cases, pipeline } from '../db/repos/core.ts';
import { transition } from '../domain/workflow.ts';
import type { Actor, AppContext } from './context.ts';
import { agentRuntime, NotFoundError } from './context.ts';

// One case at a time; the API returns immediately and the UI polls (UX §6).
const running = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();

export function startPipeline(ctx: AppContext, actor: Actor, caseId: string): { queued: boolean } {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  if (running.has(caseId)) return { queued: false };
  // Validate the transition up-front so the caller gets a 409 for CLOSED etc.
  transition(c.state, 'start_pipeline');
  running.add(caseId);
  queue = queue
    .then(() => runPipeline(agentRuntime(ctx), caseId, { id: actor.id, role: actor.role }))
    .catch((e) => ctx.log.error({ err: (e as Error).message, caseId }, 'pipeline crashed'))
    .finally(() => running.delete(caseId));
  return { queued: true };
}

/** Awaits completion — used by seed and tests. */
export async function runPipelineNow(ctx: AppContext, actor: Actor, caseId: string) {
  return runPipeline(agentRuntime(ctx), caseId, { id: actor.id, role: actor.role });
}

export function isRunning(caseId: string): boolean {
  return running.has(caseId);
}

export function manualContinue(ctx: AppContext, actor: Actor, caseId: string, rationale: string) {
  const c = cases.byId(ctx.db, caseId);
  if (!c) throw new NotFoundError('case');
  const next = transition(c.state, 'manual_continue');
  const run = pipeline.latestRun(ctx.db, caseId);
  cases.setState(ctx.db, caseId, next);
  if (run) pipeline.finishRun(ctx.db, run.id, 'manual_continue');
  appendAuditEvent(ctx.db, {
    caseId,
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'manual_continue',
    reason: rationale,
    previous: { state: c.state },
    next: { state: next },
  });
  return { state: next };
}
