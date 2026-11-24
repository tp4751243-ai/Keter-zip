/**
 * Import performance — a whole Chumash book through the Home wizard's
 * real pipeline (the user's report: Bereishit + Onkelos + Rashi froze
 * the app on "Generate & Open").
 *
 *   npx tsx scripts/training/import-perf.ts DIR [--budget-ms N]
 *
 * DIR holds the three .docx files (make_chumash_docx.py). Stages are
 * timed exactly as DocxImportHub + App run them: parse, retag by slot,
 * old linker, new linker, merge, classify, uncertain-link review size,
 * settings, pagination. With --budget-ms the script fails when the total
 * exceeds it (a CI guard against freezes).
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
] as const) GlobalFonts.registerFromPath(path.join(FONT_DIR, f), fam);
(globalThis as any).document = { createElement: () => { const c = createCanvas(1, 1) as any; c.setAttribute = () => {}; c.style = {}; return c; } };
(globalThis as any).DOMParser = DOMParser;
(globalThis as any).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import type { ContentRole, ContentUnit, RavTextLink } from '../../src/types/typesetter';
import { DocxImporter, flagUncertainMatches } from '../../src/engine/docx-importer';
import { linkCommentariesToSource, anchorLinksToRavTextLinks, mergeLinkSets } from '../../src/engine/commentary-linker';
import { classifyForImport, applyRecipeToSettingsById } from '../../src/engine/auto-layout';
import { linkChumashCommentaries, looksLikeChumash } from '../../src/engine/chumash-linker';
import { DesignSettingsEngine } from '../../src/engine/design-settings-engine';
import { PaginationEngine } from '../../src/engine/pagination-engine';

const dir = process.argv[2];
const budget = process.argv.includes('--budget-ms') ? Number(process.argv[process.argv.indexOf('--budget-ms') + 1]) : 0;
const RETAG: ContentRole[] = ['main_source', 'verse', 'primary_comment', 'secondary_comment', 'tertiary_comment', 'regular_paragraph'];
const slotRole = (name: string): ContentRole =>
  /תרגום|אונקלוס/.test(name) ? 'verse' : /רש/.test(name) ? 'primary_comment' : /רמב/.test(name) ? 'secondary_comment' : /עזרא|ספורנו/.test(name) ? 'tertiary_comment' : 'main_source';

const times: Array<[string, number]> = [];
const timed = async <T>(label: string, f: () => T | Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const r = await f();
  times.push([label, performance.now() - t0]);
  console.log(`${label.padEnd(34)} ${(performance.now() - t0).toFixed(0).padStart(7)} ms`);
  return r;
};

async function main() {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.docx')).sort((a, b) => (slotRole(a) === 'main_source' ? -1 : slotRole(b) === 'main_source' ? 1 : a.localeCompare(b)));
  const all: ContentUnit[] = [];
  let order = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const res = await timed(`parse ${f}`, () => DocxImporter.importDocx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, f));
    const role = slotRole(f);
    for (const u of res.units) {
      u.order = ++order;
      u.importFileIndex = files.indexOf(f);
      if (role !== 'main_source' && RETAG.includes(u.role)) {
        u.role = role;
        if (!u.textRuns || !u.textRuns.some(r => r.isBold || r.isDibbur)) u.textRuns = DocxImporter.buildRunsFromRawText(u.rawText, u.role, u.dibburHamatchil);
      }
      all.push(u);
    }
  }
  const sources = all.filter(u => u.role === 'main_source' || u.role === 'chapter');
  const comms = all.filter(u => u.role === 'primary_comment' || u.role === 'secondary_comment' || u.role === 'tertiary_comment');
  console.log(`units ${all.length}: sources ${sources.length}, commentaries ${comms.length}`);
  // As DocxImportHub: a Chumash book is linked by chapter + pasuk words;
  // anything else by the Gemara linkers (old + new, merged).
  let links: RavTextLink[];
  if (!process.env.GEMARA_LINKERS && looksLikeChumash(all, files[0])) {
    const r = await timed('chumash linker', () => linkChumashCommentaries(all));
    links = r.links;
    console.log(`chumash linker: placed ${r.matched}/${r.total} (exact by פסוק marker: ${r.links.filter(l => l.confidenceScore === 1).length}), introductions ${r.introUnitIds.length}`);
  } else {
    links = await timed('old linker (autoLink…)', () => DocxImporter.autoLinkCommentariesToSource(sources, comms));
    const anchors = await timed('new linker (CommentaryLinker)', () => linkCommentariesToSource(sources, comms));
    links = await timed('merge links', () => mergeLinkSets(anchorLinksToRavTextLinks(anchors, all, sources[0]), links));
  }
  if (process.env.LINK_DUMP) fs.writeFileSync(process.env.LINK_DUMP, JSON.stringify(links.map(l => [l.commentaryUnitId, l.sourceUnitId, Math.round((l.confidenceScore ?? 0) * 1000)])));
  if (process.env.TRUTH) {
    // Ground truth: corpus order (pasuk i of chapter c ↔ its Rashi comments).
    const corpus = JSON.parse(fs.readFileSync(process.env.TRUTH, 'utf8'));
    const pasukIds = all.filter(u => u.role === 'main_source').map(u => u.id);
    const rashiIds = all.filter(u => u.role === 'primary_comment').map(u => u.id);
    const truth = new Map<string, string>();
    let p = 0, r = 0;
    for (const ch of corpus.chapters) ch.pesukim.forEach((_: string, i: number) => { for (const _c of ch.rashi[i] ?? []) truth.set(rashiIds[r++], pasukIds[p]); p++; });
    const byCom = new Map(links.map(l => [l.commentaryUnitId, l]));
    const unc = new Set(flagUncertainMatches(links).map(l => l.commentaryUnitId));
    let ok = 0, okUnc = 0, wrongConf = 0, nUnc = 0, near = 0;
    const idx = new Map(pasukIds.map((id, i) => [id, i]));
    for (const [cid, pid] of truth) {
      const l = byCom.get(cid); const good = l?.sourceUnitId === pid;
      if (good) ok++;
      if (l && !good && Math.abs((idx.get(l.sourceUnitId) ?? -99) - (idx.get(pid) ?? 0)) <= 2) near++;
      if (unc.has(cid)) { nUnc++; if (good) okUnc++; } else if (!good) wrongConf++;
    }
    if (process.env.MIN_ACCURACY && ok / truth.size < Number(process.env.MIN_ACCURACY)) {
      console.log(`accuracy ${(ok / truth.size).toFixed(3)} below ${process.env.MIN_ACCURACY}`);
      process.exitCode = 1;
    }
    console.log(`TRUTH: ${ok}/${truth.size} correct (${(100 * ok / truth.size).toFixed(1)}%), off by ≤2 pesukim ${near}; uncertain ${nUnc} of which correct ${okUnc}; confident-but-wrong ${wrongConf}`);
    const hist = new Map<number, number>();
    for (const l of links) { const b = Math.floor((l.confidenceScore ?? 0) * 10) / 10; hist.set(b, (hist.get(b) ?? 0) + 1); }
    console.log('confidence histogram', [...hist.entries()].sort().map(([b, n]) => `${b.toFixed(1)}:${n}`).join(' '));
  }
  if (process.env.LINK_ONLY) return;
  const auto = await timed('classify', () => classifyForImport(all, links, { fileName: files[0], hasFootnotes: false }));
  const uncertain = flagUncertainMatches(links);
  console.log(`links ${links.length}, uncertain (review queue) ${uncertain.length}; review UI would render ${uncertain.length} × ${sources.length} source options`);
  const settings = await timed('settings (chumash-rishonim)', () => applyRecipeToSettingsById('chumash-rishonim', DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' })));
  const log = console.log;
  console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('Diagnostic:')) return; log(...a); };
  const doc = await timed(`paginate (${settings.layout.layoutType})`, () => PaginationEngine.paginateDocument({
    title: files[0].replace(/\.docx$/, ''), layoutType: settings.layout.layoutType as any, units: all, links, geometry: settings.pageLayout.geometry, designSettings: settings,
  }));
  console.log = log;
  console.log(`pages ${doc.pages.length} (introduction pages ${doc.pages.filter(p => p.chumashIntro).length}); decision ${auto.decision?.recipeId}`);
  if (process.env.RENDER_DIR) {
    const { PdfExporter } = await import('../../src/engine/pdf-exporter');
    fs.mkdirSync(process.env.RENDER_DIR, { recursive: true });
    const body = doc.pages.filter(p => !p.isTitlePage);
    const firstPasuk = body.findIndex(p => !p.chumashIntro);
    for (const i of [0, 1, firstPasuk, firstPasuk + 1, firstPasuk + 40].filter(i => i >= 0 && i < body.length)) {
      fs.writeFileSync(path.join(process.env.RENDER_DIR, `p${i}.png`), (PdfExporter.renderPageToCanvas(body[i], 1.4) as any).toBuffer('image/png'));
    }
  }
  const total = times.reduce((s, [, t]) => s + t, 0);
  console.log(`TOTAL ${total.toFixed(0)} ms`);
  if (budget && total > budget) { console.log(`over budget ${budget} ms`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
