import React, { useMemo } from 'react';
import { CheckCheck, SpellCheck, Wrench, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  TEXT_ISSUE_KIND_META,
  TEXT_ISSUE_KIND_ORDER,
  groupByKind,
} from '../engine/text-proofing';
import type { TextIssue, TextIssueKind } from '../engine/text-proofing';

interface ProofreadingPanelProps {
  issues: TextIssue[];
  /** Fix one issue (parent applies applyFix to the owning unit's text). */
  onFixIssue: (issue: TextIssue) => void;
  /** Fix every auto-fixable issue of one kind. */
  onFixGroup: (kind: TextIssueKind) => void;
  onClose: () => void;
}

export const ProofreadingPanel: React.FC<ProofreadingPanelProps> = ({
  issues,
  onFixIssue,
  onFixGroup,
  onClose,
}) => {
  const { t, tf, lang, dir } = useLanguage();
  const grouped = useMemo(() => groupByKind(issues), [issues]);
  const total = issues.length;
  const fixableCount = useMemo(() => issues.filter(i => i.autoFixable).length, [issues]);

  const messageFor = (issue: TextIssue) =>
    lang === 'en' ? issue.messageEn : issue.messageHe;

  return (
    <div
      dir={dir}
      className="fixed bottom-11 left-5 w-[28rem] max-w-[calc(100vw-2.5rem)] max-h-[70vh] flex flex-col bg-[var(--ui-surface)] border border-[var(--ui-border)] shadow-[var(--ui-floating-shadow)] rounded-xl z-50 overflow-hidden text-[var(--ui-text-primary)]"
    >
      {/* Header */}
      <div className="h-10 shrink-0 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-3.5">
        <div className="flex items-center gap-2">
          <SpellCheck className="w-4 h-4 text-[var(--ui-accent)]" />
          <span className="text-xs font-semibold text-[var(--ui-text-primary)]">
            {t('הגהה')}
          </span>
          <span className="text-[11px] text-[var(--ui-text-secondary)]">
            {total === 0
              ? t('לא נמצאו בעיות')
              : tf('{count} בעיות', { count: total }) +
                (fixableCount > 0 ? ` · ${tf('{count} ניתנות לתיקון אוטומטי', { count: fixableCount })}` : '')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
          title={t('סגירה')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs">
        {total === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-[var(--ui-text-secondary)]">
            <CheckCheck className="w-8 h-8 text-[var(--ui-accent)]" />
            <span>{t('הטקסט נקי — לא נמצאו בעיות הגהה.')}</span>
          </div>
        )}

        {TEXT_ISSUE_KIND_ORDER.map(kind => {
          const group = grouped[kind];
          if (group.length === 0) return null;
          const meta = TEXT_ISSUE_KIND_META[kind];
          const fixable = group.filter(i => i.autoFixable);
          return (
            <section key={kind}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-[var(--ui-text-primary)]">
                  {lang === 'en' ? meta.labelEn : meta.labelHe}
                  <span className="ms-1.5 text-[11px] font-normal text-[var(--ui-text-secondary)]">
                    ({group.length})
                  </span>
                </span>
                <button
                  onClick={() => onFixGroup(kind)}
                  disabled={fixable.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--ui-accent)] text-white hover:opacity-90 disabled:opacity-40 text-[11px]"
                >
                  <Wrench className="w-3 h-3" />
                  {tf('תקן הכל ({count})', { count: fixable.length })}
                </button>
              </div>

              <ul className="space-y-1.5">
                {group.map(issue => (
                  <li
                    key={issue.id}
                    className="flex items-start gap-2 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--ui-text-primary)] leading-snug">
                        {messageFor(issue)}
                      </div>
                      <div className="text-[11px] text-[var(--ui-text-muted)] mt-0.5">
                        {issue.unitId ? `${t('יחידה')}: ${issue.unitId} · ` : ''}
                        {issue.pageNumber ? `${t('עמוד')} ${issue.pageNumber} · ` : ''}
                        {t('מיקום')}: {issue.offset}
                        {issue.autoFixable && issue.suggestion !== ''
                          ? ` · ${t('הצעה')}: “${issue.suggestion}”`
                          : issue.autoFixable
                            ? ` · ${t('הצעה')}: ${t('מחיקה')}`
                            : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => onFixIssue(issue)}
                      disabled={!issue.autoFixable}
                      className="shrink-0 p-1.5 rounded-lg border border-[var(--ui-border)] hover:bg-[var(--ui-surface-hover)] disabled:opacity-40"
                      title={issue.autoFixable ? t('תקן') : t('דורש תיקון ידני')}
                    >
                      <Wrench className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
};
