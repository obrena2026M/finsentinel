import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentName } from '../config/llm-config.ts';

// Versioned prompts: prompts/<agent>/v<N>.md — FR-VER-01, FR-ARC-05.

const PROMPTS_DIR = fileURLToPath(new URL('../../prompts/', import.meta.url));

export type LoadedPrompt = { agent: AgentName; version: string; sha256: string; text: string; path: string };

const cache = new Map<string, LoadedPrompt>();

export function loadPrompt(agent: AgentName, version?: string): LoadedPrompt {
  const dir = join(PROMPTS_DIR, agent);
  const versions = readdirSync(dir)
    .filter((f) => /^v\d+\.md$/.test(f))
    .sort((a, b) => Number(a.slice(1, -3)) - Number(b.slice(1, -3)));
  if (versions.length === 0) throw new Error(`no prompts found for agent ${agent}`);
  const file = version ? `${version}.md` : versions[versions.length - 1]!;
  const key = `${agent}/${file}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const path = join(dir, file);
  const text = readFileSync(path, 'utf8');
  const loaded: LoadedPrompt = {
    agent,
    version: file.replace(/\.md$/, ''),
    sha256: createHash('sha256').update(text).digest('hex'),
    text,
    path,
  };
  cache.set(key, loaded);
  return loaded;
}

export function activePromptVersions(): Record<AgentName, string> {
  const agents: AgentName[] = ['extraction', 'scoping', 'contradiction', 'assessment', 'grounding'];
  return Object.fromEntries(agents.map((a) => [a, loadPrompt(a).version])) as Record<AgentName, string>;
}
