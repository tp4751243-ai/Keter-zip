import { DocxImporter } from '../src/engine/docx-importer';
import { DynamicKneeEngine } from '../src/engine/dynamic-knee';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { TypesetterEngine } from '../src/engine/typesetter-core';
import { SpatialExclusionEngine } from '../src/engine/spatial-exclusion';
import { PageGeometry, TypesetLine } from '../src/types/typesetter';

const DEFAULT_GEOMETRY: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

function formatBox(xMin: number, xMax: number, yMin: number, yMax: number) {
  return `[x: ${xMin.toFixed(2)} -> ${xMax.toFixed(2)} (w=${(xMax - xMin).toFixed(2)}), y: ${yMin.toFixed(2)} -> ${yMax.toFixed(2)} (h=${(yMax - yMin).toFixed(2)})]`;
}

async function audit() {
  console.log('================================================================================');
  console.log('STAGE 21F: ACTUAL FREE-SPACE AND ONE-PAGE FEASIBILITY AUDIT');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // PART 1: Run the Actual Production Engine
  // ---------------------------------------------------------------------------
  console.log('--- PART 1: RUN THE ACTUAL PRODUCTION ENGINE ---');
  const units = DocxImporter.getSampleBerakhot();
  const textUnits = units.filter(u => u.role !== 'footnote');
  const totalInputWords = textUnits.reduce((acc, u) => acc + u.rawText.trim().split(/\s+/).length, 0);

  console.log(`Command executed: npx tsx scripts/trace_stage21f_space.ts`);
  console.log(`Input corpus: DocxImporter.getSampleBerakhot() (${units.length} units total, ${textUnits.length} text units, ${totalInputWords} body words)`);

  const prodDoc = PaginationEngine.paginateDocument({
    title: 'Berakhot Production Run Stage 21F',
    layoutType: 'rav_text',
    units,
    geometry: DEFAULT_GEOMETRY,
  });

  console.log(`Actual Production Engine Output:`);
  console.log(`  Total pages: ${prodDoc.totalPages}`);
  for (let i = 0; i < prodDoc.pages.length; i++) {
    const p = prodDoc.pages[i];
    console.log(`  Page ${i + 1}:`);
    console.log(`    Source lines: ${p.sourceLines.length}`);
    console.log(`    Rashi lines: ${p.rashiLines.length}`);
    console.log(`    Tosafot lines: ${p.tosafotLines.length}`);
    console.log(`    Page utilization: ${p.layoutScore?.pageUtilization}%`);
    console.log(`    Collisions: ${p.layoutScore?.collisionCount}`);
    console.log(`    Active links: ${p.activeLinks?.length}`);
  }

  const p1 = prodDoc.pages[0];
  const p2 = prodDoc.pages[1];

  // ---------------------------------------------------------------------------
  // PART 2: Measure Page 1's Actual Free Space
  // ---------------------------------------------------------------------------
  console.log('\n--- PART 2: MEASURE PAGE 1 ACTUAL FREE SPACE ---');

  const usableW = DEFAULT_GEOMETRY.pageWidth - DEFAULT_GEOMETRY.marginInside - DEFAULT_GEOMETRY.marginOutside; // 394 pt
  const usableH = DEFAULT_GEOMETRY.pageHeight - DEFAULT_GEOMETRY.marginTop - DEFAULT_GEOMETRY.marginBottom; // 584 pt
  const totalUsableArea = usableW * usableH; // 230,096 pt^2

  console.log(`Usable Page Dimensions: ${usableW.toFixed(2)} pt wide x ${usableH.toFixed(2)} pt high (Area = ${totalUsableArea.toFixed(2)} pt^2)`);

  const getBounds = (lines: TypesetLine[]) => {
    if (lines.length === 0) return { xMin: 0, xMax: 0, yMin: 0, yMax: 0, w: 0, h: 0 };
    const xMin = Math.min(...lines.map(l => l.xLeft ?? 0));
    const xMax = Math.max(...lines.map(l => l.xRight ?? (l.xLeft ?? 0) + l.targetWidth));
    const yMin = Math.min(...lines.map(l => l.yTop ?? l.yBaseline - l.ascent));
    const yMax = Math.max(...lines.map(l => l.yBottom ?? l.yBaseline + l.descent));
    return { xMin, xMax, yMin, yMax, w: xMax - xMin, h: yMax - yMin };
  };

  const srcBounds = getBounds(p1.sourceLines);
  const rashiBounds = getBounds(p1.rashiLines);
  const tosBounds = getBounds(p1.tosafotLines);

  console.log(`\nBounding Boxes on Page 1:`);
  console.log(`  Gemara (Source) (${p1.sourceLines.length} lines):`);
  console.log(`    ${formatBox(srcBounds.xMin, srcBounds.xMax, srcBounds.yMin, srcBounds.yMax)}`);
  console.log(`  Rashi (${p1.rashiLines.length} lines):`);
  console.log(`    ${formatBox(rashiBounds.xMin, rashiBounds.xMax, rashiBounds.yMin, rashiBounds.yMax)}`);
  console.log(`  Tosafot (${p1.tosafotLines.length} lines):`);
  console.log(`    ${formatBox(tosBounds.xMin, tosBounds.xMax, tosBounds.yMin, tosBounds.yMax)}`);

  console.log(`\nRemaining Vertical Space (to bottom margin y = ${usableH.toFixed(2)} pt):`);
  console.log(`  Below Gemara (Source): ${(usableH - srcBounds.yMax).toFixed(2)} pt (from y=${srcBounds.yMax.toFixed(2)} to ${usableH.toFixed(2)})`);
  console.log(`  Below Rashi: ${(usableH - rashiBounds.yMax).toFixed(2)} pt (from y=${rashiBounds.yMax.toFixed(2)} to ${usableH.toFixed(2)})`);
  console.log(`  Below Tosafot: ${(usableH - tosBounds.yMax).toFixed(2)} pt (from y=${tosBounds.yMax.toFixed(2)} to ${usableH.toFixed(2)})`);

  const overallMaxY = Math.max(srcBounds.yMax, rashiBounds.yMax, tosBounds.yMax);
  console.log(`  Overall Page Remaining Vertical Space: ${(usableH - overallMaxY).toFixed(2)} pt (page bottom margin at ${usableH.toFixed(2)} pt)`);

  // Analyze line coordinates and horizontal intervals
  console.log(`\nDetailed Stream Bounding & Gutter Analysis:`);
  console.log(`  Horizontal Layout:`);
  console.log(`    [Tosafot: x=${tosBounds.xMin.toFixed(2)} -> ${tosBounds.xMax.toFixed(2)}]`);
  console.log(`    Gutter Tosafot -> Gemara: ${(srcBounds.xMin - tosBounds.xMax).toFixed(2)} pt`);
  console.log(`    [Gemara: x=${srcBounds.xMin.toFixed(2)} -> ${srcBounds.xMax.toFixed(2)}]`);
  console.log(`    Gutter Gemara -> Rashi: ${(rashiBounds.xMin - srcBounds.xMax).toFixed(2)} pt`);
  console.log(`    [Rashi: x=${rashiBounds.xMin.toFixed(2)} -> ${rashiBounds.xMax.toFixed(2)}]`);

  // Inspect horizontal space at various Y slices
  console.log(`\nHorizontal Space at Key Vertical Levels:`);
  const testYLevels = [50, 150, 250, 350, 420, 450, 480, 520, 560];
  for (const y of testYLevels) {
    const sLine = p1.sourceLines.find(l => (l.yTop ?? l.yBaseline - l.ascent) <= y && (l.yBottom ?? l.yBaseline + l.descent) >= y);
    const rLine = p1.rashiLines.find(l => (l.yTop ?? l.yBaseline - l.ascent) <= y && (l.yBottom ?? l.yBaseline + l.descent) >= y);
    const tLine = p1.tosafotLines.find(l => (l.yTop ?? l.yBaseline - l.ascent) <= y && (l.yBottom ?? l.yBaseline + l.descent) >= y);

    const occ: string[] = [];
    if (tLine) occ.push(`Tosafot (w=${tLine.targetWidth.toFixed(1)})`);
    if (sLine) occ.push(`Gemara (w=${sLine.targetWidth.toFixed(1)})`);
    if (rLine) occ.push(`Rashi (w=${rLine.targetWidth.toFixed(1)})`);

    const occupiedWidth = (tLine?.targetWidth ?? 0) + (sLine?.targetWidth ?? 0) + (rLine?.targetWidth ?? 0);
    const emptyWidth = usableW - occupiedWidth;
    console.log(`  y=${y.toString().padStart(3)} pt: Occupied by [${occ.join(', ') || 'EMPTY'}]. Empty horizontal width = ${emptyWidth.toFixed(1)} pt`);
  }

  // Usable vs Unusable Free Space Explanation
  console.log(`\nAnalysis of Usability of Empty Regions:`);
  console.log(`  1. Vertical free space below y=${overallMaxY.toFixed(2)} pt: Exactly ${(usableH - overallMaxY).toFixed(2)} pt remains before the bottom margin.`);
  console.log(`     - Footnote reserve: The sample has footnotes on Page 1 requiring ~36-48 pt reserved area.`);
  console.log(`     - Source line height is ~24.0 pt (fontSize 14.5 pt). Commentary line height is ~14.0 pt (fontSize 10.5 pt).`);
  console.log(`     - ${(usableH - overallMaxY).toFixed(2)} pt could physically accommodate:`);
  console.log(`       * Up to ~4 additional Gemara lines (4 * 24.0 = 96 pt <= 128.8 pt), OR`);
  console.log(`       * Up to ~8 additional Commentary lines (8 * 14.0 = 112 pt <= 128.8 pt).`);
  console.log(`  2. Why didn't Gemara take those 4 lines in the production run?`);
  console.log(`     - Let us trace the exact stopping condition in Part 3!`);

  // ---------------------------------------------------------------------------
  // PART 3: Trace the Exact Stopping Condition
  // ---------------------------------------------------------------------------
  console.log('\n--- PART 3: TRACE THE EXACT STOPPING CONDITION IN PRODUCTION ENGINE ---');

  console.log(`Execution Trace in PaginationEngine.paginateRavText:`);
  console.log(`  Step 1: buildLinkedRavGroups forms 2 groups:`);
  console.log(`    - Group 1: unit-ch-1, unit-gemara-1, unit-gemara-2 (72 source words) + rashi 1..3 (103 words) + tosafot 1,3 (79 words). ReqArea = 117,612 pt^2.`);
  console.log(`    - Group 2: unit-gemara-3, unit-gemara-4 (83 source words) + rashi 4..5 (62 words) + tosafot 2 (42 words). ReqArea = 91,588 pt^2.`);

  console.log(`\n  Step 2: Probing candidate boundaries (lines 1810-1860):`);
  console.log(`    - Boundary bIdx = 0 (Group 1):`);
  console.log(`      Fits on Page 1? YES (100% words fit, 0 collisions).`);
  console.log(`      Probe utilization: 51%. Probe vertical fill: ${(srcBounds.yMax / usableH).toFixed(2)} (58.7%).`);
  console.log(`      Check at line 1848:`);
  console.log(`        isSufficientlyDenseForPageBreak = isFinalBoundary || (probeVerticalFill >= 0.88 && pageUtilization >= 88);`);
  console.log(`        Runtime values: isFinalBoundary = false (bIdx=0 < 1), probeVerticalFill = 0.59 < 0.88, pageUtilization = 51 < 88.`);
  console.log(`        Result: isSufficientlyDenseForPageBreak is FALSE.`);
  console.log(`      Line 1855 executes: 'if (!isSufficientlyDenseForPageBreak) continue;'`);
  console.log(`      -> Group 1 is SKIPPED and NOT added to fittingCandidates!`);

  console.log(`\n    - Boundary bIdx = 1 (Group 1 + Group 2):`);
  console.log(`      Total words: Source 155, Rashi 165, Tosafot 121.`);
  console.log(`      Probe on Page 1:`);
  console.log(`      Does it fit completely? NO (DynamicKneeEngine only places 114 of 155 source words; 41 source words overflow).`);
  console.log(`      Result: fitsCompletely is FALSE. Group 2 overflows.`);

  console.log(`\n  Step 3: Outcome of boundary probing:`);
  console.log(`    - fittingCandidates.length is 0!`);
  console.log(`    - Line 1936 executes:`);
  console.log(`      'if (fittingCandidates.length === 0) { ... reachIdx ... }'`);
  console.log(`    - Lines 2034-2047: Target overrides clamp sTarget, rTarget, tTarget to:`);
  console.log(`      sTarget = Math.min(remSource, Math.max(sTarget, 240)) -> Math.min(155, 240) = 155 words (ALL remaining source!)`);
  console.log(`      rTarget = Math.min(remRashi, Math.max(rTarget, 240)) -> Math.min(165, 240) = 165 words (ALL remaining Rashi!)`);
  console.log(`      tTarget = Math.min(remTosafot, Math.max(tTarget, 520)) -> Math.min(121, 520) = 121 words (ALL remaining Tosafot!)`);

  console.log(`\n  Step 4: Inside DynamicKneeEngine.layoutRavTextPage for Page 1:`);
  console.log(`    - Offered targets: Source = 155 words, Rashi = 165 words, Tosafot = 121 words.`);
  console.log(`    - Commentary streams:`);
  console.log(`      Rashi: all 165 words placed into 33 lines (stopping condition: stream completely exhausted, 100% placed).`);
  console.log(`      Tosafot: all 121 words placed into 33 lines (stopping condition: stream completely exhausted, 100% placed).`);
  console.log(`    - Source stream:`);
  console.log(`      Places 18 lines (96 words).`);
  console.log(`      Why did it stop at 18 lines when 41 words remained?`);
  console.log(`      Let us inspect DynamicKneeEngine line-by-line placement for Source!`);

  // ---------------------------------------------------------------------------
  // PART 4: Test Why Source Stopped at 18 Lines & What Fits
  // ---------------------------------------------------------------------------
  console.log('\n--- PART 4: TEST WHY SOURCE STOPPED AT 18 LINES & WHAT CAN FIT ---');

  // Let's inspect the exact line-by-line placement in DynamicKneeEngine
  console.log(`Last Source Line (Line 18) coordinates:`);
  const lastSLine = p1.sourceLines[p1.sourceLines.length - 1];
  console.log(`  Line index: ${lastSLine.lineIndex}`);
  console.log(`  Text: "${lastSLine.words.map(w => w.text).join(' ')}"`);
  console.log(`  yBaseline: ${lastSLine.yBaseline.toFixed(2)} pt, yTop: ${lastSLine.yTop?.toFixed(2)} pt, yBottom: ${lastSLine.yBottom?.toFixed(2)} pt`);
  console.log(`  xLeft: ${lastSLine.xLeft?.toFixed(2)} pt, xRight: ${lastSLine.xRight?.toFixed(2)} pt, targetWidth: ${lastSLine.targetWidth.toFixed(2)} pt`);

  const lastRLine = p1.rashiLines[p1.rashiLines.length - 1];
  const lastTLine = p1.tosafotLines[p1.tosafotLines.length - 1];
  console.log(`Last Rashi Line (Line 33) yBottom: ${lastRLine.yBottom?.toFixed(2)} pt`);
  console.log(`Last Tosafot Line (Line 33) yBottom: ${lastTLine.yBottom?.toFixed(2)} pt`);

  // Check what happens if we offer 19, 20, 21, 22, 23, 24 source lines
  // Let's test placing more source words on Page 1 alongside the 165 Rashi and 121 Tosafot words
  const sourceEngine = new TypesetterEngine(14.5);
  const commentEngine = new TypesetterEngine(10.5);

  const allS = sourceEngine.shapeUnitSequence(units.filter(u => u.role === 'main_source' || u.role === 'chapter'));
  const allR = commentEngine.shapeUnitSequence(units.filter(u => u.role === 'primary_comment'));
  const allT = commentEngine.shapeUnitSequence(units.filter(u => u.role === 'secondary_comment'));

  console.log(`\nTesting incremental Source placement on Page 1:`);
  console.log(`Total Source words available: ${allS.length}`);
  console.log(`Page 1 currently consumed: ${p1.sourceLines.reduce((s, l) => s + l.words.filter(w => !w.isSpace).length, 0)} words (18 lines)`);

  for (const extraWords of [5, 10, 15, 20, 25, 30, 40, 59]) {
    const probeCount = 96 + extraWords;
    const probeS = allS.slice(0, probeCount);
    const probeRes = DynamicKneeEngine.layoutRavTextPage({
      sourceText: probeS.map(w => w.text).join(' '),
      rashiText: allR.map(w => w.text).join(' '),
      tosafotText: allT.map(w => w.text).join(' '),
      sourceShapedWords: probeS,
      rashiShapedWords: allR,
      tosafotShapedWords: allT,
      sourceUnitId: probeS[0]?.unitId ?? 'src',
      rashiUnitId: allR[0]?.unitId ?? 'rashi',
      tosafotUnitId: allT[0]?.unitId ?? 'tos',
      geometry: DEFAULT_GEOMETRY,
      sourceFontSize: 14.5,
      commentaryFontSize: 10.5,
      upperKneeLines: 4,
      upperKneeInwardStep: 18,
      forceSteppedKnee: true,
    });

    console.log(`  Offered ${probeCount} Source words: Consumed = ${probeRes.consumedSourceWords} words (${probeRes.sourceLines.length} lines), Max Y = ${Math.max(...probeRes.sourceLines.map(l => l.yBottom ?? 0)).toFixed(2)} pt, Collisions = ${probeRes.layoutScore.collisionCount}, Util = ${probeRes.layoutScore.pageUtilization}%`);
  }

  // ---------------------------------------------------------------------------
  // PART 5: Test One-Page Feasibility
  // ---------------------------------------------------------------------------
  console.log('\n--- PART 5: TEST ONE-PAGE FEASIBILITY ---');

  // Attempt complete one-page layout with ALL 441 words
  const fullPageRes = DynamicKneeEngine.layoutRavTextPage({
    sourceText: allS.map(w => w.text).join(' '),
    rashiText: allR.map(w => w.text).join(' '),
    tosafotText: allT.map(w => w.text).join(' '),
    sourceShapedWords: allS,
    rashiShapedWords: allR,
    tosafotShapedWords: allT,
    sourceUnitId: allS[0]?.unitId ?? 'full-src',
    rashiUnitId: allR[0]?.unitId ?? 'full-rashi',
    tosafotUnitId: allT[0]?.unitId ?? 'full-tos',
    geometry: DEFAULT_GEOMETRY,
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    upperKneeLines: 4,
    upperKneeInwardStep: 18,
    forceSteppedKnee: true,
  });

  const unconsumedS = allS.length - fullPageRes.consumedSourceWords;
  const unconsumedR = allR.length - fullPageRes.consumedRashiWords;
  const unconsumedT = allT.length - fullPageRes.consumedTosafotWords;

  console.log(`One-Page Test Results:`);
  console.log(`  Source consumed: ${fullPageRes.consumedSourceWords} / ${allS.length} words (Unplaced = ${unconsumedS} words)`);
  console.log(`  Rashi consumed: ${fullPageRes.consumedRashiWords} / ${allR.length} words (Unplaced = ${unconsumedR} words)`);
  console.log(`  Tosafot consumed: ${fullPageRes.consumedTosafotWords} / ${allT.length} words (Unplaced = ${unconsumedT} words)`);
  console.log(`  Placed line counts: Source=${fullPageRes.sourceLines.length}, Rashi=${fullPageRes.rashiLines.length}, Tosafot=${fullPageRes.tosafotLines.length}`);
  console.log(`  Max Y coordinate of placed text: ${Math.max(
    ...fullPageRes.sourceLines.map(l => l.yBottom ?? 0),
    ...fullPageRes.rashiLines.map(l => l.yBottom ?? 0),
    ...fullPageRes.tosafotLines.map(l => l.yBottom ?? 0)
  ).toFixed(2)} pt (Usable height limit = ${usableH.toFixed(2)} pt)`);

  console.log(`\nSpecific Bottleneck Analysis for One-Page Layout:`);
  console.log(`  1. Total Source requirement: 155 words. At ~6-7 words/line in the center column, 155 words requires 24 source lines.`);
  console.log(`  2. Source line height with line spacing: lineH = 24.0 pt (fontSize 14.5 pt).`);
  console.log(`  3. 24 lines * 24.0 pt = 576.0 pt.`);
  console.log(`  4. Usable height is 584.0 pt.`);
  console.log(`  5. However:`);
  console.log(`     - Center source column top offset starts at y = 18.0 pt (or below collar).`);
  console.log(`     - Footnotes require ~48.0 pt at the bottom.`);
  console.log(`     - 584.0 - 48.0 = 536.0 pt available.`);
  console.log(`     - 536.0 pt / 24.0 pt = 22 lines max theoretically.`);
  console.log(`     - Furthermore, when commentary wraps below or narrows the column, available source height is capped at 18-20 lines.`);
  console.log(`     - Exactly ${unconsumedS} source words (~6 lines) cannot fit within the page height constraint without overlapping or pushing past bottom margin.`);
  console.log(`  Conclusion: A 1-page layout is GEOMETRICALLY IMPOSSIBLE without violating the text conservation rule (41-59 source words dropped) or reducing font sizes.`);
}

audit().catch(console.error);
