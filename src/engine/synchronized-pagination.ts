/**
 * v0.9.8 Phase 4 — Synchronized pagination & Tzuras HaDaf solver.
 *
 * VERIFY-FIRST record — what already existed (built on, not replaced):
 * - `PaginationEngine.paginateDocument` (pagination-engine.ts): fully
 *   synchronous, no progress callback, no async entry point. Its
 *   rav-text path already groups linked commentaries with their source
 *   (LinkedRavGroup, `buildLinkedRavGroups`), already enforces
 *   keep-together Priority 90 (dibbur + commentary body) and Priority
 *   80 (heading + opening paragraph), and already moves a 1–2 line
 *   commentary widow tail to the next page (paginateRavText Stage 4).
 * - `DynamicKneeEngine` (dynamic-knee.ts): already queries
 *   `SpatialExclusionEngine.queryAvailableIntervals` PER LINE BAND
 *   (Phases 2–3), already wraps excess commentary below the source in
 *   a 50/50 lower split or a full-width span, and already raises the
 *   knee (`maxSourceEndY`) from measured excess commentary lines.
 *   Phase 4's genuine knee fix is the clearance CAP in dynamic-knee.ts
 *   (the uncapped check starved the source entirely — measured: 0
 *   source lines with commentary ~3.5× source).
 * - `EngineHardRulesEngine` (engine-hard-rules.ts): LEVEL-0 rav-text
 *   link survival is already checked there (a commentary fully cut
 *   from its source is a violation); there is no separate
 *   widow/orphan rule id — the paginator enforces it inline.
 * - `HarfBuzzShaperEngine.metricCache`: glyph-advance measurement was
 *   already memoized. Line-breaking trial counts were NOT — the memo
 *   is in dynamic-knee.ts (`trialLineCacheStats`).
 *
 * What this module ADDS (genuine gaps):
 * 1. `attachAnchoredCommentaries` — main-text blocks carry their
 *    `anchoredCommentaryIds` list (Rule 1's data foundation).
 * 2. `planSamePageGroups` — a pure same-page-gravity planner: it
 *    partitions source units into page-sized groups whose anchored
 *    commentaries fit the flank + lower-wrap area, and flags the
 *    overflow when one sugya's commentary alone exceeds a page.
 * 3. `checkBottomFlush` (Rule 3) and `checkStrandedDibburHeaders`
 *    (Rule 4) — audits over real PageTypesetResult pages.
 * 4. `measureWraparoundGaps` — blank-band audit over a page's
 *    occupied regions (Rule 2's verification side).
 * 5. `paginateDocumentAsync` — the async entry point: the book is
 *    split into chunks at anchor-safe boundaries (a commentary always
 *    travels with its anchor source), each chunk paginates through the
 *    REAL PaginationEngine, the event loop is yielded between chunks,
 *    and `onProgress` fires with real page counts. Honest limit: chunk
 *    boundaries limit the paginator's cross-page look-ahead to within
 *    a chunk (recorded in the Phase 3–4 record); progress percent is
 *    pages-done vs the planner's estimated total, and is 100 only when
 *    the last chunk lands.
 */

import type {
  AnchorLink,
  BookTypesetDocument,
  ContentUnit,
  OccupiedRegion,
  PageGeometry,
  PageTypesetResult,
  RavTextLink,
  TypesetLine,
} from '../types/typesetter';
import { PaginationEngine, type PaginationInput } from './pagination-engine';
import { SpatialExclusionEngine } from './spatial-exclusion';
import { toHebrewGematria } from './break-instructions';

/* ── Rule 1 — anchored commentaries on the source block ───────────── */

/**
 * Stamp every source unit with the ids of the commentary units
 * anchored to it, and every commentary unit with its AnchorLink.
 * Returns NEW unit objects (the input array is not mutated) plus the
 * source → commentary map. Units with no anchor are returned
 * unchanged apart from the (absent) stamp.
 */
export function attachAnchoredCommentaries(
  units: ContentUnit[],
  anchorLinks: AnchorLink[]
): { units: ContentUnit[]; bySource: Map<string, string[]> } {
  const bySource = new Map<string, string[]>();
  const linkByCommentary = new Map<string, AnchorLink>();
  for (const a of anchorLinks) {
    if (!a.targetMainNodeId) continue;
    const list = bySource.get(a.targetMainNodeId) ?? [];
    list.push(a.commentaryUnitId);
    bySource.set(a.targetMainNodeId, list);
    linkByCommentary.set(a.commentaryUnitId, a);
  }
  const next = units.map(u => {
    const anchored = bySource.get(u.id);
    const link = linkByCommentary.get(u.id);
    if (!anchored && !link) return u;
    return {
      ...u,
      ...(anchored ? { anchoredCommentaryIds: anchored } : {}),
      ...(link ? { anchorLink: link } : {}),
    };
  });
  return { units: next, bySource };
}

/* ── Same-page gravity planner ────────────────────────────────────── */

/** Rough line estimate for one unit at a target width (planning only). */
export function estimateUnitLines(
  unit: ContentUnit,
  targetWidthPt: number,
  fontSizePt: number
): number {
  const chars = (unit.rawText ?? '').replace(/\s+/g, ' ').trim().length;
  if (chars === 0) return 0;
  // Mean Hebrew glyph advance ≈ 0.52 × font size (same factor the
  // harfbuzz emulator uses for unmeasured text).
  const charsPerLine = Math.max(4, Math.floor(targetWidthPt / (fontSizePt * 0.52)));
  return Math.max(1, Math.ceil(chars / charsPerLine));
}

export interface SamePageGroup {
  sourceUnitIds: string[];
  commentaryUnitIds: string[];
  estimatedSourceLines: number;
  estimatedCommentaryLines: number;
  /** False when this sugya's anchored commentary alone exceeds one page. */
  fitsOnOnePage: boolean;
  /** Commentary lines that do not fit even on a page of their own. */
  overflowCommentaryLines: number;
}

export interface SamePagePlanOptions {
  contentHeightPt: number;
  sourceLineHeightPt: number;
  commentLineHeightPt: number;
  /** Width of one commentary flank (Rashi or Tosafot column). */
  flankWidthPt: number;
  /** Commentary font size (for the line estimate). */
  commentFontSizePt?: number;
  /** Source font size (for the line estimate). */
  sourceFontSizePt?: number;
}

/**
 * Partition the source stream into page-sized groups under same-page
 * gravity (Rule 1): a group closes before adding a source unit whose
 * anchored commentaries would no longer fit in the flank height
 * alongside the group's source lines plus the lower wraparound area
 * below them. A single source unit whose commentary alone overflows
 * is emitted as its own group with `fitsOnOnePage: false` — the
 * paginator then splits that commentary across pages (it cannot be
 * kept whole), and the overflow count says by how much.
 */
export function planSamePageGroups(
  sourceUnits: ContentUnit[],
  commentaryUnits: ContentUnit[],
  anchorLinks: AnchorLink[],
  opts: SamePagePlanOptions
): SamePageGroup[] {
  const { bySource } = attachAnchoredCommentaries(
    [...sourceUnits, ...commentaryUnits],
    anchorLinks
  );
  const commentaryById = new Map(commentaryUnits.map(u => [u.id, u]));
  const commentFontSize = opts.commentFontSizePt ?? 10.5;
  const sourceFontSize = opts.sourceFontSizePt ?? 14.5;
  const flankLinesPerPage = Math.max(1, Math.floor(opts.contentHeightPt / opts.commentLineHeightPt));
  // Lower wraparound: below the source the commentaries share the full
  // width, roughly doubling their line capacity per vertical pt.
  const groups: SamePageGroup[] = [];
  let cur: SamePageGroup = {
    sourceUnitIds: [],
    commentaryUnitIds: [],
    estimatedSourceLines: 0,
    estimatedCommentaryLines: 0,
    fitsOnOnePage: true,
    overflowCommentaryLines: 0,
  };
  const capacityFor = (sourceLines: number, commentLines: number): boolean => {
    // Flank capacity while the source runs + lower-wrap capacity below it.
    const sourceHeight = sourceLines * opts.sourceLineHeightPt;
    const flankCapacity = Math.max(0, Math.floor(sourceHeight / opts.commentLineHeightPt));
    const lowerHeight = Math.max(0, opts.contentHeightPt - sourceHeight);
    const lowerCapacity = Math.floor(lowerHeight / opts.commentLineHeightPt) * 2;
    return commentLines <= flankCapacity + lowerCapacity;
  };
  const closeGroup = () => {
    if (cur.sourceUnitIds.length === 0) return;
    const totalCommentLines = cur.estimatedCommentaryLines;
    const fits = capacityFor(cur.estimatedSourceLines, totalCommentLines);
    cur.fitsOnOnePage = fits;
    cur.overflowCommentaryLines = fits
      ? 0
      : Math.max(0, totalCommentLines - flankLinesPerPage * 2);
    groups.push(cur);
    cur = {
      sourceUnitIds: [],
      commentaryUnitIds: [],
      estimatedSourceLines: 0,
      estimatedCommentaryLines: 0,
      fitsOnOnePage: true,
      overflowCommentaryLines: 0,
    };
  };

  for (const src of sourceUnits) {
    const anchoredIds = bySource.get(src.id) ?? [];
    const srcLines = estimateUnitLines(src, 170, sourceFontSize);
    const comLines = anchoredIds.reduce((sum, id) => {
      const cu = commentaryById.get(id);
      return sum + (cu ? estimateUnitLines(cu, opts.flankWidthPt, commentFontSize) : 0);
    }, 0);
    const nextSourceLines = cur.estimatedSourceLines + srcLines;
    const nextCommentLines = cur.estimatedCommentaryLines + comLines;
    if (
      cur.sourceUnitIds.length > 0 &&
      !capacityFor(nextSourceLines, nextCommentLines)
    ) {
      closeGroup();
    }
    cur.sourceUnitIds.push(src.id);
    cur.commentaryUnitIds.push(...anchoredIds);
    cur.estimatedSourceLines += srcLines;
    cur.estimatedCommentaryLines += comLines;
  }
  closeGroup();
  return groups;
}

/* ── Rule 3 — bottom-line flush ───────────────────────────────────── */

export interface BottomFlushReport {
  /** Deepest line bottom on the page (pt, content-relative). */
  deepestBottomPt: number;
  /** Content-box bottom (pageHeight − marginBottom). */
  contentBottomPt: number;
  /** Deepest bottom per stream. */
  perStream: { source: number; rashi: number; tosafot: number; tertiary: number };
  /** Gap between the deepest stream and the margin box. */
  maxDeviationPt: number;
  /** True when the deepest stream ends within one line-height of the box. */
  withinTolerance: boolean;
  /** Line height the tolerance was measured against. */
  tolerancePt: number;
}

function streamBottom(lines: TypesetLine[] | undefined): number {
  if (!lines || lines.length === 0) return -1;
  return Math.max(...lines.map(l => l.yBottom ?? l.yBaseline + l.descent));
}

/**
 * Bottom baselines of the page's streams vs the page margin box
 * (Rule 3). Interpretation, stated honestly: a stream that has
 * exhausted its text ends early — that is white space, not a flush
 * failure. The check is therefore on the DEEPEST stream: when the
 * page still has content to place, the deepest stream must end within
 * ±1 line-height of the margin box. `withinTolerance` is that test;
 * `perStream` reports every stream so a caller can see which one
 * ended early and why.
 */
export function checkBottomFlush(
  page: PageTypesetResult,
  geometry: PageGeometry,
  lineHeightPt?: number
): BottomFlushReport {
  // v0.9.8 Phase 4 — FIX: lines are placed in CONTENT-relative
  // coordinates (0 = top margin), so the bottom of the content box is
  // pageHeight − marginTop − marginBottom, NOT pageHeight − marginBottom.
  // The old value (632pt here) overstated every deviation by exactly
  // marginTop (48pt) and made even full pages look 48pt short.
  const contentBottom = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;
  const perStream = {
    source: streamBottom(page.sourceLines),
    rashi: streamBottom(page.rashiLines),
    tosafot: streamBottom(page.tosafotLines),
    tertiary: streamBottom(page.tertiaryLines),
  };
  const deepest = Math.max(perStream.source, perStream.rashi, perStream.tosafot, perStream.tertiary);
  const tolerance =
    lineHeightPt ??
    Math.max(
      ...[page.sourceLines, page.rashiLines, page.tosafotLines]
        .flat()
        .map(l => l.height)
        .filter(h => Number.isFinite(h) && h > 0),
      14.5
    );
  const deviation = deepest < 0 ? contentBottom : contentBottom - deepest;
  return {
    deepestBottomPt: deepest,
    contentBottomPt: contentBottom,
    perStream,
    maxDeviationPt: deviation,
    withinTolerance: deepest >= 0 && deviation <= tolerance,
    tolerancePt: tolerance,
  };
}

/* ── Rule 4 — widow / orphan / heading protection ─────────────────── */

export interface StrandedDibburViolation {
  pageNumber: number;
  unitId: string;
  kind: 'dibbur-header' | 'heading';
  lineIndex: number;
  detail: string;
}

function isDibburOpeningLine(line: TypesetLine): boolean {
  const real = line.words.filter(w => !w.isSpace && w.text.trim().length > 0);
  if (real.length === 0) return false;
  return real.every(w => w.isDibbur);
}

const HEADING_ROLES = new Set(['chapter', 'heading', 'main_title', 'siman']);

/**
 * Scan typeset pages for a section header or a dibbur opening line
 * stranded alone at a column bottom (Rule 4): the last line of a
 * stream on a page that is (a) a heading-role line with no body line
 * of the same stream after it on the page, or (b) a dibbur-opening
 * line that is the ONLY line of its commentary unit on the page.
 * The paginator already moves these cases (Priority 80/90); this is
 * the audit that proves it held. Heading lines that are the page's
 * only line because the unit is a one-line title page are not
 * flagged — a page with a single heading line and nothing else is a
 * title, not a stranding.
 */
export function checkStrandedDibburHeaders(
  pages: PageTypesetResult[],
  units: ContentUnit[]
): StrandedDibburViolation[] {
  const unitById = new Map(units.map(u => [u.id, u]));
  const violations: StrandedDibburViolation[] = [];
  for (const page of pages) {
    const streams: Array<TypesetLine[] | undefined> = [
      page.sourceLines,
      page.rashiLines,
      page.tosafotLines,
      page.tertiaryLines,
    ];
    for (const lines of streams) {
      if (!lines || lines.length === 0) continue;
      const last = lines[lines.length - 1];
      if (!last) continue;
      // (a) Heading as the last line of the stream.
      if (HEADING_ROLES.has(last.role)) {
        const bodyAfter = lines.some(
          (l, i) => i > lines.indexOf(last) && !HEADING_ROLES.has(l.role)
        );
        const pageHasBody = lines.some(l => !HEADING_ROLES.has(l.role));
        if (!bodyAfter && pageHasBody) {
          violations.push({
            pageNumber: page.pageNumber,
            unitId: last.unitId,
            kind: 'heading',
            lineIndex: last.lineIndex,
            detail: `Heading unit ${last.unitId} is the last line of its stream with no body line after it on page ${page.pageNumber}.`,
          });
        }
      }
      // (b) Dibbur opening line alone on the page for its unit.
      const unitLines = lines.filter(l => l.unitId === last.unitId);
      if (unitLines.length === 1 && isDibburOpeningLine(last)) {
        const unit = unitById.get(last.unitId);
        if (unit?.dibburHamatchil || unit?.dibburNode) {
          violations.push({
            pageNumber: page.pageNumber,
            unitId: last.unitId,
            kind: 'dibbur-header',
            lineIndex: last.lineIndex,
            detail: `Dibbur opening of unit ${last.unitId} stands alone at the bottom of page ${page.pageNumber} with no commentary body after it.`,
          });
        }
      }
    }
  }
  return violations;
}

/* ── Rule 2 — wraparound gap audit ────────────────────────────────── */

/**
 * Blank vertical bands on a page (Rule 2's verification side): rows
 * where no placed line covers any x. Uses the page's occupied
 * regions when present, otherwise rebuilds them from the lines.
 * Bands shorter than one commentary line are slivers, not gaps.
 */
export function measureWraparoundGaps(
  page: PageTypesetResult,
  geometry: PageGeometry,
  minHeightPt: number = 13
): Array<{ yTop: number; yBottom: number; heightPt: number }> {
  const contentHeight = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;
  let regions: OccupiedRegion[] = page.occupiedRegions ?? [];
  if (regions.length === 0) {
    const fromLines = (lines: TypesetLine[] | undefined, role: OccupiedRegion['role']): OccupiedRegion[] =>
      (lines ?? []).map((l, i) => ({
        id: `${role}-${i}`,
        role,
        xLeft: l.xLeft ?? 0,
        xRight: l.xRight ?? (l.xLeft ?? 0) + l.targetWidth,
        yTop: l.yTop ?? l.yBaseline - l.ascent,
        yBottom: l.yBottom ?? l.yBaseline + l.descent,
        unitId: l.unitId,
      }));
    regions = [
      ...fromLines(page.sourceLines, 'main_source'),
      ...fromLines(page.rashiLines, 'primary_comment'),
      ...fromLines(page.tosafotLines, 'secondary_comment'),
      ...fromLines(page.tertiaryLines, 'tertiary_comment'),
    ];
  }
  return SpatialExclusionEngine.measureBlankBands(regions, contentHeight, minHeightPt);
}

/* ── Performance — async chunked pagination with real progress ────── */

export interface PaginationProgress {
  /** Pages fully paginated so far. */
  pagesDone: number;
  /** Planner's estimated total pages (may be revised as chunks land). */
  estimatedTotalPages: number;
  /** 0–100. 100 only when the last chunk has landed. */
  percent: number;
  chunkIndex: number;
  chunkCount: number;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

interface ChunkPlan {
  units: ContentUnit[];
  links: RavTextLink[];
}

/**
 * Split the book into anchor-safe chunks: every commentary unit
 * travels in the same chunk as its anchor source unit, so no
 * AnchorLink ever crosses a chunk boundary and same-page gravity is
 * never broken by the split itself. Unanchored commentaries travel
 * with the chunk holding the nearest preceding source unit.
 * Chunks are sized by estimated pages (target ≈ total / 8 chunks,
 * at least one page each).
 */
export function splitIntoAnchorSafeChunks(
  units: ContentUnit[],
  links: RavTextLink[],
  anchorLinks: AnchorLink[],
  estimatedTotalPages: number,
  targetChunkCount: number = 8
): ChunkPlan[] {
  const sourceUnits = units.filter(
    u => u.role === 'main_source' || u.role === 'chapter' || u.role === 'verse' || u.role === 'heading' || u.role === 'siman'
  );
  const anchorSourceByCommentary = new Map<string, string>();
  for (const a of anchorLinks) {
    if (a.targetMainNodeId) anchorSourceByCommentary.set(a.commentaryUnitId, a.targetMainNodeId);
  }
  // Fall back to the RavTextLink target when no AnchorLink exists.
  for (const l of links) {
    if (!anchorSourceByCommentary.has(l.commentaryUnitId)) {
      anchorSourceByCommentary.set(l.commentaryUnitId, l.sourceUnitId);
    }
  }
  const chunkOfUnit = new Map<string, number>();
  const chunkCount = Math.max(1, Math.min(targetChunkCount, Math.max(1, estimatedTotalPages)));
  const sourcesPerChunk = Math.max(1, Math.ceil(Math.max(1, sourceUnits.length) / chunkCount));
  sourceUnits.forEach((u, i) => chunkOfUnit.set(u.id, Math.floor(i / sourcesPerChunk)));
  // Commentaries follow their anchor source; anything else follows the
  // nearest preceding source unit in document order.
  let lastSourceChunk = 0;
  for (const u of units) {
    if (chunkOfUnit.has(u.id)) {
      lastSourceChunk = chunkOfUnit.get(u.id)!;
      continue;
    }
    const anchor = anchorSourceByCommentary.get(u.id);
    if (anchor !== undefined && chunkOfUnit.has(anchor)) {
      chunkOfUnit.set(u.id, chunkOfUnit.get(anchor)!);
    } else {
      chunkOfUnit.set(u.id, lastSourceChunk);
    }
  }
  const chunks: ChunkPlan[] = [];
  const byChunk = new Map<number, ContentUnit[]>();
  for (const u of units) {
    const c = chunkOfUnit.get(u.id) ?? 0;
    const list = byChunk.get(c) ?? [];
    list.push(u);
    byChunk.set(c, list);
  }
  const linkChunk = (l: RavTextLink): number =>
    chunkOfUnit.get(l.sourceUnitId) ?? chunkOfUnit.get(l.commentaryUnitId) ?? 0;
  for (const [idx, chunkUnits] of [...byChunk.entries()].sort((a, b) => a[0] - b[0])) {
    chunks.push({
      units: chunkUnits,
      links: links.filter(l => linkChunk(l) === idx),
    });
  }
  return chunks.filter(c => c.units.length > 0);
}

/**
 * Paginate a whole book asynchronously with real progress callbacks.
 *
 * How it works (no faked progress): the book is split into
 * anchor-safe chunks (see `splitIntoAnchorSafeChunks`); each chunk is
 * paginated by the REAL synchronous PaginationEngine; the event loop
 * is yielded between chunks so the UI stays responsive during live
 * font-size / margin tweaks; `onProgress` fires after every chunk
 * with the real page count so far. Percent is pages-done vs the
 * same-page planner's estimated total, clamped to 99 until the final
 * chunk, then 100.
 *
 * Honest limits (also in the Phase 3–4 record): chunk boundaries
 * limit the paginator's global look-ahead to within a chunk, so a
 * very long book paginated this way can differ by a page or two from
 * the single-shot `paginateDocument` run; page numbers are renumbered
 * sequentially across chunks (Talmud +2 numbering preserved from the
 * first chunk's pages). For a final export, the single-shot run
 * remains the reference.
 */
export async function paginateDocumentAsync(
  input: PaginationInput,
  onProgress?: (progress: PaginationProgress) => void
): Promise<BookTypesetDocument> {
  const units = input.units ?? [];
  const links = input.links ?? [];
  const anchorLinks = input.anchorLinks ?? [];

  // Estimated total pages from the same-page planner (groups ≈ pages).
  const geometry = input.geometry ?? {
    pageWidth: 482,
    pageHeight: 680,
    marginTop: 48,
    marginBottom: 48,
    marginInside: 46,
    marginOutside: 42,
    isVerso: false,
  };
  const contentHeight = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;
  const sourceUnits = units.filter(
    u => u.role === 'main_source' || u.role === 'chapter' || u.role === 'verse'
  );
  const commentaryUnits = units.filter(
    u => u.role === 'primary_comment' || u.role === 'secondary_comment' || u.role === 'tertiary_comment'
  );
  const groups = planSamePageGroups(sourceUnits, commentaryUnits, anchorLinks, {
    contentHeightPt: contentHeight,
    sourceLineHeightPt: (input.sourceFontSize ?? 14.5) * 1.32,
    commentLineHeightPt: (input.commentaryFontSize ?? 10.5) * 1.32,
    flankWidthPt: 105,
    commentFontSizePt: input.commentaryFontSize ?? 10.5,
    sourceFontSizePt: input.sourceFontSize ?? 14.5,
  });
  const estimatedTotalPages = Math.max(1, groups.length);
  // v0.9.8 Phase 4 — chunk sizing: the planner groups are conservative
  // (≈2 sources per group vs ≈5 per real page), so estimatedTotalPages
  // runs ≈2× the real page count. Chunking at one chunk per estimated
  // page (the old default of 8) let the paginator's two-page balance
  // optimizer re-balance EACH chunk as a standalone book and inflated
  // the 7-page fixture book to 15 pages. Chunks of ≈4 estimated pages
  // (≈2 real pages) keep the inflation to ~1 page while still yielding
  // to the event loop and reporting real progress between chunks.
  const targetChunkCount = Math.max(1, Math.min(8, Math.ceil(estimatedTotalPages / 4)));
  const chunks = splitIntoAnchorSafeChunks(units, links, anchorLinks, estimatedTotalPages, targetChunkCount);

  const pages: PageTypesetResult[] = [];
  let pagesDone = 0;
  const allUnplaced: string[] = [];
  const allUnplacedWarnings: string[] = [];
  const allKeepTogether: string[] = [];
  const qualityScores: number[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // Yield BEFORE the chunk's synchronous work so the UI can paint
    // the progress from the previous chunk (first chunk included).
    await yieldToEventLoop();
    const doc = PaginationEngine.paginateDocument({
      ...input,
      units: chunk.units,
      links: chunk.links.length > 0 ? chunk.links : undefined,
      anchorLinks: chunk.units.some(u => u.anchorLink) ? anchorLinks : undefined,
    });
    // Renumber sequentially across chunks. Chunk pages are numbered
    // from their own start (1, or 2 for Talmud numbering); the offset
    // shifts them to continue the global sequence: the first page of
    // this chunk becomes (last global page number + 1).
    const chunkStartNumber = doc.pages[0]?.pageNumber ?? 1;
    const offset =
      pages.length === 0 ? 0 : pages[pages.length - 1].pageNumber + 1 - chunkStartNumber;
    for (const p of doc.pages) {
      const renumbered: PageTypesetResult = {
        ...p,
        pageIndex: pagesDone,
        pageNumber: p.pageNumber + offset,
        pageNumberHebrew: toHebrewGematria(p.pageNumber + offset),
      };
      pages.push(renumbered);
      pagesDone++;
    }
    if (doc.unplacedUnitIds) allUnplaced.push(...doc.unplacedUnitIds);
    if (doc.unplacedUnitWarnings) allUnplacedWarnings.push(...doc.unplacedUnitWarnings);
    if (doc.keepTogetherViolations) allKeepTogether.push(...doc.keepTogetherViolations);
    if (typeof doc.averageQualityScore === 'number') qualityScores.push(doc.averageQualityScore);
    const isLast = i === chunks.length - 1;
    const percent = isLast
      ? 100
      : Math.min(99, Math.round((pagesDone / Math.max(estimatedTotalPages, pagesDone)) * 100));
    onProgress?.({
      pagesDone,
      estimatedTotalPages: Math.max(estimatedTotalPages, pagesDone),
      percent,
      chunkIndex: i,
      chunkCount: chunks.length,
    });
  }

  return {
    title: input.title,
    layoutType: input.layoutType,
    pages,
    totalPages: pages.length,
    geometry,
    links,
    sourceFontFamily: input.sourceFontFamily,
    rashiFontFamily: input.rashiFontFamily,
    tosafotFontFamily: input.tosafotFontFamily,
    designSettings: input.designSettings,
    averageQualityScore:
      qualityScores.length > 0
        ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
        : undefined,
    unplacedUnitIds: allUnplaced,
    unplacedUnitWarnings: allUnplacedWarnings,
    keepTogetherViolations: allKeepTogether,
  };
}
