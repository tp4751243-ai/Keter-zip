/**
 * v0.7.0 Part 3 (M2) — Vilna Shas verification panel.
 *
 * Runs the deterministic Shas checks live over the current book:
 * dibbur-hamatchil verification (pass/fail per link, with the suggested
 * re-link target), folio-sequence check, and the flaw scan (widows,
 * orphans, misaligned Rashi/Tosafot boundaries, missing folios, broken
 * dibbur links). "Fix all" applies the one-click fixes through the
 * parent (re-links + keep-together overrides) — the same approval flow
 * as the AI cards, never a silent edit.
 */
import React, { useMemo } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { useEscapeToClose } from './useDialogEscape';
import { folioLatin, folioLatinTalmud, scanShasFlaws, verifyDibburHamatchil } from '../engine/vilna-shas';
import type { ContentUnit, PageTypesetResult, RavTextLink, StructuredDiagnostic } from '../types/typesetter';

interface ShasQaPanelProps {
  pages: PageTypesetResult[];
  units: ContentUnit[];
  links: RavTextLink[];
  layoutType: string;
  diagnostics?: StructuredDiagnostic[];
  onDiagnosticAction?: (diag: StructuredDiagnostic) => void;
  onApplyFixes: () => void;
  onApplyVilnaDefaults: () => void;
  onClose: () => void;
}

export const ShasQaPanel: React.FC<ShasQaPanelProps> = ({
  pages,
  units,
  links,
  layoutType,
  diagnostics,
  onDiagnosticAction,
  onApplyFixes,
  onApplyVilnaDefaults,
  onClose,
}) => {
  const { t, tf, lang } = useLanguage();
  useEscapeToClose(onClose);
  const verification = useMemo(() => verifyDibburHamatchil(units, links), [units, links]);
  const flaws = useMemo(() => scanShasFlaws(pages, units, links), [pages, units, links]);
  const passed = verification.filter(v => v.ok).length;
  const failed = verification.filter(v => !v.ok);
  const fixable = flaws.filter(f => f.autoFixable).length;
  const folioOk = useMemo(() => {
    for (let i = 1; i < pages.length; i++) {
      if (pages[i].pageNumber !== pages[i - 1].pageNumber + 1) return false;
    }
    return true;
  }, [pages]);
  // v0.8.0 Part C (§9): surface the collision counts the paginators
  // compute but never showed, plus units with no rendered lines (the
  // paginateDocument post-pass also records these on the document).
  const totalCollisions = useMemo(
    () => pages.reduce((acc, pg) => acc + (pg.layoutScore?.collisionCount ?? 0), 0),
    [pages]
  );
  const unitsWithNoLines = useMemo(() => {
    const placed = new Set<string>();
    for (const pg of pages) {
      for (const l of [
        ...pg.sourceLines,
        ...pg.rashiLines,
        ...pg.tosafotLines,
        ...(pg.footnoteLines ?? []),
        ...(pg.column2Lines ?? []),
        ...(pg.sideNoteLines ?? []),
        ...(pg.tertiaryLines ?? []),
      ]) {
        if (l.unitId) placed.add(l.unitId);
        for (const w of l.words ?? []) {
          if (w.unitId) placed.add(w.unitId);
        }
      }
    }
    return units.filter(u => u.rawText?.trim() && !placed.has(u.id)).length;
  }, [pages, units]);

  // v0.9.6 — solid opaque surface (was bg-[var(--ui-panel-bg)] with
  // --ui-panel-bg undefined → fully transparent card, see MANIFEST)
  // + shared dimmed backdrop (was bg-black/40, no blur).
  return (
    <div className="keter-dialog-backdrop" onClick={onClose} data-testid="shas-qa-panel">
      <div className="keter-dialog-surface w-[560px] max-w-[92vw] max-h-[86vh] flex flex-col rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] shadow-[var(--ui-floating-shadow)] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--ui-border)]">
          <span className="font-semibold text-sm">{t('בדיקת ש״ס וילנא')}</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="px-2 py-0.5 rounded hover:bg-[var(--ui-hover)]" title={t('סגור')}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
          <div>
            <div className="font-semibold text-xs mb-1">{t('אימות דיבור המתחיל')}</div>
            <div>{t('עברו')}: {passed} · {t('נכשלו')}: {failed.length}</div>
            {failed.slice(0, 10).map(v => (
              <div key={v.linkId} className="text-xs mt-1 text-red-700">
                ✗ “{v.dibburHamatchil}” — {v.suggestedSourceUnitId ? t('נמצאה יחידת מקור מתאימה — ניתן לקשר מחדש') : t('לא נמצאה יחידת מקור תואמת')}
              </div>
            ))}
          </div>
          <div>
            <div className="font-semibold text-xs mb-1">{t('רצף דפים')}</div>
            <div>{folioOk ? t('רצף מספרי העמודים תקין') : t('רצף מספרי העמודים שבור — חסרים עמודים')}</div>
            <div className="text-xs text-[var(--ui-muted)]">
              {pages.slice(0, 6).map(p => `${p.pageNumberHebrew} (${layoutType === 'rav_text' ? folioLatinTalmud(p.pageNumber) : folioLatin(p.pageNumber)})`).join(' · ')}
              {pages.length > 6 ? ' …' : ''}
            </div>
          </div>
          <div>
            <div className="font-semibold text-xs mb-1">{t('התנגשויות בין שכבות')}</div>
            <div>
              {totalCollisions === 0
                ? t('לא נמצאו התנגשויות בין תיבות טקסט')
                : tf('נמצאו {count} התנגשויות בין תיבות טקסט — ראה פירוט בהערות העימוד', { count: totalCollisions })}
            </div>
            <div>
              {unitsWithNoLines === 0
                ? t('כל היחידות מוצגות בעימוד')
                : tf('{count} יחידות תוכן ללא שורות מוצגות בעימוד', { count: unitsWithNoLines })}
            </div>
          </div>
          <div>
            <div className="font-semibold text-xs mb-1">{t('פגמי עימוד')} ({flaws.length})</div>
            {flaws.length === 0 && <div className="text-xs">{t('לא נמצאו פגמים')}</div>}
            {flaws.slice(0, 20).map((f, i) => (
              <div key={i} className="text-xs mt-0.5">
                • {f.messageHe} {f.autoFixable ? `(${t('ניתן לתיקון')})` : `(${t('דורש טיפול ידני')})`}
              </div>
            ))}
          </div>

          {diagnostics && diagnostics.length > 0 && (
            <div data-testid="shas-diagnostics-list" className="pt-2 border-t border-[var(--ui-border)] space-y-1.5">
              <div className="font-semibold text-xs">
                {t('אבחונים מובנים')} ({diagnostics.length})
              </div>
              {diagnostics.slice(0, 12).map(diag => (
                <div
                  key={diag.id}
                  className={`p-2 rounded border text-xs flex items-center justify-between gap-2 ${
                    diag.severity === 'critical'
                      ? 'bg-[var(--ui-danger-bg)] border-[var(--ui-danger)]/35 text-[var(--ui-danger)]'
                      : diag.severity === 'warning'
                        ? 'bg-[var(--ui-warning-bg)] border-[var(--ui-warning)]/35 text-[var(--ui-warning)]'
                        : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)]'
                  }`}
                >
                  <span>{lang === 'en' ? diag.messageEn : diag.messageHe}</span>
                  {diag.fixAction && onDiagnosticAction && (
                    <button
                      type="button"
                      onClick={() => onDiagnosticAction(diag)}
                      className="shrink-0 px-2 py-0.5 rounded bg-[var(--ui-surface)] border border-[var(--ui-border)] text-[10px] font-semibold text-[var(--ui-text-primary)] hover:bg-[var(--ui-hover)]"
                    >
                      {lang === 'en' ? diag.fixAction.labelEn : diag.fixAction.labelHe}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-3 py-2 border-t border-[var(--ui-border)]">
          <button
            type="button"
            onClick={onApplyFixes}
            disabled={fixable === 0}
            className="px-3 py-1.5 rounded border border-[var(--ui-border)] text-xs hover:bg-[var(--ui-hover)] disabled:opacity-50"
          >
            {t('תקן את הניתנים לתיקון')} ({fixable})
          </button>
          <button
            type="button"
            onClick={onApplyVilnaDefaults}
            className="px-3 py-1.5 rounded border border-[var(--ui-border)] text-xs hover:bg-[var(--ui-hover)]"
          >
            {t('החל כללי וילנא')}
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded border border-[var(--ui-border)] text-xs hover:bg-[var(--ui-hover)]">
            {t('סגור')}
          </button>
        </div>
      </div>
    </div>
  );
};
