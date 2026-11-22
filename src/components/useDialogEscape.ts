import { useEffect } from 'react';

/**
 * v0.9.8 Uniformity Audit — ONE close behaviour for every modal dialog:
 * Escape closes it (same as its ✕ button and the same as clicking the
 * dimmed backdrop). Before this pass only the command palette handled
 * Escape; every other dialog could only be closed with its ✕ button.
 *
 * Usage: call at the top of a modal component with its onClose.
 * The listener only exists while the modal is mounted. A dialog that
 * holds unsaved typed text with no dirty guard (ContentEditorModal)
 * must NOT use this hook — Escape there would discard pasted text;
 * such a dialog closes only through its own explicit buttons.
 */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);
}
