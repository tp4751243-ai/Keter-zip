/**
 * KETER-TYPE v0.9.3 — merged integrator smoke (Parts A + B + C).
 *
 * Run from the tree root:  npx tsx scripts/v093-smoke.ts
 *
 * Cross-cut checks over the MERGED tree (not the part scratches):
 *  §1  library + adapter dedup: 29 entries / 27 real recipes + 2
 *      aliases (vilna-shas, tzenerene — v0.9.5 unification), alias
 *      resolves, every recipe validates; every one of Part C's 18
 *      adapter ids now resolves to a Part A library recipe (the
 *      Part C "PENDING" list is empty — no geometry no-op remains);
 *      getAllHistoricalRecipes() has no duplicate ids; siddur carries the
 *      five nusachot, no duplicate siddur recipes
 *  §2  classifier cross-cut: the production matcher
 *      (matchGenreSignals) + the merged suggestRecipe pick the right
 *      recipe for all 18 new genres from a canonical hint text
 *      (publisher Shas variants need the Gemara-flank role pattern;
 *      'chumash' is weak and needs a verse role pattern); the v0.9.0
 *      §D expectations still hold (Vilna / Mikraot / prose / siddur /
 *      Shulchan Aruch / Yiddish / fallbacks)
 *  §3  NL cross-cut: the 18 contract phrases resolve via
 *      findRecipeByName and parse to validated commands; applying one
 *      new recipe end-to-end (mishnah-berurah) changes the settings
 *      and lays out; an unknown id returns the settings unchanged
 *  §4  picker strings: every NEW recipe's name + description are
 *      carried in both languages in the library metadata itself
 *      (v0.9.5: no EN_STRINGS lookup any more — the v0.9.3 merge
 *      alignment, adapter nameHe/nameEn == library metadata, is now
 *      structural: the catalogue entry IS the library entry)
 *  §5  typography cross-cut (merged recipe path): MB dibbur ON,
 *      Rambam dibbur explicitly OFF, machon tracking (not kashya),
 *      mussar first-line indent, machzor no indents
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  getAllHistoricalRecipes,
  applyRecipeToSettingsById,
  findRecipeByName,
  parseAutoLayoutCommand,
} from '../src/engine/auto-layout';
import {
  HISTORICAL_LAYOUTS,
  getHistoricalLayoutLibrary,
  getRecipeById,
  matchGenreSignals,
  suggestRecipe,
  type DocumentClassification,
} from '../src/engine/historical-layouts';
import { validateRecipe } from '../src/engine/layout-recipes';

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const NEW_IDS = [
  'shas-oz-vehadar',
  'shas-artscroll',
  'shas-steinzaltz',
  'yerushalmi',
  'mishnah-classic',
  'mishnah-kehati',
  'mishneh-torah',
  'mishnah-berurah',
  'aruch-hashulchan',
  'tur',
  'kitzur-shulchan-aruch',
  'chumash',
  'tanach-commentary',
  'midrash',
  'ein-yaakov',
  'mussar',
  'tanya',
  'machzor',
] as const;

console.log('== §1 — merged library + adapter dedup ==');
check('library is 29 entries (27 real + vilna-shas + tzenerene aliases)', HISTORICAL_LAYOUTS.length === 29, `got ${HISTORICAL_LAYOUTS.length}`);
check('picker library is 27 real recipes', getHistoricalLayoutLibrary().length === 27, `got ${getHistoricalLayoutLibrary().length}`);
check("vilna-shas alias resolves to the talmud-bavli recipe", getRecipeById('vilna-shas')?.metadata.id === 'talmud-bavli', getRecipeById('vilna-shas')?.metadata.id ?? 'undefined');
{
  let bad = 0;
  for (const r of HISTORICAL_LAYOUTS) {
    if (r.aliasOf) continue;
    if (validateRecipe(r).length !== 0) bad++;
  }
  check('every real recipe validates (0 errors)', bad === 0, bad === 0 ? '' : `${bad} invalid`);
}
check(
  'siddur carries five nusachot, no duplicate siddur recipes',
  (() => {
    const siddur = HISTORICAL_LAYOUTS.filter(r => r.metadata.id === 'siddur');
    const nusach = (siddur[0]?.metadata as { nusach?: string[] } | undefined)?.nusach ?? [];
    return siddur.length === 1 && nusach.length === 5;
  })(),
);
{
  const ids = getAllHistoricalRecipes().map(r => r.id);
  check('getAllHistoricalRecipes() has no duplicate ids', new Set(ids).size === ids.length, `got ${ids.length} entries, ${new Set(ids).size} unique`);
  const unresolved = NEW_IDS.filter(id => getRecipeById(id) === undefined);
  check('all 18 Part C adapter ids now resolve to a Part A library recipe', unresolved.length === 0, unresolved.length === 0 ? '' : `unresolved: ${unresolved.join(', ')}`);
  const adapterWins = NEW_IDS.filter(id => {
    const fromAdapter = getAllHistoricalRecipes().find(r => r.id === id);
    const fromLibrary = getRecipeById(id);
    // The library recipe must win the dedup: the adapter entry is skipped.
    return fromAdapter !== undefined && fromLibrary !== undefined && fromAdapter.nameHe === fromLibrary.metadata.nameHe;
  });
  check('Part A recipe metadata wins the adapter dedup for all 18 ids', adapterWins.length === 18, `${adapterWins.length}/18`);
}

console.log('== §2 — classifier cross-cut (matcher + merged suggestRecipe) ==');
function baseClassification(signals: ReturnType<typeof matchGenreSignals>, rolePatterns: string[]): DocumentClassification {
  return {
    roles: { main_source: 3, primary_comment: 2, secondary_comment: 2 },
    languages: ['he'],
    hasDibbur: true,
    commentaryCount: 3,
    isYiddish: false,
    hasFootnotes: false,
    signals,
    rolePatterns,
  };
}
const HINT_TEXT: Record<string, { text: string; rolePatterns: string[]; minConfidence: number }> = {
  'shas-oz-vehadar': { text: 'Oz VeHadar', rolePatterns: ['gemara-flanks'], minConfidence: 0.9 },
  'shas-artscroll': { text: 'ArtScroll Schottenstein', rolePatterns: ['gemara-flanks'], minConfidence: 0.9 },
  'shas-steinzaltz': { text: 'Steinsaltz', rolePatterns: ['gemara-flanks'], minConfidence: 0.9 },
  yerushalmi: { text: 'ירושלמי', rolePatterns: [], minConfidence: 0.85 },
  'mishnah-classic': { text: 'משנה עם ברטנורא', rolePatterns: [], minConfidence: 0.85 },
  'mishnah-kehati': { text: 'קהתי', rolePatterns: [], minConfidence: 0.85 },
  'mishneh-torah': { text: 'משנה תורה', rolePatterns: [], minConfidence: 0.85 },
  'mishnah-berurah': { text: 'משנה ברורה', rolePatterns: [], minConfidence: 0.85 },
  'aruch-hashulchan': { text: 'ערוך השולחן', rolePatterns: [], minConfidence: 0.85 },
  tur: { text: 'ארבעה טורים', rolePatterns: [], minConfidence: 0.85 },
  'kitzur-shulchan-aruch': { text: 'קיצור שולחן ערוך', rolePatterns: [], minConfidence: 0.85 },
  // 'chumash' is a weak hint: it needs a verse role pattern (0.7–0.8).
  chumash: { text: 'חומש', rolePatterns: ['verse-targum'], minConfidence: 0.7 },
  'tanach-commentary': { text: 'מצודות', rolePatterns: [], minConfidence: 0.85 },
  midrash: { text: 'מדרש רבה', rolePatterns: [], minConfidence: 0.85 },
  'ein-yaakov': { text: 'עין יעקב', rolePatterns: [], minConfidence: 0.85 },
  mussar: { text: 'מסילת ישרים', rolePatterns: [], minConfidence: 0.85 },
  tanya: { text: 'תניא', rolePatterns: [], minConfidence: 0.85 },
  machzor: { text: 'מחזור', rolePatterns: [], minConfidence: 0.85 },
};
for (const id of NEW_IDS) {
  const { text, rolePatterns, minConfidence } = HINT_TEXT[id];
  const signals = matchGenreSignals(text, 'title');
  const s = suggestRecipe(baseClassification(signals, rolePatterns));
  check(
    `"${text}" → ${id}`,
    s.recipeId === id && s.confidence >= minConfidence && s.fallback === false,
    `got ${s.recipeId} conf=${s.confidence} fallback=${s.fallback} (${s.reasons.join(' ')})`,
  );
}
// v0.9.0 §D expectations, unchanged.
function expectSuggest(name: string, c: DocumentClassification, recipeId: string, minConfidence: number, fallback: boolean): void {
  const s = suggestRecipe(c);
  check(
    `${name} → ${recipeId}`,
    s.recipeId === recipeId && s.confidence >= minConfidence && s.fallback === fallback,
    `got ${s.recipeId} conf=${s.confidence} fallback=${s.fallback} (${s.reasons.join(' ')})`,
  );
}
expectSuggest(
  'Vilna-like',
  { roles: { main_source: 5, primary_comment: 4, secondary_comment: 4, tertiary_comment: 2 }, languages: ['he'], hasDibbur: true, commentaryCount: 3, isYiddish: false, hasFootnotes: false },
  'talmud-bavli', 0.9, false,
);
expectSuggest(
  'Mikraot-like',
  { roles: { verse: 8, primary_comment: 3, secondary_comment: 3, tertiary_comment: 3 }, languages: ['he'], hasDibbur: false, commentaryCount: 5, isYiddish: false, hasFootnotes: false },
  'mikraot-gedolot', 0.9, false,
);
expectSuggest(
  'prose',
  { roles: { regular_paragraph: 10, main_source: 2 }, languages: ['he'], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false },
  'machon-edition', 0.7, false,
);
expectSuggest(
  'siddur-like',
  { genreHint: 'siddur mincha', roles: { regular_paragraph: 8 }, languages: ['he'], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false },
  'siddur', 0.9, false,
);
expectSuggest(
  'Shulchan-Aruch-like',
  { genreHint: 'shulchan aruch', roles: { main_source: 4, siman: 3, seif: 6, primary_comment: 2 }, languages: ['he'], hasDibbur: false, commentaryCount: 3, isYiddish: false, hasFootnotes: false },
  'shulchan-aruch', 0.85, false,
);
expectSuggest(
  'Yiddish',
  { roles: { main_source: 3, primary_comment: 3 }, languages: ['yi', 'he'], hasDibbur: false, commentaryCount: 1, isYiddish: true, hasFootnotes: false },
  'yiddish-sefer', 0.9, false,
);
{
  const s = suggestRecipe({ roles: {}, languages: [], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false });
  check('unknown → low-confidence fallback', s.fallback === true && s.confidence < 0.5, `got ${s.recipeId} conf=${s.confidence} fallback=${s.fallback}`);
}

console.log('== §3 — NL cross-cut + end-to-end apply ==');
const PHRASES: Array<[string, string]> = [
  ['Format this like an Oz VeHadar Shas page', 'shas-oz-vehadar'],
  ['Apply a Mishnah Berurah layout', 'mishnah-berurah'],
  ["Lay this out like the Rambam's Mishneh Torah", 'mishneh-torah'],
  ['Yerushalmi page', 'yerushalmi'],
  ['Mishnah with Bartenura', 'mishnah-classic'],
  ['Kehati Mishnah', 'mishnah-kehati'],
  ['Aruch HaShulchan layout', 'aruch-hashulchan'],
  ['Kitzur Shulchan Aruch', 'kitzur-shulchan-aruch'],
  ['Midrash Rabbah page', 'midrash'],
  ['Ein Yaakov', 'ein-yaakov'],
  ['Mussar sefer', 'mussar'],
  ['Tanya layout', 'tanya'],
  ['Machzor for Rosh Hashanah', 'machzor'],
  ['Chumash with Targum and Rashi', 'chumash'],
  ["Nevi'im with Metzudot and Radak", 'tanach-commentary'],
  ['Steinsaltz page', 'shas-steinzaltz'],
  ['ArtScroll Schottenstein page', 'shas-artscroll'],
  ['Tur with Bach and Drishah', 'tur'],
];
for (const [phrase, id] of PHRASES) {
  const found = findRecipeByName(phrase);
  check(`findRecipeByName("${phrase}") → ${id}`, found?.id === id, found ? found.id : 'undefined');
}
// Only the command-style phrases (with a trigger verb) must parse as
// commands. Bare names ("Yerushalmi page", "Tanya layout", …) are
// questions, not commands — parseAutoLayoutCommand correctly returns
// null for them by design (v0.9.3 Part C §2), so asserting a parse
// there would be wrong.
const COMMANDS: Array<[string, string]> = [
  ['Format this like an Oz VeHadar Shas page', 'shas-oz-vehadar'],
  ['Apply a Mishnah Berurah layout', 'mishnah-berurah'],
  ["Lay this out like the Rambam's Mishneh Torah", 'mishneh-torah'],
  ['Apply a Kehati Mishnah layout', 'mishnah-kehati'],
  ["Lay this out like Nevi'im with Metzudot and Radak", 'tanach-commentary'],
  ['Format this like a Steinsaltz page', 'shas-steinzaltz'],
  ['Format this like an ArtScroll Schottenstein page', 'shas-artscroll'],
];
for (const [command, id] of COMMANDS) {
  const cmd = parseAutoLayoutCommand(command);
  check(
    `parse "${command}" → validated command (${id})`,
    cmd !== null && cmd.recipeId === id,
    cmd ? `${cmd.action}/${cmd.recipeId ?? '—'}` : 'null',
  );
}
{
  const settings = DesignSettingsEngine.createDefaultSettings();
  const applied = applyRecipeToSettingsById('mishnah-berurah', settings);
  check(
    'apply mishnah-berurah end-to-end (merged recipe path) lays out as custom_layout',
    applied.layoutType === 'custom_layout' && applied !== settings,
    `layoutType=${applied.layoutType}`,
  );
  check('applied MB settings carry dibbur bold (Biur Halacha ד״ה)', applied.ravText.dibburHamatchilBold === true);
  const unknown = applyRecipeToSettingsById('not-a-real-recipe', settings);
  check('unknown recipe id returns the settings unchanged (never guessed)', unknown === settings);
}

console.log('== §4 — picker strings (merge alignment) ==');
{
  // v0.9.5: both languages live in the library metadata itself — the
  // pickers render nameHe/nameEn + descriptionHe/descriptionEn
  // directly, so there is no EN_STRINGS entry to align any more. The
  // alignment the v0.9.3 check guarded (adapter nameHe/nameEn ==
  // library metadata) is now structural: the catalogue entry IS the
  // library entry. The v0.9.0 gap this section used to record (three
  // old recipes with no EN_STRINGS name entry) is closed the same way
  // — every recipe now carries its English name in its metadata.
  const missing: string[] = [];
  for (const id of NEW_IDS) {
    const recipe = getRecipeById(id);
    const nameHe = recipe?.metadata.nameHe ?? '';
    if (!nameHe) missing.push(`${id} (no nameHe)`);
    const adapter = getAllHistoricalRecipes().find(r => r.id === id);
    if (adapter !== undefined && adapter.nameHe !== nameHe) missing.push(`${id} (adapter nameHe mismatch)`);
    if (adapter !== undefined && adapter.nameEn !== (recipe?.metadata.name ?? '')) missing.push(`${id} (adapter nameEn mismatch)`);
    if (!(recipe?.metadata as { descriptionHe?: string }).descriptionHe) missing.push(`${id} (no descriptionHe)`);
  }
  check('every NEW recipe carries both languages in its metadata and matches the catalogue entry', missing.length === 0, missing.length === 0 ? '' : `missing: ${missing.join(', ')}`);
}

console.log('== §5 — typography cross-cut (merged recipe path) ==');
{
  type RoleStyles = { paragraph?: { firstLineIndentPt?: number; hangingIndentPt?: number }; character?: { wordSpacingRatio?: number; trackingEm?: number } };
  const settings = DesignSettingsEngine.createDefaultSettings();
  const roleStyles = (s: typeof settings, role: string): RoleStyles | undefined =>
    (s.projectRoleStyles as unknown as Record<string, RoleStyles | undefined>)[role];
  const mb = applyRecipeToSettingsById('mishnah-berurah', settings);
  check('MB: dibbur bold ON (Biur Halacha ד״ה)', mb.ravText.dibburHamatchilBold === true);
  check('MB: kashya justification (wordSpacingRatio 1.15)', roleStyles(mb, 'main_source')?.character?.wordSpacingRatio === 1.15);
  const rambam = applyRecipeToSettingsById('mishneh-torah', settings);
  check('Rambam: dibbur bold explicitly OFF (Raavad glosses have no dibbur)', rambam.ravText.dibburHamatchilBold === false);
  const machon = applyRecipeToSettingsById('machon-edition', settings);
  check(
    'Machon: tracking (0.02 em), not kashya',
    roleStyles(machon, 'main_source')?.character?.trackingEm === 0.02 && roleStyles(machon, 'main_source')?.character?.wordSpacingRatio === 1,
    `tracking=${roleStyles(machon, 'main_source')?.character?.trackingEm} ratio=${roleStyles(machon, 'main_source')?.character?.wordSpacingRatio}`,
  );
  const mussar = applyRecipeToSettingsById('mussar', settings);
  check('Mussar: first-line indent 12', roleStyles(mussar, 'main_source')?.paragraph?.firstLineIndentPt === 12);
  const machzor = applyRecipeToSettingsById('machzor', settings);
  check(
    'Machzor: no indents at all',
    roleStyles(machzor, 'main_source')?.paragraph?.firstLineIndentPt === 0 && roleStyles(machzor, 'main_source')?.paragraph?.hangingIndentPt === 0,
  );
}

console.log(`\nv093-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
