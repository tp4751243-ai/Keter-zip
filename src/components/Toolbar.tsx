import React, { useState, useRef, useEffect } from 'react';
import {
  ZoomIn,
  ZoomOut,
  FileDown,
  Upload,
  Eye,
  Sliders,
  Edit3,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Columns,
  SplitSquareVertical,
  Scroll,
  Crown,
  Printer,
  ChevronDown,
  Type,
  Undo2,
  Redo2,
  PanelRight,
  PanelLeft,
  Layers,
} from 'lucide-react';
import { BookLayoutType } from '../types/typesetter';
import { useLanguage } from '../i18n/LanguageContext';

interface ToolbarProps {
  layoutType: BookLayoutType;
  onLayoutTypeChange: (type: BookLayoutType) => void;
  currentPage: number; // 1-indexed
  totalPages: number;
  onPageChange: (newPage: number) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
  showBaselines: boolean;
  onToggleBaselines: () => void;
  showAnchors: boolean;
  onToggleAnchors: () => void;
  showKneeGuide: boolean;
  onToggleKneeGuide: () => void;
  showLinks: boolean;
  onToggleLinks: () => void;
  onOpenDocx: () => void;
  onOpenContentEditor: () => void;
  onOpenFontScanner?: () => void;
  onExportPdf: (allPages: boolean) => void;
  onExportIdml: (
    stage?:
      | 'test_a_minimal'
      | 'test_b_styled_lines'
      | 'test_c_rav_text'
      | 'test_d_multi_page'
      | 'test_e_full'
      | 'test_f_true_rav_text_flow'
  ) => void;
  onOpenKneeInspector: () => void;
  onOpenRulesEngine?: () => void;
  onOpenHierarchy: () => void;
  onToggleNavigator?: () => void;
  isNavigatorOpen?: boolean;
  onToggleDesignPanel?: () => void;
  isDesignPanelOpen?: boolean;
  isExportingPdf?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  layoutType,
  onLayoutTypeChange,
  currentPage,
  totalPages,
  onPageChange,
  zoom,
  onZoomChange,
  showBaselines,
  onToggleBaselines,
  showKneeGuide,
  onToggleKneeGuide,
  onOpenDocx,
  onOpenContentEditor,
  onOpenFontScanner,
  onExportPdf,
  onExportIdml,
  onOpenKneeInspector,
  onOpenRulesEngine,
  onToggleNavigator,
  isNavigatorOpen = true,
  onToggleDesignPanel,
  isDesignPanelOpen = true,
  isExportingPdf = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  undoLabel,
  redoLabel,
}) => {
  const { t, dir } = useLanguage();
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [showIdmlMenu, setShowIdmlMenu] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);
  const idmlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (pdfRef.current && !pdfRef.current.contains(e.target as Node)) {
        setShowPdfMenu(false);
      }
      if (idmlRef.current && !idmlRef.current.contains(e.target as Node)) {
        setShowIdmlMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <div
      dir={dir}
      className="h-12 bg-[#111826] border-b border-slate-800/90 flex items-center justify-between px-4 text-xs text-slate-300 select-none relative z-20 shrink-0 gap-3"
    >
      {/* 1. Right Zone (RTL Start): Navigator Toggle + Book Layout Paradigm Switcher */}
      <div className="flex items-center gap-2.5 min-w-0">
        {onToggleNavigator && (
          <button
            onClick={onToggleNavigator}
            className={`p-2 rounded-lg border transition-colors ${
              isNavigatorOpen
                ? 'bg-[#D4AF37]/15 text-[#E6C665] border-[#D4AF37]/40'
                : 'bg-[#0B0F17] text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title={t("הצג/הסתר חלונית עמודים ומבנה ספר")}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        )}

        {/* Segmented Layout Paradigm Bar */}
        <div className="flex items-center gap-1 bg-[#0B0F17] p-1 rounded-lg border border-slate-800/90">
          <button
            onClick={() => onLayoutTypeChange('rav_text')}
            title={t("רב-טקסט ש״ס וילנא (גמרא במרכז, רש״י ותוספות עם ברכיים דינמיות)")}
            className={`px-2.5 py-1 rounded-md text-xs transition-all flex items-center gap-1.5 whitespace-nowrap ${
              layoutType === 'rav_text'
                ? 'bg-[#D4AF37] text-[#0B0F17] font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>{t("ש״ס וילנא")}</span>
          </button>

          <button
            onClick={() => onLayoutTypeChange('mikraot_gedolot')}
            title={t("מקראות גדולות (חומש, תרגום אונקלוס ומפרשים עם טעמים)")}
            className={`px-2.5 py-1 rounded-md text-xs transition-all flex items-center gap-1.5 whitespace-nowrap ${
              layoutType === 'mikraot_gedolot'
                ? 'bg-[#D4AF37] text-[#0B0F17] font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Crown className="w-3.5 h-3.5" />
            <span>{t("מקראות גדולות")}</span>
          </button>

          <button
            onClick={() => onLayoutTypeChange('source_top_commentary_bottom')}
            title={t("מקור למעלה וביאור למטה (משנה ברורה / רמב״ם ונושאי כלים)")}
            className={`px-2.5 py-1 rounded-md text-xs transition-all flex items-center gap-1.5 whitespace-nowrap ${
              layoutType === 'source_top_commentary_bottom'
                ? 'bg-[#D4AF37] text-[#0B0F17] font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <SplitSquareVertical className="w-3.5 h-3.5" />
            <span>{t("מקור וביאור")}</span>
          </button>

          <button
            onClick={() => onLayoutTypeChange('two_column')}
            title={t("שני טורים (שולחן ערוך, סידור, משניות, שו״ת)")}
            className={`px-2.5 py-1 rounded-md text-xs transition-all flex items-center gap-1.5 whitespace-nowrap ${
              layoutType === 'two_column'
                ? 'bg-[#D4AF37] text-[#0B0F17] font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>{t("שני טורים")}</span>
          </button>

          <button
            onClick={() => onLayoutTypeChange('single_column')}
            title={t("טקסט רץ רגיל (עמודה אחת מלאה עם הערות שוליים)")}
            className={`px-2.5 py-1 rounded-md text-xs transition-all flex items-center gap-1.5 whitespace-nowrap ${
              layoutType === 'single_column'
                ? 'bg-[#D4AF37] text-[#0B0F17] font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Scroll className="w-3.5 h-3.5" />
            <span>{t("טקסט רץ")}</span>
          </button>
        </div>

        <div className="h-5 w-px bg-slate-800 mx-0.5" />

        {/* Content & Typography Quick Studio Buttons */}
        <button
          onClick={onOpenContentEditor}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#192338] hover:bg-slate-800 text-slate-100 font-medium text-xs transition-colors border border-slate-700/80 whitespace-nowrap"
          title={t("ערוך את הטקסטים והמילים של המסמך (מקור, מפרשים, הערות)")}
        >
          <Edit3 className="w-3.5 h-3.5 text-[#D4AF37]" />
          <span>{t("עריכת תוכן")}</span>
        </button>

        <button
          onClick={onOpenDocx}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#192338] hover:bg-slate-800 text-slate-200 border border-slate-700/80 text-xs transition-colors whitespace-nowrap"
          title={t("ייבוא קובצי Microsoft Word (DOCX)")}
        >
          <Upload className="w-3.5 h-3.5 text-sky-400" />
          <span>{t("ייבוא DOCX")}</span>
        </button>

        {onOpenFontScanner && (
          <button
            onClick={onOpenFontScanner}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0B0F17] hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs transition-colors whitespace-nowrap"
            title={t("בחירת גופנים ובדיקת תאימות ניקוד וטעמים")}
          >
            <Type className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>{t("גופנים")}</span>
          </button>
        )}

        {(layoutType === 'rav_text' || layoutType === 'mikraot_gedolot') && (
          <button
            onClick={onOpenKneeInspector}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0B0F17] hover:bg-slate-800 text-[#E6C665] border border-slate-800 text-xs transition-colors whitespace-nowrap"
            title={t("כוונון צומת ברך, עומק מדרגה ורווחי עמודות")}
          >
            <Layers className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>{t("ברכיים")}</span>
          </button>
        )}

        {onOpenRulesEngine && (
          <button
            onClick={onOpenRulesEngine}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0B0F17] hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs transition-colors whitespace-nowrap"
            title={t("חוקי עימוד ואילוצי מערכת")}
          >
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t("חוקי עימוד")}</span>
          </button>
        )}
      </div>

      {/* 2. Center Zone: Undo/Redo & Page Stepper */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 bg-[#0B0F17] p-1 rounded-lg border border-slate-800">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1 rounded text-slate-300 hover:text-[#E6C665] hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
            title={undoLabel ? `ביטול: ${undoLabel} (Ctrl+Z)` : t("ביטול פעולה (Ctrl+Z)")}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1 rounded text-slate-300 hover:text-[#E6C665] hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
            title={redoLabel ? `ביצוע מחדש: ${redoLabel} (Ctrl+Y)` : t("ביצוע מחדש (Ctrl+Y)")}
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 bg-[#0B0F17] px-2.5 py-1 rounded-lg border border-slate-800">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="p-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30"
            title={t("עמוד קודם (PageUp)")}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs font-medium text-slate-200 whitespace-nowrap">
            
            {t("עמ׳")} <span className="text-[#E6C665] font-mono font-bold">{currentPage}</span>  {t("מתוך")}{' '}
            <span className="text-slate-400 font-mono">{totalPages}</span>
          </span>

          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="p-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30"
            title={t("עמוד הבא (PageDown)")}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 3. Left Zone (RTL End): Zoom, Guides, Export PDF/IDML & Inspector Toggle */}
      <div className="flex items-center gap-2">
        {/* Zoom Controls (LTR numeric orientation) */}
        <div
          dir="ltr"
          className="flex items-center gap-0.5 bg-[#0B0F17] p-1 rounded-lg border border-slate-800"
        >
          <button
            onClick={() => onZoomChange(Math.max(0.4, Number((zoom - 0.1).toFixed(2))))}
            className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
            title={t("הקטן תצוגה")}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono w-12 text-center text-slate-200">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => onZoomChange(Math.min(2.0, Number((zoom + 0.1).toFixed(2))))}
            className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
            title={t("הגדל תצוגה")}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Margin & Knee Guide Toggles */}
        <button
          onClick={onToggleBaselines}
          className={`p-2 rounded-lg border transition-colors ${
            showBaselines
              ? 'bg-[#D4AF37]/15 text-[#E6C665] border-[#D4AF37]/40'
              : 'bg-[#0B0F17] text-slate-400 border-slate-800 hover:text-slate-200'
          }`}
          title={t("הצג/הסתר קווי שוליים וגבולות עמוד")}
        >
          <Eye className="w-3.5 h-3.5" />
        </button>

        {(layoutType === 'rav_text' || layoutType === 'mikraot_gedolot') && (
          <button
            onClick={onToggleKneeGuide}
            className={`p-2 rounded-lg border transition-colors ${
              showKneeGuide
                ? 'bg-[#D4AF37]/15 text-[#E6C665] border-[#D4AF37]/40'
                : 'bg-[#0B0F17] text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title={t("הצג/הסתר מתאר גזרות וברכיים על גבי העמוד")}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Export IDML Dropdown */}
        <div className="relative" ref={idmlRef}>
          <button
            onClick={() => setShowIdmlMenu(!showIdmlMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#192338] hover:bg-slate-800 text-slate-200 border border-slate-700/80 text-xs transition-colors whitespace-nowrap"
            title={t("ייצא חבילת Adobe InDesign (IDML)")}
          >
            <FileDown className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>{t("ייצוא IDML")}</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {showIdmlMenu && (
            <div className="absolute left-0 mt-1.5 w-76 bg-[#131B2B] border border-slate-700 shadow-2xl rounded-lg py-1.5 z-50 text-slate-200 text-xs">
              <button
                onClick={() => {
                  setShowIdmlMenu(false);
                  onExportIdml('test_f_true_rav_text_flow');
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between font-semibold text-[#E6C665]"
              >
                <span>{t("חבילת IDML מלאה — זרימת רב-טקסט (")}{totalPages}  {t("עמ׳)")}</span>
                <span className="text-[10px] text-slate-400 font-mono">InDesign</span>
              </button>
              <div className="h-px bg-slate-800 my-1" />
              <div className="px-3.5 py-1 text-[10px] text-slate-400">
                
                {t("תבניות בדיקה ותאימות InDesign:")}
              </div>
              <button
                onClick={() => {
                  setShowIdmlMenu(false);
                  onExportIdml('test_a_minimal');
                }}
                className="w-full text-right px-3.5 py-1.5 hover:bg-slate-800/80 flex items-center justify-between text-slate-300"
              >
                <span>{t("תבנית א׳: מסגרת טקסט בסיסית (מסכת ברכות)")}</span>
                <span className="text-[10px] text-slate-500 font-mono">1 Frame</span>
              </button>
              <button
                onClick={() => {
                  setShowIdmlMenu(false);
                  onExportIdml('test_b_styled_lines');
                }}
                className="w-full text-right px-3.5 py-1.5 hover:bg-slate-800/80 flex items-center justify-between text-slate-300"
              >
                <span>{t("תבנית ב׳: עמוד מקור עם הדגשת דיבור המתחיל")}</span>
                <span className="text-[10px] text-slate-500 font-mono">Styled</span>
              </button>
              <button
                onClick={() => {
                  setShowIdmlMenu(false);
                  onExportIdml('test_c_rav_text');
                }}
                className="w-full text-right px-3.5 py-1.5 hover:bg-slate-800/80 flex items-center justify-between text-slate-300"
              >
                <span>{t("תבנית ג׳: עמוד רב-טקסט משולש (3 מסגרות)")}</span>
                <span className="text-[10px] text-slate-500 font-mono">3 Frames</span>
              </button>
              <button
                onClick={() => {
                  setShowIdmlMenu(false);
                  onExportIdml('test_d_multi_page');
                }}
                className="w-full text-right px-3.5 py-1.5 hover:bg-slate-800/80 flex items-center justify-between text-slate-300"
              >
                <span>{t("תבנית ד׳: זרימה רב-עמודית משורשרת")}</span>
                <span className="text-[10px] text-slate-500 font-mono">Threaded</span>
              </button>
            </div>
          )}
        </div>

        {/* Primary Action: Export PDF with Dropdown */}
        <div className="relative" ref={pdfRef}>
          <button
            onClick={() => setShowPdfMenu(!showPdfMenu)}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#D4AF37] hover:bg-[#E6C665] text-[#0B0F17] font-bold text-xs shadow-sm transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isExportingPdf ? t("מפיק PDF...") : t("ייצוא PDF לדפוס")}</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {showPdfMenu && (
            <div className="absolute left-0 mt-1.5 w-60 bg-[#131B2B] border border-slate-700 rounded-lg shadow-2xl py-1.5 z-50 text-slate-200 text-xs">
              <button
                onClick={() => {
                  setShowPdfMenu(false);
                  onExportPdf(true);
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between font-medium"
              >
                <span>{t("הפקת הספר המלא (")}{totalPages}  {t("עמ׳)")}</span>
                <span className="text-[10px] text-[#E6C665] font-mono">300 DPI</span>
              </button>
              <button
                onClick={() => {
                  setShowPdfMenu(false);
                  onExportPdf(false);
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between border-t border-slate-800"
              >
                <span>{t("הפקת העמוד הנוכחי (עמ׳")} {currentPage})</span>
                <span className="text-[10px] text-slate-400 font-mono">{t("עמוד 1")}</span>
              </button>
            </div>
          )}
        </div>

        <div className="h-5 w-px bg-slate-800 mx-0.5" />

        {/* Toggle Right Inspector Dock */}
        {onToggleDesignPanel && (
          <button
            onClick={onToggleDesignPanel}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors whitespace-nowrap ${
              isDesignPanelOpen
                ? 'bg-[#D4AF37]/15 text-[#E6C665] border-[#D4AF37]/40 font-semibold'
                : 'bg-[#0B0F17] text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title={t("הצג/הסתר מפקח עיצוב, ברכיים ועוזר AI")}
          >
            <PanelLeft className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>{t("עיצוב")}</span>
          </button>
        )}
      </div>
    </div>
  );
};
