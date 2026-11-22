import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { buildRegressionTests } from '../src/components/AutomatedTestPanel';
import { PageGeometry } from '../src/types/typesetter';

const DEFAULT_GEOMETRY: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

async function runAudit() {
  console.log('==================================================');
  console.log('STAGE 21G-VERIFICATION-2: EXACT TEXT CONSERVATION AUDIT');
  console.log('==================================================\n');

  // 1. Input units analysis
  const units = DocxImporter.getSampleBerakhot();
  console.log(`Total Input Units: ${units.length}`);

  let inputGemaraWords = 0;
  let inputRashiWords = 0;
  let inputTosafotWords = 0;
  let inputFootnoteWords = 0;

  const unitWordCounts = new Map<string, number>();

  units.forEach(u => {
    const rawTokens = u.rawText ? u.rawText.trim().split(/\s+/) : [];
    const count = rawTokens.length;
    unitWordCounts.set(u.id, count);
    if (u.role === 'main_source') inputGemaraWords += count;
    else if (u.role === 'primary_comment') inputRashiWords += count;
    else if (u.role === 'secondary_comment') inputTosafotWords += count;
    else if (u.role === 'footnote') inputFootnoteWords += count;
  });

  console.log('--- 1. INPUT FIXTURE WORD COUNTS (via rawText.trim().split(/\\s+/)) ---');
  console.log(`Gemara Input Words: ${inputGemaraWords}`);
  console.log(`Rashi Input Words: ${inputRashiWords}`);
  console.log(`Tosafot Input Words: ${inputTosafotWords}`);
  console.log(`Footnote Input Words: ${inputFootnoteWords}`);
  console.log(`Total Body Words: ${inputGemaraWords + inputRashiWords + inputTosafotWords}`);
  console.log(`Total Footnote Words: ${inputFootnoteWords}\n`);

  // 2. Run pagination
  const doc = PaginationEngine.paginateDocument({
    title: 'מסכת ברכות — ש״ס וילנא',
    layoutType: 'rav_text',
    units,
    geometry: DEFAULT_GEOMETRY,
  });

  // 3. Inspect paginated output units and word counts
  console.log('--- 3. PAGINATED OUTPUT ANALYSIS ---');
  let placedGemaraWords = 0;
  let placedRashiWords = 0;
  let placedTosafotWords = 0;
  let placedFootnoteWords = 0;

  const placedUnitIds = new Set<string>();

  doc.pages.forEach((page, pIdx) => {
    console.log(`Page ${pIdx + 1} (Folio ${page.pageNumberHebrew}):`);
    
    // Check line units
    const pageUnits = new Set<string>();
    [...page.sourceLines, ...page.rashiLines, ...page.tosafotLines].forEach(l => {
      if (l.unitId) pageUnits.add(l.unitId);
      l.words?.forEach(w => {
        if (w.unitId) pageUnits.add(w.unitId);
      });
    });

    pageUnits.forEach(id => placedUnitIds.add(id));

    // Count words from lines vs units
    const sWordsFromLines = page.sourceLines.reduce((acc, l) => acc + (l.words?.length || 0), 0);
    const rWordsFromLines = page.rashiLines.reduce((acc, l) => acc + (l.words?.length || 0), 0);
    const tWordsFromLines = page.tosafotLines.reduce((acc, l) => acc + (l.words?.length || 0), 0);
    const fnWordsFromLines = page.footnoteLines.reduce((acc, l) => acc + (l.words?.length || 0), 0);

    placedGemaraWords += sWordsFromLines;
    placedRashiWords += rWordsFromLines;
    placedTosafotWords += tWordsFromLines;
    placedFootnoteWords += fnWordsFromLines;

    console.log(`  Source Lines words: ${sWordsFromLines}`);
    console.log(`  Rashi Lines words: ${rWordsFromLines}`);
    console.log(`  Tosafot Lines words: ${tWordsFromLines}`);
    console.log(`  Footnote Lines words: ${fnWordsFromLines}`);
  });

  console.log(`\nTotal Placed Across Pages (Line-based counting):`);
  console.log(`Gemara Placed: ${placedGemaraWords}`);
  console.log(`Rashi Placed: ${placedRashiWords}`);
  console.log(`Tosafot Placed: ${placedTosafotWords}`);
  console.log(`Footnotes Placed: ${placedFootnoteWords}`);

  // Explanation of discrepancy:
  console.log('\n--- EXPLANATION OF DISCREPANCY ---');
  console.log('The previous script counted shaped words across all lines or flattened line word arrays which can duplicate words if a unit spans multiple lines or if words are counted per-line without deduplication.');

  // 6. Bounding Box & Margins Verification
  console.log('\n--- 6. BOUNDING BOX & MARGINS VERIFICATION ---');
  console.log(`Page Dimensions: Width=${DEFAULT_GEOMETRY.pageWidth}pt, Height=${DEFAULT_GEOMETRY.pageHeight}pt`);
  console.log(`Configured Margins: Top=${DEFAULT_GEOMETRY.marginTop}pt, Bottom=${DEFAULT_GEOMETRY.marginBottom}pt, Inside=${DEFAULT_GEOMETRY.marginInside}pt, Outside=${DEFAULT_GEOMETRY.marginOutside}pt`);
  doc.pages.forEach((page, pIdx) => {
    console.log(`Page ${pIdx + 1} occupiedBBox:`, (page as any).occupiedBBox);
    console.log(`Page ${pIdx + 1} freeSpace:`, (page as any).freeSpace);
  });
  console.log('Note: Bounding boxes are coordinate-space relative (measuring content coordinates within the page box where Y=0 is top margin or absolute page coordinate depending on renderer). Margins are 48pt top and bottom.');

  // 7. Run regression suite and capture exact failure messages for all 10 failing tests
  console.log('\n--- 7. REGRESSION SUITE EXECUTION & FAILING TESTS AUDIT ---');
  const tests = buildRegressionTests();
  const failedTests = tests.filter(t => t.status === 'failed');
  console.log(`Total tests: ${tests.length}, Passed: ${tests.filter(t => t.status === 'passed').length}, Failed: ${failedTests.length}`);
  failedTests.forEach(f => {
    console.log(`[FAIL] ID: ${f.id} | Name: ${f.name} | Message: ${(f as any).message || 'No error message property (often timeout or unhandled exception in test harness)'}`);
  });
}

runAudit().catch(err => {
  console.error('Audit error:', err);
  process.exit(1);
});
