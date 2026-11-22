import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Download,
  CheckCircle2,
  Cpu,
  Layers,
  Sparkles,
  Search,
  BookMarked,
  FileCode2,
  Network,
  Undo2,
  Redo2,
  Eye,
  Save,
  FolderOpen,
  ZoomIn,
  PanelRight,
  PanelLeft,
  Sliders,
  FilePlus2,
  KeyRound,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface MenuBarProps {
  onNewProject?: () => void;
  onOpenDocx: () => void;
  onOpenContentEditor?: () => void;
  onSaveProjectFile?: () => void;
  onLoadProjectFile?: () => void;
  onOpenLicense?: () => void;
  onExportPdf: () => void;
  onExportIdml: () => void;
  onRunQa: () => void;
  onOpenFontInspector: () => void;
  onOpenKneeInspector: () => void;
  onOpenRulesEngine?: () => void;
  onOpenHierarchy: () => void;
  onOpenTests: () => void;
  onOpenReport: () => void;
  onToggleAi: () => void;
  isAiOpen: boolean;
  onToggleNavigator?: () => void;
  isNavigatorOpen?: boolean;
  onToggleDesignPanel?: () => void;
  isDesignPanelOpen?: boolean;
  showBaselines?: boolean;
  onToggleBaselines?: () => void;
  showKneeGuide?: boolean;
  onToggleKneeGuide?: () => void;
  onZoomChange?: (zoom: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  onNewProject,
  onOpenDocx,
  onOpenContentEditor,
  onSaveProjectFile,
  onLoadProjectFile,
  onOpenLicense,
  onExportPdf,
  onExportIdml,
  onRunQa,
  onOpenFontInspector,
  onOpenKneeInspector,
  onOpenRulesEngine,
  onOpenHierarchy,
  onOpenTests,
  onOpenReport,
  onToggleAi,
  isAiOpen,
  onToggleNavigator,
  isNavigatorOpen = true,
  onToggleDesignPanel,
  isDesignPanelOpen = true,
  showBaselines = true,
  onToggleBaselines,
  showKneeGuide = true,
  onToggleKneeGuide,
  onZoomChange,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  undoLabel,
  redoLabel,
}) => {
  const { t, dir } = useLanguage();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const closeMenu = () => setActiveMenu(null);

  return (
    <nav
      ref={menuBarRef}
      dir={dir}
      className="h-8 bg-[#0E1420] border-b border-slate-800/80 flex items-center px-3 text-xs text-slate-300 relative z-30 select-none shrink-0 gap-1"
    >
      {/* 1. קובץ (File) */}
      <div className="relative">
        <button
          onClick={() => toggle('file')}
          className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap ${
            activeMenu === 'file'
              ? 'bg-slate-800 text-[#E6C665] font-medium'
              : 'hover:bg-slate-800/60 hover:text-slate-100'
          }`}
        >
          
          {t("קובץ")}
        </button>
        {activeMenu === 'file' && (
          <div className="absolute top-full right-0 w-68 bg-[#131B2B] border border-slate-700/90 shadow-2xl rounded-lg py-1.5 mt-1 text-slate-200 z-50">
            {onNewProject && (
              <button
                onClick={() => {
                  onNewProject();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs text-slate-100 font-medium"
              >
                <div className="flex items-center gap-2.5">
                  <FilePlus2 className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>{t("פרויקט ספר חדש...")}</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono" dir="ltr">
                  Ctrl+N
                </span>
              </button>
            )}
            {onOpenContentEditor && (
              <button
                onClick={() => {
                  onOpenContentEditor();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs text-[#E6C665]"
              >
                <div className="flex items-center gap-2.5">
                  <FileText className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>{t("עריכת תוכן והזנת טקסטים...")}</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono" dir="ltr">
                  Ctrl+T
                </span>
              </button>
            )}
            <button
              onClick={() => {
                onOpenDocx();
                closeMenu();
              }}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-3.5 h-3.5 text-sky-400" />
                <span>{t("ייבוא מסמך Word (DOCX)...")}</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono" dir="ltr">
                Ctrl+O
              </span>
            </button>

            <div className="h-px bg-slate-800 my-1.5" />

            {onSaveProjectFile && (
              <button
                onClick={() => {
                  onSaveProjectFile();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <Save className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>{t("שמירת פרויקט כתר (.keter.json)")}</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono" dir="ltr">
                  Ctrl+S
                </span>
              </button>
            )}
            {onLoadProjectFile && (
              <button
                onClick={() => {
                  onLoadProjectFile();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                  <span>{t("פתיחת קובץ פרויקט (.keter.json)...")}</span>
                </div>
              </button>
            )}

            <div className="h-px bg-slate-800 my-1.5" />

            <button
              onClick={() => {
                onExportPdf();
                closeMenu();
              }}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2.5">
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t("ייצוא PDF לדפוס (300 DPI)")}</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono" dir="ltr">
                Ctrl+P
              </span>
            </button>
            <button
              onClick={() => {
                onExportIdml();
                closeMenu();
              }}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2.5">
                <FileCode2 className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>{t("ייצוא חבילת Adobe InDesign (IDML)")}</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono" dir="ltr">
                Ctrl+E
              </span>
            </button>
          </div>
        )}
      </div>

      {/* 2. עריכה (Edit) */}
      <div className="relative">
        <button
          onClick={() => toggle('edit')}
          className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap ${
            activeMenu === 'edit'
              ? 'bg-slate-800 text-[#E6C665] font-medium'
              : 'hover:bg-slate-800/60 hover:text-slate-100'
          }`}
        >
          
          {t("עריכה")}
        </button>
        {activeMenu === 'edit' && (
          <div className="absolute top-full right-0 w-72 bg-[#131B2B] border border-slate-700/90 shadow-2xl rounded-lg py-1.5 mt-1 text-slate-200 z-50">
            <button
              onClick={() => {
                if (canUndo && onUndo) onUndo();
                closeMenu();
              }}
              disabled={!canUndo}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2.5 truncate">
                <Undo2 className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                <span className="truncate">
                  {undoLabel ? `ביטול: ${undoLabel}` : t("ביטול פעולה אחרונה")}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono shrink-0" dir="ltr">
                Ctrl+Z
              </span>
            </button>
            <button
              onClick={() => {
                if (canRedo && onRedo) onRedo();
                closeMenu();
              }}
              disabled={!canRedo}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2.5 truncate">
                <Redo2 className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                <span className="truncate">
                  {redoLabel ? `ביצוע מחדש: ${redoLabel}` : t("ביצוע מחדש")}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono shrink-0" dir="ltr">
                Ctrl+Y
              </span>
            </button>
            {onOpenContentEditor && (
              <>
                <div className="h-px bg-slate-800 my-1.5" />
                <button
                  onClick={() => {
                    onOpenContentEditor();
                    closeMenu();
                  }}
                  className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t("עורך יחידות תוכן וטקסטים...")}</span>
                  </div>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 3. תצוגה (View) */}
      <div className="relative">
        <button
          onClick={() => toggle('view')}
          className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap ${
            activeMenu === 'view'
              ? 'bg-slate-800 text-[#E6C665] font-medium'
              : 'hover:bg-slate-800/60 hover:text-slate-100'
          }`}
        >
          
          {t("תצוגה")}
        </button>
        {activeMenu === 'view' && (
          <div className="absolute top-full right-0 w-68 bg-[#131B2B] border border-slate-700/90 shadow-2xl rounded-lg py-1.5 mt-1 text-slate-200 z-50">
            {onToggleNavigator && (
              <button
                onClick={() => {
                  onToggleNavigator();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <PanelRight className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>{t("חלונית ניווט עמודים ומבנה ספר")}</span>
                </div>
                <span className="text-[10px] text-[#E6C665]">
                  {isNavigatorOpen ? t("פעיל") : t("מוסתר")}
                </span>
              </button>
            )}
            {onToggleDesignPanel && (
              <button
                onClick={() => {
                  onToggleDesignPanel();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <PanelLeft className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>{t("מפקח עיצוב וטיפוגרפיה")}</span>
                </div>
                <span className="text-[10px] text-[#E6C665]">
                  {isDesignPanelOpen ? t("פעיל") : t("מוסתר")}
                </span>
              </button>
            )}
            <div className="h-px bg-slate-800 my-1.5" />
            {onToggleBaselines && (
              <button
                onClick={() => {
                  onToggleBaselines();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <Eye className="w-3.5 h-3.5 text-slate-400" />
                  <span>{t("קווי שוליים וגבולות דפוס")}</span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {showBaselines ? t("מוצג") : t("מוסתר")}
                </span>
              </button>
            )}
            {onToggleKneeGuide && (
              <button
                onClick={() => {
                  onToggleKneeGuide();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <Layers className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>{t("מתאר ברכיים וגזרות רב-טקסט")}</span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {showKneeGuide ? t("מוצג") : t("מוסתר")}
                </span>
              </button>
            )}
            {onZoomChange && (
              <>
                <div className="h-px bg-slate-800 my-1.5" />
                <button
                  onClick={() => {
                    onZoomChange(1.0);
                    closeMenu();
                  }}
                  className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <ZoomIn className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t("מרחק תצוגה 100% (גודל דפוס)")}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">100%</span>
                </button>
                <button
                  onClick={() => {
                    onZoomChange(1.25);
                    closeMenu();
                  }}
                  className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <ZoomIn className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t("תקריב הגהה וניקוד (125%)")}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">125%</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 4. עימוד וברכיים (Layout & Knees) */}
      <div className="relative">
        <button
          onClick={() => toggle('layout')}
          className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap ${
            activeMenu === 'layout'
              ? 'bg-slate-800 text-[#E6C665] font-medium'
              : 'hover:bg-slate-800/60 hover:text-slate-100'
          }`}
        >
          
          {t("עימוד ורב-טקסט")}
        </button>
        {activeMenu === 'layout' && (
          <div className="absolute top-full right-0 w-72 bg-[#131B2B] border border-slate-700/90 shadow-2xl rounded-lg py-1.5 mt-1 text-slate-200 z-50">
            <button
              onClick={() => {
                onOpenKneeInspector();
                closeMenu();
              }}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center gap-2.5 text-xs"
            >
              <Layers className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>{t("כוונון ברכיים דינמיות ומדרגות עמוד")}</span>
            </button>
            {onOpenRulesEngine && (
              <button
                onClick={() => {
                  onOpenRulesEngine();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center gap-2.5 text-xs text-[#E6C665]"
              >
                <Sliders className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>{t("חוקי עימוד ואילוצי מערכת...")}</span>
              </button>
            )}
            <button
              onClick={() => {
                onOpenHierarchy();
                closeMenu();
              }}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center gap-2.5 text-xs"
            >
              <Network className="w-3.5 h-3.5 text-sky-400" />
              <span>{t("מבנה הספר וקישורי דיבור המתחיל")}</span>
            </button>
            <button
              onClick={() => {
                onRunQa();
                closeMenu();
              }}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center gap-2.5 text-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t("בדיקת תקינות ספר (Preflight QA)")}</span>
            </button>
          </div>
        )}
      </div>

      {/* 5. גופנים וטיפוגרפיה (Typography) */}
      <div className="relative">
        <button
          onClick={() => toggle('typography')}
          className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap ${
            activeMenu === 'typography'
              ? 'bg-slate-800 text-[#E6C665] font-medium'
              : 'hover:bg-slate-800/60 hover:text-slate-100'
          }`}
        >
          
          {t("טיפוגרפיה וגופנים")}
        </button>
        {activeMenu === 'typography' && (
          <div className="absolute top-full right-0 w-68 bg-[#131B2B] border border-slate-700/90 shadow-2xl rounded-lg py-1.5 mt-1 text-slate-200 z-50">
            <button
              onClick={() => {
                onOpenFontInspector();
                closeMenu();
              }}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center gap-2.5 text-xs"
            >
              <Search className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>{t("ספריית גופנים ובדיקת תאימות ניקוד וטעמים...")}</span>
            </button>
            {onToggleDesignPanel && (
              <button
                onClick={() => {
                  if (!isDesignPanelOpen) onToggleDesignPanel();
                  closeMenu();
                }}
                className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center gap-2.5 text-xs"
              >
                <Sliders className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>{t("מפקח סגנונות תו, פסקה וירושה")}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 6. כלים ורישוי (Tools & License) */}
      <div className="relative">
        <button
          onClick={() => toggle('diagnostics')}
          className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap ${
            activeMenu === 'diagnostics'
              ? 'bg-slate-800 text-[#E6C665] font-medium'
              : 'hover:bg-slate-800/60 hover:text-slate-100'
          }`}
        >
          
          {t("כלים ורישוי")}
        </button>
        {activeMenu === 'diagnostics' && (
          <div className="absolute top-full right-0 w-68 bg-[#131B2B] border border-slate-700/90 shadow-2xl rounded-lg py-1.5 mt-1 text-slate-200 z-50">
            <button
              onClick={() => {
                onOpenTests();
                closeMenu();
              }}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center gap-2.5 text-xs"
            >
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t("בדיקות מערכת ואימות מנוע (QA Suite)...")}</span>
            </button>
            <button
              onClick={() => {
                onOpenReport();
                closeMenu();
              }}
              className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center gap-2.5 text-xs"
            >
              <BookMarked className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>{t("מפרט ארכיטקטורה ודוח מערכת...")}</span>
            </button>
            {onOpenLicense && (
              <>
                <div className="h-px bg-slate-800 my-1.5" />
                <button
                  onClick={() => {
                    onOpenLicense();
                    closeMenu();
                  }}
                  className="w-full text-right px-3.5 py-2 hover:bg-slate-800/80 flex items-center gap-2.5 text-xs text-[#E6C665]"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>{t("רישוי מסחרי והפעלת מחשב...")}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Docked AI Assistant Toggle */}
      <button
        onClick={onToggleAi}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${
          isAiOpen
            ? 'bg-[#D4AF37]/20 text-[#E6C665] border border-[#D4AF37]/40 font-medium'
            : 'hover:bg-slate-800/60 text-slate-300'
        }`}
        title={t("פתח/סגור את עוזר העימוד החכם בחלונית הצד")}
      >
        <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
        <span>{t("עוזר עימוד חכם")}</span>
      </button>
    </nav>
  );
};
