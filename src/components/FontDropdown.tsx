import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Upload, AlertCircle } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  FontLibraryEntry,
  getFontLibraryEntries,
  importFontFile,
  initFontLibrary,
  subscribeFontLibrary,
} from '../engine/font-library';
import type { LocalFontEntry } from '../types/typesetter';

interface FontDropdownProps {
  value: string;
  onChange: (family: string) => void;
  /** Built-in catalogue passed down from App (merged with system + imported fonts). */
  availableFonts: LocalFontEntry[];
}

const GROUP_ORDER: Array<FontLibraryEntry['source']> = ['custom', 'system', 'built-in'];

const GROUP_TITLE_HE: Record<FontLibraryEntry['source'], string> = {
  custom: 'גופנים שייבאתי',
  system: 'גופנים מהמחשב שלי',
  'built-in': 'גופנים מובנים',
};

function mergeEntries(
  library: FontLibraryEntry[],
  available: LocalFontEntry[]
): FontLibraryEntry[] {
  const byFamily = new Map<string, FontLibraryEntry>();
  for (const f of available) {
    byFamily.set(f.family.toLowerCase(), {
      ...f,
      source: 'built-in',
      pdfEmbeddable: true,
    });
  }
  for (const f of library) {
    const existing = byFamily.get(f.family.toLowerCase());
    if (!existing) {
      byFamily.set(f.family.toLowerCase(), f);
    } else if (f.source !== 'built-in') {
      // A scanned or imported font keeps its real source over the catalogue copy.
      byFamily.set(f.family.toLowerCase(), { ...existing, ...f });
    }
  }
  return Array.from(byFamily.values());
}

/**
 * v0.5.0 Part A — Module 1(c): searchable, scrollable font dropdown that
 * merges built-in + system + imported fonts, with an explicit Import Fonts
 * button inside the dropdown. Imported fonts register via the FontFace API
 * and are selected immediately; the library persists them in IndexedDB.
 */
export const FontDropdown: React.FC<FontDropdownProps> = ({
  value,
  onChange,
  availableFonts,
}) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [libraryEntries, setLibraryEntries] = useState<FontLibraryEntry[]>(() =>
    getFontLibraryEntries()
  );
  const [importNote, setImportNote] = useState<{ text: string; isError?: boolean } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initFontLibrary();
    return subscribeFontLibrary(() => setLibraryEntries(getFontLibraryEntries()));
  }, []);

  const merged = useMemo(
    () => mergeEntries(libraryEntries, availableFonts),
    [libraryEntries, availableFonts]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? merged.filter(
          f =>
            f.family.toLowerCase().includes(q) ||
            (f.displayNameHe ?? '').includes(query.trim())
        )
      : merged;
    return [...list].sort((a, b) => {
      const g = GROUP_ORDER.indexOf(a.source) - GROUP_ORDER.indexOf(b.source);
      if (g !== 0) return g;
      return a.family.localeCompare(b.family);
    });
  }, [merged, query]);

  const groups = useMemo(() => {
    const out: Array<{ source: FontLibraryEntry['source']; items: FontLibraryEntry[] }> = [];
    for (const source of GROUP_ORDER) {
      const items = visible.filter(f => f.source === source);
      if (items.length > 0) out.push({ source, items });
    }
    return out;
  }, [visible]);

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setIsImporting(true);
    setImportNote(null);
    let lastImported: string | null = null;
    let woffImported = false;
    let sessionOnly = false;
    const failed: string[] = [];
    for (const file of files) {
      try {
        const res = await importFontFile(file);
        lastImported = res.family;
        if (!res.pdfEmbeddable) woffImported = true;
        if (!res.persisted) sessionOnly = true;
      } catch {
        failed.push(file.name);
      }
    }
    setIsImporting(false);
    if (lastImported) {
      onChange(lastImported);
      let msg = t('הגופן נטען וזמין מיד בתצוגה. הוא יישמר גם לאחר סגירת התוכנה.');
      if (woffImported) {
        msg += ' ' + t('שימו לב: גופן WOFF/WOFF2 מוצג על המסך, אך ייצוא PDF דורש קובץ TTF/OTF.');
      }
      if (sessionOnly) {
        msg += ' ' + t('שימו לב: לא ניתן היה לשמור את הגופן לאחסון הקבוע, לכן הוא זמין רק עד סגירת התוכנה.');
      }
      setImportNote({ text: msg });
      setOpen(false);
      setQuery('');
    } else if (failed.length > 0) {
      setImportNote({
        text:
          t('לא ניתן לטעון את הקבצים הבאים — נדרש קובץ גופן תקין מסוג TTF, OTF, WOFF או WOFF2: ') +
          failed.join(', '),
        isError: true,
      });
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(o => !o);
          setImportNote(null);
        }}
        className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)] flex items-center justify-between gap-2"
      >
        <span className="truncate" style={{ fontFamily: `"${value}", serif` }}>
          {value}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-[var(--ui-text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={t('סגור את רשימת הגופנים')}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-50 mt-1 w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg shadow-lg overflow-hidden">
            <div className="p-2 border-b border-[var(--ui-border)] space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute inset-s-2.5 top-1/2 -translate-y-1/2 text-[var(--ui-text-muted)] pointer-events-none" />
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('חיפוש גופן לפי שם...')}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-md px-2.5 py-1.5 ps-8 text-xs text-[var(--ui-text-primary)] placeholder-[var(--ui-text-muted)] focus:outline-none focus:border-[var(--ui-accent)]"
                />
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{isImporting ? t('טוען גופנים...') : t('ייבוא גופנים (TTF / OTF / WOFF / WOFF2)')}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                multiple
                onChange={handleImportFiles}
                className="hidden"
              />
              {importNote && (
                <p
                  className={`text-[10px] leading-snug flex items-start gap-1 ${
                    importNote.isError ? 'text-rose-400' : 'text-[var(--ui-text-secondary)]'
                  }`}
                >
                  {importNote.isError && <AlertCircle className="w-3 h-3 shrink-0 mt-px" />}
                  <span>{importNote.text}</span>
                </p>
              )}
            </div>

            <div className="max-h-64 overflow-y-auto p-1">
              {visible.length === 0 && (
                <p className="text-[11px] text-[var(--ui-text-secondary)] text-center py-6 px-3">
                  {t('לא נמצא גופן בשם הזה. נסו שם אחר, או ייבאו את קובץ הגופן מהמחשב.')}
                </p>
              )}
              {groups.map(group => (
                <div key={group.source}>
                  <div className="px-2 pt-2 pb-1 text-[10px] font-semibold text-[var(--ui-text-secondary)]">
                    {t(GROUP_TITLE_HE[group.source])} ({group.items.length})
                  </div>
                  {group.items.map(font => {
                    const isSelected = font.family === value;
                    return (
                      <div
                        key={`${font.source}:${font.family}`}
                        className={`w-full flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors ${
                          isSelected
                            ? 'bg-[var(--ui-selected-bg)] text-[var(--ui-selected-text)]'
                            : 'hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-primary)]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onChange(font.family);
                            setOpen(false);
                            setQuery('');
                          }}
                          className="flex-1 min-w-0 flex items-center justify-between gap-2 text-start"
                        >
                          <span className="min-w-0">
                            <span
                              className="block text-xs truncate"
                              style={{ fontFamily: `"${font.family}", serif` }}
                            >
                              {font.family}
                            </span>
                            <span className="block text-[10px] text-[var(--ui-text-secondary)] truncate">
                              {font.source === 'custom' && !font.pdfEmbeddable
                                ? t('מיובא — מוצג על המסך; PDF דורש TTF/OTF')
                                : font.source === 'system'
                                  ? t('מהמחשב — מוצג על המסך; PDF דורש העלאת קובץ')
                                  : t(font.displayNameHe ?? font.family)}
                            </span>
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                        {/* v0.6.0 Part A (§1): a scanned or WOFF font renders
                            on screen but cannot be embedded in a PDF — offer
                            the TTF/OTF upload right on its row. */}
                        {!font.pdfEmbeddable && font.source !== 'built-in' && (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            title={t('העלה את קובץ ה-TTF/OTF של גופן זה כדי להטמיע אותו ב-PDF')}
                            className="p-1 rounded hover:bg-[var(--ui-surface-subtle)] text-[var(--ui-accent)] shrink-0"
                          >
                            <Upload className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
