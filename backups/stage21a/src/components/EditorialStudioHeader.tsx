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
} from 'lucide-react';
import { BookLayoutType } from '../types/typesetter';
import { LicenseStatus } from '../engine/license-engine';

export type UiThemeMode = 'day' | 'night';
export type PrimaryWorkMode = 'home' | 'edit' | 'export';

interface EditorialStudioHeaderProps {
  activeWorkMode: PrimaryWorkMode;
  onWorkModeChange: (mode: PrimaryWorkMode) => void;
  documentTitle: string;
  isModified?: boolean;
  layoutType: BookLayoutType;
  onLayoutTypeChange: (layout: BookLayoutType) => void;
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
  onExportPdf: (allPages?: boolean) => void;
  onExportIdml: () => void;
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
  onOpenLicense: () => void;
  licenseStatus: LicenseStatus;
  isVerifiedCommercialLicense?: boolean;
  showBaselines: boolean;
  onToggleBaselines: () => void;
  showKneeGuide: boolean;
  onToggleKneeGuide: () => void;
  uiTheme: UiThemeMode;
  onToggleUiTheme: () => void;
}

const LAYOUT_PRESETS: Array<{
  id: BookLayoutType;
  labelHe: string;
  subLabelHe: string;
  icon: any;
}> = [
  {
    id: 'rav_text',
    labelHe: 'ש״ס וילנא · רב-טקסט',
    subLabelHe: 'גמרא במרכז, רש״י בימין, תוספות בשמאל וברכיים דינמיות',
    icon: Crown,
  },
  {
    id: 'mikraot_gedolot',
    labelHe: 'מקראות גדולות',
    subLabelHe: 'פסוקי תנ״ך בטעמים עם תרגום ומפרשים',
    icon: Scroll,
  },
  {
    id: 'source_top_commentary_bottom',
    labelHe: 'מקור עליון + מפרשים',
    subLabelHe: 'רמב״ם / משנה ברורה עם קו מפריד דינמי',
    icon: SplitSquareVertical,
  },
  {
    id: 'two_column',
    labelHe: 'שני טורים מאוזנים',
    subLabelHe: 'שולחן ערוך / משניות / סידור בשני טורים',
    icon: Columns,
  },
  {
    id: 'single_column',
    labelHe: 'טקסט רץ · טור יחיד',
    subLabelHe: 'ספרי מוסר, הלכה, דרוש ושו״ת',
    icon: BookOpen,
  },
];

export const EditorialStudioHeader: React.FC<EditorialStudioHeaderProps> = ({
  activeWorkMode,
  onWorkModeChange,
  documentTitle,
  isModified = false,
  layoutType,
  onLayoutTypeChange,
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
  onExportPdf,
  onExportIdml,
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
  onOpenLicense,
  licenseStatus,
  showBaselines,
  onToggleBaselines,
  showKneeGuide,
  onToggleKneeGuide,
  uiTheme,
  onToggleUiTheme,
}) => {
  const [openMenu, setOpenMenu] = useState<'project' | 'layout' | null>(null);
  const headerRef = useRef<HTMLElement>(null);

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
    LAYOUT_PRESETS.find(l => l.id === layoutType) || LAYOUT_PRESETS[0];

  const WORK_MODES: Array<{
    id: PrimaryWorkMode;
    labelHe: string;
    subtitleHe: string;
    icon: any;
  }> = [
    {
      id: 'home',
      labelHe: 'כניסה',
      subtitleHe: 'פתיחה, ייבוא וניהול פרויקטים (.keter)',
      icon: Home,
    },
    {
      id: 'edit',
      labelHe: 'עריכה',
      subtitleHe: 'סביבת עימוד ועריכת ספר פעילה',
      icon: Edit3,
    },
    {
      id: 'export',
      labelHe: 'ייצוא',
      subtitleHe: 'בדיקות קדם-דפוס והפקת PDF / IDML / .keter',
      icon: Download,
    },
  ];

  return (
    <header
      ref={headerRef}
      dir="rtl"
      className="h-12 bg-[var(--ui-surface)] border-b border-[var(--ui-border)] flex items-center justify-between px-4 select-none shrink-0 z-40 transition-colors duration-150"
    >
      {/* RIGHT SECTION: Brand + 3 Primary Work Modes Switcher (כניסה | עריכה | ייצוא) + Document Title */}
      <div className="flex items-center gap-3">
        {/* Keter Brand Identity */}
        <div className="flex items-center gap-2 pl-2 border-l border-[var(--ui-border)]">
          <div className="w-7 h-7 rounded-md bg-[var(--ui-accent)] flex items-center justify-center shadow-2xs">
            <Crown className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold tracking-tight text-[var(--ui-text-primary)] leading-none">
              כתר · Keter
            </span>
            <span className="text-[9px] text-[var(--ui-text-muted)] font-medium mt-0.5">
              אולפן עימוד ספרי קודש
            </span>
          </div>
        </div>

        {/* Three Primary Work Modes Switcher: כניסה | עריכה | ייצוא */}
        <div
          role="tablist"
          aria-label="מצבי עבודה ראשיים"
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
                title={m.subtitleHe}
                className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  active
                    ? 'bg-[var(--ui-accent)] text-white shadow-2xs'
                    : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{m.labelHe}</span>
              </button>
            );
          })}
        </div>

        {/* Project Menu Dropdown & Active Document Title */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'project' ? null : 'project')}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[var(--ui-surface-hover)] border border-transparent hover:border-[var(--ui-border)] transition-all"
            title="תפריט פרויקט, מסמכים והגדרות מערכת"
          >
            <span className="text-xs font-semibold text-[var(--ui-text-primary)] max-w-[190px] truncate">
              {documentTitle}
            </span>
            {isModified ? (
              <span
                className="w-2 h-2 rounded-full bg-[var(--ui-warning)] shrink-0"
                title="שינויים שלא נשמרו לקובץ"
              />
            ) : (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[var(--ui-success)]/80 shrink-0"
                title="הפרויקט שמור"
              />
            )}
            <ChevronDown className="w-3.5 h-3.5 text-[var(--ui-text-secondary)]" />
          </button>

          {openMenu === 'project' && (
            <div className="absolute right-0 mt-1.5 w-64 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg shadow-[var(--ui-floating-shadow)] py-1.5 z-50 text-xs">
              <div className="px-3 py-1.5 border-b border-[var(--ui-border)] mb-1">
                <span className="text-[10px] font-medium text-[var(--ui-text-muted)] block">
                  פרויקט פעיל (.keter)
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
                className="w-full px-3 py-2 text-right hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)] font-medium"
              >
                <Home className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>מסך כניסה וניהול פרויקטים</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onNewProject();
                }}
                className="w-full px-3 py-2 text-right hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-primary)]"
              >
                <span className="flex items-center gap-2.5">
                  <FilePlus2 className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>פרויקט חדש...</span>
                </span>
                <span className="text-[10px] text-[var(--ui-text-muted)] font-mono">Ctrl+N</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenDocx();
                }}
                className="w-full px-3 py-2 text-right hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-primary)]"
              >
                <span className="flex items-center gap-2.5">
                  <FileUp className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>ייבוא קובצי Word (DOCX)...</span>
                </span>
                <span className="text-[10px] text-[var(--ui-text-muted)] font-mono">Ctrl+O</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenContentEditor();
                }}
                className="w-full px-3 py-2 text-right hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
              >
                <Edit3 className="w-3.5 h-3.5 text-[var(--ui-text-secondary)]" />
                <span>עריכת טקסטים מלאה...</span>
              </button>

              <div className="my-1 border-t border-[var(--ui-border)]" />

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onLoadProjectFile();
                }}
                className="w-full px-3 py-2 text-right hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-primary)]"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[var(--ui-text-secondary)]" />
                <span>פתח קובץ פרויקט (.keter)...</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onSaveProjectFile();
                }}
                className="w-full px-3 py-2 text-right hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-primary)]"
              >
                <span className="flex items-center gap-2.5">
                  <Save className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>שמור קובץ פרויקט (.keter)</span>
                </span>
                <span className="text-[10px] text-[var(--ui-text-muted)] font-mono">Ctrl+S</span>
              </button>

              <div className="my-1 border-t border-[var(--ui-border)]" />

              <div className="px-3 py-1 text-[10px] font-medium text-[var(--ui-text-muted)]">
                כלי מערכת ותצוגה
              </div>

              <button
                onClick={() => {
                  onToggleBaselines();
                }}
                className="w-full px-3 py-1.5 text-right hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-secondary)]"
              >
                <span>רשת קווי בסיס (Baselines)</span>
                <span
                  className={`text-[10px] font-semibold ${
                    showBaselines ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)]'
                  }`}
                >
                  {showBaselines ? 'פעיל' : 'כבוי'}
                </span>
              </button>

              <button
                onClick={() => {
                  onToggleKneeGuide();
                }}
                className="w-full px-3 py-1.5 text-right hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-secondary)]"
              >
                <span>קווי מתאר ברכיים (Dynamic Knees)</span>
                <span
                  className={`text-[10px] font-semibold ${
                    showKneeGuide ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)]'
                  }`}
                >
                  {showKneeGuide ? 'פעיל' : 'כבוי'}
                </span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenFontScanner();
                }}
                className="w-full px-3 py-1.5 text-right hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
              >
                <Cpu className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
                <span>סורק גופני מערכת וטבלאות OpenType</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenRulesModal();
                }}
                className="w-full px-3 py-1.5 text-right hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
                <span>מנוע חוקי עימוד (Stage 12)</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenTests();
                }}
                className="w-full px-3 py-1.5 text-right hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--ui-success)]" />
                <span>חבילת בדיקות רגרסיה ואימות</span>
              </button>

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenReport();
                }}
                className="w-full px-3 py-1.5 text-right hover:bg-[var(--ui-surface-hover)] flex items-center gap-2.5 text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
              >
                <FileText className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
                <span>דו״ח ארכיטקטורה ואימות</span>
              </button>

              <div className="my-1 border-t border-[var(--ui-border)]" />

              <button
                onClick={() => {
                  setOpenMenu(null);
                  onOpenLicense();
                }}
                className="w-full px-3 py-2 text-right hover:bg-[var(--ui-surface-hover)] flex items-center justify-between text-[var(--ui-text-primary)]"
              >
                <span className="flex items-center gap-2.5">
                  <KeyRound className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span>רישיון והפעלת תוכנה</span>
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    licenseStatus === 'activated'
                      ? 'bg-[var(--ui-success-bg)] text-[var(--ui-success)]'
                      : 'bg-[var(--ui-surface-subtle)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  {licenseStatus === 'activated' ? 'מופעל' : 'לא מופעל'}
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
              title="תבנית עימוד ראשית"
            >
              <currentLayoutObj.icon className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
              <span className="font-medium">{currentLayoutObj.labelHe}</span>
              <ChevronDown className="w-3 h-3 text-[var(--ui-text-secondary)]" />
            </button>

            {openMenu === 'layout' && (
              <div className="absolute right-0 mt-1.5 w-72 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg shadow-[var(--ui-floating-shadow)] py-1.5 z-50 text-xs">
                <div className="px-3 py-1 text-[10px] font-medium text-[var(--ui-text-muted)] border-b border-[var(--ui-border)] mb-1">
                  בחר מתכונת עימוד לספר
                </div>
                {LAYOUT_PRESETS.map(preset => {
                  const Icon = preset.icon;
                  const active = preset.id === layoutType;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setOpenMenu(null);
                        onLayoutTypeChange(preset.id);
                      }}
                      className={`w-full px-3 py-2 text-right flex items-start gap-2.5 transition-colors ${
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
                        <div className="font-semibold">{preset.labelHe}</div>
                        <div className="text-[10px] text-[var(--ui-text-secondary)] leading-snug mt-0.5">
                          {preset.subLabelHe}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
                ? `בטל: ${undoLabel || 'פעולה אחרונה'} (Ctrl+Z)`
                : 'אין פעולות לביטול'
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
                ? `בצע מחדש: ${redoLabel || 'פעולה אחרונה'} (Ctrl+Y)`
                : 'אין פעולות לביצוע מחדש'
            }
            className="p-1.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onClick={onSaveProjectFile}
          title="שמור קובץ פרויקט (.keter) (Ctrl+S)"
          className="px-2.5 py-1.5 rounded-md bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-primary)] flex items-center gap-1.5 text-xs font-medium transition-colors"
        >
          <Save className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
          <span>שמור .keter</span>
        </button>

        <div className="px-2.5 py-1 rounded-md bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)] flex items-center gap-1.5">
          <span className="font-semibold text-[var(--ui-text-primary)]">
            דף {currentPageHebrew}
          </span>
          <span className="text-[var(--ui-border-strong)]">·</span>
          <span className="font-mono text-[10px]">
            {currentPage}/{totalPages}
          </span>
        </div>
      </div>

      {/* LEFT SECTION: On-Demand Drawers (Edit Mode) + Day/Night Switch + Quick Export */}
      <div className="flex items-center gap-1.5">
        {activeWorkMode === 'edit' && (
          <>
            {/* Navigation Drawer Toggle */}
            <button
              onClick={onToggleNavigator}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-all ${
                isNavigatorOpen
                  ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)]/35 text-[var(--ui-accent)]'
                  : 'bg-transparent border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
              }`}
              title="מגירת דפים ומבנה מסמך (נפתחת לפי דרישה)"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>דפים ומבנה</span>
            </button>

            {/* Inspector Drawer Toggle */}
            <button
              onClick={onToggleInspector}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-all ${
                isInspectorOpen
                  ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)]/35 text-[var(--ui-accent)]'
                  : 'bg-transparent border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
              }`}
              title="מגירת מאפייני טיפוגרפיה, פסקה, עמוד ורב-טקסט"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>מאפיינים</span>
            </button>

            {/* AI Drawer Toggle */}
            <button
              onClick={onToggleAiDrawer}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-all ${
                isAiDrawerOpen
                  ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)]/35 text-[var(--ui-accent)]'
                  : 'bg-transparent border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
              }`}
              title="עוזר הטיפוגרפיה החכם (AI)"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>עוזר AI</span>
            </button>

            <div className="h-4 w-px bg-[var(--ui-border)] mx-0.5" />
          </>
        )}

        {/* Day / Night Editorial Theme Switch */}
        <button
          onClick={onToggleUiTheme}
          className="px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-primary)] transition-colors"
          title={
            uiTheme === 'day'
              ? 'החלף למצב לילה (Night Editorial Mode)'
              : 'החלף למצב יום בהיר (Day Editorial Mode)'
          }
        >
          {uiTheme === 'day' ? (
            <>
              <Moon className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
              <span>מצב לילה</span>
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
              <span>מצב יום</span>
            </>
          )}
        </button>

        {/* Quick Export Trigger (switches to Export mode or triggers PDF/IDML) */}
        {activeWorkMode !== 'export' && (
          <button
            onClick={() => onWorkModeChange('export')}
            disabled={isExportingPdf}
            className="px-3 py-1.5 rounded-md bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 shadow-2xs transition-colors"
            title="עבור למסך ייצוא והפקת דפוס (PDF / IDML / .keter)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>ייצוא לדפוס</span>
          </button>
        )}
      </div>
    </header>
  );
};
