/**
 * Stage 17I — True In-Place Text Editing Engine (InDesign-Style Direct Page Caret & Selection Model)
 *
 * Bridges the rendered typeset lines (`TypesetLine[]`) on `PageCanvas` with the authoritative
 * `ContentUnit` model without floating popup textareas, modals, or browser-reflowed `contentEditable`
 * boxes that break Rav-Text geometry.
 *
 * Key capabilities:
 * 1. Exact Grapheme Cluster Segmentation (`Intl.Segmenter` with Unicode mark-combining fallback)
 *    so Hebrew base letters stay paired with their Niqqud (0x05B0-0x05BC, 0x05C1-0x05C7) and
 *    Taamim (0x0591-0x05AF) during arrow-key caret navigation, selection, and hit-testing.
 * 2. Authoritative Line-to-Offset Mapping (`UnitPageTextMap`):
 *    Maps every rendered `TypesetLine` and `ShapedWord` of a `ContentUnit` on the active page
 *    to exact UTF-16 character offsets (`[charStart .. charEnd]`) and grapheme boundaries
 *    within the page slice of that unit.
 * 3. Multi-Page Split Unit Awareness:
 *    Determines the exact `[pageWordStartIndex .. pageWordEndIndexExclusive]` slice of a `ContentUnit`
 *    placed on the current page so editing a unit that spans across pages safely splices into
 *    the full `ContentUnit` without losing off-page words.
 * 4. Pure Deterministic Editing Operations:
 *    - Character / string / paste insertion at caret or replacing selection
 *    - Backspace (grapheme-aware or codepoint-aware) & Forward Delete
 *    - Word-level selection (double-click) and drag range selection
 *    - Visual RTL/LTR ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Home, End navigation across lines
 */

import { ContentUnit, PageTypesetResult, ShapedWord, TypesetLine } from '../types/typesetter';

export interface WordCharSpan {
  lineKey: string;
  lineIndexInUnit: number;
  lineObj: TypesetLine;
  wordIndexInLine: number;
  wordIndexInUnitSlice: number;
  word: ShapedWord;
  text: string;
  charStart: number; // Inclusive UTF-16 offset in unitPageText
  charEnd: number;   // Exclusive UTF-16 offset in unitPageText
  graphemeOffsets: number[]; // UTF-16 offsets of each grapheme boundary [0, ..., text.length]
}

export interface LineCharSpan {
  lineKey: string;
  lineIndexInUnit: number;
  lineObj: TypesetLine;
  charStart: number;
  charEnd: number;
  words: WordCharSpan[];
}

export interface UnitPageTextMap {
  unitId: string;
  unitPageText: string;
  graphemeBoundaries: number[]; // Ascending UTF-16 offsets [0, ..., unitPageText.length]
  lines: LineCharSpan[];
  words: WordCharSpan[];
  pageWordStartIndex: number;
  pageWordEndIndexExclusive: number;
  totalUnitWords: number;
}

export interface InPlaceSelectionState {
  unitId: string;
  anchorOffset: number; // UTF-16 offset in unitPageText
  focusOffset: number;  // UTF-16 offset in unitPageText (caret position)
}

export class InPlaceEditEngine {
  /**
   * Checks whether a Unicode code point is a Hebrew combining mark (Niqqud, Dagesh, Shin/Sin dot, or Taamim)
   */
  public static isHebrewCombiningMark(cp: number): boolean {
    return (cp >= 0x0591 && cp <= 0x05bd) || cp === 0x05bf || (cp >= 0x05c1 && cp <= 0x05c7);
  }

  /**
   * Computes sorted UTF-16 offsets of grapheme cluster boundaries in `text`,
   * always starting with `0` and ending with `text.length`.
   * Keeps Hebrew base letters and all attached Niqqud/Taamim marks together as one grapheme cluster.
   */
  public static computeGraphemeBoundaries(text: string): number[] {
    if (!text) return [0];

    const SegCtor = typeof Intl !== 'undefined' ? (Intl as any).Segmenter : undefined;
    if (typeof SegCtor === 'function') {
      const seg = new SegCtor('he', { granularity: 'grapheme' });
      const boundaries: number[] = [];
      for (const part of seg.segment(text)) {
        boundaries.push(part.index);
      }
      boundaries.push(text.length);
      return boundaries;
    }

    // Fallback grapheme cluster boundary detector for environments without Intl.Segmenter
    const boundaries: number[] = [0];
    let i = 0;
    while (i < text.length) {
      const cp = text.codePointAt(i) ?? 0;
      i += cp > 0xffff ? 2 : 1;
      while (i < text.length) {
        const nextCp = text.codePointAt(i) ?? 0;
        if (this.isHebrewCombiningMark(nextCp)) {
          i += nextCp > 0xffff ? 2 : 1;
        } else {
          break;
        }
      }
      boundaries.push(i);
    }
    return boundaries;
  }

  /**
   * Snaps an arbitrary UTF-16 offset to the nearest valid grapheme boundary in `boundaries`.
   */
  public static clampToGraphemeBoundary(offset: number, boundaries: number[]): number {
    if (boundaries.length === 0) return 0;
    if (offset <= boundaries[0]) return boundaries[0];
    const last = boundaries[boundaries.length - 1];
    if (offset >= last) return last;

    let best = boundaries[0];
    let bestDist = Math.abs(offset - best);
    for (let i = 1; i < boundaries.length; i++) {
      const dist = Math.abs(offset - boundaries[i]);
      if (dist < bestDist) {
        best = boundaries[i];
        bestDist = dist;
      }
    }
    return best;
  }

  /**
   * Collects all rendered lines belonging to `unitId` on `page` in reading order,
   * and builds the exact `UnitPageTextMap` mapping lines, words, and UTF-16 offsets.
   */
  public static buildUnitPageTextMap(
    page: PageTypesetResult,
    unitId: string,
    fullUnit?: ContentUnit | null
  ): UnitPageTextMap | null {
    const streamGroups: Array<{ prefix: string; lines: TypesetLine[] }> = [
      { prefix: 'src', lines: page.sourceLines || [] },
      { prefix: 'col2', lines: page.column2Lines || [] },
      { prefix: 'rashi', lines: page.rashiLines || [] },
      { prefix: 'tosafot', lines: page.tosafotLines || [] },
      { prefix: 'fn', lines: page.footnoteLines || [] },
    ];

    const matchedLines: Array<{ lineKey: string; line: TypesetLine }> = [];
    for (const grp of streamGroups) {
      for (const line of grp.lines) {
        if (line.role === 'continuation') continue;
        const hasUnitWords =
          line.unitId === unitId || line.words.some(w => !w.isSpace && w.unitId === unitId);
        if (hasUnitWords) {
          matchedLines.push({
            lineKey: `${grp.prefix}-${line.lineIndex}`,
            line,
          });
        }
      }
    }

    if (matchedLines.length === 0) {
      return null;
    }

    const lineSpans: LineCharSpan[] = [];
    const wordSpans: WordCharSpan[] = [];
    let currentOffset = 0;
    let wordCounter = 0;
    const textParts: string[] = [];

    for (let lIdx = 0; lIdx < matchedLines.length; lIdx++) {
      const { lineKey, line } = matchedLines[lIdx];
      const realWords = line.words.filter(
        w => !w.isSpace && w.text.trim().length > 0 && (w.unitId ?? line.unitId) === unitId
      );
      if (realWords.length === 0) continue;

      const lineCharStart = currentOffset;
      const lineWords: WordCharSpan[] = [];

      for (let wIdx = 0; wIdx < realWords.length; wIdx++) {
        if (wordCounter > 0) {
          textParts.push(' ');
          currentOffset += 1;
        }
        const w = realWords[wIdx];
        const wText = w.text;
        const wStart = currentOffset;
        const wEnd = wStart + wText.length;
        const gOffsets = this.computeGraphemeBoundaries(wText);

        const wSpan: WordCharSpan = {
          lineKey,
          lineIndexInUnit: lineSpans.length,
          lineObj: line,
          wordIndexInLine: wIdx,
          wordIndexInUnitSlice: wordCounter,
          word: w,
          text: wText,
          charStart: wStart,
          charEnd: wEnd,
          graphemeOffsets: gOffsets,
        };

        textParts.push(wText);
        currentOffset = wEnd;
        lineWords.push(wSpan);
        wordSpans.push(wSpan);
        wordCounter++;
      }

      const lineCharEnd = currentOffset;
      lineSpans.push({
        lineKey,
        lineIndexInUnit: lineSpans.length,
        lineObj: line,
        charStart: lineCharStart,
        charEnd: lineCharEnd,
        words: lineWords,
      });
    }

    const unitPageText = textParts.join('');
    const graphemeBoundaries = this.computeGraphemeBoundaries(unitPageText);

    // Determine exact slice indices within `fullUnit.rawText` if the unit is split across multiple pages
    const fullUnitWords = fullUnit
      ? fullUnit.rawText.trim().split(/\s+/).filter(Boolean)
      : wordSpans.map(w => w.text);
    const totalUnitWords = fullUnitWords.length;

    let pageWordStartIndex = 0;
    let pageWordEndIndexExclusive = totalUnitWords;

    if (wordSpans.length > 0 && wordSpans.length < totalUnitWords) {
      // Find the sub-sequence of `fullUnitWords` matching `wordSpans`
      const firstPageWord = wordSpans[0].text;
      const secondPageWord = wordSpans.length > 1 ? wordSpans[1].text : null;
      for (let s = 0; s <= totalUnitWords - wordSpans.length; s++) {
        if (
          fullUnitWords[s] === firstPageWord &&
          (secondPageWord === null || fullUnitWords[s + 1] === secondPageWord)
        ) {
          pageWordStartIndex = s;
          pageWordEndIndexExclusive = s + wordSpans.length;
          break;
        }
      }
    }

    return {
      unitId,
      unitPageText,
      graphemeBoundaries,
      lines: lineSpans,
      words: wordSpans,
      pageWordStartIndex,
      pageWordEndIndexExclusive,
      totalUnitWords,
    };
  }

  /**
   * Returns normalized `[startOffset, endOffset]` where `startOffset <= endOffset`.
   */
  public static getNormalizedRange(sel: InPlaceSelectionState): {
    start: number;
    end: number;
    isCollapsed: boolean;
  } {
    const start = Math.min(sel.anchorOffset, sel.focusOffset);
    const end = Math.max(sel.anchorOffset, sel.focusOffset);
    return { start, end, isCollapsed: start === end };
  }

  /**
   * Moves an offset forward (+1) or backward (-1) by one grapheme cluster in `map.unitPageText`.
   */
  public static stepGrapheme(
    offset: number,
    delta: 1 | -1,
    boundaries: number[]
  ): number {
    if (boundaries.length === 0) return 0;
    const clamped = this.clampToGraphemeBoundary(offset, boundaries);
    const idx = boundaries.indexOf(clamped);
    if (idx === -1) return clamped;
    const nextIdx = Math.max(0, Math.min(boundaries.length - 1, idx + delta));
    return boundaries[nextIdx];
  }

  /**
   * Inserts `insertText` at the current selection (or replaces the selected range)
   * and returns the updated text and new collapsed caret offset.
   */
  public static applyInsertText(
    currentText: string,
    selection: InPlaceSelectionState,
    insertText: string
  ): { nextText: string; nextSelection: InPlaceSelectionState } {
    const cleanInsert = insertText.replace(/[\r\n]+/g, ' ');
    const { start, end } = this.getNormalizedRange(selection);
    const safeStart = Math.max(0, Math.min(currentText.length, start));
    const safeEnd = Math.max(safeStart, Math.min(currentText.length, end));

    const nextText =
      currentText.slice(0, safeStart) + cleanInsert + currentText.slice(safeEnd);
    const nextCaret = safeStart + cleanInsert.length;

    return {
      nextText,
      nextSelection: {
        unitId: selection.unitId,
        anchorOffset: nextCaret,
        focusOffset: nextCaret,
      },
    };
  }

  /**
   * Applies Backspace to `currentText`:
   * - If a range is selected (`!isCollapsed`), deletes the selected range.
   * - If collapsed at `caret > 0`:
   *   - If the character immediately preceding `caret` is a Hebrew combining mark (Niqqud/Taam),
   *     deletes that single combining mark code point so the user can fine-edit Niqqud, OR if `deleteWholeGrapheme`
   *     is true, deletes the entire preceding grapheme cluster. By default, deleting a base letter or grapheme
   *     cluster removes the grapheme cluster cleanly.
   */
  public static applyBackspace(
    currentText: string,
    selection: InPlaceSelectionState,
    deleteWholeGrapheme: boolean = true
  ): { nextText: string; nextSelection: InPlaceSelectionState } {
    const { start, end, isCollapsed } = this.getNormalizedRange(selection);
    if (!isCollapsed) {
      const nextText = currentText.slice(0, start) + currentText.slice(end);
      return {
        nextText,
        nextSelection: {
          unitId: selection.unitId,
          anchorOffset: start,
          focusOffset: start,
        },
      };
    }

    if (start <= 0) {
      return { nextText: currentText, nextSelection: selection };
    }

    const boundaries = this.computeGraphemeBoundaries(currentText);
    const prevBoundary = this.stepGrapheme(start, -1, boundaries);
    const deleteFrom = deleteWholeGrapheme ? prevBoundary : Math.max(0, start - 1);

    const nextText = currentText.slice(0, deleteFrom) + currentText.slice(start);
    return {
      nextText,
      nextSelection: {
        unitId: selection.unitId,
        anchorOffset: deleteFrom,
        focusOffset: deleteFrom,
      },
    };
  }

  /**
   * Applies Forward Delete (`Delete` key) to `currentText`:
   * - If a range is selected (`!isCollapsed`), deletes the selected range.
   * - If collapsed at `caret < currentText.length`, deletes the following grapheme cluster.
   */
  public static applyDeleteForward(
    currentText: string,
    selection: InPlaceSelectionState
  ): { nextText: string; nextSelection: InPlaceSelectionState } {
    const { start, end, isCollapsed } = this.getNormalizedRange(selection);
    if (!isCollapsed) {
      const nextText = currentText.slice(0, start) + currentText.slice(end);
      return {
        nextText,
        nextSelection: {
          unitId: selection.unitId,
          anchorOffset: start,
          focusOffset: start,
        },
      };
    }

    if (start >= currentText.length) {
      return { nextText: currentText, nextSelection: selection };
    }

    const boundaries = this.computeGraphemeBoundaries(currentText);
    const nextBoundary = this.stepGrapheme(start, 1, boundaries);
    const nextText = currentText.slice(0, start) + currentText.slice(nextBoundary);

    return {
      nextText,
      nextSelection: {
        unitId: selection.unitId,
        anchorOffset: start,
        focusOffset: start,
      },
    };
  }

  /**
   * Finds the word span containing `offset` (for double-click word selection).
   */
  public static selectWordAtOffset(
    map: UnitPageTextMap,
    offset: number
  ): InPlaceSelectionState {
    for (const w of map.words) {
      if (offset >= w.charStart && offset <= w.charEnd) {
        return {
          unitId: map.unitId,
          anchorOffset: w.charStart,
          focusOffset: w.charEnd,
        };
      }
    }
    return {
      unitId: map.unitId,
      anchorOffset: offset,
      focusOffset: offset,
    };
  }

  /**
   * Computes keyboard caret/selection navigation (`ArrowRight`, `ArrowLeft`, `ArrowUp`, `ArrowDown`, `Home`, `End`)
   * in RTL Hebrew text (`direction === 'rtl'`).
   * In RTL:
   * - `ArrowLeft` advances forward in logical reading order (+1 grapheme / next word).
   * - `ArrowRight` moves backward in logical reading order (-1 grapheme / previous word).
   * - `Home` moves to the start of the current line (`line.charStart`).
   * - `End` moves to the end of the current line (`line.charEnd`).
   * - `ArrowUp` / `ArrowDown` moves to the corresponding proportional character position on the previous/next line of the unit.
   */
  public static moveCaretByKey(
    map: UnitPageTextMap,
    selection: InPlaceSelectionState,
    key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End',
    shiftKey: boolean = false,
    ctrlKey: boolean = false
  ): InPlaceSelectionState {
    const { start, end, isCollapsed } = this.getNormalizedRange(selection);
    const focus = selection.focusOffset;
    const textLen = map.unitPageText.length;

    // Find current line containing `focus`
    let curLineIdx = map.lines.findIndex(
      l => focus >= l.charStart && focus <= l.charEnd
    );
    if (curLineIdx === -1) {
      curLineIdx = focus <= 0 ? 0 : Math.max(0, map.lines.length - 1);
    }
    const curLine = map.lines[curLineIdx];

    let nextFocus = focus;

    if (key === 'ArrowLeft') {
      // Forward in RTL logical order (+1)
      if (!shiftKey && !isCollapsed) {
        nextFocus = end;
      } else if (ctrlKey) {
        // Jump to end of current or next word
        const nextWord = map.words.find(w => w.charEnd > focus);
        nextFocus = nextWord ? nextWord.charEnd : textLen;
      } else {
        nextFocus = this.stepGrapheme(focus, 1, map.graphemeBoundaries);
      }
    } else if (key === 'ArrowRight') {
      // Backward in RTL logical order (-1)
      if (!shiftKey && !isCollapsed) {
        nextFocus = start;
      } else if (ctrlKey) {
        // Jump to start of current or previous word
        const prevWords = map.words.filter(w => w.charStart < focus);
        nextFocus =
          prevWords.length > 0 ? prevWords[prevWords.length - 1].charStart : 0;
      } else {
        nextFocus = this.stepGrapheme(focus, -1, map.graphemeBoundaries);
      }
    } else if (key === 'Home') {
      nextFocus = ctrlKey ? 0 : curLine ? curLine.charStart : 0;
    } else if (key === 'End') {
      nextFocus = ctrlKey ? textLen : curLine ? curLine.charEnd : textLen;
    } else if (key === 'ArrowUp') {
      if (curLine && curLineIdx > 0) {
        const targetLine = map.lines[curLineIdx - 1];
        const relProgress =
          curLine.charEnd > curLine.charStart
            ? (focus - curLine.charStart) / (curLine.charEnd - curLine.charStart)
            : 0;
        const rawTarget =
          targetLine.charStart +
          Math.round(relProgress * (targetLine.charEnd - targetLine.charStart));
        nextFocus = this.clampToGraphemeBoundary(rawTarget, map.graphemeBoundaries);
      } else {
        nextFocus = 0;
      }
    } else if (key === 'ArrowDown') {
      if (curLine && curLineIdx + 1 < map.lines.length) {
        const targetLine = map.lines[curLineIdx + 1];
        const relProgress =
          curLine.charEnd > curLine.charStart
            ? (focus - curLine.charStart) / (curLine.charEnd - curLine.charStart)
            : 0;
        const rawTarget =
          targetLine.charStart +
          Math.round(relProgress * (targetLine.charEnd - targetLine.charStart));
        nextFocus = this.clampToGraphemeBoundary(rawTarget, map.graphemeBoundaries);
      } else {
        nextFocus = textLen;
      }
    }

    return {
      unitId: selection.unitId,
      anchorOffset: shiftKey ? selection.anchorOffset : nextFocus,
      focusOffset: nextFocus,
    };
  }
}

// ===========================================================================
// v0.5.0 Part C — Module 8 (In-Page Editing & Shortcuts): paste sanitizing
// and nikud-insensitive find. --- BEGIN Part C in-place-edit additions -----
// These are pure string helpers used by the contenteditable editor
// (`InlineTextEditor`) and the shortcuts hook. They never touch the DOM:
// the editor owns the caret, the engine owns the text rules.
// ===========================================================================

/** Hebrew combining marks (nikud / taamim / dagesh / shin-sin dot). */
const HEBREW_MARK_RE = /[\u0591-\u05C7]/g;

/** Strips nikud + taamim but keeps every base letter (for searching). */
export function stripNikudForFind(text: string): string {
  return text.replace(HEBREW_MARK_RE, '');
}

/**
 * Sanitizes pasted text for in-page editing:
 * - strips any HTML tags (paste arrives as plain text, but a stray
 *   `<b>` from a web page must never become markup in the book);
 * - drops control characters and zero-width / BOM characters;
 * - collapses runs of whitespace to single spaces (a pasted paragraph
 *   break becomes a space — one ContentUnit is one paragraph);
 * - NEVER strips Hebrew combining marks: nikud and taamim ride on their
 *   base letter and survive byte-for-byte.
 */
export function sanitizePastedText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    // Collapse whitespace runs to single spaces, but do NOT trim: a
    // pasted trailing space is the word separator between the pasted
    // words and the text that follows. The commit path normalizes
    // leading/trailing whitespace of the whole unit anyway.
    .replace(/\s+/g, ' ');
}

/**
 * Inserts sanitized pasted text at the selection (or replaces the selected
 * range). Returns the updated text + collapsed caret, like `applyInsertText`.
 */
export function applyPasteText(
  currentText: string,
  selection: InPlaceSelectionState,
  pastedText: string
): { nextText: string; nextSelection: InPlaceSelectionState } {
  const clean = sanitizePastedText(pastedText);
  if (!clean) return { nextText: currentText, nextSelection: selection };
  return InPlaceEditEngine.applyInsertText(currentText, selection, clean);
}

export interface FindOccurrence {
  /** Start offset in the ORIGINAL string (nikud included). */
  start: number;
  /** End offset (exclusive) in the ORIGINAL string. */
  end: number;
  /** The matched slice of the original string, nikud intact. */
  text: string;
}

/**
 * Finds every occurrence of `query` in `text`. With `nikudInsensitive`
 * (default on) the match ignores nikud/taamim on BOTH sides, but the
 * returned offsets point into the ORIGINAL string, so highlights and
 * replacements land on the real text with its nikud intact.
 */
export function findOccurrences(
  text: string,
  query: string,
  options: { nikudInsensitive?: boolean; caseSensitive?: boolean } = {}
): FindOccurrence[] {
  const needle = query.trim();
  if (!needle) return [];
  const nikudInsensitive = options.nikudInsensitive ?? true;
  const caseSensitive = options.caseSensitive ?? false;

  if (!nikudInsensitive) {
    const hay = caseSensitive ? text : text.toLowerCase();
    const ndl = caseSensitive ? needle : needle.toLowerCase();
    const out: FindOccurrence[] = [];
    let from = 0;
    for (;;) {
      const idx = hay.indexOf(ndl, from);
      if (idx === -1) break;
      out.push({ start: idx, end: idx + ndl.length, text: text.slice(idx, idx + ndl.length) });
      from = idx + Math.max(1, ndl.length);
    }
    return out;
  }

  // Build the stripped string + a map from stripped index -> original index.
  const strippedChars: string[] = [];
  const origIndexForStripped: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!/[\u0591-\u05C7]/.test(ch)) {
      strippedChars.push(caseSensitive ? ch : ch.toLowerCase());
      origIndexForStripped.push(i);
    }
  }
  const stripped = strippedChars.join('');
  const ndl = caseSensitive
    ? stripNikudForFind(needle)
    : stripNikudForFind(needle).toLowerCase();
  if (!ndl) return [];
  const out: FindOccurrence[] = [];
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(ndl, from);
    if (idx === -1) break;
    const origStart = origIndexForStripped[idx];
    // End: the original index just past the last matched base letter,
    // extended over any trailing combining marks on that letter.
    let origEnd = origIndexForStripped[idx + ndl.length - 1] + 1;
    while (origEnd < text.length && /[\u0591-\u05C7]/.test(text[origEnd])) origEnd++;
    out.push({ start: origStart, end: origEnd, text: text.slice(origStart, origEnd) });
    from = idx + Math.max(1, ndl.length);
  }
  return out;
}
// --- END Part C in-place-edit additions ------------------------------------
