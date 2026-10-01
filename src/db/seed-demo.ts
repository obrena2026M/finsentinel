import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addDocument, createCase } from '../services/case.ts';
import type { Actor, AppContext } from '../services/context.ts';
import { runPipelineNow } from '../services/pipeline.ts';
import { cases, users } from './repos/core.ts';

// Demo cases for the walkthrough (UX §8). Idempotent: skipped when any case exists.

const FIX = fileURLToPath(new URL('../../tests/fixtures/cases/', import.meta.url));

export async function seedDemoCases(ctx: AppContext): Promise<{ created: string[] }> {
  if (cases.list(ctx.db).length > 0) return { created: [] };
  const owner = users.byUsername(ctx.db, 'owner.pat')!;
  const actor: Actor = {
    id: owner.id,
    username: owner.username,
    role: owner.role,
    display_name: owner.display_name,
  };
  const created: string[] = [];

  const c1 = createCase(ctx, actor, {
    ref: 'RA-1001',
    title: 'International Instant Payments for SMB customers',
    change_type: 'product',
    description:
      'Launch near-instant cross-border payments for existing SMB customers in Canada and Mexico via the public API channel, executed by third-party processor PayRail Inc. Phase one only; additional corridors after six months.',
  } as never);
  await addDocument(ctx, actor, c1.id, {
    filename: 'product_proposal.md',
    buffer: readFileSync(`${FIX}RA-1001/product_proposal.md`),
    kind: 'product_proposal',
  });
  await addDocument(ctx, actor, c1.id, {
    filename: 'vendor_questionnaire.md',
    buffer: readFileSync(`${FIX}RA-1001/vendor_questionnaire.md`),
    kind: 'vendor_questionnaire',
  });
  await runPipelineNow(ctx, actor, c1.id);
  created.push(c1.ref);

  const c2 = createCase(ctx, actor, {
    ref: 'RA-1002',
    title: 'Savings Goal feature in mobile app',
    change_type: 'feature',
    description:
      'Add a Savings Goal feature to the existing mobile banking app letting existing retail customers schedule automatic transfers between their own chequing and savings accounts. Canada only, no third party.',
  } as never);
  await addDocument(ctx, actor, c2.id, {
    filename: 'product_proposal.md',
    buffer: readFileSync(`${FIX}RA-LOW/product_proposal.md`),
    kind: 'product_proposal',
  });
  await runPipelineNow(ctx, actor, c2.id);
  created.push(c2.ref);

  return { created };
}
