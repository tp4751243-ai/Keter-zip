import { DocxImporter } from '../src/engine/docx-importer';
import { DynamicKneeEngine } from '../src/engine/dynamic-knee';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { TypesetterEngine } from '../src/engine/typesetter-core';
import { SpatialExclusionEngine } from '../src/engine/spatial-exclusion';
import { PageGeometry, ContentUnit, ShapedWord } from '../src/types/typesetter';

const DEFAULT_GEOMETRY: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

async function run() {
  const allUnits = DocxImporter.getSampleBerakhot();
  console.log('Total sample units:', allUnits.length);

  // Group 1: unit-ch-1, unit-gemara-1, unit-gemara-2, unit-rashi-1..3, unit-tosafot-1, unit-tosafot-3, unit-fn-1
  // Group 2: unit-gemara-3, unit-gemara-4, unit-rashi-4..5, unit-tosafot-2, unit-fn-2

  const g1SourceUnits = allUnits.filter(u => ['unit-ch-1', 'unit-gemara-1', 'unit-gemara-2'].includes(u.id));
  const g1RashiUnits = allUnits.filter(u => ['unit-rashi-1', 'unit-rashi-2', 'unit-rashi-3'].includes(u.id));
  const g1TosafotUnits = allUnits.filter(u => ['unit-tosafot-1', 'unit-tosafot-3'].includes(u.id));
  const g1FnUnits = allUnits.filter(u => u.id === 'unit-fn-1');

  const g2SourceUnits = allUnits.filter(u => ['unit-gemara-3', 'unit-gemara-4'].includes(u.id));
  const g2RashiUnits = allUnits.filter(u => ['unit-rashi-4', 'unit-rashi-5'].includes(u.id));
  const g2TosafotUnits = allUnits.filter(u => ['unit-tosafot-2'].includes(u.id));
  const g2FnUnits = allUnits.filter(u => u.id === 'unit-fn-2');

  const sourceEngine = new TypesetterEngine(14.5);
  const commentEngine = new TypesetterEngine(10.5);

  const g1SShaped = sourceEngine.shapeUnitSequence(g1SourceUnits);
  const g1RShaped = commentEngine.shapeUnitSequence(g1RashiUnits);
  const g1TShaped = commentEngine.shapeUnitSequence(g1TosafotUnits);

  const g2SShaped = sourceEngine.shapeUnitSequence(g2SourceUnits);
  const g2RShaped = commentEngine.shapeUnitSequence(g2RashiUnits);
  const g2TShaped = commentEngine.shapeUnitSequence(g2TosafotUnits);

  console.log('--- Candidate 1 (Group 1 on P1, Group 2 on P2) ---');
  console.log('Group 1 words: Source =', g1SShaped.length, ', Rashi =', g1RShaped.length, ', Tosafot =', g1TShaped.length);
  console.log('Group 2 words: Source =', g2SShaped.length, ', Rashi =', g2RShaped.length, ', Tosafot =', g2TShaped.length);

  // Probe Page 1 with Group 1
  const p1Res = DynamicKneeEngine.layoutRavTextPage({
    sourceText: g1SShaped.map(w => w.text).join(' '),
    rashiText: g1RShaped.map(w => w.text).join(' '),
    tosafotText: g1TShaped.map(w => w.text).join(' '),
    sourceShapedWords: g1SShaped,
    rashiShapedWords: g1RShaped,
    tosafotShapedWords: g1TShaped,
    sourceUnitId: g1SShaped[0]?.unitId ?? 'g1-src',
    rashiUnitId: g1RShaped[0]?.unitId ?? 'g1-rashi',
    tosafotUnitId: g1TShaped[0]?.unitId ?? 'g1-tos',
    geometry: DEFAULT_GEOMETRY,
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    upperKneeLines: 4,
    upperKneeInwardStep: 18,
    forceSteppedKnee: true,
  });

  // Probe Page 2 with Group 2
  const p2Res = DynamicKneeEngine.layoutRavTextPage({
    sourceText: g2SShaped.map(w => w.text).join(' '),
    rashiText: g2RShaped.map(w => w.text).join(' '),
    tosafotText: g2TShaped.map(w => w.text).join(' '),
    sourceShapedWords: g2SShaped,
    rashiShapedWords: g2RShaped,
    tosafotShapedWords: g2TShaped,
    sourceUnitId: g2SShaped[0]?.unitId ?? 'g2-src',
    rashiUnitId: g2RShaped[0]?.unitId ?? 'g2-rashi',
    tosafotUnitId: g2TShaped[0]?.unitId ?? 'g2-tos',
    geometry: DEFAULT_GEOMETRY,
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    upperKneeLines: 4,
    upperKneeInwardStep: 18,
    forceSteppedKnee: true,
  });

  console.log('Page 1 result:');
  console.log('  Consumed Source:', p1Res.consumedSourceWords, '/', g1SShaped.length);
  console.log('  Consumed Rashi:', p1Res.consumedRashiWords, '/', g1RShaped.length);
  console.log('  Consumed Tosafot:', p1Res.consumedTosafotWords, '/', g1TShaped.length);
  console.log('  Source Lines:', p1Res.sourceLines.length);
  console.log('  Rashi Lines:', p1Res.rashiLines.length);
  console.log('  Tosafot Lines:', p1Res.tosafotLines.length);
  console.log('  Utilization:', p1Res.layoutScore.pageUtilization, '%');
  console.log('  Collisions:', p1Res.layoutScore.collisionCount);

  console.log('Page 2 result:');
  console.log('  Consumed Source:', p2Res.consumedSourceWords, '/', g2SShaped.length);
  console.log('  Consumed Rashi:', p2Res.consumedRashiWords, '/', g2RShaped.length);
  console.log('  Consumed Tosafot:', p2Res.consumedTosafotWords, '/', g2TShaped.length);
  console.log('  Source Lines:', p2Res.sourceLines.length);
  console.log('  Rashi Lines:', p2Res.rashiLines.length);
  console.log('  Tosafot Lines:', p2Res.tosafotLines.length);
  console.log('  Utilization:', p2Res.layoutScore.pageUtilization, '%');
  console.log('  Collisions:', p2Res.layoutScore.collisionCount);
}

run().catch(console.error);
