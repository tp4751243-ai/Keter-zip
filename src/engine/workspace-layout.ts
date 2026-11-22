/**
 * v0.7.0 Part 1 (M1) — InDesign-style dockable panel architecture & workspaces.
 *
 * A panel is a named inspector. Panels live in docked groups (left /
 * right strips), can be dragged out into floating windows, and collapsed
 * to an iconic quick-access strip. A workspace is the saved arrangement;
 * it persists in localStorage and restores on launch.
 *
 * RTL (Hebrew InDesign) convention: in a Hebrew UI the dock order is
 * mirrored — the primary inspector dock sits on the LEFT of the canvas in
 * the visual order used by Hebrew InDesign (panels read right-to-left),
 * and every measurement origin is the page's INSIDE (binding) edge, not
 * the left edge. `resolveMeasurementOrigin` returns the origin side for a
 * facing page so X coordinates are reported from the binding edge.
 *
 * v0.8.0 Part B — mock-panel removal: the v0.7.0 panels `page_design`,
 * `layers` and `glyphs` were display-only (read-only summary, flat
 * select-only unit list, hardcoded alphabet) and are gone, together with
 * the unimplemented tab-grouping state (`tabGroup` / `activeTabs` —
 * declared but never rendered by DockablePanels). The surviving panels
 * are all real: Paragraph Styles and Character Styles apply a role's
 * attributes to the selected unit, Links jumps to a real rav-text link.
 * Surviving panels default to COLLAPSED so the canvas gets the freed
 * width; a persisted pre-v0.8.0 layout is migrated by
 * `normalizeWorkspaceLayout` (unknown panels dropped, survivors
 * collapsed so the workspace re-opens clean and centred).
 */

export type PanelId =
  | 'paragraph_styles'
  | 'character_styles'
  | 'links';

export type DockSide = 'left' | 'right' | 'floating';

export interface PanelPlacement {
  id: PanelId;
  side: DockSide;
  /** Order inside its dock group (0 = first). */
  order: number;
  /** Collapsed to the iconic strip (true) or expanded. */
  collapsed: boolean;
  /** Floating window position/size (only when side === 'floating'). */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface WorkspaceLayout {
  name: string;
  panels: PanelPlacement[];
}

export const PANEL_DEFS: Array<{ id: PanelId; titleHe: string; titleEn: string; icon: string }> = [
  { id: 'paragraph_styles', titleHe: 'סגנונות פסקה', titleEn: 'Paragraph Styles', icon: '¶' },
  { id: 'character_styles', titleHe: 'סגנונות תו', titleEn: 'Character Styles', icon: 'A' },
  { id: 'links', titleHe: 'קישורים', titleEn: 'Links', icon: '🔗' },
];

export const WORKSPACE_STORAGE_KEY = 'keter-workspace-layout-v070';
export const WORKSPACES_STORAGE_KEY = 'keter-workspaces-v070';

/** Hebrew InDesign default: inspectors docked right in LTR order become
 *  left-docked in RTL; the panel tab order reads right-to-left.
 *  v0.8.0 Part B: panels default to collapsed so the main canvas gets
 *  the full width (docks render as 40px icon strips until opened). */
export function defaultWorkspaceLayout(lang: 'he' | 'en'): WorkspaceLayout {
  const rtl = lang === 'he';
  const mk = (id: PanelId, side: DockSide, order: number): PanelPlacement => ({ id, side, order, collapsed: true });
  return {
    name: rtl ? 'ברירת מחדל (עברית)' : 'Default',
    panels: [
      mk('paragraph_styles', rtl ? 'left' : 'right', 0),
      mk('character_styles', rtl ? 'left' : 'right', 1),
      mk('links', rtl ? 'right' : 'left', 0),
    ],
  };
}

/**
 * v0.8.0 Part B — migrate a persisted layout to the current panel set:
 * drop panels that no longer exist, add any missing current panel
 * (collapsed), and drop the removed tab-group fields. A layout that
 * still referenced a removed panel is a pre-v0.8.0 layout, so its
 * surviving panels are collapsed too — the workspace re-opens clean
 * and centred instead of squeezed by the old six-panel arrangement.
 */
export function normalizeWorkspaceLayout(layout: WorkspaceLayout, lang: 'he' | 'en'): WorkspaceLayout {
  const knownIds = new Set<PanelId>(PANEL_DEFS.map(d => d.id));
  const hadRemovedPanels = layout.panels.some(p => !knownIds.has(p.id));
  const kept: PanelPlacement[] = layout.panels
    .filter(p => knownIds.has(p.id))
    .map(p => ({
      id: p.id,
      side: p.side,
      order: p.order,
      collapsed: hadRemovedPanels ? true : p.collapsed,
      ...(p.x !== undefined ? { x: p.x } : {}),
      ...(p.y !== undefined ? { y: p.y } : {}),
      ...(p.width !== undefined ? { width: p.width } : {}),
      ...(p.height !== undefined ? { height: p.height } : {}),
    }));
  const defaults = defaultWorkspaceLayout(lang);
  for (const d of defaults.panels) {
    if (!kept.some(p => p.id === d.id)) kept.push({ ...d });
  }
  return { name: layout.name || defaults.name, panels: kept };
}

export function loadWorkspace(): WorkspaceLayout | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceLayout;
    if (!parsed || !Array.isArray(parsed.panels)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkspace(layout: WorkspaceLayout): void {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // storage unavailable (private mode) — layout simply does not persist
  }
}

export function loadSavedWorkspaces(): WorkspaceLayout[] {
  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WorkspaceLayout[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveWorkspaceNamed(layout: WorkspaceLayout): void {
  const all = loadSavedWorkspaces().filter(w => w.name !== layout.name);
  all.push(layout);
  try {
    localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

/** v0.8.0 Part B — delete a named workspace (used by the workspace picker). */
export function deleteSavedWorkspace(name: string): void {
  const all = loadSavedWorkspaces().filter(w => w.name !== name);
  try {
    localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

/**
 * Hebrew publishing measurement origin: X is measured from the INSIDE
 * (binding) edge. Hebrew books open left-to-right-reversed: the recto
 * (a-side, e.g. 2a) is the LEFT-hand page of the spread, so its inside
 * edge is the RIGHT edge; the verso (b-side, e.g. 2b) is the RIGHT-hand
 * page, so its inside edge is the LEFT edge. (v0.8.0 Part C §4 — the
 * English-book convention in the old comment was inverted for Hebrew
 * books; see vilna-shas.ts for the evidence.) Returns the origin side
 * and the X offset (pt) from that edge.
 */
export function resolveMeasurementOrigin(
  pageXFromLeftPt: number,
  pageWidthPt: number,
  isVerso: boolean
): { originSide: 'inside' | 'outside'; xFromOriginPt: number } {
  if (isVerso) {
    // Verso (right-facing): inside edge is the left edge of the page.
    return { originSide: 'inside', xFromOriginPt: pageXFromLeftPt };
  }
  // Recto (left-facing): inside edge is the right edge of the page.
  return { originSide: 'inside', xFromOriginPt: pageWidthPt - pageXFromLeftPt };
}

/**
 * v0.8.0 Part C (§5): pure pt conversions for a custom-layout box — the
 * Control Panel must use the ACTUAL page height (720pt Vilna folio,
 * 842pt A4), never a hardcoded 680pt (Y=700 on a Vilna page used to read
 * as ~103%, off-page).
 */
export function frameGeometryPt(
  box: { xPct: number; yPct: number; widthPct: number; heightPct: number },
  pageWidthPt: number,
  pageHeightPt: number
): { xPt: number; yPt: number; widthPt: number; heightPt: number } {
  return {
    xPt: (box.xPct / 100) * pageWidthPt,
    yPt: (box.yPct / 100) * pageHeightPt,
    widthPt: (box.widthPct / 100) * pageWidthPt,
    heightPt: (box.heightPct / 100) * pageHeightPt,
  };
}

/** Panel tab order for the current UI direction: Hebrew reads right-to-left. */
export function orderedPanels(panels: PanelPlacement[], dir: 'rtl' | 'ltr'): PanelPlacement[] {
  const sorted = [...panels].sort((a, b) => a.order - b.order);
  return dir === 'rtl' ? sorted.reverse() : sorted;
}
