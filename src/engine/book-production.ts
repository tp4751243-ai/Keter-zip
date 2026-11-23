/**
 * Layout training T3.5 — print-shop arithmetic for a right-bound Hebrew
 * book (hebrew-book-typesetter skill, scripts/cover_size.py, MIT).
 *
 *  - A book has an even number of pages; a shop that prints in
 *    signatures needs the count rounded up to its multiple (4/8/16).
 *  - Spine = LEAVES × paper thickness (a leaf is two pages) + any board
 *    allowance the shop specifies. Multiplying PAGES doubles the spine.
 *  - The paper thickness (caliper) comes from the shop — never guessed.
 *  - Laid flat, a Hebrew cover reads [front] [spine] [back] left to right
 *    (the front cover is the LEFT panel), the reverse of an English book.
 */

/** Page count the printer will bind: even, then up to the signature multiple. */
export function printPageCount(pages: number, signatureMultiple = 2): number {
  let n = Math.max(2, Math.ceil(pages));
  if (n % 2) n++;
  const m = Math.max(2, Math.floor(signatureMultiple));
  return Math.ceil(n / m) * m;
}

/** Spine width in mm from the interior page count and the shop's caliper (mm per leaf). */
export function computeSpineWidthMm(opts: {
  pages: number;
  caliperMm: number;
  signatureMultiple?: number;
  coverBoardMm?: number;
}): number {
  const pages = printPageCount(opts.pages, opts.signatureMultiple ?? 2);
  const leaves = pages / 2;
  return Math.round((leaves * opts.caliperMm + (opts.coverBoardMm ?? 0)) * 10) / 10;
}
