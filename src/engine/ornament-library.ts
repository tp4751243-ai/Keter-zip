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
  // ── v0.9.9 title-page preset collection: original Keter vector
  // ornaments for the title-page templates (foot emblem, top medallion,
  // dividers). Drawn from scratch as simple geometric shapes — never
  // copied or traced from the reference title pages. A template selects
  // one explicitly (the user picked the template), so these are never
  // auto-placed by `autoPlaceOrnaments`.
  {
    id: 'orn-tp-foot-emblem',
    name: 'סמל שער — מדליון כתר (Title-page foot emblem)',
    placement: 'footer',
    format: 'svg_builtin',
    svgPathOrDataUrl: 'builtin:tp_foot_emblem',
    widthPt: 54,
    heightPt: 32,
    isUserUploaded: false,
  },
  {
    id: 'orn-tp-top-medallion',
    name: 'מדליון עליון לשער (Title-page top medallion)',
    placement: 'header',
    format: 'svg_builtin',
    svgPathOrDataUrl: 'builtin:tp_top_medallion',
    widthPt: 100,
    heightPt: 30,
    isUserUploaded: false,
  },
  {
    id: 'orn-tp-leaf-divider',
    name: 'מפריד עלה לשער (Title-page leaf divider)',
    placement: 'topic_ending',
    format: 'svg_builtin',
    svgPathOrDataUrl: 'builtin:tp_leaf_divider',
    widthPt: 120,
    heightPt: 24,
    isUserUploaded: false,
  },
  {
    id: 'orn-tp-ring-divider',
    name: 'מפריד טבעות לשער (Title-page ring divider)',
    placement: 'topic_ending',
    format: 'svg_builtin',
    svgPathOrDataUrl: 'builtin:tp_ring_divider',
    widthPt: 140,
    heightPt: 24,
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

  /**
   * Draw an Opening Word Ornamental Box (`openingWordBox`) onto a 2D Canvas.
   * All styles are original Keter vector geometry keeping enclosed text readable.
   */
  public static drawOpeningWordBoxOnCanvas(
    ctx: CanvasRenderingContext2D,
    box: import('../types/typesetter').OpeningWordBoxGeom,
    marginTop: number,
    marginLeft: number
  ): void {
    const x = marginLeft + box.xLeft;
    const y = marginTop + box.yTop;
    const w = Math.max(24, box.xRight - box.xLeft);
    const h = Math.max(18, box.yBottom - box.yTop);
    const midX = x + w / 2;

    ctx.save();
    ctx.strokeStyle = '#1E1B18';
    ctx.fillStyle = '#FCFAF5';
    ctx.lineWidth = 1.0;

    if (box.styleId === 'simple_frame') {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    } else if (box.styleId === 'crown_panel') {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.lineWidth = 0.6;
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      // Center top filigree arch
      ctx.fillStyle = '#1E1B18';
      ctx.beginPath();
      ctx.moveTo(midX - 16, y);
      ctx.quadraticCurveTo(midX, y - 8, midX + 16, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(midX, y - 5, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (box.styleId === 'chumash_cartouche') {
      const r = 6;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 0.55;
      ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
    } else {
      // 'double_ornate' (traditional Vilna Masechet initial-word frame)
      ctx.fillRect(x, y, w, h);
      ctx.lineWidth = 1.1;
      ctx.strokeRect(x, y, w, h);
      ctx.lineWidth = 0.6;
      ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
      // Corner rosette dots
      ctx.fillStyle = '#1E1B18';
      const corners: Array<[number, number]> = [
        [x + 3.5, y + 3.5],
        [x + w - 3.5, y + 3.5],
        [x + 3.5, y + h - 3.5],
        [x + w - 3.5, y + h - 3.5],
      ];
      for (const [cx, cy] of corners) {
        ctx.beginPath();
        ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (box.text && box.text.trim()) {
      const fontPt = Math.max(10, Math.min(h * 0.52, (w * 0.72) / Math.max(2, box.text.length * 0.52)));
      ctx.fillStyle = '#121214';
      ctx.font = `700 ${fontPt}px "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(box.text, midX, y + h / 2);
    }
    ctx.restore();
  }

  /**
   * Draw an Opening Word Ornamental Box (`openingWordBox`) as native vector paths on jsPDF.
   */
  public static drawOpeningWordBoxOnPdf(
    doc: any,
    box: import('../types/typesetter').OpeningWordBoxGeom,
    marginTop: number,
    marginLeft: number,
    strokeHex = '#1E1B18'
  ): void {
    const x = marginLeft + box.xLeft;
    const y = marginTop + box.yTop;
    const w = Math.max(24, box.xRight - box.xLeft);
    const h = Math.max(18, box.yBottom - box.yTop);
    const midX = x + w / 2;
    const rgb = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(strokeHex);
    const [r, g, b] = rgb ? [parseInt(rgb[1], 16), parseInt(rgb[2], 16), parseInt(rgb[3], 16)] : [30, 27, 24];

    doc.setFillColor(252, 250, 245);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(1.0);
    doc.rect(x, y, w, h, 'FD');

    if (box.styleId !== 'simple_frame') {
      doc.setLineWidth(0.6);
      doc.rect(x + 3.5, y + 3.5, w - 7, h - 7, 'S');
      doc.setFillColor(r, g, b);
      if (box.styleId === 'crown_panel') {
        doc.line(midX - 14, y, midX, y - 6);
        doc.line(midX, y - 6, midX + 14, y);
        doc.circle(midX, y - 6.5, 1.4, 'F');
      } else {
        doc.circle(x + 3.5, y + 3.5, 1.4, 'F');
        doc.circle(x + w - 3.5, y + 3.5, 1.4, 'F');
        doc.circle(x + 3.5, y + h - 3.5, 1.4, 'F');
        doc.circle(x + w - 3.5, y + h - 3.5, 1.4, 'F');
      }
    }
  }

  /**
   * Draw a layout-level Commentary/Paragraph separator rule on 2D Canvas.
   */
  public static drawSeparatorRuleOnCanvas(
    ctx: CanvasRenderingContext2D,
    styleId: import('../types/typesetter').SeparatorStyleId,
    xLeft: number,
    xRight: number,
    yCenter: number,
    widthRatio = 0.45,
    thicknessPt = 0.65,
    color = '#4B4640'
  ): void {
    if (!styleId || styleId === 'none') return;
    const span = Math.max(18, (xRight - xLeft) * Math.max(0.15, Math.min(1, widthRatio)));
    const midX = (xLeft + xRight) / 2;
    const lx = midX - span / 2;
    const rx = midX + span / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(0.4, thicknessPt);

    if (styleId === 'colon') {
      // v0.9.9 (I2): literal ':' glyph — the traditional Vilna trailing
      // colon after the last Rashi/Tosafot line. Distinct from
      // 'colon_dot', which renders a centred dot (•).
      ctx.font = `700 ${Math.max(10, thicknessPt * 14)}px "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(':', midX, yCenter);
    } else if (styleId === 'colon_dot') {
      ctx.beginPath();
      ctx.arc(midX, yCenter, Math.max(1.1, thicknessPt * 1.6), 0, Math.PI * 2);
      ctx.fill();
    } else if (styleId === 'thin_rule') {
      ctx.beginPath();
      ctx.moveTo(lx, yCenter);
      ctx.lineTo(rx, yCenter);
      ctx.stroke();
    } else if (styleId === 'double_rule') {
      ctx.beginPath();
      ctx.moveTo(lx, yCenter - 1.2);
      ctx.lineTo(rx, yCenter - 1.2);
      ctx.moveTo(lx, yCenter + 1.2);
      ctx.lineTo(rx, yCenter + 1.2);
      ctx.stroke();
    } else if (styleId === 'centered_diamond') {
      ctx.beginPath();
      ctx.moveTo(lx, yCenter);
      ctx.lineTo(midX - 5, yCenter);
      ctx.moveTo(midX + 5, yCenter);
      ctx.lineTo(rx, yCenter);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(midX, yCenter - 2.6);
      ctx.lineTo(midX + 3.2, yCenter);
      ctx.lineTo(midX, yCenter + 2.6);
      ctx.lineTo(midX - 3.2, yCenter);
      ctx.closePath();
      ctx.fill();
    } else if (styleId === 'scrolled_divider') {
      ctx.beginPath();
      ctx.moveTo(lx, yCenter);
      ctx.quadraticCurveTo(lx + span * 0.25, yCenter - 2.5, midX - 4, yCenter);
      ctx.moveTo(midX + 4, yCenter);
      ctx.quadraticCurveTo(rx - span * 0.25, yCenter + 2.5, rx, yCenter);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(midX, yCenter, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Draw a layout-level Commentary/Paragraph separator rule on jsPDF vector page.
   */
  public static drawSeparatorRuleOnPdf(
    doc: any,
    styleId: import('../types/typesetter').SeparatorStyleId,
    xLeft: number,
    xRight: number,
    yCenter: number,
    widthRatio = 0.45,
    thicknessPt = 0.65,
    colorHex = '#4B4640'
  ): void {
    if (!styleId || styleId === 'none') return;
    const span = Math.max(18, (xRight - xLeft) * Math.max(0.15, Math.min(1, widthRatio)));
    const midX = (xLeft + xRight) / 2;
    const lx = midX - span / 2;
    const rx = midX + span / 2;
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colorHex);
    const [r, g, b] = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [75, 70, 64];
    doc.setDrawColor(r, g, b);
    doc.setFillColor(r, g, b);
    doc.setLineWidth(Math.max(0.4, thicknessPt));

    if (styleId === 'colon') {
      // v0.9.9 (I2): literal ':' glyph — see the canvas branch above.
      // jsPDF has no middle-baseline text here, so the baseline sits a
      // few points below the separator centre line.
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(':', midX, yCenter + 3.5, { align: 'center' });
    } else if (styleId === 'colon_dot') {
      doc.circle(midX, yCenter, Math.max(1.1, thicknessPt * 1.5), 'F');
    } else if (styleId === 'thin_rule') {
      doc.line(lx, yCenter, rx, yCenter);
    } else if (styleId === 'double_rule') {
      doc.line(lx, yCenter - 1.2, rx, yCenter - 1.2);
      doc.line(lx, yCenter + 1.2, rx, yCenter + 1.2);
    } else {
      // centered_diamond or scrolled_divider
      doc.line(lx, yCenter, midX - 4.5, yCenter);
      doc.line(midX + 4.5, yCenter, rx, yCenter);
      doc.triangle(midX, yCenter - 2.4, midX + 3, yCenter, midX, yCenter + 2.4, 'F');
      doc.triangle(midX, yCenter - 2.4, midX - 3, yCenter, midX, yCenter + 2.4, 'F');
    }
  }

  // ── v0.9.9 title-page ornaments ──────────────────────────────────────
  //
  // The four `orn-tp-*` built-ins above, as ORIGINAL vector geometry in
  // three renderings that share the same shapes: SVG markup (title-page
  // preview overlay), 2D canvas (canvas PDF fallback) and jsPDF vector
  // (native PDF). The PDF title-page path does not call these yet — see
  // `title-page-templates.ts` ("PDF gaps"); the helpers exist so the
  // coordinator can wire one call per renderer.

  /** viewBox (w × h) for each title-page ornament's SVG markup. */
  public static readonly TITLE_PAGE_ORNAMENT_VIEWBOX: Record<string, { w: number; h: number }> = {
    'orn-tp-foot-emblem': { w: 100, h: 60 },
    'orn-tp-top-medallion': { w: 100, h: 30 },
    'orn-tp-leaf-divider': { w: 120, h: 24 },
    'orn-tp-ring-divider': { w: 140, h: 24 },
  };

  /**
   * SVG inner markup for a title-page ornament, in its viewBox space.
   * Own generated geometry only (no user text), so `dangerouslySetInnerHTML`
   * is safe here. Returns '' for an unknown id.
   */
  public static titlePageOrnamentSvgMarkup(assetId: string, colorHex = '#2A2622'): string {
    const c = colorHex;
    if (assetId === 'orn-tp-foot-emblem') {
      // Crown-like medallion: outer ring, inner arch, centre diamond, side dots.
      return [
        `<circle cx="50" cy="30" r="26" fill="none" stroke="${c}" stroke-width="2" />`,
        `<circle cx="50" cy="30" r="20" fill="none" stroke="${c}" stroke-width="1" />`,
        `<path d="M 38 34 Q 50 16 62 34" fill="none" stroke="${c}" stroke-width="1.5" />`,
        `<path d="M 50 24 L 56 30 L 50 36 L 44 30 Z" fill="${c}" />`,
        `<circle cx="50" cy="14" r="2" fill="${c}" />`,
        `<circle cx="28" cy="30" r="1.8" fill="${c}" />`,
        `<circle cx="72" cy="30" r="1.8" fill="${c}" />`,
      ].join('');
    }
    if (assetId === 'orn-tp-top-medallion') {
      // Small scroll medallion: centre diamond, curling scrolls each side.
      return [
        `<path d="M 50 8 L 56 15 L 50 22 L 44 15 Z" fill="${c}" />`,
        `<path d="M 42 15 Q 30 6 20 12 Q 12 17 18 22" fill="none" stroke="${c}" stroke-width="1.5" />`,
        `<path d="M 58 15 Q 70 6 80 12 Q 88 17 82 22" fill="none" stroke="${c}" stroke-width="1.5" />`,
        `<circle cx="18" cy="22" r="1.6" fill="${c}" />`,
        `<circle cx="82" cy="22" r="1.6" fill="${c}" />`,
      ].join('');
    }
    if (assetId === 'orn-tp-leaf-divider') {
      // Horizontal rule with a central leaf sprig.
      return [
        `<line x1="4" y1="12" x2="46" y2="12" stroke="${c}" stroke-width="1.2" />`,
        `<line x1="74" y1="12" x2="116" y2="12" stroke="${c}" stroke-width="1.2" />`,
        `<path d="M 50 12 Q 60 2 70 12 Q 60 22 50 12 Z" fill="${c}" />`,
        `<line x1="60" y1="12" x2="60" y2="20" stroke="${c}" stroke-width="1" />`,
        `<circle cx="46" cy="12" r="1.6" fill="${c}" />`,
        `<circle cx="74" cy="12" r="1.6" fill="${c}" />`,
      ].join('');
    }
    if (assetId === 'orn-tp-ring-divider') {
      // Three rings joined by short rules.
      return [
        `<line x1="4" y1="12" x2="34" y2="12" stroke="${c}" stroke-width="1.2" />`,
        `<line x1="106" y1="12" x2="136" y2="12" stroke="${c}" stroke-width="1.2" />`,
        `<line x1="56" y1="12" x2="64" y2="12" stroke="${c}" stroke-width="1.2" />`,
        `<line x1="76" y1="12" x2="84" y2="12" stroke="${c}" stroke-width="1.2" />`,
        `<circle cx="45" cy="12" r="7" fill="none" stroke="${c}" stroke-width="1.4" />`,
        `<circle cx="70" cy="12" r="7" fill="none" stroke="${c}" stroke-width="1.4" />`,
        `<circle cx="95" cy="12" r="7" fill="none" stroke="${c}" stroke-width="1.4" />`,
        `<circle cx="70" cy="12" r="2" fill="${c}" />`,
      ].join('');
    }
    return '';
  }

  /** Draw a title-page ornament on a 2D canvas at (x, y, w, h) in points. */
  public static drawTitlePageOrnamentOnCanvas(
    ctx: CanvasRenderingContext2D,
    assetId: string,
    x: number,
    y: number,
    w: number,
    h: number,
    colorHex = '#2A2622'
  ): void {
    const vb = this.TITLE_PAGE_ORNAMENT_VIEWBOX[assetId];
    if (!vb) return;
    const sx = w / vb.w;
    const sy = h / vb.h;
    const X = (vx: number) => x + vx * sx;
    const Y = (vy: number) => y + vy * sy;
    ctx.save();
    ctx.strokeStyle = colorHex;
    ctx.fillStyle = colorHex;
    ctx.lineWidth = Math.max(0.5, 1.2 * Math.min(sx, sy));
    const diamond = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(X(cx), Y(cy - r));
      ctx.lineTo(X(cx + r), Y(cy));
      ctx.lineTo(X(cx), Y(cy + r));
      ctx.lineTo(X(cx - r), Y(cy));
      ctx.closePath();
      ctx.fill();
    };
    const dot = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      ctx.arc(X(cx), Y(cy), r * Math.min(sx, sy), 0, Math.PI * 2);
      ctx.fill();
    };
    const ring = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      ctx.arc(X(cx), Y(cy), r * Math.min(sx, sy), 0, Math.PI * 2);
      ctx.stroke();
    };
    if (assetId === 'orn-tp-foot-emblem') {
      ring(50, 30, 26);
      ring(50, 30, 20);
      ctx.beginPath();
      ctx.moveTo(X(38), Y(34));
      ctx.quadraticCurveTo(X(50), Y(16), X(62), Y(34));
      ctx.stroke();
      diamond(50, 30, 6);
      dot(50, 14, 2);
      dot(28, 30, 1.8);
      dot(72, 30, 1.8);
    } else if (assetId === 'orn-tp-top-medallion') {
      diamond(50, 15, 7);
      ctx.beginPath();
      ctx.moveTo(X(42), Y(15));
      ctx.quadraticCurveTo(X(30), Y(6), X(20), Y(12));
      ctx.quadraticCurveTo(X(12), Y(17), X(18), Y(22));
      ctx.moveTo(X(58), Y(15));
      ctx.quadraticCurveTo(X(70), Y(6), X(80), Y(12));
      ctx.quadraticCurveTo(X(88), Y(17), X(82), Y(22));
      ctx.stroke();
      dot(18, 22, 1.6);
      dot(82, 22, 1.6);
    } else if (assetId === 'orn-tp-leaf-divider') {
      ctx.beginPath();
      ctx.moveTo(X(4), Y(12));
      ctx.lineTo(X(46), Y(12));
      ctx.moveTo(X(74), Y(12));
      ctx.lineTo(X(116), Y(12));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X(50), Y(12));
      ctx.quadraticCurveTo(X(60), Y(2), X(70), Y(12));
      ctx.quadraticCurveTo(X(60), Y(22), X(50), Y(12));
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(X(60), Y(12));
      ctx.lineTo(X(60), Y(20));
      ctx.stroke();
      dot(46, 12, 1.6);
      dot(74, 12, 1.6);
    } else if (assetId === 'orn-tp-ring-divider') {
      ctx.beginPath();
      ctx.moveTo(X(4), Y(12));
      ctx.lineTo(X(34), Y(12));
      ctx.moveTo(X(106), Y(12));
      ctx.lineTo(X(136), Y(12));
      ctx.moveTo(X(56), Y(12));
      ctx.lineTo(X(64), Y(12));
      ctx.moveTo(X(76), Y(12));
      ctx.lineTo(X(84), Y(12));
      ctx.stroke();
      ring(45, 12, 7);
      ring(70, 12, 7);
      ring(95, 12, 7);
      dot(70, 12, 2);
    }
    ctx.restore();
  }

  /** Draw a title-page ornament as native vector paths on a jsPDF page. */
  public static drawTitlePageOrnamentOnPdf(
    doc: any,
    assetId: string,
    x: number,
    y: number,
    w: number,
    h: number,
    colorHex = '#2A2622'
  ): void {
    const vb = this.TITLE_PAGE_ORNAMENT_VIEWBOX[assetId];
    if (!vb) return;
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colorHex);
    const [r, g, b] = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [42, 38, 34];
    const sx = w / vb.w;
    const sy = h / vb.h;
    const s = Math.min(sx, sy);
    const X = (vx: number) => x + vx * sx;
    const Y = (vy: number) => y + vy * sy;
    doc.setDrawColor(r, g, b);
    doc.setFillColor(r, g, b);
    doc.setLineWidth(Math.max(0.4, 1.1 * s));
    const diamond = (cx: number, cy: number, rr: number) => {
      doc.triangle(X(cx), Y(cy - rr), X(cx + rr), Y(cy), X(cx), Y(cy + rr), 'F');
      doc.triangle(X(cx), Y(cy - rr), X(cx - rr), Y(cy), X(cx), Y(cy + rr), 'F');
    };
    if (assetId === 'orn-tp-foot-emblem') {
      doc.circle(X(50), Y(30), 26 * s, 'S');
      doc.circle(X(50), Y(30), 20 * s, 'S');
      doc.line(X(38), Y(34), X(50), Y(18));
      doc.line(X(50), Y(18), X(62), Y(34));
      diamond(50, 30, 6);
      doc.circle(X(50), Y(14), 2 * s, 'F');
      doc.circle(X(28), Y(30), 1.8 * s, 'F');
      doc.circle(X(72), Y(30), 1.8 * s, 'F');
    } else if (assetId === 'orn-tp-top-medallion') {
      diamond(50, 15, 7);
      doc.line(X(42), Y(15), X(28), Y(8));
      doc.line(X(28), Y(8), X(18), Y(20));
      doc.line(X(58), Y(15), X(72), Y(8));
      doc.line(X(72), Y(8), X(82), Y(20));
      doc.circle(X(18), Y(22), 1.6 * s, 'F');
      doc.circle(X(82), Y(22), 1.6 * s, 'F');
    } else if (assetId === 'orn-tp-leaf-divider') {
      doc.line(X(4), Y(12), X(46), Y(12));
      doc.line(X(74), Y(12), X(116), Y(12));
      doc.line(X(60), Y(12), X(60), Y(20));
      doc.triangle(X(50), Y(12), X(60), Y(3), X(70), Y(12), 'F');
      doc.triangle(X(50), Y(12), X(60), Y(21), X(70), Y(12), 'F');
      doc.circle(X(46), Y(12), 1.6 * s, 'F');
      doc.circle(X(74), Y(12), 1.6 * s, 'F');
    } else if (assetId === 'orn-tp-ring-divider') {
      doc.line(X(4), Y(12), X(34), Y(12));
      doc.line(X(106), Y(12), X(136), Y(12));
      doc.line(X(56), Y(12), X(64), Y(12));
      doc.line(X(76), Y(12), X(84), Y(12));
      doc.circle(X(45), Y(12), 7 * s, 'S');
      doc.circle(X(70), Y(12), 7 * s, 'S');
      doc.circle(X(95), Y(12), 7 * s, 'S');
      doc.circle(X(70), Y(12), 2 * s, 'F');
    }
  }
}
