import { createContext, useContext } from 'react';
import type { CaseView, Me } from '../../types.ts';

// Shared case workspace state passed to tabs.

export type CaseCtx = {
  view: CaseView;
  me: Me;
  caseId: string;
  running: boolean;
  reload: () => Promise<void>;
  /** Run a mutation, then reload the view and show the "Recorded in history" toast. */
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
};

export const CaseContext = createContext<CaseCtx | null>(null);

export function useCase(): CaseCtx {
  const c = useContext(CaseContext);
  if (!c) throw new Error('useCase outside CaseContext');
  return c;
}
