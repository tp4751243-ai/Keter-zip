import React, { useEffect, useState } from 'react';
import {
  FilePlus2,
  BookOpen,
  Columns,
  SplitSquareVertical,
  Scroll,
  Crown,
  CheckCircle2,
  Sparkles,
  LayoutTemplate,
} from 'lucide-react';
import { BookLayoutType } from '../types/typesetter';
import { useLanguage } from '../i18n/LanguageContext';
import { CustomLayoutBox } from '../types/design-settings';
import { CustomLayoutDesigner } from './CustomLayoutDesigner';
import {
  defaultBoxesForBaseLayout,
} from '../engine/custom-layout-engine';
import {
  getHistoricalLayoutLibrary,
  getRecipeById,
  HistoricalLayoutSummary,
} from '../engine/historical-layouts';
import { CORE_START_LAYOUTS } from '../engine/layout-presets';
// v0.9.8 Phase 1 — Sefer Wizard Step 1: archetype presets. An archetype
// is a SELECTION of an existing core layout / historical recipe (see
// engine/sefer-wizard.ts) — never a parallel preset table.
import {
  SEFER_ARCHETYPES,
  getArchetypeById,
  archetypeDefaultsSummary,
  archetypeLabel,
  archetypeDescription,
  type ChosenSetup,
  type SeferArchetypeId,
} from '../engine/sefer-wizard';

/**
 * v0.9.4 — ONE new-project form, rendered in TWO places: the inline
 * "start a book" section on the Home screen and the New Project modal.
 *
 * The v0.9.2 uniformity pass removed the Home screen's inline wizard
 * because it was a SECOND copy of this form (its own layout-card list,
 * its own title/mode defaults, its own custom-boxes state, its own
 * submit) that had drifted from the modal. The user rightly reports
 * the section as gone, so it comes back — but as this one shared
 * component, not as a second copy. Both entry points render
 * <NewProjectForm> with the same props shape and the same submit
 * handler below, so picking a layout or a historical recipe and
 * creating the book does exactly the same thing from Home and from
 * the modal. The only differences are the initial values (Home keeps
 * its old 'sample' starter default; the modal takes initialMode from
 * its opener) and the submit button label.
 *
 * The layout NAMES come from the one shared list in
 * engine/layout-presets.ts (CORE_START_LAYOUTS, v0.9.7: exactly 11
 * core cards — the 7 base layouts + 4 promoted historical recipes).
 * The full historical library is NOT listed here any more (v0.9.7:
 * it overwhelmed the start screen); it stays in
 * engine/historical-layouts.ts and stays pickable post-creation in
 * the Design / Page design pickers. Only the icons live here, keyed
 * by id.
 */
const LAYOUT_PRESET_ICONS: Record<BookLayoutType, React.ReactNode> = {
  rav_text: <Crown className="w-4 h-4" />,
  mikraot_gedolot: <Scroll className="w-4 h-4" />,
  source_top_commentary_bottom: <SplitSquareVertical className="w-4 h-4" />,
  two_column: <Columns className="w-4 h-4" />,
  single_column: <BookOpen className="w-4 h-4" />,
  yiddish_sefer: <BookOpen className="w-4 h-4" />,
  custom_layout: <LayoutTemplate className="w-4 h-4" />,
};

/**
 * Grouping for the historical-recipe picker. Recipes carry a genre tag
 * (genre[0] of the recipe metadata); several genres belong to one
 * shelf (the three Shas editions sit with Talmud Bavli). Groups are
 * shown in this order; a recipe whose genre matches no group lands in
 * the "תבניות נוספות" shelf at the end, so no recipe can ever be
 * hidden by a grouping mistake. The grouping is presentation only —
 * the list itself is still getHistoricalLayoutLibrary(), shared by
 * both entry points.
 */
export interface HistoricalRecipeGroup {
  key: string;
  labelHe: string;
  genres: ReadonlyArray<string>;
}

export const HISTORICAL_RECIPE_GROUPS: ReadonlyArray<HistoricalRecipeGroup> =
  Object.freeze([
    { key: 'talmud', labelHe: 'ש״ס ותלמוד בבלי', genres: ['talmud', 'shas'] },
    { key: 'tanach', labelHe: 'תנ״ך ומקראות גדולות', genres: ['tanach'] },
    { key: 'mishnah', labelHe: 'משנה', genres: ['mishnah'] },
    { key: 'halakha', labelHe: 'הלכה', genres: ['halakha'] },
    { key: 'midrash', labelHe: 'מדרש ואגדה', genres: ['midrash'] },
    { key: 'mussar', labelHe: 'מוסר', genres: ['mussar'] },
    { key: 'chassidut', labelHe: 'חסידות', genres: ['chassidut'] },
    { key: 'yiddish', labelHe: 'יידיש', genres: ['yiddish'] },
    { key: 'siddur', labelHe: 'תפילה — סידור ומחזור', genres: ['siddur'] },
    { key: 'modern', labelHe: 'מהדורות מודרניות', genres: ['modern'] },
  ]);

export const HISTORICAL_RECIPE_OTHER_GROUP_LABEL_HE = 'תבניות נוספות';

export interface GroupedHistoricalRecipes {
  key: string;
  labelHe: string;
  genres: ReadonlyArray<string>;
  entries: HistoricalLayoutSummary[];
}

/** Group the library entries (library order kept inside each group). */
export function groupHistoricalLibrary(
  entries: HistoricalLayoutSummary[]
): GroupedHistoricalRecipes[] {
  const groups: GroupedHistoricalRecipes[] = HISTORICAL_RECIPE_GROUPS.map(g => ({
    key: g.key,
    labelHe: g.labelHe,
    genres: g.genres,
    entries: [],
  }));
  const other: GroupedHistoricalRecipes = {
    key: 'other',
    labelHe: HISTORICAL_RECIPE_OTHER_GROUP_LABEL_HE,
    genres: [],
    entries: [],
  };
  for (const entry of entries) {
    const group = groups.find(g => g.genres.includes(entry.genre));
    (group ?? other).entries.push(entry);
  }
  return [
    ...groups.filter(g => g.entries.length > 0),
    ...(other.entries.length > 0 ? [other] : []),
  ];
}

interface NewProjectFormProps {
  /** Default title (the modal and Home both use t("ספר חדש — כתר")). */
  initialTitle: string;
  /** Default base layout (the modal takes currentLayoutType; Home too). */
  initialLayout: BookLayoutType;
  /** Default starter content ('sample' on Home, the opener's choice in the modal). */
  initialMode: 'blank' | 'sample';
  /** Submit button label ('צור פרויקט חדש' in the modal, '…ועבור לעריכה' on Home). */
  submitLabel: string;
  /** When given, a Cancel button is shown (the modal only). */
  cancelLabel?: string;
  onCancel?: () => void;
  /**
   * THE one creation handler (App.handleCreateNewProject). Both entry
   * points call this same function — there is no second handler.
   */
  onCreateProject: (
    title: string,
    layoutType: BookLayoutType,
    mode: 'blank' | 'sample',
    setup?: ChosenSetup
  ) => void;
  /**
   * v0.9.9 — fires whenever the selection changes (layout / recipe /
   * archetype / custom boxes / title / mode) with the ONE explicit
   * chosen setup, so a parent that embeds this form (Home) can hand
   * the same setup to the DOCX hub / start-empty path instead of
   * reading invisible localStorage seams. The modal does not pass it.
   */
  onSetupChange?: (setup: ChosenSetup, title: string, mode: 'blank' | 'sample') => void;
  /**
   * v0.9.9 — 'submit' (default) renders the footer with the submit /
   * cancel buttons; 'none' hides it — Home uses 'none' because its
   * Step 2 hub and start-empty link are the actions.
   */
  footerMode?: 'submit' | 'none';
  /**
   * v0.9.8 Phase 1 — wizard Step 1 callback. Fires when the user picks
   * (or clears) a Sefer Wizard archetype, so the parent (Home) can
   * tailor the DOCX hub's slots (Step 2) to it. The modal does not
   * pass this — picking an archetype there still selects the mapped
   * layout + recipe, which is all the modal needs.
   */
  onArchetypeChange?: (archetypeId: SeferArchetypeId | null) => void;
  /** Classes for the <form> (the modal scrolls it; on Home the page scrolls). */
  className?: string;
  /** testid prefix, so Home's form and the modal's form can be told apart. */
  testId: string;
}

export const NewProjectForm: React.FC<NewProjectFormProps> = ({
  initialTitle,
  initialLayout,
  initialMode,
  submitLabel,
  cancelLabel,
  onCancel,
  onCreateProject,
  onArchetypeChange,
  onSetupChange,
  footerMode = 'submit',
  className = 'space-y-5 text-xs',
  testId,
}) => {
  const { t, lang } = useLanguage();
  const [title, setTitle] = useState<string>(initialTitle);
  const [selectedLayout, setSelectedLayout] = useState<BookLayoutType>(initialLayout);
  const [mode, setMode] = useState<'blank' | 'sample'>(initialMode);
  // v0.9.8 Phase 1 — wizard Step 1: the picked archetype. Picking one
  // selects the mapped core layout + historical recipe in the EXISTING
  // state below (no second form state); clearing it (picking a core
  // card directly) clears the pick.
  const [archetypeId, setArchetypeId] = useState<SeferArchetypeId | null>(null);
  const selectedArchetype = getArchetypeById(archetypeId);
  const pickArchetype = (id: SeferArchetypeId | null) => {
    setArchetypeId(id);
    onArchetypeChange?.(id);
    if (!id) {
      setHistoricalRecipeId(null);
      return;
    }
    const archetype = getArchetypeById(id);
    if (!archetype) return;
    setSelectedLayout(archetype.baseLayout);
    setHistoricalRecipeId(archetype.recipeId);
  };
  // v0.9.0 Part B — the historical library recipe picked below (if any).
  // Picking one sets the base layout to the recipe's layout; the recipe
  // id is saved (pending seam) on submit and App applies it to the fresh
  // project. Clearing the pick (choosing a base preset) clears it.
  const [historicalRecipeId, setHistoricalRecipeId] = useState<string | null>(null);
  // v0.5.0 Part C — Module 3: boxes drawn for a custom layout (saved to
  // the pending-template store on submit; see REPORT.md).
  const [customBaseLayout, setCustomBaseLayout] = useState<BookLayoutType>('rav_text');
  const [customBoxes, setCustomBoxes] = useState<CustomLayoutBox[]>(() =>
    defaultBoxesForBaseLayout('rav_text')
  );

  // v0.9.9 — the ONE explicit chosen setup for the current selection:
  // custom boxes, a recipe (+ its archetype, when picked through one),
  // an archetype without a recipe, or a plain base layout. Built from
  // this form's own state and handed to App on submit — nothing is
  // written to localStorage any more.
  const buildChosenSetup = (): ChosenSetup => {
    if (selectedLayout === 'custom_layout') {
      // The project layout type stays 'custom_layout' (the box-flow
      // solver); customBaseLayout is the fallback solver carried
      // inside the boxes, as before.
      return {
        baseLayout: 'custom_layout',
        customLayout: {
          enabled: true,
          baseLayout: customBaseLayout,
          boxes: customBoxes,
          gridSizePt: 6,
          pageOverrides: {},
        },
      };
    }
    return {
      baseLayout: selectedLayout,
      ...(historicalRecipeId ? { recipeId: historicalRecipeId } : {}),
      ...(archetypeId ? { archetypeId } : {}),
    };
  };

  useEffect(() => {
    onSetupChange?.(buildChosenSetup(), title, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayout, historicalRecipeId, archetypeId, customBaseLayout, customBoxes, title, mode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim() || t("ספר חדש — כתר");
    onCreateProject(cleanTitle, selectedLayout, mode, buildChosenSetup());
  };

  return (
    <form
      data-testid={testId}
      onSubmit={handleSubmit}
      className={className}
    >
      {/* Title */}
      <div className="space-y-1.5">
        <label className="block font-semibold text-[var(--ui-text-secondary)]">
          {t("שם הספר / הפרויקט")}
        </label>
        <input
          type="text"
          data-testid={`${testId}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("למשל: חידושי סוגיות — מסכת ברכות")}
          className="w-full px-3.5 py-2.5 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--ui-accent)]"
          required
        />
      </div>

      {/* v0.9.8 Phase 1 — Wizard Step 1: archetype presets. Five cards;
          each one MAPS ONTO the existing core layout / historical recipe
          below (a preset is a selection + its calibrated defaults, not
          a new preset table): picking one selects that core card and
          that recipe in the existing state, and notifies the parent so
          the DOCX hub (Step 2, on Home) can tailor its slots. Picking a
          core card directly clears the archetype. */}
      <div className="space-y-2">
        <label className="block font-semibold text-[var(--ui-text-secondary)]">
          {t("סוג הספר — אשף ספר חדש (שלב 1 מתוך 3)")}
        </label>
        <div
          data-testid={`${testId}-wizard-archetypes`}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
        >
          {SEFER_ARCHETYPES.map(archetype => {
            const isSelected = archetypeId === archetype.id;
            return (
              <button
                key={archetype.id}
                type="button"
                data-testid={`${testId}-wizard-archetype-${archetype.id}`}
                onClick={() => pickArchetype(isSelected ? null : archetype.id)}
                className={`flex items-start gap-3 p-3 rounded-xl border text-start transition-all ${
                  isSelected
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)] shadow-2xs'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <div
                  className={`p-2 rounded-lg shrink-0 ${
                    isSelected
                      ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-fg)]'
                      : 'bg-[var(--ui-surface)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  <Scroll className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-xs flex items-center justify-between">
                    <span>{archetypeLabel(archetype, lang)}</span>
                    {isSelected && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-accent)] shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--ui-text-secondary)] mt-1 leading-relaxed">
                    {archetypeDescription(archetype, lang)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        {selectedArchetype && (
          <div className="space-y-1">
            <p className="text-[11px] text-[var(--ui-text-secondary)] leading-snug">
              {t("תבנית מכוילת: גודל הדף, השוליים והגופנים נקבעו מראש — אפשר לשנות הכול אחר כך בעיצוב.")}
            </p>
            {/* Technical numbers stay one click away, not in the label. */}
            <details className="text-[11px] text-[var(--ui-text-muted)]">
              <summary className="cursor-pointer hover:text-[var(--ui-text-secondary)]">{t("פרטים נוספים")}</summary>
              <p className="mt-1 leading-snug">
                {selectedArchetype.recipeId
                  ? `${selectedArchetype.recipeId} — ${archetypeDefaultsSummary(selectedArchetype)}`
                  : t("טור יחיד — ברירות המחדל של התוכנה (Frank Ruhl Libre 14.5pt)")}
              </p>
            </details>
          </div>
        )}
      </div>

      {/* v0.9.7 — Layout Type Selection: the ONE shared core list
          (CORE_START_LAYOUTS in layout-presets.ts): exactly 11 cards
          in ONE grid — the 7 base layouts + the 4 promoted historical
          recipes. The full historical library in shelves is GONE from
          this form (it overwhelmed the start screen, user photos
          2026-11-12); every recipe still lives in the unified library
          and stays pickable post-creation in the Design / Page design
          pickers. One-line descriptions only — the recipes' paragraph
          descriptions are NOT reused here. */}
      <div className="space-y-2">
        <label className="block font-semibold text-[var(--ui-text-secondary)]">
          {t("מתכונת עימוד (Book Layout)")}
        </label>
        <div
          data-testid={`${testId}-core-layouts`}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
        >
          {CORE_START_LAYOUTS.map((option) => {
            const isRecipe = option.kind === 'recipe';
            const isSelected = isRecipe
              ? historicalRecipeId === option.id
              : selectedLayout === option.baseLayout && !historicalRecipeId;
            return (
              <button
                key={option.id}
                type="button"
                data-testid={`${testId}-${isRecipe ? 'recipe' : 'layout'}-${option.id}`}
                onClick={() => {
                  if (isRecipe) {
                    const recipe = getRecipeById(option.id);
                    if (!recipe) return;
                    if (recipe.baseLayout) setSelectedLayout(recipe.baseLayout);
                    setHistoricalRecipeId(option.id);
                    // A directly-picked recipe is not a wizard archetype.
                    setArchetypeId(null);
                    onArchetypeChange?.(null);
                  } else {
                    setSelectedLayout(option.baseLayout);
                    pickArchetype(null);
                  }
                }}
                className={`flex items-start gap-3 p-3 rounded-xl border text-start transition-all ${
                  isSelected
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)] shadow-2xs'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                }`}
              >
                <div
                  className={`p-2 rounded-lg shrink-0 ${
                    isSelected
                      ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-fg)]'
                      : 'bg-[var(--ui-surface)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                  }`}
                >
                  {isRecipe ? (
                    <Scroll className="w-4 h-4" />
                  ) : (
                    LAYOUT_PRESET_ICONS[option.baseLayout]
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-xs flex items-center justify-between">
                    <span>{lang === 'he' ? option.labelHe : option.labelEn}</span>
                    {isSelected && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-accent)] shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--ui-text-secondary)] mt-1 leading-relaxed">
                    {lang === 'he' ? option.subLabelHe : option.subLabelEn}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        {historicalRecipeId && (
          <p className="text-[11px] text-[var(--ui-text-secondary)] leading-snug">
            {t('התבנית ההיסטורית תוחל על הספר החדש עם יצירתו — כולל גדלי גופנים ומסגרות.')}
          </p>
        )}

        {/* v0.9.9 — the full historical library, back as a collapsed
            view of the ONE registry (groupHistoricalLibrary over
            getHistoricalLayoutLibrary, 27 real recipes). Collapsed by
            default: the v0.9.7 start screen dropped the shelves because
            they overwhelmed it; a <details> keeps the 11-card grid the
            first thing the user sees while every recipe stays pickable
            here, not only post-creation. Picking one selects it exactly
            like a promoted recipe card above. */}
        <details className="pt-1">
          <summary className="cursor-pointer text-[11px] font-semibold text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]">
            {t("כל התבניות ההיסטוריות (27) — לחצו להצגה")}
          </summary>
          <div className="mt-2 space-y-3">
            {groupHistoricalLibrary(getHistoricalLayoutLibrary()).map(group => (
              <div key={group.key} className="space-y-1.5">
                <div className="text-[11px] font-bold text-[var(--ui-text-secondary)]">{group.labelHe}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {group.entries.map(entry => {
                    const isSelected = historicalRecipeId === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        data-testid={`${testId}-shelf-recipe-${entry.id}`}
                        onClick={() => {
                          const recipe = getRecipeById(entry.id);
                          if (!recipe) return;
                          if (recipe.baseLayout) setSelectedLayout(recipe.baseLayout);
                          setHistoricalRecipeId(entry.id);
                          setArchetypeId(null);
                          onArchetypeChange?.(null);
                        }}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-start transition-all ${
                          isSelected
                            ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)]'
                            : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
                        }`}
                      >
                        <Scroll className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--ui-text-secondary)]" />
                        <span className="min-w-0">
                          <span className="block font-bold text-xs truncate">
                            {lang === 'he' ? entry.nameHe : entry.nameEn}
                          </span>
                          <span className="block text-[11px] text-[var(--ui-text-secondary)] leading-snug">
                            {lang === 'he' ? entry.descriptionHe : entry.descriptionEn}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* v0.5.0 Part C — Module 3: draw the boxes for a custom layout */}
      {selectedLayout === 'custom_layout' && (
        <div className="rounded-xl border border-[var(--ui-accent)]/35 bg-[var(--ui-selected-bg)]/50 p-3.5">
          <CustomLayoutDesigner
            boxes={customBoxes}
            onBoxesChange={setCustomBoxes}
            baseLayout={customBaseLayout}
            onBaseLayoutChange={next => {
              setCustomBaseLayout(next);
              setCustomBoxes(defaultBoxesForBaseLayout(next));
            }}
            compact
          />
        </div>
      )}

      {/* Initial Content Mode */}
      <div className="space-y-2.5">
        <label className="block font-semibold text-[var(--ui-text-secondary)]">
          {t("תוכן התחלתי לפרויקט")}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            data-testid={`${testId}-starter-blank`}
            onClick={() => setMode('blank')}
            className={`p-3.5 rounded-xl border text-start transition-all ${
              mode === 'blank'
                ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)]'
                : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
            }`}
          >
            <div className="font-bold flex items-center justify-between">
              <span>{t("מסמך חדש נקי (מוכן להקלדה / ייבוא וורד)")}</span>
              {mode === 'blank' && (
                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
              )}
            </div>
            <p className="text-[11px] text-[var(--ui-text-secondary)] mt-1">
              {t("מתחיל עם פסקת פתיחה נקייה שניתן לערוך מיד או להחליף בייבוא DOCX.")}
            </p>
          </button>

          <button
            type="button"
            data-testid={`${testId}-starter-sample`}
            onClick={() => setMode('sample')}
            className={`p-3.5 rounded-xl border text-start transition-all ${
              mode === 'sample'
                ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)]'
                : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
            }`}
          >
            <div className="font-bold flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
                <span>{t("טקסט תורני לדוגמה (מסכת ברכות דף ב׳)")}</span>
              </span>
              {mode === 'sample' && (
                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ui-accent)]" />
              )}
            </div>
            <p className="text-[11px] text-[var(--ui-text-secondary)] mt-1">
              {t("טוען טקסט מלא של גמרא, רש״י ותוספות לבחינת העימוד והברכיים הדינמיות.")}
            </p>
          </button>
        </div>
      </div>

      {/* Footer (hidden when the parent owns the actions — Home's Step 2) */}
      {footerMode !== 'none' && (
      <div className="pt-3 border-t border-[var(--ui-border)] flex items-center justify-end gap-2.5">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] font-medium transition-colors"
          >
            {cancelLabel ?? t("ביטול")}
          </button>
        )}
        <button
          type="submit"
          data-testid={`${testId}-submit`}
          className="px-5 py-2 rounded-lg bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-[var(--ui-accent-fg)] font-semibold flex items-center gap-2 shadow-xs transition-all"
        >
          <FilePlus2 className="w-4 h-4" />
          <span>{submitLabel}</span>
        </button>
      </div>
      )}
    </form>
  );
};
