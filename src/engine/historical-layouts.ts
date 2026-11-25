/**
 * v0.9.0 Part A — Historical Layout Library.
 *
 * Twenty-seven curated layout recipes as real data in the
 * `.keter-template.json` schema (`layout-recipes.ts`), plus the Vilna
 * Shas alias (28 entries). Every recipe applies through
 * `applyRecipeToSettings` and paginates through the existing
 * `custom_layout` path — a recipe that does not render fails the
 * smoke test (`scripts/v090-partA-smoke.ts` for the v0.9.0 nine,
 * `scripts/v093-partA-smoke.ts` for the v0.9.3 eighteen); there is
 * no recipe in this library that exists only on paper.
 *
 * v0.9.3 Part A — eighteen more recipes, deepened from public
 * reference reading (see `RESEARCH-NOTE.md` at the repo root; the
 * contract — ids, genre hints, structural differences and honest
 * limits — lives there). The v0.9.0 nine recipes and the vilna-shas
 * alias are unchanged. New: Oz VeHadar / ArtScroll / Steinsaltz
 * Shas variants, Yerushalmi (new folioStyle 'yerushalmi-abcd'),
 * Mishnah classic + Kehati, Mishneh Torah, Mishnah Berurah, Aruch
 * HaShulchan, Tur, Kitzur Shulchan Aruch, Chumash, Tanach with
 * commentaries, Midrash, Ein Yaakov, Mussar, Tanya, Machzor — and
 * the nusach option set on the existing 'siddur' recipe (one recipe,
 * five nusachot: the difference is content order and kavanot, not
 * geometry, so no duplicate siddur recipes).
 *
 * Honest limits carried over from the research note: the ArtScroll
 * facing English elucidation page is a spread property the per-page
 * engine does not model (the recipes describe the Hebrew page only);
 * vowelization (nikud) is a text property, not layout geometry;
 * acrostic layout of piyyutim (Machzor) is not modelled — piyyutim
 * get the indented-verse treatment the engine supports; Raavad
 * glosses are printed interspersed in the Rambam text and the box
 * flow cannot intersperse a second stream inside the central column,
 * so the recipe records them as a gloss band directly under the
 * Rambam column and says so; the Yerushalmi a/b/c/d folio suffixes
 * have no engine renderer yet and fall back to plain-number folios
 * on apply (see `layout-recipes.ts`).
 *
 * Reference sources (STRUCTURAL reference only — nothing in them was
 * copied, traced, embedded or OCR'd into the app; no text extracted,
 * no image bundled; the geometry below is encoded by hand from looking
 * at the page structure):
 * - `~/workspace/user/files/10451_2_ooui.png` — Siddur spread, pp.
 *   276–277, Mincha l'Shabbat (single column, centred running header,
 *   folio numbers at the outer top corners, marginal notes).
 * - `~/workspace/user/files/10450_3_ketm.png` — "The Vilna Daf — A
 *   Standard Page of Talmud", annotated anatomy diagram (daf number,
 *   tractate/chapter header, Mishna, Gemara, Rashi inner, Tosafot
 *   outer, Ein Mishpat Ner Mitzvah, Masoret ha-Shas, Torah Or,
 *   Gilyon ha-Shas, Hagahot ha-Bach, outer-margin commentaries).
 * - `~/workspace/user/files/10449_4_1kf1.png` — Shulchan Aruch, Orach
 *   Chaim, Hilchot Shabbat (central siman/se'if text surrounded by
 *   commentary columns, each with its own running header).
 * - `~/workspace/user/files/talmud-2_5_qm04.pdf` — "The Talmud — First
 *   page of the Talmud (Gemara), Tractate Brachot" (Oz VeHadar /
 *   ArtScroll; legend: middle = Talmud text, right = Rashi, left =
 *   Tosfot, outside edges = additional commentaries). Shows Berakhot
 *   2a: header band with the folio number (ב.) at the outer corner
 *   and "מאימתי פרק ראשון ברכות" centred, the opening word מאימתי
 *   in a large decorated box at the top of the central column, the
 *   central Gemara column with the stepped knee, Rashi on the right
 *   (inner side on this 2a page), Tosafot on the left (outer side),
 *   additional commentaries in narrow columns on the far outer edges,
 *   small marginal notes at the outer margins.
 *
 * The Vilna / Talmud choice (recorded, as the task asked):
 * `talmud-bavli` is the base recipe and `vilna-shas` is an alias
 * pointing at it. The Vilna edition IS the standard Talmud Bavli
 * folio layout; its geometry equals the base except for the edition
 * label and the daf/amud folio numbering, so a second copy of the
 * same twelve regions would be a maintenance trap, not a second
 * layout. `resolveHistoricalRecipe('vilna-shas')` returns the full
 * anatomy; `getHistoricalRecipe('vilna-shas')` returns the alias
 * entry itself.
 *
 * Flank rule (corrected in v0.8.0, confirmed by all four references):
 * on a 2a / recto page Rashi is on the RIGHT (inner/binding side)
 * and Tosafot on the LEFT (outer side); on 2b they mirror. Recipes
 * store the recto geometry; `recipeToCustomLayoutBoxes` mirrors the
 * whole page for verso.
 *
 * Honest limits of these recipes (same as the engine doc):
 * - The stepped knee of the Gemara column is approximated by the
 *   Gemara box ending above the full-width lower band; the true
 *   dynamic-knee contour lives in the `rav_text` solver, not in the
 *   box flow.
 * - Named commentary columns (Magen Avraham, Biur HaGra, …) are
 *   positional slots: the box flow is role-based, so commentaries
 *   fill the columns in book order. The `namedCommentary` on each
 *   region records which commentary the column is for.
 * - The boxed opening headword (מאימתי) is the `mishna` region: a
 *   centred box at the top of the central column. The decoration
 *   (ornamental frame) is not modelled — the box's geometry is.
 */

import type { LayoutRecipe, LayoutRecipeRegion } from './layout-recipes';
import { KETER_TEMPLATE_VERSION, validateRecipe } from './layout-recipes';
import {
  VILNA_SHAS_PRESET,
  type VilnaShasPresetData,
} from './vilna-preset';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rect(
  id: LayoutRecipeRegion['role'],
  x: number,
  y: number,
  w: number,
  h: number,
  extra?: Partial<LayoutRecipeRegion>,
): LayoutRecipeRegion {
  return {
    id: `${id}-${x}-${y}`,
    role: id,
    shape: { kind: 'rect', x, y, w, h },
    units: '%',
    origin: 'content-box',
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// talmud-bavli — the Vilna folio (base recipe; vilna-shas aliases it)
// ─────────────────────────────────────────────────────────────────────────────

export const TALMUD_BAVLI_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'talmud-bavli',
    name: 'Talmud Bavli — Vilna folio',
    nameHe: 'ש״ס וילנא — דף',
    description:
      'The standard Vilna Shas folio: Mishna in a boxed headword at the top of the central column, Gemara in large type down the middle with the stepped knee, Rashi on the inner (binding) side, Tosafot on the outer side, Ein Mishpat Ner Mitzvah, Masoret ha-Shas and Torah Or in the band below the knee, further commentaries (Rabbeinu Chananel, Rabbeinu Nissim) in the outer margin, and Gilyon ha-Shas / Hagahot ha-Bach as marginal notes. Recto (2a) geometry: Rashi right, Tosafot left; mirrored on verso (2b).',
    descriptionHe: 'דף ש״ס וילנא הקלאסי: משנה בכותרת ממוסגרת בראש הטור המרכזי, גמרא באות גדולה במרכז עם הברך המדורגת, רש״י בצד הפנימי ותוספות בצד החיצוני, עין משפט נר מצווה, מסורת הש״ס ותורה אור ברצועה מתחת לברך, מפרשים נוספים (רבנו חננאל, ר״ן) בשוליים החיצוניים, וגליון הש״ס והגהות הב״ח כהערות שוליים. בדף א׳ (2א): רש״י מימין ותוספות משמאל; בדף ב׳ (2ב) הפוך.',
    genre: ['talmud', 'shas', 'gemara', 'commentary'],
    origin: 'Vilna Edition (Romm), 1880–1886 — the standard printed Shas folio',
    sourceRef:
      '10450_3_ketm.png ("The Vilna Daf" anatomy diagram); talmud-2_5_qm04.pdf (Berakhot 2a, Oz VeHadar / ArtScroll)',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת הדף — מסכת, פרק, מספר דף',
      labelEn: 'Folio header — tractate, chapter, daf number',
    }),
    // Boxed opening headword (e.g. מאימתי on Berakhot 2a): centred box
    // at the top of the central column, above the Gemara.
    rect('main_text', 30, 6, 40, 7, {
      labelHe: 'משנה — כותרת פתיחה ממוסגרת',
      labelEn: 'Mishna — boxed opening headword',
    }),
    rect('main_text', 26, 14, 48, 60, {
      id: 'gemara',
      labelHe: 'גמרא',
      labelEn: 'Gemara',
      fontSizePt: 14.5,
      lineHeight: 1.32,
    }),
    rect('rashi', 76, 6, 24, 47, {
      side: 'inside',
      labelHe: 'רש״י',
      labelEn: 'Rashi',
      namedCommentary: 'Rashi (France, 1040–1105)',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('tosafot', 0, 6, 24, 47, {
      side: 'outside',
      labelHe: 'תוספות',
      labelEn: 'Tosafot',
      namedCommentary: 'Tosafot (France, 12th century)',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('commentary_1', 0, 75, 33, 13, {
      labelHe: 'עין משפט נר מצווה',
      labelEn: 'Ein Mishpat Ner Mitzvah',
      namedCommentary: 'Ein Mishpat Ner Mitzvah — halachic cross-references (e.g. Mishneh Torah)',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_2', 34, 75, 33, 13, {
      labelHe: 'מסורת הש״ס',
      labelEn: 'Masoret ha-Shas',
      namedCommentary: 'Masoret ha-Shas — cross-references elsewhere in the Gemara + textual variants',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_3', 67, 75, 33, 13, {
      labelHe: 'תורה אור',
      labelEn: 'Torah Or',
      namedCommentary: 'Torah Or — the full Tanach verses cited in the Gemara',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    // Additional commentaries in the outer margin, tractate-dependent
    // (here: Rabbeinu Chananel, Rabbeinu Nissim, and others).
    rect('commentary_4', 0, 54, 24, 18, {
      side: 'outside',
      labelHe: 'מפרשים נוספים — רבנו חננאל, ר״ן',
      labelEn: 'Further commentaries — Rabbeinu Chananel, Ran',
      namedCommentary: 'Rabbeinu Chananel / Rabbeinu Nissim (tractate-dependent)',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('marginal', 76, 54, 24, 9, {
      id: 'gilyon-hashas',
      side: 'inside',
      labelHe: 'גליון הש״ס',
      labelEn: 'Gilyon ha-Shas',
      namedCommentary: 'Gilyon ha-Shas — marginal notes by R. Akiva Eiger',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('marginal', 76, 64, 24, 8, {
      id: 'hagahot-habach',
      side: 'inside',
      labelHe: 'הגהות הב״ח',
      labelEn: 'Hagahot ha-Bach',
      namedCommentary: 'Hagahot ha-Bach — marginal notes by the Bach (R. Yoel Sirkis)',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'rashi', anchor: 'dibbur', overflow: 'knee' },
    { parentTier: 'main_text', childTier: 'tosafot', anchor: 'dibbur', overflow: 'outer-margin' },
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'rashi', childTier: 'marginal', anchor: 'none', overflow: 'outer-margin' },
  ],
  typography: {
    dibbur: { weight: 700, brackets: 'square', separator: 'ד״ה' },
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 14.5,
    commentaryFontSizePt: 10.5,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'daf-amud',
    folioPosition: 'outer-top',
    showDafPrefix: true,
  },
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 10,
  },
  baseLayout: 'rav_text',
};

/** Vilna Shas — an alias of `talmud-bavli` (see the module doc). */
export const VILNA_SHAS_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'vilna-shas',
    name: 'Vilna Shas',
    nameHe: 'ש״ס וילנא',
    description:
      'The Vilna Edition Shas folio — same layout as Talmud Bavli (talmud-bavli): Gemara in the middle, Rashi inner, Tosafot outer, the lower band of Ein Mishpat / Masoret ha-Shas / Torah Or, and the marginal notes. Kept as an alias so the two names never drift apart.',
    descriptionHe: 'דף ש״ס וילנא — אותו עימוד כמו תלמוד בבלי (talmud-bavli): גמרא במרכז, רש״י בצד הפנימי, תוספות בצד החיצוני, הרצועה התחתונה של עין משפט / מסורת הש״ס / תורה אור, וההערות בשוליים. נשמר ככינוי כדי שהשניים לא יתרחקו זה מזה.',
    genre: ['talmud', 'shas', 'gemara', 'commentary'],
    origin: 'Vilna Edition (Romm), 1880–1886',
    sourceRef:
      '10450_3_ketm.png ("The Vilna Daf" anatomy diagram); talmud-2_5_qm04.pdf (Berakhot 2a, Oz VeHadar / ArtScroll)',
  },
  aliasOf: 'talmud-bavli',
  regions: [],
  flow: [],
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 10,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// mikraot-gedolot — up to 6 surrounding commentaries
// ─────────────────────────────────────────────────────────────────────────────

export const MIKRAOT_GEDOLOT_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'mikraot-gedolot',
    name: 'Mikraot Gedolot',
    nameHe: 'מקראות גדולות',
    description:
      'Chumash with the verse in large type across the top, Targum Onkelos below it, and the commentaries (Rashi, Ramban, Ibn Ezra, Sforno, …) in columns underneath — up to six surrounding tiers.',
    descriptionHe: 'חומש עם הפסוק באות גדולה בראש העמוד, תרגום אונקלוס מתחתיו, והמפרשים (רש״י, רמב״ן, אבן עזרא, ספורנו ועוד) בטורים מתחת — עד שש שכבות מפרשים מסביב לפסוק.',
    genre: ['tanach', 'chumash', 'mikraot', 'commentary'],
    origin: 'Traditional Mikraot Gedolot folio (Venice / Vilna editions)',
  },
  regions: [
    rect('header', 0, 0, 100, 5, { labelHe: 'כותרת — ספר ופרשה', labelEn: 'Header — book and parsha' }),
    rect('main_text', 0, 6, 100, 20, { labelHe: 'פסוק', labelEn: 'Verse', fontSizePt: 16, lineHeight: 1.35 }),
    rect('commentary_1', 0, 27, 100, 9, {
      labelHe: 'תרגום אונקלוס',
      labelEn: 'Targum Onkelos',
      namedCommentary: 'Targum Onkelos',
      fontSizePt: 11,
      lineHeight: 1.32,
    }),
    rect('commentary_2', 0, 37, 48, 33, {
      labelHe: 'רש״י', labelEn: 'Rashi', namedCommentary: 'Rashi', fontSizePt: 10.5, lineHeight: 1.32,
    }),
    rect('commentary_3', 52, 37, 48, 33, {
      labelHe: 'רמב״ן', labelEn: 'Ramban', namedCommentary: 'Ramban', fontSizePt: 10, lineHeight: 1.3,
    }),
    rect('commentary_4', 0, 71, 48, 17, {
      labelHe: 'אבן עזרא', labelEn: 'Ibn Ezra', namedCommentary: 'Ibn Ezra', fontSizePt: 10, lineHeight: 1.3,
    }),
    rect('commentary_5', 52, 71, 48, 17, {
      labelHe: 'ספורנו', labelEn: 'Sforno', namedCommentary: 'Sforno', fontSizePt: 10, lineHeight: 1.3,
    }),
    rect('footnote', 0, 89, 100, 8, { labelHe: 'הערות', labelEn: 'Notes', fontSizePt: 9 }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'lineIndex', overflow: 'next-folio' },
    { parentTier: 'commentary_1', childTier: 'commentary_2', anchor: 'none', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'none' },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 16,
    commentaryFontSizePt: 10.5,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 14,
    marginBottomMm: 14,
    marginInsideMm: 14,
    marginOutsideMm: 14,
  },
  baseLayout: 'mikraot_gedolot',
};

// ─────────────────────────────────────────────────────────────────────────────
// shulchan-aruch — central text surrounded by commentary columns
// ─────────────────────────────────────────────────────────────────────────────

export const SHULCHAN_ARUCH_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'shulchan-aruch',
    name: 'Shulchan Aruch',
    nameHe: 'שולחן ערוך',
    description:
      'The Shulchan Aruch page: the Mechaber’s text (siman / se’if) in larger type down the central column, surrounded by the commentaries in smaller type in columns around it — Magen Avraham and Biur HaGra on one side, Mishnah Berurah and Biur Halacha on the other, Be’er Hetev, Sha’arei Teshuva and Tziyunim u-Mekorot below — each commentary column carrying its own running header at the top.',
    descriptionHe: 'דף שולחן ערוך: דברי המחבר (סימן / סעיף) באות גדולה בטור המרכזי, מוקף במפרשים באות קטנה בטורים מסביב — מגן אברהם וביאור הגר״א בצד אחד, משנה ברורה וביאור הלכה בצד השני, באר היטב, שערי תשובה וציונים ומקורות למטה — לכל טור מפרשים כותרת רצה משלו בראש.',
    genre: ['halakha', 'shulchan-aruch', 'commentary'],
    origin: 'Traditional Shulchan Aruch folio (Vilna / modern editions)',
    sourceRef: '10449_4_1kf1.png (Shulchan Aruch, Orach Chaim, Hilchot Shabbat)',
  },
  regions: [
    rect('header', 0, 0, 100, 4, {
      labelHe: 'כותרת — אורח חיים, הלכות שבת',
      labelEn: 'Header — Orach Chaim, Hilchot Shabbat',
    }),
    rect('main_text', 30, 5, 40, 70, {
      id: 'shulchan-aruch-text',
      labelHe: 'שולחן ערוך — סימן וסעיף',
      labelEn: 'Shulchan Aruch — siman and se’if',
      fontSizePt: 13,
      lineHeight: 1.3,
    }),
    rect('commentary_1', 72, 5, 28, 35, {
      labelHe: 'מגן אברהם',
      labelEn: 'Magen Avraham',
      namedCommentary: 'Magen Avraham',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_2', 72, 41, 28, 34, {
      labelHe: 'באור הגר״א',
      labelEn: 'Biur HaGra',
      namedCommentary: 'Biur HaGra',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_3', 0, 5, 28, 35, {
      labelHe: 'משנה ברורה',
      labelEn: 'Mishnah Berurah',
      namedCommentary: 'Mishnah Berurah',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_4', 0, 41, 28, 34, {
      labelHe: 'באור הלכה',
      labelEn: 'Biur Halacha',
      namedCommentary: 'Biur Halacha',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_5', 0, 76, 33, 12, {
      labelHe: 'באר היטב',
      labelEn: 'Be’er Hetev',
      namedCommentary: 'Be’er Hetev',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_6', 34, 76, 33, 12, {
      labelHe: 'שערי תשובה',
      labelEn: 'Sha’arei Teshuva',
      namedCommentary: 'Sha’arei Teshuva',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('marginal', 67, 76, 33, 12, {
      labelHe: 'ציונים ומקורות',
      labelEn: 'Tziyunim u-Mekorot',
      namedCommentary: 'Tziyunim u-Mekorot — source references',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'commentary_3', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'commentary_5', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'none' },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13,
    commentaryFontSizePt: 10,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'two_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// chumash-rishonim — Chumash with Rishonim
// ─────────────────────────────────────────────────────────────────────────────

export const CHUMASH_RISHONIM_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'chumash-rishonim',
    name: 'Chumash with Rishonim',
    nameHe: 'חומש עם ראשונים',
    description:
      'Chumash page: the verse in large type across the top, Rashi and Ramban in two columns below it, Ibn Ezra and Sforno in the lower band.',
    descriptionHe: 'דף חומש: הפסוק באות גדולה בראש העמוד, רש״י ורמב״ן בשני טורים מתחתיו, אבן עזרא וספורנו ברצועה התחתונה.',
    genre: ['tanach', 'chumash', 'commentary'],
    origin: 'Traditional Chumash with Rishonim (Mikraot Gedolot family)',
  },
  regions: [
    rect('header', 0, 0, 100, 5, { labelHe: 'כותרת — פרשה', labelEn: 'Header — parsha' }),
    rect('main_text', 0, 6, 100, 22, { labelHe: 'פסוק', labelEn: 'Verse', fontSizePt: 16, lineHeight: 1.35 }),
    rect('commentary_1', 0, 29, 48, 30, {
      labelHe: 'רש״י', labelEn: 'Rashi', namedCommentary: 'Rashi', fontSizePt: 10.5, lineHeight: 1.32,
    }),
    rect('commentary_2', 52, 29, 48, 30, {
      labelHe: 'רמב״ן', labelEn: 'Ramban', namedCommentary: 'Ramban', fontSizePt: 10, lineHeight: 1.3,
    }),
    rect('commentary_3', 0, 60, 48, 28, {
      labelHe: 'אבן עזרא', labelEn: 'Ibn Ezra', namedCommentary: 'Ibn Ezra', fontSizePt: 10, lineHeight: 1.3,
    }),
    rect('commentary_4', 52, 60, 48, 28, {
      labelHe: 'ספורנו', labelEn: 'Sforno', namedCommentary: 'Sforno', fontSizePt: 10, lineHeight: 1.3,
    }),
    rect('footnote', 0, 89, 100, 8, { labelHe: 'הערות', labelEn: 'Notes', fontSizePt: 9 }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'lineIndex', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'none' },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 16,
    commentaryFontSizePt: 10.5,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'mikraot_gedolot',
};

// ─────────────────────────────────────────────────────────────────────────────
// responsa — She'elos U'teshuvos
// ─────────────────────────────────────────────────────────────────────────────

export const RESPONSA_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'responsa',
    name: 'Responsa (She’elos U’teshuvos)',
    nameHe: 'שו״ת',
    description:
      'Responsa page: a single running column for the question and answer, headed by the siman banner, with a footnote band for sources and references.',
    descriptionHe: 'דף שו״ת: טור יחיד רץ לשאלה ולתשובה, בראשו כותרת הסימן, עם רצועת הערות שוליים למקורות ולהפניות.',
    genre: ['halakha', 'responsa', 'prose'],
    origin: 'Traditional responsa editions (single-column prose)',
  },
  regions: [
    rect('header', 0, 0, 100, 5, { labelHe: 'כותרת — סימן', labelEn: 'Header — siman' }),
    rect('main_text', 0, 6, 100, 80, {
      labelHe: 'תשובה',
      labelEn: 'Responsum',
      fontSizePt: 13.5,
      lineHeight: 1.32,
    }),
    rect('footnote', 0, 87, 100, 10, { labelHe: 'מקורות', labelEn: 'Sources', fontSizePt: 9 }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'first-line', amountPt: 14 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 10,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'numbers',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// chassidic-drush
// ─────────────────────────────────────────────────────────────────────────────

export const CHASSIDIC_DRUSH_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'chassidic-drush',
    name: 'Chassidic Drush',
    nameHe: 'דרוש חסידי',
    description:
      'Chassidic sefer (Kedushat Levi, Noam Elimelech, Me\u2019or Einayim …) in two justified columns: body in Rashi script, each paragraph opening with bold square-letter words, no first-line indent, parsha / section headings centred inside the column, Hebrew-letter folio.',
    descriptionHe: 'ספר חסידות (קדושת לוי, נועם אלימלך, מאור עינים …) בשני טורים מיושרים: גוף הטקסט בכתב רש״י, כל מאמר פותח במילים מודגשות באותיות מרובעות, ללא הזחה, כותרות פרשה ומאמר ממורכזות בתוך הטור, מספור דפים באותיות.',
    genre: ['chassidut', 'drush', 'prose'],
    origin: 'Traditional Chassidic editions in two columns (Kedushat Levi, Berditchev / Lemberg prints)',
  },
  regions: [
    rect('header', 0, 0, 100, 5, { labelHe: 'כותרת — ספר · פרשה', labelEn: 'Header — book · parsha' }),
    rect('main_text', 0, 6, 100, 82, {
      labelHe: 'דרוש (שני טורים)',
      labelEn: 'Drush (two columns)',
      fontSizePt: 13.5,
      lineHeight: 1.3,
    }),
    rect('footnote', 0, 89, 100, 9, {
      labelHe: 'הערות',
      labelEn: 'Notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'none', amountPt: 0 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 9,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'two_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// yiddish-sefer
// ─────────────────────────────────────────────────────────────────────────────

export const YIDDISH_SEFER_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'yiddish-sefer',
    name: 'Yiddish Sefer',
    nameHe: 'ספר יידיש',
    description:
      'Yiddish sefer page: Hebrew source in the right-hand column, Yiddish text (Tzenerene, translation or commentary) in the left-hand column, with a footnote band below.',
    descriptionHe: 'דף ספר יידיש: מקור עברי בטור הימני, טקסט יידיש (צאינה וראינה, תרגום או ביאור) בטור השמאלי, עם רצועת הערות שוליים למטה.',
    genre: ['yiddish', 'translation', 'commentary'],
    origin: 'Traditional Yiddish sefarim (Tzenerene family)',
  },
  regions: [
    rect('header', 0, 0, 100, 5, { labelHe: 'כותרת', labelEn: 'Header' }),
    rect('main_text', 55, 6, 45, 82, {
      side: 'right',
      labelHe: 'מקור עברי',
      labelEn: 'Hebrew source',
      fontSizePt: 14.5,
      lineHeight: 1.32,
    }),
    rect('commentary_1', 0, 6, 52, 82, {
      side: 'left',
      labelHe: 'טקסט יידיש',
      labelEn: 'Yiddish text',
      namedCommentary: 'Yiddish translation / commentary',
      fontSizePt: 11,
      lineHeight: 1.32,
    }),
    rect('footnote', 0, 89, 100, 8, { labelHe: 'הערות', labelEn: 'Notes', fontSizePt: 9 }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'lineIndex', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'none' },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 14.5,
    commentaryFontSizePt: 11,
  },
  headerFooter: {
    invocation: 'בס״ד',
    folioStyle: 'numbers',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'yiddish_sefer',
};
// ─────────────────────────────────────────────────────────────────────────────
// tzenerene — Tzenerene (צאינה וראינה), alias of yiddish-sefer
// ─────────────────────────────────────────────────────────────────────────────
// v0.9.5: promoted from the v0.9.3 adapter-only entry to a proper library
// alias (like vilna-shas). Same geometry as yiddish-sefer — the layout
// does not change between a Yiddish sefer and the Tzenerene — but the
// name is a book type of its own, so it stays a separate entry that
// resolves to yiddish-sefer. Its rules + NL aliases live in the unified
// catalogue below, keyed 'tzenerene'.
// ─────────────────────────────────────────────────────────────────────────────
export const TZENERENE_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'tzenerene',
    name: 'Tzenerene',
    nameHe: 'צאינה וראינה',
    description:
      'Tzenerene (צאינה וראינה) — the classic Yiddish commentary on the weekly parsha: Hebrew verse in the right-hand column, Yiddish translation and commentary in the left-hand column, with a footnote band below. Same layout as the Yiddish sefer (yiddish-sefer) — kept as an alias so the two names never drift apart.',
    descriptionHe:
      'צאינה וראינה — הביאור היידי הקלאסי לפרשת השבוע: פסוק עברי בטור הימני, תרגום וביאור יידיש בטור השמאלי, עם רצועת הערות שוליים למטה. אותו עימוד כמו ספר יידיש (yiddish-sefer) — נשמר ככינוי כדי שהשניים לא יתרחקו זה מזה.',
    genre: ['yiddish', 'tzenerene', 'צאינה וראינה', 'parsha', 'commentary'],
    origin: 'Tzenerene (Jacob ben Isaac Ashkenazi, 17th century) — Yiddish commentary on the weekly parsha',
  },
  aliasOf: 'yiddish-sefer',
  regions: [],
  flow: [],
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// machon-edition — modern Machon edition (the neutral default)
// ─────────────────────────────────────────────────────────────────────────────

export const MACHON_EDITION_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'machon-edition',
    name: 'Modern Machon Edition',
    nameHe: 'מהדורת מכון מודרנית',
    description:
      'Modern Machon-style edition: a clean single running column with a running title, first-line indents, and a footnote band. The neutral default when no historical pattern matches.',
    descriptionHe: 'מהדורת מכון מודרנית: טור יחיד נקי עם כותרת רצה, הזחות שורה ראשונה, ורצועת הערות שוליים. ברירת המחדל הניטרלית כשאין התאמה לתבנית היסטורית.',
    genre: ['modern', 'prose', 'default'],
    origin: 'Modern Machon editions (single-column prose)',
  },
  regions: [
    rect('header', 0, 0, 100, 5, { labelHe: 'כותרת רצה', labelEn: 'Running title' }),
    rect('main_text', 0, 6, 100, 78, {
      labelHe: 'גוף הספר',
      labelEn: 'Body text',
      fontSizePt: 13.5,
      lineHeight: 1.32,
    }),
    rect('footnote', 0, 85, 100, 12, { labelHe: 'הערות שוליים', labelEn: 'Footnotes', fontSizePt: 10 }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'first-line', amountPt: 12 },
    justification: { expansion: 'tracking' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 10,
  },
  headerFooter: {
    invocation: 'בס״ד',
    folioStyle: 'numbers',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// siddur — from the supplied spread (Mincha l'Shabbat, pp. 276–277)
// ─────────────────────────────────────────────────────────────────────────────

export const SIDDUR_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'siddur',
    name: 'Siddur',
    nameHe: 'סידור',
    description:
      'Siddur page: a single column of prayer text, a centred running header (e.g. “מנחה לשבת”) at the top of each page, folio numbers at the outer top corners, centred section headings inside the text, and small marginal notes (halachic notes / source notes) in the outer margin. Nusach variants (Ashkenaz / Sefard / Edot HaMizrach / Ari / Teman, see the `nusach` metadata) share this geometry — the difference between nusachot is content order and kavanot, not layout — so one recipe serves all five.',
    descriptionHe: 'דף סידור: טור יחיד של תפילה, כותרת רצה ממורכזת (לדוגמה ״מנחה לשבת״) בראש כל עמוד, מספרי דפים בפינות העליונות החיצוניות, כותרות פרקים ממורכזות בתוך הטקסט, והערות קטנות (הערות הלכתיות / הערות מקור) בשוליים החיצוניים. נוסחאות שונות (אשכנז / ספרד / עדות המזרח / ארי / תימן) חולקות את אותה גיאומטריה — ההבדל בין הנוסחאות הוא בסדר התוכן ובכוונות, לא בעימוד — ולכן תבנית אחת משרתת את כולן.',
    genre: ['siddur', 'prayer', 'tefillah'],
    origin: 'Traditional siddur layout (single-column prayer text)',
    sourceRef: '10451_2_ooui.png (Siddur spread, pp. 276–277, Mincha l’Shabbat)',
    // v0.9.3 Part A: the five nusachot printed in this geometry.
    nusach: ['Ashkenaz', 'Sefard', 'Edot HaMizrach', 'Ari', 'Teman'],
  },
  // No header BOX: the running header is a header/footer rule, so the
  // section headings stay in the main-text flow (centred), where they
  // belong in a siddur — they are not header-band content.
  regions: [
    rect('main_text', 0, 5, 88, 88, {
      labelHe: 'תפילה',
      labelEn: 'Prayer text',
      fontSizePt: 13.5,
      lineHeight: 1.35,
    }),
    rect('marginal', 90, 5, 10, 88, {
      side: 'outside',
      labelHe: 'הערות שוליים / מקורות',
      labelEn: 'Marginal notes / sources',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'marginal', anchor: 'none', overflow: 'outer-margin' },
  ],
  typography: {
    indentation: { mode: 'none' },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 9,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    runningHeaderText: 'מנחה לשבת',
    runningHeaderAlignment: 'center',
    folioStyle: 'numbers',
    folioPosition: 'outer-top',
    showDafPrefix: false,
  },
  page: {
    widthMm: 148,
    heightMm: 210,
    marginTopMm: 10,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 14,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// v0.9.3 Part A — eighteen more recipes (see RESEARCH-NOTE.md)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// shas-oz-vehadar — Oz VeHadar Shas (Metivta)
// ─────────────────────────────────────────────────────────────────────────────

export const SHAS_OZ_VEHADAR_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'shas-oz-vehadar',
    name: 'Oz VeHadar Shas',
    nameHe: 'ש״ס עוז והדר',
    description:
      'Oz VeHadar (Metivta) Shas: the same Tzuras HaDaf geometry as the Vilna folio — Gemara in the centre with the stepped knee, Rashi inner, Tosafot outer, Ein Mishpat / Masoret ha-Shas / Torah Or in the band below the knee — but with a corrected text, an EXPANDED outer-margin commentary set (Rabbeinu Chananel, Ran, Tosafot Rid, Hagahos HaRi Landau), a marginalia / cross-reference strip in the outer column, WIDER outer columns (26% vs the Vilna 24%), and a variant-readings footnote band at the foot of the page.',
    descriptionHe: 'דף ש״ס וילנא עם טקסט מתוקן, מפרשים מורחבים בשוליים החיצוניים, רצועת מראי מקומות והערות נוסחאות.',
    genre: ['shas', 'talmud', 'oz vehadar', 'oz ve-hadar', 'עוז והדר', 'metivta', 'מטיבתא'],
    origin: 'Oz VeHadar edition (Metivta) — Vilna format, corrected text',
    sourceRef: 'RESEARCH-NOTE.md §1; talmud-2_5_qm04.pdf (Berakhot 2a, Oz VeHadar / ArtScroll)',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת הדף — מסכת, פרק, מספר דף',
      labelEn: 'Folio header — tractate, chapter, daf number',
    }),
    rect('main_text', 30, 6, 40, 7, {
      labelHe: 'משנה — כותרת פתיחה ממוסגרת',
      labelEn: 'Mishna — boxed opening headword',
    }),
    rect('main_text', 28, 14, 44, 60, {
      id: 'gemara',
      labelHe: 'גמרא',
      labelEn: 'Gemara',
      fontSizePt: 14.5,
      lineHeight: 1.32,
    }),
    rect('rashi', 74, 6, 26, 47, {
      side: 'inside',
      labelHe: 'רש״י',
      labelEn: 'Rashi',
      namedCommentary: 'Rashi (France, 1040–1105)',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('tosafot', 0, 6, 26, 47, {
      side: 'outside',
      labelHe: 'תוספות',
      labelEn: 'Tosafot',
      namedCommentary: 'Tosafot (France, 12th century)',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('commentary_1', 0, 75, 33, 13, {
      labelHe: 'עין משפט נר מצווה',
      labelEn: 'Ein Mishpat Ner Mitzvah',
      namedCommentary: 'Ein Mishpat Ner Mitzvah — halachic cross-references',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_2', 34, 75, 33, 13, {
      labelHe: 'מסורת הש״ס',
      labelEn: 'Masoret ha-Shas',
      namedCommentary: 'Masoret ha-Shas — cross-references + textual variants',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_3', 67, 75, 33, 13, {
      labelHe: 'תורה אור',
      labelEn: 'Torah Or',
      namedCommentary: 'Torah Or — the full Tanach verses cited in the Gemara',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    // Expanded outer-margin commentary set (tractate-dependent).
    rect('commentary_4', 0, 54, 26, 11, {
      side: 'outside',
      labelHe: 'מפרשים נוספים — רבנו חננאל, ר״ן, תוספות רי״ד',
      labelEn: 'Further commentaries — Rabbeinu Chananel, Ran, Tosafot Rid',
      namedCommentary: 'Rabbeinu Chananel / Rabbeinu Nissim / Tosafot Rid / Hagahos HaRi Landau (tractate-dependent)',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    // Marginalia / cross-reference strip in the outer column.
    rect('marginal', 0, 66, 26, 6, {
      id: 'oz-marginalia',
      side: 'outside',
      labelHe: 'הערות שוליים והפניות',
      labelEn: 'Marginalia and cross-references',
      namedCommentary: 'Oz VeHadar marginalia — cross-references and variant notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('marginal', 74, 54, 26, 9, {
      id: 'gilyon-hashas',
      side: 'inside',
      labelHe: 'גליון הש״ס',
      labelEn: 'Gilyon ha-Shas',
      namedCommentary: 'Gilyon ha-Shas — marginal notes by R. Akiva Eiger',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('marginal', 74, 64, 26, 8, {
      id: 'hagahot-habach',
      side: 'inside',
      labelHe: 'הגהות הב״ח',
      labelEn: 'Hagahot ha-Bach',
      namedCommentary: 'Hagahot ha-Bach — marginal notes by the Bach (R. Yoel Sirkis)',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    // Variant-readings footnote band at the foot of the page.
    rect('footnote', 0, 89, 100, 8, {
      id: 'variant-readings',
      labelHe: 'חילופי נוסחאות',
      labelEn: 'Variant readings',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'rashi', anchor: 'dibbur', overflow: 'knee' },
    { parentTier: 'main_text', childTier: 'tosafot', anchor: 'dibbur', overflow: 'outer-margin' },
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'rashi', childTier: 'marginal', anchor: 'none', overflow: 'outer-margin' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    dibbur: { weight: 700, brackets: 'square', separator: 'ד״ה' },
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 14.5,
    commentaryFontSizePt: 10.5,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'daf-amud',
    folioPosition: 'outer-top',
    showDafPrefix: true,
  },
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 10,
  },
  baseLayout: 'rav_text',
};

// ─────────────────────────────────────────────────────────────────────────────
// shas-artscroll — ArtScroll Schottenstein (Hebrew page)
// ─────────────────────────────────────────────────────────────────────────────

export const SHAS_ARTSCROLL_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'shas-artscroll',
    name: 'ArtScroll Schottenstein Shas (Hebrew page)',
    nameHe: 'ש״ס ארטסקרול — שוטנשטיין',
    description:
      'ArtScroll Schottenstein (Hebrew page): the Vilna folio — Gemara centre with the stepped knee, Rashi inner, Tosafot outer, lower band of Ein Mishpat / Masoret ha-Shas / Torah Or — at the LARGER 9"x12" (229x305mm) format, with vowelized and punctuated Gemara and Rashi and BOLD Rashi headings. Vowelization is a text property, not layout geometry, and is recorded here rather than modelled. The facing English elucidation page is a SPREAD property the per-page engine does not model: this recipe describes the Hebrew page only, honestly — the facing page is not faked.',
    descriptionHe: 'דף וילנא מנוקד ומפוסק, כותרות רש״י מודגשות, פורמט גדול (9x12 אינץ׳). עמוד הביאור האנגלי ממול אינו מעוצב כאן — התבנית מתארת את העמוד העברי בלבד.',
    genre: ['shas', 'talmud', 'artscroll', 'schottenstein', 'ארטסקרול', 'שוטנשטיין'],
    origin: 'ArtScroll Schottenstein Edition of the Babylonian Talmud (Hebrew page), 9"x12"',
    sourceRef: 'RESEARCH-NOTE.md §2; talmud-2_5_qm04.pdf (Berakhot 2a, Oz VeHadar / ArtScroll)',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת הדף — מסכת, פרק, מספר דף',
      labelEn: 'Folio header — tractate, chapter, daf number',
    }),
    rect('main_text', 30, 6, 40, 7, {
      labelHe: 'משנה — כותרת פתיחה ממוסגרת',
      labelEn: 'Mishna — boxed opening headword',
    }),
    rect('main_text', 26, 14, 48, 60, {
      id: 'gemara',
      labelHe: 'גמרא',
      labelEn: 'Gemara',
      fontSizePt: 14.5,
      lineHeight: 1.32,
    }),
    rect('rashi', 76, 6, 24, 47, {
      side: 'inside',
      labelHe: 'רש״י',
      labelEn: 'Rashi',
      namedCommentary: 'Rashi (France, 1040–1105) — headings bold, vowelized',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('tosafot', 0, 6, 24, 47, {
      side: 'outside',
      labelHe: 'תוספות',
      labelEn: 'Tosafot',
      namedCommentary: 'Tosafot (France, 12th century)',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('commentary_1', 0, 75, 33, 13, {
      labelHe: 'עין משפט נר מצווה',
      labelEn: 'Ein Mishpat Ner Mitzvah',
      namedCommentary: 'Ein Mishpat Ner Mitzvah — halachic cross-references',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_2', 34, 75, 33, 13, {
      labelHe: 'מסורת הש״ס',
      labelEn: 'Masoret ha-Shas',
      namedCommentary: 'Masoret ha-Shas — cross-references + textual variants',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_3', 67, 75, 33, 13, {
      labelHe: 'תורה אור',
      labelEn: 'Torah Or',
      namedCommentary: 'Torah Or — the full Tanach verses cited in the Gemara',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_4', 0, 54, 24, 18, {
      side: 'outside',
      labelHe: 'מפרשים נוספים — רבנו חננאל, ר״ן',
      labelEn: 'Further commentaries — Rabbeinu Chananel, Ran',
      namedCommentary: 'Rabbeinu Chananel / Rabbeinu Nissim (tractate-dependent)',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('marginal', 76, 54, 24, 9, {
      id: 'gilyon-hashas',
      side: 'inside',
      labelHe: 'גליון הש״ס',
      labelEn: 'Gilyon ha-Shas',
      namedCommentary: 'Gilyon ha-Shas — marginal notes by R. Akiva Eiger',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('marginal', 76, 64, 24, 8, {
      id: 'hagahot-habach',
      side: 'inside',
      labelHe: 'הגהות הב״ח',
      labelEn: 'Hagahot ha-Bach',
      namedCommentary: 'Hagahot ha-Bach — marginal notes by the Bach (R. Yoel Sirkis)',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'rashi', anchor: 'dibbur', overflow: 'knee' },
    { parentTier: 'main_text', childTier: 'tosafot', anchor: 'dibbur', overflow: 'outer-margin' },
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'rashi', childTier: 'marginal', anchor: 'none', overflow: 'outer-margin' },
  ],
  typography: {
    dibbur: { weight: 700, brackets: 'square', separator: 'ד״ה' },
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 14.5,
    commentaryFontSizePt: 10.5,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'daf-amud',
    folioPosition: 'outer-top',
    showDafPrefix: true,
  },
  page: {
    widthMm: 229,
    heightMm: 305,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 10,
  },
  baseLayout: 'rav_text',
};

// ─────────────────────────────────────────────────────────────────────────────
// shas-steinzaltz — Steinsaltz Talmud
// ─────────────────────────────────────────────────────────────────────────────

export const SHAS_STEINZALTZ_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'shas-steinzaltz',
    name: 'Steinsaltz Talmud',
    nameHe: 'ש״ס שטיינזלץ',
    description:
      'Steinsaltz Talmud: the Vilna folio — Gemara centre with the stepped knee, Rashi inner, Tosafot outer, lower band of Ein Mishpat / Masoret ha-Shas / Torah Or — with vowels and punctuation throughout and the explanatory notes in the margin band (outer-margin commentary column, inner marginal notes, and a notes band at the foot of the page). Vowelization is a text property, not layout geometry, and is recorded here rather than modelled.',
    descriptionHe: 'דף וילנא מנוקד ומפוסק לכל אורכו, עם הערות הסבר ברצועת השוליים.',
    genre: ['shas', 'talmud', 'steinzaltz', 'שטיינזלץ'],
    origin: 'Steinsaltz Edition of the Talmud — Vilna page with vowels, punctuation and explanatory notes',
    sourceRef: 'RESEARCH-NOTE.md §3',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת הדף — מסכת, פרק, מספר דף',
      labelEn: 'Folio header — tractate, chapter, daf number',
    }),
    rect('main_text', 30, 6, 40, 7, {
      labelHe: 'משנה — כותרת פתיחה ממוסגרת',
      labelEn: 'Mishna — boxed opening headword',
    }),
    rect('main_text', 26, 14, 48, 60, {
      id: 'gemara',
      labelHe: 'גמרא',
      labelEn: 'Gemara',
      fontSizePt: 14.5,
      lineHeight: 1.32,
    }),
    rect('rashi', 76, 6, 24, 47, {
      side: 'inside',
      labelHe: 'רש״י',
      labelEn: 'Rashi',
      namedCommentary: 'Rashi (France, 1040–1105) — vowelized and punctuated',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('tosafot', 0, 6, 24, 47, {
      side: 'outside',
      labelHe: 'תוספות',
      labelEn: 'Tosafot',
      namedCommentary: 'Tosafot (France, 12th century)',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('commentary_1', 0, 75, 33, 13, {
      labelHe: 'עין משפט נר מצווה',
      labelEn: 'Ein Mishpat Ner Mitzvah',
      namedCommentary: 'Ein Mishpat Ner Mitzvah — halachic cross-references',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_2', 34, 75, 33, 13, {
      labelHe: 'מסורת הש״ס',
      labelEn: 'Masoret ha-Shas',
      namedCommentary: 'Masoret ha-Shas — cross-references + textual variants',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('commentary_3', 67, 75, 33, 13, {
      labelHe: 'תורה אור',
      labelEn: 'Torah Or',
      namedCommentary: 'Torah Or — the full Tanach verses cited in the Gemara',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    // Explanatory notes in the margin band (outer column).
    rect('commentary_4', 0, 54, 24, 18, {
      side: 'outside',
      labelHe: 'הערות הסבר',
      labelEn: 'Explanatory notes',
      namedCommentary: 'Steinsaltz explanatory notes — modern-Hebrew explanation of the Gemara',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('marginal', 76, 54, 24, 9, {
      id: 'steinzaltz-notes',
      side: 'inside',
      labelHe: 'הערות הסבר',
      labelEn: 'Explanatory notes',
      namedCommentary: 'Steinsaltz explanatory notes (inner margin)',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    rect('marginal', 76, 64, 24, 8, {
      id: 'steinzaltz-sources',
      side: 'inside',
      labelHe: 'מקורות והפניות',
      labelEn: 'Sources and cross-references',
      namedCommentary: 'Steinsaltz source references',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
    // Notes band at the foot of the page.
    rect('footnote', 0, 89, 100, 8, {
      id: 'steinzaltz-notes-band',
      labelHe: 'הערות',
      labelEn: 'Notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'rashi', anchor: 'dibbur', overflow: 'knee' },
    { parentTier: 'main_text', childTier: 'tosafot', anchor: 'dibbur', overflow: 'outer-margin' },
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'rashi', childTier: 'marginal', anchor: 'none', overflow: 'outer-margin' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    dibbur: { weight: 700, brackets: 'square', separator: 'ד״ה' },
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 14.5,
    commentaryFontSizePt: 10.5,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'daf-amud',
    folioPosition: 'outer-top',
    showDafPrefix: true,
  },
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 10,
  },
  baseLayout: 'rav_text',
};

// ─────────────────────────────────────────────────────────────────────────────
// yerushalmi — Talmud Yerushalmi (four sub-pages per folio)
// ─────────────────────────────────────────────────────────────────────────────

export const YERUSHALMI_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'yerushalmi',
    name: 'Talmud Yerushalmi',
    nameHe: 'תלמוד ירושלמי',
    description:
      'Talmud Yerushalmi: the CRITICAL difference from Bavli is the folio — FOUR sub-pages (a/b/c/d), two text columns per side (this recto page shows sub-page a on the right and sub-page b on the left; c and d are on the verso), and citations by tractate / chapter / halakha, not daf-amud. Mishnah + Yerushalmi Gemara fill the two central columns; Pnei Moshe surrounds them (Rashi\u2019s role); Korban HaEdah and Ridvaz are the further tiers below; a cross-reference band runs along the foot. Folio style is the NEW \'yerushalmi-abcd\' — the engine has no renderer for the a/b/c/d suffixes yet, so on apply it falls back to plain-number folios (recorded honestly, not faked).',
    descriptionHe: 'דף ירושלמי: ארבעה עמודי משנה בדף אחד (א/ב/ג/ד) — שני טורים בכל צד; ציטוט לפי מסכת / פרק / הלכה; פני משה מסביב, קרבן העדה ורי״דב״ז כמפרשים נוספים.',
    genre: ['talmud', 'yerushalmi', 'ירושלמי', 'pnei moshe', 'פני משה', 'korban haedah', 'קרבן העדה', 'ridvaz', 'רי״דב״ז'],
    origin: 'Talmud Yerushalmi (Venice edition; modern editions with Pnei Moshe, Korban HaEdah, Ridvaz)',
    sourceRef: 'RESEARCH-NOTE.md §4',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — מסכת, פרק, הלכה',
      labelEn: 'Header — tractate, chapter, halakha',
    }),
    // Sub-page a (right column) and sub-page b (left column): Mishnah
    // + Yerushalmi Gemara in each.
    rect('main_text', 52, 6, 48, 34, {
      id: 'yerushalmi-a',
      side: 'right',
      labelHe: 'משנה וגמרא — דף א׳',
      labelEn: 'Mishnah + Gemara — sub-page a',
      fontSizePt: 14,
      lineHeight: 1.32,
    }),
    rect('main_text', 0, 6, 48, 34, {
      id: 'yerushalmi-b',
      side: 'left',
      labelHe: 'משנה וגמרא — דף ב׳',
      labelEn: 'Mishnah + Gemara — sub-page b',
      fontSizePt: 14,
      lineHeight: 1.32,
    }),
    // Pnei Moshe surrounding each column (Rashi's role on Bavli).
    rect('rashi', 52, 41, 48, 20, {
      id: 'pnei-moshe-a',
      labelHe: 'פני משה',
      labelEn: 'Pnei Moshe',
      namedCommentary: 'Pnei Moshe (R. Moshe Margoliot) — the peshat commentary, Rashi\u2019s role',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('rashi', 0, 41, 48, 20, {
      id: 'pnei-moshe-b',
      labelHe: 'פני משה',
      labelEn: 'Pnei Moshe',
      namedCommentary: 'Pnei Moshe (R. Moshe Margoliot) — the peshat commentary, Rashi\u2019s role',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('commentary_1', 52, 62, 48, 13, {
      labelHe: 'קרבן העדה',
      labelEn: 'Korban HaEdah',
      namedCommentary: 'Korban HaEdah (R. David Fränkel)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_2', 0, 62, 48, 13, {
      labelHe: 'רי״דב״ז',
      labelEn: 'Ridvaz',
      namedCommentary: 'Ridvaz (R. Yaakov Dovid Wilovsky)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('footnote', 0, 76, 100, 12, {
      labelHe: 'הערות והפניות',
      labelEn: 'Notes and cross-references',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'rashi', anchor: 'dibbur', overflow: 'knee' },
    { parentTier: 'rashi', childTier: 'commentary_1', anchor: 'none', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    dibbur: { weight: 700, brackets: 'square', separator: 'ד״ה' },
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 14,
    commentaryFontSizePt: 10.5,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'yerushalmi-abcd',
    folioPosition: 'outer-top',
    showDafPrefix: false,
  },
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 10,
  },
  baseLayout: 'two_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// mishnah-classic — Mishnah with Bartenura + Tosafot Yom Tov
// ─────────────────────────────────────────────────────────────────────────────

export const MISHNAH_CLASSIC_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'mishnah-classic',
    name: 'Mishnah with Bartenura',
    nameHe: 'משנה עם ברטנורא',
    description:
      'Mishnah with Bartenura and Tosafot Yom Tov: the Mishnah text in larger type at the top / centre of the page, Bartenura directly below it in smaller type, Tosafot Yom Tov (Ikar in compact printings) and the Rambam\u2019s Mishnah commentary in the lower band, and a notes band at the foot. Structure is seder / masechet / perek / mishnah, with chapter headings. A bare \'mishnah\' hint alone is weak for classification (see RESEARCH-NOTE.md) — it needs a commentary marker.',
    descriptionHe: 'משנה באות גדולה בראש הדף ובמרכזו, ברטנורא מתחתיה באות קטנה, ותוספות יום טוב כמפרש נוסף.',
    genre: ['mishnah', 'bartenura', 'ברטנורא', 'tosafot yom tov', 'תוספות יום טוב', 'tosafos yom tov', 'ikar tosefot', 'משנה'],
    origin: 'Traditional Mishnah editions (Bartenura + Tosafot Yom Tov)',
    sourceRef: 'RESEARCH-NOTE.md §5',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — מסכת, פרק',
      labelEn: 'Header — tractate, chapter',
    }),
    rect('main_text', 10, 6, 80, 30, {
      id: 'mishnah-text',
      labelHe: 'משנה',
      labelEn: 'Mishnah',
      fontSizePt: 15,
      lineHeight: 1.35,
    }),
    rect('commentary_1', 0, 37, 100, 35, {
      labelHe: 'ברטנורא',
      labelEn: 'Bartenura',
      namedCommentary: 'Bartenura (R. Ovadia of Bertinoro, 15th century)',
      fontSizePt: 11,
      lineHeight: 1.32,
    }),
    rect('commentary_2', 0, 73, 48, 15, {
      labelHe: 'תוספות יום טוב',
      labelEn: 'Tosafot Yom Tov',
      namedCommentary: 'Tosafot Yom Tov (R. Yom Tov Lipmann Heller)',
      fontSizePt: 10.5,
      lineHeight: 1.3,
    }),
    rect('commentary_3', 52, 73, 48, 15, {
      labelHe: 'פירוש הרמב״ם',
      labelEn: 'Rambam\u2019s Mishnah commentary',
      namedCommentary: 'Rambam\u2019s commentary on the Mishnah (1168)',
      fontSizePt: 10.5,
      lineHeight: 1.3,
    }),
    rect('footnote', 0, 89, 100, 8, {
      labelHe: 'הערות',
      labelEn: 'Notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'commentary_1', childTier: 'commentary_2', anchor: 'none', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 15,
    commentaryFontSizePt: 11,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// mishnah-kehati — Mishnah Kehati
// ─────────────────────────────────────────────────────────────────────────────

export const MISHNAH_KEHATI_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'mishnah-kehati',
    name: 'Mishnah Kehati',
    nameHe: 'משנה קהתי',
    description:
      'Mishnah Kehati: one mishnah plus its modern-Hebrew explanation as a single unit — the Mishnah at the top of the column and the Kehati commentary directly below it, with a thematic introduction before each mishnah and Bartenura also printed at the foot of the column. Single column, generous leading, first-line indents. The tractate introduction page is a content feature (same single-column geometry).',
    descriptionHe: 'משנה אחת עם הביאור בעברית מודרנית מתחתיה כיחידה אחת, הקדמת מסכת והקדמה קצרה לפני כל משנה; גם ברטנורא מודפס.',
    genre: ['mishnah', 'kehati', 'קהתי'],
    origin: 'Kehati edition of the Mishnah (modern Hebrew commentary)',
    sourceRef: 'RESEARCH-NOTE.md §6',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — מסכת, פרק',
      labelEn: 'Header — tractate, chapter',
    }),
    rect('main_text', 0, 6, 100, 40, {
      id: 'mishnah-text',
      labelHe: 'משנה',
      labelEn: 'Mishnah',
      fontSizePt: 14.5,
      lineHeight: 1.5,
    }),
    rect('commentary_1', 0, 47, 100, 30, {
      labelHe: 'פירוש קהתי',
      labelEn: 'Kehati commentary',
      namedCommentary: 'Kehati — modern-Hebrew explanation, one per mishnah',
      fontSizePt: 12,
      lineHeight: 1.5,
    }),
    rect('commentary_2', 0, 78, 100, 10, {
      labelHe: 'ברטנורא',
      labelEn: 'Bartenura',
      namedCommentary: 'Bartenura (R. Ovadia of Bertinoro, 15th century)',
      fontSizePt: 10.5,
      lineHeight: 1.35,
    }),
    rect('footnote', 0, 89, 100, 8, {
      labelHe: 'הערות',
      labelEn: 'Notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'commentary_1', childTier: 'commentary_2', anchor: 'none', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'first-line', amountPt: 12 },
    justification: { expansion: 'tracking' },
    mainFontSizePt: 14.5,
    commentaryFontSizePt: 12,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'numbers',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// mishneh-torah — Rambam Mishneh Torah
// ─────────────────────────────────────────────────────────────────────────────

export const MISHNEH_TORAH_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'mishneh-torah',
    name: 'Rambam — Mishneh Torah',
    nameHe: 'משנה תורה — רמב״ם',
    description:
      'Rambam Mishneh Torah: 14 sefarim → halachot (chapters) → halachot (paragraphs). The Rambam text fills the central column; Kesef Mishneh flanks it on the right and Maggid Mishneh on the left (Venice 1574–75 set the leaf format: Kesef Mishneh on one side of the leaf, Maggid Mishneh on its verso); Lechem Mishneh and Hagahot Maimuniyot sit in the lower flanks. The Raavad glosses are printed INTERSPERSED in the Rambam text — the box flow cannot place a second stream inside the central column, so the recipe records them honestly as a gloss band directly under the Rambam column (the closest the box flow can represent) and notes the true position here. Raavad glosses have no dibbur hamatchil.',
    descriptionHe: 'משנה תורה: הרמב״ם בעמוד המרכזי, הגהות הראב״ד משולבות בטקסט, כסף משנה ומגיד משנה כמפרשים צדדיים, לחם משנה והגהות מיימוניות ברצועה התחתונה.',
    genre: ['halakha', 'mishneh torah', 'משנה תורה', 'rambam', 'רמב״ם', 'kesef mishneh', 'כסף משנה', 'maggid mishneh', 'מגיד משנה', 'raavad', 'ראב״ד', 'lechem mishneh', 'לחם משנה'],
    origin: 'Mishneh Torah editions (Venice 1574–75 leaf format)',
    sourceRef: 'RESEARCH-NOTE.md §7',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — ספר, הלכות',
      labelEn: 'Header — sefer, halachot',
    }),
    rect('main_text', 32, 6, 36, 68, {
      id: 'rambam-text',
      labelHe: 'רמב״ם — משנה תורה',
      labelEn: 'Rambam — Mishneh Torah',
      fontSizePt: 13.5,
      lineHeight: 1.3,
    }),
    rect('commentary_1', 70, 6, 30, 34, {
      side: 'right',
      labelHe: 'כסף משנה',
      labelEn: 'Kesef Mishneh',
      namedCommentary: 'Kesef Mishneh (R. Yosef Karo)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_2', 0, 6, 30, 34, {
      side: 'left',
      labelHe: 'מגיד משנה',
      labelEn: 'Maggid Mishneh',
      namedCommentary: 'Maggid Mishneh (R. Vidal of Tolosa)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_3', 70, 41, 30, 33, {
      side: 'right',
      labelHe: 'לחם משנה',
      labelEn: 'Lechem Mishneh',
      namedCommentary: 'Lechem Mishneh (R. Abraham de Boton)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_4', 0, 41, 30, 33, {
      side: 'left',
      labelHe: 'הגהות מיימוניות',
      labelEn: 'Hagahot Maimuniyot',
      namedCommentary: 'Hagahot Maimuniyot',
      fontSizePt: 10,
      lineHeight: 1.25,
    }),
    // Raavad glosses: interspersed in the printed text (see the
    // description); recorded as a gloss band under the Rambam column.
    rect('gloss', 32, 75, 36, 13, {
      id: 'raavad-glosses',
      labelHe: 'השגות הראב״ד',
      labelEn: 'Raavad glosses',
      namedCommentary: 'Raavad (R. Abraham ben David) — glosses, printed interspersed in the Rambam text',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('footnote', 0, 89, 100, 8, {
      labelHe: 'הערות ומקורות',
      labelEn: 'Notes and sources',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'gloss', anchor: 'none', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    // No dibbur: the Rambam text has no dibbur hamatchil, and the
    // Raavad glosses have none either (recorded in the description).
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 10,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'two_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// mishnah-berurah — Mishnah Berurah page (six texts)
// ─────────────────────────────────────────────────────────────────────────────

export const MISHNAH_BERURAH_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'mishnah-berurah',
    name: 'Mishnah Berurah',
    nameHe: 'משנה ברורה',
    description:
      'Mishnah Berurah page — DISTINCT from the generic Shulchan Aruch layout (central column surrounded by commentaries): the Shulchan Aruch + Rema text sits at the TOP of the page, and UNDERNEATH it Mishnah Berurah, Biur Halacha, Be\u2019er Heitev and Shaarei Teshuvah, with Sha\u2019ar HaTziyun as the footnote band at the foot — six texts total, each in its own width / font / size. Numbered se\u2019if katan (ס״ק) markers run through the Mishnah Berurah. Biur Halacha entries open with a dibbur hamatchil (ד״ה).',
    descriptionHe: 'שולחן ערוך עם הרמ״א בראש העמוד, ומתחתיהם משנה ברורה, ביאור הלכה ושער הציון — ובנוסף באר היטב ושערי תשובה; שישה טקסטים, עם סימני סעיף קטן ממוספרים.',
    genre: ['halakha', 'mishnah berurah', 'משנה ברורה', 'biur halacha', 'ביאור הלכה', "sha'ar hatziyun", 'שער הציון'],
    origin: 'Mishnah Berurah editions (standard: SA + Rema with MB, Biur Halacha and Sha\u2019ar HaTziyun)',
    sourceRef: 'RESEARCH-NOTE.md §8',
  },
  regions: [
    rect('header', 0, 0, 100, 4, {
      labelHe: 'כותרת — אורח חיים, סימן',
      labelEn: 'Header — Orach Chaim, siman',
    }),
    rect('main_text', 0, 5, 100, 18, {
      id: 'shulchan-aruch-text',
      labelHe: 'שולחן ערוך עם הגהת הרמ״א',
      labelEn: 'Shulchan Aruch + Rema',
      fontSizePt: 13,
      lineHeight: 1.3,
    }),
    rect('commentary_1', 0, 24, 100, 28, {
      labelHe: 'משנה ברורה',
      labelEn: 'Mishnah Berurah',
      namedCommentary: 'Mishnah Berurah (Chafetz Chaim) — numbered se\u2019if katan (ס״ק)',
      fontSizePt: 11,
      lineHeight: 1.3,
    }),
    rect('commentary_2', 0, 53, 48, 18, {
      labelHe: 'ביאור הלכה',
      labelEn: 'Biur Halacha',
      namedCommentary: 'Biur Halacha — opens with dibbur hamatchil (ד״ה)',
      fontSizePt: 10.5,
      lineHeight: 1.3,
    }),
    rect('commentary_3', 52, 53, 48, 18, {
      labelHe: 'באר היטב',
      labelEn: 'Be\u2019er Heitev',
      namedCommentary: 'Be\u2019er Heitev',
      fontSizePt: 10,
      lineHeight: 1.25,
    }),
    rect('commentary_4', 0, 72, 100, 16, {
      labelHe: 'שערי תשובה',
      labelEn: 'Shaarei Teshuvah',
      namedCommentary: 'Shaarei Teshuvah',
      fontSizePt: 10,
      lineHeight: 1.25,
    }),
    // Sha'ar HaTziyun is the footnote band.
    rect('footnote', 0, 89, 100, 8, {
      id: 'shaar-hatziyun',
      labelHe: 'שער הציון',
      labelEn: 'Sha\u2019ar HaTziyun',
      namedCommentary: 'Sha\u2019ar HaTziyun — the footnote band of the Mishnah Berurah page',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'commentary_1', childTier: 'commentary_2', anchor: 'dibbur', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    dibbur: { weight: 700, brackets: 'square', separator: 'ד״ה' },
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13,
    commentaryFontSizePt: 11,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'two_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// aruch-hashulchan — Aruch HaShulchan (prose code, no flanks)
// ─────────────────────────────────────────────────────────────────────────────

export const ARUCH_HASHULCHAN_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'aruch-hashulchan',
    name: 'Aruch HaShulchan',
    nameHe: 'ערוך השולחן',
    description:
      'Aruch HaShulchan: a single running column following the Tur / Shulchan Aruch simanim — the simanim match, the se\u2019ifim do NOT match the Shulchan Aruch — with sources cited inline from the Gemara and the Rambam. No surrounding commentaries: a prose code, not a flanked folio.',
    descriptionHe: 'טור רץ אחד לפי סימני הטור והשולחן ערוך, עם מקורות מצוטטים מהגמרא ומהרמב״ם בתוך הטקסט; אין מפרשים מסביב.',
    genre: ['halakha', 'aruch hashulchan', 'aruch ha-shulchan', 'ערוך השלחן', 'ערוך השולחן'],
    origin: 'Aruch HaShulchan (first edition 1884–93; Oz VeHadar 2006)',
    sourceRef: 'RESEARCH-NOTE.md §9',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — סימן',
      labelEn: 'Header — siman',
    }),
    rect('main_text', 0, 6, 100, 80, {
      labelHe: 'ערוך השולחן',
      labelEn: 'Aruch HaShulchan',
      fontSizePt: 13.5,
      lineHeight: 1.32,
    }),
    rect('footnote', 0, 87, 100, 10, {
      labelHe: 'מקורות',
      labelEn: 'Sources',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'first-line', amountPt: 14 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 10,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// tur — Arba'ah Turim
// ─────────────────────────────────────────────────────────────────────────────

export const TUR_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'tur',
    name: 'Arba’ah Turim',
    nameHe: 'ארבעה טורים',
    description:
      'Arba\u2019ah Turim: the Tur text in the central column; the Bach in the full-height right flank, Drishah and Prishah stacked in the left flank, and Beit Yosef as the lower band. Structure is the four turim → simanim → se\u2019ifim. A bare \'tur\' / \'טור\' hint alone is weak for classification (see RESEARCH-NOTE.md) — it needs a Tur commentary marker; \'ב״ח\' alone is also Hagahot ha-Bach and needs a Tur marker too.',
    descriptionHe: 'טקסט הטור במרכז, בית יוסף ברצועה התחתונה, והב״ח עם דרישה ופרישה כמפרשים צדדיים.',
    genre: ['halakha', 'tur', 'טור', 'arbah turim', 'ארבעה טורים', 'drishah', 'דרישה', 'prishah', 'פרישה', 'bach', 'ב״ח'],
    origin: 'Arba\u2019ah Turim editions (Tur with Bach, Drishah, Prishah, Beit Yosef)',
    sourceRef: 'RESEARCH-NOTE.md §10',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — טור, סימן',
      labelEn: 'Header — tur, siman',
    }),
    rect('main_text', 32, 6, 36, 68, {
      id: 'tur-text',
      labelHe: 'טור',
      labelEn: 'Tur',
      fontSizePt: 13.5,
      lineHeight: 1.3,
    }),
    rect('commentary_1', 70, 6, 30, 68, {
      side: 'right',
      labelHe: 'בית חדש — ב״ח',
      labelEn: 'Bach (Bayit Chadash)',
      namedCommentary: 'Bach — Bayit Chadash (R. Yoel Sirkis)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_2', 0, 6, 30, 34, {
      side: 'left',
      labelHe: 'דרישה',
      labelEn: 'Drishah',
      namedCommentary: 'Drishah (R. Yehoshua Falk)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_3', 0, 41, 30, 33, {
      side: 'left',
      labelHe: 'פרישה',
      labelEn: 'Prishah',
      namedCommentary: 'Prishah (R. Yehoshua Falk)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_4', 0, 75, 100, 13, {
      labelHe: 'בית יוסף',
      labelEn: 'Beit Yosef',
      namedCommentary: 'Beit Yosef (R. Yosef Karo) — the lower band',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('footnote', 0, 89, 100, 8, {
      labelHe: 'הערות ומקורות',
      labelEn: 'Notes and sources',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'commentary_4', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 10,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 240,
    heightMm: 340,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'two_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// kitzur-shulchan-aruch — Kitzur Shulchan Aruch
// ─────────────────────────────────────────────────────────────────────────────

export const KITZUR_SHULCHAN_ARUCH_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'kitzur-shulchan-aruch',
    name: 'Kitzur Shulchan Aruch',
    nameHe: 'קיצור שולחן ערוך',
    description:
      'Kitzur Shulchan Aruch: a single column of short practical paragraphs, numbered by siman and se\u2019if, with first-line indents — a prose code for daily use.',
    descriptionHe: 'טור יחיד, סימן וסעיף ממוספרים, פסקאות מעשיות קצרות.',
    genre: ['halakha', 'kitzur', 'קיצור', 'kitzur shulchan aruch', 'קיצור שולחן ערוך'],
    origin: 'Kitzur Shulchan Aruch (R. Shlomo Ganzfried) — single-column prose code',
    sourceRef: 'RESEARCH-NOTE.md §11',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — סימן',
      labelEn: 'Header — siman',
    }),
    rect('main_text', 0, 6, 100, 80, {
      labelHe: 'קיצור שולחן ערוך',
      labelEn: 'Kitzur Shulchan Aruch',
      fontSizePt: 13.5,
      lineHeight: 1.32,
    }),
    rect('footnote', 0, 87, 100, 10, {
      labelHe: 'הערות',
      labelEn: 'Notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'first-line', amountPt: 14 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 10,
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'numbers',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// chumash — Chumash (verse + Targum Onkelos + Rashi)
// ─────────────────────────────────────────────────────────────────────────────

export const CHUMASH_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'chumash',
    name: 'Chumash with Targum and Rashi',
    nameHe: 'חומש עם תרגום ורש״י',
    description:
      'Chumash: simpler than Mikraot Gedolot — the verse in large type across the top of the page, Targum Onkelos directly below it, and Rashi in a column beneath. The common printed Chumash. A bare \'chumash\' hint alone is weak for classification (see RESEARCH-NOTE.md) — it needs a verse or a Targum / Rashi marker.',
    descriptionHe: 'פסוק באות גדולה בראש העמוד, תרגום אונקלוס לצידו או מתחתיו, ורש״י בטור מתחת.',
    genre: ['tanach', 'chumash', 'חומש', 'targum onkelos', 'onkelos', 'אונקלוס'],
    origin: 'Traditional printed Chumash (verse + Targum Onkelos + Rashi)',
    sourceRef: 'RESEARCH-NOTE.md §12',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — ספר ופרשה',
      labelEn: 'Header — book and parsha',
    }),
    rect('main_text', 0, 6, 100, 20, {
      labelHe: 'פסוק',
      labelEn: 'Verse',
      fontSizePt: 16,
      lineHeight: 1.35,
    }),
    rect('commentary_1', 0, 27, 100, 10, {
      labelHe: 'תרגום אונקלוס',
      labelEn: 'Targum Onkelos',
      namedCommentary: 'Targum Onkelos',
      fontSizePt: 11,
      lineHeight: 1.32,
    }),
    rect('commentary_2', 0, 38, 100, 50, {
      labelHe: 'רש״י',
      labelEn: 'Rashi',
      namedCommentary: 'Rashi',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('footnote', 0, 89, 100, 8, {
      labelHe: 'הערות',
      labelEn: 'Notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'lineIndex', overflow: 'next-folio' },
    { parentTier: 'commentary_1', childTier: 'commentary_2', anchor: 'none', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 16,
    commentaryFontSizePt: 10.5,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'mikraot_gedolot',
};

// ─────────────────────────────────────────────────────────────────────────────
// tanach-commentary — Nevi'im / Ketuvim with commentaries
// ─────────────────────────────────────────────────────────────────────────────

export const TANACH_COMMENTARY_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'tanach-commentary',
    name: 'Nevi’im / Ketuvim with Commentaries',
    nameHe: 'נביאים וכתובים עם מפרשים',
    description:
      'Nevi\u2019im / Ketuvim with commentaries: the verse at the top of the page, Metzudat David and Metzudat Tzion in the right-hand column and Radak in the left-hand column below it, and the Malbim in a band along the foot of the page.',
    descriptionHe: 'פסוק בראש העמוד, מצודת דוד / מצודת ציון ורד״ק בשני טורים מתחת, ומלבי״ם ברצועה.',
    genre: ['tanach', 'metzudot', 'מצודות', 'radak', 'רד״ק', 'malbim', 'מלבי״ם', "nevi'im", 'נביאים', 'ketuvim', 'כתובים'],
    origin: 'Traditional Tanach-with-commentaries editions (Metzudot, Radak, Malbim)',
    sourceRef: 'RESEARCH-NOTE.md §13',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — ספר ופרק',
      labelEn: 'Header — book and chapter',
    }),
    rect('main_text', 0, 6, 100, 18, {
      labelHe: 'פסוק',
      labelEn: 'Verse',
      fontSizePt: 15,
      lineHeight: 1.35,
    }),
    rect('commentary_1', 52, 25, 48, 40, {
      side: 'right',
      labelHe: 'מצודת דוד / מצודת ציון',
      labelEn: 'Metzudat David / Metzudat Tzion',
      namedCommentary: 'Metzudot (R. David Altschuler and son)',
      fontSizePt: 10.5,
      lineHeight: 1.32,
    }),
    rect('commentary_2', 0, 25, 48, 40, {
      side: 'left',
      labelHe: 'רד״ק',
      labelEn: 'Radak',
      namedCommentary: 'Radak (R. David Kimchi)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('commentary_3', 0, 66, 100, 22, {
      labelHe: 'מלבי״ם',
      labelEn: 'Malbim',
      namedCommentary: 'Malbim (R. Meir Leibush)',
      fontSizePt: 10,
      lineHeight: 1.3,
    }),
    rect('footnote', 0, 89, 100, 8, {
      labelHe: 'הערות',
      labelEn: 'Notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'lineIndex', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'commentary_3', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'second-line', amountPt: 10 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 15,
    commentaryFontSizePt: 10.5,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'mikraot_gedolot',
};

// ─────────────────────────────────────────────────────────────────────────────
// midrash — Midrash Rabbah / Tanchuma
// ─────────────────────────────────────────────────────────────────────────────

export const MIDRASH_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'midrash',
    name: 'Midrash Rabbah / Tanchuma',
    nameHe: 'מדרש רבה / תנחומא',
    description:
      'Midrash Rabbah / Tanchuma: the verse lemma in BOLD at the top of each unit (a bold lemma, not a dibbur hamatchil — the recipe carries no dibbur rule), and the midrashic exposition in a single column below it; "דבר אחר" and "ר׳ ... אמר" lemma markers open sections as heads, and parashah headings are centred. There is NO footnote band on a Midrash page (recorded, not faked).',
    descriptionHe: 'פסוק פתיחה מודגש בראש כל יחידה, ומתחתיו דרשה בטור יחיד; ״דבר אחר״ ו״ר׳ ... אמר״ ככותרות, וכותרות פרשה ממורכזות.',
    genre: ['midrash', 'מדרש', 'midrash rabbah', 'מדרש רבה', 'tanchuma', 'תנחומא', 'davar acher', 'דבר אחר'],
    origin: 'Traditional Midrash Rabbah / Tanchuma editions (single-column exposition)',
    sourceRef: 'RESEARCH-NOTE.md §14',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — פרשה',
      labelEn: 'Header — parasha',
    }),
    // Verse lemma at the top of each unit (bold by convention —
    // the lemma box is the first main-text box in fill order).
    rect('main_text', 0, 6, 100, 10, {
      id: 'midrash-lemma',
      labelHe: 'פסוק — דברי הפתיחה',
      labelEn: 'Verse lemma',
      fontSizePt: 14.5,
      lineHeight: 1.3,
    }),
    rect('main_text', 0, 17, 100, 71, {
      id: 'midrash-exposition',
      labelHe: 'מדרש',
      labelEn: 'Midrashic exposition',
      fontSizePt: 13.5,
      lineHeight: 1.35,
    }),
  ],
  // No flow bindings: the two main-text boxes are one stream (a
  // tier cannot flow into itself), and there is no footnote band.
  flow: [],
  typography: {
    // No dibbur: the bold verse lemma is not a dibbur hamatchil.
    indentation: { mode: 'first-line', amountPt: 12 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 10,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// ein-yaakov — Ein Yaakov
// ─────────────────────────────────────────────────────────────────────────────

export const EIN_YAAKOV_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'ein-yaakov',
    name: 'Ein Yaakov',
    nameHe: 'עין יעקב',
    description:
      'Ein Yaakov: the aggadic selections from the Talmud in a single column, with the commentary below each selection; headings per sugya.',
    descriptionHe: 'קטעי אגדה מהתלמוד בטור יחיד, עם באור מתחת לכל קטע וכותרות לכל סוגיה.',
    genre: ['talmud', 'aggadah', 'ein yaakov', 'עין יעקב'],
    origin: 'Ein Yaakov editions (aggadic selections with commentary)',
    sourceRef: 'RESEARCH-NOTE.md §15',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — מסכת',
      labelEn: 'Header — tractate',
    }),
    rect('main_text', 0, 6, 100, 50, {
      id: 'aggadah-text',
      labelHe: 'אגדה',
      labelEn: 'Aggadic selection',
      fontSizePt: 14,
      lineHeight: 1.32,
    }),
    rect('commentary_1', 0, 57, 100, 31, {
      labelHe: 'פירוש',
      labelEn: 'Commentary',
      namedCommentary: 'Ein Yaakov commentary on the aggadic selection',
      fontSizePt: 11,
      lineHeight: 1.32,
    }),
    rect('footnote', 0, 89, 100, 8, {
      labelHe: 'הערות',
      labelEn: 'Notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'commentary_1', anchor: 'heading', overflow: 'next-folio' },
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'first-line', amountPt: 12 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 14,
    commentaryFontSizePt: 11,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// mussar — Mussar (Mesillat Yesharim, Chovot HaLevavot, Orchos Tzaddikim)
// ─────────────────────────────────────────────────────────────────────────────

export const MUSSAR_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'mussar',
    name: 'Mussar Sefer',
    nameHe: 'ספר מוסר',
    description:
      'Mussar sefer (Mesillat Yesharim, Chovot HaLevavot, Orchos Tzaddikim): systematic prose in two justified columns, chapter / sha\u2019ar headings centred, first-line indents. Often vowelized (nikud) — a text property, not layout geometry, recorded here rather than modelled. Chovot HaLevavot has 10 gates (she\u2019arim). No dibbur — chapter headings only.',
    descriptionHe: 'פרוזה שיטתית בטור יחיד, כותרות פרקים ושערים ממורכזות, לרוב מנוקדת.',
    genre: ['mussar', 'מוסר', 'mesillat yesharim', 'מסילת ישרים', 'chovot halevavot', 'חובות הלבבות', 'orchos tzaddikim', 'אורחות צדיקים'],
    origin: 'Traditional Mussar editions (single-column prose)',
    sourceRef: 'RESEARCH-NOTE.md §16',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — פרק / שער',
      labelEn: 'Header — chapter / gate',
    }),
    rect('main_text', 0, 6, 100, 80, {
      labelHe: 'מוסר',
      labelEn: 'Mussar text',
      fontSizePt: 13.5,
      lineHeight: 1.4,
    }),
    rect('footnote', 0, 87, 100, 10, {
      labelHe: 'הערות',
      labelEn: 'Notes',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'first-line', amountPt: 14 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 10,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'hebrew-letters',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  // Layout training T8 — the user's reference page (Mesilat Yesharim):
  // two justified columns under a full-width perek opening.
  baseLayout: 'two_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// tanya — Tanya (Likutei Amarim)
// ─────────────────────────────────────────────────────────────────────────────

export const TANYA_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'tanya',
    name: 'Tanya (Likutei Amarim)',
    nameHe: 'תניא — ליקוטי אמרים',
    description:
      'Tanya (Likutei Amarim): 53 chapters of dense single-column prose, chapter headings centred, a footnote band for sources. Igeret HaTeshuvah and Igeret HaKodesh are the later sections of the same book (same geometry). No dibbur — chapter headings only.',
    descriptionHe: 'חמישים ושלושה פרקים של פרוזה צפופה בטור יחיד, כותרות פרקים ממורכזות, ורצועת הערות למקורות.',
    genre: ['chassidut', 'tanya', 'תניא', 'likutei amarim', 'ליקוטי אמרים', 'igeret hateshuvah', 'אגרת התשובה'],
    origin: 'Tanya editions (Likutei Amarim, 53 chapters)',
    sourceRef: 'RESEARCH-NOTE.md §17',
  },
  regions: [
    rect('header', 0, 0, 100, 5, {
      labelHe: 'כותרת — פרק',
      labelEn: 'Header — chapter',
    }),
    rect('main_text', 0, 6, 100, 78, {
      labelHe: 'תניא',
      labelEn: 'Tanya text',
      fontSizePt: 13,
      lineHeight: 1.3,
    }),
    rect('footnote', 0, 85, 100, 12, {
      labelHe: 'מקורות',
      labelEn: 'Sources',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'footnote', anchor: 'heading', overflow: 'next-folio' },
  ],
  typography: {
    indentation: { mode: 'first-line', amountPt: 12 },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13,
    commentaryFontSizePt: 10,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    chapterBanner: true,
    folioStyle: 'numbers',
    folioPosition: 'outer-top',
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 12,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 12,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// machzor — Machzor (Rosh Hashanah / Yom Kippur)
// ─────────────────────────────────────────────────────────────────────────────

export const MACHZOR_RECIPE: LayoutRecipe = {
  keterTemplateVersion: KETER_TEMPLATE_VERSION,
  metadata: {
    id: 'machzor',
    name: 'Machzor',
    nameHe: 'מחזור',
    description:
      'Machzor (Rosh Hashanah / Yom Kippur): a LARGER format than a weekday siddur, a single column of prayer text with a centred running header naming the service, folio numbers at the outer top corners, and a marginal strip for notes. Piyyutim take a distinct indented verse style with refrains centred; selichot and Ne\u2019ilah are separate sections. The acrostic layout of piyyutim is NOT modelled — piyyutim get the indented-verse treatment the engine supports, recorded honestly here. A bare \'rosh hashanah\' / \'yom kippur\' hint alone is weak for classification (see RESEARCH-NOTE.md) — it needs a prayer marker.',
    descriptionHe: 'מחזור לראש השנה ויום כיפור: פורמט גדול מספר תפילה יומיומי, פיוטים בסגנון מובלט עם פזמונים ממורכזים, סליחות ונעילה כחלקים נפרדים.',
    genre: ['siddur', 'prayer', 'machzor', 'מחזור', 'selichot', 'סליחות', "ne'ilah", 'נעילה', 'piyyut', 'פיוט', 'rosh hashanah', 'ראש השנה', 'yom kippur', 'יום כיפור'],
    origin: 'Traditional machzor layout (larger-format single-column prayer text)',
    sourceRef: 'RESEARCH-NOTE.md §18',
  },
  // No header BOX, like the siddur: the running header is a
  // header/footer rule naming the service, so the section headings
  // stay in the main-text flow (centred), where they belong.
  regions: [
    rect('main_text', 0, 5, 88, 88, {
      labelHe: 'תפילה ופיוט',
      labelEn: 'Prayer and piyyut text',
      fontSizePt: 13.5,
      lineHeight: 1.4,
    }),
    rect('marginal', 90, 5, 10, 88, {
      side: 'outside',
      labelHe: 'הערות שוליים / מקורות',
      labelEn: 'Marginal notes / sources',
      fontSizePt: 9,
      lineHeight: 1.25,
    }),
  ],
  flow: [
    { parentTier: 'main_text', childTier: 'marginal', anchor: 'none', overflow: 'outer-margin' },
  ],
  typography: {
    indentation: { mode: 'none' },
    justification: { expansion: 'kashya' },
    mainFontSizePt: 13.5,
    commentaryFontSizePt: 9,
    headingAlignment: 'center',
  },
  headerFooter: {
    invocation: 'בס״ד',
    runningHeaderText: 'ראש השנה',
    runningHeaderAlignment: 'center',
    folioStyle: 'numbers',
    folioPosition: 'outer-top',
    showDafPrefix: false,
  },
  page: {
    widthMm: 170,
    heightMm: 240,
    marginTopMm: 10,
    marginBottomMm: 12,
    marginInsideMm: 12,
    marginOutsideMm: 14,
  },
  baseLayout: 'single_column',
};

// ─────────────────────────────────────────────────────────────────────────────
// Library
// ─────────────────────────────────────────────────────────────────────────────

/** All library recipes, aliases included (28 entries: 27 real recipes + the vilna-shas alias). */
export const HISTORICAL_LAYOUTS: LayoutRecipe[] = [
  TALMUD_BAVLI_RECIPE,
  VILNA_SHAS_RECIPE,
  MIKRAOT_GEDOLOT_RECIPE,
  SHULCHAN_ARUCH_RECIPE,
  CHUMASH_RISHONIM_RECIPE,
  RESPONSA_RECIPE,
  CHASSIDIC_DRUSH_RECIPE,
  YIDDISH_SEFER_RECIPE,
  TZENERENE_RECIPE,
  MACHON_EDITION_RECIPE,
  SIDDUR_RECIPE,
  // v0.9.3 Part A.
  SHAS_OZ_VEHADAR_RECIPE,
  SHAS_ARTSCROLL_RECIPE,
  SHAS_STEINZALTZ_RECIPE,
  YERUSHALMI_RECIPE,
  MISHNAH_CLASSIC_RECIPE,
  MISHNAH_KEHATI_RECIPE,
  MISHNEH_TORAH_RECIPE,
  MISHNAH_BERURAH_RECIPE,
  ARUCH_HASHULCHAN_RECIPE,
  TUR_RECIPE,
  KITZUR_SHULCHAN_ARUCH_RECIPE,
  CHUMASH_RECIPE,
  TANACH_COMMENTARY_RECIPE,
  MIDRASH_RECIPE,
  EIN_YAAKOV_RECIPE,
  MUSSAR_RECIPE,
  TANYA_RECIPE,
  MACHZOR_RECIPE,
];

export const HISTORICAL_RECIPE_IDS: string[] = HISTORICAL_LAYOUTS.map(r => r.metadata.id);

/** The library entry as listed (an alias entry is returned as-is). */
export function getHistoricalRecipe(id: string): LayoutRecipe | undefined {
  return HISTORICAL_LAYOUTS.find(r => r.metadata.id === id);
}

/**
 * Follows `aliasOf` (cycle-guarded) and returns the recipe that carries
 * geometry. Returns undefined for an unknown id or an alias cycle.
 */
export function resolveHistoricalRecipe(id: string): LayoutRecipe | undefined {
  const seen = new Set<string>();
  let current = getHistoricalRecipe(id);
  while (current?.aliasOf) {
    if (seen.has(current.metadata.id)) return undefined;
    seen.add(current.metadata.id);
    current = getHistoricalRecipe(current.aliasOf);
    if (!current) return undefined;
  }
  return current;
}

/** Every library recipe, resolved (aliases replaced by their target). */
export function listHistoricalRecipes(): LayoutRecipe[] {
  const out: LayoutRecipe[] = [];
  for (const r of HISTORICAL_LAYOUTS) {
    const resolved = resolveHistoricalRecipe(r.metadata.id);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

/** True when every library entry (aliases included) validates. */
export function validateHistoricalLibrary(): Array<{ id: string; errors: string[] }> {
  return HISTORICAL_LAYOUTS.map(r => ({ id: r.metadata.id, errors: validateRecipe(r) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// v0.9.9 (I2) — Vilna preset enrichment (ADDITIVE).
//
// The `LayoutRecipe` shape itself is untouched (no restructuring of the
// library): the Vilna preset data for each Shas recipe lives in this
// companion map, keyed by recipe id, and `vilnaPresetForRecipe`
// resolves aliases ('vilna-shas' → 'talmud-bavli') the same way
// `resolveHistoricalRecipe` does. Callers that already hold a recipe
// keep working unchanged; callers that want the Vilna preset values
// (folio start, streams, separators, chalon, marginal slots) read them
// here and apply them through `vilnaPresetToDesignPatch`.
// ─────────────────────────────────────────────────────────────────────────────

/** Oz VeHadar: same folio, expanded outer-margin commentary set enabled. */
export const VILNA_SHAS_OZ_VEHADAR_PRESET: VilnaShasPresetData = {
  ...VILNA_SHAS_PRESET,
  id: 'vilna-shas-oz-vehadar',
  nameHe: 'ש״ס וילנא — עוז והדר',
  nameEn: 'Vilna Shas — Oz VeHadar',
  marginalSlots: VILNA_SHAS_PRESET.marginalSlots.map(s =>
    s.kind === 'rabbeinu_chananel' || s.kind === 'ran' || s.kind === 'maharsha'
      ? { ...s, enabledByDefault: true }
      : s
  ),
};

/** ArtScroll Schottenstein: larger 9"×12" (229×305 mm) page, larger Gemara. */
export const VILNA_SHAS_ARTSCROLL_PRESET: VilnaShasPresetData = {
  ...VILNA_SHAS_PRESET,
  id: 'vilna-shas-artscroll',
  nameHe: 'ש״ס וילנא — ארטסקרול',
  nameEn: 'Vilna Shas — ArtScroll',
  page: { ...VILNA_SHAS_PRESET.page, widthMm: 229, heightMm: 305 },
  streams: VILNA_SHAS_PRESET.streams.map(s =>
    s.id === 'gemara' ? { ...s, fontSizePt: 16 } : s
  ),
};

/** Steinsaltz: same folio; the explanatory-notes band is on by default. */
export const VILNA_SHAS_STEINZALTZ_PRESET: VilnaShasPresetData = {
  ...VILNA_SHAS_PRESET,
  id: 'vilna-shas-steinzaltz',
  nameHe: 'ש״ס וילנא — שטיינזלץ',
  nameEn: 'Vilna Shas — Steinsaltz',
  marginalSlots: VILNA_SHAS_PRESET.marginalSlots.map(s =>
    s.kind === 'gilyon_hashas' ? { ...s, enabledByDefault: true } : s
  ),
};

/** Vilna preset data per Shas recipe id (aliases resolve to their base). */
export const VILNA_PRESET_BY_RECIPE: Record<string, VilnaShasPresetData> = {
  'talmud-bavli': VILNA_SHAS_PRESET,
  'vilna-shas': VILNA_SHAS_PRESET,
  'shas-oz-vehadar': VILNA_SHAS_OZ_VEHADAR_PRESET,
  'shas-artscroll': VILNA_SHAS_ARTSCROLL_PRESET,
  'shas-steinzaltz': VILNA_SHAS_STEINZALTZ_PRESET,
};

/**
 * Vilna preset data for a recipe id, following aliases
 * ('vilna-shas' → the 'talmud-bavli' preset). Undefined for recipes
 * that are not a Vilna Shas folio.
 */
export function vilnaPresetForRecipe(recipeId: string): VilnaShasPresetData | undefined {
  const direct = VILNA_PRESET_BY_RECIPE[recipeId];
  if (direct) return direct;
  const resolved = resolveHistoricalRecipe(recipeId);
  if (!resolved) return undefined;
  return VILNA_PRESET_BY_RECIPE[resolved.metadata.id];
}
// ─────────────────────────────────────────────────────────────────────────────
// Unified recipe catalogue (v0.9.5) — ONE source of truth
// ─────────────────────────────────────────────────────────────────────────────
// Before v0.9.5 these tables lived in three places: the rules +
// alias tables in auto-layout.ts, the v0.9.3 alias table + the v0.9.3
// adapter name/summary copies also in auto-layout.ts, and the
// real names/descriptions in the Part A recipe metadata in this file —
// with the adapter copying summaries onto Part A entries at build time.
// They now live here, next to the library they describe, and
// auto-layout.ts reads them. Nothing in them is geometry: the rules are
// human-readable deterministic guidance for the Gemini prompt context,
// the aliases are NL names for findRecipeByName. Every library id
// (real recipes + the vilna-shas / tzenerene aliases) has a rules entry
// and an alias entry.
/**
 * Deterministic rules per recipe (v0.9.0 Part C's rule text, kept
 * verbatim; v0.9.5 adds the three v0.9.0 recipes that had none and the
 * tzenerene alias, which shares yiddish-sefer's rules — same layout).
 */
export const HISTORICAL_RECIPE_RULES: Record<string, string[]> = {

  'vilna-shas': ['Rashi always INNER, Tosafot always OUTER (mirrored per facing page)', 'Perek title centred', 'Second-row (hanging) indent on Gemara', 'Dibbur hamatchil bold + linked to Gemara', 'Folio numbers in Hebrew gematria (2a left, 2b right)'],
  'mikraot-gedolot': ['Verse + Targum Onkelos on top', 'Commentary tiers below, up to 6 (Rashi, Ibn Ezra, Ramban, Sforno, …)', 'Tier grid balanced with gutter scaling', 'Taamim preserved on verses'],
  'shulchan-aruch': ['Siman / seif central text', 'Commentary columns around it (Magen Avraham, Taz, Mishnah Berurah, …)', 'Each commentary column has its own running header'],
  responsa: ['Question (she\'elah) then answer (teshuvah)', 'Siman banner at the top', 'Single running column'],
  'chassidic-drush': ['Two justified columns', 'Body in Rashi script; opening words bold, square letters', 'No first-line indent', 'Parsha / section headings centred inside the column', 'Hebrew-letter folio'],
  'yiddish-sefer': ['Hebrew source facing Yiddish text', 'Yiddish digraphs (װ ױ ײ) preserved', 'Tzenerene (Tzena Urena) structure'],
  'machon-edition': ['Clean modern single column', 'Running headers with chapter titles', 'Footnotes at the bottom of the page'],
  // v0.9.3 Part C — rules for the 18 new recipes (RESEARCH-NOTE.md).
  // Honest limits are recorded in the rules themselves (facing page /
  // vowelization / acrostic), never faked as geometry the engine applies.
  'shas-oz-vehadar': ['Same Tzuras HaDaf geometry as Vilna (Gemara centre, Rashi inner, Tosafot outer)', 'Expanded outer-margin commentary set', 'Marginalia / cross-reference strip', 'Variant-readings footnote band', 'Dibbur hamatchil bold'],
  'shas-artscroll': ['Vilna folio, vowelized and punctuated Gemara and Rashi', 'Rashi headings bold', 'Larger page (9"x12" / 229x305mm)', 'Facing English elucidation page is NOT modelled — Hebrew page only'],
  'shas-steinzaltz': ['Vilna folio with vowels and punctuation throughout', 'Explanatory notes in the margin band', 'Dibbur hamatchil bold'],
  yerushalmi: ['Folio has FOUR sub-pages (a/b/c/d) — two columns per side', 'Citations by tractate / chapter / halakha, not daf-amud', 'Pnei Moshe surrounding (Rashi role)', 'Korban HaEdah and Ridvaz as further tiers', 'Folio style yerushalmi-abcd'],
  'mishnah-classic': ['Mishnah text in larger type at top / centre', 'Bartenura directly below in smaller type', 'Tosafot Yom Tov (Ikar in compact printings) as gloss tier', 'Structure: seder / masechet / perek / mishnah'],
  'mishnah-kehati': ['One mishnah + its modern-Hebrew explanation as a unit', 'Tractate introduction page', 'Thematic intro before each mishnah', 'Bartenura also printed', 'Single column, generous leading, first-line indents'],
  'mishneh-torah': ['14 sefarim → chapters (halachot) → paragraphs', 'Rambam text in the central column', 'Raavad glosses interspersed in the text', 'Kesef Mishneh + Maggid Mishneh as flanking columns', 'Lechem Mishneh + Hagahot Maimuniyot in the lower band'],
  'mishnah-berurah': ['Shulchan Aruch + Rema text at the TOP of the page', 'Mishnah Berurah, Biur Halacha and Shaar HaTziyun underneath', "Be'er Heitev and Shaarei Teshuvah — six texts total", 'Numbered seif katan (ס״ק) markers in the Mishnah Berurah'],
  'aruch-hashulchan': ['Single running column following Tur / Shulchan Aruch simanim', 'Sources cited inline from Gemara and Rambam', 'No surrounding commentaries — prose code', 'First-line indents'],
  tur: ['Tur text in the centre', 'Bach + Drishah / Prishah as flanking commentaries', 'Beit Yosef as lower band', 'Structure: 4 turim → simanim → seifim'],
  'kitzur-shulchan-aruch': ['Single column, numbered siman / seif', 'Short practical paragraphs', 'First-line indents'],
  chumash: ['Verse in large type across the top', 'Targum Onkelos beside / below the verse', 'Rashi in a column beneath'],
  'tanach-commentary': ['Verse on top', 'Metzudat David / Metzudat Tzion + Radak in two columns below', 'Malbim band'],
  midrash: ['Verse lemma in bold at the top of each unit', 'Midrashic exposition in a single column below', '"דבר אחר" / "ר׳ ... אמר" lemma markers as section heads', 'Parashah headings centred', 'No footnote band'],
  'ein-yaakov': ['Aggadic selections from the Talmud in a single column', 'Commentary below each selection', 'Headings per sugya'],
  mussar: ['Single-column systematic prose', 'Chapter / shaar headings centred', 'Often vowelized (nikud)', 'First-line indents', 'No dibbur — chapter headings only'],
  tanya: ['53 chapters of dense single-column prose', 'Chapter headings centred', 'Footnote band for sources', 'Igeret HaTeshuvah and Igeret HaKodesh as later sections'],
  machzor: ['Larger format than a weekday siddur', 'Piyyutim in a distinct indented style, refrains centred', 'Selichot and Neilah as separate sections', 'Running header names the service', 'Acrostic layout is NOT modelled — piyyutim get indented-verse treatment'],
  // v0.9.5 — the three v0.9.0 recipes that had no rules entry (their
  // entries resolve through the same table now), plus the tzenerene
  // alias (same rules as yiddish-sefer — same layout). talmud-bavli's
  // rules are vilna-shas's rules verbatim: the same folio.
  'talmud-bavli': ['Rashi always INNER, Tosafot always OUTER (mirrored per facing page)', 'Perek title centred', 'Second-row (hanging) indent on Gemara', 'Dibbur hamatchil bold + linked to Gemara', 'Folio numbers in Hebrew gematria (2a left, 2b right)'],
  'chumash-rishonim': ['The verse in large type across the top', 'Rashi and Ramban in two columns below it', 'Ibn Ezra and Sforno in the lower band'],
  siddur: ['A single column of prayer text', 'Centred running header at the top of each page', 'Folio numbers at the outer top corners', 'Nusach variants (Ashkenaz / Sefard / Edot HaMizrach / Ari / Teman) share this geometry — the difference is content order and kavanot, not layout'],
  tzenerene: ['Hebrew verse facing Yiddish text', 'Yiddish digraphs (װ ױ ײ) preserved', 'Tzenerene (Tzena Urena) structure'],
};

/**
 * NL name aliases per recipe (v0.9.0 Part C's lists + the v0.9.3 lists,
 * kept verbatim, merged into one table). Deliberate omissions, per the
 * research note's WEAK-hint rules — these must NOT decide alone:
 * - bare 'mishnah' / 'משנה' (no commentary marker) — stays with no match
 *   instead of guessing mishnah-classic;
 * - bare 'rosh hashanah' / 'yom kippur' (prayer markers required) — the
 *   machzor phrase is 'machzor for rosh hashanah', not the date alone;
 * - bare 'bach' / 'ב״ח' (also Hagahot ha-Bach on a Shas page) — the Tur
 *   phrase is 'tur with bach and drishah';
 * - bare English 'tur' — a 3-letter substring that also matches 'return'
 *   / 'structure' etc.; the Hebrew 'טור' and the long phrases cover it;
 * - bare 'chumash' stays with the existing 'chumash-rishonim' (a bare
 *   Chumash hint is weak; the new recipe needs Targum / Rashi present,
 *   as in 'chumash with targum and rashi').
 * Longest-alias-first matching (findRecipeByName) means the long contract
 * phrases always beat the short generic aliases above, e.g. 'kitzur
 * shulchan aruch' beats 'shulchan aruch', 'oz vehadar shas' beats 'shas'.
 */
export const HISTORICAL_RECIPE_ALIASES: Record<string, string[]> = {

  'vilna-shas': ['vilna shas', 'vilna', 'shas', 'tzurat hadaf', 'צורת הדף', 'ש״ס וילנא', 'שס וילנא', 'וילנא', 'talmud page', 'daf'],
  'mikraot-gedolot': ['mikraot gedolot', 'mikraot', 'מקראות גדולות', 'מקראות', 'chumash with commentaries'],
  'shulchan-aruch': ['shulchan aruch', 'shulchan arukh', 'שולחן ערוך', 'orach chaim', 'halakha'],
  responsa: ['responsa', 'responsum', 'teshuvot', 'teshuvos', 'שאלות ותשובות', 'שו״ת'],
  'chassidic-drush': ['chassidic drush', 'chassidic', 'drush', 'דרוש חסידי', 'חסידות'],
  'yiddish-sefer': ['yiddish', 'yiddish sefer', 'יידיש'],
  'machon-edition': ['machon', 'modern edition', 'simple book', 'plain book'],
  'talmud-bavli': ['talmud bavli', 'bavli', 'תלמוד בבלי', 'talmud', 'gemara', 'גמרא', 'תלמוד'],
  'chumash-rishonim': ['chumash', 'chumash with rishonim', 'חומש', 'rishonim'],
  siddur: ['siddur', 'prayer', 'tefillah', 'סידור', 'תפילה', 'mincha', 'shacharit'],
'shas-oz-vehadar': ['oz vehadar shas page', 'oz vehadar shas', 'oz vehadar', 'oz ve-hadar', 'עוז והדר', 'metivta', 'מטיבתא'],
  'shas-artscroll': ['artscroll schottenstein page', 'artscroll schottenstein', 'artscroll', 'schottenstein', 'ארטסקרול', 'שוטנשטיין'],
  'shas-steinzaltz': ['steinsaltz page', 'steinzaltz page', 'steinsaltz', 'steinzaltz', 'שטיינזלץ'],
  yerushalmi: ['yerushalmi page', 'yerushalmi', 'ירושלמי', 'pnei moshe', 'פני משה', 'korban haedah', 'קרבן העדה', 'ridvaz', 'רי״דב״ז'],
  'mishnah-classic': ['mishnah with bartenura', 'bartenura', 'ברטנורא', 'tosafot yom tov', 'תוספות יום טוב', 'tosafos yom tov', 'ikar tosefot'],
  'mishnah-kehati': ['kehati mishnah', 'kehati', 'קהתי'],
  'mishneh-torah': ['mishneh torah', 'משנה תורה', 'rambam', 'רמב״ם', 'kesef mishneh', 'כסף משנה', 'maggid mishneh', 'מגיד משנה', 'raavad', 'ראב״ד', 'lechem mishneh', 'לחם משנה'],
  'mishnah-berurah': ['mishnah berurah layout', 'mishnah berurah', 'משנה ברורה', 'biur halacha', 'ביאור הלכה', "sha'ar hatziyun", 'שער הציון'],
  'aruch-hashulchan': ['aruch hashulchan layout', 'aruch hashulchan', 'aruch ha-shulchan', 'ערוך השלחן', 'ערוך השולחן'],
  tur: ['tur with bach and drishah', 'tur with bach', 'arbah turim', 'ארבעה טורים', 'drishah', 'דרישה', 'prishah', 'פרישה', 'טור'],
  'kitzur-shulchan-aruch': ['kitzur shulchan aruch', 'kitzur', 'קיצור', 'קיצור שולחן ערוך'],
  chumash: ['chumash with targum and rashi', 'chumash with targum', 'targum onkelos', 'onkelos', 'אונקלוס'],
  'tanach-commentary': ["nevi'im with metzudot and radak", "nevi'im", 'נביאים', 'metzudot', 'מצודות', 'radak', 'רד״ק', 'malbim', 'מלבי״ם', 'ketuvim', 'כתובים'],
  midrash: ['midrash rabbah page', 'midrash rabbah', 'מדרש רבה', 'midrash', 'מדרש', 'tanchuma', 'תנחומא', 'davar acher', 'דבר אחר'],
  'ein-yaakov': ['ein yaakov', 'עין יעקב'],
  mussar: ['mussar sefer', 'mussar', 'מוסר', 'mesillat yesharim', 'מסילת ישרים', 'chovot halevavot', 'חובות הלבבות', 'orchos tzaddikim', 'אורחות צדיקים'],
  tanya: ['tanya layout', 'tanya', 'תניא', 'likutei amarim', 'ליקוטי אמרים', 'igeret hateshuvah', 'אגרת התשובה'],
  machzor: ['machzor for rosh hashanah', 'machzor', 'מחזור', 'selichot', 'סליחות', "ne'ilah", 'נעילה', 'piyyut', 'פיוט'],
  tzenerene: ['tzenerene', 'tzena urena', 'tzena u-rena', 'צאינה וראינה', 'tzenerene page'],
};


// ─────────────────────────────────────────────────────────────────────────────
// Recipe suggestion (Part C calls this on .docx import)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What Part C's auto-classifier knows about an imported document.
 * `roles` counts units per ContentRole; `commentaryCount` is the
 * number of distinct commentary streams the importer found.
 */
export interface DocumentClassification {
  genreHint?: string;
  roles: Record<string, number>;
  languages: string[];
  hasDibbur: boolean;
  commentaryCount: number;
  isYiddish: boolean;
  hasFootnotes: boolean;
  // --- v0.9.3 Part B: genre signals (RESEARCH-NOTE.md, "Classifier rules") ---
  /** Genre signals matched in the title / first pages / file name (strong or weak). */
  signals?: GenreSignal[];
  /** Structural role-pattern keys (e.g. 'gemara-flanks', 'siman-seif'), from the classifier. */
  rolePatterns?: string[];
}

export interface RecipeSuggestion {
  recipeId: string;
  confidence: number;
  reasons: string[];
  /** True when no historical pattern matched and a neutral default was used. */
  fallback: boolean;
  /** Hebrew reasons, when the suggestion came from genre signals (Part B). */
  reasonsHe?: string[];
}

function hintIncludes(c: DocumentClassification, ...words: string[]): boolean {
  const h = (c.genreHint ?? '').toLowerCase();
  return words.some(w => h.includes(w));
}

// ─────────────────────────────────────────────────────────────────────────────
// v0.9.3 Part B — genre signals (RESEARCH-NOTE.md, "Classifier rules").
// The recipe DATA above is untouched; this block is only the classifier
// vocabulary: which words are strong hints, which are weak (must NOT
// decide alone), which role patterns corroborate them, and the
// specificity order they resolve in. The 18 new recipe ids are the
// contract from the research note — Part A adds the recipe data; a
// suggestRecipe branch naming an id Part A has not added yet is fine,
// the smoke uses the ids as the contract.
// ─────────────────────────────────────────────────────────────────────────────

export type GenreSignalStrength = 'strong' | 'weak';

/** One matched genre signal: a hint word + the recipe it points at. */
export interface GenreSignal {
  /** Key of the matched hint (e.g. 'mishnah-berurah', 'tur', 'oz-vehadar'). */
  key: string;
  /** Recipe id this signal points at (research-note contract). */
  recipeId: string;
  strength: GenreSignalStrength;
  /** English label, for the reasons list. */
  label: string;
  /** Hebrew label, for the UI line. */
  labelHe: string;
  /** The hint text that matched (normalized form). */
  hint: string;
  /** Where the hint was found. */
  source: 'title' | 'text' | 'style' | 'role';
}

interface GenreSignalDef {
  key: string;
  recipeId: string;
  strength: GenreSignalStrength;
  label: string;
  labelHe: string;
  /**
   * Hint strings, ALREADY normalized (lowercase; no nikud/gereshayim;
   * hyphens, maqaf and apostrophes as spaces — see
   * normalizeGenreScanText). Multi-word hints are space-joined.
   */
  hints: string[];
  /**
   * Other signal keys that must ALSO be present for this signal to
   * count at its stated strength (e.g. 'bartenura' is strong only
   * with the mishnah word alongside; 'ב״ח' only with a Tur marker).
   * Unmet → the signal is demoted to weak.
   */
  requiresKeys?: string[];
  /** True when this signal may only count together with a Gemara role pattern (publisher variants). */
  needsGemaraPattern?: boolean;
  /**
   * True for the verse-family signals (Onkelos / Metzudot / Radak /
   * Malbim / Nevi'im): at Mikraot scale (4+ commentary streams)
   * the document is Mikraot Gedolot, not the smaller format, so the
   * signal is dropped.
   */
  verseFamily?: boolean;
  /** Role-pattern keys that must be present for this signal to count at all (e.g. Onkelos needs a verse). */
  requiresPatterns?: string[];
  /** Role-pattern keys that count as the second signal when this hint is weak. */
  supportPatterns?: string[];
  /**
   * Allowed single-letter Hebrew prefixes for the first hint word
   * (default 'בהולכמש'). Restricted to 'ה' for short ambiguous
   * words: bare 'טור' must not match 'בטור' (in a column), and 'בח'
   * must not match inside other words.
   */
  prefixLetters?: string;
}

/**
 * The hint table. Strong hints decide alone (at the confidence the
 * scheme assigns); weak hints need a second signal — a supporting
 * role pattern — and never decide on their own. Publisher hints
 * (Oz VeHadar / ArtScroll / Steinsaltz) decide the Shas VARIANT
 * only when a Gemara role pattern is also present.
 */
const GENRE_SIGNAL_DEFS: ReadonlyArray<GenreSignalDef> = Object.freeze([
  // --- strong: Mishnah Berurah page (SA + Rema on top, MB / Biur Halacha / Sha'ar HaTziyun below) ---
  { key: 'mishnah-berurah', recipeId: 'mishnah-berurah', strength: 'strong', label: 'Mishnah Berurah', labelHe: 'משנה ברורה', hints: ['mishnah berurah', 'משנה ברורה'] },
  { key: 'biur-halacha', recipeId: 'mishnah-berurah', strength: 'strong', label: 'Biur Halacha', labelHe: 'ביאור הלכה', hints: ['biur halacha', 'ביאור הלכה'] },
  { key: 'shaar-hatziyun', recipeId: 'mishnah-berurah', strength: 'strong', label: 'Sha\'ar HaTziyun', labelHe: 'שער הציון', hints: ['sha ar hatziyun', 'shaar hatziyun', 'שער הציון'] },
  // --- strong: Mishneh Torah (Rambam) ---
  { key: 'mishneh-torah', recipeId: 'mishneh-torah', strength: 'strong', label: 'Mishneh Torah', labelHe: 'משנה תורה', hints: ['mishneh torah', 'משנה תורה'] },
  { key: 'rambam', recipeId: 'mishneh-torah', strength: 'strong', label: 'Rambam', labelHe: 'רמב״ם', hints: ['rambam', 'רמבם'] },
  { key: 'kesef-mishneh', recipeId: 'mishneh-torah', strength: 'strong', label: 'Kesef Mishneh', labelHe: 'כסף משנה', hints: ['kesef mishneh', 'kesef mishna', 'כסף משנה'] },
  { key: 'maggid-mishneh', recipeId: 'mishneh-torah', strength: 'strong', label: 'Maggid Mishneh', labelHe: 'מגיד משנה', hints: ['maggid mishneh', 'מגיד משנה'] },
  { key: 'raavad', recipeId: 'mishneh-torah', strength: 'strong', label: 'Raavad', labelHe: 'ראב״ד', hints: ['raavad', 'ראבד'] },
  { key: 'lechem-mishneh', recipeId: 'mishneh-torah', strength: 'strong', label: 'Lechem Mishneh', labelHe: 'לחם משנה', hints: ['lechem mishneh', 'לחם משנה'] },
  // --- strong: Yerushalmi ---
  { key: 'yerushalmi', recipeId: 'yerushalmi', strength: 'strong', label: 'Yerushalmi', labelHe: 'ירושלמי', hints: ['yerushalmi', 'ירושלמי'] },
  { key: 'pnei-moshe', recipeId: 'yerushalmi', strength: 'strong', label: 'Pnei Moshe', labelHe: 'פני משה', hints: ['pnei moshe', 'פני משה'] },
  { key: 'korban-haedah', recipeId: 'yerushalmi', strength: 'strong', label: 'Korban HaEdah', labelHe: 'קרבן העדה', hints: ['korban haedah', 'קרבן העדה'] },
  { key: 'ridvaz', recipeId: 'yerushalmi', strength: 'strong', label: 'Ridvaz', labelHe: 'רי״דב״ז', hints: ['ridvaz', 'רידבז'] },
  // --- strong: Mishnah (classic / Kehati) ---
  { key: 'kehati', recipeId: 'mishnah-kehati', strength: 'strong', label: 'Kehati', labelHe: 'קהתי', hints: ['kehati', 'קהתי'] },
  { key: 'bartenura', recipeId: 'mishnah-classic', strength: 'strong', label: 'Bartenura', labelHe: 'ברטנורא', hints: ['bartenura', 'ברטנורא'], requiresKeys: ['mishnah'] },
  { key: 'tosafot-yom-tov', recipeId: 'mishnah-classic', strength: 'strong', label: 'Tosafot Yom Tov', labelHe: 'תוספות יום טוב', hints: ['tosafot yom tov', 'tosafos yom tov', 'תוספות יום טוב', 'ikar tosefot', 'עיקר תוספות'] },
  // --- strong: codes ---
  { key: 'aruch-hashulchan', recipeId: 'aruch-hashulchan', strength: 'strong', label: 'Aruch HaShulchan', labelHe: 'ערוך השולחן', hints: ['aruch hashulchan', 'aruch ha shulchan', 'ערוך השלחן', 'ערוך השולחן'] },
  { key: 'kitzur-shulchan-aruch', recipeId: 'kitzur-shulchan-aruch', strength: 'strong', label: 'Kitzur Shulchan Aruch', labelHe: 'קיצור שולחן ערוך', hints: ['kitzur shulchan aruch', 'קיצור שולחן ערוך'] },
  { key: 'arbah-turim', recipeId: 'tur', strength: 'strong', label: 'Arba\'ah Turim', labelHe: 'ארבעה טורים', hints: ['arbah turim', 'arba turim', 'ארבעה טורים'] },
  { key: 'drishah', recipeId: 'tur', strength: 'strong', label: 'Drishah', labelHe: 'דרישה', hints: ['drishah', 'דרישה'] },
  { key: 'prishah', recipeId: 'tur', strength: 'strong', label: 'Prishah', labelHe: 'פרישה', hints: ['prishah', 'פרישה'] },
  // --- strong: Tanya / Midrash / Ein Yaakov / Mussar ---
  { key: 'tanya', recipeId: 'tanya', strength: 'strong', label: 'Tanya', labelHe: 'תניא', hints: ['tanya', 'תניא'] },
  { key: 'likutei-amarim', recipeId: 'tanya', strength: 'strong', label: 'Likutei Amarim', labelHe: 'ליקוטי אמרים', hints: ['likutei amarim', 'ליקוטי אמרים'] },
  { key: 'igeret-hateshuvah', recipeId: 'tanya', strength: 'strong', label: 'Igeret HaTeshuvah', labelHe: 'אגרת התשובה', hints: ['igeret hateshuvah', 'igeret ha teshuvah', 'אגרת התשובה'] },
  { key: 'midrash-rabbah', recipeId: 'midrash', strength: 'strong', label: 'Midrash Rabbah', labelHe: 'מדרש רבה', hints: ['midrash rabbah', 'מדרש רבה'] },
  { key: 'midrash', recipeId: 'midrash', strength: 'strong', label: 'Midrash', labelHe: 'מדרש', hints: ['midrash', 'מדרש'] },
  { key: 'tanchuma', recipeId: 'midrash', strength: 'strong', label: 'Tanchuma', labelHe: 'תנחומא', hints: ['tanchuma', 'תנחומא'] },
  { key: 'davar-acher', recipeId: 'midrash', strength: 'strong', label: 'Davar Acher', labelHe: 'דבר אחר', hints: ['davar acher', 'דבר אחר'] },
  { key: 'ein-yaakov', recipeId: 'ein-yaakov', strength: 'strong', label: 'Ein Yaakov', labelHe: 'עין יעקב', hints: ['ein yaakov', 'עין יעקב'] },
  { key: 'mussar', recipeId: 'mussar', strength: 'strong', label: 'Mussar', labelHe: 'מוסר', hints: ['mussar', 'מוסר'] },
  { key: 'mesillat-yesharim', recipeId: 'mussar', strength: 'strong', label: 'Mesillat Yesharim', labelHe: 'מסילת ישרים', hints: ['mesillat yesharim', 'מסילת ישרים'] },
  { key: 'chovot-halevavot', recipeId: 'mussar', strength: 'strong', label: 'Chovot HaLevavot', labelHe: 'חובות הלבבות', hints: ['chovot halevavot', 'חובות הלבבות'] },
  { key: 'orchos-tzaddikim', recipeId: 'mussar', strength: 'strong', label: 'Orchos Tzaddikim', labelHe: 'אורחות צדיקים', hints: ['orchos tzaddikim', 'אורחות צדיקים'] },
  // --- strong: Machzor ---
  { key: 'machzor', recipeId: 'machzor', strength: 'strong', label: 'Machzor', labelHe: 'מחזור', hints: ['machzor', 'מחזור'] },
  { key: 'selichot', recipeId: 'machzor', strength: 'strong', label: 'Selichot', labelHe: 'סליחות', hints: ['selichot', 'סליחות'] },
  { key: 'neilah', recipeId: 'machzor', strength: 'strong', label: 'Ne\'ilah', labelHe: 'נעילה', hints: ['neilah', 'ne ilah', 'נעילה'] },
  { key: 'piyyut', recipeId: 'machzor', strength: 'strong', label: 'Piyyut', labelHe: 'פיוט', hints: ['piyyut', 'piyyutim', 'פיוט', 'פיוטים'] },
  // --- strong, verse-family: Chumash / Nevi'im-Ketuvim with commentaries ---
  { key: 'metzudot', recipeId: 'tanach-commentary', strength: 'strong', label: 'Metzudot', labelHe: 'מצודות', hints: ['metzudot', 'מצודות', 'metzudat david', 'מצודת דוד', 'metzudat tzion', 'מצודת ציון'], verseFamily: true },
  { key: 'radak', recipeId: 'tanach-commentary', strength: 'strong', label: 'Radak', labelHe: 'רד״ק', hints: ['radak', 'רדק'], verseFamily: true },
  { key: 'malbim', recipeId: 'tanach-commentary', strength: 'strong', label: 'Malbim', labelHe: 'מלבי״ם', hints: ['malbim', 'מלבים'], verseFamily: true },
  { key: 'neviim-ketuvim', recipeId: 'tanach-commentary', strength: 'strong', label: 'Nevi\'im / Ketuvim', labelHe: 'נביאים / כתובים', hints: ['nevi im', 'neviim', 'נביאים', 'ketuvim', 'כתובים'], verseFamily: true },
  { key: 'onkelos', recipeId: 'chumash', strength: 'strong', label: 'Targum Onkelos', labelHe: 'תרגום אונקלוס', hints: ['onkelos', 'אונקלוס', 'targum onkelos', 'תרגום אונקלוס'], verseFamily: true, requiresPatterns: ['verse-targum', 'verse-commentaries'] },
  // --- strong, gated: Shas publisher variants (need a Gemara role pattern) ---
  { key: 'oz-vehadar', recipeId: 'shas-oz-vehadar', strength: 'strong', label: 'Oz VeHadar', labelHe: 'עוז והדר', hints: ['oz vehadar', 'oz ve hadar', 'עוז והדר', 'metivta', 'מטיבתא'], needsGemaraPattern: true },
  { key: 'artscroll', recipeId: 'shas-artscroll', strength: 'strong', label: 'ArtScroll Schottenstein', labelHe: 'ארטסקרול', hints: ['artscroll', 'schottenstein', 'ארטסקרול', 'שוטנשטיין'], needsGemaraPattern: true },
  { key: 'steinzaltz', recipeId: 'shas-steinzaltz', strength: 'strong', label: 'Steinsaltz', labelHe: 'שטיינזלץ', hints: ['steinzaltz', 'steinsaltz', 'שטיינזלץ'], needsGemaraPattern: true },
  // --- strong: siddur by nusach (geometry is the same single-column prayer layout; the difference is content order) ---
  { key: 'nusach', recipeId: 'siddur', strength: 'strong', label: 'Nusach', labelHe: 'נוסח', hints: ['nusach ashkenaz', 'נוסח אשכנז', 'nusach sefard', 'נוסח ספרד', 'edot hamizrach', 'עדות המזרח', 'nusach ari', 'נוסח ארי', 'nusach teman', 'נוסח תימן'] },
  // --- weak: must NOT decide alone; each needs a supporting role pattern ---
  { key: 'mishnah', recipeId: 'mishnah-classic', strength: 'weak', label: 'Mishnah', labelHe: 'משנה', hints: ['mishnah', 'משנה'], supportPatterns: ['mishnah-structure', 'mishnah-commentary'] },
  { key: 'tur', recipeId: 'tur', strength: 'weak', label: 'Tur', labelHe: 'טור', hints: ['tur', 'טור'], prefixLetters: 'ה', supportPatterns: ['siman-seif', 'siman-commentaries'] },
  { key: 'bach', recipeId: 'tur', strength: 'weak', label: 'Bach', labelHe: 'ב״ח', hints: ['bach', 'בח'], prefixLetters: 'ה', requiresKeys: ['tur'], supportPatterns: ['siman-seif', 'siman-commentaries'] },
  { key: 'shulchan-aruch', recipeId: 'shulchan-aruch', strength: 'weak', label: 'Shulchan Aruch', labelHe: 'שולחן ערוך', hints: ['shulchan aruch', 'shulchan arukh', 'שולחן ערוך'], supportPatterns: ['siman-seif', 'siman-commentaries'] },
  { key: 'rosh-hashanah', recipeId: 'machzor', strength: 'weak', label: 'Rosh Hashanah', labelHe: 'ראש השנה', hints: ['rosh hashanah', 'ראש השנה'], supportPatterns: ['prayer'] },
  { key: 'yom-kippur', recipeId: 'machzor', strength: 'weak', label: 'Yom Kippur', labelHe: 'יום כיפור', hints: ['yom kippur', 'יום כיפור', 'יום הכיפורים'], supportPatterns: ['prayer'] },
  { key: 'chumash', recipeId: 'chumash', strength: 'weak', label: 'Chumash', labelHe: 'חומש', hints: ['chumash', 'חומש'], supportPatterns: ['verse-targum', 'verse-present'] },
  { key: 'kitzur', recipeId: 'kitzur-shulchan-aruch', strength: 'weak', label: 'Kitzur', labelHe: 'קיצור', hints: ['kitzur', 'קיצור'], supportPatterns: ['siman-seif'] },
  { key: 'rishonim', recipeId: 'chumash-rishonim', strength: 'weak', label: 'Rishonim', labelHe: 'ראשונים', hints: ['rishonim', 'ראשונים'], supportPatterns: ['verse-commentaries'] },
]);

/** Which recipes each structural role pattern supports. */
/**
 * v0.9.8 Bilingual Audit — closed union of genre role-pattern ids.
 * The SUPPORT and LABELS tables below are keyed by this union, so
 * TypeScript FAILS the build if a pattern ships without support data
 * or a label in either language (the v0.9.1 lesson).
 */
export type GenreRolePatternId =
  | 'gemara-flanks'
  | 'mishnah-structure'
  | 'mishnah-commentary'
  | 'verse-commentaries'
  | 'verse-targum'
  | 'verse-present'
  | 'siman-seif'
  | 'siman-commentaries'
  | 'mb-seif-katan'
  | 'prayer'
  | 'yerushalmi-halakhot';

/** Type guard: role-pattern ids arrive as plain strings from the classifier. */
export function isGenreRolePatternId(p: string): p is GenreRolePatternId {
  return p in GENRE_ROLE_PATTERN_LABELS;
}

export const GENRE_ROLE_PATTERN_SUPPORT: Record<GenreRolePatternId, string[]> = Object.freeze({
  'gemara-flanks': ['shas-oz-vehadar', 'shas-artscroll', 'shas-steinzaltz', 'talmud-bavli'],
  'mishnah-structure': ['mishnah-classic', 'mishnah-kehati'],
  'mishnah-commentary': ['mishnah-classic'],
  'verse-commentaries': ['chumash', 'tanach-commentary', 'mikraot-gedolot', 'chumash-rishonim'],
  'verse-targum': ['chumash', 'chumash-rishonim'],
  'verse-present': ['chumash', 'tanach-commentary', 'mikraot-gedolot', 'chumash-rishonim'],
  'siman-seif': ['shulchan-aruch', 'tur', 'aruch-hashulchan', 'kitzur-shulchan-aruch', 'mishnah-berurah'],
  'siman-commentaries': ['shulchan-aruch', 'tur', 'mishnah-berurah'],
  'mb-seif-katan': ['mishnah-berurah'],
  prayer: ['machzor', 'siddur'],
  'yerushalmi-halakhot': ['yerushalmi'],
});

/** Human labels for the role patterns (used in the "why" line). */
export const GENRE_ROLE_PATTERN_LABELS: Record<GenreRolePatternId, { he: string; en: string }> = Object.freeze({
  'gemara-flanks': { he: 'גמרא עם רש״י ותוספות', en: 'Gemara with Rashi and Tosafot flanks' },
  'mishnah-structure': { he: 'מבנה משנה', en: 'Mishnah structure' },
  'mishnah-commentary': { he: 'פירוש על המשנה', en: 'commentary on the Mishnah' },
  'verse-commentaries': { he: 'פסוקים עם מפרשים', en: 'verses with commentaries' },
  'verse-targum': { he: 'פסוקים עם תרגום אונקלוס', en: 'verses with Targum Onkelos' },
  'verse-present': { he: 'פסוקים', en: 'verse text present' },
  'siman-seif': { he: 'מבנה סימן / סעיף', en: 'siman / se’if structure' },
  'siman-commentaries': { he: 'סימנים עם מפרשים', en: 'simanim with commentaries' },
  'mb-seif-katan': { he: 'סימני ס״ק', en: 'se’if-katan markers' },
  prayer: { he: 'סימני תפילה', en: 'prayer markers' },
  'yerushalmi-halakhot': { he: 'מבנה הלכות', en: 'halakhot structure' },
});

/**
 * Specificity order, most specific first (research note), as GROUPS:
 * recipes in one group have the same specificity, and inside a group
 * the EVIDENCE decides (more strong signals first, then higher
 * confidence) — the list order inside a group is only the final
 * tie-break. E.g. a Kehati (1 strong signal) beats a bare 'mishnah'
 * word (weak only) even though 'mishnah-classic' is listed first in
 * the Mishnah group. Generic 'shulchan-aruch' is NOT ranked in the
 * note; it sits after the Tur / Aruch / Kitzur family (all more
 * specific codes) and before the general-prose families — recorded
 * here as the honest placement. Recipes absent from these groups
 * sort after them.
 */
export const GENRE_SPECIFICITY_GROUPS: ReadonlyArray<ReadonlyArray<string>> = Object.freeze([
  ['shas-oz-vehadar', 'shas-artscroll', 'shas-steinzaltz'],
  // v0.9.5: Yiddish — added (yiddish-sefer was in NO group, so it
  // sorted last and lost to any grouped recipe). Placed second because
  // Yiddish language detection is a document-level, highly distinctive
  // signal — a Yiddish document cannot be a Mishnah Berurah or a Tur
  // page — and suggestRecipe's early Yiddish branch already returns
  // yiddish-sefer before the sorter runs. tzenerene shares the signals.
  ['yiddish-sefer', 'tzenerene'],
  ['mishnah-berurah'],
  ['yerushalmi'],
  ['mishneh-torah'],
  ['mishnah-classic', 'mishnah-kehati'],
  ['midrash', 'ein-yaakov'],
  ['tur', 'aruch-hashulchan', 'kitzur-shulchan-aruch'],
  ['shulchan-aruch'],
  ['mussar', 'tanya'],
  ['machzor', 'siddur'],
  ['chumash', 'tanach-commentary'],
  ['mikraot-gedolot', 'chumash-rishonim'],
  ['talmud-bavli', 'vilna-shas'],
  ['responsa', 'chassidic-drush'],
  ['machon-edition'],
]);

/** The specificity groups, flattened (for reference / debugging). */
export const GENRE_SPECIFICITY_ORDER: ReadonlyArray<string> = Object.freeze(
  GENRE_SPECIFICITY_GROUPS.flat(),
);

/** Specificity group index of a recipe (unknown ids sort last). */
function genreSpecificityGroup(recipeId: string): number {
  const i = GENRE_SPECIFICITY_GROUPS.findIndex(g => g.includes(recipeId));
  return i === -1 ? 999 : i;
}

/**
 * Weak signals that must be ignored when the document is a Shas page:
 * a Vilna daf quotes the Mishnah, the Tur and the Shulchan Aruch in
 * passing (Mishna block, Ein Mishpat, Tosafot), so those words on a
 * page with Rashi + Tosafot flanks are incidental, not the genre.
 */
const GENRE_GEMARA_FLANKS_BLOCKED_WEAK_RECIPES: ReadonlyArray<string> = Object.freeze([
  'mishnah-classic', 'tur', 'chumash', 'tanach-commentary',
  'aruch-hashulchan', 'kitzur-shulchan-aruch', 'shulchan-aruch', 'chumash-rishonim',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize text for hint matching: lowercase, nikud/cantillation
 * stripped, gereshayim/quotes and maqaf/dashes turned into word
 * breaks, everything else non-alphanumeric collapsed to spaces.
 * Hint strings in the table above are written in this same form.
 */
export function normalizeGenreScanText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[֑-ְֱֲֳִֵֶַׇָֹֻּֽֿׁׂׅׄ]/g, '')
    .replace(/[׳״"']/g, ' ')
    .replace(/[־–—-]/g, ' ')
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One hint string → a word-boundary regex (Hebrew or English). */
function hintRegex(hint: string, prefixLetters: string): RegExp {
  const words = hint.split(' ');
  const wordRe = words.map(w => escapeRegExp(w)).join('\\s+');
  if (/[\u0590-\u05ff]/.test(hint)) {
    // Hebrew: optional single-letter prefix on the first word, bounded
    // by non-Hebrew letters (lookarounds, so matches do not consume
    // the boundary and adjacent matches are still found).
    return new RegExp(`(?:^|(?<=[^\\u0590-\\u05ff]))(?:[${prefixLetters}])?${wordRe}(?=[^\\u0590-\\u05ff]|$)`, 'g');
  }
  return new RegExp(`\\b${wordRe}\\b`, 'g');
}

/**
 * Match the hint table against raw text (title, first pages, file
 * name, or style names). Strong hints claim their spans first, so a
 * weak hint inside a strong phrase ('משנה' inside 'משנה תורה',
 * 'שולחן ערוך' inside 'קיצור שולחן ערוך') never counts on its own;
 * a generic strong hint ('מדרש') likewise does not double-count the
 * same occurrence as the specific one ('מדרש רבה').
 */
export function matchGenreSignals(rawText: string, source: GenreSignal['source'] = 'text'): GenreSignal[] {
  const scan = normalizeGenreScanText(rawText);
  if (!scan) return [];
  const claimed: Array<[number, number]> = [];
  const found = new Map<string, GenreSignal>();
  const overlapsClaimed = (start: number, end: number): boolean =>
    claimed.some(([s, e]) => start < e && s < end);
  for (const pass of ['strong', 'weak'] as const) {
    for (const def of GENRE_SIGNAL_DEFS) {
      if (def.strength !== pass) continue;
      for (const hint of def.hints) {
        const re = hintRegex(hint, def.prefixLetters ?? 'בהולכמש');
        let matched = false;
        for (const m of scan.matchAll(re)) {
          const start = m.index ?? 0;
          const end = start + m[0].length;
          if (overlapsClaimed(start, end)) continue;
          claimed.push([start, end]);
          matched = true;
          break;
        }
        if (matched) {
          found.set(def.key, {
            key: def.key,
            recipeId: def.recipeId,
            strength: def.strength,
            label: def.label,
            labelHe: def.labelHe,
            hint,
            source,
          });
          break;
        }
      }
    }
  }
  return [...found.values()];
}

/** Signals from a bare genreHint string (legacy callers pass no signals). */
function deriveSignalsFromHint(c: DocumentClassification): GenreSignal[] {
  return matchGenreSignals(c.genreHint ?? '', 'text');
}

/** Role patterns derivable from roles alone (legacy callers pass none). */
function deriveRolePatternsFromRoles(c: DocumentClassification): string[] {
  const roles = c.roles ?? {};
  const count = (r: string): number => roles[r] ?? 0;
  const out: string[] = [];
  if (count('primary_comment') > 0 && count('secondary_comment') > 0) out.push('gemara-flanks');
  if (count('verse') > 0) out.push('verse-present');
  if (count('verse') > 0 && c.commentaryCount >= 2) out.push('verse-commentaries');
  if (count('siman') > 0 || count('seif') > 0) out.push('siman-seif');
  if ((count('siman') > 0 || count('seif') > 0) && c.commentaryCount >= 1) out.push('siman-commentaries');
  return out;
}

/**
 * Signal-based recipe choice (the specificity order). Returns null
 * when no signal is eligible, so the caller falls back to the
 * role/hint branches below — nothing is ever decided on a weak hint
 * alone, a publisher name alone, or no evidence at all.
 *
 * Confidence (research note): 2+ strong → 0.92; 1 strong + role
 * pattern → 0.92; 1 strong → 0.87; single weak + role pattern →
 * 0.75; a weak hint with TWO distinct supporting role patterns
 * (e.g. siman structure AND commentaries) → 0.85.
 */
export function suggestRecipeBySignals(c: DocumentClassification): RecipeSuggestion | null {
  const signals = c.signals ?? deriveSignalsFromHint(c);
  if (signals.length === 0) return null;
  const patterns = c.rolePatterns ?? deriveRolePatternsFromRoles(c);
  const hasGemaraFlanks = patterns.includes('gemara-flanks');
  const presentKeys = new Set(signals.map(s => s.key));
  const byRecipe = new Map<string, { strong: GenreSignal[]; weak: GenreSignal[]; patterns: GenreRolePatternId[] }>();
  for (const sig of signals) {
    const def = GENRE_SIGNAL_DEFS.find(d => d.key === sig.key);
    if (!def) continue; // unknown keys are never trusted
    // Publisher hints decide the Shas VARIANT only with a Gemara pattern.
    if (def.needsGemaraPattern && !hasGemaraFlanks) continue;
    // Verse-family signals at Mikraot scale belong to Mikraot Gedolot.
    if (def.verseFamily && (c.commentaryCount ?? 0) >= 4) continue;
    // A verse-conditional signal (Onkelos) counts only with a verse pattern.
    if (def.requiresPatterns && !def.requiresPatterns.some(p => patterns.includes(p))) continue;
    let strength = sig.strength;
    // 'bartenura' / 'ב״ח' lose their strength without their required partner.
    if (def.requiresKeys && !def.requiresKeys.every(k => presentKeys.has(k))) strength = 'weak';
    if (strength === 'weak') {
      if (hasGemaraFlanks && GENRE_GEMARA_FLANKS_BLOCKED_WEAK_RECIPES.includes(sig.recipeId)) continue;
      const supports = def.supportPatterns ?? [];
      if (!supports.some(p => patterns.includes(p))) continue;
    }
    const entry = byRecipe.get(sig.recipeId) ?? { strong: [], weak: [], patterns: [] };
    if (strength === 'strong') entry.strong.push(sig);
    else entry.weak.push(sig);
    byRecipe.set(sig.recipeId, entry);
  }
  for (const [recipeId, entry] of byRecipe) {
    entry.patterns = patterns.filter((p): p is GenreRolePatternId => isGenreRolePatternId(p) && GENRE_ROLE_PATTERN_SUPPORT[p].includes(recipeId));
  }
  const eligible = [...byRecipe.entries()]
    .filter(([, e]) => e.strong.length > 0 || e.weak.length > 0)
    .map(([recipeId, e]) => {
      let confidence: number;
      if (e.strong.length >= 2) confidence = 0.92;
      else if (e.strong.length === 1 && e.patterns.length > 0) confidence = 0.92;
      else if (e.strong.length === 1) confidence = 0.87;
      else confidence = e.patterns.length >= 2 ? 0.85 : 0.75;
      return { recipeId, evidence: e, confidence };
    });
  if (eligible.length === 0) return null;
  // Layout training T8 — a work NAMED in the title (מסילת ישרים) beats a
  // genre word that merely occurs in the body ("מדרש" quoted in a Mussar
  // text): the title says what the book is.
  const namedInTitle = (x: (typeof eligible)[number]) => x.evidence.strong.some(s => s.source === 'title');
  eligible.sort((a, b) => {
    if (namedInTitle(a) !== namedInTitle(b)) return namedInTitle(a) ? -1 : 1;
    // Specificity GROUP first, then evidence inside the group: more
    // strong signals, then higher confidence. (A flat list position
    // must not decide inside a group — a Kehati signal beats a bare
    // 'mishnah' word even though mishnah-classic is listed first.)
    if (genreSpecificityGroup(a.recipeId) !== genreSpecificityGroup(b.recipeId)) {
      return genreSpecificityGroup(a.recipeId) - genreSpecificityGroup(b.recipeId);
    }
    if (b.evidence.strong.length !== a.evidence.strong.length) return b.evidence.strong.length - a.evidence.strong.length;
    return b.confidence - a.confidence;
  });
  const winner = eligible[0];
  const e = winner.evidence;
  return {
    recipeId: winner.recipeId,
    confidence: winner.confidence,
    reasons: [
      ...e.strong.map(s => `strong signal: “${s.label}”`),
      ...e.weak.map(s => `signal: “${s.label}”`),
      ...e.patterns.map(p => `role pattern: ${GENRE_ROLE_PATTERN_LABELS[p].en}`),
    ],
    reasonsHe: [
      ...e.strong.map(s => s.labelHe),
      ...e.weak.map(s => s.labelHe),
      ...e.patterns.map(p => GENRE_ROLE_PATTERN_LABELS[p].he),
    ],
    fallback: false,
  };
}

/**
 * Picks the library recipe that fits an imported document, with a
 * plain-language reason for the choice. Strong signals (Yiddish,
 * genre hints, Vilna / Mikraot role patterns) win in specificity
 * order; anything else falls back to a neutral default — single-column
 * prose (`machon-edition`) for plain text, the two-column
 * commentary layout (`shulchan-aruch`) for commentary-heavy text —
 * with low confidence and `fallback: true`, so the UI can say so and
 * offer "Change layout".
 *
 * v0.9.3 Part B: when the classification carries genre signals
 * (`c.signals`, from `classifyDocument` in auto-layout.ts) they are
 * resolved FIRST by `suggestRecipeBySignals` in the research note's
 * specificity order (publisher-variant Shas > mishnah-berurah >
 * yerushalmi > mishneh-torah > mishnah > midrash/ein-yaakov >
 * tur/aruch/kitzur > shulchan-aruch > mussar/tanya > machzor/siddur
 * > chumash/tanach-commentary > mikraot/chumash-rishonim >
 * talmud-bavli > responsa/drush). Weak hints ('mishnah', 'tur',
 * 'ב״ח', 'rosh hashanah'/'yom kippur', 'chumash', 'shulchan aruch')
 * never decide alone, and a publisher name without a Gemara role
 * pattern never picks a Shas variant. The hint/role branches below
 * run only when no signal is eligible, and their weak-hint triggers
 * are gated the same way.
 */
export function suggestRecipe(c: DocumentClassification): RecipeSuggestion {
  const roles = c.roles ?? {};
  const count = (role: string): number => roles[role] ?? 0;
  const hasMain = count('main_source') > 0 || count('regular_paragraph') > 0;
  const hasRashi = count('primary_comment') > 0;
  const hasTosafot = count('secondary_comment') > 0;
  const hasVerse = count('verse') > 0;
  const hasSiman = count('siman') > 0 || count('seif') > 0;

  if (c.isYiddish || c.languages.some(l => l.toLowerCase().includes('yi'))) {
    return {
      recipeId: 'yiddish-sefer',
      confidence: 0.9,
      reasons: ['The document is in Yiddish (or has a Yiddish stream) — Hebrew source facing Yiddish text.'],
      fallback: false,
    };
  }
  // v0.9.3 Part B — genre signals first, in specificity order (see
  // suggestRecipeBySignals). When a signal is eligible it wins over
  // the looser hint branches below; when none is, those branches run
  // exactly as before.
  const bySignals = suggestRecipeBySignals(c);
  if (bySignals) return bySignals;
  if (hintIncludes(c, 'siddur', 'prayer', 'tefillah', 'tefila', 'mincha', 'shacharit', 'maariv')) {
    return {
      recipeId: 'siddur',
      confidence: 0.9,
      reasons: ['The document reads as prayer text — single-column siddur layout with a centred running header and marginal notes.'],
      fallback: false,
    };
  }
  // Shulchan Aruch — 'shulchan aruch' is a WEAK hint (research note):
  // it needs a siman/se'if structure or a commentary to decide. The
  // bare topic words ('halakha', 'orach chaim', …) still decide alone.
  const shulchanHint = hintIncludes(c, 'shulchan');
  const halakhaHint = hintIncludes(c, 'halakha', 'halacha', 'orach chaim', 'yoreh deah', 'even haezer', 'choshen mishpat');
  if (halakhaHint || (shulchanHint && (hasSiman || c.commentaryCount >= 1)) || (hasSiman && c.commentaryCount >= 2)) {
    return {
      recipeId: 'shulchan-aruch',
      confidence: 0.88,
      reasons: ['Siman / se’if structure with several commentaries — the Shulchan Aruch page: central text surrounded by commentary columns.'],
      fallback: false,
    };
  }
  if (hintIncludes(c, 'responsa', 'responsum', "she'elot", 'she’elot', 'teshuvot', 'teshuvos')) {
    return {
      recipeId: 'responsa',
      confidence: 0.88,
      reasons: ['The document reads as responsa — a single running column headed by the siman banner.'],
      fallback: false,
    };
  }
  if (hintIncludes(c, 'drush', 'chassidic', 'chassidut', 'hasidic')) {
    return {
      recipeId: 'chassidic-drush',
      confidence: 0.88,
      reasons: ['The document reads as Chassidic drush — a single column of sermonic prose with centred headings.'],
      fallback: false,
    };
  }
  // Chumash — 'chumash' is a WEAK hint (research note): it needs a
  // verse or a commentary to decide, and a bare hint never picks a
  // recipe at the old 0.88. With that evidence it is the weak+role
  // band (0.75), not a confident pick.
  if (hintIncludes(c, 'chumash', 'rishonim') && (hasVerse || c.commentaryCount >= 1)) {
    return {
      recipeId: 'chumash-rishonim',
      confidence: 0.75,
      reasons: ['The document reads as Chumash with Rishonim — verse on top, Rashi / Ramban / Ibn Ezra / Sforno below.'],
      fallback: false,
    };
  }
  // Talmud — 'mishna' / 'mishnah' is a WEAK hint (research note): a
  // bare Mishnah word with no Gemara flanks must NOT pick the Shas
  // folio. The role pattern (main + Rashi + Tosafot + dibbur) still
  // decides on its own, as before.
  const talmudHint = hintIncludes(c, 'talmud', 'shas', 'gemara', 'berakhot', 'brachos');
  const mishnaHint = hintIncludes(c, 'mishna', 'mishnah');
  if (talmudHint || (mishnaHint && hasMain && hasRashi && hasTosafot) ||
    (hasMain && hasRashi && hasTosafot && c.hasDibbur)) {
    return {
      recipeId: 'talmud-bavli',
      confidence: 0.92,
      reasons: [
        'Gemara with Rashi and Tosafot and dibbur hamatchil markers — the Vilna Shas folio (Rashi inner, Tosafot outer).',
      ],
      fallback: false,
    };
  }
  if (hasVerse && c.commentaryCount >= 4) {
    return {
      recipeId: 'mikraot-gedolot',
      confidence: 0.9,
      reasons: [`Verse text with ${c.commentaryCount} commentary streams — Mikraot Gedolot, verse on top with the commentaries around it.`],
      fallback: false,
    };
  }
  if (hasVerse && c.commentaryCount >= 2) {
    return {
      recipeId: 'chumash-rishonim',
      confidence: 0.75,
      reasons: [`Verse text with ${c.commentaryCount} commentary streams — Chumash with Rishonim.`],
      fallback: false,
    };
  }
  if (hasMain && c.commentaryCount === 0 && !c.hasDibbur) {
    return {
      recipeId: 'machon-edition',
      confidence: 0.7,
      reasons: ['Plain running prose with no commentary streams — a clean modern single-column edition.'],
      fallback: false,
    };
  }
  // Fallback: no historical pattern matched. Say so (low confidence,
  // fallback: true) and use a neutral default — single-column prose
  // for plain text, the two-column commentary layout when the
  // document is commentary-heavy.
  if (c.commentaryCount >= 2) {
    return {
      recipeId: 'shulchan-aruch',
      confidence: 0.3,
      reasons: [
        'No historical pattern matched this document, so a neutral default was used: the two-column commentary layout, because the document is commentary-heavy.',
        'Pick “Change layout” if another layout fits better.',
      ],
      fallback: true,
    };
  }
  return {
    recipeId: 'machon-edition',
    confidence: 0.35,
    reasons: [
      'No historical pattern matched this document, so a neutral default was used: a clean single-column edition.',
      'Pick “Change layout” if another layout fits better.',
    ],
    fallback: true,
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// Picker surface (Part B) — summaries + id lookup over the library
// ─────────────────────────────────────────────────────────────────────────────

/** One row in the "Historical layouts" pickers (plain-language). */
export interface HistoricalLayoutSummary {
  id: string;
  /** Hebrew name, from the recipe metadata (v0.9.5: no i18n lookup). */
  nameHe: string;
  /** English name, from the recipe metadata. */
  nameEn: string;
  /** Hebrew description, from the recipe metadata. */
  descriptionHe: string;
  /** English description, from the recipe metadata. */
  descriptionEn: string;
  genre: string;
}

/**
 * The library for the pickers: the 27 real recipes (aliases excluded —
 * 'vilna-shas' is the same folio as 'talmud-bavli' and 'tzenerene' the
 * same layout as 'yiddish-sefer'; listing them would show the same card
 * twice). `getRecipeById` still resolves an alias id, so NL / AI
 * phrases naming "Vilna Shas" or "Tzenerene" keep working, and a saved
 * project holding an alias id still resolves.
 * v0.9.5: names + descriptions come straight from the recipe metadata
 * in both languages — the pickers render them by language directly
 * instead of looking them up in the i18n table.
 */
export function getHistoricalLayoutLibrary(): HistoricalLayoutSummary[] {
  return HISTORICAL_LAYOUTS.filter(r => !r.aliasOf).map(r => ({
    id: r.metadata.id,
    nameHe: r.metadata.nameHe ?? r.metadata.name,
    nameEn: r.metadata.name,
    descriptionHe: r.metadata.descriptionHe ?? r.metadata.description,
    descriptionEn: r.metadata.description,
    genre: r.metadata.genre[0] ?? '',
  }));
}

/**
 * Look a recipe up by id, resolving aliases ('vilna-shas' →
 * 'talmud-bavli'), so the result is always directly applicable.
 */
export function getRecipeById(id: string): LayoutRecipe | undefined {
  return resolveHistoricalRecipe(id);
}
