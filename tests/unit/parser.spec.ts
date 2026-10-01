import { expect, test } from '@playwright/test';
import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  chunkText,
  containsNormalized,
  normalize,
  ParseError,
  parseDocument,
} from '../../src/agents/parser.ts';

// FR-INT-03/05: real binary parsers over generated fixtures (no network, pure JS).

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function makeDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Product Proposal: Merchant Cash Advance', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('The product offers short-term advances to existing commercial customers in Canada.'),
          new Paragraph({ text: '2. Channel', heading: HeadingLevel.HEADING_2 }),
          new Paragraph('Delivered through the branch channel with relationship manager approval.'),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function makeXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Questionnaire');
  ws.addRow(['Question', 'Answer']);
  ws.addRow(['Vendor name', 'PayRail Inc.']);
  ws.addRow(['Countries served', 'Canada, Mexico']);
  ws.addRow(['Monthly capacity', 500000]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

async function makePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([600, 400]);
  page.drawText('Process Change Memo', { x: 40, y: 350, size: 18, font });
  page.drawText('Exception handling for failed payouts will be a manual process for three months.', {
    x: 40,
    y: 300,
    size: 11,
    font,
  });
  page.drawText('The wire operations team owns the manual queue.', { x: 40, y: 280, size: 11, font });
  return Buffer.from(await pdf.save());
}

test.describe('document parser', () => {
  test('parses DOCX into heading-led chunks', async () => {
    const chunks = await parseDocument(await makeDocx(), DOCX, 'proposal.docx');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).toContain('Merchant Cash Advance');
    expect(all).toContain('branch channel');
  });

  test('parses XLSX rows into "Row n: a | b" lines', async () => {
    const chunks = await parseDocument(await makeXlsx(), XLSX, 'vendor.xlsx');
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).toContain('Sheet: Questionnaire');
    expect(all).toContain('Vendor name | PayRail Inc.');
    expect(all).toContain('500000');
  });

  test('parses PDF text', async () => {
    const chunks = await parseDocument(await makePdf(), 'application/pdf', 'memo.pdf');
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).toContain('manual process');
    expect(all).toContain('wire operations');
  });

  test('parses markdown/plain text', async () => {
    const chunks = await parseDocument(
      Buffer.from('# Title\n\nSome body text that is long enough to count.'),
      'text/markdown',
      'a.md',
    );
    expect(chunks[0]?.heading).toBe('Title');
  });

  test('rejects unsupported mime and unreadable content with ParseError (18.6)', async () => {
    await expect(parseDocument(Buffer.from('x'.repeat(50)), 'image/png', 'a.png')).rejects.toBeInstanceOf(
      ParseError,
    );
    await expect(parseDocument(Buffer.from('short'), 'text/plain', 'a.txt')).rejects.toThrow(
      /no readable text/,
    );
    await expect(
      parseDocument(Buffer.from('definitely not a zip archive at all, just text'), DOCX, 'bad.docx'),
    ).rejects.toBeInstanceOf(ParseError);
    await expect(
      parseDocument(Buffer.from('not a pdf'), 'application/pdf', 'bad.pdf'),
    ).rejects.toBeInstanceOf(ParseError);
  });

  test('chunkText splits long sections and keeps headings; falls back to a single chunk', () => {
    const longBody = Array.from(
      { length: 60 },
      (_, i) => `Sentence number ${i} about monitoring coverage and thresholds. `,
    ).join('');
    const chunks = chunkText(`## Section A\n${longBody}\n## Section B\nShort body.`);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]?.heading).toBe('Section A');
    expect(chunks.at(-1)?.heading).toBe('Section B');
    expect(chunks.every((c) => c.text.length <= 1800)).toBe(true);
    // No headings at all → one chunk, index 0.
    const plain = chunkText('just one plain paragraph without any heading structure at all');
    expect(plain).toHaveLength(1);
    expect(plain[0]?.chunk_ix).toBe(0);
  });

  test('normalize/containsNormalized ignore case, quotes and whitespace', () => {
    expect(normalize('  “Hello”,   World! ')).toBe('hello, world');
    expect(
      containsNormalized(
        'Mexico and Brazil are designated higher-risk jurisdictions',
        'mexico AND  brazil are designated',
      ),
    ).toBe(true);
    expect(containsNormalized('abc', '')).toBe(false);
  });
});
