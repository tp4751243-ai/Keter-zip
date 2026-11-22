import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

export interface PaletteCommand {
  id: string;
  /** Already translated label (App passes t() results). */
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}

/**
 * v0.4.0 — command palette (checklist §4: Ctrl+K). Plain list of the
 * app's real actions: typing filters, Enter runs the first match, Esc
 * closes, clicking runs. Every entry calls a real App handler — there
 * are no placeholder entries.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, commands }) => {
  const { t, dir } = useLanguage();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      c => c.label.toLowerCase().includes(q) || (c.hint ?? '').toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        const cmd = filtered[0];
        onClose();
        cmd.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-xs flex items-start justify-center p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        dir={dir}
        role="dialog"
        aria-label={t('פקודות מהירות')}
        className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl shadow-[var(--ui-floating-shadow)] w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--ui-border)]">
          <Search className="w-4 h-4 text-[var(--ui-text-secondary)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('חפשו פעולה… (למשל: ייצוא, שמירה, חיפוש)')}
            className="flex-1 bg-transparent text-sm text-[var(--ui-text-primary)] placeholder-[var(--ui-text-muted)] focus:outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)]"
            aria-label={t('סגור')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-4 py-3 text-xs text-[var(--ui-text-secondary)]">
              {t('לא נמצאה פעולה תואמת.')}
            </p>
          )}
          {filtered.map(cmd => (
            <button
              key={cmd.id}
              onClick={() => {
                onClose();
                cmd.run();
              }}
              className="w-full text-start px-4 py-2 hover:bg-[var(--ui-surface-hover)] flex items-baseline justify-between gap-3"
            >
              <span className="text-sm text-[var(--ui-text-primary)]">{cmd.label}</span>
              {cmd.hint && (
                <span className="text-[11px] text-[var(--ui-text-secondary)] shrink-0">{cmd.hint}</span>
              )}
            </button>
          ))}
        </div>
        <p className="px-4 py-2 border-t border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)]">
          {t('Enter מפעיל את הראשונה ברשימה · Esc לסגירה')}
        </p>
      </div>
    </div>
  );
};
