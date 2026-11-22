/**
 * v0.5.0 Part A — Module 1: Font Library.
 *
 * Single source of truth for every font the app can offer:
 *   built-in (the curated holy-book catalogue in font-analyzer.ts),
 *   system   (families found on this computer via the Local Font Access API),
 *   custom   (font files the user imported; binaries persist in IndexedDB
 *             because localStorage cannot hold font binaries).
 *
 * The registry is module-level and synchronous once seeded, so the design
 * panel dropdown, the Font Manager and the AI font validator can all read
 * the same list without prop-drilling through App.tsx. Components subscribe
 * for updates (scan / import / restore finishing after mount).
 *
 * Honest limits, shown in the UI wherever they matter:
 * - queryLocalFonts() lists family names only. It does NOT hand over the
 *   font file, so a system font found by scanning renders on screen but
 *   cannot be embedded in an exported PDF until its .ttf/.otf is uploaded.
 * - WOFF/WOFF2 imports render on screen via the FontFace API, but the PDF
 *   exporter can only embed TrueType/OpenType (.ttf/.otf). Such fonts are
 *   marked pdfEmbeddable: false and the UI says so plainly.
 * - In environments where queryLocalFonts() is unavailable (older browsers,
 *   permission denied) the scan falls back to probing a short list of common
 *   Windows Hebrew fonts with document.fonts.check() and says so plainly.
 */

import { FontAnalyzer } from './font-analyzer';
import { KETER_EMBEDDED_FONTS, PdfNativeTextEngine } from './pdf-native-text-engine';
import type { LocalFontEntry } from '../types/typesetter';

export type FontSource = 'built-in' | 'system' | 'custom';

export interface FontLibraryEntry extends LocalFontEntry {
  source: FontSource;
  /** Original uploaded file name, for custom fonts. */
  fileName?: string;
  /** Uploaded file format, for custom fonts. */
  format?: 'ttf' | 'otf' | 'woff' | 'woff2';
  /** True when the font can be embedded in an exported PDF. */
  pdfEmbeddable: boolean;
}

export type LocalFontScanStatus = 'ok' | 'unsupported' | 'denied' | 'empty';

export interface LocalFontScanResult {
  status: LocalFontScanStatus;
  families: string[];
  /** Number of families found (used to fill the {count} slot in noteHe). */
  count: number;
  /** Short plain-language note for the UI (Hebrew; translated via NEW_STRINGS.md).
   *  Contains a literal {count} placeholder when the count matters — callers
   *  must run t(noteHe) first, then replace '{count}' with the number, so the
   *  translation lookup still matches the static key. */
  noteHe: string;
}

export interface ImportedFontResult {
  family: string;
  format: 'ttf' | 'otf' | 'woff' | 'woff2';
  pdfEmbeddable: boolean;
  persisted: boolean;
}

/** Fonts the fallback probe checks when queryLocalFonts() is unavailable. */
const COMMON_WINDOWS_HEBREW_FONTS: string[] = [
  'Guttman Vilna',
  'Guttman Rashi',
  'Guttman Keter',
  'Vilna',
  'David',
  'David Libre',
  'Frank Ruhl Libre',
  'Narkisim',
  'Miriam Libre',
  'Noto Serif Hebrew',
  'Noto Rashi Hebrew',
  'Arial Hebrew',
  'Times New Roman',
  'Courier New',
  'Segoe UI',
];

const ACCEPTED_EXTENSIONS: Record<string, 'ttf' | 'otf' | 'woff' | 'woff2'> = {
  ttf: 'ttf',
  otf: 'otf',
  woff: 'woff',
  woff2: 'woff2',
};

/* ------------------------------------------------------------------ */
/* Registry (synchronous, module-level)                                */
/* ------------------------------------------------------------------ */

function toLibraryEntry(entry: LocalFontEntry, source: FontSource): FontLibraryEntry {
  return { ...entry, source, pdfEmbeddable: source === 'built-in' };
}

let entries: FontLibraryEntry[] = FontAnalyzer.getAvailableSystemFonts().map(f =>
  toLibraryEntry(f, 'built-in')
);

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(fn => {
    try {
      fn();
    } catch {
      // A failing subscriber must never break the font library.
    }
  });
}

export function getFontLibraryEntries(): FontLibraryEntry[] {
  return [...entries];
}

export function getFontLibraryFamilies(): string[] {
  return entries.map(e => e.family);
}

export function findFontLibraryEntry(family: string): FontLibraryEntry | undefined {
  const clean = family.trim().toLowerCase();
  return entries.find(e => e.family.toLowerCase() === clean);
}

export function isFontInLibrary(family: string): boolean {
  return findFontLibraryEntry(family) !== undefined;
}

/**
 * v0.8.0 Part E — single source of truth for "will this font survive a
 * PDF export", for every font-picking surface (Control Panel, design
 * panel, export preflight) to share instead of each guessing.
 *
 * - `true`: the font is embeddable (built-in bundled font, or an uploaded
 *   TTF/OTF whose binary the PDF exporter holds).
 * - `false`: the font renders on screen only — a scanned system font whose
 *   file was never uploaded, or a WOFF/WOFF2 import. Picking it for export
 *   fails the built-in PDF export, so the UI must say so at pick time.
 * - `null`: unknown family (not in the library yet, e.g. a typed name) —
 *   the design panel's availability warning covers that case instead.
 */
export function isFontEmbeddableInPdf(family: string): boolean | null {
  const entry = findFontLibraryEntry(family);
  if (entry) return entry.pdfEmbeddable;
  const clean = family.trim().toLowerCase();
  if (!clean) return null;
  const bundled = KETER_EMBEDDED_FONTS.some(
    spec => spec.fontFamily.toLowerCase() === clean
  );
  return bundled ? true : null;
}

export function subscribeFontLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function upsertEntry(entry: FontLibraryEntry): void {
  const idx = entries.findIndex(e => e.family.toLowerCase() === entry.family.toLowerCase());
  if (idx >= 0) {
    // Never let a scan overwrite an imported font (it carries the file).
    if (entries[idx].source === 'custom' && entry.source !== 'custom') return;
    entries[idx] = { ...entries[idx], ...entry, source: entries[idx].source };
  } else {
    entries.push(entry);
  }
}

/* ------------------------------------------------------------------ */
/* IndexedDB persistence for imported font binaries                    */
/* ------------------------------------------------------------------ */

const IDB_NAME = 'keter-font-library';
const IDB_VERSION = 1;
const IDB_STORE = 'fonts';

interface StoredFontRecord {
  family: string;
  fileName: string;
  format: 'ttf' | 'otf' | 'woff' | 'woff2';
  data: ArrayBuffer;
  addedAt: number;
}

function openFontDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE, { keyPath: 'family' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function idbPut(record: StoredFontRecord): Promise<void> {
  return openFontDb().then(
    db =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(record);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB write failed'));
        };
      })
  );
}

function idbGetAll(): Promise<StoredFontRecord[]> {
  return openFontDb().then(
    db =>
      new Promise<StoredFontRecord[]>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = () => {
          db.close();
          resolve((req.result as StoredFontRecord[]) ?? []);
        };
        req.onerror = () => {
          db.close();
          reject(req.error ?? new Error('IndexedDB read failed'));
        };
      })
  );
}

function idbDelete(family: string): Promise<void> {
  return openFontDb().then(
    db =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(family);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB delete failed'));
        };
      })
  );
}

/* ------------------------------------------------------------------ */
/* Registration (FontFace for screen + PDF engine for export)          */
/* ------------------------------------------------------------------ */

const loadedFaces = new Map<string, FontFace>();

/** Registers a font binary for on-screen rendering; returns false on failure. */
async function registerFontFace(family: string, data: ArrayBuffer): Promise<boolean> {
  try {
    const face = new FontFace(family, data.slice(0));
    await face.load();
    document.fonts.add(face);
    loadedFaces.set(family.toLowerCase(), face);
    return true;
  } catch {
    return false;
  }
}

/** Registers a TrueType/OpenType binary with the PDF exporter (no-op for WOFF). */
function registerForPdf(family: string, format: string, data: ArrayBuffer): boolean {
  if (format !== 'ttf' && format !== 'otf') return false;
  try {
    PdfNativeTextEngine.registerCustomFont(family, data.slice(0));
    return true;
  } catch {
    return false;
  }
}

function customEntry(
  family: string,
  fileName: string,
  format: 'ttf' | 'otf' | 'woff' | 'woff2',
  pdfEmbeddable: boolean
): FontLibraryEntry {
  return {
    family,
    displayNameHe: family,
    suitabilityScore: 50,
    hasHebrew: true,
    hasNikud: false,
    hasTaamim: false,
    hasGposMark: false,
    hasGposMkmk: false,
    recommendedRole: 'general',
    source: 'custom',
    fileName,
    format,
    pdfEmbeddable,
  };
}

/* ------------------------------------------------------------------ */
/* Restore persisted fonts (runs once per page load)                   */
/* ------------------------------------------------------------------ */

let initPromise: Promise<void> | null = null;

export function initFontLibrary(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    let stored: StoredFontRecord[] = [];
    try {
      stored = await idbGetAll();
    } catch {
      // IndexedDB unavailable (private mode, blocked storage): imported
      // fonts simply cannot persist. Session imports still work.
      return;
    }
    let changed = false;
    for (const rec of stored) {
      const faceOk = await registerFontFace(rec.family, rec.data);
      if (!faceOk) continue;
      const pdfOk = registerForPdf(rec.family, rec.format, rec.data);
      upsertEntry(customEntry(rec.family, rec.fileName, rec.format, pdfOk));
      changed = true;
    }
    if (changed) notify();
  })();
  return initPromise;
}

/* ------------------------------------------------------------------ */
/* System font scan (Local Font Access API + fallback probe)           */
/* ------------------------------------------------------------------ */

interface QueryLocalFontsWindow extends Window {
  queryLocalFonts?: () => Promise<
    Array<{ family: string; fullName: string; postScriptName: string; style: string }>
  >;
}

export async function scanLocalFonts(): Promise<LocalFontScanResult> {
  const win = window as QueryLocalFontsWindow;
  if (typeof win.queryLocalFonts !== 'function') {
    // Fallback: probe common Windows Hebrew fonts. This is NOT a full scan
    // — the UI must say so — but it finds the fonts users actually ask for.
    const found = probeCommonFonts();
    return {
      status: 'unsupported',
      families: found,
      count: found.length,
      noteHe:
        found.length > 0
          ? 'הדפדפן לא מאפשר סריקה מלאה של כל הגופנים, לכן נבדקו רק הגופנים העבריים הנפוצים ב-Windows. גופן שלא מופיע כאן ניתן להוסיף בהעלאת קובץ או בהקלדת שמו.'
          : 'הדפדפן לא מאפשר סריקה מלאה של כל הגופנים, ולא זוהה אף גופן עברי נפוץ. ניתן להעלות קובץ גופן או להקליד את שמו.',
    };
  }

  try {
    try {
      const perm = await (navigator as Navigator & {
        permissions?: { query?: (opts: { name: string }) => Promise<{ state: string }> };
      }).permissions?.query?.({ name: 'local-fonts' as PermissionName });
      if (perm && perm.state === 'denied') {
        // v0.6.0 Part A (§1): remember the refusal so the app never
        // prompts for the scan again on later launches. A manual
        // "scan again" from the Font Manager clears it (see
        // clearFontScanDeclined) and retries.
        rememberScanDeclined();
        return {
          status: 'denied',
          families: [],
          count: 0,
          noteHe:
            'ההרשאה לסריקת גופנים נדחתה בדפדפן. ניתן לאפשר אותה בהגדרות האתר, או להעלות קובץ גופן ישירות.',
        };
      }
    } catch {
      // permissions.query() does not know 'local-fonts' everywhere — ignore
      // and let queryLocalFonts() itself prompt or throw.
    }
    const localFonts = await win.queryLocalFonts();
    const familySet = new Set<string>();
    for (const f of localFonts) {
      if (f.family) familySet.add(f.family);
    }
    const families = Array.from(familySet).sort((a, b) => a.localeCompare(b));
    addSystemFamilies(families);
    lastScanState = {
      source: 'local-fonts',
      status: families.length > 0 ? 'ok' : 'empty',
      count: families.length,
      at: Date.now(),
      declinedRemembered: false,
    };
    return {
      status: families.length > 0 ? 'ok' : 'empty',
      families,
      count: families.length,
      noteHe:
        families.length > 0
          ? 'הסריקה הצליחה: זוהו {count} משפחות גופנים במחשב. הסריקה מזהה שמות בלבד — כדי להטמיע גופן ב-PDF יש להעלות את קובץ ה-TTF/OTF שלו.'
          : 'הסריקה הצליחה אך לא נמצאו גופנים במחשב.',
    };
  } catch (err) {
    const denied =
      err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    if (denied) rememberScanDeclined();
    return {
      status: denied ? 'denied' : 'unsupported',
      families: [],
      count: 0,
      noteHe: denied
        ? 'ההרשאה לסריקת גופנים נדחתה. ניתן להעלות קובץ גופן ישירות, או לאפשר את ההרשאה בהגדרות האתר ולנסות שוב.'
        : 'סריקת הגופנים נכשלה בדפדפן זה. ניתן להעלות קובץ גופן ישירות או להקליד את שמו.',
    };
  }
}

/** Probe the short list of common Windows Hebrew fonts (no permission needed). */
function probeCommonFonts(): string[] {
  const found = COMMON_WINDOWS_HEBREW_FONTS.filter(name => {
    try {
      return document.fonts.check(`12px "${name}"`);
    } catch {
      return false;
    }
  });
  addSystemFamilies(found);
  return found;
}

function addSystemFamilies(families: string[]): void {
  let changed = false;
  for (const family of families) {
    if (findFontLibraryEntry(family)) continue;
    entries.push({
      family,
      displayNameHe: family,
      suitabilityScore: 40,
      hasHebrew: true,
      hasNikud: false,
      hasTaamim: false,
      hasGposMark: false,
      hasGposMkmk: false,
      recommendedRole: 'general',
      source: 'system',
      pdfEmbeddable: false,
    });
    changed = true;
  }
  if (changed) notify();
}

/* ------------------------------------------------------------------ */
/* Startup auto-scan (v0.6.0 Part A — §1)                             */
/* ------------------------------------------------------------------ */

/**
 * What the last system-font scan found, for the Font Manager status line.
 * `declinedRemembered` is true when the user declined the browser's
 * Local Font Access permission and the app remembered it, so it will not
 * prompt again on later launches.
 */
export interface FontScanState {
  source: 'electron' | 'local-fonts' | 'probe' | 'none';
  status: LocalFontScanStatus;
  count: number;
  at: number;
  declinedRemembered: boolean;
}

let lastScanState: FontScanState | null = null;

export function getFontScanState(): FontScanState | null {
  return lastScanState;
}

/** localStorage flag: the user declined the font-scan permission once. */
const FONT_SCAN_DECLINED_KEY = 'keter-font-scan-declined';

function isScanDeclined(): boolean {
  try {
    return localStorage.getItem(FONT_SCAN_DECLINED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberScanDeclined(): void {
  try {
    localStorage.setItem(FONT_SCAN_DECLINED_KEY, '1');
  } catch {
    // Storage unavailable — the next launch simply asks again.
  }
  if (lastScanState) lastScanState = { ...lastScanState, declinedRemembered: true };
}

/** Clears the remembered refusal so a manual "scan again" can re-prompt. */
export function clearFontScanDeclined(): void {
  try {
    localStorage.removeItem(FONT_SCAN_DECLINED_KEY);
  } catch {
    // ignore
  }
}

/**
 * The Electron desktop shell's font bridge (see electron/preload.cjs).
 * The page gets no Node access — only this one explicit call, which lists
 * installed font files (family names parsed from the font name table in
 * the main process). Names only: no file contents cross the bridge, so a
 * scanned font still needs its TTF/OTF uploaded for PDF embedding.
 */
export interface KeterDesktopFontBridge {
  isDesktop?: boolean;
  platform?: string;
  listSystemFontFiles?: () => Promise<
    Array<{
      family: string;
      fullName?: string;
      postScriptName?: string;
      fileName?: string;
      format?: string;
    }>
  >;
}

function getDesktopBridge(): KeterDesktopFontBridge | undefined {
  try {
    const w = window as unknown as { keterDesktop?: KeterDesktopFontBridge };
    return w.keterDesktop && typeof w.keterDesktop.listSystemFontFiles === 'function'
      ? w.keterDesktop
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Electron fallback: enumerate the system font directories through the
 * desktop bridge (C:\Windows\Fonts, /Library/Fonts, ~/.fonts, …). Needs
 * no browser permission. Returns null when not running under Electron.
 */
export async function scanSystemFontDirectories(): Promise<LocalFontScanResult | null> {
  const bridge = getDesktopBridge();
  if (!bridge?.listSystemFontFiles) return null;
  try {
    const files = await bridge.listSystemFontFiles();
    const families = Array.from(
      new Set(files.map(f => (f.family ?? '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    addSystemFamilies(families);
    lastScanState = {
      source: 'electron',
      status: families.length > 0 ? 'ok' : 'empty',
      count: families.length,
      at: Date.now(),
      declinedRemembered: false,
    };
    return {
      status: families.length > 0 ? 'ok' : 'empty',
      families,
      count: families.length,
      noteHe:
        families.length > 0
          ? 'הסריקה הצליחה: זוהו {count} משפחות גופנים במחשב. הסריקה מזהה שמות בלבד — כדי להטמיע גופן ב-PDF יש להעלות את קובץ ה-TTF/OTF שלו.'
          : 'הסריקה הצליחה אך לא נמצאו גופנים במחשב.',
    };
  } catch {
    return {
      status: 'unsupported',
      families: [],
      count: 0,
      noteHe: 'סריקת תיקיות הגופנים נכשלה. ניתן להעלות קובץ גופן ישירות או להקליד את שמו.',
    };
  }
}

let startupScanPromise: Promise<void> | null = null;

/**
 * v0.6.0 Part A (§1) — startup font auto-fetch (Word parity). Called once
 * from App after mount; non-blocking and fire-and-forget (the dropdowns
 * subscribe and fill in when the scan lands). Order:
 *   1. restore imported fonts from IndexedDB (always);
 *   2. Electron: scan the system font directories via the desktop bridge
 *      (no permission prompt involved) — if it finds fonts, stop here;
 *   3. Browser: Local Font Access API — unless the user already declined
 *      it once, in which case only the permission-free probe runs, so the
 *      app never nags for the permission on every launch.
 */
export function autoScanFontsAtStartup(): Promise<void> {
  if (startupScanPromise) return startupScanPromise;
  startupScanPromise = (async () => {
    try {
      await initFontLibrary();
    } catch {
      // Imported-font restore failing must never block the scan.
    }
    try {
      const electron = await scanSystemFontDirectories();
      if (electron && electron.count > 0) return;
    } catch {
      // Fall through to the browser API.
    }
    if (isScanDeclined()) {
      const found = probeCommonFonts();
      lastScanState = {
        source: 'probe',
        status: found.length > 0 ? 'unsupported' : 'empty',
        count: found.length,
        at: Date.now(),
        declinedRemembered: true,
      };
      return;
    }
    try {
      await scanLocalFonts();
    } catch {
      // The scan failing must never break startup.
    }
  })();
  return startupScanPromise;
}

/* ------------------------------------------------------------------ */
/* Custom font import / removal                                        */
/* ------------------------------------------------------------------ */

export async function importFontFile(file: File): Promise<ImportedFontResult> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const format = ACCEPTED_EXTENSIONS[ext];
  if (!format) {
    throw new Error('INVALID_FORMAT');
  }
  const family = file.name.replace(/\.[^/.]+$/, '').trim();
  if (!family) throw new Error('INVALID_NAME');

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength < 12) throw new Error('EMPTY_FILE');

  const faceOk = await registerFontFace(family, buffer);
  if (!faceOk) throw new Error('LOAD_FAILED');

  const pdfOk = registerForPdf(family, format, buffer);

  let persisted = false;
  try {
    await idbPut({ family, fileName: file.name, format, data: buffer.slice(0), addedAt: Date.now() });
    persisted = true;
  } catch {
    persisted = false;
  }

  upsertEntry(customEntry(family, file.name, format, pdfOk));
  notify();
  return { family, format, pdfEmbeddable: pdfOk, persisted };
}

export async function removeCustomFont(family: string): Promise<void> {
  const face = loadedFaces.get(family.toLowerCase());
  if (face) {
    try {
      document.fonts.delete(face);
    } catch {
      // ignore — the face stays registered for this session only
    }
    loadedFaces.delete(family.toLowerCase());
  }
  try {
    await idbDelete(family);
  } catch {
    // Storage failure: the entry still leaves the in-memory list below.
  }
  entries = entries.filter(
    e => !(e.source === 'custom' && e.family.toLowerCase() === family.toLowerCase())
  );
  notify();
}
