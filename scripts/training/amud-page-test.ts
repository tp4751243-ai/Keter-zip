/**
 * Talmud amud pages — the user's rule: in a Gemara Word file, "דף ב." /
 * "דף ב:" / "דף ג." … mean a NEW PAGE. Three files (Gemara, Rashi,
 * Tosafot), each with its own title block and amud headings, built from
 * the public-domain Sefaria Berakhot 2a–3b corpus.
 *
 *   npx tsx scripts/training/amud-page-test.ts
 *
 * Checks: every amud starts its own page; the page's folio is the amud's
 * own; the heading and the files' title lines are not printed; each
 * page's Rashi / Tosafot belong to that amud; the Gemara never narrows
 * down the page; nothing collides.
 */
import * as fs from 'node:fs';
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

import type { ContentRole, ContentUnit } from '../../src/types/typesetter';
import { PaginationEngine, splitTalmudIntoAmudim } from '../../src/engine/pagination-engine';
import { linkByDafHeadings } from '../../src/engine/chumash-linker';
import { applyRecipeToSettingsById } from '../../src/engine/auto-layout';
import { DesignSettingsEngine } from '../../src/engine/design-settings-engine';
import { hebrewNumeralBare } from '../../src/engine/hebrew-numerals';

type Amud = { daf: number; amud: 'a' | 'b'; gemara: string[]; rashi: string[]; tosafot: string[] };
const corpus = JSON.parse(fs.readFileSync('training/vilna/berakhot/corpus.json', 'utf8')) as { amudim: Amud[] };
const strip = (t: string) => t.replace(/<[^>]+>/g, '').trim();

const units: ContentUnit[] = [];
let order = 0;
const add = (file: number, role: ContentRole, text: string) =>
  units.push({ id: `u${order}`, role, rawText: text, styleName: role, order: order++, hierarchyLevel: 0, importFileIndex: file } as ContentUnit);
const files: Array<[number, string, ContentRole, keyof Amud]> = [
  [0, 'ברכות', 'main_source', 'gemara'],
  [1, 'רש"י על ברכות', 'primary_comment', 'rashi'],
  [2, 'תוספות על ברכות', 'secondary_comment', 'tosafot'],
];
for (const [file, title, role, key] of files) {
  add(file, 'chapter', title);
  add(file, 'heading', title);
  for (const a of corpus.amudim) {
    add(file, 'heading', `דף ${hebrewNumeralBare(a.daf)}${a.amud === 'a' ? '.' : ':'}`);
    for (const t of (a[key] as unknown[]).flat(3) as string[]) if (typeof t === "string" && strip(t)) add(file, role, strip(t));
  }
}

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails++;
};

const groups = splitTalmudIntoAmudim(units)!;
const want = corpus.amudim.map(a => `${hebrewNumeralBare(a.daf)}${a.amud === 'a' ? '.' : ':'}`);
check(!!groups && groups.map(g => g.key).join(' ') === want.join(' '), `the book splits into its amudim (${groups?.map(g => g.key).join(' ')})`);
const printed = groups.flatMap(g => g.units.map(u => u.rawText));
check(!printed.some(t => /^דף\s/.test(t)), 'the דף headings are not printed');
check(!printed.some(t => /על ברכות|^ברכות$/.test(t)), "the files' title lines are not printed");

const links = linkByDafHeadings(units)?.links ?? [];
const settings = applyRecipeToSettingsById('vilna-shas', DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' }));
const log = console.log;
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('Diagnostic:')) return; log(...a); };
const doc = PaginationEngine.paginateDocument({ title: 'ברכות', layoutType: 'rav_text', units, links, geometry: settings.pageLayout.geometry, designSettings: settings });
console.log = log;
const body = doc.pages.filter(p => !p.isTitlePage);

const amudOfUnit = new Map<string, string>();
for (const g of groups) for (const u of g.units) amudOfUnit.set(u.id, g.key);
for (const key of want) {
  const pages = body.filter(p => p.amudKey === key);
  check(pages.length >= 1, `amud ${key} has its own page`);
  const pg = pages[0];
  if (!pg) continue;
  check(pg.folioDisplay === key, `amud ${key}: folio ${pg.folioDisplay}`);
  const foreign = [...pg.sourceLines, ...pg.rashiLines, ...pg.tosafotLines].filter(l => l.unitId && amudOfUnit.has(l.unitId) && amudOfUnit.get(l.unitId) !== key);
  check(foreign.length === 0, `amud ${key}: only its own Gemara, Rashi and Tosafot (${foreign.length} foreign lines)`);
  const src = pg.sourceLines.filter(l => l.role === 'main_source' && l.xLeft !== undefined).sort((a, b) => a.yBaseline - b.yBaseline);
  let narrows = 0;
  for (let i = 1; i < src.length; i++) if (src[i].xLeft! > src[i - 1].xLeft! + 1.5 || src[i].xRight! < src[i - 1].xRight! - 1.5) narrows++;
  check(narrows === 0, `amud ${key}: the Gemara never narrows going down (${narrows})`);
}
const firstIdx = body.map(p => p.amudKey);
check(want.every((k, i) => firstIdx.indexOf(k) >= 0 && (i === 0 || firstIdx.indexOf(k) > firstIdx.indexOf(want[i - 1]))), 'amudim in order, each starting a new page');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
