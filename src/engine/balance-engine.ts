/**
 * v0.3.0 (Module C) — ENGINE HARDENING: POST-PAGINATION BALANCING PASS
 *
 * Pure, conservative post-pass over already-paginated output. It NEVER reflows
 * text, NEVER re-breaks lines, and NEVER edits unit text (Stage 12 Level 0
 * Law #1/#2). It only:
 *
 * 1. `balancePagesToLastLine` — stretches inter-line leading *within* a page so
 *    the last line lands on the page's last baseline, and fixes single-line
 *    widow/orphan tails by moving at most ONE line across a page boundary
 *    (only when a widow/orphan is actually present, and only when the moved
 *    line still fits inside the receiving page's content area).
 * 2. `rebalanceNikud` — after a font/size change, recomputes per-unit mark
 *    spacing metadata (nikud/taamim density -> recommended leading) using the
 *    `NikudEngine` helpers. It returns metadata only; it never rewrites text.
 * 3. `applyBalancingPass` — runs both and returns one combined report.
 *
 * The pagination engine itself is untouched: this pass runs on its output
 * (`PageTypesetResult[]`) before preview / PDF export.
 */

import {
  ContentUnit,
  PageTypesetResult,
  TypesetLine,
} from '../types/typesetter';
import { ProfessionalDesignSettings } from '../types/design-settings';
import { NikudEngine } from './nikud-engine';

/** Which line arrays of a page the balancing pass may touch. */
type LineGroupKey = 'sourceLines' | 'rashiLines' | 'tosafotLines' | 'footnoteLines';

const LINE_GROUPS: LineGroupKey[] = [
  'sourceLines',
  'rashiLines',
  'tosafotLines',
  'footnoteLines',
];

export interface PageBalanceReport {
  /** Pages whose leading was stretched to fill to the last line. */
  pagesAdjusted: number;
  /** Single-line widows pulled back into a 2-line tail. */
  widowsFixed: number;
  /** Single-line orphans pushed to the next page. */
  orphansFixed: number;
  /** Total extra leading added across all pages (pt). */
  totalExtraLeadingPt: number;
  /** Pages the pass inspected. */
  pagesInspected: number;
  notes: string[];
}

export interface NikudUnitSpacing {
  unitId: string;
  role: ContentUnit['role'];
  nikudCount: number;
  taamimCount: number;
  /** Marks per Hebrew letter (0 when the unit has no letters). */
  markDensity: number;
  /** Recommended leading for this unit at the current font size (pt). */
  recommendedLeadingPt: number;
  /** Recommended extra mark-to-base clearance, in em (0 when no marks). */
  recommendedMarkShiftEm: number;
}

export interface NikudRebalanceReport {
  unitsInspected: number;
  unitsWithNikud: number;
  unitsWithTaamim: number;
  fontSizePt: number;
  perUnit: NikudUnitSpacing[];
}

export interface BalancingPassReport {
  balance: PageBalanceReport;
  nikud: NikudRebalanceReport;
}

/** Hardening limits — deliberately conservative so the pass can never wreck a page. */
export const BALANCE_LIMITS = Object.freeze({
  /** Max extra leading added to any single inter-line gap (pt). */
  maxExtraLeadingPerGapPt: 1.5,
  /** Max total stretch as a share of the page content height. */
  maxTotalStretchRatio: 0.08,
  /** A page is only stretched when the shortfall is at least one line height. */
  minShortfallLines: 1,
});

function contentBottom(page: PageTypesetResult): number {
  return page.geometry.pageHeight - page.geometry.marginBottom;
}

function contentTop(page: PageTypesetResult): number {
  return page.geometry.marginTop;
}

function lineStep(line: TypesetLine): number {
  return line.leadingPt && line.leadingPt > 0 ? line.leadingPt : line.height;
}

/**
 * Re-baselines a line group in place, keeping the first line's baseline and
 * spacing the rest by each line's own step (`leadingPt ?? height`).
 * Returns false when the re-baselined group would overflow the content area.
 */
function rebaselineGroup(
  lines: TypesetLine[],
  page: PageTypesetResult
): boolean {
  if (lines.length === 0) return true;
  const top = contentTop(page);
  const bottom = contentBottom(page);
  let prevBaseline = lines[0].yBaseline;
  for (let i = 1; i < lines.length; i++) {
    prevBaseline += lineStep(lines[i]);
    lines[i].yBaseline = prevBaseline;
  }
  for (const line of lines) {
    line.yTop = line.yBaseline - line.ascent;
    line.yBottom = line.yBaseline + line.descent;
  }
  const first = lines[0];
  const last = lines[lines.length - 1];
  if ((first.yTop ?? first.yBaseline - first.ascent) < top - 0.5) return false;
  if ((last.yBottom ?? last.yBaseline + last.descent) > bottom + 0.5) return false;
  return true;
}

/**
 * Widow/orphan repair for one line group across one page boundary.
 * - Widow: page B starts with the LAST line of a unit whose earlier lines are
 *   on page A -> pull page A's last line of the same unit down to page B so
 *   the tail becomes 2 lines.
 * - Orphan: page A ends with the FIRST line of a unit that continues on page B
 *   -> push that line to the top of page B.
 * At most one line moves per boundary per group. Returns 'widow' | 'orphan' |
 * null. The caller re-baselines and rolls back on overflow.
 */
function repairBoundary(
  groupA: TypesetLine[],
  groupB: TypesetLine[],
  pageB: PageTypesetResult
): 'widow' | 'orphan' | null {
  if (groupA.length === 0 || groupB.length === 0) return null;
  const firstB = groupB[0];
  const lastA = groupA[groupA.length - 1];
  // Snapshot page B's baselines: a failed move must leave the page untouched.
  const snapshotB = groupB.map(l => ({
    yBaseline: l.yBaseline,
    yTop: l.yTop,
    yBottom: l.yBottom,
  }));
  const rollbackB = (moved?: TypesetLine, movedSnapshot?: { yBaseline: number; yTop?: number; yBottom?: number }) => {
    groupB.forEach((l, i) => {
      l.yBaseline = snapshotB[i].yBaseline;
      l.yTop = snapshotB[i].yTop;
      l.yBottom = snapshotB[i].yBottom;
    });
    if (moved && movedSnapshot) {
      moved.yBaseline = movedSnapshot.yBaseline;
      moved.yTop = movedSnapshot.yTop;
      moved.yBottom = movedSnapshot.yBottom;
    }
  };

  // Widow: first line of B is the last line of its unit, and A ends with the
  // same unit (so the tail on B is a lone 1-line fragment).
  const bUnitLines = groupB.filter(l => l.unitId === firstB.unitId);
  if (
    firstB.isLastLine &&
    bUnitLines.length === 1 &&
    lastA.unitId === firstB.unitId
  ) {
    const moved = groupA.pop() as TypesetLine;
    const movedSnapshot = { yBaseline: moved.yBaseline, yTop: moved.yTop, yBottom: moved.yBottom };
    // Seat the moved line one step above page B's old first line, then
    // re-baseline the whole group from it.
    moved.yBaseline = firstB.yBaseline - lineStep(firstB);
    moved.yTop = moved.yBaseline - moved.ascent;
    moved.yBottom = moved.yBaseline + moved.descent;
    groupB.unshift(moved);
    if (!rebaselineGroup(groupB, pageB)) {
      // Overflow on B: roll back.
      groupB.shift();
      rollbackB(moved, movedSnapshot);
      groupA.push(moved);
      return null;
    }
    return 'widow';
  }

  // Orphan: last line of A is the first line of its unit (unit continues on B).
  const aUnitLines = groupA.filter(l => l.unitId === lastA.unitId);
  const bHasSameUnit = groupB.some(l => l.unitId === lastA.unitId);
  if (aUnitLines.length === 1 && bHasSameUnit && !lastA.isLastLine) {
    const moved = groupA.pop() as TypesetLine;
    const movedSnapshot = { yBaseline: moved.yBaseline, yTop: moved.yTop, yBottom: moved.yBottom };
    moved.yBaseline = firstB.yBaseline - lineStep(firstB);
    moved.yTop = moved.yBaseline - moved.ascent;
    moved.yBottom = moved.yBaseline + moved.descent;
    groupB.unshift(moved);
    if (!rebaselineGroup(groupB, pageB)) {
      groupB.shift();
      rollbackB(moved, movedSnapshot);
      groupA.push(moved);
      return null;
    }
    return 'orphan';
  }

  return null;
}

/**
 * Stretches one page's largest line group so its last line lands on the last
 * baseline. Only inter-line leading grows (never glyph size, never word
 * spacing), capped by `BALANCE_LIMITS`. The final page is never stretched.
 * Returns the extra leading added (pt), or 0 when nothing changed.
 */
function stretchPageToLastLine(
  page: PageTypesetResult,
  isLastPage: boolean
): number {
  if (isLastPage) return 0;
  // Stretch the group with the most lines (the page's main flow).
  let targetKey: LineGroupKey | null = null;
  let targetLines: TypesetLine[] = [];
  for (const key of LINE_GROUPS) {
    const lines = page[key] ?? [];
    if (lines.length > targetLines.length) {
      targetKey = key;
      targetLines = lines;
    }
  }
  if (!targetKey || targetLines.length < 2) return 0;

  const last = targetLines[targetLines.length - 1];
  const lastBottom = last.yBottom ?? last.yBaseline + last.descent;
  const shortfall = contentBottom(page) - lastBottom;
  const oneLine = lineStep(last);
  if (shortfall < oneLine * BALANCE_LIMITS.minShortfallLines) return 0;

  const gaps = targetLines.length - 1;
  const maxStretch = contentBottom(page) - contentTop(page);
  const perGap = Math.min(
    shortfall / gaps,
    BALANCE_LIMITS.maxExtraLeadingPerGapPt,
    (maxStretch * BALANCE_LIMITS.maxTotalStretchRatio) / gaps
  );
  if (perGap <= 0.01) return 0;

  // Distribute the extra leading top-to-bottom so the last line lands lower.
  let added = 0;
  for (let i = 1; i < targetLines.length; i++) {
    const line = targetLines[i];
    const shift = perGap * i;
    line.yBaseline += shift;
    line.yTop = line.yBaseline - line.ascent;
    line.yBottom = line.yBaseline + line.descent;
    line.leadingPt = lineStep(line) + perGap;
    added += perGap;
  }
  return Number(added.toFixed(2));
}

/**
 * Post-pagination balancing pass. Input pages are NOT mutated: the pass works
 * on a structural copy (line objects are shallow-copied so the caller's
 * pagination output stays intact).
 */
export function balancePagesToLastLine(
  pages: PageTypesetResult[]
): { pages: PageTypesetResult[]; report: PageBalanceReport } {
  const report: PageBalanceReport = {
    pagesAdjusted: 0,
    widowsFixed: 0,
    orphansFixed: 0,
    totalExtraLeadingPt: 0,
    pagesInspected: pages.length,
    notes: [],
  };
  if (pages.length === 0) return { pages: [], report };

  // Structural copy: new page objects + new line arrays with copied line objects.
  const out: PageTypesetResult[] = pages.map(p => {
    const copy: PageTypesetResult = { ...p };
    for (const key of LINE_GROUPS) {
      const lines = p[key];
      if (lines) (copy as unknown as Record<string, unknown>)[key] = lines.map(l => ({ ...l }));
    }
    return copy;
  });

  // 1. Widow/orphan repair across consecutive page boundaries (main flow first).
  for (let i = 0; i < out.length - 1; i++) {
    for (const key of LINE_GROUPS) {
      const groupA = out[i][key] ?? [];
      const groupB = out[i + 1][key] ?? [];
      const fixed = repairBoundary(groupA, groupB, out[i + 1]);
      if (fixed === 'widow') report.widowsFixed += 1;
      if (fixed === 'orphan') report.orphansFixed += 1;
    }
  }

  // 2. Stretch each non-final page's main flow to the last line.
  for (let i = 0; i < out.length; i++) {
    const added = stretchPageToLastLine(out[i], i === out.length - 1);
    if (added > 0) {
      report.pagesAdjusted += 1;
      report.totalExtraLeadingPt = Number(
        (report.totalExtraLeadingPt + added).toFixed(2)
      );
    }
  }

  if (report.widowsFixed === 0 && report.orphansFixed === 0) {
    report.notes.push('No single-line widow/orphan tails found at page boundaries.');
  }
  if (report.pagesAdjusted === 0) {
    report.notes.push(
      'No page needed stretching (pages already fill to the last line, or the shortfall was under one line).'
    );
  }
  return { pages: out, report };
}

const HEBREW_LETTER_RE = /[\u05D0-\u05EA]/g;

/**
 * Counts nikud / taamim marks in a string via the `NikudEngine` helpers
 * (length difference before/after stripping), so the ranges stay canonical.
 */
export function countHebrewMarks(text: string): {
  nikudCount: number;
  taamimCount: number;
  letterCount: number;
} {
  const nikudCount = text.length - NikudEngine.removeNikud(text).length;
  const withoutTaamim = NikudEngine.removeTaamim(text);
  const taamimCount = text.length - withoutTaamim.length;
  const letterCount = (text.match(HEBREW_LETTER_RE) ?? []).length;
  return { nikudCount, taamimCount, letterCount };
}

/**
 * After a font/size change, re-space nikud/taamim marks: returns per-unit
 * spacing metadata (recommended leading + mark clearance) WITHOUT rewriting
 * any text. Callers apply `recommendedLeadingPt` through role styles or the
 * balancing pass; units are returned unchanged.
 */
export function rebalanceNikud(
  units: ContentUnit[],
  fontSizePt: number
): { units: ContentUnit[]; report: NikudRebalanceReport } {
  const size = Math.max(6, Math.min(72, fontSizePt || 14.5));
  const perUnit: NikudUnitSpacing[] = [];
  let unitsWithNikud = 0;
  let unitsWithTaamim = 0;

  for (const unit of units) {
    const { nikudCount, taamimCount, letterCount } = countHebrewMarks(unit.rawText);
    if (nikudCount > 0) unitsWithNikud += 1;
    if (taamimCount > 0) unitsWithTaamim += 1;
    const markDensity =
      letterCount > 0
        ? Number(((nikudCount + taamimCount) / letterCount).toFixed(3))
        : 0;
    // Taamim stack above nikud, so they need the most headroom; dense nikud
    // needs a smaller bump. Multiplier clamped to the 1.2..2.0 band.
    let ratio = 1.32;
    if (taamimCount > 0) ratio += 0.1;
    if (markDensity > 0.25) ratio += 0.05;
    if (markDensity > 0.6) ratio += 0.05;
    ratio = Math.max(1.2, Math.min(2.0, ratio));
    perUnit.push({
      unitId: unit.id,
      role: unit.role,
      nikudCount,
      taamimCount,
      markDensity,
      recommendedLeadingPt: Number((size * ratio).toFixed(2)),
      recommendedMarkShiftEm:
        taamimCount > 0 ? 0.12 : nikudCount > 0 ? 0.06 : 0,
    });
  }

  return {
    units,
    report: {
      unitsInspected: units.length,
      unitsWithNikud,
      unitsWithTaamim,
      fontSizePt: size,
      perUnit,
    },
  };
}

/**
 * v0.9.0 Part C — justification micro-spacing: the per-word extra space a
 * justified line needs to fill its target width, CLAMPED so a line is
 * never stretched into unnatural gaps. Traditional justification allows
 * small inter-word stretch; beyond the cap the honest answer is to
 * re-break the line (one word moves to the next line), not to widen the
 * gaps — `needsRebreak` flags exactly that. The QA engine already flags
 * lines over 18pt/word as over-stretched; this clamp (12pt) is the
 * preventive side: the balancing pass records over-stretched lines in
 * its report notes instead of silently leaving them stretched.
 */
export const MICRO_SPACING_MAX_EXTRA_PER_WORD_PT = 12;

export function microSpaceLine(line: TypesetLine): {
  extraSpacePerWord: number;
  needsRebreak: boolean;
} {
  const wordCount = Math.max(1, line.words.length);
  const natural = line.targetWidth > 0 ? Math.max(0, (line.targetWidth - line.width) / wordCount) : 0;
  const clamped = Math.min(natural, MICRO_SPACING_MAX_EXTRA_PER_WORD_PT);
  return { extraSpacePerWord: clamped, needsRebreak: natural > MICRO_SPACING_MAX_EXTRA_PER_WORD_PT };
}

/**
 * v0.9.0 Part C — audit every justified line on every page for
 * over-stretch (natural spacing above the micro-spacing cap). Returns the
 * count + one note per page, so the balancing report can say so plainly
 * instead of leaving stretched lines invisible.
 */
export function auditMicroSpacing(pages: PageTypesetResult[]): {
  overStretchedLines: number;
  pagesAffected: number;
  notes: string[];
} {
  let overStretchedLines = 0;
  const pagesAffected = new Set<number>();
  const notes: string[] = [];
  for (const page of pages) {
    let pageCount = 0;
    for (const line of [...page.sourceLines, ...page.rashiLines, ...page.tosafotLines, ...(page.tertiaryLines ?? []), ...(page.column2Lines ?? [])]) {
      if (!line.isJustified) continue;
      if (microSpaceLine(line).needsRebreak) {
        overStretchedLines += 1;
        pageCount += 1;
        pagesAffected.add(page.pageNumber);
      }
    }
    if (pageCount > 0) {
      notes.push(`עמוד ${page.pageNumber}: ${pageCount} שורות מיושרות נמתחו מעבר למרווח התקני — יש לשבור אותן מחדש (מילה עוברת לשורה הבאה) במקום להרחיב רווחים.`);
    }
  }
  return { overStretchedLines, pagesAffected: pagesAffected.size, notes };
}

/**
 * Runs the full post-pagination hardening pass: page balancing (fill to the
 * last line + widow/orphan repair) and nikud/taamim re-spacing metadata.
 * `settings` is optional; when present, the source font size drives the
 * nikud pass. Pages are returned as a copy; units are returned unchanged.
 */
export function applyBalancingPass(
  pages: PageTypesetResult[],
  units: ContentUnit[],
  settings?: ProfessionalDesignSettings
): {
  pages: PageTypesetResult[];
  units: ContentUnit[];
  report: BalancingPassReport;
} {
  const fontSizePt =
    settings?.ravText?.sourceFontSizePt ??
    settings?.roleStyles?.main_source?.character?.fontSizePt ??
    14.5;
  const balanced = balancePagesToLastLine(pages);
  const nikud = rebalanceNikud(units, fontSizePt);
  // v0.9.0 Part C — justification micro-spacing audit: over-stretched
  // justified lines are recorded in the balance report (never silently
  // left stretched). The pass itself never re-breaks lines — re-breaking
  // is a pagination decision, and the note tells the user what to do.
  const micro = auditMicroSpacing(balanced.pages);
  if (micro.overStretchedLines > 0) {
    balanced.report.notes.push(...micro.notes);
  }
  return {
    pages: balanced.pages,
    units: nikud.units,
    report: { balance: balanced.report, nikud: nikud.report },
  };
}
