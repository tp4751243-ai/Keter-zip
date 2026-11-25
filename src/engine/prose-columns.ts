/**
 * Layout training T8 — two-column prose pages (Mussar, Machshava,
 * Halacha prose, any plain sefer set in two columns).
 *
 * Replaces the old line-count pager, which split a page's lines in half
 * (headings ended up inside a column, columns were unbalanced, and
 * indented first lines spilled into the gutter because lines carried no
 * column box). The reference is the user's Mesilat Yesharim page:
 *
 *   ┌──────────── book · perek ─────────────── folio (outer) ┐
 *   │                 מסילת ישרים   (title, full width)       │
 *   │                    פרק א      (perek, full width)       │
 *   │       בבאור כלל חובת האדם בעולמו   (subtitle)          │
 *   │  column 2 (left)        │  column 1 (right, read first) │
 *   │  …                      │  יסוד החסידות …                │
 *   └─────────────────────────┴───────────────────────────────┘
 *
 * Rules:
 *  - Title / perek / subtitle / heading units SPAN both columns, centred.
 *  - Body text between two spanning blocks is one run: when the rest of
 *    the run fits on the page it is BALANCED (both columns equal height);
 *    otherwise the right column fills, then the left, and the run carries
 *    on at the top of the next page.
 *  - A heading never ends a column or a page: it moves with at least two
 *    lines of the text that follows it.
 *  - No orphan (a paragraph's first line alone at a column foot) and no
 *    widow (its last line alone at a column head) when it can be avoided.
 *  - Every line carries its exact column box (xLeft / xRight), so every
 *    renderer draws it inside its column, indents included.
 *  - Footnotes of a paragraph go to the foot of the page where the
 *    paragraph starts, full width.
 */
import type {
  BookTypesetDocument,
  ContentUnit,
  DynamicKneeContour,
  PageGeometry,
  PageTypesetResult,
  TypesetLine,
} from '../types/typesetter';
import type { ProfessionalDesignSettings } from '../types/design-settings';
import type { TypesettingRulesConfig } from './typesetting-rules-engine';
import { TypesetterEngine } from './typesetter-core';

const SPANNING_ROLES = new Set(['main_title', 'subtitle', 'chapter', 'heading']);
const isHeadLine = (l: TypesetLine) => l.role === 'heading' || l.role === 'chapter' || l.role === 'subtitle' || l.role === 'main_title';

export interface ProseColumnsInput {
  title: string;
  units: ContentUnit[];
  geometry: PageGeometry;
  fontSize: number;
  designSettings?: ProfessionalDesignSettings;
  rulesConfig?: TypesettingRulesConfig;
}

interface Item {
  kind: 'span' | 'col';
  lines: TypesetLine[];
}

const lineH = (l: TypesetLine, i: number, lines: TypesetLine[]): number => {
  const base = l.leadingPt && l.leadingPt > 0 ? l.leadingPt : l.height;
  const first = i === 0 || lines[i - 1].unitId !== l.unitId;
  const last = i === lines.length - 1 || lines[i + 1].unitId !== l.unitId;
  return base + (first ? l.spaceBeforePt ?? 0 : 0) + (last ? l.spaceAfterPt ?? 0 : 0);
};

export function paginateProseColumns(input: ProseColumnsInput): BookTypesetDocument {
  const { geometry, designSettings, rulesConfig } = input;
  const contentW = geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
  const contentH = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;
  const gap = designSettings?.columns?.columnGapPt ?? 16;
  const colW = (contentW - gap) / 2;
  const spanGap = 4;

  const engine = new TypesetterEngine(input.fontSize, rulesConfig, designSettings);
  const fnEngine = new TypesetterEngine(designSettings?.footnotes?.fontSizePt ?? 9.5, rulesConfig, designSettings);
  const fnLeading = designSettings?.footnotes?.leadingPt ?? 13;

  // Footnotes by their anchor unit.
  const fnByAnchor = new Map<string, TypesetLine[]>();
  for (const u of input.units) {
    if (u.role !== 'footnote') continue;
    const anchor = u.footnoteAnchorUnitId ?? u.parentId;
    if (!anchor) continue;
    const ls = fnEngine.typesetContentUnit(u, contentW, fnLeading, true);
    fnByAnchor.set(anchor, [...(fnByAnchor.get(anchor) ?? []), ...ls]);
  }
  const fnHeight = (ls: TypesetLine[]) => ls.reduce((s, l) => s + (l.leadingPt || fnLeading), 0);

  // Two-column Chassidic sefer (the user's Kedushat Levi prints): section
  // and parsha headings sit INSIDE their column, centred, and the text
  // flows on in the same column; only the book title spans the page.
  const headingsInColumn = (designSettings?.columns as { headingsInColumn?: boolean } | undefined)?.headingsInColumn === true;
  const plain = (t: string) => t.replace(/[֑-ׇ]/g, '').replace(/\s+/g, ' ').trim();
  // Items: spanning blocks and column runs, in reading order.
  const items: Item[] = [];
  const chapterOfUnit = new Map<string, string>();
  let chapter = '';
  let prevHeadingText = '';
  for (const u of input.units) {
    if (u.role === 'footnote' || !u.rawText?.trim()) continue;
    const isHead = u.role === 'heading' || u.role === 'chapter' || u.role === 'subtitle' || u.role === 'main_title';
    // the same heading twice in a row (Word: "Heading 2 בראשית" then
    // "Heading 3 בראשית") is printed once
    if (isHead && plain(u.rawText) === prevHeadingText) continue;
    prevHeadingText = isHead ? plain(u.rawText) : '';
    const spanning = SPANNING_ROLES.has(u.role) && !(headingsInColumn && (u.role === 'heading' || u.role === 'subtitle'));
    if (u.role === 'chapter') chapter = u.rawText.replace(/[֑-ׇ]/g, '').trim();
    // the running head follows the parsha (a top-level heading)
    if (headingsInColumn && u.role === 'heading' && (u.hierarchyLevel ?? 2) <= 2) chapter = plain(u.rawText);
    chapterOfUnit.set(u.id, chapter);
    const lines = engine.typesetContentUnit(u, spanning ? contentW : colW, undefined, !spanning);
    if (!lines.length) continue;
    if (spanning || (headingsInColumn && isHead)) {
      for (const l of lines) {
        l.alignment = 'center';
        l.paragraphAlignment = 'center';
        l.isJustified = false;
      }
    }
    const kind = spanning ? 'span' : 'col';
    const last = items[items.length - 1];
    if (last && last.kind === kind && kind === 'col') last.lines.push(...lines);
    else if (last && last.kind === 'span' && kind === 'span') last.lines.push(...lines);
    else items.push({ kind, lines });
  }

  const pages: PageTypesetResult[] = [];
  const knee: DynamicKneeContour = {
    pageContentWidth: contentW,
    pageContentHeight: contentH,
    topY: 0,
    kneeJunctionY: contentH,
    bottomY: contentH,
    upperSourceWidth: colW,
    lowerSourceWidth: colW,
    innerXOffset: 0,
    isLeftStepped: false,
    rightCommentaryWidth: colW,
    leftCommentaryWidth: colW,
    gutterWidth: gap,
  };

  const place = (l: TypesetLine, x0: number, x1: number, y: number): TypesetLine => {
    const out: TypesetLine = { ...l, words: l.words.map(w => ({ ...w })) };
    out.xLeft = x0;
    out.xRight = x1;
    out.yBaseline = y + (l.ascent || (l.fontSizePt ?? input.fontSize) * 0.8);
    out.yTop = y;
    out.yBottom = out.yBaseline + (l.descent || (l.fontSizePt ?? input.fontSize) * 0.25);
    return out;
  };

  let itemIdx = 0;
  let lineIdx = 0; // inside items[itemIdx]
  let guard = 0;
  while (itemIdx < items.length && guard++ < 5000) {
    const placed: TypesetLine[] = [];
    const fnLines: TypesetLine[] = [];
    const fnDone = new Set<string>();
    let y = 0;
    let fnH = 0;
    let pageChapter: string | undefined;
    const avail = () => contentH - (fnH > 0 ? fnH + 10 : 0);
    const takeFootnotes = (unitId: string): number => {
      if (fnDone.has(unitId)) return 0;
      return fnHeight(fnByAnchor.get(unitId) ?? []);
    };
    const commitFootnotes = (unitId: string) => {
      if (fnDone.has(unitId)) return;
      fnDone.add(unitId);
      const ls = fnByAnchor.get(unitId);
      if (ls?.length) {
        fnLines.push(...ls);
        fnH += fnHeight(ls);
      }
    };

    let pageFull = false;
    while (!pageFull && itemIdx < items.length) {
      const item = items[itemIdx];
      const rest = item.lines.slice(lineIdx);
      if (item.kind === 'span') {
        const H = rest.reduce((s, l, i) => s + lineH(l, i, rest), 0) + spanGap;
        // keep with next: two lines of the following run must fit too
        const next = items[itemIdx + 1];
        const nextH = next ? next.lines.slice(0, 2).reduce((s, l, i, a) => s + lineH(l, i, a), 0) : 0;
        if (y > 0 && y + H + nextH > avail()) {
          pageFull = true;
          break;
        }
        rest.forEach((l, i) => {
          placed.push(place(l, 0, contentW, y));
          y += lineH(l, i, rest);
          if (pageChapter === undefined && l.role === 'chapter') pageChapter = chapterOfUnit.get(l.unitId);
        });
        y += spanGap;
        itemIdx++;
        lineIdx = 0;
        continue;
      }

      // Column run.
      const hs = rest.map((l, i) => lineH(l, i, rest));
      const startUnit = (i: number) => i === 0 || rest[i - 1].unitId !== rest[i].unitId;
      // Footnotes of every paragraph that STARTS in the run so far.
      const fnFor = (k: number) => {
        let s = 0;
        const seen = new Set<string>();
        for (let i = 0; i < k; i++) if (startUnit(i) && !seen.has(rest[i].unitId)) { seen.add(rest[i].unitId); s += takeFootnotes(rest[i].unitId); }
        return s;
      };
      const roomFor = (k: number) => contentH - y - (fnH + fnFor(k) > 0 ? fnH + fnFor(k) + 10 : 0);
      const total = hs.reduce((a, b) => a + b, 0);

      // Does the whole rest fit in two balanced columns?
      let split = -1;
      let colHeight = 0;
      if (total / 2 <= roomFor(rest.length) + 0.01) {
        let acc = 0;
        let best = { k: rest.length, h: total };
        for (let k = 0; k <= rest.length; k++) {
          const h = Math.max(acc, total - acc);
          if (h < best.h - 0.01) best = { k, h };
          if (k < rest.length) acc += hs[k];
        }
        // widow / orphan: nudge the split by one line when it helps
        const bad = (k: number) =>
          (k > 0 && k < rest.length && isHeadLine(rest[k - 1])) || // heading at col foot
          (k > 0 && k < rest.length && startUnit(k - 1) && !startUnit(k)) || // orphan at col foot
          (k < rest.length && k > 0 && !startUnit(k) && (k + 1 === rest.length || startUnit(k + 1))); // widow at col head
        let k = best.k;
        if (bad(k)) {
          for (const d of [1, -1, 2, -2]) {
            const kk = k + d;
            if (kk <= 0 || kk >= rest.length || bad(kk)) continue;
            const a = hs.slice(0, kk).reduce((x, y2) => x + y2, 0);
            const h = Math.max(a, total - a);
            if (h <= roomFor(rest.length) + 0.01) { k = kk; break; }
          }
        }
        const right = hs.slice(0, k).reduce((a, b) => a + b, 0);
        if (Math.max(right, total - right) <= roomFor(rest.length) + 0.01) {
          split = k;
          colHeight = Math.max(right, total - right);
        }
      }

      let takeRight: number;
      let takeTotal: number;
      if (split >= 0) {
        takeRight = split;
        takeTotal = rest.length;
      } else {
        // Fill right column then left column to the foot of the page.
        const fill = (from: number, room: () => number) => {
          let h = 0;
          let k = from;
          while (k < rest.length && h + hs[k] <= room() + 0.01) {
            h += hs[k];
            k++;
          }
          return k;
        };
        let kR = fill(0, () => roomFor(1));
        // a heading never ends a column: it moves with its text
        while (kR > 1 && kR < rest.length && isHeadLine(rest[kR - 1])) kR--;
        // orphan at the right column foot → move it over
        if (kR > 1 && kR < rest.length && startUnit(kR - 1) && !startUnit(kR)) kR--;
        // widow at the left column head → pull one more line back
        if (kR > 2 && kR < rest.length && !startUnit(kR) && (kR + 1 === rest.length || startUnit(kR + 1))) kR--;
        let kL = kR;
        {
          let h = 0;
          while (kL < rest.length && h + hs[kL] <= roomFor(kL + 1) + 0.01) {
            h += hs[kL];
            kL++;
          }
        }
        while (kL > kR + 1 && kL < rest.length && isHeadLine(rest[kL - 1])) kL--;
        if (kL > kR + 1 && kL < rest.length && startUnit(kL - 1) && !startUnit(kL)) kL--;
        if (kL > kR + 2 && kL < rest.length && !startUnit(kL) && (kL + 1 === rest.length || startUnit(kL + 1))) kL--;
        if (kR === 0 && y > 0) {
          pageFull = true;
          break;
        }
        takeRight = kR;
        takeTotal = Math.max(kL, Math.min(rest.length, 1));
        pageFull = true;
      }

      let yr = y;
      let yl = y;
      for (let i = 0; i < takeTotal; i++) {
        const l = rest[i];
        if (startUnit(i)) commitFootnotes(l.unitId);
        if (pageChapter === undefined) pageChapter = chapterOfUnit.get(l.unitId);
        if (i < takeRight) {
          placed.push(place(l, contentW - colW, contentW, yr));
          yr += hs[i];
        } else {
          placed.push(place(l, 0, colW, yl));
          yl += hs[i];
        }
      }
      y = split >= 0 ? y + colHeight + spanGap : Math.max(yr, yl);
      lineIdx += takeTotal;
      if (lineIdx >= item.lines.length) {
        itemIdx++;
        lineIdx = 0;
      }
    }

    // Footnotes at the page foot, full width.
    let fy = contentH - fnH;
    const fnPlaced = fnLines.map((l, i) => {
      const out = place(l, 0, contentW, fy);
      fy += l.leadingPt || fnLeading;
      void i;
      return out;
    });

    if (!placed.length && !fnPlaced.length) {
      // Safety: never loop on an item that cannot be placed.
      itemIdx++;
      lineIdx = 0;
      continue;
    }
    // Unique line index per page (the preview keys line elements by it).
    placed.forEach((l, i) => (l.lineIndex = i));
    fnPlaced.forEach((l, i) => (l.lineIndex = placed.length + i));
    const p = pages.length;
    pages.push({
      pageIndex: p,
      pageNumber: p + 1,
      pageNumberHebrew: '',
      headerTitle: input.title,
      layoutType: 'two_column',
      geometry: { ...geometry },
      sourceLines: placed,
      rashiLines: [],
      tosafotLines: [],
      footnoteLines: fnPlaced,
      knee,
      designSettings,
      runningChapter: pageChapter ?? '',
    } as PageTypesetResult);
  }

  return {
    title: input.title,
    layoutType: 'two_column',
    pages,
    totalPages: pages.length,
    geometry,
    designSettings,
  } as BookTypesetDocument;
}
