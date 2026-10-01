import type { ReactNode } from 'react';

// Quality Center / Ops tile: label, value, optional sub-line and status chip. Null → "No run yet" (FR-QC-05).

export type TileStatus = 'PASS' | 'FAIL' | 'NO_RUN' | 'WARN' | 'OK' | null;

export function statusChip(status: TileStatus, small = false) {
  if (!status) return null;
  const cls =
    status === 'PASS' || status === 'OK'
      ? 'chip-success'
      : status === 'FAIL'
        ? 'chip-danger'
        : status === 'WARN'
          ? 'chip-warning'
          : 'chip-neutral';
  const icon =
    status === 'PASS' || status === 'OK' ? '●' : status === 'FAIL' ? '✗' : status === 'WARN' ? '⚠' : '○';
  return (
    <span className={`chip ${cls} ${small ? '' : 'chip-lg'}`} data-status={status}>
      <span className="chip-icon" aria-hidden="true">
        {icon}
      </span>
      {status === 'NO_RUN' ? 'NO RUN' : status}
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  status,
  testId,
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  status?: TileStatus;
  testId?: string;
  children?: ReactNode;
}) {
  const isEmpty = value === null || value === undefined || value === '';
  return (
    <div className="stat-tile" data-testid={testId}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${typeof value === 'string' && value.length > 10 ? 'small-value' : ''}`}>
        {isEmpty ? <span className="muted">No run yet</span> : value}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
      {status && <div>{statusChip(status, true)}</div>}
      {children}
    </div>
  );
}
