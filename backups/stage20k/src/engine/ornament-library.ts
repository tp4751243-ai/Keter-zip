/**
 * Keter Ornament & Graphic Asset Library Engine
 * Manages built-in traditional Jewish holy-book ornaments and the user's personal
 * saved ornament library (supporting PNG, PDF, and vector SVG assets).
 * Automatically selects and places ornaments according to semantic document structure
 * without damaging or colliding with text composition.
 */

import {
  ContentUnit,
  OccupiedRegion,
  OrnamentAsset,
  OrnamentPlacement,
  OrnamentUserRule,
  PlacedOrnament,
} from '../types/typesetter';
import { TypesettingRulesEngine } from './typesetting-rules-engine';

const STORAGE_KEY = 'keter_personal_ornament_library_v1';

export const BUILTIN_ORNAMENTS: OrnamentAsset[] = [
  {
    id: 'orn-vilna-crown',
    name: 'כתר תורה מסורתי — פתיחת פרק (Vilna Crown)',
    placement: 'chapter_opening',
    format: 'svg_builtin',
    svgPathOrDataUrl: 'builtin:vilna_crown',
    widthPt: 180,
    heightPt: 22,
    isUserUploaded: false,
  },
  {
    id: 'orn-sugya-diamond',
    name: 'מפריד סוגיה — שושנת וילנא (Diamond Filigree)',
    placement: 'topic_ending',
    format: 'svg_builtin',
    svgPathOrDataUrl: 'builtin:sugya_diamond',
    widthPt: 140,
    heightPt: 14,
    isUserUploaded: false,
  },
  {
    id: 'orn-siman-scroll',
    name: 'מסגרת סימן הלכתי (Halachic Siman Scroll)',
    placement: 'section_beginning',
    format: 'svg_builtin',
    svgPathOrDataUrl: 'builtin:siman_scroll',
    widthPt: 160,
    heightPt: 18,
    isUserUploaded: false,
  },
  {
    id: 'orn-header-bar',
    name: 'עיטור כותרת רצה (Running Header Flourish)',
    placement: 'header',
    format: 'svg_builtin',
    svgPathOrDataUrl: 'builtin:header_flourish',
    widthPt: 220,
    heightPt: 10,
    isUserUploaded: false,
  },
  {
    id: 'orn-hadran-finial',
    name: 'חותם הדרן עלך — סיום פרק/מסכת (Hadran Finial)',
    placement: 'footer',
    format: 'svg_builtin',
    svgPathOrDataUrl: 'builtin:hadran_finial',
    widthPt: 150,
    heightPt: 20,
    isUserUploaded: false,
  },
];

export class OrnamentLibraryEngine {
  /**
   * Default configurable safety clearance (in pt) required between any placed ornament
   * and any occupied text or footnote region.
   */
  public static readonly DEFAULT_SAFETY_CLEARANCE_PT = 3.5;

  /**
   * Loads all ornaments (built-in + user's personal saved library)
   */
  public static getAllOrnaments(): OrnamentAsset[] {
    const personal = this.getPersonalLibrary();
    return [...BUILTIN_ORNAMENTS, ...personal];
  }

  /**
   * Loads user's personal ornament library from local storage
   */
  public static getPersonalLibrary(): OrnamentAsset[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as OrnamentAsset[];
    } catch {
      return [];
    }
  }

  /**
   * Saves a new user ornament (PNG or PDF) to the dedicated personal library
   */
  public static addPersonalOrnament(asset: OrnamentAsset): OrnamentAsset[] {
    const current = this.getPersonalLibrary();
    const updated = [asset, ...current.filter(a => a.id !== asset.id)];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage quota errors in restricted environments
    }
    return this.getAllOrnaments();
  }

  /**
   * Removes an ornament from the user's personal library
   */
  public static removePersonalOrnament(id: string): OrnamentAsset[] {
    const current = this.getPersonalLibrary().filter(a => a.id !== id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Ignore storage errors
    }
    return this.getAllOrnaments();
  }

  /**
   * Checks whether a candidate content-relative rectangle `[cXLeft..cXRight, cYTop..cYBottom]`
   * is completely free of collisions with all `occupiedRegions` (plus `safetyClearancePt`)
   * and within `[0..contentWidth, 0..maxContentHeight]`.
   */
  public static isCandidateRegionClear(
    cXLeft: number,
    cXRight: number,
    cYTop: number,
    cYBottom: number,
    occupiedRegions: OccupiedRegion[],
    contentWidth: number,
    maxContentHeight: number,
    safetyClearancePt: number = this.DEFAULT_SAFETY_CLEARANCE_PT
  ): boolean {
    if (cXLeft < -0.5 || cXRight > contentWidth + 0.5) return false;
    if (cYTop < -0.5 || cYBottom > maxContentHeight + 0.5) return false;

    for (const reg of occupiedRegions) {
      const horizOverlap =
        Math.min(reg.xRight, cXRight + safetyClearancePt) -
        Math.max(reg.xLeft, cXLeft - safetyClearancePt);
      const vertOverlap =
        Math.min(reg.yBottom, cYBottom + safetyClearancePt) -
        Math.max(reg.yTop, cYTop - safetyClearancePt);
      if (horizOverlap > 0.1 && vertOverlap > 0.1) {
        return false;
      }
    }
    return true;
  }

  /**
   * Resolves ONLY explicitly user-supplied/selected ornaments for the given page units:
   * 1. An ornament explicitly attached to a ContentUnit on this page (`unit.ornamentId`),
   * 2. An ornament explicitly passed in `userSuppliedOrnaments`,
   * 3. An ornament matched by an explicit `userOrnamentRules` rule.
   *
   * Built-in ornaments (`BUILTIN_ORNAMENTS`) are NEVER automatically selected unless explicitly
   * referenced by ID in one of the above user-supplied sources!
   */
  public static resolveExplicitUserOrnaments(
    unitsOnPage: ContentUnit[],
    userSuppliedOrnaments: OrnamentAsset[] = [],
    userOrnamentRules: OrnamentUserRule[] = []
  ): Array<{ asset: OrnamentAsset; unitId?: string }> {
    const catalog = [...userSuppliedOrnaments, ...this.getAllOrnaments()];
    const findAssetById = (id: string): OrnamentAsset | undefined =>
      catalog.find(a => a.id === id);

    const resolved: Array<{ asset: OrnamentAsset; unitId?: string }> = [];
    const seenKeys = new Set<string>();

    // 1. Ornaments explicitly attached to ContentUnits on this page (`unit.ornamentId`)
    for (const u of unitsOnPage) {
      if (u.ornamentId) {
        const asset = findAssetById(u.ornamentId);
        if (asset) {
          const key = `${asset.id}:${u.id}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            resolved.push({ asset, unitId: u.id });
          }
        }
      }
    }

    // 2. Ornaments explicitly supplied in `userSuppliedOrnaments`
    for (const supplied of userSuppliedOrnaments) {
      const key = `${supplied.id}:supplied`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        resolved.push({ asset: supplied });
      }
    }

    // 3. Explicit user-defined ornament rules (`userOrnamentRules`)
    for (const rule of userOrnamentRules) {
      const asset = findAssetById(rule.ornamentId);
      if (!asset) continue;

      const matchesRule = unitsOnPage.some(u => {
        if (rule.targetUnitId && u.id === rule.targetUnitId) return true;
        if (rule.targetRole && u.role === rule.targetRole) return true;
        if (!rule.targetUnitId && !rule.targetRole) return true;
        return false;
      });

      if (matchesRule) {
        const key = `${asset.id}:rule:${rule.placement}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          resolved.push({
            asset: { ...asset, placement: rule.placement },
            unitId: rule.targetUnitId,
          });
        }
      }
    }

    return resolved;
  }

  /**
   * Places ONLY explicitly user-supplied/selected ornaments (`unit.ornamentId`, `userSuppliedOrnaments`,
   * or `userOrnamentRules`) by querying actual `occupiedRegions` with `safetyClearancePt`.
   *
   * STAGE 11D USER-ONLY ORNAMENT POLICY:
   * - NEVER invents, selects, or automatically adds built-in ornaments merely because there is available space.
   * - If the document/page contains zero explicitly supplied/selected ornaments, returns `[]` immediately.
   * - When an ornament IS explicitly supplied/selected by the user, positions it intelligently to avoid
   *   text, footnotes, Rav Text regions, margins, other ornaments, and page boundaries.
   */
  public static autoPlaceOrnaments(
    units: ContentUnit[],
    centerColumnX: number,
    centerColumnWidth: number,
    topY: number,
    bottomTextY: number,
    maxContentHeight: number,
    enabled: boolean = true,
    occupiedRegions: OccupiedRegion[] = [],
    marginInside: number = 35,
    contentWidth: number = 350,
    safetyClearancePt: number = this.DEFAULT_SAFETY_CLEARANCE_PT,
    userSuppliedOrnaments: OrnamentAsset[] = [],
    userOrnamentRules: OrnamentUserRule[] = []
  ): PlacedOrnament[] {
    if (!enabled) return [];

    // LEVEL 0 ENGINE HARD RULE ENFORCEMENT (Stage 11D & Stage 12):
    // Query authoritative central rule engine for `ornaments.userSuppliedOnly` and `ornaments.forbidAutoSelectionOfBuiltins`.
    const userOnlyRule = TypesettingRulesEngine.resolveRule<boolean>('ornaments.userSuppliedOnly');
    const forbidBuiltinsRule = TypesettingRulesEngine.resolveRule<boolean>('ornaments.forbidAutoSelectionOfBuiltins');
    if (!userOnlyRule.value || !forbidBuiltinsRule.value) {
      return [];
    }

    // Stage 11D: Resolve ONLY explicitly user-supplied/selected ornaments for this page.
    // Built-in ornaments are NEVER automatically selected.
    const explicitOrnaments = this.resolveExplicitUserOrnaments(
      units,
      userSuppliedOrnaments,
      userOrnamentRules
    );
    if (explicitOrnaments.length === 0) {
      return [];
    }

    const placed: PlacedOrnament[] = [];

    // Convert `centerColumnX` (which callers pass as either physical `sourceRight` or `contentWidth`)
    // into content-relative `[colCLeft .. colCRight]`
    const isPhysCoord = centerColumnX > contentWidth + 1;
    const colCRight = isPhysCoord ? centerColumnX - marginInside : centerColumnX;
    const colCLeft = Math.max(0, colCRight - centerColumnWidth);
    const colCenterContentX = colCLeft + centerColumnWidth / 2;

    const commitOrnament = (
      asset: OrnamentAsset,
      cXLeft: number,
      cYTop: number,
      w: number,
      h: number,
      tag: string,
      unitId?: string
    ) => {
      const orn: PlacedOrnament = {
        asset,
        x: Number((marginInside + cXLeft).toFixed(2)),
        y: Number(cYTop.toFixed(2)),
        width: Number(w.toFixed(2)),
        height: Number(h.toFixed(2)),
        unitId,
      };
      placed.push(orn);
      occupiedRegions.push({
        id: `ornament-${asset.id}-${tag}`,
        role: 'ornament',
        xLeft: Number(cXLeft.toFixed(2)),
        xRight: Number((cXLeft + w).toFixed(2)),
        yTop: Number(cYTop.toFixed(2)),
        yBottom: Number((cYTop + h).toFixed(2)),
      });
    };

    for (let idx = 0; idx < explicitOrnaments.length; idx++) {
      const { asset, unitId } = explicitOrnaments[idx];
      const isOpeningOrnament =
        asset.placement === 'chapter_opening' ||
        asset.placement === 'section_beginning' ||
        asset.placement === 'header';

      if (isOpeningOrnament) {
        const w = Math.min(centerColumnWidth * 0.85, asset.widthPt);
        const h = asset.heightPt;
        const cXLeft = colCenterContentX - w / 2;
        const cXRight = cXLeft + w;

        // Candidate A: Above `topY` (`y = topY - h - safetyClearancePt`) if not occupied by upper-collar Rashi/Tosafot
        const candAYTop = topY - h - safetyClearancePt;
        let placedOpening = false;
        if (
          candAYTop >= 0 &&
          this.isCandidateRegionClear(
            cXLeft,
            cXRight,
            candAYTop,
            candAYTop + h,
            occupiedRegions,
            contentWidth,
            maxContentHeight,
            safetyClearancePt
          )
        ) {
          commitOrnament(asset, cXLeft, candAYTop, w, h, `user-open-top-${idx}`, unitId);
          placedOpening = true;
        } else {
          // Candidate B: Query horizontal clearance inside the upper-collar gap `[0 .. topY]`
          const collarRegs = occupiedRegions.filter(
            r => r.yTop < topY - 1 && r.yBottom > 1
          );
          const leftCollarMaxX = Math.max(
            0,
            ...collarRegs.filter(r => r.xLeft < contentWidth * 0.45).map(r => r.xRight)
          );
          const rightCollarMinX = Math.min(
            contentWidth,
            ...collarRegs.filter(r => r.xRight > contentWidth * 0.55).map(r => r.xLeft)
          );
          const collarGapW = rightCollarMinX - leftCollarMaxX - safetyClearancePt * 2;

          if (collarGapW >= 48 && topY >= h + safetyClearancePt * 2) {
            const fitW = Math.min(w, collarGapW);
            const fitXLeft = leftCollarMaxX + safetyClearancePt + (collarGapW - fitW) / 2;
            const fitYTop = Math.max(0, (topY - h) / 2);
            if (
              this.isCandidateRegionClear(
                fitXLeft,
                fitXLeft + fitW,
                fitYTop,
                fitYTop + h,
                occupiedRegions,
                contentWidth,
                maxContentHeight,
                safetyClearancePt
              )
            ) {
              commitOrnament(asset, fitXLeft, fitYTop, fitW, h, `user-collar-gap-${idx}`, unitId);
              placedOpening = true;
            }
          }
        }

        // Candidate C: If the user explicitly supplied an opening ornament on a page whose upper collar is full,
        // reposition it to the nearest collision-free zone below the Source/Commentary rather than colliding with text.
        if (!placedOpening) {
          const nonFnOverlappingX = occupiedRegions.filter(
            r =>
              r.role !== 'footnote' &&
              Math.min(r.xRight, cXRight + safetyClearancePt) >
                Math.max(r.xLeft, cXLeft - safetyClearancePt)
          );
          const lowestAboveY =
            nonFnOverlappingX.length > 0
              ? Math.max(...nonFnOverlappingX.map(r => r.yBottom))
              : bottomTextY;
          const candCYTop = Math.max(bottomTextY, lowestAboveY) + Math.max(8, safetyClearancePt * 2);
          if (
            candCYTop + h + safetyClearancePt <= maxContentHeight &&
            this.isCandidateRegionClear(
              cXLeft,
              cXRight,
              candCYTop,
              candCYTop + h,
              occupiedRegions,
              contentWidth,
              maxContentHeight,
              safetyClearancePt
            )
          ) {
            commitOrnament(asset, cXLeft, candCYTop, w, h, `user-open-repositioned-${idx}`, unitId);
          }
        }
      } else {
        // Explicit user-supplied topic-ending / footer ornament in the unoccupied zone below text
        const w = Math.min(centerColumnWidth * 0.65, asset.widthPt);
        const h = asset.heightPt;
        const cXLeft = colCenterContentX - w / 2;
        const cXRight = cXLeft + w;

        const nonFnOverlappingX = occupiedRegions.filter(
          r =>
            r.role !== 'footnote' &&
            Math.min(r.xRight, cXRight + safetyClearancePt) >
              Math.max(r.xLeft, cXLeft - safetyClearancePt)
        );
        const lowestAboveOrnamentY =
          nonFnOverlappingX.length > 0
            ? Math.max(...nonFnOverlappingX.map(r => r.yBottom))
            : bottomTextY;

        const candYTop =
          Math.max(bottomTextY, lowestAboveOrnamentY) + Math.max(8, safetyClearancePt * 2);
        const candYBottom = candYTop + h;

        if (
          candYBottom + safetyClearancePt <= maxContentHeight &&
          maxContentHeight - lowestAboveOrnamentY >= h + 16 &&
          this.isCandidateRegionClear(
            cXLeft,
            cXRight,
            candYTop,
            candYBottom,
            occupiedRegions,
            contentWidth,
            maxContentHeight,
            safetyClearancePt
          )
        ) {
          commitOrnament(asset, cXLeft, candYTop, w, h, `user-ending-${idx}`, unitId);
        }
      }
    }

    return placed;
  }

  /**
   * Draws a `PlacedOrnament` directly onto a 2D Canvas context (used by `PdfExporter` so
   * PDF and `PageCanvas` share identical vector ornament visuals at the exact solved coordinates).
   */
  public static drawOrnamentOnCanvas(
    ctx: CanvasRenderingContext2D,
    orn: PlacedOrnament,
    marginTop: number
  ): void {
    const x = orn.x;
    const y = marginTop + orn.y;
    const w = orn.width;
    const h = orn.height;
    const midX = x + w / 2;
    const midY = y + h / 2;

    ctx.save();
    ctx.strokeStyle = '#78350F';
    ctx.fillStyle = '#78350F';
    ctx.lineWidth = 0.85;

    if (orn.asset.placement === 'chapter_opening') {
      // Traditional Vilna Crown / Flourish Banner
      ctx.beginPath();
      ctx.moveTo(x + 6, midY + 3);
      ctx.lineTo(midX - 18, midY + 3);
      ctx.moveTo(midX + 18, midY + 3);
      ctx.lineTo(x + w - 6, midY + 3);
      ctx.stroke();

      // Central Crown Arch
      ctx.beginPath();
      ctx.moveTo(midX - 12, midY + 4);
      ctx.quadraticCurveTo(midX, y + 2, midX + 12, midY + 4);
      ctx.closePath();
      ctx.stroke();

      // Center Jewel
      ctx.beginPath();
      ctx.arc(midX, y + 4.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Traditional Vilna Diamond Filigree / Sugya Finial
      const wingLen = Math.max(12, w * 0.36);
      ctx.beginPath();
      ctx.moveTo(midX - wingLen, midY);
      ctx.lineTo(midX - 8, midY);
      ctx.moveTo(midX + 8, midY);
      ctx.lineTo(midX + wingLen, midY);
      ctx.stroke();

      // Center Diamond
      const dSize = Math.min(4.2, h * 0.3);
      ctx.beginPath();
      ctx.moveTo(midX, midY - dSize);
      ctx.lineTo(midX + dSize * 1.3, midY);
      ctx.lineTo(midX, midY + dSize);
      ctx.lineTo(midX - dSize * 1.3, midY);
      ctx.closePath();
      ctx.fill();

      // Side Dots
      ctx.beginPath();
      ctx.arc(midX - 11, midY, 1.1, 0, Math.PI * 2);
      ctx.arc(midX + 11, midY, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Draws an explicitly user-selected `PlacedOrnament` as native vector paths directly onto a `jsPDF` page
   * at its exact solved coordinates (`orn.x, marginTop + orn.y, orn.width, orn.height`).
   */
  public static drawOrnamentOnPdf(
    doc: any,
    orn: PlacedOrnament,
    marginTop: number
  ): void {
    const x = orn.x;
    const y = marginTop + orn.y;
    const w = orn.width;
    const h = orn.height;
    const midX = x + w / 2;
    const midY = y + h / 2;

    doc.setDrawColor(120, 53, 15); // #78350F
    doc.setFillColor(120, 53, 15);
    doc.setLineWidth(0.85);

    if (orn.asset.placement === 'chapter_opening') {
      doc.line(x + 6, midY + 3, midX - 18, midY + 3);
      doc.line(midX + 18, midY + 3, x + w - 6, midY + 3);
      // Central Crown Arch
      doc.line(midX - 12, midY + 4, midX, y + 2);
      doc.line(midX, y + 2, midX + 12, midY + 4);
      doc.line(midX - 12, midY + 4, midX + 12, midY + 4);
      // Center Jewel
      doc.circle(midX, y + 4.5, 1.8, 'F');
    } else {
      const wingLen = Math.max(12, w * 0.36);
      doc.line(midX - wingLen, midY, midX - 8, midY);
      doc.line(midX + 8, midY, midX + wingLen, midY);
      // Center Diamond
      const dSize = Math.min(4.2, h * 0.3);
      doc.triangle(midX, midY - dSize, midX + dSize * 1.3, midY, midX, midY + dSize, 'F');
      doc.triangle(midX, midY - dSize, midX - dSize * 1.3, midY, midX, midY + dSize, 'F');
      // Side Dots
      doc.circle(midX - 11, midY, 1.1, 'F');
      doc.circle(midX + 11, midY, 1.1, 'F');
    }
  }
}
