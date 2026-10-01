import { Link } from 'react-router';

// Blockers rail (UX U3): each blocker links to the tab that clears it.

export function blockerTarget(b: string): { tab: string; label: string } {
  const s = b.toLowerCase();
  if (s.includes('claim')) return { tab: 'assessment', label: 'Assessment' };
  if (s.includes('calculation')) return { tab: 'risk', label: 'Risk' };
  return { tab: 'facts', label: 'Facts' };
}

export function BlockersRail({ blockers, caseId }: { blockers: string[]; caseId: string }) {
  return (
    <section className="blockers" aria-label="Blockers">
      {blockers.length === 0 ? (
        <div className="chip chip-success">
          <span className="chip-icon" aria-hidden="true">
            ✓
          </span>
          No blockers
        </div>
      ) : (
        blockers.map((b) => {
          const t = blockerTarget(b);
          return (
            <div key={b} className="blocker-item" data-testid="blocker-item">
              <span>
                <span aria-hidden="true">⚠ </span>
                {b}
              </span>
              <Link to={`/cases/${caseId}#${t.tab}`}>→ {t.label}</Link>
            </div>
          );
        })
      )}
    </section>
  );
}
