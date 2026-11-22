import React from 'react';
import {
  Bold,
  AlignRight,
  AlignCenter,
  AlignJustify,
  Sliders,
  Layers,
  Minus,
  Plus,
  X,
  Edit3,
} from 'lucide-react';
import {
  BookLayoutType,
  ContentUnit,
  LocalFontEntry,
} from '../types/typesetter';
import {
  DesignAlignment,
  ProfessionalDesignSettings,
  SEMANTIC_ROLE_LABELS_HE,
} from '../types/design-settings';
import { DesignSettingsEngine } from '../engine/design-settings-engine';
import { InspectorMainTab } from './DesignTypesettingPanel';

interface FloatingContextToolbarProps {
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
    role: string;
  } | null;
  onClearSelection: () => void;
  currentPageIndex: number;
  layoutType: BookLayoutType;
  showKneeGuide: boolean;
  onToggleKneeGuide: () => void;
  onOpenInspectorTab: (tab: InspectorMainTab) => void;
  onEditSelectedUnit?: (unitId: string) => void;
}

export const FloatingContextToolbar: React.FC<FloatingContextToolbarProps> = ({
  designSettings,
  onUpdateDesignSettings,
  availableFonts,
  selectedUnit,
  selectedWordInfo,
  onClearSelection,
  layoutType,
  showKneeGuide,
  onToggleKneeGuide,
  onOpenInspectorTab,
  onEditSelectedUnit,
}) => {
  const activeRole = selectedUnit?.role ?? 'main_source';
  const roleLabelHe =
    SEMANTIC_ROLE_LABELS_HE[activeRole] ?? 'מקור ראשי (גמרא / פנים)';

  const resolvedStyle = DesignSettingsEngine.resolveRoleAndUnitStyle(
    designSettings,
    activeRole,
    selectedUnit?.id,
    selectedWordInfo?.wordIndex
  );

  const charStyle = resolvedStyle.character;
  const paraStyle = resolvedStyle.paragraph;

  const isRavLayout =
    layoutType === 'rav_text' || layoutType === 'mikraot_gedolot';

  const applyCharChange = (
    patch: Partial<typeof charStyle>,
    summaryHe: string
  ) => {
    if (selectedWordInfo && selectedUnit) {
      const next = DesignSettingsEngine.setLocalWordOverride(
        designSettings,
        selectedUnit.id,
        selectedWordInfo.wordIndex,
        patch,
        'user'
      );
      onUpdateDesignSettings(next, `${summaryHe} (מילה: "${selectedWordInfo.wordText}")`);
    } else if (selectedUnit) {
      const next = DesignSettingsEngine.setLocalUnitOverride(
        designSettings,
        selectedUnit.id,
        { character: patch },
        'user'
      );
      onUpdateDesignSettings(next, `${summaryHe} (דריסה מקומית)`);
    } else {
      const next = DesignSettingsEngine.updateRoleCharacterStyle(
        designSettings,
        activeRole,
        patch,
        'user'
      );
      onUpdateDesignSettings(next, `${summaryHe} (${roleLabelHe})`);
    }
  };

  const applyParaChange = (
    patch: Partial<typeof paraStyle>,
    summaryHe: string
  ) => {
    if (selectedUnit) {
      const next = DesignSettingsEngine.setLocalUnitOverride(
        designSettings,
        selectedUnit.id,
        { paragraph: patch },
        'user'
      );
      onUpdateDesignSettings(next, `${summaryHe} (דריסה מקומית)`);
    } else {
      const next = DesignSettingsEngine.updateRoleParagraphStyle(
        designSettings,
        activeRole,
        patch,
        'user'
      );
      onUpdateDesignSettings(next, `${summaryHe} (${roleLabelHe})`);
    }
  };

  return (
    <div
      dir="rtl"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ui-surface)] border border-[var(--ui-border)] shadow-[var(--ui-floating-shadow)] text-xs text-[var(--ui-text-primary)] select-none transition-all"
    >
      {/* Active Target Badge */}
      <div className="flex items-center gap-1.5 pl-2 border-l border-[var(--ui-border)]">
        <span
          className={`w-2 h-2 rounded-full ${
            selectedWordInfo
              ? 'bg-[var(--ui-accent)]'
              : selectedUnit
              ? 'bg-[var(--ui-accent)]/80'
              : 'bg-[var(--ui-text-muted)]'
          }`}
        />
        <span className="text-[11px] font-medium text-[var(--ui-text-primary)] max-w-[165px] truncate">
          {selectedWordInfo
            ? `מילה: "${selectedWordInfo.wordText}"`
            : selectedUnit
            ? `יחידה: ${roleLabelHe.split(' ')[0]}`
            : `סגנון: ${roleLabelHe.split(' ')[0]}`}
        </span>
        {(selectedUnit || selectedWordInfo) && (
          <button
            onClick={onClearSelection}
            className="p-0.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text-primary)] transition-colors"
            title="נקה בחירה מקומית וחזור לסגנון תפקיד"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Edit Unit Text In-Place Action when a unit is selected */}
      {selectedUnit && onEditSelectedUnit && selectedUnit.role !== 'continuation' && (
        <>
          <button
            onClick={() => onEditSelectedUnit(selectedUnit.id)}
            className="px-2 py-1 rounded bg-[var(--ui-accent)] text-white hover:bg-[var(--ui-accent-hover)] text-[11px] font-medium flex items-center gap-1 transition-colors"
            title="ערוך טקסט יחידה זו ישירות על הדף (או לחיצה כפולה על הטקסט)"
          >
            <Edit3 className="w-3 h-3" />
            <span>ערוך טקסט במקום</span>
          </button>
          <div className="h-4 w-px bg-[var(--ui-border)]" />
        </>
      )}

      {/* Font Family Selector */}
      <select
        value={charStyle.fontFamily}
        onChange={e =>
          applyCharChange(
            { fontFamily: e.target.value },
            `גופן ${e.target.value}`
          )
        }
        className="bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] hover:border-[var(--ui-border-strong)] rounded px-2 py-1 text-[11px] text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)] max-w-[140px]"
        title="בחירת גופן"
      >
        {availableFonts.map(f => (
          <option key={f.family} value={f.family}>
            {f.displayNameHe || f.family}
          </option>
        ))}
      </select>

      {/* Font Size Stepper */}
      <div className="flex items-center bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded overflow-hidden">
        <button
          onClick={() =>
            applyCharChange(
              { fontSizePt: Math.max(7, Number((charStyle.fontSizePt - 0.5).toFixed(1))) },
              'הקטנת גופן'
            )
          }
          className="px-1.5 py-1 hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
          title="הקטן גופן ב-0.5pt"
        >
          <Minus className="w-3 h-3" />
        </button>
        <span className="px-2 text-[11px] font-mono text-[var(--ui-text-primary)] min-w-[44px] text-center">
          {charStyle.fontSizePt}pt
        </span>
        <button
          onClick={() =>
            applyCharChange(
              { fontSizePt: Math.min(36, Number((charStyle.fontSizePt + 0.5).toFixed(1))) },
              'הגדלת גופן'
            )
          }
          className="px-1.5 py-1 hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
          title="הגדל גופן ב-0.5pt"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Line Spacing (Leading) Quick Stepper */}
      <div
        className="flex items-center bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded px-1.5 py-0.5 gap-1"
        title="מרווח שורות (Line Spacing Ratio)"
      >
        <span className="text-[10px] text-[var(--ui-text-secondary)]">מרווח:</span>
        <button
          onClick={() =>
            applyParaChange(
              {
                lineSpacingRatio: Math.max(
                  1.08,
                  Number((paraStyle.lineSpacingRatio - 0.04).toFixed(2))
                ),
              },
              'צמצום מרווח שורות'
            )
          }
          className="p-0.5 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
        >
          <Minus className="w-2.5 h-2.5" />
        </button>
        <span className="text-[11px] font-mono text-[var(--ui-text-primary)]">
          {paraStyle.lineSpacingRatio.toFixed(2)}
        </span>
        <button
          onClick={() =>
            applyParaChange(
              {
                lineSpacingRatio: Math.min(
                  2.0,
                  Number((paraStyle.lineSpacingRatio + 0.04).toFixed(2))
                ),
              },
              'הגדלת מרווח שורות'
            )
          }
          className="p-0.5 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
        >
          <Plus className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Bold Toggle */}
      <button
        onClick={() =>
          applyCharChange(
            {
              isBold: !charStyle.isBold,
              fontWeight: !charStyle.isBold ? 700 : 400,
            },
            !charStyle.isBold ? 'הדגשת טקסט' : 'ביטול הדגשה'
          )
        }
        className={`p-1.5 rounded border transition-colors ${
          charStyle.isBold
            ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)]/40 text-[var(--ui-accent)] font-semibold'
            : 'bg-transparent border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
        }`}
        title="הדגשה (Bold)"
      >
        <Bold className="w-3.5 h-3.5" />
      </button>

      {/* Paragraph Alignment Buttons */}
      <div className="flex items-center bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded p-0.5 gap-0.5">
        {(
          [
            { id: 'justify', icon: AlignJustify, label: 'יישור מלא (בלוק)' },
            { id: 'right', icon: AlignRight, label: 'יישור לימין' },
            { id: 'center', icon: AlignCenter, label: 'מרכוז' },
          ] as Array<{ id: DesignAlignment; icon: any; label: string }>
        ).map(al => {
          const Icon = al.icon;
          const active = paraStyle.alignment === al.id;
          return (
            <button
              key={al.id}
              onClick={() =>
                applyParaChange({ alignment: al.id }, `יישור: ${al.label}`)
              }
              className={`p-1 rounded transition-colors ${
                active
                  ? 'bg-[var(--ui-surface)] text-[var(--ui-accent)] shadow-2xs border border-[var(--ui-border)]'
                  : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
              }`}
              title={al.label}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>

      {/* Rav Text Quick Controls (Only when in Rav Text / Mikraot Gedolot) */}
      {isRavLayout && (
        <div className="flex items-center gap-1 pr-1.5 border-r border-[var(--ui-border)]">
          <button
            onClick={onToggleKneeGuide}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border transition-colors ${
              showKneeGuide
                ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)]/35 text-[var(--ui-accent)]'
                : 'bg-transparent border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
            }`}
            title="הצג/הסתר קווי מתאר ברכיים דינמיות על הדף"
          >
            <Layers className="w-3 h-3" />
            <span>ברכיים</span>
          </button>
          <button
            onClick={() => onOpenInspectorTab('rav_text')}
            className="px-2 py-1 rounded text-[11px] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)] transition-colors"
            title="פתח הגדרות רב-טקסט וברכיים במגירת המאפיינים"
          >
            יחסי רב-טקסט
          </button>
        </div>
      )}

      {/* Open Full Inspector Button */}
      <button
        onClick={() => onOpenInspectorTab('typography')}
        className="p-1.5 rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-accent)] hover:bg-[var(--ui-surface-hover)] transition-colors"
        title="פתח מגירת מאפייני טיפוגרפיה מלאה"
      >
        <Sliders className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
