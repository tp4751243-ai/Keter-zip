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
import { fontLacksTeamim, TEAMIM_FALLBACK_FONT, wordHasTeamim } from './font-analyzer';
import { requiredPitch } from './ink-clearance';
import { chapterNumbers, chumashPositions, leadingPasukNumber, linkChumashCommentaries } from './chumash-linker';

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
  const chosenPasukFont = rs?.main_source?.character?.fontFamily || 'Frank Ruhl Libre';
  // Layout training T9 — cantillated pesukim are set WHOLE in a face that
  // has teamim (never word-by-word font switching inside a pasuk).
  const pasukHasTeamim = units.some(u => u.role === 'main_source' && wordHasTeamim(u.rawText ?? ''));
  const pasukFont = pasukHasTeamim && fontLacksTeamim(chosenPasukFont) ? TEAMIM_FALLBACK_FONT : chosenPasukFont;
  const onkFont = chosenPasukFont;
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
  // T12 — chapter / pasuk of every unit (per uploaded file): pasuk numbers
  // restart each chapter, "(א)" typed in the file is not printed twice,
  // and a commentary's introduction (before its first "פרק") gets pages
  // of its own before the pesukim.
  const positions = chumashPositions(units);
  const pasukNumber: number[] = [];
  const intro: ContentUnit[] = [];
  // Parsha marks typed in the text: {פ} (petucha — the next pasuk starts a
  // new line) and {ס} (setuma — a wide space). The marks are not printed.
  const parshaAfter: Array<'פ' | 'ס' | undefined> = [];
  const PARSHA_RE = /\s*\{([פס])\}\s*/g;
  const stripNumber = (u: ContentUnit): ContentUnit => {
    const lead = leadingPasukNumber(u.rawText);
    let text = lead ? lead.rest : u.rawText;
    if (PARSHA_RE.test(text)) {
      PARSHA_RE.lastIndex = 0;
      text = text.replace(PARSHA_RE, ' ').trim();
      return { ...u, rawText: text, textRuns: undefined };
    }
    return lead ? { ...u, rawText: text, textRuns: undefined } : u;
  };
  let chapterCounter = new Map<number, number>();
  const mainFile = units.find(x => x.role === 'main_source')?.importFileIndex;
  // Each uploaded commentary file is ONE band, titled from the file's own
  // title ("רמב\"ן על בראשית" → רמב״ן).
  const fileTitle = new Map<number, string>();
  for (const u of units) {
    if (u.importFileIndex === undefined || fileTitle.has(u.importFileIndex)) continue;
    if (u.role === 'chapter' || u.role === 'main_title' || u.role === 'heading') {
      const t = u.rawText.replace(/[\u0591-\u05C7]/g, '').replace(/\s+על\s+.*$/, '').replace(/"/g, '״').trim();
      if (t && t.split(/\s+/).length <= 4) fileTitle.set(u.importFileIndex, t);
    }
  }
  units.forEach((u, i) => {
    if (!u.rawText?.trim()) return;
    const pos = positions.get(u.id);
    if (u.role === 'main_source') {
      const ch = pos?.chapter ?? 0;
      const n = pos && pos.explicit && pos.pasuk > 0 ? pos.pasuk : (chapterCounter.get(ch) ?? 0) + 1;
      chapterCounter.set(ch, n);
      pasukNumber.push(n);
      parshaAfter.push(/\{פ\}/.test(u.rawText) ? 'פ' : /\{ס\}/.test(u.rawText) ? 'ס' : undefined);
      pesukim.push(stripNumber(u));
    } else if (isOnkelos(u)) onkelosUnits.push(stripNumber(u));
    else if (u.role === 'chapter' || u.role === 'heading' || u.role === 'main_title' || u.role === 'subtitle') {
      if (u.importFileIndex === undefined || u.importFileIndex === mainFile) {
        headingBefore.set(pesukim.length, u.rawText.trim());
      }
    } else if (COMMENT_ROLES.has(u.role) || u.role === 'regular_paragraph') {
      if (u.importFileIndex !== undefined && (pos?.chapter ?? 0) === 0) intro.push(u);
      else commentaries.push({ unit: u, order: i });
    }
  });
  chapterCounter = new Map();
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
  // T12 — separate files (pesukim, then Onkelos, then Rashi) give no
  // document-order anchor: a comment without a link would land after the
  // LAST pasuk of the book. Link those by chapter + pasuk words.
  const unlinked = commentaries.filter(({ unit }) => {
    const src = linkSource.get(unit.id) ?? unit.linkedSourceId;
    return !(src && pasukIdx.has(src));
  });
  if (unlinked.length > 0) {
    for (const l of linkChumashCommentaries(units).links) {
      if (!linkSource.has(l.commentaryUnitId)) linkSource.set(l.commentaryUnitId, l.sourceUnitId);
    }
  }
  const anchorOf = (u: ContentUnit): number => {
    const src = linkSource.get(u.id) ?? u.linkedSourceId;
    if (src && pasukIdx.has(src)) return pasukIdx.get(src)!;
    return docOrderPasuk.get(u.id) ?? 0;
  };

  // Onkelos: one unit per pasuk → by index; else pasuk i of chapter c ↔
  // Onkelos paragraph i of chapter c (each file has its own "פרק" headings);
  // else document order.
  const onkByPasuk = new Map<number, ContentUnit[]>();
  const chapOf = chapterNumbers(units);
  const pesukimByChapter = new Map<number, number[]>();
  pesukim.forEach((p, i) => {
    const c = chapOf.get(p.id) ?? 0;
    pesukimByChapter.set(c, [...(pesukimByChapter.get(c) ?? []), i]);
  });
  const onkSeenInChapter = new Map<number, number>();
  const pasukByPos = new Map<string, number>();
  pesukim.forEach((p, i) => pasukByPos.set(`${chapOf.get(p.id) ?? 0}:${pasukNumber[i]}`, i));
  onkelosUnits.forEach((u, i) => {
    let k: number;
    const op = positions.get(u.id);
    const exact = op && op.explicit && op.pasuk > 0 ? pasukByPos.get(`${op.chapter}:${op.pasuk}`) : undefined;
    if (exact !== undefined) k = exact;
    else if (onkelosUnits.length === pesukim.length) k = i;
    else {
      const c = chapOf.get(u.id) ?? 0;
      const n = onkSeenInChapter.get(c) ?? 0;
      onkSeenInChapter.set(c, n + 1);
      const list = pesukimByChapter.get(c);
      k = list?.length ? list[Math.min(n, list.length - 1)] : anchorOf(u);
    }
    onkByPasuk.set(k, [...(onkByPasuk.get(k) ?? []), u]);
  });

  const bands: Band[] = [];
  const bandByKey = new Map<string, Band>();
  for (const { unit, order } of commentaries) {
    const author = detectCommentator(unit);
    const fileKey = unit.importFileIndex !== undefined ? `file:${unit.importFileIndex}` : undefined;
    const key = fileKey ?? author?.name ?? `role:${unit.role === 'dibbur_hamatchil' ? 'primary_comment' : unit.role}`;
    let band = bandByKey.get(key);
    if (!band) {
      const ft = unit.importFileIndex !== undefined ? fileTitle.get(unit.importFileIndex) : undefined;
      const isRashi = ft ? /רש/.test(ft) : author?.name === 'Rashi' || (!author && (unit.role === 'primary_comment' || unit.role === 'dibbur_hamatchil'));
      band = {
        key,
        title: ft ?? author?.nameHe ?? ROLE_TITLES[unit.role] ?? 'מפרשים',
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
  const pasukLabel = (i: number): string => hebrewNumeralBare(pasukNumber[i] ?? i + 1);

  interface Measured {
    pasukLines: TypesetLine[];
    onkLines: TypesetLine[];
    bandLines: Map<string, TypesetLine[]>;
    height: number;
    pasukPitch: number;
    onkPitch: number;
    bandPitch: Map<string, number>;
  }
  const carry = new Map<string, TypesetLine[]>(); // band key → lines carried to the next page

  const measure = (from: number, to: number, withCarry: boolean): Measured => {
    // Pesukim run in; a parsha petucha ends the line (the next pasuk starts
    // a new one) and a setuma leaves a wide space.
    const pasukLines: TypesetLine[] = [];
    let seg: ShapedWord[] = [];
    const flush = () => {
      if (seg.length) pasukLines.push(...setLines(seg, pasukW, pasukSize, pasukFont, 'main_source', pesukim[from]?.id ?? 'pasuk'));
      seg = [];
    };
    for (let k = from; k < to; k++) {
      seg.push(...shape(pesukim[k], pasukSize, pasukFont, pasukLabel(k)));
      if (parshaAfter[k] === 'פ' && k < to - 1) flush();
      else if (parshaAfter[k] === 'ס' && k < to - 1) {
        const last = seg[seg.length - 1];
        if (last) seg.push({ ...last, text: '\u2003', width: pasukSize * 1.2, isBold: false, isDibbur: false, footnoteMarker: undefined });
      }
    }
    flush();
    const oUnits: ContentUnit[] = [];
    for (let k = from; k < to; k++) oUnits.push(...(onkByPasuk.get(k) ?? []));
    const onkLines = hasOnkelos
      ? setLines(oUnits.flatMap(u => shape(u, onkSize, onkFont)), onkW, onkSize, onkFont, 'verse', oUnits[0]?.id ?? 'onkelos')
      : [];
    // Line pitch never lets the marks of one line touch the next (T9).
    const pasukPitch = Math.max(lh(pasukSize), requiredPitch(pasukLines));
    const onkPitch = Math.max(lh(onkSize), requiredPitch(onkLines));
    const bandPitch = new Map<string, number>();
    const topH = to > from ? Math.max(pasukLines.length * pasukPitch, hasOnkelos ? (onkLines.length + 1) * onkPitch : 0) : 0;
    let height = topH;
    const bandLines = new Map<string, TypesetLine[]>();
    for (const b of bands) {
      const us: ContentUnit[] = [];
      for (let k = from; k < to; k++) us.push(...(b.byPasuk.get(k) ?? []));
      const fresh = us.length ? setLines(us.flatMap(u => shape(u, b.sizePt, b.fontFamily)), colW, b.sizePt, b.fontFamily, us[0].role, us[0].id) : [];
      const lines = [...(withCarry ? carry.get(b.key) ?? [] : []), ...fresh];
      if (!lines.length) continue;
      bandLines.set(b.key, lines);
      const bp = Math.max(lh(b.sizePt), requiredPitch(lines));
      bandPitch.set(b.key, bp);
      height += MG_FIT.bandGapPt + lh(titleSize(b)) + Math.ceil(lines.length / 2) * bp;
    }
    return { pasukLines, onkLines, bandLines, height, pasukPitch, onkPitch, bandPitch };
  };

  // ── cheap height estimate (natural widths × learned pitch) ─────────
  const natCache = new Map<string, number>();
  const natWidth = (u: ContentUnit, size: number, family: string, prefix?: string): number => {
    const k = `${u.id}|${size}|${family}|${prefix ?? ''}`;
    let w = natCache.get(k);
    if (w === undefined) {
      const ws = shape(u, size, family, prefix);
      w = ws.reduce((a, x) => a + x.width, 0) + Math.max(0, ws.length - 1) * size * 0.3;
      natCache.set(k, w);
    }
    return w;
  };
  // pitch / line-count ratios learned from the last exact measurement
  let pitchP = lh(pasukSize) * 1.15;
  let pitchO = lh(onkSize) * 1.1;
  let pitchB = 1.1;
  const learnFrom = (m: Measured | null) => {
    if (!m) return;
    pitchP = m.pasukPitch;
    pitchO = m.onkPitch;
    const ratios = [...m.bandPitch.entries()].map(([k, v]) => v / lh(bands.find(b => b.key === k)!.sizePt));
    if (ratios.length) pitchB = Math.max(...ratios);
  };
  const estimateHeight = (from: number, to: number): number => {
    let pW = 0;
    for (let k = from; k < to; k++) pW += natWidth(pesukim[k], pasukSize, pasukFont, pasukLabel(k));
    let h = Math.ceil(pW / (pasukW * 0.98)) * pitchP;
    if (hasOnkelos) {
      let oW = 0;
      for (let k = from; k < to; k++) for (const u of onkByPasuk.get(k) ?? []) oW += natWidth(u, onkSize, onkFont);
      h = Math.max(h, (Math.ceil(oW / (onkW * 0.98)) + 1) * pitchO);
    }
    for (const b of bands) {
      let bW = 0;
      for (let k = from; k < to; k++) for (const u of b.byPasuk.get(k) ?? []) bW += natWidth(u, b.sizePt, b.fontFamily);
      const carried = carry.get(b.key)?.length ?? 0;
      if (!bW && !carried) continue;
      const lines = Math.ceil(bW / (colW * 0.98)) + carried;
      h += MG_FIT.bandGapPt + lh(titleSize(b)) + Math.ceil(lines / 2) * lh(b.sizePt) * pitchB;
    }
    return h;
  };

  // ── paginate ──────────────────────────────────────────────────────
  const pages: PageTypesetResult[] = [];
  // Introductions (a commentary's הקדמה before its first "פרק") open the
  // book: pages of their own, in their commentary's band, before the
  // pesukim. A bare author line or label (< 30 words) is not a page.
  let prefaceActive = false;
  {
    const introByBand = new Map<string, ContentUnit[]>();
    for (const u of intro) {
      const key = `file:${u.importFileIndex}`;
      if (bandByKey.has(key)) introByBand.set(key, [...(introByBand.get(key) ?? []), u]);
    }
    for (const b of bands) {
      const us = introByBand.get(b.key);
      if (!us) continue;
      const words = us.reduce((n, u) => n + u.rawText.split(/\s+/).filter(Boolean).length, 0);
      if (words < 30) continue;
      carry.set(b.key, setLines(us.flatMap(u => shape(u, b.sizePt, b.fontFamily)), colW, b.sizePt, b.fontFamily, us[0].role, us[0].id));
      prefaceActive = true;
    }
  }

  let cursor = 0;
  let p = 0;
  while ((cursor < pesukim.length || [...carry.values()].some(l => l.length)) && p < 2000) {
    const introPage = prefaceActive;
    // Largest run of pesukim whose commentaries all fit.
    // The height only grows with more pesukim. Estimate the page from
    // natural word widths (cheap — words are shaped once), then measure
    // EXACTLY only around the estimate, stepping to the boundary: the same
    // answer as trying every count, in ~2–3 full measurements per page
    // instead of ~12 (a whole Bereishit took seconds).
    let best: Measured | null = null;
    let bestTo = cursor;
    if (introPage) {
      best = measure(cursor, cursor, true); // introduction pages: bands only
    } else if (cursor < pesukim.length) {
      let est = cursor + 1;
      while (est < pesukim.length && estimateHeight(cursor, est + 1) <= contentH) est++;
      let m = measure(cursor, est, true);
      if (m.height <= contentH) {
        best = m;
        bestTo = est;
        while (bestTo < pesukim.length) {
          const next = measure(cursor, bestTo + 1, true);
          if (next.height > contentH) break;
          best = next;
          bestTo++;
        }
      } else {
        let to = est;
        while (to > cursor + 1) {
          to--;
          m = measure(cursor, to, true);
          if (m.height <= contentH) break;
        }
        best = m; // a page always takes at least one pasuk
        bestTo = to;
      }
      learnFrom(best);
    }
    if (!best) best = measure(cursor, cursor, true); // carry-only page (end of book)

    // Place the top block.
    const recto = p % 2 === 0; // body page 1 is a recto (left-hand page, binds on its right)
    const onkOnRight = recto; // Onkelos on the INNER (binding) side
    const pasukX: [number, number] = hasOnkelos ? (onkOnRight ? [0, pasukW] : [contentW - pasukW, contentW]) : [0, contentW];
    const onkX: [number, number] = onkOnRight ? [contentW - onkW, contentW] : [0, onkW];
    const sourceLines: TypesetLine[] = [];
    const extra: TypesetLine[] = [];
    const place = (l: TypesetLine, x: [number, number], y: number, size: number, pitch?: number) => {
      const asc = size * 0.8;
      // A pitch opened for teamim leaves the extra room evenly above and below.
      const extraTop = pitch !== undefined ? Math.max(0, (pitch - lh(size)) / 2) : 0;
      y += extraTop;
      const out: TypesetLine = { ...l, words: l.words.map(w => ({ ...w })) };
      out.xLeft = x[0];
      out.xRight = x[1];
      out.targetWidth = Math.min(l.targetWidth || x[1] - x[0], x[1] - x[0]);
      out.yBaseline = y + asc;
      out.yTop = y;
      out.yBottom = y + size * 1.04;
      out.ascent = asc;
      out.descent = size * 0.24;
      return out;
    };
    let y = 0;
    best.pasukLines.forEach(l => {
      if (y + best!.pasukPitch > contentH + 0.5 && sourceLines.length > 0) return;
      sourceLines.push(place(l, pasukX, y, pasukSize, best!.pasukPitch));
      y += best!.pasukPitch;
    });
    let yo = 0;
    if (hasOnkelos && best.onkLines.length) {
      const title = setLines(engine(onkSize, onkFont).shapeContentUnit({ id: 'onk-title', role: 'verse', rawText: 'אונקלוס', styleName: '', order: 0, hierarchyLevel: 0 } as ContentUnit), onkW, onkSize, onkFont, 'verse', 'onk-title')[0];
      if (title) extra.push({ ...place(title, onkX, yo, onkSize), alignment: 'center', paragraphAlignment: 'center', isJustified: false, fontWeight: 700 });
      yo += lh(onkSize);
      for (const l of best.onkLines) {
        extra.push(place(l, onkX, yo, onkSize, best.onkPitch));
        yo += best.onkPitch;
      }
    }
    y = Math.max(y, yo);

    // Commentary bands: title, then two balanced columns (right first).
    carry.clear();
    for (const b of bands) {
      const lines = best.bandLines.get(b.key);
      if (!lines?.length) continue;
      const tl = lh(titleSize(b));
      const ll = best.bandPitch.get(b.key) ?? lh(b.sizePt);
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
      right.forEach((l, i) => extra.push(place(l, [contentW - colW, contentW], y + i * ll, b.sizePt, ll)));
      left.forEach((l, i) => extra.push(place(l, [0, colW], y + i * ll, b.sizePt, ll)));
      y += rows * ll;
      if (take < lines.length) carry.set(b.key, lines.slice(take));
    }

    // Every line of a page gets its own index: the screen preview keys its
    // line elements by it, and bands / Onkelos restart at 0 — duplicate
    // keys left the previous page's lines on screen, piled over this one.
    sourceLines.forEach((l, i) => (l.lineIndex = i));
    extra.forEach((l, i) => (l.lineIndex = sourceLines.length + i));

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
      chumashFirstPasuk: !introPage && cursor < pesukim.length ? cursor : undefined,
      chumashHeadings: headingTexts,
      chumashIntro: introPage || undefined,
    } as PageTypesetResult);
    cursor = bestTo;
    p++;
    if (prefaceActive && ![...carry.values()].some(l => l.length)) prefaceActive = false;
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
