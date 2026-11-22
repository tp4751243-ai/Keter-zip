import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { ContentRole, ContentUnit } from '../src/types/typesetter';
import { DocxImporter } from '../src/engine/docx-importer';

// The importer is used in the browser in production. This deterministic DOM implementation
// lets CI run the exact importer against checked-in DOCX fixtures without launching a browser.
Object.assign(globalThis, {
  DOMParser,
  Node: { ELEMENT_NODE: 1 },
});

const fixtureExpectations: Array<{ fileName: string; expectedRole: ContentRole }> = [
  { fileName: 'גמרא קידושין.docx', expectedRole: 'main_source' },
  { fileName: 'רשי.docx', expectedRole: 'primary_comment' },
  { fileName: 'תוספות.docx', expectedRole: 'secondary_comment' },
];

const normalize = (value: string) =>
  value.normalize('NFC').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();

const tokenize = (value: string) => normalize(value).split(' ').filter(Boolean);

function textFromElement(element: Element): string {
  const textNodes = element.getElementsByTagName('w:t');
  let text = '';
  for (let i = 0; i < textNodes.length; i++) text += textNodes[i].textContent || '';
  return text.trim();
}

async function expectedDocumentSegments(data: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) throw new Error('Fixture is missing word/document.xml');
  const xml = await xmlFile.async('string');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const body = dom.getElementsByTagName('w:body')[0];
  if (!body) throw new Error('Fixture is missing w:body');

  const segments: string[] = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i] as Element;
    if (node.nodeType !== 1) continue;

    if (node.nodeName === 'w:p') {
      const text = textFromElement(node);
      if (text) segments.push(text);
      continue;
    }

    if (node.nodeName === 'w:tbl') {
      const rows = node.getElementsByTagName('w:tr');
      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].getElementsByTagName('w:tc');
        for (let c = 0; c < cells.length; c++) {
          segments.push(textFromElement(cells[c]));
        }
      }
    }
  }
  return segments;
}

function importedDocumentSegments(units: ContentUnit[]): string[] {
  const segments: string[] = [];
  for (const unit of units) {
    if (unit.role === 'footnote') continue;
    if (unit.role === 'table' && unit.tableData) {
      for (const row of unit.tableData.rows) {
        for (const cell of row.cells) segments.push(cell.content);
      }
    } else if (unit.rawText.trim()) {
      segments.push(unit.rawText);
    }
  }
  return segments;
}

function compareTokens(expectedSegments: string[], actualSegments: string[]) {
  const expected = expectedSegments.flatMap(tokenize);
  const actual = actualSegments.flatMap(tokenize);
  let mismatchIndex = -1;
  for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
    if (expected[i] !== actual[i]) {
      mismatchIndex = i;
      break;
    }
  }
  const exactSequence = expected.length === actual.length && mismatchIndex === -1;
  return {
    expectedWords: expected.length,
    actualWords: actual.length,
    exactSequence,
    firstMismatchIndex: mismatchIndex,
    expectedAroundMismatch: mismatchIndex >= 0
      ? expected.slice(Math.max(0, mismatchIndex - 4), mismatchIndex + 8)
      : [],
    actualAroundMismatch: mismatchIndex >= 0
      ? actual.slice(Math.max(0, mismatchIndex - 4), mismatchIndex + 8)
      : [],
  };
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

async function main() {
  const errors: string[] = [];
  const reports: Array<Record<string, unknown>> = [];
  const importedFiles: Array<{
    fileName: string;
    expectedRole: ContentRole;
    units: ContentUnit[];
  }> = [];

  for (const fixture of fixtureExpectations) {
    const filePath = join(process.cwd(), 'public', 'fixtures', fixture.fileName);
    const buffer = readFileSync(filePath);
    const data = toArrayBuffer(buffer);
    const result = await DocxImporter.importDocx(data, fixture.fileName);
    const expectedSegments = await expectedDocumentSegments(data);
    const actualSegments = importedDocumentSegments(result.units);
    const textComparison = compareTokens(expectedSegments, actualSegments);
    const ids = result.units.map(unit => unit.id);
    const uniqueIds = new Set(ids).size === ids.length;
    const runMismatches = result.units
      .filter(unit => unit.role !== 'table' && unit.textRuns?.length)
      .filter(unit => normalize(unit.textRuns!.map(run => run.text).join('')) !== normalize(unit.rawText))
      .map(unit => unit.id);
    const detectedRole = DocxImporter.autoDetectRole(fixture.fileName, '');

    if (!textComparison.exactSequence) {
      errors.push(`${fixture.fileName}: imported text sequence differs from DOCX XML.`);
    }
    if (!uniqueIds) errors.push(`${fixture.fileName}: duplicate unit IDs.`);
    if (runMismatches.length > 0) {
      errors.push(`${fixture.fileName}: TextRun/rawText mismatch in ${runMismatches.join(', ')}.`);
    }
    if (!result.validation.passed) {
      errors.push(`${fixture.fileName}: importer validation errors: ${result.validation.errors.join(' | ')}`);
    }
    if (detectedRole !== fixture.expectedRole) {
      errors.push(`${fixture.fileName}: expected file role ${fixture.expectedRole}, got ${detectedRole}.`);
    }

    reports.push({
      fileName: fixture.fileName,
      fileBytes: buffer.byteLength,
      detectedRole,
      expectedRole: fixture.expectedRole,
      units: result.units.length,
      roleCounts: result.units.reduce<Record<string, number>>((counts, unit) => {
        counts[unit.role] = (counts[unit.role] ?? 0) + 1;
        return counts;
      }, {}),
      links: result.links.length,
      validation: result.validation,
      metadata: result.metadata,
      textComparison,
      runMismatchCount: runMismatches.length,
      duplicateIds: !uniqueIds,
    });
    importedFiles.push({ fileName: fixture.fileName, expectedRole: fixture.expectedRole, units: result.units });
  }

  // Reproduce the multi-file role override and link-discovery flow used by DocxImportModal.
  const allUnits: ContentUnit[] = [];
  let order = 0;
  for (const imported of importedFiles) {
    for (const unit of imported.units) {
      order++;
      unit.order = order;
      if (imported.expectedRole !== 'main_source' && unit.role === 'main_source') {
        unit.role = imported.expectedRole;
        if (!unit.textRuns || !unit.textRuns.some(run => run.isBold || run.isDibbur)) {
          unit.textRuns = DocxImporter.buildRunsFromRawText(unit.rawText, unit.role, unit.dibburHamatchil);
        }
      }
      allUnits.push(unit);
    }
  }

  const sources = allUnits.filter(unit => unit.role === 'main_source' || unit.role === 'chapter');
  const commentaries = allUnits.filter(unit =>
    unit.role === 'primary_comment' || unit.role === 'secondary_comment'
  );
  const links = DocxImporter.autoLinkCommentariesToSource(sources, commentaries);
  const ids = new Set(allUnits.map(unit => unit.id));
  const brokenLinks = links.filter(link => !ids.has(link.sourceUnitId) || !ids.has(link.commentaryUnitId));
  if (brokenLinks.length > 0) errors.push(`Multi-file linking produced ${brokenLinks.length} broken references.`);
  if (commentaries.length > 0 && links.length === 0) {
    errors.push('Multi-file import found commentary units but discovered no source links.');
  }

  // Synthetic package exercises features absent from the checked-in text-only fixtures:
  // real DOCX footnote references, footnotes.xml, and table cells.
  const syntheticZip = new JSZip();
  syntheticZip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>טקסט עם הערה</w:t><w:footnoteReference w:id="2"/></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>א</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>ב</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>ג</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>ד</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`);
  syntheticZip.file('word/footnotes.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
  <w:footnote w:id="2"><w:p><w:r><w:t>הערת בדיקה</w:t></w:r></w:p></w:footnote>
</w:footnotes>`);
  const syntheticData = await syntheticZip.generateAsync({ type: 'arraybuffer' });
  const syntheticResult = await DocxImporter.importDocx(syntheticData, 'synthetic-table-footnote.docx');
  const syntheticExpected = await expectedDocumentSegments(syntheticData);
  const syntheticActual = importedDocumentSegments(syntheticResult.units);
  const syntheticTextComparison = compareTokens(syntheticExpected, syntheticActual);
  const syntheticFootnotes = syntheticResult.units.filter(unit => unit.role === 'footnote');
  const syntheticTable = syntheticResult.units.find(unit => unit.role === 'table');
  const syntheticSource = syntheticResult.units.find(unit => unit.role === 'main_source');
  const footnoteAnchorPreserved = Boolean(
    syntheticSource?.textRuns?.some(run =>
      run.footnoteUnitId === syntheticFootnotes[0]?.id &&
      run.footnoteAnchorWordIndex === 2
    ) &&
    syntheticFootnotes[0]?.footnoteAnchorUnitId === syntheticSource?.id &&
    syntheticFootnotes[0]?.parentId === syntheticSource?.id
  );
  const syntheticPassed =
    syntheticTextComparison.exactSequence &&
    syntheticResult.validation.passed &&
    syntheticResult.metadata.hasFootnotes &&
    syntheticResult.metadata.hasTables &&
    syntheticResult.metadata.totalParagraphs === 5 &&
    syntheticFootnotes.length === 1 &&
    Boolean(syntheticTable?.tableData?.rows.length === 2) &&
    Boolean(syntheticTable?.tableData?.rows.every((row: { cells: unknown[] }) => row.cells.length === 2)) &&
    footnoteAnchorPreserved;
  if (!syntheticTextComparison.exactSequence) {
    errors.push('Synthetic DOCX: source/table text sequence differs from XML.');
  }
  if (!syntheticResult.validation.passed) {
    errors.push(`Synthetic DOCX: validation errors: ${syntheticResult.validation.errors.join(' | ')}`);
  }
  if (syntheticResult.metadata.totalParagraphs !== 5) {
    errors.push(`Synthetic DOCX: expected 5 actual Word paragraphs including table cells, got ${syntheticResult.metadata.totalParagraphs}.`);
  }
  if (!syntheticResult.metadata.hasFootnotes || syntheticFootnotes.length !== 1 || !footnoteAnchorPreserved) {
    errors.push('Synthetic DOCX: footnote text or its exact source-word anchor was not preserved.');
  }
  if (!syntheticResult.metadata.hasTables || !syntheticTable?.tableData ||
      syntheticTable.tableData.rows.length !== 2 ||
      !syntheticTable.tableData.rows.every((row: { cells: unknown[] }) => row.cells.length === 2)) {
    errors.push('Synthetic DOCX: 2x2 table structure was not preserved.');
  }

  const syntheticReport = {
    fileName: 'synthetic-table-footnote.docx',
    passed: syntheticPassed,
    units: syntheticResult.units.length,
    totalParagraphs: syntheticResult.metadata.totalParagraphs,
    footnoteUnits: syntheticFootnotes.length,
    tableRows: syntheticTable?.tableData?.rows.length ?? 0,
    tableColumnsPerRow: syntheticTable?.tableData?.rows.map((row: { cells: unknown[] }) => row.cells.length) ?? [],
    footnoteAnchorPreserved,
    validation: syntheticResult.validation,
    textComparison: syntheticTextComparison,
  };

  const report = {
    allPassed: errors.length === 0,
    fixtureCount: reports.length,
    syntheticFeatureFixture: syntheticReport,
    combinedUnits: allUnits.length,
    sourceUnits: sources.length,
    commentaryUnits: commentaries.length,
    discoveredLinks: links.length,
    brokenLinks: brokenLinks.length,
    fixtures: reports,
    errors,
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(join('artifacts', 'docx-import-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

await main();
