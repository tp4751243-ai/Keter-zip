/**
 * KETER-TYPE v0.9.8 Phase 4 — synchronized pagination & Tzuras HaDaf
 * solver smoke test.
 *
 * Run from the repo root:  npx tsx scripts/v098-phase4-smoke.ts
 *
 * Verifies:
 *  §1  attachAnchoredCommentaries: source blocks carry their
 *      anchoredCommentaryIds; commentary units carry their AnchorLink.
 *  §2  planSamePageGroups: groups cover every source unit in order;
 *      a sugya whose commentary alone exceeds a page is flagged
 *      fitsOnOnePage:false with a real overflow count.
 *  §3  Dynamic knee: the clearance cap (measured 0 source lines
 *      before the fix on a commentary-heavy page) now places source
 *      lines; the moderate fixture has 0 collisions and no blank
 *      vertical bands ≥ 6pt.
 *  §4  Bottom-line flush (Rule 3): every non-final page's deepest
 *      stream ends within one line-height of the margin box.
 *  §5  Widow/orphan/heading protection (Rule 4): no stranded dibbur
 *      header or heading on the real book; the detector fires on a
 *      synthetic stranded page.
 *  §6  Wraparound polygon (Rule 2): per-band free intervals exclude
 *      a registered region; blank-band audit finds a synthetic gap
 *      and none on real non-final pages.
 *  §7  Memoized line-breaking trials: the trial-line cache serves
 *      repeat trials (hits > 0) on a real knee solve.
 *  §8  Async pagination with real progress: callbacks fire with
 *      monotonic percents ending at 100; pages renumber sequentially;
 *      no text-bearing unit is lost; page count is close to the
 *      single-shot run.
 *  §9  AnchorLink threading: paginating with anchorLinks only (no
 *      explicit links) still links, and each linked pair shares a page.
 *  §10 version is 0.9.8.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { DOMParser } from '@xmldom/xmldom';
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
(globalThis as unknown as { Node: unknown }).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DynamicKneeEngine, trialLineCacheStats, resetTrialLineCacheStats } from '../src/engine/dynamic-knee';
import { SpatialExclusionEngine } from '../src/engine/spatial-exclusion';
import {
  linkCommentariesToSource,
  anchorLinksToRavTextLinks,
} from '../src/engine/commentary-linker';
import {
  attachAnchoredCommentaries,
  planSamePageGroups,
  checkBottomFlush,
  checkStrandedDibburHeaders,
  measureWraparoundGaps,
  splitIntoAnchorSafeChunks,
  paginateDocumentAsync,
  type PaginationProgress,
} from '../src/engine/synchronized-pagination';
import type { ContentUnit, PageTypesetResult } from '../src/types/typesetter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const GEOMETRY = { pageWidth: 482, pageHeight: 680, marginTop: 48, marginBottom: 48, marginInside: 46, marginOutside: 42, isVerso: false };
const CONTENT_HEIGHT = GEOMETRY.pageHeight - GEOMETRY.marginTop - GEOMETRY.marginBottom;

function unit(id: string, role: ContentUnit['role'], rawText: string, extra: Partial<ContentUnit> = {}): ContentUnit {
  return { id, role, rawText, styleName: 'Normal', order: 0, hierarchyLevel: 0, ...extra };
}

// A small sugya book: N source units, each with one Rashi + one Tosafot
// commentary quoting the source's opening words as its dibbur.
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

console.log('§1  attachAnchoredCommentaries');
{
  const { units, sources, commentaries } = buildBook(1);
  const anchors = linkCommentariesToSource(sources, commentaries);
  const { units: stamped, bySource } = attachAnchoredCommentaries(units, anchors);
  const s0 = stamped.find(u => u.id === 'src-0-0')!;
  check('source block carries its anchored commentary ids',
    (s0.anchoredCommentaryIds ?? []).length === 2 &&
    s0.anchoredCommentaryIds!.includes('r-0-0') && s0.anchoredCommentaryIds!.includes('t-0-0'),
    (s0.anchoredCommentaryIds ?? []).join(','));
  const r0 = stamped.find(u => u.id === 'r-0-0')!;
  check('commentary unit carries its AnchorLink',
    r0.anchorLink?.targetMainNodeId === 'src-0-0' && r0.anchorLink.linkConfidence >= 0.9);
  check('map covers every source with anchored commentaries', bySource.size === 10, String(bySource.size));
  check('input array is not mutated', units.find(u => u.id === 'src-0-0')!.anchoredCommentaryIds === undefined);
}

console.log('§2  planSamePageGroups (same-page gravity planner)');
{
  const { units, sources, commentaries } = buildBook(1);
  const anchors = linkCommentariesToSource(sources, commentaries);
  const groups = planSamePageGroups(sources, commentaries, anchors, {
    contentHeightPt: CONTENT_HEIGHT,
    sourceLineHeightPt: 14.5 * 1.32,
    commentLineHeightPt: 10.5 * 1.32,
    flankWidthPt: 105,
  });
  const covered = groups.flatMap(g => g.sourceUnitIds);
  check('groups cover every source unit in order',
    covered.join(',') === sources.map(s => s.id).join(','), `${groups.length} groups`);
  check('every group carries its anchored commentaries',
    groups.every(g => g.commentaryUnitIds.length === g.sourceUnitIds.length * 2));
  // One sugya with a gigantic commentary: must not fit on one page.
  const huge = unit('src-huge', 'main_source', 'פתיחה קצרה של סוגיא.');
  const hugeCom = unit('r-huge', 'primary_comment', FILLER.repeat(400), { dibburHamatchil: 'פתיחה קצרה' });
  const hugeAnchors = linkCommentariesToSource([huge], [hugeCom]);
  const hugeGroups = planSamePageGroups([huge], [hugeCom], hugeAnchors, {
    contentHeightPt: CONTENT_HEIGHT,
    sourceLineHeightPt: 14.5 * 1.32,
    commentLineHeightPt: 10.5 * 1.32,
    flankWidthPt: 105,
  });
  check('gigantic commentary flagged fitsOnOnePage:false with overflow',
    hugeGroups.length === 1 && !hugeGroups[0].fitsOnOnePage && hugeGroups[0].overflowCommentaryLines > 0,
    `overflow=${hugeGroups[0]?.overflowCommentaryLines}`);
}

console.log('§3  Dynamic knee (clearance cap + no collisions)');
{
  const GEMARA = ('מאימתי קורין את שמע בערבית משעה שהכהנים נכנסין לאכול בתרומתן עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות. ').repeat(14);
  const RASHI = ('מאימתי פירוש מאיזה זמן קורין ולא קתני משעה שהכוכבים יוצאים לאשמעינן מילתא אגב אורחיה. ').repeat(6);
  const TOSAFOT = ('תנא היכא קאי קושיא ותירוץ ארוך בין הראשונים חילוקים וראיות והתוספות מקשים על פירוש רשי ומתרצים בדוחק גדול ומביאים ראיה מן התוספתא ומן הירושלמי. ').repeat(18);
  const extreme = DynamicKneeEngine.layoutRavTextPage({
    sourceText: GEMARA, rashiText: RASHI, tosafotText: TOSAFOT,
    sourceUnitId: 'src-1', rashiUnitId: 'r-1', tosafotUnitId: 't-1', geometry: GEOMETRY,
  });
  check('extreme fixture: source is no longer starved (was 0 lines pre-fix)',
    extreme.sourceLines.length >= 2, `${extreme.sourceLines.length} source lines, knee@${extreme.knee.kneeJunctionY.toFixed(0)}`);
  check('extreme fixture: knee raised — lower split zone active', extreme.knee.hasLowerSplitZone === true);
  const colExtreme = SpatialExclusionEngine.auditPageCollisions(
    extreme.sourceLines, extreme.rashiLines, extreme.tosafotLines, [], [], 394,
  );
  check('extreme fixture: 0 collisions', colExtreme.length === 0, String(colExtreme.length));

  const GEMARA2 = GEMARA.split(' ').slice(0, 200).join(' ');
  const RASHI2 = RASHI.split(' ').slice(0, 60).join(' ');
  const TOSAFOT2 = TOSAFOT.split(' ').slice(0, 200).join(' ');
  const moderate = DynamicKneeEngine.layoutRavTextPage({
    sourceText: GEMARA2, rashiText: RASHI2, tosafotText: TOSAFOT2,
    sourceUnitId: 'src-1', rashiUnitId: 'r-1', tosafotUnitId: 't-1', geometry: GEOMETRY,
  });
  check('moderate fixture: source + both flanks placed',
    moderate.sourceLines.length > 5 && moderate.rashiLines.length > 0 && moderate.tosafotLines.length > 0,
    `src ${moderate.sourceLines.length} / r ${moderate.rashiLines.length} / t ${moderate.tosafotLines.length}`);
  const colMod = SpatialExclusionEngine.auditPageCollisions(
    moderate.sourceLines, moderate.rashiLines, moderate.tosafotLines, [], [], 394,
  );
  check('moderate fixture: 0 collisions', colMod.length === 0, String(colMod.length));
  const blank = SpatialExclusionEngine.measureBlankBands(moderate.occupiedRegions, CONTENT_HEIGHT, 6);
  check('moderate fixture: no blank vertical band ≥ 6pt', blank.length === 0, JSON.stringify(blank));
}

console.log('§4–§6  Real paginated book (flush, stranded headers, gaps)');
const { units: BOOK_UNITS, sources: BOOK_SOURCES, commentaries: BOOK_COMS } = buildBook(3);
const BOOK_ANCHORS = linkCommentariesToSource(BOOK_SOURCES, BOOK_COMS);
const BOOK_LINKS = anchorLinksToRavTextLinks(BOOK_ANCHORS, BOOK_UNITS, BOOK_SOURCES[0]);
const syncDoc = PaginationEngine.paginateDocument({
  title: 'Test Sugya Book',
  layoutType: 'rav_text',
  units: BOOK_UNITS,
  links: BOOK_LINKS,
  anchorLinks: BOOK_ANCHORS,
  geometry: GEOMETRY,
});
console.log(`  (book paginated: ${syncDoc.totalPages} pages, unplaced=${(syncDoc.unplacedUnitIds ?? []).length})`);
{
  check('book paginates to more than one page', syncDoc.totalPages > 1, `${syncDoc.totalPages} pages`);
  check('no text-bearing unit lost', (syncDoc.unplacedUnitIds ?? []).length === 0, JSON.stringify(syncDoc.unplacedUnitIds ?? []));
  const nonFinal = syncDoc.pages.slice(0, -1);
  const flushes = nonFinal.map(p => checkBottomFlush(p, GEOMETRY));
  const worst = flushes.reduce((m, f) => Math.max(m, f.maxDeviationPt), 0);
  console.log(`  (worst non-final bottom deviation: ${worst.toFixed(1)}pt; tolerances: ${flushes.map(f => f.tolerancePt.toFixed(1)).join(',')})`);
  // KNOWN GAP (proven pre-existing, v0.9.8 Phase 4): the worst deviation
  // is 25.4pt on 2 of 5 non-final pages (the other 3 are 11.6pt, inside
  // tolerance). An old-linker-only run of the same fixture gives
  // IDENTICAL deviations (11.6/25.4/11.6/25.4/11.6) and the same blank
  // bands, so the new linker is not the cause. Root cause: the probe
  // can only break at linked-group boundaries — a page holding N groups
  // ends where the Nth group's text ends, up to ~1–3 lines short of
  // the margin box. An identical-content test proved the mirror path is
  // NOT the cause (recto/verso byte-identical bottoms). The v0.9.8 tail
  // fix (fullFitCand-first) removed the worst case (241pt tail split);
  // closing the remaining 25.4pt needs vertical leading stretch or a
  // fill-aware probe tiebreak — recorded in PHASE-3-4.md, not faked
  // here by loosening the tolerance.
  check('Rule 3: every non-final page flush within one line-height',
    flushes.every(f => f.withinTolerance), `worst deviation ${worst.toFixed(1)}pt`);
  const stranded = checkStrandedDibburHeaders(syncDoc.pages, BOOK_UNITS);
  check('Rule 4: no stranded dibbur header / heading on the real book',
    stranded.length === 0, JSON.stringify(stranded.slice(0, 2)));
  const gaps = syncDoc.pages.slice(0, -1).flatMap(p => measureWraparoundGaps(p, GEOMETRY, 13));
  // KNOWN GAP (same pre-existing quantization as Rule 3 above): the two
  // 25pt bands are the [559,584] tails of the two pages whose deepest
  // stream ends at 559 — i.e. the flush shortfall measured as a band,
  // not a separate wraparound failure. No band appears mid-page.
  check('Rule 2: no blank wraparound band ≥ 13pt on non-final pages', gaps.length === 0, JSON.stringify(gaps.slice(0, 2)));
  const allCol = syncDoc.pages.flatMap(p =>
    SpatialExclusionEngine.auditPageCollisions(p.sourceLines, p.rashiLines, p.tosafotLines, p.footnoteLines ?? [], [], 394));
  check('real book: 0 collisions on any page', allCol.length === 0, String(allCol.length));
}

console.log('§5b  Stranded-header detector fires on a synthetic page');
{
  const fakeLine = (unitId: string, role: ContentUnit['role'], yBaseline: number, isDibbur: boolean): PageTypesetResult['rashiLines'][number] => ({
    lineIndex: 0, words: [{ text: 'מאימתי', glyphs: [], width: 40, isSpace: false, isDibbur, unitId, role } as never],
    width: 40, targetWidth: 100, xStart: 0, yBaseline, height: 14, ascent: 11, descent: 3,
    isLastLine: true, isJustified: false, extraSpacePerWord: 0, role, unitId,
  });
  const fakePage: PageTypesetResult = {
    pageIndex: 0, pageNumber: 2, pageNumberHebrew: 'ב׳', headerTitle: '', layoutType: 'rav_text',
    geometry: GEOMETRY, sourceLines: [], rashiLines: [fakeLine('r-x', 'primary_comment', 500, true)],
    tosafotLines: [], footnoteLines: [],
    knee: { pageContentWidth: 394, pageContentHeight: CONTENT_HEIGHT, topY: 0, kneeJunctionY: 300, bottomY: CONTENT_HEIGHT, upperSourceWidth: 160, lowerSourceWidth: 160, innerXOffset: 0, isLeftStepped: true, rightCommentaryWidth: 100, leftCommentaryWidth: 100, gutterWidth: 11 },
  };
  const fakeUnits = [unit('r-x', 'primary_comment', 'מאימתי קורין: פירוש.', { dibburHamatchil: 'מאימתי קורין' })];
  const found = checkStrandedDibburHeaders([fakePage], fakeUnits);
  check('synthetic stranded dibbur opening is detected',
    found.length === 1 && found[0].kind === 'dibbur-header', JSON.stringify(found));
}

console.log('§6b  Wraparound polygon API');
{
  const engine = new SpatialExclusionEngine(394, CONTENT_HEIGHT);
  engine.registerRegion({ id: 'block', role: 'main_source', xLeft: 100, xRight: 294, yTop: 100, yBottom: 200, unitId: 'u1' });
  const poly = engine.computeWraparoundPolygon(0, CONTENT_HEIGHT, 14);
  check('polygon covers the content height in line bands',
    poly.length > 0 && poly[0].yTop === 0 && poly[poly.length - 1].yBottom === CONTENT_HEIGHT,
    `${poly.length} bands`);
  const blockedBand = poly.find(b => b.yTop >= 100 && b.yBottom <= 200);
  check('bands overlapping the blocker exclude its x-range',
    !!blockedBand && blockedBand.intervals.every(iv => iv.xRight <= 100 + 11.5 || iv.xLeft >= 294 - 11.5),
    JSON.stringify(blockedBand?.intervals));
  const freeBand = poly.find(b => b.yBottom <= 100);
  check('bands clear of the blocker span the full width',
    !!freeBand && freeBand.intervals.length === 1 && freeBand.intervals[0].width === 394);
  const blank = SpatialExclusionEngine.measureBlankBands(
    [{ id: 'a', role: 'main_source', xLeft: 0, xRight: 394, yTop: 0, yBottom: 100, unitId: 'u1' },
     { id: 'b', role: 'main_source', xLeft: 0, xRight: 394, yTop: 140, yBottom: 200, unitId: 'u1' }],
    200, 13);
  check('blank-band audit finds the 40pt gap', blank.length === 1 && blank[0].yTop === 100 && blank[0].yBottom === 140, JSON.stringify(blank));
}

console.log('§7  Memoized line-breaking trials');
{
  resetTrialLineCacheStats();
  const GEMARA = ('מאימתי קורין את שמע בערבית משעה שהכהנים נכנסין לאכול בתרומתן עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות. ').repeat(10);
  const RASHI = ('מאימתי פירוש מאיזה זמן קורין ולא קתני משעה שהכוכבים יוצאים לאשמעינן מילתא אגב אורחיה. ').repeat(4);
  const TOSAFOT = ('תנא היכא קאי קושיא ותירוץ ארוך בין הראשונים חילוקים וראיות והתוספות מקשים על פירוש רשי ומתרצים בדוחק גדול. ').repeat(8);
  DynamicKneeEngine.layoutRavTextPage({
    sourceText: GEMARA, rashiText: RASHI, tosafotText: TOSAFOT,
    sourceUnitId: 'src-1', rashiUnitId: 'r-1', tosafotUnitId: 't-1', geometry: GEOMETRY,
  });
  check('trial-line memo serves repeat trials (hits > 0)',
    trialLineCacheStats.hits > 0, `hits=${trialLineCacheStats.hits} misses=${trialLineCacheStats.misses}`);
}

console.log('§8  Async pagination with real progress');
const asyncEvents: PaginationProgress[] = [];
const asyncDoc = await paginateDocumentAsync(
  {
    title: 'Test Sugya Book',
    layoutType: 'rav_text',
    units: BOOK_UNITS,
    links: BOOK_LINKS,
    anchorLinks: BOOK_ANCHORS,
    geometry: GEOMETRY,
  },
  p => { asyncEvents.push({ ...p }); }
);
{
  check('progress callbacks fired', asyncEvents.length > 0, `${asyncEvents.length} events`);
  const percents = asyncEvents.map(e => e.percent);
  const monotonic = percents.every((v, i) => i === 0 || v >= percents[i - 1]);
  check('percents are monotonic and end at 100',
    monotonic && percents[percents.length - 1] === 100, percents.join(','));
  check('final pagesDone equals totalPages',
    asyncEvents[asyncEvents.length - 1].pagesDone === asyncDoc.totalPages,
    `${asyncEvents[asyncEvents.length - 1].pagesDone} vs ${asyncDoc.totalPages}`);
  check('page numbers are sequential',
    asyncDoc.pages.every((p, i) => i === 0 || p.pageNumber === asyncDoc.pages[i - 1].pageNumber + 1),
    asyncDoc.pages.map(p => p.pageNumber).join(','));
  check('every page has a Hebrew folio label',
    asyncDoc.pages.every(p => p.pageNumberHebrew && p.pageNumberHebrew.length > 0));
  const placedIds = new Set(asyncDoc.pages.flatMap(p =>
    [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines].map(l => l.unitId)));
  const textUnits = BOOK_UNITS.filter(u => (u.rawText ?? '').trim().length > 0);
  check('no text-bearing unit lost in the async run',
    textUnits.every(u => placedIds.has(u.id)) && (asyncDoc.unplacedUnitIds ?? []).length === 0,
    `placed ${placedIds.size}/${textUnits.length}`);
  const diff = Math.abs(asyncDoc.totalPages - syncDoc.totalPages);
  console.log(`  (async pages=${asyncDoc.totalPages} vs sync pages=${syncDoc.totalPages}, diff=${diff})`);
  check('async page count is close to the single-shot run (±3)',
    diff <= 3, `diff=${diff}`);
  // Anchor-safe chunking: no link crosses a chunk boundary.
  const chunks = splitIntoAnchorSafeChunks(BOOK_UNITS, BOOK_LINKS, BOOK_ANCHORS, 4);
  const chunkOf = new Map<string, number>();
  chunks.forEach((c, i) => c.units.forEach(u => chunkOf.set(u.id, i)));
  const crossing = BOOK_ANCHORS.filter(a =>
    a.targetMainNodeId && chunkOf.get(a.commentaryUnitId) !== chunkOf.get(a.targetMainNodeId));
  check('no AnchorLink crosses a chunk boundary', crossing.length === 0, `${chunks.length} chunks`);
}

console.log('§9  AnchorLink threading (anchorLinks only, no explicit links)');
{
  const small = buildBook(1);
  const smallAnchors = linkCommentariesToSource(small.sources, small.commentaries);
  const doc = PaginationEngine.paginateDocument({
    title: 'Small Book',
    layoutType: 'rav_text',
    units: small.units,
    anchorLinks: smallAnchors,
    geometry: GEOMETRY,
  });
  check('anchorLinks alone produce links', (doc.links ?? []).length > 0, `${(doc.links ?? []).length} links`);
  const pageOfUnit = new Map<string, Set<number>>();
  doc.pages.forEach((p, i) => {
    for (const l of [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines]) {
      const s = pageOfUnit.get(l.unitId) ?? new Set<number>();
      s.add(i);
      pageOfUnit.set(l.unitId, s);
    }
  });
  const shared = smallAnchors.filter(a => {
    const srcPages = pageOfUnit.get(a.targetMainNodeId ?? '') ?? new Set<number>();
    const comPages = pageOfUnit.get(a.commentaryUnitId) ?? new Set<number>();
    return [...srcPages].some(p => comPages.has(p));
  });
  check('every linked pair shares at least one page (same-page gravity)',
    shared.length === smallAnchors.length, `${shared.length}/${smallAnchors.length}`);
}

console.log('§10  version is 0.9.8');
check('package.json version 0.9.8', pkg.version === '0.9.8', `version=${pkg.version}`);

console.log(`\nv098-phase4-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
