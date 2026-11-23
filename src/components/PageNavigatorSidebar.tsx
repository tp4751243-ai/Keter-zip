import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Network,
  Search,
  CheckCircle2,
  Bookmark,
  ChevronRight,
  ChevronLeft,
  PanelRightClose,
  Link2,
} from 'lucide-react';
import {
  BookLayoutType,
  ContentUnit,
  PageTypesetResult,
  RavTextLink,
  ValidationReport,
} from '../types/typesetter';
import { getSemanticRoleLabel, SemanticStyleRole } from '../types/design-settings';
import { folioLabel } from '../engine/page-labels';
import { useLanguage } from '../i18n/LanguageContext';

export type LeftNavigatorTab = 'pages' | 'sections' | 'hierarchy';

interface PageNavigatorSidebarProps {
  pages: PageTypesetResult[];
  currentPageIndex: number;
  onSelectPage: (pageIndex: number) => void;
  units: ContentUnit[];
  links: RavTextLink[];
  validation: ValidationReport;
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string) => void;
  layoutType: BookLayoutType;
  isOpen: boolean;
  onToggleOpen: () => void;
  activeTab: LeftNavigatorTab;
  onTabChange: (tab: LeftNavigatorTab) => void;
  widthPx: number;
  /**
   * v0.9.2 Part B — page management, moved here from the deleted
   * PagesPanel: drag a page thumbnail onto another to reorder the book,
   * insert a fresh page after one, delete a page. This sidebar is now
   * the ONLY page-navigation surface, so these actions live here with
   * the page list instead of in a second panel that replaced it.
   */
  onReorderPage: (fromIndex: number, toIndex: number) => void;
  onInsertPage?: (afterIndex: number) => void;
  onDeletePage?: (pageIndex: number) => void;
}

export const PageNavigatorSidebar: React.FC<PageNavigatorSidebarProps> = ({
  pages,
  currentPageIndex,
  onSelectPage,
  units,
  links,
  validation,
  selectedUnitId,
  onSelectUnit,
  layoutType,
  isOpen,
  onToggleOpen,
  activeTab,
  onTabChange,
  widthPx,
  onReorderPage,
  onInsertPage,
  onDeletePage,
}) => {
  const { t, dir, lang } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  // v0.9.2 Part B — drag-reorder + per-page menu state (from PagesPanel).
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  const unitToPageMap = useMemo(() => {
    const map = new Map<string, number>();
    pages.forEach((p, idx) => {
      const allLines = [
        ...p.sourceLines,
        ...p.rashiLines,
        ...p.tosafotLines,
        ...(p.column2Lines ?? []),
        ...(p.footnoteLines ?? []),
      ];
      for (const line of allLines) {
        if (line.unitId && !map.has(line.unitId)) {
          map.set(line.unitId, idx);
        }
      }
    });
    return map;
  }, [pages]);

  const documentSections = useMemo(() => {
    return units.filter(
      u =>
        u.role === 'chapter' ||
        u.role === 'main_title' ||
        u.role === 'siman' ||
        u.role === 'heading' ||
        u.role === 'subheading' ||
        u.role === 'main_source'
    );
  }, [units]);

  const filteredUnits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return units.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.rawText.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q) ||
        (u.dibburHamatchil && u.dibburHamatchil.toLowerCase().includes(q))
      );
    });
  }, [units, searchQuery, roleFilter]);

  if (!isOpen) {
    return null;
  }

  return (
    <aside
      dir={dir}
      style={{ width: `${widthPx}px` }}
      className="h-full min-h-0 bg-[var(--ui-surface)] border-e border-[var(--ui-border)] flex flex-col shrink-0 z-30 select-none overflow-hidden shadow-[var(--ui-floating-shadow)] transition-colors duration-150"
    >
      {/* Top Panel Header */}
      <div className="h-11 px-4 bg-[var(--ui-surface)] border-b border-[var(--ui-border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--ui-text-primary)]">
          <BookOpen className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
          <span>{t("דפי הספר ומבנה")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--ui-text-secondary)] font-mono">
            {pages.length}  {t("עמ׳")}
          </span>
          <button
            onClick={onToggleOpen}
            className="p-1.5 rounded-lg hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
            title={t("סגור מגירת ניווט")}
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-3 gap-1 p-2 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] text-xs shrink-0">
        <button
          onClick={() => onTabChange('pages')}
          className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'pages'
              ? 'bg-[var(--ui-selected-bg)] text-[var(--ui-selected-text)] border border-[var(--ui-selected-border)] shadow-2xs'
              : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)] border border-transparent'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>{t("עמודים")}</span>
        </button>
        <button
          onClick={() => onTabChange('sections')}
          className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'sections'
              ? 'bg-[var(--ui-selected-bg)] text-[var(--ui-selected-text)] border border-[var(--ui-selected-border)] shadow-2xs'
              : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)] border border-transparent'
          }`}
        >
          <Bookmark className="w-3.5 h-3.5" />
          <span>{t("פרקים")}</span>
        </button>
        <button
          onClick={() => onTabChange('hierarchy')}
          className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'hierarchy'
              ? 'bg-[var(--ui-selected-bg)] text-[var(--ui-selected-text)] border border-[var(--ui-selected-border)] shadow-2xs'
              : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)] border border-transparent'
          }`}
        >
          <Network className="w-3.5 h-3.5" />
          <span>{t("פסקאות")}</span>
        </button>
      </div>

      {/* TAB 1: PAGE THUMBNAILS */}
      {activeTab === 'pages' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Quick Page Jump Header */}
          <div className="px-3.5 py-2.5 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between text-xs">
            <span className="text-[var(--ui-text-secondary)]">{t("מעבר לעמוד:")}</span>
            <div className="flex items-center gap-1" dir="ltr">
              <button
                onClick={() => onSelectPage(Math.max(0, currentPageIndex - 1))}
                disabled={currentPageIndex <= 0}
                className="p-1 rounded bg-[var(--ui-surface)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] disabled:opacity-30"
                title={t("עמוד קודם")}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <select
                value={currentPageIndex}
                onChange={e => onSelectPage(Number(e.target.value))}
                className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded px-2 py-0.5 text-xs text-[var(--ui-text-primary)] font-mono focus:outline-none focus:border-[var(--ui-accent)]"
              >
                {pages.map((p, idx) => (
                  <option key={idx} value={idx}>
                    {idx + 1}  {t("— דף")} {p.pageNumberHebrew}
                  </option>
                ))}
              </select>
              <button
                onClick={() => onSelectPage(Math.min(pages.length - 1, currentPageIndex + 1))}
                disabled={currentPageIndex >= pages.length - 1}
                className="p-1 rounded bg-[var(--ui-surface)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] disabled:opacity-30"
                title={t("עמוד הבא")}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Scrollable Page Thumbnails List */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3">
            {pages.map((page, idx) => {
              const isSelected = idx === currentPageIndex;
              const folio = folioLabel(page, layoutType);
              const thumbScale = 0.22;
              const thumbW = Math.round(page.geometry.pageWidth * thumbScale);
              const thumbH = Math.round(page.geometry.pageHeight * thumbScale);
              const mTop = page.geometry.marginTop * thumbScale;
              const mBottom = page.geometry.marginBottom * thumbScale;
              const mInside = page.geometry.marginInside * thumbScale;
              const mOutside = page.geometry.marginOutside * thumbScale;
              const contentW = thumbW - mInside - mOutside;

              return (
                <div
                  key={`thumb-${idx}`}
                  draggable
                  onDragStart={() => setDragFrom(idx)}
                  onDragEnd={() => setDragFrom(null)}
                  onDragOver={e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    if (dragFrom !== null && dragFrom !== idx) onReorderPage(dragFrom, idx);
                    setDragFrom(null);
                  }}
                  onClick={() => onSelectPage(idx)}
                  title={`${t('דף')} ${folio.he} (${folio.latin}) — ${t('גרור לסידור מחדש')}`}
                  className={`group rounded-xl p-3 border transition-all cursor-grab flex flex-col items-center ${
                    isSelected
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] shadow-xs'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]'
                  } ${dragFrom === idx ? 'opacity-50' : ''}`}
                >
                  {/* Top metadata row */}
                  <div className="w-full flex items-center justify-between text-xs mb-2.5 px-0.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-serif font-bold ${
                          isSelected
                            ? 'text-[var(--ui-selected-text)]'
                            : 'text-[var(--ui-text-primary)]'
                        }`}
                      >
                        
                        {t("דף")} {page.pageNumberHebrew}
                      </span>
                      <span className="text-[var(--ui-border-strong)]">·</span>
                      <span className="text-[11px] font-mono text-[var(--ui-text-secondary)]">
                        
                        {t("עמ׳")} {idx + 1} · {folio.latin}
                      </span>
                    </div>
                    {/* v0.9.2 Part B — per-page menu (from PagesPanel): insert / delete. */}
                    <div className="relative">
                      <button
                        type="button"
                        className="w-5 h-5 rounded text-xs hover:bg-[var(--ui-hover)]"
                        onClick={e => {
                          e.stopPropagation();
                          setMenuFor(menuFor === idx ? null : idx);
                        }}
                        title={t('תפריט עמוד')}
                      >
                        ⋯
                      </button>
                      {menuFor === idx && (
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
                              onInsertPage?.(idx);
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
                              onDeletePage?.(idx);
                              setMenuFor(null);
                            }}
                          >
                            {t('מחק עמוד זה')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Miniature Visual Page Sheet Schematic */}
                  <div
                    className={`relative bg-[var(--ui-page-bg)] rounded-xs shadow-xs overflow-hidden border ${
                      isSelected ? 'border-[var(--ui-accent)]' : 'border-[var(--ui-page-border)]'
                    }`}
                    style={{ width: `${thumbW}px`, height: `${thumbH}px` }}
                  >
                    {/* Tiny Running Header */}
                    <div
                      className="absolute border-b border-[#C5B9A5]"
                      style={{
                        top: `${Math.max(2, mTop - 5)}px`,
                        left: `${mInside}px`,
                        width: `${contentW}px`,
                        height: '1px',
                      }}
                    />

                    {/* Render miniature line bars for Source, Rashi, Tosafot, Column2, Footnotes */}
                    {page.sourceLines.map((line, lIdx) => {
                      const y = mTop + line.yBaseline * thumbScale;
                      const w = Math.max(4, line.targetWidth * thumbScale);
                      const contentWidthPt =
                        page.geometry.pageWidth -
                        page.geometry.marginInside -
                        page.geometry.marginOutside;
                      const rightOffsetPt =
                        line.xRight !== undefined
                          ? Math.max(0, contentWidthPt - line.xRight)
                          : layoutType === 'rav_text' || layoutType === 'mikraot_gedolot'
                          ? page.knee.rightCommentaryWidth +
                            page.knee.gutterWidth +
                            (line.xStart ?? 0)
                          : line.xStart ?? 0;
                      const rightPx = mInside + rightOffsetPt * thumbScale;
                      const isHeading =
                        line.role === 'chapter' ||
                        line.role === 'main_title' ||
                        line.role === 'heading';
                      return (
                        <div
                          key={`ts-${lIdx}`}
                          className={`absolute ${
                            isHeading ? 'bg-[#344A67]' : 'bg-[#20242B]/85'
                          }`}
                          style={{
                            top: `${y}px`,
                            right: `${rightPx}px`,
                            width: `${w}px`,
                            height: isHeading ? '2.2px' : '1.5px',
                          }}
                        />
                      );
                    })}

                    {page.rashiLines.map((line, lIdx) => {
                      const y = mTop + line.yBaseline * thumbScale;
                      const w = Math.max(3, line.targetWidth * thumbScale);
                      const contentWidthPt =
                        page.geometry.pageWidth -
                        page.geometry.marginInside -
                        page.geometry.marginOutside;
                      const rightOffsetPt =
                        line.xRight !== undefined
                          ? Math.max(0, contentWidthPt - line.xRight)
                          : line.xStart ?? 0;
                      const rightPx = mInside + rightOffsetPt * thumbScale;
                      return (
                        <div
                          key={`tr-${lIdx}`}
                          className="absolute bg-[#687180]/75"
                          style={{
                            top: `${y}px`,
                            right: `${rightPx}px`,
                            width: `${w}px`,
                            height: '1.1px',
                          }}
                        />
                      );
                    })}

                    {page.tosafotLines.map((line, lIdx) => {
                      const y = mTop + line.yBaseline * thumbScale;
                      const w = Math.max(3, line.targetWidth * thumbScale);
                      const leftPx =
                        line.xLeft !== undefined
                          ? mOutside + line.xLeft * thumbScale
                          : mOutside;
                      return (
                        <div
                          key={`tt-${lIdx}`}
                          className="absolute bg-[#475569]/75"
                          style={{
                            top: `${y}px`,
                            left: `${leftPx}px`,
                            width: `${w}px`,
                            height: '1.1px',
                          }}
                        />
                      );
                    })}

                    {page.column2Lines &&
                      page.column2Lines.map((line, lIdx) => {
                        const y = mTop + line.yBaseline * thumbScale;
                        const w = Math.max(3, line.targetWidth * thumbScale);
                        return (
                          <div
                            key={`tc2-${lIdx}`}
                            className="absolute bg-[#20242B]/80"
                            style={{
                              top: `${y}px`,
                              left: `${mOutside}px`,
                              width: `${w}px`,
                              height: '1.4px',
                            }}
                          />
                        );
                      })}

                    {page.footnoteLines.length > 0 && (
                      <div
                        className="absolute border-t border-[#BFB39F] bg-[#78716C]/20"
                        style={{
                          bottom: `${mBottom}px`,
                          left: `${mInside}px`,
                          width: `${contentW}px`,
                          height: `${Math.min(18, page.footnoteLines.length * 2.2)}px`,
                        }}
                      />
                    )}
                  </div>

                  {/* Line counts summary under thumbnail */}
                  <div className="w-full mt-2.5 flex items-center justify-between text-[10px] text-[var(--ui-text-secondary)] px-0.5">
                    <span>{t("מקור:")} {page.sourceLines.length}  {t("ש׳")}</span>
                    {(page.rashiLines.length > 0 || page.tosafotLines.length > 0) && (
                      <span>
                        
                        {t("רש״י:")} {page.rashiLines.length}  {t("· תוס׳:")} {page.tosafotLines.length}
                      </span>
                    )}
                    {page.column2Lines && page.column2Lines.length > 0 && (
                      <span>{t("טור ב׳:")} {page.column2Lines.length}  {t("ש׳")}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: DOCUMENT SECTIONS & QUICK OUTLINE */}
      {activeTab === 'sections' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="p-3 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)]">
            
            {t("מעבר מהיר לפרקים, סימנים וקטעי מקור בספר:")}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {documentSections.map(sec => {
              const pageIdx = unitToPageMap.get(sec.id) ?? 0;
              const isSelected = selectedUnitId === sec.id;
              const isHeading =
                sec.role === 'chapter' ||
                sec.role === 'main_title' ||
                sec.role === 'siman' ||
                sec.role === 'heading';

              return (
                <button
                  key={sec.id}
                  onClick={() => {
                    onSelectUnit(sec.id);
                    onSelectPage(pageIdx);
                  }}
                  className={`w-full text-start p-2.5 rounded-lg border transition-colors flex flex-col gap-1 ${
                    isSelected
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)]'
                      : isHeading
                      ? 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] hover:border-[var(--ui-border-strong)] text-[var(--ui-accent)]'
                      : 'bg-[var(--ui-surface)] border-[var(--ui-border)] hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-primary)]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-[var(--ui-accent)]">
                      {getSemanticRoleLabel(sec.role as SemanticStyleRole, lang)}
                    </span>
                    <span className="font-mono text-[var(--ui-text-secondary)]">
                      
                      {t("דף")} {pages[pageIdx]?.pageNumberHebrew || t("א")}  {t("(עמ׳")} {pageIdx + 1})
                    </span>
                  </div>
                  <p className="text-xs font-serif line-clamp-2 leading-relaxed">
                    {sec.rawText}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: FULL DOCUMENT HIERARCHY & LINKS */}
      {activeTab === 'hierarchy' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="p-3 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] space-y-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--ui-text-secondary)]">{t("שלמות מבנה:")}</span>
              <span className="text-[var(--ui-success)] font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>{validation.totalUnits}  {t("פסקאות ·")} {links.length}  {t("קישורים")}</span>
              </span>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--ui-text-muted)] absolute inset-s-2.5 top-2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t("חיפוש מילה או דיבור המתחיל...")}
                className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg ps-8 pe-2.5 py-1.5 text-xs text-[var(--ui-text-primary)] placeholder-[var(--ui-text-muted)] focus:outline-none focus:border-[var(--ui-accent)]"
              />
            </div>

            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
            >
              <option value="all">{t("כל תפקידי התוכן (")}{units.length})</option>
              <option value="main_source">{t("טקסט מקור ראשי (גמרא / חומש / שו״ע)")}</option>
              <option value="primary_comment">{t("פירוש ראשי (רש״י / משנה ברורה)")}</option>
              <option value="secondary_comment">{t("פירוש משני (תוספות / ביאור הלכה)")}</option>
              <option value="chapter">{t("פרקים וכותרות")}</option>
              <option value="footnote">{t("הערות שוליים")}</option>
            </select>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 text-xs">
            {filteredUnits.map(unit => {
              const isSelected = selectedUnitId === unit.id;
              const pageIdx = unitToPageMap.get(unit.id);

              return (
                <div
                  key={unit.id}
                  onClick={() => {
                    onSelectUnit(unit.id);
                    if (pageIdx !== undefined) {
                      onSelectPage(pageIdx);
                    }
                  }}
                  className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)]'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] hover:border-[var(--ui-border-strong)] text-[var(--ui-text-primary)]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 text-[10px]">
                    <span className="font-semibold text-[var(--ui-accent)]">
                      {getSemanticRoleLabel(unit.role as SemanticStyleRole, lang)}
                    </span>
                    {pageIdx !== undefined && (
                      <span className="font-mono text-[var(--ui-text-secondary)]">
                        
                        {t("עמ׳")} {pageIdx + 1}
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-[var(--ui-text-primary)] font-serif line-clamp-2 leading-relaxed">
                    {unit.rawText}
                  </p>

                  {unit.dibburHamatchil && (
                    <div className="mt-1.5 pt-1.5 border-t border-[var(--ui-border)] flex items-center gap-1.5 text-[10px] text-[var(--ui-accent)]">
                      <Link2 className="w-3 h-3 shrink-0" />
                      <span>{t("ד״ה:")}</span>
                      <span className="font-serif font-bold truncate">
                        &quot;{unit.dibburHamatchil}&quot;
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};
