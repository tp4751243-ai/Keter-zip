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

import {
  BookLayoutType,
  ContentRole,
  DafFormatMode,
  HeaderFolioPosition,
  KneeCustomSettings,
  PageGeometry,
  ParagraphIndentMode,
  PeripheralStreamKind,
  SeparatorStyleId,
  TierConfig,
} from './typesetter';
import type { BilingualLabel } from '../i18n/strings';
import type { UiLanguage } from '../i18n/LanguageContext';
import type {
  TitlePageTemplateId,
  TitlePageTemplateMetadata,
} from '../engine/title-page-templates';

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


/**
 * v0.9.8 Bilingual Audit — ONE strict bilingual table for semantic
 * roles. TypeScript FAILS the build if a SemanticStyleRole ships
 * without a label in either language (the v0.9.1 lesson: a missing
 * 'yiddish' entry hidden by Record<string, ...> crashed Page design).
 * The parallel HE/EN maps below are DERIVED from this table so the
 * existing call sites keep working unchanged.
 */
export const SEMANTIC_ROLE_LABELS: Record<SemanticStyleRole, BilingualLabel> = Object.freeze({
  book: { he: 'ספר / מסמך ראשי', en: 'Book / main document' },
  main_title: { he: 'כותרת ראשית / שער', en: 'Main heading / title page' },
  subtitle: { he: 'כותרת משנה', en: 'Subheading' },
  introduction: { he: 'הקדמה / מבוא', en: 'Introduction / preface' },
  chapter: { he: 'פרק / כותרת פרק', en: 'Chapter / chapter heading' },
  siman: { he: 'סימן (שולחן ערוך / הלכה)', en: 'Siman (Shulchan Arukh / halakha)' },
  seif: { he: 'סעיף הלכתי', en: 'Halakhic seif' },
  heading: { he: 'כותרת', en: 'Heading' },
  subheading: { he: 'כותרת משנית', en: 'Secondary heading' },
  main_source: { he: 'מקור ראשי (גמרא / משנה / פנים)', en: 'Main source (Gemara / Mishnah / main text)' },
  verse: { he: 'פסוק (מקראות גדולות / תנ״ך)', en: 'Verse (Mikraot Gedolot / Tanakh)' },
  regular_paragraph: { he: 'גוף טקסט / פסקה רגילה', en: 'Body text / regular paragraph' },
  body: { he: 'גוף טקסט ראשי', en: 'Main body text' },
  halakha: { he: 'הלכה פסוקה', en: 'Decided halakha' },
  quote: { he: 'ציטוט / מובאה', en: 'Quotation / citation' },
  bold_special: { he: 'טקסט מודגש / מיוחד', en: 'Bold / special text' },
  primary_comment: { he: 'פירוש ראשי (רש״י / משנה ברורה)', en: 'Main commentary (Rashi / Mishnah Berurah)' },
  secondary_comment: { he: 'פירוש משני (תוספות / ש״ך / ביאור הלכה)', en: 'Secondary commentary (Tosafot / Shakh / Biur Halakha)' },
  tertiary_comment: { he: 'פירוש שלישי (עין משפט / מסורת הש״ס)', en: 'Third commentary (Ein Mishpat / Mesorat HaShas)' },
  dibbur_hamatchil: { he: 'דיבור המתחיל (ד״ה)', en: 'Dibbur hamatchil (D.H.)' },
  footnote: { he: 'הערות שוליים', en: 'Footnotes' },
  side_note: { he: 'הערת צד / גליון הש״ס', en: 'Side note / Shas margin' },
  cross_reference: { he: 'מראה מקום / הפניה', en: 'Source reference / citation' },
  ornament: { he: 'עיטור / מסגרת (משתמש בלבד)', en: 'Ornament / frame (user-supplied only)' },
  continuation: { he: 'שורת המשך (המשך מעמוד קודם / לעמוד הבא)', en: 'Continuation line (continued from previous page / to next page)' },
  page_element: { he: 'כותרת רצה ומספור דפים', en: 'Running head and page numbering' },
  header_running: { he: 'כותרת רצה בראש עמוד', en: 'Running head at the top of a page' },
  folio_number: { he: 'מספר דף / עמוד', en: 'Folio / page number' },
  table: { he: 'טבלה', en: 'Table' },
  image: { he: 'תמונה / שרטוט', en: 'Image / drawing' },
  chart: { he: 'תרשים', en: 'Diagram' },
  caption: { he: 'כיתוב תמונה / טבלה', en: 'Image / table caption' },
  list_item: { he: 'פריט רשימה', en: 'List item' },
});

/** Hebrew role labels, derived from SEMANTIC_ROLE_LABELS (do not edit by hand). */
export const SEMANTIC_ROLE_LABELS_HE: Record<SemanticStyleRole, string> = Object.fromEntries(
  Object.entries(SEMANTIC_ROLE_LABELS).map(([role, label]) => [role, label.he])
) as Record<SemanticStyleRole, string>;

/** English counterparts of SEMANTIC_ROLE_LABELS_HE (v0.2.0). */
/** English role labels, derived from SEMANTIC_ROLE_LABELS (do not edit by hand). */
export const SEMANTIC_ROLE_LABELS_EN: Record<SemanticStyleRole, string> = Object.fromEntries(
  Object.entries(SEMANTIC_ROLE_LABELS).map(([role, label]) => [role, label.en])
) as Record<SemanticStyleRole, string>;

/** Language-aware role display name (v0.2.0). Falls back to the role key. */
export function getSemanticRoleLabel(role: string, lang: UiLanguage): string {
  const entry = (SEMANTIC_ROLE_LABELS as Record<string, BilingualLabel>)[role];
  if (!entry) return role;
  return lang === 'en' ? entry.en : entry.he;
}

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
  /** Explicit RTL paragraph indentation mode (supports Chalon window indentation) */
  indentMode?: ParagraphIndentMode;
  /** Horizontal indentation in pt for Chalon (window) lines */
  chalonIndentPt?: number;
  /** Number of indented lines for 'chalon_window' (1..6, default 2) */
  chalonLineCount?: number;
  tabStopsPt: number[];
  /**
   * Layout training T8 — number of opening words of each paragraph set
   * bold (the פתיח of a prose sefer: "יסוד החסידות…"). 0 / absent = off.
   */
  openingWordsBold?: number;
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
  /**
   * Layout training T5 — the kind of sefer (engine/sefer-type.ts). Decides
   * which type-specific rules apply (daf folios, Vilna head, masechta
   * frame, גמ׳ marker, marginal apparatus are Talmud only). Unset on a
   * project saved before types existed: then rav_text counts as Talmud.
   */
  seferType?: 'talmud' | 'chumash' | 'mishnah' | 'halacha' | 'siddur' | 'yiddish' | 'prose';
  // --- v0.5.0 Part C — Module 3 (Custom Layout Designer) -------------------
  // Present only when `layoutType === 'custom_layout'` (or when the user
  // saved boxes for another layout). Coordinates are percentages (0..100)
  // of the page content area; `xPct` is measured from the LEFT edge of the
  // content area so the designer can lay boxes out in a plain LTR preview.
  // The pagination engine still flows text with the `baseLayout` solver;
  // `boxes` are consumed by the designer preview and by
  // `planCustomLayoutFlow` (src/engine/custom-layout-engine.ts), which
  // reflows unit text into the boxes' coordinates, page by page.
  customLayout?: CustomLayoutDesign;
  // v0.4.0 — checklist §2 page sizes (cm → pt, 1 cm = 28.3465 pt):
  // pocket 10.5×14.8, small_a5 14.8×21, regular_17x24 17×24,
  // wide_17x25 17.6×25, booklet_a4 21×29.7, gemara_24x34 24×34.
  // v0.9.8 Phase 5 (Quick-Tune) — US trim sizes: 6×9 in → 432×648pt,
  // 7×10 in → 504×720pt, Letter 8.5×11 in → 612×792pt.
  pageSizePreset:
    | 'royal_holy_book'
    | 'vilna_folio'
    | 'crown_quarto'
    | 'a4'
    | 'b5'
    | 'pocket'
    | 'small_a5'
    | 'regular_17x24'
    | 'wide_17x25'
    | 'booklet_a4'
    | 'gemara_24x34'
    | 'trim_6x9'
    | 'trim_7x10'
    | 'trim_letter'
    | 'custom';
  /**
   * v0.9.8 Phase 5 (Quick-Tune) — mirror margins: when true (default),
   * the inside and outside margins stay distinct (binding side vs
   * outer edge). When false, both side margins equal the INSIDE margin
   * (symmetric pages — no mirroring). Honest scope note: the engine
   * never swaps margins per page today (`PageGeometry.isVerso` is
   * never set true by any solver), so there is no per-page verso swap
   * for this toggle to control; the toggle controls symmetric vs
   * distinct side margins, which is what actually changes on the page.
   */
  mirrorMargins?: boolean;
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
  pageNumberPosition: HeaderFolioPosition;
  showRunningHeader: boolean;
  showRunningFooter: boolean;
  runningHeaderFontSizePt: number;
  /**
   * v0.3.0 (Module C) — Per-tier configuration for multi-text pages
   * (`TierConfig[]`, see `types/typesetter.ts`). Opt-in: absent = engine defaults
   * for the layout. Presets (`READY_DESIGNS`) and the Design panel write here.
   */
  tiers?: TierConfig[];
}

// ===========================================================================
// v0.5.0 Part C — Module 3 (Custom Layout Designer): box model.
// --- BEGIN Part C Module 3 types (single delimited section) ----------------
// A text frame the user draws on the page. All coordinates are percentages
// (0..100) of the page CONTENT area (inside the margins), `xPct` measured
// from the left edge. The engine clamps every box to the content area and
// to a minimum readable size (see `sanitizeCustomLayoutDesign`); overlapping
// boxes are reported as warnings, never silently moved.
// ===========================================================================

/** What kind of text a custom-layout box holds. */
export type CustomLayoutBoxRole =
  | 'main_text'    // טקסט ראשי / גמרא / פנים
  | 'commentary'   // פירוש (רש״י / תוספות / ביאור)
  | 'header'       // כותרת / כותרת רצה
  | 'footnote'     // הערות שוליים
  | 'side_note';   // הערת צד / גליון

/**
 * v0.6.0 Part C (§2) — a non-rectangular text frame.
 *
 * A box's flow region is the polygon `points` (normalized 0..1 inside the
 * box rect, clockwise, x = left→right, y = top→bottom). Text flows only
 * inside the polygon, line by line, so an L/T/cross frame really shapes
 * the text — the pagination engine computes the free horizontal intervals
 * of the polygon for each line band (see `boxFlowIntervals` in
 * custom-layout-engine.ts). `kind: 'rectangle'` (or no `shape` at all)
 * is the plain v0.5.0 rectangle; the presets are L / T / inverted-T /
 * cross; `custom` is a user-drawn multi-vertex polygon.
 */
export type CustomLayoutPolygonKind =
  | 'rectangle'
  | 'ellipse'
  | 'l_shape'
  | 't_shape'
  | 'inverted_t'
  | 'cross'
  | 'custom';

export interface CustomLayoutPolygonPoint {
  /** 0..1 across the box (0 = left edge). */
  x: number;
  /** 0..1 down the box (0 = top edge). */
  y: number;
}

export interface CustomLayoutPolygonShape {
  kind: CustomLayoutPolygonKind;
  /** Vertices of the flow region, in box-normalized coordinates. */
  points: CustomLayoutPolygonPoint[];
}

/** A cut-out inside a box: text flows AROUND this polygon (region
 *  exclusion), e.g. an inset commentary box inside a main-text frame. */
export interface CustomLayoutExclusion {
  id: string;
  points: CustomLayoutPolygonPoint[];
}

/**
 * v0.9.0 Part B — manuscript tier assignment for a custom-layout box.
 *
 * The box's `role` (main_text / commentary / …) decides which content
 * flows into it; the `tier` is the finer manuscript assignment — which
 * text of the page this frame holds (Rashi vs Tosafot vs a side gloss…).
 * A box keeps its role for the flow engine; the tier is carried in the
 * box, shown in the Manuscript Designer, and exported in
 * `.keter-template.json` recipes so a template remembers not just where
 * each frame sits but what it is for.
 */
export type CustomLayoutBoxTier =
  | 'main_text'          // טקסט ראשי
  | 'main_drush'         // דרוש ראשי
  | 'rashi'              // רש״י
  | 'tosafot'            // תוספות
  | 'side_gloss'         // גליון / הערת צד
  | 'bottom_note'        // הערה תחתונה
  | 'marginal_citation'  // מראה מקום בגיליון
  | 'footnote'           // הערת שוליים
  | 'header'             // כותרת
  | 'footer'             // כותרת תחתונה
  | 'commentary';        // פירוש (כללי)

/**
 * v0.9.0 Part B — per-box typographic rules, edited in the Manuscript
 * Designer's rule inspector and persisted on the box (so they ride along
 * in saved templates and `.keter-template.json` exports). All fields are
 * optional: unset = the role's normal value. The designer preview applies
 * them (font-size clamp, line height, alignment); the pagination engine
 * reads `fontSizePt` / `lineHeight` on the box as before.
 */
export interface CustomLayoutBoxRules {
  /** Smallest font size this box may render (pt, 6..72). */
  minFontSizePt?: number;
  /** Largest font size this box may render (pt, 6..72, >= min). */
  maxFontSizePt?: number;
  /** Line-height multiplier for this box (1.0..2.2). */
  lineHeightRatio?: number;
  /** Gap between this box's columns, when it holds more than one (pt, 0..72). */
  columnGutterPt?: number;
  /** How the text inside this box is aligned. */
  alignment?: DesignAlignment;
}

export interface CustomLayoutBox {
  id: string;
  role: CustomLayoutBoxRole;
  /** v0.9.0 Part B — manuscript tier (what this frame holds); unset =
   *  the tier implied by `role` (see `tierForRole`). */
  tier?: CustomLayoutBoxTier;
  /** v0.9.0 Part B — per-box typographic rules (rule inspector). */
  rules?: CustomLayoutBoxRules;
  /** User-visible name, e.g. "רש״י — ימין". Defaults to the role label. */
  labelHe?: string;
  labelEn?: string;
  /** v0.8.0 Part C (§7): text rendered inside the box (Michtav box only). */
  text?: string;
  /** Left edge, % of content width (0..100). */
  xPct: number;
  /** Top edge, % of content height (0..100). */
  yPct: number;
  /** Width, % of content width. */
  widthPct: number;
  /** Height, % of content height. */
  heightPct: number;
  /** Optional per-box font size (pt); unset = the role's normal size. */
  fontSizePt?: number;
  /** Optional per-box line-height multiplier (1.0..2.2). */
  lineHeight?: number;
  /** v0.6.0 Part C (§2): non-rectangular flow region. Unset = rectangle. */
  shape?: CustomLayoutPolygonShape;
  /** v0.7.0 (M2/M3): frame rotation in degrees (-180..180) and horizontal
   *  skew in degrees. Frame-level visual transforms on the movable box
   *  overlay; the text flow inside stays axis-aligned. Unset = 0. */
  rotationDeg?: number;
  skewXDeg?: number;  /** v0.6.0 Part C (§2): cut-outs the text flows around. */
  exclusions?: CustomLayoutExclusion[];
}

/** A saved, reusable set of boxes (a named custom-layout template). */
export interface CustomLayoutTemplate {
  id: string;
  nameHe: string;
  nameEn: string;
  /** The base layout the boxes were drawn over. */
  baseLayout: BookLayoutType;
  boxes: CustomLayoutBox[];
  createdAt: number;
  updatedAt: number;
}

/**
 * The whole custom-layout design stored on `PageLayoutDesignSettings`.
 * `pageOverrides` holds per-page tweaks: page index → that page's boxes.
 * A page with no override uses `boxes` (the global book flow is untouched).
 */
export interface CustomLayoutDesign {
  enabled: boolean;
  /** The layout solver the pagination engine still uses under the boxes. */
  baseLayout: BookLayoutType;
  boxes: CustomLayoutBox[];
  /** Id of the template `boxes` came from, if any. */
  activeTemplateId?: string;
  /** Snap-to-grid step in points (0 = snap off). Default 6pt. */
  gridSizePt: number;
  /** Per-page box tweaks, keyed by 0-based page index. */
  pageOverrides: Record<string, CustomLayoutBox[]>;
}

// --- END Part C Module 3 types ---------------------------------------------

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
  folioNumberPosition: HeaderFolioPosition;
  /** v0.3.0 (Module C) — running-header placement; defaults to the folio position when unset. */
  runningHeaderPosition?: HeaderFolioPosition;
  /**
   * v0.5.0 Part B (Module 6) — visibility of the top running header LINE
   * (title + rule + edition label) on each page. Default false (off): the
   * line is hidden unless the user enables it. The folio (page number) is a
   * separate setting (`showFolioNumber`) and is NOT gated by this flag — it
   * keeps its own existing behaviour in both preview and PDF export.
   * Legacy settings without this field fall back to `showRunningHeader`
   * (see `DesignSettingsEngine.syncDerivedViews` and the renderers), so
   * projects saved before v0.5.0 keep the header they already had.
   */
  showTopHeaderLine: boolean;
  /**
   * v0.9.8 Phase 5 (Quick-Tune / Koteret) — the thin divider rule drawn
   * directly under the running-header band (canvas border, PDF rule,
   * canvas-render rule). Default true: when the header line is on, the
   * rule shows exactly as before. Turning it off removes the rule only;
   * the header text stays. This is a plain typographic rule — the
   * `orn-header-bar` "Running Header Flourish" asset in
   * engine/ornament-library.ts carries no renderable SVG artwork
   * (`svgPathOrDataUrl: 'builtin:header_flourish'` resolves nowhere)
   * and built-ins are never auto-placed (Stage 11D hard rule), so no
   * flourish divider is available; recorded honestly, not faked.
   */
  showHeaderDividerRule?: boolean;
  /**
   * v0.5.0 (integrator — user request) — commentary tier labels
   * ("Rashi", "Tosafot", …) above the columns. Default false (off): a fresh
   * book opens clean; the user turns the labels on when wanted.
   */
  showCommentaryLabels: boolean;
  /**
   * v0.5.0 (integrator — user request) — how the page number is written
   * when shown: plain numbers (1, 2, 3) or Hebrew letters (א, ב, ג…).
   * Default 'hebrew', matching the folio the app already rendered.
   */
  pageNumberStyle: 'numbers' | 'hebrew';
  /**
   * v0.5.0 (integrator — user request) — whether the page number is
   * prefixed with "דף" (e.g. "דף ב׳") or shown bare ("ב׳" / "2").
   * Default true, matching the folio the app already rendered.
   */
  showDafPrefix: boolean;
  /**
   * v0.6.0 Part A (§5) — the running header's editable text and display
   * options. The band has three visual slots (in RTL reading order the
   * folio sits on the RIGHT, the book title in the CENTER, and the
   * chapter/edition label on the LEFT). Empty text means "automatic":
   * centre falls back to the book title, right to the folio label, left
   * to the edition label for the layout. `runningHeaderOverrides` holds
   * per-folio text overrides, keyed by 0-based page index; a page with
   * no override uses the book-wide text.
   */
  /** Optional explicit folio & Daf/Amud numbering rules */
  folioNumbering?: FolioNumberingSettings;
  runningHeader: RunningHeaderSettings;
  runningHeaderOverrides?: Record<string, RunningHeaderPageOverride>;
}

export interface FolioNumberingSettings {
  /**
   * Layout training T3.3 — geresh / gershayim on Hebrew page numbers.
   * Default false: printed folios carry none (Academy of the Hebrew
   * Language rule; hebrew-book-typesetter skill) — טו, קיח, not ט״ו.
   */
  gershayim?: boolean;
  /** 'dots' -> ב. / ב: , 'amud_hebrew' -> ב ע״א / ב ע״ב , 'gematria' -> ב׳ , 'numbers' -> 2 */
  dafFormat: DafFormatMode;
  /** Starting traditional Daf number (default 2 for Talmud -> Daf ב) */
  startDaf: number;
  /** Starting amud side ('a' or 'b') */
  startAmud: 'a' | 'b';
  /** When true (default), title page and front matter never consume or shift body folio numbers */
  excludeFrontMatter: boolean;
}

export const DEFAULT_FOLIO_NUMBERING: FolioNumberingSettings = {
  dafFormat: 'dots',
  startDaf: 2,
  startAmud: 'a',
  excludeFrontMatter: true,
};

/**
 * v0.6.0 Part A (§5) — editable running-header text + display options.
 * `alignment` packs the visible slots: 'center' spreads them across the
 * band (today's look); 'left' / 'right' pack them to that visual side.
 * `fontFamily` empty = the book's main font; `fontSizePt` is the size of
 * the header text (the chapter label renders slightly smaller).
 */
export type RunningHeaderAlignment = 'left' | 'center' | 'right';

export interface RunningHeaderSettings {
  /** Text for the LEFT slot; empty = the layout's edition label. */
  leftText: string;
  /** Text for the CENTER slot; empty = the book title. */
  centerText: string;
  /** Text for the RIGHT slot; empty = the folio label ("דף ב׳"). */
  rightText: string;
  /** Whether the book title (centre slot) is shown at all. */
  showBookTitle: boolean;
  /** Whether the chapter/edition label (left slot) is shown at all. */
  showChapterTitle: boolean;
  /** Whether the page number (right slot) is shown inside the header. */
  showPageNumber: boolean;
  /**
   * v0.9.8 Phase 5 (Quick-Tune / Koteret) — the centre slot's text per
   * spread side. A Hebrew sefer's two facing pages traditionally carry
   * different titles: the Masechta / Sefer title on the right-hand page
   * and the Perek / Daf / Parsha on the left-hand page. When set, the
   * centre slot shows `rightPageText` on right-hand pages and
   * `leftPageText` on left-hand pages INSTEAD of `centerText` (a
   * per-folio override still wins over both). Empty = the old behaviour
   * (centre text / book title on every page). The side is resolved by
   * the caller from the 0-based page index (even = left-hand page,
   * Amud Rishon; odd = right-hand page, Amud Sheini — see
   * `spreadSideForPageIndex` in engine/vilna-shas.ts).
   */
  rightPageText?: string;
  /** v0.9.8 Phase 5 — see `rightPageText` (left-hand pages). */
  leftPageText?: string;
  alignment: RunningHeaderAlignment;
  /** Empty = the book's main font. */
  fontFamily: string;
  fontSizePt: number;
  /** Structured Vilna / Sefer running header metadata */
  masechetName?: string;
  perekNumberText?: string;
  perekTitleText?: string;
  useStructuredVilnaHeader?: boolean;
  /**
   * Layout training T2.1 — Vilna head size in pt. Unset = 1.6 × the
   * Gemara size (measured median on 8 Vilna reference pages: 1.67).
   */
  vilnaHeaderFontSizePt?: number;
}

/** Per-folio header text override: only set fields replace the global text. */
export interface RunningHeaderPageOverride {
  leftText?: string;
  centerText?: string;
  rightText?: string;
}

export const DEFAULT_RUNNING_HEADER_SETTINGS: RunningHeaderSettings = {
  leftText: '',
  centerText: '',
  rightText: '',
  showBookTitle: true,
  showChapterTitle: true,
  showPageNumber: true,
  alignment: 'center',
  fontFamily: '',
  fontSizePt: 10.5,
  masechetName: '',
  perekNumberText: '',
  perekTitleText: '',
  useStructuredVilnaHeader: false,
};

/** A header slot after resolving globals + the page's override + fallbacks. */
export interface ResolvedRunningHeaderSlot {
  text: string;
  visible: boolean;
}

export interface ResolvedRunningHeader {
  /** Visual LEFT slot (chapter / edition label). */
  left: ResolvedRunningHeaderSlot;
  /** Visual CENTER slot (book title). */
  center: ResolvedRunningHeaderSlot;
  /** Visual RIGHT slot (folio / page number). */
  right: ResolvedRunningHeaderSlot;
  alignment: RunningHeaderAlignment;
  fontFamily: string;
  fontSizePt: number;
}

/**
 * v0.6.0 Part A (§5) — pure resolver shared by the preview (PageCanvas),
 * the PDF exporter and the smoke test, so all three agree on what the
 * header shows. `fallbacks` are the automatic texts (book title, folio
 * label, edition label); empty user text falls back to them. A per-folio
 * override replaces only the fields it sets. `folioInHeader` is false
 * when the folio lives at the bottom of the page (folioNumberPosition is
 * a bottom position) — the header's right slot then stays empty instead
 * of duplicating the folio that the footer already shows.
 */
export function resolveRunningHeader(
  pageElements: PageElementsDesignSettings | undefined | null,
  fallbacks: { bookTitle: string; folioLabel: string; editionLabel: string },
  pageIndex: number,
  folioInHeader: boolean,
  /**
   * v0.9.8 Phase 5 — spread side of this page ('right' = right-hand
   * page, 'left' = left-hand page). When given and the matching
   * `rightPageText` / `leftPageText` is set, the centre slot shows that
   * text instead of `centerText`. Callers that do not know the side
   * omit it and get the old behaviour exactly.
   */
  pageSide?: 'right' | 'left'
): ResolvedRunningHeader {
  const rh: RunningHeaderSettings = {
    ...DEFAULT_RUNNING_HEADER_SETTINGS,
    ...(pageElements?.runningHeader ?? {}),
  };
  const override: RunningHeaderPageOverride | undefined =
    pageElements?.runningHeaderOverrides?.[String(pageIndex)];
  const leftText = (override?.leftText ?? rh.leftText).trim() || fallbacks.editionLabel;
  const sideText =
    pageSide === 'right'
      ? (rh.rightPageText ?? '').trim()
      : pageSide === 'left'
        ? (rh.leftPageText ?? '').trim()
        : '';
  const centerText =
    (override?.centerText ?? '').trim() ||
    sideText ||
    rh.centerText.trim() ||
    fallbacks.bookTitle;
  const rightText = (override?.rightText ?? rh.rightText).trim() || fallbacks.folioLabel;
  return {
    left: { text: leftText, visible: rh.showChapterTitle && leftText.length > 0 },
    center: { text: centerText, visible: rh.showBookTitle && centerText.length > 0 },
    right: {
      text: rightText,
      visible: folioInHeader && rh.showPageNumber && rightText.length > 0,
    },
    alignment: rh.alignment,
    fontFamily: rh.fontFamily.trim(),
    fontSizePt: rh.fontSizePt,
  };
}

/** True when at least one header slot is visible. */
export function runningHeaderHasVisibleSlot(resolved: ResolvedRunningHeader): boolean {
  return resolved.left.visible || resolved.center.visible || resolved.right.visible;
}

// ─────────────────────────────────────────────────────────────────────────────
// v0.5.0 Part B — Module 5: block-level margins & spacing (new section)
// ─────────────────────────────────────────────────────────────────────────────
// A text block is one paragraph / section (a ContentUnit). Its margins are
// stored as paragraph indents + spacing — the same fields the pagination
// engine already renders (`typesetter-core.ts`: leftIndentPt / rightIndentPt
// on every line, spaceBeforePt on the first line, spaceAfterPt on the last)
// — so every change below re-paginates and updates the preview live.
// `BlockSpacingSettings` is the persisted record of the most recent
// block-margin/spacing edit (see `ProfessionalDesignSettings.blockSpacing`):
// the authoritative per-block values live in the paragraph overrides /
// role styles it mirrors; this section only records them plus the
// Auto-Center state, so the AI actions and the panel can restore them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Margin unit the user types in (v0.6.0 Part B). The engine always stores
 * points; the panel converts both ways via
 * `DesignSettingsEngine.marginUnitToPt` / `ptToMarginUnit`.
 */
export type MarginUnit = 'pt' | 'mm' | 'in';

/**
 * Margins and spacing of one text block (paragraph / section), in points.
 * Horizontal margins are the block's side indents inside the text frame;
 * vertical margins are the space above / below the block. All values are
 * clamped by `sanitizeAndEnforceHardRules` (0..72pt).
 */
export interface BlockSpacingSettings {
  /** Space on the left side of the block (→ paragraph `leftIndentPt`). */
  marginLeftPt: number;
  /** Space on the right side of the block (→ paragraph `rightIndentPt`). */
  marginRightPt: number;
  /** Space above the block (→ paragraph `spaceBeforePt`). */
  marginTopPt: number;
  /** Space below the block (→ paragraph `spaceAfterPt`). */
  marginBottomPt: number;
  /** Space above the block, in points (same value as `marginTopPt`). */
  spaceBeforePt: number;
  /** Space below the block, in points (same value as `marginBottomPt`). */
  spaceAfterPt: number;
  /**
   * True when the block was last laid out by Auto-Center (equal left/right
   * indents and equal space above/below). Any manual margin edit clears it.
   */
  autoCentered: boolean;
}

/** No extra block margins / spacing — the v0.5.0 Part B default. */
export const DEFAULT_BLOCK_SPACING: BlockSpacingSettings = Object.freeze({
  marginLeftPt: 0,
  marginRightPt: 0,
  marginTopPt: 0,
  marginBottomPt: 0,
  spaceBeforePt: 0,
  spaceAfterPt: 0,
  autoCentered: false,
});

// ── v0.5.0 (Title Page / Shaar Blat builder) ─────────────────────────────
// The title page is the book's first page. Its data lives here (part of the
// project, undoable, saved in the .keter file) and extends the v0.3.0 cover
// feature (`CoverPageData` in toc-engine.ts) — it is NOT a second cover
// system: `titlePageSettingsToCoverData()` converts this to CoverPageData
// for the PDF / IDML exporters, and `buildTitlePageResult()` builds the
// synthetic first page the editor previews.

/** Stock title-page border style ids. All are original vector ornaments
 *  drawn by the engine (see title-page-borders.ts) in the spirit of the
 *  reference title pages — plain centred titles, double-line frames,
 *  corner flourishes, stepped frames and patterned bands. No reference
 *  photo is copied, traced or embedded. */
export type TitlePageBorderStyleId =
  | 'none'
  | 'single'
  | 'double'
  | 'corner'
  | 'stepped'
  | 'patterned'
  | 'ornate'
  | 'chamfer_knot'
  | 'dark_mosaic'
  | 'floral_panel'
  | 'bevel_molded'
  | 'rosette_band'
  | 'palmette_frieze'
  // v0.9.9 (I3, title-page templates): the five template-only frames.
  // Their vector geometry already lives in title-page-borders.ts
  // (buildTitlePageBorderCommands) and the preview resolves them via
  // the template; adding them here stops syncDerivedViews / the AI
  // patch handler from resetting a stored one to 'double', and lets
  // the PDF render the real frame instead of its fallback.
  | 'floral_double'
  | 'wide_pattern_band'
  | 'baroque_scroll'
  | 'ring_band'
  | 'double_corner_marks';

export type TitlePageCoverMode = 'interior_title_page' | 'print_wraparound_cover';

export interface WraparoundCoverSettings {
  /** Spine width typed by hand; used when no caliper is given. */
  spineWidthMm: number;
  /**
   * Layout training T3.5 — paper thickness per LEAF in mm, from the print
   * shop. When set, the spine is computed: leaves × caliper + board.
   */
  caliperMm?: number;
  /** Extra mm the shop adds to the spine (board / glue allowance). */
  coverBoardMm?: number;
  /** Shop signature multiple (4, 8, 16) the page count is rounded up to. */
  signatureMultiple?: number;
  /** Set by the exporter: interior page count the spine is computed from. */
  interiorPageCount?: number;
  bleedMm: number;
  backCoverText: string;
  backCoverSubtitle: string;
  spineText?: string;
}

/** One editable line of the title page: its text plus its own font, size,
 *  alignment and spacing. An empty `text` hides the field (the title falls
 *  back to the book title when empty). */
export interface TitlePageFieldStyle {
  /** The field's text ('' = hidden; title falls back to the book title). */
  text: string;
  /** Font family name, or '' for the book's default font. */
  fontFamily: string;
  fontSizePt: number;
  alignment: 'center' | 'right' | 'left';
  spaceAbovePt: number;
  spaceBelowPt: number;
  /** v0.6.0 Part C (§8): line height inside the field (1.0..2.0). Unset = 1.2. */
  lineHeight?: number;
  /** v0.6.0 Part C (§8): drag offset from the shared layout position, in
   *  points. Set by dragging the field on the title page itself. */
  yOffsetPt?: number;
  xOffsetPt?: number;
}

/** A user-imported border image, applied as the title-page frame instead
 *  of a stock border. Stored with the project as a data URL when small
 *  enough (`persisted: true`); when the image is too large to store in the
 *  project file it is kept for the session only (`persisted: false`) and
 *  the UI says so plainly. */
export interface TitlePageCustomBorderImage {
  fileName: string;
  /** data URL (image/png, image/jpeg or image/svg+xml). */
  dataUrl: string;
  /** False when the image is session-only (too large to store). */
  persisted: boolean;
}

export interface TitlePageBorderSettings {
  enabled: boolean;
  styleId: TitlePageBorderStyleId;
  /** Stroke width of the frame, in points (0.5–4). */
  thicknessPt: number;
  /** Distance of the frame from the page edge, in millimetres (0–25). */
  insetMm: number;
  /** v0.6.0 Part C (§8): frame scale around the page centre, in percent
   *  (50–150). 100 = the frame exactly as the inset defines it. */
  scalePct?: number;
  /** v0.6.0 Part C (§8): extra inner padding, in millimetres (0–25) —
   *  shrinks the frame further in from the inset on all four sides. */
  paddingMm?: number;
  /** v0.6.0 Part C (§8): frame position shift, in millimetres (-25..25). */
  offsetXMm?: number;
  offsetYMm?: number;
}

export interface TitlePageSettings {
  /** False by default: a fresh book opens without a title page; the user
   *  turns it on (panel toggle or "make a title page"). */
  enabled: boolean;
  /** v0.9.9 (I3): the chosen title-page preset, or absent for the
   *  legacy/classic default (no template). Optional: old projects
   *  without it render exactly as before. */
  templateId?: TitlePageTemplateId;
  /** v0.9.9 (I3): the template's extra metadata fields (English title,
   *  editor, dedication, …). Empty stays empty, never printed. */
  templateMetadata?: TitlePageTemplateMetadata;
  /** Distinguishes single interior title page (Sha'ar Blat) from wraparound back+spine+front cover */
  coverMode?: TitlePageCoverMode;
  wraparoundCover?: WraparoundCoverSettings;
  title: TitlePageFieldStyle;
  subtitle: TitlePageFieldStyle;
  author: TitlePageFieldStyle;
  translator: TitlePageFieldStyle;
  publisher: TitlePageFieldStyle;
  volume: TitlePageFieldStyle;
  year: TitlePageFieldStyle;
  /** Extra lines (dedications, haskamot, …), up to 6, in order. */
  extraLines: TitlePageFieldStyle[];
  border: TitlePageBorderSettings;
  customBorderImage: TitlePageCustomBorderImage | null;
}

/** Default per-field sizes for a new title page. */
export const TITLE_PAGE_FIELD_DEFAULTS: Record<
  'title' | 'subtitle' | 'author' | 'translator' | 'publisher' | 'volume' | 'year' | 'extra',
  { fontSizePt: number; spaceAbovePt: number; spaceBelowPt: number }
> = {
  title: { fontSizePt: 30, spaceAbovePt: 0, spaceBelowPt: 18 },
  subtitle: { fontSizePt: 15, spaceAbovePt: 6, spaceBelowPt: 10 },
  author: { fontSizePt: 13, spaceAbovePt: 10, spaceBelowPt: 6 },
  translator: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 },
  publisher: { fontSizePt: 12, spaceAbovePt: 0, spaceBelowPt: 0 },
  volume: { fontSizePt: 13, spaceAbovePt: 8, spaceBelowPt: 4 },
  year: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 },
  extra: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 4 },
};

/**
 * A fresh, disabled title page. Consumers MUST deep-clone it before
 * mutating (it is shared); every writer in the codebase does
 * (JSON.parse(JSON.stringify(...)) in createDefaultSettings,
 * syncDerivedViews, the panel and the export view).
 */
export const DEFAULT_TITLE_PAGE_SETTINGS: TitlePageSettings = {
  enabled: false,
  coverMode: 'interior_title_page',
  wraparoundCover: {
    spineWidthMm: 14,
    bleedMm: 3,
    backCoverText: '',
    backCoverSubtitle: '',
    spineText: '',
  },
  title: { text: '', fontFamily: '', fontSizePt: 30, alignment: 'center', spaceAbovePt: 0, spaceBelowPt: 18 },
  subtitle: { text: '', fontFamily: '', fontSizePt: 15, alignment: 'center', spaceAbovePt: 6, spaceBelowPt: 10 },
  author: { text: '', fontFamily: '', fontSizePt: 13, alignment: 'center', spaceAbovePt: 10, spaceBelowPt: 6 },
  translator: { text: '', fontFamily: '', fontSizePt: 12, alignment: 'center', spaceAbovePt: 4, spaceBelowPt: 6 },
  publisher: { text: '', fontFamily: '', fontSizePt: 12, alignment: 'center', spaceAbovePt: 0, spaceBelowPt: 0 },
  volume: { text: '', fontFamily: '', fontSizePt: 13, alignment: 'center', spaceAbovePt: 8, spaceBelowPt: 4 },
  year: { text: '', fontFamily: '', fontSizePt: 12, alignment: 'center', spaceAbovePt: 4, spaceBelowPt: 6 },
  extraLines: [],
  // no border around the title page unless the user picks one (no lines around pages by default)
  border: { enabled: false, styleId: 'none', thicknessPt: 1, insetMm: 12, scalePct: 100, paddingMm: 0, offsetXMm: 0, offsetYMm: 0 },
  customBorderImage: null,
};

export interface RavTextDesignSettings {
  /**
   * Layout training T2.4 — marginal apparatus (Ein Mishpat, Masoret
   * HaShas, Torah Or, Gilyon …) as side columns. On unless explicitly
   * disabled; off = the legacy full-width band below the knee.
   */
  marginalColumns?: { enabled: boolean };
  /**
   * Layout training T2.5 — rav-text page planner. 'measured' (default):
   * each page takes the largest run of Gemara whose commentaries fit,
   * verified by the knee solver. 'legacy': the fixed word-count planner.
   */
  pagePlanner?: 'measured' | 'legacy';
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
  /**
   * v0.8.0 Part C (§7): centred decorative Michtav box above the Gemara
   * on the first Vilna page. Off by default (existing books unchanged);
   * `applyVilnaShasDefaults` turns it on. `michtavText` is the box text
   * (defaults to the book title when empty).
   */
  michtavEnabled?: boolean;
  michtavText?: string;
  /** Opening word frame around Masechet opening word(s) or Sefer opening heading */
  openingDecoration?: OpeningDecorationSettings;
  /** Separator between every commentary unit / dibbur */
  commentarySeparator?: SeparatorRuleSettings;
  /** Separator between general Sefer paragraphs or sections */
  paragraphSeparator?: SeparatorRuleSettings;
  /** Verified Mishnah -> Gemara boundary transition marker (`גמ׳`) */
  transitionMarker?: TransitionMarkerSettings;
  /** Optional peripheral commentator/reference streams (zero space reserved when empty) */
  peripheralStreams?: PeripheralStreamConfig[];
  preferSamePageSourceCommentary: boolean;
  continuationMarkerStyle: 'traditional_hebrew' | 'minimal' | 'hidden';
}

export type OpeningDecorationStyleId =
  | 'none'
  | 'simple_frame'
  | 'double_ornate'
  | 'crown_panel'
  | 'chumash_cartouche'
  // v0.9.9 (I2, Vilna preset): original Keter vector frames — plain
  // SVG/CSS rects and paths, nothing copied from the reference images.
  // 'patterned_rect': single frame with a repeating tick pattern along
  // the inner edge. 'stepped_frame': plain rules with stepped (notched)
  // corners. 'corner_ornament': plain double frame with scroll arcs in
  // the four corners.
  | 'patterned_rect'
  | 'stepped_frame'
  | 'corner_ornament';

export interface OpeningDecorationSettings {
  enabled: boolean;
  styleId: OpeningDecorationStyleId;
  wordCount: number;
  paddingPt: number;
  frameWidthPct?: number;
  customWordText?: string;
  /** Frame stroke width in pt (default 1.1 — the pre-v0.9.9 look). */
  thicknessPt?: number;
  /**
   * Scope of the frame. 'masechet_start' (default): only the first
   * eligible Gemara text at a masechet start. 'chapter_start': also the
   * first eligible Gemara text at each perek start. Never every page.
   */
  scope?: 'masechet_start' | 'chapter_start';
}

export interface SeparatorRuleSettings {
  styleId: SeparatorStyleId;
  widthRatio?: number;
  thicknessPt?: number;
  customSvgOrDataUrl?: string;
}

export interface TransitionMarkerSettings {
  enabled: boolean;
  markerText: string;
  requireVerifiedBoundary: boolean;
  highlightAmbiguousInQa: boolean;
  /**
   * v0.9.9 (I2): 'text' renders the marker text inline; 'boxed' renders
   * it inside a small bordered box (same text, same position).
   */
  style?: 'text' | 'boxed';
  /** Explicit marker font size in pt; undefined = auto (line size × 0.92, the pre-v0.9.9 look). */
  sizePt?: number;
  /**
   * v0.9.9 (I2): 'before_first_word' (default) puts the marker before
   * the first Gemara word in reading order; 'after_last_word' puts it
   * after the last word of the boundary line.
   */
  position?: 'before_first_word' | 'after_last_word';
}

export interface PeripheralStreamConfig {
  id: PeripheralStreamKind;
  enabled: boolean;
  placement: 'inside' | 'outside' | 'below';
  fontSizePt: number;
  widthPct: number;
}

export type StyleHierarchyLayer = 'book_default' | 'user_preset' | 'project' | 'local_override';

export const DEFAULT_OPENING_DECORATION: OpeningDecorationSettings = {
  enabled: false,
  styleId: 'double_ornate',
  wordCount: 1,
  paddingPt: 8,
  frameWidthPct: 48,
  customWordText: '',
  thicknessPt: 1.1,
  scope: 'masechet_start',
};

export const DEFAULT_COMMENTARY_SEPARATOR: SeparatorRuleSettings = {
  // v0.9.9 (I2) colon fix: the reconciliation default 'colon_dot'
  // renders a centred dot (•), but the v0.9.8 base rendered a literal
  // ':' after the last Rashi/Tosafot line. 'colon' restores the literal
  // glyph (canvas + PDF); 'colon_dot' stays available as an option.
  styleId: 'colon',
  widthRatio: 0.45,
  thicknessPt: 0.65,
};

export const DEFAULT_PARAGRAPH_SEPARATOR: SeparatorRuleSettings = {
  styleId: 'none',
  widthRatio: 0.35,
  thicknessPt: 0.6,
};

export const DEFAULT_TRANSITION_MARKER: TransitionMarkerSettings = {
  enabled: true,
  markerText: 'גמ׳',
  requireVerifiedBoundary: true,
  highlightAmbiguousInQa: true,
  style: 'text',
  position: 'before_first_word',
};

export const DEFAULT_PERIPHERAL_STREAMS: PeripheralStreamConfig[] = [
  { id: 'ein_mishpat', enabled: true, placement: 'outside', fontSizePt: 8.5, widthPct: 14 },
  { id: 'masoret_hashas', enabled: true, placement: 'inside', fontSizePt: 8.5, widthPct: 14 },
  { id: 'ner_mitzvah', enabled: true, placement: 'outside', fontSizePt: 8.5, widthPct: 14 },
  { id: 'torah_or', enabled: true, placement: 'below', fontSizePt: 8.5, widthPct: 24 },
  { id: 'gilyon_hashas', enabled: false, placement: 'inside', fontSizePt: 8.5, widthPct: 14 },
  { id: 'hagahot_habach', enabled: false, placement: 'below', fontSizePt: 8.5, widthPct: 24 },
  { id: 'rabbeinu_chananel', enabled: false, placement: 'outside', fontSizePt: 9, widthPct: 16 },
  { id: 'ran', enabled: false, placement: 'outside', fontSizePt: 9, widthPct: 16 },
  { id: 'maharsha', enabled: false, placement: 'below', fontSizePt: 9, widthPct: 28 },
];

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
  /**
   * v0.5.0 Part B (Module 4) — the selected / hovered SECTION (block), not a
   * word/token node: the whole section's identity plus its bounding box on
   * the page, in content-area points (origin: top-left of the text frame).
   * Filled by `PageCanvas` (see `onHoverBlock`) when the user hovers or
   * selects a section; undefined when no section is targeted.
   */
  blockBoundary?: {
    unitId: string;
    role?: ContentRole;
    /** Lines of the section on this page (count). */
    lineCount: number;
    firstLineIndex: number;
    lastLineIndex: number;
    /** Bounding box of the whole section, content-area points. */
    topPt: number;
    bottomPt: number;
    leftPt: number;
    rightPt: number;
  };
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
  /**
   * Layout training T10 — line breaking: 'optimal' (Knuth–Plass total
   * fit with glyph stretch ≤ 2.5% and space shrink ≤ 20%, default) or
   * 'greedy' (the first-fit breaker of v0.10.10 and earlier).
   */
  lineBreaking?: 'optimal' | 'greedy';
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
  // ── v0.5.0 Part B (Module 5) ──────────────────────────────────────────
  // Persisted record of the most recent block margin/spacing edit (see
  // `BlockSpacingSettings` above). The authoritative per-block values live
  // in the paragraph overrides / role styles it mirrors
  // (`localUnitOverrides`, `projectRoleStyles`); this section records them
  // plus the Auto-Center state so the AI actions and the panel can restore
  // the last values. It is NOT a second source of truth for rendering:
  // the pagination engine reads the paragraph styles, never this field.
  /** Margins / spacing of the most recently edited text block. */
  blockSpacing: BlockSpacingSettings;
  // ── v0.5.0 (Title Page / Shaar Blat builder) ──────────────────────────
  /** Title page (Shaar Blat): the book's first page. Off by default. */
  titlePage: TitlePageSettings;
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
