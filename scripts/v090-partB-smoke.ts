/**
 * KETER-TYPE v0.9.0 Part B — Manuscript & Custom Layout Designer smoke.
 *
 * Run from the repo root:  npx tsx scripts/v090-partB-smoke.ts
 *
 * Pure-engine checks (no browser, no React) over the merged v0.9.0 tree:
 *  §A  recipe engine contract (Part A's engine):
 *      validate / serialize / deserialize round-trip, invalid rejected
 *  §B  historical library: 9 picker recipes (+1 alias), every id
 *      resolvable, all valid
 *  §C  applyRecipeToSettings: library recipe + designer export, input
 *      never mutated, regions carried onto boxes as a custom layout
 *  §D  tier + rule inspector state: box tier/rules persist through the
 *      sanitizer; polygon kinds complete (ellipse reachable)
 *  §E  transactional apply: preset switch drops break instructions +
 *      per-page overrides, carries force-breaks (layout-transaction.ts)
 *  §F  static UI checks: designer has the tier dropdown + rule inspector
 *      + export/import; the three pickers list the historical library;
 *      App wires the Part B handlers
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { planLayoutSwitch } from '../src/engine/layout-transaction';
import {
  KETER_TEMPLATE_EXTENSION,
  applyRecipeToSettings,
  deserializeRecipe,
  recipeFromBoxes,
  recipeFromSettings,
  recipeToCustomLayoutBoxes,
  serializeRecipe,
  validateRecipe,
  type LayoutRecipe,
} from '../src/engine/layout-recipes';
import {
  HISTORICAL_LAYOUTS,
  getHistoricalLayoutLibrary,
  getRecipeById,
} from '../src/engine/historical-layouts';
import {
  CUSTOM_LAYOUT_BOX_TIERS,
  CUSTOM_LAYOUT_POLYGON_KINDS,
  CUSTOM_LAYOUT_POLYGON_LABELS_HE,
  boxTierLabel,
  defaultBoxesForBaseLayout,
  effectiveBoxTier,
  makeCustomLayoutBox,
  polygonPresetPoints,
  sanitizeCustomLayoutBox,
  sanitizeCustomLayoutBoxRules,
  sanitizePolygonShape,
  tierForRole,
} from '../src/engine/custom-layout-engine';
import type { CustomLayoutBox } from '../src/types/design-settings';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
}

// ── §A — recipe engine contract ──────────────────────────────────────────
console.log('§A  recipe engine contract');
const vilna = getRecipeById('vilna-shas');
check('vilna-shas resolves (alias → talmud-bavli)', vilna !== undefined && vilna.metadata.id === 'talmud-bavli');
if (vilna) {
  check('valid library recipe validates clean', validateRecipe(vilna).length === 0);
  const json = serializeRecipe(vilna);
  const first = deserializeRecipe(json);
  check('serialize → deserialize succeeds', first.metadata.id === vilna.metadata.id);
  check(
    'round-trip keeps id/baseLayout/regions',
    first.metadata.id === vilna.metadata.id &&
      first.baseLayout === vilna.baseLayout &&
      first.regions.length === vilna.regions.length,
    `${first.regions.length} regions`
  );
  check(
    'round-trip is idempotent (serialize(deserialize) stable)',
    serializeRecipe(deserializeRecipe(serializeRecipe(first))) === serializeRecipe(first)
  );
  check(
    'round-trip keeps the first region role + headword label',
    first.regions[0]?.role === 'header' &&
      (first.regions[1]?.labelHe ?? '').includes('משנה'),
    `role=${first.regions[0]?.role}`
  );
}

let malformedRejected = false;
try {
  deserializeRecipe('{not json');
} catch {
  malformedRejected = true;
}
check('malformed JSON rejected (throws)', malformedRejected);

const validPage = { widthMm: 210, heightMm: 297, marginTopMm: 20, marginBottomMm: 20, marginInsideMm: 20, marginOutsideMm: 20 };
const validMeta = { id: 'x', name: 'X', description: 'X', genre: ['custom'], origin: 'test' };
const validRegion = { id: 'main', role: 'main_text', shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, units: '%', origin: 'content-box' };
const baseRecipe = { keterTemplateVersion: 1, metadata: validMeta, regions: [validRegion], flow: [], page: validPage };
const badRecipes: Array<[string, unknown]> = [
  ['not an object', 'hello'],
  ['wrong version', { ...baseRecipe, keterTemplateVersion: 99 }],
  ['missing metadata.id', { ...baseRecipe, metadata: { ...validMeta, id: '' } }],
  ['bad id (not kebab-case)', { ...baseRecipe, metadata: { ...validMeta, id: 'Vilna Shas' } }],
  ['missing metadata.name', { ...baseRecipe, metadata: { ...validMeta, name: '' } }],
  ['page width out of range', { ...baseRecipe, page: { ...validPage, widthMm: 20 } }],
  ['margins leave no content', { ...baseRecipe, page: { ...validPage, widthMm: 100, marginInsideMm: 60, marginOutsideMm: 60 } }],
  ['columns out of range', { ...baseRecipe, page: { ...validPage, columns: 5 } }],
  ['alias carrying regions', { ...baseRecipe, aliasOf: 'talmud-bavli' }],
  ['duplicate region ids', { ...baseRecipe, regions: [validRegion, { ...validRegion }] }],
  ['unknown tier role', { ...baseRecipe, regions: [{ ...validRegion, role: 'nope' }] }],
  ['no main-text region', { ...baseRecipe, regions: [{ ...validRegion, role: 'rashi' }] }],
];
for (const [label, value] of badRecipes) {
  const errors = validateRecipe(value);
  check(`invalid rejected: ${label}`, errors.length > 0, errors[0] ?? '');
  let threw = false;
  try {
    deserializeRecipe(JSON.stringify(value));
  } catch {
    threw = true;
  }
  check(`deserialize rejects: ${label}`, threw);
}
check(
  'template extension constant',
  KETER_TEMPLATE_EXTENSION === '.keter-template.json'
);

// ── §B — historical library ──────────────────────────────────────────────
console.log('§B  historical library');
const library = getHistoricalLayoutLibrary();
check('library has 9 picker entries (aliases excluded)', library.length === 9, `${library.length} entries`);
check(
  'library ids are unique',
  new Set(library.map(e => e.id)).size === library.length
);
check(
  'every library entry has a plain-language name + description (both languages, v0.9.5)',
  library.every(e => e.nameHe.trim().length > 0 && e.nameEn.trim().length > 0 && e.descriptionHe.trim().length > 0 && e.descriptionEn.trim().length > 0)
);
check(
  'HISTORICAL_LAYOUTS has 10 entries (9 recipes + vilna-shas alias)',
  HISTORICAL_LAYOUTS.length === 10
);
let allLibraryValid = true;
let allResolvable = true;
for (const entry of library) {
  const recipe = getRecipeById(entry.id);
  if (!recipe) {
    allResolvable = false;
    continue;
  }
  if (validateRecipe(recipe).length > 0) allLibraryValid = false;
  if (recipe.regions.length === 0) allLibraryValid = false;
}
check('each library id resolvable via getRecipeById', allResolvable);
check('every library recipe validates clean + has regions', allLibraryValid);
check('unknown id resolves to undefined', getRecipeById('no_such_recipe') === undefined);
check(
  'vilna-shas alias resolves to the talmud-bavli folio',
  getRecipeById('vilna-shas')?.metadata.id === 'talmud-bavli'
);
check(
  'library covers the expected genres',
  ['talmud', 'halakha', 'tanach', 'responsa', 'drush', 'yiddish', 'siddur'].every(g =>
    HISTORICAL_LAYOUTS.some(r => r.metadata.genre.includes(g))
  ) && HISTORICAL_LAYOUTS.some(r => r.metadata.id === 'machon-edition'),
  'genres checked against metadata.genre (machon-edition is tagged modern/prose)'
);

// ── §C — applyRecipeToSettings ───────────────────────────────────────────
console.log('§C  applyRecipeToSettings');
const baseSettings = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
const beforeJson = JSON.stringify(baseSettings);
if (vilna) {
  const applied = applyRecipeToSettings(vilna, baseSettings);
  check('library recipe applies as a custom layout', applied.layoutType === 'custom_layout');
  check(
    'library recipe stores its regions as boxes',
    (applied.pageLayout.customLayout?.boxes.length ?? 0) === recipeToCustomLayoutBoxes(vilna).length &&
      (applied.pageLayout.customLayout?.boxes.length ?? 0) > 0,
    `${applied.pageLayout.customLayout?.boxes.length ?? 0} boxes`
  );
  check(
    'library recipe keeps the solver baseLayout on the design',
    applied.pageLayout.customLayout?.baseLayout === vilna.baseLayout
  );
  check(
    'library recipe sets the Vilna page size 240×340mm',
    Math.abs(applied.pageLayout.pageWidthPt - (240 * 72) / 25.4) < 1 &&
      Math.abs(applied.pageLayout.pageHeightPt - (340 * 72) / 25.4) < 1,
    `${applied.pageLayout.pageWidthPt.toFixed(1)}×${applied.pageLayout.pageHeightPt.toFixed(1)}pt`
  );
  check(
    'library recipe sets source font 14.5',
    applied.ravText.sourceFontSizePt === 14.5
  );
  check(
    'library recipe first box is the header band',
    applied.pageLayout.customLayout?.boxes[0]?.role === 'header'
  );
  check(
    'apply does not mutate its input',
    JSON.stringify(baseSettings) === beforeJson
  );
}
// Designer export → custom_layout with the frames.
const designerBoxes = defaultBoxesForBaseLayout('rav_text');
const exported = recipeFromBoxes(designerBoxes, 'rav_text', { nameHe: 'בדיקה' });
check('designer export validates clean', validateRecipe(exported).length === 0);
const customSwitched = DesignSettingsEngine.updateLayoutSettings(
  baseSettings,
  { layoutType: 'custom_layout' },
  'user'
);
const customApplied = applyRecipeToSettings(exported, customSwitched);
check(
  'designer export stays custom_layout',
  customApplied.layoutType === 'custom_layout'
);
check(
  'designer export frames land on customLayout with the solver base',
  customApplied.pageLayout.customLayout?.baseLayout === 'rav_text' &&
    (customApplied.pageLayout.customLayout?.boxes.length ?? 0) === designerBoxes.length
);
// recipeFromSettings round-trip on a custom-layout book.
const settingsRecipe = recipeFromSettings(customApplied, {
  id: 'round-trip',
  name: 'Round trip',
  nameHe: 'מהספר',
  description: 'Round trip from the current book.',
  genre: ['custom'],
  origin: 'smoke',
});
check('recipeFromSettings validates clean', validateRecipe(settingsRecipe).length === 0);
check(
  'recipeFromSettings keeps the solver baseLayout + regions',
  settingsRecipe.baseLayout === 'rav_text' && settingsRecipe.regions.length > 0
);
// Imported regions become sanitized CustomLayoutBoxes (fresh ids, in range).
const recipeBoxes = recipeToCustomLayoutBoxes(exported);
check(
  'recipe regions → sanitized boxes, all in range',
  recipeBoxes.length === exported.regions.length &&
    recipeBoxes.every(b => b.xPct + b.widthPct <= 100.5 && b.yPct + b.heightPct <= 100.5)
);

// ── §D — tier + rule inspector state; polygon kinds ──────────────────────
console.log('§D  tier + rules + polygons');
check('11 tiers offered', CUSTOM_LAYOUT_BOX_TIERS.length === 11);
check(
  'tierForRole maps every role',
  (['main_text', 'commentary', 'header', 'footnote', 'side_note'] as const).every(
    r => typeof tierForRole(r) === 'string'
  )
);
const freshBox = makeCustomLayoutBox('commentary', 0, 0, 24, 100);
check('new box starts on its role tier', freshBox.tier === 'commentary');
const tiered = { ...freshBox, tier: 'rashi' as const };
check('explicit tier wins over the role tier', effectiveBoxTier(tiered) === 'rashi');
check('tier labels exist in both languages', boxTierLabel('tosafot', 'he') === 'תוספות' && boxTierLabel('tosafot', 'en') === 'Tosafot');
// Rule-inspector values persist on the box through the sanitizer.
const ruledBox: CustomLayoutBox = {
  ...makeCustomLayoutBox('main_text', 26, 0, 48, 100),
  rules: {
    minFontSizePt: 12,
    maxFontSizePt: 16,
    lineHeightRatio: 1.4,
    columnGutterPt: 14,
    alignment: 'justify',
  },
};
const cleanRuled = sanitizeCustomLayoutBox(ruledBox, { gridSizePt: 0 });
check(
  'rule-inspector values persist on the box',
  cleanRuled.rules?.minFontSizePt === 12 &&
    cleanRuled.rules?.maxFontSizePt === 16 &&
    cleanRuled.rules?.lineHeightRatio === 1.4 &&
    cleanRuled.rules?.columnGutterPt === 14 &&
    cleanRuled.rules?.alignment === 'justify'
);
// Out-of-range rules are clamped, never widened; unknown tier falls back.
const clamped = sanitizeCustomLayoutBoxRules({
  minFontSizePt: 2,
  maxFontSizePt: 90,
  lineHeightRatio: 5,
  columnGutterPt: -4,
  alignment: 'justify',
});
check(
  'rule values clamp to range',
  clamped?.minFontSizePt === 6 &&
    clamped?.maxFontSizePt === 72 &&
    clamped?.lineHeightRatio === 2.2 &&
    clamped?.columnGutterPt === 0
);
const inverted = sanitizeCustomLayoutBoxRules({ minFontSizePt: 16, maxFontSizePt: 10 });
check('max below min is raised to min', inverted?.maxFontSizePt === 16);
const badTierBox = sanitizeCustomLayoutBox(
  { ...makeCustomLayoutBox('main_text', 0, 0, 50, 50), tier: 'nope' as never },
  { gridSizePt: 0 }
);
check('unknown tier falls back to the role tier', badTierBox.tier === 'main_text');
// Polygon vertex editing: every labelled kind is reachable, presets are sane.
const labelKinds = Object.keys(CUSTOM_LAYOUT_POLYGON_LABELS_HE);
check(
  'every labelled polygon kind is offered (ellipse reachable)',
  labelKinds.every(k =>
    (CUSTOM_LAYOUT_POLYGON_KINDS as string[]).includes(k)
  ) && CUSTOM_LAYOUT_POLYGON_KINDS.includes('ellipse'),
  `${CUSTOM_LAYOUT_POLYGON_KINDS.join(',')}`
);
check(
  'polygon presets have ≥3 vertices',
  CUSTOM_LAYOUT_POLYGON_KINDS.filter(k => k !== 'rectangle').every(
    k => polygonPresetPoints(k).length >= 3
  )
);
const lShape = sanitizePolygonShape({ kind: 'l_shape', points: polygonPresetPoints('l_shape') });
check('L-shape survives sanitize with 6 vertices', lShape?.points.length === 6);
const moved = sanitizePolygonShape({
  kind: 'custom',
  points: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 0.5, y: 0.6 },
    { x: 1, y: 0.6 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
});
check('vertex drag keeps the edited polygon (6 vertices)', moved?.points.length === 6);

// ── §E — transactional apply ─────────────────────────────────────────────
console.log('§E  transactional preset switch');
const switchPlan = planLayoutSwitch({
  prevLayout: 'rav_text',
  nextLayout: 'two_column',
  localOverrides: [
    { id: 'o1', unitId: 'u1', forcePageBreakBeforeUnitId: 'u1' },
    { id: 'o2', unitId: 'u2', keepTogetherUnitIds: ['u2', 'u3'] },
  ] as never,
  breakInstructions: [{ id: 'b1' }] as never,
  hasCustomPageOverrides: true,
  selectedUnitId: 'u1',
  editingUnitId: null,
});
check('switch drops break instructions', switchPlan.nextBreakInstructions.length === 0);
check('switch drops per-page custom overrides', switchPlan.clearCustomPageOverrides === true);
check('switch clears the selection', switchPlan.clearSelection === true);
check(
  'switch carries force-breaks, drops keep-together',
  switchPlan.nextLocalOverrides.length === 1 &&
    switchPlan.nextLocalOverrides[0]?.forcePageBreakBeforeUnitId === 'u1'
);
check('switch reports what it reset', switchPlan.report.length >= 3);

// ── §F — static UI checks ────────────────────────────────────────────────
console.log('§F  static UI checks');
const designerSrc = readSrc('components/CustomLayoutDesigner.tsx');
check('designer renamed to Manuscript & Custom Layout Designer', designerSrc.includes('מעצב כתבי־יד ופריסה מותאמת אישית'));
check('designer has the tier dropdown', designerSrc.includes('CUSTOM_LAYOUT_BOX_TIERS') && designerSrc.includes('handleBoxTierChange'));
check('designer has the rule inspector inputs', designerSrc.includes('גופן מינימלי (pt)') && designerSrc.includes('גובה שורה (יחס)') && designerSrc.includes('יישור הטקסט בתיבה:'));
// v0.9.2 Part A (A1): the column-gutter field was removed — a single box
// holds one column, so it had no effect anywhere.
check('designer no longer has the dead column-gutter field', !designerSrc.includes('מרווח טורים (pt)'));
check('designer applies rules in the preview', designerSrc.includes('box.rules?.alignment') && designerSrc.includes('box.rules?.lineHeightRatio'));
check('designer has template export', designerSrc.includes('ייצוא התבנית לקובץ') && designerSrc.includes('serializeRecipe'));
check('designer has template import with validation', designerSrc.includes('ייבוא תבנית מקובץ') && designerSrc.includes('deserializeRecipe') && designerSrc.includes('importErrors'));
check('designer vertex handles exist (drag/edit)', designerSrc.includes('onVertexPointerDown') && designerSrc.includes('onEdgeMidpointPointerDown') && designerSrc.includes('setPointerCapture'));
check('designer delegates to host handlers when present', designerSrc.includes('onExportTemplate') && designerSrc.includes('onImportTemplateFile'));

const panelSrc = readSrc('components/DesignTypesettingPanel.tsx');
check('panel has a Historical layouts section', panelSrc.includes('תבניות היסטוריות') && panelSrc.includes('getHistoricalLayoutLibrary'));
check('panel wires template handlers into the designer', panelSrc.includes('onExportTemplate={onExportTemplate}') && panelSrc.includes('onImportTemplateFile={onImportTemplateFile}'));

const headerSrc = readSrc('components/EditorialStudioHeader.tsx');
check('header menu no longer duplicates the Historical layouts library (v0.9.2 Part B: one home in the Design panel)', !headerSrc.includes('onApplyHistoricalRecipe') && !headerSrc.includes('getHistoricalLayoutLibrary'));

const modalSrc = readSrc('components/NewProjectModal.tsx');
// v0.9.4 — the modal is a shell around the shared NewProjectForm now;
// the library offer (heading + pending seam) lives in the form.
// v0.9.7 — the form offers the 11 CORE layouts (the 4 promoted recipes
// still use the pending seam); the FULL library lives in the Design
// panel now, not on the start screen.
const formSrc = readSrc('components/NewProjectForm.tsx');
check('new-project modal offers the 11 core layouts (via the shared form, v0.9.7); full library lives in the Design panel',
  modalSrc.includes('<NewProjectForm') && formSrc.includes('CORE_START_LAYOUTS') && formSrc.includes('savePendingHistoricalRecipe') && panelSrc.includes('getHistoricalLayoutLibrary'));

const appSrc = readSrc('App.tsx');
check('App has the Part B region', appSrc.includes('v0.9.0 Part B'));
check('App has the apply-recipe handler', appSrc.includes('handleApplyHistoricalRecipe') && appSrc.includes('applyRecipeTransactionally'));
check('App applies recipes through the transaction', appSrc.includes('planLayoutSwitch') && appSrc.includes('applyRecipeToSettings'));
check('App has template export + import handlers', appSrc.includes('handleExportTemplateRecipe') && appSrc.includes('handleImportTemplateFile'));
check('App consumes the pending historical recipe on create', appSrc.includes('consumePendingHistoricalRecipe'));
check('App wires the handlers into header + panel', appSrc.includes('onApplyHistoricalRecipe={handleApplyHistoricalRecipe}') && appSrc.includes('onExportTemplate={handleExportTemplateRecipe}'));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
