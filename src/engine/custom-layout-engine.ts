/**
 * v0.5.0 Part C — Module 3 (Custom Layout Designer): pure layout engine.
 *
 * Everything here is offline and deterministic, with no React and no
 * localStorage writes except the template store at the bottom (templates
 * are a user library, so they live outside any single project).
 *
 * Concepts:
 * - A `CustomLayoutBox` is a text frame in % of the page content area.
 * - `planCustomLayoutFlow` is the reflow: it walks the book's units in
 *   order, fills each box with as many words as fit (by measured capacity:
 *   box width / average glyph width × lines per box), and continues on the
 *   next page with the same box set. The result is the exact unit→box
 *   assignment the designer preview renders and the pagination engine can
 *   consume (see REPORT.md for the one-line PaginationEngine dispatch).
 * - Templates are named box sets saved to localStorage; `savePending…` /
 *   `consumePending…` is the seam the New-Project flow uses so the
 *   designer's boxes reach `createDefaultSettings` without an App.tsx edit.
 */

import { BookLayoutType, ContentRole, ContentUnit } from '../types/typesetter';
import {
  CustomLayoutBox,
  CustomLayoutBoxRole,
  CustomLayoutBoxRules,
  CustomLayoutBoxTier,
  CustomLayoutDesign,
  CustomLayoutExclusion,
  CustomLayoutPolygonKind,
  CustomLayoutPolygonPoint,
  CustomLayoutPolygonShape,
  CustomLayoutTemplate,
} from '../types/design-settings';

/** Snap-to-grid step used when the user has not chosen one (points). */
export const CUSTOM_LAYOUT_DEFAULT_GRID_PT = 6;
/** Minimum readable box size, in % of the content area. */
export const CUSTOM_LAYOUT_MIN_WIDTH_PCT = 10;
export const CUSTOM_LAYOUT_MIN_HEIGHT_PCT = 5;

const TEMPLATES_KEY = 'keter_custom_layout_templates_v1';
const PENDING_KEY = 'keter_pending_custom_layout_v1';

export const CUSTOM_LAYOUT_BOX_ROLE_LABELS_HE: Record<CustomLayoutBoxRole, string> = {
  main_text: 'טקסט ראשי',
  commentary: 'פירוש',
  header: 'כותרת',
  footnote: 'הערות שוליים',
  side_note: 'הערת צד',
};

export const CUSTOM_LAYOUT_BOX_ROLE_LABELS_EN: Record<CustomLayoutBoxRole, string> = {
  main_text: 'Main text',
  commentary: 'Commentary',
  header: 'Header',
  footnote: 'Footnotes',
  side_note: 'Side note',
};

/** Which ContentRoles a box of each kind receives text from. */
export const CUSTOM_LAYOUT_BOX_ROLES: Record<CustomLayoutBoxRole, ContentRole[]> = {
  main_text: ['main_source', 'verse', 'regular_paragraph', 'chapter', 'siman', 'seif', 'introduction', 'main_title', 'subtitle', 'heading', 'subheading', 'bold_special'],
  commentary: ['primary_comment', 'secondary_comment', 'tertiary_comment', 'dibbur_hamatchil'],
  header: ['heading', 'chapter', 'main_title', 'subtitle'],
  footnote: ['footnote'],
  side_note: ['side_note', 'cross_reference'],
};

// ── v0.9.0 Part B — manuscript tier assignment ───────────────────────────
// The tier is the fine assignment of a box (Rashi vs Tosafot vs side
// gloss…); v0.9.2 Part A (A1) made the tier the flow key
// (acceptedRolesForBox) — before that the role stayed the flow key and
// the tier was write-only. A box with no explicit tier uses the tier
// implied by its role.
export const CUSTOM_LAYOUT_BOX_TIER_LABELS_HE: Record<CustomLayoutBoxTier, string> = {
  main_text: 'טקסט ראשי',
  main_drush: 'דרוש ראשי',
  rashi: 'רש״י',
  tosafot: 'תוספות',
  side_gloss: 'גליון / הערת צד',
  bottom_note: 'הערה תחתונה',
  marginal_citation: 'מראה מקום',
  footnote: 'הערת שוליים',
  header: 'כותרת',
  footer: 'כותרת תחתונה',
  commentary: 'פירוש',
};

export const CUSTOM_LAYOUT_BOX_TIER_LABELS_EN: Record<CustomLayoutBoxTier, string> = {
  main_text: 'Main Text',
  main_drush: 'Main Drush',
  rashi: 'Rashi',
  tosafot: 'Tosafot',
  side_gloss: 'Side Gloss',
  bottom_note: 'Bottom Note',
  marginal_citation: 'Marginal Citation',
  footnote: 'Footnote',
  header: 'Header',
  footer: 'Footer',
  commentary: 'Commentary',
};

/** The 11 tiers in the order the Manuscript Designer offers them. */
export const CUSTOM_LAYOUT_BOX_TIERS: CustomLayoutBoxTier[] = [
  'main_text',
  'main_drush',
  'rashi',
  'tosafot',
  'side_gloss',
  'bottom_note',
  'marginal_citation',
  'footnote',
  'header',
  'footer',
  'commentary',
];

/** Tier implied by a box role when the box carries no explicit tier. */
export function tierForRole(role: CustomLayoutBoxRole): CustomLayoutBoxTier {
  switch (role) {
    case 'main_text': return 'main_text';
    case 'commentary': return 'commentary';
    case 'header': return 'header';
    case 'footnote': return 'footnote';
    case 'side_note': return 'side_gloss';
  }
}

/** Effective tier of a box (explicit tier, else the role's tier). */
export function effectiveBoxTier(box: CustomLayoutBox): CustomLayoutBoxTier {
  return box.tier ?? tierForRole(box.role);
}

/**
 * Which ContentRoles a box of each manuscript tier receives text from.
 * v0.9.2 Part A (A1): before this, the tier a user picked in the
 * Manuscript Designer was write-only — flow keyed on `box.role` only,
 * so a box tiered "Rashi" still received every commentary (or, with a
 * role of `commentary`, all three commentaries mixed). The tier is now
 * the flow key; the role is only the fallback when no tier is set.
 * `footer` has no content role: footer text is engine-generated (folio
 * number), never flowed into a text box.
 */
export const CUSTOM_LAYOUT_BOX_TIER_ROLES: Record<CustomLayoutBoxTier, ContentRole[]> = {
  main_text: ['main_source', 'verse', 'regular_paragraph', 'chapter', 'siman', 'seif', 'introduction', 'main_title', 'subtitle', 'heading', 'subheading', 'bold_special'],
  main_drush: ['regular_paragraph', 'main_source', 'verse'],
  rashi: ['primary_comment', 'dibbur_hamatchil'],
  tosafot: ['secondary_comment', 'dibbur_hamatchil'],
  side_gloss: ['side_note', 'cross_reference'],
  bottom_note: ['footnote', 'tertiary_comment'],
  marginal_citation: ['cross_reference', 'side_note'],
  footnote: ['footnote'],
  header: ['heading', 'chapter', 'main_title', 'subtitle'],
  footer: [],
  commentary: ['primary_comment', 'secondary_comment', 'tertiary_comment', 'dibbur_hamatchil'],
};

/** ContentRoles this box accepts: its tier's roles, else its role's roles. */
export function acceptedRolesForBox(box: CustomLayoutBox): ContentRole[] {
  if (box.tier) return CUSTOM_LAYOUT_BOX_TIER_ROLES[box.tier];
  return CUSTOM_LAYOUT_BOX_ROLES[box.role];
}

/**
 * True when this box is the main-text box (the homeless-role fallback sink).
 * v0.9.2 Part A (A1): the main body box is the sink whatever its tier —
 * a drush book's main box is tier `main_drush`, not `main_text`, and
 * without it as a sink a homeless role (siman, list, table…) at the head
 * of the queue blocked the whole book behind it (strict book order).
 */
export function isMainTextBox(box: CustomLayoutBox): boolean {
  const tier = effectiveBoxTier(box);
  return tier === 'main_text' || tier === 'main_drush';
}

/**
 * Clamp a font size to this box's rule-inspector min/max (no rules = no
 * change). v0.9.2 Part A (A1): the min/max fields were write-only — the
 * real paginator never read them.
 */
export function clampFontSizeForBox(fontSizePt: number, box: CustomLayoutBox): number {
  const min = box.rules?.minFontSizePt;
  const max = box.rules?.maxFontSizePt;
  let next = fontSizePt;
  if (typeof min === 'number') next = Math.max(min, next);
  if (typeof max === 'number') next = Math.min(max, next);
  return next;
}

export function boxTierLabel(tier: CustomLayoutBoxTier, lang: 'he' | 'en'): string {
  return lang === 'en'
    ? CUSTOM_LAYOUT_BOX_TIER_LABELS_EN[tier]
    : CUSTOM_LAYOUT_BOX_TIER_LABELS_HE[tier];
}

/** Clamp per-box rule-inspector values; invalid values are dropped. */
export function sanitizeCustomLayoutBoxRules(
  rules: CustomLayoutBoxRules | undefined
): CustomLayoutBoxRules | undefined {
  if (!rules) return undefined;
  const out: CustomLayoutBoxRules = {};
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const min = num(rules.minFontSizePt);
  const max = num(rules.maxFontSizePt);
  if (min !== undefined) out.minFontSizePt = Math.max(6, Math.min(72, min));
  if (max !== undefined) out.maxFontSizePt = Math.max(6, Math.min(72, max));
  if (
    out.minFontSizePt !== undefined &&
    out.maxFontSizePt !== undefined &&
    out.maxFontSizePt < out.minFontSizePt
  ) {
    out.maxFontSizePt = out.minFontSizePt;
  }
  const lh = num(rules.lineHeightRatio);
  if (lh !== undefined) out.lineHeightRatio = Math.max(1.0, Math.min(2.2, lh));
  const gutter = num(rules.columnGutterPt);
  if (gutter !== undefined) out.columnGutterPt = Math.max(0, Math.min(72, gutter));
  if (
    rules.alignment === 'justify' ||
    rules.alignment === 'right' ||
    rules.alignment === 'center' ||
    rules.alignment === 'left'
  ) {
    out.alignment = rules.alignment;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** True when `tier` is one of the 11 manuscript tiers. */
export function isCustomLayoutBoxTier(v: unknown): v is CustomLayoutBoxTier {
  return (
    typeof v === 'string' &&
    (CUSTOM_LAYOUT_BOX_TIERS as string[]).includes(v)
  );
}

export function boxRoleLabel(role: CustomLayoutBoxRole, lang: 'he' | 'en'): string {
  return lang === 'en'
    ? CUSTOM_LAYOUT_BOX_ROLE_LABELS_EN[role]
    : CUSTOM_LAYOUT_BOX_ROLE_LABELS_HE[role];
}

function newBoxId(): string {
  return `box-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeCustomLayoutBox(
  role: CustomLayoutBoxRole,
  xPct: number,
  yPct: number,
  widthPct: number,
  heightPct: number,
  labelHe?: string
): CustomLayoutBox {
  return {
    id: newBoxId(),
    role,
    // v0.9.0 Part B — a fresh box starts on its role's tier; the user
    // re-assigns it in the Manuscript Designer's tier dropdown.
    tier: tierForRole(role),
    labelHe: labelHe ?? CUSTOM_LAYOUT_BOX_ROLE_LABELS_HE[role],
    labelEn: CUSTOM_LAYOUT_BOX_ROLE_LABELS_EN[role],
    xPct,
    yPct,
    widthPct,
    heightPct,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// v0.6.0 Part C (§2) — polygonal text frames.
// A box's flow region is a polygon in box-normalized coordinates (0..1).
// The pagination engine asks `boxFlowIntervals` for the free horizontal
// intervals of ONE line band, so text really flows inside L / T / cross
// frames and around cut-out exclusions instead of inside a rectangle.
// The scanline is taken at the band's mid-height: intervals are constant
// between polygon vertices, so a mid-band sample is exact for straight
// edges (a vertex exactly on the mid-line is nudged by an epsilon).
// ─────────────────────────────────────────────────────────────────────────────

export const CUSTOM_LAYOUT_POLYGON_KINDS: CustomLayoutPolygonKind[] = [
  'rectangle',
  // v0.9.0 Part B — 'ellipse' had presets + labels but was missing from
  // this list, so the ellipse button never appeared and the shape was
  // unreachable from the UI. The list now matches the label table.
  'ellipse',
  'l_shape',
  't_shape',
  'inverted_t',
  'cross',
  'custom',
];

export const CUSTOM_LAYOUT_POLYGON_LABELS_HE: Record<CustomLayoutPolygonKind, string> = {
  rectangle: 'מלבן',
  ellipse: 'אליפסה',
  l_shape: 'צורת L',
  t_shape: 'צורת T',
  inverted_t: 'צורת T הפוכה',
  cross: 'צלב (+)',
  custom: 'מצולע חופשי',
};

export const CUSTOM_LAYOUT_POLYGON_LABELS_EN: Record<CustomLayoutPolygonKind, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  l_shape: 'L-shape',
  t_shape: 'T-shape',
  inverted_t: 'Inverted T',
  cross: 'Cross (+)',
  custom: 'Free polygon',
};

/**
 * Preset vertices (normalized 0..1 inside the box, clockwise from the
 * top-left). The L keeps a full-width foot at the bottom and a narrow
 * stem at the top; the T keeps a full-width bar at the top and a centred
 * stem below; the inverted T mirrors it; the cross is a centred plus.
 */
export function polygonPresetPoints(
  kind: CustomLayoutPolygonKind
): CustomLayoutPolygonPoint[] {
  switch (kind) {
    case 'l_shape':
      return [
        { x: 0, y: 0 }, { x: 0.55, y: 0 }, { x: 0.55, y: 0.6 },
        { x: 1, y: 0.6 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      ];
    case 't_shape':
      return [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.35 },
        { x: 0.68, y: 0.35 }, { x: 0.68, y: 1 }, { x: 0.32, y: 1 },
        { x: 0.32, y: 0.35 }, { x: 0, y: 0.35 },
      ];
    case 'inverted_t':
      return [
        { x: 0.32, y: 0 }, { x: 0.68, y: 0 }, { x: 0.68, y: 0.65 },
        { x: 1, y: 0.65 }, { x: 1, y: 1 }, { x: 0, y: 1 },
        { x: 0, y: 0.65 }, { x: 0.32, y: 0.65 },
      ];
    case 'cross':
      return [
        { x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 0.65, y: 0.35 },
        { x: 1, y: 0.35 }, { x: 1, y: 0.65 }, { x: 0.65, y: 0.65 },
        { x: 0.65, y: 1 }, { x: 0.35, y: 1 }, { x: 0.35, y: 0.65 },
        { x: 0, y: 0.65 }, { x: 0, y: 0.35 }, { x: 0.35, y: 0.35 },
      ];
    case 'ellipse': {
      const pts: CustomLayoutPolygonPoint[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (2 * Math.PI * i) / 16;
        pts.push({ x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) });
      }
      return pts;
    }
    case 'rectangle':
      return [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      ];
    case 'custom':
    default:
      return [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 },
        { x: 0.7, y: 1 }, { x: 0, y: 1 },
      ];
  }
}

export function makePolygonShape(
  kind: CustomLayoutPolygonKind
): CustomLayoutPolygonShape {
  return { kind, points: polygonPresetPoints(kind) };
}

/** Clamp vertices into the box, drop duplicates, require ≥ 3 points. */
export function sanitizePolygonShape(
  shape: CustomLayoutPolygonShape | undefined
): CustomLayoutPolygonShape | undefined {
  if (!shape || !Array.isArray(shape.points)) return undefined;
  const pts: CustomLayoutPolygonPoint[] = [];
  for (const p of shape.points) {
    const x = Math.max(0, Math.min(1, Number(p.x) || 0));
    const y = Math.max(0, Math.min(1, Number(p.y) || 0));
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev.x - x) < 0.005 && Math.abs(prev.y - y) < 0.005) continue;
    pts.push({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) });
  }
  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first.x - last.x) < 0.005 && Math.abs(first.y - last.y) < 0.005) pts.pop();
  }
  if (pts.length < 3) return undefined;
  const kind: CustomLayoutPolygonKind =
    shape.kind === 'rectangle' ? 'rectangle' : shape.kind || 'custom';
  return { kind, points: pts };
}

export function sanitizeCustomLayoutExclusion(
  ex: CustomLayoutExclusion
): CustomLayoutExclusion | null {
  const pts = sanitizePolygonShape({ kind: 'custom', points: ex.points });
  if (!pts) return null;
  return { id: ex.id || newBoxId(), points: pts.points };
}

/** Shoelace area of a normalized polygon (0..1 = whole box). */
export function polygonAreaFraction(points: CustomLayoutPolygonPoint[]): number {
  if (points.length < 3) return 1;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.max(0, Math.min(1, Math.abs(a) / 2));
}

/**
 * Horizontal intervals of a polygon at one normalized height `yNorm`
 * (0 = top of the box). Even-odd scanline: every edge crossing the
 * horizontal line contributes an x, sorted into [left, right] pairs.
 */
export function polygonIntervalsAtY(
  points: CustomLayoutPolygonPoint[],
  yNorm: number
): Array<{ xLeft: number; xRight: number }> {
  const y = yNorm === 0 ? 1e-6 : yNorm === 1 ? 1 - 1e-6 : yNorm;
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a.y === b.y) continue;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y < lo || y >= hi) continue;
    const t = (y - a.y) / (b.y - a.y);
    xs.push(a.x + t * (b.x - a.x));
  }
  xs.sort((p, q) => p - q);
  const out: Array<{ xLeft: number; xRight: number }> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const xLeft = Math.max(0, xs[i]);
    const xRight = Math.min(1, xs[i + 1]);
    if (xRight - xLeft > 0.01) out.push({ xLeft, xRight });
  }
  return out;
}

function subtractIntervals(
  base: Array<{ xLeft: number; xRight: number }>,
  cuts: Array<{ xLeft: number; xRight: number }>
): Array<{ xLeft: number; xRight: number }> {
  let out = base;
  for (const cut of cuts) {
    const next: Array<{ xLeft: number; xRight: number }> = [];
    for (const iv of out) {
      if (cut.xRight <= iv.xLeft || cut.xLeft >= iv.xRight) {
        next.push(iv);
        continue;
      }
      if (cut.xLeft > iv.xLeft) next.push({ xLeft: iv.xLeft, xRight: cut.xLeft });
      if (cut.xRight < iv.xRight) next.push({ xLeft: cut.xRight, xRight: iv.xRight });
    }
    out = next;
  }
  return out;
}

/**
 * Free horizontal intervals (content-area points) where text may flow on
 * one line band inside `box`: the box's polygon at the band's mid-height,
 * minus every exclusion polygon, in content coordinates.
 */
export function boxFlowIntervals(
  box: CustomLayoutBox,
  lineTopPt: number,
  lineBottomPt: number,
  contentWidthPt: number,
  contentHeightPt: number
): Array<{ xLeft: number; xRight: number; width: number }> {
  const boxX = (box.xPct / 100) * contentWidthPt;
  const boxY = (box.yPct / 100) * contentHeightPt;
  const boxW = Math.max(10, (box.widthPct / 100) * contentWidthPt);
  const boxH = Math.max(10, (box.heightPct / 100) * contentHeightPt);
  const yMid = (lineTopPt + lineBottomPt) / 2;
  const yNorm = (yMid - boxY) / boxH;
  if (yNorm < 0 || yNorm > 1) return [];
  let intervals = box.shape?.points?.length
    ? polygonIntervalsAtY(box.shape.points, yNorm)
    : [{ xLeft: 0, xRight: 1 }];
  for (const ex of box.exclusions ?? []) {
    if (!ex.points?.length) continue;
    intervals = subtractIntervals(intervals, polygonIntervalsAtY(ex.points, yNorm));
  }
  return intervals
    .map(iv => ({
      xLeft: boxX + iv.xLeft * boxW,
      xRight: boxX + iv.xRight * boxW,
      width: (iv.xRight - iv.xLeft) * boxW,
    }))
    .filter(iv => iv.width >= 10);
}

/** Fraction of the box's area text can actually use (shape + cut-outs). */
export function shapeAreaFraction(box: CustomLayoutBox): number {
  let f = box.shape?.points?.length ? polygonAreaFraction(box.shape.points) : 1;
  for (const ex of box.exclusions ?? []) {
    if (ex.points?.length) f -= polygonAreaFraction(ex.points);
  }
  return Math.max(0.05, Math.min(1, f));
}

// ── end v0.6.0 Part C (§2) polygon geometry ────────────────────────────────

/**
 * Default boxes for a base layout, in % of the content area.
 * Rav-text default mirrors the Vilna page (source centre, Rashi inside,
 * Tosafot outside); single-column is one full box; two-column is two
 * side-by-side boxes; top/bottom splits source from commentaries.
 */
export function defaultBoxesForBaseLayout(baseLayout: BookLayoutType): CustomLayoutBox[] {
  switch (baseLayout) {
    case 'two_column':
      return [
        makeCustomLayoutBox('main_text', 0, 0, 48, 88),
        makeCustomLayoutBox('commentary', 52, 0, 48, 88),
        makeCustomLayoutBox('footnote', 0, 90, 100, 10),
      ];
    case 'source_top_commentary_bottom':
      return [
        makeCustomLayoutBox('main_text', 0, 0, 100, 44),
        makeCustomLayoutBox('commentary', 0, 48, 48, 40),
        makeCustomLayoutBox('commentary', 52, 48, 48, 40),
        makeCustomLayoutBox('footnote', 0, 90, 100, 10),
      ];
    case 'mikraot_gedolot':
      return [
        makeCustomLayoutBox('main_text', 0, 0, 100, 30),
        makeCustomLayoutBox('commentary', 0, 34, 48, 54),
        makeCustomLayoutBox('commentary', 52, 34, 48, 54),
        makeCustomLayoutBox('footnote', 0, 90, 100, 10),
      ];
    case 'yiddish_sefer':
      // v0.8.0 Part D — Hebrew source right, Yiddish text left.
      return [
        makeCustomLayoutBox('main_text', 55, 0, 45, 88, 'מקור עברי'),
        makeCustomLayoutBox('commentary', 0, 0, 52, 88, 'טקסט יידיש'),
        makeCustomLayoutBox('footnote', 0, 90, 100, 10),
      ];
    case 'single_column':
      return [
        makeCustomLayoutBox('header', 0, 0, 100, 7),
        makeCustomLayoutBox('main_text', 0, 9, 100, 79),
        makeCustomLayoutBox('footnote', 0, 90, 100, 10),
      ];
    case 'rav_text':
    case 'custom_layout':
    default:
      return [
        makeCustomLayoutBox('commentary', 0, 0, 24, 100, 'רש״י'),
        makeCustomLayoutBox('main_text', 26, 0, 48, 100, 'גמרא'),
        makeCustomLayoutBox('commentary', 76, 0, 24, 100, 'תוספות'),
        makeCustomLayoutBox('footnote', 26, 88, 48, 12),
      ];
  }
}

export function defaultCustomLayoutDesign(
  baseLayout: BookLayoutType = 'rav_text'
): CustomLayoutDesign {
  return {
    enabled: true,
    baseLayout: baseLayout === 'custom_layout' ? 'rav_text' : baseLayout,
    boxes: defaultBoxesForBaseLayout(baseLayout),
    gridSizePt: CUSTOM_LAYOUT_DEFAULT_GRID_PT,
    pageOverrides: {},
  };
}

/** Snap one % value to the grid (grid in pt, converted via the page size). */
export function snapPctToGrid(
  valuePct: number,
  gridSizePt: number,
  pageSizePt: number
): number {
  if (!gridSizePt || gridSizePt <= 0 || pageSizePt <= 0) return valuePct;
  const stepPct = (gridSizePt / pageSizePt) * 100;
  return Math.round(valuePct / stepPct) * stepPct;
}

/** Clamp one box into the content area + minimum size; snap if a grid is set. */
export function sanitizeCustomLayoutBox(
  box: CustomLayoutBox,
  opts?: { gridSizePt?: number; pageWidthPt?: number; pageHeightPt?: number }
): CustomLayoutBox {
  const grid = opts?.gridSizePt ?? 0;
  const pw = opts?.pageWidthPt ?? 482;
  const ph = opts?.pageHeightPt ?? 680;
  let x = Math.max(0, Math.min(100 - CUSTOM_LAYOUT_MIN_WIDTH_PCT, box.xPct));
  let y = Math.max(0, Math.min(100 - CUSTOM_LAYOUT_MIN_HEIGHT_PCT, box.yPct));
  let w = Math.max(
    CUSTOM_LAYOUT_MIN_WIDTH_PCT,
    Math.min(100 - x, box.widthPct)
  );
  let h = Math.max(
    CUSTOM_LAYOUT_MIN_HEIGHT_PCT,
    Math.min(100 - y, box.heightPct)
  );
  if (grid > 0) {
    x = snapPctToGrid(x, grid, pw);
    y = snapPctToGrid(y, grid, ph);
    w = Math.max(CUSTOM_LAYOUT_MIN_WIDTH_PCT, snapPctToGrid(w, grid, pw));
    h = Math.max(CUSTOM_LAYOUT_MIN_HEIGHT_PCT, snapPctToGrid(h, grid, ph));
    if (x + w > 100) w = 100 - x;
    if (y + h > 100) h = 100 - y;
  }
  return {
    ...box,
    xPct: Number(x.toFixed(2)),
    yPct: Number(y.toFixed(2)),
    widthPct: Number(w.toFixed(2)),
    heightPct: Number(h.toFixed(2)),
    // v0.9.0 Part B — tier + rule-inspector values survive the sanitizer
    // (an unknown tier falls back to the role's tier; rule values are
    // clamped, never silently widened).
    tier: isCustomLayoutBoxTier(box.tier) ? box.tier : tierForRole(box.role),
    rules: sanitizeCustomLayoutBoxRules(box.rules),
    fontSizePt:
      box.fontSizePt === undefined
        ? undefined
        : Math.max(6, Math.min(72, box.fontSizePt)),
    lineHeight:
      box.lineHeight === undefined
        ? undefined
        : Math.max(1.0, Math.min(2.2, box.lineHeight)),
    // v0.6.0 Part C (§2): polygon flow region + cut-outs survive the
    // sanitizer (invalid shapes are dropped, never faked as rectangles
    // with silently different geometry — a dropped shape means the box
    // is a plain rectangle again).
    shape: sanitizePolygonShape(box.shape),
    exclusions: (box.exclusions ?? [])
      .map(e => sanitizeCustomLayoutExclusion(e))
      .filter((e): e is CustomLayoutExclusion => e !== null),
  };
}

export interface CustomLayoutValidation {
  boxes: CustomLayoutBox[];
  pageOverrides: Record<string, CustomLayoutBox[]>;
  warnings: string[];
  overlaps: Array<{ a: string; b: string }>;
}

/** Sanitizes a whole design; overlapping boxes are warned about, not moved. */
export function sanitizeCustomLayoutDesign(
  design: CustomLayoutDesign,
  opts?: { pageWidthPt?: number; pageHeightPt?: number }
): CustomLayoutValidation {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const boxes: CustomLayoutBox[] = [];
  for (const raw of design.boxes ?? []) {
    let id = raw.id || newBoxId();
    if (seen.has(id)) {
      id = newBoxId();
      warnings.push(`נמצאה תיבה עם מזהה כפול — הוקצה לה מזהה חדש.`);
    }
    seen.add(id);
    boxes.push(
      sanitizeCustomLayoutBox(
        { ...raw, id },
        { gridSizePt: design.gridSizePt, ...opts }
      )
    );
  }
  const overlaps: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.xPct + a.widthPct, b.xPct + b.widthPct) - Math.max(a.xPct, b.xPct);
      const overlapY = Math.min(a.yPct + a.heightPct, b.yPct + b.heightPct) - Math.max(a.yPct, b.yPct);
      if (overlapX > 0.5 && overlapY > 0.5) {
        overlaps.push({ a: a.id, b: b.id });
        warnings.push(
          `התיבות "${a.labelHe ?? a.role}" ו-"${b.labelHe ?? b.role}" חופפות — הטקסט עלול להידרס. גררו אחת מהן הצידה.`
        );
      }
    }
  }
  const pageOverrides: Record<string, CustomLayoutBox[]> = {};
  for (const [page, list] of Object.entries(design.pageOverrides ?? {})) {
    pageOverrides[page] = list.map(b =>
      sanitizeCustomLayoutBox(b, { gridSizePt: design.gridSizePt, ...opts })
    );
  }
  return {
    boxes,
    pageOverrides,
    warnings,
    overlaps,
  };
}

/** How many words of `fontSizePt` text fit in this box (rough, offline).
 *  A polygonal frame or cut-outs shrink the usable area, so the capacity
 *  is scaled by the shape's area fraction — the designer preview then
 *  shows roughly what the real pagination will fit. */
export function estimateBoxCapacity(
  box: CustomLayoutBox,
  contentWidthPt: number,
  contentHeightPt: number,
  fontSizePt: number,
  lineHeight: number = 1.32
): { lines: number; charsPerLine: number; words: number } {
  const boxW = Math.max(20, (box.widthPct / 100) * contentWidthPt);
  const boxH = Math.max(10, (box.heightPct / 100) * contentHeightPt);
  const lineH = Math.max(6, fontSizePt * lineHeight);
  const lines = Math.max(1, Math.floor(boxH / lineH));
  // Hebrew holy-book type averages ~0.52 × font size per glyph incl. spacing.
  const avgCharW = Math.max(2, fontSizePt * 0.52);
  const charsPerLine = Math.max(4, Math.floor(boxW / avgCharW));
  // Average Hebrew word incl. space ≈ 6 characters.
  const words = Math.max(
    1,
    Math.floor((lines * charsPerLine) / 6) * shapeAreaFraction(box)
  );
  return { lines, charsPerLine, words };
}

export interface BoxAssignment {
  boxId: string;
  boxRole: CustomLayoutBoxRole;
  unitId: string;
  unitRole: ContentRole;
  /** Word slice of the unit placed in this box (0-based, end exclusive). */
  wordStart: number;
  wordEnd: number;
  text: string;
}

export interface CustomLayoutPagePlan {
  pageIndex: number;
  assignments: BoxAssignment[];
  /** True when more units remain after this page. */
  hasMoreContent: boolean;
}

export interface PlanCustomLayoutOptions {
  contentWidthPt?: number;
  contentHeightPt?: number;
  fontSizePtByRole?: Partial<Record<ContentRole, number>>;
  defaultFontSizePt?: number;
  lineHeight?: number;
}

/**
 * The reflow: flows `units` (in order) into `boxes` (in array order),
 * box by box, page by page. A unit too long for one box continues in the
 * next matching box, then on the next page. Units whose role matches no
 * box fall through to the first `main_text` box (or the first box at all),
 * so no text is ever silently dropped — `unplacedUnitIds` lists them.
 */
export function planCustomLayoutFlow(
  units: ContentUnit[],
  boxes: CustomLayoutBox[],
  opts: PlanCustomLayoutOptions = {}
): { pages: CustomLayoutPagePlan[]; unplacedUnitIds: string[] } {
  const contentWidthPt = opts.contentWidthPt ?? 394;
  const contentHeightPt = opts.contentHeightPt ?? 584;
  const defaultSize = opts.defaultFontSizePt ?? 13;
  const lineHeight = opts.lineHeight ?? 1.32;
  if (boxes.length === 0 || units.length === 0) {
    return { pages: [], unplacedUnitIds: units.map(u => u.id) };
  }

  const sizeFor = (role: ContentRole): number =>
    opts.fontSizePtByRole?.[role] ?? defaultSize;

  // Per-box remaining capacity (words) is recomputed per page.
  const capacities = boxes.map(b => {
    const accepted = acceptedRolesForBox(b);
    const roleSize =
      sizeFor(accepted[0] ?? 'main_source');
    // v0.9.2 Part A (A1): capacity uses the box's effective font size
    // (rules min/max clamp) and effective line height (rules ratio first),
    // so the preview's capacity matches what the paginator really fits.
    return estimateBoxCapacity(
      b,
      contentWidthPt,
      contentHeightPt,
      clampFontSizeForBox(b.fontSizePt ?? roleSize, b),
      b.rules?.lineHeightRatio ?? b.lineHeight ?? lineHeight
    ).words;
  });

  // Roles at least one box is for — used by the fallback pass so only
  // truly homeless roles spill into a main_text box (see below).
  // v0.9.2 Part A (A1): tier roles, not role roles — a box tiered Rashi
  // covers primary_comment, not every commentary.
  const rolesCovered = new Set<ContentRole>(
    boxes.flatMap(b => acceptedRolesForBox(b))
  );

  // Queue of (unit, nextWordIndex) in book order.
  const queue: Array<{ unit: ContentUnit; words: string[]; next: number }> =
    units.map(u => ({
      unit: u,
      words: u.rawText.trim().split(/\s+/).filter(Boolean),
      next: 0,
    }));
  const unplacedUnitIds: string[] = [];
  const pages: CustomLayoutPagePlan[] = [];
  let guard = 0;

  while (queue.some(q => q.next < q.words.length) && guard < 500) {
    guard++;
    const pageIndex = pages.length;
    const assignments: BoxAssignment[] = [];
    const remaining = [...capacities];
    let placedAny = false;

    for (let bIdx = 0; bIdx < boxes.length; bIdx++) {
      const box = boxes[bIdx];
      // v0.9.2 Part A (A1): the box's tier decides what it accepts.
      const acceptedRoles = acceptedRolesForBox(box);
      // First pass: units whose role this box is for. Second pass (only
      // in a main_text box, and only for units whose role NO box in the
      // set is for): so text whose role has no box is never silently
      // dropped, while commentary never spills into the main-text box
      // (or vice versa) just because a box still has room.
      for (let pass = 0; pass < 2 && remaining[bIdx] > 0; pass++) {
        for (const q of queue) {
          if (remaining[bIdx] <= 0) break;
          if (q.next >= q.words.length) continue;
          const roleMatches = acceptedRoles.includes(q.unit.role);
          if (pass === 0 && !roleMatches) continue;
          if (pass === 1) {
            if (!isMainTextBox(box)) continue;
            if (rolesCovered.has(q.unit.role)) continue;
          }
          const take = Math.min(remaining[bIdx], q.words.length - q.next);
          const wordStart = q.next;
          q.next += take;
          remaining[bIdx] -= take;
          placedAny = true;
          assignments.push({
            boxId: box.id,
            boxRole: box.role,
            unitId: q.unit.id,
            unitRole: q.unit.role,
            wordStart,
            wordEnd: q.next,
            text: q.words.slice(wordStart, q.next).join(' '),
          });
        }
      }
    }

    if (!placedAny) {
      // No box could take the next word (should not happen: capacities
      // are >= 1 word). Break instead of looping forever; the leftovers
      // are reported as unplaced.
      for (const q of queue) {
        if (q.next < q.words.length) unplacedUnitIds.push(q.unit.id);
      }
      break;
    }
    pages.push({
      pageIndex,
      assignments,
      hasMoreContent: queue.some(q => q.next < q.words.length),
    });
  }

  return { pages, unplacedUnitIds };
}

/** Short real Hebrew sample units so the designer preview shows live fitted text. */
export function samplePreviewUnits(): ContentUnit[] {
  return [
    {
      id: 'preview-source',
      role: 'main_source',
      rawText:
        'מתניתין: מאימתי קורין את שמע בערבית? משעה שהכהנים נכנסים לאכול בתרומתן, עד סוף האשמורה הראשונה, דברי רבי אליעזר. וחכמים אומרים: עד חצות.',
      styleName: 'Main Source',
      order: 1,
      hierarchyLevel: 2,
    },
    {
      id: 'preview-rashi',
      role: 'primary_comment',
      rawText:
        'מאימתי קורין: דיבור המתחיל — זמן קריאת שמע של ערבית מתחיל משעה שהכהנים נכנסים לאכול בתרומתן, והוא זמן צאת הכוכבים.',
      styleName: 'Primary Commentary',
      order: 2,
      hierarchyLevel: 3,
      dibburHamatchil: 'מאימתי קורין',
    },
    {
      id: 'preview-tosafot',
      role: 'secondary_comment',
      rawText:
        'תוספות: מאימתי — יש לשאול מדוע פתח התנא בזמן קריאת שמע של ערבית קודם לשל שחרית, ותירצו מפני שהיום הולך אחר הלילה.',
      styleName: 'Secondary Commentary',
      order: 3,
      hierarchyLevel: 3,
      dibburHamatchil: 'מאימתי',
    },
    {
      id: 'preview-footnote',
      role: 'footnote',
      rawText: 'הערה: ראה ברכות דף ב עמוד א, ורש״י שם ד״ה מאימתי.',
      styleName: 'Footnote',
      order: 4,
      hierarchyLevel: 4,
    },
  ];
}

// ---------------------------------------------------------------------------
// Template library (localStorage) + pending-template seam for new projects.
// ---------------------------------------------------------------------------

function readTemplates(): CustomLayoutTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomLayoutTemplate[]) : [];
  } catch {
    return [];
  }
}

export function listCustomLayoutTemplates(): CustomLayoutTemplate[] {
  return readTemplates().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveCustomLayoutTemplate(
  nameHe: string,
  baseLayout: BookLayoutType,
  boxes: CustomLayoutBox[]
): CustomLayoutTemplate {
  const now = Date.now();
  const cleanName = nameHe.trim() || 'תבנית מותאמת אישית';
  const tpl: CustomLayoutTemplate = {
    id: `tpl-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    nameHe: cleanName,
    nameEn: cleanName,
    baseLayout,
    boxes: boxes.map(b => ({ ...b })),
    createdAt: now,
    updatedAt: now,
  };
  const all = [tpl, ...readTemplates()].slice(0, 30);
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all));
  } catch {
    // Template library is best-effort; the in-memory boxes still work.
  }
  return tpl;
}

export function deleteCustomLayoutTemplate(id: string): void {
  try {
    localStorage.setItem(
      TEMPLATES_KEY,
      JSON.stringify(readTemplates().filter(t => t.id !== id))
    );
  } catch {
    // Ignore storage errors.
  }
}

export function findCustomLayoutTemplateByName(name: string): CustomLayoutTemplate | undefined {
  const needle = name.trim().toLowerCase();
  return readTemplates().find(
    t => t.nameHe.toLowerCase() === needle || t.nameEn.toLowerCase() === needle
  );
}

/**
 * The New-Project seam: the designer (Home / New-Project modal) saves the
 * boxes the user just drew here; `createDefaultSettings` for a
 * `custom_layout` project consumes them once, so the boxes survive project
 * creation without any App.tsx change. Returns null when nothing is pending.
 */
export function savePendingCustomLayout(design: CustomLayoutDesign): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(design));
  } catch {
    // Ignore storage errors — the project still opens with default boxes.
  }
}

export function consumePendingCustomLayout(): CustomLayoutDesign | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_KEY);
    const parsed = JSON.parse(raw) as CustomLayoutDesign;
    if (!parsed || !Array.isArray(parsed.boxes) || parsed.boxes.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingCustomLayout(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Ignore storage errors.
  }
}
