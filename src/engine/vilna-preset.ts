/**
 * v0.9.9 (I2) — Vilna Shas preset DATA.
 *
 * One preset object expressing the Vilna folio as data on top of the
 * existing systems — NOT a second preset system and NOT a second engine.
 * The engines keep reading `ProfessionalDesignSettings`
 * (`ravText`, `pageElements.folioNumbering`, role paragraph styles);
 * this file only describes the Vilna values and converts them into the
 * existing settings patch shape (`vilnaPresetToDesignPatch`), which the
 * Design panel applies through the existing
 * `DesignSettingsEngine.update*` calls (so undo history and the AI
 * patch handler keep working unchanged).
 *
 * Geometry and typography are grounded in the reconciled tree:
 * - Page 240×340 mm, margins inside 12 / outside 10 / top 12 /
 *   bottom 12 mm — the `talmud-bavli` recipe page block
 *   (`historical-layouts.ts`).
 * - Gemara 14.5 pt Frank Ruhl Libre, Rashi 10.5 pt Noto Rashi Hebrew,
 *   Tosafot 10.5 pt Frank Ruhl Libre, all leading 1.32 — the rav-text
 *   defaults in `design-settings-engine.ts`.
 * - Folio starts at Daf 2, Amud Alef, dots notation (ב. / ב:) —
 *   `computeTalmudDafAmud` / `DEFAULT_FOLIO_NUMBERING`.
 *
 * Streams are placed as INNER / OUTER logical regions. The physical
 * left/right is resolved per facing page by `resolveLogicalSide`
 * (recto / Amud Rishon is the LEFT-hand page of a Hebrew spread, so
 * its binding edge is its RIGHT edge) — never hard-coded left/right
 * for Rashi/Tosafot. `flankPhysicalSides` in `vilna-shas.ts`
 * delegates to this helper so there is one statement of the rule.
 */

import type {
  ContentRole,
  DafFormatMode,
  PeripheralStreamKind,
} from '../types/typesetter';
import type {
  FolioNumberingSettings,
  OpeningDecorationSettings,
  ParagraphStyleSettings,
  PeripheralStreamConfig,
  RavTextDesignSettings,
  SeparatorRuleSettings,
  TransitionMarkerSettings,
} from '../types/design-settings';

/** Preset schema version — bump when a field meaning changes. */
export const VILNA_PRESET_VERSION = 1;

/** Logical placement of a stream relative to the binding. */
export type VilnaLogicalSide = 'inner' | 'outer';

/** One main stream of the Vilna folio. */
export interface VilnaStreamDef {
  id: 'gemara' | 'rashi' | 'tosafot';
  labelHe: string;
  labelEn: string;
  role: ContentRole;
  /** 'gemara' has no flank side — it is the centred main text. */
  logicalSide: VilnaLogicalSide | 'center';
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
  /** Share of the content width on a recto page (percent). */
  widthPct: number;
}

/**
 * One optional marginal commentator slot. `placement` is logical
 * (INNER/OUTER) and resolves to a physical side per facing page, like
 * the main streams; 'below' is the band under the knee. A slot whose
 * commentary is not selected reserves NO column and squeezes NO font:
 * pagination only attaches lines that exist, and
 * `checkMarginalPlacementFit` flags a selected set that cannot fit
 * instead of shrinking anything.
 */
export interface VilnaMarginalSlot {
  kind: PeripheralStreamKind;
  labelHe: string;
  labelEn: string;
  /** How this commentary relates to the Gemara (cross-reference, verse source, marginal note, commentary). */
  sourceRelationship: 'cross_reference' | 'verse_source' | 'marginal_note' | 'commentary';
  fontRole: ContentRole;
  fontSizePt: number;
  widthPct: number;
  placement: 'inside' | 'outside' | 'below';
  enabledByDefault: boolean;
}

/** Chalon (second-line) indent as preset data. Default mode is 'none'. */
export interface VilnaChalonSettings {
  /** 'none' (default, reversible) / 'chalon_second_line' (line 2 only) / 'chalon_window' (lines 2..1+lineCount) / 'chalon_all' (line 2 onward). */
  mode: 'none' | 'chalon_second_line' | 'chalon_window' | 'chalon_all';
  indentPt: number;
  lineCount: number;
  /** Which streams the indent applies to ('gemara' by default). */
  scope: Array<'gemara' | 'rashi' | 'tosafot'>;
}

export interface VilnaShasPresetData {
  id: string;
  nameHe: string;
  nameEn: string;
  version: number;
  page: {
    widthMm: number;
    heightMm: number;
    marginInsideMm: number;
    marginOutsideMm: number;
    marginTopMm: number;
    marginBottomMm: number;
  };
  streams: VilnaStreamDef[];
  folio: {
    startDaf: number;
    startAmud: 'a' | 'b';
    display: DafFormatMode;
    excludeFrontMatter: boolean;
  };
  runningHead: {
    showMasechet: boolean;
    showPerek: boolean;
    showFolio: boolean;
  };
  openingDecoration: OpeningDecorationSettings;
  commentarySeparator: SeparatorRuleSettings;
  paragraphSeparator: SeparatorRuleSettings;
  transitionMarker: TransitionMarkerSettings;
  chalon: VilnaChalonSettings;
  marginalSlots: VilnaMarginalSlot[];
  /**
   * Title-page template id. This references the EXISTING title-page
   * border style id ('double' is the built-in default border) — it is
   * not a second template registry.
   */
  titleTemplateId: string;
}

/** The classic Vilna folio preset. */
export const VILNA_SHAS_PRESET: VilnaShasPresetData = {
  id: 'vilna-shas-classic',
  nameHe: 'ש״ס וילנא — קלאסי',
  nameEn: 'Vilna Shas — Classic',
  version: VILNA_PRESET_VERSION,
  page: {
    widthMm: 240,
    heightMm: 340,
    marginInsideMm: 12,
    marginOutsideMm: 10,
    marginTopMm: 12,
    marginBottomMm: 12,
  },
  streams: [
    {
      id: 'gemara',
      labelHe: 'גמרא',
      labelEn: 'Gemara',
      role: 'main_source',
      logicalSide: 'center',
      fontFamily: 'Frank Ruhl Libre',
      fontSizePt: 14.5,
      lineHeight: 1.32,
      widthPct: 48,
    },
    {
      id: 'rashi',
      labelHe: 'רש״י',
      labelEn: 'Rashi',
      role: 'primary_comment',
      logicalSide: 'inner',
      fontFamily: 'Noto Rashi Hebrew',
      fontSizePt: 10.5,
      lineHeight: 1.32,
      widthPct: 24,
    },
    {
      id: 'tosafot',
      labelHe: 'תוספות',
      labelEn: 'Tosafot',
      role: 'secondary_comment',
      logicalSide: 'outer',
      fontFamily: 'Frank Ruhl Libre',
      fontSizePt: 10.5,
      lineHeight: 1.32,
      widthPct: 24,
    },
  ],
  folio: {
    startDaf: 2,
    startAmud: 'a',
    display: 'dots',
    excludeFrontMatter: true,
  },
  runningHead: {
    showMasechet: true,
    showPerek: true,
    showFolio: true,
  },
  openingDecoration: {
    enabled: false,
    styleId: 'double_ornate',
    wordCount: 1,
    paddingPt: 8,
    frameWidthPct: 48,
    customWordText: '',
    thicknessPt: 1.1,
    scope: 'masechet_start',
  },
  commentarySeparator: { styleId: 'colon', widthRatio: 0.45, thicknessPt: 0.65 },
  paragraphSeparator: { styleId: 'none', widthRatio: 0.35, thicknessPt: 0.6 },
  transitionMarker: {
    enabled: true,
    markerText: 'גמ׳',
    requireVerifiedBoundary: true,
    highlightAmbiguousInQa: true,
    style: 'text',
    position: 'before_first_word',
  },
  // Chalon default is 'none': the reference annotation leaves the depth
  // and scope ambiguous (catalog §B4), so the preset ships with no
  // indent and the user opts in explicitly from the Design panel.
  chalon: { mode: 'none', indentPt: 18, lineCount: 2, scope: ['gemara'] },
  marginalSlots: [
    { kind: 'ein_mishpat', labelHe: 'עין משפט', labelEn: 'Ein Mishpat', sourceRelationship: 'cross_reference', fontRole: 'tertiary_comment', fontSizePt: 8.5, widthPct: 14, placement: 'outside', enabledByDefault: true },
    { kind: 'masoret_hashas', labelHe: 'מסורת הש״ס', labelEn: 'Masoret HaShas', sourceRelationship: 'cross_reference', fontRole: 'tertiary_comment', fontSizePt: 8.5, widthPct: 14, placement: 'inside', enabledByDefault: true },
    { kind: 'ner_mitzvah', labelHe: 'נר מצוה', labelEn: 'Ner Mitzvah', sourceRelationship: 'cross_reference', fontRole: 'tertiary_comment', fontSizePt: 8.5, widthPct: 14, placement: 'outside', enabledByDefault: true },
    { kind: 'torah_or', labelHe: 'תורה אור', labelEn: 'Torah Or', sourceRelationship: 'verse_source', fontRole: 'tertiary_comment', fontSizePt: 8.5, widthPct: 24, placement: 'below', enabledByDefault: true },
    { kind: 'gilyon_hashas', labelHe: 'גליון הש״ס', labelEn: 'Gilyon HaShas', sourceRelationship: 'marginal_note', fontRole: 'side_note', fontSizePt: 8.5, widthPct: 14, placement: 'inside', enabledByDefault: false },
    { kind: 'hagahot_habach', labelHe: 'הגהות הב״ח', labelEn: 'Hagahot HaBach', sourceRelationship: 'marginal_note', fontRole: 'side_note', fontSizePt: 8.5, widthPct: 24, placement: 'below', enabledByDefault: false },
    { kind: 'rabbeinu_chananel', labelHe: 'רבינו חננאל', labelEn: 'Rabbeinu Chananel', sourceRelationship: 'commentary', fontRole: 'secondary_comment', fontSizePt: 9, widthPct: 16, placement: 'outside', enabledByDefault: false },
    { kind: 'ran', labelHe: 'ר״ן', labelEn: 'Ran', sourceRelationship: 'commentary', fontRole: 'secondary_comment', fontSizePt: 9, widthPct: 16, placement: 'outside', enabledByDefault: false },
    { kind: 'maharsha', labelHe: 'מהרש״א', labelEn: 'Maharsha', sourceRelationship: 'commentary', fontRole: 'secondary_comment', fontSizePt: 9, widthPct: 28, placement: 'below', enabledByDefault: false },
  ],
  titleTemplateId: 'double',
};

/**
 * Resolve a logical INNER/OUTER side to a physical left/right for one
 * facing page. `bodyPageIndex` is the 0-based body-page index
 * (front matter excluded): even = recto / Amud Rishon = LEFT-hand page
 * of a Hebrew spread, whose binding edge is its RIGHT edge.
 * Never hard-code left/right for Rashi/Tosafot — call this.
 */
export function resolveLogicalSide(
  logical: VilnaLogicalSide,
  bodyPageIndex: number
): 'left' | 'right' {
  const isRecto = Math.max(0, Math.floor(bodyPageIndex)) % 2 === 0;
  if (logical === 'inner') return isRecto ? 'right' : 'left';
  return isRecto ? 'left' : 'right';
}

/** Physical side of a main Vilna stream on one facing page ('center' for Gemara). */
export function resolveStreamPhysicalSide(
  streamId: VilnaStreamDef['id'],
  bodyPageIndex: number,
  preset: VilnaShasPresetData = VILNA_SHAS_PRESET
): 'left' | 'right' | 'center' {
  const stream = preset.streams.find(s => s.id === streamId);
  if (!stream || stream.logicalSide === 'center') return 'center';
  return resolveLogicalSide(stream.logicalSide, bodyPageIndex);
}

/** The preset's marginal slots as persisted `PeripheralStreamConfig`s. */
export function vilnaMarginalSlotsToConfigs(
  preset: VilnaShasPresetData = VILNA_SHAS_PRESET
): PeripheralStreamConfig[] {
  return preset.marginalSlots.map(s => ({
    id: s.kind,
    enabled: s.enabledByDefault,
    placement: s.placement,
    fontSizePt: s.fontSizePt,
    widthPct: s.widthPct,
  }));
}

/** Roles the preset's chalon indent applies to, in settings terms. */
export function vilnaChalonRoles(
  preset: VilnaShasPresetData = VILNA_SHAS_PRESET
): ContentRole[] {
  const byStream: Record<string, ContentRole> = {
    gemara: 'main_source',
    rashi: 'primary_comment',
    tosafot: 'secondary_comment',
  };
  return preset.chalon.scope.map(s => byStream[s]).filter(Boolean);
}

/** Paragraph settings expressing the preset's chalon choice. */
export function vilnaChalonParagraph(
  preset: VilnaShasPresetData = VILNA_SHAS_PRESET
): Partial<ParagraphStyleSettings> {
  const c = preset.chalon;
  if (c.mode === 'none') {
    return { indentMode: 'none', firstLineIndentPt: 0, hangingIndentPt: 0 };
  }
  return {
    indentMode: c.mode,
    chalonIndentPt: c.indentPt,
    chalonLineCount: c.lineCount,
    firstLineIndentPt: 0,
    hangingIndentPt: 0,
  };
}

export interface VilnaPresetDesignPatch {
  ravText: Partial<RavTextDesignSettings>;
  folioNumbering: Partial<FolioNumberingSettings>;
  chalonRoles: ContentRole[];
  chalonParagraph: Partial<ParagraphStyleSettings>;
}

/**
 * Convert the preset into the existing settings patch shape. The caller
 * applies it through the existing `DesignSettingsEngine.update*`
 * calls — this function itself writes no settings and creates no
 * parallel state.
 */
export function vilnaPresetToDesignPatch(
  preset: VilnaShasPresetData = VILNA_SHAS_PRESET
): VilnaPresetDesignPatch {
  const gemara = preset.streams.find(s => s.id === 'gemara');
  const rashi = preset.streams.find(s => s.id === 'rashi');
  const tosafot = preset.streams.find(s => s.id === 'tosafot');
  return {
    ravText: {
      sourceFontFamily: gemara?.fontFamily,
      sourceFontSizePt: gemara?.fontSizePt,
      sourceLineSpacingRatio: gemara?.lineHeight,
      rashiFontFamily: rashi?.fontFamily,
      rashiFontSizePt: rashi?.fontSizePt,
      tosafotFontFamily: tosafot?.fontFamily,
      tosafotFontSizePt: tosafot?.fontSizePt,
      commentaryLineSpacingRatio: rashi?.lineHeight ?? tosafot?.lineHeight,
      openingDecoration: { ...preset.openingDecoration },
      commentarySeparator: { ...preset.commentarySeparator },
      paragraphSeparator: { ...preset.paragraphSeparator },
      transitionMarker: { ...preset.transitionMarker },
      peripheralStreams: vilnaMarginalSlotsToConfigs(preset),
    },
    folioNumbering: {
      dafFormat: preset.folio.display,
      startDaf: preset.folio.startDaf,
      startAmud: preset.folio.startAmud,
      excludeFrontMatter: preset.folio.excludeFrontMatter,
    },
    chalonRoles: vilnaChalonRoles(preset),
    chalonParagraph: vilnaChalonParagraph(preset),
  };
}

export interface MarginalPlacementFit {
  fits: boolean;
  placement?: 'inside' | 'outside' | 'below';
  totalWidthPct?: number;
  /** Widest enabled slot in the overflowing placement — the suggested one to switch off. */
  suggestedDisableKind?: PeripheralStreamKind;
  reasonHe: string;
  reasonEn: string;
  suggestedActionHe: string;
  suggestedActionEn: string;
}

/**
 * Fit check for a set of selected marginal slots: the enabled slots
 * sharing one placement ('inside' / 'outside' / 'below') must total
 * at most 100% of that placement's width. When they do not fit, the
 * result names the placement and the widest slot to switch off — the
 * paginator turns this into a structured QA diagnostic. Fonts are
 * NEVER squeezed to fit; an over-full selection is reported, not
 * silently shrunk.
 */
export function checkMarginalPlacementFit(
  slots: ReadonlyArray<{
    id: PeripheralStreamKind;
    enabled: boolean;
    placement: 'inside' | 'outside' | 'below';
    widthPct: number;
  }>
): MarginalPlacementFit {
  const placements: Array<'inside' | 'outside' | 'below'> = ['inside', 'outside', 'below'];
  for (const placement of placements) {
    const enabled = slots.filter(s => s.enabled && s.placement === placement);
    const total = enabled.reduce((n, s) => n + (s.widthPct || 0), 0);
    if (total > 100) {
      const widest = [...enabled].sort((a, b) => b.widthPct - a.widthPct)[0];
      const placementHe = placement === 'inside' ? 'פנימי' : placement === 'outside' ? 'חיצוני' : 'תחתון';
      const placementEn = placement === 'inside' ? 'inner' : placement === 'outside' ? 'outer' : 'lower';
      return {
        fits: false,
        placement,
        totalWidthPct: total,
        suggestedDisableKind: widest?.id,
        reasonHe: `מדורי הצד בצד ה${placementHe} תופסים ${Math.round(total)}% מרוחב האזור — מעל 100%.`,
        reasonEn: `Marginal streams on the ${placementEn} side take ${Math.round(total)}% of the area width — over 100%.`,
        suggestedActionHe: widest ? `כבה את מדור ${widest.id} או הקטן את רוחבו.` : 'הקטן את רוחבי המדורים.',
        suggestedActionEn: widest ? `Switch off the ${widest.id} stream or reduce its width.` : 'Reduce the stream widths.',
      };
    }
  }
  return {
    fits: true,
    reasonHe: 'מדורי הצד הנבחרים מתאימים לרוחב האזורים.',
    reasonEn: 'The selected marginal streams fit their areas.',
    suggestedActionHe: '',
    suggestedActionEn: '',
  };
}
