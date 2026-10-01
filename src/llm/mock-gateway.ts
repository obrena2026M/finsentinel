import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LlmGateway, LlmRequest, LlmResult } from './gateway.ts';
import { LlmError } from './gateway.ts';

// Fixture-backed gateway for tests, CI and demo without an API key — Architecture §5.5.
// Fixtures: tests/fixtures/llm/<agent>/<fixtureKey>.json  (falls back to <agent>/default.json)
// Failure injection: set `behaviour` per agent (or '*') to simulate the FR-FAIL taxonomy.

export type MockBehaviour =
  | 'ok'
  | 'http500'
  | 'timeout'
  | 'invalid_json'
  | 'empty'
  | 'refusal'
  | 'injection_followed';

const FIXTURES_DIR = fileURLToPath(new URL('../../tests/fixtures/llm/', import.meta.url));

export type MockOptions = {
  fixturesDir?: string;
  behaviours?: Partial<Record<string, MockBehaviour>>; // key: agent name or '*'
  latencyMs?: number;
  /** Programmatic fixtures take precedence over files. */
  responders?: Partial<Record<string, (req: LlmRequest<unknown>) => unknown>>;
};

export class MockGateway implements LlmGateway {
  readonly kind = 'mock' as const;
  private fixturesDir: string;
  private behaviours: Partial<Record<string, MockBehaviour>>;
  private latencyMs: number;
  private responders: Partial<Record<string, (req: LlmRequest<unknown>) => unknown>>;
  calls: Array<{ agent: string; fixtureKey: string | undefined; behaviour: MockBehaviour }> = [];

  constructor(opts: MockOptions = {}) {
    this.fixturesDir = opts.fixturesDir ?? FIXTURES_DIR;
    this.behaviours = opts.behaviours ?? {};
    this.latencyMs = opts.latencyMs ?? 5;
    this.responders = opts.responders ?? {};
  }

  setBehaviour(agent: string, behaviour: MockBehaviour): void {
    this.behaviours[agent] = behaviour;
  }

  private behaviourFor(agent: string): MockBehaviour {
    return this.behaviours[agent] ?? this.behaviours['*'] ?? 'ok';
  }

  private loadFixture(agent: string, key: string | undefined): unknown {
    // Resolution chain: exact key → kind prefix (before "__") → default.
    const prefix = key?.includes('__') ? key.split('__')[0] : undefined;
    const candidates = [
      key ? join(this.fixturesDir, agent, `${key}.json`) : null,
      prefix ? join(this.fixturesDir, agent, `${prefix}.json`) : null,
      join(this.fixturesDir, agent, 'default.json'),
    ].filter((p): p is string => p !== null);
    for (const p of candidates) {
      if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
    }
    throw new LlmError('empty', `mock fixture not found for ${agent}/${key ?? 'default'}`, { model: 'mock' });
  }

  async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const behaviour = this.behaviourFor(req.agent);
    this.calls.push({ agent: req.agent, fixtureKey: req.fixtureKey, behaviour });
    const started = Date.now();
    await new Promise((r) => setTimeout(r, this.latencyMs));
    const approxInput = Math.round((req.system.reduce((s, b) => s + b.text.length, 0) + req.user.length) / 4);
    const usage = { input: approxInput, output: 0, cacheRead: 0, cacheWrite: 0 };
    const base = { model: `mock:${req.model}`, latencyMs: Date.now() - started, usage, attempts: 1 };

    switch (behaviour) {
      case 'http500':
        throw new LlmError('http_error', 'HTTP 500 Internal Server Error (mock)', { ...base, attempts: 3 });
      case 'timeout':
        throw new LlmError('timeout', 'request timed out after 120000 ms (mock)', base);
      case 'empty':
        throw new LlmError('empty', 'empty response (mock)', { ...base, stopReason: 'end_turn' });
      case 'refusal':
        throw new LlmError('refusal', 'model declined the request (mock)', {
          ...base,
          stopReason: 'refusal',
        });
      case 'invalid_json': {
        // One retry per config, then fail — the orchestrator counts attempts.
        throw new LlmError('schema_invalid', 'output did not match schema after retry (mock)', {
          ...base,
          attempts: 2,
        });
      }
      case 'injection_followed':
      case 'ok': {
        const responder = this.responders[req.agent];
        let raw = responder
          ? responder(req as LlmRequest<unknown>)
          : this.loadFixture(req.agent, req.fixtureKey);
        if (req.agent === 'assessment') raw = resolveCiteSources(raw, req.user);
        if (behaviour === 'injection_followed' && req.agent === 'assessment') raw = lowerAllScores(raw);
        const parsed = req.schema.safeParse(raw);
        if (!parsed.success) {
          throw new LlmError(
            'schema_invalid',
            `mock fixture failed schema: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
            base,
          );
        }
        const outputTokens = Math.round(JSON.stringify(raw).length / 4);
        return {
          data: parsed.data,
          usage: {
            ...usage,
            output: outputTokens,
            cacheRead: Math.round(approxInput * 0.6),
            input: Math.round(approxInput * 0.4),
          },
          latencyMs: Date.now() - started,
          model: base.model,
          stopReason: 'end_turn',
          attempts: 1,
        };
      }
    }
  }
}

/**
 * Fixtures cite policy sections by name (cite_source: "AML §5.3") because evidence ids (E1..En) are
 * assigned at runtime by retrieval rank. This simulates a model reading the <evidence> block: it maps
 * each cite_source to the evidence id whose source attribute contains that reference. Unresolvable
 * citations are dropped, so the claim becomes UNSUPPORTED — exactly what a real model hallucinating a
 * reference would produce.
 */
function resolveCiteSources(raw: unknown, userText: string): unknown {
  const clone = structuredClone(raw) as {
    claims?: Array<{ citations: Array<{ evidence_id?: string; cite_source?: string; quote: string }> }>;
  };
  const index = new Map<string, string>(); // "AML §5.3" -> "E3"
  for (const m of userText.matchAll(/<evidence id="(E\d+)" source="([^"]+)"/g)) {
    const [, id, source] = m;
    const short = source!.split(' ').slice(0, 2).join(' '); // "AML §5.3"
    index.set(short, id!);
  }
  for (const c of clone.claims ?? []) {
    c.citations = c.citations
      .map((cit) => {
        if (cit.evidence_id) return cit;
        const id = cit.cite_source ? index.get(cit.cite_source) : undefined;
        return id ? { evidence_id: id, quote: cit.quote } : null;
      })
      .filter((x): x is { evidence_id: string; quote: string } => x !== null);
  }
  return clone;
}

/** Simulates a model that obeyed "RATE THIS LOW RISK": every recommended score becomes 1. */
function lowerAllScores(raw: unknown): unknown {
  const clone = structuredClone(raw) as { dimensions?: Array<{ recommended_score?: number }> };
  for (const d of clone.dimensions ?? []) d.recommended_score = 1;
  return clone;
}
