import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Save,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Minus,
  Plus,
} from 'lucide-react';
import { BookLayoutType, PageTypesetResult, QaIssue } from '../types/typesetter';
import { getSemanticRoleLabel, SemanticStyleRole } from '../types/design-settings';
import { useLanguage } from '../i18n/LanguageContext';

interface WorkspaceStatusBarProps {
  activePage: PageTypesetResult;
  currentPageIndex: number;
  totalPages: number;
  onSelectPage: (pageIndex: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  layoutType: BookLayoutType;
  totalUnits: number;
  totalLinks: number;
  selectedUnitId: string | null;
  selectedUnitRole?: string;
  selectedWordText?: string | null;
  // v0.5.0 Part B (Module 4, wired by integrator): the section (block) the
  // pointer is hovering on the page — shown in the status bar when nothing
  // is selected, so the hovered section's identity is visible to the user.
  hoveredBlock?: { role?: string; lineCount: number } | null;
  qaScore: number;
  qaIssues: QaIssue[];
  isExportingPdf: boolean;
  exportProgress: { current: number; total: number } | null;
  designRevision: number;
  lastSavedLabel?: string;
  lastAutosaveTimestamp?: number | null;
  isDirty?: boolean;
  recoveredFromAutosave?: boolean;
  onOpenKneeInspector: () => void;
  onOpenRulesModal: () => void;
  onOpenTests: () => void;
  /** v0.9.8 Phase 1 — Developer Mode. When false the QA button below
      becomes plain status text (the score stays visible, the test panel
      is unreachable). */
  developerMode?: boolean;
  onToggleAiChat: () => void;
  isAiChatOpen: boolean;
}

const LAYOUT_LABELS_HE: Record<BookLayoutType, string> = {
  rav_text: 'ש״ס וילנא',
  mikraot_gedolot: 'מקראות גדולות',
  source_top_commentary_bottom: 'מקור וביאור',
  two_column: 'שני טורים',
  single_column: 'טקסט רץ',
  // v0.8.0 Part D — Yiddish sefarim.
  yiddish_sefer: 'ספר יידיש',
  // v0.5.0 Part C — Module 3.
  custom_layout: 'פריסה מותאמת אישית',
};

const LAYOUT_LABELS_EN: Record<BookLayoutType, string> = {
  rav_text: 'Vilna Shas',
  mikraot_gedolot: 'Mikraot Gedolot',
  source_top_commentary_bottom: 'Source and commentary',
  two_column: 'Two columns',
  single_column: 'Running text',
  // v0.8.0 Part D — Yiddish sefarim.
  yiddish_sefer: 'Yiddish Sefer',
  // v0.5.0 Part C — Module 3.
  custom_layout: 'Custom layout',
};

export const WorkspaceStatusBar: React.FC<WorkspaceStatusBarProps> = ({
  activePage,
  currentPageIndex,
  totalPages,
  onSelectPage,
  zoom,
  onZoomChange,
  layoutType,
  selectedUnitId,
  selectedUnitRole,
  selectedWordText,
  hoveredBlock,
  qaScore,
  qaIssues,
  isExportingPdf,
  exportProgress,
  lastAutosaveTimestamp,
  isDirty = false,
  onOpenTests,
  developerMode = false,
  onToggleAiChat,
  isAiChatOpen,
}) => {
  const { t, tf, dir, lang } = useLanguage();
  const criticalCount = qaIssues.filter(i => i.severity === 'critical' && !i.autoFixed).length;

  const formattedAutosaveTime = lastAutosaveTimestamp
    ? new Date(lastAutosaveTimestamp).toLocaleTimeString(lang === 'en' ? 'en-US' : 'he-IL', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <footer
      dir={dir}
      className="h-9 bg-[var(--ui-surface)] border-t border-[var(--ui-border)] px-5 flex items-center justify-between text-xs text-[var(--ui-text-secondary)] select-none shrink-0 z-30 transition-colors duration-150"
    >
      {/* Right Section (RTL Start): Page Navigation Stepper & Active Context */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-1.5 py-0.5">
          <button
            onClick={() => onSelectPage(Math.max(0, currentPageIndex - 1))}
            disabled={currentPageIndex <= 0}
            className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] disabled:opacity-30"
            title={t("עמוד קודם (PageUp)")}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <span className="px-2 text-[11px] font-medium text-[var(--ui-text-primary)] whitespace-nowrap">
            
            {t("דף")}{' '}
            <strong className="font-serif text-[var(--ui-accent)]">
              {activePage.pageNumberHebrew}
            </strong>
            <span className="text-[var(--ui-border-strong)] mx-1.5">·</span>
            <span className="font-mono text-[var(--ui-text-secondary)]">
              {currentPageIndex + 1}/{totalPages}
            </span>
          </span>

          <button
            onClick={() => onSelectPage(Math.min(totalPages - 1, currentPageIndex + 1))}
            disabled={currentPageIndex >= totalPages - 1}
            className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] disabled:opacity-30"
            title={t("עמוד הבא (PageDown)")}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="hidden sm:inline text-[var(--ui-text-secondary)] text-[11px]">
          {lang === 'en' ? LAYOUT_LABELS_EN[layoutType] : LAYOUT_LABELS_HE[layoutType]}
        </span>

        {selectedUnitId && (
          <>
            <span aria-hidden="true" className="text-[var(--ui-border-strong)]">
              ·
            </span>
            <span className="text-[var(--ui-accent)] font-medium text-[11px] truncate max-w-[220px]">
              {selectedUnitRole
                ? getSemanticRoleLabel(selectedUnitRole as SemanticStyleRole, lang)
                : t("פסקה פעילה")}
              {selectedWordText ? ` — "${selectedWordText}"` : ''}
            </span>
          </>
        )}

        {/* v0.5.0 Part B (Module 4): hovered section — only when nothing is
            selected, so the status bar never shows two contexts at once. */}
        {!selectedUnitId && hoveredBlock && (
          <>
            <span aria-hidden="true" className="text-[var(--ui-border-strong)]">
              ·
            </span>
            <span className="text-[var(--ui-text-secondary)] text-[11px] truncate max-w-[220px]">
              {hoveredBlock.role
                ? getSemanticRoleLabel(hoveredBlock.role as SemanticStyleRole, lang)
                : t("פסקה")}
              {` · ${hoveredBlock.lineCount} ${t("שורות")}`}
            </span>
          </>
        )}
      </div>

      {/* Center Section: Interactive Zoom Controls */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onZoomChange(Math.max(0.6, Math.round((zoom - 0.1) * 100) / 100))}
          className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
          title={t("הקטן תצוגה")}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <div
          className="flex items-center gap-1 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg p-0.5 text-[11px]"
          dir="ltr"
        >
          {[0.85, 1.0, 1.15, 1.3].map(preset => {
            const isCurrent = Math.abs(zoom - preset) < 0.04;
            return (
              <button
                key={preset}
                onClick={() => onZoomChange(preset)}
                className={`px-2 py-0.5 rounded font-mono transition-colors ${
                  isCurrent
                    ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-fg)] font-semibold'
                    : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                }`}
              >
                {Math.round(preset * 100)}%
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onZoomChange(Math.min(1.8, Math.round((zoom + 0.1) * 100) / 100))}
          className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
          title={t("הגדל תצוגה")}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Left Section (RTL End): Save State, Preflight QA & AI Trigger */}
      <div className="flex items-center gap-3.5 shrink-0 text-[11px]">
        {isExportingPdf && exportProgress ? (
          <div className="flex items-center gap-1.5 text-[var(--ui-accent)] font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--ui-accent)]" />
            <span>
              
              {t("מפיק PDF (")}{exportProgress.current}/{exportProgress.total})...
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[var(--ui-text-secondary)]">
            <Save
              className={`w-3.5 h-3.5 ${
                isDirty ? 'text-[var(--ui-warning)]' : 'text-[var(--ui-success)]'
              }`}
            />
            <span>
              {formattedAutosaveTime
                ? tf('נשמר אוטומטית ב-{time}', { time: formattedAutosaveTime })
                : t("שמור אוטומטית")}
            </span>
          </div>
        )}

        <span aria-hidden="true" className="text-[var(--ui-border-strong)]">
          ·
        </span>

        {/* v0.9.8 Phase 1 — Developer Mode OFF: the QA button is gone
            (the Automated Test panel is unreachable); the score stays as
            plain, non-clickable status text. */}
        {developerMode ? (
          <button
            onClick={onOpenTests}
            data-testid="statusbar-qa-button"
            className="hover:text-[var(--ui-text-primary)] transition-colors flex items-center gap-1"
            title={t("בדיקת תקינות העמוד (QA)")}
          >
            {criticalCount === 0 ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-success)]" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-[var(--ui-warning)]" />
            )}
            <span>
              {t("תקינות:")}{' '}
              <strong
                className={`font-mono ${
                  criticalCount === 0 ? 'text-[var(--ui-success)]' : 'text-[var(--ui-warning)]'
                }`}
              >
                {qaScore}%
              </strong>
            </span>
          </button>
        ) : (
          <span data-testid="statusbar-qa-score" className="flex items-center gap-1">
            {criticalCount === 0 ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-success)]" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-[var(--ui-warning)]" />
            )}
            <span>
              {t("תקינות:")}{' '}
              <strong
                className={`font-mono ${
                  criticalCount === 0 ? 'text-[var(--ui-success)]' : 'text-[var(--ui-warning)]'
                }`}
              >
                {qaScore}%
              </strong>
            </span>
          </span>
        )}

        <span aria-hidden="true" className="text-[var(--ui-border-strong)]">
          ·
        </span>

        <button
          onClick={onToggleAiChat}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors ${
            isAiChatOpen
              ? 'bg-[var(--ui-selected-bg)] text-[var(--ui-selected-text)] font-medium'
              : 'hover:text-[var(--ui-text-primary)] text-[var(--ui-text-secondary)]'
          }`}
          title={t("פתח עוזר עימוד AI")}
        >
          <Sparkles className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
          <span>{t("עוזר AI")}</span>
        </button>
      </div>
    </footer>
  );
};
