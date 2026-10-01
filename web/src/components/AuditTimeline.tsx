import { useState } from 'react';
import { fmtTime } from '../format.ts';
import type { AuditEvent } from '../types.ts';

// History tab timeline (UX §4.10): newest first, rows expand to previous/new JSON. No edit affordances.

function describe(e: AuditEvent): string {
  const n = (e.next ?? {}) as Record<string, unknown>;
  const pv = (e.previous ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case 'case_created':
      return `Case created ${String(n.ref ?? '')} — ${String(n.title ?? '')}`;
    case 'document_uploaded':
      return `Document uploaded ${String(n.name ?? '')} (${String(n.kind ?? '')})`;
    case 'pipeline_started':
      return 'Pipeline started';
    case 'pipeline_completed':
      return 'Pipeline completed';
    case 'pipeline_step_failed':
      return `Pipeline step failed: ${String(n.step ?? '')} (${String(n.code ?? '')})`;
    case 'documents_processed':
      return `Documents processed (${String(n.parsed ?? '')}) ⚠ instruction-like content flagged`;
    case 'assessment_drafted':
      return `Assessment drafted (${e.model_version ?? 'model'}, prompt ${e.prompt_version ?? '?'})`;
    case 'risk_calculated':
      return `Risk calculated (pipeline) ${String(n.inherent ?? '')}/${String(n.inherent_band ?? '')} → ${String(n.residual ?? '')}/${String(n.residual_band ?? '')}`;
    case 'risk_recalculated':
      return `Risk recalculated ${String(pv.residual ?? '?')}/${String(pv.residual_band ?? '?')} → ${String(n.residual ?? '')}/${String(n.residual_band ?? '')} (${String(n.trigger ?? '')}, model v${e.risk_model_version ?? '?'})`;
    case 'override': {
      const dim = Object.keys(n)[0] ?? '';
      return `Override ${dim} ${String(pv[dim] ?? '')} → ${String(n[dim] ?? '')}`;
    }
    case 'control_rating_set':
      return `Control set ${String(e.entity_id ?? '')
        .split(':')
        .pop()} = ${String(n.control ?? '')}`;
    case 'fact_confirmed':
      return `Fact confirmed ${String(n.field ?? '')}`;
    case 'fact_entered':
      return `Fact entered ${String(n.field ?? '')} = ${JSON.stringify(n.value)}`;
    case 'contradiction_resolved':
      return `Contradiction resolved ${String(n.field ?? '')} = ${JSON.stringify(n.value)}`;
    case 'info_answered':
      return `Information request answered (${String(n.field ?? '')})`;
    case 'gap_accepted':
      return `Information gap accepted (${String(n.field ?? '')})`;
    case 'info_requested':
      return 'Information requested from owner';
    case 'assessment_edited':
      return 'Assessment narrative edited';
    case 'claim_removed':
      return `Claim removed — “${String(pv.text ?? '').slice(0, 80)}”`;
    case 'claim_evidence_added':
      return `Evidence attached to claim (${String(n.evidence ?? '')})`;
    case 'finalized':
      return `Finalized → ${String(n.state ?? '')}`;
    case 'manual_continue':
      return `Continued manually → ${String(n.state ?? '')}`;
    case 'decision': {
      const conds = Array.isArray(n.conditions) ? (n.conditions as unknown[]).length : 0;
      return `Decision ${String(n.type ?? '')}${conds ? ` (${conds} condition${conds === 1 ? '' : 's'})` : ''}`;
    }
    case 'deferred':
      return 'Decision DEFER → back to analyst review';
    case 'closed':
      return 'Case closed';
    case 'authz_denied':
      return `Access denied: ${String(n.attempted ?? '')}`;
    case 'login':
      return 'Signed in';
    case 'logout':
      return 'Signed out';
    default:
      return e.action.replace(/_/g, ' ');
  }
}

export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const sorted = [...events].sort((a, b) => b.seq - a.seq);
  if (sorted.length === 0) return <div className="empty">No history yet.</div>;
  return (
    <ul className="timeline">
      {sorted.map((e) => (
        <li key={e.id} className="timeline-row" data-testid="audit-row" data-action={e.action}>
          <span className="mono small muted">{fmtTime(e.created_at)}</span>
          <span className="actor">
            {e.actor_name} <span className="small muted">({e.actor_role})</span>
          </span>
          <span>
            {describe(e)}
            {e.reason && <span className="muted"> — “{e.reason}”</span>}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
            aria-expanded={!!open[e.id]}
          >
            {open[e.id] ? 'Hide' : 'Details'}
          </button>
          {open[e.id] && (
            <div className="timeline-detail">
              <div>
                <div className="small muted">Previous</div>
                <pre>
                  {e.previous === null || e.previous === undefined
                    ? '—'
                    : JSON.stringify(e.previous, null, 2)}
                </pre>
              </div>
              <div>
                <div className="small muted">Next</div>
                <pre>{e.next === null || e.next === undefined ? '—' : JSON.stringify(e.next, null, 2)}</pre>
              </div>
              <div className="small muted" style={{ gridColumn: '1 / -1' }}>
                seq {e.seq} · hash <code>{e.hash.slice(0, 16)}…</code> · prev{' '}
                <code>{e.prev_hash ? `${e.prev_hash.slice(0, 16)}…` : 'genesis'}</code>
                {e.risk_model_version ? ` · risk model v${e.risk_model_version}` : ''}
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
