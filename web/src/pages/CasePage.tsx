import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { ErrorText, Loading } from '../components/common.tsx';
import { StateChip } from '../components/StateChip.tsx';
import { useToast } from '../toast.tsx';
import type { CaseView } from '../types.ts';
import { AssessmentTab } from './case/AssessmentTab.tsx';
import { CommitteeTab } from './case/CommitteeTab.tsx';
import { CaseContext, type CaseCtx } from './case/context.ts';
import { EvidenceTab } from './case/EvidenceTab.tsx';
import { FactsTab } from './case/FactsTab.tsx';
import { HistoryTab } from './case/HistoryTab.tsx';
import { OverviewTab } from './case/OverviewTab.tsx';
import { RiskTab } from './case/RiskTab.tsx';

// Case workspace (UX §4.4–4.10). Tabs via URL hash; pipeline polled every 2 s while running (UX §6).

const TABS = ['overview', 'facts', 'evidence', 'assessment', 'risk', 'committee', 'history'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  facts: 'Facts',
  evidence: 'Evidence',
  assessment: 'Assessment',
  risk: 'Risk',
  committee: 'Committee',
  history: 'History',
};

export function CasePage() {
  const { id = '' } = useParams();
  const { me } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [view, setView] = useState<CaseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const pollTimer = useRef<number | null>(null);

  const tab: Tab = (TABS as readonly string[]).includes(location.hash.slice(1))
    ? (location.hash.slice(1) as Tab)
    : 'overview';

  const reload = useCallback(async () => {
    try {
      const v = await api.getCase(id);
      setView(v);
      setError(null);
      const s = await api.pipelineStatus(v.case.id);
      setRunning(s.running);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    setView(null);
    void reload();
  }, [reload]);

  // Poll GET /api/cases/:id/pipeline while running (700 ms so the progress panel feels live;
  // 2 s while merely waiting for a queued run to start); refresh the full view on completion.
  useEffect(() => {
    if (!view) return;
    const isRunning = running || view.pipeline?.status === 'running';
    const shouldPoll = isRunning || view.case.state === 'SUBMITTED';
    if (!shouldPoll) return;
    const interval = isRunning ? 700 : 2000;
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.pipelineStatus(view.case.id);
        if (!alive) return;
        setView((v) =>
          v
            ? {
                ...v,
                pipeline: s.pipeline,
                blockers: s.blockers,
                tokens: s.tokens,
                case: { ...v.case, state: s.state },
              }
            : v,
        );
        if (!s.running && s.pipeline?.status !== 'running') {
          setRunning(false);
          await reload();
          return;
        }
        setRunning(true);
        pollTimer.current = window.setTimeout(tick, 700);
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    };
    pollTimer.current = window.setTimeout(tick, interval);
    return () => {
      alive = false;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [view, running, reload]);

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      await fn();
      toast.recorded();
      await reload();
    },
    [reload, toast],
  );

  const ctx = useMemo<CaseCtx | null>(
    () => (view && me ? { view, me, caseId: view.case.id, running, reload, mutate } : null),
    [view, me, running, reload, mutate],
  );

  if (error && !view) return <ErrorText error={error} />;
  if (!ctx || !view) return <Loading what="Loading case" />;

  const counts: Partial<Record<Tab, number>> = {
    facts:
      view.contradictions.filter((c) => c.status === 'open').length +
      view.information_requests.filter((r) => r.status === 'open').length,
    assessment:
      view.assessment?.claims.filter((c) => c.status === 'active' && c.verdict !== 'SUPPORTED').length ?? 0,
    overview: view.blockers.length,
  };

  return (
    <CaseContext.Provider value={ctx}>
      <div>
        <div className="row row-between">
          <div>
            <h1>
              <span className="mono">{view.case.ref}</span> {view.case.title}
            </h1>
            <div className="header-meta">
              {view.case.change_type.replace(/_/g, ' ')} change · Submitted by {view.case.submitted_by_name}
              {view.versions ? ` · Risk model v${view.versions.risk_model_version}` : ''}
              {view.versions?.prompt_versions
                ? ` · Prompts ${Object.entries(view.versions.prompt_versions)
                    .map(([k, v]) => `${k.slice(0, 3)} ${v}`)
                    .join(' / ')}`
                : ''}
            </div>
          </div>
          <div className="row">
            {running && (
              <span className="chip chip-info chip-pulse">
                <span className="chip-icon" aria-hidden="true">
                  ⟳
                </span>
                PIPELINE RUNNING
              </span>
            )}
            <StateChip state={view.case.state} large />
          </div>
        </div>
        <ErrorText error={error} />
        <nav className="tabs" aria-label="Case tabs">
          {TABS.map((t) => (
            <Link
              key={t}
              to={`/cases/${view.case.id}#${t}`}
              className={t === tab ? 'active' : ''}
              data-testid={`tab-${t}`}
              aria-current={t === tab ? 'page' : undefined}
            >
              {TAB_LABELS[t]}
              {counts[t] ? <span className="tab-count">{counts[t]}</span> : null}
            </Link>
          ))}
        </nav>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'facts' && <FactsTab />}
        {tab === 'evidence' && <EvidenceTab />}
        {tab === 'assessment' && <AssessmentTab />}
        {tab === 'risk' && <RiskTab />}
        {tab === 'committee' && <CommitteeTab />}
        {tab === 'history' && <HistoryTab />}
      </div>
    </CaseContext.Provider>
  );
}
