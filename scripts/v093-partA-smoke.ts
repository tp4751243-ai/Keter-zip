/**
 * KETER-TYPE v0.9.3 Part A — Historical Layout Library deepening smoke.
 *
 * Run from the repo root:  npx tsx scripts/v093-partA-smoke.ts
 *
 * Pure-engine checks (no browser, no React) over the scratch tree:
 *  §A  every NEW recipe validates (0 errors); library is 29 entries
 *      (27 real recipes + the vilna-shas + tzenerene aliases — v0.9.5
 *      promotes tzenerene from adapter-only to a library alias); 27
 *      resolved recipes; the aliases still resolve; the siddur recipe
 *      carries the five nusachot as metadata (no duplicate siddur recipes)
 *  §B  every new recipe serializes/deserializes round-trip identical;
 *      the new folioStyle 'yerushalmi-abcd' validates; an unknown
 *      folioStyle is still rejected
 *  §C  every new recipe applies + paginates a multi-role document
 *      through the custom_layout path with 0 collisions and every
 *      unit placed; applied boxes do not overlap in 2D
 *  §D  every new recipe's REGIONS do not overlap in 2D (the same
 *      >0.5% rule the v0.9.0 smoke uses on boxes) and tier widths
 *      per row sum to ≤100%
 *  §E  all 9 v0.9.0 recipes still validate and paginate (0
 *      collisions, every unit placed); the alias still resolves
 *  §F  structural spot-checks per new recipe (the differences the
 *      research note specifies: Oz VeHadar marginalia strip +
 *      variant-readings band + wider outer columns; ArtScroll
 *      229x305mm; Steinsaltz notes band; Yerushalmi two-column
 *      a/b sub-pages + 'yerushalmi-abcd'; Mishneh Torah KM/MM
 *      flanks + Raavad gloss band; Mishnah Berurah six texts with
 *      Sha'ar HaTziyun as the footnote band; Tur Beit Yosef lower
 *      band; Midrash has no footnote band; Machzor has no header
 *      box + a running-header rule)
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  applyRecipeToSettings,
  deserializeRecipe,
  recipeToCustomLayoutBoxes,
  serializeRecipe,
  validateRecipe,
} from '../src/engine/layout-recipes';
import type { LayoutRecipe } from '../src/engine/layout-recipes';
import {
  HISTORICAL_LAYOUTS,
  getHistoricalRecipe,
  listHistoricalRecipes,
  resolveHistoricalRecipe,
} from '../src/engine/historical-layouts';
import type { BookLayoutType, ContentUnit, PageGeometry, PageTypesetResult, TypesetLine } from '../src/types/typesetter';
import type { ProfessionalDesignSettings } from '../src/types/design-settings';

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

const NEW_RECIPE_IDS = [
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

const OLD_RECIPE_IDS = [
  'talmud-bavli',
  'mikraot-gedolot',
  'shulchan-aruch',
  'chumash-rishonim',
  'responsa',
  'chassidic-drush',
  'yiddish-sefer',
  'machon-edition',
  'siddur',
] as const;

const GEMARA = 'אָמַר רַבִּי יְהוּדָה אָמַר רַב: כָּל הָעוֹסֵק בַּתּוֹרָה לִשְׁמָהּ — זוֹכֶה לִדְבָרִים הַרְבֵּה, וְנִקְרָא רֵעַ וְאָהוּב. ';
const RASHI = 'דיבור המתחיל: פירוש קצר על הגמרא, מילה במילה, בלשון ברורה וקצרה. ';
const TOSAFOT = 'תוספות: קושיא ותירוץ, דיון ארוך בין הראשונים, חילוקים וראיות. ';
const TERTIARY = 'עין משפט: סימן א׳ סעיף ב׳. ';
const VERSE = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ. ';
const PRAYER = 'ברוך אתה יי אלהינו מלך העולם, אשר קדשנו במצותיו וצונו על דברי תורה. ';
const NOTE = 'הערה קצרה. ';

function unit(id: string, role: ContentUnit['role'], text: string, order: number, extra?: Partial<ContentUnit>): ContentUnit {
  return { id, role, rawText: text, styleName: 'Normal', order, hierarchyLevel: 2, ...extra };
}

/** A 12-role document: every role the custom-layout flow must place. (Same as v090.) */
function makeGenericUnits(): ContentUnit[] {
  return [
    unit('u-main', 'main_source', GEMARA.repeat(40), 1),
    unit('u-heading', 'heading', 'פרק ראשון', 2, { hierarchyLevel: 1 }),
    unit('u-siman', 'siman', 'סימן א׳', 3, { hierarchyLevel: 1 }),
    unit('u-verse', 'verse', VERSE.repeat(20), 4),
    unit('u-para', 'regular_paragraph', PRAYER.repeat(20), 5),
    unit('u-rashi', 'primary_comment', RASHI.repeat(30), 6, { hierarchyLevel: 3, linkedSourceId: 'u-main' }),
    unit('u-tos', 'secondary_comment', TOSAFOT.repeat(30), 7, { hierarchyLevel: 3, linkedSourceId: 'u-main' }),
    unit('u-ter', 'tertiary_comment', TERTIARY.repeat(20), 8, { hierarchyLevel: 3 }),
    unit('u-dibbur', 'dibbur_hamatchil', 'ד״ה כל העוסק: פירוש הדיבור. '.repeat(10), 9, { hierarchyLevel: 3 }),
    unit('u-list', 'list_item', 'פרט ראשון ברשימה; פרט שני ברשימה; פרט שלישי ברשימה. '.repeat(8), 10),
    unit('u-table', 'table', 'שורה בטבלה: עמודה ראשונה, עמודה שניה, עמודה שלישית. '.repeat(8), 11),
    unit('u-foot', 'footnote', 'הערת שוליים קצרה על העמוד. '.repeat(10), 12),
    unit('u-side', 'side_note', NOTE.repeat(10), 13),
    unit('u-xref', 'cross_reference', 'ראה עוד שם. '.repeat(8), 14),
  ];
}

function allLines(pg: PageTypesetResult): TypesetLine[] {
  return [
    ...pg.sourceLines,
    ...pg.rashiLines,
    ...pg.tosafotLines,
    ...(pg.footnoteLines ?? []),
    ...(pg.column2Lines ?? []),
    ...(pg.sideNoteLines ?? []),
    ...(pg.tertiaryLines ?? []),
  ];
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

function collisionCount(doc: { pages: PageTypesetResult[] }): number {
  return doc.pages.reduce((acc, pg) => acc + (pg.layoutScore?.collisionCount ?? 0), 0);
}

function geometryFromSettings(s: ProfessionalDesignSettings): PageGeometry {
  const pl = s.pageLayout;
  return {
    pageWidth: pl.pageWidthPt,
    pageHeight: pl.pageHeightPt,
    marginTop: pl.marginTopPt,
    marginBottom: pl.marginBottomPt,
    marginInside: pl.marginInsidePt,
    marginOutside: pl.marginOutsidePt,
    isVerso: false,
  };
}

function paginateWithRecipe(recipe: LayoutRecipe, units: ContentUnit[]) {
  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
  const settings = applyRecipeToSettings(recipe, base);
  const doc = PaginationEngine.paginateDocument({
    title: `v093-partA ${recipe.metadata.id}`,
    layoutType: 'custom_layout' as BookLayoutType,
    units,
    geometry: geometryFromSettings(settings),
    designSettings: settings,
  });
  return { settings, doc };
}

/** 2D overlap test on (x, y, w, h) rects: true when no pair overlaps by >0.5 in both axes. */
function noOverlap(rects: Array<{ x: number; y: number; w: number; h: number }>): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.5 && oy > 0.5) return false;
    }
  }
  return true;
}

function rectOf(region: LayoutRecipe['regions'][number]): { x: number; y: number; w: number; h: number } | null {
  if (region.shape.kind !== 'rect') return null;
  return { x: region.shape.x, y: region.shape.y, w: region.shape.w, h: region.shape.h };
}

// ── §A — library counts + new recipes validate ─────────────────────────────

console.log('§A  library counts + new-recipe validation');
for (const id of NEW_RECIPE_IDS) {
  const r = resolveHistoricalRecipe(id);
  check(`new recipe '${id}' exists`, !!r);
  if (!r) continue;
  const errors = validateRecipe(r);
  check(`new recipe '${id}' validates (0 errors)`, errors.length === 0, errors.join('; '));
  check(`new recipe '${id}' is not an alias`, r.aliasOf === undefined);
}
check('library has 29 entries (27 recipes + vilna-shas + tzenerene aliases)', HISTORICAL_LAYOUTS.length === 29, `${HISTORICAL_LAYOUTS.length}`);
check('27 resolved recipes', listHistoricalRecipes().length === 27, `${listHistoricalRecipes().length}`);
check(
  "vilna-shas still resolves to talmud-bavli",
  resolveHistoricalRecipe('vilna-shas')?.metadata.id === 'talmud-bavli',
);
check(
  "getHistoricalRecipe('vilna-shas') is still the alias entry",
  getHistoricalRecipe('vilna-shas')?.aliasOf === 'talmud-bavli',
);
{
  const siddur = resolveHistoricalRecipe('siddur')!;
  const nusach = siddur.metadata.nusach ?? [];
  check(
    'siddur carries the five nusachot as metadata',
    ['Ashkenaz', 'Sefard', 'Edot HaMizrach', 'Ari', 'Teman'].every(n => nusach.includes(n)) && nusach.length === 5,
    nusach.join(', '),
  );
  const siddurIds = HISTORICAL_LAYOUTS.filter(r => r.metadata.id === 'siddur' || r.metadata.id.startsWith('siddur-'));
  check('no duplicate siddur recipes', siddurIds.length === 1, siddurIds.map(r => r.metadata.id).join(', '));
  check('old siddur recipe still validates', validateRecipe(siddur).length === 0);
}

// ── §B — serialisation round-trip + folioStyle ──────────────────────────────

console.log('§B  serialisation + folioStyle');
for (const id of NEW_RECIPE_IDS) {
  const r = resolveHistoricalRecipe(id)!;
  const back = deserializeRecipe(serializeRecipe(r));
  check(`'${id}' round-trips identical`, JSON.stringify(back) === JSON.stringify(r));
}
{
  const y = resolveHistoricalRecipe('yerushalmi')!;
  check("yerushalmi folioStyle is 'yerushalmi-abcd'", y.headerFooter?.folioStyle === 'yerushalmi-abcd');
  const bad = JSON.parse(JSON.stringify(y)) as LayoutRecipe;
  (bad.headerFooter as { folioStyle?: string }).folioStyle = 'daf-amud-x';
  check(
    'validate still rejects an unknown folioStyle',
    validateRecipe(bad).some(e => e.includes('folioStyle')),
  );
}

// ── §C — every new recipe applies + paginates, 0 collisions, all placed ────

console.log('§C  apply + paginate every new recipe');
for (const id of NEW_RECIPE_IDS) {
  const recipe = resolveHistoricalRecipe(id)!;
  const units = makeGenericUnits();
  let settings: ProfessionalDesignSettings | undefined;
  let doc: ReturnType<typeof PaginationEngine.paginateDocument> | undefined;
  let applyError = '';
  try {
    ({ settings, doc } = paginateWithRecipe(recipe, units));
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }
  check(`'${id}' applies + paginates`, !!doc, applyError);
  if (!doc || !settings) continue;
  const placed = placedUnitIds(doc);
  const missing = units.map(u => u.id).filter(mid => !placed.has(mid));
  check(`'${id}' places every unit`, missing.length === 0, missing.join(','));
  check(`'${id}' has 0 collisions`, collisionCount(doc) === 0, `${collisionCount(doc)}`);
  check(
    `'${id}' reports no unplaceable text`,
    !(doc.autoFixesApplied ?? []).some(m => m.includes('לא ניתן היה להציב')),
    (doc.autoFixesApplied ?? []).join(' | '),
  );
  check(`'${id}' yields ≥1 page`, doc.pages.length >= 1, `${doc.pages.length} pages`);
  const boxes = settings.pageLayout.customLayout?.boxes ?? [];
  check(
    `'${id}' applied boxes do not overlap`,
    noOverlap(boxes.map(b => ({ x: b.xPct, y: b.yPct, w: b.widthPct, h: b.heightPct }))),
  );
}

// ── §D — region geometry: no 2D overlap, row widths ≤100% ──────────────────

console.log('§D  region geometry (no overlap, row widths ≤100%)');
for (const id of NEW_RECIPE_IDS) {
  const recipe = resolveHistoricalRecipe(id)!;
  const rects = recipe.regions.map(rectOf).filter((r): r is NonNullable<typeof r> => r !== null);
  check(`'${id}' regions do not overlap in 2D`, noOverlap(rects));
  // Row widths: for each distinct y-band, the regions whose vertical
  // span overlaps the band must sum to ≤100% (with a 1% tolerance
  // for rounding). Bands are taken from the region top edges.
  let rowsOk = true;
  let worst = '';
  for (const band of rects) {
    const inRow = rects.filter(r => r.y < band.y + band.h && band.y < r.y + r.h);
    // Sum widths only of regions on the same horizontal line: group by
    // overlapping y-span is approximated by the band's own row — use
    // the max total of non-overlapping-x regions at this y.
    const sorted = [...inRow].sort((a, b) => a.x - b.x);
    let total = 0;
    let cursor = -Infinity;
    for (const r of sorted) {
      if (r.x >= cursor - 0.01) {
        total += r.w;
        cursor = r.x + r.w;
      }
    }
    if (total > 101) {
      rowsOk = false;
      worst = `y=${band.y}: ${total.toFixed(1)}%`;
      break;
    }
  }
  check(`'${id}' tier widths per row sum ≤100%`, rowsOk, worst);
}

// ── §E — old recipes still validate and paginate ────────────────────────────

console.log('§E  v0.9.0 recipes unchanged (validate + paginate)');
for (const id of OLD_RECIPE_IDS) {
  const recipe = resolveHistoricalRecipe(id)!;
  const errors = validateRecipe(recipe);
  check(`old recipe '${id}' still validates`, errors.length === 0, errors.join('; '));
  let doc: ReturnType<typeof PaginationEngine.paginateDocument> | undefined;
  let err = '';
  try {
    ({ doc } = paginateWithRecipe(recipe, makeGenericUnits()));
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check(`old recipe '${id}' still paginates`, !!doc, err);
  if (!doc) continue;
  const placed = placedUnitIds(doc);
  const missing = makeGenericUnits().map(u => u.id).filter(mid => !placed.has(mid));
  check(`old recipe '${id}' still places every unit`, missing.length === 0, missing.join(','));
  check(`old recipe '${id}' still has 0 collisions`, collisionCount(doc) === 0, `${collisionCount(doc)}`);
}

// ── §F — structural spot-checks ─────────────────────────────────────────────

console.log('§F  structural spot-checks');
{
  const oz = resolveHistoricalRecipe('shas-oz-vehadar')!;
  const boxes = recipeToCustomLayoutBoxes(oz);
  const marginalia = boxes.find(b => b.id === 'recipe-oz-marginalia');
  const variants = boxes.find(b => b.id === 'recipe-variant-readings');
  const rashi = boxes.find(b => b.labelHe === 'רש״י');
  check('oz-vehadar: marginalia / cross-reference strip present', !!marginalia);
  check('oz-vehadar: variant-readings footnote band present', !!variants && variants.role === 'footnote');
  check('oz-vehadar: outer columns wider than Vilna (26% vs 24%)', !!rashi && Math.abs(rashi.widthPct - 26) < 0.01, rashi ? `${rashi.widthPct}%` : 'no rashi box');
  check('oz-vehadar: lower band holds Ein Mishpat / Masoret / Torah Or',
    ['עין משפט נר מצווה', 'מסורת הש״ס', 'תורה אור'].every(h => boxes.some(b => b.labelHe === h)));
}
{
  const art = resolveHistoricalRecipe('shas-artscroll')!;
  check('artscroll: larger page 229x305mm (9"x12")', art.page.widthMm === 229 && art.page.heightMm === 305, `${art.page.widthMm}x${art.page.heightMm}mm`);
  check('artscroll: daf-amud folio style', art.headerFooter?.folioStyle === 'daf-amud');
  check('artscroll: facing-page limit recorded in description', art.metadata.description.includes('facing English'));
}
{
  const st = resolveHistoricalRecipe('shas-steinzaltz')!;
  const boxes = recipeToCustomLayoutBoxes(st);
  check('steinzaltz: explanatory-notes column present', boxes.some(b => b.labelHe === 'הערות הסבר'));
  check('steinzaltz: notes band at the foot present', !!boxes.find(b => b.id === 'recipe-steinzaltz-notes-band'));
}
{
  const y = resolveHistoricalRecipe('yerushalmi')!;
  const boxes = recipeToCustomLayoutBoxes(y);
  const mains = boxes.filter(b => b.role === 'main_text');
  const pmoshe = boxes.filter(b => b.labelHe === 'פני משה');
  check('yerushalmi: two text columns per side (a right, b left)',
    mains.length === 2 &&
      mains.some(b => Math.abs(b.xPct - 52) < 0.01) &&
      mains.some(b => Math.abs(b.xPct - 0) < 0.01),
    mains.map(b => `x${b.xPct}`).join(', '));
  check('yerushalmi: Pnei Moshe surrounds both columns', pmoshe.length === 2);
  check('yerushalmi: Korban HaEdah + Ridvaz tiers present',
    boxes.some(b => b.labelHe === 'קרבן העדה') && boxes.some(b => b.labelHe === 'רי״דב״ז'));
  check("yerushalmi: folioStyle 'yerushalmi-abcd' (not reused 'daf-amud')",
    y.headerFooter?.folioStyle === 'yerushalmi-abcd');
}
{
  const mt = resolveHistoricalRecipe('mishneh-torah')!;
  const boxes = recipeToCustomLayoutBoxes(mt);
  check('mishneh-torah: Kesef Mishneh (right) + Maggid Mishneh (left) flank the Rambam',
    boxes.some(b => b.labelHe === 'כסף משנה' && b.xPct > 50) &&
      boxes.some(b => b.labelHe === 'מגיד משנה' && b.xPct < 50));
  check('mishneh-torah: Lechem Mishneh + Hagahot Maimuniyot in the lower flanks',
    boxes.some(b => b.labelHe === 'לחם משנה') && boxes.some(b => b.labelHe === 'הגהות מיימוניות'));
  check('mishneh-torah: Raavad gloss band under the Rambam column', !!boxes.find(b => b.id === 'recipe-raavad-glosses'));
  check('mishneh-torah: no dibbur rule (Rambam has none)', mt.typography?.dibbur === undefined);
}
{
  const mb = resolveHistoricalRecipe('mishnah-berurah')!;
  const boxes = recipeToCustomLayoutBoxes(mb);
  const sa = boxes.find(b => b.labelHe === 'שולחן ערוך עם הגהת הרמ״א');
  const mbBox = boxes.find(b => b.labelHe === 'משנה ברורה');
  const shatz = boxes.find(b => b.id === 'recipe-shaar-hatziyun');
  check('mishnah-berurah: SA + Rema text at the TOP of the page', !!sa && Math.abs(sa.yPct - 5) < 0.01);
  check('mishnah-berurah: Mishnah Berurah UNDERNEATH the SA text',
    !!sa && !!mbBox && mbBox.yPct > sa.yPct + sa.heightPct - 1);
  check('mishnah-berurah: six texts present',
    ['שולחן ערוך עם הגהת הרמ״א', 'משנה ברורה', 'ביאור הלכה', 'באר היטב', 'שערי תשובה', 'שער הציון']
      .every(h => boxes.some(b => b.labelHe === h)));
  check('mishnah-berurah: Sha\u2019ar HaTziyun IS the footnote band', !!shatz && shatz.role === 'footnote');
}
{
  const mc = resolveHistoricalRecipe('mishnah-classic')!;
  const boxes = recipeToCustomLayoutBoxes(mc);
  const mishnah = boxes.find(b => b.labelHe === 'משנה');
  const bart = boxes.find(b => b.labelHe === 'ברטנורא');
  check('mishnah-classic: Mishnah in larger type, centred at the top',
    !!mishnah && (mishnah.fontSizePt ?? 0) >= 15 && Math.abs(mishnah.xPct - 10) < 0.01);
  check('mishnah-classic: Bartenura directly below the Mishnah',
    !!mishnah && !!bart && bart.yPct >= mishnah.yPct + mishnah.heightPct - 0.01);
}
{
  const mk = resolveHistoricalRecipe('mishnah-kehati')!;
  check('mishnah-kehati: single column, generous leading (1.5)',
    mk.regions.some(r => r.role === 'main_text' && r.lineHeight === 1.5) &&
      mk.regions.some(r => r.role === 'commentary_1' && r.lineHeight === 1.5));
  check('mishnah-kehati: first-line indents', mk.typography?.indentation?.mode === 'first-line');
  check('mishnah-kehati: modern numbers folios', mk.headerFooter?.folioStyle === 'numbers');
}
{
  const tur = resolveHistoricalRecipe('tur')!;
  const boxes = recipeToCustomLayoutBoxes(tur);
  const by = boxes.find(b => b.labelHe === 'בית יוסף');
  check('tur: Beit Yosef as the lower band (full width, y75)',
    !!by && Math.abs(by.widthPct - 100) < 0.01 && Math.abs(by.yPct - 75) < 0.01);
  check('tur: Bach full-height right flank, Drishah + Prishah stacked left',
    boxes.some(b => b.labelHe === 'בית חדש — ב״ח' && Math.abs(b.heightPct - 68) < 0.01) &&
      boxes.some(b => b.labelHe === 'דרישה') && boxes.some(b => b.labelHe === 'פרישה'));
}
{
  const ch = resolveHistoricalRecipe('chumash')!;
  const boxes = recipeToCustomLayoutBoxes(ch);
  const verse = boxes.find(b => b.labelHe === 'פסוק');
  const targum = boxes.find(b => b.labelHe === 'תרגום אונקלוס');
  const rashi = boxes.find(b => b.labelHe === 'רש״י');
  check('chumash: verse large across the top, Targum below, Rashi beneath',
    !!verse && !!targum && !!rashi &&
      verse.yPct < targum.yPct && targum.yPct < rashi.yPct &&
      Math.abs(verse.widthPct - 100) < 0.01);
}
{
  const tc = resolveHistoricalRecipe('tanach-commentary')!;
  const boxes = recipeToCustomLayoutBoxes(tc);
  check('tanach-commentary: Metzudot right + Radak left in two columns',
    boxes.some(b => (b.labelHe ?? '').includes('מצודת') && b.xPct > 50) &&
      boxes.some(b => b.labelHe === 'רד״ק' && b.xPct < 50));
  check('tanach-commentary: Malbim band along the foot',
    boxes.some(b => b.labelHe === 'מלבי״ם' && Math.abs(b.widthPct - 100) < 0.01 && b.yPct > 60));
}
{
  const mid = resolveHistoricalRecipe('midrash')!;
  check('midrash: NO footnote band (recorded)', !mid.regions.some(r => r.role === 'footnote'));
  check('midrash: verse lemma box above the exposition box',
    mid.regions.some(r => r.id === 'midrash-lemma') && mid.regions.some(r => r.id === 'midrash-exposition'));
  check('midrash: no dibbur rule (lemma bold, not dibbur)', mid.typography?.dibbur === undefined);
}
{
  const ey = resolveHistoricalRecipe('ein-yaakov')!;
  const boxes = recipeToCustomLayoutBoxes(ey);
  const sel = boxes.find(b => b.labelHe === 'אגדה');
  const com = boxes.find(b => b.labelHe === 'פירוש');
  check('ein-yaakov: commentary below the aggadic selection',
    !!sel && !!com && com.yPct > sel.yPct + sel.heightPct - 0.01);
}
{
  const mz = resolveHistoricalRecipe('machzor')!;
  const boxes = recipeToCustomLayoutBoxes(mz);
  check('machzor: no header box (running header is a rule)', !boxes.some(b => b.role === 'header'));
  const settings = applyRecipeToSettings(mz, DesignSettingsEngine.createDefaultSettings({}));
  check('machzor: running header names the service', settings.pageElements.runningHeader.centerText === 'ראש השנה');
  check('machzor: larger page than the weekday siddur (170x240 vs 148x210)',
    mz.page.widthMm === 170 && mz.page.heightMm === 240);
  check('machzor: acrostic limit recorded in description', mz.metadata.description.includes('acrostic'));
}

// ── summary ─────────────────────────────────────────────────────────────────

console.log(`\nv093-partA-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
