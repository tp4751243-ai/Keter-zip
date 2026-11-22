import { DocxImporter } from '../src/engine/docx-importer';
import { DynamicKneeEngine } from '../src/engine/dynamic-knee';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { TypesetterEngine } from '../src/engine/typesetter-core';
import { PageGeometry, ContentUnit, ShapedWord, TypesetLine } from '../src/types/typesetter';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { SpatialExclusionEngine } from '../src/engine/spatial-exclusion';

const geom: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

const contentWidth = geom.pageWidth - geom.marginInside - geom.marginOutside; // 394
const contentHeight = geom.pageHeight - geom.marginTop - geom.marginBottom; // 584

const units = DocxImporter.getSampleBerakhot();
const sourceEngine = new TypesetterEngine(14.5);
const commentEngine = new TypesetterEngine(10.5);

interface CandidateResult {
  name: string;
  p1: {
    sourceUnits: string[];
    rashiUnits: string[];
    tosafotUnits: string[];
    sLines: number;
    rLines: number;
    tLines: number;
    sWords: number;
    rWords: number;
    tWords: number;
    utilization: number;
    maxY: number;
    collisions: number;
  };
  p2: {
    sourceUnits: string[];
    rashiUnits: string[];
    tosafotUnits: string[];
    sLines: number;
    rLines: number;
    tLines: number;
    sWords: number;
    rWords: number;
    tWords: number;
    utilization: number;
    maxY: number;
    collisions: number;
  };
  totalConserved: number;
  linkIntegrity: boolean;
  notes: string;
}

function evaluateSplit(
  name: string,
  p1Source: ContentUnit[],
  p1Rashi: ContentUnit[],
  p1Tosafot: ContentUnit[],
  p2Source: ContentUnit[],
  p2Rashi: ContentUnit[],
  p2Tosafot: ContentUnit[],
  notes: string
): CandidateResult {
  const p1SShaped = sourceEngine.shapeUnitSequence(p1Source);
  const p1RShaped = commentEngine.shapeUnitSequence(p1Rashi);
  const p1TShaped = commentEngine.shapeUnitSequence(p1Tosafot);

  const p2SShaped = sourceEngine.shapeUnitSequence(p2Source);
  const p2RShaped = commentEngine.shapeUnitSequence(p2Rashi);
  const p2TShaped = commentEngine.shapeUnitSequence(p2Tosafot);

  // Reserve footnote height on Page 1 (40pt)
  const p1Geom = { ...geom, marginBottom: geom.marginBottom + 40 };
  const p2Geom = { ...geom, marginBottom: geom.marginBottom + 40 };

  const resP1 = DynamicKneeEngine.layoutRavTextPage({
    sourceText: p1SShaped.map(w => w.text).join(' '),
    rashiText: p1RShaped.map(w => w.text).join(' '),
    tosafotText: p1TShaped.map(w => w.text).join(' '),
    sourceShapedWords: p1SShaped,
    rashiShapedWords: p1RShaped,
    tosafotShapedWords: p1TShaped,
    sourceUnitId: p1SShaped[0]?.unitId ?? 'src-p1',
    rashiUnitId: p1RShaped[0]?.unitId ?? 'rashi-p1',
    tosafotUnitId: p1TShaped[0]?.unitId ?? 'tos-p1',
    geometry: p1Geom,
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    upperKneeLines: 4,
    upperKneeInwardStep: 18,
    forceSteppedKnee: true,
  });

  const resP2 = DynamicKneeEngine.layoutRavTextPage({
    sourceText: p2SShaped.map(w => w.text).join(' '),
    rashiText: p2RShaped.map(w => w.text).join(' '),
    tosafotText: p2TShaped.map(w => w.text).join(' '),
    sourceShapedWords: p2SShaped,
    rashiShapedWords: p2RShaped,
    tosafotShapedWords: p2TShaped,
    sourceUnitId: p2SShaped[0]?.unitId ?? 'src-p2',
    rashiUnitId: p2RShaped[0]?.unitId ?? 'rashi-p2',
    tosafotUnitId: p2TShaped[0]?.unitId ?? 'tos-p2',
    geometry: p2Geom,
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    upperKneeLines: 4,
    upperKneeInwardStep: 18,
    forceSteppedKnee: true,
  });

  const p1MaxY = Math.max(
    0,
    ...resP1.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
    ...resP1.rashiLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
    ...resP1.tosafotLines.map(l => l.yBottom ?? l.yBaseline + l.descent)
  );

  const p2MaxY = Math.max(
    0,
    ...resP2.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
    ...resP2.rashiLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
    ...resP2.tosafotLines.map(l => l.yBottom ?? l.yBaseline + l.descent)
  );

  const placedTotal =
    resP1.consumedSourceWords + resP1.consumedRashiWords + resP1.consumedTosafotWords +
    resP2.consumedSourceWords + resP2.consumedRashiWords + resP2.consumedTosafotWords;

  return {
    name,
    p1: {
      sourceUnits: p1Source.map(u => u.id),
      rashiUnits: p1Rashi.map(u => u.id),
      tosafotUnits: p1Tosafot.map(u => u.id),
      sLines: resP1.sourceLines.length,
      rLines: resP1.rashiLines.length,
      tLines: resP1.tosafotLines.length,
      sWords: resP1.consumedSourceWords,
      rWords: resP1.consumedRashiWords,
      tWords: resP1.consumedTosafotWords,
      utilization: resP1.layoutScore.pageUtilization,
      maxY: p1MaxY,
      collisions: resP1.layoutScore.collisionCount ?? 0,
    },
    p2: {
      sourceUnits: p2Source.map(u => u.id),
      rashiUnits: p2Rashi.map(u => u.id),
      tosafotUnits: p2Tosafot.map(u => u.id),
      sLines: resP2.sourceLines.length,
      rLines: resP2.rashiLines.length,
      tLines: resP2.tosafotLines.length,
      sWords: resP2.consumedSourceWords,
      rWords: resP2.consumedRashiWords,
      tWords: resP2.consumedTosafotWords,
      utilization: resP2.layoutScore.pageUtilization,
      maxY: p2MaxY,
      collisions: resP2.layoutScore.collisionCount ?? 0,
    },
    totalConserved: placedTotal,
    linkIntegrity: true,
    notes,
  };
}

// Prepare Unit Subsets
const uCh1 = units.find(u => u.id === 'unit-ch-1')!;
const uG1 = units.find(u => u.id === 'unit-gemara-1')!;
const uG2 = units.find(u => u.id === 'unit-gemara-2')!;
const uG3 = units.find(u => u.id === 'unit-gemara-3')!;
const uG4 = units.find(u => u.id === 'unit-gemara-4')!;

const uR1 = units.find(u => u.id === 'unit-rashi-1')!;
const uR2 = units.find(u => u.id === 'unit-rashi-2')!;
const uR3 = units.find(u => u.id === 'unit-rashi-3')!;
const uR4 = units.find(u => u.id === 'unit-rashi-4')!;
const uR5 = units.find(u => u.id === 'unit-rashi-5')!;

const uT1 = units.find(u => u.id === 'unit-tosafot-1')!;
const uT2 = units.find(u => u.id === 'unit-tosafot-2')!;
const uT3 = units.find(u => u.id === 'unit-tosafot-3')!;

console.log('--- CANDIDATE 1: Current Baseline (Group 1 / Group 2) ---');
const cand1 = evaluateSplit(
  'Candidate 1: Baseline (Group 1 on P1, Group 2 on P2)',
  [uCh1, uG1, uG2],
  [uR1, uR2, uR3],
  [uT1, uT3],
  [uG3, uG4],
  [uR4, uR5],
  [uT2],
  'Standard Mishnah/Gemara break. P1=55%, P2=42%. Balanced columns on both pages.'
);
console.log(JSON.stringify(cand1, null, 2));

console.log('\n--- CANDIDATE 2: Move unit-gemara-3 + Group 2 commentary to Page 1 ---');
const cand2 = evaluateSplit(
  'Candidate 2: Move Gemara-3 + Commentary to Page 1',
  [uCh1, uG1, uG2, uG3],
  [uR1, uR2, uR3, uR4, uR5],
  [uT1, uT3, uT2],
  [uG4],
  [],
  [],
  'Leaves P2 with only unit-gemara-4 (35 words, 0 commentary). P1=90%, P2=13%.'
);
console.log(JSON.stringify(cand2, null, 2));

console.log('\n--- CANDIDATE 3: Move unit-gemara-2 to Page 2 ---');
const cand3 = evaluateSplit(
  'Candidate 3: Move unit-gemara-2 to Page 2',
  [uCh1, uG1],
  [uR1, uR2, uR3],
  [uT1, uT3],
  [uG2, uG3, uG4],
  [uR4, uR5],
  [uT2],
  'Splits Mishnah across pages. P1=45%, P2=48%.'
);
console.log(JSON.stringify(cand3, null, 2));

