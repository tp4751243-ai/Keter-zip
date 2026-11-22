/**
 * KETER-TYPE v0.9.8 Phase 5 — interactive canvas & one-click tweaking
 * studio smoke test.
 *
 * Run from the repo root:  npx tsx scripts/v098-phase5-smoke.ts
 *
 * Verifies:
 *  §1  Anchor overlay (pure): dibbur-word + target-phrase word keys
 *      resolve to real paginated lines; connectors carry the DOM keys
 *      PageCanvas measures; colour-coding by confidence; connector
 *      path is a real curve between two points (not a fixed arc).
 *  §2  Click-to-re-anchor (pure): reAnchorLink replaces the link for
 *      the commentary (exact, confidence 1.0, never invents a target);
 *      applyReAnchorToUnits stamps anchorLink + same-page gravity.
 *  §3  Push / pull: `oneLineLess` moves exactly one line to the next
 *      page on a real paginated book; the new `oneLineMore` pulls the
 *      next page's first line onto a roomy page, and is REFUSED (skip
 *      + warning) when the page has no room; the global word-index
 *      helper agrees with findBreakAnchor's counting.
 *  §4  Quick-Tune settings: US trim presets (6×9 / 7×10 / 8.5×11 /
 *      Vilna Folio) land in the geometry; mirror-margins OFF makes
 *      both side margins the inside margin (and restores them on ON);
 *      recto/verso (right/left-page) header text resolves per side;
 *      the header divider rule defaults ON; the settled defaults
 *      (running header, folio, commentary labels OFF) are untouched.
 *  §5  Zone typography writers: per-role font / size / line-spacing
 *      changes land on the role style (the Quick-Tune writers).
 *  §6  Bilingual i18n: every new key exists in EN_STRINGS; the
 *      Quick-Tune strict tables are exhaustive and translated.
 *  §7  Secondary import wiring: the new linker is called in
 *      secondary-docx-import.ts (source check — the linker's own
 *      behaviour is covered by the Phase 3 smoke).
 *  §8  version is 0.9.8.
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
import {
  linkCommentariesToSource,
  anchorLinksToRavTextLinks,
  mergeLinkSets,
} from '../src/engine/commentary-linker';
import {
  anchorConnectorColor,
  applyReAnchorToUnits,
  buildAnchorConnectors,
  buildConnectorPath,
  charOffsetOfPageWord,
  findDibburWordKey,
  findTargetWordKey,
  rawTextWordOffsets,
  reAnchorLink,
  unitGlobalWordIndexAcrossPages,
  wordIndexAtCharOffset,
} from '../src/engine/anchor-overlay';
import {
  applyBreakInstructions,
  createBreakInstruction,
  findBreakAnchor,
} from '../src/engine/break-instructions';
import { DesignSettingsEngine, PAGE_SIZE_DIMENSIONS } from '../src/engine/design-settings-engine';
import { resolveRunningHeader } from '../src/types/design-settings';
import { applyCharacterStyleChange, applyParagraphStyleChange } from '../src/engine/text-style-apply';
import {
  EN_STRINGS,
  QUICK_TUNE_TRIM_LABELS,
  QUICK_TUNE_ZONE_LABELS,
} from '../src/i18n/strings';
import type { AnchorLink, ContentUnit, PageTypesetResult, TypesetLine } from '../src/types/typesetter';

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

// ── Real paginated book with Phase 3 links ───────────────────────────────
const { units, sources, commentaries } = buildBook(3);
const anchorLinks = linkCommentariesToSource(sources, commentaries);
const linked = anchorLinks.filter(a => a.targetMainNodeId);
check('§1 fixture links', linked.length >= 20, `${linked.length} linked of ${anchorLinks.length}`);
for (const a of anchorLinks) {
  const com = commentaries.find(u => u.id === a.commentaryUnitId);
  if (com) com.anchorLink = a;
}
const doc = PaginationEngine.paginateDocument({
  title: 'Test',
  layoutType: 'rav_text',
  units,
  links: anchorLinksToRavTextLinks(anchorLinks, units),
  anchorLinks,
  geometry: GEOMETRY,
  sourceFontSize: 14.5,
  commentaryFontSize: 10.5,
});
check('§1 book paginates', doc.pages.length >= 2, `${doc.pages.length} pages`);
const page0 = doc.pages[0];
const page1 = doc.pages[1];
const unitsById = new Map(units.map(u => [u.id, u]));

// §1 — overlay helpers on the real page.
const dibburWords = page0.rashiLines
  .flatMap(l => l.words)
  .filter(w => !w.isSpace && w.isDibbur);
check('§1 dibbur words are flagged on the page', dibburWords.length > 0, `${dibburWords.length} isDibbur words on page 1`);
const firstLink = linked[0];
const dibburKey = findDibburWordKey(page0, firstLink.commentaryUnitId);
check('§1 dibbur word key resolves', dibburKey !== null, dibburKey ? `${dibburKey.lineKey}-w-${dibburKey.wordIndexInLine}` : 'null');
const targetUnit = unitsById.get(firstLink.targetMainNodeId ?? '');
let targetKey: { lineKey: string; wordIndexInLine: number } | null = null;
if (targetUnit && firstLink.targetCharOffset !== undefined) {
  targetKey = findTargetWordKey(page0, targetUnit, firstLink.targetCharOffset);
}
check('§1 target-phrase word key resolves', targetKey !== null, targetKey ? `${targetKey.lineKey}-w-${targetKey.wordIndexInLine}` : 'null (target may be on another page)');
// Round-trip: the char offset of the resolved target word is inside the
// anchor's matched span (the anchor offset itself, ± one word).
if (targetUnit && targetKey && firstLink.targetCharOffset !== undefined) {
  const back = charOffsetOfPageWord(page0, targetUnit, targetKey.lineKey, targetKey.wordIndexInLine);
  const spans = rawTextWordOffsets(targetUnit.rawText);
  const wordIdx = wordIndexAtCharOffset(targetUnit.rawText, firstLink.targetCharOffset);
  check(
    '§1 target char offset round-trips to the same word',
    back !== null && Math.abs(wordIndexAtCharOffset(targetUnit.rawText, back) - wordIdx) <= 1,
    `anchor word ${wordIdx}, resolved word ${back === null ? 'null' : wordIndexAtCharOffset(targetUnit.rawText, back)}`
  );
  void spans;
}
const connectors = buildAnchorConnectors(page0, anchorLinks, unitsById);
check('§1 connectors built for page 1', connectors.length > 0, `${connectors.length} connectors`);
const withBothEnds = connectors.filter(c => c.dibburDomKey && c.targetDomKey);
check('§1 some connectors have both ends on the page', withBothEnds.length > 0, `${withBothEnds.length}/${connectors.length}`);
check(
  '§1 connector DOM keys match the canvas key shape',
  withBothEnds.every(c => /^[a-z]+-\d+-w-\d+$/.test(c.dibburDomKey ?? '') && /^[a-z]+-\d+-w-\d+$/.test(c.targetDomKey ?? '')),
  withBothEnds[0]?.dibburDomKey ?? ''
);
check('§1 confidence colours', anchorConnectorColor(0.95, 'exact') === '#2F6B3A' && anchorConnectorColor(0.85, 'fuzzy') === '#1D5FA8' && anchorConnectorColor(0.6, 'fuzzy') === '#B8741A' && anchorConnectorColor(0, 'unmatched') === '#9B2C2C');
const pathD = buildConnectorPath(100, 50, 300, 200);
check('§1 connector path is a real curve between the two points', pathD.startsWith('M 100.0 50.0 C') && pathD.endsWith('300.0 200.0'), pathD);
check('§1 wordIndexAtCharOffset', wordIndexAtCharOffset('אבג דהו זחט', 5) === 1 && wordIndexAtCharOffset('אבג דהו זחט', 0) === 0);

// §2 — click-to-re-anchor (pure).
const relinked = reAnchorLink(anchorLinks, 'r-0-0', 'src-0-5', 12, 'מאימתי קורין');
const relinkedEntry = relinked.find(l => l.commentaryUnitId === 'r-0-0');
check(
  '§2 re-anchor replaces the link (exact, confidence 1.0)',
  relinkedEntry?.targetMainNodeId === 'src-0-5' && relinkedEntry?.targetCharOffset === 12 && relinkedEntry?.linkConfidence === 1 && relinkedEntry?.method === 'exact',
  JSON.stringify(relinkedEntry)
);
check('§2 re-anchor keeps every other link', relinked.length === anchorLinks.length);
const before = anchorLinks.find(l => l.commentaryUnitId === 'r-0-0');
check('§2 input links untouched', before?.targetMainNodeId !== 'src-0-5' || before?.targetCharOffset !== 12);
const unitsAfterReanchor = applyReAnchorToUnits(units, relinkedEntry as AnchorLink);
const reanchoredUnit = unitsAfterReanchor.find(u => u.id === 'r-0-0');
const reanchoredSource = unitsAfterReanchor.find(u => u.id === 'src-0-5');
check('§2 commentary unit carries the new anchorLink', reanchoredUnit?.anchorLink?.targetMainNodeId === 'src-0-5');
check('§2 source unit gains the commentary for same-page gravity', (reanchoredSource?.anchoredCommentaryIds ?? []).includes('r-0-0'));
check('§2 input units untouched', units.find(u => u.id === 'r-0-0')?.anchorLink?.targetMainNodeId !== 'src-0-5');
const mergedRav = mergeLinkSets(anchorLinksToRavTextLinks([relinkedEntry as AnchorLink], units), anchorLinksToRavTextLinks(anchorLinks, units));
const mergedEntry = mergedRav.find(l => l.commentaryUnitId === 'r-0-0');
check('§2 merged RavTextLink follows the re-anchor', mergedEntry?.sourceUnitId === 'src-0-5' && (mergedEntry?.confidenceScore ?? 0) >= 0.99);

// §3 — push / pull.
const countLines = (p: PageTypesetResult) =>
  (p.sourceLines?.length ?? 0) + (p.rashiLines?.length ?? 0) + (p.tosafotLines?.length ?? 0) +
  (p.column2Lines?.length ?? 0) + (p.footnoteLines?.length ?? 0) + (p.sideNoteLines?.length ?? 0);
const streamKeys = ['sourceLines', 'rashiLines', 'tosafotLines', 'column2Lines', 'footnoteLines', 'sideNoteLines'] as const;
let lastLine: TypesetLine | null = null;
let lastStream = '';
for (const key of streamKeys) {
  const lines = page0[key];
  if (lines && lines.length > 0) {
    lastLine = lines[lines.length - 1];
    lastStream = key;
  }
}
const pushWordIndex = lastLine
  ? unitGlobalWordIndexAcrossPages(doc.pages, 0, lastLine.unitId, lastStream, lastLine.lineIndex, 0)
  : null;
check('§3 push anchor word index resolves', pushWordIndex !== null, `word ${pushWordIndex}`);
if (pushWordIndex !== null && lastLine) {
  const anchor = findBreakAnchor(doc.pages, lastLine.unitId, pushWordIndex);
  check('§3 push anchor resolves to page 1 (not the unit start)', anchor?.pageIndex === 0, `page ${anchor?.pageIndex}`);
  const before0 = countLines(page0);
  const before1 = countLines(page1);
  const pushInstr = createBreakInstruction(lastLine.unitId, 'oneLineLess', { wordIndex: pushWordIndex });
  const pushed = applyBreakInstructions(doc.pages, [pushInstr], units);
  check('§3 oneLineLess applies', pushed.report.instructionsApplied === 1, JSON.stringify(pushed.report));
  check(
    '§3 push moves exactly one line to the next page',
    countLines(pushed.pages[0]) === before0 - 1 && countLines(pushed.pages[1]) === before1 + 1,
    `${before0}→${countLines(pushed.pages[0])} lines, next ${before1}→${countLines(pushed.pages[1])}`
  );
  check('§3 push moved the right line', pushed.report.moved[0]?.lineCount === 1 && pushed.report.moved[0]?.fromPageIndex === 0);
  // Pull on the real (full) book must be refused, not silently undone.
  let nextFirst: TypesetLine | null = null;
  let nextStream = '';
  for (const key of streamKeys) {
    const lines = page1[key];
    if (lines && lines.length > 0) {
      nextFirst = lines[0];
      nextStream = key;
      break;
    }
  }
  if (nextFirst) {
    const pullWordIndex = unitGlobalWordIndexAcrossPages(doc.pages, 1, nextFirst.unitId, nextStream, nextFirst.lineIndex, 0);
    const pullInstr = createBreakInstruction(nextFirst.unitId, 'oneLineMore', { wordIndex: pullWordIndex ?? 0 });
    const pulled = applyBreakInstructions(doc.pages, [pullInstr], units);
    check(
      '§3 pull on a full page is refused with a warning',
      pulled.report.instructionsApplied === 0 && pulled.report.instructionsSkipped === 1,
      pulled.report.warnings[0] ?? ''
    );
  }
}
// Pull with room: hand-built two-page doc, page 1 mostly empty.
function synthLine(lineIndex: number, unitId: string, yTop: number, height = 16): TypesetLine {
  return {
    lineIndex,
    words: [{ text: 'מילה', glyphs: [], width: 20, isSpace: false, unitId }],
    width: 20,
    targetWidth: 200,
    xStart: 0,
    xLeft: 0,
    xRight: 200,
    yBaseline: yTop + 12,
    yTop,
    yBottom: yTop + height,
    height,
    ascent: 12,
    descent: 4,
    isLastLine: false,
    isJustified: false,
    extraSpacePerWord: 0,
    role: 'main_source',
    unitId,
  };
}
function synthPage(pageIndex: number, lines: TypesetLine[]): PageTypesetResult {
  return {
    pageIndex,
    pageNumber: pageIndex + 1,
    pageNumberHebrew: String(pageIndex + 1),
    headerTitle: '',
    layoutType: 'single_column',
    geometry: GEOMETRY,
    sourceLines: lines,
    rashiLines: [],
    tosafotLines: [],
    footnoteLines: [],
    knee: {
      pageContentWidth: 394,
      pageContentHeight: CONTENT_HEIGHT,
      topY: 0,
      kneeJunctionY: CONTENT_HEIGHT,
      bottomY: CONTENT_HEIGHT,
      upperSourceWidth: 394,
      lowerSourceWidth: 394,
      innerXOffset: 0,
      isLeftStepped: false,
      rightCommentaryWidth: 0,
      leftCommentaryWidth: 0,
      gutterWidth: 0,
    },
  };
}
const roomyPages = [
  synthPage(0, [synthLine(0, 'u-a', 0), synthLine(1, 'u-a', 16)]),
  synthPage(1, [synthLine(0, 'u-b', 0), synthLine(1, 'u-b', 16)]),
];
const pullInstr2 = createBreakInstruction('u-b', 'oneLineMore', { wordIndex: 0 });
const pulledRoomy = applyBreakInstructions(roomyPages, [pullInstr2], [
  unit('u-a', 'main_source', 'מילה מילה'),
  unit('u-b', 'main_source', 'מילה מילה'),
]);
check('§3 pull with room applies', pulledRoomy.report.instructionsApplied === 1, JSON.stringify(pulledRoomy.report));
check(
  '§3 pull moves the next page first line onto this page',
  pulledRoomy.pages[0].sourceLines.length === 3 && pulledRoomy.pages[1].sourceLines.length === 1,
  `p1 ${pulledRoomy.pages[0].sourceLines.length} lines, p2 ${pulledRoomy.pages[1].sourceLines.length}`
);
check('§3 pull creates no blank trailing page', pulledRoomy.pages.length === 2 && pulledRoomy.report.pagesCreated === 0, `${pulledRoomy.pages.length} pages`);
check(
  '§3 pulled line restacks below the existing lines',
  (pulledRoomy.pages[0].sourceLines[2].yBaseline ?? 0) > (pulledRoomy.pages[0].sourceLines[1].yBaseline ?? 0),
  `y ${pulledRoomy.pages[0].sourceLines[1].yBaseline} → ${pulledRoomy.pages[0].sourceLines[2].yBaseline}`
);

// §4 — Quick-Tune settings.
const fresh = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
check('§4 settled default: running header OFF', fresh.pageElements.showTopHeaderLine === false);
check('§4 settled default: folio OFF', fresh.pageElements.showFolioNumber === false);
check('§4 settled default: commentary labels OFF', fresh.pageElements.showCommentaryLabels === false);
check('§4 header divider rule defaults ON', fresh.pageElements.showHeaderDividerRule === true);
check('§4 mirror margins defaults ON', fresh.pageLayout.mirrorMargins === true);
const trim6x9 = DesignSettingsEngine.updatePageLayout(
  fresh,
  { pageSizePreset: 'trim_6x9', pageWidthPt: 432, pageHeightPt: 648 },
  'user'
).settings;
check('§4 trim 6×9 lands in the geometry', trim6x9.pageLayout.geometry.pageWidth === 432 && trim6x9.pageLayout.geometry.pageHeight === 648, `${trim6x9.pageLayout.geometry.pageWidth}×${trim6x9.pageLayout.geometry.pageHeight}`);
check('§4 PAGE_SIZE_DIMENSIONS has all Quick-Tune trims', PAGE_SIZE_DIMENSIONS.trim_6x9?.widthPt === 432 && PAGE_SIZE_DIMENSIONS.trim_7x10?.widthPt === 504 && PAGE_SIZE_DIMENSIONS.trim_letter?.widthPt === 612 && PAGE_SIZE_DIMENSIONS.vilna_folio?.widthPt === 510);
const trimLetter = DesignSettingsEngine.updatePageLayout(
  fresh,
  { pageSizePreset: 'trim_letter', pageWidthPt: 612, pageHeightPt: 792 },
  'user'
).settings;
check('§4 trim 8.5×11 lands in the geometry', trimLetter.pageLayout.geometry.pageWidth === 612 && trimLetter.pageLayout.geometry.pageHeight === 792);
const noMirror = DesignSettingsEngine.updatePageLayout(fresh, { mirrorMargins: false }, 'user').settings;
check(
  '§4 mirror OFF: both side margins equal the inside margin',
  noMirror.pageLayout.geometry.marginOutside === noMirror.pageLayout.geometry.marginInside,
  `inside ${noMirror.pageLayout.geometry.marginInside}, outside ${noMirror.pageLayout.geometry.marginOutside}`
);
const mirrorBack = DesignSettingsEngine.updatePageLayout(noMirror, { mirrorMargins: true }, 'user').settings;
check(
  '§4 mirror ON restores the distinct outside margin',
  mirrorBack.pageLayout.geometry.marginOutside === fresh.pageLayout.marginOutsidePt,
  `outside ${mirrorBack.pageLayout.geometry.marginOutside}`
);
// Recto/verso (right/left-page) header text.
const withSideTexts = DesignSettingsEngine.updatePageElementsSettings(
  fresh,
  { runningHeader: { rightPageText: 'מסכת ברכות', leftPageText: 'פרק א · דף ב׳' } },
  'user'
);
const rhRight = resolveRunningHeader(
  withSideTexts.pageElements,
  { bookTitle: 'ספר', folioLabel: 'דף ב׳', editionLabel: 'מהדורה' },
  1,
  true,
  'right'
);
const rhLeft = resolveRunningHeader(
  withSideTexts.pageElements,
  { bookTitle: 'ספר', folioLabel: 'דף ב׳', editionLabel: 'מהדורה' },
  0,
  true,
  'left'
);
const rhPlain = resolveRunningHeader(
  withSideTexts.pageElements,
  { bookTitle: 'ספר', folioLabel: 'דף ב׳', editionLabel: 'מהדורה' },
  0,
  true
);
check('§4 right-hand page shows the Masechta title', rhRight.center.text === 'מסכת ברכות', rhRight.center.text);
check('§4 left-hand page shows Perek / Daf', rhLeft.center.text === 'פרק א · דף ב׳', rhLeft.center.text);
check('§4 no side given: old centre text behaviour', rhPlain.center.text === 'ספר', rhPlain.center.text);
const noDivider = DesignSettingsEngine.updatePageElementsSettings(
  fresh,
  { showHeaderDividerRule: false },
  'user'
);
check('§4 divider rule can be switched off', noDivider.pageElements.showHeaderDividerRule === false);

// §5 — zone typography writers (the Quick-Tune writers).
const zoneFont = applyCharacterStyleChange(fresh, { role: 'primary_comment' }, { fontFamily: 'David Libre', fontSizePt: 11 });
const zoneResolved = DesignSettingsEngine.resolveRoleAndUnitStyle(zoneFont, 'primary_comment');
check('§5 zone font + size land on the role', zoneResolved.character.fontFamily === 'David Libre' && zoneResolved.character.fontSizePt === 11);
const zoneLeading = applyParagraphStyleChange(zoneFont, { role: 'primary_comment' }, { lineSpacingRatio: 1.45, leadingPt: 15.95 });
const zoneLeadingResolved = DesignSettingsEngine.resolveRoleAndUnitStyle(zoneLeading, 'primary_comment');
check('§5 zone line spacing lands on the role', zoneLeadingResolved.paragraph.lineSpacingRatio === 1.45);
const dibburBold = applyCharacterStyleChange(fresh, { role: 'dibbur_hamatchil' }, { isBold: true, fontSizePt: 13 });
const dibburResolved = DesignSettingsEngine.resolveRoleAndUnitStyle(dibburBold, 'dibbur_hamatchil');
check('§5 dibbur bold + size land on the role', dibburResolved.character.isBold === true && dibburResolved.character.fontSizePt === 13);

// §6 — bilingual i18n.
const NEW_KEYS = [
  'קישורי ד״ה',
  'הצג קישורי דיבור המתחיל על העמוד',
  'לחצו על דיבור המתחיל, ואחר כך על הביטוי במקור, כדי לקשר מחדש',
  'בחרו ביטוי במקור כדי לקשר את הדיבור',
  'הקישור עודכן — הדיבור מקושר כעת לביטוי שבחרתם',
  'הביטוי שנבחר אינו במקור — לחצו על מילה בטקסט הראשי',
  'ביטול קישור מחדש',
  'קישור מחדש בוטל',
  'קישור לא מאומת',
  'כוונון מהיר',
  'גודל דף, שוליים, גופנים וכותרת רצה — הכול במקום אחד.',
  'גאומטריית עמוד',
  'גודל דף:',
  'שוליים ממורכזים',
  'שוליים פנימיים וחיצוניים נפרדים; כבוי = שני הצדדים שווים לשוליים הפנימיים.',
  'טיפוגרפיה לפי אזור',
  'גודל (pt):',
  'מרווח שורות:',
  'הצג כותרת רצה בראש העמוד',
  'כותרת בעמוד הימני',
  'כותרת בעמוד השמאלי',
  'ריק = כותרת הספר; פרק / דף / פרשה בעמוד השמאלי.',
  'קו מפריד מתחת לכותרת',
  'דחוף שורה לעמוד הבא',
  'משוך שורה לעמוד זה',
  'דחוף את השורה האחרונה של העמוד לעמוד הבא',
  'משוך את השורה הראשונה של העמוד הבא לעמוד זה',
  'השורה נדחפה לעמוד הבא',
  'השורה נמשכה לעמוד זה',
  'אין מקום לשורה נוספת בעמוד זה',
  'אין עמוד הבא',
  'העמוד ריק',
  'הייצוא נבדק מול העמוד שעל המסך',
];
const missingKeys = NEW_KEYS.filter(k => !EN_STRINGS[k] || EN_STRINGS[k].trim().length === 0);
check('§6 every new key exists in EN_STRINGS', missingKeys.length === 0, missingKeys.join(', ') || `${NEW_KEYS.length} keys`);
check(
  '§6 Quick-Tune trim table exhaustive + translated',
  (Object.keys(QUICK_TUNE_TRIM_LABELS) as string[]).length === 4 &&
    Object.values(QUICK_TUNE_TRIM_LABELS).every(v => v.he && v.en && v.he !== v.en)
);
check(
  '§6 Quick-Tune zone table exhaustive + translated',
  (Object.keys(QUICK_TUNE_ZONE_LABELS) as string[]).length === 4 &&
    Object.values(QUICK_TUNE_ZONE_LABELS).every(v => v.he && v.en && v.he !== v.en)
);

// §7 — secondary import wiring (source check; linker behaviour: Phase 3 smoke).
const secondarySrc = fs.readFileSync(path.join(ROOT, 'src/engine/secondary-docx-import.ts'), 'utf8');
check('§7 secondary import calls the new linker', secondarySrc.includes('linkCommentariesToSource('));
check('§7 secondary import merges + stamps anchorLink', secondarySrc.includes('mergeLinkSets(') && secondarySrc.includes('u.anchorLink = a'));

// §8 — version.
check('§8 version is 0.9.8', pkg.version === '0.9.8', pkg.version);

console.log(`\nv098-phase5-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
