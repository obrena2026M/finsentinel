import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { LlmGateway, LlmRequest, LlmResult, Usage } from './gateway.ts';
import { LlmError } from './gateway.ts';

// Real gateway — Architecture §5.5. Structured outputs via messages.parse + zod; adaptive thinking
// and effort on models that support them; cache_control on stable system blocks (AD-15).

export type AnthropicGatewayOptions = {
  apiKey?: string;
  maxRetries: number;
  timeoutMs: number;
  schemaInvalidRetries: number;
};

function supportsAdaptiveThinking(model: string): boolean {
  // Haiku 4.5 still uses budget_tokens and rejects `effort`; everything current otherwise supports adaptive.
  return !model.startsWith('claude-haiku-4-5');
}

function toUsage(u: Anthropic.Usage | undefined): Usage {
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
  };
}

export class AnthropicGateway implements LlmGateway {
  readonly kind = 'anthropic' as const;
  private client: Anthropic;
  private opts: AnthropicGatewayOptions;

  /** `client` is injectable for tests; production constructs the SDK client from options. */
  constructor(opts: AnthropicGatewayOptions, client?: Pick<Anthropic, 'messages'>) {
    this.opts = opts;
    this.client =
      (client as Anthropic | undefined) ??
      new Anthropic({
        apiKey: opts.apiKey,
        maxRetries: opts.maxRetries,
        timeout: opts.timeoutMs,
      });
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    let usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let lastSchemaError = '';
    const maxAttempts = 1 + this.opts.schemaInvalidRetries;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const userText =
        attempt === 1
          ? req.user
          : `${req.user}\n\nYour previous output did not match the required schema:\n${lastSchemaError}\nReturn a corrected JSON object only.`;

      const system: Anthropic.TextBlockParam[] = req.system.map((b) => ({
        type: 'text',
        text: b.text,
        ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));

      let response: {
        usage?: Anthropic.Usage;
        stop_reason?: string | null;
        model: string;
        parsed_output?: unknown;
      };
      try {
        response = (await this.client.messages.parse({
          model: req.model,
          max_tokens: req.maxTokens,
          system,
          messages: [{ role: 'user', content: userText }],
          output_config: {
            format: zodOutputFormat(req.schema as never),
            ...(supportsAdaptiveThinking(req.model) ? { effort: req.effort } : {}),
          },
          ...(supportsAdaptiveThinking(req.model) ? { thinking: { type: 'adaptive' } } : {}),
        } as never)) as typeof response;
      } catch (e) {
        const latencyMs = Date.now() - started;
        if (e instanceof Anthropic.APIConnectionTimeoutError) {
          throw new LlmError('timeout', e.message, { usage, latencyMs, model: req.model, attempts: attempt });
        }
        if (e instanceof Anthropic.APIError) {
          throw new LlmError('http_error', `HTTP ${e.status ?? '?'} ${e.message}`, {
            usage,
            latencyMs,
            model: req.model,
            attempts: attempt,
          });
        }
        throw new LlmError('http_error', (e as Error).message, {
          usage,
          latencyMs,
          model: req.model,
          attempts: attempt,
        });
      }

      usage = addUsageLocal(usage, toUsage(response.usage));
      const stopReason = response.stop_reason ?? 'unknown';

      if (stopReason === 'refusal') {
        throw new LlmError('refusal', 'model declined the request', {
          usage,
          latencyMs: Date.now() - started,
          model: response.model,
          stopReason,
          attempts: attempt,
        });
      }
      if (stopReason === 'max_tokens') {
        throw new LlmError('empty', 'output truncated at max_tokens', {
          usage,
          latencyMs: Date.now() - started,
          model: response.model,
          stopReason,
          attempts: attempt,
        });
      }

      const parsed = response.parsed_output;
      const check = req.schema.safeParse(parsed);
      if (check.success) {
        return {
          data: check.data,
          usage,
          latencyMs: Date.now() - started,
          model: response.model,
          stopReason,
          attempts: attempt,
        };
      }
      lastSchemaError = check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      if (parsed === null || parsed === undefined)
        lastSchemaError = `empty or unparseable JSON. ${lastSchemaError}`;
    }

    throw new LlmError(
      'schema_invalid',
      `output did not match schema after ${maxAttempts} attempt(s): ${lastSchemaError}`,
      {
        usage,
        latencyMs: Date.now() - started,
        model: req.model,
        attempts: maxAttempts,
      },
    );
  }
}

function addUsageLocal(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}
