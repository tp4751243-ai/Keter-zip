/**
 * Layout training T3 — checks for the right-bound Hebrew book rules
 * (from the hebrew-book-typesetter skill). Run:
 *   npx tsx scripts/training/book-rules-test.ts
 * Exit code 1 on any failure.
 */
import { checkPunctuation, applyFixes } from '../../src/engine/text-proofing';
import { formatBodyFolioLabel } from '../../src/engine/vilna-shas';
import { textBlockLeft, textBlockRight } from '../../src/types/typesetter';
import { computeSpineWidthMm, printPageCount } from '../../src/engine/book-production';
import { fontLacksTeamim, wordHasTeamim } from '../../src/engine/font-analyzer';
import { hebrewNumeral } from '../../src/engine/hebrew-numerals';
import { hebrewLetterNumber } from '../../src/engine/layout-extras';
import { PdfExporter } from '../../src/engine/pdf-exporter';
import { rtlPlacementOrder } from '../../src/engine/bidi-runs';
import { TypesetterEngine } from '../../src/engine/typesetter-core';
import type { ContentUnit, PageTypesetResult } from '../../src/types/typesetter';
import { jsPDF } from 'jspdf';

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

// Cover: spine = leaves × caliper (skill example: 212 pp, 0.1 mm → 10.6 mm).
check('spine 212 pages × 0.1mm caliper = 10.6mm', computeSpineWidthMm({ pages: 212, caliperMm: 0.1 }) === 10.6, String(computeSpineWidthMm({ pages: 212, caliperMm: 0.1 })));
check('odd page count rounds up to even', printPageCount(211) === 212);
check('signature multiple 16: 212 → 224', printPageCount(212, 16) === 224);

// Teamim: whole words with cantillation leave fonts without the marks.
check('בְּרֵאשִׁ֖ית has teamim', wordHasTeamim('בְּרֵאשִׁ֖ית'));
check('בְּרֵאשִׁית (nikkud only) has no teamim', !wordHasTeamim('בְּרֵאשִׁית'));
check('Frank Ruhl Libre lacks teamim (measured)', fontLacksTeamim('Frank Ruhl Libre'));
check('Noto Serif Hebrew has teamim (measured)', !fontLacksTeamim('Noto Serif Hebrew'));

// Hebrew numerals: one implementation, customary forms.
check('paseq ׀ uses the teamim font', wordHasTeamim('׀'));
for (const [n, want] of [[1, 'א׳'], [15, 'ט״ו'], [16, 'ט״ז'], [115, 'קט״ו'], [116, 'קט״ז'], [270, 'ע״ר'], [272, 'ער״ב'], [275, 'ער״ה'],
  [298, 'רח״צ'], [304, 'ד״ש'], [344, 'שד״מ'], [500, 'ת״ק'], [704, 'תש״ד'], [744, 'תשד״מ'], [1001, 'א׳א']] as const) {
  check(`gematria ${n} = ${want}`, hebrewNumeral(n) === want, hebrewNumeral(n));
}
check('folio, daf and paragraph numbers agree (115)', PdfExporter.toHebrewGematria(115) === 'קט״ו' && hebrewLetterNumber(115) === 'קטו');

// Mixed Hebrew / Latin word order (UAX #9 at word level).
const ord = (t: string) => rtlPlacementOrder(t.split(' ')).map(i => t.split(' ')[i]).join(' ');
check('Latin run placed left-to-right', ord('ראה Isaiah 40:1 שם') === 'ראה 40:1 Isaiah שם', ord('ראה Isaiah 40:1 שם'));
check('a number between Hebrew words stays in RTL flow', ord('דף 12 עמוד 3') === 'דף 12 עמוד 3');
check('two Latin words', ord('כמו New York כאן') === 'כמו York New כאן');
check('pure Hebrew unchanged', ord('בראשית ברא אלהים') === 'בראשית ברא אלהים');
{
  const eng = new TypesetterEngine(12);
  const lines = eng.typesetContentUnit({ id: 'b', role: 'regular_paragraph', rawText: 'ראה Isaiah 40:1 שם', styleName: '', order: 0, hierarchyLevel: 0 } as ContentUnit, 400, 16, false);
  const page = { pageIndex: 0, pageNumber: 1, pageNumberHebrew: 'א', headerTitle: '', layoutType: 'single_column', geometry: { pageWidth: 500, pageHeight: 700, marginTop: 40, marginBottom: 40, marginInside: 40, marginOutside: 40, isVerso: false },
    sourceLines: lines.map(l => ({ ...l, yBaseline: 20, xLeft: 0, xRight: 420 })), rashiLines: [], tosafotLines: [], footnoteLines: [], knee: {} } as unknown as PageTypesetResult;
  const ws = PdfExporter.buildPageRenderPlan(page).lines[0]?.words ?? [];
  const x = (t: string) => ws.find(w => w.text === t)?.xLeft ?? NaN;
  check('print plan draws "Isaiah 40:1" left to right', x('Isaiah') < x('40:1') && x('40:1') < x('ראה') && x('שם') < x('Isaiah'), ws.map(w => `${w.text}@${w.xLeft.toFixed(0)}`).join(' '));
}

// Print boxes: TrimBox = the page, BleedBox = page + bleed (press-ready PDF).
{
  const b = 8.5;
  const doc = new jsPDF({ unit: 'pt', format: [420 + 2 * b, 595 + 2 * b] });
  PdfExporter.applyPrintBoxes(doc, b);
  const out = doc.output();
  check('PDF carries /TrimBox = page inside the bleed', /\/TrimBox \[8\.5 8\.5 428\.5 603\.5\]/.test(out), (out.match(/\/TrimBox \[[^\]]*\]/) ?? ['none'])[0]);
  check('PDF carries /BleedBox = the sheet', /\/BleedBox \[0\.? 0\.? 437\.? 612\.?\]/.test(out), (out.match(/\/BleedBox \[[^\]]*\]/) ?? ['none'])[0]);
  const screen = new jsPDF({ unit: 'pt', format: [420, 595] });
  PdfExporter.applyPrintBoxes(screen, 0);
  check('screen PDF (no bleed) has no print boxes', !/TrimBox/.test(screen.output()));
}

console.log(fails ? `${fails} FAILED` : 'all book rules pass');
process.exit(fails ? 1 : 0);
