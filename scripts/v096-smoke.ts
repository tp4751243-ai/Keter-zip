/**
 * KETER-TYPE v0.9.6 — modal dialog transparency & z-index fix smoke.
 *
 * Run from the repo root:  npx tsx scripts/v096-smoke.ts
 *
 * The v0.9.5 bug (user's photos, 2026-11-12): clicking "Vilna Shas check"
 * opened a dialog that was see-through — the Gemara/Rashi page text and
 * the toolbar strip behind it bled straight through the dialog body.
 *
 * Root cause, proven in the source (see MANIFEST): the dialog card used
 * `bg-[var(--ui-panel-bg)]`, but `--ui-panel-bg` was NEVER defined in
 * src/index.css — neither theme block declares it — so the card's
 * background computed to transparent. The same undefined var (plus
 * --ui-hover, --ui-muted, --ui-input-bg, --ui-text, --ui-header-bg)
 * was used in 9 places: the Shas dialog, floating dock panels, the
 * workspace menu, the frame context menu, the page-navigator menu, the
 * toolbar strip and the Story Editor. No stacking-context / transform
 * trap: the dialogs are `fixed` at the App root with no transformed
 * ancestors, and every backdrop was present — only the surfaces were
 * transparent.
 *
 * This smoke proves, from the source:
 *  §1  every `var(--ui-*)` used anywhere in src/ is defined in BOTH
 *      theme blocks of index.css, and every value is opaque (hex, no
 *      alpha) — so no surface can compute to transparent again
 *  §2  the Shas dialog specifically: solid `bg-[var(--ui-surface)]`
 *      card + `bg-black/50 backdrop-blur-xs` dimmed backdrop
 *  §3  every modal dialog in the inventory has a dimmed backdrop AND
 *      an opaque card (theme surface, panel-bg, stone-900 or #0B0F17);
 *      every floating panel / menu / popup has an opaque surface
 *  §4  z-index layering: modal backdrops z-50, CommandPalette z-60,
 *      WelcomeModal z-70, floating panels z-50, header/sidebar z-30/40
 *      — dialogs always sit above chrome and canvas
 *  §5  the shared pattern classes exist in index.css and match the
 *      Tailwind pattern the modals use
 *  §6  no internal overlap inside the Shas dialog: plain stacked
 *      flex layout, no absolute positioning in its body/footer
 *      (the "overlap" in the photo was purely bleed-through)
 *  §7  package.json is 0.9.6
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

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

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}
const read = (p: string): string => fs.readFileSync(p, 'utf8');
const srcFiles = walk(SRC).filter(f => /\.(tsx?|css)$/.test(f));
const css = read(path.join(SRC, 'index.css'));

// Theme blocks: [data-theme="day"] (also :root) and [data-theme="night"].
function themeBlock(theme: 'day' | 'night'): string {
  const start = css.indexOf(`[data-theme="${theme}"]`);
  if (start < 0) return '';
  // The block ends at the next "  }\n" closing brace after the start.
  const end = css.indexOf('\n  }', start);
  return css.slice(start, end);
}
const dayBlock = themeBlock('day');
const nightBlock = themeBlock('night');
function definedVars(block: string): Set<string> {
  return new Set([...block.matchAll(/(--ui-[a-z-]+)\s*:/g)].map(m => m[1]));
}
const dayVars = definedVars(dayBlock);
const nightVars = definedVars(nightBlock);

// ── §1 — no undefined theme vars, all opaque ─────────────────────────────
console.log('§1  every used --ui-* var is defined in both themes, opaque');
{
  const used = new Set<string>();
  for (const f of srcFiles) {
    for (const m of read(f).matchAll(/var\((--ui-[a-z-]+)\)/g)) used.add(m[1]);
  }
  check('both theme blocks exist', dayBlock.length > 0 && nightBlock.length > 0);
  for (const v of [...used].sort()) {
    check(`${v} defined in day theme`, dayVars.has(v));
    check(`${v} defined in night theme`, nightVars.has(v));
  }
  // The six vars that were missing in v0.9.5 (the bug) are now present.
  const wasMissing = ['--ui-panel-bg', '--ui-header-bg', '--ui-hover', '--ui-muted', '--ui-input-bg', '--ui-text'];
  for (const v of wasMissing) {
    check(`${v} defined in BOTH themes (was undefined in v0.9.5)`, dayVars.has(v) && nightVars.has(v));
  }
  // Every surface-ish var value is a solid opaque hex colour (no rgba
  // with alpha, no transparent keyword) in both themes.
  const surfaceVars = [...dayVars].filter(v => /surface|panel|header|input|hover/.test(v));
  for (const v of surfaceVars) {
    for (const [label, block] of [['day', dayBlock], ['night', nightBlock]] as const) {
      const m = block.match(new RegExp(`${v.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`));
      const val = (m?.[1] ?? '').trim();
      check(`${v} is opaque in ${label} theme`, /^#[0-9A-Fa-f]{6}$/.test(val), val);
    }
  }
}

// ── §2 — the Shas dialog specifically ─────────────────────────────────────
console.log('§2  ShasQaPanel (the reported dialog)');
{
  const shas = read(path.join(SRC, 'components/ShasQaPanel.tsx'));
  // Strip line comments: the v0.9.6 fix comment itself names the old
  // token, which must not trip the "no panel-bg" check below.
  const shasCode = shas.replace(/\/\/[^\n]*/g, '');
  // v0.9.8 Uniformity Audit — the Shas dialog now uses the shared
  // backdrop class (dim rgba(0,0,0,0.5) + blur(2px) + fixed inset-0
  // z-50 all live in .keter-dialog-backdrop, index.css §5).
  check('backdrop is dimmed (shared class)', shas.includes('keter-dialog-backdrop'));
  check('backdrop has blur (shared class, index.css)', /keter-dialog-backdrop[\s\S]{0,400}backdrop-filter: blur\(2px\)/.test(css));
  check('backdrop is fixed inset-0 z-50 (shared class)', shas.includes('keter-dialog-backdrop'));
  check('card uses solid defined bg-[var(--ui-surface)]', /bg-\[var\(--ui-surface\)\]/.test(shas));
  check('card does NOT use the (formerly undefined) --ui-panel-bg', !/ui-panel-bg/.test(shasCode));
  check('card has a border + floating shadow', /border border-\[var\(--ui-border\)\]/.test(shas) && /shadow-\[var\(--ui-floating-shadow\)\]/.test(shas));
  check('no rgba-with-alpha background on the card', !/bg-\[rgba/.test(shas));
}

// ── §3 — every dialog / floating surface is opaque ────────────────────────
console.log('§3  dialog + floating-surface inventory is opaque');
{
  // v0.9.8 Uniformity Audit — ONE shared backdrop + surface for every
  // modal dialog: `keter-dialog-backdrop` (rgba(0,0,0,0.5), z-50) and
  // `keter-dialog-surface` (solid theme surface). The per-dialog
  // bg-black/45..80 backdrops and hardcoded dark cards (stone-900 /
  // #0B0F17 — opaque but always dark, wrong on the day theme) are gone.
  // Opaque surface tokens: the shared surface class, or a theme surface
  // literal. CommandPalette keeps its own top-anchored backdrop by
  // design (it is a palette, not a dialog) — same dim, same Escape.
  const OPAQUE = /keter-dialog-surface|bg-\[var\(--ui-(surface|panel-bg)\)\]/;
  // Modal dialogs: file -> expected backdrop. 'shared' = the shared
  // keter-dialog-backdrop class; 'palette' = CommandPalette's own.
  const modals: Array<[string, string]> = [
    ['components/ShasQaPanel.tsx', 'shared'],
    ['components/DocxImportModal.tsx', 'shared'],
    ['components/SecondaryDocxImportModal.tsx', 'shared'],
    ['components/NewProjectModal.tsx', 'shared'],
    ['components/UnsavedChangesModal.tsx', 'shared'],
    ['components/WelcomeModal.tsx', 'shared'],
    ['components/CommandPalette.tsx', 'palette'],
    ['components/ContentEditorModal.tsx', 'shared'],
    ['components/FontScannerPanel.tsx', 'shared'],
    ['components/GeminiKeyModal.tsx', 'shared'],
    ['components/LicenseActivationModal.tsx', 'shared'],
    ['components/Milestone1ReportModal.tsx', 'shared'],
    ['components/SuggestionReviewPanel.tsx', 'shared'],
    ['components/TypesettingRulesModal.tsx', 'shared'],
    ['components/AutomatedTestPanel.tsx', 'shared'],
  ];
  for (const [file, backdrop] of modals) {
    const src = read(path.join(SRC, file));
    const backdropOk = backdrop === 'shared'
      ? src.includes('keter-dialog-backdrop')
      : src.includes('bg-black/50');
    check(`${file}: shared dimmed backdrop (${backdrop})`, backdropOk, backdrop);
    check(`${file}: opaque dialog card`, OPAQUE.test(src));
    // The shared backdrop class IS the fixed inset-0 z-50 overlay
    // (see §5); the palette keeps its own fixed inset-0 z-[60].
    check(`${file}: backdrop is a fixed inset-0 overlay`,
      backdrop === 'shared'
        ? src.includes('keter-dialog-backdrop')
        : /fixed inset-0 z-\[60\]/.test(src));
    // Same close behaviour: Escape (shared hook) + backdrop click,
    // except ContentEditorModal (unsaved pasted text — explicit
    // buttons only) and the palette (its own Escape + backdrop click).
    if (file === 'components/ContentEditorModal.tsx') {
      check(`${file}: no backdrop-click / Escape by design (unsaved text)`,
        !src.includes('useEscapeToClose') && !/keter-dialog-backdrop" onClick/.test(src));
    } else if (file === 'components/CommandPalette.tsx') {
      check(`${file}: Escape + backdrop click (own implementation)`,
        /Escape/.test(src) && /onClick=\{onClose\}/.test(src));
    } else {
      check(`${file}: Escape to close (shared hook)`, src.includes('useEscapeToClose(onClose)') || src.includes('useEscapeToClose(onCancel)'));
      check(`${file}: backdrop click closes`, /keter-dialog-backdrop[^>]*onClick=\{onClose\}/.test(src) || /keter-dialog-backdrop[^>]*onClick=\{onCancel\}/.test(src));
    }
  }
  // Floating panels / menus / popups: no backdrop by design, but the
  // surface itself must be opaque.
  const floaters = [
    'components/ProofreadingPanel.tsx',
    'components/SearchReplacePanel.tsx',
    'components/DockablePanels.tsx',
    'components/FrameContextMenu.tsx',
    'components/PageNavigatorSidebar.tsx',
    'components/FloatingContextToolbar.tsx',
    'components/ControlPanel.tsx',
    'components/StoryEditor.tsx',
  ];
  for (const file of floaters) {
    const src = read(path.join(SRC, file));
    check(`${file}: opaque floating surface`, OPAQUE.test(src));
  }
  // The workspace menu in App.tsx (Workspaces popup) + its input.
  // (className comes before data-testid in that div, so match the full
  // class string rather than assuming attribute order.)
  const app = read(path.join(SRC, 'App.tsx'));
  check('App.tsx workspace menu has an opaque surface',
    app.includes('data-testid="workspace-menu"') &&
    app.includes('fixed z-50 w-72 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel-bg)]'));
  check('App.tsx PDF export overlay: shared backdrop + surface', app.includes('keter-dialog-backdrop') && app.includes('keter-dialog-surface rounded-xl p-6 max-w-sm'));
  // No dialog card anywhere uses a transparent/alpha background.
  // (Scoped to dialog-card lines — `max-w-*` cards — so the deliberate
  // 95%-opaque canvas zoom pill and white/95 chips in PageCanvas, which
  // are small floating controls with backdrop-blur, not dialogs, are
  // not flagged. Those are pre-existing and visually opaque.)
  const bad = srcFiles.filter(f => {
    const s = read(f);
    return s.split('\n').some(line =>
      /max-w-/.test(line) && /bg-white\/\d+|bg-\[var\(--ui-surface\)\]\/\d+|bg-transparent/.test(line));
  });
  check('no dialog card has a transparent/alpha background', bad.length === 0, bad.map(f => path.relative(ROOT, f)).join(', '));
}

// ── §4 — z-index layering ─────────────────────────────────────────────────
console.log('§4  z-index layering: dialogs above chrome and canvas');
{
  const app = read(path.join(SRC, 'App.tsx'));
  const palette = read(path.join(SRC, 'components/CommandPalette.tsx'));
  const welcome = read(path.join(SRC, 'components/WelcomeModal.tsx'));
  const shas = read(path.join(SRC, 'components/ShasQaPanel.tsx'));
  check('modal backdrops are z-50 (shared class)', shas.includes('keter-dialog-backdrop') && app.includes('keter-dialog-backdrop'));
  check('CommandPalette sits above plain modals (z-60)', /z-\[60\]/.test(palette));
  check('WelcomeModal sits above everything (z-70)', /z-\[70\]/.test(welcome) || /zIndex: 70/.test(welcome));
  check('header / sidebar / status bar are z-30/40, below dialogs',
    /z-40/.test(read(path.join(SRC, 'components/EditorialStudioHeader.tsx'))) &&
    /z-30/.test(read(path.join(SRC, 'components/PageNavigatorSidebar.tsx'))));
  check('floating panels / menus are z-50 (above canvas, at dialog level)',
    /z-50/.test(read(path.join(SRC, 'components/ProofreadingPanel.tsx'))) &&
    /z-50/.test(read(path.join(SRC, 'components/SearchReplacePanel.tsx'))));
  // Canvas-local overlays stay at or below z-40 (they must never cover
  // a dialog); the only z-50 in PageCanvas is the fullscreen viewer,
  // which is itself an opaque bg-black/90 overlay.
  const canvas = read(path.join(SRC, 'components/PageCanvas.tsx'));
  // v0.9.8 Uniformity Audit — strip line comments first: comments name
  // z-50 (e.g. the hint-bar note) and must not trip this element check.
  const canvasCode = canvas.replace(/\/\/[^\n]*/g, '');
  const z50s = [...canvasCode.matchAll(/z-50[^\n]{0,80}/g)].map(m => m[0]);
  check('PageCanvas has no z-50 except the opaque fullscreen viewer',
    z50s.every(s => /bg-black\/90/.test(s)), z50s.join(' | '));
}

// ── §5 — the shared pattern classes ──────────────────────────────────────
console.log('§5  shared dialog pattern classes in index.css');
{
  check('.keter-dialog-backdrop exists', css.includes('.keter-dialog-backdrop'));
  check('backdrop class uses rgba(0, 0, 0, 0.5)', /keter-dialog-backdrop[\s\S]{0,400}rgba\(0, 0, 0, 0\.5\)/.test(css));
  check('backdrop class is fixed inset-0 z-50', /keter-dialog-backdrop[\s\S]{0,400}position: fixed;[\s\S]{0,120}z-index: 50;/.test(css));
  check('.keter-dialog-surface exists with solid theme surface', /keter-dialog-surface[\s\S]{0,300}background-color: var\(--ui-surface\);/.test(css));
}

// ── §6 — no internal overlap inside the Shas dialog ─────────────────────
console.log('§6  Shas dialog has no internal overlap (bleed-through only)');
{
  const shas = read(path.join(SRC, 'components/ShasQaPanel.tsx'));
  check('dialog body is a plain stacked flex column', /flex flex-col rounded-lg/.test(shas));
  check('no absolute positioning inside the dialog', !/absolute/.test(shas));
  check('header / scrollable body / footer are stacked siblings',
    /border-b border-\[var\(--ui-border\)\]/.test(shas) &&
    /flex-1 overflow-y-auto/.test(shas) &&
    /border-t border-\[var\(--ui-border\)\]/.test(shas));
}

// ── §7 — version ─────────────────────────────────────────────────────────
console.log('§7  version');
{
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json'))) as { version: string };
  check('package.json version is 0.9.6', pkg.version === '0.9.6', pkg.version);
}

console.log(`\nv096-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
