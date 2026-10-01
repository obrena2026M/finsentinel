import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { appendAuditEvent } from '../audit/writer.ts';
import { users } from '../db/repos/core.ts';
import { type Action, isAllowed } from '../domain/rbac.ts';
import type { Actor, AppContext } from '../services/context.ts';

declare module 'fastify' {
  interface Session {
    userId?: string;
  }
  interface FastifyRequest {
    actor?: Actor;
  }
}

// RBAC preHandler — FR-RBAC-01/07, Architecture §9.2. Routes never check roles inline.

export function currentActor(ctx: AppContext, request: FastifyRequest): Actor | null {
  const id = request.session?.userId;
  if (!id) return null;
  const u = users.byId(ctx.db, id);
  if (!u) return null;
  return { id: u.id, username: u.username, role: u.role, display_name: u.display_name };
}

export function authorize(ctx: AppContext, action: Action): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const actor = currentActor(ctx, request);
    if (!actor) {
      reply.code(401).send({ error: 'unauthenticated', message: 'sign in first' });
      return reply;
    }
    if (!isAllowed(actor.role, action)) {
      const caseId = (request.params as { id?: string } | undefined)?.id ?? null;
      appendAuditEvent(ctx.db, {
        caseId: caseId && caseExists(ctx, caseId) ? caseId : null,
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'authz_denied',
        next: { attempted: action, route: request.routeOptions.url },
      });
      reply
        .code(403)
        .send({ error: 'forbidden', message: `role ${actor.role} is not permitted to ${action}` });
      return reply;
    }
    request.actor = actor;
  };
}

function caseExists(ctx: AppContext, id: string): boolean {
  return !!ctx.db.prepare('SELECT 1 FROM cases WHERE id = ?').get(id);
}
