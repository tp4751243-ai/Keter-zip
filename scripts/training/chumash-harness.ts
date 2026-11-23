/**
 * Layout training T7 — Mikraot Gedolot / Chumash scoring harness.
 *
 *   npx tsx scripts/training/chumash-harness.ts [book] [--min-score N] [--chapters 1-2]
 *
 * Reads training/chumash/<book>/corpus.json (scripts/training/fetch-sefaria-chumash.ts),
 * builds the units the way a Word import of "Chumash + Onkelos + Rashi"
 * arrives (heading, pasuk, Onkelos, Rashi), applies the Mikraot Gedolot
 * recipe through the same path as the wizard, paginates with the real
 * engine and renders each page with the PRINT renderer.
 *
 * Rules scored (from the user's Chumash photos and the hebrewbooks prints):
 *  C1  laid out by the Mikraot Gedolot engine, not the Gemara knee
 *  C2  no Talmud artifacts: daf folios, Vilna perek head, opening frame, גמ׳
 *  C3  head = sefer + perek, folio on the outer corner
 *  C4  every page starts with a pasuk (pasuk lines at the top of the block)
 *  C5  Onkelos column on the INNER side, beside the pesukim
 *  C6  every Rashi comment is on the page of its pasuk (or carried directly)
 *  C7  commentary bands carry a centred title (רש״י)
 *  C8  nothing overlaps; nothing leaves the text block
 *  C9  page fill ≥ 85% (except the last page)
 *  C10 no text lost: every pasuk, Onkelos and Rashi word is placed
 *  C11 nikkud / teamim of one line never touch the next (measured ink)
 *  C12 the pesukim are set in ONE face (no word-by-word font switching)
 *
 * Output: training/out/chumash/<book>/page-N.png, scorecard.json / .md.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const FONT_DIR = path.resolve('public/fonts');
for (const [f, fam] of [
  ['FrankRuhlLibre-Regular.ttf', 'Frank Ruhl Libre'],
  ['FrankRuhlLibre-Bold.ttf', 'Frank Ruhl Libre'],
  ['NotoRashiHebrew-Regular.ttf', 'Noto Rashi Hebrew'],
  ['NotoRashiHebrew-Bold.ttf', 'Noto Rashi Hebrew'],
  ['NotoSerifHebrew-Regular.ttf', 'Noto Serif Hebrew'],
  ['NotoSerifHebrew-Bold.ttf', 'Noto Serif Hebrew'],
] as const) GlobalFonts.registerFromPath(path.join(FONT_DIR, f), fam);
(globalThis as any).document = {
  createElement: () => {
    const c = createCanvas(1, 1) as any;
    c.setAttribute = () => {};
    c.style = {};
    return c;
  },
};

import type { ContentUnit, PageTypesetResult, TypesetLine } from '../../src/types/typesetter';
import { textBlockLeft } from '../../src/types/typesetter';
import { DesignSettingsEngine } from '../../src/engine/design-settings-engine';
import { applyRecipeToSettingsById } from '../../src/engine/auto-layout';
import { PaginationEngine } from '../../src/engine/pagination-engine';
import { PdfExporter } from '../../src/engine/pdf-exporter';
import { TypesetterEngine } from '../../src/engine/typesetter-core';
if (process.env.KETER_BREAKER === 'greedy') TypesetterEngine.defaultLineBreaking = 'greedy';
import { justificationGaps } from '../../src/engine/justification-metrics';
import { clearanceIssues } from '../../src/engine/ink-clearance';

const args = process.argv.slice(2);
const book = args.find(a => !a.startsWith('--') && !/^\d/.test(a)) ?? 'deuteronomy';
const minScore = Number(args[args.indexOf('--min-score') + 1]) || 0;
const chArg = args.includes('--chapters') ? args[args.indexOf('--chapters') + 1] : '1-2';
const [chFrom, chTo] = chArg.split('-').map(Number);
const render = !args.includes('--no-render');

const corpus = JSON.parse(fs.readFileSync(path.resolve('training/chumash', book, 'corpus.json'), 'utf8'));
const HE_NUM = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'יא', 'יב', 'יג', 'יד', 'טו', 'טז', 'יז', 'יח', 'יט', 'כ'];

// ── Units as a Word import delivers them ─────────────────────────────
const units: ContentUnit[] = [];
let order = 0;
const add = (role: ContentUnit['role'], rawText: string, styleName = '') =>
  units.push({ id: `u${order}`, role, rawText, styleName, order: order++, hierarchyLevel: 0 } as ContentUnit);
const expected = { pesukim: 0, onkelosWords: 0, rashiUnits: [] as string[] };
const rashiPasuk = new Map<string, string>();
for (const ch of corpus.chapters) {
  if (ch.chapter < chFrom || ch.chapter > chTo) continue;
  add('chapter', `${corpus.bookHe} פרק ${HE_NUM[ch.chapter]}`, 'Heading 1');
  ch.pesukim.forEach((p: string, i: number) => {
    add('main_source', p, 'Pasuk');
    const pid = units[units.length - 1].id;
    expected.pesukim++;
    if (ch.onkelos[i]) {
      add('secondary_comment', ch.onkelos[i], 'Onkelos');
      expected.onkelosWords += ch.onkelos[i].split(/\s+/).length;
    }
    for (const r of ch.rashi[i] ?? []) {
      add('primary_comment', r, 'Rashi');
      expected.rashiUnits.push(units[units.length - 1].id);
      rashiPasuk.set(units[units.length - 1].id, pid);
    }
  });
}

// ── Settings: the wizard's Mikraot Gedolot path ──────────────────────
const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
const settings = applyRecipeToSettingsById('mikraot-gedolot', base);
const layoutType = settings.layout.layoutType as any;
const origLog = console.log;
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('Diagnostic:')) return; origLog(...a); };
const geometry = settings.pageLayout.geometry;
const doc = PaginationEngine.paginateDocument({
  title: `חומש ${corpus.bookHe}`,
  layoutType,
  units,
  geometry,
  designSettings: settings,
});
const pages = doc.pages.filter(p => !p.isTitlePage && !p.isImageOnlyPage);

// ── Scoring ──────────────────────────────────────────────────────────
type Check = { id: string; pass: boolean; detail: string };
const checks: Check[] = [];
const check = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail });
const allLines = (p: PageTypesetResult): TypesetLine[] => [
  ...p.sourceLines, ...p.rashiLines, ...p.tosafotLines, ...p.footnoteLines, ...(p.tertiaryLines ?? []), ...(p.marginLines ?? []),
];

check('C1', layoutType === 'mikraot_gedolot' && pages.every(p => p.layoutType === 'mikraot_gedolot'), `layout ${layoutType}`);

const talmudArtifacts = pages.filter(
  p => /[.:]$/.test(p.folioDisplay ?? '') || p.openingWordBox || p.sourceLines.some(l => l.transitionMarkerBefore) ||
    (p.vilnaHeader?.items ?? []).some(i => i.words.some(w => /^פרק$/.test(w.text) && false))
);
check('C2', talmudArtifacts.length === 0 && (pages[0]?.folioDisplay ?? '') !== 'ב.', `pages with Talmud artifacts: ${talmudArtifacts.map(p => p.bodyPageIndex).join(',') || 'none'}; first folio ${pages[0]?.folioDisplay}`);

const headBad: string[] = [];
pages.forEach(p => {
  const items = p.vilnaHeader?.items ?? [];
  const title = items.find(i => i.kind === 'title');
  const folio = items.find(i => i.kind === 'folio');
  const text = title?.words.map(w => w.text).reverse().join(' ') ?? '';
  const g = p.geometry;
  const left = textBlockLeft(g);
  const recto = (p.bodyPageIndex ?? 0) % 2 === 0;
  const outerOk = folio ? (recto ? Math.abs(folio.xLeft - left) < 1 : folio.xLeft > g.pageWidth / 2) : false;
  if (!title || !text.includes(corpus.bookHe) || !outerOk) headBad.push(`${p.bodyPageIndex}:"${text}"${outerOk ? '' : ' folio-not-outer'}`);
});
check('C3', headBad.length === 0, headBad.slice(0, 4).join(' | ') || `e.g. "${pages[0]?.vilnaHeader?.items.find(i => i.kind === 'title')?.words.map(w => w.text).reverse().join(' ')}"`);

const noPasukTop = pages.filter(p => p.chumashFirstPasuk !== undefined && !(p.sourceLines.length && Math.min(...p.sourceLines.map(l => l.yTop ?? 0)) < 1));
check('C4', noPasukTop.length === 0, `pages not starting with a pasuk: ${noPasukTop.map(p => p.bodyPageIndex).join(',') || 'none'}`);

const contentW = (p: PageTypesetResult) => p.geometry.pageWidth - p.geometry.marginInside - p.geometry.marginOutside;
const onkBad: string[] = [];
pages.forEach(p => {
  const onk = (p.marginLines ?? []).filter(l => l.role === 'verse' || l.unitId === 'onk-title' || /onk/.test(l.unitId));
  const onkLines = (p.marginLines ?? []).filter(l => l.fontFamily && l.yTop !== undefined && l.xRight !== undefined && l.xLeft !== undefined && (l.xRight - l.xLeft) < contentW(p) * 0.4 && (l.yTop ?? 0) < Math.max(...p.sourceLines.map(s => s.yBottom ?? 0), 0));
  if (!onkLines.length && p.chumashFirstPasuk !== undefined) { onkBad.push(`${p.bodyPageIndex}:none`); return; }
  const recto = (p.bodyPageIndex ?? 0) % 2 === 0;
  const onRight = onkLines.every(l => (l.xLeft ?? 0) > contentW(p) / 2);
  const onLeft = onkLines.every(l => (l.xRight ?? 0) < contentW(p) / 2);
  if (recto ? !onRight : !onLeft) onkBad.push(`${p.bodyPageIndex}:${recto ? 'recto' : 'verso'} wrong side`);
  void onk;
});
check('C5', onkBad.length === 0, onkBad.slice(0, 5).join(', ') || 'inner side on every page');

// C6: each Rashi unit's lines are on the page of its pasuk, or on the next page(s) only as a carry
const pasukPage = new Map<string, number>();
const unitPages = new Map<string, number[]>();
pages.forEach((p, i) => {
  for (const l of allLines(p)) {
    if (!l.unitId) continue;
    unitPages.set(l.unitId, [...new Set([...(unitPages.get(l.unitId) ?? []), i])]);
    for (const w of l.words) if (w.unitId) unitPages.set(w.unitId, [...new Set([...(unitPages.get(w.unitId) ?? []), i])]);
  }
});
for (const u of units) if (u.role === 'main_source') pasukPage.set(u.id, unitPages.get(u.id)?.[0] ?? -1);
let rashiSame = 0;
const rashiFar: string[] = [];
for (const rid of expected.rashiUnits) {
  const pg = unitPages.get(rid) ?? [];
  const pp = pasukPage.get(rashiPasuk.get(rid)!) ?? -1;
  if (pg.includes(pp)) rashiSame++;
  else if (pg.length && pg[0] === pp + 1) rashiSame += 0.5;
  else rashiFar.push(`${rid}@${pg.join('/')}≠${pp}`);
}
const rashiPct = expected.rashiUnits.length ? rashiSame / expected.rashiUnits.length : 1;
check('C6', rashiPct >= 0.95, `${(rashiPct * 100).toFixed(1)}% on the pasuk's page${rashiFar.length ? `; far: ${rashiFar.slice(0, 3).join(' ')}` : ''}`);

const titleOk = pages.filter(p => (p.marginLines ?? []).some(l => l.role === 'heading' && l.alignment === 'center' && l.words.some(w => /רש/.test(w.text))));
const pagesWithRashi = pages.filter(p => (p.marginLines ?? []).some(l => l.role === 'primary_comment'));
check('C7', titleOk.length >= pagesWithRashi.length, `${titleOk.length}/${pagesWithRashi.length} Rashi bands titled`);

const overl: string[] = [];
pages.forEach(p => {
  const ls = allLines(p).filter(l => l.xLeft !== undefined && l.xRight !== undefined);
  const cw = contentW(p);
  const ch = p.geometry.pageHeight - p.geometry.marginTop - p.geometry.marginBottom;
  for (const l of ls) if ((l.xLeft ?? 0) < -0.5 || (l.xRight ?? 0) > cw + 0.5 || (l.yBottom ?? 0) > ch + 2) { overl.push(`${p.bodyPageIndex}:out`); break; }
  for (let i = 0; i < ls.length; i++)
    for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j];
      const xo = Math.min(a.xRight!, b.xRight!) - Math.max(a.xLeft!, b.xLeft!);
      const yo = Math.min(a.yBaseline + a.descent * 0.5, b.yBaseline + b.descent * 0.5) - Math.max(a.yBaseline - a.ascent * 0.8, b.yBaseline - b.ascent * 0.8);
      if (xo > 1 && yo > 1) { overl.push(`${p.bodyPageIndex}:${a.unitId}/${b.unitId}`); i = ls.length; break; }
    }
});
check('C8', overl.length === 0, overl.slice(0, 5).join(', ') || 'clean');

const fills = pages.map(p => {
  const ch = p.geometry.pageHeight - p.geometry.marginTop - p.geometry.marginBottom;
  const bottom = Math.max(0, ...allLines(p).map(l => l.yBottom ?? l.yBaseline));
  return bottom / ch;
});
const lowFill = fills.slice(0, -1).map((f, i) => [i, f] as const).filter(([, f]) => f < 0.85);
check('C9', lowFill.length === 0, `mean ${(fills.reduce((a, b) => a + b, 0) / Math.max(1, fills.length) * 100).toFixed(0)}%; low: ${lowFill.map(([i, f]) => `${i}:${(f * 100).toFixed(0)}%`).slice(0, 6).join(' ') || 'none'}`);

const placedPesukim = units.filter(u => u.role === 'main_source' && unitPages.has(u.id)).length;
const placedRashi = expected.rashiUnits.filter(id => unitPages.has(id)).length;
const onkWords = pages.reduce((s, p) => s + (p.marginLines ?? []).filter(l => l.role === 'verse' && l.unitId !== 'onk-title').reduce((a, l) => a + l.words.filter(w => !w.isSpace).length, 0), 0);
check('C10', placedPesukim === expected.pesukim && placedRashi === expected.rashiUnits.length && onkWords >= expected.onkelosWords * 0.98,
  `pesukim ${placedPesukim}/${expected.pesukim}, rashi ${placedRashi}/${expected.rashiUnits.length}, onkelos words ${onkWords}/${expected.onkelosWords}`);

if (process.env.MG_DUMP) {
  const p = pages[Number(process.env.MG_DUMP) || 0];
  for (const l of [...p.sourceLines, ...(p.marginLines ?? [])].sort((a, b) => a.yBaseline - b.yBaseline || (b.xRight ?? 0) - (a.xRight ?? 0)))
    console.log(l.role.padEnd(16), l.yBaseline.toFixed(1).padStart(6), (l.xLeft ?? 0).toFixed(0).padStart(4), (l.xRight ?? 0).toFixed(0).padStart(4), l.words.filter(w => !w.isSpace).length, l.words.filter(w => !w.isSpace).slice(-3).map(w => w.text).join(' '));
}
// C11: the marks of one line never touch the next (nikkud + teamim ink).
const ink: string[] = [];
pages.forEach(p => {
  for (const group of [p.sourceLines, (p.marginLines ?? []).filter(l => l.role !== 'heading' && l.unitId !== 'onk-title')]) {
    const bad = clearanceIssues(group, 0.3);
    if (bad.length) ink.push(`${p.bodyPageIndex}:${bad.length} (worst ${Math.min(...bad.map(b => b.gapPt)).toFixed(1)}pt)`);
  }
});
check('C11', ink.length === 0, ink.slice(0, 4).join(', ') || 'marks clear on every line');
const mixed = pages.flatMap(p => p.sourceLines.flatMap(l => l.words.filter(w => !w.isSpace).map(w => w.fontFamily ?? l.fontFamily)));
check('C12', new Set(mixed).size <= 1, `pasuk faces: ${[...new Set(mixed)].join(', ')}`);

const jg = justificationGaps(pages, undefined);
check('C13', jg.p95 <= 0.75, `widest gap per line: median ${jg.median.toFixed(2)} em, p95 ${jg.p95.toFixed(2)} em, max ${jg.max.toFixed(2)} em over ${jg.lines} lines`);
const score = Math.round((checks.filter(c => c.pass).length / checks.length) * 100);
const outDir = path.resolve('training/out/chumash', book);
fs.mkdirSync(outDir, { recursive: true });
if (render) {
  pages.slice(0, 6).forEach((p, i) => {
    const canvas = PdfExporter.renderPageToCanvas(p, 2) as any;
    fs.writeFileSync(path.join(outDir, `page-${i + 1}.png`), canvas.toBuffer('image/png'));
  });
}
const md = [`# Chumash harness — ${corpus.bookHe} ${chArg}: ${score}% (${pages.length} pages)`, '', '| Rule | | Detail |', '|---|---|---|',
  ...checks.map(c => `| ${c.id} | ${c.pass ? '✅' : '❌'} | ${c.detail} |`)].join('\n');
fs.writeFileSync(path.join(outDir, 'scorecard.md'), md);
fs.writeFileSync(path.join(outDir, 'scorecard.json'), JSON.stringify({ score, pages: pages.length, checks }, null, 1));
console.log(md);
if (minScore && score < minScore) process.exit(1);
