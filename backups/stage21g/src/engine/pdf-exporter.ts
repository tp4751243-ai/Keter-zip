/**
 * Keter High-Resolution Print PDF Exporter
 * Generates vector-density, multi-page print PDFs (300 DPI equivalent) with crop marks,
 * printer registration, running headers, Hebrew folios, authentic Hebrew RTL
 * typography with full Nikud, Taamim, Noto Rashi Hebrew font, and mathematical word spacing justification.
 */

import { jsPDF } from 'jspdf';
import {
  BookTypesetDocument,
  ContentRole,
  PageGeometry,
  PageTypesetResult,
  PlacedOrnament,
  ShapedWord,
  TypesetLine,
} from '../types/typesetter';
import { OrnamentLibraryEngine } from './ornament-library';
import { EngineHardRulesEngine } from './engine-hard-rules';
import {
  ExtractedPdfDocument,
  PdfNativeTextEngine,
} from './pdf-native-text-engine';

export interface PdfWordDrawCommand {
  text: string;
  footnoteMarker?: number | string;
  unitId?: string;
  role: ContentRole;
  lineIndex: number;
  wordIndex: number;
  xLeft: number;       // Physical page coordinate X left (pt)
  xRight: number;      // Physical page coordinate X right (pt)
  width: number;       // Exact solved word width (pt)
  yBaseline: number;   // Physical page coordinate Y baseline (pt)
  yTop: number;        // Physical page coordinate Y top (pt)
  yBottom: number;     // Physical page coordinate Y bottom (pt)
  fontFamily: string;
  fontSizePt: number;
  fontWeight: number;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  textColor?: string;
  trackingEm: number;
  wordSpacingRatio: number;
  horizontalScalePercent: number;
  baselineShiftPt: number;
  isDibbur: boolean;
}

export interface PdfLineDrawCommand {
  role: ContentRole;
  unitId: string;
  lineIndex: number;
  xLeft: number;       // Physical page coordinate X left (pt)
  xRight: number;      // Physical page coordinate X right (pt)
  targetWidth: number;
  yBaseline: number;   // Physical page coordinate Y baseline (pt)
  yTop: number;
  yBottom: number;
  isJustified: boolean;
  isLastLine: boolean;
  isCenteredHeading: boolean;
  alignment: 'justify' | 'right' | 'center' | 'left';
  firstLineIndentPt: number;
  rightIndentPt: number;
  leftIndentPt: number;
  hangingIndentPt: number;
  leadingPt: number;
  spaceBeforePt: number;
  spaceAfterPt: number;
  fontFamily: string;
  fontSizePt: number;
  baseFontWeight: number;
  isItalic: boolean;
  isUnderline: boolean;
  textColor?: string;
  words: PdfWordDrawCommand[];
}

export interface PdfOrnamentDrawCommand {
  ornamentId: string;
  placement: string;
  xLeft: number;       // Physical page coordinate X left (pt)
  xRight: number;      // Physical page coordinate X right (pt)
  yTop: number;        // Physical page coordinate Y top (pt)
  yBottom: number;     // Physical page coordinate Y bottom (pt)
  width: number;
  height: number;
  ornament: PlacedOrnament;
}

export interface PdfPageRenderPlan {
  pageNumber: number;
  pageNumberHebrew: string;
  headerTitle: string;
  continuationHeader?: string;
  continuationFooter?: string;
  showRunningHeader: boolean;
  showRunningFooter: boolean;
  showFolioNumber: boolean;
  showDecorativeFrame: boolean;
  folioNumberPosition: 'top_outside' | 'top_center' | 'bottom_center' | 'bottom_outside' | 'hidden';
  runningHeaderFontSizePt: number;
  showFootnoteSeparatorLine: boolean;
  footnoteSeparatorWidthRatio: number;
  footnoteSeparatorSpacingAbovePt: number;
  footnoteSeparatorSpacingBelowPt: number;
  footnoteSeparatorWeightPt: number;
  lines: PdfLineDrawCommand[];
  ornaments: PdfOrnamentDrawCommand[];
}

export class PdfExporter {
  /**
   * Convert Arabic number to traditional Hebrew numeral (Gematria)
   * e.g., 1 -> א׳, 2 -> ב׳, 15 -> ט״ו, 16 -> ט״ז, 50 -> נ׳
   */
  public static toHebrewGematria(num: number): string {
    const letters: [number, string][] = [
      [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'],
      [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'],
      [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'],
      [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'],
      [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'],
      [2, 'ב'], [1, 'א'],
    ];

    if (num === 15) return 'ט״ו';
    if (num === 16) return 'ט״ז';

    let n = num;
    let res = '';
    for (const [val, char] of letters) {
      while (n >= val) {
        res += char;
        n -= val;
      }
    }

    if (res.length > 1) {
      return res.slice(0, -1) + '״' + res.slice(-1);
    } else if (res.length === 1) {
      return res + '׳';
    }
    return 'א׳';
  }

  /**
   * Because `ctx.scale(scale, scale)` maps the canvas coordinate system 1:1 to typographical points
   * (`geometry.pageWidth` x `geometry.pageHeight` pt), font declarations in canvas coordinates MUST
   * be in exact point units (`pt` -> `${pt}px` in the scaled user space), NOT multiplied by 1.3333!
   */
  private static ptInCanvasSpace(pt: number): number {
    return Number(pt.toFixed(2));
  }

  /**
   * Builds the exact, deterministic 1:1 word-and-line coordinate plan directly from a solved
   * `PageTypesetResult` without reflowing, re-breaking, or re-estimating layout.
   * Both `renderPageToCanvas` and the automated PDF geometry regression suite use this exact plan!
   */
  public static buildPageRenderPlan(page: PageTypesetResult): PdfPageRenderPlan {
    const {
      geometry,
      sourceLines,
      rashiLines,
      tosafotLines,
      footnoteLines,
      column2Lines,
      knee,
      pageNumber,
      headerTitle,
      layoutType,
      continuationHeader,
      continuationFooter,
      designSettings,
    } = page;

    const mTop = geometry.marginTop;
    const mBottom = geometry.pageHeight - geometry.marginBottom;
    const mLeft = geometry.marginInside;
    const mRight = geometry.pageWidth - geometry.marginOutside;
    const contentW = mRight - mLeft;

    const sourceFont =
      designSettings?.roleStyles?.main_source?.character?.fontFamily ||
      page.sourceFontFamily ||
      'Frank Ruhl Libre';
    const rashiFont =
      designSettings?.roleStyles?.primary_comment?.character?.fontFamily ||
      page.rashiFontFamily ||
      'Noto Rashi Hebrew';
    const tosafotFont =
      designSettings?.roleStyles?.secondary_comment?.character?.fontFamily ||
      page.tosafotFontFamily ||
      'Frank Ruhl Libre';
    const footnoteFont =
      designSettings?.footnotes?.fontFamily ||
      designSettings?.roleStyles?.footnote?.character?.fontFamily ||
      sourceFont;

    const planLines: PdfLineDrawCommand[] = [];

    const buildLineCommand = (
      line: TypesetLine,
      physXRight: number,
      physYBaseline: number,
      fontFamily: string,
      fontSizePt: number,
      baseFontWeight: number,
      isCenteredHeading: boolean = false
    ): PdfLineDrawCommand => {
      const effectiveFontFamily = line.fontFamily || fontFamily;
      const effectiveFontSizePt = line.fontSizePt ?? fontSizePt;
      const effectiveFontWeight = line.fontWeight ?? baseFontWeight;
      const effectiveAlignment: 'justify' | 'right' | 'center' | 'left' =
        line.paragraphAlignment ??
        line.alignment ??
        (isCenteredHeading ? 'center' : line.isJustified && !line.isLastLine ? 'justify' : 'right');
      const effectiveCentered = effectiveAlignment === 'center';
      const effectiveLeft = effectiveAlignment === 'left';

      const realWords = line.words.filter(w => !w.isSpace && w.text.trim().length > 0);
      const firstIndentPt = line.firstLineIndentPt ?? line.firstLineIndent ?? 0;
      const hangingIndentPt = line.hangingIndentPt ?? 0;
      const rightIndentPt = line.rightIndentPt ?? 0;
      const leftIndentPt = line.leftIndentPt ?? 0;
      const rightIndentOffset = rightIndentPt + firstIndentPt;

      const rawBoxW =
        line.xLeft !== undefined && line.xRight !== undefined
          ? Math.max(20, line.xRight - line.xLeft)
          : line.targetWidth > 0
          ? line.targetWidth + rightIndentOffset + leftIndentPt
          : contentW;
      const physXLeft =
        line.xLeft !== undefined && line.xRight !== undefined
          ? mLeft + line.xLeft
          : physXRight - rawBoxW;
      const targetW =
        line.targetWidth > 0
          ? line.targetWidth
          : Math.max(20, rawBoxW - rightIndentOffset - leftIndentPt);

      const wordWidths = realWords.map(w => {
        const wSize = w.fontSizePt ?? effectiveFontSizePt;
        const baseW = w.width > 0 ? w.width : Math.max(wSize * 0.55, w.text.length * wSize * 0.48);
        const markerExtra =
          w.footnoteMarker !== undefined ? String(w.footnoteMarker).length * 4.2 + 5.0 : 0;
        return baseW + markerExtra;
      });
      const totalWordsW = wordWidths.reduce((acc, w) => acc + w, 0);
      const shouldJustify = effectiveAlignment === 'justify' && realWords.length > 1;

      const lineWordSpacingRatio =
        realWords[0]?.wordSpacingRatio ?? line.wordSpacingRatio ?? 1.0;
      const naturalSpace = Math.max(1.5, effectiveFontSizePt * 0.28 * lineWordSpacingRatio);
      let gapWidth = naturalSpace;

      if (shouldJustify && realWords.length > 1) {
        const rawGap = (targetW - totalWordsW) / (realWords.length - 1);
        // If solved words fit within targetW, use exact justified gap; if slightly tighter, scale proportionally so 0 words ever overlap!
        gapWidth = rawGap >= 1.5 ? Math.min(28.0, rawGap) : Math.max(1.5, rawGap);
      }

      // Guarantee that total span (words + gaps) never exceeds targetW on lines
      const totalSpanWithGaps =
        totalWordsW + (realWords.length > 1 ? gapWidth * (realWords.length - 1) : 0);
      const widthScale =
        !effectiveCentered && totalSpanWithGaps > targetW + 0.5 && totalSpanWithGaps > 0
          ? targetW / totalSpanWithGaps
          : 1.0;

      const wordCommands: PdfWordDrawCommand[] = [];

      const pushWordCommand = (w: ShapedWord, wIdx: number, curRight: number, wW: number) => {
        const isDibbur = Boolean(w.isDibbur || w.isBold);
        const wWeight = isDibbur ? Math.max(700, w.fontWeight ?? effectiveFontWeight) : (w.fontWeight ?? effectiveFontWeight);
        const wBold = Boolean(isDibbur || wWeight >= 600);
        const wItalic = Boolean(w.isItalic ?? line.isItalic);
        const wUnderline = Boolean(w.isUnderline ?? line.isUnderline);
        const wColor = w.textColor ?? line.textColor;
        const wTracking = w.trackingEm ?? line.trackingEm ?? 0;
        const wWordSpacing = w.wordSpacingRatio ?? line.wordSpacingRatio ?? 1.0;
        const wScale = w.horizontalScalePercent ?? line.horizontalScalePercent ?? 100;
        const wBaselineShift = w.baselineShiftPt ?? line.baselineShiftPt ?? 0;

        wordCommands.push({
          text: w.text,
          footnoteMarker: w.footnoteMarker,
          unitId: w.unitId ?? line.unitId,
          role: w.role ?? line.role,
          lineIndex: line.lineIndex,
          wordIndex: wIdx,
          xLeft: Number((curRight - wW).toFixed(2)),
          xRight: Number(curRight.toFixed(2)),
          width: Number(wW.toFixed(2)),
          yBaseline: Number((physYBaseline - wBaselineShift).toFixed(2)),
          yTop: Number((physYBaseline - line.ascent).toFixed(2)),
          yBottom: Number((physYBaseline + line.descent).toFixed(2)),
          fontFamily: w.fontFamily || effectiveFontFamily,
          fontSizePt: w.fontSizePt ?? effectiveFontSizePt,
          fontWeight: wWeight,
          isBold: wBold,
          isItalic: wItalic,
          isUnderline: wUnderline,
          textColor: wColor,
          trackingEm: wTracking,
          wordSpacingRatio: wWordSpacing,
          horizontalScalePercent: wScale,
          baselineShiftPt: wBaselineShift,
          isDibbur,
        });
      };

      const scaledTotalSpan =
        totalWordsW * widthScale + Math.max(0, realWords.length - 1) * gapWidth * widthScale;
      const effectiveRightBound = physXRight - rightIndentOffset;
      const effectiveLeftBound = Math.max(physXLeft + leftIndentPt, effectiveRightBound - targetW);

      let startRight = effectiveRightBound;
      if (effectiveCentered) {
        const centerX = (effectiveRightBound + effectiveLeftBound) / 2;
        startRight = Math.min(effectiveRightBound, centerX + scaledTotalSpan / 2);
      } else if (effectiveLeft) {
        // Left-aligned RTL line: ends flush with effectiveLeftBound, so first word starts at effectiveLeftBound + scaledTotalSpan
        startRight = Math.min(effectiveRightBound, effectiveLeftBound + scaledTotalSpan);
      }

      let curRight = startRight;
      for (let wIdx = 0; wIdx < realWords.length; wIdx++) {
        const w = realWords[wIdx];
        const wW = wordWidths[wIdx] * widthScale;
        const effectiveGap = gapWidth * widthScale;
        pushWordCommand(w, wIdx, curRight, wW);
        curRight -= wW + effectiveGap;
      }

      return {
        role: line.role,
        unitId: line.unitId,
        lineIndex: line.lineIndex,
        xLeft: Number(physXLeft.toFixed(2)),
        xRight: Number(physXRight.toFixed(2)),
        targetWidth: Number(targetW.toFixed(2)),
        yBaseline: Number(physYBaseline.toFixed(2)),
        yTop: Number((physYBaseline - line.ascent).toFixed(2)),
        yBottom: Number((physYBaseline + line.descent).toFixed(2)),
        isJustified: shouldJustify,
        isLastLine: Boolean(line.isLastLine),
        isCenteredHeading: effectiveCentered,
        alignment: effectiveAlignment,
        firstLineIndentPt: Number(firstIndentPt.toFixed(2)),
        rightIndentPt: Number(rightIndentPt.toFixed(2)),
        leftIndentPt: Number(leftIndentPt.toFixed(2)),
        hangingIndentPt: Number(hangingIndentPt.toFixed(2)),
        leadingPt: Number((line.leadingPt ?? line.height).toFixed(2)),
        spaceBeforePt: Number((line.spaceBeforePt ?? 0).toFixed(2)),
        spaceAfterPt: Number((line.spaceAfterPt ?? 0).toFixed(2)),
        fontFamily: effectiveFontFamily,
        fontSizePt: effectiveFontSizePt,
        baseFontWeight: effectiveFontWeight,
        isItalic: Boolean(line.isItalic),
        isUnderline: Boolean(line.isUnderline),
        textColor: line.textColor,
        words: wordCommands,
      };
    };

    if (layoutType === 'single_column') {
      for (const line of sourceLines) {
        const isHeading = line.role === 'chapter' || line.role === 'heading' || line.role === 'main_title';
        const fontSize = isHeading ? 16.5 : 13.5;
        const fontWeight = isHeading ? 700 : 400;
        planLines.push(
          buildLineCommand(line, mRight, mTop + line.yBaseline, sourceFont, fontSize, fontWeight, isHeading)
        );
      }
    } else if (layoutType === 'two_column') {
      const colGutter = designSettings?.columns?.columnGapPt ?? 16.0;
      const colW = (contentW - colGutter) / 2.0;
      const col1Right = mRight;
      const col2Right = mLeft + colW;

      for (const line of sourceLines) {
        const isHeading =
          line.role === 'chapter' ||
          line.role === 'heading' ||
          line.role === 'siman' ||
          line.role === 'main_title';
        planLines.push(
          buildLineCommand(line, col1Right, mTop + line.yBaseline, sourceFont, 11.5, isHeading ? 700 : 400, isHeading)
        );
      }
      if (column2Lines && column2Lines.length > 0) {
        for (const line of column2Lines) {
          const isHeading =
            line.role === 'chapter' ||
            line.role === 'heading' ||
            line.role === 'siman' ||
            line.role === 'main_title';
          planLines.push(
            buildLineCommand(line, col2Right, mTop + line.yBaseline, sourceFont, 11.5, isHeading ? 700 : 400, isHeading)
          );
        }
      }
    } else if (layoutType === 'source_top_commentary_bottom') {
      for (const line of sourceLines) {
        const isHeading =
          line.role === 'chapter' ||
          line.role === 'heading' ||
          line.role === 'siman' ||
          line.role === 'main_title';
        const fontSize = isHeading ? 15.5 : 13.0;
        const fontWeight = isHeading ? 700 : 500;
        planLines.push(
          buildLineCommand(line, mRight, mTop + line.yBaseline, sourceFont, fontSize, fontWeight, isHeading)
        );
      }
      const colGutter = designSettings?.columns?.columnGapPt ?? 14.0;
      const colW = (contentW - colGutter) / 2.0;
      const leftColRight = mLeft + colW;

      for (const line of rashiLines) {
        planLines.push(buildLineCommand(line, mRight, mTop + line.yBaseline, rashiFont, 10.5, 400, false));
      }
      for (const line of tosafotLines) {
        planLines.push(buildLineCommand(line, leftColRight, mTop + line.yBaseline, tosafotFont, 10.0, 400, false));
      }
    } else {
      // Classic Rav-Text with Upper Knees & Lower Stepped Knees
      const rashiRight = mRight;
      const rashiLeft = mRight - knee.rightCommentaryWidth;
      const sourceRight = rashiLeft - knee.gutterWidth;

      for (let i = 0; i < sourceLines.length; i++) {
        const line = sourceLines[i];
        // B-1 Fix: Heading status depends strictly on semantic role (never on `i === 0 && line.lineIndex === 0`)
        const isChapterHeading =
          line.role === 'chapter' ||
          line.role === 'heading' ||
          line.role === 'main_title' ||
          line.role === 'siman';
        const lineRightX =
          line.xRight !== undefined ? mLeft + line.xRight : sourceRight - line.xStart;
        const fontSize = isChapterHeading ? 16.0 : 14.5;
        const fontWeight = isChapterHeading ? 700 : 600;
        planLines.push(
          buildLineCommand(line, lineRightX, mTop + line.yBaseline, sourceFont, fontSize, fontWeight, isChapterHeading)
        );
      }

      for (const line of rashiLines) {
        const rRightX = line.xRight !== undefined ? mLeft + line.xRight : rashiRight;
        planLines.push(
          buildLineCommand(line, rRightX, mTop + line.yBaseline, rashiFont, 10.5, 400, false)
        );
      }

      for (const line of tosafotLines) {
        const tRightX =
          line.xRight !== undefined ? mLeft + line.xRight : mLeft + line.targetWidth;
        planLines.push(
          buildLineCommand(line, tRightX, mTop + line.yBaseline, tosafotFont, 10.5, 400, false)
        );
      }
    }

    // 5. Footnotes at bottom of page using their exact solved coordinates and FootnoteDesignSettings
    const fnDefaultSize = designSettings?.footnotes?.fontSizePt ?? 9.5;
    const fnDefaultLeading = designSettings?.footnotes?.leadingPt ?? 13;
    const fnIndentPt = designSettings?.footnotes?.indentPt ?? 0;
    if (footnoteLines && footnoteLines.length > 0) {
      const fallbackTop = mBottom - footnoteLines.length * fnDefaultLeading + 10;
      for (let fi = 0; fi < footnoteLines.length; fi++) {
        const fnLine = footnoteLines[fi];
        const physFnY =
          fnLine.yBaseline > 0 ? mTop + fnLine.yBaseline : fallbackTop + fi * fnDefaultLeading;
        const effectiveFnLine: TypesetLine =
          fnIndentPt > 0 && !fnLine.rightIndentPt
            ? { ...fnLine, rightIndentPt: fnIndentPt }
            : fnLine;
        planLines.push(
          buildLineCommand(
            effectiveFnLine,
            mRight,
            physFnY,
            footnoteFont,
            fnDefaultSize,
            400,
            false
          )
        );
      }
    }

    // 6. Ornaments at their exact solved `placedOrnaments` coordinates (B-2)
    const planOrnaments: PdfOrnamentDrawCommand[] = (page.placedOrnaments ?? []).map(orn => ({
      ornamentId: orn.asset.id,
      placement: orn.asset.placement,
      xLeft: Number(orn.x.toFixed(2)),
      xRight: Number((orn.x + orn.width).toFixed(2)),
      yTop: Number((mTop + orn.y).toFixed(2)),
      yBottom: Number((mTop + orn.y + orn.height).toFixed(2)),
      width: Number(orn.width.toFixed(2)),
      height: Number(orn.height.toFixed(2)),
      ornament: orn,
    }));

    const showRunningHeader =
      designSettings?.pageElements?.showRunningHeader ??
      designSettings?.pageLayout?.showRunningHeader ??
      true;
    const showRunningFooter =
      designSettings?.pageLayout?.showRunningFooter ?? true;
    const showFolioNumber =
      designSettings?.pageElements?.showFolioNumber ??
      (designSettings?.pageLayout?.pageNumberPosition !== 'hidden');
    const showDecorativeFrame =
      designSettings?.pageElements?.showDecorativeFrame ?? false;
    const folioNumberPosition =
      designSettings?.pageElements?.folioNumberPosition ??
      designSettings?.pageLayout?.pageNumberPosition ??
      'top_outside';
    const runningHeaderFontSizePt =
      designSettings?.pageElements?.runningHeaderFontSizePt ??
      designSettings?.pageLayout?.runningHeaderFontSizePt ??
      10.5;
    const showFootnoteSeparatorLine =
      designSettings?.footnotes?.showSeparatorRule ??
      designSettings?.footnotes?.showSeparatorLine ??
      true;
    const footnoteSeparatorWidthRatio =
      designSettings?.footnotes?.separatorWidthRatio ?? 0.25;
    const footnoteSeparatorSpacingAbovePt =
      designSettings?.footnotes?.separatorSpacingAbovePt ?? 4;
    const footnoteSeparatorSpacingBelowPt =
      designSettings?.footnotes?.separatorSpacingBelowPt ?? 4;

    return {
      pageNumber,
      pageNumberHebrew: this.toHebrewGematria(pageNumber),
      headerTitle: headerTitle || 'ספר קודש',
      continuationHeader,
      continuationFooter,
      showRunningHeader,
      showRunningFooter,
      showFolioNumber,
      showDecorativeFrame,
      folioNumberPosition,
      runningHeaderFontSizePt,
      showFootnoteSeparatorLine,
      footnoteSeparatorWidthRatio,
      footnoteSeparatorSpacingAbovePt,
      footnoteSeparatorSpacingBelowPt,
      footnoteSeparatorWeightPt: 0.85,
      lines: planLines,
      ornaments: planOrnaments,
    };
  }

  /**
   * Renders a single line from the authoritative PdfLineDrawCommand plan onto the canvas.
   * Each word is drawn at its exact solved `[xLeft, xRight]` coordinate, completely preventing
   * word overlap or Canvas BiDi reordering drift, while honoring italic, underline, color,
   * horizontal scaling, and baseline shift.
   */
  private static drawPlannedLine(
    ctx: CanvasRenderingContext2D,
    lineCmd: PdfLineDrawCommand,
    defaultFillStyle: string
  ) {
    if (lineCmd.words.length === 0) return;

    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    const RLM = '\u200F';

    for (const wCmd of lineCmd.words) {
      ctx.save();
      const fontStylePrefix = wCmd.isItalic ? 'italic ' : '';
      ctx.font = `${fontStylePrefix}${wCmd.fontWeight} ${this.ptInCanvasSpace(wCmd.fontSizePt)}px "${wCmd.fontFamily}", "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
      ctx.fillStyle = wCmd.textColor || lineCmd.textColor || defaultFillStyle;

      const scaleX =
        wCmd.horizontalScalePercent && wCmd.horizontalScalePercent !== 100
          ? wCmd.horizontalScalePercent / 100
          : 1.0;

      if (scaleX !== 1.0) {
        ctx.translate(wCmd.xRight, wCmd.yBaseline);
        ctx.scale(scaleX, 1.0);
        ctx.fillText(RLM + wCmd.text + RLM, 0, 0);
      } else {
        ctx.fillText(RLM + wCmd.text + RLM, wCmd.xRight, wCmd.yBaseline);
      }

      if (wCmd.isUnderline) {
        ctx.strokeStyle = wCmd.textColor || lineCmd.textColor || defaultFillStyle;
        ctx.lineWidth = Math.max(0.6, wCmd.fontSizePt * 0.06);
        const underlineY = wCmd.yBaseline + Math.max(1.5, wCmd.fontSizePt * 0.12);
        ctx.beginPath();
        ctx.moveTo(wCmd.xLeft, underlineY);
        ctx.lineTo(wCmd.xRight, underlineY);
        ctx.stroke();
      }
      ctx.restore();

      if (wCmd.footnoteMarker !== undefined) {
        const markerStr = `[${wCmd.footnoteMarker}]`;
        const markerSize = Math.max(6.5, wCmd.fontSizePt * 0.65);
        ctx.save();
        ctx.font = `700 ${this.ptInCanvasSpace(markerSize)}px "${wCmd.fontFamily}", serif`;
        ctx.fillStyle = '#92400E';
        ctx.textAlign = 'left';
        ctx.fillText(markerStr, wCmd.xLeft, wCmd.yBaseline - wCmd.fontSizePt * 0.28);
        ctx.restore();
      }
    }
  }

  /**
   * Renders a single typeset page onto a high-DPI canvas (300 DPI equivalent)
   * strictly consuming the authoritative `PageTypesetResult` via `buildPageRenderPlan`.
   */
  public static renderPageToCanvas(page: PageTypesetResult, scale: number = 3.0): HTMLCanvasElement {
    const {
      geometry,
      footnoteLines,
      column2Lines,
      pageNumber,
      headerTitle,
      layoutType,
      dividerY,
      continuationHeader,
      continuationFooter,
    } = page;

    const renderPlan = this.buildPageRenderPlan(page);

    const canvas = document.createElement('canvas');
    canvas.dir = 'rtl';
    canvas.setAttribute('dir', 'rtl');
    canvas.width = Math.round(geometry.pageWidth * scale);
    canvas.height = Math.round(geometry.pageHeight * scale);
    const ctx = canvas.getContext('2d');

    if (!ctx) return canvas;
    ctx.direction = 'rtl';

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Scale coordinate system 1:1 with typographical points
    ctx.scale(scale, scale);

    // 1. Holy-book parchment surface (#FCFAF5)
    ctx.fillStyle = '#FCFAF5';
    ctx.fillRect(0, 0, geometry.pageWidth, geometry.pageHeight);

    const mTop = geometry.marginTop;
    const mBottom = geometry.pageHeight - geometry.marginBottom;
    const mLeft = geometry.marginInside;
    const mRight = geometry.pageWidth - geometry.marginOutside;
    const contentW = mRight - mLeft;
    const contentH = mBottom - mTop;

    // 2. Corner Crop Marks & Registration
    ctx.strokeStyle = '#99948E';
    ctx.lineWidth = 0.5;
    const markLen = 14;

    ctx.beginPath();
    ctx.moveTo(mLeft - 4, mTop); ctx.lineTo(mLeft - 4 - markLen, mTop);
    ctx.moveTo(mLeft, mTop - 4); ctx.lineTo(mLeft, mTop - 4 - markLen);
    ctx.moveTo(mRight + 4, mTop); ctx.lineTo(mRight + 4 + markLen, mTop);
    ctx.moveTo(mRight, mTop - 4); ctx.lineTo(mRight, mTop - 4 - markLen);
    ctx.moveTo(mLeft - 4, mBottom); ctx.lineTo(mLeft - 4 - markLen, mBottom);
    ctx.moveTo(mLeft, mBottom + 4); ctx.lineTo(mLeft, mBottom + 4 + markLen);
    ctx.moveTo(mRight + 4, mBottom); ctx.lineTo(mRight + 4 + markLen, mBottom);
    ctx.moveTo(mRight, mBottom + 4); ctx.lineTo(mRight, mBottom + 4 + markLen);
    ctx.stroke();

    if (renderPlan.showDecorativeFrame) {
      ctx.strokeStyle = '#8B7D6B';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(mLeft - 6, mTop - 6, contentW + 12, contentH + 12);
    }

    // 3. Running Header, Hebrew Folio & Continuation Header (respecting pageElements settings)
    const hebrewFolio = this.toHebrewGematria(pageNumber);
    const hdrFontPt = renderPlan.runningHeaderFontSizePt || 10.5;
    ctx.direction = 'rtl';

    if (renderPlan.showRunningHeader) {
      ctx.font = `600 ${this.ptInCanvasSpace(hdrFontPt)}px "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
      ctx.fillStyle = '#2C2A29';
      ctx.textAlign = 'center';
      ctx.fillText(headerTitle || 'ספר קודש', geometry.pageWidth / 2, mTop - 18);

      if (continuationHeader) {
        ctx.textAlign = 'left';
        ctx.font = `500 ${this.ptInCanvasSpace(Math.max(7.5, hdrFontPt - 2))}px "Frank Ruhl Libre", serif`;
        ctx.fillStyle = '#6B5E4C';
        ctx.fillText(continuationHeader, mLeft, mTop - 18);
      }

      // Ornamental header divider rule
      ctx.strokeStyle = '#B8AEA0';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(mLeft, mTop - 10);
      ctx.lineTo(mRight, mTop - 10);
      ctx.stroke();
    }

    if (renderPlan.showFolioNumber && renderPlan.folioNumberPosition !== 'hidden') {
      ctx.font = `700 ${this.ptInCanvasSpace(hdrFontPt)}px "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
      ctx.fillStyle = '#2C2A29';
      if (renderPlan.folioNumberPosition === 'bottom_center') {
        ctx.textAlign = 'center';
        ctx.fillText(`דף ${hebrewFolio}`, geometry.pageWidth / 2, mBottom + 16);
      } else if (renderPlan.folioNumberPosition === 'bottom_outside') {
        ctx.textAlign = 'right';
        ctx.fillText(`דף ${hebrewFolio}`, mRight, mBottom + 16);
      } else if (renderPlan.folioNumberPosition === 'top_center' && !renderPlan.showRunningHeader) {
        ctx.textAlign = 'center';
        ctx.fillText(`דף ${hebrewFolio}`, geometry.pageWidth / 2, mTop - 18);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(`דף ${hebrewFolio}`, mRight, mTop - 18);
      }
    }

    // 4. Layout-Specific Decorative Rules (Two-Column / Top-Bottom)
    if (layoutType === 'two_column' && column2Lines && column2Lines.length > 0) {
      const colGutter = page.designSettings?.columns?.columnGapPt ?? 16.0;
      const colW = (contentW - colGutter) / 2.0;
      ctx.strokeStyle = '#D8CFC2';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(mRight - colW - colGutter / 2, mTop);
      ctx.lineTo(mRight - colW - colGutter / 2, mBottom - 10);
      ctx.stroke();
    } else if (layoutType === 'source_top_commentary_bottom') {
      const divY = mTop + (dividerY || contentH * 0.44);
      ctx.strokeStyle = '#8B2500';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(mLeft + 30, divY);
      ctx.lineTo(mRight - 30, divY);
      ctx.stroke();

      ctx.fillStyle = '#8B2500';
      ctx.beginPath();
      const midX = geometry.pageWidth / 2;
      ctx.moveTo(midX, divY - 3);
      ctx.lineTo(midX + 3, divY);
      ctx.lineTo(midX, divY + 3);
      ctx.lineTo(midX - 3, divY);
      ctx.closePath();
      ctx.fill();

      const colGutter = page.designSettings?.columns?.columnGapPt ?? 14.0;
      const colW = (contentW - colGutter) / 2.0;
      ctx.strokeStyle = '#E0D8CC';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(mRight - colW - colGutter / 2, divY + 8);
      ctx.lineTo(mRight - colW - colGutter / 2, mBottom - 10);
      ctx.stroke();
    }

    // 5. Footnote separator rule if page has footnotes and showFootnoteSeparatorLine is enabled
    if (footnoteLines && footnoteLines.length > 0 && renderPlan.showFootnoteSeparatorLine) {
      const fnLinesInPlan = renderPlan.lines.filter(l => l.role === 'footnote');
      const minFnTop =
        fnLinesInPlan.length > 0
          ? Math.min(...fnLinesInPlan.map(l => l.yTop))
          : mBottom - (footnoteLines.length * 13 + 10);
      const sepLen = Math.max(36, contentW * (renderPlan.footnoteSeparatorWidthRatio || 0.25));
      const sepY = minFnTop - (renderPlan.footnoteSeparatorSpacingBelowPt || 4);

      ctx.strokeStyle = '#333333';
      ctx.lineWidth = renderPlan.footnoteSeparatorWeightPt || 0.85;
      ctx.beginPath();
      ctx.moveTo(mRight - sepLen, sepY);
      ctx.lineTo(mRight, sepY);
      ctx.stroke();
    }

    // 6. Draw all solved lines & words from the authoritative renderPlan
    for (const lineCmd of renderPlan.lines) {
      const defaultFill =
        lineCmd.role === 'footnote'
          ? '#3A3836'
          : lineCmd.role === 'primary_comment' || lineCmd.role === 'secondary_comment'
          ? '#222120'
          : '#121214';
      this.drawPlannedLine(ctx, lineCmd, defaultFill);
    }

    // 6.5 Draw all solved ornaments from `renderPlan.ornaments` at exact solved coordinates (B-2)
    for (const ornCmd of renderPlan.ornaments) {
      OrnamentLibraryEngine.drawOrnamentOnCanvas(ctx, ornCmd.ornament, mTop);
    }

    // 7. Continuation Footer at bottom margin if present
    if (continuationFooter && renderPlan.showRunningFooter) {
      ctx.direction = 'rtl';
      ctx.textAlign = 'left';
      ctx.font = `600 ${this.ptInCanvasSpace(8.5)}px "Frank Ruhl Libre", serif`;
      ctx.fillStyle = '#5C5346';
      ctx.fillText(continuationFooter, mLeft, mBottom + 14);
    }

    return canvas;
  }

  /**
   * Renders a single typeset page directly into a `jsPDF` document as native vector graphics
   * and embedded/subsetted TrueType Hebrew text (`BT ... TJ ... ET`) using the exact solved
   * `PdfPageRenderPlan` coordinates.
   *
   * Zero raster page flattening is used: all Hebrew words, Nikud/Taamim combining marks,
   * bold Dibbur HaMatchil runs, footnotes, running headers, Hebrew folios, dividers, crop marks,
   * and explicitly user-selected ornaments are emitted as selectable/searchable PDF operators.
   */
  public static renderPageToPdfNative(doc: jsPDF, page: PageTypesetResult): PdfPageRenderPlan {
    const {
      geometry,
      footnoteLines,
      column2Lines,
      pageNumber,
      headerTitle,
      layoutType,
      dividerY,
      continuationHeader,
      continuationFooter,
    } = page;

    const renderPlan = this.buildPageRenderPlan(page);
    const pageW = geometry.pageWidth;
    const pageH = geometry.pageHeight;

    const mTop = geometry.marginTop;
    const mBottom = pageH - geometry.marginBottom;
    const mLeft = geometry.marginInside;
    const mRight = pageW - geometry.marginOutside;
    const contentW = mRight - mLeft;
    const contentH = mBottom - mTop;

    // 1. Holy-book parchment background (#FCFAF5)
    doc.setFillColor(252, 250, 245);
    doc.rect(0, 0, pageW, pageH, 'F');

    // 2. Corner Crop Marks & Registration (vector lines)
    doc.setDrawColor(153, 148, 142);
    doc.setLineWidth(0.5);
    const markLen = 14;
    doc.line(mLeft - 4, mTop, mLeft - 4 - markLen, mTop);
    doc.line(mLeft, mTop - 4, mLeft, mTop - 4 - markLen);
    doc.line(mRight + 4, mTop, mRight + 4 + markLen, mTop);
    doc.line(mRight, mTop - 4, mRight, mTop - 4 - markLen);
    doc.line(mLeft - 4, mBottom, mLeft - 4 - markLen, mBottom);
    doc.line(mLeft, mBottom + 4, mLeft, mBottom + 4 + markLen);
    doc.line(mRight + 4, mBottom, mRight + 4 + markLen, mBottom);
    doc.line(mRight, mBottom + 4, mRight, mBottom + 4 + markLen);

    if (renderPlan.showDecorativeFrame) {
      doc.setDrawColor(139, 125, 107);
      doc.setLineWidth(1.0);
      doc.rect(mLeft - 6, mTop - 6, contentW + 12, contentH + 12, 'S');
    }

    // Helper to draw multi-word or single-word header/folio strings in native RTL order
    const drawHeaderOrFolioPhrase = (
      phrase: string,
      alignMode: 'right' | 'center' | 'left',
      anchorX: number,
      yBase: number,
      fontSize: number,
      isBold: boolean,
      colorHex: string
    ) => {
      const words = phrase.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return;
      const gapPt = fontSize * 0.28;
      const wordWidths = words.map(w => Math.max(fontSize * 0.6, PdfNativeTextEngine.stripNikud(w).length * fontSize * 0.52));
      const totalSpan =
        wordWidths.reduce((s, w) => s + w, 0) + Math.max(0, words.length - 1) * gapPt;

      let curRight = anchorX;
      if (alignMode === 'center') {
        curRight = anchorX + totalSpan / 2;
      } else if (alignMode === 'left') {
        curRight = anchorX + totalSpan;
      }

      for (let wi = 0; wi < words.length; wi++) {
        const wStr = words[wi];
        const wW = wordWidths[wi];
        PdfNativeTextEngine.drawNativeWord(doc, {
          text: wStr,
          xLeft: curRight - wW,
          xRight: curRight,
          yBaseline: yBase,
          pageHeight: pageH,
          fontFamily: 'Frank Ruhl Libre',
          fontSizePt: fontSize,
          isBold,
          textColorHex: colorHex,
        });
        curRight -= wW + gapPt;
      }
    };

    // 3. Running Header, Hebrew Folio & Continuation Header
    const hebrewFolio = this.toHebrewGematria(pageNumber);
    const hdrFontPt = renderPlan.runningHeaderFontSizePt || 10.5;

    if (renderPlan.showRunningHeader) {
      drawHeaderOrFolioPhrase(
        headerTitle || 'ספר קודש',
        'center',
        pageW / 2,
        mTop - 18,
        hdrFontPt,
        true,
        '#2C2A29'
      );

      if (continuationHeader) {
        drawHeaderOrFolioPhrase(
          continuationHeader,
          'left',
          mLeft,
          mTop - 18,
          Math.max(7.5, hdrFontPt - 2),
          false,
          '#6B5E4C'
        );
      }

      doc.setDrawColor(184, 174, 160);
      doc.setLineWidth(0.75);
      doc.line(mLeft, mTop - 10, mRight, mTop - 10);
    }

    if (renderPlan.showFolioNumber && renderPlan.folioNumberPosition !== 'hidden') {
      const folioLabel = `דף ${hebrewFolio}`;
      if (renderPlan.folioNumberPosition === 'bottom_center') {
        drawHeaderOrFolioPhrase(folioLabel, 'center', pageW / 2, mBottom + 16, hdrFontPt, true, '#2C2A29');
      } else if (renderPlan.folioNumberPosition === 'bottom_outside') {
        drawHeaderOrFolioPhrase(folioLabel, 'right', mRight, mBottom + 16, hdrFontPt, true, '#2C2A29');
      } else if (renderPlan.folioNumberPosition === 'top_center' && !renderPlan.showRunningHeader) {
        drawHeaderOrFolioPhrase(folioLabel, 'center', pageW / 2, mTop - 18, hdrFontPt, true, '#2C2A29');
      } else {
        drawHeaderOrFolioPhrase(folioLabel, 'right', mRight, mTop - 18, hdrFontPt, true, '#2C2A29');
      }
    }

    // 4. Layout-Specific Decorative Vector Rules (Two-Column / Top-Bottom)
    if (layoutType === 'two_column' && column2Lines && column2Lines.length > 0) {
      const colGutter = page.designSettings?.columns?.columnGapPt ?? 16.0;
      const colW = (contentW - colGutter) / 2.0;
      const divX = mRight - colW - colGutter / 2;
      doc.setDrawColor(216, 207, 194);
      doc.setLineWidth(0.5);
      doc.line(divX, mTop, divX, mBottom - 10);
    } else if (layoutType === 'source_top_commentary_bottom') {
      const divY = mTop + (dividerY || contentH * 0.44);
      doc.setDrawColor(139, 37, 0);
      doc.setLineWidth(1.0);
      doc.line(mLeft + 30, divY, mRight - 30, divY);

      doc.setFillColor(139, 37, 0);
      const midX = pageW / 2;
      doc.triangle(midX, divY - 3, midX + 3, divY, midX, divY + 3, 'F');
      doc.triangle(midX, divY - 3, midX - 3, divY, midX, divY + 3, 'F');

      const colGutter = page.designSettings?.columns?.columnGapPt ?? 14.0;
      const colW = (contentW - colGutter) / 2.0;
      const divX = mRight - colW - colGutter / 2;
      doc.setDrawColor(224, 216, 204);
      doc.setLineWidth(0.5);
      doc.line(divX, divY + 8, divX, mBottom - 10);
    }

    // 5. Footnote separator rule if page has footnotes and showFootnoteSeparatorLine is enabled
    if (footnoteLines && footnoteLines.length > 0 && renderPlan.showFootnoteSeparatorLine) {
      const fnLinesInPlan = renderPlan.lines.filter(l => l.role === 'footnote');
      const minFnTop =
        fnLinesInPlan.length > 0
          ? Math.min(...fnLinesInPlan.map(l => l.yTop))
          : mBottom - (footnoteLines.length * 13 + 10);
      const sepLen = Math.max(36, contentW * (renderPlan.footnoteSeparatorWidthRatio || 0.25));
      const sepY = minFnTop - (renderPlan.footnoteSeparatorSpacingBelowPt || 4);

      doc.setDrawColor(51, 51, 51);
      doc.setLineWidth(renderPlan.footnoteSeparatorWeightPt || 0.85);
      doc.line(mRight - sepLen, sepY, mRight, sepY);
    }

    // 6. Emit all solved lines & words from the authoritative renderPlan as native vector text
    for (const lineCmd of renderPlan.lines) {
      const defaultColor =
        lineCmd.role === 'footnote'
          ? '#3A3836'
          : lineCmd.role === 'primary_comment' || lineCmd.role === 'secondary_comment'
          ? '#222120'
          : '#121214';

      for (const wCmd of lineCmd.words) {
        const effectiveColor = wCmd.textColor || lineCmd.textColor || defaultColor;
        PdfNativeTextEngine.drawNativeWord(doc, {
          text: wCmd.text,
          xLeft: wCmd.xLeft,
          xRight: wCmd.xRight,
          yBaseline: wCmd.yBaseline,
          pageHeight: pageH,
          fontFamily: wCmd.fontFamily,
          fontSizePt: wCmd.fontSizePt,
          isBold: wCmd.isBold,
          textColorHex: effectiveColor,
          horizontalScalePercent: wCmd.horizontalScalePercent,
          trackingEm: wCmd.trackingEm,
        });

        if (wCmd.isUnderline) {
          const rgb = PdfNativeTextEngine.parseHexColorToRgb01(effectiveColor);
          doc.setDrawColor(
            Math.round(rgb[0] * 255),
            Math.round(rgb[1] * 255),
            Math.round(rgb[2] * 255)
          );
          doc.setLineWidth(Math.max(0.6, wCmd.fontSizePt * 0.06));
          const underlineY = wCmd.yBaseline + Math.max(1.5, wCmd.fontSizePt * 0.12);
          doc.line(wCmd.xLeft, underlineY, wCmd.xRight, underlineY);
        }

        if (wCmd.footnoteMarker !== undefined) {
          const markerStr = `[${wCmd.footnoteMarker}]`;
          const markerSize = Math.max(6.5, wCmd.fontSizePt * 0.65);
          const markerW = markerStr.length * markerSize * 0.45;
          PdfNativeTextEngine.drawNativeWord(doc, {
            text: markerStr,
            xLeft: wCmd.xLeft,
            xRight: wCmd.xLeft + markerW,
            yBaseline: Number((wCmd.yBaseline - wCmd.fontSizePt * 0.28).toFixed(2)),
            pageHeight: pageH,
            fontFamily: wCmd.fontFamily,
            fontSizePt: markerSize,
            isBold: true,
            textColorHex: '#92400E',
          });
        }
      }
    }

    // 6.5 Draw all explicitly user-selected ornaments as native vector paths at exact solved coordinates
    for (const ornCmd of renderPlan.ornaments) {
      OrnamentLibraryEngine.drawOrnamentOnPdf(doc, ornCmd.ornament, mTop);
    }

    // 7. Continuation Footer at bottom margin if present
    if (continuationFooter && renderPlan.showRunningFooter) {
      drawHeaderOrFolioPhrase(
        continuationFooter,
        'left',
        mLeft,
        mBottom + 14,
        8.5,
        true,
        '#5C5346'
      );
    }

    return renderPlan;
  }

  /**
   * Parses a generated PDF binary (`Blob`, `ArrayBuffer`, or `Uint8Array`) and returns all
   * extracted Unicode text spans, lines, positions, and font metadata for verification and search.
   */
  public static async extractPdfContent(
    pdfInput: Blob | ArrayBuffer | Uint8Array
  ): Promise<ExtractedPdfDocument> {
    return PdfNativeTextEngine.extractTextAndPositionsFromPdf(pdfInput);
  }

  /**
   * Generates a single page print-ready native vector PDF
   */
  public static async generatePrintPdf(page: PageTypesetResult, documentTitle?: string): Promise<Blob> {
    const singleDoc: BookTypesetDocument = {
      title: documentTitle || page.headerTitle || 'ספר קודש',
      layoutType: page.layoutType,
      pages: [page],
      totalPages: 1,
      geometry: page.geometry,
      designSettings: page.designSettings,
    };
    return this.generateMultiPagePdf(singleDoc);
  }

  /**
   * Generates a multi-page print-ready native, selectable, searchable PDF containing ALL pages in the book
   */
  public static async generateMultiPagePdf(
    bookDoc: BookTypesetDocument,
    onProgress?: (current: number, total: number) => void
  ): Promise<Blob> {
    // Stage 12 Level 0 Enforcement: Never knowingly export a document with unresolved layout loss or Engine Hard Rule violations
    const totalPlacedOrnaments = bookDoc.pages.reduce(
      (s, p) => s + (p.placedOrnaments?.length ?? 0),
      0
    );
    EngineHardRulesEngine.assertExportAllowed({
      bookDoc,
      links: bookDoc.links,
      userSuppliedOrnamentsCount: totalPlacedOrnaments,
    });

    const { geometry, pages } = bookDoc;
    const totalPages = pages.length;

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [geometry.pageWidth, geometry.pageHeight],
      compress: true,
    });

    // Register embedded Hebrew TrueType fonts (Frank Ruhl Libre, Noto Rashi Hebrew, David Libre)
    await PdfNativeTextEngine.registerFontsOnDoc(doc);

    for (let i = 0; i < totalPages; i++) {
      if (i > 0) {
        doc.addPage([geometry.pageWidth, geometry.pageHeight], 'portrait');
      }

      onProgress?.(i + 1, totalPages);

      const pageWithSettings: PageTypesetResult =
        pages[i].designSettings || !bookDoc.designSettings
          ? pages[i]
          : { ...pages[i], designSettings: bookDoc.designSettings };

      this.renderPageToPdfNative(doc, pageWithSettings);
    }

    return doc.output('blob');
  }
}
