import type { ReactNode } from 'react';

// Small shared bits: loading, inline error, disabled-with-reason button, JSON viewer.

export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <div className="muted row" role="status">
      <span className="spinner" aria-hidden="true" /> {what}…
    </div>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div className="error-text" role="alert">
      ✗ {error}
    </div>
  );
}

/** Primary button that always carries a reason when disabled (UX §6). */
export function ReasonButton({
  reason,
  children,
  onClick,
  testId,
  className = 'btn btn-primary',
  busy = false,
}: {
  reason: string | null;
  children: ReactNode;
  onClick: () => void;
  testId?: string;
  className?: string;
  busy?: boolean;
}) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <button
        type="button"
        className={className}
        disabled={!!reason || busy}
        onClick={onClick}
        data-testid={testId}
        title={reason ?? undefined}
      >
        {busy && <span className="spinner" aria-hidden="true" />} {children}
      </button>
      {reason && (
        <span className="btn-reason" data-testid={testId ? `${testId}-reason` : undefined}>
          {reason}
        </span>
      )}
    </span>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

export function Section({
  title,
  right,
  children,
  testId,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="card" data-testid={testId}>
      <div className="card-title">
        <h3>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}
