/**
 * Keter Typesetter — Title Page (Shaar Blat) preset collection (v0.9.9).
 *
 * Eight preset title-page templates, distilled as *patterns* (frame family
 * + hierarchy + spacing) from the ten title pages in the v0.9.9 reference
 * image catalog (`/tmp/v099-image-catalog.md` §C). The reference pages are
 * scans of published books and are style reference only: nothing is
 * copied, traced or embedded — every frame is original Keter vector work
 * in `title-page-borders.ts`, every ornament is original Keter vector work
 * in `ornament-library.ts`, and no reference text, logo or artwork is
 * reproduced. All metadata fields are optional; nothing invents an author,
 * publisher, dedication or approbation.
 *
 * ── How a template is stored (read this before wiring) ────────────────
 *
 * `TitlePageSettings` (`src/types/design-settings.ts`) has no typed
 * `templateId` / metadata fields yet — that file belongs to another agent
 * in this release. Until the coordinator adds them, a template lives on
 * the settings object as two plain extra properties:
 *
 *   - `templateId?: TitlePageTemplateId` — the chosen preset, or absent
 *     for the legacy/classic default (no template). Plain JSON, so it
 *     survives the `.keter` round-trip and `syncDerivedViews` (which
 *     mutates the title-page object in place and never strips unknown
 *     keys). Old projects load unchanged: no `templateId` means the
 *     current default rendering, byte for byte.
 *   - `templateMetadata?: TitlePageTemplateMetadata` — the extra metadata
 *     fields (English title, editor, dedication, publisher location /
 *     website, Hebrew date, …). Same survival story.
 *
 * The accessors below read/write those properties through a cast so this
 * file compiles against today's `TitlePageSettings` type; once the typed
 * fields exist the casts collapse to plain property access.
 *
 * A template changes STYLES only — never text. `applyTitlePageTemplate`
 * writes the template's border (see the fallback note), per-field sizes /
 * spacing / alignment and the `templateId`; every text field keeps exactly
 * what the user typed.
 *
 * ── What the PDF can and cannot render today ───────────────────────────
 *
 * The PDF path (`pdf-exporter.ts`, `toc-engine.ts`) is outside this
 * file's ownership, so the templates were designed to degrade gracefully
 * there — and the gaps are listed here, not hidden:
 *
 *   RENDERS in the PDF today (flows through `layoutTitlePageFields` /
 *   `titlePageSettingsToCoverData` / the title-page render plan):
 *   - the 7 standard fields (title, subtitle, author, translator,
 *     volume, year, publisher) with the template's font sizes, spacing,
 *     alignment and line height — `applyTitlePageTemplate` writes those
 *     into the settings, so preview and PDF agree;
 *   - the 6 free extra lines, unchanged;
 *   - the frame, as the template's PDF-fallback border (below).
 *
 *   DOES NOT render in the PDF today (preview-only until the coordinator
 *   wires the PDF path — exact wiring listed at the end of this file):
 *   - the template's own NEW border id (`floral_double`,
 *     `wide_pattern_band`, `baroque_scroll`, `ring_band`,
 *     `double_corner_marks`): the PDF renders the template's
 *     `pdfFallbackBorderStyleId` instead, because `syncDerivedViews`
 *     resets any border id outside the `TitlePageBorderStyleId` union to
 *     `'double'`. The fallback is the closest existing stock style.
 *   - the template's background style (plain / warm / textured): the PDF
 *     cover fills solid `#FCFAF5`; the in-doc title page uses the page
 *     background.
 *   - template ornaments (foot emblem, dividers): `TitlePagePlanData` /
 *     `CoverPageData` carry no ornament slot (`cover.ornament` is a text
 *     string, not a vector asset). The canvas/PDF draw helpers exist in
 *     `ornament-library.ts` (`drawTitlePageOrnamentOnCanvas` /
 *     `drawTitlePageOrnamentOnPdf`) for the wiring.
 *   - the structured metadata fields (`templateMetadata`: English title,
 *     editor, dedication, publisher location/website, Hebrew date,
 *     opening formula, series label, description, source credit, Hebrew
 *     header line): `layoutTitlePageFields` only knows the 7 standard
 *     fields + extra lines, so these rows exist in the preview overlay
 *     only. A user who needs one of them in print today can copy it into
 *     a free extra line, which the PDF does render.
 *   - overlay-only typography: italic, all-caps, small-caps and
 *     letter-spacing. `TitlePageFieldStyle` has no italic/transform flag
 *     and the render plan's row has only `isBold`, so the PDF renders
 *     these fields upright, mixed case. (The title is bold in both.)
 *
 * ── Required coordinator wiring (files outside this agent's ownership) ─
 *
 *  1. `src/types/design-settings.ts`: add the 5 new ids to the
 *     `TitlePageBorderStyleId` union, and add optional
 *     `templateId?: TitlePageTemplateId` +
 *     `templateMetadata?: TitlePageTemplateMetadata` to `TitlePageSettings`
 *     (then the casts in this file collapse, and the PDF fallback
 *     becomes the template's real frame).
 *  2. `src/engine/pdf-exporter.ts` + `src/engine/toc-engine.ts`:
 *     carry `templateId`/`templateMetadata`/ornaments/background through
 *     `TitlePagePlanData` / `CoverPageData` and render the metadata rows,
 *     ornaments and background in `renderCoverPageToPdf` + the canvas
 *     fallback + the native-text invisible layer.
 *  3. `src/App.tsx` `handleTitlePageFieldChange` /
 *     `handleTitlePageFieldPositionChange`: accept `meta:<key>` field ids
 *     and write them into `templateMetadata` (the overlay already emits
 *     them; today App drops unknown ids).
 *  4. `src/i18n/strings.ts`: the entries in `/tmp/v099-titlepage-strings.md`.
 */

import type {
  TitlePageBorderStyleId,
  TitlePageFieldStyle,
  TitlePageSettings,
} from '../types/design-settings';
import {
  TITLE_PAGE_TEMPLATE_BORDER_STYLES,
  type TitlePageTemplateBorderStyleId,
} from './title-page-borders';

/** Version of this preset collection (bump when a template's defaults change). */
export const TITLE_PAGE_TEMPLATES_VERSION = 1;

export type TitlePageTemplateId =
  | 'ornate_floral_double'
  | 'wide_pattern_band'
  | 'baroque_scroll'
  | 'minimal_stepped'
  | 'frameless_minimal'
  | 'bold_geometric_ring'
  | 'bilingual_knot'
  | 'thin_double_minimal';

export type TitlePageBackgroundKind = 'plain' | 'warm' | 'textured';

/** Extra metadata fields a template can show. Every one is optional;
 *  empty stays empty and is never printed. Nothing here is invented by
 *  the app — each value is typed by the user (or imported from the .docx
 *  title-page classification, which only copies lines that exist). */
export type TitlePageMetadataKey =
  | 'titleEn'
  | 'subtitleEn'
  | 'editor'
  | 'dedication'
  | 'openingFormula'
  | 'seriesLabel'
  | 'description'
  | 'publisherLocation'
  | 'publisherWebsite'
  | 'hebrewDate'
  | 'sourceCredit'
  | 'hebrewHeader';

export interface TitlePageTemplateMetadata {
  titleEn?: string;
  subtitleEn?: string;
  editor?: string;
  dedication?: string;
  openingFormula?: string;
  seriesLabel?: string;
  description?: string;
  publisherLocation?: string;
  publisherWebsite?: string;
  hebrewDate?: string;
  sourceCredit?: string;
  /** Template 8 only: the single Hebrew line at the very top, underlined
   *  by a short rule. */
  hebrewHeader?: string;
  /** Template 8 only: title type style sub-option. */
  titleStyle?: 'upright' | 'boldItalic';
  /** User override for the template's background ('plain' | 'warm' |
   *  'textured'); absent = the template's own background. */
  backgroundOverride?: TitlePageBackgroundKind;
  /** User override for the template's foot emblem ornament id
   *  ('orn-tp-foot-emblem' etc., or 'none'); absent = the template's own
   *  emblem. This is a vector ornament, NOT an uploaded publisher logo —
   *  a logo upload is not built (see the report). */
  emblemId?: string;
}

export type TitlePageStandardFieldId =
  | 'title' | 'subtitle' | 'author' | 'translator'
  | 'publisher' | 'volume' | 'year';

/** Per-field typography a template sets. `italic` / `uppercase` /
 *  `smallCaps` / `letterSpacingPt` are preview-only today (see the header:
 *  the PDF row carries no such flag) — they are still stored on the
 *  template so the PDF wiring can pick them up without re-deriving them. */
export interface TitlePageTemplateFieldStyle {
  fontSizePt: number;
  spaceAbovePt: number;
  spaceBelowPt: number;
  lineHeight?: number;
  alignment?: 'center' | 'right' | 'left';
  italic?: boolean;
  uppercase?: boolean;
  smallCaps?: boolean;
  letterSpacingPt?: number;
}

export interface TitlePageTemplateMetadataStyle {
  fontSizePt: number;
  lineHeight?: number;
  alignment?: 'center' | 'right' | 'left';
  italic?: boolean;
  uppercase?: boolean;
  smallCaps?: boolean;
  /** Text colour; default '#6B5E4C' (muted) except titleEn. */
  colorHex?: string;
}

/** Where a metadata field sits. Zones are positioned so they never shift
 *  the shared standard-field stack (preview/PDF parity): 'top' sits above
 *  the title anchor, 'underTitle' hangs directly under the title row,
 *  'midLower' hangs under the last standard upper row, 'foot' sits below
 *  the pinned publisher line. */
export type TitlePageMetadataZone = 'top' | 'underTitle' | 'midLower' | 'foot';

export interface TitlePageTemplateMetadataSlot {
  key: TitlePageMetadataKey;
  zone: TitlePageMetadataZone;
  /** Draw a short rule under this row (template 8's Hebrew header line). */
  ruleBelow?: boolean;
}

export interface TitlePageTemplateOrnament {
  ornamentId: string;
  position: 'topCenter' | 'belowTitle' | 'abovePublisher' | 'footCenter';
  widthPt: number;
}

export interface TitlePageTemplate {
  id: TitlePageTemplateId;
  version: number;
  nameHe: string;
  nameEn: string;
  descriptionHe: string;
  descriptionEn: string;
  bestForHe: string;
  bestForEn: string;
  language: 'he' | 'en' | 'bilingual';
  /** The template's own frame (may be a template-only border id). */
  borderStyleId: TitlePageBorderStyleId | TitlePageTemplateBorderStyleId;
  /** Closest existing stock style — stored in `border.styleId` so the PDF
   *  renders a near neighbour until the new id joins the union. */
  pdfFallbackBorderStyleId: TitlePageBorderStyleId;
  borderEnabled: boolean;
  borderThicknessPt: number;
  borderInsetMm: number;
  background: TitlePageBackgroundKind;
  ornaments: TitlePageTemplateOrnament[];
  fieldStyles: Partial<Record<TitlePageStandardFieldId, TitlePageTemplateFieldStyle>>;
  metadataStyles: Partial<Record<TitlePageMetadataKey, TitlePageTemplateMetadataStyle>>;
  metadataOrder: TitlePageTemplateMetadataSlot[];
  /** Metadata keys shown as faint placeholders in the preview when empty
   *  (never exported). */
  primaryMetadata: TitlePageMetadataKey[];
  /** Template 8 only: the title type-style sub-options. */
  titleStyleOptions?: Array<'upright' | 'boldItalic'>;
  /** Caution shown under the picker (e.g. the frameless half-title note). */
  cautionHe?: string;
  cautionEn?: string;
}

const V = TITLE_PAGE_TEMPLATES_VERSION;

export const TITLE_PAGE_TEMPLATES: TitlePageTemplate[] = [
  {
    id: 'ornate_floral_double',
    version: V,
    nameHe: 'מסגרת פרחונית כפולה מעוטרת',
    nameEn: 'Ornate floral double-frame',
    descriptionHe: 'מסגרת כפולה דקה עם עלים חוזרים ברצועה וסלסולים בפינות; כותרת גדולה ומודגשת.',
    descriptionEn: 'Thin double rule with repeating leaves in the band and corner scrolls; very large bold title.',
    bestForHe: 'ספרי קודש קלאסיים',
    bestForEn: 'Classic Hebrew sefarim',
    language: 'he',
    borderStyleId: 'floral_double',
    pdfFallbackBorderStyleId: 'floral_panel',
    borderEnabled: true,
    borderThicknessPt: 1,
    borderInsetMm: 10,
    background: 'warm',
    ornaments: [{ ornamentId: 'orn-tp-leaf-divider', position: 'belowTitle', widthPt: 120 }],
    fieldStyles: {
      title: { fontSizePt: 34, spaceAbovePt: 0, spaceBelowPt: 18 },
      subtitle: { fontSizePt: 15, spaceAbovePt: 6, spaceBelowPt: 10 },
      author: { fontSizePt: 13, spaceAbovePt: 10, spaceBelowPt: 6 },
      translator: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 },
      volume: { fontSizePt: 13, spaceAbovePt: 8, spaceBelowPt: 4 },
      year: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 },
      publisher: { fontSizePt: 12, spaceAbovePt: 0, spaceBelowPt: 0 },
    },
    metadataStyles: {
      seriesLabel: { fontSizePt: 11, colorHex: '#6B5E4C' },
      dedication: { fontSizePt: 12, italic: true, colorHex: '#2C2A29' },
      sourceCredit: { fontSizePt: 10, colorHex: '#6B5E4C' },
      hebrewDate: { fontSizePt: 11, colorHex: '#6B5E4C' },
    },
    metadataOrder: [
      { key: 'seriesLabel', zone: 'top' },
      { key: 'editor', zone: 'midLower' },
      { key: 'dedication', zone: 'midLower' },
      { key: 'hebrewDate', zone: 'foot' },
      { key: 'sourceCredit', zone: 'foot' },
    ],
    primaryMetadata: ['seriesLabel', 'dedication'],
  },
  {
    id: 'wide_pattern_band',
    version: V,
    nameHe: 'רצועה רחבה בדוגמה',
    nameEn: 'Wide patterned band',
    descriptionHe: 'רצועה רחבה בדוגמת שתי וערב, קו פנימי דק ורקע בעל מרקם עדין; גוש טקסט קומפקטי.',
    descriptionEn: 'Broad woven patterned band, thin inner rule, subtly textured background; compact text block.',
    bestForHe: 'שערים מלאי טקסט או דלילי טקסט כאחד',
    bestForEn: 'Sparse and text-heavy title pages alike',
    language: 'he',
    borderStyleId: 'wide_pattern_band',
    pdfFallbackBorderStyleId: 'dark_mosaic',
    borderEnabled: true,
    borderThicknessPt: 1.5,
    borderInsetMm: 8,
    background: 'textured',
    ornaments: [],
    fieldStyles: {
      title: { fontSizePt: 30, spaceAbovePt: 0, spaceBelowPt: 12 },
      subtitle: { fontSizePt: 14, spaceAbovePt: 4, spaceBelowPt: 8 },
      author: { fontSizePt: 12, spaceAbovePt: 8, spaceBelowPt: 4 },
      translator: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 4 },
      volume: { fontSizePt: 12, spaceAbovePt: 6, spaceBelowPt: 4 },
      year: { fontSizePt: 11, spaceAbovePt: 4, spaceBelowPt: 4 },
      publisher: { fontSizePt: 11, spaceAbovePt: 0, spaceBelowPt: 0 },
    },
    metadataStyles: {
      openingFormula: { fontSizePt: 11, colorHex: '#6B5E4C' },
      description: { fontSizePt: 11, lineHeight: 1.5, colorHex: '#2C2A29' },
      sourceCredit: { fontSizePt: 10, colorHex: '#6B5E4C' },
      hebrewDate: { fontSizePt: 11, colorHex: '#6B5E4C' },
    },
    metadataOrder: [
      { key: 'openingFormula', zone: 'top' },
      { key: 'description', zone: 'midLower' },
      { key: 'hebrewDate', zone: 'foot' },
      { key: 'sourceCredit', zone: 'foot' },
    ],
    primaryMetadata: ['openingFormula', 'description'],
  },
  {
    id: 'baroque_scroll',
    version: V,
    nameHe: 'מסגרת סלסולים בארוקית',
    nameEn: 'Baroque scroll frame',
    descriptionHe: 'קו דק ובהיר עם סלסולים גדולים בפינות ומדליונים באמצע הצלעות; סמל במרכז התחתית.',
    descriptionEn: 'Light thin outline with large corner scrolls and mid-edge medallions; emblem centred at the foot.',
    bestForHe: 'מראה אלגנטי, קל ומסורתי',
    bestForEn: 'Elegant, light, traditional feel',
    language: 'he',
    borderStyleId: 'baroque_scroll',
    pdfFallbackBorderStyleId: 'ornate',
    borderEnabled: true,
    borderThicknessPt: 0.75,
    borderInsetMm: 12,
    background: 'plain',
    ornaments: [{ ornamentId: 'orn-tp-foot-emblem', position: 'footCenter', widthPt: 54 }],
    fieldStyles: {
      title: { fontSizePt: 32, spaceAbovePt: 0, spaceBelowPt: 16 },
      subtitle: { fontSizePt: 15, spaceAbovePt: 6, spaceBelowPt: 10, italic: true },
      author: { fontSizePt: 13, spaceAbovePt: 10, spaceBelowPt: 6 },
      translator: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 },
      volume: { fontSizePt: 13, spaceAbovePt: 8, spaceBelowPt: 4 },
      year: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 },
      publisher: { fontSizePt: 11, spaceAbovePt: 0, spaceBelowPt: 0 },
    },
    metadataStyles: {
      openingFormula: { fontSizePt: 11, colorHex: '#6B5E4C' },
      description: { fontSizePt: 11, lineHeight: 1.5, colorHex: '#2C2A29' },
      sourceCredit: { fontSizePt: 10, colorHex: '#6B5E4C' },
      hebrewDate: { fontSizePt: 11, colorHex: '#6B5E4C' },
    },
    metadataOrder: [
      { key: 'openingFormula', zone: 'top' },
      { key: 'description', zone: 'midLower' },
      { key: 'hebrewDate', zone: 'foot' },
      { key: 'sourceCredit', zone: 'foot' },
    ],
    primaryMetadata: ['openingFormula'],
  },
  {
    id: 'minimal_stepped',
    version: V,
    nameHe: 'מסגרת מדורגת מינימלית',
    nameEn: 'Minimal stepped-line frame',
    descriptionHe: 'שניים־שלושה קווים דקים עם פינות מדורגות, בלי עיטור; הרבה שטח לבן.',
    descriptionEn: 'Two or three plain thin rules with notched stepped corners, no ornament fill; very large white space.',
    bestForHe: 'שערים עבריים מינימליים ואווריריים',
    bestForEn: 'Airy, modern-minimal Hebrew titles',
    language: 'he',
    borderStyleId: 'stepped',
    pdfFallbackBorderStyleId: 'stepped',
    borderEnabled: true,
    borderThicknessPt: 0.75,
    borderInsetMm: 14,
    background: 'plain',
    ornaments: [],
    fieldStyles: {
      title: { fontSizePt: 30, spaceAbovePt: 0, spaceBelowPt: 24 },
      subtitle: { fontSizePt: 14, spaceAbovePt: 8, spaceBelowPt: 12 },
      author: { fontSizePt: 13, spaceAbovePt: 12, spaceBelowPt: 8 },
      translator: { fontSizePt: 12, spaceAbovePt: 6, spaceBelowPt: 6 },
      volume: { fontSizePt: 13, spaceAbovePt: 10, spaceBelowPt: 6 },
      year: { fontSizePt: 11, spaceAbovePt: 6, spaceBelowPt: 6 },
      publisher: { fontSizePt: 11, spaceAbovePt: 0, spaceBelowPt: 0 },
    },
    metadataStyles: {
      sourceCredit: { fontSizePt: 10, colorHex: '#6B5E4C' },
      seriesLabel: { fontSizePt: 11, colorHex: '#6B5E4C' },
      dedication: { fontSizePt: 12, italic: true, colorHex: '#2C2A29' },
      hebrewDate: { fontSizePt: 11, colorHex: '#6B5E4C' },
    },
    metadataOrder: [
      { key: 'sourceCredit', zone: 'top' },
      { key: 'seriesLabel', zone: 'top' },
      { key: 'dedication', zone: 'midLower' },
      { key: 'hebrewDate', zone: 'foot' },
    ],
    primaryMetadata: ['seriesLabel'],
  },
  {
    id: 'frameless_minimal',
    version: V,
    nameHe: 'ללא מסגרת — מינימלי',
    nameEn: 'Frameless minimal',
    descriptionHe: 'בלי מסגרת ובלי עיטור; כמה שורות קטנות במרכז השליש העליון והשאר ריק.',
    descriptionEn: 'No frame at all; a few small centred lines in the upper third and the rest blank.',
    bestForHe: 'שער פנימי / שער חצי',
    bestForEn: 'Inner / half title',
    language: 'he',
    borderStyleId: 'none',
    pdfFallbackBorderStyleId: 'none',
    borderEnabled: false,
    borderThicknessPt: 1,
    borderInsetMm: 12,
    background: 'plain',
    ornaments: [],
    fieldStyles: {
      title: { fontSizePt: 24, spaceAbovePt: 0, spaceBelowPt: 12 },
      subtitle: { fontSizePt: 13, spaceAbovePt: 4, spaceBelowPt: 8 },
      author: { fontSizePt: 12, spaceAbovePt: 8, spaceBelowPt: 6 },
      translator: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 },
      volume: { fontSizePt: 12, spaceAbovePt: 6, spaceBelowPt: 4 },
      year: { fontSizePt: 11, spaceAbovePt: 4, spaceBelowPt: 6 },
      publisher: { fontSizePt: 11, spaceAbovePt: 0, spaceBelowPt: 0 },
    },
    metadataStyles: {
      seriesLabel: { fontSizePt: 11, colorHex: '#6B5E4C' },
      sourceCredit: { fontSizePt: 10, colorHex: '#6B5E4C' },
    },
    metadataOrder: [
      { key: 'seriesLabel', zone: 'top' },
      { key: 'sourceCredit', zone: 'top' },
    ],
    primaryMetadata: ['seriesLabel'],
    cautionHe: 'תבנית ללא מסגרת — מתאימה כשער פנימי / שער חצי. יש לאשר לפני שימוש כשער קדמי מלא.',
    cautionEn: 'Frameless template — suited as an inner / half title. Confirm before using as a full front title page.',
  },
  {
    id: 'bold_geometric_ring',
    version: V,
    nameHe: 'רצועת טבעות גיאומטרית (אנגלית)',
    nameEn: 'Bold geometric ring-band (English)',
    descriptionHe: 'רצועה עבה של טבעות חוזרות בניגודיות גבוהה; כותרת גדולה באותיות רישיות, כותרת משנה נטויה.',
    descriptionEn: 'Thick high-contrast border of repeating rings; very large all-caps title, italic subtitle, small-caps author.',
    bestForHe: 'כותרות אנגליות נועזות',
    bestForEn: 'Bold English titles',
    language: 'en',
    borderStyleId: 'ring_band',
    pdfFallbackBorderStyleId: 'rosette_band',
    borderEnabled: true,
    borderThicknessPt: 2,
    borderInsetMm: 8,
    background: 'plain',
    ornaments: [
      { ornamentId: 'orn-tp-ring-divider', position: 'belowTitle', widthPt: 140 },
      { ornamentId: 'orn-tp-foot-emblem', position: 'footCenter', widthPt: 54 },
    ],
    fieldStyles: {
      title: { fontSizePt: 36, spaceAbovePt: 0, spaceBelowPt: 14, uppercase: true, letterSpacingPt: 1 },
      subtitle: { fontSizePt: 16, spaceAbovePt: 6, spaceBelowPt: 10, italic: true },
      author: { fontSizePt: 12, spaceAbovePt: 10, spaceBelowPt: 6, smallCaps: true },
      translator: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6, smallCaps: true },
      volume: { fontSizePt: 12, spaceAbovePt: 8, spaceBelowPt: 4 },
      year: { fontSizePt: 11, spaceAbovePt: 4, spaceBelowPt: 6 },
      publisher: { fontSizePt: 11, spaceAbovePt: 0, spaceBelowPt: 0 },
    },
    metadataStyles: {
      openingFormula: { fontSizePt: 11, colorHex: '#6B5E4C' },
      description: { fontSizePt: 11, lineHeight: 1.5, colorHex: '#2C2A29' },
      publisherLocation: { fontSizePt: 11, colorHex: '#6B5E4C' },
      publisherWebsite: { fontSizePt: 10, colorHex: '#6B5E4C' },
      sourceCredit: { fontSizePt: 10, colorHex: '#6B5E4C' },
      hebrewDate: { fontSizePt: 11, colorHex: '#6B5E4C' },
    },
    metadataOrder: [
      { key: 'openingFormula', zone: 'top' },
      { key: 'description', zone: 'midLower' },
      { key: 'publisherLocation', zone: 'foot' },
      { key: 'publisherWebsite', zone: 'foot' },
      { key: 'hebrewDate', zone: 'foot' },
      { key: 'sourceCredit', zone: 'foot' },
    ],
    primaryMetadata: ['openingFormula', 'description'],
  },
  {
    id: 'bilingual_knot',
    version: V,
    nameHe: 'קו כפול דו־לשוני עם קשרי פינה',
    nameEn: 'Bilingual double-rule with knot corners',
    descriptionHe: 'קו כפול דק עם קשרים בפינות; כותרת עברית מעל כותרת אנגלית גדולה, כותרת משנה נטויה.',
    descriptionEn: 'Thin double rule with knot motifs at the corners; Hebrew title block above a large English title, italic subtitle.',
    bestForHe: 'כותרות דו־לשוניות עברית/אנגלית',
    bestForEn: 'Bilingual Hebrew/English titles',
    language: 'bilingual',
    borderStyleId: 'chamfer_knot',
    pdfFallbackBorderStyleId: 'chamfer_knot',
    borderEnabled: true,
    borderThicknessPt: 1,
    borderInsetMm: 10,
    background: 'warm',
    ornaments: [{ ornamentId: 'orn-tp-foot-emblem', position: 'footCenter', widthPt: 54 }],
    fieldStyles: {
      title: { fontSizePt: 30, spaceAbovePt: 0, spaceBelowPt: 14 },
      subtitle: { fontSizePt: 15, spaceAbovePt: 6, spaceBelowPt: 10 },
      author: { fontSizePt: 12, spaceAbovePt: 10, spaceBelowPt: 6, smallCaps: true },
      translator: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6, smallCaps: true },
      volume: { fontSizePt: 12, spaceAbovePt: 8, spaceBelowPt: 4 },
      year: { fontSizePt: 11, spaceAbovePt: 4, spaceBelowPt: 6 },
      publisher: { fontSizePt: 11, spaceAbovePt: 0, spaceBelowPt: 0 },
    },
    metadataStyles: {
      openingFormula: { fontSizePt: 11, colorHex: '#6B5E4C' },
      titleEn: { fontSizePt: 26, lineHeight: 1.2, colorHex: '#121214' },
      subtitleEn: { fontSizePt: 14, italic: true, colorHex: '#2C2A29' },
      editor: { fontSizePt: 12, colorHex: '#6B5E4C' },
      description: { fontSizePt: 11, lineHeight: 1.5, colorHex: '#2C2A29' },
      publisherLocation: { fontSizePt: 11, colorHex: '#6B5E4C' },
      publisherWebsite: { fontSizePt: 10, colorHex: '#6B5E4C' },
      sourceCredit: { fontSizePt: 10, colorHex: '#6B5E4C' },
      hebrewDate: { fontSizePt: 11, colorHex: '#6B5E4C' },
    },
    metadataOrder: [
      { key: 'openingFormula', zone: 'top' },
      { key: 'titleEn', zone: 'underTitle' },
      { key: 'subtitleEn', zone: 'underTitle' },
      { key: 'editor', zone: 'midLower' },
      { key: 'description', zone: 'midLower' },
      { key: 'publisherLocation', zone: 'foot' },
      { key: 'publisherWebsite', zone: 'foot' },
      { key: 'hebrewDate', zone: 'foot' },
      { key: 'sourceCredit', zone: 'foot' },
    ],
    primaryMetadata: ['titleEn', 'subtitleEn'],
  },
  {
    id: 'thin_double_minimal',
    version: V,
    nameHe: 'קו כפול דק מינימלי (אנגלית)',
    nameEn: 'Thin double-rule minimal (English)',
    descriptionHe: 'קו כפול דק מאוד עם סימני פינה; כותרת גדולה (ישרה או מודגשת־נטויה), הרבה שטח לבן.',
    descriptionEn: 'Very thin double rule with small corner marks; large serif title (upright or bold italic), generous white space.',
    bestForHe: 'כותרות אנגליות שקטות ומודרניות',
    bestForEn: 'Quiet, modern English titles',
    language: 'en',
    borderStyleId: 'double_corner_marks',
    pdfFallbackBorderStyleId: 'double',
    borderEnabled: true,
    borderThicknessPt: 0.75,
    borderInsetMm: 14,
    background: 'plain',
    ornaments: [{ ornamentId: 'orn-tp-leaf-divider', position: 'belowTitle', widthPt: 110 }],
    fieldStyles: {
      title: { fontSizePt: 32, spaceAbovePt: 0, spaceBelowPt: 16 },
      subtitle: { fontSizePt: 15, spaceAbovePt: 6, spaceBelowPt: 10, italic: true },
      author: { fontSizePt: 12, spaceAbovePt: 10, spaceBelowPt: 6 },
      translator: { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 },
      volume: { fontSizePt: 12, spaceAbovePt: 8, spaceBelowPt: 4 },
      year: { fontSizePt: 11, spaceAbovePt: 4, spaceBelowPt: 6 },
      publisher: { fontSizePt: 11, spaceAbovePt: 0, spaceBelowPt: 0 },
    },
    metadataStyles: {
      hebrewHeader: { fontSizePt: 13, colorHex: '#2C2A29' },
      openingFormula: { fontSizePt: 11, colorHex: '#6B5E4C' },
      description: { fontSizePt: 11, lineHeight: 1.5, colorHex: '#2C2A29' },
      publisherLocation: { fontSizePt: 11, colorHex: '#6B5E4C' },
      publisherWebsite: { fontSizePt: 10, colorHex: '#6B5E4C' },
      sourceCredit: { fontSizePt: 10, colorHex: '#6B5E4C' },
      hebrewDate: { fontSizePt: 11, colorHex: '#6B5E4C' },
    },
    metadataOrder: [
      { key: 'hebrewHeader', zone: 'top', ruleBelow: true },
      { key: 'openingFormula', zone: 'top' },
      { key: 'description', zone: 'midLower' },
      { key: 'publisherLocation', zone: 'foot' },
      { key: 'publisherWebsite', zone: 'foot' },
      { key: 'hebrewDate', zone: 'foot' },
      { key: 'sourceCredit', zone: 'foot' },
    ],
    primaryMetadata: ['hebrewHeader'],
    titleStyleOptions: ['upright', 'boldItalic'],
  },
];

export function getTitlePageTemplate(id: string | undefined | null): TitlePageTemplate | null {
  if (!id) return null;
  return TITLE_PAGE_TEMPLATES.find(t => t.id === id) ?? null;
}

/** Hebrew labels for the metadata keys (the panel + overlay render these
 *  through `t()`; the English strings live in the patch list at
 *  `/tmp/v099-titlepage-strings.md`). */
export const TITLE_PAGE_METADATA_LABELS_HE: Record<TitlePageMetadataKey, string> = {
  titleEn: 'כותרת באנגלית',
  subtitleEn: 'כותרת משנה באנגלית',
  editor: 'עורך',
  dedication: 'הקדשה',
  openingFormula: 'נוסחת פתיחה',
  seriesLabel: 'תווית סדרה',
  description: 'תיאור הספר',
  publisherLocation: 'מקום ההוצאה',
  publisherWebsite: 'אתר המוציא לאור',
  hebrewDate: 'תאריך עברי',
  sourceCredit: 'קרדיט מקור',
  hebrewHeader: 'שורת כותרת עברית',
};

/** Placeholders for the metadata inputs (Hebrew literals; English in the
 *  patch list). */
export const TITLE_PAGE_METADATA_PLACEHOLDERS_HE: Record<TitlePageMetadataKey, string> = {
  titleEn: 'למשל: The Guide for the Perplexed',
  subtitleEn: 'למשל: A New English Translation',
  editor: 'למשל: הרב משה כהן',
  dedication: 'למשל: לזכר אבי מורי ז״ל',
  openingFormula: 'למשל: בס״ד',
  seriesLabel: 'למשל: סדרת כתבי קודש',
  description: 'תיאור קצר של הספר…',
  publisherLocation: 'למשל: ירושלים',
  publisherWebsite: 'למשל: www.example.org',
  hebrewDate: 'למשל: תשפ״ז',
  sourceCredit: 'למשל: באדיבות הספרייה הדיגיטלית',
  hebrewHeader: 'למשל: ספר קודש',
};

// ── Storage accessors (extra properties on TitlePageSettings) ────────────

/** The extra properties a template stores on `TitlePageSettings`. Casts
 *  only — see the header note; delete the casts when the typed fields
 *  land in `design-settings.ts`. */
type TitlePageSettingsWithTemplate = TitlePageSettings & {
  templateId?: TitlePageTemplateId;
  templateMetadata?: TitlePageTemplateMetadata;
};

export function readTitlePageTemplateState(settings: TitlePageSettings): {
  templateId?: TitlePageTemplateId;
  metadata: TitlePageTemplateMetadata;
} {
  const s = settings as TitlePageSettingsWithTemplate;
  return {
    templateId: getTitlePageTemplate(s.templateId) ? s.templateId : undefined,
    metadata: (s.templateMetadata && typeof s.templateMetadata === 'object')
      ? { ...s.templateMetadata }
      : {},
  };
}

export function writeTitlePageTemplateState(
  settings: TitlePageSettings,
  templateId: TitlePageTemplateId | undefined,
  metadata: TitlePageTemplateMetadata
): TitlePageSettings {
  const next = JSON.parse(JSON.stringify(settings)) as TitlePageSettingsWithTemplate;
  if (templateId && getTitlePageTemplate(templateId)) {
    next.templateId = templateId;
  } else {
    delete next.templateId;
  }
  const cleaned: TitlePageTemplateMetadata = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (typeof v === 'string' ? v.trim() !== '' : v !== undefined) {
      (cleaned as unknown as Record<string, unknown>)[k] = typeof v === 'string' ? v : v;
    }
  }
  if (Object.keys(cleaned).length > 0) {
    next.templateMetadata = cleaned;
  } else {
    delete next.templateMetadata;
  }
  return next;
}

/**
 * Resolve the active template. Inference from the border id only fires
 * for the five template-only border ids (which can never appear in a
 * legacy project); the existing ids (`stepped`, `none`, `chamfer_knot`,
 * …) deliberately infer NOTHING, so a legacy project that happened to
 * pick one of those frames keeps its exact current rendering.
 */
export function resolveTitlePageTemplate(settings: TitlePageSettings): TitlePageTemplate | null {
  const { templateId } = readTitlePageTemplateState(settings);
  if (templateId) return getTitlePageTemplate(templateId);
  const borderId = settings.border?.styleId;
  const byBorder = TITLE_PAGE_TEMPLATES.find(t => {
    const templateOnly = TITLE_PAGE_TEMPLATE_BORDER_STYLES.some(s => s.id === t.borderStyleId);
    return templateOnly && t.borderStyleId === borderId;
  });
  return byBorder ?? null;
}

export function resolveTitlePageTemplateId(settings: TitlePageSettings): TitlePageTemplateId | null {
  return resolveTitlePageTemplate(settings)?.id ?? null;
}

/** The frame the preview draws: the template's own border id when a
 *  template is active, otherwise the stored stock border id. */
export function effectiveTitlePageBorderStyleId(
  settings: TitlePageSettings
): TitlePageBorderStyleId | TitlePageTemplateBorderStyleId {
  return resolveTitlePageTemplate(settings)?.borderStyleId ?? settings.border.styleId;
}

/** The background the preview draws (template default, or the user's
 *  override from the metadata). No template = plain. */
export function effectiveTitlePageBackground(settings: TitlePageSettings): TitlePageBackgroundKind {
  const template = resolveTitlePageTemplate(settings);
  const { metadata } = readTitlePageTemplateState(settings);
  if (!template) return 'plain';
  return metadata.backgroundOverride ?? template.background;
}

/**
 * The ornaments the preview draws. The template's set, with the foot
 * emblem replaced by the user's `emblemId` choice when one is set
 * (`'none'` removes the foot emblem).
 */
export function resolveTemplateOrnaments(
  settings: TitlePageSettings,
  template: TitlePageTemplate
): TitlePageTemplateOrnament[] {
  const { metadata } = readTitlePageTemplateState(settings);
  const base = template.ornaments.filter(o => o.position !== 'footCenter');
  const emblemChoice = metadata.emblemId;
  if (emblemChoice === 'none') return base;
  if (emblemChoice) {
    return [...base, { ornamentId: emblemChoice, position: 'footCenter', widthPt: 54 }];
  }
  return template.ornaments;
}

/**
 * Apply a template to a title-page settings object. Returns a NEW object;
 * the input is untouched. Text is preserved exactly — only the frame,
 * the per-field sizes/spacing/alignment/line-height and the stored
 * `templateId` change. The stored `border.styleId` is set to the
 * template's PDF-fallback style (see the header note).
 */
export function applyTitlePageTemplate(
  settings: TitlePageSettings,
  templateId: TitlePageTemplateId
): TitlePageSettings {
  const template = getTitlePageTemplate(templateId);
  if (!template) return settings;
  const next = JSON.parse(JSON.stringify(settings)) as TitlePageSettingsWithTemplate;
  next.templateId = templateId;
  next.border = {
    ...next.border,
    enabled: template.borderEnabled,
    styleId: template.pdfFallbackBorderStyleId,
    thicknessPt: template.borderThicknessPt,
    insetMm: template.borderInsetMm,
  };
  const fields: TitlePageStandardFieldId[] = ['title', 'subtitle', 'author', 'translator', 'publisher', 'volume', 'year'];
  for (const f of fields) {
    const style = template.fieldStyles[f];
    if (!style) continue;
    const cur: TitlePageFieldStyle = (next as unknown as Record<string, TitlePageFieldStyle>)[f];
    (next as unknown as Record<string, TitlePageFieldStyle>)[f] = {
      ...cur,
      fontSizePt: style.fontSizePt,
      spaceAbovePt: style.spaceAbovePt,
      spaceBelowPt: style.spaceBelowPt,
      lineHeight: style.lineHeight ?? cur.lineHeight ?? 1.2,
      alignment: style.alignment ?? cur.alignment,
    };
  }
  return next;
}

/** Clear the template (back to the legacy/classic default rendering):
 *  removes `templateId`, restores the stock double frame. Text and the
 *  metadata bag are kept — the metadata simply stops rendering without
 *  an active template. */
export function clearTitlePageTemplate(settings: TitlePageSettings): TitlePageSettings {
  const next = JSON.parse(JSON.stringify(settings)) as TitlePageSettingsWithTemplate;
  delete next.templateId;
  next.border = { ...next.border, enabled: true, styleId: 'double', thicknessPt: 1, insetMm: 12 };
  return next;
}

// ── Metadata layout (preview overlay only) ───────────────────────────────

/**
 * One metadata row for the preview overlay. `yBaselinePt` is the first
 * line's baseline, in points from the top of the page. Zones are placed
 * against the shared standard-field rows so the standard stack never
 * moves (preview/PDF parity for the standard fields).
 */
export interface TitlePageMetadataRow {
  key: TitlePageMetadataKey;
  text: string;
  yBaselinePt: number;
  fontSizePt: number;
  isBold: boolean;
  italic: boolean;
  uppercase: boolean;
  smallCaps: boolean;
  alignment: 'center' | 'right' | 'left';
  colorHex: string;
  fontFamily: string;
  lineHeight: number;
  letterSpacingPt?: number;
  ruleBelow: boolean;
}

const DEFAULT_METADATA_STYLE: TitlePageTemplateMetadataStyle = {
  fontSizePt: 12,
  lineHeight: 1.3,
  alignment: 'center',
  colorHex: '#6B5E4C',
};

export function layoutTemplateMetadataRows(
  settings: TitlePageSettings,
  template: TitlePageTemplate,
  standardRows: Array<{
    fieldId: string;
    yBaselinePt: number;
    fontSizePt: number;
    lineHeight: number;
  }>,
  pageHeightPt: number
): TitlePageMetadataRow[] {
  const { metadata } = readTitlePageTemplateState(settings);
  const titleRow = standardRows.find(r => r.fieldId === 'title');
  const upperRows = standardRows.filter(r => r.fieldId !== 'publisher');
  const lastUpper = upperRows[upperRows.length - 1];
  const rows: TitlePageMetadataRow[] = [];
  // Zone anchors (baselines), in points from the top of the page.
  let topY = pageHeightPt * 0.1;
  let underTitleY = titleRow
    ? titleRow.yBaselinePt + titleRow.fontSizePt * titleRow.lineHeight + 12
    : pageHeightPt * 0.42;
  let midLowerY = lastUpper
    ? lastUpper.yBaselinePt + lastUpper.fontSizePt * lastUpper.lineHeight + 26
    : pageHeightPt * 0.62;
  let footY = pageHeightPt * 0.9;
  const push = (slot: TitlePageTemplateMetadataSlot, text: string) => {
    const style: TitlePageTemplateMetadataStyle = {
      ...DEFAULT_METADATA_STYLE,
      ...(template.metadataStyles[slot.key] ?? {}),
    };
    const fontSizePt = style.fontSizePt;
    const lineHeight = style.lineHeight ?? 1.3;
    let y: number;
    if (slot.zone === 'top') {
      y = topY + fontSizePt;
      topY = y + fontSizePt * lineHeight * 0.4 + 6;
    } else if (slot.zone === 'underTitle') {
      y = underTitleY + fontSizePt;
      underTitleY = y + fontSizePt * lineHeight * 0.4 + 6;
    } else if (slot.zone === 'midLower') {
      y = midLowerY + fontSizePt;
      midLowerY = y + fontSizePt * lineHeight * 0.4 + 6;
    } else {
      y = footY + fontSizePt;
      footY = y + fontSizePt * lineHeight * 0.4 + 4;
    }
    rows.push({
      key: slot.key,
      text,
      yBaselinePt: y,
      fontSizePt,
      isBold: slot.key === 'titleEn',
      italic: style.italic ?? false,
      uppercase: style.uppercase ?? false,
      smallCaps: style.smallCaps ?? false,
      alignment: style.alignment ?? 'center',
      colorHex: style.colorHex ?? '#6B5E4C',
      fontFamily: '',
      lineHeight,
      ruleBelow: slot.ruleBelow ?? false,
    });
  };
  for (const slot of template.metadataOrder) {
    const value = (metadata[slot.key] as string | undefined) ?? '';
    if (!value.trim()) continue;
    push(slot, value.trim());
  }
  return rows;
}
