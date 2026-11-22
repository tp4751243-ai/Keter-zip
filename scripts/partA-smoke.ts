/**
 * KETER-TYPE v0.6.0 — merged-tree smoke test (Part A: fonts §1, header §5,
 * sidebar §9, nav §10). Copied from the Part A tree into scripts/ by the
 * v0.6.0 integrator; run from the tree root with:
 *   SMOKE_ROOT=$PWD npx tsx scripts/partA-smoke.ts <scenario>
 * Scenarios: scan:electron | scan:browser | scan:declined | header | static | suites | pdf
 * (no arg = all; the three scan scenarios run in fresh processes via re-exec
 * because autoScanFontsAtStartup() is once-only per module instance.)
 *
 * v0.8.0 Part E: the tree root resolves from this script's own location
 * (SMOKE_ROOT still overrides), so the smoke works from any staged copy
 * of the tree — the old hardcoded /home/hatch/workspace/KETER-TYPE-v0.6.0
 * default pointed at a tree with no node_modules and crashed the suites
 * section on a missing jszip import.
 *
 * The browser/Electron globals below are shims: node has no window,
 * navigator, localStorage or document.fonts, so the test installs minimal
 * fakes BEFORE dynamically importing the engine modules.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// v0.8.0 Part E: resolve the tree from this script, not a hardcoded path.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SMOKE_ROOT ?? path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
}

/* ------------------------------------------------------------------ */
/* Shims                                                               */
/* ------------------------------------------------------------------ */
function installShims(opts: { electron?: boolean; declined?: boolean; queryLocalFontsCalls?: { n: number } }) {
  const store = new Map<string, string>();
  if (opts.declined) store.set('keter-font-scan-declined', '1');
  const localStorageShim = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  };
  (globalThis as any).localStorage = localStorageShim;
  // v0.6.0 integrator: Node 24 exposes a getter-only global `navigator`,
  // so plain assignment throws ("Cannot set property navigator ... which
  // has only a getter"). defineProperty replaces it instead. Same crash
  // in the Part A tree itself — not a merge break.
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      permissions: { query: async () => ({ state: 'granted' }) },
    },
    configurable: true,
    writable: true,
  });
  (globalThis as any).document = {
    fonts: {
      // probe fallback: only Frank Ruhl Libre "exists" on this fake machine.
      check: (font: string) => font.includes('Frank Ruhl Libre'),
      add: () => undefined,
    },
    createElement: () => ({ getContext: () => null }),
  };
  const queryLocalFonts = async () => {
    if (opts.queryLocalFontsCalls) opts.queryLocalFontsCalls.n++;
    return [
      { family: 'Frank Ruhl Libre', fullName: 'Frank Ruhl Libre', postscriptName: 'FrankRuhlLibre', style: 'Regular' },
      { family: 'Noto Serif Hebrew', fullName: 'Noto Serif Hebrew', postscriptName: 'NotoSerifHebrew', style: 'Regular' },
    ];
  };
  (globalThis as any).window = {
    // jspdf's atob/btoa shim binds window.atob/window.btoa when a window
    // object exists, so the fake window must provide them (Node's globals).
    atob: (globalThis as any).atob.bind(globalThis),
    btoa: (globalThis as any).btoa.bind(globalThis),
    queryLocalFonts,
    keterDesktop: opts.electron
      ? { listSystemFontFiles: async () => [
          { family: 'David', fileName: 'David.ttf', format: 'ttf' },
          { family: 'Frank Ruhl Libre', fileName: 'FrankRuhlLibre.ttf', format: 'ttf' },
        ] }
      : undefined,
  };
  // font-library reads window.queryLocalFonts / window.keterDesktop via
  // globalThis.window; some paths read navigator / document directly.
  (globalThis as any).queryLocalFonts = queryLocalFonts;
}

/* ------------------------------------------------------------------ */
/* Scenario: startup font scan                                         */
/* ------------------------------------------------------------------ */
async function scanScenario(kind: 'electron' | 'browser' | 'declined') {
  console.log(`\n== scan:${kind} ==`);
  const calls = { n: 0 };
  installShims({
    electron: kind === 'electron',
    declined: kind === 'declined',
    queryLocalFontsCalls: calls,
  });
  const fontLib = await import(path.join(ROOT, 'src/engine/font-library.ts'));
  await fontLib.autoScanFontsAtStartup();
  const state = fontLib.getFontScanState();
  console.log('  scan state:', JSON.stringify(state), '| queryLocalFonts calls:', calls.n);
  if (kind === 'electron') {
    check('Electron dir scan runs first and finds fonts', state.source === 'electron' && state.count === 2, JSON.stringify(state));
    check('Local Font Access API is NOT called when Electron found fonts', calls.n === 0, `calls=${calls.n}`);
  } else if (kind === 'browser') {
    check('Local Font Access API scan finds fonts', state.source === 'local-fonts' && state.count === 2, JSON.stringify(state));
    check('queryLocalFonts was called exactly once', calls.n === 1, `calls=${calls.n}`);
  } else {
    check('Declined permission is remembered: API is NOT re-prompted', calls.n === 0, `calls=${calls.n}`);
    check('Declined path falls back to the permission-free probe', state.source === 'probe' && state.declinedRemembered === true, JSON.stringify(state));
  }
}

/* ------------------------------------------------------------------ */
/* Scenario: running header                                            */
/* ------------------------------------------------------------------ */
async function headerScenario() {
  console.log('\n== header ==');
  installShims({});
  const eng = await import(path.join(ROOT, 'src/engine/design-settings-engine.ts'));
  const { DesignSettingsEngine } = eng;
  const types = await import(path.join(ROOT, 'src/types/design-settings.ts'));
  const { resolveRunningHeader, DEFAULT_RUNNING_HEADER_SETTINGS } = types;

  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
  const fb = { bookTitle: 'מסכת ברכות', folioLabel: 'דף י״ב', editionLabel: 'צורת הדף · מהדורת כתר' };

  check('defaults: all three elements on, centre, 10.5pt, book font',
    DEFAULT_RUNNING_HEADER_SETTINGS.showBookTitle && DEFAULT_RUNNING_HEADER_SETTINGS.showChapterTitle &&
    DEFAULT_RUNNING_HEADER_SETTINGS.showPageNumber && DEFAULT_RUNNING_HEADER_SETTINGS.alignment === 'center' &&
    DEFAULT_RUNNING_HEADER_SETTINGS.fontSizePt === 10.5 && DEFAULT_RUNNING_HEADER_SETTINGS.fontFamily === '');
  check('createDefaultSettings carries the header block', !!base.pageElements.runningHeader);

  const r0 = resolveRunningHeader(base.pageElements, fb, 0, true);
  check('global resolve: centre=book title, right=folio, left=edition label',
    r0.center.text === 'מסכת ברכות' && r0.right.text === 'דף י״ב' && r0.left.text === 'צורת הדף · מהדורת כתר',
    JSON.stringify(r0));

  // Text edit merges (does not replace the whole header object).
  const edited = DesignSettingsEngine.updatePageElementsSettings(base, { runningHeader: { centerText: 'הקדמה' } }, 'user');
  const r1 = resolveRunningHeader(edited.pageElements, fb, 0, true);
  check('global text edit renders', r1.center.text === 'הקדמה' && r1.right.text === 'דף י״ב' && r1.left.text === 'צורת הדף · מהדורת כתר', JSON.stringify(r1));
  check('partial patch keeps the other header fields', edited.pageElements.runningHeader.showBookTitle === true && edited.pageElements.runningHeader.fontSizePt === 10.5);
  check('patch leaves no stray runningHeader key duplication', Object.keys(edited.pageElements).filter((k) => k === 'runningHeader').length === 1);

  // Per-folio override.
  const withOverride = DesignSettingsEngine.updatePageElementsSettings(edited, {
    runningHeaderOverride: { pageIndex: 2, override: { centerText: 'דף מיוחד' } },
  }, 'user');
  const r2 = resolveRunningHeader(withOverride.pageElements, fb, 2, true);
  const r2b = resolveRunningHeader(withOverride.pageElements, fb, 0, true);
  check('per-folio override renders on that page only', r2.center.text === 'דף מיוחד' && r2b.center.text === 'הקדמה', JSON.stringify(r2));
  const cleared = DesignSettingsEngine.updatePageElementsSettings(withOverride, {
    runningHeaderOverride: { pageIndex: 2, override: null },
  }, 'user');
  check('clearing a per-folio override restores the global text',
    resolveRunningHeader(cleared.pageElements, fb, 2, true).center.text === 'הקדמה');

  // Granular toggles.
  const noFolio = DesignSettingsEngine.updatePageElementsSettings(base, { runningHeader: { showPageNumber: false } }, 'user');
  const r3 = resolveRunningHeader(noFolio.pageElements, fb, 0, true);
  check('page-number toggle hides only the right slot', r3.right.visible === false && r3.center.visible === true && r3.left.visible === true, JSON.stringify(r3));
  const noTitle = DesignSettingsEngine.updatePageElementsSettings(base, { runningHeader: { showBookTitle: false } }, 'ai');
  check('AI patch toggle hides only the book title',
    resolveRunningHeader(noTitle.pageElements, fb, 0, true).center.visible === false);

  // Alignment + font + clamps.
  const aligned = DesignSettingsEngine.updatePageElementsSettings(base, {
    runningHeader: { alignment: 'left', fontFamily: 'Frank Ruhl Libre', fontSizePt: 99 },
  }, 'user');
  const r4 = resolveRunningHeader(aligned.pageElements, fb, 0, true);
  check('alignment + font resolve', r4.alignment === 'left' && r4.fontFamily === 'Frank Ruhl Libre', JSON.stringify(r4));
  check('font size clamps to 8–24pt', aligned.pageElements.runningHeader.fontSizePt === 24);
  const small = DesignSettingsEngine.updatePageElementsSettings(base, { runningHeader: { fontSizePt: 2 } }, 'user');
  check('font size clamps from below too', small.pageElements.runningHeader.fontSizePt === 8);
  const long = DesignSettingsEngine.updatePageElementsSettings(base, { runningHeader: { centerText: 'x'.repeat(250) } }, 'user');
  check('header text caps at 200 chars', long.pageElements.runningHeader.centerText.length === 200);

  // Collapse / reflow.
  const geo = { pageWidth: 595, pageHeight: 842, marginTop: 72, marginBottom: 72, marginInside: 72, marginOutside: 72, isVerso: false };
  const onSettings = DesignSettingsEngine.updatePageElementsSettings(base, { showTopHeaderLine: true }, 'user');
  check('header reserve is 24pt while the line is on', DesignSettingsEngine.headerReservePt(onSettings) === 24);
  check('pagination geometry grows the top margin by the reserve',
    DesignSettingsEngine.paginationGeometryFor(onSettings, geo).marginTop === 96);
  const offSettings = DesignSettingsEngine.updatePageElementsSettings(onSettings, { showTopHeaderLine: false }, 'user');
  check('header reserve is 0 while the line is off (gap collapses)', DesignSettingsEngine.headerReservePt(offSettings) === 0);
  check('pagination geometry is unchanged while the line is off',
    DesignSettingsEngine.paginationGeometryFor(offSettings, geo).marginTop === 72);

  // Local parser phrases (guard cases included).
  const p1 = DesignSettingsEngine.applyNaturalLanguageCommand(base, 'כותרת עליונה: הקדמה למסכת', 'ai');
  check('parser: "כותרת עליונה: <text>" sets the centre text and turns the line on',
    p1.updatedSettings.pageElements.runningHeader.centerText === 'הקדמה למסכת' && p1.updatedSettings.pageElements.showTopHeaderLine === true,
    JSON.stringify(p1.summaryHe ?? p1.summaryEn));
  // (New-project default has the global folio OFF, so switch it on first:
  // the header-scoped phrase must then hide only the header's number.)
  const folioOn = DesignSettingsEngine.updatePageElementsSettings(base, { showFolioNumber: true }, 'user');
  const p2 = DesignSettingsEngine.applyNaturalLanguageCommand(folioOn, 'הסתר מספר עמוד בכותרת העליונה', 'ai');
  check('parser: header-scoped folio toggle touches only the header',
    p2.updatedSettings.pageElements.runningHeader.showPageNumber === false && p2.updatedSettings.pageElements.showFolioNumber === true);
  const p3 = DesignSettingsEngine.applyNaturalLanguageCommand(base, 'show the top header line', 'ai');
  check('parser: plain "show the top header line" still hits the global toggle, not the header text',
    p3.updatedSettings.pageElements.showTopHeaderLine === true && p3.updatedSettings.pageElements.runningHeader.centerText === '');
  const p4 = DesignSettingsEngine.applyNaturalLanguageCommand(base, 'הצג שם ספר בכותרת העליונה', 'ai');
  check('parser: "show book title in the header" toggles only that element',
    p4.updatedSettings.pageElements.runningHeader.showBookTitle === true);
}

/* ------------------------------------------------------------------ */
/* Scenario: static checks (sidebar scroll chain + nav groups + i18n)  */
/* ------------------------------------------------------------------ */
function staticScenario() {
  console.log('\n== static ==');
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const panel = read('src/components/DesignTypesettingPanel.tsx');
  const app = read('src/App.tsx');
  const nav = read('src/components/PageNavigatorSidebar.tsx');
  const ai = read('src/components/AiChatPanel.tsx');
  const header = read('src/components/EditorialStudioHeader.tsx');

  // §9 — one scroll region per sidebar, no clipping ancestor in the chain.
  const scrollers = (panel.match(/overflow-y-auto/g) || []).length;
  check('panel has exactly one overflow-y-auto scroller', scrollers === 1, `found ${scrollers}`);
  check('panel scroller is flex-1 + min-h-0 (can shrink to zero and scroll)', panel.includes('flex-1 min-h-0 overflow-y-auto overscroll-contain'));
  check('panel tab bar is sticky and has 6 columns for 6 tabs', panel.includes('sticky top-0') && panel.includes('grid-cols-6') && !panel.includes('grid-cols-5'));
  check('panel aside itself can shrink (min-h-0)', panel.includes('<aside') && panel.includes('min-h-0'));
  check('App edit row / centre / drawer wrappers carry min-h-0', (app.match(/min-h-0/g) || []).length >= 3, `found ${(app.match(/min-h-0/g) || []).length}`);
  check('page navigator chain carries min-h-0', (nav.match(/min-h-0/g) || []).length >= 4, `found ${(nav.match(/min-h-0/g) || []).length}`);
  check('AI panel container + message scroller carry min-h-0', (ai.match(/min-h-0/g) || []).length >= 2, `found ${(ai.match(/min-h-0/g) || []).length}`);

  // §10 — groups + overflow contain every previous action.
  // v0.9.2 Part B: the header's one-click 'ייצוא PDF' button is gone —
  // export lives in the Export workspace, so 'ייצוא PDF' is no longer
  // a header label and onExportPdf/onExportIdml are no longer header
  // props; the header routes to the workspace via 'ייצוא לדפוס'.
  for (const label of ['פריסה ועיצוב', 'ייצוא', 'פעולות נוספות', 'דפים', 'עיצוב העמוד', 'פריסה מותאמת', 'עמוד שער', 'ייצוא לדפוס']) {
    check(`nav shows "${label}"`, header.includes(label));
  }
  for (const handler of ['onToggleAiDrawer', 'onImportSecondaryDocument', 'onOpenWelcome', 'onToggleUiTheme', 'onToggleUiLang', 'onOpenGeminiKey', 'onOpenCustomLayout', 'onOpenTitlePage']) {
    check(`nav still wires ${handler}`, header.includes(handler));
  }
  check('nav routes export to the Export workspace (no direct PDF button)', header.includes("onWorkModeChange('export')") && header.includes('ייצוא לדפוס') && !header.includes('onExportPdf') && !header.includes('onExportIdml'));
  check('export handlers live on the Export workspace, not the header', app.includes('onExportPdf={handleExportPdf}') && app.includes('onExportIdml={'));
  check('header "more" menu state exists', header.includes("'more'"));
  check('App passes the new header openers', app.includes('onOpenCustomLayout') && app.includes('onOpenTitlePage'));

  // i18n — every t('…') literal in the changed files has an EN_STRINGS entry.
  const stringsSrc = read('src/i18n/strings.ts');
  const keys = new Set([...stringsSrc.matchAll(/^  "((?:[^"\\]|\\.)*)":/gm)].map((m) => m[1]));
  const changedFiles = ['src/components/DesignTypesettingPanel.tsx', 'src/components/FontScannerPanel.tsx',
    'src/components/FontDropdown.tsx', 'src/components/EditorialStudioHeader.tsx', 'src/engine/font-library.ts',
    'src/components/PageCanvas.tsx', 'src/components/AiChatPanel.tsx', 'src/App.tsx', 'src/engine/pdf-exporter.ts'];
  const lits = new Set<string>();
  for (const f of changedFiles) {
    const txt = read(f);
    for (const m of txt.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) lits.add(m[1].replace(/\\'/g, "'"));
    for (const m of txt.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) lits.add(m[1].replace(/\\"/g, '"'));
  }
  const missing = [...lits].filter((x) => !keys.has(x));
  check('every t() literal in changed files has an EN_STRINGS entry', missing.length === 0, missing.slice(0, 5).join(' | '));
}

/* ------------------------------------------------------------------ */
/* Scenario: repo regression suites (v0.5.0 baselines)                 */
/* ------------------------------------------------------------------ */
async function suitesScenario() {
  console.log('\n== suites ==');
  installShims({});
  const { LayoutTestSuite } = await import(path.join(ROOT, 'src/engine/layout-test-suite.ts'));
  const d = LayoutTestSuite.runAllDifficultCases();
  check('runAllDifficultCases 17/17 (v0.5.0 baseline)', d.passedCount === 17 && d.totalCount === 17, `${d.passedCount}/${d.totalCount}`);
  const a1 = LayoutTestSuite.runStage13A1Tests();
  check('runStage13A1Tests 19/19 (v0.5.0 baseline)', a1.passedCount === 19 && a1.totalCount === 19, `${a1.passedCount}/${a1.totalCount}`);
  const a2 = await LayoutTestSuite.runStage13A2Tests();
  check('runStage13A2Tests 11/11 (v0.5.0 baseline)', a2.passedCount === 11 && a2.totalCount === 11, `${a2.passedCount}/${a2.totalCount}`);
}

/* ------------------------------------------------------------------ */
/* Scenario: native-PDF fidelity (Stage 13A-3) — via its own script    */
/* ------------------------------------------------------------------ */
// v0.8.0 Part E: runStage13A3Tests had no caller at all, so the native-PDF
// fidelity assertions never ran. The dedicated script
// (scripts/stage13a3-smoke.ts) skips cleanly when the embedded font
// binaries are unavailable and runs the suite when they are present;
// this scenario just spawns it so the full smoke covers it.
function pdfScenario() {
  console.log('\n== pdf (Stage 13A-3) ==');
  const r = spawnSync(
    'npx',
    ['tsx', path.join(ROOT, 'scripts', 'stage13a3-smoke.ts')],
    { cwd: ROOT, stdio: 'inherit', env: process.env }
  );
  check('stage13a3-smoke exits 0 (ran, or skipped cleanly without fonts)', r.status === 0, `exit=${r.status}`);
}

/* ------------------------------------------------------------------ */
async function main() {
  const arg = process.argv[2];
  if (arg === 'scan:electron') await scanScenario('electron');
  else if (arg === 'scan:browser') await scanScenario('browser');
  else if (arg === 'scan:declined') await scanScenario('declined');
  else if (arg === 'header') await headerScenario();
  else if (arg === 'static') staticScenario();
  else if (arg === 'suites') await suitesScenario();
  else if (arg === 'pdf') pdfScenario();
  else {
    // No arg: run everything; the scan scenarios need fresh processes
    // (autoScanFontsAtStartup is once-only per module instance).
    for (const s of ['scan:electron', 'scan:browser', 'scan:declined', 'header', 'static', 'suites', 'pdf']) {
      const r = spawnSync('npx', ['tsx', process.argv[1], s], { cwd: ROOT, stdio: 'inherit', env: process.env });
      if (r.status !== 0) failed++;
    }
    console.log(`\n==== v0.6.0 Part A smoke: ${passed} passed, ${failed} failed ====`);
    process.exit(failed === 0 ? 0 : 1);
  }
  console.log(`\n==== ${arg}: ${passed} passed, ${failed} failed ====`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE CRASH:', e);
  process.exit(2);
});
