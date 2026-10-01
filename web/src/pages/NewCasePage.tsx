import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api, errorMessage } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { useAiReview } from '../components/AiReviewModal.tsx';
import { ErrorText, ReasonButton } from '../components/common.tsx';
import { ALLOWED_EXTENSIONS, CHANGE_TYPES, DOC_KINDS } from '../constants.ts';
import { fmtBytes } from '../format.ts';
import { can } from '../rbac.ts';
import { useToast } from '../toast.tsx';
import type { SampleSet } from '../types.ts';

// Create case (UX §4.3): title, change type, description ≥ 50, multi-file upload with per-file kind.
// Flow: POST /api/cases → [POST documents/from-sample] → POST documents (one request per file)
// → POST pipeline/run → redirect. Sample sets come from GET /api/samples (synthetic content only).

type Row = {
  file: File;
  kind: string;
  ext: string;
  valid: boolean;
  status: 'pending' | 'uploaded' | 'failed';
  error?: string;
};

const MIN_DESC = 50;

function guessKind(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('vendor') || n.includes('questionnaire')) return 'vendor_questionnaire';
  if (n.includes('process')) return 'process_doc';
  if (n.includes('proposal') || n.includes('product')) return 'product_proposal';
  return 'other';
}

function kindLabel(kind: string): string {
  return DOC_KINDS.find((k) => k.value === kind)?.label ?? kind.replace(/_/g, ' ');
}

export function NewCasePage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const aiReview = useAiReview();
  const [title, setTitle] = useState('');
  const [changeType, setChangeType] = useState<string>('product');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [samples, setSamples] = useState<SampleSet[] | null>(null);
  // Change type whose sample documents will be attached on submit (null = none).
  const [sampleType, setSampleType] = useState<string | null>(null);
  const [sampleStatus, setSampleStatus] = useState<'pending' | 'attached' | 'failed'>('pending');

  useEffect(() => {
    let alive = true;
    api
      .samples()
      .then((s) => alive && setSamples(s))
      .catch(() => alive && setSamples([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!can(me?.role, 'case.create')) return <Navigate to="/cases" replace />;

  const sample = samples?.find((s) => s.change_type === changeType) ?? null;
  // The sample only applies while the chosen change type still matches the one it was picked for.
  const activeSample = sampleType !== null && sampleType === changeType ? sample : null;
  const sampleSelected = activeSample !== null;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next: Row[] = Array.from(list).map((file) => {
      const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
      return {
        file,
        kind: guessKind(file.name),
        ext,
        valid: ALLOWED_EXTENSIONS.includes(ext),
        status: 'pending',
      };
    });
    setRows((r) => [...r, ...next]);
  };

  const useSample = () => {
    if (!sample) return;
    setTitle(sample.title);
    setDescription(sample.description);
    setSampleType(sample.change_type);
    setSampleStatus('pending');
  };

  const invalid = rows.filter((r) => !r.valid);
  const docCount = rows.length + (activeSample ? activeSample.documents.length : 0);
  const reason =
    title.trim().length < 3
      ? 'Title is required (min 3 characters)'
      : description.trim().length < MIN_DESC
        ? `Description needs ${MIN_DESC - description.trim().length} more character(s)`
        : docCount === 0
          ? 'Add at least one document or use the sample documents'
          : invalid.length > 0
            ? 'Remove unsupported files'
            : null;

  const submit = async () => {
    if (reason) return;
    setBusy(true);
    setError(null);
    try {
      setProgress('Creating case…');
      const c = await api.createCase({
        title: title.trim(),
        change_type: changeType,
        description: description.trim(),
      });
      let attached = 0;
      let failed = 0;
      if (activeSample) {
        setProgress(`Attaching ${activeSample.documents.length} sample document(s)…`);
        try {
          const docs = await api.attachSampleDocuments(c.id, changeType);
          attached += docs.length;
          setSampleStatus('attached');
        } catch (e) {
          setSampleStatus('failed');
          setError(`Sample documents could not be attached: ${errorMessage(e)}`);
        }
      }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        setProgress(`Uploading ${r.file.name} (${i + 1}/${rows.length})…`);
        try {
          await api.uploadDocument(c.id, r.file, r.kind);
          attached++;
          setRows((rs) => rs.map((x, ix) => (ix === i ? { ...x, status: 'uploaded' } : x)));
        } catch (e) {
          failed++;
          setRows((rs) =>
            rs.map((x, ix) => (ix === i ? { ...x, status: 'failed', error: errorMessage(e) } : x)),
          );
        }
      }
      if (attached === 0) {
        setError(
          `No document could be attached${failed > 0 ? ` (${failed} upload(s) failed)` : ''}. The case was created but the pipeline was not started.`,
        );
        setProgress(null);
        setBusy(false);
        return;
      }
      setProgress('Starting AI review…');
      toast.recorded();
      navigate(`/cases/${c.id}#overview`);
      // Global "AI Review In Progress" modal: opens immediately and triggers the run.
      await aiReview.start(c.id, c.ref);
    } catch (e) {
      setError(errorMessage(e));
      setProgress(null);
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <h1>New case</h1>
      <p className="muted">
        Submit a product or process change for financial-crime risk assessment. Synthetic data only.
      </p>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="title">Title*</label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="case-title"
            placeholder="e.g. International Instant Payments for SMB"
          />
        </div>
        <div className="field">
          <label htmlFor="change_type">Change type*</label>
          <select
            id="change_type"
            className="select"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value)}
            data-testid="case-change-type"
          >
            {CHANGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {sample && (
          <div
            className={`sample-card ${sampleSelected ? 'selected' : ''}`}
            data-testid="sample-card"
            aria-live="polite"
          >
            <div className="row row-between" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="sample-card-title">
                  <span aria-hidden="true">📄</span> Use sample documents for this change type
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>
                  Fills the title and description and attaches synthetic documents so you can see the
                  assessment end to end. You can still add your own files.
                </div>
              </div>
              <button
                type="button"
                className={`btn btn-sm ${sampleSelected ? '' : 'btn-primary'}`}
                onClick={useSample}
                disabled={busy}
                data-testid="use-sample-btn"
              >
                {sampleSelected ? '↻ Fill again' : 'Fill from sample'}
              </button>
            </div>
            <div className="sample-body">
              <div>
                <span className="muted small">Sample:</span> <strong>{sample.title}</strong>
              </div>
              <ul className="sample-docs">
                {sample.documents.map((d) => (
                  <li key={d.name}>
                    <span className="mono">{d.name}</span>{' '}
                    <span className="muted small">· {kindLabel(d.kind)}</span>
                  </li>
                ))}
              </ul>
              {activeSample && (
                <div className="small" style={{ color: 'var(--success)' }} data-testid="sample-selected">
                  ✓ {activeSample.documents.length} sample document
                  {activeSample.documents.length === 1 ? '' : 's'} will be attached when the case is created.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="description">Description* </label>
          <textarea
            id="description"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="case-description"
            placeholder="What is changing, for whom, where, through which channel and with which third parties?"
          />
          <div
            className={`hint ${description.trim().length > 0 && description.trim().length < MIN_DESC ? 'error-text' : ''}`}
          >
            {description.trim().length}/{MIN_DESC} minimum characters
          </div>
        </div>
        <div className="field">
          <label htmlFor="files">
            Documents{sampleSelected ? ' (optional — sample documents selected)' : ''}
          </label>
          <input
            id="files"
            type="file"
            multiple
            accept={ALLOWED_EXTENSIONS.join(',')}
            onChange={(e) => addFiles(e.target.files)}
            data-testid="case-files"
          />
          <div className="hint">Allowed: PDF, DOCX, XLSX, MD, TXT · max 20 MB each · one kind per file</div>
        </div>
        {(rows.length > 0 || sampleSelected) && (
          <div className="stack" style={{ marginBottom: 14 }}>
            {activeSample?.documents.map((d) => (
              <div
                key={`sample-${d.name}`}
                className="file-row file-row-sample"
                data-testid="sample-file-row"
              >
                <div>
                  <div>
                    <strong>{d.name}</strong> <span className="chip chip-ai sample-badge">sample</span>
                  </div>
                  {sampleStatus === 'attached' && (
                    <div className="small" style={{ color: 'var(--success)' }}>
                      ✓ Attached
                    </div>
                  )}
                  {sampleStatus === 'failed' && <div className="error-text small">✗ Not attached</div>}
                </div>
                <span className="muted small">{kindLabel(d.kind)}</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setSampleType(null)}
                  disabled={busy}
                  aria-label="Remove sample documents"
                >
                  Remove
                </button>
              </div>
            ))}
            {rows.map((r, i) => (
              <div
                key={`${r.file.name}-${r.file.size}-${r.file.lastModified}`}
                className={`file-row ${r.valid ? '' : 'invalid'}`}
                data-testid="file-row"
              >
                <div>
                  <div>
                    <strong>{r.file.name}</strong>{' '}
                    <span className="muted small">{fmtBytes(r.file.size)}</span>
                  </div>
                  {!r.valid && (
                    <div className="error-text small">
                      Unsupported type ({r.ext || 'no extension'}). Allowed: PDF, DOCX, XLSX, MD, TXT
                    </div>
                  )}
                  {r.status === 'uploaded' && (
                    <div className="small" style={{ color: 'var(--success)' }}>
                      ✓ Uploaded
                    </div>
                  )}
                  {r.status === 'failed' && <div className="error-text small">✗ {r.error}</div>}
                </div>
                <select
                  className="select"
                  value={r.kind}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, ix) => (ix === i ? { ...x, kind: e.target.value } : x)))
                  }
                  aria-label={`Kind for ${r.file.name}`}
                  disabled={busy}
                >
                  {DOC_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setRows((rs) => rs.filter((_, ix) => ix !== i))}
                  disabled={busy}
                  aria-label={`Remove ${r.file.name}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <ErrorText error={error} />
        {progress && (
          <div className="muted row" role="status">
            <span className="spinner" aria-hidden="true" /> {progress}
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <ReasonButton reason={reason} onClick={submit} busy={busy} testId="create-case-btn">
            Create case and run pipeline
          </ReasonButton>
          <button type="button" className="btn" onClick={() => navigate('/cases')} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
