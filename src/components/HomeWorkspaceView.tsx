import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Crown,
  FolderOpen,
  Save,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  HelpCircle,
  RotateCcw,
  ChevronDown,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import {
  BookLayoutType,
  ProjectSnapshot,
  ContentUnit,
  RavTextLink,
} from '../types/typesetter';
import { RecentProjectItem } from '../engine/project-persistence';
import {
  CORE_START_LAYOUTS,
  layoutPresetLabel,
  type CoreStartLayoutOption,
} from '../engine/layout-presets';
import {
  slotArchetypeForStartOption,
  slotMatrixForStartOption,
  type ChosenSetup,
} from '../engine/sefer-wizard';
import { NewProjectForm } from './NewProjectForm';
import { DocxImportHub } from './DocxImportHub';
import type { AutoLayoutImportInfo } from '../engine/auto-layout';
import { useLanguage } from '../i18n/LanguageContext';

interface HomeWorkspaceViewProps {
  currentTitle: string;
  currentLayoutType: BookLayoutType;
  totalPages: number;
  totalUnits: number;
  isDirty: boolean;
  lastAutosaveTimestamp: number | null;
  recoveredFromAutosave: boolean;
  recentProjects: RecentProjectItem[];
  hasAutosaveToRecover?: boolean;
  onRecoverAutosave?: () => void;
  onContinueActiveProject: () => void;
  onRenameActiveProject?: (newTitle: string) => void;
  onCreateNewProject: (
    title: string,
    layoutType: BookLayoutType,
    mode: 'blank' | 'sample',
    setup?: ChosenSetup
  ) => void;
  onOpenDocxImport: () => void;
  onImportUnits: (
    units: ContentUnit[],
    title: string,
    links?: RavTextLink[],
    autoLayout?: AutoLayoutImportInfo,
    setup?: ChosenSetup
  ) => void;
  onOpenProjectFileDialog: () => void;
  onLoadProjectFileDirect: (file: File) => void;
  onLoadRecentProject: (snapshot: ProjectSnapshot) => void;
  onRemoveRecentProject: (projectId: string) => void;
  onSaveActiveProject: () => void;
  onOpenWelcome: () => void;
}

export const HomeWorkspaceView: React.FC<HomeWorkspaceViewProps> = ({
  currentTitle,
  currentLayoutType,
  totalPages,
  totalUnits,
  isDirty,
  lastAutosaveTimestamp,
  recoveredFromAutosave,
  recentProjects,
  hasAutosaveToRecover = false,
  onOpenWelcome,
  onRecoverAutosave,
  onContinueActiveProject,
  onRenameActiveProject,
  onCreateNewProject,
  onOpenDocxImport,
  onImportUnits,
  onOpenProjectFileDialog,
  onLoadProjectFileDirect,
  onLoadRecentProject,
  onRemoveRecentProject,
  onSaveActiveProject,
}) => {
  const { t, tf, dir, lang } = useLanguage();

  // v0.9.9 — Step 1 lives in the ONE shared NewProjectForm below
  // (same form/state as the New Project modal). Home keeps only the
  // three values Step 2 and the start-empty link need: the explicit
  // chosen setup, the title and the starter mode, all reported by the
  // form through onSetupChange. No localStorage seam any more.
  const [homeSetup, setHomeSetup] = useState<ChosenSetup>({ baseLayout: 'rav_text' });
  const [homeTitle, setHomeTitle] = useState<string>('');
  const [homeMode, setHomeMode] = useState<'blank' | 'sample'>('sample');
  const [stagedFileCount, setStagedFileCount] = useState<number>(0);

  // Unified Top Bar states (inline rename + project switcher popover)
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(currentTitle);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);

  const projectMenuRef = useRef<HTMLDivElement>(null);
  const keterDropInputRef = useRef<HTMLInputElement>(null);

  // The start card the setup corresponds to (a recipe card when a
  // recipe is picked, the base card otherwise, 'custom_layout' for
  // drawn boxes) — only for the Step 2 heading label and the hub's
  // slot matrix; the setup itself is what travels to App.
  const selectedCardId: string = homeSetup.recipeId
    ? CORE_START_LAYOUTS.find(o => o.kind === 'recipe' && o.recipeId === homeSetup.recipeId)?.id
      ?? homeSetup.baseLayout
    : homeSetup.customLayout
      ? 'custom_layout'
      : homeSetup.baseLayout;
  const selectedOption: CoreStartLayoutOption =
    CORE_START_LAYOUTS.find(o => o.id === selectedCardId) ?? CORE_START_LAYOUTS[0];
  const slotArchetypeId = slotArchetypeForStartOption(selectedOption.id);
  // v0.9.9 — the DOCX slot matrix for THIS card (Yiddish / Siddur /
  // two-column / source-top get their own matrices, not 'classic');
  // memoised so the hub's slot-change effect does not fire on every
  // render.
  const slotMatrix = useMemo(
    () => slotMatrixForStartOption(selectedOption.id),
    [selectedOption.id]
  );

  useEffect(() => {
    setDraftTitle(currentTitle);
  }, [currentTitle]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setIsProjectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const formatLayoutLabel = (layout: BookLayoutType) => layoutPresetLabel(layout, lang);

  const commitTitleRename = () => {
    const cleaned = draftTitle.trim();
    if (cleaned && cleaned !== currentTitle) {
      onRenameActiveProject?.(cleaned);
    } else {
      setDraftTitle(currentTitle);
    }
    setIsEditingTitle(false);
  };

  const handleStartEmptyInSelectedLayout = () => {
    const fallbackName = lang === 'en' ? selectedOption.labelEn : selectedOption.labelHe;
    const title = homeTitle.trim() || fallbackName;
    // v0.9.9 — the setup travels as an explicit argument, not a seam.
    onCreateNewProject(title, homeSetup.baseLayout, homeMode, homeSetup);
  };

  const autosaveTimeText = lastAutosaveTimestamp
    ? new Date(lastAutosaveTimestamp).toLocaleTimeString(
        lang === 'en' ? 'en-US' : 'he-IL',
        { hour: '2-digit', minute: '2-digit' }
      )
    : null;

  return (
    <div
      dir={dir}
      className="flex-1 overflow-y-auto bg-[var(--ui-workspace-bg)] text-[var(--ui-text-primary)] p-5 md:p-8 select-none"
    >
      <div className="max-w-6xl mx-auto space-y-6">
        {/* RULE 1: UNIFIED TOP PROJECT STATUS & ACTION BAR (Combined Sections 1 & 2) */}
        <section
          aria-label={t("פרויקט פתוח כעת בסביבת העבודה")}
          className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl px-5 py-4 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4"
        >
          {/* Active Project Status */}
          <div className="flex items-center gap-3.5 min-w-0 w-full xl:w-auto xl:flex-1">
            <div className="w-10 h-10 rounded-lg bg-[var(--ui-selected-bg)] border border-[var(--ui-border)] flex items-center justify-center shrink-0">
              <Crown className="w-5 h-5 text-[var(--ui-accent)]" />
            </div>
            <div className="min-w-0 flex-1">
              {isEditingTitle ? (
                <div className="flex items-center gap-1.5 max-w-md">
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={e => setDraftTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitTitleRename();
                      if (e.key === 'Escape') {
                        setDraftTitle(currentTitle);
                        setIsEditingTitle(false);
                      }
                    }}
                    autoFocus
                    className="flex-1 px-2.5 py-1 text-sm font-bold bg-[var(--ui-surface-subtle)] border border-[var(--ui-accent)] rounded-md text-[var(--ui-text-primary)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={commitTitleRename}
                    title={t("שמור שם")}
                    className="p-1.5 rounded-md bg-[var(--ui-accent)] text-[var(--ui-accent-fg)] hover:bg-[var(--ui-accent-hover)]"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftTitle(currentTitle);
                      setIsEditingTitle(false);
                    }}
                    title={t("ביטול")}
                    className="p-1.5 rounded-md border border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-surface-hover)]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 min-w-0">
                  <h1 className="text-base font-bold text-[var(--ui-text-primary)] truncate">
                    {currentTitle}
                  </h1>
                  {onRenameActiveProject && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftTitle(currentTitle);
                        setIsEditingTitle(true);
                      }}
                      title={t("שנה שם פרויקט")}
                      className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text-primary)] transition-colors shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Clean unboxed metadata row (zero-pill discipline, tabular-nums) */}
              <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--ui-text-secondary)] mt-0.5 tabular-nums">
                <span>{formatLayoutLabel(currentLayoutType)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {totalPages} {totalPages === 1 ? t('עמוד') : t('עמודים')}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {totalUnits} {totalUnits === 1 ? t('קטע') : t('קטעים')}
                </span>
                <span aria-hidden="true">·</span>
                {isDirty ? (
                  <span className="inline-flex items-center gap-1 text-[var(--ui-warning)] font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{t("שינויים טרם נשמרו לקובץ .keter")}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[var(--ui-success)] font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{t("נשמר")}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t("מוכן לייצוא")}</span>
                  </span>
                )}
                {/* v0.9.9 repair (B3b): "recovered from autosave" badge — App still
                    passes the prop; the stage rewrite declared it but never rendered it. */}
                {recoveredFromAutosave && (
                  <span>
                    {t("· שוחזר משמירה אוטומטית")}{' '}
                    {lastAutosaveTimestamp
                      ? `(${new Date(lastAutosaveTimestamp).toLocaleTimeString(lang === 'en' ? 'en-US' : 'he-IL')})`
                      : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Consolidated Quick Actions */}
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {/* Switch / Open .keter Project Popover */}
            <div className="relative" ref={projectMenuRef}>
              <button
                type="button"
                onClick={() => setIsProjectMenuOpen(v => !v)}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-medium text-[var(--ui-text-primary)] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>{t("החלף / פתח פרויקט")}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
              </button>

              {isProjectMenuOpen && (
                <div className="absolute end-0 mt-2 w-80 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl shadow-[var(--ui-floating-shadow)] p-3 z-40 space-y-3">
                  <input
                    ref={keterDropInputRef}
                    type="file"
                    accept=".keter,.keter.json,.json"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      setIsProjectMenuOpen(false);
                      if (f) onLoadProjectFileDirect(f);
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setIsProjectMenuOpen(false);
                      onOpenProjectFileDialog();
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-[var(--ui-selected-bg)] hover:bg-[var(--ui-accent)] hover:text-[var(--ui-accent-fg)] border border-[var(--ui-selected-border)] text-[var(--ui-selected-text)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>{t("בחר קובץ פרויקט (.keter / .keter.json) מהמחשב...")}</span>
                  </button>

                  <div className="pt-2 border-t border-[var(--ui-border)]">
                    <div className="text-[11px] font-semibold text-[var(--ui-text-secondary)] flex items-center gap-1.5 mb-2">
                      <Clock className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
                      <span>
                        {t("פרויקטים אחרונים")} ({recentProjects.length})
                      </span>
                    </div>
                    {recentProjects.length === 0 ? (
                      <p className="text-[11px] text-[var(--ui-text-muted)] py-2 text-center">
                        {t("טרם נשמרו פרויקטים ברשימה האחרונה. שמירת פרויקט (.keter) תוסיף אותו לכאן.")}
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-56 overflow-y-auto">
                        {recentProjects.map(item => (
                          <div
                            key={item.projectId}
                            className="p-2 rounded-lg hover:bg-[var(--ui-surface-hover)] border border-transparent hover:border-[var(--ui-border)] flex items-center justify-between gap-2 transition-colors"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setIsProjectMenuOpen(false);
                                onLoadRecentProject(item.snapshot);
                              }}
                              className="flex-1 text-start min-w-0"
                            >
                              <div className="text-xs font-semibold text-[var(--ui-text-primary)] truncate">
                                {item.documentTitle}
                              </div>
                              <div className="text-[10px] text-[var(--ui-text-secondary)] truncate mt-0.5 tabular-nums">
                                {formatLayoutLabel(item.layoutType)} ·{' '}
                                {new Date(item.updatedAt).toLocaleDateString(
                                  lang === 'en' ? 'en-US' : 'he-IL'
                                )}
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveRecentProject(item.projectId)}
                              className="p-1 rounded hover:bg-[var(--ui-surface)] text-[var(--ui-text-muted)] hover:text-[var(--ui-danger)]"
                              title={t("הסר מהרשימה")}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Integrated Autosave Recovery (formerly disconnected Section 2) */}
            {onRecoverAutosave && hasAutosaveToRecover && (
              <button
                type="button"
                onClick={onRecoverAutosave}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-medium text-[var(--ui-text-primary)] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 tabular-nums"
                title={
                  autosaveTimeText
                    ? tf('שמירה ברקע זוהתה: {time}', { time: autosaveTimeText })
                    : t("שחזר את מצב העבודה האחרון שנשמר אוטומטית ברקע")
                }
              >
                <RotateCcw className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>
                  {autosaveTimeText
                    ? tf('שחזר ({time})', { time: autosaveTimeText })
                    : t("שחזר שמירה אוטומטית")}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onSaveActiveProject}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-medium text-[var(--ui-text-primary)] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
              <span>{t("שמור קובץ פרויקט (.keter)")}</span>
            </button>

            <button
              type="button"
              onClick={onContinueActiveProject}
              className="px-3.5 py-1.5 rounded-lg bg-[var(--ui-selected-bg)] hover:bg-[var(--ui-accent)] hover:text-[var(--ui-accent-fg)] border border-[var(--ui-selected-border)] text-xs font-semibold text-[var(--ui-selected-text)] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <span>{t("המשך לפרויקט האחרון")}</span>
              {dir === 'rtl' ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </section>

        {/* RULES 2–5: CENTRAL 2-STEP ONBOARDING WIZARD */}
        <section
          aria-label={t("יצירת ספר חדש")}
          className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-6 md:p-8 space-y-7"
        >
          {/* Wizard Header + Linear 2-Step Indicator */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--ui-border)] pb-5">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-[var(--ui-text-primary)] tracking-tight">
                {t("יצירת ספר חדש")}
              </h2>
              <p className="text-sm text-[var(--ui-text-secondary)]">
                {t("בחרו סוג ספר להגדרת המבנה והעימוד, ולאחר מכן העלו את קבצי ה-Word (.docx) המתאימים.")}
              </p>
            </div>

            {/* Linear 2-Step Progress Strip */}
            <div
              data-testid="sefer-wizard-stepper"
              className="flex items-center gap-3 text-xs shrink-0"
            >
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-[var(--ui-success)] text-white">
                  ✓
                </span>
                <span className="font-semibold text-[var(--ui-text-primary)]">
                  {t("שלב 1: בחירת סוג ספר")}
                </span>
              </div>

              <span aria-hidden="true" className="text-[var(--ui-text-muted)]">
                {dir === 'rtl' ? '←' : '→'}
              </span>

              <div className="flex items-center gap-2 whitespace-nowrap">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    stagedFileCount > 0
                      ? 'bg-[var(--ui-success)] text-white'
                      : 'bg-[var(--ui-accent)] text-[var(--ui-accent-fg)]'
                  }`}
                >
                  {stagedFileCount > 0 ? '✓' : '2'}
                </span>
                <span className="font-semibold text-[var(--ui-text-primary)]">
                  {t("שלב 2: העלאת קבצי מקור (.docx)")}
                </span>
              </div>
            </div>
          </div>

          {/* STEP 1: the ONE shared new-project form (NewProjectForm) —
              the same form, state and submit path as the New Project
              modal. The title input, starter choice, 5 archetype cards,
              11-card grid, custom-layout designer and collapsed
              29-recipe shelves all live there now; Home only receives
              the chosen setup through onSetupChange. No submit button
              here (footerMode="none") — Step 2's hub and the
              start-empty link below are the actions. */}
          <NewProjectForm
            initialTitle=""
            initialLayout="rav_text"
            initialMode="sample"
            submitLabel={t("צור פרויקט חדש")}
            testId="home-new-project"
            footerMode="none"
            onSetupChange={(setup, title, mode) => {
              setHomeSetup(setup);
              setHomeTitle(title);
              setHomeMode(mode);
            }}
            onCreateProject={(title, layoutType, mode, setup) =>
              onCreateNewProject(title, layoutType, mode, setup)
            }
          />

          {/* STEP 2: DYNAMIC MULTI-SLOT .DOCX UPLOAD MATRIX + SINGLE PROMINENT CTA */}
          <div className="pt-6 border-t border-[var(--ui-border)] space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--ui-text-primary)]">
                  {t("שלב 2: העלאת קבצי מקור (.docx)")} —{' '}
                  <span className="text-[var(--ui-accent)]">
                    {lang === 'he' ? selectedOption.labelHe : selectedOption.labelEn}
                  </span>
                </h3>
                <p className="text-xs text-[var(--ui-text-secondary)] mt-0.5">
                  {t("תבנית מכוילת: גודל הדף, השוליים והגופנים נקבעו מראש — אפשר לשנות הכול אחר כך בעיצוב.")}
                </p>
              </div>
              {/* v0.9.9 repair (B3c): "open DOCX in a separate window" link — the
                  stage rewrite dropped it; the modal is the same shared hub. */}
              <button
                type="button"
                onClick={onOpenDocxImport}
                className="text-[11px] text-[var(--ui-accent)] hover:underline font-medium shrink-0 pt-0.5"
              >
                {t("פתח בחלון נפרד")}
              </button>
            </div>

            <DocxImportHub
              variant="light"
              testIdPrefix="docx-hub-home"
              archetypeId={slotArchetypeId}
              slotsOverride={slotMatrix}
              hideSamples
              projectTitleOverride={homeTitle}
              generateLabel={t("צור פריסה ופתח את אולפן העימוד")}
              // v0.9.9 — the chosen setup travels as an explicit 5th
              // argument; nothing is persisted to localStorage first.
              onImportUnits={(units, title, links, autoLayout) =>
                // the untouched default card (Vilna) lets the files decide
                onImportUnits(
                  units,
                  title,
                  links,
                  autoLayout,
                  homeSetup.baseLayout === 'rav_text' && !homeSetup.recipeId && !homeSetup.archetypeId && !homeSetup.customLayout
                    ? undefined
                    : homeSetup
                )
              }
              onFileCountChange={setStagedFileCount}
              onStartEmptyInArchetype={handleStartEmptyInSelectedLayout}
              // v0.9.9 repair (B3a): the hub's quiet fallback label must match the
              // chosen starter mode — "empty document" would lie when sample is on.
              startEmptyLabel={
                homeMode === 'sample'
                  ? t("או פתח עם טקסט לדוגמה בתבנית זו")
                  : undefined
              }
            />
          </div>
        </section>

        {/* QUIET FOOTER STRIP: Offline note & Help guide */}
        <div className="px-2 py-1 flex items-center justify-between text-xs text-[var(--ui-text-secondary)]">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[var(--ui-success)]" />
            <span>{t("עבודה לא-מקוונת (Offline) זמינה במלואה לעימוד, שמירה וייצוא")}</span>
          </span>
          <button
            type="button"
            onClick={onOpenWelcome}
            className="flex items-center gap-1.5 text-[var(--ui-accent)] hover:underline font-medium"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{t("איך משתמשים?")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
