/**
 * STAGE 13 — PROFESSIONAL TYPESETTING & DESIGN CONTROL PANEL
 *
 * Centralized, authoritative data model (`ProfessionalDesignSettings`) shared between:
 * - User manual edits in the Design & Typesetting Control Panel
 * - AI commands via natural language / chat
 * - Typesetting Engine (`PaginationEngine`, `DynamicKneeEngine`, `TypesetterEngine`, `HarfBuzzShaperEngine`)
 * - Preview Canvas (`PageCanvas`), PDF Exporter (`PdfExporter`), IDML Exporter (`IdmlExporter`),
 *   and Project Persistence / Undo-Redo (`ProjectPersistenceEngine`, `UndoRedoHistoryManager`).
 *
 * Hierarchy of Style Resolution:
 *   GLOBAL STYLE (Application Defaults)
 *     ↓
 *   PROJECT STYLE (Project-level style modifications)
 *     ↓
 *   LOCAL OVERRIDE (Unit / Paragraph / Range-level overrides)
 *
 * Subject to Stage 12 Level 0 Universal Engine Hard Rules at all times.
 */

import { BookLayoutType, ContentRole, KneeCustomSettings, PageGeometry } from './typesetter';

export type DesignAlignment = 'justify' | 'right' | 'center' | 'left';
export type ParagraphAlignmentMode = DesignAlignment;
export type DesignLastLineAlignment = 'right' | 'left' | 'center' | 'justify';
export type DesignTextDirection = 'rtl' | 'ltr' | 'auto';
export type DesignStyleTier = 'GLOBAL_STYLE' | 'PROJECT_STYLE' | 'LOCAL_OVERRIDE';
export type DesignScopeLevel =
  | 'global'
  | 'document'
  | 'role'
  | 'local_selection'
  | 'local_unit'
  | 'local_word';
export type SemanticStyleRole =
  | ContentRole
  | 'header_running'
  | 'folio_number'
  | 'halakha'
  | 'quote'
  | 'body';

export const SEMANTIC_ROLE_LABELS_HE: Record<string, string> = {
  book: 'ספר / מסמך ראשי',
  main_title: 'כותרת ראשית / שער',
  subtitle: 'כותרת משנה',
  introduction: 'הקדמה / מבוא',
  chapter: 'פרק / כותרת פרק',
  siman: 'סימן (שולחן ערוך / הלכה)',
  seif: 'סעיף הלכתי',
  heading: 'כותרת',
  subheading: 'כותרת משנית',
  main_source: 'מקור ראשי (גמרא / משנה / פנים)',
  verse: 'פסוק (מקראות גדולות / תנ״ך)',
  regular_paragraph: 'גוף טקסט / פסקה רגילה',
  body: 'גוף טקסט ראשי',
  halakha: 'הלכה פסוקה',
  quote: 'ציטוט / מובאה',
  bold_special: 'טקסט מודגש / מיוחד',
  primary_comment: 'פירוש ראשי (רש״י / משנה ברורה)',
  secondary_comment: 'פירוש משני (תוספות / ש״ך / ביאור הלכה)',
  tertiary_comment: 'פירוש שלישי (עין משפט / מסורת הש״ס)',
  dibbur_hamatchil: 'דיבור המתחיל (ד״ה)',
  footnote: 'הערות שוליים',
  side_note: 'הערת צד / גליון הש״ס',
  cross_reference: 'מראה מקום / הפניה',
  ornament: 'עיטור / מסגרת (משתמש בלבד)',
  continuation: 'שורת המשך (המשך מעמוד קודם / לעמוד הבא)',
  page_element: 'כותרת רצה ומספור דפים',
  header_running: 'כותרת רצה בראש עמוד',
  folio_number: 'מספר דף / עמוד',
  table: 'טבלה',
  image: 'תמונה / שרטוט',
  chart: 'תרשים',
  caption: 'כיתוב תמונה / טבלה',
  list_item: 'פריט רשימה',
};

export interface OpenTypeFeaturesConfig {
  /** Standard ligatures (liga) */
  ligatures: boolean;
  /** Contextual alternates (calt) */
  contextualAlternates: boolean;
  /** Mark-to-base positioning (mark) — required for Hebrew Nikud/Taamim */
  markPositioning: boolean;
  /** Mark-to-mark stacking (mkmk) — required for combined Nikud + Taamim */
  markToMark: boolean;
  /** Kerning (kern) */
  kerning: boolean;
  /** Hebrew Maqaf / Rabbinic punctuation behavior */
  hebrewTypographyMode: 'rabbinic_classic' | 'biblical_taamim' | 'modern_halacha';
}

export interface CharacterStyleSettings {
  fontFamily: string;
  fontSizePt: number;
  fontWeight: number; // 400, 500, 600, 700
  fontStyle: 'normal' | 'italic';
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  textColor: string;
  /** Letter spacing / tracking in em (-0.05 to +0.20) */
  trackingEm: number;
  /** Word spacing multiplier (0.75 to 1.60, default 1.0) */
  wordSpacingRatio: number;
  /** Horizontal character scale % (clamped 90%..110% by Engine Hard Rules to prevent glyph distortion) */
  horizontalScalePercent: number;
  /** Baseline shift in pt (-4pt to +6pt) */
  baselineShiftPt: number;
  /** Script position */
  scriptPosition: 'normal' | 'superscript' | 'subscript';
  openTypeFeatures: OpenTypeFeaturesConfig;
}

export interface ParagraphStyleSettings {
  alignment: DesignAlignment;
  lastLineAlignment: DesignLastLineAlignment;
  direction: DesignTextDirection;
  leadingMode?: 'auto' | 'fixed' | 'proportional';
  /** Explicit leading in pt (or computed from lineSpacingRatio * fontSizePt) */
  leadingPt: number;
  /** Line spacing multiplier (e.g. 1.16, 1.25, 1.32) */
  lineSpacingRatio: number;
  spaceBeforePt: number;
  spaceAfterPt: number;
  firstLineIndentPt: number;
  rightIndentPt: number;
  leftIndentPt: number;
  hangingIndentPt: number;
  tabStopsPt: number[];
  justifyNonFinalLines: boolean;
  hyphenation: 'none' | 'hebrew_maqaf' | 'standard';
  keepWithNext: boolean;
  keepWithNextLines: number;
  keepLinesTogether: boolean;
  minFollowingLines: number;
  minOrphanLines: number;
  minWidowLines: number;
  minFinalLineWords: number;
  startOnNewPage: boolean;
  preventWidows: boolean;
  preventOrphans: boolean;
}

export interface RoleDesignStyle {
  role: SemanticStyleRole;
  displayNameHe: string;
  displayNameEn: string;
  character: CharacterStyleSettings;
  paragraph: ParagraphStyleSettings;
}

export interface PageLayoutDesignSettings {
  layoutType: BookLayoutType;
  geometry: PageGeometry;
  pageSizePreset: 'royal_holy_book' | 'vilna_folio' | 'crown_quarto' | 'a4' | 'b5' | 'custom';
  orientation: 'portrait' | 'landscape';
  pageWidthPt: number;
  pageHeightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
  marginInsidePt: number;
  marginOutsidePt: number;
  columnCount: 1 | 2 | 3;
  columnGutterPt: number;
  headerBandHeightPt: number;
  footerBandHeightPt: number;
  pageNumberPosition: 'top_outside' | 'top_center' | 'bottom_center' | 'bottom_outside' | 'hidden';
  showRunningHeader: boolean;
  showRunningFooter: boolean;
  runningHeaderFontSizePt: number;
}

export interface ColumnDesignSettings {
  columnCount: 1 | 2 | 3;
  columnGapPt: number;
  minColumnWidthPt: number;
  balanceColumns: boolean;
}

export interface PageElementsDesignSettings {
  showRunningHeader: boolean;
  showFolioNumber: boolean;
  showDecorativeFrame: boolean;
  runningHeaderFontSizePt: number;
  folioNumberPosition: 'top_outside' | 'top_center' | 'bottom_center' | 'bottom_outside' | 'hidden';
}

export interface RavTextDesignSettings {
  sourceFontFamily: string;
  rashiFontFamily: string;
  tosafotFontFamily: string;
  sourceFontSizePt: number;
  rashiFontSizePt: number;
  tosafotFontSizePt: number;
  sourceLineSpacingRatio: number;
  commentaryLineSpacingRatio: number;
  /** Relative size ratio commentary / source */
  commentaryToSourceScaleRatio: number;
  gutterWidthPt: number;
  upperCollarLines: number;
  upperCollarInwardStepPt: number;
  kneeJunctionPercent: number;
  lowerSourceWidthPercent: number;
  kneeStepDirection: 'auto' | 'left' | 'right' | 'none';
  kneeMode: 'auto' | 'manual';
  kneeSettings: KneeCustomSettings;
  minSourceWidthPt: number;
  minCommentaryWidthPt: number;
  rashiWidthRatio: number;
  tosafotWidthRatio: number;
  sourceExpansionBehavior: 'dynamic_contour' | 'balanced_vilna' | 'fixed_center';
  dibburHamatchilBold: boolean;
  dibburBold: boolean;
  dibburHamatchilFontSizeDeltaPt: number;
  dibburScalePercent: number;
  preferSamePageSourceCommentary: boolean;
  continuationMarkerStyle: 'traditional_hebrew' | 'minimal' | 'hidden';
}

export interface FootnoteDesignSettings {
  fontFamily: string;
  fontSizePt: number;
  lineSpacingPt: number;
  leadingPt: number;
  paragraphSpacingPt: number;
  showSeparatorRule: boolean;
  showSeparatorLine: boolean;
  separatorWidthRatio: number;
  separatorSpacingAbovePt: number;
  separatorSpacingBelowPt: number;
  indentPt: number;
  placement: 'bottom_of_page' | 'below_text';
  justifyMultiLineFootnotes: boolean;
  justifyMultiLineNonFinal: boolean;
  allowMultiPageContinuation: boolean;
}

export interface LocalFormattingOverride {
  id: string;
  /** Target ContentUnit ID */
  unitId: string;
  /** Optional word index range [startWordIndex, endWordIndex] within the unit; if omitted, applies to entire unit/paragraph */
  wordRange?: {
    startWordIndex: number;
    endWordIndex: number;
  };
  characterOverrides?: Partial<CharacterStyleSettings>;
  paragraphOverrides?: Partial<ParagraphStyleSettings>;
  createdAt: number;
  sourceActor: 'user' | 'ai';
}

export interface DesignSelectionTarget {
  /** Selected ContentUnit IDs (1 for single selection, >1 for multi-selection) */
  unitIds: string[];
  /** Primary role of selection */
  role?: ContentRole;
  /** Selected word index within unit */
  wordIndex?: number;
  /** Selected word text */
  wordText?: string;
  /** Whether a Rav Text commentary/source zone is focused */
  isRavTextZone?: boolean;
}

export interface EffectiveResolvedFormatting {
  targetScope: 'document' | 'role' | 'unit' | 'word_range' | 'mixed_selection';
  sourceScope: DesignScopeLevel;
  activeRole: ContentRole;
  styleTier: DesignStyleTier;
  hasLocalOverride: boolean;
  localOverrideIds: string[];
  /** Fields where multiple selected items have different values -> reported as "Mixed" */
  mixedFields: string[];
  character: CharacterStyleSettings;
  paragraph: ParagraphStyleSettings;
  fontAvailability: {
    requestedFont: string;
    isAvailableOnSystem: boolean;
    effectiveFallbackFont?: string;
    warningMessage?: string;
  };
}

export interface ProfessionalDesignSettings {
  projectId?: string;
  version: number;
  revision: number;
  updatedAt: number;
  lastModifiedBy: 'user' | 'ai' | 'system';
  lastModificationSummary?: string;
  /** Document-level default layout type */
  layoutType: BookLayoutType;
  /** Page & margin & column configuration */
  pageLayout: PageLayoutDesignSettings;
  /** Alias for pageLayout used by UI and App */
  layout: PageLayoutDesignSettings;
  /** Column settings */
  columns: ColumnDesignSettings;
  /** Page elements (headers, folios, borders) */
  pageElements: PageElementsDesignSettings;
  /** Rav Text & Dynamic Knee typography & geometry parameters */
  ravText: RavTextDesignSettings;
  /** Footnote typography, separator & continuation parameters */
  footnotes: FootnoteDesignSettings;
  /** Resolved role styles map for direct read access (`roleStyles[role].character / .paragraph`) */
  roleStyles: Record<SemanticStyleRole, RoleDesignStyle>;
  /** Alias for global built-in role styles */
  globalRoleStyles?: Record<SemanticStyleRole, RoleDesignStyle>;
  /** Project-level overrides per semantic ContentRole (sparse partial overrides over GLOBAL_STYLE) */
  projectRoleStyles: Partial<Record<SemanticStyleRole, {
    character?: Partial<CharacterStyleSettings>;
    paragraph?: Partial<ParagraphStyleSettings>;
  }>>;
  /** Local formatting overrides on specific units or word ranges */
  localOverrides: LocalFormattingOverride[];
  /** Indexed local unit overrides map (`unitId -> { character?, paragraph? }`) */
  localUnitOverrides: Record<string, {
    character?: Partial<CharacterStyleSettings>;
    paragraph?: Partial<ParagraphStyleSettings>;
  }>;
  /** Indexed local word overrides map (`"${unitId}:${wordIndex}" -> Partial<CharacterStyleSettings>`) */
  localWordOverrides: Record<string, Partial<CharacterStyleSettings>>;
}
