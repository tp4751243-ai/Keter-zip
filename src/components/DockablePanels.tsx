/**
 * v0.7.0 Part 1 (M1) — Dockable panel shell, InDesign-style.
 *
 * Renders a dock group (left or right strip) of panels. Each panel can be:
 * - collapsed to an iconic quick-access strip (icon only, expands on click),
 * - dragged out into a floating window (pointer drag on the panel header;
 *   the window is absolutely positioned and draggable by its title bar),
 * - docked back by dropping on a dock strip (the floating window's "dock"
 *   button returns it to its previous dock side).
 *
 * v0.8.0 Part B: only real panels remain (Paragraph Styles, Character
 * Styles, Links); the mock panels and the unimplemented tab grouping
 * are gone. The arrangement is a `WorkspaceLayout` owned by App; this
 * component is purely presentational + drag state. The v0.5.0
 * simplification rule is honoured by the callers: each panel body shows
 * essential controls first and tucks advanced controls behind
 * "More options".
 */
import React, { useCallback, useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  PANEL_DEFS,
  PanelId,
  PanelPlacement,
  WorkspaceLayout,
  orderedPanels,
} from '../engine/workspace-layout';

interface DockablePanelsProps {
  layout: WorkspaceLayout;
  side: 'left' | 'right';
  onLayoutChange: (next: WorkspaceLayout) => void;
  /** Panel bodies, keyed by panel id. */
  children: Partial<Record<PanelId, React.ReactNode>>;
  /** Compact (icon strip) width in px when every panel in the dock is collapsed. */
  stripWidthPx?: number;
  /** Render the floating windows from this instance (only one dock should). */
  renderFloating?: boolean;
}

export const DockablePanels: React.FC<DockablePanelsProps> = ({
  layout,
  side,
  onLayoutChange,
  children,
  stripWidthPx = 40,
  renderFloating = true,
}) => {
  const { t, dir } = useLanguage();
  const [dragging, setDragging] = useState<{ id: PanelId; dx: number; dy: number } | null>(null);
  const dragRef = useRef<{ id: PanelId; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const docked = orderedPanels(layout.panels.filter(p => p.side === side), dir);

  const updatePlacement = useCallback(
    (id: PanelId, patch: Partial<PanelPlacement>) => {
      onLayoutChange({
        ...layout,
        panels: layout.panels.map(p => (p.id === id ? { ...p, ...patch } : p)),
      });
    },
    [layout, onLayoutChange]
  );

  const undock = useCallback(
    (id: PanelId) => {
      const p = layout.panels.find(x => x.id === id);
      if (!p) return;
      updatePlacement(id, {
        side: 'floating',
        x: p.x ?? 120,
        y: p.y ?? 90,
        width: p.width ?? 300,
        height: p.height ?? 420,
      });
    },
    [layout, updatePlacement]
  );

  const dock = useCallback(
    (id: PanelId, targetSide: 'left' | 'right') => {
      const order = Math.max(0, ...layout.panels.filter(p => p.side === targetSide).map(p => p.order)) + 1;
      updatePlacement(id, { side: targetSide, order, x: undefined, y: undefined });
    },
    [layout, updatePlacement]
  );

  const onHeaderPointerDown = (e: React.PointerEvent, id: PanelId) => {
    const p = layout.panels.find(x => x.id === id);
    if (!p || p.side !== 'floating') return;
    dragRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: p.x ?? 120,
      origY: p.y ?? 90,
    };
    setDragging({ id, dx: 0, dy: 0 });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    updatePlacement(d.id, { x: d.origX + (e.clientX - d.startX), y: Math.max(0, d.origY + (e.clientY - d.startY)) });
  };

  const onHeaderPointerUp = () => {
    dragRef.current = null;
    setDragging(null);
  };

  if (docked.length === 0) return null;
  const allCollapsed = docked.every(p => p.collapsed);

  return (
    <div
      className="shrink-0 flex flex-col min-h-0 border-[var(--ui-border)] bg-[var(--ui-panel-bg)] overflow-hidden"
      style={{ width: allCollapsed ? stripWidthPx : 288, borderInlineStartWidth: 1 }}
      data-testid={`dock-${side}`}
    >
      {docked.map(p => {
        const def = PANEL_DEFS.find(d => d.id === p.id)!;
        const body = children[p.id];
        return (
          <section key={p.id} className="flex flex-col min-h-0 border-b border-[var(--ui-border)]" data-panel-id={p.id}>
            <header
              className="flex items-center gap-1 px-2 py-1.5 cursor-grab select-none bg-[var(--ui-header-bg)]"
              title={t('גרור כדי להוציא לחלון צף')}
            >
              <button
                type="button"
                className="shrink-0 w-6 h-6 rounded hover:bg-[var(--ui-hover)] text-sm"
                onClick={() => updatePlacement(p.id, { collapsed: !p.collapsed })}
                title={p.collapsed ? t('הרחב לוח') : t('כווץ לסרגל אייקונים')}
              >
                {p.collapsed ? '›' : '⌄'}
              </button>
              <span className="text-base leading-none" aria-hidden>{def.icon}</span>
              {!p.collapsed && (
                <span className="flex-1 text-xs font-semibold truncate">{t(def.titleHe)}</span>
              )}
              {!p.collapsed && (
                <>
                  <button
                    type="button"
                    className="shrink-0 px-1.5 py-0.5 rounded text-[11px] hover:bg-[var(--ui-hover)]"
                    onClick={() => undock(p.id)}
                    title={t('הוצא לחלון צף')}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="shrink-0 px-1.5 py-0.5 rounded text-[11px] hover:bg-[var(--ui-hover)]"
                    onClick={() => dock(p.id, side === 'left' ? 'right' : 'left')}
                    title={t('העבר לצד השני')}
                  >
                    ⇄
                  </button>
                </>
              )}
            </header>
            {!p.collapsed && <div className="flex-1 min-h-0 overflow-y-auto p-2">{body}</div>}
          </section>
        );
      })}
      {/* Floating windows belonging to this dock's panels */}
      {renderFloating && layout.panels
        .filter(p => p.side === 'floating')
        .map(p => {
          const def = PANEL_DEFS.find(d => d.id === p.id)!;
          return (
            <div
              key={`float-${p.id}`}
              className="fixed z-50 flex flex-col rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel-bg)] shadow-xl overflow-hidden"
              style={{ left: p.x ?? 120, top: p.y ?? 90, width: p.width ?? 300, height: p.height ?? 420 }}
              data-testid={`floating-panel-${p.id}`}
            >
              <header
                className="flex items-center gap-1 px-2 py-1.5 cursor-move select-none bg-[var(--ui-header-bg)]"
                onPointerDown={e => onHeaderPointerDown(e, p.id)}
                onPointerMove={onHeaderPointerMove}
                onPointerUp={onHeaderPointerUp}
              >
                <span aria-hidden>{def.icon}</span>
                <span className="flex-1 text-xs font-semibold truncate">{t(def.titleHe)}</span>
                <button
                  type="button"
                  className="px-1.5 py-0.5 rounded text-[11px] hover:bg-[var(--ui-hover)]"
                  onClick={() => dock(p.id, side)}
                  title={t('עגן חזרה')}
                >
                  {t('עגן')}
                </button>
              </header>
              <div className="flex-1 min-h-0 overflow-y-auto p-2">{children[p.id]}</div>
              {dragging?.id === p.id && <div className="absolute inset-0 pointer-events-none" />}
            </div>
          );
        })}
    </div>
  );
};
