/**
 * Hebrew numerals (gematria) for folios, pasuk / seif numbers and lists —
 * ONE implementation for every engine (there were four, three of them
 * wrong past 100: 115 came out קיה instead of קטו).
 *
 * Rules:
 *  - 1–400 by letter values; 500–900 stack ת (תק, תר … תתק).
 *  - 15 / 16 are טו / טז — also inside larger numbers (115 קטו, 216 רטז).
 *  - Customary avoidances in page and siman numbers:
 *      270 ער, 272 ערב, 275 ערה (not רע…), 298 רחצ (not רצח),
 *      304 דש (not שד), 344 / 744 …שדמ (not …שמד).
 *    Year-style forms such as תש״ד / תר״ע are left as they are.
 *  - Thousands: the thousands digit, then ׳ (e.g. 1001 → א׳א).
 */
const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

function below1000(n: number): string {
  let h = Math.floor(n / 100);
  let out = '';
  while (h > 4) {
    out += 'ת';
    h -= 4;
  }
  out += HUNDREDS[h];
  const rem = n % 100;
  if (rem === 15) out += 'טו';
  else if (rem === 16) out += 'טז';
  else out += TENS[Math.floor(rem / 10)] + ONES[rem % 10];
  if (n >= 200 && n < 300) {
    out = out.replace(/^רע(?=[בה]?$)/, 'ער').replace(/^רצח$/, 'רחצ');
  }
  if (n === 304) out = 'דש';
  out = out.replace(/שמד$/, 'שדמ');
  return out;
}

/** Bare letters, no punctuation: 1 → א, 15 → טו, 115 → קטו, 1001 → א׳א. */
export function hebrewNumeralBare(num: number): string {
  const n = Math.floor(num);
  if (!Number.isFinite(n) || n < 1) return '';
  if (n < 1000) return below1000(n);
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  return `${below1000(th)}׳${rest ? below1000(rest) : ''}`;
}

/** With geresh / gershayim: 1 → א׳, 15 → ט״ו, 115 → קט״ו. */
export function hebrewNumeral(num: number): string {
  const bare = hebrewNumeralBare(num);
  if (!bare) return '';
  if (bare.includes('׳')) return bare;
  return bare.length > 1 ? `${bare.slice(0, -1)}״${bare.slice(-1)}` : `${bare}׳`;
}
