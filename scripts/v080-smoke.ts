/**
 * KETER-TYPE v0.8.0 — integration audit smoke (merge verification).
 *
 * Run from the repo root:  npx tsx scripts/v080-smoke.ts
 *
 * Pure-engine checks (no browser, no React) over the MERGED v0.8.0 tree:
 *  §A  the audit's worst 10 broken/fake features, spot-checked as fixed-or-gone
 *  §B  preset-switch sequence Vilna Shas → Two Columns → Footnote Tiers
 *      → Custom Polygons: no overlapping tier boxes, no residual state
 *  §C  mock panels gone: ZERO code references to page_design/layers/glyphs
 *      in src/, no 'type' button in the toolbar, T shortcut still arms the
 *      internal 'type' tool (merge decision, task §3)
 *  §D  Yiddish preset renders and paginates (Part D sample)
 *  §E  flank consistency: the knee solver's recto Rashi side ==
 *      flankPhysicalSides(2a).rashi (the ONE Hebrew-book rule)
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { DocxImporter } from '../src/engine/docx-importer';
import type { BookLayoutType, ContentUnit, PageGeometry, PageTypesetResult, TypesetLine } from '../src/types/typesetter';
import type { LocalRuleOverride } from '../src/engine/typesetting-rules-engine';
import type { ShasFlaw } from '../src/engine/vilna-shas';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

/** An 8-role document: every role the audit found silently dropped. */
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
    title: 'v080 smoke',
    layoutType,
    units,
    geometry: GEOMETRY,
    designSettings: settings,
    localOverrides: overrides?.localOverrides,
  });
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Strip line/block comments so docstrings about a removal don't count as a reference. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkSrc(p));
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- §A: worst 10
console.log('v080 §A: audit worst 10 — fixed or gone');
{
  // #1 — rav_text/mikraot silently dropped heading/siman/tertiary/list/table.
  const rav = paginate('rav_text', makeEightRoleUnits());
  const placed = placedUnitIds(rav);
  const missing = makeEightRoleUnits().map(u => u.id).filter(id => !placed.has(id));
  check('#1 paginator drops nothing: all 8 roles placed in rav_text, unplaced empty',
    missing.length === 0 && (rav.unplacedUnitIds ?? []).length === 0,
    missing.length > 0 ? `missing: ${missing.join(', ')}` : `${rav.pages.length} pages`);

  // #2 — tier system was write-only; tier edits did nothing.
  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY });
  const sized = DesignSettingsEngine.updateTierConfig(base, 2, { fontSizePt: 12 }, 'user').settings;
  const sizedDoc = paginate('rav_text', makeEightRoleUnits(), { designSettings: sized });
  const rashiSizes = new Set(sizedDoc.pages.flatMap(p => p.rashiLines.flatMap(l => l.words.map(w => w.fontSizePt))));
  check('#2 tier edits move the render: tier fontSize 12 → shaped Rashi words 12pt', rashiSizes.has(12), [...rashiSizes].join(', '));

  // #3 — Shas widow/orphan one-click fix was a no-op reporting success.
  const oneLineUnit: ContentUnit = { id: 'u-one', role: 'main_source', rawText: 'שורה אחת בלבד.', styleName: 'Normal', order: 1, hierarchyLevel: 2 };
  const fakePage = {
    pageIndex: 1, pageNumber: 2, pageNumberHebrew: 'ב׳', headerTitle: '', layoutType: 'rav_text',
    geometry: GEOMETRY, sourceLines: [], rashiLines: [], tosafotLines: [], footnoteLines: [],
    knee: { pageContentWidth: CONTENT_W, pageContentHeight: CONTENT_H, topY: 0, kneeJunctionY: CONTENT_H, bottomY: CONTENT_H, upperSourceWidth: CONTENT_W, lowerSourceWidth: CONTENT_W, innerXOffset: 0, isLeftStepped: false, rightCommentaryWidth: 0, leftCommentaryWidth: 0, gutterWidth: 0 },
    occupiedRegions: [], layoutScore: undefined,
  } as unknown as PageTypesetResult;
  const flaw: ShasFlaw = { kind: 'widow', pageNumber: 2, unitId: 'u-one', messageHe: 'שורה יתומה', autoFixable: true };
  const fix = fixShasFlaws([flaw], [oneLineUnit], [], [fakePage]);
  check('#3 widow fix is honest: single-line-unit flaw skipped, not "fixed"',
    fix.fixedCount === 0 && fix.skippedCount === 1 && fix.overrides.length === 0);

  // #4 — Vilna flanks inverted vs the declared rule (helpers only here; knee check is §E).
  check('#4 flank helpers state the Hebrew-book rule: 2a left/Rashi right, 2b right/Rashi left',
    spreadSide(2, 'talmud') === 'left' && spreadSide(3, 'talmud') === 'right' &&
    flankPhysicalSides(2, 'talmud').rashi === 'right' && flankPhysicalSides(3, 'talmud').rashi === 'left' &&
    spreadSideForPageIndex(0) === 'left' && spreadSideForPageIndex(1) === 'right');

  // #5 — Control Panel Y/Height hardcoded 680pt.
  const vilna = frameGeometryPt({ xPct: 10, yPct: 97.2, widthPct: 80, heightPct: 8 }, 482, 720);
  const a4 = frameGeometryPt({ xPct: 10, yPct: 100, widthPct: 80, heightPct: 100 }, 482, 842);
  check('#5 Control Panel Y/Height use the real page height (Vilna 700pt on-page, A4 842pt)',
    Math.abs(vilna.yPt - 700) < 1 && vilna.yPt < 720 && a4.heightPt === 842 &&
    resolveMeasurementOrigin(100, 482, true).xFromOriginPt === 100 &&
    resolveMeasurementOrigin(100, 482, false).xFromOriginPt === 382,
    `Vilna yPt ${vilna.yPt}, A4 heightPt ${a4.heightPt}`);

  // #6 — Pages "Insert page" was a no-op outside single_column.
  const breakOverride = (unitId: string): LocalRuleOverride => ({
    id: `pb-${unitId}`, ruleId: 'paragraph.allowContinuationAcrossPages', category: 'paragraph', enabled: true,
    priority: 'HARD_USER_RULE', isHardConstraint: true, value: false, source: 'local',
    scope: { unitId }, forcePageBreakBeforeUnitId: unitId,
  });
  const breakUnits: ContentUnit[] = [
    { id: 'u-a', role: 'main_source', rawText: GEMARA.repeat(30), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'u-break', role: 'heading', rawText: 'פרק שני', styleName: 'Heading 1', order: 2, hierarchyLevel: 1 },
    { id: 'u-b', role: 'main_source', rawText: GEMARA.repeat(30), styleName: 'Normal', order: 3, hierarchyLevel: 2 },
    { id: 'u-r', role: 'primary_comment', rawText: RASHI.repeat(20), styleName: 'Normal', order: 4, hierarchyLevel: 3, linkedSourceId: 'u-a' },
    { id: 'u-t', role: 'secondary_comment', rawText: TOSAFOT.repeat(20), styleName: 'Normal', order: 5, hierarchyLevel: 3, linkedSourceId: 'u-a' },
  ];
  const ravBreak = paginate('rav_text', breakUnits, { localOverrides: [breakOverride('u-break')] });
  const pageOf = (unitId: string) => ravBreak.pages.findIndex(p => allLines(p).some(l => l.unitId === unitId));
  check('#6 Insert Page force-break works in rav_text (heading starts a later page)',
    pageOf('u-break') > pageOf('u-a') && pageOf('u-break') >= 1, `u-a p${pageOf('u-a') + 1} → u-break p${pageOf('u-break') + 1}`);

  // #7 — Michtav boxes were dead code (zero callers).
  const off = paginate('rav_text', makeEightRoleUnits());
  const vilnaSettings = DesignSettingsEngine.updateRavTextSettings(
    DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY }),
    { michtavEnabled: true, michtavText: 'מכתב' }, 'user');
  const on = paginate('rav_text', makeEightRoleUnits(), { designSettings: vilnaSettings });
  check('#7 Michtav box is real: off by default, on → box on page 0 with the text',
    !off.pages[0]?.michtavBox && !!on.pages[0]?.michtavBox && on.pages[0]?.michtavBox?.text === 'מכתב');

  // #8 — docx images were silently dropped at import; now they get image-only pages.
  const imgUnits: ContentUnit[] = [
    { id: 'u-text', role: 'main_source', rawText: GEMARA.repeat(10), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'u-img', role: 'image', rawText: 'תמונה', styleName: 'Normal', order: 2, hierarchyLevel: 2, imageData: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', fileName: 'test.png', altText: 'test image' } },
  ];
  const imgDoc = paginate('single_column', imgUnits);
  const imgPage = imgDoc.pages.find(p => p.isImageOnlyPage);
  check('#8 imported image survives: image-only page carries the unit id + payload',
    !!imgPage && (imgPage.imageUnitIds ?? []).includes('u-img') && (imgPage.pageImages ?? []).length === 1);

  // #9 — Paragraph/Character Styles panels were read-only lists with swapped contents.
  const appSrc = readSrc('src/App.tsx');
  check('#9 style panels are real: click applies via setLocalUnitOverride (not just opens a drawer)',
    appSrc.includes('setLocalUnitOverride') && appSrc.includes('paragraph_styles') && appSrc.includes('character_styles'));

  // #10 — named workspaces were save-only (load had no callers).
  check('#10 named workspaces are loadable: App wires loadSavedWorkspaces through the picker',
    appSrc.includes('handleLoadNamedWorkspace') && appSrc.includes('loadSavedWorkspaces()'));
}

// ------------------------------------------------- §B: preset-switch sequence
console.log('v080 §B: preset-switch sequence Vilna Shas → Two Columns → Footnote Tiers → Custom Polygons');
{
  const units = makeEightRoleUnits();
  const seq: Array<{ layout: BookLayoutType; label: string }> = [
    { layout: 'rav_text', label: 'Vilna Shas (rav_text)' },
    { layout: 'two_column', label: 'Two Columns' },
    { layout: 'source_top_commentary_bottom', label: 'Footnote Tiers (source_top_commentary_bottom)' },
    { layout: 'custom_layout', label: 'Custom Polygons (custom_layout)' },
  ];
  for (const { layout, label } of seq) {
    const doc = paginate(layout, units);
    const collisions = doc.pages.reduce((a, p) => a + (p.layoutScore?.collisionCount ?? 0), 0);
    check(`${label}: 0 collisions`, collisions === 0, `${collisions} collisions`);
    const outOfBounds = doc.pages.flatMap(p => allLines(p)).filter(l => {
      const xL = l.xLeft ?? 0;
      const xR = l.xRight ?? CONTENT_W;
      const yT = l.yTop ?? l.yBaseline - l.ascent;
      const yB = l.yBottom ?? l.yBaseline + l.descent;
      return xL < -0.5 || xR > CONTENT_W + 0.5 || yT < -0.5 || yB > CONTENT_H + 0.5;
    });
    check(`${label}: no line outside page bounds`, outOfBounds.length === 0, `${outOfBounds.length} out of bounds`);
    check(`${label}: no units silently dropped`, (doc.unplacedUnitIds ?? []).length === 0);
  }
  // Tier boxes must not overlap in 2D: on rav_text pages the Rashi and
  // Tosafot flanks are disjoint x-intervals WHERE THEY SHARE A Y-BAND.
  // (x-only comparison is a false positive: once the Gemara source is
  // exhausted on a page, the commentary legitimately flows full-width
  // BELOW the source block, at y-bands where no Rashi line sits. The
  // engine's collisionCount is the 2D verdict; this check re-derives it
  // per line pair.)
  const rav = paginate('rav_text', units);
  let flankOverlap = 0;
  let tertiaryOverlap = 0;
  const yInt = (l: TypesetLine) => [l.yTop ?? l.yBaseline - l.ascent, l.yBottom ?? l.yBaseline + l.descent] as const;
  const xInt = (l: TypesetLine) => [l.xLeft ?? 0, l.xRight ?? 0] as const;
  for (const pg of rav.pages) {
    for (const rl of pg.rashiLines) {
      const [rx0, rx1] = xInt(rl);
      const [ry0, ry1] = yInt(rl);
      for (const tl of pg.tosafotLines) {
        const [tx0, tx1] = xInt(tl);
        const [ty0, ty1] = yInt(tl);
        if (rx0 < tx1 && tx0 < rx1 && ry0 < ty1 && ty0 < ry1) flankOverlap++;
      }
    }
    const ter = pg.tertiaryLines ?? [];
    if (ter.length && pg.sourceLines.length) {
      const bodyBottom = Math.max(...pg.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent));
      const terTop = Math.min(...ter.map(l => l.yTop ?? l.yBaseline - l.ascent));
      if (terTop < bodyBottom - 0.5) tertiaryOverlap++;
    }
  }
  check('rav_text: no Rashi/Tosafot line pair overlaps in 2D (flank boxes disjoint)', flankOverlap === 0, `${flankOverlap} overlapping line pairs`);
  check('rav_text: tertiary band sits below the body, never over it', tertiaryOverlap === 0, `${tertiaryOverlap} pages overlap`);

  // No residual state after leaving custom_layout: no stale box ids, and the
  // transaction itself drops mode-specific overrides/breaks (Part C §8 wins).
  const afterCustom = paginate('two_column', units);
  const stale = afterCustom.pages.flatMap(p => allLines(p)).filter(l => l.customLayoutBoxId);
  check('custom_layout → two_column: no residual custom-layout box ids', stale.length === 0);
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
    prevLayout: 'rav_text', nextLayout: 'two_column',
    localOverrides: [keepOverride, forceOverride],
    breakInstructions: [{ id: 'brk-1', anchorUnitId: 'u-x', kind: 'pageEndsBefore', pageIndex: 0, wordIndex: 3 } as never],
    hasCustomPageOverrides: true, selectedUnitId: 'u-x', editingUnitId: null,
  });
  check('preset-switch transaction: drops keep-together/breaks/page overrides, carries force-breaks',
    plan.nextLocalOverrides.length === 1 && plan.nextLocalOverrides[0].id === 'pb-1' &&
    plan.nextBreakInstructions.length === 0 && plan.clearCustomPageOverrides && plan.clearSelection);
}

// ------------------------------------------------- §C: mock panels gone
console.log('v080 §C: mock panels gone — zero code references in src/');
{
  const files = walkSrc(path.join(ROOT, 'src'));
  const hits: string[] = [];
  for (const f of files) {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    for (const id of ["'page_design'", '"page_design"', "'layers'", '"layers"', "'glyphs'", '"glyphs"']) {
      if (code.includes(id)) hits.push(`${path.relative(ROOT, f)}: ${id}`);
    }
  }
  check('no code reference to page_design / layers / glyphs anywhere in src/', hits.length === 0, hits.slice(0, 5).join('; '));
  const layoutSrc = readSrc('src/engine/workspace-layout.ts');
  const panelIds = [...layoutSrc.matchAll(/\| '([a-z_]+)'/g)].map(m => m[1]).filter(id => id.endsWith('_styles') || id === 'links');
  check('PanelId contains exactly the 3 surviving panels', panelIds.length === 3 &&
    panelIds.includes('paragraph_styles') && panelIds.includes('character_styles') && panelIds.includes('links'),
    panelIds.join(', '));
  const toolbarSrc = readSrc('src/components/FrameToolsToolbar.tsx');
  check("no 'type' button in the toolbar (TOOLS has no id: 'type')", !toolbarSrc.includes("id: 'type'"));
  const appSrc = readSrc('src/App.tsx');
  check("T shortcut still arms the internal 'type' tool (Part E draw flow)", appSrc.includes("setActiveTool('type')"));
  check("no reference to a removed 'type' tool id in frame-tools createFrameBox exclusion",
    readSrc('src/engine/frame-tools.ts').includes("Exclude<FrameToolId, 'select' | 'type'>"));
}

// ------------------------------------------------- §D: Yiddish
console.log('v080 §D: Yiddish preset renders and paginates');
{
  const sample = DocxImporter.getSampleYiddishSefer();
  check('Yiddish sample exists (Tzenerene passage)', sample.length > 5, `${sample.length} units`);
  const doc = paginate('yiddish_sefer', sample);
  const placed = placedUnitIds(doc);
  const missing = sample.map(u => u.id).filter(id => !placed.has(id));
  check('yiddish_sefer: all sample units placed, 0 collisions, ≥2 pages',
    missing.length === 0 &&
    doc.pages.reduce((a, p) => a + (p.layoutScore?.collisionCount ?? 0), 0) === 0 &&
    doc.pages.length >= 2,
    `${doc.pages.length} pages${missing.length ? `, missing: ${missing.join(', ')}` : ''}`);
  const allText = doc.pages.flatMap(p => allLines(p)).flatMap(l => l.words ?? []).map(w => w.text).join('');
  check('Yiddish digraphs survive shaping (װ/ױ/ײ present in placed words)',
    /[װױײ]/.test(allText));
  const hasHebrewRight = doc.pages.some(p => p.sourceLines.length > 0);
  const hasYiddishLeft = doc.pages.some(p => (p.column2Lines ?? []).length > 0);
  check('facing columns: Hebrew source (right) + Yiddish (left) on the same pages',
    hasHebrewRight && hasYiddishLeft);
}

// ------------------------------------------------- §E: flank consistency
console.log('v080 §E: flank consistency — knee solver agrees with flankPhysicalSides(2a)');
{
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
  // The required consistency check: the knee's recto Rashi side must equal
  // flankPhysicalSides(2a).rashi — Rashi INNER, and 2a (recto) is the
  // LEFT-hand page of a Hebrew spread, so inner = right.
  const kneeRectoRashiSide = Number.isFinite(rRecto) ? (rRecto > CONTENT_W / 2 ? 'right' : 'left') : 'unknown';
  const kneeVersoRashiSide = Number.isFinite(rVerso) ? (rVerso < CONTENT_W / 2 ? 'left' : 'right') : 'unknown';
  check('flank consistency: knee recto Rashi side == flankPhysicalSides(2a).rashi',
    kneeRectoRashiSide === flankPhysicalSides(2, 'talmud').rashi,
    `knee recto Rashi ${kneeRectoRashiSide} vs helper ${flankPhysicalSides(2, 'talmud').rashi}`);
  check('flank consistency: knee verso Rashi side == flankPhysicalSides(2b).rashi',
    kneeVersoRashiSide === flankPhysicalSides(3, 'talmud').rashi,
    `knee verso Rashi ${kneeVersoRashiSide} vs helper ${flankPhysicalSides(3, 'talmud').rashi}`);
  check('flank consistency: recto Rashi right (inner), verso Rashi left (inner)',
    Number.isFinite(rRecto) && Number.isFinite(rVerso) && rRecto > CONTENT_W / 2 && rVerso < CONTENT_W / 2,
    `recto ${Math.round(rRecto)} vs verso ${Math.round(rVerso)} (contentW ${CONTENT_W})`);
}

console.log(`\nv080-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
