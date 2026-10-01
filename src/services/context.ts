import type { Logger } from 'pino';
import type { AgentRuntime } from '../agents/runtime.ts';
import type { Env } from '../config/env.ts';
import type { LlmConfig } from '../config/llm-config.ts';
import type { Db } from '../db/connection.ts';
import { riskModels } from '../db/repos/core.ts';
import type { Role } from '../domain/rbac.ts';
import type { LlmGateway } from '../llm/gateway.ts';

export type AppContext = {
  db: Db;
  env: Env;
  llm: LlmConfig;
  gateway: LlmGateway;
  log: Logger;
};

export type Actor = { id: string; username: string; role: Role; display_name: string };

export function agentRuntime(ctx: AppContext): AgentRuntime {
  return {
    db: ctx.db,
    gateway: ctx.gateway,
    llm: ctx.llm,
    riskModel: riskModels.active(ctx.db),
    log: ctx.log,
  };
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
