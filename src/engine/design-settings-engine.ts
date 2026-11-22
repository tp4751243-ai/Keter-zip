/**
 * STAGE 13 — PROFESSIONAL DESIGN & TYPESETTING CONTROL ENGINE
 *
 * Single authoritative engine (`DesignSettingsEngine`) that manages `ProfessionalDesignSettings`:
 * 1. Holds immutable Global Styles (`GLOBAL_ROLE_STYLES`) for all semantic roles (`main_title`,
 *    `subtitle`, `chapter`, `siman`, `heading`, `subheading`, `main_source`, `verse`,
 *    `regular_paragraph`, `bold_special`, `primary_comment`, `secondary_comment`,
 *    `tertiary_comment`, `dibbur_hamatchil`, `footnote`, `side_note`, `introduction`,
 *    `continuation`, `page_element`, etc.).
 * 2. Resolves effective formatting across the 3-tier hierarchy:
 *      GLOBAL_STYLE -> PROJECT_STYLE -> LOCAL_OVERRIDE
 *    and detects `"Mixed"` values across multi-unit or multi-word selections without destroying
 *    local overrides unless explicitly requested.
 * 3. Enforces Stage 12 Level 0 Universal Engine Hard Rules on every user or AI design modification:
 *    - Clamps unreadable font sizes (< 6pt or > 72pt)
 *    - Clamps horizontal character scale to [90%..110%] (no glyph distortion)
 *    - Clamps margins and column widths so content area never drops below Level 0 minimum
 *      readable widths (`135pt` Source, `78pt` Commentary)
 *    - Preserves RTL logical/visual integrity and combining mark zero-advance invariants
 *    - Never invents or enables automatic ornaments (Stage 11D / Level 0 Law #12)
 *    - Never alters authoritative source/commentary/footnote text (Level 0 Law #1 & #2)
 * 4. Translates natural-language AI commands (Hebrew & English) into structured updates on the
 *    exact same `ProfessionalDesignSettings` model used by the UI panel.
 */

import {
  BookLayoutType,
  ContentRole,
  ContentUnit,
  DafFormatMode,
  KneeCustomSettings,
  MAX_COMMENT_TIERS,
  PageGeometry,
  ParagraphIndentMode,
  SeparatorStyleId,
  TierConfig,
} from '../types/typesetter';
import {
  TypesettingRuleCategory,
  TypesettingRuleId,
  TypesettingRulesConfig,
  TypesettingRulesEngine,
  UserTypesettingRule,
} from './typesetting-rules-engine';
import {
  BlockSpacingSettings,
  CharacterStyleSettings,
  ColumnDesignSettings,
  CustomLayoutBox,
  CustomLayoutDesign,
  CustomLayoutTemplate,
  DEFAULT_BLOCK_SPACING,
  DEFAULT_COMMENTARY_SEPARATOR,
  DEFAULT_FOLIO_NUMBERING,
  DEFAULT_OPENING_DECORATION,
  DEFAULT_PARAGRAPH_SEPARATOR,
  DEFAULT_PERIPHERAL_STREAMS,
  DEFAULT_RUNNING_HEADER_SETTINGS,
  DEFAULT_TITLE_PAGE_SETTINGS,
  DEFAULT_TRANSITION_MARKER,
  DesignAlignment,
  DesignScopeLevel,
  DesignSelectionTarget,
  EffectiveResolvedFormatting,
  FolioNumberingSettings,
  FootnoteDesignSettings,
  LocalFormattingOverride,
  MarginUnit,
  OpeningDecorationStyleId,
  OpenTypeFeaturesConfig,
  PageElementsDesignSettings,
  PageLayoutDesignSettings,
  ParagraphStyleSettings,
  ProfessionalDesignSettings,
  RavTextDesignSettings,
  RoleDesignStyle,
  RunningHeaderAlignment,
  RunningHeaderPageOverride,
  RunningHeaderSettings,
  SemanticStyleRole,
  StyleHierarchyLayer,
  TitlePageBorderStyleId,
  TitlePageFieldStyle,
  TitlePageSettings,
} from '../types/design-settings';
import { KNOWN_HOLY_BOOK_FONTS } from './font-analyzer';
// v0.5.0 Part A — Module 1(d) BEGIN: AI font actions also accept system +
// imported fonts from the font library (see isKnownFontFamily,
// switch_font, and checkFontAvailability below). Nothing else in this
// file's AI behaviour changes.
import { findFontLibraryEntry, isFontInLibrary } from './font-library';
// v0.5.0 Part A — Module 1(d) END.
import { SpatialExclusionEngine } from './spatial-exclusion';
// v0.5.0 Part C — Module 3 (Custom Layout Designer): box defaults, sanitize
// and the pending-template seam. Pure helpers only — no React here.
import {
  consumePendingCustomLayout,
  defaultCustomLayoutDesign,
  findCustomLayoutTemplateByName,
  listCustomLayoutTemplates,
  sanitizeCustomLayoutDesign,
} from './custom-layout-engine';
// v0.5.0 (Title Page / Shaar Blat builder): border style validation.
import { isTitlePageBorderStyleId } from './title-page-borders';

const DEFAULT_OPENTYPE_FEATURES: OpenTypeFeaturesConfig = Object.freeze({
  ligatures: true,
  contextualAlternates: true,
  markPositioning: true,
  markToMark: true,
  kerning: true,
  hebrewTypographyMode: 'rabbinic_classic',
});

function createRoleStyle(
  role: SemanticStyleRole,
  displayNameHe: string,
  displayNameEn: string,
  charOverrides: Partial<CharacterStyleSettings>,
  paraOverrides: Partial<ParagraphStyleSettings>
): RoleDesignStyle {
  const fontSizePt = charOverrides.fontSizePt ?? 13.5;
  const lineSpacingRatio = paraOverrides.lineSpacingRatio ?? 1.28;
  const leadingPt =
    paraOverrides.leadingPt ?? Number((fontSizePt * lineSpacingRatio).toFixed(2));

  return Object.freeze({
    role,
    displayNameHe,
    displayNameEn,
    character: Object.freeze({
      fontFamily: 'Frank Ruhl Libre',
      fontSizePt,
      fontWeight: 400,
      fontStyle: 'normal',
      isBold: false,
      isItalic: false,
      isUnderline: false,
      textColor: '#121214',
      trackingEm: 0,
      wordSpacingRatio: 1.0,
      horizontalScalePercent: 100,
      baselineShiftPt: 0,
      scriptPosition: 'normal',
      openTypeFeatures: { ...DEFAULT_OPENTYPE_FEATURES },
      ...charOverrides,
    }),
    paragraph: Object.freeze({
      alignment: 'justify',
      lastLineAlignment: 'right',
      direction: 'rtl',
      leadingMode: 'auto',
      leadingPt,
      lineSpacingRatio,
      spaceBeforePt: 0,
      spaceAfterPt: 2,
      firstLineIndentPt: 0,
      rightIndentPt: 0,
      leftIndentPt: 0,
      hangingIndentPt: 0,
      tabStopsPt: [],
      justifyNonFinalLines: true,
      hyphenation: 'hebrew_maqaf',
      keepWithNext: false,
      keepWithNextLines: paraOverrides.keepWithNext ? (paraOverrides.minFollowingLines ?? 2) : 0,
      keepLinesTogether: false,
      minFollowingLines: 1,
      minOrphanLines: 2,
      minWidowLines: 2,
      minFinalLineWords: 2,
      startOnNewPage: false,
      preventWidows: true,
      preventOrphans: true,
      ...paraOverrides,
    }),
  });
}

/**
 * Authoritative Global Styles (`GLOBAL_STYLE`) for all semantic roles in Keter Typesetter.
 * Frozen in memory so project or local edits never mutate canonical application defaults.
 */
export const GLOBAL_ROLE_STYLES: Readonly<Record<SemanticStyleRole, RoleDesignStyle>> = Object.freeze({
  book: createRoleStyle(
    'book',
    'ספר / מסמך ראשי',
    'Book Root',
    { fontSizePt: 14.5, fontWeight: 400 },
    { alignment: 'justify', lineSpacingRatio: 1.32 }
  ),
  main_title: createRoleStyle(
    'main_title',
    'כותרת ראשית / שער',
    'Main Title',
    { fontSizePt: 20.0, fontWeight: 700, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.25,
      spaceBeforePt: 8,
      spaceAfterPt: 6,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  subtitle: createRoleStyle(
    'subtitle',
    'כותרת משנה',
    'Subtitle',
    { fontSizePt: 15.0, fontWeight: 600, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.25,
      spaceBeforePt: 4,
      spaceAfterPt: 4,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  introduction: createRoleStyle(
    'introduction',
    'הקדמה / מבוא',
    'Introduction',
    { fontSizePt: 13.0, fontWeight: 400 },
    { alignment: 'justify', lineSpacingRatio: 1.3, firstLineIndentPt: 12, spaceAfterPt: 3 }
  ),
  chapter: createRoleStyle(
    'chapter',
    'פרק / כותרת פרק',
    'Chapter Heading',
    { fontSizePt: 16.0, fontWeight: 700, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.3,
      spaceBeforePt: 6,
      spaceAfterPt: 4,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  siman: createRoleStyle(
    'siman',
    'סימן (שולחן ערוך / הלכה)',
    'Siman Heading',
    { fontSizePt: 15.0, fontWeight: 700, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.28,
      spaceBeforePt: 5,
      spaceAfterPt: 3,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  seif: createRoleStyle(
    'seif',
    'סעיף הלכתי',
    'Seif',
    { fontSizePt: 13.0, fontWeight: 600, isBold: true },
    { alignment: 'justify', lineSpacingRatio: 1.26, keepWithNext: true }
  ),
  heading: createRoleStyle(
    'heading',
    'כותרת',
    'Heading',
    { fontSizePt: 16.0, fontWeight: 700, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.3,
      spaceBeforePt: 6,
      spaceAfterPt: 4,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  subheading: createRoleStyle(
    'subheading',
    'כותרת משנית',
    'Subheading',
    { fontSizePt: 14.0, fontWeight: 600, isBold: true },
    {
      alignment: 'right',
      lastLineAlignment: 'right',
      lineSpacingRatio: 1.25,
      spaceBeforePt: 4,
      spaceAfterPt: 2,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  main_source: createRoleStyle(
    'main_source',
    'מקור ראשי (גמרא / משנה / פנים)',
    'Main Source',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.5, fontWeight: 600 },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 2 }
  ),
  verse: createRoleStyle(
    'verse',
    'פסוק (מקראות גדולות / תנ״ך)',
    'Biblical Verse',
    {
      fontFamily: 'Taamey Frank CLM',
      fontSizePt: 16.0,
      fontWeight: 600,
      openTypeFeatures: {
        ...DEFAULT_OPENTYPE_FEATURES,
        hebrewTypographyMode: 'biblical_taamim',
      },
    },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.35, spaceAfterPt: 3 }
  ),
  regular_paragraph: createRoleStyle(
    'regular_paragraph',
    'גוף טקסט / פסקה רגילה',
    'Body Paragraph',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 13.5, fontWeight: 400 },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 2 }
  ),
  bold_special: createRoleStyle(
    'bold_special',
    'טקסט מודגש / מיוחד',
    'Special Bold Text',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 13.5, fontWeight: 700, isBold: true },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.3 }
  ),
  primary_comment: createRoleStyle(
    'primary_comment',
    'פירוש ראשי (רש״י / משנה ברורה)',
    'Primary Commentary (Rashi)',
    { fontFamily: 'Noto Rashi Hebrew', fontSizePt: 10.5, fontWeight: 400, textColor: '#222120' },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 1.5 }
  ),
  secondary_comment: createRoleStyle(
    'secondary_comment',
    'פירוש משני (תוספות / ש״ך / ביאור הלכה)',
    'Secondary Commentary (Tosafot)',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 400, textColor: '#222120' },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 1.5 }
  ),
  tertiary_comment: createRoleStyle(
    'tertiary_comment',
    'פירוש שלישי (עין משפט / מסורת הש״ס)',
    'Tertiary Commentary',
    { fontFamily: 'David Libre', fontSizePt: 9.0, fontWeight: 400, textColor: '#2C2A29' },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.24, spaceAfterPt: 1 }
  ),
  dibbur_hamatchil: createRoleStyle(
    'dibbur_hamatchil',
    'דיבור המתחיל (ד״ה)',
    'Dibbur HaMatchil',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 700, isBold: true },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, keepWithNext: true }
  ),
  footnote: createRoleStyle(
    'footnote',
    'הערות שוליים',
    'Footnote',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 9.5, fontWeight: 400, textColor: '#3A3836' },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.36, leadingPt: 13.0, spaceAfterPt: 1.5 }
  ),
  side_note: createRoleStyle(
    'side_note',
    'הערת צד / גליון הש״ס',
    'Side Note',
    { fontFamily: 'David Libre', fontSizePt: 8.5, fontWeight: 400 },
    { alignment: 'right', lastLineAlignment: 'right', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  cross_reference: createRoleStyle(
    'cross_reference',
    'מראה מקום / הפניה',
    'Cross Reference',
    { fontFamily: 'David Libre', fontSizePt: 8.5, fontWeight: 600, isBold: true },
    { alignment: 'right', lastLineAlignment: 'right', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  ornament: createRoleStyle(
    'ornament',
    'עיטור / מסגרת (משתמש בלבד)',
    'User Ornament',
    { fontSizePt: 12.0, fontWeight: 400 },
    { alignment: 'center', lastLineAlignment: 'center', justifyNonFinalLines: false }
  ),
  continuation: createRoleStyle(
    'continuation',
    'שורת המשך (המשך מעמוד קודם / לעמוד הבא)',
    'Continuation Marker',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 8.5, fontWeight: 600, textColor: '#5C5346' },
    { alignment: 'left', lastLineAlignment: 'left', lineSpacingRatio: 1.15, justifyNonFinalLines: false }
  ),
  page_element: createRoleStyle(
    'page_element',
    'כותרת רצה ומספור דפים',
    'Running Header & Folio',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 600, textColor: '#2C2A29' },
    { alignment: 'center', lastLineAlignment: 'center', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  table: createRoleStyle(
    'table',
    'טבלה',
    'Table',
    { fontSizePt: 11.0, fontWeight: 400 },
    { alignment: 'right', lineSpacingRatio: 1.25 }
  ),
  image: createRoleStyle(
    'image',
    'תמונה / שרטוט',
    'Image',
    { fontSizePt: 10.0, fontWeight: 400 },
    { alignment: 'center', lineSpacingRatio: 1.2 }
  ),
  chart: createRoleStyle(
    'chart',
    'תרשים',
    'Chart',
    { fontSizePt: 10.0, fontWeight: 400 },
    { alignment: 'center', lineSpacingRatio: 1.2 }
  ),
  caption: createRoleStyle(
    'caption',
    'כיתוב תמונה / טבלה',
    'Caption',
    { fontSizePt: 9.5, fontWeight: 500, isItalic: true, fontStyle: 'italic' },
    { alignment: 'center', lineSpacingRatio: 1.25 }
  ),
  list_item: createRoleStyle(
    'list_item',
    'פריט רשימה',
    'List Item',
    { fontSizePt: 13.0, fontWeight: 400 },
    { alignment: 'justify', rightIndentPt: 14, hangingIndentPt: 10, lineSpacingRatio: 1.28 }
  ),
  header_running: createRoleStyle(
    'header_running',
    'כותרת רצה בראש עמוד',
    'Running Header',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 600, textColor: '#2C2A29' },
    { alignment: 'center', lastLineAlignment: 'center', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  folio_number: createRoleStyle(
    'folio_number',
    'מספר דף / עמוד',
    'Folio Number',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 700, isBold: true, textColor: '#2C2A29' },
    { alignment: 'right', lastLineAlignment: 'right', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  halakha: createRoleStyle(
    'halakha',
    'הלכה פסוקה',
    'Halakha',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.0, fontWeight: 600 },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 2 }
  ),
  quote: createRoleStyle(
    'quote',
    'ציטוט / מובאה',
    'Quote',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 12.5, fontWeight: 400 },
    { alignment: 'justify', lastLineAlignment: 'right', rightIndentPt: 12, leftIndentPt: 12, lineSpacingRatio: 1.28 }
  ),
  body: createRoleStyle(
    'body',
    'גוף טקסט ראשי',
    'Body Text',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 13.5, fontWeight: 400 },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 2 }
  ),
});

export interface DesignUpdateSafetyReport {
  clampedByEngineHardRule: boolean;
  warnings: string[];
  settings: ProfessionalDesignSettings;
}

// ---------------------------------------------------------------------------
// v0.3.0 (Module C) — READY DESIGN PRESETS
//
// One-click, opt-in design packs. A preset is a partial `ProfessionalDesignSettings`
// patch (layout + page geometry + role styles + per-tier config); applying one
// never deletes project/local overrides outside the patched fields, and every
// value still passes through `sanitizeAndEnforceHardRules` (Stage 12 Level 0).
// Existing behaviour is unchanged unless the user explicitly picks a preset.
// ---------------------------------------------------------------------------

export type ReadyDesignId =
  | 'vilna_shas'
  | 'mikraot_gedolot'
  | 'siddur_vocalized'
  | 'halacha_topics'
  | 'simple_book'
  | 'shulchan_aruch_6'
  // v0.8.0 Part D — Yiddish sefarim presets (layout 'yiddish_sefer').
  | 'yiddish_sefer'
  | 'tzenerene';

/** Partial settings patch a ready design applies (all fields optional). */
export interface ReadyDesignPatch {
  layoutType?: BookLayoutType;
  pageSizePreset?: PageLayoutDesignSettings['pageSizePreset'];
  pageLayout?: Partial<PageLayoutDesignSettings>;
  pageElements?: Partial<PageElementsDesignSettings>;
  columns?: Partial<ColumnDesignSettings>;
  ravText?: Partial<RavTextDesignSettings>;
  footnotes?: Partial<FootnoteDesignSettings>;
  roleStyles?: Partial<
    Record<
      SemanticStyleRole,
      {
        character?: Partial<CharacterStyleSettings>;
        paragraph?: Partial<ParagraphStyleSettings>;
      }
    >
  >;
  tiers?: TierConfig[];
}

export interface ReadyDesignPreset {
  id: ReadyDesignId;
  nameHe: string;
  nameEn: string;
  descriptionHe: string;
  descriptionEn: string;
  /** Target layout this preset switches the project to. */
  layout: BookLayoutType;
  /** v0.4.0 — book type this kit is for (checklist §3 filter). */
  category: 'gemara' | 'tanakh' | 'siddur' | 'halacha' | 'chiddushim' | 'derashot_mussar' | 'sheilot_uteshuvot' | 'general' | 'yiddish';
  patch: ReadyDesignPatch;
}

export const READY_DESIGNS: ReadonlyArray<ReadyDesignPreset> = Object.freeze([
  {
    id: 'vilna_shas',
    category: 'gemara',
    nameHe: 'ש״ס וילנא',
    nameEn: 'Vilna Shas',
    descriptionHe: 'צורת הדף הקלאסית: גמרא במרכז, רש״י ותוספות משני הצדדים.',
    descriptionEn: 'Classic tzurat hadaf: Gemara centred, Rashi and Tosafot flanking it.',
    layout: 'rav_text',
    patch: {
      pageSizePreset: 'vilna_folio',
      pageLayout: {
        pageWidthPt: 510,
        pageHeightPt: 720,
        marginTopPt: 52,
        marginBottomPt: 52,
        marginInsidePt: 50,
        marginOutsidePt: 46,
        columnCount: 1,
        columnGutterPt: 12,
        pageNumberPosition: 'top_outside',
        showRunningHeader: true,
      },
      pageElements: { folioNumberPosition: 'top_outside', showRunningHeader: true },
      ravText: {
        sourceFontFamily: 'Frank Ruhl Libre',
        sourceFontSizePt: 14.5,
        sourceLineSpacingRatio: 1.32,
        rashiFontFamily: 'Noto Rashi Hebrew',
        rashiFontSizePt: 10.5,
        tosafotFontFamily: 'Frank Ruhl Libre',
        tosafotFontSizePt: 10.5,
        commentaryLineSpacingRatio: 1.32,
        gutterWidthPt: 12,
        upperCollarLines: 4,
        kneeJunctionPercent: 50,
        lowerSourceWidthPercent: 72,
        sourceExpansionBehavior: 'balanced_vilna',
        dibburHamatchilBold: true,
      },
      roleStyles: {
        main_source: {
          character: { fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.5, fontWeight: 600, isBold: true },
          paragraph: { lineSpacingRatio: 1.32 },
        },
        primary_comment: {
          character: { fontFamily: 'Noto Rashi Hebrew', fontSizePt: 10.5 },
          paragraph: { lineSpacingRatio: 1.32 },
        },
        secondary_comment: {
          character: { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5 },
          paragraph: { lineSpacingRatio: 1.32 },
        },
        dibbur_hamatchil: {
          character: { fontSizePt: 10.5, fontWeight: 700, isBold: true },
          paragraph: { keepWithNext: true },
        },
        footnote: { character: { fontSizePt: 9.5 }, paragraph: { lineSpacingRatio: 1.36 } },
      },
      tiers: [
        { role: 'main_source', tierIndex: 1, labelHe: 'גמרא', labelEn: 'Gemara', widthPct: 52, fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.5, lineHeight: 1.32 },
        { role: 'primary_comment', tierIndex: 2, labelHe: 'רש״י', labelEn: 'Rashi', widthPct: 24, fontFamily: 'Noto Rashi Hebrew', fontSizePt: 10.5, lineHeight: 1.32, side: 'inside' },
        { role: 'secondary_comment', tierIndex: 3, labelHe: 'תוספות', labelEn: 'Tosafot', widthPct: 24, fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, lineHeight: 1.32, side: 'outside' },
      ],
    },
  },
  {
    id: 'mikraot_gedolot',
    category: 'tanakh',
    nameHe: 'מקראות גדולות',
    nameEn: 'Mikraot Gedolot',
    descriptionHe: 'פסוק ותרגום למעלה, מפרשים בשכבות למטה — עד שש שכבות פירוש.',
    descriptionEn: 'Verse and Targum on top, commentaries tiered below — up to six comment tiers.',
    layout: 'mikraot_gedolot',
    patch: {
      pageSizePreset: 'royal_holy_book',
      pageLayout: {
        pageNumberPosition: 'top_outside',
        showRunningHeader: true,
      },
      pageElements: { folioNumberPosition: 'top_outside', showRunningHeader: true },
      ravText: {
        sourceFontFamily: 'Taamey Frank CLM',
        sourceFontSizePt: 16,
        sourceLineSpacingRatio: 1.35,
        rashiFontFamily: 'Noto Rashi Hebrew',
        rashiFontSizePt: 10.5,
        tosafotFontFamily: 'Frank Ruhl Libre',
        tosafotFontSizePt: 10,
        commentaryLineSpacingRatio: 1.32,
      },
      roleStyles: {
        verse: {
          character: {
            fontFamily: 'Taamey Frank CLM',
            fontSizePt: 16,
            fontWeight: 600,
            isBold: true,
            openTypeFeatures: { ...DEFAULT_OPENTYPE_FEATURES, hebrewTypographyMode: 'biblical_taamim' },
          },
          paragraph: { lineSpacingRatio: 1.35, spaceAfterPt: 3 },
        },
        primary_comment: {
          character: { fontFamily: 'Frank Ruhl Libre', fontSizePt: 11 },
          paragraph: { lineSpacingRatio: 1.32 },
        },
        secondary_comment: {
          character: { fontFamily: 'Noto Rashi Hebrew', fontSizePt: 10.5 },
          paragraph: { lineSpacingRatio: 1.32 },
        },
        tertiary_comment: {
          character: { fontFamily: 'David Libre', fontSizePt: 9.5 },
          paragraph: { lineSpacingRatio: 1.28 },
        },
      },
      tiers: [
        { role: 'verse', tierIndex: 1, labelHe: 'פסוק', labelEn: 'Verse', widthPct: 100, fontFamily: 'Taamey Frank CLM', fontSizePt: 16, lineHeight: 1.35, side: 'below' },
        { role: 'primary_comment', tierIndex: 2, labelHe: 'תרגום אונקלוס', labelEn: 'Targum Onkelos', widthPct: 100, fontFamily: 'Frank Ruhl Libre', fontSizePt: 11, lineHeight: 1.32, side: 'below' },
        { role: 'secondary_comment', tierIndex: 3, labelHe: 'רש״י', labelEn: 'Rashi', widthPct: 50, fontFamily: 'Noto Rashi Hebrew', fontSizePt: 10.5, lineHeight: 1.32, side: 'below' },
        { role: 'tertiary_comment', tierIndex: 4, labelHe: 'רמב״ן', labelEn: 'Ramban', widthPct: 50, fontFamily: 'Frank Ruhl Libre', fontSizePt: 10, lineHeight: 1.3, side: 'below' },
        { role: 'tertiary_comment', tierIndex: 5, labelHe: 'אבן עזרא', labelEn: 'Ibn Ezra', widthPct: 50, fontFamily: 'David Libre', fontSizePt: 9.5, lineHeight: 1.28, side: 'below' },
        { role: 'tertiary_comment', tierIndex: 6, labelHe: 'ספורנו', labelEn: 'Sforno', widthPct: 50, fontFamily: 'David Libre', fontSizePt: 9.5, lineHeight: 1.28, side: 'below' },
        { role: 'tertiary_comment', tierIndex: 7, labelHe: 'רד״ק', labelEn: 'Radak', widthPct: 50, fontFamily: 'David Libre', fontSizePt: 9.5, lineHeight: 1.28, side: 'below' },
      ],
    },
  },
  {
    id: 'siddur_vocalized',
    category: 'siddur',
    nameHe: 'סידור מנוקד',
    nameEn: 'Siddur (Large Vocalized)',
    descriptionHe: 'אותיות גדולות ורווח נדיב לניקוד וטעמים — לקריאה נוחה.',
    descriptionEn: 'Large type with generous leading for nikud and taamim — easy reading.',
    layout: 'single_column',
    patch: {
      pageSizePreset: 'crown_quarto',
      pageLayout: {
        pageWidthPt: 440,
        pageHeightPt: 640,
        marginTopPt: 56,
        marginBottomPt: 56,
        marginInsidePt: 52,
        marginOutsidePt: 48,
        columnCount: 1,
        pageNumberPosition: 'bottom_center',
        showRunningHeader: true,
      },
      pageElements: { folioNumberPosition: 'bottom_center', showRunningHeader: true },
      ravText: {
        sourceFontFamily: 'Taamey Frank CLM',
        sourceFontSizePt: 18,
        sourceLineSpacingRatio: 1.6,
      },
      roleStyles: {
        main_source: {
          character: {
            fontFamily: 'Taamey Frank CLM',
            fontSizePt: 18,
            fontWeight: 600,
            isBold: true,
            openTypeFeatures: { ...DEFAULT_OPENTYPE_FEATURES, hebrewTypographyMode: 'biblical_taamim' },
          },
          paragraph: { lineSpacingRatio: 1.6, spaceAfterPt: 4 },
        },
        regular_paragraph: {
          character: { fontFamily: 'Taamey Frank CLM', fontSizePt: 16 },
          paragraph: { lineSpacingRatio: 1.55 },
        },
        heading: {
          character: { fontSizePt: 17, fontWeight: 700, isBold: true },
          paragraph: { alignment: 'center', lastLineAlignment: 'center', lineSpacingRatio: 1.4 },
        },
      },
      footnotes: { fontSizePt: 10, lineSpacingPt: 14 },
      tiers: [
        { role: 'main_source', tierIndex: 1, labelHe: 'תפילה', labelEn: 'Prayer text', widthPct: 100, fontFamily: 'Taamey Frank CLM', fontSizePt: 18, lineHeight: 1.6 },
      ],
    },
  },
  {
    id: 'halacha_topics',
    category: 'halacha',
    nameHe: 'הלכה לפי נושאים',
    nameEn: 'Halakha by Topic',
    descriptionHe: 'כותרת לכל נושא ופתיחה מודגשת לכל סעיף — מספור פנימי בראש העמוד.',
    descriptionEn: 'A heading per topic with bold seif openings — inside folio at the top.',
    layout: 'single_column',
    patch: {
      pageLayout: {
        pageNumberPosition: 'top_inside',
        showRunningHeader: true,
      },
      pageElements: { folioNumberPosition: 'top_inside', showRunningHeader: true },
      roleStyles: {
        chapter: {
          character: { fontSizePt: 16, fontWeight: 700, isBold: true },
          paragraph: { alignment: 'center', lastLineAlignment: 'center', spaceBeforePt: 8, spaceAfterPt: 4, keepWithNext: true, minFollowingLines: 2 },
        },
        siman: {
          character: { fontSizePt: 15, fontWeight: 700, isBold: true },
          paragraph: { alignment: 'center', lastLineAlignment: 'center', spaceBeforePt: 6, spaceAfterPt: 3, keepWithNext: true, minFollowingLines: 2 },
        },
        seif: {
          character: { fontSizePt: 13.5, fontWeight: 700, isBold: true },
          paragraph: { lineSpacingRatio: 1.28, keepWithNext: true },
        },
        halakha: {
          character: { fontSizePt: 14, fontWeight: 600, isBold: true },
          paragraph: { lineSpacingRatio: 1.32 },
        },
        main_source: {
          character: { fontSizePt: 13.5 },
          paragraph: { lineSpacingRatio: 1.32 },
        },
      },
      tiers: [
        { role: 'main_source', tierIndex: 1, labelHe: 'הלכה', labelEn: 'Halakha', widthPct: 100, fontFamily: 'Frank Ruhl Libre', fontSizePt: 13.5, lineHeight: 1.32 },
      ],
    },
  },
  {
    id: 'simple_book',
    category: 'chiddushim',
    nameHe: 'ספר פשוט',
    nameEn: 'Simple Book',
    descriptionHe: 'טור אחד נקי, בלי מסגרת מקושטת — מוסר, דרוש ושו״ת.',
    descriptionEn: 'One clean column, no decorative frame — mussar, derush and responsa.',
    layout: 'single_column',
    patch: {
      pageLayout: {
        pageNumberPosition: 'bottom_center',
        showRunningHeader: true,
      },
      pageElements: { folioNumberPosition: 'bottom_center', showRunningHeader: true, showDecorativeFrame: false },
      roleStyles: {
        main_source: {
          character: { fontSizePt: 13.5 },
          paragraph: { lineSpacingRatio: 1.32 },
        },
        regular_paragraph: {
          character: { fontSizePt: 13.5 },
          paragraph: { lineSpacingRatio: 1.32, firstLineIndentPt: 12 },
        },
        heading: {
          character: { fontSizePt: 16, fontWeight: 700, isBold: true },
          paragraph: { alignment: 'center', lastLineAlignment: 'center', keepWithNext: true, minFollowingLines: 2 },
        },
      },
      tiers: [
        { role: 'main_source', tierIndex: 1, labelHe: 'גוף הספר', labelEn: 'Body text', widthPct: 100, fontFamily: 'Frank Ruhl Libre', fontSizePt: 13.5, lineHeight: 1.32 },
      ],
    },
  },
  {
    id: 'shulchan_aruch_6',
    category: 'halacha',
    nameHe: 'שולחן ערוך — 6 טקסטים',
    nameEn: 'Shulchan Arukh (6 Texts)',
    descriptionHe: 'שולחן ערוך בשני טורים עם חמישה מפרשים בשכבות — ט״ז, ש״ך, מג״א, בא״ה ומשנה ברורה.',
    descriptionEn: 'Shulchan Arukh in two columns with five commentaries tiered below — Taz, Shakh, Magen Avraham, Be\'er Heitev and Mishnah Berurah.',
    layout: 'two_column',
    patch: {
      pageLayout: {
        columnCount: 2,
        columnGutterPt: 16,
        pageNumberPosition: 'top_outside',
        showRunningHeader: true,
      },
      columns: { columnCount: 2, columnGapPt: 16, balanceColumns: true },
      pageElements: { folioNumberPosition: 'top_outside', showRunningHeader: true },
      ravText: {
        sourceFontFamily: 'Frank Ruhl Libre',
        sourceFontSizePt: 13,
        sourceLineSpacingRatio: 1.3,
        rashiFontSizePt: 10,
        tosafotFontSizePt: 10,
        commentaryLineSpacingRatio: 1.3,
      },
      roleStyles: {
        main_source: {
          character: { fontSizePt: 13, fontWeight: 700, isBold: true },
          paragraph: { lineSpacingRatio: 1.3 },
        },
        siman: {
          character: { fontSizePt: 15, fontWeight: 700, isBold: true },
          paragraph: { alignment: 'center', lastLineAlignment: 'center', keepWithNext: true, minFollowingLines: 2 },
        },
        seif: {
          character: { fontSizePt: 13, fontWeight: 700, isBold: true },
          paragraph: { lineSpacingRatio: 1.28, keepWithNext: true },
        },
        primary_comment: {
          character: { fontSizePt: 10 },
          paragraph: { lineSpacingRatio: 1.3 },
        },
        secondary_comment: {
          character: { fontSizePt: 10 },
          paragraph: { lineSpacingRatio: 1.3 },
        },
        tertiary_comment: {
          character: { fontFamily: 'David Libre', fontSizePt: 9.5 },
          paragraph: { lineSpacingRatio: 1.28 },
        },
      },
      tiers: [
        { role: 'main_source', tierIndex: 1, labelHe: 'שולחן ערוך', labelEn: 'Shulchan Arukh', widthPct: 100, fontFamily: 'Frank Ruhl Libre', fontSizePt: 13, lineHeight: 1.3, side: 'below' },
        { role: 'primary_comment', tierIndex: 2, labelHe: 'ט״ז', labelEn: 'Taz', widthPct: 50, fontFamily: 'Frank Ruhl Libre', fontSizePt: 10, lineHeight: 1.3, side: 'below' },
        { role: 'secondary_comment', tierIndex: 3, labelHe: 'ש״ך', labelEn: 'Shakh', widthPct: 50, fontFamily: 'Frank Ruhl Libre', fontSizePt: 10, lineHeight: 1.3, side: 'below' },
        { role: 'tertiary_comment', tierIndex: 4, labelHe: 'מגן אברהם', labelEn: 'Magen Avraham', widthPct: 50, fontFamily: 'David Libre', fontSizePt: 9.5, lineHeight: 1.28, side: 'below' },
        { role: 'tertiary_comment', tierIndex: 5, labelHe: 'באר היטב', labelEn: 'Be\'er Heitev', widthPct: 50, fontFamily: 'David Libre', fontSizePt: 9.5, lineHeight: 1.28, side: 'below' },
        { role: 'tertiary_comment', tierIndex: 6, labelHe: 'משנה ברורה', labelEn: 'Mishnah Berurah', widthPct: 50, fontFamily: 'Frank Ruhl Libre', fontSizePt: 9.5, lineHeight: 1.28, side: 'below' },
      ],
    },
  },
  // v0.8.0 Part D — Yiddish sefarim: Hebrew source in the right column
  // facing Yiddish text in the left column (same-page facing columns),
  // parsha headings centred in the traditional style.
  {
    id: 'yiddish_sefer',
    category: 'yiddish',
    nameHe: 'ספר יידיש · מקור מול תרגום',
    nameEn: 'Yiddish Sefer · Source Facing Translation',
    descriptionHe: 'מקור עברי בטור הימני, טקסט יידיש בטור השמאלי — תרגום, ביאור ופירוש חסידי מול המקור.',
    descriptionEn: 'Hebrew source in the right column facing Yiddish text in the left — translation, Biur and Chassidic commentary facing the source.',
    layout: 'yiddish_sefer',
    patch: {
      pageSizePreset: 'royal_holy_book',
      pageLayout: {
        pageNumberPosition: 'top_outside',
        showRunningHeader: true,
      },
      pageElements: { folioNumberPosition: 'top_outside', showRunningHeader: true },
      columns: { columnCount: 2, columnGapPt: 12, balanceColumns: true },
      ravText: {
        sourceFontFamily: 'Frank Ruhl Libre',
        sourceFontSizePt: 14.5,
        sourceLineSpacingRatio: 1.32,
        rashiFontFamily: 'Frank Ruhl Libre',
        rashiFontSizePt: 11,
        tosafotFontFamily: 'Frank Ruhl Libre',
        tosafotFontSizePt: 10,
        commentaryLineSpacingRatio: 1.32,
      },
      roleStyles: {
        chapter: {
          character: { fontSizePt: 17, fontWeight: 700, isBold: true },
          paragraph: { alignment: 'center', lastLineAlignment: 'center', spaceBeforePt: 12, spaceAfterPt: 8, keepWithNext: true, minFollowingLines: 2 },
        },
        main_source: {
          character: { fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.5 },
          paragraph: { alignment: 'justify', firstLineIndentPt: 0, hangingIndentPt: 0, lineSpacingRatio: 1.32 },
        },
        primary_comment: {
          character: { fontFamily: 'Frank Ruhl Libre', fontSizePt: 11 },
          paragraph: { alignment: 'justify', lineSpacingRatio: 1.32 },
        },
        secondary_comment: {
          character: { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10 },
          paragraph: { alignment: 'justify', lineSpacingRatio: 1.3 },
        },
      },
      tiers: [
        { role: 'main_source', tierIndex: 1, labelHe: 'מקור עברי', labelEn: 'Hebrew source', widthPct: 45, fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.5, lineHeight: 1.32, side: 'right' },
        { role: 'primary_comment', tierIndex: 2, labelHe: 'תרגום יידיש', labelEn: 'Yiddish translation', widthPct: 55, fontFamily: 'Frank Ruhl Libre', fontSizePt: 11, lineHeight: 1.32, side: 'left' },
        { role: 'secondary_comment', tierIndex: 3, labelHe: 'ביאור', labelEn: 'Biur', widthPct: 100, fontFamily: 'Frank Ruhl Libre', fontSizePt: 10, lineHeight: 1.3, side: 'below' },
      ],
    },
  },
  {
    id: 'tzenerene',
    category: 'yiddish',
    nameHe: 'צאינה וראינה',
    nameEn: 'Tzenerene',
    descriptionHe: 'טקסט יידיש רץ בטור יחיד רחב עם כותרות פרשה ממורכזות — מתכונת צאינה וראינה הקלאסית.',
    descriptionEn: 'Yiddish running text in a single wide column with centred parsha headings — the classic Tzenerene format.',
    layout: 'yiddish_sefer',
    patch: {
      pageSizePreset: 'royal_holy_book',
      pageLayout: {
        pageNumberPosition: 'top_outside',
        showRunningHeader: true,
      },
      pageElements: { folioNumberPosition: 'top_outside', showRunningHeader: true },
      columns: { columnCount: 1, columnGapPt: 12, balanceColumns: true },
      ravText: {
        sourceFontFamily: 'Frank Ruhl Libre',
        sourceFontSizePt: 14.5,
        sourceLineSpacingRatio: 1.35,
        rashiFontFamily: 'Frank Ruhl Libre',
        rashiFontSizePt: 11,
        tosafotFontFamily: 'Frank Ruhl Libre',
        tosafotFontSizePt: 10,
        commentaryLineSpacingRatio: 1.32,
      },
      roleStyles: {
        chapter: {
          character: { fontSizePt: 17, fontWeight: 700, isBold: true },
          paragraph: { alignment: 'center', lastLineAlignment: 'center', spaceBeforePt: 12, spaceAfterPt: 8, keepWithNext: true, minFollowingLines: 2 },
        },
        main_source: {
          character: { fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.5 },
          paragraph: { alignment: 'justify', firstLineIndentPt: 0, hangingIndentPt: 0, lineSpacingRatio: 1.35 },
        },
        primary_comment: {
          character: { fontFamily: 'Frank Ruhl Libre', fontSizePt: 11 },
          paragraph: { alignment: 'justify', lineSpacingRatio: 1.32 },
        },
      },
      tiers: [
        { role: 'main_source', tierIndex: 1, labelHe: 'צאינה וראינה', labelEn: 'Tzenerene', widthPct: 100, fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.5, lineHeight: 1.35, side: 'below' },
        { role: 'primary_comment', tierIndex: 2, labelHe: 'ביאור', labelEn: 'Biur', widthPct: 100, fontFamily: 'Frank Ruhl Libre', fontSizePt: 11, lineHeight: 1.32, side: 'below' },
      ],
    },
  },
]);

/** Looks a ready design up by id (undefined when unknown). */
export function getReadyDesign(presetId: string): ReadyDesignPreset | undefined {
  return READY_DESIGNS.find(p => p.id === presetId);
}

/**
 * v0.4.0 — plain-language names (Hebrew + English) for the ready designs,
 * so "use the classic Vilna look" / "השתמש בעיצוב וילנא הקלאסי" resolves to
 * the `vilna_shas` preset without the user knowing its id.
 */
export const READY_DESIGN_ALIASES: ReadonlyArray<{
  id: ReadyDesignId;
  aliases: string[];
}> = Object.freeze([
  { id: 'vilna_shas', aliases: ['vilna', 'וילנא', 'ש״ס וילנא', 'שס וילנא', 'classic vilna', 'tzurat hadaf', 'צורת הדף'] },
  { id: 'mikraot_gedolot', aliases: ['mikraot gedolot', 'mikraot', 'מקראות גדולות', 'מקראות'] },
  { id: 'siddur_vocalized', aliases: ['siddur', 'סידור', 'סידור מנוקד', 'prayer book'] },
  { id: 'halacha_topics', aliases: ['halacha', 'הלכה', 'הלכה לפי נושאים', 'halakha'] },
  { id: 'simple_book', aliases: ['simple book', 'ספר פשוט', 'plain book'] },
  { id: 'shulchan_aruch_6', aliases: ['shulchan aruch', 'שולחן ערוך', 'shulchan arukh'] },
  { id: 'yiddish_sefer', aliases: ['yiddish', 'יידיש', 'yiddish sefer', 'ספר יידיש', 'facing yiddish', 'yiddish translation', 'תרגום יידיש'] },
  { id: 'tzenerene', aliases: ['tzenerene', 'tzena urena', 'צאינה וראינה', 'צאינה', 'tzena', 'tsene rene'] },
]);

/** Resolves a free-text mention of a ready design to its preset, if any. */
export function findReadyDesignByName(text: string): ReadyDesignPreset | undefined {
  const norm = text.toLowerCase().replace(/[־–—-]/g, ' ');
  for (const entry of READY_DESIGN_ALIASES) {
    if (entry.aliases.some(a => norm.includes(a))) {
      return getReadyDesign(entry.id);
    }
  }
  return undefined;
}

/**
 * v0.4.0 — page dimensions (pt) for each page-size preset. `royal_holy_book`
 * has no fixed size in the code (it follows the project geometry), so it
 * keeps the current dimensions and only the preset name changes.
 */
export const PAGE_SIZE_DIMENSIONS: Readonly<
  Record<PageLayoutDesignSettings['pageSizePreset'], { widthPt: number; heightPt: number } | null>
> = Object.freeze({
  a4: { widthPt: 595, heightPt: 842 },
  // v0.4.0 — checklist §2 sizes (cm × 28.3465, rounded):
  // Pocket 10.5×14.8 → 298×420; Small (A5) 14.8×21 → 420×595;
  // Regular 17×24 → 482×680 (the app's long-standing default geometry);
  // Wide 17.6×25 → 499×709; Booklet (A4) 21×29.7 → 595×842;
  // Gemara 24×34 → 680×964.
  pocket: { widthPt: 298, heightPt: 420 },
  small_a5: { widthPt: 420, heightPt: 595 },
  regular_17x24: { widthPt: 482, heightPt: 680 },
  wide_17x25: { widthPt: 499, heightPt: 709 },
  booklet_a4: { widthPt: 595, heightPt: 842 },
  gemara_24x34: { widthPt: 680, heightPt: 964 },
  b5: { widthPt: 516, heightPt: 729 },
  vilna_folio: { widthPt: 510, heightPt: 720 },
  crown_quarto: { widthPt: 440, heightPt: 640 },
  // v0.9.8 Phase 5 (Quick-Tune) — US trim sizes (in × 72pt):
  // 6×9 → 432×648; 7×10 → 504×720; Letter 8.5×11 → 612×792.
  trim_6x9: { widthPt: 432, heightPt: 648 },
  trim_7x10: { widthPt: 504, heightPt: 720 },
  trim_letter: { widthPt: 612, heightPt: 792 },
  royal_holy_book: null,
  custom: null,
});

/** Valid roles a font/size/spacing command may target. */
const AI_ROLE_NAMES: ReadonlyArray<ContentRole> = Object.freeze([
  'main_source',
  'primary_comment',
  'secondary_comment',
  'tertiary_comment',
  'regular_paragraph',
  'chapter',
  'heading',
  'subheading',
  'footnote',
  'verse',
  'siman',
  'seif',
  'halakha',
  'dibbur_hamatchil',
  'main_title',
  'subtitle',
  'introduction',
  'body',
] as unknown as ContentRole[]);

function isAiRole(value: unknown): value is ContentRole {
  return typeof value === 'string' && (AI_ROLE_NAMES as ReadonlyArray<string>).includes(value);
}

function isKnownFontFamily(value: unknown): value is string {
  // v0.5.0 Part A — Module 1(d): a font the user scanned on their computer
  // or imported is a real, usable font too — the AI may switch to it.
  return (
    typeof value === 'string' &&
    (KNOWN_HOLY_BOOK_FONTS.some(f => f.family.toLowerCase() === value.toLowerCase()) ||
      isFontInLibrary(value))
  );
}

function numInRange(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

/**
 * v0.4.0 — validated settings patch for AI-proposed actions (local parser
 * results and Gemini `update_design_settings` / `switch_font` /
 * `apply_ready_design` actions). Every field is checked against the real
 * allowlists and ranges before anything is applied; unknown or out-of-range
 * fields are dropped, and a patch with nothing valid left returns null so
 * the caller shows a plain rejection instead of an approval card.
 * All values still pass through `sanitizeAndEnforceHardRules` via the
 * update* methods below, so Level 0 hard rules always apply.
 */
export interface AiSettingsPatch {
  presetId?: string;
  layoutType?: BookLayoutType;
  pageSizePreset?: PageLayoutDesignSettings['pageSizePreset'];
  orientation?: 'portrait' | 'landscape';
  margins?: { top?: number; bottom?: number; inside?: number; outside?: number; all?: number };
  columnCount?: 1 | 2 | 3;
  columnGutterPt?: number;
  balanceColumns?: boolean;
  showRunningHeader?: boolean;
  showRunningFooter?: boolean;
  showFolioNumber?: boolean;
  // v0.5.0 Part B (Module 6): visibility of the top header line.
  showTopHeaderLine?: boolean;
  // v0.5.0 (integrator — user request): commentary labels above the
  // columns (default off), page-number format and the "דף" prefix.
  showCommentaryLabels?: boolean;
  pageNumberStyle?: 'numbers' | 'hebrew';
  showDafPrefix?: boolean;
  // v0.6.0 Part A (§5): running-header text + display options. Text is
  // trimmed and capped at 200 chars; font size is clamped to 8–24pt;
  // alignment must be one of left/center/right. Per-folio overrides are
  // panel-only — the AI patch edits the book-wide header.
  runningHeader?: {
    leftText?: string;
    centerText?: string;
    rightText?: string;
    showBookTitle?: boolean;
    showChapterTitle?: boolean;
    showPageNumber?: boolean;
    alignment?: 'left' | 'center' | 'right';
    fontFamily?: string;
    fontSizePt?: number;
  };
  // v0.5.0 Part B (Module 5): margins / spacing of one text block
  // (role-level here — the validated action has no selected unit).
  blockMargins?: { left?: number; right?: number; top?: number; bottom?: number };
  blockSpaceBeforePt?: number;
  blockSpaceAfterPt?: number;
  autoCenterBlock?: boolean;
  pageNumberPosition?: 'top_outside' | 'top_center' | 'top_inside' | 'bottom_center' | 'bottom_outside' | 'hidden';
  fontFamily?: string;
  fontRole?: ContentRole;
  fontSizePt?: number;
  fontSizeRole?: ContentRole;
  fontSizeDelta?: number;
  lineSpacingRatio?: number;
  lineSpacingRole?: ContentRole;
  paragraphSpaceAfterPt?: number;
  paragraphRole?: ContentRole;
  alignment?: DesignAlignment;
  alignmentRole?: ContentRole;
  gutterWidthPt?: number;
  kneeJunctionPercent?: number;
  removeTierRole?: ContentRole;
  // --- v0.5.0 Part C — Module 3 (Custom Layout Designer) -------------------
  // Validated the same way as every other patch field below: unknown ids
  // and out-of-range numbers are dropped, never applied.
  customLayoutBox?: CustomLayoutBox;
  customLayoutBoxId?: string;
  customLayoutTemplateId?: string;
  customLayoutBaseLayout?: BookLayoutType;
  // --- v0.6.0 Part C (§2b) — per-page (folio-by-folio) overrides ---------
  // pageIndex is 0-based among BODY pages (the title page is not counted).
  customLayoutPageOverride?: { pageIndex?: number; boxes?: CustomLayoutBox[] };
  clearCustomLayoutPageOverride?: number;
  // --- v0.5.0 (Title Page / Shaar Blat builder) ---------------------------
  // Validated the same way: unknown border ids and out-of-range numbers
  // are dropped, never applied. Text is trimmed and capped at 200 chars.
  titlePage?: {
    enabled?: boolean;
    title?: string;
    subtitle?: string;
    author?: string;
    translator?: string;
    publisher?: string;
    volume?: string;
    year?: string;
    extraLines?: string[];
    borderStyleId?: string;
    borderThicknessPt?: number;
    borderInsetMm?: number;
    borderEnabled?: boolean;
    // --- v0.6.0 Part C (§8): border fit + per-field line height ---------
    borderScalePct?: number;
    borderPaddingMm?: number;
    borderOffsetXMm?: number;
    borderOffsetYMm?: number;
    fieldLineHeight?: Partial<Record<'title' | 'subtitle' | 'author' | 'translator' | 'publisher' | 'volume' | 'year', number>>;
  };
  indentMode?: ParagraphIndentMode;
  chalonIndentPt?: number;
  chalonLineCount?: number;
  openingDecoration?: { enabled?: boolean; styleId?: OpeningDecorationStyleId; wordCount?: number; paddingPt?: number; thicknessPt?: number; scope?: 'masechet_start' | 'chapter_start' };
  commentarySeparator?: SeparatorStyleId;
  paragraphSeparator?: SeparatorStyleId;
  transitionMarkerEnabled?: boolean;
  transitionMarker?: { enabled?: boolean; markerText?: string; style?: 'text' | 'boxed'; sizePt?: number; position?: 'before_first_word' | 'after_last_word' };
  dafFormat?: DafFormatMode;
}

export interface AiValidatedActionResult {
  settings: ProfessionalDesignSettings;
  summaryHe: string;
  summaryEn: string;
}

/**
 * Applies a validated AI settings patch (or a ready-design id / font switch)
 * to a copy of `current`. Returns null when the action type is unknown or
 * the data contains nothing valid — callers must reject, never apply.
 */
export function applyValidatedAiAction(
  current: ProfessionalDesignSettings,
  type: string,
  data: unknown
): AiValidatedActionResult | null {
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  if (!obj) return null;

  if (type === 'apply_ready_design') {
    const preset = typeof obj.presetId === 'string' ? getReadyDesign(obj.presetId) : undefined;
    if (!preset) return null;
    const report = DesignSettingsEngine.applyReadyDesign(current, preset.id, 'ai');
    return {
      settings: report.settings,
      summaryHe: `עיצוב מוכן: ${preset.nameHe}`,
      summaryEn: `Ready design: ${preset.nameEn}`,
    };
  }

  if (type === 'switch_font') {
    if (!isKnownFontFamily(obj.fontFamily)) return null;
    const role: ContentRole = isAiRole(obj.role) ? obj.role : 'primary_comment';
    // v0.5.0 Part A — Module 1(d): canonical family name comes from the
    // built-in catalogue first, then the font library (system / imported).
    const knownEntry = KNOWN_HOLY_BOOK_FONTS.find(
      f => f.family.toLowerCase() === (obj.fontFamily as string).toLowerCase()
    );
    const family = knownEntry
      ? knownEntry.family
      : (findFontLibraryEntry(obj.fontFamily as string)?.family as string);
    const report = DesignSettingsEngine.updateRoleStyle(
      current,
      role,
      { character: { fontFamily: family } },
      'ai',
      `AI: שינוי גופן ${role} ל-${family}`
    );
    return {
      settings: report.settings,
      summaryHe: `הגופן של ${GLOBAL_ROLE_STYLES[role as SemanticStyleRole]?.displayNameHe ?? role} עודכן ל-"${family}".`,
      summaryEn: `Updated ${role} font family to "${family}".`,
    };
  }

  // --- v0.5.0 Part C — Module 3 (Custom Layout Designer) -------------------
  // New AI action types. Both are validated (unknown template/box ids and
  // out-of-range numbers return null) and both run through
  // `sanitizeAndEnforceHardRules` via the update* methods, so Level 0
  // hard rules always apply. --- BEGIN Part C AI actions ---
  if (type === 'apply_custom_layout_template') {
    const templateId = typeof obj.templateId === 'string' ? obj.templateId : '';
    const template =
      listCustomLayoutTemplates().find(t => t.id === templateId) ??
      (typeof obj.templateName === 'string'
        ? findCustomLayoutTemplateByName(obj.templateName)
        : undefined);
    if (!template) return null;
    const report = DesignSettingsEngine.applyCustomLayoutTemplate(
      current,
      template,
      'ai'
    );
    return {
      settings: report.settings,
      summaryHe: `תבנית פריסה מותאמת הופעלה: ${template.nameHe}`,
      summaryEn: `Custom layout template applied: ${template.nameEn}`,
    };
  }

  if (type === 'set_custom_layout_box') {
    const box = obj.box as CustomLayoutBox | undefined;
    if (!box || typeof box !== 'object' || typeof box.id !== 'string') return null;
    const report = DesignSettingsEngine.updateCustomLayoutBox(current, box, 'ai');
    if (!report.settings.pageLayout.customLayout?.boxes.some(b => b.id === box.id)) {
      return null;
    }
    return {
      settings: report.settings,
      summaryHe: `התיבה "${box.labelHe ?? box.role}" עודכנה בפריסה המותאמת`,
      summaryEn: `Updated the "${box.labelEn ?? box.role}" box in the custom layout`,
    };
  }
  // --- END Part C AI actions ---

  if (type !== 'update_design_settings') return null;
  const patch = (obj.patch ?? obj) as Record<string, unknown>;
  if (!patch || typeof patch !== 'object') return null;

  let working = DesignSettingsEngine.cloneSettings(current);
  const summariesHe: string[] = [];
  const summariesEn: string[] = [];
  let anyApplied = false;

  const applyRoleStyle = (
    role: ContentRole,
    character?: Partial<CharacterStyleSettings>,
    paragraph?: Partial<ParagraphStyleSettings>
  ) => {
    const report = DesignSettingsEngine.updateRoleStyle(
      working,
      role,
      { character, paragraph },
      'ai'
    );
    working = report.settings;
    anyApplied = true;
  };

  if (typeof patch.presetId === 'string') {
    const preset = getReadyDesign(patch.presetId);
    if (preset) {
      working = DesignSettingsEngine.applyReadyDesign(working, preset.id, 'ai').settings;
      summariesHe.push(`עיצוב מוכן: ${preset.nameHe}`);
      summariesEn.push(`Ready design: ${preset.nameEn}`);
      anyApplied = true;
    }
  }
  if (typeof patch.layoutType === 'string') {
    const layout = patch.layoutType as BookLayoutType;
    if (['rav_text', 'single_column', 'two_column', 'source_top_commentary_bottom', 'mikraot_gedolot', 'custom_layout', 'yiddish_sefer'].includes(layout)) {
      const columnCount: 1 | 2 = layout === 'two_column' ? 2 : 1;
      working = DesignSettingsEngine.updatePageLayout(
        working,
        { layoutType: layout, columnCount },
        'ai'
      ).settings;
      working.layoutType = layout;
      summariesHe.push(`הפריסה הוחלפה ל-${layout}`);
      summariesEn.push(`Layout changed to ${layout}`);
      anyApplied = true;
    }
  }
  if (typeof patch.pageSizePreset === 'string') {
    const preset = patch.pageSizePreset as PageLayoutDesignSettings['pageSizePreset'];
    // 'a4' and 'booklet_a4' are the same 595x842pt size; both stay valid
    // so pre-v0.4.0 projects that stored 'a4' keep working.
    if (['royal_holy_book', 'vilna_folio', 'crown_quarto', 'a4', 'b5', 'pocket', 'small_a5', 'regular_17x24', 'wide_17x25', 'booklet_a4', 'gemara_24x34', 'custom'].includes(preset)) {
      const dims = PAGE_SIZE_DIMENSIONS[preset];
      const orientation = patch.orientation === 'landscape' || patch.orientation === 'portrait'
        ? patch.orientation
        : working.pageLayout.orientation;
      const w = dims ? dims.widthPt : working.pageLayout.pageWidthPt;
      const h = dims ? dims.heightPt : working.pageLayout.pageHeightPt;
      working = DesignSettingsEngine.updatePageLayout(
        working,
        {
          pageSizePreset: preset,
          orientation,
          pageWidthPt: orientation === 'landscape' ? Math.max(w, h) : Math.min(w, h),
          pageHeightPt: orientation === 'landscape' ? Math.min(w, h) : Math.max(w, h),
        },
        'ai'
      ).settings;
      summariesHe.push(`גודל העמוד הוחלף ל-${preset}`);
      summariesEn.push(`Page size changed to ${preset}`);
      anyApplied = true;
    }
  } else if (patch.orientation === 'landscape' || patch.orientation === 'portrait') {
    const w = working.pageLayout.pageWidthPt;
    const h = working.pageLayout.pageHeightPt;
    working = DesignSettingsEngine.updatePageLayout(
      working,
      {
        orientation: patch.orientation,
        pageWidthPt: patch.orientation === 'landscape' ? Math.max(w, h) : Math.min(w, h),
        pageHeightPt: patch.orientation === 'landscape' ? Math.min(w, h) : Math.max(w, h),
      },
      'ai'
    ).settings;
    summariesHe.push(patch.orientation === 'landscape' ? 'העמוד סובב לרוחב' : 'העמוד סובב לאורך');
    summariesEn.push(patch.orientation === 'landscape' ? 'Page turned to landscape' : 'Page turned to portrait');
    anyApplied = true;
  }
  if (patch.margins && typeof patch.margins === 'object') {
    const m = patch.margins as Record<string, unknown>;
    const pick = (key: string): number | undefined => numInRange(m[key], 0, 144);
    const updates: Partial<PageLayoutDesignSettings> = {};
    const all = pick('all');
    if (all !== undefined) {
      updates.marginTopPt = all;
      updates.marginBottomPt = all;
      updates.marginInsidePt = all;
      updates.marginOutsidePt = all;
    } else {
      const top = pick('top');
      const bottom = pick('bottom');
      const inside = pick('inside');
      const outside = pick('outside');
      if (top !== undefined) updates.marginTopPt = top;
      if (bottom !== undefined) updates.marginBottomPt = bottom;
      if (inside !== undefined) updates.marginInsidePt = inside;
      if (outside !== undefined) updates.marginOutsidePt = outside;
    }
    if (Object.keys(updates).length > 0) {
      working = DesignSettingsEngine.updatePageLayout(working, updates, 'ai').settings;
      summariesHe.push('השוליים עודכנו');
      summariesEn.push('Margins updated');
      anyApplied = true;
    }
  }
  if (patch.columnCount === 1 || patch.columnCount === 2 || patch.columnCount === 3) {
    working = DesignSettingsEngine.updatePageLayout(working, { columnCount: patch.columnCount }, 'ai').settings;
    summariesHe.push(`מספר הטורים עודכן ל-${patch.columnCount}`);
    summariesEn.push(`Column count updated to ${patch.columnCount}`);
    anyApplied = true;
  }
  const gutter = numInRange(patch.columnGutterPt, 6, 48);
  if (gutter !== undefined) {
    working = DesignSettingsEngine.updatePageLayout(working, { columnGutterPt: gutter }, 'ai').settings;
    summariesHe.push(`מרווח הטורים עודכן ל-${gutter}pt`);
    summariesEn.push(`Column gutter updated to ${gutter}pt`);
    anyApplied = true;
  }
  if (typeof patch.balanceColumns === 'boolean') {
    const next = DesignSettingsEngine.cloneSettings(working);
    next.columns = { ...next.columns, balanceColumns: patch.balanceColumns };
    working = DesignSettingsEngine.sanitizeAndEnforceHardRules(next).settings;
    summariesHe.push(patch.balanceColumns ? 'איזון טורים הופעל' : 'איזון טורים כובה');
    summariesEn.push(patch.balanceColumns ? 'Column balancing on' : 'Column balancing off');
    anyApplied = true;
  }
  if (
    typeof patch.showRunningHeader === 'boolean' ||
    typeof patch.showRunningFooter === 'boolean' ||
    typeof patch.showFolioNumber === 'boolean' ||
    // v0.5.0 Part B (Module 6)
    typeof patch.showTopHeaderLine === 'boolean' ||
    // v0.5.0 (integrator): commentary labels + page-number format.
    typeof patch.showCommentaryLabels === 'boolean' ||
    patch.pageNumberStyle === 'numbers' ||
    patch.pageNumberStyle === 'hebrew' ||
    typeof patch.showDafPrefix === 'boolean'
  ) {
    const el: Partial<PageElementsDesignSettings> = {};
    if (typeof patch.showRunningHeader === 'boolean') el.showRunningHeader = patch.showRunningHeader;
    if (typeof patch.showTopHeaderLine === 'boolean') el.showTopHeaderLine = patch.showTopHeaderLine;
    if (typeof patch.showFolioNumber === 'boolean') el.showFolioNumber = patch.showFolioNumber;
    if (typeof patch.showCommentaryLabels === 'boolean') el.showCommentaryLabels = patch.showCommentaryLabels;
    if (patch.pageNumberStyle === 'numbers' || patch.pageNumberStyle === 'hebrew') el.pageNumberStyle = patch.pageNumberStyle;
    if (typeof patch.showDafPrefix === 'boolean') el.showDafPrefix = patch.showDafPrefix;
    working = DesignSettingsEngine.updatePageElementsSettings(working, el, 'ai');
    if (typeof patch.showRunningFooter === 'boolean') {
      working = DesignSettingsEngine.updatePageLayout(
        working,
        { showRunningFooter: patch.showRunningFooter },
        'ai'
      ).settings;
    }
    summariesHe.push('כותרות / מספרי עמודים עודכנו');
    summariesEn.push('Headers / page numbers updated');
    anyApplied = true;
  }
  // ── v0.6.0 Part A (§5): running-header text + toggles + alignment +
  // font/size. Validated like every other patch field: unknown values
  // are dropped, never applied; text is trimmed and capped at 200 chars.
  if (patch.runningHeader && typeof patch.runningHeader === 'object') {
    const rh = patch.runningHeader as Record<string, unknown>;
    const cleanText = (v: unknown): string | undefined => {
      if (typeof v !== 'string') return undefined;
      const trimmed = v.trim().slice(0, 200);
      return trimmed.length > 0 ? trimmed : undefined;
    };
    const next: Record<string, unknown> = {};
    const lt = cleanText(rh.leftText);
    if (lt !== undefined) next.leftText = lt;
    const ct = cleanText(rh.centerText);
    if (ct !== undefined) next.centerText = ct;
    const rt = cleanText(rh.rightText);
    if (rt !== undefined) next.rightText = rt;
    if (typeof rh.showBookTitle === 'boolean') next.showBookTitle = rh.showBookTitle;
    if (typeof rh.showChapterTitle === 'boolean') next.showChapterTitle = rh.showChapterTitle;
    if (typeof rh.showPageNumber === 'boolean') next.showPageNumber = rh.showPageNumber;
    if (rh.alignment === 'left' || rh.alignment === 'center' || rh.alignment === 'right')
      next.alignment = rh.alignment;
    if (typeof rh.fontFamily === 'string' && rh.fontFamily.trim().length > 0)
      next.fontFamily = rh.fontFamily.trim();
    if (typeof rh.fontSizePt === 'number' && Number.isFinite(rh.fontSizePt))
      next.fontSizePt = Math.min(24, Math.max(8, rh.fontSizePt));
    if (Object.keys(next).length > 0) {
      working = DesignSettingsEngine.updatePageElementsSettings(
        working,
        { runningHeader: next } as unknown as Partial<PageElementsDesignSettings>,
        'ai'
      );
      summariesHe.push('טקסט הכותרת העליונה עודכן');
      summariesEn.push('Running header text updated');
      anyApplied = true;
    }
  }
  // ── v0.5.0 (Title Page / Shaar Blat builder) ──────────────────────────
  // Validated: unknown border ids and out-of-range numbers are dropped;
  // text is trimmed and capped at 200 characters; extra lines cap at 6.
  if (patch.titlePage && typeof patch.titlePage === 'object') {
    const tp = patch.titlePage as Record<string, unknown>;
    const next = DesignSettingsEngine.cloneSettings(working);
    const cur = next.titlePage ?? JSON.parse(JSON.stringify(DEFAULT_TITLE_PAGE_SETTINGS));
    next.titlePage = cur;
    const cleanText = (v: unknown): string | undefined => {
      if (typeof v !== 'string') return undefined;
      const t = v.trim().slice(0, 200);
      return t.length > 0 ? t : undefined;
    };
    const textFields = ['title', 'subtitle', 'author', 'translator', 'publisher', 'volume', 'year'] as const;
    let tpApplied = false;
    if (typeof tp.enabled === 'boolean') {
      cur.enabled = tp.enabled;
      tpApplied = true;
    }
    for (const f of textFields) {
      const v = cleanText(tp[f]);
      if (v !== undefined) {
        cur[f] = { ...cur[f], text: v };
        tpApplied = true;
      }
    }
    if (Array.isArray(tp.extraLines)) {
      const lines = (tp.extraLines as unknown[])
        .filter((l): l is string => typeof l === 'string')
        .map(l => l.trim())
        .filter(Boolean)
        .slice(0, 6);
      if (lines.length > 0) {
        cur.extraLines = lines.map(text => ({
          text,
          fontFamily: '',
          fontSizePt: 12,
          alignment: 'center' as const,
          spaceAbovePt: 4,
          spaceBelowPt: 4,
        }));
        tpApplied = true;
      }
    }
    if (typeof tp.borderStyleId === 'string' && isTitlePageBorderStyleId(tp.borderStyleId)) {
      cur.border = { ...cur.border, styleId: tp.borderStyleId };
      tpApplied = true;
    }
    const thick = numInRange(tp.borderThicknessPt, 0.5, 4);
    if (thick !== undefined) {
      cur.border = { ...cur.border, thicknessPt: thick };
      tpApplied = true;
    }
    const inset = numInRange(tp.borderInsetMm, 0, 25);
    if (inset !== undefined) {
      cur.border = { ...cur.border, insetMm: inset };
      tpApplied = true;
    }
    if (typeof tp.borderEnabled === 'boolean') {
      cur.border = { ...cur.border, enabled: tp.borderEnabled };
      tpApplied = true;
    }
    // v0.6.0 Part C (§8): border fit — scale / padding / position.
    const scale = numInRange(tp.borderScalePct, 50, 150);
    if (scale !== undefined) {
      cur.border = { ...cur.border, scalePct: scale };
      tpApplied = true;
    }
    const pad = numInRange(tp.borderPaddingMm, 0, 25);
    if (pad !== undefined) {
      cur.border = { ...cur.border, paddingMm: pad };
      tpApplied = true;
    }
    const offX = numInRange(tp.borderOffsetXMm, -25, 25);
    if (offX !== undefined) {
      cur.border = { ...cur.border, offsetXMm: offX };
      tpApplied = true;
    }
    const offY = numInRange(tp.borderOffsetYMm, -25, 25);
    if (offY !== undefined) {
      cur.border = { ...cur.border, offsetYMm: offY };
      tpApplied = true;
    }
    // v0.6.0 Part C (§8): per-field line height (1.0–2.0), keyed by field.
    if (tp.fieldLineHeight && typeof tp.fieldLineHeight === 'object') {
      const lh = tp.fieldLineHeight as Record<string, unknown>;
      for (const f of textFields) {
        const v = numInRange(lh[f], 1.0, 2.0);
        if (v !== undefined) {
          cur[f] = { ...cur[f], lineHeight: v };
          tpApplied = true;
        }
      }
    }
    if (tpApplied) {
      working = DesignSettingsEngine.sanitizeAndEnforceHardRules(next).settings;
      summariesHe.push(
        cur.enabled
          ? 'עמוד השער עודכן'
          : 'עמוד השער עודכן (הוא כבוי כרגע — הפעילו אותו בלשונית ״עמוד שער״)'
      );
      summariesEn.push(
        cur.enabled ? 'Title page updated' : 'Title page updated (it is currently off — turn it on in the "Title page" tab)'
      );
      anyApplied = true;
    }
  }
  // ── v0.5.0 Part B (Module 5): AI block margins / spacing / auto-center ──
  // Role-level (the validated action carries no selected unit): the role
  // comes from patch.paragraphRole, default main_source.
  if (patch.autoCenterBlock === true) {
    const role: ContentRole = isAiRole(patch.paragraphRole) ? patch.paragraphRole : 'main_source';
    working = DesignSettingsEngine.autoCenterBlock(working, { role }, 'ai');
    summariesHe.push('הפסקה מורכזה — שוליים שווים משני הצדדים ומרווח שווה מעל ומתחת');
    summariesEn.push('Block centred — equal margins on both sides and equal space above and below');
    anyApplied = true;
  } else if (patch.blockMargins && typeof patch.blockMargins === 'object') {
    const m = patch.blockMargins as Record<string, unknown>;
    const role: ContentRole = isAiRole(patch.paragraphRole) ? patch.paragraphRole : 'main_source';
    const blockPatch: Partial<BlockSpacingSettings> = {};
    const left = numInRange(m.left, 0, 72);
    const right = numInRange(m.right, 0, 72);
    const top = numInRange(m.top, 0, 48);
    const bottom = numInRange(m.bottom, 0, 48);
    if (left !== undefined) blockPatch.marginLeftPt = left;
    if (right !== undefined) blockPatch.marginRightPt = right;
    if (top !== undefined) { blockPatch.marginTopPt = top; blockPatch.spaceBeforePt = top; }
    if (bottom !== undefined) { blockPatch.marginBottomPt = bottom; blockPatch.spaceAfterPt = bottom; }
    if (Object.keys(blockPatch).length > 0) {
      working = DesignSettingsEngine.updateBlockSpacing(working, blockPatch, { role }, 'ai');
      summariesHe.push('שולי הפסקה עודכנו');
      summariesEn.push('Block margins updated');
      anyApplied = true;
    }
  }
  const blockSpaceBefore = numInRange(patch.blockSpaceBeforePt, 0, 48);
  const blockSpaceAfter = numInRange(patch.blockSpaceAfterPt, 0, 48);
  if (blockSpaceBefore !== undefined || blockSpaceAfter !== undefined) {
    const role: ContentRole = isAiRole(patch.paragraphRole) ? patch.paragraphRole : 'main_source';
    working = DesignSettingsEngine.updateBlockSpacing(
      working,
      {
        ...(blockSpaceBefore !== undefined ? { marginTopPt: blockSpaceBefore, spaceBeforePt: blockSpaceBefore } : {}),
        ...(blockSpaceAfter !== undefined ? { marginBottomPt: blockSpaceAfter, spaceAfterPt: blockSpaceAfter } : {}),
      },
      { role },
      'ai'
    );
    summariesHe.push('מרווח הפסקה (לפני / אחרי) עודכן');
    summariesEn.push('Block spacing (before / after) updated');
    anyApplied = true;
  }
  // ── end v0.5.0 Part B (Module 5) ──────────────────────────────────────
  if (typeof patch.pageNumberPosition === 'string') {
    const pos = patch.pageNumberPosition as string;
    if (['top_outside', 'top_center', 'top_inside', 'bottom_center', 'bottom_outside', 'hidden'].includes(pos)) {
      working = DesignSettingsEngine.updatePageElementsSettings(
        working,
        { folioNumberPosition: pos as PageElementsDesignSettings['folioNumberPosition'] },
        'ai'
      );
      working = DesignSettingsEngine.updatePageLayout(
        working,
        { pageNumberPosition: pos as PageLayoutDesignSettings['pageNumberPosition'] },
        'ai'
      ).settings;
      summariesHe.push(`מיקום מספר העמוד הוחלף ל-${pos}`);
      summariesEn.push(`Page number position changed to ${pos}`);
      anyApplied = true;
    }
  }
  if (isKnownFontFamily(patch.fontFamily)) {
    const role: ContentRole = isAiRole(patch.fontRole) ? patch.fontRole : 'primary_comment';
    applyRoleStyle(role, { fontFamily: patch.fontFamily as string });
    summariesHe.push(`הגופן עודכן ל-"${patch.fontFamily}"`);
    summariesEn.push(`Font updated to "${patch.fontFamily}"`);
  }
  const fontSize = numInRange(patch.fontSizePt, 6, 72);
  const fontSizeRole: ContentRole = isAiRole(patch.fontSizeRole) ? patch.fontSizeRole : 'main_source';
  if (fontSize !== undefined) {
    applyRoleStyle(fontSizeRole, { fontSizePt: fontSize });
    summariesHe.push(`גודל הגופן עודכן ל-${fontSize}pt`);
    summariesEn.push(`Font size updated to ${fontSize}pt`);
  } else if (typeof patch.fontSizeDelta === 'number' && Number.isFinite(patch.fontSizeDelta)) {
    const cur = DesignSettingsEngine.resolveRoleAndUnitStyle(working, fontSizeRole).character.fontSizePt;
    const next = Math.min(72, Math.max(6, Number((cur + patch.fontSizeDelta).toFixed(2))));
    applyRoleStyle(fontSizeRole, { fontSizePt: next });
    summariesHe.push(`גודל הגופן עודכן מ-${cur}pt ל-${next}pt`);
    summariesEn.push(`Font size updated from ${cur}pt to ${next}pt`);
  }
  const ratio = numInRange(patch.lineSpacingRatio, 1.0, 2.5);
  const ratioRole: ContentRole = isAiRole(patch.lineSpacingRole) ? patch.lineSpacingRole : 'main_source';
  if (ratio !== undefined) {
    const size = DesignSettingsEngine.resolveRoleAndUnitStyle(working, ratioRole).character.fontSizePt;
    applyRoleStyle(ratioRole, undefined, {
      lineSpacingRatio: ratio,
      leadingPt: Number((size * ratio).toFixed(2)),
    });
    summariesHe.push(`מרווח השורות עודכן ל-${ratio}`);
    summariesEn.push(`Line spacing updated to ${ratio}`);
  }
  const spaceAfter = numInRange(patch.paragraphSpaceAfterPt, 0, 72);
  if (spaceAfter !== undefined) {
    const role: ContentRole = isAiRole(patch.paragraphRole) ? patch.paragraphRole : 'main_source';
    applyRoleStyle(role, undefined, { spaceAfterPt: spaceAfter });
    summariesHe.push(`מרווח הפסקאות עודכן ל-${spaceAfter}pt`);
    summariesEn.push(`Paragraph spacing updated to ${spaceAfter}pt`);
  }
  if (typeof patch.alignment === 'string' && ['justify', 'right', 'center', 'left'].includes(patch.alignment)) {
    const role: ContentRole = isAiRole(patch.alignmentRole) ? patch.alignmentRole : 'main_source';
    applyRoleStyle(role, undefined, { alignment: patch.alignment as DesignAlignment });
    summariesHe.push(`היישור עודכן ל-${patch.alignment}`);
    summariesEn.push(`Alignment updated to ${patch.alignment}`);
  }
  const ravGutter = numInRange(patch.gutterWidthPt, 8, 36);
  if (ravGutter !== undefined) {
    working = DesignSettingsEngine.updateRavTextSettings(working, { gutterWidthPt: ravGutter }, 'ai');
    summariesHe.push(`מרווח רב-טקסט עודכן ל-${ravGutter}pt`);
    summariesEn.push(`Multi-text gutter updated to ${ravGutter}pt`);
    anyApplied = true;
  }
  const knee = numInRange(patch.kneeJunctionPercent, 10, 90);
  if (knee !== undefined) {
    working = DesignSettingsEngine.updateRavTextSettings(working, { kneeJunctionPercent: knee }, 'ai');
    summariesHe.push(`צומת הברך עודכן ל-${knee}%`);
    summariesEn.push(`Knee junction updated to ${knee}%`);
    anyApplied = true;
  }
  if (isAiRole(patch.removeTierRole)) {
    const role = patch.removeTierRole;
    const tiers = working.pageLayout.tiers ?? [];
    if (tiers.some(tier => tier.role === role)) {
      const next = DesignSettingsEngine.cloneSettings(working);
      next.pageLayout.tiers = tiers.filter(tier => tier.role !== role);
      working = DesignSettingsEngine.sanitizeAndEnforceHardRules(next).settings;
      summariesHe.push(`השכבה ${role} הוסרה מהעמוד`);
      summariesEn.push(`Removed the ${role} tier from the page`);
      anyApplied = true;
    }
  }
  // --- v0.5.0 Part C — Module 3 (Custom Layout Designer) -------------------
  // AI patch fields for the custom layout. Template ids must exist in the
  // user's saved library; box coordinates are clamped by the sanitizer.
  // --- BEGIN Part C AI patch fields ---
  if (typeof patch.customLayoutTemplateId === 'string') {
    const template = listCustomLayoutTemplates().find(
      t => t.id === patch.customLayoutTemplateId
    );
    if (template) {
      working = DesignSettingsEngine.applyCustomLayoutTemplate(working, template, 'ai').settings;
      summariesHe.push(`תבנית פריסה מותאמת הופעלה: ${template.nameHe}`);
      summariesEn.push(`Custom layout template applied: ${template.nameEn}`);
      anyApplied = true;
    }
  }
  if (patch.customLayoutBox && typeof patch.customLayoutBox === 'object') {
    const box = patch.customLayoutBox as CustomLayoutBox;
    if (typeof box.id === 'string') {
      const before = working.pageLayout.customLayout?.boxes.length ?? 0;
      working = DesignSettingsEngine.updateCustomLayoutBox(working, box, 'ai').settings;
      const after = working.pageLayout.customLayout?.boxes.length ?? 0;
      if (after >= before || working.pageLayout.customLayout?.boxes.some(b => b.id === box.id)) {
        summariesHe.push(`התיבה "${box.labelHe ?? box.role}" עודכנה בפריסה המותאמת`);
        summariesEn.push(`Updated the "${box.labelEn ?? box.role}" box in the custom layout`);
        anyApplied = true;
      }
    }
  }
  if (typeof patch.customLayoutBaseLayout === 'string') {
    const base = patch.customLayoutBaseLayout as BookLayoutType;
    if (['rav_text', 'single_column', 'two_column', 'source_top_commentary_bottom', 'mikraot_gedolot', 'yiddish_sefer'].includes(base)) {
      working = DesignSettingsEngine.setCustomLayout(
        working,
        { enabled: true, baseLayout: base },
        'ai'
      ).settings;
      summariesHe.push(`בסיס הפריסה המותאמת הוחלף ל-${base}`);
      summariesEn.push(`Custom layout base changed to ${base}`);
      anyApplied = true;
    }
  }
  // --- v0.6.0 Part C (§2b) — per-page override via the AI ------------------
  // pageIndex is 0-based among body pages. Boxes are sanitized (including
  // polygon shapes and cut-outs) by setCustomLayoutPageOverride.
  if (patch.customLayoutPageOverride && typeof patch.customLayoutPageOverride === 'object') {
    const o = patch.customLayoutPageOverride as { pageIndex?: unknown; boxes?: unknown };
    const pageIndex =
      typeof o.pageIndex === 'number' && Number.isInteger(o.pageIndex) && o.pageIndex >= 0
        ? o.pageIndex
        : undefined;
    const boxes = Array.isArray(o.boxes)
      ? (o.boxes as CustomLayoutBox[]).filter(b => b && typeof b.id === 'string')
      : undefined;
    if (pageIndex !== undefined && boxes !== undefined && boxes.length > 0) {
      working = DesignSettingsEngine.setCustomLayoutPageOverride(working, pageIndex, boxes, 'ai').settings;
      summariesHe.push(`הפריסה של עמוד ${pageIndex + 1} הוחלפה (רק העמוד הזה)`);
      summariesEn.push(`Layout of page ${pageIndex + 1} replaced (that page only)`);
      anyApplied = true;
    }
  }
  if (
    typeof patch.clearCustomLayoutPageOverride === 'number' &&
    Number.isInteger(patch.clearCustomLayoutPageOverride) &&
    patch.clearCustomLayoutPageOverride >= 0
  ) {
    working = DesignSettingsEngine.clearCustomLayoutPageOverride(
      working,
      patch.clearCustomLayoutPageOverride,
      'ai'
    ).settings;
    summariesHe.push(`החריגה של עמוד ${patch.clearCustomLayoutPageOverride + 1} נמחקה — חוזר לתבנית הכללית`);
    summariesEn.push(`Page ${patch.clearCustomLayoutPageOverride + 1} override cleared — back to the global template`);
    anyApplied = true;
  }
  // --- v0.6.0 Part C (§2c) — polygon shape on a box ------------------------
  // No separate field: `customLayoutBox` above already carries `shape` /
  // `exclusions` — they are sanitized by sanitizeCustomLayoutBox inside
  // updateCustomLayoutBox, so an AI box patch with a shape applies it.
  // --- END Part C AI patch fields ---

  if (typeof patch.indentMode === 'string' && ['none', 'first_line', 'hanging', 'chalon_second_line', 'chalon_window', 'chalon_all'].includes(patch.indentMode)) {
    const role: ContentRole = isAiRole(patch.paragraphRole) ? patch.paragraphRole : 'main_source';
    const chalonIndentPt = numInRange(patch.chalonIndentPt, 0, 72);
    const chalonLineCount = numInRange(patch.chalonLineCount, 1, 6);
    applyRoleStyle(role, undefined, {
      indentMode: patch.indentMode as ParagraphIndentMode,
      ...(chalonIndentPt !== undefined ? { chalonIndentPt } : {}),
      ...(chalonLineCount !== undefined ? { chalonLineCount } : {}),
    });
    summariesHe.push(`מצב כניסת שורות עודכן (${patch.indentMode})`);
    summariesEn.push(`Paragraph indent mode updated (${patch.indentMode})`);
  }
  if (patch.openingDecoration && typeof patch.openingDecoration === 'object') {
    const od = patch.openingDecoration as Record<string, unknown>;
    const validStyles: OpeningDecorationStyleId[] = [
      'none',
      'simple_frame',
      'double_ornate',
      'crown_panel',
      'chumash_cartouche',
      'patterned_rect',
      'stepped_frame',
      'corner_ornament',
    ];
    const wordCount = numInRange(od.wordCount, 1, 4);
    const paddingPt = numInRange(od.paddingPt, 0, 24);
    const thicknessPt = numInRange(od.thicknessPt, 0.4, 4);
    const nextOd = {
      ...(working.ravText.openingDecoration ?? DEFAULT_OPENING_DECORATION),
      ...(typeof od.enabled === 'boolean' ? { enabled: od.enabled } : {}),
      ...(typeof od.styleId === 'string' && validStyles.includes(od.styleId as OpeningDecorationStyleId)
        ? { styleId: od.styleId as OpeningDecorationStyleId }
        : {}),
      ...(wordCount !== undefined ? { wordCount: Math.round(wordCount) } : {}),
      ...(paddingPt !== undefined ? { paddingPt } : {}),
      ...(thicknessPt !== undefined ? { thicknessPt } : {}),
      ...(od.scope === 'masechet_start' || od.scope === 'chapter_start' ? { scope: od.scope as 'masechet_start' | 'chapter_start' } : {}),
    };
    working = DesignSettingsEngine.updateRavTextSettings(working, { openingDecoration: nextOd }, 'ai');
    summariesHe.push('עיטור מילת הפתיחה עודכן');
    summariesEn.push('Opening word frame updated');
    anyApplied = true;
  }
  if (typeof patch.commentarySeparator === 'string' && ['none', 'colon', 'colon_dot', 'thin_rule', 'centered_diamond', 'double_rule', 'scrolled_divider'].includes(patch.commentarySeparator)) {
    working = DesignSettingsEngine.updateRavTextSettings(
      working,
      { commentarySeparator: { ...(working.ravText.commentarySeparator ?? DEFAULT_COMMENTARY_SEPARATOR), styleId: patch.commentarySeparator as SeparatorStyleId } },
      'ai'
    );
    summariesHe.push('מפריד המפרשים עודכן');
    summariesEn.push('Commentary separator updated');
    anyApplied = true;
  }
  if (typeof patch.paragraphSeparator === 'string' && ['none', 'colon', 'colon_dot', 'thin_rule', 'centered_diamond', 'double_rule', 'scrolled_divider'].includes(patch.paragraphSeparator)) {
    working = DesignSettingsEngine.updateRavTextSettings(
      working,
      { paragraphSeparator: { ...(working.ravText.paragraphSeparator ?? DEFAULT_PARAGRAPH_SEPARATOR), styleId: patch.paragraphSeparator as SeparatorStyleId } },
      'ai'
    );
    summariesHe.push('מפריד הפסקאות עודכן');
    summariesEn.push('Paragraph separator updated');
    anyApplied = true;
  }
  if (typeof patch.transitionMarkerEnabled === 'boolean') {
    working = DesignSettingsEngine.updateRavTextSettings(
      working,
      { transitionMarker: { ...(working.ravText.transitionMarker ?? DEFAULT_TRANSITION_MARKER), enabled: patch.transitionMarkerEnabled } },
      'ai'
    );
    summariesHe.push(patch.transitionMarkerEnabled ? 'סמן מעבר גמ׳ הופעל' : 'סמן מעבר גמ׳ כובה');
    summariesEn.push(patch.transitionMarkerEnabled ? 'Gemara transition marker enabled' : 'Gemara transition marker disabled');
    anyApplied = true;
  }
  // v0.9.9 (I2): transition-marker style / size / position patch.
  if (patch.transitionMarker && typeof patch.transitionMarker === 'object') {
    const tmPatch = patch.transitionMarker as Record<string, unknown>;
    const sizePt = numInRange(tmPatch.sizePt, 7, 24);
    const nextTm = {
      ...(working.ravText.transitionMarker ?? DEFAULT_TRANSITION_MARKER),
      ...(typeof tmPatch.enabled === 'boolean' ? { enabled: tmPatch.enabled } : {}),
      ...(typeof tmPatch.markerText === 'string' && tmPatch.markerText.trim()
        ? { markerText: tmPatch.markerText.trim().slice(0, 12) }
        : {}),
      ...(tmPatch.style === 'text' || tmPatch.style === 'boxed' ? { style: tmPatch.style as 'text' | 'boxed' } : {}),
      ...(sizePt !== undefined ? { sizePt } : {}),
      ...(tmPatch.position === 'before_first_word' || tmPatch.position === 'after_last_word'
        ? { position: tmPatch.position as 'before_first_word' | 'after_last_word' }
        : {}),
    };
    working = DesignSettingsEngine.updateRavTextSettings(working, { transitionMarker: nextTm }, 'ai');
    summariesHe.push('סמן מעבר גמ׳ עודכן');
    summariesEn.push('Gemara transition marker updated');
    anyApplied = true;
  }
  if (typeof patch.dafFormat === 'string' && ['dots', 'amud_hebrew', 'gematria', 'numbers'].includes(patch.dafFormat)) {
    working = DesignSettingsEngine.updatePageElementsSettings(
      working,
      {
        folioNumbering: {
          ...(working.pageElements.folioNumbering ?? DEFAULT_FOLIO_NUMBERING),
          dafFormat: patch.dafFormat as DafFormatMode,
        },
      },
      'ai'
    );
    summariesHe.push('פורמט מספור הדפים עודכן');
    summariesEn.push('Folio numbering format updated');
    anyApplied = true;
  }

  if (!anyApplied) return null;
  working.lastModifiedBy = 'ai';
  DesignSettingsEngine.syncDerivedViews(working);
  return {
    settings: working,
    summaryHe: summariesHe.join(' | '),
    summaryEn: summariesEn.join(' | '),
  };
}

/** Layouts whose pages carry more than one text tier. */
export const MULTI_TIER_LAYOUTS: ReadonlyArray<BookLayoutType> = Object.freeze([
  'rav_text',
  'mikraot_gedolot',
  'two_column',
  'source_top_commentary_bottom',
  // v0.8.0 Part D — Yiddish facing layout is multi-tier by construction
  // (Hebrew source + Yiddish text side by side, Biur below).
  'yiddish_sefer',
  // v0.5.0 Part C — Module 3: a custom layout is multi-tier by construction
  // (its boxes hold main text + commentaries side by side).
  'custom_layout',
]);

export function isMultiTierLayout(layout: BookLayoutType): boolean {
  return (MULTI_TIER_LAYOUTS as ReadonlyArray<BookLayoutType>).includes(layout);
}

export interface AiDesignCommandResult {
  handled: boolean;
  matched: boolean;
  summaryHe: string;
  summaryEn: string;
  updatedSettings: ProfessionalDesignSettings;
  clampedByEngineHardRule: boolean;
  warnings: string[];
  requiresPreviewConfirmation: boolean;
}

export class DesignSettingsEngine {
  /**
   * Rebuilds the derived `roleStyles`, `layout`, `localUnitOverrides`, and `localWordOverrides`
   * views on a `ProfessionalDesignSettings` instance so direct readers (`settings.roleStyles.main_source...`)
   * and method callers (`resolveStyle` / `resolveRoleAndUnitStyle`) always see the exact same data.
   */
  public static syncDerivedViews(
    settings: ProfessionalDesignSettings
  ): ProfessionalDesignSettings {
    // v0.9.1 — heal partial settings FIRST, before anything below reads
    // them. The function already heals tiers/columns/pageElements/
    // blockSpacing/titlePage the same way; pageLayout and ravText were
    // the gap — both were dereferenced unconditionally, so a partial
    // designSettings (an older-version snapshot, a hand-edited or
    // corrupt save) crashed every load path that sanitizes it:
    // buildDesignSettingsFromSnapshot → sanitizeAndEnforceHardRules →
    // cloneSettings → syncDerivedViews. The heal uses the same values
    // createDefaultSettings uses for a fresh rav_text book.
    const layoutType = settings.layoutType ?? 'rav_text';
    if (!settings.layoutType) settings.layoutType = layoutType;
    if (!settings.pageLayout) {
      settings.pageLayout = {
        layoutType,
        geometry: {
          pageWidth: 482.0,
          pageHeight: 680.0,
          marginTop: 48.0,
          marginBottom: 48.0,
          marginInside: 46.0,
          marginOutside: 42.0,
          isVerso: false,
        },
        pageSizePreset: 'royal_holy_book',
        orientation: 'portrait',
        pageWidthPt: 482.0,
        pageHeightPt: 680.0,
        marginTopPt: 48.0,
        marginBottomPt: 48.0,
        marginInsidePt: 46.0,
        marginOutsidePt: 42.0,
        columnCount: 1,
        columnGutterPt: 14.0,
        headerBandHeightPt: 24.0,
        footerBandHeightPt: 22.0,
        pageNumberPosition: 'top_outside',
        showRunningHeader: true,
        showRunningFooter: true,
        runningHeaderFontSizePt: 10.5,
      };
    }
    if (!settings.ravText) {
      settings.ravText = {
        sourceFontFamily: 'Frank Ruhl Libre',
        rashiFontFamily: 'Noto Rashi Hebrew',
        tosafotFontFamily: 'Frank Ruhl Libre',
        sourceFontSizePt: 14.5,
        rashiFontSizePt: 10.5,
        tosafotFontSizePt: 10.5,
        sourceLineSpacingRatio: 1.32,
        commentaryLineSpacingRatio: 1.32,
        commentaryToSourceScaleRatio: 0.72,
        gutterWidthPt: 11,
        upperCollarLines: 4,
        upperCollarInwardStepPt: 18,
        kneeJunctionPercent: 50,
        lowerSourceWidthPercent: 78,
        kneeStepDirection: 'auto',
        kneeMode: 'auto',
        kneeSettings: {
          mode: 'auto',
          upperKneeLines: 4,
          junctionPercent: 50,
          lowerWidthPercent: 72,
          stepDirection: 'auto',
          gutterWidth: 12,
        },
        minSourceWidthPt: 135,
        minCommentaryWidthPt: 78,
        rashiWidthRatio: 0.5,
        tosafotWidthRatio: 0.5,
        sourceExpansionBehavior: 'dynamic_contour',
        dibburHamatchilBold: true,
        dibburBold: true,
        dibburHamatchilFontSizeDeltaPt: 0,
        dibburScalePercent: 100,
        preferSamePageSourceCommentary: true,
        continuationMarkerStyle: 'traditional_hebrew',
        michtavEnabled: false,
        michtavText: '',
      };
    }
    // Same gap, one section down: the footnote-alias sync at the end of
    // this function reads settings.footnotes unconditionally.
    if (!settings.footnotes) {
      settings.footnotes = {
        fontFamily: 'Frank Ruhl Libre',
        fontSizePt: 9.5,
        lineSpacingPt: 13.0,
        leadingPt: 13.0,
        paragraphSpacingPt: 1.5,
        showSeparatorRule: true,
        showSeparatorLine: true,
        separatorWidthRatio: 0.25,
        separatorSpacingAbovePt: 6.0,
        separatorSpacingBelowPt: 4.0,
        indentPt: 0,
        placement: 'bottom_of_page',
        justifyMultiLineFootnotes: true,
        justifyMultiLineNonFinal: true,
        allowMultiPageContinuation: true,
      };
    }
    // The override collections resolveRoleAndUnitStyle reads (called
    // from the roleStyles rebuild below) are the same gap: a partial
    // settings object has no projectRoleStyles / localOverrides, and
    // indexing / iterating undefined throws.
    if (!settings.projectRoleStyles) settings.projectRoleStyles = {};
    if (!settings.localOverrides) settings.localOverrides = [];
    settings.revision = settings.version;
    settings.pageLayout.layoutType = settings.layoutType;
    // v0.9.8 Phase 5 (Quick-Tune) — mirror margins: when the toggle is
    // OFF the two side margins are the same (symmetric pages). The
    // stored outside value is kept, so turning mirroring back ON
    // restores the distinct margins exactly.
    if (settings.pageLayout.mirrorMargins === undefined) {
      settings.pageLayout.mirrorMargins = true;
    }
    const marginOutsidePt =
      settings.pageLayout.mirrorMargins === false
        ? settings.pageLayout.marginInsidePt
        : settings.pageLayout.marginOutsidePt;
    settings.pageLayout.geometry = {
      pageWidth: settings.pageLayout.pageWidthPt,
      pageHeight: settings.pageLayout.pageHeightPt,
      marginTop: settings.pageLayout.marginTopPt,
      marginBottom: settings.pageLayout.marginBottomPt,
      marginInside: settings.pageLayout.marginInsidePt,
      marginOutside: marginOutsidePt,
      isVerso: false,
    };
    settings.layout = settings.pageLayout;

    // v0.3.0 (Module C): per-tier config. Pre-v0.3.0 settings have no `tiers`,
    // so fill layout defaults; existing lists are sanitized (clamped + sorted).
    if (!settings.pageLayout.tiers) {
      settings.pageLayout.tiers = this.defaultTiersForLayout(settings.layoutType);
    } else {
      settings.pageLayout.tiers = this.sanitizeTierConfigs(settings.pageLayout.tiers);
    }
    // v0.8.0 Part C (§2): heal stale tiers from the live ravText shortcuts
    // (see healTiersFromRavText) so a pre-v0.8.0 book renders exactly as
    // it did before the tier read path existed.
    this.healTiersFromRavText(settings);

    if (!settings.columns) {
      settings.columns = {
        columnCount: settings.pageLayout.columnCount,
        columnGapPt: settings.pageLayout.columnGutterPt,
        minColumnWidthPt: 78,
        balanceColumns: true,
      };
    } else {
      settings.columns.columnCount = settings.pageLayout.columnCount;
      settings.columns.columnGapPt = settings.pageLayout.columnGutterPt;
    }

    if (!settings.pageElements) {
      settings.pageElements = {
        showRunningHeader: settings.pageLayout.showRunningHeader,
        showFolioNumber: true,
        showDecorativeFrame: true,
        runningHeaderFontSizePt: settings.pageLayout.runningHeaderFontSizePt,
        folioNumberPosition: settings.pageLayout.pageNumberPosition,
        // v0.5.0 Part B (Module 6): new projects hide the top header line.
        showTopHeaderLine: false,
        // v0.6.0 Part A (§5): the editable running header (defaults: all
        // three elements shown, centre-aligned, book font, 10.5 pt).
        runningHeader: { ...DEFAULT_RUNNING_HEADER_SETTINGS },
        // v0.5.0 (integrator): legacy projects keep the folio and the
        // commentary labels they had; number format Hebrew letters with "דף".
        showCommentaryLabels: true,
        pageNumberStyle: 'hebrew',
        showDafPrefix: true,
      };
    }
    // v0.5.0 Part B (Module 6): legacy settings saved before this field
    // existed keep the header they already had (fall back to the old flag).
    if (settings.pageElements.showTopHeaderLine === undefined) {
      settings.pageElements.showTopHeaderLine =
        settings.pageLayout.showRunningHeader ?? false;
    }
    // v0.9.8 Phase 5 (Quick-Tune) — the header divider rule defaults to
    // ON: a header that used to show its rule keeps showing it.
    if (settings.pageElements.showHeaderDividerRule === undefined) {
      settings.pageElements.showHeaderDividerRule = true;
    }
    // v0.5.0 (integrator): legacy settings without the new fields keep
    // the folio they already had (it was on by default) and the commentary
    // labels they already had (always shown before v0.5.0), and use Hebrew
    // letters with the "דף" prefix — the format the app rendered before.
    if (settings.pageElements.showFolioNumber === undefined) {
      settings.pageElements.showFolioNumber = true;
    }
    if (settings.pageElements.showCommentaryLabels === undefined) {
      settings.pageElements.showCommentaryLabels = true;
    }
    if (!settings.pageElements.pageNumberStyle) {
      settings.pageElements.pageNumberStyle = 'hebrew';
    }
    if (settings.pageElements.showDafPrefix === undefined) {
      settings.pageElements.showDafPrefix = true;
    }
    // v0.6.0 Part A (§5): legacy settings have no running-header text yet
    // — fill the defaults (automatic texts, everything on, centred), so a
    // project saved before v0.6.0 renders exactly the header it had.
    // A half-present object keeps its own fields; only missing ones fill.
    if (!settings.pageElements.runningHeader) {
      settings.pageElements.runningHeader = { ...DEFAULT_RUNNING_HEADER_SETTINGS };
    } else {
      const d = DEFAULT_RUNNING_HEADER_SETTINGS;
      const rh = settings.pageElements.runningHeader;
      rh.leftText = typeof rh.leftText === 'string' ? rh.leftText : d.leftText;
      rh.centerText = typeof rh.centerText === 'string' ? rh.centerText : d.centerText;
      rh.rightText = typeof rh.rightText === 'string' ? rh.rightText : d.rightText;
      rh.showBookTitle = rh.showBookTitle ?? d.showBookTitle;
      rh.showChapterTitle = rh.showChapterTitle ?? d.showChapterTitle;
      rh.showPageNumber = rh.showPageNumber ?? d.showPageNumber;
      rh.alignment = (['left', 'center', 'right'] as const).includes(rh.alignment as RunningHeaderAlignment)
        ? rh.alignment
        : d.alignment;
      rh.fontFamily = typeof rh.fontFamily === 'string' ? rh.fontFamily : d.fontFamily;
      rh.fontSizePt =
        typeof rh.fontSizePt === 'number' && Number.isFinite(rh.fontSizePt)
          ? Math.min(24, Math.max(8, rh.fontSizePt))
          : (settings.pageElements.runningHeaderFontSizePt ?? d.fontSizePt);
      rh.masechetName = typeof rh.masechetName === 'string' ? rh.masechetName : '';
      rh.perekNumberText = typeof rh.perekNumberText === 'string' ? rh.perekNumberText : '';
      rh.perekTitleText = typeof rh.perekTitleText === 'string' ? rh.perekTitleText : '';
      rh.useStructuredVilnaHeader = Boolean(rh.useStructuredVilnaHeader);
    }
    if (!settings.pageElements.folioNumbering) {
      settings.pageElements.folioNumbering = {
        dafFormat:
          settings.layoutType === 'rav_text'
            ? 'dots'
            : settings.pageElements.pageNumberStyle === 'numbers'
              ? 'numbers'
              : 'gematria',
        startDaf: settings.layoutType === 'rav_text' ? 2 : 1,
        startAmud: 'a',
        excludeFrontMatter: true,
      };
    }
    if (!settings.pageElements.runningHeaderOverrides) {
      settings.pageElements.runningHeaderOverrides = {};
    }
    // v0.5.0 Part B (Module 5): legacy settings have no block-spacing
    // record yet — start from "no extra margins".
    if (!settings.blockSpacing) {
      settings.blockSpacing = { ...DEFAULT_BLOCK_SPACING };
    }
    // v0.5.0 (Title Page / Shaar Blat builder): legacy settings have no
    // title page yet — start disabled with the classic double frame.
    // Missing fields on a half-present title page are filled from the
    // defaults, and out-of-range border values are clamped.
    if (!settings.titlePage) {
      settings.titlePage = JSON.parse(JSON.stringify(DEFAULT_TITLE_PAGE_SETTINGS));
    } else {
      const d = DEFAULT_TITLE_PAGE_SETTINGS;
      const tp = settings.titlePage;
      // v0.6.0 Part C (§8): the field carries drag offsets + line height
      // too — they are real project state (the panel's line-spacing
      // control and the overlay drag write them), so the sync must
      // preserve them (clamped), not rebuild the field from the v0.5.0
      // keys only. Before this fix every settings save silently wiped
      // them back to the defaults.
      const fillField = (cur: unknown, def: TitlePageFieldStyle): TitlePageFieldStyle =>
        (cur && typeof cur === 'object'
          ? {
              text: typeof (cur as { text?: unknown }).text === 'string' ? (cur as { text: string }).text : def.text,
              fontFamily: typeof (cur as { fontFamily?: unknown }).fontFamily === 'string' ? (cur as { fontFamily: string }).fontFamily : def.fontFamily,
              fontSizePt: numInRange((cur as { fontSizePt?: unknown }).fontSizePt, 6, 72) ?? def.fontSizePt,
              alignment: (['center', 'right', 'left'] as const).includes((cur as { alignment?: string }).alignment as 'center' | 'right' | 'left')
                ? (cur as { alignment: 'center' | 'right' | 'left' }).alignment
                : def.alignment,
              spaceAbovePt: Math.max(0, Number((cur as { spaceAbovePt?: unknown }).spaceAbovePt) || 0),
              spaceBelowPt: Math.max(0, Number((cur as { spaceBelowPt?: unknown }).spaceBelowPt) || 0),
              lineHeight: numInRange((cur as { lineHeight?: unknown }).lineHeight, 1, 2) ?? def.lineHeight ?? 1.2,
              xOffsetPt: Math.max(-200, Math.min(200, Number((cur as { xOffsetPt?: unknown }).xOffsetPt) || 0)),
              yOffsetPt: Math.max(-200, Math.min(200, Number((cur as { yOffsetPt?: unknown }).yOffsetPt) || 0)),
            }
          : { ...def });
      tp.enabled = Boolean(tp.enabled);
      tp.title = fillField(tp.title, d.title);
      tp.subtitle = fillField(tp.subtitle, d.subtitle);
      tp.author = fillField(tp.author, d.author);
      tp.translator = fillField(tp.translator, d.translator);
      tp.publisher = fillField(tp.publisher, d.publisher);
      tp.volume = fillField(tp.volume, d.volume);
      tp.year = fillField(tp.year, d.year);
      tp.extraLines = Array.isArray(tp.extraLines)
        ? tp.extraLines.slice(0, 6).map(l => fillField(l, d.extraLines[0] ?? { text: '', fontFamily: '', fontSizePt: 12, alignment: 'center', spaceAbovePt: 4, spaceBelowPt: 4 }))
        : [];
      if (!tp.border || typeof tp.border !== 'object') {
        tp.border = { ...d.border };
      } else {
        tp.border.enabled = tp.border.enabled !== false;
        if (!isTitlePageBorderStyleId(String(tp.border.styleId ?? ''))) tp.border.styleId = d.border.styleId;
        tp.border.thicknessPt = numInRange(tp.border.thicknessPt, 0.5, 4) ?? d.border.thicknessPt;
        tp.border.insetMm = numInRange(tp.border.insetMm, 0, 25) ?? d.border.insetMm;
        // v0.6.0 Part C (§8): border fit — same story as the fields
        // above: preserve (clamped), never rebuild from the v0.5.0 keys.
        tp.border.scalePct = numInRange(tp.border.scalePct, 50, 150) ?? d.border.scalePct ?? 100;
        tp.border.paddingMm = numInRange(tp.border.paddingMm, 0, 25) ?? d.border.paddingMm ?? 0;
        tp.border.offsetXMm = numInRange(tp.border.offsetXMm, -25, 25) ?? d.border.offsetXMm ?? 0;
        tp.border.offsetYMm = numInRange(tp.border.offsetYMm, -25, 25) ?? d.border.offsetYMm ?? 0;
      }
      if (tp.customBorderImage !== null && typeof tp.customBorderImage !== 'object') {
        tp.customBorderImage = null;
      }
      tp.coverMode = tp.coverMode === 'print_wraparound_cover' ? 'print_wraparound_cover' : 'interior_title_page';
      tp.wraparoundCover = {
        spineWidthMm: numInRange(tp.wraparoundCover?.spineWidthMm, 2, 60) ?? 14,
        bleedMm: numInRange(tp.wraparoundCover?.bleedMm, 0, 10) ?? 3,
        backCoverText: typeof tp.wraparoundCover?.backCoverText === 'string' ? tp.wraparoundCover.backCoverText : '',
        backCoverSubtitle: typeof tp.wraparoundCover?.backCoverSubtitle === 'string' ? tp.wraparoundCover.backCoverSubtitle : '',
        spineText: typeof tp.wraparoundCover?.spineText === 'string' ? tp.wraparoundCover.spineText : '',
      };
    }

    // Sync RavText aliases
    settings.ravText.dibburBold = settings.ravText.dibburHamatchilBold;
    if (settings.ravText.dibburScalePercent === undefined) {
      settings.ravText.dibburScalePercent = 100;
    }
    if (settings.ravText.minSourceWidthPt === undefined) {
      settings.ravText.minSourceWidthPt = 135;
    }
    if (settings.ravText.minCommentaryWidthPt === undefined) {
      settings.ravText.minCommentaryWidthPt = 78;
    }
    if (!settings.ravText.openingDecoration) {
      settings.ravText.openingDecoration = { ...DEFAULT_OPENING_DECORATION };
    }
    // v0.9.9 (I2): field-level backfill — old projects that carry an
    // openingDecoration / transitionMarker without the new optional
    // fields keep rendering exactly as before.
    if (settings.ravText.openingDecoration.thicknessPt === undefined) {
      settings.ravText.openingDecoration.thicknessPt = DEFAULT_OPENING_DECORATION.thicknessPt ?? 1.1;
    }
    if (settings.ravText.openingDecoration.scope === undefined) {
      settings.ravText.openingDecoration.scope = 'masechet_start';
    }
    if (!settings.ravText.commentarySeparator) {
      settings.ravText.commentarySeparator = { ...DEFAULT_COMMENTARY_SEPARATOR };
    }
    if (!settings.ravText.paragraphSeparator) {
      settings.ravText.paragraphSeparator = { ...DEFAULT_PARAGRAPH_SEPARATOR };
    }
    if (!settings.ravText.transitionMarker) {
      settings.ravText.transitionMarker = { ...DEFAULT_TRANSITION_MARKER };
    }
    if (settings.ravText.transitionMarker.style === undefined) {
      settings.ravText.transitionMarker.style = 'text';
    }
    if (settings.ravText.transitionMarker.position === undefined) {
      settings.ravText.transitionMarker.position = 'before_first_word';
    }
    if (!Array.isArray(settings.ravText.peripheralStreams)) {
      settings.ravText.peripheralStreams = DEFAULT_PERIPHERAL_STREAMS.map(s => ({ ...s }));
    }
    settings.ravText.kneeSettings = {
      mode: settings.ravText.kneeMode,
      upperKneeLines: settings.ravText.upperCollarLines,
      upperKneeInwardStep: settings.ravText.upperCollarInwardStepPt,
      junctionPercent: settings.ravText.kneeJunctionPercent,
      lowerWidthPercent: settings.ravText.lowerSourceWidthPercent,
      stepDirection: settings.ravText.kneeStepDirection,
      gutterWidth: settings.ravText.gutterWidthPt,
    };

    // Sync Footnote aliases
    settings.footnotes.leadingPt = settings.footnotes.lineSpacingPt;
    settings.footnotes.showSeparatorLine = settings.footnotes.showSeparatorRule;
    settings.footnotes.justifyMultiLineNonFinal = settings.footnotes.justifyMultiLineFootnotes;

    // Rebuild roleStyles for every SemanticStyleRole
    const allRoleStyles = {} as Record<SemanticStyleRole, RoleDesignStyle>;
    for (const roleKey of Object.keys(GLOBAL_ROLE_STYLES) as SemanticStyleRole[]) {
      const globalStyle = GLOBAL_ROLE_STYLES[roleKey];
      const resolved = this.resolveRoleAndUnitStyle(settings, roleKey as ContentRole);
      allRoleStyles[roleKey] = {
        role: roleKey,
        displayNameHe: globalStyle.displayNameHe,
        displayNameEn: globalStyle.displayNameEn,
        character: resolved.character,
        paragraph: resolved.paragraph,
      };
    }
    settings.roleStyles = allRoleStyles;
    settings.globalRoleStyles = allRoleStyles;

    // Rebuild localUnitOverrides & localWordOverrides maps from localOverrides array
    const unitMap: Record<
      string,
      {
        character?: Partial<CharacterStyleSettings>;
        paragraph?: Partial<ParagraphStyleSettings>;
      }
    > = {};
    const wordMap: Record<string, Partial<CharacterStyleSettings>> = {};
    for (const loc of settings.localOverrides || []) {
      if (loc.wordRange) {
        for (
          let wIdx = loc.wordRange.startWordIndex;
          wIdx <= loc.wordRange.endWordIndex;
          wIdx++
        ) {
          const key = `${loc.unitId}:${wIdx}`;
          wordMap[key] = {
            ...(wordMap[key] ?? {}),
            ...(loc.characterOverrides ?? {}),
          };
        }
      } else {
        unitMap[loc.unitId] = {
          character: {
            ...(unitMap[loc.unitId]?.character ?? {}),
            ...(loc.characterOverrides ?? {}),
          },
          paragraph: {
            ...(unitMap[loc.unitId]?.paragraph ?? {}),
            ...(loc.paragraphOverrides ?? {}),
          },
        };
      }
    }
    settings.localUnitOverrides = unitMap;
    settings.localWordOverrides = wordMap;

    return settings;
  }

  /**
   * Creates a clean, canonical `ProfessionalDesignSettings` instance synchronized with
   * initial layout/geometry/font parameters.
   */
  public static createDefaultSettings(options?: {
    projectId?: string;
    layoutType?: BookLayoutType;
    geometry?: PageGeometry;
    kneeSettings?: KneeCustomSettings;
    sourceFontFamily?: string;
    rashiFontFamily?: string;
    tosafotFontFamily?: string;
    sourceFontSizePt?: number;
    commentaryFontSizePt?: number;
    // v0.5.0 Part C — Module 3: explicit boxes for a custom-layout project.
    // When omitted and the layout is `custom_layout`, the designer’s last
    // saved boxes are consumed once from the pending-template store
    // (see `savePendingCustomLayout`); otherwise rav_text defaults apply.
    customLayout?: CustomLayoutDesign;
  }): ProfessionalDesignSettings {
    const layoutType = options?.layoutType ?? 'rav_text';
    const geo = options?.geometry ?? {
      pageWidth: 482.0,
      pageHeight: 680.0,
      marginTop: 48.0,
      marginBottom: 48.0,
      marginInside: 46.0,
      marginOutside: 42.0,
      isVerso: false,
    };
    const knee = options?.kneeSettings ?? {
      mode: 'auto',
      upperKneeLines: 4,
      junctionPercent: 50,
      lowerWidthPercent: 72,
      stepDirection: 'auto',
      gutterWidth: 12,
    };

    const sourceFontFamily = options?.sourceFontFamily ?? 'Frank Ruhl Libre';
    const rashiFontFamily = options?.rashiFontFamily ?? 'Noto Rashi Hebrew';
    const tosafotFontFamily = options?.tosafotFontFamily ?? 'Frank Ruhl Libre';
    const sourceFontSizePt =
      options?.sourceFontSizePt ?? (layoutType === 'mikraot_gedolot' ? 16.0 : 14.5);
    const commentaryFontSizePt = options?.commentaryFontSizePt ?? 10.5;

    const pageLayout: PageLayoutDesignSettings = {
      layoutType,
      geometry: { ...geo },
      pageSizePreset: 'royal_holy_book',
      orientation: geo.pageWidth > geo.pageHeight ? 'landscape' : 'portrait',
      pageWidthPt: geo.pageWidth,
      pageHeightPt: geo.pageHeight,
      marginTopPt: geo.marginTop,
      marginBottomPt: geo.marginBottom,
      marginInsidePt: geo.marginInside,
      marginOutsidePt: geo.marginOutside,
      columnCount: layoutType === 'two_column' ? 2 : 1,
      columnGutterPt: layoutType === 'two_column' ? 16.0 : 14.0,
      headerBandHeightPt: 24.0,
      footerBandHeightPt: 22.0,
      pageNumberPosition: 'top_outside',
      showRunningHeader: true,
      showRunningFooter: true,
      runningHeaderFontSizePt: 10.5,
      // v0.5.0 Part C — Module 3: a custom-layout project starts with the
      // designer's boxes (explicit option, else the once-consumed pending
      // template, else rav_text defaults). Other layouts get no boxes.
      customLayout:
        layoutType === 'custom_layout'
          ? options?.customLayout ??
            consumePendingCustomLayout() ??
            defaultCustomLayoutDesign('rav_text')
          : undefined,
    };

    const base: ProfessionalDesignSettings = {
      projectId: options?.projectId ?? 'default-project',
      version: 1,
      revision: 1,
      updatedAt: Date.now(),
      lastModifiedBy: 'system',
      layoutType,
      pageLayout,
      layout: pageLayout,
      columns: {
        columnCount: layoutType === 'two_column' ? 2 : 1,
        columnGapPt: layoutType === 'two_column' ? 16.0 : 14.0,
        minColumnWidthPt: 78,
        balanceColumns: true,
      },
      pageElements: {
        showRunningHeader: true,
        showFolioNumber: false,
        showDecorativeFrame: true,
        runningHeaderFontSizePt: 10.5,
        folioNumberPosition: 'top_outside',
        // v0.5.0 Part B (Module 6): the top header line is hidden by
        // default on new projects — the user turns it on explicitly.
        showTopHeaderLine: false,
        // v0.9.8 Phase 5 (Quick-Tune): the divider rule under the header
        // defaults to ON (it only ever draws while the header line is
        // on, which is off by default — so this changes nothing visible
        // on a fresh book).
        showHeaderDividerRule: true,
        // v0.5.0 (integrator — user request): commentary labels and page
        // numbers are also off by default on a fresh book; the number
        // format defaults to Hebrew letters with the "דף" prefix, matching
        // the folio the app rendered before.
        showCommentaryLabels: false,
        pageNumberStyle: 'hebrew',
        showDafPrefix: true,
        // v0.6.0 Part A (§5): editable running-header text — empty means
        // automatic (centre = book title, right = folio, left = edition
        // label); everything on, centred, book font, header size.
        runningHeader: { ...DEFAULT_RUNNING_HEADER_SETTINGS },
        folioNumbering: {
          dafFormat: layoutType === 'rav_text' ? 'dots' : 'gematria',
          startDaf: layoutType === 'rav_text' ? 2 : 1,
          startAmud: 'a',
          excludeFrontMatter: true,
        },
        runningHeaderOverrides: {},
      },
      ravText: {
        sourceFontFamily,
        rashiFontFamily,
        tosafotFontFamily,
        sourceFontSizePt,
        rashiFontSizePt: commentaryFontSizePt,
        tosafotFontSizePt: commentaryFontSizePt,
        sourceLineSpacingRatio: 1.32,
        commentaryLineSpacingRatio: 1.32,
        commentaryToSourceScaleRatio: Number((commentaryFontSizePt / sourceFontSizePt).toFixed(2)),
        gutterWidthPt: knee.gutterWidth ?? 11,
        upperCollarLines: knee.upperKneeLines ?? 4,
        upperCollarInwardStepPt: knee.upperKneeInwardStep ?? 18,
        kneeJunctionPercent: knee.junctionPercent ?? 50,
        lowerSourceWidthPercent: knee.lowerWidthPercent ?? 78,
        kneeStepDirection: knee.stepDirection ?? 'auto',
        kneeMode: knee.mode ?? 'auto',
        kneeSettings: { ...knee },
        minSourceWidthPt: 135,
        minCommentaryWidthPt: 78,
        rashiWidthRatio: 0.5,
        tosafotWidthRatio: 0.5,
        sourceExpansionBehavior: 'dynamic_contour',
        dibburHamatchilBold: true,
        dibburBold: true,
        dibburHamatchilFontSizeDeltaPt: 0,
        dibburScalePercent: 100,
        preferSamePageSourceCommentary: true,
        continuationMarkerStyle: 'traditional_hebrew',
        // v0.8.0 Part C (§7): Michtav box off by default.
        michtavEnabled: false,
        michtavText: '',
        openingDecoration: { ...DEFAULT_OPENING_DECORATION },
        commentarySeparator: { ...DEFAULT_COMMENTARY_SEPARATOR },
        paragraphSeparator: { ...DEFAULT_PARAGRAPH_SEPARATOR },
        transitionMarker: { ...DEFAULT_TRANSITION_MARKER },
        peripheralStreams: DEFAULT_PERIPHERAL_STREAMS.map(s => ({ ...s })),
      },
      footnotes: {
        fontFamily: sourceFontFamily,
        fontSizePt: 9.5,
        lineSpacingPt: 13.0,
        leadingPt: 13.0,
        paragraphSpacingPt: 1.5,
        showSeparatorRule: true,
        showSeparatorLine: true,
        separatorWidthRatio: 0.25,
        separatorSpacingAbovePt: 6.0,
        separatorSpacingBelowPt: 4.0,
        indentPt: 0,
        placement: 'bottom_of_page',
        justifyMultiLineFootnotes: true,
        justifyMultiLineNonFinal: true,
        allowMultiPageContinuation: true,
      },
      roleStyles: {} as Record<SemanticStyleRole, RoleDesignStyle>,
      projectRoleStyles: {},
      localOverrides: [],
      localUnitOverrides: {},
      localWordOverrides: {},
      // v0.5.0 Part B (Module 5): no extra block margins / spacing yet.
      blockSpacing: { ...DEFAULT_BLOCK_SPACING },
      // v0.5.0 (Title Page / Shaar Blat builder): off by default — a fresh
      // book opens without a title page; the user turns it on.
      titlePage: JSON.parse(JSON.stringify(DEFAULT_TITLE_PAGE_SETTINGS)),
    };

    return this.syncDerivedViews(base);
  }

  /**
   * Deep-clones a `ProfessionalDesignSettings` object.
   */
  public static cloneSettings(settings: ProfessionalDesignSettings): ProfessionalDesignSettings {
    const cloned = JSON.parse(JSON.stringify(settings)) as ProfessionalDesignSettings;
    return this.syncDerivedViews(cloned);
  }

  /**
   * Returns a read-only copy of the canonical Global Style (`GLOBAL_STYLE`) for a given role.
   */
  public static getGlobalRoleStyle(role: SemanticStyleRole | ContentRole): RoleDesignStyle {
    return GLOBAL_ROLE_STYLES[role as SemanticStyleRole] ?? GLOBAL_ROLE_STYLES.regular_paragraph;
  }

  // -------------------------------------------------------------------------
  // v0.3.0 (Module C) — Ready designs & per-tier configuration
  // -------------------------------------------------------------------------

  /** Default tier list for a layout (used when settings predate v0.3.0). */
  public static defaultTiersForLayout(layoutType: BookLayoutType): TierConfig[] {
    switch (layoutType) {
      // v0.5.0 Part C — Module 3: a custom layout tiers like its base
      // (rav_text); the boxes, not the tiers, carry the custom geometry.
      case 'custom_layout':
      case 'rav_text':
        return [
          { role: 'main_source', tierIndex: 1, labelHe: 'גמרא', labelEn: 'Gemara', widthPct: 52, fontSizePt: 14.5, lineHeight: 1.32 },
          { role: 'primary_comment', tierIndex: 2, labelHe: 'רש״י', labelEn: 'Rashi', widthPct: 24, fontSizePt: 10.5, lineHeight: 1.32, side: 'inside' },
          { role: 'secondary_comment', tierIndex: 3, labelHe: 'תוספות', labelEn: 'Tosafot', widthPct: 24, fontSizePt: 10.5, lineHeight: 1.32, side: 'outside' },
          // v0.8.0 Part C (§1/§2): the secondary Vilna commentaries are
          // tiers 4–7 (keep in sync with SECONDARY_COMMENTARY_TIERS in
          // vilna-shas.ts). They share the tertiary band below the knee;
          // tier 4 carries the band's typography, tiers 5–7 name the
          // commentaries flowing into it.
          { role: 'tertiary_comment', tierIndex: 4, labelHe: 'עין משפט', labelEn: 'Ein Mishpat', widthPct: 18, fontSizePt: 9, lineHeight: 1.25, side: 'outside' },
          { role: 'tertiary_comment', tierIndex: 5, labelHe: 'נר מצווה', labelEn: 'Ner Mitzvah', widthPct: 18, fontSizePt: 9, lineHeight: 1.25, side: 'outside' },
          { role: 'tertiary_comment', tierIndex: 6, labelHe: 'תורה אור', labelEn: 'Torah Or', widthPct: 18, fontSizePt: 9, lineHeight: 1.25, side: 'below' },
          { role: 'tertiary_comment', tierIndex: 7, labelHe: 'מסורת הש״ס', labelEn: 'Masoret HaShas', widthPct: 18, fontSizePt: 9, lineHeight: 1.25, side: 'below' },
        ];
      case 'mikraot_gedolot':
        return [
          { role: 'verse', tierIndex: 1, labelHe: 'פסוק', labelEn: 'Verse', widthPct: 100, fontSizePt: 16, lineHeight: 1.35, side: 'below' },
          { role: 'primary_comment', tierIndex: 2, labelHe: 'תרגום אונקלוס', labelEn: 'Targum Onkelos', widthPct: 100, fontSizePt: 11, lineHeight: 1.32, side: 'below' },
          { role: 'secondary_comment', tierIndex: 3, labelHe: 'רש״י', labelEn: 'Rashi', widthPct: 50, fontSizePt: 10.5, lineHeight: 1.32, side: 'below' },
          { role: 'tertiary_comment', tierIndex: 4, labelHe: 'רמב״ן', labelEn: 'Ramban', widthPct: 50, fontSizePt: 10, lineHeight: 1.3, side: 'below' },
        ];
      case 'yiddish_sefer':
        return [
          { role: 'main_source', tierIndex: 1, labelHe: 'מקור עברי', labelEn: 'Hebrew source', widthPct: 45, fontSizePt: 14.5, lineHeight: 1.32, side: 'right' },
          { role: 'primary_comment', tierIndex: 2, labelHe: 'תרגום יידיש', labelEn: 'Yiddish translation', widthPct: 55, fontSizePt: 11, lineHeight: 1.32, side: 'left' },
          { role: 'secondary_comment', tierIndex: 3, labelHe: 'ביאור', labelEn: 'Biur', widthPct: 100, fontSizePt: 10, lineHeight: 1.3, side: 'below' },
        ];
      case 'two_column':
        return [
          { role: 'main_source', tierIndex: 1, labelHe: 'מקור ראשי', labelEn: 'Main source', widthPct: 50, fontSizePt: 13, lineHeight: 1.3 },
          { role: 'primary_comment', tierIndex: 2, labelHe: 'פירוש ראשי', labelEn: 'Primary commentary', widthPct: 50, fontSizePt: 10, lineHeight: 1.3 },
        ];
      case 'source_top_commentary_bottom':
        return [
          { role: 'main_source', tierIndex: 1, labelHe: 'מקור', labelEn: 'Source', widthPct: 100, fontSizePt: 14.5, lineHeight: 1.32, side: 'below' },
          { role: 'primary_comment', tierIndex: 2, labelHe: 'פירוש ראשי', labelEn: 'Primary commentary', widthPct: 50, fontSizePt: 10.5, lineHeight: 1.32, side: 'below' },
          { role: 'secondary_comment', tierIndex: 3, labelHe: 'פירוש משני', labelEn: 'Secondary commentary', widthPct: 50, fontSizePt: 10.5, lineHeight: 1.32, side: 'below' },
        ];
      case 'single_column':
      default:
        return [
          { role: 'main_source', tierIndex: 1, labelHe: 'גוף הספר', labelEn: 'Body text', widthPct: 100, fontSizePt: 13.5, lineHeight: 1.32 },
        ];
    }
  }

  /**
   * Clamps a tier list to the hard rules: tierIndex 1..(1 + MAX_COMMENT_TIERS),
   * widthPct 5..90, fontSizePt 6..72, lineHeight 1.0..2.2; de-duplicates by
   * tierIndex (last wins) and sorts ascending. Pure — returns a new array.
   */
  public static sanitizeTierConfigs(tiers: TierConfig[]): TierConfig[] {
    const byIndex = new Map<number, TierConfig>();
    for (const tier of tiers ?? []) {
      const tierIndex = Math.max(1, Math.min(1 + MAX_COMMENT_TIERS, Math.round(tier.tierIndex || 1)));
      byIndex.set(tierIndex, {
        ...tier,
        tierIndex,
        widthPct:
          tier.widthPct === undefined
            ? undefined
            : Math.max(5, Math.min(90, tier.widthPct)),
        fontSizePt:
          tier.fontSizePt === undefined
            ? undefined
            : Math.max(6, Math.min(72, tier.fontSizePt)),
        lineHeight:
          tier.lineHeight === undefined
            ? undefined
            : Math.max(1.0, Math.min(2.2, tier.lineHeight)),
      });
    }
    return [...byIndex.values()].sort((a, b) => a.tierIndex - b.tierIndex);
  }

  // -------------------------------------------------------------------------
  // v0.8.0 Part C (§2) — tier readers. Before this fix `pageLayout.tiers`
  // had zero readers in pagination, knee solving or style resolution, so
  // the tier editors (and the AI `expand_tosafot` action) changed nothing
  // visible. These helpers are the read path.
  // -------------------------------------------------------------------------

  /**
   * The tier driving a role's rendering. Tiers 4–7 all share the
   * `tertiary_comment` role (one shared tertiary band), so the FIRST
   * matching tier carries the band's typography; the later ones are
   * labels for the commentaries flowing into it.
   */
  public static resolveTierForRole(
    settings: ProfessionalDesignSettings,
    role: SemanticStyleRole | ContentRole
  ): TierConfig | undefined {
    return (settings.pageLayout.tiers ?? []).find(t => t.role === role);
  }

  /**
   * The Rashi share of the rav-text flanking budget implied by the tier
   * widths (Rashi width / (Rashi + Tosafot width)), clamped to the same
   * 0.36..0.64 band the knee solver's content-driven share uses. Null
   * when either flank tier has no width — the solver then keeps its
   * content-driven share.
   */
  public static tierFlankShare(settings: ProfessionalDesignSettings): number | null {
    const tiers = settings.pageLayout.tiers ?? [];
    const rashi = tiers.find(t => t.role === 'primary_comment');
    const tosafot = tiers.find(t => t.role === 'secondary_comment');
    if (!rashi?.widthPct || !tosafot?.widthPct) return null;
    const share = rashi.widthPct / (rashi.widthPct + tosafot.widthPct);
    return Math.min(0.64, Math.max(0.36, share));
  }

  /**
   * Whether a tier's widthPct can affect the render in a layout — the
   * width editor is only shown when true (v0.8.0 Part C §2: a control
   * that cannot change anything visible is removed, not left dead).
   * Width drives a side-by-side split only where the layout puts two
   * roles side by side: the Vilna flanks + Gemara width (rav_text /
   * mikraot_gedolot) and the bottom-commentary split
   * (source_top_commentary_bottom). The tertiary band is full-width, the
   * top/bottom source is full-width, and single/two-column and custom
   * layouts have no role-based side-by-side geometry — so their tier
   * widths are not editable.
   */
  public static isTierWidthEditable(
    layoutType: BookLayoutType,
    role: ContentRole
  ): boolean {
    if (layoutType === 'rav_text' || layoutType === 'mikraot_gedolot') {
      return (
        role === 'main_source' ||
        role === 'primary_comment' ||
        role === 'secondary_comment'
      );
    }
    if (layoutType === 'source_top_commentary_bottom') {
      return role === 'primary_comment' || role === 'secondary_comment';
    }
    return false;
  }

  /**
   * The share of the content width the main-source (Gemara) column takes,
   * from the main_source tier's widthPct. Null when the tier has no width
   * — the caller keeps its content-driven candidates. The knee solver
   * centres its sourceWidthRatio candidates on this share, so editing the
   * main tier's width visibly widens/narrows the Gemara column (the
   * solver may still pick a nearby ratio to achieve zero collisions).
   */
  public static tierSourceShare(settings: ProfessionalDesignSettings): number | null {
    const tiers = settings.pageLayout.tiers ?? [];
    const main = tiers.find(t => t.role === 'main_source');
    if (!main?.widthPct) return null;
    return Math.min(0.6, Math.max(0.35, main.widthPct / 100));
  }

  /**
   * The share of the content width the first of two side-by-side roles
   * takes, from the tier widths (two-column split, bottom-commentary
   * split). Null when either tier has no width — the caller keeps its
   * even split.
   */
  public static tierColumnSplit(
    settings: ProfessionalDesignSettings,
    roleA: ContentRole,
    roleB: ContentRole
  ): number | null {
    const tiers = settings.pageLayout.tiers ?? [];
    const a = tiers.find(t => t.role === roleA);
    const b = tiers.find(t => t.role === roleB);
    if (!a?.widthPct || !b?.widthPct) return null;
    const share = a.widthPct / (a.widthPct + b.widthPct);
    return Math.min(0.8, Math.max(0.2, share));
  }

  /**
   * Heals stale tiers from the live ravText shortcuts. Before v0.8.0 the
   * tier editors were write-only, so a stored tier can disagree with the
   * ravText value that actually rendered (font size, family, leading).
   * The ravText value wins — it is what the user saw — and the tier is
   * rewritten to match, so the two editors agree from here on. Only the
   * three roles with ravText shortcuts are healed; other roles (verse,
   * tertiary_comment, footnote) have no competing live value and their
   * tiers apply directly. Called from `syncDerivedViews` (idempotent:
   * once healed, the values agree and nothing further changes).
   */
  public static healTiersFromRavText(settings: ProfessionalDesignSettings): void {
    const tiers = settings.pageLayout.tiers;
    if (!tiers || tiers.length === 0) return;
    const rav = settings.ravText;
    if (!rav) return;
    const heal = (
      role: ContentRole,
      fontFamily: string | undefined,
      fontSizePt: number | undefined,
      lineHeight: number | undefined
    ): void => {
      const tier = tiers.find(t => t.role === role);
      if (!tier) return;
      if (fontFamily) tier.fontFamily = fontFamily;
      if (fontSizePt !== undefined && Number.isFinite(fontSizePt)) tier.fontSizePt = fontSizePt;
      if (lineHeight !== undefined && Number.isFinite(lineHeight) && lineHeight > 0) {
        tier.lineHeight = lineHeight;
      }
    };
    heal('main_source', rav.sourceFontFamily, rav.sourceFontSizePt, rav.sourceLineSpacingRatio);
    heal('primary_comment', rav.rashiFontFamily, rav.rashiFontSizePt, rav.commentaryLineSpacingRatio);
    heal('secondary_comment', rav.tosafotFontFamily, rav.tosafotFontSizePt, rav.commentaryLineSpacingRatio);
  }

  /**
   * Applies a ready design preset (`READY_DESIGNS`) to a copy of `current` and
   * returns the sanitized result. Opt-in only: callers that never call this see
   * no change. Role-style patches land in `projectRoleStyles` (PROJECT_STYLE),
   * so GLOBAL_STYLE and local overrides are untouched.
   */
  public static applyReadyDesign(
    current: ProfessionalDesignSettings,
    presetId: string,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const preset = getReadyDesign(presetId);
    if (!preset) {
      return {
        clampedByEngineHardRule: false,
        warnings: [`עיצוב מוכן לא מוכר: ${presetId}`],
        settings: this.cloneSettings(current),
      };
    }
    const next = this.cloneSettings(current);
    const p = preset.patch;

    next.layoutType = preset.layout;
    next.pageLayout.layoutType = preset.layout;
    if (p.pageSizePreset) next.pageLayout.pageSizePreset = p.pageSizePreset;
    if (p.pageLayout) next.pageLayout = { ...next.pageLayout, ...p.pageLayout };
    if (p.pageElements) {
      next.pageElements = { ...next.pageElements, ...p.pageElements };
      if (p.pageElements.folioNumberPosition !== undefined) {
        next.pageLayout.pageNumberPosition = p.pageElements.folioNumberPosition;
      }
      if (p.pageElements.showRunningHeader !== undefined) {
        next.pageLayout.showRunningHeader = p.pageElements.showRunningHeader;
        // v0.5.0 Part B (Module 6): a ready design that explicitly wants a
        // running header (all six kits do) also turns the top header line
        // on — the classic look keeps its header. Designs that do not
        // mention it leave the user's toggle alone.
        if (p.pageElements.showRunningHeader) {
          next.pageElements.showTopHeaderLine = true;
        }
      }
      if (p.pageElements.runningHeaderFontSizePt !== undefined) {
        next.pageLayout.runningHeaderFontSizePt = p.pageElements.runningHeaderFontSizePt;
      }
    }
    if (p.columns) next.columns = { ...next.columns, ...p.columns };
    if (p.ravText) next.ravText = { ...next.ravText, ...p.ravText };
    if (p.footnotes) next.footnotes = { ...next.footnotes, ...p.footnotes };
    if (p.tiers) next.pageLayout.tiers = this.sanitizeTierConfigs(p.tiers);

    if (p.roleStyles) {
      for (const roleKey of Object.keys(p.roleStyles) as SemanticStyleRole[]) {
        const patch = p.roleStyles[roleKey];
        if (!patch) continue;
        const existing = next.projectRoleStyles[roleKey] ?? {};
        next.projectRoleStyles[roleKey] = {
          character: { ...(existing.character ?? {}), ...(patch.character ?? {}) },
          paragraph: { ...(existing.paragraph ?? {}), ...(patch.paragraph ?? {}) },
        };
      }
      // Keep the ravText font/size shortcuts in sync with the patched roles.
      const src = p.roleStyles.main_source;
      if (src?.character?.fontFamily) next.ravText.sourceFontFamily = src.character.fontFamily;
      if (src?.character?.fontSizePt !== undefined) next.ravText.sourceFontSizePt = src.character.fontSizePt;
      if (src?.paragraph?.lineSpacingRatio !== undefined) next.ravText.sourceLineSpacingRatio = src.paragraph.lineSpacingRatio;
      const rashi = p.roleStyles.primary_comment;
      if (rashi?.character?.fontFamily) next.ravText.rashiFontFamily = rashi.character.fontFamily;
      if (rashi?.character?.fontSizePt !== undefined) next.ravText.rashiFontSizePt = rashi.character.fontSizePt;
      const tos = p.roleStyles.secondary_comment;
      if (tos?.character?.fontFamily) next.ravText.tosafotFontFamily = tos.character.fontFamily;
      if (tos?.character?.fontSizePt !== undefined) next.ravText.tosafotFontSizePt = tos.character.fontSizePt;
      const verse = p.roleStyles.verse;
      if (preset.layout === 'mikraot_gedolot' && verse?.character?.fontFamily) {
        next.ravText.sourceFontFamily = verse.character.fontFamily;
      }
      if (preset.layout === 'mikraot_gedolot' && verse?.character?.fontSizePt !== undefined) {
        next.ravText.sourceFontSizePt = verse.character.fontSizePt;
      }
    }

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = `עיצוב מוכן: ${preset.nameHe} (${preset.nameEn})`;

    return this.sanitizeAndEnforceHardRules(next);
  }

  /**
   * Updates one tier's width / font / size / line-height in place (panel control).
   * No-op (with a warning) when the tier index does not exist.
   */
  public static updateTierConfig(
    current: ProfessionalDesignSettings,
    tierIndex: number,
    patch: Partial<TierConfig>,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    const tiers = next.pageLayout.tiers ?? this.defaultTiersForLayout(next.layoutType);
    const idx = tiers.findIndex(t => t.tierIndex === tierIndex);
    if (idx === -1) {
      return {
        clampedByEngineHardRule: false,
        warnings: [`שכבה ${tierIndex} לא נמצאה בעיצוב הנוכחי`],
        settings: next,
      };
    }
    const updated = this.sanitizeTierConfigs([
      ...tiers.slice(0, idx),
      { ...tiers[idx], ...patch, tierIndex },
      ...tiers.slice(idx + 1),
    ]);
    next.pageLayout.tiers = updated;
    // v0.8.0 Part C (§2): a tier edit is the newest edit for its role, so
    // it must win over the older ravText shortcut and project role style
    // for that role — sync both forward from the tier BEFORE sanitize,
    // otherwise the `healTiersFromRavText` step in syncDerivedViews would
    // clobber the just-made edit back to the stale ravText value, and a
    // stale project style would override the tier in the resolver.
    const edited = updated.find(t => t.tierIndex === tierIndex) ?? updated[idx];
    this.syncTierToRoleSettings(next, edited);
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = `עדכון שכבה ${tierIndex} (${tiers[idx].labelHe ?? tiers[idx].role})`;
    return this.sanitizeAndEnforceHardRules(next);
  }

  /**
   * v0.8.0 Part C (§2): pushes one tier's typography forward into the
   * ravText shortcuts (main_source / primary_comment / secondary_comment
   * only) and the project role style for its role, so the tier edit, the
   * ravText panel and the Control Panel all agree afterwards. Width edits
   * on the two flanks also refresh the derived `rashiWidthRatio` /
   * `tosafotWidthRatio` the knee solver used to leave at 0.5/0.5.
   */
  public static syncTierToRoleSettings(
    settings: ProfessionalDesignSettings,
    tier: TierConfig
  ): void {
    const role = tier.role as SemanticStyleRole;
    const entry = settings.projectRoleStyles[role] ?? {};
    settings.projectRoleStyles[role] = {
      character: {
        ...(entry.character ?? {}),
        ...(tier.fontFamily !== undefined ? { fontFamily: tier.fontFamily } : {}),
        ...(tier.fontSizePt !== undefined ? { fontSizePt: tier.fontSizePt } : {}),
      },
      paragraph: {
        ...(entry.paragraph ?? {}),
        ...(tier.lineHeight !== undefined ? { lineSpacingRatio: tier.lineHeight } : {}),
      },
    };
    if (!settings.ravText) return;
    if (tier.role === 'main_source') {
      if (tier.fontFamily !== undefined) settings.ravText.sourceFontFamily = tier.fontFamily;
      if (tier.fontSizePt !== undefined) settings.ravText.sourceFontSizePt = tier.fontSizePt;
      if (tier.lineHeight !== undefined) settings.ravText.sourceLineSpacingRatio = tier.lineHeight;
    } else if (tier.role === 'primary_comment') {
      if (tier.fontFamily !== undefined) settings.ravText.rashiFontFamily = tier.fontFamily;
      if (tier.fontSizePt !== undefined) settings.ravText.rashiFontSizePt = tier.fontSizePt;
      if (tier.lineHeight !== undefined) settings.ravText.commentaryLineSpacingRatio = tier.lineHeight;
    } else if (tier.role === 'secondary_comment') {
      if (tier.fontFamily !== undefined) settings.ravText.tosafotFontFamily = tier.fontFamily;
      if (tier.fontSizePt !== undefined) settings.ravText.tosafotFontSizePt = tier.fontSizePt;
      if (tier.lineHeight !== undefined) settings.ravText.commentaryLineSpacingRatio = tier.lineHeight;
    }
    if (tier.role === 'primary_comment' || tier.role === 'secondary_comment') {
      const share = this.tierFlankShare(settings);
      if (share !== null) {
        settings.ravText.rashiWidthRatio = Number(share.toFixed(3));
        settings.ravText.tosafotWidthRatio = Number((1 - share).toFixed(3));
      }
    }
  }

  /**
   * Checks whether a requested font family is installed/supported for Hebrew holy-book typesetting,
   * and returns its availability + fallback information without modifying text.
   */
  public static checkFontAvailability(requestedFont: string): {
    requestedFont: string;
    isAvailable: boolean;
    isAvailableOnSystem: boolean;
    effectiveFont: string;
    effectiveFallbackFont?: string;
    warningHe?: string;
    warningMessage?: string;
  } {
    const clean = (requestedFont || '').trim();
    if (!clean) {
      return {
        requestedFont: 'Frank Ruhl Libre',
        isAvailable: true,
        isAvailableOnSystem: true,
        effectiveFont: 'Frank Ruhl Libre',
      };
    }

    const known = KNOWN_HOLY_BOOK_FONTS.find(
      f => f.family.toLowerCase() === clean.toLowerCase()
    );
    if (known && known.hasHebrew) {
      if (!known.hasNikud) {
        const msg = `הגופן "${known.family}" אינו תומך בניקוד מלא (GPOS). מופעל מנגנון גיבוי אוטומטי לניקוד ("Frank Ruhl Libre").`;
        return {
          requestedFont: known.family,
          isAvailable: true,
          isAvailableOnSystem: true,
          effectiveFont: 'Frank Ruhl Libre',
          effectiveFallbackFont: 'Frank Ruhl Libre',
          warningHe: msg,
          warningMessage: msg,
        };
      }
      return {
        requestedFont: known.family,
        isAvailable: true,
        isAvailableOnSystem: true,
        effectiveFont: known.family,
      };
    }

    if (clean.toLowerCase() === 'miriam libre') {
      return {
        requestedFont: 'Miriam Libre',
        isAvailable: true,
        isAvailableOnSystem: true,
        effectiveFont: 'Miriam Libre',
      };
    }

    // v0.5.0 Part A — Module 1(d): a font found on this computer or imported
    // by the user is available for on-screen use (the Font Manager and the
    // font dropdown already explain the PDF-embedding limit per font).
    const libraryEntry = findFontLibraryEntry(clean);
    if (libraryEntry) {
      return {
        requestedFont: libraryEntry.family,
        isAvailable: true,
        isAvailableOnSystem: true,
        effectiveFont: libraryEntry.family,
      };
    }

    const msg = `הגופן "${clean}" אינו מותקן או אינו תומך בעברית מלאה במחשב זה. התצוגה משתמשת בגופן הגיבוי "Frank Ruhl Libre" תוך שמירה מלאה על הטקסט.`;
    return {
      requestedFont: clean,
      isAvailable: false,
      isAvailableOnSystem: false,
      effectiveFont: 'Frank Ruhl Libre',
      effectiveFallbackFont: 'Frank Ruhl Libre',
      warningHe: msg,
      warningMessage: msg,
    };
  }

  public static resolveFontAvailability(
    requestedFont: string,
    _role?: SemanticStyleRole | ContentRole
  ) {
    return this.checkFontAvailability(requestedFont);
  }

  /**
   * Enforces Stage 12 Level 0 Universal Engine Hard Rules on any candidate `ProfessionalDesignSettings`:
   * - Clamps unreadable font sizes (< 6pt or > 72pt)
   * - Clamps horizontal character scale to [90%..110%] (prevents glyph distortion — Law #6)
   * - Clamps wordSpacingRatio to [0.75..1.60] and trackingEm to [-0.05..0.25]
   * - Clamps lineSpacingRatio to [1.05..2.50] (prevents vertical text collision — Law #4)
   * - Clamps page margins and gutters so content width never falls below Level 0 minimum readable width
   *   (`135pt` Source, `78pt` Commentary)
   * - Preserves Hebrew RTL direction for Hebrew holy-book roles unless explicitly valid
   */
  public static sanitizeAndEnforceHardRules(
    raw: ProfessionalDesignSettings,
    opts?: { allowLargeCentringSpacing?: boolean }
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(raw);
    const warnings: string[] = [];
    let clamped = false;

    // v0.6.0 (Part B): ordinary paragraph spacing is capped at 48pt
    // (a hard readability rule — no flowing paragraph needs a bigger gap).
    // Genuine vertical Auto-Center is the one exception: its offset IS
    // paragraph `spaceBefore`/`spaceAfter`, and it must reach half the
    // free space on the page (up to the frame height, ~600pt). The caller
    // opts in explicitly (`allowLargeCentringSpacing`); every other path
    // keeps the 48pt cap, and `computeBlockCentering` bounds the offset
    // by the frame anyway, so the 720pt ceiling is never approached.
    const spaceMaxPt = opts?.allowLargeCentringSpacing ? 720 : 48;

    const clampNum = (
      val: number,
      min: number,
      max: number,
      labelHe: string
    ): number => {
      if (Number.isNaN(val)) return min;
      if (val < min) {
        clamped = true;
        warnings.push(
          `חוק מנוע קשיח (LEVEL 0 — הגנת קריאות וגאומטריה): ${labelHe} (${val}) הוגבל למינימום החוקי (${min}).`
        );
        return min;
      }
      if (val > max) {
        clamped = true;
        warnings.push(
          `חוק מנוע קשיח (LEVEL 0 — הגנת קריאות וגאומטריה): ${labelHe} (${val}) הוגבל למקסימום החוקי (${max}).`
        );
        return max;
      }
      return val;
    };

    // 1. Page Layout bounds
    next.pageLayout.pageWidthPt = clampNum(
      next.pageLayout.pageWidthPt,
      280,
      1200,
      'רוחב עמוד'
    );
    next.pageLayout.pageHeightPt = clampNum(
      next.pageLayout.pageHeightPt,
      360,
      1600,
      'גובה עמוד'
    );
    next.pageLayout.marginTopPt = clampNum(
      next.pageLayout.marginTopPt,
      18,
      next.pageLayout.pageHeightPt * 0.3,
      'שוליים עליונים'
    );
    next.pageLayout.marginBottomPt = clampNum(
      next.pageLayout.marginBottomPt,
      18,
      next.pageLayout.pageHeightPt * 0.3,
      'שוליים תחתונים'
    );
    next.pageLayout.marginInsidePt = clampNum(
      next.pageLayout.marginInsidePt,
      18,
      next.pageLayout.pageWidthPt * 0.28,
      'שוליים פנימיים'
    );
    next.pageLayout.marginOutsidePt = clampNum(
      next.pageLayout.marginOutsidePt,
      18,
      next.pageLayout.pageWidthPt * 0.28,
      'שוליים חיצוניים'
    );
    next.pageLayout.columnGutterPt = clampNum(
      next.pageLayout.columnGutterPt,
      6,
      48,
      'מרווח בין טורים (Gutter)'
    );

    // Ensure usable content width satisfies Level 0 minimum readable width
    const minReqContentW =
      next.layoutType === 'rav_text' || next.layoutType === 'mikraot_gedolot'
        ? SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT +
          2 * SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT +
          2 * (next.ravText.gutterWidthPt || 11)
        : next.layoutType === 'two_column'
        ? 2 * SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT +
          next.pageLayout.columnGutterPt
        : SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT;

    const currentContentW =
      next.pageLayout.pageWidthPt -
      next.pageLayout.marginInsidePt -
      next.pageLayout.marginOutsidePt;

    if (currentContentW < minReqContentW) {
      clamped = true;
      const maxTotalHorizontalMargins = Math.max(
        36,
        next.pageLayout.pageWidthPt - minReqContentW
      );
      next.pageLayout.marginInsidePt = Math.floor(maxTotalHorizontalMargins / 2);
      next.pageLayout.marginOutsidePt = Math.floor(maxTotalHorizontalMargins / 2);
      warnings.push(
        `חוק מנוע קשיח (LEVEL 0 — רוחב קריאה מינימלי): השוליים הותאמו כדי לשמור על רוחב טקסט חוקי מינימלי (${minReqContentW}pt).`
      );
    }

    // --- v0.5.0 Part C — Module 3 (Custom Layout Designer) -----------------
    // A custom-layout project always has a box set (rav_text defaults when
    // the project predates the feature or the stored boxes were lost), and
    // every stored box is clamped to the content area + minimum size.
    // Overlaps are reported as warnings, never silently moved.
    // --- BEGIN Part C sanitize ---
    if (next.layoutType === 'custom_layout' && !next.pageLayout.customLayout) {
      next.pageLayout.customLayout = defaultCustomLayoutDesign('rav_text');
    }
    if (next.pageLayout.customLayout) {
      const validation = sanitizeCustomLayoutDesign(next.pageLayout.customLayout, {
        pageWidthPt: next.pageLayout.pageWidthPt,
        pageHeightPt: next.pageLayout.pageHeightPt,
      });
      next.pageLayout.customLayout = {
        ...next.pageLayout.customLayout,
        boxes: validation.boxes,
        pageOverrides: validation.pageOverrides,
      };
      if (validation.warnings.length > 0) {
        clamped = true;
        warnings.push(...validation.warnings);
      }
    }
    // --- END Part C sanitize ---

    // 2. Rav Text bounds
    next.ravText.sourceFontSizePt = clampNum(
      next.ravText.sourceFontSizePt,
      8.0,
      36.0,
      'גודל גופן מקור'
    );
    next.ravText.rashiFontSizePt = clampNum(
      next.ravText.rashiFontSizePt,
      7.0,
      28.0,
      'גודל גופן רש״י'
    );
    next.ravText.tosafotFontSizePt = clampNum(
      next.ravText.tosafotFontSizePt,
      7.0,
      28.0,
      'גודל גופן תוספות'
    );
    next.ravText.gutterWidthPt = clampNum(
      next.ravText.gutterWidthPt,
      8.0,
      32.0,
      'מרווח רב-טקסט (Gutter)'
    );
    next.ravText.minSourceWidthPt = clampNum(
      next.ravText.minSourceWidthPt ?? 135,
      135,
      320,
      'רוחב מקור מינימלי'
    );
    next.ravText.minCommentaryWidthPt = clampNum(
      next.ravText.minCommentaryWidthPt ?? 78,
      78,
      220,
      'רוחב מפרש מינימלי'
    );
    next.ravText.upperCollarLines = Math.round(
      clampNum(next.ravText.upperCollarLines, 0, 12, 'מספר שורות ברך עליונה')
    );
    next.ravText.kneeJunctionPercent = clampNum(
      next.ravText.kneeJunctionPercent,
      25,
      85,
      'אחוז צומת ברך'
    );
    next.ravText.lowerSourceWidthPercent = clampNum(
      next.ravText.lowerSourceWidthPercent,
      55,
      125,
      'אחוז רוחב מקור תחתון'
    );
    next.ravText.sourceLineSpacingRatio = clampNum(
      next.ravText.sourceLineSpacingRatio,
      1.05,
      2.2,
      'מרווח שורות מקור'
    );
    next.ravText.commentaryLineSpacingRatio = clampNum(
      next.ravText.commentaryLineSpacingRatio,
      1.05,
      2.2,
      'מרווח שורות מפרשים'
    );
    next.ravText.commentaryToSourceScaleRatio = Number(
      (next.ravText.rashiFontSizePt / Math.max(1, next.ravText.sourceFontSizePt)).toFixed(2)
    );
    if (next.ravText.openingDecoration) {
      next.ravText.openingDecoration.wordCount = Math.round(
        clampNum(next.ravText.openingDecoration.wordCount ?? 1, 1, 4, 'מספר מילים במסגרת פתיחה')
      );
      next.ravText.openingDecoration.paddingPt = clampNum(
        next.ravText.openingDecoration.paddingPt ?? 8,
        0,
        24,
        'ריפוד מסגרת פתיחה'
      );
    }
    if (next.pageElements?.folioNumbering) {
      next.pageElements.folioNumbering.startDaf = Math.round(
        clampNum(next.pageElements.folioNumbering.startDaf ?? 2, 1, 999, 'מספר דף התחלה')
      );
    }

    // 3. Footnotes bounds
    next.footnotes.fontSizePt = clampNum(
      next.footnotes.fontSizePt,
      6.5,
      18.0,
      'גודל גופן הערות שוליים'
    );
    next.footnotes.lineSpacingPt = clampNum(
      next.footnotes.lineSpacingPt,
      Math.max(8.0, next.footnotes.fontSizePt * 1.08),
      32.0,
      'מרווח שורות הערות שוליים'
    );
    next.footnotes.paragraphSpacingPt = clampNum(
      next.footnotes.paragraphSpacingPt,
      0,
      18.0,
      'מרווח פסקאות הערות שוליים'
    );

    // ── v0.5.0 Part B (Module 5) ──────────────────────────────────────
    // Block margins / spacing bounds. Same limits as the paragraph fields
    // they mirror (indents 0..72pt, spacing 0..48pt — see `sanitizePara`
    // below), so the persisted record and the rendered values stay equal.
    if (!next.blockSpacing) {
      next.blockSpacing = { ...DEFAULT_BLOCK_SPACING };
    }
    next.blockSpacing.marginLeftPt = clampNum(
      next.blockSpacing.marginLeftPt ?? 0,
      0,
      72.0,
      'שוליים שמאליים של הפסקה'
    );
    next.blockSpacing.marginRightPt = clampNum(
      next.blockSpacing.marginRightPt ?? 0,
      0,
      72.0,
      'שוליים ימניים של הפסקה'
    );
    next.blockSpacing.marginTopPt = clampNum(
      next.blockSpacing.marginTopPt ?? 0,
      0,
      48.0,
      'שוליים עליונים של הפסקה'
    );
    next.blockSpacing.marginBottomPt = clampNum(
      next.blockSpacing.marginBottomPt ?? 0,
      0,
      48.0,
      'שוליים תחתונים של הפסקה'
    );
    next.blockSpacing.spaceBeforePt = clampNum(
      next.blockSpacing.spaceBeforePt ?? next.blockSpacing.marginTopPt,
      0,
      spaceMaxPt,
      'מרווח לפני פסקה'
    );
    next.blockSpacing.spaceAfterPt = clampNum(
      next.blockSpacing.spaceAfterPt ?? next.blockSpacing.marginBottomPt,
      0,
      spaceMaxPt,
      'מרווח אחרי פסקה'
    );
    next.blockSpacing.autoCentered = Boolean(next.blockSpacing.autoCentered);
    // ── end v0.5.0 Part B (Module 5) ──────────────────────────────────

    // 4. Sanitize projectRoleStyles
    const sanitizeChar = (c: Partial<CharacterStyleSettings>, roleLabel: string) => {
      if (c.fontSizePt !== undefined) {
        c.fontSizePt = clampNum(c.fontSizePt, 6.5, 48.0, `גודל גופן (${roleLabel})`);
      }
      if (c.horizontalScalePercent !== undefined) {
        c.horizontalScalePercent = clampNum(
          c.horizontalScalePercent,
          90,
          110,
          `מתיחה אופקית של אותיות (${roleLabel})`
        );
      }
      if (c.wordSpacingRatio !== undefined) {
        c.wordSpacingRatio = clampNum(
          c.wordSpacingRatio,
          0.75,
          1.6,
          `מרווח מילים (${roleLabel})`
        );
      }
      if (c.trackingEm !== undefined) {
        c.trackingEm = clampNum(
          c.trackingEm,
          -0.05,
          0.25,
          `מרווח אותיות (${roleLabel})`
        );
      }
      if (c.baselineShiftPt !== undefined) {
        c.baselineShiftPt = clampNum(
          c.baselineShiftPt,
          -6,
          8,
          `היסט קו בסיס (${roleLabel})`
        );
      }
      if (c.openTypeFeatures) {
        // Level 0 Law #10: Combining mark positioning cannot be disabled for Hebrew
        if (c.openTypeFeatures.markPositioning === false) {
          c.openTypeFeatures.markPositioning = true;
          clamped = true;
          warnings.push(
            'חוק מנוע קשיח (LEVEL 0 — שלמות ניקוד וטעמים): לא ניתן לכבות הצמדת סימני ניקוד לאותיות הבסיס (GPOS mark).'
          );
        }
      }
    };

    const sanitizePara = (p: Partial<ParagraphStyleSettings>, roleLabel: string) => {
      if (p.lineSpacingRatio !== undefined) {
        p.lineSpacingRatio = clampNum(
          p.lineSpacingRatio,
          1.05,
          2.5,
          `מרווח שורות (${roleLabel})`
        );
      }
      if (p.leadingPt !== undefined) {
        p.leadingPt = clampNum(p.leadingPt, 7.5, 72.0, `Leading (${roleLabel})`);
      }
      if (p.spaceBeforePt !== undefined) {
        p.spaceBeforePt = clampNum(p.spaceBeforePt, 0, spaceMaxPt, `מרווח לפני פסקה (${roleLabel})`);
      }
      if (p.spaceAfterPt !== undefined) {
        p.spaceAfterPt = clampNum(p.spaceAfterPt, 0, spaceMaxPt, `מרווח אחרי פסקה (${roleLabel})`);
      }
      if (p.firstLineIndentPt !== undefined) {
        p.firstLineIndentPt = clampNum(
          p.firstLineIndentPt,
          0,
          72.0,
          `כניסת שורה ראשונה (${roleLabel})`
        );
      }
      if (p.rightIndentPt !== undefined) {
        p.rightIndentPt = clampNum(p.rightIndentPt, 0, 72.0, `כניסה מימין (${roleLabel})`);
      }
      if (p.leftIndentPt !== undefined) {
        p.leftIndentPt = clampNum(p.leftIndentPt, 0, 72.0, `כניסה משמאל (${roleLabel})`);
      }
      if (p.hangingIndentPt !== undefined) {
        p.hangingIndentPt = clampNum(p.hangingIndentPt, 0, 72.0, `הזחה תלויה (${roleLabel})`);
      }
      if (p.chalonIndentPt !== undefined) {
        p.chalonIndentPt = clampNum(p.chalonIndentPt, 0, 72.0, `הזחת חלון (${roleLabel})`);
      }
      if (p.chalonLineCount !== undefined) {
        p.chalonLineCount = Math.round(clampNum(p.chalonLineCount, 1, 6, `שורות חלון (${roleLabel})`));
      }
      if (p.minFollowingLines !== undefined) {
        p.minFollowingLines = Math.round(
          clampNum(p.minFollowingLines, 1, 8, `מינימום שורות המשך (${roleLabel})`)
        );
      }
      if (p.keepWithNextLines !== undefined && p.keepWithNext === undefined) {
        p.keepWithNext = p.keepWithNextLines > 0;
        if (p.keepWithNextLines > 0) {
          p.minFollowingLines = p.keepWithNextLines;
        }
      }
    };

    for (const [roleKey, entry] of Object.entries(next.projectRoleStyles)) {
      if (!entry) continue;
      if (entry.character) sanitizeChar(entry.character, roleKey);
      if (entry.paragraph) sanitizePara(entry.paragraph, roleKey);
    }

    for (const loc of next.localOverrides) {
      if (loc.characterOverrides) sanitizeChar(loc.characterOverrides, `דריסה מקומית ${loc.unitId}`);
      if (loc.paragraphOverrides) sanitizePara(loc.paragraphOverrides, `דריסה מקומית ${loc.unitId}`);
    }

    this.syncDerivedViews(next);

    return {
      clampedByEngineHardRule: clamped,
      warnings,
      settings: next,
    };
  }

  /**
   * Resolves the effective `RoleDesignStyle` (`CharacterStyleSettings` + `ParagraphStyleSettings`)
   * for a given `ContentRole`, optional `unitId`, and optional `wordIndex` by combining:
   *   1. `GLOBAL_ROLE_STYLES[role]`
   *   2. Synchronization from `ravText` / `footnotes` role-specific settings
   *   3. `settings.projectRoleStyles[role]` (`PROJECT_STYLE`)
   *   4. Matching `settings.localOverrides` (`LOCAL_OVERRIDE`)
   */
  public static resolveRoleAndUnitStyle(
    settings: ProfessionalDesignSettings,
    role: SemanticStyleRole | ContentRole,
    unitId?: string,
    wordIndex?: number
  ): {
    character: CharacterStyleSettings;
    paragraph: ParagraphStyleSettings;
    styleTier: 'GLOBAL_STYLE' | 'PROJECT_STYLE' | 'LOCAL_OVERRIDE';
    sourceScope: DesignScopeLevel;
    hasLocalOverride: boolean;
    localOverrideIds: string[];
  } {
    const globalBase = this.getGlobalRoleStyle(role);
    const char: CharacterStyleSettings = {
      ...globalBase.character,
      openTypeFeatures: { ...globalBase.character.openTypeFeatures },
    };
    const para: ParagraphStyleSettings = {
      ...globalBase.paragraph,
      tabStopsPt: [...globalBase.paragraph.tabStopsPt],
    };

    // Synchronize domain-specific settings (Rav Text / Footnotes / Page Elements)
    if (role === 'main_source' || role === 'regular_paragraph' || role === 'body') {
      char.fontFamily = settings.ravText.sourceFontFamily || char.fontFamily;
      if (role === 'main_source') {
        char.fontSizePt = settings.ravText.sourceFontSizePt;
      }
      para.lineSpacingRatio = settings.ravText.sourceLineSpacingRatio;
      para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
    } else if (role === 'primary_comment') {
      char.fontFamily = settings.ravText.rashiFontFamily || char.fontFamily;
      char.fontSizePt = settings.ravText.rashiFontSizePt;
      para.lineSpacingRatio = settings.ravText.commentaryLineSpacingRatio;
      para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
    } else if (role === 'secondary_comment') {
      char.fontFamily = settings.ravText.tosafotFontFamily || char.fontFamily;
      char.fontSizePt = settings.ravText.tosafotFontSizePt;
      para.lineSpacingRatio = settings.ravText.commentaryLineSpacingRatio;
      para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
    } else if (role === 'dibbur_hamatchil') {
      char.isBold = settings.ravText.dibburHamatchilBold;
      char.fontWeight = settings.ravText.dibburHamatchilBold ? 700 : 400;
      const scaleMult = (settings.ravText.dibburScalePercent ?? 100) / 100.0;
      char.fontSizePt = Number(
        (
          (settings.ravText.rashiFontSizePt + settings.ravText.dibburHamatchilFontSizeDeltaPt) *
          scaleMult
        ).toFixed(2)
      );
    } else if (role === 'footnote') {
      char.fontFamily = settings.footnotes.fontFamily || char.fontFamily;
      char.fontSizePt = settings.footnotes.fontSizePt;
      para.leadingPt = settings.footnotes.lineSpacingPt;
      para.lineSpacingRatio = Number(
        (settings.footnotes.lineSpacingPt / Math.max(1, settings.footnotes.fontSizePt)).toFixed(2)
      );
      para.spaceAfterPt = settings.footnotes.paragraphSpacingPt;
      para.rightIndentPt = settings.footnotes.indentPt;
      para.justifyNonFinalLines = settings.footnotes.justifyMultiLineFootnotes;
      para.alignment = settings.footnotes.justifyMultiLineFootnotes ? 'justify' : 'right';
    } else if (role === 'page_element' || role === 'header_running' || role === 'folio_number') {
      char.fontSizePt = settings.pageLayout.runningHeaderFontSizePt;
    }

    // v0.8.0 Part C (§2): per-tier config is the layout's base style for
    // the role — applied AFTER the domain (ravText/footnote) sync and
    // BEFORE project/local overrides, so a tier edit changes the render
    // while a Control Panel / design-panel role edit still wins. The
    // write-time syncs (updateTierConfig ↔ updateRavTextSettings) keep
    // the tier and the ravText shortcut agreeing, so this layer and the
    // domain sync above normally carry the same values.
    const tier = this.resolveTierForRole(settings, role);
    if (tier) {
      if (tier.fontFamily) char.fontFamily = tier.fontFamily;
      if (tier.fontSizePt !== undefined) char.fontSizePt = tier.fontSizePt;
      if (tier.lineHeight !== undefined && tier.lineHeight > 0) {
        para.lineSpacingRatio = tier.lineHeight;
        para.leadingPt = Number((char.fontSizePt * tier.lineHeight).toFixed(2));
      }
    }

    let styleTier: 'GLOBAL_STYLE' | 'PROJECT_STYLE' | 'LOCAL_OVERRIDE' = 'GLOBAL_STYLE';
    let sourceScope: DesignScopeLevel = 'role';

    // Apply PROJECT_STYLE overrides for this role
    const projOverride = settings.projectRoleStyles[role as SemanticStyleRole];
    if (projOverride) {
      if (projOverride.character && Object.keys(projOverride.character).length > 0) {
        Object.assign(char, projOverride.character);
        if (projOverride.character.openTypeFeatures) {
          char.openTypeFeatures = {
            ...char.openTypeFeatures,
            ...projOverride.character.openTypeFeatures,
          };
        }
        if (projOverride.character.isBold !== undefined) {
          char.fontWeight = projOverride.character.isBold
            ? Math.max(600, char.fontWeight)
            : projOverride.character.fontWeight ?? 400;
        }
        styleTier = 'PROJECT_STYLE';
      }
      if (projOverride.paragraph && Object.keys(projOverride.paragraph).length > 0) {
        Object.assign(para, projOverride.paragraph);
        if (
          projOverride.paragraph.lineSpacingRatio !== undefined &&
          projOverride.paragraph.leadingPt === undefined
        ) {
          para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
        } else if (
          projOverride.paragraph.leadingPt !== undefined &&
          projOverride.paragraph.lineSpacingRatio === undefined
        ) {
          para.lineSpacingRatio = Number(
            (para.leadingPt / Math.max(1, char.fontSizePt)).toFixed(2)
          );
        }
        if (projOverride.paragraph.alignment !== undefined) {
          para.justifyNonFinalLines = projOverride.paragraph.alignment === 'justify';
        }
        styleTier = 'PROJECT_STYLE';
      }
    }

    // Apply LOCAL_OVERRIDE if unitId is specified
    const matchingLocalIds: string[] = [];
    if (unitId) {
      for (const loc of settings.localOverrides) {
        if (loc.unitId !== unitId) continue;
        if (loc.wordRange && wordIndex !== undefined) {
          if (wordIndex < loc.wordRange.startWordIndex || wordIndex > loc.wordRange.endWordIndex) {
            continue;
          }
        } else if (loc.wordRange && wordIndex === undefined) {
          // Word-range override only applies when inspecting that word or rendering that word
          continue;
        }
        matchingLocalIds.push(loc.id);
        if (loc.characterOverrides) {
          Object.assign(char, loc.characterOverrides);
          if (loc.characterOverrides.openTypeFeatures) {
            char.openTypeFeatures = {
              ...char.openTypeFeatures,
              ...loc.characterOverrides.openTypeFeatures,
            };
          }
          if (loc.characterOverrides.isBold !== undefined) {
            char.fontWeight = loc.characterOverrides.isBold ? 700 : 400;
          }
        }
        if (loc.paragraphOverrides) {
          Object.assign(para, loc.paragraphOverrides);
          if (
            loc.paragraphOverrides.lineSpacingRatio !== undefined &&
            loc.paragraphOverrides.leadingPt === undefined
          ) {
            para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
          } else if (
            loc.paragraphOverrides.leadingPt !== undefined &&
            loc.paragraphOverrides.lineSpacingRatio === undefined
          ) {
            para.lineSpacingRatio = Number(
              (para.leadingPt / Math.max(1, char.fontSizePt)).toFixed(2)
            );
          }
          if (loc.paragraphOverrides.alignment !== undefined) {
            para.justifyNonFinalLines = loc.paragraphOverrides.alignment === 'justify';
          }
        }
        styleTier = 'LOCAL_OVERRIDE';
        sourceScope = loc.wordRange ? 'local_word' : 'local_unit';
      }
    }

    // v0.8.0 Part C (§9): a leading below the glyph extent (ascent 0.82 +
    // descent 0.24 = 1.06 × font size) overlaps adjacent lines. Clamp the
    // resolved leading and ratio here — the single choke point every
    // paginator and the Control Panel read through — so no setting (tier,
    // role style, or local override) can produce overlapping lines.
    // The panel reads the clamped value back, so what it shows is what
    // renders; there is no silent discrepancy.
    if (char.fontSizePt > 0) {
      const minLeading = char.fontSizePt * 1.06;
      if (para.leadingPt > 0 && para.leadingPt < minLeading) {
        para.leadingPt = Number(minLeading.toFixed(2));
      }
      if (para.lineSpacingRatio > 0 && para.lineSpacingRatio < 1.06) {
        para.lineSpacingRatio = 1.06;
      }
    }

    return {
      character: char,
      paragraph: para,
      styleTier,
      sourceScope,
      hasLocalOverride: matchingLocalIds.length > 0,
      localOverrideIds: matchingLocalIds,
    };
  }

  public static resolveStyle(
    settings: ProfessionalDesignSettings,
    context: {
      role?: SemanticStyleRole | ContentRole;
      unitId?: string;
      wordIndex?: number;
      pageIndex?: number;
    }
  ): {
    character: CharacterStyleSettings;
    paragraph: ParagraphStyleSettings;
    styleTier: 'GLOBAL_STYLE' | 'PROJECT_STYLE' | 'LOCAL_OVERRIDE';
    sourceScope: DesignScopeLevel;
    hasLocalOverride: boolean;
    localOverrideIds: string[];
  } {
    return this.resolveRoleAndUnitStyle(
      settings,
      context.role ?? 'main_source',
      context.unitId,
      context.wordIndex
    );
  }

  /**
   * Resolves the effective formatting for the current user selection (`DesignSelectionTarget`),
   * including `"Mixed"` field detection when multiple selected units or words have differing values.
   */
  public static resolveSelectionFormatting(
    settings: ProfessionalDesignSettings,
    selection: DesignSelectionTarget | null | undefined,
    units: ContentUnit[] = []
  ): EffectiveResolvedFormatting {
    if (!selection || selection.unitIds.length === 0) {
      const defaultRole: ContentRole = selection?.role ?? 'main_source';
      const resolved = this.resolveRoleAndUnitStyle(settings, defaultRole);
      return {
        targetScope: selection?.role ? 'role' : 'document',
        sourceScope: resolved.sourceScope,
        activeRole: defaultRole,
        styleTier: resolved.styleTier,
        hasLocalOverride: false,
        localOverrideIds: [],
        mixedFields: [],
        character: resolved.character,
        paragraph: resolved.paragraph,
        fontAvailability: this.checkFontAvailability(resolved.character.fontFamily),
      };
    }

    const resolvedItems = selection.unitIds.map(uId => {
      const unit = units.find(u => u.id === uId);
      const role = unit?.role ?? selection.role ?? 'main_source';
      return {
        unitId: uId,
        role,
        ...this.resolveRoleAndUnitStyle(settings, role, uId, selection.wordIndex),
      };
    });

    // Also check if a single unit has mixed word-range local overrides when no specific wordIndex is selected
    if (
      selection.unitIds.length === 1 &&
      selection.wordIndex === undefined
    ) {
      const singleUnitId = selection.unitIds[0];
      const wordRangeOverrides = settings.localOverrides.filter(
        o => o.unitId === singleUnitId && Boolean(o.wordRange)
      );
      if (wordRangeOverrides.length > 0) {
        const baseItem = resolvedItems[0];
        for (const wro of wordRangeOverrides) {
          resolvedItems.push(
            {
              unitId: singleUnitId,
              role: baseItem.role,
              ...this.resolveRoleAndUnitStyle(
                settings,
                baseItem.role,
                singleUnitId,
                wro.wordRange!.startWordIndex
              ),
            }
          );
        }
      }
    }

    const first = resolvedItems[0];
    const mixedFields: string[] = [];

    if (resolvedItems.length > 1) {
      const charKeys: Array<keyof CharacterStyleSettings> = [
        'fontFamily',
        'fontSizePt',
        'fontWeight',
        'fontStyle',
        'isBold',
        'isItalic',
        'isUnderline',
        'trackingEm',
        'wordSpacingRatio',
        'horizontalScalePercent',
        'baselineShiftPt',
      ];
      for (const k of charKeys) {
        const firstVal = first.character[k];
        if (resolvedItems.some(item => item.character[k] !== firstVal)) {
          mixedFields.push(`character.${k}`);
        }
      }

      const paraKeys: Array<keyof ParagraphStyleSettings> = [
        'alignment',
        'lastLineAlignment',
        'direction',
        'leadingPt',
        'lineSpacingRatio',
        'spaceBeforePt',
        'spaceAfterPt',
        'firstLineIndentPt',
        'rightIndentPt',
        'leftIndentPt',
      ];
      for (const k of paraKeys) {
        const firstVal = first.paragraph[k];
        if (resolvedItems.some(item => item.paragraph[k] !== firstVal)) {
          mixedFields.push(`paragraph.${k}`);
        }
      }
    }

    const allLocalIds = Array.from(
      new Set(resolvedItems.flatMap(r => r.localOverrideIds))
    );
    const hasLocal = allLocalIds.length > 0;

    return {
      targetScope:
        mixedFields.length > 0 || selection.unitIds.length > 1
          ? 'mixed_selection'
          : selection.wordIndex !== undefined
          ? 'word_range'
          : 'unit',
      sourceScope: hasLocal ? 'local_selection' : 'role',
      activeRole: first.role,
      styleTier: hasLocal ? 'LOCAL_OVERRIDE' : first.styleTier,
      hasLocalOverride: hasLocal,
      localOverrideIds: allLocalIds,
      mixedFields,
      character: first.character,
      paragraph: first.paragraph,
      fontAvailability: this.checkFontAvailability(first.character.fontFamily),
    };
  }

  public static updateRoleCharacterStyle(
    current: ProfessionalDesignSettings,
    role: SemanticStyleRole | ContentRole,
    patch: Partial<CharacterStyleSettings>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.updateRoleStyle(
      current,
      role as ContentRole,
      { character: patch },
      actor
    ).settings;
  }

  public static updateRoleParagraphStyle(
    current: ProfessionalDesignSettings,
    role: SemanticStyleRole | ContentRole,
    patch: Partial<ParagraphStyleSettings>,
    actor: 'user' | 'ai' = 'user',
    opts?: { allowLargeCentringSpacing?: boolean }
  ): ProfessionalDesignSettings {
    return this.updateRoleStyle(
      current,
      role as ContentRole,
      { paragraph: patch },
      actor,
      undefined,
      opts
    ).settings;
  }

  public static setLocalUnitOverride(
    current: ProfessionalDesignSettings,
    unitId: string,
    updates: {
      character?: Partial<CharacterStyleSettings>;
      paragraph?: Partial<ParagraphStyleSettings>;
    },
    actor: 'user' | 'ai' = 'user',
    opts?: { allowLargeCentringSpacing?: boolean }
  ): ProfessionalDesignSettings {
    return this.applyLocalOverride(current, { unitIds: [unitId] }, updates, actor, undefined, opts).settings;
  }

  public static setLocalWordOverride(
    current: ProfessionalDesignSettings,
    unitId: string,
    wordIndex: number,
    patch: Partial<CharacterStyleSettings>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.applyLocalOverride(
      current,
      { unitIds: [unitId], wordRange: { startWordIndex: wordIndex, endWordIndex: wordIndex } },
      { character: patch },
      actor
    ).settings;
  }

  public static clearLocalUnitOverride(
    current: ProfessionalDesignSettings,
    unitId: string,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.clearLocalOverrides(current, [unitId], actor);
  }

  public static resetRoleToDefault(
    current: ProfessionalDesignSettings,
    role: SemanticStyleRole | ContentRole,
    _actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.resetRoleStyleToGlobal(current, role as ContentRole, false);
  }

  public static updateLayoutSettings(
    current: ProfessionalDesignSettings,
    patch: { layoutType?: BookLayoutType; geometry?: Partial<PageGeometry> },
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    if (patch.layoutType) {
      next.layoutType = patch.layoutType;
      next.pageLayout.layoutType = patch.layoutType;
      if (patch.layoutType === 'two_column') {
        next.pageLayout.columnCount = 2;
      }
      // v0.8.0 Part C (§8): tiers are per-layout config — the tier list of
      // the old layout (Vilna widths 52/24/24, mikraot verse tiers, …)
      // must not leak into the new layout, where the same roles mean
      // different geometry. Reset to the new layout's defaults; the
      // transactional switch in layout-transaction.ts records this.
      // (A ready design applied afterwards replaces them with its own.)
      next.pageLayout.tiers = this.defaultTiersForLayout(patch.layoutType);
    }
    if (patch.geometry) {
      if (patch.geometry.pageWidth !== undefined) next.pageLayout.pageWidthPt = patch.geometry.pageWidth;
      if (patch.geometry.pageHeight !== undefined) next.pageLayout.pageHeightPt = patch.geometry.pageHeight;
      if (patch.geometry.marginTop !== undefined) next.pageLayout.marginTopPt = patch.geometry.marginTop;
      if (patch.geometry.marginBottom !== undefined) next.pageLayout.marginBottomPt = patch.geometry.marginBottom;
      if (patch.geometry.marginInside !== undefined) next.pageLayout.marginInsidePt = patch.geometry.marginInside;
      if (patch.geometry.marginOutside !== undefined) next.pageLayout.marginOutsidePt = patch.geometry.marginOutside;
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  public static updatePageGeometry(
    current: ProfessionalDesignSettings,
    patch: Partial<PageGeometry>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.updateLayoutSettings(current, { geometry: patch }, actor);
  }

  public static updateColumnSettings(
    current: ProfessionalDesignSettings,
    patch: Partial<ColumnDesignSettings>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    next.columns = {
      ...next.columns,
      ...patch,
    };
    if (patch.columnGapPt !== undefined) {
      next.pageLayout.columnGutterPt = patch.columnGapPt;
    }
    if (patch.columnCount !== undefined) {
      next.pageLayout.columnCount = patch.columnCount;
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // v0.6.0 Part A (§5) — header collapse / reflow.
  // ─────────────────────────────────────────────────────────────────────────
  // The running-header band lives in the top margin. When the line is on,
  // pagination must reserve its height above the text (content starts
  // lower — a real reflow: fewer lines fit per page); when it is off the
  // reserve collapses to zero and the text moves back up into the margin
  // the user set, leaving no blank gap. This is applied ONLY to the
  // geometry handed to the pagination engine (App's `paginationGeometry`
  // memo) — never to the stored margin, and never inside
  // pagination-engine.ts. The title page keeps the plain geometry: it
  // never shows a header.
  // ─────────────────────────────────────────────────────────────────────────
  /** Points of vertical space the header band reserves above the text. */
  public static headerReservePt(settings: ProfessionalDesignSettings): number {
    const on =
      settings.pageElements?.showTopHeaderLine ??
      settings.pageElements?.showRunningHeader ??
      false;
    if (!on) return 0;
    const band = settings.pageLayout?.headerBandHeightPt;
    return typeof band === 'number' && Number.isFinite(band) && band > 0 ? band : 24;
  }

  /** Geometry for pagination: top margin grown by the header reserve. */
  public static paginationGeometryFor(
    settings: ProfessionalDesignSettings,
    geometry: PageGeometry
  ): PageGeometry {
    const reserve = this.headerReservePt(settings);
    if (reserve === 0) return geometry;
    return { ...geometry, marginTop: geometry.marginTop + reserve };
  }

  public static updatePageElementsSettings(
    current: ProfessionalDesignSettings,
    patch: Omit<Partial<PageElementsDesignSettings>, 'runningHeader' | 'runningHeaderOverrides'> & {
      // v0.6.0 Part A (§5): a partial running-header merge, and a
      // per-folio override set ({ pageIndex, override }) / clear
      // (override: null). Typed here so panel + AI callers need no cast.
      // (Omit above: without it the intersection would keep the full
      // RunningHeaderSettings type and reject partial patches.)
      runningHeader?: Partial<RunningHeaderSettings>;
      runningHeaderOverride?: { pageIndex: number; override: RunningHeaderPageOverride | null };
    },
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    // v0.6.0 Part A (§5): capture the current header settings BEFORE the
    // patch spread below — a partial `runningHeader` patch must merge over
    // them, not replace the whole object (the spread would otherwise drop
    // every field the patch does not mention). The header patch fields are
    // stripped from the spread itself so they never land as stray keys in
    // the persisted settings; the merge code below applies them.
    const prevRunningHeader: RunningHeaderSettings | undefined =
      next.pageElements.runningHeader;
    const { runningHeader: rhPatch, runningHeaderOverride: rhOverride, ...restPatch } = patch;
    next.pageElements = {
      ...next.pageElements,
      ...restPatch,
    };
    if (patch.showRunningHeader !== undefined) {
      next.pageLayout.showRunningHeader = patch.showRunningHeader;
      // v0.5.0 Part B (Module 6): the old "show running header" checkbox
      // and the new "Show Top Header Line" toggle describe the same line,
      // so they stay in sync — setting one sets the other.
      next.pageElements.showTopHeaderLine = patch.showRunningHeader;
    }
    if (patch.showTopHeaderLine !== undefined) {
      // An explicit new-toggle value wins when both are passed together.
      next.pageElements.showTopHeaderLine = patch.showTopHeaderLine;
      next.pageLayout.showRunningHeader = patch.showTopHeaderLine;
    }
    if (patch.runningHeaderFontSizePt !== undefined) {
      next.pageLayout.runningHeaderFontSizePt = patch.runningHeaderFontSizePt;
    }
    // v0.6.0 Part A (§5): running-header text/options merge field by
    // field (callers pass a partial object); the per-folio override is
    // set with { pageIndex, override } and cleared with override: null.
    if (rhPatch && typeof rhPatch === 'object') {
      const cleanText = (v: unknown): string | undefined =>
        typeof v === 'string' ? v.trim().slice(0, 200) : undefined;
      const cur: RunningHeaderSettings = {
        ...DEFAULT_RUNNING_HEADER_SETTINGS,
        ...(prevRunningHeader ?? {}),
      };
      const lt = cleanText(rhPatch.leftText);
      if (lt !== undefined) cur.leftText = lt;
      const ct = cleanText(rhPatch.centerText);
      if (ct !== undefined) cur.centerText = ct;
      const rt = cleanText(rhPatch.rightText);
      if (rt !== undefined) cur.rightText = rt;
      // v0.9.8 Phase 5 (Quick-Tune / Koteret): per-side centre-slot text.
      const rpt = cleanText(rhPatch.rightPageText);
      if (rpt !== undefined) cur.rightPageText = rpt;
      const lpt = cleanText(rhPatch.leftPageText);
      if (lpt !== undefined) cur.leftPageText = lpt;
      if (typeof rhPatch.showBookTitle === 'boolean') cur.showBookTitle = rhPatch.showBookTitle;
      if (typeof rhPatch.showChapterTitle === 'boolean')
        cur.showChapterTitle = rhPatch.showChapterTitle;
      if (typeof rhPatch.showPageNumber === 'boolean') cur.showPageNumber = rhPatch.showPageNumber;
      if (
        rhPatch.alignment === 'left' ||
        rhPatch.alignment === 'center' ||
        rhPatch.alignment === 'right'
      )
        cur.alignment = rhPatch.alignment;
      if (typeof rhPatch.fontFamily === 'string') cur.fontFamily = rhPatch.fontFamily.trim();
      if (typeof rhPatch.fontSizePt === 'number' && Number.isFinite(rhPatch.fontSizePt))
        cur.fontSizePt = Math.min(24, Math.max(8, rhPatch.fontSizePt));
      if (typeof rhPatch.masechetName === 'string') cur.masechetName = rhPatch.masechetName.trim().slice(0, 100);
      if (typeof rhPatch.perekNumberText === 'string') cur.perekNumberText = rhPatch.perekNumberText.trim().slice(0, 100);
      if (typeof rhPatch.perekTitleText === 'string') cur.perekTitleText = rhPatch.perekTitleText.trim().slice(0, 120);
      if (typeof rhPatch.useStructuredVilnaHeader === 'boolean') cur.useStructuredVilnaHeader = rhPatch.useStructuredVilnaHeader;
      next.pageElements.runningHeader = cur;
    }
    if (patch.folioNumbering && typeof patch.folioNumbering === 'object') {
      const prevFn: FolioNumberingSettings = {
        ...DEFAULT_FOLIO_NUMBERING,
        ...(current.pageElements?.folioNumbering ?? {}),
      };
      next.pageElements.folioNumbering = {
        ...prevFn,
        ...patch.folioNumbering,
      };
    }
    if (rhOverride && typeof rhOverride === 'object') {
      const idx = Math.floor(rhOverride.pageIndex);
      if (Number.isFinite(idx) && idx >= 0) {
        const overrides = { ...(next.pageElements.runningHeaderOverrides ?? {}) };
        if (rhOverride.override === null) {
          delete overrides[String(idx)];
        } else if (rhOverride.override && typeof rhOverride.override === 'object') {
          const clean = (v: unknown): string | undefined =>
            typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 200) : undefined;
          const nextOverride: RunningHeaderPageOverride = {};
          const l = clean(rhOverride.override.leftText);
          if (l !== undefined) nextOverride.leftText = l;
          const c = clean(rhOverride.override.centerText);
          if (c !== undefined) nextOverride.centerText = c;
          const r = clean(rhOverride.override.rightText);
          if (r !== undefined) nextOverride.rightText = r;
          if (Object.keys(nextOverride).length > 0) overrides[String(idx)] = nextOverride;
          else delete overrides[String(idx)];
        }
        next.pageElements.runningHeaderOverrides = overrides;
      }
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // v0.5.0 Part B — Module 5: block-level margins, spacing & Auto-Center.
  // ─────────────────────────────────────────────────────────────────────────
  // A block's margins are paragraph indents + spacing (see the model note
  // in `types/design-settings.ts`): left/right indents for the horizontal
  // margins, spaceBefore/spaceAfter for the vertical ones. Writing them
  // through the paragraph styles means pagination re-runs and the preview
  // updates live, with no new rendering path to keep in sync.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Sets the margins / spacing of one text block. With `opts.unitId` the
   * values land as a LOCAL override on that block only; without it they
   * land on the role style (`opts.role`, default `main_source`) for the
   * whole book. The merged values are also recorded in
   * `settings.blockSpacing` (with `autoCentered` cleared on any manual
   * edit, unless the caller passes it explicitly).
   */
  public static updateBlockSpacing(
    current: ProfessionalDesignSettings,
    patch: Partial<BlockSpacingSettings>,
    opts?: {
      unitId?: string;
      role?: ContentRole | SemanticStyleRole;
      /** v0.6.0 (Part B): allow the centring offset (>48pt) through the sanitizer. Only genuine Auto-Center passes this. */
      allowLargeCentringSpacing?: boolean;
    },
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const role = (opts?.role ?? 'main_source') as ContentRole;
    const resolved = this.resolveRoleAndUnitStyle(current, role, opts?.unitId);
    const cur = resolved.paragraph;
    const marginLeftPt = patch.marginLeftPt ?? cur.leftIndentPt ?? 0;
    const marginRightPt = patch.marginRightPt ?? cur.rightIndentPt ?? 0;
    const marginTopPt =
      patch.marginTopPt ?? patch.spaceBeforePt ?? cur.spaceBeforePt ?? 0;
    const marginBottomPt =
      patch.marginBottomPt ?? patch.spaceAfterPt ?? cur.spaceAfterPt ?? 0;
    const anyMarginSupplied =
      patch.marginLeftPt !== undefined ||
      patch.marginRightPt !== undefined ||
      patch.marginTopPt !== undefined ||
      patch.marginBottomPt !== undefined ||
      patch.spaceBeforePt !== undefined ||
      patch.spaceAfterPt !== undefined;
    const autoCentered =
      patch.autoCentered ?? (anyMarginSupplied ? false : current.blockSpacing?.autoCentered ?? false);

    const paraPatch: Partial<ParagraphStyleSettings> = {
      leftIndentPt: marginLeftPt,
      rightIndentPt: marginRightPt,
      spaceBeforePt: marginTopPt,
      spaceAfterPt: marginBottomPt,
    };
    const updated = opts?.unitId
      ? this.setLocalUnitOverride(current, opts.unitId, { paragraph: paraPatch }, actor, {
          allowLargeCentringSpacing: opts?.allowLargeCentringSpacing,
        })
      : this.updateRoleParagraphStyle(current, role, paraPatch, actor, {
          allowLargeCentringSpacing: opts?.allowLargeCentringSpacing,
        });
    updated.blockSpacing = {
      marginLeftPt,
      marginRightPt,
      marginTopPt,
      marginBottomPt,
      spaceBeforePt: marginTopPt,
      spaceAfterPt: marginBottomPt,
      autoCentered,
    };
    updated.version += 1;
    updated.updatedAt = Date.now();
    updated.lastModifiedBy = actor;
    return this.sanitizeAndEnforceHardRules(updated, {
      allowLargeCentringSpacing: opts?.allowLargeCentringSpacing,
    }).settings;
  }

  /**
   * Auto-Center for one text block: makes the left and right margins equal
   * (their current average, so the block keeps its width and is centred
   * horizontally inside the text frame) and the space above / below equal
   * (their current average). Sets `blockSpacing.autoCentered`.
   *
   * Honest limit: true vertical centring *on the page* is not possible from
   * paragraph spacing alone — pagination places blocks in flow, so a block
   * cannot be pushed to the middle of a page by spacing. Equal space
   * above/below is the achievable behaviour; it is what this does.
   */
  public static autoCenterBlock(
    current: ProfessionalDesignSettings,
    opts?: { unitId?: string; role?: ContentRole | SemanticStyleRole },
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const role = (opts?.role ?? 'main_source') as ContentRole;
    const resolved = this.resolveRoleAndUnitStyle(current, role, opts?.unitId);
    const p = resolved.paragraph;
    const side = Number((((p.leftIndentPt ?? 0) + (p.rightIndentPt ?? 0)) / 2).toFixed(2));
    const vertical = Number((((p.spaceBeforePt ?? 0) + (p.spaceAfterPt ?? 0)) / 2).toFixed(2));
    return this.updateBlockSpacing(
      current,
      {
        marginLeftPt: side,
        marginRightPt: side,
        marginTopPt: vertical,
        marginBottomPt: vertical,
        spaceBeforePt: vertical,
        spaceAfterPt: vertical,
        autoCentered: true,
      },
      opts,
      actor
    );
  }

  /**
   * Auto-Center for the whole text FRAME on the page: makes the top/bottom
   * page margins equal (their current average) and the inside/outside
   * margins equal, so the text frame sits centred in the page frame.
   * The block keeps its size; only the frame moves.
   */
  public static autoCenterPageFrame(
    current: ProfessionalDesignSettings,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const l = current.pageLayout;
    const vertical = Number(((l.marginTopPt + l.marginBottomPt) / 2).toFixed(2));
    const horizontal = Number(((l.marginInsidePt + l.marginOutsidePt) / 2).toFixed(2));
    return this.updatePageLayout(
      current,
      {
        marginTopPt: vertical,
        marginBottomPt: vertical,
        marginInsidePt: horizontal,
        marginOutsidePt: horizontal,
      },
      actor,
      'מרכוז מסגרת הטקסט בעמוד'
    );
  }

  // ── v0.6.0 Part B (Module 5, fixup): margin units + genuine vertical ──
  // centring. v0.5.0's `autoCenterBlock` only averaged the current indents
  // and spacing — and in rav_text / mikraot_gedolot the spacing half is a
  // no-op on screen, because the dynamic-knee solver stacks fixed line
  // heights and never consumes `spaceBeforePt` / `spaceAfterPt` (only the
  // single/two-column and source-top solvers honour them). Genuine vertical
  // centring therefore cannot come from paragraph spacing alone: the block
  // has to be ISOLATED on its own page (a `startsNextPage` break before it
  // and one before the next unit — applied by the caller, in App, where the
  // break instructions live) and pushed down by exactly half the free
  // space. That push IS honoured: the break post-pass re-stacks moved lines
  // from the stream top, honouring the first line's `spaceBeforePt` just
  // like the other solvers do. `computeBlockCentering` is the pure math
  // (testable without a page); `autoCenterBlockOnPage` writes it through
  // the same paragraph styles as `updateBlockSpacing`, so pagination
  // re-runs and the preview updates live.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * The vertical offset that centres a block of `blockHeightPt` inside a
   * text frame of `contentHeightPt`: half the free space on each side.
   * Horizontal centring is equal side indents (their current average, so
   * the block keeps its width). `fitsVertically` is false when the block
   * is as tall as the frame or taller — then no spacing can centre it and
   * the caller must say so instead of faking it.
   */
  public static computeBlockCentering(
    blockHeightPt: number,
    contentHeightPt: number,
    leftIndentPt: number,
    rightIndentPt: number
  ): {
    marginLeftPt: number;
    marginRightPt: number;
    spaceBeforePt: number;
    spaceAfterPt: number;
    verticalOffsetPt: number;
    fitsVertically: boolean;
  } {
    const side = Number((((leftIndentPt ?? 0) + (rightIndentPt ?? 0)) / 2).toFixed(2));
    const fitsVertically = blockHeightPt < contentHeightPt;
    const verticalOffsetPt = fitsVertically
      ? Number((((contentHeightPt - blockHeightPt) / 2)).toFixed(2))
      : 0;
    return {
      marginLeftPt: side,
      marginRightPt: side,
      spaceBeforePt: verticalOffsetPt,
      spaceAfterPt: verticalOffsetPt,
      verticalOffsetPt,
      fitsVertically,
    };
  }

  /**
   * Genuine Auto-Center for one text block ON ITS PAGE: equal side indents
   * (true horizontal centring) plus `spaceBeforePt` = `spaceAfterPt` = half
   * the free vertical space, so the block sits in the middle of the text
   * frame — provided the caller first isolates the block on its own page
   * with break instructions (see the note above). When the block does not
   * fit vertically, only the horizontal centring is applied and
   * `fitsVertically` is false. With `opts.unitId` the values land as a
   * LOCAL override on that block only; without it they land on the role
   * style. Returns the new settings plus whether vertical centring applied.
   */
  public static autoCenterBlockOnPage(
    current: ProfessionalDesignSettings,
    opts: {
      unitId?: string;
      role?: ContentRole | SemanticStyleRole;
      blockHeightPt: number;
      contentHeightPt: number;
    },
    actor: 'user' | 'ai' = 'user'
  ): { settings: ProfessionalDesignSettings; fitsVertically: boolean; verticalOffsetPt: number } {
    const role = (opts?.role ?? 'main_source') as ContentRole;
    const resolved = this.resolveRoleAndUnitStyle(current, role, opts?.unitId);
    const p = resolved.paragraph;
    const centered = this.computeBlockCentering(
      opts.blockHeightPt,
      opts.contentHeightPt,
      p.leftIndentPt ?? 0,
      p.rightIndentPt ?? 0
    );
    const settings = this.updateBlockSpacing(
      current,
      {
        marginLeftPt: centered.marginLeftPt,
        marginRightPt: centered.marginRightPt,
        marginTopPt: centered.spaceBeforePt,
        marginBottomPt: centered.spaceAfterPt,
        spaceBeforePt: centered.spaceBeforePt,
        spaceAfterPt: centered.spaceAfterPt,
        autoCentered: true,
      },
      // The vertical offset is a page-positioning value (half the free
      // space, up to ~600pt), not ordinary paragraph spacing: it must
      // survive the sanitizer's 48pt cap (see sanitizeAndEnforceHardRules).
      { ...opts, allowLargeCentringSpacing: true },
      actor
    );
    return { settings, fitsVertically: centered.fitsVertically, verticalOffsetPt: centered.verticalOffsetPt };
  }

  // ── v0.6.0 Part B: margin unit conversion (pt / mm / in) ──────────────
  // The engine stores everything in points; the panel lets the user type
  // in millimetres or inches and converts both ways. 1pt = 0.352777778mm,
  // 1in = 72pt exactly.
  // ─────────────────────────────────────────────────────────────────────────
  public static readonly MM_PER_PT = 0.352777778;
  public static readonly PT_PER_IN = 72;

  public static marginUnitToPt(value: number, unit: MarginUnit): number {
    if (!Number.isFinite(value)) return 0;
    if (unit === 'mm') return Number((value / DesignSettingsEngine.MM_PER_PT).toFixed(2));
    if (unit === 'in') return Number((value * DesignSettingsEngine.PT_PER_IN).toFixed(2));
    return value;
  }

  public static ptToMarginUnit(pt: number, unit: MarginUnit): number {
    if (!Number.isFinite(pt)) return 0;
    if (unit === 'mm') return Number((pt * DesignSettingsEngine.MM_PER_PT).toFixed(1));
    if (unit === 'in') return Number((pt / DesignSettingsEngine.PT_PER_IN).toFixed(2));
    return pt;
  }

  /** Display step / decimals for a margin input in the given unit. */
  public static marginUnitStep(unit: MarginUnit): { step: number; decimals: number; max: number } {
    if (unit === 'mm') return { step: 0.5, decimals: 1, max: 25.4 };
    if (unit === 'in') return { step: 0.05, decimals: 2, max: 1 };
    return { step: 1, decimals: 0, max: 72 };
  }
  // ── end v0.6.0 Part B (Module 5, fixup) ─────────────────────────────────
  // ── end v0.5.0 Part B (Module 5) ──────────────────────────────────────

  /**
   * Modifies a Project Style (`PROJECT_STYLE`) for a given semantic `ContentRole`.
   * Updates all content using that role unless a local override exists on a specific unit.
   */
  /**
   * v0.9.0 Part C — traditional typography rules, applied by role.
   * Typography ONLY (indentation / alignment / dibbur bold): the one
   * place auto-layout recipes write typographic rules into the settings.
   * - 'second_line_indent': NO first-line indent, a hanging indent on
   *   the second and later rows (the traditional Gemara / Mikraot rule).
   * - 'justify': justified alignment for the role's paragraphs.
   * - 'no_first_line_indent': first-line indent 0, no hanging indent.
   * - 'center_title': centred alignment (chapter / perek / parsha titles).
   * Pure — returns new settings.
   */
  public static applyTypographyRule(
    current: ProfessionalDesignSettings,
    rule: 'second_line_indent' | 'justify' | 'no_first_line_indent' | 'center_title',
    role: ContentRole
  ): ProfessionalDesignSettings {
    const patch: { paragraph?: Partial<import('../types/design-settings').ParagraphStyleSettings> } = {};
    if (rule === 'second_line_indent') {
      patch.paragraph = { firstLineIndentPt: 0, hangingIndentPt: 12 };
    } else if (rule === 'justify') {
      patch.paragraph = { alignment: 'justify' };
    } else if (rule === 'no_first_line_indent') {
      patch.paragraph = { firstLineIndentPt: 0, hangingIndentPt: 0 };
    } else {
      patch.paragraph = { alignment: 'center' };
    }
    return this.updateRoleStyle(current, role, patch, 'ai', `Typography rule: ${rule} (${role})`).settings;
  }

  public static updateRoleStyle(
    current: ProfessionalDesignSettings,
    role: ContentRole,
    updates: {
      character?: Partial<CharacterStyleSettings>;
      paragraph?: Partial<ParagraphStyleSettings>;
    },
    actor: 'user' | 'ai' = 'user',
    summary?: string,
    opts?: { allowLargeCentringSpacing?: boolean }
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    const rolesToSync: SemanticStyleRole[] =
      role === 'main_source' || role === 'regular_paragraph' || (role as SemanticStyleRole) === 'body'
        ? ['main_source', 'regular_paragraph', 'body']
        : [role];

    for (const rKey of rolesToSync) {
      const existing = next.projectRoleStyles[rKey] ?? {};
      next.projectRoleStyles[rKey] = {
        character: {
          ...(existing.character ?? {}),
          ...(updates.character ?? {}),
        },
        paragraph: {
          ...(existing.paragraph ?? {}),
          ...(updates.paragraph ?? {}),
        },
      };
    }

    // Keep top-level domain shortcuts (`ravText`, `footnotes`, `pageLayout`) synchronized with role style updates
    if (role === 'main_source' || role === 'regular_paragraph' || (role as SemanticStyleRole) === 'body') {
      if (updates.character?.fontFamily) {
        next.ravText.sourceFontFamily = updates.character.fontFamily;
      }
      if (role === 'main_source' && updates.character?.fontSizePt !== undefined) {
        next.ravText.sourceFontSizePt = updates.character.fontSizePt;
      }
      if (updates.paragraph?.lineSpacingRatio !== undefined) {
        next.ravText.sourceLineSpacingRatio = updates.paragraph.lineSpacingRatio;
      } else if (updates.paragraph?.leadingPt !== undefined) {
        const effSize =
          updates.character?.fontSizePt ??
          this.resolveRoleAndUnitStyle(current, role).character.fontSizePt;
        next.ravText.sourceLineSpacingRatio = Number(
          (updates.paragraph.leadingPt / Math.max(1, effSize)).toFixed(2)
        );
      }
    } else if (role === 'primary_comment') {
      if (updates.character?.fontFamily) {
        next.ravText.rashiFontFamily = updates.character.fontFamily;
      }
      if (updates.character?.fontSizePt !== undefined) {
        next.ravText.rashiFontSizePt = updates.character.fontSizePt;
      }
      if (updates.paragraph?.lineSpacingRatio !== undefined) {
        next.ravText.commentaryLineSpacingRatio = updates.paragraph.lineSpacingRatio;
      } else if (updates.paragraph?.leadingPt !== undefined) {
        const effSize =
          updates.character?.fontSizePt ?? next.ravText.rashiFontSizePt;
        next.ravText.commentaryLineSpacingRatio = Number(
          (updates.paragraph.leadingPt / Math.max(1, effSize)).toFixed(2)
        );
      }
    } else if (role === 'secondary_comment') {
      if (updates.character?.fontFamily) {
        next.ravText.tosafotFontFamily = updates.character.fontFamily;
      }
      if (updates.character?.fontSizePt !== undefined) {
        next.ravText.tosafotFontSizePt = updates.character.fontSizePt;
      }
      if (updates.paragraph?.lineSpacingRatio !== undefined) {
        next.ravText.commentaryLineSpacingRatio = updates.paragraph.lineSpacingRatio;
      }
    } else if (role === 'footnote') {
      if (updates.character?.fontFamily) {
        next.footnotes.fontFamily = updates.character.fontFamily;
      }
      if (updates.character?.fontSizePt !== undefined) {
        next.footnotes.fontSizePt = updates.character.fontSizePt;
      }
      if (updates.paragraph?.leadingPt !== undefined) {
        next.footnotes.lineSpacingPt = updates.paragraph.leadingPt;
      } else if (updates.paragraph?.lineSpacingRatio !== undefined) {
        const effSize = updates.character?.fontSizePt ?? next.footnotes.fontSizePt;
        next.footnotes.lineSpacingPt = Number(
          (effSize * updates.paragraph.lineSpacingRatio).toFixed(1)
        );
      }
      if (updates.paragraph?.spaceAfterPt !== undefined) {
        next.footnotes.paragraphSpacingPt = updates.paragraph.spaceAfterPt;
      }
      if (updates.paragraph?.alignment !== undefined) {
        next.footnotes.justifyMultiLineFootnotes = updates.paragraph.alignment === 'justify';
      }
    }

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary =
      summary ?? `עדכון סגנון ${GLOBAL_ROLE_STYLES[role]?.displayNameHe ?? role}`;

    return this.sanitizeAndEnforceHardRules(next, opts);
  }

  /**
   * Creates or updates a Local Formatting Override (`LOCAL_OVERRIDE`) on one or more `unitIds`
   * (or a specific `wordRange`) without modifying the parent `PROJECT_STYLE` or `GLOBAL_STYLE`.
   */
  public static applyLocalOverride(
    current: ProfessionalDesignSettings,
    target: {
      unitIds: string[];
      wordRange?: { startWordIndex: number; endWordIndex: number };
    },
    updates: {
      character?: Partial<CharacterStyleSettings>;
      paragraph?: Partial<ParagraphStyleSettings>;
    },
    actor: 'user' | 'ai' = 'user',
    summary?: string,
    opts?: { allowLargeCentringSpacing?: boolean }
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);

    for (const unitId of target.unitIds) {
      const existingIdx = next.localOverrides.findIndex(
        o =>
          o.unitId === unitId &&
          JSON.stringify(o.wordRange ?? null) === JSON.stringify(target.wordRange ?? null)
      );

      if (existingIdx >= 0) {
        const prev = next.localOverrides[existingIdx];
        next.localOverrides[existingIdx] = {
          ...prev,
          characterOverrides: {
            ...(prev.characterOverrides ?? {}),
            ...(updates.character ?? {}),
          },
          paragraphOverrides: {
            ...(prev.paragraphOverrides ?? {}),
            ...(updates.paragraph ?? {}),
          },
          createdAt: Date.now(),
          sourceActor: actor,
        };
      } else {
        next.localOverrides.push({
          id: `loc-fmt-${unitId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          unitId,
          wordRange: target.wordRange ? { ...target.wordRange } : undefined,
          characterOverrides: updates.character ? { ...updates.character } : undefined,
          paragraphOverrides: updates.paragraph ? { ...updates.paragraph } : undefined,
          createdAt: Date.now(),
          sourceActor: actor,
        });
      }
    }

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary =
      summary ?? `דריסת עיצוב מקומית (${target.unitIds.join(', ')})`;

    return this.sanitizeAndEnforceHardRules(next, opts);
  }

  /**
   * Removes local formatting overrides for specific `unitIds` (or all units if omitted),
   * resetting them cleanly to their parent `PROJECT_STYLE` / `GLOBAL_STYLE`.
   */
  public static clearLocalOverrides(
    current: ProfessionalDesignSettings,
    unitIds?: string[],
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    if (!unitIds || unitIds.length === 0) {
      next.localOverrides = [];
    } else {
      const idSet = new Set(unitIds);
      next.localOverrides = next.localOverrides.filter(o => !idSet.has(o.unitId));
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = 'איפוס דריסות מקומיות לסגנון האב';
    return this.syncDerivedViews(next);
  }

  /**
   * Resets a role's `PROJECT_STYLE` back to its canonical `GLOBAL_STYLE` (optionally preserving or clearing local overrides).
   */
  public static resetRoleStyleToGlobal(
    current: ProfessionalDesignSettings,
    role: ContentRole,
    clearRoleLocalOverrides: boolean = false,
    units: ContentUnit[] = []
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    delete next.projectRoleStyles[role];

    const globalStyle = this.getGlobalRoleStyle(role);
    if (role === 'main_source') {
      next.ravText.sourceFontFamily = globalStyle.character.fontFamily;
      next.ravText.sourceFontSizePt = globalStyle.character.fontSizePt;
      next.ravText.sourceLineSpacingRatio = globalStyle.paragraph.lineSpacingRatio;
    } else if (role === 'primary_comment') {
      next.ravText.rashiFontFamily = globalStyle.character.fontFamily;
      next.ravText.rashiFontSizePt = globalStyle.character.fontSizePt;
      next.ravText.commentaryLineSpacingRatio = globalStyle.paragraph.lineSpacingRatio;
    } else if (role === 'secondary_comment') {
      next.ravText.tosafotFontFamily = globalStyle.character.fontFamily;
      next.ravText.tosafotFontSizePt = globalStyle.character.fontSizePt;
    } else if (role === 'footnote') {
      next.footnotes.fontFamily = globalStyle.character.fontFamily;
      next.footnotes.fontSizePt = globalStyle.character.fontSizePt;
      next.footnotes.lineSpacingPt = globalStyle.paragraph.leadingPt;
    }

    if (clearRoleLocalOverrides && units.length > 0) {
      const roleUnitIds = new Set(units.filter(u => u.role === role).map(u => u.id));
      next.localOverrides = next.localOverrides.filter(o => !roleUnitIds.has(o.unitId));
    }

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = 'user';
    next.lastModificationSummary = `איפוס סגנון ${globalStyle.displayNameHe} לברירת מחדל גלובלית`;
    return this.syncDerivedViews(next);
  }

  /**
   * Updates Page & Layout settings (`PageLayoutDesignSettings`) and enforces Level 0 boundary laws.
   */
  public static updatePageLayout(
    current: ProfessionalDesignSettings,
    updates: Partial<PageLayoutDesignSettings>,
    actor: 'user' | 'ai' = 'user',
    summary?: string
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    next.pageLayout = {
      ...next.pageLayout,
      ...updates,
    };
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = summary ?? 'עדכון הגדרות עמוד ושוליים';
    return this.sanitizeAndEnforceHardRules(next);
  }

  // ==========================================================================
  // v0.5.0 Part C — Module 3 (Custom Layout Designer) — engine methods.
  // --- BEGIN Part C engine methods (single delimited section) ---------------
  // Every method clones, mutates the clone, and returns the sanitized
  // result, exactly like the other update* methods in this class. Boxes are
  // stored on `pageLayout.customLayout`; per-page tweaks live in
  // `customLayout.pageOverrides` and never touch the global box flow.
  // ==========================================================================

  /**
   * Replaces/merges the custom-layout design. Changing `baseLayout` without
   * passing `boxes` resets the boxes to that base's defaults, so the page
   * never ends up with boxes drawn for a different layout.
   */
  public static setCustomLayout(
    current: ProfessionalDesignSettings,
    patch: Partial<CustomLayoutDesign>,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    const prev = next.pageLayout.customLayout ?? defaultCustomLayoutDesign('rav_text');
    const baseChanged = patch.baseLayout !== undefined && patch.baseLayout !== prev.baseLayout;
    const merged: CustomLayoutDesign = {
      ...prev,
      ...patch,
      baseLayout: patch.baseLayout ?? prev.baseLayout,
      boxes:
        patch.boxes ??
        (baseChanged
          ? defaultCustomLayoutDesign(patch.baseLayout ?? prev.baseLayout).boxes
          : prev.boxes),
      pageOverrides: patch.pageOverrides ?? prev.pageOverrides ?? {},
      gridSizePt: patch.gridSizePt ?? prev.gridSizePt ?? 6,
    };
    next.pageLayout.customLayout = merged;
    if (patch.enabled !== undefined) next.pageLayout.customLayout.enabled = patch.enabled;
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = 'עדכון פריסה מותאמת אישית';
    return this.sanitizeAndEnforceHardRules(next);
  }

  /** Adds one box (id generated when missing) to the custom layout. */
  public static addCustomLayoutBox(
    current: ProfessionalDesignSettings,
    box: CustomLayoutBox,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    if (!next.pageLayout.customLayout) {
      next.pageLayout.customLayout = defaultCustomLayoutDesign(
        next.layoutType === 'custom_layout' ? 'rav_text' : next.layoutType
      );
    }
    const clean: CustomLayoutBox = {
      ...box,
      id:
        box.id ||
        `box-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    };
    next.pageLayout.customLayout.boxes = [
      ...next.pageLayout.customLayout.boxes,
      clean,
    ];
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = `נוספה תיבה (${clean.labelHe ?? clean.role}) לפריסה המותאמת`;
    return this.sanitizeAndEnforceHardRules(next);
  }

  /**
   * Updates one box in place (move / resize / role change). When the id is
   * unknown the box is ADDED instead of dropped, so an AI action that
   * invents an id still lands visibly instead of vanishing silently.
   */
  public static updateCustomLayoutBox(
    current: ProfessionalDesignSettings,
    box: CustomLayoutBox,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    if (!next.pageLayout.customLayout) {
      next.pageLayout.customLayout = defaultCustomLayoutDesign(
        next.layoutType === 'custom_layout' ? 'rav_text' : next.layoutType
      );
    }
    const boxes = next.pageLayout.customLayout.boxes;
    const idx = boxes.findIndex(b => b.id === box.id);
    if (idx === -1) {
      return this.addCustomLayoutBox(current, box, actor);
    }
    next.pageLayout.customLayout.boxes = [
      ...boxes.slice(0, idx),
      { ...boxes[idx], ...box, id: boxes[idx].id },
      ...boxes.slice(idx + 1),
    ];
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = `עודכנה תיבה (${box.labelHe ?? box.role}) בפריסה המותאמת`;
    return this.sanitizeAndEnforceHardRules(next);
  }

  /** Removes one box by id. No-op (with a warning) when the id is unknown. */
  public static removeCustomLayoutBox(
    current: ProfessionalDesignSettings,
    boxId: string,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    const boxes = next.pageLayout.customLayout?.boxes ?? [];
    if (!boxes.some(b => b.id === boxId)) {
      return {
        clampedByEngineHardRule: false,
        warnings: [`תיבה לא נמצאה בפריסה המותאמת: ${boxId}`],
        settings: next,
      };
    }
    next.pageLayout.customLayout = {
      ...next.pageLayout.customLayout!,
      boxes: boxes.filter(b => b.id !== boxId),
    };
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = 'הוסרה תיבה מהפריסה המותאמת';
    return this.sanitizeAndEnforceHardRules(next);
  }

  /** Applies a saved template's boxes (and base layout) to the project. */
  public static applyCustomLayoutTemplate(
    current: ProfessionalDesignSettings,
    template: CustomLayoutTemplate,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    next.pageLayout.customLayout = {
      enabled: true,
      baseLayout: template.baseLayout,
      boxes: template.boxes.map(b => ({ ...b })),
      activeTemplateId: template.id,
      gridSizePt: next.pageLayout.customLayout?.gridSizePt ?? 6,
      pageOverrides: {},
    };
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = `הופעלה תבנית פריסה מותאמת: ${template.nameHe}`;
    return this.sanitizeAndEnforceHardRules(next);
  }

  /** Stores a per-page box tweak (pageIndex is 0-based). */
  public static setCustomLayoutPageOverride(
    current: ProfessionalDesignSettings,
    pageIndex: number,
    boxes: CustomLayoutBox[],
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    if (!next.pageLayout.customLayout) {
      next.pageLayout.customLayout = defaultCustomLayoutDesign(
        next.layoutType === 'custom_layout' ? 'rav_text' : next.layoutType
      );
    }
    next.pageLayout.customLayout.pageOverrides = {
      ...next.pageLayout.customLayout.pageOverrides,
      [String(Math.max(0, Math.floor(pageIndex)))]: boxes.map(b => ({ ...b })),
    };
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = `עודכנה פריסה מותאמת לדף ${pageIndex + 1}`;
    return this.sanitizeAndEnforceHardRules(next);
  }

  /** Clears a per-page tweak so the page follows the global boxes again. */
  public static clearCustomLayoutPageOverride(
    current: ProfessionalDesignSettings,
    pageIndex: number,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    if (next.pageLayout.customLayout) {
      const overrides = { ...next.pageLayout.customLayout.pageOverrides };
      delete overrides[String(pageIndex)];
      next.pageLayout.customLayout.pageOverrides = overrides;
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = `בוטלה התאמת פריסה לדף ${pageIndex + 1}`;
    return this.sanitizeAndEnforceHardRules(next);
  }

  /**
   * v0.8.0 Part C (§8): clears ALL per-page custom-layout overrides at
   * once. Used by the layout-switch transaction — a per-page override is
   * bound to a page index whose content changes meaning when the layout
   * (and therefore the pagination) changes, so no per-page override
   * survives a preset switch. The global box template is untouched.
   */
  public static clearAllCustomLayoutPageOverrides(
    current: ProfessionalDesignSettings,
    actor: 'user' | 'ai' = 'user'
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    if (next.pageLayout.customLayout) {
      next.pageLayout.customLayout.pageOverrides = {};
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = 'בוטלו כל התאמות הפריסה לדפים (מעבר תבנית)';
    return this.sanitizeAndEnforceHardRules(next);
  }

  // --- END Part C engine methods -------------------------------------------

  /**
   * Updates Rav Text & Dynamic Knee design settings (`RavTextDesignSettings`).
   */
  public static updateRavTextSettings(
    current: ProfessionalDesignSettings,
    updates: Partial<RavTextDesignSettings>,
    actor: 'user' | 'ai' = 'user',
    summary?: string
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    if (updates.dibburBold !== undefined && updates.dibburHamatchilBold === undefined) {
      updates.dibburHamatchilBold = updates.dibburBold;
    }
    if (updates.kneeSettings) {
      updates.kneeMode = updates.kneeSettings.mode;
      if (updates.kneeSettings.upperKneeLines !== undefined) {
        updates.upperCollarLines = updates.kneeSettings.upperKneeLines;
      }
      if (updates.kneeSettings.junctionPercent !== undefined) {
        updates.kneeJunctionPercent = updates.kneeSettings.junctionPercent;
      }
      if (updates.kneeSettings.lowerWidthPercent !== undefined) {
        updates.lowerSourceWidthPercent = updates.kneeSettings.lowerWidthPercent;
      }
      if (updates.kneeSettings.gutterWidth !== undefined) {
        updates.gutterWidthPt = updates.kneeSettings.gutterWidth;
      }
    }
    next.ravText = {
      ...next.ravText,
      ...updates,
    };

    // Keep projectRoleStyles synchronized if fonts or sizes were updated via RavText panel
    if (updates.sourceFontFamily !== undefined || updates.sourceFontSizePt !== undefined || updates.sourceLineSpacingRatio !== undefined) {
      const srcEntry = next.projectRoleStyles.main_source ?? {};
      next.projectRoleStyles.main_source = {
        character: {
          ...(srcEntry.character ?? {}),
          ...(updates.sourceFontFamily !== undefined ? { fontFamily: updates.sourceFontFamily } : {}),
          ...(updates.sourceFontSizePt !== undefined ? { fontSizePt: updates.sourceFontSizePt } : {}),
        },
        paragraph: {
          ...(srcEntry.paragraph ?? {}),
          ...(updates.sourceLineSpacingRatio !== undefined
            ? { lineSpacingRatio: updates.sourceLineSpacingRatio }
            : {}),
        },
      };
    }

    if (updates.rashiFontFamily !== undefined || updates.rashiFontSizePt !== undefined || updates.commentaryLineSpacingRatio !== undefined) {
      const rEntry = next.projectRoleStyles.primary_comment ?? {};
      next.projectRoleStyles.primary_comment = {
        character: {
          ...(rEntry.character ?? {}),
          ...(updates.rashiFontFamily !== undefined ? { fontFamily: updates.rashiFontFamily } : {}),
          ...(updates.rashiFontSizePt !== undefined ? { fontSizePt: updates.rashiFontSizePt } : {}),
        },
        paragraph: {
          ...(rEntry.paragraph ?? {}),
          ...(updates.commentaryLineSpacingRatio !== undefined
            ? { lineSpacingRatio: updates.commentaryLineSpacingRatio }
            : {}),
        },
      };
    }

    if (updates.tosafotFontFamily !== undefined || updates.tosafotFontSizePt !== undefined || updates.commentaryLineSpacingRatio !== undefined) {
      const tEntry = next.projectRoleStyles.secondary_comment ?? {};
      next.projectRoleStyles.secondary_comment = {
        character: {
          ...(tEntry.character ?? {}),
          ...(updates.tosafotFontFamily !== undefined ? { fontFamily: updates.tosafotFontFamily } : {}),
          ...(updates.tosafotFontSizePt !== undefined ? { fontSizePt: updates.tosafotFontSizePt } : {}),
        },
        paragraph: {
          ...(tEntry.paragraph ?? {}),
          ...(updates.commentaryLineSpacingRatio !== undefined
            ? { lineSpacingRatio: updates.commentaryLineSpacingRatio }
            : {}),
        },
      };
    }

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = summary ?? 'עדכון הגדרות רב-טקסט וברכיים';
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  /**
   * Updates Footnote design settings (`FootnoteDesignSettings`).
   */
  public static updateFootnoteSettings(
    current: ProfessionalDesignSettings,
    updates: Partial<FootnoteDesignSettings>,
    actor: 'user' | 'ai' = 'user',
    summary?: string
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    if (updates.leadingPt !== undefined && updates.lineSpacingPt === undefined) {
      updates.lineSpacingPt = updates.leadingPt;
    }
    if (updates.showSeparatorLine !== undefined && updates.showSeparatorRule === undefined) {
      updates.showSeparatorRule = updates.showSeparatorLine;
    }
    if (updates.justifyMultiLineNonFinal !== undefined && updates.justifyMultiLineFootnotes === undefined) {
      updates.justifyMultiLineFootnotes = updates.justifyMultiLineNonFinal;
    }
    next.footnotes = {
      ...next.footnotes,
      ...updates,
    };

    const fnEntry = next.projectRoleStyles.footnote ?? {};
    next.projectRoleStyles.footnote = {
      character: {
        ...(fnEntry.character ?? {}),
        ...(updates.fontFamily !== undefined ? { fontFamily: updates.fontFamily } : {}),
        ...(updates.fontSizePt !== undefined ? { fontSizePt: updates.fontSizePt } : {}),
      },
      paragraph: {
        ...(fnEntry.paragraph ?? {}),
        ...(updates.lineSpacingPt !== undefined ? { leadingPt: updates.lineSpacingPt } : {}),
        ...(updates.paragraphSpacingPt !== undefined
          ? { spaceAfterPt: updates.paragraphSpacingPt }
          : {}),
        ...(updates.indentPt !== undefined ? { rightIndentPt: updates.indentPt } : {}),
        ...(updates.justifyMultiLineFootnotes !== undefined
          ? {
              justifyNonFinalLines: updates.justifyMultiLineFootnotes,
              alignment: updates.justifyMultiLineFootnotes ? 'justify' : 'right',
            }
          : {}),
      },
    };

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = summary ?? 'עדכון עיצוב הערות שוליים';
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  /**
   * Converts `ProfessionalDesignSettings` into the `PageGeometry` and `KneeCustomSettings`
   * structures consumed by `PaginationEngine` and `DynamicKneeEngine`.
   */
  public static toEngineGeometryAndKnee(settings: ProfessionalDesignSettings): {
    geometry: PageGeometry;
    kneeSettings: KneeCustomSettings;
  } {
    const pl = settings.pageLayout;
    const rt = settings.ravText;
    return {
      geometry: {
        pageWidth: pl.pageWidthPt,
        pageHeight: pl.pageHeightPt,
        marginTop: pl.marginTopPt,
        marginBottom: pl.marginBottomPt,
        marginInside: pl.marginInsidePt,
        marginOutside: pl.marginOutsidePt,
        isVerso: false,
      },
      kneeSettings: {
        mode: rt.kneeMode,
        upperKneeLines: rt.upperCollarLines,
        upperKneeInwardStep: rt.upperCollarInwardStepPt,
        junctionPercent: rt.kneeJunctionPercent,
        lowerWidthPercent: rt.lowerSourceWidthPercent,
        stepDirection: rt.kneeStepDirection,
        gutterWidth: rt.gutterWidthPt,
      },
    };
  }

  /**
   * Synchronizes `ProfessionalDesignSettings` paragraph flow, Rav Text, and Footnote settings
   * into the `TypesettingRulesConfig` consumed by `PaginationEngine` and `DynamicKneeEngine`.
   */
  public static syncToTypesettingRulesConfig(
    settings: ProfessionalDesignSettings,
    baseConfig?: TypesettingRulesConfig
  ): TypesettingRulesConfig {
    const base = baseConfig ?? TypesettingRulesEngine.createConfig();
    const config: TypesettingRulesConfig = {
      professionalDefaults: TypesettingRulesEngine.getProfessionalDefaults(),
      userRules: {
        rules: Array.isArray(base.userRules?.rules) ? [...base.userRules.rules] : [],
        updatedAt: base.userRules?.updatedAt,
      },
      projectRules: {
        projectId: base.projectRules?.projectId ?? settings.projectId,
        rules: Array.isArray(base.projectRules?.rules) ? [...base.projectRules.rules] : [],
        updatedAt: settings.updatedAt || Date.now(),
      },
      localOverrides: {
        overrides: Array.isArray(base.localOverrides?.overrides)
          ? [...base.localOverrides.overrides]
          : [],
      },
    };

    const upsertProjectRule = (
      ruleId: TypesettingRuleId,
      category: TypesettingRuleCategory,
      value: boolean | number | string,
      description: string
    ) => {
      const id = `design-sync-${ruleId}`;
      const existingCustomRule = config.projectRules.rules.find(
        r => r.ruleId === ruleId && r.id !== id
      );
      if (existingCustomRule) {
        // Respect explicit project rule set via Stage 12 Rules Engine
        return;
      }
      const filtered = config.projectRules.rules.filter(r => r.id !== id);
      filtered.push({
        id,
        ruleId,
        category,
        enabled: true,
        priority: 'PROFESSIONAL_DEFAULT',
        isHardConstraint: false,
        value,
        source: 'project',
        description,
      });
      config.projectRules.rules = filtered;
    };

    const mainPara =
      settings.roleStyles?.main_source?.paragraph ??
      this.resolveRoleAndUnitStyle(settings, 'main_source').paragraph;
    const chapPara =
      settings.roleStyles?.chapter?.paragraph ??
      this.resolveRoleAndUnitStyle(settings, 'chapter').paragraph;

    upsertProjectRule(
      'paragraph.preventWidows',
      'paragraph',
      Boolean(mainPara.preventWidows),
      'מניעת שורות אלמנות מהגדרות עיצוב וטיפוגרפיה'
    );
    upsertProjectRule(
      'paragraph.preventOrphans',
      'paragraph',
      Boolean(mainPara.preventOrphans),
      'מניעת שורות יתומות מהגדרות עיצוב וטיפוגרפיה'
    );
    upsertProjectRule(
      'paragraph.minWidowLines',
      'paragraph',
      Math.max(1, mainPara.minWidowLines ?? 2),
      'מספר שורות מינימלי למניעת אלמנה'
    );
    upsertProjectRule(
      'paragraph.minOrphanLines',
      'paragraph',
      Math.max(1, mainPara.minOrphanLines ?? 2),
      'מספר שורות מינימלי למניעת יתום'
    );
    upsertProjectRule(
      'paragraph.minFinalLineWords',
      'paragraph',
      Math.max(1, mainPara.minFinalLineWords ?? 2),
      'מספר מילים מינימלי בשורת סיום פסקה'
    );
    upsertProjectRule(
      'headings.keepWithNext',
      'headings',
      Boolean(chapPara.keepWithNext || (chapPara.keepWithNextLines ?? 0) > 0),
      'שמירת כותרת עם שורות ההמשך'
    );
    upsertProjectRule(
      'headings.minFollowingLines',
      'headings',
      Math.max(1, chapPara.keepWithNextLines || chapPara.minFollowingLines || 1),
      'מספר שורות המשך מינימלי אחרי כותרת'
    );
    upsertProjectRule(
      'ravText.defaultGutterWidthPt',
      'rav_text',
      Math.max(8, settings.ravText.gutterWidthPt ?? 11),
      'מרווח רב-טקסט (Gutter)'
    );
    upsertProjectRule(
      'lineQuality.minReadableSourceWidthPt',
      'line_quality',
      Math.max(135, settings.ravText.minSourceWidthPt ?? 135),
      'רוחב מקור מינימלי קריא'
    );
    upsertProjectRule(
      'lineQuality.minReadableCommentaryWidthPt',
      'line_quality',
      Math.max(78, settings.ravText.minCommentaryWidthPt ?? 78),
      'רוחב פירוש מינימלי קריא'
    );
    upsertProjectRule(
      'footnotes.justifyMultiLineNonFinal',
      'footnotes',
      Boolean(settings.footnotes.justifyMultiLineFootnotes),
      'יישור דו-צדדי להערות שוליים מרובות שורות'
    );

    return config;
  }

  /**
   * AI Natural-Language Controller:
   * Parses natural-language design & typesetting commands (English & Hebrew) and modifies
   * the exact same `ProfessionalDesignSettings` model used by the UI panel.
   *
   * Supports relative commands ("Make it slightly smaller", "Increase line spacing slightly",
   * "Make the footnotes 1 point smaller") by reading the CURRENT live values in `current`
   * (including any prior manual user changes in the panel!).
   */
  public static applyNaturalLanguageCommand(
    current: ProfessionalDesignSettings,
    instruction: string,
    actor: 'user' | 'ai' = 'ai',
    selectedUnitId?: string
  ): AiDesignCommandResult {
    const lower = instruction.trim().toLowerCase();

    // Check for compound instructions or specific width clamp requests first
    if (
      (lower.includes('רוחב מקור') || lower.includes('source width')) &&
      /\d+/.test(lower)
    ) {
      const m = instruction.match(/(\d+(?:\.\d+)?)/);
      const val = m ? Number(m[1]) : 135;
      const updated = this.updateRavTextSettings(
        current,
        { minSourceWidthPt: val },
        actor,
        `${actor.toUpperCase()}: עדכון רוחב מקור מינימלי`
      );
      return {
        handled: true,
        matched: true,
        summaryHe: `רוחב מקור מינימלי עודכן ל-${updated.ravText.minSourceWidthPt}pt (כפוף לחוק מנוע קשיח Level 0).`,
        summaryEn: `Updated minimum source width to ${updated.ravText.minSourceWidthPt}pt.`,
        updatedSettings: updated,
        clampedByEngineHardRule: updated.ravText.minSourceWidthPt !== val,
        warnings: [],
        requiresPreviewConfirmation: false,
      };
    }

    // Support compound commands joined by "ו" / "and" (e.g. "הגדל את גופן רש״י ל-12pt ומרכז כותרות פרקים")
    if (
      (lower.includes('רש״י') || lower.includes('רשי') || lower.includes('rashi')) &&
      (lower.includes('מרכז') || lower.includes('center')) &&
      (lower.includes('כותרות') || lower.includes('פרק') || lower.includes('chapter'))
    ) {
      const m = instruction.match(/(\d+(?:\.\d+)?)/);
      const rashiSize = m ? Number(m[1]) : 12;
      let step1 = this.updateRoleCharacterStyle(
        current,
        'primary_comment',
        { fontSizePt: rashiSize },
        actor
      );
      let step2 = this.updateRoleParagraphStyle(
        step1,
        'chapter',
        { alignment: 'center', lastLineAlignment: 'center' },
        actor
      );
      step2.lastModifiedBy = actor;
      return {
        handled: true,
        matched: true,
        summaryHe: `גופן רש״י עודכן ל-${rashiSize}pt וכותרות הפרקים ממורכזות.`,
        summaryEn: `Updated Rashi font size to ${rashiSize}pt and centered chapter headings.`,
        updatedSettings: step2,
        clampedByEngineHardRule: false,
        warnings: [],
        requiresPreviewConfirmation: false,
      };
    }

    // Support multi-clause commands separated by commas or "and" / "ו-"
    const clauses = instruction
      .split(/(?:,\s*and\s+|,\s*|\s+and\s+)/i)
      .map(c => c.trim())
      .filter(Boolean);
    if (clauses.length > 1) {
      let working = current;
      let anyHandled = false;
      let anyClamped = false;
      const summariesHe: string[] = [];
      const summariesEn: string[] = [];
      const allWarnings: string[] = [];

      for (const clause of clauses) {
        const subRes = this.applyAiDesignCommand(working, clause, 'main_source');
        if (subRes.handled) {
          anyHandled = true;
          working = subRes.updatedSettings;
          if (subRes.clampedByEngineHardRule) anyClamped = true;
          summariesHe.push(subRes.summaryHe);
          summariesEn.push(subRes.summaryEn);
          allWarnings.push(...subRes.warnings);
        }
      }

      if (anyHandled) {
        working.lastModifiedBy = actor;
        this.syncDerivedViews(working);
        return {
          handled: true,
          matched: true,
          summaryHe: summariesHe.join(' | '),
          summaryEn: summariesEn.join(' | '),
          updatedSettings: working,
          clampedByEngineHardRule: anyClamped,
          warnings: allWarnings,
          requiresPreviewConfirmation: clauses.length >= 2,
        };
      }
    }

    const res = this.applyAiDesignCommand(current, instruction, 'main_source');
    if (res.handled) {
      res.updatedSettings.lastModifiedBy = actor;
      this.syncDerivedViews(res.updatedSettings);
    }
    return {
      ...res,
      matched: res.handled,
    };
  }

  public static applyAiDesignCommand(
    current: ProfessionalDesignSettings,
    instruction: string,
    activeRoleContext: ContentRole = 'regular_paragraph'
  ): AiDesignCommandResult {
    const text = instruction.trim();
    const lower = text.toLowerCase();

    // Detect if the user or AI is attempting to invent/auto-add ornaments without explicit user asset
    if (
      (lower.includes('ornament') || lower.includes('עיטור') || lower.includes('decorative')) &&
      (lower.includes('auto') ||
        lower.includes('invent') ||
        lower.includes('add') ||
        lower.includes('הוסף') ||
        lower.includes('אוטומט'))
    ) {
      return {
        handled: true,
        matched: true,
        summaryHe:
          'נחסם ע״י חוק מנוע קשיח (LEVEL 0 — Stage 11D): המערכת אינה ממציאה או מוסיפה עיטורים אוטומטית ללא בחירת קובץ עיטור מפורשת ע״י המשתמש.',
        summaryEn:
          'Blocked by Level 0 Engine Hard Rule (Stage 11D): Unauthorized automatic ornament invention is forbidden.',
        updatedSettings: this.cloneSettings(current),
        clampedByEngineHardRule: true,
        warnings: [
          'חוק מנוע קשיח (LEVEL 0 — ORNAMENT_SAFETY): לעולם אין להמציא או לבחור עיטור אוטומטית ללא בחירת משתמש.',
        ],
        requiresPreviewConfirmation: false,
      };
    }

    // --- v0.5.0 Part C — Module 3 (Custom Layout Designer) -----------------
    // "custom layout" / "פריסה מותאמת" switches the book to the custom
    // layout (rav_text base + default boxes); "apply template <name>" /
    // "הפעל תבנית <שם>" applies a saved template by name. Anything else
    // falls through to the normal command handling below.
    // --- BEGIN Part C NL command ---
    if (
      lower.includes('custom layout') ||
      lower.includes('פריסה מותאמת') ||
      lower.includes('עיצוב מותאם אישית') ||
      lower.includes('תבנית מותאמת')
    ) {
      const templateNameMatch = instruction.match(
        /(?:apply template|הפעל תבנית|החל תבנית)\s+(.+)/i
      );
      if (templateNameMatch) {
        const template = findCustomLayoutTemplateByName(
          templateNameMatch[1].trim().replace(/["״׳']/g, '')
        );
        if (template) {
          // applyAiDesignCommand has no `actor` parameter (it IS the AI
          // path), so the template is applied as 'ai' here.
          const updated = this.applyCustomLayoutTemplate(current, template, 'ai').settings;
          return {
            handled: true,
            matched: true,
            summaryHe: `תבנית פריסה מותאמת הופעלה: ${template.nameHe}`,
            summaryEn: `Custom layout template applied: ${template.nameEn}`,
            updatedSettings: updated,
            clampedByEngineHardRule: false,
            warnings: [],
            requiresPreviewConfirmation: true,
          };
        }
        return {
          handled: true,
          matched: true,
          summaryHe: `לא נמצאה תבנית פריסה בשם "${templateNameMatch[1].trim()}".`,
          summaryEn: `No custom layout template named "${templateNameMatch[1].trim()}" was found.`,
          updatedSettings: this.cloneSettings(current),
          clampedByEngineHardRule: false,
          warnings: [`תבנית לא נמצאה: ${templateNameMatch[1].trim()}`],
          requiresPreviewConfirmation: false,
        };
      }
      const base: BookLayoutType =
        lower.includes('single') || lower.includes('טור יחיד')
          ? 'single_column'
          : lower.includes('two') || lower.includes('שני טורים')
          ? 'two_column'
          : 'rav_text';
      const updated = this.setCustomLayout(
        this.updateLayoutSettings(current, { layoutType: 'custom_layout' }, 'ai'),
        { enabled: true, baseLayout: base },
        'ai'
      ).settings;
      return {
        handled: true,
        matched: true,
        summaryHe: `הספר הועבר לפריסה מותאמת אישית (בסיס: ${base}). ניתן לגרור את התיבות בעורך הפריסה.`,
        summaryEn: `Switched the book to a custom layout (base: ${base}). Drag the boxes in the layout editor to arrange them.`,
        updatedSettings: updated,
        clampedByEngineHardRule: false,
        warnings: [],
        requiresPreviewConfirmation: true,
      };
    }
    // --- END Part C NL command ---

    // Identify target role from instruction
    let targetRole: ContentRole | null = null;
    if (lower.includes('body') || lower.includes('גוף') || lower.includes('פסקה')) {
      targetRole = 'regular_paragraph';
    } else if (
      lower.includes('source') ||
      lower.includes('גמרא') ||
      lower.includes('מקור')
    ) {
      targetRole = 'main_source';
    } else if (
      lower.includes('chapter') ||
      lower.includes('heading') ||
      lower.includes('title') ||
      lower.includes('כותרת') ||
      lower.includes('פרק')
    ) {
      targetRole = 'chapter';
    } else if (
      lower.includes('footnote') ||
      lower.includes('הערות שוליים') ||
      lower.includes('הערת שוליים')
    ) {
      targetRole = 'footnote';
    } else if (
      lower.includes('rashi') ||
      lower.includes('commentary') ||
      lower.includes('רש״י') ||
      lower.includes('רשי') ||
      lower.includes('פירוש') ||
      lower.includes('מפרשים')
    ) {
      targetRole = 'primary_comment';
    } else if (lower.includes('tosafot') || lower.includes('תוספות')) {
      targetRole = 'secondary_comment';
    } else if (lower.includes('dibbur') || lower.includes('דיבור המתחיל')) {
      targetRole = 'dibbur_hamatchil';
    }

    const effectiveRole: ContentRole =
      targetRole ??
      (current.projectRoleStyles.regular_paragraph
        ? 'regular_paragraph'
        : activeRoleContext);

    const currentRoleResolved = this.resolveRoleAndUnitStyle(current, effectiveRole);

    // Extract numeric value if present. v0.4.0 part 3 — a hyphen after a
    // Hebrew prefix letter is NOT a minus sign: "ל-15.5pt" means "to
    // 15.5pt", but the old /(-?\d+)/ read it as -15.5, so the app's own
    // first quick prompt ("הגדל את גופן המקור ל-15.5pt") set the source
    // font to -15.5pt, clamped to 6.5pt. Strip a hyphen between a Hebrew
    // letter and a digit before parsing. (This also fixes the old
    // "הגדל מרווח שורות ברש״י ל-14pt → ratio 1.05" quirk: -14pt used to
    // fall through the leading branch as a negative ratio; 14pt now
    // correctly gives 14/10.5 ≈ 1.33.)
    const numMatch = text.replace(/([א-ת])-(?=\d)/g, '$1').match(/(-?\d+(?:\.\d+)?)/);
    const parsedNum = numMatch ? Number(numMatch[1]) : undefined;

    // 1. Font Family changes (e.g., "Use Frank Ruhl Libre for the commentary", "Use David Libre for body")
    for (const fontEntry of KNOWN_HOLY_BOOK_FONTS) {
      if (lower.includes(fontEntry.family.toLowerCase())) {
        const roleToUpdate = targetRole ?? 'primary_comment';
        const report = this.updateRoleStyle(
          current,
          roleToUpdate,
          { character: { fontFamily: fontEntry.family } },
          'ai',
          `AI: שינוי גופן ${GLOBAL_ROLE_STYLES[roleToUpdate].displayNameHe} ל-${fontEntry.family}`
        );
        return {
          handled: true,
          matched: true,
          summaryHe: `הגופן של ${GLOBAL_ROLE_STYLES[roleToUpdate].displayNameHe} עודכן ל-"${fontEntry.family}".`,
          summaryEn: `Updated ${roleToUpdate} font family to "${fontEntry.family}".`,
          updatedSettings: report.settings,
          clampedByEngineHardRule: report.clampedByEngineHardRule,
          warnings: report.warnings,
          requiresPreviewConfirmation: false,
        };
      }
    }

    // 2. Column Gutter / Rav Text Gutter changes ("Reduce the gutter between the two columns", "צמצם רווח עמודות")
    if (lower.includes('gutter') || lower.includes('בין הטורים') || lower.includes('מרווח עמודות') || lower.includes('רווח בין')) {
      if (lower.includes('two column') || lower.includes('שני טורים') || lower.includes('columns')) {
        const nextGutter =
          parsedNum !== undefined
            ? parsedNum
            : lower.includes('reduce') || lower.includes('צמצם') || lower.includes('smaller')
            ? Math.max(6, current.pageLayout.columnGutterPt - 2)
            : current.pageLayout.columnGutterPt + 2;
        const report = this.updatePageLayout(
          current,
          { columnGutterPt: nextGutter },
          'ai',
          `AI: עדכון מרווח בין שני הטורים ל-${nextGutter}pt`
        );
        return {
          handled: true,
          matched: true,
          summaryHe: `המרווח בין הטורים עודכן ל-${report.settings.pageLayout.columnGutterPt}pt.`,
          summaryEn: `Updated column gutter to ${report.settings.pageLayout.columnGutterPt}pt.`,
          updatedSettings: report.settings,
          clampedByEngineHardRule: report.clampedByEngineHardRule,
          warnings: report.warnings,
          requiresPreviewConfirmation: false,
        };
      } else {
        const nextRavGutter =
          parsedNum !== undefined
            ? parsedNum
            : lower.includes('reduce') || lower.includes('צמצם') || lower.includes('smaller')
            ? Math.max(8, current.ravText.gutterWidthPt - 1.5)
            : current.ravText.gutterWidthPt + 1.5;
        const updated = this.updateRavTextSettings(
          current,
          { gutterWidthPt: nextRavGutter },
          'ai',
          `AI: עדכון מרווח רב-טקסט ל-${nextRavGutter}pt`
        );
        return {
          handled: true,
          matched: true,
          summaryHe: `המרווח בין המקור למפרשים (Gutter) עודכן ל-${updated.ravText.gutterWidthPt}pt.`,
          summaryEn: `Updated Rav Text gutter to ${updated.ravText.gutterWidthPt}pt.`,
          updatedSettings: updated,
          clampedByEngineHardRule: updated.ravText.gutterWidthPt !== nextRavGutter,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
    }

    // v0.4.0 — 2b. Ready design preset ("use the classic Vilna look",
    // "השתמש בעיצוב וילנא הקלאסי", "switch to Mikraot Gedolot").
    // Runs before the font-size branch: preset names contain no numbers,
    // but "Vilna look" must not fall through to "not recognised".
    const presetMention = findReadyDesignByName(text);
    if (
      presetMention &&
      (lower.includes('design') ||
        lower.includes('עיצוב') ||
        lower.includes('look') ||
        lower.includes('מראה') ||
        lower.includes('preset') ||
        lower.includes('vilna') ||
        lower.includes('וילנא') ||
        lower.includes('mikraot') ||
        lower.includes('מקראות') ||
        lower.includes('siddur') ||
        lower.includes('סידור') ||
        lower.includes('halacha') ||
        lower.includes('halakha') ||
        lower.includes('הלכה') ||
        lower.includes('simple book') ||
        lower.includes('ספר פשוט') ||
        lower.includes('shulchan') ||
        lower.includes('שולחן'))
    ) {
      const report = this.applyReadyDesign(current, presetMention.id, 'ai');
      return {
        handled: true,
        matched: true,
        summaryHe: `הוחל עיצוב מוכן: ${presetMention.nameHe} (${presetMention.descriptionHe})`,
        summaryEn: `Applied ready design: ${presetMention.nameEn} — ${presetMention.descriptionEn}`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: true,
      };
    }

    // v0.4.0 — 2c. Layout switch ("two columns", "טור אחד", "רב-טקסט",
    // "switch to single column"). Normalises hyphens so "two-column" matches.
    const norm = lower.replace(/[־–—-]/g, ' ');
    const layoutMention: { layout: BookLayoutType; labelHe: string; labelEn: string } | null =
      norm.includes('two column') || norm.includes('שני טורים') || norm.includes('שני עמודות')
        ? { layout: 'two_column', labelHe: 'שני טורים', labelEn: 'two columns' }
        : norm.includes('single column') || norm.includes('one column') || norm.includes('טור אחד') || norm.includes('עמודה אחת')
          ? { layout: 'single_column', labelHe: 'טור אחד', labelEn: 'single column' }
          : norm.includes('mikraot') || norm.includes('מקראות')
            ? { layout: 'mikraot_gedolot', labelHe: 'מקראות גדולות', labelEn: 'Mikraot Gedolot' }
            : norm.includes('source top') || norm.includes('מקור למעלה') || norm.includes('מקור עליון')
              ? { layout: 'source_top_commentary_bottom', labelHe: 'מקור למעלה ומפרשים למטה', labelEn: 'source on top, commentary below' }
              : norm.includes('rav text') || norm.includes('רב טקסט')
                ? { layout: 'rav_text', labelHe: 'רב-טקסט', labelEn: 'multi-text (Rav Text)' }
                : null;
    if (
      layoutMention &&
      (norm.includes('layout') ||
        norm.includes('פריסה') ||
        norm.includes('עימוד') ||
        norm.includes('switch') ||
        norm.includes('החלף') ||
        norm.includes('עבור') ||
        norm.includes('use') ||
        norm.includes('השתמש') ||
        norm.includes('column') ||
        norm.includes('טור') ||
        norm.includes('רב טקסט') ||
        norm.includes('mikraot') ||
        norm.includes('מקראות'))
    ) {
      const report = this.updatePageLayout(
        current,
        { layoutType: layoutMention.layout, columnCount: layoutMention.layout === 'two_column' ? 2 : 1 },
        'ai',
        `AI: מעבר לפריסת ${layoutMention.labelHe}`
      );
      const next = report.settings;
      next.layoutType = layoutMention.layout;
      this.syncDerivedViews(next);
      return {
        handled: true,
        matched: true,
        summaryHe: `הפריסה הוחלפה ל-${layoutMention.labelHe}.`,
        summaryEn: `Layout changed to ${layoutMention.labelEn}.`,
        updatedSettings: next,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: true,
      };
    }

    // v0.4.0 — 2d. Page size ("use A4", "גודל עמוד A5", "folio size",
    // "pocket size", "gemara size"). Sets the preset AND its dimensions
    // (the preset name alone changes nothing in the geometry); royal and
    // custom keep the current dimensions. A5 is now the named 'small_a5'
    // preset (was 'custom' + A5 dims before v0.4.0).
    const sizePresetMention: PageLayoutDesignSettings['pageSizePreset'] | null =
      norm.includes('a4') || norm.includes('booklet') || norm.includes('חוברת')
        ? 'booklet_a4'
        : norm.includes('a5') || norm.includes('small') || norm.includes('קטן')
          ? 'small_a5'
          : norm.includes('pocket') || norm.includes('כיס')
            ? 'pocket'
            : norm.includes('gemara size') || norm.includes('גמרא') && norm.includes('גודל')
              ? 'gemara_24x34'
              : norm.includes('regular') || norm.includes('רגיל')
                ? 'regular_17x24'
                : norm.includes('wide') || norm.includes('רחב')
                  ? 'wide_17x25'
                  : norm.includes('b5')
                    ? 'b5'
                    : norm.includes('vilna folio') || norm.includes('folio') || norm.includes('פוליו')
                      ? 'vilna_folio'
                      : norm.includes('crown quarto') || norm.includes('crown') || norm.includes('קראון')
                        ? 'crown_quarto'
                        : norm.includes('royal') || norm.includes('רויאל')
                          ? 'royal_holy_book'
                          : null;
    if (
      sizePresetMention &&
      (norm.includes('page size') || norm.includes('גודל עמוד') || norm.includes('גודל דף') || norm.includes('גודל') || norm.includes('a4') || norm.includes('a5') || norm.includes('b5') || norm.includes('folio') || norm.includes('פוליו') || norm.includes('crown') || norm.includes('royal') || norm.includes('רויאל') || norm.includes('pocket') || norm.includes('כיס') || norm.includes('regular') || norm.includes('wide') || norm.includes('booklet'))
    ) {
      const dims = PAGE_SIZE_DIMENSIONS[sizePresetMention];
      const orientation = current.pageLayout.orientation;
      const w = dims ? dims.widthPt : current.pageLayout.pageWidthPt;
      const h = dims ? dims.heightPt : current.pageLayout.pageHeightPt;
      const report = this.updatePageLayout(
        current,
        {
          pageSizePreset: sizePresetMention,
          orientation,
          pageWidthPt: orientation === 'landscape' ? Math.max(w, h) : Math.min(w, h),
          pageHeightPt: orientation === 'landscape' ? Math.min(w, h) : Math.max(w, h),
        },
        'ai',
        `AI: מעבר לגודל עמוד ${sizePresetMention}`
      );
      return {
        handled: true,
        matched: true,
        summaryHe: `גודל העמוד הוחלף ל-${sizePresetMention}${dims ? ` (${dims.widthPt}×${dims.heightPt}pt)` : ''}.`,
        summaryEn: `Page size changed to ${sizePresetMention}${dims ? ` (${dims.widthPt}×${dims.heightPt}pt)` : ''}.`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: true,
      };
    }

    // v0.4.0 — 2e. Orientation ("landscape", "סובב לרוחב", "portrait").
    if (
      norm.includes('landscape') ||
      norm.includes('לרוחב') ||
      norm.includes('אופקי') ||
      norm.includes('portrait') ||
      norm.includes('לאורך') ||
      norm.includes('אנכי')
    ) {
      const toLandscape =
        norm.includes('landscape') || norm.includes('לרוחב') || norm.includes('אופקי');
      const w = current.pageLayout.pageWidthPt;
      const h = current.pageLayout.pageHeightPt;
      const report = this.updatePageLayout(
        current,
        {
          orientation: toLandscape ? 'landscape' : 'portrait',
          pageWidthPt: toLandscape ? Math.max(w, h) : Math.min(w, h),
          pageHeightPt: toLandscape ? Math.min(w, h) : Math.max(w, h),
        },
        'ai',
        `AI: סיבוב עמוד ${toLandscape ? 'לרוחב' : 'לאורך'}`
      );
      return {
        handled: true,
        matched: true,
        summaryHe: toLandscape ? 'העמוד סובב לרוחב.' : 'העמוד סובב לאורך.',
        summaryEn: toLandscape ? 'Page turned to landscape.' : 'Page turned to portrait.',
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: true,
      };
    }

    // v0.5.0 Part B (Module 5) — block margins / spacing / auto-center
    // ("מרכז את הפסקה", "שולי הפסקה 10pt", "center the block",
    // "block margins 12pt"). Runs BEFORE the page-margin branch (2f) and
    // the paragraph-spacing branch (§4): those handle PAGE margins and
    // generic paragraph spacing; this one handles ONE BLOCK (role-level,
    // like the rest of the local parser — unit targeting stays in the
    // panel). Heading centring ("מרכז כותרות פרקים") is alignment (§8)
    // and is excluded here; generic "paragraph spacing" stays in §4.
    const isBlockWord =
      norm.includes('פסקה') ||
      norm.includes('paragraph') ||
      norm.includes('בלוק') ||
      norm.includes('block') ||
      norm.includes('קטע') ||
      norm.includes('section');
    const isHeadingWord =
      norm.includes('כותרת') ||
      norm.includes('heading') ||
      norm.includes('chapter') ||
      norm.includes('פרק') ||
      norm.includes('סימן') ||
      norm.includes('title');
    const isGenericParaSpacing =
      norm.includes('paragraph spacing') ||
      norm.includes('space after') ||
      norm.includes('space before') ||
      norm.includes('מרווח פסקאות') ||
      norm.includes('רווח בין פסקאות');
    if (isBlockWord && !isHeadingWord && !isGenericParaSpacing) {
      const wantsCenter =
        norm.includes('מרכז') || norm.includes('ממורכז') || norm.includes('center');
      if (wantsCenter) {
        const centered = this.autoCenterBlock(current, { role: effectiveRole }, 'ai');
        const bs = centered.blockSpacing;
        return {
          handled: true,
          matched: true,
          summaryHe: `הפסקה מורכזה — שוליים ${bs.marginLeftPt}pt משני הצדדים, מרווח ${bs.spaceBeforePt}pt מעל ומתחת.`,
          summaryEn: `Block centred — ${bs.marginLeftPt}pt margins on both sides, ${bs.spaceBeforePt}pt space above and below.`,
          updatedSettings: centered,
          clampedByEngineHardRule: false,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
      const wantsMargins = norm.includes('שול') || norm.includes('margin');
      const wantsSpacing =
        norm.includes('מרווח') || norm.includes('spacing') || norm.includes('רווח');
      if (wantsMargins || wantsSpacing) {
        const blockPatch: Partial<BlockSpacingSettings> = {};
        const side: 'left' | 'right' | 'top' | 'bottom' | null =
          norm.includes('ימין') || norm.includes('right')
            ? 'right'
            : norm.includes('שמאל') || norm.includes('left')
              ? 'left'
              : norm.includes('למעלה') || norm.includes('top') || norm.includes('לפני') || norm.includes('before')
                ? 'top'
                : norm.includes('למטה') || norm.includes('bottom') || norm.includes('אחרי') || norm.includes('after')
                  ? 'bottom'
                  : null;
        if (parsedNum !== undefined) {
          if (side === 'left') blockPatch.marginLeftPt = parsedNum;
          else if (side === 'right') blockPatch.marginRightPt = parsedNum;
          else if (side === 'top') {
            blockPatch.marginTopPt = parsedNum;
            blockPatch.spaceBeforePt = parsedNum;
          } else if (side === 'bottom') {
            blockPatch.marginBottomPt = parsedNum;
            blockPatch.spaceAfterPt = parsedNum;
          } else if (wantsMargins) {
            blockPatch.marginLeftPt = parsedNum;
            blockPatch.marginRightPt = parsedNum;
          } else {
            blockPatch.spaceBeforePt = parsedNum;
            blockPatch.spaceAfterPt = parsedNum;
          }
        } else {
          const widen =
            norm.includes('wider') ||
            norm.includes('רחב') ||
            norm.includes('הרחב') ||
            norm.includes('increase') ||
            norm.includes('הגדל');
          const narrow =
            norm.includes('narrow') ||
            norm.includes('צר') ||
            norm.includes('הקטן') ||
            norm.includes('decrease') ||
            norm.includes('צמצם');
          if (widen || narrow) {
            const delta = widen ? 4 : -4;
            const cur = currentRoleResolved.paragraph;
            const bump = (v: number) => Math.max(0, v + delta);
            if (side === 'left') blockPatch.marginLeftPt = bump(cur.leftIndentPt);
            else if (side === 'right') blockPatch.marginRightPt = bump(cur.rightIndentPt);
            else if (side === 'top') {
              const v = bump(cur.spaceBeforePt);
              blockPatch.marginTopPt = v;
              blockPatch.spaceBeforePt = v;
            } else if (side === 'bottom') {
              const v = bump(cur.spaceAfterPt);
              blockPatch.marginBottomPt = v;
              blockPatch.spaceAfterPt = v;
            } else if (wantsMargins) {
              blockPatch.marginLeftPt = bump(cur.leftIndentPt);
              blockPatch.marginRightPt = bump(cur.rightIndentPt);
            } else {
              const b = bump(cur.spaceBeforePt);
              const a = bump(cur.spaceAfterPt);
              blockPatch.marginTopPt = b;
              blockPatch.spaceBeforePt = b;
              blockPatch.marginBottomPt = a;
              blockPatch.spaceAfterPt = a;
            }
          }
        }
        if (Object.keys(blockPatch).length > 0) {
          const updated = this.updateBlockSpacing(
            current,
            blockPatch,
            { role: effectiveRole },
            'ai'
          );
          const bs = updated.blockSpacing;
          return {
            handled: true,
            matched: true,
            summaryHe: `שולי הפסקה עודכנו (ימין ${bs.marginRightPt}pt, שמאל ${bs.marginLeftPt}pt, לפני ${bs.spaceBeforePt}pt, אחרי ${bs.spaceAfterPt}pt).`,
            summaryEn: `Block margins updated (right ${bs.marginRightPt}pt, left ${bs.marginLeftPt}pt, before ${bs.spaceBeforePt}pt, after ${bs.spaceAfterPt}pt).`,
            updatedSettings: updated,
            clampedByEngineHardRule: false,
            warnings: [],
            requiresPreviewConfirmation: false,
          };
        }
      }
    }

    // v0.4.0 — 2f. Margins ("set margins to 50pt", "wider margins",
    // "הרחב את השוליים", "שוליים עליונים 40pt"). Must run before the
    // font-size branch: "50pt" would otherwise be read as a font size.
    if (
      (norm.includes('margin') || norm.includes('שוליים') || norm.includes('שוליים')) &&
      // "הערות שוליים" (footnotes) contains "שוליים" — that is a footnote
      // command, not a margin command; let the footnote branches handle it.
      !norm.includes('הערות') &&
      !norm.includes('הערת') &&
      !norm.includes('footnote')
    ) {
      const updates: Partial<PageLayoutDesignSettings> = {};
      const sideMatch =
        norm.includes('top') || norm.includes('עליון') ? 'marginTopPt'
        : norm.includes('bottom') || norm.includes('תחתון') ? 'marginBottomPt'
        : norm.includes('inside') || norm.includes('פנימי') ? 'marginInsidePt'
        : norm.includes('outside') || norm.includes('חיצוני') ? 'marginOutsidePt'
        : null;
      const widen = norm.includes('wider') || norm.includes('רחב') || norm.includes('הרחב') || norm.includes('increase') || norm.includes('הגדל');
      const narrow = norm.includes('narrow') || norm.includes('צר') || norm.includes('הקטן') || norm.includes('decrease') || norm.includes('צמצם');
      if (parsedNum !== undefined) {
        const val = parsedNum;
        if (sideMatch) {
          updates[sideMatch] = val;
        } else {
          updates.marginTopPt = val;
          updates.marginBottomPt = val;
          updates.marginInsidePt = val;
          updates.marginOutsidePt = val;
        }
      } else if (widen || narrow) {
        const delta = widen ? 4 : -4;
        const cur = sideMatch
          ? current.pageLayout[sideMatch]
          : current.pageLayout.marginInsidePt;
        if (sideMatch) {
          updates[sideMatch] = Math.max(0, cur + delta);
        } else {
          updates.marginTopPt = Math.max(0, current.pageLayout.marginTopPt + delta);
          updates.marginBottomPt = Math.max(0, current.pageLayout.marginBottomPt + delta);
          updates.marginInsidePt = Math.max(0, current.pageLayout.marginInsidePt + delta);
          updates.marginOutsidePt = Math.max(0, current.pageLayout.marginOutsidePt + delta);
        }
      }
      if (Object.keys(updates).length > 0) {
        const report = this.updatePageLayout(current, updates, 'ai', 'AI: עדכון שוליים');
        const m = report.settings.pageLayout;
        return {
          handled: true,
          matched: true,
          summaryHe: `השוליים עודכנו (עליון ${m.marginTopPt}pt, תחתון ${m.marginBottomPt}pt, פנימי ${m.marginInsidePt}pt, חיצוני ${m.marginOutsidePt}pt).`,
          summaryEn: `Margins updated (top ${m.marginTopPt}pt, bottom ${m.marginBottomPt}pt, inside ${m.marginInsidePt}pt, outside ${m.marginOutsidePt}pt).`,
          updatedSettings: report.settings,
          clampedByEngineHardRule: report.clampedByEngineHardRule,
          warnings: report.warnings,
          requiresPreviewConfirmation: false,
        };
      }
    }

    // v0.5.0 (Title Page / Shaar Blat builder): "make a title page",
    // "remove the title page", "change the title page border to …",
    // "set the book title to …" (עמוד שער / שם הספר). Placed BEFORE the
    // labels branch so "עמוד שער" never falls into the header /
    // page-number branches below. Setting a title or a border also turns
    // the title page on — the command makes it appear.
    if (
      norm.includes('עמוד שער') ||
      norm.includes('עמוד השער') ||
      norm.includes('title page') ||
      norm.includes('shaar blat') ||
      norm.includes('שער בלעט') ||
      norm.includes('שם הספר')
    ) {
      const wantsRemove =
        norm.includes('הסר') || norm.includes('בטל') || norm.includes('מחק') ||
        norm.includes('remove') || norm.includes('delete') || norm.includes('hide');
      const wantsBorder =
        norm.includes('מסגרת') || norm.includes('border') || norm.includes('frame');
      const borderStyle: TitlePageBorderStyleId | undefined =
        norm.includes('בלי מסגרת') || norm.includes('no border') ? 'none'
        : norm.includes('מעוטר') || norm.includes('ornate') ? 'ornate'
        : norm.includes('מדורג') || norm.includes('stepped') ? 'stepped'
        : norm.includes('דוגמ') || norm.includes('pattern') ? 'patterned'
        : norm.includes('פינות') || norm.includes('corner') ? 'corner'
        : norm.includes('כפול') || norm.includes('double') ? 'double'
        : norm.includes('דק') || norm.includes('single') || norm.includes('קו אחד') ? 'single'
        : undefined;
      // Note: `\s*` (not `\s+`) after the prefix — in Hebrew the title
      // usually follows the ל prefix with no space ("למסכת ברכות").
      const titleMatch = text.match(
        /(?:set the book title to|קבע את שם הספר ל|שנה את שם הספר ל|קרא לספר)\s*(.+)/i
      );
      const newTitle = titleMatch
        ? titleMatch[1].trim().replace(/["״׳']/g, '').trim().slice(0, 200)
        : '';
      const applyTitlePage = (mutate: (tp: TitlePageSettings) => void) => {
        const cloned = this.cloneSettings(current);
        mutate(cloned.titlePage);
        return this.sanitizeAndEnforceHardRules(cloned).settings;
      };
      let next = current;
      let summaryHe = '';
      let summaryEn = '';
      if (newTitle) {
        next = applyTitlePage(tp => {
          tp.enabled = true;
          tp.title = { ...tp.title, text: newTitle };
        });
        summaryHe = `שם הספר בעמוד השער: "${newTitle}".`;
        summaryEn = `Book title on the title page: "${newTitle}".`;
      } else if (wantsBorder && borderStyle) {
        const styleName = borderStyle;
        next = applyTitlePage(tp => {
          tp.enabled = true;
          tp.border = { ...tp.border, enabled: true, styleId: styleName };
        });
        summaryHe = `מסגרת עמוד השער שונתה ל-${styleName}.`;
        summaryEn = `Title page border changed to ${styleName}.`;
      } else if (wantsRemove) {
        next = applyTitlePage(tp => { tp.enabled = false; });
        summaryHe = 'עמוד השער הוסר.';
        summaryEn = 'Title page removed.';
      } else if (
        norm.includes('הוסף') || norm.includes('צור') || norm.includes('הצג') ||
        norm.includes('make') || norm.includes('add') || norm.includes('create') || norm.includes('show')
      ) {
        next = applyTitlePage(tp => { tp.enabled = true; });
        summaryHe = 'עמוד שער נוסף כעמוד הראשון של הספר.';
        summaryEn = 'Title page added as the first page of the book.';
      }
      if (summaryHe) {
        return {
          handled: true,
          matched: true,
          summaryHe,
          summaryEn,
          updatedSettings: next,
          clampedByEngineHardRule: false,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
    }

    // v0.6.0 Part A (§5): running-header text + granular toggles. Placed
    // BEFORE the labels branch and 2g so "מספר עמוד בכותרת העליונה" does
    // not fall into the global page-number branch below, and so "כותרת
    // עליונה: ..." sets the header text instead of toggling the line.
    // Setting header text also turns the line on (like the title page:
    // setting a title turns it on); toggles alone leave visibility as is.
    if (
      norm.includes('כותרת עליונה') ||
      norm.includes('כותרת העליונה') ||
      norm.includes('header text') ||
      norm.includes('running header text')
    ) {
      const hide = norm.includes('hide') || norm.includes('הסתר') || norm.includes('בטל');
      const show = norm.includes('show') || norm.includes('הצג') || norm.includes('הוסף');
      const isBookTitle =
        norm.includes('שם ספר') || norm.includes('book title') || norm.includes('שם הספר');
      const isChapterTitle =
        norm.includes('כותרת פרק') || norm.includes('chapter title') || norm.includes('כותרת הפרק');
      const isHeaderPageNumber =
        (norm.includes('מספר עמוד') || norm.includes('page number')) &&
        (norm.includes('כותרת') || norm.includes('header'));
      let next = current;
      let summaryHe = '';
      let summaryEn = '';
      if ((hide || show) && isBookTitle) {
        const value = show && !hide;
        next = this.updatePageElementsSettings(
          next,
          { runningHeader: { showBookTitle: value } } as unknown as Partial<PageElementsDesignSettings>,
          'ai'
        );
        summaryHe = value ? 'שם הספר יוצג בכותרת העליונה.' : 'שם הספר הוסתר מהכותרת העליונה.';
        summaryEn = value ? 'Book title will be shown in the running header.' : 'Book title hidden from the running header.';
      } else if ((hide || show) && isChapterTitle) {
        const value = show && !hide;
        next = this.updatePageElementsSettings(
          next,
          { runningHeader: { showChapterTitle: value } } as unknown as Partial<PageElementsDesignSettings>,
          'ai'
        );
        summaryHe = value ? 'כותרת הפרק תוצג בכותרת העליונה.' : 'כותרת הפרק הוסתרה מהכותרת העליונה.';
        summaryEn = value ? 'Chapter title will be shown in the running header.' : 'Chapter title hidden from the running header.';
      } else if ((hide || show) && isHeaderPageNumber) {
        const value = show && !hide;
        next = this.updatePageElementsSettings(
          next,
          { runningHeader: { showPageNumber: value } } as unknown as Partial<PageElementsDesignSettings>,
          'ai'
        );
        summaryHe = value ? 'מספר העמוד יוצג בכותרת העליונה.' : 'מספר העמוד הוסתר מהכותרת העליונה.';
        summaryEn = value ? 'Page number will be shown in the running header.' : 'Page number hidden from the running header.';
      } else {
        // "כותרת עליונה: <text>" / "set the header text to <text>" — the
        // centre (book-title) slot; also turns the line on so it is seen.
        const m =
          instruction.match(/כותרת\s+ה?עליונה\s*:\s*(.+)$/) ||
          instruction.match(/set (?:the )?header text to\s+(.+)$/i) ||
          instruction.match(/header text\s*:\s*(.+)$/i);
        const headerText = m?.[1]?.trim();
        if (headerText) {
          next = this.updatePageElementsSettings(
            next,
            {
              showTopHeaderLine: true,
              runningHeader: { centerText: headerText },
            } as unknown as Partial<PageElementsDesignSettings>,
            'ai'
          );
          summaryHe = `הכותרת העליונה שונתה ל״${headerText}״.`;
          summaryEn = `Running header text set to "${headerText}".`;
        }
      }
      if (summaryHe) {
        return {
          handled: true,
          matched: true,
          summaryHe,
          summaryEn,
          updatedSettings: next,
          clampedByEngineHardRule: false,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
    }

    // v0.5.0 (integrator — user request): commentary labels, page-number
    // style and the "דף" prefix. Placed BEFORE 2g so a style command like
    // "מספרי עמודים באותיות עבריות" does not fall into the show/hide or
    // position branches below.
    if (
      norm.includes('תוויות פירוש') ||
      norm.includes('commentary label') ||
      ((norm.includes('מספר עמוד') || norm.includes('מספרי עמודים') || norm.includes('page number')) &&
        (norm.includes('אותיות') || norm.includes('hebrew letter') || norm.includes('מספרים רגילים') || norm.includes('plain number'))) ||
      ((norm.includes('דף') || norm.includes('daf')) && norm.includes('מספר'))
    ) {
      const hide = norm.includes('hide') || norm.includes('הסתר') || norm.includes('בטל');
      const show = norm.includes('show') || norm.includes('הצג') || norm.includes('הוסף');
      const isLabels = norm.includes('תוויות פירוש') || norm.includes('commentary label');
      const isDaf = (norm.includes('דף') || norm.includes('daf')) && norm.includes('מספר');
      const style: 'numbers' | 'hebrew' | undefined =
        norm.includes('אותיות') || norm.includes('hebrew letter')
          ? 'hebrew'
          : norm.includes('מספרים רגילים') || norm.includes('plain number')
            ? 'numbers'
            : undefined;
      let next = current;
      let summaryHe = '';
      let summaryEn = '';
      if (isLabels && (hide || show)) {
        const value = show && !hide;
        next = this.updatePageElementsSettings(next, { showCommentaryLabels: value }, 'ai');
        summaryHe = value ? 'תוויות הפירוש יוצגו מעל הטורים.' : 'תוויות הפירוש הוסתרו.';
        summaryEn = value ? 'Commentary labels will be shown above the columns.' : 'Commentary labels hidden.';
      } else if (isDaf && (hide || show)) {
        const value = show && !hide;
        next = this.updatePageElementsSettings(next, { showDafPrefix: value }, 'ai');
        summaryHe = value ? 'מספר העמוד יוצג עם ״דף״ לפניו.' : 'מספר העמוד יוצג בלי ״דף״ לפניו.';
        summaryEn = value ? 'Page number will be shown with "דף" before it.' : 'Page number will be shown without "דף" before it.';
      } else if (style) {
        next = this.updatePageElementsSettings(
          next,
          { pageNumberStyle: style, showFolioNumber: true },
          'ai'
        );
        summaryHe = style === 'hebrew' ? 'מספרי העמודים יוצגו באותיות עבריות.' : 'מספרי העמודים יוצגו במספרים רגילים.';
        summaryEn = style === 'hebrew' ? 'Page numbers will be shown in Hebrew letters.' : 'Page numbers will be shown as plain numbers.';
      }
      if (summaryHe) {
        return {
          handled: true,
          matched: true,
          summaryHe,
          summaryEn,
          updatedSettings: next,
          clampedByEngineHardRule: false,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
    }

    // v0.4.0 — 2g. Headers / footers / page numbers ("hide the running
    // header", "show page numbers", "הסתר כותרת רצה", "מספר עמוד למטה").
    if (
      norm.includes('running header') ||
      norm.includes('top header') ||
      norm.includes('כותרת רצה') ||
      norm.includes('כותרת עליונה') ||
      // v0.5.0 Part B (Module 6): "שורת הכותרת העליונה" / "הכותרת
      // העליונה" — the definite-article forms the old trigger missed.
      norm.includes('כותרת העליונה') ||
      norm.includes('שורת כותרת') ||
      norm.includes('שורה עליונה') ||
      norm.includes('page number') ||
      norm.includes('מספר עמוד') ||
      norm.includes('מספרי עמודים') ||
      norm.includes('header') ||
      norm.includes('footer') ||
      norm.includes('כותרת תחתונה')
    ) {
      const hide =
        norm.includes('hide') || norm.includes('הסתר') || norm.includes('בטל') || norm.includes('remove');
      const show =
        norm.includes('show') || norm.includes('הצג') || norm.includes('הוסף') || norm.includes('add');
      const isHeader = norm.includes('header') || norm.includes('כותרת');
      const isFooter = norm.includes('footer') || norm.includes('תחתונה');
      const isPageNumber = norm.includes('page number') || norm.includes('מספר עמוד') || norm.includes('מספרי עמודים');
      if (hide || show) {
        const value = show && !hide;
        let next = current;
        if (isPageNumber) {
          next = this.updatePageElementsSettings(next, { showFolioNumber: value }, 'ai');
          next = this.updatePageLayout(
            next,
            { pageNumberPosition: value ? 'top_outside' : 'hidden' },
            'ai'
          ).settings;
        } else if (isFooter) {
          next = this.updatePageLayout(next, { showRunningFooter: value }, 'ai').settings;
        } else if (isHeader) {
          // v0.5.0 Part B (Module 6): "show/hide the top header line"
          // flips the new visibility flag (and the legacy flag with it —
          // see `updatePageElementsSettings`, they stay in sync).
          next = this.updatePageElementsSettings(
            next,
            { showRunningHeader: value, showTopHeaderLine: value },
            'ai'
          );
        }
        return {
          handled: true,
          matched: true,
          summaryHe: isPageNumber
            ? value ? 'מספרי העמודים יוצגו.' : 'מספרי העמודים הוסתרו.'
            : isFooter
              ? value ? 'שורת הכותרת התחתונה תוצג.' : 'שורת הכותרת התחתונה הוסתרה.'
              : value ? 'הכותרת הרצה תוצג.' : 'הכותרת הרצה הוסתרה.',
          summaryEn: isPageNumber
            ? value ? 'Page numbers will be shown.' : 'Page numbers hidden.'
            : isFooter
              ? value ? 'Running footer will be shown.' : 'Running footer hidden.'
              : value ? 'Running header will be shown.' : 'Running header hidden.',
          updatedSettings: next,
          clampedByEngineHardRule: false,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
      // Position only: "page numbers at the bottom" / "מספר עמוד למטה".
      if (isPageNumber) {
        const pos: PageLayoutDesignSettings['pageNumberPosition'] =
          norm.includes('bottom') || norm.includes('למטה') || norm.includes('תחתית')
            ? 'bottom_center'
            : norm.includes('top') || norm.includes('למעלה')
              ? 'top_outside'
              : 'top_outside';
        let next = this.updatePageElementsSettings(current, { folioNumberPosition: pos, showFolioNumber: true }, 'ai');
        next = this.updatePageLayout(next, { pageNumberPosition: pos }, 'ai').settings;
        return {
          handled: true,
          matched: true,
          summaryHe: `מספר העמוד יופיע ${pos === 'bottom_center' ? 'למטה במרכז' : 'למעלה בחוץ'}.`,
          summaryEn: `Page number will appear ${pos === 'bottom_center' ? 'at the bottom centre' : 'at the top outside'}.`,
          updatedSettings: next,
          clampedByEngineHardRule: false,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
    }

    // v0.4.0 — 2h. Column count ("three columns", "שלושה טורים",
    // "balance the columns"). Layout switches are handled in 2c; this is
    // for plain column-count / column-balancing requests.
    if (
      (norm.includes('column') || norm.includes('טור') || norm.includes('עמודה')) &&
      (norm.includes('three') || norm.includes('שלושה') || norm.includes('שלוש') || norm.includes('3') || norm.includes('balance') || norm.includes('אזן'))
    ) {
      if (norm.includes('balance') || norm.includes('אזן')) {
        const next = this.cloneSettings(current);
        next.columns = { ...next.columns, balanceColumns: true };
        const report = this.sanitizeAndEnforceHardRules(next);
        return {
          handled: true,
          matched: true,
          summaryHe: 'איזון טורים הופעל — הטורים יאוזנו לגובה אחיד.',
          summaryEn: 'Column balancing on — columns will be balanced to equal height.',
          updatedSettings: report.settings,
          clampedByEngineHardRule: report.clampedByEngineHardRule,
          warnings: report.warnings,
          requiresPreviewConfirmation: false,
        };
      }
      const count: 1 | 2 | 3 = norm.includes('three') || norm.includes('שלושה') || norm.includes('שלוש') ? 3 : 2;
      const report = this.updatePageLayout(current, { columnCount: count }, 'ai', `AI: מעבר ל-${count} טורים`);
      return {
        handled: true,
        matched: true,
        summaryHe: `מספר הטורים עודכן ל-${count}.`,
        summaryEn: `Column count updated to ${count}.`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: false,
      };
    }

    // v0.4.0 — 2i. Remove a commentator tier ("remove Tosafot",
    // "הסר את תוספות"). Only when the tier actually exists on the page;
    // adding a tier stays file-based (add_commentator in AiChatPanel).
    if (norm.includes('remove') || norm.includes('הסר') || norm.includes('מחק')) {
      const tiers = current.pageLayout.tiers ?? [];
      const roleToRemove: ContentRole | null =
        norm.includes('tosafot') || norm.includes('תוספות') ? 'secondary_comment'
        : norm.includes('rashi') || norm.includes('רש״י') || norm.includes('רשי') ? 'primary_comment'
        : norm.includes('ramban') || norm.includes('רמב״ן') ? 'tertiary_comment'
        : null;
      if (roleToRemove && tiers.some(tier => tier.role === roleToRemove)) {
        const next = this.cloneSettings(current);
        next.pageLayout.tiers = tiers.filter(tier => tier.role !== roleToRemove);
        const report = this.sanitizeAndEnforceHardRules(next);
        return {
          handled: true,
          matched: true,
          summaryHe: `השכבה ${roleToRemove === 'secondary_comment' ? 'תוספות' : roleToRemove === 'primary_comment' ? 'רש״י' : 'רמב״ן'} הוסרה מהעמוד.`,
          summaryEn: `Removed the ${roleToRemove} tier from the page.`,
          updatedSettings: report.settings,
          clampedByEngineHardRule: report.clampedByEngineHardRule,
          warnings: report.warnings,
          requiresPreviewConfirmation: true,
        };
      }
    }

    // 3. Compact Layout preset ("Use a more compact layout", "עימוד צפוף יותר")
    if (lower.includes('compact') || lower.includes('צפוף')) {
      const next = this.cloneSettings(current);
      next.ravText.sourceLineSpacingRatio = Number(
        Math.max(1.12, next.ravText.sourceLineSpacingRatio - 0.08).toFixed(2)
      );
      next.ravText.commentaryLineSpacingRatio = Number(
        Math.max(1.12, next.ravText.commentaryLineSpacingRatio - 0.08).toFixed(2)
      );
      next.ravText.gutterWidthPt = Math.max(8, next.ravText.gutterWidthPt - 1.5);
      next.pageLayout.columnGutterPt = Math.max(10, next.pageLayout.columnGutterPt - 2);
      next.version += 1;
      next.updatedAt = Date.now();
      next.lastModifiedBy = 'ai';
      next.lastModificationSummary = 'AI: מעבר לעימוד קומפקטי וצפוף יותר';
      const report = this.sanitizeAndEnforceHardRules(next);
      return {
        handled: true,
        matched: true,
        summaryHe: 'הוחל עימוד קומפקטי יותר (צמצום עדין של מרווחי שורות ומרווחי טורים תוך שמירה על חוקי המנוע).',
        summaryEn: 'Applied compact layout adjustments to line spacing and gutters.',
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: true,
      };
    }

    // 4. Paragraph spacing ("paragraph spacing", "space after", "מרווח פסקאות", "רווח בין פסקאות")
    if (
      lower.includes('paragraph spacing') ||
      lower.includes('space after') ||
      lower.includes('space before') ||
      lower.includes('מרווח פסקאות') ||
      lower.includes('רווח בין פסקאות')
    ) {
      const curAfter = currentRoleResolved.paragraph.spaceAfterPt;
      const nextAfter =
        parsedNum !== undefined
          ? parsedNum
          : lower.includes('increase') || lower.includes('larger') || lower.includes('הגדל')
          ? Number((curAfter + 2).toFixed(1))
          : lower.includes('decrease') || lower.includes('smaller') || lower.includes('הקטן')
          ? Math.max(0, Number((curAfter - 1.5).toFixed(1)))
          : Number((curAfter + 2).toFixed(1));

      const report = this.updateRoleStyle(
        current,
        effectiveRole,
        { paragraph: { spaceAfterPt: nextAfter } },
        'ai',
        `AI: עדכון מרווח אחרי פסקה ל-${nextAfter}pt`
      );
      const finalVal = this.resolveRoleAndUnitStyle(report.settings, effectiveRole).paragraph.spaceAfterPt;
      return {
        handled: true,
        matched: true,
        summaryHe: `מרווח הפסקאות של ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} עודכן ל-${finalVal}pt.`,
        summaryEn: `Updated ${effectiveRole} paragraph spacing to ${finalVal}pt.`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: false,
      };
    }

    // 5. Line spacing / Leading ("Increase the line spacing slightly", "מרווח שורות")
    if (
      lower.includes('line spacing') ||
      lower.includes('leading') ||
      lower.includes('מרווח שורות') ||
      lower.includes('גובה שורה')
    ) {
      const curRatio = currentRoleResolved.paragraph.lineSpacingRatio;
      let nextRatio = curRatio;
      if (parsedNum !== undefined) {
        if (parsedNum > 4) {
          // Provided in points (leadingPt)
          nextRatio = Number(
            (parsedNum / Math.max(1, currentRoleResolved.character.fontSizePt)).toFixed(2)
          );
        } else {
          nextRatio = parsedNum;
        }
      } else if (lower.includes('slightly') || lower.includes('מעט')) {
        nextRatio =
          lower.includes('decrease') || lower.includes('smaller') || lower.includes('הקטן')
            ? Number((curRatio - 0.05).toFixed(2))
            : Number((curRatio + 0.06).toFixed(2));
      } else if (lower.includes('decrease') || lower.includes('smaller') || lower.includes('הקטן')) {
        nextRatio = Number((curRatio - 0.1).toFixed(2));
      } else {
        nextRatio = Number((curRatio + 0.1).toFixed(2));
      }

      const nextLeading = Number(
        (currentRoleResolved.character.fontSizePt * nextRatio).toFixed(2)
      );
      const report = this.updateRoleStyle(
        current,
        effectiveRole,
        { paragraph: { lineSpacingRatio: nextRatio, leadingPt: nextLeading } },
        'ai',
        `AI: עדכון מרווח שורות ל-${nextRatio}x (${nextLeading}pt)`
      );
      const finalPara = this.resolveRoleAndUnitStyle(report.settings, effectiveRole).paragraph;
      return {
        handled: true,
        matched: true,
        summaryHe: `מרווח השורות של ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} עודכן ל-${finalPara.lineSpacingRatio} (${finalPara.leadingPt}pt).`,
        summaryEn: `Updated ${effectiveRole} line spacing to ${finalPara.lineSpacingRatio} (${finalPara.leadingPt}pt).`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: false,
      };
    }

    // 6. Rav Text / Upper Collar / Knee settings via AI
    if (
      lower.includes('rav text') ||
      lower.includes('upper collar') ||
      lower.includes('knee') ||
      lower.includes('ברך') ||
      lower.includes('רב-טקסט')
    ) {
      if (lower.includes('collar') || lower.includes('עליונה') || lower.includes('upper')) {
        const nextLines =
          parsedNum !== undefined ? Math.round(parsedNum) : current.ravText.upperCollarLines + 1;
        const updated = this.updateRavTextSettings(
          current,
          { upperCollarLines: nextLines },
          'ai',
          `AI: עדכון שורות ברך עליונה ל-${nextLines}`
        );
        return {
          handled: true,
          matched: true,
          summaryHe: `מספר שורות הברך העליונה ברב-טקסט עודכן ל-${updated.ravText.upperCollarLines}.`,
          summaryEn: `Updated Rav Text upper collar lines to ${updated.ravText.upperCollarLines}.`,
          updatedSettings: updated,
          clampedByEngineHardRule: updated.ravText.upperCollarLines !== nextLines,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
      const nextJunction =
        parsedNum !== undefined
          ? parsedNum > 100
            ? Math.round((parsedNum / current.pageLayout.pageHeightPt) * 100)
            : parsedNum
          : Math.min(75, current.ravText.kneeJunctionPercent + 6);
      const updated = this.updateRavTextSettings(
        current,
        { kneeJunctionPercent: nextJunction },
        'ai',
        `AI: כוונון צומת ברך ל-${nextJunction}%`
      );
      return {
        handled: true,
        matched: true,
        summaryHe: `צומת הברך ברב-טקסט עודכן ל-${updated.ravText.kneeJunctionPercent}%.`,
        summaryEn: `Updated Rav Text knee junction to ${updated.ravText.kneeJunctionPercent}%.`,
        updatedSettings: updated,
        clampedByEngineHardRule: updated.ravText.kneeJunctionPercent !== nextJunction,
        warnings: [],
        requiresPreviewConfirmation: false,
      };
    }

    // 7. Font Size / Relative Size changes:
    if (
      lower.includes('point') ||
      lower.includes('pt') ||
      lower.includes('size') ||
      lower.includes('smaller') ||
      lower.includes('larger') ||
      lower.includes('bigger') ||
      lower.includes('גודל') ||
      lower.includes('נקודות') ||
      lower.includes('הגדל') ||
      lower.includes('הקטן')
    ) {
      const curSize = currentRoleResolved.character.fontSizePt;
      let nextSize = curSize;

      const isDeltaSmaller =
        (lower.includes('smaller') || lower.includes('reduce') || lower.includes('הקטן')) &&
        parsedNum !== undefined &&
        parsedNum <= 5 &&
        (lower.includes('smaller') || lower.includes('by ') || lower.includes('ב-'));
      const isDeltaLarger =
        (lower.includes('larger') || lower.includes('bigger') || lower.includes('increase') || lower.includes('הגדל')) &&
        parsedNum !== undefined &&
        parsedNum <= 5 &&
        (lower.includes('larger') || lower.includes('bigger') || lower.includes('by ') || lower.includes('ב-'));

      if (isDeltaSmaller && parsedNum !== undefined) {
        nextSize = Number((curSize - parsedNum).toFixed(2));
      } else if (isDeltaLarger && parsedNum !== undefined) {
        nextSize = Number((curSize + parsedNum).toFixed(2));
      } else if (parsedNum !== undefined) {
        nextSize = parsedNum;
      } else if (lower.includes('slightly smaller') || lower.includes('קטן מעט')) {
        nextSize = Number((curSize - 0.25).toFixed(2));
      } else if (lower.includes('slightly larger') || lower.includes('slightly bigger') || lower.includes('גדול מעט')) {
        nextSize = Number((curSize + 0.25).toFixed(2));
      } else if (lower.includes('smaller') || lower.includes('הקטן')) {
        nextSize = Number((curSize - 1.0).toFixed(2));
      } else if (lower.includes('larger') || lower.includes('bigger') || lower.includes('הגדל')) {
        nextSize = Number((curSize + 1.5).toFixed(2));
      }

      const charUpdate: Partial<CharacterStyleSettings> = { fontSizePt: nextSize };
      if (
        (effectiveRole === 'chapter' || effectiveRole === 'heading' || effectiveRole === 'main_title') &&
        (lower.includes('bold') || lower.includes('מודגש') || lower.includes('heading'))
      ) {
        charUpdate.isBold = true;
        charUpdate.fontWeight = 700;
      }

      const report = this.updateRoleStyle(
        current,
        effectiveRole,
        { character: charUpdate },
        'ai',
        `AI: שינוי גודל גופן ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} ל-${nextSize}pt`
      );
      const finalSize = this.resolveRoleAndUnitStyle(report.settings, effectiveRole).character.fontSizePt;

      return {
        handled: true,
        matched: true,
        summaryHe: `גודל הגופן של ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} עודכן מ-${curSize}pt ל-${finalSize}pt.`,
        summaryEn: `Updated ${effectiveRole} font size from ${curSize}pt to ${finalSize}pt.`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: false,
      };
    }

    // 8. Alignment changes via AI
    if (
      lower.includes('center') ||
      lower.includes('justify') ||
      lower.includes('align right') ||
      lower.includes('align left') ||
      lower.includes('ממורכז') ||
      lower.includes('מרכז') ||
      lower.includes('יישור')
    ) {
      let align: DesignAlignment = 'justify';
      if (lower.includes('center') || lower.includes('ממורכז') || lower.includes('מרכז')) align = 'center';
      else if (lower.includes('right') || lower.includes('ימין')) align = 'right';
      else if (lower.includes('left') || lower.includes('שמאל')) align = 'left';

      const report = this.updateRoleStyle(
        current,
        effectiveRole,
        { paragraph: { alignment: align } },
        'ai',
        `AI: שינוי יישור ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} ל-${align}`
      );
      return {
        handled: true,
        matched: true,
        summaryHe: `היישור של ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} עודכן ל-${align}.`,
        summaryEn: `Updated ${effectiveRole} alignment to ${align}.`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: false,
      };
    }

    return {
      handled: false,
      matched: false,
      summaryHe: 'הפקודה לא זוהתה כשינוי עיצוב ישיר.',
      summaryEn: 'Command did not match a direct design setting.',
      updatedSettings: this.cloneSettings(current),
      clampedByEngineHardRule: false,
      warnings: [],
      requiresPreviewConfirmation: false,
    };
  }
}
