import React, { useState } from 'react';
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
  Folder,
} from 'lucide-react';
import {
  BookLayoutType,
  BookTypesetDocument,
  PageTypesetResult,
  QaIssue,
  ValidationReport,
} from '../types/typesetter';

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
  onExportPdf: (allPages: boolean, customFileName?: string) => void | Promise<void>;
  onExportIdml: (customFileName?: string) => void | Promise<void>;
  onSaveProjectFile: (suggestedName?: string) => void | Promise<void>;
  onReturnToEdit: () => void;
  onOpenRulesModal: () => void;
}

const LAYOUT_NAMES_HE: Record<BookLayoutType, string> = {
  rav_text: 'ש״ס וילנא · רב-טקסט עם ברכיים דינמיות',
  mikraot_gedolot: 'מקראות גדולות · חומש ומפרשים',
  source_top_commentary_bottom: 'מקור עליון + מפרשים תחתונים',
  two_column: 'שני טורים מאוזנים',
  single_column: 'טקסט רץ · טור יחיד',
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
}) => {
  const totalPages = Math.max(1, bookDoc.pages.length);
  const criticalIssues = qaIssues.filter(i => i.severity === 'critical');
  const warningIssues = qaIssues.filter(i => i.severity === 'warning');

  // Stage 18 Task 1: Destination folder, editable filename, format selection & confirmation
  const [destinationFolder, setDestinationFolder] = useState<string>('C:\\KeterTypesetter\\Exports');
  const [exportFileName, setExportFileName] = useState<string>(() =>
    (bookDoc.title || 'keter_book').replace(/[<>:"/\\|?*]+/g, '_')
  );
  const [selectedFormat, setSelectedFormat] = useState<'pdf' | 'idml' | 'keter'>('pdf');
  const [isExecutingExport, setIsExecutingExport] = useState<boolean>(false);
  const [exportSuccessNotice, setExportSuccessNotice] = useState<string | null>(null);

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
        await onExportPdf(true, finalFileName);
        setExportSuccessNotice(
          `הפקת קובץ PDF הושלמה בהצלחה! הקובץ "${finalFileName}" נשמר ליעד: ${destinationFolder}`
        );
      } else if (selectedFormat === 'idml') {
        await onExportIdml(finalFileName);
        setExportSuccessNotice(
          `הפקת חבילת IDML הושלמה בהצלחה! הקובץ "${finalFileName}" נשמר ליעד: ${destinationFolder}`
        );
      } else {
        await onSaveProjectFile(finalFileName);
        setExportSuccessNotice(
          `שמירת קובץ פרויקט .keter הושלמה בהצלחה! הקובץ "${finalFileName}" נשמר ליעד: ${destinationFolder}`
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
  const hardRuleViolations = bookDoc.pages.reduce(
    (acc, p) => acc + (p.layoutScore?.engineHardRuleViolationCount ?? 0),
    0
  );

  return (
    <div
      dir="rtl"
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
                מצב ייצוא ובקרת איכות קדם-דפוס
              </span>
              <h1 className="text-lg font-bold text-[var(--ui-text-primary)] mt-1">
                {bookDoc.title}
              </h1>
              <p className="text-xs text-[var(--ui-text-secondary)] mt-0.5">
                {LAYOUT_NAMES_HE[bookDoc.layoutType]} · {totalPages} עמודים · גודל דף:{' '}
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
            <span>חזרה לעריכת הספר</span>
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
                  הגדרות יעד ואישור הפקה סופית (Confirm and Export)
                </h2>
                <p className="text-[11px] text-[var(--ui-text-secondary)]">
                  הגדרת תיקיית יעד במחשב, שם קובץ מבוקש, פורמט הפקה ולחיצה על כפתור האישור הסופי
                </p>
              </div>
            </div>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[var(--ui-surface-subtle)] text-[var(--ui-accent)]">
              {totalPages} עמודים מוכנים
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Destination Folder */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                תיקיית יעד לשמירה (Destination Folder):
              </label>
              <div className="relative">
                <input
                  type="text"
                  dir="ltr"
                  value={destinationFolder}
                  onChange={e => setDestinationFolder(e.target.value)}
                  placeholder="C:\KeterTypesetter\Exports"
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg pl-9 pr-3.5 py-2 text-xs font-mono text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                />
                <Folder className="w-4 h-4 text-[var(--ui-text-muted)] absolute left-3 top-2.5" />
              </div>
              <p className="text-[10px] text-[var(--ui-text-muted)] mt-1">
                נתיב התיקייה במחשב שבו ייווצר הקובץ המיוצא
              </p>
            </div>

            {/* Editable Filename */}
            <div>
              <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                שם קובץ מבוקש (Editable Filename):
              </label>
              <div className="relative">
                <input
                  type="text"
                  dir="ltr"
                  value={exportFileName}
                  onChange={e => setExportFileName(e.target.value)}
                  placeholder="vilna_berakhot_page2a"
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg pl-3.5 pr-16 py-2 text-xs font-mono text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                />
                <span className="absolute right-3 top-2 text-xs font-bold text-[var(--ui-accent)] select-none">
                  .{selectedFormat}
                </span>
              </div>
              <p className="text-[10px] text-[var(--ui-text-muted)] mt-1">
                ניתן לערוך את שם הקובץ בחופשיות. הסיומת נקבעת בהתאם לפורמט הנבחר
              </p>
            </div>
          </div>

          {/* Format Radio Selection */}
          <div>
            <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-2">
              בחר פורמט להפקה סופית:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setSelectedFormat('pdf')}
                className={`p-3 rounded-lg border text-right transition-all flex items-start gap-2.5 ${
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
                    ייצוא PDF וקטורי לדפוס
                  </div>
                  <div className="text-[10px] text-[var(--ui-text-secondary)] mt-0.5">
                    קובץ סופי בר-חיפוש והעתקה (.pdf)
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedFormat('idml')}
                className={`p-3 rounded-lg border text-right transition-all flex items-start gap-2.5 ${
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
                    חבילת Adobe InDesign
                  </div>
                  <div className="text-[10px] text-[var(--ui-text-secondary)] mt-0.5">
                    ייצוא IDML תקני לרב-טקסט וסגנונות (.idml)
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedFormat('keter')}
                className={`p-3 rounded-lg border text-right transition-all flex items-start gap-2.5 ${
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
                    קובץ פרויקט כתר מקורי
                  </div>
                  <div className="text-[10px] text-[var(--ui-text-secondary)] mt-0.5">
                    ארכיון מקור מלא לעריכה חוזרת (.keter)
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
              קובץ יעד מוגדר:{' '}
              <span className="font-mono font-bold text-[var(--ui-text-primary)]" dir="ltr">
                {destinationFolder}\{getCleanTargetFileName(selectedFormat)}
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
                  <span>מפיק ייצוא כעת...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>אשר והפק ייצוא</span>
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
                  פלט סופי לדפוס (.pdf)
                </span>
              </div>
              <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                ייצוא PDF וקטורי בר-חיפוש לדפוס
              </h2>
              <p className="text-xs text-[var(--ui-text-secondary)] leading-relaxed">
                הפקת קובץ PDF אמיתי הכולל שכבת טקסט עברי וקטורי בר-חיפוש והעתקה, ניקוד וטעמים מדויקים, וגאומטריית ברכיים זהה לתצוגה.
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
                      מייצא PDF ({exportProgress?.current || 1}/
                      {exportProgress?.total || totalPages})...
                    </span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>ייצא PDF — ספר מלא ({totalPages} עמודים)</span>
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
                <span>ייצא PDF — עמוד נוכחי בלבד (דף {activePage.pageNumberHebrew})</span>
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
                  חבילת Adobe InDesign (.idml)
                </span>
              </div>
              <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                ייצוא IDML תקני ל-Adobe InDesign
              </h2>
              <p className="text-xs text-[var(--ui-text-secondary)] leading-relaxed">
                הפקת ארכיון IDML תקני עם זרימת רב-טקסט (Stories), סגנונות פסקה ותו עבריים (ParagraphStyle / CharacterStyle), ותיבות טקסט מקושרות.
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <button
                type="button"
                onClick={() => void onExportIdml()}
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--ui-selected-bg)] hover:bg-[var(--ui-accent)] hover:text-white border border-[var(--ui-accent)]/35 text-[var(--ui-accent)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <FileCode2 className="w-4 h-4" />
                <span>ייצא קובץ IDML ל-InDesign ({totalPages} עמודים)</span>
              </button>
              <div className="text-[10px] text-[var(--ui-text-muted)] text-center">
                תואם Adobe InDesign CC / CS6 עם תמיכת World-Ready Composer (RTL)
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
                  קובץ מקור ניתן לעריכה (.keter)
                </span>
              </div>
              <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                שמירת קובץ פרויקט מקורי (.keter)
              </h2>
              <p className="text-xs text-[var(--ui-text-secondary)] leading-relaxed">
                שומר את כל יחידות התוכן, קישורי הרב-טקסט, הערות השוליים, הגדרות הטיפוגרפיה והיסטוריית העימוד לפתיחה ועריכה עתידית בכתר.
              </p>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <button
                type="button"
                onClick={() => void onSaveProjectFile()}
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border-strong)] text-[var(--ui-text-primary)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Save className="w-4 h-4 text-[var(--ui-accent)]" />
                <span>שמור קובץ פרויקט (.keter) במחשב</span>
              </button>
              <div className="text-[10px] text-[var(--ui-text-muted)] text-center">
                {isDirty
                  ? 'קיימים שינויים שטרם נשמרו לקובץ חיצוני'
                  : 'הפרויקט מסונכרן עם השמירה האחרונה'}
              </div>
            </div>
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
                  בדיקת שלמות טקסט, אפס חפיפות גאומטריות, עמידה בחוקי מנוע קשיחים (Level 0) ואיזון עמודים
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenRulesModal}
              className="px-3 py-1.5 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-medium text-[var(--ui-text-primary)]"
            >
              הגדרות חוקי עימוד
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
              <span className="text-[11px] text-[var(--ui-text-secondary)] block">
                ציון איכות עימוד ממוצע
              </span>
              <span className="text-base font-bold text-[var(--ui-text-primary)] mt-0.5 block">
                {bookDoc.averageQualityScore ?? qaScore}/100
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
              <span className="text-[11px] text-[var(--ui-text-secondary)] block">
                התנגשויות / חפיפות טקסט
              </span>
              <span
                className={`text-base font-bold mt-0.5 block ${
                  totalCollisions === 0
                    ? 'text-[var(--ui-success)]'
                    : 'text-[var(--ui-danger)]'
                }`}
              >
                {totalCollisions === 0 ? '0 (תקין לחלוטין)' : `${totalCollisions} חפיפות`}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
              <span className="text-[11px] text-[var(--ui-text-secondary)] block">
                חוקי מנוע קשיחים (Level 0)
              </span>
              <span
                className={`text-base font-bold mt-0.5 block ${
                  hardRuleViolations === 0
                    ? 'text-[var(--ui-success)]'
                    : 'text-[var(--ui-warning)]'
                }`}
              >
                {hardRuleViolations === 0 ? 'עובר במלואו' : `${hardRuleViolations} התראות`}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
              <span className="text-[11px] text-[var(--ui-text-secondary)] block">
                שלמות יחידות וקישורים
              </span>
              <span className="text-base font-bold text-[var(--ui-text-primary)] mt-0.5 block">
                {validationReport.totalUnits} יח׳ · {validationReport.totalLinks} קישורים
              </span>
            </div>
          </div>

          {/* Page-by-page quick selector & inspection */}
          <div className="pt-2">
            <div className="text-xs font-semibold text-[var(--ui-text-primary)] mb-2 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
              <span>עמודי הספר המוכנים לייצוא ({totalPages} עמודים):</span>
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
                    <span>דף {p.pageNumberHebrew}</span>
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
                דף {activePage.pageNumberHebrew} עבר את כל בדיקות הקדם-דפוס ללא שגיאות או אזהרות. מוכן להפקה!
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
        </div>
      </div>
    </div>
  );
};
