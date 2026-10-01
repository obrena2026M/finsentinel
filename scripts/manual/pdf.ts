// Renders a Markdown document (default: the STAGE04 user manual) to PDF with Playwright's Chromium.
// Pure JS: marked for Markdown → HTML, Chromium for HTML → PDF. No native tools, no Python.
//   node scripts/manual/pdf.ts                                  → documents/STAGE04_User_Manual.pdf
//   node scripts/manual/pdf.ts documents/Other.md [out.pdf]
// Relative image paths resolve against the Markdown file's directory, so documents/manual/** is picked up as is.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { marked } from 'marked';

const mdPath = resolve(process.argv[2] ?? 'documents/STAGE04_User_Manual.md');
const outPath = resolve(process.argv[3] ?? mdPath.replace(/\.md$/i, '.pdf'));
if (!existsSync(mdPath)) {
  console.error(`not found: ${mdPath}`);
  process.exit(1);
}

const markdown = readFileSync(mdPath, 'utf8');
const titleMatch = markdown.match(/^#\s+(.+)$/m);
const title = titleMatch?.[1]?.trim() ?? basename(mdPath, '.md');

marked.setOptions({ gfm: true, breaks: false });
const body = await marked.parse(markdown);

// Print stylesheet: A4, readable serif-free type, every level-2 section starts on a new page,
// screenshots never split across pages, tables and code stay compact.
const css = `
  :root { --ink: #0f172a; --muted: #475569; --line: #cbd5e1; --tint: #f1f5f9; --accent: #1d4ed8; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Inter, Helvetica, Arial, sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.45; }
  h1 { font-size: 24pt; margin: 0 0 6pt; letter-spacing: -0.01em; }
  h1 + p em { color: var(--muted); font-size: 11pt; }
  h2 { font-size: 16pt; margin: 0 0 10pt; padding-bottom: 4pt; border-bottom: 2px solid var(--accent); break-after: avoid; page-break-after: avoid; }
  h2:not(:first-of-type) { break-before: page; page-break-before: always; }
  h3 { font-size: 12.5pt; margin: 14pt 0 6pt; break-after: avoid; page-break-after: avoid; }
  p { margin: 0 0 7pt; orphans: 3; widows: 3; }
  blockquote { margin: 8pt 0 12pt; padding: 6pt 12pt; border-left: 4px solid var(--accent); background: var(--tint); color: var(--muted); font-style: italic; }
  blockquote p { margin: 0; }
  ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
  li { margin-bottom: 3pt; }
  code { font-family: Consolas, "Cascadia Mono", Menlo, monospace; font-size: 9pt; background: var(--tint); padding: 0 3pt; border-radius: 3px; }
  pre { background: #0f172a; color: #e2e8f0; padding: 8pt 10pt; border-radius: 6px; font-size: 8.8pt; line-height: 1.4; overflow-x: hidden; white-space: pre-wrap; word-break: break-word; break-inside: avoid; page-break-inside: avoid; }
  pre code { background: transparent; color: inherit; padding: 0; font-size: inherit; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt; font-size: 9pt; break-inside: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { border: 1px solid var(--line); padding: 4pt 6pt; vertical-align: top; text-align: left; }
  th { background: var(--tint); font-weight: 700; }
  td:first-child code, th:first-child code { white-space: nowrap; }
  img { display: block; max-width: 100%; max-height: 165mm; height: auto; margin: 10pt auto 4pt; border: 1px solid var(--line); border-radius: 6px; break-inside: avoid; page-break-inside: avoid; }
  img + em, p > em:only-child { display: block; color: var(--muted); font-size: 9.2pt; text-align: center; margin: 0 8mm 12pt; }
  p:has(> img) { break-inside: avoid; page-break-inside: avoid; margin-bottom: 2pt; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 12pt 0; }
  a { color: var(--accent); text-decoration: none; }
  .cover { margin-bottom: 14pt; }
  .cover .tag { display: inline-block; font-size: 9pt; color: var(--accent); background: #dbeafe; padding: 2pt 8pt; border-radius: 999px; margin-bottom: 8pt; }
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="${pathToFileURL(`${dirname(mdPath)}/`).href}">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${css}</style>
</head>
<body>
<div class="cover"><span class="tag">FinSentinel · synthetic data · simulation sign-in</span></div>
${body}
</body>
</html>`;

// Chromium will not load file:// images into an about:blank document, so the HTML is written next to the
// Markdown file (same relative image paths) and opened by URL, then removed.
const tmpHtml = resolve(dirname(mdPath), `.${basename(mdPath, '.md')}.render.html`);
writeFileSync(tmpHtml, html, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'load' });
  // Make sure every screenshot has finished decoding before printing.
  await page.evaluate(async () => {
    const imgs = Array.from(document.images);
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((done) => img.addEventListener('load', () => done(), { once: true })),
      ),
    );
    const broken = imgs.filter((i) => i.naturalWidth === 0).map((i) => i.getAttribute('src'));
    if (broken.length) throw new Error(`images failed to load: ${broken.join(', ')}`);
  });
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: false,
    margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' },
    displayHeaderFooter: true,
    headerTemplate: `<div style="width:100%;font-family:'Segoe UI',Arial,sans-serif;font-size:7.5pt;color:#64748b;padding:0 14mm;display:flex;justify-content:space-between;">
      <span>${title.replace(/</g, '&lt;')}</span><span>FinSentinel — Financial Crime Risk Assessment Workbench</span></div>`,
    footerTemplate: `<div style="width:100%;font-family:'Segoe UI',Arial,sans-serif;font-size:7.5pt;color:#64748b;padding:0 14mm;display:flex;justify-content:space-between;">
      <span>Synthetic data only · AI prepares. Rules calculate. Humans decide.</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  });
  writeFileSync(outPath, pdf);
  console.log(`wrote ${outPath} (${(pdf.length / 1024).toFixed(0)} KB)`);
} finally {
  await browser.close();
  rmSync(tmpHtml, { force: true });
}
