/**
 * Layout training T4 — Word export RTL rules (hebrew-document-generator
 * skill). Run: npx tsx scripts/training/word-rtl-test.ts
 *  1. splitByScript matches the skill's reference splitter on every case
 *     (training/word/rtl-expected.json was produced by its docx_rtl.py).
 *  2. A real Keter .docx export obeys the rules: no jc="right" on RTL
 *     paragraphs, <w:rtl/> only on Hebrew runs, w:bCs with w:b, no
 *     directional marks.
 */
import * as fs from 'node:fs';
import JSZip from 'jszip';
import { splitByScript } from '../../src/engine/docx-rtl';
import { exportWord } from '../../src/engine/word-exporter';
import type { ContentUnit } from '../../src/types/typesetter';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

const cases: string[] = JSON.parse(fs.readFileSync('training/word/rtl-cases.json', 'utf8'));
const expected = JSON.parse(fs.readFileSync('training/word/rtl-expected.json', 'utf8'));
cases.forEach((c, i) => check(`split: ${c}`, JSON.stringify(splitByScript(c)) === JSON.stringify(expected[i])));

const unit = (id: string, role: ContentUnit['role'], rawText: string, extra: Partial<ContentUnit> = {}): ContentUnit =>
  ({ id, role, rawText, styleName: role, order: 0, hierarchyLevel: 1, ...extra }) as ContentUnit;
const units: ContentUnit[] = [
  unit('t', 'main_title', 'ספר בדיקה'),
  unit('c', 'chapter', 'פרק א'),
  unit('p', 'main_source', 'ההסכם נחתם ביום 13/01/2026 בין חברת Acme בע"מ (גרסה 2).‏'),
  unit('b', 'regular_paragraph', 'טקסט מודגש', { textRuns: [{ text: 'טקסט מודגש', isBold: true }] }),
];
const blob = await exportWord(units, 'ספר בדיקה');
const zip = await JSZip.loadAsync(await blob.arrayBuffer());
const doc = await zip.file('word/document.xml')!.async('string');
const styles = await zip.file('word/styles.xml')!.async('string');
check('no jc="right" anywhere', !/w:jc w:val="right"/.test(doc + styles));
const decode = (t: string) => t.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
const runs = [...doc.matchAll(/<w:r><w:rPr>(.*?)<\/w:rPr>(?:<w:br\/>)?<w:t[^>]*>(.*?)<\/w:t><\/w:r>/g)];
if (process.env.DUMP) for (const [, rPr, t] of runs) console.log(rPr.includes('<w:rtl/>') ? 'RTL' : 'LTR', JSON.stringify(decode(t)));
const badRtl = runs.filter(([, rPr, t]) => rPr.includes('<w:rtl/>') && /[A-Za-z0-9]/.test(decode(t)));
const missingRtl = runs.filter(([, rPr, t]) => !rPr.includes('<w:rtl/>') && /[א-ת]/.test(t));
check('<w:rtl/> never on Latin/digit runs', badRtl.length === 0, badRtl.map(r => r[2]).join(' | '));
check('<w:rtl/> on every Hebrew run', missingRtl.length === 0, missingRtl.map(r => r[2]).join(' | '));
check('bold sets w:bCs too', runs.filter(([, rPr]) => rPr.includes('<w:b/>')).every(([, rPr]) => rPr.includes('<w:bCs/>')));
check('every run sets w:cs font and w:szCs', runs.every(([, rPr]) => rPr.includes('w:cs=') && rPr.includes('w:szCs')));
check('no directional marks in text', !/[‎‏‪-‮⁦-⁩]/.test(doc));
check('the date stays one LTR run', runs.some(([, rPr, t]) => t === '13/01/2026' && !rPr.includes('<w:rtl/>')));

console.log(fails ? `${fails} FAILED` : 'all Word RTL rules pass');
process.exit(fails ? 1 : 0);
