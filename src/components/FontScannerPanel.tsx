import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X, Search, Info, Laptop, Upload, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useEscapeToClose } from './useDialogEscape';
import {
  FontLibraryEntry,
  FontScanState,
  clearFontScanDeclined,
  getFontScanState,
  getFontLibraryEntries,
  importFontFile,
  initFontLibrary,
  removeCustomFont,
  scanLocalFonts,
  subscribeFontLibrary,
} from '../engine/font-library';

interface FontScannerPanelProps {
  onClose: () => void;
  selectedFont: string;
  onSelectFont: (fontFamily: string) => void;
  selectedRashiFont?: string;
  onSelectRashiFont?: (fontFamily: string) => void;
  selectedTosafotFont?: string;
  onSelectTosafotFont?: (fontFamily: string) => void;
}

type SourceFilter = 'all' | 'built-in' | 'system' | 'custom';

const SOURCE_BADGE_HE: Record<FontLibraryEntry['source'], string> = {
  'built-in': 'מובנה',
  system: 'מהמחשב',
  custom: 'מיובא',
};

export const FontScannerPanel: React.FC<FontScannerPanelProps> = ({
  onClose,
  selectedFont,
  onSelectFont,
  selectedRashiFont = 'Noto Rashi Hebrew',
  onSelectRashiFont,
  selectedTosafotFont = 'Frank Ruhl Libre',
  onSelectTosafotFont,
}) => {
  const { t } = useLanguage();
  useEscapeToClose(onClose);
  const [libraryEntries, setLibraryEntries] = useState<FontLibraryEntry[]>(() =>
    getFontLibraryEntries()
  );
  const [customFontInput, setCustomFontInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [isScanningSystem, setIsScanningSystem] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'source' | 'rashi' | 'tosafot'>('source');
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  // v0.6.0 Part A (§1): what the startup auto-scan found (if anything).
  const [scanState, setScanState] = useState<FontScanState | null>(() => getFontScanState());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // v0.5.0 Part A — Module 1: restore persisted imports and stay in sync
  // with scans/imports made from the design-panel dropdown.
  useEffect(() => {
    void initFontLibrary();
    return subscribeFontLibrary(() => setLibraryEntries(getFontLibraryEntries()));
  }, []);

  const showStatus = (text: string, isError: boolean = false) => {
    setStatusMessage({ text, isError });
    setTimeout(() => setStatusMessage(null), 8000);
  };

  const handleScanLocalFonts = async () => {
    setIsScanningSystem(true);
    try {
      // v0.6.0 Part A (§1): a manual re-scan clears the remembered
      // refusal, so the browser may prompt for the permission again.
      clearFontScanDeclined();
      const result = await scanLocalFonts();
      setScanState(getFontScanState());
      // Translate the static note key first, then fill in the count —
      // t() can only match the key with its literal {count} placeholder.
      showStatus(t(result.noteHe).replace('{count}', String(result.count)), result.status === 'denied');
    } catch {
      showStatus(t('סריקת הגופנים נכשלה. ניתן להעלות קובץ גופן ישירות או להקליד את שמו.'), true);
    } finally {
      setIsScanningSystem(false);
    }
  };

  const handleUploadFontFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setIsImporting(true);
    const imported: string[] = [];
    const sessionOnly: string[] = [];
    const woffOnly: string[] = [];
    const failed: string[] = [];
    for (const file of files) {
      try {
        const res = await importFontFile(file);
        imported.push(res.family);
        if (!res.persisted) sessionOnly.push(res.family);
        if (!res.pdfEmbeddable) woffOnly.push(res.family);
      } catch {
        failed.push(file.name);
      }
    }
    setIsImporting(false);
    if (imported.length > 0) {
      const first = imported[0];
      if (activeTab === 'source') onSelectFont(first);
      else if (activeTab === 'rashi' && onSelectRashiFont) onSelectRashiFont(first);
      else if (activeTab === 'tosafot' && onSelectTosafotFont) onSelectTosafotFont(first);
      let msg = t('הגופן נטען וזמין מיד בתצוגה. הוא יישמר גם לאחר סגירת התוכנה.');
      if (imported.length > 1) {
        msg = t('גופנים נטענו וזמינים מיד בתצוגה. הם יישמרו גם לאחר סגירת התוכנה.');
      }
      if (woffOnly.length > 0) {
        msg +=
          ' ' +
          t('שימו לב: גופן WOFF/WOFF2 מוצג על המסך, אך ייצוא PDF דורש קובץ TTF/OTF של אותו גופן.');
      }
      if (sessionOnly.length > 0) {
        msg +=
          ' ' +
          t('שימו לב: לא ניתן היה לשמור את הגופן לאחסון הקבוע, לכן הוא זמין רק עד סגירת התוכנה.');
      }
      showStatus(msg);
    }
    if (failed.length > 0) {
      showStatus(
        t('לא ניתן לטעון את הקבצים הבאים — נדרש קובץ גופן תקין מסוג TTF, OTF, WOFF או WOFF2') +
          ': ' +
          failed.join(', '),
        true
      );
    }
  };

  const handleAddCustomFont = () => {
    const trimmed = customFontInput.trim();
    if (!trimmed) return;
    // Name-only: preview works if the font is installed; PDF export still
    // needs the uploaded file. Kept from v0.4.0 for fonts the scan missed.
    if (activeTab === 'source') onSelectFont(trimmed);
    else if (activeTab === 'rashi' && onSelectRashiFont) onSelectRashiFont(trimmed);
    else if (activeTab === 'tosafot' && onSelectTosafotFont) onSelectTosafotFont(trimmed);
    setCustomFontInput('');
    showStatus(
      t('השם נבחר לתצוגה מקדימה. כדי לייצא PDF עם גופן זה, יש להעלות את קובץ ה-TTF/OTF שלו.'),
      true
    );
  };

  const handleRemoveCustomFont = async (family: string) => {
    await removeCustomFont(family);
    showStatus(t('הגופן המיובא הוסר מהרשימה ומהאחסון.'));
  };

  const currentSelectedForActiveTab =
    activeTab === 'source'
      ? selectedFont
      : activeTab === 'rashi'
        ? selectedRashiFont
        : selectedTosafotFont;

  const visibleFonts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return libraryEntries.filter(f => {
      if (sourceFilter !== 'all' && f.source !== sourceFilter) return false;
      if (q && !f.family.toLowerCase().includes(q) && !(f.displayNameHe ?? '').includes(searchQuery.trim())) return false;
      return true;
    });
  }, [libraryEntries, searchQuery, sourceFilter]);

  const counts = useMemo(() => {
    const c: Record<SourceFilter, number> = { all: libraryEntries.length, 'built-in': 0, system: 0, custom: 0 };
    for (const f of libraryEntries) c[f.source] += 1;
    return c;
  }, [libraryEntries]);

  const selectFont = (family: string) => {
    if (activeTab === 'source') onSelectFont(family);
    else if (activeTab === 'rashi' && onSelectRashiFont) onSelectRashiFont(family);
    else if (activeTab === 'tosafot' && onSelectTosafotFont) onSelectTosafotFont(family);
    showStatus(
      t('הגופן נבחר עבור') +
        ' ' +
        (activeTab === 'source' ? t('מקור') : activeTab === 'rashi' ? t('רש״י') : t('תוספות')) +
        ': ' +
        family
    );
  };

  const sourceNote = (font: FontLibraryEntry): string => {
    if (font.source === 'custom') {
      return font.pdfEmbeddable
        ? t('גופן מיובא — מוצג על המסך ומוטמע בייצוא PDF. נשמר גם לאחר סגירת התוכנה.')
        : t('גופן מיובא (WOFF) — מוצג על המסך, אך ייצוא PDF דורש קובץ TTF/OTF.');
    }
    if (font.source === 'system') {
      return t('זוהה במחשב. מוצג על המסך; כדי להטמיע אותו ב-PDF יש להעלות את קובץ ה-TTF/OTF שלו.');
    }
    if (font.hasTaamim) return t('גופן מובנה — תומך בעברית, ניקוד וטעמים, ומוטמע בייצוא PDF.');
    if (font.hasNikud) return t('גופן מובנה — תומך בעברית וניקוד, ומוטמע בייצוא PDF.');
    return t('גופן מובנה — מוטמע בייצוא PDF.');
  };

  return (
    <div className="keter-dialog-backdrop select-none" onClick={onClose}>
      <div className="keter-dialog-surface w-full max-w-2xl rounded-xl overflow-hidden flex flex-col text-[var(--ui-text-primary)] max-h-[88vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <Search className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--ui-text-primary)]">
                {t('מנהל פונטים וגופנים מותקנים במחשב (Font Manager)')}
              </h2>
              <p className="text-[11px] text-[var(--ui-text-secondary)]">
                {t('בחירת גופנים מותקנים ב-Windows לטקסט המקור, לרש״י ולתוספות')}
              </p>
            </div>
          </div>
          <button onClick={onClose} title={t("סגור")} className="p-1 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Notification */}
        {statusMessage && (
          <div
            className={`px-4 py-2 text-xs flex items-center gap-2 ${
              statusMessage.isError
                ? 'bg-rose-950/80 text-rose-200 border-b border-rose-800'
                : 'bg-emerald-950/80 text-emerald-200 border-b border-emerald-800'
            }`}
          >
            {statusMessage.isError ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Target Role Selector Tabs */}
        <div className="px-5 py-2.5 bg-[var(--ui-surface-subtle)]/80 border-b border-[var(--ui-border)] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[var(--ui-text-secondary)] font-medium">{t('הגדרת גופן עבור:')}</span>
            <button
              onClick={() => setActiveTab('source')}
              className={`px-3 py-1 rounded transition-colors ${
                activeTab === 'source'
                  ? 'bg-amber-700 text-white font-medium shadow-sm'
                  : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] bg-[var(--ui-surface-hover)]'
              }`}
            >
              {t('מקור (גמרא):')} <span className="text-amber-200 font-semibold">{selectedFont}</span>
            </button>
            <button
              onClick={() => setActiveTab('rashi')}
              className={`px-3 py-1 rounded transition-colors ${
                activeTab === 'rashi'
                  ? 'bg-amber-700 text-white font-medium shadow-sm'
                  : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] bg-[var(--ui-surface-hover)]'
              }`}
            >
              {t('רש״י:')} <span className="text-amber-200 font-semibold">{selectedRashiFont}</span>
            </button>
            <button
              onClick={() => setActiveTab('tosafot')}
              className={`px-3 py-1 rounded transition-colors ${
                activeTab === 'tosafot'
                  ? 'bg-amber-700 text-white font-medium shadow-sm'
                  : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] bg-[var(--ui-surface-hover)]'
              }`}
            >
              {t('תוספות:')} <span className="text-amber-200 font-semibold">{selectedTosafotFont}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleScanLocalFonts}
              disabled={isScanningSystem}
              className="flex items-center gap-1.5 px-3 py-1 bg-[var(--ui-surface-hover)] hover:bg-[var(--ui-hover)] text-amber-300 rounded border border-amber-900/40 text-xs transition-colors disabled:opacity-50"
              title={t('סרוק את כל הגופנים המותקנים במערכת ההפעלה שלך')}
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>{isScanningSystem ? t('סורק גופנים...') : t('סרוק גופנים מהמחשב')}</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-1.5 px-3 py-1 bg-[var(--ui-surface-hover)] hover:bg-[var(--ui-hover)] text-blue-300 rounded border border-blue-900/40 text-xs transition-colors disabled:opacity-50"
              title={t('טען קובץ גופן מהמחשב שלך (.ttf, .otf, .woff, .woff2)')}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{isImporting ? t('טוען גופנים...') : t('העלה קובץ גופן')}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              multiple
              onChange={handleUploadFontFiles}
              className="hidden"
            />
          </div>
        </div>

        {/* v0.6.0 Part A (§1): what the startup auto-scan found. A declined
            permission is remembered (no re-prompt on launch); the manual
            "scan" button above clears that and retries. */}
        {scanState && (
          <div className="px-5 py-1.5 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)] flex items-center gap-1.5">
            <Laptop className="w-3 h-3 text-[var(--ui-text-muted)] shrink-0" />
            <span>
              {scanState.declinedRemembered
                ? t('סריקת הגופנים נדחתה בעבר, לכן לא מוצגת בקשה חוזרת בעת הפתיחה. ניתן לסרוק שוב ידנית בכפתור למעלה.')
                : scanState.count > 0
                  ? t('נסרקו {count} גופנים מהמחשב בעת פתיחת התוכנה.').replace(
                      '{count}',
                      String(scanState.count)
                    )
                  : t('סריקת הגופנים בעת הפתיחה לא מצאה גופנים נוספים.')}
            </span>
          </div>
        )}

        {/* Search + source filter */}
        <div className="px-5 py-2.5 bg-[var(--ui-surface-subtle)]/50 border-b border-[var(--ui-border)] flex items-center gap-2 text-xs">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute inset-s-2.5 top-1/2 -translate-y-1/2 text-[var(--ui-text-muted)] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('חיפוש גופן לפי שם...')}
              className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded px-3 py-1.5 ps-8 text-[var(--ui-text-primary)] placeholder-[var(--ui-text-muted)] focus:outline-none focus:border-amber-500"
            />
          </div>
          {(['all', 'built-in', 'system', 'custom'] as SourceFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setSourceFilter(f)}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                sourceFilter === f
                  ? 'bg-amber-700 text-white font-medium'
                  : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] bg-[var(--ui-surface-hover)]'
              }`}
            >
              {f === 'all'
                ? t('הכול') + ` (${counts.all})`
                : t(SOURCE_BADGE_HE[f]) + ` (${counts[f]})`}
            </button>
          ))}
        </div>

        {/* Custom Font Name Input */}
        <div className="p-4 bg-[var(--ui-surface-subtle)]/50 border-b border-[var(--ui-border)] flex items-center gap-2 text-xs">
          <span className="text-[var(--ui-text-secondary)] whitespace-nowrap">{t('הזן שם פונט מותקן במחשב שלך:')}</span>
          <input
            type="text"
            value={customFontInput}
            onChange={e => setCustomFontInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAddCustomFont();
            }}
            placeholder={t('למשל: Guttman Vilna, Vilna, Ktav Rashi, Hadassah, Frank Ruhl...')}
            className="flex-1 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded px-3 py-1.5 text-[var(--ui-text-primary)] placeholder-[var(--ui-text-muted)] focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={handleAddCustomFont}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium flex items-center gap-1 transition-colors shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t('החל גופן')}</span>
          </button>
        </div>

        {/* Font List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {visibleFonts.length === 0 && (
            <p className="text-xs text-[var(--ui-text-secondary)] text-center py-8">
              {t('לא נמצאו גופנים התואמים לחיפוש. נסו שם אחר, סרקו את המחשב, או העלו קובץ גופן.')}
            </p>
          )}
          {visibleFonts.map(font => {
            const isSelected = currentSelectedForActiveTab === font.family;

            return (
              <div
                key={`${font.source}:${font.family}`}
                onClick={() => selectFont(font.family)}
                className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-amber-950/40 border-amber-500/80 shadow-md ring-1 ring-amber-500/40'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] hover:border-[var(--ui-border)] hover:bg-[var(--ui-surface)]'
                }`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-[var(--ui-text-primary)]">{font.family}</span>
                      <span className="text-[10px] bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] border border-[var(--ui-border)] px-1.5 py-0.5 rounded font-medium">
                        {t(SOURCE_BADGE_HE[font.source])}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          <span>
                            {t('נבחר כעת ל')}
                            {activeTab === 'source' ? t('מקור') : activeTab === 'rashi' ? t('רש״י') : t('תוספות')}
                          </span>
                        </span>
                      )}
                      {font.family.includes('Rashi') && (
                        <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/40 px-1.5 py-0.5 rounded font-medium">
                          {t('כתב רש״י אותנטי')}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-[var(--ui-text-secondary)]">{sourceNote(font)}</span>
                  </div>

                  <div className="flex items-start gap-2 shrink-0">
                    {/* Score */}
                    <div className="text-end">
                      <span
                        className={`text-sm font-bold font-mono ${
                          font.suitabilityScore >= 90
                            ? 'text-emerald-400'
                            : font.suitabilityScore >= 70
                              ? 'text-amber-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {font.suitabilityScore} / 100
                      </span>
                      <span className="block text-[10px] text-[var(--ui-text-muted)]">{t('ציון תאימות')}</span>
                    </div>
                    {font.source === 'custom' && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          void handleRemoveCustomFont(font.family);
                        }}
                        title={t('הסר גופן מיובא')}
                        className="p-1.5 hover:bg-rose-950 rounded text-[var(--ui-text-muted)] hover:text-rose-300 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {/* v0.6.0 Part A (§1): a scanned or WOFF font renders on
                        screen but cannot be embedded in a PDF — offer the
                        TTF/OTF upload right on its row. */}
                    {!font.pdfEmbeddable && font.source !== 'built-in' && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        title={t('העלה את קובץ ה-TTF/OTF של גופן זה כדי להטמיע אותו ב-PDF')}
                        className="p-1.5 hover:bg-amber-950 rounded text-amber-300 hover:text-amber-200 transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Live Preview Text Sample with Nikud */}
                <div
                  className="mt-2 p-2 bg-[#FCFAF5] text-stone-900 rounded border border-stone-300 text-sm overflow-hidden text-start leading-relaxed select-text shadow-xs"
                  style={{ fontFamily: `"${font.family}", serif` }}
                >
                  {font.family.includes('Rashi')
                    ? 'מֵאֵימָתַי: מֵאֵיזֶה זְמַן, שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן לְעֵת עֶרֶב.'
                    : 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם — מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית?'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="h-12 bg-[var(--ui-surface-subtle)] border-t border-[var(--ui-border)] px-5 flex items-center justify-between text-xs text-[var(--ui-text-secondary)]">
          <div className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
            <span>{t('הגופנים הנבחרים יחולו מיידית הן בתצוגה המקדימה והן בייצוא PDF ו-IDML.')}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded font-medium transition-colors shadow-sm"
          >
            {t('אישור וסגירה')}
          </button>
        </div>
      </div>
    </div>
  );
};
