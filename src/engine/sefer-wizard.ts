/**
 * v0.9.8 Phase 1 — New Sefer Wizard (3 steps).
 *
 * EXTENDS the v0.9.7 start screen (NewProjectForm + DocxImportHub) —
 * it does NOT replace them and does NOT create a second preset/form
 * system.
 *
 * An archetype is a SELECTION of an existing core layout / historical
 * recipe plus its calibrated defaults — never a parallel preset table:
 * - the core layout comes from `CORE_START_LAYOUTS`
 *   (layout-presets.ts, the one shared start-screen list);
 * - the recipe (when there is one) is a real entry of the unified
 *   historical library (`getRecipeById`); its own `page` geometry,
 *   `typography` and `headerFooter` ARE the pre-calibrated Tzuras
 *   HaDaf values (margins, fonts, running headers) — read live from
 *   the recipe, not copied into a second table here;
 * - the "classic single-column sefer" archetype has no recipe: its
 *   calibrated defaults are the app's own `createDefaultSettings`
 *   single-column values (Frank Ruhl Libre 14.5, royal page).
 *
 * Step 1 — pick an archetype (5 cards). Step 2 — the multi-slot DOCX
 * dropzone tailored to the archetype (slots are role presets on top of
 * the v0.9.7 DocxImportHub's per-file role tagging; the hub engine is
 * reused unchanged). Step 3 — "Generate Sefer Layout": the hub's real
 * import → auto-link → auto-layout → paginate pipeline (the linking
 * engine itself is a later worker's job — the button calls the real
 * existing pipeline, and the wizard says so plainly).
 *
 * Archetype → import steering (v0.9.9): the chosen setup travels as
 * one explicit `ChosenSetup` value (see below) through App's
 * `handleCreateNewProject` / `handleImportUnits` — no localStorage
 * seam. The four old pending keys are honoured exactly once by
 * `migratePendingChosenSetup` (for a choice stored before this
 * release) and then deleted. The user's explicit choice still wins
 * over the classifier's guess.
 */

import type { BookLayoutType, ContentRole } from '../types/typesetter';
import { CORE_START_LAYOUTS, type CoreStartLayoutOption } from './layout-presets';
import { getRecipeById } from './historical-layouts';
import type { LayoutRecipe } from './layout-recipes';
import { consumePendingHistoricalRecipe } from './layout-recipes';
import { consumePendingCustomLayout } from './custom-layout-engine';
import { applyRecipeToSettingsById } from './auto-layout';
import type { CustomLayoutDesign, ProfessionalDesignSettings } from '../types/design-settings';
// v0.9.8 Phase 1 — bilingual labels live in the strict tables in
// i18n/strings.ts (Record<Id, { he, en }>): TypeScript fails the build
// if any archetype or slot lacks a label in either language (the
// v0.9.1 lesson). This module renders through the helpers below.
import {
  SEFER_ARCHETYPE_LABELS,
  SEFER_ARCHETYPE_DESCRIPTIONS,
  WIZARD_SLOT_LABELS,
  WIZARD_SLOT_HINTS,
  type BilingualLabel,
  type SeferArchetypeId,
  type WizardSlotKey,
} from '../i18n/strings';

export type { SeferArchetypeId, WizardSlotKey } from '../i18n/strings';

export type UiLang = 'he' | 'en';

function pickLabel(label: BilingualLabel, lang: UiLang): string {
  return lang === 'he' ? label.he : label.en;
}

/** Archetype display name in the UI language. */
export function archetypeLabel(archetype: SeferArchetype, lang: UiLang): string {
  return pickLabel(SEFER_ARCHETYPE_LABELS[archetype.id], lang);
}

/** Archetype one-line description in the UI language. */
export function archetypeDescription(archetype: SeferArchetype, lang: UiLang): string {
  return pickLabel(SEFER_ARCHETYPE_DESCRIPTIONS[archetype.id], lang);
}

/**
 * Slot display name in the UI language. Extra slots carry keys like
 * `additional-mefaresh-2` — they resolve to the base
 * `additional-mefaresh` entry (the key shape is enforced by the type
 * below, so no slot can ever reach this helper unlabelled).
 */
export function wizardSlotLabel(slot: WizardSlot, lang: UiLang): string {
  const key = slot.key.startsWith('additional-mefaresh-')
    ? 'additional-mefaresh'
    : (slot.key as WizardSlotKey);
  return pickLabel(WIZARD_SLOT_LABELS[key], lang);
}

/** Slot hint line in the UI language. */
export function wizardSlotHint(slot: WizardSlot, lang: UiLang): string {
  const key = slot.key.startsWith('additional-mefaresh-')
    ? 'additional-mefaresh'
    : (slot.key as WizardSlotKey);
  return pickLabel(WIZARD_SLOT_HINTS[key], lang);
}

/**
 * Wizard Step 2 title, composed in the UI language (one whole string
 * per language — never translated fragments like "(" / "):").
 */
export function wizardStep2Title(archetype: SeferArchetype, lang: UiLang): string {
  return lang === 'he'
    ? `שלב 2 — קבצי Word לפי תפקיד (${archetypeLabel(archetype, 'he')}):`
    : `Step 2 — Word files by role (${archetypeLabel(archetype, 'en')}):`;
}

export interface WizardSlot {
  /** Stable key within the archetype (used as React key + testid). */
  key: WizardSlotKey | `additional-mefaresh-${number}`;
  /** Engine role the file dropped in this slot is tagged with. */
  role: ContentRole;
  /** Slot must hold a file before Generate (slot 1 of every archetype). */
  required: boolean;
}

export interface SeferArchetype {
  id: SeferArchetypeId;
  /** Core start-screen card this archetype selects. */
  coreLayoutId: string;
  baseLayout: BookLayoutType;
  /** Historical recipe id, when the archetype maps to one (null = none). */
  recipeId: string | null;
  /** Slot matrix for Step 2. */
  slots: WizardSlot[];
  /** Extra mefaresh slot appended by "Add Additional Mefaresh". */
  additionalSlot: WizardSlot;
}

const ADDITIONAL_MEFARESH: WizardSlot = {
  key: 'additional-mefaresh',
  role: 'tertiary_comment',
  required: false,
};

export const SEFER_ARCHETYPES: ReadonlyArray<SeferArchetype> = Object.freeze([
  {
    id: 'shas',
    coreLayoutId: 'rav_text',
    baseLayout: 'rav_text',
    recipeId: 'talmud-bavli',
    slots: [
      { key: 'gemara', role: 'main_source', required: true },
      { key: 'rashi', role: 'primary_comment', required: false },
      { key: 'tosafot', role: 'secondary_comment', required: false },
    ],
    additionalSlot: ADDITIONAL_MEFARESH,
  },
  {
    id: 'chumash',
    coreLayoutId: 'mikraot_gedolot',
    baseLayout: 'mikraot_gedolot',
    recipeId: 'chumash-rishonim',
    slots: [
      { key: 'chumash', role: 'main_source', required: true },
      { key: 'targum', role: 'verse', required: false },
      { key: 'rashi', role: 'primary_comment', required: false },
      { key: 'ramban', role: 'secondary_comment', required: false },
      { key: 'ibn-ezra', role: 'tertiary_comment', required: false },
      { key: 'sforno', role: 'tertiary_comment', required: false },
    ],
    additionalSlot: ADDITIONAL_MEFARESH,
  },
  {
    id: 'mishnayos',
    coreLayoutId: 'mishnah-classic',
    baseLayout: 'single_column',
    recipeId: 'mishnah-classic',
    slots: [
      { key: 'mishnah', role: 'main_source', required: true },
      { key: 'bartenura', role: 'primary_comment', required: false },
      { key: 'tosafot-yom-tov', role: 'secondary_comment', required: false },
    ],
    additionalSlot: ADDITIONAL_MEFARESH,
  },
  {
    id: 'halacha',
    coreLayoutId: 'shulchan-aruch',
    baseLayout: 'two_column',
    recipeId: 'shulchan-aruch',
    slots: [
      { key: 'shulchan-aruch', role: 'main_source', required: true },
      { key: 'mishnah-berurah', role: 'primary_comment', required: false },
      { key: 'biur-halacha', role: 'secondary_comment', required: false },
    ],
    additionalSlot: ADDITIONAL_MEFARESH,
  },
  {
    id: 'classic',
    coreLayoutId: 'single_column',
    baseLayout: 'single_column',
    recipeId: null,
    slots: [
      { key: 'main-text', role: 'main_source', required: true },
      { key: 'commentary', role: 'primary_comment', required: false },
      { key: 'footnotes', role: 'footnote', required: false },
    ],
    additionalSlot: ADDITIONAL_MEFARESH,
  },
]);

export function getArchetypeById(id: string | null | undefined): SeferArchetype | undefined {
  if (!id) return undefined;
  return SEFER_ARCHETYPES.find(a => a.id === id);
}

/** The recipe an archetype maps to (live lookup — no copied numbers). */
export function getArchetypeRecipe(archetype: SeferArchetype): LayoutRecipe | undefined {
  if (!archetype.recipeId) return undefined;
  return getRecipeById(archetype.recipeId);
}

/**
 * Verify the mapping (used by the smoke script): every archetype's
 * coreLayoutId must exist in CORE_START_LAYOUTS and its recipeId (when
 * set) must exist in the historical library.
 */
export function validateArchetypeMapping(): string[] {
  const errors: string[] = [];
  for (const a of SEFER_ARCHETYPES) {
    const core = CORE_START_LAYOUTS.find(o => o.id === a.coreLayoutId);
    if (!core) errors.push(`archetype ${a.id}: core layout '${a.coreLayoutId}' missing from CORE_START_LAYOUTS`);
    else if (core.baseLayout !== a.baseLayout) {
      errors.push(`archetype ${a.id}: core layout base '${core.baseLayout}' ≠ archetype base '${a.baseLayout}'`);
    }
    if (a.recipeId && !getRecipeById(a.recipeId)) {
      errors.push(`archetype ${a.id}: recipe '${a.recipeId}' missing from the historical library`);
    }
    if (a.slots.filter(s => s.required).length !== 1) {
      errors.push(`archetype ${a.id}: expected exactly one required slot, got ${a.slots.filter(s => s.required).length}`);
    }
  }
  return errors;
}

/** One-line calibrated-defaults summary, read live from the recipe. */
export function archetypeDefaultsSummary(archetype: SeferArchetype): string {
  const recipe = getArchetypeRecipe(archetype);
  if (recipe?.page) {
    const p = recipe.page;
    const main = recipe.typography?.mainFontSizePt;
    const comm = recipe.typography?.commentaryFontSizePt;
    return `${p.widthMm}×${p.heightMm} mm · margins ${p.marginTopMm}/${p.marginBottomMm}/${p.marginInsideMm}/${p.marginOutsideMm} mm` +
      (main ? ` · main ${main}pt` : '') +
      (comm ? ` · commentary ${comm}pt` : '') +
      (recipe.headerFooter?.folioStyle ? ` · folio ${recipe.headerFooter.folioStyle} (off by default)` : '');
  }
  return 'Single column · Frank Ruhl Libre 14.5pt · royal page (default settings)';
}

/* ── Pending archetype seam (wizard import → App, consumed once) ─── */

const PENDING_ARCHETYPE_KEY = 'keter-pending-archetype';

export function consumePendingArchetype(): SeferArchetypeId | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(PENDING_ARCHETYPE_KEY);
    if (v) localStorage.removeItem(PENDING_ARCHETYPE_KEY);
    return (SEFER_ARCHETYPES.some(a => a.id === v) ? v : null) as SeferArchetypeId | null;
  } catch {
    return null;
  }
}

export function clearPendingArchetype(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PENDING_ARCHETYPE_KEY);
  } catch {
    // Best-effort.
  }
}

const PENDING_EXPLICIT_LAYOUT_KEY = 'keter-pending-explicit-layout';

export function consumePendingExplicitLayout(): BookLayoutType | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(PENDING_EXPLICIT_LAYOUT_KEY);
    if (v) localStorage.removeItem(PENDING_EXPLICIT_LAYOUT_KEY);
    return (v as BookLayoutType) || null;
  } catch {
    return null;
  }
}

export function clearPendingExplicitLayout(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PENDING_EXPLICIT_LAYOUT_KEY);
  } catch {
    // Best-effort.
  }
}

/**
 * v0.9.9 — ONE explicit "chosen setup": the pre-creation choice (base
 * layout + optional recipe / archetype / custom boxes) as a plain
 * in-memory value passed through handleCreateNewProject /
 * handleImportUnits. It replaces the four invisible consume-once
 * localStorage seams below (which are kept ONLY as a one-time migration
 * — see migratePendingChosenSetup — so an in-flight choice made before
 * this release is not lost, then deleted). Nothing in the creation flow
 * writes localStorage any more; the setup is visible in the call.
 */
export interface ChosenSetup {
  /** Base layout the book is created with. */
  baseLayout: BookLayoutType;
  /** Historical recipe id, when the choice is a recipe / archetype. */
  recipeId?: string;
  /** Wizard archetype id, when the choice came from an archetype card. */
  archetypeId?: SeferArchetypeId;
  /** Drawn custom-layout boxes, when the choice is a custom layout. */
  customLayout?: CustomLayoutDesign;
}

/** The chosen setup for one of the 11 start-screen cards. */
export function chosenSetupFromStartOption(option: CoreStartLayoutOption): ChosenSetup {
  return {
    baseLayout: option.baseLayout,
    ...(option.recipeId ? { recipeId: option.recipeId } : {}),
    archetypeId: slotArchetypeForStartOption(option.id),
  };
}

/**
 * One-time migration for the four retired pending seams. Reads (and
 * deletes) any stored choice exactly once, in the old precedence
 * (custom > archetype > recipe > explicit layout); returns null when
 * nothing was stored. Callers pass an explicit ChosenSetup when they
 * have one and fall back to this only when they do not.
 */
export function migratePendingChosenSetup(): ChosenSetup | null {
  const pendingCustom = consumePendingCustomLayout();
  if (pendingCustom) {
    return { baseLayout: 'custom_layout', customLayout: pendingCustom };
  }
  const pendingArchetype = consumePendingArchetype();
  if (pendingArchetype) {
    const archetype = getArchetypeById(pendingArchetype);
    return {
      baseLayout: archetype?.baseLayout ?? 'single_column',
      ...(archetype?.recipeId ? { recipeId: archetype.recipeId } : {}),
      archetypeId: pendingArchetype,
    };
  }
  const pendingRecipeId = consumePendingHistoricalRecipe();
  if (pendingRecipeId) {
    const recipe = getRecipeById(pendingRecipeId);
    return {
      baseLayout: recipe?.baseLayout ?? 'single_column',
      recipeId: pendingRecipeId,
    };
  }
  const pendingExplicitLayout = consumePendingExplicitLayout();
  if (pendingExplicitLayout) {
    return { baseLayout: pendingExplicitLayout };
  }
  return null;
}

/**
 * Maps any of the 11 CORE_START_LAYOUTS option ids to the matching
 * Step 2 DOCX upload slot archetype matrix.
 */
export function slotArchetypeForStartOption(optionId: string): SeferArchetypeId {
  switch (optionId) {
    case 'rav_text':
      return 'shas';
    case 'mikraot_gedolot':
    case 'chumash-rishonim':
      return 'chumash';
    case 'mishnah-classic':
      return 'mishnayos';
    case 'shulchan-aruch':
      return 'halacha';
    default:
      return 'classic';
  }
}

/**
 * v0.9.9 — the DOCX slot matrix for one start-screen card, as its own
 * matrix (not via the 5 archetypes). The old mapping collapsed
 * Yiddish / Siddur / two-column / source-top onto 'classic', so a
 * Yiddish book got the generic single-column slots instead of its own:
 * Hebrew source facing Yiddish translation. Slot keys reuse the
 * existing WizardSlotKey labels (no new strings); only the ROLES
 * differ per layout.
 */
export function slotMatrixForStartOption(optionId: string): WizardSlot[] {
  const archetypeSlots = (id: SeferArchetypeId): WizardSlot[] =>
    [...(getArchetypeById(id)?.slots ?? [])];
  switch (optionId) {
    case 'rav_text':
      return archetypeSlots('shas');
    case 'mikraot_gedolot':
    case 'chumash-rishonim':
      return archetypeSlots('chumash');
    case 'mishnah-classic':
      return archetypeSlots('mishnayos');
    case 'shulchan-aruch':
      return archetypeSlots('halacha');
    // Yiddish sefer: Hebrew source (right column) facing Yiddish
    // translation / commentary (left column), footnotes below.
    case 'yiddish_sefer':
      return [
        { key: 'main-text', role: 'main_source', required: true },
        { key: 'commentary', role: 'primary_comment', required: false },
        { key: 'footnotes', role: 'footnote', required: false },
      ];
    // Siddur: one column of prayer text; a second file is the
    // commentary / kavanot, not a second source column.
    case 'siddur':
      return [
        { key: 'main-text', role: 'main_source', required: true },
        { key: 'commentary', role: 'primary_comment', required: false },
      ];
    // Two balanced columns: source in one column, commentary in the
    // other (same roles as the classic matrix, kept explicit so the
    // mapping is visible per layout instead of falling through).
    case 'two_column':
      return [
        { key: 'main-text', role: 'main_source', required: true },
        { key: 'commentary', role: 'primary_comment', required: false },
        { key: 'footnotes', role: 'footnote', required: false },
      ];
    // Upper source + commentaries below: source on top, the long
    // commentary (e.g. Mishnah Berurah) underneath it.
    case 'source_top_commentary_bottom':
      return [
        { key: 'main-text', role: 'main_source', required: true },
        { key: 'commentary', role: 'primary_comment', required: false },
        { key: 'footnotes', role: 'footnote', required: false },
      ];
    default:
      return archetypeSlots('classic');
  }
}

/**
 * v0.9.9 — Apply an archetype's recipe to fresh design settings.
 * This is now EXACTLY the Design-panel recipe path (the single
 * applyRecipeToSettingsById in auto-layout.ts): the old
 * applySettledDefaultsOff step — which forced the header line, folio
 * and commentary labels OFF for wizard books only — is deleted, so
 * the same recipe lands the same way whether it arrived via the
 * wizard, the modal, the import classifier or the Design panel.
 * Returns the settings unchanged when the archetype has no recipe
 * (classic) or the recipe cannot be resolved.
 */
export function applyArchetypeToSettings(
  archetypeId: SeferArchetypeId,
  settings: ProfessionalDesignSettings
): ProfessionalDesignSettings {
  const archetype = getArchetypeById(archetypeId);
  if (!archetype) return settings;
  if (!archetype.recipeId) return settings;
  return applyRecipeToSettingsById(archetype.recipeId, settings);
}
