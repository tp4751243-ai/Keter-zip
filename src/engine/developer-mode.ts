/**
 * v0.9.8 Phase 1 — Developer Mode.
 *
 * Default OFF. When OFF, the main workspace shows the clean editorial
 * studio only (Content, Layout/Design, Preview, Export): every internal
 * developer/QA surface is hidden AND unreachable — the header menu's
 * "developer tools" section, the status-bar QA button, the Automated
 * Test panel, the architecture-report modal, and the "page fixes"
 * QA-audit list. When ON, everything is reachable exactly as before.
 *
 * Toggle: Ctrl+Shift+D anywhere in the app, or the discreet
 * "מצב מפתח" switch at the bottom of the header menu (always visible).
 * Persisted in localStorage under `keter-developer-mode` ('1' / '0').
 * The value is read lazily (no localStorage access at module load, so
 * Node smoke scripts can import this file without a DOM shim).
 */

export const DEVELOPER_MODE_STORAGE_KEY = 'keter-developer-mode';

export function isDeveloperModeEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(DEVELOPER_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDeveloperModeEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage unavailable (private mode, sandbox) — the in-memory React
    // state in App still toggles for the session; persistence is best-effort.
  }
}
