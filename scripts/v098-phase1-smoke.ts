/**
 * KETER-TYPE v0.9.8 Phase 1 — Developer Mode + New Sefer Wizard smoke test.
 *
 * Run from the repo root:  npx tsx scripts/v098-phase1-smoke.ts
 *
 * Verifies (pure engine checks + source-level wiring checks; the live
 * DOM checks live in scripts/v098-phase1-playwright-smoke.mjs):
 *  §1  Developer Mode: default OFF, toggle persists in localStorage,
 *      Ctrl+Shift+D is the documented shortcut (App keydown handler).
 *  §2  No developer/QA surface is reachable when OFF: the header
 *      menu's developer section, the status-bar QA button, the
 *      Automated Test panel, the architecture-report modal and the
 *      QA-fix list are all gated on developerMode in source, and the
 *      removed v0.4.0 inspectors (DynamicKneeInspector,
 *      DocumentHierarchyInspector) are referenced nowhere.
 *  §3  Wizard archetypes: exactly 5, each mapping onto an existing
 *      core start-screen layout + an existing historical recipe (or
 *      none for classic), with a slot matrix whose roles are real
 *      engine roles and exactly one required slot.
 *  §4  Slot matrices: Shas (Gemara/Rashi/Tosafot + additional
 *      mefaresh), Chumash (Chumash/Targum/Rashi/Ramban/Ibn Ezra/
 *      Sforno), Mishnayot, Halacha, Classic.
 *  §5  Calibrated defaults are read live from the mapped recipe
 *      (geometry/margins/fonts/running headers) — no second table.
 *  §6  Pending-archetype seam round-trips and is consumed once.
 *  §7  Per-role typography defaults use only bundled fonts.
 *  §8  version is 0.9.8.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDeveloperModeEnabled,
  setDeveloperModeEnabled,
  DEVELOPER_MODE_STORAGE_KEY,
} from '../src/engine/developer-mode';
import {
  SEFER_ARCHETYPES,
  getArchetypeById,
  validateArchetypeMapping,
  archetypeDefaultsSummary,
  archetypeLabel,
  archetypeDescription,
  wizardSlotLabel,
  wizardSlotHint,
  wizardStep2Title,
  savePendingArchetype,
  consumePendingArchetype,
} from '../src/engine/sefer-wizard';
import { CORE_START_LAYOUTS } from '../src/engine/layout-presets';
import { roleTypographyDefault, BUNDLED_FONT_AVAILABILITY, formatPreviewCounts, type DocxPreviewStats } from '../src/engine/docx-semantics';
import {
  EN_STRINGS,
  SEFER_ARCHETYPE_LABELS,
  SEFER_ARCHETYPE_DESCRIPTIONS,
  WIZARD_SLOT_LABELS,
  WIZARD_SLOT_HINTS,
} from '../src/i18n/strings';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (p: string): string => fs.readFileSync(p, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Minimal localStorage shim (developer-mode + pending seams only).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function main(): void {
  console.log('v098-phase1-smoke: developer mode + sefer wizard');

  // ── §1 — Developer Mode ───────────────────────────────────────
  {
    store.clear();
    check('§1 default OFF (no stored value)', isDeveloperModeEnabled() === false);
    setDeveloperModeEnabled(true);
    check('§1 toggle ON persists', isDeveloperModeEnabled() === true && store.get(DEVELOPER_MODE_STORAGE_KEY) === '1');
    setDeveloperModeEnabled(false);
    check('§1 toggle OFF persists', isDeveloperModeEnabled() === false && store.get(DEVELOPER_MODE_STORAGE_KEY) === '0');
    const app = read(path.join(SRC, 'App.tsx'));
    check('§1 Ctrl+Shift+D handler exists in App', app.includes("e.ctrlKey && e.shiftKey") && app.includes("'D'"));
    check('§1 header gets developerMode + toggle props', app.includes('developerMode={developerMode}') && app.includes('onToggleDeveloperMode={handleToggleDeveloperMode}'));
    const header = read(path.join(SRC, 'components', 'EditorialStudioHeader.tsx'));
    check('§1 header has a discreet always-visible toggle', header.includes('data-testid="developer-mode-toggle"') && header.includes('מצב מפתח'));
  }

  // ── §2 — nothing dev/QA reachable when OFF ────────────────────
  {
    const app = read(path.join(SRC, 'App.tsx'));
    check('§2 test panel mount gated on developerMode', app.includes('developerMode && isTestPanelOpen'));
    check('§2 report modal mount gated on developerMode', app.includes('developerMode && isReportModalOpen'));
    check('§2 QA-fix panel mount gated on developerMode', app.includes('developerMode && showQaFixList'));
    check('§2 QA-fix toolbar button gated on developerMode', app.includes('{developerMode && (') && app.includes('תיקוני עמוד'));
    const header = read(path.join(SRC, 'components', 'EditorialStudioHeader.tsx'));
    check('§2 header dev section renders only when developerMode', header.includes('{developerMode && (') && header.includes('כלים למפתחים'));
    const status = read(path.join(SRC, 'components', 'WorkspaceStatusBar.tsx'));
    check('§2 status-bar QA button only when developerMode', status.includes('developerMode ? (') && status.includes('data-testid="statusbar-qa-button"'));
    check('§2 status-bar still shows the score as plain text when OFF', status.includes('data-testid="statusbar-qa-score"'));
    const allSrc = [
      ...fs.readdirSync(path.join(SRC, 'components')).map(f => read(path.join(SRC, 'components', f))),
      ...fs.readdirSync(path.join(SRC, 'engine')).map(f => read(path.join(SRC, 'engine', f))),
      read(path.join(SRC, 'App.tsx')),
    ].join('\n');
    check('§2 DynamicKneeInspector referenced nowhere', !allSrc.includes('DynamicKneeInspector'));
    check('§2 DocumentHierarchyInspector referenced nowhere', !allSrc.includes('DocumentHierarchyInspector'));
    check('§2 no stage-badge component exists anywhere in src', !allSrc.includes('stageBadge') && !allSrc.includes('StageBadge') && !allSrc.includes('stage badge'));
    // The test_* names exist only as internal export-stage ids (the
    // export filename logic) — they are never rendered as UI badges.
    // (Verified by the Playwright drive: no test_* string is visible.)
    // The command palette carries no dev commands (checked by name).
    const palette = read(path.join(SRC, 'App.tsx'));
    check('§2 palette has no test/report commands', !palette.includes("id: 'test'") && !palette.includes("id: 'report'"));
    // Editorial verification stays visible: proofreading + Shas check are NOT dev-gated.
    check('§2 proofreading + Shas check stay visible (editorial, not dev)', !app.includes('developerMode && isProofingOpen') && !app.includes('developerMode && showShasPanel'));
  }

  // ── §3 — archetype mapping ────────────────────────────────────
  {
    check('§3 exactly 5 archetypes', SEFER_ARCHETYPES.length === 5, `got=${SEFER_ARCHETYPES.length}`);
    const errors = validateArchetypeMapping();
    check('§3 every archetype maps to an existing core layout + recipe', errors.length === 0, errors.join('; '));
    const expected: Record<string, { core: string; recipe: string | null; base: string }> = {
      shas: { core: 'rav_text', recipe: 'talmud-bavli', base: 'rav_text' },
      chumash: { core: 'mikraot_gedolot', recipe: 'chumash-rishonim', base: 'mikraot_gedolot' },
      mishnayos: { core: 'mishnah-classic', recipe: 'mishnah-classic', base: 'single_column' },
      halacha: { core: 'shulchan-aruch', recipe: 'shulchan-aruch', base: 'two_column' },
      classic: { core: 'single_column', recipe: null, base: 'single_column' },
    };
    for (const [id, want] of Object.entries(expected)) {
      const a = getArchetypeById(id)!;
      check(
        `§3 ${id} → core ${want.core} + recipe ${want.recipe ?? 'none'}`,
        a.coreLayoutId === want.core && a.recipeId === want.recipe && a.baseLayout === want.base
      );
    }
    check('§3 core layout ids are all in CORE_START_LAYOUTS', SEFER_ARCHETYPES.every(a => CORE_START_LAYOUTS.some(o => o.id === a.coreLayoutId)));
  }

  // ── §4 — slot matrices ────────────────────────────────────────
  {
    const roles = (id: string) => getArchetypeById(id)!.slots.map(s => `${s.key}:${s.role}`).join(',');
    check('§4 Shas slots: Gemara/Rashi/Tosafot', roles('shas') === 'gemara:main_source,rashi:primary_comment,tosafot:secondary_comment', roles('shas'));
    check('§4 Chumash slots: Chumash/Targum/Rashi/Ramban/Ibn Ezra/Sforno', roles('chumash') === 'chumash:main_source,targum:verse,rashi:primary_comment,ramban:secondary_comment,ibn-ezra:tertiary_comment,sforno:tertiary_comment', roles('chumash'));
    check('§4 Mishnayot slots', roles('mishnayos') === 'mishnah:main_source,bartenura:primary_comment,tosafot-yom-tov:secondary_comment', roles('mishnayos'));
    check('§4 Halacha slots', roles('halacha') === 'shulchan-aruch:main_source,mishnah-berurah:primary_comment,biur-halacha:secondary_comment', roles('halacha'));
    check('§4 Classic slots', roles('classic') === 'main-text:main_source,commentary:primary_comment,footnotes:footnote', roles('classic'));
    check('§4 every archetype has an additional-mefaresh slot', SEFER_ARCHETYPES.every(a => a.additionalSlot.role === 'tertiary_comment'));
    check('§4 exactly one required slot per archetype', SEFER_ARCHETYPES.every(a => a.slots.filter(s => s.required).length === 1));
    check('§4 every slot role is a real engine role', SEFER_ARCHETYPES.every(a =>
      a.slots.every(s => ['main_source', 'verse', 'primary_comment', 'secondary_comment', 'tertiary_comment', 'footnote'].includes(s.role))
    ));
  }

  // ── §5 — calibrated defaults read live from the recipe ────────
  {
    const shas = archetypeDefaultsSummary(getArchetypeById('shas')!);
    check('§5 Shas defaults: page mm + margins + fonts from talmud-bavli', shas.includes('240×340 mm') && shas.includes('14.5pt') && shas.includes('10.5pt'), shas);
    const chumash = archetypeDefaultsSummary(getArchetypeById('chumash')!);
    check('§5 Chumash defaults come from chumash-rishonim', chumash.includes('mm') && chumash.includes('pt'), chumash);
    check('§5 Classic (no recipe) falls back to defaults', archetypeDefaultsSummary(getArchetypeById('classic')!).includes('Frank Ruhl Libre 14.5pt'));
    const wizardSrc = read(path.join(SRC, 'engine', 'sefer-wizard.ts'));
    check('§5 no copied geometry table in the wizard module', !wizardSrc.includes('marginTopMm:') && !wizardSrc.includes('widthMm:'));
  }

  // ── §6 — pending-archetype seam ───────────────────────────────
  {
    store.clear();
    savePendingArchetype('shas');
    check('§6 save → consume returns the archetype', consumePendingArchetype() === 'shas');
    check('§6 consumed once (second read is null)', consumePendingArchetype() === null);
    const app = read(path.join(SRC, 'App.tsx'));
    check('§6 App consumes the pending archetype on import', app.includes('consumePendingArchetype()') && app.includes('archetypeRecipeId ?? decision.recipeId'));
    const hub = read(path.join(SRC, 'components', 'DocxImportHub.tsx'));
    check('§6 hub saves the pending archetype at import time', hub.includes('savePendingArchetype(archetypeId)'));
  }

  // ── §7 — wizard UI wiring ─────────────────────────────────────
  {
    const form = read(path.join(SRC, 'components', 'NewProjectForm.tsx'));
    check('§7 form renders the 5 archetype cards', form.includes('SEFER_ARCHETYPES.map') && form.includes('wizard-archetype-'));
    check('§7 archetype pick selects mapped layout + recipe', form.includes("setSelectedLayout(archetype.baseLayout)") && form.includes('setHistoricalRecipeId(archetype.recipeId)'));
    const hub = read(path.join(SRC, 'components', 'DocxImportHub.tsx'));
    check('§7 hub renders wizard slots + step-3 note + add-mefaresh', hub.includes('wizard-slots') && hub.includes('wizard-step3-note') && hub.includes('add-mefaresh'));
    check('§7 hub shows per-file preview stats', hub.includes('preview-') && hub.includes('analyzeImportedDocx'));
    check('§7 hub reuses the cached preview parse on import', hub.includes('parsedCacheRef.current.get(item.id)'));
    const home = read(path.join(SRC, 'components', 'HomeWorkspaceView.tsx'));
    check('§7 Home wires archetype pick → hub slots + Generate label', home.includes('onArchetypeChange={setWizardArchetypeId}') && home.includes('archetypeId={wizardArchetypeId}') && home.includes('sefer-wizard-stepper'));
    // v0.9.8 Phase 3 — the step-3 note no longer says the full linking
    // engine "comes in a later phase": Phase 3 shipped it (fuzzy
    // matching without nikud + sliding window). The Phase 1 assertion
    // was updated in the same spirit — the note must still be honest
    // about what the engine does, now in the present tense.
    check('§7 step-3 note is honest about the linker (shipped in Phase 3)', hub.includes('מנוע הקישור החדש') && hub.includes('התאמה מטושטשת') && hub.includes('חלון חיפוש עוקב'));
  }

  // ── §8 — typography defaults use bundled fonts only ───────────
  {
    const used = new Set(
      (['main_source', 'verse', 'primary_comment', 'secondary_comment', 'tertiary_comment', 'chapter', 'heading', 'siman', 'footnote', 'dibbur_hamatchil', 'regular_paragraph'] as const).map(
        r => roleTypographyDefault(r).fontFamily
      )
    );
    check('§8 wizard defaults use bundled fonts only', [...used].every(f => BUNDLED_FONT_AVAILABILITY[f]?.bundled === true), `families=${[...used].join(', ')}`);
  }

  // ── §9 — version ──────────────────────────────────────────────
  check('§9 version is 0.9.8', pkg.version === '0.9.8', `version=${pkg.version}`);

  // ── §10 — bilingual i18n (v0.9.8 second scoping note) ─────────
  // A string that silently falls back to Hebrew in English mode is a
  // bug: every new t() literal must have an EN_STRINGS entry, and the
  // wizard label tables are strict Records so a missing label in
  // EITHER language fails the build (the v0.9.1 lesson).
  {
    // Every NEW t() literal added in Phases 1–2, plus the pre-existing
    // count-word keys the new preview line reuses. If this list gains
    // a key, it must gain an EN_STRINGS entry in the same change.
    const NEW_EN_KEYS = [
      'סוג הספר — אשף ספר חדש (שלב 1 מתוך 3)',
      'תבנית מכוילת: גודל הדף, השוליים והגופנים נקבעו מראש — אפשר לשנות הכול אחר כך בעיצוב.',
      'פרטים נוספים',
      'טור יחיד — ברירות המחדל של התוכנה (Frank Ruhl Libre 14.5pt)',
      'מצב מפתח',
      'מצב מפתח: הצגת כלי בדיקה ודוחות פנימיים (Ctrl+Shift+D)',
      'אשף ספר חדש:',
      'בחרו סוג ספר',
      'הוסיפו קבצי Word',
      'צרו את פריסת הספר',
      'צור פריסת ספר (שלב 3)',
      'גרור לכאן או לחץ לבחירת קובץ',
      'הוסף מפרש נוסף',
      'מנתח את הקובץ…',
      'תפקיד:',
      'פסוקים',
      'שלב 3 — יצירת פריסת הספר: ',
      'הלחיצה מייבאת את הקבצים, מקשרת דיבורי מתחיל למקור ומעמדת את הספר לפי התבנית שבחרתם.',
      // v0.9.8 Phase 3 — the step-3 sentence key changed: the old key
      // ended "…יגיע בשלב מאוחר יותר" (the engine arrives in a later
      // phase); the new key says the engine is here. The old key is
      // gone from strings.ts by design; the new key must have its
      // English entry (it does — verified in the Phase 3 smoke §7).
      'קישורים בודאות 80% ומעלה מוחלים אוטומטית; חלשים יותר ממתינים לסקירה למעלה — שום דבר לא מנוחש. מנוע הקישור החדש משווה דיבורים למקור ללא ניקוד, עם התאמה מטושטשת וחלון חיפוש עוקב.',
      // Pre-existing keys reused by the new strings (dev toggle states
      // + preview count words) — asserted so the new lines cannot
      // silently fall back if someone removes them later.
      'פעיל',
      'כבוי',
      'מילים',
      'פרקים',
      'דפים',
      'ד״ה',
      'הערות',
    ];
    const missing = NEW_EN_KEYS.filter(k => typeof EN_STRINGS[k] !== 'string' || EN_STRINGS[k].length === 0);
    check('§10 every new v0.9.8 string has an English entry', missing.length === 0, missing.join(' | '));
    // Strict tables: exhaustive over the closed unions, non-empty in
    // BOTH languages, and actually translated (he !== en).
    const tableOk = (t: Record<string, { he: string; en: string }>) =>
      Object.values(t).every(v => v.he.length > 0 && v.en.length > 0 && v.he !== v.en);
    check('§10 archetype labels: all 5, both languages, translated', Object.keys(SEFER_ARCHETYPE_LABELS).length === 5 && tableOk(SEFER_ARCHETYPE_LABELS));
    check('§10 archetype descriptions: all 5, both languages, translated', Object.keys(SEFER_ARCHETYPE_DESCRIPTIONS).length === 5 && tableOk(SEFER_ARCHETYPE_DESCRIPTIONS));
    check('§10 slot labels: all 18 keys, both languages, translated', Object.keys(WIZARD_SLOT_LABELS).length === 18 && tableOk(WIZARD_SLOT_LABELS));
    check('§10 slot hints: all 18 keys, both languages, translated', Object.keys(WIZARD_SLOT_HINTS).length === 18 && tableOk(WIZARD_SLOT_HINTS));
    // Every slot the archetypes actually use resolves in both languages.
    const allSlots = SEFER_ARCHETYPES.flatMap(a => [...a.slots, a.additionalSlot]);
    check('§10 every archetype slot renders a label + hint in both languages', allSlots.every(s =>
      wizardSlotLabel(s, 'he').length > 0 && wizardSlotLabel(s, 'en').length > 0 &&
      wizardSlotHint(s, 'he').length > 0 && wizardSlotHint(s, 'en').length > 0
    ));
    check('§10 extra mefaresh slot (additional-mefaresh-2) resolves too', (() => {
      const extra = { key: 'additional-mefaresh-2' as const, role: 'tertiary_comment' as const, required: false };
      return wizardSlotLabel(extra, 'he') === 'מפרש נוסף' && wizardSlotLabel(extra, 'en') === 'Additional mefaresh';
    })());
    check('§10 every archetype renders a label + description in both languages', SEFER_ARCHETYPES.every(a =>
      archetypeLabel(a, 'he').length > 0 && archetypeLabel(a, 'en').length > 0 &&
      archetypeDescription(a, 'he').length > 0 && archetypeDescription(a, 'en').length > 0
    ));
    const shas = getArchetypeById('shas')!;
    check('§10 step-2 title is a whole string per language (no fragments)', wizardStep2Title(shas, 'he').startsWith('שלב 2') && wizardStep2Title(shas, 'en').startsWith('Step 2') && wizardStep2Title(shas, 'he') !== wizardStep2Title(shas, 'en'));
    // Parameterized preview-count line in both languages, through the
    // real EN_STRINGS map (this is the exact t() the hub passes).
    const stats: DocxPreviewStats = { wordCount: 12345, perekMarkers: 3, dafMarkers: 2, pasukMarkers: 4, dibburCount: 7, footnoteCount: 1, markers: [] };
    const tHe = (he: string) => he;
    const tEn = (he: string) => EN_STRINGS[he] ?? he;
    const heLine = formatPreviewCounts(stats, tHe, 'he');
    const enLine = formatPreviewCounts(stats, tEn, 'en');
    check('§10 preview counts line is Hebrew in Hebrew mode', heLine.includes('מילים') && heLine.includes('פסוקים') && heLine.includes('12,345'), heLine);
    check('§10 preview counts line is English in English mode', enLine.includes('Words') && enLine.includes('Verses') && enLine.includes('12,345') && !enLine.includes('מילים'), enLine);
    // No translated punctuation fragments left in the hub.
    const hub = read(path.join(SRC, 'components', 'DocxImportHub.tsx'));
    check('§10 hub has no t("(") / t("):") fragments', !hub.includes('t("(")') && !hub.includes('t("):")'));
    check('§10 hub renders labels through the bilingual helpers', hub.includes('wizardStep2Title(archetype, lang)') && hub.includes('wizardSlotLabel(slot, lang)') && hub.includes('formatPreviewCounts('));
    const form = read(path.join(SRC, 'components', 'NewProjectForm.tsx'));
    check('§10 form renders archetype labels through the bilingual helpers', form.includes('archetypeLabel(archetype, lang)') && form.includes('archetypeDescription(archetype, lang)'));
    // RTL/LTR: the stepper arrow flips with the document direction.
    const home = read(path.join(SRC, 'components', 'HomeWorkspaceView.tsx'));
    check('§10 wizard stepper arrow flips with dir (← RTL / → LTR)', home.includes("dir === 'rtl' ? '←' : '→'"));
  }

  console.log(`\nv098-phase1-smoke: ${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
