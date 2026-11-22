/**
 * KETER-TYPE v0.9.0 — merged integrator smoke.
 *
 * Run from the repo root:  npx tsx scripts/v090-smoke.ts
 *
 * Cross-part checks (no browser, no React) over the MERGED tree — the seams
 * the three parts could not test against each other:
 *  §1  every library recipe (Part A) applies + paginates a multi-role
 *      document through the custom_layout path, 0 collisions, all placed
 *  §2  recipe → Designer boxes → template round trip (Part A ↔ Part B):
 *      Vilna recipe → boxes → recipeFromBoxes → serialize → deserialize
 *      → apply → same boxes, custom_layout
 *  §3  auto-layout end-to-end (Part C → Part A): a real .docx of each major
 *      type is classified, the recipe is applied, the document paginates
 *      with no collisions; low-confidence input falls back, stated
 *  §4  "Change layout": library pickers resolve, the alias resolves, the
 *      NL "Change layout" command parses, a recipe can be re-applied
 *  §5  first-daf geometry (Berakhot 2a, talmud-2_5_qm04.pdf): boxed
 *      headword, header band, central column with knee, Rashi right /
 *      Tosafot left on recto, outer-edge commentary columns
 *  §6  template export/import via the engine: recipeFromSettings →
 *      serialize → deserialize → apply keeps the geometry
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { DOMParser } from '@xmldom/xmldom';
// The docx importer runs under tsx (Node), where DOMParser / Node are
// not globals — install the @xmldom shims before importing it.
(globalThis as Record<string, unknown>).DOMParser = DOMParser;
(globalThis as Record<string, unknown>).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
import JSZip from 'jszip';
import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  applyRecipeToSettings,
  deserializeRecipe,
  recipeFromBoxes,
  recipeFromSettings,
  recipeToCustomLayoutBoxes,
  serializeRecipe,
  validateRecipe,
} from '../src/engine/layout-recipes';
import {
  getHistoricalLayoutLibrary,
  getRecipeById,
  listHistoricalRecipes,
} from '../src/engine/historical-layouts';
import {
  applyAutoLayout,
  classifyForImport,
  parseAutoLayoutCommand,
} from '../src/engine/auto-layout';
import { defaultBoxesForBaseLayout } from '../src/engine/custom-layout-engine';
import type { ContentUnit, PageTypesetResult, TypesetLine } from '../src/types/typesetter';

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

const GEMARA = 'אָמַר רַבִּי יְהוּדָה אָמַר רַב: כָּל הָעוֹסֵק בַּתּוֹרָה לִשְׁמָהּ — זוֹכֶה לִדְבָרִים הַרְבֵּה. ';
const RASHI = 'דיבור המתחיל: פירוש קצר על הגמרא, מילה במילה. ';
const TOSAFOT = 'תוספות: קושיא ותירוץ, דיון ארוך בין הראשונים. ';

function unit(id: string, role: ContentUnit['role'], text: string, order: number, extra?: Partial<ContentUnit>): ContentUnit {
  return { id, role, rawText: text, styleName: 'Normal', order, hierarchyLevel: 2, ...extra };
}
function makeGenericUnits(): ContentUnit[] {
  return [
    unit('u-main', 'main_source', GEMARA.repeat(40), 1),
    unit('u-heading', 'heading', 'פרק ראשון', 2, { hierarchyLevel: 1 }),
    unit('u-verse', 'verse', 'בְּרֵאשִׁית בָּרָא אֱלֹהִים. '.repeat(20), 3),
    unit('u-para', 'regular_paragraph', 'ברוך אתה יי. '.repeat(20), 4),
    unit('u-rashi', 'primary_comment', RASHI.repeat(30), 5, { hierarchyLevel: 3, linkedSourceId: 'u-main' }),
    unit('u-tos', 'secondary_comment', TOSAFOT.repeat(30), 6, { hierarchyLevel: 3, linkedSourceId: 'u-main' }),
    unit('u-ter', 'tertiary_comment', 'עין משפט: סימן א׳. '.repeat(20), 7, { hierarchyLevel: 3 }),
    unit('u-foot', 'footnote', 'הערת שוליים. '.repeat(10), 8),
    unit('u-side', 'side_note', 'הערה קצרה. '.repeat(10), 9),
  ];
}
function allLines(pg: PageTypesetResult): TypesetLine[] {
  return [
    ...pg.sourceLines, ...pg.rashiLines, ...pg.tosafotLines,
    ...(pg.footnoteLines ?? []), ...(pg.column2Lines ?? []),
    ...(pg.sideNoteLines ?? []), ...(pg.tertiaryLines ?? []),
  ];
}
function placedUnitIds(doc: { pages: PageTypesetResult[] }): Set<string> {
  const ids = new Set<string>();
  for (const pg of doc.pages) {
    for (const l of allLines(pg)) {
      if (l.unitId) ids.add(l.unitId);
      for (const w of l.words ?? []) if (w.unitId) ids.add(w.unitId);
    }
  }
  return ids;
}
function collisionCount(doc: { pages: PageTypesetResult[] }): number {
  // The paginator's own collision metric (same as the Part A smoke).
  return doc.pages.reduce((acc, pg) => acc + (pg.layoutScore?.collisionCount ?? 0), 0);
}

// ── §1 — every library recipe paginates ──────────────────────────────────
console.log('§1  library recipes paginate');
for (const recipe of listHistoricalRecipes()) {
  const units = makeGenericUnits();
  const settings = DesignSettingsEngine.createDefaultSettings();
  let applied;
  let doc;
  try {
    applied = applyRecipeToSettings(recipe, settings);
    doc = PaginationEngine.paginateDocument({
      title: recipe.metadata.id, layoutType: 'custom_layout', units,
      geometry: applied.pageLayout.geometry, links: [], designSettings: applied,
    });
  } catch (e) {
    check(`'${recipe.metadata.id}' applies + paginates`, false, e instanceof Error ? e.message : String(e));
    continue;
  }
  const placed = placedUnitIds(doc);
  const missing = units.map(u => u.id).filter(id => !placed.has(id));
  check(`'${recipe.metadata.id}' places every unit`, missing.length === 0, missing.join(','));
  check(`'${recipe.metadata.id}' has 0 collisions`, collisionCount(doc) === 0, `${collisionCount(doc)}`);
  check(`'${recipe.metadata.id}' yields ≥1 page`, doc.pages.length >= 1, `${doc.pages.length} pages`);
}

// ── §2 — recipe → Designer boxes → template round trip ───────────────────
console.log('§2  recipe → designer → template round trip');
const vilna = getRecipeById('vilna-shas');
check('vilna-shas resolves', vilna !== undefined);
if (vilna) {
  const boxes = recipeToCustomLayoutBoxes(vilna);
  check('Vilna recipe yields boxes', boxes.length > 0, `${boxes.length} boxes`);
  const exported = recipeFromBoxes(boxes, vilna.baseLayout ?? 'rav_text', { nameHe: 'ש״ס וילנא', nameEn: 'Vilna Shas' });
  check('designer export validates clean', validateRecipe(exported).length === 0, validateRecipe(exported)[0] ?? '');
  const json = serializeRecipe(exported);
  const back = deserializeRecipe(json);
  check('template round-trip keeps the regions', back.regions.length === exported.regions.length);
  const settings = DesignSettingsEngine.createDefaultSettings();
  const applied = applyRecipeToSettings(back, settings);
  check(
    'round-tripped template applies as custom_layout with the same boxes',
    applied.layoutType === 'custom_layout' &&
      (applied.pageLayout.customLayout?.boxes.length ?? 0) === boxes.length,
    `${applied.pageLayout.customLayout?.boxes.length ?? 0} boxes`
  );
  // Designer default boxes (the app's own defaults) export + re-import too.
  const defaults = defaultBoxesForBaseLayout('rav_text');
  const defExported = recipeFromBoxes(defaults, 'rav_text', { nameHe: 'ברירת מחדל' });
  check('app default boxes export clean', validateRecipe(defExported).length === 0, validateRecipe(defExported)[0] ?? '');
  const defApplied = applyRecipeToSettings(deserializeRecipe(serializeRecipe(defExported)), settings);
  check('app default boxes re-apply', defApplied.layoutType === 'custom_layout');
}

// ── §3 — auto-layout end-to-end on real .docx files ──────────────────────
console.log('§3  auto-layout end-to-end');
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const para = (text: string, style?: string): string =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
async function buildDocx(paras: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}
async function importDocx(paras: string[]) {
  const buf = await buildDocx(paras);
  const res = await DocxImporter.importDocx(buf, 'test.docx');
  return res;
}
const GEMARA_DOC = 'תנא היכא קאי דקתני מאימתי ותו מאי שנא דתני דערבית ברישא לתני דשחרית ברישא תנא אקרא קאי דכתיב בשכבך ובקומך. ';
const MISHNA_DOC = 'משנה: מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן עד סוף האשמורה הראשונה. ';
const RASHI_DOC = 'מאימתי קורין את שמע בערבית פירוש מאיזה זמן קורין ולא קתני משעה שהכוכבים יוצאים. ';
const TOSAFOT_DOC = 'תנא היכא קאי דקתני מאימתי קושיא ותירוץ ארוך בין הראשונים חילוקים וראיות. ';
// Word styles are the classifier's signal (as in v090-partC-smoke §1):
// 'Rashi' / 'Tosafot' / 'Ein Mishpat' / 'Masoret HaShas' / 'Gilyon'.
const vilnaRes = await importDocx([
  para('מסכת ברכות — פרק ראשון', 'Heading 1'),
  para('דף ב.', 'Folio'),
  para(MISHNA_DOC, 'Mishna'),
  ...Array.from({ length: 8 }, () => para(GEMARA_DOC)),
  ...Array.from({ length: 8 }, () => para(RASHI_DOC, 'Rashi')),
  ...Array.from({ length: 8 }, () => para(TOSAFOT_DOC, 'Tosafot')),
  para('עין משפט: סימן א סעיף ב.', 'Ein Mishpat'),
  para('מסורת הש״ס: ברכות דף ג.', 'Masoret HaShas'),
  para('גליון הש״ס: הערה של ר׳ עקיבא איגר.', 'Gilyon'),
]);
const vilnaInfo = classifyForImport(vilnaRes.units, vilnaRes.links ?? []);
check('Vilna-like .docx auto-selects vilna-shas', vilnaInfo.decision.recipeId === 'vilna-shas', vilnaInfo.decision.lineEn);
check('Vilna decision is not a fallback', vilnaInfo.decision.isFallback === false);
const vilnaApplied = applyAutoLayout(vilnaRes.units, vilnaRes.links ?? [], DesignSettingsEngine.createDefaultSettings());
check('Vilna auto-layout lands on custom_layout', vilnaApplied.settings.layout.layoutType === 'custom_layout');
const vilnaDoc = PaginationEngine.paginateDocument({
  title: 'vilna', layoutType: 'custom_layout', units: vilnaRes.units,
  geometry: vilnaApplied.settings.pageLayout.geometry, links: vilnaRes.links ?? [],
  designSettings: vilnaApplied.settings,
});
check('Vilna auto-layout paginates ≥1 page', vilnaDoc.pages.length >= 1, `${vilnaDoc.pages.length} pages`);
check('Vilna auto-layout has 0 collisions', collisionCount(vilnaDoc) === 0, `${collisionCount(vilnaDoc)}`);

const proseRes = await importDocx([
  para('A short essay about the history of printing. '.repeat(20), 'Normal'),
  para('The press changed everything. '.repeat(20), 'Normal'),
]);
const proseInfo = classifyForImport(proseRes.units, proseRes.links ?? []);
check('plain prose falls back, stated', proseInfo.decision.isFallback === true && proseInfo.decision.recipeId === 'single-column', proseInfo.decision.lineEn);

// ── §4 — "Change layout" ─────────────────────────────────────────────────
console.log('§4  change layout');
const library = getHistoricalLayoutLibrary();
check('picker lists 9 historical layouts', library.length === 9);
check('alias resolves for the picker', getRecipeById('vilna-shas')?.metadata.id === 'talmud-bavli');
const changeCmd = parseAutoLayoutCommand('Change layout');
check('NL "Change layout" parses', changeCmd?.action === 'changeLayout');
const applyCmd = parseAutoLayoutCommand('Format this text like a Vilna Shas folio');
check('NL Vilna Shas → applyHistoricalLayout vilna-shas', applyCmd?.action === 'applyHistoricalLayout' && applyCmd?.recipeId === 'vilna-shas');
if (vilna) {
  const settings = DesignSettingsEngine.createDefaultSettings();
  const first = applyRecipeToSettings(vilna, settings);
  const shulchan = getRecipeById('shulchan-aruch');
  const second = shulchan ? applyRecipeToSettings(shulchan, first) : null;
  check('re-applying another recipe replaces the layout', second !== null && second.layoutType === 'custom_layout' && second.pageLayout.customLayout?.boxes.length !== first.pageLayout.customLayout?.boxes.length);
}

// ── §5 — first-daf geometry (Berakhot 2a) ───────────────────────────────
console.log('§5  first-daf geometry');
if (vilna) {
  const boxes = recipeToCustomLayoutBoxes(vilna);
  const byLabel = (he: string) => boxes.find(b => (b.labelHe ?? '').includes(he));
  const header = byLabel('כותרת הדף');
  const headword = byLabel('ממוסגרת');
  const gemara = byLabel('גמרא');
  const rashi = byLabel('רש״י');
  const tosafot = byLabel('תוספות');
  check('header band sits at the top', !!header && header.yPct < 6, `y=${header?.yPct}`);
  check('boxed headword is centred above the Gemara', !!headword && !!gemara && Math.abs((headword.xPct + headword.widthPct / 2) - (gemara.xPct + gemara.widthPct / 2)) < 6, `headword cx=${headword ? (headword.xPct + headword.widthPct / 2).toFixed(1) : '—'} gemara cx=${gemara ? (gemara.xPct + gemara.widthPct / 2).toFixed(1) : '—'}`);
  check('headword is above the Gemara', !!headword && !!gemara && headword.yPct + headword.heightPct <= gemara.yPct + 1, `headword y=${headword?.yPct} gemara y=${gemara?.yPct}`);
  check('Rashi is on the right (inner) side on recto', !!rashi && !!gemara && rashi.xPct > gemara.xPct + gemara.widthPct - 1, `rashi x=${rashi?.xPct} gemara right=${gemara ? gemara.xPct + gemara.widthPct : '—'}`);
  check('Tosafot is on the left (outer) side on recto', !!tosafot && !!gemara && tosafot.xPct + tosafot.widthPct <= gemara.xPct + 1, `tosafot right=${tosafot ? tosafot.xPct + tosafot.widthPct : '—'} gemara x=${gemara?.xPct}`);
  const outer = boxes.filter(b => b.xPct < 3 || b.xPct + b.widthPct > 97);
  check('outer-edge commentary columns exist', outer.length >= 1, `${outer.length} edge boxes`);
}

// ── §6 — template export/import via the engine ───────────────────────────
console.log('§6  template export/import via engine');
{
  const settings = DesignSettingsEngine.createDefaultSettings();
  const vilnaApplied = vilna ? applyRecipeToSettings(vilna, settings) : settings;
  const exported = recipeFromSettings(vilnaApplied, {
    id: 'export-check',
    name: 'Export check',
    nameHe: 'בדיקת ייצוא',
    description: 'Template exported from the current book.',
    genre: ['custom'],
    origin: 'smoke',
  });
  check('exported template validates clean', validateRecipe(exported).length === 0, validateRecipe(exported)[0] ?? '');
  const reimported = deserializeRecipe(serializeRecipe(exported));
  const reapplied = applyRecipeToSettings(reimported, DesignSettingsEngine.createDefaultSettings());
  check(
    're-imported template applies with the same geometry',
    reapplied.layoutType === 'custom_layout' &&
      Math.abs(reapplied.pageLayout.pageWidthPt - vilnaApplied.pageLayout.pageWidthPt) < 1 &&
      (reapplied.pageLayout.customLayout?.boxes.length ?? 0) === (vilnaApplied.pageLayout.customLayout?.boxes.length ?? 0),
    `${reapplied.pageLayout.customLayout?.boxes.length ?? 0} boxes`
  );
}

console.log(`\nv090-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
