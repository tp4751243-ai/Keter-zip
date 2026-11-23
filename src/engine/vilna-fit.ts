/**
 * Layout training T2.5 — Vilna proportions, FITTED (not guessed).
 *
 * Measured on 8 Vilna reference PDFs (training/vilna/reference-measurements.json):
 *  - commentary size ÷ Gemara size  = 0.818
 *  - marginal size ÷ Gemara size    = 0.562   (used by vilna-marginalia.ts)
 *  - head size ÷ Gemara size        = 1.67    (vilna-header uses 1.6)
 *
 * Fitted with the scoring harness on Berakhot 2a–3b (Sefaria corpus,
 * real Frank Ruhl Libre / Noto Rashi metrics): the text-block width in
 * Gemara ems and the line spacing were searched for the best scorecard
 * (page count closest to Vilna, pages filled to the last line, even
 * spacing). Point sizes inside the reference PDFs do not transfer across
 * typefaces (the Vilna face is narrower than Frank Ruhl at the same size),
 * so the block width is fitted on OUR fonts, not copied from the PDFs.
 * Re-fit: scripts/training/vilna-harness.ts --tune em=…,lead=…,com=… --json
 */
export const VILNA_FIT = {
  /** Text-block width ÷ Gemara size. */
  textBlockEm: 48,
  /** Commentary (Rashi, Tosafot) size ÷ Gemara size. */
  commentaryToGemara: 0.82,
  /** Line spacing of the Gemara and the commentaries. */
  lineSpacing: 1.2,
} as const;

/** Gemara and commentary sizes for a text block of `contentWidthPt`. */
export function vilnaSizesFor(contentWidthPt: number): { gemaraPt: number; commentaryPt: number } {
  const gemaraPt = Math.round((contentWidthPt / VILNA_FIT.textBlockEm) * 10) / 10;
  return { gemaraPt, commentaryPt: Math.round(gemaraPt * VILNA_FIT.commentaryToGemara * 10) / 10 };
}
