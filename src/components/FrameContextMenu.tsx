/**
 * v0.7.0 Part 2 (M4) — right-click context menu for text blocks & frames.
 * Every item calls a real App handler (or is disabled with the reason);
 * there are no placeholder entries. v0.8.0 Part E: the "Text Frame
 * Options…" item was removed — it only opened the design drawer, and
 * there is no Text Frame Options dialog in the app; the drawer is
 * reachable from the "Assign style…" items and the toolbar instead.
 */
import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';

export interface FrameContextMenuState {
  x: number;
  y: number;
  unitId: string | null;
  /** True when the click landed on a frame/box rather than plain text. */
  onFrame: boolean;
}

interface FrameContextMenuProps {
  menu: FrameContextMenuState;
  onClose: () => void;
  onFittingAutoCenter: () => void;
  onDisplayPerformance: () => void;
  displayPerformanceFast: boolean;
  onOpenStoryEditor: () => void;
  onAssignParagraphStyle: () => void;
  onAssignCharacterStyle: () => void;
  onCopyText: () => void;
  onDeleteUnit: () => void;
}

export const FrameContextMenu: React.FC<FrameContextMenuProps> = ({
  menu,
  onClose,
  onFittingAutoCenter,
  onDisplayPerformance,
  displayPerformanceFast,
  onOpenStoryEditor,
  onAssignParagraphStyle,
  onAssignCharacterStyle,
  onCopyText,
  onDeleteUnit,
}) => {
  const { t } = useLanguage();
  const itemCls = 'block w-full text-start px-2.5 py-1.5 rounded text-xs hover:bg-[var(--ui-hover)] disabled:opacity-50';
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 min-w-[220px] rounded-lg border border-[var(--ui-border)] bg-[var(--ui-panel-bg)] shadow-xl p-1"
        style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 320) }}
        data-testid="frame-context-menu"
      >
        <button type="button" className={itemCls} onClick={() => { onFittingAutoCenter(); onClose(); }} disabled={!menu.unitId}>
          {t('מרכוז אוטומטי')}
        </button>
        <button type="button" className={itemCls} onClick={() => { onDisplayPerformance(); onClose(); }}>
          {t('ביצועי תצוגה')}: {displayPerformanceFast ? t('מהיר') : t('איכות מלאה')}
        </button>
        <div className="my-1 border-t border-[var(--ui-border)]" />
        <button type="button" className={itemCls} onClick={() => { onOpenStoryEditor(); onClose(); }}>
          {t('עורך סיפור (Story Editor)')}
        </button>
        <button type="button" className={itemCls} onClick={() => { onAssignParagraphStyle(); onClose(); }}>
          {t('שיוך סגנון פסקה…')}
        </button>
        <button type="button" className={itemCls} onClick={() => { onAssignCharacterStyle(); onClose(); }}>
          {t('שיוך סגנון תו…')}
        </button>
        <div className="my-1 border-t border-[var(--ui-border)]" />
        <button type="button" className={itemCls} onClick={() => { onCopyText(); onClose(); }} disabled={!menu.unitId}>
          {t('העתק טקסט')}
        </button>
        <button type="button" className={`${itemCls} text-red-600`} onClick={() => { onDeleteUnit(); onClose(); }} disabled={!menu.unitId}>
          {t('מחק יחידה')}
        </button>
      </div>
    </>
  );
};
