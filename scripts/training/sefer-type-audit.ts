/**
 * Layout training T5 — sefer-type isolation audit.
 *
 *   npx tsx scripts/training/sefer-type-audit.ts [--json]
 *
 * Builds every sefer type the way the app does and checks that it gets
 * ITS rules and none of another type's. Three entry paths:
 *  1. sample  — a new book of each layout type opened with its built-in
 *               sample (createDefaultSettings({layoutType})).
 *  2. recipe  — every historical recipe applied as the wizard / DOCX
 *               import applies it (applyRecipeToSettingsById).
 *  3. switch  — a Shas book whose layout is then switched to another
 *               type in the header (the settings of the old type stay).
 *
 * Talmud-only features that must never appear outside a Talmud folio:
 *   daf folio (ב. / ב:), Vilna running head, גמ׳ transition marker,
 *   masechta opening frame, Vilna marginal apparatus columns,
 *   Michtav strip, daf-bet page numbering (first page = 2),
 *   Vilna folio page size forced on another type.
 * Exit 1 when any leak is found.
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
  ['DavidLibre-Regular.ttf', 'David Libre'],
  ['NotoSerifHebrew-Regular.ttf', 'Noto Serif Hebrew'],
] as const) GlobalFonts.registerFromPath(path.join(FONT_DIR, f), fam);
(globalThis as any).document = {
  createElement: () => {
    const c = createCanvas(1, 1) as any;
    c.setAttribute = () => {};
    c.style = {};
    return c;
  },
};

import type { BookLayoutType, ContentUnit } from '../../src/types/typesetter';
import type { ProfessionalDesignSettings } from '../../src/types/design-settings';
import { DesignSettingsEngine } from '../../src/engine/design-settings-engine';
import { applyRecipeToSettingsById } from '../../src/engine/auto-layout';
import { HISTORICAL_LAYOUTS } from '../../src/engine/historical-layouts';
import { PaginationEngine } from '../../src/engine/pagination-engine';
import { DocxImporter } from '../../src/engine/docx-importer';

const SAMPLES: Record<string, () => ContentUnit[]> = {
  rav_text: () => DocxImporter.getSampleBerakhot(),
  custom_layout: () => DocxImporter.getSampleBerakhot(),
  mikraot_gedolot: () => DocxImporter.getSampleBereishit(),
  single_column: () => DocxImporter.getSampleMussarSingleColumn(),
  two_column: () => DocxImporter.getSampleShulchanAruchTwoColumn(),
  source_top_commentary_bottom: () => DocxImporter.getSampleMishnahBerurahTopBottom(),
  yiddish_sefer: () => DocxImporter.getSampleYiddishSefer(),
};
const TALMUD_RECIPES = new Set(['talmud-bavli', 'vilna-shas', 'shas-oz-vehadar', 'shas-artscroll', 'shas-steinzaltz', 'yerushalmi']);

interface Case {
  name: string;
  path: 'sample' | 'recipe' | 'switch';
  talmud: boolean;
  settings: ProfessionalDesignSettings;
  units: ContentUnit[];
}

const cases: Case[] = [];
const layouts: BookLayoutType[] = ['rav_text', 'mikraot_gedolot', 'single_column', 'two_column', 'source_top_commentary_bottom', 'yiddish_sefer'];
for (const lt of layouts) {
  cases.push({ name: lt, path: 'sample', talmud: lt === 'rav_text', settings: DesignSettingsEngine.createDefaultSettings({ layoutType: lt }), units: SAMPLES[lt]() });
}
for (const r of HISTORICAL_LAYOUTS) {
  const id = r.metadata.id;
  const base = DesignSettingsEngine.updateLayoutSettings(DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' }), { layoutType: 'custom_layout' }, 'user');
  const s = applyRecipeToSettingsById(id, base);
  const lt = (s.layout.layoutType as string) === 'custom_layout' ? (r.baseLayout ?? 'rav_text') : s.layout.layoutType;
  cases.push({ name: `recipe:${id}`, path: 'recipe', talmud: TALMUD_RECIPES.has(id), settings: s, units: (SAMPLES[r.baseLayout ?? lt] ?? SAMPLES.single_column)() });
}
for (const lt of layouts.filter(l => l !== 'rav_text')) {
  const shas = applyRecipeToSettingsById('talmud-bavli', DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' }));
  const switched = DesignSettingsEngine.updateLayoutSettings(shas, { layoutType: lt }, 'user');
  cases.push({ name: `shas→${lt}`, path: 'switch', talmud: false, settings: switched, units: SAMPLES[lt]() });
}

const origLog = console.log;
const rows: Array<{ name: string; path: string; layout: string; pages: number; leaks: string[]; problems: string[] }> = [];
for (const c of cases) {
  const layoutType = c.settings.layout.layoutType as BookLayoutType;
  let doc;
  console.log = () => {};
  try {
    doc = PaginationEngine.paginateDocument({
      title: 'בדיקה',
      layoutType,
      units: c.units,
      geometry: c.settings.pageLayout.geometry,
      sourceFontSize: c.settings.roleStyles?.main_source?.character?.fontSizePt,
      commentaryFontSize: c.settings.roleStyles?.primary_comment?.character?.fontSizePt,
      kneeSettings: c.settings.ravText?.kneeSettings,
      designSettings: c.settings,
    });
  } catch (e) {
    console.log = origLog;
    rows.push({ name: c.name, path: c.path, layout: layoutType, pages: 0, leaks: [], problems: [`CRASH ${String(e).slice(0, 120)}`] });
    continue;
  }
  console.log = origLog;
  const pages = doc.pages.filter(p => !p.isTitlePage);
  const leaks: string[] = [];
  const problems: string[] = [];
  if (!c.talmud) {
    if (pages.some(p => /[.:]$/.test(p.folioDisplay ?? ''))) leaks.push(`daf folio "${pages[0]?.folioDisplay}"`);
    // The Chumash head (sefer · perek) shares the head geometry; only the
    // Vilna head carries a perek number + masechta.
    if (pages.some(p => p.vilnaHeader && p.vilnaHeader.perekNumber !== undefined)) leaks.push('Vilna running head');
    if (pages.some(p => (p.transitionMarkers?.length ?? 0) > 0)) leaks.push('גמ׳ marker');
    if (pages.some(p => p.openingWordBox)) leaks.push('masechta opening frame');
    // Mikraot Gedolot pages keep their Onkelos column and commentary bands
    // in marginLines (marked by chumashHeadings); anything else is a leak.
    if (pages.some(p => (p.marginLines?.length ?? 0) > 0 && p.chumashHeadings === undefined)) leaks.push('Vilna marginal columns');
    if (layoutType === 'mikraot_gedolot') {
      if (!pages.every(p => p.chumashHeadings !== undefined)) problems.push('Mikraot Gedolot not laid out by the Chumash engine');
      if (!pages.every(p => p.vilnaHeader?.items.some(i => i.kind === 'title'))) problems.push('Chumash page without the sefer · perek head');
    }
    if (pages.some(p => p.michtavBox)) leaks.push('Michtav strip');
    if (pages[0] && pages[0].pageNumber === 2) leaks.push('daf-bet numbering (first page = 2)');
    if (c.path === 'switch' && Math.round(c.settings.pageLayout.geometry.pageWidth) === 680) leaks.push('Vilna folio page size inherited from the Shas book');
    const rh = c.settings.pageElements?.runningHeader;
    if (rh?.useStructuredVilnaHeader) leaks.push('setting: Vilna head on');
    if (c.settings.ravText?.openingDecoration?.enabled) leaks.push('setting: opening frame on');
  }
  // Positive checks: each type keeps ITS rules.
  if (c.talmud && layoutType === 'rav_text') {
    if (!pages.every(p => /[.:]$/.test(p.folioDisplay ?? ''))) problems.push(`Talmud without daf folios ("${pages[0]?.folioDisplay}")`);
    if (!pages.every(p => p.vilnaHeader)) problems.push('Talmud without the Vilna running head');
    if (!pages[0]?.openingWordBox) problems.push('Talmud without the masechta opening frame');
  }
  // Page one is numbered 1 — in Hebrew letters or, where the design asks
  // for them (Siddur, Machzor, Machon, Yiddish editions), in digits.
  if (!c.talmud && pages[0] && !['א', '1'].includes(pages[0].folioDisplay ?? '')) problems.push(`first page numbered "${pages[0].folioDisplay}" (want א or 1)`);
  if (pages.length === 0) problems.push('no pages');
  const empty = pages.filter((p, i) => i < pages.length - 1 && p.sourceLines.length + p.rashiLines.length + p.tosafotLines.length + (p.column2Lines?.length ?? 0) + (p.footnoteLines?.length ?? 0) === 0);
  if (empty.length) problems.push(`${empty.length} empty pages`);
  const words = (u: ContentUnit) => u.rawText.trim().split(/\s+/).filter(Boolean).length;
  const inWords = c.units.filter(u => u.role !== 'footnote').reduce((a, u) => a + words(u), 0);
  const outWords = pages.reduce(
    (a, p) =>
      a +
      [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines, ...(p.column2Lines ?? []), ...(p.tertiaryLines ?? []), ...(p.marginLines ?? [])].reduce(
        (b, l) => b + l.words.filter(w => !w.isSpace && w.text.trim()).length,
        0
      ),
    0
  );
  if (outWords < inWords * 0.9) problems.push(`text lost: ${outWords}/${inWords} words placed`);
  rows.push({ name: c.name, path: c.path, layout: layoutType, pages: pages.length, leaks, problems });
}

const bad = rows.filter(r => r.leaks.length || r.problems.length);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  for (const r of rows) {
    const status = r.leaks.length || r.problems.length ? 'FAIL' : 'ok  ';
    console.log(`${status} ${r.path.padEnd(6)} ${r.name.padEnd(34)} ${r.layout.padEnd(28)} ${String(r.pages).padStart(3)}p  ${[...r.leaks, ...r.problems].join('; ')}`);
  }
  console.log(`\n${rows.length - bad.length}/${rows.length} sefer types clean`);
}
fs.mkdirSync('training/out', { recursive: true });
fs.writeFileSync('training/out/sefer-type-audit.json', JSON.stringify(rows, null, 1));
process.exit(bad.length ? 1 : 0);
