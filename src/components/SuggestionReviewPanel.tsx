import React from 'react';
import { Check, X, FileUp, User } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useEscapeToClose } from './useDialogEscape';

/**
 * v0.3.0 — Suggest / approve workflow for exported `.keter` snapshots.
 *
 * A Suggestion is plain data stored inside the project file itself
 * (`.keter` / `.keter.json`): no server, no accounts, no live
 * collaboration. One person exports a snapshot, another (or the same
 * person later) opens it, reviews each pending suggestion, and approves
 * or rejects it with one click. Approving applies the `after` value to
 * the target unit through the parent's normal content-update path, which
 * keeps the change undoable through the existing history.
 */
export interface Suggestion {
  id: string;
  /** Who proposed the change (free text — a name, not an account). */
  author: string;
  /** What kind of change this is. */
  kind: 'text' | 'design' | 'link' | 'other';
  /** Id of the ContentUnit this suggestion targets. */
  targetUnitId: string;
  /** Human-readable label for the target (e.g. dibbur or unit title). */
  targetLabel?: string;
  /** Value before the suggestion. */
  before: string;
  /** Value after the suggestion, applied on approve. */
  after: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

interface SuggestionReviewPanelProps {
  suggestions: Suggestion[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onClose: () => void;
}

const KIND_LABELS: Record<Suggestion['kind'], string> = {
  text: 'תיקון טקסט',
  design: 'שינוי עיצוב',
  link: 'שינוי קישור',
  other: 'הצעה אחרת',
};

export const SuggestionReviewPanel: React.FC<SuggestionReviewPanelProps> = ({
  suggestions,
  onApprove,
  onReject,
  onClose,
}) => {
  const { t, lang } = useLanguage();
  useEscapeToClose(onClose);
  const pending = suggestions.filter(s => s.status === 'pending');
  const decided = suggestions.filter(s => s.status !== 'pending');

  return (
    <div className="keter-dialog-backdrop select-none" onClick={onClose}>
      <div className="keter-dialog-surface w-full max-w-2xl rounded-xl overflow-hidden flex flex-col text-[var(--ui-text-primary)] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <FileUp className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--ui-text-primary)]">
                {t('סקירת הצעות לשינוי')}
              </h2>
              <p className="text-[11px] text-[var(--ui-text-secondary)]">
                {pending.length === 0
                  ? t('אין הצעות ממתינות — כל ההצעות כבר הוכרעו.')
                  : `${t('הצעות ממתינות לאישור:')} ${pending.length}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
            title={t('סגור')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs overflow-y-auto flex-1">
          {pending.length === 0 && decided.length === 0 && (
            <p className="text-[var(--ui-text-secondary)] text-center py-8">
              {t('לא נמצאו הצעות בקובץ הפרויקט.')}
            </p>
          )}

          {pending.map(s => (
            <div
              key={s.id}
              className="bg-[var(--ui-surface-subtle)] border border-amber-700/50 rounded-lg p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="font-semibold text-[var(--ui-text-primary)] truncate">{s.author}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] shrink-0">
                    {t(KIND_LABELS[s.kind])}
                  </span>
                </div>
                <span className="text-[10px] text-[var(--ui-text-muted)] shrink-0">
                  {new Date(s.createdAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'he-IL')}
                </span>
              </div>

              {s.targetLabel && (
                <p className="text-[var(--ui-text-secondary)]">
                  {t('יעד:')} <span className="text-[var(--ui-text-primary)] font-medium">{s.targetLabel}</span>
                </p>
              )}

              {/* Before / after diff */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-rose-950/50 border border-rose-800/60 p-2">
                  <p className="text-[10px] font-semibold text-rose-300 mb-1">{t('לפני')}</p>
                  <p className="text-[var(--ui-text-primary)] break-words">{s.before || '—'}</p>
                </div>
                <div className="rounded-md bg-emerald-950/50 border border-emerald-800/60 p-2">
                  <p className="text-[10px] font-semibold text-emerald-300 mb-1">{t('אחרי')}</p>
                  <p className="text-[var(--ui-text-primary)] break-words">{s.after || '—'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => onApprove(s.id)}
                  className="flex-1 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{t('אישור')}</span>
                </button>
                <button
                  onClick={() => onReject(s.id)}
                  className="flex-1 py-1.5 bg-[var(--ui-surface-hover)] hover:bg-[var(--ui-hover)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] rounded-md text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{t('דחייה')}</span>
                </button>
              </div>
            </div>
          ))}

          {decided.length > 0 && (
            <div className="pt-2">
              <p className="text-[var(--ui-text-secondary)] font-medium mb-2">
                {t('הצעות שהוכרעו:')} {decided.length}
              </p>
              <div className="space-y-1.5">
                {decided.map(s => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-[11px]"
                  >
                    <span className="text-[var(--ui-text-secondary)] truncate">
                      {s.author} — {t(KIND_LABELS[s.kind])}
                      {s.targetLabel ? ` — ${s.targetLabel}` : ''}
                    </span>
                    <span
                      className={
                        s.status === 'approved'
                          ? 'text-emerald-400 font-semibold shrink-0'
                          : 'text-[var(--ui-text-muted)] shrink-0'
                      }
                    >
                      {s.status === 'approved' ? t('אושר') : t('נדחה')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-t border-[var(--ui-border)] px-5 flex items-center justify-between text-xs">
          <span className="text-[var(--ui-text-secondary)]">
            {t('אישור מחיל את השינוי דרך מסלול העדכון הרגיל — ניתן לבטל אותו.')}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[var(--ui-surface-hover)] hover:bg-[var(--ui-hover)] text-[var(--ui-text-secondary)] rounded font-medium transition-colors"
          >
            {t('סגור')}
          </button>
        </div>
      </div>
    </div>
  );
};
