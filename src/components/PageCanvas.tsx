import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  HebrewGlyph,
  PageTypesetResult,
  ShapedWord,
  TypesetLine,
  ContentRole,
  ContentUnit,
  AnchorLink,
  SeparatorStyleId,
} from '../types/typesetter';
import { textBlockLeft, textBlockRight } from '../types/typesetter';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Hand,
  MousePointer,
  Expand,
  X,
  Scissors,
  BookmarkPlus,
  Move,
} from 'lucide-react';
import {
  InPlaceEditEngine,
  InPlaceSelectionState,
  WordCharSpan,
} from '../engine/in-place-edit-engine';
// v0.9.8 Phase 5 — anchor overlay + click-to-re-anchor (pure helpers;
// the canvas only measures the DOM keys they produce).
import {
  AnchorConnector,
  buildAnchorConnectors,
  buildConnectorPath,
  charOffsetOfPageWord,
} from '../engine/anchor-overlay';
// v0.5.0 Part C — Module 8: contenteditable overlay editor (one import;
// the overlay itself lives in ./InlineTextEditor). --- BEGIN Part C import ---
import { InlineTextEditor } from './InlineTextEditor';
import type { InlineFormatPatch } from './InlineTextEditor';
// v0.5.0 (Title Page / Shaar Blat builder): the title-page overlay.
import { TitlePageOverlay } from './TitlePageOverlay';
// --- END Part C import ---
import {
  AnchoredBreakInstruction,
  BreakInstructionKind,
  createBreakInstruction,
  resolveSplitCandidateLine,
} from '../engine/break-instructions';
import { useLanguage } from '../i18n/LanguageContext';
import {
  DesignSelectionTarget,
  CustomLayoutBox,
  getSemanticRoleLabel,
  resolveRunningHeader,
  runningHeaderHasVisibleSlot,
} from '../types/design-settings';
import type { FrameToolId, ThreadLink } from '../engine/frame-tools';
import { moveBoxVertex } from '../engine/frame-tools';
// v0.6.0 (Part B): the unified block-highlight geometry lives in a pure
// engine module now (`block-highlight.ts`) so the smoke test can verify
// the one-box-per-section union without a DOM.
import {
  blockInfoForUnit as buildBlockInfoForUnit,
  unionBlockBoxPx,
} from '../engine/block-highlight';

interface PageCanvasProps {
  // v0.8.1 — white-screen fix: optional + guarded below. An empty book
  // used to produce an undefined page and the canvas threw while
  // destructuring it, blanking the whole window. A missing result now
  // renders as an empty page.
  typesetResult?: PageTypesetResult;
  zoom: number;
  showBaselines: boolean;
  showAnchors: boolean;
  showKneeGuide: boolean;
  // v0.9.8 Uniformity Audit — REMOVED: `showLinks` was dead (accepted
  // here, never read in the body, never toggled by any UI).
  // v0.5.0 Part A — Module 2: the HarfBuzz glyph analyzer UI was removed,
  // so no caller passes an inspector callback any more. The prop stays
  // optional (not deleted outright) so the canvas click path below keeps
  // compiling if a future inspector is ever re-added deliberately.
  onSelectGlyph?: (glyph: HebrewGlyph, word: ShapedWord) => void;
  hoveredLinkId: string | null;
  onHoverLink: (linkId: string | null) => void;
  onZoomChange?: (newZoom: number) => void;
  selectedFont?: string;
  selectedRashiFont?: string;
  selectedTosafotFont?: string;
  selectedUnitId?: string | null;
  onSelectUnit?: (unitId: string | null) => void;
  onSelectWord?: (
    unitId: string,
    wordIndex: number,
    wordText: string,
    role: ContentRole
  ) => void;
  units?: ContentUnit[];
  editingUnitId?: string | null;
  onStartEditUnit?: (unitId: string) => void;
  onCancelEditUnit?: () => void;
  onCommitEditUnit?: (
    unitId: string,
    newRawText: string,
    options?: {
      pageWordStartIndex?: number;
      pageWordEndIndexExclusive?: number;
      coalesceHistory?: boolean;
      silent?: boolean;
    }
  ) => void;

  // --- v0.5.0 Part C — Module 8 (In-Page Editing & Shortcuts) ---------------
  // --- BEGIN Part C PageCanvas props (single delimited hunk) ----------------
  // When true, an in-place edit opens the contenteditable overlay editor
  // (`InlineTextEditor`) over the block instead of the hidden-input caret
  // editor. Default false: existing Stage 17I behaviour is untouched, so
  // the hover/selection work in the other copy merges cleanly.
  // `onInlineFormatChange` receives the mini-toolbar's formatting (font
  // size / bold / alignment); the integrator wires it to a local override
  // (see REPORT.md). When absent, the toolbar still changes the editor's
  // own display size, but nothing is persisted.
  enableContentEditableEditing?: boolean;
  onInlineFormatChange?: (unitId: string, patch: InlineFormatPatch) => void;
  // --- END Part C PageCanvas props ------------------------------------------

  // --- v0.5.0 (Title Page / Shaar Blat builder) -----------------------------
  // Direct on-page editing of a title-page field (the overlay below).
  // `fieldId` is one of title/subtitle/author/translator/publisher/volume/
  // year, or `extra:<index>` for an extra line.
  onTitlePageFieldChange?: (fieldId: string, text: string) => void;
  // v0.6.0 Part C (§8): drag a title-page field to a new position.
  onTitlePageFieldPositionChange?: (fieldId: string, xOffsetPt: number, yOffsetPt: number) => void;

  // --- v0.6.0 Part C (§2/§6): movable custom-layout boxes in the main -----
  // --- preview + editable running-header title ------------------------------
  // On `custom_layout` pages only: the boxes the pagination engine placed
  // (lines carry `customLayoutBoxId`). Dragging a box frame's edge moves
  // it; its corner handle resizes it; the parent saves the result as THIS
  // folio's page override, so the rest of the book never moves, and
  // re-pagination reflows the text live. `customLayoutBoxes` is the
  // page's effective box set (override when one exists, else global).
  customLayoutBoxes?: CustomLayoutBox[];
  /** v0.7.0 Part 2 (M3): text-threading links for this page (out-port → in-port). */
  threadLinks?: ThreadLink[];
  showThreading?: boolean;
  onCustomLayoutBoxesChange?: (pageIndex: number, boxes: CustomLayoutBox[]) => void;
  // --- v0.8.0 Part E (#14): drag-to-draw frame tools ---------------------
  // When a frame tool is active, dragging on empty canvas draws the frame
  // (preview rect while dragging, commit on release). The parent creates
  // the box / text unit and reverts to the select tool. Without these
  // props the canvas behaves exactly as before (toolbar button only).
  activeFrameTool?: FrameToolId;
  onDrawFrame?: (
    rect: { xPct: number; yPct: number; widthPct: number; heightPct: number },
    tool: Exclude<FrameToolId, 'select' | 'type'>
  ) => void;
  onDrawTextFrame?: (rect: {
    xPct: number;
    yPct: number;
    widthPct: number;
    heightPct: number;
  }) => void;
  /** The running-header title (book title) is editable on the page. */
  onHeaderTitleChange?: (text: string) => void;

  // --- v0.3.0 Module E: pro typesetter tools + extras (all optional) ---
  /**
   * Drag page division: called when the user drags a text block's bottom edge
   * and releases. `lineIndex` is the `TypesetLine.lineIndex` of the first line
   * that should move to the next page. `wordIndex` (v0.6.0 Part B) is the
   * exact unit-global word index of that line's first word, computed from
   * the unit page text map — the parent anchors the break to it, so the
   * split lands on the dragged line even for a unit spanning pages (the old
   * `lineIndex * 8` guess is only a fallback when the map is unavailable).
   * The parent wires this to repagination (e.g. re-run the pagination solver
   * with a break at that line); this component only *requests* the split,
   * it never re-paginates itself.
   */
  onPageSplitRequest?: (pageIndex: number, unitId: string, lineIndex: number, wordIndex?: number) => void;
  /** Anchored break instruction UI: called when the user adds an instruction. */
  onAddBreakInstruction?: (instruction: AnchoredBreakInstruction) => void;
  /**
   * Page background (colour and/or image). The paginated page type has no
   * background field yet (see report: `PageTypesetResult.pageBackground?`
   * addition needed); until then the parent passes it as a prop.
   */
  pageBackground?: { color?: string; imageUrl?: string };
  /**
   * Image units for an image-only page. Defaults to `units` filtered to
   * role 'image'; pass explicitly when image units live elsewhere.
   */
  imagePageUnits?: ContentUnit[];
  /** Show the drag-split handles on text blocks. Default: true when onPageSplitRequest is set. */
  showSplitHandles?: boolean;

  // --- v0.6.0 Part A (§5): running header ----------------------------------
  /**
   * 0-based index of this page in the book (App passes `safePageIndex`).
   * Resolves per-folio header text overrides. Defaults to
   * `pageNumber - 1` when absent (the two agree with and without a title
   * page, since the title page is page 1 / index 0).
   */
  currentPageIndex?: number;

  // --- v0.5.0 Part B (Module 4): block-level hover --------------------------------
  /**
   * Called when the pointer hovers (or leaves) a whole SECTION / block
   * (paragraph, Mishnah, Gemara, comment block) — with the section's
   * metadata and bounding box, not a word/token node. Optional: the parent
   * (`App.tsx`) does not pass it yet, so the state-manager handoff is
   * available to the integrator without any change to `App.tsx`.
   */
  onHoverBlock?: (
    block: NonNullable<DesignSelectionTarget['blockBoundary']> | null
  ) => void;

  // --- v0.9.8 Phase 5: anchor-link overlay + click-to-re-anchor --------
  /**
   * Phase 3 AnchorLinks for the whole book (stamped on the units by the
   * importer). The overlay draws one connector per link that touches
   * THIS page, between the real rendered word spans (measured from the
   * DOM, not the old hardcoded decorative curve). Empty = no overlay.
   */
  anchorLinks?: AnchorLink[];
  /** Toggleable "Show Anchor Links" overlay (off by default). */
  showAnchorLinks?: boolean;
  /**
   * Click-to-re-anchor: while the overlay is on, a click on a dibbur
   * word arms re-anchoring for that commentary unit; the next click on
   * a Main Text word completes it. `reAnchorPendingUnitId` is the
   * armed commentary unit (null = not armed). All three callbacks are
   * optional — without them the overlay is view-only.
   */
  reAnchorPendingUnitId?: string | null;
  onReAnchorDibburPick?: (commentaryUnitId: string) => void;
  onReAnchorTargetPick?: (
    commentaryUnitId: string,
    targetMainNodeId: string,
    targetCharOffset: number
  ) => void;
  onReAnchorCancel?: () => void;
}

// v0.8.1 — white-screen fix: fallback page used when typesetResult is
// undefined (empty book / stale project). Same shape as the engine's
// empty page, so every render path below keeps working.
const EMPTY_PAGE_FALLBACK: PageTypesetResult = {
  pageIndex: 0,
  pageNumber: 1,
  pageNumberHebrew: 'א׳',
  headerTitle: '',
  layoutType: 'single_column',
  geometry: {
    pageWidth: 595,
    pageHeight: 842,
    marginTop: 54,
    marginBottom: 54,
    marginInside: 54,
    marginOutside: 54,
    isVerso: false,
  },
  sourceLines: [],
  rashiLines: [],
  tosafotLines: [],
  footnoteLines: [],
  knee: {
    pageContentWidth: 487,
    pageContentHeight: 734,
    topY: 0,
    kneeJunctionY: 734,
    bottomY: 734,
    upperSourceWidth: 487,
    lowerSourceWidth: 487,
    innerXOffset: 0,
    isLeftStepped: false,
    rightCommentaryWidth: 0,
    leftCommentaryWidth: 0,
    gutterWidth: 0,
  },
};

export const PageCanvas: React.FC<PageCanvasProps> = ({
  typesetResult: typesetResultProp,
  zoom,
  showBaselines,
  showAnchors,
  showKneeGuide,
  hoveredLinkId,
  onHoverLink,
  onZoomChange,
  selectedFont = 'Frank Ruhl Libre',
  selectedRashiFont = 'Noto Rashi Hebrew',
  selectedTosafotFont = 'Frank Ruhl Libre',
  selectedUnitId,
  onSelectUnit,
  onSelectWord,
  units = [],
  editingUnitId = null,
  onStartEditUnit,
  onCancelEditUnit,
  onCommitEditUnit,
  // v0.5.0 Part C — Module 8 (see the props block above).
  enableContentEditableEditing = false,
  onInlineFormatChange,
  // v0.5.0 (Title Page / Shaar Blat builder).
  onTitlePageFieldChange,
  // v0.6.0 Part C (§8): title-page field drag positioning.
  onTitlePageFieldPositionChange,
  // v0.6.0 Part C (§2/§6): movable boxes + editable header title.
  customLayoutBoxes,
  threadLinks,
  showThreading = true,
  onCustomLayoutBoxesChange,
  onHeaderTitleChange,
  onPageSplitRequest,
  onAddBreakInstruction,
  pageBackground,
  imagePageUnits,
  showSplitHandles,
  onHoverBlock,
  currentPageIndex,
  activeFrameTool = 'select',
  onDrawFrame,
  onDrawTextFrame,
  // v0.9.8 Phase 5: anchor-link overlay + click-to-re-anchor.
  anchorLinks = [],
  showAnchorLinks = false,
  reAnchorPendingUnitId = null,
  onReAnchorDibburPick,
  onReAnchorTargetPick,
  onReAnchorCancel,
}) => {
  const { t, lang } = useLanguage();
  // v0.8.1 — white-screen fix: never destructure an undefined page — fall
  // back to the empty page above. The rest of the component renders an
  // empty page frame instead of throwing.
  const typesetResult = typesetResultProp ?? EMPTY_PAGE_FALLBACK;
  const {
    geometry,
    sourceLines,
    rashiLines,
    tosafotLines,
    footnoteLines,
    column2Lines,
    tertiaryLines,
    michtavBox,
    openingWordBox,
    transitionMarkers,
    peripheralStreams,
    structuredHeaders,
    folioDisplay,
    knee,
    pageNumberHebrew,
    pageNumber,
    headerTitle,
    layoutType,
    dividerY,
    activeLinks,
    continuationHeader,
    continuationFooter,
    vilnaHeader,
  } = typesetResult;

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const wordDomMapRef = useRef<Map<string, HTMLSpanElement>>(new Map());

  // v0.9.2 Part C — the contenteditable overlay (`InlineTextEditor`,
  // enabled via `enableContentEditableEditing`) is the editor when it is
  // on: the hidden input must never steal its focus. A focus steal blurs
  // the editor, whose onBlur commits + closes it ~10ms after it opens,
  // so the button looked dead. The ref mirror is read inside timeouts
  // and window listeners whose dependency arrays cannot see the prop.
  const enableContentEditableEditingRef = useRef(enableContentEditableEditing);
  enableContentEditableEditingRef.current = enableContentEditableEditing;
  // v0.9.2 Part C — whether the last pointerdown landed on page text
  // (a word span / a line). A click that starts on text must not be
  // treated as "clicked empty space": the overlay mounts on mousedown
  // and covers the word, so the ensuing click is retargeted onto the
  // page sheet (target === currentTarget) and the sheet's empty-space
  // handler would otherwise exit editing + clear the selection in the
  // very click that opened it.
  const pointerDownOnTextRef = useRef(false);
  // v0.9.2 Part C — mirror of `editingUnitId` read at call time, so a
  // commit for the previously edited unit can never close an edit that
  // has already moved on to another unit.
  const editingUnitIdRef = useRef(editingUnitId);
  editingUnitIdRef.current = editingUnitId;

  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanToolActive, setIsPanToolActive] = useState(false);
  const [isDraggingPan, setIsDraggingPan] = useState(false);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({ clientX: 0, clientY: 0, scrollLeft: 0, scrollTop: 0 });

  // Stage 17I: Direct In-Place Caret & Selection State (No Floating Textarea!)
  const [inPlaceSelection, setInPlaceSelection] = useState<InPlaceSelectionState | null>(null);
  const [isDraggingTextSelection, setIsDraggingTextSelection] = useState(false);
  const isComposingImeRef = useRef(false);
  const initialUnitBaselineTextRef = useRef<{ unitId: string; rawText: string } | null>(null);

  const activeEditUnitId = inPlaceSelection?.unitId || editingUnitId || null;

  // --- v0.3.0 Module E state -------------------------------------------------
  // Full-screen preview mode: the whole canvas goes fixed/full-screen (Esc exits).
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);
  // Drag page division: while dragging a block's bottom edge, the pointer Y
  // (content-relative px) and the candidate split line for that unit.
  const [splitDrag, setSplitDrag] = useState<{
    unitId: string;
    pointerYContentPx: number;
    candidateLineIndex: number | null;
  } | null>(null);
  const splitDragUnitLinesRef = useRef<TypesetLine[]>([]);
  // Anchored break instruction menu (kind picker for the selected unit).
  const [showBreakMenu, setShowBreakMenu] = useState(false);
  const splitHandlesEnabled = showSplitHandles ?? Boolean(onPageSplitRequest);

  // --- v0.5.0 Part B (Module 4): block-level hover --------------------------------
  // Hover targets the parent SECTION (a whole ContentUnit), never a word:
  // one unified outline around the section, computed from its lines below.
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);

  // Esc exits full-screen preview (and closes the break menu).
  useEffect(() => {
    if (!isFullscreenPreview && !showBreakMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showBreakMenu) setShowBreakMenu(false);
        else setIsFullscreenPreview(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreenPreview, showBreakMenu]);

  // Entering full-screen preview fits the page to the screen.
  const enterFullscreenPreview = useCallback(() => {
    setIsFullscreenPreview(true);
    setTimeout(() => handleFitPageRef.current?.(), 30);
  }, []);
  const handleFitPageRef = useRef<(() => void) | null>(null);
  const activeEditUnit = useMemo(
    () => units.find(u => u.id === activeEditUnitId) || null,
    [units, activeEditUnitId]
  );

  // Authoritative character/word/line map for the unit currently being edited on this page
  const activeUnitMap = useMemo(() => {
    if (!activeEditUnitId) return null;
    return InPlaceEditEngine.buildUnitPageTextMap(
      typesetResult,
      activeEditUnitId,
      activeEditUnit
    );
  }, [typesetResult, activeEditUnitId, activeEditUnit]);

  // Synchronize external `editingUnitId` trigger (e.g. from toolbar button) into in-place caret mode
  useEffect(() => {
    if (editingUnitId && (!inPlaceSelection || inPlaceSelection.unitId !== editingUnitId)) {
      const map = InPlaceEditEngine.buildUnitPageTextMap(
        typesetResult,
        editingUnitId,
        units.find(u => u.id === editingUnitId)
      );
      if (map) {
        const u = units.find(item => item.id === editingUnitId);
        if (u && (!initialUnitBaselineTextRef.current || initialUnitBaselineTextRef.current.unitId !== editingUnitId)) {
          initialUnitBaselineTextRef.current = { unitId: editingUnitId, rawText: u.rawText };
        }
        setInPlaceSelection({
          unitId: editingUnitId,
          anchorOffset: map.unitPageText.length,
          focusOffset: map.unitPageText.length,
        });
        // v0.9.2 Part C: only focus the hidden input when the
        // contenteditable overlay is NOT the editor — otherwise this
        // steals focus from the overlay and its onBlur commits +
        // closes it before the user can type.
        setTimeout(() => {
          if (!enableContentEditableEditingRef.current) {
            hiddenInputRef.current?.focus({ preventScroll: true });
          }
        }, 10);
      }
    } else if (!editingUnitId && inPlaceSelection) {
      setInPlaceSelection(null);
    }
  }, [editingUnitId, typesetResult, units]);

  // Listen for Spacebar for hand-panning ONLY when not actively editing text on the page
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isInput || inPlaceSelection) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsDraggingPan(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [inPlaceSelection]);

  // Convert points to screen pixels (base 1.25 px per pt at zoom 1.0)
  const scale = zoom * 1.25;
  const pageW = Math.round(geometry.pageWidth * scale);
  const pageH = Math.round(geometry.pageHeight * scale);
  const marginT = geometry.marginTop * scale;
  const marginB = geometry.marginBottom * scale;
  // Layout training T3.1 — the screen uses the SAME text-block position
  // as the PDF (textBlockLeft: mirrored per page for a right-bound book).
  // Below, `marginOut` is the LEFT pad and `marginIn` the RIGHT pad of the
  // text block (the names predate mirroring; every use positions the
  // content with right: marginIn / left: marginOut).
  const marginOut = textBlockLeft(geometry) * scale;
  const marginIn = (geometry.pageWidth - textBlockRight(geometry)) * scale;

  const contentW = pageW - marginIn - marginOut;
  const contentH = pageH - marginT - marginB;

  const handleFitPage = () => {
    if (!viewportRef.current || !onZoomChange) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const availW = Math.max(240, rect.width - 80);
    const availH = Math.max(240, rect.height - 80);
    const zoomW = availW / (geometry.pageWidth * 1.25);
    const zoomH = availH / (geometry.pageHeight * 1.25);
    const nextZoom = Math.max(0.5, Math.min(2.2, Number(Math.min(zoomW, zoomH).toFixed(2))));
    onZoomChange(nextZoom);
  };
  // Keep the fit helper reachable from the full-screen enter callback.
  handleFitPageRef.current = handleFitPage;

  const handleFitWidth = () => {
    if (!viewportRef.current || !onZoomChange) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const availW = Math.max(240, rect.width - 96);
    const zoomW = availW / (geometry.pageWidth * 1.25);
    const nextZoom = Math.max(0.5, Math.min(2.2, Number(zoomW.toFixed(2))));
    onZoomChange(nextZoom);
  };

  // --- v0.3.0 Module E helpers ---------------------------------------------
  // All text lines on this page, grouped by unit (reading order preserved).
  const pageLinesByUnit = useMemo(() => {
    const map = new Map<string, TypesetLine[]>();
    const streams = [
      sourceLines,
      column2Lines ?? [],
      rashiLines,
      tosafotLines,
      tertiaryLines ?? [],
      footnoteLines,
    ];
    for (const lines of streams) {
      for (const line of lines) {
        if (!line.unitId) continue;
        const arr = map.get(line.unitId) ?? [];
        arr.push(line);
        map.set(line.unitId, arr);
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => a.yBaseline - b.yBaseline);
    return map;
  }, [sourceLines, column2Lines, rashiLines, tosafotLines, tertiaryLines, footnoteLines]);

  // ── v0.6.0 Part C (§2/§6): movable custom-layout boxes in the main ───
  // preview. Off by default (the "הזז תיבות" toggle in the bottom pill):
  // text stays clickable/editable exactly as before, and only the thin
  // frame edges + corner handle take the pointer when the mode is on.
  // A drag commits through `onCustomLayoutBoxesChange` with the BODY
  // page index (the title page, when on, shifts display indices by one),
  // so the parent saves it as that folio's page override — the rest of
  // the book never moves — and re-pagination reflows the text live.
  const isCustomLayoutPage =
    layoutType === 'custom_layout' && !typesetResult.isTitlePage;
  const canMoveBoxes = Boolean(
    isCustomLayoutPage && onCustomLayoutBoxesChange && customLayoutBoxes && customLayoutBoxes.length > 0
  );
  const [moveBoxesMode, setMoveBoxesMode] = useState(false);
  const [boxDragPreview, setBoxDragPreview] = useState<CustomLayoutBox[] | null>(null);
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
  const boxDragRef = useRef<{
    boxId: string;
    mode: 'move' | 'resize' | 'vertex' | 'skew';
    startClientX: number;
    startClientY: number;
    startBox: CustomLayoutBox;
    vertexIndex?: number;
  } | null>(null);
  const [editingHeaderTitle, setEditingHeaderTitle] = useState(false);
  const effectiveBoxes = boxDragPreview ?? customLayoutBoxes ?? [];
  const bodyPageIndexForOverride =
    (typesetResult.designSettings?.titlePage?.enabled ? 1 : 0) === 1
      ? Math.max(0, typesetResult.pageIndex - 1)
      : typesetResult.pageIndex;
  const contentWidthPt =
    geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
  const contentHeightPt =
    geometry.pageHeight - geometry.marginTop - geometry.marginBottom;

  const clampBoxPct = useCallback(
    (b: CustomLayoutBox): CustomLayoutBox => {
      const stepX = (6 / contentWidthPt) * 100;
      const stepY = (6 / contentHeightPt) * 100;
      const snap = (v: number, step: number) =>
        step > 0 ? Math.round(v / step) * step : v;
      const x = Math.max(0, Math.min(90, Number(snap(b.xPct, stepX).toFixed(2))));
      const y = Math.max(0, Math.min(95, Number(snap(b.yPct, stepY).toFixed(2))));
      return {
        ...b,
        xPct: x,
        yPct: y,
        widthPct: Math.max(10, Math.min(100 - x, Number(snap(b.widthPct, stepX).toFixed(2)))),
        heightPct: Math.max(5, Math.min(100 - y, Number(snap(b.heightPct, stepY).toFixed(2)))),
      };
    },
    [contentWidthPt, contentHeightPt]
  );

  const onBoxFramePointerDown = (
    e: React.PointerEvent,
    box: CustomLayoutBox,
    mode: 'move' | 'resize' | 'vertex' | 'skew',
    vertexIndex?: number
  ) => {
    e.stopPropagation();
    e.preventDefault();
    exitInPlaceEditing();
    setActiveBoxId(box.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    boxDragRef.current = {
      boxId: box.id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: { ...box },
      vertexIndex,
    };
  };

  const onBoxFramePointerMove = (e: React.PointerEvent) => {
    const g = boxDragRef.current;
    if (!g) return;
    const dxPct = ((e.clientX - g.startClientX) / contentW) * 100;
    const dyPct = ((e.clientY - g.startClientY) / contentH) * 100;
    setBoxDragPreview(
      effectiveBoxes.map(b => {
        if (b.id !== g.boxId) return b;
        if (g.mode === 'move') {
          return clampBoxPct({ ...b, xPct: g.startBox.xPct + dxPct, yPct: g.startBox.yPct + dyPct });
        }
        if (g.mode === 'vertex' && g.vertexIndex !== undefined && g.startBox.shape) {
          // Vertex drag: pointer delta → box-normalized coordinates.
          const startPt = g.startBox.shape.points[g.vertexIndex];
          if (!startPt) return b;
          const boxWpx = (g.startBox.widthPct / 100) * contentW;
          const boxHpx = (g.startBox.heightPct / 100) * contentH;
          const nx = startPt.x + (e.clientX - g.startClientX) / Math.max(1, boxWpx);
          const ny = startPt.y + (e.clientY - g.startClientY) / Math.max(1, boxHpx);
          return moveBoxVertex(b, g.vertexIndex, nx, ny);
        }
        if (g.mode === 'skew') {
          const deg = Math.max(-30, Math.min(30, (g.startBox.skewXDeg ?? 0) + ((e.clientX - g.startClientX) / Math.max(1, contentW)) * 45));
          return { ...b, skewXDeg: Math.round(deg * 10) / 10 };
        }
        return clampBoxPct({
          ...b,
          widthPct: g.startBox.widthPct + dxPct,
          heightPct: g.startBox.heightPct + dyPct,
        });
      })
    );
  };

  const onBoxFramePointerUp = () => {
    const g = boxDragRef.current;
    boxDragRef.current = null;
    if (!g || !boxDragPreview) return;
    const next = boxDragPreview;
    setBoxDragPreview(null);
    onCustomLayoutBoxesChange?.(bodyPageIndexForOverride, next);
  };

  // --- v0.8.0 Part E (#14): drag-to-draw ----------------------------------
  // Mirrors the box-drag pattern above: pointer capture on the content
  // area, a preview rect in state while dragging, commit on release.
  // Only starts on truly empty canvas (target === the container itself,
  // so a drag that begins on a word or a box handle is untouched), and
  // only while a frame tool is active. Minimum size guards against
  // accidental clicks creating sliver frames.
  const DRAW_MIN_WIDTH_PCT = 5;
  const DRAW_MIN_HEIGHT_PCT = 3;
  const isDrawTool = activeFrameTool !== 'select';
  const [drawPreview, setDrawPreview] = useState<{
    xPct: number;
    yPct: number;
    widthPct: number;
    heightPct: number;
  } | null>(null);
  const drawRef = useRef<{
    startXPct: number;
    startYPct: number;
    tool: FrameToolId;
    rect: { xPct: number; yPct: number; widthPct: number; heightPct: number };
  } | null>(null);

  const drawPointPct = (e: React.PointerEvent): { x: number; y: number } | null => {
    const rect = contentAreaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  };

  const onDrawPointerDown = (e: React.PointerEvent) => {
    if (!isDrawTool || e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    const pt = drawPointPct(e);
    if (!pt) return;
    e.preventDefault();
    exitInPlaceEditing();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const initial = { xPct: pt.x, yPct: pt.y, widthPct: 0, heightPct: 0 };
    drawRef.current = { startXPct: pt.x, startYPct: pt.y, tool: activeFrameTool, rect: initial };
    setDrawPreview(initial);
  };

  const onDrawPointerMove = (e: React.PointerEvent) => {
    const g = drawRef.current;
    if (!g) return;
    const pt = drawPointPct(e);
    if (!pt) return;
    const rect = {
      xPct: Math.min(g.startXPct, pt.x),
      yPct: Math.min(g.startYPct, pt.y),
      widthPct: Math.abs(pt.x - g.startXPct),
      heightPct: Math.abs(pt.y - g.startYPct),
    };
    g.rect = rect;
    setDrawPreview(rect);
  };

  const onDrawPointerUp = () => {
    const g = drawRef.current;
    drawRef.current = null;
    setDrawPreview(null);
    if (!g) return;
    const rect = g.rect;
    // Too small to be a deliberate frame — a click, not a drag.
    if (rect.widthPct < DRAW_MIN_WIDTH_PCT || rect.heightPct < DRAW_MIN_HEIGHT_PCT) return;
    if (g.tool === 'type') {
      onDrawTextFrame?.(rect);
    } else if (g.tool !== 'select') {
      // 'select' can never reach here (a draw only starts while a draw
      // tool is active), but the guard keeps the type honest.
      onDrawFrame?.(rect, g.tool);
    }
  };

  // ── v0.5.0 Part B (Module 4): one bounding box per SECTION ──────────────────
  // `blockBoxPx` unions a unit's lines into ONE box; `blockInfoForUnit` is
  // the same box plus the section's metadata, in content-area points
  // (origin: top-left of the text frame), for the state manager via
  // `onHoverBlock`. Pagination and shaping are untouched — this only reads
  // the already-typeset lines.
  // v0.6.0 (Part B): the pure math lives in `engine/block-highlight.ts`
  // (testable without a DOM); these are thin wrappers bound to this page.
  // ─────────────────────────────────────────────────────────────────────────────
  const blockBoxPx = useCallback(
    (unitId: string): { topPx: number; bottomPx: number; rightPx: number; widthPx: number } | null => {
      const unitLines = pageLinesByUnit.get(unitId);
      if (!unitLines || unitLines.length === 0) return null;
      return unionBlockBoxPx(unitLines, geometry, knee, layoutType, scale);
    },
    [pageLinesByUnit, geometry, knee, layoutType, scale]
  );

  const blockInfoForUnit = useCallback(
    (
      unitId: string
    ): NonNullable<DesignSelectionTarget['blockBoundary']> | null => {
      const unitLines = pageLinesByUnit.get(unitId);
      if (!unitLines || unitLines.length === 0) return null;
      return buildBlockInfoForUnit(
        unitId,
        unitLines,
        units,
        geometry,
        knee,
        layoutType,
        scale
      );
    },
    [pageLinesByUnit, geometry, knee, layoutType, scale, units]
  );

  /** One outline per targeted section: the hovered one (dashed), the selected
   * one (solid) and, while a link is hovered, both sections of the linked
   * pair (amber). A section is ONE `ContentUnit` — its lines are unioned
   * into a single box by `blockBoxPx`, never boxed word by word.
   * v0.6.0 (Part B): the selected outline also shows while the block is
   * being edited in place — the old per-line ring on every line of the
   * selected unit is gone (it was the last surviving fragmented boxing),
   * so the unified outline is the one selection cue in every state. */
  const linkedUnitIds = useMemo(() => {
    if (!hoveredLinkId || !activeLinks) return [] as string[];
    const link = activeLinks.find(l => l.linkId === hoveredLinkId);
    if (!link) return [] as string[];
    return [link.sourceUnitId, link.commentaryUnitId].filter(
      (id): id is string => Boolean(id)
    );
  }, [hoveredLinkId, activeLinks]);

  const blockOverlays = useMemo(() => {
    const out: Array<{
      unitId: string;
      kind: 'hover' | 'selected' | 'link';
      box: { topPx: number; bottomPx: number; rightPx: number; widthPx: number };
      role?: ContentRole;
      lineCount: number;
    }> = [];
    const push = (unitId: string, kind: 'hover' | 'selected' | 'link') => {
      if (out.some(o => o.unitId === unitId)) return;
      const box = blockBoxPx(unitId);
      const lines = pageLinesByUnit.get(unitId);
      if (!box || !lines) return;
      out.push({
        unitId,
        kind,
        box,
        role: units.find(u => u.id === unitId)?.role ?? lines[0]?.role,
        lineCount: lines.length,
      });
    };
    if (hoveredUnitId && hoveredUnitId !== selectedUnitId) push(hoveredUnitId, 'hover');
    if (selectedUnitId) push(selectedUnitId, 'selected');
    for (const unitId of linkedUnitIds) push(unitId, 'link');
    return out;
  }, [hoveredUnitId, selectedUnitId, linkedUnitIds, blockBoxPx, pageLinesByUnit, units]);
  // ── end v0.5.0 Part B (Module 4) ────────────────────────────────────────────

  // ── v0.9.8 Phase 5: "Show Anchor Links" overlay ─────────────────────────
  // The connectors are built from the REAL paginated lines
  // (`buildAnchorConnectors` resolves each AnchorLink to the DOM keys of
  // its dibbur word and its target-phrase word on THIS page) and then
  // MEASURED from the actual rendered word spans — the old hovered-link
  // curve below was a hardcoded decorative arc at fixed fractions of the
  // page and is replaced by these paths. Measurement runs after every
  // render that can move words (page / zoom / links / overlay toggle)
  // and again on window resize and shortly after mount (webfont swap can
  // shift word rects after the first paint). When a word is not on this
  // page its end is null and the connector draws as a dangling stub from
  // the end that IS here — a dibbur whose target lives on another page
  // still shows, honestly, as unconnected on this page.
  const unitsById = useMemo(
    () => new Map(units.map(u => [u.id, u])),
    [units]
  );
  const anchorConnectors: AnchorConnector[] = useMemo(
    () =>
      showAnchorLinks
        ? buildAnchorConnectors(typesetResult, anchorLinks, unitsById)
        : [],
    [showAnchorLinks, anchorLinks, typesetResult, unitsById]
  );
  const anchorSvgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredAnchorLinkId, setHoveredAnchorLinkId] = useState<string | null>(null);
  const [measuredConnectors, setMeasuredConnectors] = useState<
    Array<{
      linkId: string;
      d: string | null;
      x1: number;
      y1: number;
      x2: number | null;
      y2: number | null;
      color: string;
      unmatched: boolean;
      dibburText: string;
      targetText?: string;
    }>
  >([]);
  const measureAnchorConnectors = useCallback(() => {
    const svg = anchorSvgRef.current;
    if (!svg || anchorConnectors.length === 0) {
      setMeasuredConnectors([]);
      return;
    }
    const svgRect = svg.getBoundingClientRect();
    const rectOf = (domKey: string | null) => {
      if (!domKey) return null;
      const el = wordDomMapRef.current.get(domKey);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - svgRect.left + r.width / 2, y: r.top - svgRect.top + r.height / 2 };
    };
    setMeasuredConnectors(
      anchorConnectors.map(c => {
        const from = rectOf(c.dibburDomKey);
        const to = rectOf(c.targetDomKey);
        return {
          linkId: c.linkId,
          d: from && to ? buildConnectorPath(from.x, from.y, to.x, to.y) : null,
          x1: from?.x ?? 0,
          y1: from?.y ?? 0,
          x2: to?.x ?? null,
          y2: to?.y ?? null,
          color: c.color,
          unmatched: c.unmatched,
          dibburText: c.dibburText,
          targetText: c.targetText,
        };
      })
    );
  }, [anchorConnectors]);
  useEffect(() => {
    measureAnchorConnectors();
    const t1 = window.setTimeout(measureAnchorConnectors, 350);
    window.addEventListener('resize', measureAnchorConnectors);
    return () => {
      window.clearTimeout(t1);
      window.removeEventListener('resize', measureAnchorConnectors);
    };
  }, [measureAnchorConnectors, typesetResult, zoom]);
  // ── end v0.9.8 Phase 5 anchor overlay ────────────────────────────────────

  // Image-only page detection: no text lines, but image units exist.
  // v0.8.0 Part E: when the page names its own images (imageUnitIds,
  // set by the pagination image interleave), show exactly those — the
  // old fallback showed EVERY image unit in the book on every lineless
  // page.
  const imageUnits = useMemo(() => {
    const all = imagePageUnits ?? units;
    const ids = typesetResult.imageUnitIds;
    if (ids && ids.length > 0) {
      const wanted = new Set(ids);
      return all.filter(u => wanted.has(u.id));
    }
    return all.filter(u => u.role === 'image');
  }, [imagePageUnits, units, typesetResult.imageUnitIds]);
  const hasTextLines =
    sourceLines.length > 0 ||
    rashiLines.length > 0 ||
    tosafotLines.length > 0 ||
    footnoteLines.length > 0 ||
    (tertiaryLines?.length ?? 0) > 0 ||
    (column2Lines?.length ?? 0) > 0;
  const isImageOnlyPage = !hasTextLines && imageUnits.length > 0;

  const imageSrcOf = (unit: ContentUnit): string | null => {
    const data = unit.imageData as unknown;
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') {
      const rec = data as Record<string, unknown>;
      for (const key of ['dataUrl', 'src', 'url', 'href']) {
        if (typeof rec[key] === 'string' && (rec[key] as string).length > 0) {
          return rec[key] as string;
        }
      }
    }
    // v0.8.0 Part E: fall back to the payload carried on the page itself
    // (the PDF/IDML path uses the same field) when the unit has none.
    const ids = typesetResult.imageUnitIds ?? [];
    const idx = ids.indexOf(unit.id);
    const pageImage = idx >= 0 ? typesetResult.pageImages?.[idx] : undefined;
    return pageImage?.dataUrl || null;
  };

  /**
   * First line of `unitLines` that the pointer is on or above — i.e. the
   * first line whose BOTTOM edge sits at/below `pointerYContentPx`.
   * The split moves content starting at this line to the next page, so the
   * line the pointer is actually resting on must be selectable. Pure core
   * lives in `break-instructions.ts` (`resolveSplitCandidateLine`) so the
   * smoke test can exercise it without a DOM.
   */
  const resolveSplitCandidate = useCallback(
    (unitLines: TypesetLine[], pointerYContentPx: number): TypesetLine | null =>
      resolveSplitCandidateLine(unitLines, pointerYContentPx, scale),
    [scale]
  );

  const finishSplitDrag = useCallback(
    (unitId: string, pointerYContentPx: number) => {
      const unitLines = splitDragUnitLinesRef.current;
      const candidate = resolveSplitCandidate(unitLines, pointerYContentPx);
      setSplitDrag(null);
      splitDragUnitLinesRef.current = [];
      if (!candidate || !onPageSplitRequest) return;
      // v0.6.0 (Part B): anchor the break to the EXACT first word of the
      // dragged line (unit-global word index), not the old `lineIndex * 8`
      // guess — the guess lands on the wrong line whenever lines hold more
      // or fewer than 8 words, and is unfindable for units spanning pages.
      let wordIndex: number | undefined;
      const map = InPlaceEditEngine.buildUnitPageTextMap(
        typesetResult,
        unitId,
        units.find(u => u.id === unitId)
      );
      if (map) {
        const firstWord = map.words.find(w => w.lineObj === candidate);
        if (firstWord) {
          wordIndex = map.pageWordStartIndex + firstWord.wordIndexInUnitSlice;
        } else {
          // Fallback: count the unit's page words on lines before the
          // candidate line (same numbering, no guesswork about line length).
          const candIdx = unitLines.indexOf(candidate);
          const before = map.words.filter(
            w => unitLines.indexOf(w.lineObj) !== -1 && unitLines.indexOf(w.lineObj) < candIdx
          ).length;
          wordIndex = map.pageWordStartIndex + before;
        }
      }
      onPageSplitRequest(typesetResult.pageIndex, unitId, candidate.lineIndex, wordIndex);
    },
    [onPageSplitRequest, resolveSplitCandidate, typesetResult, units]
  );

  /** Adds an anchored break instruction for a unit (optionally at a word). */
  const addBreakInstructionFor = useCallback(
    (unitId: string, kind: BreakInstructionKind, wordIndex?: number) => {
      if (!onAddBreakInstruction) return;
      onAddBreakInstruction(createBreakInstruction(unitId, kind, { wordIndex }));
      setShowBreakMenu(false);
    },
    [onAddBreakInstruction]
  );

  // Native non-passive wheel listener for Ctrl + Wheel zoom & smooth scroll
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (!onZoomChange) return;
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        const nextZoom = Math.min(2.2, Math.max(0.5, Number((zoom + delta).toFixed(2))));
        onZoomChange(nextZoom);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [zoom, onZoomChange]);

  const isPanMode = isSpacePressed || isPanToolActive;

  // --- v0.6.0 Part A (§5): editable running header -------------------------
  // The top header LINE (title + rule + edition label) is hidden by default
  // and shows only when `showTopHeaderLine` is on. Legacy settings saved
  // before the flag existed fall back to the old `showRunningHeader`, so
  // existing projects keep the header they already had. The folio (page
  // number) keeps its own flag and is NOT gated by this one — but inside
  // the header band it only appears when the folio position is a TOP
  // position; a bottom folio lives in the footer, so the band never
  // duplicates it.
  // The three slots are editable (left = chapter/edition label, centre =
  // book title, right = folio) globally and per folio, each with its own
  // visibility toggle, plus alignment / font / size (resolved below, after
  // `folioLabel` is defined). Collapse: the band renders only when the
  // header line is on with at least one visible slot, or when the folio
  // alone needs the top band. Reflow: the content itself moves — App hands
  // the pagination engine a geometry whose top margin grows by the header
  // band height while the line is on (see
  // DesignSettingsEngine.paginationGeometryFor), so the text reflows down
  // in real time and the space collapses when it is off.
  const pageElements = typesetResult.designSettings?.pageElements;
  const showTopHeaderLine =
    pageElements?.showTopHeaderLine ?? pageElements?.showRunningHeader ?? false;
  const showTopFolioNumber = pageElements?.showFolioNumber !== false;
  const folioPosition =
    pageElements?.folioNumberPosition ??
    typesetResult.designSettings?.pageLayout?.pageNumberPosition ??
    'top_outside';
  const folioPositionIsTop =
    folioPosition !== 'bottom_center' &&
    folioPosition !== 'bottom_outside' &&
    folioPosition !== 'hidden';
  const editionLabel =
    layoutType === 'rav_text'
      ? t('צורת הדף · מהדורת כתר')
      : layoutType === 'mikraot_gedolot'
        ? t('מקראות גדולות · כתר')
        : layoutType === 'two_column'
          ? t('שני טורים · מהדורת כתר')
          : layoutType === 'source_top_commentary_bottom'
            ? t('מקור ומפרשים · כתר')
            : layoutType === 'yiddish_sefer'
              ? t('ספר יידיש · מהדורת כתר')
              : t('מהדורת כתר');
  // --- v0.5.0 (Title Page / Shaar Blat builder) ---------------------------
  // A title page carries no lines and no folio/header: the overlay below
  // draws it from `designSettings.titlePage` instead.
  const isTitlePage = !!typesetResult.isTitlePage;
  const titlePageSettings = typesetResult.designSettings?.titlePage;
  // --- v0.5.0 (integrator — user request): commentary labels + folio format
  // Fresh books have the labels and the folio OFF (createDefaultSettings);
  // legacy settings without the new fields keep the labels/folio they had.
  // The folio itself is written in the chosen style, with or without "דף".
  const showCommentaryLabels = pageElements?.showCommentaryLabels ?? true;
  const pageNumberStyle = pageElements?.pageNumberStyle ?? 'hebrew';
  const showDafPrefix = pageElements?.showDafPrefix ?? true;
  const effectiveFolioText =
    folioDisplay ??
    (pageNumberStyle === 'numbers' ? String(pageNumber) : pageNumberHebrew);
  const hasTalmudFormat = /[.:]|ע״[אב]/.test(effectiveFolioText);
  const folioLabel =
    showDafPrefix && !hasTalmudFormat && !/^דף\s/.test(effectiveFolioText)
      ? `דף ${effectiveFolioText}`
      : effectiveFolioText;

  // --- v0.6.0 Part A (§5): resolved header slots (global + per-folio) -----
  const headerPageIndex = currentPageIndex ?? pageNumber - 1;
  const spreadSideIdx = typesetResult.bodyPageIndex ?? headerPageIndex;
  const resolvedHeader = resolveRunningHeader(
    pageElements,
    {
      bookTitle: structuredHeaders?.centerText || headerTitle,
      folioLabel,
      editionLabel: structuredHeaders?.leftText || editionLabel,
    },
    headerPageIndex,
    folioPositionIsTop && showTopFolioNumber,
    spreadSideIdx % 2 === 0 ? 'left' : 'right'
  );
  // v0.9.8 Phase 5: the divider rule under the header is its own toggle
  // (default ON) — it only ever draws while the header line is on.
  const showHeaderDividerRule = pageElements?.showHeaderDividerRule ?? true;
  const headerHasVisibleSlot = runningHeaderHasVisibleSlot(resolvedHeader);
  // Band visibility: header line on with a slot to show, or — with the
  // line off — the folio alone in the top band (pre-v0.6.0 behaviour).
  const showHeaderBand =
    (showTopHeaderLine && headerHasVisibleSlot) ||
    (!showTopHeaderLine && resolvedHeader.right.visible);
  const headerFontFamily = resolvedHeader.fontFamily || selectedFont;
  const headerFontSizePt = resolvedHeader.fontSizePt;
  // Band packing (this band is RTL: flex-start packs to the visual right).
  // One visible slot honours the alignment exactly; several slots spread
  // across the band when centred, or pack to the chosen side.
  const visibleHeaderSlotCount = [
    resolvedHeader.left.visible,
    resolvedHeader.center.visible,
    resolvedHeader.right.visible,
  ].filter(Boolean).length;
  const headerJustify: 'space-between' | 'center' | 'flex-start' | 'flex-end' =
    visibleHeaderSlotCount <= 1
      ? resolvedHeader.alignment === 'center'
        ? 'center'
        : resolvedHeader.alignment === 'left'
          ? 'flex-end'
          : 'flex-start'
      : resolvedHeader.alignment === 'center'
        ? 'space-between'
        : resolvedHeader.alignment === 'left'
          ? 'flex-end'
          : 'flex-start';

  const exitInPlaceEditing = useCallback(() => {
    setInPlaceSelection(null);
    setIsDraggingTextSelection(false);
    initialUnitBaselineTextRef.current = null;
    onCancelEditUnit?.();
  }, [onCancelEditUnit]);

  const commitUnitEdit = useCallback(
    (
      unitId: string,
      nextPageSliceText: string,
      map: ReturnType<typeof InPlaceEditEngine.buildUnitPageTextMap>,
      nextSelection: InPlaceSelectionState
    ) => {
      const normalized = nextPageSliceText.replace(/\s+/g, ' ').trim();
      if (!normalized || !onCommitEditUnit) return;

      // v0.9.2 Part C: a commit for a unit that is no longer the active
      // edit (the user clicked another paragraph mid-edit and the
      // overlay committed the previous unit's pending text on the unit
      // switch) saves the text but must not move the caret / selection
      // back to that unit.
      if (editingUnitIdRef.current === unitId) {
        setInPlaceSelection(nextSelection);
      }
      onCommitEditUnit(unitId, nextPageSliceText, {
        pageWordStartIndex: map?.pageWordStartIndex ?? 0,
        pageWordEndIndexExclusive: map?.pageWordEndIndexExclusive ?? (map?.totalUnitWords ?? 0),
        coalesceHistory: true,
        silent: true,
      });
    },
    [onCommitEditUnit]
  );

  /**
   * Resolves a screen pointer `(clientX, clientY)` inside a word span (or line) to the exact
   * UTF-16 grapheme boundary offset within `UnitPageTextMap` using real browser `Range.getBoundingClientRect()`
   * measurements on the rendered glyph DOM node!
   */
  const resolvePointerToUnitCharOffset = useCallback(
    (
      unitId: string,
      wordSpan: WordCharSpan,
      wordEl: HTMLSpanElement | null,
      clientX: number
    ): number => {
      if (!wordEl) {
        return wordSpan.charEnd;
      }
      const textNode = wordEl.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        const rect = wordEl.getBoundingClientRect();
        const midX = (rect.left + rect.right) / 2;
        return clientX >= midX ? wordSpan.charStart : wordSpan.charEnd;
      }

      const rawText = textNode.textContent || '';
      const boundaries = InPlaceEditEngine.computeGraphemeBoundaries(rawText);
      if (boundaries.length <= 1) {
        return wordSpan.charStart;
      }

      const range = document.createRange();
      let bestLocalOffset = 0;
      let bestDist = Infinity;

      for (let i = 0; i < boundaries.length - 1; i++) {
        const gStart = boundaries[i];
        const gEnd = boundaries[i + 1];
        try {
          range.setStart(textNode, gStart);
          range.setEnd(textNode, gEnd);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;

          // In RTL Hebrew, the start of the grapheme (`gStart`) is its RIGHT edge (`rect.right`),
          // and the end of the grapheme (`gEnd`) is its LEFT edge (`rect.left`).
          const distToStart = Math.abs(clientX - rect.right);
          if (distToStart < bestDist) {
            bestDist = distToStart;
            bestLocalOffset = gStart;
          }
          const distToEnd = Math.abs(clientX - rect.left);
          if (distToEnd < bestDist) {
            bestDist = distToEnd;
            bestLocalOffset = gEnd;
          }
        } catch {
          // Ignore range measurement errors
        }
      }

      return Math.min(wordSpan.charEnd, wordSpan.charStart + bestLocalOffset);
    },
    []
  );

  // Measure the exact physical screen-space position `{ leftPx, topPx, heightPx }` of `focusOffset`
  // relative to `contentAreaRef` using real DOM Range geometry on the rendered word span!
  const [caretVisualPos, setCaretVisualPos] = useState<{
    leftPx: number;
    topPx: number;
    heightPx: number;
  } | null>(null);

  const [selectionRectsPx, setSelectionRectsPx] = useState<
    Array<{ leftPx: number; topPx: number; widthPx: number; heightPx: number }>
  >([]);

  useEffect(() => {
    if (!inPlaceSelection || !activeUnitMap || !contentAreaRef.current) {
      setCaretVisualPos(null);
      setSelectionRectsPx([]);
      return;
    }

    const containerRect = contentAreaRef.current.getBoundingClientRect();
    const { start, end, isCollapsed } = InPlaceEditEngine.getNormalizedRange(inPlaceSelection);
    const focus = Math.max(0, Math.min(activeUnitMap.unitPageText.length, inPlaceSelection.focusOffset));

    // Helper to measure exact X coordinate (relative to contentAreaRef left) for any UTF-16 offset in activeUnitMap
    const measureOffsetPosition = (
      targetOffset: number
    ): { xPx: number; topPx: number; heightPx: number; lineKey: string } | null => {
      if (activeUnitMap.words.length === 0) return null;

      // Find word containing `targetOffset`, or nearest word on the line
      let targetWord =
        activeUnitMap.words.find(
          w => targetOffset >= w.charStart && targetOffset <= w.charEnd
        ) || null;
      let isInSpaceAfterWord = false;

      if (!targetWord) {
        // Offset is on a space between words: attach to the preceding word's left edge
        const prevWords = activeUnitMap.words.filter(w => w.charEnd <= targetOffset);
        if (prevWords.length > 0) {
          targetWord = prevWords[prevWords.length - 1];
          isInSpaceAfterWord = true;
        } else {
          targetWord = activeUnitMap.words[0];
        }
      }

      const wordEl =
        wordDomMapRef.current.get(
          `${targetWord.lineKey}-w-${targetWord.wordIndexInLine}`
        ) || null;

      const lineObj = targetWord.lineObj;
      const lineTopPx = (lineObj.yBaseline - lineObj.ascent) * scale;
      const lineHeightPx = Math.max(14, (lineObj.ascent + lineObj.descent) * scale);

      if (!wordEl) {
        return {
          xPx: contentW / 2,
          topPx: lineTopPx,
          heightPx: lineHeightPx,
          lineKey: targetWord.lineKey,
        };
      }

      const wordRect = wordEl.getBoundingClientRect();
      if (isInSpaceAfterWord) {
        return {
          xPx: wordRect.left - 3 - containerRect.left,
          topPx: lineTopPx,
          heightPx: lineHeightPx,
          lineKey: targetWord.lineKey,
        };
      }

      const localOffset = Math.max(
        0,
        Math.min(targetWord.text.length, targetOffset - targetWord.charStart)
      );
      if (localOffset <= 0) {
        return {
          xPx: wordRect.right - containerRect.left,
          topPx: lineTopPx,
          heightPx: lineHeightPx,
          lineKey: targetWord.lineKey,
        };
      }
      if (localOffset >= targetWord.text.length) {
        return {
          xPx: wordRect.left - containerRect.left,
          topPx: lineTopPx,
          heightPx: lineHeightPx,
          lineKey: targetWord.lineKey,
        };
      }

      const textNode = wordEl.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        try {
          const range = document.createRange();
          range.setStart(textNode, 0);
          range.setEnd(textNode, Math.min(localOffset, (textNode.textContent || '').length));
          const prefixRect = range.getBoundingClientRect();
          if (prefixRect.width > 0 || prefixRect.height > 0) {
            return {
              xPx: prefixRect.left - containerRect.left,
              topPx: lineTopPx,
              heightPx: lineHeightPx,
              lineKey: targetWord.lineKey,
            };
          }
        } catch {
          // Fallback to proportional inside wordRect
        }
      }

      const ratio = localOffset / Math.max(1, targetWord.text.length);
      return {
        xPx: wordRect.right - wordRect.width * ratio - containerRect.left,
        topPx: lineTopPx,
        heightPx: lineHeightPx,
        lineKey: targetWord.lineKey,
      };
    };

    const caretPos = measureOffsetPosition(focus);
    if (caretPos) {
      setCaretVisualPos({
        leftPx: caretPos.xPx,
        topPx: caretPos.topPx,
        heightPx: caretPos.heightPx,
      });
    } else {
      setCaretVisualPos(null);
    }

    if (isCollapsed) {
      setSelectionRectsPx([]);
    } else {
      // Build per-line selection highlight rectangles across [start .. end]
      const rects: Array<{ leftPx: number; topPx: number; widthPx: number; heightPx: number }> = [];
      for (const lineSpan of activeUnitMap.lines) {
        const lineSelStart = Math.max(start, lineSpan.charStart);
        const lineSelEnd = Math.min(end, lineSpan.charEnd);
        if (lineSelEnd <= lineSelStart) continue;

        const pStart = measureOffsetPosition(lineSelStart);
        const pEnd = measureOffsetPosition(lineSelEnd);
        if (pStart && pEnd) {
          const leftEdge = Math.min(pStart.xPx, pEnd.xPx);
          const rightEdge = Math.max(pStart.xPx, pEnd.xPx);
          rects.push({
            leftPx: leftEdge,
            topPx: pStart.topPx,
            widthPx: Math.max(3, rightEdge - leftEdge),
            heightPx: pStart.heightPx,
          });
        }
      }
      setSelectionRectsPx(rects);
    }
  }, [inPlaceSelection, activeUnitMap, scale, contentW, typesetResult]);

  // Global mouseup listener to finish drag text selection
  useEffect(() => {
    if (!isDraggingTextSelection) return;
    const onWindowMouseUp = () => {
      setIsDraggingTextSelection(false);
      // v0.9.2 Part C: never steal focus from the contenteditable
      // overlay (see enableContentEditableEditingRef).
      if (!enableContentEditableEditingRef.current) {
        hiddenInputRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, [isDraggingTextSelection]);

  const handleMouseDownViewport = (e: React.MouseEvent<HTMLDivElement>) => {
    // v0.9.2 Part C: a pointerdown that reaches the viewport (i.e. not
    // stopped by a word/line handler) did not land on page text.
    pointerDownOnTextRef.current = false;
    // Middle mouse button (button === 1) or Spacebar/Pan tool with left button (button === 0)
    if (e.button === 1 || (isPanMode && e.button === 0)) {
      e.preventDefault();
      if (!viewportRef.current) return;
      setIsDraggingPan(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        scrollLeft: viewportRef.current.scrollLeft,
        scrollTop: viewportRef.current.scrollTop,
      };
    }
  };

  const handleMouseMoveViewport = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingPan || !viewportRef.current) return;
    e.preventDefault();
    const dx = e.clientX - panStartRef.current.clientX;
    const dy = e.clientY - panStartRef.current.clientY;
    viewportRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
    viewportRef.current.scrollTop = panStartRef.current.scrollTop - dy;
  };

  const handleMouseUpViewport = () => {
    if (isDraggingPan) {
      setIsDraggingPan(false);
    }
  };

  // Keyboard & Input handlers on the hidden input bridge for direct in-place editing
  const handleHiddenInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!inPlaceSelection || !activeUnitMap) return;

    const isCtrlOrMeta = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exitInPlaceEditing();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isCtrlOrMeta) {
        exitInPlaceEditing();
      } else {
        // Insert a space inside the paragraph flow (paragraphs in ContentUnit are single units)
        const { nextText, nextSelection } = InPlaceEditEngine.applyInsertText(
          activeUnitMap.unitPageText,
          inPlaceSelection,
          ' '
        );
        commitUnitEdit(inPlaceSelection.unitId, nextText, activeUnitMap, nextSelection);
      }
      return;
    }

    // Select All inside the active ContentUnit (`Ctrl+A`)
    if (isCtrlOrMeta && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      setInPlaceSelection({
        unitId: inPlaceSelection.unitId,
        anchorOffset: 0,
        focusOffset: activeUnitMap.unitPageText.length,
      });
      return;
    }

    // Let Ctrl+Z / Ctrl+Y / Ctrl+S bubble to App.tsx global Undo/Redo/Save handler!
    if (isCtrlOrMeta && ['z', 'y', 's'].includes(e.key.toLowerCase())) {
      return;
    }

    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'Home' ||
      e.key === 'End'
    ) {
      e.preventDefault();
      e.stopPropagation();
      const nextSel = InPlaceEditEngine.moveCaretByKey(
        activeUnitMap,
        inPlaceSelection,
        e.key,
        e.shiftKey,
        isCtrlOrMeta
      );
      setInPlaceSelection(nextSel);
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const { nextText, nextSelection } = InPlaceEditEngine.applyBackspace(
        activeUnitMap.unitPageText,
        inPlaceSelection,
        true
      );
      if (nextText !== activeUnitMap.unitPageText) {
        commitUnitEdit(inPlaceSelection.unitId, nextText, activeUnitMap, nextSelection);
      } else {
        setInPlaceSelection(nextSelection);
      }
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      const { nextText, nextSelection } = InPlaceEditEngine.applyDeleteForward(
        activeUnitMap.unitPageText,
        inPlaceSelection
      );
      if (nextText !== activeUnitMap.unitPageText) {
        commitUnitEdit(inPlaceSelection.unitId, nextText, activeUnitMap, nextSelection);
      } else {
        setInPlaceSelection(nextSelection);
      }
      return;
    }
  };

  const handleHiddenInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isComposingImeRef.current) return;
    const val = e.target.value;
    e.target.value = '';
    if (!val || !inPlaceSelection || !activeUnitMap) return;

    const { nextText, nextSelection } = InPlaceEditEngine.applyInsertText(
      activeUnitMap.unitPageText,
      inPlaceSelection,
      val
    );
    commitUnitEdit(inPlaceSelection.unitId, nextText, activeUnitMap, nextSelection);
  };

  const handleHiddenInputCopy = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!inPlaceSelection || !activeUnitMap) return;
    const { start, end, isCollapsed } = InPlaceEditEngine.getNormalizedRange(inPlaceSelection);
    if (isCollapsed) return;
    e.preventDefault();
    const selectedStr = activeUnitMap.unitPageText.slice(start, end);
    e.clipboardData.setData('text/plain', selectedStr);
  };

  const handleHiddenInputCut = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!inPlaceSelection || !activeUnitMap) return;
    const { start, end, isCollapsed } = InPlaceEditEngine.getNormalizedRange(inPlaceSelection);
    if (isCollapsed) return;
    e.preventDefault();
    const selectedStr = activeUnitMap.unitPageText.slice(start, end);
    e.clipboardData.setData('text/plain', selectedStr);
    const { nextText, nextSelection } = InPlaceEditEngine.applyBackspace(
      activeUnitMap.unitPageText,
      inPlaceSelection,
      true
    );
    commitUnitEdit(inPlaceSelection.unitId, nextText, activeUnitMap, nextSelection);
  };

  const handleHiddenInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (!inPlaceSelection || !activeUnitMap) return;
    const pasted = e.clipboardData.getData('text/plain');
    if (!pasted) return;
    e.preventDefault();
    const { nextText, nextSelection } = InPlaceEditEngine.applyInsertText(
      activeUnitMap.unitPageText,
      inPlaceSelection,
      pasted
    );
    commitUnitEdit(inPlaceSelection.unitId, nextText, activeUnitMap, nextSelection);
  };

  // Helper to render a typeset line
  const renderLine = (line: TypesetLine, keyPrefix: string) => {
    const isComment =
      line.role === 'primary_comment' ||
      line.role === 'secondary_comment' ||
      line.role === 'dibbur_hamatchil';
    const isHeading =
      line.role === 'chapter' ||
      line.role === 'main_title' ||
      line.role === 'heading' ||
      line.role === 'siman';
    const isContinuation = line.role === 'continuation';

    const baseFontSizePt =
      line.fontSizePt ??
      (isContinuation
        ? 8.5
        : line.role === 'footnote'
        ? 9.5
        : isComment
        ? 10.5
        : isHeading
        ? 16
        : layoutType === 'mikraot_gedolot'
        ? 16
        : 14.5);
    const fontSizePx = baseFontSizePt * scale;
    const topPx = (line.yBaseline - line.ascent) * scale;

    // Exact content-relative horizontal position in points (0 = left edge of content area, contentWidthPt = right edge):
    const contentWidthPt = geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
    let rightOffsetPt: number;
    if (line.xRight !== undefined) {
      rightOffsetPt = Math.max(0, contentWidthPt - line.xRight);
    } else if (line.xLeft !== undefined) {
      rightOffsetPt = Math.max(0, contentWidthPt - (line.xLeft + line.targetWidth));
    } else if (layoutType === 'rav_text' || layoutType === 'mikraot_gedolot') {
      if (line.role === 'secondary_comment') {
        rightOffsetPt = Math.max(0, contentWidthPt - line.targetWidth);
      } else if (line.role === 'primary_comment' || line.role === 'footnote') {
        rightOffsetPt = line.xStart ?? 0;
      } else {
        rightOffsetPt =
          knee.rightCommentaryWidth + knee.gutterWidth + (line.xStart ?? 0);
      }
    } else {
      rightOffsetPt = line.xStart ?? 0;
    }

    const firstIndentPt = line.firstLineIndentPt ?? line.firstLineIndent ?? 0;
    const hangingIndentPt = line.hangingIndentPt ?? 0;
    const totalRightIndentPt = (line.rightIndentPt ?? 0) + firstIndentPt + hangingIndentPt;
    const leftIndentPt = line.leftIndentPt ?? 0;

    const rightPx = (rightOffsetPt + totalRightIndentPt) * scale;
    const boxSpanPt =
      line.xRight !== undefined && line.xLeft !== undefined
        ? line.xRight - line.xLeft
        : contentWidthPt;
    const widthPx =
      Math.max(
        20,
        line.targetWidth > 0
          ? line.targetWidth
          : boxSpanPt - totalRightIndentPt - leftIndentPt
      ) * scale;

    const lineFontFamily =
      line.fontFamily ||
      (line.role === 'primary_comment'
        ? selectedRashiFont
        : line.role === 'secondary_comment'
        ? selectedTosafotFont
        : selectedFont);

    const nonSpaceWords = line.words.filter(w => !w.isSpace);
    const isRashiRole = line.role === 'primary_comment';
    const isTosafotRole = line.role === 'secondary_comment';

    // v0.6.0 (Part B): NO per-line selection/hover box here any more. A
    // selected or edited section is shown by the ONE unified outline in
    // `blockOverlays` — the old per-line ring + background on every line
    // of the selected unit was fragmented boxing, one box per line.
    const lineKey = `${keyPrefix}-${line.lineIndex}`;

    const effAlign = isContinuation
      ? 'left'
      : isHeading && !line.alignment
      ? 'center'
      : line.isLastLine
      ? line.lastLineAlignment ||
        (line.alignment === 'justify' ? 'right' : line.alignment || 'right')
      : line.alignment || (line.isJustified ? 'justify' : 'right');

    const shouldJustify =
      effAlign === 'justify' && nonSpaceWords.length > 1 && !isHeading && !isContinuation;
    const isCenterAlign = effAlign === 'center';
    const isLeftAlign = effAlign === 'left';

    const firstWord = nonSpaceWords[0];
    const lineTrackingEm = firstWord?.trackingEm ?? line.trackingEm ?? 0;
    const lineScaleX =
      (firstWord?.horizontalScalePercent ?? line.horizontalScalePercent ?? 100) / 100;
    const lineBaselineShiftPx =
      (firstWord?.baselineShiftPt ?? line.baselineShiftPt ?? 0) * scale;
    const lineTextColor =
      firstWord?.textColor ||
      line.textColor ||
      (isContinuation
        ? '#5C5346'
        : isHeading
        ? '#20242B'
        : isComment
        ? '#222120'
        : '#121214');

    return (
      <div
        key={lineKey}
        // v0.5.0 Part B (Module 4): hover targets the whole SECTION.
        // Entering any line of a section highlights the section's single
        // bounding box (see `blockOverlays`); the word spans below no
        // longer paint their own hover boxes. The section's metadata and
        // boundaries go to the state manager via `onHoverBlock`.
        onMouseEnter={() => {
          if (isPanMode || !line.unitId) return;
          setHoveredUnitId(line.unitId);
          onHoverBlock?.(blockInfoForUnit(line.unitId));
        }}
        onMouseLeave={() => {
          setHoveredUnitId(prev => (prev === line.unitId ? null : prev));
          if (hoveredUnitId === line.unitId) onHoverBlock?.(null);
        }}
        onMouseDown={e => {
          if (isPanMode || e.button !== 0 || line.role === 'continuation') return;
          // If clicking in empty space of the line (not directly on a word span), place caret at start or end of this line
          if (e.target === e.currentTarget || (e.target as HTMLElement).parentElement === e.currentTarget) {
            e.stopPropagation();
            // v0.9.2 Part C: keep the editor focused (a mousedown
            // default action would blur an open contenteditable and
            // commit+close it) and mark this pointerdown as "on text"
            // so the click that follows it is never treated as
            // "clicked empty space" (see pointerDownOnTextRef).
            e.preventDefault();
            pointerDownOnTextRef.current = true;
            const targetUnitId = line.unitId;
            if (!targetUnitId) return;
            onSelectUnit?.(targetUnitId);
            onStartEditUnit?.(targetUnitId);
            const map = InPlaceEditEngine.buildUnitPageTextMap(
              typesetResult,
              targetUnitId,
              units.find(u => u.id === targetUnitId)
            );
            const lineSpan = map?.lines.find(l => l.lineKey === lineKey);
            if (map && lineSpan) {
              const rect = e.currentTarget.getBoundingClientRect();
              const midX = (rect.left + rect.right) / 2;
              const offset = e.clientX >= midX ? lineSpan.charStart : lineSpan.charEnd;
              setInPlaceSelection({
                unitId: targetUnitId,
                anchorOffset: offset,
                focusOffset: offset,
              });
              setIsDraggingTextSelection(true);
              setTimeout(() => {
                // v0.9.2 Part C: never steal focus from the
                // contenteditable overlay (see
                // enableContentEditableEditingRef).
                if (!enableContentEditableEditingRef.current) {
                  hiddenInputRef.current?.focus({ preventScroll: true });
                }
              }, 0);
            }
          }
        }}
        className={`absolute transition-colors pointer-events-auto ${
          isContinuation ? 'select-none' : 'cursor-text'
        }`}
        style={{
          top: `${topPx - lineBaselineShiftPx}px`,
          right: `${rightPx}px`,
          width: `${widthPx}px`,
          height: `${line.height * scale}px`,
          direction: line.direction === 'ltr' ? 'ltr' : 'rtl',
          fontFamily: `"${lineFontFamily}", "Frank Ruhl Libre", "David Libre", serif`,
          fontSize: `${fontSizePx}px`,
          lineHeight: 1.18,
          letterSpacing: lineTrackingEm ? `${lineTrackingEm}em` : undefined,
          transform: lineScaleX !== 1 ? `scaleX(${lineScaleX})` : undefined,
          transformOrigin: 'right center',
        }}
      >
        {/* Baseline Visual Guide */}
        {showBaselines && (
          <div
            className="absolute left-0 right-0 border-b border-sky-600/20 pointer-events-none"
            style={{ top: `${line.ascent * scale}px` }}
          />
        )}

        {/* Words Flex Container */}
        <div
          className={`w-full h-full flex flex-row items-baseline ${
            shouldJustify
              ? 'justify-between'
              : isCenterAlign
              ? 'justify-center'
              : isLeftAlign
              ? 'justify-end'
              : 'justify-start'
          }`}
          style={{
            gap: shouldJustify
              ? undefined
              : `${fontSizePx * 0.23 * (line.wordSpacingRatio ?? 1)}px`,
            color: lineTextColor,
          }}
        >
          {line.transitionMarkerBefore && (() => {
            // v0.9.9 (I2): marker style / size / position from the Vilna
            // preset settings. 'boxed' wraps the same text in a small
            // bordered box; 'after_last_word' moves it after the last
            // word of the line (flex order — the line's words keep
            // their order). Size defaults to the legacy 0.96 × line size.
            const tmCfg = typesetResult.designSettings?.ravText?.transitionMarker;
            const markerSizePx = tmCfg?.sizePt ? tmCfg.sizePt * scale : fontSizePx * 0.96;
            return (
              <span
                data-testid="transition-marker"
                title={
                  line.transitionMarkerVerified === false
                    ? t('מעבר משנה לגמרא משוער — מומלץ לאמת')
                    : t('מעבר ממשנה לגמרא')
                }
                className={`font-extrabold select-none shrink-0 ml-1 ${
                  line.transitionMarkerVerified === false
                    ? 'text-[#92400E] underline decoration-dashed decoration-amber-500'
                    : 'text-[#121214]'
                } ${tmCfg?.style === 'boxed' ? 'border border-[#1E1B18] rounded-sm px-1 bg-[#FCFAF5]' : ''}`}
                style={{
                  fontSize: `${markerSizePx}px`,
                  order: tmCfg?.position === 'after_last_word' ? 1 : -1,
                }}
              >
                {line.transitionMarkerBefore}
              </span>
            );
          })()}
          {nonSpaceWords.map((word, wIdx) => {
            const matchingLink = activeLinks?.find(
              l => l.commentaryUnitId === word.unitId || l.sourceUnitId === word.unitId
            );
            const resolvedLinkId = matchingLink?.linkId || word.linkId || null;
            // v0.6.0 (Part B): no per-word box here any more either. A
            // hovered link marks its PAIR OF SECTIONS with the unified
            // `blockOverlays` outlines (kind 'link') plus the SVG connector
            // line — the old per-word ring around the hovered word was the
            // last word-level boxing in the render path.

            const isBoldWord = Boolean(word.isBold || word.isDibbur || isHeading);
            const isItalicWord = Boolean(word.isItalic ?? line.isItalic);
            const isUnderlineWord = Boolean(word.isUnderline ?? line.isUnderline);
            const wordFontSizePx = word.fontSizePt ? word.fontSizePt * scale : undefined;
            const wordFontFamily = word.fontFamily
              ? `"${word.fontFamily}", "${lineFontFamily}", serif`
              : undefined;

            const wordDomKey = `${lineKey}-w-${wIdx}`;
            const targetUnitId = word.unitId || line.unitId;

            return (
              <span
                key={wordDomKey}
                ref={el => {
                  if (el) {
                    wordDomMapRef.current.set(wordDomKey, el);
                  } else {
                    wordDomMapRef.current.delete(wordDomKey);
                  }
                }}
                // v0.9.8 Phase 5: while the anchor overlay is on, a dibbur
                // word is a re-anchor handle (single click arms it).
                title={
                  showAnchorLinks && word.isDibbur
                    ? t('לחצו על דיבור המתחיל, ואחר כך על הביטוי במקור, כדי לקשר מחדש')
                    : undefined
                }
                data-anchor-dibbur={showAnchorLinks && word.isDibbur ? targetUnitId : undefined}
                onMouseEnter={e => {
                  if (resolvedLinkId && !isDraggingTextSelection) {
                    onHoverLink(resolvedLinkId);
                  }
                  if (
                    isDraggingTextSelection &&
                    inPlaceSelection &&
                    targetUnitId === inPlaceSelection.unitId
                  ) {
                    const map = InPlaceEditEngine.buildUnitPageTextMap(
                      typesetResult,
                      targetUnitId,
                      units.find(u => u.id === targetUnitId)
                    );
                    const wSpan = map?.words.find(
                      ws => ws.lineKey === lineKey && ws.wordIndexInLine === wIdx
                    );
                    if (wSpan) {
                      const nextFocus = resolvePointerToUnitCharOffset(
                        targetUnitId,
                        wSpan,
                        e.currentTarget,
                        e.clientX
                      );
                      setInPlaceSelection(prev =>
                        prev ? { ...prev, focusOffset: nextFocus } : null
                      );
                    }
                  }
                }}
                onMouseMove={e => {
                  if (
                    isDraggingTextSelection &&
                    inPlaceSelection &&
                    targetUnitId === inPlaceSelection.unitId
                  ) {
                    const map = InPlaceEditEngine.buildUnitPageTextMap(
                      typesetResult,
                      targetUnitId,
                      units.find(u => u.id === targetUnitId)
                    );
                    const wSpan = map?.words.find(
                      ws => ws.lineKey === lineKey && ws.wordIndexInLine === wIdx
                    );
                    if (wSpan) {
                      const nextFocus = resolvePointerToUnitCharOffset(
                        targetUnitId,
                        wSpan,
                        e.currentTarget,
                        e.clientX
                      );
                      setInPlaceSelection(prev =>
                        prev && prev.focusOffset !== nextFocus
                          ? { ...prev, focusOffset: nextFocus }
                          : prev
                      );
                    }
                  }
                }}
                onMouseLeave={() => {
                  if (resolvedLinkId) onHoverLink(null);
                }}
                onMouseDown={e => {
                  if (isPanMode || e.button !== 0) return;
                  // v0.9.8 Phase 5 — click-to-re-anchor (only while the
                  // anchor overlay is on, so normal editing is untouched
                  // when it is off). Armed: a Main Text word completes the
                  // re-anchor, a dibbur word re-arms to that dibbur.
                  // Unarmed: a click on a dibbur word arms re-anchoring
                  // for it. Double-click still opens in-place editing.
                  if (showAnchorLinks && onReAnchorDibburPick) {
                    if (reAnchorPendingUnitId) {
                      const targetRole = word.role || line.role;
                      if (
                        (targetRole === 'main_source' || targetRole === 'verse') &&
                        targetUnitId
                      ) {
                        e.stopPropagation();
                        e.preventDefault();
                        const unit = units.find(u => u.id === targetUnitId);
                        const off = unit
                          ? charOffsetOfPageWord(typesetResult, unit, lineKey, wIdx)
                          : null;
                        if (off !== null) {
                          onReAnchorTargetPick?.(reAnchorPendingUnitId, targetUnitId, off);
                        }
                        return;
                      }
                      if (word.isDibbur && targetUnitId) {
                        e.stopPropagation();
                        e.preventDefault();
                        onReAnchorDibburPick(targetUnitId);
                        return;
                      }
                    } else if (word.isDibbur && targetUnitId) {
                      e.stopPropagation();
                      e.preventDefault();
                      onReAnchorDibburPick(targetUnitId);
                      return;
                    }
                  }
                  e.stopPropagation();
                  // v0.9.2 Part C: keep the editor focused (a mousedown
                  // default action would blur an open contenteditable
                  // and commit+close it) and mark this pointerdown as
                  // "on text" so the click that follows it is never
                  // treated as "clicked empty space" (see
                  // pointerDownOnTextRef).
                  e.preventDefault();
                  pointerDownOnTextRef.current = true;

                  // v0.3.0 Module E: Alt+Click on a word pins an anchored break
                  // instruction ("page ends before this word"). The anchor is
                  // the unit-global word index, so it survives proof corrections.
                  if (e.altKey && onAddBreakInstruction && targetUnitId) {
                    const map = InPlaceEditEngine.buildUnitPageTextMap(
                      typesetResult,
                      targetUnitId,
                      units.find(u => u.id === targetUnitId)
                    );
                    const wSpan = map?.words.find(
                      ws => ws.lineKey === lineKey && ws.wordIndexInLine === wIdx
                    );
                    const unitWordIndex =
                      (map?.pageWordStartIndex ?? 0) + (wSpan?.wordIndexInUnitSlice ?? wIdx);
                    addBreakInstructionFor(targetUnitId, 'pageEndsBefore', unitWordIndex);
                    return;
                  }

                  if (onSelectUnit && targetUnitId) {
                    onSelectUnit(targetUnitId);
                  }
                  if (onSelectWord && targetUnitId) {
                    onSelectWord(
                      targetUnitId,
                      wIdx,
                      word.text,
                      word.role || line.role
                    );
                  }
                  // v0.5.0 Part A — Module 2: clicking a word no longer opens
                  // the removed HarfBuzz glyph analyzer. Word/unit selection
                  // (design panel targeting + in-place edit) is unchanged.
                  if (targetUnitId && line.role !== 'continuation') {
                    onStartEditUnit?.(targetUnitId);
                    const map = InPlaceEditEngine.buildUnitPageTextMap(
                      typesetResult,
                      targetUnitId,
                      units.find(u => u.id === targetUnitId)
                    );
                    const wSpan = map?.words.find(
                      ws => ws.lineKey === lineKey && ws.wordIndexInLine === wIdx
                    );
                    if (map && wSpan) {
                      const hitOffset = resolvePointerToUnitCharOffset(
                        targetUnitId,
                        wSpan,
                        e.currentTarget,
                        e.clientX
                      );
                      setInPlaceSelection(prev => ({
                        unitId: targetUnitId,
                        anchorOffset:
                          e.shiftKey && prev && prev.unitId === targetUnitId
                            ? prev.anchorOffset
                            : hitOffset,
                        focusOffset: hitOffset,
                      }));
                      setIsDraggingTextSelection(true);
                      setTimeout(() => {
                        // v0.9.2 Part C: never steal focus from the
                        // contenteditable overlay (see
                        // enableContentEditableEditingRef).
                        if (!enableContentEditableEditingRef.current) {
                          hiddenInputRef.current?.focus({ preventScroll: true });
                        }
                      }, 0);
                    }
                  }
                }}
                onDoubleClick={e => {
                  if (isPanMode || !targetUnitId || line.role === 'continuation') return;
                  e.stopPropagation();
                  e.preventDefault();
                  onSelectUnit?.(targetUnitId);
                  onStartEditUnit?.(targetUnitId);
                  const map = InPlaceEditEngine.buildUnitPageTextMap(
                    typesetResult,
                    targetUnitId,
                    units.find(u => u.id === targetUnitId)
                  );
                  const wSpan = map?.words.find(
                    ws => ws.lineKey === lineKey && ws.wordIndexInLine === wIdx
                  );
                  if (map && wSpan) {
                    setInPlaceSelection({
                      unitId: targetUnitId,
                      anchorOffset: wSpan.charStart,
                      focusOffset: wSpan.charEnd,
                    });
                    setIsDraggingTextSelection(false);
                    setTimeout(() => {
                      // v0.9.2 Part C: never steal focus from the
                      // contenteditable overlay (see
                      // enableContentEditableEditingRef).
                      if (!enableContentEditableEditingRef.current) {
                        hiddenInputRef.current?.focus({ preventScroll: true });
                      }
                    }, 0);
                  }
                }}
                style={{
                  fontFamily: wordFontFamily,
                  fontSize: wordFontSizePx ? `${wordFontSizePx}px` : undefined,
                  fontWeight: isBoldWord ? 700 : word.fontWeight ?? line.fontWeight ?? 400,
                  fontStyle: isItalicWord ? 'italic' : 'normal',
                  textDecoration: isUnderlineWord ? 'underline' : undefined,
                  color: word.textColor || undefined,
                }}
                className={`relative rounded-xs transition-colors whitespace-nowrap ${
                  line.role === 'continuation' ? 'cursor-default' : 'cursor-text'
                } ${
                  isBoldWord ? 'font-bold text-[#121214]' : ''
                } ${
                  word.isDibbur
                    ? 'font-extrabold text-[#121214] underline decoration-[#A39B8B]/70 decoration-1 underline-offset-3'
                    : ''
                }`}
              >
                {word.text}
                {word.footnoteMarker !== undefined && (
                  <sup className="text-[0.65em] font-bold text-[#344A67] mr-0.5 select-none">
                    {word.footnoteMarker}
                  </sup>
                )}

                {showAnchors && word.glyphs.some(g => g.isMark) && (
                  <span
                    className={`absolute -top-0.5 right-1/2 w-1 h-1 rounded-full pointer-events-none ${
                      word.glyphs.some(g => g.markType === 'taam')
                        ? 'bg-emerald-600'
                        : 'bg-rose-500'
                    }`}
                  />
                )}
              </span>
            );
          })}
        </div>

        {/* Layout-level commentary / paragraph separator (never mutates rawText) */}
        {(() => {
          if (!line.unitBoundaryAfter) return null;
          const isCommentBoundary = isRashiRole || isTosafotRole || line.role === 'tertiary_comment' || line.role === 'dibbur_hamatchil';
          const sepCfg = isCommentBoundary
            ? typesetResult.designSettings?.ravText?.commentarySeparator
            : typesetResult.designSettings?.ravText?.paragraphSeparator;
          const styleId: SeparatorStyleId = line.separatorStyleIdOverride ?? sepCfg?.styleId ?? 'none';
          if (styleId === 'none') return null;
          const ratio = Math.max(0.15, Math.min(1, sepCfg?.widthRatio ?? 0.45));
          const strokePt = Math.max(0.4, sepCfg?.thicknessPt ?? 0.65);
          const spanPx = Math.max(18, widthPx * ratio);
          const lx = (widthPx - spanPx) / 2;
          const rx = lx + spanPx;
          const midX = widthPx / 2;
          return (
            <svg
              aria-hidden="true"
              className="absolute left-0 pointer-events-none"
              style={{ top: `${Math.max(4, (line.ascent + line.descent + 0.5) * scale)}px` }}
              width={widthPx}
              height={7 * scale}
              viewBox={`0 0 ${widthPx} ${7 * scale}`}
            >
              {styleId === 'colon' && (
                <text
                  x={midX}
                  y={3.5 * scale}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#4B4640"
                  fontFamily='"Frank Ruhl Libre", "Noto Serif Hebrew", serif'
                  fontWeight="700"
                  fontSize={Math.max(10, (line.fontSizePt ?? 14) * 0.9) * scale}
                >
                  :
                </text>
              )}
              {styleId === 'colon_dot' && (
                <circle cx={midX} cy={3.5 * scale} r={Math.max(1.2, strokePt * 1.5) * scale} fill="#4B4640" />
              )}
              {styleId === 'thin_rule' && (
                <line x1={lx} y1={3.5 * scale} x2={rx} y2={3.5 * scale} stroke="#4B4640" strokeWidth={strokePt * scale} />
              )}
              {styleId === 'double_rule' && (
                <g stroke="#4B4640" strokeWidth={strokePt * scale}>
                  <line x1={lx} y1={2.3 * scale} x2={rx} y2={2.3 * scale} />
                  <line x1={lx} y1={4.7 * scale} x2={rx} y2={4.7 * scale} />
                </g>
              )}
              {styleId === 'centered_diamond' && (
                <g>
                  <line x1={lx} y1={3.5 * scale} x2={midX - 5 * scale} y2={3.5 * scale} stroke="#4B4640" strokeWidth={strokePt * scale} />
                  <line x1={midX + 5 * scale} y1={3.5 * scale} x2={rx} y2={3.5 * scale} stroke="#4B4640" strokeWidth={strokePt * scale} />
                  <polygon
                    points={`${midX},${1 * scale} ${midX + 3.2 * scale},${3.5 * scale} ${midX},${6 * scale} ${midX - 3.2 * scale},${3.5 * scale}`}
                    fill="#4B4640"
                  />
                </g>
              )}
              {styleId === 'scrolled_divider' && (
                <g>
                  <path
                    d={`M ${lx} ${3.5 * scale} Q ${lx + spanPx * 0.25} ${1.2 * scale} ${midX - 4 * scale} ${3.5 * scale} M ${midX + 4 * scale} ${3.5 * scale} Q ${rx - spanPx * 0.25} ${5.8 * scale} ${rx} ${3.5 * scale}`}
                    fill="none"
                    stroke="#4B4640"
                    strokeWidth={strokePt * scale}
                  />
                  <circle cx={midX} cy={3.5 * scale} r={1.4 * scale} fill="#4B4640" />
                </g>
              )}
            </svg>
          );
        })()}
      </div>
    );
  };

  return (
    <div
      className={`${
        // v0.3.0 Module E: full-screen preview — the canvas alone, full screen.
        isFullscreenPreview
          ? 'fixed inset-0 z-50 bg-black/90'
          : 'flex-1 bg-[var(--ui-workspace-bg)]'
      } flex flex-col overflow-hidden relative transition-colors duration-150`}
    >
      {/* Scrollable & Pannable Viewport Container */}
      <div
        ref={viewportRef}
        dir="ltr"
        onMouseDown={handleMouseDownViewport}
        onMouseMove={handleMouseMoveViewport}
        onMouseUp={handleMouseUpViewport}
        onMouseLeave={handleMouseUpViewport}
        onClick={() => {
          if (isDraggingPan) return;
          // v0.9.2 Part C: a click whose pointerdown landed on page
          // text is the tail of starting/selecting an edit, not
          // "clicked empty space" — never clear the selection or
          // exit editing for it (see pointerDownOnTextRef).
          if (pointerDownOnTextRef.current) {
            pointerDownOnTextRef.current = false;
            return;
          }
          exitInPlaceEditing();
          setHoveredUnitId(null);
          onHoverBlock?.(null);
          if (onSelectUnit) onSelectUnit(null);
        }}
        className={`flex-1 overflow-auto relative select-none ${
          isDraggingPan
            ? 'cursor-grabbing'
            : isPanMode
            ? 'cursor-grab'
            : 'cursor-default'
        }`}
      >
        {/* Inner Sizing Wrapper that grows with real pixel dimensions of zoomed page so scrollbars cover all 4 edges */}
        <div
          style={{
            minWidth: `${pageW + 96}px`,
            minHeight: `${pageH + 96}px`,
          }}
          className="w-full h-full flex items-center justify-center p-12"
        >
          {/* v0.9.8 Phase 5 — re-anchor hint bar: while a dibbur is armed,
              the next click on a Main Text word is the new anchor.
              v0.9.8 Uniformity Audit — z-40, not dialog level:
              canvas-local overlays stay at or below z-40 so they can
              never cover a dialog (v0.9.6 §4 rule); the bar was added
              at dialog level. */}
          {showAnchorLinks && reAnchorPendingUnitId && (
            <div
              data-testid="reanchor-hint"
              className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[var(--ui-accent)] bg-[var(--ui-surface)] px-3 py-1 text-xs shadow-md"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <span>{t('בחרו ביטוי במקור כדי לקשר את הדיבור')}</span>
              <button
                type="button"
                data-testid="reanchor-cancel"
                onClick={() => onReAnchorCancel?.()}
                className="rounded-full border border-[var(--ui-border)] px-2 py-0.5 hover:bg-[var(--ui-hover)]"
              >
                {t('ביטול קישור מחדש')}
              </button>
            </div>
          )}
          {/* THE HOLY BOOK PAGE SHEET — Warm Ivory Editorial Sheet with Real Scaled Layout Dimensions */}
          <div
            dir="rtl"
            onMouseDown={e => {
              // v0.9.2 Part C: a pointerdown directly on the sheet
              // (not stopped by a word/line handler) did not land on
              // page text.
              if (e.target === e.currentTarget) pointerDownOnTextRef.current = false;
            }}
            onClick={e => {
              e.stopPropagation();
              // v0.9.2 Part C: a click whose pointerdown landed on page
              // text is the tail of starting an edit, not "clicked
              // empty space" — the overlay mounts on mousedown and
              // retargets the click onto this sheet, so target ===
              // currentTarget here does NOT mean empty space.
              if (pointerDownOnTextRef.current) {
                pointerDownOnTextRef.current = false;
                return;
              }
              if (e.target === e.currentTarget) {
                exitInPlaceEditing();
                if (onSelectUnit) onSelectUnit(null);
              }
            }}
            className="relative bg-[var(--ui-page-bg)] text-[#161514] shadow-[var(--ui-page-shadow)] border border-[var(--ui-page-border)] shrink-0 overflow-hidden"
            style={{
              width: `${pageW}px`,
              height: `${pageH}px`,
              // v0.3.0 Module E: page background (colour / image) when provided.
              backgroundColor: pageBackground?.color || undefined,
              backgroundImage: pageBackground?.imageUrl
                ? `url(${pageBackground.imageUrl})`
                : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {/* Subtle Paper Texture */}
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.025]"
              style={{
                backgroundImage:
                  'radial-gradient(#292524 0.75px, transparent 0.75px), radial-gradient(#292524 0.75px, #FFFDF7 0.75px)',
                backgroundSize: '24px 24px',
              }}
            />

            {/* v0.5.0 (Title Page / Shaar Blat builder): the title page has
                no typeset lines — the overlay draws its border and editable
                fields from `designSettings.titlePage` instead. */}
            {isTitlePage && !typesetResult.isBackOfTitle && titlePageSettings && (
              <TitlePageOverlay
                titlePage={titlePageSettings}
                bookTitle={headerTitle}
                pageWidthPt={geometry.pageWidth}
                pageHeightPt={geometry.pageHeight}
                scale={scale}
                marginInPx={marginIn}
                marginOutPx={marginOut}
                fontFamilyDefault={selectedFont ?? 'Frank Ruhl Libre'}
                onFieldChange={onTitlePageFieldChange}
                onFieldPositionChange={onTitlePageFieldPositionChange}
              />
            )}

            {/* Traditional Running Header (כותרת רצה ומספר דף) */}
            {/* v0.6.0 Part A (§5): the three slots are editable (right =
                folio, centre = book title, left = chapter/edition label),
                globally and per folio, each with its own toggle, plus
                alignment / font / size. DOM order is right-to-left: in
                this RTL band the first child sits on the visual right.
                The band collapses entirely when the header line is off and
                no folio needs the top band; the content reflows because
                pagination reserves (or releases) the band height above the
                text — the band itself stays inside the top margin, so it
                never overlaps the text. v0.5.0 (Title Page): never on a
                title page. */}
            {/* Layout training T2.1 — Vilna running head. The engine laid
                out every word in physical page pt, so x maps straight to
                screen px. Replaces the generic band, folio and footer. */}
            {vilnaHeader && !isTitlePage &&
              vilnaHeader.items.flatMap((it, ii) =>
                it.words.map((w, wi) => (
                  <span
                    key={`vh-${ii}-${wi}`}
                    data-testid={it.kind === 'folio' ? 'vilna-header-folio' : 'vilna-header-title'}
                    className="absolute pointer-events-none text-[#1E1C1A] whitespace-nowrap"
                    style={{
                      left: `${w.xLeft * scale}px`,
                      width: `${(w.xRight - w.xLeft) * scale}px`,
                      top: `${(it.yBaseline - it.fontSizePt * 0.82) * scale}px`,
                      fontSize: `${it.fontSizePt * scale}px`,
                      lineHeight: 1,
                      fontWeight: it.fontWeight,
                      fontFamily: `"${it.fontFamily}", "Frank Ruhl Libre", serif`,
                      direction: 'rtl',
                      textAlign: 'right',
                    }}
                  >
                    {w.text}
                  </span>
                ))
              )}

            {showHeaderBand && !isTitlePage && !vilnaHeader && (
              <div
                className={`absolute flex items-end pb-1 text-[#1E1C1A] ${
                  showTopHeaderLine && showHeaderDividerRule ? 'border-b-2 border-[#2A2622]/75' : ''
                }`}
                style={{
                  top: `${marginT * 0.36}px`,
                  right: `${marginIn}px`,
                  left: `${marginOut}px`,
                  height: `${marginT * 0.48}px`,
                  fontFamily: `"${headerFontFamily}", "Frank Ruhl Libre", serif`,
                  justifyContent: headerJustify,
                }}
              >
                {resolvedHeader.right.visible && (
                  <span
                    className="font-bold tracking-wide"
                    style={{ fontSize: `${headerFontSizePt * scale}px` }}
                  >
                    {resolvedHeader.right.text}
                  </span>
                )}
                {showTopHeaderLine && resolvedHeader.center.visible && (
                  <span
                    className={`font-extrabold tracking-wider ${
                      onHeaderTitleChange ? 'cursor-text hover:outline hover:outline-1 hover:outline-dashed hover:outline-[#b0a58e] rounded px-1' : ''
                    }`}
                    style={{
                      fontSize: `${headerFontSizePt * scale}px`,
                    }}
                    onClick={e => {
                      if (!onHeaderTitleChange) return;
                      e.stopPropagation();
                      setEditingHeaderTitle(true);
                    }}
                    title={onHeaderTitleChange ? t('לחץ כדי לערוך את כותרת הדף') : undefined}
                  >
                    {resolvedHeader.center.text}
                  </span>
                )}
                {showTopHeaderLine && resolvedHeader.left.visible && (
                  <span
                    className="font-semibold text-[#5C5346]"
                    style={{ fontSize: `${headerFontSizePt * 0.85 * scale}px` }}
                  >
                    {resolvedHeader.left.text}
                  </span>
                )}
              </div>
            )}

            {/* v0.6.0 Part C (§6): the running-header title edits in place
                (same contenteditable editor as the body text); the commit
                renames the book, so the header, title page fallback and
                folio all follow. The folio number itself is derived from
                the page number and is not editable text. */}
            {editingHeaderTitle && onHeaderTitleChange && !isTitlePage && (
              <div
                className="absolute z-40"
                style={{
                  top: `${marginT * 0.36}px`,
                  right: `${marginIn}px`,
                  left: `${marginOut}px`,
                }}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
              >
                <InlineTextEditor
                  unitId="running-header-title"
                  initialText={headerTitle}
                  dir="rtl"
                  fontSizePt={14.5}
                  onCommit={text => {
                    setEditingHeaderTitle(false);
                    if (text.trim()) onHeaderTitleChange(text.trim());
                  }}
                  onCancel={() => setEditingHeaderTitle(false)}
                />
              </div>
            )}

            {/* Commentary Labels for Rav-Text or Mikraot Gedolot */}
            {/* v0.5.0 (integrator — user request): off by default on fresh
                books; the user turns them on ("Show commentary labels").
                v0.5.0 (Title Page): never on a title page. */}
            {showCommentaryLabels && !isTitlePage && !vilnaHeader && (layoutType === 'rav_text' || layoutType === 'mikraot_gedolot') && (
              <div
                className="absolute flex justify-between pointer-events-none text-[#5C5346] font-bold"
                style={{
                  top: `${marginT - 13 * scale}px`,
                  right: `${marginIn}px`,
                  left: `${marginOut}px`,
                  fontSize: `${8.5 * scale}px`,
                  fontFamily: '"Frank Ruhl Libre", serif',
                }}
              >
                {geometry.isVerso ? (
                  <>
                    <span>{layoutType === 'mikraot_gedolot' ? t("אונקלוס / רמב״ן") : t("תוספות")}</span>
                    <span>{t("רש״י")}</span>
                  </>
                ) : (
                  <>
                    <span>{t("רש״י")}</span>
                    <span>{layoutType === 'mikraot_gedolot' ? t("אונקלוס / רמב״ן") : t("תוספות")}</span>
                  </>
                )}
              </div>
            )}

            {/* Cross-Page Continuation Header Banner (המשך מעמוד קודם) */}
            {continuationHeader && (
              <div
                className="absolute pointer-events-none flex items-center justify-end text-[#5C5346] italic"
                style={{
                  top: `${marginT - 12 * scale}px`,
                  right: `${marginIn + contentW * 0.25}px`,
                  left: `${marginOut + contentW * 0.25}px`,
                  fontSize: `${7.5 * scale}px`,
                  fontFamily: '"Frank Ruhl Libre", serif',
                }}
              >
                <span className="bg-[#F4EFE4] px-1.5 py-0.2 rounded border border-[#D8D0C0] shadow-2xs">
                  {continuationHeader}
                </span>
              </div>
            )}

            {/* Main Content Area Container */}
            <div
              ref={contentAreaRef}
              onMouseLeave={() => {
                setHoveredUnitId(null);
                onHoverBlock?.(null);
              }}
              onPointerDown={onDrawPointerDown}
              onPointerMove={e => { onBoxFramePointerMove(e); onDrawPointerMove(e); }}
              onPointerUp={() => { onBoxFramePointerUp(); onDrawPointerUp(); }}
              onClick={e => {
                // v0.9.2 Part C: a click whose pointerdown landed on
                // page text is the tail of starting an edit, not
                // "clicked empty space" (see pointerDownOnTextRef).
                if (pointerDownOnTextRef.current) {
                  pointerDownOnTextRef.current = false;
                  return;
                }
                if (e.target === e.currentTarget) {
                  exitInPlaceEditing();
                  if (onSelectUnit) onSelectUnit(null);
                }
              }}
              className="absolute"
              style={{
                top: `${marginT}px`,
                right: `${marginIn}px`,
                width: `${contentW}px`,
                height: `${contentH}px`,
                cursor: isDrawTool ? 'crosshair' : undefined,
              }}
            >
              {/* Hidden IME & Keyboard Input Bridge for Direct In-Place Caret Editing (Zero Visual Box!) */}
              <input
                ref={hiddenInputRef}
                type="text"
                dir="rtl"
                aria-label={t("עריכת טקסט ישירה על הדף")}
                onKeyDown={handleHiddenInputKeyDown}
                onChange={handleHiddenInputChange}
                onCopy={handleHiddenInputCopy}
                onCut={handleHiddenInputCut}
                onPaste={handleHiddenInputPaste}
                onCompositionStart={() => {
                  isComposingImeRef.current = true;
                }}
                onCompositionEnd={e => {
                  isComposingImeRef.current = false;
                  const val = e.currentTarget.value;
                  e.currentTarget.value = '';
                  if (val && inPlaceSelection && activeUnitMap) {
                    const { nextText, nextSelection } = InPlaceEditEngine.applyInsertText(
                      activeUnitMap.unitPageText,
                      inPlaceSelection,
                      val
                    );
                    commitUnitEdit(
                      inPlaceSelection.unitId,
                      nextText,
                      activeUnitMap,
                      nextSelection
                    );
                  }
                }}
                style={{
                  position: 'absolute',
                  left: `${caretVisualPos?.leftPx ?? 0}px`,
                  top: `${caretVisualPos?.topPx ?? 0}px`,
                  width: '1px',
                  height: `${caretVisualPos?.heightPx ?? 16}px`,
                  opacity: 0,
                  pointerEvents: 'none',
                  border: 'none',
                  padding: 0,
                  margin: 0,
                }}
              />

              {/* Direct In-Place Range Selection Highlight Rectangles */}
              {selectionRectsPx.map((rect, rIdx) => (
                <div
                  key={`sel-rect-${rIdx}`}
                  className="absolute bg-[#344A67]/22 pointer-events-none z-20 rounded-[1px]"
                  style={{
                    left: `${rect.leftPx}px`,
                    top: `${rect.topPx}px`,
                    width: `${rect.widthPx}px`,
                    height: `${rect.heightPx}px`,
                  }}
                />
              ))}

              {/* Direct In-Place Blinking Caret Inside the Actual Typeset Line */}
              {inPlaceSelection && caretVisualPos && (
                <div
                  data-testid="in-place-page-caret"
                  className="absolute w-[2px] bg-[#1E3A8A] pointer-events-none z-30 animate-pulse shadow-[0_0_2px_rgba(30,58,138,0.45)]"
                  style={{
                    left: `${caretVisualPos.leftPx - 1}px`,
                    top: `${caretVisualPos.topPx}px`,
                    height: `${caretVisualPos.heightPx}px`,
                  }}
                />
              )}

              {/* v0.5.0 Part C — Module 8: contenteditable overlay editor ----
                  --- BEGIN Part C PageCanvas render hunk (only hunk in this
                  file) --- Renders ONLY when `enableContentEditableEditing`
                  is on and a block is being edited; otherwise nothing here
                  exists and Stage 17I behaviour is byte-identical. The
                  overlay sits over the block's first typeset line (its
                  `yTop`/`yBaseline` in pt × `scale`), commits through the
                  SAME `commitUnitEdit` path as the hidden-input editor (so
                  the text joins the existing undo history with the page
                  slice spliced back into the full unit), and closes via
                  `exitInPlaceEditing`. The other worker's hover/selection
                  work touches different lines of this file. */}
              {enableContentEditableEditing &&
                inPlaceSelection &&
                activeUnitMap &&
                activeEditUnit &&
                (() => {
                  const firstLine = activeUnitMap.lines[0]?.lineObj;
                  const topPx = firstLine
                    ? Math.max(
                        0,
                        (firstLine.yTop ??
                          firstLine.yBaseline - firstLine.ascent) * scale
                      )
                    : 0;
                  const pageText = activeUnitMap.unitPageText;
                  // v0.6.0 Part C (§6): on a custom-layout page, when the
                  // edited block lives inside ONE box, the editor sits
                  // inside that box's frame instead of spanning the whole
                  // content width.
                  const editBoxIds = Array.from(
                    new Set(
                      activeUnitMap.lines
                        .map(l => l.lineObj.customLayoutBoxId)
                        .filter((id): id is string => Boolean(id))
                    )
                  );
                  const editBox =
                    editBoxIds.length === 1
                      ? effectiveBoxes.find(b => b.id === editBoxIds[0])
                      : undefined;
                  const editorStyle: React.CSSProperties = editBox
                    ? {
                        left: `${(editBox.xPct / 100) * contentW}px`,
                        width: `${(editBox.widthPct / 100) * contentW}px`,
                        top: `${Math.max(topPx, (editBox.yPct / 100) * contentH)}px`,
                      }
                    : { left: 0, right: 0, top: `${topPx}px` };
                  return (
                    <div
                      className="absolute z-40"
                      style={editorStyle}
                      onClick={e => e.stopPropagation()}
                      onMouseDown={e => e.stopPropagation()}
                    >
                      <InlineTextEditor
                        unitId={activeEditUnit.id}
                        initialText={pageText}
                        dir={/[\u0590-\u05FF]/.test(pageText) ? 'rtl' : 'ltr'}
                        fontSizePt={firstLine?.fontSizePt ?? 14}
                        onCommit={text => {
                          commitUnitEdit(
                            activeEditUnit.id,
                            text,
                            activeUnitMap,
                            {
                              unitId: activeEditUnit.id,
                              anchorOffset: text.length,
                              focusOffset: text.length,
                            }
                          );
                          // v0.9.2 Part C: only close when this unit is
                          // still the one being edited — a commit for a
                          // previous unit (unit switch, or a blur that
                          // lands after a new edit started) must not
                          // close the new edit.
                          if (editingUnitIdRef.current === activeEditUnit.id) {
                            exitInPlaceEditing();
                          }
                        }}
                        onCancel={() => {
                          if (editingUnitIdRef.current === activeEditUnit.id) {
                            exitInPlaceEditing();
                          }
                        }}
                        onFormatChange={patch =>
                          onInlineFormatChange?.(activeEditUnit.id, patch)
                        }
                      />
                    </div>
                  );
                })()}
              {/* --- END Part C PageCanvas render hunk --- */}

              {/* v0.6.0 Part C (§6): movable custom-layout box frames in the
                  main preview. Only the thin edges + corner handle take the
                  pointer (the interior stays click-through to the text),
                  and only while "הזז תיבות" is on. Dragging reflows the
                  text live on commit (parent re-paginates from the new
                  boxes, saved as this folio's page override). */}
              {canMoveBoxes && moveBoxesMode &&
                effectiveBoxes.map(box => {
                  const isActive = box.id === activeBoxId;
                  const edgeCls =
                    'absolute bg-[var(--ui-accent)]/70 hover:bg-[var(--ui-accent)] pointer-events-auto touch-none';
                  return (
                    <div
                      key={`movebox-${box.id}`}
                      className="absolute z-30 pointer-events-none"
                      style={{
                        left: `${(box.xPct / 100) * contentW}px`,
                        top: `${(box.yPct / 100) * contentH}px`,
                        width: `${(box.widthPct / 100) * contentW}px`,
                        height: `${(box.heightPct / 100) * contentH}px`,
                        transform: `rotate(${box.rotationDeg ?? 0}deg) skewX(${box.skewXDeg ?? 0}deg)`,
                        transformOrigin: 'center',
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div
                        className={`absolute inset-0 border-2 ${
                          isActive
                            ? 'border-[var(--ui-accent)]'
                            : 'border-dashed border-[var(--ui-accent)]/60'
                        } rounded-[2px]`}
                      />
                      <div
                        role="button"
                        aria-label={t('גרור תיבה')}
                        title={t('גרור כדי להזיז את התיבה בדף זה')}
                        onPointerDown={e => onBoxFramePointerDown(e, box, 'move')}
                        className={`${edgeCls} top-0 left-0 right-0 h-[7px] cursor-move`}
                      />
                      <div
                        role="button"
                        aria-label={t('גרור תיבה')}
                        onPointerDown={e => onBoxFramePointerDown(e, box, 'move')}
                        className={`${edgeCls} bottom-0 left-0 right-0 h-[7px] cursor-move`}
                      />
                      <div
                        role="button"
                        aria-label={t('גרור תיבה')}
                        onPointerDown={e => onBoxFramePointerDown(e, box, 'move')}
                        className={`${edgeCls} top-0 bottom-0 left-0 w-[7px] cursor-move`}
                      />
                      <div
                        role="button"
                        aria-label={t('גרור תיבה')}
                        onPointerDown={e => onBoxFramePointerDown(e, box, 'move')}
                        className={`${edgeCls} top-0 bottom-0 right-0 w-[7px] cursor-move`}
                      />
                      <div
                        role="button"
                        aria-label={t('שנה גודל תיבה')}
                        title={t('גרור כדי לשנות את גודל התיבה בדף זה')}
                        onPointerDown={e => onBoxFramePointerDown(e, box, 'resize')}
                        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize bg-[var(--ui-accent)] rounded-tl-md pointer-events-auto touch-none"
                      />
                      {/* v0.7.0 Part 2 (M3): skew handle (top-center) + vertex
                          handles for polygon frames — drag a vertex to reshape
                          the flow region; the text reflows on commit. */}
                      <div
                        role="button"
                        aria-label={t('הטה תיבה')}
                        title={t('גרור אופקית להטיית מסגרת התצוגה בלבד — הטקסט נשאר ישר')}
                        onPointerDown={e => onBoxFramePointerDown(e, box, 'skew')}
                        className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-[var(--ui-accent)] border border-white pointer-events-auto touch-none cursor-ew-resize"
                      />
                      {box.shape?.points.map((pt, vi) => (
                        <div
                          key={`vx-${vi}`}
                          role="button"
                          aria-label={t('נקודת קודקוד')}
                          title={t('גרור כדי להזיז את נקודת הקודקוד')}
                          onPointerDown={e => onBoxFramePointerDown(e, box, 'vertex', vi)}
                          className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 bg-white border-2 border-[var(--ui-accent)] rounded-[2px] pointer-events-auto touch-none cursor-move"
                          style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                        />
                      ))}
                      <div className="absolute -top-5 right-0 px-1.5 py-0.5 rounded bg-[var(--ui-surface)] border border-[var(--ui-border)] text-[10px] text-[var(--ui-text-secondary)] whitespace-nowrap pointer-events-none">
                        {(lang === 'en' ? box.labelEn : box.labelHe) ?? box.role}
                      </div>
                    </div>
                  );
                })}

              {/* v0.7.0 Part 2 (M3): text-threading indicators — out-port →
                  in-port lines between consecutive boxes on this page, plus
                  an out-port arrow when the story continues to the next page.
                  v0.8.0 Part E: these lines are an automatic display of the
                  text flow, inferred from box order — there is no manual
                  link/unlink UI, and the title says so. */}
              {showThreading && (threadLinks?.length ?? 0) > 0 && (
                <svg className="absolute inset-0 z-25 pointer-events-none" width={contentW} height={contentH} viewBox={`0 0 ${contentW} ${contentH}`}>
                  <title>{t('קווי זרימת טקסט אוטומטיים לפי סדר התיבות — אין קישור/ניתוק ידני')}</title>
                  {(threadLinks ?? []).map((link, i) => {
                    const from = effectiveBoxes.find(b => b.id === link.fromBoxId);
                    if (!from) return null;
                    const fx = ((from.xPct + from.widthPct / 2) / 100) * contentW;
                    const fy = ((from.yPct + from.heightPct) / 100) * contentH;
                    if (link.continuesOffPage || !link.toBoxId) {
                      return (
                        <g key={`th-${i}`} stroke="var(--ui-accent)" fill="var(--ui-accent)">
                          <line x1={fx} y1={fy} x2={fx} y2={fy + 18} strokeWidth={2} />
                          <polygon points={`${fx},${fy + 26} ${fx - 5},${fy + 16} ${fx + 5},${fy + 16}`} />
                          <circle cx={fx} cy={fy} r={4} fill="none" strokeWidth={2} />
                        </g>
                      );
                    }
                    const to = effectiveBoxes.find(b => b.id === link.toBoxId);
                    if (!to) return null;
                    const tx = ((to.xPct + to.widthPct / 2) / 100) * contentW;
                    const ty = (to.yPct / 100) * contentH;
                    return (
                      <g key={`th-${i}`} stroke="var(--ui-accent)" fill="var(--ui-accent)">
                        <circle cx={fx} cy={fy} r={4} fill="none" strokeWidth={2} />
                        <line x1={fx} y1={fy} x2={tx} y2={ty} strokeWidth={2} strokeDasharray="5 3" />
                        <polygon points={`${tx},${ty} ${tx - 5},${ty - 8} ${tx + 5},${ty - 8}`} />
                        <circle cx={tx} cy={ty} r={4} fill="none" strokeWidth={2} />
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* v0.8.0 Part E (#14): drag-to-draw preview rect — the frame
                  being dragged, dashed so it reads as a draft, not a box. */}
              {drawPreview && (
                <div
                  className="absolute z-30 border-2 border-dashed border-[var(--ui-accent)] bg-[var(--ui-accent)]/10 pointer-events-none"
                  style={{
                    left: `${drawPreview.xPct}%`,
                    top: `${drawPreview.yPct}%`,
                    width: `${drawPreview.widthPct}%`,
                    height: `${drawPreview.heightPct}%`,
                  }}
                />
              )}

              {/* SVG Overlay for Dynamic Knees & Visual Link Lines */}
              <svg
                ref={anchorSvgRef}
                data-testid="anchor-overlay-svg"
                className="absolute inset-0 pointer-events-none z-20"
                width={contentW}
                height={contentH}
              >
                {/* 1. Dynamic Knee Guide Contour */}
                {showKneeGuide &&
                  (layoutType === 'rav_text' || layoutType === 'mikraot_gedolot') && (
                    <g>
                      {knee.sourceContourBands && knee.sourceContourBands.length > 0 ? (
                        knee.sourceContourBands.map((band, bIdx) => (
                          <rect
                            key={`band-${bIdx}`}
                            x={band.sourceXLeft * scale}
                            y={band.yTop * scale}
                            width={band.sourceWidth * scale}
                            height={Math.max(2, (band.yBottom - band.yTop) * scale)}
                            fill="rgba(52, 74, 103, 0.035)"
                            stroke="#344A67"
                            strokeWidth="1"
                            strokeDasharray="3 2"
                          />
                        ))
                      ) : (
                        <>
                          <rect
                            x={(knee.leftCommentaryWidth + knee.gutterWidth) * scale}
                            y={(knee.upperKneeY ?? 0) * scale}
                            width={knee.upperSourceWidth * scale}
                            height={
                              (knee.kneeJunctionY - (knee.upperKneeY ?? 0)) * scale
                            }
                            fill="rgba(52, 74, 103, 0.04)"
                            stroke="#344A67"
                            strokeWidth="1.2"
                            strokeDasharray="4 3"
                          />
                          <rect
                            x={
                              (knee.leftCommentaryWidth +
                                knee.gutterWidth +
                                (knee.isLeftStepped ? knee.innerXOffset : 0)) *
                              scale
                            }
                            y={knee.kneeJunctionY * scale}
                            width={knee.lowerSourceWidth * scale}
                            height={
                              Math.max(
                                0,
                                (knee.sourceEndY ?? knee.bottomY) - knee.kneeJunctionY
                              ) * scale
                            }
                            fill="rgba(52, 74, 103, 0.06)"
                            stroke="#344A67"
                            strokeWidth="1.2"
                            strokeDasharray="4 3"
                          />
                        </>
                      )}

                      {(knee.upperKneeY ?? 0) > 0 && (
                        <line
                          x1={0}
                          y1={(knee.upperKneeY ?? 0) * scale}
                          x2={contentW}
                          y2={(knee.upperKneeY ?? 0) * scale}
                          stroke="#344A67"
                          strokeWidth="1"
                          strokeDasharray="3 3"
                        />
                      )}

                      <line
                        x1={0}
                        y1={knee.kneeJunctionY * scale}
                        x2={contentW}
                        y2={knee.kneeJunctionY * scale}
                        stroke="#B8741A"
                        strokeWidth="1.5"
                        strokeDasharray="5 3"
                      />
                    </g>
                  )}

                {/* 2. Two-Column Vertical Divider */}
                {layoutType === 'two_column' && (
                  <line
                    x1={contentW / 2}
                    y1={0}
                    x2={contentW / 2}
                    y2={contentH * 0.88}
                    stroke="#A39B8B"
                    strokeWidth={1 * scale}
                  />
                )}

                {/* 3. Top-Source / Bottom-Commentary Horizontal Divider */}
                {layoutType === 'source_top_commentary_bottom' && dividerY && (
                  <g>
                    <line
                      x1={0}
                      y1={dividerY * scale}
                      x2={contentW}
                      y2={dividerY * scale}
                      stroke="#44403C"
                      strokeWidth={1.2 * scale}
                    />
                    <line
                      x1={0}
                      y1={(dividerY + 2.5) * scale}
                      x2={contentW}
                      y2={(dividerY + 2.5) * scale}
                      stroke="#78716C"
                      strokeWidth={0.5 * scale}
                    />
                    <line
                      x1={contentW / 2}
                      y1={(dividerY + 8) * scale}
                      x2={contentW / 2}
                      y2={contentH * 0.88}
                      stroke="#A8A29E"
                      strokeWidth={0.8 * scale}
                    />
                  </g>
                )}

                {/* 4. Anchor-Link Connectors (v0.9.8 Phase 5) — REAL geometry:
                    each path joins the measured centres of the dibbur word
                    span and its target-phrase word span on this page
                    (see `measuredConnectors`). The old block here was a
                    hardcoded decorative arc at fixed page fractions — it
                    connected nothing and is deleted, not kept. A link
                    whose target is not on this page draws as a short stub
                    from its dibbur end; an unmatched link draws dashed
                    red. Hovering a connector highlights it and names the
                    dibbur; clicking it selects the commentary unit. */}
                {showAnchorLinks && measuredConnectors.length > 0 && (
                  <g data-testid="anchor-connectors" style={{ pointerEvents: 'auto' }}>
                    {measuredConnectors.map(c => (
                      <g
                        key={c.linkId}
                        onMouseEnter={() => setHoveredAnchorLinkId(c.linkId)}
                        onMouseLeave={() => setHoveredAnchorLinkId(null)}
                        onClick={() => {
                          const unitId = c.linkId.replace(/^anchor-/, '');
                          onSelectUnit?.(unitId);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {c.d !== null ? (
                          <path
                            d={c.d}
                            fill="none"
                            stroke={c.color}
                            strokeWidth={hoveredAnchorLinkId === c.linkId ? 2.5 : 1.5}
                            strokeDasharray={c.unmatched ? '4 3' : undefined}
                            opacity={hoveredAnchorLinkId === c.linkId ? 1 : 0.75}
                          />
                        ) : (
                          <line
                            x1={c.x1}
                            y1={c.y1}
                            x2={c.x1 + 14}
                            y2={c.y1 - 10}
                            stroke={c.color}
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            opacity={0.75}
                          />
                        )}
                        <circle
                          cx={c.x1}
                          cy={c.y1}
                          r={hoveredAnchorLinkId === c.linkId ? 4 : 3}
                          fill={c.color}
                        />
                        {c.x2 !== null && c.y2 !== null && (
                          <circle
                            cx={c.x2}
                            cy={c.y2}
                            r={hoveredAnchorLinkId === c.linkId ? 4 : 3}
                            fill="none"
                            stroke={c.color}
                            strokeWidth={1.5}
                          />
                        )}
                        {hoveredAnchorLinkId === c.linkId && (
                          <title>
                            {c.dibburText}
                            {c.targetText ? ` → ${c.targetText}` : ''}
                            {c.unmatched ? ` (${t('קישור לא מאומת')})` : ''}
                          </title>
                        )}
                      </g>
                    ))}
                  </g>
                )}
              </svg>

              {/* v0.8.0 Part C (§9): one isolated absolutely-positioned
                  container per tier with an explicit z-index stack, so
                  tiers can never overlap or collapse into each other when
                  presets are applied or modes toggled. The containers are
                  pointer-events-none — only the lines themselves (see
                  renderLine's pointer-events-auto) receive mouse events,
                  so the stacked containers never swallow clicks. */}
              <div data-tier="source" className="absolute inset-0 z-20 pointer-events-none">
                {sourceLines.map(line => renderLine(line, 'src'))}
              </div>
              {column2Lines && (
                <div data-tier="column2" className="absolute inset-0 z-20 pointer-events-none">
                  {column2Lines.map(line => renderLine(line, 'col2'))}
                </div>
              )}
              <div data-tier="rashi" className="absolute inset-0 z-20 pointer-events-none">
                {rashiLines.map(line => renderLine(line, 'rashi'))}
              </div>
              <div data-tier="tosafot" className="absolute inset-0 z-20 pointer-events-none">
                {tosafotLines.map(line => renderLine(line, 'tosafot'))}
              </div>
              {typesetResult.marginLines && typesetResult.marginLines.length > 0 && (
                <div data-tier="margin" className="absolute inset-0 z-20 pointer-events-none">
                  {typesetResult.marginLines.map(line => renderLine(line, 'margin'))}
                </div>
              )}
              {tertiaryLines && tertiaryLines.length > 0 && (
                <div data-tier="tertiary" className="absolute inset-0 z-20 pointer-events-none">
                  {tertiaryLines.map(line => renderLine(line, 'tertiary'))}
                </div>
              )}
              {peripheralStreams && peripheralStreams.length > 0 && (
                <div data-tier="peripheral" className="absolute inset-0 z-[18] pointer-events-none">
                  {peripheralStreams.map(block => (
                    <React.Fragment key={block.stream}>
                      {block.lines[0] && (
                        <div
                          className="absolute text-[#6B5E4C] font-bold"
                          style={{
                            top: `${Math.max(0, (block.lines[0].yBaseline - block.lines[0].ascent - 9) * scale)}px`,
                            left: `${(block.lines[0].xLeft ?? 0) * scale}px`,
                            width: `${Math.max(24, ((block.lines[0].xRight ?? 40) - (block.lines[0].xLeft ?? 0)) * scale)}px`,
                            fontSize: `${7.5 * scale}px`,
                            textAlign: 'center',
                            fontFamily: '"Frank Ruhl Libre", serif',
                          }}
                        >
                          {lang === 'en' ? block.labelEn : block.labelHe}
                        </div>
                      )}
                      {block.lines.map(line => renderLine(line, `periph-${block.stream}`))}
                    </React.Fragment>
                  ))}
                </div>
              )}
              {/* Opening Word Ornamental Frame (rendered cleanly in reserved gap with centered title text) */}
              {openingWordBox && (() => {
                const bx = openingWordBox.xLeft * scale;
                const by = openingWordBox.yTop * scale;
                const bw = Math.max(24 * scale, (openingWordBox.xRight - openingWordBox.xLeft) * scale);
                const bh = Math.max(18 * scale, (openingWordBox.yBottom - openingWordBox.yTop) * scale);
                const bMidX = bx + bw / 2;
                const bMidY = by + bh / 2;
                const wordFontPx = Math.max(11, Math.min(bh * 0.52, (bw * 0.72) / Math.max(2, openingWordBox.text.length * 0.52)));
                // v0.9.9 (I2): frame stroke from the opening-decoration
                // settings (default 1.1pt — the pre-v0.9.9 look).
                const frameStroke =
                  Math.max(0.4, Math.min(4, typesetResult.designSettings?.ravText?.openingDecoration?.thicknessPt ?? 1.1)) * scale;
                return (
                  <svg
                    data-testid="opening-word-box"
                    className="absolute inset-0 z-[25] pointer-events-none"
                    width={contentW}
                    height={contentH}
                  >
                    <rect x={bx} y={by} width={bw} height={bh} rx={openingWordBox.styleId === 'chumash_cartouche' ? 6 * scale : 0} fill="#FCFAF5" stroke="#1E1B18" strokeWidth={frameStroke} />
                    {openingWordBox.styleId !== 'simple_frame' && openingWordBox.styleId !== 'stepped_frame' && (
                      <rect x={bx + 3.5 * scale} y={by + 3.5 * scale} width={Math.max(4, bw - 7 * scale)} height={Math.max(4, bh - 7 * scale)} fill="none" stroke="#1E1B18" strokeWidth={0.6 * scale} />
                    )}
                    {openingWordBox.styleId === 'patterned_rect' && (() => {
                      // Repeating tick pattern along the inner top/bottom edges.
                      const ix = bx + 3.5 * scale;
                      const iy = by + 3.5 * scale;
                      const iw = Math.max(4, bw - 7 * scale);
                      const ih = Math.max(4, bh - 7 * scale);
                      const step = 9 * scale;
                      const ticks: React.ReactNode[] = [];
                      for (let x = ix + step; x < ix + iw - 2; x += step) {
                        ticks.push(<line key={`pt-${x}`} x1={x} y1={iy} x2={x} y2={iy + 3 * scale} stroke="#1E1B18" strokeWidth={0.6 * scale} />);
                        ticks.push(<line key={`pb-${x}`} x1={x} y1={iy + ih} x2={x} y2={iy + ih - 3 * scale} stroke="#1E1B18" strokeWidth={0.6 * scale} />);
                      }
                      return <g>{ticks}</g>;
                    })()}
                    {openingWordBox.styleId === 'stepped_frame' && (() => {
                      // Stepped (notched) corners: each corner steps in
                      // twice instead of meeting at a right angle.
                      const s = 5 * scale;
                      const ix = bx + 3.5 * scale;
                      const iy = by + 3.5 * scale;
                      const iw = Math.max(4, bw - 7 * scale);
                      const ih = Math.max(4, bh - 7 * scale);
                      const d = `M ${ix + s} ${iy} H ${ix + iw - s} V ${iy + s} H ${ix + iw} V ${iy + ih - s} H ${ix + iw - s} V ${iy + ih} H ${ix + s} V ${iy + ih - s} H ${ix} V ${iy + s} H ${ix + s} Z`;
                      return <path d={d} fill="none" stroke="#1E1B18" strokeWidth={0.6 * scale} />;
                    })()}
                    {openingWordBox.styleId === 'corner_ornament' && (
                      <g fill="none" stroke="#1E1B18" strokeWidth={0.7 * scale}>
                        <path d={`M ${bx + 3.5 * scale} ${by + 11 * scale} Q ${bx + 3.5 * scale} ${by + 3.5 * scale} ${bx + 11 * scale} ${by + 3.5 * scale}`} />
                        <path d={`M ${bx + bw - 11 * scale} ${by + 3.5 * scale} Q ${bx + bw - 3.5 * scale} ${by + 3.5 * scale} ${bx + bw - 3.5 * scale} ${by + 11 * scale}`} />
                        <path d={`M ${bx + bw - 3.5 * scale} ${by + bh - 11 * scale} Q ${bx + bw - 3.5 * scale} ${by + bh - 3.5 * scale} ${bx + bw - 11 * scale} ${by + bh - 3.5 * scale}`} />
                        <path d={`M ${bx + 11 * scale} ${by + bh - 3.5 * scale} Q ${bx + 3.5 * scale} ${by + bh - 3.5 * scale} ${bx + 3.5 * scale} ${by + bh - 11 * scale}`} />
                      </g>
                    )}
                    {openingWordBox.styleId === 'crown_panel' && (
                      <g>
                        <path d={`M ${bMidX - 16 * scale} ${by} Q ${bMidX} ${by - 8 * scale} ${bMidX + 16 * scale} ${by}`} fill="none" stroke="#1E1B18" strokeWidth={0.9 * scale} />
                        <circle cx={bMidX} cy={by - 5 * scale} r={1.5 * scale} fill="#1E1B18" />
                      </g>
                    )}
                    {openingWordBox.styleId === 'double_ornate' && (
                      <g fill="#1E1B18">
                        <circle cx={bx + 3.5 * scale} cy={by + 3.5 * scale} r={1.6 * scale} />
                        <circle cx={bx + bw - 3.5 * scale} cy={by + 3.5 * scale} r={1.6 * scale} />
                        <circle cx={bx + 3.5 * scale} cy={by + bh - 3.5 * scale} r={1.6 * scale} />
                        <circle cx={bx + bw - 3.5 * scale} cy={by + bh - 3.5 * scale} r={1.6 * scale} />
                      </g>
                    )}
                    <text
                      x={bMidX}
                      y={bMidY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#121214"
                      fontFamily='"Frank Ruhl Libre", "Noto Serif Hebrew", serif'
                      fontWeight="700"
                      fontSize={wordFontPx}
                      direction="rtl"
                    >
                      {openingWordBox.text}
                    </text>
                  </svg>
                );
              })()}
              {/* Unverified transition marker subtle indicator summary anchor */}
              {/* v0.9.9 repair (B4): removed dead `{transitionMarkers && ... && null}` no-op. */}
              {/* v0.8.0 Part C (§7): the Michtav box — left-origin coordinates matching pdf-exporter */}
              {michtavBox && (
                <div
                  data-tier="michtav"
                  className="absolute z-30 flex items-center justify-center border-2 border-[#5C5346] rounded-sm bg-[#FDF8EE] pointer-events-none"
                  style={{
                    top: `${(michtavBox.yPct / 100) * contentH}px`,
                    left: `${(michtavBox.xPct / 100) * contentW}px`,
                    width: `${(michtavBox.widthPct / 100) * contentW}px`,
                    height: `${(michtavBox.heightPct / 100) * contentH}px`,
                  }}
                >
                  <span
                    className="text-center font-bold text-[#3B2F1E]"
                    style={{
                      fontSize: `${Math.max(10, (michtavBox.heightPct / 100) * contentH * 0.4)}px`,
                    }}
                  >
                    {michtavBox.text}
                  </span>
                </div>
              )}

              {/* v0.5.0 Part B (Module 4): ONE unified outline around the
                  whole hovered / selected section — the per-word hover boxes
                  are gone. Pointer-events-none: it never blocks clicks,
                  caret placement or text selection. The chip names the
                  section (role + line count). */}
              {blockOverlays.map(({ unitId, kind, box, role, lineCount }) => (
                <div
                  key={`block-outline-${kind}-${unitId}`}
                  data-testid={`block-outline-${kind}`}
                  aria-hidden="true"
                  className="absolute pointer-events-none z-[5] transition-all duration-150 ease-out"
                  style={{
                    top: `${box.topPx - 3}px`,
                    right: `${box.rightPx - 3}px`,
                    width: `${box.widthPx + 6}px`,
                    height: `${box.bottomPx - box.topPx + 6}px`,
                  }}
                >
                  <div
                    className={`absolute inset-0 rounded-[3px] transition-all duration-150 ease-out ${
                      kind === 'selected'
                        ? 'ring-2 ring-[#344A67]/60 bg-[#344A67]/[0.04]'
                        : kind === 'link'
                        ? 'ring-1 ring-[#B8741A]/70 bg-[#B8741A]/[0.05]'
                        : 'ring-1 ring-dashed ring-[#344A67]/50 bg-[#344A67]/[0.025]'
                    }`}
                  />
                  <span className="absolute -top-5 right-0 whitespace-nowrap rounded bg-[#344A67] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    {role ? getSemanticRoleLabel(role, lang) : t('פסקה')} · {lineCount}{' '}
                    {t('שורות')}
                  </span>
                </div>
              ))}

              {/* Footnote Divider & Lines */}
              {footnoteLines.length > 0 && (
                <>
                  {typesetResult.designSettings?.footnotes?.showSeparatorRule !== false && (
                    <div
                      className="absolute border-t border-[#5C5346]"
                      style={{
                        top: `${
                          (footnoteLines[0].yBaseline -
                            footnoteLines[0].ascent -
                            (typesetResult.designSettings?.footnotes
                              ?.separatorSpacingBelowPt ?? 5)) *
                          scale
                        }px`,
                        right: 0,
                        width: `${
                          contentW *
                          (typesetResult.designSettings?.footnotes?.separatorWidthRatio ??
                            0.32)
                        }px`,
                      }}
                    />
                  )}
                  {/* v0.8.0 Part C (§9): footnotes live in their own
                      z-10 tier container, below the body tiers. */}
                  <div data-tier="footnotes" className="absolute inset-0 z-10 pointer-events-none">
                    {footnoteLines.map(line => renderLine(line, 'fn'))}
                  </div>
                </>
              )}

              {/* v0.3.0 Module E: image-only page — render image units full-page */}
              {isImageOnlyPage && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 overflow-hidden">
                  {imageUnits.map(unit => {
                    const src = imageSrcOf(unit);
                    if (!src) return null;
                    return (
                      <figure
                        key={unit.id}
                        className="flex flex-col items-center gap-1 max-w-full max-h-full"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={unit.rawText || t('תמונה')}
                          className="max-w-full max-h-full object-contain"
                          draggable={false}
                        />
                        {unit.rawText && (
                          <figcaption
                            className="text-center text-[#5C5346] italic"
                            style={{ fontSize: `${10 * scale}px` }}
                          >
                            {unit.rawText}
                          </figcaption>
                        )}
                      </figure>
                    );
                  })}
                </div>
              )}

              {/* v0.3.0 Module E: drag page division — bottom-edge handle per text block */}
              {splitHandlesEnabled &&
                !inPlaceSelection &&
                Array.from(pageLinesByUnit.entries()).map(([unitId, unitLines]) => {
                  const lastLine = unitLines[unitLines.length - 1];
                  if (!lastLine) return null;
                  const handleTopPx = (lastLine.yBaseline + lastLine.descent) * scale;
                  const isActiveDrag = splitDrag?.unitId === unitId;
                  return (
                    <div
                      key={`split-handle-${unitId}`}
                      role="separator"
                      aria-label={t('גרור כדי להעביר תוכן לעמוד הבא')}
                      title={t('גרור את הקצה התחתון כדי להעביר תוכן לעמוד הבא')}
                      onPointerDown={e => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        splitDragUnitLinesRef.current = unitLines;
                        const rect = contentAreaRef.current?.getBoundingClientRect();
                        const y = rect ? e.clientY - rect.top : handleTopPx;
                        const candidate = resolveSplitCandidate(unitLines, y);
                        setSplitDrag({
                          unitId,
                          pointerYContentPx: y,
                          candidateLineIndex: candidate?.lineIndex ?? null,
                        });
                      }}
                      onPointerMove={e => {
                        if (!isActiveDrag) return;
                        const rect = contentAreaRef.current?.getBoundingClientRect();
                        const y = rect ? e.clientY - rect.top : handleTopPx;
                        const candidate = resolveSplitCandidate(unitLines, y);
                        setSplitDrag(prev =>
                          prev
                            ? {
                                ...prev,
                                pointerYContentPx: y,
                                candidateLineIndex: candidate?.lineIndex ?? null,
                              }
                            : prev
                        );
                      }}
                      onPointerUp={e => {
                        if (!isActiveDrag) return;
                        const rect = contentAreaRef.current?.getBoundingClientRect();
                        const y = rect ? e.clientY - rect.top : handleTopPx;
                        finishSplitDrag(unitId, y);
                      }}
                      onPointerCancel={() => {
                        setSplitDrag(null);
                        splitDragUnitLinesRef.current = [];
                      }}
                      className={`absolute left-0 right-0 z-20 flex items-center justify-center cursor-ns-resize touch-none group ${
                        isActiveDrag ? 'opacity-100' : 'opacity-0 hover:opacity-100'
                      }`}
                      style={{ top: `${handleTopPx - 5}px`, height: '10px' }}
                    >
                      <div
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 border text-[10px] font-bold shadow-sm ${
                          isActiveDrag
                            ? 'bg-[#344A67] text-white border-[#344A67]'
                            : 'bg-white/95 text-[#344A67] border-[#344A67]/40'
                        }`}
                      >
                        <Scissors className="w-3 h-3" />
                        <span>{t('גרור לחלוקת עמוד')}</span>
                      </div>
                    </div>
                  );
                })}

              {/* v0.3.0 Module E: live split line while dragging a block edge */}
              {splitDrag && (
                <div
                  className="absolute left-0 right-0 z-30 pointer-events-none"
                  style={{ top: `${splitDrag.pointerYContentPx}px` }}
                >
                  <div className="border-t-2 border-dashed border-[#B8741A]" />
                  <span className="absolute -top-5 right-1 bg-[#B8741A] text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                    {splitDrag.candidateLineIndex !== null
                      ? `${t('שחרר כדי להכניס מעבר עמוד ידני בשורה')} ${splitDrag.candidateLineIndex + 1}`
                      : t('שחרר כדי לבטל — אין שורה מתחת')}
                  </span>
                </div>
              )}
            </div>

            {/* Cross-Page Continuation Footer Banner (המשך בעמוד הבא) */}
            {continuationFooter && (
              <div
                className="absolute pointer-events-none flex items-center justify-start text-[#5C5346] italic"
                style={{
                  bottom: `${marginB * 0.66}px`,
                  left: `${marginOut}px`,
                  fontSize: `${7.5 * scale}px`,
                  fontFamily: '"Frank Ruhl Libre", serif',
                }}
              >
                <span className="bg-[#F4EFE4] px-1.5 py-0.2 rounded border border-[#D8D0C0]">
                  {continuationFooter} ←
                </span>
              </div>
            )}

            {/* Traditional Bottom Catchword / Page Footer */}
            {/* v0.5.0 (Title Page): never on a title page. */}
            {!isTitlePage && !vilnaHeader && typesetResult.designSettings?.pageLayout?.showRunningFooter !== false && (
              <div
                className="absolute flex items-center justify-between text-[#5C5346]"
                style={{
                  bottom: `${marginB * 0.28}px`,
                  right: `${marginIn}px`,
                  left: `${marginOut}px`,
                  fontSize: `${9 * scale}px`,
                  fontFamily: '"Frank Ruhl Libre", serif',
                }}
              >
                <span>{showTopFolioNumber ? folioLabel : ''}</span>
                <span>{headerTitle}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compact Floating Canvas Zoom & Pan Controls Pill (Bottom-Left of Viewport) */}
      {onZoomChange && (
        <div
          dir="rtl"
          className="absolute bottom-3 left-4 z-30 flex items-center gap-1 bg-[var(--ui-surface)]/95 backdrop-blur-xs border border-[var(--ui-border)] rounded-lg px-2 py-1 shadow-[var(--ui-floating-shadow)] text-[11px] text-[var(--ui-text-secondary)]"
        >
          <button
            onClick={() => setIsPanToolActive(!isPanToolActive)}
            className={`p-1 rounded transition-colors ${
              isPanMode
                ? 'bg-[var(--ui-accent)] text-white'
                : 'hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)]'
            }`}
            title={t("כלי הזזת דף (או החזק מקש רווח Spacebar + גרירה)")}
          >
            {isPanMode ? <Hand className="w-3.5 h-3.5" /> : <MousePointer className="w-3.5 h-3.5" />}
          </button>

          <div className="h-3.5 w-px bg-[var(--ui-border)] mx-0.5" />

          <button
            onClick={() => onZoomChange(Math.max(0.5, Number((zoom - 0.1).toFixed(2))))}
            className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
            title={t("הקטן תצוגה (Ctrl + גלגלת)")}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => onZoomChange(1.0)}
            className="px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] font-mono font-semibold text-[var(--ui-text-primary)] min-w-[42px] text-center"
            title={t("אפס ל-100%")}
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            onClick={() => onZoomChange(Math.min(2.2, Number((zoom + 0.1).toFixed(2))))}
            className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
            title={t("הגדל תצוגה (Ctrl + גלגלת)")}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <div className="h-3.5 w-px bg-[var(--ui-border)] mx-0.5" />

          <button
            onClick={handleFitPage}
            className="px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] flex items-center gap-1"
            title={t("התאם עמוד שלם למסך")}
          >
            <Minimize2 className="w-3 h-3" />
            <span>{t("התאם עמוד")}</span>
          </button>

          <button
            onClick={handleFitWidth}
            className="px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] flex items-center gap-1"
            title={t("התאם לרוחב המסך")}
          >
            <Maximize2 className="w-3 h-3" />
            <span>{t("לרוחב")}</span>
          </button>

          <div className="h-3.5 w-px bg-[var(--ui-border)] mx-0.5" />

          {/* v0.6.0 Part C (§6): move/resize the custom-layout boxes of
              this folio directly on the page (saved as this page's
              override; the text reflows on release). */}
          {canMoveBoxes && (
            <button
              onClick={() => setMoveBoxesMode(v => !v)}
              className={`px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] flex items-center gap-1 ${
                moveBoxesMode
                  ? 'bg-[var(--ui-accent)] text-white'
                  : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
              }`}
              title={t('הזזת תיבות: גרור את מסגרת התיבה כדי להזיזה, או את הפינה כדי לשנות את גודלה. נשמר כהתאמה לדף זה בלבד.')}
            >
              <Move className="w-3 h-3" />
              <span>{t('הזז תיבות')}</span>
            </button>
          )}

          {/* v0.3.0 Module E: full-screen preview toggle */}
          <button
            onClick={() =>
              isFullscreenPreview ? setIsFullscreenPreview(false) : enterFullscreenPreview()
            }
            className={`px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] flex items-center gap-1 ${
              isFullscreenPreview
                ? 'bg-[var(--ui-accent)] text-white'
                : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
            }`}
            title={t('תצוגה מקדימה במסך מלא (Esc ליציאה)')}
          >
            <Expand className="w-3 h-3" />
            <span>{isFullscreenPreview ? t('צא ממסך מלא') : t('מסך מלא')}</span>
          </button>

          {/* v0.3.0 Module E: anchored break instruction for the selected unit */}
          {onAddBreakInstruction && selectedUnitId && (
            <div className="relative">
              <button
                onClick={() => setShowBreakMenu(v => !v)}
                className="px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] flex items-center gap-1"
                title={t('הוסף הוראת מעבר מעוגנת ליחידה הנבחרת (או Alt+קליק על מילה)')}
              >
                <BookmarkPlus className="w-3 h-3" />
                <span>{t('הוראת מעבר')}</span>
              </button>
              {showBreakMenu && (
                <div
                  dir="rtl"
                  className="absolute bottom-full left-0 mb-2 w-64 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] shadow-[var(--ui-floating-shadow)] p-2 z-40 text-[var(--ui-text-primary)]"
                >
                  <div className="flex items-center justify-between px-1 pb-1">
                    <span className="text-xs font-bold">{t('הוראת מעבר מעוגנת')}</span>
                    <button
                      onClick={() => setShowBreakMenu(false)}
                      className="p-0.5 rounded hover:bg-[var(--ui-surface-hover)]"
                      aria-label={t('סגור')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--ui-text-secondary)] px-1 pb-2 leading-snug">
                    {t('ההוראה מעוגנת ליחידה הנבחרת ותישמר גם אחרי תיקוני הגהה.')}
                  </p>
                  {(
                    [
                      ['pageEndsBefore', t('העמוד יסתיים לפני היחידה')],
                      ['startsNextPage', t('היחידה תתחיל בעמוד הבא')],
                      ['oneLineLess', t('העמוד יכיל שורה אחת פחות')],
                    ] as Array<[BreakInstructionKind, string]>
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => addBreakInstructionFor(selectedUnitId, kind)}
                      className="w-full text-start text-xs px-2 py-1.5 rounded hover:bg-[var(--ui-surface-hover)]"
                    >
                      {label}
                    </button>
                  ))}
                  <p className="text-[10px] text-[var(--ui-text-secondary)] px-1 pt-1.5 leading-snug">
                    {t('טיפ: Alt+קליק על מילה מוסיף הוראת ״העמוד יסתיים לפני מילה זו״.')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
