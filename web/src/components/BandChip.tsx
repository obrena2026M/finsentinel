// Five-band chip (Very Low … Very High). Icon + text always accompany colour.

const ICONS: Record<string, string> = {
  'very low': '●',
  low: '●',
  moderate: '●',
  high: '●',
  'very high': '●',
};

const LEVEL: Record<string, string> = {
  'very low': '1/5',
  low: '2/5',
  moderate: '3/5',
  high: '4/5',
  'very high': '5/5',
};

export function bandClass(band: string | null | undefined): string {
  if (!band) return 'chip-neutral';
  return `band-${band.toLowerCase().replace(/\s+/g, '-')}`;
}

export function BandChip({
  band,
  large = false,
  showLevel = false,
}: {
  band: string | null | undefined;
  large?: boolean;
  showLevel?: boolean;
}) {
  if (!band) {
    return (
      <span className={`chip chip-neutral ${large ? 'chip-lg' : ''}`}>
        <span className="chip-icon" aria-hidden="true">
          ○
        </span>
        No score
      </span>
    );
  }
  const key = band.toLowerCase();
  return (
    <span className={`chip ${bandClass(band)} ${large ? 'chip-lg' : ''}`} data-band={band}>
      <span className="chip-icon" aria-hidden="true">
        {ICONS[key] ?? '●'}
      </span>
      {band}
      {showLevel && LEVEL[key] && <span className="small">({LEVEL[key]})</span>}
    </span>
  );
}
