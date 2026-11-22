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

const { groups, sourceShapedAll, rashiShapedAll, tosafotShapedAll } = (PaginationEngine as any).buildLinkedRavGroups(
  units,
  undefined,
  14.5,
  10.5,
  design,
  undefined
);

const groupBoundaries: any[] = [];
let cumS = 0, cumR = 0, cumT = 0;
for (const grp of groups) {
  cumS += grp.sourceShapedWords.length;
  cumR += grp.rashiShapedWords.length;
  cumT += grp.tosafotShapedWords.length;
  groupBoundaries.push({
    groupId: grp.groupId,
    sEnd: cumS,
    rEnd: cumR,
    tEnd: cumT,
    requiredAreaPt2: grp.requiredAreaPt2,
  });
}

console.log('groupBoundaries:', groupBoundaries);

// Let's test bIdx = 0 and bIdx = 1 with exact paginateRavText effectiveGeometry:
for (let bIdx = 0; bIdx < groupBoundaries.length; bIdx++) {
  const b = groupBoundaries[bIdx];
  const candS = b.sEnd;
  const candR = b.rEnd;
  const candT = b.tEnd;

  const candSourceShaped = sourceShapedAll.slice(0, candS);
  const candRashiShaped = rashiShapedAll.slice(0, candR);
  const candTosafotShaped = tosafotShapedAll.slice(0, candT);

  // In paginateRavText, what is effectiveGeometry?
  // 2 footnotes, ~28 words. In paginateRavText:
  // maxRavFnLinesPerPage = Math.max(3, Math.floor((contentHeight * 0.42 - 14) / fnLeading)) = 17
  // estAnchoredFns: for bIdx=0, only fn-1 (or fn-1 and fn-2? Let's check!)
  // If bIdx=0, words in slice(0, candS) contain unit-gemara-1.
  // fn-1 has anchor in unit-rashi-3.
  // fn-2 has anchor in unit-gemara-3.
  // So for bIdx=0: only fn-1 is anchored! (1 line, 13 + 14 = 27pt reserved).
  // For bIdx=1: fn-1 and fn-2 are anchored! (2 lines, 26 + 14 = 40pt reserved).
  const reservedFnHeight = bIdx === 0 ? 27 : 40;
  const effectiveGeometry = {
    ...geom,
    marginBottom: geom.marginBottom + reservedFnHeight,
  };

  const probe = DynamicKneeEngine.layoutRavTextPage({
    sourceText: candSourceShaped.map((w: any) => w.text).join(' '),
    rashiText: candRashiShaped.map((w: any) => w.text).join(' '),
    tosafotText: candTosafotShaped.map((w: any) => w.text).join(' '),
    sourceShapedWords: candSourceShaped,
    rashiShapedWords: candRashiShaped,
    tosafotShapedWords: candTosafotShaped,
    sourceUnitId: candSourceShaped[0]?.unitId ?? 'src',
    rashiUnitId: candRashiShaped[0]?.unitId ?? 'rashi',
    tosafotUnitId: candTosafotShaped[0]?.unitId ?? 'tos',
    geometry: effectiveGeometry,
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    upperKneeLines: 4,
    upperKneeInwardStep: 18,
    forceSteppedKnee: true,
    designSettings: design,
  });

  const fitsCompletely =
    probe.consumedSourceWords === candS &&
    probe.consumedRashiWords === candR &&
    probe.consumedTosafotWords === candT &&
    probe.layoutScore.collisionCount === 0;

  console.log('Boundary', bIdx, b.groupId, {
    candS,
    consumedS: probe.consumedSourceWords,
    candR,
    consumedR: probe.consumedRashiWords,
    candT,
    consumedT: probe.consumedTosafotWords,
    fitsCompletely,
    utilization: probe.layoutScore.pageUtilization,
    collisions: probe.layoutScore.collisionCount,
    sourceLines: probe.sourceLines.length,
    rashiLines: probe.rashiLines.length,
    tosafotLines: probe.tosafotLines.length,
    maxY: Math.max(
      0,
      ...probe.sourceLines.map((l: any) => l.yBottom ?? l.yBaseline + l.descent),
      ...probe.rashiLines.map((l: any) => l.yBottom ?? l.yBaseline + l.descent),
      ...probe.tosafotLines.map((l: any) => l.yBottom ?? l.yBaseline + l.descent)
    ),
  });
}
