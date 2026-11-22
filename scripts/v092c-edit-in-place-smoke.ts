/**
 * KETER-TYPE v0.9.2 Part C — "Edit text in place" chain smoke.
 *
 * Run from the repo root:  npx tsx scripts/v092c-edit-in-place-smoke.ts
 *
 * Regression for the user report of 2026-11-11 01:10 EST (running the
 * installed v0.9.1 app): "the edit text in place doesn't work" — the
 * "Edit text in place" button was visible but did nothing.
 *
 * Root cause (reproduced in real Chromium before the fix; see PART-C.md):
 * two compounding faults, both in the activation/focus path — the commit
 * path itself (handleCommitInPlaceUnitEdit → updateContentUnitText →
 * UndoRedoHistoryManager → autosave) was sound, which is why the Story
 * Editor's ContentEditorModal path kept working while this button's path
 * did not.
 *
 *  Fault 1 — focus steal (PageCanvas.tsx, the `editingUnitId` sync
 *  effect): 10ms after the button set `editingUnitId`, the effect focused
 *  the hidden input bridge. The contenteditable overlay (`InlineTextEditor`,
 *  which had just focused itself on mount) blurred, and its `onBlur`
 *  commits + closes the editor — so the editor lived ~10ms and typing
 *  went nowhere (`inPlaceSelection` was null, so the hidden-input
 *  handlers early-returned).
 *  Fault 2 — click retarget (PageCanvas.tsx, page-sheet onClick): a
 *  mousedown on a word opened the editor, the overlay covered the word,
 *  and the ensuing click was retargeted onto the page sheet
 *  (target === currentTarget), whose empty-space handler ran
 *  `exitInPlaceEditing()` + `onSelectUnit(null)` in the very click that
 *  opened the edit — so single-click and double-click editing died
 *  instantly too (the word's onDoubleClick never fired: the dblclick
 *  retargeted to the sheet as well).
 *
 * This script covers the ENGINE half of the chain (the browser half —
 * button click → typing → undo/redo → reload — is covered by
 * scripts/v092c-playwright-smoke.mjs, which is REQUIRED for this item):
 *
 *  §A  the page-slice map + typing: buildUnitPageTextMap for a unit on a
 *      page, then applyInsertText at the end caret (exactly what the
 *      button path does — caret at unitPageText.length) produces the
 *      edited slice.
 *  §B  the commit splice: updateContentUnitText splices the edited page
 *      slice back into a multi-page unit, preserving off-page words,
 *      and a no-change commit is a no-op (the early return in
 *      handleCommitInPlaceUnitEdit).
 *  §C  undo / redo: the edited state is recorded into
 *      UndoRedoHistoryManager with the same label/key/coalesce the App
 *      commit handler uses; undo restores the original text, redo
 *      restores the edit; rapid keystrokes with the same key coalesce
 *      into one undo step.
 *  §D  save / reload round-trip: toProjectSnapshot →
 *      serializeKeterProject → deserializeKeterProject preserves the
 *      edited text.
 *  §E  the fix is present in the sources: the hidden-input focus calls
 *      in PageCanvas are guarded by enableContentEditableEditingRef, the
 *      three empty-space onClick clear sites honour
 *      pointerDownOnTextRef, the overlay commit/cancel exit is guarded
 *      by editingUnitIdRef, and InlineTextEditor commits the previous
 *      unit's pending text on a unit switch.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InPlaceEditEngine } from '../src/engine/in-place-edit-engine';
import {
  ProjectPersistenceEngine,
  UndoRedoHistoryManager,
} from '../src/engine/project-persistence';
import type { ContentUnit } from '../src/types/typesetter';
import type { PageTypesetResult, TypesetLine } from '../src/types/typesetter';
import type { UndoRedoSnapshotState } from '../src/engine/project-persistence';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const UNIT_ID = 'u-edit-smoke-1';
const ORIGINAL = 'אחת שתים שלוש ארבע חמש שש';
const unit: ContentUnit = {
  id: UNIT_ID,
  role: 'main_source',
  rawText: ORIGINAL,
  styleName: 'Normal',
  order: 0,
  hierarchyLevel: 3,
};

function word(text: string): any {
  return { text, glyphs: [], width: 10, isSpace: false, unitId: UNIT_ID, role: 'main_source' };
}
function line(lineIndex: number, texts: string[], yBaseline: number): TypesetLine {
  return {
    lineIndex,
    words: texts.map(word),
    width: 100,
    targetWidth: 100,
    xStart: 0,
    yBaseline,
    height: 14,
    ascent: 11,
    descent: 3,
    isLastLine: false,
    isJustified: false,
    extraSpacePerWord: 0,
    role: 'main_source',
    unitId: UNIT_ID,
  } as TypesetLine;
}
// The unit spans two pages; THIS page shows only words 3-4 (the slice
// the button path edits).
const page = {
  pageIndex: 1,
  pageNumber: 2,
  pageNumberHebrew: 'ב׳',
  headerTitle: '',
  layoutType: 'single_column',
  geometry: {
    pageWidth: 595, pageHeight: 842,
    marginTop: 54, marginBottom: 54, marginInside: 54, marginOutside: 54,
    isVerso: false,
  },
  sourceLines: [line(0, ['שלוש', 'ארבע'], 100)],
  rashiLines: [],
  tosafotLines: [],
  footnoteLines: [],
  knee: {
    pageContentWidth: 487, pageContentHeight: 734, topY: 0,
    kneeJunctionY: 734, bottomY: 734, upperSourceWidth: 487,
    lowerSourceWidth: 487, innerXOffset: 0, isLeftStepped: false,
    rightCommentaryWidth: 0, leftCommentaryWidth: 0, gutterWidth: 0,
  },
} as unknown as PageTypesetResult;

// ---------------------------------------------------------- §A — map + type
console.log('§A — page-slice map + typing at the end caret');
const map = InPlaceEditEngine.buildUnitPageTextMap(page, UNIT_ID, unit);
check('buildUnitPageTextMap finds the unit on this page', !!map);
check('page slice is words 3-4 only', map?.unitPageText === 'שלוש ארבע', `got ${JSON.stringify(map?.unitPageText)}`);
check('pageWordStartIndex is 2 (words 1-2 are off-page)', map?.pageWordStartIndex === 2, `got ${map?.pageWordStartIndex}`);
check('pageWordEndIndexExclusive is 4', map?.pageWordEndIndexExclusive === 4, `got ${map?.pageWordEndIndexExclusive}`);
const caretAtEnd = {
  unitId: UNIT_ID,
  anchorOffset: map!.unitPageText.length,
  focusOffset: map!.unitPageText.length,
};
const typed = InPlaceEditEngine.applyInsertText(map!.unitPageText, caretAtEnd, 'ZZZ');
check('typing at the end caret appends to the slice', typed.nextText === 'שלוש ארבעZZZ', `got ${JSON.stringify(typed.nextText)}`);
check('caret lands after the typed text', typed.nextSelection.focusOffset === 'שלוש ארבעZZZ'.length);

// ---------------------------------------------------------- §B — commit splice
console.log('§B — commit splice into a multi-page unit');
const committed = ProjectPersistenceEngine.updateContentUnitText(
  [unit],
  [],
  UNIT_ID,
  typed.nextText,
  {
    pageWordStartIndex: map!.pageWordStartIndex,
    pageWordEndIndexExclusive: map!.pageWordEndIndexExclusive,
  }
);
check(
  'edited slice splices back with off-page words preserved',
  committed.updatedUnit?.rawText === 'אחת שתים שלוש ארבעZZZ חמש שש',
  `got ${JSON.stringify(committed.updatedUnit?.rawText)}`
);
const noChange = ProjectPersistenceEngine.updateContentUnitText(
  committed.units,
  [],
  UNIT_ID,
  'שלוש ארבעZZZ',
  {
    pageWordStartIndex: map!.pageWordStartIndex,
    pageWordEndIndexExclusive: map!.pageWordEndIndexExclusive,
  }
);
// updateContentUnitText itself always returns the (rebuilt) unit; the
// no-op lives in App's handleCommitInPlaceUnitEdit, which early-returns
// when updatedUnit.rawText === targetUnit.rawText — so the observable
// contract here is that a no-change commit leaves the text identical.
check(
  'a no-change commit leaves the unit text identical (App early-returns on it)',
  noChange.updatedUnit?.rawText === 'אחת שתים שלוש ארבעZZZ חמש שש',
  `got ${JSON.stringify(noChange.updatedUnit?.rawText)}`
);

// ---------------------------------------------------------- §C — undo / redo
console.log('§C — undo / redo history (same label/key/coalesce as App)');
function snapshotState(units: ContentUnit[]): UndoRedoSnapshotState {
  return {
    documentTitle: 'smoke',
    layoutType: 'single_column',
    geometry: page.geometry,
    contentUnits: units,
    explicitLinks: [],
    kneeSettings: {} as any,
    sourceFontSize: 14,
    commentaryFontSize: 10,
    selectedFont: 'Frank Ruhl Libre',
    selectedRashiFont: 'Noto Rashi Hebrew',
    selectedTosafotFont: 'Frank Ruhl Libre',
    enableOrnaments: true,
    currentPageIndex: 0,
  } as UndoRedoSnapshotState;
}
const mgr = new UndoRedoHistoryManager(snapshotState([unit]));
const t0 = 1_000_000;
const recorded = mgr.recordChange(
  snapshotState(committed.units),
  `עריכת טקסט במקום (${UNIT_ID})`,
  `inline-edit-${UNIT_ID}`,
  true,
  t0
);
check('the edit is recorded as a history step', recorded && mgr.canUndo(), `canUndo=${mgr.canUndo()}`);
// A second rapid keystroke with the same key coalesces into the same step.
const typed2 = InPlaceEditEngine.applyInsertText(
  typed.nextText,
  typed.nextSelection,
  'Y'
);
const committed2 = ProjectPersistenceEngine.updateContentUnitText(
  committed.units,
  [],
  UNIT_ID,
  typed2.nextText,
  {
    pageWordStartIndex: map!.pageWordStartIndex,
    pageWordEndIndexExclusive: map!.pageWordEndIndexExclusive,
  }
);
mgr.recordChange(
  snapshotState(committed2.units),
  `עריכת טקסט במקום (${UNIT_ID})`,
  `inline-edit-${UNIT_ID}`,
  true,
  t0 + 100
);
check('rapid keystrokes coalesce into one undo step', mgr.getUndoCount() === 1, `undo steps=${mgr.getUndoCount()}`);
const undone = mgr.undo();
check(
  'undo restores the original unit text',
  undone?.contentUnits.find(u => u.id === UNIT_ID)?.rawText === ORIGINAL,
  `got ${JSON.stringify(undone?.contentUnits.find(u => u.id === UNIT_ID)?.rawText)}`
);
check('redo is available after undo', mgr.canRedo());
const redone = mgr.redo();
check(
  'redo restores the edited unit text',
  redone?.contentUnits.find(u => u.id === UNIT_ID)?.rawText ===
    'אחת שתים שלוש ארבעZZZY חמש שש',
  `got ${JSON.stringify(redone?.contentUnits.find(u => u.id === UNIT_ID)?.rawText)}`
);

// ---------------------------------------------------------- §D — save / reload
console.log('§D — save / reload round-trip');
const snapshot = UndoRedoHistoryManager.toProjectSnapshot(
  snapshotState(committed2.units),
  'smoke'
);
const json = ProjectPersistenceEngine.serializeKeterProject(snapshot);
const reloaded = ProjectPersistenceEngine.deserializeKeterProject(json);
check(
  'the edited text survives a .keter serialize / deserialize round-trip',
  reloaded.units.find(u => u.id === UNIT_ID)?.rawText ===
    'אחת שתים שלוש ארבעZZZY חמש שש',
  `got ${JSON.stringify(reloaded.units.find(u => u.id === UNIT_ID)?.rawText)}`
);

// ---------------------------------------------------------- §E — fix present
console.log('§E — the v0.9.2 Part C fix is present in the sources');
const canvasSrc = fs.readFileSync(path.join(ROOT, 'src/components/PageCanvas.tsx'), 'utf8');
const editorSrc = fs.readFileSync(path.join(ROOT, 'src/components/InlineTextEditor.tsx'), 'utf8');
const focusSites = (canvasSrc.match(/hiddenInputRef\.current\?\.focus/g) ?? []).length;
const guardedFocusSites = (
  canvasSrc.match(/if \(!enableContentEditableEditingRef\.current\) \{\s*\n?\s*hiddenInputRef\.current\?\.focus/g) ?? []
).length;
check('all 5 hidden-input focus sites are guarded by the overlay flag', focusSites === 5 && guardedFocusSites === 5, `focus sites=${focusSites}, guarded=${guardedFocusSites}`);
const clearGuards = (canvasSrc.match(/if \(pointerDownOnTextRef\.current\) \{/g) ?? []).length;
check('the 3 empty-space onClick clear sites honour pointerDownOnTextRef', clearGuards === 3, `guards=${clearGuards}`);
check('word/line mousedown marks the pointerdown as on-text', (canvasSrc.match(/pointerDownOnTextRef\.current = true;/g) ?? []).length === 2);
check('word/line mousedown prevents the default focus change', (canvasSrc.match(/e\.preventDefault\(\);\n\s*pointerDownOnTextRef\.current = true;/g) ?? []).length === 2);
check(
  'the overlay commit/cancel exit is guarded by editingUnitIdRef',
  canvasSrc.includes('if (editingUnitIdRef.current === activeEditUnit.id) {')
);
check(
  'InlineTextEditor commits the previous unit on a unit switch',
  editorSrc.includes('editSessionRef') && editorSrc.includes('prev.onCommit(pending)')
);

console.log(`\nv092c-edit-in-place-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
