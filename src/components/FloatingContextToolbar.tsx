import React, { useEffect, useMemo, useState } from 'react';
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
  getSemanticRoleLabel,
} from '../types/design-settings';
import { DesignSettingsEngine } from '../engine/design-settings-engine';
import {
  applyCharacterStyleChange,
  applyParagraphStyleChange,
  type TextStyleTarget,
} from '../engine/text-style-apply';
import { getFontLibraryFamilies, subscribeFontLibrary } from '../engine/font-library';
import { InspectorMainTab } from './DesignTypesettingPanel';
import { useLanguage } from '../i18n/LanguageContext';

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
  /**
   * v0.6.0 (Part B): genuine Auto-Center for the selected block (App owns
   * the break instructions). When absent, or with nothing selected, the
   * button falls back to the engine's in-flow centring.
   */
  onAutoCenterBlock?: () => void;
  /**
   * v0.9.8 Phase 5 — one-click proofing micro-adjustments (App owns the
   * break instructions, same as Auto-Center). Push moves this page's
   * last line to the next page; pull moves the next page's first line
   * onto this page. When absent (or disabled) the buttons render
   * disabled with the reason, never dead.
   */
  onPushLineToNextPage?: () => void;
  onPullLineToThisPage?: () => void;
  canPushLine?: boolean;
  canPullLine?: boolean;
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
  onAutoCenterBlock,
  // v0.9.8 Phase 5: push / pull line micro-adjustments.
  onPushLineToNextPage,
  onPullLineToThisPage,
  canPushLine = false,
  canPullLine = false,
}) => {
  const { t, dir, lang } = useLanguage();
  const activeRole = selectedUnit?.role ?? 'main_source';
  const roleLabel = getSemanticRoleLabel(activeRole, lang);

  // v0.5.0 (integrator — Module 1c): the toolbar's font list also offers
  // system + imported fonts, not only the built-ins (same library the
  // design panel's dropdown reads). Re-renders when the library changes
  // (scan / import / delete).
  const [fontLibraryVersion, setFontLibraryVersion] = useState(0);
  useEffect(
    () => subscribeFontLibrary(() => setFontLibraryVersion(v => v + 1)),
    []
  );
  const toolbarFontOptions = useMemo(() => {
    void fontLibraryVersion;
    const seen = new Set<string>();
    const list: Array<{ family: string; displayNameHe: string }> = [];
    for (const f of availableFonts) {
      if (!seen.has(f.family)) {
        seen.add(f.family);
        list.push(f);
      }
    }
    for (const family of getFontLibraryFamilies()) {
      if (!seen.has(family)) {
        seen.add(family);
        list.push({ family, displayNameHe: family });
      }
    }
    return list;
  }, [availableFonts, fontLibraryVersion]);

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

  /**
   * v0.9.2 Part B — the style target is computed ONCE here (selected word
   * > selected unit > role) and both writers below go through the ONE
   * shared handler in engine/text-style-apply.ts — the same handler the
   * Design panel and the keyboard shortcut use, so a change made here
   * can never diverge from one made there.
   */
  const styleTarget: TextStyleTarget =
    selectedWordInfo && selectedUnit
      ? { role: activeRole, unitId: selectedUnit.id, wordIndex: selectedWordInfo.wordIndex }
      : selectedUnit
        ? { role: activeRole, unitId: selectedUnit.id }
        : { role: activeRole };

  const applyCharChange = (
    patch: Partial<typeof charStyle>,
    summaryHe: string
  ) => {
    const next = applyCharacterStyleChange(designSettings, styleTarget, patch);
    const scope =
      selectedWordInfo && selectedUnit
        ? `${t('מילה')}: "${selectedWordInfo.wordText}"`
        : selectedUnit
          ? t('דריסה מקומית')
          : roleLabel;
    onUpdateDesignSettings(next, `${t(summaryHe)} (${scope})`);
  };

  const applyParaChange = (
    patch: Partial<typeof paraStyle>,
    summaryHe: string
  ) => {
    const paraTarget: TextStyleTarget = selectedUnit
      ? { role: activeRole, unitId: selectedUnit.id }
      : { role: activeRole };
    const next = applyParagraphStyleChange(designSettings, paraTarget, patch);
    const scope = selectedUnit ? t('דריסה מקומית') : roleLabel;
    onUpdateDesignSettings(next, `${t(summaryHe)} (${scope})`);
  };

  return (
    <div
      dir={dir}
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
            ? `יחידה: ${roleLabel.split(' ')[0]}`
            : `סגנון: ${roleLabel.split(' ')[0]}`}
        </span>
        {(selectedUnit || selectedWordInfo) && (
          <button
            onClick={onClearSelection}
            className="p-0.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text-primary)] transition-colors"
            title={t("נקה בחירה מקומית וחזור לסגנון תפקיד")}
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
            title={t("ערוך טקסט יחידה זו ישירות על הדף (או לחיצה כפולה על הטקסט)")}
          >
            <Edit3 className="w-3 h-3" />
            <span>{t("ערוך טקסט במקום")}</span>
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
            lang === 'en' ? `Font ${e.target.value}` : `גופן ${e.target.value}`
          )
        }
        className="bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] hover:border-[var(--ui-border-strong)] rounded px-2 py-1 text-[11px] text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)] max-w-[140px]"
        title={t("בחירת גופן")}
      >
        {toolbarFontOptions.map(f => (
          <option key={f.family} value={f.family}>
            {t(f.displayNameHe) || f.family}
          </option>
        ))}
      </select>

      {/* Font Size Stepper */}
      <div className="flex items-center bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded overflow-hidden">
        <button
          onClick={() =>
            applyCharChange(
              { fontSizePt: Math.max(7, Number((charStyle.fontSizePt - 0.5).toFixed(1))) },
              t("הקטנת גופן")
            )
          }
          className="px-1.5 py-1 hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
          title={t("הקטן גופן ב-0.5pt")}
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
              t("הגדלת גופן")
            )
          }
          className="px-1.5 py-1 hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
          title={t("הגדל גופן ב-0.5pt")}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Line Spacing (Leading) Quick Stepper */}
      <div
        className="flex items-center bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded px-1.5 py-0.5 gap-1"
        title={t("מרווח בין השורות")}
      >
        <span className="text-[10px] text-[var(--ui-text-secondary)]">{t("מרווח:")}</span>
        <button
          onClick={() =>
            applyParaChange(
              {
                lineSpacingRatio: Math.max(
                  1.08,
                  Number((paraStyle.lineSpacingRatio - 0.04).toFixed(2))
                ),
              },
              t("צמצום מרווח שורות")
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
              t("הגדלת מרווח שורות")
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
            !charStyle.isBold ? t("הדגשת טקסט") : t("ביטול הדגשה")
          )
        }
        className={`p-1.5 rounded border transition-colors ${
          charStyle.isBold
            ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)]/40 text-[var(--ui-accent)] font-semibold'
            : 'bg-transparent border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
        }`}
        title={t("הדגשה (Bold)")}
      >
        <Bold className="w-3.5 h-3.5" />
      </button>

      {/* Paragraph Alignment Buttons */}
      <div className="flex items-center bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded p-0.5 gap-0.5">
        {(
          [
            { id: 'justify', icon: AlignJustify, label: t("יישור מלא (בלוק)") },
            { id: 'right', icon: AlignRight, label: t("יישור לימין") },
            { id: 'center', icon: AlignCenter, label: t("מרכוז") },
          ] as Array<{ id: DesignAlignment; icon: any; label: string }>
        ).map(al => {
          const Icon = al.icon;
          const active = paraStyle.alignment === al.id;
          return (
            <button
              key={al.id}
              onClick={() =>
                applyParaChange({ alignment: al.id }, lang === 'en' ? `Alignment: ${al.label}` : `יישור: ${al.label}`)
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

      {/* v0.5.0 Part B (Module 5): Auto-Center the selected block (or the
          current role when nothing is selected) — equal side margins and
          equal space above/below. Writes through the same paragraph styles
          the preview renders, so the page updates live.
          v0.6.0 (Part B): with a block selected, the genuine centring
          (App's `onAutoCenterBlock`) is used instead — the block is
          centred on its own page, horizontally and vertically. */}
      <button
        onClick={() => {
          if (selectedUnit && onAutoCenterBlock) {
            onAutoCenterBlock();
            return;
          }
          const next = DesignSettingsEngine.autoCenterBlock(
            designSettings,
            selectedUnit ? { unitId: selectedUnit.id } : { role: activeRole },
            'user'
          );
          onUpdateDesignSettings(next, `${t('מרכוז הפסקה')} (${roleLabel})`);
        }}
        className="p-1.5 rounded border border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-accent)] hover:bg-[var(--ui-surface-hover)] transition-colors"
        title={t('מרכוז אוטומטי')}
      >
        <AlignCenter className="w-3.5 h-3.5" />
      </button>

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
            title={t("הצג או הסתר את קו הברך על הדף")}
          >
            <Layers className="w-3 h-3" />
            <span>{t("קו הברך")}</span>
          </button>
          <button
            onClick={() => onOpenInspectorTab('rav_text')}
            className="px-2 py-1 rounded text-[11px] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)] transition-colors"
            title={t("פתח את הגדרות הגמרא והמפרשים")}
          >
            
            {t("גמרא ומפרשים")}
          </button>
        </div>
      )}

      {/* v0.9.8 Phase 5 — Push / pull line micro-adjustments for final
          proofing. One click moves one line across the page boundary via
          an anchored break instruction (App owns the instructions, so
          one undo step covers it and it survives save / reload / export).
          Push = this page's last line → next page (`oneLineLess`);
          Pull = next page's first line → this page (`oneLineMore`,
          refused with a toast when the page has no room). */}
      <div className="flex items-center gap-1 pr-1.5 border-r border-[var(--ui-border)]">
        <button
          type="button"
          data-testid="toolbar-push-line"
          onClick={() => onPushLineToNextPage?.()}
          disabled={!canPushLine || !onPushLineToNextPage}
          className="px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t('דחוף את השורה האחרונה של העמוד לעמוד הבא')}
        >
          <span aria-hidden="true">↓</span>
          <span>{t('דחוף שורה לעמוד הבא')}</span>
        </button>
        <button
          type="button"
          data-testid="toolbar-pull-line"
          onClick={() => onPullLineToThisPage?.()}
          disabled={!canPullLine || !onPullLineToThisPage}
          className="px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t('משוך את השורה הראשונה של העמוד הבא לעמוד זה')}
        >
          <span aria-hidden="true">↑</span>
          <span>{t('משוך שורה לעמוד זה')}</span>
        </button>
      </div>

      {/* Open Full Inspector Button */}
      <button
        onClick={() => onOpenInspectorTab('typography')}
        className="p-1.5 rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-accent)] hover:bg-[var(--ui-surface-hover)] transition-colors"
        title={t("פתח את כל אפשרויות העיצוב")}
      >
        <Sliders className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
