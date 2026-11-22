/**
 * v0.9.2 Part B — page labels, shared by the (single) page navigator.
 *
 * Moved verbatim from the deleted PagesPanel (v0.7.0): `folioLabel` turns
 * a paginated page into its Hebrew + Latin folio ("ב׳" / "1b", or "2a" for
 * Vilna Shas where numbering starts at Daf Bet) and `spreadPairs` groups
 * pages into RTL spreads [right, left] (right = Amud Rishon). The
 * navigator's page list is now the only page-navigation surface, and it
 * shows the Latin folio next to each page via `folioLabel`; the spread
 * pairing is kept for the v0.7.0 smoke checks and any future spread view.
 */
import { computeTalmudDafAmud, folioLatin, folioLatinTalmud } from './vilna-shas';
import type { BookLayoutType, PageTypesetResult } from '../types/typesetter';

export function folioLabel(
  page: PageTypesetResult,
  layoutType?: BookLayoutType
): { he: string; latin: string } {
  if (page.isTitlePage) {
    return { he: 'שער', latin: 'Title' };
  }
  const he = page.folioDisplay || page.pageNumberHebrew;
  if (typeof page.bodyPageIndex === 'number' && layoutType === 'rav_text') {
    const startDaf = page.designSettings?.pageElements?.folioNumbering?.startDaf ?? 2;
    const startAmud = page.designSettings?.pageElements?.folioNumbering?.startAmud ?? 'a';
    const { latin } = computeTalmudDafAmud(page.bodyPageIndex, startDaf, startAmud);
    return { he, latin };
  }
  const latin =
    layoutType === 'rav_text'
      ? folioLatinTalmud(page.pageNumber)
      : folioLatin(page.pageNumber);
  return { he, latin };
}

/** Spread pairs for RTL books: [rightPage, leftPage] (right = Amud Rishon). */
export function spreadPairs(
  pages: PageTypesetResult[]
): Array<[PageTypesetResult | null, PageTypesetResult | null]> {
  const pairs: Array<[PageTypesetResult | null, PageTypesetResult | null]> =
    [];
  for (let i = 0; i < pages.length; i += 2) {
    pairs.push([pages[i] ?? null, pages[i + 1] ?? null]);
  }
  return pairs;
}
