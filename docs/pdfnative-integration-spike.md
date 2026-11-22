# pdfnative integration spike — Keter

Status: **isolated evaluation only; not wired into the production export path**

## Why this is not yet a drop-in replacement

Keter's current exporter is `src/engine/pdf-native-text-engine.ts`. It uses jsPDF and custom code for embedded Hebrew fonts, Hebrew grapheme clusters, glyph placement, `/ActualText`, and text extraction tests. The existing exporter is geometry-aware: it is intended to draw the already-computed Keter page layout, not lay out paragraphs again.

pdfnative is MIT-licensed and TypeScript-based, but its public high-level API (`buildPDFBytes` / `buildDocumentPDFBytes`) is document/layout-oriented. Replacing Keter's exporter with that API would risk recomputing text layout and changing the existing page geometry. Its own README also documents that visually correct output for combining-mark scripts may still produce reordered or garbled extracted text in some PDF viewers/extractors. That is directly relevant to Hebrew niqqud and ta'amim and means the library must pass a focused test before adoption.

## Integration constraint

Do not replace the current exporter or alter the default export path until a candidate passes all gates below. Keep this work on the experimental branch and do not merge to `main` without explicit approval.

## Required proof-of-concept

1. Use one real Keter page with Gemara, Rashi/Tosafot, Hebrew niqqud and ta'amim, using the same font files as the current exporter.
2. Preserve the existing page size, each text run's coordinates, baseline, font size, weight, and reading order. Do not run paragraph reflow or repaginate.
3. Produce a vector PDF with embedded fonts and valid Unicode mapping; test whether pdfnative can expose a low-level drawing path that accepts precomputed glyph positions. If it cannot, stop rather than approximating Keter's layout.
4. Compare the resulting PDF with the current exporter: visual overlay, mark placement, page count, text selection, search, copy/paste, and extracted Unicode in both Adobe Acrobat and Edge.
5. Include regression cases for U+0591–U+05C7, Hebrew final letters, mixed Hebrew/Latin, punctuation, bold dibbur hamatchil, and multiple commentary columns.

## Pass/fail gates

- **Geometry:** no reflow; text baselines and positions remain within the agreed tolerance.
- **Visual:** niqqud/ta'amim remain attached to the correct base letters.
- **Semantics:** search, selection, and copy/paste preserve logical Hebrew text in Acrobat and Edge.
- **Safety:** existing jsPDF exporter remains the default until all gates pass.
- **Licensing:** pdfnative is MIT, but verify all bundled fonts and transitive assets separately before distribution.

## Current conclusion

pdfnative is worth testing, but the public high-level API is not yet proven suitable as a drop-in backend for Keter's pre-positioned glyphs. The most important next step is to verify whether its lower-level public APIs support drawing already-shaped glyph IDs at absolute coordinates while also preserving a correct Unicode mapping. Do not add it to runtime dependencies merely to test it; first build the isolated proof-of-concept and run it against the actual Hebrew fixture.
