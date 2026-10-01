import type { z } from 'zod';
import type { AgentName } from '../config/llm-config.ts';

// Single LLM access point — Architecture AD-10, §5.5. Agents never import an SDK directly.

export type Effort = 'low' | 'medium' | 'high';

export type SystemBlock = { text: string; cache?: boolean };

export type LlmRequest<T> = {
  agent: AgentName;
  model: string;
  effort: Effort;
  maxTokens: number;
  system: SystemBlock[];
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  caseId: string | null;
  promptVersion: string;
  promptSha256: string;
  /** Used by the mock gateway to pick a fixture. */
  fixtureKey?: string;
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type LlmResult<T> = {
  data: T;
  usage: Usage;
  latencyMs: number;
  model: string;
  stopReason: string;
  attempts: number;
};

export type LlmOutcome = 'ok' | 'schema_invalid' | 'http_error' | 'timeout' | 'empty' | 'refusal';

export class LlmError extends Error {
  outcome: Exclude<LlmOutcome, 'ok'>;
  usage: Usage;
  latencyMs: number;
  model: string;
  stopReason: string | null;
  attempts: number;
  constructor(
    outcome: Exclude<LlmOutcome, 'ok'>,
    message: string,
    extra: Partial<Pick<LlmError, 'usage' | 'latencyMs' | 'model' | 'stopReason' | 'attempts'>> = {},
  ) {
    super(message);
    this.name = 'LlmError';
    this.outcome = outcome;
    this.usage = extra.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    this.latencyMs = extra.latencyMs ?? 0;
    this.model = extra.model ?? 'unknown';
    this.stopReason = extra.stopReason ?? null;
    this.attempts = extra.attempts ?? 1;
  }
}

export interface LlmGateway {
  readonly kind: 'anthropic' | 'mock';
  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}
