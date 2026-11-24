/**
 * Layout training T8 — brace-tagged prose sefer (the user's Mesilat
 * Yesharim sample) through the REAL Word import and auto-layout.
 *
 *   npx tsx scripts/training/prose-harness.ts [--no-render] [--min-score N]
 *
 * Source: training/prose/mesillat-yesharim/tagged.docx (make_tagged_docx.py).
 * Target (the user's reference image): book title large on the opening,
 * "פרק א" and the perek subtitle centred under it, body in two justified
 * columns, the first word of each paragraph bold, running head with the
 * book name and perek, page number on the outer corner.
 *
 * Rules:
 *  P1  every tag recognised; no "{", "}" or tag digits printed
 *  P2  metadata: book title from {שם הספר: …}
 *  P3  roles: {9} title, {2} perek, {3} subtitle; untagged → body
 *  P4  prose sefer: no Talmud / Chumash features
 *  P5  body in two columns
 *  P6  each perek heading + subtitle centred, above the perek's text
 *  P7  first word of each body paragraph bold
 *  P8  running head carries the book name and the perek
 *  P9  no text lost
 *  P10 page fill ≥ 80% except chapter ends and the last page
 *  P11 every drawn word inside its column box (indents included); no overlaps
 *  P12 no line starts with punctuation
 *  P13 nikkud never touches the next line (measured ink)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { DOMParser } from '@xmldom/xmldom';

const FONT_DIR = path.resolve('public/fonts');
for (const [f, fam] of [
  ['FrankRuhlLibre-Regular.ttf', 'Frank Ruhl Libre'],
  ['FrankRuhlLibre-Bold.ttf', 'Frank Ruhl Libre'],
  ['NotoRashiHebrew-Regular.ttf', 'Noto Rashi Hebrew'],
  ['NotoSerifHebrew-Regular.ttf', 'Noto Serif Hebrew'],
  ['NotoSerifHebrew-Bold.ttf', 'Noto Serif Hebrew'],
  ['DavidLibre-Regular.ttf', 'David Libre'],
  ['DavidLibre-Bold.ttf', 'David Libre'],
] as const) GlobalFonts.registerFromPath(path.join(FONT_DIR, f), fam);
(globalThis as any).document = {
  createElement: () => {
    const c = createCanvas(1, 1) as any;
    c.setAttribute = () => {};
    c.style = {};
    return c;
  },
};
(globalThis as any).DOMParser = DOMParser;
(globalThis as any).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import type { PageTypesetResult, TypesetLine } from '../../src/types/typesetter';
import { DocxImporter } from '../../src/engine/docx-importer';
import { DesignSettingsEngine } from '../../src/engine/design-settings-engine';
import { applyRecipeToSettingsById, classifyDocument, decideAutoLayout } from '../../src/engine/auto-layout';
import { PaginationEngine } from '../../src/engine/pagination-engine';
import { PdfExporter } from '../../src/engine/pdf-exporter';
import { TypesetterEngine } from '../../src/engine/typesetter-core';
if (process.env.KETER_BREAKER === 'greedy') TypesetterEngine.defaultLineBreaking = 'greedy';
import { justificationGaps } from '../../src/engine/justification-metrics';
import { clearanceIssues } from '../../src/engine/ink-clearance';

const args = process.argv.slice(2);
const render = !args.includes('--no-render');
const minScore = Number(args[args.indexOf('--min-score') + 1]) || 0;
const dir = path.resolve('training/prose/mesillat-yesharim');
const corpus = JSON.parse(fs.readFileSync(path.join(dir, 'corpus.json'), 'utf8'));

async function main() {
  const buf = fs.readFileSync(path.join(dir, 'tagged.docx'));
  const res = await DocxImporter.importDocx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 'tagged.docx');
  const units = res.units;
  const classification = classifyDocument(units, res.links, { fileName: 'tagged.docx' });
  const decision = decideAutoLayout(classification);
  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: decision.layoutType });
  const settings = applyRecipeToSettingsById(decision.recipeId, base);
  const layoutType = settings.layout.layoutType as any;
  const origLog = console.log;
  console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('Diagnostic:')) return; origLog(...a); };
  const doc = PaginationEngine.paginateDocument({
    title: res.metadata.title,
    layoutType,
    units,
    links: res.links,
    geometry: settings.pageLayout.geometry,
    designSettings: settings,
  });
  console.log = origLog;
  const pages = doc.pages.filter(p => !p.isTitlePage && !p.isImageOnlyPage);

  type Check = { id: string; pass: boolean; detail: string };
  const checks: Check[] = [];
  const check = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail });
  const lines = (p: PageTypesetResult): TypesetLine[] => [
    ...p.sourceLines, ...p.rashiLines, ...p.tosafotLines, ...p.footnoteLines, ...(p.column2Lines ?? []), ...(p.tertiaryLines ?? []), ...(p.marginLines ?? []),
  ];
  const allText = doc.pages.flatMap(p => lines(p).flatMap(l => l.words.filter(w => !w.isSpace).map(w => w.text)));

  const leftovers = allText.filter(t => /[{}]/.test(t) || /^\d$/.test(t));
  check('P1', leftovers.length === 0 && !units.some(u => /^\s*\{/.test(u.rawText)), `printed tag debris: ${leftovers.slice(0, 5).join(' ') || 'none'}`);
  check('P2', res.metadata.title === corpus.bookHe, `title "${res.metadata.title}"`);

  const roleOf = (t: string) => units.find(u => u.rawText.replace(/[֑-ׇ]/g, '').trim() === t)?.role;
  const sub1 = corpus.chapters[0].subtitle.replace(/[֑-ׇ]/g, '');
  const r9 = roleOf(corpus.bookHe), r2 = roleOf('פרק א'), r3 = roleOf(sub1);
  const bodyRoles = new Set(units.filter(u => !/^Tag /.test(u.styleName ?? '') && u.role !== 'footnote').map(u => u.role));
  check('P3', r9 === 'main_title' && r2 === 'chapter' && r3 === 'subtitle' && [...bodyRoles].every(r => r === 'regular_paragraph' || r === 'main_source'),
    `{9}=${r9} {2}=${r2} {3}=${r3} body=${[...bodyRoles].join('/')}; recipe ${decision.recipeId} → ${layoutType}`);

  const talmud = pages.some(p => /[.:]$/.test(p.folioDisplay ?? '') || p.openingWordBox || (p.vilnaHeader?.perekNumber !== undefined) || p.chumashHeadings);
  check('P4', !talmud && settings.pageLayout.seferType !== 'talmud' && settings.pageLayout.seferType !== 'chumash', `seferType ${settings.pageLayout.seferType}; first folio ${pages[0]?.folioDisplay}`);

  const cw = (p: PageTypesetResult) => p.geometry.pageWidth - p.geometry.marginInside - p.geometry.marginOutside;
  const twoCol = pages.filter(p => {
    const body = lines(p).filter(l => l.role === 'regular_paragraph' || l.role === 'main_source');
    if (body.length < 6) return true;
    const narrow = body.filter(l => (l.targetWidth ?? cw(p)) < cw(p) * 0.6);
    const right = narrow.filter(l => (l.xLeft ?? 0) > cw(p) / 2 - 1);
    const left = narrow.filter(l => (l.xRight ?? cw(p)) < cw(p) / 2 + 1);
    return narrow.length >= body.length * 0.9 && right.length > 0 && left.length > 0;
  });
  check('P5', twoCol.length === pages.length, `${twoCol.length}/${pages.length} pages in two columns`);

  const headBad: string[] = [];
  for (const p of pages) {
    for (const l of lines(p).filter(l => l.role === 'chapter' || l.role === 'subtitle')) {
      const xl = l.xLeft ?? 0, xr = l.xRight ?? cw(p);
      const centred = l.alignment === 'center' || l.paragraphAlignment === 'center';
      if (!centred) headBad.push(`${p.bodyPageIndex}:${l.role} not centred`);
      if (xr - xl < cw(p) * 0.6) headBad.push(`${p.bodyPageIndex}:${l.role} inside a column`);
    }
  }
  check('P6', headBad.length === 0, headBad.slice(0, 4).join(', ') || 'centred across the text block');

  // first line of each paragraph = the first line (in reading order) carrying its unit id
  const seenUnits = new Set<string>();
  const firstLines = pages.flatMap(p => lines(p).filter(l => l.role === 'regular_paragraph' || l.role === 'main_source')).filter(l => {
    if (seenUnits.has(l.unitId)) return false;
    seenUnits.add(l.unitId);
    return true;
  });
  if (process.env.PH_DEBUG) for (const l of firstLines.slice(0, 2)) console.log(JSON.stringify(l.words.slice(0, 3).map(w => ({ t: w.text, b: w.isBold, fw: w.fontWeight, d: w.isDibbur }))), l.fontWeight);
  const boldFirst = firstLines.filter(l => { const w = l.words.find(w => !w.isSpace); return w && (w.isBold || (w.fontWeight ?? 400) >= 600); });
  check('P7', firstLines.length > 0 && boldFirst.length >= firstLines.length * 0.95, `${boldFirst.length}/${firstLines.length} paragraphs open with a bold word`);

  const headOk = pages.filter(p => {
    const t = [p.headerTitle, ...(p.structuredHeaders ? Object.values(p.structuredHeaders).map(String) : []), ...(p.vilnaHeader?.items.flatMap(i => i.words.map(w => w.text)) ?? [])].join(' ');
    return t.includes('מסילת') && /פרק/.test(t);
  });
  check('P8', headOk.length === pages.length, `${headOk.length}/${pages.length} heads with book + perek; e.g. ${JSON.stringify(pages[1]?.vilnaHeader?.items.map(i => i.words.map(w => w.text).reverse().join(' ')) ?? pages[1]?.structuredHeaders)}`);

  const srcWords = units.filter(u => u.role !== 'main_title').reduce((s, u) => s + u.rawText.split(/\s+/).filter(Boolean).length, 0);
  const placed = doc.pages.filter(p => !p.isTitlePage).reduce((s, p) => s + lines(p).filter(l => l.role !== 'main_title').reduce((a, l) => a + l.words.filter(w => !w.isSpace).length, 0), 0);
  check('P9', placed >= srcWords * 0.99, `${placed}/${srcWords} words placed`);

  const ch = (p: PageTypesetResult) => p.geometry.pageHeight - p.geometry.marginTop - p.geometry.marginBottom;
  const fills = pages.map(p => Math.max(0, ...lines(p).map(l => l.yBottom ?? l.yBaseline)) / ch(p));
  const nextIsChapter = (i: number) => i + 1 < pages.length && lines(pages[i + 1]).some(l => l.role === 'chapter');
  const low = fills.map((f, i) => [i, f] as const).filter(([i, f]) => i < pages.length - 1 && !nextIsChapter(i) && f < 0.8);
  check('P10', low.length === 0, `low: ${low.map(([i, f]) => `${i}:${(f * 100).toFixed(0)}%`).join(' ') || 'none'}`);

  // P11: every DRAWN word stays inside its line's box (the print plan —
  // indents, justification and all), and columns never touch.
  const spill: string[] = [];
  for (const p of pages) {
    const plan = PdfExporter.buildPageRenderPlan(p);
    for (const lc of plan.lines) for (const w of lc.words ?? []) {
      if (w.xLeft < lc.xLeft - 0.75 || w.xRight > lc.xRight + 0.75) { spill.push(`${p.bodyPageIndex}:${w.text}`); break; }
    }
  }
  // …and no two drawn words overlap (columns drawn on top of each other).
  for (const p of pages) {
    const ws = PdfExporter.buildPageRenderPlan(p).lines.flatMap(lc => lc.words ?? []);
    outer: for (let i = 0; i < ws.length; i++)
      for (let j = i + 1; j < ws.length; j++) {
        const a = ws[i], b = ws[j];
        if (Math.abs(a.yBaseline - b.yBaseline) > 3) continue;
        if (Math.min(a.xRight, b.xRight) - Math.max(a.xLeft, b.xLeft) > 1) { spill.push(`${p.bodyPageIndex}:overlap ${a.text}/${b.text}`); break outer; }
      }
  }
  const punctStart = pages.flatMap(p => lines(p).filter(l => /^[:;,.!?׃)\]]/.test(l.words.find(w => !w.isSpace)?.text ?? '')).map(l => `${p.bodyPageIndex}:${l.words.find(w => !w.isSpace)?.text}`));
  check('P12', punctStart.length === 0, punctStart.slice(0, 4).join(' ') || 'no line starts with punctuation');
  const inkBad = pages.filter(p => clearanceIssues(p.sourceLines, 0.3).length > 0).map(p => p.bodyPageIndex);
  check('P13', inkBad.length === 0, inkBad.length ? `ink touching on pages ${inkBad.join(',')}` : 'marks clear on every line');
  if (process.env.PH_GAPS) {
    const rows: Array<[number, string]> = [];
    for (const p of pages) for (const lc of PdfExporter.buildPageRenderPlan(p).lines) {
      if (!lc.isJustified || lc.isLastLine || lc.role !== 'main_source') continue;
      const ws = [...lc.words].sort((a, b) => b.xRight - a.xRight);
      let worst = 0; for (let k = 1; k < ws.length; k++) worst = Math.max(worst, (ws[k - 1].xLeft - ws[k].xRight) / lc.fontSizePt);
      rows.push([worst, `${ws.length}w tw=${lc.targetWidth} ${ws.map(w => w.text).join(' ')}`]);
    }
    rows.sort((a, b) => b[0] - a[0]).slice(0, 8).forEach(r => console.log(r[0].toFixed(2), r[1]));
  }
  const jg = justificationGaps(pages, new Set(['main_source', 'regular_paragraph']));
  check('P14', jg.p95 <= 0.9, `widest gap per line: median ${jg.median.toFixed(2)} em, p95 ${jg.p95.toFixed(2)} em, max ${jg.max.toFixed(2)} em over ${jg.lines} lines`);
  const dup = pages.filter(p => { const seen = new Set<number>(); return [...p.sourceLines, ...p.footnoteLines].some(l => (seen.has(l.lineIndex) ? true : (seen.add(l.lineIndex), false))); }).map(p => p.bodyPageIndex);
  check('P15', dup.length === 0, dup.length ? `duplicate line keys on pages ${dup.join(',')}` : 'unique line keys on every page');
  check('P11', spill.length === 0, spill.slice(0, 5).join(' ') || 'every word inside its column');

  const score = Math.round((checks.filter(c => c.pass).length / checks.length) * 100);
  const outDir = path.resolve('training/out/prose/mesillat-yesharim');
  fs.mkdirSync(outDir, { recursive: true });
  if (render) doc.pages.slice(0, 4).forEach((p, i) => fs.writeFileSync(path.join(outDir, `page-${i + 1}.png`), (PdfExporter.renderPageToCanvas(p, 2) as any).toBuffer('image/png')));
  const md = [`# Prose (brace tags) — מסילת ישרים 1–2: ${score}% (${pages.length} pages, ${decision.recipeId} → ${layoutType})`, '', '| Rule | | Detail |', '|---|---|---|',
    ...checks.map(c => `| ${c.id} | ${c.pass ? '✅' : '❌'} | ${c.detail} |`)].join('\n');
  fs.writeFileSync(path.join(outDir, 'scorecard.md'), md);
  console.log(md);
  if (minScore && score < minScore) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
