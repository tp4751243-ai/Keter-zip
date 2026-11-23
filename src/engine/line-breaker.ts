/**
 * Layout training T10 — optimal line breaking and glyph stretching.
 *
 * 1. `optimalBreaks` — total-fit line breaking after Knuth & Plass,
 *    "Breaking Paragraphs into Lines" (Software: Practice and Experience
 *    11, 1981), reduced to what Hebrew sefarim need: no hyphenation (a
 *    Hebrew word is never split), spaces stretch freely (a typeset Hebrew
 *    line's spaces shrink at most 20% — a narrow column needs that room),
 *    and lines may
 *    have different widths (first-line indent). Every break of a
 *    paragraph is chosen together, so one tight line no longer forces a
 *    very loose one after it — the cause of the wide gaps the first-fit
 *    breaker left (Vilna scorecard L2).
 *
 *    Cost of a line: badness = 100·r³ where r = (extra space) ÷ (space
 *    stretch); demerits = (10 + badness)². A last line is free unless it
 *    is a single word after a longer paragraph (a one-word tail).
 *
 * 2. `applyGlyphStretch` — before word spaces open wide, the words of a
 *    justified line are widened by at most `maxPct` (2.5% by default,
 *    the classic 97–103% glyph-scaling range). Renderers fit each word to
 *    its solved width, so the stretch is drawn exactly as computed.
 */
import type { ShapedWord, TypesetLine } from '../types/typesetter';

export interface BreakOptions {
  /** How far a space may stretch before badness 100 (×natural space). */
  stretchRatio?: number;
  /** Demerits added for a one-word last line when the paragraph has more. */
  tailPenalty?: number;
  /** How far a space may shrink (×natural space; 0.2 → down to 80%). */
  shrinkRatio?: number;
}

/**
 * Choose line ends for words[0..n-1].
 * @param widths   word widths
 * @param spaceBefore space width before word i (i ≥ 1)
 * @param avail    available width for a line that STARTS at word a
 * @param forcedAfter word indices after which a line must end
 * @returns indices of the last word of every line (ascending; last = n-1)
 */
export function optimalBreaks(
  widths: number[],
  spaceBefore: (i: number) => number,
  avail: (a: number) => number,
  forcedAfter: Set<number> = new Set(),
  opts: BreakOptions = {}
): number[] {
  const n = widths.length;
  if (n === 0) return [];
  const stretchRatio = opts.stretchRatio ?? 1.0;
  const tailPenalty = opts.tailPenalty ?? 4000;
  const shrinkRatio = opts.shrinkRatio ?? 0.2;
  // best[p]: least demerits for setting words[0..p-1]; from[p]: start of its last line
  const best = new Array<number>(n + 1).fill(Infinity);
  const from = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let a = 0; a < n; a++) {
    if (!Number.isFinite(best[a])) continue;
    const W = avail(a);
    let L = 0;
    let stretch = 0;
    let shrink = 0;
    for (let b = a; b < n; b++) {
      if (b > a) {
        const s = spaceBefore(b);
        L += s;
        stretch += s * stretchRatio;
        shrink += s * shrinkRatio;
      }
      L += widths[b];
      const last = b === n - 1 || forcedAfter.has(b);
      let badness: number;
      if (L > W + 0.01) {
        if (b > a && (last || L - W > shrink)) break; // spaces shrink at most shrinkRatio; a last line never
        if (b === a) badness = 10000; // a single over-wide word must still go somewhere
        else {
          const r = (L - W) / shrink;
          badness = 100 * r * r * r;
        }
      } else if (last) {
        badness = 0;
      } else if (stretch <= 0) {
        badness = 10000; // one word on a justified line: cannot be spread
      } else {
        const r = (W - L) / stretch;
        badness = Math.min(10000, 100 * r * r * r);
      }
      let d = (10 + badness) ** 2;
      // a one-word last line after a longer paragraph (a tail)
      if (last && b === a && a > 0 && !forcedAfter.has(a - 1)) d += tailPenalty;
      if (best[a] + d < best[b + 1]) {
        best[b + 1] = best[a] + d;
        from[b + 1] = a;
      }
      if (last) break;
    }
  }
  // Walk back from the end.
  const ends: number[] = [];
  let p = n;
  while (p > 0) {
    const a = from[p];
    if (a < 0) {
      // Unreachable (should not happen): fall back to one word per line.
      return widths.map((_, i) => i);
    }
    ends.push(p - 1);
    p = a;
  }
  return ends.reverse();
}

/**
 * Widen the words of a justified line (at most `maxPct`) so its spaces
 * stay closer to `targetGapRatio` × the natural space. Words are copied,
 * never mutated (they may be shared with a shaping cache).
 */
export function applyGlyphStretch(line: TypesetLine, naturalSpace: number, maxPct = 2.5, targetGapRatio = 1.35): void {
  if (!line.isJustified || line.isLastLine) return;
  const real = line.words.filter(w => !w.isSpace && w.text.trim());
  if (real.length < 2) return;
  const gaps = real.length - 1;
  const wordsW = real.reduce((s, w) => s + w.width, 0);
  const T = line.targetWidth;
  const gap = (T - wordsW) / gaps;
  const comfortable = naturalSpace * targetGapRatio;
  if (gap <= comfortable) return;
  const want = (gap - comfortable) * gaps;
  const add = Math.min(want, wordsW * (maxPct / 100));
  if (add <= 0.05) return;
  const f = 1 + add / wordsW;
  line.words = line.words.map(w => (w.isSpace || !w.text.trim() ? w : ({ ...w, width: w.width * f, glyphStretch: f } as ShapedWord)));
  const spaceCount = Math.max(1, line.words.filter(w => w.isSpace).length);
  const spacesW = line.words.filter(w => w.isSpace).reduce((s, w) => s + w.width, 0);
  line.extraSpacePerWord = Math.max(0, (T - wordsW * f - spacesW) / spaceCount);
}
