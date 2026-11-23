import React, { useState, useRef, useEffect } from 'react';
import {
  Crown,
  BookOpen,
  Sliders,
  Sparkles,
  Download,
  Undo2,
  Redo2,
  FolderOpen,
  FilePlus2,
  Save,
  FileText,
  FileCode2,
  ShieldCheck,
  KeyRound,
  Cpu,
  Edit3,
  ChevronDown,
  Columns,
  SplitSquareVertical,
  Scroll,
  FileUp,
  Sun,
  Moon,
  Home,
  Languages,
  HelpCircle,
  LayoutTemplate,
} from 'lucide-react';
import { BookLayoutType, ContentUnit, RavTextLink } from '../types/typesetter';
import { UiLanguage, useLanguage } from '../i18n/LanguageContext';
import { SecondaryDocxImportModal } from './SecondaryDocxImportModal';
import { LAYOUT_PRESET_OPTIONS } from '../engine/layout-presets';

export type UiThemeMode = 'day' | 'night';
export type PrimaryWorkMode = 'home' | 'edit' | 'export';

interface EditorialStudioHeaderProps {
  activeWorkMode: PrimaryWorkMode;
  onWorkModeChange: (mode: PrimaryWorkMode) => void;
  documentTitle: string;
  isModified?: boolean;
  layoutType: BookLayoutType;
  onLayoutTypeChange: (layout: BookLayoutType) => void;
  /** v0.9.9 — resolved display name for the layout button (e.g. "Vilna
      Shas" when a recipe is applied; falls back to the layout-type label
      when absent). Computed by the parent via layoutDisplayLabel. */
  layoutDisplayName?: string;
  currentPage: number;
  totalPages: number;
  currentPageHebrew: string;
  isNavigatorOpen: boolean;
  onToggleNavigator: () => void;
  isInspectorOpen: boolean;
  onToggleInspector: () => void;
  isAiDrawerOpen: boolean;
  onToggleAiDrawer: () => void;
  onNewProject: () => void;
  onOpenDocx: () => void;
  onOpenContentEditor: () => void;
  onSaveProjectFile: () => void;
  onLoadProjectFile: () => void;
  isExportingPdf?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoLabel?: string;
  redoLabel?: string;
  onOpenFontScanner: () => void;
  onOpenRulesModal: () => void;
  onOpenTests: () => void;
  onOpenReport: () => void;
  onOpenWelcome: () => void;
  /** v0.9.8 Phase 1 — Developer Mode. When false (default) the
      "developer tools" section below is hidden; the toggle itself is
      always visible (discreet, at the bottom of this menu). */
  developerMode?: boolean;
  onToggleDeveloperMode?: () => void;
  showBaselines: boolean;
  onToggleBaselines: () => void;
  uiTheme: UiThemeMode;
  onToggleUiTheme: () => void;
  uiLang: UiLanguage;
  onToggleUiLang: () => void;
  onOpenGeminiKey: () => void;
  // v0.6.0 Part A (§10) — Layout & Design group: switch to the custom
  // layout / open the title-page tab. Optional: the buttons hide when the
  // parent does not provide them, so the header never shows a dead button.
  onOpenCustomLayout?: () => void;
  onOpenTitlePage?: () => void;
  // --- v0.5.0 Part C — Module 7 (Secondary Document Import) ----------------
  // Two wiring options (see REPORT.md for the App.tsx snippet):
  //  a) pass `secondaryImportUnits` + `secondaryImportLinks` +
  //     `onMergeSecondaryImport` — the header opens the modal itself and
  //     merges without resetting the project; or
  //  b) pass `onImportSecondaryDocument` — the parent opens the modal.
  // The button is hidden until one of them is provided, so the header
  // compiles unchanged in the existing App.
  onImportSecondaryDocument?: () => void;
  secondaryImportUnits?: ContentUnit[];
  secondaryImportLinks?: RavTextLink[];
  onMergeSecondaryImport?: (units: ContentUnit[], links: RavTextLink[]) => void;
}

/**
 * v0.9.2 Part B — the layout NAMES come from the one shared list in
 * engine/layout-presets.ts (same list the New Project modal and the
 * auto-layout banner render). Only the icons live here, keyed by id.
 */
const LAYOUT_PRESET_ICONS: Record<BookLayoutType, any> = {
  rav_text: Crown,
  mikraot_gedolot: Scroll,
  source_top_commentary_bottom: SplitSquareVertical,
  two_column: Columns,
  single_column: BookOpen,
  yiddish_sefer: BookOpen,
  custom_layout: LayoutTemplate,
};

export const EditorialStudioHeader: React.FC<EditorialStudioHeaderProps> = ({
  activeWorkMode,
  onWorkModeChange,
  documentTitle,
  isModified = false,
  layoutType,
  onLayoutTypeChange,
  layoutDisplayName,
  currentPage,
  totalPages,
  currentPageHebrew,
  isNavigatorOpen,
  onToggleNavigator,
  isInspectorOpen,
  onToggleInspector,
  isAiDrawerOpen,
  onToggleAiDrawer,
  onNewProject,
  onOpenDocx,
  onOpenContentEditor,
  onSaveProjectFile,
  onLoadProjectFile,
  isExportingPdf = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  undoLabel,
  redoLabel,
  onOpenFontScanner,
  onOpenRulesModal,
  onOpenTests,
  onOpenReport,
  onOpenWelcome,
  developerMode = false,
  onToggleDeveloperMode,
  showBaselines,
  onToggleBaselines,
  uiTheme,
  onToggleUiTheme,
  uiLang,
  onToggleUiLang,
  onOpenGeminiKey,
  onOpenCustomLayout,
  onOpenTitlePage,
  onImportSecondaryDocument,
  secondaryImportUnits,
  secondaryImportLinks,
  onMergeSecondaryImport,
}) => {
  const { t, tf, dir, lang } = useLanguage();
  const [openMenu, setOpenMenu] = useState<'project' | 'layout' | 'more' | null>(null);
  const [isSecondaryImportOpen, setIsSecondaryImportOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // v0.5.0 Part C — Module 7: the header can open the secondary-import
  // modal itself when the parent passes the live units/links + merge
  // callback; otherwise it delegates to the parent's handler.
  const canImportSecondary =
    Boolean(onImportSecondaryDocument) ||
    Boolean(onMergeSecondaryImport && secondaryImportUnits);
  const handleImportSecondaryDocument = () => {
    setOpenMenu(null);
    if (onMergeSecondaryImport && secondaryImportUnits) {
      setIsSecondaryImportOpen(true);
    } else {
      onImportSecondaryDocument?.();
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentLayoutObj =
    LAYOUT_PRESET_OPTIONS.find(l => l.id === layoutType) || LAYOUT_PRESET_OPTIONS[0];
  const CurrentLayoutIcon = LAYOUT_PRESET_ICONS[currentLayoutObj.id];

  const WORK_MODES: Array<{
    id: PrimaryWorkMode;
    labelHe: string;
    labelEn: string;
    subtitleHe: string;
    subtitleEn: string;
    icon: any;
  }> = [
    {
      id: 'home',
      labelHe: 'פתיחת ספר',
      labelEn: 'Open a book',
      subtitleHe: 'פתחו ספר, ייבאו קובץ Word או המשיכו פרויקט קיים',
      subtitleEn: 'Open a book, import a Word file, or continue an existing project',
      icon: Home,
    },
    {
      id: 'edit',
      labelHe: 'עיצוב הספר',
      labelEn: 'Design the book',
      subtitleHe: 'עצבו את מראה העמודים, הגופנים והפריסה',
      subtitleEn: 'Design how the pages, fonts and layout look',
      icon: Edit3,
    },
    {
      id: 'export',
      labelHe: 'ייצוא לדפוס',
      labelEn: 'Export for print',
      subtitleHe: 'בדקו והפיקו קובץ PDF או חבילת InDesign',
      subtitleEn: 'Check and create a PDF file or an InDesign package',
      icon: Download,
    },
  ];

  return (
    <>
    <header
      ref={headerRef}
      dir={dir}
      className="h-12 bg-[var(--ui-surface)] border-b border-[var(--ui-border)] flex items-center justify-between px-4 select-none shrink-0 z-40 transition-colors duration-150"
    >
      {/* RIGHT SECTION: Brand + 3 Primary Work Modes Switcher (כניסה | עריכה | ייצוא) + Document Title */}
      <div className="flex items-center gap-3">
        {/* Keter Brand Identity */}
        <div className="flex items-center gap-2 pe-2 border-e border-[var(--ui-border)]">
          <div className="w-7 h-7 rounded-md bg-[var(--ui-accent)] flex items-center justify-center shadow-2xs">
            <Crown className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold tracking-tight text-[var(--ui-text-primary)] leading-none">
              
              {t("כתר · Keter")}
            </span>
            <span className="text-[9px] text-[var(--ui-text-muted)] font-medium mt-0.5">
              
              {t("אולפן עימוד ספרי קודש")}
            </span>
          </div>
        </div>

        {/* Three Primary Work Modes Switcher: כניסה | עריכה | ייצוא */}
        <div
          role="tablist"
          aria-label={t("מצבי עבודה ראשיים")}
          className="flex items-center bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg p-0.5 gap-0.5"
        >
          {WORK_MODES.map(m => {
            const Icon = m.icon;
            const active = activeWorkMode === m.id;
            return (
              <button
                key={m.id}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setOpenMenu(null);
                  onWorkModeChange(m.id);
                }}
                title={lang === 'en' ? m.subtitleEn : t(m.subtitleHe)}
                className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  active
                    ? 'bg-[var(--ui-accent)] text-white shadow-2xs'
                    : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? m.labelEn : t(m.labelHe)}</span>
              </button>
            );
          })}
        </div>

        {/* Project Menu Dropdown & Active Document Title */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'project' ? null : 'project')}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[var(--ui-surface-hover)] border border-transparent hover:border-[var(--ui-border)] transition-all"
            title={t("תפריט הספר והגדרות")}
          >
            <span className="text-xs font-semibold text-[var(--ui-text-primary)] max-w-[190px] truncate">
              {documentTitle}
            </span>
            {isModified ? (
              <span
                className="w-2 h-2 rounded-full bg-[var(--ui-warning)] shrink-0"
                title={t("שינויים שלא נשמרו לקובץ")}
              />
            ) : (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[var(--ui-success)]/80 shrink-0"
                title={t("הפרויקט שמור")}
              />
            )}
            <ChevronDown className="w-3.5 h-3.5 text-[var(--ui-text-secondary)]" />
          </button>

          {openMenu === 'project' && (
            <div className="absolute inset-s-0 mt-1.5 w-64 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg shadow-[var(--ui-floating-shadow)] py-1.5 z-50 text-xs">
              <div className="px-3 py-1.5 border-b border-[var(--ui-border)] mb-1">
                <span className="text-[10px] font-medium text-[var(--ui-text-muted)] block">
                  
                  {t("הספר הפתוח כעת")}
                </span>
                <span className="font-semibold text-[var(--ui-text-primary)] truncate block mt-0.5">
                  {documentTitle}
                </span>
              </div>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onWorkModeChange('home');
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)] font-medium"
              >
                <Home className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>{t("חזרה למסך פתיחת הספר")}</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onNewProject();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-primary)]"
              >
                <span className="flex items-center gap-2.5">
                  <FilePlus2 className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>{t("פרויקט חדש...")}</span>
                </span>
                <span className="text-[10px] text-[var(--ui-text-muted)] font-mono">Ctrl+N</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenDocx();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-primary)]"
              >
                <span className="flex items-center gap-2.5">
                  <FileUp className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>{t("ייבוא קובצי Word (DOCX)...")}</span>
                </span>
                <span className="text-[10px] text-[var(--ui-text-muted)] font-mono">Ctrl+O</span>
              </button>

              {/* v0.5.0 Part C — Module 7: secondary document into the open book */}
              {canImportSecondary && (
                <button
                  onClick={handleImportSecondaryDocument}
                  className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
                  title={t("מוסיף פירוש או הערות לספר הפתוח — בלי לאפס את העריכות")}
                >
                  <FileUp className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>{t("ייבוא מסמך משני (DOCX)...")}</span>
                </button>
              )}

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenContentEditor();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
              >
                <Edit3 className="w-3.5 h-3.5 text-[var(--ui-text-secondary)]" />
                <span>{t("החלפת כל הטקסט של הספר...")}</span>
              </button>

              <div className="my-1 border-t border-[var(--ui-border)]" />

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onLoadProjectFile();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[var(--ui-text-secondary)]" />
                <span>{t("פתח קובץ פרויקט (.keter)...")}</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onSaveProjectFile();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-primary)]"
              >
                <span className="flex items-center gap-2.5">
                  <Save className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>{t("שמור קובץ פרויקט (.keter)")}</span>
                </span>
                <span className="text-[10px] text-[var(--ui-text-muted)] font-mono">Ctrl+S</span>
              </button>

              <div className="my-1 border-t border-[var(--ui-border)]" />

              <div className="px-3 py-1 text-[10px] font-medium text-[var(--ui-text-muted)]">
                
                {t("תצוגה וכלים")}
              </div>

              <button
                onClick={() => {
                  onToggleBaselines();
                }}
                className="w-full px-3 py-1.5 text-start hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-secondary)]"
              >
                <span>{t("קווי יישור של השורות")}</span>
                <span
                  className={`text-[10px] font-semibold ${
                    showBaselines ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)]'
                  }`}
                >
                  {showBaselines ? t("פעיל") : t("כבוי")}
                </span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenFontScanner();
                }}
                className="w-full px-3 py-1.5 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
              >
                <Cpu className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
                <span>{t("גופנים במחשב")}</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenRulesModal();
                }}
                className="w-full px-3 py-1.5 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
                <span>{t("כללי עימוד — איך הספר מסודר")}</span>
              </button>

              {/* v0.9.8 Phase 1 — Developer Mode OFF hides this whole
                  section (Automated Tests + architecture report). The
                  toggle below stays visible so the mode can be turned
                  back on without a hidden control. */}
              {developerMode && (
                <>
                  <div className="my-1 border-t border-[var(--ui-border)]" />

                  <div className="px-3 py-1 text-[10px] font-medium text-[var(--ui-text-muted)]">
                    {t("כלים למפתחים")}
                  </div>

                  <button
                    onClick={() => {
                      setOpenMenu(null);
                      onOpenTests();
                    }}
                    className="w-full px-3 py-1.5 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--ui-success)]" />
                    <span>{t("בדיקות אוטומטיות (למפתחים)")}</span>
                  </button>

                  <button
                    onClick={() => {
                      setOpenMenu(null);
                      onOpenReport();
                    }}
                    className="w-full px-3 py-1.5 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
                  >
                    <FileText className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
                    <span>{t("דו״ח ארכיטקטורה (למפתחים)")}</span>
                  </button>
                </>
              )}

              <div className="my-1 border-t border-[var(--ui-border)]" />

              {/* v0.9.8 Phase 1 — discreet Developer Mode switch, always
                  visible. Same toggle as Ctrl+Shift+D. */}
              <button
                onClick={() => {
                  onToggleDeveloperMode?.();
                }}
                data-testid="developer-mode-toggle"
                className="w-full px-3 py-1.5 text-start hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-secondary)]"
                title={t("מצב מפתח: הצגת כלי בדיקה ודוחות פנימיים (Ctrl+Shift+D)")}
              >
                <span>{t("מצב מפתח")}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--ui-text-muted)] font-mono">Ctrl+Shift+D</span>
                  <span
                    className={`text-[10px] font-semibold ${
                      developerMode ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)]'
                    }`}
                  >
                    {developerMode ? t("פעיל") : t("כבוי")}
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Layout Template Selector Pill (Shown in Edit / Export modes) */}
        {activeWorkMode !== 'home' && (
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'layout' ? null : 'layout')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs text-[var(--ui-text-primary)] transition-colors"
              title={t("בחרו איך הספר מסודר")}
            >
              <CurrentLayoutIcon className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
              <span className="font-medium">{layoutDisplayName ?? t(currentLayoutObj.labelHe)}</span>
              <ChevronDown className="w-3 h-3 text-[var(--ui-text-secondary)]" />
            </button>

            {openMenu === 'layout' && (
              <div className="absolute inset-s-0 mt-1.5 w-72 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg shadow-[var(--ui-floating-shadow)] py-1.5 z-50 text-xs">
                <div className="px-3 py-1 text-[10px] font-medium text-[var(--ui-text-muted)] border-b border-[var(--ui-border)] mb-1">
                  
                  {t("בחר מתכונת עימוד לספר")}
                </div>
                {LAYOUT_PRESET_OPTIONS.map(preset => {
                  const Icon = LAYOUT_PRESET_ICONS[preset.id];
                  const active = preset.id === layoutType;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setOpenMenu(null);
                        onLayoutTypeChange(preset.id);
                      }}
                      className={`w-full px-3 py-2 text-start flex items-start gap-2.5 transition-colors ${
                        active
                          ? 'bg-[var(--ui-selected-bg)] text-[var(--ui-accent)]'
                          : 'hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-primary)]'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          active ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-secondary)]'
                        }`}
                      />
                      <div>
                        <div className="font-semibold">{lang === 'en' ? preset.labelEn : preset.labelHe}</div>
                        <div className="text-[10px] text-[var(--ui-text-secondary)] leading-snug mt-0.5">
                          {lang === 'en' ? preset.subLabelEn : preset.subLabelHe}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {/* v0.9.2 Part B — the historical library used to be listed
                    here too, a third copy of the list in the Design panel
                    and the New Project modal. One home for it now: the
                    Design panel (עיצוב העמוד → תבניות היסטוריות) applies
                    a recipe to the open book; the New Project modal offers
                    it as the starting template for a new book. This menu
                    keeps only the quick layout-type switch. */}
              </div>
            )}
          </div>
        )}
        {/* v0.6.0 Part A (§10) — Layout & Design group (edit mode only):
            Pages, Page Design, Custom Layout, Shaar Blatt. Separated from
            the Project group by a divider; everything here was a top-level
            button before, only grouped now. */}
        {activeWorkMode === 'edit' && (
          <>
            <div
              className="h-6 w-px bg-[var(--ui-border)] mx-1 shrink-0"
              aria-hidden="true"
            />
            <div role="group" aria-label={t('פריסה ועיצוב')} className="flex items-center gap-1.5">
              <button
                onClick={onToggleNavigator}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-all ${
                  isNavigatorOpen
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)]/35 text-[var(--ui-accent)]'
                    : 'bg-transparent border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                }`}
                title={t('רשימת הדפים של הספר')}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>{t('דפים')}</span>
              </button>

              <button
                onClick={onToggleInspector}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-all ${
                  isInspectorOpen
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)]/35 text-[var(--ui-accent)]'
                    : 'bg-transparent border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                }`}
                title={t('עיצוב העמוד — גופנים, גדלים ופריסה')}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{t('עיצוב העמוד')}</span>
              </button>

              {onOpenCustomLayout && (
                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenCustomLayout();
                  }}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-all ${
                    layoutType === 'custom_layout'
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)]/35 text-[var(--ui-accent)]'
                      : 'bg-transparent border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                  }`}
                  title={t('פריסה מותאמת אישית — מעבר לפריסת תיבות הטקסט שציירתם')}
                >
                  <LayoutTemplate className="w-3.5 h-3.5" />
                  <span>{t('פריסה מותאמת')}</span>
                </button>
              )}

              {onOpenTitlePage && (
                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenTitlePage();
                  }}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border border-transparent bg-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)] transition-all"
                  title={t('עמוד שער — כותרת הספר, פרטים ומסגרת')}
                >
                  <Scroll className="w-3.5 h-3.5" />
                  <span>{t('עמוד שער')}</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* CENTER SECTION: Undo / Redo + Save + Current Folio Badge */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-md p-0.5">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title={
              canUndo
                ? tf('בטל: {label} (Ctrl+Z)', { label: undoLabel || t("פעולה אחרונה") })
                : t("אין פעולות לביטול")
            }
            className="p-1.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title={
              canRedo
                ? tf('בצע מחדש: {label} (Ctrl+Y)', { label: redoLabel || t("פעולה אחרונה") })
                : t("אין פעולות לביצוע מחדש")
            }
            className="p-1.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onClick={onSaveProjectFile}
          title={t("שמור את הספר כקובץ פרויקט (.keter) (Ctrl+S)")}
          className="px-2.5 py-1.5 rounded-md bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-primary)] flex items-center gap-1.5 text-xs font-medium transition-colors"
        >
          <Save className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
          <span>{t("שמור")}</span>
        </button>

        <div className="px-2.5 py-1 rounded-md bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)] flex items-center gap-1.5">
          <span className="font-semibold text-[var(--ui-text-primary)]">
            
            {t("דף")} {currentPageHebrew}
          </span>
          <span className="text-[var(--ui-border-strong)]">·</span>
          <span className="font-mono text-[10px]">
            {currentPage}/{totalPages}
          </span>
        </div>
      </div>

      {/* v0.6.0 Part A (§10) — RIGHT SECTION: Output group + More Actions.
          The AI assistant, secondary import, help, night mode, language
          and AI key used to crowd this row as top-level buttons; they now
          live in the "More Actions" overflow menu — every action is still
          one click away, nothing was removed. */}
      <div className="flex items-center gap-1.5">
        {/* v0.9.2 Part B — one export home: the Export workspace. The
            one-click "ייצוא PDF" button that used to sit here exported
            the same file as the Export workspace's PDF button, through
            the same handler, with no options — so the header keeps only
            "ייצוא לדפוס", which opens that workspace (PDF / IDML / Word
            / EPUB / HTML, all with their options, in one place). */}
        <div role="group" aria-label={t('ייצוא')} className="flex items-center gap-1.5">
          {activeWorkMode !== 'export' && (
            <button
              onClick={() => onWorkModeChange('export')}
              disabled={isExportingPdf}
              className="px-3 py-1.5 rounded-md bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 shadow-2xs transition-colors"
              title={t('עבור למסך הייצוא והפקת הקובץ לדפוס (PDF / InDesign)')}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('ייצוא לדפוס')}</span>
            </button>
          )}
        </div>

        <div
          className="h-6 w-px bg-[var(--ui-border)] mx-1 shrink-0"
          aria-hidden="true"
        />

        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'more' ? null : 'more')}
            aria-expanded={openMenu === 'more'}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-primary)] transition-colors"
            title={t('פעולות נוספות: עוזר AI, מסמך משני, מדריכים ומצב לילה')}
          >
            <span>{t('פעולות נוספות')}</span>
            <ChevronDown className="w-3.5 h-3.5 text-[var(--ui-text-secondary)]" />
          </button>

          {openMenu === 'more' && (
            <div className="absolute inset-e-0 mt-1.5 w-64 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg shadow-[var(--ui-floating-shadow)] py-1.5 z-50 text-xs">
              <button
                onClick={() => {
                  setOpenMenu(null);
                  onToggleAiDrawer();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
                title={t('עוזר AI — כתבו בעברית מה לשנות בעמוד')}
              >
                <Sparkles className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>{t('עוזר AI')}</span>
              </button>

              {canImportSecondary && (
                <button
                  onClick={handleImportSecondaryDocument}
                  className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
                  title={t('ייבוא מסמך משני (DOCX) לספר הפתוח — בלי לאפס את העריכות')}
                >
                  <FileUp className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>{t('מסמך משני')}</span>
                </button>
              )}

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenWelcome();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
                title={t('מדריך קצר: מה עושים כאן, צעד אחר צעד')}
              >
                <HelpCircle className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>{t('איך משתמשים?')}</span>
              </button>

              <div className="my-1 border-t border-[var(--ui-border)]" />

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onToggleUiTheme();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
                title={
                  uiTheme === 'day'
                    ? t('החלף למצב לילה (Night Editorial Mode)')
                    : t('החלף למצב יום בהיר (Day Editorial Mode)')
                }
              >
                {uiTheme === 'day' ? (
                  <Moon className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                ) : (
                  <Sun className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                )}
                <span>{uiTheme === 'day' ? t('מצב לילה') : t('מצב יום')}</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onToggleUiLang();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
                title={uiLang === 'he' ? t('החלף לאנגלית') : t('החלף לעברית')}
              >
                <Languages className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>{uiLang === 'he' ? t('English') : t('עברית')}</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenGeminiKey();
                }}
                className="w-full px-3 py-2 text-start hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
                title={t('מפתח Gemini AI')}
              >
                <KeyRound className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>{t('מפתח AI')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
    {/* v0.5.0 Part C — Module 7: the secondary-import modal, owned by the
        header when the parent passes live units/links + the merge callback. */}
    {isSecondaryImportOpen && secondaryImportUnits && onMergeSecondaryImport && (
      <SecondaryDocxImportModal
        existingUnits={secondaryImportUnits}
        existingLinks={secondaryImportLinks ?? []}
        onMerge={(units, links) => {
          onMergeSecondaryImport(units, links);
          setIsSecondaryImportOpen(false);
        }}
        onClose={() => setIsSecondaryImportOpen(false)}
      />
    )}
  </>
  );
};
