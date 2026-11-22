/**
 * KETER-TYPE v0.6.0 — Part B smoke suite (§3 block highlight, §4 margins +
 * genuine Auto-Center, §7 drag-to-split end-to-end).
 *
 * Run: `npx tsx scripts/partB-smoke.ts` (from the partB tree root).
 * Exits non-zero on any failure. Pure-engine checks only: the pointer-event
 * wiring in PageCanvas (pointerdown → finishSplitDrag → onPageSplitRequest)
 * and the live-browser rendering still need one manual click-through, which
 * is stated honestly in MANIFEST-partB.md — the smoke covers everything
 * below that seam (resolver, anchor, registration, reflow, persistence).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyBreakInstructions,
  createBreakInstruction,
  findBreakAnchor,
  resolveSplitCandidateLine,
  toHebrewGematria,
} from '../src/engine/break-instructions';
import {
  blockInfoForUnit,
  lineBlockRectPx,
  unionBlockBoxPx,
} from '../src/engine/block-highlight';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { UndoRedoHistoryManager } from '../src/engine/project-persistence';
import type {
  BookLayoutType,
  ContentUnit,
  DynamicKneeContour,
  PageGeometry,
  PageTypesetResult,
  ShapedWord,
  TypesetLine,
} from '../src/types/typesetter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function near(a: number, b: number, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

// ── Synthetic page fixtures ──────────────────────────────────────────────
const GEOMETRY: PageGeometry = {
  pageWidth: 482,
  pageHeight: 680,
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};
const CONTENT_W = GEOMETRY.pageWidth - GEOMETRY.marginInside - GEOMETRY.marginOutside; // 394
const CONTENT_H = GEOMETRY.pageHeight - GEOMETRY.marginTop - GEOMETRY.marginBottom; // 584
const KNEE: DynamicKneeContour = {
  pageContentWidth: CONTENT_W,
  pageContentHeight: CONTENT_H,
  topY: 0,
  kneeJunctionY: CONTENT_H,
  bottomY: CONTENT_H,
  upperSourceWidth: CONTENT_W,
  lowerSourceWidth: CONTENT_W,
  innerXOffset: 0,
  isLeftStepped: false,
  rightCommentaryWidth: 60,
  leftCommentaryWidth: 60,
  gutterWidth: 12,
};

function mkWord(text: string, unitId: string): ShapedWord {
  return { text, glyphs: [], width: 10, isSpace: false, unitId };
}

function mkLine(
  unitId: string,
  lineIndex: number,
  yBaseline: number,
  wordCount: number,
  opts: Partial<TypesetLine> = {}
): TypesetLine {
  const words: ShapedWord[] = [];
  for (let i = 0; i < wordCount; i++) words.push(mkWord(`w${lineIndex}-${i}`, unitId));
  return {
    lineIndex,
    words,
    width: 300,
    targetWidth: 300,
    xStart: 0,
    yBaseline,
    height: 18,
    ascent: 12,
    descent: 6,
    isLastLine: false,
    isJustified: true,
    extraSpacePerWord: 0,
    role: 'main_source',
    unitId,
    ...opts,
  };
}

function mkPage(
  pageIndex: number,
  streams: Partial<Pick<PageTypesetResult, 'sourceLines' | 'rashiLines' | 'tosafotLines' | 'footnoteLines' | 'column2Lines' | 'sideNoteLines'>> = {},
  layoutType: BookLayoutType = 'single_column'
): PageTypesetResult {
  return {
    pageIndex,
    pageNumber: pageIndex + 1,
    pageNumberHebrew: toHebrewGematria(pageIndex + 1),
    headerTitle: 'Test',
    layoutType,
    geometry: GEOMETRY,
    sourceLines: streams.sourceLines ?? [],
    rashiLines: streams.rashiLines ?? [],
    tosafotLines: streams.tosafotLines ?? [],
    footnoteLines: streams.footnoteLines ?? [],
    column2Lines: streams.column2Lines,
    sideNoteLines: streams.sideNoteLines,
    knee: KNEE,
  };
}

function mkUnit(id: string, role: ContentUnit['role'] = 'main_source'): ContentUnit {
  return { id, role, rawText: 'test test test' } as ContentUnit;
}

function allLines(page: PageTypesetResult): TypesetLine[] {
  return [
    ...page.sourceLines,
    ...page.rashiLines,
    ...page.tosafotLines,
    ...(page.column2Lines ?? []),
    ...page.footnoteLines,
    ...(page.sideNoteLines ?? []),
  ];
}

// ══ §3 — Unified block highlight ════════════════════════════════════════
console.log('\n§3 — unified block highlight');
{
  // A 3-line RTL Gemara unit in rav_text: lines narrow after the knee
  // (different target widths), one with a right indent.
  const lines = [
    mkLine('gemara-1', 0, 30, 8, { role: 'main_source', targetWidth: 200, xStart: 0 }),
    mkLine('gemara-1', 1, 48, 7, { role: 'main_source', targetWidth: 200, xStart: 0 }),
    mkLine('gemara-1', 2, 66, 6, { role: 'main_source', targetWidth: 280, xStart: 0, rightIndentPt: 10, isLastLine: true }),
  ];
  const box = unionBlockBoxPx(lines, GEOMETRY, KNEE, 'rav_text', 1.25);
  check('§3.1 one union box for a 3-line RTL block (not null)', box !== null);
  if (box) {
    const rects = lines.map(l => lineBlockRectPx(l, GEOMETRY, KNEE, 'rav_text', 1.25));
    check('§3.2 box top = first line top', near(box.topPx, Math.min(...rects.map(r => r.topPx))));
    check('§3.3 box bottom = last line bottom', near(box.bottomPx, Math.max(...rects.map(r => r.bottomPx))));
    check('§3.4 box right = narrowest right edge', near(box.rightPx, Math.min(...rects.map(r => r.rightPx))));
    check(
      '§3.5 box covers every line rect (no line sticks out)',
      rects.every(r => r.topPx >= box.topPx - 0.01 && r.bottomPx <= box.bottomPx + 0.01 && r.rightPx >= box.rightPx - 0.01 && r.rightPx + r.widthPx <= box.rightPx + box.widthPx + 0.01)
    );
    check('§3.6 box is wider than any single line (it unions, not picks)', box.widthPx >= Math.max(...rects.map(r => r.widthPx)));
  }
  // A Rashi commentary tier: lines live in the right commentary column.
  const rashiLines = [
    mkLine('rashi-1', 0, 30, 5, { role: 'primary_comment', targetWidth: 60, xStart: 0 }),
    mkLine('rashi-1', 1, 48, 5, { role: 'primary_comment', targetWidth: 60, xStart: 0, isLastLine: true }),
  ];
  const rBox = unionBlockBoxPx(rashiLines, GEOMETRY, KNEE, 'rav_text', 1.25);
  check('§3.7 one union box for a Rashi tier block', rBox !== null && rBox.bottomPx > rBox.topPx && rBox.widthPx > 0);
  // Metadata handed to the state manager / inspector.
  const info = blockInfoForUnit('gemara-1', lines, [mkUnit('gemara-1', 'main_source')], GEOMETRY, KNEE, 'rav_text', 1.25);
  check('§3.8 block info carries unitId + role + lineCount', info !== null && info.unitId === 'gemara-1' && info.role === 'main_source' && info.lineCount === 3);
  check('§3.9 block info first/last line indices', info !== null && info.firstLineIndex === 0 && info.lastLineIndex === 2);
  check('§3.10 block info box is in content-area points', info !== null && info.topPt >= 0 && info.bottomPt > info.topPt && info.leftPt < info.rightPt);
  check('§3.11 empty unit → no box', unionBlockBoxPx([], GEOMETRY, KNEE, 'rav_text', 1.25) === null);

  // Static render-path check: no per-word / per-line boxing survives.
  const canvasSrc = fs.readFileSync(path.join(ROOT, 'src/components/PageCanvas.tsx'), 'utf-8');
  check('§3.12 no per-word link-hover box in PageCanvas', !canvasSrc.includes('isLinkedHover'));
  check('§3.13 no per-line selected-unit ring in PageCanvas', !canvasSrc.includes("bg-[#344A67]/[0.06] ring-1") && !canvasSrc.includes("bg-[#344A67]/[0.045] ring-1"));
  check('§3.14 one outline renderer with hover/selected/link kinds', canvasSrc.includes('block-outline-') && canvasSrc.includes("'link'"));
  check('§3.15 overlay has smooth transitions', canvasSrc.includes('transition-all duration-150'));
  check('§3.16 in-place text-range selection kept (caret selection, not section boxing)', canvasSrc.includes('selectionRectsPx'));
}

// ══ §4 — Margins, spacing, genuine Auto-Center ═════════════════════════
console.log('\n§4 — margins / spacing / Auto-Center');
{
  check('§4.1 72pt = 1in', near(DesignSettingsEngine.ptToMarginUnit(72, 'in'), 1));
  check('§4.2 1in = 72pt', near(DesignSettingsEngine.marginUnitToPt(1, 'in'), 72));
  check('§4.3 72pt = 25.4mm', near(DesignSettingsEngine.ptToMarginUnit(72, 'mm'), 25.4));
  check('§4.4 25.4mm = 72pt', near(DesignSettingsEngine.marginUnitToPt(25.4, 'mm'), 72, 0.05));
  check('§4.5 10mm = 28.35pt', near(DesignSettingsEngine.marginUnitToPt(10, 'mm'), 28.35, 0.01));
  check('§4.6 pt round-trips through mm', near(DesignSettingsEngine.marginUnitToPt(DesignSettingsEngine.ptToMarginUnit(36, 'mm'), 'mm'), 36, 0.05));
  check('§4.7 pt round-trips through in', near(DesignSettingsEngine.marginUnitToPt(DesignSettingsEngine.ptToMarginUnit(36, 'in'), 'in'), 36, 0.05));
  check('§4.8 non-finite input → 0, never NaN', DesignSettingsEngine.marginUnitToPt(NaN, 'mm') === 0 && DesignSettingsEngine.ptToMarginUnit(NaN, 'in') === 0);

  // Genuine centring math: 200pt block in a 600pt frame, indents 10/30.
  const c = DesignSettingsEngine.computeBlockCentering(200, 600, 10, 30);
  check('§4.9 equal side margins (average of current)', c.marginLeftPt === 20 && c.marginRightPt === 20);
  check('§4.10 vertical offset = half the free space', c.spaceBeforePt === 200 && c.spaceAfterPt === 200 && c.verticalOffsetPt === 200);
  check('§4.11 fitsVertically true when the block fits', c.fitsVertically === true);
  const c2 = DesignSettingsEngine.computeBlockCentering(700, 600, 0, 0);
  check('§4.12 block taller than the frame → does not fit, offset 0', c2.fitsVertically === false && c2.verticalOffsetPt === 0);

  // End-to-end through the settings engine on real defaults.
  const settings = DesignSettingsEngine.createDefaultSettings();
  const centred = DesignSettingsEngine.autoCenterBlockOnPage(settings, {
    unitId: 'u1',
    blockHeightPt: 200,
    contentHeightPt: CONTENT_H,
  });
  const local = centred.settings.localUnitOverrides?.['u1'];
  check('§4.13 autoCenterBlockOnPage reports fitsVertically', centred.fitsVertically === true);
  check('§4.14 offset = (584-200)/2 = 192pt', centred.verticalOffsetPt === 192);
  check(
    '§4.15 local override: equal indents + equal space above/below',
    local?.paragraph?.spaceBeforePt === 192 &&
      local?.paragraph?.spaceAfterPt === 192 &&
      local?.paragraph?.leftIndentPt === local?.paragraph?.rightIndentPt
  );
  check('§4.16 blockSpacing records autoCentered', centred.settings.blockSpacing?.autoCentered === true);
  const tooTall = DesignSettingsEngine.autoCenterBlockOnPage(settings, {
    unitId: 'u1',
    blockHeightPt: 900,
    contentHeightPt: CONTENT_H,
  });
  check('§4.17 too-tall block: horizontal only, fitsVertically false', tooTall.fitsVertically === false && tooTall.settings.blockSpacing?.autoCentered === true);

  // In-flow centring (role-level, AI/local-parser path) is unchanged.
  const flow = DesignSettingsEngine.autoCenterBlock(settings, { role: 'main_source' }, 'user');
  check(
    '§4.18 in-flow autoCenterBlock still equalises indents + spacing',
    flow.blockSpacing !== undefined &&
      flow.blockSpacing.marginLeftPt === flow.blockSpacing.marginRightPt &&
      flow.blockSpacing.spaceBeforePt === flow.blockSpacing.spaceAfterPt
  );
  const spaced = DesignSettingsEngine.updateBlockSpacing(settings, { marginLeftPt: 10, marginRightPt: 12 }, { role: 'main_source' }, 'user');
  check('§4.19 updateBlockSpacing writes indents through', spaced.blockSpacing?.marginLeftPt === 10 && spaced.blockSpacing?.marginRightPt === 12);
  check('§4.20 manual edit clears autoCentered', spaced.blockSpacing?.autoCentered === false);

  // The sanitizer's 48pt cap still holds for ordinary edits — only the
  // genuine Auto-Center path opts out of it.
  const capped = DesignSettingsEngine.updateBlockSpacing(settings, { spaceBeforePt: 200 }, { role: 'main_source' }, 'user');
  check('§4.26 ordinary spacing edit is still clamped to 48pt', capped.blockSpacing?.spaceBeforePt === 48);
  const recentred = DesignSettingsEngine.updateBlockSpacing(centred.settings, { marginLeftPt: 5 }, { unitId: 'u1' }, 'user');
  check(
    '§4.27 a manual edit after centring clears autoCentered and re-clamps the offset',
    recentred.blockSpacing?.autoCentered === false && (recentred.blockSpacing?.spaceBeforePt ?? 999) <= 48
  );

  // The panel actually offers the unit selector + sliders (static check).
  const panelSrc = fs.readFileSync(path.join(ROOT, 'src/components/DesignTypesettingPanel.tsx'), 'utf-8');
  check('§4.21 panel has pt/mm/in selector', panelSrc.includes("(['pt', 'mm', 'in'] as MarginUnit[])"));
  check('§4.22 panel has left/right margin sliders', panelSrc.includes('שוליים מימין:') && panelSrc.includes('שוליים משמאל:'));
  check('§4.23 panel has page-frame margin sliders', panelSrc.includes("'marginTopPt' | 'marginBottomPt' | 'marginInsidePt' | 'marginOutsidePt'"));
  check('§4.24 panel warns rav_text spacing only applies at page top', panelSrc.includes('בעימוד רב־טקסט'));
  check('§4.25 genuine Auto-Center button wired to App handler', panelSrc.includes('onAutoCenterBlockGenuine'));
}

// ══ §7 — Drag-to-split end-to-end ═══════════════════════════════════════
console.log('\n§7 — drag-to-split');
{
  // Resolver: 7 lines, 18pt tall, baselines 30..138 (ascent 12/descent 6).
  const unitLines = Array.from({ length: 7 }, (_, i) =>
    mkLine('u-split', i, 30 + i * 18, 8, { isLastLine: i === 6 })
  );
  const scale = 1.25;
  // Pointer at 75% of the block's height: yBaseline 30 + 0.75 * (7*18) ≈ 124 → line 6 (baseline 138? no:
  // line bottoms are baseline+6: 36,54,72,90,108,126,144. Pointer at 75% of the block ≈ top 18 + 94 = 112 → first bottom >= 112 is 126 → line 5.
  const at75 = resolveSplitCandidateLine(unitLines, (18 + 0.75 * 7 * 18) * scale, scale);
  check('§7.1 pointer at 75% selects the line under the pointer', at75 !== null && at75.lineIndex === 5, at75 ? `got line ${at75.lineIndex}` : 'got null');
  const bottomGrab = resolveSplitCandidateLine(unitLines, (138 + 6 - 1) * scale, scale);
  check('§7.2 bottom-edge grab selects the last line', bottomGrab !== null && bottomGrab.lineIndex === 6);
  const pastEnd = resolveSplitCandidateLine(unitLines, (138 + 6 + 30) * scale, scale);
  check('§7.3 pointer past the last line → null (cancel)', pastEnd === null);
  const nearTop = resolveSplitCandidateLine(unitLines, (18 + 2) * scale, scale);
  check('§7.4 pointer near the top → line 0', nearTop !== null && nearTop.lineIndex === 0);

  // Two-page book; unit U spans both pages (20 words p1, 20 words p2).
  const unitU = mkUnit('U', 'main_source');
  const unitV = mkUnit('V', 'main_source');
  const p1Lines = [
    mkLine('U', 0, 12, 10),
    mkLine('U', 1, 30, 10),
    mkLine('V', 0, 48, 8, { isLastLine: true }),
  ];
  const p2Lines = [
    mkLine('U', 2, 12, 10),
    mkLine('U', 3, 30, 10, { isLastLine: true }),
    mkLine('V', 1, 48, 8, { isLastLine: true }),
  ];
  const book = [mkPage(0, { sourceLines: p1Lines }), mkPage(1, { sourceLines: p2Lines })];
  const anchor = findBreakAnchor(book, 'U', 25);
  check(
    '§7.5 unit-global anchor: word 25 of multi-page unit found on page 2',
    anchor !== null && anchor.pageIndex === 1 && anchor.line.lineIndex === 2,
    anchor ? `page ${anchor.pageIndex} line ${anchor.line.lineIndex}` : 'not found'
  );
  const anchor0 = findBreakAnchor(book, 'U', 5);
  check('§7.6 word 5 found on page 1', anchor0 !== null && anchor0.pageIndex === 0 && anchor0.line.lineIndex === 0);
  check('§7.7 missing unit → null (never a wrong break)', findBreakAnchor(book, 'NOPE', 0) === null);
  check('§7.8 word past the end → null', findBreakAnchor(book, 'U', 100) === null);

  // Split page 1 at V line 0. The anchor word index is UNIT-global for V:
  // V line 0's first word is V's word 0 (V has 8 words on page 1, 8 on
  // page 2 — word 20 would not exist for V at all).
  const splitInstr = createBreakInstruction('V', 'pageEndsBefore', { wordIndex: 0, note: 'drag' });
  const split = applyBreakInstructions(book, [splitInstr], [unitU, unitV]);
  check('§7.9 split instruction applied (not skipped)', split.report.instructionsApplied === 1 && split.report.instructionsSkipped === 0);
  check('§7.10 page 1 keeps U lines only', split.pages[0].sourceLines.every(l => l.unitId === 'U') && split.pages[0].sourceLines.length === 2);
  check('§7.11 page 2 starts with V line 0', split.pages[1].sourceLines[0]?.unitId === 'V' && split.pages[1].sourceLines[0]?.lineIndex === 0);
  check('§7.12 no lines lost or duplicated', allLines(split.pages[0]).length + allLines(split.pages[1]).length === 6);
  // Reflow: moved lines restacked from the stream top, in order, no overlap.
  const moved = split.pages[1].sourceLines;
  const tops = moved.map(l => l.yBaseline - l.ascent);
  check('§7.13 moved lines start at the top of the next page', near(tops[0], 0));
  check(
    '§7.14 moved lines stacked in order with no overlap',
    moved.every((l, i) => i === 0 || l.yBaseline - l.ascent >= moved[i - 1].yBaseline + moved[i - 1].descent - 0.01)
  );
  check('§7.15 moved lines do not keep stale baselines', moved[0].yBaseline !== 66);

  // Reflow honours spaceBefore — the mechanism genuine Auto-Center relies on.
  const spacedBook = [
    mkPage(0, { sourceLines: [mkLine('A', 0, 12, 8), mkLine('B', 0, 30, 8, { isLastLine: true })] }),
    mkPage(1, { sourceLines: [mkLine('C', 0, 12, 8, { isLastLine: true })] }),
  ];
  const spacedInstr = createBreakInstruction('B', 'pageEndsBefore', { wordIndex: 0 });
  // Give B's first line a 100pt spaceBefore (what Auto-Center writes).
  spacedBook[0].sourceLines[1].spaceBeforePt = 100;
  const spaced = applyBreakInstructions(spacedBook, [spacedInstr], [mkUnit('A'), mkUnit('B'), mkUnit('C')]);
  const bLine = spaced.pages[1].sourceLines.find(l => l.unitId === 'B');
  check(
    '§7.16 reflow honours spaceBefore: moved block starts 100pt down',
    bLine !== undefined && near(bLine.yBaseline - bLine.ascent, 100),
    bLine ? `top=${bLine.yBaseline - bLine.ascent}` : 'B not found'
  );

  // Last-page split creates a new page instead of being skipped.
  const onePage = [mkPage(0, { sourceLines: [mkLine('A', 0, 12, 8), mkLine('B', 0, 30, 8, { isLastLine: true })] })];
  const lastSplit = applyBreakInstructions(onePage, [createBreakInstruction('B', 'pageEndsBefore', { wordIndex: 0 })], [mkUnit('A'), mkUnit('B')]);
  check('§7.17 split on the last page creates a new page', lastSplit.pages.length === 2 && lastSplit.report.pagesCreated === 1);
  check('§7.18 new page holds the moved lines, numbered 2', lastSplit.pages[1].pageNumber === 2 && lastSplit.pages[1].sourceLines.some(l => l.unitId === 'B'));
  check('§7.19 new page folio is Hebrew', lastSplit.pages[1].pageNumberHebrew === 'ב׳');

  // Overflow cascade: a full page 2 receives a big moved tail.
  const fullP2Lines = Array.from({ length: 30 }, (_, i) => mkLine('C', i, 12 + i * 18, 6, { isLastLine: i === 29 }));
  const cascadeBook = [
    mkPage(0, { sourceLines: [mkLine('A', 0, 12, 8), ...Array.from({ length: 10 }, (_, i) => mkLine('B', i, 30 + i * 18, 6, { isLastLine: i === 9 }))] }),
    mkPage(1, { sourceLines: fullP2Lines }),
  ];
  const cascade = applyBreakInstructions(
    cascadeBook,
    [createBreakInstruction('B', 'pageEndsBefore', { wordIndex: 8 })],
    [mkUnit('A'), mkUnit('B'), mkUnit('C')]
  );
  const totalBefore = cascadeBook.reduce((n, p) => n + allLines(p).length, 0);
  const totalAfter = cascade.pages.reduce((n, p) => n + allLines(p).length, 0);
  check('§7.20 cascade preserves every line', totalBefore === totalAfter, `${totalBefore} → ${totalAfter}`);
  const overflowed = cascade.pages.some(p => {
    const ls = p.sourceLines;
    if (ls.length === 0) return false;
    const last = ls[ls.length - 1];
    return last.yBaseline + last.descent > CONTENT_H + 0.01;
  });
  check('§7.21 no page overflows the content area after cascade', !overflowed);
  check('§7.22 cascade created the extra page(s) it needed', cascade.pages.length >= 3);

  // Persistence round-trip through the real snapshot machinery.
  const state = {
    documentTitle: 'Test',
    layoutType: 'single_column' as BookLayoutType,
    geometry: GEOMETRY,
    contentUnits: [unitU, unitV],
    explicitLinks: [],
    kneeSettings: { mode: 'auto' as const, junctionPercent: 50, lowerWidthPercent: 72, gutterWidth: 12, stepDirection: 'auto' as const },
    sourceFontSize: 14.5,
    commentaryFontSize: 10.5,
    selectedFont: 'Frank Ruhl Libre',
    selectedRashiFont: 'Noto Rashi Hebrew',
    selectedTosafotFont: 'Frank Ruhl Libre',
    enableOrnaments: true,
    currentPageIndex: 0,
    projectRules: [],
    localOverrides: [],
    designSettings: DesignSettingsEngine.createDefaultSettings(),
    breakInstructions: [splitInstr],
  };
  const snap = UndoRedoHistoryManager.toProjectSnapshot(state, 'test');
  const snapJson = JSON.parse(JSON.stringify(snap)) as typeof snap;
  const restored = UndoRedoHistoryManager.fromProjectSnapshot(snapJson);
  check(
    '§7.23 break instructions survive toProjectSnapshot → JSON → fromProjectSnapshot',
    Array.isArray(restored.breakInstructions) &&
      restored.breakInstructions.length === 1 &&
      restored.breakInstructions[0].anchorUnitId === 'V' &&
      restored.breakInstructions[0].wordIndex === 0 &&
      restored.breakInstructions[0].kind === 'pageEndsBefore'
  );
  const emptyState = { ...state, breakInstructions: [] as typeof state.breakInstructions };
  const emptyRestored = UndoRedoHistoryManager.fromProjectSnapshot(
    UndoRedoHistoryManager.toProjectSnapshot(emptyState, 'test')
  );
  check('§7.24 projects saved before v0.6.0 load with no breaks', Array.isArray(emptyRestored.breakInstructions) && emptyRestored.breakInstructions.length === 0);
  const cloned = UndoRedoHistoryManager.cloneState(state);
  check('§7.25 undo/redo clone keeps break instructions', cloned.breakInstructions?.length === 1);
  check(
    '§7.26 dirty-check sees a split as a change',
    !UndoRedoHistoryManager.statesAreEqual(state, { ...state, breakInstructions: [] })
  );

  // App wiring (static): the canvas is fed the handler, exports use the
  // displayed pages, and the split toast is honest.
  const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  check('§7.27 App passes onPageSplitRequest to PageCanvas', appSrc.includes('onPageSplitRequest={handlePageSplitRequest}'));
  check('§7.28 exports render displayBookDoc (breaks reach PDF/IDML)', appSrc.includes('generateMultiPagePdf(\n        displayBookDoc,') || appSrc.includes('generateMultiPagePdf(displayBookDoc'));
  check('§7.29 navigator + thumbnails use displayed pages', appSrc.includes('pages={displayPages}'));
  check('§7.30 split handler validates the anchor before claiming success', appSrc.includes('findBreakAnchor(bookDoc.pages, unitId, anchorWordIndex)'));
  check('§7.31 breaks are snapshot state (undoable + autosaved)', appSrc.includes('breakInstructions,') && appSrc.includes('setBreakInstructions(snap.breakInstructions'));
  check('§7.32 balancing runs before breaks (a split cannot be undone by it)', appSrc.includes('wholeBookBalancingPass(bookDoc.pages)') && appSrc.includes('applyBreakInstructions(balanced.pages, breakInstructions, contentUnits)'));
  const canvasSrc = fs.readFileSync(path.join(ROOT, 'src/components/PageCanvas.tsx'), 'utf-8');
  check('§7.33 canvas reports the exact word anchor (not lineIndex * 8)', canvasSrc.includes('pageWordStartIndex + firstWord.wordIndexInUnitSlice'));
  check('§7.34 drag banner shows "Release to insert manual page break at line X"', canvasSrc.includes("שחרר כדי להכניס מעבר עמוד ידני בשורה"));
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
