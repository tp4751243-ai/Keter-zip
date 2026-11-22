/**
 * KETER-TYPE v0.9.0 Part A — layout recipe engine + Historical Layout
 * Library smoke.
 *
 * Run from the repo root:  npx tsx scripts/v090-partA-smoke.ts
 *
 * Pure-engine checks (no browser, no React) over the scratch tree:
 *  §A  every library recipe validates (aliases included); vilna-shas
 *      resolves to talmud-bavli; 9 resolved recipes, 10 entries
 *  §B  every recipe serializes/deserializes round-trip identical;
 *      deserialize rejects bad JSON and bad geometry
 *  §C  every resolved recipe applies to settings and paginates a
 *      multi-role document through the custom_layout path with
 *      0 collisions and every unit placed
 *  §D  suggestRecipe: Vilna-like → talmud-bavli, Mikraot-like →
 *      mikraot-gedolot, prose → machon-edition, siddur-like →
 *      siddur, SA-like → shulchan-aruch, unknown → low-confidence
 *      fallback
 *  §E  the three photo-informed recipes reproduce their page geometry
 *      (Vilna first-daf: boxed headword, header band, central column
 *      with knee, Rashi right / Tosafot left, outer-edge columns;
 *      Shulchan Aruch: central text between commentary columns, each
 *      with its own running header; Siddur: single column, centred
 *      running header, folio at the outer top corner, marginal strip)
 *      and paginate with their tiers in the right places, 0 collisions
 *  §F  recipeFromSettings round-trip + a mm/page-origin recipe converts
 *  §G  verso mirroring: Rashi/Tosafot swap sides
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  applyRecipeToSettings,
  deserializeRecipe,
  recipeFromSettings,
  recipePageGeometryPt,
  recipeToCustomLayoutBoxes,
  serializeRecipe,
  validateRecipe,
} from '../src/engine/layout-recipes';
import type { LayoutRecipe } from '../src/engine/layout-recipes';
import {
  HISTORICAL_LAYOUTS,
  getHistoricalRecipe,
  listHistoricalRecipes,
  resolveHistoricalRecipe,
  suggestRecipe,
} from '../src/engine/historical-layouts';
import type { DocumentClassification } from '../src/engine/historical-layouts';
import type { BookLayoutType, ContentUnit, PageGeometry, PageTypesetResult, TypesetLine } from '../src/types/typesetter';
import type { ProfessionalDesignSettings } from '../src/types/design-settings';

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

const GEMARA = 'אָמַר רַבִּי יְהוּדָה אָמַר רַב: כָּל הָעוֹסֵק בַּתּוֹרָה לִשְׁמָהּ — זוֹכֶה לִדְבָרִים הַרְבֵּה, וְנִקְרָא רֵעַ וְאָהוּב. ';
const RASHI = 'דיבור המתחיל: פירוש קצר על הגמרא, מילה במילה, בלשון ברורה וקצרה. ';
const TOSAFOT = 'תוספות: קושיא ותירוץ, דיון ארוך בין הראשונים, חילוקים וראיות. ';
const TERTIARY = 'עין משפט: סימן א׳ סעיף ב׳. ';
const VERSE = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ. ';
const PRAYER = 'ברוך אתה יי אלהינו מלך העולם, אשר קדשנו במצותיו וצונו על דברי תורה. ';
const NOTE = 'הערה קצרה. ';

function unit(id: string, role: ContentUnit['role'], text: string, order: number, extra?: Partial<ContentUnit>): ContentUnit {
  return { id, role, rawText: text, styleName: 'Normal', order, hierarchyLevel: 2, ...extra };
}

/** A 12-role document: every role the custom-layout flow must place. */
function makeGenericUnits(): ContentUnit[] {
  return [
    unit('u-main', 'main_source', GEMARA.repeat(40), 1),
    unit('u-heading', 'heading', 'פרק ראשון', 2, { hierarchyLevel: 1 }),
    unit('u-siman', 'siman', 'סימן א׳', 3, { hierarchyLevel: 1 }),
    unit('u-verse', 'verse', VERSE.repeat(20), 4),
    unit('u-para', 'regular_paragraph', PRAYER.repeat(20), 5),
    unit('u-rashi', 'primary_comment', RASHI.repeat(30), 6, { hierarchyLevel: 3, linkedSourceId: 'u-main' }),
    unit('u-tos', 'secondary_comment', TOSAFOT.repeat(30), 7, { hierarchyLevel: 3, linkedSourceId: 'u-main' }),
    unit('u-ter', 'tertiary_comment', TERTIARY.repeat(20), 8, { hierarchyLevel: 3 }),
    unit('u-dibbur', 'dibbur_hamatchil', 'ד״ה כל העוסק: פירוש הדיבור. '.repeat(10), 9, { hierarchyLevel: 3 }),
    unit('u-list', 'list_item', 'פרט ראשון ברשימה; פרט שני ברשימה; פרט שלישי ברשימה. '.repeat(8), 10),
    unit('u-table', 'table', 'שורה בטבלה: עמודה ראשונה, עמודה שניה, עמודה שלישית. '.repeat(8), 11),
    unit('u-foot', 'footnote', 'הערת שוליים קצרה על העמוד. '.repeat(10), 12),
    unit('u-side', 'side_note', NOTE.repeat(10), 13),
    unit('u-xref', 'cross_reference', 'ראה עוד שם. '.repeat(8), 14),
  ];
}

function allLines(pg: PageTypesetResult): TypesetLine[] {
  return [
    ...pg.sourceLines,
    ...pg.rashiLines,
    ...pg.tosafotLines,
    ...(pg.footnoteLines ?? []),
    ...(pg.column2Lines ?? []),
    ...(pg.sideNoteLines ?? []),
    ...(pg.tertiaryLines ?? []),
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
  return doc.pages.reduce((acc, pg) => acc + (pg.layoutScore?.collisionCount ?? 0), 0);
}

function approx(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

function geometryFromSettings(s: ProfessionalDesignSettings): PageGeometry {
  const pl = s.pageLayout;
  return {
    pageWidth: pl.pageWidthPt,
    pageHeight: pl.pageHeightPt,
    marginTop: pl.marginTopPt,
    marginBottom: pl.marginBottomPt,
    marginInside: pl.marginInsidePt,
    marginOutside: pl.marginOutsidePt,
    isVerso: false,
  };
}

function paginateWithRecipe(recipe: LayoutRecipe, units: ContentUnit[]) {
  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
  const settings = applyRecipeToSettings(recipe, base);
  const doc = PaginationEngine.paginateDocument({
    title: `v090-partA ${recipe.metadata.id}`,
    layoutType: 'custom_layout' as BookLayoutType,
    units,
    geometry: geometryFromSettings(settings),
    designSettings: settings,
  });
  return { settings, doc };
}

// ── §A — library validates ──────────────────────────────────────────────────

console.log('§A  library validation');
for (const r of HISTORICAL_LAYOUTS) {
  const errors = validateRecipe(r);
  check(`recipe '${r.metadata.id}' validates`, errors.length === 0, errors.join('; '));
}
check('library has 10 entries (9 recipes + vilna-shas alias)', HISTORICAL_LAYOUTS.length === 10, `${HISTORICAL_LAYOUTS.length}`);
check(
  "vilna-shas resolves to talmud-bavli",
  resolveHistoricalRecipe('vilna-shas')?.metadata.id === 'talmud-bavli',
);
check(
  "getHistoricalRecipe('vilna-shas') is the alias entry itself",
  getHistoricalRecipe('vilna-shas')?.aliasOf === 'talmud-bavli',
);
check('9 resolved recipes', listHistoricalRecipes().length === 9, `${listHistoricalRecipes().length}`);
check('unknown id resolves to undefined', resolveHistoricalRecipe('no-such-recipe') === undefined);
check(
  'apply refuses an alias (resolve first)',
  (() => {
    try {
      applyRecipeToSettings(getHistoricalRecipe('vilna-shas')!, DesignSettingsEngine.createDefaultSettings({}));
      return false;
    } catch {
      return true;
    }
  })(),
);

// ── §B — serialisation round-trip ───────────────────────────────────────────

console.log('§B  serialisation');
for (const r of listHistoricalRecipes()) {
  const json = serializeRecipe(r);
  const back = deserializeRecipe(json);
  check(
    `'${r.metadata.id}' round-trips identical`,
    JSON.stringify(back) === JSON.stringify(r),
  );
}
check(
  'deserialize rejects invalid JSON',
  (() => {
    try { deserializeRecipe('{not json'); return false; } catch { return true; }
  })(),
);
check(
  'validate rejects a region outside the page',
  (() => {
    const bad = JSON.parse(JSON.stringify(resolveHistoricalRecipe('machon-edition')!)) as LayoutRecipe;
    const region = bad.regions.find(rg => rg.role === 'main_text')!;
    if (region.shape.kind === 'rect') region.shape.x = 95;
    return validateRecipe(bad).length > 0;
  })(),
);
check(
  'validate rejects an unknown tier role',
  (() => {
    const bad = JSON.parse(JSON.stringify(resolveHistoricalRecipe('machon-edition')!)) as unknown as Record<string, unknown>;
    (bad['regions'] as Array<Record<string, unknown>>)[0]['role'] = 'nope';
    return validateRecipe(bad).length > 0;
  })(),
);

// ── §C — every recipe applies + paginates, 0 collisions, all placed ────────

console.log('§C  apply + paginate every recipe');
for (const recipe of listHistoricalRecipes()) {
  const units = makeGenericUnits();
  let settings: ProfessionalDesignSettings | undefined;
  let doc: ReturnType<typeof PaginationEngine.paginateDocument> | undefined;
  let applyError = '';
  try {
    ({ settings, doc } = paginateWithRecipe(recipe, units));
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }
  check(`'${recipe.metadata.id}' applies + paginates`, !!doc, applyError);
  if (!doc || !settings) continue;
  const placed = placedUnitIds(doc);
  const missing = units.map(u => u.id).filter(id => !placed.has(id));
  check(`'${recipe.metadata.id}' places every unit`, missing.length === 0, missing.join(','));
  check(`'${recipe.metadata.id}' has 0 collisions`, collisionCount(doc) === 0, `${collisionCount(doc)}`);
  check(
    `'${recipe.metadata.id}' reports no unplaceable text`,
    !(doc.autoFixesApplied ?? []).some(m => m.includes('לא ניתן היה להציב')),
    (doc.autoFixesApplied ?? []).join(' | '),
  );
  check(`'${recipe.metadata.id}' yields ≥1 page`, doc.pages.length >= 1, `${doc.pages.length} pages`);
  const boxes = settings.pageLayout.customLayout?.boxes ?? [];
  check(`'${recipe.metadata.id}' applied boxes do not overlap`, (() => {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const ox = Math.min(a.xPct + a.widthPct, b.xPct + b.widthPct) - Math.max(a.xPct, b.xPct);
        const oy = Math.min(a.yPct + a.heightPct, b.yPct + b.heightPct) - Math.max(a.yPct, b.yPct);
        if (ox > 0.5 && oy > 0.5) return false;
      }
    }
    return true;
  })());
}

// ── §D — suggestion ─────────────────────────────────────────────────────────

console.log('§D  suggestRecipe');
function expectSuggest(name: string, c: DocumentClassification, recipeId: string, minConfidence: number, fallback: boolean): void {
  const s = suggestRecipe(c);
  check(
    `${name} → ${recipeId}`,
    s.recipeId === recipeId && s.confidence >= minConfidence && s.fallback === fallback,
    `got ${s.recipeId} conf=${s.confidence} fallback=${s.fallback} (${s.reasons.join(' ')})`,
  );
}
expectSuggest(
  'Vilna-like',
  { roles: { main_source: 5, primary_comment: 4, secondary_comment: 4, tertiary_comment: 2 }, languages: ['he'], hasDibbur: true, commentaryCount: 3, isYiddish: false, hasFootnotes: false },
  'talmud-bavli', 0.9, false,
);
expectSuggest(
  'Mikraot-like',
  { roles: { verse: 8, primary_comment: 3, secondary_comment: 3, tertiary_comment: 3 }, languages: ['he'], hasDibbur: false, commentaryCount: 5, isYiddish: false, hasFootnotes: false },
  'mikraot-gedolot', 0.9, false,
);
expectSuggest(
  'prose',
  { roles: { regular_paragraph: 10, main_source: 2 }, languages: ['he'], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false },
  'machon-edition', 0.7, false,
);
expectSuggest(
  'siddur-like',
  { genreHint: 'siddur mincha', roles: { regular_paragraph: 8 }, languages: ['he'], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false },
  'siddur', 0.9, false,
);
expectSuggest(
  'Shulchan-Aruch-like',
  { genreHint: 'shulchan aruch', roles: { main_source: 4, siman: 3, seif: 6, primary_comment: 2 }, languages: ['he'], hasDibbur: false, commentaryCount: 3, isYiddish: false, hasFootnotes: false },
  'shulchan-aruch', 0.85, false,
);
expectSuggest(
  'Yiddish',
  { roles: { main_source: 3, primary_comment: 3 }, languages: ['yi', 'he'], hasDibbur: false, commentaryCount: 1, isYiddish: true, hasFootnotes: false },
  'yiddish-sefer', 0.9, false,
);
{
  const s = suggestRecipe({ roles: {}, languages: [], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false });
  check('unknown → low-confidence fallback', s.fallback === true && s.confidence < 0.5, `got ${s.recipeId} conf=${s.confidence} fallback=${s.fallback}`);
  const s2 = suggestRecipe({ roles: { main_source: 2, primary_comment: 1, secondary_comment: 1 }, languages: ['he'], hasDibbur: false, commentaryCount: 4, isYiddish: false, hasFootnotes: false });
  check('unknown commentary-heavy → two-column fallback', s2.fallback === true && s2.recipeId === 'shulchan-aruch', `got ${s2.recipeId} conf=${s2.confidence}`);
}

// ── §E — the three photo-informed recipes ──────────────────────────────────

console.log('§E  photo-recipe geometry + tier placement');

// — Vilna first daf (Berakhot 2a) —
{
  const recipe = resolveHistoricalRecipe('vilna-shas')!;
  const boxes = recipeToCustomLayoutBoxes(recipe);
  const byId = new Map(boxes.map(b => [b.id, b]));
  const header = boxes.find(b => b.role === 'header');
  const mishna = boxes.find(b => b.labelHe === 'משנה — כותרת פתיחה ממוסגרת');
  const gemara = byId.get('recipe-gemara');
  const rashi = boxes.find(b => b.labelHe === 'רש״י');
  const tosafot = boxes.find(b => b.labelHe === 'תוספות');
  const outer = boxes.find(b => b.labelHe === 'מפרשים נוספים — רבנו חננאל, ר״ן');
  const gilyon = byId.get('recipe-gilyon-hashas');
  const hagahot = byId.get('recipe-hagahot-habach');
  check('vilna: header band spans the full width at the top', !!header && approx(header.xPct, 0) && approx(header.widthPct, 100) && approx(header.yPct, 0));
  check(
    'vilna: boxed opening headword (Mishna) is centred above the Gemara',
    !!mishna && !!gemara && mishna.xPct > gemara.xPct && mishna.xPct + mishna.widthPct < gemara.xPct + gemara.widthPct && mishna.yPct + mishna.heightPct <= gemara.yPct,
    mishna ? `mishna x${mishna.xPct}–${mishna.xPct + mishna.widthPct} y${mishna.yPct}–${mishna.yPct + mishna.heightPct}; gemara y${gemara?.yPct}` : 'no mishna box',
  );
  check(
    'vilna: central Gemara column, Rashi right (inner) / Tosafot left (outer) on 2a',
    !!gemara && !!rashi && !!tosafot &&
      rashi.xPct > gemara.xPct + gemara.widthPct - 1 &&
      tosafot.xPct + tosafot.widthPct < gemara.xPct + 1,
    rashi && tosafot && gemara ? `rashi x${rashi.xPct}, gemara x${gemara.xPct}–${gemara.xPct + gemara.widthPct}, tosafot x${tosafot.xPct}–${tosafot.xPct + tosafot.widthPct}` : 'missing flank box',
  );
  check(
    'vilna: lower band holds Ein Mishpat / Masoret / Torah Or',
    ['עין משפט נר מצווה', 'מסורת הש״ס', 'תורה אור'].every(h => boxes.some(b => b.labelHe === h)),
  );
  check(
    'vilna: additional commentaries on the far outer edge, marginal notes below Rashi',
    !!outer && !!gilyon && !!hagahot &&
      approx(outer.xPct, 0) && approx(gilyon.xPct + gilyon.widthPct, 100) && hagahot.yPct > gilyon.yPct,
  );
  // Folio at the outer top corner (ב. on Berakhot 2a) + daf/amud numbering.
  const settings = applyRecipeToSettings(recipe, DesignSettingsEngine.createDefaultSettings({}));
  check('vilna: folio at the outer top corner', settings.pageLayout.pageNumberPosition === 'top_outside');
  check('vilna: daf-amud folio style with דף prefix', settings.pageElements.pageNumberStyle === 'hebrew' && settings.pageElements.showDafPrefix === true);
  // Paginate a first-daf document; tiers must land in their boxes.
  const units: ContentUnit[] = [
    unit('u-heading', 'heading', 'מאימתי פרק ראשון ברכות', 1, { hierarchyLevel: 1 }),
    unit('u-mishna', 'verse', 'מאימתי קורין את שמע בערבין. משעה שהכהנים נכנסים לאכול בתרומתן. '.repeat(4), 2),
    unit('u-gemara', 'main_source', GEMARA.repeat(25), 3),
    unit('u-rashi', 'primary_comment', RASHI.repeat(12), 4, { hierarchyLevel: 3, linkedSourceId: 'u-gemara' }),
    unit('u-tos', 'secondary_comment', TOSAFOT.repeat(12), 5, { hierarchyLevel: 3, linkedSourceId: 'u-gemara' }),
    unit('u-ein', 'tertiary_comment', 'עין משפט: רמב״ם הלכות קריאת שמע. '.repeat(6), 6),
    unit('u-masoret', 'tertiary_comment', 'מסורת הש״ס: ברכות דף ג׳. '.repeat(6), 7),
    unit('u-torahor', 'tertiary_comment', 'תורה אור: בראשית פרק א׳. '.repeat(6), 8),
    unit('u-chananel', 'tertiary_comment', 'רבנו חננאל: פירוש קצר. '.repeat(6), 9),
    unit('u-gilyon', 'side_note', NOTE.repeat(4), 10),
    unit('u-bach', 'side_note', NOTE.repeat(4), 11),
  ];
  const { doc } = paginateWithRecipe(recipe, units);
  const placed = placedUnitIds(doc);
  check('vilna: first-daf document places every unit', units.every(u => placed.has(u.id)));
  check('vilna: first-daf document has 0 collisions', collisionCount(doc) === 0, `${collisionCount(doc)}`);
  const boxOfUnit = new Map<string, string>();
  for (const pg of doc.pages) {
    for (const l of allLines(pg)) {
      if (l.unitId && l.customLayoutBoxId) boxOfUnit.set(l.unitId, l.customLayoutBoxId);
    }
  }
  check('vilna: heading lands in the header band', header !== undefined && boxOfUnit.get('u-heading') === header.id);
  check('vilna: Mishna headword lands in the boxed headword / Gemara column', mishna !== undefined && gemara !== undefined &&
    (boxOfUnit.get('u-mishna') === mishna.id || boxOfUnit.get('u-mishna') === gemara.id));
  check('vilna: Rashi lands in the Rashi (inner/right) box', rashi !== undefined && boxOfUnit.get('u-rashi') === rashi.id);
  check('vilna: Tosafot lands in the Tosafot (outer/left) box', tosafot !== undefined && boxOfUnit.get('u-tos') === tosafot.id);
  check('vilna: Gilyon note lands in a marginal box', gilyon !== undefined && boxOfUnit.get('u-gilyon') === gilyon.id);
}

// — Shulchan Aruch —
{
  const recipe = resolveHistoricalRecipe('shulchan-aruch')!;
  const boxes = recipeToCustomLayoutBoxes(recipe);
  const central = boxes.find(b => b.labelHe === 'שולחן ערוך — סימן וסעיף');
  const expectedHeaders = ['מגן אברהם', 'באור הגר״א', 'משנה ברורה', 'באור הלכה', 'באר היטב', 'שערי תשובה', 'ציונים ומקורות'];
  check(
    'shulchan-aruch: central text sits between the commentary columns',
    !!central &&
      boxes.some(b => b.labelHe === 'משנה ברורה' && b.xPct + b.widthPct <= central.xPct + 1) &&
      boxes.some(b => b.labelHe === 'מגן אברהם' && b.xPct >= central.xPct + central.widthPct - 1),
  );
  check(
    'shulchan-aruch: every commentary column carries its own running header',
    expectedHeaders.every(h => boxes.some(b => b.labelHe === h)),
    `${boxes.map(b => b.labelHe).join(' | ')}`,
  );
  const units: ContentUnit[] = [
    unit('u-heading', 'heading', 'אורח חיים — הלכות שבת', 1, { hierarchyLevel: 1 }),
    unit('u-siman', 'siman', 'סימן רמ״ב', 2, { hierarchyLevel: 1 }),
    unit('u-sa', 'main_source', 'סעיף א׳: כך הוא הדין. '.repeat(30), 3),
    unit('u-magen', 'primary_comment', 'מגן אברהם: פירוש קצר. '.repeat(12), 4),
    unit('u-gra', 'secondary_comment', 'באור הגר״א: פירוש קצר. '.repeat(12), 5),
    unit('u-mb', 'tertiary_comment', 'משנה ברורה: פירוש קצר. '.repeat(12), 6),
    unit('u-bh', 'tertiary_comment', 'באור הלכה: פירוש קצר. '.repeat(12), 7),
    unit('u-beer', 'tertiary_comment', 'באר היטב: פירוש קצר. '.repeat(8), 8),
    unit('u-shaar', 'tertiary_comment', 'שערי תשובה: פירוש קצר. '.repeat(8), 9),
    unit('u-tziyun', 'side_note', NOTE.repeat(6), 10),
  ];
  const { doc } = paginateWithRecipe(recipe, units);
  const placed = placedUnitIds(doc);
  check('shulchan-aruch: document places every unit', units.every(u => placed.has(u.id)));
  check('shulchan-aruch: 0 collisions', collisionCount(doc) === 0, `${collisionCount(doc)}`);
  const boxOfUnit = new Map<string, string>();
  for (const pg of doc.pages) {
    for (const l of allLines(pg)) {
      if (l.unitId && l.customLayoutBoxId) boxOfUnit.set(l.unitId, l.customLayoutBoxId);
    }
  }
  check('shulchan-aruch: SA text lands in the central column', central !== undefined && boxOfUnit.get('u-sa') === central.id);
  check(
    'shulchan-aruch: Magen Avraham lands in its own headed column',
    boxes.some(b => b.labelHe === 'מגן אברהם' && boxOfUnit.get('u-magen') === b.id),
  );
}

// — Siddur —
{
  const recipe = resolveHistoricalRecipe('siddur')!;
  const boxes = recipeToCustomLayoutBoxes(recipe);
  const main = boxes.find(b => b.role === 'main_text');
  const marginal = boxes.find(b => b.role === 'side_note');
  check('siddur: single-column main text', !!main && approx(main.widthPct, 88) && approx(main.xPct, 0));
  check('siddur: marginal strip at the outer (right) edge', !!marginal && approx(marginal.xPct, 90) && approx(marginal.widthPct, 10));
  check('siddur: running header is a rule, not a box', !boxes.some(b => b.role === 'header'));
  const settings = applyRecipeToSettings(recipe, DesignSettingsEngine.createDefaultSettings({}));
  check('siddur: centred running header “מנחה לשבת”', settings.pageElements.runningHeader.centerText === 'מנחה לשבת' && settings.pageElements.runningHeader.alignment === 'center');
  check('siddur: folio numbers at the outer top corners', settings.pageLayout.pageNumberPosition === 'top_outside' && settings.pageElements.folioNumberPosition === 'top_outside');
  check('siddur: plain-number folios, no דף prefix', settings.pageElements.pageNumberStyle === 'numbers' && settings.pageElements.showDafPrefix === false);
  const units: ContentUnit[] = [
    unit('u-heading', 'heading', 'ותחננה', 1, { hierarchyLevel: 1 }),
    unit('u-prayer', 'regular_paragraph', PRAYER.repeat(40), 2),
    unit('u-prayer2', 'main_source', PRAYER.repeat(30), 3),
    unit('u-note', 'side_note', NOTE.repeat(8), 4),
  ];
  const { doc } = paginateWithRecipe(recipe, units);
  const placed = placedUnitIds(doc);
  check('siddur: document places every unit', units.every(u => placed.has(u.id)));
  check('siddur: 0 collisions', collisionCount(doc) === 0, `${collisionCount(doc)}`);
  const boxOfUnit = new Map<string, string>();
  for (const pg of doc.pages) {
    for (const l of allLines(pg)) {
      if (l.unitId && l.customLayoutBoxId) boxOfUnit.set(l.unitId, l.customLayoutBoxId);
    }
  }
  check('siddur: section heading stays in the main-text flow (centred)', main !== undefined && boxOfUnit.get('u-heading') === main.id);
  check('siddur: marginal note lands in the outer strip', marginal !== undefined && boxOfUnit.get('u-note') === marginal.id);
}

// ── §F — export round-trip + mm/page-origin ─────────────────────────────────

console.log('§F  recipeFromSettings + mm/page-origin');
{
  const recipe = resolveHistoricalRecipe('talmud-bavli')!;
  const base = DesignSettingsEngine.createDefaultSettings({});
  const applied = applyRecipeToSettings(recipe, base);
  const exported = recipeFromSettings(applied, {
    id: 'talmud-bavli-export',
    name: 'Talmud Bavli (exported)',
    description: 'Round-trip export of the applied Vilna recipe.',
    genre: ['talmud'],
    origin: 'exported from settings',
  });
  check('exported recipe validates', validateRecipe(exported).length === 0, validateRecipe(exported).join('; '));
  const origBoxes = recipeToCustomLayoutBoxes(recipe);
  const expBoxes = recipeToCustomLayoutBoxes(exported);
  check(
    'exported recipe keeps the same boxes',
    origBoxes.length === expBoxes.length &&
      origBoxes.every((b, i) =>
        Math.abs(b.xPct - expBoxes[i].xPct) < 0.6 &&
        Math.abs(b.yPct - expBoxes[i].yPct) < 0.6 &&
        Math.abs(b.widthPct - expBoxes[i].widthPct) < 0.6 &&
        Math.abs(b.heightPct - expBoxes[i].heightPct) < 0.6 &&
        b.role === expBoxes[i].role,
      ),
    `${origBoxes.length} vs ${expBoxes.length} boxes`,
  );
  // mm + page origin: a 100×100mm region at (20,20) on a 200×280mm page
  // with 10mm margins → content-relative 5.56% / 3.85% / 55.56% / 38.46%.
  const mmRecipe: LayoutRecipe = {
    keterTemplateVersion: 1,
    metadata: { id: 'mm-test', name: 'mm test', description: 'mm/page-origin conversion check.', genre: ['test'], origin: 'smoke' },
    regions: [
      {
        id: 'main-mm', role: 'main_text',
        shape: { kind: 'rect', x: 20, y: 20, w: 100, h: 100 },
        units: 'mm', origin: 'page',
      },
    ],
    flow: [],
    page: { widthMm: 200, heightMm: 280, marginTopMm: 10, marginBottomMm: 10, marginInsideMm: 10, marginOutsideMm: 10 },
  };
  check('mm/page-origin recipe validates', validateRecipe(mmRecipe).length === 0);
  const [box] = recipeToCustomLayoutBoxes(mmRecipe);
  check(
    'mm/page-origin region converts to content %',
    !!box &&
      Math.abs(box.xPct - 5.56) < 0.1 && Math.abs(box.yPct - 3.85) < 0.1 &&
      Math.abs(box.widthPct - 55.56) < 0.1 && Math.abs(box.heightPct - 38.46) < 0.1,
    box ? `x${box.xPct} y${box.yPct} w${box.widthPct} h${box.heightPct}` : 'no box',
  );
}

// ── §G — verso mirroring ────────────────────────────────────────────────────

console.log('§G  verso mirroring');
{
  const recipe = resolveHistoricalRecipe('talmud-bavli')!;
  const recto = recipeToCustomLayoutBoxes(recipe, { facingPage: 'recto' });
  const verso = recipeToCustomLayoutBoxes(recipe, { facingPage: 'verso' });
  const r = (bs: typeof recto, label: string) => bs.find(b => b.labelHe === label);
  check(
    'verso: Rashi moves to the left, Tosafot to the right',
    !!r(recto, 'רש״י') && !!r(verso, 'רש״י') && !!r(recto, 'תוספות') && !!r(verso, 'תוספות') &&
      r(recto, 'רש״י')!.xPct > 50 && r(verso, 'רש״י')!.xPct < 50 &&
      r(recto, 'תוספות')!.xPct < 50 && r(verso, 'תוספות')!.xPct > 50,
  );
  check(
    'verso: Gemara stays centred',
    !!r(recto, 'גמרא') && !!r(verso, 'גמרא') &&
      Math.abs(r(recto, 'גמרא')!.xPct - r(verso, 'גמרא')!.xPct) < 0.01,
  );
}

// ── summary ─────────────────────────────────────────────────────────────────

console.log(`\nv090-partA-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
