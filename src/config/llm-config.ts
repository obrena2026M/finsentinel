import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const AGENT_NAMES = ['extraction', 'scoping', 'contradiction', 'assessment', 'grounding'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

const AgentCfg = z.object({
  model: z.string().min(1),
  effort: z.enum(['low', 'medium', 'high']),
  maxTokens: z.number().int().positive(),
  maxContextTokens: z.number().int().positive(),
});

export const LlmConfigSchema = z.object({
  agents: z.object({
    extraction: AgentCfg,
    scoping: AgentCfg,
    contradiction: AgentCfg,
    assessment: AgentCfg,
    grounding: AgentCfg,
  }),
  retry: z.object({
    schemaInvalidRetries: z.number().int().min(0),
    httpMaxRetries: z.number().int().min(0),
    timeoutMs: z.number().int().positive(),
  }),
  confidence: z.object({ lowThreshold: z.number().min(0).max(1) }),
  grounding: z.object({ llmEntailment: z.boolean() }),
  prices: z.record(
    z.string(),
    z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() }),
  ),
});
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

let cached: LlmConfig | null = null;

export function loadLlmConfig(path?: string): LlmConfig {
  if (cached && !path) return cached;
  const p = path ?? fileURLToPath(new URL('../../config/llm.json', import.meta.url));
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const cfg = LlmConfigSchema.parse(raw);
  if (!path) cached = cfg;
  return cfg;
}

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** USD cost at read time (Architecture §14). Unknown model → 0. */
export function costUsd(cfg: LlmConfig, model: string, u: Usage): number {
  const p = cfg.prices[model];
  if (!p) return 0;
  const usd =
    (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) /
    1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}
