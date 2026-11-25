/**
 * Layout training T5 — SEFER TYPE PROFILES: one source of truth for which
 * typesetting rules belong to which kind of sefer.
 *
 * Problem this fixes (scripts/training/sefer-type-audit.ts, before: 11/40
 * types clean): a book's design settings are one bag of switches, and
 * choosing a type never switched the previous type's rules off. Starting
 * from a Shas setup (the wizard does) or switching the layout in the
 * header kept the Gemara rules — daf folios ב. / ב:, the Vilna running
 * head, the masechta opening frame, the גמ׳ marker, the Vilna marginal
 * columns — in a Chumash, a Shulchan Aruch, a Siddur, a Tanya…
 *
 * Two layers:
 *  1. applySeferTypeRules() sets EVERY type-specific switch explicitly
 *     (on for its type, off for all others) whenever the type changes:
 *     new book, layout switch, recipe / archetype / DOCX auto-layout.
 *  2. isTalmudFolio() — every Talmud-only engine feature checks it
 *     itself, so even a hand-edited or old project cannot leak.
 */
import type { BookLayoutType } from '../types/typesetter';
import type { ProfessionalDesignSettings } from '../types/design-settings';

export type SeferType =
  | 'talmud' //    Vilna-style folio: daf/amud, masechta head, frame, apparatus
  | 'chumash' //   Mikraot Gedolot / Chumash with meforshim
  | 'mishnah' //   Mishnayos with commentaries
  | 'halacha' //   Shulchan Aruch, Tur, Rambam, Mishnah Berurah, responsa
  | 'siddur' //    Siddur / Machzor
  | 'yiddish' //   Yiddish sefarim, Tz'ena Ur'ena
  | 'prose'; //    single-column sefer: mussar, chassidus, drush, Tanya

export const SEFER_TYPE_LABELS: Record<SeferType, { he: string; en: string }> = {
  talmud: { he: 'גמרא (דף ועמוד)', en: 'Talmud (daf and amud)' },
  chumash: { he: 'חומש / מקראות גדולות', en: 'Chumash / Mikraot Gedolot' },
  mishnah: { he: 'משניות', en: 'Mishnayos' },
  halacha: { he: 'הלכה', en: 'Halacha' },
  siddur: { he: 'סידור / מחזור', en: 'Siddur / Machzor' },
  yiddish: { he: 'יידיש', en: 'Yiddish' },
  prose: { he: 'ספר בטור אחד', en: 'Single-column sefer' },
};

/** The type a plain layout choice implies. */
export function seferTypeForLayout(layoutType: BookLayoutType): SeferType {
  switch (layoutType) {
    case 'rav_text':
      return 'talmud';
    case 'mikraot_gedolot':
      return 'chumash';
    case 'two_column':
    case 'source_top_commentary_bottom':
      return 'halacha';
    case 'yiddish_sefer':
      return 'yiddish';
    default:
      return 'prose';
  }
}

const RECIPE_TYPES: Record<string, SeferType> = {
  'talmud-bavli': 'talmud',
  'vilna-shas': 'talmud',
  'shas-oz-vehadar': 'talmud',
  'shas-artscroll': 'talmud',
  'shas-steinzaltz': 'talmud',
  yerushalmi: 'talmud',
  'mikraot-gedolot': 'chumash',
  'chumash-rishonim': 'chumash',
  chumash: 'chumash',
  'tanach-commentary': 'chumash',
  'mishnah-classic': 'mishnah',
  'mishnah-kehati': 'mishnah',
  'shulchan-aruch': 'halacha',
  'mishnah-berurah': 'halacha',
  'mishneh-torah': 'halacha',
  'aruch-hashulchan': 'halacha',
  tur: 'halacha',
  'kitzur-shulchan-aruch': 'halacha',
  responsa: 'halacha',
  siddur: 'siddur',
  machzor: 'siddur',
  'yiddish-sefer': 'yiddish',
  mussar: 'prose',
  tanya: 'prose',
  'chassidic-drush': 'prose',
  'machon-edition': 'prose',
  midrash: 'prose',
  'ein-yaakov': 'prose',
  tzenerene: 'yiddish',
};

/** The type a ready design (recipe / archetype) belongs to. */
export function seferTypeForRecipe(recipeId: string, fallbackLayout: BookLayoutType = 'single_column'): SeferType {
  return RECIPE_TYPES[recipeId] ?? seferTypeForLayout(fallbackLayout);
}

/**
 * Is this book a Talmud folio? The explicit type wins; a project saved
 * before types existed counts as Talmud only on the rav_text layout.
 */
export function isTalmudFolio(
  settings: Pick<ProfessionalDesignSettings, 'pageLayout'> | null | undefined,
  layoutType: BookLayoutType | string | undefined
): boolean {
  const t = settings?.pageLayout?.seferType;
  if (t) return t === 'talmud';
  return layoutType === 'rav_text';
}

const MM = 72 / 25.4;
/** The page the engine gives a new Talmud book (VILNA_SHAS_PRESET page). */
const VILNA_FOLIO = { w: 240 * MM, h: 340 * MM };
/** The general book page (the engine's default before folio sizing). */
const GENERAL_PAGE = { w: 482, h: 680, top: 48, bottom: 48, inside: 46, outside: 42 };

/**
 * Set every type-specific rule for `type` on a settings object, IN PLACE
 * (the caller passes a clone). Called by DesignSettingsEngine whenever the
 * type changes. Never touches the user's text, fonts or sizes, only the
 * switches that belong to one kind of sefer.
 */
export function applySeferTypeRulesInPlace(next: ProfessionalDesignSettings, type: SeferType): void {
  const talmud = type === 'talmud';
  const previous = next.pageLayout.seferType;
  next.pageLayout.seferType = type;

  // Running head: the Vilna head (perek / masechta / daf) is Talmud only.
  if (next.pageElements?.runningHeader) {
    next.pageElements.runningHeader = { ...next.pageElements.runningHeader, useStructuredVilnaHeader: talmud };
  }
  // Folios: daf and amud (ב. / ב:) for Talmud, Hebrew page numbers otherwise.
  if (next.pageElements) {
    const fn = next.pageElements.folioNumbering;
    next.pageElements.folioNumbering = talmud
      ? { ...(fn ?? { excludeFrontMatter: true }), dafFormat: 'dots', startDaf: 2, startAmud: 'a', excludeFrontMatter: fn?.excludeFrontMatter ?? true }
      : { ...(fn ?? { excludeFrontMatter: true }), dafFormat: 'gematria', startDaf: 1, startAmud: 'a', excludeFrontMatter: fn?.excludeFrontMatter ?? true };
  }
  if (next.ravText) {
    // Masechta opening frame (first word boxed) — Talmud only.
    if (next.ravText.openingDecoration) {
      next.ravText.openingDecoration = { ...next.ravText.openingDecoration, enabled: talmud };
    }
    // The full-width Michtav strip is never a default.
    next.ravText.michtavEnabled = false;
    // גמ׳ marker between Mishna and Gemara — Talmud only.
    if (next.ravText.transitionMarker) {
      next.ravText.transitionMarker = { ...next.ravText.transitionMarker, enabled: talmud };
    }
    // Ein Mishpat / Masoret HaShas side columns — Talmud only.
    next.ravText.marginalColumns = { enabled: talmud };
  }
  // Layout training T8 — body weight and the opening word. A Gemara is
  // set semi-bold (600) throughout; a prose sefer is set regular with
  // the first word of each paragraph bold (the user's Mesilat Yesharim
  // reference). A weight the user changed is kept.
  const prose = type === 'prose';
  const prs = (next.projectRoleStyles ??= {} as ProfessionalDesignSettings['projectRoleStyles']);
  for (const role of ['main_source', 'regular_paragraph'] as const) {
    const cur = prs[role] ?? {};
    const ch = { ...(cur.character ?? {}) };
    const para = { ...(cur.paragraph ?? {}) };
    // Our own earlier value is replaced; a weight the user chose is kept.
    const ours = ch.fontWeight === undefined || (cur as { seferTypeWeight?: boolean }).seferTypeWeight;
    if (ours) {
      if (prose) ch.fontWeight = 400;
      else delete ch.fontWeight;
    }
    if (prose) para.openingWordsBold = Math.max(1, para.openingWordsBold ?? 1);
    else delete para.openingWordsBold;
    prs[role] = { ...cur, character: ch, paragraph: para, ...(ours ? { seferTypeWeight: prose } : {}) } as typeof cur;
  }
  // A Vilna folio page inherited from a Talmud book goes back to the
  // general book page; a page the user or a ready design chose stays.
  if (!talmud && previous === 'talmud') {
    const pl = next.pageLayout;
    // (the folio's own 12 mm margins too: a ready design that CHOSE a
    // 240 × 340 mm page — the two-column Chassidic sefer — keeps it)
    if (
      Math.abs(pl.geometry.pageWidth - VILNA_FOLIO.w) < 0.5 &&
      Math.abs(pl.geometry.pageHeight - VILNA_FOLIO.h) < 0.5 &&
      Math.abs(pl.geometry.marginTop - 12 * MM) < 0.5
    ) {
      pl.geometry = {
        ...pl.geometry,
        pageWidth: GENERAL_PAGE.w,
        pageHeight: GENERAL_PAGE.h,
        marginTop: GENERAL_PAGE.top,
        marginBottom: GENERAL_PAGE.bottom,
        marginInside: GENERAL_PAGE.inside,
        marginOutside: GENERAL_PAGE.outside,
      };
      pl.pageWidthPt = GENERAL_PAGE.w;
      pl.pageHeightPt = GENERAL_PAGE.h;
      pl.marginTopPt = GENERAL_PAGE.top;
      pl.marginBottomPt = GENERAL_PAGE.bottom;
      pl.marginInsidePt = GENERAL_PAGE.inside;
      pl.marginOutsidePt = GENERAL_PAGE.outside;
    }
  }
}
