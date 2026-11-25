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
import { classifyForImport, applyRecipeToSettingsById, constrainDecisionToSeferType } from '../../src/engine/auto-layout';
import { linkByDafHeadings, linkChumashCommentaries, looksLikeChumash } from '../../src/engine/chumash-linker';
import { DesignSettingsEngine } from '../../src/engine/design-settings-engine';
import { PaginationEngine } from '../../src/engine/pagination-engine';

const dir = process.argv[2];
const budget = process.argv.includes('--budget-ms') ? Number(process.argv[process.argv.indexOf('--budget-ms') + 1]) : 0;
const RETAG: ContentRole[] = ['main_source', 'verse', 'primary_comment', 'secondary_comment', 'tertiary_comment', 'regular_paragraph'];
const slotRole = (name: string): ContentRole =>
  /תרגום|אונקלוס/.test(name) ? 'verse' : /רש/.test(name) ? 'primary_comment' : /רמב|תוספות/.test(name) ? 'secondary_comment' : /עזרא|ספורנו/.test(name) ? 'tertiary_comment' : 'main_source';

const times: Array<[string, number]> = [];
const timed = async <T>(label: string, f: () => T | Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const r = await f();
  times.push([label, performance.now() - t0]);
  console.log(`${label.padEnd(34)} ${(performance.now() - t0).toFixed(0).padStart(7)} ms`);
  return r;
};

async function main() {
  if (process.env.DBG) (globalThis as any).__DBG = 1;
  const SLOT_ORDER: ContentRole[] = ['main_source', 'verse', 'primary_comment', 'secondary_comment', 'tertiary_comment'];
  const files = process.env.SLOT_ORDER ? fs.readdirSync(dir).filter(f => f.endsWith('.docx')).sort((a, b) => SLOT_ORDER.indexOf(slotRole(a)) - SLOT_ORDER.indexOf(slotRole(b))) : fs.readdirSync(dir).filter(f => f.endsWith('.docx')).sort((a, b) => (slotRole(a) === 'main_source' ? -1 : slotRole(b) === 'main_source' ? 1 : a.localeCompare(b)));
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
  if (process.env.TRIM_DAF) {
    // keep, per file, everything before its (N+1)-th "דף" heading
    const n = Number(process.env.TRIM_DAF);
    const seen = new Map<number, number>();
    const kept = all.filter(u => {
      const f = u.importFileIndex ?? 0;
      if ((u.role === 'heading' || u.role === 'chapter') && /^\s*דף\s/.test(u.rawText)) seen.set(f, (seen.get(f) ?? 0) + 1);
      return (seen.get(f) ?? 0) <= n;
    });
    all.splice(0, all.length, ...kept);
  }
  if (process.env.HEAD_DUMP) for (const f of new Set(all.map(u => u.importFileIndex))) console.log("FILE", f, JSON.stringify(all.filter(u => u.importFileIndex === f).slice(0, 4).map(u => [u.role, u.rawText.slice(0, 30)])));
  const sources = all.filter(u => u.role === 'main_source' || u.role === 'chapter');
  const comms = all.filter(u => u.role === 'primary_comment' || u.role === 'secondary_comment' || u.role === 'tertiary_comment');
  console.log(`units ${all.length}: sources ${sources.length}, commentaries ${comms.length}`);
  // As DocxImportHub: a Chumash book is linked by chapter + pasuk words;
  // anything else by the Gemara linkers (old + new, merged).
  let links: RavTextLink[];
  const tL = performance.now();
  const byDaf = process.env.GEMARA_LINKERS ? null : linkByDafHeadings(all);
  if (byDaf) {
    links = byDaf.links;
    console.log(`amud linker ${(performance.now() - tL).toFixed(0)} ms: dibbur found for ${byDaf.matched}/${byDaf.total}, unplaced ${byDaf.total - byDaf.links.length}`);
  } else if (!process.env.GEMARA_LINKERS && looksLikeChumash(all, files[0])) {
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
  console.log('DECISION', auto.decision?.recipeId, auto.decision?.layoutType, JSON.stringify(auto.classification.markers));
  if (process.env.BOOK_TYPE) {
    const c = constrainDecisionToSeferType(auto.decision!, auto.classification, process.env.BOOK_TYPE as any);
    console.log('WITH BOOK TYPE', process.env.BOOK_TYPE, '->', c.recipeId, c.layoutType, '|', c.lineEn);
  }
  const settings = await timed('settings', () => applyRecipeToSettingsById(process.env.RECIPE ?? auto.decision?.recipeId ?? 'chumash-rishonim', DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' })));
  const log = console.log;
  console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('Diagnostic:')) return; log(...a); };
  const doc = await timed(`paginate (${settings.layout.layoutType})`, () => PaginationEngine.paginateDocument({
    title: files[0].replace(/\.docx$/, ''), layoutType: settings.layout.layoutType as any, units: all, links, geometry: settings.pageLayout.geometry, designSettings: settings,
  }));
  console.log = log;
  { const { trialLineCacheStats } = await import('../../src/engine/dynamic-knee'); console.log('trial line probes', JSON.stringify(trialLineCacheStats)); }
  console.log(`pages ${doc.pages.length} (introduction pages ${doc.pages.filter(p => p.chumashIntro).length}); decision ${auto.decision?.recipeId}`);
  if (process.env.REPEAT) {
    // T14 — an edit re-lays only its own amud (per-amud cache)
    const idx = all.findIndex((u, i) => u.role === 'main_source' && i > all.length / 3);
    const edited = all.map((u, i) => (i === idx ? { ...u, rawText: u.rawText.replace(/\S+/, m => m + 'א') } : u));
    const t0 = performance.now();
    const doc2 = PaginationEngine.paginateDocument({ title: files[0].replace(/\.docx$/, ''), layoutType: settings.layout.layoutType as any, units: edited, links, geometry: settings.pageLayout.geometry, designSettings: settings });
    const t1 = performance.now();
    PaginationEngine.paginateDocument({ title: files[0].replace(/\.docx$/, ''), layoutType: settings.layout.layoutType as any, units: edited, links, geometry: settings.pageLayout.geometry, designSettings: settings });
    console.log(`REPEAT one-word edit re-layout ${(t1 - t0).toFixed(0)} ms (${doc2.pages.length} pages); unchanged re-layout ${(performance.now() - t1).toFixed(0)} ms`);
  }
  if (process.env.RENDER_DIR) {
    const { PdfExporter } = await import('../../src/engine/pdf-exporter');
    fs.mkdirSync(process.env.RENDER_DIR, { recursive: true });
    const body = doc.pages.filter(p => !p.isTitlePage);
    const firstPasuk = body.findIndex(p => !p.chumashIntro);
    for (const i of (process.env.RENDER_PAGES ? process.env.RENDER_PAGES.split(",").map(Number) : [0, 1, firstPasuk, firstPasuk + 1, firstPasuk + 40]).filter(i => i >= 0 && i < body.length)) {
      fs.writeFileSync(path.join(process.env.RENDER_DIR, `p${i}.png`), (PdfExporter.renderPageToCanvas(body[i], 1.4) as any).toBuffer('image/png'));
    }
  }
  if (process.env.OVERLAP) {
    // Collision check: words of two different lines that share a vertical
    // band must not share horizontal space (the user's Gemara report).
    const { PdfExporter } = await import('../../src/engine/pdf-exporter');
    const mc = createCanvas(10, 10).getContext('2d');
    let pagesHit = 0, total = 0, inkOver = 0;
    const body = doc.pages.filter(p => !p.isTitlePage);
    for (let pi = 0; pi < body.length; pi++) {
      const plan = PdfExporter.buildPageRenderPlan(body[pi]);
      const lines = plan.lines.filter(l => l.words.length);
      let hits = 0;
      const ex: string[] = [];
      for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
        const A = lines[a], B = lines[b];
        const vy = Math.min(A.yBaseline, B.yBaseline) - Math.max(A.yBaseline - A.fontSizePt * 0.7, B.yBaseline - B.fontSizePt * 0.7);
        if (vy <= 0.5) continue;
        for (const wa of A.words) for (const wb of B.words) {
          const ov = Math.min(wa.xRight, wb.xRight) - Math.max(wa.xLeft, wb.xLeft);
          if (ov > -6) { hits++; if (ex.length < 4) ex.push(`${A.role}#${A.lineIndex}「${wa.text}」 × ${B.role}#${B.lineIndex}「${wb.text}」 ov=${ov.toFixed(1)}`); }
        }
      }
      // ink wider than the solved box (drawn glyphs run past the slot)
      for (const l of lines) for (const w of l.words) {
        mc.font = `${w.isBold ? 'bold ' : ''}${w.fontSizePt}px "${w.fontFamily}"`;
        const m = mc.measureText(w.text).width * (w.horizontalScalePercent || 100) / 100;
        if (m > w.width + 1.5) { inkOver++; if (ex.length < 6) ex.push(`ink ${w.role} 「${w.text}」 drawn ${m.toFixed(1)} > slot ${w.width.toFixed(1)} (${w.fontFamily})`); }
      }
      if (hits) pagesHit++;
      total += hits;
      if (ex.length && pi < Number(process.env.OVERLAP_PAGES ?? 6)) console.log(`page ${pi}: ${hits} collisions\n   ` + ex.join('\n   '));
    }
    if (process.env.SRC_DUMP) {
      for (const l of body[Number(process.env.SRC_DUMP)].sourceLines.slice(3, 9)) console.log([...new Set(l.words.filter(w => !w.isSpace).map(w => w.unitId))].join(" "), l.unitBoundaryAfter, `SRC just=${l.isJustified} last=${l.isLastLine} w=${l.width.toFixed(1)} tw=${l.targetWidth.toFixed(1)} ex=${l.extraSpacePerWord.toFixed(2)} al=${(l as any).paragraphAlignment} hang=${(l as any).hangingIndentPt} words=${l.words.filter(w => !w.isSpace).length} sum=${l.words.reduce((a, w) => a + w.width, 0).toFixed(1)}`);
    }
    if (process.env.ZONE_DUMP) {
      const pg = body[Number(process.env.ZONE_DUMP)];
      for (const [n, ls] of [['R', pg.rashiLines], ['T', pg.tosafotLines], ['S', pg.sourceLines]] as const) {
        const z = new Map<string, string>();
        for (const l of ls) { const k = `${l.zoneType}`; z.set(k, (z.get(k) ? z.get(k) + ' ' : '') + `${Math.round(l.yBaseline)}:${Math.round(l.xLeft ?? -1)}-${Math.round(l.xRight ?? -1)}`); }
        for (const [k, v] of z) console.log('ZONE', n, k, v.split(' ').slice(-6).join(' '));
      }
    }
    if (process.env.AMUD_DUMP) {
      const by = new Map<string, number[]>();
      for (const pg of body) {
        const all = [...pg.sourceLines, ...pg.rashiLines, ...pg.tosafotLines];
        const bottom = all.length ? Math.max(...all.map(l => l.yBaseline)) : 0;
        const ch = pg.geometry.pageHeight - pg.geometry.marginTop - pg.geometry.marginBottom;
        const k = pg.amudKey ?? '?';
        by.set(k, [...(by.get(k) ?? []), Math.round((bottom / ch) * 100)]);
      }
      const over = [...by].filter(([, v]) => v.length > 1);
      for (const pg of body.filter(q => q.amudKey === process.env.AMUD_DUMP)) console.log('AMUDPG', pg.amudKey, 'S', pg.sourceLines.length, 'R', pg.rashiLines.length, 'T', pg.tosafotLines.length, 'ter', pg.tertiaryLines?.length ?? 0, 'fn', pg.footnoteLines.length, 'margin', (pg as any).marginLines?.length ?? 0, 'mb', pg.geometry.marginBottom);
      console.log('AMUD pages', by.size, 'amudim;', over.length, 'spill:', over.map(([k, v]) => `${k}=${v.join('/')}%`).join(' '));
      const fills = [...by].filter(([, v]) => v.length === 1).map(([, v]) => v[0]).sort((a, b) => a - b);
      console.log('AMUD single-page fill p10/median/p90', fills[Math.floor(fills.length * 0.1)], fills[Math.floor(fills.length / 2)], fills[Math.floor(fills.length * 0.9)]);
    }
    if (process.env.HEAD_GEOM) {
      for (const pg of body.slice(0, 2)) console.log('HEAD', pg.amudKey, JSON.stringify(pg.geometry), JSON.stringify(pg.vilnaHeader?.items.map(i => [i.kind, Math.round(i.xLeft), Math.round(i.xRight)])));
    }
    if (process.env.SIZE_DUMP) {
      const total = JSON.stringify(doc).length;
      let glyphs = 0, words = 0, wordCount = 0, lines = 0;
      const keyBytes = new Map<string, number>();
      for (const pg of doc.pages) for (const ls of [pg.sourceLines, pg.rashiLines, pg.tosafotLines, pg.tertiaryLines ?? [], pg.footnoteLines]) for (const l of ls) {
        lines++;
        for (const w of l.words) {
          wordCount++;
          glyphs += JSON.stringify(w.glyphs ?? []).length;
          words += JSON.stringify(w).length;
          for (const [k, v] of Object.entries(w)) keyBytes.set(k, (keyBytes.get(k) ?? 0) + JSON.stringify(v ?? null).length + k.length + 3);
        }
      }
      console.log(`SIZE doc ${(total / 1e6).toFixed(1)} MB JSON; ${lines} lines, ${wordCount} words; words ${(words / 1e6).toFixed(1)} MB of which glyphs ${(glyphs / 1e6).toFixed(1)} MB`);
      console.log('SIZE top word fields', [...keyBytes].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}=${(v / 1e6).toFixed(2)}MB`).join(' '));
      const g0 = doc.pages[1]?.sourceLines[3]?.words.find(w => !w.isSpace);
      console.log('SIZE sample glyph', JSON.stringify(g0?.glyphs?.[0]));
    }
    if (process.env.FILL_DUMP) {
      const fills: Array<[number, number, string]> = [];
      body.forEach((pg, i) => {
        const ls = [...pg.sourceLines, ...(pg.column2Lines ?? []), ...pg.footnoteLines];
        const ch = pg.geometry.pageHeight - pg.geometry.marginTop - pg.geometry.marginBottom;
        const bottom = ls.length ? Math.max(...ls.map(l => l.yBaseline)) : 0;
        const nextHead = body[i + 1]?.sourceLines.find(l => l.role === 'heading' || l.role === 'chapter');
        fills.push([i, Math.round((bottom / ch) * 100), nextHead ? 'next-heading' : '']);
      });
      const low = fills.filter(f => f[1] < 80);
      console.log('FILL pages', fills.length, 'under 80%:', low.length, 'of which before a heading page:', low.filter(f => f[2]).length, 'examples', JSON.stringify(low.slice(0, 15)));
      const pg = body[Number(process.env.FILL_DUMP)];
      if (pg) console.log('FILL page', process.env.FILL_DUMP, 'src', pg.sourceLines.length, 'col2', pg.column2Lines?.length, JSON.stringify([...pg.sourceLines, ...(pg.column2Lines ?? [])].map(l => [l.role[0], Math.round(l.yBaseline), Math.round(l.xLeft ?? -1)]).slice(0, 80)));
    }
    if (process.env.FIND_HEADING) {
      const i = body.findIndex(pg => [...pg.sourceLines, ...(pg.column2Lines ?? [])].some(l => l.role === 'heading' && l.words.map(w => w.text).join(' ').includes(process.env.FIND_HEADING!)));
      console.log('FIND_HEADING', process.env.FIND_HEADING, 'on body page', i);
    }
    if (process.env.LINE_DUMP) {
      const plan = PdfExporter.buildPageRenderPlan(body[Number(process.env.LINE_DUMP)]);
      for (const l of [...plan.lines].sort((a, b) => a.yBaseline - b.yBaseline)) {
        const wl = Math.min(...l.words.map(w => w.xLeft)), wr = Math.max(...l.words.map(w => w.xRight));
        console.log(`${l.role.padEnd(18)} y=${l.yBaseline.toFixed(1)} line[${l.xLeft.toFixed(1)},${l.xRight.toFixed(1)}] tw=${l.targetWidth.toFixed(1)} ink[${wl.toFixed(1)},${wr.toFixed(1)}] just=${l.isJustified} last=${l.isLastLine} al=${l.alignment} ind=${l.rightIndentPt}/${l.leftIndentPt}/${l.firstLineIndentPt}/${l.hangingIndentPt} n=${l.words.length} 「${l.words.slice(-1)[0]?.text}」`);
      }
    }
    console.log(`OVERLAP pages with collisions ${pagesHit}/${body.length}, word collisions ${total}, words drawn wider than their slot ${inkOver}`);
  }
  if (process.env.PDF) {
    const { PdfExporter } = await import('../../src/engine/pdf-exporter');
    try {
      const blob: any = await timed('pdf export (print)', () => PdfExporter.generateMultiPagePdf(doc, () => {}, { purpose: 'print', pageRange: process.env.PDF === 'all' ? null : { from: 1, to: Number(process.env.PDF) } }));
      console.log('PDF bytes', blob?.size ?? blob?.length);
    } catch (e: any) {
      console.log('PDF ERROR', e?.message ?? e, '\n', (e?.stack ?? '').split('\n').slice(0, 8).join('\n'));
    }
  }
  const total = times.reduce((s, [, t]) => s + t, 0);
  console.log(`TOTAL ${total.toFixed(0)} ms`);
  if (budget && total > budget) { console.log(`over budget ${budget} ms`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
