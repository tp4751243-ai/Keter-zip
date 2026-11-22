/**
 * Keter Typesetter — Table of Contents & Cover Page Engine (v0.3.0, module B)
 *
 * Original offline code. Builds a table of contents from the book's existing
 * semantic content units (chapter / siman / heading / subheading roles),
 * converts TOC entries back into content units the existing pagination engine
 * can render, and builds cover-page units.
 *
 * No new dependencies, no network. Page numbers are filled from an optional
 * page-index map (unitId -> printed page number) or from the typeset pages.
 */

import {
  BookTypesetDocument,
  ContentRole,
  ContentUnit,
  DynamicKneeContour,
  PageGeometry,
  PageTypesetResult,
} from '../types/typesetter';
import type {
  TitlePageBorderStyleId,
  TitlePageFieldStyle,
  TitlePageSettings,
} from '../types/design-settings';
import { layoutTitlePageFields } from './title-page-borders';
import {
  effectiveTitlePageBackground,
  effectiveTitlePageBorderStyleId,
  layoutTemplateMetadataRows,
  readTitlePageTemplateState,
  resolveTemplateOrnaments,
  resolveTitlePageTemplate,
  resolveTitlePageTemplateId,
  type TitlePageBackgroundKind,
  type TitlePageMetadataRow,
  type TitlePageTemplateId,
  type TitlePageTemplateMetadata,
  type TitlePageTemplateOrnament,
} from './title-page-templates';

/** One row of the table of contents. */
export interface TocEntry {
  id: string;
  title: string;
  level: number; // 1 = chapter / main_title, 2 = siman / heading, 3+ = subheading / seif
  pageNumber?: number;
  /** Formatted folio string (e.g. 'ב.', 'ב:', 'ב ע״א', or '12') */
  folioLabel?: string;
  /** 1-based physical print/PDF page number including front matter */
  physicalPageNumber?: number;
  unitId?: string;
}

/**
 * Data for the book's cover (title) page.
 *
 * v0.5.0 (Title Page / Shaar Blat builder): extended with the full
 * title-page fields (translator, publisher, volume, year, extra lines)
 * and the border choice. The project stores the richer
 * `TitlePageSettings` (design-settings.ts); `titlePageSettingsToCoverData`
 * converts it to this shape for the exporters. The title page is still
 * ONE cover system — this interface is its export form, not a second one.
 */
export interface CoverPageData {
  title: string;
  subtitle?: string;
  author?: string;
  ornament?: string; // ornament asset id, or a short decorative string (e.g. '❦')
  translator?: string;
  publisher?: string;
  volume?: string;
  year?: string;
  extraLines?: string[];
  /** Stock border style (ignored when `customBorderImageDataUrl` is set). */
  borderStyleId?: TitlePageBorderStyleId;
  borderThicknessPt?: number;
  borderInsetMm?: number;
  borderEnabled?: boolean;
  /** User-imported border image (data URL), replacing the stock border. */
  customBorderImageDataUrl?: string;
  customBorderImageName?: string;
  /**
   * v0.6.0 Part C (§8): full per-field styles (font/size/alignment/
   * spacing/line-height/drag offsets) so the native PDF renders exactly
   * what the preview shows. Absent = the v0.5.0 defaults (title 30pt,
   * subtitle 15pt, … centred). Keys are the field ids; 'extra' holds
   * the extra-line styles in order.
   */
  fieldStyles?: Partial<Record<'title' | 'subtitle' | 'author' | 'translator' | 'publisher' | 'volume' | 'year', TitlePageFieldStyle>>;
  extraLineStyles?: TitlePageFieldStyle[];
  /** v0.6.0 Part C (§8): border fit — scale / padding / position. */
  borderScalePct?: number;
  borderPaddingMm?: number;
  borderOffsetXMm?: number;
  borderOffsetYMm?: number;
  /** Interior title page vs wraparound back+spine+front cover */
  coverMode?: TitlePageSettings['coverMode'];
  wraparoundCover?: TitlePageSettings['wraparoundCover'];
  // v0.9.9 — title-page template carry-through (Part B §9): the chosen
  // preset, its metadata, ornaments, background and laid-out metadata
  // rows, so the PDF renders the template the preview shows instead of
  // the PDF-fallback frame. All absent = legacy/classic default.
  templateId?: TitlePageTemplateId;
  templateMetadata?: TitlePageTemplateMetadata;
  ornaments?: TitlePageTemplateOrnament[];
  background?: TitlePageBackgroundKind;
  metadataRows?: TitlePageMetadataRow[];
}

/**
 * Convert the project's title-page settings into export-form cover data.
 * The title falls back to the book title when its own text is empty.
 */
export function titlePageSettingsToCoverData(
  settings: TitlePageSettings,
  bookTitle: string,
  // v0.9.9 — page height the metadata rows are laid out against
  // (layoutTemplateMetadataRows anchors zones to it). Callers that do
  // not pass it get no metadata rows — the standard fields + frame
  // still render exactly as before.
  pageHeightPt = 792
): CoverPageData {
  const trim = (s: string | undefined) => (s ?? '').trim() || undefined;
  const field = (f: TitlePageFieldStyle): TitlePageFieldStyle => ({ ...f });
  // v0.9.9 — template carry-through: the REAL frame (the template's own
  // border id, not the stored PDF-fallback), the template's ornaments /
  // background, and its metadata rows laid out against the standard
  // field rows. No template = exactly the old values.
  const template = resolveTitlePageTemplate(settings);
  const standardRows = layoutTitlePageFields(settings, settings.title.text.trim() || bookTitle, pageHeightPt);
  const { metadata } = readTitlePageTemplateState(settings);
  return {
    templateId: resolveTitlePageTemplateId(settings) ?? undefined,
    templateMetadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    ornaments: template ? resolveTemplateOrnaments(settings, template) : undefined,
    background: effectiveTitlePageBackground(settings),
    metadataRows: template
      ? layoutTemplateMetadataRows(
          settings,
          template,
          standardRows.map(r => ({
            fieldId: r.fieldId,
            yBaselinePt: r.yBaselinePt,
            fontSizePt: r.fontSizePt,
            lineHeight: r.lineHeight,
          })),
          pageHeightPt
        )
      : undefined,
    title: settings.title.text.trim() || bookTitle || 'ספר קודש',
    subtitle: trim(settings.subtitle.text),
    author: trim(settings.author.text),
    translator: trim(settings.translator.text),
    publisher: trim(settings.publisher.text),
    volume: trim(settings.volume.text),
    year: trim(settings.year.text),
    extraLines: (settings.extraLines ?? [])
      .map(l => (l.text ?? '').trim())
      .filter(Boolean),
    borderStyleId: effectiveTitlePageBorderStyleId(settings),
    borderThicknessPt: settings.border.thicknessPt,
    borderInsetMm: settings.border.insetMm,
    borderEnabled: settings.border.enabled,
    customBorderImageDataUrl: settings.customBorderImage?.dataUrl,
    customBorderImageName: settings.customBorderImage?.fileName,
    // v0.6.0 Part C (§8): the native PDF now renders the project's real
    // per-field styles (v0.5.0 rebuilt them from hardcoded defaults).
    fieldStyles: {
      title: field(settings.title),
      subtitle: field(settings.subtitle),
      author: field(settings.author),
      translator: field(settings.translator),
      publisher: field(settings.publisher),
      volume: field(settings.volume),
      year: field(settings.year),
    },
    extraLineStyles: (settings.extraLines ?? []).map(l => field(l)),
    borderScalePct: settings.border.scalePct,
    borderPaddingMm: settings.border.paddingMm,
    borderOffsetXMm: settings.border.offsetXMm,
    borderOffsetYMm: settings.border.offsetYMm,
    coverMode: settings.coverMode ?? 'interior_title_page',
    wraparoundCover: settings.wraparoundCover ? { ...settings.wraparoundCover } : undefined,
  };
}

/**
 * Build the synthetic first page that IS the title page. It carries no
 * typeset lines: the preview, PDF and IDML renderers draw it from
 * `designSettings.titlePage` (see `layoutTitlePageFields`). Running
 * headers and folios are suppressed on it, and the body pages that follow
 * are numbered from 2 (see App's bookDoc memo).
 */
export function buildTitlePageResult(
  geometry: PageGeometry,
  layoutType: PageTypesetResult['layoutType'],
  designSettings: unknown,
  bookTitle: string
): PageTypesetResult {
  const contentW = geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
  const contentH = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;
  const knee: DynamicKneeContour = {
    pageContentWidth: contentW,
    pageContentHeight: contentH,
    topY: 0,
    kneeJunctionY: contentH,
    bottomY: contentH,
    upperSourceWidth: contentW,
    lowerSourceWidth: contentW,
    innerXOffset: 0,
    // A title page has no knee: no commentary flanks, no steps.
    isLeftStepped: false,
    rightCommentaryWidth: 0,
    leftCommentaryWidth: 0,
    gutterWidth: 0,
  };
  return {
    pageIndex: 0,
    pageNumber: 1,
    pageNumberHebrew: 'א׳',
    headerTitle: bookTitle,
    layoutType,
    geometry,
    sourceLines: [],
    rashiLines: [],
    tosafotLines: [],
    footnoteLines: [],
    knee,
    designSettings,
    isTitlePage: true,
  };
}

/**
 * Roles that start a TOC entry, in outline order. `main_title` is the book
 * title itself and is normally excluded (it is the cover); it is included
 * only when `includeBookTitle` is set.
 */
const TOC_ROLES: Partial<Record<ContentRole, number>> = {
  chapter: 1,
  siman: 2,
  heading: 2,
  subheading: 3,
  seif: 3,
  main_title: 1,
};

export interface BuildTocOptions {
  /** Map of content-unit id -> printed page number. Fills `pageNumber`. */
  pageMap?: Map<string, number> | Record<string, number>;
  /** Map of content-unit id -> formatted folio label (e.g. 'ב.', 'ב:'). */
  folioMap?: Map<string, string> | Record<string, string>;
  /** Include `main_title` units as level-1 entries (default false). */
  includeBookTitle?: boolean;
  /** Maximum heading level to include (default 3). */
  maxLevel?: number;
}

function lookupPage(
  pageMap: Map<string, number> | Record<string, number> | undefined,
  unitId: string
): number | undefined {
  if (!pageMap) return undefined;
  if (pageMap instanceof Map) return pageMap.get(unitId);
  const n = pageMap[unitId];
  return typeof n === 'number' ? n : undefined;
}

function lookupFolio(
  folioMap: Map<string, string> | Record<string, string> | undefined,
  unitId: string
): string | undefined {
  if (!folioMap) return undefined;
  if (folioMap instanceof Map) return folioMap.get(unitId);
  const s = folioMap[unitId];
  return typeof s === 'string' && s.trim().length > 0 ? s : undefined;
}

function unitTitle(unit: ContentUnit): string {
  const text = (unit.rawText || '').trim();
  if (text) return text;
  if (unit.chapterTitle) return unit.chapterTitle;
  if (unit.simanNumber) return `סימן ${unit.simanNumber}`;
  if (unit.seifLetter) return `סעיף ${unit.seifLetter}`;
  return unit.id;
}

/**
 * Build TOC entries from content units, in document order. Heading level
 * comes from the semantic role, refined by `hierarchyLevel` when present:
 * a deeper hierarchyLevel pushes the entry one level deeper (capped at 4).
 */
export function buildToc(units: ContentUnit[], options: BuildTocOptions = {}): TocEntry[] {
  const maxLevel = options.maxLevel ?? 3;
  const entries: TocEntry[] = [];
  const sorted = [...units].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const unit of sorted) {
    const baseLevel = TOC_ROLES[unit.role];
    if (baseLevel === undefined) continue;
    if (unit.role === 'main_title' && !options.includeBookTitle) continue;

    let level = baseLevel;
    if (typeof unit.hierarchyLevel === 'number' && unit.hierarchyLevel > 0) {
      // hierarchyLevel 0 = top level; deeper nesting adds a level.
      level = Math.min(4, Math.max(1, baseLevel + unit.hierarchyLevel));
    }
    if (level > maxLevel) continue;

    const title = unitTitle(unit);
    if (!title) continue;

    entries.push({
      id: `toc-${unit.id}`,
      title,
      level,
      pageNumber: lookupPage(options.pageMap, unit.id),
      folioLabel: lookupFolio(options.folioMap, unit.id),
      unitId: unit.id,
    });
  }
  return entries;
}

/**
 * Build TOC entries directly from already-typeset pages: the first page on
 * which a heading unit's line appears is that heading's page. Useful when
 * only a `BookTypesetDocument` (no raw units) is at hand, e.g. in the PDF
 * exporter. `frontMatterOffset` shifts physical page numbers when TOC pages
 * are inserted before body pages, while Talmud/body folio labels remain
 * anchored when `excludeFrontMatter` is enabled.
 */
export function buildTocFromBook(
  bookDoc: BookTypesetDocument,
  pages: PageTypesetResult[] = bookDoc.pages,
  frontMatterOffset = 0
): TocEntry[] {
  const seen = new Set<string>();
  const entries: TocEntry[] = [];
  const excludeFrontMatter =
    bookDoc.designSettings?.pageElements?.folioNumbering?.excludeFrontMatter !== false;

  for (const page of pages) {
    if (page.isTitlePage) continue;
    const lines = [
      ...(page.sourceLines ?? []),
      ...(page.column2Lines ?? []),
      ...(page.rashiLines ?? []),
      ...(page.tosafotLines ?? []),
    ];
    const physicalPageNumber = (page.physicalPageNumber ?? page.pageNumber) + frontMatterOffset;
    const shiftedPageNumber = excludeFrontMatter ? page.pageNumber : page.pageNumber + frontMatterOffset;
    const folioLabel = excludeFrontMatter
      ? (page.folioDisplay || page.pageNumberHebrew || String(page.pageNumber))
      : frontMatterOffset === 0
        ? (page.folioDisplay || page.pageNumberHebrew || String(shiftedPageNumber))
        : String(shiftedPageNumber);
    for (const line of lines) {
      const role = line.role;
      const level = role ? TOC_ROLES[role] : undefined;
      if (level === undefined || role === 'main_title') continue;
      const unitId = line.unitId ?? '';
      if (!unitId || seen.has(unitId)) continue;
      seen.add(unitId);
      const words = (line.words ?? [])
        .filter(w => !w.isSpace && w.text.trim().length > 0)
        .map(w => w.text);
      const title = words.join(' ').trim();
      if (!title) continue;
      entries.push({
        id: `toc-${unitId}`,
        title,
        level,
        pageNumber: shiftedPageNumber,
        folioLabel,
        physicalPageNumber,
        unitId,
      });
    }
  }
  return entries;
}

/**
 * Build a unitId -> pageNumber map from typeset pages (first page on which
 * each unit's line appears). Feed it to `buildToc` / `updateTocPageNumbers`.
 */
export function buildPageMapFromBook(
  bookDoc: BookTypesetDocument,
  pages: PageTypesetResult[] = bookDoc.pages,
  frontMatterOffset = 0
): Map<string, number> {
  const map = new Map<string, number>();
  const excludeFrontMatter =
    bookDoc.designSettings?.pageElements?.folioNumbering?.excludeFrontMatter !== false;
  for (const page of pages) {
    if (page.isTitlePage) continue;
    const targetPageNum = excludeFrontMatter ? page.pageNumber : page.pageNumber + frontMatterOffset;
    const lines = [
      ...(page.sourceLines ?? []),
      ...(page.column2Lines ?? []),
      ...(page.rashiLines ?? []),
      ...(page.tosafotLines ?? []),
      ...(page.footnoteLines ?? []),
    ];
    for (const line of lines) {
      const unitId = line.unitId;
      if (unitId && !map.has(unitId)) {
        map.set(unitId, targetPageNum);
      }
    }
  }
  return map;
}

export function buildFolioMapFromBook(
  bookDoc: BookTypesetDocument,
  pages: PageTypesetResult[] = bookDoc.pages,
  frontMatterOffset = 0
): Map<string, string> {
  const map = new Map<string, string>();
  const excludeFrontMatter =
    bookDoc.designSettings?.pageElements?.folioNumbering?.excludeFrontMatter !== false;
  for (const page of pages) {
    if (page.isTitlePage) continue;
    const folio = excludeFrontMatter
      ? (page.folioDisplay || page.pageNumberHebrew || String(page.pageNumber))
      : frontMatterOffset === 0
        ? (page.folioDisplay || page.pageNumberHebrew || String(page.pageNumber))
        : String(page.pageNumber + frontMatterOffset);
    const lines = [
      ...(page.sourceLines ?? []),
      ...(page.column2Lines ?? []),
      ...(page.rashiLines ?? []),
      ...(page.tosafotLines ?? []),
      ...(page.footnoteLines ?? []),
    ];
    for (const line of lines) {
      const unitId = line.unitId;
      if (unitId && !map.has(unitId)) {
        map.set(unitId, folio);
      }
    }
  }
  return map;
}

/** One-line rendering of a TOC entry, e.g. `פרק א׳ .... ב.` */
export function formatTocEntry(entry: TocEntry, opts: { dotLeader?: boolean } = {}): string {
  const indent = '  '.repeat(Math.max(0, entry.level - 1));
  const page = entry.folioLabel || (entry.pageNumber !== undefined ? String(entry.pageNumber) : '');
  const leader = opts.dotLeader && page ? ' .... ' : page ? ' — ' : '';
  return `${indent}${entry.title}${leader}${page}`.trimEnd();
}

/** Fill / refresh page numbers on existing entries from a page map. Returns new entries. */
export function updateTocPageNumbers(
  entries: TocEntry[],
  pageMap: Map<string, number> | Record<string, number>,
  folioMap?: Map<string, string> | Record<string, string>
): TocEntry[] {
  return entries.map(entry => {
    if (!entry.unitId) return entry;
    const pageNumber = lookupPage(pageMap, entry.unitId);
    const folioLabel = lookupFolio(folioMap, entry.unitId) ?? entry.folioLabel;
    return pageNumber === undefined && folioLabel === entry.folioLabel
      ? entry
      : { ...entry, pageNumber: pageNumber ?? entry.pageNumber, folioLabel };
  });
}

const TOC_STYLE_NAMES: Record<number, string> = {
  1: 'keter-toc-level-1',
  2: 'keter-toc-level-2',
  3: 'keter-toc-level-3',
  4: 'keter-toc-level-4',
};

/**
 * Convert TOC entries back into content units the existing pagination engine
 * can render as an ordinary TOC page. Level 1 -> `chapter` role, level 2 ->
 * `heading`, level 3+ -> `subheading`. The page number is appended to the
 * text (`Title · 12`) so it survives pagination as plain text.
 *
 * Units are marked with `styleName: 'keter-toc'` so PageCanvas / CSS can
 * style TOC lines (dot leaders, indentation) without a new ContentRole.
 * If a `cover`/`toc` unit role is ever added to `ContentRole` in
 * typesetter.ts, switch the marker to that role instead.
 */
export function tocToUnits(entries: TocEntry[], startOrder = 0): ContentUnit[] {
  const units: ContentUnit[] = [];
  units.push({
    id: 'toc-heading',
    role: 'heading',
    rawText: 'תוכן העניינים',
    styleName: 'keter-toc-title',
    order: startOrder,
    hierarchyLevel: 0,
  });
  entries.forEach((entry, i) => {
    const role: ContentRole = entry.level <= 1 ? 'chapter' : entry.level === 2 ? 'heading' : 'subheading';
    const refLabel = entry.folioLabel || (entry.pageNumber !== undefined ? String(entry.pageNumber) : '');
    const pageSuffix = refLabel ? ` · ${refLabel}` : '';
    units.push({
      id: entry.id,
      role,
      rawText: `${entry.title}${pageSuffix}`,
      styleName: TOC_STYLE_NAMES[entry.level] ?? 'keter-toc-level-2',
      order: startOrder + i + 1,
      hierarchyLevel: Math.max(0, entry.level - 1),
      parentId: 'toc-heading',
    });
  });
  return units;
}

/**
 * Convert cover data into content units renderable by the existing
 * pagination engine as a first page. Units are marked with
 * `styleName: 'keter-cover'` so PageCanvas can render them as a cover
 * (large centred title, ornament rule) without a new ContentRole.
 */
export function coverToUnits(data: CoverPageData, startOrder = 0): ContentUnit[] {
  const units: ContentUnit[] = [];
  let order = startOrder;

  if (data.ornament) {
    units.push({
      id: 'cover-ornament-top',
      role: 'ornament',
      rawText: data.ornament,
      styleName: 'keter-cover',
      order: order++,
      hierarchyLevel: 0,
      ornamentId: data.ornament,
    });
  }
  units.push({
    id: 'cover-title',
    role: 'main_title',
    rawText: data.title,
    styleName: 'keter-cover',
    order: order++,
    hierarchyLevel: 0,
    chapterTitle: data.title,
  });
  if (data.subtitle) {
    units.push({
      id: 'cover-subtitle',
      role: 'subtitle',
      rawText: data.subtitle,
      styleName: 'keter-cover',
      order: order++,
      hierarchyLevel: 0,
    });
  }
  if (data.author) {
    units.push({
      id: 'cover-author',
      role: 'regular_paragraph',
      rawText: data.author,
      styleName: 'keter-cover',
      order: order++,
      hierarchyLevel: 0,
    });
  }
  // v0.5.0 — the full title-page fields, in display order.
  if (data.translator) {
    units.push({
      id: 'cover-translator',
      role: 'regular_paragraph',
      rawText: data.translator,
      styleName: 'keter-cover',
      order: order++,
      hierarchyLevel: 0,
    });
  }
  if (data.volume) {
    units.push({
      id: 'cover-volume',
      role: 'regular_paragraph',
      rawText: data.volume,
      styleName: 'keter-cover',
      order: order++,
      hierarchyLevel: 0,
    });
  }
  if (data.year) {
    units.push({
      id: 'cover-year',
      role: 'regular_paragraph',
      rawText: data.year,
      styleName: 'keter-cover',
      order: order++,
      hierarchyLevel: 0,
    });
  }
  (data.extraLines ?? []).forEach((line, i) => {
    if (!line.trim()) return;
    units.push({
      id: `cover-extra-${i}`,
      role: 'regular_paragraph',
      rawText: line,
      styleName: 'keter-cover',
      order: order++,
      hierarchyLevel: 0,
    });
  });
  if (data.publisher) {
    units.push({
      id: 'cover-publisher',
      role: 'regular_paragraph',
      rawText: data.publisher,
      styleName: 'keter-cover',
      order: order++,
      hierarchyLevel: 0,
    });
  }
  return units;
}
