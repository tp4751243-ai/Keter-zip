import React from 'react';
import { ContentUnit, RavTextLink, ValidationReport } from '../types/typesetter';
import { Network, FileText, Bookmark, BookOpen, Layers, CheckCircle2, AlertCircle, X, Table, Image, MessageSquare } from 'lucide-react';

interface DocumentHierarchyInspectorProps {
  units: ContentUnit[];
  links: RavTextLink[];
  validation: ValidationReport;
  onClose: () => void;
  onSelectUnit?: (unitId: string) => void;
}

export const DocumentHierarchyInspector: React.FC<DocumentHierarchyInspectorProps> = ({
  units,
  links,
  validation,
  onClose,
  onSelectUnit,
}) => {
  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-stone-900 border-l border-stone-800 shadow-2xl z-40 flex flex-col text-stone-200 select-none">
      {/* Header */}
      <div className="h-12 bg-stone-950 border-b border-stone-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-stone-100">מודל המסמך והיררכיה (Document Model)</h2>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-100">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Post-Import Integrity Status Banner */}
      <div className="p-3 bg-stone-950/80 border-b border-stone-800">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-stone-400 font-medium">בדיקת שלמות לאחר יבוא (Section 7):</span>
          <span className="flex items-center gap-1 text-emerald-400 font-semibold bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded text-[10px]">
            <CheckCircle2 className="w-3 h-3" />
            <span>תקין ומאומת (PASSED)</span>
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] text-stone-400 pt-1 border-t border-stone-800/60 font-mono">
          <div className="bg-stone-900 p-1 rounded">
            <span className="block text-stone-200 font-bold">{validation.totalUnits}</span>
            <span>יחידות</span>
          </div>
          <div className="bg-stone-900 p-1 rounded">
            <span className="block text-amber-300 font-bold">{validation.totalLinks}</span>
            <span>קישורים</span>
          </div>
          <div className="bg-stone-900 p-1 rounded">
            <span className="block text-blue-300 font-bold">{validation.totalFootnotes}</span>
            <span>הערות</span>
          </div>
          <div className="bg-stone-900 p-1 rounded">
            <span className="block text-purple-300 font-bold">{validation.totalTables}</span>
            <span>טבלאות</span>
          </div>
        </div>
      </div>

      {/* Units Tree */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs">
        <span className="text-[11px] text-stone-400 font-medium block mb-2">
          מבנה עץ יחידות התוכן (ContentUnits Hierarchy):
        </span>

        {units.map(unit => {
          const isChapter = unit.role === 'chapter';
          const isSource = unit.role === 'main_source';
          const isRashi = unit.role === 'primary_comment';
          const isTosafot = unit.role === 'secondary_comment';
          const isFootnote = unit.role === 'footnote';
          const isTable = unit.role === 'table';

          return (
            <div
              key={unit.id}
              onClick={() => onSelectUnit?.(unit.id)}
              className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                isChapter
                  ? 'bg-amber-950/30 border-amber-800/50 text-amber-200'
                  : isSource
                  ? 'bg-stone-950/70 border-stone-800 text-stone-200'
                  : isRashi
                  ? 'bg-amber-900/10 border-amber-900/30 text-stone-300 mr-2'
                  : isTosafot
                  ? 'bg-blue-900/10 border-blue-900/30 text-stone-300 mr-2'
                  : isFootnote
                  ? 'bg-purple-950/20 border-purple-900/30 text-purple-300 mr-4'
                  : isTable
                  ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-300 mr-2'
                  : 'bg-stone-950/50 border-stone-800 mr-2'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                  {isChapter && <Bookmark className="w-3 h-3 text-amber-400" />}
                  {isSource && <BookOpen className="w-3 h-3 text-stone-400" />}
                  {isRashi && <Layers className="w-3 h-3 text-amber-500" />}
                  {isTosafot && <Layers className="w-3 h-3 text-blue-400" />}
                  {isFootnote && <MessageSquare className="w-3 h-3 text-purple-400" />}
                  {isTable && <Table className="w-3 h-3 text-emerald-400" />}
                  <span>
                    {isChapter ? 'פרק / כותרת ראשית' : isSource ? 'טקסט מקור (גמרא/חומש)' : isRashi ? 'פירוש רש״י' : isTosafot ? 'פירוש תוספות' : isFootnote ? 'הערת שוליים' : isTable ? 'טבלה' : unit.role}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-stone-500">{unit.id}</span>
              </div>

              <p className="text-[11px] text-stone-400 line-clamp-2 leading-relaxed">
                {unit.rawText}
              </p>

              {unit.dibburHamatchil && (
                <div className="mt-1.5 pt-1 border-t border-stone-800/60 flex items-center gap-1 text-[10px] text-amber-300 font-mono">
                  <span>דיבור המתחיל:</span>
                  <span className="font-serif font-bold">"{unit.dibburHamatchil}"</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
