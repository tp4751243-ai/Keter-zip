import { useEffect, useRef } from 'react';

/**
 * v0.5.0 Part C — Module 8: global keyboard shortcuts for in-page editing.
 *
 * What this hook owns (and ONLY this):
 * - Ctrl+F — open find/replace (the existing SearchReplacePanel).
 * - Ctrl+B / Ctrl+I — bold / italic inside the active contenteditable block.
 * - Ctrl+A — select all inside the active block, including when focus is
 *   on the page itself rather than inside the editor.
 * - Escape — blur the active editor (the editor commits on blur).
 *
 * What it deliberately does NOT own by default:
 * - Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (undo/redo) and Ctrl+S (save): App.tsx
 *   already has a global keydown handler for those, wired to the existing
 *   `UndoRedoHistoryManager` (500 steps, coalesced). This hook takes them
 *   over ONLY when `takeOverUndoRedo` is true — and then the integrator
 *   must remove them from App's handler, or every Ctrl+Z would undo twice.
 *   Text edits made through `InlineTextEditor` commit through App's
 *   `handleCommitInPlaceUnitEdit`, so they join that same history stack;
 *   no second history system is built anywhere in Part C.
 * - Ctrl+C / Ctrl+X / Ctrl+V: native inside the contenteditable block.
 *   Paste is sanitized by `InlineTextEditor` (HTML tags, control chars
 *   and zero-width chars stripped; nikud/taamim preserved).
 *
 * Integration (one line in App.tsx — see REPORT.md):
 *   useEditingShortcuts({
 *     enabled: activeWorkMode === 'edit',
 *     canUndo, canRedo, onUndo: handleUndo, onRedo: handleRedo,
 *     onOpenFindReplace: () => setIsSearchOpen(true),
 *     onToggleInlineFormat: (format) => { ... },
 *     getActiveEditableElement: () => document.querySelector('[data-keter-inline-editor]'),
 *   });
 */
export interface EditingShortcutsOptions {
  enabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /**
   * When true, this hook owns Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. Default
   * false — App.tsx keeps owning them (see the header comment).
   */
  takeOverUndoRedo?: boolean;
  /** Opens the existing find/replace panel (Ctrl+F). */
  onOpenFindReplace?: () => void;
  /** Called when Ctrl+B / Ctrl+I toggles inline formatting. */
  onToggleInlineFormat?: (format: 'bold' | 'italic') => void;
  /** The currently edited block, for Ctrl+A when focus is on the page. */
  getActiveEditableElement?: () => HTMLElement | null;
}

export function useEditingShortcuts(options: EditingShortcutsOptions): void {
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const opts = optsRef.current;
      if (opts.enabled === false) return;

      const target = e.target as HTMLElement | null;
      const isContentEditable = Boolean(target?.isContentEditable);
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');

      // Escape blurs the active editor; the editor commits on blur.
      if (e.key === 'Escape' && isContentEditable) {
        target?.blur();
        return;
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta) return;
      const key = e.key.toLowerCase();

      // Find/replace — works from anywhere in edit mode.
      if (key === 'f') {
        e.preventDefault();
        opts.onOpenFindReplace?.();
        return;
      }

      // Undo/redo — ONLY when this hook has been given ownership.
      // Otherwise App.tsx's handler (same history manager) handles it.
      if (opts.takeOverUndoRedo) {
        if (key === 'z' && !e.shiftKey) {
          if (opts.canUndo === false) return;
          e.preventDefault();
          opts.onUndo?.();
          return;
        }
        if (key === 'y' || (key === 'z' && e.shiftKey)) {
          if (opts.canRedo === false) return;
          e.preventDefault();
          opts.onRedo?.();
          return;
        }
      }

      // Bold / italic inside the edited block.
      if ((key === 'b' || key === 'i') && isContentEditable) {
        e.preventDefault();
        document.execCommand(key === 'b' ? 'bold' : 'italic', false);
        opts.onToggleInlineFormat?.(key === 'b' ? 'bold' : 'italic');
        return;
      }

      // Select all in the active block, even when focus sits on the page.
      if (key === 'a' && !isContentEditable && !isTextInput) {
        const el = opts.getActiveEditableElement?.();
        if (el) {
          e.preventDefault();
          const sel = window.getSelection();
          sel?.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel?.addRange(range);
        }
        return;
      }
      // Inside a contenteditable, Ctrl+A is left to the browser (native).
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
