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
  HeaderFolioPosition,
  OpeningWordBoxGeom,
  VilnaHeaderGeom,
  textBlockLeft,
  textBlockRight,
  PageGeometry,
  PageTypesetResult,
  PlacedOrnament,
  SeparatorStyleId,
  ShapedWord,
  TransitionMarkerGeom,
  TypesetLine,
} from '../types/typesetter';
import { OrnamentLibraryEngine } from './ornament-library';
import { computeSpineWidthMm } from './book-production';
import { EngineHardRulesEngine } from './engine-hard-rules';
import {
  ExtractedPdfDocument,
  KETER_EMBEDDED_FONTS,
  PdfNativeTextEngine,
} from './pdf-native-text-engine';
import { buildTocFromBook, CoverPageData, TocEntry, titlePageSettingsToCoverData } from './toc-engine';
import {
  effectiveTitlePageBackground,
  effectiveTitlePageBorderStyleId,
  layoutTemplateMetadataRows,
  readTitlePageTemplateState,
  resolveTemplateOrnaments,
  resolveTitlePageTemplate,
  resolveTitlePageTemplateId,
  type TitlePageBackgroundKind,
  type TitlePageMetadataRow,
  type TitlePageTemplateId,
  type TitlePageTemplateMetadata,
  type TitlePageTemplateOrnament,
} from './title-page-templates';
// v0.5.0 (Title Page / Shaar Blat builder): the shared field layout and
// the original vector border geometry.
import {
  buildTitlePageBorderCommands,
  drawBorderCommandsOnCanvas,
  getLoadedBorderImage,
  layoutTitlePageFields,
  loadBorderImage,
  titlePageBorderImageRect,
  type TitlePageBorderCommand,
} from './title-page-borders';
import type {
  TitlePageBorderStyleId,
  RunningHeaderAlignment,
} from '../types/design-settings';
import { resolveRunningHeader } from '../types/design-settings';
import { hebrewNumeral } from './hebrew-numerals';
import { inRtlPlacementOrder } from './bidi-runs';

/**
 * Print-ready PDF options (v0.3.0, module B). All fields optional; defaults
 * preserve the pre-v0.3.0 behaviour (3mm bleed, full range, colour, no
 * cover/TOC, no watermark, single pages).
 */
export interface PrintPdfOptions {
  /** Bleed around the trim box, in millimetres (default 3 when print options are passed; a call with no options at all keeps the legacy trim-size export). Ignored for `purpose: 'screen'`. */
  bleedMm?: number;
  /** Inclusive 1-based book page range to export; null/undefined exports all pages. */
  pageRange?: { from: number; to: number } | null;
  /** Watermark text drawn diagonally on every page. Shown automatically for `purpose: 'proof'`. */
  watermark?: string | null;
  /** Two body pages side-by-side on one wide sheet (raster spread; see report). */
  spreads?: boolean;
  /** 'print' = press-ready (bleed + crop marks), 'screen' = no bleed, 'proof' = watermarked. */
  purpose?: 'print' | 'screen' | 'proof';
  /** 'blackOnly' converts text and rules to grayscale (true CMYK is out of scope; jsPDF is RGB-only). */
  colorMode?: 'color' | 'blackOnly';
  /** Prepend a cover page built from `coverData` (or the book title). */
  includeCover?: boolean;
  /** Prepend table-of-contents pages built from the book's headings. */
  includeToc?: boolean;
  /** Cover data; defaults to `{ title: bookDoc.title }` when `includeCover` is set. */
  coverData?: CoverPageData | null;
  /** Pre-built TOC entries; when omitted and `includeToc` is set, entries are built from the book. */
  tocEntries?: TocEntry[] | null;
}

export const DEFAULT_PRINT_PDF_OPTIONS: Required<
  Pick<PrintPdfOptions, 'bleedMm' | 'spreads' | 'purpose' | 'colorMode' | 'includeCover' | 'includeToc'>
> = {
  bleedMm: 3,
  spreads: false,
  purpose: 'print',
  colorMode: 'color',
  includeCover: false,
  includeToc: false,
};

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
  unitBoundaryAfter?: boolean;
  transitionMarkerBefore?: string;
  transitionMarkerVerified?: boolean;
  /** v0.9.9 (I2): Vilna transition-marker presentation (from ravText.transitionMarker). */
  transitionMarkerStyle?: 'text' | 'boxed';
  transitionMarkerSizePt?: number;
  transitionMarkerPosition?: 'before_first_word' | 'after_last_word';
  separatorStyleId?: SeparatorStyleId;
  separatorWidthRatio?: number;
  separatorThicknessPt?: number;
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

/** One title-page field in the render plan (shared layout — same heights
 *  as the preview and the IDML exporter). */
export interface TitlePagePlanField {
  text: string;
  fontFamily: string;
  fontSizePt: number;
  isBold: boolean;
  alignment: 'center' | 'right' | 'left';
  /** Baseline position, in points from the top of the page. */
  yBaselinePt: number;
  colorHex: string;
  /** v0.6.0 Part C (§8): drag offset and line height, from the project. */
  xOffsetPt: number;
  lineHeight: number;
  // v0.9.9 — template typography flags (carried in the plan so the
  // canvas fallback can honour them; the native PDF honours uppercase
  // + letter-spacing and renders italic upright — see the note on
  // drawAlignedPhrase / renderCoverPageToPdf).
  italic?: boolean;
  uppercase?: boolean;
  smallCaps?: boolean;
  letterSpacingPt?: number;
}

/** Title-page data in the render plan, for plan consumers (the Chromium
 *  endpoint, the canvas fallback) as well as the native vector renderer. */
export interface TitlePagePlanData {
  rows: TitlePagePlanField[];
  borderStyleId: TitlePageBorderStyleId;
  borderThicknessPt: number;
  borderInsetMm: number;
  borderEnabled: boolean;
  customBorderImageDataUrl?: string;
  /** v0.6.0 Part C (§8): border fit — scale / padding / position. */
  borderScalePct?: number;
  borderPaddingMm?: number;
  borderOffsetXMm?: number;
  borderOffsetYMm?: number;
  // v0.9.9 — title-page template carry-through (Part B §9): the chosen
  // preset, its metadata, ornaments, background and laid-out metadata
  // rows. Absent = legacy/classic default (old plans render exactly
  // as before). The two anchor baselines let the canvas fallback place
  // the belowTitle / abovePublisher ornaments without a field id.
  templateId?: TitlePageTemplateId;
  templateMetadata?: TitlePageTemplateMetadata;
  ornaments?: TitlePageTemplateOrnament[];
  background?: TitlePageBackgroundKind;
  metadataRows?: TitlePageMetadataRow[];
  titleRowYBaselinePt?: number;
  publisherRowYBaselinePt?: number;
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
  // v0.5.0 (integrator — user request): folio format — plain numbers or
  // Hebrew letters, with or without the "דף" prefix.
  pageNumberStyle: 'numbers' | 'hebrew';
  showDafPrefix: boolean;
  showDecorativeFrame: boolean;
  folioNumberPosition: HeaderFolioPosition;
  runningHeaderFontSizePt: number;
  // v0.6.0 Part A (§5): editable running-header slots, resolved per page
  // (global text + the page's override + automatic fallbacks — the same
  // resolver the preview uses, so preview and PDF agree). Empty text =
  // slot hidden. `headerShowPageNumber` is true when the folio is drawn
  // as the header's right slot, in which case the standalone top-folio
  // draw below must skip it (no double folio).
  headerLeftText: string;
  headerCenterText: string;
  headerRightText: string;
  headerShowLeft: boolean;
  headerShowCenter: boolean;
  headerShowRight: boolean;
  headerShowPageNumber: boolean;
  headerAlignment: RunningHeaderAlignment;
  headerFontFamily: string;
  headerFontSizePt: number;
  /**
   * v0.9.8 Phase 5 (Quick-Tune / Koteret) — the divider rule under the
   * running header. Default true (the rule draws whenever the header
   * band draws, exactly as before); false removes the rule only.
   */
  headerDividerRule: boolean;
  showFootnoteSeparatorLine: boolean;
  footnoteSeparatorWidthRatio: number;
  footnoteSeparatorSpacingAbovePt: number;
  footnoteSeparatorSpacingBelowPt: number;
  footnoteSeparatorWeightPt: number;
  lines: PdfLineDrawCommand[];
  ornaments: PdfOrnamentDrawCommand[];
  folioDisplay?: string;
  openingWordBox?: OpeningWordBoxGeom;
  /** Layout training T2.1 — engine-laid-out Vilna running head (physical pt). */
  vilnaHeader?: VilnaHeaderGeom;
  /** v0.9.9 (I2): frame stroke for the opening-word box (ravText.openingDecoration.thicknessPt). */
  openingDecorationThicknessPt?: number;
  transitionMarkers?: TransitionMarkerGeom[];
  peripheralStreams?: Array<{ stream: string; label: string; lines: PdfLineDrawCommand[] }>;
  // v0.8.0 Part C (§7): the Michtav box (first Vilna page only) — physical
  // pt coordinates + centred text, drawn as a bordered box in the canvas
  // render and added to the invisible text layer.
  michtavBox?: {
    xLeft: number;
    xRight: number;
    yTop: number;
    yBottom: number;
    text: string;
  };
  // v0.5.0 (Title Page / Shaar Blat builder): true on the synthetic first
  // page. Its `lines` are empty; `titlePage` carries the fields + border.
  // No running header or folio is drawn on it.
  isTitlePage?: boolean;
  titlePage?: TitlePagePlanData;
  // v0.8.0 Part E: image-only pages — `lines` is empty; `pageImages`
  // carries the images the renderers (native PDF, Chromium PDF) must draw.
  isImageOnlyPage?: boolean;
  pageImages?: Array<{ dataUrl: string; altText?: string; widthPx?: number; heightPx?: number }>;
}

export class PdfExporter {
  /**
   * Convert Arabic number to traditional Hebrew numeral (Gematria)
   * e.g., 1 -> א׳, 2 -> ב׳, 15 -> ט״ו, 16 -> ט״ז, 50 -> נ׳
   */
  public static toHebrewGematria(num: number): string {
    return hebrewNumeral(num) || 'א׳';
  }

  /**
   * Because `ctx.scale(scale, scale)` maps the canvas coordinate system 1:1 to typographical points
   * (`geometry.pageWidth` x `geometry.pageHeight` pt), font declarations in canvas coordinates MUST
   * be in exact point units (`pt` -> `${pt}px` in the scaled user space), NOT multiplied by 1.3333!
   */
  /**
   * v0.3.0 (Module C) — Anchor for the `top_inside` folio position: the binding
   * (inside) side — right edge on a recto page, left edge on a verso page of an
   * RTL book. Returns the anchor X and the text alignment to use with it.
   */
  private static folioInsideAnchor(
    isVerso: boolean,
    mLeft: number,
    mRight: number
  ): { x: number; align: 'left' | 'right' } {
    return isVerso ? { x: mLeft, align: 'left' } : { x: mRight, align: 'right' };
  }

  private static ptInCanvasSpace(pt: number): number {
    return Number(pt.toFixed(2));
  }

  // ---------------------------------------------------------------------------
  // v0.3.0 print options: colour conversion, bleed geometry, cover / TOC /
  // watermark pages. True CMYK is out of scope (jsPDF is RGB-only); black-only
  // is implemented as a luminance grayscale conversion of the exporter's
  // text and rule colours. Ornaments keep their amber colour (see report).
  // ---------------------------------------------------------------------------

  public static mmToPt(mm: number): number {
    return (mm * 72) / 25.4;
  }

  /** Luminance grayscale of a #rrggbb colour, returned as #gggggg. */
  public static toGrayHex(hex: string): string {
    const [r, g, b] = PdfNativeTextEngine.parseHexColorToRgb01(hex);
    const lum = Math.round(0.2126 * r * 255 + 0.7152 * g * 255 + 0.0722 * b * 255);
    const v = Math.max(0, Math.min(255, lum)).toString(16).padStart(2, '0');
    return `#${v}${v}${v}`;
  }

  /** Grayscale of an 0–255 RGB triple. */
  private static toGrayRgb(r: number, g: number, b: number): [number, number, number] {
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    return [lum, lum, lum];
  }

  /** Shift every coordinate in a render plan by (dx, dy) — used to inset content by the bleed. */
  private static shiftRenderPlan(plan: PdfPageRenderPlan, dx: number, dy: number): PdfPageRenderPlan {
    if (dx === 0 && dy === 0) return plan;
    const shiftLines = (ls: PdfLineDrawCommand[]) =>
      ls.map(line => ({
        ...line,
        xLeft: line.xLeft + dx,
        xRight: line.xRight + dx,
        yBaseline: line.yBaseline + dy,
        yTop: line.yTop + dy,
        yBottom: line.yBottom + dy,
        words: line.words.map(w => ({
          ...w,
          xLeft: w.xLeft + dx,
          xRight: w.xRight + dx,
          yBaseline: w.yBaseline + dy,
          yTop: w.yTop + dy,
          yBottom: w.yBottom + dy,
        })),
      }));
    return {
      ...plan,
      lines: shiftLines(plan.lines),
      peripheralStreams: plan.peripheralStreams?.map(ps => ({
        ...ps,
        lines: shiftLines(ps.lines),
      })),
      vilnaHeader: plan.vilnaHeader
        ? {
            ...plan.vilnaHeader,
            items: plan.vilnaHeader.items.map(it => ({
              ...it,
              xLeft: it.xLeft + dx,
              xRight: it.xRight + dx,
              yBaseline: it.yBaseline + dy,
              words: it.words.map(w => ({ ...w, xLeft: w.xLeft + dx, xRight: w.xRight + dx })),
            })),
          }
        : undefined,
      openingWordBox: plan.openingWordBox
        ? {
            ...plan.openingWordBox,
            xLeft: plan.openingWordBox.xLeft + dx,
            xRight: plan.openingWordBox.xRight + dx,
            yTop: plan.openingWordBox.yTop + dy,
            yBottom: plan.openingWordBox.yBottom + dy,
          }
        : undefined,
      michtavBox: plan.michtavBox
        ? {
            ...plan.michtavBox,
            xLeft: plan.michtavBox.xLeft + dx,
            xRight: plan.michtavBox.xRight + dx,
            yTop: plan.michtavBox.yTop + dy,
            yBottom: plan.michtavBox.yBottom + dy,
          }
        : undefined,
      ornaments: plan.ornaments.map(o => ({
        ...o,
        xLeft: o.xLeft + dx,
        xRight: o.xRight + dx,
        yTop: o.yTop + dy,
        yBottom: o.yBottom + dy,
        // Only x is shifted here: drawOrnamentOnPdf adds the (bleed-inclusive)
        // marginTop to orn.y itself, so shifting y would double-count the bleed.
        ornament: { ...o.ornament, x: o.ornament.x + dx },
      })),
    };
  }

  /**
   * Draw one phrase centred on `centerX` using the native Hebrew text engine
   * (shaped, searchable). Shared by cover / TOC pages.
   */
  private static drawCenteredPhrase(
    doc: jsPDF,
    phrase: string,
    centerX: number,
    yBase: number,
    pageHeight: number,
    fontSize: number,
    isBold: boolean,
    colorHex: string,
    fontFamily = 'Frank Ruhl Libre'
  ): void {
    const words = phrase.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const gapPt = fontSize * 0.28;
    const wordWidths = words.map(w =>
      Math.max(fontSize * 0.6, PdfNativeTextEngine.stripNikud(w).length * fontSize * 0.52)
    );
    const totalSpan =
      wordWidths.reduce((s, w) => s + w, 0) + Math.max(0, words.length - 1) * gapPt;
    let curRight = centerX + totalSpan / 2;
    for (let wi = 0; wi < words.length; wi++) {
      const wW = wordWidths[wi];
      PdfNativeTextEngine.drawNativeWord(doc, {
        text: words[wi],
        xLeft: curRight - wW,
        xRight: curRight,
        yBaseline: yBase,
        pageHeight,
        fontFamily,
        fontSizePt: fontSize,
        isBold,
        textColorHex: colorHex,
      });
      curRight -= wW + gapPt;
    }
  }

  /** Right-aligned phrase (used for TOC entry titles). */
  private static drawRightPhrase(
    doc: jsPDF,
    phrase: string,
    rightX: number,
    yBase: number,
    pageHeight: number,
    fontSize: number,
    isBold: boolean,
    colorHex: string
  ): void {
    const words = phrase.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const gapPt = fontSize * 0.28;
    const wordWidths = words.map(w =>
      Math.max(fontSize * 0.6, PdfNativeTextEngine.stripNikud(w).length * fontSize * 0.52)
    );
    let curRight = rightX;
    for (let wi = 0; wi < words.length; wi++) {
      const wW = wordWidths[wi];
      PdfNativeTextEngine.drawNativeWord(doc, {
        text: words[wi],
        xLeft: curRight - wW,
        xRight: curRight,
        yBaseline: yBase,
        pageHeight,
        fontFamily: 'Frank Ruhl Libre',
        fontSizePt: fontSize,
        isBold,
        textColorHex: colorHex,
      });
      curRight -= wW + gapPt;
    }
  }

  /**
   * Diagonal watermark: the text is laid word-by-word along the page
   * diagonal with the shaped native engine, so Hebrew watermarks stay
   * shaped (unlike a rotated jsPDF `doc.text` call).
   */
  private static drawDiagonalWatermark(
    doc: jsPDF,
    text: string,
    mediaW: number,
    mediaH: number,
    colorHex: string
  ): void {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const fontSize = 42;
    const gapPt = fontSize * 0.5;
    const wordWidths = words.map(w =>
      Math.max(fontSize * 0.6, PdfNativeTextEngine.stripNikud(w).length * fontSize * 0.52)
    );
    const totalSpan =
      wordWidths.reduce((s, w) => s + w, 0) + Math.max(0, words.length - 1) * gapPt;
    // Diagonal from upper-right to lower-left, centred on the page centre.
    // RTL reading starts at the right, so the first word sits upper-right.
    const cx = mediaW / 2;
    const cy = mediaH / 2;
    const angle = Math.atan2(mediaH, mediaW);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let curRight = cx + (totalSpan / 2) * dx;
    let curBase = cy - (totalSpan / 2) * dy;
    for (let wi = 0; wi < words.length; wi++) {
      const wW = wordWidths[wi];
      // drawNativeWord anchors on xRight; walk the diagonal leftwards/downwards.
      PdfNativeTextEngine.drawNativeWord(doc, {
        text: words[wi],
        xLeft: curRight - wW,
        xRight: curRight,
        yBaseline: curBase,
        pageHeight: mediaH,
        fontFamily: 'Frank Ruhl Libre',
        fontSizePt: fontSize,
        isBold: true,
        textColorHex: colorHex,
      });
      curRight -= (wW + gapPt) * dx;
      curBase += (wW + gapPt) * dy;
    }
  }

  /**
   * Print boxes for a press-ready file (approach from DesignCraft's PDF
   * export, MIT / Apache-2.0: MediaBox = trim + bleed, TrimBox = the
   * page, BleedBox = page + bleed). Keter already pads every sheet by the
   * bleed and draws crop marks; without /TrimBox a print shop's preflight
   * (Acrobat, PitStop, imposition) takes the padded sheet as the page.
   */
  public static applyPrintBoxes(doc: jsPDF, bleedPt: number): void {
    if (!(bleedPt > 0)) return;
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      const ctx = (doc.getPageInfo(i) as unknown as { pageContext: Record<string, unknown> }).pageContext as {
        mediaBox: { bottomLeftX: number; bottomLeftY: number; topRightX: number; topRightY: number };
        trimBox: unknown;
        bleedBox: unknown;
      };
      const mb = ctx.mediaBox;
      if (!mb || mb.topRightX - mb.bottomLeftX <= 2 * bleedPt || mb.topRightY - mb.bottomLeftY <= 2 * bleedPt) continue;
      ctx.bleedBox = { ...mb };
      ctx.trimBox = {
        bottomLeftX: mb.bottomLeftX + bleedPt,
        bottomLeftY: mb.bottomLeftY + bleedPt,
        topRightX: mb.topRightX - bleedPt,
        topRightY: mb.topRightY - bleedPt,
      };
    }
  }

  /** Crop marks at the four trim-box corners (the trim box is inset by `bleedPt` from the media edge). */
  private static drawTrimCropMarks(
    doc: jsPDF,
    mediaW: number,
    mediaH: number,
    bleedPt: number,
    gray: [number, number, number]
  ): void {
    if (bleedPt <= 0) return;
    doc.setDrawColor(gray[0], gray[1], gray[2]);
    doc.setLineWidth(0.5);
    const len = bleedPt;
    const corners: Array<[number, number, number, number]> = [
      [bleedPt, bleedPt, -1, -1],
      [mediaW - bleedPt, bleedPt, 1, -1],
      [bleedPt, mediaH - bleedPt, -1, 1],
      [mediaW - bleedPt, mediaH - bleedPt, 1, 1],
    ];
    for (const [x, y, sx, sy] of corners) {
      doc.line(x, y, x + sx * len, y);
      doc.line(x, y, x, y + sy * len);
    }
  }

  // ── v0.5.0 (Title Page / Shaar Blat builder) ───────────────────────────
  /** Parse a '#RRGGBB' colour into an RGB triple. */
  private static hexToRgb(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return [42, 38, 34];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  /**
   * Draw title-page border commands on the jsPDF page. Commands are in the
   * normalized 0..1000 space and are scaled to the page here. Paths use
   * only M/L/Q/C/Z (see title-page-borders.ts), converted to jsPDF
   * `lines()` segments (relative to the current point; Q is promoted to a
   * cubic). Filled subpaths (diamonds) are filled, the rest stroked.
   */
  private static drawBorderCommandsOnPdf(
    doc: jsPDF,
    commands: TitlePageBorderCommand[],
    pageWidthPt: number,
    pageHeightPt: number,
    colorHex: string,
    thicknessPt: number,
    offsetPt = 0
  ): void {
    if (commands.length === 0) return;
    const [r, g, b] = this.hexToRgb(colorHex);
    doc.setDrawColor(r, g, b);
    doc.setFillColor(r, g, b);
    doc.setLineWidth(Math.max(0.4, thicknessPt));
    const sx = pageWidthPt / 1000;
    const sy = pageHeightPt / 1000;
    for (const cmd of commands) {
      if (cmd.type === 'rect') {
        doc.rect(cmd.x * sx + offsetPt, cmd.y * sy + offsetPt, cmd.w * sx, cmd.h * sy, 'S');
      } else if (cmd.type === 'line') {
        doc.line(cmd.x1 * sx + offsetPt, cmd.y1 * sy + offsetPt, cmd.x2 * sx + offsetPt, cmd.y2 * sy + offsetPt);
      } else {
        // Tokenize the path: commands M/L/H/V/Q/C/Z with absolute numbers.
        // v0.6.0 Part C (§8): H/V were missing — the stepped frame's
        // horizontal/vertical edges were silently dropped in the native
        // PDF. They are straight segments, like L.
        const tokens = cmd.d.match(/[MLHVQCTZ]|-?\d*\.?\d+/g) ?? [];
        let i = 0;
        let cx = 0;
        let cy = 0;
        let startX = 0;
        let startY = 0;
        let segments: number[][] = [];
        let closed = false;
        const flush = (style: 'S' | 'F') => {
          if (segments.length === 0) return;
          // jsPDF lines(): scale is [sx, sy]; bezier legs are
          // [c1x, c1y, c2x, c2y, endX, endY], all relative to the
          // current point.
          doc.lines(segments, startX, startY, [1, 1], style, closed);
          segments = [];
          closed = false;
        };
        while (i < tokens.length) {
          const op = tokens[i++];
          const num = () => Number(tokens[i++]);
          if (op === 'M') {
            flush(cmd.filled ? 'F' : 'S');
            startX = num() * sx + offsetPt;
            startY = num() * sy + offsetPt;
            cx = startX;
            cy = startY;
          } else if (op === 'L') {
            const x = num() * sx;
            const y = num() * sy;
            segments.push([x - cx, y - cy]);
            cx = x;
            cy = y;
          } else if (op === 'H') {
            const x = num() * sx;
            segments.push([x - cx, 0]);
            cx = x;
          } else if (op === 'V') {
            const y = num() * sy;
            segments.push([0, y - cy]);
            cy = y;
          } else if (op === 'Q') {
            const qx = num() * sx;
            const qy = num() * sy;
            const x = num() * sx;
            const y = num() * sy;
            const c1x = cx + (2 / 3) * (qx - cx);
            const c1y = cy + (2 / 3) * (qy - cy);
            const c2x = x + (2 / 3) * (qx - x);
            const c2y = y + (2 / 3) * (qy - y);
            segments.push([c1x - cx, c1y - cy, c2x - cx, c2y - cy, x - cx, y - cy]);
            cx = x;
            cy = y;
          } else if (op === 'C') {
            const c1x = num() * sx;
            const c1y = num() * sy;
            const c2x = num() * sx;
            const c2y = num() * sy;
            const x = num() * sx;
            const y = num() * sy;
            segments.push([c1x - cx, c1y - cy, c2x - cx, c2y - cy, x - cx, y - cy]);
            cx = x;
            cy = y;
          } else if (op === 'Z') {
            closed = true;
          }
        }
        flush(cmd.filled ? 'F' : 'S');
      }
    }
  }

  /**
   * One title-page field on the jsPDF page, aligned as the field asks
   * (center / right / left within the content margins). Same word-width
   * estimate as `drawCenteredPhrase`; a phrase wider than the content
   * area is shrunk to fit (never below 8pt) instead of overflowing the
   * page. The font family falls back to a bundled font when it is not
   * registered on the document (see PdfNativeTextEngine).
   */
  private static drawAlignedPhrase(
    doc: jsPDF,
    phrase: string,
    opts: { alignment: 'center' | 'right' | 'left'; leftX: number; rightX: number; centerX: number },
    yBase: number,
    pageHeight: number,
    fontSize: number,
    isBold: boolean,
    colorHex: string,
    fontFamily = 'Frank Ruhl Libre',
    // v0.9.9 — letter-spacing in em, for template metadata rows
    // (TitlePageMetadataRow.letterSpacingPt / fontSizePt). Italic is
    // NOT supported by the native PDF text engine (normal|bold only —
    // see PdfNativeTextEngine.drawNativeWord), so italic rows render
    // upright here and italic only in the canvas fallback.
    trackingEm = 0
  ): void {
    const words = phrase.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const measure = (size: number) => {
      const gapPt = size * (0.28 + trackingEm);
      const wordWidths = words.map(w =>
        Math.max(size * 0.6, PdfNativeTextEngine.stripNikud(w).length * size * 0.52)
      );
      const totalSpan =
        wordWidths.reduce((s, w) => s + w, 0) + Math.max(0, words.length - 1) * gapPt;
      return { gapPt, wordWidths, totalSpan };
    };
    let size = fontSize;
    let m = measure(size);
    const availW = Math.max(24, opts.rightX - opts.leftX);
    if (m.totalSpan > availW) {
      size = Math.max(8, fontSize * (availW / m.totalSpan));
      m = measure(size);
    }
    const rightEdge =
      opts.alignment === 'center'
        ? opts.centerX + m.totalSpan / 2
        : opts.alignment === 'right'
          ? opts.rightX
          : opts.leftX + m.totalSpan;
    let curRight = rightEdge;
    for (let wi = 0; wi < words.length; wi++) {
      const wW = m.wordWidths[wi];
      PdfNativeTextEngine.drawNativeWord(doc, {
        text: words[wi],
        xLeft: curRight - wW,
        xRight: curRight,
        yBaseline: yBase,
        pageHeight,
        fontFamily,
        fontSizePt: size,
        isBold,
        textColorHex: colorHex,
        trackingEm,
      });
      curRight -= wW + m.gapPt;
    }
  }

  /**
   * Render a cover (title) page onto the current jsPDF page (media size
   * already set).
   *
   * v0.5.0 (Title Page / Shaar Blat builder): draws ALL title-page fields
   * (title, subtitle, author, translator, volume, year, extra lines,
   * publisher) at the shared layout heights (`layoutTitlePageFields` —
   * the same heights as the preview and the IDML exporter), each in its
   * own font/size/alignment, plus the stock vector border or the
   * user-imported frame image. The classic ornament rule under the title
   * is kept. A custom frame image is embedded with `addImage` — the
   * caller must allow raster pages in the vector assertion for that
   * export (see `generateMultiPagePdf`).
   */
  public static computeCoverSheetDimensions(
    cover: CoverPageData | null | undefined,
    geometry: PageGeometry,
    defaultBleedPt: number
  ): { isWraparound: boolean; widthPt: number; heightPt: number; bleedPt: number; spinePt: number } {
    if (cover?.coverMode === 'print_wraparound_cover' && cover.wraparoundCover) {
      const wc = cover.wraparoundCover;
      // Layout training T3.5 — spine from leaves × caliper when the shop's
      // paper thickness is known; the typed width otherwise.
      const spineMm =
        wc.caliperMm && wc.caliperMm > 0 && wc.interiorPageCount
          ? computeSpineWidthMm({
              pages: wc.interiorPageCount,
              caliperMm: wc.caliperMm,
              signatureMultiple: wc.signatureMultiple,
              coverBoardMm: wc.coverBoardMm,
            })
          : Math.max(4, wc.spineWidthMm || 14);
      const spinePt = this.mmToPt(Math.max(1, spineMm));
      const bleedPt = this.mmToPt(Math.max(0, wc.bleedMm ?? 3));
      return {
        isWraparound: true,
        widthPt: geometry.pageWidth * 2 + spinePt + 2 * bleedPt,
        heightPt: geometry.pageHeight + 2 * bleedPt,
        bleedPt,
        spinePt,
      };
    }
    return {
      isWraparound: false,
      widthPt: geometry.pageWidth + 2 * defaultBleedPt,
      heightPt: geometry.pageHeight + 2 * defaultBleedPt,
      bleedPt: defaultBleedPt,
      spinePt: 0,
    };
  }

  public static renderCoverPageToPdf(
    doc: jsPDF,
    cover: CoverPageData,
    geometry: PageGeometry,
    opts: { bleedPt?: number; colorMode?: 'color' | 'blackOnly' } = {}
  ): void {
    const blackOnly = opts.colorMode === 'blackOnly';
    const dims = this.computeCoverSheetDimensions(cover, geometry, opts.bleedPt ?? 0);
    const bleed = dims.bleedPt;
    const mediaW = dims.widthPt;
    const mediaH = dims.heightPt;
    const g = (hex: string) => (blackOnly ? this.toGrayHex(hex) : hex);
    // For wraparound RTL book: Left panel = Front cover, Middle = Spine, Right panel = Back cover.
    const frontXOffset = bleed;
    const spineX = bleed + geometry.pageWidth;
    const backXOffset = bleed + geometry.pageWidth + dims.spinePt;
    const cx = frontXOffset + geometry.pageWidth / 2;

    // v0.9.9 — template background: plain #FCFAF5 (the old fill),
    // warm #F5EDDC, textured #FCFAF5 + a faint dot pattern. Black-only
    // press output stays white.
    const bg = cover.background ?? 'plain';
    const bgFill: [number, number, number] = blackOnly
      ? [255, 255, 255]
      : bg === 'warm'
        ? [245, 237, 220]
        : [252, 250, 245];
    doc.setFillColor(...bgFill);
    doc.rect(0, 0, mediaW, mediaH, 'F');
    if (!blackOnly && bg === 'textured') {
      doc.setFillColor(232, 226, 214);
      for (let dy = 12; dy < mediaH; dy += 24) {
        for (let dx = 12; dx < mediaW; dx += 24) {
          doc.circle(dx, dy, 0.6, 'F');
        }
      }
    }
    this.drawTrimCropMarks(doc, mediaW, mediaH, bleed, blackOnly ? [150, 150, 150] : [153, 148, 142]);

    if (dims.isWraparound && cover.wraparoundCover) {
      const foldRgb = blackOnly ? [150, 150, 150] : [168, 160, 148];
      doc.setDrawColor(foldRgb[0], foldRgb[1], foldRgb[2]);
      doc.setLineWidth(0.5);
      // Fold tick marks at top and bottom of spine edges
      doc.line(spineX, 0, spineX, Math.max(8, bleed));
      doc.line(spineX, mediaH, spineX, mediaH - Math.max(8, bleed));
      doc.line(backXOffset, 0, backXOffset, Math.max(8, bleed));
      doc.line(backXOffset, mediaH, backXOffset, mediaH - Math.max(8, bleed));

      // Spine text
      const spineStr = (cover.wraparoundCover.spineText || cover.title || '').trim();
      if (spineStr) {
        this.drawCenteredPhrase(
          doc,
          spineStr,
          spineX + dims.spinePt / 2,
          mediaH * 0.45,
          mediaH,
          Math.min(11, Math.max(7, dims.spinePt * 0.36)),
          true,
          g('#2A2622')
        );
      }

      // Back cover optional texts (strictly omitted when blank)
      const backCenterX = backXOffset + geometry.pageWidth / 2;
      const backTitle = (cover.wraparoundCover.backCoverSubtitle ?? '').trim();
      const backBody = (cover.wraparoundCover.backCoverText ?? '').trim();
      if (backTitle) {
        this.drawCenteredPhrase(doc, backTitle, backCenterX, bleed + mediaH * 0.25, mediaH, 16, true, g('#1E1B18'));
      }
      if (backBody) {
        const backLines = backBody.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        let by = bleed + mediaH * 0.34;
        for (const bl of backLines) {
          this.drawAlignedPhrase(
            doc,
            bl,
            {
              alignment: 'center',
              leftX: backXOffset + geometry.marginInside,
              rightX: backXOffset + geometry.pageWidth - geometry.marginOutside,
              centerX: backCenterX,
            },
            by,
            mediaH,
            11.5,
            false,
            g('#2C2A29')
          );
          by += 18;
        }
      }
    }

    // Border: drawn inside the front-cover panel (`frontXOffset .. frontXOffset + pageWidth`)
    const borderGeom = {
      scalePct: cover.borderScalePct,
      paddingMm: cover.borderPaddingMm,
      offsetXMm: cover.borderOffsetXMm,
      offsetYMm: cover.borderOffsetYMm,
    };
    if (cover.customBorderImageDataUrl) {
      const fmt = cover.customBorderImageDataUrl.startsWith('data:image/png')
        ? 'PNG'
        : cover.customBorderImageDataUrl.startsWith('data:image/svg')
          ? 'SVG'
          : 'JPEG';
      try {
        const rect = titlePageBorderImageRect(
          {
            enabled: cover.borderEnabled !== false,
            styleId: cover.borderStyleId ?? 'double',
            thicknessPt: cover.borderThicknessPt ?? 1,
            insetMm: cover.borderInsetMm ?? 12,
            ...borderGeom,
          },
          geometry.pageWidth,
          geometry.pageHeight
        );
        doc.addImage(
          cover.customBorderImageDataUrl,
          fmt as 'PNG' | 'JPEG' | 'SVG',
          rect.x + frontXOffset,
          rect.y + bleed,
          rect.w,
          rect.h
        );
      } catch {
        // An unreadable frame image must not fail the whole export; the
        // title text below still prints.
      }
    } else if (cover.borderEnabled !== false && cover.borderStyleId && cover.borderStyleId !== 'none') {
      const commands = buildTitlePageBorderCommands(
        cover.borderStyleId,
        cover.borderInsetMm ?? 12,
        cover.borderThicknessPt ?? 1,
        geometry.pageWidth,
        geometry.pageHeight,
        borderGeom
      );
      this.drawBorderCommandsOnPdf(
        doc,
        commands,
        geometry.pageWidth,
        geometry.pageHeight,
        blackOnly ? '#555555' : '#2A2622',
        cover.borderThicknessPt ?? 1,
        frontXOffset
      );
    }

    const fieldOr = (
      style: import('../types/design-settings').TitlePageFieldStyle | undefined,
      fallback: { fontSizePt: number; spaceAbovePt: number; spaceBelowPt: number }
    ): import('../types/design-settings').TitlePageFieldStyle => ({
      text: '',
      fontFamily: '',
      alignment: 'center',
      ...fallback,
      ...(style ?? {}),
    });
    const rows = layoutTitlePageFields(
      {
        enabled: true,
        title: { ...fieldOr(cover.fieldStyles?.title, { fontSizePt: 30, spaceAbovePt: 0, spaceBelowPt: 18 }), text: cover.title },
        subtitle: { ...fieldOr(cover.fieldStyles?.subtitle, { fontSizePt: 15, spaceAbovePt: 6, spaceBelowPt: 10 }), text: cover.subtitle ?? '' },
        author: { ...fieldOr(cover.fieldStyles?.author, { fontSizePt: 13, spaceAbovePt: 10, spaceBelowPt: 6 }), text: cover.author ?? '' },
        translator: { ...fieldOr(cover.fieldStyles?.translator, { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 }), text: cover.translator ?? '' },
        publisher: { ...fieldOr(cover.fieldStyles?.publisher, { fontSizePt: 12, spaceAbovePt: 0, spaceBelowPt: 0 }), text: cover.publisher ?? '' },
        volume: { ...fieldOr(cover.fieldStyles?.volume, { fontSizePt: 13, spaceAbovePt: 8, spaceBelowPt: 4 }), text: cover.volume ?? '' },
        year: { ...fieldOr(cover.fieldStyles?.year, { fontSizePt: 12, spaceAbovePt: 4, spaceBelowPt: 6 }), text: cover.year ?? '' },
        extraLines: (cover.extraLines ?? [])
          .filter(t => t.trim().length > 0)
          .map((text, i) =>
            cover.extraLineStyles?.[i]
              ? { ...cover.extraLineStyles[i], text }
              : { text, fontFamily: '', fontSizePt: 12, alignment: 'center' as const, spaceAbovePt: 4, spaceBelowPt: 4 }
          ),
        border: {
          enabled: cover.borderEnabled !== false,
          styleId: cover.borderStyleId ?? 'double',
          thicknessPt: cover.borderThicknessPt ?? 1,
          insetMm: cover.borderInsetMm ?? 12,
          ...borderGeom,
        },
        customBorderImage: null,
      },
      cover.title,
      geometry.pageHeight
    );
    const mLeft = frontXOffset + textBlockLeft(geometry);
    const mRight = frontXOffset + textBlockRight(geometry);
    for (const row of rows) {
      if (!row.text.trim()) continue;
      this.drawAlignedPhrase(
        doc,
        row.text,
        {
          alignment: row.alignment,
          leftX: mLeft + row.xOffsetPt,
          rightX: mRight + row.xOffsetPt,
          centerX: cx + row.xOffsetPt,
        },
        row.yBaselinePt + bleed,
        mediaH,
        row.fontSizePt,
        row.isBold,
        g(row.colorHex),
        row.fontFamily || 'Frank Ruhl Libre'
      );
    }

    // v0.9.9 — template metadata rows (English title, editor,
    // dedication, …), laid out by layoutTemplateMetadataRows against
    // the standard rows above. Uppercase / small-caps are applied to
    // the text; letter-spacing goes through trackingEm; italic has no
    // native-PDF support and renders upright here (canvas honours it).
    for (const mRow of cover.metadataRows ?? []) {
      if (!mRow.text.trim()) continue;
      const displayText = mRow.uppercase || mRow.smallCaps ? mRow.text.toUpperCase() : mRow.text;
      const size = mRow.smallCaps ? mRow.fontSizePt * 0.85 : mRow.fontSizePt;
      this.drawAlignedPhrase(
        doc,
        displayText,
        {
          alignment: mRow.alignment,
          leftX: mLeft,
          rightX: mRight,
          centerX: cx,
        },
        mRow.yBaselinePt + bleed,
        mediaH,
        size,
        mRow.isBold,
        g(mRow.colorHex),
        mRow.fontFamily || 'Frank Ruhl Libre',
        (mRow.letterSpacingPt ?? 0) / Math.max(1, mRow.fontSizePt)
      );
      if (mRow.ruleBelow) {
        const ruleY = mRow.yBaselinePt + bleed + 8;
        const ruleRgb = blackOnly ? this.toGrayRgb(107, 94, 76) : [107, 94, 76];
        doc.setDrawColor(ruleRgb[0], ruleRgb[1], ruleRgb[2]);
        doc.setLineWidth(0.75);
        doc.line(cx - 20, ruleY, cx + 20, ruleY);
      }
    }

    // v0.9.9 — template ornaments (vector, from ornament-library):
    // top medallion, divider below the title, divider above the
    // publisher, foot emblem. Positions are the template's own
    // (topCenter / belowTitle / abovePublisher / footCenter).
    const titleRowForOrnament = rows.find(r => r.fieldId === 'title');
    const publisherRow = rows.find(r => r.fieldId === 'publisher');
    const hasBelowTitleOrnament = (cover.ornaments ?? []).some(o => o.position === 'belowTitle');
    for (const orn of cover.ornaments ?? []) {
      const vb = OrnamentLibraryEngine.TITLE_PAGE_ORNAMENT_VIEWBOX[orn.ornamentId];
      if (!vb) continue;
      const w = orn.widthPt;
      const h = (w * vb.h) / vb.w;
      const x = cx - w / 2;
      let y: number;
      if (orn.position === 'topCenter') {
        y = bleed + 10;
      } else if (orn.position === 'belowTitle') {
        y = (titleRowForOrnament?.yBaselinePt ?? geometry.pageHeight * 0.42) + bleed + 10;
      } else if (orn.position === 'abovePublisher') {
        y = (publisherRow?.yBaselinePt ?? geometry.pageHeight * 0.88) + bleed - h - 10;
      } else {
        y = bleed + geometry.pageHeight * 0.82 - h / 2;
      }
      OrnamentLibraryEngine.drawTitlePageOrnamentOnPdf(
        doc, orn.ornamentId, x, y, w, h, blackOnly ? '#555555' : '#2A2622'
      );
    }

    // Ornament rule under the title (the classic look, kept from v0.3.0).
    // A template divider in the same spot replaces it — never both.
    const titleRow = rows.find(r => r.fieldId === 'title');
    if (titleRow && !hasBelowTitleOrnament) {
      const ruleY = titleRow.yBaselinePt + bleed + 26;
      const ruleRgb = blackOnly ? this.toGrayRgb(139, 37, 0) : [139, 37, 0];
      doc.setDrawColor(ruleRgb[0], ruleRgb[1], ruleRgb[2]);
      doc.setLineWidth(1.0);
      doc.line(cx - 70, ruleY, cx - 14, ruleY);
      doc.line(cx + 14, ruleY, cx + 70, ruleY);
      doc.setFillColor(ruleRgb[0], ruleRgb[1], ruleRgb[2]);
      doc.triangle(cx, ruleY - 3.5, cx + 3.5, ruleY, cx, ruleY + 3.5, 'F');
      doc.triangle(cx, ruleY - 3.5, cx - 3.5, ruleY, cx, ruleY + 3.5, 'F');
    }
    if ((cover.ornament ?? '').trim()) {
      this.drawCenteredPhrase(doc, cover.ornament!.trim(), cx, mediaH * 0.82, mediaH, 16, false, g('#8B7D6B'));
    }
  }

  /** Number of TOC entries that fit on one TOC page. */
  public static readonly TOC_ENTRIES_PER_PAGE = 32;

  /**
   * Render one table-of-contents page onto the current jsPDF page.
   * Entry titles are right-aligned with a dotted leader to the page number.
   */
  public static renderTocPageToPdf(
    doc: jsPDF,
    entries: TocEntry[],
    geometry: PageGeometry,
    opts: { bleedPt?: number; colorMode?: 'color' | 'blackOnly' } = {}
  ): void {
    const blackOnly = opts.colorMode === 'blackOnly';
    const bleed = opts.bleedPt ?? 0;
    const mediaW = geometry.pageWidth + 2 * bleed;
    const mediaH = geometry.pageHeight + 2 * bleed;
    const g = (hex: string) => (blackOnly ? this.toGrayHex(hex) : hex);
    const mLeft = textBlockLeft(geometry) + bleed;
    const mRight = textBlockRight(geometry) + bleed;
    const mTop = geometry.marginTop + bleed;

    doc.setFillColor(...(blackOnly ? ([255, 255, 255] as [number, number, number]) : ([252, 250, 245] as [number, number, number])));
    doc.rect(0, 0, mediaW, mediaH, 'F');
    this.drawTrimCropMarks(doc, mediaW, mediaH, bleed, blackOnly ? [150, 150, 150] : [153, 148, 142]);

    this.drawCenteredPhrase(doc, 'תוכן העניינים', mediaW / 2, mTop + 24, mediaH, 20, true, g('#121214'));
    const ruleRgb = blackOnly ? this.toGrayRgb(184, 174, 160) : [184, 174, 160];
    doc.setDrawColor(ruleRgb[0], ruleRgb[1], ruleRgb[2]);
    doc.setLineWidth(0.75);
    doc.line(mLeft, mTop + 34, mRight, mTop + 34);

    let y = mTop + 62;
    const lineH = 20;
    for (const entry of entries) {
      const fontSize = entry.level <= 1 ? 13 : 11.5;
      const isBold = entry.level <= 1;
      const indent = (entry.level - 1) * 18;
      const titleRight = mRight - indent;
      const pageNum = entry.folioLabel || (entry.pageNumber !== undefined ? String(entry.pageNumber) : '');
      this.drawRightPhrase(doc, entry.title, titleRight, y, mediaH, fontSize, isBold, g('#121214'));
      if (pageNum) {
        // Dotted leader between the title and the page number.
        const numW = pageNum.length * fontSize * 0.55 + 6;
        const leaderRight = mLeft + numW + 8;
        const leaderLeft = titleRight - 220 > leaderRight ? titleRight - 220 : leaderRight;
        const dotRgb = blackOnly ? this.toGrayRgb(184, 174, 160) : [184, 174, 160];
        doc.setDrawColor(dotRgb[0], dotRgb[1], dotRgb[2]);
        doc.setLineWidth(0.5);
        try {
          (doc as any).setLineDashPattern([1, 4], 0);
        } catch {
          // jsPDF builds without dash support still draw a plain leader.
        }
        doc.line(leaderLeft, y - fontSize * 0.3, leaderRight, y - fontSize * 0.3);
        try {
          (doc as any).setLineDashPattern([], 0);
        } catch {
          // ignore
        }
        this.drawRightPhrase(doc, pageNum, mLeft + numW, y, mediaH, fontSize, true, g('#2C2A29'));
      }
      y += lineH;
    }
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
      tertiaryLines,
      michtavBox,
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
    const mLeft = textBlockLeft(geometry);
    const mRight = textBlockRight(geometry);
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
    const tertiaryFont =
      designSettings?.roleStyles?.tertiary_comment?.character?.fontFamily ||
      sourceFont;

    const planLines: PdfLineDrawCommand[] = [];

    const buildLineCommand = (
      line: TypesetLine,
      physXRightIn: number,
      physYBaseline: number,
      fontFamily: string,
      fontSizePt: number,
      baseFontWeight: number,
      isCenteredHeading: boolean = false
    ): PdfLineDrawCommand => {
      // A line that carries its own box is drawn in it (column engines set
      // xLeft / xRight; a branch's default anchor must never override it —
      // two-column pages drew both columns on top of each other).
      const physXRight =
        line.xLeft !== undefined && line.xRight !== undefined ? mLeft + line.xRight : physXRightIn;
      const effectiveFontFamily = line.fontFamily || fontFamily;
      const effectiveFontSizePt = line.fontSizePt ?? fontSizePt;
      const effectiveFontWeight = line.fontWeight ?? baseFontWeight;
      const effectiveAlignment: 'justify' | 'right' | 'center' | 'left' =
        line.paragraphAlignment ??
        line.alignment ??
        (isCenteredHeading ? 'center' : line.isJustified && !line.isLastLine ? 'justify' : 'right');
      const effectiveCentered = effectiveAlignment === 'center';
      const effectiveLeft = effectiveAlignment === 'left';

      // T11 — embedded Latin runs placed left to right (UAX #9, word level).
      const realWords = inRtlPlacementOrder(line.words.filter(w => !w.isSpace && w.text.trim().length > 0));
      const firstIndentPt = line.firstLineIndentPt ?? line.firstLineIndent ?? 0;
      const hangingIndentPt = line.hangingIndentPt ?? 0;
      const rightIndentPt = line.rightIndentPt ?? 0;
      const leftIndentPt = line.leftIndentPt ?? 0;
      const rightIndentOffset = rightIndentPt + firstIndentPt + hangingIndentPt;

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

      const isCommentSepRole =
        line.role === 'primary_comment' ||
        line.role === 'secondary_comment' ||
        line.role === 'tertiary_comment' ||
        line.role === 'dibbur_hamatchil';
      const sepCfg = isCommentSepRole
        ? designSettings?.ravText?.commentarySeparator
        : designSettings?.ravText?.paragraphSeparator;

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
        unitBoundaryAfter: line.unitBoundaryAfter,
        transitionMarkerBefore: line.transitionMarkerBefore,
        transitionMarkerVerified: line.transitionMarkerVerified,
        // v0.9.9 (I2): marker presentation comes from the settings so
        // canvas + native PDF render the same marker.
        transitionMarkerStyle: designSettings?.ravText?.transitionMarker?.style ?? 'text',
        transitionMarkerSizePt: designSettings?.ravText?.transitionMarker?.sizePt,
        transitionMarkerPosition: designSettings?.ravText?.transitionMarker?.position ?? 'before_first_word',
        separatorStyleId: line.unitBoundaryAfter
          ? (line.separatorStyleIdOverride ?? sepCfg?.styleId ?? 'none')
          : undefined,
        separatorWidthRatio: line.unitBoundaryAfter ? (sepCfg?.widthRatio ?? 0.45) : undefined,
        separatorThicknessPt: line.unitBoundaryAfter ? (sepCfg?.thicknessPt ?? 0.65) : undefined,
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

    // 4.4 Layout training T2.4 — Vilna marginal apparatus columns. The
    // lines carry content coordinates of the full page.
    for (const line of page.marginLines ?? []) {
      planLines.push(
        buildLineCommand(
          line,
          mLeft + (line.xRight ?? contentW),
          mTop + line.yBaseline,
          line.fontFamily || tertiaryFont,
          line.fontSizePt ?? 8,
          line.fontWeight ?? 400,
          line.alignment === 'center'
        )
      );
    }

    // 4.5 Tertiary band (v0.8.0 Part C §1): Ein Mishpat / Ner Mitzvah /
    // Torah Or / Masoret HaShas + cross-references / side notes, full
    // width below the body. The lines carry their solved coordinates.
    if (tertiaryLines && tertiaryLines.length > 0) {
      for (const line of tertiaryLines) {
        planLines.push(
          buildLineCommand(
            line,
            mRight,
            mTop + line.yBaseline,
            tertiaryFont,
            line.fontSizePt ?? 9,
            400,
            false
          )
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

    // v0.8.0 Part C (§7): the Michtav box in physical pt coordinates.
    const planMichtavBox = michtavBox
      ? {
          xLeft: Number((mLeft + (michtavBox.xPct / 100) * contentW).toFixed(2)),
          xRight: Number(
            (mLeft + ((michtavBox.xPct + michtavBox.widthPct) / 100) * contentW).toFixed(2)
          ),
          yTop: Number(
            (mTop + (michtavBox.yPct / 100) * (mBottom - mTop)).toFixed(2)
          ),
          yBottom: Number(
            (mTop + ((michtavBox.yPct + michtavBox.heightPct) / 100) * (mBottom - mTop)).toFixed(2)
          ),
          text: michtavBox.text ?? '',
        }
      : undefined;

    // v0.5.0 Part B (Module 6): the top header line is hidden by default.
    // `showTopHeaderLine` gates the running title + header rule; legacy
    // settings without the flag fall back to the old `showRunningHeader`,
    // exactly like the PageCanvas preview. The folio keeps its own flag
    // (a top-positioned folio still prints when enabled — pre-existing
    // folio logic, unchanged).
    const showRunningHeader =
      designSettings?.pageElements?.showTopHeaderLine ??
      designSettings?.pageElements?.showRunningHeader ??
      designSettings?.pageLayout?.showRunningHeader ??
      false;
    const showRunningFooter =
      designSettings?.pageLayout?.showRunningFooter ?? true;
    const showFolioNumber =
      designSettings?.pageElements?.showFolioNumber ??
      (designSettings?.pageLayout?.pageNumberPosition !== 'hidden');
    // v0.5.0 (integrator — user request): folio format (numbers vs Hebrew
    // letters, "דף" prefix or bare). Defaults match the folio the app
    // rendered before: Hebrew letters with "דף".
    const pageNumberStyle = designSettings?.pageElements?.pageNumberStyle ?? 'hebrew';
    const showDafPrefix = designSettings?.pageElements?.showDafPrefix ?? true;
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

    // v0.5.0 (Title Page / Shaar Blat builder): the synthetic first page
    // carries its fields + border in the plan (its `lines` stay empty).
    // This is the handoff the Chromium endpoint consumes too — it renders
    // the title page from `titlePage`, not from lines.
    // The back of the title page is a plain verso, not a second cover.
    const isTitlePage = !!page.isTitlePage && !page.isBackOfTitle;
    const tp = designSettings?.titlePage;
    // v0.9.9 — template carry-through: the plan carries the template
    // id / metadata / ornaments / background / metadata rows (laid out
    // against the standard rows) and the REAL frame — the template's own
    // border id, not the stored PDF-fallback. No template = the old
    // values, byte for byte.
    const tpTemplate = isTitlePage && tp?.enabled ? resolveTitlePageTemplate(tp) : null;
    const tpStandardRows = isTitlePage && tp?.enabled
      ? layoutTitlePageFields(tp, headerTitle || 'ספר קודש', geometry.pageHeight)
      : [];
    const titlePage: TitlePagePlanData | undefined =
      isTitlePage && tp?.enabled
        ? {
            rows: tpStandardRows.map(r => ({
              text: r.text,
              fontFamily: r.fontFamily,
              fontSizePt: r.fontSizePt,
              isBold: r.isBold,
              alignment: r.alignment,
              yBaselinePt: r.yBaselinePt,
              colorHex: r.colorHex,
              xOffsetPt: r.xOffsetPt,
              lineHeight: r.lineHeight,
            })),
            borderStyleId: effectiveTitlePageBorderStyleId(tp),
            borderThicknessPt: tp.border.thicknessPt,
            borderInsetMm: tp.border.insetMm,
            borderEnabled: tp.border.enabled,
            customBorderImageDataUrl: tp.customBorderImage?.dataUrl,
            borderScalePct: tp.border.scalePct,
            borderPaddingMm: tp.border.paddingMm,
            borderOffsetXMm: tp.border.offsetXMm,
            borderOffsetYMm: tp.border.offsetYMm,
            templateId: resolveTitlePageTemplateId(tp) ?? undefined,
            templateMetadata: (() => {
              const { metadata } = readTitlePageTemplateState(tp);
              return Object.keys(metadata).length > 0 ? metadata : undefined;
            })(),
            ornaments: tpTemplate ? resolveTemplateOrnaments(tp, tpTemplate) : undefined,
            background: effectiveTitlePageBackground(tp),
            metadataRows: tpTemplate
              ? layoutTemplateMetadataRows(
                  tp,
                  tpTemplate,
                  tpStandardRows.map(r => ({
                    fieldId: r.fieldId,
                    yBaselinePt: r.yBaselinePt,
                    fontSizePt: r.fontSizePt,
                    lineHeight: r.lineHeight,
                  })),
                  geometry.pageHeight
                )
              : undefined,
            titleRowYBaselinePt: tpStandardRows.find(r => r.fieldId === 'title')?.yBaselinePt,
            publisherRowYBaselinePt: tpStandardRows.find(r => r.fieldId === 'publisher')?.yBaselinePt,
          }
        : undefined;

    // v0.6.0 Part A (§5): editable running-header slots, resolved with the
    // same pure resolver the preview uses (global text + this page's
    // override + automatic fallbacks), so preview and PDF agree. The
    // folio only sits in the header band for a TOP folio position; a
    // bottom folio lives in the footer instead.
    const folioLabel =
      page.folioDisplay ||
      (pageNumberStyle === 'numbers'
        ? String(pageNumber)
        : this.toHebrewGematria(pageNumber));
    const hasTalmudFormat = /[.:]|ע״[אב]/.test(folioLabel);
    const folioLabelWithPrefix =
      showDafPrefix && !hasTalmudFormat && !/^דף\s/.test(folioLabel)
        ? `דף ${folioLabel}`
        : folioLabel;
    const editionLabel =
      layoutType === 'rav_text'
        ? 'צורת הדף · מהדורת כתר'
        : layoutType === 'mikraot_gedolot'
          ? 'מקראות גדולות · כתר'
          : layoutType === 'two_column'
            ? 'שני טורים · מהדורת כתר'
            : layoutType === 'source_top_commentary_bottom'
              ? 'מקור ומפרשים · כתר'
              : 'מהדורת כתר';
    const folioInHeader =
      showFolioNumber &&
      folioNumberPosition !== 'bottom_center' &&
      folioNumberPosition !== 'bottom_outside' &&
      folioNumberPosition !== 'hidden';
    const headerIdx = typeof page.pageIndex === 'number' ? page.pageIndex : pageNumber - 1;
    const spreadSideIdx = page.bodyPageIndex ?? headerIdx;
    const resolvedHeader = resolveRunningHeader(
      designSettings?.pageElements,
      {
        bookTitle: page.structuredHeaders?.centerText || headerTitle || 'ספר קודש',
        folioLabel: folioLabelWithPrefix,
        editionLabel: page.structuredHeaders?.leftText || editionLabel,
      },
      headerIdx,
      folioInHeader,
      spreadSideIdx % 2 === 0 ? 'left' : 'right'
    );
    const showHeaderDividerRule =
      designSettings?.pageElements?.showHeaderDividerRule ?? true;

    const planOpeningWordBox = page.openingWordBox
      ? {
          ...page.openingWordBox,
          xLeft: Number((mLeft + page.openingWordBox.xLeft).toFixed(2)),
          xRight: Number((mLeft + page.openingWordBox.xRight).toFixed(2)),
          yTop: Number((mTop + page.openingWordBox.yTop).toFixed(2)),
          yBottom: Number((mTop + page.openingWordBox.yBottom).toFixed(2)),
        }
      : undefined;

    const planPeripheralStreams = (page.peripheralStreams ?? []).map(ps => ({
      stream: ps.stream,
      label: ps.labelHe,
      lines: ps.lines.map(l =>
        buildLineCommand(
          l,
          l.xRight !== undefined ? mLeft + l.xRight : mRight,
          mTop + l.yBaseline,
          tertiaryFont,
          l.fontSizePt ?? 8.5,
          400,
          false
        )
      ),
    }));

    // Layout training T2.1 — the Vilna head replaces the generic header
    // band, the generic folio and the continuation notes entirely, so no
    // renderer can draw any of them twice.
    const vh = page.vilnaHeader && page.vilnaHeader.items.length > 0 ? page.vilnaHeader : undefined;
    return {
      pageNumber,
      folioDisplay: folioLabel,
      pageNumberHebrew: folioLabel,
      headerTitle: headerTitle || 'ספר קודש',
      continuationHeader: vh ? undefined : continuationHeader,
      continuationFooter: vh ? undefined : continuationFooter,
      showRunningHeader: vh || page.isBackOfTitle ? false : showRunningHeader,
      showRunningFooter: page.isBackOfTitle ? false : showRunningFooter,
      showFolioNumber: vh || page.isBackOfTitle ? false : showFolioNumber,
      vilnaHeader: vh,
      pageNumberStyle,
      showDafPrefix,
      showDecorativeFrame,
      folioNumberPosition,
      runningHeaderFontSizePt,
      headerLeftText: resolvedHeader.left.visible ? resolvedHeader.left.text : '',
      headerCenterText: resolvedHeader.center.visible ? resolvedHeader.center.text : '',
      headerRightText: resolvedHeader.right.visible ? resolvedHeader.right.text : '',
      headerShowLeft: !vh && !page.isBackOfTitle && showRunningHeader && resolvedHeader.left.visible,
      headerShowCenter: !vh && !page.isBackOfTitle && showRunningHeader && resolvedHeader.center.visible,
      headerShowRight: !vh && !page.isBackOfTitle && showRunningHeader && resolvedHeader.right.visible,
      headerShowPageNumber: !vh && !page.isBackOfTitle && showRunningHeader && resolvedHeader.right.visible,
      headerAlignment: resolvedHeader.alignment,
      headerFontFamily: resolvedHeader.fontFamily,
      headerFontSizePt: resolvedHeader.fontSizePt,
      headerDividerRule: showHeaderDividerRule,
      showFootnoteSeparatorLine,
      footnoteSeparatorWidthRatio,
      footnoteSeparatorSpacingAbovePt,
      footnoteSeparatorSpacingBelowPt,
      footnoteSeparatorWeightPt: 0.85,
      lines: planLines,
      ornaments: planOrnaments,
      openingWordBox: planOpeningWordBox,
      openingDecorationThicknessPt:
        designSettings?.ravText?.openingDecoration?.thicknessPt ?? 1.1,
      transitionMarkers: page.transitionMarkers,
      peripheralStreams: planPeripheralStreams,
      michtavBox: planMichtavBox,
      isTitlePage,
      titlePage,
      isImageOnlyPage: page.isImageOnlyPage,
      pageImages: page.pageImages,
    };
  }

  /**
   * v0.9.9 (I2) — Vilna opening frames added by the preset
   * ('patterned_rect', 'stepped_frame', 'corner_ornament'). These are
   * drawn locally in the exporter (same original vector geometry as
   * the PageCanvas SVG branches) so canvas + native PDF agree; the
   * pre-existing styles keep delegating to OrnamentLibraryEngine.
   * The canvas helper draws frame + text (the ornament library's
   * canvas contract); the PDF helper draws the frame only (the native
   * caller draws the box text itself, as with the delegated path).
   */
  private static isVilnaOpeningBoxStyle(styleId: string): boolean {
    return styleId === 'patterned_rect' || styleId === 'stepped_frame' || styleId === 'corner_ornament';
  }

  private static drawVilnaOpeningBoxOnCanvas(
    ctx: CanvasRenderingContext2D,
    box: OpeningWordBoxGeom,
    thicknessPt: number
  ): void {
    const x = box.xLeft;
    const y = box.yTop;
    const w = Math.max(24, box.xRight - box.xLeft);
    const h = Math.max(18, box.yBottom - box.yTop);
    const midX = x + w / 2;
    ctx.save();
    ctx.strokeStyle = '#1E1B18';
    ctx.fillStyle = '#FCFAF5';
    ctx.lineWidth = Math.max(0.4, thicknessPt);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 0.6;
    if (box.styleId === 'stepped_frame') {
      const s = 5;
      const ix = x + 3.5;
      const iy = y + 3.5;
      const iw = Math.max(4, w - 7);
      const ih = Math.max(4, h - 7);
      ctx.beginPath();
      ctx.moveTo(ix + s, iy);
      ctx.lineTo(ix + iw - s, iy);
      ctx.lineTo(ix + iw - s, iy + s);
      ctx.lineTo(ix + iw, iy + s);
      ctx.lineTo(ix + iw, iy + ih - s);
      ctx.lineTo(ix + iw - s, iy + ih - s);
      ctx.lineTo(ix + iw - s, iy + ih);
      ctx.lineTo(ix + s, iy + ih);
      ctx.lineTo(ix + s, iy + ih - s);
      ctx.lineTo(ix, iy + ih - s);
      ctx.lineTo(ix, iy + s);
      ctx.lineTo(ix + s, iy + s);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
      if (box.styleId === 'patterned_rect') {
        for (let tx = x + 3.5 + 9; tx < x + w - 3.5 - 2; tx += 9) {
          ctx.beginPath();
          ctx.moveTo(tx, y + 3.5);
          ctx.lineTo(tx, y + 6.5);
          ctx.moveTo(tx, y + h - 3.5);
          ctx.lineTo(tx, y + h - 6.5);
          ctx.stroke();
        }
      } else if (box.styleId === 'corner_ornament') {
        ctx.lineWidth = 0.7;
        const c = (cx: number, cy: number, sx: number, sy: number) => {
          ctx.beginPath();
          ctx.moveTo(cx, cy + 7.5 * sy);
          ctx.quadraticCurveTo(cx, cy, cx + 7.5 * sx, cy);
          ctx.stroke();
        };
        c(x + 3.5, y + 3.5, 1, 1);
        c(x + w - 3.5, y + 3.5, -1, 1);
        c(x + w - 3.5, y + h - 3.5, -1, -1);
        c(x + 3.5, y + h - 3.5, 1, -1);
      }
    }
    if (box.text && box.text.trim()) {
      const fontPt = Math.max(10, Math.min(h * 0.52, (w * 0.72) / Math.max(2, box.text.length * 0.52)));
      ctx.fillStyle = '#121214';
      ctx.font = `700 ${fontPt}px "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(box.text, midX, y + h / 2);
    }
    ctx.restore();
  }

  private static drawVilnaOpeningBoxOnPdf(
    doc: any,
    box: OpeningWordBoxGeom,
    thicknessPt: number
  ): void {
    const x = box.xLeft;
    const y = box.yTop;
    const w = Math.max(24, box.xRight - box.xLeft);
    const h = Math.max(18, box.yBottom - box.yTop);
    doc.setFillColor(252, 250, 245);
    doc.setDrawColor(30, 27, 24);
    doc.setLineWidth(Math.max(0.4, thicknessPt));
    doc.rect(x, y, w, h, 'FD');
    doc.setLineWidth(0.6);
    if (box.styleId === 'stepped_frame') {
      const s = 5;
      const ix = x + 3.5;
      const iy = y + 3.5;
      const iw = Math.max(4, w - 7);
      const ih = Math.max(4, h - 7);
      doc.line(ix + s, iy, ix + iw - s, iy);
      doc.line(ix + iw - s, iy, ix + iw - s, iy + s);
      doc.line(ix + iw - s, iy + s, ix + iw, iy + s);
      doc.line(ix + iw, iy + s, ix + iw, iy + ih - s);
      doc.line(ix + iw, iy + ih - s, ix + iw - s, iy + ih - s);
      doc.line(ix + iw - s, iy + ih - s, ix + iw - s, iy + ih);
      doc.line(ix + iw - s, iy + ih, ix + s, iy + ih);
      doc.line(ix + s, iy + ih, ix + s, iy + ih - s);
      doc.line(ix + s, iy + ih - s, ix, iy + ih - s);
      doc.line(ix, iy + ih - s, ix, iy + s);
      doc.line(ix, iy + s, ix + s, iy + s);
      doc.line(ix + s, iy + s, ix + s, iy);
    } else {
      doc.rect(x + 3.5, y + 3.5, w - 7, h - 7, 'S');
      if (box.styleId === 'patterned_rect') {
        for (let tx = x + 3.5 + 9; tx < x + w - 3.5 - 2; tx += 9) {
          doc.line(tx, y + 3.5, tx, y + 6.5);
          doc.line(tx, y + h - 3.5, tx, y + h - 6.5);
        }
      } else if (box.styleId === 'corner_ornament') {
        doc.setLineWidth(0.7);
        // Quarter-circle corner scrolls, approximated with short
        // straight segments (jsPDF has no quadratic path primitive
        // in this call path).
        const arc = (cx: number, cy: number, sx: number, sy: number) => {
          const r = 7.5;
          let px = cx;
          let py = cy + r * sy;
          for (let a = 0; a <= 4; a += 1) {
            const t = (a / 4) * (Math.PI / 2);
            const nx = cx + Math.sin(t) * r * sx;
            const ny = cy + Math.cos(t) * r * sy;
            doc.line(px, py, nx, ny);
            px = nx;
            py = ny;
          }
        };
        arc(x + 3.5, y + 3.5, 1, 1);
        arc(x + w - 3.5, y + 3.5, -1, 1);
        arc(x + w - 3.5, y + h - 3.5, -1, -1);
        arc(x + 3.5, y + h - 3.5, 1, -1);
      }
    }
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

      const requestedScale =
        wCmd.horizontalScalePercent && wCmd.horizontalScalePercent !== 100
          ? wCmd.horizontalScalePercent / 100
          : 1.0;
      // The layout engine's solved word box is authoritative. Canvas and embedded PDF
      // fonts can have different advances, so fit the shaped word to its exact box while
      // scaling around the RTL right edge. Canvas shaping keeps Hebrew marks attached.
      const measuredWidth = Math.max(0.1, ctx.measureText(RLM + wCmd.text + RLM).width);
      const solvedWidth = Math.max(0.1, wCmd.width);
      const fitScale = solvedWidth / measuredWidth;
      const scaleX = requestedScale * fitScale;

      ctx.translate(wCmd.xRight, wCmd.yBaseline);
      ctx.scale(scaleX, 1.0);
      ctx.fillText(RLM + wCmd.text + RLM, 0, 0);
      // Return to page coordinates before drawing the underline.
      ctx.restore();
      ctx.save();

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

    if (lineCmd.transitionMarkerBefore && lineCmd.words.length > 0) {
      // v0.9.9 (I2): marker size / position / boxed style from the
      // Vilna preset settings — same rendering as the native PDF path
      // below and the PageCanvas span.
      const mSize = lineCmd.transitionMarkerSizePt ?? Math.max(8, lineCmd.fontSizePt * 0.92);
      const afterLast = lineCmd.transitionMarkerPosition === 'after_last_word';
      const firstWord = lineCmd.words[0];
      const lastWord = lineCmd.words[lineCmd.words.length - 1];
      ctx.save();
      ctx.direction = 'rtl';
      ctx.textAlign = 'left';
      ctx.font = `700 ${this.ptInCanvasSpace(mSize)}px "${lineCmd.fontFamily}", "Frank Ruhl Libre", serif`;
      const mW = Math.max(mSize * 0.8, ctx.measureText(lineCmd.transitionMarkerBefore).width);
      const mX = afterLast ? lastWord.xLeft - mW - 2.5 : firstWord.xRight + 2.5;
      if (lineCmd.transitionMarkerStyle === 'boxed') {
        ctx.strokeStyle = '#1E1B18';
        ctx.lineWidth = 0.7;
        ctx.fillStyle = '#FCFAF5';
        ctx.fillRect(mX - 2, lineCmd.yBaseline - mSize - 1, mW + 4, mSize + 4);
        ctx.strokeRect(mX - 2, lineCmd.yBaseline - mSize - 1, mW + 4, mSize + 4);
      }
      ctx.fillStyle = lineCmd.transitionMarkerVerified === false ? '#92400E' : '#121214';
      ctx.fillText(lineCmd.transitionMarkerBefore, mX, lineCmd.yBaseline);
      ctx.restore();
    }

    if (lineCmd.unitBoundaryAfter && lineCmd.separatorStyleId && lineCmd.separatorStyleId !== 'none') {
      OrnamentLibraryEngine.drawSeparatorRuleOnCanvas(
        ctx,
        lineCmd.separatorStyleId,
        lineCmd.xLeft,
        lineCmd.xRight,
        lineCmd.yBottom + 2.5,
        lineCmd.separatorWidthRatio,
        lineCmd.separatorThicknessPt
      );
    }
  }

  /**
   * v0.6.0 Part A (§5) — lays out the running-header slots for one draw
   * call. 'center' spreads the slots across their cells (right / centre /
   * left — today's look); 'left' / 'right' packs the visible slots to
   * that visual side in RTL reading order (right slot first when packing
   * right, left slot first when packing left), with a 12pt gap. The
   * caller supplies `measure` because the canvas path measures for real
   * while the jsPDF path estimates from word lengths. Returned anchors
   * suit both `ctx.fillText` (textAlign) and `drawHeaderOrFolioPhrase`
   * (alignMode + anchorX): 'right' anchors the slot's right edge,
   * 'center' its middle, 'left' its left edge.
   */
  private static layoutHeaderSlots(
    slots: Array<{
      text: string;
      fontSizePt: number;
      fontWeight: number;
      colorHex: string;
      cell: 'left' | 'center' | 'right';
    }>,
    alignment: RunningHeaderAlignment,
    mLeft: number,
    mRight: number,
    centerX: number,
    measure: (text: string, fontSizePt: number, fontWeight: number) => number
  ): Array<{
    text: string;
    fontSizePt: number;
    fontWeight: number;
    colorHex: string;
    cell: 'left' | 'center' | 'right';
    anchorX: number;
    alignMode: 'left' | 'center' | 'right';
  }> {
    const gap = 12;
    if (slots.length <= 1) {
      // One slot honours the alignment exactly, whatever its cell is.
      const s = slots[0];
      if (!s) return [];
      return [
        {
          ...s,
          anchorX:
            alignment === 'center' ? centerX : alignment === 'left' ? mLeft : mRight,
          alignMode: alignment,
        },
      ];
    }
    if (alignment === 'center') {
      return slots.map(s =>
        s.cell === 'right'
          ? { ...s, anchorX: mRight, alignMode: 'right' as const }
          : s.cell === 'center'
            ? { ...s, anchorX: centerX, alignMode: 'center' as const }
            : { ...s, anchorX: mLeft, alignMode: 'left' as const }
      );
    }
    const ordered =
      alignment === 'right'
        ? [...slots].sort(
            (a, b) =>
              ['right', 'center', 'left'].indexOf(a.cell) - ['right', 'center', 'left'].indexOf(b.cell)
          )
        : [...slots].sort(
            (a, b) =>
              ['left', 'center', 'right'].indexOf(a.cell) - ['left', 'center', 'right'].indexOf(b.cell)
          );
    const out: Array<{
      text: string;
      fontSizePt: number;
      fontWeight: number;
      colorHex: string;
      cell: 'left' | 'center' | 'right';
      anchorX: number;
      alignMode: 'left' | 'center' | 'right';
    }> = [];
    if (alignment === 'right') {
      let cursor = mRight;
      for (const s of ordered) {
        out.push({ ...s, anchorX: cursor, alignMode: 'right' });
        cursor -= measure(s.text, s.fontSizePt, s.fontWeight) + gap;
      }
    } else {
      let cursor = mLeft;
      for (const s of ordered) {
        out.push({ ...s, anchorX: cursor, alignMode: 'left' });
        cursor += measure(s.text, s.fontSizePt, s.fontWeight) + gap;
      }
    }
    return out;
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
    const mLeft = textBlockLeft(geometry);
    const mRight = textBlockRight(geometry);
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

    // v0.5.0 (Title Page / Shaar Blat builder): the title page draws its
    // border + fields here (no header, no folio, no body lines) and
    // returns early. The context is already scaled to pt, so the border
    // is drawn in pt units with scale 1 (see drawBorderCommandsOnCanvas).
    // v0.6.0 Part C (§8): the custom frame image is AWAITED by
    // `renderPageToCanvasAsync` before this runs, so it draws even when
    // the preview never warmed the cache; the sync renderer below still
    // skips it when it is not loaded (e.g. a direct sync call).
    if (renderPlan.isTitlePage && renderPlan.titlePage) {
      const tp = renderPlan.titlePage;
      // v0.9.9 — template background in the canvas fallback (same
      // fills as the native PDF: plain #FCFAF5, warm #F5EDDC).
      if (tp.background === 'warm') {
        ctx.fillStyle = '#F5EDDC';
        ctx.fillRect(0, 0, geometry.pageWidth, geometry.pageHeight);
      }
      if (tp.customBorderImageDataUrl) {
        const img = getLoadedBorderImage(tp.customBorderImageDataUrl);
        if (img) {
          const rect = titlePageBorderImageRect(
            {
              enabled: tp.borderEnabled,
              styleId: tp.borderStyleId,
              thicknessPt: tp.borderThicknessPt,
              insetMm: tp.borderInsetMm,
              scalePct: tp.borderScalePct,
              paddingMm: tp.borderPaddingMm,
              offsetXMm: tp.borderOffsetXMm,
              offsetYMm: tp.borderOffsetYMm,
            },
            geometry.pageWidth,
            geometry.pageHeight
          );
          ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
        }
      } else if (tp.borderEnabled && tp.borderStyleId !== 'none') {
        const commands = buildTitlePageBorderCommands(
          tp.borderStyleId,
          tp.borderInsetMm,
          tp.borderThicknessPt,
          geometry.pageWidth,
          geometry.pageHeight,
          {
            scalePct: tp.borderScalePct,
            paddingMm: tp.borderPaddingMm,
            offsetXMm: tp.borderOffsetXMm,
            offsetYMm: tp.borderOffsetYMm,
          }
        );
        drawBorderCommandsOnCanvas(ctx, commands, geometry.pageWidth, geometry.pageHeight, '#2A2622', tp.borderThicknessPt, 1);
      }
      ctx.direction = 'ltr';
      for (const row of tp.rows) {
        const family = row.fontFamily || 'Frank Ruhl Libre';
        ctx.font = `${row.isBold ? 700 : 400} ${this.ptInCanvasSpace(row.fontSizePt)}px "${family}", "Frank Ruhl Libre", serif`;
        ctx.fillStyle = row.colorHex;
        ctx.textAlign = row.alignment;
        const x =
          row.alignment === 'center'
            ? geometry.pageWidth / 2 + (row.xOffsetPt ?? 0)
            : row.alignment === 'right'
              ? mRight + (row.xOffsetPt ?? 0)
              : mLeft + (row.xOffsetPt ?? 0);
        ctx.fillText(row.text, x, row.yBaselinePt);
      }
      // v0.9.9 — template metadata rows in the canvas fallback. The
      // canvas CAN honour italic (unlike the native PDF) and
      // letter-spacing where the browser supports it.
      for (const mRow of tp.metadataRows ?? []) {
        if (!mRow.text.trim()) continue;
        const displayText = mRow.uppercase || mRow.smallCaps ? mRow.text.toUpperCase() : mRow.text;
        const size = mRow.smallCaps ? mRow.fontSizePt * 0.85 : mRow.fontSizePt;
        const family = mRow.fontFamily || 'Frank Ruhl Libre';
        ctx.font = `${mRow.italic ? 'italic' : 'normal'} ${mRow.isBold ? 700 : 400} ${this.ptInCanvasSpace(size)}px "${family}", "Frank Ruhl Libre", serif`;
        try {
          (ctx as unknown as { letterSpacing: string }).letterSpacing =
            mRow.letterSpacingPt ? `${this.ptInCanvasSpace(mRow.letterSpacingPt)}px` : '0px';
        } catch {
          // letterSpacing unsupported — the row still draws.
        }
        ctx.fillStyle = mRow.colorHex;
        ctx.textAlign = mRow.alignment;
        const x =
          mRow.alignment === 'center'
            ? geometry.pageWidth / 2
            : mRow.alignment === 'right'
              ? mRight
              : mLeft;
        ctx.fillText(displayText, x, mRow.yBaselinePt);
        if (mRow.ruleBelow) {
          ctx.strokeStyle = mRow.colorHex;
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.moveTo(geometry.pageWidth / 2 - 20, mRow.yBaselinePt + 8);
          ctx.lineTo(geometry.pageWidth / 2 + 20, mRow.yBaselinePt + 8);
          ctx.stroke();
        }
      }
      try {
        (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
      } catch {
        // ignore
      }
      // v0.9.9 — template ornaments in the canvas fallback, at the
      // same positions as the native PDF (anchors from the plan).
      for (const orn of tp.ornaments ?? []) {
        const vb = OrnamentLibraryEngine.TITLE_PAGE_ORNAMENT_VIEWBOX[orn.ornamentId];
        if (!vb) continue;
        const w = orn.widthPt;
        const h = (w * vb.h) / vb.w;
        const x = geometry.pageWidth / 2 - w / 2;
        let y: number;
        if (orn.position === 'topCenter') {
          y = 10;
        } else if (orn.position === 'belowTitle') {
          y = (tp.titleRowYBaselinePt ?? geometry.pageHeight * 0.42) + 10;
        } else if (orn.position === 'abovePublisher') {
          y = (tp.publisherRowYBaselinePt ?? geometry.pageHeight * 0.88) - h - 10;
        } else {
          y = geometry.pageHeight * 0.82 - h / 2;
        }
        OrnamentLibraryEngine.drawTitlePageOrnamentOnCanvas(ctx, orn.ornamentId, x, y, w, h, '#2A2622');
      }
      return canvas;
    }

    // 3. Running Header, Hebrew Folio & Continuation Header (respecting pageElements settings)
    const folioNumberText =
      renderPlan.folioDisplay ||
      (renderPlan.pageNumberStyle === 'numbers' ? String(pageNumber) : this.toHebrewGematria(pageNumber));
    const hasTalmudFormat = /[.:]|ע״[אב]/.test(folioNumberText);
    const folioLabel =
      renderPlan.showDafPrefix && !hasTalmudFormat && !/^דף\s/.test(folioNumberText)
        ? `דף ${folioNumberText}`
        : folioNumberText;
    const hdrFontPt = renderPlan.runningHeaderFontSizePt || 10.5;
    ctx.direction = 'rtl';

    // v0.6.0 Part A (§5): three editable header slots (right = folio,
    // centre = book title, left = chapter/edition label). The continuation
    // header takes the left slot when present, so the two never overlap.
    // The band collapses entirely when no slot is visible; the rule draws
    // only with the band. Alignment packs the slots (see
    // layoutHeaderSlots); the folio draw below skips its top position when
    // the band already shows it.
    const headerSizePt = renderPlan.headerFontSizePt || hdrFontPt;
    const headerFontStack = `"${renderPlan.headerFontFamily || 'Frank Ruhl Libre'}", "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
    const headerSlots: Array<{
      text: string;
      fontSizePt: number;
      fontWeight: number;
      colorHex: string;
      cell: 'left' | 'center' | 'right';
    }> = [];
    if (renderPlan.headerShowRight) {
      headerSlots.push({
        text: renderPlan.headerRightText,
        fontSizePt: headerSizePt,
        fontWeight: 700,
        colorHex: '#2C2A29',
        cell: 'right',
      });
    }
    if (renderPlan.headerShowCenter) {
      headerSlots.push({
        text: renderPlan.headerCenterText,
        fontSizePt: headerSizePt,
        fontWeight: 600,
        colorHex: '#2C2A29',
        cell: 'center',
      });
    }
    if (continuationHeader) {
      headerSlots.push({
        text: continuationHeader,
        fontSizePt: Math.max(7.5, headerSizePt - 2),
        fontWeight: 500,
        colorHex: '#6B5E4C',
        cell: 'left',
      });
    } else if (renderPlan.headerShowLeft) {
      headerSlots.push({
        text: renderPlan.headerLeftText,
        fontSizePt: Math.max(7.5, headerSizePt * 0.85),
        fontWeight: 500,
        colorHex: '#6B5E4C',
        cell: 'left',
      });
    }
    const laidOutHeaderSlots = PdfExporter.layoutHeaderSlots(
      headerSlots,
      renderPlan.headerAlignment,
      mLeft,
      mRight,
      geometry.pageWidth / 2,
      (text, fontSizePt, fontWeight) => {
        ctx.font = `${fontWeight} ${this.ptInCanvasSpace(fontSizePt)}px ${headerFontStack}`;
        return ctx.measureText(text).width / this.ptInCanvasSpace(1);
      }
    );
    if (laidOutHeaderSlots.length > 0) {
      ctx.direction = 'rtl';
      for (const s of laidOutHeaderSlots) {
        ctx.font = `${s.fontWeight} ${this.ptInCanvasSpace(s.fontSizePt)}px ${headerFontStack}`;
        ctx.fillStyle = s.colorHex;
        ctx.textAlign = s.alignMode;
        ctx.fillText(s.text, s.anchorX, mTop - 18);
      }

      // Ornamental header divider rule (v0.9.8 Phase 5: its own toggle —
      // plan.headerDividerRule, default ON — the header text draws
      // whether or not the rule does).
      if (renderPlan.headerDividerRule) {
        ctx.strokeStyle = '#B8AEA0';
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(mLeft, mTop - 10);
        ctx.lineTo(mRight, mTop - 10);
        ctx.stroke();
      }
    }

    if (
      renderPlan.showFolioNumber &&
      renderPlan.folioNumberPosition !== 'hidden' &&
      // v0.6.0 Part A (§5): the folio is already in the header band —
      // drawing it again at the top would duplicate it.
      !renderPlan.headerShowPageNumber
    ) {
      ctx.font = `700 ${this.ptInCanvasSpace(hdrFontPt)}px "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
      ctx.fillStyle = '#2C2A29';
      if (renderPlan.folioNumberPosition === 'bottom_center') {
        ctx.textAlign = 'center';
        ctx.fillText(folioLabel, geometry.pageWidth / 2, mBottom + 16);
      } else if (renderPlan.folioNumberPosition === 'bottom_outside') {
        ctx.textAlign = 'right';
        ctx.fillText(folioLabel, mRight, mBottom + 16);
      } else if (renderPlan.folioNumberPosition === 'top_center' && !renderPlan.showRunningHeader) {
        ctx.textAlign = 'center';
        ctx.fillText(folioLabel, geometry.pageWidth / 2, mTop - 18);
      } else if (renderPlan.folioNumberPosition === 'top_inside') {
        // v0.3.0 (Module C) — 6th position: top, binding (inside) side.
        const inside = this.folioInsideAnchor(geometry.isVerso, mLeft, mRight);
        ctx.textAlign = inside.align;
        ctx.fillText(folioLabel, inside.x, mTop - 18);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(folioLabel, mRight, mTop - 18);
      }
    }

    // Layout training T2.1 — Vilna running head: every word was measured
    // and placed by the engine; draw it exactly there (right-aligned at
    // its xRight, RTL), never re-measured or re-packed.
    if (renderPlan.vilnaHeader) {
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#1E1C1A';
      for (const it of renderPlan.vilnaHeader.items) {
        ctx.font = `${it.fontWeight} ${this.ptInCanvasSpace(it.fontSizePt)}px "${it.fontFamily}", "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
        for (const w of it.words) ctx.fillText(w.text, w.xRight, it.yBaseline);
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

    // 5.8 Draw Opening Word Ornamental Frame behind body lines
    if (renderPlan.openingWordBox) {
      // v0.9.9 (I2): new Vilna frames render locally (same geometry as
      // the PageCanvas SVG); older styles delegate as before.
      if (PdfExporter.isVilnaOpeningBoxStyle(renderPlan.openingWordBox.styleId)) {
        PdfExporter.drawVilnaOpeningBoxOnCanvas(
          ctx,
          renderPlan.openingWordBox,
          renderPlan.openingDecorationThicknessPt ?? 1.1
        );
      } else {
        OrnamentLibraryEngine.drawOpeningWordBoxOnCanvas(ctx, renderPlan.openingWordBox, 0, 0);
      }
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

    // 6.2 Draw peripheral streams when active & non-empty
    if (renderPlan.peripheralStreams && renderPlan.peripheralStreams.length > 0) {
      for (const ps of renderPlan.peripheralStreams) {
        if (ps.lines[0]) {
          ctx.save();
          ctx.font = `700 ${this.ptInCanvasSpace(7.5)}px "Frank Ruhl Libre", serif`;
          ctx.fillStyle = '#6B5E4C';
          ctx.textAlign = 'center';
          ctx.fillText(ps.label, (ps.lines[0].xLeft + ps.lines[0].xRight) / 2, Math.max(12, ps.lines[0].yTop - 3));
          ctx.restore();
        }
        for (const pLine of ps.lines) {
          this.drawPlannedLine(ctx, pLine, '#3A3836');
        }
      }
    }

    // 6.5 Draw all solved ornaments from `renderPlan.ornaments` at exact solved coordinates (B-2)
    for (const ornCmd of renderPlan.ornaments) {
      OrnamentLibraryEngine.drawOrnamentOnCanvas(ctx, ornCmd.ornament, mTop);
    }

    // v0.8.0 Part C (§7): the Michtav box — bordered box with centred text.
    if (renderPlan.michtavBox) {
      const mb = renderPlan.michtavBox;
      ctx.strokeStyle = '#5C5346';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(mb.xLeft, mb.yTop, mb.xRight - mb.xLeft, mb.yBottom - mb.yTop);
      const mbFontSize = Math.max(10, (mb.yBottom - mb.yTop) * 0.4);
      ctx.font = `700 ${this.ptInCanvasSpace(mbFontSize)}px "Frank Ruhl Libre", "Noto Serif Hebrew", serif`;
      ctx.fillStyle = '#3B2F1E';
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mb.text, (mb.xLeft + mb.xRight) / 2, (mb.yTop + mb.yBottom) / 2);
      ctx.textBaseline = 'alphabetic';
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

  private static canvasFontsLoadPromise: Promise<void> | null = null;

  /**
   * Load the project's own fonts before any canvas is painted. Never silently fall back to
   * system fonts: that is exactly what makes a PDF change appearance on another computer.
   * These font files ship with the app under public/fonts and do not need to be installed
   * in Windows/macOS by the person exporting or opening the PDF.
   */
  private static async ensureCanvasFontsLoaded(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') {
      throw new Error('PDF export requires a browser font loader; bundled Hebrew fonts could not be verified.');
    }
    if (!this.canvasFontsLoadPromise) {
      this.canvasFontsLoadPromise = (async () => {
        for (const spec of KETER_EMBEDDED_FONTS) {
          const weight = spec.fontStyle === 'bold' ? '700' : '400';
          // Resolve RELATIVE to the app (strip the leading '/'): the
          // installed app loads dist/index.html from disk, where '/fonts/…'
          // meant the root of drive C: (file:///C:/fonts/…). The bytes are
          // read with the loader that can read file:// (XHR), and the face
          // is built from them — no URL fetch by the font loader at all.
          const fontUrl = new URL(spec.publicPath.replace(/^\//, ''), document.baseURI).href;
          try {
            const bytes = await PdfNativeTextEngine.loadPublicBinary(spec.publicPath);
            if (!bytes) throw new Error('font file not found');
            const face = new FontFace(spec.fontFamily, bytes, { weight });
            await face.load();
            document.fonts.add(face);
          } catch (error) {
            this.canvasFontsLoadPromise = null;
            throw new Error(
              `Cannot load the bundled PDF font "${spec.fontFamily}" (${spec.vfsFileName}) from ${fontUrl}. ` +
              'Check that the font file is included in the app deployment; do not install it on the user computer.',
              { cause: error }
            );
          }
        }
        await document.fonts.ready;
        for (const spec of KETER_EMBEDDED_FONTS) {
          const weight = spec.fontStyle === 'bold' ? '700' : '400';
          if (!document.fonts.check(`${weight} 12px "${spec.fontFamily}"`)) {
            this.canvasFontsLoadPromise = null;
            throw new Error(`Bundled PDF font failed verification: ${spec.fontFamily} (${weight}).`);
          }
        }
      })();
    }
    await this.canvasFontsLoadPromise;
  }

  /**
   * v0.6.0 Part C (§8): canvas render that AWAITS the title-page frame
   * image first, so a custom border image is in the PDF even when the
   * preview never loaded it. Everywhere else this is identical to the
   * sync `renderPageToCanvas` (which still skips an unloaded frame
   * rather than drawing a wrong border).
   */
  public static async renderPageToCanvasAsync(
    page: PageTypesetResult,
    scale: number = 3.0
  ): Promise<HTMLCanvasElement> {
    const tp = page.designSettings?.titlePage;
    const dataUrl =
      page.isTitlePage && tp?.enabled ? tp.customBorderImage?.dataUrl : undefined;
    if (dataUrl) await loadBorderImage(dataUrl);
    return this.renderPageToCanvas(page, scale);
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
  public static renderPageToPdfNative(
    doc: jsPDF,
    page: PageTypesetResult,
    renderOpts: { bleedPt?: number; colorMode?: 'color' | 'blackOnly' } = {}
  ): PdfPageRenderPlan {
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

    const bleedPt = renderOpts.bleedPt ?? 0;
    const blackOnly = renderOpts.colorMode === 'blackOnly';
    /** Map a hex colour to grayscale when black-only is active. */
    const g = (hex: string): string => (blackOnly ? this.toGrayHex(hex) : hex);
    /** Map an RGB triple to grayscale when black-only is active. */
    const grgb = (r: number, gg: number, b: number): [number, number, number] =>
      blackOnly ? this.toGrayRgb(r, gg, b) : [r, gg, b];

    // The plan is solved in trim-box coordinates; shift it by the bleed so
    // the trim box sits centred inside the expanded media box.
    const renderPlan = this.shiftRenderPlan(this.buildPageRenderPlan(page), bleedPt, bleedPt);
    const pageW = geometry.pageWidth;
    const pageH = geometry.pageHeight;
    const mediaW = pageW + 2 * bleedPt;
    const mediaH = pageH + 2 * bleedPt;

    // v0.5.0 (Title Page / Shaar Blat builder): a title page is drawn by
    // the dedicated cover renderer (fields + border from the project
    // settings), not as a body page — no header, no folio, no body lines.
    if (page.isTitlePage && !page.isBackOfTitle) {
      const tp = page.designSettings?.titlePage;
      const cover: CoverPageData = tp?.enabled
        ? titlePageSettingsToCoverData(tp, headerTitle || 'ספר קודש', geometry.pageHeight)
        : { title: headerTitle || 'ספר קודש' };
      this.renderCoverPageToPdf(doc, cover, geometry, { bleedPt, colorMode: renderOpts.colorMode });
      return renderPlan;
    }

    const mTop = geometry.marginTop + bleedPt;
    const mBottom = pageH + bleedPt - geometry.marginBottom;
    const mLeft = textBlockLeft(geometry) + bleedPt;
    const mRight = textBlockRight(geometry) + bleedPt;
    const contentW = mRight - mLeft;
    const contentH = mBottom - mTop;

    // 1. Holy-book parchment background (#FCFAF5); plain white for black-only press output.
    doc.setFillColor(...(blackOnly ? ([255, 255, 255] as [number, number, number]) : ([252, 250, 245] as [number, number, number])));
    doc.rect(0, 0, mediaW, mediaH, 'F');
    this.drawTrimCropMarks(doc, mediaW, mediaH, bleedPt, grgb(153, 148, 142));

    // 2. Corner Crop Marks & Registration (vector lines)
    const cropRgb = grgb(153, 148, 142);
    doc.setDrawColor(cropRgb[0], cropRgb[1], cropRgb[2]);
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
      const frameRgb = grgb(139, 125, 107);
      doc.setDrawColor(frameRgb[0], frameRgb[1], frameRgb[2]);
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
      colorHex: string,
      // v0.6.0 Part A (§5): the header font control; unknown families
      // fall back inside drawNativeWord, like the title-page fonts.
      fontFamily: string = 'Frank Ruhl Libre'
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
          pageHeight: mediaH,
          fontFamily,
          fontSizePt: fontSize,
          isBold,
          textColorHex: g(colorHex),
        });
        curRight -= wW + gapPt;
      }
    };

    // 3. Running Header, Hebrew Folio & Continuation Header
    const hebrewFolio = this.toHebrewGematria(pageNumber);
    const hdrFontPt = renderPlan.runningHeaderFontSizePt || 10.5;

    // v0.6.0 Part A (§5): three editable header slots (right = folio,
    // centre = book title, left = chapter/edition label), laid out with
    // the same helper as the canvas path. The continuation header takes
    // the left slot when present, so the two never overlap. The band
    // collapses entirely when no slot is visible; the rule draws only
    // with the band.
    const headerSizePt = renderPlan.headerFontSizePt || hdrFontPt;
    const headerFontFamily = renderPlan.headerFontFamily || 'Frank Ruhl Libre';
    const headerSlots: Array<{
      text: string;
      fontSizePt: number;
      fontWeight: number;
      colorHex: string;
      cell: 'left' | 'center' | 'right';
    }> = [];
    if (renderPlan.headerShowRight) {
      headerSlots.push({
        text: renderPlan.headerRightText,
        fontSizePt: headerSizePt,
        fontWeight: 700,
        colorHex: '#2C2A29',
        cell: 'right',
      });
    }
    if (renderPlan.headerShowCenter) {
      headerSlots.push({
        text: renderPlan.headerCenterText,
        fontSizePt: headerSizePt,
        fontWeight: 600,
        colorHex: '#2C2A29',
        cell: 'center',
      });
    }
    if (continuationHeader) {
      headerSlots.push({
        text: continuationHeader,
        fontSizePt: Math.max(7.5, headerSizePt - 2),
        fontWeight: 500,
        colorHex: '#6B5E4C',
        cell: 'left',
      });
    } else if (renderPlan.headerShowLeft) {
      headerSlots.push({
        text: renderPlan.headerLeftText,
        fontSizePt: Math.max(7.5, headerSizePt * 0.85),
        fontWeight: 500,
        colorHex: '#6B5E4C',
        cell: 'left',
      });
    }
    // Same word-width estimate as drawHeaderOrFolioPhrase below, so the
    // packing math and the drawing math agree.
    const estimatePhraseWidth = (phrase: string, fontSize: number): number => {
      const words = phrase.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return 0;
      const gapPt = fontSize * 0.28;
      return (
        words.reduce(
          (s, w) => s + Math.max(fontSize * 0.6, PdfNativeTextEngine.stripNikud(w).length * fontSize * 0.52),
          0
        ) + Math.max(0, words.length - 1) * gapPt
      );
    };
    const laidOutHeaderSlots = PdfExporter.layoutHeaderSlots(
      headerSlots,
      renderPlan.headerAlignment,
      mLeft,
      mRight,
      mediaW / 2,
      (text, fontSizePt) => estimatePhraseWidth(text, fontSizePt)
    );
    if (laidOutHeaderSlots.length > 0) {
      for (const s of laidOutHeaderSlots) {
        drawHeaderOrFolioPhrase(
          s.text,
          s.alignMode,
          s.anchorX,
          mTop - 18,
          s.fontSizePt,
          s.fontWeight >= 600,
          s.colorHex,
          headerFontFamily
        );
      }

      const hdrRuleRgb = grgb(184, 174, 160);
      doc.setDrawColor(hdrRuleRgb[0], hdrRuleRgb[1], hdrRuleRgb[2]);
      doc.setLineWidth(0.75);
      // v0.9.8 Phase 5 — the header divider rule is its own toggle
      // (plan.headerDividerRule, default ON); the header text draws
      // whether or not the rule does.
      if (renderPlan.headerDividerRule) {
        doc.line(mLeft, mTop - 10, mRight, mTop - 10);
      }
    }

    if (
      renderPlan.showFolioNumber &&
      renderPlan.folioNumberPosition !== 'hidden' &&
      // v0.6.0 Part A (§5): the folio is already in the header band —
      // drawing it again at the top would duplicate it.
      !renderPlan.headerShowPageNumber
    ) {

      const folioNumberText =
        renderPlan.folioDisplay ||
        (renderPlan.pageNumberStyle === 'numbers' ? String(pageNumber) : hebrewFolio);
      const hasTalmudFormat = /[.:]|ע״[אב]/.test(folioNumberText);
      const folioLabel =
        renderPlan.showDafPrefix && !hasTalmudFormat && !/^דף\s/.test(folioNumberText)
          ? `דף ${folioNumberText}`
          : folioNumberText;
      if (renderPlan.folioNumberPosition === 'bottom_center') {
        drawHeaderOrFolioPhrase(folioLabel, 'center', mediaW / 2, mBottom + 16, hdrFontPt, true, '#2C2A29');
      } else if (renderPlan.folioNumberPosition === 'bottom_outside') {
        drawHeaderOrFolioPhrase(folioLabel, 'right', mRight, mBottom + 16, hdrFontPt, true, '#2C2A29');
      } else if (renderPlan.folioNumberPosition === 'top_center' && !renderPlan.showRunningHeader) {
        drawHeaderOrFolioPhrase(folioLabel, 'center', mediaW / 2, mTop - 18, hdrFontPt, true, '#2C2A29');
      } else if (renderPlan.folioNumberPosition === 'top_inside') {
        // v0.3.0 (Module C) — 6th position: top, binding (inside) side.
        const inside = this.folioInsideAnchor(geometry.isVerso, mLeft, mRight);
        drawHeaderOrFolioPhrase(folioLabel, inside.align, inside.x, mTop - 18, hdrFontPt, true, '#2C2A29');
      } else {
        drawHeaderOrFolioPhrase(folioLabel, 'right', mRight, mTop - 18, hdrFontPt, true, '#2C2A29');
      }
    }

    // Layout training T2.1 — Vilna running head (engine-placed words).
    if (renderPlan.vilnaHeader) {
      for (const it of renderPlan.vilnaHeader.items) {
        for (const w of it.words) {
          PdfNativeTextEngine.drawNativeWord(doc, {
            text: w.text,
            xLeft: w.xLeft,
            xRight: w.xRight,
            yBaseline: it.yBaseline,
            pageHeight: mediaH,
            fontFamily: it.fontFamily,
            fontSizePt: it.fontSizePt,
            isBold: it.fontWeight >= 600,
            textColorHex: g('#1E1C1A'),
          });
        }
      }
    }

    // 4. Layout-Specific Decorative Vector Rules (Two-Column / Top-Bottom)
    if (layoutType === 'two_column' && column2Lines && column2Lines.length > 0) {
      const colGutter = page.designSettings?.columns?.columnGapPt ?? 16.0;
      const colW = (contentW - colGutter) / 2.0;
      const divX = mRight - colW - colGutter / 2;
      const divRgb = grgb(216, 207, 194);
      doc.setDrawColor(divRgb[0], divRgb[1], divRgb[2]);
      doc.setLineWidth(0.5);
      doc.line(divX, mTop, divX, mBottom - 10);
    } else if (layoutType === 'source_top_commentary_bottom') {
      const divY = mTop + (dividerY || contentH * 0.44);
      const srcDivRgb = grgb(139, 37, 0);
      doc.setDrawColor(srcDivRgb[0], srcDivRgb[1], srcDivRgb[2]);
      doc.setLineWidth(1.0);
      doc.line(mLeft + 30, divY, mRight - 30, divY);

      doc.setFillColor(srcDivRgb[0], srcDivRgb[1], srcDivRgb[2]);
      const midX = mediaW / 2;
      doc.triangle(midX, divY - 3, midX + 3, divY, midX, divY + 3, 'F');
      doc.triangle(midX, divY - 3, midX - 3, divY, midX, divY + 3, 'F');

      const colGutter = page.designSettings?.columns?.columnGapPt ?? 14.0;
      const colW = (contentW - colGutter) / 2.0;
      const divX = mRight - colW - colGutter / 2;
      const commentDivRgb = grgb(224, 216, 204);
      doc.setDrawColor(commentDivRgb[0], commentDivRgb[1], commentDivRgb[2]);
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

      const sepRgb = grgb(51, 51, 51);
      doc.setDrawColor(sepRgb[0], sepRgb[1], sepRgb[2]);
      doc.setLineWidth(renderPlan.footnoteSeparatorWeightPt || 0.85);
      doc.line(mRight - sepLen, sepY, mRight, sepY);
    }

    // 5.5 v0.8.0 Part E: image-only pages — draw each image fitted into
    // the content area (object-contain, like the canvas preview), with its
    // caption underneath. An unreadable image must not fail the whole
    // export; the page still prints with its header/folio.
    if (page.isImageOnlyPage) {
      const images = page.pageImages ?? [];
      const gap = 12;
      const count = Math.max(1, images.length);
      const slotH = (contentH - gap * (count - 1)) / count;
      let slotY = mTop;
      for (const img of images) {
        const captionH = img.altText ? 14 : 0;
        const availH = Math.max(10, slotH - captionH);
        if (img.dataUrl) {
          const fmt = img.dataUrl.startsWith('data:image/png')
            ? 'PNG'
            : img.dataUrl.startsWith('data:image/svg')
              ? 'SVG'
              : 'JPEG';
          // Contain-fit when the intrinsic size is known; otherwise fill
          // the slot (images without dimension metadata only).
          let drawW = contentW;
          let drawH = availH;
          if (img.widthPx && img.heightPx && img.widthPx > 0 && img.heightPx > 0) {
            const scale = Math.min(contentW / img.widthPx, availH / img.heightPx);
            drawW = img.widthPx * scale;
            drawH = img.heightPx * scale;
          }
          const drawX = mLeft + (contentW - drawW) / 2;
          const drawY = slotY + (availH - drawH) / 2;
          try {
            doc.addImage(img.dataUrl, fmt as 'PNG' | 'JPEG' | 'SVG', drawX, drawY, drawW, drawH);
          } catch {
            // Unreadable image data — the page still prints.
          }
        }
        if (img.altText) {
          drawHeaderOrFolioPhrase(img.altText, 'center', mediaW / 2, slotY + slotH - 2, 10, false, '#5C5346');
        }
        slotY += slotH + gap;
      }
    }

    // 5.8 Draw Opening Word Ornamental Frame (vector paths behind opening words)
    if (renderPlan.openingWordBox) {
      // v0.9.9 (I2): new Vilna frames render locally; older styles
      // delegate as before. The box text is drawn below either way.
      if (PdfExporter.isVilnaOpeningBoxStyle(renderPlan.openingWordBox.styleId)) {
        PdfExporter.drawVilnaOpeningBoxOnPdf(
          doc,
          renderPlan.openingWordBox,
          renderPlan.openingDecorationThicknessPt ?? 1.1
        );
      } else {
        OrnamentLibraryEngine.drawOpeningWordBoxOnPdf(
          doc,
          renderPlan.openingWordBox,
          0,
          0,
          g('#1E1B18')
        );
      }
      if (renderPlan.openingWordBox.text && renderPlan.openingWordBox.text.trim()) {
        const ob = renderPlan.openingWordBox;
        const bw = Math.max(24, ob.xRight - ob.xLeft);
        const bh = Math.max(18, ob.yBottom - ob.yTop);
        const fontPt = Math.max(10, Math.min(bh * 0.52, (bw * 0.72) / Math.max(2, ob.text.length * 0.52)));
        drawHeaderOrFolioPhrase(
          ob.text,
          'center',
          (ob.xLeft + ob.xRight) / 2,
          (ob.yTop + ob.yBottom) / 2 + fontPt * 0.32,
          fontPt,
          true,
          '#121214'
        );
      }
    }

    // 5.9 Draw Michtav box in native vector PDF if present
    if (renderPlan.michtavBox) {
      const mb = renderPlan.michtavBox;
      const mbRgb = grgb(92, 83, 70);
      doc.setDrawColor(mbRgb[0], mbRgb[1], mbRgb[2]);
      doc.setLineWidth(1.5);
      doc.rect(mb.xLeft, mb.yTop, mb.xRight - mb.xLeft, mb.yBottom - mb.yTop, 'S');
      if (mb.text.trim()) {
        drawHeaderOrFolioPhrase(
          mb.text,
          'center',
          (mb.xLeft + mb.xRight) / 2,
          (mb.yTop + mb.yBottom) / 2 + 4,
          Math.max(10, (mb.yBottom - mb.yTop) * 0.4),
          true,
          '#3B2F1E'
        );
      }
    }

    // 6. Emit all solved lines & words from the authoritative renderPlan as native vector text
    const emitNativeLines = (linesToDraw: PdfLineDrawCommand[], fallbackColor: string) => {
      for (const lineCmd of linesToDraw) {
        const defaultColor =
          lineCmd.role === 'footnote'
            ? '#3A3836'
            : lineCmd.role === 'primary_comment' || lineCmd.role === 'secondary_comment'
            ? '#222120'
            : fallbackColor;

        for (const wCmd of lineCmd.words) {
          const effectiveColor = g(wCmd.textColor || lineCmd.textColor || defaultColor);
          PdfNativeTextEngine.drawNativeWord(doc, {
            text: wCmd.text,
            xLeft: wCmd.xLeft,
            xRight: wCmd.xRight,
            yBaseline: wCmd.yBaseline,
            pageHeight: mediaH,
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
              pageHeight: mediaH,
              fontFamily: wCmd.fontFamily,
              fontSizePt: markerSize,
              isBold: true,
              textColorHex: g('#92400E'),
            });
          }
        }

        if (lineCmd.transitionMarkerBefore && lineCmd.words.length > 0) {
          const firstWord = lineCmd.words[0];
          const lastWord = lineCmd.words[lineCmd.words.length - 1];
          const mSize = lineCmd.transitionMarkerSizePt ?? Math.max(8, lineCmd.fontSizePt * 0.92);
          const mW = Math.max(mSize * 0.8, lineCmd.transitionMarkerBefore.length * mSize * 0.55);
          const afterLast = lineCmd.transitionMarkerPosition === 'after_last_word';
          const mXLeft = afterLast ? lastWord.xLeft - 3 - mW : firstWord.xRight + 3;
          if (lineCmd.transitionMarkerStyle === 'boxed') {
            doc.setDrawColor(30, 27, 24);
            doc.setFillColor(252, 250, 245);
            doc.setLineWidth(0.7);
            doc.rect(mXLeft - 2, lineCmd.yBaseline - mSize - 1, mW + 4, mSize + 4, 'FD');
          }
          PdfNativeTextEngine.drawNativeWord(doc, {
            text: lineCmd.transitionMarkerBefore,
            xLeft: mXLeft,
            xRight: mXLeft + mW,
            yBaseline: lineCmd.yBaseline,
            pageHeight: mediaH,
            fontFamily: lineCmd.fontFamily,
            fontSizePt: mSize,
            isBold: true,
            textColorHex: g(lineCmd.transitionMarkerVerified === false ? '#92400E' : '#121214'),
          });
        }

        if (lineCmd.unitBoundaryAfter && lineCmd.separatorStyleId && lineCmd.separatorStyleId !== 'none') {
          OrnamentLibraryEngine.drawSeparatorRuleOnPdf(
            doc,
            lineCmd.separatorStyleId,
            lineCmd.xLeft,
            lineCmd.xRight,
            lineCmd.yBottom + 2.5,
            lineCmd.separatorWidthRatio,
            lineCmd.separatorThicknessPt,
            g('#4B4640')
          );
        }
      }
    };

    emitNativeLines(renderPlan.lines, '#121214');

    if (renderPlan.peripheralStreams && renderPlan.peripheralStreams.length > 0) {
      for (const ps of renderPlan.peripheralStreams) {
        if (ps.lines[0]) {
          drawHeaderOrFolioPhrase(
            ps.label,
            'center',
            (ps.lines[0].xLeft + ps.lines[0].xRight) / 2,
            Math.max(mTop - 2, ps.lines[0].yTop - 3),
            7.5,
            true,
            '#6B5E4C'
          );
        }
        emitNativeLines(ps.lines, '#3A3836');
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
   * Add an invisible Unicode layer over the accurately shaped page image. This preserves
   * copy/search without painting the unshaped glyphs a second time.
   */
  private static renderInvisibleTextLayer(doc: jsPDF, page: PageTypesetResult): void {
    const plan = this.buildPageRenderPlan(page);
    for (const line of plan.lines) {
      for (const word of line.words) {
        const family = PdfNativeTextEngine.resolveEmbeddedFontFamily(word.fontFamily);
        doc.setFont(family, word.isBold ? 'bold' : 'normal');
        doc.setFontSize(word.fontSizePt);
        // Use jsPDF's Unicode text path for the hidden layer rather than custom glyph IDs.
        // This gives PDF readers a normal ToUnicode mapping for searching/copying Hebrew.
        doc.text(word.text, word.xRight, word.yBaseline, {
          align: 'right',
          renderingMode: 'invisible',
        } as any);
        if (word.footnoteMarker !== undefined) {
          doc.setFontSize(Math.max(6.5, word.fontSizePt * 0.65));
          doc.text(String(word.footnoteMarker), word.xLeft, word.yBaseline - word.fontSizePt * 0.28, {
            align: 'left',
            renderingMode: 'invisible',
          } as any);
        }
      }
    }
    // v0.5.0 (Title Page): the title page has no lines, so its fields are
    // placed in the invisible layer from the plan's title-page rows —
    // otherwise the title would not be searchable in the fallback PDF.
    if (plan.isTitlePage && plan.titlePage) {
      const mLeft = textBlockLeft(page.geometry);
      const mRight = textBlockRight(page.geometry);
      for (const row of plan.titlePage.rows) {
        const family = PdfNativeTextEngine.resolveEmbeddedFontFamily(row.fontFamily || 'Frank Ruhl Libre');
        doc.setFont(family, row.isBold ? 'bold' : 'normal');
        doc.setFontSize(row.fontSizePt);
        const x =
          row.alignment === 'center' ? (mLeft + mRight) / 2 : row.alignment === 'right' ? mRight : mLeft;
        doc.text(row.text, x, row.yBaselinePt, {
          align: row.alignment,
          renderingMode: 'invisible',
        } as any);
      }
      // v0.9.9 — template metadata rows are searchable too.
      for (const mRow of plan.titlePage.metadataRows ?? []) {
        if (!mRow.text.trim()) continue;
        const family = PdfNativeTextEngine.resolveEmbeddedFontFamily(mRow.fontFamily || 'Frank Ruhl Libre');
        doc.setFont(family, mRow.isBold ? 'bold' : 'normal');
        doc.setFontSize(mRow.smallCaps ? mRow.fontSizePt * 0.85 : mRow.fontSizePt);
        const x =
          mRow.alignment === 'center' ? (mLeft + mRight) / 2 : mRow.alignment === 'right' ? mRight : mLeft;
        doc.text(
          mRow.uppercase || mRow.smallCaps ? mRow.text.toUpperCase() : mRow.text,
          x,
          mRow.yBaselinePt,
          {
            align: mRow.alignment,
            renderingMode: 'invisible',
          } as any
        );
      }
    }
    // v0.8.0 Part C (§7): the Michtav box text, searchable in the PDF.
    if (plan.michtavBox) {
      const mb = plan.michtavBox;
      const family = PdfNativeTextEngine.resolveEmbeddedFontFamily('Frank Ruhl Libre');
      doc.setFont(family, 'bold');
      doc.setFontSize(Math.max(10, (mb.yBottom - mb.yTop) * 0.4));
      doc.text(mb.text, (mb.xLeft + mb.xRight) / 2, (mb.yTop + mb.yBottom) / 2, {
        align: 'center',
        renderingMode: 'invisible',
      } as any);
    }
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
  public static async generatePrintPdf(
    page: PageTypesetResult,
    documentTitle?: string,
    printOptions?: PrintPdfOptions
  ): Promise<Blob> {
    const singleDoc: BookTypesetDocument = {
      title: documentTitle || page.headerTitle || 'ספר קודש',
      layoutType: page.layoutType,
      pages: [page],
      totalPages: 1,
      geometry: page.geometry,
      designSettings: page.designSettings,
    };
    return this.generateMultiPagePdf(singleDoc, undefined, printOptions);
  }

  /**
   * Resolve print options against the defaults. A call with NO options at
   * all preserves the pre-v0.3.0 behaviour exactly (trim-size pages, no
   * bleed); once an options object is passed, `bleedMm` defaults to 3.
   */
  private static resolvePrintOptions(options?: PrintPdfOptions): Required<
    Pick<PrintPdfOptions, 'bleedMm' | 'spreads' | 'purpose' | 'colorMode' | 'includeCover' | 'includeToc'>
  > & PrintPdfOptions {
    if (!options) {
      return { ...DEFAULT_PRINT_PDF_OPTIONS, bleedMm: 0 };
    }
    const resolved = { ...DEFAULT_PRINT_PDF_OPTIONS, ...options };
    if (resolved.purpose === 'screen') resolved.bleedMm = 0;
    return resolved;
  }

  /** Watermark text for this export: explicit text, or the proof default. */
  private static resolveWatermarkText(options: PrintPdfOptions): string | null {
    if (options.watermark) return options.watermark;
    if (options.purpose === 'proof') return 'PROOF · הגהה';
    return null;
  }

  /** Light structural check for spread (raster) PDFs, which carry no embedded fonts by design. */
  private static async assertSpreadPdf(blob: Blob, expectedPages: number): Promise<void> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const raw = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    if (!raw.startsWith('%PDF-')) {
      throw new Error('ייצוא PDF נכשל: הקובץ שנוצר אינו קובץ PDF תקין.');
    }
    const pageObjects = (raw.match(/\/Type\s*\/Page\b/g) ?? []).length;
    if (pageObjects !== expectedPages) {
      throw new Error(
        'ייצוא PDF נכשל: ציפינו ל-' + expectedPages + ' עמודים, אך נמצאו ' + pageObjects + '.'
      );
    }
  }

  /**
   * Spread mode: two body pages side-by-side on one wide sheet. The native
   * vector renderer writes absolute coordinates, so spreads are rendered
   * from the high-resolution canvas pages instead (raster spread sheets,
   * searchable text is not preserved on spread sheets — see report).
   * Cover and TOC pages stay single portrait pages.
   */
  private static async generateSpreadPdf(
    bookDoc: BookTypesetDocument,
    bodyPages: PageTypesetResult[],
    opts: ReturnType<typeof PdfExporter.resolvePrintOptions>,
    cover: CoverPageData | null,
    tocPages: TocEntry[][],
    watermarkText: string | null,
    onProgress?: (current: number, total: number) => void
  ): Promise<Blob> {
    const { geometry } = bookDoc;
    const bleedPt = this.mmToPt(opts.bleedMm);
    const mediaW = geometry.pageWidth + 2 * bleedPt;
    const mediaH = geometry.pageHeight + 2 * bleedPt;
    const spreadW = 2 * geometry.pageWidth + 2 * bleedPt;
    const blackOnly = opts.colorMode === 'blackOnly';
    const g = (hex: string) => (blackOnly ? this.toGrayHex(hex) : hex);

    await this.ensureCanvasFontsLoaded();
    // jsPDF's constructor page cannot be resized or removed, so size it to
    // the first sheet (cover / TOC portrait, otherwise the first spread).
    // v0.5.0 (Title Page): an in-doc title page is a portrait sheet too.
    const hasInDocTitlePage = bodyPages[0]?.isTitlePage === true;
    const firstSheetW = cover || tocPages.length > 0 || hasInDocTitlePage ? mediaW : spreadW;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [firstSheetW, mediaH],
      compress: true,
    });
    await PdfNativeTextEngine.registerFontsOnDoc(doc);

    let sheetCount = 0;
    const addSheet = (w: number, h: number) => {
      if (sheetCount > 0) doc.addPage([w, h], w > h ? 'landscape' : 'portrait');
      sheetCount++;
    };
    const applyWatermark = (w: number, h: number) => {
      if (watermarkText) {
        this.drawDiagonalWatermark(doc, watermarkText, w, h, g('#D8D2C8'));
      }
    };

    if (cover) {
      addSheet(mediaW, mediaH);
      this.renderCoverPageToPdf(doc, cover, geometry, { bleedPt, colorMode: opts.colorMode });
      applyWatermark(mediaW, mediaH);
    }
    for (const tocEntries of tocPages) {
      addSheet(mediaW, mediaH);
      this.renderTocPageToPdf(doc, tocEntries, geometry, { bleedPt, colorMode: opts.colorMode });
      applyWatermark(mediaW, mediaH);
    }

    const canvasScale = 300 / 72;
    // v0.5.0 (Title Page): an in-doc title page is a single portrait
    // sheet, never half of a spread. Render it alone first (from the same
    // project data as the preview), then pair the body pages from index 1.
    let firstBodyIndex = 0;
    if (bodyPages[0]?.isTitlePage) {
      const tp = bodyPages[0].designSettings?.titlePage;
      const titleCover: CoverPageData = tp?.enabled
        ? titlePageSettingsToCoverData(tp, bookDoc.title || 'ספר קודש', geometry.pageHeight)
        : { title: bookDoc.title || 'ספר קודש' };
      addSheet(mediaW, mediaH);
      this.renderCoverPageToPdf(doc, titleCover, geometry, { bleedPt, colorMode: opts.colorMode });
      applyWatermark(mediaW, mediaH);
      firstBodyIndex = 1;
    }
    const remainingPages = bodyPages.slice(firstBodyIndex);
    const totalPairs = Math.ceil(remainingPages.length / 2);
    for (let pair = 0; pair < totalPairs; pair++) {
      addSheet(spreadW, mediaH);
      const left = remainingPages[pair * 2];
      const right = remainingPages[pair * 2 + 1];
      onProgress?.(firstBodyIndex + pair * 2 + 1, bodyPages.length);

      const paintPageImage = async (page: PageTypesetResult, x: number) => {
        const canvas = await this.renderPageToCanvasAsync(page, canvasScale);
        let src: HTMLCanvasElement = canvas;
        if (blackOnly) {
          const gray = document.createElement('canvas');
          gray.width = canvas.width;
          gray.height = canvas.height;
          const gctx = gray.getContext('2d');
          if (gctx) {
            gctx.filter = 'grayscale(1)';
            gctx.drawImage(canvas, 0, 0);
            src = gray;
          }
        }
        doc.addImage(
          src.toDataURL('image/png'),
          'PNG',
          x,
          bleedPt,
          geometry.pageWidth,
          geometry.pageHeight
        );
      };

      // White sheet behind the two page images (the canvas pages already carry parchment).
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, spreadW, mediaH, 'F');
      if (left) {
        const pageWithSettings: PageTypesetResult =
          left.designSettings || !bookDoc.designSettings
            ? left
            : { ...left, designSettings: bookDoc.designSettings };
        await paintPageImage(pageWithSettings, bleedPt);
      }
      if (right) {
        const pageWithSettings: PageTypesetResult =
          right.designSettings || !bookDoc.designSettings
            ? right
            : { ...right, designSettings: bookDoc.designSettings };
        await paintPageImage(pageWithSettings, bleedPt + geometry.pageWidth);
        onProgress?.(Math.min(pair * 2 + 2, bodyPages.length), bodyPages.length);
      }
      // Centre fold rule.
      const foldRgb = blackOnly ? [180, 180, 180] : [216, 207, 194];
      doc.setDrawColor(foldRgb[0], foldRgb[1], foldRgb[2]);
      doc.setLineWidth(0.5);
      doc.line(spreadW / 2, bleedPt, spreadW / 2, mediaH - bleedPt);
      applyWatermark(spreadW, mediaH);
    }

    this.applyPrintBoxes(doc, bleedPt);
    const blob = doc.output('blob');
    await this.assertSpreadPdf(blob, sheetCount);
    return blob;
  }

  /**
   * Generates a multi-page print-ready native, selectable, searchable PDF containing ALL pages in the book.
   * `printOptions` (v0.3.0) is optional; without it the export behaves exactly as before.
   */
  public static async generateMultiPagePdf(
    bookDoc: BookTypesetDocument,
    onProgress?: (current: number, total: number) => void,
    printOptions?: PrintPdfOptions
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

    const opts = this.resolvePrintOptions(printOptions);
    const { geometry } = bookDoc;

    // Page range filters on physical print page numbers (inclusive).
    let bodyPages = bookDoc.pages;
    if (printOptions?.pageRange) {
      const from = Math.max(1, printOptions.pageRange.from);
      const to = Math.max(from, printOptions.pageRange.to);
      bodyPages = bookDoc.pages.filter(p => {
        const phys = p.physicalPageNumber ?? p.pageNumber;
        return phys >= from && phys <= to;
      });
    }
    if (bodyPages.length === 0) {
      throw new Error('ייצוא PDF נכשל: טווח העמודים שנבחר אינו מכיל עמודים.');
    }

    const bleedPt = this.mmToPt(opts.bleedMm);
    const mediaW = geometry.pageWidth + 2 * bleedPt;
    const mediaH = geometry.pageHeight + 2 * bleedPt;
    const blackOnly = opts.colorMode === 'blackOnly';
    const g = (hex: string) => (blackOnly ? this.toGrayHex(hex) : hex);
    const watermarkText = this.resolveWatermarkText(opts);

    const hasInDocTitlePage = bodyPages.length > 0 && bodyPages[0].isTitlePage === true;
    let cover: CoverPageData | null =
      opts.includeCover && !hasInDocTitlePage
        ? opts.coverData ?? { title: bookDoc.title || 'ספר קודש' }
        : null;

    let tocEntries: TocEntry[] = [];
    let tocPages: TocEntry[][] = [];
    if (opts.includeToc) {
      const supplied = opts.tocEntries ?? null;
      const draft = supplied ?? buildTocFromBook(bookDoc, bodyPages, 0);
      const tocPageCount = Math.max(1, Math.ceil(draft.length / this.TOC_ENTRIES_PER_PAGE));
      const frontMatterOffset = (cover ? 1 : 0) + tocPageCount;
      tocEntries = supplied
        ? supplied.map(e => ({
            ...e,
            pageNumber: e.pageNumber !== undefined ? e.pageNumber + frontMatterOffset : undefined,
          }))
        : buildTocFromBook(bookDoc, bodyPages, frontMatterOffset);
      for (let i = 0; i < tocEntries.length; i += this.TOC_ENTRIES_PER_PAGE) {
        tocPages.push(tocEntries.slice(i, i + this.TOC_ENTRIES_PER_PAGE));
      }
      if (tocPages.length === 0) tocPages = [[]];
    }

    if (opts.spreads) {
      return this.generateSpreadPdf(
        bookDoc,
        bodyPages,
        opts,
        cover,
        tocPages,
        watermarkText,
        onProgress
      );
    }

    const inDocTp = hasInDocTitlePage ? bodyPages[0]?.designSettings?.titlePage : undefined;
    // Layout training T3.5 — the spine is computed from the interior page
    // count (title, its back, TOC and body) when a caliper is given.
    const interiorPages = bodyPages.length + tocPages.length;
    const withPageCount = <T extends CoverPageData | null | undefined>(c: T): T =>
      c && c.wraparoundCover
        ? ({ ...c, wraparoundCover: { ...c.wraparoundCover, interiorPageCount: c.wraparoundCover.interiorPageCount ?? interiorPages } } as T)
        : c;
    cover = withPageCount(cover);
    const inDocCoverData = withPageCount(
      inDocTp?.enabled
        ? titlePageSettingsToCoverData(inDocTp, bookDoc.title || 'ספר קודש', geometry.pageHeight)
        : null
    );
    const firstCoverDims = this.computeCoverSheetDimensions(
      cover ?? inDocCoverData,
      geometry,
      bleedPt
    );

    const doc = new jsPDF({
      orientation: firstCoverDims.widthPt > firstCoverDims.heightPt ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [firstCoverDims.widthPt, firstCoverDims.heightPt],
      compress: true,
    });

    await PdfNativeTextEngine.registerFontsOnDoc(doc);

    let pdfPageCount = 0;
    const addPdfPage = (w = mediaW, h = mediaH) => {
      if (pdfPageCount > 0) doc.addPage([w, h], w > h ? 'landscape' : 'portrait');
      pdfPageCount++;
    };
    const applyWatermark = (w = mediaW, h = mediaH) => {
      if (watermarkText) {
        this.drawDiagonalWatermark(doc, watermarkText, w, h, g('#D8D2C8'));
      }
    };

    if (cover) {
      const cDims = this.computeCoverSheetDimensions(cover, geometry, bleedPt);
      addPdfPage(cDims.widthPt, cDims.heightPt);
      this.renderCoverPageToPdf(doc, cover, geometry, { bleedPt, colorMode: opts.colorMode });
      applyWatermark(cDims.widthPt, cDims.heightPt);
    }
    for (const entries of tocPages) {
      addPdfPage(mediaW, mediaH);
      this.renderTocPageToPdf(doc, entries, geometry, { bleedPt, colorMode: opts.colorMode });
      applyWatermark(mediaW, mediaH);
    }

    const totalPages = bodyPages.length;
    for (let i = 0; i < totalPages; i++) {
      const page = bodyPages[i];
      const pageWithSettings: PageTypesetResult =
        page.designSettings || !bookDoc.designSettings
          ? page
          : { ...page, designSettings: bookDoc.designSettings };
      if (pageWithSettings.isTitlePage) {
        const tpCover = pageWithSettings.designSettings?.titlePage?.enabled
          ? titlePageSettingsToCoverData(pageWithSettings.designSettings.titlePage, bookDoc.title || 'ספר קודש', geometry.pageHeight)
          : { title: bookDoc.title || 'ספר קודש' };
        const tpDims = this.computeCoverSheetDimensions(tpCover, geometry, bleedPt);
        addPdfPage(tpDims.widthPt, tpDims.heightPt);
        onProgress?.(i + 1, totalPages);
        this.renderPageToPdfNative(doc, pageWithSettings, { bleedPt, colorMode: opts.colorMode });
        applyWatermark(tpDims.widthPt, tpDims.heightPt);
        continue;
      }
      addPdfPage(mediaW, mediaH);
      onProgress?.(i + 1, totalPages);
      this.renderPageToPdfNative(doc, pageWithSettings, { bleedPt, colorMode: opts.colorMode });
      applyWatermark(mediaW, mediaH);
    }

    this.applyPrintBoxes(doc, bleedPt);
    const pdfBlob = doc.output('blob');
    // v0.5.0 (Title Page): a user-imported frame image is a deliberate
    // raster element on the title page (its text stays vector). Allow
    // raster pages only then; every other export still fails closed on
    // any embedded image.
    // v0.8.0 Part E: image-only pages are deliberate raster content too
    // (scanned haskama / DOCX images) — the export must not fail closed
    // on the very pages the user imported images for.
    const hasCustomBorderImage =
      !!cover?.customBorderImageDataUrl ||
      (hasInDocTitlePage &&
        !!bodyPages[0]?.designSettings?.titlePage?.customBorderImage?.dataUrl);
    const hasImageOnlyPages = bodyPages.some(p => p.isImageOnlyPage === true);
    await this.assertNativeVectorPdf(pdfBlob, pdfPageCount, hasCustomBorderImage || hasImageOnlyPages);
    return pdfBlob;
  }

  /**
   * Fail closed if the generated file is not a genuine text/vector PDF. This is intentionally
   * checked against the serialized PDF bytes (not the renderer's intent), so a future regression
   * that flattens pages into PNG/JPEG images cannot silently be reported as a successful export.
   */
  private static async assertNativeVectorPdf(blob: Blob, expectedPages: number, allowRasterPages = false): Promise<void> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const raw = Array.from(bytes, byte => String.fromCharCode(byte)).join('');

    if (!raw.startsWith('%PDF-')) {
      throw new Error('ייצוא PDF נכשל: הקובץ שנוצר אינו קובץ PDF תקין.');
    }

    const imageXObjects = (raw.match(/\/Subtype\s*\/Image\b/g) ?? []).length;
    if (imageXObjects > 0 && !allowRasterPages) {
      throw new Error(
        'ייצוא PDF בוטל: זוהו תמונות מוטמעות בעמודים. נדרש PDF וקטורי, לא עמודים שטוחים כתמונות.'
      );
    }

    const pageObjects = (raw.match(/\/Type\s*\/Page\b/g) ?? []).length;
    if (pageObjects !== expectedPages) {
      throw new Error(
        'ייצוא PDF נכשל: ציפינו ל-' + expectedPages + ' עמודים, אך נמצאו ' + pageObjects + '.'
      );
    }

    // The document must carry embedded font programs and Unicode maps; otherwise its appearance
    // and text extraction may depend on fonts installed on the receiving computer.
    if (!/\/FontFile[23]?\s+\d+\s+\d+\s+R/.test(raw)) {
      throw new Error('ייצוא PDF נכשל: לא נמצאו גופנים מוטמעים בקובץ.');
    }
    if (!/\/ToUnicode\s+\d+\s+\d+\s+R/.test(raw)) {
      throw new Error('ייצוא PDF נכשל: לא נמצאה מפת Unicode לטקסט שניתן לחיפוש ולהעתקה.');
    }
  }

  /**
   * Compatibility export path for cases where the native glyph stream misplaces Hebrew marks.
   * The browser Canvas text shaper paints each page at high resolution; a separate invisible
   * Unicode layer retains search/copy. This is a deliberate visual-fidelity fallback, not a
   * replacement for native vector export: page artwork is rasterized and may be larger.
   */
  public static async generateMultiPagePdfCanvasFallback(
    bookDoc: BookTypesetDocument,
    onProgress?: (current: number, total: number) => void
  ): Promise<Blob> {
    const totalPlacedOrnaments = bookDoc.pages.reduce(
      (sum, page) => sum + (page.placedOrnaments?.length ?? 0),
      0
    );
    EngineHardRulesEngine.assertExportAllowed({
      bookDoc,
      links: bookDoc.links,
      userSuppliedOrnamentsCount: totalPlacedOrnaments,
    });

    const { geometry, pages } = bookDoc;
    if (pages.length === 0) throw new Error('ייצוא PDF נכשל: אין עמודים לייצוא.');

    // Ensure the exact bundled fonts are ready before Canvas measures or paints any text.
    await this.ensureCanvasFontsLoaded();

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [geometry.pageWidth, geometry.pageHeight],
      compress: true,
    });
    await PdfNativeTextEngine.registerFontsOnDoc(doc);

    // 4.1667 px per typographic point is approximately 300 dpi.
    const canvasScale = 300 / 72;
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) doc.addPage([geometry.pageWidth, geometry.pageHeight], 'portrait');
      onProgress?.(i + 1, pages.length);

      const page = pages[i].designSettings || !bookDoc.designSettings
        ? pages[i]
        : { ...pages[i], designSettings: bookDoc.designSettings };
      const canvas = await this.renderPageToCanvasAsync(page, canvasScale);
      if (!canvas.width || !canvas.height) {
        throw new Error('ייצוא PDF חלופי נכשל: לא ניתן ליצור תמונת עמוד.');
      }
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, geometry.pageWidth, geometry.pageHeight);
      this.renderInvisibleTextLayer(doc, page);
    }

    const blob = doc.output('blob');
    await this.assertNativeVectorPdf(blob, pages.length, true);
    return blob;
  }
}
