/**
 * KETER-TYPE v0.9.2 Part A — function-audit regression smoke.
 *
 * Run from the repo root:  npx tsx scripts/v092a-audit-smoke.ts
 *
 * The user (running installed v0.9.1) reported "a lot of the features
 * don't work". Part A traced EVERY user-facing control in code and in
 * the browser where drivable, and found five defects (A1–A5). This
 * smoke pins each fix and asserts each removal left zero references.
 *
 *  §A  A1 — Manuscript Designer box tier + rule inspector were
 *      write-only: the tier a user picked never changed what a box
 *      received (flow keyed on box.role), the min/max font clamp, the
 *      line-height ratio and the alignment never reached the real
 *      paginator, and a template export/import lost the tier and the
 *      rules. Fixed: the tier is now the flow key
 *      (acceptedRolesForBox), the paginator clamps fonts, prefers the
 *      rules line-height ratio, and stamps the box alignment on its
 *      lines; the template round-trip restores tier + rules. The
 *      column-gutter field (no effect for a single-column box) was
 *      removed from the designer UI.
 *  §B  A2 — resolveGeminiAction rejected every Gemini action the
 *      system prompt advertises (Shas / Yiddish / recipe actions):
 *      Gemini could propose them, the resolver refused them all as
 *      "unknown or unsafe". Fixed: validated pass-throughs for every
 *      action App.handleApplyAiAdjustment handles.
 *  §C  A3 — QaFixList showed an "apply fix" button for collision,
 *      orphan-mark and folio issues, but no automatic fix exists for
 *      them (the handler only toasted "no automatic fix"). Fixed:
 *      those issues are marked autoFixable: false, so the list shows
 *      "requires manual fix". The invariant pinned here: every issue
 *      that still offers a fix button belongs to a category the
 *      handler really fixes (widow_orphan / balance / whitespace).
 *  §D  A4 — balanceTierGrid was exported but never called in
 *      production, so every library recipe landed tier widths summing
 *      to 188–462% (stacked regions each contribute their full
 *      width). Fixed: moved to layout-recipes.ts and wired into
 *      applyRecipeToSettings; rescaling is proportional, so the knee
 *      solver's ratios are unchanged.
 *  §E  A5 — AutomatedTestPanel was partly fake: 23 hardcoded
 *      "passed" tests that never execute, a hardcoded "(100%)" and
 *      "14.8 ms" header, random per-test times on re-run, a PASS badge
 *      on every row even for failed tests, and a footer command
 *      pointing at a script that does not exist
 *      (/app/applet/scripts/run_verification_tests.py). Fixed: the
 *      static tests are gone, the header shows the real pass rate and
 *      the measured run time, the badge reflects test.status, and the
 *      footer points at a real npm script.
 *      A6 — the same panel crashed on open: buildRegressionTests
 *      indexed pdfTestDoc.pages[1], but the sample Berakhot paginates
 *      to one page, so buildPageRenderPlan threw while building the
 *      suite. Fixed: the page-2 checks (B-1/B-3) run against a
 *      doubled-sample multi-page Berakhot, with guards so a future
 *      short sample fails honestly instead of crashing the suite.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  acceptedRolesForBox,
  clampFontSizeForBox,
  makeCustomLayoutBox,
  planCustomLayoutFlow,
} from '../src/engine/custom-layout-engine';
import {
  applyRecipeToSettings,
  balanceTierGrid,
  recipeFromBoxes,
  recipeToTierConfigs,
  recipeToCustomLayoutBoxes,
} from '../src/engine/layout-recipes';
import { balanceTierGrid as balanceTierGridReexport } from '../src/engine/auto-layout';
import { getRecipeById } from '../src/engine/historical-layouts';
import { resolveGeminiAction } from '../src/components/AiChatPanel';
import { QaEngine } from '../src/engine/qa-engine';
import { DocxImporter } from '../src/engine/docx-importer';
import { AutomatedTestPanel } from '../src/components/AutomatedTestPanel';
import type { ContentUnit, TypesetResult } from '../src/types/typesetter';
import type { CustomLayoutBox } from '../src/types/design-settings';

let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passes++;
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

const GEOMETRY = {
  pageWidth: 482,
  pageHeight: 680,
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};
const CONTENT_W = GEOMETRY.pageWidth - GEOMETRY.marginInside - GEOMETRY.marginOutside;
const SENT =
  'יְסוֹד הַחֲסִידוּת וְשֹׁרֶשׁ הָעֲבוֹדָה הוּא שֶׁיִּתְבָּרֵר וְאֵצֶל הָאָדָם מַה חוֹבָתוֹ בְּעוֹלָמוֹ. ';

function makeUnits(): ContentUnit[] {
  return [
    { id: 'a-main', role: 'main_source', rawText: SENT.repeat(40), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'a-rashi', role: 'primary_comment', rawText: SENT.repeat(40), styleName: 'Normal', order: 2, hierarchyLevel: 3 },
    { id: 'a-tos', role: 'secondary_comment', rawText: SENT.repeat(40), styleName: 'Normal', order: 3, hierarchyLevel: 3 },
  ];
}

function customLayoutSettings(boxes: CustomLayoutBox[], roleSize?: number) {
  let s = DesignSettingsEngine.createDefaultSettings({ layoutType: 'custom_layout', geometry: GEOMETRY });
  if (roleSize !== undefined) {
    s = DesignSettingsEngine.updateRoleCharacterStyle(s, 'main_source', { fontSizePt: roleSize }, 'user');
  }
  return DesignSettingsEngine.setCustomLayout(
    s,
    { enabled: true, baseLayout: 'rav_text', boxes },
    'user'
  ).settings;
}

// ─────────────────────────────────────────────────────────────────────────────
// §A — A1: tier + rules really drive the flow
// ─────────────────────────────────────────────────────────────────────────────
console.log('§A — A1: Manuscript Designer tier + rule inspector');
{
  const mainBox = makeCustomLayoutBox('main_text', 0, 0, 100, 50);
  const rashiBox = makeCustomLayoutBox('commentary', 0, 55, 50, 45);
  rashiBox.tier = 'rashi';
  const tosBox = makeCustomLayoutBox('commentary', 50, 55, 50, 45);
  tosBox.tier = 'tosafot';
  const boxes = [mainBox, rashiBox, tosBox];

  // Tier is the flow key in the planner.
  check('tier rashi accepts primary_comment', acceptedRolesForBox(rashiBox).includes('primary_comment'));
  check('tier rashi rejects secondary_comment', !acceptedRolesForBox(rashiBox).includes('secondary_comment'));
  check('tier tosafot accepts secondary_comment', acceptedRolesForBox(tosBox).includes('secondary_comment'));
  check('tier tosafot rejects primary_comment', !acceptedRolesForBox(tosBox).includes('primary_comment'));
  const noTier = makeCustomLayoutBox('commentary', 0, 0, 100, 100);
  check(
    'no tier = role fallback (commentary box still takes all commentaries)',
    acceptedRolesForBox(noTier).includes('primary_comment') &&
      acceptedRolesForBox(noTier).includes('secondary_comment') &&
      acceptedRolesForBox(noTier).includes('tertiary_comment')
  );

  const plan = planCustomLayoutFlow(makeUnits(), boxes);
  const byBox = new Map<string, Set<string>>();
  for (const p of plan.pages) {
    for (const a of p.assignments) {
      if (!byBox.has(a.boxId)) byBox.set(a.boxId, new Set());
      byBox.get(a.boxId)!.add(a.unitRole);
    }
  }
  check('planner: Rashi box receives only primary_comment', [...(byBox.get(rashiBox.id) ?? [])].join(',') === 'primary_comment', [...(byBox.get(rashiBox.id) ?? [])].join(','));
  check('planner: Tosafot box receives only secondary_comment', [...(byBox.get(tosBox.id) ?? [])].join(',') === 'secondary_comment', [...(byBox.get(tosBox.id) ?? [])].join(','));
  check('planner: main box receives only main_source', [...(byBox.get(mainBox.id) ?? [])].join(',') === 'main_source', [...(byBox.get(mainBox.id) ?? [])].join(','));

  // Tier is the flow key in the real paginator too.
  const doc = PaginationEngine.paginateDocument({
    title: 'v092a tier',
    layoutType: 'custom_layout',
    units: makeUnits(),
    geometry: GEOMETRY,
    designSettings: customLayoutSettings(boxes),
  });
  const allLines = doc.pages.flatMap(p => [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines, ...p.footnoteLines]);
  const rashiLines = allLines.filter(l => l.customLayoutBoxId === rashiBox.id);
  const tosLines = allLines.filter(l => l.customLayoutBoxId === tosBox.id);
  check('paginator: Rashi box holds primary_comment lines only', rashiLines.length > 0 && rashiLines.every(l => l.role === 'primary_comment'), `${rashiLines.length} lines`);
  check('paginator: Tosafot box holds secondary_comment lines only', tosLines.length > 0 && tosLines.every(l => l.role === 'secondary_comment'), `${tosLines.length} lines`);

  // Font clamp (unit-level + end-to-end).
  check('clamp: 20 -> max 16', clampFontSizeForBox(20, { ...mainBox, rules: { maxFontSizePt: 16 } }) === 16);
  check('clamp: 10 -> min 14', clampFontSizeForBox(10, { ...mainBox, rules: { minFontSizePt: 14 } }) === 14);
  check('clamp: no rules = unchanged', clampFontSizeForBox(20, mainBox) === 20);
  const maxBox = makeCustomLayoutBox('main_text', 0, 0, 100, 100);
  maxBox.rules = { maxFontSizePt: 16 };
  const maxDoc = PaginationEngine.paginateDocument({
    title: 'v092a max', layoutType: 'custom_layout', units: makeUnits().slice(0, 1),
    geometry: GEOMETRY, designSettings: customLayoutSettings([maxBox], 20),
  });
  const maxWords = maxDoc.pages.flatMap(p => p.sourceLines.flatMap(l => l.words)).filter(w => !w.isSpace);
  check(
    'paginator: role 20pt clamped to box max 16pt',
    maxWords.length > 0 && maxWords.every(w => (w.fontSizePt ?? 0) <= 16) && maxWords.some(w => w.fontSizePt === 16),
    `${[...new Set(maxWords.map(w => w.fontSizePt))].join(',')}`
  );
  const minBox = makeCustomLayoutBox('main_text', 0, 0, 100, 100);
  minBox.rules = { minFontSizePt: 14 };
  const minDoc = PaginationEngine.paginateDocument({
    title: 'v092a min', layoutType: 'custom_layout', units: makeUnits().slice(0, 1),
    geometry: GEOMETRY, designSettings: customLayoutSettings([minBox], 10),
  });
  const minWords = minDoc.pages.flatMap(p => p.sourceLines.flatMap(l => l.words)).filter(w => !w.isSpace);
  check(
    'paginator: role 10pt clamped to box min 14pt',
    minWords.length > 0 && minWords.every(w => (w.fontSizePt ?? 0) >= 14) && minWords.some(w => w.fontSizePt === 14),
    `${[...new Set(minWords.map(w => w.fontSizePt))].join(',')}`
  );

  // Line-height ratio + alignment.
  const lhBox = makeCustomLayoutBox('main_text', 0, 0, 100, 100);
  lhBox.rules = { lineHeightRatio: 2.0 };
  const lhDoc = PaginationEngine.paginateDocument({
    title: 'v092a lh', layoutType: 'custom_layout', units: makeUnits().slice(0, 1),
    geometry: GEOMETRY, designSettings: customLayoutSettings([lhBox]),
  });
  const lhHeights = [...new Set(lhDoc.pages[0].sourceLines.map(l => l.height))];
  check('paginator: rules line-height ratio 2.0 sets line height (14.5pt x 2.0 = 29)', lhHeights.length === 1 && lhHeights[0] === 29, lhHeights.join(','));
  const alBox = makeCustomLayoutBox('main_text', 0, 0, 100, 100);
  alBox.rules = { alignment: 'center' };
  const alDoc = PaginationEngine.paginateDocument({
    title: 'v092a al', layoutType: 'custom_layout', units: makeUnits().slice(0, 1),
    geometry: GEOMETRY, designSettings: customLayoutSettings([alBox]),
  });
  const alLines = alDoc.pages.flatMap(p => p.sourceLines);
  check(
    'paginator: box alignment rides on lines and disables justification',
    alLines.length > 0 && alLines.every(l => l.alignment === 'center' && !l.isJustified),
    `${alLines.length} lines`
  );

  // Template round-trip preserves tier + rules.
  const rtRashi = makeCustomLayoutBox('commentary', 0, 55, 50, 45);
  rtRashi.tier = 'rashi';
  rtRashi.rules = { minFontSizePt: 9, maxFontSizePt: 13, lineHeightRatio: 1.5, alignment: 'right' };
  const rtMain = makeCustomLayoutBox('main_text', 0, 0, 100, 50);
  const recipe = recipeFromBoxes([rtMain, rtRashi], 'rav_text', { nameHe: 'בדיקה', nameEn: 'Check' });
  const back = recipeToCustomLayoutBoxes(recipe);
  // Imported boxes get `recipe-<id>` ids, so locate the Rashi box by its
  // geometry (y 55%), not by id.
  const backRashi = back.find(b => Math.abs(b.yPct - 55) < 0.01);
  check('round-trip: Rashi tier survives export/import', backRashi?.tier === 'rashi', String(backRashi?.tier));
  check('round-trip: min font survives', backRashi?.rules?.minFontSizePt === 9, String(backRashi?.rules?.minFontSizePt));
  check('round-trip: max font survives', backRashi?.rules?.maxFontSizePt === 13, String(backRashi?.rules?.maxFontSizePt));
  check('round-trip: line-height ratio survives', backRashi?.rules?.lineHeightRatio === 1.5, String(backRashi?.rules?.lineHeightRatio));
  check('round-trip: alignment survives', backRashi?.rules?.alignment === 'right', String(backRashi?.rules?.alignment));

  // v0.9.2 Part A (A1) regression: the main body box is the homeless-role
  // sink whatever its tier. A drush book's main box is tier main_drush;
  // roles no box covers (siman, list_item, table) must spill into it
  // instead of blocking the whole book behind them (strict book order).
  const drushBox = makeCustomLayoutBox('main_text', 0, 0, 100, 100);
  drushBox.tier = 'main_drush';
  const homelessUnits: ContentUnit[] = [
    { id: 'h-siman', role: 'siman', rawText: SENT.repeat(5), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'h-list', role: 'list_item', rawText: SENT.repeat(5), styleName: 'Normal', order: 2, hierarchyLevel: 2 },
    { id: 'h-table', role: 'table', rawText: SENT.repeat(5), styleName: 'Normal', order: 3, hierarchyLevel: 2 },
  ];
  const homelessPlan = planCustomLayoutFlow(homelessUnits, [drushBox]);
  check(
    'sink: homeless roles spill into a main_drush box',
    homelessPlan.unplacedUnitIds.length === 0 &&
      homelessPlan.pages.flatMap(p => p.assignments).every(a => a.boxId === drushBox.id),
    `unplaced=${homelessPlan.unplacedUnitIds.join(',')}`
  );
  const drushRecipe = getRecipeById('chassidic-drush')!;
  const drushSettings = applyRecipeToSettings(drushRecipe, DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY }));
  const drushDoc = PaginationEngine.paginateDocument({
    title: 'v092a drush', layoutType: 'custom_layout',
    units: [...makeUnits(), ...homelessUnits],
    geometry: GEOMETRY, designSettings: drushSettings,
  });
  const placedIds = new Set(
    drushDoc.pages
      .flatMap(p => [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines, ...p.footnoteLines])
      .map(l => l.unitId)
  );
  const allIds = [...makeUnits(), ...homelessUnits].map(u => u.id);
  check(
    'sink: chassidic-drush recipe places every unit incl. homeless roles',
    allIds.every(id => placedIds.has(id)),
    `missing=${allIds.filter(id => !placedIds.has(id)).join(',')}`
  );

  // Removed control: the column-gutter field is gone from the designer UI.
  const designerSrc = fs.readFileSync('src/components/CustomLayoutDesigner.tsx', 'utf8');
  check('removed: no columnGutterPt control left in CustomLayoutDesigner.tsx', !designerSrc.includes('columnGutterPt'));
  // (The type field stays on purpose: recipes may carry it, and the
  // template round-trip preserves it — only the dead UI control went.)
}

// ─────────────────────────────────────────────────────────────────────────────
// §B — A2: Gemini-advertised actions resolve
// ─────────────────────────────────────────────────────────────────────────────
console.log('§B — A2: resolveGeminiAction');
{
  const noData = [
    'verify_dibbur', 'fix_shas_flaws', 'apply_vilna_defaults', 'verify_folio_sequence',
    'check_footer_alignment', 'apply_yiddish_defaults', 'verify_yiddish_folio',
    'classify_yiddish_tiers', 'fix_geometry_flaws', 'changeLayout',
  ] as const;
  for (const type of noData) {
    const r = resolveGeminiAction({ type, label: type, data: {} } as never);
    check(`Gemini action resolves: ${type}`, 'action' in r && r.action.type === type);
  }
  const moveOk = resolveGeminiAction({ type: 'move_rashi', label: 'x', data: { closer: true } } as never);
  check('move_rashi resolves with boolean closer', 'action' in moveOk && (moveOk.action.data as { closer: boolean }).closer === true);
  check('move_rashi refuses non-boolean closer', !('action' in resolveGeminiAction({ type: 'move_rashi', label: 'x', data: { closer: 'yes' } } as never)));
  check('move_rashi refuses missing closer', !('action' in resolveGeminiAction({ type: 'move_rashi', label: 'x', data: {} } as never)));
  const expOk = resolveGeminiAction({ type: 'expand_tosafot', label: 'x', data: { widthPct: 30 } } as never);
  check('expand_tosafot resolves with widthPct 30', 'action' in expOk && (expOk.action.data as { widthPct: number }).widthPct === 30);
  check('expand_tosafot refuses widthPct 10 (out of 20-40)', !('action' in resolveGeminiAction({ type: 'expand_tosafot', label: 'x', data: { widthPct: 10 } } as never)));
  check('expand_tosafot refuses string widthPct', !('action' in resolveGeminiAction({ type: 'expand_tosafot', label: 'x', data: { widthPct: '30' } } as never)));
  const michOk = resolveGeminiAction({ type: 'toggle_michtav', label: 'x', data: { enabled: false, text: 'שלום' } } as never);
  check(
    'toggle_michtav resolves with enabled + text',
    'action' in michOk &&
      (michOk.action.data as { enabled?: boolean }).enabled === false &&
      (michOk.action.data as { text?: string }).text === 'שלום'
  );
  check('toggle_michtav refuses non-boolean enabled', !('action' in resolveGeminiAction({ type: 'toggle_michtav', label: 'x', data: { enabled: 'no' } } as never)));
  const recOk = resolveGeminiAction({ type: 'applyRecipe', label: 'x', data: { recipeId: 'talmud-bavli' } } as never);
  check('applyRecipe resolves for a real library recipe', 'action' in recOk && (recOk.action.data as { recipeId: string }).recipeId === 'talmud-bavli');
  check('applyRecipe refuses an unknown recipeId', !('action' in resolveGeminiAction({ type: 'applyRecipe', label: 'x', data: { recipeId: 'no-such-recipe' } } as never)));
  check(
    'applyRecipe refuses templateId-only (no template store exists)',
    !('action' in resolveGeminiAction({ type: 'applyRecipe', label: 'x', data: { templateId: 'some-template' } } as never))
  );
  check(
    'applyHistoricalLayout resolves for a real library recipe',
    'action' in resolveGeminiAction({ type: 'applyHistoricalLayout', label: 'x', data: { recipeId: 'mikraot-gedolot' } } as never)
  );
  check(
    'explainRecipe resolves with no recipeId (explains current layout)',
    'action' in resolveGeminiAction({ type: 'explainRecipe', label: 'x', data: {} } as never)
  );
  check(
    'explainRecipe resolves with a real recipeId',
    'action' in resolveGeminiAction({ type: 'explainRecipe', label: 'x', data: { recipeId: 'siddur' } } as never)
  );
  check('explainRecipe refuses an unknown recipeId', !('action' in resolveGeminiAction({ type: 'explainRecipe', label: 'x', data: { recipeId: 'nope' } } as never)));
  check('unknown action type still refused', !('action' in resolveGeminiAction({ type: 'teleport_book', label: 'x', data: {} } as never)));
}

// ─────────────────────────────────────────────────────────────────────────────
// §C — A3: QA fix button only for categories the handler fixes
// ─────────────────────────────────────────────────────────────────────────────
console.log('§C — A3: qa-engine autoFixable');
{
  // Crafted page: overlapping source + Rashi lines (collision), a word
  // whose first glyph is a lone mark (orphan mark), and a missing folio.
  const fakeLine = (over: Record<string, unknown>) => ({
    lineIndex: 0, words: [], width: 100, targetWidth: 300, xStart: 0,
    xLeft: 0, xRight: 100, yBaseline: 12, yTop: 0, yBottom: 12, height: 14,
    ascent: 11, descent: 3, isLastLine: false, isJustified: false,
    extraSpacePerWord: 0, role: 'main_source', unitId: 'u1', fontSizePt: 13,
    ...over,
  });
  const markWord = {
    text: 'x', width: 5, isSpace: false,
    glyphs: [{ text: 'x', isMark: true }],
  };
  const fakeResult = {
    sourceLines: [
      fakeLine({ lineIndex: 0, xLeft: 0, xRight: 100, yTop: 0, yBottom: 12, targetWidth: 300 }),
      fakeLine({ lineIndex: 1, xLeft: 0, xRight: 100, yTop: 20, yBottom: 32, targetWidth: 300, words: [markWord] }),
    ],
    rashiLines: [fakeLine({ lineIndex: 0, role: 'primary_comment', unitId: 'u2', xLeft: 50, xRight: 150, yTop: 6, yBottom: 18, targetWidth: 300 })],
    tosafotLines: [],
    column2Lines: [],
    footnoteLines: [],
    geometry: GEOMETRY,
    layoutScore: { totalScore: 90, verticalBalance: 90, collisionCount: 0 },
    placedOrnaments: [],
    pageNumber: 0,
    pageNumberHebrew: '',
  } as unknown as TypesetResult;
  const qa = QaEngine.runFullQa(fakeResult);
  const byId = new Map(qa.issues.map(i => [i.id, i]));
  const collision = [...byId.values()].find(i => i.category === 'collision');
  const orphan = [...byId.values()].find(i => i.category === 'orphan_mark');
  const folio = byId.get('qa-folio-invalid');
  check('collision issue exists on overlapping lines', collision !== undefined, qa.issues.map(i => i.id).join(','));
  check('collision issue is NOT auto-fixable (no fix exists)', collision !== undefined && collision.autoFixable === false);
  check('orphan-mark issue exists', orphan !== undefined);
  check('orphan-mark issue is NOT auto-fixable', orphan !== undefined && orphan.autoFixable === false);
  check('folio issue exists on a missing folio number', folio !== undefined);
  check('folio issue is NOT auto-fixable', folio !== undefined && folio.autoFixable === false);

  // Invariant over a real book: any issue that still offers a fix button
  // (autoFixable && !autoFixed) must be a category the handler fixes.
  const book = PaginationEngine.paginateDocument({
    title: 'Berakhot', layoutType: 'rav_text',
    units: DocxImporter.getSampleBerakhot(), geometry: GEOMETRY,
  });
  const fixableCategories = new Set(['widow_orphan', 'balance', 'whitespace']);
  let checked = 0;
  let bad: string[] = [];
  for (const page of book.pages) {
    const res = QaEngine.runFullQa(page as unknown as TypesetResult);
    for (const issue of res.issues) {
      checked++;
      if (issue.autoFixable && !issue.autoFixed && !fixableCategories.has(issue.category)) {
        bad.push(`${issue.id}:${issue.category}`);
      }
    }
  }
  check(
    'every button-offering QA issue is in a handler-fixed category',
    bad.length === 0 && checked > 0,
    bad.length > 0 ? bad.join(', ') : `${checked} issues checked, 0 button-offering`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §D — A4: balanceTierGrid is wired into recipe apply
// ─────────────────────────────────────────────────────────────────────────────
console.log('§D — A4: balanceTierGrid');
{
  check('balanceTierGrid re-exported from auto-layout (same function)', balanceTierGridReexport === balanceTierGrid);
  const vilna = getRecipeById('talmud-bavli')!;
  const raw = recipeToTierConfigs(vilna);
  const rawSum = raw.reduce((s, t) => s + (t.widthPct ?? 0), 0);
  check('raw Vilna tier widths sum > 100% (the pre-fix defect)', rawSum > 100, `sum=${rawSum}`);
  const bal = balanceTierGrid(raw, CONTENT_W);
  const balSum = bal.tiers.reduce((s, t) => s + (t.widthPct ?? 0), 0);
  check('balanced widths fit the content width', balSum <= 100, `sum=${balSum.toFixed(1)}`);
  const rawRashi = raw.find(t => t.role === 'primary_comment')!;
  const rawTos = raw.find(t => t.role === 'secondary_comment')!;
  const balRashi = bal.tiers.find(t => t.role === 'primary_comment')!;
  const balTos = bal.tiers.find(t => t.role === 'secondary_comment')!;
  const rawShare = rawRashi.widthPct! / (rawRashi.widthPct! + rawTos.widthPct!);
  const balShare = balRashi.widthPct! / (balRashi.widthPct! + balTos.widthPct!);
  check('balancing is proportional: Rashi/Tosafot flank share unchanged', Math.abs(rawShare - balShare) < 0.01, `${rawShare.toFixed(3)} vs ${balShare.toFixed(3)}`);

  // End to end: applying a recipe now lands normalised tiers.
  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY });
  for (const id of ['talmud-bavli', 'mikraot-gedolot', 'shulchan-aruch', 'responsa', 'siddur']) {
    const recipe = getRecipeById(id)!;
    const applied = applyRecipeToSettings(recipe, base);
    const tiers = applied.pageLayout.tiers ?? [];
    const sum = tiers.reduce((s, t) => s + (t.widthPct ?? 0), 0);
    check(`applied ${id}: tier widths sum <= 100%`, sum <= 100, `sum=${sum.toFixed(1)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §E — A5: AutomatedTestPanel honesty
// ─────────────────────────────────────────────────────────────────────────────
console.log('§E — A5: AutomatedTestPanel');
{
  const src = fs.readFileSync('src/components/AutomatedTestPanel.tsx', 'utf8');
  check('removed: INITIAL_TESTS hardcoded passes are gone', !src.includes('INITIAL_TESTS'));
  check('removed: no Math.random() fake timings', !src.includes('Math.random()'));
  check('removed: no hardcoded "(100%)" header', !src.includes('עברו בהצלחה (100%)'));
  check('removed: no hardcoded "14.8 ms" total', !src.includes('14.8 ms'));
  check('removed: no reference to the nonexistent verification script', !src.includes('run_verification_tests.py'));
  check('footer points at a real npm script', src.includes('npm run smoke:partC'));
  check('run duration is measured with performance.now()', src.includes('performance.now()'));
  check('badge reflects test.status', src.includes("test.status === 'passed' ? 'PASS'"));
  check('pass rate is computed, not hardcoded', src.includes('totalPassed / tests.length) * 100'));
  // A6: the unguarded pages[1] access that crashed the panel is gone;
  // the page-2 checks run against a doubled-sample multi-page doc.
  check('removed: no unguarded pdfTestDoc.pages[1] access', !src.includes('pdfTestDoc.pages[1]'));
  check('page-2 checks use a multi-page Berakhot doc', src.includes('berakhotMultiDoc'));

  // The panel renders standalone (no providers) and its header now shows
  // the real pass rate and a measured time, never the old hardcodes.
  let html = '';
  let threw: unknown = null;
  try {
    html = renderToString(React.createElement(AutomatedTestPanel, { onClose: () => undefined }));
  } catch (e) {
    threw = e;
  }
  check('panel renders to string without throwing', threw === null, threw ? String(threw) : undefined);
  if (threw === null) {
    // The computed rate can legitimately be 100% when every test passes;
    // what matters is that the header renders a computed percentage.
    // (SSR inserts <!-- --> separators between JSX expressions, so strip
    // them before matching.)
    const flatHtml = html.replace(/<!-- -->/g, '');
    check('rendered header shows a computed pass percentage', /עברו בהצלחה \(\d+%\)/.test(flatHtml));
    check('rendered header has no hardcoded 14.8 ms', !html.includes('14.8 ms'));
    check('rendered rows show real PASS/FAIL badges', html.includes('PASS') || html.includes('FAIL'));
  }
}

console.log(`\nv092a-audit-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
