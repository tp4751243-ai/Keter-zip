import React, { useState } from 'react';
import {
  FilePlus2,
  BookOpen,
  Columns,
  SplitSquareVertical,
  Scroll,
  Crown,
  X,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { BookLayoutType } from '../types/typesetter';

interface NewProjectModalProps {
  currentLayoutType?: BookLayoutType;
  onCreateProject: (
    title: string,
    layoutType: BookLayoutType,
    mode: 'blank' | 'sample'
  ) => void;
  onClose: () => void;
}

const LAYOUT_PRESETS: Array<{
  type: BookLayoutType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    type: 'rav_text',
    label: 'צורת הדף — ש״ס וילנא / רב-טקסט',
    description: 'גמרא במרכז, רש״י בפנים ותוספות בחוץ עם ברכיים דינמיות.',
    icon: <Crown className="w-4 h-4" />,
  },
  {
    type: 'source_top_commentary_bottom',
    label: 'מקור עליון ומפרשים למטה (משנה ברורה / רמב״ם)',
    description: 'טקסט ראשי עליון ופירושים מרובים מתחתיו בקישור סמנטי.',
    icon: <SplitSquareVertical className="w-4 h-4" />,
  },
  {
    type: 'mikraot_gedolot',
    label: 'מקראות גדולות (חומש, תרגום ורש״י)',
    description: 'פסוקי המקרא בראש העמוד עם תרגום ופירוש רש״י.',
    icon: <Scroll className="w-4 h-4" />,
  },
  {
    type: 'two_column',
    label: 'שני טורים (שולחן ערוך / שו״ת)',
    description: 'עימוד בשני טורים מאוזנים עם כותרות רוחביות והערות שוליים.',
    icon: <Columns className="w-4 h-4" />,
  },
  {
    type: 'single_column',
    label: 'טור יחיד (ספר מוסר / מחקר תורני)',
    description: 'עימוד קלאסי בטור יחיד רחב עם שוליים והערות שוליים.',
    icon: <BookOpen className="w-4 h-4" />,
  },
];

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  currentLayoutType = 'rav_text',
  onCreateProject,
  onClose,
}) => {
  const [title, setTitle] = useState<string>('ספר חדש — כתר');
  const [selectedLayout, setSelectedLayout] = useState<BookLayoutType>(currentLayoutType);
  const [mode, setMode] = useState<'blank' | 'sample'>('blank');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim() || 'ספר חדש — כתר';
    onCreateProject(cleanTitle, selectedLayout, mode);
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 select-none"
    >
      <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] w-full max-w-2xl rounded-2xl shadow-[var(--ui-floating-shadow)] overflow-hidden flex flex-col max-h-[90vh] text-[var(--ui-text-primary)]">
        {/* Header */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--ui-selected-bg)] border border-[var(--ui-selected-border)] flex items-center justify-center text-[var(--ui-accent)]">
              <FilePlus2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                פתיחת פרויקט ספר חדש
              </h2>
              <p className="text-[11px] text-[var(--ui-text-secondary)]">
                הגדרת שם הספר, מתכונת עימוד תורנית ותוכן התחלתי
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--ui-surface-hover)] rounded-lg text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
            title="סגור"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-[var(--ui-text-secondary)]">
              שם הספר / הפרויקט
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="למשל: חידושי סוגיות — מסכת ברכות"
              className="w-full px-3.5 py-2.5 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
              required
            />
          </div>

          {/* Layout Type Selection */}
          <div className="space-y-2">
            <label className="block font-semibold text-[var(--ui-text-secondary)]">
              מתכונת עימוד (Book Layout)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {LAYOUT_PRESETS.map((preset) => {
                const isSelected = selectedLayout === preset.type;
                return (
                  <button
                    key={preset.type}
                    type="button"
                    onClick={() => setSelectedLayout(preset.type)}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-right transition-all ${
                      isSelected
                        ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)] shadow-2xs'
                        : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        isSelected
                          ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-fg)]'
                          : 'bg-[var(--ui-surface)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                      }`}
                    >
                      {preset.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs flex items-center justify-between">
                        <span>{preset.label}</span>
                        {isSelected && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-accent)] shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--ui-text-secondary)] mt-1 leading-relaxed">
                        {preset.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Initial Content Mode */}
          <div className="space-y-2.5">
            <label className="block font-semibold text-[var(--ui-text-secondary)]">
              תוכן התחלתי לפרויקט
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setMode('blank')}
                className={`p-3.5 rounded-xl border text-right transition-all ${
                  mode === 'blank'
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)]'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <div className="font-bold flex items-center justify-between">
                  <span>מסמך חדש נקי (מוכן להקלדה / ייבוא וורד)</span>
                  {mode === 'blank' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  )}
                </div>
                <p className="text-[11px] text-[var(--ui-text-secondary)] mt-1">
                  מתחיל עם פסקת פתיחה נקייה שניתן לערוך מיד או להחליף בייבוא DOCX.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode('sample')}
                className={`p-3.5 rounded-xl border text-right transition-all ${
                  mode === 'sample'
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)]'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <div className="font-bold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                    <span>טקסט תורני לדוגמה (מסכת ברכות דף ב׳)</span>
                  </span>
                  {mode === 'sample' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  )}
                </div>
                <p className="text-[11px] text-[var(--ui-text-secondary)] mt-1">
                  טוען טקסט מלא של גמרא, רש״י ותוספות לבחינת העימוד והברכיים הדינמיות.
                </p>
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-[var(--ui-border)] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] font-medium transition-colors"
            >
              ביטול
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-[var(--ui-accent-fg)] font-semibold flex items-center gap-2 shadow-xs transition-all"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>צור פרויקט חדש</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
