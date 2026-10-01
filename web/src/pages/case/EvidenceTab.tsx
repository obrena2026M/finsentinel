import { useState } from 'react';
import { SourceLink } from '../../components/ContextPanel.tsx';
import { Section } from '../../components/common.tsx';
import { dimensionLabel } from '../../constants.ts';
import { fmtBytes, fmtScore } from '../../format.ts';
import { useCase } from './context.ts';

// Evidence tab (UX §4.6): policy evidence (section, BM25 score, query, dimension) + uploaded documents with flags.

export function EvidenceTab() {
  const { view } = useCase();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div>
      <Section title={`Policy evidence (${view.evidence.length})`} testId="policy-evidence">
        {view.evidence.length === 0 ? (
          <div className="banner banner-warning" role="alert">
            <span className="banner-icon" aria-hidden="true">
              ⚠
            </span>
            <div>
              No policy sections matched. Assessment claims cannot be supported until evidence is attached.
            </div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Policy</th>
                <th>Section</th>
                <th>Title</th>
                <th className="num">BM25</th>
                <th>Dimension</th>
                <th>Query</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.evidence.map((e) => (
                <EvidenceRows
                  key={e.id}
                  e={e}
                  open={!!open[e.id]}
                  toggle={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
                />
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title={`Document chunks (${view.documents.length} document${view.documents.length === 1 ? '' : 's'})`}
        testId="document-chunks"
      >
        {view.documents.length === 0 ? (
          <div className="muted">No documents uploaded.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Kind</th>
                <th>Size</th>
                <th>Parse status</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {view.documents.map((d) => {
                const flags = view.flags.filter((f) => f.document_id === d.id);
                const cited = view.facts.filter((f) => f.sources.some((s) => s.document_id === d.id));
                return (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.original_name}</strong>
                      <div className="small muted">
                        {cited.length} fact{cited.length === 1 ? '' : 's'} cite this document
                        {cited.length > 0 && (
                          <>
                            {' '}
                            <SourceLink
                              content={{
                                title: d.original_name,
                                subtitle: `${cited.length} cited chunk quote(s)`,
                                quotes: cited.flatMap((f) =>
                                  f.sources
                                    .filter((s) => s.document_id === d.id)
                                    .map((s) => ({
                                      label: `${f.field} · chunk ${s.chunk_ix}`,
                                      quote: s.quote,
                                    })),
                                ),
                                flags: flags.map((f) => ({
                                  flag_type: f.flag_type,
                                  matched_text: `${f.matched_text} (chunk ${f.chunk_ix})`,
                                })),
                              }}
                            />
                          </>
                        )}
                      </div>
                    </td>
                    <td className="muted">{d.kind.replace(/_/g, ' ')}</td>
                    <td className="muted">{fmtBytes(d.size_bytes)}</td>
                    <td>
                      {d.parse_status === 'parsed' ? (
                        <span className="chip chip-success">✓ parsed</span>
                      ) : d.parse_status === 'parse_failed' ? (
                        <span className="chip chip-danger">✗ {d.parse_error}</span>
                      ) : (
                        <span className="chip chip-neutral">○ pending</span>
                      )}
                    </td>
                    <td>
                      {flags.length === 0 ? (
                        <span className="muted small">none</span>
                      ) : (
                        <span
                          className="chip chip-warning"
                          title={flags.map((f) => f.matched_text).join(' | ')}
                        >
                          ⚠ {flags.length} instruction-like
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function EvidenceRows({
  e,
  open,
  toggle,
}: {
  e: ReturnType<typeof useCase>['view']['evidence'][number];
  open: boolean;
  toggle: () => void;
}) {
  return (
    <>
      <tr data-testid={`evidence-${e.section_ref}`}>
        <td className="muted">{e.rank}</td>
        <td>
          {e.policy_id} <span className="small muted">v{e.policy_version}</span>
        </td>
        <td className="mono">{e.section_ref}</td>
        <td>{e.title ?? <span className="muted">—</span>}</td>
        <td className="num">{fmtScore(e.bm25_score)}</td>
        <td>{dimensionLabel(e.dimension)}</td>
        <td className="small muted">“{e.query}”</td>
        <td>
          <span className="row" style={{ gap: 4 }}>
            <button type="button" className="btn btn-sm" onClick={toggle} aria-expanded={open}>
              {open ? 'Collapse' : 'Expand'}
            </button>
            <SourceLink
              content={{
                title: `${e.policy_id} ${e.section_ref}`,
                subtitle: e.title ?? undefined,
                body: e.body,
                meta: [
                  ['Dimension', dimensionLabel(e.dimension)],
                  ['BM25', fmtScore(e.bm25_score)],
                  ['Query', e.query],
                ],
              }}
            />
          </span>
        </td>
      </tr>
      {open && (
        <tr className="sub-row">
          <td colSpan={8}>
            <div style={{ whiteSpace: 'pre-wrap', color: 'var(--fg)' }}>{e.body}</div>
          </td>
        </tr>
      )}
    </>
  );
}
