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
  | 'mikraot_gedolot';                // מקראות גדולות (חומש, תרגום ומפרשים)

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
  fontSizePt?: number;
  fontFamily?: string;
  footnoteMarker?: number | string;
  footnoteUnitId?: string;
  footnoteAnchorWordIndex?: number;
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
  chapterTitle?: string;
  simanNumber?: string;
  seifLetter?: string;
  linkedSourceId?: string;
  linkedCommentaryIds?: string[];
  keepPriority?: KeepPriority;
  keepWithNext?: boolean;
  doNotSplit?: boolean;
  language?: 'he' | 'en' | 'mixed';
  ornamentId?: string;

  // Rich data
  textRuns?: TextRun[];
  tableData?: any;
  imageData?: any;
  footnoteNumber?: number;
  docxFootnoteId?: string;
  footnoteAnchorUnitId?: string;
  footnoteAnchorWordIndex?: number;
}

export interface RavTextLink {
  linkId: string;
  sourceUnitId: string;
  commentaryUnitId: string;
  dibburHamatchil: string;
  sourcePhrase?: string;
  isUserLocked: boolean;
  confidenceScore: number;
  sourceSnippet: string;
  commentarySnippet: string;
  commentaryType: 'Rashi' | 'Tosafot' | 'Ramban' | 'Onkelos' | 'SideNote' | 'Other';
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
