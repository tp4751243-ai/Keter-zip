/**
 * v0.9.9 — ONE layout/recipe picker (Part A §4).
 *
 * The same choice used to be rendered in four different shapes: the
 * header layout menu (base layouts only), the auto-layout banner (a
 * bare LAYOUT_PRESET_OPTIONS select whose Apply ran a different layout
 * model — handleLayoutTypeChange — from the recipe path), the Design
 * panel (Ready Designs) and the AI actions. This component is the one
 * extraction all of them render: one <select> whose options are the
 * ONE registry — the 27 real historical recipes (getHistoricalLayout
 * Library, aliases excluded so Vilna Shas / Tzenerene do not appear
 * twice) plus the 7 base layouts — and one selection type, so the
 * caller always applies the same recipe path.
 *
 * A selection is either a recipe (applied through the single
 * applyRecipeToSettingsById, which records the recipe id on the
 * design) or a plain base layout (applied through the layout switch).
 * The component itself applies nothing; it reports the selection and
 * the caller decides when to apply (the banner's Apply button, the
 * header menu's immediate apply, …).
 *
 * Wired in v0.9.9 into the auto-layout banner (App.tsx) only. The
 * header menu (EditorialStudioHeader.tsx) and the Design panel
 * (DesignTypesettingPanel.tsx) are outside this agent's ownership —
 * they should render this picker instead of their own selects (see
 * the coordinator report).
 */
import { useEffect, useState } from 'react';
import type { BookLayoutType } from '../types/typesetter';
import { LAYOUT_PRESET_OPTIONS } from '../engine/layout-presets';
import { getHistoricalLayoutLibrary, resolveHistoricalRecipe } from '../engine/historical-layouts';

/** One picker selection: a recipe, or a plain base layout. */
export type LayoutRecipeSelection =
  | { kind: 'recipe'; recipeId: string }
  | { kind: 'layout'; layoutType: BookLayoutType };

interface LayoutRecipePickerProps {
  /** Recipe currently applied (or ''), used to initialise the selection. */
  initialRecipeId?: string;
  /** Base layout currently applied, used when no recipe is applied. */
  initialLayout?: BookLayoutType | '';
  /** Called with the current selection whenever it changes. */
  onSelectionChange?: (selection: LayoutRecipeSelection) => void;
  /** Language for the option labels. */
  lang?: 'he' | 'en';
  /** Accessible title for the select. */
  title?: string;
}

const FALLBACK_RECIPE_TO_LAYOUT: Record<string, BookLayoutType> = {
  'single-column': 'single_column',
  'two-column': 'two_column',
};

function encodeSelection(sel: LayoutRecipeSelection): string {
  return sel.kind === 'recipe' ? `recipe:${sel.recipeId}` : `layout:${sel.layoutType}`;
}

function decodeSelection(value: string): LayoutRecipeSelection | null {
  if (value.startsWith('recipe:')) return { kind: 'recipe', recipeId: value.slice('recipe:'.length) };
  if (value.startsWith('layout:')) return { kind: 'layout', layoutType: value.slice('layout:'.length) as BookLayoutType };
  return null;
}

export function LayoutRecipePicker({
  initialRecipeId,
  initialLayout,
  onSelectionChange,
  lang = 'he',
  title,
}: LayoutRecipePickerProps) {
  const initialSelection = (): LayoutRecipeSelection => {
    if (initialRecipeId) {
      const fallbackLayout = FALLBACK_RECIPE_TO_LAYOUT[initialRecipeId];
      if (fallbackLayout) return { kind: 'layout', layoutType: fallbackLayout };
      // An alias id ('vilna-shas', 'tzenerene') resolves to its target
      // for display — the library lists each layout once.
      const resolved = resolveHistoricalRecipe(initialRecipeId);
      if (resolved) return { kind: 'recipe', recipeId: resolved.metadata.id };
    }
    return { kind: 'layout', layoutType: (initialLayout || 'single_column') as BookLayoutType };
  };

  const [value, setValue] = useState<string>(() => encodeSelection(initialSelection()));
  // A new notice (next import) resets the selection to what was applied.
  useEffect(() => {
    setValue(encodeSelection(initialSelection()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRecipeId, initialLayout]);

  const recipes = getHistoricalLayoutLibrary();

  return (
    <select
      value={value}
      onChange={e => {
        const next = e.target.value;
        setValue(next);
        const sel = decodeSelection(next);
        if (sel) onSelectionChange?.(sel);
      }}
      className="bg-stone-900 border border-stone-700 text-stone-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-500"
      title={title}
    >
      <optgroup label={lang === 'en' ? 'Historical recipes' : 'תבניות היסטוריות'}>
        {recipes.map(r => (
          <option key={r.id} value={`recipe:${r.id}`}>
            {lang === 'en' ? r.nameEn : r.nameHe}
          </option>
        ))}
      </optgroup>
      <optgroup label={lang === 'en' ? 'Base layouts' : 'פריסות בסיס'}>
        {LAYOUT_PRESET_OPTIONS.map(o => (
          <option key={o.id} value={`layout:${o.id}`}>
            {lang === 'en' ? o.labelEn : o.labelHe}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
