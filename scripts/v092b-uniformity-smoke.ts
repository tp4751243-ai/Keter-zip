/**
 * KETER-TYPE v0.9.2 Part B — uniformity / deduplication smoke.
 *
 * Run from the repo root:  npx tsx scripts/v092b-uniformity-smoke.ts
 *
 * The user (running installed v0.9.1) reported: "the features are not
 * uniform, like the same features are found in multiple places." This
 * script asserts the consolidation, feature by feature:
 *
 *   §A  Pages: ONE navigation surface (the navigator sidebar). The
 *       PagesPanel and ThumbnailOverview copies are gone (zero code
 *       references in src/), and the navigator carries PagesPanel's
 *       reorder / insert / delete.
 *   §B  Text styles: ONE handler (engine/text-style-apply.ts). The
 *       floating toolbar, the Design panel and the keyboard shortcut
 *       all call it; the Control Panel no longer writes text styles.
 *   §C  Export: ONE home (the Export workspace). The header's
 *       one-click PDF button is gone; the header only routes there.
 *   §D  Layouts: ONE option list (engine/layout-presets.ts). The
 *       header, the New Project modal and the auto-layout banner all
 *       render from it; the historical library lives in the Design
 *       panel (+ New Project modal), not in the header menu.
 *   §E  Knee guide: ONE home (floating toolbar + Design panel). The
 *       header-menu toggle is gone.
 *   §F  Home (v0.9.4): ONE shared new-project form (NewProjectForm,
 *       rendered inline on Home AND in the modal) and ONE import home
 *       (DocxImportModal). The inline wizard is back as the shared
 *       form — no second copy of it, no staged importer.
 *   §G  Naming: one name per feature, with an English entry.
 *   §H  Runtime: the shared handler routes word > unit > role, and
 *       two callers deriving the same target get identical settings.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  applyCharacterStyleChange,
  applyParagraphStyleChange,
} from '../src/engine/text-style-apply';
import { LAYOUT_PRESET_OPTIONS } from '../src/engine/layout-presets';
import { EN_STRINGS } from '../src/i18n/strings';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const allSrc = walk(SRC);
const srcText = (rel: string) => readSrc(rel);
function countInFiles(re: RegExp, files: string[]): number {
  let n = 0;
  for (const f of files) {
    const m = fs.readFileSync(f, 'utf8').match(re);
    if (m) n += m.length;
  }
  return n;
}

console.log('§A — Pages: one navigation surface');
{
  const app = srcText('App.tsx');
  const nav = srcText('components/PageNavigatorSidebar.tsx');
  check('PagesPanel component file is gone', !fs.existsSync(path.join(SRC, 'components/PagesPanel.tsx')));
  check('ThumbnailOverview component file is gone', !fs.existsSync(path.join(SRC, 'components/ThumbnailOverview.tsx')));
  check('App renders no PagesPanel / ThumbnailOverview', !app.includes('<PagesPanel') && !app.includes('<ThumbnailOverview'));
  check('App has no PagesPanel / overview toggle state', !app.includes('showPagesPanel') && !app.includes('showOverview'));
  check('App has no "לוחות עמודים" / "סקירת עמודים" buttons', !app.includes('לוחות עמודים') && !app.includes('סקירת עמודים'));
  check('navigator receives the page-management handlers', app.includes('onReorderPage={handleReorderPage}') && app.includes('onInsertPage={handleInsertPage}') && app.includes('onDeletePage={handleDeletePage}') && app.includes('<PageNavigatorSidebar'));
  check('navigator implements drag-reorder + insert/delete menu', nav.includes('onReorderPage(dragFrom, idx)') && nav.includes('הוסף עמוד אחרי זה') && nav.includes('מחק עמוד זה') && nav.includes('draggable'));
  check('navigator shows the Latin folio per page (ex-PagesPanel info)', nav.includes('folioLabel(page, layoutType)') && nav.includes('folio.latin'));
  check('toolbar "דפים" + palette "דפים" both open the navigator pages tab',
    app.includes("setIsNavigatorOpen(true); setNavigatorTab('pages')") &&
    (app.match(/setIsNavigatorOpen\(true\); setNavigatorTab\('pages'\)/g) || []).length >= 2);
}

console.log('§B — Text styles: one handler');
{
  // UI writers only: components (except the AutomatedTestPanel test
  // harness, which exercises the engine directly) + App. Engine
  // internals (recipe application, updateRoleStyle internals) call
  // the engine methods for their own, non-UI reasons and are out of
  // scope here — the claim is that every UI surface writes through
  // the one shared handler.
  const uiFiles = [
    ...walk(path.join(SRC, 'components')).filter(f => !f.endsWith('AutomatedTestPanel.tsx')),
    path.join(SRC, 'App.tsx'),
    path.join(SRC, 'engine/text-style-apply.ts'),
  ];
  const countCalls = (method: string) =>
    countInFiles(new RegExp(`\\.${method}\\s*\\(`, 'g'), uiFiles);
  check('setLocalWordOverride is called from exactly one UI place (the shared helper)', countCalls('setLocalWordOverride') === 1, `found ${countCalls('setLocalWordOverride')}`);
  check('setLocalUnitOverride is called from exactly two UI places (char + para in the helper)', countCalls('setLocalUnitOverride') === 2, `found ${countCalls('setLocalUnitOverride')}`);
  check('updateRoleCharacterStyle is called from exactly one UI place', countCalls('updateRoleCharacterStyle') === 1, `found ${countCalls('updateRoleCharacterStyle')}`);
  check('updateRoleParagraphStyle is called from exactly one UI place', countCalls('updateRoleParagraphStyle') === 1, `found ${countCalls('updateRoleParagraphStyle')}`);
  const floating = srcText('components/FloatingContextToolbar.tsx');
  const panel = srcText('components/DesignTypesettingPanel.tsx');
  const control = srcText('components/ControlPanel.tsx');
  check('floating toolbar + design panel + App shortcut + style panels + in-place edit use the shared helper',
    floating.includes('engine/text-style-apply') && panel.includes('engine/text-style-apply') &&
    srcText('App.tsx').includes('applyCharacterStyleChange') && srcText('App.tsx').includes('applyParagraphStyleChange'));
  check('Control Panel writes no text styles any more (no engine text-style call, no font/size field)',
    !/DesignSettingsEngine\.updateRoleStyle\s*\(/.test(control) && !/fontSizePt\s*:/.test(control) &&
    !control.includes('availableFonts') && !control.includes('selectedUnit'));
  check('Control Panel is the frame-geometry panel now', control.includes('גאומטריית מסגרת') && control.includes('onFrameGeometryChange'));
  check('Control Panel still offers auto-center (one name)', control.includes('מרכוז אוטומטי'));
}

console.log('§C — Export: one home');
{
  const header = srcText('components/EditorialStudioHeader.tsx');
  const app = srcText('App.tsx');
  check('header has no direct export props', !header.includes('onExportPdf') && !header.includes('onExportIdml'));
  check('header routes to the Export workspace', header.includes('ייצוא לדפוס') && header.includes("onWorkModeChange('export')"));
  check('App passes the PDF/IDML handlers only to the Export workspace',
    (app.match(/onExportPdf=\{/g) || []).length === 1 && app.includes('<ExportWorkspaceView'));
}

console.log('§D — Layouts: one option list');
{
  check('no local LAYOUT_PRESETS / LAYOUT_TEMPLATE_CARDS arrays left in src/',
    countInFiles(/const LAYOUT_PRESETS|const LAYOUT_TEMPLATE_CARDS/g, allSrc) === 0);
  check('shared list has all 7 layouts',
    LAYOUT_PRESET_OPTIONS.length === 7 &&
    ['rav_text', 'mikraot_gedolot', 'source_top_commentary_bottom', 'two_column', 'single_column', 'yiddish_sefer', 'custom_layout']
      .every(id => LAYOUT_PRESET_OPTIONS.some(o => o.id === id)));
  const header = srcText('components/EditorialStudioHeader.tsx');
  const modal = srcText('components/NewProjectModal.tsx');
  const form = srcText('components/NewProjectForm.tsx');
  const app = srcText('App.tsx');
  // v0.9.4 — the modal is a shell around the shared NewProjectForm now;
  // the form (not the modal file) renders from the shared list.
  // v0.9.7 — the form renders the 11 CORE layouts (CORE_START_LAYOUTS,
  // built on the same base list); the header + App banner still render
  // the 7 base presets from LAYOUT_PRESET_OPTIONS.
  check('header + new-project form + App banner render from the shared list',
    header.includes('LAYOUT_PRESET_OPTIONS') && form.includes('CORE_START_LAYOUTS') && app.includes('LAYOUT_PRESET_OPTIONS'));
  // v0.9.7 — the historical library lives in the Design panel ONLY now
  // (the start screen was overwhelmed by its shelves); the form shows
  // the 11 core cards, the header has neither.
  check('historical library lives in the Design panel, not the header or the start form',
    srcText('components/DesignTypesettingPanel.tsx').includes('תבניות היסטוריות') &&
    srcText('components/DesignTypesettingPanel.tsx').includes('getHistoricalLayoutLibrary') &&
    !form.replace(/\/\*[\s\S]*?\*\//g, '').includes('getHistoricalLayoutLibrary()') &&
    modal.includes('NewProjectForm') &&
    !header.includes('onApplyHistoricalRecipe') && !header.includes('getHistoricalLayoutLibrary'));
}

console.log('§E — Knee guide: one home');
{
  const header = srcText('components/EditorialStudioHeader.tsx');
  check('header menu has no knee-guide toggle', !header.includes('showKneeGuide') && !header.includes('onToggleKneeGuide') && !header.includes('קו הברך — המקום'));
  check('floating toolbar still toggles the knee guide', srcText('components/FloatingContextToolbar.tsx').includes('onToggleKneeGuide'));
}

console.log('§F — Home: one shared new-project form (v0.9.4), one import home');
{
  const home = srcText('components/HomeWorkspaceView.tsx');
  const form = srcText('components/NewProjectForm.tsx');
  const modal = srcText('components/NewProjectModal.tsx');
  // v0.9.4 — the inline wizard is back, but as the ONE shared form
  // (NewProjectForm), not a second copy: Home must render it and must
  // NOT carry its own wizard/importer state any more (no staged DOCX,
  // no own layout-card list, no own submit seams).
  check('Home renders the shared form inline (no second copy of it)',
    home.includes('NewProjectForm') && home.includes('onCreateNewProject') &&
    !home.includes('DocxImporter') && !home.includes('onImportDocxUnits') &&
    !home.includes('LAYOUT_TEMPLATE_CARDS') && !home.includes('CustomLayoutDesigner') &&
    !home.includes('stagedDocx') && !home.includes('onOpenNewProject') &&
    !home.includes('savePendingHistoricalRecipe') && !home.includes('savePendingCustomLayout'));
  check('the modal renders the same shared form',
    modal.includes('NewProjectForm') && modal.includes('<NewProjectForm'));
  check('the shared form is the only submit site (pending seams live there once)',
    form.includes('savePendingHistoricalRecipe') && form.includes('savePendingCustomLayout') &&
    !modal.includes('savePendingHistoricalRecipe') && !modal.includes('savePendingCustomLayout'));
  check('App wires Home to the same creation handler (guarded, sample default kept)',
    srcText('App.tsx').includes('onCreateNewProject={(title, nextLayout, mode) =>') &&
    srcText('App.tsx').includes('handleCreateNewProject(title, nextLayout, mode)') &&
    srcText('App.tsx').includes('onOpenDocxImport={handleRequestOpenDocx}'));
  check('New Project modal keeps the per-entry starter default', modal.includes('initialMode'));
}

console.log('§G — Naming: one name per feature, with English');
{
  const needEn = [
    ...LAYOUT_PRESET_OPTIONS.flatMap(o => [o.labelHe, o.subLabelHe]),
    'גאומטריית מסגרת',
    'בחרו מסגרת כדי לערוך את הגאומטריה שלה — גופן וגודל נערכים בסרגל הצף או בחלונית העיצוב',
    'בוחרים שם, מתכונת עימוד ותבנית היסטורית או פריסה מותאמת — או מתחילים מטקסט לדוגמה.',
    'מרכוז אוטומטי',
    'דפים',
    'מעבר לעמוד',
  ];
  const missing = needEn.filter(k => !(k in EN_STRINGS));
  check('every canonical / renamed label has an English entry', missing.length === 0, missing.join(' | '));
  check('auto-center has one name in every surface',
    ['components/FloatingContextToolbar.tsx', 'components/DesignTypesettingPanel.tsx', 'components/ControlPanel.tsx', 'components/FrameContextMenu.tsx']
      .every(f => srcText(f).includes('מרכוז אוטומטי')) &&
    !srcText('components/FrameContextMenu.tsx').includes('התאמה — מרכוז אוטומטי'));
}

console.log('§H — Runtime: the shared handler routes word > unit > role');
{
  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
  const roleNext = applyCharacterStyleChange(base, { role: 'main_source' }, { fontSizePt: 13 });
  const roleSize = DesignSettingsEngine.resolveRoleAndUnitStyle(roleNext, 'main_source').character.fontSizePt;
  check('role target changes the role style', roleSize === 13, `got ${roleSize}`);
  const unitNext = applyCharacterStyleChange(base, { role: 'main_source', unitId: 'u1' }, { fontSizePt: 15 });
  const unitSize = DesignSettingsEngine.resolveRoleAndUnitStyle(unitNext, 'main_source', 'u1').character.fontSizePt;
  const roleStill = DesignSettingsEngine.resolveRoleAndUnitStyle(unitNext, 'main_source').character.fontSizePt;
  check('unit target overrides only that unit', unitSize === 15 && roleStill !== 15, `unit=${unitSize} role=${roleStill}`);
  const wordNext = applyCharacterStyleChange(base, { role: 'main_source', unitId: 'u1', wordIndex: 2 }, { fontSizePt: 17 });
  const wordSize = DesignSettingsEngine.resolveRoleAndUnitStyle(wordNext, 'main_source', 'u1', 2).character.fontSizePt;
  const unitStill = DesignSettingsEngine.resolveRoleAndUnitStyle(wordNext, 'main_source', 'u1').character.fontSizePt;
  check('word target overrides only that word', wordSize === 17 && unitStill !== 17, `word=${wordSize} unit=${unitStill}`);
  const paraNext = applyParagraphStyleChange(base, { role: 'main_source', unitId: 'u1' }, { alignment: 'center' });
  const paraAlign = DesignSettingsEngine.resolveRoleAndUnitStyle(paraNext, 'main_source', 'u1').paragraph.alignment;
  check('paragraph change lands on the unit override', paraAlign === 'center', `got ${paraAlign}`);
  // Two callers deriving the same target must get the same OBSERVABLE
  // result. (The raw settings differ only in the generated local-
  // override id + createdAt timestamp, which every write stamps.)
  const viaFloating = applyCharacterStyleChange(base, { role: 'main_source', unitId: 'u1' }, { fontSizePt: 14 });
  const viaPanel = applyCharacterStyleChange(base, { role: 'main_source', unitId: 'u1' }, { fontSizePt: 14 });
  const resolvedFloating = DesignSettingsEngine.resolveRoleAndUnitStyle(viaFloating, 'main_source', 'u1');
  const resolvedPanel = DesignSettingsEngine.resolveRoleAndUnitStyle(viaPanel, 'main_source', 'u1');
  // The resolved style carries the generated local-override ids; strip
  // those (they are the write's bookkeeping, not its result).
  const stripIds = (o: unknown) => {
    const c = JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
    delete c.localOverrideIds;
    return JSON.stringify(c);
  };
  check('floating-toolbar target == design-panel target (same handler, same result)',
    stripIds(resolvedFloating) === stripIds(resolvedPanel) &&
    JSON.stringify(viaFloating.localOverrides.map(o => o.characterOverrides)) ===
      JSON.stringify(viaPanel.localOverrides.map(o => o.characterOverrides)));
}

console.log(`\nv092b-uniformity-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
