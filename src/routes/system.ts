import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { riskModels } from '../db/repos/core.ts';
import { authorize } from '../http/authorize.ts';
import { publishRiskModel } from '../services/admin.ts';
import { ADVERSARIAL_TESTS, runAdversarial } from '../services/adversarial.ts';
import type { AppContext } from '../services/context.ts';
import { metricsSnapshot } from '../services/metrics.ts';
import { evaluateGates, recentQualityRuns } from '../services/quality.ts';

export async function systemRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = (a: Parameters<typeof authorize>[1]) => ({ preHandler: authorize(ctx, a) });

  app.get('/health/live', async () => ({
    ok: true,
    service: 'finsentinel',
    build: ctx.env.BUILD_SHA ?? null,
    time: new Date().toISOString(),
  }));
  app.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, boolean | string> = {};
    try {
      ctx.db.prepare('SELECT 1').get();
      checks.db = true;
    } catch {
      checks.db = false;
    }
    try {
      checks.risk_model = riskModels.active(ctx.db).version;
    } catch {
      checks.risk_model = false;
    }
    const fts = (ctx.db.prepare('SELECT COUNT(*) n FROM policy_chunks').get() as { n: number }).n;
    checks.retrieval_index = fts > 0;
    checks.llm_gateway = ctx.gateway.kind;
    checks.llm_configured = ctx.gateway.kind === 'mock' || !!ctx.env.ANTHROPIC_API_KEY;
    const ok =
      checks.db === true &&
      checks.retrieval_index === true &&
      checks.risk_model !== false &&
      checks.llm_configured === true;
    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });

  app.get('/api/quality', auth('quality.view'), async () => ({
    ...evaluateGates(ctx),
    recent_runs: recentQualityRuns(ctx),
    adversarial_tests: ADVERSARIAL_TESTS,
  }));
  app.post(
    '/api/quality/adversarial/:testId/run',
    { ...auth('quality.run_adversarial'), schema: { params: z.object({ testId: z.string() }) } },
    async (request) => runAdversarial(ctx, request.actor!, (request.params as { testId: string }).testId),
  );

  app.get('/api/metrics', auth('metrics.view'), async () => metricsSnapshot(ctx));

  app.get('/api/admin/risk-model', auth('risk_model.view'), async () => ({
    active: riskModels.active(ctx.db),
    versions: riskModels.listVersions(ctx.db),
  }));
  app.put(
    '/api/admin/risk-model',
    { ...auth('risk_model.publish'), schema: { body: z.object({ model: z.unknown(), notes: z.string() }) } },
    async (request, reply) => {
      const b = request.body as { model: unknown; notes: string };
      return reply.code(201).send(publishRiskModel(ctx, request.actor!, b.model, b.notes));
    },
  );
}
