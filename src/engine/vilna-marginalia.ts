/**
 * Layout training T2.4 — the Vilna marginal apparatus as SIDE COLUMNS.
 *
 * Rule 9 of the annotated daf, and the 8 measured Vilna reference pages
 * (scripts/training/measure_reference_pdf.py):
 *  - a narrow column runs down each side of the page, ≈ 10.5% of the
 *    text block wide, set at ≈ 0.56 × the Gemara size;
 *  - OUTER column: עין משפט נר מצוה (top), then רבינו חננאל / ר״ן;
 *  - INNER column (binding side): מסורת הש״ס (top), תורה אור,
 *    הגהות הב״ח, גליון הש״ס;
 *  - every section opens with its title, and sections after the first
 *    are divided by a small flourish;
 *  - a note sits on the page of the Gemara it belongs to.
 *
 * The page's inner side is the binding side: amud a (left-hand page of a
 * Hebrew spread) binds on its RIGHT, so its inner column is on the right.
 */
import type { ContentUnit, TypesetLine } from '../types/typesetter';

export type MarginSide = 'inner' | 'outer';

interface KindMeta {
  side: MarginSide;
  order: number;
  titleHe: string;
  patterns: RegExp[];
}

export const MARGINAL_KINDS: Record<string, KindMeta> = {
  ein_mishpat: { side: 'outer', order: 0, titleHe: 'עין משפט נר מצוה', patterns: [/עין\s*משפט/, /ein[_\s-]*mishpat/i] },
  ner_mitzvah: { side: 'outer', order: 0, titleHe: 'עין משפט נר מצוה', patterns: [/נר\s*מצוה/, /ner[_\s-]*mitzvah/i] },
  rabbeinu_chananel: { side: 'outer', order: 1, titleHe: 'רבינו חננאל', patterns: [/רבינו\s*חננאל/, /chananel/i] },
  ran: { side: 'outer', order: 2, titleHe: 'ר״ן', patterns: [/^ר["״']?ן$/, /\bran\b/i] },
  masoret_hashas: { side: 'inner', order: 0, titleHe: 'מסורת הש״ס', patterns: [/מסורת\s*הש["״']?ס/, /masoret/i] },
  torah_or: { side: 'inner', order: 1, titleHe: 'תורה אור', patterns: [/תורה\s*אור/, /torah[_\s-]*or\b/i] },
  hagahot_habach: { side: 'inner', order: 2, titleHe: 'הגהות הב״ח', patterns: [/הגהות\s*הב["״']?ח/, /habach/i] },
  gilyon_hashas: { side: 'inner', order: 3, titleHe: 'גליון הש״ס', patterns: [/גליון\s*הש["״']?ס/, /gilyon/i] },
};

/** Roles the apparatus is made of (see PaginationEngine.RAV_TERTIARY_ROLES). */
const MARGINAL_ROLES = new Set(['tertiary_comment', 'side_note', 'cross_reference']);

/** Which apparatus a unit belongs to — by its style name only (never guessed from body text). */
export function classifyMarginal(unit: ContentUnit): string | null {
  if (!MARGINAL_ROLES.has(unit.role)) return null;
  const hay = `${unit.styleName || ''}`;
  for (const [kind, meta] of Object.entries(MARGINAL_KINDS)) {
    if (meta.patterns.some(rx => rx.test(hay))) return kind;
  }
  // Unlabelled: side notes are Gilyon-type notes (inner); other
  // cross-references are halachic sources (Ein Mishpat, outer).
  return unit.role === 'side_note' ? 'gilyon_hashas' : 'ein_mishpat';
}

export interface MarginalItem {
  unitId: string;
  kind: string;
  side: MarginSide;
  /** Index of the Gemara unit the note belongs to (document order). */
  anchorSourceIdx: number;
}

/**
 * Anchor each apparatus unit to a Gemara unit: its explicit
 * `linkedSourceId`, else the nearest Gemara unit BEFORE it in the
 * document (importers keep each note after the Gemara it annotates).
 */
export function planMarginalItems(units: ContentUnit[]): MarginalItem[] {
  const sourceIdx = new Map<string, number>();
  let si = 0;
  for (const u of units) if (u.role === 'main_source') sourceIdx.set(u.id, si++);
  const items: MarginalItem[] = [];
  let lastSource = 0;
  for (const u of units) {
    if (u.role === 'main_source') {
      lastSource = sourceIdx.get(u.id) ?? lastSource;
      continue;
    }
    const kind = classifyMarginal(u);
    if (!kind) continue;
    const anchor = (u.linkedSourceId ? sourceIdx.get(u.linkedSourceId) : undefined) ?? lastSource;
    items.push({ unitId: u.id, kind, side: MARGINAL_KINDS[kind].side, anchorSourceIdx: anchor });
  }
  return items;
}

export interface MarginalColumnGeometry {
  /** Column width in pt. */
  widthPt: number;
  /** Gap between the column and the commentary next to it. */
  gapPt: number;
  fontSizePt: number;
  lineHeightPt: number;
}

export function marginalColumnGeometry(contentWidthPt: number, gemaraSizePt: number): MarginalColumnGeometry {
  const fontSizePt = Math.round(gemaraSizePt * 0.56 * 10) / 10;
  return {
    widthPt: Math.round(contentWidthPt * 0.105),
    gapPt: Math.max(5, Math.round(gemaraSizePt * 0.45)),
    fontSizePt,
    lineHeightPt: Math.round(fontSizePt * 1.18 * 10) / 10,
  };
}

/** One queued apparatus item, already broken into lines at the column width. */
export interface QueuedMarginal {
  item: MarginalItem;
  lines: TypesetLine[];
  /** Lines already placed on earlier pages. */
  placed: number;
}

/**
 * Stack one side's due items into its column for one page. Lines are
 * returned in CONTENT coordinates of the full page (x in
 * [colLeft, colRight], y from the top of the text block). Items that do
 * not fit stay in the queue (partially placed items continue on the
 * next page under their section title).
 */
export function stackMarginalColumn(
  queue: QueuedMarginal[],
  dueSourceIdx: number,
  colLeft: number,
  colRight: number,
  maxY: number,
  geom: MarginalColumnGeometry,
  makeTitle: (text: string) => TypesetLine | null
): TypesetLine[] {
  const out: TypesetLine[] = [];
  const due = queue
    .filter(q => q.item.anchorSourceIdx <= dueSourceIdx && q.placed < q.lines.length)
    .sort((a, b) => MARGINAL_KINDS[a.item.kind].order - MARGINAL_KINDS[b.item.kind].order || a.item.anchorSourceIdx - b.item.anchorSourceIdx);
  let y = 0;
  let lastTitle = '';
  const place = (src: TypesetLine, opts?: { flourishAfter?: boolean }): boolean => {
    const h = geom.lineHeightPt;
    if (y + h > maxY) return false;
    // Glyph box at the column's own size (the shaper's ascent/descent
    // can come from a larger role size); it always fits inside the pitch.
    const ascent = geom.fontSizePt * 0.8;
    const descent = Math.min(geom.fontSizePt * 0.24, h - ascent - 0.2);
    const l: TypesetLine = { ...src, words: src.words.map(w => ({ ...w })) };
    l.ascent = ascent;
    l.descent = descent;
    l.height = h;
    l.yBaseline = y + ascent;
    l.yTop = y;
    l.yBottom = y + ascent + descent;
    l.xLeft = colLeft;
    l.xRight = colRight;
    l.targetWidth = colRight - colLeft;
    if (opts?.flourishAfter) {
      l.unitBoundaryAfter = true;
      l.separatorStyleIdOverride = 'scrolled_divider';
    }
    out.push(l);
    y += h;
    return true;
  };
  for (const q of due) {
    const title = MARGINAL_KINDS[q.item.kind].titleHe;
    if (title !== lastTitle) {
      if (out.length > 0) {
        // Flourish between sections: on the previous section's last line.
        const prev = out[out.length - 1];
        prev.unitBoundaryAfter = true;
        prev.separatorStyleIdOverride = 'scrolled_divider';
        y += geom.lineHeightPt * 0.9;
      }
      const t = makeTitle(title);
      // A title is never left alone at the foot of the column.
      if (y + geom.lineHeightPt * 2 > maxY) break;
      if (t && !place(t)) break;
      lastTitle = title;
    }
    while (q.placed < q.lines.length) {
      if (!place(q.lines[q.placed])) return out;
      q.placed++;
    }
  }
  return out;
}
