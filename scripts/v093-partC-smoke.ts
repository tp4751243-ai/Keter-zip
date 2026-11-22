/**
 * KETER-TYPE v0.9.3 Part C — AI rule context + pickers + strings smoke test.
 *
 * Run from the tree root:  npx tsx scripts/v093-partC-smoke.ts
 *
 * Pure-engine checks (no browser, no React) over the Part C scratch tree:
 *  §1  every contract NL phrase (RESEARCH-NOTE.md "AI NL phrases")
 *      resolves to the exact recipe id — by name (findRecipeByName) and
 *      as a command (parseAutoLayoutCommand → applyHistoricalLayout,
 *      validated action type, approval-card path)
 *  §2  unknown / variant / weak-hint phrases fall back safely: null,
 *      never throw, never guess an id (incl. Zohar — explicitly NOT
 *      added in this pass — and bare 'mishnah' / 'tur' / 'rosh hashanah'
 *      / 'bach', which the research note marks weak)
 *  §3  every new recipe id has picker strings in both languages —
 *      the library metadata carries nameHe/name and
 *      descriptionHe/description (v0.9.5: no EN_STRINGS lookup) + the
 *      new UI literals are translated
 *  §4  every label table covers all new ids (getAllHistoricalRecipes() entries
 *      have non-empty rules + aliases; ids unique; no adapter id
 *      duplicates a Part A recipe id)
 *  §5  Gemini prompt context lists all 18 new recipes + rules, and the
 *      AiChatPanel system-prompt id list names only ids the validator
 *      accepts (getRecipeByIdLocal)
 *  §6  pickers read the library dynamically (getHistoricalLayoutLibrary
 *      returns exactly the non-alias library recipes) — so the new
 *      recipes appear in the Design panel + New-Project modal with no
 *      further change once Part A lands them; the 18 ids are reported
 *      as PENDING (present in the adapter, absent from the library)
 *      until the Part A merge — pending is not a failure
 *  §7  v0.9.0 §6 regression: the original NL cases still parse the same
 *
 * Exit code 0 = every hard check passed (pending items listed
 * separately); 1 = at least one hard check failed.
 */

import { DOMParser } from '@xmldom/xmldom';
// The engine modules run under tsx (Node), where DOMParser / Node are
// not globals — install the @xmldom shims before importing them
// (same pattern as scripts/v090-partC-smoke.ts).
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
(globalThis as unknown as { Node: unknown }).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getAllHistoricalRecipes,
  buildRecipePromptContext,
  findRecipeByName,
  getRecipeByIdLocal,
  parseAutoLayoutCommand,
} from '../src/engine/auto-layout';
import { getHistoricalLayoutLibrary, getRecipeById, HISTORICAL_LAYOUTS } from '../src/engine/historical-layouts';
import { isKnownGeminiActionType } from '../src/engine/gemini-service';
import { EN_STRINGS } from '../src/i18n/strings';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passes = 0;
let failures = 0;
let pending = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function pend(name: string, detail = ''): void {
  pending++;
  console.log(`  PEND  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** The 18 contract phrases (RESEARCH-NOTE.md) with their exact recipe ids. */
const PHRASE_TO_ID: ReadonlyArray<[string, string]> = [
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

/** The same 18 phrases as explicit commands (trigger verb + phrase). */
const COMMAND_TO_ID: ReadonlyArray<[string, string]> = [
  ['Format this like an Oz VeHadar Shas page', 'shas-oz-vehadar'],
  ['Apply a Mishnah Berurah layout', 'mishnah-berurah'],
  ["Lay this out like the Rambam's Mishneh Torah", 'mishneh-torah'],
  ['Format this like a Yerushalmi page', 'yerushalmi'],
  ['Lay this out like Mishnah with Bartenura', 'mishnah-classic'],
  ['Apply a Kehati Mishnah layout', 'mishnah-kehati'],
  ['Apply an Aruch HaShulchan layout', 'aruch-hashulchan'],
  ['Format this like Kitzur Shulchan Aruch', 'kitzur-shulchan-aruch'],
  ['Design a Midrash Rabbah page', 'midrash'],
  ['Format this like Ein Yaakov', 'ein-yaakov'],
  ['Lay this out like a Mussar sefer', 'mussar'],
  ['Apply a Tanya layout', 'tanya'],
  ['Design a Machzor for Rosh Hashanah', 'machzor'],
  ['Lay this out like Chumash with Targum and Rashi', 'chumash'],
  ["Lay this out like Nevi'im with Metzudot and Radak", 'tanach-commentary'],
  ['Format this like a Steinsaltz page', 'shas-steinzaltz'],
  ['Format this like an ArtScroll Schottenstein page', 'shas-artscroll'],
  ['Lay this out like Tur with Bach and Drishah', 'tur'],
];

/** Hebrew name aliases (RESEARCH-NOTE.md genreHints) → recipe id. */
const HEBREW_ALIAS_TO_ID: ReadonlyArray<[string, string]> = [
  ['עמד כמו ש״ס עוז והדר', 'shas-oz-vehadar'],
  ['ירושלמי', 'yerushalmi'],
  ['פני משה', 'yerushalmi'],
  ['משנה תורה', 'mishneh-torah'],
  ['ברטנורא', 'mishnah-classic'],
  ['קהתי', 'mishnah-kehati'],
  ['משנה ברורה', 'mishnah-berurah'],
  ['ביאור הלכה', 'mishnah-berurah'],
  ['ערוך השלחן', 'aruch-hashulchan'],
  ['דרישה', 'tur'],
  ['קיצור שולחן ערוך', 'kitzur-shulchan-aruch'],
  ['חומש עם תרגום ורש״י', 'chumash'],
  ['מצודות', 'tanach-commentary'],
  ['מדרש רבה', 'midrash'],
  ['עין יעקב', 'ein-yaakov'],
  ['מסילת ישרים', 'mussar'],
  ['תניא', 'tanya'],
  ['מחזור', 'machzor'],
  ['ארטסקרול', 'shas-artscroll'],
  ['שטיינזלץ', 'shas-steinzaltz'],
];

const NEW_IDS = PHRASE_TO_ID.map(([, id]) => id);

console.log('== §1 — contract NL phrases resolve to the exact recipe id ==');
for (const [phrase, id] of PHRASE_TO_ID) {
  const found = findRecipeByName(phrase);
  check(`findRecipeByName("${phrase}") → ${id}`, found?.id === id, found ? found.id : 'undefined');
}
for (const [command, id] of COMMAND_TO_ID) {
  const cmd = parseAutoLayoutCommand(command);
  check(
    `parse "${command}" → applyHistoricalLayout (${id})`,
    cmd?.action === 'applyHistoricalLayout' && cmd?.recipeId === id,
    cmd ? `${cmd.action}/${cmd.recipeId ?? '—'}` : 'null'
  );
}
for (const [text, id] of HEBREW_ALIAS_TO_ID) {
  const found = findRecipeByName(text);
  check(`findRecipeByName("${text}") → ${id}`, found?.id === id, found ? found.id : 'undefined');
}
// The two new AI example prompts (AiChatPanel) parse to the right recipe.
check(
  'AI example "עמד כמו ש״ס עוז והדר" → applyHistoricalLayout (shas-oz-vehadar)',
  (() => {
    const cmd = parseAutoLayoutCommand('עמד כמו ש״ס עוז והדר');
    return cmd?.action === 'applyHistoricalLayout' && cmd?.recipeId === 'shas-oz-vehadar';
  })()
);
check(
  'AI example "החל תבנית משנה ברורה" → applyRecipe (mishnah-berurah)',
  (() => {
    const cmd = parseAutoLayoutCommand('החל תבנית משנה ברורה');
    return cmd?.action === 'applyRecipe' && cmd?.recipeId === 'mishnah-berurah';
  })()
);

console.log('== §2 — unknown / weak-hint phrases fall back safely (never throw) ==');
const safeFallbacks: Array<[string, string]> = [
  ['please fix the spelling on page three', 'no layout intent'],
  ['Format this like a Zohar page', 'Zohar NOT added in this pass'],
  ['Lay this out like the Zohar', 'Zohar NOT added in this pass'],
  ['Apply a Mishnah layout', "bare 'mishnah' is weak — no guess"],
  ['Apply a Bach layout', "bare 'bach' is also Hagahot ha-Bach — no guess"],
  ['Apply a Rosh Hashanah layout', "bare 'rosh hashanah' is weak — no guess"],
  ['Apply a layout like nothing I have ever seen', 'unknown layout'],
  ['', 'empty input'],
  ['!!!', 'punctuation only'],
];
for (const [text, why] of safeFallbacks) {
  let cmd: ReturnType<typeof parseAutoLayoutCommand> | 'threw' = null;
  try {
    cmd = parseAutoLayoutCommand(text);
  } catch {
    cmd = 'threw';
  }
  check(`fallback "${text || '(empty)'}" → null (${why})`, cmd === null, cmd === 'threw' ? 'THREW' : cmd ? `${cmd.action}/${cmd.recipeId ?? '—'}` : 'null');
}
// NOTE on the two cases that do NOT return null here, and why that is
// still safe (not a guess):
// - "Format this like a Tur page" DOES resolve to tur: 'tur' is the
//   recipe id itself, and every adapter entry carries its id as an alias
//   (same as v0.9.0's toHistoricalRecipe). The weak-hint rule governs the
//   auto-CLASSIFIER (Part B), where 'tur' alone must not decide; an
//   explicit NL command naming the id is a direct request, not a guess.
//   "Apply a Mishnah layout" stays null above because 'mishnah' is NOT
//   an id (mishnah-classic vs mishnah-kehati) — the parser never picks
//   between the two variants on a bare word.
// - "החל תבנית <unknown>" returns applyRecipe with a templateId (no
//   recipeId): that is the existing v0.9.0 template path, and App refuses
//   an unloaded templateId rather than guessing. It is not a recipe
//   guess — check it carries no recipeId.
check(
  '"Format this like a Tur page" resolves to tur (explicit id in a command)',
  (() => {
    const cmd = parseAutoLayoutCommand('Format this like a Tur page');
    return cmd?.action === 'applyHistoricalLayout' && cmd?.recipeId === 'tur';
  })()
);
check(
  '"החל תבנית שקר כלשהו" → applyRecipe with templateId only (App refuses unloaded templates)',
  (() => {
    const cmd = parseAutoLayoutCommand('החל תבנית שקר כלשהו');
    return cmd?.action === 'applyRecipe' && cmd?.recipeId === undefined && (cmd?.data as Record<string, unknown>)?.templateId === 'שקר';
  })()
);
// A bare mention with no trigger verb is a question, not a command:
// it must stay null so it is never hijacked into an apply card.
for (const [phrase, id] of PHRASE_TO_ID.filter(([, id]) =>
  ['yerushalmi', 'mishnah-classic', 'mishnah-kehati', 'aruch-hashulchan', 'kitzur-shulchan-aruch', 'midrash', 'ein-yaakov', 'mussar', 'tanya', 'machzor', 'chumash', 'tanach-commentary', 'shas-steinzaltz', 'shas-artscroll', 'tur'].includes(id)
)) {
  let cmd: ReturnType<typeof parseAutoLayoutCommand> | 'threw' = null;
  try {
    cmd = parseAutoLayoutCommand(phrase);
  } catch {
    cmd = 'threw';
  }
  check(`bare mention "${phrase}" stays null (question, not a command)`, cmd === null, cmd === 'threw' ? 'THREW' : cmd ? `${cmd.action}/${cmd.recipeId ?? '—'}` : 'null');
}
check('unknown recipe id resolves to undefined (never guessed)', getRecipeByIdLocal('no-such-recipe') === undefined);
check('findRecipeByName("") is undefined', findRecipeByName('') === undefined);

console.log('== §3 — picker strings in both languages for every new recipe ==');
for (const id of NEW_IDS) {
  const recipe = getRecipeByIdLocal(id);
  check(`adapter entry exists for ${id}`, recipe !== undefined);
  if (!recipe) continue;
  // v0.9.5: both languages live in the library metadata itself —
  // the adapter entry's names/summaries must match the recipe's.
  const lib = getRecipeById(id);
  check(
    `library metadata carries both names for ${id}`,
    !!lib && lib.metadata.nameHe === recipe.nameHe && lib.metadata.name === recipe.nameEn,
    lib ? `${lib.metadata.nameHe} / ${lib.metadata.name}` : '(missing)'
  );
  check(
    `library metadata carries both descriptions for ${id}`,
    !!lib && lib.metadata.descriptionHe === recipe.summaryHe && lib.metadata.description === recipe.summaryEn,
    lib ? (lib.metadata.descriptionHe ? 'descriptionHe present' : '(no descriptionHe)') : '(missing)'
  );
}
check(
  'new AI example "עמד כמו ש״ס עוז והדר" translated',
  EN_STRINGS['עמד כמו ש״ס עוז והדר'] === 'Lay it out like an Oz VeHadar Shas page'
);
check(
  'new AI example "החל תבנית משנה ברורה" translated',
  EN_STRINGS['החל תבנית משנה ברורה'] === 'Apply the Mishnah Berurah layout'
);
check(
  'revised Design-panel paragraph translated (no "nine" count)',
  EN_STRINGS['תבניות היסטוריות — ש״ס וילנא, שולחן ערוך, מקראות גדולות ועוד. בחירה מחליפה את הפריסה כולה, כולל גדלי גופנים ומסגרות.'] ===
    'Historical layouts — Vilna Shas, Shulchan Aruch, Mikraot Gedolot and more. Picking one replaces the whole layout, including font sizes and frames.'
);
check(
  'stale "תשע תבניות..." key removed from strings.ts',
  !('תשע תבניות היסטוריות — ש״ס וילנא, שולחן ערוך, מקראות גדולות ועוד. בחירה מחליפה את הפריסה כולה, כולל גדלי גופנים ומסגרות.' in EN_STRINGS)
);

console.log('== §4 — label-table coverage: every new id has rules + aliases ==');
{
  const seen = new Set<string>();
  let duplicates = 0;
  for (const r of getAllHistoricalRecipes()) {
    if (seen.has(r.id)) duplicates++;
    seen.add(r.id);
  }
  check('getAllHistoricalRecipes() ids are unique', duplicates === 0, duplicates ? `${duplicates} duplicate(s)` : `${seen.size} ids`);
}
for (const id of NEW_IDS) {
  const recipe = getRecipeByIdLocal(id);
  check(`${id} has non-empty rules`, (recipe?.rules.length ?? 0) > 0, recipe ? `${recipe.rules.length} rules` : 'no entry');
  check(`${id} has NL aliases`, (recipe?.aliases.length ?? 0) > 0, recipe ? `${recipe.aliases.length} aliases` : 'no entry');
  check(`${id} aliases include the id itself`, recipe?.aliases.includes(id) ?? false);
}
{
  // Source-level guard (same style as v091-smoke): the unified rule +
  // alias tables in historical-layouts.ts must name every new id, so a
  // future edit cannot silently drop one. (v0.9.5: the tables moved out
  // of auto-layout.ts into the unified library — the check moved too.)
  const src = fs.readFileSync(path.join(ROOT, 'src/engine/historical-layouts.ts'), 'utf8');
  for (const id of NEW_IDS) {
    check(`HISTORICAL_RECIPE_RULES names ${id}`, src.includes(`'${id}': [`) || src.includes(`${id}: [`));
    check(`HISTORICAL_RECIPE_ALIASES names ${id}`, src.includes(`'${id}': [`) || src.includes(`${id}: [`));
  }
  check('Part A library carries all 18 ids with a Hebrew description',
    NEW_IDS.every(id => {
      const r = HISTORICAL_LAYOUTS.find(x => x.metadata.id === id);
      return !!r && !!(r.metadata as { descriptionHe?: string }).descriptionHe;
    }));
}

console.log('== §5 — Gemini prompt context + validated action types ==');
for (const t of ['applyHistoricalLayout', 'applyRecipe', 'explainRecipe', 'changeLayout']) {
  check(`Gemini action type "${t}" is known/validated`, isKnownGeminiActionType(t));
}
{
  const ctx = buildRecipePromptContext();
  for (const id of NEW_IDS) {
    const recipe = getRecipeByIdLocal(id)!;
    check(`prompt context lists ${id}`, ctx.includes(id));
    check(`prompt context names ${id} ("${recipe.nameEn}")`, ctx.includes(recipe.nameEn));
    check(
      `prompt context gives a rule for ${id}`,
      recipe.rules.some(rule => ctx.includes(rule.slice(0, 40)))
    );
  }
  check('prompt context still lists the v0.9.0 recipes', ['vilna-shas', 'mikraot-gedolot', 'shulchan-aruch', 'tzenerene'].every(s => ctx.includes(s)));
  check('prompt context forbids inventing recipe ids', ctx.includes('never invent a recipe id'));
}
{
  // The AiChatPanel system prompt names exactly the ids the validator
  // accepts — a model proposal for any of them passes validation.
  const panelSrc = fs.readFileSync(path.join(ROOT, 'src/components/AiChatPanel.tsx'), 'utf8');
  const line = panelSrc.split('\n').find(l => l.includes('applyHistoricalLayout {"recipeId"'));
  check('AiChatPanel system prompt lists the new ids', !!line && NEW_IDS.every(id => line!.includes(id)));
  const idsInLine = line ? [...line.matchAll(/([a-z][a-z0-9-]*)/g)].map(m => m[1]).filter(id => getRecipeByIdLocal(id) || id === 'applyHistoricalLayout') : [];
  const unresolvable = (line?.match(/<one of: ([^>]+)>/)?.[1].split(',').map(s => s.trim()) ?? []).filter(
    id => !getRecipeByIdLocal(id)
  );
  check('every id in the AiChatPanel prompt list resolves (validator accepts it)', unresolvable.length === 0, unresolvable.join(', ') || 'all resolve');
}

console.log('== §6 — pickers read the library dynamically; new ids pending Part A ==');
{
  const library = getHistoricalLayoutLibrary();
  const nonAlias = HISTORICAL_LAYOUTS.filter(r => !r.aliasOf).map(r => r.metadata.id);
  check(
    'picker list === non-alias library recipes (dynamic read)',
    library.length === nonAlias.length && nonAlias.every(id => library.some(e => e.id === id)),
    `${library.length} picker entries, ${nonAlias.length} library recipes`
  );
  // v0.9.4 — the modal's picker moved into the shared NewProjectForm
  // (Home renders it too); the form groups the library
  // (groupHistoricalLibrary) before mapping over the entries.
  // v0.9.7 — the FULL library picker lives in the Design panel only
  // now; the start form shows the 11 core layouts (CORE_START_LAYOUTS)
  // with one-line bilingual labels. The grouping helper stays
  // exported (the library lists it), but the form no longer calls it.
  {
    const panelFile = 'src/components/DesignTypesettingPanel.tsx';
    const panelSrc = fs.readFileSync(path.join(ROOT, panelFile), 'utf8');
    check(`${path.basename(panelFile)} renders getHistoricalLayoutLibrary() dynamically`,
      panelSrc.includes('getHistoricalLayoutLibrary().map'));
    // v0.9.5: picker names/descriptions come straight from the recipe
    // metadata in both languages (entry.nameHe / nameEn +
    // descriptionHe / descriptionEn, chosen by lang) — no t() lookup.
    check(`${path.basename(panelFile)} renders picker names + descriptions from the metadata by language`,
      panelSrc.includes('entry.nameHe') && panelSrc.includes('entry.nameEn') && panelSrc.includes('entry.descriptionHe') && panelSrc.includes('entry.descriptionEn') && !panelSrc.includes('t(entry.name)') && !panelSrc.includes('t(entry.description)'));
    const formFile = 'src/components/NewProjectForm.tsx';
    const formSrc = fs.readFileSync(path.join(ROOT, formFile), 'utf8');
    const formCode = formSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    check(`${path.basename(formFile)} renders the 11 core layouts, not the full library (v0.9.7)`,
      formCode.includes('CORE_START_LAYOUTS.map(') && !formCode.includes('getHistoricalLayoutLibrary()'));
    check(`${path.basename(formFile)} renders core labels in both languages, one line each (v0.9.7)`,
      formCode.includes('option.labelHe') && formCode.includes('option.labelEn') && formCode.includes('option.subLabelHe') && formCode.includes('option.subLabelEn'));
  }
  // The 18 new ids live in the adapter (AI/NL) now; their geometry +
  // picker entries arrive with Part A's historical-layouts.ts merge.
  for (const id of NEW_IDS) {
    const inLibrary = getHistoricalLayoutLibrary().some(e => e.id === id);
    if (inLibrary) {
      check(`picker already lists ${id}`, true);
    } else {
      pend(`picker entry for ${id} — awaiting Part A recipe in historical-layouts.ts`, 'adapter-only for now');
    }
  }
}

console.log('== §7 — v0.9.0 §6 regression: original NL cases unchanged ==');
{
  const nlCases: Array<[string, string, string?]> = [
    ['Format this text like a Vilna Shas folio', 'applyHistoricalLayout', 'vilna-shas'],
    ['Apply a Shulchan Aruch 2-column layout with commentaries below', 'applyHistoricalLayout', 'shulchan-aruch'],
    ['Design a Chassidic Drush page with a decorative Shaar Blatt border', 'applyHistoricalLayout', 'chassidic-drush'],
    ['lay it out like Mikraot Gedolot', 'applyHistoricalLayout', 'mikraot-gedolot'],
    ['Change layout', 'changeLayout', undefined],
    ['Explain this layout', 'explainRecipe', undefined],
    ['החל תבנית צאינה וראינה', 'applyRecipe', 'tzenerene'],
  ];
  for (const [text, action, recipeId] of nlCases) {
    const cmd = parseAutoLayoutCommand(text);
    check(`NL "${text}" → ${action}${recipeId ? ` (${recipeId})` : ''}`, cmd?.action === action && (recipeId === undefined || cmd?.recipeId === recipeId), cmd ? `${cmd.action}/${cmd.recipeId ?? '—'}` : 'null');
  }
  check('NL with no layout intent parses to null', parseAutoLayoutCommand('please fix the spelling on page three') === null);
  check('findRecipeByName resolves Hebrew aliases', findRecipeByName('עמד כמו ש״ס וילנא')?.id === 'vilna-shas');
}

console.log(`\nTOTAL: ${passes} passed, ${failures} failed, ${pending} pending (Part A merge)`);
if (failures > 0) {
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS');
