import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { AuditTimeline } from '../../components/AuditTimeline.tsx';
import { ErrorText, Loading, Section } from '../../components/common.tsx';
import { fmtTime } from '../../format.ts';
import type { AuditEvent, IntegrityReport } from '../../types.ts';
import { useCase } from './context.ts';

// History tab (UX §4.10): audit timeline + integrity verification. Read-only by design.

export function HistoryTab() {
  const { view, caseId } = useCase();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ r: IntegrityReport; at: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Re-fetch when the case view changes (any mutation touches updated_at or adds rows).
  const refreshKey = `${view.case.updated_at}:${view.overrides.length}:${view.calculation_history.length}:${view.case.state}`;

  useEffect(() => {
    let alive = true;
    void refreshKey;
    api
      .audit(caseId)
      .then((e) => alive && setEvents(e))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [caseId, refreshKey]);

  const verify = async () => {
    setVerifying(true);
    try {
      const r = await api.verifyAudit(caseId);
      setReport({ r, at: new Date().toISOString() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <Section
        title={`History${events ? ` (${events.length} events)` : ''}`}
        testId="history"
        right={
          <span className="row">
            {report && (
              <span
                className={`chip ${report.r.ok ? 'chip-success' : 'chip-danger'}`}
                data-testid="integrity-status"
              >
                {report.r.ok ? '✓' : '✗'} {report.r.count} events, hash chain{' '}
                {report.r.ok ? 'verified' : `BROKEN at seq ${report.r.firstBrokenSeq}`} {fmtTime(report.at)}
              </span>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={verify}
              disabled={verifying}
              data-testid="verify-btn"
            >
              {verifying ? <span className="spinner" aria-hidden="true" /> : '⛓'}{' '}
              {report ? 'Verify again' : 'Verify integrity'}
            </button>
          </span>
        }
      >
        <ErrorText error={error} />
        {!events && !error && <Loading what="Loading history" />}
        {events && <AuditTimeline events={events} />}
        <p className="small muted" style={{ marginTop: 12 }}>
          Append-only. Each event is chained by SHA-256 to the previous one; nothing here can be edited or
          deleted.
        </p>
      </Section>
    </div>
  );
}
