/**
 * v0.9.0 Part C — Document classification + AUTOMATIC layout on .docx import.
 *
 * Headline requirement: when a Word document is uploaded, the system lays
 * it out BY ITSELF — classify the document, pick the matching historical
 * layout recipe, apply it and paginate automatically, fully offline, telling
 * the user what it chose and why with a "Change layout" action. Low
 * confidence falls back to a sensible default (single column for prose, two
 * balanced columns for commentary-heavy text) and says so plainly; nothing
 * is ever guessed silently and no document is ever left unlaid-out.
 *
 * Tier anatomy (the Vilna Daf) is taken from the user's structural
 * reference photo `~/workspace/user/files/10450_3_ketm.png` — "The Vilna
 * Daf — A Standard Page of Talmud" (annotated anatomy diagram). The photo
 * is REFERENCE ONLY: nothing in it was copied, traced, embedded or OCR'd
 * into the app. Its labels are the authoritative tier list this classifier
 * must recognise and map imported content to:
 *   daf number (double-sided: one dot = first/a side, two dots = second/b
 *   side) · tractate name, chapter number, chapter name (header band) ·
 *   Mishna block · Gemara (commentary on the Mishna, central text) · Rashi
 *   on the inner/binding side · Tosafot on the outer side · Ein Mishpat
 *   Ner Mitzvah (halachic cross-references, e.g. Mishneh Torah) · Masoret
 *   ha-Shas (cross-references elsewhere in the Gemara + textual variants)
 *   · Torah Or (full Tanach verses cited in the Gemara) · Gilyon ha-Shas
 *   marginal notes (R. Akiva Eiger) · Hagahot ha-Bach marginal notes (the
 *   Bach, R. Yoel Sirkis) · additional commentaries in the outer margin
 *   depending on tractate (Rabbeinu Chananel, Rabbeinu Nisim, others) ·
 *   extra commentaries at the end of the volume.
 *
 * Second reference (structural only, same terms):
 * `~/workspace/user/files/talmud-2_5_qm04.pdf` — "The Talmud — First page
 * of the Talmud (Gemara), Tractate Brachot" (Oz VeHadar / ArtScroll).
 * Legend: middle = Talmud text; right = Rashi; left = Tosfot; outside
 * edges = additional commentaries. The first daf (Berakhot 2a) shows the
 * header band with folio number (ב.) at the outer corner and the chapter
 * heading "מאימתי פרק ראשון ברכות" centred; the opening word "מאימתי"
 * in a large decorated box at the top of the central column; the central
 * Gemara column in large type with the stepped knee; Rashi in smaller
 * Rashi-script type on the RIGHT (inner/binding side on this 2a page);
 * Tosafot on the LEFT (outer side); additional commentaries in narrow
 * columns on the far outer edges; small marginal notes ("מסורת הש\"ס",
 * "תוספות") at the outer margins. This CONFIRMS the corrected flank
 * rule from v0.8.0 (flankPhysicalSides in vilna-shas.ts): on a 2a
 * (recto) page Rashi is right/inner and Tosafot left/outer, mirrored on
 * 2b. The classifier encodes tiers as inner/outer (side-relative), never
 * as fixed left/right, so the mirror rule survives every facing page.
 *
 * CONTRACT WITH THE RECIPE ENGINE (landed in v0.9.0 Part A):
 * `layout-recipes.ts` + `historical-layouts.ts` hold the ONE library
 * and the ONE object applier `applyRecipeToSettings(recipe, settings)`;
 * the id-based applier `applyRecipeToSettingsById` lives here (it
 * needs the library to resolve ids — layout-recipes cannot import
 * the library without a cycle, see its note). The old adapter copy
 * of the library (HISTORICAL_RECIPES / buildAdapterRecipes) and the
 * second id-based applier were deleted in v0.9.9: `getRecipeByIdLocal`
 * / `getAllHistoricalRecipes` project from the library on demand.
 * See MANIFEST-v0.9.0-partC.md §contract.
 */

import type { ContentRole, ContentUnit, RavTextLink, TierConfig } from '../types/typesetter';
import type { BookLayoutType } from '../types/typesetter';
import type { ProfessionalDesignSettings } from '../types/design-settings';
import { DesignSettingsEngine } from './design-settings-engine';
import { getHistoricalRecipe, HISTORICAL_LAYOUTS, HISTORICAL_RECIPE_ALIASES, HISTORICAL_RECIPE_RULES, resolveHistoricalRecipe } from './historical-layouts';
import {
  matchGenreSignals,
  normalizeGenreScanText,
  suggestRecipeBySignals,
  type GenreSignal,
  type DocumentClassification as HistoricalDocumentClassification,
  type RecipeSuggestion as HistoricalRecipeSuggestion,
} from './historical-layouts';
import { seferTypeForRecipe, type SeferType } from './sefer-type';
import { applyGenreTypography, applyRecipeToSettings as applyRecipeToSettingsEngine } from './layout-recipes';
import type { LayoutRecipe } from './layout-recipes';
import { applyVilnaShasDefaults, classifyShasParagraph, normalizeHebrewForMatch } from './vilna-shas';
import { applyYiddishHeadingDefaults, classifyYiddishParagraph, detectYiddish } from './yiddish-sefarim';
import { classifyTitlePageStructure, type TitlePageClassification } from './title-page-borders';

// ---------------------------------------------------------------------------
// Classification shape (the contract shape Part A consumes)
// ---------------------------------------------------------------------------

export interface DocumentClassification {
  /** Genre hint for the recipe scorer ('talmud' | 'tanakh' | 'halacha' | 'responsa' | 'chassidic' | 'yiddish' | 'prose'). */
  genreHint?: string;
  /** Count of units per ContentRole. */
  roles: Record<string, number>;
  /** Languages present: subset of ['he', 'yi'] (Hebrew / Yiddish). */
  languages: string[];
  /** True when any commentary carries a dibbur hamatchil (or a RavText link exists). */
  hasDibbur: boolean;
  /** Number of DISTINCT commentators detected (Rashi, Tosafot, Shach, …). */
  commentaryCount: number;
  /** True when Yiddish is the dominant language of the body text. */
  isYiddish: boolean;
  /** True when the document has footnotes (units or word/footnotes.xml). */
  hasFootnotes: boolean;
  // --- Part C extras (consumed by the local scorer + the UI line) ---
  /** Count of units mapped to each Vilna-Daf tier (see the module doc). */
  tierCounts: Record<VilnaTierId, number>;
  /** Why each tier was recognised (short English reasons, for the UI line / debug). */
  tierReasons: Partial<Record<VilnaTierId, string[]>>;
  /** Distinct commentator names detected, in first-seen order. */
  commentaryAuthors: string[];
  /** Title-page structure, when the import opens with one. */
  titlePage?: TitlePageClassification;
  /** Distinct commentary author count, capped for scoring (same as commentaryCount). */
  distinctCommentaryAuthors: number;
  /** Genre-marker hit counts (raw text signals, for the scorer). */
  markers: {
    responsa: number;
    chassidic: number;
    shulchanAruch: number;
    mishnahBerurah: number;
    taamimUnits: number;
    /** Layout training T6 — Chumash evidence: Torah book / parsha names in the title, headings or file name. */
    torahBook?: number;
    /** Layout training T6 — source units ending a pasuk (sof pasuk ׃, or ':' after vocalized text). */
    sofPasukUnits?: number;
    /** Layout training T6 — source units that are mostly vocalized (nikkud on most letters). */
    vocalizedSourceUnits?: number;
    /** Layout training T6 — Gemara evidence: מתני׳ / גמ׳ / תנו רבנן / אמר רב … in the source. */
    talmudUnits?: number;
    /** Layout training T13 — "דף ב." / "דף ב:" headings (a Talmud folio file). */
    dafHeadings?: number;
  };
  // --- v0.9.3 Part B: genre signals + role patterns (research note) ---
  /** Genre signals matched in the title / first pages / file name / styles (strong or weak). */
  signals?: GenreSignal[];
  /** Structural role-pattern keys (e.g. 'gemara-flanks', 'siman-seif') — the second signal weak hints need. */
  rolePatterns?: string[];
}

/** One tier of the Vilna Daf anatomy (reference photo 10450_3_ketm.png). */
export type VilnaTierId =
  | 'header_band' // tractate name, chapter number/name, daf number (double-sided dots)
  | 'mishna'
  | 'gemara'
  | 'rashi_inner'
  | 'tosafot_outer'
  | 'ein_mishpat_ner_mitzvah'
  | 'masoret_ha_shas'
  | 'torah_or'
  | 'gilyon_ha_shas'
  | 'hagahot_ha_bach'
  | 'outer_commentaries' // Rabbeinu Chananel, Ran, Ramban, Rashba, Ritva, Maharsha, …
  | 'end_of_volume' // extra commentaries at the end of the volume
  | 'footnotes'
  | 'title_page';

export const VILNA_TIER_IDS: ReadonlyArray<VilnaTierId> = Object.freeze([
  'header_band',
  'mishna',
  'gemara',
  'rashi_inner',
  'tosafot_outer',
  'ein_mishpat_ner_mitzvah',
  'masoret_ha_shas',
  'torah_or',
  'gilyon_ha_shas',
  'hagahot_ha_bach',
  'outer_commentaries',
  'end_of_volume',
  'footnotes',
  'title_page',
]);

/** Human label for each tier (Hebrew / English), for the UI + Gemini context. */
export const VILNA_TIER_LABELS: Record<VilnaTierId, { he: string; en: string }> = {
  header_band: { he: 'כותרת עליונה — מסכת, פרק, מספר דף', en: 'Header band — tractate, chapter, daf number' },
  mishna: { he: 'משנה', en: 'Mishna' },
  gemara: { he: 'גמרא (מרכז הדף)', en: 'Gemara (central text)' },
  rashi_inner: { he: 'רש״י — צד פנימי (כריכה)', en: 'Rashi — inner (binding) side' },
  tosafot_outer: { he: 'תוספות — צד חיצוני', en: 'Tosafot — outer side' },
  ein_mishpat_ner_mitzvah: { he: 'עין משפט · נר מצווה', en: 'Ein Mishpat · Ner Mitzvah' },
  masoret_ha_shas: { he: 'מסורת הש״ס', en: 'Masoret HaShas' },
  torah_or: { he: 'תורה אור', en: 'Torah Or' },
  gilyon_ha_shas: { he: 'גליון הש״ס (ר׳ עקיבא איגר)', en: 'Gilyon HaShas (R. Akiva Eiger)' },
  hagahot_ha_bach: { he: 'הגהות הב״ח (ר׳ יואל סירקיש)', en: 'Hagahot HaBach (R. Yoel Sirkis)' },
  outer_commentaries: { he: 'מפרשים נוספים בשוליים החיצוניים', en: 'Additional outer-margin commentaries' },
  end_of_volume: { he: 'מפרשים נוספים בסוף הכרך', en: 'Extra commentaries at the end of the volume' },
  footnotes: { he: 'הערות שוליים', en: 'Footnotes' },
  title_page: { he: 'שער הספר', en: 'Title page' },
};

// ---------------------------------------------------------------------------
// Commentator detection (style names + opening words, deterministic)
// ---------------------------------------------------------------------------

interface AuthorMarker {
  name: string;
  nameHe: string;
  /** Substrings matched (case-insensitive) against the style name. */
  styleSubstrings: string[];
  /**
   * Optional regex matched against the style name, for names that are
   * substrings of other words ('ran' inside 'translation' — a plain
   * substring test misclassifies every Yiddish Translation paragraph
   * as Ran; see partD-smoke §11).
   */
  styleRe?: RegExp;
  /** Regexes matched against the paragraph's opening words. */
  openRes: RegExp[];
  /** Tier this author belongs to on a Vilna daf. */
  tier: VilnaTierId;
}

const AUTHOR_MARKERS: ReadonlyArray<AuthorMarker> = Object.freeze([
  { name: 'Rashi', nameHe: 'רש״י', styleSubstrings: ['rashi', 'רש״י', 'רשי'], openRes: [/^(רש["״]י|רַשִׁ"י)/], tier: 'rashi_inner' },
  // v0.9.3 Part B — Tosafot Yom Tov must be checked BEFORE Tosafot:
  // its style name contains 'tosafot', and its opening words start
  // with 'תוספות' (the Tosafot pattern below would swallow it).
  { name: 'Tosafot Yom Tov', nameHe: 'תוספות יום טוב', styleSubstrings: ['tosafot yom tov', 'tosafos yom tov', 'תוספות יום טוב', 'ikar tosefot'], openRes: [/^(תוספות יום טוב|תּוֹסָפוֹת יוֹם טוֹב)/], tier: 'outer_commentaries' },
  { name: 'Tosafot', nameHe: 'תוספות', styleSubstrings: ['tosafot', 'tosfot', 'תוספות'], openRes: [/^(תוספות|תּוֹסָפוֹת)/], tier: 'tosafot_outer' },
  // v0.9.3 Part B — commentators of the new genres (Mishnah, Rambam,
  // Yerushalmi, Tanach, Tur, Mishnah Berurah). They feed
  // commentaryCount, the outer-commentary tier (never rashi_inner —
  // Bartenura / Pnei Moshe are not Vilna Rashi) and the role patterns.
  { name: 'Bartenura', nameHe: 'ברטנורא', styleSubstrings: ['bartenura', 'ברטנורא'], openRes: [/^(ברטנורא)/], tier: 'outer_commentaries' },
  { name: 'Kehati', nameHe: 'קהתי', styleSubstrings: ['kehati', 'קהתי'], openRes: [/^(קהתי)/], tier: 'outer_commentaries' },
  { name: 'Kesef Mishneh', nameHe: 'כסף משנה', styleSubstrings: ['kesef mishneh', 'kesef mishna', 'כסף משנה'], openRes: [/^(כסף משנה)/], tier: 'outer_commentaries' },
  { name: 'Maggid Mishneh', nameHe: 'מגיד משנה', styleSubstrings: ['maggid mishneh', 'מגיד משנה'], openRes: [/^(מגיד משנה)/], tier: 'outer_commentaries' },
  { name: 'Lechem Mishneh', nameHe: 'לחם משנה', styleSubstrings: ['lechem mishneh', 'לחם משנה'], openRes: [/^(לחם משנה)/], tier: 'outer_commentaries' },
  { name: 'Raavad', nameHe: 'ראב״ד', styleSubstrings: ['raavad', 'ראבד', 'ראב״ד'], openRes: [/^(ראב["״]ד)/], tier: 'outer_commentaries' },
  { name: 'Pnei Moshe', nameHe: 'פני משה', styleSubstrings: ['pnei moshe', 'פני משה'], openRes: [/^(פני משה)/], tier: 'outer_commentaries' },
  { name: 'Korban HaEdah', nameHe: 'קרבן העדה', styleSubstrings: ['korban haedah', 'korban ha-eda', 'קרבן העדה'], openRes: [/^(קרבן העדה)/], tier: 'outer_commentaries' },
  { name: 'Ridvaz', nameHe: 'רי״דב״ז', styleSubstrings: ['ridvaz', 'רידבז', 'רי״דב״ז'], openRes: [/^(רי["״]דב["״]ז)/], tier: 'outer_commentaries' },
  { name: 'Metzudot', nameHe: 'מצודות', styleSubstrings: ['metzudot', 'metzudat david', 'metzudat tzion', 'מצודות', 'מצודת דוד', 'מצודת ציון'], openRes: [/^(מצודת דוד|מצודת ציון|מצודות)/], tier: 'outer_commentaries' },
  { name: 'Radak', nameHe: 'רד״ק', styleSubstrings: ['radak', 'רדק', 'רד״ק'], openRes: [/^(רד["״]ק)/], tier: 'outer_commentaries' },
  { name: 'Malbim', nameHe: 'מלבי״ם', styleSubstrings: ['malbim', 'מלבים', 'מלבי״ם'], openRes: [/^(מלבי["״]ם)/], tier: 'outer_commentaries' },
  { name: 'Biur Halacha', nameHe: 'ביאור הלכה', styleSubstrings: ['biur halacha', 'ביאור הלכה'], openRes: [/^(ביאור הלכה)/], tier: 'outer_commentaries' },
  { name: "Sha'ar HaTziyun", nameHe: 'שער הציון', styleSubstrings: ["sha'ar hatziyun", 'shaar hatziyun', 'שער הציון'], openRes: [/^(שער הציון)/], tier: 'footnotes' },
  { name: 'Drishah', nameHe: 'דרישה', styleSubstrings: ['drishah', 'דרישה'], openRes: [/^(דרישה)/], tier: 'outer_commentaries' },
  { name: 'Prishah', nameHe: 'פרישה', styleSubstrings: ['prishah', 'פרישה'], openRes: [/^(פרישה)/], tier: 'outer_commentaries' },
  { name: 'Shaarei Teshuvah', nameHe: 'שערי תשובה', styleSubstrings: ['shaarei teshuvah', 'שערי תשובה'], openRes: [/^(שערי תשובה)/], tier: 'outer_commentaries' },
  { name: 'Onkelos', nameHe: 'אונקלוס', styleSubstrings: ['onkelos', 'targum', 'אונקלוס', 'תרגום'], openRes: [/^(אונקלוס|תרגום)/], tier: 'outer_commentaries' },
  { name: 'Ramban', nameHe: 'רמב״ן', styleSubstrings: ['ramban', 'nachmanides', 'רמב״ן'], openRes: [/^(רמב["״]ן)/], tier: 'outer_commentaries' },
  { name: 'Ibn Ezra', nameHe: 'אבן עזרא', styleSubstrings: ['ibn ezra', 'ibnezra', 'אבן עזרא'], openRes: [/^(אבן עזרא|אב"ע|ראב"ע)/], tier: 'outer_commentaries' },
  { name: 'Sforno', nameHe: 'ספורנו', styleSubstrings: ['sforno', 'ספורנו'], openRes: [/^(ספורנו)/], tier: 'outer_commentaries' },
  { name: 'Ralbag', nameHe: 'רלב״ג', styleSubstrings: ['ralbag', 'gersonides', 'רלב״ג'], openRes: [/^(רלב["״]ג)/], tier: 'outer_commentaries' },
  { name: 'Shach', nameHe: 'ש״ך', styleSubstrings: ['shach', 'shakh', 'ש״ך', 'שך'], openRes: [/^(ש["״]ך)/], tier: 'outer_commentaries' },
  { name: 'Taz', nameHe: 'ט״ז', styleSubstrings: ['taz', 'ט״ז', 'טז'], openRes: [/^(ט["״]ז)/], tier: 'outer_commentaries' },
  { name: "Be'er Hetev", nameHe: 'באר היטב', styleSubstrings: ["be'er hetev", 'beer hetev', 'באר היטב'], openRes: [/^(באר היטב)/], tier: 'outer_commentaries' },
  { name: 'Mishnah Berurah', nameHe: 'משנה ברורה', styleSubstrings: ['mishnah berurah', 'mishna berura', 'משנה ברורה'], openRes: [/^(משנה ברורה|מ"ב)/], tier: 'outer_commentaries' },
  { name: 'Rabbeinu Chananel', nameHe: 'רבינו חננאל', styleSubstrings: ['chananel', 'hananel', 'חננאל'], openRes: [/^(רבינו חננאל|ר"ח)/], tier: 'outer_commentaries' },
  { name: 'Ran', nameHe: 'ר״ן (רבינו ניסים)', styleSubstrings: ['rabbeinu nissim', 'ניסים'], styleRe: /(^|[^a-z])ran([^a-z]|$)/, openRes: [/^(ר["״]ן|רבינו ניסים)/], tier: 'outer_commentaries' },
  { name: 'Rashba', nameHe: 'רשב״א', styleSubstrings: ['rashba', 'רשב״א'], openRes: [/^(רשב["״]א)/], tier: 'outer_commentaries' },
  { name: 'Ritva', nameHe: 'ריטב״א', styleSubstrings: ['ritva', 'ריטב״א'], openRes: [/^(ריטב["״]א)/], tier: 'outer_commentaries' },
  { name: 'Maharsha', nameHe: 'מהרש״א', styleSubstrings: ['maharsha', 'מהרש״א'], openRes: [/^(מהרש["״]א)/], tier: 'outer_commentaries' },
  { name: 'Gilyon HaShas', nameHe: 'גליון הש״ס', styleSubstrings: ['gilyon', 'gilyon ha-shas', 'גליון'], openRes: [/^(גליון|גליון הש״ס)/], tier: 'gilyon_ha_shas' },
  { name: 'Hagahot HaBach', nameHe: 'הגהות הב״ח', styleSubstrings: ['hagahot', 'hagaot', 'habach', 'הגהות', 'ב״ח'], openRes: [/^(הגהות|הגהת הב״ח|ב״ח)/], tier: 'hagahot_ha_bach' },
  // v0.9.3 Part B — the Bach as a Tur commentator. It must sit AFTER
  // Hagahot HaBach (a paragraph opening with 'ב״ח' is Hagahot HaBach,
  // and the bare 'ב״ח' word is a WEAK Tur hint — see the signal
  // table: it needs a Tur marker too). styleRe (word-boundary) so
  // 'habach' does not match here.
  { name: 'Bach', nameHe: 'ב״ח (הטור)', styleSubstrings: [], styleRe: /(^|[^a-z])bach([^a-z]|$)/, openRes: [], tier: 'outer_commentaries' },
  { name: 'Ein Mishpat', nameHe: 'עין משפט', styleSubstrings: ['ein mishpat', 'עין משפט'], openRes: [/^(עין משפט|עֵין מִשְׁפָּט)/], tier: 'ein_mishpat_ner_mitzvah' },
  { name: 'Ner Mitzvah', nameHe: 'נר מצווה', styleSubstrings: ['ner mitzvah', 'נר מצוה', 'נר מצווה'], openRes: [/^(נר מצוה|נר מצווה)/], tier: 'ein_mishpat_ner_mitzvah' },
  { name: 'Masoret HaShas', nameHe: 'מסורת הש״ס', styleSubstrings: ['masoret', 'masores', 'מסורת'], openRes: [/^(מסורת הש״ס|מסורת השס|מסו׳ הש״ס)/], tier: 'masoret_ha_shas' },
  { name: 'Torah Or', nameHe: 'תורה אור', styleSubstrings: ['torah or', 'תורה אור'], openRes: [/^(תורה אור|תּוֹרָה אוֹר)/], tier: 'torah_or' },
]);

/** Detect the commentator of one unit from its style name / opening words. */
export function detectCommentator(unit: ContentUnit): AuthorMarker | null {
  const style = (unit.styleName || '').toLowerCase();
  const text = (unit.rawText || '').trim();
  for (const m of AUTHOR_MARKERS) {
    if (m.styleSubstrings.some(s => style.includes(s))) return m;
    if (m.styleRe && m.styleRe.test(style)) return m;
    if (m.openRes.some(re => re.test(text))) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier mapping for one unit
// ---------------------------------------------------------------------------

/** Map one imported unit to Vilna-Daf tiers (a unit can feed several signals, but one primary tier). */
export function classifyUnitTier(unit: ContentUnit): { tier: VilnaTierId; reason: string } | null {
  const text = (unit.rawText || '').trim();
  const style = (unit.styleName || '').toLowerCase();
  // Title page: the very first units, before any body text.
  if (unit.role === 'main_title' || unit.role === 'subtitle') {
    return { tier: 'title_page', reason: `role ${unit.role}` };
  }
  // Header band: folio / daf number, running header, tractate + chapter line.
  if (unit.role === 'page_element') {
    return { tier: 'header_band', reason: 'running header / folio element' };
  }
  if (/^(דף|דף\s+)[א-ת]+[׳״]?\s*[אב]?\s*\.?$/.test(text) || /מסכת\s+\S+\s+דף\s+[א-ת]/.test(text)) {
    return { tier: 'header_band', reason: 'daf number' };
  }
  if (unit.role === 'chapter' || unit.role === 'heading') {
    return { tier: 'header_band', reason: `chapter heading (${unit.role})` };
  }
  // Mishna: the Shas classifier already tags it main_source/Mishna.
  if (unit.role === 'main_source' && (/^(משנה|מִשְׁנָה|מתניתין|מַתְנִיתִין)/.test(text) || style.includes('mishna'))) {
    return { tier: 'mishna', reason: 'Mishna opening' };
  }
  // Named commentators (incl. the marginalia from the Vilna anatomy).
  const author = detectCommentator(unit);
  if (author) {
    return { tier: author.tier, reason: `commentator ${author.name}` };
  }
  // Shas semantic roles (Ein Mishpat / Masoret / Torah Or / cross-refs).
  const shas = classifyShasParagraph(text, style);
  if (shas) {
    if (shas.role === 'tertiary_comment') {
      const tier: VilnaTierId =
        /עין משפט|נר מצו/.test(text) || style.includes('ein mishpat') || style.includes('ner mitzvah')
          ? 'ein_mishpat_ner_mitzvah'
          : /מסורת/.test(text) || style.includes('masoret')
            ? 'masoret_ha_shas'
            : /תורה אור/.test(text) || style.includes('torah or')
              ? 'torah_or'
              : 'ein_mishpat_ner_mitzvah';
      return { tier, reason: `Shas marginalia (${shas.styleName})` };
    }
    if (shas.role === 'cross_reference' || shas.role === 'side_note') {
      return { tier: 'masoret_ha_shas', reason: `cross-reference (${shas.styleName})` };
    }
  }
  // Yiddish kinds feed the Yiddish recipe, not a Vilna tier.
  if (unit.language === 'yi' || unit.yiddishKind) return null;
  if (unit.role === 'main_source') {
    return { tier: 'gemara', reason: 'central source text' };
  }
  // Role-only fallback, kept STRICT: a bare primary_comment is Rashi
  // only when it carries a dibbur or a Rashi style name — otherwise a
  // generic commentary file (the modal lets the user assign the role
  // per file) must NOT score as Vilna Rashi, or every commentary-heavy
  // document would auto-select Vilna Shas and the two-column fallback
  // could never fire. Same for Tosafot.
  if (unit.role === 'primary_comment') {
    const isRashi = Boolean(unit.dibburHamatchil) || /רש|rashi/i.test(unit.styleName || '');
    return { tier: isRashi ? 'rashi_inner' : 'outer_commentaries', reason: isRashi ? 'primary (inner) commentary with dibbur' : 'generic primary commentary' };
  }
  if (unit.role === 'secondary_comment') {
    const isTosafot = Boolean(unit.dibburHamatchil) || /תוס|tosafot/i.test(unit.styleName || '');
    return { tier: isTosafot ? 'tosafot_outer' : 'outer_commentaries', reason: isTosafot ? 'secondary (outer) commentary with dibbur' : 'generic secondary commentary' };
  }
  // v0.9.7 — tertiary_comment had NO tier: a file tagged "third
  // commentary" contributed nothing to genre scoring, so a Shas import
  // with an Ein Mishpat file scored exactly like one without it.
  // Named tertiary commentators are caught above (author / Shas
  // marginalia); an unnamed tertiary file is an outer commentary.
  if (unit.role === 'tertiary_comment') {
    return { tier: 'outer_commentaries', reason: 'third commentary tier (user-tagged tertiary file)' };
  }
  if (unit.role === 'footnote') {
    return { tier: 'footnotes', reason: 'footnote' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Document classification
// ---------------------------------------------------------------------------

const CHASSIDIC_MARKERS = [/דרוש/, /חסידות/, /בעל שם טוב/, /אדמו["״]ר/, /מאמר חסידי/, /ליקוטי/, /תניא/, /שפת אמת/];
const RESPONSA_MARKERS = [/^שאלה:/, /^תשובה:/, /שאלה ותשובה/, /שו["״]ת/];
const SHULCHAN_ARUCH_MARKERS = [/שולחן ערוך/, /אורח חיים/, /יורה דעה/, /אבן העזר/, /חושן משפט/];
const MISHNAH_BERURAH_MARKERS = [/משנה ברורה/, /ביאור הלכה/, /שער הציון/];

/**
 * Layout training T6 — Gemara-only evidence in the source text. Rashi
 * alone is NOT evidence of a Gemara: a Chumash, a Mishnah or a Rif
 * carries Rashi too.
 */
const TALMUD_SOURCE_MARKERS: RegExp[] = [
  /(?:^|\s)(?:מתני[׳']|מתניתין|גמ[׳']|גמרא)[:.]?(?=\s|$)/,
  /(?:^|\s)(?:תנו\s+רבנן|ת["״]ר|תניא|איתמר|תא\s+שמע|ת["״]ש|מאי\s+טעמא|מ["״]ט|אמר\s+מר|איבעיא\s+להו|מיתיבי|תיובתא|הדרן\s+עלך)(?=\s|$|[:.,])/,
];

const TORAH_BOOKS = ['בראשית', 'שמות', 'ויקרא', 'במדבר', 'דברים'];
const PARSHIYOT = [
  // Short names are ordinary words in any heading — only with "פרשת".
  'פרשת נח', 'פרשת בא', 'פרשת צו', 'פרשת ראה', 'פרשת שלח',
  'לך לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא', 'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי',
  'וארא', 'בשלח', 'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא', 'ויקהל', 'פקודי',
  'שמיני', 'תזריע', 'מצורע', 'אחרי מות', 'קדושים', 'אמור', 'בהר', 'בחוקותי', 'בחקתי',
  'נשא', 'בהעלותך', 'קרח', 'חקת', 'בלק', 'פינחס', 'פנחס', 'מטות', 'מסעי',
  'ואתחנן', 'עקב', 'שופטים', 'כי תצא', 'כי תבוא', 'נצבים', 'וילך', 'האזינו', 'וזאת הברכה',
  'chumash', 'chumish', 'bereishit', 'bereshit', 'shemot', 'vayikra', 'bamidbar', 'devarim', 'parashat', 'parshat', 'mikraot', 'torah',
];

/** Torah book / parsha names in a title, file name or headings (strong Chumash signal). */
function countTorahBookNames(text: string): number {
  const t = text.replace(/[\u0591-\u05C7]/g, '').replace(/[_\-.]+/g, ' ').toLowerCase();
  let n = 0;
  for (const name of [...TORAH_BOOKS, ...PARSHIYOT]) {
    const re = new RegExp(`(?:^|[^\\u05D0-\\u05EAa-z])${name}(?=$|[^\\u05D0-\\u05EAa-z])`);
    if (re.test(t)) n++;
  }
  return n;
}

export function classifyDocument(
  units: ContentUnit[],
  links: RavTextLink[] = [],
  opts?: { fileName?: string; hasFootnotes?: boolean }
): DocumentClassification {
  const roles: Record<string, number> = {};
  const tierCounts = Object.fromEntries(VILNA_TIER_IDS.map(id => [id, 0])) as Record<VilnaTierId, number>;
  const tierReasons: Partial<Record<VilnaTierId, string[]>> = {};
  const authors: string[] = [];
  const authorTiers = new Set<VilnaTierId>();
  let yiddishUnits = 0;
  let hebrewUnits = 0;
  let hasDibbur = links.length > 0;
  let chassidicHits = 0;
  let responsaHits = 0;
  let shulchanAruchHits = 0;
  let mishnahBerurahHits = 0;
  let verseUnits = 0;
  let simanUnits = 0;
  let taamimUnits = 0;
  let sofPasukUnits = 0;
  let vocalizedSourceUnits = 0;
  let talmudUnits = 0;
  let dafHeadings = 0;

  for (const u of units) {
    const text = u.rawText || '';
    roles[u.role] = (roles[u.role] ?? 0) + 1;
    if (u.dibburHamatchil) hasDibbur = true;
    const yid = u.language === 'yi' || detectYiddish(text).isYiddish;
    if (yid) yiddishUnits += 1;
    else if (/[\u0590-\u05FF]/.test(text)) hebrewUnits += 1;
    if (u.role === 'verse') verseUnits += 1;
    if (u.role === 'siman' || u.role === 'seif') simanUnits += 1;
    if (/[\u0591-\u05AF]/.test(text)) taamimUnits += 1;
    if (u.role === 'main_source' || u.role === 'verse') {
      const letters = (text.match(/[\u05D0-\u05EA]/g) ?? []).length;
      const vowels = (text.match(/[\u05B0-\u05BC\u05C1\u05C2\u05C7]/g) ?? []).length;
      if (letters >= 8 && vowels / letters > 0.5) vocalizedSourceUnits += 1;
      const talmudic = TALMUD_SOURCE_MARKERS.some(re => re.test(text));
      // A sof pasuk is ׃ — or a ':' ENDING a pointed unit that is not
      // Gemara (pointed Gemara has "אָמַר לָהֶם:" in every line; counting
      // those made a vocalized Shas look like a Chumash).
      if (/\u05C3/.test(text) || (!talmudic && vowels / Math.max(1, letters) > 0.5 && /[\u05B0-\u05BC][^\s:]*\s*:\s*$/.test(text))) sofPasukUnits += 1;
      if (talmudic) talmudUnits += 1;
    }
    // Layout training T13 — "דף ב." / "דף ב:" / "דף ב ע״א" headings mark a Talmud folio file.
    if ((u.role === 'heading' || u.role === 'chapter' || u.role === 'subtitle') && /^\s*דף\s+[א-ת"״׳']{1,4}\s*(?:[.:]|ע["״]?[אב])?\s*$/.test(text.replace(/[\u0591-\u05C7]/g, ''))) dafHeadings += 1;
    const tier = classifyUnitTier(u);
    if (tier) {
      tierCounts[tier.tier] += 1;
      const arr = tierReasons[tier.tier] ?? [];
      if (!arr.includes(tier.reason)) arr.push(tier.reason);
      tierReasons[tier.tier] = arr;
    }
    const author = detectCommentator(u);
    if (author) {
      if (!authors.includes(author.name)) authors.push(author.name);
      authorTiers.add(author.tier);
    }
    for (const re of CHASSIDIC_MARKERS) if (re.test(text)) { chassidicHits += 1; break; }
    for (const re of RESPONSA_MARKERS) if (re.test(text)) { responsaHits += 1; break; }
    for (const re of SHULCHAN_ARUCH_MARKERS) if (re.test(text)) { shulchanAruchHits += 1; break; }
    for (const re of MISHNAH_BERURAH_MARKERS) if (re.test(text)) { mishnahBerurahHits += 1; break; }
  }
  // Extra commentaries at the END of the volume: commentary units that
  // appear after the last main-source unit (the diagram's note).
  const lastSourceIdx = units.reduce((acc, u, i) => (u.role === 'main_source' ? i : acc), -1);
  if (lastSourceIdx >= 0) {
    const tailCommentaries = units.slice(lastSourceIdx + 1).filter(u => u.role === 'primary_comment' || u.role === 'secondary_comment' || u.role === 'tertiary_comment');
    if (tailCommentaries.length >= 2) {
      tierCounts.end_of_volume = tailCommentaries.length;
      tierReasons.end_of_volume = ['commentaries after the last source unit (end of volume)'];
    }
  }

  const textUnits = Math.max(1, units.filter(u => u.role !== 'footnote' && u.role !== 'table' && u.role !== 'image').length);
  const isYiddish = yiddishUnits * 2 > textUnits;
  const hasFootnotes = (roles.footnote ?? 0) > 0 || opts?.hasFootnotes === true;
  const languages: string[] = [];
  if (hebrewUnits > 0 || !isYiddish) languages.push('he');
  if (yiddishUnits > 0) languages.push('yi');

  // Genre hint — the single strongest genre signal, for the scorer.
  let genreHint: string | undefined;
  const tzenerene = units.some(u => u.yiddishKind === 'tzenerene');
  if (tzenerene) genreHint = 'yiddish';
  else if (isYiddish) genreHint = 'yiddish';
  else if (tierCounts.rashi_inner > 0 && tierCounts.tosafot_outer > 0) genreHint = 'talmud';
  else if (verseUnits > 0 && authors.length >= 2) genreHint = 'tanakh';
  // many Chassidic markers outweigh a few halachic quotes (a drush sefer
  // cites the Shulchan Aruch; a Shulchan Aruch is not Chassidic)
  else if (chassidicHits >= 5 && chassidicHits >= 2 * shulchanAruchHits && simanUnits === 0) genreHint = 'chassidic';
  else if (shulchanAruchHits > 0 || simanUnits > 0) genreHint = 'halacha';
  else if (responsaHits > 0) genreHint = 'responsa';
  else if (chassidicHits > 0) genreHint = 'chassidic';
  else if (mishnahBerurahHits > 0) genreHint = 'halacha';
  else genreHint = 'prose';

  const titlePage = classifyTitlePageStructure(units);

  // --- v0.9.3 Part B: genre signals + role patterns (research note,
  // "Classifier rules"). Title-page wording + file name first (the
  // strongest placement), then the first pages of body text, then
  // every unit's style name — commentary markers live in styles even
  // late in the book. A signal is recorded even when weak; whether
  // it may decide is the scorer's job (weak hints need a second
  // signal, publisher hints need a Gemara role pattern).
  const titleText = [opts?.fileName ?? '', titlePage.title ?? '', titlePage.subtitle ?? '', titlePage.author ?? ''].join(' ');
  // Layout training T6 — genre words are read from the book's OWN text
  // (main text and headings), never from its commentaries: Rashi on the
  // Chumash says "דבר אחר" (read as Midrash) and Rashi on Berakhot cites
  // the "ירושלמי" (read as a Talmud Yerushalmi).
  const bodyText = units
    .filter(u => u.role === 'main_source' || u.role === 'verse' || u.role === 'chapter' || u.role === 'heading' || u.role === 'main_title' || u.role === 'subtitle' || u.role === 'regular_paragraph')
    .slice(0, 20)
    .map(u => u.rawText || '')
    .join(' ');
  const styleText = units.map(u => u.styleName || '').join(' ');
  // Layout training T6 — Torah book / parsha names in the title, file
  // name or chapter headings: a Chumash, never a Gemara.
  const headingText = units
    .filter(u => u.role === 'chapter' || u.role === 'heading' || u.role === 'main_title' || u.role === 'subtitle')
    .map(u => u.rawText || '')
    .join(' ');
  const torahBook = countTorahBookNames(`${titleText} ${headingText}`);
  const signals: GenreSignal[] = [];
  for (const [text, source] of [[titleText, 'title'], [bodyText, 'text'], [styleText, 'style']] as const) {
    for (const sig of matchGenreSignals(text, source)) {
      if (!signals.some(s => s.key === sig.key)) signals.push(sig);
    }
  }
  // Structural role patterns (the "second signal" weak hints need).
  // Verse presence is a verse role OR cantillation marks on source
  // units — the importer never assigns the 'verse' role, and Chumash
  // verses carry taamim where Gemara does not.
  const versePresent = verseUnits > 0 || taamimUnits >= 2;
  const scanText = normalizeGenreScanText(`${titleText} ${bodyText}`);
  const hasPrayerMarkers =
    /(?:^|(?<=[^\u0590-\u05ff]))(?:[בהולכמש])?(שחרית|מנחה|מעריב|תפילה)(?=[^\u0590-\u05ff]|$)/.test(scanText) ||
    /\b(shacharit|mincha|maariv|amidah)\b/.test(scanText);
  const rolePatterns: string[] = [];
  if (tierCounts.rashi_inner > 0 && tierCounts.tosafot_outer > 0) rolePatterns.push('gemara-flanks');
  if (tierCounts.mishna > 0) rolePatterns.push('mishnah-structure');
  if (tierCounts.mishna > 0 && (authors.includes('Bartenura') || authors.includes('Tosafot Yom Tov'))) rolePatterns.push('mishnah-commentary');
  if (versePresent && authors.length >= 2) rolePatterns.push('verse-commentaries');
  if (versePresent && authors.includes('Onkelos')) rolePatterns.push('verse-targum');
  if (versePresent) rolePatterns.push('verse-present');
  if (simanUnits > 0) rolePatterns.push('siman-seif');
  if (simanUnits > 0 && authors.length >= 1) rolePatterns.push('siman-commentaries');
  if (/(?:^|(?<=[^\u0590-\u05ff]))סק(?=[^\u0590-\u05ff]|$)/.test(scanText)) rolePatterns.push('mb-seif-katan');
  if (hasPrayerMarkers) rolePatterns.push('prayer');
  if (/הלכה [א-ת](?![\u0590-\u05ff])/.test(scanText) || /\bhalakha\b/.test(scanText)) rolePatterns.push('yerushalmi-halakhot');

  return {
    genreHint,
    roles,
    languages,
    hasDibbur,
    commentaryCount: authors.length,
    isYiddish,
    hasFootnotes,
    tierCounts,
    tierReasons,
    commentaryAuthors: authors,
    titlePage: titlePage.isTitlePage ? titlePage : undefined,
    distinctCommentaryAuthors: authors.length,
    markers: { responsa: responsaHits, chassidic: chassidicHits, shulchanAruch: shulchanAruchHits, mishnahBerurah: mishnahBerurahHits, taamimUnits, torahBook, sofPasukUnits, vocalizedSourceUnits, talmudUnits, dafHeadings },
    signals,
    rolePatterns,
  };
}

// ---------------------------------------------------------------------------
// Historical recipe catalogue (local fallback — same ids as Part A's engine)
// ---------------------------------------------------------------------------

export interface HistoricalRecipe {
  id: string;
  nameHe: string;
  nameEn: string;
  /** BookLayoutType this recipe paginates with. */
  layoutType: BookLayoutType;
  /** READY_DESIGNS preset id, when one exists (undefined = layout type only). */
  readyDesignId?: string;
  genre: string;
  /** One-line summary, used in the UI line + Gemini prompt context. */
  summaryHe: string;
  summaryEn: string;
  /** Deterministic typographic rules the recipe applies. */
  rules: string[];
  /** Name aliases for the NL parser (Hebrew + English). */
  aliases: string[];
}

// ---------------------------------------------------------------------------
// Recipe table (v0.9.5) — ONE source of truth in historical-layouts.ts.
// Geometry, names, descriptions, rules and NL aliases all live in the
// unified library there (HISTORICAL_LAYOUTS + HISTORICAL_RECIPE_RULES +
// HISTORICAL_RECIPE_ALIASES); this file only converts the library into
// the C-facing HistoricalRecipe shape below. The two fallback layouts
// are NOT recipes: plain layout types, stated as defaults when
// confidence is low.
// ---------------------------------------------------------------------------





/**
 * v0.9.9 — THE single id-based recipe applier. It is a thin resolver,
 * not a second engine: it resolves the id (aliases included) and
 * delegates to the ONE object applier in layout-recipes.ts, then
 * layers the per-genre typography on top. It lives here — not in
 * layout-recipes.ts — because resolving an id needs historical-layouts,
 * and layout-recipes importing historical-layouts would be a cycle
 * (historical-layouts reads KETER_TEMPLATE_VERSION from layout-recipes
 * at module init). Stated fallbacks ('single-column' / 'two-column')
 * are plain layout types, not recipes. Unknown ids return the
 * settings unchanged — never guessed.
 */
export function applyRecipeToSettingsById(
  recipeId: string,
  settings: ProfessionalDesignSettings
): ProfessionalDesignSettings {
  if (recipeId === 'single-column') {
    return DesignSettingsEngine.updateLayoutSettings(settings, { layoutType: 'single_column' }, 'ai');
  }
  if (recipeId === 'two-column') {
    return DesignSettingsEngine.updateLayoutSettings(settings, { layoutType: 'two_column' }, 'ai');
  }
  const recipe = resolveHistoricalRecipe(recipeId);
  if (!recipe) return settings;
  const resolvedId = recipe.metadata.id;
  let next: ProfessionalDesignSettings;
  try {
    next = applyRecipeToSettingsEngine(recipe, settings);
  } catch {
    // A recipe that cannot apply must never leave the import unlaid-out:
    // fall back to the layout type alone.
    return DesignSettingsEngine.updateLayoutSettings(
      settings, { layoutType: recipe.baseLayout ?? 'rav_text' }, 'ai');
  }
  next = applyGenreTypography(resolvedId, next);
  // Layout training T2.3 — a Vilna-family folio is laid out by the real
  // Tzuras HaDaf engine (rav_text: stepped knee, Rashi inner / Tosafot
  // outer mirrored per amud, running head, opening frame), not by the
  // recipe's fixed rectangles. The rectangles cannot step around the
  // Gemara or mirror per amud, which the training harness measured as
  // 1.75× the Vilna page count and Rashi on the wrong side of 4/7 pages.
  if (VILNA_KNEE_RECIPES.has(resolvedId)) {
    next = DesignSettingsEngine.updateLayoutSettings(next, { layoutType: 'rav_text' }, 'ai');
  }
  // Layout training T8 — a plain design (running head + body + notes, no
  // commentary regions) is laid out by the built-in engine of its base
  // layout (single / two columns: headings span the block, columns
  // balance, notes at the foot) — not by custom boxes.
  if (
    (recipe.baseLayout === 'single_column' || recipe.baseLayout === 'two_column') &&
    recipe.regions.every(r => /^(header|main_text|footnote)(-|$)/.test(r.id))
  ) {
    next = DesignSettingsEngine.updateLayoutSettings(next, { layoutType: recipe.baseLayout }, 'ai');
  }
  // Layout training T7 — a Chumash-family design is laid out by the
  // Mikraot Gedolot engine (pasuk + Onkelos, titled commentary bands).
  if (MIKRAOT_RECIPES.has(resolvedId)) {
    next = DesignSettingsEngine.updateLayoutSettings(next, { layoutType: 'mikraot_gedolot' }, 'ai');
  }
  // Layout training T5 — the design's own sefer type decides which
  // type-specific rules are on (a Chumash recipe never keeps Gemara rules).
  next = DesignSettingsEngine.applySeferType(next, seferTypeForRecipe(resolvedId, recipe.baseLayout ?? 'single_column'));
  return next;
}

/** Recipes whose page is a Chumash / Mikraot Gedolot page (T7 engine). */
export const MIKRAOT_RECIPES: ReadonlySet<string> = new Set(['mikraot-gedolot', 'chumash-rishonim', 'chumash', 'tanach-commentary']);

/** Recipes whose page is a Vilna Tzuras HaDaf (laid out by the rav_text knee engine). */
export const VILNA_KNEE_RECIPES: ReadonlySet<string> = new Set(['talmud-bavli', 'vilna-shas', 'shas-oz-vehadar']);

/** Stated fallback layouts (plain layout types, not recipes). */
const FALLBACK_RECIPES: ReadonlyArray<HistoricalRecipe> = Object.freeze([
  {
    id: 'single-column',
    nameHe: 'טור אחד (ברירת מחדל לפרוזה)',
    nameEn: 'Single Column (prose default)',
    layoutType: 'single_column',
    genre: 'prose',
    summaryHe: 'טקסט רץ בטור אחד מיושר — ברירת המחדל לטקסט פרוזה.',
    summaryEn: 'Single justified running column — the default for prose text.',
    rules: ['Single justified column', 'No first-line indent', 'Footnotes at the bottom of the page'],
    aliases: ['single column', 'one column', 'טור אחד', 'plain book', 'simple book'],
  },
  {
    id: 'two-column',
    nameHe: 'שני טורים (ברירת מחדל למפרשים)',
    nameEn: 'Two Columns (commentary default)',
    layoutType: 'two_column',
    genre: 'prose',
    summaryHe: 'שני טורים מאוזנים — ברירת המחדל לטקסט עתיר מפרשים שלא זוהה בוודאות.',
    summaryEn: 'Two balanced columns — the default for commentary-heavy text not identified with confidence.',
    rules: ['Two balanced columns', 'Balanced column heights', 'Gutter scales with column count'],
    aliases: ['two columns', 'two column', 'שני טורים', 'two balanced columns'],
  },
]);

/** One Part A recipe as the C-facing HistoricalRecipe shape. */
/** One library recipe as the C-facing HistoricalRecipe shape. */
function toHistoricalRecipe(a: LayoutRecipe): HistoricalRecipe {
  // v0.9.5: everything comes from the unified library in
  // historical-layouts.ts — names + summaries from the recipe metadata
  // (descriptionHe falls back to the English description when a recipe
  // has none; defensive — the unified library gives every recipe both),
  // rules + NL aliases from the unified catalogue tables keyed by the
  // same id. Alias entries (vilna-shas, tzenerene) are converted under
  // their own id with their own metadata names — no override, no
  // special case. Part A applies every recipe as a custom layout
  // (regions → boxes).
  const id = a.metadata.id;
  return {
    id,
    nameHe: a.metadata.nameHe ?? a.metadata.name,
    nameEn: a.metadata.name,
    // v0.9.9 — the recipe's REAL base layout (the pagination solver
    // still runs the custom box flow for it — see layout-recipes.ts —
    // but the DECISION now carries the layout the recipe declares, so
    // handleImportUnits no longer creates a 'custom_layout' book from
    // a Vilna Shas recipe).
    layoutType: a.baseLayout ?? resolveHistoricalRecipe(a.metadata.id)?.baseLayout ?? 'custom_layout',
    genre: a.metadata.genre[0] ?? '',
    summaryHe: a.metadata.descriptionHe ?? a.metadata.description,
    summaryEn: a.metadata.description,
    rules: HISTORICAL_RECIPE_RULES[id] ?? [],
    // Deduped so the id / name / nameHe appended below never repeat an
    // alias already listed in the unified table.
    aliases: [...new Set([...(HISTORICAL_RECIPE_ALIASES[id] ?? []), a.metadata.id, a.metadata.name, a.metadata.nameHe ?? ''])],
  };
}


/**
 * v0.9.9 — the adapter table is DELETED: there is no second copy of
 * the library any more. Every HistoricalRecipe is projected on demand
 * from the one registry in historical-layouts.ts (HISTORICAL_LAYOUTS),
 * so a recipe edited there can never drift from the one the
 * classifier / AI / banner sees.
 */
export function getRecipeByIdLocal(id: string): HistoricalRecipe | undefined {
  const fallback = FALLBACK_RECIPES.find(r => r.id === id);
  if (fallback) return fallback;
  // getHistoricalRecipe returns the alias entry as-is (own id, own
  // metadata names) — 'vilna-shas' stays 'vilna-shas' here; the
  // applier resolves it to 'talmud-bavli' when it applies.
  const recipe = getHistoricalRecipe(id);
  return recipe ? toHistoricalRecipe(recipe) : undefined;
}

/** The whole library as HistoricalRecipe projections (name search, AI prompt context). */
export function getAllHistoricalRecipes(): HistoricalRecipe[] {
  return [...HISTORICAL_LAYOUTS.map(r => toHistoricalRecipe(r)), ...FALLBACK_RECIPES];
}

/** Find a recipe by a free-text name (Hebrew or English, from NL / Gemini). */
export function findRecipeByName(text: string): HistoricalRecipe | undefined {
  const norm = normalizeHebrewForMatch(text).toLowerCase();
  if (!norm) return undefined;
  // Longest alias first, so "shulchan aruch 2-column" beats "shulchan aruch".
  const scored: Array<{ recipe: HistoricalRecipe; len: number }> = [];
  for (const r of getAllHistoricalRecipes()) {
    for (const alias of r.aliases) {
      const a = normalizeHebrewForMatch(alias).toLowerCase();
      if (a && norm.includes(a)) scored.push({ recipe: r, len: a.length });
    }
    const name = normalizeHebrewForMatch(r.nameEn).toLowerCase();
    if (name && norm.includes(name)) scored.push({ recipe: r, len: name.length });
  }
  scored.sort((a, b) => b.len - a.len);
  return scored[0]?.recipe;
}

// ---------------------------------------------------------------------------
// Recipe suggestion (contract shape: { recipeId, confidence, reasons })
// ---------------------------------------------------------------------------

export interface RecipeSuggestion {
  recipeId: string;
  confidence: number;
  reasons: string[];
}

export interface AutoLayoutDecision extends RecipeSuggestion {
  layoutType: BookLayoutType;
  reasonsHe: string[];
  /** True when no recipe scored high enough — a stated default, not a guess. */
  isFallback: boolean;
  fallbackKind?: 'single_column' | 'two_column';
  /** The one clear line shown to the user after import. */
  lineHe: string;
  lineEn: string;
}

/** Minimum score for a confident (non-fallback) recipe choice. */
export const AUTO_LAYOUT_CONFIDENT_SCORE = 5;

interface ScoredRecipe {
  recipe: HistoricalRecipe;
  score: number;
  reasons: string[];
  reasonsHe: string[];
}

function scoreRecipes(c: DocumentClassification): ScoredRecipe[] {
  const t = c.tierCounts;
  const out: ScoredRecipe[] = [];
  const push = (recipe: HistoricalRecipe, score: number, reasons: string[], reasonsHe: string[]) => {
    if (score > 0) out.push({ recipe, score, reasons, reasonsHe });
  };

  // Vilna Shas — the full daf anatomy.
  {
    let s = 0;
    const r: string[] = [];
    const rh: string[] = [];
    // Layout training T6 — Rashi + a main text with dibburim is just as
    // true of a Chumash; only Gemara evidence (Tosafot, מתני׳/גמ׳, Talmud
    // phrasing) earns the full Vilna score.
    // Gemara phrasing must run through the text: a drush sefer QUOTES the
    // Gemara ("תנו רבנן", "גמ׳") in a few paragraphs out of hundreds
    // (Kedushat Levi: 23 of 1,469) — that is not a tractate.
    const mainCount = Math.max(1, c.roles.main_source ?? 0);
    const talmudDense = (c.markers.talmudUnits ?? 0) >= 3 && (c.markers.talmudUnits ?? 0) >= mainCount * 0.1;
    const talmudEvidence = t.tosafot_outer > 0 || talmudDense || t.mishna > 0 || (c.markers.dafHeadings ?? 0) >= 2;
    if (t.rashi_inner > 0) {
      s += talmudEvidence ? 3 : 1;
      r.push('Rashi detected (inner commentary)');
      rh.push('זוהה רש״י');
    }
    if (t.tosafot_outer > 0) { s += 3; r.push('Tosafot detected (outer commentary)'); rh.push('זוהו תוספות'); }
    if (talmudDense) { s += 2; r.push('Gemara phrasing (מתני׳ / גמ׳ / תנו רבנן …)'); rh.push('זוהה לשון גמרא'); }
    // a single prose file with no Talmud evidence at all is not a daf
    if (!talmudEvidence && t.rashi_inner === 0) s = Math.min(s, 2);
    if ((c.markers.torahBook ?? 0) > 0 || (c.markers.sofPasukUnits ?? 0) >= 2) s = Math.max(0, s - 4);
    if (t.mishna > 0) { s += 2; r.push('Mishna block detected'); rh.push('זוהתה משנה'); }
    if (t.gemara > 0 && c.hasDibbur && talmudEvidence) { s += 2; r.push('Gemara with linked dibbur hamatchil'); rh.push('זוהתה גמרא עם דיבור המתחיל'); }
    else if (t.gemara > 0) { s += 1; r.push('central source text detected'); rh.push('זוהה טקסט מקור מרכזי'); }
    const tert = t.ein_mishpat_ner_mitzvah + t.masoret_ha_shas + t.torah_or;
    if (tert > 0) { s += 1; r.push(`${tert} secondary marginalia unit(s) (Ein Mishpat / Masoret HaShas / Torah Or)`); rh.push(`זוהו ${tert} יחידות הערות שוליות (עין משפט / מסורת הש״ס / תורה אור)`); }
    if (t.gilyon_ha_shas > 0) { s += 1; r.push('Gilyon HaShas marginal notes detected'); rh.push('זוהה גליון הש״ס'); }
    if (t.hagahot_ha_bach > 0) { s += 1; r.push('Hagahot HaBach marginal notes detected'); rh.push('זוהו הגהות הב״ח'); }
    if (t.outer_commentaries > 0) { s += 1; r.push(`${t.outer_commentaries} outer-margin commentary unit(s) (e.g. Rabbeinu Chananel, Ran)`); rh.push(`זוהו ${t.outer_commentaries} יחידות מפרשים בשוליים החיצוניים`); }
    if (t.header_band > 0) { s += 1; r.push('header band (tractate / chapter / daf number) detected'); rh.push('זוהתה כותרת עליונה (מסכת / פרק / דף)'); }
    push(getRecipeByIdLocal('vilna-shas')!, s, r, rh);
  }
  // Mikraot Gedolot — verse + many commentaries. The importer never
  // assigns the 'verse' role (no Word style means it), so a verse signal
  // is a 'verse' role OR cantillation marks (taamim) on source units —
  // Chumash verses carry taamim, Gemara does not.
  {
    let s = 0;
    const r: string[] = [];
    const rh: string[] = [];
    if ((c.roles.verse ?? 0) > 0 || c.markers.taamimUnits >= 2) { s += 3; r.push('verse (pasuk) units detected'); rh.push('זוהו פסוקים'); }
    if (c.commentaryAuthors.includes('Onkelos')) { s += 2; r.push('Targum Onkelos detected'); rh.push('זוהה תרגום אונקלוס'); }
    // Layout training T6 — Chumash evidence beyond taamim.
    // Parsha headings alone are just as true of a drush sefer on the Torah
    // (Kedushat Levi, Noam Elimelech …): a Chumash also has pesukim,
    // taamim, verse units or meforshim.
    const chumashText = (c.roles.verse ?? 0) > 0 || c.markers.taamimUnits >= 2 || (c.markers.sofPasukUnits ?? 0) >= 2 || c.commentaryCount > 0 || (c.roles.primary_comment ?? 0) + (c.roles.secondary_comment ?? 0) > 0;
    if ((c.markers.torahBook ?? 0) > 0) { s += chumashText ? 5 : 1; r.push('Torah book / parsha name detected'); rh.push('זוהה שם ספר / פרשה בתורה'); }
    if ((c.markers.sofPasukUnits ?? 0) >= 2) { s += 3; r.push('pesukim (sof pasuk) detected'); rh.push('זוהו פסוקים (סוף פסוק)'); }
    if ((c.markers.vocalizedSourceUnits ?? 0) >= 2 && t.rashi_inner > 0 && (c.markers.talmudUnits ?? 0) === 0) {
      s += 2;
      r.push('vocalized main text with Rashi');
      rh.push('טקסט מנוקד עם רש״י');
    }
    const extra = Math.max(0, c.commentaryCount - 2);
    if (extra > 0) { s += Math.min(4, extra); r.push(`${c.commentaryCount} distinct commentators`); rh.push(`זוהו ${c.commentaryCount} מפרשים שונים`); }
    push(getRecipeByIdLocal('mikraot-gedolot')!, s, r, rh);
  }
  // Shulchan Aruch — siman/seif + halachic commentators.
  {
    let s = 0;
    const r: string[] = [];
    const rh: string[] = [];
    if ((c.roles.siman ?? 0) > 0 || (c.roles.seif ?? 0) > 0) { s += 3; r.push('siman / seif structure detected'); rh.push('זוהה מבנה סימן / סעיף'); }
    const hal = c.commentaryAuthors.filter(a => ['Shach', 'Taz', "Be'er Hetev", 'Mishnah Berurah'].includes(a));
    if (hal.length > 0) { s += 2; r.push(`halachic commentators detected (${hal.join(', ')})`); rh.push(`זוהו מפרשי הלכה (${hal.join(', ')})`); }
    if (c.markers.shulchanAruch > 0) { s += 2; r.push('Shulchan Aruch text markers detected'); rh.push('זוהו סימני שולחן ערוך'); }
    push(getRecipeByIdLocal('shulchan-aruch')!, s, r, rh);
  }
  // Responsa — she'elah / teshuvah markers (a question AND an answer).
  {
    let s = 0;
    const r: string[] = [];
    const rh: string[] = [];
    if (c.markers.responsa >= 2) { s += 4; r.push('she\'elah + teshuvah markers detected'); rh.push('זוהו סימני שאלה ותשובה'); }
    if ((c.roles.siman ?? 0) > 0) { s += 1; r.push('siman structure'); rh.push('מבנה סימן'); }
    push(getRecipeByIdLocal('responsa')!, s, r, rh);
  }
  // Chassidic drush — markers counted in classifyDocument via genreHint.
  if (c.genreHint === 'chassidic') {
    push(getRecipeByIdLocal('chassidic-drush')!, 6, ['Chassidic drush markers detected'], ['זוהו סימני דרוש חסידי']);
  }
  // Yiddish / Tzenerene.
  if (c.isYiddish) {
    push(
      getRecipeByIdLocal('yiddish-sefer')!,
      6,
      ['Yiddish is the dominant language'],
      ['היידיש היא השפה הדומיננטית']
    );
  }
  // Machon edition — source on top, long secondary commentary below, no Rashi/Tosafot.
  {
    let s = 0;
    const r: string[] = [];
    const rh: string[] = [];
    if ((c.roles.main_source ?? 0) > 0 && (c.roles.secondary_comment ?? 0) > 0 && t.rashi_inner === 0 && t.tosafot_outer === 0) {
      s += 3;
      r.push('source text with commentary below (no Rashi/Tosafot flanks)');
      rh.push('מקור עם פירוש למטה (ללא רש״י/תוספות בצדדים)');
    }
    if (c.commentaryAuthors.includes('Mishnah Berurah')) { s += 2; r.push('Mishnah Berurah detected'); rh.push('זוהתה משנה ברורה'); }
    push(getRecipeByIdLocal('machon-edition')!, s, r, rh);
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Local implementation of Part A's `suggestRecipe` contract. */
export function suggestRecipeLocal(c: DocumentClassification): RecipeSuggestion {
  const decision = decideAutoLayout(c);
  return { recipeId: decision.recipeId, confidence: decision.confidence, reasons: decision.reasons };
}

/** The Part C classification as the historical library's (smaller) shape. */
function toHistoricalClassification(c: DocumentClassification): HistoricalDocumentClassification {
  return {
    genreHint: c.genreHint,
    roles: c.roles,
    languages: c.languages,
    hasDibbur: c.hasDibbur,
    commentaryCount: c.commentaryCount,
    isYiddish: c.isYiddish,
    hasFootnotes: c.hasFootnotes,
    signals: c.signals,
    rolePatterns: c.rolePatterns,
  };
}

/** A signal-based suggestion as the one-line decision the UI shows. */
function decisionFromSignal(signal: HistoricalRecipeSuggestion): AutoLayoutDecision {
  const recipe = getRecipeByIdLocal(signal.recipeId);
  // Part A applies every recipe as a custom layout.
  // Part A recipes exist in the merged tree, so the recipe metadata
  // above is the display name; an unknown id falls back to the id
  // itself (never a guessed name).
  const display = recipe
    ? { nameHe: recipe.nameHe, nameEn: recipe.nameEn, layoutType: recipe.layoutType }
    : { nameHe: signal.recipeId, nameEn: signal.recipeId, layoutType: 'custom_layout' as BookLayoutType };
  const reasonsHe = signal.reasonsHe ?? signal.reasons;
  return {
    recipeId: signal.recipeId,
    layoutType: display.layoutType,
    confidence: signal.confidence,
    reasons: signal.reasons,
    reasonsHe,
    isFallback: false,
    lineHe: `עומד כ${display.nameHe} — ${reasonsHe.join(' · ')}`,
    lineEn: `Laid out as ${display.nameEn} — ${signal.reasons.join(' · ')}`,
  };
}

/** Full auto-layout decision: best recipe, or a stated fallback. */
export function decideAutoLayout(c: DocumentClassification): AutoLayoutDecision {
  // v0.9.3 Part B — genre signals FIRST, in the research note's
  // specificity order. When a signal is eligible it wins over the
  // score path below (a publisher hint + Gemara flanks is an Oz
  // VeHadar page, not a generic Vilna folio). When no signal is
  // eligible the score path below runs exactly as v0.9.0.
  const bySignals = suggestRecipeBySignals(toHistoricalClassification(c));
  // Layout training T6 — clear Chumash structure (Torah book / parsha
  // names, pesukim with sof pasuk, teamim) outranks a genre word.
  const chumashStructure =
    (c.markers.torahBook ?? 0) > 0 || (c.markers.sofPasukUnits ?? 0) >= 2 || c.markers.taamimUnits >= 2;
  if (bySignals && !(chumashStructure && seferTypeForRecipe(bySignals.recipeId) !== 'chumash')) {
    return decisionFromSignal(bySignals);
  }
  const scored = scoreRecipes(c);
  const best = scored[0];
  if (best && best.score >= AUTO_LAYOUT_CONFIDENT_SCORE) {
    const recipe = best.recipe;
    const confidence = Math.min(0.95, 0.55 + best.score * 0.04);
    return {
      recipeId: recipe.id,
      layoutType: recipe.layoutType,
      confidence,
      reasons: best.reasons,
      reasonsHe: best.reasonsHe,
      isFallback: false,
      lineHe: `עומד כ${recipe.nameHe} — ${best.reasonsHe.join(' · ')}`,
      lineEn: `Laid out as ${recipe.nameEn} — ${best.reasons.join(' · ')}`,
    };
  }
  // Low confidence → sensible default, stated plainly, never guessed silently.
  const commentaryHeavy =
    (c.roles.primary_comment ?? 0) + (c.roles.secondary_comment ?? 0) + (c.roles.tertiary_comment ?? 0) >= 4 ||
    c.commentaryCount >= 2;
  const fallback: HistoricalRecipe = getRecipeByIdLocal(commentaryHeavy ? 'two-column' : 'single-column')!;
  const bestNote = best ? ` (best guess was ${best.recipe.nameEn}, score ${best.score}/${AUTO_LAYOUT_CONFIDENT_SCORE})` : '';
  return {
    recipeId: fallback.id,
    layoutType: fallback.layoutType,
    confidence: best ? Math.min(0.45, best.score / 10) : 0.3,
    reasons: [`low confidence — no recipe scored ${AUTO_LAYOUT_CONFIDENT_SCORE}+${bestNote}; defaulted to ${fallback.nameEn}`],
    reasonsHe: [`הסוג לא זוהה בוודאות — הוחלה ברירת המחדל (${fallback.nameHe})`],
    isFallback: true,
    fallbackKind: fallback.layoutType as 'single_column' | 'two_column',
    lineHe: `הסוג לא זוהה בוודאות — עומד ב${fallback.nameHe} (ברירת מחדל). ניתן לשנות את התבנית בכל עת.`,
    lineEn: `Layout not identified with confidence — laid out in ${fallback.nameEn} (default). You can change the layout at any time.`,
  };
}

/**
 * The payload the import modal hands to App with the imported units:
 * the classification and the auto-layout decision (no settings — App
 * applies the decision to its own settings when it loads the snapshot).
 */
export interface AutoLayoutImportInfo {
  classification: DocumentClassification;
  decision: AutoLayoutDecision;
}

/** Classify + decide for an import (pure — no settings needed). */
export function classifyForImport(
  units: ContentUnit[],
  links: RavTextLink[],
  opts?: { fileName?: string; hasFootnotes?: boolean }
): AutoLayoutImportInfo {
  const classification = classifyDocument(units, links, opts);
  const hasTzenerene = units.some(u => u.yiddishKind === 'tzenerene');
  let decision = decideAutoLayout(classification);
  if (hasTzenerene && decision.recipeId !== 'tzenerene') {
    const recipe = getRecipeByIdLocal('tzenerene')!;
    decision = {
      recipeId: recipe.id,
      layoutType: recipe.layoutType,
      confidence: 0.9,
      reasons: ['Tzenerene (Tzena Urena) structure detected'],
      reasonsHe: ['זוהה מבנה צאינה וראינה'],
      isFallback: false,
      lineHe: `עומד כצאינה וראינה — זוהה מבנה צאינה וראינה`,
      lineEn: `Laid out as Tzenerene — Tzenerene (Tzena Urena) structure detected`,
    };
  }
  return { classification, decision };
}

/** The default ready design for each sefer type (when nothing better scored). */
const DEFAULT_RECIPE_FOR_TYPE: Record<SeferType, string> = {
  talmud: 'talmud-bavli',
  chumash: 'mikraot-gedolot',
  mishnah: 'mishnah-classic',
  halacha: 'shulchan-aruch',
  siddur: 'siddur',
  yiddish: 'yiddish-sefer',
  prose: 'single-column',
};

/**
 * Layout training T6 — keep an import inside the book's own type. When
 * the user has made the book a Chumash (or any non-Talmud type), an
 * imported Word file may refine the design WITHIN that type but never
 * turn the book into a Gemara (the reported bug: Chumash + Rashi was
 * "Laid out as Vilna Shas — Rashi detected"). A Talmud book (the app's
 * default) still lets the content decide.
 */
export function constrainDecisionToSeferType(
  decision: AutoLayoutDecision,
  classification: DocumentClassification,
  bookType: SeferType | undefined
): AutoLayoutDecision {
  if (!bookType || bookType === 'talmud') return decision;
  const decidedType = seferTypeForRecipe(decision.recipeId, decision.layoutType);
  if (decidedType === bookType) return decision;
  // Layout training T13 — the FILES win when they are unmistakable: a whole
  // Shas tractate with daf headings imported while the home screen still
  // had the Chumash card selected was laid out as a Mikraot Gedolot.
  const m = classification.markers;
  const clearlyTalmud = (m.dafHeadings ?? 0) >= 2 || ((m.talmudUnits ?? 0) >= 3 && classification.tierCounts.tosafot_outer > 0);
  const clearlyChumash = (m.torahBook ?? 0) > 0 && (m.sofPasukUnits ?? 0) >= 10 && (m.dafHeadings ?? 0) === 0;
  if ((decidedType === 'talmud' && clearlyTalmud) || (decidedType === 'chumash' && clearlyChumash)) {
    return {
      ...decision,
      lineHe: `${decision.lineHe} — הקבצים הם בבירור ${decidedType === 'talmud' ? 'גמרא' : 'חומש'}, ולכן לא נשמר הסוג שנבחר בכרטיס.`,
      lineEn: `${decision.lineEn} — the files are clearly ${decidedType === 'talmud' ? 'Gemara' : 'Chumash'}, so the selected card's type was not kept.`,
    };
  }
  const inType = scoreRecipes(classification).find(sr => seferTypeForRecipe(sr.recipe.id, sr.recipe.layoutType) === bookType);
  const recipeId = inType?.recipe.id ?? DEFAULT_RECIPE_FOR_TYPE[bookType];
  const recipe = getRecipeByIdLocal(recipeId);
  const nameHe = recipe?.nameHe ?? recipeId;
  const nameEn = recipe?.nameEn ?? recipeId;
  return {
    recipeId,
    layoutType: recipe?.layoutType ?? decision.layoutType,
    confidence: Math.max(decision.confidence, 0.7),
    reasons: [`kept the book's type (${bookType}); the file looked like ${decision.recipeId}`],
    reasonsHe: [`נשמר סוג הספר שנבחר`],
    isFallback: false,
    lineHe: `עומד כ${nameHe} — נשמר סוג הספר שבחרתם (הקובץ נראה כמו ${decision.recipeId}). ניתן לשנות בכל עת.`,
    lineEn: `Laid out as ${nameEn} — kept the book type you chose (the file looked like ${decision.recipeId}). You can change it at any time.`,
  };
}

/**
 * One call for the whole import path: classify, decide, apply.
 * Returns the classification, the decision and the updated settings — the
 * caller paginates with `settings` (layoutType is already synced into it).
 */
export function applyAutoLayout(
  units: ContentUnit[],
  links: RavTextLink[],
  settings: ProfessionalDesignSettings,
  opts?: { fileName?: string; hasFootnotes?: boolean }
): { classification: DocumentClassification; decision: AutoLayoutDecision; settings: ProfessionalDesignSettings } {
  const { classification, decision } = classifyForImport(units, links, opts);
  return { classification, decision, settings: applyRecipeToSettingsById(decision.recipeId, settings) };
}

// ---------------------------------------------------------------------------
// Multi-tier grid balancing (Mikraot Gedolot: up to 6 commentaries)
// ---------------------------------------------------------------------------

// v0.9.2 Part A (A4): balanceTierGrid moved to layout-recipes.ts, where
// the engine's applyRecipeToSettings calls it — it was exported here but
// never called anywhere in production, so recipe tier widths summed to
// 188–462%. Re-exported so existing imports keep working.
export { balanceTierGrid } from './layout-recipes';

// ---------------------------------------------------------------------------
// Natural-language layout commands (local parser — no model call)
// ---------------------------------------------------------------------------

export interface AutoLayoutCommand {
  action: 'applyHistoricalLayout' | 'applyRecipe' | 'explainRecipe' | 'changeLayout';
  recipeId?: string;
  /** Template id, when the user names a loaded .keter-template (Part A). */
  templateId?: string;
  replyHe: string;
  /**
   * v0.9.8 Bilingual Audit — English reply for COMPOSED replies (recipe
   * names / template ids interpolated in). Plain literal replies need no
   * replyEn: they go through t(replyHe) via EN_STRINGS.
   */
  replyEn?: string;
  data: Record<string, unknown>;
}

/**
 * Local NL phrases for historical layouts. Examples (all supported):
 * - "Format this text like a Vilna Shas folio"
 * - "Apply a Shulchan Aruch 2-column layout with commentaries below"
 * - "Design a Chassidic Drush page with a decorative Shaar Blatt border"
 * - "Lay it out like Mikraot Gedolot" / "lay it out like <recipe name>"
 * - "Change layout" / "שנה תבנית" · "Explain this layout" / "הסבר את התבנית"
 * - "Apply recipe <id>" / "החל תבנית <name>" (a loaded .keter-template)
 * v0.9.3 Part C — the 18 new genres resolve through the same table
 * (findRecipeByName over getAllHistoricalRecipes(), the unified library): e.g.
 * "Format this like an Oz VeHadar Shas page" → shas-oz-vehadar,
 * "Apply a Mishnah Berurah layout" → mishnah-berurah, "Yerushalmi page"
 * → yerushalmi, "Kehati Mishnah" → mishnah-kehati, "Steinsaltz page" →
 * shas-steinzaltz. A bare mention with no trigger verb ("Yerushalmi
 * page" on its own) still returns null by design, so a question about a
 * layout is never hijacked into an apply card — only an explicit
 * command (format / apply / lay out / design / החל תבנית ...) applies.
 * Unknown names return null, never throw, never guess an id.
 */
export function parseAutoLayoutCommand(userText: string): AutoLayoutCommand | null {
  const lower = userText.toLowerCase();
  const norm = lower.replace(/[־–—-]/g, ' ');
  const recipe = findRecipeByName(userText);
  if (
    norm.includes('change layout') || norm.includes('switch layout') ||
    norm.includes('שנה תבנית') || norm.includes('שנה את התבנית') || norm.includes('החלף תבנית') ||
    norm.includes('change the layout')
  ) {
    return {
      action: 'changeLayout',
      replyHe: 'אפתח את בורר התבניות כדי לבחור עימוד אחר.',
      data: {},
    };
  }
  if (
    (norm.includes('explain') && (norm.includes('layout') || norm.includes('recipe') || norm.includes('template'))) ||
    (norm.includes('הסבר') && (norm.includes('תבנית') || norm.includes('עימוד') || norm.includes('מתכון')))
  ) {
    return {
      action: 'explainRecipe',
      recipeId: recipe?.id,
      replyHe: recipe
        ? `אסביר את תבנית ${recipe.nameHe}: ${recipe.summaryHe}`
        : 'אסביר את התבנית הנוכחית ואת הכללים שלה.',
      replyEn: recipe
        ? `I'll explain the ${recipe.nameEn} template: ${recipe.summaryEn}`
        : "I'll explain the current template and its rules.",
      data: recipe ? { recipeId: recipe.id } : {},
    };
  }
  const applyTemplate = norm.match(/apply (?:the )?template\s+([a-z0-9._-]+)/) ||
    norm.match(/החל תבנית\s+(\S+)/);
  if (applyTemplate) {
    // A named historical recipe ("החל תבנית צאינה וראינה") is a recipe,
    // not a template file — resolve the name first.
    const byName = findRecipeByName(userText);
    if (byName) {
      return {
        action: 'applyRecipe',
        recipeId: byName.id,
        replyHe: `אחיל את תבנית ${byName.nameHe}. יש לאשר בכרטיס.`,
        replyEn: `I'll apply the ${byName.nameEn} template. Please approve on the card.`,
        data: { recipeId: byName.id },
      };
    }
    return {
      action: 'applyRecipe',
      templateId: applyTemplate[1],
      replyHe: `אחיל את התבנית ${applyTemplate[1]} על המסמך. יש לאשר בכרטיס.`,
      replyEn: `I'll apply template ${applyTemplate[1]} to the document. Please approve on the card.`,
      data: { templateId: applyTemplate[1] },
    };
  }
  const applyRecipe = norm.match(/apply (?:the )?recipe\s+([a-z0-9._-]+)/) ||
    norm.match(/החל מתכון\s+(\S+)/);
  if (applyRecipe) {
    const byId = getRecipeByIdLocal(applyRecipe[1]) ?? findRecipeByName(applyRecipe[1]);
    if (byId) {
      return {
        action: 'applyRecipe',
        recipeId: byId.id,
        replyHe: `אחיל את תבנית ${byId.nameHe}. יש לאשר בכרטיס.`,
        replyEn: `I'll apply the ${byId.nameEn} template. Please approve on the card.`,
        data: { recipeId: byId.id },
      };
    }
  }
  if (
    norm.includes('format this') || norm.includes('lay it out like') || norm.includes('lay this out') ||
    norm.includes('apply a') || norm.includes('apply the') || norm.includes('design a') ||
    norm.includes('עמד') || norm.includes('עצב') || norm.includes('סדר את הדף כמו') ||
    norm.includes('כמו דף') || norm.includes('בדוגמת')
  ) {
    if (recipe) {
      const shaar = norm.includes('shaar blatt') || norm.includes('שער בלאט') || norm.includes('decorative') || norm.includes('מעוטר');
      return {
        action: 'applyHistoricalLayout',
        recipeId: recipe.id,
        replyHe: shaar
          ? `אעמד את הדף כ${recipe.nameHe} עם שער בלאט מעוטר בפתיחה. יש לאשר בכרטיס.`
          : `אעמד את המסמך כ${recipe.nameHe}. יש לאשר בכרטיס.`,
        replyEn: shaar
          ? `I'll lay out the page as ${recipe.nameEn} with a decorated Shaar Blatt at the opening. Please approve on the card.`
          : `I'll lay out the document as ${recipe.nameEn}. Please approve on the card.`,
        data: { recipeId: recipe.id, ...(shaar ? { shaarBlatt: true } : {}) },
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gemini prompt context (recipe summaries + rules, for the AI assistant)
// ---------------------------------------------------------------------------

/**
 * Recipe summaries + rules for the Gemini system prompt, so the assistant
 * can read a loaded .keter-template, explain it, and apply its rules —
 * and so it only ever proposes the validated action types
 * (applyHistoricalLayout / applyRecipe / explainRecipe / changeLayout).
 * The assistant must never invent a recipe id or a folio number.
 */
export function buildRecipePromptContext(): string {
  const lines = [
    'Historical layout recipes (deterministic, offline — no model training is involved).',
    'When the user asks for a historical layout, use ONLY these recipe ids and ONLY the action types below; never invent a recipe id.',
    ...getAllHistoricalRecipes().map(r =>
      `- ${r.id} ("${r.nameEn}" / ${r.nameHe}): ${r.summaryEn} Rules: ${r.rules.join('; ')}.`
    ),
    'Auto-layout on import (already done by the app, local rules only): every imported .docx is classified into Vilna-Daf tiers (header band with tractate/chapter/daf number; Mishna; Gemara central; Rashi inner; Tosafot outer; Ein Mishpat Ner Mitzvah; Masoret HaShas; Torah Or; Gilyon HaShas; Hagahot HaBach; outer-margin commentaries such as Rabbeinu Chananel and Rabbeinu Nisim; extra commentaries at the end of the volume; footnotes; title page) and laid out with the best-matching recipe. Low confidence falls back to a single column (prose) or two balanced columns (commentary-heavy) and the app says so plainly.',
    'Action types for layouts (all need the user\'s approval on a card):',
    '- applyHistoricalLayout {"recipeId": "<one of the ids above>"} — lay the document out with that historical recipe.',
    '- applyRecipe {"recipeId": "<id>"} or {"templateId": "<loaded .keter-template id>"} — apply a recipe or a loaded template (a templateId that is not loaded must be refused, never guessed).',
    '- explainRecipe {"recipeId": "<id>"} — explain the recipe and its rules; if no id is given, explain the current layout.',
    '- changeLayout {} — open the layout picker so the user can choose another layout.',
    'A loaded .keter-template.json is a layout recipe with regions/frames, flow & priority binding, structural and typographic rules: read it, explain it in plain words, and apply its rules with applyRecipe — never invent regions or rules it does not contain.',
  ];
  return lines.join('\n');
}
