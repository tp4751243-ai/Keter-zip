/**
 * v0.7.0 Part 2 (M3) — Story Editor: a text-only editing view.
 *
 * Shows the whole story (all content units in reading order) as plain
 * text with role labels — no page geometry, no ornaments. Each unit is
 * editable in place; committing (blur / Ctrl+Enter) calls onCommitUnit,
 * which is App's existing in-place edit commit path (undoable, triggers
 * re-pagination). Switching back to layout is Ctrl+Tab or the button.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { CONTENT_ROLE_LABELS } from '../i18n/strings';
import type { ContentUnit } from '../types/typesetter';

interface StoryEditorProps {
  units: ContentUnit[];
  onCommitUnit: (unitId: string, newText: string) => void;
  onBackToLayout: () => void;
  /** v0.8.0 Part E (#14): focus + scroll to this unit's textarea on open
      (a Type-tool drag just created it, empty, ready for typing). */
  initialEditingId?: string | null;
}

export const StoryEditor: React.FC<StoryEditorProps> = ({ units, onCommitUnit, onBackToLayout, initialEditingId }) => {
  const { t, lang } = useLanguage();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const initialFocusDoneRef = useRef(false);

  // Focus the freshly created unit once, on open — not on every keystroke
  // (the textarea's onChange re-renders, so a ref-callback focus would
  // re-scroll while typing).
  useEffect(() => {
    if (!initialEditingId || initialFocusDoneRef.current) return;
    initialFocusDoneRef.current = true;
    setEditingId(initialEditingId);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>(
        `[data-story-unit-id="${initialEditingId}"]`
      );
      el?.focus();
      el?.scrollIntoView({ block: 'center' });
    });
  }, [initialEditingId]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--ui-workspace-bg)]" data-testid="story-editor">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--ui-border)] bg-[var(--ui-panel-bg)] shrink-0">
        <span className="text-sm font-semibold">{t('עורך סיפור (Story Editor)')}</span>
        <span className="text-xs text-[var(--ui-muted)]">{t('תצוגת טקסט בלבד — ללא עימוד')}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onBackToLayout}
          className="px-2.5 py-1 rounded border border-[var(--ui-border)] text-xs hover:bg-[var(--ui-hover)]"
          title="Ctrl+Tab"
        >
          {t('חזרה לתצוגת עימוד')} (Ctrl+Tab)
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {units.map(u => {
          const value = drafts[u.id] ?? u.rawText;
          const dirty = editingId === u.id && value !== u.rawText;
          return (
            <div key={u.id} className="rounded border border-[var(--ui-border)] bg-[var(--ui-panel-bg)] p-2">
              {/* v0.9.8 Uniformity Audit — plain role names from the
                  strict CONTENT_ROLE_LABELS table, never the raw role id
                  ("[main_source]"). Story Editor is the SUBORDINATE text
                  editor: the text-only view for long edits; the canonical
                  way to fix text is edit-in-place on the page
                  (double-click a word). */}
              <div className="text-[11px] font-semibold text-[var(--ui-muted)] mb-1">
                [{lang === 'en' ? CONTENT_ROLE_LABELS[u.role].en : CONTENT_ROLE_LABELS[u.role].he}]{u.dibburHamatchil ? ` — ${t('ד״ה')}: ${u.dibburHamatchil}` : ''}
              </div>
              <textarea
                data-story-unit-id={u.id}
                className="w-full min-h-[64px] px-2 py-1 rounded border border-[var(--ui-border)] bg-[var(--ui-input-bg)] text-sm leading-relaxed resize-y"
                dir="auto"
                value={value}
                onFocus={() => setEditingId(u.id)}
                onChange={e => setDrafts(d => ({ ...d, [u.id]: e.target.value }))}
                onBlur={() => {
                  if (value !== u.rawText) onCommitUnit(u.id, value);
                  setEditingId(null);
                }}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
              />
              {dirty && <div className="text-[11px] text-[var(--ui-muted)] mt-0.5">{t('השינויים יישמרו ביציאה מהשדה')}</div>}
            </div>
          );
        })}
        {units.length === 0 && <p className="text-sm text-[var(--ui-muted)]">{t('אין תוכן עדיין — ייבא מסמך')}</p>}
      </div>
    </div>
  );
};
