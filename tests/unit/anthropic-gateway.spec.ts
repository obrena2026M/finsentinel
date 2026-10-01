import Anthropic from '@anthropic-ai/sdk';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { AnthropicGateway } from '../../src/llm/anthropic-gateway.ts';
import type { LlmRequest } from '../../src/llm/gateway.ts';

// The real gateway with an injected fake SDK client: no network. Covers success, schema retry,
// refusal, max_tokens, HTTP errors, timeouts, and the haiku/opus parameter split (Architecture §5.5).

type Fake = { calls: unknown[]; messages: { parse: (params: unknown) => Promise<unknown> } };

function fakeClient(responses: Array<unknown | Error>): Fake {
  const calls: unknown[] = [];
  return {
    calls,
    messages: {
      parse: async (params: unknown) => {
        calls.push(params);
        const r = responses.shift();
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

const Schema = z.object({ answer: z.string() });
const base = (model: string): LlmRequest<z.infer<typeof Schema>> => ({
  agent: 'scoping',
  model,
  effort: 'low',
  maxTokens: 100,
  system: [{ text: 'stable', cache: true }, { text: 'taxonomy' }],
  user: 'question',
  schema: Schema,
  schemaName: 'Schema',
  caseId: 'c',
  promptVersion: 'v1',
  promptSha256: 'x',
});
const opts = { maxRetries: 0, timeoutMs: 1000, schemaInvalidRetries: 1 };
const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 7,
  cache_creation_input_tokens: 3,
};

test('success: parsed output, usage mapped, cache_control on flagged blocks, haiku omits thinking/effort', async () => {
  const fake = fakeClient([
    { parsed_output: { answer: 'ok' }, usage, stop_reason: 'end_turn', model: 'claude-haiku-4-5' },
  ]);
  const gw = new AnthropicGateway(opts, fake as never);
  const r = await gw.complete(base('claude-haiku-4-5'));
  expect(r.data.answer).toBe('ok');
  expect(r.usage).toEqual({ input: 10, output: 5, cacheRead: 7, cacheWrite: 3 });
  const params = fake.calls[0] as {
    system: Array<{ cache_control?: unknown }>;
    thinking?: unknown;
    output_config: { effort?: string };
  };
  expect(params.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  expect(params.system[1]!.cache_control).toBeUndefined();
  expect(params.thinking).toBeUndefined();
  expect(params.output_config.effort).toBeUndefined();
});

test('opus: adaptive thinking and effort are set', async () => {
  const fake = fakeClient([
    { parsed_output: { answer: 'ok' }, usage, stop_reason: 'end_turn', model: 'claude-opus-5' },
  ]);
  const gw = new AnthropicGateway(opts, fake as never);
  await gw.complete({ ...base('claude-opus-5'), effort: 'high' });
  const params = fake.calls[0] as { thinking?: { type: string }; output_config: { effort?: string } };
  expect(params.thinking).toEqual({ type: 'adaptive' });
  expect(params.output_config.effort).toBe('high');
});

test('schema-invalid output is retried once with the validation error appended, then succeeds', async () => {
  const fake = fakeClient([
    { parsed_output: { wrong: 1 }, usage, stop_reason: 'end_turn', model: 'm' },
    { parsed_output: { answer: 'fixed' }, usage, stop_reason: 'end_turn', model: 'm' },
  ]);
  const gw = new AnthropicGateway(opts, fake as never);
  const r = await gw.complete(base('claude-opus-5'));
  expect(r.attempts).toBe(2);
  expect(r.usage.input).toBe(20);
  const second = fake.calls[1] as { messages: Array<{ content: string }> };
  expect(second.messages[0]!.content).toMatch(/did not match the required schema/);
});

test('schema-invalid twice → LlmError schema_invalid (AD-11 bounded retry)', async () => {
  const fake = fakeClient([
    { parsed_output: null, usage, stop_reason: 'end_turn', model: 'm' },
    { parsed_output: { nope: true }, usage, stop_reason: 'end_turn', model: 'm' },
  ]);
  const gw = new AnthropicGateway(opts, fake as never);
  await expect(gw.complete(base('claude-opus-5'))).rejects.toMatchObject({
    outcome: 'schema_invalid',
    attempts: 2,
  });
});

test('refusal and max_tokens stop reasons fail closed', async () => {
  const gw1 = new AnthropicGateway(
    opts,
    fakeClient([{ parsed_output: null, usage, stop_reason: 'refusal', model: 'm' }]) as never,
  );
  await expect(gw1.complete(base('claude-opus-5'))).rejects.toMatchObject({
    outcome: 'refusal',
    stopReason: 'refusal',
  });
  const gw2 = new AnthropicGateway(
    opts,
    fakeClient([{ parsed_output: null, usage, stop_reason: 'max_tokens', model: 'm' }]) as never,
  );
  await expect(gw2.complete(base('claude-opus-5'))).rejects.toMatchObject({ outcome: 'empty' });
});

test('SDK errors map to http_error / timeout', async () => {
  const apiErr = new Anthropic.APIError(500, { type: 'error' }, 'Internal Server Error', new Headers());
  const gw1 = new AnthropicGateway(opts, fakeClient([apiErr]) as never);
  await expect(gw1.complete(base('claude-opus-5'))).rejects.toMatchObject({ outcome: 'http_error' });
  const timeout = new Anthropic.APIConnectionTimeoutError({ message: 'Request timed out.' });
  const gw2 = new AnthropicGateway(opts, fakeClient([timeout]) as never);
  await expect(gw2.complete(base('claude-opus-5'))).rejects.toMatchObject({ outcome: 'timeout' });
  const gw3 = new AnthropicGateway(opts, fakeClient([new Error('socket hang up')]) as never);
  await expect(gw3.complete(base('claude-opus-5'))).rejects.toMatchObject({ outcome: 'http_error' });
});

test('constructs a real SDK client when none is injected', () => {
  const gw = new AnthropicGateway({ ...opts, apiKey: 'sk-test' });
  expect(gw.kind).toBe('anthropic');
});
