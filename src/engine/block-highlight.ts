/**
 * Keter Typesetter — Unified Block-Level Highlight Geometry (v0.6.0, Part B)
 *
 * Pure geometry behind the "one outline per section" rule: when a paragraph,
 * Mishnah, Gemara or comment block is hovered or selected, ALL of its lines
 * are wrapped in ONE single bounding box — never one box per word or per
 * line. `lineBlockRectPx` mirrors the geometry math in PageCanvas's
 * `renderLine` (right offset, indents, width, top/height) for a single
 * line, in content-area px; `unionBlockBoxPx` unions a unit's lines into
 * that one box; `blockInfoForUnit` is the same box plus the section's
 * metadata, in content-area points (origin: top-left of the text frame),
 * for the state manager via `onHoverBlock`.
 *
 * Extracted from PageCanvas.tsx (v0.5.0 Part B) into a pure module so the
 * smoke test can verify the union math — including multi-line RTL Hebrew
 * blocks and commentary tiers — without a DOM. Pagination and shaping are
 * untouched: this only reads already-typeset lines.
 *
 * Original offline code. No network, no new dependencies.
 */

import {
  BookLayoutType,
  ContentRole,
  ContentUnit,
  DynamicKneeContour,
  PageGeometry,
  TypesetLine,
} from '../types/typesetter';
import { DesignSelectionTarget } from '../types/design-settings';

export interface BlockRectPx {
  topPx: number;
  bottomPx: number;
  rightPx: number;
  widthPx: number;
}

/**
 * The content-area px rectangle of one typeset line, mirroring
 * PageCanvas's `renderLine` geometry exactly (same right-offset rules per
 * layout/role, same first-line + right/left indents, same top/height).
 */
export function lineBlockRectPx(
  line: TypesetLine,
  geometry: PageGeometry,
  knee: DynamicKneeContour,
  layoutType: BookLayoutType,
  scale: number
): BlockRectPx {
  const contentWidthPt =
    geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
  let rightOffsetPt: number;
  if (line.xRight !== undefined) {
    rightOffsetPt = Math.max(0, contentWidthPt - line.xRight);
  } else if (line.xLeft !== undefined) {
    rightOffsetPt = Math.max(0, contentWidthPt - (line.xLeft + line.targetWidth));
  } else if (layoutType === 'rav_text' || layoutType === 'mikraot_gedolot') {
    if (line.role === 'secondary_comment') {
      rightOffsetPt = Math.max(0, contentWidthPt - line.targetWidth);
    } else if (line.role === 'primary_comment' || line.role === 'footnote') {
      rightOffsetPt = line.xStart ?? 0;
    } else {
      rightOffsetPt =
        knee.rightCommentaryWidth + knee.gutterWidth + (line.xStart ?? 0);
    }
  } else {
    rightOffsetPt = line.xStart ?? 0;
  }
  const firstIndentPt = line.firstLineIndentPt ?? line.firstLineIndent ?? 0;
  const rightIndentPt = (line.rightIndentPt ?? 0) + firstIndentPt;
  const leftIndentPt = line.leftIndentPt ?? 0;
  const rightPx = (rightOffsetPt + rightIndentPt) * scale;
  const widthPx =
    Math.max(
      20,
      line.targetWidth > 0
        ? line.targetWidth
        : (line.xRight !== undefined && line.xLeft !== undefined
            ? line.xRight - line.xLeft
            : contentWidthPt) -
            rightIndentPt -
            leftIndentPt
    ) * scale;
  const topPx = (line.yBaseline - line.ascent) * scale;
  return { topPx, bottomPx: topPx + line.height * scale, rightPx, widthPx };
}

/**
 * ONE bounding box for a whole section: the union of its lines' rectangles.
 * Returns null when the unit has no lines on this page.
 */
export function unionBlockBoxPx(
  unitLines: TypesetLine[],
  geometry: PageGeometry,
  knee: DynamicKneeContour,
  layoutType: BookLayoutType,
  scale: number
): BlockRectPx | null {
  if (!unitLines || unitLines.length === 0) return null;
  let top = Infinity;
  let bottom = -Infinity;
  let right = Infinity;
  let far = -Infinity;
  for (const line of unitLines) {
    const r = lineBlockRectPx(line, geometry, knee, layoutType, scale);
    top = Math.min(top, r.topPx);
    bottom = Math.max(bottom, r.bottomPx);
    right = Math.min(right, r.rightPx);
    far = Math.max(far, r.rightPx + r.widthPx);
  }
  return { topPx: top, bottomPx: bottom, rightPx: right, widthPx: Math.max(0, far - right) };
}

/**
 * The section's metadata + bounding box in content-area points, for the
 * state manager (`onHoverBlock`) and the inspector panel.
 */
export function blockInfoForUnit(
  unitId: string,
  unitLines: TypesetLine[],
  units: ContentUnit[],
  geometry: PageGeometry,
  knee: DynamicKneeContour,
  layoutType: BookLayoutType,
  scale: number
): NonNullable<DesignSelectionTarget['blockBoundary']> | null {
  const box = unionBlockBoxPx(unitLines, geometry, knee, layoutType, scale);
  if (!unitLines || unitLines.length === 0 || !box) return null;
  const contentWidthPt =
    geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
  const unit = units.find(u => u.id === unitId);
  return {
    unitId,
    role: (unit?.role ?? unitLines[0]?.role) as ContentRole,
    lineCount: unitLines.length,
    firstLineIndex: unitLines[0].lineIndex,
    lastLineIndex: unitLines[unitLines.length - 1].lineIndex,
    topPt: Number((box.topPx / scale).toFixed(2)),
    bottomPt: Number((box.bottomPx / scale).toFixed(2)),
    leftPt: Number(
      (contentWidthPt - (box.rightPx + box.widthPx) / scale).toFixed(2)
    ),
    rightPt: Number((contentWidthPt - box.rightPx / scale).toFixed(2)),
  };
}
