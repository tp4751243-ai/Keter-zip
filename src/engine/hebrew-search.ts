/**
 * Keter Hebrew-aware search engine (v0.3.0, module A)
 * Original offline code — no server, no network, no external data.
 *
 * Hebrew text is hard to search naively: the same word can appear with or
 * without nikud/taamim, in ktiv malei (full spelling, e.g. דוד) or ktiv
 * chaser (defective spelling, e.g. דָּוִד), and with prefixed letters
 * (ב/כ/ל/מ/ו/ה/ש — e.g. ובדוד, לדוד, שהדוד). This engine normalizes both
 * the query and the text through the same pipeline and maps every match
 * back to offsets in the ORIGINAL string, so highlights and replacements
 * land on the real text with its nikud intact.
 *
 * Pipeline (applied identically to query and text):
 *   1. Parse into cells: one base character + its attached combining marks
 *      (nikud/taamim). Marks never break a word; they ride on their base.
 *   2. Ktiv normalization (optional): drop medial/final ו/י matres
 *      lectionis (דוד and דָּוִד both become "דד"), and fold final
 *      letters ך/ם/ן/ף/ץ to their medial forms כ/מ/נ/פ/צ.
 *   3. Nikud-insensitive matching (optional, default on): the match
 *      string is built from base characters only; with the toggle off,
 *      marks participate in the match.
 *   4. Prefix matching (optional): the QUERY is expanded with common
 *      משה וכלב prefixes (ב/כ/ל/מ/ו/ה/ש, plus ו+prefix and ב/כ/ל/מ+ה/ש),
 *      so searching "מלך" also finds "למלך", "ובמלך", "המלך". The text
 *      itself is never prefix-stripped — stripping the text would corrupt
 *      roots (מלך would become לך, שמים would become מים). Each hit
 *      records `coreStart`: where the query proper begins inside the
 *      matched word, so replace-all can keep a matched prefix (למלך ->
 *      לשר) while highlighting covers the whole word.
 *
 * The prefix/ktiv steps are heuristics: they can produce false positives
 * (e.g. a search for "בית" also matches "ביתו"), which is the intended
 * trade-off for a rabbinic-text search aid. Both are toggleable.
 *
 * v0.8.0 Part D — Yiddish: the ktiv step drops medial/final ו/י and
 * folds ף to פ. Applied to Yiddish that destroys words (װ/ױ/ײ are
 * built from ו/י, and ף is a distinct letter from פ/פּ), and the
 * משה וכלב prefix expansion is Hebrew morphology. `findAll` therefore
 * detects Yiddish text/query and switches those steps off
 * (`yiddishSafe`), and the letter regexes include the Yiddish-only
 * codepoints U+05F0–U+05F2 so a word containing װ/ױ/ײ is one word.
 */

import { isYiddishDominant } from './yiddish-sefarim';

export interface SearchOptions {
  /** Ignore nikud + taamim when matching. Default: true. */
  nikudInsensitive?: boolean;
  /** Match ktiv malei / ktiv chaser spellings as equal. Default: true. */
  ktivInsensitive?: boolean;
  /** Match words with/without משה וכלב prefixes. Default: true. */
  stripPrefixes?: boolean;
  /** Case-sensitive Latin matching. Default: false. */
  caseSensitive?: boolean;
  /** Allow matches starting inside a word (pure substring search).
   *  Default: false — a match must start at a word boundary, so searching
   *  "מים" never matches inside "שמים". Prefix expansion already covers
   *  prefixed forms (למלך, ובמלך), so this only matters for partial-word
   *  searches. */
  matchInsideWords?: boolean;
  /**
   * v0.8.0 Part D — Yiddish-safe matching. When true, the Hebrew-only
   * normalisations are switched off: ktiv dropping (which would delete
   * the medial/final ו/י that Yiddish words are built from — װ/ױ/ײ),
   * משה וכלב prefix expansion (Hebrew morphology, not Yiddish), and
   * final-letter folding (in Yiddish ף and פ/פּ are distinct letters).
   * `findAll` turns this on automatically when the text or the query
   * detects as Yiddish; callers can also set it explicitly.
   */
  yiddishSafe?: boolean;
}

export interface SearchHit {
  /** Offset in the ORIGINAL text (start of the matched word, including
   *  any matched prefix letters). */
  start: number;
  /** Offset in the ORIGINAL text (end, including trailing nikud/taamim). */
  end: number;
  /** The exact original substring that matched (nikud included). */
  matchedText: string;
  /** Offset in the ORIGINAL text where the query proper begins, i.e. the
   *  match minus a prefix added by query expansion. Equals `start` when
   *  no prefix was involved. Replace operations must replace only
   *  [coreStart, end) and keep [start, coreStart) intact. */
  coreStart?: number;
  /** Index of the unit inside the array passed to searchUnits(). */
  unitIndex?: number;
  /** Id of the unit the hit belongs to. */
  unitId?: string;
}

/** Loose structural shape of a searchable unit — accepts ContentUnit
 *  ({id, rawText}) as well as plain {id, text} / {id, content} objects. */
export interface SearchableUnit {
  id: string;
  rawText?: string;
  text?: string;
  content?: string;
}

export function getUnitText(unit: SearchableUnit): string {
  return unit.rawText ?? unit.text ?? unit.content ?? '';
}

// ---------------------------------------------------------------------------
// Character tables
// ---------------------------------------------------------------------------

/** Nikud + taamim combining marks: U+0591..U+05C7. */
const MARK_RE = /[֑-ׇ]/;
/** Final (sofit) letters -> medial forms, for position-independent matching. */
const FINAL_TO_MEDIAL: Record<string, string> = {
  'ך': 'כ',
  'ם': 'מ',
  'ן': 'נ',
  'ף': 'פ',
  'ץ': 'צ',
};
/** משה וכלב prefix letters. */
const PREFIX_LETTERS = new Set(['ב', 'כ', 'ל', 'מ', 'ו', 'ה', 'ש']);
/** Words whose first letter looks like a prefix but is part of the root.
 *  Never strip a prefix from these (checked against the post-strip form). */
const PREFIX_STRIP_STOPLIST = new Set([
  'שמים', 'שמש', 'שבת', 'שם', 'שנה', 'שלום', 'שער', 'שיר', 'שדה', 'שעה',
  'הנה', 'הוא', 'היא', 'הם', 'הן',
]);
const HEBREW_LETTER_RE = /[֐-תװ-ײ]/;
const LETTER_RE = /[֐-תװ-ײa-zA-Z]/;

// ---------------------------------------------------------------------------
// Cell model: one base character + its attached combining marks.
// ---------------------------------------------------------------------------

interface TextCell {
  base: string;
  marks: string;
  start: number;
  end: number;
}

function parseCells(text: string): TextCell[] {
  const cells: TextCell[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (MARK_RE.test(ch) && cells.length > 0) {
      cells[cells.length - 1].marks += ch;
      cells[cells.length - 1].end = i + 1;
      continue;
    }
    cells.push({ base: ch, marks: '', start: i, end: i + 1 });
  }
  return cells;
}

function cellsToString(cells: TextCell[]): string {
  return cells.map(c => c.base + c.marks).join('');
}

/** Runs of consecutive letter-cells (words), as [startIdx, endIdx) cell ranges. */
function wordRuns(cells: TextCell[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let i = 0;
  while (i < cells.length) {
    if (!LETTER_RE.test(cells[i].base)) {
      i++;
      continue;
    }
    let j = i;
    while (j < cells.length && LETTER_RE.test(cells[j].base)) j++;
    runs.push([i, j]);
    i = j;
  }
  return runs;
}

function stripPrefixesFromCells(cells: TextCell[]): TextCell[] {
  const drop = new Set<number>();
  for (const [start, end] of wordRuns(cells)) {
    // Never strip a word whose whole form is a known root that merely
    // looks prefixed (שמים is not ש+מים, שבת is not ש+בת). Compare raw
    // bases (no final-letter folding) so the set matches literally.
    const wholeWord = cells
      .slice(start, end)
      .map(c => c.base)
      .join('');
    if (PREFIX_STRIP_STOPLIST.has(wholeWord)) continue;
    let cursor = start;
    let stripped = 0;
    while (stripped < 2 && cursor < end - 1) {
      const base = cells[cursor].base;
      if (!PREFIX_LETTERS.has(base)) break;
      // Remaining word after this strip must still have >= 3 letters:
      // otherwise the "prefix" is really part of the root (מלך, not מ+לך).
      if (end - (cursor + 1) < 3) break;
      drop.add(cursor);
      cursor++;
      stripped++;
    }
  }
  return cells.filter((_, idx) => !drop.has(idx));
}

function applyKtivToCells(cells: TextCell[]): TextCell[] {
  const drop = new Set<number>();
  for (const [start, end] of wordRuns(cells)) {
    for (let i = start + 1; i < end; i++) {
      // Medial/final ו / י are usually vowel letters (matres lectionis).
      // The first letter of a word is never dropped (consonantal י/ו).
      if (cells[i].base === 'ו' || cells[i].base === 'י') drop.add(i);
    }
  }
  return cells.filter((_, idx) => !drop.has(idx));
}

/**
 * v0.8.0 Part D — merge two-letter Yiddish spellings into their
 * single-codepoint digraphs (וו → װ, וי → ױ, יי → ײ) at the cell level,
 * so a query typed with װ matches text spelled וו and vice versa. Only
 * used when `yiddishSafe`. A merged cell keeps the span of both original
 * characters, so hit offsets still land on the original text. Cells
 * carrying marks are never merged (a mark between the two letters means
 * they are not one digraph).
 */
function mergeYiddishDigraphCells(cells: TextCell[]): TextCell[] {
  const out: TextCell[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cur = cells[i];
    const nxt = cells[i + 1];
    if (nxt && cur.marks === '' && nxt.marks === '') {
      const pair = cur.base + nxt.base;
      const merged =
        pair === 'וו' ? 'װ' : pair === 'וי' ? 'ױ' : pair === 'יי' ? 'ײ' : null;
      if (merged) {
        out.push({ base: merged, marks: '', start: cur.start, end: nxt.end });
        i++;
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}

function normalizeCells(cells: TextCell[], opts: Required<SearchOptions>): TextCell[] {
  // NOTE: prefix handling is deliberately NOT part of normalization.
  // findAll() expands the query with prefixes instead; stripping the text
  // would corrupt roots (see header comment). stripPrefixesFromCells is
  // kept only for the standalone stripPrefixLetters() utility below.
  // v0.8.0 Part D: ktiv dropping is Hebrew-only — in Yiddish the
  // medial/final ו/י are the word itself (װ/ױ/ײ).
  let out = cells;
  if (opts.ktivInsensitive && !opts.yiddishSafe) out = applyKtivToCells(out);
  if (opts.yiddishSafe) out = mergeYiddishDigraphCells(out);
  return out;
}

/** משה וכלב prefixes used for query expansion: singles, ו+single, and
 *  ב/כ/ל/מ + ה/ש (ובהמלך, בשאמר ...). */
const QUERY_PREFIXES: string[] = (() => {
  const singles = ['ב', 'כ', 'ל', 'מ', 'ו', 'ה', 'ש'];
  const out = [...singles];
  for (const s of singles) out.push('ו' + s);
  for (const a of ['ב', 'כ', 'ל', 'מ']) for (const b of ['ה', 'ש']) out.push(a + b);
  return out;
})();

/**
 * Expands a single-word query with common prefixes. Multi-word queries
 * are returned as-is (prefixes inside a phrase are out of scope).
 */
export function expandQueryVariants(query: string): string[] {
  if (/\s/.test(query)) return [query];
  return [query, ...QUERY_PREFIXES.map(p => p + query)];
}

/** Builds the match string for a cell array plus a map from each match-string
 *  index back to its cell index. */
function buildMatchString(
  cells: TextCell[],
  opts: Required<SearchOptions>
): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  cells.forEach((cell, cellIdx) => {
    // v0.8.0 Part D: no final-letter folding for Yiddish — ף is a
    // distinct letter from פ/פּ, not a positional variant of it.
    const folded = opts.yiddishSafe ? cell.base : (FINAL_TO_MEDIAL[cell.base] ?? cell.base);
    norm += folded;
    map.push(cellIdx);
    if (!opts.nikudInsensitive && cell.marks) {
      norm += cell.marks;
      for (let k = 0; k < cell.marks.length; k++) map.push(cellIdx);
    }
  });
  return { norm, map };
}

function resolveOptions(options: SearchOptions = {}): Required<SearchOptions> {
  return {
    nikudInsensitive: options.nikudInsensitive ?? true,
    ktivInsensitive: options.ktivInsensitive ?? true,
    stripPrefixes: options.stripPrefixes ?? true,
    caseSensitive: options.caseSensitive ?? false,
    matchInsideWords: options.matchInsideWords ?? false,
    yiddishSafe: options.yiddishSafe ?? false,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Removes all nikud and taamim combining marks, keeping base letters. */
export function stripNikudTaamim(text: string): string {
  return text.replace(/[\u0591-\u05C7]/g, '');
}

/**
 * Ktiv normalization as a plain string transform: drops medial/final ו/י
 * matres lectionis and folds final letters to medial forms. Marks on kept
 * letters are preserved. Same normalization findAll() applies internally.
 */
export function normalizeKtiv(text: string): string {
  return cellsToString(applyKtivToCells(parseCells(text)));
}

/**
 * Prefix stripping as a plain string transform: removes up to 2 leading
 * משה וכלב letters per word (see stop-list above). Marks are preserved.
 */
export function stripPrefixLetters(text: string): string {
  return cellsToString(stripPrefixesFromCells(parseCells(text)));
}

/**
 * Finds all occurrences of `query` in `text` on the normalized form and
 * maps every hit back to offsets in the original text. With prefix
 * matching on (default), single-word queries are expanded with common
 * prefixes; a hit covers the whole matched word, and `coreStart` marks
 * where the query proper begins inside it.
 */
export function findAll(text: string, query: string, options: SearchOptions = {}): SearchHit[] {
  const opts = resolveOptions(options);
  if (!query) return [];

  // v0.8.0 Part D — Yiddish text or query: Hebrew-only normalisations
  // (ktiv dropping, prefix expansion) would corrupt Yiddish words, so
  // they are switched off for this call.
  if (!opts.yiddishSafe && (isYiddishDominant(text) || isYiddishDominant(query))) {
    opts.ktivInsensitive = false;
    opts.stripPrefixes = false;
    opts.yiddishSafe = true;
  }

  const textCells = normalizeCells(parseCells(text), opts);
  const { norm: textNorm, map } = buildMatchString(textCells, opts);
  const hay = opts.caseSensitive ? textNorm : textNorm.toLowerCase();
  if (!hay) return [];

  // Normalized form of the query as typed (for locating the core inside
  // an expanded variant's match).
  const baseCells = normalizeCells(parseCells(query), opts);
  const { norm: baseNormRaw } = buildMatchString(baseCells, opts);
  const baseNorm = opts.caseSensitive ? baseNormRaw : baseNormRaw.toLowerCase();
  if (!baseNorm) return [];

  const variants = opts.stripPrefixes ? expandQueryVariants(query) : [query];
  // An expanded variant that coincides with a known root word must not be
  // searched (query "מים" + prefix ש must not match שמים; "בת" + ש must
  // not match שבת). The query as typed is always searched.
  const stopNorm = new Set(
    [...PREFIX_STRIP_STOPLIST].map(w => {
      const { norm } = buildMatchString(normalizeCells(parseCells(w), opts), opts);
      return opts.caseSensitive ? norm : norm.toLowerCase();
    })
  );
  const collected: SearchHit[] = [];
  for (const variant of variants) {
    const qCells = normalizeCells(parseCells(variant), opts);
    const { norm: qNormRaw } = buildMatchString(qCells, opts);
    const needle = opts.caseSensitive ? qNormRaw : qNormRaw.toLowerCase();
    if (!needle) continue;
    if (variant !== query && stopNorm.has(needle)) continue;
    // Where the query proper starts inside this variant's normalized form.
    const coreOffsetInVariant = needle.indexOf(baseNorm);
    const prefixLen = coreOffsetInVariant >= 0 ? coreOffsetInVariant : 0;

    let from = 0;
    for (;;) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      // Word-boundary rule (only in prefix-expansion mode, unless
      // matchInsideWords): the match must start at the start of a word, so
      // "מים" never matches inside "שמים". With expansion off, plain
      // substring semantics apply. The check uses the preceding *cell*
      // (not the preceding normalized char) so combining marks don't fool
      // it in nikud-sensitive mode.
      if (!opts.matchInsideWords && opts.stripPrefixes && idx > 0) {
        const prevCell = textCells[map[idx - 1]];
        if (prevCell && LETTER_RE.test(prevCell.base)) {
          from = idx + 1;
          continue;
        }
      }
      const startCell = map[idx];
      const endCell = map[idx + needle.length - 1];
      const start = textCells[startCell].start;
      const end = textCells[endCell].end;
      const coreStart =
        prefixLen > 0 ? textCells[map[idx + prefixLen]].start : start;
      collected.push({ start, end, matchedText: text.slice(start, end), coreStart });
      from = idx + Math.max(1, needle.length);
    }
  }

  // Dedupe: same word matched by several variants (e.g. "המלך" and "מלך"
  // both match הַמֶּלֶךְ) — keep the longest span, drop fully contained hits.
  collected.sort((a, b) => a.start - b.start || b.end - a.end);
  const hits: SearchHit[] = [];
  for (const hit of collected) {
    const contained = hits.some(h => hit.start >= h.start && hit.end <= h.end);
    if (!contained) hits.push(hit);
  }
  return hits;
}

/**
 * Replaces every occurrence of `query` in `text`, letting each replacement
 * word inherit the nikud/taamim marks of the matched word, position by
 * position: replacement letter i takes the marks of matched letter i (when
 * the replacement letter has no marks of its own). Extra replacement
 * letters keep no marks; surplus matched marks are dropped. A prefix
 * matched by query expansion is preserved: searching "מלך" in "למלך" and
 * replacing with "שר" yields "לשר".
 */
export function replacePreservingNikud(
  text: string,
  query: string,
  replacement: string,
  options: SearchOptions = {}
): { text: string; count: number } {
  const hits = findAll(text, query, options);
  if (hits.length === 0) return { text, count: 0 };

  let result = text;
  for (let h = hits.length - 1; h >= 0; h--) {
    const hit = hits[h];
    const coreStart = hit.coreStart ?? hit.start;
    const matchedCells = parseCells(text.slice(coreStart, hit.end));
    const replCells = parseCells(replacement);
    const built = replCells
      .map((rc, i) => {
        if (rc.marks) return rc.base + rc.marks;
        const donor = matchedCells[i];
        if (!donor || !donor.marks) return rc.base;
        // Transfer the donor's marks, except shin/sin dots (U+05C1/U+05C2),
        // which belong to ש specifically and are meaningless on other letters.
        const transferable = donor.marks.replace(/[\u05C1\u05C2]/g, '');
        return transferable ? rc.base + transferable : rc.base;
      })
      .join('');
    result = result.slice(0, coreStart) + built + result.slice(hit.end);
  }
  return { text: result, count: hits.length };
}

/** Searches every unit and returns hits in document order. */
export function searchUnits(
  units: SearchableUnit[],
  query: string,
  options: SearchOptions = {}
): SearchHit[] {
  const out: SearchHit[] = [];
  units.forEach((unit, unitIndex) => {
    const text = getUnitText(unit);
    if (!text) return;
    for (const hit of findAll(text, query, options)) {
      out.push({ ...hit, unitIndex, unitId: unit.id });
    }
  });
  return out;
}

/**
 * Replaces `query` with `replacement` (nikud-preserving) in every unit.
 * Returns new unit objects — the input array is not mutated — plus the
 * total number of replacements made. The unit's text field (rawText, else
 * text, else content) is the one updated.
 */
export function replaceInUnits<T extends SearchableUnit>(
  units: T[],
  query: string,
  replacement: string,
  options: SearchOptions = {}
): { units: T[]; totalReplaced: number } {
  let totalReplaced = 0;
  const next = units.map(unit => {
    const text = getUnitText(unit);
    if (!text) return unit;
    const { text: replaced, count } = replacePreservingNikud(text, query, replacement, options);
    if (count === 0) return unit;
    totalReplaced += count;
    const field = unit.rawText !== undefined ? 'rawText' : unit.text !== undefined ? 'text' : 'content';
    return { ...unit, [field]: replaced };
  });
  return { units: next, totalReplaced };
}
