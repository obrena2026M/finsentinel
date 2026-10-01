import type { Logger } from 'pino';
import type { z } from 'zod';
import type { AgentName, LlmConfig } from '../config/llm-config.ts';
import type { Db } from '../db/connection.ts';
import type { RiskModel } from '../domain/risk-model-schema.ts';
import type { LlmGateway, LlmRequest, LlmResult, SystemBlock } from '../llm/gateway.ts';
import { LlmError } from '../llm/gateway.ts';
import { loadPrompt } from '../llm/prompts.ts';
import { recordLlmCall } from '../llm/usage.ts';

// Shared runtime handed to every agent: db, gateway, config, active risk model, logger.

export type AgentRuntime = {
  db: Db;
  gateway: LlmGateway;
  llm: LlmConfig;
  riskModel: RiskModel;
  log: Logger;
};

export type CallOptions<T> = {
  agent: AgentName;
  schema: z.ZodType<T>;
  schemaName: string;
  system: SystemBlock[];
  user: string;
  caseId: string;
  stepId: string;
  fixtureKey?: string;
};

/** Runs one LLM call for an agent, records llm_calls (success or failure), rethrows LlmError. */
export async function callAgent<T>(rt: AgentRuntime, o: CallOptions<T>): Promise<LlmResult<T>> {
  const cfg = rt.llm.agents[o.agent];
  const prompt = loadPrompt(o.agent);
  const req: LlmRequest<T> = {
    agent: o.agent,
    model: cfg.model,
    effort: cfg.effort,
    maxTokens: cfg.maxTokens,
    system: o.system,
    user: o.user,
    schema: o.schema,
    schemaName: o.schemaName,
    caseId: o.caseId,
    promptVersion: prompt.version,
    promptSha256: prompt.sha256,
    fixtureKey: o.fixtureKey,
  };
  try {
    const res = await rt.gateway.complete(req);
    recordLlmCall(rt.db, {
      stepId: o.stepId,
      caseId: o.caseId,
      agent: o.agent,
      model: res.model,
      promptVersion: prompt.version,
      promptSha256: prompt.sha256,
      effort: cfg.effort,
      usage: res.usage,
      latencyMs: res.latencyMs,
      stopReason: res.stopReason,
      outcome: 'ok',
    });
    return res;
  } catch (e) {
    if (e instanceof LlmError) {
      recordLlmCall(rt.db, {
        stepId: o.stepId,
        caseId: o.caseId,
        agent: o.agent,
        model: e.model,
        promptVersion: prompt.version,
        promptSha256: prompt.sha256,
        effort: cfg.effort,
        usage: e.usage,
        latencyMs: e.latencyMs,
        stopReason: e.stopReason,
        outcome: e.outcome,
      });
    }
    throw e;
  }
}
