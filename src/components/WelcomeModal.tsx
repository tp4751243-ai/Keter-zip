import React from 'react';
import { BookOpen, Palette, Sparkles, Download, X, Crown } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useEscapeToClose } from './useDialogEscape';

/**
 * v0.4.0 (UX overhaul) — First-run welcome / how-to panel.
 * Shown once on first launch (remembered in localStorage under
 * `keter-welcome-seen-v040`), reopenable any time from the
 * "How to use" button in the header. Short sentences, no jargon:
 * what the app does, in 4 steps.
 */
export const WELCOME_SEEN_KEY = 'keter-welcome-seen-v040';

export const WelcomeModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, dir } = useLanguage();
  useEscapeToClose(onClose);

  const steps: Array<{ icon: any; titleHe: string; bodyHe: string }> = [
    {
      icon: BookOpen,
      titleHe: 'פתחו את הספר',
      bodyHe: 'העלו קובץ Word, פתחו פרויקט שמור, או התחילו מספר לדוגמה.',
    },
    {
      icon: Palette,
      titleHe: 'עצבו אותו',
      bodyHe: 'בחרו עיצוב מוכן בלחיצה אחת, או שנו גופנים וגדלים. הכול מתעדכן מיד על הדף.',
    },
    {
      icon: Sparkles,
      titleHe: 'שאלו את העוזר',
      bodyHe: 'כתבו בעברית מה לשנות — למשל ״הגדל את הגופן״ — והעוזר יעשה זאת בשבילכם.',
    },
    {
      icon: Download,
      titleHe: 'ייצאו לדפוס',
      bodyHe: 'בשלב הייצוא בודקים שהכול תקין ומפיקים קובץ PDF מוכן לדפוס.',
    },
  ];

  return (
    <div
      dir={dir}
      className="keter-dialog-backdrop keter-fade-in" style={{ zIndex: 70 }}
      role="dialog"
      aria-modal="true"
      aria-label={t('איך משתמשים בכתר?')}
      onClick={onClose}
    >
      <div
        className="keter-dialog-surface rounded-2xl max-w-md w-full overflow-hidden keter-pop-in" onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--ui-accent)] flex items-center justify-center shrink-0">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--ui-text-primary)]">
                {t('ברוכים הבאים לכתר')}
              </h2>
              <p className="text-xs text-[var(--ui-text-secondary)] mt-0.5 leading-snug">
                {t('כתר הופך קובץ Word לספר קודש מעומד, מוכן לדפוס.')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('סגור')}
            className="p-1.5 rounded-md hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ol className="px-6 pb-2 space-y-3">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={i} className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-lg bg-[var(--ui-selected-bg)] flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[var(--ui-accent)]" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--ui-text-primary)]">
                    {i + 1}. {t(s.titleHe)}
                  </div>
                  <p className="text-xs text-[var(--ui-text-secondary)] leading-snug mt-0.5">
                    {t(s.bodyHe)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="px-6 py-4 border-t border-[var(--ui-border)] flex items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--ui-text-muted)] leading-snug">
            {t('אפשר לפתוח את המדריך הזה שוב בכל זמן מהכפתור ״איך משתמשים?״ למעלה.')}
          </p>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="px-5 py-2 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white text-sm font-semibold shrink-0 transition-colors"
          >
            {t('הבנתי, מתחילים')}
          </button>
        </div>
      </div>
    </div>
  );
};
