/**
 *Backup of broken Stage 17G+H PageCanvas.tsx before Emergency Recovery
 * Root cause of regression in Stage 17G+H:
 * Line 322 used `const rightPx = line.xStart * scale;` for all streams (Source, Rashi, Tosafot, Footnotes),
 * ignoring `line.xLeft` / `line.xRight` stamped by `SpatialExclusionEngine.registerLine`.
 * Because `line.xStart` is `0` for Rashi, Tosafot, and standard Source lines in Rav-Text,
 * all three streams rendered at `right: 0px` on top of each other!
 */
export const STAGE17GH_BROKEN_COORDINATE_NOTE = true;
