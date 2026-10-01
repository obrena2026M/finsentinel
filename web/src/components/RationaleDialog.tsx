import { type ReactNode, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { MIN_RATIONALE_LENGTH } from '../constants.ts';

// Shared rationale form (UX U4 / §5): extra fields + rationale (min 20 chars) + actor line.
// Submit is disabled with a visible reason until the rationale is long enough; server errors show inline.

export type RationaleDialogProps = {
  title: string;
  /** Extra form fields rendered above the rationale. */
  children?: ReactNode;
  /** Returns a reason string when the extra fields are not valid yet; null when OK. */
  validate?: () => string | null;
  onSubmit: (rationale: string) => Promise<void>;
  onClose: () => void;
  submitLabel?: string;
  rationaleLabel?: string;
  /** Extra context shown under the actor line (e.g. "risk model v1.0"). */
  contextLine?: string;
  /** Skip the rationale field (used for forms whose only input is another field). */
  withoutRationale?: boolean;
  initialRationale?: string;
};

export function RationaleDialog(p: RationaleDialogProps) {
  const { me } = useAuth();
  const [rationale, setRationale] = useState(p.initialRationale ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<Element | null>(null);
  const onCloseRef = useRef(p.onClose);
  onCloseRef.current = p.onClose;

  useEffect(() => {
    trigger.current = document.activeElement;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Focus returns to the trigger on close (UX §6).
      (trigger.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const trimmed = rationale.trim();
  const rationaleReason = p.withoutRationale
    ? null
    : trimmed.length < MIN_RATIONALE_LENGTH
      ? `Rationale needs ${MIN_RATIONALE_LENGTH - trimmed.length} more character(s)`
      : null;
  const fieldReason = p.validate ? p.validate() : null;
  const reason = fieldReason ?? rationaleReason;

  const submit = async () => {
    if (reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await p.onSubmit(trimmed);
      p.onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="rationale-dialog-title">
        <h2 id="rationale-dialog-title">{p.title}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {p.children}
          {!p.withoutRationale && (
            <div className="field">
              <label htmlFor="rationale-input">
                {p.rationaleLabel ?? 'Rationale'}*{' '}
                <span className="hint">(min {MIN_RATIONALE_LENGTH} chars)</span>
              </label>
              <textarea
                id="rationale-input"
                data-testid="rationale-input"
                ref={first}
                className="textarea"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                required
                minLength={MIN_RATIONALE_LENGTH}
              />
              <div className="hint">
                {trimmed.length}/{MIN_RATIONALE_LENGTH} minimum
              </div>
            </div>
          )}
          {me && (
            <div className="actor-line">
              Recorded: {me.username} · {me.role_label}
              {p.contextLine ? ` · ${p.contextLine}` : ''}
            </div>
          )}
          {error && (
            <div className="error-text" role="alert" data-testid="dialog-error">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            {reason && <span className="btn-reason">{reason}</span>}
            <button type="button" className="btn" onClick={p.onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!!reason || busy}
              data-testid="dialog-submit"
            >
              {busy ? <span className="spinner" aria-hidden="true" /> : null} {p.submitLabel ?? 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
