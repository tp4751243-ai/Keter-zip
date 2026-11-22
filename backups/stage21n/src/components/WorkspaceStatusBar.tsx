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
import { SEMANTIC_ROLE_LABELS_HE, SemanticStyleRole } from '../types/design-settings';

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
  onToggleAiChat: () => void;
  isAiChatOpen: boolean;
}

const LAYOUT_LABELS_HE: Record<BookLayoutType, string> = {
  rav_text: 'ש״ס וילנא',
  mikraot_gedolot: 'מקראות גדולות',
  source_top_commentary_bottom: 'מקור וביאור',
  two_column: 'שני טורים',
  single_column: 'טקסט רץ',
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
  qaScore,
  qaIssues,
  isExportingPdf,
  exportProgress,
  lastAutosaveTimestamp,
  isDirty = false,
  onOpenTests,
  onToggleAiChat,
  isAiChatOpen,
}) => {
  const criticalCount = qaIssues.filter(i => i.severity === 'critical' && !i.autoFixed).length;

  const formattedAutosaveTime = lastAutosaveTimestamp
    ? new Date(lastAutosaveTimestamp).toLocaleTimeString('he-IL', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <footer
      dir="rtl"
      className="h-9 bg-[var(--ui-surface)] border-t border-[var(--ui-border)] px-5 flex items-center justify-between text-xs text-[var(--ui-text-secondary)] select-none shrink-0 z-30 transition-colors duration-150"
    >
      {/* Right Section (RTL Start): Page Navigation Stepper & Active Context */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-1.5 py-0.5">
          <button
            onClick={() => onSelectPage(Math.max(0, currentPageIndex - 1))}
            disabled={currentPageIndex <= 0}
            className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] disabled:opacity-30"
            title="עמוד קודם (PageUp)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <span className="px-2 text-[11px] font-medium text-[var(--ui-text-primary)] whitespace-nowrap">
            דף{' '}
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
            title="עמוד הבא (PageDown)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="hidden sm:inline text-[var(--ui-text-secondary)] text-[11px]">
          {LAYOUT_LABELS_HE[layoutType]}
        </span>

        {selectedUnitId && (
          <>
            <span aria-hidden="true" className="text-[var(--ui-border-strong)]">
              ·
            </span>
            <span className="text-[var(--ui-accent)] font-medium text-[11px] truncate max-w-[220px]">
              {selectedUnitRole
                ? SEMANTIC_ROLE_LABELS_HE[selectedUnitRole as SemanticStyleRole] ?? selectedUnitRole
                : 'פסקה פעילה'}
              {selectedWordText ? ` — "${selectedWordText}"` : ''}
            </span>
          </>
        )}
      </div>

      {/* Center Section: Interactive Zoom Controls */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onZoomChange(Math.max(0.6, Math.round((zoom - 0.1) * 100) / 100))}
          className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
          title="הקטן תצוגה"
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
          title="הגדל תצוגה"
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
              מפיק PDF ({exportProgress.current}/{exportProgress.total})...
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
                ? `נשמר אוטומטית ב-${formattedAutosaveTime}`
                : 'שמור אוטומטית'}
            </span>
          </div>
        )}

        <span aria-hidden="true" className="text-[var(--ui-border-strong)]">
          ·
        </span>

        <button
          onClick={onOpenTests}
          className="hover:text-[var(--ui-text-primary)] transition-colors flex items-center gap-1"
          title="בדיקת תקינות העמוד (QA)"
        >
          {criticalCount === 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-success)]" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--ui-warning)]" />
          )}
          <span>
            תקינות:{' '}
            <strong
              className={`font-mono ${
                criticalCount === 0 ? 'text-[var(--ui-success)]' : 'text-[var(--ui-warning)]'
              }`}
            >
              {qaScore}%
            </strong>
          </span>
        </button>

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
          title="פתח עוזר עימוד AI"
        >
          <Sparkles className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
          <span>עוזר AI</span>
        </button>
      </div>
    </footer>
  );
};
