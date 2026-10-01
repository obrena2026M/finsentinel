import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorize } from '../http/authorize.ts';
import {
  acceptGap,
  answerInfoRequest,
  attachEvidence,
  confirmFact,
  editSummary,
  enterFact,
  removeClaim,
  requestInfo,
  resolveContradiction,
} from '../services/analysis.ts';
import {
  addDocument,
  CHANGE_TYPES,
  createCase,
  DOC_KINDS,
  getAudit,
  getCaseView,
  getPacket,
  listCases,
  verifyAudit,
} from '../services/case.ts';
import type { AppContext } from '../services/context.ts';
import { closeCase, recordDecision } from '../services/decision.ts';
import { isRunning, manualContinue, startPipeline } from '../services/pipeline.ts';
import { attachSamples, listSamples } from '../services/samples.ts';
import { override, setControl } from '../services/scoring.ts';
import { finalize } from '../services/workflow.ts';

const Id = z.object({ id: z.string().min(1) });
const Rationale = z.string().min(1);

export async function caseRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = (a: Parameters<typeof authorize>[1]) => ({ preHandler: authorize(ctx, a) });

  app.get('/api/cases', auth('case.view'), async () => listCases(ctx));

  app.post(
    '/api/cases',
    {
      ...auth('case.create'),
      schema: {
        body: z.object({ title: z.string(), change_type: z.enum(CHANGE_TYPES), description: z.string() }),
      },
    },
    async (request, reply) => {
      const c = createCase(ctx, request.actor!, request.body as never);
      return reply.code(201).send(c);
    },
  );

  app.get('/api/cases/:id', { ...auth('case.view'), schema: { params: Id } }, async (request) =>
    getCaseView(ctx, (request.params as { id: string }).id),
  );

  app.post(
    '/api/cases/:id/documents',
    { ...auth('document.upload'), schema: { params: Id } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const file = await request.file();
      if (!file)
        return reply
          .code(400)
          .send({ error: 'validation', message: 'file is required (multipart field "file")' });
      const kindField = file.fields.kind as { value?: string } | undefined;
      const kind = kindField?.value ?? 'other';
      const buffer = await file.toBuffer();
      const d = await addDocument(ctx, request.actor!, id, { filename: file.filename, buffer, kind });
      if (!(DOC_KINDS as readonly string[]).includes(kind))
        return reply.code(400).send({ error: 'validation', message: 'invalid kind' });
      return reply.code(201).send(d);
    },
  );

  app.get('/api/samples', auth('case.view'), async () => listSamples());
  app.post(
    '/api/cases/:id/documents/from-sample',
    { ...auth('document.upload'), schema: { params: Id, body: z.object({ change_type: z.string() }) } },
    async (request, reply) => {
      const docs = await attachSamples(
        ctx,
        request.actor!,
        (request.params as { id: string }).id,
        (request.body as { change_type: string }).change_type,
      );
      return reply.code(201).send(docs);
    },
  );

  app.post(
    '/api/cases/:id/pipeline/run',
    { ...auth('pipeline.run'), schema: { params: Id } },
    async (request, reply) => {
      const r = startPipeline(ctx, request.actor!, (request.params as { id: string }).id);
      return reply.code(202).send(r);
    },
  );
  app.get('/api/cases/:id/pipeline', { ...auth('case.view'), schema: { params: Id } }, async (request) => {
    const v = getCaseView(ctx, (request.params as { id: string }).id);
    return {
      running: isRunning(v.case.id),
      state: v.case.state,
      pipeline: v.pipeline,
      blockers: v.blockers,
      tokens: v.tokens,
    };
  });
  app.post(
    '/api/cases/:id/pipeline/continue-manually',
    { ...auth('pipeline.manual_continue'), schema: { params: Id, body: z.object({ rationale: Rationale }) } },
    async (request) =>
      manualContinue(
        ctx,
        request.actor!,
        (request.params as { id: string }).id,
        (request.body as { rationale: string }).rationale,
      ),
  );

  app.patch(
    '/api/cases/:id/facts/:factId/confirm',
    { ...auth('fact.confirm'), schema: { params: z.object({ id: z.string(), factId: z.string() }) } },
    async (request) => {
      const p = request.params as { id: string; factId: string };
      return confirmFact(ctx, request.actor!, p.id, p.factId);
    },
  );
  app.post(
    '/api/cases/:id/facts',
    {
      ...auth('fact.enter'),
      schema: { params: Id, body: z.object({ field: z.string(), value: z.unknown(), rationale: Rationale }) },
    },
    async (request) => {
      const b = request.body as { field: string; value: unknown; rationale: string };
      return enterFact(
        ctx,
        request.actor!,
        (request.params as { id: string }).id,
        b.field,
        b.value,
        b.rationale,
      );
    },
  );

  app.post(
    '/api/cases/:id/contradictions/:cid/resolve',
    {
      ...auth('contradiction.resolve'),
      schema: {
        params: z.object({ id: z.string(), cid: z.string() }),
        body: z.object({ value: z.unknown(), rationale: Rationale }),
      },
    },
    async (request) => {
      const p = request.params as { id: string; cid: string };
      const b = request.body as { value: unknown; rationale: string };
      return resolveContradiction(ctx, request.actor!, p.id, p.cid, b.value, b.rationale);
    },
  );

  app.post(
    '/api/cases/:id/information-requests/:rid/respond',
    {
      ...auth('info_request.respond'),
      schema: {
        params: z.object({ id: z.string(), rid: z.string() }),
        body: z.object({ answer: z.string() }),
      },
    },
    async (request) => {
      const p = request.params as { id: string; rid: string };
      return answerInfoRequest(ctx, request.actor!, p.id, p.rid, (request.body as { answer: string }).answer);
    },
  );
  app.post(
    '/api/cases/:id/information-requests/:rid/accept-gap',
    {
      ...auth('info_request.accept_gap'),
      schema: {
        params: z.object({ id: z.string(), rid: z.string() }),
        body: z.object({ rationale: Rationale }),
      },
    },
    async (request) => {
      const p = request.params as { id: string; rid: string };
      return acceptGap(ctx, request.actor!, p.id, p.rid, (request.body as { rationale: string }).rationale);
    },
  );
  app.post(
    '/api/cases/:id/request-info',
    { ...auth('fact.enter'), schema: { params: Id } },
    async (request) => requestInfo(ctx, request.actor!, (request.params as { id: string }).id),
  );

  app.patch(
    '/api/cases/:id/assessment',
    { ...auth('assessment.edit'), schema: { params: Id, body: z.object({ summary: z.string() }) } },
    async (request) =>
      editSummary(
        ctx,
        request.actor!,
        (request.params as { id: string }).id,
        (request.body as { summary: string }).summary,
      ),
  );
  app.post(
    '/api/cases/:id/claims/:claimId/remove',
    {
      ...auth('claim.remove'),
      schema: {
        params: z.object({ id: z.string(), claimId: z.string() }),
        body: z.object({ rationale: Rationale }),
      },
    },
    async (request) => {
      const p = request.params as { id: string; claimId: string };
      return removeClaim(
        ctx,
        request.actor!,
        p.id,
        p.claimId,
        (request.body as { rationale: string }).rationale,
      );
    },
  );
  app.post(
    '/api/cases/:id/claims/:claimId/evidence',
    {
      ...auth('claim.attach_evidence'),
      schema: {
        params: z.object({ id: z.string(), claimId: z.string() }),
        body: z.object({ evidence_ref_id: z.string(), quote: z.string().min(3) }),
      },
    },
    async (request) => {
      const p = request.params as { id: string; claimId: string };
      const b = request.body as { evidence_ref_id: string; quote: string };
      return attachEvidence(ctx, request.actor!, p.id, p.claimId, b.evidence_ref_id, b.quote);
    },
  );

  app.post(
    '/api/cases/:id/overrides',
    {
      ...auth('override.create'),
      schema: {
        params: Id,
        body: z.object({ dimension: z.string(), new_score: z.number().int(), rationale: z.string() }),
      },
    },
    async (request, reply) => {
      const b = request.body as { dimension: string; new_score: number; rationale: string };
      const r = override(
        ctx,
        request.actor!,
        (request.params as { id: string }).id,
        b.dimension,
        b.new_score,
        b.rationale,
      );
      return reply.code(201).send(r);
    },
  );
  app.patch(
    '/api/cases/:id/controls/:dimension',
    {
      ...auth('control.set'),
      schema: {
        params: z.object({ id: z.string(), dimension: z.string() }),
        body: z.object({ rating: z.string(), rationale: z.string() }),
      },
    },
    async (request) => {
      const p = request.params as { id: string; dimension: string };
      const b = request.body as { rating: string; rationale: string };
      return setControl(ctx, request.actor!, p.id, p.dimension, b.rating, b.rationale);
    },
  );

  app.post('/api/cases/:id/finalize', { ...auth('case.finalize'), schema: { params: Id } }, async (request) =>
    finalize(ctx, request.actor!, (request.params as { id: string }).id),
  );

  app.post(
    '/api/cases/:id/decision',
    {
      ...auth('decision.record'),
      schema: {
        params: Id,
        body: z.object({
          type: z.string(),
          rationale: z.string(),
          conditions: z
            .array(
              z.object({
                text: z.string(),
                due_date: z.string().nullable().optional(),
                owner: z.string().nullable().optional(),
              }),
            )
            .optional(),
        }),
      },
    },
    async (request, reply) => {
      const r = recordDecision(
        ctx,
        request.actor!,
        (request.params as { id: string }).id,
        request.body as never,
      );
      return reply.code(201).send(r);
    },
  );
  app.post('/api/cases/:id/close', { ...auth('decision.record'), schema: { params: Id } }, async (request) =>
    closeCase(ctx, request.actor!, (request.params as { id: string }).id),
  );

  app.get('/api/cases/:id/packet', { ...auth('packet.view'), schema: { params: Id } }, async (request) =>
    getPacket(ctx, (request.params as { id: string }).id),
  );
  app.get('/api/cases/:id/audit', { ...auth('audit.view'), schema: { params: Id } }, async (request) =>
    getAudit(ctx, (request.params as { id: string }).id),
  );
  app.get('/api/cases/:id/audit/verify', { ...auth('audit.view'), schema: { params: Id } }, async (request) =>
    verifyAudit(ctx, (request.params as { id: string }).id),
  );
}
