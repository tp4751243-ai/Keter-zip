/**
 * Keter Typesetter — Layout Extras (v0.3.0, Module E)
 *
 * Two pure helpers for pro typesetting, kept deliberately separate from the
 * pagination solver (`pagination-engine.ts` is NOT edited):
 *
 *  1. Side-by-side paragraphs — groups parallel units (source + translation,
 *     or two versions of the same text) into render groups of up to 4 columns
 *     so the page can show them next to each other.
 *  2. Paragraph numbering — assigns Halacha-style Hebrew-letter numbers
 *     (א, ב, ג, …) to paragraphs, with footnotes numbered on their own
 *     sequence.
 *
 * Original offline code. No network, no new dependencies.
 */

import { ContentUnit } from '../types/typesetter';

/* ------------------------------------------------------------------ */
/* 1. Side-by-side paragraph groups                                    */
/* ------------------------------------------------------------------ */

export interface SideBySideGroup {
  /** Stable id for React keys, e.g. `sbs-<firstUnitId>`. */
  id: string;
  /** The units in this group, in column order (right-to-left in RTL). */
  units: ContentUnit[];
  /** Convenience list of unit ids, same order as `units`. */
  unitIds: string[];
  /** Number of columns this group renders as (1 = standalone paragraph). */
  columns: number;
  /** True when the group holds more than one parallel unit. */
  isParallel: boolean;
  /** Short label for UI, e.g. the first unit's role or chapter title. */
  label?: string;
}

export interface SideBySideOptions {
  /** Max columns per group. Default 4. */
  maxColumns?: number;
  /**
   * Roles that may stand as the "anchor" (first) column of a parallel group.
   * Defaults to source-like roles; commentary roles join via links instead.
   */
  anchorRoles?: ContentUnit['role'][];
}

const DEFAULT_ANCHOR_ROLES: ContentUnit['role'][] = [
  'main_source',
  'verse',
  'regular_paragraph',
  'chapter',
  'siman',
  'seif',
];

/**
 * Groups consecutive units into side-by-side render groups.
 *
 * A unit joins the current group when it is *parallel* to the group's anchor:
 *  - it links to the anchor (or to another member) via `linkedSourceId` /
 *    `linkedCommentaryIds`, or
 *  - it is the anchor's linked commentary / the anchor is its linked source.
 *
 * Units with no parallel relation form singleton groups (columns === 1), so
 * the result is a complete partition of `units` in document order — the
 * renderer can walk the groups and lay each one out without re-sorting.
 * Groups are capped at `maxColumns`; extra parallel units start a new group.
 */
export function sideBySideGroups(
  units: ContentUnit[],
  maxColumns = 4,
  options: SideBySideOptions = {}
): SideBySideGroup[] {
  const cap = Math.max(1, Math.min(4, maxColumns));
  const anchorRoles = options.anchorRoles ?? DEFAULT_ANCHOR_ROLES;
  const groups: SideBySideGroup[] = [];

  const linkedTo = (a: ContentUnit, b: ContentUnit): boolean => {
    if (a.linkedSourceId === b.id || b.linkedSourceId === a.id) return true;
    if (a.linkedCommentaryIds?.includes(b.id)) return true;
    if (b.linkedCommentaryIds?.includes(a.id)) return true;
    return false;
  };

  let current: ContentUnit[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const anchor = current[0];
    groups.push({
      id: `sbs-${anchor.id}`,
      units: [...current],
      unitIds: current.map(u => u.id),
      columns: current.length,
      isParallel: current.length > 1,
      label: anchor.chapterTitle ?? anchor.dibburHamatchil ?? undefined,
    });
    current = [];
  };

  for (const unit of units) {
    if (current.length === 0) {
      current.push(unit);
      continue;
    }
    const isParallelToGroup =
      current.some(member => linkedTo(unit, member)) ||
      // A unit whose role is a translation/commentary layer of the anchor's
      // text and which directly follows it is treated as parallel even
      // without an explicit link (defensive: only for source-like anchors).
      (anchorRoles.includes(current[0].role) &&
        (unit.role === 'primary_comment' ||
          unit.role === 'secondary_comment' ||
          unit.role === 'tertiary_comment') &&
        unit.linkedSourceId === undefined &&
        current.length === 1 &&
        current[0].linkedCommentaryIds === undefined);
    if (isParallelToGroup && current.length < cap) {
      current.push(unit);
    } else {
      flush();
      current.push(unit);
    }
  }
  flush();
  return groups;
}

/* ------------------------------------------------------------------ */
/* 2. Paragraph numbering (Hebrew letters)                             */
/* ------------------------------------------------------------------ */

export type ParagraphNumberingStyle = 'hebrew-letters';

export interface NumberedParagraph {
  unitId: string;
  /** 1-based number within its sequence. */
  number: number;
  /** Rendered label, e.g. "א", "ב", "טו". */
  label: string;
  /** Main text sequence vs the separate footnote sequence. */
  sequence: 'main' | 'footnote';
}

export interface ParagraphNumberingResult {
  numbered: NumberedParagraph[];
  /** Lookup by unit id. */
  byUnitId: Map<string, NumberedParagraph>;
}

const HEBREW_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEBREW_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HEBREW_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

/**
 * Converts a positive integer to Hebrew-letter numerals (gematria style):
 * 1→א, 10→י, 11→יא, 15→טו, 16→טז (the traditional avoidance of יה/יו),
 * 20→כ, 100→ק, 400→ת, 500→תק, … Supports up to 999.
 */
export function hebrewLetterNumber(n: number): string {
  if (!Number.isFinite(n) || n < 1) return '';
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  let out = '';
  if (hundreds > 0) {
    // 400 = ת; 500–900 are written ת + ק/ר/ש/ת (תק, תר, תש, תת).
    if (hundreds <= 4) {
      out += HEBREW_HUNDREDS[hundreds];
    } else {
      out += 'ת' + HEBREW_HUNDREDS[hundreds - 4];
    }
  }
  // 15 → טו and 16 → טז, also inside larger numbers (115 → קטו, 216 → רטז):
  // the traditional avoidance of יה/יו applies to the tens+ones part.
  if (rem === 15) return out + 'טו';
  if (rem === 16) return out + 'טז';
  const tens = Math.floor(rem / 10);
  const ones = rem % 10;
  if (tens > 0) out += HEBREW_TENS[tens];
  if (ones > 0) out += HEBREW_ONES[ones];
  return out;
}

/** Roles that receive a paragraph number in the main sequence. */
const NUMBERED_MAIN_ROLES: ContentUnit['role'][] = [
  'main_source',
  'verse',
  'regular_paragraph',
  'seif',
  'siman',
  'chapter',
];

/**
 * Assigns Hebrew-letter paragraph numbers (א, ב, ג, …) to paragraph-like
 * units in document order.
 *
 * Footnote units get their *own* numbering sequence (they are numbered
 * separately because footnotes are laid out at the foot of the page, not in
 * the main flow — a single shared sequence would make the numbers jump
 * confusingly between body and footnotes). A unit whose `footnoteAnchorUnitId`
 * points at a body unit is treated as a footnote even if its role is not
 * literally `'footnote'`.
 */
export function paragraphNumbering(
  units: ContentUnit[],
  style: ParagraphNumberingStyle = 'hebrew-letters'
): ParagraphNumberingResult {
  void style; // Only 'hebrew-letters' exists today; kept for future styles.
  const numbered: NumberedParagraph[] = [];
  const byUnitId = new Map<string, NumberedParagraph>();
  let mainCounter = 0;
  let footnoteCounter = 0;

  const isFootnoteUnit = (u: ContentUnit): boolean =>
    u.role === 'footnote' || Boolean(u.footnoteAnchorUnitId);

  for (const unit of units) {
    if (isFootnoteUnit(unit)) {
      footnoteCounter += 1;
      const entry: NumberedParagraph = {
        unitId: unit.id,
        number: footnoteCounter,
        label: hebrewLetterNumber(footnoteCounter),
        sequence: 'footnote',
      };
      numbered.push(entry);
      byUnitId.set(unit.id, entry);
      continue;
    }
    if (!NUMBERED_MAIN_ROLES.includes(unit.role)) continue;
    mainCounter += 1;
    const entry: NumberedParagraph = {
      unitId: unit.id,
      number: mainCounter,
      label: hebrewLetterNumber(mainCounter),
      sequence: 'main',
    };
    numbered.push(entry);
    byUnitId.set(unit.id, entry);
  }

  return { numbered, byUnitId };
}
