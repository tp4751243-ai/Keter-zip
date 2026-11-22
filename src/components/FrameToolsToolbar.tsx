/**
 * v0.7.0 Part 2 (M3) — InDesign-style frame tools toolbar.
 *
 * V selection, Rectangle / Ellipse / Polygon / Freeform Pen. Picking
 * a frame tool and dragging on an empty part of the page draws the frame
 * at the dragged rect (v0.8.0 Part E); the "Add frame" button drops the
 * default-size frame instead. The polygon tool offers the L / T /
 * inverted-T / cross / freeform variants. Frames are moved and resized
 * with the persistent handles on the canvas (v0.6.0) and their vertices
 * with the vertex handles (Part 2, PageCanvas).
 *
 * v0.8.0 Part B: the Type (T) tool BUTTON is gone — it set a mode that
 * created no text frame and did nothing on the canvas (audit #14). The
 * T keyboard shortcut still works: it arms the internal 'type' tool
 * (v0.8.0 merge, task §3), so dragging on empty page space draws a
 * text frame — a new empty unit is created and the Story Editor opens
 * focused on it (Part E flow) — and with a unit selected, T starts
 * editing it. 'type' lives in FrameToolId but is never listed here.
 */
import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import type { FrameToolId, PolygonVariant } from '../engine/frame-tools';

interface FrameToolsToolbarProps {
  activeTool: FrameToolId;
  onToolChange: (tool: FrameToolId) => void;
  polygonVariant: PolygonVariant;
  onPolygonVariantChange: (v: PolygonVariant) => void;
  onAddFrame: () => void;
  canAddFrame: boolean;
}

const TOOLS: Array<{ id: FrameToolId; icon: string; labelHe: string; hint: string; drawHint: string }> = [
  { id: 'select', icon: '➤', labelHe: 'בחירה', hint: 'V', drawHint: '' },
  { id: 'rectangle', icon: '▭', labelHe: 'מלבן', hint: '', drawHint: 'גרור על שטח ריק בדף לציור מלבן' },
  { id: 'ellipse', icon: '⬭', labelHe: 'אליפסה', hint: '', drawHint: 'גרור על שטח ריק בדף לציור אליפסה' },
  { id: 'polygon', icon: '⬠', labelHe: 'מצולע', hint: '', drawHint: 'גרור על שטח ריק בדף לציור מצולע' },
  { id: 'pen', icon: '✒', labelHe: 'עט חופשי', hint: '', drawHint: 'גרור על שטח ריק בדף לציור מסגרת חופשית' },
];

export const FrameToolsToolbar: React.FC<FrameToolsToolbarProps> = ({
  activeTool,
  onToolChange,
  polygonVariant,
  onPolygonVariantChange,
  onAddFrame,
  canAddFrame,
}) => {
  const { t } = useLanguage();
  const showVariants = activeTool === 'polygon' || activeTool === 'pen';
  return (
    <div className="flex items-center gap-1 px-2 py-1 shrink-0 border-b border-[var(--ui-border)] bg-[var(--ui-surface)] overflow-x-auto" data-testid="frame-tools-toolbar">
      <span className="text-[11px] font-semibold text-[var(--ui-muted)] whitespace-nowrap">{t('כלי מסגרת')}</span>
      {TOOLS.map(tool => (
        <button
          key={tool.id}
          type="button"
          onClick={() => onToolChange(tool.id)}
          title={`${t(tool.labelHe)}${tool.hint ? ` (${tool.hint})` : ''}${tool.drawHint ? ` — ${t(tool.drawHint)}` : ''}`}
          className={`px-2 py-1 rounded border text-xs whitespace-nowrap ${
            activeTool === tool.id
              ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)]'
              : 'border-[var(--ui-border)] hover:bg-[var(--ui-hover)]'
          }`}
        >
          <span aria-hidden>{tool.icon}</span> {t(tool.labelHe)}
          {tool.hint && <span className="text-[10px] text-[var(--ui-muted)]"> {tool.hint}</span>}
        </button>
      ))}
      {showVariants && (
        <select
          className="px-1 py-1 rounded border border-[var(--ui-border)] bg-[var(--ui-input-bg)] text-xs"
          value={polygonVariant}
          onChange={e => onPolygonVariantChange(e.target.value as PolygonVariant)}
          title={t('צורת המצולע')}
        >
          <option value="l_shape">{t('צורת L')}</option>
          <option value="t_shape">{t('צורת T')}</option>
          <option value="inverted_t">{t('צורת T הפוכה')}</option>
          <option value="cross">{t('צלב (+)')}</option>
          <option value="custom">{t('מצולע חופשי')}</option>
        </select>
      )}
      {(activeTool === 'rectangle' || activeTool === 'ellipse' || activeTool === 'polygon' || activeTool === 'pen') && (
        <button
          type="button"
          onClick={onAddFrame}
          disabled={!canAddFrame}
          title={canAddFrame ? t('הוסף את המסגרת לעמוד הנוכחי') : t('מסגרות זמינות רק בעמודי פריסה מותאמת')}
          className="px-2 py-1 rounded border border-[var(--ui-border)] text-xs hover:bg-[var(--ui-hover)] disabled:opacity-50 whitespace-nowrap"
        >
          {t('הוסף מסגרת לעמוד')}
        </button>
      )}
    </div>
  );
};
