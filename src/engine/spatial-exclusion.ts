/**
 * Keter Spatial Available-Area & Collision Detection Engine
 *
 * Replaces simple independent rectangular text frames with a true 2D spatial
 * Available-Area & Exclusion-Zone model:
 * - Tracks every placed object (Source line, Commentary line, Footnote, Ornament, Margin)
 *   as an `OccupiedRegion` with exact [xLeft, xRight, yTop, yBottom] coordinates.
 * - Computes free `HorizontalInterval[]` slices for any vertical band [yTop, yBottom]
 *   by subtracting all occupied regions + safety gutters.
 * - Detects any 2D bounding-box collision between placed regions before committing a layout.
 * - Enforces professional minimum & preferred readable column widths.
 */

import {
  ContentRole,
  HorizontalInterval,
  OccupiedRegion,
  PlacedOrnament,
  TypesetLine,
} from '../types/typesetter';

export interface CollisionPair {
  regionA: OccupiedRegion;
  regionB: OccupiedRegion;
  overlapAreaPt2: number;
  horizontalOverlapPt: number;
  verticalOverlapPt: number;
}

export class SpatialExclusionEngine {
  /** Professional minimum & preferred readable line lengths (in points, 72pt = 1 inch) */
  public static readonly MIN_READABLE_SOURCE_WIDTH_PT = 135.0; // ~47.6mm minimum for Gemara/Source
  public static readonly PREFERRED_SOURCE_WIDTH_PT = 168.0;    // ~59.2mm preferred for Gemara/Source
  public static readonly MIN_READABLE_COMMENT_WIDTH_PT = 78.0; // ~27.5mm minimum for Rashi/Tosafot
  public static readonly PREFERRED_COMMENT_WIDTH_PT = 105.0;   // ~37.0mm preferred for Rashi/Tosafot
  /** Geometric floating-point tolerance (in points) so boundary intervals equal to minWidth are never dropped */
  public static readonly GEOMETRIC_EPSILON_PT = 0.25;

  private contentWidth: number;
  private contentHeight: number;
  private occupied: OccupiedRegion[] = [];

  constructor(contentWidth: number, contentHeight: number) {
    this.contentWidth = contentWidth;
    this.contentHeight = contentHeight;
  }

  public clear(): void {
    this.occupied = [];
  }

  public getOccupiedRegions(): OccupiedRegion[] {
    return [...this.occupied];
  }

  /**
   * Registers an occupied rectangular region in content-relative coordinates:
   * X in [0 .. contentWidth] (0 = left edge of content area, contentWidth = right edge)
   * Y in [0 .. contentHeight] (0 = top margin, contentHeight = bottom margin)
   */
  public registerRegion(region: OccupiedRegion): void {
    this.occupied.push(region);
  }

  /**
   * Registers a placed TypesetLine as an occupied region and stamps its exact
   * [xLeft, xRight, yTop, yBottom] onto the line object.
   */
  public registerLine(
    line: TypesetLine,
    xLeft: number,
    xRight: number,
    idPrefix: string
  ): OccupiedRegion {
    const yTop = line.yBaseline - line.ascent;
    const yBottom = line.yBaseline + line.descent;

    line.xLeft = xLeft;
    line.xRight = xRight;
    line.yTop = yTop;
    line.yBottom = yBottom;
    line.targetWidth = xRight - xLeft;

    const region: OccupiedRegion = {
      id: `${idPrefix}-${line.lineIndex}`,
      role: line.role,
      xLeft,
      xRight,
      yTop,
      yBottom,
      unitId: line.unitId,
    };

    this.occupied.push(region);
    return region;
  }

  /**
   * Registers a placed ornament as an exclusion zone
   */
  public registerOrnament(orn: PlacedOrnament, index: number): OccupiedRegion {
    const region: OccupiedRegion = {
      id: `ornament-${index}-${orn.asset.id}`,
      role: 'ornament',
      xLeft: orn.x,
      xRight: orn.x + orn.width,
      yTop: orn.y,
      yBottom: orn.y + orn.height,
      unitId: orn.unitId,
    };
    this.occupied.push(region);
    return region;
  }

  /**
   * Queries the available (unoccupied) horizontal intervals for a line spanning [yTop, yBottom],
   * applying `horizontalGutter` around any already-placed exclusion region.
   * Returns sorted intervals from left to right.
   */
  public queryAvailableIntervals(
    yTop: number,
    yBottom: number,
    horizontalGutter: number = 11.0,
    verticalClearance: number = 1.5
  ): HorizontalInterval[] {
    let freeIntervals: HorizontalInterval[] = [
      {
        xLeft: 0,
        xRight: this.contentWidth,
        width: this.contentWidth,
      },
    ];

    for (const reg of this.occupied) {
      // Check if `reg` vertically intersects [yTop - verticalClearance, yBottom + verticalClearance]
      const vOverlap =
        Math.min(yBottom + verticalClearance, reg.yBottom) -
        Math.max(yTop - verticalClearance, reg.yTop);

      if (vOverlap > 0.5) {
        // Subtract [reg.xLeft - horizontalGutter, reg.xRight + horizontalGutter] from freeIntervals
        const cutLeft = Math.max(0, reg.xLeft - horizontalGutter);
        const cutRight = Math.min(this.contentWidth, reg.xRight + horizontalGutter);

        const nextIntervals: HorizontalInterval[] = [];
        for (const iv of freeIntervals) {
          if (cutRight <= iv.xLeft || cutLeft >= iv.xRight) {
            // No horizontal overlap
            nextIntervals.push(iv);
          } else {
            // Split interval into left and/or right pieces
            if (cutLeft > iv.xLeft + 1.0) {
              nextIntervals.push({
                xLeft: iv.xLeft,
                xRight: cutLeft,
                width: cutLeft - iv.xLeft,
              });
            }
            if (cutRight < iv.xRight - 1.0) {
              nextIntervals.push({
                xLeft: cutRight,
                xRight: iv.xRight,
                width: iv.xRight - cutRight,
              });
            }
          }
        }
        freeIntervals = nextIntervals;
      }
    }

    return freeIntervals.filter(iv => iv.width >= 20.0);
  }

  /**
   * Performs pairwise 2D bounding-box collision detection across all registered regions
   * belonging to different streams (e.g. Source vs Rashi, Source vs Tosafot, Rashi vs Tosafot,
   * Text vs Footnote, Text vs Ornament).
   */
  public detectCollisions(tolerancePt: number = 1.0): CollisionPair[] {
    const collisions: CollisionPair[] = [];
    const n = this.occupied.length;

    for (let i = 0; i < n; i++) {
      const a = this.occupied[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.occupied[j];

        // Same-stream consecutive lines are vertically stacked by line height; skip same-role unless horizontal overlap + large vertical overlap
        const isSameStream = a.role === b.role;
        const vThreshold = isSameStream ? 4.0 : tolerancePt;

        const hOverlap = Math.min(a.xRight, b.xRight) - Math.max(a.xLeft, b.xLeft);
        const vOverlap = Math.min(a.yBottom, b.yBottom) - Math.max(a.yTop, b.yTop);

        if (hOverlap > tolerancePt && vOverlap > vThreshold) {
          collisions.push({
            regionA: a,
            regionB: b,
            overlapAreaPt2: hOverlap * vOverlap,
            horizontalOverlapPt: hOverlap,
            verticalOverlapPt: vOverlap,
          });
        }
      }
    }

    return collisions;
  }

  /**
   * v0.9.8 Phase 4 — line-by-line wraparound polygon.
   *
   * VERIFY-FIRST note: the directive asked to "refine spatial-exclusion
   * / dynamic-knee to compute true line-by-line wraparound polygons
   * where the current step-interval approach leaves gaps". Measured
   * against the real tree, the knee solver ALREADY queries
   * `queryAvailableIntervals` per line band (dynamic-knee.ts Phases 2–3)
   * — there is no step-interval approximation left to replace. What was
   * missing was a first-class polygon API over those per-band queries,
   * so callers (the same-page planner, the gap audit) can see the whole
   * page's wraparound shape at once instead of re-querying band by band.
   * This is that API: for every line-height band from `topY` to
   * `bottomY` it returns the exact free intervals in that band — the
   * polygon the commentary wraps around, line by line. Running headers
   * and footers live OUTSIDE [0 .. contentHeight] (the content box
   * already excludes the margins), so they can never appear in the
   * polygon; a band with no intervals means a real full-width blocker
   * (ornament / michtav), not a header.
   */
  public computeWraparoundPolygon(
    topY: number,
    bottomY: number,
    lineHeight: number,
    horizontalGutter: number = 11.0
  ): Array<{ yTop: number; yBottom: number; intervals: HorizontalInterval[] }> {
    const bands: Array<{ yTop: number; yBottom: number; intervals: HorizontalInterval[] }> = [];
    const safeTop = Math.max(0, topY);
    const safeBottom = Math.min(this.contentHeight, bottomY);
    for (let y = safeTop; y < safeBottom; y += lineHeight) {
      const yTop = y;
      const yBottom = Math.min(safeBottom, y + lineHeight);
      bands.push({
        yTop,
        yBottom,
        intervals: this.queryAvailableIntervals(yTop, yBottom, horizontalGutter, 1.5),
      });
    }
    return bands;
  }

  /**
   * v0.9.8 Phase 4 — measure genuinely blank vertical bands in the
   * content box: rows where NO occupied region covers any x at all.
   * Bands shorter than `minHeightPt` (default one commentary line)
   * are leading/trailing slivers, not gaps. A blank band is only a
   * defect when a stream still has unplaced words (the planner checks
   * that separately); a stream that simply ended leaves honest white
   * space, which this reports but does not flag as a gap.
   */
  public static measureBlankBands(
    regions: OccupiedRegion[],
    contentHeight: number,
    minHeightPt: number = 13
  ): Array<{ yTop: number; yBottom: number; heightPt: number }> {
    const bands: Array<{ yTop: number; yBottom: number; heightPt: number }> = [];
    let bandStart = -1;
    for (let y = 0; y < contentHeight; y++) {
      const covered = regions.some(r => y >= r.yTop && y < r.yBottom);
      if (!covered && bandStart < 0) bandStart = y;
      if (covered && bandStart >= 0) {
        if (y - bandStart >= minHeightPt) {
          bands.push({ yTop: bandStart, yBottom: y, heightPt: y - bandStart });
        }
        bandStart = -1;
      }
    }
    if (bandStart >= 0 && contentHeight - bandStart >= minHeightPt) {
      bands.push({ yTop: bandStart, yBottom: contentHeight, heightPt: contentHeight - bandStart });
    }
    return bands;
  }

  /**
   * Static helper to verify an entire PageTypesetResult for any collisions
   */
  public static auditPageCollisions(
    sourceLines: TypesetLine[],
    rashiLines: TypesetLine[],
    tosafotLines: TypesetLine[],
    footnoteLines: TypesetLine[] = [],
    column2Lines: TypesetLine[] = [],
    contentWidth: number = 394
  ): CollisionPair[] {
    const engine = new SpatialExclusionEngine(contentWidth, 1000);

    for (const l of sourceLines) {
      const xRight = l.xRight ?? contentWidth - l.xStart;
      const xLeft = l.xLeft ?? xRight - l.targetWidth;
      engine.registerRegion({
        id: `src-${l.lineIndex}`,
        role: 'main_source',
        xLeft,
        xRight,
        yTop: l.yTop ?? l.yBaseline - l.ascent,
        yBottom: l.yBottom ?? l.yBaseline + l.descent,
        unitId: l.unitId,
      });
    }

    for (const l of column2Lines) {
      const xRight = l.xRight ?? contentWidth - l.xStart;
      const xLeft = l.xLeft ?? xRight - l.targetWidth;
      engine.registerRegion({
        id: `col2-${l.lineIndex}`,
        role: 'regular_paragraph',
        xLeft,
        xRight,
        yTop: l.yTop ?? l.yBaseline - l.ascent,
        yBottom: l.yBottom ?? l.yBaseline + l.descent,
        unitId: l.unitId,
      });
    }

    for (const l of rashiLines) {
      const xRight = l.xRight ?? contentWidth;
      const xLeft = l.xLeft ?? xRight - l.targetWidth;
      engine.registerRegion({
        id: `rashi-${l.lineIndex}`,
        role: 'primary_comment',
        xLeft,
        xRight,
        yTop: l.yTop ?? l.yBaseline - l.ascent,
        yBottom: l.yBottom ?? l.yBaseline + l.descent,
        unitId: l.unitId,
      });
    }

    for (const l of tosafotLines) {
      const xLeft = l.xLeft ?? 0;
      const xRight = l.xRight ?? xLeft + l.targetWidth;
      engine.registerRegion({
        id: `tos-${l.lineIndex}`,
        role: 'secondary_comment',
        xLeft,
        xRight,
        yTop: l.yTop ?? l.yBaseline - l.ascent,
        yBottom: l.yBottom ?? l.yBaseline + l.descent,
        unitId: l.unitId,
      });
    }

    for (const l of footnoteLines) {
      const xRight = l.xRight ?? contentWidth;
      const xLeft = l.xLeft ?? 0;
      engine.registerRegion({
        id: `fn-${l.lineIndex}`,
        role: 'footnote',
        xLeft,
        xRight,
        yTop: l.yTop ?? l.yBaseline - l.ascent,
        yBottom: l.yBottom ?? l.yBaseline + l.descent,
        unitId: l.unitId,
      });
    }

    return engine.detectCollisions(1.2);
  }
}
