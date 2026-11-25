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
  /** Page text width ÷ Gemara size. Re-fitted (55, was 48) once the
   *  Gemara + Rashi + Tosafot block took the print's 66% of the page
   *  (VILNA_PRINT below): one amud per page again, a narrow Gemara line
   *  about 7 words (the print: 6–7). */
  textBlockEm: 55,
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

/**
 * The Vilna page's HORIZONTAL proportions, measured on the user's
 * reference pages (Berakhot 2a–4a, Moznaim re-set of the Vilna; the text
 * positions read from the PDFs' own text layer, not from images):
 *  - main block (Gemara + Rashi + Tosafot) 419pt on a 635pt page, centred
 *    (the side space holds the margin columns: Ein Mishpat, Masoret
 *    HaShas, Torah Or, Gilyon — 63pt wide, 8.5pt from the block);
 *  - in the block: Gemara 170pt (narrow), Rashi / Tosafot 110pt each,
 *    gutters 14.2pt — 40.6% / 26.3% / 3.4%;
 *  - a narrow Gemara line holds 6–7 words, a commentary line about 5.
 * Ratios, so they hold for any page size.
 */
export const VILNA_PRINT = {
  blockOfPageWidth: 419 / 635,
  gemaraOfBlock: 170 / 419,
  flankOfBlock: 110 / 419,
  gutterOfBlock: 14.2 / 419,
  marginalWidthOfPage: 63 / 635,
  marginalGapOfPage: 8.5 / 635,
} as const;
