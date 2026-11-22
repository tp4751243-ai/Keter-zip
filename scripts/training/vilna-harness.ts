/**
 * Layout training — Vilna Shas scoring harness.
 *
 *   npx tsx scripts/training/vilna-harness.ts [tractate] [--profile all|recipe|rav_text] [--ref <dir>]
 *
 * Reads training/vilna/<tractate>/corpus.json (fetch it with
 * scripts/training/fetch-sefaria-vilna.ts), typesets it with the real
 * engine (DesignSettingsEngine → recipe → PaginationEngine), scores
 * every page against the Vilna rules from the annotated training pages,
 * and renders each page through the PRINT renderer
 * (PdfExporter.renderPageToCanvas), i.e. exactly what a PDF export draws.
 *
 * Profiles (two different code paths exist in the app today):
 *  - recipe   — what a user gets from the Shas wizard / DOCX import:
 *               createDefaultSettings → applyRecipeToSettingsById('talmud-bavli')
 *  - rav_text — the built-in Shas sample path: plain rav_text layout
 *
 * Output: training/out/<tractate>/<profile>/page-N.png, scorecard.json,
 * scorecard.md (training/out is git-ignored). With --ref <dir>, a file
 * named like the amud (2a.png, 2b.png …) is placed next to each page in
 * compare-N.png.
 *
 * Measurement uses @napi-rs/canvas with the real OFL fonts (full TTFs
 * from @expo-google-fonts: Frank Ruhl Libre, Noto Rashi Hebrew), so line breaks
 * come from actual glyph advances, not estimates.
 *
 * Exit code is always 0 unless the harness itself crashes: this is a
 * scorecard, not a gate. Use --min-score N to make it a gate.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

// ── Real fonts + a DOM canvas shim for the engine's measurement path ──
const FONT_DIR = path.resolve('node_modules/@expo-google-fonts');
const FONTS: Array<[string, string]> = [
  ['frank-ruhl-libre/400Regular/FrankRuhlLibre_400Regular.ttf', 'Frank Ruhl Libre'],
  ['frank-ruhl-libre/700Bold/FrankRuhlLibre_700Bold.ttf', 'Frank Ruhl Libre'],
  ['noto-rashi-hebrew/400Regular/NotoRashiHebrew_400Regular.ttf', 'Noto Rashi Hebrew'],
  ['noto-rashi-hebrew/700Bold/NotoRashiHebrew_700Bold.ttf', 'Noto Rashi Hebrew'],
];
for (const [file, family] of FONTS) {
  const p = path.join(FONT_DIR, file);
  if (!fs.existsSync(p)) {
    console.error(`missing font ${p} — run npm install (devDependencies @expo-google-fonts/*)`);
    process.exit(1);
  }
  GlobalFonts.registerFromPath(p, family);
}
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`harness DOM shim: unsupported element <${tag}>`);
    const c = createCanvas(1, 1) as any;
    c.setAttribute = () => {};
    c.style = {};
    return c;
  },
};

import type { ContentUnit, PageTypesetResult, RavTextLink, BookLayoutType } from '../../src/types/typesetter';
import type { ProfessionalDesignSettings } from '../../src/types/design-settings';
import { DesignSettingsEngine } from '../../src/engine/design-settings-engine';
import { applyRecipeToSettingsById } from '../../src/engine/auto-layout';
import { PaginationEngine } from '../../src/engine/pagination-engine';
import { PdfExporter, type PdfPageRenderPlan } from '../../src/engine/pdf-exporter';
import { computeTalmudDafAmud } from '../../src/engine/vilna-shas';

// ── Corpus ────────────────────────────────────────────────────────────
interface Corpus {
  tractate: string;
  tractateHe: string;
  chapters: Array<{ number: number; nameHe: string; wholeRef: string }>;
  amudim: Array<{
    ref: string;
    daf: number;
    amud: 'a' | 'b';
    gemara: string[];
    rashi: string[][];
    tosafot: string[][];
    gilyon: string[];
    einMishpat: Array<{ segment: number; refHe: string }>;
    torahOr: Array<{ segment: number; refHe: string }>;
  }>;
}

const HE_ORDINAL = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי'];

interface BuiltCorpus {
  units: ContentUnit[];
  links: RavTextLink[];
  /** gemara unit id → "2a" (the amud it is printed on in the Vilna edition) */
  amudOfUnit: Map<string, string>;
  firstWord: string;
  perekName: string;
  perekNumberHe: string;
}

function splitDibbur(text: string): { dibbur: string; body: string } {
  const i = text.indexOf(' – ');
  if (i > 0 && i < 160) return { dibbur: text.slice(0, i).trim(), body: text };
  const j = text.indexOf('. ');
  return { dibbur: j > 0 && j < 80 ? text.slice(0, j + 1).trim() : '', body: text };
}

function buildUnits(c: Corpus): BuiltCorpus {
  const units: ContentUnit[] = [];
  const links: RavTextLink[] = [];
  const amudOfUnit = new Map<string, string>();
  let order = 0;
  const push = (u: Omit<ContentUnit, 'order' | 'hierarchyLevel'>) => {
    const unit = { ...u, order: order++, hierarchyLevel: 1 } as ContentUnit;
    units.push(unit);
    return unit;
  };
  const ch = c.chapters[0];
  for (const a of c.amudim) {
    const tag = `${a.daf}${a.amud}`;
    a.gemara.forEach((seg, i) => {
      const g = push({
        id: `g-${tag}-${i + 1}`,
        role: 'main_source',
        rawText: seg,
        styleName: 'Gemara',
        language: 'he',
        ...(units.length === 0 && ch ? { chapterTitle: ch.nameHe } : {}),
      } as ContentUnit);
      amudOfUnit.set(g.id, tag);
      const addComments = (list: string[], role: 'primary_comment' | 'secondary_comment', who: 'Rashi' | 'Tosafot') =>
        list.forEach((text, k) => {
          const { dibbur } = splitDibbur(text);
          const u = push({
            id: `${who[0].toLowerCase()}-${tag}-${i + 1}-${k + 1}`,
            role,
            rawText: text,
            styleName: who,
            language: 'he',
            dibburHamatchil: dibbur || undefined,
            linkedSourceId: g.id,
          } as ContentUnit);
          links.push({
            linkId: `L-${u.id}`,
            sourceUnitId: g.id,
            commentaryUnitId: u.id,
            dibburHamatchil: dibbur,
            isUserLocked: true,
            confidenceScore: 1,
            sourceSnippet: seg.slice(0, 40),
            commentarySnippet: text.slice(0, 40),
            commentaryType: who,
          });
        });
      addComments(a.rashi[i] ?? [], 'primary_comment', 'Rashi');
      addComments(a.tosafot[i] ?? [], 'secondary_comment', 'Tosafot');
    });
    // Apparatus streams (role + styleName the engine's peripheral detector reads)
    a.einMishpat.forEach((e, k) =>
      push({ id: `em-${tag}-${k}`, role: 'tertiary_comment', rawText: e.refHe, styleName: 'עין משפט', language: 'he' } as ContentUnit)
    );
    a.torahOr.forEach((e, k) =>
      push({ id: `to-${tag}-${k}`, role: 'tertiary_comment', rawText: e.refHe, styleName: 'תורה אור', language: 'he' } as ContentUnit)
    );
    a.gilyon.forEach((t, k) =>
      push({ id: `gl-${tag}-${k}`, role: 'side_note', rawText: t, styleName: 'גליון הש״ס', language: 'he' } as ContentUnit)
    );
  }
  const firstText = c.amudim[0]?.gemara[0] ?? '';
  const firstWord =
    firstText
      .split(/\s+/)
      .find(w => w && !/^(מתני|גמ)[׳']?$/.test(w))
      ?.replace(/[.,:;]+$/, '') ?? '';
  return {
    units,
    links,
    amudOfUnit,
    firstWord,
    perekName: ch?.nameHe ?? '',
    perekNumberHe: HE_ORDINAL[ch?.number ?? 1] ?? '',
  };
}

// ── Profiles ──────────────────────────────────────────────────────────
function settingsFor(profile: string): { settings: ProfessionalDesignSettings; layoutType: BookLayoutType } {
  const base = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
  if (profile === 'recipe') {
    const switched = DesignSettingsEngine.updateLayoutSettings(base, { layoutType: 'custom_layout' }, 'user');
    const s = applyRecipeToSettingsById('talmud-bavli', switched);
    return { settings: s, layoutType: s.layout.layoutType as BookLayoutType };
  }
  return { settings: base, layoutType: 'rav_text' };
}

// ── Scoring ───────────────────────────────────────────────────────────
type Status = 'pass' | 'fail' | 'info';
interface Check {
  id: string;
  label: string;
  status: Status;
  detail: string;
  value?: number;
}

const norm = (s: string) => s.replace(/[֑-ׇ]/g, '').replace(/[״"׳']/g, '').trim();
const words = (l: PdfPageRenderPlan['lines'][number]) => l.words.map(w => w.text).join(' ');
const isSource = (r: string) => r === 'main_source' || r === 'chapter' || r === 'verse';
const isRashi = (r: string) => r === 'primary_comment';
const isTosafot = (r: string) => r === 'secondary_comment';

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function scorePage(
  page: PageTypesetResult,
  plan: PdfPageRenderPlan,
  idx: number,
  isLast: boolean,
  b: BuiltCorpus,
  c: Corpus
): Check[] {
  const out: Check[] = [];
  const g = page.geometry;
  const bodyIdx = page.bodyPageIndex ?? idx;
  const { daf, amud } = computeTalmudDafAmud(bodyIdx, 2, 'a');
  const dafHe = (n: number) => {
    const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
    if (n === 15) return 'טו';
    if (n === 16) return 'טז';
    return (n >= 100 ? 'ק'.repeat(Math.floor(n / 100)) : '') + tens[Math.floor((n % 100) / 10)] + ones[n % 10];
  };
  const folio = `${dafHe(daf)}${amud === 'a' ? '.' : ':'}`;
  const isAmudA = amud === 'a';
  // Hebrew book: amud a = LEFT-hand page, binding on its RIGHT edge.
  const innerIsRight = isAmudA;
  const midX = g.pageWidth / 2;

  // H1 — running head carries perek name, perek number, masechta.
  const headerTexts = [plan.headerShowCenter ? plan.headerCenterText : '', plan.headerShowLeft ? plan.headerLeftText : '', plan.headerShowRight ? plan.headerRightText : '']
    .concat(((plan as any).vilnaHeader?.items ?? []).map((i: any) => i.text))
    .filter(Boolean)
    .map(norm)
    .join(' | ');
  const wantParts = [b.perekName, `פרק ${b.perekNumberHe}`, c.tractateHe].map(norm);
  const missing = wantParts.filter(p => p && !headerTexts.includes(p));
  out.push({
    id: 'H1',
    label: 'Running head: perek name + פרק N + masechta',
    status: missing.length === 0 ? 'pass' : 'fail',
    detail: headerTexts ? `header="${headerTexts}"${missing.length ? `; missing ${missing.join(', ')}` : ''}` : 'no running head drawn',
  });

  // H2 — folio label in the head, on the OUTER corner.
  const vItems: Array<{ text: string; xLeft: number; xRight: number; role?: string }> = (plan as any).vilnaHeader?.items ?? [];
  const folioItem = vItems.find(i => norm(i.text) === norm(folio));
  let folioSide: 'left' | 'right' | 'none' = 'none';
  let folioText = '';
  if (folioItem) {
    folioSide = (folioItem.xLeft + folioItem.xRight) / 2 < midX ? 'left' : 'right';
    folioText = folioItem.text;
  } else if (plan.showFolioNumber && plan.folioNumberPosition !== 'hidden') {
    folioText = plan.folioDisplay;
    // Generic renderer: header slot "right" or folio positions; top_outside draws at the right margin today.
    const pos = plan.folioNumberPosition;
    folioSide =
      pos === 'top_inside' ? (innerIsRight ? 'right' : 'left') : pos === 'top_center' || pos === 'bottom_center' ? 'none' : 'right';
  }
  const outerSide = innerIsRight ? 'left' : 'right';
  out.push({
    id: 'H2',
    label: `Folio ${folio} on the outer (${outerSide}) corner`,
    status: norm(folioText) === norm(folio) && folioSide === outerSide ? 'pass' : 'fail',
    detail: `drawn "${folioText}" on ${folioSide}`,
  });

  // F1/F2 — opening-word frame: only on the masechta's first page.
  const box = plan.openingWordBox;
  if (bodyIdx === 0) {
    const srcLines = plan.lines.filter(l => isSource(l.role));
    const firstSrc = srcLines.sort((a, b2) => a.yBaseline - b2.yBaseline)[0];
    const gemLineH = firstSrc ? firstSrc.yBottom - firstSrc.yTop : 20;
    const problems: string[] = [];
    if (!box) problems.push('no frame');
    else {
      if (norm(box.text) !== norm(b.firstWord)) problems.push(`frame text "${box.text}" ≠ first word "${b.firstWord}"`);
      const h = box.yBottom - box.yTop;
      if (h < gemLineH * 2.5) problems.push(`frame too short (${h.toFixed(0)}pt < 2.5 Gemara lines)`);
      // the framed word must leave the running text (not printed twice)
      const firstLineText = firstSrc ? norm(words(firstSrc)) : '';
      if (firstLineText.split(' ')[0] === norm(b.firstWord) || firstLineText.split(' ')[1] === norm(b.firstWord))
        problems.push('framed word is also printed at the start of the text');
      // centred on the Gemara column
      const colL = Math.min(...srcLines.map(l => l.xLeft));
      const colR = Math.max(...srcLines.map(l => l.xRight));
      const off = Math.abs((box.xLeft + box.xRight) / 2 - (colL + colR) / 2);
      if (off > 6) problems.push(`not centred on the Gemara column (off by ${off.toFixed(0)}pt)`);
      // nothing overlaps it
      const overlap = plan.lines.find(
        l => l.yBottom > box.yTop + 1 && l.yTop < box.yBottom - 1 && l.xRight > box.xLeft + 1 && l.xLeft < box.xRight - 1
      );
      if (overlap) problems.push(`text overlaps the frame (${overlap.role})`);
    }
    out.push({ id: 'F1', label: 'Opening frame around the first word (first daf)', status: problems.length ? 'fail' : 'pass', detail: problems.join('; ') || `"${box?.text}"` });
  } else {
    out.push({ id: 'F2', label: 'No opening frame on later pages', status: box ? 'fail' : 'pass', detail: box ? `frame "${box.text}" drawn` : 'none' });
  }

  // R1 — Rashi inner, Tosafot outer.
  const cx = (ls: typeof plan.lines) => (ls.length ? median(ls.map(l => (l.xLeft + l.xRight) / 2)) : NaN);
  const rx = cx(plan.lines.filter(l => isRashi(l.role)));
  const tx = cx(plan.lines.filter(l => isTosafot(l.role)));
  const side = (x: number) => (Number.isNaN(x) ? 'none' : x > midX ? 'right' : 'left');
  const innerSide = innerIsRight ? 'right' : 'left';
  const rOk = Number.isNaN(rx) || side(rx) === innerSide;
  const tOk = Number.isNaN(tx) || side(tx) === outerSide;
  out.push({
    id: 'R1',
    label: `Rashi inner (${innerSide}), Tosafot outer (${outerSide})`,
    status: rOk && tOk && !(Number.isNaN(rx) && Number.isNaN(tx)) ? 'pass' : 'fail',
    detail: `Rashi median x on ${side(rx)}, Tosafot on ${side(tx)}`,
  });

  // M1 — marginal apparatus columns in the side margins.
  const ps = plan.peripheralStreams ?? [];
  const sideCols = ps.filter(p => p.lines.length > 0 && p.lines.every(l => l.xRight <= g.marginInside + 2 || l.xLeft >= g.pageWidth - g.marginOutside - 2 || l.xRight - l.xLeft < g.pageWidth * 0.16));
  out.push({
    id: 'M1',
    label: 'Marginal apparatus (Ein Mishpat / Torah Or / Gilyon) as side columns',
    status: sideCols.length > 0 ? 'pass' : 'fail',
    detail: ps.length ? `${ps.length} peripheral blocks (${ps.map(p => p.stream).join(', ')}), ${sideCols.length} as side columns` : 'no apparatus drawn',
  });

  // T1 — `גמ׳` transition marker placed at the Gemara boundary word.
  const markers = page.transitionMarkers ?? [];
  const literal = plan.lines.reduce((n, l) => n + l.words.filter(w => /^גמ[׳']$/.test(w.text)).length, 0);
  out.push({
    id: 'T1',
    label: '`גמ׳` marker: one per Mishna→Gemara boundary',
    status: 'info',
    detail: `${markers.length} engine markers + ${literal} literal "גמ׳" words on page`,
    value: markers.length + literal,
  });

  // L1 — Gemara : commentary size ratio (Vilna ≈ 1.25–1.45).
  const gSize = median(plan.lines.filter(l => isSource(l.role)).map(l => l.fontSizePt));
  const cSize = median(plan.lines.filter(l => isRashi(l.role) || isTosafot(l.role)).map(l => l.fontSizePt));
  const ratio = cSize ? gSize / cSize : 0;
  out.push({
    id: 'L1',
    label: 'Gemara/commentary size ratio 1.25–1.45',
    status: ratio >= 1.25 && ratio <= 1.45 ? 'pass' : 'fail',
    detail: `${gSize}pt / ${cSize}pt = ${ratio.toFixed(2)}`,
    value: ratio,
  });

  // L2 — justification: inter-word gap on justified Gemara lines.
  const gaps: number[] = [];
  for (const l of plan.lines.filter(x => isSource(x.role) && x.isJustified && !x.isLastLine && x.words.length > 2)) {
    const ws = [...l.words].filter(w => w.text.trim()).sort((a, b2) => b2.xRight - a.xRight); // RTL: right → left
    const inner: number[] = [];
    for (let k = 1; k < ws.length; k++) {
      const gap = ws[k - 1].xLeft - ws[k].xRight;
      if (gap > 0) inner.push(gap / l.fontSizePt);
    }
    if (inner.length) gaps.push(median(inner));
  }
  const p95 = pct(gaps, 0.95);
  out.push({
    id: 'L2',
    label: 'Even justification (p95 word gap ≤ 0.6 em)',
    status: gaps.length === 0 ? 'info' : p95 <= 0.6 ? 'pass' : 'fail',
    detail: gaps.length ? `median ${median(gaps).toFixed(2)} em, p95 ${p95.toFixed(2)} em over ${gaps.length} lines` : 'no justified Gemara lines',
    value: p95,
  });

  // P1 — page filled to the bottom margin (not on the final page).
  const bottom = Math.max(...plan.lines.map(l => l.yBottom), 0);
  const contentBottom = g.pageHeight - g.marginBottom;
  const fill = (bottom - g.marginTop) / (contentBottom - g.marginTop);
  out.push({
    id: 'P1',
    label: 'Page filled to the bottom margin (≥ 95%)',
    status: isLast ? 'info' : fill >= 0.95 ? 'pass' : 'fail',
    detail: `${(fill * 100).toFixed(0)}% of the text block used${isLast ? ' (last page — not scored)' : ''}`,
    value: fill,
  });

  // P2 — nothing overlaps, nothing escapes the page.
  const ls = plan.lines;
  let overlaps = 0;
  for (let i2 = 0; i2 < ls.length; i2++)
    for (let j = i2 + 1; j < ls.length; j++) {
      const a2 = ls[i2];
      const b2 = ls[j];
      if (a2.yBottom - 1 > b2.yTop && b2.yBottom - 1 > a2.yTop && a2.xRight - 1 > b2.xLeft && b2.xRight - 1 > a2.xLeft) overlaps++;
    }
  const escaped = ls.filter(l => l.yBottom > g.pageHeight - 2 || l.yTop < 2 || l.xLeft < 2 || l.xRight > g.pageWidth - 2).length;
  out.push({
    id: 'P2',
    label: 'No overlapping lines, nothing off the page',
    status: overlaps === 0 && escaped === 0 ? 'pass' : 'fail',
    detail: `${overlaps} overlapping line pairs, ${escaped} lines off the page`,
  });

  // A1 — amud alignment (info): which Vilna amudim this page's Gemara came from.
  const amudim = new Map<string, number>();
  for (const l of plan.lines.filter(x => isSource(x.role))) {
    const t = b.amudOfUnit.get(l.unitId);
    if (t) amudim.set(t, (amudim.get(t) ?? 0) + 1);
  }
  out.push({
    id: 'A1',
    label: 'Gemara amudim on this page (Vilna: exactly one)',
    status: 'info',
    detail: [...amudim.entries()].map(([k, v]) => `${k}:${v} lines`).join(', ') || 'no Gemara',
  });
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const tractate = (args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'berakhot').toLowerCase();
  const profileArg = flag('--profile') ?? 'all';
  const refDir = flag('--ref');
  const minScore = flag('--min-score') ? Number(flag('--min-score')) : undefined;
  const profiles = profileArg === 'all' ? ['recipe', 'rav_text'] : [profileArg];

  const corpusPath = path.resolve('training', 'vilna', tractate, 'corpus.json');
  const corpus: Corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const built = buildUnits(corpus);

  const summary: Array<{ profile: string; score: number; pages: number }> = [];
  for (const profile of profiles) {
    const { settings, layoutType } = settingsFor(profile);
    const geometry = settings.pageLayout.geometry;
    const origLog = console.log;
    console.log = (...a: unknown[]) => {
      if (typeof a[0] === 'string' && a[0].startsWith('Diagnostic:')) return;
      origLog(...a);
    };
    const doc = PaginationEngine.paginateDocument({
      title: corpus.tractateHe,
      layoutType,
      units: built.units,
      links: built.links,
      geometry,
      sourceFontSize: settings.roleStyles?.main_source?.character?.fontSizePt,
      commentaryFontSize: settings.roleStyles?.primary_comment?.character?.fontSizePt,
      kneeSettings: settings.knee as any,
      designSettings: settings,
    });
    console.log = origLog;
    const pages = doc.pages.filter(p => !p.isTitlePage);
    const outDir = path.resolve('training', 'out', tractate, profile);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const report: Array<{ page: number; folio: string; checks: Check[] }> = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const plan = PdfExporter.buildPageRenderPlan(page);
      const checks = scorePage(page, plan, i, i === pages.length - 1, built, corpus);
      report.push({ page: i + 1, folio: page.folioDisplay ?? '', checks });

      const canvas = PdfExporter.renderPageToCanvas(page, 2) as any;
      const png = await canvas.encode('png');
      fs.writeFileSync(path.join(outDir, `page-${i + 1}.png`), png);
      if (refDir) {
        const { daf, amud } = computeTalmudDafAmud(page.bodyPageIndex ?? i, 2, 'a');
        const refFile = path.join(refDir, `${daf}${amud}.png`);
        if (fs.existsSync(refFile)) {
          const ref = await loadImage(refFile);
          const H = canvas.height;
          const rw = Math.round((ref.width * H) / ref.height);
          const cmp = createCanvas(rw + canvas.width + 20, H);
          const cx2 = cmp.getContext('2d');
          cx2.fillStyle = '#fff';
          cx2.fillRect(0, 0, cmp.width, H);
          cx2.drawImage(ref, 0, 0, rw, H);
          cx2.drawImage(canvas, rw + 20, 0);
          fs.writeFileSync(path.join(outDir, `compare-${i + 1}.png`), await cmp.encode('png'));
        }
      }
    }

    // D1 — book-level density: Vilna prints this corpus on exactly one page per amud.
    const vilnaPages = corpus.amudim.length;
    const d1: Check = {
      id: 'D1',
      label: `Density: page count vs Vilna (${vilnaPages})`,
      status: pages.length <= Math.ceil(vilnaPages * 1.15) ? 'pass' : 'fail',
      detail: `${pages.length} pages for ${vilnaPages} Vilna amudim (${(pages.length / vilnaPages).toFixed(2)}×)`,
      value: pages.length / vilnaPages,
    };
    report.unshift({ page: 0, folio: 'book', checks: [d1] });
    const scored = report.flatMap(r => r.checks).filter(c2 => c2.status !== 'info');
    const score = scored.length ? Math.round((100 * scored.filter(c2 => c2.status === 'pass').length) / scored.length) : 0;
    summary.push({ profile, score, pages: pages.length });

    // per-rule pass counts
    const ruleIds = [...new Set(report.flatMap(r => r.checks.map(c2 => c2.id)))];
    const md: string[] = [];
    md.push(`# Vilna scorecard — ${corpus.tractate} (${profile})`, '');
    md.push(`Layout type: \`${layoutType}\` · pages: ${pages.length} · **score ${score}%** (${scored.filter(c2 => c2.status === 'pass').length}/${scored.length} scored checks)`, '');
    md.push('| Rule | Pass | Fail |', '|---|---|---|');
    for (const id of ruleIds) {
      const all = report.flatMap(r => r.checks.filter(c2 => c2.id === id));
      md.push(`| ${id} ${all[0].label} | ${all.filter(c2 => c2.status === 'pass').length} | ${all.filter(c2 => c2.status === 'fail').length} |`);
    }
    md.push('');
    for (const r of report) {
      md.push(`## Page ${r.page} (${r.folio})`, '');
      for (const c2 of r.checks) md.push(`- ${c2.status === 'pass' ? '✅' : c2.status === 'fail' ? '❌' : 'ℹ️'} **${c2.id}** ${c2.label} — ${c2.detail}`);
      md.push('');
    }
    fs.writeFileSync(path.join(outDir, 'scorecard.md'), md.join('\n'));
    fs.writeFileSync(path.join(outDir, 'scorecard.json'), JSON.stringify({ tractate, profile, layoutType, score, report }, null, 1));
    console.log(`\n=== ${profile} (${layoutType}) — ${pages.length} pages — score ${score}% ===`);
    for (const id of ruleIds) {
      const all = report.flatMap(r => r.checks.filter(c2 => c2.id === id));
      const p = all.filter(c2 => c2.status === 'pass').length;
      const f = all.filter(c2 => c2.status === 'fail').length;
      console.log(`  ${id.padEnd(3)} ${f ? 'FAIL' : p ? 'PASS' : 'info'}  ${p}/${p + f}  ${all[0].label}${f ? ` — e.g. ${all.find(c2 => c2.status === 'fail')!.detail}` : ''}`);
    }
    console.log(`  → ${outDir}`);
  }
  if (minScore !== undefined && summary.some(s => s.score < minScore)) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
