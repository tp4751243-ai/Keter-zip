import React, { useState, useRef } from 'react';
import { FontAnalyzer } from '../engine/font-analyzer';
import { Check, X, Search, Info, Laptop, Plus, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { FontCapability } from '../types/typesetter';

interface FontScannerPanelProps {
  onClose: () => void;
  selectedFont: string;
  onSelectFont: (fontFamily: string) => void;
  selectedRashiFont?: string;
  onSelectRashiFont?: (fontFamily: string) => void;
  selectedTosafotFont?: string;
  onSelectTosafotFont?: (fontFamily: string) => void;
}

export const FontScannerPanel: React.FC<FontScannerPanelProps> = ({
  onClose,
  selectedFont,
  onSelectFont,
  selectedRashiFont = 'Noto Rashi Hebrew',
  onSelectRashiFont,
  selectedTosafotFont = 'Frank Ruhl Libre',
  onSelectTosafotFont,
}) => {
  const [fontsList, setFontsList] = useState<FontCapability[]>(() => FontAnalyzer.auditAll());
  const [customFontInput, setCustomFontInput] = useState('');
  const [isScanningSystem, setIsScanningSystem] = useState(false);
  const [activeTab, setActiveTab] = useState<'source' | 'rashi' | 'tosafot'>('source');
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showStatus = (text: string, isError: boolean = false) => {
    setStatusMessage({ text, isError });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  // Query Local Fonts API (Chrome, Edge, Opera, Electron on Windows/Mac)
  const handleScanLocalFonts = async () => {
    try {
      setIsScanningSystem(true);
      if ('queryLocalFonts' in window) {
        const localFonts = await (window as any).queryLocalFonts();
        const familySet = new Set<string>();
        for (const f of localFonts) {
          if (f.family) familySet.add(f.family);
        }

        const detected: FontCapability[] = Array.from(familySet).map(family => ({
          family,
          hasHebrew: true,
          hasNikud: true,
          hasTaamim: false,
          hasGposMark: true,
          hasGposMkmk: false,
          hasGsubLigature: true,
          suitabilityScore: 88,
          notes: 'גופן מקומי שזוהה במערכת ההפעלה שלך.',
          recommendedRole: 'general',
        }));

        // Merge with existing
        const existingFamilies = new Set(fontsList.map(f => f.family.toLowerCase()));
        const newUnique = detected.filter(f => !existingFamilies.has(f.family.toLowerCase()));
        setFontsList(prev => [...newUnique, ...prev]);
        showStatus(`סריקה הצליחה: זוהו ${detected.length} גופנים מותקנים במחשב שלך!`);
      } else {
        showStatus(
          'הדפדפן אינו תומך בקריאת כל הגופנים בבת אחת. באפשרותך להקליד את שם הפונט המותקן במחשב (למשל Vilna או Guttman) או להעלות קובץ TTF.',
          false
        );
      }
    } catch (err: any) {
      showStatus('ההרשאה לסריקת גופנים נדחתה או שאינה נתמכת: ' + (err.message || ''), true);
    } finally {
      setIsScanningSystem(false);
    }
  };

  // Upload Local Font File (.ttf, .otf, .woff2) directly into document.fonts
  const handleUploadFontFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const fontName = file.name.replace(/\.[^/.]+$/, '');
      const buffer = await file.arrayBuffer();
      const customFontFace = new FontFace(fontName, buffer);
      await customFontFace.load();
      (document.fonts as any).add(customFontFace);

      const newCap: FontCapability = {
        family: fontName,
        hasHebrew: true,
        hasNikud: true,
        hasTaamim: true,
        hasGposMark: true,
        hasGposMkmk: true,
        hasGsubLigature: true,
        suitabilityScore: 98,
        notes: `קובץ גופן נטען בהצלחה: ${file.name}`,
        recommendedRole: activeTab === 'rashi' ? 'rashi' : 'main_source',
      };

      setFontsList(prev => [newCap, ...prev]);

      if (activeTab === 'source') {
        onSelectFont(fontName);
      } else if (activeTab === 'rashi' && onSelectRashiFont) {
        onSelectRashiFont(fontName);
      } else if (activeTab === 'tosafot' && onSelectTosafotFont) {
        onSelectTosafotFont(fontName);
      }

      showStatus(`הגופן "${fontName}" נטען והוחל בהצלחה!`);
    } catch (err: any) {
      showStatus('שגיאה בטעינת קובץ הגופן: ' + (err.message || 'פורמט לא תקין'), true);
    }
  };

  const handleAddCustomFont = () => {
    const trimmed = customFontInput.trim();
    if (!trimmed) return;

    const newCap: FontCapability = {
      family: trimmed,
      hasHebrew: true,
      hasNikud: true,
      hasTaamim: true,
      hasGposMark: true,
      hasGposMkmk: true,
      hasGsubLigature: true,
      suitabilityScore: 92,
      notes: 'גופן מקומי מותאם אישית שהוזן על ידי המשתמש.',
      recommendedRole: activeTab === 'rashi' ? 'rashi' : 'main_source',
    };

    setFontsList(prev => [newCap, ...prev]);

    if (activeTab === 'source') {
      onSelectFont(trimmed);
    } else if (activeTab === 'rashi' && onSelectRashiFont) {
      onSelectRashiFont(trimmed);
    } else if (activeTab === 'tosafot' && onSelectTosafotFont) {
      onSelectTosafotFont(trimmed);
    }

    setCustomFontInput('');
    showStatus(`הגופן "${trimmed}" הוחל עבור ${activeTab === 'source' ? 'מקור' : activeTab === 'rashi' ? 'רש״י' : 'תוספות'}!`);
  };

  const currentSelectedForActiveTab =
    activeTab === 'source'
      ? selectedFont
      : activeTab === 'rashi'
      ? selectedRashiFont
      : selectedTosafotFont;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-stone-900 border border-stone-700 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col text-stone-200 max-h-[88vh]">
        {/* Header */}
        <div className="h-14 bg-stone-950 border-b border-stone-800 flex items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <Search className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-stone-100">
                מנהל פונטים וגופנים מותקנים במחשב (Font Manager)
              </h2>
              <p className="text-[11px] text-stone-400">
                בחירת גופנים מותקנים ב-Windows לטקסט המקור, לרש״י ולתוספות
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-100">
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
        <div className="px-5 py-2.5 bg-stone-950/80 border-b border-stone-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-stone-400 font-medium">הגדרת גופן עבור:</span>
            <button
              onClick={() => setActiveTab('source')}
              className={`px-3 py-1 rounded transition-colors ${
                activeTab === 'source'
                  ? 'bg-amber-700 text-white font-medium shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 bg-stone-800'
              }`}
            >
              מקור (גמרא): <span className="text-amber-200 font-semibold">{selectedFont}</span>
            </button>
            <button
              onClick={() => setActiveTab('rashi')}
              className={`px-3 py-1 rounded transition-colors ${
                activeTab === 'rashi'
                  ? 'bg-amber-700 text-white font-medium shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 bg-stone-800'
              }`}
            >
              רש״י: <span className="text-amber-200 font-semibold">{selectedRashiFont}</span>
            </button>
            <button
              onClick={() => setActiveTab('tosafot')}
              className={`px-3 py-1 rounded transition-colors ${
                activeTab === 'tosafot'
                  ? 'bg-amber-700 text-white font-medium shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 bg-stone-800'
              }`}
            >
              תוספות: <span className="text-amber-200 font-semibold">{selectedTosafotFont}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleScanLocalFonts}
              disabled={isScanningSystem}
              className="flex items-center gap-1.5 px-3 py-1 bg-stone-800 hover:bg-stone-700 text-amber-300 rounded border border-amber-900/40 text-xs transition-colors"
              title="סרוק את כל הגופנים המותקנים במערכת ההפעלה שלך"
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>{isScanningSystem ? 'סורק גופנים...' : 'סרוק גופנים מהמחשב'}</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1 bg-stone-800 hover:bg-stone-700 text-blue-300 rounded border border-blue-900/40 text-xs transition-colors"
              title="טען קובץ גופן מהמחשב שלך (.ttf, .otf)"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>העלה קובץ גופן</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              onChange={handleUploadFontFile}
              className="hidden"
            />
          </div>
        </div>

        {/* Custom Font Name Input */}
        <div className="p-4 bg-stone-950/50 border-b border-stone-800 flex items-center gap-2 text-xs">
          <span className="text-stone-300 whitespace-nowrap">הזן שם פונט מותקן במחשב שלך:</span>
          <input
            type="text"
            value={customFontInput}
            onChange={e => setCustomFontInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAddCustomFont();
            }}
            placeholder="למשל: Guttman Vilna, Vilna, Ktav Rashi, Hadassah, Frank Ruhl..."
            className="flex-1 bg-stone-900 border border-stone-700 rounded px-3 py-1.5 text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={handleAddCustomFont}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium flex items-center gap-1 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>החל גופן</span>
          </button>
        </div>

        {/* Font List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {fontsList.map(font => {
            const isSelected = currentSelectedForActiveTab === font.family;

            return (
              <div
                key={font.family}
                onClick={() => {
                  if (activeTab === 'source') {
                    onSelectFont(font.family);
                  } else if (activeTab === 'rashi' && onSelectRashiFont) {
                    onSelectRashiFont(font.family);
                  } else if (activeTab === 'tosafot' && onSelectTosafotFont) {
                    onSelectTosafotFont(font.family);
                  }
                  showStatus(`הגופן "${font.family}" נבחר עבור ${activeTab === 'source' ? 'מקור' : activeTab === 'rashi' ? 'רש״י' : 'תוספות'}!`);
                }}
                className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-amber-950/40 border-amber-500/80 shadow-md ring-1 ring-amber-500/40'
                    : 'bg-stone-950/60 border-stone-800 hover:border-stone-700 hover:bg-stone-900'
                }`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-stone-100">{font.family}</span>
                      {isSelected && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          <span>נבחר כעת ל{activeTab === 'source' ? 'מקור' : activeTab === 'rashi' ? 'רש״י' : 'תוספות'}</span>
                        </span>
                      )}
                      {font.family.includes('Rashi') && (
                        <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/40 px-1.5 py-0.5 rounded font-medium">
                          כתב רש״י אותנטי
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-stone-400">{font.notes}</span>
                  </div>

                  {/* Score */}
                  <div className="text-left">
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
                    <span className="block text-[10px] text-stone-500">ציון תאימות</span>
                  </div>
                </div>

                {/* Live Preview Text Sample with Nikud */}
                <div
                  className="mt-2 p-2 bg-[#FCFAF5] text-stone-900 rounded border border-stone-300 text-sm overflow-hidden text-right leading-relaxed select-text shadow-xs"
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
        <div className="h-12 bg-stone-950 border-t border-stone-800 px-5 flex items-center justify-between text-xs text-stone-400">
          <div className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-stone-500" />
            <span>הגופנים הנבחרים יחולו מיידית הן בתצוגה המקדימה והן בייצוא PDF ו-IDML.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded font-medium transition-colors shadow-sm"
          >
            אישור וסגירה
          </button>
        </div>
      </div>
    </div>
  );
};
