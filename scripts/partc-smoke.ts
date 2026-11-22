/**
 * KETER-TYPE v0.6.0 — Part C smoke checks (§2 / §6 / §8).
 *
 * Run from the repo root:  npx tsx scripts/partc-smoke.ts
 *
 * Pure-engine checks (no browser, no React): the custom-layout
 * pagination path, per-page overrides, polygon / cut-out flow, the
 * edit → re-paginate contract the main-view InlineTextEditor commits
 * through, title-page border fit + drag offsets, and the IDML border
 * frames. The repo's own suites run last for regression coverage.
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import JSZip from 'jszip';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine, applyValidatedAiAction } from '../src/engine/design-settings-engine';
import {
  boxFlowIntervals,
  defaultBoxesForBaseLayout,
  makeCustomLayoutBox,
  makePolygonShape,
} from '../src/engine/custom-layout-engine';
import {
  buildTitlePageBorderCommands,
  layoutTitlePageFields,
  titlePageBorderImageRect,
} from '../src/engine/title-page-borders';
import { titlePageSettingsToCoverData } from '../src/engine/toc-engine';
import { PdfExporter } from '../src/engine/pdf-exporter';
import { IdmlExporter } from '../src/engine/idml-exporter';
import { LayoutTestSuite } from '../src/engine/layout-test-suite';
import { DEFAULT_TITLE_PAGE_SETTINGS } from '../src/types/design-settings';
import type { ContentUnit, PageGeometry, PageTypesetResult } from '../src/types/typesetter';
import type { CustomLayoutBox, ProfessionalDesignSettings, TitlePageSettings } from '../src/types/design-settings';

const GEOMETRY: PageGeometry = {
  pageWidth: 482,
  pageHeight: 680,
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

const SENTENCE =
  'יְסוֹד הַחֲסִידוּת וְשֹׁרֶשׁ הָעֲבוֹדָה הַתְּמִימָה הוּא שֶׁיִּתְבָּרֵר וְיִתְאַמֵּת אֵצֶל הָאָדָם מַה חוֹבָתוֹ בְּעוֹלָמוֹ וּלְמַה צָּרִיךְ שֶׁיִּשִּׂים מַבָּטוֹ וּמְגַמָּתוֹ בְּכָל אֲשֶׁר הוּא עָמֵל. ';
const COMMENT = 'אָמַר רַבִּי יְהוּדָה אָמַר רַב: כָּל הָעוֹסֵק בַּתּוֹרָה לִשְׁמָהּ — זוֹכֶה לִדְבָרִים הַרְבֵּה, וְנִקְרָא רֵעַ וְאָהוּב, אוֹהֵב אֶת הַמָּקוֹם וְאוֹהֵב אֶת הַבְּרִיּוֹת. ';

function makeUnits(mainReps = 60, commentReps = 60): ContentUnit[] {
  return [
    {
      id: 'smoke-main',
      role: 'main_source',
      rawText: SENTENCE.repeat(mainReps),
      styleName: 'Normal',
      order: 1,
      hierarchyLevel: 2,
    },
    {
      id: 'smoke-rashi',
      role: 'primary_comment',
      rawText: COMMENT.repeat(commentReps),
      styleName: 'Normal',
      order: 2,
      hierarchyLevel: 3,
    },
  ];
}

function customLayoutSettings(boxes: CustomLayoutBox[]): ProfessionalDesignSettings {
  const s = DesignSettingsEngine.createDefaultSettings({
    layoutType: 'custom_layout',
    geometry: GEOMETRY,
  });
  return DesignSettingsEngine.setCustomLayout(
    s,
    { enabled: true, baseLayout: 'rav_text', boxes },
    'user'
  ).settings;
}

function allLines(doc: { pages: PageTypesetResult[] }): PageTypesetResult[] {
  return doc.pages;
}

console.log('§2(a) — custom-layout pagination actually paginates (not the rav_text solver)');
{
  const boxes = [
    makeCustomLayoutBox('main_text', 0, 0, 100, 55),
    makeCustomLayoutBox('commentary', 0, 60, 100, 40),
  ];
  const settings = customLayoutSettings(boxes);
  const doc = PaginationEngine.paginateDocument({
    title: 'Part C smoke',
    layoutType: 'custom_layout',
    units: makeUnits(),
    geometry: GEOMETRY,
    designSettings: settings,
  });
  const bodyPages = allLines(doc);
  check('long text overflows to a second folio', bodyPages.length >= 2, `${bodyPages.length} pages`);
  const lines = bodyPages.flatMap(p => [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines, ...p.footnoteLines]);
  check('lines were placed', lines.length > 20, `${lines.length} lines`);
  const tagged = lines.filter(l => l.customLayoutBoxId);
  check('every line knows its box', tagged.length === lines.length, `${tagged.length}/${lines.length} tagged`);
  const usedBoxes = new Set(tagged.map(l => l.customLayoutBoxId));
  check('both boxes received text', usedBoxes.size >= 2, [...usedBoxes].join(', '));
  // Box-driven, not rav_text: every line stays inside its own box rect.
  const boxById = new Map(boxes.map(b => [b.id, b]));
  const inside = tagged.every(l => {
    const b = boxById.get(l.customLayoutBoxId!);
    if (!b) return false;
    const bx = (b.xPct / 100) * CONTENT_W;
    const bw = (b.widthPct / 100) * CONTENT_W;
    return (l.xLeft ?? 0) >= bx - 1 && (l.xRight ?? 0) <= bx + bw + 1;
  });
  check('lines stay inside their box rects', inside);
  // The same units under rav_text paginate differently (proves dispatch).
  const rav = PaginationEngine.paginateDocument({
    title: 'Part C smoke',
    layoutType: 'rav_text',
    units: makeUnits(),
    geometry: GEOMETRY,
    designSettings: DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY }),
  });
  const ravLines = rav.pages.flatMap(p => [...p.sourceLines, ...p.rashiLines]);
  const ravTagged = ravLines.filter(l => l.customLayoutBoxId).length;
  check('rav_text output carries no box tags', ravTagged === 0, `${ravTagged} tagged`);
  // Strongest dispatch proof: in the custom layout the commentary lines
  // all sit inside the commentary box's y-band (60–100% of the content
  // height — line coordinates are content-relative, 0 = content top,
  // exactly like the rav_text solver's); the rav_text solver
  // interleaves commentary around the source instead, so its Rashi
  // lines start far above that band.
  const boxBTop = 0.6 * CONTENT_H;
  const customRashi = bodyPages.flatMap(p => p.rashiLines);
  const rashiInBand = customRashi.length > 0 && customRashi.every(l => (l.yTop ?? 0) >= boxBTop - 2);
  check('commentary lines sit inside the commentary box band', rashiInBand, `${customRashi.length} rashi lines, band top ${boxBTop.toFixed(0)}pt`);
  const ravRashi = rav.pages.flatMap(p => p.rashiLines);
  const ravRashiAboveBand = ravRashi.some(l => (l.yTop ?? 0) < boxBTop - 2);
  check('rav_text commentary is NOT confined to that band (different solver)', ravRashiAboveBand, `${ravRashi.length} rav rashi lines`);
}

console.log('§2(b) — per-page override saves, loads, and leaves other pages alone');
{
  const globalBoxes = [
    makeCustomLayoutBox('main_text', 0, 0, 100, 55),
    makeCustomLayoutBox('commentary', 0, 60, 100, 40),
  ];
  const overrideBoxes = [makeCustomLayoutBox('main_text', 0, 0, 100, 100)];
  const settings = customLayoutSettings(globalBoxes);
  const withOverride = DesignSettingsEngine.setCustomLayoutPageOverride(
    settings, 1, overrideBoxes, 'user'
  ).settings;
  const doc = PaginationEngine.paginateDocument({
    title: 'Part C smoke',
    layoutType: 'custom_layout',
    units: makeUnits(90, 90),
    geometry: GEOMETRY,
    designSettings: withOverride,
  });
  check('book still paginates with an override', doc.pages.length >= 2, `${doc.pages.length} pages`);
  const page0Boxes = new Set(
    [...doc.pages[0].sourceLines, ...doc.pages[0].rashiLines].map(l => l.customLayoutBoxId)
  );
  const page1Boxes = new Set(
    [...doc.pages[1].sourceLines, ...doc.pages[1].rashiLines].map(l => l.customLayoutBoxId)
  );
  check('page 1 (body idx 0) uses the global boxes', [...page0Boxes].every(id => globalBoxes.some(b => b.id === id)), [...page0Boxes].join(', '));
  check('page 2 (body idx 1) uses only the override box', page1Boxes.size >= 1 && [...page1Boxes].every(id => overrideBoxes.some(b => b.id === id)), [...page1Boxes].join(', '));
  // JSON round-trip (what project-persistence stores): the override survives.
  const roundTripped = JSON.parse(JSON.stringify(withOverride)) as ProfessionalDesignSettings;
  const kept = roundTripped.pageLayout.customLayout?.pageOverrides?.['1'];
  check('override survives a project-JSON round-trip', Array.isArray(kept) && kept.length === 1 && kept[0].id === overrideBoxes[0].id);
  // Clearing it returns the page to the global template.
  const cleared = DesignSettingsEngine.clearCustomLayoutPageOverride(withOverride, 1, 'user').settings;
  check('clearing removes the override', !cleared.pageLayout.customLayout?.pageOverrides?.['1']);
}

console.log('§2(c) — polygon frames: text flows inside the shape and around cut-outs');
{
  // L-shape: top band is only the left stem (55% wide), the foot is full width.
  const lBox = makeCustomLayoutBox('main_text', 0, 0, 100, 100);
  lBox.shape = makePolygonShape('l_shape');
  const top = boxFlowIntervals(lBox, 0, 20, CONTENT_W, CONTENT_H);
  const foot = boxFlowIntervals(lBox, CONTENT_H * 0.8, CONTENT_H * 0.8 + 20, CONTENT_W, CONTENT_H);
  check('L-shape top band is the narrow stem', top.length === 1 && top[0].width < CONTENT_W * 0.6, `w=${top[0]?.width.toFixed(0)}pt of ${CONTENT_W}pt`);
  check('L-shape foot band is full width', foot.length === 1 && foot[0].width > CONTENT_W * 0.95, `w=${foot[0]?.width.toFixed(0)}pt`);
  // Cut-out: a rectangle box with a middle cut-out the text must go around.
  const cutBox = makeCustomLayoutBox('main_text', 0, 0, 100, 100);
  cutBox.exclusions = [{ id: 'cut-1', points: [{ x: 0.35, y: 0.4 }, { x: 0.65, y: 0.4 }, { x: 0.65, y: 0.6 }, { x: 0.35, y: 0.6 }] }];
  const midY = CONTENT_H * 0.5;
  const mid = boxFlowIntervals(cutBox, midY - 10, midY + 10, CONTENT_W, CONTENT_H);
  const cutX0 = 0.35 * CONTENT_W;
  const cutX1 = 0.65 * CONTENT_W;
  const avoids = mid.length >= 2 && mid.every(iv => iv.xRight <= cutX0 + 1 || iv.xLeft >= cutX1 - 1);
  check('cut-out band splits into two intervals that avoid the hole', avoids, `${mid.length} intervals`);
  const above = boxFlowIntervals(cutBox, CONTENT_H * 0.1, CONTENT_H * 0.1 + 20, CONTENT_W, CONTENT_H);
  check('band above the cut-out is whole again', above.length === 1 && above[0].width > CONTENT_W * 0.95);
  // Pagination level: the exclusion really splits a line into two segments on one baseline.
  const settings = customLayoutSettings([cutBox]);
  const doc = PaginationEngine.paginateDocument({
    title: 'Part C smoke',
    layoutType: 'custom_layout',
    units: makeUnits(40, 0).slice(0, 1),
    geometry: GEOMETRY,
    designSettings: settings,
  });
  const src = doc.pages.flatMap(p => p.sourceLines);
  const byBaseline = new Map<number, number>();
  for (const l of src) byBaseline.set(Math.round(l.yBaseline * 10), (byBaseline.get(Math.round(l.yBaseline * 10)) ?? 0) + 1);
  const splitBaseline = [...byBaseline.values()].some(n => n >= 2);
  check('pagination splits a line around the cut-out (two segments, one baseline)', splitBaseline, `${src.length} source lines`);
}

console.log('§6 — main-view editing: an edit updates the text and re-paginates');
{
  // The engine contract behind App.handleCommitInPlaceUnitEdit →
  // setContentUnits → bookDoc memo: editing a unit and re-paginating
  // must change the solved pages. (The React commit path itself is
  // verified by tsc + code review, not by this Node script.)
  const settings = customLayoutSettings(defaultBoxesForBaseLayout('rav_text'));
  const units = makeUnits(30, 30);
  const before = PaginationEngine.paginateDocument({
    title: 'Part C smoke', layoutType: 'custom_layout', units, geometry: GEOMETRY, designSettings: settings,
  });
  const edited = units.map(u =>
    u.id === 'smoke-main' ? { ...u, rawText: u.rawText + SENTENCE.repeat(60) } : u
  );
  const after = PaginationEngine.paginateDocument({
    title: 'Part C smoke', layoutType: 'custom_layout', units: edited, geometry: GEOMETRY, designSettings: settings,
  });
  const countLines = (d: { pages: PageTypesetResult[] }) =>
    d.pages.reduce((n, p) => n + p.sourceLines.length + p.rashiLines.length, 0);
  check('editing a unit and re-paginating adds pages/lines', after.pages.length >= before.pages.length && countLines(after) > countLines(before), `${before.pages.length}p/${countLines(before)} lines → ${after.pages.length}p/${countLines(after)} lines`);
  // AI: a per-page override patch validates and applies.
  const ai = applyValidatedAiAction(settings, 'update_design_settings', {
    patch: {
      customLayoutPageOverride: {
        pageIndex: 0,
        boxes: [makeCustomLayoutBox('main_text', 0, 0, 100, 100)],
      },
    },
  });
  check('AI per-page override patch applies', ai !== null && !!ai.settings.pageLayout.customLayout?.pageOverrides?.['0'], ai?.summaryHe ?? 'rejected');
  const aiBad = applyValidatedAiAction(settings, 'update_design_settings', {
    patch: { customLayoutPageOverride: { pageIndex: -1, boxes: [] } },
  });
  check('AI per-page override with a bad index is rejected', aiBad === null);
}

console.log('§8 — title page: border fit, drag offsets, and per-field line height persist');
{
  const tp: TitlePageSettings = JSON.parse(JSON.stringify(DEFAULT_TITLE_PAGE_SETTINGS));
  tp.enabled = true;
  tp.title.text = 'ספר הבדיקה';
  tp.subtitle.text = 'עם פירוש רש״י';
  tp.border.styleId = 'double';
  tp.border.scalePct = 150;
  tp.border.paddingMm = 10;
  tp.border.offsetXMm = 5;
  tp.border.offsetYMm = -5;
  tp.title.yOffsetPt = 20;
  tp.title.xOffsetPt = 15;
  tp.title.lineHeight = 1.8;
  tp.subtitle.lineHeight = 1.5;

  const rows = layoutTitlePageFields(tp, 'ספר הבדיקה', GEOMETRY.pageHeight);
  const titleRow = rows.find(r => r.fieldId === 'title');
  const baseRows = layoutTitlePageFields(DEFAULT_TITLE_PAGE_SETTINGS, 'ספר הבדיקה', GEOMETRY.pageHeight);
  const baseTitleRow = baseRows.find(r => r.fieldId === 'title');
  check('drag y-offset moves the title baseline', !!titleRow && !!baseTitleRow && Math.abs(titleRow.yBaselinePt - baseTitleRow.yBaselinePt - 20) < 0.01, `Δ=${titleRow && baseTitleRow ? (titleRow.yBaselinePt - baseTitleRow.yBaselinePt).toFixed(1) : '?'}pt`);
  check('drag x-offset is carried on the row', titleRow?.xOffsetPt === 15, `xOffsetPt=${titleRow?.xOffsetPt}`);
  check('line height is carried on the row', titleRow?.lineHeight === 1.8, `lineHeight=${titleRow?.lineHeight}`);
  check('subtitle line height is carried', rows.find(r => r.fieldId === 'subtitle')?.lineHeight === 1.5);

  const rectFit = titlePageBorderImageRect(tp.border, GEOMETRY.pageWidth, GEOMETRY.pageHeight);
  const rectBase = titlePageBorderImageRect(
    { ...DEFAULT_TITLE_PAGE_SETTINGS.border, scalePct: 100, paddingMm: 0, offsetXMm: 0, offsetYMm: 0 },
    GEOMETRY.pageWidth, GEOMETRY.pageHeight
  );
  check('border scale changes the fitted rect', Math.abs(rectFit.w - rectBase.w) > 1, `w ${rectBase.w.toFixed(1)} → ${rectFit.w.toFixed(1)}pt`);
  check('border offset shifts the fitted rect', Math.abs(rectFit.x - rectBase.x) > 0.5 || Math.abs(rectFit.y - rectBase.y) > 0.5, `x ${rectBase.x.toFixed(1)} → ${rectFit.x.toFixed(1)}`);

  const cmdsFit = buildTitlePageBorderCommands('double', tp.border.insetMm, tp.border.thicknessPt, GEOMETRY.pageWidth, GEOMETRY.pageHeight, {
    scalePct: tp.border.scalePct, paddingMm: tp.border.paddingMm, offsetXMm: tp.border.offsetXMm, offsetYMm: tp.border.offsetYMm,
  });
  const cmdsBase = buildTitlePageBorderCommands('double', 12, 1, GEOMETRY.pageWidth, GEOMETRY.pageHeight);
  check('border commands honour the fit geometry', cmdsFit.length > 0 && JSON.stringify(cmdsFit) !== JSON.stringify(cmdsBase));

  const cover = titlePageSettingsToCoverData(tp, 'ספר הבדיקה');
  check('cover data carries the border fit', cover.borderScalePct === 150 && cover.borderPaddingMm === 10 && cover.borderOffsetXMm === 5 && cover.borderOffsetYMm === -5);
  check('cover data carries the per-field styles', cover.fieldStyles?.title?.yOffsetPt === 20 && cover.fieldStyles?.title?.lineHeight === 1.8);

  // Regression (found by this smoke run): syncDerivedViews rebuilt
  // every title-page field from the v0.5.0 keys only, silently wiping
  // lineHeight / drag offsets / border fit on EVERY settings save
  // (cloneSettings → syncDerivedViews). The panel and the AI both save
  // through sanitizeAndEnforceHardRules, so the fields must survive it.
  const settingsWithTpDirect = DesignSettingsEngine.createDefaultSettings({ layoutType: 'single_column', geometry: GEOMETRY });
  settingsWithTpDirect.titlePage = JSON.parse(JSON.stringify(tp));
  const saved = DesignSettingsEngine.sanitizeAndEnforceHardRules(settingsWithTpDirect).settings;
  check('drag offsets + line height survive a settings save', saved.titlePage?.title.yOffsetPt === 20 && saved.titlePage?.title.xOffsetPt === 15 && saved.titlePage?.title.lineHeight === 1.8);
  check('border fit survives a settings save', saved.titlePage?.border.scalePct === 150 && saved.titlePage?.border.paddingMm === 10 && saved.titlePage?.border.offsetXMm === 5 && saved.titlePage?.border.offsetYMm === -5);

  // Render plan: the canvas/native paths see the same rows + fit.
  const doc = PaginationEngine.paginateDocument({
    title: 'ספר הבדיקה', layoutType: 'single_column', units: makeUnits(2, 2), geometry: GEOMETRY,
    designSettings: DesignSettingsEngine.createDefaultSettings({ layoutType: 'single_column', geometry: GEOMETRY }),
  });
  const settingsWithTp = DesignSettingsEngine.createDefaultSettings({ layoutType: 'single_column', geometry: GEOMETRY });
  settingsWithTp.titlePage = tp;
  const titlePage: PageTypesetResult = {
    ...doc.pages[0],
    pageIndex: 0,
    pageNumber: 1,
    isTitlePage: true,
    sourceLines: [],
    rashiLines: [],
    tosafotLines: [],
    footnoteLines: [],
    designSettings: settingsWithTp,
  };
  const plan = PdfExporter.buildPageRenderPlan(titlePage);
  check('render plan marks the title page', plan.isTitlePage === true && !!plan.titlePage);
  check('render plan rows carry the drag offsets', plan.titlePage?.rows.find(r => r.text === 'ספר הבדיקה')?.xOffsetPt === 15);
  check('render plan carries the border fit', plan.titlePage?.borderScalePct === 150 && plan.titlePage?.borderOffsetXMm === 5);

  // AI: title-page border fit + line height validate and apply.
  const ai = applyValidatedAiAction(settingsWithTp, 'update_design_settings', {
    patch: {
      titlePage: { borderScalePct: 80, borderPaddingMm: 5, borderOffsetXMm: -3, fieldLineHeight: { title: 1.6 } },
    },
  });
  check('AI title-page border-fit patch applies', ai !== null && ai.settings.titlePage?.border.scalePct === 80 && ai.settings.titlePage?.title.lineHeight === 1.6, ai?.summaryHe ?? 'rejected');
  const aiBad = applyValidatedAiAction(settingsWithTp, 'update_design_settings', {
    patch: { titlePage: { borderScalePct: 500 } },
  });
  check('AI title-page border scale out of range is rejected', aiBad === null);
}

console.log('§8 — IDML: the title-page border is emitted as graphic frames');
{
  const tp: TitlePageSettings = JSON.parse(JSON.stringify(DEFAULT_TITLE_PAGE_SETTINGS));
  tp.enabled = true;
  tp.title.text = 'ספר הבדיקה';
  tp.border.styleId = 'double';
  tp.border.scalePct = 120;
  const settings = DesignSettingsEngine.createDefaultSettings({ layoutType: 'single_column', geometry: GEOMETRY });
  settings.titlePage = tp;
  const doc = PaginationEngine.paginateDocument({
    title: 'ספר הבדיקה', layoutType: 'single_column', units: makeUnits(2, 2), geometry: GEOMETRY, designSettings: settings,
  });
  const titlePage: PageTypesetResult = {
    ...doc.pages[0],
    pageIndex: 0,
    pageNumber: 1,
    isTitlePage: true,
    sourceLines: [],
    rashiLines: [],
    tosafotLines: [],
    footnoteLines: [],
    designSettings: settings,
  };
  const fullDoc = { ...doc, designSettings: settings, pages: [titlePage, ...doc.pages], totalPages: doc.pages.length + 1 };
  const blob = await IdmlExporter.generateMultiPageIdml(fullDoc);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const spreadNames = Object.keys(zip.files).filter(n => n.startsWith('Spreads/'));
  check('IDML package has spreads', spreadNames.length >= 2, `${spreadNames.length} spreads`);
  const titleSpread = await zip.file(spreadNames[0])!.async('text');
  check('title spread contains the border rectangle', titleSpread.includes('<Rectangle Self="tf_border_0"'));
  check('double border emits the inner rectangle too', titleSpread.includes('<Rectangle Self="tf_border_inner_0"'));
  check('border stroke references the registered swatch', titleSpread.includes('StrokeColor="Color/KeterBorder"'));
  const graphicXml = await zip.file('Resources/Graphic.xml')!.async('text');
  check('border swatch is registered in Graphic.xml', graphicXml.includes('Color/KeterBorder'));
  const bodySpread = await zip.file(spreadNames[1])!.async('text');
  check('body spreads carry no border rectangle', !bodySpread.includes('<Rectangle Self="tf_border_'));
}

console.log('Repo suites (regression)');
{
  const difficult = LayoutTestSuite.runAllDifficultCases();
  console.log(`  difficult cases: ${difficult.passedCount}/${difficult.totalCount}`);
  check('runAllDifficultCases — all pass', difficult.allPassed, difficult.cases.filter(c => !c.passed).map(c => c.id).join(', ') || `${difficult.passedCount}/${difficult.totalCount}`);
  const a1 = LayoutTestSuite.runStage13A1Tests();
  console.log(`  stage 13A1: ${a1.passedCount}/${a1.totalCount}`);
  check('runStage13A1Tests — all pass', a1.allPassed, a1.assertions.filter(c => !c.passed).map(c => c.id).join(', ') || `${a1.passedCount}/${a1.totalCount}`);
  const a2 = await LayoutTestSuite.runStage13A2Tests();
  console.log(`  stage 13A2: ${a2.passedCount}/${a2.totalCount}`);
  check('runStage13A2Tests — all pass', a2.allPassed, a2.assertions.filter(c => !c.passed).map(c => c.id).join(', ') || `${a2.passedCount}/${a2.totalCount}`);
}

console.log(`\npartc-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
