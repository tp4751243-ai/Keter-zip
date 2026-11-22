import { DocxImporter } from '../src/engine/docx-importer';
import { DynamicKneeEngine } from '../src/engine/dynamic-knee';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { TypesetterEngine } from '../src/engine/typesetter-core';
import { PageGeometry, ContentUnit, ShapedWord, TypesetLine } from '../src/types/typesetter';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { EngineHardRulesEngine } from '../src/engine/engine-hard-rules';

const geom: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

async function runVerification() {
  console.log('================================================================================');
  console.log('STAGE 21Q — FOCUSED REGRESSION SUITE & CANDIDATE BREAKPOINT PROOFS');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;
  function check(desc: string, cond: boolean) {
    if (cond) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.log(`[FAIL] ${desc}`);
      failed++;
    }
  }

  const units = DocxImporter.getSampleBerakhot();
  const design = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });

  // 1. Production Run
  const doc = PaginationEngine.paginateDocument({
    title: 'Stage 21Q Verification',
    layoutType: 'rav_text',
    units,
    geometry: geom,
    designSettings: design,
  });

  // Test 1: Production output has exactly 2 pages
  check('Production output produces exactly 2 pages', doc.totalPages === 2);

  // Test 2: Word conservation (441 body + 28 footnotes = 469 words)
  const bodyWords = doc.pages.reduce((acc, p) =>
    acc + [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines].reduce(
      (s, l) => s + l.words.filter(w => !w.isSpace && w.text.trim().length > 0).length, 0
    ), 0);
  check(`100% Body Word Conservation (${bodyWords}/441)`, bodyWords === 441);

  const fnWords = doc.pages.reduce((acc, p) =>
    acc + ((p as any).footnoteLines?.reduce(
      (s: number, l: TypesetLine) => s + l.words.filter(w => !w.isSpace && w.text.trim().length > 0).length, 0
    ) ?? 0), 0);
  check(`100% Footnote Word Conservation (${fnWords}/28)`, fnWords === 28);

  // Test 3: Zero spatial collisions
  const collisions = doc.pages.reduce((acc, p) => acc + (p.layoutScore?.collisionCount ?? 0), 0);
  check('Zero spatial collisions across all pages', collisions === 0);

  // Test 4: Link Co-Location
  const allLinksCoLocated = doc.pages.every(p => {
    const sUnitIds = new Set(p.sourceLines.flatMap(l => l.words.map(w => w.unitId).filter(Boolean)));
    const rUnitIds = new Set(p.rashiLines.flatMap(l => l.words.map(w => w.unitId).filter(Boolean)));
    const tUnitIds = new Set(p.tosafotLines.flatMap(l => l.words.map(w => w.unitId).filter(Boolean)));
    
    // Check Rashi 1..3 co-located with Gemara 1
    if (rUnitIds.has('unit-rashi-1') || rUnitIds.has('unit-rashi-2') || rUnitIds.has('unit-rashi-3')) {
      if (!sUnitIds.has('unit-gemara-1')) return false;
    }
    // Check Tosafot 1, 3 co-located with Gemara 1
    if (tUnitIds.has('unit-tosafot-1') || tUnitIds.has('unit-tosafot-3')) {
      if (!sUnitIds.has('unit-gemara-1')) return false;
    }
    // Check Rashi 4, 5 co-located with Gemara 3
    if (rUnitIds.has('unit-rashi-4') || rUnitIds.has('unit-rashi-5')) {
      if (!sUnitIds.has('unit-gemara-3')) return false;
    }
    // Check Tosafot 2 co-located with Gemara 3
    if (tUnitIds.has('unit-tosafot-2')) {
      if (!sUnitIds.has('unit-gemara-3')) return false;
    }
    return true;
  });
  check('Universal Law 8: 100% Link Co-Location (Zero split commentary)', allLinksCoLocated);

  // Test 5: Candidate 2 Negative Control (Proving Candidate 2 fails t-33 threshold)
  const sourceEngine = new TypesetterEngine(14.5);
  const p2Cand2S = sourceEngine.shapeUnitSequence(units.filter(u => u.id === 'unit-gemara-4'));
  const p2Cand2Res = DynamicKneeEngine.layoutRavTextPage({
    sourceText: p2Cand2S.map(w => w.text).join(' '),
    rashiText: '',
    tosafotText: '',
    sourceShapedWords: p2Cand2S,
    rashiShapedWords: [],
    tosafotShapedWords: [],
    sourceUnitId: 'unit-gemara-4',
    rashiUnitId: 'rashi-none',
    tosafotUnitId: 'tosafot-none',
    geometry: geom,
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    upperKneeLines: 0,
    upperKneeInwardStep: 18,
    forceSteppedKnee: false,
    designSettings: design,
  });
  check('Candidate 2 leaves orphan Page 2 failing t-33 (util 14% < 15%)', p2Cand2Res.layoutScore.pageUtilization < 15);

  // Test 6: Single-Page Negative Control in production stream (Proving Boundary 1 overflows by 4 words)
  const { sourceShapedAll, rashiShapedAll, tosafotShapedAll } = (PaginationEngine as any).buildLinkedRavGroups(
    units,
    undefined,
    14.5,
    10.5,
    design,
    undefined
  );
  const singleProbe = DynamicKneeEngine.layoutRavTextPage({
    sourceText: sourceShapedAll.map((w: any) => w.text).join(' '),
    rashiText: rashiShapedAll.map((w: any) => w.text).join(' '),
    tosafotText: tosafotShapedAll.map((w: any) => w.text).join(' '),
    sourceShapedWords: sourceShapedAll,
    rashiShapedWords: rashiShapedAll,
    tosafotShapedWords: tosafotShapedAll,
    sourceUnitId: sourceShapedAll[0]?.unitId ?? 'src',
    rashiUnitId: rashiShapedAll[0]?.unitId ?? 'rashi',
    tosafotUnitId: tosafotShapedAll[0]?.unitId ?? 'tos',
    geometry: { ...geom, marginBottom: geom.marginBottom + 40 },
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    upperKneeLines: 4,
    upperKneeInwardStep: 18,
    forceSteppedKnee: true,
    designSettings: design,
  });
  check('Single-Page candidate overflows (151 of 155 source words fit, 4 overflow)', singleProbe.consumedSourceWords === 151 && sourceShapedAll.length === 155);

  // Test 7: Test t-33 passes on Baseline
  const t33Passes =
    bodyWords === 441 &&
    collisions === 0 &&
    (doc.pages[0].layoutScore?.pageUtilization ?? 0) >= 50 &&
    (doc.pages[1].layoutScore?.pageUtilization ?? 0) >= 15 &&
    doc.pages[1].sourceLines.length > 0;
  check('Regression Test t-33 passes on baseline layout', t33Passes);

  // Test 8: Reading order monotonicity
  const p1FirstSourceWord = doc.pages[0].sourceLines[0].words[0].text;
  const p1LastSourceWord = doc.pages[0].sourceLines[doc.pages[0].sourceLines.length - 1].words.slice(-1)[0].text;
  const p2FirstSourceWord = doc.pages[1].sourceLines[0].words[0].text;
  const p2LastSourceWord = doc.pages[1].sourceLines[doc.pages[1].sourceLines.length - 1].words.slice(-1)[0].text;
  check('Monotonic Source reading order across pages',
    p1FirstSourceWord === 'מַסֶּכֶת' &&
    p1LastSourceWord === 'הַשָּׁחַר׃' &&
    p2FirstSourceWord === 'גמרא:' &&
    p2LastSourceWord === 'דְּעַרְבִית.'
  );

  console.log(`\nResults: ${passed} / ${passed + failed} assertions passed.`);
}

runVerification().catch(console.error);
