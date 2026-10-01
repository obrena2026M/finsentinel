import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { useAiReview } from '../components/AiReviewModal.tsx';
import { BandChip } from '../components/BandChip.tsx';
import { ErrorText, Loading } from '../components/common.tsx';
import { StateChip } from '../components/StateChip.tsx';
import { CHANGE_TYPES, STATE_LABELS } from '../constants.ts';
import { fmtDateTime, fmtScore } from '../format.ts';
import { can } from '../rbac.ts';
import { useToast } from '../toast.tsx';
import type { CaseListRow } from '../types.ts';

// Case list (UX §4.2). Analysts and product owners can re-run the assessment from the list
// (POST /api/cases/:id/pipeline/run) — handy for demos of the live pipeline view.

const NO_RERUN_STATES = new Set(['COMMITTEE_REVIEW', 'DECIDED', 'CLOSED']);

export function CasesPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<CaseListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [rerunning, setRerunning] = useState<string | null>(null);
  const aiReview = useAiReview();
  const canRun = can(me?.role, 'pipeline.run');

  // Poll faster while any pipeline is running so the "step n/total" chip stays live.
  const anyRunning = (rows ?? []).some((r) => r.pipeline?.status === 'running');

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .listCases()
        .then((r) => alive && setRows(r))
        .catch((e) => alive && setError(errorMessage(e)));
    void tick();
    const t = window.setInterval(tick, anyRunning ? 2000 : 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [anyRunning]);

  const rerun = async (r: CaseListRow) => {
    setRerunning(r.id);
    try {
      // Opens the global "AI Review In Progress" modal immediately and triggers the run.
      await aiReview.start(r.id, r.ref);
      setRows(await api.listCases());
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setRerunning(null);
    }
  };

  const filtered = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!state || r.state === state) &&
          (!type || r.change_type === type) &&
          (!q || `${r.ref} ${r.title}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [rows, state, type, q],
  );

  return (
    <div>
      <div className="row row-between" style={{ marginBottom: 14 }}>
        <h1>Cases</h1>
        {can(me?.role, 'case.create') && (
          <Link to="/cases/new" className="btn btn-primary" data-testid="new-case-btn">
            + New case
          </Link>
        )}
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="muted small" htmlFor="filter-state">
            Filter:
          </label>
          <select
            id="filter-state"
            className="select"
            style={{ width: 200 }}
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">All states</option>
            {Object.entries(STATE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            className="select"
            style={{ width: 200 }}
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter by change type"
          >
            <option value="">All types</option>
            {CHANGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ width: 260 }}
            placeholder="Search ref or title"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
        </div>
        <ErrorText error={error} />
        {!rows && !error && <Loading what="Loading cases" />}
        {rows && filtered.length === 0 && <div className="empty">No cases match.</div>}
        {rows && filtered.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Title</th>
                <th>Type</th>
                <th>State</th>
                <th>Residual</th>
                <th>Updated</th>
                {canRun && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="clickable"
                  data-testid={`case-row-${r.ref}`}
                  onClick={() => navigate(`/cases/${r.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/cases/${r.id}`)}
                >
                  <td>
                    <Link to={`/cases/${r.id}`} className="mono" onClick={(e) => e.stopPropagation()}>
                      {r.ref}
                    </Link>
                  </td>
                  <td>{r.title}</td>
                  <td className="muted">{r.change_type.replace(/_/g, ' ')}</td>
                  <td>
                    <StateChip state={r.state} />
                  </td>
                  <td>
                    {r.pipeline && r.pipeline.status === 'running' ? (
                      <span className="chip chip-info">
                        <span className="chip-icon" aria-hidden="true">
                          ⟳
                        </span>
                        step {r.pipeline.done}/{r.pipeline.total}
                      </span>
                    ) : r.residual_band ? (
                      <span className="row" style={{ gap: 6 }}>
                        <BandChip band={r.residual_band} />{' '}
                        <span className="muted small">{fmtScore(r.residual_score)}</span>
                      </span>
                    ) : r.open_info_requests > 0 ? (
                      <span className="chip chip-warning">
                        <span className="chip-icon" aria-hidden="true">
                          ⚠
                        </span>
                        {r.open_info_requests} gap{r.open_info_requests === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <BandChip band={null} />
                    )}
                  </td>
                  <td className="muted small">{fmtDateTime(r.updated_at)}</td>
                  {canRun && (
                    <td>
                      {(() => {
                        const isRunning = r.pipeline?.status === 'running';
                        const blocked = NO_RERUN_STATES.has(r.state);
                        const title = isRunning
                          ? 'Pipeline is already running'
                          : blocked
                            ? `Cannot re-run in state ${r.state}`
                            : 'Re-run the AI assessment for this case';
                        return (
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={isRunning || blocked || rerunning === r.id}
                            title={title}
                            aria-label={`Re-run assessment for ${r.ref}`}
                            data-testid={`rerun-${r.ref}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void rerun(r);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {rerunning === r.id ? <span className="spinner" aria-hidden="true" /> : '↻'}{' '}
                            Re-run assessment
                          </button>
                        );
                      })()}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
