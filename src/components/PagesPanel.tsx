/**
 * v0.7.0 Part 1 (M2) — InDesign-style Pages Panel.
 *
 * Replaces the plain page list with visual thumbnail spreads: in an RTL
 * Hebrew book a spread shows Amud Rishon (א׳, odd folio) on the RIGHT and
 * Amud Sheini (ב׳, even folio) on the LEFT. Each spread carries folio
 * labels (א׳ / 2a). v0.8.0 Part E: the docstring used to claim a
 * master-page prefix per spread, but no master-page system exists
 * anywhere in the app (only the IDML exporter's single master spread),
 * so the dead `masterPrefix` prop was removed instead of faked.
 *
 * - Drag-and-drop reordering: dragging a page thumbnail onto another page
 *   moves that page's content units (in reading order) to the target
 *   position and re-paginates — a real reorder, not a display sort.
 * - Insert / delete: the "⋯" menu on a page offers "Insert page here"
 *   (inserts a new section heading unit flagged to start a new page, so a
 *   real fresh page appears after re-pagination) and "Delete page" (removes
 *   the units typeset on that page, with the app's normal undo available).
 *   Both go through the App callbacks; if the parent passes no handler the
 *   menu items are disabled with the reason, never a dead button.
 */
import React, { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { folioLatin, folioLatinTalmud } from '../engine/vilna-shas';
import type { BookLayoutType, PageTypesetResult } from '../types/typesetter';

interface PagesPanelProps {
  pages: PageTypesetResult[];
  layoutType?: BookLayoutType;
  currentPageIndex: number;
  onSelectPage: (pageIndex: number) => void;
  onReorderPage: (fromIndex: number, toIndex: number) => void;
  onInsertPage?: (afterIndex: number) => void;
  onDeletePage?: (pageIndex: number) => void;
  widthPx?: number;
}

export function folioLabel(page: PageTypesetResult, layoutType?: BookLayoutType): { he: string; latin: string } {
  // Standard numbering: 1 → 1a, 2 → 1b. Rav-text (Vilna Shas) numbers
  // from Daf Bet: 2 → 2a, 3 → 2b (see vilna-shas.folioLatinTalmud).
  const latin = layoutType === 'rav_text' ? folioLatinTalmud(page.pageNumber) : folioLatin(page.pageNumber);
  return { he: page.pageNumberHebrew, latin };
}

/** Spread pairs for RTL books: [rightPage, leftPage] (right = Amud Rishon). */
export function spreadPairs(pages: PageTypesetResult[]): Array<[PageTypesetResult | null, PageTypesetResult | null]> {
  const pairs: Array<[PageTypesetResult | null, PageTypesetResult | null]> = [];
  for (let i = 0; i < pages.length; i += 2) {
    pairs.push([pages[i] ?? null, pages[i + 1] ?? null]);
  }
  return pairs;
}

export const PagesPanel: React.FC<PagesPanelProps> = ({
  pages,
  layoutType,
  currentPageIndex,
  onSelectPage,
  onReorderPage,
  onInsertPage,
  onDeletePage,
  widthPx = 260,
}) => {
  const { t } = useLanguage();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  const thumb = (page: PageTypesetResult | null) => {
    if (!page) return <div className="flex-1 rounded border border-dashed border-[var(--ui-border)] bg-transparent min-h-[64px]" />;
    const folio = folioLabel(page, layoutType);
    const isCurrent = page.pageIndex === currentPageIndex;
    const lineCount = page.sourceLines.length + page.rashiLines.length + page.tosafotLines.length;
    return (
      <div
        draggable
        onDragStart={() => setDragFrom(page.pageIndex)}
        onDragEnd={() => setDragFrom(null)}
        onDragOver={e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={e => {
          e.preventDefault();
          if (dragFrom !== null && dragFrom !== page.pageIndex) onReorderPage(dragFrom, page.pageIndex);
          setDragFrom(null);
        }}
        onClick={() => onSelectPage(page.pageIndex)}
        className={`flex-1 min-h-[64px] rounded border p-1 cursor-grab select-none relative ${
          isCurrent ? 'border-[var(--ui-accent)] ring-1 ring-[var(--ui-accent)] bg-[var(--ui-hover)]' : 'border-[var(--ui-border)] bg-[var(--ui-panel-bg)]'
        } ${dragFrom === page.pageIndex ? 'opacity-50' : ''}`}
        title={`${t('דף')} ${folio.he} (${folio.latin}) — ${t('גרור לסידור מחדש')}`}
      >
        <div className="text-[11px] font-bold text-center leading-tight">
          {t('דף')} {folio.he}
        </div>
        <div className="text-[10px] text-center text-[var(--ui-muted)]">{folio.latin}</div>
        {/* Miniature text block: density hint, not fake content */}
        <div className="mt-1 mx-1 space-y-[3px]" aria-hidden>
          {Array.from({ length: Math.min(5, Math.max(1, Math.round(lineCount / 8))) }).map((_, i) => (
            <div key={i} className="h-[3px] rounded bg-[var(--ui-border)]" />
          ))}
        </div>
        <button
          type="button"
          className="absolute top-0.5 end-0.5 w-5 h-5 rounded text-xs hover:bg-[var(--ui-hover)]"
          onClick={e => {
            e.stopPropagation();
            setMenuFor(menuFor === page.pageIndex ? null : page.pageIndex);
          }}
          title={t('תפריט עמוד')}
        >
          ⋯
        </button>
        {menuFor === page.pageIndex && (
          <div
            className="absolute top-6 end-0 z-20 min-w-[150px] rounded border border-[var(--ui-border)] bg-[var(--ui-panel-bg)] shadow-lg p-1 text-start"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="block w-full text-start px-2 py-1 rounded text-xs hover:bg-[var(--ui-hover)] disabled:opacity-50"
              disabled={!onInsertPage}
              title={onInsertPage ? undefined : t('הוספת עמוד אינה זמינה במסמך זה')}
              onClick={() => {
                onInsertPage?.(page.pageIndex);
                setMenuFor(null);
              }}
            >
              {t('הוסף עמוד אחרי זה')}
            </button>
            <button
              type="button"
              className="block w-full text-start px-2 py-1 rounded text-xs hover:bg-[var(--ui-hover)] text-red-600 disabled:opacity-50"
              disabled={!onDeletePage || pages.length <= 1}
              title={onDeletePage ? undefined : t('מחיקת עמוד אינה זמינה במסמך זה')}
              onClick={() => {
                onDeletePage?.(page.pageIndex);
                setMenuFor(null);
              }}
            >
              {t('מחק עמוד זה')}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="shrink-0 flex flex-col min-h-0 border-e border-[var(--ui-border)] bg-[var(--ui-panel-bg)] overflow-y-auto"
      style={{ width: widthPx }}
      data-testid="pages-panel"
    >
      <div className="sticky top-0 px-2 py-1.5 text-xs font-semibold border-b border-[var(--ui-border)] bg-[var(--ui-panel-bg)]">
        {t('לוחות עמודים')} <span className="font-normal text-[var(--ui-muted)]">({t('פריסה כפולה — א׳ מימין')})</span>
      </div>
      <div className="p-2 space-y-2">
        {spreadPairs(pages).map((pair, i) => (
          <div key={i} className="flex gap-1.5" dir="rtl">
            {/* RTL: first child renders on the right = Amud Rishon */}
            {thumb(pair[0])}
            {thumb(pair[1])}
          </div>
        ))}
        {pages.length === 0 && <p className="text-xs text-[var(--ui-muted)] px-1">{t('אין עמודים עדיין — ייבא מסמך')}</p>}
      </div>
    </div>
  );
};
