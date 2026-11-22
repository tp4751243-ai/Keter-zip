import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DynamicKneeEngine } from '../src/engine/dynamic-knee';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { PageGeometry } from '../src/types/typesetter';

const geom: PageGeometry = {
  pageWidth: 482.0,
  pageHeight: 680.0,
  marginTop: 48.0,
  marginBottom: 48.0,
  marginInside: 46.0,
  marginOutside: 42.0,
  isVerso: false,
};

const units = DocxImporter.getSampleBerakhot();
const design = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });

const { groups, sourceShapedAll, rashiShapedAll, tosafotShapedAll, allLinks } = (PaginationEngine as any).buildLinkedRavGroups(
  units,
  undefined,
  14.5,
  10.5,
  design,
  undefined
);

// Define candidate boundaries
const boundaries = [
  { id: 'b-gemara-1', sEnd: 35, rEnd: 103, tEnd: 79, desc: 'End of Mishnah part 1' },
  { id: 'b-gemara-2', sEnd: 72, rEnd: 103, tEnd: 79, desc: 'End of Mishnah (Baseline)' },
  { id: 'b-gemara-3', sEnd: 120, rEnd: 165, tEnd: 121, desc: 'End of Gemara opening + commentary' },
  { id: 'b-gemara-4', sEnd: 155, rEnd: 165, tEnd: 121, desc: 'End of Gemara resolution (Document End)' },
];

console.log('--- EVALUATING ALL 4 CANDIDATE BOUNDARIES ON PAGE 1 ---');
boundaries.forEach((b, idx) => {
  const candS = sourceShapedAll.slice(0, b.sEnd);
  const candR = rashiShapedAll.slice(0, b.rEnd);
  const candT = tosafotShapedAll.slice(0, b.tEnd);

  // Reserve footnote height (27pt for b <= 72, 40pt for b > 72)
  const fnRes = b.sEnd <= 72 ? 27 : 40;
  const p1Geom = { ...geom, marginBottom: geom.marginBottom + fnRes };

  const probe = DynamicKneeEngine.layoutRavTextPage({
    sourceText: candS.map((w: any) => w.text).join(' '),
    rashiText: candR.map((w: any) => w.text).join(' '),
    tosafotText: candT.map((w: any) => w.text).join(' '),
    sourceShapedWords: candS,
    rashiShapedWords: candR,
    tosafotShapedWords: candT,
    sourceUnitId: candS[0]?.unitId ?? 'src',
    rashiUnitId: candR[0]?.unitId ?? 'rashi',
    tosafotUnitId: candT[0]?.unitId ?? 'tos',
    geometry: p1Geom,
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    upperKneeLines: 4,
    upperKneeInwardStep: 18,
    forceSteppedKnee: true,
    designSettings: design,
  });

  const fits = probe.consumedSourceWords === b.sEnd &&
    probe.consumedRashiWords === b.rEnd &&
    probe.consumedTosafotWords === b.tEnd &&
    probe.layoutScore.collisionCount === 0;

  console.log(`\nCandidate ${idx + 1} (${b.id}: ${b.desc}):`);
  console.log(`  Offered: S=${b.sEnd}, R=${b.rEnd}, T=${b.tEnd}`);
  console.log(`  Consumed: S=${probe.consumedSourceWords}, R=${probe.consumedRashiWords}, T=${probe.consumedTosafotWords}`);
  console.log(`  Fits: ${fits}`);
  console.log(`  P1 Lines: S=${probe.sourceLines.length}, R=${probe.rashiLines.length}, T=${probe.tosafotLines.length}`);
  console.log(`  P1 Utilization: ${probe.layoutScore.pageUtilization}%`);
  console.log(`  P1 Layout Score: ${probe.layoutScore.totalScore}/100`);

  // Look-ahead probe on Page 2
  if (fits && b.sEnd < sourceShapedAll.length) {
    const nextS = sourceShapedAll.slice(b.sEnd);
    const nextR = rashiShapedAll.slice(b.rEnd);
    const nextT = tosafotShapedAll.slice(b.tEnd);

    const nextFnRes = b.sEnd <= 72 ? 27 : 0;
    const p2Geom = { ...geom, marginBottom: geom.marginBottom + nextFnRes };

    const nextProbe = DynamicKneeEngine.layoutRavTextPage({
      sourceText: nextS.map((w: any) => w.text).join(' '),
      rashiText: nextR.map((w: any) => w.text).join(' '),
      tosafotText: nextT.map((w: any) => w.text).join(' '),
      sourceShapedWords: nextS,
      rashiShapedWords: nextR,
      tosafotShapedWords: nextT,
      sourceUnitId: nextS[0]?.unitId ?? 'src-p2',
      rashiUnitId: nextR[0]?.unitId ?? 'rashi-p2',
      tosafotUnitId: nextT[0]?.unitId ?? 'tosafot-p2',
      geometry: p2Geom,
      sourceFontSize: 14.5,
      commentaryFontSize: 10.5,
      upperKneeLines: 4,
      upperKneeInwardStep: 18,
      forceSteppedKnee: true,
      designSettings: design,
    });

    const nextLines = nextProbe.sourceLines.length + nextProbe.rashiLines.length + nextProbe.tosafotLines.length;
    const isSparse = nextProbe.sourceLines.length <= 1 || nextLines <= 5;
    const diff = Math.abs(probe.layoutScore.pageUtilization - nextProbe.layoutScore.pageUtilization);
    const sparsePenalty = isSparse ? 30 : 0;
    const twoPageScore = Math.round(
      probe.layoutScore.totalScore * 0.52 +
      nextProbe.layoutScore.totalScore * 0.48 -
      diff * 0.22 -
      sparsePenalty
    );

    console.log(`  Page 2 (Look-Ahead):`);
    console.log(`    Lines: S=${nextProbe.sourceLines.length}, R=${nextProbe.rashiLines.length}, T=${nextProbe.tosafotLines.length} (Total: ${nextLines})`);
    console.log(`    Utilization: ${nextProbe.layoutScore.pageUtilization}%`);
    console.log(`    Is Sparse Final Page (<= 5 lines): ${isSparse}`);
    console.log(`    Combined Two-Page Score: ${twoPageScore}/100`);
  }
});
