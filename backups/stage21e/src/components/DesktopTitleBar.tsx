import React from 'react';
import {
  Crown,
  Minus,
  Square,
  X,
  Save,
  FolderOpen,
  FilePlus2,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { LicenseStatus } from '../engine/license-engine';

interface DesktopTitleBarProps {
  documentTitle: string;
  isModified?: boolean;
  totalPages: number;
  currentPage: number;
  currentPageHebrew: string;
  onOpenReport: () => void;
  onOpenTests: () => void;
  onNewProject?: () => void;
  onSaveProjectFile?: () => void;
  onLoadProjectFile?: () => void;
  onOpenLicense?: () => void;
  licenseStatus?: LicenseStatus;
  isVerifiedCommercialLicense?: boolean;
}

export const DesktopTitleBar: React.FC<DesktopTitleBarProps> = ({
  documentTitle,
  isModified = false,
  totalPages,
  currentPage,
  currentPageHebrew,
  onOpenTests,
  onNewProject,
  onSaveProjectFile,
  onLoadProjectFile,
  onOpenLicense,
  licenseStatus = 'unactivated',
  isVerifiedCommercialLicense = false,
}) => {
  return (
    <header
      dir="rtl"
      className="h-9 bg-[#090D14] border-b border-slate-800/80 flex items-center justify-between px-4 select-none text-xs text-slate-300 shrink-0 z-40"
    >
      {/* Zone 1 (RTL Start): Brand Emblem + Active Document Title */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-md bg-[#D4AF37]/15 border border-[#D4AF37]/40 flex items-center justify-center text-[#E6C665] shadow-xs">
            <Crown className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-slate-100 tracking-tight whitespace-nowrap text-[13px]">
            כתר · Keter Studio
          </span>
        </div>

        <span aria-hidden="true" className="text-slate-700">
          /
        </span>

        <div className="flex items-center gap-2 min-w-0">
          <span className="text-slate-200 font-medium truncate text-xs">
            {documentTitle}
          </span>
          {isModified && (
            <span
              className="text-[#E6C665] text-[11px] font-medium whitespace-nowrap"
              title="קיימים שינויים שלא נשמרו לקובץ פרויקט"
            >
              · לא נשמר
            </span>
          )}
          <span aria-hidden="true" className="text-slate-700">
            ·
          </span>
          <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap">
            דף {currentPageHebrew} ({currentPage}/{totalPages})
          </span>
        </div>
      </div>

      {/* Zone 2 (Center): Essential Quick Studio Actions */}
      <div className="hidden md:flex items-center gap-1.5">
        {onNewProject && (
          <button
            onClick={onNewProject}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/70 transition-colors text-[11px] whitespace-nowrap"
            title="יצירת פרויקט חדש (Ctrl+N)"
          >
            <FilePlus2 className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>חדש</span>
          </button>
        )}

        {onLoadProjectFile && (
          <button
            onClick={onLoadProjectFile}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/70 transition-colors text-[11px] whitespace-nowrap"
            title="פתיחת קובץ פרויקט שמור (.keter.json)"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
            <span>פתיחה</span>
          </button>
        )}

        {onSaveProjectFile && (
          <button
            onClick={onSaveProjectFile}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/70 transition-colors text-[11px] whitespace-nowrap"
            title="שמירת פרויקט כתר (.keter.json) (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>שמירה</span>
          </button>
        )}

        <div className="h-3.5 w-px bg-slate-800 mx-1" />

        <button
          onClick={onOpenTests}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors text-[11px] whitespace-nowrap"
          title="בקרת איכות ובדיקות מערכת (Preflight & QA)"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/90" />
          <span>בקרת איכות</span>
        </button>

        {onOpenLicense && (
          <button
            onClick={onOpenLicense}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors text-[11px] whitespace-nowrap ${
              licenseStatus === 'activated' && isVerifiedCommercialLicense
                ? 'text-emerald-300 hover:bg-emerald-950/40'
                : licenseStatus === 'activated'
                ? 'text-[#E6C665] hover:bg-[#D4AF37]/10'
                : licenseStatus === 'expired_or_invalid'
                ? 'text-rose-300 hover:bg-rose-950/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
            }`}
            title="ניהול רישיון מסחרי והפעלת מחשב"
          >
            <KeyRound className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>
              {licenseStatus === 'activated'
                ? isVerifiedCommercialLicense
                  ? 'רישיון מסחרי פעיל'
                  : 'רישיון מופעל (בדיקה)'
                : licenseStatus === 'deactivated'
                ? 'רישיון מנותק'
                : licenseStatus === 'expired_or_invalid'
                ? 'רישיון לא תקף'
                : 'רישוי והפעלה'}
            </span>
          </button>
        )}
      </div>

      {/* Zone 3 (RTL End): Standard Windows Caption Controls (LTR order) */}
      <div className="flex items-center gap-1" dir="ltr">
        <button
          type="button"
          aria-label="Minimize"
          className="w-7 h-6 flex items-center justify-center hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors rounded"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label="Maximize"
          className="w-7 h-6 flex items-center justify-center hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors rounded"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          type="button"
          aria-label="Close"
          className="w-7 h-6 flex items-center justify-center hover:bg-rose-700 text-slate-400 hover:text-white transition-colors rounded"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
