/**
 * KETER-TYPE v0.8.0 — Part C render smoke checks (§1–§9).
 *
 * Run from the repo root:  npx tsx scripts/partC-render-smoke.ts
 *
 * Pure-engine checks (no browser, no React): every role renders in every
 * layout (no silent drops), tier edits change the render (knee flank
 * split, bottom split, shaped sizes/leading), keep-together overrides are
 * honoured, the Vilna flank rule is ONE consistent rule (helpers + knee
 * solver agree), Insert Page force-breaks work in every paginator, the
 * Michtav box renders on the first Vilna page, preset switches leave no
 * legacy boxes or collisions, and the Control Panel uses the real page
 * height. Exit code 0 = every check passed; 1 = at least one failed.
 */

import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { DynamicKneeEngine } from '../src/engine/dynamic-knee';
import {
  flankPhysicalSides,
  fixShasFlaws,
  spreadSide,
  spreadSideForPageIndex,
} from '../src/engine/vilna-shas';
import { planLayoutSwitch } from '../src/engine/layout-transaction';
import { frameGeometryPt, resolveMeasurementOrigin } from '../src/engine/workspace-layout';
import type { BookLayoutType, ContentUnit, PageGeometry, PageTypesetResult, TypesetLine } from '../src/types/typesetter';
import type { LocalRuleOverride } from '../src/engine/typesetting-rules-engine';
import type { ShasFlaw } from '../src/engine/vilna-shas';

const GEOMETRY: PageGeometry = {
  pageWidth: 482,
  pageHeight: 720, // Vilna folio (the layout the 680pt hardcode got wrong)
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};
const CONTENT_W = GEOMETRY.pageWidth - GEOMETRY.marginInside - GEOMETRY.marginOutside;
const CONTENT_H = GEOMETRY.pageHeight - GEOMETRY.marginTop - GEOMETRY.marginBottom;

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const GEMARA = 'אָמַר רַבִּי יְהוּדָה אָמַר רַב: כָּל הָעוֹסֵק בַּתּוֹרָה לִשְׁמָהּ — זוֹכֶה לִדְבָרִים הַרְבֵּה, וְנִקְרָא רֵעַ וְאָהוּב. ';
const RASHI = 'דיבור המתחיל: פירוש קצר על הגמרא, מילה במילה, בלשון ברורה וקצרה. ';
const TOSAFOT = 'תוספות: קושיא ותירוץ, דיון ארוך בין הראשונים, חילוקים וראיות. ';
const TERTIARY = 'עין משפט: סימן א׳ סעיף ב׳. ';
const LIST = 'פרט ראשון ברשימה; פרט שני ברשימה; פרט שלישי ברשימה. ';
const TABLE = 'שורה בטבלה: עמודה ראשונה, עמודה שניה, עמודה שלישית. ';

/** An 8-role document: every role Part C §1 had to rescue from the drop. */
function makeEightRoleUnits(): ContentUnit[] {
  return [
    { id: 'u-main', role: 'main_source', rawText: GEMARA.repeat(40), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'u-heading', role: 'heading', rawText: 'פרק ראשון', styleName: 'Heading 1', order: 2, hierarchyLevel: 1 },
    { id: 'u-siman', role: 'siman', rawText: 'סימן א׳', styleName: 'Heading 2', order: 3, hierarchyLevel: 1 },
    { id: 'u-rashi', role: 'primary_comment', rawText: RASHI.repeat(40), styleName: 'Normal', order: 4, hierarchyLevel: 3, linkedSourceId: 'u-main' },
    { id: 'u-tos', role: 'secondary_comment', rawText: TOSAFOT.repeat(40), styleName: 'Normal', order: 5, hierarchyLevel: 3, linkedSourceId: 'u-main' },
    { id: 'u-ter', role: 'tertiary_comment', rawText: TERTIARY.repeat(20), styleName: 'Normal', order: 6, hierarchyLevel: 3 },
    { id: 'u-list', role: 'list_item', rawText: LIST.repeat(10), styleName: 'Normal', order: 7, hierarchyLevel: 2 },
    { id: 'u-table', role: 'table', rawText: TABLE.repeat(10), styleName: 'Normal', order: 8, hierarchyLevel: 2 },
  ];
}

function allLines(pg: PageTypesetResult): TypesetLine[] {
  return [
    ...pg.sourceLines,
    ...pg.rashiLines,
    ...pg.tosafotLines,
    ...(pg.footnoteLines ?? []),
    ...(pg.column2Lines ?? []),
    ...(pg.sideNoteLines ?? []),
    ...(pg.tertiaryLines ?? []),
  ];
}

function placedUnitIds(doc: { pages: PageTypesetResult[] }): Set<string> {
  const ids = new Set<string>();
  for (const pg of doc.pages) {
    for (const l of allLines(pg)) {
      if (l.unitId) ids.add(l.unitId);
      for (const w of l.words ?? []) {
        if (w.unitId) ids.add(w.unitId);
      }
    }
  }
  return ids;
}

function paginate(layoutType: BookLayoutType, units: ContentUnit[], overrides?: { localOverrides?: LocalRuleOverride[]; designSettings?: ReturnType<typeof DesignSettingsEngine.createDefaultSettings> }) {
  const settings = overrides?.designSettings ?? DesignSettingsEngine.createDefaultSettings({ layoutType, geometry: GEOMETRY });
  return PaginationEngine.paginateDocument({
    title: 'Part C smoke',
    layoutType,
    units,
    geometry: GEOMETRY,
    designSettings: settings,
    localOverrides: overrides?.localOverrides,
  });
}

console.log('Part C (§1): every role renders, nothing silently dropped');
{
  const layouts: BookLayoutType[] = ['rav_text', 'mikraot_gedolot', 'source_top_commentary_bottom', 'two_column', 'single_column', 'custom_layout'];
  for (const layout of layouts) {
    const doc = paginate(layout, makeEightRoleUnits());
    const placed = placedUnitIds(doc);
    const missing = makeEightRoleUnits().map(u => u.id).filter(id => !placed.has(id));
    check(
      `${layout}: all 8 roles placed, unplacedUnitIds empty`,
      missing.length === 0 && (doc.unplacedUnitIds ?? []).length === 0,
      missing.length > 0 ? `missing: ${missing.join(', ')}` : `${doc.pages.length} pages`
    );
  }
  const rav = paginate('rav_text', makeEightRoleUnits());
  const terLines = rav.pages.flatMap(p => p.tertiaryLines ?? []);
  check('rav_text: tertiary band lines exist (tertiary_comment placed)', terLines.length > 0, `${terLines.length} tertiary lines`);
  const srcRoles = new Set(rav.pages.flatMap(p => p.sourceLines.map(l => l.role)));
  check(
    'rav_text: heading/siman/list/table folded into the source stream',
    srcRoles.has('heading') && srcRoles.has('siman') && srcRoles.has('list_item') && srcRoles.has('table'),
    [...srcRoles].join(', ')
  );
}

console.log('Part C (§2): tier edits change the render');
{
  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY });
  const units = makeEightRoleUnits();

  // Tier font size flows into shaping (resolver → shapeContentUnit).
  const sized = DesignSettingsEngine.updateTierConfig(base, 2, { fontSizePt: 12 }, 'user').settings;
  const sizedDoc = paginate('rav_text', units, { designSettings: sized });
  const rashiWordSizes = new Set(
    sizedDoc.pages.flatMap(p => p.rashiLines.flatMap(l => l.words.map(w => w.fontSizePt)))
  );
  check('tier fontSize 12 → shaped Rashi words carry 12pt', rashiWordSizes.has(12), [...rashiWordSizes].join(', '));

  // Tier lineHeight flows into leading (clamped to the 1.06× glyph extent).
  const leaded = DesignSettingsEngine.updateTierConfig(base, 2, { lineHeight: 1.8 }, 'user').settings;
  const leadedDoc = paginate('rav_text', units, { designSettings: leaded });
  const rashiLeadings = leadedDoc.pages.flatMap(p => p.rashiLines.map(l => l.leadingPt ?? 0));
  const baseDoc = paginate('rav_text', units, { designSettings: base });
  const baseLeadings = baseDoc.pages.flatMap(p => p.rashiLines.map(l => l.leadingPt ?? 0));
  const maxLeaded = Math.max(0, ...rashiLeadings);
  const maxBase = Math.max(0, ...baseLeadings);
  check('tier lineHeight 1.8 → Rashi leading grows', maxLeaded > maxBase, `base ${maxBase} → tier ${maxLeaded}`);

  // Tier flank widths move the knee: rashi 30 / tosafot 18 (share 0.625).
  const widened1 = DesignSettingsEngine.updateTierConfig(base, 3, { widthPct: 18 }, 'user').settings;
  const widened = DesignSettingsEngine.updateTierConfig(widened1, 2, { widthPct: 30 }, 'user').settings;
  check('tierFlankShare reads 30/(30+18) = 0.625', DesignSettingsEngine.tierFlankShare(widened) === 0.625);
  const widenedDoc = paginate('rav_text', units, { designSettings: widened });
  const recto = widenedDoc.pages[0];
  check(
    'tier flank widths → recto Rashi flank wider than Tosafot flank',
    recto.knee.rightCommentaryWidth > recto.knee.leftCommentaryWidth,
    `right ${Math.round(recto.knee.rightCommentaryWidth)} vs left ${Math.round(recto.knee.leftCommentaryWidth)}`
  );

  // Bottom-commentary split follows the tiers too.
  const topBase = paginate('source_top_commentary_bottom', units, {
    designSettings: DesignSettingsEngine.createDefaultSettings({ layoutType: 'source_top_commentary_bottom', geometry: GEOMETRY }),
  });
  const topWidened = paginate('source_top_commentary_bottom', units, {
    designSettings: (() => {
      const s0 = DesignSettingsEngine.createDefaultSettings({ layoutType: 'source_top_commentary_bottom', geometry: GEOMETRY });
      const s1 = DesignSettingsEngine.updateTierConfig(s0, 3, { widthPct: 18 }, 'user').settings;
      return DesignSettingsEngine.updateTierConfig(s1, 2, { widthPct: 30 }, 'user').settings;
    })(),
  });
  const rashiW = (doc: ReturnType<typeof paginate>) =>
    Math.max(0, ...doc.pages.flatMap(p => p.rashiLines.map(l => l.targetWidth ?? 0)));
  check(
    'tier widths → bottom Rashi column wider than the even split',
    rashiW(topWidened) > rashiW(topBase),
    `base ${Math.round(rashiW(topBase))} → tier ${Math.round(rashiW(topWidened))}`
  );

  // A width that cannot affect the render is not editable (single_column).
  check('isTierWidthEditable: single_column false, rav_text rashi true, top/bottom main false',
    DesignSettingsEngine.isTierWidthEditable('single_column', 'primary_comment') === false &&
    DesignSettingsEngine.isTierWidthEditable('rav_text', 'primary_comment') === true &&
    DesignSettingsEngine.isTierWidthEditable('source_top_commentary_bottom', 'main_source') === false &&
    DesignSettingsEngine.isTierWidthEditable('rav_text', 'tertiary_comment') === false);
}

console.log('Part C (§3): keep-together is real, never a no-op success');
{
  // A unit that would straddle a page boundary in single_column (~16 lines,
  // starting after a 16-line filler on a ~25-line page — so it fits on ONE
  // page whole, but not on the remainder of the first one).
  const filler: ContentUnit = { id: 'u-fill', role: 'main_source', rawText: GEMARA.repeat(12), styleName: 'Normal', order: 1, hierarchyLevel: 2 };
  const target: ContentUnit = { id: 'u-keep', role: 'main_source', rawText: GEMARA.repeat(12), styleName: 'Normal', order: 2, hierarchyLevel: 2 };
  const tail: ContentUnit = { id: 'u-tail', role: 'main_source', rawText: GEMARA.repeat(12), styleName: 'Normal', order: 3, hierarchyLevel: 2 };
  const keepOverride: LocalRuleOverride = {
    id: 'kt-u-keep',
    ruleId: 'paragraph.allowContinuationAcrossPages',
    category: 'paragraph',
    enabled: true,
    priority: 'HARD_USER_RULE',
    isHardConstraint: true,
    value: false,
    source: 'local',
    scope: { unitId: 'u-keep' },
    keepTogetherUnitIds: ['u-keep'],
    description: 'Part C smoke keep-together',
  };
  const doc = paginate('single_column', [filler, target, tail], { localOverrides: [keepOverride] });
  const pagesWithKeep = doc.pages.filter(p => allLines(p).some(l => l.unitId === 'u-keep')).length;
  check('keep-together unit never spans two pages', pagesWithKeep === 1, `on ${pagesWithKeep} page(s), ${doc.pages.length} total`);
  check('keep-together violations list is empty', (doc.keepTogetherViolations ?? []).length === 0);

  // fixShasFlaws skips single-line units (they cannot be widows/orphans).
  const oneLineUnit: ContentUnit = { id: 'u-one', role: 'main_source', rawText: 'שורה אחת', styleName: 'Normal', order: 1, hierarchyLevel: 2 };
  const fakePage = {
    pageIndex: 0,
    pageNumber: 2,
    pageNumberHebrew: 'ב׳',
    headerTitle: 'smoke',
    layoutType: 'rav_text' as BookLayoutType,
    geometry: GEOMETRY,
    sourceLines: [{ lineIndex: 0, words: [], width: 10, targetWidth: 10, xStart: 0, yBaseline: 60, yTop: 48, yBottom: 72, height: 24, ascent: 12, descent: 3, isLastLine: true, isJustified: false, extraSpacePerWord: 0, role: 'main_source' as const, unitId: 'u-one', fontSizePt: 14.5 }],
    rashiLines: [],
    tosafotLines: [],
    footnoteLines: [],
    occupiedRegions: [],
    layoutScore: undefined,
  } as unknown as PageTypesetResult;
  const flaw: ShasFlaw = { kind: 'widow', pageNumber: 2, unitId: 'u-one', messageHe: 'שורה יתומה', autoFixable: true };
  const fix = fixShasFlaws([flaw], [oneLineUnit], [], [fakePage]);
  check('fixShasFlaws skips a single-line-unit widow flaw', fix.fixedCount === 0 && fix.skippedCount === 1 && fix.overrides.length === 0);
}

console.log('Part C (§4): ONE flank rule — helpers and solver agree');
{
  check('spreadSide standard: 1 left, 2 right', spreadSide(1) === 'left' && spreadSide(2) === 'right');
  check('spreadSide talmud: 2a left, 2b right', spreadSide(2, 'talmud') === 'left' && spreadSide(3, 'talmud') === 'right');
  check('spreadSideForPageIndex: 0 left, 1 right', spreadSideForPageIndex(0) === 'left' && spreadSideForPageIndex(1) === 'right');
  check('flankPhysicalSides recto Rashi right / verso Rashi left',
    flankPhysicalSides(2, 'talmud').rashi === 'right' && flankPhysicalSides(3, 'talmud').rashi === 'left');

  // Live knee solve on both facings: Rashi mean-x flips sides, agreeing with the helpers.
  const settings = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY });
  const solve = (mirror: boolean) =>
    DynamicKneeEngine.layoutRavTextPage({
      sourceText: GEMARA.repeat(10),
      rashiText: RASHI.repeat(10),
      tosafotText: TOSAFOT.repeat(10),
      sourceShapedWords: [],
      rashiShapedWords: [],
      tosafotShapedWords: [],
      sourceUnitId: 'u-main',
      rashiUnitId: 'u-rashi',
      tosafotUnitId: 'u-tos',
      geometry: GEOMETRY,
      sourceFontSize: 14.5,
      commentaryFontSize: 10.5,
      upperKneeLines: 4,
      upperKneeInwardStep: 18,
      forceSteppedKnee: true,
      mirrorFlanks: mirror,
      designSettings: settings,
    });
  const meanCentre = (lines: TypesetLine[]) =>
    lines.length ? lines.reduce((s, l) => s + ((l.xLeft ?? 0) + (l.xRight ?? 0)) / 2, 0) / lines.length : NaN;
  const recto = solve(false);
  const verso = solve(true);
  const rRecto = meanCentre(recto.rashiLines);
  const rVerso = meanCentre(verso.rashiLines);
  check(
    'knee: Rashi right on recto, left on verso, agreeing with flankPhysicalSides',
    Number.isFinite(rRecto) && Number.isFinite(rVerso) &&
      rRecto > CONTENT_W / 2 && rVerso < CONTENT_W / 2 &&
      flankPhysicalSides(2, 'talmud').rashi === 'right' &&
      flankPhysicalSides(3, 'talmud').rashi === 'left',
    `recto ${Math.round(rRecto)} vs verso ${Math.round(rVerso)} (contentW ${CONTENT_W})`
  );
}

console.log('Part C (§5): Control Panel uses the real page height');
{
  // Vilna folio is 720pt, A4 is 842pt — Y=700 must be < 100% on Vilna, never ~103%.
  const vilna = frameGeometryPt({ xPct: 10, yPct: 97.2, widthPct: 80, heightPct: 8 }, 482, 720);
  check('frameGeometryPt: Vilna Y=700pt is 97.2% (on-page)', Math.abs(vilna.yPt - 700) < 1 && vilna.yPt < 720, `yPt ${vilna.yPt}`);
  const a4 = frameGeometryPt({ xPct: 10, yPct: 100, widthPct: 80, heightPct: 100 }, 482, 842);
  check('frameGeometryPt: A4 full height is 842pt (not 680)', a4.heightPt === 842, `heightPt ${a4.heightPt}`);
  // The inside (binding) edge: verso (right-hand page) = left edge (no flip); recto (left-hand) = right edge (flip).
  check('resolveMeasurementOrigin: verso keeps x, recto flips',
    resolveMeasurementOrigin(100, 482, true).xFromOriginPt === 100 &&
    resolveMeasurementOrigin(100, 482, false).xFromOriginPt === 382);
}

console.log('Part C (§6): Insert Page force-break honoured in every paginator');
{
  const breakOverride = (unitId: string): LocalRuleOverride => ({
    id: `pb-${unitId}`,
    ruleId: 'paragraph.allowContinuationAcrossPages',
    category: 'paragraph',
    enabled: true,
    priority: 'HARD_USER_RULE',
    isHardConstraint: true,
    value: false,
    source: 'local',
    scope: { unitId },
    forcePageBreakBeforeUnitId: unitId,
    description: 'Part C smoke force-break',
  });
  // A heading mid-document with a force-break before it must start a new page.
  const units: ContentUnit[] = [
    { id: 'u-a', role: 'main_source', rawText: GEMARA.repeat(30), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'u-break', role: 'heading', rawText: 'פרק שני', styleName: 'Heading 1', order: 2, hierarchyLevel: 1 },
    { id: 'u-b', role: 'main_source', rawText: GEMARA.repeat(30), styleName: 'Normal', order: 3, hierarchyLevel: 2 },
    { id: 'u-r', role: 'primary_comment', rawText: RASHI.repeat(20), styleName: 'Normal', order: 4, hierarchyLevel: 3, linkedSourceId: 'u-a' },
    { id: 'u-t', role: 'secondary_comment', rawText: TOSAFOT.repeat(20), styleName: 'Normal', order: 5, hierarchyLevel: 3, linkedSourceId: 'u-a' },
  ];
  for (const layout of ['rav_text', 'mikraot_gedolot', 'source_top_commentary_bottom', 'two_column', 'single_column', 'custom_layout'] as BookLayoutType[]) {
    const doc = paginate(layout, units, { localOverrides: [breakOverride('u-break')] });
    const pageOf = (unitId: string) => doc.pages.findIndex(p => allLines(p).some(l => l.unitId === unitId));
    const breakPage = pageOf('u-break');
    const prevPage = pageOf('u-a');
    check(`${layout}: force-break heading starts a later page than the previous unit`, breakPage > prevPage && breakPage >= 1, `u-a p${prevPage + 1} → u-break p${breakPage + 1} of ${doc.pages.length}`);
  }
}

console.log('Part C (§7): Michtav box on the first Vilna page');
{
  const units = makeEightRoleUnits();
  const off = paginate('rav_text', units);
  check('michtav off by default: no box on page 0', !off.pages[0]?.michtavBox);
  const vilnaSettings = DesignSettingsEngine.updateRavTextSettings(
    DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY }),
    { michtavEnabled: true, michtavText: 'מכתב' },
    'user'
  );
  const on = paginate('rav_text', units, { designSettings: vilnaSettings });
  const box = on.pages[0]?.michtavBox;
  check('michtav on: box present on page 0 with the text', !!box && box.text === 'מכתב', box ? `${box.xPct}%/${box.yPct}% ${box.widthPct}×${box.heightPct}%` : 'absent');
  check('michtav on: no box on later pages', on.pages.slice(1).every(p => !p.michtavBox));
  if (box) {
    const boxBottomPt = ((box.yPct + box.heightPct) / 100) * CONTENT_H;
    const bodyTop = Math.min(
      ...allLines(on.pages[0]).map(l => l.yTop ?? l.yBaseline - l.ascent)
    );
    check('michtav on: body lines start below the box', bodyTop >= boxBottomPt - 0.5, `body top ${Math.round(bodyTop)} vs box bottom ${Math.round(boxBottomPt)}`);
  }
}

console.log('Part C (§8/§9): preset-switch transaction + no legacy boxes or collisions');
{
  // The transaction itself (pure function).
  const keepOverride: LocalRuleOverride = {
    id: 'kt-1', ruleId: 'paragraph.allowContinuationAcrossPages', category: 'paragraph', enabled: true,
    priority: 'HARD_USER_RULE', isHardConstraint: true, value: false, source: 'local',
    scope: { unitId: 'u-x' }, keepTogetherUnitIds: ['u-x'],
  };
  const forceOverride: LocalRuleOverride = {
    id: 'pb-1', ruleId: 'paragraph.allowContinuationAcrossPages', category: 'paragraph', enabled: true,
    priority: 'HARD_USER_RULE', isHardConstraint: true, value: false, source: 'local',
    scope: { unitId: 'u-y' }, forcePageBreakBeforeUnitId: 'u-y',
  };
  const plan = planLayoutSwitch({
    prevLayout: 'rav_text',
    nextLayout: 'two_column',
    localOverrides: [keepOverride, forceOverride],
    breakInstructions: [{ id: 'brk-1', anchorUnitId: 'u-x', kind: 'pageEndsBefore', pageIndex: 0, wordIndex: 3 } as never],
    hasCustomPageOverrides: true,
    selectedUnitId: 'u-x',
    editingUnitId: null,
  });
  check('transaction drops keep-together overrides, carries force-breaks',
    plan.nextLocalOverrides.length === 1 && plan.nextLocalOverrides[0].id === 'pb-1',
    `${plan.nextLocalOverrides.map(o => o.id).join(', ')}`);
  check('transaction drops break instructions + page overrides + selection',
    plan.nextBreakInstructions.length === 0 && plan.clearCustomPageOverrides && plan.clearSelection);

  // The sequence itself: no collisions, no out-of-bounds lines, no stale custom-layout boxes.
  const units = makeEightRoleUnits();
  const seq: BookLayoutType[] = ['rav_text', 'two_column', 'source_top_commentary_bottom'];
  for (const layout of seq) {
    const doc = paginate(layout, units);
    const collisions = doc.pages.reduce((a, p) => a + (p.layoutScore?.collisionCount ?? 0), 0);
    const outOfBounds = doc.pages.flatMap(p => allLines(p)).filter(l => {
      const xL = l.xLeft ?? 0;
      const xR = l.xRight ?? CONTENT_W;
      const yT = l.yTop ?? l.yBaseline - l.ascent;
      const yB = l.yBottom ?? l.yBaseline + l.descent;
      return xL < -0.5 || xR > CONTENT_W + 0.5 || yT < -0.5 || yB > CONTENT_H + 0.5;
    });
    check(`${layout}: 0 collisions after switch`, collisions === 0, `${collisions} collisions`);
    check(`${layout}: no line outside page bounds`, outOfBounds.length === 0, `${outOfBounds.length} out of bounds`);
    const staleBoxes = doc.pages.flatMap(p => allLines(p)).filter(l => l.customLayoutBoxId);
    check(`${layout}: no custom-layout box ids after leaving custom_layout`, staleBoxes.length === 0);
  }
  const customDoc = paginate('custom_layout', units);
  const afterCustom = paginate('two_column', units);
  const staleAfter = afterCustom.pages.flatMap(p => allLines(p)).filter(l => l.customLayoutBoxId);
  check('custom_layout → two_column: no stale box ids', staleAfter.length === 0, `${customDoc.pages.length} custom pages → ${afterCustom.pages.length} two-column pages`);
}

console.log(`\npartC-render-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
