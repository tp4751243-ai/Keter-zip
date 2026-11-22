import React, { useRef, useState } from 'react';
import {
  FileUp,
  X,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Link2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ContentUnit, RavTextLink } from '../types/typesetter';
import { DocxImporter, DocxImportResult } from '../engine/docx-importer';
import {
  SecondaryImportTier,
  SECONDARY_IMPORT_TIER_LABELS_HE,
  finalizeSecondaryImportReview,
  mergeSecondaryImport,
  SecondaryImportMergeResult,
} from '../engine/secondary-docx-import';
import { useLanguage } from '../i18n/LanguageContext';
import { useEscapeToClose } from './useDialogEscape';
import { Hint } from './Hint';

interface SecondaryDocxImportModalProps {
  /** Live project units — read-only here; nothing is reset or rebuilt. */
  existingUnits: ContentUnit[];
  existingLinks: RavTextLink[];
  /**
   * Called with the MERGED units/links (existing + imported). The parent
   * only sets state from them — the current edits, formatting and unsaved
   * state survive because nothing else is touched.
   */
  onMerge: (units: ContentUnit[], links: RavTextLink[]) => void;
  onClose: () => void;
}

interface StagedFile {
  file: File;
  name: string;
  tier: SecondaryImportTier;
}

const TIER_OPTIONS: SecondaryImportTier[] = [
  'main_text',
  'first_commentary',
  'second_commentary',
  'footnote',
];

/**
 * v0.5.0 Part C — Module 7: import an extra .docx into the OPEN project.
 * The user picks files, assigns each one a text tier, and the import is
 * parsed with the existing `DocxImporter`, linked against the existing
 * paragraphs by dibbur hamatchil, and merged by `mergeSecondaryImport`.
 * Uncertain links (< 0.8 confidence) are held for review and are only
 * added when the user explicitly accepts or reassigns them.
 */
export const SecondaryDocxImportModal: React.FC<SecondaryDocxImportModalProps> = ({
  existingUnits,
  existingLinks,
  onMerge,
  onClose,
}) => {
  const { t, dir } = useLanguage();
  useEscapeToClose(onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [defaultTier, setDefaultTier] = useState<SecondaryImportTier>('first_commentary');
  const [autoLink, setAutoLink] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merge, setMerge] = useState<SecondaryImportMergeResult | null>(null);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, 'accepted' | 'dropped'>>({});
  const [reviewReassign, setReviewReassign] = useState<Record<string, string>>({});
  // Declutter (v0.5.0 follow-up): file picker + tier assignment stay up
  // front; the auto-link toggle lives behind "More options".
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleAddFiles = (files: FileList | File[]) => {
    setError(null);
    const added: StagedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.name.toLowerCase().endsWith('.docx')) continue;
      added.push({ file: f, name: f.name, tier: defaultTier });
    }
    if (added.length === 0) {
      setError(t('נא לבחור קובצי Word בפורמט .docx בלבד.'));
      return;
    }
    setStaged(prev => [...prev, ...added]);
  };

  const handleRunImport = async () => {
    if (staged.length === 0) return;
    setIsImporting(true);
    setError(null);
    try {
      // Parse every staged file with the existing importer, then merge
      // them one by one so each file's links are checked against the
      // growing (existing + already-merged) project.
      let workingUnits = existingUnits;
      let workingLinks = existingLinks;
      let totalAdded = 0;
      let totalApplied = 0;
      const allUncertain: RavTextLink[] = [];
      const allWarnings: string[] = [];
      let lastSummary: SecondaryImportMergeResult | null = null;

      for (const entry of staged) {
        const buffer = await entry.file.arrayBuffer();
        const res: DocxImportResult = await DocxImporter.importDocx(buffer, entry.name);
        // v0.8.0 Part E: keep validation warnings (dropped images, …) for
        // the merge summary below.
        for (const w of res.validation.warnings) {
          if (!allWarnings.includes(w)) allWarnings.push(w);
        }
        const result = mergeSecondaryImport(workingUnits, workingLinks, res, {
          targetTier: entry.tier,
          autoLink,
        });
        workingUnits = result.units;
        workingLinks = result.links;
        totalAdded += result.addedUnits.length;
        totalApplied += result.appliedLinks.length;
        allUncertain.push(...result.uncertainLinks);
        lastSummary = result;
      }

      const combined: SecondaryImportMergeResult = {
        units: workingUnits,
        // Links WITHOUT the uncertain ones (they are held for review);
        // the modal adds accepted ones on confirm.
        links: workingLinks,
        addedUnits: workingUnits.slice(existingUnits.length),
        appliedLinks: [],
        uncertainLinks: allUncertain,
        linkableSources:
          lastSummary?.linkableSources ??
          existingUnits.filter(
            u => u.role === 'main_source' || u.role === 'chapter' || u.role === 'verse'
          ),
        summaryHe: `נוספו ${totalAdded} קטעים מהמסמכים המשניים, וקושרו ${totalApplied} קישורי דיבור המתחיל.` +
          (allWarnings.length > 0
            ? ` אזהרות יבוא: ${allWarnings.join(' ')}`
            : ''),
        summaryEn: `Added ${totalAdded} passages from the secondary documents and linked ${totalApplied} dibbur-hamatchil links.` +
          (allWarnings.length > 0
            ? ` Import warnings: ${allWarnings.join(' ')}`
            : ''),
      };
      setMerge(combined);
      setReviewDecisions({});
      setReviewReassign({});
    } catch (err: unknown) {
      setError(
        t('שגיאה בייבוא קובצי DOCX: ') +
          (err instanceof Error ? err.message : t('קובץ לא תקין'))
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmMerge = () => {
    if (!merge) return;
    const finalLinks = finalizeSecondaryImportReview(
      merge.links,
      merge.uncertainLinks,
      reviewDecisions,
      reviewReassign,
      merge.linkableSources
    );
    onMerge(merge.units, finalLinks);
    onClose();
  };

  return (
    <div
      dir={dir}
      className="keter-dialog-backdrop select-none" onClick={onClose}
    >
      <div className="keter-dialog-surface bg-[var(--ui-surface)] border border-[var(--ui-border)] w-full max-w-2xl rounded-2xl shadow-[var(--ui-floating-shadow)] overflow-hidden flex flex-col max-h-[90vh] text-[var(--ui-text-primary)]" onClick={e => e.stopPropagation()}>
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--ui-selected-bg)] border border-[var(--ui-selected-border)] flex items-center justify-center text-[var(--ui-accent)]">
              <FileUp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">{t('ייבוא מסמך משני לספר הפתוח')}</h2>
              <p className="text-[11px] text-[var(--ui-text-secondary)]">
                {t('מוסיף פירוש או הערות לספר — בלי למחוק או לאפס את מה שכבר נערך')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--ui-surface-hover)] rounded-lg text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
            title={t('סגור')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          <Hint>
            {t('המסמך החדש מצטרף לסוף הספר ומקושר לפסקאות הקיימות לפי דיבור המתחיל. העריכות, העיצוב והשינויים שלא נשמרו — נשארים בדיוק כמו שהם.')}
          </Hint>

          {error && (
            <div className="p-2.5 rounded-lg bg-[var(--ui-danger-bg)] border border-[var(--ui-danger)]/30 text-[var(--ui-danger)] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!merge && (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".docx"
                onChange={e => {
                  if (e.target.files) handleAddFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="w-full py-3 px-4 rounded-lg border-2 border-dashed border-[var(--ui-border-strong)] hover:border-[var(--ui-accent)] bg-[var(--ui-surface-subtle)]/60 hover:bg-[var(--ui-surface-hover)] font-medium flex flex-col items-center justify-center gap-1 transition-all"
              >
                <FileUp className="w-5 h-5 text-[var(--ui-accent)]" />
                <span>{t('בחר קובץ DOCX אחד או יותר')}</span>
                <span className="text-[10px] text-[var(--ui-text-secondary)]">
                  {t('משמר ניקוד, טעמים והדגשות דיבור המתחיל')}
                </span>
              </button>

              <div className="flex items-center gap-2 flex-wrap">
                <label className="font-semibold text-[var(--ui-text-secondary)]">
                  {t('שיוך ברירת מחדל לקבצים:')}
                </label>
                <select
                  value={defaultTier}
                  onChange={e => {
                    const next = e.target.value as SecondaryImportTier;
                    setDefaultTier(next);
                    setStaged(prev => prev.map(s => ({ ...s, tier: next })));
                  }}
                  className="bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--ui-text-primary)]"
                >
                  {TIER_OPTIONS.map(tier => (
                    <option key={tier} value={tier}>
                      {t(SECONDARY_IMPORT_TIER_LABELS_HE[tier])}
                    </option>
                  ))}
                </select>
              </div>

              {/* Declutter: auto-link lives behind "More options". */}
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                aria-expanded={showAdvanced}
                className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ui-accent)] hover:underline"
              >
                {showAdvanced ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>{t('אפשרויות נוספות')}</span>
              </button>
              {showAdvanced && (
                <label className="flex items-center gap-1.5 text-[var(--ui-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoLink}
                    onChange={e => setAutoLink(e.target.checked)}
                  />
                  <span>{t('קשר אוטומטית דיבורי המתחיל למקור הקיים')}</span>
                </label>
              )}

              {staged.length > 0 && (
                <div className="space-y-1.5">
                  {staged.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] flex items-center justify-between gap-2"
                    >
                      <span className="font-medium truncate max-w-[180px]">{item.name}</span>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={item.tier}
                          onChange={e => {
                            const next = e.target.value as SecondaryImportTier;
                            setStaged(prev =>
                              prev.map((it, i) => (i === idx ? { ...it, tier: next } : it))
                            );
                          }}
                          className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded px-2 py-0.5 text-[11px] text-[var(--ui-text-primary)]"
                        >
                          {TIER_OPTIONS.map(tier => (
                            <option key={tier} value={tier}>
                              {t(SECONDARY_IMPORT_TIER_LABELS_HE[tier])}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setStaged(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-[var(--ui-text-muted)] hover:text-[var(--ui-danger)]"
                          title={t('הסר קובץ')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={isImporting}
                    onClick={() => void handleRunImport()}
                    className="w-full py-2 px-4 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white font-semibold transition-colors disabled:opacity-50"
                  >
                    {isImporting
                      ? t('מייבא ומקשר...')
                      : t('ייבא ומזג לתוך הספר הפתוח')}
                  </button>
                </div>
              )}
            </>
          )}

          {merge && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-[var(--ui-success-bg)] border border-[var(--ui-success)]/30 text-[var(--ui-success)] flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">{t(merge.summaryHe)}</div>
                  <div className="text-[11px] opacity-80 mt-0.5">
                    {t('הקטעים החדשים נוספו בסוף הספר. שום דבר קיים לא נמחק ולא השתנה.')}
                  </div>
                </div>
              </div>

              {merge.uncertainLinks.length > 0 && (
                <div className="space-y-2">
                  <div className="font-bold flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                    <span>
                      {t('קישורים לא ודאיים — אשרו או בטלו כל אחד:')} ({merge.uncertainLinks.length})
                    </span>
                  </div>
                  <Hint>
                    {t('קישורים אלו נמצאו בהתאמה חלקית בלבד. רק מה שתאשרו ייכנס לספר.')}
                  </Hint>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {merge.uncertainLinks.map(link => (
                      <div
                        key={link.linkId}
                        className="p-2.5 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] space-y-1.5"
                      >
                        <div className="font-medium">
                          {t('דיבור המתחיל:')} {link.dibburHamatchil}
                        </div>
                        <div className="text-[var(--ui-text-secondary)] truncate">
                          {link.sourceSnippet}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            value={reviewReassign[link.linkId] ?? ''}
                            onChange={e => {
                              const v = e.target.value;
                              setReviewReassign(prev => ({ ...prev, [link.linkId]: v }));
                              if (v) {
                                setReviewDecisions(prev => {
                                  const next = { ...prev };
                                  delete next[link.linkId];
                                  return next;
                                });
                              }
                            }}
                            className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded px-2 py-1 text-[11px] text-[var(--ui-text-primary)]"
                          >
                            <option value="">{t('שייך למקור שהוצע')}</option>
                            {merge.linkableSources.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.rawText.substring(0, 40)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setReviewDecisions(prev => ({
                                ...prev,
                                [link.linkId]: 'accepted',
                              }))
                            }
                            className={`px-2.5 py-1 rounded-lg border font-semibold ${
                              reviewDecisions[link.linkId] === 'accepted'
                                ? 'bg-[var(--ui-success-bg)] border-[var(--ui-success)] text-[var(--ui-success)]'
                                : 'border-[var(--ui-border)] text-[var(--ui-text-primary)]'
                            }`}
                          >
                            {t('אשר')}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setReviewDecisions(prev => ({
                                ...prev,
                                [link.linkId]: 'dropped',
                              }))
                            }
                            className={`px-2.5 py-1 rounded-lg border font-semibold ${
                              reviewDecisions[link.linkId] === 'dropped'
                                ? 'bg-[var(--ui-danger-bg)] border-[var(--ui-danger)] text-[var(--ui-danger)]'
                                : 'border-[var(--ui-border)] text-[var(--ui-text-primary)]'
                            }`}
                          >
                            {t('בטל קישור')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[var(--ui-border)] flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] font-medium transition-colors"
          >
            {t('ביטול')}
          </button>
          {merge && (
            <button
              type="button"
              onClick={handleConfirmMerge}
              className="px-5 py-2 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white font-semibold flex items-center gap-2 shadow-xs transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{t('מזג לספר')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
