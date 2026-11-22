import React from 'react';
import { AlertTriangle, Save, Trash2, X } from 'lucide-react';

interface UnsavedChangesModalProps {
  documentTitle: string;
  actionDescriptionHe: string;
  onSaveAndContinue: () => void;
  onDiscardAndContinue: () => void;
  onCancel: () => void;
}

export const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
  documentTitle,
  actionDescriptionHe,
  onSaveAndContinue,
  onDiscardAndContinue,
  onCancel,
}) => {
  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 select-none"
    >
      <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] w-full max-w-md rounded-2xl shadow-[var(--ui-floating-shadow)] overflow-hidden flex flex-col text-[var(--ui-text-primary)]">
        {/* Header */}
        <div className="h-12 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[var(--ui-warning)]" />
            <h2 className="text-xs font-bold text-[var(--ui-text-primary)]">
              שינויים שלא נשמרו לקובץ פרויקט
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 hover:bg-[var(--ui-surface-hover)] rounded-lg text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
            title="ביטול"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3 text-xs leading-relaxed">
          <p className="text-[var(--ui-text-primary)] font-medium">
            בפרויקט הנוכחי{' '}
            <strong className="text-[var(--ui-accent)]">&quot;{documentTitle}&quot;</strong> קיימים
            שינויי תוכן או עיצוב שטרם נשמרו לקובץ פרויקט (`.keter.json`).
          </p>
          <p className="text-[var(--ui-text-secondary)]">
            האם ברצונך לשמור את הפרויקט הנוכחי לפני ביצוע הפעולה ({actionDescriptionHe})?
          </p>
        </div>

        {/* Footer Actions: Save, Discard, Cancel */}
        <div className="px-4 py-3.5 bg-[var(--ui-surface-subtle)] border-t border-[var(--ui-border)] flex items-center justify-end gap-2 text-xs">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg bg-[var(--ui-surface)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] font-medium transition-colors"
          >
            ביטול (Cancel)
          </button>
          <button
            onClick={onDiscardAndContinue}
            className="px-3.5 py-1.5 rounded-lg bg-[var(--ui-danger-bg)] hover:opacity-90 border border-[var(--ui-danger)]/40 text-[var(--ui-danger)] font-medium flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>המשך ללא שמירה (Discard)</span>
          </button>
          <button
            onClick={onSaveAndContinue}
            className="px-4 py-1.5 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-[var(--ui-accent-fg)] font-semibold flex items-center gap-1.5 shadow-2xs transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            <span>שמור והמשך (Save)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
