/**
 * Layout training T2.1 — the Vilna Shas running head.
 *
 * Rules (from the user's annotated Vilna 2a page, items 1–4, and the
 * Chagiga 2a–4a scans in the training set):
 *  1. Centre of the head: the PEREK NAME (usually the first two words of
 *     the perek), then "פרק" + the perek number in words (ראשון, שני …),
 *     then the MASECHTA name — e.g. "הכל חייבין   פרק ראשון   חגיגה".
 *     The centre text is the same on both amudim.
 *  2. The folio (ב. / ב: / ג. …) sits in the head on the OUTER corner:
 *     amud a is the LEFT-hand page of a Hebrew spread (binding on its
 *     right), so its folio is on the left; amud b is the right-hand
 *     page, so its folio is on the right.
 *  3. The head is set larger than the Gemara, in the Gemara face; the
 *     folio is bold.
 *  4. No rule under the head, no continuation notes ("המשך …").
 *
 * The engine lays the head out completely — every word is measured with
 * the same shaper the body text uses — and stores it on the page in
 * PHYSICAL page coordinates (pt from the page's top-left). Renderers
 * (screen, canvas PDF, vector PDF) only draw the words where they are,
 * so all outputs agree and no renderer guesses widths.
 */
import type { ContentUnit, PageTypesetResult, VilnaHeaderGeom, VilnaHeaderItem } from '../types/typesetter';
import { textBlockLeft, textBlockRight } from '../types/typesetter';
import type { RunningHeaderSettings } from '../types/design-settings';
import { HarfBuzzShaperEngine } from './harfbuzz-emulator';

/** Perek ordinals as printed in the Vilna head (Shabbat has 24 perakim). */
const PEREK_ORDINALS = [
  '',
  'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי',
  'אחד עשר', 'שנים עשר', 'שלשה עשר', 'ארבעה עשר', 'חמשה עשר', 'ששה עשר', 'שבעה עשר',
  'שמונה עשר', 'תשעה עשר', 'עשרים', 'עשרים ואחד', 'עשרים ושנים', 'עשרים ושלשה', 'עשרים וארבעה',
];

export function perekOrdinalHe(n: number): string {
  return PEREK_ORDINALS[n] ?? String(n);
}

const ORDINAL_TO_NUMBER = new Map<string, number>(
  PEREK_ORDINALS.map((w, i) => [w, i] as [string, number]).filter(([w]) => w)
);
const LETTER_VALUES: Record<string, number> = {
  א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ל: 30,
};

/** Words that open a section but are not part of the perek name. */
const MARKER_WORDS = /^(?:מתני[׳']?|מתניתין|גמ[׳']?|גמרא)[:.]?$/;

const stripPunct = (w: string) => w.replace(/[.,:;!?()[\]"'״׳–—-]+$/g, '').replace(/^[(["'״׳]+/, '');

/** First `count` words of a unit's text, skipping מתני׳ / גמ׳ markers. */
export function leadingWords(text: string, count = 2): string {
  const words = text
    .replace(/[֑-֯]/g, '') // drop cantillation, keep nikud as typed
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !MARKER_WORDS.test(w))
    .map(stripPunct)
    .filter(Boolean);
  return words.slice(0, count).join(' ');
}

/**
 * Parse a chapter heading such as "פרק ראשון — מאימתי", "פרק א: מאימתי",
 * "פרק שני הכל חייבין". Returns null when the text is not a perek heading.
 */
export function parsePerekHeading(text: string): { number?: number; name?: string } | null {
  const t = text.replace(/[֑-ׇ]/g, '').replace(/\s+/g, ' ').trim();
  const m = /(?:^|\s)פרק\s+([^\s:—–\-,.]+(?:\s+עשר)?)\s*[:—–\-,.]?\s*(.*)$/.exec(t);
  if (!m) return null;
  const numWord = m[1].replace(/[״׳"']/g, '');
  let number = ORDINAL_TO_NUMBER.get(m[1]) ?? ORDINAL_TO_NUMBER.get(numWord);
  if (number === undefined && /^[א-ל]{1,2}$/.test(numWord)) {
    number = [...numWord].reduce((s, ch) => s + (LETTER_VALUES[ch] ?? 0), 0) || undefined;
  }
  const name = m[2].replace(/^[:—–\-,.\s]+/, '').trim();
  return { number, name: name || undefined };
}

export interface PerekInfo {
  number: number;
  nameHe: string;
}

/**
 * Assign every unit to a perek, in reading order.
 *  - The book starts in perek 1.
 *  - A `chapter` / `heading` unit that reads as a perek heading starts a
 *    perek (its number and name are taken from the heading).
 *  - A Gemara unit containing "הדרן עלך" closes the current perek; the
 *    next Gemara unit starts the next one.
 *  - Perek name: the heading's name, else the first unit's `chapterTitle`,
 *    else the first two words of the perek's first Gemara unit.
 */
export function derivePerakim(units: ContentUnit[]): Map<string, PerekInfo> {
  const byUnit = new Map<string, PerekInfo>();
  let current: PerekInfo | null = null;
  let pendingHeading: { number?: number; name?: string } | null = null;
  let closeAfter = false;
  let nextNumber = 1;
  for (const u of units) {
    if (u.role === 'chapter' || u.role === 'heading') {
      const parsed = parsePerekHeading(u.rawText);
      if (parsed) {
        pendingHeading = parsed;
        closeAfter = true;
      }
      if (current) byUnit.set(u.id, current);
      continue;
    }
    if (u.role !== 'main_source') {
      if (current) byUnit.set(u.id, current);
      continue;
    }
    if (!current || closeAfter) {
      const number = pendingHeading?.number ?? nextNumber;
      const nameHe =
        pendingHeading?.name?.trim() ||
        (u.chapterTitle ?? '').trim() ||
        leadingWords(u.rawText, 2);
      current = { number, nameHe };
      nextNumber = number + 1;
      pendingHeading = null;
      closeAfter = false;
    }
    byUnit.set(u.id, current);
    if (/הדרן\s+עלך/.test(u.rawText)) closeAfter = true;
  }
  return byUnit;
}

export interface VilnaHeaderOptions {
  /** Masechta name; empty → the document title without a leading "מסכת". */
  masechet: string;
  /** Manual overrides (RunningHeaderSettings.perekTitleText / perekNumberText). */
  perekNameOverride?: string;
  perekNumberOverride?: string;
  folioText: string;
  /** Amud a (left-hand page) → folio on the left; amud b → right. */
  pageSide: 'left' | 'right';
  fontFamily: string;
  fontSizePt: number;
  /** Talmud: the head sits over the Gemara + Rashi + Tosafot block, this far in from each side of the text area. */
  blockInsetPt?: number;
}

function measure(shaper: HarfBuzzShaperEngine, text: string, bold: boolean): number {
  return shaper.shapeWord(text, { isBold: bold }).width;
}

/**
 * Lay out the head for one page. Coordinates are physical page points:
 * the text block spans [textBlockLeft, textBlockRight] (mirrored per page),
 * the same frame every renderer uses for the body.
 */
export function layoutVilnaHeader(page: PageTypesetResult, perek: PerekInfo | undefined, opts: VilnaHeaderOptions): VilnaHeaderGeom {
  const perekName = (opts.perekNameOverride ?? '').trim() || perek?.nameHe || '';
  const perekNumber =
    (opts.perekNumberOverride ?? '').trim() || (perek ? perekOrdinalHe(perek.number) : '');
  const parts = [perekName, perekNumber ? `פרק ${perekNumber}` : '', opts.masechet];
  const geom = layoutHeaderParts(page, parts, opts.folioText, opts.pageSide, opts.fontFamily, opts.fontSizePt, opts.blockInsetPt ?? 0);
  return { ...geom, perekNumber: perek?.number, perekName, masechet: opts.masechet };
}

/**
 * Lay out a running head from its parts (centred, measured word by word)
 * plus the folio on the OUTER corner. Shared by the Vilna head
 * (perek · פרק N · masechta) and the Chumash head (sefer · perek).
 * Physical page coordinates; the text block is mirrored per page.
 */
export function layoutHeaderParts(
  page: PageTypesetResult,
  rawParts: string[],
  folioText: string,
  pageSide: 'left' | 'right',
  fontFamily: string,
  fontSizePt: number,
  blockInsetPt = 0
): VilnaHeaderGeom {
  const g = page.geometry;
  const left = textBlockLeft(g) + blockInsetPt;
  const right = textBlockRight(g) - blockInsetPt;
  const size = fontSizePt;
  // Baseline sits just above the text block; never closer to the paper
  // edge than one line of the head itself.
  const yBaseline = Math.max(size * 1.05, g.marginTop - Math.max(5, size * 0.45));
  const shaper = new HarfBuzzShaperEngine(size, fontFamily, 400);
  const space = size * 0.3;
  const partGap = size * 1.1;
  const parts = rawParts.filter(p => p && p.trim());
  const items: VilnaHeaderItem[] = [];
  if (parts.length > 0) {
    const measured = parts.map(p =>
      p.split(/\s+/).filter(Boolean).map(w => ({ text: w, width: measure(shaper, w, false) }))
    );
    const total =
      measured.reduce((s, ws) => s + ws.reduce((a, w) => a + w.width, 0) + space * Math.max(0, ws.length - 1), 0) +
      partGap * Math.max(0, measured.length - 1);
    let x = (left + right) / 2 + total / 2;
    const words: VilnaHeaderItem['words'] = [];
    measured.forEach((ws, pi) => {
      ws.forEach((w, wi) => {
        words.push({ text: w.text, xLeft: x - w.width, xRight: x });
        x -= w.width + (wi < ws.length - 1 ? space : 0);
      });
      if (pi < measured.length - 1) x -= partGap;
    });
    items.push({
      kind: 'title',
      words,
      xLeft: Math.min(...words.map(w => w.xLeft)),
      xRight: Math.max(...words.map(w => w.xRight)),
      yBaseline,
      fontSizePt: size,
      fontWeight: 400,
      fontFamily,
    });
  }
  if (folioText.trim()) {
    const w = measure(shaper, folioText, true);
    const xLeft = pageSide === 'left' ? left : right - w;
    items.push({
      kind: 'folio',
      words: [{ text: folioText, xLeft, xRight: xLeft + w }],
      xLeft,
      xRight: xLeft + w,
      yBaseline,
      fontSizePt: size,
      fontWeight: 700,
      fontFamily,
    });
  }
  return { items, perekName: parts[0] ?? '', masechet: parts[parts.length - 1] ?? '', folio: folioText };
}

/**
 * Masechta name for the head: the explicit setting; else a "מסכת X"
 * heading in the text (e.g. "מסכת ברכות — פרק ראשון"); else a title that
 * names the masechta ("מסכת ברכות" → ברכות); else the title as is.
 */
export function resolveMasechetName(
  rh: Partial<RunningHeaderSettings> | undefined | null,
  title: string,
  units: ContentUnit[] = []
): string {
  const explicit = (rh?.masechetName ?? '').trim();
  if (explicit) return explicit;
  const strip = (t: string) => t.replace(/[\u0591-\u05C7]/g, '');
  for (const u of units) {
    if (u.role !== 'chapter' && u.role !== 'heading' && u.role !== 'main_title' && u.role !== 'subtitle') continue;
    const m = /מסכת\s+([^\s:—–\-,.]+(?:\s+(?:קמא|מציעא|בתרא|שני|ראשון))?)/.exec(strip(u.rawText));
    if (m) return m[1];
  }
  const t = /מסכת\s+(.+)/.exec(strip(title));
  if (t) return t[1].trim();
  return title.trim();
}

/** Default head size: a little larger than the Gemara (Vilna ≈ 1.3×). */
export function defaultVilnaHeaderSizePt(gemaraSizePt: number): number {
  return Math.round(gemaraSizePt * 1.3 * 10) / 10;
}

/**
 * Catchword (custos) — the first word of the next page, printed at the
 * foot of the page under the left column, as in the old prints (the
 * user's Kedushat Levi editions). Returned as a head item, so every
 * renderer that draws the running head draws it too.
 */
export function layoutCatchword(
  page: PageTypesetResult,
  word: string,
  fontFamily: string,
  fontSizePt: number
): VilnaHeaderItem | null {
  const text = word.trim();
  if (!text) return null;
  const g = page.geometry;
  const left = textBlockLeft(g);
  const shaper = new HarfBuzzShaperEngine(fontSizePt, fontFamily, 400);
  const w = measure(shaper, text, false);
  const yBaseline = g.pageHeight - g.marginBottom + Math.max(fontSizePt * 1.25, Math.min(g.marginBottom * 0.55, fontSizePt * 2));
  return {
    kind: 'title',
    words: [{ text, xLeft: left, xRight: left + w }],
    xLeft: left,
    xRight: left + w,
    yBaseline,
    fontSizePt,
    fontWeight: 400,
    fontFamily,
  };
}

/**
 * Two-column Chassidic sefer head (the user's Kedushat Levi prints):
 * the book title is split over the two columns — its first word(s) over
 * the first (right) column, the rest over the second (left) column — the
 * page's topic (parsha, Yom Tov …) in the centre, and the folio on the
 * outer corner:
 *
 *     ┌ קדושת            פרשת נח            לוי   ד ┐
 *       (right column)   (centre)   (left column)
 */
export function layoutSplitTitleHeader(
  page: PageTypesetResult,
  title: string,
  topic: string,
  folioText: string,
  pageSide: 'left' | 'right',
  fontFamily: string,
  fontSizePt: number,
  columnGapPt: number
): VilnaHeaderGeom {
  const g = page.geometry;
  const left = textBlockLeft(g);
  const right = textBlockRight(g);
  const colW = (right - left - columnGapPt) / 2;
  const size = fontSizePt;
  // the print's gap between the head and the columns (about 0.7 of the head size)
  const yBaseline = Math.max(size * 1.05, g.marginTop - Math.max(6, size * 0.7));
  const shaper = new HarfBuzzShaperEngine(size, fontFamily, 400);
  const space = size * 0.3;
  const items: VilnaHeaderItem[] = [];
  const place = (text: string, centre: number, bold: boolean, kind: 'title' | 'folio' = 'title') => {
    const ws = text.split(/\s+/).filter(Boolean).map(w => ({ text: w, width: measure(shaper, w, bold) }));
    if (!ws.length) return;
    const total = ws.reduce((s, w) => s + w.width, 0) + space * (ws.length - 1);
    let x = centre + total / 2;
    const words: VilnaHeaderItem['words'] = [];
    for (const w of ws) {
      words.push({ text: w.text, xLeft: x - w.width, xRight: x });
      x -= w.width + space;
    }
    items.push({ kind, words, xLeft: Math.min(...words.map(w => w.xLeft)), xRight: Math.max(...words.map(w => w.xRight)), yBaseline, fontSizePt: size, fontWeight: bold ? 700 : 400, fontFamily });
  };
  const tw = title.split(/\s+/).filter(Boolean);
  const cut = Math.ceil(tw.length / 2);
  place(tw.slice(0, cut).join(' '), right - colW / 2, true); // over the first (right) column
  place(tw.slice(cut).join(' '), left + colW / 2, true); // over the second (left) column
  const plainTopic = topic.replace(/[֑-ׇ]/g, '').trim();
  if (plainTopic && plainTopic !== title.replace(/[֑-ׇ]/g, '').trim()) place(topic, (left + right) / 2, false);
  if (folioText.trim()) {
    const w = measure(shaper, folioText, true);
    const xLeft = pageSide === 'left' ? left : right - w;
    items.push({ kind: 'folio', words: [{ text: folioText, xLeft, xRight: xLeft + w }], xLeft, xRight: xLeft + w, yBaseline, fontSizePt: size, fontWeight: 700, fontFamily });
  }
  return { items, perekName: topic, masechet: title, folio: folioText };
}
