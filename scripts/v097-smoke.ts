/**
 * KETER-TYPE v0.9.7 — streamlined start screen + multi-DOCX hub + general
 * recipe settings smoke test.
 *
 * Run from the repo root:  npx tsx scripts/v097-smoke.ts
 *
 * Parts 1–4 (2026-11-12, from the user's 5 photos of the installed
 * v0.9.5 Home screen + the Part 4 follow-up):
 *  §1  Part 1 — the start screen lists exactly 11 core layouts
 *      (7 base + 4 promoted recipes), one grid, one-line descriptions
 *  §2  Part 1 — the full historical library is intact (29 entries) and
 *      still reachable from the Design / Page design pickers
 *  §3  Part 2 — the DOCX hub: one shared component (Home inline +
 *      modal), 6 roles incl. tertiary_comment + verse, the user's tag
 *      wins for body units, tertiary joins dibbur linking
 *  §4  Part 3 — multi-file import end to end: Gemara + Rashi + Tosafot
 *      + Ein Mishpat (+ Targum for Mikraot) auto-links, classifies
 *      (Vilna Shas / Mikraot Gedolot) and paginates with 0 collisions
 *      and 0 text-overlap flaws, tertiary band used
 *  §5  Part 4 — recipe settings made general: column gap + footnote
 *      separator controls exist in Design, are wired to the live
 *      settings, and visibly move the page (two-column gap; separator
 *      width/gap in the canvas contract). Dead / un-generalisable
 *      settings are inventoried honestly (no fake controls)
 *  §6  version is 0.9.7
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { DOMParser } from '@xmldom/xmldom';
// The docx importer runs under tsx (Node), where DOMParser / Node are
// not globals — install the @xmldom shims before importing it.
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
(globalThis as unknown as { Node: unknown }).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  classifyForImport,
  classifyUnitTier,
} from '../src/engine/auto-layout';
import { scanShasFlaws } from '../src/engine/vilna-shas';
import {
  CORE_START_LAYOUTS,
  CORE_START_RECIPE_IDS,
  LAYOUT_PRESET_OPTIONS,
} from '../src/engine/layout-presets';
import {
  getHistoricalLayoutLibrary,
  getRecipeById,
  HISTORICAL_LAYOUTS,
} from '../src/engine/historical-layouts';
import { groupHistoricalLibrary } from '../src/components/NewProjectForm';
import {
  DOCX_HUB_ROLE_OPTIONS,
  DOCX_HUB_RETAGGABLE_ROLES,
} from '../src/components/DocxImportHub';
import type { ContentRole, ContentUnit, PageGeometry } from '../src/types/typesetter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (p: string): string => fs.readFileSync(p, 'utf8');

const GEOMETRY: PageGeometry = {
  pageWidth: 482,
  pageHeight: 720,
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};

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

// --- minimal .docx builder (same pattern as v090-partC smoke) ---
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const para = (text: string, style?: string): string =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
async function buildDocx(paras: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}</w:body></w:document>`
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

const GEMARA = 'גמרא: תנא היכא קאי דקתני מאימתי ותו מאי שנא דתני דערבית ברישא לתני דשחרית ברישא תנא אקרא קאי דכתיב בשכבך ובקומך והכי קתני זמן קריאת שמע דשכיבה אימת משעה שהכהנים נכנסין לאכול בתרומתן. ';
const MISHNA = 'משנה: מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות רבן גמליאל אומר עד שיעלה עמוד השחר. ';
const RASHI = 'מאימתי קורין את שמע בערבית פירוש מאיזה זמן קורין ולא קתני משעה שהכוכבים יוצאים לאשמעינן מילתא אגב אורחיה דהכהנים שנטמאו וטבלו ביום והעריב שמשן טהורים לאכול בתרומה לעת ערב. ';
const TOSAFOT = 'תנא היכא קאי דקתני מאימתי קושיא ותירוץ ארוך בין הראשונים חילוקים וראיות והתוספות מקשים על פירוש רשי ומתרצים בדוחק גדול. ';
const EIN_MISHPAT = 'מאימתי: עין משפט סימן א סעיף ב מראה מקום להלכה ברמב״ם הלכות קריאת שמע פרק א. ';
const VERSE = 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֣ת הַשָּׁמַ֗יִם וְאֵ֥ת הָאָֽרֶץ׃ ';
const ONKELOS = 'אונקלוס: בראשית ברא אלהים ית שמיא וית ארעא. ';

/**
 * The hub's import flow, minus React: import each file, apply the
 * per-file role the user tagged (the hub's retag rule: the tag wins
 * for body roles, structural roles untouched), then link.
 */
async function hubImport(files: Array<{ name: string; role: ContentRole; paras: string[] }>) {
  const allUnits: ContentUnit[] = [];
  let totalOrder = 0;
  for (const f of files) {
    const res = await DocxImporter.importDocx(await buildDocx(f.paras), f.name);
    for (const u of res.units) {
      totalOrder++;
      u.order = totalOrder;
      if (f.role !== 'main_source' && DOCX_HUB_RETAGGABLE_ROLES.includes(u.role)) {
        u.role = f.role;
      }
      allUnits.push(u);
    }
  }
  const sources = allUnits.filter(u => u.role === 'main_source' || u.role === 'chapter');
  const commentaries = allUnits.filter(
    u => u.role === 'primary_comment' || u.role === 'secondary_comment' || u.role === 'tertiary_comment'
  );
  const links = DocxImporter.autoLinkCommentariesToSource(sources, commentaries);
  return { units: allUnits, links };
}

async function main(): Promise<void> {
  console.log('§1  Part 1 — exactly 11 core layouts on the start screen');
  {
    check('CORE_START_LAYOUTS has exactly 11 entries', CORE_START_LAYOUTS.length === 11, `got ${CORE_START_LAYOUTS.length}`);
    check('first 7 are the base layouts, in the user-named order',
      CORE_START_LAYOUTS.slice(0, 7).map(o => o.id).join(',') ===
        'rav_text,mikraot_gedolot,source_top_commentary_bottom,two_column,single_column,yiddish_sefer,custom_layout',
      CORE_START_LAYOUTS.slice(0, 7).map(o => o.id).join(','));
    check('7 base entries match LAYOUT_PRESET_OPTIONS',
      CORE_START_LAYOUTS.slice(0, 7).every(o => o.kind === 'base' && LAYOUT_PRESET_OPTIONS.some(p => p.id === o.baseLayout)));
    check('last 4 are the promoted recipes (user-named order)',
      CORE_START_LAYOUTS.slice(7).map(o => o.id).join(',') === 'chumash-rishonim,mishnah-classic,shulchan-aruch,siddur',
      CORE_START_LAYOUTS.slice(7).map(o => o.id).join(','));
    check('CORE_START_RECIPE_IDS lists the 4 promoted recipes', CORE_START_RECIPE_IDS.join(',') === 'chumash-rishonim,mishnah-classic,shulchan-aruch,siddur');
    check('the core Mishna is mishnah-classic (Mishnah with Bartenura — the most famous one)',
      CORE_START_LAYOUTS[8].id === 'mishnah-classic' && CORE_START_LAYOUTS[8].labelHe === 'משנה עם ברטנורא');
    for (const o of CORE_START_LAYOUTS) {
      const recipe = o.kind === 'recipe' ? getRecipeById(o.id) : undefined;
      check(`${o.id}: baseLayout resolves${o.kind === 'recipe' ? ' to its recipe baseLayout' : ''}`,
        o.kind === 'base' ? true : recipe?.baseLayout === o.baseLayout,
        o.kind === 'recipe' ? `recipe baseLayout=${recipe?.baseLayout}` : '');
    }
    const longDescs = CORE_START_LAYOUTS.filter(o => o.subLabelHe.length > 70 || o.subLabelEn.length > 90);
    check('every core card description is ONE short line (≤70 He / ≤90 En chars)',
      longDescs.length === 0, longDescs.map(o => o.id).join(', '));
    check('no core card reuses a recipe paragraph description',
      CORE_START_LAYOUTS.every(o => {
        if (o.kind !== 'recipe') return true;
        const r = getRecipeById(o.id);
        return r ? r.metadata.description !== o.subLabelEn && r.metadata.descriptionHe !== o.subLabelHe : false;
      }));
    const form = read(path.join(SRC, 'components/NewProjectForm.tsx'));
    check('NewProjectForm renders the core list (CORE_START_LAYOUTS)', form.includes('CORE_START_LAYOUTS.map('));
    // Strip comments first: the grouping helper's doc comment still
    // NAMES getHistoricalLayoutLibrary() in prose.
    const formCode = form.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    check('NewProjectForm no longer lists the full historical library',
      !formCode.includes('getHistoricalLayoutLibrary()') && !formCode.includes('groupedRecipes'));
    check('NewProjectForm has no recipe-group shelves any more',
      !form.includes('recipe-group-') && !form.includes('תבניות היסטוריות — עימוד קלאסי מוכן'));
    check('core grid is ONE grid with one testid root', form.includes('data-testid={`${testId}-core-layouts`}'));
    check('user count discrepancy is recorded (11 named, "10" written)',
      read(path.join(ROOT, 'src/engine/layout-presets.ts')).includes('wrote "10" but named 11'));
  }

  console.log('§2  Part 1 — the full library stays intact + reachable from Design');
  {
    check('unified library still has 29 entries (27 real + 2 aliases)', HISTORICAL_LAYOUTS.length === 29, `got ${HISTORICAL_LAYOUTS.length}`);
    const lib = getHistoricalLayoutLibrary();
    check('picker library still lists 27 real recipes', lib.length === 27, `got ${lib.length}`);
    const groupedTotal = groupHistoricalLibrary(lib).reduce((n, g) => n + g.entries.length, 0);
    check('grouping keeps all 27 recipes (function kept for the library)', groupedTotal === 27, `grouped ${groupedTotal}`);
    const panel = read(path.join(SRC, 'components/DesignTypesettingPanel.tsx'));
    check('Design panel still lists the FULL library (post-creation picker)',
      panel.includes('getHistoricalLayoutLibrary().map('));
    check('Design panel applies a recipe on click (onApplyHistoricalRecipe)',
      panel.includes('onApplyHistoricalRecipe?.(entry.id)'));
    const siddur = getRecipeById('siddur');
    check('Siddur stays ONE card; its five nusachot stay on the recipe metadata',
      JSON.stringify(siddur?.metadata.nusach ?? []) === JSON.stringify(['Ashkenaz', 'Sefard', 'Edot HaMizrach', 'Ari', 'Teman']),
      JSON.stringify(siddur?.metadata.nusach ?? []));
    check('no nusach picker existed or was invented (content difference, no settings field)',
      !/nusach/.test(read(path.join(SRC, 'components/DesignTypesettingPanel.tsx'))));
  }

  console.log('§3  Part 2 — one shared DOCX hub, 6 roles, user tag wins');
  {
    check('role dropdown offers 6 roles', DOCX_HUB_ROLE_OPTIONS.length === 6, DOCX_HUB_ROLE_OPTIONS.map(o => o.role).join(','));
    check('roles are the engine roles incl. tertiary_comment + verse',
      DOCX_HUB_ROLE_OPTIONS.some(o => o.role === 'tertiary_comment') &&
      DOCX_HUB_ROLE_OPTIONS.some(o => o.role === 'verse'));
    check('Targum maps to the verse role (no second taxonomy)',
      DOCX_HUB_ROLE_OPTIONS.find(o => o.role === 'verse')?.labelHe.includes('תרגום') === true);
    check('retaggable roles are body roles only (footnote/heading/chapter untouched)',
      DOCX_HUB_RETAGGABLE_ROLES.join(',') === 'main_source,verse,primary_comment,secondary_comment,tertiary_comment,regular_paragraph');
    const hub = read(path.join(SRC, 'components/DocxImportHub.tsx'));
    check('hub retags by the retaggable-roles rule (user tag wins)',
      hub.includes("DOCX_HUB_RETAGGABLE_ROLES.includes(u.role)"));
    check('hub retag no longer requires importer main_source',
      !hub.includes("u.role === 'main_source') {") && !hub.includes("item.role !== 'main_source' && u.role === 'main_source'"));
    check('hub links tertiary_comment too',
      hub.includes("u.role === 'tertiary_comment'") && hub.includes('tertiary_comment joins the linking'));
    check('hub has the uncertain-link review queue + warnings review',
      hub.includes('reviewLinks') && hub.includes('importWarnings'));
    const modal = read(path.join(SRC, 'components/DocxImportModal.tsx'));
    // v0.9.8 Uniformity Audit — the modal hub is now variant="light"
    // (was "dark"): all dialogs share the theme surface, so the modal
    // no longer renders a hardcoded dark hub inside a light card.
    check('DocxImportModal is a thin shell around the shared hub',
      modal.includes('<DocxImportHub') && modal.includes('variant="light"') && !modal.includes('handleProcessImport'));
    const home = read(path.join(SRC, 'components/HomeWorkspaceView.tsx'));
    check('Home renders the same hub inline (light variant)',
      home.includes('<DocxImportHub') && home.includes('variant="light"') && home.includes('testIdPrefix="docx-hub-home"'));
    check('Home has no second importer (no DocxImporter / staged files / layout select of its own)',
      !home.includes('DocxImporter') && !home.includes('stagedDocx') && !home.includes('setDocxLayout'));
    const app = read(path.join(SRC, 'App.tsx'));
    check('App wires the modal to the one handleImportUnits', app.includes('onImportUnits={handleImportUnits}'));
    check('App wires Home to the same handleImportUnits (guarded)',
      app.includes('onImportUnits={(units, title, links, autoLayout) =>') && app.includes('handleImportUnits(units, title, links, autoLayout)'));
    check('autoDetectRole: targum file → verse', DocxImporter.autoDetectRole('targum.docx', '') === 'verse');
    check('autoDetectRole: onkelos file → verse', DocxImporter.autoDetectRole('onkelos.docx', '') === 'verse');
    check('autoDetectRole: ein mishpat file → tertiary_comment', DocxImporter.autoDetectRole('ein-mishpat.docx', '') === 'tertiary_comment');
    check('autoDetectRole: rashi file still → primary_comment', DocxImporter.autoDetectRole('rashi.docx', '') === 'primary_comment');
    // classifyUnitTier: tertiary had no tier before v0.9.7.
    const tertiaryTier = classifyUnitTier({ id: 't', role: 'tertiary_comment', rawText: 'הערה שלישית כללית.', styleName: 'Normal', order: 1, hierarchyLevel: 3 } as ContentUnit);
    check('classifyUnitTier gives tertiary_comment a tier (outer_commentaries)',
      tertiaryTier?.tier === 'outer_commentaries', tertiaryTier?.tier ?? '(none)');
  }

  console.log('§4  Part 3 — multi-file import end to end: link, classify, paginate');
  {
    // User-tag-wins: a file tagged tertiary_comment whose importer
    // guessed primary_comment (Rashi style) must come out tertiary.
    const misTagged = await hubImport([
      { name: 'gemara.docx', role: 'main_source', paras: [para(MISHNA, 'Mishna'), para(GEMARA, 'Normal')] },
      { name: 'third.docx', role: 'tertiary_comment', paras: [para('מאימתי: פירוש שלישי על המשנה.', 'Rashi')] },
    ]);
    const thirdUnit = misTagged.units.find(u => u.role === 'tertiary_comment');
    check('user tag wins: Rashi-styled unit in a tertiary-tagged file ends tertiary_comment',
      Boolean(thirdUnit), misTagged.units.map(u => u.role).join(','));

    // Full Vilna set: Gemara + Rashi + Tosafot + Ein Mishpat.
    const vilna = await hubImport([
      { name: 'gemara.docx', role: 'main_source', paras: [para('מסכת ברכות — פרק ראשון', 'Heading 1'), para(MISHNA, 'Mishna'), ...Array.from({ length: 6 }, () => para(GEMARA, 'Normal'))] },
      { name: 'rashi.docx', role: 'primary_comment', paras: Array.from({ length: 6 }, () => para(RASHI, 'Rashi')) },
      { name: 'tosafot.docx', role: 'secondary_comment', paras: Array.from({ length: 6 }, () => para(TOSAFOT, 'Tosafot')) },
      { name: 'ein-mishpat.docx', role: 'tertiary_comment', paras: Array.from({ length: 4 }, () => para(EIN_MISHPAT, 'Ein Mishpat')) },
    ]);
    const roles = vilna.units.map(u => u.role);
    check('4-file import keeps all roles (main + primary + secondary + tertiary)',
      roles.includes('main_source') && roles.includes('primary_comment') && roles.includes('secondary_comment') && roles.includes('tertiary_comment'),
      [...new Set(roles)].join(','));
    const linkedRoles = new Set(vilna.links.map(l => vilna.units.find(u => u.id === l.commentaryUnitId)?.role));
    check('dibbur links exist for primary AND secondary AND tertiary units',
      linkedRoles.has('primary_comment') && linkedRoles.has('secondary_comment') && linkedRoles.has('tertiary_comment'),
      [...linkedRoles].join(','));
    const vilnaInfo = classifyForImport(vilna.units, vilna.links, { fileName: 'berakhot.docx' });
    check('Vilna 4-file import auto-selects vilna-shas', vilnaInfo.decision.recipeId === 'vilna-shas', vilnaInfo.decision.lineEn);
    // The Ein Mishpat file's units are caught by the AUTHOR check first
    // (named tertiary commentator → ein_mishpat_ner_mitzvah tier, not
    // the generic tertiary branch) — so they count there, and the
    // generic tertiary_comment → outer_commentaries branch is covered
    // by the unnamed-tertiary unit test in §3.
    check('tertiary file counts in classification (ein_mishpat tier = 4 units)',
      vilnaInfo.classification.tierCounts.ein_mishpat_ner_mitzvah === 4,
      JSON.stringify(vilnaInfo.classification.tierCounts));
    const vilnaDoc = PaginationEngine.paginateDocument({ title: 'Vilna', layoutType: 'rav_text', units: vilna.units, geometry: GEOMETRY, links: vilna.links });
    const vilnaLines = vilnaDoc.pages.flatMap(p => [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines, ...(p.tertiaryLines ?? []), ...(p.footnoteLines ?? []), ...(p.column2Lines ?? []), ...(p.sideNoteLines ?? [])]);
    check('Vilna paginates to ≥1 page with lines', vilnaDoc.pages.length >= 1 && vilnaLines.length > 0, `${vilnaDoc.pages.length} pages, ${vilnaLines.length} lines`);
    check('Vilna: tertiary band is used (tertiary lines placed)',
      vilnaDoc.pages.some(p => (p.tertiaryLines ?? []).length > 0));
    check('Vilna: 0 collisions', vilnaDoc.pages.every(p => (p.layoutScore?.collisionCount ?? 0) === 0),
      vilnaDoc.pages.map(p => p.layoutScore?.collisionCount).join(','));
    const vilnaFlaws = scanShasFlaws(vilnaDoc.pages, vilna.units, vilna.links);
    check('Vilna: 0 text-overlap flaws', !vilnaFlaws.some(f => f.kind === 'text_overlap'),
      vilnaFlaws.filter(f => f.kind === 'text_overlap').map(f => f.messageHe).join('; ') || 'none');

    // Mikraot set: verses + Targum (verse role) + Rashi + Ibn Ezra.
    const mikraot = await hubImport([
      { name: 'chumash.docx', role: 'main_source', paras: [para('בראשית פרק א', 'Heading 1'), ...Array.from({ length: 8 }, () => para(VERSE, 'Normal'))] },
      { name: 'targum.docx', role: 'verse', paras: Array.from({ length: 5 }, () => para(ONKELOS, 'Onkelos')) },
      { name: 'rashi.docx', role: 'primary_comment', paras: Array.from({ length: 5 }, () => para('בראשית בשביל התורה שנקראת ראשית פירוש קצר על הפסוק.', 'Rashi')) },
      { name: 'ibn-ezra.docx', role: 'secondary_comment', paras: Array.from({ length: 3 }, () => para('אבן עזרא: בראשית יש מפרשים שהוא סמוך.', 'Ibn Ezra')) },
    ]);
    const mikraotInfo = classifyForImport(mikraot.units, mikraot.links, { fileName: 'bereishit.docx' });
    // Verses + Targum + Rashi + Ibn Ezra: the strong-signal path picks
    // the 'chumash' recipe here (the v090 single-file test, with 5
    // commentators incl. Ramban/Sforno, selects mikraot-gedolot).
    // Which specific Mikraot recipe wins is the scorer's business —
    // what matters is the family: baseLayout mikraot_gedolot. (The
    // decision's layoutType is 'custom_layout' by design: recipes
    // apply as custom-layout boxes of their base layout.)
    check('Mikraot 4-file import auto-selects a Mikraot-family recipe',
      getRecipeById(mikraotInfo.decision.recipeId)?.baseLayout === 'mikraot_gedolot',
      `${mikraotInfo.decision.recipeId} — ${mikraotInfo.decision.lineEn}`);
    check('Mikraot decision recipe baseLayout is mikraot_gedolot',
      getRecipeById(mikraotInfo.decision.recipeId)?.baseLayout === 'mikraot_gedolot');
    const mikraotDoc = PaginationEngine.paginateDocument({ title: 'Mikraot', layoutType: 'mikraot_gedolot', units: mikraot.units, geometry: GEOMETRY, links: mikraot.links });
    const mikraotLines = mikraotDoc.pages.flatMap(p => [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines, ...(p.tertiaryLines ?? []), ...(p.footnoteLines ?? []), ...(p.column2Lines ?? []), ...(p.sideNoteLines ?? [])]);
    check('Mikraot paginates to ≥1 page with lines', mikraotDoc.pages.length >= 1 && mikraotLines.length > 0, `${mikraotDoc.pages.length} pages, ${mikraotLines.length} lines`);
    check('Mikraot: 0 collisions', mikraotDoc.pages.every(p => (p.layoutScore?.collisionCount ?? 0) === 0),
      mikraotDoc.pages.map(p => p.layoutScore?.collisionCount).join(','));
    const mikraotFlaws = scanShasFlaws(mikraotDoc.pages, mikraot.units, mikraot.links);
    check('Mikraot: 0 text-overlap flaws', !mikraotFlaws.some(f => f.kind === 'text_overlap'),
      mikraotFlaws.filter(f => f.kind === 'text_overlap').map(f => f.messageHe).join('; ') || 'none');
  }

  console.log('§5  Part 4 — recipe settings made general (and the honest inventory)');
  {
    const panel = read(path.join(SRC, 'components/DesignTypesettingPanel.tsx'));
    check('Design has a COLUMN GAP control (page_geometry tab)',
      panel.includes('data-testid="design-column-gap"') && panel.includes('columnGutterPt: Number(e.target.value)'));
    check('column gap edits the LIVE field (pageLayout.columnGutterPt — the recipe field)',
      panel.includes('{ columnGutterPt: Number(e.target.value) }'));
    check('Design has FOOTNOTE SEPARATOR WIDTH + GAP controls (footnotes tab)',
      panel.includes('data-testid="design-footnote-separator-width"') &&
      panel.includes('data-testid="design-footnote-separator-gap"') &&
      panel.includes('separatorWidthRatio: Number(e.target.value) / 100') &&
      panel.includes('separatorSpacingBelowPt: Number(e.target.value)'));
    const paginator = read(path.join(SRC, 'engine/pagination-engine.ts'));
    check('engine: two_column reads the live column gap (columns.columnGapPt)',
      paginator.includes('designSettings?.columns?.columnGapPt'));
    const sanitizer = read(path.join(SRC, 'engine/design-settings-engine.ts'));
    check('engine: sanitizer heals columns.columnGapPt from pageLayout.columnGutterPt (recipe path == control path)',
      sanitizer.includes('settings.columns.columnGapPt = settings.pageLayout.columnGutterPt'));
    const canvas = read(path.join(SRC, 'components/PageCanvas.tsx'));
    check('canvas: footnote separator is drawn from separatorWidthRatio + separatorSpacingBelowPt',
      canvas.includes('separatorWidthRatio') && canvas.includes('separatorSpacingBelowPt'));

    // Live proof: the same two-column book paginated with gap 6 vs 40
    // must come out measurably different (columns move apart).
    const twoColUnits: ContentUnit[] = [
      { id: 'tc-src', role: 'main_source', rawText: 'טקסט מקור ארוך בשני טורים. '.repeat(60), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    ];
    const gapOf = (gutterPt: number): number => {
      const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'two_column' });
      const next = DesignSettingsEngine.updatePageLayout(base, { columnGutterPt: gutterPt }, 'user').settings;
      const doc = PaginationEngine.paginateDocument({ title: 'gap', layoutType: 'two_column', units: twoColUnits, geometry: GEOMETRY, designSettings: next });
      const lines = doc.pages[0] ? [...(doc.pages[0].column2Lines ?? []), ...doc.pages[0].sourceLines] : [];
      // RTL: column 1 is the RIGHT column; its lines start at
      // xLeft = gutter + colWidth. A bigger gutter pushes it right.
      const rightCol = lines.filter(l => (l.xLeft ?? 0) > 100);
      return rightCol.length > 0 ? Math.min(...rightCol.map(l => l.xLeft ?? 0)) : -1;
    };
    const gap6 = gapOf(6);
    const gap40 = gapOf(40);
    check('column gap 6 vs 40 moves the right column (live, not decoration)',
      gap6 > 0 && gap40 > 0 && gap40 > gap6, `xLeft of right column: gap6=${gap6} gap40=${gap40}`);

    // Honest inventory — settings that stay ungeneralisable (no fake controls):
    const deadRavText = ['rashiWidthRatio', 'tosafotWidthRatio', 'kneeStepDirection', 'lowerSourceWidthPercent', 'sourceExpansionBehavior', 'commentaryToSourceScaleRatio'];
    const deadReaders = deadRavText.filter(s =>
      paginator.includes(s) || read(path.join(SRC, 'engine/dynamic-knee.ts')).includes(s));
    check('dead ravText fields stay unexposed (no reader in paginator/knee: rashi/tosafotWidthRatio, kneeStepDirection, lowerSourceWidthPercent, sourceExpansionBehavior, commentaryToSourceScaleRatio)',
      deadReaders.length === 0, deadReaders.join(', '));
    check('columnCount stays unexposed (paginator hardcodes 1/2 columns by layoutType; no 3-column mode exists)',
      !paginator.includes('columnCount'));
    check('footnote placement/indent/spacing-above stay unexposed (no reader anywhere)',
      !/footnotes\?\.placement|footnotes\.indentPt|separatorSpacingAbovePt/.test(canvas + paginator));
  }

  console.log('§6  version');
  {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json'))) as { version: string };
    check('package.json version is 0.9.7', pkg.version === '0.9.7', pkg.version);
  }

  console.log(`\nv097-smoke: ${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
