/**
 * KETER-TYPE v0.9.4 — Home "start a book" section restore smoke.
 *
 * Run from the repo root:  npx tsx scripts/v094-home-wizard-smoke.ts
 *
 * The user reported: "You removed the section when starting a book
 * which type to select please put back." v0.9.4 restores the inline
 * section on the Home screen — as the ONE shared NewProjectForm the
 * New Project modal renders too, not as the second copy v0.9.2
 * removed. This script asserts that, section by section:
 *
 *   §A  Library: the picker lists all 27 historical recipes (+ the 7
 *       base layouts), grouped by shelf, with no recipe lost to a
 *       grouping mistake (the "other" shelf must stay empty).
 *   §B  One form, one handler: Home and the modal both render
 *       <NewProjectForm>; the pending-recipe / pending-custom-layout
 *       seams are called from that one file only; App wires both
 *       entry points to the same handleCreateNewProject.
 *   §C  No divergent Home paths: the removed v0.9.1 inline wizard /
 *       staged DOCX importer must not come back (zero references).
 *   §D  i18n: every new group-shelf label (and every recipe name /
 *       description the picker shows) has an English entry.
 *   §E  Pending seam: save → consume-once works for the recipe id the
 *       form submits, and the recipe resolves with a base layout.
 *   §F  Defaults aligned to the modal: same default title, layout =
 *       currentLayoutType; Home keeps its old 'sample' starter default.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getHistoricalLayoutLibrary,
  getRecipeById,
} from '../src/engine/historical-layouts';
import {
  savePendingHistoricalRecipe,
  consumePendingHistoricalRecipe,
} from '../src/engine/layout-recipes';
import { LAYOUT_PRESET_OPTIONS } from '../src/engine/layout-presets';
import { EN_STRINGS } from '../src/i18n/strings';
import {
  HISTORICAL_RECIPE_GROUPS,
  HISTORICAL_RECIPE_OTHER_GROUP_LABEL_HE,
  groupHistoricalLibrary,
} from '../src/components/NewProjectForm';

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
function countInFiles(re: RegExp, files: string[]): number {
  let n = 0;
  for (const f of files) {
    const m = fs.readFileSync(f, 'utf8').match(re);
    if (m) n += m.length;
  }
  return n;
}

// localStorage stub: the pending-recipe seam is localStorage-backed.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

console.log('§A — Library: 27 recipes + 7 base layouts, grouped, none lost');
{
  const lib = getHistoricalLayoutLibrary();
  check('library lists 27 recipes (vilna-shas alias excluded)', lib.length === 27, `got ${lib.length}`);
  const ids = lib.map(e => e.id);
  check('recipe ids are unique', new Set(ids).size === ids.length);
  const unresolvable = lib.filter(e => !getRecipeById(e.id));
  check('every recipe id resolves to an applicable recipe', unresolvable.length === 0, unresolvable.map(e => e.id).join(', '));
  const noBaseLayout = lib.filter(e => !getRecipeById(e.id)?.baseLayout);
  check('every recipe carries a base layout (picker sets it on select)', noBaseLayout.length === 0, noBaseLayout.map(e => e.id).join(', '));
  check('shared base list still has all 7 layouts', LAYOUT_PRESET_OPTIONS.length === 7);
  const groups = groupHistoricalLibrary(lib);
  const groupedTotal = groups.reduce((n, g) => n + g.entries.length, 0);
  check('grouping keeps all 27 recipes', groupedTotal === 27, `grouped ${groupedTotal}`);
  const other = groups.find(g => g.key === 'other');
  check('"other" shelf is empty (no recipe fell out of its group)', !other || other.entries.length === 0, other ? other.entries.map(e => e.id).join(', ') : '');
  const groupedIds = groups.flatMap(g => g.entries.map(e => e.id));
  check('grouping keeps library order and no duplicates', groupedIds.length === new Set(groupedIds).size && groupedIds.every(id => ids.includes(id)));
  console.log(`  Groups: ${groups.map(g => `${g.labelHe} (${g.entries.length})`).join(' · ')}`);
}

console.log('§B — One form, one handler');
{
  const home = readSrc('components/HomeWorkspaceView.tsx');
  const modal = readSrc('components/NewProjectModal.tsx');
  const form = readSrc('components/NewProjectForm.tsx');
  const app = readSrc('App.tsx');
  check('Home renders the shared form inline', home.includes('<NewProjectForm') && home.includes('testId="new-project-form-home"'));
  check('the modal renders the same shared form', modal.includes('<NewProjectForm') && modal.includes('testId="new-project-form-modal"'));
  check('Home passes the creation handler into the form', home.includes('onCreateProject={onCreateNewProject}'));
  check('the modal passes the creation handler into the form', modal.includes('onCreateProject={onCreateProject}'));
  check('pending historical-recipe seam is called from the form file only',
    countInFiles(/savePendingHistoricalRecipe\(/g, walk(path.join(SRC, 'components'))) === 1 && form.includes('savePendingHistoricalRecipe('));
  check('pending custom-layout seam is called from the form file only',
    countInFiles(/savePendingCustomLayout\(/g, walk(path.join(SRC, 'components'))) === 1 && form.includes('savePendingCustomLayout('));
  // v0.9.7 — the form renders the 11 CORE layouts from the shared
  // core list (CORE_START_LAYOUTS), not the full library any more:
  // the historical shelves moved to the Design / Page design pickers
  // (the start screen was overwhelming). The library itself is
  // untouched — see §A above.
  check('the form renders base layouts from the shared list only',
    form.includes('CORE_START_LAYOUTS') && !form.includes('LAYOUT_TEMPLATE_CARDS'));
  check('the form renders the 11 core layouts, not the full library',
    form.includes('CORE_START_LAYOUTS.map(') &&
    !form.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').includes('getHistoricalLayoutLibrary()'));
  check('App wires the modal to handleCreateNewProject', app.includes('onCreateProject={handleCreateNewProject}'));
  check('App wires Home to the same handleCreateNewProject (guarded)',
    app.includes('onCreateNewProject={(title, nextLayout, mode) =>') &&
    app.includes('handleCreateNewProject(title, nextLayout, mode)'));
  check('no second form component exists (one NewProjectForm in src)',
    countInFiles(/export const NewProjectForm/g, allSrc) === 1);
}

console.log('§C — No divergent Home paths come back');
{
  const home = readSrc('components/HomeWorkspaceView.tsx');
  const banned = [
    'stagedDocx', 'docxLayout', 'onImportDocxUnits', 'LAYOUT_TEMPLATE_CARDS',
    'DocxImporter', 'handleRunDocxImport', 'autoDiscoverLinks',
    'onOpenNewProject', 'newTitle', 'selectedLayout', 'starterMode',
  ];
  const found = banned.filter(tok => home.includes(tok));
  check('Home has zero references to the removed divergent paths', found.length === 0, found.join(', '));
  check('Home keeps no custom-boxes state of its own', !home.includes('CustomLayoutBox') && !home.includes('customBoxes'));
  check('Home keeps no DOCX layout select of its own', !home.includes('setDocxLayout') && !home.includes('docxInputRef'));
  check('no onOpenNewProject prop left anywhere in src/', countInFiles(/onOpenNewProject/g, allSrc) === 0);
}

console.log('§D — i18n: group shelves + recipe names have English entries');
{
  const labels = [
    ...HISTORICAL_RECIPE_GROUPS.map(g => g.labelHe),
    HISTORICAL_RECIPE_OTHER_GROUP_LABEL_HE,
  ];
  const missingLabels = labels.filter(k => !(k in EN_STRINGS));
  check('every group-shelf label has an English entry', missingLabels.length === 0, missingLabels.join(' | '));
  const lib = getHistoricalLayoutLibrary();
  // v0.9.5: names + descriptions live in both languages in the recipe
  // metadata itself — the pickers render them directly, no EN_STRINGS
  // lookup — so assert the summary carries both, non-empty.
  const missingNames = lib.filter(e => !e.nameHe.trim() || !e.nameEn.trim()).map(e => e.id);
  check('every recipe name is carried in Hebrew and English (no lookup needed)', missingNames.length === 0, missingNames.join(', '));
  const nonEnglishDesc = lib.filter(e => !e.descriptionEn || !/[a-z]/.test(e.descriptionEn)).map(e => e.id);
  check('every recipe descriptionEn is non-empty English prose', nonEnglishDesc.length === 0, nonEnglishDesc.join(', '));
  const nonHebrewDesc = lib.filter(e => !e.descriptionHe || !/[\u0590-\u05FF]/.test(e.descriptionHe)).map(e => e.id);
  check('every recipe descriptionHe is non-empty Hebrew prose', nonHebrewDesc.length === 0, nonHebrewDesc.join(', '));
  const missingPresets = LAYOUT_PRESET_OPTIONS.flatMap(o => [o.labelHe, o.subLabelHe]).filter(k => !(k in EN_STRINGS));
  check('every base-layout label has an English entry', missingPresets.length === 0, missingPresets.join(' | '));
}

console.log('§E — Pending seam: pick a recipe → create → App consumes it once');
{
  const recipeId = 'mishnah-berurah';
  const recipe = getRecipeById(recipeId);
  check('test recipe (mishnah-berurah) resolves', Boolean(recipe), recipe ? `baseLayout=${recipe.baseLayout}` : '');
  savePendingHistoricalRecipe(recipeId);
  check('consume returns the saved recipe id', consumePendingHistoricalRecipe() === recipeId);
  check('consume is once-only (second consume is null)', consumePendingHistoricalRecipe() === null);
  savePendingHistoricalRecipe(recipeId);
  check('re-save works after consume', consumePendingHistoricalRecipe() === recipeId);
}

console.log('§F — Defaults aligned to the modal');
{
  const home = readSrc('components/HomeWorkspaceView.tsx');
  const modal = readSrc('components/NewProjectModal.tsx');
  check('Home and modal share the same default title',
    home.includes('initialTitle={t("ספר חדש — כתר")}') &&
    modal.includes('initialTitle={t("ספר חדש — כתר")}'));
  check('Home layout default is the current layout (same as the modal)',
    home.includes('initialLayout={currentLayoutType}') &&
    modal.includes('initialLayout={currentLayoutType}'));
  check("Home keeps its old 'sample' starter default", home.includes('initialMode="sample"'));
  check('modal still takes its starter default from its opener',
    modal.includes('initialMode={initialMode}') && modal.includes("initialMode = 'blank'"));
}

console.log(`\nv094-home-wizard-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
