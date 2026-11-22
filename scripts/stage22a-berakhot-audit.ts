import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { ContentUnit } from '../src/types/typesetter';
import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { PdfExporter } from '../src/engine/pdf-exporter';

// Use the same high-resolution Canvas shaping path in CI as the browser PDF export.
for (const [file, family] of [
  ['FrankRuhlLibre-Regular.ttf', 'Frank Ruhl Libre'],
  ['FrankRuhlLibre-Bold.ttf', 'Frank Ruhl Libre'],
  ['NotoRashiHebrew-Regular.ttf', 'Noto Rashi Hebrew'],
  ['NotoRashiHebrew-Bold.ttf', 'Noto Rashi Hebrew'],
  ['DavidLibre-Regular.ttf', 'David Libre'],
  ['DavidLibre-Bold.ttf', 'David Libre'],
] as const) {
  GlobalFonts.registerFromPath(resolve('public/fonts', file), family);
}
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`Unsupported element in PDF audit: ${tag}`);
    const canvas = createCanvas(1, 1) as any;
    canvas.setAttribute = () => {};
    return canvas;
  },
};

const geometry = {
  pageWidth: 482,
  pageHeight: 680,
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};

const streams = [
  { key: 'main_source', expectedRole: 'main_source' },
  { key: 'primary_comment', expectedRole: 'primary_comment' },
  { key: 'secondary_comment', expectedRole: 'secondary_comment' },
  { key: 'footnote', expectedRole: 'footnote' },
] as const;
const normalize = (value: string) => value.normalize('NFC').replace(/\u00ad/g, '');

function auditBerakhot(units: ContentUnit[], title: string, requireMultiplePages: boolean) {
  const doc = PaginationEngine.paginateDocument({
    title,
    layoutType: 'rav_text',
    units,
    geometry,
  });
  const streamReports = streams.map(stream => {
    const expected: string[] = [];
    for (const unit of units.filter(u =>
      stream.key === 'main_source'
        ? u.role === 'main_source' || u.role === 'chapter'
        : u.role === stream.expectedRole
    )) {
      expected.push(...unit.rawText.trim().split(/\s+/).filter(Boolean).map(normalize));
    }

    const actual: string[] = [];
    for (const page of doc.pages) {
      const lines = stream.key === 'main_source'
        ? page.sourceLines
        : stream.key === 'primary_comment'
          ? page.rashiLines
          : stream.key === 'secondary_comment'
            ? page.tosafotLines
            : page.footnoteLines;
      for (const line of lines) {
        for (const word of line.words) {
          if (!word.isSpace) actual.push(normalize(word.text));
        }
      }
    }

    const expectedCounts = new Map<string, number>();
    const actualCounts = new Map<string, number>();
    for (const word of expected) expectedCounts.set(word, (expectedCounts.get(word) ?? 0) + 1);
    for (const word of actual) actualCounts.set(word, (actualCounts.get(word) ?? 0) + 1);
    const missing = [...expectedCounts.entries()]
      .flatMap(([word, count]) => Array(Math.max(0, count - (actualCounts.get(word) ?? 0))).fill(word));
    const extra = [...actualCounts.entries()]
      .flatMap(([word, count]) => Array(Math.max(0, count - (expectedCounts.get(word) ?? 0))).fill(word));
    let firstOrderMismatch = -1;
    for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
      if (expected[i] !== actual[i]) { firstOrderMismatch = i; break; }
    }
    return {
      stream: stream.key,
      expectedWords: expected.length,
      actualWords: actual.length,
      exactSequence: expected.length === actual.length && firstOrderMismatch === -1,
      firstOrderMismatch,
      expectedAroundMismatch: firstOrderMismatch >= 0
        ? expected.slice(Math.max(0, firstOrderMismatch - 4), firstOrderMismatch + 8)
        : [],
      actualAroundMismatch: firstOrderMismatch >= 0
        ? actual.slice(Math.max(0, firstOrderMismatch - 4), firstOrderMismatch + 8)
        : [],
      missingSample: missing.slice(0, 12),
      extraSample: extra.slice(0, 12),
      multisetMatches: missing.length === 0 && extra.length === 0,
    };
  });

  const linkedUnits = units.filter(unit => Boolean(unit.linkedSourceId));
  const linksPreserved = linkedUnits.every(unit => (doc.links ?? []).some(link =>
    link.commentaryUnitId === unit.id && link.sourceUnitId === unit.linkedSourceId
  ));
  const collisionPages = doc.pages
    .map((page, index) => ({ page: index + 1, collisions: page.layoutScore?.collisionCount ?? 0 }))
    .filter(item => item.collisions > 0);
  const report = {
    title,
    pages: doc.pages.length,
    requiresMultiplePages: requireMultiplePages,
    inputUnits: units.length,
    sourceUnits: units.filter(u => u.role === 'main_source').length,
    rashiUnits: units.filter(u => u.role === 'primary_comment').length,
    tosafotUnits: units.filter(u => u.role === 'secondary_comment').length,
    footnoteUnits: units.filter(u => u.role === 'footnote').length,
    linkCount: (doc.links ?? []).length,
    linkedUnitsExpected: linkedUnits.length,
    linksPreserved,
    streamReports,
    collisionPages,
    preflightPassed: doc.preflightPassed,
    pageSummary: doc.pages.map((page, index) => ({
      page: index + 1,
      sourceLines: page.sourceLines.length,
      rashiLines: page.rashiLines.length,
      tosafotLines: page.tosafotLines.length,
      footnoteLines: page.footnoteLines.length,
      collisionCount: page.layoutScore?.collisionCount ?? 0,
      sourceBottom: Math.max(0, ...page.sourceLines.map(line => line.yBottom ?? line.yBaseline + line.descent)),
      rashiBottom: Math.max(0, ...page.rashiLines.map(line => line.yBottom ?? line.yBaseline + line.descent)),
      tosafotBottom: Math.max(0, ...page.tosafotLines.map(line => line.yBottom ?? line.yBaseline + line.descent)),
    })),
  };
  const passed = streamReports.every(stream => stream.exactSequence && stream.multisetMatches)
    && collisionPages.length === 0
    && (doc.links ?? []).length > 0
    && linksPreserved
    && doc.preflightPassed
    && doc.pages.length > 0
    && (!requireMultiplePages || doc.pages.length > 1);
  return { report, passed, doc };
}

const sample = DocxImporter.getSampleBerakhot();
const repeated = Array.from({ length: 3 }, (_, segment) => sample.map(unit => ({
  ...unit,
  id: `section-${segment + 1}-${unit.id}`,
  order: segment * 100 + unit.order,
  ...(unit.parentId ? { parentId: `section-${segment + 1}-${unit.parentId}` } : {}),
  ...(unit.linkedSourceId ? { linkedSourceId: `section-${segment + 1}-${unit.linkedSourceId}` } : {}),
}))).flat();

const sampleResult = auditBerakhot(sample, 'Stage 22A Berakhot sample', false);
const multipageResult = auditBerakhot(repeated, 'Stage 22A Berakhot three-section multipage stress', true);
const cases = [
  { passed: sampleResult.passed, ...sampleResult.report },
  { passed: multipageResult.passed, ...multipageResult.report },
];
mkdirSync('artifacts', { recursive: true });
const samplePdf = await PdfExporter.generateMultiPagePdf(sampleResult.doc);
writeFileSync(join('artifacts', 'berakhot-sample.pdf'), Buffer.from(await samplePdf.arrayBuffer()));
const stressPdf = await PdfExporter.generateMultiPagePdf(multipageResult.doc);
writeFileSync(join('artifacts', 'berakhot-multipage-stress.pdf'), Buffer.from(await stressPdf.arrayBuffer()));

const samplePdfContent = await PdfExporter.extractPdfContent(samplePdf);
const stressPdfContent = await PdfExporter.extractPdfContent(stressPdf);

// Verify the final PDF contains embedded TrueType font programs for its hidden selectable text layer,
// not merely a raster page image and Unicode text operators.
async function auditEmbeddedFonts(pdf: Blob) {
  const raw = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
  const fontFileReferences = [...raw.matchAll(/\/FontFile[23]?\s+\d+\s+\d+\s+R/g)].length;
  const toUnicodeReferences = [...raw.matchAll(/\/ToUnicode\s+\d+\s+\d+\s+R/g)].length;
  const baseFonts = [...raw.matchAll(/\/BaseFont\s*\/([^\s/<>()\[\]]+)/g)].map(match => match[1]);
  return {
    embeddedFontFileReferences: fontFileReferences,
    toUnicodeMapReferences: toUnicodeReferences,
    baseFonts: [...new Set(baseFonts)],
    hasEmbeddedTrueTypeFont: fontFileReferences > 0,
    hasUnicodeMaps: toUnicodeReferences > 0,
  };
}
const sampleFontAudit = await auditEmbeddedFonts(samplePdf);
const stressFontAudit = await auditEmbeddedFonts(stressPdf);
const pdfRenderAudit = {
  sample: {
    embeddedFontAudit: sampleFontAudit,
    expectedPages: sampleResult.doc.pages.length,
    actualPages: samplePdfContent.pageCount,
    noRasterizedPageImages: samplePdfContent.pages.every(page => !page.hasFullPageRasterImage),
    nativeVectorOperationsPresent: samplePdfContent.pages.every(page => page.vectorPathOpsCount > 0),
    searchableTextSpanCount: samplePdfContent.pages.reduce((sum, page) => sum + page.spans.length, 0),
    expectedHebrewTextExtracted: samplePdfContent.fullText.includes('מֵאֵימָתַי'),
  },
  stress: {
    embeddedFontAudit: stressFontAudit,
    expectedPages: multipageResult.doc.pages.length,
    actualPages: stressPdfContent.pageCount,
    noRasterizedPageImages: stressPdfContent.pages.every(page => !page.hasFullPageRasterImage),
    nativeVectorOperationsPresent: stressPdfContent.pages.every(page => page.vectorPathOpsCount > 0),
    searchableTextSpanCount: stressPdfContent.pages.reduce((sum, page) => sum + page.spans.length, 0),
    expectedHebrewTextExtracted: stressPdfContent.fullText.includes('מֵאֵימָתַי'),
  },
};
const pdfRenderPassed = [pdfRenderAudit.sample, pdfRenderAudit.stress].every(item =>
  item.expectedPages === item.actualPages &&
  item.embeddedFontAudit.hasEmbeddedTrueTypeFont &&
  item.embeddedFontAudit.hasUnicodeMaps &&
  item.noRasterizedPageImages &&
  item.nativeVectorOperationsPresent &&
  item.searchableTextSpanCount > 0 &&
  item.expectedHebrewTextExtracted
);
const report = {
  allPassed: sampleResult.passed && multipageResult.passed && pdfRenderPassed,
  pdfRenderPassed,
  pdfRenderAudit,
  cases,
};
writeFileSync(join('artifacts', 'berakhot-layout-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  ...report,
  generatedArtifacts: ['artifacts/berakhot-sample.pdf', 'artifacts/berakhot-multipage-stress.pdf', 'artifacts/berakhot-layout-audit.json'],
}, null, 2));
if (!sampleResult.passed || !multipageResult.passed || !pdfRenderPassed) process.exitCode = 1;
