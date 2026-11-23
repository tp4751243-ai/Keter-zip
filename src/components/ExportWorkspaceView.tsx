import React, { useMemo, useState } from 'react';
import {
  Download,
  FileText,
  FileCode2,
  Save,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Layers,
  Sparkles,
  Loader2,
} from 'lucide-react';
import {
  BookLayoutType,
  BookTypesetDocument,
  PageTypesetResult,
  QaIssue,
  StructuredDiagnostic,
  ValidationReport,
} from '../types/typesetter';
import { useLanguage } from '../i18n/LanguageContext';
import { isFontEmbeddableInPdf } from '../engine/font-library';
import { Hint } from './Hint';
import { PdfExporter, PrintPdfOptions } from '../engine/pdf-exporter';
import { buildTocFromBook, titlePageSettingsToCoverData, type TocEntry } from '../engine/toc-engine';
import type { ProfessionalDesignSettings } from '../types/design-settings';
import { exportWord } from '../engine/word-exporter';
import { exportEpub } from '../engine/epub-exporter';
import { exportText } from '../engine/text-exporter';
import { exportHtml } from '../engine/html-exporter';

interface ExportWorkspaceViewProps {
  bookDoc: BookTypesetDocument;
  activePage: PageTypesetResult;
  currentPageIndex: number;
  onSelectPage: (idx: number) => void;
  validationReport: ValidationReport;
  qaScore: number;
  qaIssues: QaIssue[];
  isDirty: boolean;
  isExportingPdf: boolean;
  exportProgress: { current: number; total: number } | null;
  // v0.4.0 — returns true only when a file was actually downloaded.
  onExportPdf: (allPages: boolean, customFileName?: string) => boolean | Promise<boolean>;
  onExportIdml: (customFileName?: string) => void | Promise<void>;
  onSaveProjectFile: (suggestedName?: string) => void | Promise<void>;
  onReturnToEdit: () => void;
  onOpenRulesModal: () => void;
  // v0.5.0 (Title Page / Shaar Blat builder): the cover controls edit
  // the project's title-page settings (one cover system, not a second
  // export-time cover). Optional so older callers still compile.
  designSettings?: ProfessionalDesignSettings;
  onUpdateDesignSettings?: (next: ProfessionalDesignSettings, summaryHe?: string) => void;
  onEditTitlePage?: () => void;
  onDiagnosticAction?: (diag: StructuredDiagnostic) => void;
}

const LAYOUT_NAMES_HE: Record<BookLayoutType, string> = {
  rav_text: 'ש״ס וילנא · רב-טקסט עם ברכיים דינמיות',
  mikraot_gedolot: 'מקראות גדולות · חומש ומפרשים',
  source_top_commentary_bottom: 'מקור עליון + מפרשים תחתונים',
  two_column: 'שני טורים מאוזנים',
  single_column: 'טקסט רץ · טור יחיד',
  // v0.8.0 Part D — Yiddish sefarim.
  yiddish_sefer: 'ספר יידיש · מקור מול תרגום',
  // v0.5.0 Part C — Module 3: user-drawn text boxes over a base layout.
  custom_layout: 'פריסה מותאמת אישית · תיבות טקסט',
};

const LAYOUT_NAMES_EN: Record<BookLayoutType, string> = {
  rav_text: 'Vilna Shas · Multi-text with dynamic knees',
  mikraot_gedolot: 'Mikraot Gedolot · Chumash and commentaries',
  source_top_commentary_bottom: 'Source on top + commentaries below',
  two_column: 'Two balanced columns',
  single_column: 'Running text · Single column',
  // v0.8.0 Part D — Yiddish sefarim.
  yiddish_sefer: 'Yiddish Sefer · Source facing translation',
  // v0.5.0 Part C — Module 3.
  custom_layout: 'Custom layout · text boxes',
};

export const ExportWorkspaceView: React.FC<ExportWorkspaceViewProps> = ({
  bookDoc,
  activePage,
  currentPageIndex,
  onSelectPage,
  validationReport,
  qaScore,
  qaIssues,
  isDirty,
  isExportingPdf,
  exportProgress,
  onExportPdf,
  onExportIdml,
  onSaveProjectFile,
  onReturnToEdit,
  onOpenRulesModal,
  // v0.5.0 (Title Page).
  designSettings,
  onUpdateDesignSettings,
  onEditTitlePage,
  onDiagnosticAction,
}) => {
  const { t, tf, dir, lang } = useLanguage();
  const totalPages = Math.max(1, bookDoc.pages.length);
  const criticalIssues = qaIssues.filter(i => i.severity === 'critical');
  const warningIssues = qaIssues.filter(i => i.severity === 'warning');

  // Stage 18 Task 1: Destination folder, editable filename, format selection & confirmation
  // v0.4.0: the old "destination folder" field was a dead control — the
  // browser always downloads to its Downloads folder, so the typed path
  // was never used. Removed; the hint below says where the file lands.
  const [exportFileName, setExportFileName] = useState<string>(() =>
    (bookDoc.title || 'keter_book').replace(/[<>:"/\\|?*]+/g, '_')
  );
  const [selectedFormat, setSelectedFormat] = useState<'pdf' | 'idml' | 'keter'>('pdf');
  const [isExecutingExport, setIsExecutingExport] = useState<boolean>(false);
  const [exportSuccessNotice, setExportSuccessNotice] = useState<string | null>(null);

  // v0.3.0 module B: print-ready PDF options + extra exporters
  const [printPurpose, setPrintPurpose] = useState<'print' | 'screen' | 'proof'>('print');
  const [printColorMode, setPrintColorMode] = useState<'color' | 'blackOnly'>('color');
  const [printBleedMm, setPrintBleedMm] = useState<number>(3);
  const [printBleedEnabled, setPrintBleedEnabled] = useState<boolean>(true);
  const [printPageFrom, setPrintPageFrom] = useState<string>('');
  const [printPageTo, setPrintPageTo] = useState<string>('');
  const [printSpreads, setPrintSpreads] = useState<boolean>(false);
  const [printWatermark, setPrintWatermark] = useState<string>('');
  const [printIncludeToc, setPrintIncludeToc] = useState<boolean>(false);
  // v0.9.9 — on-screen TOC preview (Part A §5): the same engine the
  // export path uses (buildTocFromBook), recomputed from bookDoc, so
  // the page/folio refs update after every repagination — the view
  // re-renders because App hands it a new bookDoc on repagination.
  const [tocMaxLevel, setTocMaxLevel] = useState<number>(3);
  const [tocIncludeBookTitle, setTocIncludeBookTitle] = useState<boolean>(false);
  const tocEntries: TocEntry[] = useMemo(() => {
    const entries = buildTocFromBook(bookDoc).filter(e => e.level <= tocMaxLevel);
    if (!tocIncludeBookTitle || !bookDoc.title) return entries;
    // buildTocFromBook skips main_title lines; the engine's
    // includeBookTitle option is honoured here as a synthetic level-1
    // entry pointing at the first body page.
    const firstBodyPage = bookDoc.pages.find(p => !p.isTitlePage) ?? bookDoc.pages[0];
    return [
      {
        id: 'toc-book-title',
        title: bookDoc.title,
        level: 1,
        pageNumber: firstBodyPage?.pageNumber ?? 1,
        folioLabel: firstBodyPage?.folioDisplay ?? firstBodyPage?.pageNumberHebrew,
        physicalPageNumber: firstBodyPage?.physicalPageNumber,
      },
      ...entries,
    ];
  }, [bookDoc, tocMaxLevel, tocIncludeBookTitle]);
  const handleTocEntryClick = (entry: TocEntry) => {
    const idx = bookDoc.pages.findIndex(
      p => p.pageNumber === entry.pageNumber ||
        (entry.physicalPageNumber !== undefined && p.physicalPageNumber === entry.physicalPageNumber)
    );
    if (idx >= 0) onSelectPage(idx);
  };
  // v0.5.0 (Title Page): the cover toggle + details edit the PROJECT's
  // title-page settings (one cover system). The old export-time-only
  // subtitle/author state is gone — the title page is part of the
  // project, previewed live as its first page.
  const titlePage = designSettings?.titlePage;
  const titlePageEnabled = titlePage?.enabled === true;
  const updateTitlePage = (mutate: (next: NonNullable<typeof titlePage>) => void, summaryHe: string) => {
    if (!designSettings || !onUpdateDesignSettings || !titlePage) return;
    const cloned = JSON.parse(JSON.stringify(titlePage)) as NonNullable<typeof titlePage>;
    mutate(cloned);
    onUpdateDesignSettings({ ...designSettings, titlePage: cloned }, summaryHe);
  };
  const setTitlePageEnabled = (enabled: boolean) =>
    updateTitlePage(next => { next.enabled = enabled; }, enabled ? 'עמוד שער נוסף כעמוד הראשון של הספר.' : 'עמוד השער הוסר.');
  const setTitlePageField = (field: 'title' | 'subtitle' | 'author', text: string) =>
    updateTitlePage(next => { next[field] = { ...next[field], text }; }, `עמוד שער — ${field} עודכן`);
  const [isExportingPrint, setIsExportingPrint] = useState<boolean>(false);
  const [printProgress, setPrintProgress] = useState<{ current: number; total: number } | null>(null);
  const [extraExportNotice, setExtraExportNotice] = useState<string | null>(null);
  const [isExportingExtra, setIsExportingExtra] = useState<boolean>(false);

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const getCleanBaseName = () => {
    const base = (exportFileName.trim() || 'keter_export').replace(/\.(pdf|idml|keter|json|docx|epub|txt|html)$/i, '');
    return base;
  };

  const buildPrintOptions = (): PrintPdfOptions => {
    const from = parseInt(printPageFrom, 10);
    const to = parseInt(printPageTo, 10);
    const pageRange =
      Number.isFinite(from) && Number.isFinite(to)
        ? { from: Math.max(1, from), to: Math.max(from, to) }
        : Number.isFinite(from)
          ? { from: Math.max(1, from), to: totalPages }
          : Number.isFinite(to)
            ? { from: 1, to: Math.max(1, to) }
            : null;
    return {
      purpose: printPurpose,
      colorMode: printColorMode,
      bleedMm: printBleedEnabled ? printBleedMm : 0,
      pageRange,
      spreads: printSpreads,
      watermark: printWatermark.trim() || null,
      includeCover: titlePageEnabled,
      includeToc: printIncludeToc,
      coverData:
        titlePageEnabled && titlePage
          ? titlePageSettingsToCoverData(titlePage, bookDoc.title, bookDoc.geometry?.pageHeight ?? 792)
          : null,
    };
  };

  const handlePrintPdf = async () => {
    setIsExportingPrint(true);
    setPrintProgress({ current: 1, total: totalPages });
    setExtraExportNotice(null);
    try {
      const options = buildPrintOptions();
      const blob = await PdfExporter.generateMultiPagePdf(bookDoc, (current, total) => {
        setPrintProgress({ current, total });
      }, options);
      const suffix = options.spreads ? '_spreads' : options.purpose === 'proof' ? '_proof' : '_print';
      downloadBlob(blob, `${getCleanBaseName()}${suffix}.pdf`);
      setExtraExportNotice(t('הפקת PDF לדפוס הושלמה בהצלחה!'));
    } catch (err: any) {
      setExtraExportNotice(t('שגיאה בהפקת PDF לדפוס: ') + (err?.message || err));
    } finally {
      setIsExportingPrint(false);
      setPrintProgress(null);
    }
  };

  const handleExtraExport = async (kind: 'docx' | 'epub' | 'txt' | 'html') => {
    setIsExportingExtra(true);
    setExtraExportNotice(null);
    try {
      const title = bookDoc.title || 'keter_book';
      if (kind === 'docx') {
        downloadBlob(await exportWord(bookDoc, title), `${getCleanBaseName()}.docx`);
      } else if (kind === 'epub') {
        downloadBlob(await exportEpub(bookDoc, title), `${getCleanBaseName()}.epub`);
      } else if (kind === 'txt') {
        downloadBlob(exportText(bookDoc, title), `${getCleanBaseName()}.txt`);
      } else {
        downloadBlob(exportHtml(bookDoc, title), `${getCleanBaseName()}.html`);
      }
      setExtraExportNotice(t('הייצוא הושלם בהצלחה!'));
    } catch (err: any) {
      setExtraExportNotice(t('שגיאה בייצוא: ') + (err?.message || err));
    } finally {
      setIsExportingExtra(false);
    }
  };

  const getCleanTargetFileName = (fmt: 'pdf' | 'idml' | 'keter') => {
    let base = exportFileName.trim() || 'keter_export';
    base = base.replace(/\.(pdf|idml|keter|json)$/i, '');
    return `${base}.${fmt}`;
  };

  const handleConfirmAndExport = async () => {
    setIsExecutingExport(true);
    setExportSuccessNotice(null);
    try {
      const finalFileName = getCleanTargetFileName(selectedFormat);
      if (selectedFormat === 'pdf') {
        // v0.4.0 — the old code showed "export completed" even when the
        // PDF export had failed (App swallowed the error in a toast).
        // Show the success notice only when a file really downloaded.
        const ok = await onExportPdf(true, finalFileName);
        if (ok) {
          setExportSuccessNotice(
            tf('הפקת קובץ PDF הושלמה בהצלחה! הקובץ "{name}" הורד לתיקיית ההורדות.', { name: finalFileName })
          );
        }
      } else if (selectedFormat === 'idml') {
        await onExportIdml(finalFileName);
        setExportSuccessNotice(
            tf('הפקת חבילת IDML הושלמה בהצלחה! הקובץ "{name}" הורד לתיקיית ההורדות.', { name: finalFileName })
        );
      } else {
        await onSaveProjectFile(finalFileName);
        setExportSuccessNotice(
            tf('שמירת קובץ פרויקט .keter הושלמה בהצלחה! הקובץ "{name}" הורד לתיקיית ההורדות.', { name: finalFileName })
        );
      }
    } finally {
      setIsExecutingExport(false);
    }
  };

  const totalCollisions = bookDoc.pages.reduce(
    (acc, p) => acc + (p.layoutScore?.collisionCount ?? 0),
    0
  );
  // v0.8.0 Part E — PDF font preflight: every font family the book uses
  // (role styles, commentary tiers, running header, title page), flagged
  // before export instead of failing at the exporter's resolve step.
  const pdfFontCheck = useMemo(() => {
    const families = new Set<string>();
    if (designSettings) {
      for (const rs of Object.values(designSettings.roleStyles ?? {})) {
        const f = rs?.character?.fontFamily;
        if (f) families.add(f);
      }
      for (const tier of designSettings.pageLayout?.tiers ?? []) {
        if (tier.fontFamily) families.add(tier.fontFamily);
      }
      const rh = designSettings.pageElements?.runningHeader?.fontFamily;
      if (rh) families.add(rh);
      for (const slot of [
        designSettings.titlePage?.title,
        designSettings.titlePage?.subtitle,
        designSettings.titlePage?.author,
      ]) {
        if (slot?.fontFamily) families.add(slot.fontFamily);
      }
    }
    const nonEmbeddable = [...families].filter(
      f => isFontEmbeddableInPdf(f) === false
    );
    return { families: [...families], nonEmbeddable };
  }, [designSettings]);
  const hardRuleViolations = bookDoc.pages.reduce(
    (acc, p) => acc + (p.layoutScore?.engineHardRuleViolationCount ?? 0),
    0
  );

  return (
    <div
      dir={dir}
      className="flex-1 overflow-y-auto bg-[var(--ui-workspace-bg)] text-[var(--ui-text-primary)] p-6 md:p-8 select-none"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* TOP HEADER CARD */}
        <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[var(--ui-selected-bg)] border border-[var(--ui-accent)]/25 flex items-center justify-center shrink-0">
              <Download className="w-5 h-5 text-[var(--ui-accent)]" />
            </div>
            <div>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[var(--ui-selected-bg)] text-[var(--ui-accent)]">
                
                {t("מצב ייצוא ובקרת איכות קדם-דפוס")}
              </span>
              <h1 className="text-lg font-bold text-[var(--ui-text-primary)] mt-1">
                {bookDoc.title}
              </h1>
              <p className="text-xs text-[var(--ui-text-secondary)] mt-0.5">
                {lang === 'en' ? LAYOUT_NAMES_EN[bookDoc.layoutType] : LAYOUT_NAMES_HE[bookDoc.layoutType]} · {totalPages}  {t("עמודים · גודל דף:")}{' '}
                {Math.round(bookDoc.geometry.pageWidth)}×
                {Math.round(bookDoc.geometry.pageHeight)} pt
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onReturnToEdit}
            className="px-4 py-2 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-semibold text-[var(--ui-text-primary)] flex items-center gap-1.5 transition-colors"
          >
            <ArrowRight className="w-4 h-4 text-[var(--ui-accent)]" />
            <span>{t("חזרה לעריכת הספר")}</span>
          </button>
        </div>

        {/* PRIMARY DESTINATION FOLDER, FILENAME & FINAL CONFIRMATION ACTION */}
        <div className="bg-[var(--ui-surface)] border border-[var(--ui-accent)]/35 rounded-xl p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--ui-selected-bg)] flex items-center justify-center">
                <Download className="w-4 h-4 text-[var(--ui-accent)]" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                  
                  {t("בחירת פורמט ואישור ההפקה")}
                </h2>
                <p className="text-[11px] text-[var(--ui-text-secondary)]">
                  
                  {t("בחרו שם קובץ ופורמט, ולחצו על כפתור האישור")}
                </p>
              </div>
            </div>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[var(--ui-surface-subtle)] text-[var(--ui-accent)]">
              {totalPages}  {t("עמודים מוכנים")}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* v0.4.0: where the file goes (was a dead folder field) */}
            <div className="flex flex-col justify-center">
              <Hint>
                {t("הקובץ יורד לתיקיית ההורדות של הדפדפן. אפשר להעביר אותו אחר כך לכל תיקייה במחשב.")}
              </Hint>
            </div>

            {/* Editable Filename */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                
                {t("שם הקובץ:")}
              </label>
              <div className="relative">
                <input
                  type="text"
                  dir="ltr"
                  value={exportFileName}
                  onChange={e => setExportFileName(e.target.value)}
                  placeholder="vilna_berakhot_page2a"
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg pe-3.5 ps-16 py-2 text-xs font-mono text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                />
                <span dir="ltr" className="absolute right-3 top-2 text-xs font-bold text-[var(--ui-accent)] select-none">
                  .{selectedFormat}
                </span>
              </div>
              <p className="text-[10px] text-[var(--ui-text-muted)] mt-1">
                
                {t("ניתן לערוך את שם הקובץ בחופשיות. הסיומת נקבעת בהתאם לפורמט הנבחר")}
              </p>
            </div>
          </div>

          {/* Format Radio Selection */}
          <div>
            <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-2">
              
              {t("בחרו מה להפיק:")}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setSelectedFormat('pdf')}
                className={`p-3 rounded-lg border text-start transition-all flex items-start gap-2.5 ${
                  selectedFormat === 'pdf'
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] ring-1 ring-[var(--ui-accent)]/20'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <FileText
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    selectedFormat === 'pdf' ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-secondary)]'
                  }`}
                />
                <div>
                  <div className="text-xs font-bold text-[var(--ui-text-primary)]">
                    
                    {t("קובץ PDF לדפוס")}
                  </div>
                  <div className="text-[10px] text-[var(--ui-text-secondary)] mt-0.5">
                    
                    {t("קובץ סופי בר-חיפוש והעתקה (.pdf)")}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedFormat('idml')}
                className={`p-3 rounded-lg border text-start transition-all flex items-start gap-2.5 ${
                  selectedFormat === 'idml'
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] ring-1 ring-[var(--ui-accent)]/20'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <FileCode2
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    selectedFormat === 'idml' ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-secondary)]'
                  }`}
                />
                <div>
                  <div className="text-xs font-bold text-[var(--ui-text-primary)]">
                    
                    {t("קובץ InDesign")}
                  </div>
                  <div className="text-[10px] text-[var(--ui-text-secondary)] mt-0.5">
                    
                    {t("קובץ לפתיחה ב-Adobe InDesign (.idml)")}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedFormat('keter')}
                className={`p-3 rounded-lg border text-start transition-all flex items-start gap-2.5 ${
                  selectedFormat === 'keter'
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] ring-1 ring-[var(--ui-accent)]/20'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <Save
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    selectedFormat === 'keter' ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-secondary)]'
                  }`}
                />
                <div>
                  <div className="text-xs font-bold text-[var(--ui-text-primary)]">
                    
                    {t("קובץ פרויקט של כתר")}
                  </div>
                  <div className="text-[10px] text-[var(--ui-text-secondary)] mt-0.5">
                    
                    {t("שמירה מלאה לעריכה חוזרת (.keter)")}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Success Notification */}
          {exportSuccessNotice && (
            <div className="p-3.5 rounded-lg bg-[var(--ui-success-bg)] border border-[var(--ui-success)]/30 text-[var(--ui-success)] text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{exportSuccessNotice}</span>
            </div>
          )}

          {/* FINAL CONFIRMATION ACTION BUTTON */}
          <div className="pt-2 border-t border-[var(--ui-border)] flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-[11px] text-[var(--ui-text-secondary)]">
              {t("שם הקובץ:")}{' '}
              <span className="font-mono font-bold text-[var(--ui-text-primary)] inline-flex items-baseline" dir="ltr">
                <bdi>{(exportFileName.trim() || 'keter_export').replace(/\.(pdf|idml|keter|json)$/i, '')}</bdi>
                <span>.{selectedFormat}</span>
              </span>
            </div>

            <button
              type="button"
              disabled={isExecutingExport || isExportingPdf}
              onClick={handleConfirmAndExport}
              className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-colors"
            >
              {isExecutingExport || isExportingPdf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t("מפיק ייצוא כעת...")}</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>{t("הפק את הקובץ")}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* EXPORT FORMATS vs NATIVE PROJECT DISTINCTION GRID */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 1. Printable / Searchable Native PDF Export */}
          <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-lg bg-[var(--ui-selected-bg)] flex items-center justify-center">
                  <FileText className="w-4 h-4 text-[var(--ui-accent)]" />
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[var(--ui-surface-subtle)] text-[var(--ui-text-secondary)]">
                  
                  {t("פלט סופי לדפוס (.pdf)")}
                </span>
              </div>
              <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                
                {t("ייצוא PDF וקטורי בר-חיפוש לדפוס")}
              </h2>
              <p className="text-xs text-[var(--ui-text-secondary)] leading-relaxed">
                
                {t("הפקת קובץ PDF אמיתי הכולל שכבת טקסט עברי וקטורי בר-חיפוש והעתקה, ניקוד וטעמים מדויקים, וגאומטריית ברכיים זהה לתצוגה.")}
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <button
                type="button"
                disabled={isExportingPdf}
                onClick={() => onExportPdf(true)}
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                {isExportingPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      
                      {t("מייצא PDF (")}{exportProgress?.current || 1}/
                      {exportProgress?.total || totalPages})...
                    </span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>{t("ייצא PDF — ספר מלא (")}{totalPages}  {t("עמודים)")}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isExportingPdf}
                onClick={() => onExportPdf(false)}
                className="w-full py-2 px-3 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-medium text-[var(--ui-text-primary)] flex items-center justify-center gap-1.5 transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>{t("ייצא PDF — עמוד נוכחי בלבד (דף")} {activePage?.pageNumberHebrew ?? 'א׳'})</span>
              </button>
            </div>
          </div>

          {/* 2. Adobe InDesign IDML Export */}
          <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-lg bg-[var(--ui-selected-bg)] flex items-center justify-center">
                  <FileCode2 className="w-4 h-4 text-[var(--ui-accent)]" />
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[var(--ui-surface-subtle)] text-[var(--ui-text-secondary)]">
                  
                  {t("חבילת Adobe InDesign (.idml)")}
                </span>
              </div>
              <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                
                {t("ייצוא IDML תקני ל-Adobe InDesign")}
              </h2>
              <p className="text-xs text-[var(--ui-text-secondary)] leading-relaxed">
                
                {t("הפקת ארכיון IDML תקני עם זרימת רב-טקסט (Stories), סגנונות פסקה ותו עבריים (ParagraphStyle / CharacterStyle), ותיבות טקסט מקושרות.")}
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <button
                type="button"
                onClick={() => void onExportIdml()}
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--ui-selected-bg)] hover:bg-[var(--ui-accent)] hover:text-white border border-[var(--ui-accent)]/35 text-[var(--ui-accent)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <FileCode2 className="w-4 h-4" />
                <span>{t("ייצא קובץ IDML ל-InDesign (")}{totalPages}  {t("עמודים)")}</span>
              </button>
              <div className="text-[10px] text-[var(--ui-text-muted)] text-center">
                
                {t("תואם Adobe InDesign CC / CS6 עם תמיכת World-Ready Composer (RTL)")}
              </div>
            </div>
          </div>

          {/* 3. Native Editable Project File (.keter) */}
          <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-lg bg-[var(--ui-selected-bg)] flex items-center justify-center">
                  <Save className="w-4 h-4 text-[var(--ui-accent)]" />
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[var(--ui-success-bg)] text-[var(--ui-success)]">
                  
                  {t("קובץ מקור ניתן לעריכה (.keter)")}
                </span>
              </div>
              <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                
                {t("שמירת קובץ פרויקט מקורי (.keter)")}
              </h2>
              <p className="text-xs text-[var(--ui-text-secondary)] leading-relaxed">
                
                {t("שומר את כל יחידות התוכן, קישורי הרב-טקסט, הערות השוליים, הגדרות הטיפוגרפיה והיסטוריית העימוד לפתיחה ועריכה עתידית בכתר.")}
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <button
                type="button"
                onClick={() => void onSaveProjectFile()}
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border-strong)] text-[var(--ui-text-primary)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Save className="w-4 h-4 text-[var(--ui-accent)]" />
                <span>{t("שמור קובץ פרויקט (.keter) במחשב")}</span>
              </button>
              <div className="text-[10px] text-[var(--ui-text-muted)] text-center">
                {isDirty
                  ? t("קיימים שינויים שטרם נשמרו לקובץ חיצוני")
                  : t("הפרויקט מסונכרן עם השמירה האחרונה")}
              </div>
            </div>
          </div>
        </div>

        {/* v0.3.0 MODULE B: PRINT-READY PDF OPTIONS + EXTRA EXPORTERS */}
        <div className="bg-[var(--ui-surface)] border border-[var(--ui-accent)]/35 rounded-xl p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--ui-selected-bg)] flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-[var(--ui-accent)]" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                  {t("אפשרויות PDF לדפוס (Print-Ready)")}
                </h2>
                <p className="text-[11px] text-[var(--ui-text-secondary)]">
                  {t("בליד, טווח עמודים, סימן מים, כפולות, שחור-לבן, שער ותוכן עניינים — מופק ישירות מהמנוע הווקטורי")}
                </p>
                <Hint className="mt-1">{t("האפשרויות האלה מיועדות לדפוס מקצועי. אם אינכם בטוחים — השאירו הכול כמו שזה.")}</Hint>
              </div>
            </div>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[var(--ui-surface-subtle)] text-[var(--ui-accent)]">
              {t("חדש ב־v0.3.0")}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Purpose */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                {t("מטרת הקובץ:")}
              </label>
              <select
                value={printPurpose}
                onChange={e => setPrintPurpose(e.target.value as 'print' | 'screen' | 'proof')}
                className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
              >
                <option value="print">{t("דפוס (עם בליד וסימני חיתוך)")}</option>
                <option value="screen">{t("מסך (ללא בליד)")}</option>
                <option value="proof">{t("הגהה (עם סימן מים)")}</option>
              </select>
            </div>

            {/* Color mode */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                {t("צבע:")}
              </label>
              <select
                value={printColorMode}
                onChange={e => setPrintColorMode(e.target.value as 'color' | 'blackOnly')}
                className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
              >
                <option value="color">{t("צבע מלא")}</option>
                <option value="blackOnly">{t("שחור-לבן (גווני אפור)")}</option>
              </select>
            </div>

            {/* Bleed */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                {t("בליד — רווח לחיתוך (מ״מ):")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={printBleedEnabled}
                  onChange={e => setPrintBleedEnabled(e.target.checked)}
                  className="w-4 h-4 accent-[var(--ui-accent)]"
                />
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  dir="ltr"
                  value={printBleedMm}
                  disabled={!printBleedEnabled || printPurpose === 'screen'}
                  onChange={e => setPrintBleedMm(Math.max(0, Number(e.target.value) || 0))}
                  className="w-20 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)] disabled:opacity-50"
                />
                <span className="text-[10px] text-[var(--ui-text-muted)]">
                  {t("ברירת מחדל 3 מ״מ")}
                </span>
              </div>
            </div>

            {/* Page range */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                {t("טווח עמודים (ריק = כל הספר):")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  dir="ltr"
                  value={printPageFrom}
                  onChange={e => setPrintPageFrom(e.target.value)}
                  placeholder="1"
                  className="w-20 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                />
                <span className="text-xs text-[var(--ui-text-secondary)]">–</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  dir="ltr"
                  value={printPageTo}
                  onChange={e => setPrintPageTo(e.target.value)}
                  placeholder={String(totalPages)}
                  className="w-20 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                />
              </div>
            </div>

            {/* Watermark */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                {t("סימן מים (טקסט אלכסוני):")}
              </label>
              <input
                type="text"
                value={printWatermark}
                onChange={e => setPrintWatermark(e.target.value)}
                placeholder={printPurpose === 'proof' ? 'PROOF · הגהה' : t("למשל: טיוטה")}
                className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
              />
            </div>

            {/* Spreads + cover + TOC */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                {t("עמודים נוספים ותצוגה:")}
              </label>
              <div className="space-y-1.5 text-xs text-[var(--ui-text-primary)]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={printSpreads}
                    onChange={e => setPrintSpreads(e.target.checked)}
                    className="w-4 h-4 accent-[var(--ui-accent)]"
                  />
                  <span>{t("כפולות — שני עמודים בגיליון רחב")}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={titlePageEnabled}
                    onChange={e => setTitlePageEnabled(e.target.checked)}
                    className="w-4 h-4 accent-[var(--ui-accent)]"
                  />
                  <span>{t("הוסף עמוד שער")}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={printIncludeToc}
                    onChange={e => setPrintIncludeToc(e.target.checked)}
                    className="w-4 h-4 accent-[var(--ui-accent)]"
                  />
                  <span>{t("הוסף תוכן עניינים")}</span>
                </label>
              </div>
            </div>
          </div>

          {/* Cover details (shown when cover is on) — v0.5.0 (Title Page):
              the fields edit the project's title-page settings; the full
              editor (border, all fields) lives in the Design tab. */}
          {titlePageEnabled && titlePage && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                    {t("שם הספר")}
                  </label>
                  <input
                    type="text"
                    value={titlePage.title.text}
                    placeholder={bookDoc.title}
                    onChange={e => setTitlePageField('title', e.target.value)}
                    className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                    {t("כותרת משנה לשער:")}
                  </label>
                  <input
                    type="text"
                    value={titlePage.subtitle.text}
                    onChange={e => setTitlePageField('subtitle', e.target.value)}
                    className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                    {t("מחבר / מוציא לאור לשער:")}
                  </label>
                  <input
                    type="text"
                    value={titlePage.author.text}
                    onChange={e => setTitlePageField('author', e.target.value)}
                    className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onEditTitlePage?.()}
                  className="px-3 py-1.5 rounded-lg border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-subtle)]"
                >
                  {t("ערוך את עמוד השער המלא")}
                </button>
                <span className="text-[11px] text-[var(--ui-text-secondary)]">
                  {t("עמוד השער נערך בלשונית ״עמוד שער״ בעיצוב.")}
                  {titlePage.coverMode === 'print_wraparound_cover' && titlePage.wraparoundCover
                    ? ` (${t('כריכה מלאה לדפוס')} · ${titlePage.wraparoundCover.spineWidthMm}mm)`
                    : ''}
                </span>
              </div>
            </div>
          )}

          {/* v0.9.9 — on-screen TOC preview: the entries the exported
              TOC will contain, with live page/folio refs. Clicking an
              entry jumps to its page (edit view). The level filter and
              the book-title toggle are the engine's existing options
              (BuildTocOptions.maxLevel / includeBookTitle); they only
              change this preview and the export TOC follows the same
              includeToc flag above. */}
          {printIncludeToc && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="block text-xs font-semibold text-[var(--ui-text-primary)]">
                  {t("תוכן עניינים — תצוגה מקדימה:")}
                </label>
                <div className="flex items-center gap-3 text-[11px] text-[var(--ui-text-secondary)]">
                  <label className="flex items-center gap-1.5">
                    <span>{t("רמות:")}</span>
                    <select
                      value={tocMaxLevel}
                      onChange={e => setTocMaxLevel(Number(e.target.value))}
                      className="bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded px-1.5 py-1 text-[11px] text-[var(--ui-text-primary)] focus:outline-none"
                    >
                      <option value={1}>{t("1 — פרקים בלבד")}</option>
                      <option value={2}>{t("2 — עד כותרות")}</option>
                      <option value={3}>{t("3 — עד כותרות משנה")}</option>
                      <option value={4}>{t("4 — הכול")}</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={tocIncludeBookTitle}
                      onChange={e => setTocIncludeBookTitle(e.target.checked)}
                      className="w-3.5 h-3.5 accent-[var(--ui-accent)]"
                    />
                    <span>{t("כלול את שם הספר")}</span>
                  </label>
                </div>
              </div>
              {tocEntries.length === 0 ? (
                <p className="text-[11px] text-[var(--ui-text-secondary)]">
                  {t("לא נמצאו כותרות (פרק / סימן / כותרת) בספר — תוכן העניינים יהיה ריק.")}
                </p>
              ) : (
                <ul className="max-h-64 overflow-y-auto rounded-lg border border-[var(--ui-border)] divide-y divide-[var(--ui-border)] bg-[var(--ui-surface-subtle)]">
                  {tocEntries.map(entry => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => handleTocEntryClick(entry)}
                        className="w-full flex items-baseline gap-2 px-3 py-1.5 text-xs text-start hover:bg-[var(--ui-surface-hover)]"
                        style={{ paddingInlineStart: `${0.75 + (entry.level - 1) * 1.1}rem` }}
                      >
                        <span className="flex-1 truncate text-[var(--ui-text-primary)]">{entry.title}</span>
                        <span className="shrink-0 text-[var(--ui-text-secondary)] tabular-nums">
                          {entry.folioLabel ?? (entry.pageNumber !== undefined ? String(entry.pageNumber) : '')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-[var(--ui-text-secondary)]">
                {t("לחיצה על שורה עוברת לעמוד שלה. העמודים מתעדכנים אוטומטית לאחר עימוד מחדש.")}
              </p>
            </div>
          )}

          {/* Print PDF action */}
          <div className="pt-2 border-t border-[var(--ui-border)]">
            <button
              type="button"
              disabled={isExportingPrint || isExportingPdf}
              onClick={() => void handlePrintPdf()}
              className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-colors"
            >
              {isExportingPrint ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {t("מפיק PDF לדפוס (")}
                    {printProgress?.current || 1}/{printProgress?.total || totalPages})...
                  </span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>{t("ייצא PDF לדפוס עם האפשרויות שנבחרו")}</span>
                </>
              )}
            </button>
          </div>

          {/* Extra exporters */}
          <div className="pt-2 border-t border-[var(--ui-border)] space-y-3">
            <h3 className="text-xs font-bold text-[var(--ui-text-primary)]">
              {t("ייצוא בפורמטים נוספים:")}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button
                type="button"
                disabled={isExportingExtra}
                onClick={() => void handleExtraExport('docx')}
                className="py-2.5 px-3 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-semibold text-[var(--ui-text-primary)] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <FileText className="w-4 h-4 text-[var(--ui-accent)]" />
                <span>{t("Word (.docx)")}</span>
              </button>
              <button
                type="button"
                disabled={isExportingExtra}
                onClick={() => void handleExtraExport('epub')}
                className="py-2.5 px-3 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-semibold text-[var(--ui-text-primary)] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <BookOpen className="w-4 h-4 text-[var(--ui-accent)]" />
                <span>{t("EPUB (.epub)")}</span>
              </button>
              <button
                type="button"
                disabled={isExportingExtra}
                onClick={() => void handleExtraExport('txt')}
                className="py-2.5 px-3 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-semibold text-[var(--ui-text-primary)] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <FileText className="w-4 h-4 text-[var(--ui-accent)]" />
                <span>{t("טקסט (.txt)")}</span>
              </button>
              <button
                type="button"
                disabled={isExportingExtra}
                onClick={() => void handleExtraExport('html')}
                className="py-2.5 px-3 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-semibold text-[var(--ui-text-primary)] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <FileCode2 className="w-4 h-4 text-[var(--ui-accent)]" />
                <span>{t("HTML (.html)")}</span>
              </button>
            </div>
            <p className="text-[10px] text-[var(--ui-text-muted)]">
              {t("ייצוא Word כולל הערות שוליים אמיתיות; EPUB מחולק לפרקים; HTML הוא קובץ עצמאי עם CSS מוטמע.")}
            </p>
            {extraExportNotice && (
              <div className="p-3 rounded-lg bg-[var(--ui-success-bg)] border border-[var(--ui-success)]/30 text-[var(--ui-success)] text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{extraExportNotice}</span>
              </div>
            )}
          </div>
        </div>

        {/* PREFLIGHT & QUALITY READINESS SUMMARY */}
        <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-[var(--ui-success)]" />
              <div>
                <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                  דו״ח בקרת איכות קדם-דפוס (Preflight & Layout QA)
                </h2>
                <p className="text-[11px] text-[var(--ui-text-secondary)]">
                  
                  {t("בדיקת שלמות טקסט, אפס חפיפות גאומטריות, עמידה בחוקי מנוע קשיחים (Level 0) ואיזון עמודים")}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenRulesModal}
              className="px-3 py-1.5 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-medium text-[var(--ui-text-primary)]"
            >
              
              {t("הגדרות חוקי עימוד")}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
              <span className="text-[11px] text-[var(--ui-text-secondary)] block">
                
                {t("ציון איכות עימוד ממוצע")}
              </span>
              <span className="text-base font-bold text-[var(--ui-text-primary)] mt-0.5 block">
                {bookDoc.averageQualityScore ?? qaScore}/100
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
              <span className="text-[11px] text-[var(--ui-text-secondary)] block">
                
                {t("התנגשויות / חפיפות טקסט")}
              </span>
              <span
                className={`text-base font-bold mt-0.5 block ${
                  totalCollisions === 0
                    ? 'text-[var(--ui-success)]'
                    : 'text-[var(--ui-danger)]'
                }`}
              >
                {totalCollisions === 0 ? t("0 (תקין לחלוטין)") : totalCollisions === 1 ? tf('{count} חפיפה', { count: totalCollisions }) : tf('{count} חפיפות', { count: totalCollisions })}
              </span>
            </div>

            {/* v0.8.0 Part E — PDF font preflight tile: a scanned system
                font without an uploaded binary fails the PDF export, so
                flag it here, where the user is about to export. */}
            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]" title={pdfFontCheck.nonEmbeddable.length > 0 ? pdfFontCheck.nonEmbeddable.join('\n') : undefined}>
              <span className="text-[11px] text-[var(--ui-text-secondary)] block">
                {t("גופנים ב-PDF")}
              </span>
              <span
                className={`text-base font-bold mt-0.5 block ${
                  pdfFontCheck.nonEmbeddable.length === 0
                    ? 'text-[var(--ui-success)]'
                    : 'text-[var(--ui-warning)]'
                }`}
              >
                {pdfFontCheck.nonEmbeddable.length === 0
                  ? t("הכל ניתן להטמעה")
                  : `${pdfFontCheck.nonEmbeddable.length} ${t('גופנים לא ניתנים להטמעה')}`}
              </span>
              {pdfFontCheck.nonEmbeddable.length > 0 && (
                <span className="text-[10px] text-[var(--ui-warning)] block mt-0.5 leading-snug">
                  {t('העלה קובץ TTF/OTF במנהל הגופנים, אחרת ייצוא ה-PDF ייכשל.')}
                </span>
              )}
            </div>

            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
              <span className="text-[11px] text-[var(--ui-text-secondary)] block">
                
                {t("חוקי מנוע קשיחים (Level 0)")}
              </span>
              <span
                className={`text-base font-bold mt-0.5 block ${
                  hardRuleViolations === 0
                    ? 'text-[var(--ui-success)]'
                    : 'text-[var(--ui-warning)]'
                }`}
              >
                {hardRuleViolations === 0 ? t("עובר במלואו") : hardRuleViolations === 1 ? tf('{count} התראה', { count: hardRuleViolations }) : tf('{count} התראות', { count: hardRuleViolations })}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
              <span className="text-[11px] text-[var(--ui-text-secondary)] block">
                
                {t("שלמות יחידות וקישורים")}
              </span>
              <span className="text-base font-bold text-[var(--ui-text-primary)] mt-0.5 block">
                {validationReport.totalUnits}  {t("יח׳ ·")} {validationReport.totalLinks}  {t("קישורים")}
              </span>
            </div>
          </div>

          {/* Page-by-page quick selector & inspection */}
          <div className="pt-2">
            <div className="text-xs font-semibold text-[var(--ui-text-primary)] mb-2 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
              <span>{t("עמודי הספר המוכנים לייצוא (")}{totalPages}  {t("עמודים):")}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {bookDoc.pages.map((p, idx) => {
                const isSelected = idx === currentPageIndex;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onSelectPage(idx)}
                    className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-all ${
                      isSelected
                        ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-semibold'
                        : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                    }`}
                  >
                    <span>{t("דף")} {p.pageNumberHebrew}</span>
                    <span className="text-[10px] opacity-75 font-mono">
                      ({p.layoutScore?.totalScore ?? 95}%)
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Page QA Details */}
          {criticalIssues.length === 0 && warningIssues.length === 0 ? (
            <div className="p-3 rounded-lg bg-[var(--ui-success-bg)] border border-[var(--ui-success)]/30 text-[var(--ui-success)] text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                
                {t("דף")} {activePage?.pageNumberHebrew ?? 'א׳'}  {t("עבר את כל בדיקות הקדם-דפוס ללא שגיאות או אזהרות. מוכן להפקה!")}
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {[...criticalIssues, ...warningIssues].map(issue => (
                <div
                  key={issue.id}
                  className="p-2.5 rounded-lg bg-[var(--ui-warning-bg)] border border-[var(--ui-warning)]/30 text-[var(--ui-warning)] text-xs flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Engine Structured Diagnostics */}
          {bookDoc.diagnostics && bookDoc.diagnostics.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-[var(--ui-border)]" data-testid="export-structured-diagnostics">
              <div className="text-xs font-semibold text-[var(--ui-text-primary)]">
                {t("אבחוני מנוע קדם-דפוס")} ({bookDoc.diagnostics.length})
              </div>
              {bookDoc.diagnostics.slice(0, 10).map(diag => (
                <div
                  key={diag.id}
                  className="p-2.5 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] text-xs flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className={`w-4 h-4 shrink-0 ${
                        diag.severity === 'critical'
                          ? 'text-[var(--ui-danger)]'
                          : diag.severity === 'warning'
                            ? 'text-[var(--ui-warning)]'
                            : 'text-[var(--ui-accent)]'
                      }`}
                    />
                    <span>{lang === 'en' ? diag.messageEn : diag.messageHe}</span>
                  </div>
                  {diag.fixAction && (
                    <button
                      type="button"
                      onClick={() => {
                        if (onDiagnosticAction) onDiagnosticAction(diag);
                        else onReturnToEdit();
                      }}
                      className="shrink-0 px-2.5 py-1 rounded border border-[var(--ui-border)] bg-[var(--ui-surface)] hover:bg-[var(--ui-surface-hover)] text-[11px] font-medium"
                    >
                      {lang === 'en' ? diag.fixAction.labelEn : diag.fixAction.labelHe}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
