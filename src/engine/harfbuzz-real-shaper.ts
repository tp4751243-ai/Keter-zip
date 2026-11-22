/**
 * Thin, testable adapter around the real harfbuzzjs OpenType shaper.
 *
 * Unlike HarfBuzzShaperEngine's legacy layout estimator, this module returns actual
 * font glyph IDs and HarfBuzz positioning values. Values remain in font units so
 * callers can scale them using unitsPerEm without losing precision.
 *
 * This adapter is intentionally separate from PDF emission until the PDF writer can
 * consume shaped GIDs safely while retaining its independent logical-text layer.
 */
import * as hb from 'harfbuzzjs';

export type HarfBuzzDirection = 'rtl' | 'ltr';

export interface HarfBuzzPositionedGlyph {
  /** Glyph ID in the supplied font, not a Unicode code point. */
  glyphId: number;
  /** UTF-8 byte cluster offset reported by HarfBuzz. */
  cluster: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
}

export interface HarfBuzzShapeResult {
  text: string;
  direction: HarfBuzzDirection;
  unitsPerEm: number;
  glyphs: HarfBuzzPositionedGlyph[];
  /** Sum of HarfBuzz advances, in font units. */
  xAdvance: number;
  yAdvance: number;
}

export class HarfBuzzRealShaper {
  /**
   * Resolve the same font binary the PDF exporter embeds, then shape with that exact file.
   * This prevents the common failure mode where layout is shaped with one face but the PDF
   * embeds a different face under the same family name.
   */
  public static async shapeRegisteredFont(
    text: string,
    fontFamily: string,
    direction: HarfBuzzDirection = 'rtl',
    features?: Parameters<typeof hb.shape>[2]
  ): Promise<HarfBuzzShapeResult> {
    const { PdfNativeTextEngine } = await import('./pdf-native-text-engine');
    const fontData = await PdfNativeTextEngine.getFontBinary(fontFamily);
    return this.shape(text, fontData, direction, features);
  }

  /**
   * Shape text using the actual OpenType tables in fontData (GSUB/GPOS, mark
   * attachment, ligatures and script-specific substitutions when supported by the font).
   * The caller must supply the exact font file intended for rendering/export.
   */
  public static shape(
    text: string,
    fontData: ArrayBuffer,
    direction: HarfBuzzDirection = 'rtl',
    features?: Parameters<typeof hb.shape>[2]
  ): HarfBuzzShapeResult {
    if (!text) {
      return { text, direction, unitsPerEm: 1000, glyphs: [], xAdvance: 0, yAdvance: 0 };
    }
    if (!(fontData instanceof ArrayBuffer) || fontData.byteLength < 12) {
      throw new Error('HarfBuzz shaping requires the actual TTF/OTF font binary.');
    }

    const blob = new hb.Blob(fontData);
    const face = new hb.Face(blob);
    const font = new hb.Font(face);
    const buffer = new hb.Buffer();

    try {
      buffer.addText(text);
      buffer.guessSegmentProperties();
      buffer.setDirection(direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
      hb.shape(font, buffer, features);

      const infos = buffer.getGlyphInfos();
      const positions = buffer.getGlyphPositions();
      const count = Math.min(infos.length, positions.length);
      const glyphs: HarfBuzzPositionedGlyph[] = [];
      let xAdvance = 0;
      let yAdvance = 0;

      for (let i = 0; i < count; i++) {
        const position = positions[i];
        glyphs.push({
          glyphId: infos[i].codepoint,
          cluster: infos[i].cluster,
          xAdvance: position.xAdvance,
          yAdvance: position.yAdvance,
          xOffset: position.xOffset,
          yOffset: position.yOffset,
        });
        xAdvance += position.xAdvance;
        yAdvance += position.yAdvance;
      }

      return {
        text,
        direction,
        unitsPerEm: face.upem || 1000,
        glyphs,
        xAdvance,
        yAdvance,
      };
    } finally {
      // harfbuzzjs 1.6.x manages these WASM wrappers without public destroy() methods.
      // Keep cleanup compatible with the package's published TypeScript API.
    }
  }
}
