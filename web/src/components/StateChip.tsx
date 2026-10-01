import { STATE_LABELS } from '../constants.ts';
import type { CaseState } from '../types.ts';

const ICONS: Record<CaseState, string> = {
  SUBMITTED: '▫',
  ASSESSMENT: '⟳',
  ANALYST_REVIEW: '🔎',
  INFO_REQUESTED: '⚠',
  COMMITTEE_REVIEW: '⚖',
  DECIDED: '✓',
  CLOSED: '■',
};

export function StateChip({ state, large = false }: { state: CaseState | string; large?: boolean }) {
  const s = state as CaseState;
  const label = STATE_LABELS[s] ?? state;
  return (
    <span
      className={`chip state-${String(state).toLowerCase()} ${large ? 'chip-lg' : ''}`}
      data-state={state}
    >
      <span className="chip-icon" aria-hidden="true">
        {ICONS[s] ?? '•'}
      </span>
      {label.toUpperCase()}
    </span>
  );
}
