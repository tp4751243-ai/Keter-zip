/**
 * Layout training T11 — word order of mixed Hebrew / Latin lines.
 *
 * Every renderer places the words of a line from the right edge leftward
 * in logical order — right for Hebrew, wrong for an embedded Latin
 * phrase: "ראה Isaiah 40:1 שם" drew as "שם 40:1 Isaiah ראה".
 *
 * Following the Unicode Bidirectional Algorithm (UAX #9) at word level
 * for an RTL paragraph:
 *  - a word with a Latin (strong L) letter is LTR; a word with a Hebrew
 *    letter is RTL; digits and punctuation are weak / neutral;
 *  - weak and neutral words BETWEEN two LTR words take the LTR direction
 *    (rules W7 / N1), so "Isaiah 40:1" is one LTR run, while a number
 *    standing between Hebrew words stays in the RTL flow;
 *  - an LTR run is placed left-to-right, i.e. its words reversed in the
 *    right-to-left placement order.
 * Characters inside a word are ordered by the text engine itself.
 */

const STRONG_L = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
const STRONG_R = /[֐-׿יִ-ﭏ]/;

export type WordDir = 'L' | 'R' | 'N';

export function wordDirection(text: string): WordDir {
  if (STRONG_R.test(text)) return 'R';
  if (STRONG_L.test(text)) return 'L';
  return 'N';
}

/**
 * Placement order for an RTL line: the indices of `texts` in the order
 * they are placed from the right edge leftward.
 */
export function rtlPlacementOrder(texts: string[]): number[] {
  const n = texts.length;
  const order = texts.map((_, i) => i);
  const dirs = texts.map(wordDirection);
  let i = 0;
  while (i < n) {
    if (dirs[i] !== 'L') {
      i++;
      continue;
    }
    // extend to the last L reachable without crossing an R word
    let j = i;
    let k = i + 1;
    while (k < n && dirs[k] !== 'R') {
      if (dirs[k] === 'L') j = k;
      k++;
    }
    if (j > i) {
      const run = order.slice(i, j + 1).reverse();
      order.splice(i, j - i + 1, ...run);
    }
    i = j + 1;
  }
  return order;
}

/** Reorder any array of word-like items for RTL placement. */
export function inRtlPlacementOrder<T extends { text: string }>(words: T[]): T[] {
  if (!words.some(w => STRONG_L.test(w.text))) return words;
  return rtlPlacementOrder(words.map(w => w.text)).map(i => words[i]);
}
