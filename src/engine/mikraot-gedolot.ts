/**
 * Layout training T7 — the MIKRAOT GEDOLOT / CHUMASH page.
 *
 * Reported: a Chumash + Rashi book was laid out like a Gemara (stepped
 * knee, daf numbering, opening frame). A Chumash page is a different
 * structure. From the user's reference prints (modern Chumash photos and
 * the hebrewbooks Mikraot Gedolot volumes 9596 / 9754 / 14020 / 14084):
 *
 *  ┌──────── head: SEFER · PEREK ─────────────── folio (outer) ┐
 *  │ PESUKIM — large, run in, nikkud + teamim │ ONKELOS (inner) │
 *  │ (≈ 72% of the text block)                │ narrow column   │
 *  ├──────────────────── רש״י ─────────────────────────────────┤
 *  │ commentary in TWO balanced columns (Rashi script)          │
 *  ├──────────────────── רמב״ן / אבן עזרא … ───────────────────┤
 *  │ each further commentary: its own titled two-column band    │
 *  └────────────────────────────────────────────────────────────┘
 *
 * Rules:
 *  - A page takes the LARGEST run of pesukim whose Onkelos and EVERY
 *    commentary on them fit on the page (a commentary is printed on the
 *    page of its pasuk). Every page starts with at least one pasuk.
 *  - A commentary too long for one page continues at the top of its band
 *    on the next page; it never pushes the pasuk off its page.
 *  - Onkelos sits on the INNER (binding) side: a recto (left-hand page)
 *    binds on its right, so its Onkelos column is on the right.
 *  - No knee, no daf numbering, no opening frame (Talmud-only rules).
 */
import type {
  BookTypesetDocument,
  ContentUnit,
  DynamicKneeContour,
  PageGeometry,
  PageTypesetResult,
  RavTextLink,
  ShapedWord,
  TypesetLine,
} from '../types/typesetter';
import type { ProfessionalDesignSettings } from '../types/design-settings';
import type { TypesettingRulesConfig } from './typesetting-rules-engine';
import { TypesetterEngine } from './typesetter-core';
import { detectCommentator } from './auto-layout';
import { hebrewNumeralBare } from './hebrew-numerals';

/** Fitted proportions (from the user's Chumash photos: line pitch ratios). */
export const MG_FIT = {
  pasukShare: 0.72,
  onkelosToPasuk: 0.55,
  commentaryToPasuk: 0.52,
  minorCommentaryToPasuk: 0.47,
  lineSpacing: 1.22,
  columnGapPt: 10,
  bandGapPt: 7,
};

const COMMENT_ROLES = new Set(['primary_comment', 'secondary_comment', 'tertiary_comment', 'dibbur_hamatchil', 'side_note', 'footnote', 'cross_reference']);
const ROLE_ORDER: Record<string, number> = {
  primary_comment: 0,
  dibbur_hamatchil: 0,
  secondary_comment: 1,
  tertiary_comment: 2,
  side_note: 3,
  cross_reference: 3,
  footnote: 4,
};
const ROLE_TITLES: Record<string, string> = {
  primary_comment: 'רש״י',
  dibbur_hamatchil: 'רש״י',
  secondary_comment: 'מפרשים',
  tertiary_comment: 'מפרשים',
  side_note: 'הערות',
  cross_reference: 'מראי מקומות',
  footnote: 'הערות',
};

function isOnkelos(u: ContentUnit): boolean {
  if (u.role === 'verse') return true;
  return detectCommentator(u)?.name === 'Onkelos';
}

interface Band {
  key: string;
  title: string;
  order: number;
  firstSeen: number;
  fontFamily: string;
  sizePt: number;
  /** unit ids per pasuk index */
  byPasuk: Map<number, ContentUnit[]>;
}

export interface MikraotInput {
  title: string;
  units: ContentUnit[];
  links?: RavTextLink[];
  geometry: PageGeometry;
  designSettings?: ProfessionalDesignSettings;
  rulesConfig?: TypesettingRulesConfig;
}

function emptyKnee(w: number, h: number): DynamicKneeContour {
  return {
    pageContentWidth: w,
    pageContentHeight: h,
    topY: 0,
    kneeJunctionY: h,
    bottomY: h,
    upperSourceWidth: w,
    lowerSourceWidth: w,
    innerXOffset: 0,
    isLeftStepped: false,
    rightCommentaryWidth: 0,
    leftCommentaryWidth: 0,
    gutterWidth: 0,
  };
}

export function paginateMikraotGedolot(input: MikraotInput): BookTypesetDocument {
  const { units, geometry, designSettings, rulesConfig } = input;
  const contentW = geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
  const contentH = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;

  // ── sizes and fonts ───────────────────────────────────────────────
  const rs = designSettings?.roleStyles;
  const pasukSize = rs?.main_source?.character?.fontSizePt ?? 16;
  const pasukFont = rs?.main_source?.character?.fontFamily || 'Frank Ruhl Libre';
  const onkSize = Math.round(pasukSize * MG_FIT.onkelosToPasuk * 10) / 10;
  const comSize = Math.round(pasukSize * MG_FIT.commentaryToPasuk * 10) / 10;
  const minorSize = Math.round(pasukSize * MG_FIT.minorCommentaryToPasuk * 10) / 10;
  const rashiFont = rs?.primary_comment?.character?.fontFamily || 'Noto Rashi Hebrew';
  const otherFont = rs?.secondary_comment?.character?.fontFamily || 'Frank Ruhl Libre';
  const lh = (size: number) => Math.round(size * MG_FIT.lineSpacing * 100) / 100;

  // ── partition: pesukim, Onkelos, commentary bands, headings ──────
  const pesukim: ContentUnit[] = [];
  const onkelosUnits: ContentUnit[] = [];
  const headingBefore = new Map<number, string>(); // pasuk index → heading text before it
  const commentaries: Array<{ unit: ContentUnit; order: number }> = [];
  units.forEach((u, i) => {
    if (!u.rawText?.trim()) return;
    if (u.role === 'main_source') pesukim.push(u);
    else if (isOnkelos(u)) onkelosUnits.push(u);
    else if (u.role === 'chapter' || u.role === 'heading' || u.role === 'main_title' || u.role === 'subtitle') {
      headingBefore.set(pesukim.length, u.rawText.trim());
    } else if (COMMENT_ROLES.has(u.role) || u.role === 'regular_paragraph') commentaries.push({ unit: u, order: i });
  });
  const pasukIdx = new Map(pesukim.map((p, i) => [p.id, i]));
  const linkSource = new Map<string, string>();
  for (const l of input.links ?? []) linkSource.set(l.commentaryUnitId, l.sourceUnitId);

  // Anchor every commentary to a pasuk: explicit link, linkedSourceId,
  // else the last pasuk before it in the document (importers keep each
  // comment after its pasuk), else the first pasuk.
  const docOrderPasuk = new Map<string, number>();
  {
    let last = 0;
    for (const u of units) {
      if (u.role === 'main_source') last = pasukIdx.get(u.id) ?? last;
      else docOrderPasuk.set(u.id, last);
    }
  }
  const anchorOf = (u: ContentUnit): number => {
    const src = linkSource.get(u.id) ?? u.linkedSourceId;
    if (src && pasukIdx.has(src)) return pasukIdx.get(src)!;
    return docOrderPasuk.get(u.id) ?? 0;
  };

  // Onkelos: one unit per pasuk → by index; otherwise by document order.
  const onkByPasuk = new Map<number, ContentUnit[]>();
  onkelosUnits.forEach((u, i) => {
    const k = onkelosUnits.length === pesukim.length ? i : anchorOf(u);
    onkByPasuk.set(k, [...(onkByPasuk.get(k) ?? []), u]);
  });

  const bands: Band[] = [];
  const bandByKey = new Map<string, Band>();
  for (const { unit, order } of commentaries) {
    const author = detectCommentator(unit);
    const key = author?.name ?? `role:${unit.role === 'dibbur_hamatchil' ? 'primary_comment' : unit.role}`;
    let band = bandByKey.get(key);
    if (!band) {
      const isRashi = author?.name === 'Rashi' || (!author && (unit.role === 'primary_comment' || unit.role === 'dibbur_hamatchil'));
      band = {
        key,
        title: author?.nameHe ?? ROLE_TITLES[unit.role] ?? 'מפרשים',
        order: isRashi ? 0 : (ROLE_ORDER[unit.role] ?? 2) + 1,
        firstSeen: order,
        fontFamily: isRashi ? rashiFont : otherFont,
        sizePt: unit.role === 'tertiary_comment' || unit.role === 'footnote' || unit.role === 'side_note' ? minorSize : comSize,
        byPasuk: new Map(),
      };
      bandByKey.set(key, band);
      bands.push(band);
    }
    const k = anchorOf(unit);
    band.byPasuk.set(k, [...(band.byPasuk.get(k) ?? []), unit]);
  }
  bands.sort((a, b) => a.order - b.order || a.firstSeen - b.firstSeen);

  // ── typesetting helpers ───────────────────────────────────────────
  const engines = new Map<string, TypesetterEngine>();
  const engine = (size: number, family: string): TypesetterEngine => {
    const k = `${family}|${size}`;
    let e = engines.get(k);
    if (!e) {
      e = new TypesetterEngine(size, rulesConfig, undefined);
      e.getShaper().setFontFamily(family);
      engines.set(k, e);
    }
    return e;
  };
  const shapedCache = new Map<string, ShapedWord[]>();
  const shape = (u: ContentUnit, size: number, family: string, prefix?: string): ShapedWord[] => {
    const k = `${u.id}|${size}|${family}|${prefix ?? ''}`;
    let w = shapedCache.get(k);
    if (!w) {
      const eng = engine(size, family);
      let src: ContentUnit = prefix ? { ...u, rawText: `${prefix} ${u.rawText}`, textRuns: undefined } : u;
      // Rashi's dibbur hamatchil (the words up to the first period) is set
      // bold when the importer did not mark it.
      if (!prefix && COMMENT_ROLES.has(u.role) && !u.dibburHamatchil && !u.textRuns?.some(r => r.isBold)) {
        const m = /^([^.:]{2,60}?)\.\s/.exec(u.rawText);
        if (m) src = { ...src, dibburHamatchil: m[1] };
      }
      w = eng.shapeContentUnit(src);
      shapedCache.set(k, w);
    }
    return w;
  };
  const setLines = (words: ShapedWord[], width: number, size: number, family: string, role: ContentUnit['role'], unitId: string) => {
    const eng = engine(size, family);
    // Comments run on in one paragraph (no separator ornament between
    // them — the recipe's Gemara-style separator would draw a stray ':').
    return eng.typesetShapedWords(words, width, role, unitId, lh(size), true).map(l => ({
      ...l,
      unitBoundaryAfter: false,
      fontSizePt: size,
      fontFamily: family,
      role,
    }));
  };

  const hasOnkelos = onkelosUnits.length > 0;
  const gap = MG_FIT.columnGapPt;
  const onkW = hasOnkelos ? Math.round(contentW * (1 - MG_FIT.pasukShare) - gap / 2) : 0;
  const pasukW = hasOnkelos ? contentW - onkW - gap : contentW;
  const colW = (contentW - gap) / 2;
  const titleSize = (b: Band) => b.sizePt + 1.5;

  // Pasuk numbers (Hebrew letters) run in before each pasuk.
  const pasukLabel = (i: number): string => hebrewNumeralBare(i + 1);

  interface Measured {
    pasukLines: TypesetLine[];
    onkLines: TypesetLine[];
    bandLines: Map<string, TypesetLine[]>;
    height: number;
  }
  const carry = new Map<string, TypesetLine[]>(); // band key → lines carried to the next page

  const measure = (from: number, to: number, withCarry: boolean): Measured => {
    const pWords = pesukim.slice(from, to).flatMap((u, j) => shape(u, pasukSize, pasukFont, pasukLabel(from + j)));
    const pasukLines = setLines(pWords, pasukW, pasukSize, pasukFont, 'main_source', pesukim[from]?.id ?? 'pasuk');
    const oUnits: ContentUnit[] = [];
    for (let k = from; k < to; k++) oUnits.push(...(onkByPasuk.get(k) ?? []));
    const onkLines = hasOnkelos
      ? setLines(oUnits.flatMap(u => shape(u, onkSize, pasukFont)), onkW, onkSize, pasukFont, 'verse', oUnits[0]?.id ?? 'onkelos')
      : [];
    const topH = Math.max(pasukLines.length * lh(pasukSize), hasOnkelos ? (onkLines.length + 1) * lh(onkSize) : 0);
    let height = topH;
    const bandLines = new Map<string, TypesetLine[]>();
    for (const b of bands) {
      const us: ContentUnit[] = [];
      for (let k = from; k < to; k++) us.push(...(b.byPasuk.get(k) ?? []));
      const fresh = us.length ? setLines(us.flatMap(u => shape(u, b.sizePt, b.fontFamily)), colW, b.sizePt, b.fontFamily, us[0].role, us[0].id) : [];
      const lines = [...(withCarry ? carry.get(b.key) ?? [] : []), ...fresh];
      if (!lines.length) continue;
      bandLines.set(b.key, lines);
      height += MG_FIT.bandGapPt + lh(titleSize(b)) + Math.ceil(lines.length / 2) * lh(b.sizePt);
    }
    return { pasukLines, onkLines, bandLines, height };
  };

  // ── paginate ──────────────────────────────────────────────────────
  const pages: PageTypesetResult[] = [];
  let cursor = 0;
  let p = 0;
  while ((cursor < pesukim.length || [...carry.values()].some(l => l.length)) && p < 2000) {
    // Largest run of pesukim whose commentaries all fit.
    let best: Measured | null = null;
    let bestTo = cursor;
    for (let to = cursor + 1; to <= pesukim.length; to++) {
      const m = measure(cursor, to, true);
      if (m.height <= contentH || to === cursor + 1) {
        best = m;
        bestTo = to;
        if (m.height > contentH) break;
      } else break;
    }
    if (!best) best = measure(cursor, cursor, true); // carry-only page (end of book)

    // Place the top block.
    const recto = p % 2 === 0; // body page 1 is a recto (left-hand page, binds on its right)
    const onkOnRight = recto; // Onkelos on the INNER (binding) side
    const pasukX: [number, number] = hasOnkelos ? (onkOnRight ? [0, pasukW] : [contentW - pasukW, contentW]) : [0, contentW];
    const onkX: [number, number] = onkOnRight ? [contentW - onkW, contentW] : [0, onkW];
    const sourceLines: TypesetLine[] = [];
    const extra: TypesetLine[] = [];
    const place = (l: TypesetLine, x: [number, number], y: number, size: number) => {
      const asc = size * 0.8;
      const out: TypesetLine = { ...l, words: l.words.map(w => ({ ...w })) };
      out.xLeft = x[0];
      out.xRight = x[1];
      out.targetWidth = x[1] - x[0];
      out.yBaseline = y + asc;
      out.yTop = y;
      out.yBottom = y + size * 1.04;
      out.ascent = asc;
      out.descent = size * 0.24;
      return out;
    };
    let y = 0;
    best.pasukLines.forEach(l => {
      if (y + lh(pasukSize) > contentH + 0.5 && sourceLines.length > 0) return;
      sourceLines.push(place(l, pasukX, y, pasukSize));
      y += lh(pasukSize);
    });
    let yo = 0;
    if (hasOnkelos && best.onkLines.length) {
      const title = setLines(engine(onkSize, pasukFont).shapeContentUnit({ id: 'onk-title', role: 'verse', rawText: 'אונקלוס', styleName: '', order: 0, hierarchyLevel: 0 } as ContentUnit), onkW, onkSize, pasukFont, 'verse', 'onk-title')[0];
      if (title) extra.push({ ...place(title, onkX, yo, onkSize), alignment: 'center', paragraphAlignment: 'center', isJustified: false, fontWeight: 700 });
      yo += lh(onkSize);
      for (const l of best.onkLines) {
        extra.push(place(l, onkX, yo, onkSize));
        yo += lh(onkSize);
      }
    }
    y = Math.max(y, yo);

    // Commentary bands: title, then two balanced columns (right first).
    carry.clear();
    for (const b of bands) {
      const lines = best.bandLines.get(b.key);
      if (!lines?.length) continue;
      const tl = lh(titleSize(b));
      const ll = lh(b.sizePt);
      if (y + MG_FIT.bandGapPt + tl + ll > contentH) {
        carry.set(b.key, lines);
        continue;
      }
      y += MG_FIT.bandGapPt;
      const t = setLines(engine(titleSize(b), b.fontFamily).shapeContentUnit({ id: `title-${b.key}`, role: 'heading', rawText: b.title, styleName: '', order: 0, hierarchyLevel: 0 } as ContentUnit), contentW, titleSize(b), b.fontFamily, 'heading', `band-title-${b.key}`)[0];
      if (t) extra.push({ ...place(t, [0, contentW], y, titleSize(b)), alignment: 'center', paragraphAlignment: 'center', isJustified: false, fontWeight: 700 });
      y += tl;
      const rowsFit = Math.max(0, Math.floor((contentH - y) / ll));
      const rows = Math.min(rowsFit, Math.ceil(lines.length / 2));
      const take = Math.min(lines.length, rows * 2);
      const right = lines.slice(0, Math.min(rows, take));
      const left = lines.slice(right.length, take);
      right.forEach((l, i) => extra.push(place(l, [contentW - colW, contentW], y + i * ll, b.sizePt)));
      left.forEach((l, i) => extra.push(place(l, [0, colW], y + i * ll, b.sizePt)));
      y += rows * ll;
      if (take < lines.length) carry.set(b.key, lines.slice(take));
    }

    const headingTexts: string[] = [];
    for (let k = cursor; k < bestTo; k++) if (headingBefore.has(k)) headingTexts.push(headingBefore.get(k)!);
    pages.push({
      pageIndex: p,
      pageNumber: p + 1,
      pageNumberHebrew: '',
      headerTitle: input.title,
      layoutType: 'mikraot_gedolot',
      geometry: { ...geometry },
      sourceLines,
      rashiLines: [],
      tosafotLines: [],
      footnoteLines: [],
      marginLines: extra,
      knee: emptyKnee(contentW, contentH),
      designSettings,
      chumashFirstPasuk: cursor < pesukim.length ? cursor : undefined,
      chumashHeadings: headingTexts,
    } as PageTypesetResult);
    cursor = bestTo;
    p++;
  }
  return {
    title: input.title,
    layoutType: 'mikraot_gedolot',
    pages,
    totalPages: pages.length,
    geometry,
    designSettings,
    links: input.links,
  } as BookTypesetDocument;
}

/**
 * The Chumash head for a page: sefer name and the perek of its first
 * pasuk (from the last "פרק …" heading before it), e.g. "דברים א".
 */
export function chumashHeaderParts(units: ContentUnit[], firstPasukIndex: number | undefined, bookTitle: string): string[] {
  let sefer = '';
  let perek = '';
  let pasuk = -1;
  for (const u of units) {
    if (u.role === 'main_source') {
      pasuk++;
      if (firstPasukIndex !== undefined && pasuk >= firstPasukIndex) break;
      continue;
    }
    if (u.role === 'chapter' || u.role === 'heading' || u.role === 'main_title' || u.role === 'subtitle') {
      const t = u.rawText.replace(/[֑-ׇ]/g, '').trim();
      const sm = /(?:ספר\s+)?(בראשית|שמות|ויקרא|במדבר|דברים)/.exec(t);
      if (sm) sefer = sm[1];
      const pm = /פרק\s+([א-ת"״׳']{1,4})/.exec(t);
      if (pm) perek = pm[1].replace(/["״׳']/g, '');
    }
  }
  if (!sefer) {
    const sm = /(בראשית|שמות|ויקרא|במדבר|דברים)/.exec(bookTitle.replace(/[֑-ׇ]/g, ''));
    sefer = sm ? sm[1] : bookTitle.replace(/^\s*(?:ספר|חומש)\s+/, '').trim();
  }
  return [sefer, perek].filter(Boolean);
}
