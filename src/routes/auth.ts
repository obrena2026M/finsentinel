import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAuditEvent } from '../audit/writer.ts';
import { users } from '../db/repos/core.ts';
import { ROLE_LABELS } from '../domain/rbac.ts';
import { currentActor } from '../http/authorize.ts';
import type { AppContext } from '../services/context.ts';

// Simulation sign-in (UX §4.1): user picker, no password. AUTH_MODE=password is reserved.

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/auth/users', async () =>
    users.list(ctx.db).map((u) => ({
      username: u.username,
      display_name: u.display_name,
      role: u.role,
      role_label: ROLE_LABELS[u.role],
      role_description: u.role_description,
    })),
  );

  app.post(
    '/api/auth/login',
    { schema: { body: z.object({ username: z.string().min(1), password: z.string().optional() }) } },
    async (request, reply) => {
      const { username } = request.body as { username: string };
      const u = users.byUsername(ctx.db, username);
      if (!u) return reply.code(404).send({ error: 'unknown_user', message: 'unknown user' });
      if (ctx.env.AUTH_MODE === 'password')
        return reply
          .code(501)
          .send({ error: 'not_implemented', message: 'password mode is not enabled in the hackathon build' });
      request.session.userId = u.id;
      appendAuditEvent(ctx.db, {
        actorUserId: u.id,
        actorRole: u.role,
        action: 'login',
        next: { mode: ctx.env.AUTH_MODE },
      });
      return {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        role: u.role,
        role_label: ROLE_LABELS[u.role],
      };
    },
  );

  app.post('/api/auth/logout', async (request) => {
    const actor = currentActor(ctx, request);
    if (actor) appendAuditEvent(ctx.db, { actorUserId: actor.id, actorRole: actor.role, action: 'logout' });
    await request.session.destroy();
    return { ok: true };
  });

  app.get('/api/me', async (request, reply) => {
    const actor = currentActor(ctx, request);
    if (!actor) return reply.code(401).send({ error: 'unauthenticated' });
    return { ...actor, role_label: ROLE_LABELS[actor.role] };
  });
}
