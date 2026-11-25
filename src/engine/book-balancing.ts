/**
 * Keter Typesetter — Whole-Book Balancing Pass (v0.3.0, Module E)
 *
 * A global, conservative post-pass over an already paginated book. It runs
 * *after* `PaginationEngine.paginateDocument` and *after* anchored break
 * instructions, and it only moves whole `TypesetLine` objects between
 * neighbouring pages (or between a page and its successor's matching stream).
 * It never re-runs the pagination solver, never edits text, never splits a
 * word, and never touches `pagination-engine.ts`.
 *
 * What it fixes, in order:
 *  1. Widows — a page that *starts* with the single last line of a unit
 *     (one lonely line stranded at the top). The line is pulled back onto the
 *     previous page when it fits there.
 *  2. Orphans — a page that *ends* with the single first line of a unit
 *     (one lonely line stranded at the bottom). The line is pushed onto the
 *     next page.
 *  3. Column balance (two-column pages) — when one column ends far above the
 *     other, whole lines of the *short* column's stream are pulled forward
 *     from the next page while they fit in the short column's remaining
 *     space, so the columns end together within tolerance.
 *
 * Anything that cannot be fixed by moving whole lines within the available
 * space is left alone and reported in `report.notes` — the pass prefers an
 * honest "needs repagination" note over a distorted page.
 *
 * Original offline code. No network, no new dependencies.
 */

import { PageTypesetResult, TypesetLine } from '../types/typesetter';

export interface BookBalancingSettings {
  /** Max vertical gap (pt) allowed between two column bottoms. Default 24. */
  columnBalanceTolerancePt?: number;
  /** Max lines the pass may move on any single page. Default 3. */
  maxLinesToMovePerPage?: number;
  /** Widow/orphan fixing on/off. Default true. */
  fixWidowsOrphans?: boolean;
  /** Column balancing on/off. Default true. */
  balanceColumns?: boolean;
}

export interface BookBalancingReport {
  pagesAdjusted: number;
  widowsFixed: number;
  orphansFixed: number;
  columnsBalanced: number;
  /** Human-readable notes, incl. anything the pass could not fix. */
  notes: string[];
}

export interface BookBalancingResult {
  pages: PageTypesetResult[];
  report: BookBalancingReport;
}

const DEFAULT_SETTINGS: Required<BookBalancingSettings> = {
  columnBalanceTolerancePt: 24,
  maxLinesToMovePerPage: 3,
  fixWidowsOrphans: true,
  balanceColumns: true,
};

/** The line streams a page carries, in reading order. */
const LINE_STREAMS: Array<
  keyof Pick<
    PageTypesetResult,
    'sourceLines' | 'rashiLines' | 'tosafotLines' | 'footnoteLines' | 'column2Lines' | 'sideNoteLines'
  >
> = ['sourceLines', 'rashiLines', 'tosafotLines', 'column2Lines', 'footnoteLines', 'sideNoteLines'];

function clonePage(page: PageTypesetResult): PageTypesetResult {
  const clone: PageTypesetResult = { ...page };
  for (const key of LINE_STREAMS) {
    const lines = page[key];
    if (lines) (clone as unknown as Record<string, unknown>)[key] = [...lines];
  }
  return clone;
}

function allLinesOf(page: PageTypesetResult): TypesetLine[] {
  const out: TypesetLine[] = [];
  for (const key of LINE_STREAMS) {
    const lines = page[key];
    if (lines) out.push(...lines);
  }
  return out;
}

function contentHeightPt(page: PageTypesetResult): number {
  return page.geometry.pageHeight - page.geometry.marginTop - page.geometry.marginBottom;
}

/** Bottom edge (pt, content-relative) of the last line of a stream. */
function streamBottom(lines: TypesetLine[] | undefined): number {
  if (!lines || lines.length === 0) return 0;
  const last = lines[lines.length - 1];
  return last.yBaseline + (last.descent ?? 0);
}

/**
 * Does `line` fit at the bottom of `page`'s stream `key` without crossing the
 * content area? Conservative: the line's own height is added to the stream's
 * current bottom, plus a one-line leading allowance.
 */
function lineFitsAtStreamEnd(
  page: PageTypesetResult,
  key: (typeof LINE_STREAMS)[number],
  line: TypesetLine
): boolean {
  const lines = page[key] ?? [];
  const bottom = streamBottom(lines);
  const lineHeight = (line.ascent ?? 0) + (line.descent ?? 0) || line.height || 12;
  return bottom + lineHeight + 2 <= contentHeightPt(page);
}


/**
 * Can `line` (moved WITHOUT re-positioning — this pass never re-lays a
 * page out) sit on `page` at the head / end of its column? Only when it
 * would neither overlap another line on that page nor break the reading
 * order of its column. Pages laid out by a real engine (two columns, the
 * Vilna knee …) place every line exactly, so a moved line almost never
 * fits — and must not be moved: it landed ON another line (the user's
 * Kedushat Levi PDF export failed on that overlap).
 */
function fitsUnmoved(page: PageTypesetResult, line: TypesetLine, atHead: boolean): boolean {
  const top = line.yTop ?? line.yBaseline - (line.ascent ?? 0);
  const bot = line.yBottom ?? line.yBaseline + (line.descent ?? 0);
  const xl = line.xLeft;
  const xr = line.xRight;
  const all = allLinesOf(page).filter(l => l !== line);
  const sameCol = all.filter(l => xl === undefined || l.xLeft === undefined || (Math.min(xr ?? 0, l.xRight ?? 0) - Math.max(xl, l.xLeft) > 1));
  for (const l of sameCol) {
    const t = l.yTop ?? l.yBaseline - (l.ascent ?? 0);
    const b = l.yBottom ?? l.yBaseline + (l.descent ?? 0);
    if (Math.min(bot, b) - Math.max(top, t) > 0.5) return false;
    if (atHead && l.yBaseline <= line.yBaseline) return false;
    if (!atHead && l.yBaseline >= line.yBaseline) return false;
  }
  return true;
}

function findStreamOf(page: PageTypesetResult, line: TypesetLine): (typeof LINE_STREAMS)[number] | null {
  for (const key of LINE_STREAMS) {
    if ((page[key] ?? []).includes(line)) return key;
  }
  return null;
}

/**
 * Global whole-book balancing pass. Pure post-pass on the page arrays:
 * input pages are cloned, never mutated.
 */
export function wholeBookBalancingPass(
  pages: PageTypesetResult[],
  settings: BookBalancingSettings = {}
): BookBalancingResult {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const working = pages.map(clonePage);
  const report: BookBalancingReport = {
    pagesAdjusted: 0,
    widowsFixed: 0,
    orphansFixed: 0,
    columnsBalanced: 0,
    notes: [],
  };
  const adjustedPages = new Set<number>();
  const markAdjusted = (idx: number) => {
    if (!adjustedPages.has(idx)) {
      adjustedPages.add(idx);
      report.pagesAdjusted += 1;
    }
  };

  if (working.length < 2) {
    return { pages: working, report };
  }

  // --- 1 & 2. Widows and orphans, page by page ---------------------------
  if (s.fixWidowsOrphans) {
    for (let i = 1; i < working.length; i++) {
      const page = working[i];
      const prev = working[i - 1];
      const pageLines = allLinesOf(page);
      if (pageLines.length === 0) continue;

      let movedThisPage = 0;

      // Widow: the page opens with the *last* line of a unit, and that unit
      // has exactly one line on this page. Pull it back to the previous page.
      const firstLine = pageLines[0];
      const unitLinesOnPage = pageLines.filter(l => l.unitId === firstLine.unitId);
      const isLastLineOfUnit =
        unitLinesOnPage.length === 1 && firstLine.isLastLine;
      if (isLastLineOfUnit && movedThisPage < s.maxLinesToMovePerPage) {
        const stream = findStreamOf(page, firstLine);
        const prevStream = stream ? prev[stream] ?? [] : [];
        const prevUnitLines = prevStream.filter(l => l.unitId === firstLine.unitId);
        const continuesUnit = prevUnitLines.length > 0;
        if (stream && continuesUnit && lineFitsAtStreamEnd(prev, stream, firstLine) && fitsUnmoved(prev, firstLine, false)) {
          (page as unknown as Record<string, unknown>)[stream] = (page[stream] ?? []).filter(
            l => l !== firstLine
          );
          (prev as unknown as Record<string, unknown>)[stream] = [...prevStream, firstLine];
          report.widowsFixed += 1;
          movedThisPage += 1;
          markAdjusted(i - 1);
          markAdjusted(i);
          report.notes.push(
            `Page ${page.pageNumber}: widow fixed — last line of unit "${firstLine.unitId}" pulled back to page ${prev.pageNumber}.`
          );
        } else if (stream && continuesUnit) {
          report.notes.push(
            `Page ${page.pageNumber}: widow of unit "${firstLine.unitId}" could not be pulled back — previous page has no room (needs repagination).`
          );
        }
      }

      // Orphan: the *previous* page ends with the single first line of a unit
      // (the unit's opening line stranded alone at the bottom). Push it onto
      // this page, at the head of its stream.
      const prevLines = allLinesOf(prev);
      if (prevLines.length > 0 && movedThisPage < s.maxLinesToMovePerPage) {
        const lastPrevLine = prevLines[prevLines.length - 1];
        const prevUnitLines = prevLines.filter(l => l.unitId === lastPrevLine.unitId);
        const isFirstLineOfUnit =
          prevUnitLines.length === 1 && !lastPrevLine.isLastLine;
        // Only an orphan if the unit continues onto this page.
        const continuesHere = pageLines.some(l => l.unitId === lastPrevLine.unitId);
        if (isFirstLineOfUnit && continuesHere) {
          const stream = findStreamOf(prev, lastPrevLine);
          if (stream && fitsUnmoved(page, lastPrevLine, true)) {
            (prev as unknown as Record<string, unknown>)[stream] = (prev[stream] ?? []).filter(
              l => l !== lastPrevLine
            );
            (page as unknown as Record<string, unknown>)[stream] = [
              lastPrevLine,
              ...(page[stream] ?? []),
            ];
            report.orphansFixed += 1;
            movedThisPage += 1;
            markAdjusted(i - 1);
            markAdjusted(i);
            report.notes.push(
              `Page ${prev.pageNumber}: orphan fixed — opening line of unit "${lastPrevLine.unitId}" pushed to page ${page.pageNumber}.`
            );
          }
        }
      }
    }
  }

  // --- 3. Column balance (two-column pages) -------------------------------
  if (s.balanceColumns) {
    for (let i = 0; i < working.length; i++) {
      const page = working[i];
      if (page.layoutType !== 'two_column') continue;
      const col1 = page.sourceLines ?? [];
      const col2 = page.column2Lines ?? [];
      if (col1.length === 0 || col2.length === 0) continue;

      const bottom1 = streamBottom(col1);
      const bottom2 = streamBottom(col2);
      const gap = Math.abs(bottom1 - bottom2);
      if (gap <= s.columnBalanceTolerancePt) {
        report.columnsBalanced += 1;
        continue;
      }

      // The short column pulls whole lines of its own stream forward from the
      // next page while they fit in its remaining space. Lines are never
      // moved *between* columns — a column-1 line stays column 1.
      const shortIsCol1 = bottom1 < bottom2;
      const shortKey = (shortIsCol1 ? 'sourceLines' : 'column2Lines') as (typeof LINE_STREAMS)[number];
      const next = working[i + 1];
      if (!next) {
        report.notes.push(
          `Page ${page.pageNumber}: columns end ${gap.toFixed(0)}pt apart and there is no next page to pull lines from (needs repagination).`
        );
        continue;
      }
      const nextLines = (next[shortKey] ?? []) as TypesetLine[];
      if (nextLines.length === 0) {
        report.notes.push(
          `Page ${page.pageNumber}: columns end ${gap.toFixed(0)}pt apart and the next page has no ${shortIsCol1 ? 'column 1' : 'column 2'} lines to pull forward.`
        );
        continue;
      }

      let pulled = 0;
      const shortLines = [...(page[shortKey] ?? [])];
      const remainingNext = [...nextLines];
      while (
        pulled < s.maxLinesToMovePerPage &&
        remainingNext.length > 0 &&
        streamBottom(shortLines) < Math.max(bottom1, bottom2) - 2
      ) {
        const candidate = remainingNext[0];
        const trial = [...shortLines, candidate];
        if (streamBottom(trial) > contentHeightPt(page)) break;
        if (!fitsUnmoved({ ...page, [shortKey]: shortLines } as PageTypesetResult, candidate, false)) break;
        shortLines.push(candidate);
        remainingNext.shift();
        pulled += 1;
      }
      if (pulled > 0) {
        (page as unknown as Record<string, unknown>)[shortKey] = shortLines;
        (next as unknown as Record<string, unknown>)[shortKey] = remainingNext;
        report.columnsBalanced += 1;
        markAdjusted(i);
        markAdjusted(i + 1);
        report.notes.push(
          `Page ${page.pageNumber}: columns balanced — pulled ${pulled} line(s) forward from page ${next.pageNumber} into the short column.`
        );
      } else {
        report.notes.push(
          `Page ${page.pageNumber}: columns end ${gap.toFixed(0)}pt apart; no whole line could be pulled forward within the page (needs repagination).`
        );
      }
    }
  }

  return { pages: working, report };
}
