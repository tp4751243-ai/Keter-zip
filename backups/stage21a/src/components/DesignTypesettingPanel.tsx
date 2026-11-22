import React, { useState, useEffect } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlertTriangle,
  Bold,
  BookOpen,
  Check,
  Columns,
  Italic,
  RotateCcw,
  Sliders,
  Sparkles,
  Type,
  Underline,
  Layers,
  FileText,
  X,
  Edit3,
  Globe,
  FolderKanban,
  MousePointerClick,
} from 'lucide-react';
import {
  BookLayoutType,
  ContentRole,
  ContentUnit,
  DynamicKneeContour,
  KneeCustomSettings,
  LocalFontEntry,
} from '../types/typesetter';
import {
  CharacterStyleSettings,
  DesignAlignment,
  DesignLastLineAlignment,
  DesignScopeLevel,
  ParagraphStyleSettings,
  ProfessionalDesignSettings,
  SEMANTIC_ROLE_LABELS_HE,
  SemanticStyleRole,
} from '../types/design-settings';
import { DesignSettingsEngine } from '../engine/design-settings-engine';

export type InspectorMainTab =
  | 'typography'
  | 'paragraph'
  | 'page_geometry'
  | 'rav_text'
  | 'footnotes';

interface DesignTypesettingPanelProps {
  designSettings: ProfessionalDesignSettings;
  onUpdateDesignSettings: (
    next: ProfessionalDesignSettings,
    summaryHe?: string
  ) => void;
  availableFonts: LocalFontEntry[];
  selectedUnit: ContentUnit | null;
  selectedWordInfo?: {
    unitId: string;
    wordIndex: number;
    wordText: string;
    role: ContentRole;
  } | null;
  onClearSelectedWord?: () => void;
  currentPageIndex: number;
  totalPages: number;
  activeMainTab?: InspectorMainTab;
  onMainTabChange?: (tab: InspectorMainTab) => void;
  knee?: DynamicKneeContour;
  kneeSettings?: KneeCustomSettings;
  onUpdateKneeSettings?: (nextKnee: KneeCustomSettings) => void;
  onClose?: () => void;
  onStartEditUnit?: (unitId: string) => void;
}

const ROLE_OPTIONS: Array<{ role: SemanticStyleRole; labelHe: string }> = [
  { role: 'main_source', labelHe: 'מקור ראשי (גמרא / משנה / פנים)' },
  { role: 'primary_comment', labelHe: 'פירוש ראשי (רש״י / משנה ברורה)' },
  { role: 'secondary_comment', labelHe: 'פירוש משני (תוספות / ש״ך)' },
  { role: 'tertiary_comment', labelHe: 'פירוש שלישי (עין משפט / מסורת הש״ס)' },
  { role: 'dibbur_hamatchil', labelHe: 'דיבור המתחיל (ד״ה)' },
  { role: 'verse', labelHe: 'פסוק (מקראות גדולות / תנ״ך)' },
  { role: 'main_title', labelHe: 'כותרת ראשית / שער' },
  { role: 'subtitle', labelHe: 'כותרת משנה' },
  { role: 'chapter', labelHe: 'פרק / כותרת פרק' },
  { role: 'siman', labelHe: 'סימן (שולחן ערוך / הלכה)' },
  { role: 'heading', labelHe: 'כותרת' },
  { role: 'subheading', labelHe: 'כותרת משנית' },
  { role: 'regular_paragraph', labelHe: 'גוף טקסט / פסקה רגילה' },
  { role: 'halakha', labelHe: 'הלכה פסוקה' },
  { role: 'quote', labelHe: 'ציטוט / מובאה' },
  { role: 'introduction', labelHe: 'הקדמה / מבוא' },
  { role: 'footnote', labelHe: 'הערות שוליים' },
  { role: 'side_note', labelHe: 'הערת צד / גליון' },
  { role: 'header_running', labelHe: 'כותרת רצה בראש עמוד' },
  { role: 'folio_number', labelHe: 'מספר דף / עמוד' },
  { role: 'continuation', labelHe: 'שורת המשך מעמוד לעמוד' },
];

export const DesignTypesettingPanel: React.FC<DesignTypesettingPanelProps> = ({
  designSettings,
  onUpdateDesignSettings,
  availableFonts,
  selectedUnit,
  selectedWordInfo,
  onClearSelectedWord,
  activeMainTab = 'typography',
  onMainTabChange,
  knee,
  kneeSettings,
  onUpdateKneeSettings,
  onClose,
  onStartEditUnit,
}) => {
  const [internalTab, setInternalTab] = useState<InspectorMainTab>(activeMainTab);
  const currentTab = onMainTabChange ? activeMainTab : internalTab;
  const setTab = (t: InspectorMainTab) => {
    setInternalTab(t);
    if (onMainTabChange) onMainTabChange(t);
  };

  const [scopeLevel, setScopeLevel] = useState<DesignScopeLevel>('role');
  const [activeRole, setActiveRole] = useState<SemanticStyleRole>('main_source');
  const [clampNotices, setClampNotices] = useState<string[]>([]);

  // Synchronize target role when user clicks a unit or word on the canvas
  useEffect(() => {
    if (selectedWordInfo) {
      setActiveRole(selectedWordInfo.role as SemanticStyleRole);
      setScopeLevel('local_word');
    } else if (selectedUnit) {
      setActiveRole(selectedUnit.role as SemanticStyleRole);
    }
  }, [selectedUnit, selectedWordInfo]);

  const resolvedEffective = DesignSettingsEngine.resolveRoleAndUnitStyle(
    designSettings,
    activeRole,
    scopeLevel === 'local_unit' || scopeLevel === 'local_word'
      ? selectedUnit?.id
      : undefined,
    scopeLevel === 'local_word' ? selectedWordInfo?.wordIndex : undefined
  );

  const charStyle = resolvedEffective.character;
  const paraStyle = resolvedEffective.paragraph;
  const fontStatus = DesignSettingsEngine.resolveFontAvailability(
    charStyle.fontFamily,
    activeRole
  );

  const hasUnitLocalOverride = Boolean(
    selectedUnit && designSettings.localUnitOverrides[selectedUnit.id]
  );

  const hasProjectRoleOverride = Boolean(
    designSettings.projectRoleStyles?.[activeRole]?.character ||
      designSettings.projectRoleStyles?.[activeRole]?.paragraph
  );

  const applyWithHardRuleGuard = (
    candidate: ProfessionalDesignSettings,
    summaryHe: string
  ) => {
    const safety = DesignSettingsEngine.sanitizeAndEnforceHardRules(candidate);
    if (safety.warnings.length > 0) {
      setClampNotices(safety.warnings);
    } else {
      setClampNotices([]);
    }
    onUpdateDesignSettings(safety.settings, summaryHe);
  };

  const handleUpdateChar = (
    patch: Partial<CharacterStyleSettings>,
    labelHe: string
  ) => {
    if (scopeLevel === 'local_word' && selectedWordInfo) {
      const next = DesignSettingsEngine.setLocalWordOverride(
        designSettings,
        selectedWordInfo.unitId,
        selectedWordInfo.wordIndex,
        patch,
        'user'
      );
      applyWithHardRuleGuard(
        next,
        `עיצוב מילה ("${selectedWordInfo.wordText}"): ${labelHe}`
      );
    } else if (scopeLevel === 'local_unit' && selectedUnit) {
      const next = DesignSettingsEngine.setLocalUnitOverride(
        designSettings,
        selectedUnit.id,
        { character: patch },
        'user'
      );
      applyWithHardRuleGuard(
        next,
        `דריסת יחידה מקומית (${selectedUnit.id}): ${labelHe}`
      );
    } else {
      const next = DesignSettingsEngine.updateRoleCharacterStyle(
        designSettings,
        activeRole,
        patch,
        'user'
      );
      applyWithHardRuleGuard(
        next,
        `עדכון תו (${SEMANTIC_ROLE_LABELS_HE[activeRole] || activeRole}): ${labelHe}`
      );
    }
  };

  const handleUpdatePara = (
    patch: Partial<ParagraphStyleSettings>,
    labelHe: string
  ) => {
    if (
      (scopeLevel === 'local_unit' || scopeLevel === 'local_word') &&
      selectedUnit
    ) {
      const next = DesignSettingsEngine.setLocalUnitOverride(
        designSettings,
        selectedUnit.id,
        { paragraph: patch },
        'user'
      );
      applyWithHardRuleGuard(
        next,
        `דריסת פסקה מקומית (${selectedUnit.id}): ${labelHe}`
      );
    } else {
      const next = DesignSettingsEngine.updateRoleParagraphStyle(
        designSettings,
        activeRole,
        patch,
        'user'
      );
      applyWithHardRuleGuard(
        next,
        `עדכון פסקה (${SEMANTIC_ROLE_LABELS_HE[activeRole] || activeRole}): ${labelHe}`
      );
    }
  };

  const handleResetCurrentScope = () => {
    if (
      (scopeLevel === 'local_unit' || scopeLevel === 'local_word') &&
      selectedUnit
    ) {
      const next = DesignSettingsEngine.clearLocalUnitOverride(
        designSettings,
        selectedUnit.id,
        'user'
      );
      applyWithHardRuleGuard(
        next,
        `איפוס דריסה מקומית ביחידה ${selectedUnit.id} לסגנון האב`
      );
    } else {
      const next = DesignSettingsEngine.resetRoleToDefault(
        designSettings,
        activeRole,
        'user'
      );
      applyWithHardRuleGuard(
        next,
        `איפוס סגנון ${SEMANTIC_ROLE_LABELS_HE[activeRole] || activeRole} לברירת מחדל גלובלית`
      );
    }
  };

  const MAIN_TABS: Array<{ id: InspectorMainTab; label: string; icon: any }> = [
    { id: 'typography', label: 'טיפוגרפיה', icon: Type },
    { id: 'paragraph', label: 'פסקה ויישור', icon: AlignJustify },
    { id: 'page_geometry', label: 'עמוד ושוליים', icon: Columns },
    { id: 'rav_text', label: 'רב-טקסט וברכיים', icon: Layers },
    { id: 'footnotes', label: 'הערות שוליים', icon: FileText },
  ];

  // Determine the active tier badge (GLOBAL / PROJECT / LOCAL)
  const activeTierLabel =
    scopeLevel === 'local_word' && selectedWordInfo
      ? {
          tier: 'דריסת מילה מקומית (Local Word)',
          desc: `שינויים חלים רק על המילה "${selectedWordInfo.wordText}"`,
          icon: MousePointerClick,
        }
      : scopeLevel === 'local_unit' && selectedUnit
      ? {
          tier: 'דריסת פסקה מקומית (Local Override)',
          desc: `שינויים חלים רק על היחידה הנבחרת (${selectedUnit.id})`,
          icon: MousePointerClick,
        }
      : hasProjectRoleOverride
      ? {
          tier: 'סגנון פרויקט מותאם (Project Style)',
          desc: `חל על כל יחידות "${SEMANTIC_ROLE_LABELS_HE[activeRole] || activeRole}" בספר`,
          icon: FolderKanban,
        }
      : {
          tier: 'סגנון גלובלי תקני (Global Default)',
          desc: `חל על כל יחידות "${SEMANTIC_ROLE_LABELS_HE[activeRole] || activeRole}" בספר`,
          icon: Globe,
        };

  return (
    <aside
      dir="rtl"
      aria-label="מגירת מאפייני טיפוגרפיה ועימוד"
      className="h-full w-full bg-[var(--ui-surface)] border-r border-[var(--ui-border)] flex flex-col select-none shrink-0 z-20 overflow-hidden transition-colors duration-150"
    >
      {/* 1. Drawer Header */}
      <div className="h-11 px-4 border-b border-[var(--ui-border)] flex items-center justify-between bg-[var(--ui-surface)] shrink-0">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[var(--ui-accent)]" />
          <span className="text-xs font-semibold text-[var(--ui-text-primary)]">
            מאפייני טיפוגרפיה ועימוד
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--ui-surface-subtle)] text-[var(--ui-text-secondary)] border border-[var(--ui-border)] font-mono">
            גרסה #{designSettings.revision}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
              title="סגור מגירת מאפיינים"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Clear 3-Tier Style Hierarchy Selector (Global / Project Role vs Local Unit vs Local Word) */}
      <div className="p-3 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <activeTierLabel.icon className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
            <span className="text-[11px] font-bold text-[var(--ui-text-primary)]">
              {activeTierLabel.tier}
            </span>
          </div>
          <button
            onClick={handleResetCurrentScope}
            className="text-[10px] text-[var(--ui-text-secondary)] hover:text-[var(--ui-accent)] flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] transition-colors"
            title="אפס סגנון נוכחי לסגנון האב בהיררכיה"
          >
            <RotateCcw className="w-3 h-3" />
            <span>אפס לסגנון אב</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 bg-[var(--ui-surface)] p-0.5 rounded-lg border border-[var(--ui-border)]">
          <button
            onClick={() => setScopeLevel('role')}
            className={`py-1 px-1.5 rounded-md text-[10px] font-medium transition-all ${
              scopeLevel === 'role' ||
              scopeLevel === 'document' ||
              scopeLevel === 'global'
                ? 'bg-[var(--ui-accent)] text-white shadow-2xs font-semibold'
                : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
            }`}
          >
            סגנון תפקיד (בספר)
          </button>
          <button
            onClick={() => {
              if (selectedUnit) setScopeLevel('local_unit');
            }}
            disabled={!selectedUnit}
            className={`py-1 px-1.5 rounded-md text-[10px] font-medium transition-all ${
              scopeLevel === 'local_unit'
                ? 'bg-[var(--ui-accent)] text-white shadow-2xs font-semibold'
                : selectedUnit
                ? 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                : 'text-[var(--ui-text-muted)] opacity-50 cursor-not-allowed'
            }`}
          >
            {selectedUnit ? 'פסקה נבחרת' : 'בחר פסקה בדף'}
          </button>
          <button
            onClick={() => {
              if (selectedWordInfo) setScopeLevel('local_word');
            }}
            disabled={!selectedWordInfo}
            className={`py-1 px-1.5 rounded-md text-[10px] font-medium transition-all ${
              scopeLevel === 'local_word'
                ? 'bg-[var(--ui-accent)] text-white shadow-2xs font-semibold'
                : selectedWordInfo
                ? 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                : 'text-[var(--ui-text-muted)] opacity-50 cursor-not-allowed'
            }`}
          >
            {selectedWordInfo
              ? `מילה: "${selectedWordInfo.wordText.slice(0, 7)}"`
              : 'בחר מילה בדף'}
          </button>
        </div>

        {/* Target Role Selector + Quick In-Place Text Edit Button when Unit Selected */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--ui-text-secondary)] shrink-0">
            רכיב:
          </span>
          <select
            value={activeRole}
            onChange={e => setActiveRole(e.target.value as SemanticStyleRole)}
            className="flex-1 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2.5 py-1 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
          >
            {ROLE_OPTIONS.map(opt => (
              <option key={opt.role} value={opt.role}>
                {opt.labelHe}
              </option>
            ))}
          </select>
        </div>

        {selectedUnit && onStartEditUnit && selectedUnit.role !== 'continuation' && (
          <div className="flex items-center justify-between pt-1 border-t border-[var(--ui-border)]/70">
            <span className="text-[10px] text-[var(--ui-text-secondary)] truncate max-w-[170px]">
              נבחרה: {selectedUnit.rawText.slice(0, 28)}...
            </span>
            <button
              onClick={() => onStartEditUnit(selectedUnit.id)}
              className="px-2.5 py-1 rounded bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white text-[10px] font-semibold flex items-center gap-1 transition-colors"
            >
              <Edit3 className="w-3 h-3" />
              <span>ערוך טקסט במקום</span>
            </button>
          </div>
        )}

        {hasUnitLocalOverride && selectedUnit && (
          <div className="text-[10px] px-2 py-1 rounded bg-[var(--ui-selected-bg)] border border-[var(--ui-accent)]/30 text-[var(--ui-accent)] flex items-center justify-between">
            <span>פעילה דריסה מקומית על יחידה זו</span>
            <button
              onClick={() => {
                const next = DesignSettingsEngine.clearLocalUnitOverride(
                  designSettings,
                  selectedUnit.id,
                  'user'
                );
                applyWithHardRuleGuard(next, 'ניקוי דריסה מקומית');
              }}
              className="underline font-semibold"
            >
              נקה דריסה
            </button>
          </div>
        )}
      </div>

      {/* 3. Domain Sub-Tabs */}
      <div className="grid grid-cols-5 border-b border-[var(--ui-border)] bg-[var(--ui-surface)] shrink-0">
        {MAIN_TABS.map(tab => {
          const Icon = tab.icon;
          const active = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`py-2 px-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium border-b-2 transition-colors ${
                active
                  ? 'border-[var(--ui-accent)] text-[var(--ui-accent)] bg-[var(--ui-selected-bg)]/50 font-semibold'
                  : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="truncate max-w-full">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Engine Hard Rule Clamping Notice */}
      {clampNotices.length > 0 && (
        <div className="mx-3 mt-2.5 p-2.5 rounded-lg bg-[var(--ui-warning-bg)] border border-[var(--ui-warning)]/35 text-[var(--ui-warning)] text-[11px] flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {clampNotices.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {/* TAB 1: TYPOGRAPHY & CHARACTER */}
        {currentTab === 'typography' && (
          <div className="space-y-4">
            {/* Font Family */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)]">
                משפחת גופנים (Font Family):
              </label>
              <select
                value={charStyle.fontFamily}
                onChange={e =>
                  handleUpdateChar(
                    { fontFamily: e.target.value },
                    `גופן ${e.target.value}`
                  )
                }
                className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
              >
                {availableFonts.map(f => (
                  <option key={f.family} value={f.family}>
                    {f.displayNameHe || f.family} ({f.family})
                  </option>
                ))}
              </select>
              {!fontStatus.isAvailable && fontStatus.warningHe && (
                <p className="text-[10px] text-[var(--ui-warning)] mt-1">
                  {fontStatus.warningHe}
                </p>
              )}
            </div>

            {/* Font Size & Weight */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  גודל גופן (pt):
                </label>
                <input
                  type="number"
                  min={6}
                  max={72}
                  step={0.5}
                  value={charStyle.fontSizePt}
                  onChange={e =>
                    handleUpdateChar(
                      { fontSizePt: Number(e.target.value) },
                      `גודל גופן ${e.target.value}pt`
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--ui-text-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  משקל גופן (Weight):
                </label>
                <select
                  value={charStyle.fontWeight}
                  onChange={e => {
                    const w = Number(e.target.value);
                    handleUpdateChar(
                      { fontWeight: w, isBold: w >= 600 },
                      `משקל גופן ${w}`
                    );
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-primary)]"
                >
                  <option value={400}>רגיל (400 Regular)</option>
                  <option value={500}>בינוני (500 Medium)</option>
                  <option value={600}>חצי-מודגש (600 SemiBold)</option>
                  <option value={700}>מודגש (700 Bold)</option>
                </select>
              </div>
            </div>

            {/* Style Toggles: Bold, Italic, Underline */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1.5">
                הדגשה וסגנון תו:
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() =>
                    handleUpdateChar(
                      {
                        isBold: !charStyle.isBold,
                        fontWeight: !charStyle.isBold ? 700 : 400,
                      },
                      !charStyle.isBold ? 'הדגשה (Bold)' : 'ביטול הדגשה'
                    )
                  }
                  className={`py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                    charStyle.isBold
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-bold'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  <Bold className="w-3.5 h-3.5" />
                  <span>מודגש</span>
                </button>

                <button
                  onClick={() =>
                    handleUpdateChar(
                      {
                        isItalic: !charStyle.isItalic,
                        fontStyle: !charStyle.isItalic ? 'italic' : 'normal',
                      },
                      !charStyle.isItalic ? 'נטוי (Italic)' : 'ביטול נטוי'
                    )
                  }
                  className={`py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                    charStyle.isItalic
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-bold'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  <Italic className="w-3.5 h-3.5" />
                  <span>נטוי</span>
                </button>

                <button
                  onClick={() =>
                    handleUpdateChar(
                      { isUnderline: !charStyle.isUnderline },
                      !charStyle.isUnderline ? 'קו תחתון' : 'ביטול קו תחתון'
                    )
                  }
                  className={`py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                    charStyle.isUnderline
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-bold'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  <Underline className="w-3.5 h-3.5" />
                  <span>קו תחתון</span>
                </button>
              </div>
            </div>

            {/* Tracking & Word Spacing */}
            <div className="space-y-3 pt-2 border-t border-[var(--ui-border)]">
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    ריווח בין אותיות (Tracking):
                  </span>
                  <span className="font-mono text-[var(--ui-text-secondary)]">
                    {charStyle.trackingEm.toFixed(2)} em
                  </span>
                </div>
                <input
                  type="range"
                  min={-0.04}
                  max={0.2}
                  step={0.01}
                  value={charStyle.trackingEm}
                  onChange={e =>
                    handleUpdateChar(
                      { trackingEm: Number(e.target.value) },
                      `ריווח אותיות ${e.target.value}em`
                    )
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    יחס רווח בין מילים (Word Spacing):
                  </span>
                  <span className="font-mono text-[var(--ui-text-secondary)]">
                    {Math.round(charStyle.wordSpacingRatio * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.75}
                  max={1.5}
                  step={0.05}
                  value={charStyle.wordSpacingRatio}
                  onChange={e =>
                    handleUpdateChar(
                      { wordSpacingRatio: Number(e.target.value) },
                      `רווח מילים ${Math.round(Number(e.target.value) * 100)}%`
                    )
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    קנה מידה אופקי (מוגן ע״י חוק מנוע 90%–110%):
                  </span>
                  <span className="font-mono text-[var(--ui-text-secondary)]">
                    {charStyle.horizontalScalePercent}%
                  </span>
                </div>
                <input
                  type="range"
                  min={90}
                  max={110}
                  step={1}
                  value={charStyle.horizontalScalePercent}
                  onChange={e =>
                    handleUpdateChar(
                      { horizontalScalePercent: Number(e.target.value) },
                      `רוחב אות ${e.target.value}%`
                    )
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>
            </div>

            {/* OpenType Hebrew Diacritics & Taamim Controls */}
            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                תכונות OpenType לניקוד וטעמי המקרא:
              </div>
              {(
                [
                  {
                    key: 'markPositioning',
                    label: 'מיקום ניקוד מדויק (GPOS mark)',
                  },
                  {
                    key: 'markToMark',
                    label: 'הערמת ניקוד וטעמים (GPOS mkmk)',
                  },
                  {
                    key: 'ligatures',
                    label: 'ליגטורות עבריות (אל״ף-למ״ד / liga)',
                  },
                  {
                    key: 'kerning',
                    label: 'צמצום אופטי בין אותיות (kern)',
                  },
                ] as const
              ).map(feat => (
                <label
                  key={feat.key}
                  className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer"
                >
                  <span className="text-[11px] text-[var(--ui-text-primary)]">
                    {feat.label}
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(charStyle.openTypeFeatures?.[feat.key])}
                    onChange={e =>
                      handleUpdateChar(
                        {
                          openTypeFeatures: {
                            ...charStyle.openTypeFeatures,
                            [feat.key]: e.target.checked,
                          },
                        },
                        feat.label
                      )
                    }
                    className="accent-[var(--ui-accent)]"
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: PARAGRAPH & ALIGNMENT */}
        {currentTab === 'paragraph' && (
          <div className="space-y-4">
            {/* Paragraph Alignment */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1.5">
                יישור פסקה (Paragraph Alignment):
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { id: 'justify', label: 'בלוק מלא', icon: AlignJustify },
                    { id: 'right', label: 'ימין', icon: AlignRight },
                    { id: 'center', label: 'מרכז', icon: AlignCenter },
                    { id: 'left', label: 'שמאל', icon: AlignLeft },
                  ] as Array<{ id: DesignAlignment; label: string; icon: any }>
                ).map(item => {
                  const Icon = item.icon;
                  const active = paraStyle.alignment === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() =>
                        handleUpdatePara(
                          {
                            alignment: item.id,
                            justifyNonFinalLines: item.id === 'justify',
                          },
                          `יישור ${item.label}`
                        )
                      }
                      className={`py-2 px-1.5 rounded-lg border flex flex-col items-center gap-1 text-[10px] font-medium transition-colors ${
                        active
                          ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-bold'
                          : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Last Line Alignment */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                יישור שורה אחרונה בפסקה:
              </label>
              <select
                value={paraStyle.lastLineAlignment}
                onChange={e =>
                  handleUpdatePara(
                    {
                      lastLineAlignment: e.target
                        .value as DesignLastLineAlignment,
                    },
                    `שורה אחרונה: ${e.target.value}`
                  )
                }
                className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-primary)]"
              >
                <option value="right">יישור לימין (מסורתי)</option>
                <option value="center">מרכוז שורה אחרונה (סיום פרק)</option>
                <option value="justify">יישור בלוק מלא</option>
              </select>
            </div>

            {/* Line Spacing Ratio & Space Before/After */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--ui-border)]">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  מרווח שורות (יחס):
                </label>
                <input
                  type="number"
                  min={1.05}
                  max={2.2}
                  step={0.04}
                  value={paraStyle.lineSpacingRatio}
                  onChange={e =>
                    handleUpdatePara(
                      { lineSpacingRatio: Number(e.target.value) },
                      `מרווח שורות ${e.target.value}`
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--ui-text-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  מרווח אחרי פסקה (pt):
                </label>
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  value={paraStyle.spaceAfterPt}
                  onChange={e =>
                    handleUpdatePara(
                      { spaceAfterPt: Number(e.target.value) },
                      `מרווח אחרי פסקה ${e.target.value}pt`
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--ui-text-primary)]"
                />
              </div>
            </div>

            {/* Indents */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-1">
                  הזחת שורה 1 (pt)
                </label>
                <input
                  type="number"
                  min={0}
                  max={48}
                  step={1}
                  value={paraStyle.firstLineIndentPt}
                  onChange={e =>
                    handleUpdatePara(
                      { firstLineIndentPt: Number(e.target.value) },
                      `הזחת שורה ראשונה ${e.target.value}pt`
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-1">
                  כניסה מימין (pt)
                </label>
                <input
                  type="number"
                  min={0}
                  max={48}
                  step={1}
                  value={paraStyle.rightIndentPt}
                  onChange={e =>
                    handleUpdatePara(
                      { rightIndentPt: Number(e.target.value) },
                      `כניסה מימין ${e.target.value}pt`
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-1">
                  כניסה משמאל (pt)
                </label>
                <input
                  type="number"
                  min={0}
                  max={48}
                  step={1}
                  value={paraStyle.leftIndentPt}
                  onChange={e =>
                    handleUpdatePara(
                      { leftIndentPt: Number(e.target.value) },
                      `כניסה משמאל ${e.target.value}pt`
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                />
              </div>
            </div>

            {/* Keep Options & Widow/Orphan Control */}
            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                בקרת שבירת עמודים, יתומים ואלמנות:
              </div>
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>מנע שורות יתומות ואלמנות (Widow/Orphan)</span>
                <input
                  type="checkbox"
                  checked={paraStyle.preventWidows && paraStyle.preventOrphans}
                  onChange={e =>
                    handleUpdatePara(
                      {
                        preventWidows: e.target.checked,
                        preventOrphans: e.target.checked,
                      },
                      'מניעת יתומים ואלמנות'
                    )
                  }
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>שמור עם הפסקה הבאה (Keep With Next)</span>
                <input
                  type="checkbox"
                  checked={paraStyle.keepWithNext}
                  onChange={e =>
                    handleUpdatePara(
                      { keepWithNext: e.target.checked },
                      'שמירה עם פסקה הבאה'
                    )
                  }
                  className="accent-[var(--ui-accent)]"
                />
              </label>
            </div>
          </div>
        )}

        {/* TAB 3: PAGE GEOMETRY & MARGINS */}
        {currentTab === 'page_geometry' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  רוחב עמוד (pt):
                </label>
                <input
                  type="number"
                  min={320}
                  max={900}
                  value={designSettings.pageLayout.pageWidthPt}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { pageWidthPt: Number(e.target.value) },
                      'user',
                      `רוחב עמוד ${e.target.value}pt`
                    );
                    applyWithHardRuleGuard(res.settings, `רוחב עמוד ${e.target.value}pt`);
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  גובה עמוד (pt):
                </label>
                <input
                  type="number"
                  min={420}
                  max={1200}
                  value={designSettings.pageLayout.pageHeightPt}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { pageHeightPt: Number(e.target.value) },
                      'user',
                      `גובה עמוד ${e.target.value}pt`
                    );
                    applyWithHardRuleGuard(res.settings, `גובה עמוד ${e.target.value}pt`);
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--ui-border)]">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  שוליים עליונים (pt):
                </label>
                <input
                  type="number"
                  min={20}
                  max={140}
                  value={designSettings.pageLayout.marginTopPt}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { marginTopPt: Number(e.target.value) },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, 'שוליים עליונים');
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  שוליים תחתונים (pt):
                </label>
                <input
                  type="number"
                  min={20}
                  max={140}
                  value={designSettings.pageLayout.marginBottomPt}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { marginBottomPt: Number(e.target.value) },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, 'שוליים תחתונים');
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  שוליים פנימיים (pt):
                </label>
                <input
                  type="number"
                  min={20}
                  max={120}
                  value={designSettings.pageLayout.marginInsidePt}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { marginInsidePt: Number(e.target.value) },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, 'שוליים פנימיים');
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  שוליים חיצוניים (pt):
                </label>
                <input
                  type="number"
                  min={20}
                  max={120}
                  value={designSettings.pageLayout.marginOutsidePt}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { marginOutsidePt: Number(e.target.value) },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, 'שוליים חיצוניים');
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>הצג כותרת רצה בראש העמוד</span>
                <input
                  type="checkbox"
                  checked={designSettings.pageElements.showRunningHeader}
                  onChange={e => {
                    const next = DesignSettingsEngine.updatePageElementsSettings(
                      designSettings,
                      { showRunningHeader: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, 'כותרת רצה');
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>הצג מספור דף עברי (דף ב׳ ע״א)</span>
                <input
                  type="checkbox"
                  checked={designSettings.pageElements.showFolioNumber}
                  onChange={e => {
                    const next = DesignSettingsEngine.updatePageElementsSettings(
                      designSettings,
                      { showFolioNumber: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, 'מספור דף עברי');
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>
            </div>
          </div>
        )}

        {/* TAB 4: RAV TEXT & DYNAMIC KNEES */}
        {currentTab === 'rav_text' && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--ui-text-primary)]">
                  מצב חישוב ברכיים דינמיות:
                </span>
                <div className="flex items-center gap-1 bg-[var(--ui-surface)] p-0.5 rounded border border-[var(--ui-border)]">
                  <button
                    onClick={() => {
                      if (onUpdateKneeSettings && kneeSettings) {
                        onUpdateKneeSettings({ ...kneeSettings, mode: 'auto' });
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      (kneeSettings?.mode ?? designSettings.ravText.kneeMode) ===
                      'auto'
                        ? 'bg-[var(--ui-accent)] text-white'
                        : 'text-[var(--ui-text-secondary)]'
                    }`}
                  >
                    אוטומטי (וילנא)
                  </button>
                  <button
                    onClick={() => {
                      if (onUpdateKneeSettings && kneeSettings) {
                        onUpdateKneeSettings({ ...kneeSettings, mode: 'manual' });
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      (kneeSettings?.mode ?? designSettings.ravText.kneeMode) ===
                      'manual'
                        ? 'bg-[var(--ui-accent)] text-white'
                        : 'text-[var(--ui-text-secondary)]'
                    }`}
                  >
                    ידני
                  </button>
                </div>
              </div>

              {knee && (
                <div className="text-[10px] text-[var(--ui-text-secondary)] grid grid-cols-2 gap-1 pt-1">
                  <span>רוחב גמרא עליון: {Math.round(knee.upperSourceWidth)}pt</span>
                  <span>רוחב גמרא תחתון: {Math.round(knee.lowerSourceWidth)}pt</span>
                  <span>עמודת רש״י: {Math.round(knee.rightCommentaryWidth)}pt</span>
                  <span>עמודת תוספות: {Math.round(knee.leftCommentaryWidth)}pt</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    מספר שורות מפרשים מעל הגמרא (ברך עליונה):
                  </span>
                  <span className="font-mono">
                    {kneeSettings?.upperKneeLines ??
                      designSettings.ravText.upperCollarLines}{' '}
                    שורות
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={
                    kneeSettings?.upperKneeLines ??
                    designSettings.ravText.upperCollarLines
                  }
                  onChange={e => {
                    const val = Number(e.target.value);
                    if (onUpdateKneeSettings && kneeSettings) {
                      onUpdateKneeSettings({
                        ...kneeSettings,
                        upperKneeLines: val,
                      });
                    }
                  }}
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    מרווח עמודות (Gutter) בין מפרשים לגמרא:
                  </span>
                  <span className="font-mono">
                    {kneeSettings?.gutterWidth ??
                      designSettings.ravText.gutterWidthPt}{' '}
                    pt
                  </span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={24}
                  step={1}
                  value={
                    kneeSettings?.gutterWidth ??
                    designSettings.ravText.gutterWidthPt
                  }
                  onChange={e => {
                    const val = Number(e.target.value);
                    if (onUpdateKneeSettings && kneeSettings) {
                      onUpdateKneeSettings({
                        ...kneeSettings,
                        gutterWidth: val,
                      });
                    }
                  }}
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    גובה צומת ברך תחתונה (% מגובה הדף):
                  </span>
                  <span className="font-mono">
                    {kneeSettings?.junctionPercent ??
                      designSettings.ravText.kneeJunctionPercent}
                    %
                  </span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={80}
                  step={2}
                  value={
                    kneeSettings?.junctionPercent ??
                    designSettings.ravText.kneeJunctionPercent
                  }
                  onChange={e => {
                    const val = Number(e.target.value);
                    if (onUpdateKneeSettings && kneeSettings) {
                      onUpdateKneeSettings({
                        ...kneeSettings,
                        mode: 'manual',
                        junctionPercent: val,
                      });
                    }
                  }}
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>הדגש דיבור המתחיל (ד״ה) אוטומטית</span>
                <input
                  type="checkbox"
                  checked={designSettings.ravText.dibburHamatchilBold}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateRavTextSettings(
                      designSettings,
                      { dibburHamatchilBold: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, 'הדגשת דיבור המתחיל');
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>שמור מפרש באותו עמוד עם המקור המקושר</span>
                <input
                  type="checkbox"
                  checked={designSettings.ravText.preferSamePageSourceCommentary}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateRavTextSettings(
                      designSettings,
                      { preferSamePageSourceCommentary: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, 'הצמדת מפרש למקור');
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>
            </div>
          </div>
        )}

        {/* TAB 5: FOOTNOTES */}
        {currentTab === 'footnotes' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  גודל גופן הערות (pt):
                </label>
                <input
                  type="number"
                  min={7}
                  max={16}
                  step={0.5}
                  value={designSettings.footnotes.fontSizePt}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateFootnoteSettings(
                      designSettings,
                      { fontSizePt: Number(e.target.value) },
                      'user'
                    );
                    applyWithHardRuleGuard(next, 'גודל גופן הערות שוליים');
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  מרווח שורות הערות (pt):
                </label>
                <input
                  type="number"
                  min={9}
                  max={22}
                  step={0.5}
                  value={designSettings.footnotes.lineSpacingPt}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateFootnoteSettings(
                      designSettings,
                      { lineSpacingPt: Number(e.target.value) },
                      'user'
                    );
                    applyWithHardRuleGuard(next, 'מרווח שורות הערות');
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>הצג קו מפריד מעל הערות השוליים</span>
                <input
                  type="checkbox"
                  checked={designSettings.footnotes.showSeparatorRule}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateFootnoteSettings(
                      designSettings,
                      { showSeparatorRule: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, 'קו מפריד הערות שוליים');
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>יישור בלוק מלא להערות מרובות שורות</span>
                <input
                  type="checkbox"
                  checked={designSettings.footnotes.justifyMultiLineFootnotes}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateFootnoteSettings(
                      designSettings,
                      { justifyMultiLineFootnotes: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, 'יישור הערות שוליים');
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
