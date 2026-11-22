/**
 * Keter text proofreading engine (v0.3.0, module A)
 * Pure functions over plain text / content units — offline, no network.
 *
 * Checks:
 *   - punctuation: double spaces, space before punctuation, missing space
 *     after punctuation, straight quotes (" / ') where Hebrew gereshayim
 *     (״) / geresh (׳) belong.
 *   - final letters: sofit forms (ך/ם/ן/ף/ץ) mid-word, non-final forms
 *     (כ/מ/נ/פ/צ) at word end.
 *   - quotes: unbalanced ״ pairs.
 *   - missing glyphs: font-capability check against the known-font table
 *     in font-analyzer.ts (nikud/taamim support), plus a conservative
 *     fallback-set check for characters outside the Hebrew/Latin/
 *     punctuation ranges (flags emoji, CJK, Arabic, ...).
 *   - page fill + footnote distance (checkPages): page fill is computed
 *     from real paginated geometry when pages are supplied; footnote
 *     distance uses page co-location when pages are supplied and falls
 *     back to unit-order distance (marked best-effort in the message)
 *     when only units are available.
 *
 * Issue contract: `suggestion` is always the exact replacement text for
 * the span [offset, offset + length) — empty string means "delete", and a
 * zero-length span means "insert here". That is what applyFix() applies.
 */

import type { ContentUnit, PageTypesetResult } from '../types/typesetter';
import { KNOWN_HOLY_BOOK_FONTS } from './font-analyzer';
import type { SearchableUnit } from './hebrew-search';
import { getUnitText } from './hebrew-search';

export type TextIssueKind =
  | 'punctuation'
  | 'final_letter'
  | 'quote'
  | 'missing_glyph'
  | 'page_fill'
  | 'footnote_distance';

export interface TextIssue {
  id: string;
  kind: TextIssueKind;
  unitId?: string;
  /** Page number (1-based folio) for page-level issues. */
  pageNumber?: number;
  /** Offset in the checked text (unit rawText, unless noted otherwise). */
  offset: number;
  /** Length of the span `suggestion` replaces (0 = insertion point). */
  length: number;
  messageHe: string;
  messageEn: string;
  /** Exact replacement text for [offset, offset + length). */
  suggestion: string;
  autoFixable: boolean;
}

export const TEXT_ISSUE_KIND_META: Record<TextIssueKind, { labelHe: string; labelEn: string }> = {
  punctuation: { labelHe: 'סימני פיסוק ורווחים', labelEn: 'Punctuation & spacing' },
  final_letter: { labelHe: 'אותיות סופיות', labelEn: 'Final letters' },
  quote: { labelHe: 'מרכאות', labelEn: 'Quotes' },
  missing_glyph: { labelHe: 'תווים חסרים בגופן', labelEn: 'Missing glyphs' },
  page_fill: { labelHe: 'עמודים לא מלאים', labelEn: 'Underfilled pages' },
  footnote_distance: { labelHe: 'הערות רחוקות מהמילה', labelEn: 'Distant footnotes' },
};

/** Fixed display order for grouped issue lists. */
export const TEXT_ISSUE_KIND_ORDER: TextIssueKind[] = [
  'punctuation',
  'final_letter',
  'quote',
  'missing_glyph',
  'footnote_distance',
  'page_fill',
];

const HEBREW_LETTER = '[\u05D0-\u05EA]';
const NIKUD = '[\u05B0-\u05BC\u05C1\u05C2\u05C4\u05C5\u05C7]';
const TAAMIM = '[\u0591-\u05AF]';
/** Punctuation that must not be preceded by a space / must be followed by one. */
const PUNCT = '[.,;:!?\u05C3]';

const FINAL_TO_MEDIAL: Record<string, string> = {
  '\u05DA': '\u05DB', // ך -> כ
  '\u05DD': '\u05DE', // ם -> מ
  '\u05DF': '\u05E0', // ן -> נ
  '\u05E3': '\u05E4', // ף -> פ
  '\u05E5': '\u05E6', // ץ -> צ
};
const MEDIAL_TO_FINAL: Record<string, string> = {
  '\u05DB': '\u05DA',
  '\u05DE': '\u05DD',
  '\u05E0': '\u05DF',
  '\u05E4': '\u05E3',
  '\u05E6': '\u05E5',
};

function makeIssue(
  kind: TextIssueKind,
  offset: number,
  length: number,
  messageHe: string,
  messageEn: string,
  suggestion: string,
  autoFixable: boolean,
  unitId?: string,
  pageNumber?: number
): TextIssue {
  return {
    id: `${kind}-${unitId ?? 'doc'}-${offset}-${length}`,
    kind,
    unitId,
    pageNumber,
    offset,
    length,
    messageHe,
    messageEn,
    suggestion,
    autoFixable,
  };
}

// ---------------------------------------------------------------------------
// Punctuation
// ---------------------------------------------------------------------------

/** Double spaces, space before punctuation, missing space after punctuation,
 *  straight quotes next to Hebrew letters. */
export function checkPunctuation(text: string, unitId?: string): TextIssue[] {
  const issues: TextIssue[] = [];

  // Double (or longer) space runs -> single space.
  for (const m of text.matchAll(/ {2,}/g)) {
    issues.push(
      makeIssue(
        'punctuation',
        m.index,
        m[0].length,
        `רווח כפול (${m[0].length} רווחים רצופים).`,
        `Double space (${m[0].length} consecutive spaces).`,
        ' ',
        true,
        unitId
      )
    );
  }

  // Space(s) before punctuation -> remove them.
  for (const m of text.matchAll(new RegExp(` +(?=${PUNCT})`, 'g'))) {
    issues.push(
      makeIssue(
        'punctuation',
        m.index,
        m[0].length,
        `רווח לפני סימן פיסוק '${text[m.index + m[0].length]}'.`,
        `Space before punctuation '${text[m.index + m[0].length]}'.`,
        '',
        true,
        unitId
      )
    );
  }

  // Punctuation directly followed by a letter -> insert a space.
  // Excludes decimals (digit.punct.digit) and geresh/gereshayim, which
  // legitimately sit inside words (רש״י, ד׳).
  for (const m of text.matchAll(new RegExp(`(${PUNCT})(?=${HEBREW_LETTER}|[a-zA-Z])`, 'g'))) {
    const idx = m.index;
    const before = idx > 0 ? text[idx - 1] : '';
    const after = text[idx + 1] ?? '';
    if (/[0-9]/.test(before) && /[0-9]/.test(after)) continue;
    issues.push(
      makeIssue(
        'punctuation',
        idx + 1,
        0,
        `חסר רווח אחרי '${m[0]}'.`,
        `Missing space after '${m[0]}'.`,
        ' ',
        true,
        unitId
      )
    );
  }

  // Straight double quote next to a Hebrew letter -> ״ (U+05F4).
  for (const m of text.matchAll(/"/g)) {
    const prev = m.index > 0 ? text[m.index - 1] : '';
    const next = text[m.index + 1] ?? '';
    if (!new RegExp(HEBREW_LETTER).test(prev) && !new RegExp(HEBREW_LETTER).test(next)) continue;
    issues.push(
      makeIssue(
        'punctuation',
        m.index,
        1,
        'גרשיים ישרים (") — בספרי קודש משתמשים ב־״.',
        'Straight double quote (") — holy books use ״.',
        '\u05F4',
        true,
        unitId
      )
    );
  }

  // Straight single quote / apostrophe next to a Hebrew letter -> ׳ (U+05F3).
  for (const m of text.matchAll(/'/g)) {
    const prev = m.index > 0 ? text[m.index - 1] : '';
    const next = text[m.index + 1] ?? '';
    if (!new RegExp(HEBREW_LETTER).test(prev) && !new RegExp(HEBREW_LETTER).test(next)) continue;
    issues.push(
      makeIssue(
        'punctuation',
        m.index,
        1,
        "גרש ישר (') — בספרי קודש משתמשים ב־׳.",
        "Straight single quote (') — holy books use ׳.",
        '\u05F3',
        true,
        unitId
      )
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Final letters
// ---------------------------------------------------------------------------

/** Sofit form mid-word, or non-final form at word end. Single-letter words
 *  are left alone (a lone ך etc. cannot be judged). */
export function checkFinalLetters(text: string, unitId?: string): TextIssue[] {
  const issues: TextIssue[] = [];
  const wordRe = new RegExp(`${HEBREW_LETTER}+`, 'g');
  for (const m of text.matchAll(wordRe)) {
    const word = m[0];
    if (word.length < 2) continue;
    const base = m.index;
    for (let i = 0; i < word.length - 1; i++) {
      const medial = FINAL_TO_MEDIAL[word[i]];
      if (medial) {
        issues.push(
          makeIssue(
            'final_letter',
            base + i,
            1,
            `אות סופית '${word[i]}' באמצע המילה '${word}'.`,
            `Final-form letter '${word[i]}' in the middle of '${word}'.`,
            medial,
            true,
            unitId
          )
        );
      }
    }
    const last = word[word.length - 1];
    const fin = MEDIAL_TO_FINAL[last];
    if (fin) {
      issues.push(
        makeIssue(
          'final_letter',
          base + word.length - 1,
          1,
          `המילה '${word}' מסתיימת באות לא־סופית '${last}'.`,
          `Word '${word}' ends with a non-final letter '${last}'.`,
          fin,
          true,
          unitId
        )
      );
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/** Unbalanced ״ (gereshayim) pairs within one unit. */
export function checkQuotes(text: string, unitId?: string): TextIssue[] {
  const issues: TextIssue[] = [];
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\u05F4') positions.push(i);
  }
  if (positions.length % 2 === 1) {
    const last = positions[positions.length - 1];
    issues.push(
      makeIssue(
        'quote',
        last,
        1,
        'מרכאות כפולות (״) לא מאוזנות — חסר סוגר.',
        'Unbalanced double gereshayim (״) — a closing quote is missing.',
        '',
        false,
        unitId
      )
    );
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Missing glyphs
// ---------------------------------------------------------------------------

/**
 * Font-capability check (via the known-font table in font-analyzer.ts) +
 * conservative fallback-set check.
 *
 * If `fontName` matches a known font that lacks nikud/taamim support and
 * the text uses those marks, one issue per mark class is reported (the
 * fix is to switch font or strip the marks — not auto-fixable here).
 * The fallback check always runs and flags runs of characters outside the
 * Hebrew / Latin / common-punctuation ranges (emoji, CJK, Arabic, ...).
 * If the font is unknown, only the fallback check applies — noted in the
 * message when it fires.
 */
export function checkMissingGlyphs(text: string, fontName?: string, unitId?: string): TextIssue[] {
  const issues: TextIssue[] = [];

  const font = fontName
    ? KNOWN_HOLY_BOOK_FONTS.find(f => f.family.toLowerCase() === fontName.toLowerCase())
    : undefined;

  if (font) {
    const nikudRe = new RegExp(NIKUD, 'g');
    const nikudMatch = nikudRe.exec(text);
    if (!font.hasNikud && nikudMatch) {
      issues.push(
        makeIssue(
          'missing_glyph',
          nikudMatch.index,
          1,
          `הגופן '${font.family}' אינו תומך בניקוד, אך הטקסט מנוקד.`,
          `Font '${font.family}' has no nikud support, but the text is vocalized.`,
          '',
          false,
          unitId
        )
      );
    }
    const taamimRe = new RegExp(TAAMIM, 'g');
    const taamimMatch = taamimRe.exec(text);
    if (!font.hasTaamim && taamimMatch) {
      issues.push(
        makeIssue(
          'missing_glyph',
          taamimMatch.index,
          1,
          `הגופן '${font.family}' אינו תומך בטעמים, אך הטקסט כולל טעמי מקרא.`,
          `Font '${font.family}' has no cantillation-mark support, but the text contains taamim.`,
          '',
          false,
          unitId
        )
      );
    }
  }

  // Fallback-set check: allowed = Hebrew block, basic Latin, common
  // punctuation/digits/whitespace. Anything else is grouped into runs.
  const isAllowed = (ch: string): boolean => {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0590 && cp <= 0x05ff) return true;
    if (cp >= 0x0020 && cp <= 0x007e) return true;
    if (cp >= 0x2010 && cp <= 0x201a) return true; // dashes + single quotes
    if (cp >= 0x201c && cp <= 0x201e) return true; // double quotes
    if (cp === 0x2026 || cp === 0x00a0) return true; // … + nbsp
    if (ch === '\n' || ch === '\r' || ch === '\t') return true;
    return false;
  };
  let runStart = -1;
  for (let i = 0; i <= text.length; i++) {
    const allowed = i < text.length ? isAllowed(text[i]) : true;
    if (!allowed && runStart === -1) runStart = i;
    if (allowed && runStart !== -1) {
      const run = text.slice(runStart, i);
      issues.push(
        makeIssue(
          'missing_glyph',
          runStart,
          run.length,
          `תו/ים מחוץ לטווחי העברית והלטינית ('${run}') — כנראה לא יוצגו כראוי בגופן העברי.` +
            (font ? '' : ' (בדיקת טווחים בלבד — הגופן לא זוהה בטבלת הגופנים.)'),
          `Character(s) outside the Hebrew/Latin ranges ('${run}') — likely missing from the Hebrew font.` +
            (font ? '' : ' (Range check only — font not found in the known-font table.)'),
          '',
          true,
          unitId
        )
      );
      runStart = -1;
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/** Runs punctuation + final-letter + quote + missing-glyph checks on one text. */
export function checkText(text: string, unitId?: string, fontName?: string): TextIssue[] {
  return [
    ...checkPunctuation(text, unitId),
    ...checkFinalLetters(text, unitId),
    ...checkQuotes(text, unitId),
    ...checkMissingGlyphs(text, fontName, unitId),
  ];
}

/** Runs checkText() on every unit's text (rawText, else text, else content). */
export function checkUnits(units: SearchableUnit[], fontName?: string): TextIssue[] {
  const issues: TextIssue[] = [];
  for (const unit of units) {
    const text = getUnitText(unit);
    if (text) issues.push(...checkText(text, unit.id, fontName));
  }
  return issues;
}

export interface CheckPagesInput {
  units?: ContentUnit[];
  pages?: PageTypesetResult[];
}

function pageUnitToPageIndex(pages: PageTypesetResult[]): Map<string, number> {
  const map = new Map<string, number>();
  pages.forEach((page, pageIdx) => {
    const lines = [
      ...page.sourceLines,
      ...page.rashiLines,
      ...page.tosafotLines,
      ...page.footnoteLines,
      ...(page.column2Lines ?? []),
      ...(page.sideNoteLines ?? []),
    ];
    for (const line of lines) {
      if (line.unitId) map.set(line.unitId, pageIdx);
      for (const word of line.words) {
        if (word.unitId) map.set(word.unitId, pageIdx);
      }
    }
  });
  return map;
}

function pageFillRatio(page: PageTypesetResult): number {
  const contentHeight =
    page.geometry.pageHeight - page.geometry.marginTop - page.geometry.marginBottom;
  if (contentHeight <= 0) return 1;
  const lines = [
    ...page.sourceLines,
    ...page.rashiLines,
    ...page.tosafotLines,
    ...page.footnoteLines,
    ...(page.column2Lines ?? []),
    ...(page.sideNoteLines ?? []),
  ];
  if (lines.length === 0) return 0;
  const maxBaseline = Math.max(...lines.map(l => l.yBaseline));
  return maxBaseline / contentHeight;
}

/**
 * Page-level checks.
 * - Underfilled page: any page except the last whose used height is < 50%
 *   of the content height (computed from real paginated geometry).
 * - Footnote far from its word: a footnote unit whose anchor unit lands on
 *   a different page than the footnote itself. With pages supplied this is
 *   exact; with units only, distance is estimated from unit order
 *   (> 5 units apart) and the message says so (best-effort).
 */
export function checkPages(input: CheckPagesInput): TextIssue[] {
  const issues: TextIssue[] = [];
  const { units = [], pages = [] } = input;

  if (pages.length > 0) {
    for (let i = 0; i < pages.length - 1; i++) {
      const page = pages[i];
      const fill = pageFillRatio(page);
      if (fill < 0.5) {
        issues.push(
          makeIssue(
            'page_fill',
            0,
            0,
            `העמוד מלא רק בכ־${Math.round(fill * 100)}% — מומלץ לאזן את העימוד.`,
            `Page is only about ${Math.round(fill * 100)}% full — consider rebalancing the layout.`,
            '',
            false,
            undefined,
            page.pageNumber
          )
        );
      }
    }
  }

  const footnotes = units.filter(
    u => u.role === 'footnote' && u.footnoteAnchorUnitId
  );
  if (footnotes.length === 0) return issues;

  if (pages.length > 0) {
    const unitPage = pageUnitToPageIndex(pages);
    for (const fn of footnotes) {
      const anchorPage = unitPage.get(fn.footnoteAnchorUnitId!);
      const fnPage = unitPage.get(fn.id);
      if (anchorPage === undefined || fnPage === undefined) continue;
      if (anchorPage !== fnPage) {
        issues.push(
          makeIssue(
            'footnote_distance',
            0,
            0,
            `הערת השוליים נמצאת בעמוד ${pages[fnPage].pageNumber}, אך המילה שהיא מפנה אליה בעמוד ${pages[anchorPage].pageNumber}.`,
            `Footnote is on page ${pages[fnPage].pageNumber} but its anchor word is on page ${pages[anchorPage].pageNumber}.`,
            '',
            false,
            fn.id,
            pages[fnPage].pageNumber
          )
        );
      }
    }
  } else {
    // Units-only fallback: order distance as a proxy for page distance.
    const order = new Map(units.map((u, i) => [u.id, i]));
    for (const fn of footnotes) {
      const anchorIdx = order.get(fn.footnoteAnchorUnitId!);
      const fnIdx = order.get(fn.id);
      if (anchorIdx === undefined || fnIdx === undefined) continue;
      if (Math.abs(fnIdx - anchorIdx) > 5) {
        issues.push(
          makeIssue(
            'footnote_distance',
            0,
            0,
            `הערת השוליים רחוקה מהמילה שהיא מפנה אליה (הערכה לפי סדר היחידות — best-effort, ללא נתוני עימוד).`,
            `Footnote is far from its anchor word (estimate from unit order only — best-effort, no pagination data).`,
            '',
            false,
            fn.id
          )
        );
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Fixes
// ---------------------------------------------------------------------------

/** Applies one auto-fixable issue: replaces [offset, offset+length) with
 *  `suggestion`. Non-fixable issues leave the text untouched. */
export function applyFix(text: string, issue: TextIssue): string {
  if (!issue.autoFixable) return text;
  if (issue.offset < 0 || issue.offset > text.length) return text;
  const end = Math.min(text.length, issue.offset + issue.length);
  return text.slice(0, issue.offset) + issue.suggestion + text.slice(end);
}

/** Applies many fixes. Issues are applied right-to-left so earlier offsets
 *  stay valid; overlapping spans are applied once (first wins, right-most). */
export function applyFixes(text: string, issues: TextIssue[]): string {
  const fixable = issues
    .filter(i => i.autoFixable)
    .sort((a, b) => b.offset - a.offset || b.length - a.length);
  let result = text;
  const appliedSpans: Array<[number, number]> = [];
  for (const issue of fixable) {
    const spanEnd = issue.offset + issue.length;
    const overlaps = appliedSpans.some(
      ([s, e]) => issue.offset < e && spanEnd > s
    );
    if (overlaps) continue;
    result = applyFix(result, issue);
    appliedSpans.push([issue.offset, spanEnd]);
  }
  return result;
}

/** Groups issues by kind; every kind key is always present (possibly empty). */
export function groupByKind(issues: TextIssue[]): Record<TextIssueKind, TextIssue[]> {
  const grouped: Record<TextIssueKind, TextIssue[]> = {
    punctuation: [],
    final_letter: [],
    quote: [],
    missing_glyph: [],
    page_fill: [],
    footnote_distance: [],
  };
  for (const issue of issues) grouped[issue.kind].push(issue);
  return grouped;
}
