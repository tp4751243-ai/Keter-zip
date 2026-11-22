/**
 * Keter Typesetter — QA Fix List (v0.3.0, Module E)
 *
 * Lists the QA issues for the current page / book with, for each issue:
 *  - the reason it failed ("page failed, here's why"),
 *  - what to do about it (a plain-language suggested fix per category),
 *  - a one-click "apply fix" button when the issue is auto-fixable.
 *
 * Issue shape is wired directly to `QaIssue` from `typesetter.ts` (the shape
 * `qa-engine.ts` produces). This component never fixes anything itself — it
 * reports the issue to the parent through `onApplyFix(issue)`; the parent
 * decides what the fix does (re-typeset, run the balancing pass, nudge the
 * layout, …) and re-runs QA.
 *
 * Original offline code. No network, no new dependencies.
 */

import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Info, Wrench, X } from 'lucide-react';
import { QaIssue } from '../types/typesetter';
import { useLanguage } from '../i18n/LanguageContext';

export interface QaFixListProps {
  /** QA issues for the current page (or the whole book when `scope` is 'book'). */
  issues: QaIssue[];
  /** Called when the user clicks "apply fix" on one issue. */
  onApplyFix: (issue: QaIssue) => void;
  /** Close the panel. */
  onClose: () => void;
  /** Page the issues belong to (shown in the header when scope is 'page'). */
  pageNumber?: number;
  /** Whether `issues` cover one page or the whole book. Default 'page'. */
  scope?: 'page' | 'book';
  /** Optional title override. */
  title?: string;
}

/**
 * Plain-language "what to do" guidance per QA category. These are suggestions
 * shown next to the engine's own reason text — they do not change the issue.
 */
const FIX_GUIDANCE: Record<QaIssue['category'], { he: string; en: string }> = {
  clipping: {
    he: 'מה לעשות: הקטן מעט את גודל הגופן או את מרווח השורות בעמוד, או העבר שורה לעמוד הבא.',
    en: 'What to do: slightly reduce the font size or line spacing on this page, or move a line to the next page.',
  },
  collision: {
    he: 'מה לעשות: הזז את האובייקטים החופפים — הקטן עיטור, הזז הערת שוליים, או עמד מחדש את העמוד.',
    en: 'What to do: move the overlapping objects apart — shrink an ornament, move a footnote, or re-typeset the page.',
  },
  orphan_mark: {
    he: 'מה לעשות: ודא שהניקוד צמוד לאות הבסיס שלו; תקן את המילה או עמד מחדש את השורה.',
    en: 'What to do: make sure the nikud/taamim mark sits on its base letter; fix the word or re-typeset the line.',
  },
  broken_link: {
    he: 'מה לעשות: בדוק שהמקור והמפרש המקושרים קיימים, וקשר אותם מחדש אם הקישור נשבר.',
    en: 'What to do: check that the linked source and commentary still exist, and re-link them if the link broke.',
  },
  missing_glyph: {
    he: 'מה לעשות: החלף גופן שחסר בו התו, או החלף את התו בתו נתמך.',
    en: 'What to do: switch to a font that contains the missing glyph, or replace the character.',
  },
  balance: {
    he: 'מה לעשות: הרץ את מעבר איזון הספר — הוא מאזן טורים ומתקן יתומים ואלמנות.',
    en: 'What to do: run the whole-book balancing pass — it evens out columns and fixes widows and orphans.',
  },
  widow_orphan: {
    he: 'מה לעשות: הרץ את מעבר איזון הספר, או הוסף הוראת מעבר מעוגנת כדי לקבוע היכן העמוד מסתיים.',
    en: 'What to do: run the whole-book balancing pass, or add an anchored break instruction to pin where the page ends.',
  },
  whitespace: {
    he: 'מה לעשות: בדוק את ריווח המילים בשורה — לעיתים עימוד מחדש עם רוחב טור מעט שונה פותר זאת.',
    en: 'What to do: check the word spacing on the line — re-typesetting with a slightly different column width often fixes it.',
  },
  continuation: {
    he: 'מה לעשות: בדוק את מספר הדף העברי ואת סימני ההמשך בין העמודים.',
    en: 'What to do: check the Hebrew folio number and the continuation markers between pages.',
  },
  footnote_placement: {
    he: 'מה לעשות: הקטן את אזור ההערות או העבר הערה לעמוד הבא.',
    en: 'What to do: shrink the footnote area or move a footnote to the next page.',
  },
};

const SEVERITY_STYLE: Record<QaIssue['severity'], { badge: string; labelHe: string }> = {
  critical: { badge: 'bg-red-100 text-red-800 border-red-300', labelHe: 'קריטי' },
  warning: { badge: 'bg-amber-100 text-amber-800 border-amber-300', labelHe: 'אזהרה' },
  info: { badge: 'bg-sky-100 text-sky-800 border-sky-300', labelHe: 'מידע' },
};

export const QaFixList: React.FC<QaFixListProps> = ({
  issues,
  onApplyFix,
  onClose,
  pageNumber,
  scope = 'page',
  title,
}) => {
  const { t, tf, dir, lang } = useLanguage();

  const counts = useMemo(() => {
    return {
      critical: issues.filter(i => i.severity === 'critical' && !i.autoFixed).length,
      warning: issues.filter(i => i.severity === 'warning' && !i.autoFixed).length,
      info: issues.filter(i => i.severity === 'info').length,
      autoFixed: issues.filter(i => i.autoFixed).length,
    };
  }, [issues]);

  const failed = counts.critical > 0;

  return (
    <div
      dir={dir}
      className="flex flex-col h-full bg-[var(--ui-surface)] text-[var(--ui-text-primary)]"
      role="dialog"
      aria-label={t('רשימת תיקוני בקרת איכות')}
    >
      {/* Header — "page failed, here's why" */}
      <div className="shrink-0 px-4 py-3 border-b border-[var(--ui-border)] flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold">
            {failed ? (
              <AlertTriangle className="w-4 h-4 text-red-600" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            )}
            <span>
              {title ??
                (scope === 'book'
                  ? t('בקרת איכות — כל הספר')
                  : pageNumber !== undefined
                  ? tf('בקרת איכות — דף {page}', { page: pageNumber })
                  : t('בקרת איכות — דף נוכחי'))}
            </span>
          </div>
          <p className="text-xs text-[var(--ui-text-secondary)] mt-1">
            {issues.length === 0
              ? t('לא נמצאו בעיות. העמוד מוכן לדפוס.')
              : failed
              ? tf('הדף נכשל בבדיקה: {critical} בעיות קריטיות, {warning} אזהרות. הסיבה לכל בעיה מופיעה למטה.', { critical: counts.critical, warning: counts.warning })
              : tf('נמצאו {count} הערות ({warning} אזהרות, {info} מידע). אין בעיות קריטיות.', { count: issues.length, warning: counts.warning, info: counts.info })}
            {counts.autoFixed > 0 &&
              tf(' {count} תוקנו אוטומטית על ידי המנוע.', { count: counts.autoFixed })}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)]"
          title={t('סגור')}
          aria-label={t('סגור')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Issue list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {issues.length === 0 && (
          <div className="text-center text-sm text-[var(--ui-text-secondary)] py-8">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
            {t('אין בעיות להציג.')}
          </div>
        )}
        {issues.map(issue => {
          // v0.9.1 — defensive: an issue whose severity/category is not
          // in the tables (e.g. a newer engine category, or a stale
          // snapshot) falls back instead of throwing — the same
          // unguarded-label pattern that crashed Page design.
          const sev = SEVERITY_STYLE[issue.severity] ?? SEVERITY_STYLE.info;
          const guidance = FIX_GUIDANCE[issue.category];
          const guidanceText =
            lang === 'en' ? guidance?.en ?? issue.message : guidance?.he ?? issue.message;
          return (
            <div
              key={issue.id}
              className="border border-[var(--ui-border)] rounded-lg px-3 py-2.5 bg-[var(--ui-surface)]"
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${sev.badge}`}
                >
                  {issue.severity === 'critical'
                    ? t('קריטי')
                    : issue.severity === 'warning'
                    ? t('אזהרה')
                    : t('מידע')}
                </span>
                <span className="text-[10px] text-[var(--ui-text-secondary)] font-mono">
                  {issue.category}
                  {issue.pageNumber !== undefined ? ` · ${t('דף')} ${issue.pageNumber}` : ''}
                </span>
              </div>

              {/* Reason — why the page failed */}
              <p className="text-[13px] leading-snug mt-1.5 font-medium">{issue.message}</p>

              {/* What to do */}
              <p className="text-xs text-[var(--ui-text-secondary)] leading-snug mt-1 flex gap-1">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>{guidanceText}</span>
              </p>

              {issue.unitId && (
                <p className="text-[11px] text-[var(--ui-text-secondary)] mt-1 font-mono truncate">
                  {t('יחידה')}: {issue.unitId}
                </p>
              )}

              <div className="flex items-center gap-2 mt-2">
                {issue.autoFixed ? (
                  <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t('תוקן אוטומטית')}
                  </span>
                ) : issue.autoFixable ? (
                  <button
                    onClick={() => onApplyFix(issue)}
                    className="text-xs font-bold px-2.5 py-1 rounded-md bg-[var(--ui-accent)] text-white hover:opacity-90 flex items-center gap-1"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    {t('החל תיקון')}
                  </button>
                ) : (
                  <span className="text-xs text-[var(--ui-text-secondary)]">
                    {t('דורש תיקון ידני — אין תיקון אוטומטי לבעיה זו.')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
