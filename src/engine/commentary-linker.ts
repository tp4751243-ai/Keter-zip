/**
 * v0.9.8 Phase 3 — CommentaryLinkerEngine: Dibbur HaMatchil
 * auto-linking with fuzzy Hebrew matching.
 *
 * VERIFY-FIRST record — what already existed (built on, not replaced):
 * - `DocxImporter.autoLinkCommentariesToSource` (docx-importer.ts):
 *   per-role monotonic cursors, 4 stages (pre-set 1.0 / exact token
 *   subsequence 1.0–0.9 / fuzzy word-coverage 0.5–0.9 / contextual
 *   fallback 0.4), review queue below 0.8 via `flagUncertainMatches`.
 *   It has NO Levenshtein / N-gram scoring, NO char offsets, and its
 *   windows are unit-index based (±6/15 units), not word based.
 * - `normalizeHebrewForMatch` (vilna-shas.ts): strips nikud/taamim +
 *   punctuation, but does NOT fold final letters and does NOT handle
 *   ktiv malei/chaser.
 * - `hebrew-search.ts`: full cell model — ktiv dropping
 *   (`normalizeKtiv`), final-letter folding (internal), prefix
 *   expansion, Yiddish-safe mode. Built for search, not for linking.
 * - Phase 2 `DibburNode` (docx-semantics.ts): { id, rawText,
 *   normalizedText, targetAnchorId, confidence, method } on each
 *   commentary unit — the tokenisation output this engine consumes.
 *
 * What this module ADDS (genuine gaps):
 * 1. ONE canonical matching normaliser, `normalizeHebrewForMatching`:
 *    strips nikkud (U+0591–U+05C7) + ta'amim, ד"ה / בד"ה prefixes,
 *    punctuation + quotation marks (", ״, ', ׳), folds final letters
 *    (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ), and — as a SECONDARY key only —
 *    ktiv malei/chaser-insensitive form via hebrew-search's
 *    `normalizeKtiv`. It composes the existing `stripNikudTaamim` /
 *    `normalizeKtiv` helpers instead of re-implementing them; the
 *    final-letter map is the only duplicated constant (hebrew-search
 *    does not export its table).
 * 2. `levenshtein` + `ngramSimilarity` (Dice on character bigrams) +
 *    `wordSimilarity` (exact → ktiv-equal → Levenshtein, with a
 *    one-letter משה-וכלב prefix tolerance).
 * 3. Sequential sliding-window anchor resolution in WORD space:
 *    commentaries follow main-text order; a monotonic per-role cursor
 *    with a ~30-word lookback buffer and a ~500-word forward window.
 *    Each commentary paragraph gets targetMainNodeId +
 *    targetCharOffset + linkConfidence 0.0–1.0.
 * 4. `LinkingReport` (total / linked / high / medium / review /
 *    unmatched) + `formatLinkingReportSummary` for the EXISTING
 *    import review queue — no second review UI.
 * 5. `AnchorLink` constraints (`dibburNodesToAnchorLinks`,
 *    `anchorLinksToRavTextLinks`) that the paginator consumes as
 *    explicit RavTextLinks, so same-page gravity (Phase 4) is fed by
 *    real links, not guesses.
 *
 * What it deliberately does NOT do: no contextual guessing. When no
 * direct or fuzzy match clears the threshold the dibbur is recorded
 * `unmatched` (confidence kept, no target) and surfaced in the report
 * and the review queue via a low-confidence link to the current sugya
 * position — the same visibility the old linker's 0.4 contextual
 * fallback gave, but labelled as unmatched instead of a match.
 */

import type { AnchorLink, ContentRole, ContentUnit, DibburNode, LinkingReport, RavTextLink } from '../types/typesetter';
import { normalizeHebrewForMatch, detectDibburFromSource } from './vilna-shas';
import { stripNikudTaamim, normalizeKtiv } from './hebrew-search';
import { CONFIDENT_MATCH_THRESHOLD } from './docx-importer';

/* ── 1. One canonical matching normaliser ─────────────────────────── */

/** Final (sofit) letters → medial forms, for position-independent matching. */
const FINAL_TO_MEDIAL: Record<string, string> = {
  'ך': 'כ',
  'ם': 'מ',
  'ן': 'נ',
  'ף': 'פ',
  'ץ': 'צ',
};

/** Leading ד"ה / בד"ה prefixes (with either gershayim form) + brackets/quotes. */
const DIBBUR_PREFIX_RE = /^(?:[\s([{״"׳'])*(?:בד[״"]ה|ד[״"]ה)\s+/;
const PUNCT_RE = /[״״"׳'.,:;!?—–\-()[\]{}<>׀]/g;

/**
 * The ONE normaliser for dibbur matching. Pipeline (applied identically
 * to dibbur and source text):
 *   1. Strip nikkud + ta'amim (U+0591–U+05C7) — reuses
 *      hebrew-search `stripNikudTaamim`.
 *   2. Strip a leading ד"ה / בד"ה prefix.
 *   3. Strip punctuation + quotation marks (", ״, ', ׳).
 *   4. Fold final letters to medial forms.
 *   5. Collapse whitespace.
 * KEEPING ו/י intact here: ktiv malei/chaser handling is the separate
 * secondary key `normalizeHebrewForMatchingKtivInsensitive` — dropping
 * matres lectionis in the primary key would over-merge distinct words.
 */
const MATCH_CACHE = new Map<string, string>();
export function normalizeHebrewForMatching(text: string): string {
  if (!text) return '';
  if (text.length <= 64) {
    const hit = MATCH_CACHE.get(text);
    if (hit !== undefined) return hit;
    const out = normalizeHebrewForMatchingUncached(text);
    if (MATCH_CACHE.size > 200000) MATCH_CACHE.clear();
    MATCH_CACHE.set(text, out);
    return out;
  }
  return normalizeHebrewForMatchingUncached(text);
}

function normalizeHebrewForMatchingUncached(text: string): string {
  let out = stripNikudTaamim(text);
  out = out.replace(DIBBUR_PREFIX_RE, '');
  // Gershayim / gersh / ASCII quotes sit INSIDE words (רש״י, ד״ה) — they
  // are deleted, not spaced: spacing them would split one word into
  // two ("רש י") and break token matching.
  out = out.replace(/[״׳"']/g, '');
  out = out.replace(PUNCT_RE, ' ');
  out = out
    .split('')
    .map(ch => FINAL_TO_MEDIAL[ch] ?? ch)
    .join('');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Secondary key: the primary normalisation plus ktiv malei/chaser
 * insensitivity (medial/final ו/י dropped — reuses hebrew-search
 * `normalizeKtiv`). דוד and דָּוִד both reduce to the same key.
 * Used only as a fallback equality test, never as the primary key.
 */
// Words recur thousands of times in a whole book (every comparison of a
// dibbur word with a source word normalizes both): cache by string.
const KTIV_CACHE = new Map<string, string>();
export function normalizeHebrewForMatchingKtivInsensitive(text: string): string {
  const hit = KTIV_CACHE.get(text);
  if (hit !== undefined) return hit;
  const out = normalizeKtiv(normalizeHebrewForMatching(text));
  if (KTIV_CACHE.size > 200000) KTIV_CACHE.clear();
  KTIV_CACHE.set(text, out);
  return out;
}

/** Normalise one word for matching (primary key). */
export function normalizeWordForMatching(word: string): string {
  return normalizeHebrewForMatching(word);
}

/* ── 2. String similarity ─────────────────────────────────────────── */

/** Classic Levenshtein edit distance (insert/delete/substitute = 1). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Dice coefficient over character n-grams (default bigrams). 0–1. */
export function ngramSimilarity(a: string, b: string, n: number = 2): number {
  if (a === b) return 1;
  if (a.length < n || b.length < n) return a === b ? 1 : 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i <= s.length - n; i++) {
      const g = s.slice(i, i + n);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const [g, c] of ga) shared += Math.min(c, gb.get(g) ?? 0);
  return (2 * shared) / (a.length - n + 1 + (b.length - n + 1));
}

const MOSHE_VECHALAV = new Set(['ב', 'כ', 'ל', 'מ', 'ו', 'ה', 'ש']);

/**
 * Word-level similarity 0–1 between two already-normalised words:
 * exact → 1; ktiv-insensitive equal → 0.95; one-letter משה-וכלב
 * prefix difference → 0.9; otherwise Levenshtein-based, accepted
 * only for small edits on words of length ≥ 4 (else 0 — a 1-letter
 * edit on a 2-letter word is not evidence of anything).
 */
export function wordSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (normalizeHebrewForMatchingKtivInsensitive(a) === normalizeHebrewForMatchingKtivInsensitive(b)) return 0.95;
  if (a.length >= 3 && b.length >= 3) {
    if (a.slice(1) === b || b.slice(1) === a) {
      const dropped = a.length > b.length ? a[0] : b[0];
      if (MOSHE_VECHALAV.has(dropped)) return 0.9;
    }
  }
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 4) return 0;
  const dist = levenshtein(a, b);
  if (dist > 2) return 0;
  return Math.max(0, 1 - dist / maxLen);
}

/* ── 3. Sliding-window anchor resolution ──────────────────────────── */

export interface LinkerOptions {
  /** Words the search may look back behind the cursor. Default 30. */
  lookbackWords?: number;
  /** Words the search may look ahead of the cursor. Default 500. */
  forwardWindowWords?: number;
  /** Minimum fuzzy span score to accept (0–1). Default 0.65. */
  fuzzyAcceptScore?: number;
  /** Score below which a link goes to the review queue. Default 0.8. */
  reviewThreshold?: number;
  /** High-confidence line in the report. Default 0.9. */
  highConfidenceThreshold?: number;
}

export const DEFAULT_LINKER_OPTIONS: Required<LinkerOptions> = {
  lookbackWords: 30,
  forwardWindowWords: 500,
  fuzzyAcceptScore: 0.65,
  reviewThreshold: CONFIDENT_MATCH_THRESHOLD,
  highConfidenceThreshold: 0.9,
};

interface SourceWord {
  /** Index into the flat source word stream. */
  streamIndex: number;
  unitId: string;
  unitIndex: number;
  wordIndexInUnit: number;
  /** Character offset of this word inside its unit's rawText. */
  charOffset: number;
  /** Original word as printed. */
  original: string;
  /** Primary normalised key. */
  normalized: string;
  /** Ktiv-insensitive key. */
  ktivNormalized: string;
}

/**
 * Flatten the source units into one ordered word stream, keeping the
 * exact character offset of every word in its unit (so an AnchorLink
 * can point at the precise source phrase, not just the unit).
 */
export function buildSourceWordIndex(sourceUnits: ContentUnit[]): SourceWord[] {
  const stream: SourceWord[] = [];
  sourceUnits.forEach((unit, unitIndex) => {
    const text = unit.rawText ?? '';
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    let wordIndexInUnit = 0;
    while ((m = re.exec(text)) !== null) {
      const original = m[0];
      const normalized = normalizeHebrewForMatching(original);
      if (!normalized) continue;
      stream.push({
        streamIndex: stream.length,
        unitId: unit.id,
        unitIndex,
        wordIndexInUnit,
        charOffset: m.index,
        original,
        normalized,
        ktivNormalized: normalizeHebrewForMatchingKtivInsensitive(original),
      });
      wordIndexInUnit++;
    }
  });
  return stream;
}

function roleCursorKey(role: ContentRole): string {
  if (role === 'secondary_comment') return 'secondary_comment';
  if (role === 'tertiary_comment') return 'tertiary_comment';
  return 'primary_comment';
}

function commentaryTypeFor(role: ContentRole): RavTextLink['commentaryType'] {
  if (role === 'secondary_comment') return 'Tosafot';
  if (role === 'tertiary_comment') return 'Other';
  return 'Rashi';
}

interface DibburResolution {
  dibburText: string;
  dibburSource: AnchorLink['dibburSource'];
  dibburId?: string;
}

function resolveDibburText(unit: ContentUnit, sourceUnits: ContentUnit[]): DibburResolution {
  if (unit.dibburNode?.rawText) {
    return { dibburText: unit.dibburNode.rawText, dibburSource: 'dibbur-node', dibburId: unit.dibburNode.id };
  }
  if (unit.dibburHamatchil) {
    return { dibburText: unit.dibburHamatchil, dibburSource: 'dibbur-field' };
  }
  const found = detectDibburFromSource(unit.rawText, sourceUnits);
  if (found) return { dibburText: found.dibbur, dibburSource: 'source-match' };
  return { dibburText: '', dibburSource: 'none' };
}

/**
 * Link every commentary unit's dibbur to its source anchor.
 *
 * Order is document order; each role (Rashi / Tosafot / tertiary) has
 * its own monotonic cursor into the flat source word stream, so a
 * commentary can never link backwards past the previous match except
 * inside the ~30-word lookback buffer, and never jumps more than
 * ~500 words ahead of the sugya's current position. Exact token
 * subsequence wins (1.0 verbatim / 0.95 normalised); otherwise the
 * best fuzzy span in the window wins when its mean word similarity
 * clears `fuzzyAcceptScore` (confidence 0.5 + 0.4 × score, capped
 * 0.9); otherwise the dibbur is recorded `unmatched` — never guessed.
 */
export function linkCommentariesToSource(
  sourceUnits: ContentUnit[],
  commentaryUnits: ContentUnit[],
  opts: LinkerOptions = {}
): AnchorLink[] {
  const o = { ...DEFAULT_LINKER_OPTIONS, ...opts };
  const stream = buildSourceWordIndex(sourceUnits);
  const byId = new Map(sourceUnits.map(u => [u.id, u]));
  const cursors: Record<string, number> = {
    primary_comment: 0,
    secondary_comment: 0,
    tertiary_comment: 0,
  };
  const links: AnchorLink[] = [];

  for (const com of commentaryUnits) {
    const linkId = `anchor-${com.id}`;
    const { dibburText, dibburSource, dibburId } = resolveDibburText(com, sourceUnits);
    const base: Omit<AnchorLink, 'linkConfidence' | 'method'> = {
      linkId,
      commentaryUnitId: com.id,
      dibburId,
      dibburText,
      dibburSource,
    };
    const unmatched = (confidence: number): AnchorLink => ({
      ...base,
      linkConfidence: confidence,
      method: 'unmatched',
    });

    if (!dibburText) {
      links.push(unmatched(0));
      continue;
    }
    const dibburWords = normalizeHebrewForMatching(dibburText)
      .split(' ')
      .filter(Boolean);
    if (dibburWords.length === 0) {
      links.push(unmatched(0));
      continue;
    }

    const key = roleCursorKey(com.role);
    const cursor = cursors[key] ?? 0;
    const winStart = Math.max(0, cursor - o.lookbackWords);
    const winEnd = Math.min(stream.length, cursor + o.forwardWindowWords);
    if (winStart >= winEnd) {
      links.push(unmatched(0));
      continue;
    }

    // — Exact token-subsequence match in the window (primary key, then
    // ktiv-insensitive key). Prefer the earliest match at/after the
    // cursor; a match inside the lookback buffer is the fallback. —
    const exactAt = (from: number, to: number): number => {
      for (let i = from; i + dibburWords.length <= to; i++) {
        let ok = true;
        for (let j = 0; j < dibburWords.length; j++) {
          const sw = stream[i + j];
          if (sw.normalized !== dibburWords[j] && sw.ktivNormalized !== normalizeHebrewForMatchingKtivInsensitive(dibburWords[j])) {
            ok = false;
            break;
          }
        }
        if (ok) return i;
      }
      return -1;
    };
    let hit = exactAt(cursor, winEnd);
    if (hit < 0) hit = exactAt(winStart, cursor);
    if (hit >= 0) {
      const first = stream[hit];
      const target = byId.get(first.unitId);
      const verbatim = !!target && target.rawText.includes(dibburText);
      const end = hit + dibburWords.length;
      // Monotonic: a match inside the lookback buffer must NOT move
      // the cursor backwards — the sugya only advances.
      cursors[key] = Math.max(cursor, end);
      links.push({
        ...base,
        targetMainNodeId: first.unitId,
        targetCharOffset: first.charOffset,
        targetWordIndex: first.wordIndexInUnit,
        linkConfidence: verbatim ? 1.0 : 0.95,
        method: 'exact',
        matchedText: target
          ? target.rawText.slice(first.charOffset, first.charOffset + dibburText.length + 8)
          : undefined,
      });
      continue;
    }

    // — Fuzzy span match: slide a dibbur-length window over the search
    // window; score = mean wordSimilarity, tie-broken by bigram
    // similarity of the joined span. —
    let bestScore = 0;
    let bestStart = -1;
    let bestNgram = 0;
    const dibburJoined = dibburWords.join(' ');
    for (let i = winStart; i + dibburWords.length <= winEnd; i++) {
      let sum = 0;
      for (let j = 0; j < dibburWords.length; j++) {
        sum += wordSimilarity(dibburWords[j], stream[i + j].normalized);
      }
      const mean = sum / dibburWords.length;
      if (mean <= bestScore) continue;
      const spanJoined = stream.slice(i, i + dibburWords.length).map(w => w.normalized).join(' ');
      const ng = ngramSimilarity(dibburJoined, spanJoined);
      if (mean === bestScore && ng <= bestNgram) continue;
      bestScore = mean;
      bestStart = i;
      bestNgram = ng;
    }

    if (bestStart >= 0 && bestScore >= o.fuzzyAcceptScore) {
      const first = stream[bestStart];
      const target = byId.get(first.unitId);
      // Monotonic: same lookback rule as the exact branch above.
      cursors[key] = Math.max(cursor, bestStart + dibburWords.length);
      links.push({
        ...base,
        targetMainNodeId: first.unitId,
        targetCharOffset: first.charOffset,
        targetWordIndex: first.wordIndexInUnit,
        linkConfidence: Math.min(0.9, 0.5 + bestScore * 0.4),
        method: 'fuzzy',
        matchedText: target
          ? target.rawText.slice(first.charOffset, first.charOffset + dibburText.length + 8)
          : undefined,
      });
      continue;
    }

    // No direct or fuzzy match clears the threshold: record unmatched
    // (confidence kept as the best fuzzy evidence, so the review queue
    // can show how close it came) and do NOT move the cursor.
    links.push(unmatched(bestStart >= 0 ? Math.min(0.7, 0.5 + bestScore * 0.4) : 0));
  }

  return links;
}

/* ── 4. LinkingReport ─────────────────────────────────────────────── */

/**
 * Summarise one linking run. Counts follow the importer's scale:
 * high ≥ 0.9, medium 0.8–0.9, review = linked but < 0.8.
 */
export function buildLinkingReport(links: AnchorLink[], opts: LinkerOptions = {}): LinkingReport {
  const o = { ...DEFAULT_LINKER_OPTIONS, ...opts };
  const unmatched = links.filter(l => l.method === 'unmatched' || !l.targetMainNodeId);
  const linked = links.filter(l => l.method !== 'unmatched' && l.targetMainNodeId);
  return {
    totalDibburim: links.length,
    linkedCount: linked.length,
    highConfidenceCount: linked.filter(l => l.linkConfidence >= o.highConfidenceThreshold).length,
    mediumConfidenceCount: linked.filter(
      l => l.linkConfidence >= o.reviewThreshold && l.linkConfidence < o.highConfidenceThreshold
    ).length,
    reviewCount: linked.filter(l => l.linkConfidence < o.reviewThreshold).length,
    unmatchedCount: unmatched.length,
    unmatched,
    links,
  };
}

/** Derive the same report from RavTextLinks (e.g. the old linker's output). */
export function linkingReportFromRavTextLinks(links: RavTextLink[], opts: LinkerOptions = {}): LinkingReport {
  const o = { ...DEFAULT_LINKER_OPTIONS, ...opts };
  const anchorish: AnchorLink[] = links.map(l => ({
    linkId: `anchor-${l.commentaryUnitId}`,
    commentaryUnitId: l.commentaryUnitId,
    dibburText: l.dibburHamatchil,
    targetMainNodeId: l.sourceUnitId,
    linkConfidence: l.matchConfidence?.score ?? l.confidenceScore ?? 0,
    method: (l.matchConfidence?.score ?? l.confidenceScore ?? 0) >= 0.9 ? 'exact' : 'fuzzy',
    dibburSource: 'dibbur-field',
    matchedText: l.matchConfidence?.matchedText ?? l.sourceSnippet,
  }));
  return buildLinkingReport(anchorish, o);
}

/**
 * One-line bilingual summary for the review queue, in the same
 * composition style as Phase 2 `formatPreviewCounts`: counts through
 * the caller's `t()` (every noun has an EN_STRINGS entry) and numbers
 * in the UI language's locale.
 *
 * v0.9.8 Bilingual Audit — singular verb/noun when the count is
 * exactly 1 ("1 D.H. linked", "1 awaiting review", "1 unlinked").
 * 'בוודאות גבוהה' is adverbial and has no singular/plural distinction.
 */
export function formatLinkingReportSummary(
  report: LinkingReport,
  t: (he: string) => string,
  lang: 'he' | 'en'
): string {
  const locale = lang === 'en' ? 'en-US' : 'he-IL';
  const n = (v: number) => v.toLocaleString(locale);
  const word = (count: number, singular: string, plural: string) =>
    count === 1 ? t(singular) : t(plural);
  return (
    `${n(report.linkedCount)} ${t('ד״ה')} ${word(report.linkedCount, 'קושר', 'קושרו')} · ` +
    `${n(report.highConfidenceCount)} ${t('בוודאות גבוהה')} · ` +
    `${n(report.reviewCount)} ${word(report.reviewCount, 'ממתין לסקירה', 'ממתינים לסקירה')} · ` +
    `${n(report.unmatchedCount)} ${word(report.unmatchedCount, 'לא קושר', 'לא קושרו')}`
  );
}

/* ── 5. DibburNode → AnchorLink, and conversion to RavTextLink ───── */

/**
 * Consume the Phase 2 tokenisation output: link exactly the units
 * that carry a DibburNode (plus any commentary unit whose dibbur is
 * only in `dibburHamatchil` — those resolve via the same path).
 * The node id travels on the AnchorLink as `dibburId`.
 */
export function dibburNodesToAnchorLinks(
  units: ContentUnit[],
  sourceUnits: ContentUnit[],
  opts: LinkerOptions = {}
): AnchorLink[] {
  const commentaries = units.filter(
    u =>
      (u.role === 'primary_comment' || u.role === 'secondary_comment' || u.role === 'tertiary_comment') &&
      (u.dibburNode ?? u.dibburHamatchil)
  );
  return linkCommentariesToSource(sourceUnits, commentaries, opts);
}

/**
 * Convert AnchorLinks to RavTextLinks so the EXISTING review queue
 * (`flagUncertainMatches`, DocxImportHub) and the paginator consume
 * them unchanged. Unmatched entries become low-confidence links to
 * the current sugya position (the source unit at the cursor) — the
 * same visibility the old linker's 0.4 contextual fallback gave —
 * but labelled `unmatched` in the reason, never presented as a match.
 * The caller supplies the fallback source unit (the sugya position);
 * when none is given an unmatched entry produces no RavTextLink.
 */
export function anchorLinksToRavTextLinks(
  anchorLinks: AnchorLink[],
  units: ContentUnit[],
  fallbackSourceUnit?: ContentUnit
): RavTextLink[] {
  const byId = new Map(units.map(u => [u.id, u]));
  const out: RavTextLink[] = [];
  for (const a of anchorLinks) {
    const com = byId.get(a.commentaryUnitId);
    if (!com) continue;
    const target = a.targetMainNodeId ? byId.get(a.targetMainNodeId) : undefined;
    const effectiveTarget = target ?? fallbackSourceUnit;
    if (!effectiveTarget) continue;
    const isUnmatched = a.method === 'unmatched' || !target;
    const score = isUnmatched ? Math.min(0.4, a.linkConfidence || 0.35) : a.linkConfidence;
    const reason =
      a.method === 'exact'
        ? { he: 'התאמה מדויקת של דיבור המתחיל (מנוע קישור חדש)', en: 'Exact dibur-hamatchil match (new linking engine)' }
        : a.method === 'fuzzy'
        ? { he: 'התאמה מטושטשת ללא ניקוד (מנוע קישור חדש)', en: 'Fuzzy match without nikud (new linking engine)' }
        : { he: 'לא נמצאה התאמה ישירה — הוקצה למיקום הנוכחי בסוגיא, ממתין לסקירה', en: 'No direct match found — assigned to the current sugya position, awaiting review' };
    out.push({
      linkId: `link-${a.commentaryUnitId}-${effectiveTarget.id}`,
      sourceUnitId: effectiveTarget.id,
      commentaryUnitId: a.commentaryUnitId,
      dibburHamatchil: a.dibburText,
      isUserLocked: false,
      confidenceScore: score,
      matchConfidence: {
        score,
        reasonHe: reason.he,
        reasonEn: reason.en,
        matchedText: a.matchedText ?? effectiveTarget.rawText.substring(0, 60),
      },
      sourceSnippet: effectiveTarget.rawText.substring(0, 60),
      commentarySnippet: com.rawText.substring(0, 60),
      commentaryType: commentaryTypeFor(com.role),
    });
  }
  return out;
}

/**
 * Merge the new engine's links over the old linker's output: per
 * commentary unit keep the higher-confidence link. The old linker
 * stays the fallback for anything the new engine leaves unmatched
 * (its contextual 0.4 link still beats the new engine's unmatched
 * 0.35 when nothing better exists) — the merge never drops a
 * commentary from the review queue.
 */
export function mergeLinkSets(newLinks: RavTextLink[], oldLinks: RavTextLink[]): RavTextLink[] {
  const byCommentary = new Map<string, RavTextLink>();
  for (const l of oldLinks) byCommentary.set(l.commentaryUnitId, l);
  for (const l of newLinks) {
    const prev = byCommentary.get(l.commentaryUnitId);
    if (!prev || (l.confidenceScore ?? 0) >= (prev.confidenceScore ?? 0)) {
      byCommentary.set(l.commentaryUnitId, l);
    }
  }
  return [...byCommentary.values()];
}

/** Re-export of the shared normaliser for callers that need it. */
export { normalizeHebrewForMatch };
