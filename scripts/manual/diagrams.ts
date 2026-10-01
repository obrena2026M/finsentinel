// Generates the colourful workflow diagrams for the STAGE04 user manual as standalone SVG files.
// Pure Node, no dependencies. PNG renders are produced by tests/manual/capture.spec.ts (Chromium).
//   node scripts/manual/diagrams.ts
// Sources of truth: src/domain/workflow.ts (states, events), src/domain/rbac.ts (roles),
// Architecture §9.1 (workflow) and §7 (pipeline order). FR-WF-01..09, AD-05, AD-07.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'documents', 'manual', 'diagrams');
mkdirSync(OUT, { recursive: true });

// One accent per actor, with a light tint for lanes/backgrounds.
const ROLE = {
  owner: { name: 'Product Owner', accent: '#0F766E', tint: '#CCFBF1', ink: '#134E4A' },
  ai: { name: 'AI pipeline (LLM step)', accent: '#6D28D9', tint: '#EDE9FE', ink: '#3B0764' },
  analyst: { name: 'FCRM Analyst', accent: '#1D4ED8', tint: '#DBEAFE', ink: '#1E3A8A' },
  committee: { name: 'Risk Committee', accent: '#B45309', tint: '#FEF3C7', ink: '#78350F' },
  admin: { name: 'FCRM Admin', accent: '#BE123C', tint: '#FFE4E6', ink: '#881337' },
  rules: { name: 'Deterministic rules', accent: '#047857', tint: '#D1FAE5', ink: '#064E3B' },
} as const;
type RoleKey = keyof typeof ROLE;

const FONT = 'font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif"';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function defs(): string {
  const markers = (Object.keys(ROLE) as RoleKey[])
    .map(
      (k) =>
        `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${ROLE[k].accent}"/></marker>`,
    )
    .join('');
  return `<defs>${markers}<filter id="shadow" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0f172a" flood-opacity="0.18"/></filter></defs>`;
}

// Approximate glyph widths (px per character) for Segoe UI at the two sizes used in boxes.
const PX = { title: 8.3, sub: 6.4 } as const;

/** Split text into at most two lines so it fits `maxW`; a single line is returned when it already fits. */
function wrapText(text: string, maxW: number, pxPerChar: number): string[] {
  if (text.length * pxPerChar <= maxW) return [text];
  const words = text.split(' ');
  let best: [string, string] | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const widest = Math.max(a.length, b.length);
    if (!best || widest < Math.max(best[0].length, best[1].length)) best = [a, b];
  }
  return best ?? [text];
}

/** A text element that is compressed to `maxW` when the estimate says it would overflow, so nothing is clipped. */
function fitText(
  x: number,
  y: number,
  text: string,
  size: number,
  weight: number,
  fill: string,
  maxW: number,
  pxPerChar: number,
  opacity?: number,
): string {
  const fit = text.length * pxPerChar > maxW ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
  const op = opacity !== undefined ? ` opacity="${opacity}"` : '';
  return `<text x="${x}" y="${y}" text-anchor="middle" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}"${op}${fit}>${esc(text)}</text>`;
}

function box(
  x: number,
  y: number,
  w: number,
  h: number,
  role: RoleKey,
  heading: string,
  sub?: string,
  opts: { r?: number } = {},
): string {
  const c = ROLE[role];
  const r = opts.r ?? 14;
  const maxW = w - 20;
  // Title wraps only when there is no subtitle (otherwise it is fitted on one line); subtitles may wrap to two lines.
  const titleLines = sub ? [heading] : wrapText(heading, maxW, PX.title);
  const subLines = sub ? wrapText(sub, maxW, PX.sub) : [];
  const TITLE_LH = 18;
  const SUB_LH = 15;
  const total = titleLines.length * TITLE_LH + subLines.length * SUB_LH;
  let baseline = y + h / 2 - total / 2 + 13;
  let out = `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c.tint}" stroke="${c.accent}" stroke-width="2.5"/></g>`;
  for (const line of titleLines) {
    out += fitText(x + w / 2, baseline, line, 15, 700, c.ink, maxW, PX.title);
    baseline += TITLE_LH;
  }
  baseline -= 3;
  for (const line of subLines) {
    out += fitText(x + w / 2, baseline, line, 12, 400, c.ink, maxW, PX.sub, 0.85);
    baseline += SUB_LH;
  }
  return out;
}

function arrow(
  points: [number, number][],
  role: RoleKey,
  label?: string,
  labelDy = -8,
  dashed = false,
): string {
  const c = ROLE[role];
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
  const mi = Math.floor((points.length - 1) / 2);
  const mid = points[mi] ?? [0, 0];
  const next = points[mi + 1] ?? mid;
  const lx = (mid[0] + next[0]) / 2;
  const ly = (mid[1] + next[1]) / 2 + labelDy;
  const half = label ? label.length * 3.4 + 6 : 0;
  return (
    `<path d="${d}" fill="none" stroke="${c.accent}" stroke-width="2.5" ${dashed ? 'stroke-dasharray="7 5"' : ''} marker-end="url(#arrow-${role})"/>` +
    (label
      ? `<rect x="${lx - half}" y="${ly - 12}" width="${half * 2}" height="18" rx="9" fill="#ffffff" stroke="${c.accent}" stroke-width="1"/>` +
        `<text x="${lx}" y="${ly + 1}" text-anchor="middle" ${FONT} font-size="11.5" font-weight="600" fill="${c.ink}">${esc(label)}</text>`
      : '')
  );
}

function title(x: number, y: number, text: string, sub: string): string {
  return (
    `<text x="${x}" y="${y}" ${FONT} font-size="24" font-weight="800" fill="#0f172a">${esc(text)}</text>` +
    `<text x="${x}" y="${y + 22}" ${FONT} font-size="13" fill="#475569">${esc(sub)}</text>`
  );
}

function legend(x: number, y: number, keys: RoleKey[]): string {
  return keys
    .map((k, i) => {
      const c = ROLE[k];
      const lx = x + i * 210;
      return `<rect x="${lx}" y="${y}" width="18" height="18" rx="5" fill="${c.tint}" stroke="${c.accent}" stroke-width="2"/><text x="${lx + 26}" y="${y + 14}" ${FONT} font-size="13" fill="#334155">${esc(c.name)}</text>`;
    })
    .join('');
}

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs()}<rect width="${w}" height="${h}" fill="#F8FAFC"/>${body}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Diagram 1 — Case lifecycle across roles (swimlanes). States from src/domain/workflow.ts.
// ---------------------------------------------------------------------------------------------
function caseLifecycle(): string {
  const W = 1400;
  const H = 780;
  const laneX = 40;
  const laneW = W - 80;
  const lanes: { role: RoleKey; y: number; h: number }[] = [
    { role: 'owner', y: 110, h: 140 },
    { role: 'ai', y: 260, h: 130 },
    { role: 'analyst', y: 400, h: 150 },
    { role: 'committee', y: 560, h: 150 },
  ];
  let b = title(
    40,
    48,
    'FinSentinel — case lifecycle by role',
    'States and transitions from the workflow state machine (FR-WF-01..09). AI prepares. Rules calculate. Humans decide.',
  );
  for (const l of lanes) {
    const c = ROLE[l.role];
    b += `<rect x="${laneX}" y="${l.y}" width="${laneW}" height="${l.h}" rx="16" fill="${c.tint}" opacity="0.45"/>`;
    b += `<rect x="${laneX}" y="${l.y}" width="150" height="${l.h}" rx="16" fill="${c.accent}"/>`;
    b += `<text x="${laneX + 75}" y="${l.y + l.h / 2 + 5}" text-anchor="middle" ${FONT} font-size="15" font-weight="700" fill="#ffffff">${esc(c.name.split(' (')[0] ?? c.name)}</text>`;
  }
  const bw = 190;
  const bh = 64;
  // Owner lane
  b += box(240, 148, bw, bh, 'owner', 'SUBMITTED', 'New case + documents');
  b += box(1040, 148, 270, bh, 'owner', 'INFO_REQUESTED', 'Owner answers, or analyst accepts the gap');
  // AI lane
  b += box(240, 293, bw, bh, 'ai', 'ASSESSMENT', 'Pipeline: parse → … → packet');
  b += box(520, 293, 250, bh, 'ai', 'LLM step failed?', 'Case stays in ASSESSMENT — never advances', {
    r: 32,
  });
  // Analyst lane
  b += box(240, 443, bw, bh, 'analyst', 'ANALYST_REVIEW', 'Clear blockers, challenge, override');
  b += box(
    520,
    443,
    250,
    bh,
    'analyst',
    'Finalize guard',
    'No unsupported claims, contradictions, open requests',
    { r: 32 },
  );
  // Committee lane
  b += box(240, 603, bw, bh, 'committee', 'COMMITTEE_REVIEW', 'Packet, evidence, overrides');
  b += box(660, 603, bw, bh, 'committee', 'DECIDED', 'Approve · with conditions · Reject');
  b += box(1060, 603, bw, bh, 'committee', 'CLOSED', 'Read-only, audit chain verified');

  // Owner → AI → Analyst
  b += arrow(
    [
      [335, 212],
      [335, 293],
    ],
    'owner',
    'start_pipeline',
    0,
  );
  b += arrow(
    [
      [335, 357],
      [335, 443],
    ],
    'ai',
    'pipeline_done',
    0,
  );
  b += arrow(
    [
      [430, 325],
      [520, 325],
    ],
    'ai',
    undefined,
    0,
    true,
  );
  b += arrow(
    [
      [645, 357],
      [645, 415],
      [460, 415],
      [460, 443],
    ],
    'analyst',
    'manual_continue',
    -6,
  );
  // Analyst → finalize guard → committee
  b += arrow(
    [
      [430, 475],
      [520, 475],
    ],
    'analyst',
  );
  b += arrow(
    [
      [645, 507],
      [645, 575],
      [335, 575],
      [335, 603],
    ],
    'analyst',
    'finalize (guard passed)',
    -6,
  );
  // request_info: analyst → INFO_REQUESTED; info_provided back to analyst
  b += arrow(
    [
      [335, 443],
      [335, 425],
      [1100, 425],
      [1100, 212],
    ],
    'analyst',
    'request_info',
    -6,
  );
  b += arrow(
    [
      [1250, 212],
      [1250, 475],
      [770, 475],
    ],
    'owner',
    'info_provided / accept_gap',
    -6,
  );
  // Committee
  b += arrow(
    [
      [430, 635],
      [660, 635],
    ],
    'committee',
    'approve · reject',
    -12,
  );
  b += arrow(
    [
      [850, 635],
      [1060, 635],
    ],
    'committee',
    'close',
    -12,
  );
  b += arrow(
    [
      [335, 667],
      [335, 715],
      [950, 715],
      [950, 540],
      [770, 540],
      [770, 520],
      [430, 520],
      [430, 507],
    ],
    'committee',
    'defer → back to ANALYST_REVIEW',
    -6,
    true,
  );
  b += legend(240, 745, ['owner', 'ai', 'analyst', 'committee']);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------------------------
// Diagram 2 — AI pipeline: fixed order, deterministic vs LLM steps (Architecture §7, AD-05).
// ---------------------------------------------------------------------------------------------
function pipeline(): string {
  const steps: { label: string; kind: RoleKey; sub: string }[] = [
    { label: 'Parse', kind: 'rules', sub: 'PDF / DOCX / XLSX → text' },
    { label: 'Extract', kind: 'ai', sub: 'Facts with sources' },
    { label: 'Contradictions', kind: 'ai', sub: 'Merge; rules first, LLM assists' },
    { label: 'Missing info', kind: 'rules', sub: 'Required fields → requests' },
    { label: 'Scope', kind: 'ai', sub: 'Which dimensions apply' },
    { label: 'Retrieve', kind: 'rules', sub: 'FTS5 over policy library' },
    { label: 'Assess', kind: 'ai', sub: 'Claims cite evidence' },
    { label: 'Ground', kind: 'rules', sub: 'Quote must exist in chunk' },
    { label: 'Score', kind: 'rules', sub: 'Inherent → residual ≥ floor' },
    { label: 'Packet', kind: 'rules', sub: 'Decision packet assembled' },
  ];
  const W = 1400;
  const H = 430;
  let b = title(
    40,
    48,
    'FinSentinel — AI assessment pipeline',
    'Code-orchestrated, fixed order, not an agent loop (AD-05). Every step is persisted; a failed LLM step never advances or decides.',
  );
  const bw = 122;
  const gap = 12;
  const x0 = 40;
  const y = 150;
  steps.forEach((s, i) => {
    const x = x0 + i * (bw + gap);
    b += box(x, y, bw, 84, s.kind, s.label, s.sub);
    b += `<text x="${x + bw / 2}" y="${y - 12}" text-anchor="middle" ${FONT} font-size="12" font-weight="700" fill="#64748B">${i + 1}</text>`;
    if (i < steps.length - 1)
      b += arrow(
        [
          [x + bw, y + 42],
          [x + bw + gap, y + 42],
        ],
        s.kind,
      );
  });
  // Human gates and invariants below
  b += box(40, 290, 400, 64, 'analyst', 'Analyst review gate', 'Blockers must be cleared before finalize', {
    r: 32,
  });
  b += box(
    500,
    290,
    400,
    64,
    'committee',
    'Committee decision gate',
    'Only a committee actor can write a decision',
    { r: 32 },
  );
  b += box(
    960,
    290,
    400,
    64,
    'rules',
    'Invariants',
    'Residual ≤ inherent · claims cite quotes · audit append-only',
    { r: 32 },
  );
  b += arrow(
    [
      [1307, 234],
      [1307, 262],
      [240, 262],
      [240, 290],
    ],
    'analyst',
    'packet ready',
    -6,
  );
  b += legend(40, 395, ['ai', 'rules', 'analyst', 'committee']);
  return svg(W, H, b);
}

// ---------------------------------------------------------------------------------------------
// Diagram 3 — Journey per role (what each user does, in order).
// ---------------------------------------------------------------------------------------------
function journeys(): string {
  const rows: { role: RoleKey; steps: string[] }[] = [
    {
      role: 'owner',
      steps: [
        'Sign in as Pat Owner',
        'New case: title, type, description',
        'Upload or use sample documents',
        'Run AI review',
        'Answer information requests',
        'Follow the decision',
      ],
    },
    {
      role: 'analyst',
      steps: [
        'Sign in as Kim Analyst',
        'Open case, read blockers',
        'Confirm facts, resolve contradictions',
        'Check claims & evidence',
        'Set controls, override with rationale',
        'Finalize → committee',
      ],
    },
    {
      role: 'committee',
      steps: [
        'Sign in as Lee Committee',
        'Open the Committee tab',
        'Review packet, overrides, history',
        'Verify the audit chain',
        'Decide with rationale (+ conditions)',
        'Close the case',
      ],
    },
    {
      role: 'admin',
      steps: [
        'Sign in as Raj Admin',
        'Quality Center: gate status',
        'Run an adversarial test live',
        'Ops: health, throughput, tokens',
        'Edit risk model weights',
        'Publish a new model version',
      ],
    },
  ];
  const W = 1400;
  const H = 570;
  let b = title(
    40,
    48,
    'FinSentinel — journey per role',
    'Each row is a role in simulation sign-in. Actions a role cannot perform are absent from its screens, not greyed out (UX §7).',
  );
  const x0 = 220;
  const bw = 178;
  const gap = 14;
  rows.forEach((r, ri) => {
    const y = 110 + ri * 105;
    const c = ROLE[r.role];
    b += `<rect x="40" y="${y}" width="${W - 80}" height="88" rx="16" fill="${c.tint}" opacity="0.45"/>`;
    b += `<rect x="40" y="${y}" width="160" height="88" rx="16" fill="${c.accent}"/>`;
    b += `<text x="120" y="${y + 49}" text-anchor="middle" ${FONT} font-size="15" font-weight="700" fill="#ffffff">${esc(c.name)}</text>`;
    r.steps.forEach((s, i) => {
      const x = x0 + i * (bw + gap);
      const [head, ...rest] = s.split(':');
      b += box(
        x,
        y + 14,
        bw,
        60,
        r.role,
        `${i + 1}. ${head}`,
        rest.length ? rest.join(':').trim() : undefined,
      );
      if (i < r.steps.length - 1)
        b += arrow(
          [
            [x + bw, y + 44],
            [x + bw + gap, y + 44],
          ],
          r.role,
        );
    });
  });
  b += legend(220, 540, ['owner', 'analyst', 'committee', 'admin']);
  return svg(W, H, b);
}

const files: Record<string, string> = {
  'case-lifecycle.svg': caseLifecycle(),
  'pipeline.svg': pipeline(),
  'role-journeys.svg': journeys(),
};
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(OUT, name), content, 'utf8');
  console.log('wrote', join('documents', 'manual', 'diagrams', name));
}
