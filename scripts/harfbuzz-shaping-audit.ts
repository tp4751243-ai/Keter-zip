import { HarfBuzzRealShaper } from '../src/engine/harfbuzz-real-shaper';
import { PdfNativeTextEngine, KETER_EMBEDDED_FONTS } from '../src/engine/pdf-native-text-engine';

const samples = [
  { label: 'Hebrew without marks', text: 'שלום' },
  { label: 'Hebrew with niqqud', text: 'שָׁלוֹם' },
  { label: 'Hebrew with cantillation', text: 'בְּרֵאשִׁ֖ית' },
];

async function main(): Promise<void> {
  const results: Array<Record<string, unknown>> = [];

  // Audit every bundled face independently: regular and bold files can have different cmap coverage.
  for (const fontSpec of KETER_EMBEDDED_FONTS) {
    const family = fontSpec.fontFamily;
    const binary = await PdfNativeTextEngine.getFontBinary(family, fontSpec.fontStyle);
    for (const sample of samples) {
      const shaped = HarfBuzzRealShaper.shape(sample.text, binary, 'rtl');
      const finitePositions = shaped.glyphs.every(glyph =>
        [glyph.xAdvance, glyph.yAdvance, glyph.xOffset, glyph.yOffset].every(Number.isFinite)
      );
      const validGlyphIds = shaped.glyphs.every(glyph =>
        Number.isInteger(glyph.glyphId) && glyph.glyphId >= 0
      );
      // A shaping smoke test must prove that the font's OpenType mark positioning
      // was actually applied, not merely that HarfBuzz returned a list of glyph IDs.
      // Niqqud and cantillation samples should include at least one positioned glyph
      // in fonts that support these marks; missing glyphs are reported separately below.
      const hasPositionedMark = sample.label === 'Hebrew without marks' ||
        shaped.glyphs.some(glyph => glyph.xOffset !== 0 || glyph.yOffset !== 0);
      const missingGlyphEntries = shaped.glyphs.filter(glyph => glyph.glyphId === 0);
      const missingGlyphs = missingGlyphEntries.length;
      // HarfBuzz clusters are UTF-8 byte offsets. Report the corresponding source
      // character(s) so a failed font-coverage check identifies the exact missing mark.
      const utf8 = new TextEncoder().encode(sample.text);
      const missingGlyphClusters = [...new Set(missingGlyphEntries.map(glyph => glyph.cluster))];
      const glyphDiagnostics = shaped.glyphs.map((glyph, index) => {
        const cluster = Math.max(0, Math.min(glyph.cluster, utf8.length));
        let start = cluster;
        while (start > 0 && (utf8[start] & 0xc0) === 0x80) start--;
        let end = start + 1;
        while (end < utf8.length && (utf8[end] & 0xc0) === 0x80) end++;
        const sourceCharacter = new TextDecoder().decode(utf8.slice(start, end));
        return {
          index,
          glyphId: glyph.glyphId,
          cluster: glyph.cluster,
          sourceCharacter,
          sourceCodePoint: Array.from(sourceCharacter).map(ch =>
            'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
          ).join(' '),
          xAdvance: glyph.xAdvance,
          yAdvance: glyph.yAdvance,
          xOffset: glyph.xOffset,
          yOffset: glyph.yOffset,
        };
      });
      const missingSourceCharacters = missingGlyphClusters.map(cluster => {
        let end = cluster;
        while (end < utf8.length && (utf8[end] & 0xc0) === 0x80) end++;
        let start = cluster;
        while (start > 0 && (utf8[start] & 0xc0) === 0x80) start--;
        let charEnd = start + 1;
        while (charEnd < utf8.length && (utf8[charEnd] & 0xc0) === 0x80) charEnd++;
        return { cluster, character: new TextDecoder().decode(utf8.slice(start, charEnd)), codePoint: 'U+' + Array.from(new TextDecoder().decode(utf8.slice(start, charEnd))).map(ch => ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' U+') };
      });
      // For a failing sequence, remove one Unicode code point at a time and reshape.
      // This is diagnostic only: clusters may combine a base and several marks, so this
      // narrows down contributing code points without claiming exact causality.
      const removalDiagnostics = missingGlyphs > 0
        ? Array.from(sample.text).map((character, charIndex) => {
            const reducedText = Array.from(sample.text).filter((_, index) => index !== charIndex).join('');
            const reduced = HarfBuzzRealShaper.shape(reducedText, binary, 'rtl');
            return {
              removedCharacter: character,
              removedCodePoint: 'U+' + character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'),
              charIndex,
              remainingText: reducedText,
              missingGlyphsAfterRemoval: reduced.glyphs.filter(glyph => glyph.glyphId === 0).length,
            };
          })
        : [];

      // Probe each combining mark present in a failing sample by itself.
      // This distinguishes basic font coverage from failures that occur only in context.
      const isolatedMarkProbes = missingGlyphs > 0
        ? [...new Set(Array.from(sample.text).filter(character => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint >= 0x0591 && codePoint <= 0x05C7;
          }))].map(character => {
            const isolated = HarfBuzzRealShaper.shape(character, binary, 'rtl');
            return {
              character,
              codePoint: 'U+' + (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0'),
              glyphIds: isolated.glyphs.map(glyph => glyph.glyphId),
              missingGlyphs: isolated.glyphs.filter(glyph => glyph.glyphId === 0).length,
            };
          })
        : [];

      const passed = shaped.glyphs.length > 0 &&
        shaped.unitsPerEm > 0 &&
        Number.isFinite(shaped.xAdvance) &&
        Number.isFinite(shaped.yAdvance) &&
        finitePositions &&
        validGlyphIds &&
        hasPositionedMark &&
        // GID 0 is .notdef: reporting it is not enough; it must fail the audit.
        // Otherwise a font can silently omit Hebrew marks and still produce a green check.
        missingGlyphs === 0;

      results.push({
        fontFamily: family,
        fontStyle: fontSpec.fontStyle,
        fontFile: fontSpec.vfsFileName,
        sample: sample.label,
        glyphCount: shaped.glyphs.length,
        unitsPerEm: shaped.unitsPerEm,
        finitePositions,
        validGlyphIds,
        hasPositionedMark,
        missingGlyphs,
        missingSourceCharacters,
        glyphDiagnostics,
        removalDiagnostics,
        isolatedMarkProbes,
        missingGlyphFailure: missingGlyphs > 0,
        passed,
      });
    }
  }

  const failed = results.filter(result => result.passed !== true);
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed, results }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
