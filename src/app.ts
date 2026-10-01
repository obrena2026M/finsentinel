import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import session from '@fastify/session';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuthorizationError } from './domain/rbac.ts';
import { RiskEngineError } from './domain/risk-engine.ts';
import { RiskModelValidationError } from './domain/risk-model-schema.ts';
import { WorkflowError } from './domain/workflow.ts';
import { LlmError } from './llm/gateway.ts';
import { authRoutes } from './routes/auth.ts';
import { caseRoutes } from './routes/cases.ts';
import { systemRoutes } from './routes/system.ts';
import { type AppContext, NotFoundError, ValidationError } from './services/context.ts';
import { recordRequest } from './services/metrics.ts';

const WEB_DIST = fileURLToPath(new URL('../web/dist/', import.meta.url));

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: ctx.log as unknown as FastifyBaseLogger,
    trustProxy: ctx.env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // DEP-05: origins are reflected only when CORS_ORIGIN is unset (local dev); production lists them.
  await app.register(cors, { origin: ctx.env.corsOrigins, credentials: true });
  await app.register(cookie);
  await app.register(session, {
    secret: ctx.env.SESSION_SECRET,
    cookieName: 'finsentinel.sid',
    cookie: { secure: ctx.env.COOKIE_SECURE, httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 },
    saveUninitialized: false,
  });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { global: false });

  // Request metrics (FR-OBS-01), skipping probes.
  app.addHook('onResponse', async (request, reply) => {
    const url = request.routeOptions.url ?? request.url;
    if (url.startsWith('/health') || url === '/api/metrics') return;
    try {
      recordRequest(ctx, url, request.method, reply.statusCode, Math.round(reply.elapsedTime));
    } catch (e) {
      ctx.log.debug({ err: (e as Error).message }, 'metrics write skipped');
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const e = error as Error & { validation?: unknown; statusCode?: number };
    if (e.validation || e.name === 'ZodError' || e.statusCode === 400)
      return reply.code(400).send({ error: 'validation', message: e.message });
    if (e instanceof ValidationError || e instanceof RiskEngineError)
      return reply.code(400).send({ error: 'validation', message: e.message });
    if (e instanceof RiskModelValidationError)
      return reply.code(400).send({ error: 'invalid_risk_model', message: e.message, issues: e.issues });
    if (e instanceof AuthorizationError)
      return reply.code(403).send({ error: 'forbidden', message: e.message });
    if (e instanceof NotFoundError) return reply.code(404).send({ error: 'not_found', message: e.message });
    if (e instanceof WorkflowError) return reply.code(409).send({ error: 'workflow', message: e.message });
    if (e instanceof LlmError)
      return reply.code(502).send({ error: 'llm', message: e.message, outcome: e.outcome });
    if (e.statusCode && e.statusCode < 500)
      return reply.code(e.statusCode).send({ error: 'request', message: e.message });
    const correlationId = request.id;
    ctx.log.error({ err: e, correlationId }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: 'internal', message: 'internal error', correlation_id: correlationId });
  });

  await authRoutes(app, ctx);
  await caseRoutes(app, ctx);
  await systemRoutes(app, ctx);

  if (existsSync(join(WEB_DIST, 'index.html'))) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/', wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api') && !request.url.startsWith('/health'))
        return reply.sendFile('index.html');
      return reply
        .code(404)
        .send({ error: 'not_found', message: `route ${request.method} ${request.url} not found` });
    });
  } else {
    app.get('/', async () => ({
      service: 'FinSentinel API',
      hint: 'web build not found — run `npm run build` or use `npm run dev:web`',
    }));
  }

  return app;
}
