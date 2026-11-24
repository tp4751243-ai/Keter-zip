/**
 * Layout training T12 — linking Rashi (and every other mefaresh) to its
 * PASUK in a whole Chumash.
 *
 * Reported: importing Bereishit + Onkelos + Rashi froze the app. Besides
 * the speed, the Gemara linkers placed only 129 of 2,016 Rashi comments
 * on the right pasuk (6%): they follow one cursor through the text, lose
 * it after a miss, and never recover — and 1,805 links were then sent to
 * a review screen that tried to draw 3 million dropdown rows.
 *
 * A Chumash has structure the Gemara linkers do not use:
 *  - every file has the same chapters ("פרק א" …), so a comment is only
 *    ever matched inside its own chapter;
 *  - comments follow the order of the pesukim, so the best assignment is
 *    the best MONOTONE alignment of comments to pesukim — solved exactly
 *    by dynamic programming (prefix maxima make it O(comments × pesukim)
 *    per chapter);
 *  - a dibbur hamatchil is the pasuk's own words: compared without nikkud
 *    and teamim, with maqaf split, ktiv male/chaser and one prefix letter
 *    (ו ה ב ל מ כ ש) tolerated.
 * A comment whose words are not found stays with the pasuk of the comment
 * before it (it continues that pasuk's comments) — confidently placed on
 * the right page, so it is not sent to review.
 */
import type { ContentUnit, RavTextLink } from '../types/typesetter';
import { parsePerekHeading } from './vilna-header';
import { parseHebrewNumeral } from './hebrew-numerals';

const PREFIX = new Set(['ו', 'ה', 'ב', 'ל', 'מ', 'כ', 'ש']);

/** Words of a text for matching: no nikkud/teamim, maqaf and punctuation split, final letters kept. */
export function chumashWords(text: string): string[] {
  return text
    .replace(/[֑-ֽֿ֯׀׃-ׇ]/g, '')
    .replace(/[ְ-ּׁׂ]/g, '')
    .replace(/[־\-–—]/g, ' ')
    .replace(/[״"׳'.,:;!?()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.replace(/[וי]/g, '') || w);
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 2 && b.length >= 2) {
    if (PREFIX.has(a[0]) && a.slice(1) === b) return true;
    if (PREFIX.has(b[0]) && b.slice(1) === a) return true;
  }
  return false;
}

/** The dibbur hamatchil of a comment: its words up to the first period / colon (≤ 8 words). */
export function dibburOf(u: ContentUnit): string {
  if (u.dibburHamatchil) return u.dibburHamatchil;
  const t = u.rawText.trim().replace(/^(?:ד["״]ה|רש["״]י)\s+/, '');
  const m = /^([^.:]{1,80}?)[.:]/.exec(t);
  return (m ? m[1] : t).split(/\s+/).slice(0, 8).join(' ');
}

/** How well a dibbur matches a pasuk: best contiguous run of its words, as a share (0…1). */
export function dibburScore(d: string[], p: string[]): number {
  if (!d.length || !p.length) return 0;
  let best = 0;
  for (let k = 0; k < p.length; k++) {
    if (!sameWord(d[0], p[k]) && !(d.length > 1 && sameWord(d[1], p[k]))) continue;
    // allow the run to start at the dibbur's first or second word
    for (const s0 of [0, 1]) {
      if (s0 >= d.length) continue;
      let n = 0;
      while (s0 + n < d.length && k + n < p.length && sameWord(d[s0 + n], p[k + n])) n++;
      const share = n / d.length;
      if (share > best) best = share;
    }
    if (best >= 1) break;
  }
  // a single common word ("את", "על") alone is weak evidence
  if (best > 0 && d.length >= 2 && best * d.length < 1.5) best *= 0.5;
  return best;
}

export interface ChumashLinkResult {
  links: RavTextLink[];
  /** Commentary units before the first chapter of their file (introductions). */
  introUnitIds: string[];
  /** Comments whose words were found in their chapter (the rest follow the comment before). */
  matched: number;
  total: number;
}

const COMMENT_ROLES = new Set(['primary_comment', 'secondary_comment', 'tertiary_comment', 'dibbur_hamatchil']);

/** "(א) בראשית…" → pasuk number and the text after it. */
export function leadingPasukNumber(text: string): { n: number; rest: string } | null {
  const m = /^\s*\(([א-ת"״׳']{1,4})\)\s*/.exec(text);
  if (!m) return null;
  const n = parseHebrewNumeral(m[1]);
  return n ? { n, rest: text.slice(m[0].length) } : null;
}

/** "פסוק יב" → 12. */
function pasukHeading(text: string): number | null {
  const m = /^\s*פסוק\s+([א-ת"״׳']{1,4})\s*$/.exec(text.replace(/[\u0591-\u05C7]/g, ''));
  return m ? parseHebrewNumeral(m[1]) : null;
}

export interface ChumashPosition {
  /** 0 = before the first "פרק" of its file (title, author line, introduction). */
  chapter: number;
  /** 0 = no pasuk known yet in this chapter. */
  pasuk: number;
  /** The pasuk number came from the text itself ("פסוק X" heading or "(X)"). */
  explicit: boolean;
}

/**
 * Chapter and pasuk of every unit, restarting per uploaded file
 * (importFileIndex): "פרק X" headings set the chapter, "פסוק X" headings
 * or a leading "(X)" set the pasuk; pesukim without numbers count up.
 */
export function chumashPositions(units: ContentUnit[]): Map<string, ChumashPosition> {
  const out = new Map<string, ChumashPosition>();
  let file: number | undefined = undefined;
  let ch = 0;
  let pasuk = 0;
  let explicit = false;
  for (const u of units) {
    if (u.importFileIndex !== file) {
      file = u.importFileIndex;
      ch = 0;
      pasuk = 0;
      explicit = false;
    }
    if (u.role === 'chapter' || u.role === 'heading' || u.role === 'subtitle') {
      const perek = /^\s*פרק\s/.test(u.rawText.replace(/[\u0591-\u05C7]/g, '')) ? parsePerekHeading(u.rawText)?.number : undefined;
      if (perek) {
        ch = perek;
        pasuk = 0;
        explicit = false;
      } else {
        const p = pasukHeading(u.rawText);
        if (p) {
          pasuk = p;
          explicit = true;
        }
      }
      out.set(u.id, { chapter: ch, pasuk, explicit });
      continue;
    }
    const lead = leadingPasukNumber(u.rawText);
    if (lead) {
      pasuk = lead.n;
      explicit = true;
    } else if (u.role === 'main_source' && ch > 0 && !explicit) {
      pasuk++;
    }
    out.set(u.id, { chapter: ch, pasuk, explicit });
  }
  return out;
}

/** Chapter of every unit (per file). */
export function chapterNumbers(units: ContentUnit[]): Map<string, number> {
  const pos = chumashPositions(units);
  return new Map([...pos].map(([id, p]) => [id, p.chapter]));
}

export function linkChumashCommentaries(units: ContentUnit[]): ChumashLinkResult {
  const pos = chumashPositions(units);
  const chap = new Map([...pos].map(([id, p]) => [id, p.chapter]));
  const pesukim = units.filter(u => u.role === 'main_source');
  // Introductions (before the first "פרק" of their file) belong to no pasuk.
  const comments = units.filter(u => COMMENT_ROLES.has(u.role) && (pos.get(u.id)?.chapter ?? 0) > 0);
  // Exact (chapter, pasuk) → pasuk unit, from the pesukim file.
  const pasukAt = new Map<string, ContentUnit>();
  for (const p of pesukim) {
    const q = pos.get(p.id);
    if (q && q.chapter > 0 && q.pasuk > 0 && !pasukAt.has(`${q.chapter}:${q.pasuk}`)) pasukAt.set(`${q.chapter}:${q.pasuk}`, p);
  }
  const byChapter = <T extends ContentUnit>(list: T[]) => {
    const m = new Map<number, T[]>();
    for (const u of list) {
      const c = chap.get(u.id) ?? 0;
      m.set(c, [...(m.get(c) ?? []), u]);
    }
    return m;
  };
  const pByCh = byChapter(pesukim);
  // Each commentator is aligned on its own (Rashi and Ramban each follow
  // the pesukim in order, but not each other).
  const streams = new Map<string, ContentUnit[]>();
  for (const c of comments) {
    const key = c.role === 'dibbur_hamatchil' ? 'primary_comment' : c.role;
    streams.set(key, [...(streams.get(key) ?? []), c]);
  }
  const pWords = new Map(pesukim.map(p => [p.id, chumashWords(p.rawText)]));
  const links: RavTextLink[] = [];
  let matched = 0;
  const allP = pesukim;
  for (const [, stream] of streams) {
    const cByCh = byChapter(stream);
    for (const [ch, cs] of cByCh) {
      // Without matching chapters on both sides, align against the whole book.
      const ps = pByCh.get(ch)?.length ? pByCh.get(ch)! : allP;
      const m = cs.length, n = ps.length;
      const dws = cs.map(c => chumashWords(dibburOf(c)));
      const S: Float32Array[] = dws.map(d => Float32Array.from(ps.map(p => dibburScore(d, pWords.get(p.id)!))));
      // best[i][j]: best total for comments 0..i with comment i on pasuk j (monotone).
      const best: Float32Array[] = [];
      for (let i = 0; i < m; i++) {
        const row = new Float32Array(n);
        let prefix = i === 0 ? 0 : -Infinity;
        for (let j = 0; j < n; j++) {
          if (i > 0) prefix = Math.max(prefix, best[i - 1][j]);
          row[j] = S[i][j] + prefix;
        }
        best.push(row);
      }
      // Backtrack: the last comment takes its best pasuk; each earlier one
      // the best pasuk not after the next one's — ties go to the EARLIEST
      // (an unmatched comment stays with the pasuk before it).
      const choice = new Array<number>(m);
      let limit = n - 1;
      for (let i = m - 1; i >= 0; i--) {
        let bj = 0;
        let bv = -Infinity;
        for (let j = 0; j <= limit; j++) {
          if (best[i][j] > bv + 1e-6) {
            bv = best[i][j];
            bj = j;
          }
        }
        choice[i] = bj;
        limit = bj;
      }
      cs.forEach((c, i) => {
        // A comment under "פסוק X" (or numbered "(X)") belongs to pasuk X.
        const q = pos.get(c.id);
        const exact = q && q.explicit && q.pasuk > 0 ? pasukAt.get(`${q.chapter}:${q.pasuk}`) : undefined;
        if (exact) {
          matched++;
          links.push({
            linkId: `chumash-${c.id}`,
            sourceUnitId: exact.id,
            commentaryUnitId: c.id,
            dibburHamatchil: dibburOf(c),
            isUserLocked: false,
            confidenceScore: 1,
            matchConfidence: { score: 1, reasonHe: 'פרק ופסוק מסומנים בקובץ', reasonEn: 'Chapter and pasuk marked in the file', matchedText: exact.rawText.slice(0, 60) },
            sourceSnippet: exact.rawText.slice(0, 60),
            commentarySnippet: c.rawText.slice(0, 60),
            commentaryType: c.role === 'secondary_comment' ? 'Ramban' : c.role === 'primary_comment' || c.role === 'dibbur_hamatchil' ? 'Rashi' : 'Other',
          });
          return;
        }
        const p = ps[choice[i]];
        const s = S[i][choice[i]];
        if (s >= 0.5) matched++;
        const score = s >= 0.99 ? 0.97 : s >= 0.5 ? 0.88 : 0.82;
        const reasonHe = s >= 0.99 ? 'דיבור המתחיל נמצא בפסוק' : s >= 0.5 ? 'רוב מילות הדיבור נמצאו בפסוק' : 'ממשיך את הפירוש הקודם באותו פסוק (סדר הפסוקים)';
        const reasonEn = s >= 0.99 ? 'Dibbur hamatchil found in the pasuk' : s >= 0.5 ? 'Most dibbur words found in the pasuk' : 'Continues the previous comment on the same pasuk (pasuk order)';
        links.push({
          linkId: `chumash-${c.id}`,
          sourceUnitId: p.id,
          commentaryUnitId: c.id,
          dibburHamatchil: dibburOf(c),
          isUserLocked: false,
          confidenceScore: score,
          matchConfidence: { score, reasonHe, reasonEn, matchedText: p.rawText.slice(0, 60) },
          sourceSnippet: p.rawText.slice(0, 60),
          commentarySnippet: c.rawText.slice(0, 60),
          commentaryType: c.role === 'secondary_comment' ? 'Ramban' : c.role === 'primary_comment' || c.role === 'dibbur_hamatchil' ? 'Rashi' : 'Other',
        });
      });
    }
  }
  const introUnitIds = units.filter(u => COMMENT_ROLES.has(u.role) && (pos.get(u.id)?.chapter ?? 0) === 0).map(u => u.id);
  return { links, matched, total: comments.length, introUnitIds };
}

/** Does this import look like a Chumash (pesukim with sof pasuk / teamim, or a Torah book title)? */
export function looksLikeChumash(units: ContentUnit[], title = ''): boolean {
  const ps = units.filter(u => u.role === 'main_source').slice(0, 200);
  if (!ps.length) return false;
  const sof = ps.filter(u => /׃\s*$|[֑-֯]/.test(u.rawText)).length;
  return sof >= ps.length * 0.5 || /בראשית|שמות|ויקרא|במדבר|דברים|חומש/.test(title.replace(/[֑-ׇ]/g, ''));
}

// ── Layout training T13 — Talmud: link by amud ("דף ב." headings) ─────────

/** "דף ב." / "דף ב:" / "דף ב ע״א" → a normalized amud key ("ב.", "ב:"); null otherwise. */
export function dafHeadingKey(text: string): string | null {
  const t = text.replace(/[֑-ׇ]/g, '').replace(/["״׳']/g, '').trim();
  const m = /^דף\s+([א-ת]{1,4})\s*([.:]|ע[אב])?\s*$/.exec(t);
  if (!m) return null;
  const side = m[2] === ':' || m[2] === 'עב' ? ':' : '.';
  return `${m[1]}${side}`;
}

/**
 * When every uploaded file marks its amudim ("דף ב." …), each Rashi /
 * Tosafot is matched only against the Gemara of ITS amud, by a monotone
 * alignment of dibbur words to the Gemara paragraphs (same scoring as the
 * Chumash linker). A whole Berakhot: no 10-second all-against-all scan,
 * and no thousand-link review queue. Returns null when the files carry no
 * amud headings (the Gemara linkers then run as before).
 */
export function linkByDafHeadings(units: ContentUnit[]): ChumashLinkResult | null {
  // amud of every unit, per file
  const amudOf = new Map<string, string>();
  let file: number | undefined = undefined;
  let cur = '';
  let headings = 0;
  for (const u of units) {
    if (u.importFileIndex !== file) {
      file = u.importFileIndex;
      cur = '';
    }
    if (u.role === 'heading' || u.role === 'chapter' || u.role === 'subtitle') {
      const k = dafHeadingKey(u.rawText);
      if (k) {
        cur = k;
        headings++;
      }
      continue;
    }
    amudOf.set(u.id, cur);
  }
  const sources = units.filter(u => u.role === 'main_source' && amudOf.get(u.id));
  const comments = units.filter(u => COMMENT_ROLES.has(u.role));
  const commentsWithAmud = comments.filter(c => amudOf.get(c.id));
  if (headings < 4 || sources.length === 0 || commentsWithAmud.length < comments.length * 0.8) return null;

  const srcByAmud = new Map<string, ContentUnit[]>();
  for (const s of sources) srcByAmud.set(amudOf.get(s.id)!, [...(srcByAmud.get(amudOf.get(s.id)!) ?? []), s]);
  const sWords = new Map(sources.map(s => [s.id, chumashWords(s.rawText)]));
  const links: RavTextLink[] = [];
  let matched = 0;
  const streams = new Map<string, ContentUnit[]>();
  for (const c of commentsWithAmud) {
    const key = `${c.importFileIndex ?? ''}|${c.role === 'dibbur_hamatchil' ? 'primary_comment' : c.role}`;
    streams.set(key, [...(streams.get(key) ?? []), c]);
  }
  for (const [, stream] of streams) {
    const byAmud = new Map<string, ContentUnit[]>();
    for (const c of stream) byAmud.set(amudOf.get(c.id)!, [...(byAmud.get(amudOf.get(c.id)!) ?? []), c]);
    for (const [amud, cs] of byAmud) {
      const ps = srcByAmud.get(amud);
      if (!ps?.length) continue; // no Gemara for this amud: leave unlinked
      const m = cs.length, n = ps.length;
      const S = cs.map(c => {
        const d = chumashWords(dibburOf(c));
        return Float32Array.from(ps.map(p => dibburScore(d, sWords.get(p.id)!)));
      });
      const best: Float32Array[] = [];
      for (let i = 0; i < m; i++) {
        const row = new Float32Array(n);
        let prefix = i === 0 ? 0 : -Infinity;
        for (let j = 0; j < n; j++) {
          if (i > 0) prefix = Math.max(prefix, best[i - 1][j]);
          row[j] = S[i][j] + prefix;
        }
        best.push(row);
      }
      const choice = new Array<number>(m);
      let limit = n - 1;
      for (let i = m - 1; i >= 0; i--) {
        let bj = 0;
        let bv = -Infinity;
        for (let j = 0; j <= limit; j++) if (best[i][j] > bv + 1e-6) { bv = best[i][j]; bj = j; }
        choice[i] = bj;
        limit = bj;
      }
      cs.forEach((c, i) => {
        const p = ps[choice[i]];
        const s = S[i][choice[i]];
        if (s >= 0.5) matched++;
        // Same amud is certain; the paragraph within it is a match or the
        // reading order — either way on the right daf, so never reviewed.
        const score = s >= 0.99 ? 0.97 : s >= 0.5 ? 0.9 : 0.85;
        links.push({
          linkId: `amud-${c.id}`,
          sourceUnitId: p.id,
          commentaryUnitId: c.id,
          dibburHamatchil: dibburOf(c),
          isUserLocked: false,
          confidenceScore: score,
          matchConfidence: {
            score,
            reasonHe: s >= 0.5 ? `דיבור המתחיל נמצא בגמרא (דף ${amud})` : `באותו עמוד (דף ${amud}), לפי סדר הקריאה`,
            reasonEn: s >= 0.5 ? `Dibbur found in the Gemara (daf ${amud})` : `Same amud (daf ${amud}), by reading order`,
            matchedText: p.rawText.slice(0, 60),
          },
          sourceSnippet: p.rawText.slice(0, 60),
          commentarySnippet: c.rawText.slice(0, 60),
          commentaryType: c.role === 'secondary_comment' ? 'Tosafot' : c.role === 'primary_comment' || c.role === 'dibbur_hamatchil' ? 'Rashi' : 'Other',
        });
      });
    }
  }
  return { links, matched, total: comments.length, introUnitIds: comments.filter(c => !amudOf.get(c.id)).map(c => c.id) };
}
