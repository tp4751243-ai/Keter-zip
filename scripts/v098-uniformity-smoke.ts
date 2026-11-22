/**
 * KETER-TYPE v0.9.8 Uniformity Audit — the final UI/UX pass.
 *
 * Run from the repo root:  npx tsx scripts/v098-uniformity-smoke.ts
 *
 * Verifies (verify-first, with file:line evidence in UNIFORMITY-AUDIT.md):
 *  §1  One canonical entry point per feature — the 8 v0.9.2
 *      consolidations still hold in the merged tree (page navigation,
 *      text styles, export, layout pickers, knee guide, new project,
 *      DOCX import, naming), and the new v0.9.8 surfaces (wizard,
 *      hub, Quick-Tune, anchor overlay, Developer Mode) did not
 *      re-duplicate them.
 *  §2  Labels consistent — every t() literal has an English entry;
 *      the Story Editor shows plain role names, never raw role ids;
 *      "עוגנים" is gone (renamed "סימני ניקוד"); the strict role
 *      table is exhaustive in both languages.
 *  §3  Settled defaults OFF — running header line, folio / page
 *      numbers, commentary labels are off in createDefaultSettings
 *      AND after applying every wizard archetype (the recipe used to
 *      turn the header + folio on); archetype geometry/typography
 *      still lands.
 *  §4  Dialogs — every modal uses the shared keter-dialog-backdrop +
 *      keter-dialog-surface, the same close behaviour (Escape +
 *      backdrop click, except ContentEditorModal which holds unsaved
 *      text), and no dialog reintroduces a hardcoded dark card or an
 *      undefined theme variable.
 *  §5  Story Editor decision — edit-in-place is canonical (floating
 *      toolbar button); the Story Editor is the subordinate text-only
 *      view (right-click menu + Ctrl+Tab only, no header/toolbar
 *      button); the Content Editor is repositioned as replace-all
 *      text (sample presets removed, layout switch removed).
 *  §6  Dead controls removed — `showLinks` state/prop gone; the
 *      DOCX hub's dark tone gone; no empty onClick handlers.
 *  §7  version is 0.9.8.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  SEFER_ARCHETYPES,
  applyArchetypeToSettings,
  applySettledDefaultsOff,
} from '../src/engine/sefer-wizard';
import { EN_STRINGS, CONTENT_ROLE_LABELS } from '../src/i18n/strings';
import type { ContentRole } from '../src/types/typesetter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

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
function read(p: string): string {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}
function code(p: string): string {
  // Source without // line comments AND /* */ block comments, so
  // comment mentions do not trip checks.
  return read(p).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

// ── §1 — one canonical entry point per feature ──────────────────────────
console.log('§1  one canonical entry point per feature (v0.9.2 B1–B8 + v0.9.8)');
{
  const app = code('src/App.tsx');
  const header = code('src/components/EditorialStudioHeader.tsx');
  const control = code('src/components/ControlPanel.tsx');
  const home = code('src/components/HomeWorkspaceView.tsx');
  const toolbar = code('src/components/FloatingContextToolbar.tsx');

  // B1 page navigation → navigator sidebar only.
  check('B1 no PagesPanel / ThumbnailOverview code remains',
    !fs.existsSync(path.join(SRC, 'components/PagesPanel.tsx')) &&
    !fs.existsSync(path.join(SRC, 'components/ThumbnailOverview.tsx')) &&
    !/showPagesPanel|showOverview/.test(app));
  check('B1 navigator sidebar is the page-nav home',
    read('src/components/PageNavigatorSidebar.tsx').includes('handleReorderPage') ||
    read('src/App.tsx').includes('PageNavigatorSidebar'));

  // B2 text styles → one shared handler; Control Panel is frame-geometry only.
  check('B2 Control Panel has no font controls (frame geometry only)',
    !/fontFamily|fontSizePt|leadingPt/.test(control) &&
    control.includes('גאומטריית מסגרת'));
  check('B2 one shared text-style handler',
    fs.existsSync(path.join(SRC, 'engine/text-style-apply.ts')) &&
    read('src/engine/text-style-apply.ts').includes('applyCharacterStyleChange'));

  // B3 export → Export workspace only.
  check('B3 header has no one-click PDF export',
    !/onExportPdf|onExportIdml/.test(header) && header.includes('ייצוא לדפוס'));
  check('B3 Export workspace owns the export handlers',
    read('src/components/ExportWorkspaceView.tsx').includes('handleExportPdf') ||
    app.includes('ExportWorkspaceView'));

  // B4 layout pickers → one list in layout-presets.ts.
  check('B4 header + new-project form render from layout-presets.ts',
    header.includes('LAYOUT_PRESET_OPTIONS') &&
    read('src/components/NewProjectForm.tsx').includes('CORE_START_LAYOUTS'));
  check('B4 no second layout list in the header',
    !/const LAYOUTS =|const LAYOUT_OPTIONS =/.test(header));

  // B5 knee guide → floating toolbar + Design panel only.
  check('B5 header has no knee-guide toggle',
    !/Knee|kneeGuide|קו הברך/.test(header));
  check('B5 knee toggle lives in the floating toolbar',
    toolbar.includes('onToggleKneeGuide'));

  // B6 new project → one shared form (Home inline + modal host it).
  check('B6 Home and modal share NewProjectForm',
    home.includes('NewProjectForm') &&
    read('src/components/NewProjectModal.tsx').includes('NewProjectForm'));

  // B7 DOCX import → one shared hub (Home inline + modal host it).
  check('B7 Home and modal share DocxImportHub',
    home.includes('DocxImportHub') &&
    read('src/components/DocxImportModal.tsx').includes('DocxImportHub'));
  check('B7 no second importer UI',
    !/StagedImporter|HomeDocxImporter/.test(app + home));

  // B8 naming — one name per feature (spot checks).
  check('B8 "מרכוז אוטומטי" is the one auto-center name everywhere',
    ['src/components/ControlPanel.tsx', 'src/components/DesignTypesettingPanel.tsx',
     'src/components/FloatingContextToolbar.tsx', 'src/components/FrameContextMenu.tsx']
      .every(f => read(f).includes('מרכוז אוטומטי')) &&
    !/התאמה — מרכוז אוטומטי/.test(app + toolbar));

  // v0.9.8 new surfaces did not re-duplicate anything.
  check('v0.9.8 anchor overlay has ONE toggle (dead showLinks removed)',
    !/showLinks/.test(app) && !/showLinks/.test(code('src/components/PageCanvas.tsx')) &&
    app.includes('toggle-anchor-links'));
  check('v0.9.8 Quick-Tune is the first tab of the SAME Design panel',
    read('src/components/DesignTypesettingPanel.tsx').includes("'quick_tune'") &&
    read('src/components/DesignTypesettingPanel.tsx').includes("id: 'quick_tune'"));
  check('v0.9.8 wizard archetypes reuse the recipe library (no parallel table)',
    read('src/engine/sefer-wizard.ts').includes('getRecipeById') &&
    !/ARCHETYPE_GEOMETRY|ARCHETYPE_PAGE/.test(read('src/engine/sefer-wizard.ts')));
  check('v0.9.8 DOCX hub has ONE tone (dark variant removed)',
    !/variant="dark"/.test(read('src/components/DocxImportModal.tsx')) &&
    !/'dark'/.test(read('src/components/DocxImportHub.tsx').split('DocxImportHubVariant')[0]) &&
    !/dark: \{/.test(read('src/components/DocxImportHub.tsx')));
}

// ── §2 — labels consistent ──────────────────────────────────────────────
console.log('§2  labels consistent across surfaces');
{
  // Whole-tree t() sweep: every Hebrew literal has an English entry.
  const missing = new Set<string>();
  let total = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p)) {
        const s = fs.readFileSync(p, 'utf8');
        for (const m of s.matchAll(/t\("((?:[^"\\]|\\.)*)"\)/g)) {
          total++;
          // The capture is raw source text (\" stays two chars); the
          // EN_STRINGS key is the PARSED string — unescape first.
          let key = m[1];
          try { key = JSON.parse(`"${m[1]}"`); } catch { /* keep raw */ }
          if (!(key in EN_STRINGS)) missing.add(key);
        }
      }
    }
  };
  walk(SRC);
  check('every t() literal has an EN_STRINGS entry', missing.size === 0,
    `${total} literals, ${missing.size} missing: ${[...missing].join(' | ')}`);
  check('Phase 5 stragglers now translated',
    !!EN_STRINGS['קישור מחדש של דיבור המתחיל'] &&
    !!EN_STRINGS['לא נמצאה השורה לחלוקה — נסו שורה אחרת.'] &&
    !!EN_STRINGS['לא נמצאה השורה למשיכה — נסו שורה אחרת.']);

  // "עוגנים" is gone; the nikud-marks button says what it does.
  const appSrc = read('src/App.tsx');
  check('"עוגנים" label is gone (renamed "סימני ניקוד")',
    !/t\("עוגנים"\)/.test(appSrc) && appSrc.includes('t("סימני ניקוד")'));
  check('"סימני ניקוד" has an English entry',
    EN_STRINGS['סימני ניקוד'] === 'Nikud marks');

  // Story Editor: plain role names, never raw role ids.
  const story = read('src/components/StoryEditor.tsx');
  check('Story Editor renders role labels, not raw role ids',
    story.includes('CONTENT_ROLE_LABELS') && !/\[{u\.role}\]/.test(story));
  const roles: ContentRole[] = ['book', 'main_title', 'subtitle', 'introduction',
    'chapter', 'siman', 'seif', 'heading', 'subheading', 'main_source', 'verse',
    'regular_paragraph', 'bold_special', 'primary_comment', 'secondary_comment',
    'tertiary_comment', 'dibbur_hamatchil', 'footnote', 'side_note',
    'cross_reference', 'ornament', 'continuation', 'page_element', 'table',
    'image', 'chart', 'caption', 'list_item'];
  check('CONTENT_ROLE_LABELS covers all 26 roles in both languages',
    roles.every(r => CONTENT_ROLE_LABELS[r] && CONTENT_ROLE_LABELS[r].he && CONTENT_ROLE_LABELS[r].en &&
      CONTENT_ROLE_LABELS[r].he !== CONTENT_ROLE_LABELS[r].en),
    `${Object.keys(CONTENT_ROLE_LABELS).length} entries`);
}

// ── §3 — settled defaults OFF ───────────────────────────────────────────
console.log('§3  settled defaults stay OFF (incl. wizard archetypes)');
{
  const fresh = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
  check('fresh book: running header line OFF',
    fresh.pageElements.showTopHeaderLine === false);
  check('fresh book: folio / page numbers OFF',
    fresh.pageElements.showFolioNumber === false);
  check('fresh book: commentary labels OFF',
    fresh.pageElements.showCommentaryLabels === false);

  // Every wizard archetype: geometry/typography land, defaults stay off.
  // (Before this audit the recipe turned the header line + folio ON.)
  for (const arch of SEFER_ARCHETYPES) {
    const base = DesignSettingsEngine.createDefaultSettings({ layoutType: arch.baseLayout });
    const applied = applyArchetypeToSettings(arch.id, base);
    const el = applied.pageElements;
    check(`archetype ${arch.id}: header line + folio + labels OFF`,
      el.showTopHeaderLine === false && el.showFolioNumber === false &&
      el.showCommentaryLabels === false);
    if (arch.recipeId) {
      check(`archetype ${arch.id}: recipe geometry still lands`,
        applied.pageLayout.geometry.pageWidth !== base.pageLayout.geometry.pageWidth ||
        applied.pageLayout.geometry.pageHeight !== base.pageLayout.geometry.pageHeight ||
        applied.pageLayout.marginInsidePt !== base.pageLayout.marginInsidePt ||
        JSON.stringify(applied.pageLayout.geometry) !== JSON.stringify(base.pageLayout.geometry));
    }
  }
  // applySettledDefaultsOff is a pure restore: it does not touch geometry.
  const f2 = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
  const forced = applySettledDefaultsOff(
    DesignSettingsEngine.updatePageElementsSettings(f2,
      { showTopHeaderLine: true, showFolioNumber: true, showCommentaryLabels: true }, 'user'));
  check('applySettledDefaultsOff restores all three switches',
    forced.pageElements.showTopHeaderLine === false &&
    forced.pageElements.showFolioNumber === false &&
    forced.pageElements.showCommentaryLabels === false);
}

// ── §4 — dialogs ────────────────────────────────────────────────────────
console.log('§4  dialogs: one shared backdrop + surface, one close behaviour');
{
  const modals = [
    'components/ShasQaPanel.tsx', 'components/DocxImportModal.tsx',
    'components/SecondaryDocxImportModal.tsx', 'components/NewProjectModal.tsx',
    'components/UnsavedChangesModal.tsx', 'components/WelcomeModal.tsx',
    'components/ContentEditorModal.tsx', 'components/FontScannerPanel.tsx',
    'components/GeminiKeyModal.tsx', 'components/LicenseActivationModal.tsx',
    'components/Milestone1ReportModal.tsx', 'components/SuggestionReviewPanel.tsx',
    'components/TypesettingRulesModal.tsx', 'components/AutomatedTestPanel.tsx',
  ];
  for (const f of modals) {
    const s = code(`src/${f}`);
    check(`${f}: shared backdrop + surface`,
      s.includes('keter-dialog-backdrop') && s.includes('keter-dialog-surface'));
    check(`${f}: no hardcoded dark card / old backdrop`,
      !/bg-stone-900|bg-\[#0B0F17\]|bg-\[#0F1623\]|bg-black\/(45|50|75|80|90)/.test(s));
  }
  const cem = code('src/components/ContentEditorModal.tsx');
  check('ContentEditorModal: no Escape / backdrop-click by design (unsaved text)',
    !cem.includes('useEscapeToClose') && !/keter-dialog-backdrop" onClick/.test(cem));
  const palette = code('src/components/CommandPalette.tsx');
  check('CommandPalette: own top-anchored backdrop, same dim + Escape',
    palette.includes('bg-black/50') && /Escape/.test(palette) && palette.includes('onClick={onClose}'));
  check('no undefined theme vars on dialog cards',
    !modals.some(f => /bg-\[var\(--ui-panel-bg\)\]/.test(code(`src/${f}`))));
  check('every dialog ✕ button has a title / aria-label ("סגור" / "ביטול")',
    modals.every(f => {
      const s = read(`src/${f}`);
      return /title=\{t\(["']סגור["']\)\}|title="סגור"|aria-label=\{t\(["']סגור["']\)\}|title=\{t\("סגור חלון רישוי"\)\}|title=\{t\("ביטול"\)\}/.test(s);
    }));
  check('re-anchor hint bar is z-40 (below dialogs)',
    read('src/components/PageCanvas.tsx').includes('reanchor-hint') &&
    /reanchor-hint"[\s\S]{0,200}z-40/.test(read('src/components/PageCanvas.tsx')));
}

// ── §5 — Story Editor decision ──────────────────────────────────────────
console.log('§5  Story Editor vs edit-in-place: ONE canonical editor');
{
  const app = code('src/App.tsx');
  const toolbar = read('src/components/FloatingContextToolbar.tsx');
  check('canonical editor is edit-in-place (floating toolbar button)',
    toolbar.includes('ערוך טקסט במקום'));
  check('Story Editor opened from exactly 2 places (Type-tool flow + right-click menu)',
    (app.match(/setStoryView\(true\)/g) ?? []).length === 2 &&
    !/setStoryView\(true\)/.test(read('src/components/EditorialStudioHeader.tsx')) &&
    !/setStoryView\(true\)/.test(read('src/components/FloatingContextToolbar.tsx')));
  check('Story Editor reachable only via right-click menu + Ctrl+Tab (+ Type-tool creation flow)',
    read('src/components/FrameContextMenu.tsx').includes('onOpenStoryEditor') &&
    app.includes("key === 'tab'"));
  check('Story Editor header says what it is (text-only view)',
    read('src/components/StoryEditor.tsx').includes('תצוגת טקסט בלבד — ללא עימוד'));
  const cem = read('src/components/ContentEditorModal.tsx');
  check('Content Editor: sample presets removed',
    !cem.includes('loadPreset') && !cem.includes('טעינת דוגמה מוכנה'));
  check('Content Editor: no layout switch (layout lives with the picker)',
    !cem.includes('setActiveLayout'));
  check('Content Editor: renamed to replace-all text',
    cem.includes('החלפת כל הטקסט של הספר') &&
    read('src/components/EditorialStudioHeader.tsx').includes('החלפת כל הטקסט של הספר...'));
}

// ── §6 — dead controls removed ──────────────────────────────────────────
console.log('§6  dead controls removed');
{
  check('no empty onClick handlers anywhere in src',
    !/onClick=\{\(\) => \{\}\}/.test(read('src/App.tsx')) &&
    !fs.readdirSync(path.join(SRC, 'components')).some(f =>
      /onClick=\{\(\) => \{\}\}/.test(fs.readFileSync(path.join(SRC, 'components', f), 'utf8'))));
  check('showLinks fully removed (App + PageCanvas)',
    !/showLinks/.test(code('src/App.tsx')) && !/showLinks/.test(code('src/components/PageCanvas.tsx')));
  // v0.9.8 audit — a toast's dismissal timer must belong to that toast:
  // each showToast cancels the previous timer, so a rapid second action
  // (pull, then re-anchor) cannot have its confirmation killed early.
  check('showToast cancels the previous dismissal timer before scheduling a new one',
    /clearTimeout\(toastTimerRef\.current\)/.test(code('src/App.tsx')) &&
    /toastTimerRef\.current = window\.setTimeout\(\(\) => setNotification\(null\), 4000\)/.test(code('src/App.tsx')));
  check('DocxImportHub dark tone fully removed',
    !/dark: \{/.test(read('src/components/DocxImportHub.tsx')));
  check('no "עוגנים" string remains in UI code',
    !/עוגנים/.test(code('src/App.tsx')));
}

// ── §7 — version ────────────────────────────────────────────────────────
console.log('§7  version');
check('version is 0.9.8', pkg.version === '0.9.8', pkg.version);

console.log(`\nv098-uniformity-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
