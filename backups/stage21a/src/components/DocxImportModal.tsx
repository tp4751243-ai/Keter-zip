import React, { useState } from 'react';
import { DocxImporter } from '../engine/docx-importer';
import { ContentRole, ContentUnit, RavTextLink } from '../types/typesetter';
import { FileUp, BookOpen, Scroll, CheckCircle, X, Sparkles, ShieldCheck, Files, Link2, Trash2 } from 'lucide-react';

interface DocxImportModalProps {
  onClose: () => void;
  onImportUnits: (units: ContentUnit[], title: string, links?: RavTextLink[]) => void;
}

interface UploadedFileEntry {
  file: File;
  name: string;
  role: ContentRole;
  sizeKb: number;
}

export const DocxImportModal: React.FC<DocxImportModalProps> = ({
  onClose,
  onImportUnits,
}) => {
  const [filesList, setFilesList] = useState<UploadedFileEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [autoDiscoverLinks, setAutoDiscoverLinks] = useState(true);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFilesAdded = (files: FileList | File[]) => {
    const newEntries: UploadedFileEntry[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.toLowerCase().endsWith('.docx')) continue;

      const detectedRole = DocxImporter.autoDetectRole(file.name, '');
      newEntries.push({
        file,
        name: file.name,
        role: detectedRole,
        sizeKb: Math.round(file.size / 1024),
      });
    }

    setFilesList(prev => [...prev, ...newEntries]);
  };

  const handleRemoveFile = (index: number) => {
    setFilesList(prev => prev.filter((_, i) => i !== index));
  };

  const handleRoleChange = (index: number, newRole: ContentRole) => {
    setFilesList(prev =>
      prev.map((item, i) => (i === index ? { ...item, role: newRole } : item))
    );
  };

  const handleProcessImport = async () => {
    if (filesList.length === 0) return;

    try {
      setIsProcessing(true);
      setImportStatus('קורא ומנתח קבצי DOCX...');

      const allUnits: ContentUnit[] = [];
      let totalOrder = 0;
      let primaryTitle = filesList[0]?.name.replace(/\.docx$/i, '') || 'ספר קודש';

      for (let i = 0; i < filesList.length; i++) {
        const item = filesList[i];
        setImportStatus(`מחלץ טקסט מתוך ${item.name}...`);
        const buffer = await item.file.arrayBuffer();
        const res = await DocxImporter.importDocx(buffer, item.name);

        if (i === 0 && res.metadata.title) {
          primaryTitle = res.metadata.title;
        }

        // Apply selected role to all body units of this file if specified
        for (const u of res.units) {
          totalOrder++;
          u.order = totalOrder;
          if (item.role !== 'main_source' && u.role === 'main_source') {
            u.role = item.role;
            if (!u.textRuns || !u.textRuns.some(r => r.isBold || r.isDibbur)) {
              u.textRuns = DocxImporter.buildRunsFromRawText(u.rawText, u.role, u.dibburHamatchil);
            }
          }
          allUnits.push(u);
        }
      }

      // Separate source and commentary units for link discovery
      let discoveredLinks: RavTextLink[] = [];
      if (autoDiscoverLinks && filesList.length > 1) {
        setImportStatus('מזהה קישורים אוטומטיים בין המפרשים לגמרא לפי דיבור המתחיל...');
        const sources = allUnits.filter(u => u.role === 'main_source' || u.role === 'chapter');
        const commentaries = allUnits.filter(
          u => u.role === 'primary_comment' || u.role === 'secondary_comment'
        );

        discoveredLinks = DocxImporter.autoLinkCommentariesToSource(sources, commentaries);
      }

      onImportUnits(allUnits, primaryTitle, discoveredLinks);
      onClose();
    } catch (err: any) {
      setErrorMessage('שגיאה ביבוא קבצי DOCX: ' + (err.message || 'קובץ שגוי'));
    } finally {
      setIsProcessing(false);
      setImportStatus(null);
    }
  };

  const handleSelectSample = (type: 'berakhot' | 'bereishit' | 'mussar' | 'shulchan_aruch') => {
    if (type === 'berakhot') {
      onImportUnits(DocxImporter.getSampleBerakhot(), 'מסכת ברכות — דף ב ע״א');
    } else if (type === 'bereishit') {
      onImportUnits(DocxImporter.getSampleBereishit(), 'חומש בראשית — פרשת בראשית');
    } else if (type === 'shulchan_aruch') {
      onImportUnits(DocxImporter.getSampleShulchanAruchTwoColumn(), 'שולחן ערוך — אורח חיים סימן א׳');
    } else {
      onImportUnits(DocxImporter.getSampleMussarSingleColumn(), 'מסילת ישרים — פרק ראשון');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-stone-900 border border-stone-700 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col text-stone-200 max-h-[90vh]">
        {/* Header */}
        <div className="h-14 bg-stone-950 border-b border-stone-800 flex items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <FileUp className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-stone-100">
                יבוא מסמכי Word (DOCX) וקישור אוטומטי (Multi-DOCX Import)
              </h2>
              <p className="text-[11px] text-stone-400">
                ניתן להעלות קובץ גמרא + קובץ רש״י + קובץ תוספות — המערכת תקשר ביניהם אוטומטית!
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 flex items-center justify-between">
              <span>{errorMessage}</span>
              <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-100">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {/* File Upload Drop Area */}
          <label
            onDragOver={e => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={e => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files) handleFilesAdded(e.dataTransfer.files);
            }}
            className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all ${
              dragActive
                ? 'border-amber-500 bg-amber-950/20'
                : 'border-stone-700 hover:border-stone-600 bg-stone-950/50'
            }`}
          >
            <input
              type="file"
              multiple
              accept=".docx"
              className="hidden"
              onChange={e => {
                if (e.target.files) handleFilesAdded(e.target.files);
              }}
            />
            <Files className="w-8 h-8 text-amber-400/90 mb-2" />
            <span className="font-semibold text-stone-200 text-sm mb-1">
              בחר או גרור לכאן קובץ אחד או מספר קובצי DOCX
            </span>
            <span className="text-stone-400 text-[11px]">
              (לדוגמה: גמרא.docx, רשי.docx, תוספות.docx — המערכת תסווג ותחבר ביניהם)
            </span>
          </label>

          {/* Uploaded Files Table */}
          {filesList.length > 0 && (
            <div className="space-y-2">
              <span className="font-semibold text-stone-300 block">
                קבצים שהועלו ({filesList.length}):
              </span>
              <div className="bg-stone-950 rounded-lg border border-stone-800 overflow-hidden divide-y divide-stone-800">
                {filesList.map((entry, idx) => (
                  <div key={idx} className="p-3 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="truncate font-medium text-stone-200">{entry.name}</span>
                      <span className="text-[10px] text-stone-500 font-mono">({entry.sizeKb} KB)</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-stone-400 text-[11px]">תפקיד הקובץ:</span>
                      <select
                        value={entry.role}
                        onChange={e => handleRoleChange(idx, e.target.value as ContentRole)}
                        className="bg-stone-900 border border-stone-700 text-stone-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-500"
                      >
                        <option value="main_source">טקסט מקור ראשי (גמרא / חומש)</option>
                        <option value="primary_comment">פירוש ראשון (רש״י)</option>
                        <option value="secondary_comment">פירוש שני (תוספות)</option>
                        <option value="footnote">הערות שוליים</option>
                      </select>

                      <button
                        onClick={() => handleRemoveFile(idx)}
                        className="p-1 hover:bg-stone-800 text-stone-400 hover:text-rose-400 rounded"
                        title="הסר קובץ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Auto Link Checkbox */}
              {filesList.length > 1 && (
                <label className="flex items-center gap-2 cursor-pointer pt-1 text-stone-300">
                  <input
                    type="checkbox"
                    checked={autoDiscoverLinks}
                    onChange={e => setAutoDiscoverLinks(e.target.checked)}
                    className="accent-amber-500 rounded"
                  />
                  <Link2 className="w-4 h-4 text-amber-400" />
                  <span>מצא וקשר אוטומטית דיבורי המתחיל בין המפרשים לגמרא</span>
                </label>
              )}
            </div>
          )}

          {/* Quick Holy-Book Samples */}
          <div>
            <span className="text-stone-400 font-medium block mb-2">
              או טען מסמך לדוגמה בלחיצה אחת:
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleSelectSample('berakhot')}
                className="p-2.5 rounded-lg bg-stone-950 border border-stone-800 hover:border-amber-600/50 hover:bg-stone-850 flex items-center gap-2 text-right transition-colors"
              >
                <Scroll className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <span className="font-semibold block text-stone-200">ש״ס ברכות — דף ב׳ ע״א</span>
                  <span className="text-[10px] text-stone-400">גמרא, רש״י, תוספות וברכיים</span>
                </div>
              </button>

              <button
                onClick={() => handleSelectSample('bereishit')}
                className="p-2.5 rounded-lg bg-stone-950 border border-stone-800 hover:border-amber-600/50 hover:bg-stone-850 flex items-center gap-2 text-right transition-colors"
              >
                <BookOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <span className="font-semibold block text-stone-200">חומש בראשית — פרק א׳</span>
                  <span className="text-[10px] text-stone-400">מקראות גדולות עם טעמי מקרא</span>
                </div>
              </button>

              <button
                onClick={() => handleSelectSample('mussar')}
                className="p-2.5 rounded-lg bg-stone-950 border border-stone-800 hover:border-amber-600/50 hover:bg-stone-850 flex items-center gap-2 text-right transition-colors"
              >
                <Scroll className="w-4 h-4 text-blue-400 shrink-0" />
                <div>
                  <span className="font-semibold block text-stone-200">מסילת ישרים — פרק א׳</span>
                  <span className="text-[10px] text-stone-400">טקסט רץ מלא והערות שוליים</span>
                </div>
              </button>

              <button
                onClick={() => handleSelectSample('shulchan_aruch')}
                className="p-2.5 rounded-lg bg-stone-950 border border-stone-800 hover:border-amber-600/50 hover:bg-stone-850 flex items-center gap-2 text-right transition-colors"
              >
                <BookOpen className="w-4 h-4 text-purple-400 shrink-0" />
                <div>
                  <span className="font-semibold block text-stone-200">שולחן ערוך — סימן א׳</span>
                  <span className="text-[10px] text-stone-400">עימוד שני טורים מסורתי</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-14 bg-stone-950 border-t border-stone-800 px-5 flex items-center justify-between text-xs">
          <span className="text-stone-400">
            {importStatus || 'המסמכים ייובאו תוך שימור מלא של טעמים, ניקוד וחלוקת פסקאות.'}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded font-medium transition-colors"
            >
              ביטול
            </button>
            <button
              onClick={handleProcessImport}
              disabled={filesList.length === 0 || isProcessing}
              className="px-5 py-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white rounded font-medium flex items-center gap-1.5 shadow-md transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              <span>{isProcessing ? 'מעבד...' : `ייבא ${filesList.length} קבצים ועמד ספר`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
