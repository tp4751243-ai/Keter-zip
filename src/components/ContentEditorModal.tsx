import React, { useState } from 'react';
import { BookLayoutType, ContentUnit } from '../types/typesetter';
import { Edit3, Check, X, FileText, Trash2, BookOpen, Layers } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface ContentEditorModalProps {
  currentUnits: ContentUnit[];
  currentTitle: string;
  layoutType: BookLayoutType;
  onClose: () => void;
  onSave: (newUnits: ContentUnit[], newTitle: string, suggestedLayout?: BookLayoutType) => void;
}

export const ContentEditorModal: React.FC<ContentEditorModalProps> = ({
  currentUnits,
  currentTitle,
  layoutType,
  onClose,
  onSave,
}) => {
  const { t } = useLanguage();
  const [title, setTitle] = useState(currentTitle);
  // v0.9.8 Uniformity Audit — no layout switch here any more: the
  // preset bar (which was the only thing that changed the layout) is
  // removed; the layout lives with the layout picker / Design panel.
  const activeLayout = layoutType;

  // Separate texts by role
  const sourceInit = currentUnits
    .filter(u => u.role === 'main_source' || u.role === 'chapter' || u.role === 'heading')
    .map(u => u.rawText)
    .join('\n\n');
  const rashiInit = currentUnits
    .filter(u => u.role === 'primary_comment')
    .map(u => u.rawText)
    .join('\n\n');
  const tosafotInit = currentUnits
    .filter(u => u.role === 'secondary_comment')
    .map(u => u.rawText)
    .join('\n\n');
  const footnoteInit = currentUnits
    .filter(u => u.role === 'footnote')
    .map(u => u.rawText)
    .join('\n\n');

  const [sourceText, setSourceText] = useState(sourceInit || '');
  const [rashiText, setRashiText] = useState(rashiInit || '');
  const [tosafotText, setTosafotText] = useState(tosafotInit || '');
  const [footnoteText, setFootnoteText] = useState(footnoteInit || '');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleApply = () => {
    setValidationError(null);
    const newUnits: ContentUnit[] = [];
    let order = 0;

    const existingSources = currentUnits.filter(
      u => u.role === 'main_source' || u.role === 'chapter' || u.role === 'heading'
    );
    const existingRashis = currentUnits.filter(u => u.role === 'primary_comment');
    const existingTosafots = currentUnits.filter(u => u.role === 'secondary_comment');
    const existingFootnotes = currentUnits.filter(u => u.role === 'footnote');

    // 1. Process Source / Main Text (preserving original unit ID, textRuns & footnote references when text is unchanged)
    const sParagraphs = sourceText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    for (let i = 0; i < sParagraphs.length; i++) {
      const p = sParagraphs[i];
      const matchedExisting =
        existingSources[i]?.rawText === p
          ? existingSources[i]
          : existingSources.find(u => u.rawText === p);

      if (matchedExisting) {
        newUnits.push({
          ...matchedExisting,
          order: ++order,
        });
        continue;
      }

      const isHeading =
        p.startsWith('פרק ') ||
        p.startsWith('פֶּרֶק ') ||
        p.startsWith('סִימָן ') ||
        p.startsWith('סימן ');

      newUnits.push({
        id: existingSources[i]?.id || `custom-src-${++order}`,
        role: isHeading ? 'chapter' : 'main_source',
        rawText: p,
        styleName: isHeading ? 'Chapter-Title' : 'Normal',
        order: ++order,
        hierarchyLevel: isHeading ? 1 : 2,
      });
    }

    // 2. Process Rashi / Commentary 1 (if in multi-text layout)
    if (
      activeLayout === 'rav_text' ||
      activeLayout === 'mikraot_gedolot' ||
      activeLayout === 'source_top_commentary_bottom'
    ) {
      const rParagraphs = rashiText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
      for (let i = 0; i < rParagraphs.length; i++) {
        const p = rParagraphs[i];
        const matchedExisting =
          existingRashis[i]?.rawText === p
            ? existingRashis[i]
            : existingRashis.find(u => u.rawText === p);

        if (matchedExisting) {
          newUnits.push({
            ...matchedExisting,
            order: ++order,
          });
          continue;
        }

        let dibbur: string | undefined;
        const colonIdx = p.indexOf(':');
        if (colonIdx > 0 && colonIdx < 40) dibbur = p.substring(0, colonIdx);

        newUnits.push({
          id: existingRashis[i]?.id || `custom-rashi-${++order}`,
          role: 'primary_comment',
          rawText: p,
          styleName: 'Rashi Script',
          order: ++order,
          hierarchyLevel: 3,
          dibburHamatchil: dibbur,
          linkedSourceId: existingRashis[i]?.linkedSourceId,
        });
      }

      // 3. Process Tosafot / Commentary 2
      const tParagraphs = tosafotText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
      for (let i = 0; i < tParagraphs.length; i++) {
        const p = tParagraphs[i];
        const matchedExisting =
          existingTosafots[i]?.rawText === p
            ? existingTosafots[i]
            : existingTosafots.find(u => u.rawText === p);

        if (matchedExisting) {
          newUnits.push({
            ...matchedExisting,
            order: ++order,
          });
          continue;
        }

        let dibbur: string | undefined;
        const colonIdx = p.indexOf(':');
        if (colonIdx > 0 && colonIdx < 40) dibbur = p.substring(0, colonIdx);

        newUnits.push({
          id: existingTosafots[i]?.id || `custom-tosafot-${++order}`,
          role: 'secondary_comment',
          rawText: p,
          styleName: 'Tosafot',
          order: ++order,
          hierarchyLevel: 3,
          dibburHamatchil: dibbur,
          linkedSourceId: existingTosafots[i]?.linkedSourceId,
        });
      }
    }

    // 4. Footnotes
    if (footnoteText.trim()) {
      const fnLines = footnoteText.split(/\n+/).map(l => l.trim()).filter(Boolean);
      for (let fIdx = 0; fIdx < fnLines.length; fIdx++) {
        const fnRaw = fnLines[fIdx];
        const matchedFn =
          existingFootnotes[fIdx]?.rawText === fnRaw
            ? existingFootnotes[fIdx]
            : existingFootnotes.find(u => u.rawText === fnRaw);

        if (matchedFn) {
          newUnits.push({
            ...matchedFn,
            order: ++order,
          });
        } else {
          newUnits.push({
            id: existingFootnotes[fIdx]?.id || `custom-fn-${++order}`,
            role: 'footnote',
            rawText: fnRaw,
            styleName: 'Footnote',
            order: ++order,
            hierarchyLevel: 4,
            footnoteNumber: fIdx + 1,
          });
        }
      }
    }

    if (newUnits.length === 0) {
      setValidationError(t("נא להזין לפחות פסקה אחת של טקסט לפני שמירה."));
      return;
    }

    onSave(newUnits, title, activeLayout);
    onClose();
  };

  const handleClearAll = () => {
    setSourceText('');
    setRashiText('');
    setTosafotText('');
    setFootnoteText('');
  };

  const isMultiText =
    activeLayout === 'rav_text' ||
    activeLayout === 'mikraot_gedolot' ||
    activeLayout === 'source_top_commentary_bottom';

  return (
    <div className="keter-dialog-backdrop select-none">
      <div className="keter-dialog-surface w-full max-w-4xl rounded-xl overflow-hidden flex flex-col text-[var(--ui-text-primary)] max-h-[92vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Edit3 className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--ui-text-primary)]">
                {t("החלפת כל הטקסט של הספר")}
              </h2>
              <p className="text-[11px] text-[var(--ui-text-secondary)]">
                {t("הדביקו טקסט חדש או ערכו את הקיים — פסקאות שלא נגעתם בהן נשארות בדיוק כמו שהן.")}
              </p>
            </div>
          </div>
          <button onClick={onClose} title={t("סגור")} className="p-1 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* v0.9.8 Uniformity Audit — the sample-preset bar is removed:
            loading a sample book belongs to New Project (sample mode),
            not to a replace-text dialog, and one click here used to wipe
            the open book's text. Only "clear all" stays. */}
        <div className="px-6 py-2 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-end text-xs">
          <button
            onClick={handleClearAll}
            className="px-2 py-1 rounded bg-[var(--ui-surface-hover)] hover:bg-[var(--ui-hover)] text-[var(--ui-danger)] text-[11px] flex items-center gap-1 transition-colors border border-[var(--ui-border)]"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t("נקה הכל (טקסט ריק)")}</span>
          </button>
        </div>

        {/* Title Input */}
        <div className="p-4 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center gap-3">
          <span className="text-xs text-[var(--ui-text-secondary)] font-medium">{t("כותרת הספר / מסכת:")}</span>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t("לדוגמה: ספר מסילת ישרים — שער הביאור")}
            className="flex-1 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--ui-text-primary)] placeholder-[var(--ui-text-muted)] focus:outline-none focus:border-amber-500"
          />
        </div>

        {/* Editor Fields */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {validationError && (
            <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 flex items-center justify-between">
              <span>{validationError}</span>
              <button
                onClick={() => setValidationError(null)}
                className="text-rose-400 hover:text-rose-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {/* Main Source / Running Text Area */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-semibold text-[var(--ui-text-primary)] flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-400" />
                <span>
                  {isMultiText
                    ? t("טקסט המקור (גמרא / חומש / משנה / גוף הספר):")
                    : t("טקסט הספר הראשי (טקסט רץ — מוסר / הלכה / דרוש / שו״ת):")}
                </span>
              </label>
              <span className="text-[11px] text-[var(--ui-text-secondary)] font-mono">
                {sourceText.split(/\s+/).filter(Boolean).length}  {t("מילים")}
              </span>
            </div>
            <textarea
              rows={isMultiText ? 6 : 14}
              value={sourceText}
              onChange={e => setSourceText(e.target.value)}
              placeholder={t("הדבק כאן את הטקסט שלך בעברית, עם או בלי ניקוד וטעמים. שורות ריקות יוצרות פסקאות חדשות.")}
              className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg p-3 text-[var(--ui-text-primary)] text-sm font-serif leading-relaxed focus:outline-none focus:border-amber-500"
              style={{ direction: 'rtl' }}
            />
          </div>

          {/* Commentary Fields (Only if in Multi-Text mode) */}
          {isMultiText && (
            <div className="grid grid-cols-2 gap-4">
              {/* Commentary 1 (Rashi) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-[var(--ui-text-primary)] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-amber-500" />
                    <span>{t("פירוש א׳ (רש״י / עמודה ימנית):")}</span>
                  </label>
                  <span className="text-[10px] text-[var(--ui-text-secondary)] font-mono">
                    {rashiText.split(/\s+/).filter(Boolean).length}  {t("מילים")}
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={rashiText}
                  onChange={e => setRashiText(e.target.value)}
                  placeholder={t("הדבק כאן את פירוש רש״י או המפרש הראשון. ניתן להתחיל עם 'דיבור המתחיל:' ליצירת הדגשה.")}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg p-2.5 text-[var(--ui-text-primary)] text-xs font-serif leading-relaxed focus:outline-none focus:border-amber-500"
                  style={{ direction: 'rtl' }}
                />
              </div>

              {/* Commentary 2 (Tosafot) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-[var(--ui-text-primary)] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-400" />
                    <span>{t("פירוש ב׳ (תוספות / עמודה שמאלית):")}</span>
                  </label>
                  <span className="text-[10px] text-[var(--ui-text-secondary)] font-mono">
                    {tosafotText.split(/\s+/).filter(Boolean).length}  {t("מילים")}
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={tosafotText}
                  onChange={e => setTosafotText(e.target.value)}
                  placeholder={t("הדבק כאן את פירוש תוספות או המפרש השני.")}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg p-2.5 text-[var(--ui-text-primary)] text-xs font-serif leading-relaxed focus:outline-none focus:border-amber-500"
                  style={{ direction: 'rtl' }}
                />
              </div>
            </div>
          )}

          {/* Footnotes Field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-semibold text-[var(--ui-text-primary)] flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-purple-400" />
                <span>{t("הערות שוליים בתחתית העמוד (כל שורה הינה הערה נפרדת):")}</span>
              </label>
              <span className="text-[10px] text-[var(--ui-text-secondary)] font-mono">
                {footnoteText.split(/\n+/).filter(Boolean).length}  {t("הערות")}
              </span>
            </div>
            <textarea
              rows={3}
              value={footnoteText}
              onChange={e => setFootnoteText(e.target.value)}
              placeholder={t("1. מראה מקום לפסוק או הלכה בתחתית העמוד...")}
              className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg p-2.5 text-[var(--ui-text-secondary)] text-xs font-serif leading-relaxed focus:outline-none focus:border-amber-500"
              style={{ direction: 'rtl' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-t border-[var(--ui-border)] px-6 flex items-center justify-between text-xs">
          <span className="text-[var(--ui-text-secondary)]">
            
            {t("הטקסט יחולק אוטומטית למספר העמודים הנדרש לפי גודל הגופן והשוליים.")}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[var(--ui-surface-hover)] hover:bg-[var(--ui-hover)] text-[var(--ui-text-secondary)] rounded font-medium transition-colors"
            >
              
              {t("ביטול")}
            </button>
            <button
              onClick={handleApply}
              className="px-5 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded font-medium flex items-center gap-1.5 shadow-md transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>{t("החל שינויים ועמד ספר מחדש")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
