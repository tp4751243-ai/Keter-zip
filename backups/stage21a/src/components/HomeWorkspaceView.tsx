import React, { useState, useRef } from 'react';
import {
  Crown,
  FilePlus2,
  FolderOpen,
  FileUp,
  Save,
  Clock,
  BookOpen,
  Scroll,
  Columns,
  SplitSquareVertical,
  CheckCircle2,
  Trash2,
  ArrowLeft,
  ShieldCheck,
  Sparkles,
  FileText,
  KeyRound,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import {
  BookLayoutType,
  ContentRole,
  ContentUnit,
  ProjectSnapshot,
  RavTextLink,
} from '../types/typesetter';
import { RecentProjectItem } from '../engine/project-persistence';
import { DocxImporter } from '../engine/docx-importer';
import { StoredLicenseState } from '../engine/license-engine';

interface HomeWorkspaceViewProps {
  currentTitle: string;
  currentLayoutType: BookLayoutType;
  totalPages: number;
  totalUnits: number;
  isDirty: boolean;
  lastAutosaveTimestamp: number | null;
  recoveredFromAutosave: boolean;
  recentProjects: RecentProjectItem[];
  licenseState: StoredLicenseState;
  hasAutosaveToRecover?: boolean;
  onRecoverAutosave?: () => void;
  onContinueActiveProject: () => void;
  onCreateNewProject: (
    title: string,
    layoutType: BookLayoutType,
    mode: 'blank' | 'sample'
  ) => void;
  onOpenProjectFileDialog: () => void;
  onLoadProjectFileDirect: (file: File) => void;
  onLoadRecentProject: (snapshot: ProjectSnapshot) => void;
  onRemoveRecentProject: (projectId: string) => void;
  onSaveActiveProject: () => void;
  onImportDocxUnits: (
    units: ContentUnit[],
    title: string,
    links: RavTextLink[],
    layoutType: BookLayoutType
  ) => void;
  onOpenLicenseModal: () => void;
}

interface StagedDocxEntry {
  file: File;
  name: string;
  role: ContentRole;
  sizeKb: number;
}

const LAYOUT_TEMPLATE_CARDS: Array<{
  id: BookLayoutType;
  titleHe: string;
  subtitleHe: string;
  descHe: string;
  icon: any;
}> = [
  {
    id: 'rav_text',
    titleHe: 'ש״ס וילנא · רב-טקסט וברכיים דינמיות',
    subtitleHe: 'גמרא במרכז, רש״י בימין, תוספות בשמאל',
    descHe: 'עימוד רב-טקסט מסורתי עם חישוב ברכיים אוטומטי וקישורי דיבור המתחיל.',
    icon: Crown,
  },
  {
    id: 'mikraot_gedolot',
    titleHe: 'מקראות גדולות · חומש ומפרשים',
    subtitleHe: 'פסוקי תנ״ך בטעמים עם תרגום ורש״י/רמב״ן',
    descHe: 'תמיכה מלאה בניקוד וטעמי המקרא (GPOS mark/mkmk) עם מפרשים מסביב.',
    icon: Scroll,
  },
  {
    id: 'source_top_commentary_bottom',
    titleHe: 'מקור עליון + מפרשים תחתונים',
    subtitleHe: 'מתכונת משנה ברורה / רמב״ם / הלכה',
    descHe: 'טקסט מקור בחלק העליון ופירושים בשני טורים תחת קו מפריד דינמי.',
    icon: SplitSquareVertical,
  },
  {
    id: 'two_column',
    titleHe: 'שני טורים מאוזנים',
    subtitleHe: 'שולחן ערוך / משניות / סידור',
    descHe: 'איזון גובה אוטומטי בין שני טורים, כותרות סימנים והערות שוליים.',
    icon: Columns,
  },
  {
    id: 'single_column',
    titleHe: 'טקסט רץ · טור יחיד',
    subtitleHe: 'ספרי מוסר, מחשבה, דרוש ושו״ת',
    descHe: 'עימוד קלאסי נקי עם מניעת שורות יתומות/אלמנות והערות שוליים.',
    icon: BookOpen,
  },
];

export const HomeWorkspaceView: React.FC<HomeWorkspaceViewProps> = ({
  currentTitle,
  currentLayoutType,
  totalPages,
  totalUnits,
  isDirty,
  lastAutosaveTimestamp,
  recoveredFromAutosave,
  recentProjects,
  licenseState,
  hasAutosaveToRecover = false,
  onRecoverAutosave,
  onContinueActiveProject,
  onCreateNewProject,
  onOpenProjectFileDialog,
  onLoadProjectFileDirect,
  onLoadRecentProject,
  onRemoveRecentProject,
  onSaveActiveProject,
  onImportDocxUnits,
  onOpenLicenseModal,
}) => {
  // New Project inline wizard state
  const [newTitle, setNewTitle] = useState('ספר קודש חדש — מהדורת כתר');
  const [selectedLayout, setSelectedLayout] = useState<BookLayoutType>('rav_text');
  const [starterMode, setStarterMode] = useState<'sample' | 'blank'>('sample');

  // Unified DOCX Multi-File Import state inside Home mode
  const [stagedDocx, setStagedDocx] = useState<StagedDocxEntry[]>([]);
  const [docxLayout, setDocxLayout] = useState<BookLayoutType>('rav_text');
  const [autoDiscoverLinks, setAutoDiscoverLinks] = useState(true);
  const [isImportingDocx, setIsImportingDocx] = useState(false);
  const [docxError, setDocxError] = useState<string | null>(null);

  const docxInputRef = useRef<HTMLInputElement>(null);
  const keterDropInputRef = useRef<HTMLInputElement>(null);

  const handleAddDocxFiles = (files: FileList | File[]) => {
    setDocxError(null);
    const added: StagedDocxEntry[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.name.toLowerCase().endsWith('.docx')) continue;
      const role = DocxImporter.autoDetectRole(f.name, '');
      added.push({
        file: f,
        name: f.name,
        role,
        sizeKb: Math.max(1, Math.round(f.size / 1024)),
      });
    }
    if (added.length === 0) {
      setDocxError('נא לבחור קובצי Word בפורמט .docx בלבד.');
      return;
    }
    setStagedDocx(prev => [...prev, ...added]);
  };

  const handleRunDocxImport = async () => {
    if (stagedDocx.length === 0) return;
    try {
      setIsImportingDocx(true);
      setDocxError(null);
      const allUnits: ContentUnit[] = [];
      let totalOrder = 0;
      let primaryTitle = stagedDocx[0]?.name.replace(/\.docx$/i, '') || 'ספר קודש מיובא';

      for (let i = 0; i < stagedDocx.length; i++) {
        const entry = stagedDocx[i];
        const buffer = await entry.file.arrayBuffer();
        const res = await DocxImporter.importDocx(buffer, entry.name);
        if (i === 0 && res.metadata.title) {
          primaryTitle = res.metadata.title;
        }
        for (const u of res.units) {
          totalOrder++;
          u.order = totalOrder;
          if (entry.role !== 'main_source' && u.role === 'main_source') {
            u.role = entry.role;
            if (!u.textRuns || !u.textRuns.some(r => r.isBold || r.isDibbur)) {
              u.textRuns = DocxImporter.buildRunsFromRawText(
                u.rawText,
                u.role,
                u.dibburHamatchil
              );
            }
          }
          allUnits.push(u);
        }
      }

      let discoveredLinks: RavTextLink[] = [];
      if (autoDiscoverLinks && stagedDocx.length > 1) {
        const sources = allUnits.filter(
          u => u.role === 'main_source' || u.role === 'chapter'
        );
        const commentaries = allUnits.filter(
          u => u.role === 'primary_comment' || u.role === 'secondary_comment'
        );
        discoveredLinks = DocxImporter.autoLinkCommentariesToSource(
          sources,
          commentaries
        );
      }

      setStagedDocx([]);
      onImportDocxUnits(allUnits, primaryTitle, discoveredLinks, docxLayout);
    } catch (err: any) {
      setDocxError('שגיאה בייבוא קובצי DOCX: ' + (err.message || 'קובץ לא תקין'));
    } finally {
      setIsImportingDocx(false);
    }
  };

  const formatLayoutLabel = (layout: BookLayoutType) => {
    const found = LAYOUT_TEMPLATE_CARDS.find(c => c.id === layout);
    return found ? found.titleHe.split('·')[0].trim() : layout;
  };

  return (
    <div
      dir="rtl"
      className="flex-1 overflow-y-auto bg-[var(--ui-workspace-bg)] text-[var(--ui-text-primary)] p-6 md:p-8 select-none"
    >
      <div className="max-w-6xl mx-auto space-y-6">
        {/* TOP BANNER: Active Project Status & Immediate Resume / Save */}
        <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[var(--ui-selected-bg)] border border-[var(--ui-accent)]/25 flex items-center justify-center shrink-0">
              <Crown className="w-5 h-5 text-[var(--ui-accent)]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-[var(--ui-selected-bg)] text-[var(--ui-accent)]">
                  פרויקט פתוח כעת בסביבת העבודה
                </span>
                {isDirty ? (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--ui-warning-bg)] text-[var(--ui-warning)] font-medium">
                    שינויים טרם נשמרו לקובץ .keter
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-[var(--ui-success-bg)] text-[var(--ui-success)] font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>נשמר</span>
                  </span>
                )}
                {recoveredFromAutosave && (
                  <span className="text-[11px] text-[var(--ui-text-secondary)]">
                    · שוחזר משמירה אוטומטית{' '}
                    {lastAutosaveTimestamp
                      ? `(${new Date(lastAutosaveTimestamp).toLocaleTimeString('he-IL')})`
                      : ''}
                  </span>
                )}
              </div>
              <h1 className="text-lg font-bold text-[var(--ui-text-primary)] mt-1">
                {currentTitle}
              </h1>
              <p className="text-xs text-[var(--ui-text-secondary)] mt-0.5">
                תבנית: {formatLayoutLabel(currentLayoutType)} · {totalPages} עמודים מעומדים ·{' '}
                {totalUnits} יחידות תוכן
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {onRecoverAutosave && (
              <button
                type="button"
                onClick={onRecoverAutosave}
                className="px-3 py-2 rounded-lg bg-[var(--ui-selected-bg)] hover:bg-[var(--ui-accent)] hover:text-white border border-[var(--ui-accent)]/30 text-xs font-semibold text-[var(--ui-accent)] flex items-center gap-1.5 transition-colors"
                title="שחזר את מצב העבודה האחרון שנשמר אוטומטית ברקע"
              >
                <RotateCcw className="w-4 h-4" />
                <span>שחזר שמירה אוטומטית</span>
              </button>
            )}
            <button
              onClick={onSaveActiveProject}
              className="px-3.5 py-2 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-xs font-semibold text-[var(--ui-text-primary)] flex items-center gap-1.5 transition-colors"
            >
              <Save className="w-4 h-4 text-[var(--ui-accent)]" />
              <span>שמור קובץ פרויקט (.keter)</span>
            </button>
            <button
              onClick={onContinueActiveProject}
              className="px-4 py-2 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <span>המשך לפרויקט האחרון</span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* MAIN 2-COLUMN GRID: Left = Open .keter / Recent Projects / DOCX Import; Right = Create New Project */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* COLUMN 1 (7 cols): Create New Project with Holy-Book Layout Templates */}
          <div className="lg:col-span-7 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-6 shadow-xs flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-3">
                <div className="flex items-center gap-2.5">
                  <FilePlus2 className="w-5 h-5 text-[var(--ui-accent)]" />
                  <div>
                    <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                      יצירת פרויקט ספר קודש חדש
                    </h2>
                    <p className="text-[11px] text-[var(--ui-text-secondary)]">
                      בחר שם ספר ומתכונת עימוד (רב-טקסט, מקראות גדולות, שני טורים או טקסט רץ)
                    </p>
                  </div>
                </div>
              </div>

              {/* Book Title Field */}
              <div>
                <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-1.5">
                  שם הספר / כותרת המסכת:
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="לדוגמה: מסכת ברכות — מהדורת כתר"
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3.5 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                />
              </div>

              {/* Layout Template Cards */}
              <div>
                <label className="block text-xs font-semibold text-[var(--ui-text-primary)] mb-2">
                  בחר מתכונת עימוד:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {LAYOUT_TEMPLATE_CARDS.map(card => {
                    const Icon = card.icon;
                    const isSelected = selectedLayout === card.id;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => setSelectedLayout(card.id)}
                        className={`p-3 rounded-lg border text-right transition-all flex items-start gap-2.5 ${
                          isSelected
                            ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] ring-1 ring-[var(--ui-accent)]/25'
                            : 'bg-[var(--ui-surface-subtle)]/60 border-[var(--ui-border)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            isSelected
                              ? 'text-[var(--ui-accent)]'
                              : 'text-[var(--ui-text-secondary)]'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[var(--ui-text-primary)]">
                            {card.titleHe}
                          </div>
                          <div className="text-[11px] font-medium text-[var(--ui-accent)] mt-0.5">
                            {card.subtitleHe}
                          </div>
                          <div className="text-[10px] text-[var(--ui-text-secondary)] mt-1 leading-relaxed">
                            {card.descHe}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Starter Content Mode */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setStarterMode('sample')}
                  className={`p-2.5 rounded-lg border text-right text-xs flex items-center gap-2 transition-all ${
                    starterMode === 'sample'
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-semibold'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <div>
                    <div>כולל טקסט לדוגמה</div>
                    <div className="text-[10px] opacity-80 font-normal">
                      טקסט מנוקד ומעומד להתרשמות מיידית
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setStarterMode('blank')}
                  className={`p-2.5 rounded-lg border text-right text-xs flex items-center gap-2 transition-all ${
                    starterMode === 'blank'
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-semibold'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <div>
                    <div>פרויקט נקי להזנת תוכן</div>
                    <div className="text-[10px] opacity-80 font-normal">
                      תבנית מוכנה לכתיבה או הדבקת טקסט
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--ui-border)] flex items-center justify-end">
              <button
                type="button"
                onClick={() =>
                  onCreateNewProject(
                    newTitle.trim() || 'ספר קודש חדש',
                    selectedLayout,
                    starterMode
                  )
                }
                className="px-5 py-2.5 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors"
              >
                <FilePlus2 className="w-4 h-4" />
                <span>צור פרויקט חדש ועבור לעריכה</span>
              </button>
            </div>
          </div>

          {/* COLUMN 2 (5 cols): Open .keter Project + Import DOCX + Recent Projects */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            {/* 0. Dedicated Autosave Recovery Option */}
            {onRecoverAutosave && (
              <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-4 shadow-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-[var(--ui-selected-bg)] flex items-center justify-center shrink-0">
                    <RotateCcw className="w-4 h-4 text-[var(--ui-accent)]" />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-[var(--ui-text-primary)]">
                      שחזור שמירה אוטומטית
                    </h2>
                    <p className="text-[10px] text-[var(--ui-text-secondary)]">
                      {lastAutosaveTimestamp
                        ? `שמירה ברקע זוהתה: ${new Date(lastAutosaveTimestamp).toLocaleTimeString('he-IL')}`
                        : 'שחזר את השינויים האחרונים שנשמרו ברקע'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onRecoverAutosave}
                  className="px-3.5 py-1.5 rounded-lg bg-[var(--ui-selected-bg)] hover:bg-[var(--ui-accent)] hover:text-white border border-[var(--ui-accent)]/30 text-xs font-semibold text-[var(--ui-accent)] flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>שחזר כעת ועבור לעריכה</span>
                </button>
              </div>
            )}

            {/* 1. Native .keter Project Open & Save Card */}
            <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-5 shadow-xs space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-[var(--ui-accent)]" />
                  <div>
                    <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                      פתיחת פרויקט שמור (.keter)
                    </h2>
                    <p className="text-[11px] text-[var(--ui-text-secondary)]">
                      קובץ פרויקט מקורי הניתן לעריכה חוזרת בכל עת (שונה מייצוא PDF/IDML)
                    </p>
                  </div>
                </div>
              </div>

              <input
                ref={keterDropInputRef}
                type="file"
                accept=".keter,.keter.json,.json"
                onChange={e => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) onLoadProjectFileDirect(f);
                }}
                className="hidden"
              />

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onOpenProjectFileDialog}
                  className="flex-1 py-2.5 px-4 rounded-lg bg-[var(--ui-selected-bg)] hover:bg-[var(--ui-accent)] hover:text-white border border-[var(--ui-accent)]/30 text-[var(--ui-accent)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>בחר קובץ פרויקט (.keter / .keter.json) מהמחשב...</span>
                </button>
              </div>

              {/* Recent Projects List */}
              <div className="pt-2 border-t border-[var(--ui-border)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-[var(--ui-text-secondary)] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[var(--ui-text-muted)]" />
                    <span>פרויקטים אחרונים במחשב זה ({recentProjects.length})</span>
                  </span>
                </div>

                {recentProjects.length === 0 ? (
                  <div className="text-[11px] text-[var(--ui-text-muted)] bg-[var(--ui-surface-subtle)] rounded-lg p-3 text-center">
                    טרם נשמרו פרויקטים ברשימה האחרונה. שמירת פרויקט (.keter) תוסיף אותו לכאן.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
                    {recentProjects.map(item => (
                      <div
                        key={item.projectId}
                        className="p-2.5 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] flex items-center justify-between gap-2 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => onLoadRecentProject(item.snapshot)}
                          className="flex-1 text-right min-w-0"
                        >
                          <div className="text-xs font-semibold text-[var(--ui-text-primary)] truncate">
                            {item.documentTitle}
                          </div>
                          <div className="text-[10px] text-[var(--ui-text-secondary)] flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-[var(--ui-accent)]">
                              {item.fileName}
                            </span>
                            <span>·</span>
                            <span>{formatLayoutLabel(item.layoutType)}</span>
                            <span>·</span>
                            <span>
                              {new Date(item.updatedAt).toLocaleDateString('he-IL')}
                            </span>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveRecentProject(item.projectId)}
                          className="p-1 rounded hover:bg-[var(--ui-surface)] text-[var(--ui-text-muted)] hover:text-[var(--ui-danger)]"
                          title="הסר מהרשימה"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Integrated Multi-DOCX Import Card (Gemara + Rashi + Tosafot + Footnotes) */}
            <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl p-5 shadow-xs space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileUp className="w-5 h-5 text-[var(--ui-accent)]" />
                  <div>
                    <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">
                      ייבוא מסמכי Word (DOCX) וקישור אוטומטי
                    </h2>
                    <p className="text-[11px] text-[var(--ui-text-secondary)]">
                      ייבוא קובץ בודד או מספר קבצים (גמרא, רש״י, תוספות והערות שוליים)
                    </p>
                  </div>
                </div>
              </div>

              {docxError && (
                <div className="p-2.5 rounded-lg bg-[var(--ui-danger-bg)] border border-[var(--ui-danger)]/30 text-[var(--ui-danger)] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{docxError}</span>
                </div>
              )}

              <input
                ref={docxInputRef}
                type="file"
                multiple
                accept=".docx"
                onChange={e => {
                  if (e.target.files) handleAddDocxFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => docxInputRef.current?.click()}
                className="w-full py-3 px-4 rounded-lg border-2 border-dashed border-[var(--ui-border-strong)] hover:border-[var(--ui-accent)] bg-[var(--ui-surface-subtle)]/60 hover:bg-[var(--ui-surface-hover)] text-xs font-medium text-[var(--ui-text-primary)] flex flex-col items-center justify-center gap-1 transition-all"
              >
                <FileUp className="w-5 h-5 text-[var(--ui-accent)]" />
                <span>בחר קובץ DOCX אחד או יותר מהמחשב</span>
                <span className="text-[10px] text-[var(--ui-text-secondary)]">
                  משמר ניקוד, טעמים, הדגשות דיבור המתחיל והערות שוליים
                </span>
              </button>

              {stagedDocx.length > 0 && (
                <div className="space-y-2.5 pt-1">
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {stagedDocx.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-medium truncate max-w-[140px]">
                          {item.name}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <select
                            value={item.role}
                            onChange={e => {
                              const nextRole = e.target.value as ContentRole;
                              setStagedDocx(prev =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, role: nextRole } : it
                                )
                              );
                            }}
                            className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded px-2 py-0.5 text-[11px] text-[var(--ui-text-primary)]"
                          >
                            <option value="main_source">מקור ראשי (גמרא/פנים)</option>
                            <option value="primary_comment">פירוש א׳ (רש״י)</option>
                            <option value="secondary_comment">פירוש ב׳ (תוספות)</option>
                            <option value="footnote">הערות שוליים</option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setStagedDocx(prev => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1 text-[var(--ui-text-muted)] hover:text-[var(--ui-danger)]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-[var(--ui-text-secondary)]">תבנית יעד:</span>
                    <select
                      value={docxLayout}
                      onChange={e => setDocxLayout(e.target.value as BookLayoutType)}
                      className="bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded px-2 py-1 text-xs text-[var(--ui-text-primary)]"
                    >
                      <option value="rav_text">ש״ס וילנא · רב-טקסט</option>
                      <option value="mikraot_gedolot">מקראות גדולות</option>
                      <option value="source_top_commentary_bottom">מקור עליון + מפרשים</option>
                      <option value="two_column">שני טורים</option>
                      <option value="single_column">טקסט רץ (טור יחיד)</option>
                    </select>
                  </div>

                  {stagedDocx.length > 1 && (
                    <label className="flex items-center gap-2 text-[11px] text-[var(--ui-text-secondary)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoDiscoverLinks}
                        onChange={e => setAutoDiscoverLinks(e.target.checked)}
                      />
                      <span>קשר אוטומטית דיבורי המתחיל בין המפרשים למקור</span>
                    </label>
                  )}

                  <button
                    type="button"
                    disabled={isImportingDocx}
                    onClick={handleRunDocxImport}
                    className="w-full py-2 px-4 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white text-xs font-semibold transition-colors"
                  >
                    {isImportingDocx
                      ? 'מייבא ומעמד קבצים...'
                      : `ייבא ${stagedDocx.length} קובצי DOCX ועבור לעריכה`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* BOTTOM STRIP: License Status & Architecture Readiness */}
        <div className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-xl px-5 py-3.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-[var(--ui-text-secondary)]">
              <ShieldCheck className="w-4 h-4 text-[var(--ui-success)]" />
              <span>עבודה לא-מקוונת (Offline) זמינה במלואה לעימוד, שמירה וייצוא</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenLicenseModal}
            className="flex items-center gap-1.5 text-[var(--ui-accent)] hover:underline font-medium"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>
              מצב רישיון:{' '}
              {licenseState.status === 'activated'
                ? 'מופעל במחשב זה'
                : 'לא מופעל — לחץ לניהול רישיון'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
