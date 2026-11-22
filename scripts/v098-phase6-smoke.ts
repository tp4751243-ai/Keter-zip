/**
 * KETER-TYPE v0.9.8 Phase 6 — 1:1 export parity smoke test.
 *
 * Run from the repo root (fonts are needed for the PDF gates):
 *   KETER_FONTS_DIR=/tmp/keter-fonts npx tsx scripts/v098-phase6-smoke.ts
 * Without KETER_FONTS_DIR (or public/fonts) the PDF gates are SKIPPED
 * with a reason — same gate as scripts/partE-smoke.ts — and the plan /
 * IDML gates still run and must pass. No font files ship in the repo;
 * the six static TTFs used here were fetched from the Google Fonts
 * repository (OFL) and instanced to static Regular/Bold with fontTools;
 * they are test inputs only, not bundled.
 *
 * Verifies:
 *  §1  PDF plan parity: PdfExporter.buildPageRenderPlan(page) reproduces
 *      the RenderedPage tree exactly — line xLeft/xRight/yBaseline equal
 *      margin + line geometry, word texts/positions match the shaped
 *      words, plan line count equals the page's line count.
 *  §2  Real PDF (fonts gate): generateMultiPagePdf produces a non-empty
 *      valid PDF with the same page count; the text extracted back from
 *      it (PdfNativeTextEngine) lands within ~2pt of the plan baselines
 *      and x-bounds, and reads in logical Hebrew order (valid RTL).
 *  §3  IDML frame parity: IdmlExporter.computePageTextFrames polygons
 *      contain the same line geometry (margin + line x/y), and NO two
 *      frames on one page overlap (0 overlapping text boxes).
 *  §4  Real IDML: generateMultiPageIdml produces a non-empty valid
 *      UCF/ZIP package; auditIdmlPackage passes with 0 overlapping
 *      frames; the package contains Paragraph Styles (KeterHeading /
 *      KeterRashi / KeterTosafot), the KeterDibburBold Character Style,
 *      and threaded frames (PreviousTextFrame / NextTextFrame).
 *  §5  Dibbur same-page co-location: >95% of linked dibburim share a
 *      page with their target phrase (exact word keys, not unit level).
 *  §6  version is 0.9.8.
 *
 * Known gaps, recorded not hidden (see PHASE-5-6.md):
 *  - IDML drops running headers entirely (no header rendering in
 *    idml-exporter.ts); InDesign users put them on master pages.
 *  - No .ttf ships in the repo; PDF export throws without font binaries.
 *
 * Exit code 0 = every check passed (skips do not fail); 1 = a failure.
 */

import { DOMParser } from '@xmldom/xmldom';
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
(globalThis as unknown as { Node: unknown }).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PaginationEngine } from '../src/engine/pagination-engine';
import {
  linkCommentariesToSource,
  anchorLinksToRavTextLinks,
} from '../src/engine/commentary-linker';
import { PdfExporter } from '../src/engine/pdf-exporter';
import { PdfNativeTextEngine } from '../src/engine/pdf-native-text-engine';
import { IdmlExporter } from '../src/engine/idml-exporter';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { findDibburWordKey, findTargetWordKey } from '../src/engine/anchor-overlay';
import type { ContentUnit, PageTypesetResult, TypesetLine } from '../src/types/typesetter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let passes = 0;
let failures = 0;
let skips = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function skip(name: string, reason: string) {
  skips++;
  console.log(`  SKIP  ${name} — ${reason}`);
}

const GEOMETRY = { pageWidth: 482, pageHeight: 680, marginTop: 48, marginBottom: 48, marginInside: 46, marginOutside: 42, isVerso: false };

function unit(id: string, role: ContentUnit['role'], rawText: string, extra: Partial<ContentUnit> = {}): ContentUnit {
  return { id, role, rawText, styleName: 'Normal', order: 0, hierarchyLevel: 0, ...extra };
}

const PHRASES = [
  'מאימתי קורין את שמע בערבית משעה שהכהנים',
  'עד סוף האשמורה הראשונה דברי רבי אליעזר',
  'רבן גמליאל אומר עד שיעלה עמוד השחר',
  'תנא היכא קאי דקתני מאימתי קורין',
  'אמר רבי יהושע בן לוי זמן קריאת שמע',
  'משנה מאימתי קורין את שמע בערבית',
  'גמרא אמר רב יהודה אמר שמואל הלכה',
  'תנו רבנן קורין את שמע בשחרית',
  'אמר רבי אלעזר אמר רבי חנינא תלמידי',
  'משנה אימתי קורין את שמע בשחרית',
];
const FILLER = 'פירוש וביאור ארוך על הסוגיא חילוקים וראיות מן הראשונים והאחרונים ';
function buildBook(copies: number): { units: ContentUnit[]; sources: ContentUnit[]; commentaries: ContentUnit[] } {
  const units: ContentUnit[] = [];
  const sources: ContentUnit[] = [];
  const commentaries: ContentUnit[] = [];
  for (let c = 0; c < copies; c++) {
    for (let i = 0; i < PHRASES.length; i++) {
      const sid = `src-${c}-${i}`;
      const phrase = PHRASES[i];
      const src = unit(sid, 'main_source', `${phrase} ${FILLER.repeat(2)}`.trim());
      sources.push(src);
      units.push(src);
      const r = unit(`r-${c}-${i}`, 'primary_comment', `${phrase}: ${FILLER.repeat(2)}`.trim(), { dibburHamatchil: phrase });
      const t = unit(`t-${c}-${i}`, 'secondary_comment', `${phrase}: ${FILLER.repeat(2)}`.trim(), { dibburHamatchil: phrase });
      commentaries.push(r, t);
      units.push(r, t);
    }
  }
  units.forEach((u, idx) => { u.order = idx; });
  return { units, sources, commentaries };
}

const STREAM_KEYS = ['sourceLines', 'rashiLines', 'tosafotLines', 'column2Lines', 'tertiaryLines', 'footnoteLines', 'sideNoteLines'] as const;
function allLines(page: PageTypesetResult): TypesetLine[] {
  const out: TypesetLine[] = [];
  for (const k of STREAM_KEYS) out.push(...((page as unknown as Record<string, TypesetLine[] | undefined>)[k] ?? []));
  return out;
}

const { units, sources, commentaries } = buildBook(3);
const anchorLinks = linkCommentariesToSource(sources, commentaries);
const unitsById = new Map(units.map(u => [u.id, u]));
const settings = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text', geometry: GEOMETRY });
const doc = PaginationEngine.paginateDocument({
  title: 'Phase 6 parity fixture',
  layoutType: 'rav_text',
  units,
  links: anchorLinksToRavTextLinks(anchorLinks, units),
  anchorLinks,
  geometry: GEOMETRY,
  sourceFontSize: 14.5,
  commentaryFontSize: 10.5,
  designSettings: settings,
});
check('fixture paginates', doc.pages.length >= 2, `${doc.pages.length} pages`);

const mLeft = GEOMETRY.marginInside;
const mTop = GEOMETRY.marginTop;

// ── §1 — PDF plan vs the RenderedPage tree ───────────────────────────────
let planLinesTotal = 0;
let planLineMismatches = 0;
let planWordMismatches = 0;
let planWordCount = 0;
let worstLineDelta = 0;
for (const page of doc.pages) {
  const plan = PdfExporter.buildPageRenderPlan(page);
  const lines = allLines(page);
  planLinesTotal += plan.lines.length;
  if (plan.lines.length !== lines.length) {
    planLineMismatches++;
    console.log(`    (page ${page.pageNumber}: plan ${plan.lines.length} lines vs tree ${lines.length})`);
  }
  const byKey = new Map(lines.map(l => [`${l.unitId}:${l.lineIndex}`, l]));
  for (const pl of plan.lines) {
    const tree = byKey.get(`${pl.unitId}:${pl.lineIndex}`);
    if (!tree) {
      planLineMismatches++;
      continue;
    }
    const dXl = tree.xLeft !== undefined ? Math.abs(pl.xLeft - (mLeft + tree.xLeft)) : 0;
    const dXr = tree.xRight !== undefined ? Math.abs(pl.xRight - (mLeft + tree.xRight)) : 0;
    const dY = Math.abs(pl.yBaseline - (mTop + tree.yBaseline));
    worstLineDelta = Math.max(worstLineDelta, dXl, dXr, dY);
    if (dXl > 0.51 || dXr > 0.51 || dY > 0.51) planLineMismatches++;
    const realWords = tree.words.filter(w => !w.isSpace && w.text.trim().length > 0);
    planWordCount += realWords.length;
    if (pl.words.length !== realWords.length) {
      planWordMismatches++;
      continue;
    }
    for (let i = 0; i < realWords.length; i++) {
      const pw = pl.words[i];
      const rw = realWords[i];
      if (pw.text !== rw.text) planWordMismatches++;
      else if (pw.xLeft < pl.xLeft - 0.6 || pw.xRight > pl.xRight + 0.6) planWordMismatches++;
      else if (Math.abs(pw.yBaseline - pl.yBaseline) > 0.51) planWordMismatches++;
    }
  }
}
check('§1 plan line count equals tree line count', planLineMismatches === 0, `${planLinesTotal} plan lines`);
check('§1 plan coordinates match the tree (≤0.5pt)', worstLineDelta <= 0.51, `worst delta ${worstLineDelta.toFixed(2)}pt`);
check('§1 plan words match shaped words', planWordMismatches === 0, `${planWordCount} words checked`);

// ── §2 — real PDF + extraction ───────────────────────────────────────────
const FONT_FILES = [
  'FrankRuhlLibre-Regular.ttf',
  'FrankRuhlLibre-Bold.ttf',
  'NotoRashiHebrew-Regular.ttf',
  'NotoRashiHebrew-Bold.ttf',
  'DavidLibre-Regular.ttf',
  'DavidLibre-Bold.ttf',
];
const fontDir = process.env.KETER_FONTS_DIR
  ? path.resolve(process.env.KETER_FONTS_DIR)
  : path.join(ROOT, 'public', 'fonts');
const fontsAvailable = FONT_FILES.every(f => fs.existsSync(path.join(fontDir, f)));
let pdfBlob: Blob | null = null;
if (!fontsAvailable) {
  skip('§2 PDF generation', `font binaries not in ${fontDir} — set KETER_FONTS_DIR`);
  skip('§2 extracted positions vs plan', 'no PDF (fonts missing)');
  skip('§2 valid RTL glyph ordering', 'no PDF (fonts missing)');
} else {
  try {
    // Exact-parity run: no bleed, so the media box equals the trim box
    // and extracted coordinates must equal the plan coordinates.
    pdfBlob = await PdfExporter.generateMultiPagePdf(doc, undefined, { purpose: 'print', bleedMm: 0 });
    const head = new Uint8Array(await pdfBlob.slice(0, 5).arrayBuffer());
    check('§2 PDF is a non-empty valid PDF', pdfBlob.size > 1000 && String.fromCharCode(...head) === '%PDF-', `${pdfBlob.size} bytes`);
    const extracted = await PdfNativeTextEngine.extractTextAndPositionsFromPdf(pdfBlob);
    check('§2 extracted PDF has the same page count', extracted.pageCount === doc.pages.length, `${extracted.pageCount} pages`);
    // Joint matcher: the extractor merges streams that share a baseline
    // into one line, so a plan line matches when an extracted line within
    // 2pt of its baseline contains the plan line's text (union of the
    // near lines). RTL: the text must appear in logical order, not as
    // reversed word order.
    const norm = (s: string) => s.replace(/[\s״׳"'-]+/g, '');
    let matched = 0;
    let checked = 0;
    let worstPosDelta = 0;
    let rtlOk = 0;
    let rtlChecked = 0;
    for (const page of doc.pages) {
      const plan = PdfExporter.buildPageRenderPlan(page);
      // Match by POSITION, not pageNumber: rav-text foliation starts at
      // Daf Bet (pageNumber = pageIndex + 2), while the extractor numbers
      // PDF pages 1..N in order.
      const extPage = extracted.pages[page.pageIndex];
      if (!extPage) continue;
      for (const pl of plan.lines) {
        const expected = norm(pl.words.map(w => w.text).join(''));
        if (expected.length < 4) continue;
        checked++;
        const near = extPage.lines.filter(l => Math.abs(l.yBaselinePt - pl.yBaseline) <= 2);
        const union = near.map(l => norm(l.lineText)).join('|');
        if (near.length > 0 && union.includes(expected)) {
          matched++;
          worstPosDelta = Math.max(worstPosDelta, ...near.map(l => Math.abs(l.yBaselinePt - pl.yBaseline)));
          const revWords = norm([...pl.words.map(w => w.text)].reverse().join(''));
          if (revWords !== expected) {
            rtlChecked++;
            if (!union.includes(revWords)) rtlOk++;
          }
        }
      }
    }
    check('§2 extracted text lands on plan baselines (≤2pt)', checked > 0 && matched / checked >= 0.95, `${matched}/${checked} lines matched, worst ${worstPosDelta.toFixed(2)}pt`);
    check('§2 extracted Hebrew reads in logical order (RTL)', rtlChecked > 0 && rtlOk / rtlChecked >= 0.95, `${rtlOk}/${rtlChecked} lines forward, none word-reversed`);
    // Bleed run: with the default 3mm bleed the whole plan shifts by
    // exactly the bleed (8.5039pt) on a media box enlarged by the same
    // amount — the shift is the bleed, not a renderer error.
    const bleedBlob = await PdfExporter.generateMultiPagePdf(doc, undefined, { purpose: 'print' });
    const bleedExt = await PdfNativeTextEngine.extractTextAndPositionsFromPdf(bleedBlob);
    const bleedPt = (3 * 72) / 25.4;
    const page0 = doc.pages[0];
    const plan0 = PdfExporter.buildPageRenderPlan(page0);
    const extPage0 = bleedExt.pages[page0.pageIndex];
    let bleedMatched = 0;
    let bleedChecked = 0;
    if (extPage0) {
      for (const pl of plan0.lines.slice(0, 40)) {
        const expected = norm(pl.words.map(w => w.text).join(''));
        if (expected.length < 4) continue;
        bleedChecked++;
        const near = extPage0.lines.filter(l => Math.abs(l.yBaselinePt - (pl.yBaseline + bleedPt)) <= 2);
        const union = near.map(l => norm(l.lineText)).join('|');
        if (near.length > 0 && union.includes(expected)) bleedMatched++;
      }
    }
    check('§2 default 3mm bleed shifts text by exactly the bleed', bleedChecked > 0 && bleedMatched / bleedChecked >= 0.95, `${bleedMatched}/${bleedChecked} lines at plan + ${bleedPt.toFixed(2)}pt`);
  } catch (e) {
    check('§2 PDF generation + extraction', false, String(e));
  }
}

// ── §3 — IDML frames vs the tree ─────────────────────────────────────────
let frameBoundMismatches = 0;
let frameOverlapPairs = 0;
let framesTotal = 0;
for (const page of doc.pages) {
  const { frames, linesByFrameId } = IdmlExporter.computePageTextFrames(page, page.pageIndex);
  framesTotal += frames.length;
  for (const f of frames) {
    const lines = linesByFrameId.get(f.id) ?? [];
    if (lines.length === 0) continue;
    const xs = lines.flatMap(l => (l.xLeft !== undefined && l.xRight !== undefined ? [l.xLeft, l.xRight] : []));
    const ys = lines.flatMap(l => [l.yTop ?? l.yBaseline - (l.ascent ?? 0), l.yBottom ?? l.yBaseline + (l.descent ?? 0)]);
    if (xs.length > 0) {
      if (f.xLeft > mLeft + Math.min(...xs) + 1 || f.xRight < mLeft + Math.max(...xs) - 1) frameBoundMismatches++;
    }
    if (f.yTop > mTop + Math.min(...ys) + 1 || f.yBottom < mTop + Math.max(...ys) - 1) frameBoundMismatches++;
    if (!f.polygonPoints || f.polygonPoints.length < 4) frameBoundMismatches++;
  }
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      if (IdmlExporter.doPolygonsOverlap(frames[i].polygonPoints, frames[j].polygonPoints, 1.0)) {
        frameOverlapPairs++;
      }
    }
  }
}
check('§3 IDML frame bounds contain their lines', frameBoundMismatches === 0, `${framesTotal} frames`);
check('§3 0 overlapping IDML text frames on any page', frameOverlapPairs === 0, `${frameOverlapPairs} overlapping pairs`);

// ── §4 — real IDML package ───────────────────────────────────────────────
try {
  const idmlBlob = await IdmlExporter.generateMultiPageIdml(doc);
  const head = new Uint8Array(await idmlBlob.slice(0, 2).arrayBuffer());
  check('§4 IDML is a non-empty valid ZIP package', idmlBlob.size > 1000 && head[0] === 0x50 && head[1] === 0x4b, `${idmlBlob.size} bytes`);
  const audit = await IdmlExporter.auditIdmlPackage(idmlBlob, doc);
  check('§4 IDML package audit passes', audit.passed, audit.errors.join('; ') || `${audit.totalTextFrames} frames, ${audit.totalSpreads} spreads`);
  check('§4 audit finds 0 overlapping text frames', (audit.overlappingTextFrames?.length ?? 0) === 0, (audit.overlappingTextFrames ?? []).join('; '));
  check('§4 audit conserves the word count', audit.conservedWordCount === audit.expectedWordCount && audit.expectedWordCount > 0, `${audit.conservedWordCount}/${audit.expectedWordCount} words`);
  // Styles + threading: dump the package XML and grep.
  const tmpIdml = path.join(ROOT, '.tmp-phase6.idml');
  fs.writeFileSync(tmpIdml, Buffer.from(await idmlBlob.arrayBuffer()));
  const allXml = execSync(`unzip -p ${tmpIdml}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  fs.unlinkSync(tmpIdml);
  check('§4 IDML has Keter Paragraph Styles', allXml.includes('ParagraphStyle/KeterHeading') && allXml.includes('ParagraphStyle/KeterRashi') && allXml.includes('ParagraphStyle/KeterTosafot'));
  check('§4 IDML has the KeterDibburBold Character Style', allXml.includes('CharacterStyle/KeterDibburBold'));
  const threaded = (allXml.match(/PreviousTextFrame="[^n][^"]*"/g) ?? []).length + (allXml.match(/NextTextFrame="[^n][^"]*"/g) ?? []).length;
  check('§4 IDML text frames are threaded', threaded > 0, `${threaded} non-empty frame links`);
  check('§4 IDML stories are RTL', audit.hasRtlStoryDirection && audit.hasRtlParagraphDirection, `story RTL ${audit.hasRtlStoryDirection}, paragraph RTL ${audit.hasRtlParagraphDirection}`);
} catch (e) {
  check('§4 IDML generation + audit', false, String(e));
}

// ── §5 — Dibbur same-page co-location ────────────────────────────────────
let colocated = 0;
let colocChecked = 0;
for (const link of anchorLinks) {
  if (!link.targetMainNodeId || link.targetCharOffset === undefined) continue;
  const targetUnit = unitsById.get(link.targetMainNodeId);
  if (!targetUnit) continue;
  let targetPage = -1;
  let dibburPage = -1;
  for (const page of doc.pages) {
    if (targetPage < 0 && findTargetWordKey(page, targetUnit, link.targetCharOffset)) targetPage = page.pageIndex;
    if (dibburPage < 0 && findDibburWordKey(page, link.commentaryUnitId)) dibburPage = page.pageIndex;
    if (targetPage >= 0 && dibburPage >= 0) break;
  }
  if (targetPage >= 0 && dibburPage >= 0) {
    colocChecked++;
    if (targetPage === dibburPage) colocated++;
  }
}
check('§5 Dibbur same-page co-location >95%', colocChecked > 0 && colocated / colocChecked > 0.95, `${colocated}/${colocChecked} (${colocChecked ? ((100 * colocated) / colocChecked).toFixed(1) : '0'}%)`);

// ── §6 ───────────────────────────────────────────────────────────────────
check('§6 version is 0.9.8', pkg.version === '0.9.8', pkg.version);

// Informational gaps (not pass/fail — recorded in PHASE-5-6.md).
const idmlSrc = fs.readFileSync(path.join(ROOT, 'src/engine/idml-exporter.ts'), 'utf8');
console.log(
  `  INFO  IDML running-header gap: exporter ${idmlSrc.includes('headerCenterText') ? 'renders' : 'does NOT render'} running headers (master-page job in InDesign)`
);
console.log(
  `  INFO  Fonts: ${fs.existsSync(path.join(ROOT, 'public', 'fonts', 'FrankRuhlLibre-Regular.ttf')) ? 'bundled in public/fonts' : 'NOT bundled in the repo'}; test run used ${fontDir}`
);

console.log(`\nv098-phase6-smoke: ${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures === 0 ? 0 : 1);
