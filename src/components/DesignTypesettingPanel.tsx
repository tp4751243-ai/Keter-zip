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
  DafFormatMode,
  DynamicKneeContour,
  KneeCustomSettings,
  LocalFontEntry,
  ParagraphIndentMode,
  PeripheralStreamKind,
  SeparatorStyleId,
  TierConfig,
} from '../types/typesetter';
import {
  BlockSpacingSettings,
  CharacterStyleSettings,
  DEFAULT_COMMENTARY_SEPARATOR,
  DEFAULT_FOLIO_NUMBERING,
  DEFAULT_OPENING_DECORATION,
  DEFAULT_PARAGRAPH_SEPARATOR,
  DEFAULT_PERIPHERAL_STREAMS,
  DEFAULT_RUNNING_HEADER_SETTINGS,
  DEFAULT_TRANSITION_MARKER,
  DesignAlignment,
  DesignLastLineAlignment,
  DesignScopeLevel,
  MarginUnit,
  OpeningDecorationStyleId,
  PageLayoutDesignSettings,
  ParagraphStyleSettings,
  ProfessionalDesignSettings,
  getSemanticRoleLabel,
  SemanticStyleRole,
} from '../types/design-settings';
import {
  DesignSettingsEngine,
  PAGE_SIZE_DIMENSIONS,
  READY_DESIGNS,
  ReadyDesignId,
  ReadyDesignPreset,
  isMultiTierLayout,
} from '../engine/design-settings-engine';
import {
  applyCharacterStyleChange,
  applyParagraphStyleChange,
  type TextStyleTarget,
} from '../engine/text-style-apply';
import { useLanguage } from '../i18n/LanguageContext';
import {
  QUICK_TUNE_TRIM_LABELS,
  QUICK_TUNE_ZONE_LABELS,
  type QuickTuneTrimId,
  type QuickTuneZoneId,
} from '../i18n/strings';
import { Hint } from './Hint';
import { FontDropdown } from './FontDropdown';
import { TitlePagePanel } from './TitlePagePanel';
import { CustomLayoutDesigner } from './CustomLayoutDesigner';
import { defaultCustomLayoutDesign } from '../engine/custom-layout-engine';
import { getHistoricalLayoutLibrary } from '../engine/historical-layouts';
import { VILNA_SHAS_PRESET, vilnaPresetToDesignPatch } from '../engine/vilna-preset';
import { SEFER_TYPE_LABELS, type SeferType } from '../engine/sefer-type';
import type { CustomLayoutBox } from '../types/design-settings';
import { getFontLibraryFamilies, isFontEmbeddableInPdf } from '../engine/font-library';

export type InspectorMainTab =
  | 'quick_tune'
  | 'typography'
  | 'paragraph'
  | 'page_geometry'
  | 'rav_text'
  | 'footnotes'
  | 'title_page';

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
  /** Book title (used as the title-page title fallback). */
  bookTitle?: string;
  knee?: DynamicKneeContour;
  kneeSettings?: KneeCustomSettings;
  onUpdateKneeSettings?: (nextKnee: KneeCustomSettings) => void;
  onClose?: () => void;
  onStartEditUnit?: (unitId: string) => void;
  /**
   * v0.6.0 (Part B): genuine Auto-Center for the selected block (alone on
   * its page, centred horizontally and vertically). Supplied by App, which
   * owns the break instructions. When absent (or nothing is selected) the
   * panel falls back to the engine's in-flow centring.
   */
  onAutoCenterBlockGenuine?: () => void;
  /**
   * v0.9.0 Part B — historical layout library + template file handlers,
   * supplied by App (which owns the preset-switch transaction). All three
   * are optional: when a handler is absent its controls render disabled
   * with the reason, never dead.
   */
  onApplyHistoricalRecipe?: (recipeId: string) => void;
  onExportTemplate?: () => void;
  onImportTemplateFile?: (file: File) => void;
}

const ROLE_OPTIONS: Array<{ role: SemanticStyleRole; labelHe: string; labelEn: string }> = [
  { role: 'main_source', labelHe: 'מקור ראשי (גמרא / משנה / פנים)', labelEn: 'Main source (Gemara / Mishnah / penim)' },
  { role: 'primary_comment', labelHe: 'פירוש ראשי (רש״י / משנה ברורה)', labelEn: 'Main commentary (Rashi / Mishnah Berurah)' },
  { role: 'secondary_comment', labelHe: 'פירוש משני (תוספות / ש״ך)', labelEn: 'Secondary commentary (Tosafot / Shakh)' },
  { role: 'tertiary_comment', labelHe: 'פירוש שלישי (עין משפט / מסורת הש״ס)', labelEn: 'Third commentary (Ein Mishpat / Mesorat HaShas)' },
  { role: 'dibbur_hamatchil', labelHe: 'דיבור המתחיל (ד״ה)', labelEn: 'Dibbur hamatchil (D.H.)' },
  { role: 'verse', labelHe: 'פסוק (מקראות גדולות / תנ״ך)', labelEn: 'Verse (Mikraot Gedolot / Tanakh)' },
  { role: 'main_title', labelHe: 'כותרת ראשית / שער', labelEn: 'Main heading / title page' },
  { role: 'subtitle', labelHe: 'כותרת משנה', labelEn: 'Subheading' },
  { role: 'chapter', labelHe: 'פרק / כותרת פרק', labelEn: 'Chapter / chapter heading' },
  { role: 'siman', labelHe: 'סימן (שולחן ערוך / הלכה)', labelEn: 'Siman (Shulchan Arukh / halakha)' },
  { role: 'heading', labelHe: 'כותרת', labelEn: 'Heading' },
  { role: 'subheading', labelHe: 'כותרת משנית', labelEn: 'Secondary heading' },
  { role: 'regular_paragraph', labelHe: 'גוף טקסט / פסקה רגילה', labelEn: 'Body text / regular paragraph' },
  { role: 'halakha', labelHe: 'הלכה פסוקה', labelEn: 'Decided halakha' },
  { role: 'quote', labelHe: 'ציטוט / מובאה', labelEn: 'Quotation / citation' },
  { role: 'introduction', labelHe: 'הקדמה / מבוא', labelEn: 'Introduction / preface' },
  { role: 'footnote', labelHe: 'הערות שוליים', labelEn: 'Footnotes' },
  { role: 'side_note', labelHe: 'הערת צד / גליון', labelEn: 'Side note / margin' },
  { role: 'header_running', labelHe: 'כותרת רצה בראש עמוד', labelEn: 'Running head at the top of a page' },
  { role: 'folio_number', labelHe: 'מספר דף / עמוד', labelEn: 'Folio / page number' },
  { role: 'continuation', labelHe: 'שורת המשך מעמוד לעמוד', labelEn: 'Continuation line from page to page' },
];

export const DesignTypesettingPanel: React.FC<DesignTypesettingPanelProps> = ({
  designSettings,
  onUpdateDesignSettings,
  availableFonts,
  selectedUnit,
  selectedWordInfo,
  onClearSelectedWord,
  currentPageIndex,
  activeMainTab = 'typography',
  onMainTabChange,
  bookTitle = '',
  knee,
  kneeSettings,
  onUpdateKneeSettings,
  onClose,
  onStartEditUnit,
  onAutoCenterBlockGenuine,
  onApplyHistoricalRecipe,
  onExportTemplate,
  onImportTemplateFile,
}) => {
  const { t, tf, dir, lang } = useLanguage();
  // v0.6.0 (Part B): the margin unit the user types in (pt / mm / in).
  // The engine stores points; values are converted both ways on the fly.
  const [marginUnit, setMarginUnit] = useState<MarginUnit>('pt');
  const [internalTab, setInternalTab] = useState<InspectorMainTab>(activeMainTab);
  const currentTab = onMainTabChange ? activeMainTab : internalTab;
  const setTab = (t: InspectorMainTab) => {
    setInternalTab(t);
    if (onMainTabChange) onMainTabChange(t);
  };

  const [scopeLevel, setScopeLevel] = useState<DesignScopeLevel>('role');
  const [activeRole, setActiveRole] = useState<SemanticStyleRole>('main_source');
  const [clampNotices, setClampNotices] = useState<string[]>([]);
  // v0.3.0 (Module C): last ready design the user picked (highlight only;
  // the settings themselves carry the applied values).
  const [activePresetId, setActivePresetId] = useState<ReadyDesignId | null>(null);

  // v0.4.0 — design kits filterable by book type (checklist §3). Only
  // categories that have at least one kit are shown as chips.
  const [presetFilter, setPresetFilter] = useState<string>('all');
  // v0.9.1 — the table is typed by the preset category union, so
  // TypeScript itself fails the build if a category ever ships without
  // a label (the v0.8.0 'yiddish' presets did exactly that: the table
  // was Record<string, …>, the lookup returned undefined, and reading
  // .he/.en threw at panel mount — the user-reported Page design crash).
  const PRESET_CATEGORY_LABELS: Record<ReadyDesignPreset['category'], { he: string; en: string }> = {
    gemara: { he: 'גמרא', en: 'Gemara' },
    tanakh: { he: 'תנ״ך', en: 'Tanakh' },
    siddur: { he: 'סידור', en: 'Siddur' },
    halacha: { he: 'הלכה', en: 'Halacha' },
    chiddushim: { he: 'חידושים', en: 'Chiddushim' },
    derashot_mussar: { he: 'דרשות / מוסר', en: 'Derashot / Mussar' },
    sheilot_uteshuvot: { he: 'שו״ת', en: 'Responsa' },
    general: { he: 'כללי', en: 'General' },
    yiddish: { he: 'יידיש', en: 'Yiddish' },
  };
  const presetCategories = Array.from(new Set(READY_DESIGNS.map(p => p.category)));
  const visiblePresets =
    presetFilter === 'all' ? READY_DESIGNS : READY_DESIGNS.filter(p => p.category === presetFilter);

  // v0.4.0 — checklist §2 page sizes: preset name + cm size for the picker.
  const PAGE_SIZE_OPTIONS: Array<{
    id: keyof typeof PAGE_SIZE_DIMENSIONS;
    he: string;
    en: string;
  }> = [
    { id: 'pocket', he: 'כיס — 10.5×14.8 ס״מ', en: 'Pocket — 10.5×14.8 cm' },
    { id: 'small_a5', he: 'קטן (A5) — 14.8×21 ס״מ', en: 'Small (A5) — 14.8×21 cm' },
    { id: 'regular_17x24', he: 'רגיל — 17×24 ס״מ', en: 'Regular — 17×24 cm' },
    { id: 'wide_17x25', he: 'רחב — 17.6×25 ס״מ', en: 'Wide — 17.6×25 cm' },
    { id: 'booklet_a4', he: 'חוברת (A4) — 21×29.7 ס״מ', en: 'Booklet (A4) — 21×29.7 cm' },
    { id: 'a4', he: 'A4 — 21×29.7 ס״מ', en: 'A4 — 21×29.7 cm' },
    { id: 'gemara_24x34', he: 'גמרא — 24×34 ס״מ', en: 'Gemara — 24×34 cm' },
    { id: 'b5', he: 'B5 — 18.2×25.7 ס״מ', en: 'B5 — 18.2×25.7 cm' },
    { id: 'vilna_folio', he: 'פוליו וילנא', en: 'Vilna folio' },
    { id: 'crown_quarto', he: 'קראון קווארטו', en: 'Crown quarto' },
    { id: 'royal_holy_book', he: 'רויאל (גודל נוכחי)', en: 'Royal (current size)' },
    { id: 'custom', he: 'מותאם אישית (רוחב/גובה למטה)', en: 'Custom (width/height below)' },
  ];

  // v0.3.0 (Module C): per-tier config for multi-tier layouts.
  const tiers: TierConfig[] = designSettings.pageLayout.tiers ?? [];
  const isMultiTier = isMultiTierLayout(designSettings.layoutType);
  // v0.5.0 Part A — Module 1(c): tier font options also include system +
  // imported fonts from the font library, not only the built-in catalogue.
  const fontFamilyOptions = Array.from(
    new Set([
      ...availableFonts.map(f => f.family),
      ...getFontLibraryFamilies(),
    ])
  );

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

  /**
   * v0.9.2 Part B — the char/para writers go through the ONE shared
   * handler in engine/text-style-apply.ts (same as the floating toolbar
   * and the keyboard shortcut). The panel only decides the TARGET from
   * its scopeLevel — local_word ⇒ that word, local_unit ⇒ the unit,
   * role ⇒ the whole role — and keeps its clamp-notice reporting.
   */
  const charTargetForScope = (): TextStyleTarget => {
    if (scopeLevel === 'local_word' && selectedWordInfo) {
      return { role: activeRole, unitId: selectedWordInfo.unitId, wordIndex: selectedWordInfo.wordIndex };
    }
    if (scopeLevel === 'local_unit' && selectedUnit) {
      return { role: activeRole, unitId: selectedUnit.id };
    }
    return { role: activeRole };
  };

  const handleUpdateChar = (
    patch: Partial<CharacterStyleSettings>,
    labelHe: string
  ) => {
    const target = charTargetForScope();
    const next = applyCharacterStyleChange(designSettings, target, patch);
    const scopeLabel =
      target.wordIndex !== undefined && selectedWordInfo
        ? tf('עיצוב מילה ("{word}")', { word: selectedWordInfo.wordText })
        : target.unitId !== undefined && selectedUnit
          ? tf('דריסת יחידה מקומית ({id})', { id: selectedUnit.id })
          : tf('עדכון תו ({role})', { role: getSemanticRoleLabel(activeRole, lang) });
    applyWithHardRuleGuard(next, `${scopeLabel}: ${t(labelHe)}`);
  };

  const handleUpdatePara = (
    patch: Partial<ParagraphStyleSettings>,
    labelHe: string
  ) => {
    const target = charTargetForScope();
    const paraTarget: TextStyleTarget =
      target.wordIndex !== undefined
        ? { role: activeRole, unitId: target.unitId }
        : target;
    const next = applyParagraphStyleChange(designSettings, paraTarget, patch);
    const scopeLabel =
      paraTarget.unitId !== undefined && selectedUnit
        ? tf('דריסת פסקה מקומית ({id})', { id: selectedUnit.id })
        : tf('עדכון פסקה ({role})', { role: getSemanticRoleLabel(activeRole, lang) });
    applyWithHardRuleGuard(next, `${scopeLabel}: ${t(labelHe)}`);
  };

  // ── v0.5.0 Part B (Module 5): block margins / spacing / Auto-Center ──
  // Same scope routing as `handleUpdatePara`: a selected block gets a local
  // override, otherwise the change lands on the role style for the whole
  // book. Values are the live resolved paragraph values, so the controls
  // always show the selected block's real margins.
  const blockSpacingTarget =
    (scopeLevel === 'local_unit' || scopeLevel === 'local_word') && selectedUnit
      ? { unitId: selectedUnit.id }
      : { role: activeRole };
  const handleUpdateBlockSpacing = (patch: Partial<BlockSpacingSettings>) => {
    const next = DesignSettingsEngine.updateBlockSpacing(
      designSettings,
      patch,
      blockSpacingTarget,
      'user'
    );
    applyWithHardRuleGuard(next, t('שולי הפסקה'));
  };
  const handleAutoCenterBlock = () => {
    // v0.6.0 (Part B): a selected block gets the GENUINE centring — alone
    // on its page, centred horizontally and vertically (App owns the break
    // instructions). Role-level centring (nothing selected) stays the
    // in-flow behaviour: equal side margins + equal space above/below.
    if (selectedUnit && onAutoCenterBlockGenuine) {
      onAutoCenterBlockGenuine();
      return;
    }
    const next = DesignSettingsEngine.autoCenterBlock(
      designSettings,
      blockSpacingTarget,
      'user'
    );
    applyWithHardRuleGuard(next, t('מרכוז הפסקה'));
  };
  // Centred right now (live values, not a stored flag): equal side margins
  // and equal space above/below, with something actually set.
  const isBlockCentered =
    paraStyle.leftIndentPt === paraStyle.rightIndentPt &&
    paraStyle.spaceBeforePt === paraStyle.spaceAfterPt &&
    (paraStyle.leftIndentPt > 0 || paraStyle.spaceBeforePt > 0);
  // ── end v0.5.0 Part B (Module 5) ──────────────────────────────────────

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
        `איפוס סגנון ${getSemanticRoleLabel(activeRole, lang)} לברירת מחדל גלובלית`
      );
    }
  };

  const MAIN_TABS: Array<{ id: InspectorMainTab; label: string; icon: any }> = [
    // v0.9.8 Phase 5 (Quick-Tune): the one-screen tune-up — first tab,
    // so the high-impact controls are the first thing a user sees. The
    // detailed tabs below are unchanged; Quick-Tune only surfaces the
    // same settings through simpler controls.
    { id: 'quick_tune', label: t("כוונון מהיר"), icon: Sliders },
    { id: 'typography', label: t("אותיות וגופן"), icon: Type },
    { id: 'paragraph', label: t("פסקה ויישור"), icon: AlignJustify },
    { id: 'page_geometry', label: t("עמוד ושוליים"), icon: Columns },
    { id: 'rav_text', label: t("גמרא ומפרשים"), icon: Layers },
    { id: 'footnotes', label: t("הערות שוליים"), icon: FileText },
    // v0.5.0 (Title Page / Shaar Blat builder).
    { id: 'title_page', label: t("עמוד שער"), icon: BookOpen },
  ];

  // v0.5.0 (integrator — simplification): one plain sentence under the tab
  // bar saying what the open section is for, so a first-time user can tell
  // at a glance without reading a manual.
  const TAB_DESCRIPTIONS: Record<InspectorMainTab, string> = {
    quick_tune: t("גודל דף, שוליים, גופנים וכותרת רצה — הכול במקום אחד."),
    typography: t("גופן, גודל ומרווח שורות של הטקסט."),
    paragraph: t("יישור, שוליים ומרווחים של הפסקה."),
    page_geometry: t("גודל הדף, שוליים, כותרת עליונה ומספרי עמודים."),
    rav_text: t("פריסת הגמרא, רש״י ותוספות סביב המקור."),
    footnotes: t("גופן, גודל וקו מפריד של הערות השוליים."),
    title_page: t("עמוד השער של הספר — העמוד הראשון, עם כותרת, פרטים ומסגרת."),
  };

  // Determine the active tier badge (GLOBAL / PROJECT / LOCAL)
  const activeTierLabel =
    scopeLevel === 'local_word' && selectedWordInfo
      ? {
          tier: t("שינוי למילה אחת בלבד"),
          desc: `שינויים חלים רק על המילה "${selectedWordInfo.wordText}"`,
          icon: MousePointerClick,
        }
      : scopeLevel === 'local_unit' && selectedUnit
      ? {
          tier: t("שינוי לפסקה זו בלבד"),
          desc: `שינויים חלים רק על היחידה הנבחרת (${selectedUnit.id})`,
          icon: MousePointerClick,
        }
      : hasProjectRoleOverride
      ? {
          tier: t("סגנון של הספר הזה"),
          desc: `חל על כל יחידות "${getSemanticRoleLabel(activeRole, lang)}" בספר`,
          icon: FolderKanban,
        }
      : {
          tier: t("ברירת המחדל של התוכנה"),
          desc: `חל על כל יחידות "${getSemanticRoleLabel(activeRole, lang)}" בספר`,
          icon: Globe,
        };

  return (
    <aside
      dir={dir}
      aria-label={t("חלונית עיצוב העמוד")}
      className="h-full min-h-0 w-full bg-[var(--ui-surface)] border-r border-[var(--ui-border)] flex flex-col select-none shrink-0 z-20 overflow-hidden transition-colors duration-150"
    >
      {/* 1. Drawer Header */}
      <div className="h-11 px-4 border-b border-[var(--ui-border)] flex items-center justify-between bg-[var(--ui-surface)] shrink-0">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[var(--ui-accent)]" />
          <span className="text-xs font-semibold text-[var(--ui-text-primary)]">
            
            {t("עיצוב העמוד")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--ui-surface-subtle)] text-[var(--ui-text-secondary)] border border-[var(--ui-border)] font-mono">
            
            {t("גרסה #")}{designSettings.revision}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
              title={t("סגור את חלונית העיצוב")}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* v0.6.0 Part A (§9): ONE scroll region for everything below the
          drawer header. Before this, the tier selector + Ready Designs grid
          (~700px of shrink-0 sections) sat ABOVE the flex-1 scroller, so on
          a short window the scroller collapsed to zero height and the tab
          content below the fold was unreachable — the panel "cut off lower
          options and could not scroll to the bottom". Now the fixed sections
          scroll away with the content, and the tab bar sticks to the top of
          the scroll region. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
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
            title={t("חזור להגדרות הרגילות של הספר")}
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t("בטל שינוי מקומי")}</span>
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
            
            {t("כל הספר")}
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
            {selectedUnit ? t("פסקה נבחרת") : t("בחר פסקה בדף")}
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
              : t("בחר מילה בדף")}
          </button>
        </div>

        {/* Target Role Selector + Quick In-Place Text Edit Button when Unit Selected */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--ui-text-secondary)] shrink-0">
            
            {t("מה מעצבים:")}
          </span>
          <select
            value={activeRole}
            onChange={e => setActiveRole(e.target.value as SemanticStyleRole)}
            className="flex-1 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2.5 py-1 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
          >
            {ROLE_OPTIONS.map(opt => (
              <option key={opt.role} value={opt.role}>
                {lang === 'en' ? opt.labelEn : opt.labelHe}
              </option>
            ))}
          </select>
        </div>

        {selectedUnit && onStartEditUnit && selectedUnit.role !== 'continuation' && (
          <div className="flex items-center justify-between pt-1 border-t border-[var(--ui-border)]/70">
            <span className="text-[10px] text-[var(--ui-text-secondary)] truncate max-w-[170px]">
              
              {t("נבחרה:")} {selectedUnit.rawText.slice(0, 28)}...
            </span>
            <button
              onClick={() => onStartEditUnit(selectedUnit.id)}
              className="px-2.5 py-1 rounded bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-white text-[10px] font-semibold flex items-center gap-1 transition-colors"
            >
              <Edit3 className="w-3 h-3" />
              <span>{t("ערוך טקסט במקום")}</span>
            </button>
          </div>
        )}

        {hasUnitLocalOverride && selectedUnit && (
          <div className="text-[10px] px-2 py-1 rounded bg-[var(--ui-selected-bg)] border border-[var(--ui-accent)]/30 text-[var(--ui-accent)] flex items-center justify-between">
            <span>{t("יש כאן שינוי שמשפיע רק על הפסקה הזאת")}</span>
            <button
              onClick={() => {
                const next = DesignSettingsEngine.clearLocalUnitOverride(
                  designSettings,
                  selectedUnit.id,
                  'user'
                );
                applyWithHardRuleGuard(next, t("ניקוי דריסה מקומית"));
              }}
              className="underline font-semibold"
            >
              
              {t("בטל את השינוי")}
            </button>
          </div>
        )}
      </div>

      {/* 3b. v0.3.0 (Module C) — Ready Design Presets (one click, opt-in) */}
      <div className="px-3 pt-2.5 pb-1 border-b border-[var(--ui-border)] bg-[var(--ui-surface)] shrink-0">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
          <span className="text-[11px] font-bold text-[var(--ui-text-primary)]">
            {t("עיצובים מוכנים")}
          </span>
          <span className="text-[10px] text-[var(--ui-text-secondary)]">
            {t("לחיצה אחת מחילה פריסה, גופנים ושכבות")}
          </span>
        </div>
        <Hint className="mb-2">{t("עיצוב מוכן משנה בבת אחת את הפריסה, הגופנים והצבעים. אפשר לשנות אחר כך כל דבר בנפרד.")}</Hint>
        {/* v0.4.0 — filter kits by book type (checklist §3). */}
        <div className="flex flex-wrap gap-1 mb-2">
          <button
            key="all"
            onClick={() => setPresetFilter('all')}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
              presetFilter === 'all'
                ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)]'
                : 'border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
            }`}
          >
            {t("הכל")}
          </button>
          {presetCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setPresetFilter(cat)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                presetFilter === cat
                  ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)]'
                  : 'border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
              }`}
            >
              {/* v0.9.1 — defensive: a category id with no label entry
                  shows its id instead of throwing (the panel must never
                  crash on a label lookup again). */}
              {PRESET_CATEGORY_LABELS[cat]?.[lang === 'en' ? 'en' : 'he'] ?? cat}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {visiblePresets.map(preset => {
            const active = activePresetId === preset.id;
            // Live preview: one real line in the kit's own main font/size.
            const previewFont = preset.patch.roleStyles?.main_source?.character?.fontFamily;
            const previewSize = preset.patch.roleStyles?.main_source?.character?.fontSizePt;
            return (
              <button
                key={preset.id}
                onClick={() => {
                  const res = DesignSettingsEngine.applyReadyDesign(
                    designSettings,
                    preset.id,
                    'user'
                  );
                  setActivePresetId(preset.id);
                  applyWithHardRuleGuard(
                    res.settings,
                    tf('עיצוב מוכן: {name}', { name: lang === 'en' ? preset.nameEn : preset.nameHe })
                  );
                }}
                title={lang === 'en' ? preset.descriptionEn : preset.descriptionHe}
                className={`text-start px-2.5 py-2 rounded-lg border transition-colors ${
                  active
                    ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)]'
                    : 'border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] hover:border-[var(--ui-accent)]/60'
                }`}
              >
                <span className="block text-[11px] font-semibold text-[var(--ui-text-primary)]">
                  {lang === 'en' ? preset.nameEn : preset.nameHe}
                </span>
                <span className="block text-[10px] text-[var(--ui-text-secondary)] leading-snug mt-0.5">
                  {lang === 'en' ? preset.descriptionEn : preset.descriptionHe}
                </span>
                {previewFont && (
                  <span
                    className="block text-[11px] text-[var(--ui-text-primary)] leading-snug mt-1 truncate"
                    style={{ fontFamily: previewFont, fontSize: previewSize ? `${Math.min(previewSize, 13)}px` : undefined }}
                  >
                    מאימתי קורין את שמע
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Domain Sub-Tabs */}
      <div className="sticky top-0 z-10 grid grid-cols-4 border-b border-[var(--ui-border)] bg-[var(--ui-surface)] shrink-0">
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

      {/* v0.5.0 (integrator — simplification): one plain sentence saying what
          the open section is for. */}
      <div className="px-3 pt-2 text-[11px] text-[var(--ui-text-secondary)] shrink-0">
        {TAB_DESCRIPTIONS[currentTab]}
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
      <div className="p-4 space-y-5 text-xs">
        {/* TAB 1: TYPOGRAPHY & CHARACTER */}
        {currentTab === 'typography' && (
          <div className="space-y-4">
            <Hint>{t("כאן בוחרים איך נראות האותיות. שינוי כאן חל על כל הספר, אלא אם בחרתם מילה או פסקה בדף.")}</Hint>
            {/* Font Family — v0.5.0 Part A, Module 1(c): searchable dropdown
                merging built-in + system + imported fonts, with Import Fonts
                inside the dropdown. (Only this font-dropdown block changed.) */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)]">
                
                {t("גופן:")}
              </label>
              <FontDropdown
                value={charStyle.fontFamily}
                availableFonts={availableFonts}
                onChange={family =>
                  handleUpdateChar({ fontFamily: family }, tf('גופן {value}', { value: family }))
                }
              />
              {!fontStatus.isAvailable && t(fontStatus.warningHe ?? '') && (
                <p className="text-[10px] text-[var(--ui-warning)] mt-1">
                  {t(fontStatus.warningHe ?? '')}
                </p>
              )}
              {/* v0.8.0 Part E: the dropdown's per-row note only shows
                  while it is open — a persistent note under it so a scanned
                  font picked for export is flagged even after it closes. */}
              {isFontEmbeddableInPdf(charStyle.fontFamily) === false && (
                <p className="text-[10px] text-[var(--ui-warning)] mt-1">
                  {t('הגופן הזה הוא גופן מהמחשב (נסרק) — מוצג על המסך, אבל לא ניתן להטמיע אותו ב-PDF. העלה את קובץ ה-TTF/OTF שלו במנהל הגופנים, אחרת ייצוא ה-PDF ייכשל.')}
                </p>
              )}
            </div>

            {/* Font Size & Weight */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  
                  {t("גודל האותיות:")}
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
                      tf('גודל גופן {value}pt', { value: e.target.value })
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--ui-text-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  
                  {t("עובי האותיות:")}
                </label>
                <select
                  value={charStyle.fontWeight}
                  onChange={e => {
                    const w = Number(e.target.value);
                    handleUpdateChar(
                      { fontWeight: w, isBold: w >= 600 },
                      tf('משקל גופן {value}', { value: w })
                    );
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-primary)]"
                >
                  <option value={400}>{t("רגיל")}</option>
                  <option value={500}>{t("בינוני")}</option>
                  <option value={600}>{t("חצי-מודגש")}</option>
                  <option value={700}>{t("מודגש")}</option>
                </select>
              </div>
            </div>

            {/* Style Toggles: Bold, Italic, Underline */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1.5">
                
                {t("הדגשה וסגנון תו:")}
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() =>
                    handleUpdateChar(
                      {
                        isBold: !charStyle.isBold,
                        fontWeight: !charStyle.isBold ? 700 : 400,
                      },
                      !charStyle.isBold ? t("הדגשה (Bold)") : t("ביטול הדגשה")
                    )
                  }
                  className={`py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                    charStyle.isBold
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-bold'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  <Bold className="w-3.5 h-3.5" />
                  <span>{t("מודגש")}</span>
                </button>

                <button
                  onClick={() =>
                    handleUpdateChar(
                      {
                        isItalic: !charStyle.isItalic,
                        fontStyle: !charStyle.isItalic ? 'italic' : 'normal',
                      },
                      !charStyle.isItalic ? t("נטוי (Italic)") : t("ביטול נטוי")
                    )
                  }
                  className={`py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                    charStyle.isItalic
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-bold'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  <Italic className="w-3.5 h-3.5" />
                  <span>{t("נטוי")}</span>
                </button>

                <button
                  onClick={() =>
                    handleUpdateChar(
                      { isUnderline: !charStyle.isUnderline },
                      !charStyle.isUnderline ? t("קו תחתון") : t("ביטול קו תחתון")
                    )
                  }
                  className={`py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                    charStyle.isUnderline
                      ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)] font-bold'
                      : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  <Underline className="w-3.5 h-3.5" />
                  <span>{t("קו תחתון")}</span>
                </button>
              </div>
            </div>

            {/* Tracking & Word Spacing */}
            <div className="space-y-3 pt-2 border-t border-[var(--ui-border)]">
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    
                    {t("רווח בין האותיות:")}
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
                      tf('ריווח אותיות {value}em', { value: e.target.value })
                    )
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    
                    {t("רווח בין המילים:")}
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
                      tf('רווח מילים {value}%', { value: Math.round(Number(e.target.value) * 100) })
                    )
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    
                    {t("רוחב האותיות:")}
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
                      tf('רוחב אות {value}%', { value: e.target.value })
                    )
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>
            </div>

            {/* OpenType Hebrew Diacritics & Taamim Controls */}
            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                
                {t("ניקוד וטעמים:")}
              </div>
              <Hint>{t("האפשרויות האלה קובעות איך הניקוד והטעמים יושבים על האותיות. ברוב הספרים — הכול מסומן.")}</Hint>
              {(
                [
                  {
                    key: 'markPositioning',
                    label: t("ניקוד יושב בדיוק מעל האות"),
                  },
                  {
                    key: 'markToMark',
                    label: t("ניקוד וטעמים אחד על השני"),
                  },
                  {
                    key: 'ligatures',
                    label: t("חיבור אותיות (אל״ף-למ״ד)"),
                  },
                  {
                    key: 'kerning',
                    label: t("רווח נכון בין אותיות צמודות"),
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
            <Hint>{t("יישור ומרווחים קובעים איך הטקסט נראה בעמוד. ברוב הספרים מתאים יישור מלא ומרווח רגיל.")}</Hint>
            {/* Paragraph Alignment */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1.5">
                
                {t("יישור הפסקה:")}
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { id: 'justify', label: t("בלוק מלא"), icon: AlignJustify },
                    { id: 'right', label: t("ימין"), icon: AlignRight },
                    { id: 'center', label: t("מרכז"), icon: AlignCenter },
                    { id: 'left', label: t("שמאל"), icon: AlignLeft },
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
                          tf('יישור {label}', { label: item.label })
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
                
                {t("יישור שורה אחרונה בפסקה:")}
              </label>
              <select
                value={paraStyle.lastLineAlignment}
                onChange={e =>
                  handleUpdatePara(
                    {
                      lastLineAlignment: e.target
                        .value as DesignLastLineAlignment,
                    },
                    tf('שורה אחרונה: {value}', { value: e.target.value })
                  )
                }
                className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-primary)]"
              >
                <option value="right">{t("יישור לימין (מסורתי)")}</option>
                <option value="center">{t("מרכוז שורה אחרונה (סיום פרק)")}</option>
                <option value="justify">{t("יישור בלוק מלא")}</option>
              </select>
            </div>

            {/* Line Spacing Ratio & Space Before/After */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--ui-border)]">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  
                  {t("מרווח בין השורות:")}
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
                      tf('מרווח שורות {value}', { value: e.target.value })
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--ui-text-primary)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  
                  {t("מרווח אחרי הפסקה:")}
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
                      tf('מרווח אחרי פסקה {value}pt', { value: e.target.value })
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
                  
                  {t("כניסה של השורה הראשונה")}
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
                      tf('הזחת שורה ראשונה {value}pt', { value: e.target.value })
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-1">
                  
                  {t("רווח מימין")}
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
                      tf('כניסה מימין {value}pt', { value: e.target.value })
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-1">
                  
                  {t("רווח משמאל")}
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
                      tf('כניסה משמאל {value}pt', { value: e.target.value })
                    )
                  }
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                />
              </div>
            </div>

            {/* ── v0.5.0 Part B (Module 5): block margins & spacing ──
                ── v0.6.0 Part B: pt/mm/in unit selector, sliders for all
                four margins, and the genuine Auto-Center (a selected block
                is centred on its own page — see `handleAutoCenterBlock`). */}
            <div className="space-y-3 pt-2 border-t border-[var(--ui-border)]">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                  {t("שולי הפסקה ומרווחים:")}
                </div>
                <div
                  className="flex rounded-lg border border-[var(--ui-border)] overflow-hidden"
                  role="group"
                  aria-label={t("יחידת מידה לשוליים")}
                >
                  {(['pt', 'mm', 'in'] as MarginUnit[]).map(u => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setMarginUnit(u)}
                      className={`px-2 py-0.5 text-[11px] font-mono font-semibold transition-colors ${
                        marginUnit === u
                          ? 'bg-[var(--ui-accent)] text-white'
                          : 'bg-[var(--ui-surface-subtle)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                      }`}
                      aria-pressed={marginUnit === u}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <Hint>{t("השוליים מזיזים את הפסקה בתוך המסגרת: ימין/שמאל מצרים אותה מהצדדים, למעלה/למטה מוסיפים רווח מעל ומתחת. כל שינוי מופיע מיד בדף.")}</Hint>
              {(designSettings.layout.layoutType === 'rav_text' ||
                designSettings.layout.layoutType === 'mikraot_gedolot') && (
                <Hint>{t("בעימוד רב־טקסט, המרווח מעל/מתחת לפסקה נכנס לתוקף כשהפסקה פותחת עמוד — למשל אחרי חלוקת עמוד או מרכוז. שולי ימין/שמאל משפיעים תמיד.")}</Hint>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-1">
                    {t("שוליים מימין")} ({marginUnit})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={marginUnit === 'pt' ? 72 : DesignSettingsEngine.marginUnitStep(marginUnit).max}
                    step={DesignSettingsEngine.marginUnitStep(marginUnit).step}
                    value={DesignSettingsEngine.ptToMarginUnit(paraStyle.rightIndentPt, marginUnit)}
                    onChange={e =>
                      handleUpdateBlockSpacing({
                        marginRightPt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit),
                      })
                    }
                    className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-1">
                    {t("שוליים משמאל")} ({marginUnit})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={marginUnit === 'pt' ? 72 : DesignSettingsEngine.marginUnitStep(marginUnit).max}
                    step={DesignSettingsEngine.marginUnitStep(marginUnit).step}
                    value={DesignSettingsEngine.ptToMarginUnit(paraStyle.leftIndentPt, marginUnit)}
                    onChange={e =>
                      handleUpdateBlockSpacing({
                        marginLeftPt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit),
                      })
                    }
                    className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-1">
                    {t("שוליים למעלה")} ({marginUnit})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={marginUnit === 'pt' ? 48 : DesignSettingsEngine.marginUnitStep(marginUnit).max}
                    step={DesignSettingsEngine.marginUnitStep(marginUnit).step}
                    value={DesignSettingsEngine.ptToMarginUnit(paraStyle.spaceBeforePt, marginUnit)}
                    onChange={e =>
                      handleUpdateBlockSpacing({
                        marginTopPt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit),
                        spaceBeforePt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit),
                      })
                    }
                    className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-1">
                    {t("שוליים למטה")} ({marginUnit})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={marginUnit === 'pt' ? 48 : DesignSettingsEngine.marginUnitStep(marginUnit).max}
                    step={DesignSettingsEngine.marginUnitStep(marginUnit).step}
                    value={DesignSettingsEngine.ptToMarginUnit(paraStyle.spaceAfterPt, marginUnit)}
                    onChange={e =>
                      handleUpdateBlockSpacing({
                        marginBottomPt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit),
                        spaceAfterPt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit),
                      })
                    }
                    className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    {t("שוליים מימין:")}
                  </span>
                  <span className="font-mono text-[var(--ui-text-secondary)]">
                    {DesignSettingsEngine.ptToMarginUnit(paraStyle.rightIndentPt, marginUnit)}
                    {marginUnit}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={72}
                  step={1}
                  value={paraStyle.rightIndentPt}
                  onChange={e =>
                    handleUpdateBlockSpacing({ marginRightPt: Number(e.target.value) })
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    {t("שוליים משמאל:")}
                  </span>
                  <span className="font-mono text-[var(--ui-text-secondary)]">
                    {DesignSettingsEngine.ptToMarginUnit(paraStyle.leftIndentPt, marginUnit)}
                    {marginUnit}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={72}
                  step={1}
                  value={paraStyle.leftIndentPt}
                  onChange={e =>
                    handleUpdateBlockSpacing({ marginLeftPt: Number(e.target.value) })
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    {t("מרווח מעל הפסקה:")}
                  </span>
                  <span className="font-mono text-[var(--ui-text-secondary)]">
                    {DesignSettingsEngine.ptToMarginUnit(paraStyle.spaceBeforePt, marginUnit)}
                    {marginUnit}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={48}
                  step={0.5}
                  value={paraStyle.spaceBeforePt}
                  onChange={e =>
                    handleUpdateBlockSpacing({
                      marginTopPt: Number(e.target.value),
                      spaceBeforePt: Number(e.target.value),
                    })
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    {t("מרווח מתחת לפסקה:")}
                  </span>
                  <span className="font-mono text-[var(--ui-text-secondary)]">
                    {DesignSettingsEngine.ptToMarginUnit(paraStyle.spaceAfterPt, marginUnit)}
                    {marginUnit}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={48}
                  step={0.5}
                  value={paraStyle.spaceAfterPt}
                  onChange={e =>
                    handleUpdateBlockSpacing({
                      marginBottomPt: Number(e.target.value),
                      spaceAfterPt: Number(e.target.value),
                    })
                  }
                  className="w-full accent-[var(--ui-accent)]"
                />
              </div>

              <button
                onClick={handleAutoCenterBlock}
                className={`w-full py-2 px-3 rounded-lg border flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${
                  isBlockCentered
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-accent)] text-[var(--ui-accent)]'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)] hover:border-[var(--ui-accent)]/60'
                }`}
                title={
                  selectedUnit && onAutoCenterBlockGenuine
                    ? t("הפסקה הנבחרת תעבור לעמוד משלה ותמוקם במרכזו — שוליים שווים משני הצדדים ומרווח שווה מעל ומתחת")
                    : t("שוליים שווים משני הצדדים ומרווח שווה מעל ומתחת")
                }
              >
                <AlignCenter className="w-3.5 h-3.5" />
                {/* v0.9.2 Part B — one name for auto-center everywhere. */}
                <span>
                  {isBlockCentered
                    ? t("הפסקה ממורכזת")
                    : t("מרכוז אוטומטי")}
                </span>
              </button>
            </div>

            {/* Keep Options & Widow/Orphan Control */}
            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                
                {t("איך העמוד נשבר:")}
              </div>
              <Hint>{t("שורה בודדה שנשארת לבד בראש או בתחתית עמוד נראית לא טוב בדפוס — האפשרות הראשונה מונעת זאת.")}</Hint>
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("אל תשאיר שורה בודדת לבד בעמוד")}</span>
                <input
                  type="checkbox"
                  checked={paraStyle.preventWidows && paraStyle.preventOrphans}
                  onChange={e =>
                    handleUpdatePara(
                      {
                        preventWidows: e.target.checked,
                        preventOrphans: e.target.checked,
                      },
                      t("מניעת יתומים ואלמנות")
                    )
                  }
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("כותרת נשארת עם הפסקה שאחריה")}</span>
                <input
                  type="checkbox"
                  checked={paraStyle.keepWithNext}
                  onChange={e =>
                    handleUpdatePara(
                      { keepWithNext: e.target.checked },
                      t("שמירה עם פסקה הבאה")
                    )
                  }
                  className="accent-[var(--ui-accent)]"
                />
              </label>
            </div>

            {/* General-Sefer Separators & Opening Word Ornament */}
            <div className="space-y-2.5 pt-2 border-t border-[var(--ui-border)]">
              <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                {t("מפרידים ועיטור פתיחה בספר")}
              </div>
              <Hint>{t("מפרידים חזותיים בין פסקאות או קטעים ומסגרת למילת הפתיחה — זמינים לכל סוגי הספרים.")}</Hint>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  {t("מפריד בין פסקאות / קטעים:")}
                </label>
                <select
                  data-testid="paragraph-separator-select"
                  value={designSettings.ravText.paragraphSeparator?.styleId ?? 'none'}
                  onChange={e => {
                    const prev = designSettings.ravText.paragraphSeparator ?? DEFAULT_PARAGRAPH_SEPARATOR;
                    const next = DesignSettingsEngine.updateRavTextSettings(
                      designSettings,
                      { paragraphSeparator: { ...prev, styleId: e.target.value as SeparatorStyleId } },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t("מפריד פסקאות"));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-primary)]"
                >
                  <option value="none">{t("ללא מפריד")}</option>
                  <option value="colon">{t("נקודתיים (:)")}</option>
                  <option value="colon_dot">{t("נקודה ממורכזת (•)")}</option>
                  <option value="thin_rule">{t("קו דק ממורכז")}</option>
                  <option value="double_rule">{t("קו כפול עדין")}</option>
                  <option value="centered_diamond">{t("מעוין מסורתי (◆)")}</option>
                  <option value="scrolled_divider">{t("קו מעוטר")}</option>
                </select>
              </div>
              {(designSettings.ravText.paragraphSeparator?.styleId ?? 'none') !== 'none' && (
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span>{t("רוחב המפריד (%):")}</span>
                    <span className="font-mono">
                      {Math.round((designSettings.ravText.paragraphSeparator?.widthRatio ?? 0.35) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={90}
                    step={5}
                    value={Math.round((designSettings.ravText.paragraphSeparator?.widthRatio ?? 0.35) * 100)}
                    onChange={e => {
                      const prev = designSettings.ravText.paragraphSeparator ?? DEFAULT_PARAGRAPH_SEPARATOR;
                      const next = DesignSettingsEngine.updateRavTextSettings(
                        designSettings,
                        { paragraphSeparator: { ...prev, widthRatio: Number(e.target.value) / 100 } },
                        'user'
                      );
                      applyWithHardRuleGuard(next, t("רוחב מפריד פסקאות"));
                    }}
                    className="w-full accent-[var(--ui-accent)]"
                  />
                </div>
              )}
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("מסגרת למילת הפתיחה")}</span>
                <input
                  type="checkbox"
                  checked={designSettings.ravText.openingDecoration?.enabled ?? false}
                  onChange={e => {
                    const prev = designSettings.ravText.openingDecoration ?? DEFAULT_OPENING_DECORATION;
                    const next = DesignSettingsEngine.updateRavTextSettings(
                      designSettings,
                      { openingDecoration: { ...prev, enabled: e.target.checked } },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t("מסגרת מילת הפתיחה"));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>
            </div>
          </div>
        )}

        {/* TAB 3: PAGE GEOMETRY & MARGINS */}
        {currentTab === 'quick_tune' && (
          <div className="space-y-4" data-testid="quick-tune-panel">
            <Hint>{t("גודל דף, שוליים, גופנים וכותרת רצה — הכול במקום אחד.")}</Hint>

            {/* ── Group 1: Page Geometry ─────────────────────────────── */}
            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                {t("גאומטריית עמוד")}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  {t("גודל דף:")}
                </label>
                <select
                  data-testid="quick-tune-trim-size"
                  value={
                    (['trim_6x9', 'trim_7x10', 'trim_letter', 'vilna_folio'] as QuickTuneTrimId[]).includes(
                      designSettings.pageLayout.pageSizePreset as QuickTuneTrimId
                    )
                      ? designSettings.pageLayout.pageSizePreset
                      : '__other__'
                  }
                  onChange={e => {
                    const raw = e.target.value;
                    if (raw === '__other__') return;
                    const preset = raw as keyof typeof PAGE_SIZE_DIMENSIONS;
                    const dims = PAGE_SIZE_DIMENSIONS[preset];
                    const orientation = designSettings.pageLayout.orientation;
                    const w = dims ? dims.widthPt : designSettings.pageLayout.pageWidthPt;
                    const h = dims ? dims.heightPt : designSettings.pageLayout.pageHeightPt;
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      {
                        pageSizePreset: preset,
                        orientation,
                        pageWidthPt: orientation === 'landscape' ? Math.max(w, h) : Math.min(w, h),
                        pageHeightPt: orientation === 'landscape' ? Math.min(w, h) : Math.max(w, h),
                      },
                      'user',
                      tf('גודל דף {value}', { value: preset })
                    );
                    applyWithHardRuleGuard(res.settings, tf('גודל דף {value}', { value: preset }));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs"
                >
                  {(['trim_6x9', 'trim_7x10', 'trim_letter', 'vilna_folio'] as QuickTuneTrimId[]).map(
                    id => (
                      <option key={id} value={id}>
                        {lang === 'en' ? QUICK_TUNE_TRIM_LABELS[id].en : QUICK_TUNE_TRIM_LABELS[id].he}
                      </option>
                    )
                  )}
                  {!(['trim_6x9', 'trim_7x10', 'trim_letter', 'vilna_folio'] as string[]).includes(
                    designSettings.pageLayout.pageSizePreset
                  ) && (
                    <option value="__other__" disabled>
                      {PAGE_SIZE_OPTIONS.find(o => o.id === designSettings.pageLayout.pageSizePreset)
                        ? lang === 'en'
                          ? PAGE_SIZE_OPTIONS.find(o => o.id === designSettings.pageLayout.pageSizePreset)!.en
                          : PAGE_SIZE_OPTIONS.find(o => o.id === designSettings.pageLayout.pageSizePreset)!.he
                        : designSettings.pageLayout.pageSizePreset}
                    </option>
                  )}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['marginTopPt', 'שוליים למעלה:', 'Top margin:'],
                    ['marginBottomPt', 'שוליים למטה:', 'Bottom margin:'],
                    ['marginInsidePt', 'שוליים פנימיים:', 'Inside margin:'],
                    ['marginOutsidePt', 'שוליים חיצוניים:', 'Outside margin:'],
                  ] as Array<[keyof Pick<PageLayoutDesignSettings, 'marginTopPt' | 'marginBottomPt' | 'marginInsidePt' | 'marginOutsidePt'>, string, string]>
                ).map(([field, labelHe, labelEn]) => (
                  <div key={field}>
                    <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                      {lang === 'en' ? labelEn : t(labelHe)} (pt)
                    </label>
                    <input
                      type="number"
                      min={18}
                      max={140}
                      step={1}
                      data-testid={`quick-tune-${field}`}
                      value={designSettings.pageLayout[field]}
                      onChange={e => {
                        const res = DesignSettingsEngine.updatePageLayout(
                          designSettings,
                          { [field]: Number(e.target.value) },
                          'user'
                        );
                        applyWithHardRuleGuard(res.settings, lang === 'en' ? labelEn : t(labelHe));
                      }}
                      className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                ))}
              </div>
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("שוליים ממורכזים")}</span>
                <input
                  type="checkbox"
                  data-testid="quick-tune-mirror-margins"
                  checked={designSettings.pageLayout.mirrorMargins ?? true}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { mirrorMargins: e.target.checked },
                      'user',
                      'שוליים ממורכזים'
                    );
                    applyWithHardRuleGuard(res.settings, t("שוליים ממורכזים"));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>
              <p className="text-[10px] text-[var(--ui-text-secondary)]">
                {t("שוליים פנימיים וחיצוניים נפרדים; כבוי = שני הצדדים שווים לשוליים הפנימיים.")}
              </p>
            </div>

            {/* ── Group 2: Zone Typography ───────────────────────────── */}
            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                {t("טיפוגרפיה לפי אזור")}
              </div>
              {(['main_source', 'primary_comment', 'secondary_comment', 'footnote'] as QuickTuneZoneId[]).map(
                zone => {
                  const resolved = DesignSettingsEngine.resolveRoleAndUnitStyle(
                    designSettings,
                    zone
                  );
                  const label = lang === 'en' ? QUICK_TUNE_ZONE_LABELS[zone].en : QUICK_TUNE_ZONE_LABELS[zone].he;
                  return (
                    <div
                      key={zone}
                      data-testid={`quick-tune-zone-${zone}`}
                      className="rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] p-2 space-y-2"
                    >
                      <div className="text-[11px] font-semibold">{label}</div>
                      <div className="grid grid-cols-[1fr_64px_64px] gap-2 items-end">
                        <div>
                          <label className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                            {t("גופן:")}
                          </label>
                          <FontDropdown
                            value={resolved.character.fontFamily}
                            availableFonts={availableFonts}
                            onChange={family => {
                              const next = applyCharacterStyleChange(
                                designSettings,
                                { role: zone },
                                { fontFamily: family }
                              );
                              applyWithHardRuleGuard(next, tf('כוונון מהיר: {label}', { label }));
                            }}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                            {t("גודל (pt):")}
                          </label>
                          <input
                            type="number"
                            min={6}
                            max={36}
                            step={0.5}
                            value={resolved.character.fontSizePt}
                            onChange={e => {
                              const next = applyCharacterStyleChange(
                                designSettings,
                                { role: zone },
                                { fontSizePt: Number(e.target.value) }
                              );
                              applyWithHardRuleGuard(next, tf('כוונון מהיר: {label}', { label }));
                            }}
                            className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                            {t("מרווח שורות:")}
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={2.2}
                            step={0.02}
                            value={resolved.paragraph.lineSpacingRatio}
                            onChange={e => {
                              const ratio = Number(e.target.value);
                              const next = applyParagraphStyleChange(
                                designSettings,
                                { role: zone },
                                {
                                  lineSpacingRatio: ratio,
                                  leadingPt: Number(
                                    (resolved.character.fontSizePt * ratio).toFixed(2)
                                  ),
                                }
                              );
                              applyWithHardRuleGuard(next, tf('כוונון מהיר: {label}', { label }));
                            }}
                            className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  );
                }
              )}
              {/* Dibbur HaMatchil style — bold + size, same role writer. */}
              <div
                data-testid="quick-tune-zone-dibbur_hamatchil"
                className="rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] p-2 space-y-2"
              >
                <div className="text-[11px] font-semibold">{t("דיבור המתחיל")}</div>
                <div className="grid grid-cols-[1fr_64px] gap-2 items-end">
                  <label className="flex items-center justify-between p-1.5 rounded-lg bg-[var(--ui-surface)] border border-[var(--ui-border)] cursor-pointer text-[11px]">
                    <span>{t("מודגש")}</span>
                    <input
                      type="checkbox"
                      data-testid="quick-tune-dibbur-bold"
                      checked={
                        DesignSettingsEngine.resolveRoleAndUnitStyle(
                          designSettings,
                          'dibbur_hamatchil'
                        ).character.isBold
                      }
                      onChange={e => {
                        const next = applyCharacterStyleChange(
                          designSettings,
                          { role: 'dibbur_hamatchil' },
                          { isBold: e.target.checked }
                        );
                        applyWithHardRuleGuard(next, tf('כוונון מהיר: {label}', { label: t('דיבור המתחיל') }));
                      }}
                      className="accent-[var(--ui-accent)]"
                    />
                  </label>
                  <div>
                    <label className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                      {t("גודל (pt):")}
                    </label>
                    <input
                      type="number"
                      min={6}
                      max={36}
                      step={0.5}
                      value={
                        DesignSettingsEngine.resolveRoleAndUnitStyle(
                          designSettings,
                          'dibbur_hamatchil'
                        ).character.fontSizePt
                      }
                      onChange={e => {
                        const next = applyCharacterStyleChange(
                          designSettings,
                          { role: 'dibbur_hamatchil' },
                          { fontSizePt: Number(e.target.value) }
                        );
                        applyWithHardRuleGuard(next, tf('כוונון מהיר: {label}', { label: t('דיבור המתחיל') }));
                      }}
                      className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Group 3: Running Header / Koteret ──────────────────── */}
            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                {t("כותרת רצה")}
              </div>
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("הצג כותרת רצה בראש העמוד")}</span>
                <input
                  type="checkbox"
                  data-testid="quick-tune-header-enabled"
                  checked={
                    designSettings.pageElements.showTopHeaderLine ??
                    designSettings.pageElements.showRunningHeader ??
                    false
                  }
                  onChange={e => {
                    const next = DesignSettingsEngine.updatePageElementsSettings(
                      designSettings,
                      { showTopHeaderLine: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t('שורת כותרת עליונה'));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>
              {(designSettings.pageElements.showTopHeaderLine ??
                designSettings.pageElements.showRunningHeader ??
                false) && (
                <div className="space-y-2 ps-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                      {t("כותרת בעמוד הימני")}
                    </label>
                    <input
                      type="text"
                      data-testid="quick-tune-header-right"
                      value={designSettings.pageElements.runningHeader?.rightPageText ?? ''}
                      placeholder={bookTitle || ''}
                      onChange={e => {
                        const next = DesignSettingsEngine.updatePageElementsSettings(
                          designSettings,
                          { runningHeader: { rightPageText: e.target.value } },
                          'user'
                        );
                        applyWithHardRuleGuard(next, t("כותרת בעמוד הימני"));
                      }}
                      className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                      {t("כותרת בעמוד השמאלי")}
                    </label>
                    <input
                      type="text"
                      data-testid="quick-tune-header-left"
                      value={designSettings.pageElements.runningHeader?.leftPageText ?? ''}
                      onChange={e => {
                        const next = DesignSettingsEngine.updatePageElementsSettings(
                          designSettings,
                          { runningHeader: { leftPageText: e.target.value } },
                          'user'
                        );
                        applyWithHardRuleGuard(next, t("כותרת בעמוד השמאלי"));
                      }}
                      className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs"
                    />
                    <p className="text-[10px] text-[var(--ui-text-secondary)] mt-0.5">
                      {t("ריק = כותרת הספר; פרק / דף / פרשה בעמוד השמאלי.")}
                    </p>
                  </div>
                  <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                    <span>{t("קו מפריד מתחת לכותרת")}</span>
                    <input
                      type="checkbox"
                      data-testid="quick-tune-header-divider"
                      checked={designSettings.pageElements.showHeaderDividerRule ?? true}
                      onChange={e => {
                        const next = DesignSettingsEngine.updatePageElementsSettings(
                          designSettings,
                          { showHeaderDividerRule: e.target.checked },
                          'user'
                        );
                        applyWithHardRuleGuard(next, t("קו מפריד מתחת לכותרת"));
                      }}
                      className="accent-[var(--ui-accent)]"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {currentTab === 'page_geometry' && (
          <div className="space-y-4">
            {/* Layout training T5 — the kind of sefer decides which
                type-specific rules apply (daf folios, Vilna head, masechta
                frame, גמ׳, marginal apparatus are Talmud only). */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                {t("סוג הספר:")}
              </label>
              <select
                data-testid="sefer-type-select"
                value={designSettings.pageLayout.seferType ?? (designSettings.layout.layoutType === 'rav_text' ? 'talmud' : '')}
                onChange={e => {
                  const v = e.target.value as SeferType;
                  if (!v) return;
                  applyWithHardRuleGuard(DesignSettingsEngine.applySeferType(designSettings, v), t("סוג הספר עודכן"));
                }}
                className="w-full px-2 py-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[12px]"
              >
                {!designSettings.pageLayout.seferType && designSettings.layout.layoutType !== 'rav_text' && <option value="">{t("—")}</option>}
                {(Object.keys(SEFER_TYPE_LABELS) as SeferType[]).map(k => (
                  <option key={k} value={k}>
                    {lang === 'en' ? SEFER_TYPE_LABELS[k].en : SEFER_TYPE_LABELS[k].he}
                  </option>
                ))}
              </select>
              <Hint>{t("כל סוג ספר מקבל רק את הכללים שלו: מספור דף ועמוד, כותרת וילנא, מסגרת פתיחה, גמ׳ ועמודות עין משפט — רק בגמרא.")}</Hint>
            </div>
            <Hint>{t("השוליים הם הרווח הלבן מסביב לטקסט. שוליים קטנים יותר = יותר טקסט בכל עמוד.")}</Hint>
            {/* v0.4.0 — checklist §2: named page-size presets (Pocket … Gemara). */}
            <div>
              <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                {t("גודל דף מוכן:")}
              </label>
              <select
                value={designSettings.pageLayout.pageSizePreset}
                onChange={e => {
                  const preset = e.target.value as keyof typeof PAGE_SIZE_DIMENSIONS;
                  const dims = PAGE_SIZE_DIMENSIONS[preset];
                  const orientation = designSettings.pageLayout.orientation;
                  const w = dims ? dims.widthPt : designSettings.pageLayout.pageWidthPt;
                  const h = dims ? dims.heightPt : designSettings.pageLayout.pageHeightPt;
                  const res = DesignSettingsEngine.updatePageLayout(
                    designSettings,
                    {
                      pageSizePreset: preset,
                      orientation,
                      pageWidthPt: orientation === 'landscape' ? Math.max(w, h) : Math.min(w, h),
                      pageHeightPt: orientation === 'landscape' ? Math.min(w, h) : Math.max(w, h),
                    },
                    'user',
                    tf('גודל דף {value}', { value: preset })
                  );
                  applyWithHardRuleGuard(res.settings, tf('גודל דף {value}', { value: preset }));
                }}
                className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs"
              >
                {PAGE_SIZE_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {lang === 'en' ? opt.en : opt.he}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  
                  {t("רוחב העמוד:")}
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
                      tf('רוחב עמוד {value}pt', { value: e.target.value })
                    );
                    applyWithHardRuleGuard(res.settings, tf('רוחב עמוד {value}pt', { value: e.target.value }));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  
                  {t("גובה העמוד:")}
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
                      tf('גובה עמוד {value}pt', { value: e.target.value })
                    );
                    applyWithHardRuleGuard(res.settings, tf('גובה עמוד {value}pt', { value: e.target.value }));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            {/* v0.6.0 Part B: page-frame margins in the same unit (pt/mm/in)
                as the paragraph margins above, with sliders as well as
                number fields. Values are stored in points. */}
            <div className="pt-2 border-t border-[var(--ui-border)]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                  {t("שולי העמוד:")}
                </div>
                <div
                  className="flex rounded-lg border border-[var(--ui-border)] overflow-hidden"
                  role="group"
                  aria-label={t("יחידת מידה לשוליים")}
                >
                  {(['pt', 'mm', 'in'] as MarginUnit[]).map(u => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setMarginUnit(u)}
                      className={`px-2 py-0.5 text-[11px] font-mono font-semibold transition-colors ${
                        marginUnit === u
                          ? 'bg-[var(--ui-accent)] text-white'
                          : 'bg-[var(--ui-surface-subtle)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                      }`}
                      aria-pressed={marginUnit === u}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  {t("שוליים למעלה:")} ({marginUnit})
                </label>
                <input
                  type="number"
                  min={marginUnit === 'pt' ? 20 : 0}
                  max={marginUnit === 'pt' ? 140 : DesignSettingsEngine.marginUnitStep(marginUnit).max * 2}
                  step={DesignSettingsEngine.marginUnitStep(marginUnit).step}
                  value={DesignSettingsEngine.ptToMarginUnit(designSettings.pageLayout.marginTopPt, marginUnit)}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { marginTopPt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit) },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, t("שוליים עליונים"));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  {t("שוליים למטה:")} ({marginUnit})
                </label>
                <input
                  type="number"
                  min={marginUnit === 'pt' ? 20 : 0}
                  max={marginUnit === 'pt' ? 140 : DesignSettingsEngine.marginUnitStep(marginUnit).max * 2}
                  step={DesignSettingsEngine.marginUnitStep(marginUnit).step}
                  value={DesignSettingsEngine.ptToMarginUnit(designSettings.pageLayout.marginBottomPt, marginUnit)}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { marginBottomPt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit) },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, t("שוליים תחתונים"));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  {t("שוליים פנימיים:")} ({marginUnit})
                </label>
                <input
                  type="number"
                  min={marginUnit === 'pt' ? 20 : 0}
                  max={marginUnit === 'pt' ? 120 : DesignSettingsEngine.marginUnitStep(marginUnit).max * 2}
                  step={DesignSettingsEngine.marginUnitStep(marginUnit).step}
                  value={DesignSettingsEngine.ptToMarginUnit(designSettings.pageLayout.marginInsidePt, marginUnit)}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { marginInsidePt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit) },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, t("שוליים פנימיים"));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  {t("שוליים חיצוניים:")} ({marginUnit})
                </label>
                <input
                  type="number"
                  min={marginUnit === 'pt' ? 20 : 0}
                  max={marginUnit === 'pt' ? 120 : DesignSettingsEngine.marginUnitStep(marginUnit).max * 2}
                  step={DesignSettingsEngine.marginUnitStep(marginUnit).step}
                  value={DesignSettingsEngine.ptToMarginUnit(designSettings.pageLayout.marginOutsidePt, marginUnit)}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { marginOutsidePt: DesignSettingsEngine.marginUnitToPt(Number(e.target.value), marginUnit) },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, t("שוליים חיצוניים"));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              {(
                [
                  ['top', t("שוליים למעלה:"), designSettings.pageLayout.marginTopPt, 140, 'marginTopPt'],
                  ['bottom', t("שוליים למטה:"), designSettings.pageLayout.marginBottomPt, 140, 'marginBottomPt'],
                  ['inside', t("שוליים פנימיים:"), designSettings.pageLayout.marginInsidePt, 120, 'marginInsidePt'],
                  ['outside', t("שוליים חיצוניים:"), designSettings.pageLayout.marginOutsidePt, 120, 'marginOutsidePt'],
                ] as Array<[string, string, number, number, 'marginTopPt' | 'marginBottomPt' | 'marginInsidePt' | 'marginOutsidePt']>
              ).map(([key, label, valuePt, maxPt, field]) => (
                <div key={key}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="font-semibold text-[var(--ui-text-primary)]">{label}</span>
                    <span className="font-mono text-[var(--ui-text-secondary)]">
                      {DesignSettingsEngine.ptToMarginUnit(valuePt, marginUnit)}
                      {marginUnit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={maxPt}
                    step={1}
                    value={valuePt}
                    onChange={e => {
                      const patch: Partial<PageLayoutDesignSettings> = {
                        [field]: Number(e.target.value),
                      };
                      const res = DesignSettingsEngine.updatePageLayout(
                        designSettings,
                        patch,
                        'user'
                      );
                      applyWithHardRuleGuard(res.settings, label);
                    }}
                    className="w-full accent-[var(--ui-accent)]"
                  />
                </div>
              ))}
            </div>

            {/* v0.9.7 Part 4 — Column gap (Gutter): a RECIPE setting
                made general. Recipes carry page.gutterMm, applied as
                pageLayout.columnGutterPt; the paginator reads it (via
                the sanitizer's columns.columnGapPt heal) for two-column
                books and for the bottom commentary split of
                source-top books — but until now no Design control
                edited it on ANY layout. Sensible default comes from the
                current layout (16pt two-column, 14pt otherwise — see
                the defaults in design-settings-engine.ts). On a
                single-column book the gap has no second column to
                separate, so the slider is live but visibly a no-op
                there — the hint says so rather than disabling it
                silently. */}
            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    {t("מרווח בין טורים (Gutter):")}
                  </span>
                  <span className="font-mono" data-testid="design-column-gap-value">
                    {designSettings.pageLayout.columnGutterPt ?? 16} pt
                  </span>
                </div>
                <input
                  type="range"
                  min={6}
                  max={48}
                  step={1}
                  data-testid="design-column-gap"
                  value={designSettings.pageLayout.columnGutterPt ?? 16}
                  onChange={e => {
                    const res = DesignSettingsEngine.updatePageLayout(
                      designSettings,
                      { columnGutterPt: Number(e.target.value) },
                      'user',
                      t("מרווח בין טורים (Gutter)")
                    );
                    applyWithHardRuleGuard(res.settings, t("מרווח בין טורים (Gutter)"));
                  }}
                  className="w-full accent-[var(--ui-accent)]"
                />
                <p className="text-[10px] leading-relaxed text-[var(--ui-text-secondary)]">
                  {t("משפיע על עימוד דו-טורי ועל מפרשי התחתית בעימוד מקור-עליון. בטור יחיד אין טור שני; בש״ס וילנא המרווח נשלט מהכרטיסייה ״גמרא ומפרשים״.")}
                </p>
              </div>
            </div>

            {/* ── v0.5.0 Part B (Module 5): centre the text frame ── */}
            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <Hint>{t("מרכוז המסגרת משווה בין השוליים העליונים והתחתונים, ובין הפנימיים והחיצוניים — כך מסגרת הטקסט יושבת במרכז הדף.")}</Hint>
              <button
                onClick={() => {
                  const res = DesignSettingsEngine.autoCenterPageFrame(designSettings, 'user');
                  applyWithHardRuleGuard(res.settings, t('מרכוז מסגרת הטקסט בעמוד'));
                }}
                className="w-full py-2 px-3 rounded-lg border border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)] hover:bg-[var(--ui-accent)] hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                title={t("שוליים עליונים = תחתונים, פנימיים = חיצוניים")}
              >
                <AlignCenter className="w-3.5 h-3.5" />
                <span>{t("מרכז את מסגרת הטקסט בעמוד")}</span>
              </button>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              {/* ── v0.5.0 Part B (Module 6): top header line toggle ── */}
              <Hint>{t("שורת הכותרת העליונה מוסתרת כברירת מחדל. הפעלה מציגה אותה בראש כל עמוד; כיבוי מעלים אותה והרווח נסגר. מספר הדף נשלט בנפרד בתיבה הבאה.")}</Hint>
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("הצג שורת כותרת עליונה")}</span>
                <input
                  type="checkbox"
                  checked={
                    designSettings.pageElements.showTopHeaderLine ??
                    designSettings.pageElements.showRunningHeader ??
                    false
                  }
                  onChange={e => {
                    const next = DesignSettingsEngine.updatePageElementsSettings(
                      designSettings,
                      { showTopHeaderLine: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t('שורת כותרת עליונה'));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              {/* ── v0.6.0 Part A (§5): editable running-header text ── */}
              {/* Shown only while the line is on. Three editable slots
                  (right = folio, centre = book title, left = chapter /
                  edition label), each with its own toggle; empty text =
                  automatic. Alignment / font / size apply to the header
                  text. Per-folio overrides edit only the open page. */}
              {(designSettings.pageElements.showTopHeaderLine ??
                designSettings.pageElements.showRunningHeader ??
                false) && (
                <div className="space-y-2 ps-3 pe-1 pt-1">
                  <Hint>
                    {t(
                      'שדה ריק = אוטומטי: באמצע שם הספר, מימין מספר העמוד, משמאל תווית המהדורה. כשהשורה דולקת הטקסט יורד מעט למטה; כשהיא כבויה הוא חוזר למעלה והרווח נסגר.'
                    )}
                  </Hint>
                  {(
                    [
                      {
                        key: 'rightText' as const,
                        labelHe: 'טקסט מימין — מספר העמוד',
                        labelEn: 'Right text — page number',
                        placeholderHe: 'אוטומטי: מספר העמוד',
                        placeholderEn: 'Automatic: page number',
                      },
                      {
                        key: 'centerText' as const,
                        labelHe: 'טקסט באמצע — שם הספר',
                        labelEn: 'Middle text — book name',
                        placeholderHe: bookTitle || 'אוטומטי: שם הספר',
                        placeholderEn: bookTitle || 'Automatic: book name',
                      },
                      {
                        key: 'leftText' as const,
                        labelHe: 'טקסט משמאל — כותרת פרק / מהדורה',
                        labelEn: 'Left text — chapter / edition title',
                        placeholderHe: 'אוטומטי: תווית המהדורה',
                        placeholderEn: 'Automatic: edition label',
                      },
                    ] as const
                  ).map(field => {
                    const rh =
                      designSettings.pageElements.runningHeader ??
                      DEFAULT_RUNNING_HEADER_SETTINGS;
                    return (
                      <label key={field.key} className="block">
                        <span className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-0.5">
                          {lang === 'en' ? field.labelEn : t(field.labelHe)}
                        </span>
                        <input
                          type="text"
                          value={rh[field.key]}
                          placeholder={lang === 'en' ? field.placeholderEn : t(field.placeholderHe)}
                          onChange={e => {
                            const next = DesignSettingsEngine.updatePageElementsSettings(
                              designSettings,
                              { runningHeader: { [field.key]: e.target.value } },
                              'user'
                            );
                            applyWithHardRuleGuard(next, t('טקסט כותרת עליונה'));
                          }}
                          className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2.5 py-1 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                        />
                      </label>
                    );
                  })}

                  {/* Granular visibility: book title / chapter title / page number */}
                  {(
                    [
                      {
                        key: 'showBookTitle' as const,
                        labelHe: 'הצג שם ספר בכותרת',
                        labelEn: 'Show the book name in the header',
                      },
                      {
                        key: 'showChapterTitle' as const,
                        labelHe: 'הצג כותרת פרק / מהדורה בכותרת',
                        labelEn: 'Show the chapter / edition title in the header',
                      },
                      {
                        key: 'showPageNumber' as const,
                        labelHe: 'הצג מספר עמוד בכותרת',
                        labelEn: 'Show the page number in the header',
                      },
                    ] as const
                  ).map(toggle => {
                    const rh =
                      designSettings.pageElements.runningHeader ??
                      DEFAULT_RUNNING_HEADER_SETTINGS;
                    return (
                      <label
                        key={toggle.key}
                        className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer"
                      >
                        <span>{lang === 'en' ? toggle.labelEn : t(toggle.labelHe)}</span>
                        <input
                          type="checkbox"
                          checked={rh[toggle.key]}
                          onChange={e => {
                            const next = DesignSettingsEngine.updatePageElementsSettings(
                              designSettings,
                              { runningHeader: { [toggle.key]: e.target.checked } },
                              'user'
                            );
                            applyWithHardRuleGuard(next, t('כותרת עליונה'));
                          }}
                          className="accent-[var(--ui-accent)]"
                        />
                      </label>
                    );
                  })}

                  {/* Alignment */}
                  <div>
                    <span className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-0.5">
                      {t('יישור הכותרת')}
                    </span>
                    <div className="grid grid-cols-3 gap-1 bg-[var(--ui-surface)] p-0.5 rounded-lg border border-[var(--ui-border)]">
                      {(
                        [
                          { id: 'right' as const, labelHe: 'ימין', labelEn: 'Right' },
                          { id: 'center' as const, labelHe: 'מרכז', labelEn: 'Center' },
                          { id: 'left' as const, labelHe: 'שמאל', labelEn: 'Left' },
                        ] as const
                      ).map(opt => {
                        const rh =
                          designSettings.pageElements.runningHeader ??
                          DEFAULT_RUNNING_HEADER_SETTINGS;
                        const active = rh.alignment === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              const next = DesignSettingsEngine.updatePageElementsSettings(
                                designSettings,
                                { runningHeader: { alignment: opt.id } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t('יישור כותרת עליונה'));
                            }}
                            className={`py-1 px-1.5 rounded-md text-[10px] font-medium transition-all ${
                              active
                                ? 'bg-[var(--ui-accent)] text-white shadow-2xs font-semibold'
                                : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                            }`}
                          >
                            {lang === 'en' ? opt.labelEn : t(opt.labelHe)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Font + size */}
                  <div className="space-y-1.5">
                    <span className="block text-[11px] font-semibold text-[var(--ui-text-primary)]">
                      {t('גופן הכותרת')}
                    </span>
                    <FontDropdown
                      value={
                        designSettings.pageElements.runningHeader?.fontFamily ||
                        designSettings.roleStyles?.main_source?.character?.fontFamily ||
                        'Frank Ruhl Libre'
                      }
                      availableFonts={availableFonts}
                      onChange={family => {
                        const next = DesignSettingsEngine.updatePageElementsSettings(
                          designSettings,
                          { runningHeader: { fontFamily: family } },
                          'user'
                        );
                        applyWithHardRuleGuard(next, t('גופן כותרת עליונה'));
                      }}
                    />
                    <label className="flex items-center justify-between gap-2 text-[11px]">
                      <span>{t('גודל הכותרת (pt)')}</span>
                      <input
                        type="number"
                        min={8}
                        max={24}
                        step={0.5}
                        value={
                          designSettings.pageElements.runningHeader?.fontSizePt ??
                          DEFAULT_RUNNING_HEADER_SETTINGS.fontSizePt
                        }
                        onChange={e => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const next = DesignSettingsEngine.updatePageElementsSettings(
                            designSettings,
                            { runningHeader: { fontSizePt: v } },
                            'user'
                          );
                          applyWithHardRuleGuard(next, t('גודל כותרת עליונה'));
                        }}
                        className="w-20 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs font-mono text-[var(--ui-text-primary)]"
                      />
                    </label>
                  </div>

                  {/* Structured Vilna Running Header (Masechet / Perek / Chapter) */}
                  <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
                    <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                      <span className="font-semibold text-[11px]">{t("כותרת רצה מובנית בסגנון ש״ס וילנא")}</span>
                      <input
                        type="checkbox"
                        data-testid="structured-vilna-header-toggle"
                        checked={designSettings.pageElements.runningHeader?.useStructuredVilnaHeader ?? false}
                        onChange={e => {
                          const next = DesignSettingsEngine.updatePageElementsSettings(
                            designSettings,
                            { runningHeader: { useStructuredVilnaHeader: e.target.checked } },
                            'user'
                          );
                          applyWithHardRuleGuard(next, t("כותרת וילנא מובנית"));
                        }}
                        className="accent-[var(--ui-accent)]"
                      />
                    </label>
                    {(designSettings.pageElements.runningHeader?.useStructuredVilnaHeader ?? false) && (
                      <div className="space-y-1.5 ps-1">
                        <Hint>{t("שדות ריקים = אוטומטי: שם הפרק ומספרו מזוהים מהטקסט בכל עמוד (כולל הדרן עלך), שם המסכת מכותרת \"מסכת …\", ומספר הדף בצד החיצוני.")}</Hint>
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("שם המסכת / הספר בכותרת:")}
                          </label>
                          <input
                            type="text"
                            data-testid="structured-header-masechet"
                            value={designSettings.pageElements.runningHeader?.masechetName ?? ''}
                            placeholder={t("למשל: חגיגה / ברכות")}
                            onChange={e => {
                              const next = DesignSettingsEngine.updatePageElementsSettings(
                                designSettings,
                                { runningHeader: { masechetName: e.target.value } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("שם מסכת בכותרת"));
                            }}
                            className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2.5 py-1 text-xs"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                              {t("מספר פרק:")}
                            </label>
                            <input
                              type="text"
                              data-testid="structured-header-perek-num"
                              value={designSettings.pageElements.runningHeader?.perekNumberText ?? ''}
                              placeholder={t("פרק ראשון")}
                              onChange={e => {
                                const next = DesignSettingsEngine.updatePageElementsSettings(
                                  designSettings,
                                  { runningHeader: { perekNumberText: e.target.value } },
                                  'user'
                                );
                                applyWithHardRuleGuard(next, t("מספר פרק בכותרת"));
                              }}
                              className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                              {t("שם הפרק:")}
                            </label>
                            <input
                              type="text"
                              data-testid="structured-header-perek-title"
                              value={designSettings.pageElements.runningHeader?.perekTitleText ?? ''}
                              placeholder={t("הכל חייבין / מאימתי")}
                              onChange={e => {
                                const next = DesignSettingsEngine.updatePageElementsSettings(
                                  designSettings,
                                  { runningHeader: { perekTitleText: e.target.value } },
                                  'user'
                                );
                                applyWithHardRuleGuard(next, t("שם פרק בכותרת"));
                              }}
                              className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Per-folio override: this page only */}
                  <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-[var(--ui-text-primary)]">
                        {t('עמוד זה בלבד')}
                      </span>
                      <span className="text-[10px] text-[var(--ui-text-secondary)]">
                        {t('דף')} {currentPageIndex + 1}
                      </span>
                    </div>
                    <Hint>
                      {t('שינוי כאן חל רק על העמוד הפתוח. שדה ריק = הטקסט הכללי של הספר.')}
                    </Hint>
                    {(
                      [
                        { key: 'rightText' as const, labelHe: 'טקסט מימין בעמוד זה', labelEn: 'Right text on this page' },
                        { key: 'centerText' as const, labelHe: 'טקסט באמצע בעמוד זה', labelEn: 'Middle text on this page' },
                        { key: 'leftText' as const, labelHe: 'טקסט משמאל בעמוד זה', labelEn: 'Left text on this page' },
                      ] as const
                    ).map(field => {
                      const override =
                        designSettings.pageElements.runningHeaderOverrides?.[
                          String(currentPageIndex)
                        ];
                      return (
                        <label key={field.key} className="block">
                          <span className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-0.5">
                            {lang === 'en' ? field.labelEn : t(field.labelHe)}
                          </span>
                          <input
                            type="text"
                            value={override?.[field.key] ?? ''}
                            placeholder={t('ריק = הטקסט הכללי')}
                            onChange={e => {
                              const next = DesignSettingsEngine.updatePageElementsSettings(
                                designSettings,
                                {
                                  runningHeaderOverride: {
                                    pageIndex: currentPageIndex,
                                    override: {
                                      ...(override ?? {}),
                                      [field.key]: e.target.value,
                                    },
                                  },
                                },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t('כותרת עליונה לעמוד זה'));
                            }}
                            className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2.5 py-1 text-xs text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
                          />
                        </label>
                      );
                    })}
                    {designSettings.pageElements.runningHeaderOverrides?.[
                      String(currentPageIndex)
                    ] && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = DesignSettingsEngine.updatePageElementsSettings(
                            designSettings,
                            {
                              runningHeaderOverride: {
                                pageIndex: currentPageIndex,
                                override: null,
                              },
                            },
                            'user'
                          );
                          applyWithHardRuleGuard(next, t('ביטול כותרת עליונה לעמוד זה'));
                        }}
                        className="text-[10px] text-[var(--ui-text-secondary)] hover:text-[var(--ui-accent)] underline font-semibold"
                      >
                        {t('בטל את השינוי לעמוד זה')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* v0.5.0 (integrator — simplification): the old "show running
                  header" checkbox was removed — it did exactly the same as
                  the "Show Top Header Line" toggle above (the engine keeps
                  the two flags in sync), so the toggle above is the one
                  place to turn the line on/off. Nothing was removed as a
                  feature, only the duplicate control. */}

              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("הצג מספרי עמודים")}</span>
                <input
                  type="checkbox"
                  checked={designSettings.pageElements.showFolioNumber}
                  onChange={e => {
                    const next = DesignSettingsEngine.updatePageElementsSettings(
                      designSettings,
                      { showFolioNumber: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t("מספור דף עברי"));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              {/* v0.5.0 (integrator — user request): page-number format, shown
                  only when page numbers are on. */}
              {designSettings.pageElements.showFolioNumber && (
                <div className="space-y-2 ps-3 pe-1">
                  <label className="flex items-center justify-between gap-2 text-[11px]">
                    <span>{t("סגנון מספר העמוד")}</span>
                    <select
                      value={designSettings.pageElements.pageNumberStyle ?? 'hebrew'}
                      onChange={e => {
                        const next = DesignSettingsEngine.updatePageElementsSettings(
                          designSettings,
                          { pageNumberStyle: e.target.value as 'numbers' | 'hebrew' },
                          'user'
                        );
                        applyWithHardRuleGuard(next, t('סגנון מספר העמוד'));
                      }}
                      className="bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs"
                    >
                      <option value="numbers">{t("מספרים רגילים (1, 2, 3)")}</option>
                      <option value="hebrew">{t("אותיות עבריות (א, ב, ג)")}</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                    <span>{t("הצג ׳דף׳ לפני המספר")}</span>
                    <input
                      type="checkbox"
                      checked={designSettings.pageElements.showDafPrefix ?? true}
                      onChange={e => {
                        const next = DesignSettingsEngine.updatePageElementsSettings(
                          designSettings,
                          { showDafPrefix: e.target.checked },
                          'user'
                        );
                        applyWithHardRuleGuard(next, t("הצג ׳דף׳ לפני המספר"));
                      }}
                      className="accent-[var(--ui-accent)]"
                    />
                  </label>

                  {/* Folio / Daf & Amud Numbering Controls */}
                  {(() => {
                    const fn = designSettings.pageElements.folioNumbering ?? DEFAULT_FOLIO_NUMBERING;
                    return (
                      <div className="space-y-2 p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
                        <label className="block">
                          <span className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                            {t("פורמט דף ועמוד:")}
                          </span>
                          <select
                            data-testid="folio-daf-format-select"
                            value={fn.dafFormat}
                            onChange={e => {
                              const next = DesignSettingsEngine.updatePageElementsSettings(
                                designSettings,
                                { folioNumbering: { ...fn, dafFormat: e.target.value as DafFormatMode } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("פורמט דף ועמוד"));
                            }}
                            className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                          >
                            <option value="dots">{t("וילנא מסורתי עם נקודות (ב. / ב:)")}</option>
                            <option value="amud_hebrew">{t("דף ועמוד מפורש (ב ע״א / ב ע״ב)")}</option>
                            <option value="gematria">{t("גימטריה עמודית (ב׳ / ג׳)")}</option>
                            <option value="numbers">{t("מספור לועזי רציף (2a / 2b)")}</option>
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                              {t("דף פתיחה:")}
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={999}
                              data-testid="folio-start-daf-input"
                              value={fn.startDaf}
                              onChange={e => {
                                const val = Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 2)));
                                const next = DesignSettingsEngine.updatePageElementsSettings(
                                  designSettings,
                                  { folioNumbering: { ...fn, startDaf: val } },
                                  'user'
                                );
                                applyWithHardRuleGuard(next, t("דף פתיחה"));
                              }}
                              className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs font-mono"
                            />
                          </label>
                          <label className="block">
                            <span className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                              {t("עמוד פתיחה:")}
                            </span>
                            <select
                              data-testid="folio-start-amud-select"
                              value={fn.startAmud}
                              onChange={e => {
                                const next = DesignSettingsEngine.updatePageElementsSettings(
                                  designSettings,
                                  { folioNumbering: { ...fn, startAmud: e.target.value as 'a' | 'b' } },
                                  'user'
                                );
                                applyWithHardRuleGuard(next, t("עמוד פתיחה"));
                              }}
                              className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                            >
                              <option value="a">{t("ע״א (.)")}</option>
                              <option value="b">{t("ע״ב (:)")}</option>
                            </select>
                          </label>
                        </div>
                        <label className="flex items-center justify-between text-[11px] cursor-pointer pt-0.5">
                          <span>{t("אל תספור עמודי שער ותוכן עניינים")}</span>
                          <input
                            type="checkbox"
                            checked={fn.excludeFrontMatter}
                            onChange={e => {
                              const next = DesignSettingsEngine.updatePageElementsSettings(
                                designSettings,
                                { folioNumbering: { ...fn, excludeFrontMatter: e.target.checked } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("שער מחוץ לספירה"));
                            }}
                            className="accent-[var(--ui-accent)]"
                          />
                        </label>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* v0.5.0 (integrator — user request): commentary tier labels
                  (Rashi / Tosafot …) above the columns — off by default. */}
              <Hint>{t("תוויות הפירוש מוסתרות כברירת מחדל. הפעלה מציגה את שם הפירוש (רש״י, תוספות וכד׳) מעל כל טור פירוש.")}</Hint>
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("הצג תוויות פירוש")}</span>
                <input
                  type="checkbox"
                  checked={designSettings.pageElements.showCommentaryLabels ?? true}
                  onChange={e => {
                    const next = DesignSettingsEngine.updatePageElementsSettings(
                      designSettings,
                      { showCommentaryLabels: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t('תוויות פירוש'));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>
            </div>

            {/* v0.3.0 (Module C) — Per-tier width / font / size (multi-tier layouts only) */}
            {isMultiTier && tiers.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                  <span className="text-[11px] font-bold text-[var(--ui-text-primary)]">
                    {t("שכבות טקסט בעמוד")}
                  </span>
                  <span className="text-[10px] text-[var(--ui-text-secondary)]">
                    {t("רוחב, גופן וגודל לכל שכבה")}
                  </span>
                </div>
                {(() => {
                  // v0.8.0 Part C (§2): tiers 5–7 share the tertiary band
                  // with tier 4 — only tier 4's size/leading/font drive
                  // the band. The duplicates render as read-only labels.
                  const tertiaryIndexes = tiers
                    .filter(t => t.role === 'tertiary_comment')
                    .map(t => t.tierIndex);
                  const firstTertiaryIndex =
                    tertiaryIndexes.length > 0 ? Math.min(...tertiaryIndexes) : -1;
                  return tiers.map(tier => {
                    const tierLabel =
                      (lang === 'en' ? tier.labelEn : tier.labelHe) ??
                      getSemanticRoleLabel(tier.role, lang);
                    const isDuplicateTertiary =
                      tier.role === 'tertiary_comment' &&
                      tier.tierIndex !== firstTertiaryIndex;
                    if (isDuplicateTertiary) {
                      return (
                        <div
                          key={tier.tierIndex}
                          className="p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] space-y-1"
                        >
                          <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                            {tier.tierIndex}. {tierLabel}
                          </div>
                          <p className="text-[10px] text-[var(--ui-text-secondary)] leading-snug">
                            {t("משתף את רצועת הפירושים המשניים עם שכבה 4; הגודל, המרווח והגופן של הרצועה נקבעים שם.")}
                          </p>
                        </div>
                      );
                    }
                    // v0.8.0 Part C (§2): the width editor is only live
                    // where a tier width can change the render (Vilna
                    // flanks / Gemara width / bottom-commentary split) —
                    // elsewhere it is disabled with the reason, never a
                    // dead control.
                    const widthEditable = DesignSettingsEngine.isTierWidthEditable(
                      designSettings.layoutType,
                      tier.role
                    );
                    return (
                    <div
                      key={tier.tierIndex}
                      className="p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] space-y-2"
                    >
                      <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                        {tier.tierIndex}. {tierLabel}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                            {t("רוחב (%)")}
                          </label>
                          <input
                            type="number"
                            min={5}
                            max={90}
                            value={tier.widthPct ?? ''}
                            placeholder="—"
                            disabled={!widthEditable}
                            title={widthEditable ? undefined : t("הרוחב אינו משפיע בתבנית זו — הטורים אינם זה לצד זה, או שהרצועה ברוחב מלא.")}
                            onChange={e => {
                              const res = DesignSettingsEngine.updateTierConfig(
                                designSettings,
                                tier.tierIndex,
                                { widthPct: Number(e.target.value) },
                                'user'
                              );
                              applyWithHardRuleGuard(
                                res.settings,
                                `${t("רוחב שכבה")} ${tierLabel}`
                              );
                            }}
                            className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs font-mono disabled:opacity-40"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                            {t("גודל (pt)")}
                          </label>
                          <input
                            type="number"
                            min={6}
                            max={72}
                            step={0.5}
                            value={tier.fontSizePt ?? ''}
                            placeholder="—"
                            onChange={e => {
                              const res = DesignSettingsEngine.updateTierConfig(
                                designSettings,
                                tier.tierIndex,
                                { fontSizePt: Number(e.target.value) },
                                'user'
                              );
                              applyWithHardRuleGuard(
                                res.settings,
                                `${t("גודל שכבה")} ${tierLabel}`
                              );
                            }}
                            className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                            {t("מרווח שורות")}
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={2.2}
                            step={0.05}
                            value={tier.lineHeight ?? ''}
                            placeholder="—"
                            onChange={e => {
                              const res = DesignSettingsEngine.updateTierConfig(
                                designSettings,
                                tier.tierIndex,
                                { lineHeight: Number(e.target.value) },
                                'user'
                              );
                              applyWithHardRuleGuard(
                                res.settings,
                                `${t("מרווח שכבה")} ${tierLabel}`
                              );
                            }}
                            className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs font-mono"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                          {t("גופן שכבה")}
                        </label>
                        <select
                          value={tier.fontFamily ?? ''}
                          onChange={e => {
                            const res = DesignSettingsEngine.updateTierConfig(
                              designSettings,
                              tier.tierIndex,
                              { fontFamily: e.target.value || undefined },
                              'user'
                            );
                            applyWithHardRuleGuard(
                              res.settings,
                              `${t("גופן שכבה")} ${tierLabel}`
                            );
                          }}
                          className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                        >
                          <option value="">{t("ברירת מחדל של התפקיד")}</option>
                          {fontFamilyOptions.map(family => (
                            <option key={family} value={family}>
                              {family}
                            </option>
                          ))}
                        </select>
                        {/* v0.8.0 Part E: same PDF-embeddability flag as the
                            role font — a scanned tier font fails export too. */}
                        {isFontEmbeddableInPdf(tier.fontFamily ?? '') === false && (
                          <p className="text-[10px] text-[var(--ui-warning)] mt-0.5">
                            {t('גופן מהמחשב — לא ניתן להטמיע ב-PDF ללא העלאת קובץ TTF/OTF.')}
                          </p>
                        )}
                      </div>
                    </div>
                    );
                  });
                })()}
                <p className="text-[10px] text-[var(--ui-text-secondary)] leading-snug">
                  {t("שכבות 4–7 (עין משפט, נר מצוה, תורה אור, מסורת הש״ס) מוצגות יחד ברצועה אחת מתחת לברך; הגודל, המרווח והגופן של הרצועה נקבעים בשכבה 4.")}
                </p>
              </div>
            )}

            {/* v0.9.0 Part B — Historical layouts: the curated library
                recipes, with plain-language descriptions. Picking one
                applies it through App's transactional preset switch (the
                handler lives in App; without it the buttons are disabled
                with the reason, never dead). v0.9.3 Part C — the library
                grows as Part A adds recipes; the count in the copy below
                is deliberately not a number, and the list itself is read
                dynamically from getHistoricalLayoutLibrary(). */}
            <div className="pt-3 border-t border-[var(--ui-border)]">
              <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                {t('תבניות היסטוריות — עימוד קלאסי מוכן')}
              </div>
              <p className="text-[11px] text-[var(--ui-text-secondary)] leading-snug mt-1 mb-2">
                {t('תבניות היסטוריות — ש״ס וילנא, שולחן ערוך, מקראות גדולות ועוד. בחירה מחליפה את הפריסה כולה, כולל גדלי גופנים ומסגרות.')}
              </p>
              <div className="space-y-1.5">
                {getHistoricalLayoutLibrary().map(entry => {
                  const disabled = !onApplyHistoricalRecipe;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={disabled}
                      title={
                        disabled
                          ? t('החלת תבניות היסטוריות אינה זמינה כרגע — נסו שוב מהתפריט הראשי.')
                          : undefined
                      }
                      onClick={() => onApplyHistoricalRecipe?.(entry.id)}
                      className="w-full text-start rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] px-2.5 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="block text-xs font-bold text-[var(--ui-text-primary)]">
                        {lang === 'he' ? entry.nameHe : entry.nameEn}
                      </span>
                      <span className="block text-[11px] text-[var(--ui-text-secondary)] leading-snug mt-0.5">
                        {lang === 'he' ? entry.descriptionHe : entry.descriptionEn}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* v0.6.0 Part C (§2): custom layout in the page editor — the
                designer now receives the CURRENT page (body page index:
                the title page, when on, is display page 1 and has no
                boxes), so "רק לדף זה" really scopes the edit to this
                folio and the pagination engine honours it. */}
            <div className="pt-3 border-t border-[var(--ui-border)]">
              {designSettings.layoutType !== 'custom_layout' ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                    {t('פריסה מותאמת אישית (תיבות)')}
                  </div>
                  <p className="text-[11px] text-[var(--ui-text-secondary)] leading-snug">
                    {t('מעצבים תיבות טקסט חופשיות על העמוד — כולל צורות L / T / צלב וחיתוכים שהטקסט עוקף. התיבות עצמן מניעות את העימוד.')}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const res = DesignSettingsEngine.updateLayoutSettings(
                        designSettings,
                        { layoutType: 'custom_layout' },
                        'user'
                      );
                      applyWithHardRuleGuard(res, t('מעבר לפריסה מותאמת אישית'));
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] text-xs text-[var(--ui-text-primary)]"
                  >
                    {t('עבור לפריסה מותאמת אישית')}
                  </button>
                </div>
              ) : (
                <CustomLayoutDesigner
                  boxes={
                    designSettings.pageLayout.customLayout?.boxes ??
                    defaultCustomLayoutDesign('rav_text').boxes
                  }
                  onBoxesChange={(nextBoxes: CustomLayoutBox[]) => {
                    const res = DesignSettingsEngine.setCustomLayout(
                      designSettings,
                      { boxes: nextBoxes },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, t('עדכון תיבות פריסה מותאמת'));
                  }}
                  baseLayout={designSettings.pageLayout.customLayout?.baseLayout ?? 'rav_text'}
                  onBaseLayoutChange={nextBase => {
                    const res = DesignSettingsEngine.setCustomLayout(
                      designSettings,
                      { baseLayout: nextBase },
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, t('תבנית בסיס של הפריסה המותאמת'));
                  }}
                  contentWidthPt={
                    designSettings.pageLayout.pageWidthPt -
                    designSettings.pageLayout.marginInsidePt -
                    designSettings.pageLayout.marginOutsidePt
                  }
                  contentHeightPt={
                    designSettings.pageLayout.pageHeightPt -
                    designSettings.pageLayout.marginTopPt -
                    designSettings.pageLayout.marginBottomPt
                  }
                  pageIndex={
                    // Body-page index: display index minus the title page.
                    // -1 (the title page itself) hides the per-page scope.
                    designSettings.titlePage?.enabled ? currentPageIndex - 1 : currentPageIndex
                  }
                  pageOverrideExists={
                    (() => {
                      const bodyIdx = designSettings.titlePage?.enabled
                        ? currentPageIndex - 1
                        : currentPageIndex;
                      return bodyIdx >= 0 &&
                        Boolean(designSettings.pageLayout.customLayout?.pageOverrides?.[String(bodyIdx)]);
                    })()
                  }
                  onPageOverrideChange={(pageIdx, nextBoxes) => {
                    const res = DesignSettingsEngine.setCustomLayoutPageOverride(
                      designSettings,
                      pageIdx,
                      nextBoxes,
                      'user'
                    );
                    applyWithHardRuleGuard(
                      res.settings,
                      tf('התאמת פריסה לדף {page}', { page: pageIdx + 1 })
                    );
                  }}
                  onClearPageOverride={pageIdx => {
                    const res = DesignSettingsEngine.clearCustomLayoutPageOverride(
                      designSettings,
                      pageIdx,
                      'user'
                    );
                    applyWithHardRuleGuard(res.settings, tf('ביטול התאמת פריסה לדף {page}', { page: pageIdx + 1 }));
                  }}
                  // v0.9.0 Part B — template file handlers (App's
                  // transactional export/import); the designer falls back
                  // to a local boxes-only export/import without them.
                  onExportTemplate={onExportTemplate}
                  onImportTemplateFile={onImportTemplateFile}
                />
              )}
            </div>
          </div>
        )}

        {/* TAB 4: RAV TEXT & DYNAMIC KNEES */}
        {currentTab === 'rav_text' && (
          <div className="space-y-4">
            <Hint>{t("כאן קובעים איך הגמרא, רש״י ותוספות מסתדרים יחד בעמוד. ברוב הספרים — אוטומטי.")}</Hint>
            <div className="p-3 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--ui-text-primary)]">
                  
                  {t("איפה המפרשים מתחברים (קו הברך):")}
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
                    
                    {t("אוטומטי (וילנא)")}
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
                    
                    {t("ידני")}
                  </button>
                </div>
              </div>

              {knee && (
                <div className="text-[10px] text-[var(--ui-text-secondary)] grid grid-cols-2 gap-1 pt-1">
                  <span>{t("רוחב גמרא עליון:")} {Math.round(knee.upperSourceWidth)}pt</span>
                  <span>{t("רוחב גמרא תחתון:")} {Math.round(knee.lowerSourceWidth)}pt</span>
                  <span>{t("עמודת רש״י:")} {Math.round(knee.rightCommentaryWidth)}pt</span>
                  <span>{t("עמודת תוספות:")} {Math.round(knee.leftCommentaryWidth)}pt</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--ui-text-primary)]">
                    
                    {t("מספר שורות מפרשים מעל הגמרא (ברך עליונה):")}
                  </span>
                  <span className="font-mono">
                    {kneeSettings?.upperKneeLines ??
                      designSettings.ravText.upperCollarLines}{' '}
                    
                    {t("שורות")}
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
                    
                    {t("מרווח עמודות (Gutter) בין מפרשים לגמרא:")}
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
                    
                    {t("גובה צומת ברך תחתונה (% מגובה הדף):")}
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
                <span>{t("הדגש דיבור המתחיל (ד״ה) אוטומטית")}</span>
                <input
                  type="checkbox"
                  checked={designSettings.ravText.dibburHamatchilBold}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateRavTextSettings(
                      designSettings,
                      { dibburHamatchilBold: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t("הדגשת דיבור המתחיל"));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("שמור מפרש באותו עמוד עם המקור המקושר")}</span>
                <input
                  type="checkbox"
                  checked={designSettings.ravText.preferSamePageSourceCommentary}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateRavTextSettings(
                      designSettings,
                      { preferSamePageSourceCommentary: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t("הצמדת מפרש למקור"));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              {/* v0.8.0 Part C (§7): Michtav box above the Gemara text on the first Vilna page. */}
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("הצג תיבת מכתב בראש העמוד הראשון")}</span>
                <input
                  type="checkbox"
                  checked={designSettings.ravText.michtavEnabled ?? false}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateRavTextSettings(
                      designSettings,
                      { michtavEnabled: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t("תיבת מכתב"));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>
              {designSettings.ravText.michtavEnabled && (
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                    {t("טקסט תיבת המכתב:")}
                  </label>
                  <input
                    type="text"
                    value={designSettings.ravText.michtavText ?? ''}
                    placeholder={t("מכתב")}
                    onChange={e => {
                      const next = DesignSettingsEngine.updateRavTextSettings(
                        designSettings,
                        { michtavText: e.target.value },
                        'user'
                      );
                      applyWithHardRuleGuard(next, t("טקסט תיבת מכתב"));
                    }}
                    className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
              )}
            </div>

            {/* v0.9.9 (I2): ONE "Vilna Shas" section — the preset controls
              (folio start, chalon indent, opening frame, separators,
              transition marker, marginal slots) in one place. Every
              control reads/writes the same design-settings fields the
              engines read; there is no parallel state. */}
            <div className="space-y-3 p-3 rounded-lg border-2 border-[var(--ui-border)] bg-[var(--ui-surface)]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-[var(--ui-text-primary)]">{t("ש״ס וילנא")}</span>
                <button
                  type="button"
                  data-testid="vilna-preset-apply"
                  onClick={() => {
                    const patch = vilnaPresetToDesignPatch(VILNA_SHAS_PRESET);
                    let next = DesignSettingsEngine.updateRavTextSettings(designSettings, patch.ravText, 'user');
                    next = DesignSettingsEngine.updatePageElementsSettings(
                      next,
                      { folioNumbering: { ...(next.pageElements.folioNumbering ?? DEFAULT_FOLIO_NUMBERING), ...patch.folioNumbering } },
                      'user'
                    );
                    for (const role of patch.chalonRoles) {
                      next = DesignSettingsEngine.updateRoleStyle(next, role, { paragraph: patch.chalonParagraph }, 'user', t("תבנית וילנא")).settings;
                    }
                    // Layout training T5 — the Vilna preset makes the book a Talmud folio.
                    next = DesignSettingsEngine.applySeferType(next, 'talmud');
                    applyWithHardRuleGuard(next, t("החל תבנית וילנא קלאסית"));
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[var(--ui-accent)] text-white text-[11px] font-semibold"
                >
                  {t("החל תבנית וילנא קלאסית")}
                </button>
              </div>
              <Hint>{t("תבנית וילנא: גמרא במרכז, רש״י בצד הפנימי, תוספות בצד החיצוני. ההחלה מחליפה גופנים, מפרידים, סמן מעבר, מדורי צד ומספור דפים — וניתנת לביטול.")}</Hint>

              {/* Folio start (first daf / amud) — same fields as the page-elements tab */}
              {(() => {
                const fn = designSettings.pageElements.folioNumbering ?? DEFAULT_FOLIO_NUMBERING;
                return (
                  <div className="space-y-2 p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
                    <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">{t("מספור דפים — דף פתיחה (וילנא):")}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                          {t("דף פתיחה:")}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={999}
                          data-testid="vilna-folio-start-daf-input"
                          value={fn.startDaf}
                          onChange={e => {
                            const val = Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 2)));
                            const next = DesignSettingsEngine.updatePageElementsSettings(
                              designSettings,
                              { folioNumbering: { ...fn, startDaf: val } },
                              'user'
                            );
                            applyWithHardRuleGuard(next, t("דף פתיחה"));
                          }}
                          className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs font-mono"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[10px] text-[var(--ui-text-secondary)] mb-0.5">
                          {t("עמוד פתיחה:")}
                        </span>
                        <select
                          data-testid="vilna-folio-start-amud-select"
                          value={fn.startAmud}
                          onChange={e => {
                            const next = DesignSettingsEngine.updatePageElementsSettings(
                              designSettings,
                              { folioNumbering: { ...fn, startAmud: e.target.value as 'a' | 'b' } },
                              'user'
                            );
                            applyWithHardRuleGuard(next, t("עמוד פתיחה"));
                          }}
                          className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                        >
                          <option value="a">{t("ע״א (.)")}</option>
                          <option value="b">{t("ע״ב (:)")}</option>
                        </select>
                      </label>
                    </div>
                    <label className="flex items-center justify-between text-[11px] cursor-pointer pt-0.5">
                      <span>{t("אל תספור עמודי שער ותוכן עניינים")}</span>
                      <input
                        type="checkbox"
                        checked={fn.excludeFrontMatter}
                        onChange={e => {
                          const next = DesignSettingsEngine.updatePageElementsSettings(
                            designSettings,
                            { folioNumbering: { ...fn, excludeFrontMatter: e.target.checked } },
                            'user'
                          );
                          applyWithHardRuleGuard(next, t("שער מחוץ לספירה"));
                        }}
                        className="accent-[var(--ui-accent)]"
                      />
                    </label>
                  </div>
                );
              })()}

              {/* Chalon (second-line) indent + live preview */}
              {(() => {
                const readMode = (role: ContentRole): ParagraphIndentMode | undefined =>
                  designSettings.projectRoleStyles[role]?.paragraph?.indentMode ??
                  designSettings.roleStyles[role]?.paragraph?.indentMode;
                const mainPara =
                  designSettings.projectRoleStyles.main_source?.paragraph ??
                  designSettings.roleStyles.main_source?.paragraph;
                const mode: ParagraphIndentMode = mainPara?.indentMode ?? 'none';
                const indentPt = mainPara?.chalonIndentPt ?? mainPara?.hangingIndentPt ?? mainPara?.firstLineIndentPt ?? 18;
                const lineCount = mainPara?.chalonLineCount ?? 2;
                const isChalon = (m?: ParagraphIndentMode) =>
                  m === 'chalon_second_line' || m === 'chalon_window' || m === 'chalon_all';
                const rashiOn = isChalon(readMode('primary_comment'));
                const tosafotOn = isChalon(readMode('secondary_comment'));
                const scope = rashiOn && tosafotOn ? 'all' : rashiOn ? 'gemara_rashi' : tosafotOn ? 'gemara_tosafot' : 'gemara';
                const applyChalon = (nextMode: ParagraphIndentMode, nextIndentPt: number, nextLineCount: number, nextScope: string) => {
                  const scoped: ContentRole[] =
                    nextScope === 'all'
                      ? ['main_source', 'primary_comment', 'secondary_comment']
                      : nextScope === 'gemara_rashi'
                        ? ['main_source', 'primary_comment']
                        : nextScope === 'gemara_tosafot'
                          ? ['main_source', 'secondary_comment']
                          : ['main_source'];
                  // The amount lives on the field its mode reads, so
                  // first-line / hanging / chalon all indent visibly.
                  const para: Partial<ParagraphStyleSettings> =
                    nextMode === 'none'
                      ? { indentMode: 'none', firstLineIndentPt: 0, hangingIndentPt: 0 }
                      : nextMode === 'first_line'
                        ? { indentMode: 'first_line', firstLineIndentPt: nextIndentPt, hangingIndentPt: 0, chalonIndentPt: nextIndentPt }
                        : nextMode === 'hanging'
                          ? { indentMode: 'hanging', hangingIndentPt: nextIndentPt, firstLineIndentPt: 0, chalonIndentPt: nextIndentPt }
                          : { indentMode: nextMode, chalonIndentPt: nextIndentPt, chalonLineCount: nextLineCount, firstLineIndentPt: 0, hangingIndentPt: 0 };
                  let next = designSettings;
                  for (const role of ['main_source', 'primary_comment', 'secondary_comment'] as ContentRole[]) {
                    if (scoped.includes(role)) {
                      next = DesignSettingsEngine.updateRoleStyle(next, role, { paragraph: para }, 'user', t("הזחת חלון")).settings;
                    } else if (isChalon(readMode(role))) {
                      // Leaving the scope only clears a chalon indent;
                      // any other indent on that stream is left alone.
                      next = DesignSettingsEngine.updateRoleStyle(
                        next,
                        role,
                        { paragraph: { indentMode: 'none', firstLineIndentPt: 0, hangingIndentPt: 0 } },
                        'user',
                        t("הזחת חלון")
                      ).settings;
                    }
                  }
                  applyWithHardRuleGuard(next, t("הזחת חלון"));
                };
                const indented = (lineIdx: number): boolean => {
                  if (mode === 'first_line') return lineIdx === 0;
                  if (mode === 'hanging') return lineIdx >= 1;
                  if (mode === 'chalon_second_line') return lineIdx === 1;
                  if (mode === 'chalon_window') return lineIdx >= 1 && lineIdx <= lineCount;
                  if (mode === 'chalon_all') return lineIdx >= 1;
                  return false;
                };
                return (
                  <div className="space-y-2 p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
                    <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">{t("הזחת חלון (שורה שנייה):")}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                          {t("מצב הזחה:")}
                        </label>
                        <select
                          data-testid="vilna-chalon-mode-select"
                          value={mode}
                          onChange={e => applyChalon(e.target.value as ParagraphIndentMode, indentPt, lineCount, scope)}
                          className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                        >
                          <option value="none">{t("ללא")}</option>
                          <option value="first_line">{t("שורה ראשונה")}</option>
                          <option value="hanging">{t("תלויה (כל השורות שאחרי הראשונה)")}</option>
                          <option value="chalon_second_line">{t("חלון — שורה שנייה בלבד")}</option>
                          <option value="chalon_window">{t("חלון — שורות 2 עד N")}</option>
                          <option value="chalon_all">{t("חלון — משורה שנייה ואילך")}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                          {t("החל על:")}
                        </label>
                        <select
                          data-testid="vilna-chalon-scope-select"
                          value={scope}
                          onChange={e => applyChalon(mode, indentPt, lineCount, e.target.value)}
                          className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                        >
                          <option value="gemara">{t("גמרא בלבד")}</option>
                          <option value="gemara_rashi">{t("גמרא + רש״י")}</option>
                          <option value="gemara_tosafot">{t("גמרא + תוספות")}</option>
                          <option value="all">{t("הכל (גמרא, רש״י, תוספות)")}</option>
                        </select>
                      </div>
                    </div>
                    {mode !== 'none' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("עומק ההזחה (pt):")}
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={72}
                            step={1}
                            data-testid="vilna-chalon-indent-input"
                            value={indentPt}
                            onChange={e => applyChalon(mode, Math.max(0, Math.min(72, Number(e.target.value) || 0)), lineCount, scope)}
                            className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs font-mono"
                          />
                        </div>
                        {mode === 'chalon_window' && (
                          <div>
                            <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                              {t("שורות בחלון:")}
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={6}
                              step={1}
                              value={lineCount}
                              onChange={e => applyChalon(mode, indentPt, Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 2))), scope)}
                              className="w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs font-mono"
                            />
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <div className="text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">{t("תצוגה מקדימה:")}</div>
                      <div dir="rtl" className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2 py-1.5 text-[12px] leading-relaxed">
                        {[0, 1, 2].map(i => (
                          <div
                            key={i}
                            style={{ paddingRight: indented(i) ? `${indentPt}px` : undefined }}
                            className={indented(i) ? 'bg-amber-100/60 dark:bg-amber-900/30' : undefined}
                          >
                            {i === 0
                              ? t("שורה ראשונה של הפסקה לדוגמה")
                              : i === 1
                                ? t("שורה שנייה של הפסקה לדוגמה")
                                : t("שורה שלישית של הפסקה לדוגמה")}
                          </div>
                        ))}
                      </div>
                    </div>
                    <Hint>{t("ברירת המחדל היא ללא הזחה — ההזחה חלה בעימוד הבא וניתנת לביטול בכל עת (בחירת ״ללא״).")}</Hint>
                  </div>
                );
              })()}

            {/* Opening Word Frame (מסגרת למילת הפתיחה) */}
            {(() => {
              const od = designSettings.ravText.openingDecoration ?? DEFAULT_OPENING_DECORATION;
              return (
                <div className="space-y-2.5 pt-2 border-t border-[var(--ui-border)]">
                  <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                    <span className="font-semibold text-[var(--ui-text-primary)]">{t("מסגרת למילת הפתיחה של המסכת / הפרק")}</span>
                    <input
                      type="checkbox"
                      data-testid="opening-decoration-toggle"
                      checked={od.enabled}
                      onChange={e => {
                        const next = DesignSettingsEngine.updateRavTextSettings(
                          designSettings,
                          { openingDecoration: { ...od, enabled: e.target.checked } },
                          'user'
                        );
                        applyWithHardRuleGuard(next, t("מסגרת מילת הפתיחה"));
                      }}
                      className="accent-[var(--ui-accent)]"
                    />
                  </label>
                  {od.enabled && (
                    <div className="space-y-2 ps-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("סגנון מסגרת:")}
                          </label>
                          <select
                            data-testid="opening-decoration-style"
                            value={od.styleId}
                            onChange={e => {
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { openingDecoration: { ...od, styleId: e.target.value as OpeningDecorationStyleId } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("סגנון מסגרת פתיחה"));
                            }}
                            className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs"
                          >
                            <option value="simple_frame">{t("מסגרת פשוטה")}</option>
                            <option value="double_ornate">{t("מסגרת כפולה מעוטרת")}</option>
                            <option value="crown_panel">{t("לוחית כתר")}</option>
                            <option value="chumash_cartouche">{t("קרטוש מעוגל")}</option>
                            <option value="patterned_rect">{t("מסגרת מדוגמת (קווים)")}</option>
                            <option value="stepped_frame">{t("מסגרת מדורגת")}</option>
                            <option value="corner_ornament">{t("מסגרת עם עיטורי פינות")}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("מילים במסגרת (1–4):")}
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={4}
                            step={1}
                            value={od.wordCount}
                            onChange={e => {
                              const val = Math.max(1, Math.min(4, Math.round(Number(e.target.value) || 1)));
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { openingDecoration: { ...od, wordCount: val } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("מספר מילים במסגרת"));
                            }}
                            className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("ריפוד פנימי (pt):")}
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={24}
                            step={1}
                            value={od.paddingPt}
                            onChange={e => {
                              const val = Math.max(0, Math.min(24, Number(e.target.value) || 0));
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { openingDecoration: { ...od, paddingPt: val } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("ריפוד מסגרת פתיחה"));
                            }}
                            className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("טקסט חלופי (אופציונלי):")}
                          </label>
                          <input
                            type="text"
                            value={od.customWordText ?? ''}
                            placeholder={t("אוטומטי ממילת הפתיחה")}
                            onChange={e => {
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { openingDecoration: { ...od, customWordText: e.target.value } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("טקסט מילת הפתיחה"));
                            }}
                            className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs"
                          />
                        </div>
                      </div>
                      {/* v0.9.9 (I2): frame thickness + scope */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("עובי מסגרת (pt):")}
                          </label>
                          <input
                            type="number"
                            min={0.4}
                            max={4}
                            step={0.1}
                            value={od.thicknessPt ?? 1.1}
                            onChange={e => {
                              const val = Math.max(0.4, Math.min(4, Number(e.target.value) || 1.1));
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { openingDecoration: { ...od, thicknessPt: val } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("עובי מסגרת פתיחה"));
                            }}
                            className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("היקף המסגרת:")}
                          </label>
                          <select
                            data-testid="opening-decoration-scope"
                            value={od.scope ?? 'masechet_start'}
                            onChange={e => {
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { openingDecoration: { ...od, scope: e.target.value as 'masechet_start' | 'chapter_start' } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("היקף מסגרת פתיחה"));
                            }}
                            className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs"
                          >
                            <option value="masechet_start">{t("תחילת מסכת בלבד")}</option>
                            <option value="chapter_start">{t("גם תחילת כל פרק")}</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Separators between Commentaries and Paragraphs */}
            {(() => {
              const cs = designSettings.ravText.commentarySeparator ?? DEFAULT_COMMENTARY_SEPARATOR;
              const ps = designSettings.ravText.paragraphSeparator ?? DEFAULT_PARAGRAPH_SEPARATOR;
              return (
                <div className="space-y-2.5 pt-2 border-t border-[var(--ui-border)]">
                  <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                    {t("מפרידים בין מפרשים לקטעים")}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                        {t("בין מפרשים (רש״י / תוספות):")}
                      </label>
                      <select
                        data-testid="commentary-separator-select"
                        value={cs.styleId}
                        onChange={e => {
                          const next = DesignSettingsEngine.updateRavTextSettings(
                            designSettings,
                            { commentarySeparator: { ...cs, styleId: e.target.value as SeparatorStyleId } },
                            'user'
                          );
                          applyWithHardRuleGuard(next, t("מפריד מפרשים"));
                        }}
                        className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs"
                      >
                        <option value="none">{t("ללא")}</option>
                        <option value="colon">{t("נקודתיים (:)")}</option>
                        <option value="colon_dot">{t("נקודה ממורכזת (•)")}</option>
                        <option value="thin_rule">{t("קו דק")}</option>
                        <option value="double_rule">{t("קו כפול")}</option>
                        <option value="centered_diamond">{t("מעוין (◆)")}</option>
                        <option value="scrolled_divider">{t("קו מעוטר")}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                        {t("בין קטעי פנים:")}
                      </label>
                      <select
                        data-testid="rav-paragraph-separator-select"
                        value={ps.styleId}
                        onChange={e => {
                          const next = DesignSettingsEngine.updateRavTextSettings(
                            designSettings,
                            { paragraphSeparator: { ...ps, styleId: e.target.value as SeparatorStyleId } },
                            'user'
                          );
                          applyWithHardRuleGuard(next, t("מפריד קטעי פנים"));
                        }}
                        className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2 py-1 text-xs"
                      >
                        <option value="none">{t("ללא")}</option>
                        <option value="colon">{t("נקודתיים (:)")}</option>
                        <option value="colon_dot">{t("נקודה ממורכזת (•)")}</option>
                        <option value="thin_rule">{t("קו דק")}</option>
                        <option value="double_rule">{t("קו כפול")}</option>
                        <option value="centered_diamond">{t("מעוין (◆)")}</option>
                        <option value="scrolled_divider">{t("קו מעוטר")}</option>
                      </select>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Verified Mishnah -> Gemara Transition Marker (`גמ׳`) */}
            {(() => {
              const tm = designSettings.ravText.transitionMarker ?? DEFAULT_TRANSITION_MARKER;
              return (
                <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
                  <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                    <span className="font-semibold text-[var(--ui-text-primary)]">{t("סמן מעבר מאומת ממשנה לגמרא (גמ׳)")}</span>
                    <input
                      type="checkbox"
                      data-testid="transition-marker-toggle"
                      checked={tm.enabled}
                      onChange={e => {
                        const next = DesignSettingsEngine.updateRavTextSettings(
                          designSettings,
                          { transitionMarker: { ...tm, enabled: e.target.checked } },
                          'user'
                        );
                        applyWithHardRuleGuard(next, t("סמן מעבר גמ׳"));
                      }}
                      className="accent-[var(--ui-accent)]"
                    />
                  </label>
                  {tm.enabled && (
                    <div className="space-y-1.5 ps-2">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-semibold text-[var(--ui-text-secondary)] shrink-0">
                          {t("סימן מעבר:")}
                        </label>
                        <input
                          type="text"
                          value={tm.markerText}
                          onChange={e => {
                            const next = DesignSettingsEngine.updateRavTextSettings(
                              designSettings,
                              { transitionMarker: { ...tm, markerText: e.target.value } },
                              'user'
                            );
                            applyWithHardRuleGuard(next, t("טקסט סמן מעבר"));
                          }}
                          className="w-24 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                        />
                        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer ms-auto">
                          <input
                            type="checkbox"
                            checked={tm.highlightAmbiguousInQa}
                            onChange={e => {
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { transitionMarker: { ...tm, highlightAmbiguousInQa: e.target.checked } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("התראת גבולות בבדיקת ש״ס"));
                            }}
                            className="accent-[var(--ui-accent)]"
                          />
                          <span>{t("הדגש גבולות לא ברורים ב־QA")}</span>
                        </label>
                      </div>
                      {/* v0.9.9 (I2): marker style / size / position */}
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("סגנון סמן:")}
                          </label>
                          <select
                            data-testid="transition-marker-style"
                            value={tm.style ?? 'text'}
                            onChange={e => {
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { transitionMarker: { ...tm, style: e.target.value as 'text' | 'boxed' } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("סגנון סמן מעבר"));
                            }}
                            className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                          >
                            <option value="text">{t("טקסט פשוט")}</option>
                            <option value="boxed">{t("ממוסגר")}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("גודל סמן (pt):")}
                          </label>
                          <input
                            type="number"
                            min={7}
                            max={24}
                            step={0.5}
                            placeholder={t("אוטומטי")}
                            value={tm.sizePt ?? ''}
                            onChange={e => {
                              const raw = e.target.value.trim();
                              const val = raw === '' ? undefined : Math.max(7, Math.min(24, Number(raw) || 11));
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { transitionMarker: { ...tm, sizePt: val } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("גודל סמן מעבר"));
                            }}
                            className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--ui-text-secondary)] mb-0.5">
                            {t("מיקום סמן:")}
                          </label>
                          <select
                            data-testid="transition-marker-position"
                            value={tm.position ?? 'before_first_word'}
                            onChange={e => {
                              const next = DesignSettingsEngine.updateRavTextSettings(
                                designSettings,
                                { transitionMarker: { ...tm, position: e.target.value as 'before_first_word' | 'after_last_word' } },
                                'user'
                              );
                              applyWithHardRuleGuard(next, t("מיקום סמן מעבר"));
                            }}
                            className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-md px-2 py-1 text-xs"
                          >
                            <option value="before_first_word">{t("לפני המילה הראשונה")}</option>
                            <option value="after_last_word">{t("אחרי המילה האחרונה")}</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Peripheral Commentator / Reference Streams */}
            {(() => {
              const streams = designSettings.ravText.peripheralStreams ?? DEFAULT_PERIPHERAL_STREAMS;
              const STREAM_NAMES: Record<PeripheralStreamKind, { he: string; en: string }> = {
                ein_mishpat: { he: 'עין משפט', en: 'Ein Mishpat' },
                ner_mitzvah: { he: 'נר מצוה', en: 'Ner Mitzvah' },
                masoret_hashas: { he: 'מסורת הש״ס', en: 'Masoret HaShas' },
                torah_or: { he: 'תורה אור', en: 'Torah Or' },
                gilyon_hashas: { he: 'גליון הש״ס', en: 'Gilyon HaShas' },
                hagahot_habach: { he: 'הגהות הב״ח', en: 'Hagahot HaBach' },
                rabbeinu_chananel: { he: 'רבינו חננאל', en: 'Rabbeinu Chananel' },
                ran: { he: 'ר״ן', en: 'Ran' },
                maharsha: { he: 'מהרש״א', en: 'Maharsha' },
              };
              return (
                <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
                  <div className="text-[11px] font-semibold text-[var(--ui-text-primary)]">
                    {t("מדורי צד ומראי מקומות (מסורת הש״ס, עין משפט)")}
                  </div>
                  <Hint>{t("מדור שאין לו תוכן בעמוד אינו תופס שטח ריק כלל.")}</Hint>
                  <div className="space-y-1.5">
                    {streams.map(st => {
                      const label = lang === 'en' ? STREAM_NAMES[st.id].en : STREAM_NAMES[st.id].he;
                      return (
                        <div
                          key={st.id}
                          className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]"
                        >
                          <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={st.enabled}
                              onChange={e => {
                                const updated = streams.map(item =>
                                  item.id === st.id ? { ...item, enabled: e.target.checked } : item
                                );
                                const next = DesignSettingsEngine.updateRavTextSettings(
                                  designSettings,
                                  { peripheralStreams: updated },
                                  'user'
                                );
                                applyWithHardRuleGuard(next, label);
                              }}
                              className="accent-[var(--ui-accent)]"
                            />
                            <span className="font-medium text-[var(--ui-text-primary)]">{label}</span>
                          </label>
                          <div className="flex items-center gap-1.5">
                            <select
                              disabled={!st.enabled}
                              value={st.placement}
                              onChange={e => {
                                const updated = streams.map(item =>
                                  item.id === st.id
                                    ? { ...item, placement: e.target.value as 'inside' | 'outside' | 'below' }
                                    : item
                                );
                                const next = DesignSettingsEngine.updateRavTextSettings(
                                  designSettings,
                                  { peripheralStreams: updated },
                                  'user'
                                );
                                applyWithHardRuleGuard(next, label);
                              }}
                              className="bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded px-1.5 py-0.5 text-[10px] disabled:opacity-45"
                            >
                              <option value="outside">{t("חוץ")}</option>
                              <option value="inside">{t("פנים")}</option>
                              <option value="below">{t("תחתית")}</option>
                            </select>
                            {/* v0.9.9 (I2): per-slot font size + width (preset slot data) */}
                            <label className="flex items-center gap-1 text-[10px] text-[var(--ui-text-secondary)]">
                              {t("גודל (pt):")}
                              <input
                                type="number"
                                min={6}
                                max={14}
                                step={0.5}
                                disabled={!st.enabled}
                                value={st.fontSizePt}
                                onChange={e => {
                                  const val = Math.max(6, Math.min(14, Number(e.target.value) || 8.5));
                                  const updated = streams.map(item =>
                                    item.id === st.id ? { ...item, fontSizePt: val } : item
                                  );
                                  const next = DesignSettingsEngine.updateRavTextSettings(
                                    designSettings,
                                    { peripheralStreams: updated },
                                    'user'
                                  );
                                  applyWithHardRuleGuard(next, label);
                                }}
                                className="w-12 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded px-1 py-0.5 text-[10px] font-mono disabled:opacity-45"
                              />
                            </label>
                            <label className="flex items-center gap-1 text-[10px] text-[var(--ui-text-secondary)]">
                              {t("רוחב (%):")}
                              <input
                                type="number"
                                min={5}
                                max={60}
                                step={1}
                                disabled={!st.enabled}
                                value={st.widthPct}
                                onChange={e => {
                                  const val = Math.max(5, Math.min(60, Math.round(Number(e.target.value) || 14)));
                                  const updated = streams.map(item =>
                                    item.id === st.id ? { ...item, widthPct: val } : item
                                  );
                                  const next = DesignSettingsEngine.updateRavTextSettings(
                                    designSettings,
                                    { peripheralStreams: updated },
                                    'user'
                                  );
                                  applyWithHardRuleGuard(next, label);
                                }}
                                className="w-12 bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded px-1 py-0.5 text-[10px] font-mono disabled:opacity-45"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            </div>
          </div>
        )}

        {/* TAB 5: FOOTNOTES */}
        {currentTab === 'footnotes' && (
          <div className="space-y-4">
            <Hint>{t("הערות שוליים מופיעות בתחתית העמוד. כאן קובעים איך הן נראות.")}</Hint>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  
                  {t("גודל האותיות בהערות:")}
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
                    applyWithHardRuleGuard(next, t("גודל גופן הערות שוליים"));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1">
                  
                  {t("מרווח שורות הערות (pt):")}
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
                    applyWithHardRuleGuard(next, t("מרווח שורות הערות"));
                  }}
                  className="w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("הצג קו מפריד מעל הערות השוליים")}</span>
                <input
                  type="checkbox"
                  checked={designSettings.footnotes.showSeparatorRule}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateFootnoteSettings(
                      designSettings,
                      { showSeparatorRule: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t("קו מפריד הערות שוליים"));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>

              {/* v0.9.7 Part 4 — separator width + spacing below: the
                  recipe footnote band's geometry, made general. The
                  recipe only carries the band as a box; the on-screen
                  separator line is drawn by PageCanvas from
                  footnotes.separatorWidthRatio (width = content width ×
                  ratio) and footnotes.separatorSpacingBelowPt (gap
                  between the line and the first footnote). Until now no
                  Design control edited either on ANY layout. Disabled
                  while the rule itself is off. */}
              <div className="space-y-3 p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)]">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="font-semibold text-[var(--ui-text-primary)]">
                      {t("רוחב קו מפריד (% מרוחב העמוד):")}
                    </span>
                    <span className="font-mono" data-testid="design-footnote-separator-width-value">
                      {Math.round((designSettings.footnotes.separatorWidthRatio ?? 0.25) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    data-testid="design-footnote-separator-width"
                    disabled={!designSettings.footnotes.showSeparatorRule}
                    value={Math.round((designSettings.footnotes.separatorWidthRatio ?? 0.25) * 100)}
                    onChange={e => {
                      const next = DesignSettingsEngine.updateFootnoteSettings(
                        designSettings,
                        { separatorWidthRatio: Number(e.target.value) / 100 },
                        'user'
                      );
                      applyWithHardRuleGuard(next, t("רוחב קו מפריד הערות שוליים"));
                    }}
                    className="w-full accent-[var(--ui-accent)] disabled:opacity-40"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="font-semibold text-[var(--ui-text-primary)]">
                      {t("מרווח מתחת לקו המפריד (pt):")}
                    </span>
                    <span className="font-mono" data-testid="design-footnote-separator-gap-value">
                      {designSettings.footnotes.separatorSpacingBelowPt ?? 4} pt
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={16}
                    step={1}
                    data-testid="design-footnote-separator-gap"
                    disabled={!designSettings.footnotes.showSeparatorRule}
                    value={designSettings.footnotes.separatorSpacingBelowPt ?? 4}
                    onChange={e => {
                      const next = DesignSettingsEngine.updateFootnoteSettings(
                        designSettings,
                        { separatorSpacingBelowPt: Number(e.target.value) },
                        'user'
                      );
                      applyWithHardRuleGuard(next, t("מרווח מתחת לקו מפריד הערות שוליים"));
                    }}
                    className="w-full accent-[var(--ui-accent)] disabled:opacity-40"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between p-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] cursor-pointer">
                <span>{t("יישור בלוק מלא להערות מרובות שורות")}</span>
                <input
                  type="checkbox"
                  checked={designSettings.footnotes.justifyMultiLineFootnotes}
                  onChange={e => {
                    const next = DesignSettingsEngine.updateFootnoteSettings(
                      designSettings,
                      { justifyMultiLineFootnotes: e.target.checked },
                      'user'
                    );
                    applyWithHardRuleGuard(next, t("יישור הערות שוליים"));
                  }}
                  className="accent-[var(--ui-accent)]"
                />
              </label>
            </div>
          </div>
        )}

        {/* v0.5.0 (Title Page / Shaar Blat builder) */}
        {currentTab === 'title_page' && (
          <TitlePagePanel
            designSettings={designSettings}
            onUpdateDesignSettings={onUpdateDesignSettings}
            bookTitle={bookTitle}
            availableFonts={availableFonts}
          />
        )}
      </div>
      </div>
    </aside>
  );
};
