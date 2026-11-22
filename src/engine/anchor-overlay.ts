/**
 * KETER-TYPE v0.9.8 Phase 5 — Anchor overlay + click-to-re-anchor.
 *
 * Pure helpers (no DOM, no React) for the "Show Anchor Links" overlay in
 * PageCanvas and for re-anchoring a dibbur by clicking it and then its
 * target phrase in the Main Text.
 *
 * Verify-first notes (what already existed):
 * - PageCanvas already had a "hovered link connector" — but it was a
 *   HARDCODED decorative curve (contentW*0.25, contentH*0.28 →
 *   contentW*0.72, contentH*0.32), not geometry from the real page.
 *   Nothing in the tree connected an AnchorLink to a rendered word
 *   position. This module + the canvas measurement pass replace that
 *   curve with connectors drawn between the actual rendered word spans.
 * - Word spans on the canvas are registered in `wordDomMapRef` under
 *   keys `${lineKey}-w-${wordIndexInLine}` (lineKey =
 *   `${streamPrefix}-${line.lineIndex}`, stream prefixes src / col2 /
 *   rashi / tosafot / tertiary / fn; wordIndexInLine counts NON-SPACE
 *   words — the same numbering `InPlaceEditEngine.buildUnitPageTextMap`
 *   exposes as `wordIndexInLine`). This module produces exactly those
 *   keys, so the canvas can measure real DOM rects.
 * - `AnchorLink.targetCharOffset` is an offset into the target unit's
 *   full `rawText`; the page text map's char offsets are relative to the
 *   unit's words ON THIS PAGE (`unitPageText`). The conversion below
 *   (raw-text word offsets → page-slice start) is the bridge between
 *   the two coordinate systems.
 */

import type {
  AnchorLink,
  ContentRole,
  ContentUnit,
  PageTypesetResult,
  TypesetLine,
} from '../types/typesetter';
import { InPlaceEditEngine } from './in-place-edit-engine';

/** One resolved connector between a dibbur word and its target phrase. */
export interface AnchorConnector {
  /** AnchorLink.linkId (`anchor-<commentaryUnitId>`). */
  linkId: string;
  commentaryUnitId: string;
  commentaryRole: ContentRole;
  targetMainNodeId?: string;
  /** 0–1 confidence of the link. */
  confidence: number;
  method: AnchorLink['method'];
  /** Stroke colour (confidence-coded). */
  color: string;
  /** True when the link has no target (unmatched / awaiting review). */
  unmatched: boolean;
  /** DOM key of the dibbur word span on this page (or null when off-page). */
  dibburDomKey: string | null;
  /** DOM key of the target-phrase word span on this page (or null). */
  targetDomKey: string | null;
  dibburText: string;
  targetText?: string;
}

/** Confidence-coded connector colours (same scale as the review queue). */
export function anchorConnectorColor(
  confidence: number,
  method: AnchorLink['method']
): string {
  if (method === 'unmatched' || confidence <= 0) return '#9B2C2C';
  if (confidence >= 0.9) return '#2F6B3A';
  if (confidence >= 0.8) return '#1D5FA8';
  return '#B8741A';
}

/** Stream prefixes in the order PageCanvas renders them. */
export const ANCHOR_STREAMS: Array<{
  prefix: string;
  lines: (page: PageTypesetResult) => TypesetLine[];
}> = [
  { prefix: 'src', lines: p => p.sourceLines ?? [] },
  { prefix: 'col2', lines: p => p.column2Lines ?? [] },
  { prefix: 'rashi', lines: p => p.rashiLines ?? [] },
  { prefix: 'tosafot', lines: p => p.tosafotLines ?? [] },
  { prefix: 'tertiary', lines: p => p.tertiaryLines ?? [] },
  { prefix: 'fn', lines: p => p.footnoteLines ?? [] },
];

/** DOM key of a word span, exactly as PageCanvas registers it. */
export function wordDomKey(lineKey: string, wordIndexInLine: number): string {
  return `${lineKey}-w-${wordIndexInLine}`;
}

/** Word spans of `text` (whitespace-split) with UTF-16 offsets. */
export function rawTextWordOffsets(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Index of the word whose span contains `charOffset` (clamped to the last word). */
export function wordIndexAtCharOffset(text: string, charOffset: number): number {
  const spans = rawTextWordOffsets(text);
  if (spans.length === 0) return 0;
  for (let i = 0; i < spans.length; i++) {
    if (charOffset >= spans[i].start && charOffset < spans[i].end) return i;
  }
  if (charOffset >= spans[spans.length - 1].end) return spans.length - 1;
  for (let i = 0; i < spans.length; i++) {
    if (charOffset < spans[i].start) return i;
  }
  return 0;
}

/**
 * First dibbur word of `commentaryUnitId` on this page, as a DOM key.
 * A dibbur word is a non-space word with `isDibbur` (or, as a fallback,
 * the first bold word of a commentary unit whose dibburHamatchil is set).
 * Returns null when the unit has no dibbur word on this page.
 */
export function findDibburWordKey(
  page: PageTypesetResult,
  commentaryUnitId: string
): { lineKey: string; wordIndexInLine: number } | null {
  for (const { prefix, lines } of ANCHOR_STREAMS) {
    for (const line of lines(page)) {
      const nonSpace = line.words.filter(w => !w.isSpace);
      for (let wIdx = 0; wIdx < nonSpace.length; wIdx++) {
        const w = nonSpace[wIdx];
        if ((w.unitId ?? line.unitId) !== commentaryUnitId) continue;
        if (w.isDibbur) {
          return { lineKey: `${prefix}-${line.lineIndex}`, wordIndexInLine: wIdx };
        }
      }
    }
  }
  return null;
}

/**
 * The word span of the target phrase on this page, as a DOM key.
 * `targetCharOffset` is an offset into the source unit's full rawText;
 * the page text map is relative to this page's slice, so the slice start
 * (from `pageWordStartIndex`) is subtracted first. Returns null when the
 * target unit or the offset is not on this page.
 */
export function findTargetWordKey(
  page: PageTypesetResult,
  sourceUnit: ContentUnit,
  targetCharOffset: number
): { lineKey: string; wordIndexInLine: number } | null {
  const map = InPlaceEditEngine.buildUnitPageTextMap(page, sourceUnit.id, sourceUnit);
  if (!map) return null;
  const rawSpans = rawTextWordOffsets(sourceUnit.rawText);
  const sliceStartWord = Math.min(map.pageWordStartIndex, Math.max(0, rawSpans.length - 1));
  const sliceStartChar =
    rawSpans.length === 0 ? 0 : rawSpans[sliceStartWord]?.start ?? 0;
  const localOffset = targetCharOffset - sliceStartChar;
  if (localOffset < 0) return null;
  const span =
    map.words.find(w => localOffset >= w.charStart && localOffset < w.charEnd) ??
    map.words.find(w => w.charStart >= localOffset) ??
    null;
  if (!span) return null;
  return { lineKey: span.lineKey, wordIndexInLine: span.wordIndexInLine };
}

/** Unit-global (non-space) word index of a word on this page. */
export function wordGlobalIndexInUnit(
  page: PageTypesetResult,
  unitId: string,
  lineKey: string,
  wordIndexInLine: number
): number | null {
  const map = InPlaceEditEngine.buildUnitPageTextMap(page, unitId, null);
  if (!map) return null;
  const span = map.words.find(
    w => w.lineKey === lineKey && w.wordIndexInLine === wordIndexInLine
  );
  if (!span) return null;
  return map.pageWordStartIndex + span.wordIndexInUnitSlice;
}

/**
 * Unit-global (non-space) word index of a word, counted in the SAME
 * order `findBreakAnchor` (engine/break-instructions.ts) counts: pages
 * in order, streams in LINE_STREAMS order (source, rashi, tosafot,
 * column2, footnote, sideNote), lines in order, words in order.
 * This is the index a break instruction's `wordIndex` needs, so the
 * anchor resolves to the intended page — anchoring at 0 would resolve
 * to the unit's first word, which may sit on a much earlier page.
 * Returns null when the line cannot be found (e.g. a tertiary-band
 * line, which the break engine's stream list does not cover).
 */
export function unitGlobalWordIndexAcrossPages(
  pages: PageTypesetResult[],
  pageIndex: number,
  unitId: string,
  streamKey: string,
  lineIndex: number,
  wordIndexInLine: number
): number | null {
  const streamOrder = [
    'sourceLines',
    'rashiLines',
    'tosafotLines',
    'column2Lines',
    'footnoteLines',
    'sideNoteLines',
  ];
  const targetStreamPos = streamOrder.indexOf(streamKey);
  if (targetStreamPos === -1) return null;
  let seen = 0;
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    if (!page) continue;
    const lastStream = p < pageIndex ? streamOrder.length - 1 : targetStreamPos;
    for (let s = 0; s <= lastStream; s++) {
      const key = streamOrder[s] as keyof PageTypesetResult;
      const lines = (page[key] as TypesetLine[] | undefined) ?? [];
      for (const line of lines) {
        const isTarget =
          p === pageIndex && s === targetStreamPos && line.lineIndex === lineIndex;
        if (isTarget) {
          if (line.unitId !== unitId) return null;
          const words = line.words.filter(w => !w.isSpace);
          if (wordIndexInLine >= words.length) return null;
          return seen + wordIndexInLine;
        }
        // Same rule as findBreakAnchor: only lines whose line.unitId
        // matches count, and every non-space word on such a line counts.
        if (line.unitId === unitId) {
          seen += line.words.filter(w => !w.isSpace).length;
        }
      }
    }
  }
  return null;
}

/**
 * Character offset (in the unit's full rawText) of a word the user clicked
 * on this page — the value a re-anchor target needs. Returns null when
 * the word cannot be mapped back to the raw text.
 */
export function charOffsetOfPageWord(
  page: PageTypesetResult,
  unit: ContentUnit,
  lineKey: string,
  wordIndexInLine: number
): number | null {
  const map = InPlaceEditEngine.buildUnitPageTextMap(page, unit.id, unit);
  if (!map) return null;
  const span = map.words.find(
    w => w.lineKey === lineKey && w.wordIndexInLine === wordIndexInLine
  );
  if (!span) return null;
  const rawSpans = rawTextWordOffsets(unit.rawText);
  const sliceStartWord = Math.min(map.pageWordStartIndex, Math.max(0, rawSpans.length - 1));
  const sliceStartChar = rawSpans.length === 0 ? 0 : rawSpans[sliceStartWord]?.start ?? 0;
  return sliceStartChar + span.charStart;
}

/** True when either end of `link` has at least one word on this page. */
export function anchorLinkTouchesPage(
  page: PageTypesetResult,
  link: AnchorLink
): boolean {
  for (const { lines } of ANCHOR_STREAMS) {
    for (const line of lines(page)) {
      if (line.unitId === link.commentaryUnitId) return true;
      if (link.targetMainNodeId && line.unitId === link.targetMainNodeId) return true;
      for (const w of line.words) {
        if (!w.isSpace && (w.unitId === link.commentaryUnitId || w.unitId === link.targetMainNodeId)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Builds the connector list for one page from the real paginated lines.
 * No DOM access here — the canvas measures the DOM keys and draws the
 * paths; a connector with a null key at either end is drawn as a
 * "dangling" stub (dibbur with no target on this page) or skipped when
 * the dibbur itself is off-page.
 */
export function buildAnchorConnectors(
  page: PageTypesetResult,
  links: AnchorLink[],
  unitsById: Map<string, ContentUnit>
): AnchorConnector[] {
  const out: AnchorConnector[] = [];
  for (const link of links) {
    if (!anchorLinkTouchesPage(page, link)) continue;
    const commentary = unitsById.get(link.commentaryUnitId);
    const dibbur = findDibburWordKey(page, link.commentaryUnitId);
    let target: { lineKey: string; wordIndexInLine: number } | null = null;
    if (link.targetMainNodeId !== undefined && link.targetCharOffset !== undefined) {
      const source = unitsById.get(link.targetMainNodeId);
      if (source) target = findTargetWordKey(page, source, link.targetCharOffset);
    }
    out.push({
      linkId: link.linkId,
      commentaryUnitId: link.commentaryUnitId,
      commentaryRole: commentary?.role ?? 'primary_comment',
      targetMainNodeId: link.targetMainNodeId,
      confidence: link.linkConfidence,
      method: link.method,
      color: anchorConnectorColor(link.linkConfidence, link.method),
      unmatched: link.method === 'unmatched' || link.targetMainNodeId === undefined,
      dibburDomKey: dibbur ? wordDomKey(dibbur.lineKey, dibbur.wordIndexInLine) : null,
      targetDomKey: target ? wordDomKey(target.lineKey, target.wordIndexInLine) : null,
      dibburText: link.dibburText,
      targetText: link.matchedText,
    });
  }
  return out;
}

/** Gentle cubic curve between two word centres (SVG path `d`, in px). */
export function buildConnectorPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const bend = Math.max(18, Math.abs(dy) * 0.35);
  const cx1 = x1 + dx * 0.25;
  const cy1 = y1 - bend * (dy >= 0 ? 1 : -1) * 0.25;
  const cx2 = x2 - dx * 0.25;
  const cy2 = y2 + bend * (dy >= 0 ? 1 : -1) * 0.25;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/**
 * Click-to-re-anchor (pure): returns a new link list with the dibbur of
 * `commentaryUnitId` re-anchored to the user-clicked phrase. A
 * user-picked anchor is exact by definition (confidence 1.0, method
 * 'exact'); it replaces any existing link for the same commentary unit
 * and never invents a target when none was clicked.
 */
export function reAnchorLink(
  links: AnchorLink[],
  commentaryUnitId: string,
  targetMainNodeId: string,
  targetCharOffset: number,
  dibburText: string
): AnchorLink[] {
  const next: AnchorLink = {
    linkId: `anchor-${commentaryUnitId}`,
    commentaryUnitId,
    dibburText,
    targetMainNodeId,
    targetCharOffset,
    linkConfidence: 1,
    method: 'exact',
    dibburSource: 'source-match',
  };
  const rest = links.filter(l => l.commentaryUnitId !== commentaryUnitId);
  return [...rest, next];
}

/**
 * Stamps a re-anchored link back onto the units: the commentary unit
 * carries the new `anchorLink`; the target source unit gains the
 * commentary id in `anchoredCommentaryIds` (same-page gravity, Phase 4).
 * Returns new unit objects; the input list is untouched.
 */
export function applyReAnchorToUnits(
  units: ContentUnit[],
  link: AnchorLink
): ContentUnit[] {
  return units.map(u => {
    if (u.id === link.commentaryUnitId) {
      return { ...u, anchorLink: link, linkedSourceId: link.targetMainNodeId };
    }
    if (u.id === link.targetMainNodeId) {
      const ids = u.anchoredCommentaryIds ?? [];
      if (ids.includes(link.commentaryUnitId)) return u;
      return { ...u, anchoredCommentaryIds: [...ids, link.commentaryUnitId] };
    }
    return u;
  });
}
