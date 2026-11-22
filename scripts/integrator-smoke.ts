/**
 * KETER-TYPE v0.6.0 — INTEGRATOR smoke suite (cross-part interactions).
 *
 * Run from the repo root:  npx tsx scripts/integrator-smoke.ts
 * Exits non-zero on any failure.
 *
 * This is NOT a re-run of the three part smokes (scripts/partA-smoke.ts,
 * scripts/partB-smoke.ts, scripts/partc-smoke.ts cover those). It covers
 * only the interactions between parts, i.e. the things a per-part merge
 * could silently break:
 *
 *  X1  startup font scan + running-header resolve + split-break
 *      persistence in ONE project state (Parts A + B + C's shared
 *      syncDerivedViews: the header block and the title-page drag/border
 *      fields must BOTH survive a settings save).
 *  X2  custom-layout pagination with a per-page override (Part C
 *      dispatch, run against the merged engine that also carries Part A's
 *      header geometry and Part B's break machinery).
 *  X3  title-page border in the PDF render plan AND in IDML, from the
 *      SAME settings object (Parts A + C both touch pdf-exporter.ts).
 *  X4  sidebar scroll class chain (Part A §9, static).
 *  X5  nav overflow menu contains every action (Part A §10, static).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { resolveRunningHeader } from '../src/types/design-settings';
import type {
  CustomLayoutBox,
  ProfessionalDesignSettings,
  TitlePageSettings,
} from '../src/types/design-settings';
import { DEFAULT_TITLE_PAGE_SETTINGS } from '../src/types/design-settings';
import { PaginationEngine } from '../src/engine/pagination-engine';
import {
  applyBreakInstructions,
  createBreakInstruction,
  toHebrewGematria,
} from '../src/engine/break-instructions';
import { UndoRedoHistoryManager } from '../src/engine/project-persistence';
import { PdfExporter } from '../src/engine/pdf-exporter';
import { IdmlExporter } from '../src/engine/idml-exporter';
import {
  makeCustomLayoutBox,
  defaultBoxesForBaseLayout,
} from '../src/engine/custom-layout-engine';
import type {
  BookLayoutType,
  ContentUnit,
  DynamicKneeContour,
  PageGeometry,
  PageTypesetResult,
  ShapedWord,
  TypesetLine,
} from '../src/types/typesetter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

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

const SENTENCE =
  'יְסוֹד הַחֲסִידוּת וְשֹׁרֶשׁ הָעֲבוֹדָה הַתְּמִימָה הוּא שֶׁיִּתְבָּרֵר וְיִתְאַמֵּת אֵצֶל הָאָדָם מַה חוֹבָתוֹ בְּעוֹלָמוֹ וּלְמַה צָּרִיךְ שֶׁיִּשִּׂים מַבָּטוֹ וּמְגַמָּתוֹ בְּכָל אֲשֶׁר הוּא עָמֵל. ';
const COMMENT =
  'אָמַר רַבִּי יְהוּדָה אָמַר רַב: כָּל הָעוֹסֵק בַּתּוֹרָה לִשְׁמָהּ — זוֹכֶה לִדְבָרִים הַרְבֵּה, וְנִקְרָא רֵעַ וְאָהוּב, אוֹהֵב אֶת הַמָּקָם וְאוֹהֵב אֶת הַבְּרִיּוֹת. ';

function makeUnits(mainReps = 60, commentReps = 60): ContentUnit[] {
  return [
    { id: 'smoke-main', role: 'main_source', rawText: SENTENCE.repeat(mainReps), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'smoke-rashi', role: 'primary_comment', rawText: COMMENT.repeat(commentReps), styleName: 'Normal', order: 2, hierarchyLevel: 3 },
  ];
}

/* ------------------------------------------------------------------ */
/* Shims (same shape as the Part A smoke; Node 24 needs defineProperty */
/* for the getter-only global `navigator`).                            */
/* ------------------------------------------------------------------ */
function installShims() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { permissions: { query: async () => ({ state: 'granted' }) } },
    configurable: true,
    writable: true,
  });
  (globalThis as any).document = {
    fonts: {
      check: (font: string) => font.includes('Frank Ruhl Libre'),
      add: () => undefined,
    },
    createElement: () => ({ getContext: () => null }),
  };
  (globalThis as any).window = {
    atob: (globalThis as any).atob.bind(globalThis),
    btoa: (globalThis as any).btoa.bind(globalThis),
    queryLocalFonts: async () => [
      { family: 'Frank Ruhl Libre', fullName: 'Frank Ruhl Libre', postscriptName: 'FrankRuhlLibre', style: 'Regular' },
    ],
    keterDesktop: {
      listSystemFontFiles: async () => [
        { family: 'David', fileName: 'David.ttf', format: 'ttf' },
        { family: 'Frank Ruhl Libre', fileName: 'FrankRuhlLibre.ttf', format: 'ttf' },
      ],
    },
  };
}

/* ------------------------------------------------------------------ */
/* X1 — scan + header + split persistence in one project state         */
/* ------------------------------------------------------------------ */
console.log('\nX1 — startup scan + running header + split break, one project');
{
  installShims();
  const fontLib = await import('../src/engine/font-library');
  await fontLib.autoScanFontsAtStartup();
  const state = fontLib.getFontScanState();
  // v0.8.0 Part E: getFontScanState() returns null when no scan has run
  // yet — guard instead of assuming a scan happened (TS18047).
  check('X1.1 Electron startup scan finds fonts', state !== null && state.source === 'electron' && state.count === 2, JSON.stringify(state));

  // One settings object carrying Part A's header AND Part C's title-page
  // drag/border state — both must survive the shared save path
  // (sanitize → syncDerivedViews), the riskiest merged function.
  const settings = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY });
  const withHeader = DesignSettingsEngine.updatePageElementsSettings(
    settings,
    { runningHeader: { centerText: 'מסכת ברכות' } },
    'user',
  );
  const tp: TitlePageSettings = JSON.parse(JSON.stringify(DEFAULT_TITLE_PAGE_SETTINGS));
  tp.enabled = true;
  tp.title.text = 'ספר הבדיקה';
  tp.title.xOffsetPt = 15;
  tp.title.yOffsetPt = 20;
  tp.title.lineHeight = 1.8;
  tp.border.styleId = 'double';
  tp.border.scalePct = 150;
  tp.border.paddingMm = 10;
  tp.border.offsetXMm = 5;
  tp.border.offsetYMm = -5;
  const combined: ProfessionalDesignSettings = JSON.parse(JSON.stringify(withHeader));
  combined.titlePage = tp;
  combined.pageElements.showTopHeaderLine = true;
  const saved = DesignSettingsEngine.sanitizeAndEnforceHardRules(combined).settings;
  const fb = { bookTitle: 'מסכת ברכות', folioLabel: 'דף י״ב', editionLabel: 'צורת הדף · מהדורת כתר' };
  const r = resolveRunningHeader(saved.pageElements, fb, 0, true);
  check('X1.2 header text survives a settings save', r.center.text === 'מסכת ברכות', JSON.stringify(r.center));
  check(
    'X1.3 title-page drag offsets + line height + border fit survive the SAME save',
    saved.titlePage?.title.xOffsetPt === 15 &&
      saved.titlePage?.title.yOffsetPt === 20 &&
      saved.titlePage?.title.lineHeight === 1.8 &&
      saved.titlePage?.border.scalePct === 150 &&
      saved.titlePage?.border.paddingMm === 10,
    JSON.stringify(saved.titlePage?.border),
  );
  check(
    'X1.4 header reserve is 24pt on / geometry grows by it (reflow)',
    DesignSettingsEngine.headerReservePt(saved) === 24 &&
      DesignSettingsEngine.paginationGeometryFor(saved, GEOMETRY).marginTop === GEOMETRY.marginTop + 24,
  );

  // Part B split, applied while the same settings are the project settings.
  const KNEE: DynamicKneeContour = {
    pageContentWidth: CONTENT_W, pageContentHeight: CONTENT_H, topY: 0,
    kneeJunctionY: CONTENT_H, bottomY: CONTENT_H, upperSourceWidth: CONTENT_W,
    lowerSourceWidth: CONTENT_W, innerXOffset: 0, isLeftStepped: false,
    rightCommentaryWidth: 60, leftCommentaryWidth: 60, gutterWidth: 12,
  };
  const mkWord = (text: string, unitId: string): ShapedWord => ({ text, glyphs: [], width: 10, isSpace: false, unitId });
  const mkLine = (unitId: string, lineIndex: number, yBaseline: number, wordCount: number): TypesetLine => ({
    lineIndex,
    words: Array.from({ length: wordCount }, (_, i) => mkWord(`w${lineIndex}-${i}`, unitId)),
    width: 300, targetWidth: 300, xStart: 0, yBaseline, height: 18, ascent: 12, descent: 6,
    isLastLine: false, isJustified: true, extraSpacePerWord: 0, role: 'main_source', unitId,
  });
  const mkPage = (pageIndex: number, sourceLines: TypesetLine[]): PageTypesetResult => ({
    pageIndex, pageNumber: pageIndex + 1, pageNumberHebrew: toHebrewGematria(pageIndex + 1),
    headerTitle: 'Test', layoutType: 'single_column', geometry: GEOMETRY,
    sourceLines, rashiLines: [], tosafotLines: [], footnoteLines: [], knee: KNEE,
  });
  const unitU: ContentUnit = { id: 'U', role: 'main_source', rawText: 'u '.repeat(40), styleName: 'Normal', order: 1, hierarchyLevel: 2 };
  const unitV: ContentUnit = { id: 'V', role: 'main_source', rawText: 'v '.repeat(16), styleName: 'Normal', order: 2, hierarchyLevel: 2 };
  const book = [
    mkPage(0, [mkLine('U', 0, 12, 10), mkLine('U', 1, 30, 10), mkLine('V', 0, 48, 8)]),
    mkPage(1, [mkLine('U', 2, 12, 10), mkLine('U', 3, 30, 10), mkLine('V', 1, 48, 8)]),
  ];
  const instr = createBreakInstruction('V', 'pageEndsBefore', { wordIndex: 0, note: 'drag' });
  const split = applyBreakInstructions(book, [instr], [unitU, unitV]);
  check('X1.5 split applies on the merged tree', split.report.instructionsApplied === 1 && split.pages.length >= 2);

  // Snapshot round-trip: break + header + title-page state in one project.
  const snapState = {
    documentTitle: 'Test',
    layoutType: 'single_column' as BookLayoutType,
    geometry: GEOMETRY,
    contentUnits: [unitU, unitV],
    explicitLinks: [],
    kneeSettings: { mode: 'auto' as const, junctionPercent: 50, lowerWidthPercent: 72, gutterWidth: 12, stepDirection: 'auto' as const },
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    selectedFont: 'Frank Ruhl Libre',
    selectedRashiFont: 'Noto Rashi Hebrew',
    selectedTosafotFont: 'Frank Ruhl Libre',
    enableOrnaments: true,
    currentPageIndex: 0,
    projectRules: [],
    localOverrides: [],
    designSettings: saved,
    breakInstructions: [instr],
  };
  const snap = UndoRedoHistoryManager.toProjectSnapshot(snapState, 'test');
  const restored = UndoRedoHistoryManager.fromProjectSnapshot(JSON.parse(JSON.stringify(snap)));
  check(
    'X1.6 snapshot round-trip keeps the break',
    restored.breakInstructions?.length === 1 && restored.breakInstructions[0].anchorUnitId === 'V',
  );
  const restoredHeader = restored.designSettings
    ? resolveRunningHeader(restored.designSettings.pageElements, fb, 0, true)
    : null;
  check(
    'X1.7 restored settings still resolve the same header text',
    restoredHeader?.center.text === 'מסכת ברכות',
    restoredHeader ? JSON.stringify(restoredHeader.center) : 'no designSettings restored',
  );
  check(
    'X1.8 restored settings still carry the title-page border fit',
    restored.designSettings?.titlePage?.border.scalePct === 150 &&
      restored.designSettings?.titlePage?.title.yOffsetPt === 20,
  );
}

/* ------------------------------------------------------------------ */
/* X2 — custom-layout pagination with a per-page override              */
/* ------------------------------------------------------------------ */
console.log('\nX2 — custom-layout pagination + per-page override (merged engine)');
{
  const globalBoxes: CustomLayoutBox[] = [
    makeCustomLayoutBox('main_text', 0, 0, 100, 55),
    makeCustomLayoutBox('commentary', 0, 60, 100, 40),
  ];
  const overrideBoxes = [makeCustomLayoutBox('main_text', 0, 0, 100, 100)];
  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'custom_layout', geometry: GEOMETRY });
  const settings = DesignSettingsEngine.setCustomLayout(base, { enabled: true, baseLayout: 'rav_text', boxes: globalBoxes }, 'user').settings;
  const withOverride = DesignSettingsEngine.setCustomLayoutPageOverride(settings, 1, overrideBoxes, 'user').settings;
  const doc = PaginationEngine.paginateDocument({
    title: 'Integrator smoke', layoutType: 'custom_layout', units: makeUnits(90, 90),
    geometry: GEOMETRY, designSettings: withOverride,
  });
  check('X2.1 book paginates with an override on the merged tree', doc.pages.length >= 2, `${doc.pages.length} pages`);
  const page0Boxes = new Set([...doc.pages[0].sourceLines, ...doc.pages[0].rashiLines].map(l => l.customLayoutBoxId));
  const page1Boxes = new Set([...doc.pages[1].sourceLines, ...doc.pages[1].rashiLines].map(l => l.customLayoutBoxId));
  check('X2.2 page 1 (body idx 0) uses the global boxes', [...page0Boxes].every(id => globalBoxes.some(b => b.id === id)), [...page0Boxes].join(', '));
  check('X2.3 page 2 (body idx 1) uses only the override box', page1Boxes.size >= 1 && [...page1Boxes].every(id => overrideBoxes.some(b => b.id === id)), [...page1Boxes].join(', '));
  // The override must also survive a project-JSON round-trip (Part C's
  // persistence path) while the header block from Part A is present too.
  const withHeaderToo = DesignSettingsEngine.updatePageElementsSettings(
    withOverride, { runningHeader: { centerText: 'כותרת' } }, 'user',
  );
  const rt = JSON.parse(JSON.stringify(withHeaderToo)) as ProfessionalDesignSettings;
  check(
    'X2.4 override + header survive the same project-JSON round-trip',
    Array.isArray(rt.pageLayout.customLayout?.pageOverrides?.['1']) &&
      rt.pageElements.runningHeader.centerText === 'כותרת',
  );
  void defaultBoxesForBaseLayout;
}

/* ------------------------------------------------------------------ */
/* X3 — title-page border: PDF plan + IDML from the same settings      */
/* ------------------------------------------------------------------ */
console.log('\nX3 — title-page border in PDF plan + IDML (same settings)');
{
  const tp: TitlePageSettings = JSON.parse(JSON.stringify(DEFAULT_TITLE_PAGE_SETTINGS));
  tp.enabled = true;
  tp.title.text = 'ספר הבדיקה';
  tp.border.styleId = 'double';
  tp.border.scalePct = 120;
  tp.border.paddingMm = 8;
  const settings = DesignSettingsEngine.createDefaultSettings({ layoutType: 'single_column', geometry: GEOMETRY });
  settings.titlePage = tp;
  const doc = PaginationEngine.paginateDocument({
    title: 'ספר הבדיקה', layoutType: 'single_column', units: makeUnits(2, 2),
    geometry: GEOMETRY, designSettings: settings,
  });
  const titlePage: PageTypesetResult = {
    ...doc.pages[0], pageIndex: 0, pageNumber: 1, isTitlePage: true,
    sourceLines: [], rashiLines: [], tosafotLines: [], footnoteLines: [],
    designSettings: settings,
  };
  const plan = PdfExporter.buildPageRenderPlan(titlePage);
  check('X3.1 PDF render plan carries the border fit', plan.titlePage?.borderScalePct === 120 && plan.titlePage?.borderPaddingMm === 8);
  // Same exporter, body page: Part A's header slots must be populated in
  // the same plan machinery Part C's title-page rows travel through.
  const headerSettings = DesignSettingsEngine.createDefaultSettings({ layoutType: 'single_column', geometry: GEOMETRY });
  const headerOn = DesignSettingsEngine.updatePageElementsSettings(
    headerSettings, { runningHeader: { centerText: 'ספר הבדיקה' } }, 'user',
  );
  headerOn.pageElements.showTopHeaderLine = true;
  const bodyPage: PageTypesetResult = {
    ...doc.pages[0], pageIndex: 1, pageNumber: 2, isTitlePage: false,
    headerTitle: 'ספר הבדיקה', designSettings: headerOn,
  };
  const bodyPlan = PdfExporter.buildPageRenderPlan(bodyPage);
  check('X3.2 PDF render plan carries the header slots on a body page',
    bodyPlan.headerCenterText === 'ספר הבדיקה' && bodyPlan.headerShowCenter === true,
    `center=${JSON.stringify(bodyPlan.headerCenterText)} show=${bodyPlan.headerShowCenter}`);
  const fullDoc = { ...doc, designSettings: settings, pages: [titlePage, ...doc.pages], totalPages: doc.pages.length + 1 };
  const blob = await IdmlExporter.generateMultiPageIdml(fullDoc);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const spreadNames = Object.keys(zip.files).filter(n => n.startsWith('Spreads/'));
  const titleSpread = await zip.file(spreadNames[0])!.async('text');
  check('X3.3 IDML title spread has the border rectangle', titleSpread.includes('<Rectangle Self="tf_border_0"'));
  const bodySpread = await zip.file(spreadNames[1])!.async('text');
  check('X3.4 IDML body spreads carry no border rectangle', !bodySpread.includes('<Rectangle Self="tf_border_'));
}

/* ------------------------------------------------------------------ */
/* X4 — sidebar scroll class chain (Part A §9, static)                 */
/* ------------------------------------------------------------------ */
console.log('\nX4 — sidebar scroll class chain (static)');
{
  const panel = fs.readFileSync(path.join(ROOT, 'src/components/DesignTypesettingPanel.tsx'), 'utf-8');
  const app = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  const nav = fs.readFileSync(path.join(ROOT, 'src/components/PageNavigatorSidebar.tsx'), 'utf-8');
  const ai = fs.readFileSync(path.join(ROOT, 'src/components/AiChatPanel.tsx'), 'utf-8');
  const scrollers = (panel.match(/overflow-y-auto/g) ?? []).length;
  check('X4.1 panel has exactly one overflow-y-auto scroller', scrollers === 1, `${scrollers} found`);
  check('X4.2 panel scroller is the single flex-1 min-h-0 region with a sticky 6-col tab bar',
    panel.includes('flex-1 min-h-0 overflow-y-auto overscroll-contain') &&
      panel.includes('sticky top-0') && panel.includes('grid-cols-6'));
  const countMinH0 = (s: string) => (s.match(/min-h-0/g) ?? []).length;
  check('X4.3 min-h-0 chain survives in App + navigator + AI panel',
    countMinH0(app) >= 3 && countMinH0(nav) >= 4 && countMinH0(ai) >= 2,
    `App ${countMinH0(app)}, nav ${countMinH0(nav)}, AI ${countMinH0(ai)}`);
}

/* ------------------------------------------------------------------ */
/* X5 — nav overflow menu contains every action (Part A §10, static)   */
/* ------------------------------------------------------------------ */
console.log('\nX5 — nav overflow menu (static)');
{
  const header = fs.readFileSync(path.join(ROOT, 'src/components/EditorialStudioHeader.tsx'), 'utf-8');
  const app = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  const moreActions = ['עוזר AI', 'מסמך משני', 'איך משתמשים?', 'מצב לילה', 'מפתח AI'];
  const missing = moreActions.filter(a => !header.includes(a));
  check("X5.1 'More actions' menu holds AI / secondary doc / guide / night mode / AI key",
    header.includes("'more'") && missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');
  check('X5.2 Output group routes to the Export workspace (v0.9.2 Part B: one export home, no header one-click PDF)',
    header.includes('ייצוא לדפוס') && header.includes("onWorkModeChange('export')") && !header.includes('onExportPdf') && app.includes('onExportPdf={handleExportPdf}'));
  check('X5.3 Layout & Design group present (navigator / inspector / custom layout / title page)',
    header.includes('פריסה ועיצוב') && header.includes('onOpenCustomLayout') && header.includes('onOpenTitlePage'));
  check('X5.4 App passes the custom-layout + title-page openers to the header',
    app.includes('onOpenCustomLayout') && app.includes('onOpenTitlePage'));
  check('X5.5 header language control present (English/עברית switch)',
    header.includes("t('English')") || header.includes("'English'") || header.includes('English'));
}

console.log(`\nintegrator-smoke: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
