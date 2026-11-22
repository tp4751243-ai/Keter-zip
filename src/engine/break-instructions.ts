/**
 * Keter Typesetter — Anchored Break Instructions (v0.3.0, Module E)
 *
 * Pro typesetter tool: lets a typesetter pin a page break to a *word*, not to a
 * page number. An instruction says "this page must end before word N of unit U"
 * or "unit U starts on the next page" or "this page carries one line less".
 *
 * Why anchor to words, not pages?
 * -------------------------------
 * Proof corrections (in-place edits, spelling fixes, added/removed words) change
 * the pagination, so a break tied to "page 12" drifts onto the wrong page after
 * the next edit. An instruction anchored to a word/unit ID survives proof
 * corrections: after re-pagination the engine simply looks the anchor word up
 * again wherever it now sits and re-applies the break there. If the anchor word
 * was deleted by a correction, the instruction is skipped and reported instead
 * of silently breaking the wrong place.
 *
 * This module is a *conservative post-pass*: it never re-runs the pagination
 * solver and never splits a word. It only moves whole `TypesetLine` objects
 * across a page boundary (and whole units when the anchor is a unit start).
 * The parent wires the result back into the book by replacing the page array.
 *
 * v0.6.0 (Part B): two gaps in the original post-pass are fixed here, because
 * they are what made the drag-to-split tool look dead:
 *  1. Geometry is NOT left untouched any more. Lines moved to another page
 *     are re-stacked from that page's stream top (honouring each line's
 *     `spaceBeforePt` / `spaceAfterPt`, exactly as the single/two-column
 *     solvers do), so they render at the top of the receiving page in
 *     reading order instead of overlapping its lines at their stale
 *     `yBaseline`. Lines that no longer fit cascade to the following page
 *     (a fresh page is created when the split lands on the last page),
 *     so a split never silently clips text.
 *  2. The anchor word index is counted UNIT-GLOBALLY (words of the unit in
 *     document order across all pages), matching the contract in
 *     `AnchoredBreakInstruction.wordIndex` and the index the canvas
 *     computes from the unit page text map. The old per-page counting
 *     could not find the anchor of any unit spanning pages, so those
 *     instructions were silently skipped while the UI claimed success.
 */

import {
  BookTypesetDocument,
  ContentUnit,
  PageTypesetResult,
  TypesetLine,
} from '../types/typesetter';

export type BreakInstructionKind =
  | 'pageEndsBefore' // This page must end before the anchor word (word starts the next page)
  | 'startsNextPage' // The anchor unit starts on the next page (whole unit moves)
  | 'oneLineLess' // This page carries one line less (its last line moves to the next page)
  | 'oneLineMore'; // v0.9.8 Phase 5 — this page takes one line MORE: the first line of the NEXT page moves onto this page (proofing pull). Skipped with a warning when the page has no room.

export interface AnchoredBreakInstruction {
  /** Stable id, e.g. `brk-<unitId>-<n>`. */
  id: string;
  /** ContentUnit the break is anchored to. Survives re-pagination. */
  anchorUnitId: string;
  /**
   * Optional word index *within the whole unit* (0-based, counting non-space
   * words in unit order — the same numbering `InPlaceEditEngine` exposes as
   * `pageWordStartIndex + wordIndexInUnitSlice`). When omitted, the anchor is
   * the start of the unit.
   */
  wordIndex?: number;
  /** Optional stable word id when the pipeline supplies one (e.g. `unitId:w12`). */
  anchorWordId?: string;
  kind: BreakInstructionKind;
  /** Free-text note from the typesetter, e.g. "keep dibbur with its source". */
  note?: string;
  createdAt: number;
}

export interface BreakInstructionMove {
  instructionId: string;
  kind: BreakInstructionKind;
  fromPageIndex: number;
  toPageIndex: number;
  unitIds: string[];
  lineCount: number;
  anchorUnitId: string;
}

export interface BreakInstructionReport {
  instructionsApplied: number;
  instructionsSkipped: number;
  moved: BreakInstructionMove[];
  warnings: string[];
  /** Blank pages appended so a split on the last page has somewhere to go. */
  pagesCreated: number;
}

/** Hebrew folio text for a page number (mirrors PdfExporter.toHebrewGematria;
 * kept local so this small engine does not import the whole PDF exporter). */
export function toHebrewGematria(num: number): string {
  const letters: Array<[number, string]> = [
    [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'],
    [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'],
    [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'],
    [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'],
    [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'],
    [2, 'ב'], [1, 'א'],
  ];
  if (num === 15) return 'ט״ו';
  if (num === 16) return 'ט״ז';
  let n = num;
  let res = '';
  for (const [val, char] of letters) {
    while (n >= val) {
      res += char;
      n -= val;
    }
  }
  if (res.length > 1) return res.slice(0, -1) + '״' + res.slice(-1);
  if (res.length === 1) return res + '׳';
  return 'א׳';
}

/**
 * v0.6.0 (Part B) — the drag-to-split candidate resolver, extracted from
 * `PageCanvas` so it is testable without a DOM. First line of `unitLines`
 * that the pointer is on or above: the first line whose BOTTOM edge sits
 * at/below `pointerYContentPx`. The split moves content starting at this
 * line to the next page, so the line the pointer is actually resting on
 * must be selectable. (An earlier version compared against line TOPS, which
 * could never select the line under the pointer — and could never select a
 * unit's last line at all.)
 */
export function resolveSplitCandidateLine(
  unitLines: TypesetLine[],
  pointerYContentPx: number,
  scale: number
): TypesetLine | null {
  for (const line of unitLines) {
    const bottomPx = (line.yBaseline + line.descent) * scale;
    if (bottomPx >= pointerYContentPx) return line;
  }
  return null;
}

/**
 * v0.6.0 (Part B) — finds the anchor of a break instruction in the whole
 * book. `wordIndex` is counted UNIT-GLOBALLY (non-space words of the unit
 * in document order across all pages), matching the contract on
 * `AnchoredBreakInstruction.wordIndex`. Returns the page holding that word,
 * its line, its stream and its position inside the line. With no
 * `wordIndex` the anchor is the unit's first line in the book.
 */
export function findBreakAnchor(
  pages: PageTypesetResult[],
  anchorUnitId: string,
  wordIndex?: number
): {
  pageIndex: number;
  line: TypesetLine;
  stream: (typeof LINE_STREAMS)[number];
  wordPositionInLine: number;
} | null {
  if (wordIndex === undefined) {
    for (let i = 0; i < pages.length; i++) {
      const found = findAnchorLine(pages[i], anchorUnitId, undefined);
      if (found) return { pageIndex: i, ...found };
    }
    return null;
  }
  let seen = 0;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    for (const key of LINE_STREAMS) {
      const lines = page[key];
      if (!lines) continue;
      for (const line of lines) {
        if (line.unitId !== anchorUnitId) continue;
        const words = line.words.filter(w => !w.isSpace);
        if (wordIndex >= seen && wordIndex < seen + words.length) {
          return { pageIndex: i, line, stream: key, wordPositionInLine: wordIndex - seen };
        }
        seen += words.length;
      }
    }
  }
  return null;
}

export interface ApplyBreakInstructionsResult {
  pages: PageTypesetResult[];
  report: BreakInstructionReport;
}

/** All line streams on a page, in reading order. */
const LINE_STREAMS: Array<keyof Pick<
  PageTypesetResult,
  'sourceLines' | 'rashiLines' | 'tosafotLines' | 'footnoteLines' | 'column2Lines' | 'sideNoteLines'
>> = [
  'sourceLines',
  'rashiLines',
  'tosafotLines',
  'column2Lines',
  'footnoteLines',
  'sideNoteLines',
];

function allLinesOf(page: PageTypesetResult): TypesetLine[] {
  const out: TypesetLine[] = [];
  for (const key of LINE_STREAMS) {
    const lines = page[key];
    if (lines) out.push(...lines);
  }
  return out;
}

function clonePage(page: PageTypesetResult): PageTypesetResult {
  const clone: PageTypesetResult = { ...page };
  for (const key of LINE_STREAMS) {
    const lines = page[key];
    if (lines) (clone as unknown as Record<string, unknown>)[key] = [...lines];
  }
  return clone;
}

/**
 * Counts the non-space words of `unitId` on `page`, in reading order, and
 * returns the line that contains the word at unit-global index `wordIndex`
 * (and that word's position inside the line). Returns null when the unit or
 * the word is not on this page.
 */
function findAnchorLine(
  page: PageTypesetResult,
  anchorUnitId: string,
  wordIndex?: number
): { line: TypesetLine; stream: (typeof LINE_STREAMS)[number]; wordPositionInLine: number } | null {
  if (wordIndex === undefined) {
    for (const key of LINE_STREAMS) {
      const lines = page[key];
      if (!lines) continue;
      const line = lines.find(l => l.unitId === anchorUnitId);
      if (line) return { line, stream: key, wordPositionInLine: 0 };
    }
    return null;
  }
  let seen = 0;
  for (const key of LINE_STREAMS) {
    const lines = page[key];
    if (!lines) continue;
    for (const line of lines) {
      if (line.unitId !== anchorUnitId) continue;
      const words = line.words.filter(w => !w.isSpace);
      if (wordIndex >= seen && wordIndex < seen + words.length) {
        return { line, stream: key, wordPositionInLine: wordIndex - seen };
      }
      seen += words.length;
    }
  }
  return null;
}

/**
 * Moves every line from `fromLine` (inclusive) to the end of `page` into
 * `nextPage`, preserving stream grouping: lines are prepended to the matching
 * stream of the next page so reading order is kept. Whole lines only — a word
 * is never split. Receiving streams are recorded in `affected` (as
 * `${pageIndex}:${stream}`) so the caller can re-stack them — moved lines
 * must NOT keep the `yBaseline` they had on the source page. Returns the
 * moved lines (empty when nothing could move).
 */
function moveLinesToNextPage(
  page: PageTypesetResult,
  nextPage: PageTypesetResult,
  fromLine: TypesetLine,
  nextPageIndex: number,
  affected?: Set<string>
): TypesetLine[] {
  const moved: TypesetLine[] = [];
  // Find the cut position in reading order: the first stream/line index at or
  // after `fromLine`. Everything from there on (all streams, in stream order)
  // moves, because a page break must not leave a later stream stranded above
  // an earlier one on the same page.
  let cutReached = false;
  for (const key of LINE_STREAMS) {
    const lines = page[key];
    if (!lines || lines.length === 0) continue;
    if (!cutReached) {
      const cutIdx = lines.indexOf(fromLine);
      if (cutIdx === -1) continue; // this stream sits entirely before the cut
      cutReached = true;
      const tail = lines.slice(cutIdx);
      const head = lines.slice(0, cutIdx);
      (page as unknown as Record<string, unknown>)[key] = head;
      const nextLines = (nextPage[key] ?? []) as TypesetLine[];
      (nextPage as unknown as Record<string, unknown>)[key] = [...tail, ...nextLines];
      affected?.add(`${nextPageIndex}:${key}`);
      moved.push(...tail);
    } else {
      // Streams after the cut stream move wholesale.
      (page as unknown as Record<string, unknown>)[key] = [];
      const nextLines = (nextPage[key] ?? []) as TypesetLine[];
      (nextPage as unknown as Record<string, unknown>)[key] = [...lines, ...nextLines];
      affected?.add(`${nextPageIndex}:${key}`);
      moved.push(...lines);
    }
  }
  return moved;
}

/**
 * Moves the FIRST line of `page`'s first non-empty stream onto the end of
 * `prevPage`'s matching stream (v0.9.8 Phase 5 "pull line to this page").
 * The receiving stream is recorded in `affected` so the caller re-stacks
 * it — the pulled line must NOT keep the `yBaseline` it had on its old
 * page. Returns the moved line, or null when there is nothing to pull.
 */
function moveFirstLineToPrevPage(
  prevPage: PageTypesetResult,
  page: PageTypesetResult,
  prevPageIndex: number,
  pageIndex: number,
  affected?: Set<string>
): TypesetLine | null {
  for (const key of LINE_STREAMS) {
    const lines = page[key];
    if (!lines || lines.length === 0) continue;
    const first = lines[0];
    (page as unknown as Record<string, unknown>)[key] = lines.slice(1);
    const prevLines = (prevPage[key] ?? []) as TypesetLine[];
    (prevPage as unknown as Record<string, unknown>)[key] = [...prevLines, first];
    affected?.add(`${prevPageIndex}:${key}`);
    affected?.add(`${pageIndex}:${key}`);
    return first;
  }
  return null;
}

/** Content height (pt) of a page: page height minus top/bottom margins. */
function contentHeightPt(page: PageTypesetResult): number {
  return Math.max(
    40,
    page.geometry.pageHeight - page.geometry.marginTop - page.geometry.marginBottom
  );
}

/**
 * v0.6.0 (Part B) — a fresh blank page cloned from `lastPage` (same geometry,
 * design settings and knee), with empty line streams. Used when a split lands
 * on the last page, or when reflow overflow cascades past it, so the moved
 * text always has a folio to land on instead of the instruction being skipped.
 */
function createBlankPageAfter(lastPage: PageTypesetResult): PageTypesetResult {
  const nextNumber = (lastPage.pageNumber ?? lastPage.pageIndex + 1) + 1;
  const blank: PageTypesetResult = {
    ...clonePage(lastPage),
    pageIndex: lastPage.pageIndex + 1,
    pageNumber: nextNumber,
    pageNumberHebrew: toHebrewGematria(nextNumber),
    sourceLines: [],
    rashiLines: [],
    tosafotLines: [],
    footnoteLines: [],
    column2Lines: [],
    sideNoteLines: [],
    continuationHeader: undefined,
    continuationFooter: undefined,
  };
  return blank;
}

/**
 * v0.6.0 (Part B) — re-stacks one stream of one page in reading order from
 * `anchorTopPt` (the top of the stream's first line, in content-relative pt),
 * honouring each line's `spaceBeforePt` / `spaceAfterPt` exactly as the
 * single/two-column solvers do. Lines are cloned before their `yBaseline`
 * is rewritten, so the raw paginated pages are never mutated through the
 * shared line objects. Returns the lines that no longer fit in the content
 * area (from the end of the stream, in reading order) — the caller cascades
 * them to the next page. A single line that alone exceeds the page is kept
 * (a line is never split).
 */
function restackStream(
  pages: PageTypesetResult[],
  pageIdx: number,
  stream: (typeof LINE_STREAMS)[number],
  anchorTopPt: number
): TypesetLine[] {
  const page = pages[pageIdx];
  const rawLines = (page[stream] ?? []) as TypesetLine[];
  if (rawLines.length === 0) return [];
  // Clone: the post-pass must never rewrite yBaseline on the line objects
  // shared with the raw paginated pages.
  let lines = rawLines.map(l => ({ ...l }));
  (page as unknown as Record<string, unknown>)[stream] = lines;

  const stack = (ls: TypesetLine[]): number => {
    let cursor = anchorTopPt;
    for (const line of ls) {
      cursor += line.spaceBeforePt ?? 0;
      const ascent = line.ascent ?? 0;
      line.yBaseline = cursor + ascent;
      line.yBottom = line.yBaseline + (line.descent ?? 0);
      cursor += (line.height ?? 0) + (line.spaceAfterPt ?? 0);
    }
    return cursor;
  };

  let bottom = stack(lines);
  const limit = contentHeightPt(page);
  const overflow: TypesetLine[] = [];
  while (lines.length > 1 && bottom > limit) {
    const popped = lines.pop() as TypesetLine;
    overflow.unshift(popped);
    bottom = stack(lines);
  }
  if (overflow.length > 0) {
    (page as unknown as Record<string, unknown>)[stream] = lines;
  }
  return overflow;
}

/**
 * v0.6.0 (Part B) — re-stacks every stream that received moved lines, in
 * page order, cascading overflow lines to the following page (creating a
 * blank page when the overflow runs past the last page). `rawTops` holds
 * each stream's original first-line top, captured before any move, so a
 * stream re-starts where it used to start; a stream that was empty on the
 * receiving page starts at the top of the content area (footnotes keep
 * their first moved line's top, since they live at the bottom).
 */
function reflowAffectedStreams(
  working: PageTypesetResult[],
  affected: Set<string>,
  rawTops: Map<string, number>,
  report: BreakInstructionReport
): void {
  let guard = 0;
  while (affected.size > 0 && guard < working.length + 10) {
    guard += 1;
    const key = [...affected].sort((a, b) => {
      const pa = Number(a.split(':')[0]);
      const pb = Number(b.split(':')[0]);
      return pa - pb || a.localeCompare(b);
    })[0];
    affected.delete(key);
    const [pIdxStr, stream] = key.split(':');
    const pIdx = Number(pIdxStr);
    const streamKey = stream as (typeof LINE_STREAMS)[number];
    if (!working[pIdx]) continue;
    const lines = (working[pIdx][streamKey] ?? []) as TypesetLine[];
    if (lines.length === 0) continue;
    const rawTop = rawTops.get(key);
    const anchorTop =
      rawTop ??
      (streamKey === 'footnoteLines'
        ? (lines[0].yBaseline - (lines[0].ascent ?? 0))
        : 0);
    const overflow = restackStream(working, pIdx, streamKey, anchorTop);
    if (overflow.length === 0) continue;
    const nextIdx = pIdx + 1;
    if (nextIdx >= working.length) {
      working.push(createBlankPageAfter(working[working.length - 1]));
      report.pagesCreated += 1;
    }
    const nextLines = (working[nextIdx][streamKey] ?? []) as TypesetLine[];
    (working[nextIdx] as unknown as Record<string, unknown>)[streamKey] = [
      ...overflow,
      ...nextLines,
    ];
    affected.add(`${nextIdx}:${streamKey}`);
    report.warnings.push(
      `Break reflow: ${overflow.length} line(s) did not fit on page ${working[pIdx].pageNumber} and continued onto page ${working[nextIdx].pageNumber}.`
    );
  }
}

let instructionCounter = 0;

/** Creates a new break instruction anchored to a unit (and optionally a word). */
export function createBreakInstruction(
  anchorUnitId: string,
  kind: BreakInstructionKind,
  options?: { wordIndex?: number; anchorWordId?: string; note?: string }
): AnchoredBreakInstruction {
  instructionCounter += 1;
  return {
    id: `brk-${anchorUnitId}-${kind}-${Date.now().toString(36)}-${instructionCounter}`,
    anchorUnitId,
    wordIndex: options?.wordIndex,
    anchorWordId: options?.anchorWordId,
    kind,
    note: options?.note,
    createdAt: Date.now(),
  };
}

/** Returns the instructions sorted by anchor-unit document order (stable). */
export function listBreakInstructions(
  instructions: AnchoredBreakInstruction[],
  units?: ContentUnit[]
): AnchoredBreakInstruction[] {
  if (!units) return [...instructions].sort((a, b) => a.createdAt - b.createdAt);
  const order = new Map(units.map((u, i) => [u.id, i]));
  return [...instructions].sort((a, b) => {
    const oa = order.get(a.anchorUnitId) ?? Number.MAX_SAFE_INTEGER;
    const ob = order.get(b.anchorUnitId) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return (a.wordIndex ?? 0) - (b.wordIndex ?? 0);
  });
}

/** Removes one instruction by id. Returns the new list (input untouched). */
export function removeBreakInstruction(
  instructions: AnchoredBreakInstruction[],
  id: string
): AnchoredBreakInstruction[] {
  return instructions.filter(i => i.id !== id);
}

/**
 * Applies anchored break instructions as a post-pass over an already
 * paginated book. Pages are cloned, never mutated in place.
 *
 * - `pageEndsBefore`: the page holding the anchor word ends before it — the
 *   anchor line and everything after it on that page moves to the next page.
 * - `startsNextPage`: the whole anchor unit moves to the next page.
 * - `oneLineLess`: the page's last main-stream line moves to the next page.
 * - `oneLineMore` (v0.9.8 Phase 5): the anchor word is the first word of
 *   the NEXT page's first line — that line moves onto the PREVIOUS page.
 *   The pull is refused (skipped + warning, never a silent overflow)
 *   when the previous page has no room for the line: the reflow below
 *   would otherwise cascade it straight back, so the instruction would
 *   claim success while changing nothing.
 *
 * v0.6.0 (Part B): the anchor word is found UNIT-GLOBALLY (see
 * `findBreakAnchor`), so a unit spanning pages still breaks where the user
 * dragged. When the anchor sits on the last page, a blank page is appended
 * to receive the moved lines instead of the instruction being skipped.
 * After all instructions, every stream that received lines is re-stacked
 * from its top (see `reflowAffectedStreams`), so moved lines render in
 * reading order at the receiving page's top instead of overlapping at
 * their stale `yBaseline`. Instructions whose anchor cannot be found (word
 * deleted by a proof correction, unit removed, …) are skipped and listed
 * in `report.warnings` — never applied to the wrong place.
 */
export function applyBreakInstructions(
  pages: PageTypesetResult[],
  instructions: AnchoredBreakInstruction[],
  units?: ContentUnit[]
): ApplyBreakInstructionsResult {
  const working = pages.map(clonePage);
  const report: BreakInstructionReport = {
    instructionsApplied: 0,
    instructionsSkipped: 0,
    moved: [],
    warnings: [],
    pagesCreated: 0,
  };

  // Original first-line tops per stream, captured before any move, so the
  // reflow re-starts each receiving stream where it used to start.
  const rawTops = new Map<string, number>();
  for (let i = 0; i < working.length; i++) {
    for (const key of LINE_STREAMS) {
      const lines = working[i][key];
      if (lines && lines.length > 0) {
        rawTops.set(`${i}:${key}`, lines[0].yBaseline - (lines[0].ascent ?? 0));
      }
    }
  }
  const affected = new Set<string>();

  /** The page after `pageIdx`, creating a blank one when it is the last. */
  const nextPageOrCreate = (pageIdx: number): PageTypesetResult => {
    if (pageIdx + 1 < working.length) return working[pageIdx + 1];
    const blank = createBlankPageAfter(working[working.length - 1]);
    working.push(blank);
    report.pagesCreated += 1;
    return blank;
  };
  const nextPageIndexOf = (pageIdx: number): number => pageIdx + 1;

  const ordered = listBreakInstructions(instructions, units);

  for (const instruction of ordered) {
    // Find the page holding the anchor (unit-global word counting).
    const anchor = findBreakAnchor(
      working,
      instruction.anchorUnitId,
      instruction.wordIndex
    );

    if (!anchor) {
      report.instructionsSkipped += 1;
      report.warnings.push(
        `Break instruction ${instruction.id} skipped: anchor unit "${instruction.anchorUnitId}"` +
          (instruction.wordIndex !== undefined ? ` word ${instruction.wordIndex}` : '') +
          ' not found on any page (it may have been deleted by a proof correction).'
      );
      continue;
    }

    const pageIdx = anchor.pageIndex;
    const page = working[pageIdx];
    // oneLineMore pulls a line BACKWARD and never needs the following
    // page, so it is dispatched BEFORE the eager nextPageOrCreate
    // below — creating that page here would append a blank trailing
    // page whenever the anchor sits on the last page.
    if (instruction.kind === 'oneLineMore') {
      // v0.9.8 Phase 5 — pull: the anchor page is the page AFTER the one
      // that should gain the line (the anchor is the next page's first
      // word). Nothing to pull onto page 1.
      if (pageIdx === 0) {
        report.instructionsSkipped += 1;
        report.warnings.push(
          `Break instruction ${instruction.id} skipped: "oneLineMore" is anchored on the first page, which has no previous page to pull a line onto.`
        );
        continue;
      }
      const prevPage = working[pageIdx - 1];
      const prevIdx = pageIdx - 1;
      // Room check FIRST: the deepest occupied bottom on the previous
      // page plus the pulled line's full height (with its spacing) must
      // fit inside the content area, or the reflow below would cascade
      // the line straight back and the pull would be a no-op.
      let deepestBottom = 0;
      for (const key of LINE_STREAMS) {
        const lines = prevPage[key];
        if (!lines || lines.length === 0) continue;
        const last = lines[lines.length - 1];
        const bottom = last.yBottom ?? last.yBaseline + (last.descent ?? 0);
        if (bottom > deepestBottom) deepestBottom = bottom;
      }
      let firstLine: TypesetLine | null = null;
      for (const key of LINE_STREAMS) {
        const lines = page[key];
        if (lines && lines.length > 0) {
          firstLine = lines[0];
          break;
        }
      }
      if (!firstLine) {
        report.instructionsSkipped += 1;
        report.warnings.push(
          `Break instruction ${instruction.id} skipped: anchor page ${pageIdx + 1} has no lines to pull from.`
        );
        continue;
      }
      const pulledHeight =
        (firstLine.height ?? 0) +
        (firstLine.spaceBeforePt ?? 0) +
        (firstLine.spaceAfterPt ?? 0);
      if (deepestBottom + pulledHeight > contentHeightPt(prevPage)) {
        report.instructionsSkipped += 1;
        report.warnings.push(
          `Break instruction ${instruction.id} skipped: page ${prevPage.pageNumber} has no room for another line (${deepestBottom.toFixed(1)}pt used of ${contentHeightPt(prevPage).toFixed(1)}pt; the line needs ${pulledHeight.toFixed(1)}pt).`
        );
        continue;
      }
      const moved = moveFirstLineToPrevPage(prevPage, page, prevIdx, pageIdx, affected);
      if (!moved) {
        report.instructionsSkipped += 1;
        report.warnings.push(
          `Break instruction ${instruction.id} skipped: anchor page ${pageIdx + 1} has no lines to pull from.`
        );
        continue;
      }
      report.instructionsApplied += 1;
      report.moved.push({
        instructionId: instruction.id,
        kind: instruction.kind,
        fromPageIndex: pageIdx,
        toPageIndex: prevIdx,
        unitIds: [moved.unitId],
        lineCount: 1,
        anchorUnitId: instruction.anchorUnitId,
      });
      continue;
    }

    const nextPage = nextPageOrCreate(pageIdx);
    const nextIdx = nextPageIndexOf(pageIdx);

    if (instruction.kind === 'oneLineLess') {
      // The anchor page carries one line less: move its last line onward.
      const pageLines = allLinesOf(page);
      if (pageLines.length === 0) {
        report.instructionsSkipped += 1;
        report.warnings.push(
          `Break instruction ${instruction.id} skipped: anchor page ${pageIdx + 1} has no lines to move.`
        );
        continue;
      }
      // Last line of the main stream (source first, then commentary streams).
      let lastLine: TypesetLine | null = null;
      for (const key of LINE_STREAMS) {
        const lines = page[key];
        if (lines && lines.length > 0) lastLine = lines[lines.length - 1];
      }
      if (!lastLine) {
        report.instructionsSkipped += 1;
        report.warnings.push(
          `Break instruction ${instruction.id} skipped: anchor page ${pageIdx + 1} has no lines to move.`
        );
        continue;
      }
      const moved = moveLinesToNextPage(page, nextPage, lastLine, nextIdx, affected);
      report.instructionsApplied += 1;
      report.moved.push({
        instructionId: instruction.id,
        kind: instruction.kind,
        fromPageIndex: pageIdx,
        toPageIndex: nextIdx,
        unitIds: [...new Set(moved.map(l => l.unitId))],
        lineCount: moved.length,
        anchorUnitId: instruction.anchorUnitId,
      });
      continue;
    }

    if (instruction.kind === 'startsNextPage') {
      // Move the whole anchor unit: cut at its first line on this page.
      const first = findAnchorLine(page, instruction.anchorUnitId, undefined);
      if (!first) {
        report.instructionsSkipped += 1;
        report.warnings.push(
          `Break instruction ${instruction.id} skipped: anchor unit "${instruction.anchorUnitId}" not found on its page.`
        );
        continue;
      }
      // If the unit already starts the page, the instruction is satisfied.
      const pageLines = allLinesOf(page);
      if (pageLines.length > 0 && pageLines[0].unitId === instruction.anchorUnitId) {
        report.instructionsApplied += 1;
        continue;
      }
      const moved = moveLinesToNextPage(page, nextPage, first.line, nextIdx, affected);
      report.instructionsApplied += 1;
      report.moved.push({
        instructionId: instruction.id,
        kind: instruction.kind,
        fromPageIndex: pageIdx,
        toPageIndex: nextIdx,
        unitIds: [...new Set(moved.map(l => l.unitId))],
        lineCount: moved.length,
        anchorUnitId: instruction.anchorUnitId,
      });
      continue;
    }

    // pageEndsBefore: cut at the anchor line (the anchor word's line starts
    // the next page). If the anchor word is mid-line, the whole line moves —
    // words are never split, so the break lands at the line boundary just
    // before the anchor word's line.
    if (anchor.wordPositionInLine > 0) {
      report.warnings.push(
        `Break instruction ${instruction.id}: anchor word sits mid-line, so the whole line moves to the next page (words are never split).`
      );
    }
    const pageLines = allLinesOf(page);
    if (pageLines.length > 0 && pageLines[0] === anchor.line) {
      // Already at the top of the page — satisfied, nothing to move.
      report.instructionsApplied += 1;
      continue;
    }
    const moved = moveLinesToNextPage(page, nextPage, anchor.line, nextIdx, affected);
    report.instructionsApplied += 1;
    report.moved.push({
      instructionId: instruction.id,
      kind: instruction.kind,
      fromPageIndex: pageIdx,
      toPageIndex: nextIdx,
      unitIds: [...new Set(moved.map(l => l.unitId))],
      lineCount: moved.length,
      anchorUnitId: instruction.anchorUnitId,
    });
  }

  // Re-stack every stream that received moved lines (with overflow cascade),
  // so the moved text renders cleanly on the receiving pages.
  reflowAffectedStreams(working, affected, rawTops, report);

  return { pages: working, report };
}

/**
 * Convenience wrapper for a whole `BookTypesetDocument`: applies the
 * instructions and returns a new document object (input untouched).
 */
export function applyBreakInstructionsToBook(
  book: BookTypesetDocument,
  instructions: AnchoredBreakInstruction[],
  units?: ContentUnit[]
): { book: BookTypesetDocument; report: BreakInstructionReport } {
  const { pages, report } = applyBreakInstructions(book.pages, instructions, units);
  return { book: { ...book, pages, totalPages: pages.length }, report };
}
