import React from 'react';
import { DocxImportHub } from './DocxImportHub';
import { classifyForImport, type AutoLayoutImportInfo } from '../engine/auto-layout';
import { ContentUnit, RavTextLink } from '../types/typesetter';
import { FileUp, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useEscapeToClose } from './useDialogEscape';

interface DocxImportModalProps {
  onClose: () => void;
  /**
   * v0.9.0 Part C — the 4th argument is the auto-layout decision for the
   * imported units (classification + chosen recipe + the one-line
   * explanation). App applies the recipe and shows the line with a
   * "Change layout" action. It is always present for real imports and
   * samples; older callers may omit it (App then keeps the current layout).
   */
  onImportUnits: (units: ContentUnit[], title: string, links?: RavTextLink[], autoLayout?: AutoLayoutImportInfo) => void;
}

/**
 * v0.9.7 — the modal is now a thin shell around the ONE shared
 * DocxImportHub (also rendered inline on the Home screen). All file
 * handling, role tagging, linking, review queues and samples live in
 * the hub; this file only owns the overlay + header chrome.
 */
export const DocxImportModal: React.FC<DocxImportModalProps> = ({
  onClose,
  onImportUnits,
}) => {
  const { t } = useLanguage();
  useEscapeToClose(onClose);

  return (
    <div className="keter-dialog-backdrop select-none" onClick={onClose}>
      <div className="keter-dialog-surface w-full max-w-2xl rounded-xl overflow-hidden flex flex-col text-[var(--ui-text-primary)] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <FileUp className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--ui-text-primary)]">
                {t("יבוא קבצי Word")}
              </h2>
              <p className="text-[11px] text-[var(--ui-text-secondary)]">
                {t("ניתן להעלות קובץ גמרא + קובץ רש״י + קובץ תוספות — המערכת תקשר ביניהם אוטומטית!")}
              </p>
            </div>
          </div>
          <button onClick={onClose} title={t("סגור")} className="p-1 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 text-xs overflow-y-auto flex-1">
          <DocxImportHub
            variant="light"
            testIdPrefix="docx-hub-modal"
            onImportUnits={onImportUnits}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
};

// Re-export for callers/tests that import the classifier through the modal path.
export { classifyForImport };
