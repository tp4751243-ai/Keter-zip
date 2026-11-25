/**
 * v0.9.2 Part B — ONE canonical list of book-layout options.
 *
 * The same seven layouts used to be listed in FOUR places with FOUR
 * different sets of names: the header layout menu, the New Project modal,
 * the Home screen (layout cards + the DOCX-import target select), and the
 * auto-layout "Change layout" banner in App. A new layout (Yiddish, v0.8.0)
 * had to be added to each list by hand, and the names drifted apart
 * ("ש״ס וילנא · רב-טקסט" vs "צורת הדף — ש״ס וילנא / רב-טקסט" vs
 * "ש״ס וילנא · רב-טקסט וברכיים דינמיות"). Every picker now renders from
 * this list, so there is one name per layout in Hebrew and English
 * (via t() + EN_STRINGS) and one place to add the next layout.
 *
 * Icons stay with the UI that renders them (each picker maps id → its own
 * lucide icon); only the ids, names and descriptions are shared here.
 */
import type { BookLayoutType } from '../types/typesetter';
import type { ProfessionalDesignSettings } from '../types/design-settings';
import { getHistoricalRecipe } from './historical-layouts';

export interface LayoutPresetOption {
  id: BookLayoutType;
  /** Canonical Hebrew name — the one name shown everywhere. */
  labelHe: string;
  /** Canonical English name (same name, English). */
  labelEn: string;
  /** Canonical Hebrew one-line description. */
  subLabelHe: string;
  /** Canonical English one-line description. */
  subLabelEn: string;
}

export const LAYOUT_PRESET_OPTIONS: ReadonlyArray<LayoutPresetOption> =
  Object.freeze([
    {
      id: 'rav_text',
      labelHe: 'ש״ס וילנא · רב-טקסט',
      labelEn: 'Vilna Shas · Multi-text',
      subLabelHe: 'גמרא במרכז, רש״י בימין, תוספות בשמאל וברכיים דינמיות',
      subLabelEn: 'Gemara in the center, Rashi on the right, Tosafot on the left, and dynamic knees',
    },
    {
      id: 'mikraot_gedolot',
      labelHe: 'מקראות גדולות',
      labelEn: 'Mikraot Gedolot',
      subLabelHe: 'פסוקי תנ״ך בטעמים עם תרגום ומפרשים',
      subLabelEn: 'Tanakh verses with taamim, with Targum and commentaries',
    },
    {
      id: 'source_top_commentary_bottom',
      labelHe: 'מקור עליון + מפרשים',
      labelEn: 'Upper source + commentaries',
      subLabelHe: 'רמב״ם / משנה ברורה עם קו מפריד דינמי',
      subLabelEn: 'Rambam / Mishnah Berurah with a dynamic divider line',
    },
    {
      id: 'two_column',
      labelHe: 'שני טורים מאוזנים',
      labelEn: 'Two balanced columns',
      subLabelHe: 'ספרי חסידות ומוסר / שולחן ערוך / משניות בשני טורים',
      subLabelEn: 'Chassidut & Mussar sefarim / Shulchan Arukh / Mishnayot in two columns',
    },
    {
      id: 'single_column',
      labelHe: 'טקסט רץ · טור יחיד',
      labelEn: 'Running text · Single column',
      subLabelHe: 'ספרי מוסר, הלכה, דרוש ושו״ת',
      subLabelEn: 'Musar, halakha, derush, and responsa books',
    },
    {
      id: 'yiddish_sefer',
      labelHe: 'ספר יידיש · מקור מול תרגום',
      labelEn: 'Yiddish Sefer · Source facing translation',
      subLabelHe: 'צאינה וראינה / תרגום וביאור מול מקור עברי',
      subLabelEn: 'Tzena Urena / translation and commentary facing the Hebrew source',
    },
    {
      id: 'custom_layout',
      labelHe: 'פריסה מותאמת אישית',
      labelEn: 'Custom layout',
      subLabelHe: 'תיבות טקסט שציירתם — מקור, פירושים, כותרות והערות',
      subLabelEn: 'Text boxes you drew — source, commentaries, headers and notes',
    },
  ]);

/** Canonical Hebrew name for one layout id (falls back to the id). */
export function layoutPresetLabel(id: BookLayoutType, lang: 'he' | 'en' = 'he'): string {
  const opt = LAYOUT_PRESET_OPTIONS.find(o => o.id === id);
  if (!opt) return id;
  return lang === 'en' ? (opt.labelEn ?? opt.labelHe) : opt.labelHe;
}

/**
 * v0.9.9 — the name the header / pickers show for the design a book
 * actually has. Applying a recipe keeps the custom-box solver
 * (layoutType 'custom_layout') but records the recipe id on the
 * design (CustomLayoutDesign.activeTemplateId) — so a Vilna Shas book
 * shows "Vilna Shas" here, not "Custom layout". A book whose boxes
 * came from a drawn custom layout (no recipe id) still shows
 * "Custom layout". The header menu itself (EditorialStudioHeader.tsx)
 * is outside this agent's ownership — it should call this helper.
 */
export function layoutDisplayLabel(settings: ProfessionalDesignSettings, lang: 'he' | 'en' = 'he'): string {
  const recipeId = settings.layout?.customLayout?.activeTemplateId;
  if (recipeId) {
    const recipe = getHistoricalRecipe(recipeId);
    if (recipe) {
      return lang === 'en' ? recipe.metadata.name : (recipe.metadata.nameHe ?? recipe.metadata.name);
    }
  }
  return layoutPresetLabel(settings.layout?.layoutType ?? 'single_column', lang);
}

/**
 * v0.9.7 — THE core start-screen list: exactly 11 cards, one grid.
 *
 * The user's photos of the installed v0.9.5 Home screen (2026-11-12):
 * 7 base cards PLUS the full historical library in 10 shelves (~27
 * recipes with paragraph-long English descriptions) felt overwhelming.
 * The start screen now shows ONLY these 11: the 7 base layouts, plus
 * the 4 most-used historical recipes promoted into the SAME grid (not
 * a second section). Every other recipe stays in the unified library
 * (historical-layouts.ts, 29 entries, untouched) and stays pickable
 * post-creation in the Design / Page design pickers — this is about
 * WHERE recipes are shown, never about deleting any.
 *
 * Count note: the user wrote "10" but named 11 — the 11 named are
 * used, and the discrepancy is recorded in MANIFEST.md.
 *
 * Each card carries a ONE-line description in both languages (the
 * historical recipes' paragraph descriptions are NOT reused here —
 * they are part of what overwhelmed the user). Base entries reuse the
 * canonical LAYOUT_PRESET_OPTIONS label/subLabel (English from
 * EN_STRINGS, copied here so the grid renders by `lang` like the
 * recipes do, with no extra lookup); recipe entries take their names
 * from the recipe metadata and their one-liners from this table.
 *
 * `kind: 'base'` cards select a base layout; `kind: 'recipe'` cards
 * select the recipe (which sets its baseLayout and saves the pending
 * recipe id, exactly as the old shelf cards did).
 */
export interface CoreStartLayoutOption {
  kind: 'base' | 'recipe';
  /** Card id: a BookLayoutType for base cards, a recipe id for recipe cards. */
  id: string;
  /** Base layout this card creates the book with. */
  baseLayout: BookLayoutType;
  /** Recipe id (recipe cards only). */
  recipeId?: string;
  labelHe: string;
  labelEn: string;
  /** ONE short line — never the recipe's paragraph description. */
  subLabelHe: string;
  subLabelEn: string;
}

export const CORE_START_LAYOUTS: ReadonlyArray<CoreStartLayoutOption> =
  Object.freeze([
    {
      kind: 'base',
      id: 'rav_text',
      baseLayout: 'rav_text',
      labelHe: 'ש״ס וילנא · רב-טקסט',
      labelEn: 'Vilna Shas · Multi-text',
      subLabelHe: 'גמרא במרכז, רש״י בימין, תוספות בשמאל וברכיים דינמיות',
      subLabelEn: 'Gemara in the center, Rashi on the right, Tosafot on the left, and dynamic knees',
    },
    {
      kind: 'base',
      id: 'mikraot_gedolot',
      baseLayout: 'mikraot_gedolot',
      labelHe: 'מקראות גדולות',
      labelEn: 'Mikraot Gedolot',
      subLabelHe: 'פסוקי תנ״ך בטעמים עם תרגום ומפרשים',
      subLabelEn: 'Tanakh verses with taamim, with Targum and commentaries',
    },
    {
      kind: 'base',
      id: 'source_top_commentary_bottom',
      baseLayout: 'source_top_commentary_bottom',
      labelHe: 'מקור עליון + מפרשים',
      labelEn: 'Upper source + commentaries',
      subLabelHe: 'רמב״ם / משנה ברורה עם קו מפריד דינמי',
      subLabelEn: 'Rambam / Mishnah Berurah with a dynamic divider line',
    },
    {
      kind: 'base',
      id: 'two_column',
      baseLayout: 'two_column',
      labelHe: 'שני טורים מאוזנים',
      labelEn: 'Two balanced columns',
      subLabelHe: 'ספרי חסידות ומוסר / שולחן ערוך / משניות בשני טורים',
      subLabelEn: 'Chassidut & Mussar sefarim / Shulchan Arukh / Mishnayot in two columns',
    },
    {
      kind: 'base',
      id: 'single_column',
      baseLayout: 'single_column',
      labelHe: 'טקסט רץ · טור יחיד',
      labelEn: 'Running text · Single column',
      subLabelHe: 'ספרי מוסר, הלכה, דרוש ושו״ת',
      subLabelEn: 'Musar, halakha, derush, and responsa books',
    },
    {
      kind: 'base',
      id: 'yiddish_sefer',
      baseLayout: 'yiddish_sefer',
      labelHe: 'ספר יידיש · מקור מול תרגום',
      labelEn: 'Yiddish sefer · Source facing translation',
      subLabelHe: 'צאינה וראינה / תרגום וביאור מול מקור עברי',
      subLabelEn: 'Tzena Urena / translation and commentary facing the Hebrew source',
    },
    {
      kind: 'base',
      id: 'custom_layout',
      baseLayout: 'custom_layout',
      labelHe: 'פריסה מותאמת אישית',
      labelEn: 'Custom layout',
      subLabelHe: 'תיבות טקסט שציירתם — מקור, פירושים, כותרות והערות',
      subLabelEn: 'Text boxes you drew — source, commentaries, headers and notes',
    },
    {
      kind: 'recipe',
      id: 'chumash-rishonim',
      baseLayout: 'mikraot_gedolot',
      recipeId: 'chumash-rishonim',
      labelHe: 'חומש עם ראשונים',
      labelEn: 'Chumash with Rishonim',
      subLabelHe: 'פסוק בראש, רש״י ורמב״ן מתחתיו',
      subLabelEn: 'Verse on top, Rashi and Ramban below it',
    },
    {
      kind: 'recipe',
      id: 'mishnah-classic',
      baseLayout: 'single_column',
      recipeId: 'mishnah-classic',
      labelHe: 'משנה עם ברטנורא',
      labelEn: 'Mishnah with Bartenura',
      subLabelHe: 'המשנה הקלאסית — ברטנורא מתחתיה',
      subLabelEn: 'The classic Mishnah — Bartenura below it',
    },
    {
      kind: 'recipe',
      id: 'shulchan-aruch',
      baseLayout: 'two_column',
      recipeId: 'shulchan-aruch',
      labelHe: 'שולחן ערוך',
      labelEn: 'Shulchan Aruch',
      subLabelHe: 'המחבר במרכז, המפרשים מסביב',
      subLabelEn: 'The Mechaber in the center, commentaries around it',
    },
    {
      kind: 'recipe',
      id: 'siddur',
      baseLayout: 'single_column',
      recipeId: 'siddur',
      labelHe: 'סידור',
      labelEn: 'Siddur',
      subLabelHe: 'תפילה בטור יחיד — הנוסח נבחר בהמשך',
      subLabelEn: 'Prayer in a single column — nusach chosen later',
    },
  ]);

/** The 4 promoted recipe ids (the rest of the library lives in Design). */
export const CORE_START_RECIPE_IDS: ReadonlyArray<string> = Object.freeze(
  CORE_START_LAYOUTS.filter(o => o.kind === 'recipe').map(o => o.id)
);
