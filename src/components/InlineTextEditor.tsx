import React, { useEffect, useRef, useState } from 'react';
import {
  Bold,
  Italic,
  AlignRight,
  AlignCenter,
  AlignLeft,
  Check,
  X,
  Minus,
  Plus,
} from 'lucide-react';
import { sanitizePastedText } from '../engine/in-place-edit-engine';
import { useLanguage } from '../i18n/LanguageContext';

export interface InlineFormatPatch {
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  alignment?: 'right' | 'center' | 'left' | 'justify';
}

interface InlineTextEditorProps {
  unitId: string;
  /** The page-slice text to edit (nikud/taamim intact). */
  initialText: string;
  dir?: 'rtl' | 'ltr';
  fontSizePt?: number;
  /** Called once with the final plain text when the edit commits. */
  onCommit: (text: string) => void;
  /** Called when the user discards the edit (✕ button). */
  onCancel: () => void;
  /** Live formatting changes (font size / bold / alignment) for the block. */
  onFormatChange?: (patch: InlineFormatPatch) => void;
}

/**
 * v0.5.0 Part C — Module 8: direct on-page text editing.
 *
 * A real `contenteditable` box placed over the block being edited. The
 * rules that keep it safe:
 * - The DOM owns the text while editing: `textContent` is set ONCE on
 *   mount (keyed by `unitId`) and never re-rendered from props, so React
 *   can never yank the caret or re-render the text mid-keystroke.
 * - `dir` + `unicode-bidi: plaintext` keep BiDi/RTL cursor behaviour
 *   native, and nothing ever splits a base letter from its nikud/taamim
 *   — edits read back whole `textContent`, grapheme clusters intact.
 * - Paste is sanitized (`sanitizePastedText`): HTML tags, control chars
 *   and zero-width chars are stripped, nikud and line structure survive.
 * - Escape, Enter, or clicking outside commits (blur commits); the ✕
 *   button discards. Bold/italic use the browser's contenteditable
 *   command inside the box; the floating toolbar also reports the change
 *   to the parent so it can persist as a local override.
 */
export const InlineTextEditor: React.FC<InlineTextEditorProps> = ({
  unitId,
  initialText,
  dir = 'rtl',
  fontSizePt = 14,
  onCommit,
  onCancel,
  onFormatChange,
}) => {
  const { t } = useLanguage();
  const editorRef = useRef<HTMLDivElement>(null);
  const latestTextRef = useRef<string>(initialText);
  const committedRef = useRef(false);
  // v0.9.2 Part C — the edit session the box currently shows. When the
  // edited unit changes under the editor (the user clicked another
  // paragraph mid-edit), the previous unit's pending text is committed
  // through ITS OWN onCommit (which splices it back with that unit's
  // page map) before the box is swapped to the new unit — otherwise the
  // previous unit's uncommitted keystrokes are lost when textContent is
  // replaced below. The parent's guarded exit makes that commit a
  // save-only: it cannot close the new edit.
  const editSessionRef = useRef<{
    unitId: string;
    initialText: string;
    onCommit: (text: string) => void;
  } | null>(null);
  const [fontSize, setFontSize] = useState(fontSizePt);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [alignment, setAlignment] = useState<'right' | 'center' | 'left' | 'justify'>(
    dir === 'rtl' ? 'right' : 'left'
  );

  // Set the text once and place the caret at the end. Never runs again
  // for the same unit, so typing never fights React.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    // v0.9.2 Part C — unit switched under the editor: save the previous
    // unit's pending text first (see editSessionRef).
    const prev = editSessionRef.current;
    if (prev && prev.unitId !== unitId) {
      const pending = (latestTextRef.current || '').replace(/\s+/g, ' ').trim();
      const prevInitial = prev.initialText.replace(/\s+/g, ' ').trim();
      if (pending && pending !== prevInitial) {
        prev.onCommit(pending);
      }
    }
    editSessionRef.current = { unitId, initialText, onCommit };
    committedRef.current = false;
    latestTextRef.current = initialText;
    el.textContent = initialText;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const text = (latestTextRef.current || '').replace(/\s+/g, ' ').trim();
    if (text) onCommit(text);
    else onCancel();
  };

  const handleInput = () => {
    latestTextRef.current = editorRef.current?.textContent ?? '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const raw = e.clipboardData.getData('text/plain');
    const clean = sanitizePastedText(raw);
    if (clean) document.execCommand('insertText', false, clean);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      commit();
      editorRef.current?.blur();
    }
  };

  const changeFontSize = (delta: number) => {
    const next = Math.max(6, Math.min(72, Number((fontSize + delta).toFixed(1))));
    setFontSize(next);
    onFormatChange?.({ fontSizePt: next });
  };

  const toggleBold = () => {
    document.execCommand('bold', false);
    const next = !isBold;
    setIsBold(next);
    onFormatChange?.({ bold: next });
  };

  const toggleItalic = () => {
    document.execCommand('italic', false);
    const next = !isItalic;
    setIsItalic(next);
    onFormatChange?.({ italic: next });
  };

  const setAlign = (next: 'right' | 'center' | 'left' | 'justify') => {
    setAlignment(next);
    onFormatChange?.({ alignment: next });
  };

  // Toolbar buttons use onMouseDown + preventDefault so clicking them
  // never blurs the editor (a blur would commit the edit mid-formatting).
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  const toolBtn =
    'p-1.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]';
  const toolBtnActive =
    'p-1.5 rounded bg-[var(--ui-selected-bg)] text-[var(--ui-accent)]';

  return (
    <div
      className="absolute z-40 rounded-lg border-2 border-[var(--ui-accent)] bg-[var(--ui-page-bg)] shadow-[var(--ui-floating-shadow)]"
      style={{ insetInline: 0, top: 0 }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Floating mini-toolbar */}
      <div
        dir="ltr"
        className="flex items-center gap-0.5 px-1.5 py-1 border-b border-[var(--ui-border)] bg-[var(--ui-surface)] rounded-t-lg"
        onMouseDown={keepFocus}
      >
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => changeFontSize(-0.5)}
          className={toolBtn}
          title={t('הקטן גופן')}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] font-mono w-9 text-center text-[var(--ui-text-primary)]">
          {fontSize.toFixed(1)}
        </span>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => changeFontSize(0.5)}
          className={toolBtn}
          title={t('הגדל גופן')}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-4 bg-[var(--ui-border)] mx-1" />
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={toggleBold}
          className={isBold ? toolBtnActive : toolBtn}
          title={t('מודגש (Ctrl+B)')}
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={toggleItalic}
          className={isItalic ? toolBtnActive : toolBtn}
          title={t('נטוי (Ctrl+I)')}
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-4 bg-[var(--ui-border)] mx-1" />
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => setAlign('right')}
          className={alignment === 'right' ? toolBtnActive : toolBtn}
          title={t('יישור לימין')}
        >
          <AlignRight className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => setAlign('center')}
          className={alignment === 'center' ? toolBtnActive : toolBtn}
          title={t('יישור למרכז')}
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => setAlign('left')}
          className={alignment === 'left' ? toolBtnActive : toolBtn}
          title={t('יישור לשמאל')}
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => {
            commit();
            editorRef.current?.blur();
          }}
          className="p-1.5 rounded bg-[var(--ui-accent)] text-white"
          title={t('סיים עריכה ושמור (Esc)')}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={onCancel}
          className={toolBtn}
          title={t('בטל עריכה בלי לשמור')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* The editable text itself */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        dir={dir}
        role="textbox"
        data-keter-inline-editor={unitId}
        aria-label={t('עריכת טקסט ישירה על הדף')}
        aria-multiline="false"
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        className="px-3 py-2 outline-none min-h-[3rem] text-[#121214] leading-relaxed"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily: '"Frank Ruhl Libre", serif',
          textAlign: alignment,
          unicodeBidi: 'plaintext',
        }}
      />
      <div className="px-3 pb-1.5 text-[10px] text-[var(--ui-text-muted)]">
        {t('Esc או Enter או לחיצה מחוץ לתיבה — שומר. ✕ — מבטל בלי לשמור.')}
      </div>
    </div>
  );
};
