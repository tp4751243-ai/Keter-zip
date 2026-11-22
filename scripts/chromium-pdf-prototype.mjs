import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve(process.env.KETER_RENDER_PLAN ?? 'artifacts/keter-page-render-plan.json');
const output = process.env.PDF_OUT ?? 'artifacts/chromium-keter-page.pdf';
const fontDir = resolve(process.cwd(), 'public/fonts');
const [fixtureText, frankRegular, frankBold, davidRegular] = await Promise.all([
  readFile(input, 'utf8'),
  readFile(resolve(fontDir, 'FrankRuhlLibre-Regular.ttf')),
  readFile(resolve(fontDir, 'FrankRuhlLibre-Bold.ttf')),
  readFile(resolve(fontDir, 'DavidLibre-Regular.ttf')),
]);
const fixture = JSON.parse(fixtureText);
const { geometry } = fixture;
const fontData = {
  frankRegular: frankRegular.toString('base64'),
  frankBold: frankBold.toString('base64'),
  davidRegular: davidRegular.toString('base64'),
};

const esc = value => String(value).replace(/[&<>"]/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[ch]));
const fontFamily = name => {
  const n = (name || '').toLowerCase();
  // This value is inserted into a double-quoted HTML style attribute.
  // Escape the CSS quotes as HTML entities so the attribute remains valid;
  // the browser decodes them before parsing the CSS declaration.
  if (n.includes('david')) return '&quot;Keter David Libre&quot;';
  if (n.includes('rashi') || n.includes('noto')) return '&quot;Keter Frank Ruhl&quot;';
  return '&quot;Keter Frank Ruhl&quot;';
};
const runs = fixture.plan.lines.flatMap(line => line.words.map(word => {
  const right = geometry.pageWidth - word.xRight;
  const color = word.textColor || line.textColor || '#111';
  const weight = word.fontWeight || line.baseFontWeight || 400;
  // The line/word coordinates and solved word widths are taken verbatim from
  // Keter's render plan. CSS only converts the baseline to a glyph top offset.
  return '<span class="word" data-role="' + esc(word.role) + '" ' +
    'style="right:' + right + 'pt;top:' + word.yBaseline + 'pt;width:' + word.width +
    'pt;font-family:' + fontFamily(word.fontFamily || line.fontFamily) +
    ';font-size:' + word.fontSizePt + 'pt;font-weight:' + weight +
    ';color:' + esc(color) + ';transform:translateY(-0.82em)">' +
    esc(word.text) + '</span>';
})).join('\n');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<style>
@font-face { font-family:"Keter Frank Ruhl"; src:url(data:font/ttf;base64,${fontData.frankRegular}) format("truetype"); font-weight:400; }
@font-face { font-family:"Keter Frank Ruhl"; src:url(data:font/ttf;base64,${fontData.frankBold}) format("truetype"); font-weight:600 900; }
@font-face { font-family:"Keter David Libre"; src:url(data:font/ttf;base64,${fontData.davidRegular}) format("truetype"); font-weight:400; }
@page { size:${geometry.pageWidth}pt ${geometry.pageHeight}pt; margin:0; }
* { box-sizing:border-box; }
html,body { margin:0;padding:0;width:${geometry.pageWidth}pt;height:${geometry.pageHeight}pt;background:white; }
.page { position:relative;width:${geometry.pageWidth}pt;height:${geometry.pageHeight}pt;overflow:hidden;background:white;color:#111; }
.word { position:absolute;display:block;white-space:pre;direction:rtl;unicode-bidi:isolate;text-align:right;line-height:1;overflow:visible; }
</style></head><body><div class="page">${runs}</div></body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const fontAudit = await page.evaluate(async () => {
    // document.fonts.check() can return false for a valid @font-face that has not
    // yet been used by any glyph on this page. Explicitly request each bundled face
    // so the audit verifies the actual font resources, not merely whether the fixture
    // happened to contain a word using that family.
    const requests = await Promise.all([
      document.fonts.load('400 14pt "Keter Frank Ruhl"', 'שלום'),
      document.fonts.load('700 14pt "Keter Frank Ruhl"', 'שלום'),
      document.fonts.load('400 10pt "Keter David Libre"', 'שלום'),
    ]);
    await document.fonts.ready;
    return {
      status: document.fonts.status,
      frankRegularLoaded: requests[0].length > 0 && document.fonts.check('400 14pt "Keter Frank Ruhl"', 'שלום'),
      frankBoldLoaded: requests[1].length > 0 && document.fonts.check('700 14pt "Keter Frank Ruhl"', 'שלום'),
      davidLoaded: requests[2].length > 0 && document.fonts.check('400 10pt "Keter David Libre"', 'שלום'),
    };
  });
  if (!fontAudit.frankRegularLoaded || !fontAudit.frankBoldLoaded || !fontAudit.davidLoaded) {
    throw new Error('Bundled Keter font failed to load: ' + JSON.stringify(fontAudit));
  }
  await page.pdf({ path: output, preferCSSPageSize: true, printBackground: true, tagged: true });

  // Controlled extraction fixture: isolate Chromium's PDF text mapping from
  // the production page's absolute word positioning. Keep the strings in ordinary
  // visible DOM text and emit both tagged and untagged PDFs for comparison.
  const diagnosticOutput = process.env.PDF_TEXT_DIAGNOSTIC_OUT ?? 'artifacts/chromium-hebrew-text-diagnostic.pdf';
  const diagnosticUntaggedOutput = process.env.PDF_TEXT_DIAGNOSTIC_UNTAGGED_OUT ?? 'artifacts/chromium-hebrew-text-diagnostic-untagged.pdf';
  const diagnosticWords = ['מֵאֵימָתַי', 'מִשָּׁעָה', 'שְׁמַע', 'בְּרָכוֹת'];
  const diagnosticHtml = diagnosticWords.map((word, index) =>
    '<div class="case"><div class="label">case ' + (index + 1) + '</div>' +
    '<span class="plain" style="top:28pt">' + esc(word) + '</span></div>'
  ).join('');
  await page.setContent(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
    @font-face { font-family:"Keter Frank Ruhl"; src:url(data:font/ttf;base64,${fontData.frankRegular}) format("truetype"); font-weight:400; }
    @page { size:482pt 340pt; margin:0; }
    * { box-sizing:border-box; }
    html,body { margin:0;padding:0;width:482pt;height:340pt;font-family:"Keter Frank Ruhl";font-size:18pt;color:#111; }
    .case { position:relative;width:482pt;height:76pt; }
    .label { position:absolute;left:8pt;top:5pt;font:8pt sans-serif;direction:ltr; }
    .plain { position:absolute;right:8pt;width:466pt;display:block;direction:rtl;unicode-bidi:isolate;text-align:right;white-space:pre;line-height:1;transform:translateY(-0.82em); }
  </style></head><body>${diagnosticHtml}</body></html>`, { waitUntil: 'load' });
  const diagnosticAudit = await page.evaluate(async () => {
    const font = await document.fonts.load('400 18pt "Keter Frank Ruhl"', 'מֵאֵימָתַי');
    await document.fonts.ready;
    return {
      fontLoaded: font.length > 0 && document.fonts.check('400 18pt "Keter Frank Ruhl"', 'מֵאֵימָתַי'),
      rows: [...document.querySelectorAll('.plain')].map(el => ({
        text: el.textContent,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        top: el.getBoundingClientRect().top,
      })),
    };
  });
  if (!diagnosticAudit.fontLoaded || diagnosticAudit.rows.length !== diagnosticWords.length ||
      diagnosticAudit.rows.some((row, index) => row.text !== diagnosticWords[index] || row.width <= 0 || row.height <= 0 || row.top < 0 || row.top > 340)) {
    throw new Error('Controlled Hebrew text fixture did not render as expected: ' + JSON.stringify(diagnosticAudit));
  }
  await page.pdf({ path: diagnosticOutput, preferCSSPageSize: true, printBackground: true, tagged: true });
  await page.pdf({ path: diagnosticUntaggedOutput, preferCSSPageSize: true, printBackground: true, tagged: false });
  console.log(JSON.stringify({ diagnosticOutput, diagnosticUntaggedOutput, diagnosticCases: diagnosticWords, diagnosticAudit }, null, 2));

  console.log(JSON.stringify({
    output,
    source: fixture.source,
    pageNumber: fixture.pageNumber,
    lineCount: fixture.plan.lines.length,
    wordCount: fixture.plan.lines.reduce((n, line) => n + line.words.length, 0),
    fontAudit,
  }, null, 2));
} finally {
  await browser.close();
}
