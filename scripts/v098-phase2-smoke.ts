/**
 * KETER-TYPE v0.9.8 Phase 2 — .docx parser & Hebrew semantic extractor
 * smoke test.
 *
 * Run from the repo root:  npx tsx scripts/v098-phase2-smoke.ts
 *
 * Verifies (against synthetic .docx files built in-memory):
 *  §1  Dirty Word XML is normalised: rFonts / RGB colour / random
 *      spacing are stripped, bold + size survive (strip unit test +
 *      end-to-end import).
 *  §2  Section headers: centred bold short line → heading; `סעיף א`
 *      → siman (+ seifLetter). `דף`/`משנה` stay owned by the v0.9.7
 *      Shas classifier (page_element / main_source) — no regression.
 *  §3  Citations: (ברכות ב.) parenthesised spans are tagged isCitation;
 *      small-type runs (< 0.8 × body size) are tagged the same way.
 *  §4  Rema glosses (Shulchan Aruch context): `הגה:` … up to the next
 *      period is tagged isRemaGloss + unit.hasRemaGloss.
 *  §5  Dibbur tokenisation: explicit ד"ה, bold lead, delimiter (first
 *      2–12 words), and source-match all produce a DibburNode
 *      { id, rawText, normalizedText, targetAnchorId, confidence }
 *      WITHOUT changing the v0.9.7 dibburHamatchil / review-queue
 *      behaviour.
 *  §6  Footnotes bind by sequential ID to the EXACT character offset
 *      in the parent paragraph (new) as well as the word index (old).
 *  §7  Nikud sanitisation: orphan marks dropped, duplicate marks
 *      collapsed, pointed text otherwise unchanged (nikud preserved).
 *  §8  Per-role typography defaults use ONLY bundled fonts; Vilna /
 *      Guttman / Drugulin are honestly reported NOT bundled.
 *  §9  One import path: the secondary import (mergeSecondaryImport)
 *      carries the new fields through unchanged.
 *  §10 Per-file preview stats (analyzeImportedDocx).
 *  §11 version is 0.9.8.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { DOMParser } from '@xmldom/xmldom';
// The docx importer runs under tsx (Node), where DOMParser / Node are
// not globals — install the @xmldom shims before importing it.
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
(globalThis as unknown as { Node: unknown }).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DocxImporter, flagUncertainMatches } from '../src/engine/docx-importer';
import {
  stripDirtyRunProperties,
  sanitizeNikudText,
  findCitationSpans,
  findRemaGlossSpans,
  tokenizeDibbur,
  analyzeImportedDocx,
  roleTypographyDefault,
  BUNDLED_FONT_AVAILABILITY,
} from '../src/engine/docx-semantics';
import { mergeSecondaryImport } from '../src/engine/secondary-docx-import';
import type { ContentUnit } from '../src/types/typesetter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// --- minimal .docx builder (same pattern as the v0.9.7 smoke) ---------
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface RunOpts {
  b?: boolean;
  sz?: number; // half-points, as in Word w:sz
  color?: string;
  rFonts?: string;
  spacing?: number;
}
function runXml(text: string, opts: RunOpts = {}): string {
  const pr: string[] = [];
  if (opts.rFonts) pr.push(`<w:rFonts w:ascii="${opts.rFonts}" w:hAnsi="${opts.rFonts}" w:cs="${opts.rFonts}"/>`);
  if (opts.color) pr.push(`<w:color w:val="${opts.color}"/>`);
  if (opts.spacing !== undefined) pr.push(`<w:spacing w:val="${opts.spacing}"/>`);
  if (opts.sz !== undefined) pr.push(`<w:sz w:val="${opts.sz}"/>`);
  if (opts.b) pr.push('<w:b/>');
  return `<w:r>${pr.length > 0 ? `<w:rPr>${pr.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
function footnoteRefXml(id: string): string {
  return `<w:r><w:rPr><w:footnoteRef/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
}
interface ParaOpts {
  style?: string;
  jc?: string;
}
function paraXml(runs: string, opts: ParaOpts = {}): string {
  const pPr: string[] = [];
  if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.jc) pPr.push(`<w:jc w:val="${opts.jc}"/>`);
  return `<w:p>${pPr.length > 0 ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${runs}</w:p>`;
}
async function buildDocx(paras: string[], footnotes?: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}</w:body></w:document>`
  );
  if (footnotes !== undefined) {
    zip.file(
      'word/footnotes.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${footnotes}</w:footnotes>`
    );
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}
const footnoteXml = (id: string, text: string): string =>
  `<w:footnote w:id="${id}"><w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:footnote>`;

const GEMARA_TEXT =
  'משנה: מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות רבן גמליאל אומר עד שיעלה עמוד השחר.';

async function main(): Promise<void> {
  console.log('v098-phase2-smoke: docx parser & Hebrew semantic extractor');

  // ── §1 — dirty Word XML normalisation ──────────────────────────
  {
    const dom = new DOMParser().parseFromString(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:spacing w:after="480" w:line="360"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="FF0000"/><w:spacing w:val="120"/><w:b/><w:sz w:val="28"/></w:rPr><w:t>מילה</w:t></w:r></w:p></w:body></w:document>`,
      'application/xml'
    ) as unknown as Document;
    const res = stripDirtyRunProperties(dom);
    const xml = (dom as unknown as { toString(): string }).toString?.() ?? '';
    check('§1 strip removes rFonts', !xml.includes('rFonts'), `removed=${res.removedRunProps}`);
    check('§1 strip removes RGB colour', !xml.includes('FF0000'));
    check('§1 strip removes run spacing', !xml.includes('<w:spacing w:val="120"'));
    check('§1 strip removes paragraph spacing', !xml.includes('w:after="480"'));
    check('§1 strip keeps bold + size', xml.includes('<w:b/>') && xml.includes('w:val="28"'));
  }

  // ── Gemara file ────────────────────────────────────────────────
  const gemaraParas = [
    paraXml(runXml('פרק ראשון: מאימתי'), { style: 'Heading 1' }),
    paraXml(
      runXml('משנה: מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן ', { sz: 24 }) +
        runXml('(ברכות ב.)', { sz: 24 }) +
        runXml(' עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות. ', { sz: 24 }) +
        runXml('(שם)', { sz: 16 }) +
        runXml(' רבן גמליאל אומר עד שיעלה עמוד השחר.', { sz: 24, rFonts: 'Arial', color: 'FF0000', spacing: 120 })
    ),
    paraXml(runXml('דף ב ע״א', { b: true }), { jc: 'center' }),
    paraXml(runXml('פתיחה למסכת', { b: true }), { jc: 'center' }),
    paraXml(runXml('סעיף א: יתגבר כארי לעמוד בבוקר לעבודת בוראו.', {})),
    paraXml(
      runXml('אבג ', {}) + runXml('דהו', {}) + footnoteRefXml('1'),
      {}
    ),
  ];
  const gemara = await DocxImporter.importDocx(
    await buildDocx(gemaraParas, footnoteXml('1', 'הערה ראשונה על הגמרא')),
    'gemara.docx'
  );
  const byRole = (role: string) => gemara.units.filter(u => u.role === role);
  const gemaraMain = gemara.units.find(u => u.role === 'main_source' && u.rawText.includes('מאימתי קורין'));
  check('§2 Heading 1 פרק → chapter', byRole('chapter').length >= 1);
  check('§2 centred bold daf line stays page_element (v0.9.7)', byRole('page_element').some(u => u.rawText.includes('דף ב')));
  check('§2 centred bold short line → heading', byRole('heading').some(u => u.rawText === 'פתיחה למסכת'));
  const seif = gemara.units.find(u => u.rawText.startsWith('סעיף א'));
  check('§2 סעיף א → siman + seifLetter', seif?.role === 'siman' && seif?.seifLetter === 'א', `role=${seif?.role} seif=${seif?.seifLetter}`);
  check('§2 dirty run still imports (text present, no Arial font stored)', !!gemaraMain && (gemaraMain.textRuns ?? []).some(r => r.text.includes('רבן גמליאל')) && !(gemaraMain.textRuns ?? []).some(r => r.fontFamily === 'Arial'));

  // ── §3 — citations ────────────────────────────────────────────
  {
    check('§3 citation spans found in text', findCitationSpans('ראה (ברכות ב.) וכן [שם] לענין זה').length === 2);
    check('§3 plain aside is NOT a citation', findCitationSpans('הסבר (במילים אחרות) על הענין').length === 0);
    const citRuns = (gemaraMain?.textRuns ?? []).filter(r => r.isCitation);
    check('§3 (ברכות ב.) run tagged isCitation', citRuns.some(r => r.text.includes('ברכות')));
    check('§3 small-type (שם) run tagged isCitation', citRuns.some(r => r.text.includes('שם')));
    const smallRun = (gemaraMain?.textRuns ?? []).find(r => r.text.includes('שם'));
    check('§3 small run kept its Word size (8pt)', smallRun?.fontSizePt === 8, `size=${smallRun?.fontSizePt}`);
  }

  // ── §6 — footnotes by ID + exact char offset ──────────────────
  {
    const fn = gemara.units.find(u => u.role === 'footnote');
    check('§6 footnote unit exists, bound to parent', !!fn && fn.footnoteAnchorUnitId !== undefined, `text=${fn?.rawText}`);
    // Parent text: "אבג דהו" — anchor sits after 7 chars ("אבג " = 4, "דהו" = 3).
    check('§6 anchor char offset is exact (7)', fn?.footnoteAnchorCharOffset === 7, `offset=${fn?.footnoteAnchorCharOffset}`);
    check('§6 anchor word index still present (old behaviour)', fn?.footnoteAnchorWordIndex === 1, `wordIdx=${fn?.footnoteAnchorWordIndex}`);
    const parentRun = gemara.units
      .find(u => u.id === fn?.footnoteAnchorUnitId)
      ?.textRuns?.find(r => r.footnoteMarker !== undefined);
    check('§6 run carries footnoteMarker + char offset', parentRun?.footnoteAnchorCharOffset === 7);
  }

  // ── Rashi file: dibbur cases ──────────────────────────────────
  const rashiParas = [
    // P1 — bold lead. The 'רש"י' label is INSIDE the bold run: the
    // importer strips it from the bold lead, and the text prefix gives
    // the primary_comment role (the hub retag is not used here).
    paraXml(runXml('רש"י מאימתי', { b: true }) + runXml(' קורין את שמע בערבית פירוש מאיזה זמן קורין ולא קתני משעה שהכוכבים יוצאים.', {})),
    paraXml(runXml('ד"ה מאימתי קורין: פירוש נוסף על המשנה ודברי רבי אליעזר.', {})),
    paraXml(runXml('רש"י משעה שהכהנים נכנסים — פירוש שלישי ארוך בלי נקודות ובלי דלימיטר מוקדם כלל רק טקסט רץ ארוך מאד.', {})),
    paraXml(runXml('רש"י משעה שהכהנים נכנסים לאכול בתרומתן פירוש על המשנה ודברי רבי אליעזר וחכמים אומרים עד חצות והסבר ארוך.', {})),
  ];
  const rashi = await DocxImporter.importDocx(await buildDocx(rashiParas), 'rashi.docx');
  const rashiUnits = rashi.units.filter(u => u.role === 'primary_comment');
  check('§5 four Rashi units classified primary_comment', rashiUnits.length === 4, `got=${rashiUnits.length}`);
  const [boldLead, explicit, delimiter, sourceMatch] = rashiUnits;
  check('§5 bold lead → dibburHamatchil kept', boldLead?.dibburHamatchil === 'מאימתי', `got=${boldLead?.dibburHamatchil}`);
  check('§5 bold lead → DibburNode bold-lead 0.9', boldLead?.dibburNode?.method === 'bold-lead' && boldLead?.dibburNode?.confidence === 0.9, `method=${boldLead?.dibburNode?.method}`);
  check('§5 ד"ה prefix → DibburNode explicit-dalet-he 0.95', explicit?.dibburNode?.method === 'explicit-dalet-he' && explicit?.dibburNode?.confidence === 0.95, `method=${explicit?.dibburNode?.method} raw=${explicit?.dibburNode?.rawText}`);
  check('§5 delimiter (—) → DibburNode delimiter, 2–12 words', delimiter?.dibburNode?.method === 'delimiter', `method=${delimiter?.dibburNode?.method} raw=${delimiter?.dibburNode?.rawText}`);
  check('§5 DibburNode has id + normalizedText', !!boldLead?.dibburNode?.id && !!boldLead?.dibburNode?.normalizedText);
  // Source-match needs Gemara units present in the SAME import: re-import
  // Rashi together with the Gemara source text.
  const combined = await DocxImporter.importDocx(
    await buildDocx([
      paraXml(runXml(GEMARA_TEXT, { sz: 24 })),
      paraXml(runXml('רש"י משעה שהכהנים נכנסים לאכול בתרומתן פירוש על המשנה ודברי רבי אליעזר וחכמים אומרים עד חצות והסבר ארוך.', {})),
    ]),
    'rashi.docx'
  );
  const srcMatchUnit = combined.units.find(u => u.role === 'primary_comment');
  check('§5 source-match → DibburNode source-match 0.8 + target', srcMatchUnit?.dibburNode?.method === 'source-match' && srcMatchUnit?.dibburNode?.confidence === 0.8 && !!srcMatchUnit?.dibburNode?.targetAnchorId, `method=${srcMatchUnit?.dibburNode?.method} target=${srcMatchUnit?.dibburNode?.targetAnchorId}`);
  check('§5 old dibburHamatchil field unchanged by tokenisation', !!srcMatchUnit?.dibburHamatchil);

  // ── §5b — tokenizeDibbur direct cases ─────────────────────────
  {
    const t1 = tokenizeDibbur('בד"ה מאימתי קורין: פירוש.', 'u-1', {});
    check('§5 tokenize: בד"ה prefix → explicit', t1?.method === 'explicit-dalet-he' && t1?.rawText === 'מאימתי קורין');
    const t2 = tokenizeDibbur('מאימתי קורין את שמע בערבית פירוש ארוך מאד בלי סימן.', 'u-2', {});
    check('§5 tokenize: no signal → null (never guessed)', t2 === null);
    const t3 = tokenizeDibbur('מילה אחת בלבד פירוש קצר מאד בלי דלימיטר.', 'u-3', { boldLead: 'מילה אחת' });
    check('§5 tokenize: bold lead → bold-lead', t3?.method === 'bold-lead');
  }

  // ── §4 — Rema glosses ─────────────────────────────────────────
  {
    check('§4 Rema span found in SA text', findRemaGlossSpans('יתגבר כארי. הגה: ועל כל פנים לא יאחר זמן התפילה. שיויתי ה׳ לנגדי תמיד.').length === 1);
    const saParas = [
      paraXml(runXml('סימן א', {})),
      paraXml(runXml('יתגבר כארי לעמוד בבוקר לעבודת בוראו, שיהא הוא מעורר השחר. הגה: ועל כל פנים לא יאחר זמן התפילה שהציבור מתפללין. שיויתי ה׳ לנגדי תמיד הוא כלל גדול בתורה.', { sz: 24 })),
    ];
    const sa = await DocxImporter.importDocx(await buildDocx(saParas), 'shulchan-aruch.docx');
    const saMain = sa.units.find(u => u.role === 'main_source');
    check('§4 SA main text hasRemaGloss', saMain?.hasRemaGloss === true);
    const remaRuns = (saMain?.textRuns ?? []).filter(r => r.isRemaGloss);
    check('§4 Rema runs tagged isRemaGloss', remaRuns.length >= 1 && remaRuns.some(r => r.text.includes('הגה:')));
    check('§4 gloss stops at the next period', remaRuns.every(r => !r.text.includes('שיויתי')));
    // Non-SA file: הגה: must NOT be tagged.
    const other = await DocxImporter.importDocx(
      await buildDocx([paraXml(runXml('דברי תורה. הגה: הערה צדדית כאן. סוף דבר.', { sz: 24 }))]),
      'mussar.docx'
    );
    const otherMain = other.units.find(u => u.role === 'main_source');
    check('§4 non-SA file: no Rema tagging', otherMain?.hasRemaGloss !== true && !(otherMain?.textRuns ?? []).some(r => r.isRemaGloss));
  }

  // ── §7 — nikud sanitisation ───────────────────────────────────
  {
    check('§7 pointed text unchanged', sanitizeNikudText('מֵאֵימָתַי קוֹרִין') === 'מֵאֵימָתַי קוֹרִין');
    check('§7 orphan leading mark dropped', sanitizeNikudText('\u05B0מֵאֵימָתַי') === 'מֵאֵימָתַי');
    check('§7 duplicate mark collapsed', sanitizeNikudText('מ\u05BC\u05BCאֵימָתַי') === 'מ\u05BCאֵימָתַי');
    check('§7 plain text unchanged', sanitizeNikudText('שלום עולם') === 'שלום עולם');
  }

  // ── §8 — per-role typography (bundled fonts only) ─────────────
  {
    check('§8 main source → Frank Ruhl Libre 14.5', roleTypographyDefault('main_source').fontFamily === 'Frank Ruhl Libre' && roleTypographyDefault('main_source').fontSizePt === 14.5);
    check('§8 Rashi/Tosafot → Noto Rashi Hebrew 10.5', roleTypographyDefault('primary_comment').fontFamily === 'Noto Rashi Hebrew' && roleTypographyDefault('secondary_comment').fontSizePt === 10.5);
    check('§8 headers → David Libre', roleTypographyDefault('chapter').fontFamily === 'David Libre');
    const usedFamilies = new Set(
      (['main_source', 'verse', 'primary_comment', 'secondary_comment', 'tertiary_comment', 'chapter', 'heading', 'siman', 'footnote', 'dibbur_hamatchil', 'regular_paragraph'] as const).map(
        r => roleTypographyDefault(r).fontFamily
      )
    );
    const allBundled = [...usedFamilies].every(f => BUNDLED_FONT_AVAILABILITY[f]?.bundled === true);
    check('§8 every default font is a bundled font', allBundled, `families=${[...usedFamilies].join(', ')}`);
    check('§8 Vilna/Guttman honestly NOT bundled', BUNDLED_FONT_AVAILABILITY['Vilna / Guttman Vilna']?.bundled === false);
    check('§8 Drugulin honestly NOT bundled', BUNDLED_FONT_AVAILABILITY['Drugulin']?.bundled === false);
    check('§8 Guttman Rashi honestly NOT bundled', BUNDLED_FONT_AVAILABILITY['Guttman Rashi']?.bundled === false);
  }

  // ── §9 — one import path (secondary import keeps new fields) ──
  {
    const merged = mergeSecondaryImport(gemara.units, gemara.links, rashi, { targetTier: 'first_commentary' });
    const added = merged.addedUnits.find(u => u.dibburNode);
    check('§9 secondary merge keeps DibburNode', !!added, `added=${merged.addedUnits.length}`);
    const uncertain = flagUncertainMatches([
      { linkId: 'l1', sourceUnitId: 's1', commentaryUnitId: 'c1', dibburHamatchil: 'x', isUserLocked: false, confidenceScore: 0.95, sourceSnippet: '', commentarySnippet: '', commentaryType: 'Rashi' },
      { linkId: 'l2', sourceUnitId: 's1', commentaryUnitId: 'c2', dibburHamatchil: 'y', isUserLocked: false, confidenceScore: 0.5, sourceSnippet: '', commentarySnippet: '', commentaryType: 'Rashi' },
    ]);
    check('§9 review queue: <0.8 held, ≥0.8 passes', uncertain.length === 1 && uncertain[0].linkId === 'l2');
  }

  // ── §10 — per-file preview stats ──────────────────────────────
  {
    const stats = analyzeImportedDocx(gemara.units);
    check('§10 word count > 0', stats.wordCount > 20, `words=${stats.wordCount}`);
    check('§10 perek markers ≥ 1', stats.perekMarkers >= 1, `perek=${stats.perekMarkers}`);
    check('§10 daf markers ≥ 1', stats.dafMarkers >= 1, `daf=${stats.dafMarkers}`);
    check('§10 dibbur count matches units', stats.dibburCount === gemara.units.filter(u => u.dibburHamatchil).length);
    check('§10 footnote count = 1', stats.footnoteCount === 1, `fn=${stats.footnoteCount}`);
  }

  // ── §11 — version ─────────────────────────────────────────────
  check('§11 version is 0.9.8', pkg.version === '0.9.8', `version=${pkg.version}`);

  console.log(`\nv098-phase2-smoke: ${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('v098-phase2-smoke crashed:', err);
  process.exit(1);
});
