import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

// Right-rail evidence viewer (UX §5 ContextPanel / SourceLink). Any component can open it via useContextPanel().

export type PanelContent = {
  title: string;
  subtitle?: string;
  /** Full text to show; quotes found inside it are highlighted. */
  body?: string | null;
  /** Quotes to show (and highlight inside body when present). */
  quotes?: Array<{ label?: string; quote: string }>;
  flags?: Array<{ flag_type: string; matched_text: string }>;
  meta?: Array<[string, string]>;
};

type PanelApi = { content: PanelContent | null; open: (c: PanelContent) => void; close: () => void };

const PanelContext = createContext<PanelApi>({
  content: null,
  open: () => undefined,
  close: () => undefined,
});

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<PanelContent | null>(null);
  const open = useCallback((c: PanelContent) => setContent(c), []);
  const close = useCallback(() => setContent(null), []);
  const value = useMemo(() => ({ content, open, close }), [content, open, close]);
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

export function useContextPanel(): PanelApi {
  return useContext(PanelContext);
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Highlights the first occurrence of each quote inside body (whitespace-insensitive best effort). */
function Highlighted({ body, quotes }: { body: string; quotes: string[] }) {
  const parts: ReactNode[] = [];
  let rest = body;
  let key = 0;
  const lowerBody = normalize(body);
  const sorted = quotes
    .map((q) => ({ q, ix: lowerBody.indexOf(normalize(q)) }))
    .filter((x) => x.ix >= 0 && x.q.trim().length > 0)
    .sort((a, b) => a.ix - b.ix);
  if (sorted.length === 0) return <>{body}</>;
  // Simple approach: exact (case-insensitive) match on the raw body; fall back to plain body when whitespace differs.
  for (const { q } of sorted) {
    const ix = rest.toLowerCase().indexOf(q.trim().toLowerCase());
    if (ix < 0) continue;
    parts.push(<span key={key++}>{rest.slice(0, ix)}</span>);
    parts.push(<mark key={key++}>{rest.slice(ix, ix + q.trim().length)}</mark>);
    rest = rest.slice(ix + q.trim().length);
  }
  parts.push(<span key={key++}>{rest}</span>);
  return <>{parts}</>;
}

export function ContextPanel() {
  const { content, close } = useContextPanel();
  if (!content) return null;
  return (
    <aside className="context-panel" aria-label="Context panel">
      <div className="context-panel-header">
        <div>
          <h2>{content.title}</h2>
          {content.subtitle && <div className="muted small">{content.subtitle}</div>}
        </div>
        <button type="button" className="btn btn-sm" onClick={close} aria-label="Close panel">
          ✕ Close
        </button>
      </div>
      {content.meta && content.meta.length > 0 && (
        <dl className="kv" style={{ marginBottom: 12 }}>
          {content.meta.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {content.flags && content.flags.length > 0 && (
        <div className="banner banner-warning">
          <span className="banner-icon" aria-hidden="true">
            ⚠
          </span>
          <div>
            <strong>Instruction-like content flagged</strong>
            <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {content.flags.map((f) => (
                <li key={`${f.flag_type}:${f.matched_text}`}>
                  <code>{f.flag_type}</code>: “{f.matched_text}”
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {content.body ? (
        <div className="quote-body">
          <Highlighted body={content.body} quotes={(content.quotes ?? []).map((q) => q.quote)} />
        </div>
      ) : (
        content.quotes &&
        content.quotes.length > 0 && (
          <div className="stack">
            {content.quotes.map((q) => (
              <blockquote
                key={`${q.label ?? ''}:${q.quote}`}
                style={{ margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--accent)' }}
              >
                {q.label && <div className="small muted">{q.label}</div>}
                <mark>“{q.quote}”</mark>
              </blockquote>
            ))}
          </div>
        )
      )}
      {!content.body && (!content.quotes || content.quotes.length === 0) && (
        <div className="empty">No source text available.</div>
      )}
    </aside>
  );
}

/** ↗ link that opens the panel. */
export function SourceLink({
  content,
  label = '↗',
  title = 'Open source',
}: {
  content: PanelContent;
  label?: string;
  title?: string;
}) {
  const { open } = useContextPanel();
  return (
    <button type="button" className="btn-link" onClick={() => open(content)} title={title} aria-label={title}>
      {label}
    </button>
  );
}
