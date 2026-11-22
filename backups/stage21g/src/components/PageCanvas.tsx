import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  HebrewGlyph,
  PageTypesetResult,
  ShapedWord,
  TypesetLine,
  ContentRole,
  ContentUnit,
} from '../types/typesetter';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Hand,
  MousePointer,
} from 'lucide-react';
import {
  InPlaceEditEngine,
  InPlaceSelectionState,
  WordCharSpan,
} from '../engine/in-place-edit-engine';

interface PageCanvasProps {
  typesetResult: PageTypesetResult;
  zoom: number;
  showBaselines: boolean;
  showAnchors: boolean;
  showKneeGuide: boolean;
  showLinks?: boolean;
  onSelectGlyph: (glyph: HebrewGlyph, word: ShapedWord) => void;
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
}

export const PageCanvas: React.FC<PageCanvasProps> = ({
  typesetResult,
  zoom,
  showBaselines,
  showAnchors,
  showKneeGuide,
  showLinks = true,
  onSelectGlyph,
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
}) => {
  const {
    geometry,
    sourceLines,
    rashiLines,
    tosafotLines,
    footnoteLines,
    column2Lines,
    knee,
    pageNumberHebrew,
    headerTitle,
    layoutType,
    dividerY,
    activeLinks,
    continuationHeader,
    continuationFooter,
  } = typesetResult;

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const wordDomMapRef = useRef<Map<string, HTMLSpanElement>>(new Map());

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
        setTimeout(() => {
          hiddenInputRef.current?.focus({ preventScroll: true });
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
  const marginIn = geometry.marginInside * scale;
  const marginOut = geometry.marginOutside * scale;

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

  const handleFitWidth = () => {
    if (!viewportRef.current || !onZoomChange) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const availW = Math.max(240, rect.width - 96);
    const zoomW = availW / (geometry.pageWidth * 1.25);
    const nextZoom = Math.max(0.5, Math.min(2.2, Number(zoomW.toFixed(2))));
    onZoomChange(nextZoom);
  };

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

      setInPlaceSelection(nextSelection);
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
      hiddenInputRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, [isDraggingTextSelection]);

  const handleMouseDownViewport = (e: React.MouseEvent<HTMLDivElement>) => {
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
    const rightIndentPt = (line.rightIndentPt ?? 0) + firstIndentPt;
    const leftIndentPt = line.leftIndentPt ?? 0;

    const rightPx = (rightOffsetPt + rightIndentPt) * scale;
    const widthPx =
      Math.max(
        20,
        line.targetWidth > 0
          ? line.targetWidth
          : (line.xRight !== undefined && line.xLeft !== undefined
              ? line.xRight - line.xLeft
              : contentWidthPt) -
              rightIndentPt -
              leftIndentPt
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

    const isSelectedUnit = Boolean(selectedUnitId && line.unitId === selectedUnitId);
    const isBeingEditedInPlace = Boolean(
      inPlaceSelection && line.unitId === inPlaceSelection.unitId
    );
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
        onMouseDown={e => {
          if (isPanMode || e.button !== 0 || line.role === 'continuation') return;
          // If clicking in empty space of the line (not directly on a word span), place caret at start or end of this line
          if (e.target === e.currentTarget || (e.target as HTMLElement).parentElement === e.currentTarget) {
            e.stopPropagation();
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
                hiddenInputRef.current?.focus({ preventScroll: true });
              }, 0);
            }
          }
        }}
        className={`absolute transition-colors ${
          isContinuation ? 'select-none' : 'cursor-text'
        } ${
          isBeingEditedInPlace
            ? 'bg-[#344A67]/[0.045] ring-1 ring-[#344A67]/30 rounded-[2px] z-10'
            : isSelectedUnit
            ? 'bg-[#344A67]/[0.06] ring-1 ring-[#344A67]/35 rounded-[2px] z-10'
            : 'hover:bg-[#344A67]/[0.03]'
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
          {nonSpaceWords.map((word, wIdx) => {
            const matchingLink = activeLinks?.find(
              l => l.commentaryUnitId === word.unitId || l.sourceUnitId === word.unitId
            );
            const resolvedLinkId = matchingLink?.linkId || word.linkId || null;
            const isLinkedHover = Boolean(hoveredLinkId && resolvedLinkId === hoveredLinkId);

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
                  e.stopPropagation();

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
                  const markGlyph =
                    word.glyphs.find(g => g.isMark) || word.glyphs[0];
                  if (markGlyph) {
                    onSelectGlyph(markGlyph, word);
                  }

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
                        hiddenInputRef.current?.focus({ preventScroll: true });
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
                      hiddenInputRef.current?.focus({ preventScroll: true });
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
                } ${
                  isLinkedHover
                    ? 'bg-[#344A67]/15 ring-1 ring-[#344A67] text-[#121214]'
                    : 'hover:bg-[#344A67]/10'
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

          {isRashiRole && line.isLastLine && <span className="text-[#5C5346] mr-0.5">:</span>}
          {isTosafotRole && line.isLastLine && (
            <span className="text-[#5C5346] font-bold mr-0.5">:</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative bg-[var(--ui-workspace-bg)] transition-colors duration-150">
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
          exitInPlaceEditing();
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
          {/* THE HOLY BOOK PAGE SHEET — Warm Ivory Editorial Sheet with Real Scaled Layout Dimensions */}
          <div
            dir="rtl"
            onClick={e => {
              e.stopPropagation();
              if (e.target === e.currentTarget) {
                exitInPlaceEditing();
                if (onSelectUnit) onSelectUnit(null);
              }
            }}
            className="relative bg-[var(--ui-page-bg)] text-[#161514] shadow-[var(--ui-page-shadow)] border border-[var(--ui-page-border)] shrink-0 overflow-hidden"
            style={{
              width: `${pageW}px`,
              height: `${pageH}px`,
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

            {/* Traditional Running Header (כותרת רצה ומספר דף) */}
            {(typesetResult.designSettings?.pageElements?.showRunningHeader !== false ||
              typesetResult.designSettings?.pageElements?.showFolioNumber !== false) && (
              <div
                className="absolute flex items-end justify-between border-b-2 border-[#2A2622]/75 pb-1 text-[#1E1C1A]"
                style={{
                  top: `${marginT * 0.36}px`,
                  right: `${marginIn}px`,
                  left: `${marginOut}px`,
                  height: `${marginT * 0.48}px`,
                  fontFamily: `"${selectedFont}", "Frank Ruhl Libre", serif`,
                }}
              >
                <span
                  className="font-bold tracking-wide"
                  style={{ fontSize: `${12.5 * scale}px` }}
                >
                  {typesetResult.designSettings?.pageElements?.showFolioNumber !== false
                    ? `דף ${pageNumberHebrew}`
                    : ''}
                </span>
                <span
                  className="font-extrabold tracking-wider"
                  style={{
                    fontSize: `${
                      (typesetResult.designSettings?.pageElements?.runningHeaderFontSizePt ??
                        14.5) * scale
                    }px`,
                  }}
                >
                  {typesetResult.designSettings?.pageElements?.showRunningHeader !== false
                    ? headerTitle
                    : ''}
                </span>
                <span
                  className="font-semibold text-[#5C5346]"
                  style={{ fontSize: `${10.5 * scale}px` }}
                >
                  {layoutType === 'rav_text'
                    ? 'צורת הדף · מהדורת כתר'
                    : layoutType === 'mikraot_gedolot'
                    ? 'מקראות גדולות · כתר'
                    : layoutType === 'two_column'
                    ? 'שני טורים · מהדורת כתר'
                    : layoutType === 'source_top_commentary_bottom'
                    ? 'מקור ומפרשים · כתר'
                    : 'מהדורת כתר'}
                </span>
              </div>
            )}

            {/* Commentary Labels for Rav-Text or Mikraot Gedolot */}
            {(layoutType === 'rav_text' || layoutType === 'mikraot_gedolot') && (
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
                <span>{layoutType === 'mikraot_gedolot' ? 'רש״י' : 'רש״י'}</span>
                <span>
                  {layoutType === 'mikraot_gedolot' ? 'אונקלוס / רמב״ן' : 'תוספות'}
                </span>
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
              onClick={e => {
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
              }}
            >
              {/* Hidden IME & Keyboard Input Bridge for Direct In-Place Caret Editing (Zero Visual Box!) */}
              <input
                ref={hiddenInputRef}
                type="text"
                dir="rtl"
                aria-label="עריכת טקסט ישירה על הדף"
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

              {/* SVG Overlay for Dynamic Knees & Visual Link Lines */}
              <svg
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

                {/* 4. Hovered Link Connector Line */}
                {showLinks && hoveredLinkId && (
                  <g>
                    <path
                      d={`M ${contentW * 0.25} ${contentH * 0.28} Q ${contentW * 0.5} ${
                        contentH * 0.22
                      } ${contentW * 0.72} ${contentH * 0.32}`}
                      fill="none"
                      stroke="#344A67"
                      strokeWidth="1.75"
                      strokeDasharray="3 3"
                    />
                  </g>
                )}
              </svg>

              {/* Render All Lines */}
              {sourceLines.map(line => renderLine(line, 'src'))}
              {column2Lines && column2Lines.map(line => renderLine(line, 'col2'))}
              {rashiLines.map(line => renderLine(line, 'rashi'))}
              {tosafotLines.map(line => renderLine(line, 'tosafot'))}

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
                  {footnoteLines.map(line => renderLine(line, 'fn'))}
                </>
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
            {typesetResult.designSettings?.pageLayout?.showRunningFooter !== false && (
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
                <span>דף {pageNumberHebrew}</span>
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
            title="כלי הזזת דף (או החזק מקש רווח Spacebar + גרירה)"
          >
            {isPanMode ? <Hand className="w-3.5 h-3.5" /> : <MousePointer className="w-3.5 h-3.5" />}
          </button>

          <div className="h-3.5 w-px bg-[var(--ui-border)] mx-0.5" />

          <button
            onClick={() => onZoomChange(Math.max(0.5, Number((zoom - 0.1).toFixed(2))))}
            className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
            title="הקטן תצוגה (Ctrl + גלגלת)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => onZoomChange(1.0)}
            className="px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] font-mono font-semibold text-[var(--ui-text-primary)] min-w-[42px] text-center"
            title="אפס ל-100%"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            onClick={() => onZoomChange(Math.min(2.2, Number((zoom + 0.1).toFixed(2))))}
            className="p-1 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
            title="הגדל תצוגה (Ctrl + גלגלת)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <div className="h-3.5 w-px bg-[var(--ui-border)] mx-0.5" />

          <button
            onClick={handleFitPage}
            className="px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] flex items-center gap-1"
            title="התאם עמוד שלם למסך"
          >
            <Minimize2 className="w-3 h-3" />
            <span>התאם עמוד</span>
          </button>

          <button
            onClick={handleFitWidth}
            className="px-1.5 py-0.5 rounded hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] flex items-center gap-1"
            title="התאם לרוחב המסך"
          >
            <Maximize2 className="w-3 h-3" />
            <span>לרוחב</span>
          </button>
        </div>
      )}
    </div>
  );
};
