import type { DocumentFlag } from '../types.ts';
import { useContextPanel } from './ContextPanel.tsx';

// Fixed copy from FR-ADV-03. The text comes from the API (injection_banner); flags list the documents.

export function InjectionBanner({ text, flags }: { text: string | null; flags: DocumentFlag[] }) {
  const { open } = useContextPanel();
  if (!text) return null;
  const docs = [...new Set(flags.map((f) => f.document_name))];
  return (
    <div className="banner banner-warning" role="alert" data-testid="injection-banner">
      <span className="banner-icon" aria-hidden="true">
        ⚠
      </span>
      <div style={{ flex: 1 }}>
        <strong>{text}</strong>
        {docs.length > 0 && (
          <div className="small">
            Document{docs.length === 1 ? '' : 's'}: {docs.map((d) => `“${d}”`).join(', ')} · {flags.length}{' '}
            flag{flags.length === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() =>
          open({
            title: 'Instruction-like content',
            subtitle: text,
            flags: flags.map((f) => ({
              flag_type: f.flag_type,
              matched_text: `${f.matched_text} (${f.document_name}, chunk ${f.chunk_ix})`,
            })),
          })
        }
      >
        View
      </button>
    </div>
  );
}
