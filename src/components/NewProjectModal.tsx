import React from 'react';
import { FilePlus2, X } from 'lucide-react';
import { BookLayoutType } from '../types/typesetter';
import { useLanguage } from '../i18n/LanguageContext';
import { useEscapeToClose } from './useDialogEscape';
import { NewProjectForm } from './NewProjectForm';

interface NewProjectModalProps {
  currentLayoutType?: BookLayoutType;
  /**
   * v0.9.2 Part B — which starter the modal opens on. The Home screen's
   * inline form defaults to 'sample' (its old wizard default); the
   * header menu / palette / keyboard open this modal defaulting to
   * 'blank'. The two entry points keep their defaults through this
   * prop — both render the same NewProjectForm below.
   */
  initialMode?: 'blank' | 'sample';
  onCreateProject: (
    title: string,
    layoutType: BookLayoutType,
    mode: 'blank' | 'sample'
  ) => void;
  onClose: () => void;
}

/**
 * v0.9.4 — the modal is a shell now: the whole form (title, base
 * layouts, grouped historical recipes, custom-layout designer,
 * sample/blank, submit) lives in NewProjectForm, which the Home
 * screen's inline section renders too. One form, one submit handler,
 * one creation path — the modal and Home can no longer drift apart.
 */
export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  currentLayoutType = 'rav_text',
  initialMode = 'blank',
  onCreateProject,
  onClose,
}) => {
  const { t, dir } = useLanguage();
  useEscapeToClose(onClose);

  return (
    <div
      dir={dir}
      className="keter-dialog-backdrop select-none" onClick={onClose}
    >
      <div className="keter-dialog-surface bg-[var(--ui-surface)] border border-[var(--ui-border)] w-full max-w-2xl rounded-2xl shadow-[var(--ui-floating-shadow)] overflow-hidden flex flex-col max-h-[90vh] text-[var(--ui-text-primary)]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--ui-selected-bg)] border border-[var(--ui-selected-border)] flex items-center justify-center text-[var(--ui-accent)]">
              <FilePlus2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                {t("פתיחת פרויקט ספר חדש")}
              </h2>
              <p className="text-[11px] text-[var(--ui-text-secondary)]">
                {t("הגדרת שם הספר, מתכונת עימוד תורנית ותוכן התחלתי")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--ui-surface-hover)] rounded-lg text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
            title={t("סגור")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body — the shared new-project form (same as Home). */}
        <NewProjectForm
          testId="new-project-form-modal"
          className="flex-1 overflow-y-auto p-5 space-y-5 text-xs"
          initialTitle={t("ספר חדש — כתר")}
          initialLayout={currentLayoutType}
          initialMode={initialMode}
          submitLabel={t("צור פרויקט חדש")}
          cancelLabel={t("ביטול")}
          onCancel={onClose}
          onCreateProject={onCreateProject}
        />
      </div>
    </div>
  );
};
