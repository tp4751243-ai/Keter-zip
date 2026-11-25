/**
 * Two-column Chassidic sefer — trained on the user's Kedushat Levi prints
 * (HebrewBooks 42516 / 50006) and Word file. The user: "the two-column
 * sefer doesn't work at all". It was:
 *  - imported as a Vilna Shas tractate (a few Gemara quotes in 1,469
 *    paragraphs), body paragraphs pulled out as "Rashi" (any `ד"ה`
 *    quoted mid-paragraph), "running heads" (a paragraph opening with
 *    "מסכת ברכות דף ד׳ …") and "margin notes" (opening with "עיין");
 *  - and with the two-column card, laid out by the Shulchan Aruch recipe.
 *
 *   npx tsx scripts/training/two-column-sefer-test.ts
 *
 * The test text is written here (no user file is committed).
 */
import * as path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const FONT_DIR = path.resolve('public/fonts');
for (const [f, fam] of [
  ['FrankRuhlLibre-Regular.ttf', 'Frank Ruhl Libre'],
  ['FrankRuhlLibre-Bold.ttf', 'Frank Ruhl Libre'],
  ['NotoRashiHebrew-Regular.ttf', 'Noto Rashi Hebrew'],
  ['NotoSerifHebrew-Regular.ttf', 'Noto Serif Hebrew'],
] as const) GlobalFonts.registerFromPath(path.join(FONT_DIR, f), fam);
(globalThis as any).document = { createElement: () => { const c = createCanvas(1, 1) as any; c.setAttribute = () => {}; c.style = {}; return c; } };

import type { ContentUnit, PageTypesetResult, TypesetLine } from '../../src/types/typesetter';
import { classifyForImport, applyRecipeToSettingsById } from '../../src/engine/auto-layout';
import { classifyShasParagraph } from '../../src/engine/vilna-shas';
import { DesignSettingsEngine } from '../../src/engine/design-settings-engine';
import { PaginationEngine } from '../../src/engine/pagination-engine';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

// ── the book: title, parshiyot (Heading 2), the same heading again as Heading 3, drush paragraphs
const PARSHIYOT = ['בראשית', 'נח', 'לך לך', 'וירא', 'חיי שרה'];
const FILLER = [
  'הכלל שהבורא ברוך הוא ברא הכל והוא הכל והוא היה הוה ויהיה',
  'ונראה לפרש על פי מה שכתוב בספרי קודש כי כל העולמות מקבלים שפע מהבורא יתברך',
  'וזהו שאמרו רבותינו זכרונם לברכה במדרש על פסוק זה והבן',
  'כי באמת כל מעשה האדם צריך להיות לשם שמים ובזה מעורר רחמים רבים',
  'ובזה יבואר הפסוק כי השם יתברך משפיע חסד לכל העולמות בכל רגע',
];
let n = 0;
const units: ContentUnit[] = [];
const add = (role: ContentUnit['role'], rawText: string, extra: Partial<ContentUnit> = {}) =>
  units.push({ id: `u${n}`, role, rawText, styleName: role, order: n++, hierarchyLevel: 2, language: 'he', ...extra } as ContentUnit);
add('chapter', 'קדושת לוי', { hierarchyLevel: 1 });
PARSHIYOT.forEach((p, pi) => {
  add('heading', p, { hierarchyLevel: 2 });
  add('heading', p, { hierarchyLevel: 3 }); // Word: Heading 3 repeats the parsha name
  for (let k = 0; k < 40; k++) {
    const opening = ['או יאמר', 'עוד יבואר', 'ונראה לפרש', 'בפסוק', 'במדרש'][k % 5];
    let body = Array.from({ length: 5 + (k % 4) }, (_, j) => FILLER[(k + j + pi) % FILLER.length]).join(', ') + ':';
    if (k % 9 === 0) body = 'והוא דרוש נפלא. ' + body; // Chassidic markers
    if (k === 7) body = 'תנו רבנן ' + body; // a Gemara quote now and then
    add('main_source', `${opening} ${body}`, {
      textRuns: [
        { text: opening, isBold: true, isDibbur: false, isItalic: false, isUnderline: false },
        { text: ' ' + body, isBold: false, isDibbur: false, isItalic: false, isUnderline: false },
      ] as ContentUnit['textRuns'],
    });
  }
});

// ── 1. the importer leaves drush paragraphs in the text
const long = ' '.repeat(1) + FILLER.join(' ');
check('a long paragraph opening "מסכת ברכות דף ד׳ ע״א …" is body text, not a running head',
  classifyShasParagraph(`מסכת ברכות דף ד' ע"א בגמרא ${long}`, 'bodyrtl') === null);
check('a long paragraph opening "עיין …" is body text, not a margin note',
  classifyShasParagraph(`עיין בארוך ${long} ${long}`, 'bodyrtl') === null);
check('a short "דף ב." line is still a running head', classifyShasParagraph('דף ב.', '')?.role === 'page_element');

// ── 2. the book type
const d = classifyForImport(units, [], { fileName: 'קדושת לוי.docx' }).decision;
check('a Chassidic drush book with a few Gemara quotes is NOT a Vilna Shas', !/vilna|talmud|shas/.test(d.recipeId), `${d.recipeId}: ${d.lineEn}`);
check('… nor a Mikraot Gedolot (parsha headings alone are not a Chumash)', !/mikraot|chumash/.test(d.recipeId), d.recipeId);
check('it is laid out as a Chassidic sefer in two columns', d.recipeId === 'chassidic-drush' && d.layoutType === 'two_column', `${d.recipeId} / ${d.layoutType}`);

// ── 3. the page (the prints' rules)
const settings = applyRecipeToSettingsById('chassidic-drush', DesignSettingsEngine.createDefaultSettings({ layoutType: 'two_column' }));
check('the recipe lays out with the two-column engine', settings.layout.layoutType === 'two_column', settings.layout.layoutType);
const log = console.log;
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('Diagnostic:')) return; log(...a); };
const doc = PaginationEngine.paginateDocument({ title: 'קדושת לוי', layoutType: 'two_column', units, geometry: settings.pageLayout.geometry, designSettings: settings });
console.log = log;
const body = doc.pages.filter(p => !p.isTitlePage);
const lines = (p: PageTypesetResult): TypesetLine[] => [...p.sourceLines, ...(p.column2Lines ?? [])];
const g = settings.pageLayout.geometry;
const contentW = g.pageWidth - g.marginInside - g.marginOutside;

const bodyLines = body.flatMap(lines).filter(l => l.role === 'main_source');
const cols = new Set(bodyLines.map(l => Math.round(l.xLeft ?? -1)));
check('two columns of text', cols.size === 2, `column starts ${[...cols].join(', ')}`);
check('every body line inside half the width (a column)', bodyLines.every(l => (l.xRight ?? 0) - (l.xLeft ?? 0) < contentW * 0.55));
const words = bodyLines.flatMap(l => l.words.filter(w => !w.isSpace));
const rashi = words.filter(w => w.fontFamily === 'Noto Rashi Hebrew').length;
check('the body is in Rashi script', rashi / Math.max(1, words.length) > 0.8, `${rashi}/${words.length}`);
const openers = bodyLines.filter(l => l.words.some(w => w.text === 'עוד')).flatMap(l => l.words.filter(w => w.text === 'עוד'));
check('the opening words are bold square letters', openers.length > 0 && openers.every(w => w.isBold && w.fontFamily === 'Frank Ruhl Libre'), `${openers.length} openers`);
check('no first-line indent', bodyLines.every(l => !(l.firstLineIndentPt ?? 0)));

const headLines = body.flatMap(lines).filter(l => l.role === 'heading');
check('parsha headings sit inside the column (not across the page)', headLines.length > 0 && headLines.every(l => (l.xRight ?? 0) - (l.xLeft ?? 0) < contentW * 0.55));
const headTexts = headLines.map(l => l.words.filter(w => !w.isSpace).map(w => w.text).join(' '));
check('a heading repeated in the Word file is printed once', PARSHIYOT.every(p => headTexts.filter(t => t === p).length === 1), headTexts.join(' | '));
let headAtFoot = 0;
for (const p of body) {
  for (const x of new Set(lines(p).map(l => Math.round(l.xLeft ?? 0)))) {
    const col = lines(p).filter(l => Math.round(l.xLeft ?? 0) === x).sort((a, b) => a.yBaseline - b.yBaseline);
    if (col.length && col[col.length - 1].role === 'heading' && p !== body[body.length - 1]) headAtFoot++;
  }
}
check('a heading never ends a column', headAtFoot === 0, `${headAtFoot}`);

const fills = body.slice(0, -1).map(p => {
  const ls = lines(p);
  const ch = p.geometry.pageHeight - p.geometry.marginTop - p.geometry.marginBottom;
  return ls.length ? Math.max(...ls.map(l => l.yBaseline)) / ch : 0;
});
check('every page but the last is filled (≥ 85%)', fills.every(f => f >= 0.85), `min ${(Math.min(...fills) * 100).toFixed(0)}%`);

const heads = body.map(p => (p.vilnaHeader?.items ?? []).filter(i => i.yBaseline < p.geometry.marginTop).map(i => i.words.map(w => w.text).join(' ')).join(' | '));
check('the columns start under the head as in print b (text at ≥ 7% of the page height)', body.every(p => Math.min(...lines(p).map(l => (l.yTop ?? l.yBaseline - 10))) + p.geometry.marginTop >= p.geometry.pageHeight * 0.07), String(body[1].geometry.marginTop));
check('body 13 pt Rashi script on a 16.5 pt line (print b: 50 lines a column)', bodyLines.every(l => Math.abs((l.leadingPt ?? 0) - 16.5) < 0.6 && Math.abs((l.fontSizePt ?? 0) - 13) < 0.6), `${bodyLines[0]?.fontSizePt} / ${bodyLines[0]?.leadingPt}`);
check('running head: "קדושת" over the first column and "לוי" over the second, on every page', body.every(p => {
  const items = (p.vilnaHeader?.items ?? []).filter(i => i.yBaseline < p.geometry.marginTop);
  const at = (t: string) => items.find(i => i.words.map(w => w.text).join(' ') === t);
  const k = at('קדושת'), l = at('לוי');
  const mid = (p.geometry.textLeftPt ?? p.geometry.marginOutside) + (p.geometry.pageWidth - p.geometry.marginInside - p.geometry.marginOutside) / 2;
  return !!k && !!l && k.xLeft > mid && l.xRight < mid;
}), heads[3]);
check('the book title is never printed twice in the head', heads.every(h => !h.includes('קדושת לוי')), heads[0]);
check('running head: the parsha of the page', body.some((p, i) => heads[i].includes('נח')), heads.find(h => h.includes('נח')) ?? '');
let catchOk = 0;
for (let i = 0; i + 1 < body.length; i++) {
  const next = lines(body[i + 1]);
  const right = Math.max(...next.map(l => l.xRight ?? 0));
  const first = next.filter(l => Math.abs((l.xRight ?? 0) - right) < 2).sort((a, b) => a.yBaseline - b.yBaseline)[0];
  const word = first?.words.find(w => !w.isSpace)?.text ?? '';
  const items = body[i].vilnaHeader?.items ?? [];
  if (items.some(it => it.yBaseline > body[i].geometry.pageHeight - body[i].geometry.marginBottom && it.words[0]?.text === word)) catchOk++;
}
check('catchword: the next page’s first word at the foot of every page', catchOk === body.length - 1, `${catchOk}/${body.length - 1}`);

// collisions
let coll = 0;
for (const p of body) {
  const ls = lines(p);
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    const a = ls[i], b = ls[j];
    const v = Math.min(a.yBaseline, b.yBaseline) - Math.max(a.yBaseline - (a.fontSizePt ?? 12) * 0.7, b.yBaseline - (b.fontSizePt ?? 12) * 0.7);
    const h = Math.min(a.xRight ?? 0, b.xRight ?? 0) - Math.max(a.xLeft ?? 0, b.xLeft ?? 0);
    if (v > 0.5 && h > 0.5) coll++;
  }
}
check('nothing overlaps', coll === 0, `${coll}`);

// the app's post-pass (widow / orphan / column balance) must never move a
// line onto another (the user's PDF export failed: "חפיפה פיזית" page 195)
{
  const { wholeBookBalancingPass } = await import('../../src/engine/book-balancing');
  const { SpatialExclusionEngine } = await import('../../src/engine/spatial-exclusion');
  let bad = 0;
  for (const size of [12.4, 12.8, 13.1, 13.6]) {
    const s2 = DesignSettingsEngine.updateRoleCharacterStyle(settings, 'main_source', { fontSizePt: size }, 'ai');
    console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('Diagnostic:')) return; log(...a); };
    const d2 = PaginationEngine.paginateDocument({ title: 'קדושת לוי', layoutType: 'two_column', units, geometry: s2.pageLayout.geometry, designSettings: s2 });
    console.log = log;
    for (const p of wholeBookBalancingPass(d2.pages).pages) {
      const cw = p.geometry.pageWidth - p.geometry.marginInside - p.geometry.marginOutside;
      bad += SpatialExclusionEngine.auditPageCollisions(p.sourceLines, p.rashiLines, p.tosafotLines, p.footnoteLines, p.column2Lines ?? [], cw).length;
    }
  }
  check('after the balancing post-pass nothing overlaps (PDF export is never blocked)', bad === 0, `${bad}`);
}
// a project saved with the old generic settings is upgraded on open
{
  const { upgradeLegacyTwoColumnSefer } = await import('../../src/engine/auto-layout');
  const old = DesignSettingsEngine.createDefaultSettings({ layoutType: 'two_column' });
  const up = upgradeLegacyTwoColumnSefer(units, 'two_column', old);
  check('an old two-column Chassidic project is upgraded to the trained design on open', !!up && up.pageElements.splitTitleHeader === true && up.roleStyles.main_source.character.fontFamily === 'Noto Rashi Hebrew');
  check('… and an upgraded one is left alone', up ? upgradeLegacyTwoColumnSefer(units, 'two_column', up) === null : false);
}

console.log(fails === 0 ? `\nALL PASS (${body.length} pages)` : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
