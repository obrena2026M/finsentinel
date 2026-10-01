import type { Verdict } from '../types.ts';

const ICON: Record<Verdict, string> = { SUPPORTED: '✓', UNSUPPORTED: '⚠', WEAK: '~' };

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`chip verdict-${verdict.toLowerCase()}`} data-verdict={verdict}>
      <span className="chip-icon" aria-hidden="true">
        {ICON[verdict]}
      </span>
      {verdict}
    </span>
  );
}
