/**
 * KETER-TYPE v0.9.0 Part C — auto-layout smoke test.
 *
 * Run from the tree root:  npx tsx scripts/v090-partC-smoke.ts
 *
 * Pure-engine checks (no browser, no React) over the Part C scratch tree:
 *  §1  import a sample .docx of each major type (Vilna-like Gemara+Rashi+
 *      Tosafot, Mikraot-like multi-commentary, Responsa-like, Chassidic
 *      Drush-like, Yiddish, Tzenerene, plain prose) and verify the
 *      auto-chosen layout is the right one
 *  §2  dibbur hamatchil automatic detection from the source text (plain
 *      paragraphs, no bold, no delimiter) + bolding of the lemma
 *  §3  every auto-laid-out document paginates with no text collisions
 *  §4  low-confidence input falls back to the stated default (single
 *      column for prose, two columns for commentary-heavy text)
 *  §5  flaw scan finds a planted overlap / knee misalignment /
 *      pagination error, and the corrective geometry shift fixes it
 *      (summed + capped)
 *  §6  NL layout phrases parse to the right action + recipe
 *  §7  flank rule (confirmed by reference talmud-2_5_qm04.pdf, Berakhot
 *      2a): 2a Rashi right/inner, Tosafot left/outer; mirrored on 2b
 *  §8  Shaar Blatt classification (deterministic, no vision/OCR) + wiring
 *      into the title-page builder settings
 *  §9  justification micro-spacing clamp + multi-tier grid balancing
 *  §10 repo suites (regression)
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { DOMParser } from '@xmldom/xmldom';
// The docx importer runs under tsx (Node), where DOMParser / Node are
// not globals — install the @xmldom shims before importing it.
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
(globalThis as unknown as { Node: unknown }).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import JSZip from 'jszip';
import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  applyAutoLayout,
  balanceTierGrid,
  buildRecipePromptContext,
  classifyForImport,
  findRecipeByName,
  getRecipeByIdLocal,
  parseAutoLayoutCommand,
} from '../src/engine/auto-layout';
import {
  boldDibburInUnit,
  detectDibburFromSource,
  fixGeometryFlaws,
  flankPhysicalSides,
  scanShasFlaws,
  spreadSide,
} from '../src/engine/vilna-shas';
import {
  classifyTitlePageStructure,
  titlePageSettingsFromClassification,
} from '../src/engine/title-page-borders';
import { isKnownGeminiActionType } from '../src/engine/gemini-service';
import { applyBalancingPass, auditMicroSpacing, microSpaceLine } from '../src/engine/balance-engine';
import { QaEngine } from '../src/engine/qa-engine';
import { LayoutTestSuite } from '../src/engine/layout-test-suite';
import type { ContentUnit, PageGeometry, PageTypesetResult, TypesetLine } from '../src/types/typesetter';
import type { TierConfig } from '../src/types/typesetter';

const GEOMETRY: PageGeometry = {
  pageWidth: 482,
  pageHeight: 720,
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};

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

// --- minimal .docx builder (same pattern as partD/partE smokes) ---
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const para = (text: string, style?: string): string =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
async function buildDocx(paras: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}</w:body></w:document>`
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

const GEMARA = 'גמרא: תנא היכא קאי דקתני מאימתי ותו מאי שנא דתני דערבית ברישא לתני דשחרית ברישא תנא אקרא קאי דכתיב בשכבך ובקומך והכי קתני זמן קריאת שמע דשכיבה אימת משעה שהכהנים נכנסין לאכול בתרומתן. ';
const MISHNA = 'משנה: מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות רבן גמליאל אומר עד שיעלה עמוד השחר. ';
const RASHI = 'מאימתי קורין את שמע בערבית פירוש מאיזה זמן קורין ולא קתני משעה שהכוכבים יוצאים לאשמעינן מילתא אגב אורחיה דהכהנים שנטמאו וטבלו ביום והעריב שמשן טהורים לאכול בתרומה לעת ערב. ';
const TOSAFOT = 'תנא היכא קאי דקתני מאימתי קושיא ותירוץ ארוך בין הראשונים חילוקים וראיות והתוספות מקשים על פירוש רשי ומתרצים בדוחק גדול. ';
const VERSE = 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֣ת הַשָּׁמַ֗יִם וְאֵ֥ת הָאָֽרֶץ׃ ';
const YIDDISH = 'די צאינה וראינה דערצײלט אונדז װען דער מענטש לערנט די תּורה מיט אַן אָפֿן האַרץ. ';

async function main(): Promise<void> {
  const settings = DesignSettingsEngine.createDefaultSettings();

  console.log('== §1 — auto-layout choice per .docx type ==');
  // Vilna-like: chapter + folio header + Mishna + Gemara + Rashi +
  // Tosafot + Ein Mishpat + Masoret + Gilyon (plain paragraphs: no bold,
  // no delimiters — the dibbur must come from source matching).
  const vilnaDocx = await buildDocx([
    para('מסכת ברכות — פרק ראשון', 'Heading 1'),
    para('דף ב.', 'Folio'),
    para(MISHNA, 'Mishna'),
    ...Array.from({ length: 12 }, () => para(GEMARA)),
    ...Array.from({ length: 12 }, () => para(RASHI, 'Rashi')),
    ...Array.from({ length: 12 }, () => para(TOSAFOT, 'Tosafot')),
    para('עין משפט: סימן א סעיף ב.', 'Ein Mishpat'),
    para('מסורת הש״ס: ברכות דף ג.', 'Masoret HaShas'),
    para('גליון הש״ס: הערה של ר׳ עקיבא איגר.', 'Gilyon'),
  ]);
  const vilna = await DocxImporter.importDocx(vilnaDocx, 'berakhot.docx');
  const vilnaInfo = classifyForImport(vilna.units, vilna.links, { fileName: 'berakhot.docx' });
  check('Vilna-like docx auto-selects vilna-shas', vilnaInfo.decision.recipeId === 'vilna-shas', vilnaInfo.decision.lineEn);
  check('Vilna decision is confident, not a fallback', !vilnaInfo.decision.isFallback && vilnaInfo.decision.confidence >= 0.5, `confidence ${vilnaInfo.decision.confidence}`);
  check('Vilna tiers recognised (mishna/gemara/rashi/tosafot/marginalia/header)', vilnaInfo.classification.tierCounts.mishna > 0 && vilnaInfo.classification.tierCounts.gemara > 0 && vilnaInfo.classification.tierCounts.rashi_inner > 0 && vilnaInfo.classification.tierCounts.tosafot_outer > 0 && vilnaInfo.classification.tierCounts.ein_mishpat_ner_mitzvah > 0 && vilnaInfo.classification.tierCounts.masoret_ha_shas > 0 && vilnaInfo.classification.tierCounts.gilyon_ha_shas > 0 && vilnaInfo.classification.tierCounts.header_band > 0, JSON.stringify(vilnaInfo.classification.tierCounts));
  check('Vilna commentators detected (Rashi, Tosafot, Ein Mishpat, Masoret, Gilyon)', ['Rashi', 'Tosafot', 'Ein Mishpat', 'Masoret HaShas', 'Gilyon HaShas'].every(a => vilnaInfo.classification.commentaryAuthors.includes(a)), vilnaInfo.classification.commentaryAuthors.join(', '));

  // Mikraot-like: verses with taamim + Onkelos + Rashi + Ibn Ezra + Ramban + Sforno.
  const mikraotDocx = await buildDocx([
    para('בראשית פרק א', 'Heading 1'),
    ...Array.from({ length: 8 }, () => para(VERSE)),
    ...Array.from({ length: 5 }, () => para('אונקלוס: בראשית ברא אלהים ית שמיא וית ארעא.', 'Onkelos')),
    ...Array.from({ length: 5 }, () => para('בראשית בשביל התורה שנקראת ראשית פירוש קצר על הפסוק.', 'Rashi')),
    ...Array.from({ length: 3 }, () => para('אבן עזרא: בראשית יש מפרשים שהוא סמוך.', 'Ibn Ezra')),
    ...Array.from({ length: 3 }, () => para('רמב״ן: בראשית ברא אלהים סוד גדול.', 'Ramban')),
    ...Array.from({ length: 3 }, () => para('ספורנו: בראשית ברא את השמים תחלה.', 'Sforno')),
  ]);
  const mikraot = await DocxImporter.importDocx(mikraotDocx, 'bereishit.docx');
  const mikraotInfo = classifyForImport(mikraot.units, mikraot.links, { fileName: 'bereishit.docx' });
  check('Mikraot-like docx auto-selects mikraot-gedolot', mikraotInfo.decision.recipeId === 'mikraot-gedolot', mikraotInfo.decision.lineEn);
  check('Mikraot has 5 distinct commentators', mikraotInfo.classification.commentaryCount === 5, mikraotInfo.classification.commentaryAuthors.join(', '));

  // Responsa-like: siman + she'elah + teshuvah.
  const responsaDocx = await buildDocx([
    para('סימן א׳', 'Heading 2'),
    para('שאלה: ראובן שאל אם מותר לטלטל בשבת במקום שיש עירוב.', 'Normal'),
    para('שאלה: ועוד שאל בענין ברכה על פירות האילן.', 'Normal'),
    para('תשובה: נראה להתיר, וראיה מדברי הראשונים שכתבו כן.', 'Normal'),
    para('תשובה: ולענין השאלה השניה יש להחמיר.', 'Normal'),
  ]);
  const responsa = await DocxImporter.importDocx(responsaDocx, 'shut.docx');
  const responsaInfo = classifyForImport(responsa.units, responsa.links, { fileName: 'shut.docx' });
  check('Responsa-like docx auto-selects responsa', responsaInfo.decision.recipeId === 'responsa', responsaInfo.decision.lineEn);

  // Chassidic Drush-like: drush / chassidut markers, single stream.
  const drushDocx = await buildDocx([
    para('דרוש חסידי על פרשת בראשית', 'Heading 1'),
    ...Array.from({ length: 6 }, () => para('דרוש: בענין החסידות והעבודה שבלב, אמר הבעל שם טוב שהאדם צריך לעבוד את הבורא בשמחה ובדבקות.', 'Normal')),
  ]);
  const drush = await DocxImporter.importDocx(drushDocx, 'drush.docx');
  const drushInfo = classifyForImport(drush.units, drush.links, { fileName: 'drush.docx' });
  check('Chassidic Drush-like docx auto-selects chassidic-drush', drushInfo.decision.recipeId === 'chassidic-drush', drushInfo.decision.lineEn);

  // Yiddish + Tzenerene.
  const yiddishDocx = await buildDocx([...Array.from({ length: 6 }, () => para(YIDDISH, 'Normal'))]);
  const yiddish = await DocxImporter.importDocx(yiddishDocx, 'yiddish.docx');
  const yiddishInfo = classifyForImport(yiddish.units, yiddish.links, { fileName: 'yiddish.docx' });
  check('Yiddish docx auto-selects yiddish-sefer', yiddishInfo.decision.recipeId === 'yiddish-sefer', yiddishInfo.decision.lineEn);
  check('Yiddish docx is detected as Yiddish-dominant', yiddishInfo.classification.isYiddish === true);
  const tzenereneDocx = await buildDocx([
    para('פרשת בראשית', 'Tzenerene Heading'),
    ...Array.from({ length: 4 }, () => para(YIDDISH, 'Tzenerene')),
  ]);
  const tzenerene = await DocxImporter.importDocx(tzenereneDocx, 'tzenerene.docx');
  const tzenereneInfo = classifyForImport(tzenerene.units, tzenerene.links, { fileName: 'tzenerene.docx' });
  check('Tzenerene docx auto-selects tzenerene', tzenereneInfo.decision.recipeId === 'tzenerene', tzenereneInfo.decision.lineEn);

  console.log('== §2 — dibbur hamatchil automatic detection + bolding ==');
  const rashiUnit = vilna.units.find(u => u.role === 'primary_comment');
  const tosafotUnit = vilna.units.find(u => u.role === 'secondary_comment');
  check('Rashi dibbur detected from source text (no bold/delimiter in file)', rashiUnit?.dibburHamatchil === 'מאימתי קורין את שמע בערבית', rashiUnit?.dibburHamatchil ?? '(none)');
  check('Tosafot dibbur detected from source text', tosafotUnit?.dibburHamatchil === 'תנא היכא קאי דקתני מאימתי', tosafotUnit?.dibburHamatchil ?? '(none)');
  const rashiLink = vilna.links.find(l => l.commentaryUnitId === rashiUnit?.id);
  const mishnaUnit = vilna.units.find(u => u.styleName === 'Mishna');
  check('Rashi link points at the MATCHED source unit (the Mishna)', rashiLink?.sourceUnitId === mishnaUnit?.id, `link→${rashiLink?.sourceUnitId ?? '(none)'} mishna=${mishnaUnit?.id ?? '(none)'}`);
  check('detectDibburFromSource finds the longest matching lemma', (() => {
    const found = detectDibburFromSource('מאימתי קורין את שמע בערבית פירוש מאיזה זמן', vilna.units.filter(u => u.role === 'main_source'));
    return found?.dibbur === 'מאימתי קורין את שמע בערבית';
  })());
  check('detectDibburFromSource returns null when the lemma is absent', detectDibburFromSource('מילים שלא קיימות בגמרא כלל', vilna.units.filter(u => u.role === 'main_source')) === null);
  check('boldDibburInUnit bolds the lemma as an isDibbur run', (() => {
    if (!rashiUnit) return false;
    const bolded = boldDibburInUnit(rashiUnit, vilna.units.filter(u => u.role === 'main_source'));
    return bolded.textRuns?.some(r => r.isDibbur && r.isBold && r.text.includes('מאימתי')) === true;
  })());

  console.log('== §3 — auto-laid-out documents paginate with no collisions ==');
  const paginateOk = (label: string, units: ContentUnit[], layoutType: Parameters<typeof PaginationEngine.paginateDocument>[0]['layoutType'], links: Parameters<typeof PaginationEngine.paginateDocument>[0]['links'] = []): PageTypesetResult[] => {
    const doc = PaginationEngine.paginateDocument({ title: label, layoutType, units, geometry: GEOMETRY, links });
    const allLines = doc.pages.flatMap(p => [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines, ...(p.tertiaryLines ?? []), ...(p.footnoteLines ?? []), ...(p.column2Lines ?? []), ...(p.sideNoteLines ?? [])]);
    check(`${label} paginates to ≥1 page with lines`, doc.pages.length >= 1 && allLines.length > 0, `${doc.pages.length} pages, ${allLines.length} lines`);
    const flaws = scanShasFlaws(doc.pages, units, links);
    check(`${label} has no text-overlap flaws`, !flaws.some(f => f.kind === 'text_overlap'), flaws.filter(f => f.kind === 'text_overlap').map(f => f.messageHe).join('; ') || 'none');
    return doc.pages;
  };
  paginateOk('Vilna (rav_text)', vilna.units, 'rav_text', vilna.links);
  paginateOk('Mikraot (mikraot_gedolot)', mikraot.units, 'mikraot_gedolot', mikraot.links);
  paginateOk('Responsa (single_column)', responsa.units, 'single_column');
  paginateOk('Drush (single_column)', drush.units, 'single_column');
  paginateOk('Yiddish (yiddish_sefer)', yiddish.units, 'yiddish_sefer');
  // applyAutoLayout end-to-end: settings carry the recipe layout + Vilna typography.
  const applied = applyAutoLayout(vilna.units, vilna.links, settings, { fileName: 'berakhot.docx' });
  // Merge note: Part C's local stand-in applied the vilna_shas READY_DESIGNS
  // preset (rav_text); the merged tree applies Part A's Vilna recipe — a
  // custom layout whose boxes are the recipe's regions.
  check('applyAutoLayout returns custom_layout settings for Vilna', applied.settings.layout.layoutType === 'custom_layout', applied.settings.layout.layoutType);
  check('Vilna recipe boxes present', (applied.settings.pageLayout.customLayout?.boxes.length ?? 0) > 0);
  check('applyAutoLayout applies Vilna typography (bold dibbur)', applied.settings.ravText.dibburHamatchilBold === true);

  console.log('== §4 — low-confidence fallback is stated, never silent ==');
  const proseDocx = await buildDocx([
    para('הקדמה', 'Heading 1'),
    ...Array.from({ length: 4 }, () => para('זהו טקסט פרוזה רגיל על נושא כללי, בלי שום סימן של גמרא או מפרשים או סימנים הלכתיים.', 'Normal')),
  ]);
  const prose = await DocxImporter.importDocx(proseDocx, 'prose.docx');
  const proseInfo = classifyForImport(prose.units, prose.links, { fileName: 'prose.docx' });
  check('Plain prose falls back to single-column', proseInfo.decision.isFallback === true && proseInfo.decision.recipeId === 'single-column', proseInfo.decision.lineEn);
  check('Fallback line says so plainly', /ברירת מחדל|לא זוהה/.test(proseInfo.decision.lineHe));
  // Commentary-heavy but unidentified (generic roles, no names/dibbur) → two columns.
  const genericUnits: ContentUnit[] = [
    { id: 'g-src', role: 'main_source', rawText: 'טקסט מקור ארוך. '.repeat(30), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'g-c1', role: 'primary_comment', rawText: 'פירוש כללי א. '.repeat(30), styleName: 'Commentary', order: 2, hierarchyLevel: 3 },
    { id: 'g-c2', role: 'primary_comment', rawText: 'פירוש כללי ב. '.repeat(30), styleName: 'Commentary', order: 3, hierarchyLevel: 3 },
    { id: 'g-c3', role: 'secondary_comment', rawText: 'פירוש כללי ג. '.repeat(30), styleName: 'Commentary', order: 4, hierarchyLevel: 3 },
    { id: 'g-c4', role: 'secondary_comment', rawText: 'פירוש כללי ד. '.repeat(30), styleName: 'Commentary', order: 5, hierarchyLevel: 3 },
  ];
  const genericInfo = classifyForImport(genericUnits, []);
  check('Generic commentary-heavy text falls back to two-column (not Vilna)', genericInfo.decision.isFallback === true && genericInfo.decision.recipeId === 'two-column', genericInfo.decision.lineEn);

  console.log('== §5 — flaw scan finds planted flaws; geometry shift fixes them ==');
  const line = (unitId: string, y: number, xL: number, xR: number, role: ContentUnit['role']): TypesetLine => ({
    lineIndex: 0, words: [], width: 50, targetWidth: 50, xStart: 0, xLeft: xL, xRight: xR,
    yBaseline: y, height: 12, ascent: 9, descent: 3, isLastLine: false, isJustified: false,
    extraSpacePerWord: 0, role, unitId,
  });
  const knee = { pageContentWidth: 394, pageContentHeight: 624, topY: 0, kneeJunctionY: 300, bottomY: 624, upperSourceWidth: 200, lowerSourceWidth: 150, innerXOffset: 0, isLeftStepped: false, rightCommentaryWidth: 80, leftCommentaryWidth: 80, gutterWidth: 11 };
  const plantedPages: PageTypesetResult[] = [
    {
      pageIndex: 0, pageNumber: 2, pageNumberHebrew: 'ב׳', headerTitle: '', layoutType: 'rav_text', geometry: GEOMETRY,
      // source [150,250] and rashi [200,280] overlap on y=100 → text_overlap.
      // rashi bottom 350 vs tosafot bottom 400, both below the knee (300), gap 50pt → knee_misalignment.
      sourceLines: [line('u-s', 100, 150, 250, 'main_source')],
      rashiLines: [line('u-r', 100, 200, 280, 'primary_comment'), line('u-r2', 350, 200, 280, 'primary_comment')],
      tosafotLines: [line('u-t', 100, 300, 380, 'secondary_comment'), line('u-t2', 400, 300, 380, 'secondary_comment')],
      footnoteLines: [], knee,
    },
    {
      pageIndex: 1, pageNumber: 3, pageNumberHebrew: 'ג׳', headerTitle: '', layoutType: 'rav_text', geometry: GEOMETRY,
      sourceLines: [], rashiLines: [], tosafotLines: [], footnoteLines: [], knee,
    },
    {
      pageIndex: 2, pageNumber: 5, pageNumberHebrew: 'ה׳', headerTitle: '', layoutType: 'rav_text', geometry: GEOMETRY,
      sourceLines: [line('u-s2', 100, 150, 250, 'main_source')], rashiLines: [], tosafotLines: [], footnoteLines: [], knee,
    },
  ];
  const plantedUnits: ContentUnit[] = [
    { id: 'u-s', role: 'main_source', rawText: 'גמרא', styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'u-r', role: 'primary_comment', rawText: 'רשי', styleName: 'Rashi', order: 2, hierarchyLevel: 3 },
    { id: 'u-t', role: 'secondary_comment', rawText: 'תוספות', styleName: 'Tosafot', order: 3, hierarchyLevel: 3 },
  ];
  const plantedFlaws = scanShasFlaws(plantedPages, plantedUnits, []);
  check('flaw scan finds the planted text overlap', plantedFlaws.some(f => f.kind === 'text_overlap'), plantedFlaws.map(f => f.kind).join(', '));
  check('flaw scan finds the planted knee misalignment', plantedFlaws.some(f => f.kind === 'knee_misalignment'), plantedFlaws.map(f => f.kind).join(', '));
  check('flaw scan finds the pagination errors (empty page + broken sequence)', plantedFlaws.filter(f => f.kind === 'pagination_error').length >= 2, plantedFlaws.filter(f => f.kind === 'pagination_error').map(f => f.messageHe).join(' | '));
  const shifts = fixGeometryFlaws(plantedFlaws);
  check('geometry fix proposes a gutter widening for the overlap', shifts.gutterDeltaPt === 2, `gutter +${shifts.gutterDeltaPt}pt`);
  check('geometry fix proposes a knee shift for the misalignment', shifts.kneeJunctionDeltaPct === 2, `knee +${shifts.kneeJunctionDeltaPct}`);
  check('geometry fix counts the auto-fixable flaws', shifts.fixedCount === 2, `${shifts.fixedCount} fixed, ${shifts.skippedCount} skipped`);
  const manyOverlaps = Array.from({ length: 6 }, (_, i) => ({
    kind: 'text_overlap' as const, pageNumber: i + 2, messageHe: 'חפיפה', autoFixable: true, suggestedShift: { gutterDeltaPt: 2 },
  }));
  check('geometry shifts are capped (gutter ≤ +8pt)', fixGeometryFlaws(manyOverlaps).gutterDeltaPt === 8, `+${fixGeometryFlaws(manyOverlaps).gutterDeltaPt}pt`);
  const qaGeo = QaEngine.scanGeometryFlaws(plantedPages, plantedUnits, []);
  check('QaEngine.scanGeometryFlaws delegates to the same scan', qaGeo.flaws.length === plantedFlaws.filter(f => ['text_overlap', 'knee_misalignment', 'pagination_error'].includes(f.kind)).length && qaGeo.shifts.gutterDeltaPt === 2);

  console.log('== §6 — NL layout phrases + validated AI action types ==');
  const nlCases: Array<[string, string, string?]> = [
    ['Format this text like a Vilna Shas folio', 'applyHistoricalLayout', 'vilna-shas'],
    ['Apply a Shulchan Aruch 2-column layout with commentaries below', 'applyHistoricalLayout', 'shulchan-aruch'],
    ['Design a Chassidic Drush page with a decorative Shaar Blatt border', 'applyHistoricalLayout', 'chassidic-drush'],
    ['lay it out like Mikraot Gedolot', 'applyHistoricalLayout', 'mikraot-gedolot'],
    ['Change layout', 'changeLayout', undefined],
    ['Explain this layout', 'explainRecipe', undefined],
    ['החל תבנית צאינה וראינה', 'applyRecipe', 'tzenerene'],
  ];
  for (const [text, action, recipeId] of nlCases) {
    const cmd = parseAutoLayoutCommand(text);
    check(`NL "${text}" → ${action}${recipeId ? ` (${recipeId})` : ''}`, cmd?.action === action && (recipeId === undefined || cmd?.recipeId === recipeId), cmd ? `${cmd.action}/${cmd.recipeId ?? '—'}` : 'null');
  }
  check('NL with no layout intent parses to null', parseAutoLayoutCommand('please fix the spelling on page three') === null);
  for (const t of ['applyHistoricalLayout', 'applyRecipe', 'explainRecipe', 'changeLayout', 'fix_geometry_flaws']) {
    check(`Gemini action type "${t}" is known/validated`, isKnownGeminiActionType(t));
  }
  check('findRecipeByName resolves Hebrew aliases', findRecipeByName('עמד כמו ש״ס וילנא')?.id === 'vilna-shas');
  check('recipe prompt context lists all recipes + rules', (() => {
    const ctx = buildRecipePromptContext();
    return ['vilna-shas', 'mikraot-gedolot', 'shulchan-aruch', 'applyHistoricalLayout', 'Rashi always INNER'].every(s => ctx.includes(s));
  })());
  check('unknown recipe id resolves to undefined (never guessed)', getRecipeByIdLocal('no-such-recipe') === undefined);

  console.log('== §7 — flank rule (Berakhot 2a reference) ==');
  check('2a (recto): Rashi right/inner, Tosafot left/outer', (() => {
    const f = flankPhysicalSides(2, 'talmud');
    return f.rashi === 'right' && f.tosafot === 'left';
  })());
  check('2b (verso): mirrored — Rashi left/inner, Tosafot right/outer', (() => {
    const f = flankPhysicalSides(3, 'talmud');
    return f.rashi === 'left' && f.tosafot === 'right';
  })());
  check('spread: 2a is the LEFT-hand page of a Hebrew spread', spreadSide(2, 'talmud') === 'left' && spreadSide(3, 'talmud') === 'right');

  console.log('== §8 — Shaar Blatt classification (deterministic) ==');
  const titleDocx = await buildDocx([
    para('ספר תהלים', 'Title'),
    para('עם פירוש רש״י', 'Subtitle'),
    para('מאת רבי שלמה יצחקי', 'Heading'),
    para('תשפ״ז · 2026', 'Heading'),
    para('מזמור ראשון: אשרי האיש אשר לא הלך בעצת רשעים.', 'Normal'),
  ]);
  const titleRes = await DocxImporter.importDocx(titleDocx, 'tehillim.docx');
  const tp = classifyTitlePageStructure(titleRes.units);
  check('title page detected from opening heading lines', tp.isTitlePage === true);
  check('title hierarchy: title + subtitle + author + year', tp.title === 'ספר תהלים' && tp.subtitle === 'עם פירוש רש״י' && tp.author === 'מאת רבי שלמה יצחקי' && (tp.year ?? '').includes('2026'), JSON.stringify({ title: tp.title, subtitle: tp.subtitle, author: tp.author, year: tp.year }));
  check('no decorative frame is claimed without evidence (no ornament in file)', tp.hasDecorativeFrame === false && tp.suggestedBorderStyleId === 'double');
  check('plain body text is NOT a title page', classifyTitlePageStructure(prose.units).isTitlePage === false);
  const tpSettings = titlePageSettingsFromClassification(settings, tp);
  check('title-page settings wire the classification into the builder', tpSettings.titlePage?.enabled === true && tpSettings.titlePage?.title.text === 'ספר תהלים' && tpSettings.titlePage?.author.text === 'מאת רבי שלמה יצחקי' && tpSettings.titlePage?.border.styleId === 'double');

  console.log('== §9 — micro-spacing clamp + multi-tier grid balancing ==');
  const stretched = { lineIndex: 0, words: [{}, {}, {}, {}, {}] as never, width: 100, targetWidth: 200, xStart: 0, yBaseline: 100, height: 12, ascent: 9, descent: 3, isLastLine: false, isJustified: true, extraSpacePerWord: 0, role: 'main_source' as const, unitId: 'u-1' };
  const ms = microSpaceLine(stretched as unknown as TypesetLine);
  check('micro-spacing clamps an over-stretched line to 12pt/word and flags rebreak', ms.extraSpacePerWord === 12 && ms.needsRebreak === true, `clamped ${ms.extraSpacePerWord}pt, rebreak=${ms.needsRebreak}`);
  const okLine = { ...stretched, targetWidth: 140 };
  const ms2 = microSpaceLine(okLine as unknown as TypesetLine);
  check('micro-spacing leaves a normally-stretched line alone', ms2.extraSpacePerWord === 8 && ms2.needsRebreak === false);
  const sixTiers: TierConfig[] = [
    { role: 'main_source', tierIndex: 1, widthPct: 40 },
    { role: 'primary_comment', tierIndex: 2, widthPct: 20 },
    { role: 'secondary_comment', tierIndex: 3, widthPct: 20 },
    { role: 'tertiary_comment', tierIndex: 4, widthPct: 20 },
    { role: 'tertiary_comment', tierIndex: 5, widthPct: 20 },
    { role: 'tertiary_comment', tierIndex: 6, widthPct: 20 },
  ];
  const grid = balanceTierGrid(sixTiers, 394);
  const gridSum = grid.tiers.reduce((s, t) => s + (t.widthPct ?? 0), 0);
  check('6-tier grid rescales widths to fit the content width', gridSum <= 100.01 && grid.tiers.every(t => (t.widthPct ?? 0) >= 5), `sum ${gridSum.toFixed(1)}%`);
  check('6-tier grid narrows the gutter (8pt) so every tier stays readable', grid.gutterPt === 8, `${grid.gutterPt}pt`);
  const balanced = applyBalancingPass(plantedPages, plantedUnits, settings);
  check('balancing pass still runs (widow/orphan + nikud reports present)', balanced.report.balance.pagesInspected === 3 && balanced.report.nikud.unitsInspected === 3);
  check('micro-spacing audit reports over-stretched lines in the balance notes', auditMicroSpacing([
    { ...plantedPages[0], sourceLines: [{ ...line('u-s', 100, 150, 250, 'main_source'), isJustified: true, width: 100, targetWidth: 200, words: [{}, {}, {}, {}, {}] as never }] },
  ]).overStretchedLines === 1);

  console.log('== §10 — repo suites (regression) ==');
  const difficult = LayoutTestSuite.runAllDifficultCases();
  console.log(`  difficult cases: ${difficult.passedCount}/${difficult.totalCount}`);
  check('runAllDifficultCases — all pass', difficult.allPassed, difficult.cases.filter(c => !c.passed).map(c => c.id).join(', ') || `${difficult.passedCount}/${difficult.totalCount}`);
  const a1 = LayoutTestSuite.runStage13A1Tests();
  check('runStage13A1Tests — all pass', a1.allPassed, `${a1.passedCount}/${a1.totalCount}`);

  console.log(`\nPart C smoke: ${passes} passed, ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error('SMOKE CRASH:', err);
  process.exit(1);
});
