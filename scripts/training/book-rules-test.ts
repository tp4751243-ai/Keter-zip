/**
 * Layout training T3 — checks for the right-bound Hebrew book rules
 * (from the hebrew-book-typesetter skill). Run:
 *   npx tsx scripts/training/book-rules-test.ts
 * Exit code 1 on any failure.
 */
import { checkPunctuation, applyFixes } from '../../src/engine/text-proofing';
import { formatBodyFolioLabel } from '../../src/engine/vilna-shas';
import { textBlockLeft, textBlockRight } from '../../src/types/typesetter';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

// Quote marks: gershayim / geresh inside abbreviations, quotations untouched.
const quoteCases: Array<[string, string]> = [
  ['פירש רש"י וכו\'', 'פירש רש״י וכו׳'],
  ['רַשִׁ"י אמר', 'רַשִׁ״י אמר'],
  ['ו"שלום" אמר', 'ו"שלום" אמר'],
  ["אמר 'לא' שם", "אמר 'לא' שם"],
  ['דכתיב "בשכבך ובקומך"', 'דכתיב "בשכבך ובקומך"'],
  ["ג'ירפה ורמב”ם", 'ג׳ירפה ורמב״ם'],
  ["דף ד' ע\"א", 'דף ד׳ ע״א'],
];
for (const [input, want] of quoteCases) {
  const issues = checkPunctuation(input).filter(i => i.suggestion === '״' || i.suggestion === '׳');
  const got = applyFixes(input, issues);
  check(`quotes: ${input}`, got === want, got);
}

// Folios: Hebrew letters, טו/טז, no geresh/gershayim by default.
const folio = (n: number, gershayim = false) =>
  formatBodyFolioLabel(n - 1, 'single_column', gershayim ? { folioNumbering: { gershayim: true } as never } : null).folioDisplay;
for (const [n, want] of [[1, 'א'], [15, 'טו'], [16, 'טז'], [118, 'קיח'], [300, 'ש']] as const) {
  check(`folio ${n}`, folio(n) === want, folio(n));
}
check('folio 15 with gershayim on', folio(15, true) === 'ט״ו', folio(15, true));

// Mirrored margins: recto (left-hand page) has the outside margin on its left.
const g = { pageWidth: 400, pageHeight: 600, marginTop: 40, marginBottom: 40, marginInside: 50, marginOutside: 30, isVerso: false };
check('recto text block starts at the outside margin', textBlockLeft({ ...g, textLeftPt: 30 }) === 30 && textBlockRight({ ...g, textLeftPt: 30 }) === 350);
check('verso text block starts at the inside margin', textBlockLeft({ ...g, textLeftPt: 50 }) === 50 && textBlockRight({ ...g, textLeftPt: 50 }) === 370);

console.log(fails ? `${fails} FAILED` : 'all book rules pass');
process.exit(fails ? 1 : 0);
