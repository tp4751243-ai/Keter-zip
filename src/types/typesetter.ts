/**
 * Keter Typesetter - Semantic Document Model & Constraint-Solving Layout Engine Types
 * Supports full Hebrew Sifrei Kodesh semantic hierarchy, keep-together priorities,
 * line-by-line dynamic Rav-Text contours, multi-candidate optimization scores,
 * look-ahead page balancing, ornaments, nikud control, and project persistence.
 */

export type BookLayoutType =
  | 'rav_text'                        // ש״ס וילנא / רב-טקסט עם ברכיים דינמיות
  | 'single_column'                   // טקסט רץ רגיל (מוסר, הלכה, דרוש, שו״ת)
  | 'two_column'                      // שני טורים (שולחן ערוך, סידור, משניות)
  | 'source_top_commentary_bottom'    // מקור עליון + מפרשים למטה (רמב״ם, משנה ברורה)
  | 'mikraot_gedolot'                 // מקראות גדולות (חומש, תרגום ומפרשים)
  // v0.8.0 Part D — Yiddish sefarim: Hebrew source in the right column,
  // Yiddish text (Tzenerene / translation / commentary) in the left column,
  // or Yiddish-only running text full-width when no Hebrew stream exists.
  // Paginated by `paginateYiddishSefer` (pagination-engine.ts).
  | 'yiddish_sefer'
  // v0.5.0 Part C — Module 3: user-drawn text boxes over a base layout.
  // Pagination falls back to the base layout's solver (see
  // `CustomLayoutDesign.baseLayout`); the boxes drive the Custom Layout
  // Designer preview + `planCustomLayoutFlow` reflow planner, and the
  // one-line PaginationEngine dispatch for it is listed in REPORT.md.
  | 'custom_layout';

/**
 * v0.3.0 (Module C) — Folio / running-header placement.
 * `top_inside` is the 6th position: top of the page on the binding (inside)
 * side — right edge on a recto page, left edge on a verso page of an RTL book.
 */
export type HeaderFolioPosition =
  | 'top_outside'
  | 'top_center'
  | 'top_inside'
  | 'bottom_center'
  | 'bottom_outside'
  | 'hidden';

/**
 * v0.3.0 (Module C) — Per-tier configuration for multi-text pages.
 * One entry per text tier on the page (main source + up to 6 comment tiers).
 * Tiers 1-3 map to the existing roles (`primary_comment`, `secondary_comment`,
 * `tertiary_comment`); tiers 4-6 reuse `tertiary_comment` with a distinct
 * `tierIndex` + `labelHe`/`labelEn` until the pagination engine gains native
 * tier-4..6 rendering (see `RENDERED_COMMENT_TIERS`).
 */
export interface TierConfig {
  /** Semantic role of the tier's text (tiers 4-6 reuse `tertiary_comment`). */
  role: ContentRole;
  /** 1-based position in the page's tier list (1 = first tier, usually the main source). */
  tierIndex: number;
  /** Display name, e.g. 'רש״י' / 'ט״ז' / 'אבן עזרא'. */
  labelHe?: string;
  labelEn?: string;
  /** Share of the content width this tier's column/zone occupies (5..90). */
  widthPct?: number;
  fontFamily?: string;
  fontSizePt?: number;
  /** Line-height multiplier (1.0..2.2). */
  lineHeight?: number;
  /** Where the tier sits on the page (rav-text flanks / below-source zones). */
  side?: 'inside' | 'outside' | 'left' | 'right' | 'below';
}

/** Maximum number of comment tiers a multi-text page may configure (v0.3.0). */
export const MAX_COMMENT_TIERS = 6;
/**
 * Comment tiers the pagination engine actually renders today (tiers 1-3:
 * primary / secondary / tertiary). Tiers 4-6 are config + presets only for now;
 * see `src/engine/balance-engine.ts` notes and the v0.3.0 module-C report.
 */
export const RENDERED_COMMENT_TIERS = 3;

export type ContentRole =
  | 'book'
  | 'main_title'         // Main Title (שער / כותרת ראשית)
  | 'subtitle'           // Subtitle (כותרת משנה)
  | 'introduction'       // Introduction (הקדמה / מבוא)
  | 'chapter'            // Chapter / Perek (פרק)
  | 'siman'              // Siman (סימן)
  | 'seif'               // Se'if (סעיף)
  | 'heading'            // Heading (כותרת)
  | 'subheading'         // Subheading (כותרת משנית)
  | 'main_source'        // Main Source Text (גמרא, משנה, חומש, שולחן ערוך)
  | 'verse'              // Verse / Pasuk (פסוק)
  | 'regular_paragraph'  // Regular Paragraph (פסקה רגילה)
  | 'bold_special'       // Bold / Special Text (טקסט מודגש / מיוחד)
  | 'primary_comment'    // Primary Commentary (רש״י, אונקלוס, ט״ז)
  | 'secondary_comment'  // Secondary Commentary (תוספות, רמב״ן, ש״ך)
  | 'tertiary_comment'   // Tertiary Commentary (עין משפט, מסורת הש״ס, באר היטב)
  | 'dibbur_hamatchil'   // Dibbur HaMatchil (דיבור המתחיל)
  | 'footnote'           // Footnote (הערת שוליים)
  | 'side_note'          // Side Note / Gilyon (הערת צד / גליון הש״ס)
  | 'cross_reference'    // Cross-reference (מראה מקום / הפניה)
  | 'ornament'           // Ornament / Graphic Asset (עיטור / מסגרת)
  | 'continuation'       // Continuation Marker (המשך מעמוד קודם / המשך בעמוד הבא)
  | 'page_element'       // Page-level running header / folio
  | 'table'              // Tables
  | 'image'              // Images / Diagrams
  | 'chart'              // Charts
  | 'caption'            // Captions
  | 'list_item';         // Lists

/**
 * v0.8.0 Part D — which kind of Yiddish structure a unit belongs to.
 * Carried on `ContentUnit.yiddishKind` (set by the .docx importer /
 * `classifyYiddishParagraph` / `reclassifyYiddishUnits`); the pagination
 * engine partitions on it, never on a new ContentRole, so the existing
 * role streams, tiers and exporters keep working unchanged.
 * - 'tzenerene': Tzenerene (Tzena Urena) — Yiddish commentary woven
 *   around the weekly parsha; also its parsha headings.
 * - 'chassidic_commentary': Chassidic Yiddish commentary.
 * - 'translation': Yiddish translation of a Hebrew source.
 * - 'biur': Biur — Yiddish explanation / elucidation.
 * - 'hebrew_source': the Hebrew source facing a Yiddish text.
 * - 'yiddish_text': Yiddish running text of no more specific kind.
 */
export type YiddishKind =
  | 'tzenerene'
  | 'chassidic_commentary'
  | 'translation'
  | 'biur'
  | 'hebrew_source'
  | 'yiddish_text';

/**
 * Keep-Together Priority Levels
 * Controls editorial unit preservation and page-break cost calculation
 */
export enum KeepPriority {
  SOURCE_COMMENTARY = 100, // Source + directly related commentary must stay aligned
  DIBBUR_COMMENTARY = 90,  // Dibbur HaMatchil + beginning of commentary
  HEADING_PARAGRAPH = 80,  // Heading / Chapter + following opening paragraph
  PARAGRAPH = 60,          // Complete paragraph unit
  SENTENCE = 40,           // Sentence boundary
  LINE = 20,               // Individual line
}

export interface SemanticTypographyStyle {
  id: string;
  name: string;
  role: ContentRole;
  fontFamily: string;
  fontSizePt: number;
  weight: number;
  italic: boolean;
  lineHeight: number;          // Multiplier, e.g. 1.18
  tracking: number;            // Letter spacing in em
  justification: 'justify' | 'right' | 'center' | 'left';
  indentation: number;         // Right/start indent in pt
  paragraphSpacing: number;    // Space after paragraph in pt
  firstLineIndent: number;     // First line indent in pt
  minLineLength: number;       // Minimum acceptable line width in pt
  maxLineLength: number;       // Maximum acceptable line width in pt
  language: 'he' | 'en' | 'ar' | 'mixed';
  direction: 'rtl' | 'ltr';
  punctuationBehavior: 'hanging' | 'standard' | 'rabbinic';
  hyphenationRules: 'none' | 'hebrew_maqaf' | 'standard';
}

export interface TextStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSizePt: number;
  lineSpacingPt: number;
  spaceBeforePt: number;
  spaceAfterPt: number;
  textAlign: 'right' | 'left' | 'center' | 'justify';
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  textColor: string;
}

export interface HebrewGlyph {
  char: string;
  codepoint: number;
  codepointHex: string;
  cluster: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  isMark: boolean;
  markType?: 'nikud' | 'taam' | 'dagesh' | 'shin_dot';
  markName?: string;
  markNameHe?: string;
}

export interface TextRun {
  text: string;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  isDibbur?: boolean;
  /** v0.9.8 Phase 2 — run is a parenthesised Mareh Mekomos citation span (rendered slightly smaller). */
  isCitation?: boolean;
  /** v0.9.8 Phase 2 — run is a Rema gloss (הגה: …; rendered in Rashi script inline). */
  isRemaGloss?: boolean;
  fontSizePt?: number;
  fontFamily?: string;
  footnoteMarker?: number | string;
  footnoteUnitId?: string;
  footnoteAnchorWordIndex?: number;
  /** v0.9.8 Phase 2 — exact character offset of the footnote anchor in the parent paragraph text. */
  footnoteAnchorCharOffset?: number;
}

/**
 * v0.9.8 Phase 2 — structured Dibbur HaMatchil token.
 * Wraps the dibbur the importer already detected (bold lead / delimiter /
 * source match) in one node so the later CommentaryLinkerEngine can
 * consume it without re-parsing raw text. `confidence` follows the
 * importer's 0–1 scale (≥0.8 = confident, <0.8 goes to the review queue).
 */
export interface DibburNode {
  /** Stable id within its unit: `dibbur-<unitId>`. */
  id: string;
  /** The dibbur text exactly as printed (with nikud if the source has it). */
  rawText: string;
  /** Nikud/taamim-stripped, normalised text used for matching. */
  normalizedText: string;
  /** Source unit this dibbur anchors to, when known. */
  targetAnchorId?: string;
  /** 0–1 confidence of the detection. */
  confidence: number;
  /** How the dibbur was found. */
  method: 'explicit-dalet-he' | 'bold-lead' | 'delimiter' | 'source-match';
}

export interface ShapedWord {
  text: string;
  glyphs: HebrewGlyph[];
  width: number;
  isSpace: boolean;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  isDibbur?: boolean;
  /** v0.9.8 Phase 2 — word comes from a citation span (slightly smaller). */
  isCitation?: boolean;
  /** v0.9.8 Phase 2 — word comes from a Rema gloss (Rashi script). */
  isRemaGloss?: boolean;
  unitId?: string;
  role?: ContentRole;
  linkedSourceId?: string;
  linkId?: string;
  isParagraphEnd?: boolean;
  footnoteMarker?: number | string;
  footnoteUnitId?: string;
  fontSizePt?: number;
  fontFamily?: string;
  fontWeight?: number;
  trackingEm?: number;
  wordSpacingRatio?: number;
  horizontalScalePercent?: number;
  baselineShiftPt?: number;
  textColor?: string;
}

export type ParagraphIndentMode =
  | 'none'
  | 'first_line'
  | 'hanging'
  | 'chalon_second_line'
  | 'chalon_window'
  | 'chalon_all';

export type SeparatorStyleId =
  | 'none'
  | 'colon'
  | 'colon_dot'
  | 'thin_rule'
  | 'centered_diamond'
  | 'double_rule'
  | 'scrolled_divider';

export type DafFormatMode = 'dots' | 'amud_hebrew' | 'gematria' | 'numbers';

export type PeripheralStreamKind =
  | 'ein_mishpat'
  | 'ner_mitzvah'
  | 'masoret_hashas'
  | 'torah_or'
  | 'gilyon_hashas'
  | 'hagahot_habach'
  | 'rabbeinu_chananel'
  | 'ran'
  | 'maharsha';

export interface OpeningWordBoxGeom {
  xLeft: number;
  xRight: number;
  yTop: number;
  yBottom: number;
  text: string;
  styleId: string;
  unitId?: string;
  isCentered?: boolean;
}

/**
 * Layout training T2.1 — the Vilna running head, fully laid out by the
 * engine (see engine/vilna-header.ts). PHYSICAL page coordinates (pt from
 * the page's top-left corner); every word is pre-measured, so renderers
 * draw each word at [xLeft, xRight] on `yBaseline` and never re-measure.
 */
export interface VilnaHeaderItem {
  kind: 'title' | 'folio';
  words: Array<{ text: string; xLeft: number; xRight: number }>;
  xLeft: number;
  xRight: number;
  yBaseline: number;
  fontSizePt: number;
  fontWeight: number;
  fontFamily: string;
}

export interface VilnaHeaderGeom {
  items: VilnaHeaderItem[];
  perekNumber?: number;
  perekName: string;
  masechet: string;
  folio: string;
}

export interface TransitionMarkerGeom {
  label: string;
  xLeft: number;
  xRight: number;
  yBaseline: number;
  yTop: number;
  yBottom: number;
  unitId: string;
  confidence: number;
  verified: boolean;
}

export interface PeripheralStreamBlock {
  stream: PeripheralStreamKind;
  labelHe: string;
  labelEn: string;
  side: 'inside' | 'outside' | 'below';
  lines: TypesetLine[];
}

export interface StructuredDiagnostic {
  id: string;
  code: string;
  severity: 'critical' | 'warning' | 'info';
  category:
    | QaIssue['category']
    | 'overflow'
    | 'boundary'
    | 'peripheral'
    | 'folio'
    | 'preflight';
  messageHe: string;
  messageEn: string;
  pageNumber?: number;
  physicalPageNumber?: number;
  unitId?: string;
  fixAction?: {
    labelHe: string;
    labelEn: string;
    kind:
      | 'navigate_unit'
      | 'navigate_page'
      | 'widen_column'
      | 'adjust_knee'
      | 'enable_manual_boundary'
      | 'toggle_peripheral'
      | 'clear_local_override'
      | 'review_dibbur';
    payload?: Record<string, unknown>;
  };
}

export type LineZoneType =
  | 'upper_collar'            // Top lines above Gemara
  | 'flanking_source'         // [Commentary][Source][Commentary]
  | 'single_side_wrap'        // [Commentary][Source] when opposite commentary ended
  | 'stepped_knee'            // Stepped L-wrap around narrowed source
  | 'lower_split_commentary'  // [Commentary][Commentary] side-by-side below source
  | 'lower_full_span';        // Single remaining commentary spanning full width below source

export interface OccupiedRegion {
  id: string;
  role: ContentRole;
  xLeft: number;              // Physical page coordinate X left (pt)
  xRight: number;             // Physical page coordinate X right (pt)
  yTop: number;               // Physical page coordinate Y top (pt)
  yBottom: number;            // Physical page coordinate Y bottom (pt)
  unitId?: string;
}

export interface HorizontalInterval {
  xLeft: number;              // Content-relative X left [0 .. contentWidth]
  xRight: number;             // Content-relative X right [0 .. contentWidth]
  width: number;              // xRight - xLeft
}

export interface TypesetLine {
  lineIndex: number;
  words: ShapedWord[];
  width: number;
  targetWidth: number;
  xStart: number;            // Offset from column right edge (or page right margin)
  xLeft?: number;            // Explicit left X coordinate in page content space [0..contentWidth]
  xRight?: number;           // Explicit right X coordinate in page content space [0..contentWidth]
  yBaseline: number;
  yTop?: number;             // yBaseline - ascent (content-relative)
  yBottom?: number;          // yBaseline + descent (content-relative)
  height: number;
  ascent: number;
  descent: number;
  isLastLine: boolean;
  isJustified: boolean;
  extraSpacePerWord: number;
  role: ContentRole;
  unitId: string;
  columnNumber?: number;     // 1, 2, or 3 for multi-column layouts
  zoneType?: LineZoneType;
  /** v0.6.0 Part C (§2/§6): id of the custom-layout box that placed this
   *  line (only on `custom_layout` pages). PageCanvas groups lines by it
   *  to draw the movable box frames in the main preview. */
  customLayoutBoxId?: string;
  keepPriority?: KeepPriority;
  fontFamily?: string;
  fontSizePt?: number;
  fontWeight?: number;
  isItalic?: boolean;
  isUnderline?: boolean;
  textColor?: string;
  alignment?: 'justify' | 'right' | 'center' | 'left';
  paragraphAlignment?: 'justify' | 'right' | 'center' | 'left';
  lastLineAlignment?: 'right' | 'left' | 'center' | 'justify';
  direction?: 'rtl' | 'ltr' | 'auto';
  leadingPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  firstLineIndent?: number;
  firstLineIndentPt?: number;
  rightIndentPt?: number;
  leftIndentPt?: number;
  hangingIndentPt?: number;
  trackingEm?: number;
  wordSpacingRatio?: number;
  horizontalScalePercent?: number;
  baselineShiftPt?: number;
  /** Semantic layout boundary markers (never injected into rawText) */
  unitBoundaryAfter?: boolean;
  transitionMarkerBefore?: string;
  transitionMarkerConfidence?: number;
  transitionMarkerVerified?: boolean;
  isOpeningBoxAnchor?: boolean;
  /** Layout training T2.4 — per-line separator (e.g. the flourish between Vilna margin sections). */
  separatorStyleIdOverride?: SeparatorStyleId;
  openingBoxWordsCount?: number;
}

export interface SourceContourBand {
  yTop: number;
  yBottom: number;
  sourceXLeft: number;
  sourceXRight: number;
  sourceWidth: number;
  leftAvailableWidth: number;
  rightAvailableWidth: number;
  zoneType: LineZoneType;
}

export interface DynamicKneeContour {
  pageContentWidth: number;
  pageContentHeight: number;
  topY: number;
  upperKneeY?: number;          // Y position where upper ~4 lines of commentary end and Gemara starts
  upperKneeLines?: number;      // Number of lines of Rashi/Tosafot running above the Gemara (default 4)
  upperKneeInwardStep?: number; // Inward expansion of commentary in upper knee (e.g. 24pt)
  kneeJunctionY: number;        // Y position where source narrows or ends
  sourceEndY?: number;          // Exact Y position where center source text ends
  bottomY: number;
  upperSourceWidth: number;
  lowerSourceWidth: number;
  innerXOffset: number;
  isLeftStepped: boolean;
  rightCommentaryWidth: number;
  leftCommentaryWidth: number;
  lowerRightCommentaryWidth?: number;
  lowerLeftCommentaryWidth?: number;
  gutterWidth: number;
  isManualOverride?: boolean;
  hasLowerSplitZone?: boolean;  // True when [Rashi][Tosafot] meet side-by-side below Source
  sourceContourBands?: SourceContourBand[]; // Stage 3: Line-by-line 2D source contour & available commentary intervals
}

export interface KneeCustomSettings {
  mode: 'auto' | 'manual';
  upperKneeLines?: number;      // e.g. 4 lines of Rashi/Tosafot above Gemara source
  upperKneeInwardStep?: number; // Inward expansion of commentary in upper knee (pt)
  junctionPercent: number;      // e.g. 50 (for 50% of page height)
  lowerWidthPercent: number;    // e.g. 70 (for 70% of upper width)
  stepDirection: 'auto' | 'left' | 'right' | 'none';
  gutterWidth: number;
}

export interface LayoutQualityScore {
  totalScore: number;               // 0 - 100 composite score
  pageUtilization: number;          // 0 - 100 (target 78% - 92% density)
  verticalBalance: number;          // Alignment of column bottoms
  horizontalBalance: number;        // Symmetry & proportional balance of columns
  whitespaceScore: number;          // Absence of awkward trapped empty pockets
  textDensity: number;              // Comfortable rabbinic density
  readability: number;              // Line length & spacing comfort
  sourceCommentaryAlignment: number;// Proximity of commentary to its linked source
  semanticPreservation: number;     // Keep-together priority satisfaction
  widowOrphanPenalty: number;       // 0 if no widows/orphans
  lineBreakPenalty: number;         // Penalty for awkward breaks
  stretchingCompressionPenalty: number; // Word spacing distortion penalty
  continuationQuality: number;      // Cleanliness of page-to-page commentary flow
  visualHierarchyScore: number;     // Distinctiveness of source vs commentary vs headings
  collisionCount?: number;          // Number of detected visual overlaps (must be 0 for valid layout)
  narrowColumnPenalty?: number;     // Penalty if any column violates minimum readable width
  hardErrorCount?: number;          // Total hard errors (collisions, clipping, overflow, lost text, broken links)
  softQualityScore?: number;        // 0 - 100 soft typographic quality score measured from physical geometry
  oneWordTailCount?: number;        // Count of stranded 1-word paragraph/heading tails
  raggedMidParagraphCount?: number; // Count of non-final multi-word lines that failed to justify
  abruptWidthStepCount?: number;    // Count of undesirable 1-line width steps
  hardRuleViolationCount?: number;  // Stage 12: Count of hard typesetting rule violations
  engineHardRuleViolationCount?: number; // Stage 12 Level 0: Count of Engine Hard Rule violations
  professionalRuleViolationCount?: number; // Stage 12: Count of professional default rule violations
  disqualifiedByHardRule?: boolean; // Stage 12: True if candidate violated an Engine Hard Rule or Hard User Rule
  disqualifiedByEngineHardRule?: boolean; // Stage 12 Level 0: True if candidate violated an Engine Hard Rule
  candidatesEvaluated: number;      // Number of candidate layouts tested by solver
  lookAheadAdjusted: boolean;       // Whether look-ahead shifted content for next page
  editorialDecisions: string[];     // Explanations of automatic typesetting decisions
}

export type OrnamentPlacement =
  | 'chapter_opening'
  | 'topic_ending'
  | 'section_beginning'
  | 'header'
  | 'footer';

export interface OrnamentAsset {
  id: string;
  name: string;
  placement: OrnamentPlacement;
  format: 'svg_builtin' | 'png' | 'pdf';
  svgPathOrDataUrl: string;
  widthPt: number;
  heightPt: number;
  isUserUploaded?: boolean;
}

export interface OrnamentUserRule {
  ornamentId: string;
  placement: OrnamentPlacement;
  targetRole?: ContentRole;
  targetUnitId?: string;
}

export interface PlacedOrnament {
  asset: OrnamentAsset;
  x: number;
  y: number;
  width: number;
  height: number;
  unitId?: string;
}

export interface TableCell {
  id: string;
  content: string;
  colSpan?: number;
  rowSpan?: number;
}

export interface TableRow {
  id: string;
  cells: TableCell[];
  isHeader?: boolean;
}

export interface TableData {
  id?: string;
  rows: TableRow[] | any[];
  colCount?: number;
  headers?: string[];
}

export interface ContentUnit {
  id: string;
  role: ContentRole;
  rawText: string;
  styleName: string;
  order: number;
  hierarchyLevel: number;
  parentId?: string;
  childIds?: string[];
  
  // Semantic attributes
  dibburHamatchil?: string;
  /** v0.9.8 Phase 2 — structured dibbur token (see DibburNode). */
  dibburNode?: DibburNode;
  /**
   * v0.9.8 Phase 3 — AnchorLink this commentary unit resolved to (see
   * AnchorLink). Set by CommentaryLinker when it links the unit's
   * dibbur to a source unit; the paginator reads it for same-page
   * gravity. Absent when the unit was never linked by the new engine.
   */
  anchorLink?: AnchorLink;
  /**
   * v0.9.8 Phase 4 — ids of the commentary units anchored to THIS
   * (source) unit, stamped by
   * `attachAnchoredCommentaries` (synchronized-pagination). The
   * same-page planner reads it so a source block never paginates
   * without room for its anchored commentaries.
   */
  anchoredCommentaryIds?: string[];
  chapterTitle?: string;
  /**
   * Layout training T12 — which uploaded file the unit came from (0-based,
   * in upload order). A multi-file import concatenates the files; this
   * lets structure (chapter / pasuk numbering) restart per file.
   */
  importFileIndex?: number;
  simanNumber?: string;
  seifLetter?: string;
  /** v0.9.8 Phase 2 — unit contains at least one Rema gloss span. */
  hasRemaGloss?: boolean;
  linkedSourceId?: string;
  linkedCommentaryIds?: string[];
  keepPriority?: KeepPriority;
  keepWithNext?: boolean;
  doNotSplit?: boolean;
  language?: 'he' | 'en' | 'yi' | 'mixed';
  /** v0.8.0 Part D — Yiddish structure kind (see `YiddishKind`). */
  yiddishKind?: YiddishKind;
  ornamentId?: string;

  // Rich data
  textRuns?: TextRun[];
  tableData?: any;
  imageData?: any;
  footnoteNumber?: number;
  docxFootnoteId?: string;
  footnoteAnchorUnitId?: string;
  footnoteAnchorWordIndex?: number;
  /** v0.9.8 Phase 2 — exact character offset of the anchor in the parent paragraph. */
  footnoteAnchorCharOffset?: number;
  /** v0.3.0 (Module E): explicit side-by-side parallel group id (source + translation / versions). */
  parallelGroupId?: string;
}

/**
 * v0.9.8 Phase 3 — one resolved Dibbur HaMatchil → source anchor.
 * Produced by CommentaryLinker (engine/commentary-linker.ts) from the
 * Phase 2 DibburNode (or the importer's dibburHamatchil when no node
 * exists). `targetCharOffset` is the character offset of the first
 * matched word inside the target source unit's rawText; `linkConfidence`
 * follows the importer's 0–1 scale (≥0.8 confident, <0.8 review queue).
 * Lives in types (not the linker module) so ContentUnit, the paginator
 * and the review queue can all reference it without a circular import.
 */
export interface AnchorLink {
  /** Stable id: `anchor-<commentaryUnitId>`. */
  linkId: string;
  /** The commentary unit whose dibbur this is. */
  commentaryUnitId: string;
  /** DibburNode id when the dibbur came from Phase 2 tokenisation. */
  dibburId?: string;
  /** The dibbur text exactly as printed (with nikud if present). */
  dibburText: string;
  /** Source unit the dibbur anchors to — undefined when unmatched. */
  targetMainNodeId?: string;
  /** Character offset of the first matched word in the target unit. */
  targetCharOffset?: number;
  /** Word index of the first matched word in the target unit. */
  targetWordIndex?: number;
  /** 0–1 confidence of the match. */
  linkConfidence: number;
  /** How the anchor was found. */
  method: 'exact' | 'fuzzy' | 'contextual' | 'unmatched';
  /** Where the dibbur text itself came from. */
  dibburSource: 'dibbur-node' | 'dibbur-field' | 'source-match' | 'none';
  /** The source text that was actually matched, when known. */
  matchedText?: string;
}

/**
 * v0.9.8 Phase 3 — LinkingReport: the outcome of one linking run,
 * surfaced in the existing import review queue (DocxImportHub) — no
 * second review UI. `reviewCount` = linked but below the 0.8 threshold
 * (held for review); `unmatched` = no direct match found at all.
 */
export interface LinkingReport {
  /** Commentary units that carried a dibbur (nodes + fields + detected). */
  totalDibburim: number;
  /** Links with a real target (exact + fuzzy + contextual). */
  linkedCount: number;
  /** Linked with confidence ≥ 0.9. */
  highConfidenceCount: number;
  /** Linked with 0.8 ≤ confidence < 0.9. */
  mediumConfidenceCount: number;
  /** Linked with confidence < 0.8 — held for the review queue. */
  reviewCount: number;
  /** No direct match found (kept visible via a low-confidence link). */
  unmatchedCount: number;
  /** The unmatched entries (subset of `links`). */
  unmatched: AnchorLink[];
  /** Every link produced by the run, in commentary order. */
  links: AnchorLink[];
}

export interface RavTextLink {
  linkId: string;
  sourceUnitId: string;
  commentaryUnitId: string;
  dibburHamatchil: string;
  sourcePhrase?: string;
  isUserLocked: boolean;
  confidenceScore: number;
  /**
   * v0.3.0: structured confidence detail for the dibur-hamatchil match
   * (same shape as `MatchConfidence` in engine/docx-importer.ts, kept
   * structural here to avoid a type-only circular import).
   * Matches below 0.8 are held for manual review, never applied silently.
   */
  matchConfidence?: {
    score: number;
    reasonHe: string;
    reasonEn: string;
    matchedText?: string;
  };
  sourceSnippet: string;
  commentarySnippet: string;
  commentaryType: 'Rashi' | 'Tosafot' | 'Ramban' | 'Onkelos' | 'SideNote' | 'Yiddish' | 'Other';
}

export interface LinkedRavGroup {
  groupId: string;
  sourceUnits: ContentUnit[];
  rashiUnits: ContentUnit[];
  tosafotUnits: ContentUnit[];
  links: RavTextLink[];
  sourceShapedWords: ShapedWord[];
  rashiShapedWords: ShapedWord[];
  tosafotShapedWords: ShapedWord[];
  requiredAreaPt2: number;
  sourceAreaPt2: number;
  rashiAreaPt2: number;
  tosafotAreaPt2: number;
}

export interface PageGeometry {
  pageWidth: number;     // points (72 pt = 1 inch)
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  marginInside: number;  // binding gutter
  marginOutside: number;
  isVerso: boolean;      // left vs right in spread
  /**
   * Layout training T3.1 (right-bound Hebrew book) — physical x of the
   * text block's LEFT edge on this page. A Hebrew book binds on the
   * right: a recto is the LEFT-hand page and binds on its right edge, so
   * its left margin is the OUTSIDE margin; a verso binds on its left, so
   * its left margin is the INSIDE margin. Set per body page by the
   * paginator; read through `textBlockLeft()` by every renderer.
   */
  textLeftPt?: number;
}

/** Physical x of the text block's left edge (see PageGeometry.textLeftPt). */
export function textBlockLeft(g: PageGeometry): number {
  return g.textLeftPt ?? g.marginInside;
}

/** Physical x of the text block's right edge. */
export function textBlockRight(g: PageGeometry): number {
  return textBlockLeft(g) + (g.pageWidth - g.marginInside - g.marginOutside);
}

export interface LocalFontEntry {
  family: string;
  displayNameHe: string;
  postScriptName?: string;
  suitabilityScore: number;
  hasHebrew: boolean;
  hasNikud: boolean;
  hasTaamim: boolean;
  hasGposMark: boolean;
  hasGposMkmk: boolean;
  recommendedRole: 'main_source' | 'rashi' | 'tosafot' | 'general';
}

export interface FontCapability {
  family: string;
  postScriptName?: string;
  hasHebrew: boolean;
  hasNikud: boolean;
  hasTaamim: boolean;
  hasGposMark: boolean;
  hasGposMkmk: boolean;
  hasGsubLigature: boolean;
  suitabilityScore: number;
  notes: string;
  recommendedRole: 'main_source' | 'rashi' | 'tosafot' | 'general';
}

export interface PageTypesetResult {
  pageIndex: number;
  pageNumber: number;
  /** 1-based physical PDF/print page index including front matter (title page, TOC) */
  physicalPageNumber?: number;
  /** 0-based index among body pages only (excludes title page & front matter) */
  bodyPageIndex?: number;
  /** Formatted traditional folio / Daf label (e.g. 'ב.', 'ב:', 'ב ע״א', 'ב׳', '2') */
  folioDisplay?: string;
  pageNumberHebrew: string;
  headerTitle: string;
  layoutType: BookLayoutType;
  geometry: PageGeometry;
  
  // Lines grouped for the page
  sourceLines: TypesetLine[];
  rashiLines: TypesetLine[];
  tosafotLines: TypesetLine[];
  footnoteLines: TypesetLine[];
  sideNoteLines?: TypesetLine[];
  column2Lines?: TypesetLine[]; // for two-column layout
  /**
   * v0.8.0 Part C (§1): tertiary-commentary band lines (Ein Mishpat, Ner
   * Mitzvah, Torah Or, Masoret HaShas, cross-references, side notes) —
   * the fourth rav-text stream, laid in a full-width band below the knee
   * and above the footnotes. Rendered by PageCanvas, PDF and IDML like
   * the other streams. Empty/absent when the book has no such units.
   */
  tertiaryLines?: TypesetLine[];
  /**
   * v0.8.0 Part C (§7): the centred decorative Michtav box above the
   * Gemara on the first Vilna page (only when `ravText.michtavEnabled`
   * is on). Rendered by PageCanvas and PDF; the box geometry is the
   * `buildMichtavBox` result, its text is the Michtav text.
   */
  michtavBox?: import('../types/design-settings').CustomLayoutBox;
  /** Opening word frame around Masechet opening word(s) or Sefer opening phrase */
  openingWordBox?: OpeningWordBoxGeom;
  /** Layout training T2.1 — Vilna running head (replaces the generic header + folio when set). */
  vilnaHeader?: VilnaHeaderGeom;
  /** Layout training T2.4 — Vilna marginal apparatus columns (content coordinates of the full page). */
  marginLines?: TypesetLine[];
  /** Layout training T7 — Mikraot Gedolot: index of the page's first pasuk (for the sefer · perek head). */
  chumashFirstPasuk?: number;
  /** Layout training T7 — headings (perek / parsha) that open on this page. */
  chumashHeadings?: string[];
  /** Layout training T8 — prose pages: the perek in effect on the page (for the book · perek head). */
  runningChapter?: string;
  /** Layout training T12 — a Mikraot Gedolot introduction page (commentary הקדמה, no pesukim). */
  chumashIntro?: boolean;
  /** Talmud: the amud this page sets ("ב.", "ב:"), from the import's דף headings — one amud per page. */
  amudKey?: string;
  /**
   * Layout training T2.2 — set on the page where the knee solver reserved
   * the opening frame's space at the top of the Gemara column; the frame
   * is then placed in that space (never by shifting lines).
   */
  openingFrameReserved?: { boxHeightPt: number; gapBelowPt: number; widthRatio: number };
  /** Verified Mishnah->Gemara transition markers placed visually before lines */
  transitionMarkers?: TransitionMarkerGeom[];
  /** Optional peripheral commentator/reference streams (zero width reserved when empty) */
  peripheralStreams?: PeripheralStreamBlock[];
  /** Structured header texts resolved for this page */
  structuredHeaders?: { rightText?: string; leftText?: string; centerText?: string };
  
  // Knee contour (for rav-text)
  knee: DynamicKneeContour;
  
  // For top-source bottom-commentary
  dividerY?: number;

  // Selected fonts for the page
  sourceFontFamily?: string;
  rashiFontFamily?: string;
  tosafotFontFamily?: string;
  designSettings?: any;

  // Optimization & Editorial Metadata
  layoutScore?: LayoutQualityScore;
  occupiedRegions?: OccupiedRegion[];
  placedOrnaments?: PlacedOrnament[];
  activeLinks?: RavTextLink[];
  continuationHeader?: string;
  continuationFooter?: string;
  continuedUnitIdsFromPrevPage?: string[];
  continuedUnitIdsToNextPage?: string[];
  splitLinkIdsFromPrevPage?: string[];
  splitLinkIdsToNextPage?: string[];
  /** v0.3.0 (Module E): optional page background (color / image) for image-only / cover pages. */
  pageBackground?: { color?: string; imageUrl?: string };
  /** v0.3.0 (Module E): true when the page holds images only (e.g. scanned haskama). */
  isImageOnlyPage?: boolean;
  /**
   * v0.8.0 Part E: the image units rendered on this image-only page, in
   * display order. Lets the canvas and the exporters show exactly this
   * page's images instead of every image in the book.
   */
  imageUnitIds?: string[];
  /**
   * v0.8.0 Part E: the image payloads for this image-only page, carried on
   * the page so renderers that only receive the page (native PDF, IDML)
   * can draw them without the full unit list.
   */
  pageImages?: Array<{ dataUrl: string; fileName?: string; altText?: string; widthPx?: number; heightPx?: number }>;
  /**
   * v0.5.0 (Title Page / Shaar Blat builder): true when this page IS the
   * title page — a synthetic first page built by `buildTitlePageResult()`
   * (toc-engine.ts), not a typeset body page. It carries no lines: the
   * preview, PDF and IDML renderers draw it from
   * `designSettings.titlePage` instead. Running headers and folios are
   * suppressed on it, and the body pages that follow are numbered from 2.
   */
  isTitlePage?: boolean;
  /**
   * Layout training T3.4 — the back of the title page (a verso). Its
   * presence makes the body open on a recto, as a right-bound book
   * requires. Carries no header, folio or title; the imprint goes here.
   */
  isBackOfTitle?: boolean;
}

export type TypesetResult = PageTypesetResult;

export interface BookTypesetDocument {
  title: string;
  layoutType: BookLayoutType;
  pages: PageTypesetResult[];
  totalPages: number;
  geometry: PageGeometry;
  links?: RavTextLink[];
  sourceFontFamily?: string;
  rashiFontFamily?: string;
  tosafotFontFamily?: string;
  designSettings?: any;
  averageQualityScore?: number;
  multiPageSequenceScore?: number;
  preflightPassed?: boolean;
  autoFixesApplied?: string[];
  /**
   * v0.8.0 Part C (§1/§3/§9): honest loss + violation reporting.
   * `unplacedUnitIds` — text-bearing units (non-empty rawText) that no
   * paginator placed on any page; `unplacedUnitWarnings` — the matching
   * human-readable warnings (also appended to `autoFixesApplied`).
   * `keepTogetherViolations` — keep-together units that still span more
   * than one page after pagination (e.g. a unit longer than one page).
   * All three are empty/absent on a clean pagination — a non-empty list
   * is a real defect, never a silent drop.
   */
  unplacedUnitIds?: string[];
  unplacedUnitWarnings?: string[];
  keepTogetherViolations?: string[];
  /** Structured actionable preflight / layout diagnostics */
  diagnostics?: StructuredDiagnostic[];
}

export interface ValidationReport {
  passed: boolean;
  totalUnits: number;
  totalLinks: number;
  totalFootnotes: number;
  totalTables: number;
  totalImages: number;
  errors: string[];
  warnings: string[];
}

export interface QaIssue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category:
    | 'clipping'
    | 'collision'
    | 'orphan_mark'
    | 'broken_link'
    | 'missing_glyph'
    | 'balance'
    | 'widow_orphan'
    | 'whitespace'
    | 'continuation'
    | 'footnote_placement';
  message: string;
  unitId?: string;
  pageNumber?: number;
  autoFixable: boolean;
  autoFixed?: boolean;
}

export interface ProjectSnapshot {
  id: string;
  timestamp: number;
  label: string;
  documentTitle: string;
  layoutType: BookLayoutType;
  geometry?: PageGeometry;
  units: ContentUnit[];
  links: RavTextLink[];
  kneeSettings: KneeCustomSettings;
  sourceFontSize?: number;
  commentaryFontSize?: number;
  selectedFont: string;
  selectedRashiFont: string;
  selectedTosafotFont: string;
  enableOrnaments?: boolean;
  currentPageIndex?: number;
  selectedOrnaments?: OrnamentAsset[];
  ornamentRules?: OrnamentUserRule[];
  projectRules?: any[];
  localOverrides?: any[];
  designSettings?: any;
  /**
   * v0.6.0 (Part B) — anchored manual page-break instructions (drag-to-split
   * + "starts on next page" + Auto-Center). Type-only import: the type lives
   * in the break-instructions engine; this field is what makes a split
   * survive save / reload / export instead of living only in App state.
   */
  breakInstructions?: import('../engine/break-instructions').AnchoredBreakInstruction[];
  projectMetadata?: {
    projectId: string;
    createdAt: number;
    updatedAt: number;
    lastSavedAt?: number;
    appVersion: string;
  };
}

export interface LicenseStatus {
  isActivated: boolean;
  licenseKey: string;
  machineId: string;
  machineName: string;
  activatedAt: string;
  ownerEmail: string;
  availableUpdate?: {
    version: string;
    releaseNotes: string;
  };
}
