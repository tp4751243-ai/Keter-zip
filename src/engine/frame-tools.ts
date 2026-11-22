/**
 * v0.7.0 Part 2 (M3) — InDesign-style frame tools + text threading.
 *
 * Frame tools: Rectangle, Ellipse, Polygon (L / T / inverted-T / cross /
 * freeform) and the Freeform Pen (multi-vertex custom polygon). A frame is
 * a CustomLayoutBox; its flow region is the polygon `shape` (the ellipse
 * is a 16-vertex polygon approximation, which the existing band-scanline
 * flow engine already handles as a `custom` polygon). Vertex manipulation
 * moves one vertex of that polygon; skew/rotation are frame-level CSS
 * transforms on the overlay (the text flow inside stays axis-aligned —
 * same honest caveat as rotation, recorded in MANIFEST.md).
 *
 * Threading: text flows box → box in reading order. `computeThreadLinks`
 * reads the paginated pages and links consecutive boxes that carry the
 * same story (same unit flow), so the canvas can draw out-port → in-port
 * lines. A link whose target is on the next page is reported with
 * `continuesOffPage` so the canvas draws an out-port arrow instead.
 */
import type { CustomLayoutBox, CustomLayoutBoxRole, CustomLayoutPolygonPoint } from '../types/design-settings';
import type { PageTypesetResult } from '../types/typesetter';

// v0.8.0 merge decision (Part B vs Part E, task §3): 'type' stays in the
// union but is INTERNAL-ONLY — it is set by the T keyboard shortcut and
// drives the canvas drag-to-draw text-frame flow (Part E). There is NO
// 'type' button in the toolbar (Part B: the button created nothing).
export type FrameToolId = 'select' | 'type' | 'rectangle' | 'ellipse' | 'polygon' | 'pen';
export type PolygonVariant = 'l_shape' | 't_shape' | 'inverted_t' | 'cross' | 'custom';

export function ellipsePoints(vertices = 16): CustomLayoutPolygonPoint[] {
  const pts: CustomLayoutPolygonPoint[] = [];
  for (let i = 0; i < vertices; i++) {
    const a = (2 * Math.PI * i) / vertices;
    pts.push({ x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) });
  }
  return pts;
}

export function polygonVariantPoints(variant: PolygonVariant): CustomLayoutPolygonPoint[] {
  switch (variant) {
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
    case 'custom':
    default:
      return [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 },
        { x: 0.7, y: 1 }, { x: 0, y: 1 },
      ];
  }
}

let frameCounter = 0;

export function createFrameBox(
  tool: Exclude<FrameToolId, 'select' | 'type'>,
  role: CustomLayoutBoxRole,
  variant?: PolygonVariant,
  // v0.8.0 Part E: drag-to-draw — the rect the user dragged on the canvas,
  // in % of the content area. Unset = the old default 25%,20%,50%×40% box
  // (kept for the toolbar's "Add frame" button).
  rect?: { xPct: number; yPct: number; widthPct: number; heightPct: number }
): CustomLayoutBox {
  frameCounter += 1;
  const id = `frame-${Date.now()}-${frameCounter}`;
  const base: CustomLayoutBox = {
    id,
    role,
    labelHe: tool === 'ellipse' ? 'מסגרת אליפסה' : tool === 'polygon' ? 'מסגרת מצולע' : tool === 'pen' ? 'מסגרת חופשית' : 'מסגרת מלבן',
    xPct: rect?.xPct ?? 25,
    yPct: rect?.yPct ?? 20,
    widthPct: rect?.widthPct ?? 50,
    heightPct: rect?.heightPct ?? 40,
  };
  if (tool === 'ellipse') {
    return { ...base, shape: { kind: 'ellipse', points: ellipsePoints() } };
  }
  if (tool === 'polygon' || tool === 'pen') {
    const v = variant ?? 'custom';
    return { ...base, shape: { kind: v, points: polygonVariantPoints(v) } };
  }
  return base;
}

/** Move one vertex of a box's polygon; returns a new box (no mutation). */
export function moveBoxVertex(box: CustomLayoutBox, vertexIndex: number, x: number, y: number): CustomLayoutBox {
  if (!box.shape) return box;
  const points = box.shape.points.map((p, i) =>
    i === vertexIndex ? { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } : p
  );
  return { ...box, shape: { ...box.shape, points } };
}

export interface ThreadLink {
  fromBoxId: string;
  toBoxId: string | null; // null = continues onto the next page
  pageIndex: number;
  continuesOffPage: boolean;
}

/**
 * Thread links for one page: consecutive custom-layout boxes on that page
 * that carry flowing text, in the order their first lines appear. A box
 * whose story continues to the next page gets a link with toBoxId null.
 */
export function computeThreadLinks(pages: PageTypesetResult[], pageIndex: number): ThreadLink[] {
  const page = pages[pageIndex];
  if (!page) return [];
  const allLines = [...page.sourceLines, ...page.rashiLines, ...page.tosafotLines, ...(page.column2Lines ?? [])];
  const boxOrder: string[] = [];
  for (const l of allLines) {
    const id = l.customLayoutBoxId;
    if (id && !boxOrder.includes(id)) boxOrder.push(id);
  }
  const links: ThreadLink[] = [];
  for (let i = 0; i < boxOrder.length - 1; i++) {
    links.push({ fromBoxId: boxOrder[i], toBoxId: boxOrder[i + 1], pageIndex, continuesOffPage: false });
  }
  const continues = (page.continuedUnitIdsToNextPage?.length ?? 0) > 0 && boxOrder.length > 0;
  if (continues) {
    links.push({ fromBoxId: boxOrder[boxOrder.length - 1], toBoxId: null, pageIndex, continuesOffPage: true });
  }
  return links;
}
