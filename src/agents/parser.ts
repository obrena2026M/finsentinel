// Step 1 — deterministic document parsing (FR-INT-05, Architecture §5.1). No LLM.

export type ParsedChunk = { chunk_ix: number; heading: string | null; page: number | null; text: string };

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

const MAX_CHUNK_CHARS = 1800;

export async function parseDocument(buffer: Buffer, mime: string, filename: string): Promise<ParsedChunk[]> {
  let text: string;
  try {
    if (mime === 'application/pdf') text = await parsePdf(buffer);
    else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      text = await parseDocx(buffer);
    else if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      text = await parseXlsx(buffer);
    else if (mime.startsWith('text/')) text = buffer.toString('utf8');
    else throw new ParseError(`unsupported mime ${mime}`);
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError(`failed to parse ${filename}: ${(e as Error).message}`);
  }
  text = text.replace(/\r\n?/g, '\n').split('\u0000').join('').trim();
  if (text.length < 20) throw new ParseError(`no readable text in ${filename}`);
  return chunkText(text);
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const mod = (await import('pdf-parse')) as unknown as Record<string, unknown>;
  const PDFParse = (mod.PDFParse ?? (mod.default as Record<string, unknown> | undefined)?.PDFParse) as
    | (new (o: {
        data: Buffer;
      }) => { getText(): Promise<{ text: string }>; destroy?: () => Promise<void> })
    | undefined;
  if (PDFParse) {
    const p = new PDFParse({ data: buffer });
    try {
      const r = await p.getText();
      return r.text;
    } finally {
      await p.destroy?.();
    }
  }
  const fn = (mod.default ?? mod) as unknown as (b: Buffer) => Promise<{ text: string }>;
  if (typeof fn === 'function') return (await fn(buffer)).text;
  throw new ParseError('pdf-parse API not recognised');
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const r = await mammoth.extractRawText({ buffer });
  return r.value;
}

async function parseXlsx(buffer: Buffer): Promise<string> {
  // exceljs is CommonJS; under native ESM the namespace exposes the API on `default`.
  const mod = (await import('exceljs')) as unknown as {
    default?: typeof import('exceljs');
  } & typeof import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const lines: string[] = [];
  wb.eachSheet((ws) => {
    lines.push(`## Sheet: ${ws.name}`);
    ws.eachRow((row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        const s =
          v === null || v === undefined
            ? ''
            : typeof v === 'object' && 'richText' in (v as object)
              ? (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('')
              : typeof v === 'object' && 'result' in (v as object)
                ? String((v as { result: unknown }).result ?? '')
                : String(v);
        if (s.trim()) cells.push(s.trim());
      });
      if (cells.length) lines.push(`Row ${rowNumber}: ${cells.join(' | ')}`);
    });
  });
  return lines.join('\n');
}

const HEADING_RE =
  /^(#{1,4}\s+.+|\d+(\.\d+)*\.?\s+[A-Z][^\n]{2,80}|[A-Z][A-Z0-9 &/–-]{5,80}|Section\s+\d+[^\n]*)$/;

export function chunkText(text: string): ParsedChunk[] {
  const lines = text.split('\n');
  const sections: Array<{ heading: string | null; body: string[] }> = [{ heading: null, body: [] }];
  for (const line of lines) {
    const t = line.trim();
    if (t && HEADING_RE.test(t) && t.length <= 90) {
      sections.push({ heading: t.replace(/^#+\s*/, ''), body: [] });
    } else {
      sections[sections.length - 1]!.body.push(line);
    }
  }
  const chunks: ParsedChunk[] = [];
  for (const s of sections) {
    const body = s.body.join('\n').trim();
    if (!body && !s.heading) continue;
    const full = s.heading ? `${s.heading}\n${body}` : body;
    for (const piece of splitLong(full, MAX_CHUNK_CHARS)) {
      chunks.push({ chunk_ix: chunks.length, heading: s.heading, page: null, text: piece });
    }
  }
  if (chunks.length === 0)
    chunks.push({ chunk_ix: 0, heading: null, page: null, text: text.slice(0, MAX_CHUNK_CHARS) });
  return chunks;
}

function splitLong(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Whitespace/case-insensitive containment used by provenance and grounding checks. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”"'’`]/g, '')
    .replace(/[^a-z0-9%$.,;:()\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsNormalized(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  return n.length > 0 && normalize(haystack).includes(n);
}
