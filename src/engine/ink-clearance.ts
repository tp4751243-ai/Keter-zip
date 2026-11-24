/**
 * Layout training T9 — ink clearance between lines (nikkud and teamim).
 *
 * Line spacing is set from the font SIZE, but pointed and cantillated
 * Hebrew inks far above and below the letters: a zarka or pashta sits
 * above the cap height, a tipcha / merkha / dagesh-under-vowel hangs below
 * the baseline. When the line pitch is too tight the marks of one line
 * touch the marks of the next.
 *
 * `measureInk` reads the real glyph extents (canvas
 * actualBoundingBoxAscent / Descent — the same measuring path the engine
 * uses for widths); `lineInk` gives a line's extremes; `clearanceIssues`
 * finds consecutive lines in the same column whose ink overlaps;
 * `requiredPitch` gives the smallest pitch that keeps `minGapPt` between
 * every pair.
 */
import type { TypesetLine } from '../types/typesetter';

let ctx: CanvasRenderingContext2D | null = null;
let currentFont = '';
const cache = new Map<string, { ascent: number; descent: number }>();

function context(): CanvasRenderingContext2D | null {
  if (ctx) return ctx;
  try {
    const c = (globalThis as { document?: Document }).document?.createElement('canvas');
    ctx = (c?.getContext('2d') as CanvasRenderingContext2D) ?? null;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Ink above / below the baseline of one word, in pt. */
/**
 * Ink above / below the baseline of one word, in pt. Measured per
 * grapheme cluster (a letter with its nikkud and teamim), cached per font:
 * a whole book has tens of thousands of distinct words but only a few
 * thousand distinct clusters, and a cluster inks the same in every word.
 */
export function measureInk(text: string, fontFamily: string, sizePt: number, weight = 400): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  for (const cl of clusters(text)) {
    const ink = measureCluster(cl, fontFamily, sizePt, weight);
    if (ink.ascent > ascent) ascent = ink.ascent;
    if (ink.descent > descent) descent = ink.descent;
  }
  return { ascent, descent };
}

const MARK = /[\u0591-\u05C7\u05BF]/;
function clusters(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (out.length && MARK.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

function measureCluster(text: string, fontFamily: string, sizePt: number, weight: number): { ascent: number; descent: number } {
  const key = `${fontFamily}|${sizePt}|${weight}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = context();
  let r = { ascent: sizePt * 0.8, descent: sizePt * 0.25 };
  if (c) {
    // Setting ctx.font parses the string: only when it changes.
    const font = `${weight} ${sizePt}px "${fontFamily}"`;
    if (font !== currentFont) {
      c.font = font;
      currentFont = font;
    }
    const m = c.measureText(text);
    if (Number.isFinite(m.actualBoundingBoxAscent) && Number.isFinite(m.actualBoundingBoxDescent)) {
      r = { ascent: Math.max(0, m.actualBoundingBoxAscent), descent: Math.max(0, m.actualBoundingBoxDescent) };
    }
  }
  if (cache.size > 50000) cache.clear();
  cache.set(key, r);
  return r;
}

/** Highest ink above and lowest ink below the baseline of a line. */
const lineCache = new WeakMap<TypesetLine['words'], { ascent: number; descent: number }>();
export function lineInk(line: TypesetLine, defaultFamily = 'Frank Ruhl Libre', defaultSize = 12): { ascent: number; descent: number } {
  const hit = lineCache.get(line.words);
  if (hit) return hit;
  const r = lineInkUncached(line, defaultFamily, defaultSize);
  lineCache.set(line.words, r);
  return r;
}

const wordCache = new WeakMap<object, { ascent: number; descent: number }>();
function lineInkUncached(line: TypesetLine, defaultFamily: string, defaultSize: number): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  for (const w of line.words) {
    if (w.isSpace || !w.text.trim()) continue;
    // Word objects are reused across layout attempts: cache on the object.
    let ink = wordCache.get(w);
    if (!ink) {
      ink = measureInk(
        w.text,
        w.fontFamily || line.fontFamily || defaultFamily,
        w.fontSizePt ?? line.fontSizePt ?? defaultSize,
        w.fontWeight ?? (w.isBold ? 700 : line.fontWeight ?? 400)
      );
      wordCache.set(w, ink);
    }
    ascent = Math.max(ascent, ink.ascent);
    descent = Math.max(descent, ink.descent);
  }
  return { ascent, descent };
}

export interface ClearanceIssue {
  upper: TypesetLine;
  lower: TypesetLine;
  /** Gap between the lower ink of the upper line and the upper ink of the lower one (negative = overlap). */
  gapPt: number;
}

/**
 * Consecutive lines that share horizontal space (same column) and whose
 * ink comes closer than `minGapPt`.
 */
export function clearanceIssues(lines: TypesetLine[], minGapPt = 0.3): ClearanceIssue[] {
  const ls = lines
    .filter(l => l.words.some(w => !w.isSpace && w.text.trim()))
    .slice()
    .sort((a, b) => a.yBaseline - b.yBaseline);
  const out: ClearanceIssue[] = [];
  for (let i = 0; i < ls.length; i++) {
    const a = ls[i];
    // the nearest following line that overlaps horizontally
    for (let j = i + 1; j < ls.length; j++) {
      const b = ls[j];
      const ax0 = a.xLeft ?? 0, ax1 = a.xRight ?? a.targetWidth;
      const bx0 = b.xLeft ?? 0, bx1 = b.xRight ?? b.targetWidth;
      if (Math.min(ax1, bx1) - Math.max(ax0, bx0) <= 1) continue;
      if (b.yBaseline - a.yBaseline < 0.5) continue;
      const gap = b.yBaseline - lineInk(b).ascent - (a.yBaseline + lineInk(a).descent);
      if (gap < minGapPt) out.push({ upper: a, lower: b, gapPt: gap });
      break;
    }
  }
  return out;
}

/** Smallest line pitch that keeps `minGapPt` of white between every consecutive pair. */
export function requiredPitch(lines: TypesetLine[], minGapPt = 0.6): number {
  let need = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    need = Math.max(need, lineInk(lines[i]).descent + lineInk(lines[i + 1]).ascent + minGapPt);
  }
  return need;
}
