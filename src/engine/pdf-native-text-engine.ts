/**
 * Keter Native Vector Hebrew PDF Font & Text Extraction Engine (Stage 13A-3)
 *
 * Provides:
 * 1. Embedded TrueType font loading for browser (`fetch('/fonts/...')`) and Node/test (`fs.readFileSync`)
 *    supporting Frank Ruhl Libre, Noto Rashi Hebrew, and David Libre (Regular & Bold). Hebrew,
 *    Nikud (vowel points), and Taamim (cantillation marks) coverage is validated by the shaping audit.
 * 2. RTL text emission with full-word PDF selection geometry:
 *    - Emits Hebrew clusters in visual left-to-right order so the PDF text cursor advances across
 *      the complete word; each cluster keeps its combining marks attached to the base letter.
 *    - Uses `/ActualText` to preserve the original logical Hebrew order (including Nikud/Taamim)
 *      for PDF readers that honor marked-content replacement text.
 * 3. Built-in native PDF parser & text extractor (`extractTextAndPositionsFromPdf`) that parses
 *    actual generated PDF bytes (including Flate-compressed or uncompressed streams, `/ToUnicode`
 *    CMaps, font resources, and `BT ... ET` text objects) to verify selectable/searchable text,
 *    RTL reading order, Nikud association, bold Dibbur HaMatchil font assignment, and exact
 *    coordinate fidelity.
 */

import { jsPDF } from 'jspdf';

export interface EmbeddedFontSpec {
  vfsFileName: string;
  fontFamily: string;
  fontStyle: 'normal' | 'bold';
  publicPath: string;
}

export const KETER_EMBEDDED_FONTS: EmbeddedFontSpec[] = [
  {
    vfsFileName: 'FrankRuhlLibre-Regular.ttf',
    fontFamily: 'Frank Ruhl Libre',
    fontStyle: 'normal',
    publicPath: '/fonts/FrankRuhlLibre-Regular.ttf',
  },
  {
    vfsFileName: 'FrankRuhlLibre-Bold.ttf',
    fontFamily: 'Frank Ruhl Libre',
    fontStyle: 'bold',
    publicPath: '/fonts/FrankRuhlLibre-Bold.ttf',
  },
  {
    vfsFileName: 'NotoRashiHebrew-Regular.ttf',
    fontFamily: 'Noto Rashi Hebrew',
    fontStyle: 'normal',
    publicPath: '/fonts/NotoRashiHebrew-Regular.ttf',
  },
  {
    vfsFileName: 'NotoRashiHebrew-Bold.ttf',
    fontFamily: 'Noto Rashi Hebrew',
    fontStyle: 'bold',
    publicPath: '/fonts/NotoRashiHebrew-Bold.ttf',
  },
  {
    vfsFileName: 'DavidLibre-Regular.ttf',
    fontFamily: 'David Libre',
    fontStyle: 'normal',
    publicPath: '/fonts/DavidLibre-Regular.ttf',
  },
  {
    vfsFileName: 'DavidLibre-Bold.ttf',
    fontFamily: 'David Libre',
    fontStyle: 'bold',
    publicPath: '/fonts/DavidLibre-Bold.ttf',
  },
  // Layout training T3.6 — the whole-word teamim font (OFL): every word
  // with cantillation marks is set in it when the body font has none.
  {
    vfsFileName: 'NotoSerifHebrew-Regular.ttf',
    fontFamily: 'Noto Serif Hebrew',
    fontStyle: 'normal',
    publicPath: '/fonts/NotoSerifHebrew-Regular.ttf',
  },
  {
    vfsFileName: 'NotoSerifHebrew-Bold.ttf',
    fontFamily: 'Noto Serif Hebrew',
    fontStyle: 'bold',
    publicPath: '/fonts/NotoSerifHebrew-Bold.ttf',
  },
];

export interface ExtractedPdfTextSpan {
  pageNumber: number;
  text: string;
  strippedText: string;
  fontResourceId: string;
  isBoldFont: boolean;
  fontSizePt: number;
  xStartPt: number;
  xRightPt: number;
  yBaselinePt: number;
  roleHint?: string;
}

export interface ExtractedPdfPageContent {
  pageNumber: number;
  spans: ExtractedPdfTextSpan[];
  lines: {
    yBaselinePt: number;
    spans: ExtractedPdfTextSpan[];
    lineText: string;
    strippedLineText: string;
  }[];
  fullText: string;
  strippedFullText: string;
  vectorPathOpsCount: number;
  hasFullPageRasterImage: boolean;
}

export interface ExtractedPdfDocument {
  pageCount: number;
  pages: ExtractedPdfPageContent[];
  fullText: string;
  strippedFullText: string;
}

export class PdfNativeTextEngine {
  /**
   * Load a file shipped in `public/` (e.g. '/fonts/X.ttf'). Resolved
   * against the page's own base URL, so it works from a web server AND
   * from the installed Electron app, which loads dist/index.html from
   * disk (file://) — where '/fonts/…' would point at the drive root and
   * Chromium's fetch() cannot read file:// URLs at all (XHR can).
   */
  public static async loadPublicBinary(publicPath: string): Promise<ArrayBuffer | null> {
    const rel = publicPath.replace(/^\//, '');
    const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : undefined;
    const url = base ? new URL(rel, base).href : publicPath;
    if (url.startsWith('file:') && typeof XMLHttpRequest !== 'undefined') {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => resolve(xhr.status === 0 || xhr.status === 200 ? (xhr.response as ArrayBuffer) : null);
        xhr.onerror = () => resolve(null);
        xhr.send();
      });
    }
    const res = await fetch(url);
    return res.ok ? res.arrayBuffer() : null;
  }

  private static fontBase64Cache: Map<string, string> = new Map();
  /**
   * User-provided font binaries are kept in memory for this browser session and embedded
   * into every exported PDF. A family name alone is not enough to make a portable PDF:
   * the actual font program must be available to jsPDF.
   */
  private static customFontBinaries: Map<string, { fileName: string; base64: string; family: string }> = new Map();

  public static registerCustomFont(fontFamily: string, fontData: ArrayBuffer): void {
    const family = fontFamily.trim();
    if (!family) throw new Error('Font family name cannot be empty.');
    if (!(fontData instanceof ArrayBuffer) || fontData.byteLength < 12) {
      throw new Error('The selected font file is empty or invalid.');
    }

    const bytes = new Uint8Array(fontData);
    const signature = String.fromCharCode(...bytes.subarray(0, 4));
    const isSfnt = signature === '\u0000\u0001\u0000\u0000' || signature === 'OTTO' || signature === 'true';
    if (!isSfnt) {
      throw new Error('PDF export currently requires a TrueType/OpenType .ttf or .otf font file. Web fonts such as WOFF/WOFF2 cannot be embedded by this exporter.');
    }

    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = typeof btoa === 'function'
      ? btoa(binary)
      : (() => { throw new Error('This font upload path requires a browser with base64 support.'); })();
    const fileName = 'CustomFont_' + Array.from(family).map(ch => /[a-z0-9]/i.test(ch) ? ch : '_').join('') + '.ttf';
    this.customFontBinaries.set(family.toLowerCase(), { fileName, base64, family });
  }

  /**
   * Returns a copy of the exact font bytes currently registered for a family.
   * Custom fonts are available immediately after upload; bundled fonts are loaded
   * lazily from the same binaries used by the PDF exporter.
   */
  public static async getFontBinary(fontFamily: string, fontStyle?: 'normal' | 'bold'): Promise<ArrayBuffer> {
    const requested = (fontFamily || '').trim();
    if (!requested) throw new Error('A font family is required to load font data.');

    const custom = this.customFontBinaries.get(requested.toLowerCase());
    if (custom) {
      const binary = typeof atob === 'function'
        ? atob(custom.base64)
        : (() => { throw new Error('This browser does not support decoding the registered font data.'); })();
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }

    const bundled = KETER_EMBEDDED_FONTS.find(spec =>
      spec.fontFamily.toLowerCase() === requested.toLowerCase() &&
      (fontStyle === undefined || spec.fontStyle === fontStyle)
    );
    if (!bundled) {
      const styleDescription = fontStyle ? ` (${fontStyle})` : '';
      throw new Error(`No font binary is registered for "${requested}"${styleDescription}. Upload its TTF/OTF file first.`);
    }

    const cache = await this.ensureFontBinariesLoaded();
    const base64 = cache.get(bundled.vfsFileName);
    if (!base64) throw new Error(`The font binary "${bundled.vfsFileName}" could not be loaded.`);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  /**
   * Strips Hebrew Nikud and Taamim (U+0591..U+05C7) and directional formatting marks
   * for normalized search comparison while preserving all base letters and punctuation.
   */
  public static stripNikud(str: string): string {
    return str.replace(/[\u0591-\u05C7\u200E\u200F]/g, '');
  }

  /**
   * Splits a Unicode string into grapheme clusters where each Hebrew combining mark
   * (U+0591..U+05C7) remains attached to its preceding base character in logical order.
   */
  public static splitHebrewGraphemeClusters(str: string): string[] {
    const cleaned = str.replace(/[\u200E\u200F]/g, '');
    const clusters: string[] = [];
    for (const ch of cleaned) {
      const cp = ch.codePointAt(0) ?? 0;
      // Combining marks join their letter; maqaf ־, paseq ׀, sof pasuq ׃
      // and nun hafukha ׆ are spacing punctuation (own cluster) — glued to
      // the letter, the sof pasuq was drawn inside the word.
      const isMark = cp >= 0x0591 && cp <= 0x05C7 && cp !== 0x05BE && cp !== 0x05C0 && cp !== 0x05C3 && cp !== 0x05C6;
      if (isMark && clusters.length > 0) {
        clusters[clusters.length - 1] += ch;
      } else {
        clusters.push(ch);
      }
    }
    return clusters;
  }

  /**
   * Maps any requested font family name from `ProfessionalDesignSettings` to one of the
   * embedded TrueType font families (`Frank Ruhl Libre`, `Noto Rashi Hebrew`, `David Libre`).
   */
  public static resolveEmbeddedFontFamily(requestedFamily?: string): string {
    const requested = (requestedFamily || '').trim();
    if (!requested) return 'Frank Ruhl Libre';

    const lower = requested.toLowerCase();
    if (this.customFontBinaries.has(lower)) return requested;
    const bundled = KETER_EMBEDDED_FONTS.find(spec => spec.fontFamily.toLowerCase() === lower);
    if (bundled) return bundled.fontFamily;

    // Do not silently substitute a different typeface. Silent substitution makes page
    // measurements, line breaks, and the exported PDF disagree with the user's design.
    throw new Error(
      `The font "${requested}" has no embeddable font file. Upload its .ttf or .otf file in Font Manager before exporting a portable PDF.`
    );
  }

  /**
   * Loads and caches the base64-encoded TTF font binaries in both Node/test and browser environments.
   */
  public static async ensureFontBinariesLoaded(): Promise<Map<string, string>> {
    if (this.fontBase64Cache.size === KETER_EMBEDDED_FONTS.length) {
      return this.fontBase64Cache;
    }

    const isBrowser = typeof window !== 'undefined' && typeof window.fetch === 'function';

    for (const spec of KETER_EMBEDDED_FONTS) {
      if (this.fontBase64Cache.has(spec.vfsFileName)) continue;

      if (!isBrowser) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          // v0.8.0 Part E: KETER_FONTS_DIR lets scripts/tests point at a
          // font folder outside the tree (e.g. a downloaded set) without
          // copying binaries into public/fonts.
          const envDir =
            typeof process !== 'undefined' ? process.env?.KETER_FONTS_DIR : undefined;
          const candidates = [
            ...(envDir ? [path.resolve(envDir, spec.vfsFileName)] : []),
            path.resolve(process.cwd(), 'public', 'fonts', spec.vfsFileName),
            path.resolve('/app/applet/public/fonts', spec.vfsFileName),
            path.resolve('/public/fonts', spec.vfsFileName),
          ];
          for (const filePath of candidates) {
            if (fs.existsSync(filePath)) {
              const b64 = fs.readFileSync(filePath).toString('base64');
              this.fontBase64Cache.set(spec.vfsFileName, b64);
              break;
            }
          }
        } catch {
          // Fallback to fetch if fs is unavailable
        }
      }

      if (!this.fontBase64Cache.has(spec.vfsFileName) && typeof fetch === 'function') {
        // v0.8.0 Part E: a relative publicPath ('/fonts/….ttf') is not a
        // valid fetch URL in Node — fetch throws ERR_INVALID_URL and used
        // to crash the whole caller (runStage13A3Tests under tsx). A font
        // that cannot be fetched is simply missing from the cache; the
        // caller (registerFontsOnDoc) then reports it by name instead of
        // crashing here.
        try {
          const buf = await PdfNativeTextEngine.loadPublicBinary(spec.publicPath);
          if (buf) {
            const bytes = new Uint8Array(buf);
            let binary = '';
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            this.fontBase64Cache.set(spec.vfsFileName, btoa(binary));
          }
        } catch {
          // Missing/unreachable font binary — reported by the caller.
        }
      }
    }

    return this.fontBase64Cache;
  }

  /**
   * Registers all embedded Hebrew TrueType fonts on a `jsPDF` instance.
   */
  public static async registerFontsOnDoc(doc: jsPDF): Promise<void> {
    const cache = await this.ensureFontBinariesLoaded();
    for (const spec of KETER_EMBEDDED_FONTS) {
      const b64 = cache.get(spec.vfsFileName);
      if (!b64) {
        throw new Error(`Missing embedded Hebrew TTF font binary: ${spec.vfsFileName}`);
      }
      doc.addFileToVFS(spec.vfsFileName, b64);
      doc.addFont(spec.vfsFileName, spec.fontFamily, spec.fontStyle);
    }

    for (const [familyKey, font] of this.customFontBinaries.entries()) {
      doc.addFileToVFS(font.fileName, font.base64);
      // jsPDF's font family lookup is case-sensitive; use the same family string that was
      // registered by the UI (the lower-case key is only for case-insensitive lookup).
      doc.addFont(font.fileName, font.family, 'normal');
    }
  }

  /**
   * Registers each character's glyph ID in `jsPDF`'s TrueType subsetter (`glyIdsUsed`, `toUnicode`,
   * and `Unicode.widths`) and returns the 4-hex-digit big-endian glyph string `<GGGG...>`.
   * If a combining mark (such as a cantillation mark in a font that only has Niqqud glyphs)
   * has `gid === 0`, we omit `.notdef` (`0000`) from the visual `TJ` hex string so `meta.toUnicode[0]`
   * is never overwritten. The surrounding `/ActualText` preserves logical-order Unicode text,
   * including combining marks that are not available as visible glyphs in the selected font.
   */
  /**
   * A cluster as TJ items with its marks POSITIONED over the letter.
   * jsPDF applies no OpenType mark attachment (GPOS), so marks were drawn
   * wherever the font's default origin put them — nikkud and teamim off
   * their letters in every pointed line. Each mark is centred over the
   * letter's ink using the glyph boxes (shin dot to the right, sin dot and
   * holam to the left), and the pen returns after it. TJ numbers are in
   * thousandths of an em; a positive number moves the pen LEFT.
   */
  private static encodeClusterItems(meta: any, cluster: string): string[] {
    const chars = Array.from(cluster);
    if (chars.length === 1) return [this.registerAndEncodeClusterHex(meta, cluster)];
    const upm: number = meta.head?.unitsPerEm || 1000;
    const k = 1000 / upm;
    const bbox = (gid: number): [number, number] | null => {
      try {
        const g = meta.glyf?.glyphFor?.(gid);
        return g && Number.isFinite(g.xMin) && g.xMax > g.xMin ? [g.xMin * k, g.xMax * k] : null;
      } catch {
        return null;
      }
    };
    const baseGid: number = meta.characterToGlyph(chars[0].charCodeAt(0)) || 0;
    const bW: number = meta.widthOfGlyph(baseGid) || 0;
    const bb = bbox(baseGid) ?? [0, bW];
    const items: string[] = [this.registerAndEncodeClusterHex(meta, chars[0])];
    for (const ch of chars.slice(1)) {
      const code = ch.charCodeAt(0);
      const gid: number = meta.characterToGlyph(code) || 0;
      if (!gid) continue; // the font has no glyph for this mark
      const aW: number = meta.widthOfGlyph(gid) || 0;
      const mb = bbox(gid);
      if (!mb) {
        items.push(this.registerAndEncodeClusterHex(meta, ch));
        continue;
      }
      const mHalf = (mb[1] - mb[0]) / 2;
      const target =
        code === 0x05c1 ? bb[1] - mHalf // shin dot: right
        : code === 0x05c2 || code === 0x05b9 ? bb[0] + mHalf // sin dot, holam: left
        : (bb[0] + bb[1]) / 2; // everything else: centred
      // pen is at bW (after the base); the mark's centre is pen + (m0+m1)/2
      const d = bW + (mb[0] + mb[1]) / 2 - target;
      items.push(String(Math.round(d)));
      items.push(this.registerAndEncodeClusterHex(meta, ch));
      items.push(String(Math.round(aW - d)));
    }
    return items;
  }

  private static registerAndEncodeClusterHex(meta: any, cluster: string): string {
    let hex = '';
    for (let i = 0; i < cluster.length; i++) {
      const ch = cluster.charCodeAt(i);
      const gid: number = meta.characterToGlyph(ch) || 0;
      if (gid === 0 && i > 0) {
        // Unmapped combining mark in this font (e.g. Taamim in Frank Ruhl Libre):
        // do not emit `.notdef` box or overwrite `meta.toUnicode[0]`
        continue;
      }
      meta.toUnicode[gid] = ch;
      if (meta.glyIdsUsed.indexOf(gid) === -1) {
        meta.glyIdsUsed.push(gid);
        const w = Math.round(meta.widthOfGlyph(gid));
        meta.Unicode.widths.push(gid, [w]);
      }
      hex += gid.toString(16).padStart(4, '0');
    }
    return `<${hex || '0000'}>`;
  }

  /**
   * Emits a native vector PDF text object (`BT ... ET`) for a single Hebrew/RTL or mixed token
   * at its exact solved `[xLeft, xRight, yBaseline]` coordinates.
   *
   * Key properties:
   * - RTL clusters are emitted in reverse logical order (leftmost visual cluster first), allowing
   *   the PDF text cursor to advance continuously across the complete word.
   * - The enclosing `/ActualText` preserves logical Hebrew order for compliant PDF text extraction.
   * - Tracking is applied between clusters while the rendered word stays within `[xLeft, xRight]`.
   */
  public static drawNativeWord(
    doc: jsPDF,
    options: {
      text: string;
      xLeft: number;
      xRight: number;
      yBaseline: number;
      pageHeight: number;
      fontFamily: string;
      fontSizePt: number;
      isBold: boolean;
      textColorHex?: string;
      horizontalScalePercent?: number;
      trackingEm?: number;
      invisible?: boolean;
    }
  ): void {
    const cleaned = options.text.replace(/[\u200E\u200F]/g, '');
    if (!cleaned.trim()) return;

    const resolvedFamily = this.resolveEmbeddedFontFamily(options.fontFamily);
    const resolvedStyle: 'normal' | 'bold' = options.isBold ? 'bold' : 'normal';
    doc.setFont(resolvedFamily, resolvedStyle);
    doc.setFontSize(options.fontSizePt);

    const fontObj = (doc as any).internal.getFont();
    const meta = fontObj?.metadata;
    if (!meta || typeof meta.characterToGlyph !== 'function') {
      doc.text(cleaned, options.xRight, options.yBaseline, { align: 'right' });
      return;
    }

    const clusters = this.splitHebrewGraphemeClusters(cleaned);
    if (clusters.length === 0) return;

    // Determine whether this token contains RTL (Hebrew) characters
    const isRtlToken = /[\u0590-\u05FF]/.test(cleaned);
    const tracking1000 = (options.trackingEm ?? 0) * 1000;
    const horizScale =
      options.horizontalScalePercent && options.horizontalScalePercent !== 100
        ? options.horizontalScalePercent
        : 100;
    const scaleRatio = horizScale / 100;

    // Compute 1000-em widths of each cluster's base character
    const clusterWidths1000 = clusters.map(cl => {
      const baseCode = cl.charCodeAt(0);
      const gid = meta.characterToGlyph(baseCode) || 0;
      return meta.widthOfGlyph(gid) || 0;
    });

    const items: string[] = [];
    let startXPt = options.xLeft;

    if (isRtlToken) {
      // Emit visual order from left to right. /ActualText below retains logical RTL reading order.
      const totalW1000 =
        clusterWidths1000.reduce((s, w) => s + w, 0) +
        Math.max(0, clusters.length - 1) * tracking1000;
      startXPt = options.xRight - (totalW1000 / 1000) * options.fontSizePt * scaleRatio;

      for (let i = clusters.length - 1; i >= 0; i--) {
        items.push(...this.encodeClusterItems(meta, clusters[i]));
        if (i > 0 && Math.abs(tracking1000) > 0.5) {
          // Negative TJ adjustments add the requested tracking while the text cursor moves right.
          items.push(String(Math.round(-tracking1000)));
        }
      }
    } else {
      // Pure LTR / numeric token (e.g., `[1]` footnote marker or Latin/Arabic numerals)
      const totalW1000 =
        clusterWidths1000.reduce((s, w) => s + w, 0) +
        Math.max(0, clusters.length - 1) * tracking1000;
      const naturalWPt = (totalW1000 / 1000) * options.fontSizePt * scaleRatio;
      startXPt = options.xRight - naturalWPt;

      for (let i = 0; i < clusters.length; i++) {
        items.push(...this.encodeClusterItems(meta, clusters[i]));
        if (i + 1 < clusters.length && Math.abs(tracking1000) > 0.5) {
          items.push(String(Math.round(-tracking1000)));
        }
      }
    }

    const pdfY = options.pageHeight - options.yBaseline;
    const rgb = this.parseHexColorToRgb01(options.textColorHex || '#121214');
    const tzCmd = horizScale !== 100 ? `${horizScale.toFixed(2)} Tz ` : '';

    // The custom glyph stream is for visual rendering only when RTL is present.
    // Acrobat can map a whole ActualText span to the wrong selection rectangle when glyphs
    // are emitted in visual order. Use an empty ActualText replacement for that stream and
    // a separate, standard jsPDF invisible text object for reliable search/copy/selection.
    // LTR tokens retain their original ActualText behavior.
    const actualTextHex = this.encodeUtf16BeHex(isRtlToken ? '' : cleaned);
    const visualOnlyMarker = isRtlToken ? ' /KeterVisualOnly true' : '';

    const streamCmd = [
      `/Span <</ActualText <${actualTextHex}>${visualOnlyMarker}>> BDC`,
      'BT',
      `/${fontObj.id} ${options.fontSizePt.toFixed(2)} Tf`,
      `${rgb[0].toFixed(3)} ${rgb[1].toFixed(3)} ${rgb[2].toFixed(3)} rg`,
      `${tzCmd}${startXPt.toFixed(2)} ${pdfY.toFixed(2)} Td`,
      options.invisible ? '3 Tr' : '',
      `[${items.join(' ')}] TJ`,
      options.invisible ? '0 Tr' : '',
      'ET',
      'EMC',
    ].join('\n');

    (doc as any).internal.write(streamCmd);

    if (isRtlToken) {
      // Keep the invisible logical text as a plain jsPDF text object. Wrapping it in
      // ActualText marked content caused Acrobat to lose whole-word selection geometry.
      doc.setFont(resolvedFamily, resolvedStyle);
      doc.setFontSize(options.fontSizePt);
      doc.text(cleaned, options.xRight, options.yBaseline, {
        align: 'right',
        renderingMode: 'invisible',
      } as any);

      // jsPDF's renderingMode option writes a persistent PDF text-rendering state (3 Tr).
      // Reset it immediately so later custom glyph streams are not accidentally invisible.
      (doc as any).internal.write('0 Tr');
    }
  }

  public static parseHexColorToRgb01(hex: string): [number, number, number] {
    const clean = (hex || '#121214').replace('#', '').trim();
    const full =
      clean.length === 3
        ? clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
        : clean.padEnd(6, '0').slice(0, 6);
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return [
      Number.isFinite(r) ? r / 255 : 0.07,
      Number.isFinite(g) ? g / 255 : 0.07,
      Number.isFinite(b) ? b / 255 : 0.08,
    ];
  }

  private static encodeUtf16BeHex(str: string): string {
    let hex = 'FEFF';
    for (let i = 0; i < str.length; i++) {
      hex += str.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    }
    return hex;
  }

  /**
   * Parses a generated PDF binary (`Blob` or `ArrayBuffer` or `Uint8Array`) and extracts all
   * native text spans, their Unicode characters (via embedded `/ToUnicode` CMaps), their physical
   * page coordinates (`xStartPt`, `xRightPt`, `yBaselinePt`), font sizes, and bold status.
   *
   * Used by automated tests to prove that exported PDFs contain genuine, selectable, searchable
   * Hebrew text in correct RTL reading order with Nikud, Dibbur HaMatchil bolding, and exact geometry.
   */
  public static async extractTextAndPositionsFromPdf(
    pdfInput: Blob | ArrayBuffer | Uint8Array
  ): Promise<ExtractedPdfDocument> {
    let bytes: Uint8Array;
    if (pdfInput instanceof Uint8Array) {
      bytes = pdfInput;
    } else if (pdfInput instanceof ArrayBuffer) {
      bytes = new Uint8Array(pdfInput);
    } else {
      const ab = await pdfInput.arrayBuffer();
      bytes = new Uint8Array(ab);
    }

    const rawLatin1 = this.uint8ToLatin1(bytes);

    // 1. Parse all indirect PDF objects `N 0 obj ... endobj`
    const objects = new Map<number, { dictText: string; streamBytes?: Uint8Array }>();
    const objRegex = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g;
    let match: RegExpExecArray | null;
    while ((match = objRegex.exec(rawLatin1)) !== null) {
      const objNum = parseInt(match[1], 10);
      const body = match[2];
      const streamIdx = body.indexOf('stream');
      if (streamIdx !== -1) {
        const dictPart = body.slice(0, streamIdx);
        let dataStart = streamIdx + 'stream'.length;
        if (body[dataStart] === '\r' && body[dataStart + 1] === '\n') {
          dataStart += 2;
        } else if (body[dataStart] === '\n' || body[dataStart] === '\r') {
          dataStart += 1;
        }
        const endStreamIdx = body.lastIndexOf('endstream');
        if (endStreamIdx > dataStart) {
          let dataEnd = endStreamIdx;
          if (body[dataEnd - 2] === '\r' && body[dataEnd - 1] === '\n') {
            dataEnd -= 2;
          } else if (body[dataEnd - 1] === '\n' || body[dataEnd - 1] === '\r') {
            dataEnd -= 1;
          }
          const absStart = match.index + match[0].indexOf(body) + dataStart;
          const absEnd = match.index + match[0].indexOf(body) + dataEnd;
          objects.set(objNum, {
            dictText: dictPart,
            streamBytes: bytes.subarray(absStart, absEnd),
          });
          continue;
        }
      }
      objects.set(objNum, { dictText: body });
    }

    const decodeStreamToText = async (objNum: number): Promise<string> => {
      const obj = objects.get(objNum);
      if (!obj || !obj.streamBytes) return '';
      const isFlate = /\/Filter\s*\/FlateDecode/.test(obj.dictText);
      if (!isFlate) {
        return this.uint8ToLatin1(obj.streamBytes);
      }
      const inflated = await this.inflatePdfStream(obj.streamBytes);
      return this.uint8ToLatin1(inflated);
    };

    // 2. Map Font Resource IDs (`/F15`, `/F16`, ...) -> BaseFont, Bold status, ToUnicode CMap, and Widths
    const fontResourceMap = new Map<
      string,
      {
        baseFont: string;
        isBold: boolean;
        toUnicode: Map<number, string>;
        widths: Map<number, number>;
      }
    >();

    // Find font resource mappings like `/F15 17 0 R`
    const fontRefRegex = /\/(F\d+)\s+(\d+)\s+0\s+R/g;
    const fontRefs = new Map<string, number>();
    let fMatch: RegExpExecArray | null;
    while ((fMatch = fontRefRegex.exec(rawLatin1)) !== null) {
      fontRefs.set(fMatch[1], parseInt(fMatch[2], 10));
    }

    for (const [fontResId, fontObjNum] of fontRefs.entries()) {
      const fontObj = objects.get(fontObjNum);
      if (!fontObj) continue;
      const baseFontMatch = fontObj.dictText.match(/\/BaseFont\s*\/([^\s/[\]()<>]+)/);
      const baseFont = baseFontMatch ? baseFontMatch[1] : fontResId;
      const resNum = parseInt(fontResId.replace(/^F/, ''), 10);
      // In KETER_EMBEDDED_FONTS registration order, F15/F17/F19 are Regular and F16/F18/F20 are Bold
      const isBold =
        /bold/i.test(baseFont) || (resNum >= 15 && resNum <= 20 && resNum % 2 === 0);

      const toUnicode = new Map<number, string>();
      const toUniRef = fontObj.dictText.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
      if (toUniRef) {
        const cmapText = await decodeStreamToText(parseInt(toUniRef[1], 10));
        this.parseToUnicodeCMap(cmapText, toUnicode);
      }

      const widths = new Map<number, number>();
      const descRef = fontObj.dictText.match(/\/DescendantFonts\s*\[\s*(\d+)\s+0\s+R/);
      if (descRef) {
        const descObj = objects.get(parseInt(descRef[1], 10));
        if (descObj) {
          this.parseCidWidthsArray(descObj.dictText, widths);
        }
      }

      fontResourceMap.set(fontResId, { baseFont, isBold, toUnicode, widths });
    }

    // 3. Identify all Page objects (`/Type /Page\b`) in document order
    const pageEntries: {
      pageNumber: number;
      pageHeight: number;
      contentObjNums: number[];
      hasFullPageImage: boolean;
    }[] = [];

    for (const [, obj] of objects.entries()) {
      if (!/\/Type\s*\/Page\b/.test(obj.dictText)) continue;
      const mediaBoxMatch = obj.dictText.match(
        /\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/
      );
      const pageHeight = mediaBoxMatch ? parseFloat(mediaBoxMatch[4]) : 680;

      const contentObjNums: number[] = [];
      const arrayContents = obj.dictText.match(/\/Contents\s*\[([\s\S]*?)\]/);
      if (arrayContents) {
        const r = /(\d+)\s+0\s+R/g;
        let cm: RegExpExecArray | null;
        while ((cm = r.exec(arrayContents[1])) !== null) {
          contentObjNums.push(parseInt(cm[1], 10));
        }
      } else {
        const singleContent = obj.dictText.match(/\/Contents\s+(\d+)\s+0\s+R/);
        if (singleContent) {
          contentObjNums.push(parseInt(singleContent[1], 10));
        }
      }

      pageEntries.push({
        pageNumber: pageEntries.length + 1,
        pageHeight,
        contentObjNums,
        hasFullPageImage: false,
      });
    }

    // 4. Extract text spans and vector path operations from each page's content stream
    const extractedPages: ExtractedPdfPageContent[] = [];

    for (const pageEntry of pageEntries) {
      let combinedStream = '';
      for (const cObjNum of pageEntry.contentObjNums) {
        combinedStream += (await decodeStreamToText(cObjNum)) + '\n';
      }

      const hasFullPageRasterImage = /\/I\d+\s+Do\b/.test(combinedStream);
      const vectorPathOps =
        combinedStream.match(/\b(m|l|c|re|S|s|f|F|f\*|B|b)\b/g)?.length ?? 0;

      const spans: ExtractedPdfTextSpan[] = [];
      const btRegex = /(?:\bActualText\s*<([0-9a-fA-F]+)>[\s\S]{0,80}?)?BT\b([\s\S]*?)ET\b/g;
      let btMatch: RegExpExecArray | null;

      while ((btMatch = btRegex.exec(combinedStream)) !== null) {
        const actualTextHex = btMatch[1] || '';
        const btBody = btMatch[2];
        const markedContentPrefix = btMatch[0].split(/\bBT\b/, 1)[0];
        // The custom RTL glyph stream is visual-only; its paired invisible jsPDF text object
        // is the authoritative searchable/copyable text span.
        if (/\/KeterVisualOnly\s+true\b/.test(markedContentPrefix)) continue;
        const hasVisualRtlOrder = /\/KeterRTLVisualOrder\s+true\b/.test(markedContentPrefix);
        const tfMatch = btBody.match(/\/(F\d+)\s+([\d.]+)\s+Tf/);
        const fontResId = tfMatch ? tfMatch[1] : 'F15';
        const fontSizePt = tfMatch ? parseFloat(tfMatch[2]) : 12;

        const tzMatch = btBody.match(/([\d.]+)\s+Tz/);
        const scaleRatio = tzMatch ? parseFloat(tzMatch[1]) / 100 : 1.0;

        const tdMatch = btBody.match(/([\d.-]+)\s+([\d.-]+)\s+Td/);
        const xStartPt = tdMatch ? parseFloat(tdMatch[1]) : 0;
        const pdfY = tdMatch ? parseFloat(tdMatch[2]) : 0;
        const yBaselinePt = Number((pageEntry.pageHeight - pdfY).toFixed(2));

        const fontInfo = fontResourceMap.get(fontResId);
        const toUnicode = fontInfo?.toUnicode ?? new Map<number, string>();
        const widths = fontInfo?.widths ?? new Map<number, number>();
        const isBoldFont = Boolean(fontInfo?.isBold);

        let decodedText = '';
        let firstBaseGid: number | null = null;
        const decodedGids: number[] = [];

        // Decode either `[...] TJ` or `<...> Tj` or `(...) Tj`
        const tjArrayMatch = btBody.match(/\[([\s\S]*?)\]\s*TJ/);
        if (tjArrayMatch) {
          const hexParts = tjArrayMatch[1].match(/<([0-9a-fA-F]+)>/g) ?? [];
          for (const hp of hexParts) {
            const cleanHex = hp.slice(1, -1);
            for (let i = 0; i + 4 <= cleanHex.length; i += 4) {
              const gid = parseInt(cleanHex.slice(i, i + 4), 16);
              if (firstBaseGid === null) firstBaseGid = gid;
              decodedGids.push(gid);
              const uniChar = toUnicode.get(gid);
              if (uniChar) decodedText += uniChar;
            }
          }
        } else {
          const tjHexMatch = btBody.match(/<([0-9a-fA-F]+)>\s*Tj/);
          if (tjHexMatch) {
            const cleanHex = tjHexMatch[1];
            for (let i = 0; i + 4 <= cleanHex.length; i += 4) {
              const gid = parseInt(cleanHex.slice(i, i + 4), 16);
              if (firstBaseGid === null) firstBaseGid = gid;
              decodedGids.push(gid);
              const uniChar = toUnicode.get(gid);
              if (uniChar) decodedText += uniChar;
            }
          }
        }

        // If the `/Span <</ActualText <FEFF...>>> BDC` attribute contains additional combining marks
        // (such as Biblical Taamim cantillation marks in a font whose cmap only maps Niqqud),
        // decode the UTF-16BE `/ActualText` string when its base letters match `decodedText`.
        if (actualTextHex && actualTextHex.toUpperCase().startsWith('FEFF')) {
          let actualDecoded = '';
          for (let i = 4; i + 4 <= actualTextHex.length; i += 4) {
            actualDecoded += String.fromCharCode(parseInt(actualTextHex.slice(i, i + 4), 16));
          }
          if (actualDecoded) {
            const strippedActual = this.stripNikud(actualDecoded);
            const strippedGlyphText = this.stripNikud(decodedText);
            const reversedGlyphText = Array.from(strippedGlyphText).reverse().join('\n');
            if (
              strippedActual === strippedGlyphText ||
              strippedActual === reversedGlyphText
            ) {
              decodedText = actualDecoded;
            }
          }
        }

        if (!decodedText) continue;

        const firstW1000 =
          firstBaseGid !== null ? (widths.get(firstBaseGid) ?? 500) : 500;
        const isRtl = /[\u0590-\u05FF]/.test(decodedText);
        const totalGlyphWidth1000 = decodedGids.reduce(
          (acc, g) => acc + (widths.get(g) ?? 500),
          0
        );
        // TJ numbers shift the text cursor by their negative value in thousandths of an em.
        const tjAdjustments = tjArrayMatch
          ? (tjArrayMatch[1].replace(/<[^>]*>/g, ' ').match(/[-+]?(?:\d+\.?\d*|\.\d+)/g) ?? [])
              .map(Number)
          : [];
        const totalAdvance1000 =
          totalGlyphWidth1000 - tjAdjustments.reduce((acc, n) => acc + n, 0);
        const measuredWidth1000 = isRtl && !hasVisualRtlOrder && tjArrayMatch
          ? firstW1000
          : totalAdvance1000;
        const xRightPt = Number(
          (xStartPt + (measuredWidth1000 / 1000) * fontSizePt * scaleRatio).toFixed(2)
        );

        spans.push({
          pageNumber: pageEntry.pageNumber,
          text: decodedText,
          strippedText: this.stripNikud(decodedText),
          fontResourceId: fontResId,
          isBoldFont,
          fontSizePt,
          xStartPt: Number(xStartPt.toFixed(2)),
          xRightPt,
          yBaselinePt,
        });
      }

      // Group spans into visual lines by yBaselinePt (within 1.5pt tolerance) and sort RTL (right-to-left)
      const lineGroups: {
        yBaselinePt: number;
        spans: ExtractedPdfTextSpan[];
      }[] = [];

      for (const sp of spans) {
        const existing = lineGroups.find(
          g => Math.abs(g.yBaselinePt - sp.yBaselinePt) <= 1.5
        );
        if (existing) {
          existing.spans.push(sp);
        } else {
          lineGroups.push({ yBaselinePt: sp.yBaselinePt, spans: [sp] });
        }
      }

      // Sort lines top-to-bottom (increasing yBaselinePt)
      lineGroups.sort((a, b) => a.yBaselinePt - b.yBaselinePt);

      const formattedLines = lineGroups.map(g => {
        // Within each horizontal lineband, sort spans right-to-left (`xRightPt` descending) for Hebrew RTL reading order
        const sortedSpans = [...g.spans].sort((a, b) => b.xRightPt - a.xRightPt);
        const lineText = sortedSpans.map(s => s.text).join(' ');
        return {
          yBaselinePt: g.yBaselinePt,
          spans: sortedSpans,
          lineText,
          strippedLineText: this.stripNikud(lineText),
        };
      });

      const pageFullText = formattedLines.map(l => l.lineText).join('\n');
      extractedPages.push({
        pageNumber: pageEntry.pageNumber,
        spans,
        lines: formattedLines,
        fullText: pageFullText,
        strippedFullText: this.stripNikud(pageFullText),
        vectorPathOpsCount: vectorPathOps,
        hasFullPageRasterImage,
      });
    }

    const fullText = extractedPages.map(p => p.fullText).join('\n\n');
    return {
      pageCount: extractedPages.length,
      pages: extractedPages,
      fullText,
      strippedFullText: this.stripNikud(fullText),
    };
  }

  private static parseToUnicodeCMap(cmapText: string, target: Map<number, string>): void {
    // Parse `<GGGG> <UUUU...>` entries inside beginbfchar ... endbfchar
    const bfcharBlocks = cmapText.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? [];
    for (const block of bfcharBlocks) {
      const pairRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
      let pm: RegExpExecArray | null;
      while ((pm = pairRegex.exec(block)) !== null) {
        const gid = parseInt(pm[1], 16);
        const uniHex = pm[2];
        let chars = '';
        for (let i = 0; i + 4 <= uniHex.length; i += 4) {
          chars += String.fromCharCode(parseInt(uniHex.slice(i, i + 4), 16));
        }
        if (chars) target.set(gid, chars);
      }
    }

    // Also parse `<GGGG1> <GGGG2> <UUUU>` ranges inside beginbfrange ... endbfrange
    const bfrangeBlocks = cmapText.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? [];
    for (const block of bfrangeBlocks) {
      const rangeRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
      let rm: RegExpExecArray | null;
      while ((rm = rangeRegex.exec(block)) !== null) {
        const startGid = parseInt(rm[1], 16);
        const endGid = parseInt(rm[2], 16);
        const startUni = parseInt(rm[3], 16);
        for (let g = startGid; g <= endGid; g++) {
          target.set(g, String.fromCharCode(startUni + (g - startGid)));
        }
      }
    }
  }

  private static parseCidWidthsArray(dictText: string, target: Map<number, number>): void {
    const wMatch = dictText.match(/\/W\s*\[([\s\S]*?)\]\s*(?:\/|>>)/);
    if (!wMatch) return;
    const body = wMatch[1];
    const pairRegex = /(\d+)\s*\[\s*([\d.]+)\s*\]/g;
    let pm: RegExpExecArray | null;
    while ((pm = pairRegex.exec(body)) !== null) {
      target.set(parseInt(pm[1], 10), parseFloat(pm[2]));
    }
  }

  private static uint8ToLatin1(bytes: Uint8Array): string {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return out;
  }

  private static async inflatePdfStream(compressed: Uint8Array): Promise<Uint8Array> {
    if (typeof process !== 'undefined' && process.versions?.node) {
      const zlib = await import('zlib');
      try {
        return new Uint8Array(zlib.inflateSync(compressed));
      } catch {
        try {
          return new Uint8Array(zlib.inflateRawSync(compressed));
        } catch {
          return compressed;
        }
      }
    }
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(compressed as unknown as BufferSource);
        writer.close();
        const res = new Response(ds.readable);
        const ab = await res.arrayBuffer();
        return new Uint8Array(ab);
      } catch {
        return compressed;
      }
    }
    return compressed;
  }
}
