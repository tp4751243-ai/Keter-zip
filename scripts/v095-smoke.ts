/**
 * KETER-TYPE v0.9.5 — unification integrator smoke.
 *
 * Run from the repo root:  npx tsx scripts/v095-smoke.ts
 *
 * Proves the v0.9.5 merge (one unified recipe library, not layers):
 *  §1  exactly one source of truth — the old split tables are gone from
 *      auto-layout.ts, the unified tables live in historical-layouts.ts
 *      only, the 55 dead recipe name/description keys are gone from
 *      strings.ts, and the adapter copy is gone (summaries read straight
 *      from the recipe metadata)
 *  §2  no duplicate ids; every pre-merge id resolves — the 28 ids the
 *      v0.9.3 library had, plus tzenerene (promoted from adapter-only),
 *      plus the 2 fallbacks; the only aliases are vilna-shas + tzenerene
 *  §3  every recipe in the unified library paginates with 0 collisions
 *      (same generic multi-role document as the v090 integrator), aliases
 *      included, applied by id
 *  §4  the classifier reaches every recipe — one specificity order
 *      covers all 29 ids (the yiddish gap is closed), every recipe
 *      resolves by at least one of its own NL names, the Yiddish early
 *      branch returns yiddish-sefer, the neutral default is machon-edition
 *  §5  the picker lists exactly the unified set — 27 real recipes, both
 *      languages carried in the summary, grouped with an empty "other"
 *      shelf
 *  §6  shared geometry stays shared by design — the four single-column
 *      prose recipes share one rect list, the Shas printings share the
 *      11-rect Vilna core, tanya / machon-edition share the 78/85 rects
 *  §7  rules + aliases cover every id, no duplicate alias inside an
 *      entry, and the adapter is gone from the build (no V093_ anywhere
 *      in src/)
 *
 * What v0.9.5 did NOT do (so this smoke does not assert it): no recipe
 * was deleted or merged away — the merge was of TABLES, not recipes.
 * The MANIFEST records the mergers (table moves + alias promotion) and
 * the deliberate non-mergers (four distinct books sharing one geometry).
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { applyRecipeToSettings } from '../src/engine/layout-recipes';
import {
  GENRE_SPECIFICITY_ORDER,
  HISTORICAL_LAYOUTS,
  HISTORICAL_RECIPE_ALIASES,
  HISTORICAL_RECIPE_RULES,
  getHistoricalLayoutLibrary,
  getHistoricalRecipe,
  getRecipeById,
  listHistoricalRecipes,
  matchGenreSignals,
  suggestRecipe,
} from '../src/engine/historical-layouts';
import {
  findRecipeByName,
  getRecipeByIdLocal,
  applyRecipeToSettingsById,
  getAllHistoricalRecipes,
} from '../src/engine/auto-layout';
import { EN_STRINGS } from '../src/i18n/strings';
import { groupHistoricalLibrary } from '../src/components/NewProjectForm';
import type { ContentUnit, PageTypesetResult, TypesetLine } from '../src/types/typesetter';

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

// The 28 ids the v0.9.3 library had (27 real + vilna-shas alias) plus
// tzenerene, which was adapter-only in v0.9.3 and is a proper library
// alias since v0.9.5. Nothing was dropped: the unified library is
// exactly these 29 entries.
const PRE_MERGE_IDS = [
  'talmud-bavli', 'vilna-shas', 'mikraot-gedolot', 'shulchan-aruch',
  'chumash-rishonim', 'responsa', 'chassidic-drush', 'yiddish-sefer',
  'machon-edition', 'siddur',
  'shas-oz-vehadar', 'shas-artscroll', 'shas-steinzaltz', 'yerushalmi',
  'mishnah-classic', 'mishnah-kehati', 'mishneh-torah', 'mishnah-berurah',
  'aruch-hashulchan', 'tur', 'kitzur-shulchan-aruch', 'chumash',
  'tanach-commentary', 'midrash', 'ein-yaakov', 'mussar', 'tanya', 'machzor',
  'tzenerene',
] as const;

// ── §1 — one source of truth ─────────────────────────────────────────────
console.log('§1  one source of truth');
{
  const al = fs.readFileSync(path.join(ROOT, 'src/engine/auto-layout.ts'), 'utf8');
  check('auto-layout.ts has no RECIPE_RULES table', !/RECIPE_RULES/.test(al.replace(/HISTORICAL_RECIPE_RULES/g, '')));
  check('auto-layout.ts has no RECIPE_ALIASES table', !/RECIPE_ALIASES/.test(al.replace(/HISTORICAL_RECIPE_ALIASES/g, '')));
  check('auto-layout.ts has no V093_ leftovers', !/V093_/.test(al));
  check('auto-layout.ts has no toV093AdapterRecipe', !al.includes('toV093AdapterRecipe'));
  check('auto-layout.ts reads the unified tables', al.includes('HISTORICAL_RECIPE_RULES') && al.includes('HISTORICAL_RECIPE_ALIASES'));
  const hl = fs.readFileSync(path.join(ROOT, 'src/engine/historical-layouts.ts'), 'utf8');
  check('historical-layouts.ts exports HISTORICAL_RECIPE_RULES', hl.includes('export const HISTORICAL_RECIPE_RULES'));
  check('historical-layouts.ts exports HISTORICAL_RECIPE_ALIASES', hl.includes('export const HISTORICAL_RECIPE_ALIASES'));
  // No other module owns a recipe table.
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src/engine')).filter(f => f.endsWith('.ts'));
  const owners = srcFiles.filter(f => {
    const s = fs.readFileSync(path.join(ROOT, 'src/engine', f), 'utf8');
    return /export const HISTORICAL_RECIPE_(RULES|ALIASES)/.test(s);
  });
  check('exactly one module owns the unified tables', owners.length === 1 && owners[0] === 'historical-layouts.ts', owners.join(', '));
  // The 55 dead strings.ts recipe keys are gone (sample across all three generations).
  const deadKeys = [
    'ש״ס עוז והדר', 'ש״ס וילנא — דף', 'שו״ת', 'מהדורת מכון מודרנית',
    'מחזור לראש השנה ויום כיפור: פורמט גדול מספר תפילה יומיומי, פיוטים בסגנון מובלט עם פזמונים ממורכזים, סליחות ונעילה כחלקים נפרדים.',
    'גמרא במרכז, רש״י בצד הפנימי ותוספות בצד החיצוני, עם ברכיים דינמיות. דף וילנא קלאסי.',
    'שולחן ערוך — שני טורים', 'מקראות גדולות — שש שכבות',
  ];
  check('dead recipe name/description keys are gone from strings.ts',
    deadKeys.every(k => !(k in EN_STRINGS)), deadKeys.filter(k => k in EN_STRINGS).join(' | '));
  // The adapter copy is gone: the C-facing summaries ARE the metadata
  // (compared against the entry as listed — getHistoricalRecipe, not
  // getRecipeById, which resolves an alias to its target).
  for (const id of ['shas-oz-vehadar', 'mishnah-berurah', 'talmud-bavli', 'siddur', 'tzenerene', 'vilna-shas']) {
    const local = getRecipeByIdLocal(id)!;
    const lib = getHistoricalRecipe(id)!;
    check(`summaryHe of ${id} is the metadata descriptionHe`,
      local.summaryHe === lib.metadata.descriptionHe, local.summaryHe?.slice(0, 40) ?? '');
    check(`summaryEn of ${id} is the metadata description`,
      local.summaryEn === lib.metadata.description);
  }
}

// ── §2 — no duplicates; every old id resolves ────────────────────────────
console.log('§2  no duplicate ids; every pre-merge id resolves');
{
  const libIds = HISTORICAL_LAYOUTS.map(r => r.metadata.id);
  check('library is 29 entries (27 real + 2 aliases)', HISTORICAL_LAYOUTS.length === 29, `got ${HISTORICAL_LAYOUTS.length}`);
  check('library ids are unique', new Set(libIds).size === libIds.length);
  check('library ids are exactly the pre-merge ids + tzenerene',
    libIds.length === PRE_MERGE_IDS.length && PRE_MERGE_IDS.every(id => libIds.includes(id)),
    libIds.filter(id => !(PRE_MERGE_IDS as readonly string[]).includes(id)).join(', ') || 'exact');
  const recipeIds = getAllHistoricalRecipes().map(r => r.id);
  check('getAllHistoricalRecipes() is 31 entries (29 + 2 fallbacks)', getAllHistoricalRecipes().length === 31, `got ${getAllHistoricalRecipes().length}`);
  check('getAllHistoricalRecipes() ids are unique', new Set(recipeIds).size === recipeIds.length);
  for (const id of PRE_MERGE_IDS) {
    check(`old id ${id} resolves in the library`, getRecipeById(id) !== undefined);
    check(`old id ${id} resolves in the NL/AI catalogue`, getRecipeByIdLocal(id) !== undefined);
  }
  check('fallbacks are the plain layout types, not recipes',
    getRecipeByIdLocal('single-column')?.layoutType === 'single_column' &&
    getRecipeByIdLocal('two-column')?.layoutType === 'two_column');
  const aliases = HISTORICAL_LAYOUTS.filter(r => r.aliasOf);
  check('the only aliases are vilna-shas + tzenerene',
    aliases.length === 2 &&
    aliases.some(r => r.metadata.id === 'vilna-shas' && r.aliasOf === 'talmud-bavli') &&
    aliases.some(r => r.metadata.id === 'tzenerene' && r.aliasOf === 'yiddish-sefer'),
    aliases.map(r => `${r.metadata.id}→${r.aliasOf}`).join(', '));
  check('vilna-shas resolves to talmud-bavli', getRecipeById('vilna-shas')?.metadata.id === 'talmud-bavli');
  check('tzenerene resolves to yiddish-sefer', getRecipeById('tzenerene')?.metadata.id === 'yiddish-sefer');
}

// ── §3 — every recipe paginates, 0 collisions ────────────────────────────
console.log('§3  every recipe paginates, 0 collisions');
const GEMARA = 'אָמַר רַבִּי יְהוּדָה אָמַר רַב: כָּל הָעוֹסֵק בַּתּוֹרָה לִשְׁמָהּ — זוֹכֶה לִדְבָרִים הַרְבֵּה. ';
const RASHI = 'דיבור המתחיל: פירוש קצר על הגמרא, מילה במילה. ';
const TOSAFOT = 'תוספות: קושיא ותירוץ, דיון ארוך בין הראשונים. ';
function unit(id: string, role: ContentUnit['role'], text: string, order: number, extra?: Partial<ContentUnit>): ContentUnit {
  return { id, role, rawText: text, styleName: 'Normal', order, hierarchyLevel: 2, ...extra };
}
function makeGenericUnits(): ContentUnit[] {
  return [
    unit('u-main', 'main_source', GEMARA.repeat(40), 1),
    unit('u-heading', 'heading', 'פרק ראשון', 2, { hierarchyLevel: 1 }),
    unit('u-verse', 'verse', 'בְּרֵאשִׁית בָּרָא אֱלֹהִים. '.repeat(20), 3),
    unit('u-para', 'regular_paragraph', 'ברוך אתה יי. '.repeat(20), 4),
    unit('u-rashi', 'primary_comment', RASHI.repeat(30), 5, { hierarchyLevel: 3, linkedSourceId: 'u-main' }),
    unit('u-tos', 'secondary_comment', TOSAFOT.repeat(30), 6, { hierarchyLevel: 3, linkedSourceId: 'u-main' }),
    unit('u-ter', 'tertiary_comment', 'עין משפט: סימן א׳. '.repeat(20), 7, { hierarchyLevel: 3 }),
    unit('u-foot', 'footnote', 'הערת שוליים. '.repeat(10), 8),
    unit('u-side', 'side_note', 'הערה קצרה. '.repeat(10), 9),
  ];
}
function allLines(pg: PageTypesetResult): TypesetLine[] {
  return [
    ...pg.sourceLines, ...pg.rashiLines, ...pg.tosafotLines,
    ...(pg.footnoteLines ?? []), ...(pg.column2Lines ?? []),
    ...(pg.sideNoteLines ?? []), ...(pg.tertiaryLines ?? []),
  ];
}
function collisionCount(doc: { pages: PageTypesetResult[] }): number {
  return doc.pages.reduce((acc, pg) => acc + (pg.layoutScore?.collisionCount ?? 0), 0);
}
function placedUnitIds(doc: { pages: PageTypesetResult[] }): Set<string> {
  const ids = new Set<string>();
  for (const pg of doc.pages) {
    for (const l of allLines(pg)) {
      if (l.unitId) ids.add(l.unitId);
      for (const w of l.words ?? []) if (w.unitId) ids.add(w.unitId);
    }
  }
  return ids;
}
for (const recipe of listHistoricalRecipes()) {
  const units = makeGenericUnits();
  const settings = DesignSettingsEngine.createDefaultSettings();
  let applied;
  let doc;
  try {
    applied = applyRecipeToSettings(recipe, settings);
    doc = PaginationEngine.paginateDocument({
      title: recipe.metadata.id, layoutType: 'custom_layout', units,
      geometry: applied.pageLayout.geometry, links: [], designSettings: applied,
    });
  } catch (e) {
    check(`'${recipe.metadata.id}' applies + paginates`, false, e instanceof Error ? e.message : String(e));
    continue;
  }
  const placed = placedUnitIds(doc);
  const missing = units.map(u => u.id).filter(id => !placed.has(id));
  check(`'${recipe.metadata.id}' places every unit`, missing.length === 0, missing.join(','));
  check(`'${recipe.metadata.id}' has 0 collisions`, collisionCount(doc) === 0, `${collisionCount(doc)}`);
  check(`'${recipe.metadata.id}' yields ≥1 page`, doc.pages.length >= 1, `${doc.pages.length} pages`);
}
for (const aliasId of ['vilna-shas', 'tzenerene']) {
  const units = makeGenericUnits();
  const settings = DesignSettingsEngine.createDefaultSettings();
  try {
    const applied = applyRecipeToSettingsById(aliasId, settings);
    const doc = PaginationEngine.paginateDocument({
      title: aliasId, layoutType: 'custom_layout', units,
      geometry: applied.pageLayout.geometry, links: [], designSettings: applied,
    });
    check(`alias '${aliasId}' applies by id + paginates 0 collisions`, collisionCount(doc) === 0, `${collisionCount(doc)}`);
  } catch (e) {
    check(`alias '${aliasId}' applies by id`, false, e instanceof Error ? e.message : String(e));
  }
}

// ── §4 — the classifier reaches every recipe ─────────────────────────────
console.log('§4  the classifier reaches every recipe');
{
  const allIds = HISTORICAL_LAYOUTS.map(r => r.metadata.id);
  const uncovered = allIds.filter(id => !GENRE_SPECIFICITY_ORDER.includes(id));
  check('one specificity order covers all 29 ids (no recipe sorts last by accident)',
    uncovered.length === 0, uncovered.join(', ') || 'all covered');
  check('yiddish-sefer is grouped (was ungrouped → sorted last in v0.9.3)',
    GENRE_SPECIFICITY_ORDER.indexOf('yiddish-sefer') < GENRE_SPECIFICITY_ORDER.indexOf('mishnah-classic'));
  // NL reachability: every recipe resolves by at least one of its own names.
  for (const id of allIds) {
    const aliases = HISTORICAL_RECIPE_ALIASES[id] ?? [];
    const resolves = aliases.some(a => findRecipeByName(a)?.id === id);
    check(`NL name resolves ${id}`, resolves, aliases.slice(0, 3).join(' / '));
  }
  // The Yiddish early branch (language-based) still returns yiddish-sefer.
  const yid = suggestRecipe({
    roles: {}, languages: ['yi'], hasDibbur: false, commentaryCount: 0,
    isYiddish: true, hasFootnotes: false, signals: matchGenreSignals('צאינה וראינה', 'title'), rolePatterns: [],
  });
  check('Yiddish document classifies to yiddish-sefer', yid?.recipeId === 'yiddish-sefer', yid?.recipeId ?? 'null');
  // The neutral default is machon-edition, stated.
  const plain = suggestRecipe({
    roles: {}, languages: ['he'], hasDibbur: false, commentaryCount: 0,
    isYiddish: false, hasFootnotes: false, signals: [], rolePatterns: [],
  });
  check('content-free input falls back to machon-edition', plain?.recipeId === 'machon-edition', plain?.recipeId ?? 'null');
}

// ── §5 — the picker lists exactly the unified set ────────────────────────
console.log('§5  the picker lists exactly the unified set');
{
  const lib = getHistoricalLayoutLibrary();
  const nonAlias = HISTORICAL_LAYOUTS.filter(r => !r.aliasOf).map(r => r.metadata.id);
  check('picker lists 27 real recipes', lib.length === 27, `got ${lib.length}`);
  check('picker ids === non-alias library ids',
    lib.length === nonAlias.length && nonAlias.every(id => lib.some(e => e.id === id)));
  check('every picker entry carries both languages',
    lib.every(e => e.nameHe.trim() && e.nameEn.trim() && e.descriptionHe.trim() && e.descriptionEn.trim()));
  check('every picker entry descriptionHe is Hebrew prose',
    lib.every(e => /[\u0590-\u05FF]/.test(e.descriptionHe)));
  check('every picker entry descriptionEn is English prose',
    lib.every(e => /[a-z]/.test(e.descriptionEn)));
  check('every picker id resolves to an applicable recipe',
    lib.every(e => getRecipeById(e.id) !== undefined));
  const groups = groupHistoricalLibrary(lib);
  const groupedTotal = groups.reduce((n, g) => n + g.entries.length, 0);
  check('grouping keeps all 27 recipes', groupedTotal === 27, `grouped ${groupedTotal}`);
  const other = groups.find(g => g.key === 'other');
  check('"other" shelf is empty (no recipe fell out of its group)', !other || other.entries.length === 0,
    other ? other.entries.map(e => e.id).join(', ') : '');
}

// ── §6 — shared geometry stays shared by design ──────────────────────────
console.log('§6  shared geometry stays shared by design');
{
  const rects = (id: string): string[] => {
    const r = getRecipeById(id)!;
    return r.regions.map(g => `${g.role}:${(g.shape as { x: number; y: number; w: number; h: number }).x},${(g.shape as { x: number; y: number; w: number; h: number }).y},${(g.shape as { x: number; y: number; w: number; h: number }).w},${(g.shape as { x: number; y: number; w: number; h: number }).h}`);
  };
  const eq = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  const single = ['responsa', 'aruch-hashulchan', 'kitzur-shulchan-aruch', 'mussar'];
  for (let i = 1; i < single.length; i++) {
    check(`single-column prose geometry: ${single[0]} === ${single[i]}`, eq(rects(single[0]), rects(single[i])));
  }
  const vilna = rects('talmud-bavli');
  check('shas-artscroll shares the 11-rect Vilna core', eq(vilna, rects('shas-artscroll')));
  const stein = rects('shas-steinzaltz');
  // Steinsaltz keeps the 11-rect Vilna core (same roles + coordinates;
  // its two marginal rects carry steinzaltz ids at the same coordinates
  // the gilyon / hagahot rects occupy in the Vilna folio) and adds one
  // footnote band for its explanatory notes.
  check('shas-steinzaltz shares the 11-rect Vilna core (+1 notes band)',
    stein.length === 12 && eq(vilna, stein.slice(0, 11)), `${stein.length} rects`);
  check('shas-steinzaltz marginal rects are its own notes/sources, same coordinates',
    getHistoricalRecipe('shas-steinzaltz')!.regions[9].id === 'steinzaltz-notes' &&
    getHistoricalRecipe('shas-steinzaltz')!.regions[10].id === 'steinzaltz-sources');
  const oz = rects('shas-oz-vehadar');
  check('shas-oz-vehadar keeps its wider flanks (26% vs 24% — a real edition difference)',
    oz.length === 13 && oz[3] !== vilna[3], `${oz.length} rects`);
  check('tanya shares the 78/85 rects with machon-edition', eq(rects('tanya'), rects('machon-edition')));
  // …but they stay distinct recipes (different typography, different book).
  const tanya = getRecipeById('tanya')!;
  const machon = getRecipeById('machon-edition')!;
  check('tanya and machon-edition keep distinct typography',
    tanya.typography?.mainFontSizePt !== machon.typography?.mainFontSizePt);
}

// ── §7 — rules + aliases cover every id ──────────────────────────────────
console.log('§7  rules + aliases cover every id');
{
  for (const r of HISTORICAL_LAYOUTS) {
    const id = r.metadata.id;
    const rules = HISTORICAL_RECIPE_RULES[id] ?? [];
    const aliases = HISTORICAL_RECIPE_ALIASES[id] ?? [];
    check(`${id} has rules`, rules.length > 0, `${rules.length} rules`);
    check(`${id} has NL aliases`, aliases.length > 0, `${aliases.length} aliases`);
    check(`${id} aliases are unique inside the entry`, new Set(aliases).size === aliases.length);
    const local = getRecipeByIdLocal(id)!;
    check(`${id} catalogue entry includes the id itself`, local.aliases.includes(id));
    check(`${id} catalogue entry carries the unified rules`, local.rules.length === rules.length);
  }
  // No V093_ anywhere in src/ (the split is gone, not just moved).
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
  const v093left = walk(path.join(ROOT, 'src')).filter(f => /\.tsx?$/.test(f) && /V093_/.test(fs.readFileSync(f, 'utf8')));
  check('no V093_ references remain anywhere in src/', v093left.length === 0, v093left.join(', '));
}

console.log(`\nv095-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
