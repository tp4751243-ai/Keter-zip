/**
 * Keter Typesetter — Title Page (Shaar Blat) border & layout engine
 * (v0.5.0 — Title Page builder)
 *
 * Original offline code. Two jobs:
 *
 * 1. Stock title-page borders. Seven original vector styles, drawn by the
 *    engine from primitive commands (rect / line / path) in a normalized
 *    0..1000 x 0..1000 space, so the SAME geometry renders in the preview
 *    (SVG), the PDF (jsPDF vector + canvas fallback) and — via the shared
 *    field layout — the IDML text flow. The styles follow the *spirit* of
 *    the user's reference title pages (plain centred title, double-line
 *    frame, corner flourishes, stepped frame, patterned band, ornate
 *    scrollwork). The reference photos are scans of published books and
 *    are style reference only: nothing is copied, traced or embedded —
 *    every path below is drawn from scratch.
 *
 * 2. Shared vertical layout of the title-page fields (title, subtitle,
 *    author, translator, volume, year, extra lines, publisher pinned near
 *    the bottom). One helper (`layoutTitlePageFields`) so the preview, the
 *    PDF renderer and the IDML exporter place the same text at the same
 *    heights.
 *
 * Border geometry never contains user text, so it is safe to serialize as
 * SVG markup for the preview.
 */

import type {
  ProfessionalDesignSettings,
  TitlePageBorderSettings,
  TitlePageBorderStyleId,
  TitlePageCustomBorderImage,
  TitlePageFieldStyle,
  TitlePageSettings,
} from '../types/design-settings';
import type { ContentUnit } from '../types/typesetter';
import { DEFAULT_TITLE_PAGE_SETTINGS } from '../types/design-settings';

/** One border drawing primitive, in normalized 0..1000 x 0..1000 space
 *  (x scaled by pageWidth/1000, y by pageHeight/1000 at render time). */
export type TitlePageBorderCommand =
  | { type: 'rect'; x: number; y: number; w: number; h: number; lineWidth: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; lineWidth: number }
  | { type: 'path'; d: string; lineWidth: number; filled?: boolean };

export interface TitlePageBorderStyleDef {
  id: TitlePageBorderStyleId;
  nameHe: string;
  nameEn: string;
  /** One plain sentence, for the picker. */
  descriptionHe: string;
  descriptionEn: string;
}

export const TITLE_PAGE_BORDER_STYLES: TitlePageBorderStyleDef[] = [
  { id: 'none', nameHe: 'בלי מסגרת', nameEn: 'No border', descriptionHe: 'עמוד שער נקי, בלי מסגרת.', descriptionEn: 'A clean title page with no frame.' },
  { id: 'single', nameHe: 'מסגרת דקה', nameEn: 'Single frame', descriptionHe: 'קו אחד דק סביב העמוד.', descriptionEn: 'One thin rule around the page.' },
  { id: 'double', nameHe: 'מסגרת כפולה', nameEn: 'Double frame', descriptionHe: 'שני קווים דקים — המראה הקלאסי של שערי ספרים.', descriptionEn: 'Two thin rules — the classic sefer title-page look.' },
  { id: 'corner', nameHe: 'מסגרת עם פינות מעוטרות', nameEn: 'Corner flourishes', descriptionHe: 'מסגרת כפולה עם עיטור מעוגל בכל פינה.', descriptionEn: 'A double frame with a small scroll at each corner.' },
  { id: 'stepped', nameHe: 'מסגרת מדורגת', nameEn: 'Stepped frame', descriptionHe: 'מסגרת קלאסית עם פינות חתוכות במדרגות.', descriptionEn: 'A classical frame with stepped, notched corners.' },
  { id: 'patterned', nameHe: 'מסגרת בדוגמה חוזרת', nameEn: 'Patterned band', descriptionHe: 'רצועה עם מעוינים חוזרים לאורך כל הצלעות.', descriptionEn: 'A band of repeating diamonds along all four sides.' },
  { id: 'ornate', nameHe: 'מסגרת מעוטרת', nameEn: 'Ornate frame', descriptionHe: 'מסגרת כפולה עם עיטורי סלסולים בפינות ומדליונים באמצע הצלעות.', descriptionEn: 'A double frame with corner scrollwork and medallions mid-edge.' },
  { id: 'chamfer_knot', nameHe: 'פאנל קטום וקשרים', nameEn: 'Chamfered Knot', descriptionHe: 'מסגרת כפולה עם פינות קטומות וקשרי פינה קלאסיים.', descriptionEn: 'Double frame with chamfered corners and classical corner knots.' },
  { id: 'dark_mosaic', nameHe: 'פסיפס כהה', nameEn: 'Dark Mosaic', descriptionHe: 'מסגרת מדליונים ומרובעים ממולאים לאורך הגבול בסגנון מסורתי.', descriptionEn: 'Traditional filled lozenge and square mosaic border band.' },
  { id: 'floral_panel', nameHe: 'עלי כתר ופאנל', nameEn: 'Floral Panel', descriptionHe: 'לוחות פינה קשתיים ועלי סלסול מעודנים משני הצדדים.', descriptionEn: 'Arched corner panels with symmetrical botanical scrollwork.' },
  { id: 'bevel_molded', nameHe: 'מסגרת משופעת', nameEn: 'Bevel Molded', descriptionHe: 'מסגרת תלת-ממדית משופעת עם הצללת קווים אלכסונית בפינות.', descriptionEn: 'Architectural beveled frame with mitered corner joints.' },
  { id: 'rosette_band', nameHe: 'שושנות ורצף', nameEn: 'Rosette Band', descriptionHe: 'רצועת פרחי שושנה ועיטורים חוזרים בין שני קווי גבול.', descriptionEn: 'Repeating floral rosette medallions between twin rules.' },
  { id: 'palmette_frieze', nameHe: 'אפריז עלי תמר', nameEn: 'Palmette Frieze', descriptionHe: 'רצועת פיתוחים גלים ועלי תמר בפינות ובאמצע הצלעות.', descriptionEn: 'Alternating wave frieze and classical palmette finials.' },
];

export function isTitlePageBorderStyleId(v: string): v is TitlePageBorderStyleId {
  return TITLE_PAGE_BORDER_STYLES.some(s => s.id === v) || isTitlePageTemplateBorderStyleId(v);
}

/**
 * v0.9.9 — border ids introduced by the title-page preset collection
 * (`title-page-templates.ts`). They are ORIGINAL Keter vector geometry
 * (see the `buildTitlePageBorderCommands` cases below), drawn from the
 * layout patterns of the v0.9.9 reference title pages — never copied or
 * traced from the reference scans.
 *
 * These ids ARE in the `TitlePageBorderStyleId` union
 * (`src/types/design-settings.ts`, added by the v0.9.9 consolidation) and
 * ARE whitelisted by `isTitlePageBorderStyleId` above, so storing one in
 * `titlePage.border.styleId` survives `syncDerivedViews`. Templates still
 * keep their border id in the template state as well (`templateId` on the
 * settings object — see `title-page-templates.ts`) and the panel stores
 * the closest existing style in `border.styleId` as the PDF fallback
 * (`pdfFallbackStyleId` below), so the PDF renders a near neighbour if
 * the template state is ever missing. The overlay (preview) always
 * resolves the template's own border id.
 */
export type TitlePageTemplateBorderStyleId =
  | 'floral_double'
  | 'wide_pattern_band'
  | 'baroque_scroll'
  | 'ring_band'
  | 'double_corner_marks';

/** Any border id the engine can draw: a stock id or a template id. */
export type TitlePageBorderStyleIdExt =
  | TitlePageBorderStyleId
  | TitlePageTemplateBorderStyleId;

export interface TitlePageTemplateBorderStyleDef {
  id: TitlePageTemplateBorderStyleId;
  nameHe: string;
  nameEn: string;
  descriptionHe: string;
  descriptionEn: string;
  /** Closest existing stock style, rendered by the PDF as a near
   *  neighbour if the template state is ever missing. */
  pdfFallbackStyleId: TitlePageBorderStyleId;
}

/** The five template-only frames. NOT listed in the generic border
 *  picker (`TitlePagePanel` maps over `TITLE_PAGE_BORDER_STYLES` only):
 *  they are chosen through the template picker, which is the only place
 *  that knows their PDF fallback. */
export const TITLE_PAGE_TEMPLATE_BORDER_STYLES: TitlePageTemplateBorderStyleDef[] = [
  { id: 'floral_double', nameHe: 'מסגרת פרחונית כפולה', nameEn: 'Floral double frame', descriptionHe: 'מסגרת כפולה עם עלים חוזרים ברצועה וסלסולים בפינות.', descriptionEn: 'A double frame with repeating leaves in the band and corner scrolls.', pdfFallbackStyleId: 'floral_panel' },
  { id: 'wide_pattern_band', nameHe: 'רצועה רחבה בדוגמה', nameEn: 'Wide patterned band', descriptionHe: 'רצועה רחבה עם דוגמת שתי וערב ומעוינים, וקו פנימי דק.', descriptionEn: 'A wide band with a woven cross-and-diamond motif and a thin inner rule.', pdfFallbackStyleId: 'dark_mosaic' },
  { id: 'baroque_scroll', nameHe: 'מסגרת סלסולים בארוקית', nameEn: 'Baroque scroll frame', descriptionHe: 'קו דק עם סלסולים גדולים בפינות ומדליונים באמצע הצלעות.', descriptionEn: 'A thin outline with large corner scrolls and medallions mid-edge.', pdfFallbackStyleId: 'ornate' },
  { id: 'ring_band', nameHe: 'רצועת טבעות גיאומטרית', nameEn: 'Geometric ring band', descriptionHe: 'רצועה עבה של טבעות חוזרות עם קו פנימי דק — מראה נועז ומודרני.', descriptionEn: 'A bold band of repeating rings with a thin inner rule — a bold, modern look.', pdfFallbackStyleId: 'rosette_band' },
  { id: 'double_corner_marks', nameHe: 'מסגרת כפולה עם סימני פינה', nameEn: 'Double frame, corner marks', descriptionHe: 'מסגרת כפולה דקה עם ריבועים קטנים בפינות ובאמצע הצלעות.', descriptionEn: 'A thin double rule with small square marks at the corners and mid-edges.', pdfFallbackStyleId: 'double' },
];

export function isTitlePageTemplateBorderStyleId(v: string): v is TitlePageTemplateBorderStyleId {
  return TITLE_PAGE_TEMPLATE_BORDER_STYLES.some(s => s.id === v);
}

/** Maximum extra lines on a title page (keeps the page from overflowing). */
export const TITLE_PAGE_MAX_EXTRA_LINES = 6;

/** Largest border image (as a data URL) that is stored with the project.
 *  Larger images are kept for the session only, and the UI says so. */
export const TITLE_PAGE_MAX_STORED_BORDER_BYTES = 1_000_000;

/** Longest side, in pixels, a raster border image is downscaled to. */
const BORDER_IMAGE_MAX_DIM_PX = 1600;

const r2 = (n: number) => Math.round(n * 100) / 100;

function diamondPath(cx: number, cy: number, r: number): string {
  return `M ${r2(cx)} ${r2(cy - r)} L ${r2(cx + r)} ${r2(cy)} L ${r2(cx)} ${r2(cy + r)} L ${r2(cx - r)} ${r2(cy)} Z`;
}

/** A circle approximated by four cubic Bézier segments (no arc commands:
 *  `transformBorderCommands` only tokenizes M/L/H/V/Q/C pairs, so an `a`
 *  command would be mis-scaled when the frame is scaled or shifted). */
function circlePath(cx: number, cy: number, r: number): string {
  const k = r2(0.5523 * r);
  return [
    `M ${r2(cx - r)} ${r2(cy)}`,
    `C ${r2(cx - r)} ${r2(cy - k)} ${r2(cx - k)} ${r2(cy - r)} ${r2(cx)} ${r2(cy - r)}`,
    `C ${r2(cx + k)} ${r2(cy - r)} ${r2(cx + r)} ${r2(cy - k)} ${r2(cx + r)} ${r2(cy)}`,
    `C ${r2(cx + r)} ${r2(cy + k)} ${r2(cx + k)} ${r2(cy + r)} ${r2(cx)} ${r2(cy + r)}`,
    `C ${r2(cx - k)} ${r2(cy + r)} ${r2(cx - r)} ${r2(cy + k)} ${r2(cx - r)} ${r2(cy)}`,
    'Z',
  ].join(' ');
}

function squarePath(cx: number, cy: number, s: number): string {
  const h = s / 2;
  return `M ${r2(cx - h)} ${r2(cy - h)} H ${r2(cx + h)} V ${r2(cy + h)} H ${r2(cx - h)} Z`;
}

/** One small leaf: two quadratic curves meeting at the tips. `horizontal`
 *  lays it along x; vertical lays it along y. */
function leafPath(cx: number, cy: number, len: number, wid: number, horizontal = true): string {
  if (horizontal) {
    return `M ${r2(cx - len / 2)} ${r2(cy)} Q ${r2(cx)} ${r2(cy - wid)} ${r2(cx + len / 2)} ${r2(cy)} Q ${r2(cx)} ${r2(cy + wid)} ${r2(cx - len / 2)} ${r2(cy)} Z`;
  }
  return `M ${r2(cx)} ${r2(cy - len / 2)} Q ${r2(cx + wid)} ${r2(cy)} ${r2(cx)} ${r2(cy + len / 2)} Q ${r2(cx - wid)} ${r2(cy)} ${r2(cx)} ${r2(cy - len / 2)} Z`;
}

/**
 * Build the border commands for a style. `insetMm` is the physical
 * distance of the outer frame from the page edge; `thicknessPt` is the
 * stroke width in points; `pageWidthPt`/`pageHeightPt` convert the
 * physical inset into the normalized space.
 *
 * v0.6.0 Part C (§8): `geom` adds the border fit controls — `paddingMm`
 * moves the frame further in from the edge, `scalePct` scales the whole
 * frame around the page centre (50–150), and `offsetXMm`/`offsetYMm`
 * shift it (mm, −25..25). The scale/offset are applied as a post-pass
 * over every command (rects, lines and path data alike), so the stock
 * ornaments scale and move with the frame.
 */
export function buildTitlePageBorderCommands(
  styleId: TitlePageBorderStyleIdExt,
  insetMm: number,
  thicknessPt: number,
  pageWidthPt: number,
  pageHeightPt: number,
  geom?: {
    scalePct?: number;
    paddingMm?: number;
    offsetXMm?: number;
    offsetYMm?: number;
  }
): TitlePageBorderCommand[] {
  if (styleId === 'none') return [];
  const mmToPt = 72 / 25.4;
  const effInsetMm = Math.max(
    0,
    (insetMm || 0) + (geom?.paddingMm ?? 0)
  );
  const ix = (effInsetMm * mmToPt / pageWidthPt) * 1000;
  const iy = (effInsetMm * mmToPt / pageHeightPt) * 1000;
  const lw = Math.max(0.4, thicknessPt);
  const gap = 14; // gap between the two rules of a double frame
  const ox = ix;
  const oy = iy;
  const ow = 1000 - 2 * ix;
  const oh = 1000 - 2 * iy;
  const ix2 = ix + gap;
  const iy2 = iy + gap;
  const iw = 1000 - 2 * ix2;
  const ih = 1000 - 2 * iy2;
  const cmds: TitlePageBorderCommand[] = [];
  const rect = (x: number, y: number, w: number, h: number): TitlePageBorderCommand =>
    ({ type: 'rect', x: r2(x), y: r2(y), w: r2(w), h: r2(h), lineWidth: lw });
  const path = (d: string, filled = false): TitlePageBorderCommand =>
    ({ type: 'path', d, lineWidth: lw, filled });

  switch (styleId) {
    case 'single':
      cmds.push(rect(ox, oy, ow, oh));
      break;
    case 'double':
      cmds.push(rect(ox, oy, ow, oh), rect(ix2, iy2, iw, ih));
      break;
    case 'corner': {
      cmds.push(rect(ox, oy, ow, oh), rect(ix2, iy2, iw, ih));
      // One small scroll at each corner: two concentric quarter-curves
      // plus a diamond on the inner frame's corner. (sx, sy) mirror it.
      const corners: Array<[number, number, number, number]> = [
        [ix, iy, 1, 1],
        [1000 - ix, iy, -1, 1],
        [ix, 1000 - iy, 1, -1],
        [1000 - ix, 1000 - iy, -1, -1],
      ];
      for (const [cx, cy, sx, sy] of corners) {
        cmds.push(path(
          `M ${r2(cx + sx * 46)} ${r2(cy)} Q ${r2(cx)} ${r2(cy)} ${r2(cx)} ${r2(cy + sy * 46)}`
        ));
        cmds.push(path(
          `M ${r2(cx + sx * 30)} ${r2(cy + sy * 9)} Q ${r2(cx + sx * 9)} ${r2(cy + sy * 9)} ${r2(cx + sx * 9)} ${r2(cy + sy * 30)}`
        ));
        cmds.push(path(diamondPath(cx + sx * gap, cy + sy * gap, 7), true));
      }
      break;
    }
    case 'stepped': {
      // Classical stepped frame: the outer frame's corners are cut in
      // three small steps; an inner plain rect completes it.
      const s1 = 30;
      const s2 = 15;
      const d = [
        `M ${r2(ix + s1)} ${r2(iy)}`,
        `H ${r2(1000 - ix - s1)}`,
        `L ${r2(1000 - ix - s1)} ${r2(iy + s2)}`,
        `L ${r2(1000 - ix - s2)} ${r2(iy + s2)}`,
        `L ${r2(1000 - ix - s2)} ${r2(iy + s1)}`,
        `L ${r2(1000 - ix)} ${r2(iy + s1)}`,
        `V ${r2(1000 - iy - s1)}`,
        `L ${r2(1000 - ix - s2)} ${r2(1000 - iy - s1)}`,
        `L ${r2(1000 - ix - s2)} ${r2(1000 - iy - s2)}`,
        `L ${r2(1000 - ix - s1)} ${r2(1000 - iy - s2)}`,
        `L ${r2(1000 - ix - s1)} ${r2(1000 - iy)}`,
        `H ${r2(ix + s1)}`,
        `L ${r2(ix + s1)} ${r2(1000 - iy - s2)}`,
        `L ${r2(ix + s2)} ${r2(1000 - iy - s2)}`,
        `L ${r2(ix + s2)} ${r2(1000 - iy - s1)}`,
        `L ${r2(ix)} ${r2(1000 - iy - s1)}`,
        `V ${r2(iy + s1)}`,
        `L ${r2(ix + s2)} ${r2(iy + s1)}`,
        `L ${r2(ix + s2)} ${r2(iy + s2)}`,
        `L ${r2(ix + s1)} ${r2(iy + s2)}`,
        `L ${r2(ix + s1)} ${r2(iy)}`,
        'Z',
      ].join(' ');
      cmds.push(path(d), rect(ix2, iy2, iw, ih));
      break;
    }
    case 'patterned': {
      cmds.push(rect(ox, oy, ow, oh), rect(ix2, iy2, iw, ih));
      // A chain of small diamonds along the band between the two rules,
      // spaced evenly along all four edges.
      const bandC = ix + gap / 2;
      const spacing = 38;
      const diamondR = 8;
      const topY = iy + gap / 2;
      const bottomY = 1000 - iy - gap / 2;
      const leftX = ix + gap / 2;
      const rightX = 1000 - ix - gap / 2;
      for (let x = ix + spacing; x < 1000 - ix - spacing / 2; x += spacing) {
        cmds.push(path(diamondPath(x, topY, diamondR), true));
        cmds.push(path(diamondPath(x, bottomY, diamondR), true));
      }
      for (let y = iy + spacing; y < 1000 - iy - spacing / 2; y += spacing) {
        cmds.push(path(diamondPath(leftX, y, diamondR), true));
        cmds.push(path(diamondPath(rightX, y, diamondR), true));
      }
      void bandC;
      break;
    }
    case 'ornate': {
      cmds.push(rect(ox, oy, ow, oh), rect(ix2, iy2, iw, ih));
      // Corner scrollwork: two curling cubic strokes per corner, mirrored.
      const corners: Array<[number, number, number, number]> = [
        [ix, iy, 1, 1],
        [1000 - ix, iy, -1, 1],
        [ix, 1000 - iy, 1, -1],
        [1000 - ix, 1000 - iy, -1, -1],
      ];
      for (const [cx, cy, sx, sy] of corners) {
        cmds.push(path(
          `M ${r2(cx + sx * 78)} ${r2(cy)} ` +
          `C ${r2(cx + sx * 34)} ${r2(cy)} ${r2(cx + sx * 12)} ${r2(cy + sy * 22)} ${r2(cx + sx * 12)} ${r2(cy + sy * 58)} ` +
          `C ${r2(cx + sx * 12)} ${r2(cy + sy * 84)} ${r2(cx + sx * 32)} ${r2(cy + sy * 94)} ${r2(cx + sx * 50)} ${r2(cy + sy * 80)}`
        ));
        cmds.push(path(
          `M ${r2(cx + sx * 52)} ${r2(cy + sy * 10)} ` +
          `C ${r2(cx + sx * 26)} ${r2(cy + sy * 10)} ${r2(cx + sx * 20)} ${r2(cy + sy * 30)} ${r2(cx + sx * 20)} ${r2(cy + sy * 44)}`
        ));
        cmds.push(path(diamondPath(cx + sx * gap, cy + sy * gap, 8), true));
      }
      // Medallions at the middle of each edge: a diamond on the inner
      // frame with a smaller diamond inside it.
      const mid: Array<[number, number]> = [
        [500, iy2], [500, 1000 - iy2], [ix2, 500], [1000 - ix2, 500],
      ];
      for (const [mx, my] of mid) {
        cmds.push(path(diamondPath(mx, my, 13), true));
        cmds.push(path(diamondPath(mx, my, 6)));
      }
      break;
    }
    case 'chamfer_knot': {
      const ch = 44;
      const chamferOuter = [
        `M ${r2(ix + ch)} ${r2(iy)} H ${r2(1000 - ix - ch)}`,
        `L ${r2(1000 - ix)} ${r2(iy + ch)} V ${r2(1000 - iy - ch)}`,
        `L ${r2(1000 - ix - ch)} ${r2(1000 - iy)} H ${r2(ix + ch)}`,
        `L ${r2(ix)} ${r2(1000 - iy - ch)} V ${r2(iy + ch)} Z`,
      ].join(' ');
      const ch2 = 34;
      const chamferInner = [
        `M ${r2(ix2 + ch2)} ${r2(iy2)} H ${r2(1000 - ix2 - ch2)}`,
        `L ${r2(1000 - ix2)} ${r2(iy2 + ch2)} V ${r2(1000 - iy2 - ch2)}`,
        `L ${r2(1000 - ix2 - ch2)} ${r2(1000 - iy2)} H ${r2(ix2 + ch2)}`,
        `L ${r2(ix2)} ${r2(1000 - iy2 - ch2)} V ${r2(iy2 + ch2)} Z`,
      ].join(' ');
      cmds.push(path(chamferOuter), path(chamferInner));
      const knots: Array<[number, number, number, number]> = [
        [ix + 24, iy + 24, 1, 1],
        [1000 - ix - 24, iy + 24, -1, 1],
        [ix + 24, 1000 - iy - 24, 1, -1],
        [1000 - ix - 24, 1000 - iy - 24, -1, -1],
      ];
      for (const [kx, ky, sx, sy] of knots) {
        cmds.push(path(diamondPath(kx + sx * 6, ky + sy * 6, 9), false));
        cmds.push(path(diamondPath(kx + sx * 6, ky + sy * 6, 4), true));
      }
      break;
    }
    case 'dark_mosaic': {
      const band = 22;
      cmds.push(rect(ox, oy, ow, oh));
      cmds.push(rect(ox + band, oy + band, ow - 2 * band, oh - 2 * band));
      const topMidY = oy + band / 2;
      const botMidY = 1000 - oy - band / 2;
      const leftMidX = ox + band / 2;
      const rightMidX = 1000 - ox - band / 2;
      const step = 30;
      for (let x = ox + band + 10; x < 1000 - ox - band - 5; x += step) {
        cmds.push(path(diamondPath(x, topMidY, 7), true));
        cmds.push(path(diamondPath(x, botMidY, 7), true));
      }
      for (let y = oy + band + 10; y < 1000 - oy - band - 5; y += step) {
        cmds.push(path(diamondPath(leftMidX, y, 7), true));
        cmds.push(path(diamondPath(rightMidX, y, 7), true));
      }
      for (const [cx, cy] of [
        [leftMidX, topMidY],
        [rightMidX, topMidY],
        [leftMidX, botMidY],
        [rightMidX, botMidY],
      ]) {
        cmds.push(path(diamondPath(cx, cy, 10), true));
      }
      break;
    }
    case 'floral_panel': {
      cmds.push(rect(ox, oy, ow, oh), rect(ix2 + 8, iy2 + 8, iw - 16, ih - 16));
      const corners: Array<[number, number, number, number]> = [
        [ox, oy, 1, 1],
        [1000 - ox, oy, -1, 1],
        [ox, 1000 - oy, 1, -1],
        [1000 - ox, 1000 - oy, -1, -1],
      ];
      for (const [cx, cy, sx, sy] of corners) {
        cmds.push(path(
          `M ${r2(cx + sx * 68)} ${r2(cy + sy * 6)} ` +
          `C ${r2(cx + sx * 42)} ${r2(cy + sy * 28)} ${r2(cx + sx * 28)} ${r2(cy + sy * 42)} ${r2(cx + sx * 6)} ${r2(cy + sy * 68)}`
        ));
        cmds.push(path(
          `M ${r2(cx + sx * 48)} ${r2(cy + sy * 14)} ` +
          `Q ${r2(cx + sx * 16)} ${r2(cy + sy * 16)} ${r2(cx + sx * 14)} ${r2(cy + sy * 48)}`
        ));
        cmds.push(path(diamondPath(cx + sx * 22, cy + sy * 22, 6), true));
      }
      // Top & bottom center crown arches
      cmds.push(path(`M 445 ${r2(oy)} Q 500 ${r2(oy - 14)} 555 ${r2(oy)}`));
      cmds.push(path(`M 445 ${r2(1000 - oy)} Q 500 ${r2(1000 - oy + 14)} 555 ${r2(1000 - oy)}`));
      break;
    }
    case 'bevel_molded': {
      const m1 = 8;
      const m2 = 22;
      cmds.push(rect(ox, oy, ow, oh));
      cmds.push(rect(ox + m1, oy + m1, ow - 2 * m1, oh - 2 * m1));
      cmds.push(rect(ox + m2, oy + m2, ow - 2 * m2, oh - 2 * m2));
      // Miter diagonal corner joints
      cmds.push(
        { type: 'line', x1: r2(ox), y1: r2(oy), x2: r2(ox + m2), y2: r2(oy + m2), lineWidth: lw },
        { type: 'line', x1: r2(1000 - ox), y1: r2(oy), x2: r2(1000 - ox - m2), y2: r2(oy + m2), lineWidth: lw },
        { type: 'line', x1: r2(ox), y1: r2(1000 - oy), x2: r2(ox + m2), y2: r2(1000 - oy - m2), lineWidth: lw },
        { type: 'line', x1: r2(1000 - ox), y1: r2(1000 - oy), x2: r2(1000 - ox - m2), y2: r2(1000 - oy - m2), lineWidth: lw }
      );
      break;
    }
    case 'rosette_band': {
      const band = 24;
      cmds.push(rect(ox, oy, ow, oh), rect(ox + band, oy + band, ow - 2 * band, oh - 2 * band));
      const rosette = (rx: number, ry: number, r: number) => {
        cmds.push(path(diamondPath(rx, ry, r), false));
        cmds.push(path(
          `M ${r2(rx - r * 0.7)} ${r2(ry - r * 0.7)} L ${r2(rx + r * 0.7)} ${r2(ry - r * 0.7)} ` +
          `L ${r2(rx + r * 0.7)} ${r2(ry + r * 0.7)} L ${r2(rx - r * 0.7)} ${r2(ry + r * 0.7)} Z`,
          false
        ));
        cmds.push(path(diamondPath(rx, ry, r * 0.35), true));
      };
      const topY = oy + band / 2;
      const botY = 1000 - oy - band / 2;
      const leftX = ox + band / 2;
      const rightX = 1000 - ox - band / 2;
      for (let x = ox + band + 22; x < 1000 - ox - band - 12; x += 44) {
        rosette(x, topY, 8);
        rosette(x, botY, 8);
      }
      for (let y = oy + band + 22; y < 1000 - oy - band - 12; y += 44) {
        rosette(leftX, y, 8);
        rosette(rightX, y, 8);
      }
      break;
    }
    case 'palmette_frieze': {
      const band = 20;
      cmds.push(rect(ox, oy, ow, oh), rect(ox + band, oy + band, ow - 2 * band, oh - 2 * band));
      // Wave scroll along top & bottom
      const topY = oy + band / 2;
      const botY = 1000 - oy - band / 2;
      let dTop = `M ${r2(ox + band)} ${r2(topY)}`;
      let dBot = `M ${r2(ox + band)} ${r2(botY)}`;
      let up = -1;
      for (let x = ox + band + 24; x <= 1000 - ox - band; x += 24) {
        dTop += ` Q ${r2(x - 12)} ${r2(topY + up * 9)} ${r2(x)} ${r2(topY)}`;
        dBot += ` Q ${r2(x - 12)} ${r2(botY + up * 9)} ${r2(x)} ${r2(botY)}`;
        up *= -1;
      }
      cmds.push(path(dTop), path(dBot));
      // Palmette finials mid-top and mid-bottom
      cmds.push(path(diamondPath(500, oy + band, 10), true));
      cmds.push(path(diamondPath(500, 1000 - oy - band, 10), true));
      break;
    }
    case 'floral_double': {
      // v0.9.9 template 1 — ornate floral double-frame: two thin rules
      // with a chain of small original leaves in the band between them
      // and a curling scroll at each corner.
      cmds.push(rect(ox, oy, ow, oh), rect(ix2, iy2, iw, ih));
      const bandY = iy + gap / 2;
      const bandYB = 1000 - iy - gap / 2;
      const bandX = ix + gap / 2;
      const bandXR = 1000 - ix - gap / 2;
      for (let x = ix + 34; x < 1000 - ix - 20; x += 46) {
        cmds.push(path(leafPath(x, bandY, 20, 6, true), true));
        cmds.push(path(leafPath(x, bandYB, 20, 6, true), true));
      }
      for (let y = iy + 34; y < 1000 - iy - 20; y += 46) {
        cmds.push(path(leafPath(bandX, y, 20, 6, false), true));
        cmds.push(path(leafPath(bandXR, y, 20, 6, false), true));
      }
      const corners: Array<[number, number, number, number]> = [
        [ix, iy, 1, 1],
        [1000 - ix, iy, -1, 1],
        [ix, 1000 - iy, 1, -1],
        [1000 - ix, 1000 - iy, -1, -1],
      ];
      for (const [cx, cy, sx, sy] of corners) {
        cmds.push(path(
          `M ${r2(cx + sx * 58)} ${r2(cy)} ` +
          `C ${r2(cx + sx * 26)} ${r2(cy)} ${r2(cx + sx * 10)} ${r2(cy + sy * 18)} ${r2(cx + sx * 10)} ${r2(cy + sy * 46)} ` +
          `C ${r2(cx + sx * 10)} ${r2(cy + sy * 64)} ${r2(cx + sx * 24)} ${r2(cy + sy * 72)} ${r2(cx + sx * 38)} ${r2(cy + sy * 62)}`
        ));
        cmds.push(path(diamondPath(cx + sx * gap, cy + sy * gap, 7), true));
      }
      break;
    }
    case 'wide_pattern_band': {
      // v0.9.9 template 2 — wide patterned band: a broad band (34 units)
      // with a woven cross-and-diamond motif repeated along all four
      // sides, closed by a thin inner rule.
      const band = 34;
      cmds.push(rect(ox, oy, ow, oh), rect(ox + band, oy + band, ow - 2 * band, oh - 2 * band));
      const crossCell = (ccx: number, ccy: number) => {
        const a = 8;
        cmds.push(path(
          `M ${r2(ccx - a)} ${r2(ccy - a)} L ${r2(ccx + a)} ${r2(ccy + a)} ` +
          `M ${r2(ccx - a)} ${r2(ccy + a)} L ${r2(ccx + a)} ${r2(ccy - a)}`
        ));
        cmds.push(path(diamondPath(ccx, ccy, 3.5), true));
      };
      const midY = oy + band / 2;
      const midYB = 1000 - oy - band / 2;
      const midX = ox + band / 2;
      const midXR = 1000 - ox - band / 2;
      for (let x = ox + band + 16; x < 1000 - ox - band - 8; x += 30) {
        crossCell(x, midY);
        crossCell(x, midYB);
      }
      for (let y = oy + band + 16; y < 1000 - oy - band - 8; y += 30) {
        crossCell(midX, y);
        crossCell(midXR, y);
      }
      break;
    }
    case 'baroque_scroll': {
      // v0.9.9 template 3 — Baroque scroll frame: one thin outline with
      // large curling scrolls at the corners and a small scroll medallion
      // at the centre of the top and bottom edges; mostly white inside.
      cmds.push(rect(ox, oy, ow, oh));
      const corners: Array<[number, number, number, number]> = [
        [ix, iy, 1, 1],
        [1000 - ix, iy, -1, 1],
        [ix, 1000 - iy, 1, -1],
        [1000 - ix, 1000 - iy, -1, -1],
      ];
      for (const [cx, cy, sx, sy] of corners) {
        cmds.push(path(
          `M ${r2(cx + sx * 96)} ${r2(cy)} ` +
          `C ${r2(cx + sx * 40)} ${r2(cy)} ${r2(cx + sx * 14)} ${r2(cy + sy * 26)} ${r2(cx + sx * 14)} ${r2(cy + sy * 70)} ` +
          `C ${r2(cx + sx * 14)} ${r2(cy + sy * 102)} ${r2(cx + sx * 40)} ${r2(cy + sy * 116)} ${r2(cx + sx * 62)} ${r2(cy + sy * 98)}`
        ));
        cmds.push(path(
          `M ${r2(cx + sx * 66)} ${r2(cy + sy * 12)} ` +
          `C ${r2(cx + sx * 32)} ${r2(cy + sy * 12)} ${r2(cx + sx * 24)} ${r2(cy + sy * 38)} ${r2(cx + sx * 24)} ${r2(cy + sy * 56)}`
        ));
        cmds.push(path(circlePath(cx + sx * 40, cy + sy * 40, 5)));
      }
      // Centre-edge medallions: a diamond flanked by two small curls.
      for (const [mx, my, horizontal] of [[500, iy, true], [500, 1000 - iy, true]] as Array<[number, number, boolean]>) {
        void horizontal;
        cmds.push(path(diamondPath(mx, my, 9), true));
        cmds.push(path(`M ${r2(mx - 34)} ${r2(my)} Q ${r2(mx - 14)} ${r2(my - 10)} ${r2(mx - 10)} ${r2(my)}`));
        cmds.push(path(`M ${r2(mx + 10)} ${r2(my)} Q ${r2(mx + 14)} ${r2(my + 10)} ${r2(mx + 34)} ${r2(my)}`));
      }
      for (const [mx, my] of [[ix, 500], [1000 - ix, 500]] as Array<[number, number]>) {
        cmds.push(path(diamondPath(mx, my, 9), true));
      }
      break;
    }
    case 'ring_band': {
      // v0.9.9 template 6 — bold geometric ring band: a thick border built
      // from a repeating ring (circle) motif with a thin inner rule.
      const band = 26;
      cmds.push(rect(ox, oy, ow, oh), rect(ox + band, oy + band, ow - 2 * band, oh - 2 * band));
      const midY = oy + band / 2;
      const midYB = 1000 - oy - band / 2;
      const midX = ox + band / 2;
      const midXR = 1000 - ox - band / 2;
      for (let x = ox + band + 8; x < 1000 - ox - band; x += 30) {
        cmds.push(path(circlePath(x, midY, 8)));
        cmds.push(path(circlePath(x, midYB, 8)));
      }
      for (let y = oy + band + 8; y < 1000 - oy - band; y += 30) {
        cmds.push(path(circlePath(midX, y, 8)));
        cmds.push(path(circlePath(midXR, y, 8)));
      }
      // Larger corner rings where the band turns.
      for (const [ccx, ccy] of [[midX, midY], [midXR, midY], [midX, midYB], [midXR, midYB]] as Array<[number, number]>) {
        cmds.push(path(circlePath(ccx, ccy, 11)));
        cmds.push(path(diamondPath(ccx, ccy, 3.5), true));
      }
      break;
    }
    case 'double_corner_marks': {
      // v0.9.9 template 8 — thin double rule with small square marks at
      // the four corners and at the middle of each edge.
      cmds.push(rect(ox, oy, ow, oh), rect(ix2, iy2, iw, ih));
      const s = 7;
      for (const [mx, my] of [
        [ix, iy], [1000 - ix, iy], [ix, 1000 - iy], [1000 - ix, 1000 - iy],
        [500, iy], [500, 1000 - iy], [ix, 500], [1000 - ix, 500],
      ] as Array<[number, number]>) {
        cmds.push(path(squarePath(mx, my, s), true));
      }
      break;
    }
    default:
      cmds.push(rect(ox, oy, ow, oh));
      break;
  }
  // v0.6.0 Part C (§8): scale the whole frame around the page centre and
  // shift it, when the user asked for it (100% / 0mm = identity).
  const scale = Math.max(0.5, Math.min(1.5, (geom?.scalePct ?? 100) / 100));
  const offXN = (((geom?.offsetXMm ?? 0) * mmToPt) / pageWidthPt) * 1000;
  const offYN = (((geom?.offsetYMm ?? 0) * mmToPt) / pageHeightPt) * 1000;
  if (scale !== 1 || offXN !== 0 || offYN !== 0) {
    return transformBorderCommands(cmds, scale, offXN, offYN);
  }
  return cmds;
}

/**
 * Scale every border command around the page centre (500, 500 in
 * normalized space) and shift it. Path data is tokenized command by
 * command (M/L pairs, H x-only, V y-only, Q/C pairs, Z none) — the
 * engine only ever emits absolute commands, so this is exact.
 */
export function transformBorderCommands(
  commands: TitlePageBorderCommand[],
  scale: number,
  offsetXNorm: number,
  offsetYNorm: number
): TitlePageBorderCommand[] {
  const tx = (x: number) => r2(500 + (x - 500) * scale + offsetXNorm);
  const ty = (y: number) => r2(500 + (y - 500) * scale + offsetYNorm);
  const transformPath = (d: string): string => {
    const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
    const out: string[] = [];
    let cmd = '';
    let i = 0;
    const takeNumber = (): number => {
      const tok = tokens[i++];
      return Number(tok);
    };
    while (i < tokens.length) {
      const tok = tokens[i];
      if (/[A-Za-z]/.test(tok)) {
        cmd = tok;
        out.push(tok);
        i++;
        continue;
      }
      if (cmd === 'H') {
        out.push(String(tx(takeNumber())));
      } else if (cmd === 'V') {
        out.push(String(ty(takeNumber())));
      } else if (cmd === 'Z' || cmd === 'z') {
        i++;
      } else {
        // M / L / Q / C (and repeats): x,y pairs.
        out.push(String(tx(takeNumber())));
        if (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
          out.push(String(ty(takeNumber())));
        }
      }
    }
    return out.join(' ');
  };
  return commands.map(c => {
    if (c.type === 'rect') {
      const x2 = tx(c.x);
      const y2 = ty(c.y);
      return {
        ...c,
        x: x2,
        y: y2,
        w: r2(c.w * scale),
        h: r2(c.h * scale),
      };
    }
    if (c.type === 'line') {
      return { ...c, x1: tx(c.x1), y1: ty(c.y1), x2: tx(c.x2), y2: ty(c.y2) };
    }
    return { ...c, d: transformPath(c.d) };
  });
}

/**
 * v0.6.0 Part C (§8): where a custom border IMAGE sits on the page, in
 * points — the inset (+ padding) rect, scaled around the page centre and
 * shifted, exactly like the stock frame. The preview overlay, the native
 * PDF and the canvas fallback all draw the image in this rect.
 */
export function titlePageBorderImageRect(
  border: TitlePageBorderSettings,
  pageWidthPt: number,
  pageHeightPt: number
): { x: number; y: number; w: number; h: number } {
  const mmToPt = 72 / 25.4;
  const insetPt = ((border.insetMm ?? 12) + (border.paddingMm ?? 0)) * mmToPt;
  const scale = Math.max(0.5, Math.min(1.5, (border.scalePct ?? 100) / 100));
  const x0 = insetPt + (border.offsetXMm ?? 0) * mmToPt;
  const y0 = insetPt + (border.offsetYMm ?? 0) * mmToPt;
  const w0 = pageWidthPt - 2 * insetPt;
  const h0 = pageHeightPt - 2 * insetPt;
  const cx = pageWidthPt / 2;
  const cy = pageHeightPt / 2;
  const w = w0 * scale;
  const h = h0 * scale;
  const x = cx + (x0 + w0 / 2 - cx) * scale - w / 2;
  const y = cy + (y0 + h0 / 2 - cy) * scale - h / 2;
  return { x, y, w, h };
}

/** Serialize border commands to SVG inner markup (own generated geometry
 *  only — no user text — so `dangerouslySetInnerHTML` is safe here).
 *  `strokeWidthNorm` is the stroke width in normalized units. */
export function borderCommandsToSvg(
  commands: TitlePageBorderCommand[],
  strokeColor: string,
  strokeWidthNorm: number
): string {
  return commands.map(cmd => {
    if (cmd.type === 'rect') {
      return `<rect x="${cmd.x}" y="${cmd.y}" width="${cmd.w}" height="${cmd.h}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidthNorm}" />`;
    }
    if (cmd.type === 'line') {
      return `<line x1="${cmd.x1}" y1="${cmd.y1}" x2="${cmd.x2}" y2="${cmd.y2}" stroke="${strokeColor}" stroke-width="${strokeWidthNorm}" />`;
    }
    if (cmd.filled) {
      return `<path d="${cmd.d}" fill="${strokeColor}" stroke="none" />`;
    }
    return `<path d="${cmd.d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidthNorm}" />`;
  }).join('');
}

/**
 * Draw border commands on a 2D canvas context. `pageWidthUnits` /
 * `pageHeightUnits` are the page size in the CURRENT user-space units
 * (points when the caller already scaled the context to pt, device px
 * when it did not); `scale` is the device-px-per-user-unit factor used
 * only for the line width. The transform composes with whatever the
 * context already has — callers must not pre-scale the commands.
 */
export function drawBorderCommandsOnCanvas(
  ctx: CanvasRenderingContext2D,
  commands: TitlePageBorderCommand[],
  pageWidthUnits: number,
  pageHeightUnits: number,
  strokeColor: string,
  thicknessPt: number,
  scale: number
): void {
  if (commands.length === 0) return;
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = strokeColor;
  ctx.scale(pageWidthUnits / 1000, pageHeightUnits / 1000);
  // Line width is in user-space units at stroke time (after the scale),
  // so divide by the vertical scale to land at thicknessPt * scale px.
  ctx.lineWidth = Math.max(0.5, (thicknessPt * scale) / (pageHeightUnits / 1000));
  for (const cmd of commands) {
    if (cmd.type === 'rect') {
      ctx.strokeRect(cmd.x, cmd.y, cmd.w, cmd.h);
    } else if (cmd.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.lineTo(cmd.x2, cmd.y2);
      ctx.stroke();
    } else if (cmd.filled) {
      ctx.fill(new Path2D(cmd.d));
    } else {
      ctx.stroke(new Path2D(cmd.d));
    }
  }
  ctx.restore();
}

// ── Shared field layout ───────────────────────────────────────────────────

export type TitlePageFieldId =
  | 'title' | 'subtitle' | 'author' | 'translator'
  | 'volume' | 'year' | 'publisher' | 'extra';

export interface TitlePageFieldRow {
  fieldId: TitlePageFieldId;
  /** Index within extraLines, when fieldId is 'extra'. */
  extraIndex?: number;
  text: string;
  fontFamily: string;
  fontSizePt: number;
  isBold: boolean;
  alignment: 'center' | 'right' | 'left';
  spaceAbovePt: number;
  spaceBelowPt: number;
  /** v0.6.0 Part C (§8): line height inside the field (default 1.2). */
  lineHeight: number;
  /** v0.6.0 Part C (§8): drag offset from the shared layout, in points. */
  xOffsetPt: number;
  yOffsetPt: number;
  /** Baseline position, in points from the top of the page. */
  yBaselinePt: number;
  colorHex: string;
}

const FIELD_COLORS: Record<TitlePageFieldId, string> = {
  title: '#121214',
  subtitle: '#2C2A29',
  author: '#6B5E4C',
  translator: '#6B5E4C',
  volume: '#2C2A29',
  year: '#6B5E4C',
  publisher: '#6B5E4C',
  extra: '#2C2A29',
};

/**
 * The one vertical layout every renderer shares: the upper fields stack
 * from a title anchor (30% of the page height) with each field's own
 * spacing, and the publisher is pinned near the bottom (84%) the way
 * printed title pages pin the imprint. Empty fields are skipped; the
 * title falls back to the book title when its own text is empty.
 */
export function layoutTitlePageFields(
  settings: TitlePageSettings,
  bookTitle: string,
  pageHeightPt: number
): TitlePageFieldRow[] {
  const rows: TitlePageFieldRow[] = [];
  const push = (
    fieldId: TitlePageFieldId,
    field: TitlePageFieldStyle,
    text: string,
    extraIndex?: number
  ) => {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return;
    rows.push({
      fieldId,
      extraIndex,
      text: trimmed,
      fontFamily: (field.fontFamily ?? '').trim(),
      fontSizePt: Math.max(6, Math.min(72, field.fontSizePt || 12)),
      isBold: fieldId === 'title',
      alignment: field.alignment || 'center',
      spaceAbovePt: Math.max(0, field.spaceAbovePt || 0),
      spaceBelowPt: Math.max(0, field.spaceBelowPt || 0),
      lineHeight: Math.max(1.0, Math.min(2.0, field.lineHeight ?? 1.2)),
      xOffsetPt: Math.max(-200, Math.min(200, field.xOffsetPt ?? 0)),
      yOffsetPt: Math.max(-200, Math.min(200, field.yOffsetPt ?? 0)),
      yBaselinePt: 0,
      colorHex: FIELD_COLORS[fieldId],
    });
  };

  push('title', settings.title, settings.title.text || bookTitle);
  push('subtitle', settings.subtitle, settings.subtitle.text);
  push('author', settings.author, settings.author.text);
  push('translator', settings.translator, settings.translator.text);
  push('volume', settings.volume, settings.volume.text);
  push('year', settings.year, settings.year.text);
  (settings.extraLines ?? []).slice(0, TITLE_PAGE_MAX_EXTRA_LINES).forEach((line, i) => {
    push('extra', line, line.text, i);
  });

  // Stack the upper fields from the title anchor. Each field's own line
  // height sets the advance (v0.6.0 §8), and a dragged field keeps its
  // own y offset on top of the stacked position.
  let y = pageHeightPt * 0.3;
  let prev: TitlePageFieldRow | null = null;
  for (const row of rows) {
    if (prev) {
      y += prev.fontSizePt * prev.lineHeight + prev.spaceBelowPt + row.spaceAbovePt;
    } else {
      y += row.spaceAbovePt;
    }
    row.yBaselinePt = y + row.yOffsetPt;
    prev = row;
  }

  // Publisher pinned near the bottom.
  const pubText = (settings.publisher.text ?? '').trim();
  if (pubText) {
    rows.push({
      fieldId: 'publisher',
      text: pubText,
      fontFamily: (settings.publisher.fontFamily ?? '').trim(),
      fontSizePt: Math.max(6, Math.min(72, settings.publisher.fontSizePt || 12)),
      isBold: false,
      alignment: settings.publisher.alignment || 'center',
      spaceAbovePt: 0,
      spaceBelowPt: 0,
      lineHeight: Math.max(1.0, Math.min(2.0, settings.publisher.lineHeight ?? 1.2)),
      xOffsetPt: Math.max(-200, Math.min(200, settings.publisher.xOffsetPt ?? 0)),
      yOffsetPt: Math.max(-200, Math.min(200, settings.publisher.yOffsetPt ?? 0)),
      yBaselinePt: pageHeightPt * 0.84 + (settings.publisher.yOffsetPt ?? 0),
      colorHex: FIELD_COLORS.publisher,
    });
  }
  return rows;
}

/** The effective border for a title page: the custom image (when set)
 *  replaces the stock border; otherwise the stock style applies. */
export function resolveTitlePageBorder(
  settings: TitlePageSettings
): { kind: 'image'; image: TitlePageCustomBorderImage } | { kind: 'stock'; border: TitlePageBorderSettings } {
  if (settings.customBorderImage) {
    return { kind: 'image', image: settings.customBorderImage };
  }
  return { kind: 'stock', border: settings.border };
}

// ── Custom border image import ────────────────────────────────────────────

/**
 * Read a user-supplied border image file and prepare it for storage with
 * the project. SVGs are kept as text (they are small). Raster images are
 * downscaled to at most 1600px on the longest side and stored as JPEG
 * (quality 0.85) so the project file stays small. When the resulting data
 * URL is still too large to store, the image is kept for the session only
 * (`persisted: false`) and the caller must say so plainly.
 */
export async function prepareBorderImageFile(
  file: File
): Promise<TitlePageCustomBorderImage & { noteHe: string; noteEn: string }> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) {
    const text = await file.text();
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    const persisted = dataUrl.length <= TITLE_PAGE_MAX_STORED_BORDER_BYTES;
    return {
      fileName: file.name,
      dataUrl,
      persisted,
      noteHe: persisted ? '' : 'התמונה גדולה מדי לשמירה בקובץ הפרויקט — היא תישמר רק להפעלה הנוכחית.',
      noteEn: persisted ? '' : 'The image is too large to store in the project file — it is kept for this session only.',
    };
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, BORDER_IMAGE_MAX_DIM_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const persisted = dataUrl.length <= TITLE_PAGE_MAX_STORED_BORDER_BYTES;
    return {
      fileName: file.name,
      dataUrl,
      persisted,
      noteHe: persisted
        ? ''
        : 'התמונה גדולה מדי לשמירה בקובץ הפרויקט — היא תישמר רק להפעלה הנוכחית.',
      noteEn: persisted
        ? ''
        : 'The image is too large to store in the project file — it is kept for this session only.',
    };
  } finally {
    bitmap.close();
  }
}

/** In-memory cache of loaded border images, for the synchronous canvas
 *  renderer: the first call triggers the load and returns null; later
 *  calls return the loaded element. */
const loadedBorderImages = new Map<string, HTMLImageElement | null>();

export function getLoadedBorderImage(dataUrl: string): HTMLImageElement | null {
  if (!loadedBorderImages.has(dataUrl)) {
    loadedBorderImages.set(dataUrl, null);
    const img = new Image();
    img.onload = () => { loadedBorderImages.set(dataUrl, img); };
    img.onerror = () => { loadedBorderImages.delete(dataUrl); };
    img.src = dataUrl;
    return null;
  }
  return loadedBorderImages.get(dataUrl) ?? null;
}

/**
 * v0.6.0 Part C (§8): await a border image (with a timeout that never
 * rejects — an unloaded frame must not fail the export). The canvas
 * fallback uses this before drawing, so the frame is in the PDF even
 * when the preview never warmed the cache.
 */
export function loadBorderImage(
  dataUrl: string,
  timeoutMs: number = 5000
): Promise<HTMLImageElement | null> {
  const cached = getLoadedBorderImage(dataUrl);
  if (cached) return Promise.resolve(cached);
  return new Promise(resolve => {
    let done = false;
    const finish = (img: HTMLImageElement | null) => {
      if (done) return;
      done = true;
      resolve(img);
    };
    const timer = setTimeout(() => finish(getLoadedBorderImage(dataUrl)), timeoutMs);
    const probe = new Image();
    probe.onload = () => {
      clearTimeout(timer);
      loadedBorderImages.set(dataUrl, probe);
      finish(probe);
    };
    probe.onerror = () => {
      clearTimeout(timer);
      loadedBorderImages.delete(dataUrl);
      finish(null);
    };
    probe.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// v0.9.0 Part C — Shaar Blatt (title page) classification, deterministic.
// ---------------------------------------------------------------------------

export interface TitlePageClassification {
  /** True when the import opens with a recognisable title page. */
  isTitlePage: boolean;
  /** 0–1 confidence (title role present = high; short heading lines = lower). */
  confidence: number;
  /** A decorative frame is present in the import (ornament/image unit, or a frame style name). */
  hasDecorativeFrame: boolean;
  /** Detected hierarchy, in reading order (title first). */
  title?: string;
  subtitle?: string;
  author?: string;
  year?: string;
  publisher?: string;
  /** Suggested border style for the builder (a plain default when unsure). */
  suggestedBorderStyleId: TitlePageBorderStyleId;
  reasons: string[];
  reasonsHe: string[];
}

/**
 * NOTE: `\b` does NOT work after Hebrew letters (Hebrew is not `\w`, so
 * there is no word boundary between a Hebrew letter and a space) — the
 * author lead uses a Unicode-aware lookahead instead.
 */
const AUTHOR_LEAD_RE = /^(מאת|מחבר|חיבר|כתב|by|author|rabbi|r\.|הרב|רבי)(?![\p{L}\p{N}])/iu;
const YEAR_RE = /(\b\d{4}\b|תש[א-ת]["׳]?[א-ת]?["׳]?[א-ת]?)/;
const PUBLISHER_RE = /(הוצאת|הוצאה|נדפס|דפוס|press|publishers?|printing)/i;
const FRAME_STYLE_RE = /(frame|border|מסגרת|עיטור|ornament)/i;
/** A lone generic section heading ("הקדמה", "מבוא") is an introduction,
 *  not a title page — it must not trigger title-page classification. */
const GENERIC_SECTION_RE = /^(הקדמה|מבוא|תוכן העניינים|תוכן|הקדמת המחבר|פתיחה|מבוא כללי|introduction|contents)$/i;

/**
 * Classify the opening of an import as a title page, deterministically —
 * from roles, line lengths and opening words only. NO vision/OCR: the
 * "decorative frame present?" answer comes from what the .docx actually
 * contains (an ornament/image unit among the opening units, or a frame
 * style name), never from a picture of the page.
 *
 * A title page is: an explicit main_title/subtitle role, OR the first
 * 1–4 units are short heading-like lines (≤ 8 words each) before the
 * first body unit (main_source / regular_paragraph). The longest such
 * line is the title; a following short line is the subtitle; a line
 * starting with מאת / "by" / a rabbi's name is the author; a line with a
 * year or a publisher word is the imprint.
 */
export function classifyTitlePageStructure(units: ContentUnit[]): TitlePageClassification {
  const fallback: TitlePageClassification = {
    isTitlePage: false,
    confidence: 0,
    hasDecorativeFrame: false,
    suggestedBorderStyleId: 'double',
    reasons: [],
    reasonsHe: [],
  };
  if (units.length === 0) return fallback;
  const reasons: string[] = [];
  const reasonsHe: string[] = [];
  // Opening units: everything before the first body unit.
  const firstBodyIdx = units.findIndex(u => u.role === 'main_source' || u.role === 'regular_paragraph' || u.role === 'verse');
  const opening = firstBodyIdx < 0 ? units.slice(0, 4) : units.slice(0, Math.min(4, firstBodyIdx));
  if (opening.length === 0) return fallback;
  const hasTitleRole = opening.some(u => u.role === 'main_title' || u.role === 'subtitle');
  const shortLines = opening.filter(u => {
    const words = (u.rawText || '').trim().split(/\s+/).filter(Boolean).length;
    return words >= 1 && words <= 8 && (u.role === 'chapter' || u.role === 'heading' || u.role === 'main_title' || u.role === 'subtitle' || u.role === 'subheading');
  });
  // A single generic section heading is an introduction, not a title page.
  const meaningfulShortLines = shortLines.filter(u => !GENERIC_SECTION_RE.test((u.rawText || '').trim()));
  const isTitlePage = hasTitleRole || meaningfulShortLines.length >= 1;
  if (!isTitlePage) return fallback;
  if (hasTitleRole) {
    reasons.push('explicit title/subtitle role in the import');
    reasonsHe.push('תפקיד כותרת מפורש בקובץ');
  } else {
    reasons.push(`${meaningfulShortLines.length} short heading line(s) before the first body text`);
    reasonsHe.push(`${meaningfulShortLines.length} שורות כותרת קצרות לפני גוף הטקסט`);
  }
  const hasDecorativeFrame = opening.some(
    u => u.role === 'ornament' || u.role === 'image' || FRAME_STYLE_RE.test(u.styleName || '')
  );
  if (hasDecorativeFrame) {
    reasons.push('decorative frame / ornament present in the opening');
    reasonsHe.push('נמצאה מסגרת מעוטרת בפתיחה');
  }
  // Hierarchy, in reading order.
  const titleUnit = opening.find(u => u.role === 'main_title') ?? meaningfulShortLines[0];
  const title = titleUnit ? titleUnit.rawText.trim() : undefined;
  const rest = opening.filter(u => u !== titleUnit);
  let subtitle: string | undefined;
  let author: string | undefined;
  let year: string | undefined;
  let publisher: string | undefined;
  for (const u of rest) {
    const text = (u.rawText || '').trim();
    if (!text) continue;
    if (!author && AUTHOR_LEAD_RE.test(text)) { author = text; continue; }
    if (!publisher && PUBLISHER_RE.test(text)) { publisher = text; continue; }
    if (!year && YEAR_RE.test(text) && text.split(/\s+/).length <= 6) { year = text; continue; }
    if (!subtitle && text.split(/\s+/).length <= 8) { subtitle = text; continue; }
  }
  const confidence = hasTitleRole ? 0.9 : meaningfulShortLines.length >= 2 ? 0.75 : 0.6;
  return {
    isTitlePage: true,
    confidence,
    hasDecorativeFrame,
    title,
    subtitle,
    author,
    year,
    publisher,
    suggestedBorderStyleId: hasDecorativeFrame ? 'ornate' : 'double',
    reasons,
    reasonsHe,
  };
}

/**
 * Wire a title-page classification into the existing title-page builder:
 * returns new settings with the title page enabled, its fields prefilled
 * from the detected hierarchy, and the suggested border style. Pure —
 * the caller (App's import handler) writes the settings. When the
 * classification is not a title page the settings are returned unchanged.
 */
export function titlePageSettingsFromClassification(
  settings: ProfessionalDesignSettings,
  classification: TitlePageClassification
): ProfessionalDesignSettings {
  if (!classification.isTitlePage) return settings;
  const next: ProfessionalDesignSettings = JSON.parse(JSON.stringify(settings));
  const tp: TitlePageSettings = next.titlePage ?? JSON.parse(JSON.stringify(DEFAULT_TITLE_PAGE_SETTINGS));
  next.titlePage = tp;
  tp.enabled = true;
  const setField = (field: 'title' | 'subtitle' | 'author' | 'publisher' | 'year', value?: string) => {
    if (value) tp[field] = { ...tp[field], text: value };
  };
  setField('title', classification.title);
  setField('subtitle', classification.subtitle);
  setField('author', classification.author);
  setField('publisher', classification.publisher);
  setField('year', classification.year);
  tp.border = { ...tp.border, enabled: true, styleId: classification.suggestedBorderStyleId };
  return next;
}
