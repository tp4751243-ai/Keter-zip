import React from 'react';
import { BookOpen, Palette, Download, Check } from 'lucide-react';
import { PrimaryWorkMode } from './EditorialStudioHeader';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * v0.4.0 (UX overhaul) — Guided flow bar, always visible under the header.
 * The three work modes become a clear 3-step journey:
 *   1. Open your book → 2. Design it → 3. Export it
 * The current step is highlighted, completed steps get a check mark, and
 * every step says in plain words what happens there. Clicking a step
 * jumps to that mode.
 */
interface GuidedStepsBarProps {
  activeWorkMode: PrimaryWorkMode;
  hasOpenedBook: boolean;
  hasExported: boolean;
  onStepClick: (mode: PrimaryWorkMode) => void;
}

export const GuidedStepsBar: React.FC<GuidedStepsBarProps> = ({
  activeWorkMode,
  hasOpenedBook,
  hasExported,
  onStepClick,
}) => {
  const { t, dir } = useLanguage();

  const steps: Array<{
    id: PrimaryWorkMode;
    step: number;
    labelHe: string;
    descHe: string;
    icon: any;
    done: boolean;
  }> = [
    {
      id: 'home',
      step: 1,
      labelHe: 'פתיחת ספר',
      descHe: 'פתחו קובץ Word או פרויקט, או התחילו ספר חדש',
      icon: BookOpen,
      done: hasOpenedBook,
    },
    {
      id: 'edit',
      step: 2,
      labelHe: 'עיצוב הספר',
      descHe: 'בחרו מראה, גופנים ופריסה — או שאלו את העוזר',
      icon: Palette,
      done: hasOpenedBook && activeWorkMode === 'export',
    },
    {
      id: 'export',
      step: 3,
      labelHe: 'ייצוא לדפוס',
      descHe: 'בדקו והפיקו קובץ PDF או קובץ InDesign',
      icon: Download,
      done: hasExported,
    },
  ];

  return (
    <nav
      dir={dir}
      aria-label={t('שלבי העבודה')}
      className="shrink-0 bg-[var(--ui-surface)] border-b border-[var(--ui-border)] px-4 py-1.5 z-30"
    >
      <ol className="flex items-stretch gap-1 max-w-4xl mx-auto">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const current = activeWorkMode === s.id;
          return (
            <li key={s.id} className="flex items-center gap-1 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => onStepClick(s.id)}
                aria-current={current ? 'step' : undefined}
                title={t(s.descHe)}
                className={`flex items-center gap-2 min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-start transition-all keter-step-btn ${
                  current
                    ? 'bg-[var(--ui-selected-bg)] ring-1 ring-[var(--ui-accent)]/40'
                    : 'hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold transition-colors ${
                    s.done
                      ? 'bg-[var(--ui-success)] text-white'
                      : current
                        ? 'bg-[var(--ui-accent)] text-white'
                        : 'bg-[var(--ui-surface-subtle)] border border-[var(--ui-border-strong)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  {s.done ? <Check className="w-3.5 h-3.5" /> : s.step}
                </span>
                <span className="min-w-0">
                  <span
                    className={`flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${
                      current ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-primary)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {t(s.labelHe)}
                    {current && (
                      <span className="text-[9px] font-medium px-1.5 py-px rounded-full bg-[var(--ui-accent)] text-white">
                        {t('כאן עכשיו')}
                      </span>
                    )}
                    {s.done && !current && (
                      <span className="text-[9px] font-medium text-[var(--ui-success)]">
                        {t('הושלם')}
                      </span>
                    )}
                  </span>
                  <span className="block text-[10px] text-[var(--ui-text-secondary)] truncate">
                    {t(s.descHe)}
                  </span>
                </span>
              </button>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className="w-4 h-px bg-[var(--ui-border-strong)] shrink-0 hidden sm:block"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
