/**
 * Keter Typesetter — Whole-Book Thumbnail Overview (v0.3.0, Module E)
 *
 * A grid of small page thumbnails for the whole book: each card shows the
 * page number (Hebrew folio), a first-line excerpt, and a tiny density hint
 * (line count). Clicking a card opens that page via `onOpenPage`.
 *
 * Deliberately lightweight: no canvas rasterisation, no re-typesetting — the
 * excerpt is taken from the already-paginated page data, so the overview is
 * cheap even for very long books.
 *
 * Original offline code. No network, no new dependencies.
 */

import React, { useMemo } from 'react';
import { BookOpen, X } from 'lucide-react';
import { PageTypesetResult } from '../types/typesetter';
import { useLanguage } from '../i18n/LanguageContext';

export interface ThumbnailOverviewProps {
  /** All pages of the book, in order. */
  pages: PageTypesetResult[];
  /** 0-based index of the page currently open in the canvas. */
  currentPage: number;
  /** Open a page in the main canvas. */
  onOpenPage: (pageIndex: number) => void;
  /** Close the overview. */
  onClose: () => void;
}

interface PageThumb {
  pageIndex: number;
  pageNumber: number;
  pageNumberHebrew: string;
  headerTitle: string;
  excerpt: string;
  lineCount: number;
  hasIssuesHint: boolean;
}

function firstLineExcerpt(page: PageTypesetResult): string {
  const first =
    page.sourceLines?.[0] ??
    page.column2Lines?.[0] ??
    page.rashiLines?.[0] ??
    page.tosafotLines?.[0];
  if (!first) return '';
  return first.words
    .filter(w => !w.isSpace)
    .map(w => w.text)
    .join(' ')
    .slice(0, 90);
}

function lineCountOf(page: PageTypesetResult): number {
  return (
    (page.sourceLines?.length ?? 0) +
    (page.rashiLines?.length ?? 0) +
    (page.tosafotLines?.length ?? 0) +
    (page.column2Lines?.length ?? 0) +
    (page.footnoteLines?.length ?? 0)
  );
}

export const ThumbnailOverview: React.FC<ThumbnailOverviewProps> = ({
  pages,
  currentPage,
  onOpenPage,
  onClose,
}) => {
  const { t, dir } = useLanguage();

  const thumbs = useMemo<PageThumb[]>(
    () =>
      pages.map((page, pageIndex) => ({
        pageIndex,
        pageNumber: page.pageNumber,
        pageNumberHebrew: page.pageNumberHebrew,
        headerTitle: page.headerTitle,
        excerpt: firstLineExcerpt(page),
        lineCount: lineCountOf(page),
        hasIssuesHint: (page.layoutScore?.totalScore ?? 100) < 70,
      })),
    [pages]
  );

  return (
    <div
      dir={dir}
      className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-label={t('תצוגת כל דפי הספר')}
      onClick={onClose}
    >
      <div
        className="flex-1 m-4 md:m-8 rounded-xl bg-[var(--ui-surface)] text-[var(--ui-text-primary)] shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-[var(--ui-border)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <BookOpen className="w-4 h-4 text-[var(--ui-accent)]" />
            <span>{t('כל דפי הספר')}</span>
            <span className="text-xs font-normal text-[var(--ui-text-secondary)]">
              {t(`${pages.length} דפים — לחץ על דף כדי לפתוח אותו`)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)]"
            title={t('סגור (Esc)')}
            aria-label={t('סגור')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Grid of mini page cards */}
        <div className="flex-1 overflow-y-auto p-4">
          {thumbs.length === 0 ? (
            <p className="text-sm text-[var(--ui-text-secondary)] text-center py-10">
              {t('אין עדיין דפים בספר.')}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {thumbs.map(thumb => {
                const isCurrent = thumb.pageIndex === currentPage;
                return (
                  <button
                    key={thumb.pageIndex}
                    onClick={() => onOpenPage(thumb.pageIndex)}
                    className={`text-right rounded-lg border p-2.5 transition-colors flex flex-col gap-1.5 min-h-[132px] ${
                      isCurrent
                        ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/40 bg-[var(--ui-accent)]/5'
                        : 'border-[var(--ui-border)] bg-[var(--ui-surface)] hover:border-[var(--ui-accent)]/60 hover:bg-[var(--ui-surface-hover)]'
                    }`}
                    title={`${t('דף')} ${thumb.pageNumberHebrew} — ${thumb.headerTitle}`}
                  >
                    {/* Mini page sheet */}
                    <div className="h-[72px] rounded border border-[var(--ui-border)] bg-[var(--ui-page-bg)] p-1.5 overflow-hidden">
                      <div className="h-px bg-[#2A2622]/60 mb-1" />
                      {thumb.excerpt ? (
                        <p
                          dir="rtl"
                          className="text-[9px] leading-[1.5] text-[#161514] line-clamp-4"
                          style={{ fontFamily: '"Frank Ruhl Libre", serif' }}
                        >
                          {thumb.excerpt}
                        </p>
                      ) : (
                        <p className="text-[9px] text-[#A39B8B] italic">
                          {t('(דף ריק או דף תמונה)')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold">
                        {t('דף')} {thumb.pageNumberHebrew}
                      </span>
                      <span className="text-[10px] text-[var(--ui-text-secondary)]">
                        {t(`${thumb.lineCount} שורות`)}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--ui-text-secondary)] truncate">
                      {thumb.headerTitle}
                    </span>
                    {thumb.hasIssuesHint && (
                      <span className="text-[10px] font-semibold text-amber-700">
                        {t('ציון איכות נמוך — בדוק בקרת איכות')}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="text-[10px] font-bold text-[var(--ui-accent)]">
                        {t('דף נוכחי')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="shrink-0 px-4 py-2 border-t border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)]">
          {t('טיפ: לחץ על דף כדי לעבור אליו בעורך. Esc לסגירה.')}
        </div>
      </div>
    </div>
  );
};
