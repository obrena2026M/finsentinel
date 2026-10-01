import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDocument, CHANGE_TYPES } from './case.ts';
import type { Actor, AppContext } from './context.ts';
import { NotFoundError, ValidationError } from './context.ts';

// Sample document sets per change type (samples/manifest.json) used by the "Use sample documents"
// action when creating a case. Synthetic content only.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST = join(ROOT, 'samples', 'manifest.json');

type Sample = { title: string; description: string; documents: Array<{ kind: string; file: string }> };
type Manifest = { samples: Record<string, Sample> };

let cached: Manifest | null = null;
function manifest(): Manifest {
  if (!cached) cached = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
  return cached;
}

export function listSamples() {
  const m = manifest();
  return CHANGE_TYPES.filter((t) => m.samples[t]).map((t) => {
    const s = m.samples[t]!;
    return {
      change_type: t,
      title: s.title,
      description: s.description,
      documents: s.documents.map((d) => ({ kind: d.kind, name: basename(d.file) })),
    };
  });
}

export function sampleFor(changeType: string): Sample {
  const s = manifest().samples[changeType];
  if (!s) throw new NotFoundError(`sample for change type ${changeType}`);
  return s;
}

/** Attaches every sample document for a change type to the case. */
export async function attachSamples(ctx: AppContext, actor: Actor, caseId: string, changeType: string) {
  if (!(CHANGE_TYPES as readonly string[]).includes(changeType))
    throw new ValidationError('invalid change_type');
  const s = sampleFor(changeType);
  const out = [];
  for (const d of s.documents) {
    const buffer = readFileSync(join(ROOT, d.file));
    out.push(await addDocument(ctx, actor, caseId, { filename: basename(d.file), buffer, kind: d.kind }));
  }
  return out;
}
