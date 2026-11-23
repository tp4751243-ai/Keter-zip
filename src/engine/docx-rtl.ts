/**
 * Layout training T4 — Word-safe Hebrew (RTL) runs for the .docx exporter.
 *
 * Port of the run-splitting rules in the `hebrew-document-generator`
 * skill's scripts/docx_rtl.py (MIT license), which its authors checked
 * against Microsoft Word's own rendering:
 *
 * 1. A paragraph with any Hebrew gets <w:bidi/> and NO jc="right": w:jc is
 *    logical, so "right" on an RTL paragraph means the line END, which
 *    Word draws on the visual LEFT. (Centre and justify are safe.)
 * 2. Each line is split into runs by script. Hebrew runs, and neutral
 *    stretches that resolve to RTL, carry <w:rtl/>; Latin and digit runs
 *    never do, so dates, codes and amounts are not reversed.
 * 3. Every run sets w:cs + w:szCs, and bold / italic also set w:bCs /
 *    w:iCs — Word applies w:b / w:sz only to Latin text.
 * 4. Never insert Unicode directional marks or isolates: Word draws them
 *    as boxes in some Hebrew fonts. They are stripped from exported text.
 */

const NUM_SEPARATORS = ',./:-+';
const NUM_AFFIXES = '%₪$€#°';
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const DIRECTIONAL_MARKS = /[‎‏‪-‮⁦-⁩؜]/g;

type Kind = 'R' | 'L' | 'EN' | null;

/** true = RTL letter, false = LTR letter or ASCII digit, null = neutral (incl. nikkud). */
function strong(ch: string): boolean | null {
  if (/[֐-׿יִ-ﭏ؀-ۿ]/.test(ch)) {
    return /[֑-ׇ]/.test(ch) ? null : true; // nikkud / teamim are NSM → neutral
  }
  if (/[0-9]/.test(ch)) return false;
  if (/\p{L}/u.test(ch)) return false;
  return null;
}

export function stripDirectionalMarks(text: string): string {
  return text.replace(DIRECTIONAL_MARKS, '');
}

/** RTL base for any line with Hebrew; LTR for Latin/digits only; RTL when all neutral. */
export function paraIsRtl(text: string): boolean {
  let sawStrong = false;
  for (const ch of text) {
    const s = strong(ch);
    if (s === true) return true;
    if (s === false) sawStrong = true;
  }
  return !sawStrong;
}

/** Split a line into [segment, isRtl] runs (see the module doc). */
export function splitByScript(text: string): Array<[string, boolean]> {
  const chars = Array.from(text);
  const n = chars.length;
  const paraRtl = paraIsRtl(text);
  const kinds: Kind[] = chars.map(ch => {
    const s = strong(ch);
    return s === null ? null : s ? 'R' : /[0-9]/.test(ch) ? 'EN' : 'L';
  });
  for (let i = 1; i < n - 1; i++) {
    if (kinds[i] === null && NUM_SEPARATORS.includes(chars[i]) && kinds[i - 1] === 'EN' && kinds[i + 1] === 'EN') {
      kinds[i] = 'EN';
    }
  }
  for (let i = 0; i < n; ) {
    if (kinds[i] === null && NUM_AFFIXES.includes(chars[i])) {
      let j = i;
      while (j < n && kinds[j] === null && NUM_AFFIXES.includes(chars[j])) j++;
      if ((i > 0 && kinds[i - 1] === 'EN') || (j < n && kinds[j] === 'EN')) for (let m = i; m < j; m++) kinds[m] = 'EN';
      i = j;
    } else i++;
  }
  for (let i = 0; i < n - 1; i++) {
    if (kinds[i] === null && '+-'.includes(chars[i]) && kinds[i + 1] === 'EN' && (i === 0 || /\s/.test(chars[i - 1]) || '(:'.includes(chars[i - 1]))) {
      kinds[i] = 'EN';
    }
  }
  let last: Kind = paraRtl ? 'R' : 'L';
  for (let i = 0; i < n; i++) {
    if (kinds[i] === 'L' || kinds[i] === 'R') last = kinds[i];
    else if (kinds[i] === 'EN' && last === 'L') kinds[i] = 'L';
  }
  const para: Kind = paraRtl ? 'R' : 'L';
  const asStrong = (k: Kind): Kind => (k === 'EN' ? 'R' : k);
  const stack: Array<[number, string]> = [];
  for (let i = 0; i < n; i++) {
    if (kinds[i] !== null) continue;
    const ch = chars[i];
    if (BRACKETS[ch]) stack.push([i, BRACKETS[ch]]);
    else if (stack.length && ch === stack[stack.length - 1][1]) {
      const [start] = stack.pop()!;
      const inside = new Set<Kind>();
      for (let m = start + 1; m < i; m++) if (kinds[m] !== null) inside.add(asStrong(kinds[m]));
      let side: Kind | undefined;
      if (inside.has(para)) side = para;
      else if (inside.size) {
        side = para;
        for (let m = start - 1; m >= 0; m--) if (kinds[m] !== null) { side = asStrong(kinds[m]); break; }
      }
      if (side) kinds[start] = kinds[i] = side;
    }
  }
  for (let i = 0; i < n; ) {
    if (kinds[i] !== null) { i++; continue; }
    let j = i;
    while (j < n && kinds[j] === null) j++;
    const before: Kind = i > 0 ? (kinds[i - 1] === 'EN' ? 'R' : kinds[i - 1]) : para;
    const after: Kind = j < n ? (kinds[j] === 'EN' ? 'R' : kinds[j]) : para;
    const fill = before === after ? before : para;
    for (let m = i; m < j; m++) kinds[m] = fill;
    i = j;
  }
  const segs: Array<[string, boolean]> = [];
  let buf = '';
  let bufRtl: boolean | null = null;
  chars.forEach((ch, k) => {
    const rtl = kinds[k] === 'R';
    if (bufRtl === null || rtl === bufRtl) {
      buf += ch;
      bufRtl = rtl;
    } else {
      segs.push([buf, bufRtl]);
      buf = ch;
      bufRtl = rtl;
    }
  });
  if (buf) segs.push([buf, bufRtl ?? paraRtl]);
  return shiftBoundarySpaces(mergeListMarker(segs));
}

/** A leading "2." list marker joins the Hebrew run after it (else Word shows ".2"). */
function mergeListMarker(segs: Array<[string, boolean]>): Array<[string, boolean]> {
  if (segs.length >= 2 && segs[0][1] === false && /^\d{1,2}$/.test(segs[0][0].trim()) && segs[1][1] === true && segs[1][0].startsWith('.')) {
    return [[segs[0][0] + segs[1][0], true], ...segs.slice(2)];
  }
  return segs;
}

/** Word trims a trailing space at a direction boundary; move it into the RTL run. */
function shiftBoundarySpaces(segs: Array<[string, boolean]>): Array<[string, boolean]> {
  const out = segs.map(s => [...s] as [string, boolean]);
  for (let i = 0; i < out.length - 1; i++) {
    const [seg, rtl] = out[i];
    if (rtl === false && out[i + 1][1] === true && seg.endsWith(' ')) {
      const stripped = seg.replace(/ +$/, '');
      out[i][0] = stripped;
      out[i + 1][0] = seg.slice(stripped.length) + out[i + 1][0];
    }
  }
  return out.filter(s => s[0]);
}
