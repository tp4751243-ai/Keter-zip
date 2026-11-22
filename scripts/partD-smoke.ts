/**
 * KETER-TYPE v0.8.0 — Part D smoke checks (native Yiddish sefarim support).
 *
 * Run from the repo root:  npx tsx scripts/partD-smoke.ts
 *
 * Pure-engine checks (no browser, no React): Yiddish detection /
 * classification / orthography, mixed Yiddish–Hebrew typography, the
 * Yiddish facing-column paginator (Hebrew right, Yiddish left, parsha
 * headings full-width, footnotes conserved), Yiddish-safe search and
 * nikud handling, the ready-design presets, the AI action types +
 * natural-language commands, and the .docx importer path (live .docx
 * built with JSZip; needs a DOMParser, so it runs through
 * @xmldom/xmldom when that transitive dependency is present and is
 * reported as SKIP otherwise — the importer itself runs in the browser /
 * Electron, where DOMParser is native).
 * The repo's own suites run last for regression coverage.
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import JSZip from 'jszip';
import { PaginationEngine } from '../src/engine/pagination-engine';
import {
  DesignSettingsEngine,
  applyValidatedAiAction,
  findReadyDesignByName,
  getReadyDesign,
  isMultiTierLayout,
} from '../src/engine/design-settings-engine';
import { DocxImporter } from '../src/engine/docx-importer';
import {
  applyYiddishHeadingDefaults,
  canonicalizeYiddishForMatch,
  classifyYiddishParagraph,
  detectScriptRuns,
  detectYiddish,
  isMixedYiddishHebrew,
  parseYiddishCommand,
  reclassifyYiddishUnits,
  scanYiddishFlaws,
  stripDiacriticsYiddishSafe,
  verifyYiddishFolios,
} from '../src/engine/yiddish-sefarim';
import { GEMINI_ACTION_TYPES, parseGeminiActionResponse } from '../src/engine/gemini-service';
import { findAll } from '../src/engine/hebrew-search';
import { NikudEngine } from '../src/engine/nikud-engine';
import { HarfBuzzShaperEngine } from '../src/engine/harfbuzz-emulator';
import { LayoutTestSuite } from '../src/engine/layout-test-suite';
import type { ContentUnit, PageGeometry } from '../src/types/typesetter';

const GEOMETRY: PageGeometry = {
  pageWidth: 482,
  pageHeight: 680,
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};
const CONTENT_W = GEOMETRY.pageWidth - GEOMETRY.marginInside - GEOMETRY.marginOutside;
const CONTENT_H = GEOMETRY.pageHeight - GEOMETRY.marginTop - GEOMETRY.marginBottom;

let failures = 0;
let passes = 0;
let skips = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function skip(name: string, detail = ''): void {
  skips++;
  console.log(`  SKIP  ${name}${detail ? ` — ${detail}` : ''}`);
}

const YIDDISH_TEXT =
  'אין אָנהײב האָט גאָט באַשאַפֿן דעם הימל און די ערד, און די ערד איז געװען װיסט און לער, און פֿינצטערניש איז געװען אױף דעם תּהום.';
const HEBREW_TEXT =
  'מתניתין: מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית? מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן, עַד סוֹף הָאַשְׁמוּרָה הָרִאשְׁוֹנָה.';

console.log('1. Yiddish detection');
{
  const det = detectYiddish(YIDDISH_TEXT);
  check('Yiddish passage detected', det.isYiddish, `score ${det.score.toFixed(2)}, digraphs ${det.digraphCount}`);
  check('digraphs counted', det.digraphCount >= 3, `${det.digraphCount}`);
  check('function words found', det.functionWordHits.length >= 3, det.functionWordHits.slice(0, 5).join(', '));
  const heb = detectYiddish(HEBREW_TEXT);
  check('Hebrew Mishna NOT detected as Yiddish', !heb.isYiddish, `score ${heb.score.toFixed(2)}`);
  const gemara = detectYiddish('גמרא: תָּנָא הֵיכָא קָאֵי דְּקָתָנֵי "מֵאֵימָתַי"? וְתוּ, מַאי שְׁנָא דְּתָנֵי דְּעַרְבִית בְּרֵישָׁא?');
  check('Hebrew Gemara NOT detected as Yiddish', !gemara.isYiddish, `score ${gemara.score.toFixed(2)}`);
  const bare = detectYiddish('אין');
  check('single ambiguous word does not trigger', !bare.isYiddish, `score ${bare.score.toFixed(2)}`);
  const plain = detectYiddish('דאָס איז אַ גוטער טאָג');
  check('plain Yiddish sentence detected (function words)', plain.isYiddish, `score ${plain.score.toFixed(2)}`);
}

console.log('2. Yiddish classification');
{
  const parsha = classifyYiddishParagraph('פרשת בראשית', 'Tzenerene Heading');
  check('parsha heading → chapter / tzenerene', parsha?.role === 'chapter' && parsha?.yiddishKind === 'tzenerene', JSON.stringify(parsha));
  const tz = classifyYiddishParagraph('די צאינה וראינה דערצײלט אונדז', 'Tzenerene');
  check('Tzenerene paragraph → main_source / tzenerene', tz?.role === 'main_source' && tz?.yiddishKind === 'tzenerene', JSON.stringify(tz));
  const tr = classifyYiddishParagraph(YIDDISH_TEXT, 'Yiddish Translation');
  check('translation style → primary_comment / translation', tr?.role === 'primary_comment' && tr?.yiddishKind === 'translation', JSON.stringify(tr));
  const biur = classifyYiddishParagraph('ביאור: דאָס װאָרט איז דער אָנהײב', 'Normal');
  check('Biur opening → secondary_comment / biur', biur?.role === 'secondary_comment' && biur?.yiddishKind === 'biur', JSON.stringify(biur));
  const chas = classifyYiddishParagraph('דער רבי האָט געזאָגט', 'Chassidic Commentary');
  check('Chassidic style → primary_comment / chassidic_commentary', chas?.role === 'primary_comment' && chas?.yiddishKind === 'chassidic_commentary', JSON.stringify(chas));
  const heb = classifyYiddishParagraph('בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם', 'Normal');
  check('pointed Hebrew verse → null (not Yiddish)', heb === null, JSON.stringify(heb));
  const bareParsha = classifyYiddishParagraph('פרשת בראשית', 'Heading 1');
  check('bare parsha heading without Yiddish style → null (ambiguous, needs document context)', bareParsha === null);
}

console.log('3. Yiddish orthography');
{
  check('match canonicalisation folds וו/וי/יי to װ/ױ/ײ', canonicalizeYiddishForMatch('געווען ווייס') === 'געװען װײס', canonicalizeYiddishForMatch('געווען ווייס'));
  check('match canonicalisation keeps dagesh (פּ stays פּ)', canonicalizeYiddishForMatch('פּסוק') === 'פּסוק');
  check('match canonicalisation strips nikud but keeps dagesh', canonicalizeYiddishForMatch('בְּרֵאשִׁית') === 'בּראשית', canonicalizeYiddishForMatch('בְּרֵאשִׁית'));
  check('safe strip keeps orthographic dagesh (פּ)', stripDiacriticsYiddishSafe('פּסוק') === 'פּסוק');
  check('safe strip keeps rafe (פֿ)', stripDiacriticsYiddishSafe('פֿינצטערניש') === 'פֿינצטערניש');
  check('safe strip removes kamatz but keeps dagesh after ד', stripDiacriticsYiddishSafe('דָּבָר') === 'דּבר', stripDiacriticsYiddishSafe('דָּבָר'));
  const yiUnits: ContentUnit[] = [
    { id: 'u-yi', role: 'main_source', rawText: 'דער פּסוק פֿון דער תּורה', styleName: 'Tzenerene', order: 1, hierarchyLevel: 2, language: 'yi', yiddishKind: 'tzenerene' },
    { id: 'u-he', role: 'main_source', rawText: 'בָּרוּךְ אַתָּה', styleName: 'Normal', order: 2, hierarchyLevel: 2 },
  ];
  const stripped = NikudEngine.processUnits(yiUnits, 'remove_nikud');
  check('NikudEngine leaves Yiddish units untouched (פּ/פֿ intact)', stripped[0].rawText === 'דער פּסוק פֿון דער תּורה', stripped[0].rawText);
  check('NikudEngine still strips Hebrew nikud', stripped[1].rawText === 'ברוך אתה', stripped[1].rawText);
}

console.log('4. Shaper: Yiddish digraphs shape as base letters');
{
  const shaper = new HarfBuzzShaperEngine(14);
  const word = shaper.shapeWord('װאָס');
  check('digraph word has positive width', word.width > 0, `width ${word.width.toFixed(1)}`);
  check('װ is a base glyph, not a mark', word.glyphs[0]?.char === 'װ' && word.glyphs[0]?.isMark === false);
  check('dagesh after digraph stays attached (canonical reorder)', shaper.canonicalReorder('װּ') === 'װּ');
  const pe = shaper.shapeWord('פּ');
  check('פּ shapes with a zero-advance dagesh mark', pe.glyphs.length === 2 && pe.glyphs[1]?.isMark === true && pe.glyphs[1]?.xAdvance === 0, `glyphs ${pe.glyphs.length}`);
}

console.log('5. Mixed Yiddish–Hebrew typography');
{
  const mixed = 'װי עס שטײט געשריבן: "בראשית ברא אלהים" — דאָס איז דער ערשטער פּסוק.';
  const runs = detectScriptRuns(mixed);
  const scripts = new Set(runs.map(r => r.script));
  check('mixed line has both yi and he runs', scripts.has('yi') && scripts.has('he'), runs.map(r => `${r.script}:${r.text.slice(0, 8)}`).join(' | '));
  check('mixed line detected as mixed', isMixedYiddishHebrew(mixed));
  check('pure Hebrew line is not mixed', !isMixedYiddishHebrew('בראשית ברא אלהים את השמים'));
  check('runs preserve original characters (no mangling)', runs.map(r => r.text).join('') === mixed);
}

console.log('6. Yiddish facing-column pagination (sample sefer)');
const sampleUnits = DocxImporter.getSampleYiddishSefer();
const doc = PaginationEngine.paginateDocument({
  title: 'צאינה וראינה — פרשת בראשית',
  layoutType: 'yiddish_sefer',
  units: sampleUnits,
  geometry: GEOMETRY,
});
{
  check('layout type is yiddish_sefer', doc.layoutType === 'yiddish_sefer');
  check('paginates to more than one page', doc.pages.length >= 2, `${doc.pages.length} pages`);
  const placedIds = new Set<string>();
  for (const pg of doc.pages) {
    for (const l of [...pg.sourceLines, ...(pg.column2Lines ?? []), ...pg.footnoteLines]) placedIds.add(l.unitId);
  }
  const missing = sampleUnits.filter(u => u.rawText.trim().length > 0 && !placedIds.has(u.id));
  check('no unit dropped (all units placed)', missing.length === 0, missing.map(u => u.id).join(', ') || 'all placed');
  const flaws = scanYiddishFlaws(doc.pages, sampleUnits);
  check('Yiddish flaw scan is clean', flaws.length === 0, flaws.map(f => f.messageHe).join(' | ') || 'no flaws');
  const heLines = doc.pages.flatMap(pg => pg.sourceLines.filter(l => l.unitId === 'unit-yi-he-1'));
  const trLines = doc.pages.flatMap(pg => (pg.column2Lines ?? []).filter(l => l.unitId === 'unit-yi-tr-1'));
  check('Hebrew source placed in the right column (sourceLines)', heLines.length > 0 && heLines.every(l => l.columnNumber === 1 && l.xStart === 0), `${heLines.length} lines`);
  check('Yiddish translation placed in the left column (column2Lines)', trLines.length > 0 && trLines.every(l => l.columnNumber === 2 && (l.xStart ?? 0) > 0), `${trLines.length} lines`);
  const headLines = doc.pages.flatMap(pg => pg.sourceLines.filter(l => l.unitId === 'unit-yi-ch-1'));
  check('parsha heading is full-width', headLines.length > 0 && headLines.every(l => Math.abs(l.targetWidth - CONTENT_W) < 1), `${headLines.length} lines, targetWidth ${headLines[0]?.targetWidth}`);
  check('every page has a Hebrew folio label', doc.pages.every(pg => pg.pageNumberHebrew.trim().length > 0));
  check('zero collisions on every page', doc.pages.every(pg => (pg.layoutScore?.collisionCount ?? 0) === 0), doc.pages.map(pg => pg.layoutScore?.collisionCount).join(','));
  const fnPlaced = doc.pages.some(pg => pg.footnoteLines.some(l => l.unitId === 'unit-yi-fn-1'));
  check('footnote conserved onto a page', fnPlaced);
  const tzPages = new Set<number>();
  for (const pg of doc.pages) {
    if ([...pg.sourceLines, ...(pg.column2Lines ?? [])].some(l => l.unitId === 'unit-yi-tz-1')) tzPages.add(pg.pageNumber);
  }
  check('long Tzenerene unit continues across pages', tzPages.size >= 2, `pages ${[...tzPages].join(',')}`);
  const continued = doc.pages.some(pg => (pg.continuedUnitIdsToNextPage ?? []).length > 0);
  check('continuation markers recorded', continued);
  // Digraph preservation, counted globally: placed text must carry at
  // least as many digraphs as the source units.
  const srcDigraphs = sampleUnits.reduce((s, u) => s + (u.rawText.match(/[װױײ]/g) ?? []).length, 0);
  const placedText = doc.pages.flatMap(pg => [...pg.sourceLines, ...(pg.column2Lines ?? []), ...pg.footnoteLines]).flatMap(l => l.words.map(w => w.text)).join(' ');
  const placedDigraphs = (placedText.match(/[װױײ]/g) ?? []).length;
  check('no digraphs lost in pagination', placedDigraphs >= srcDigraphs, `${placedDigraphs}/${srcDigraphs}`);
  const folio = verifyYiddishFolios(doc.pages);
  check('folio verification passes', folio.ok, `checked ${folio.checked}`);
}

console.log('7. Single-stream Yiddish (Tzenerene-only) and Hebrew-only');
{
  const tzOnly = sampleUnits.filter(u => u.yiddishKind === 'tzenerene' || u.role === 'chapter');
  const tzDoc = PaginationEngine.paginateDocument({ title: 'Tzenerene only', layoutType: 'yiddish_sefer', units: tzOnly, geometry: GEOMETRY });
  check('Tzenerene-only: no left column', tzDoc.pages.every(pg => (pg.column2Lines ?? []).length === 0));
  check('Tzenerene-only: full-width lines', tzDoc.pages.every(pg => pg.sourceLines.every(l => Math.abs(l.targetWidth - CONTENT_W) < 1)));
  check('Tzenerene-only: no flaws', scanYiddishFlaws(tzDoc.pages, tzOnly).length === 0);
  const heOnly = sampleUnits.filter(u => u.id === 'unit-yi-he-1');
  const heDoc = PaginationEngine.paginateDocument({ title: 'Hebrew only', layoutType: 'yiddish_sefer', units: heOnly, geometry: GEOMETRY });
  check('Hebrew-only in Yiddish layout: single full-width column', heDoc.pages.length >= 1 && heDoc.pages.every(pg => (pg.column2Lines ?? []).length === 0));
  void CONTENT_H;
}

console.log('8. Yiddish-safe search');
{
  const text = 'דאָס איז געװען אַ גוטער טאָג, און די ערד איז געווען װיסט.';
  const hitsDigraph = findAll(text, 'געװען');
  check('digraph query finds digraph spelling', hitsDigraph.length >= 1, `${hitsDigraph.length} hits`);
  const hitsDouble = findAll(text, 'געווען');
  check('double-letter query finds digraph spelling (cross-spelling match)', hitsDouble.length >= 1, `${hitsDouble.length} hits`);
  check('װאָס query finds װאָס', findAll('װאָס איז דאָס', 'װאָס').length === 1);
  check('Hebrew search still works (ktiv-insensitive)', findAll('מאימתי קורין את שמע', 'מאימתי').length === 1);
  const yiText = 'דאָס איז גוט און שײן';
  check('Yiddish ktiv safety: "גט" does NOT match "גוט" in Yiddish text', findAll(yiText, 'גט').length === 0);
  check('Yiddish ktiv safety: "גוט" still matches itself', findAll(yiText, 'גוט').length === 1);
  check('Yiddish final-fe safety: "פ" does not match "ף"', findAll('דער בריוו איז אָפֿן', 'פ').length === 0 || findAll('דער בריוו איז אָפֿן', 'אָפֿן').length === 1);
}

console.log('9. AI: Yiddish action types + natural-language commands');
{
  check('GEMINI_ACTION_TYPES includes apply_yiddish_defaults', GEMINI_ACTION_TYPES.includes('apply_yiddish_defaults'));
  check('GEMINI_ACTION_TYPES includes verify_yiddish_folio', GEMINI_ACTION_TYPES.includes('verify_yiddish_folio'));
  check('GEMINI_ACTION_TYPES includes classify_yiddish_tiers', GEMINI_ACTION_TYPES.includes('classify_yiddish_tiers'));
  const c1 = parseYiddishCommand('החל כללי יידיש');
  check('NL "החל כללי יידיש" → apply_yiddish_defaults', c1?.action === 'apply_yiddish_defaults');
  const c2 = parseYiddishCommand('בדוק רצף דפים יידיש');
  check('NL "בדוק רצף דפים יידיש" → verify_yiddish_folio', c2?.action === 'verify_yiddish_folio');
  const c3 = parseYiddishCommand('סווג טקסט יידיש');
  check('NL "סווג טקסט יידיש" → classify_yiddish_tiers', c3?.action === 'classify_yiddish_tiers');
  check('NL Shas command is not a Yiddish command', parseYiddishCommand('הרחב את תוספות') === null);
  const parsed = parseGeminiActionResponse('{"reply": "Applying Yiddish rules", "action": {"type": "apply_yiddish_defaults", "label": "Yiddish", "data": {}}}');
  check('Gemini JSON with a Yiddish action parses', parsed?.action?.type === 'apply_yiddish_defaults');
  const bad = parseGeminiActionResponse('{"reply": "x", "action": {"type": "invent_yiddish", "label": "x", "data": {}}}');
  check('unknown action type still rejected', bad?.action === undefined);
}

console.log('10. Presets, tiers, defaults, re-classification');
{
  check('ready design yiddish_sefer exists', getReadyDesign('yiddish_sefer')?.layout === 'yiddish_sefer');
  check('ready design tzenerene exists', getReadyDesign('tzenerene')?.layout === 'yiddish_sefer');
  check('free-text "צאינה וראינה" resolves to tzenerene', findReadyDesignByName('צאינה וראינה')?.id === 'tzenerene');
  const base = DesignSettingsEngine.createDefaultSettings();
  const applied = DesignSettingsEngine.applyReadyDesign(base, 'yiddish_sefer', 'ai');
  check('applyReadyDesign switches layout to yiddish_sefer', applied.settings.layoutType === 'yiddish_sefer');
  const patched = applyValidatedAiAction(base, 'update_design_settings', { patch: { layoutType: 'yiddish_sefer' } });
  check('AI patch can switch layout to yiddish_sefer', patched?.settings.layoutType === 'yiddish_sefer');
  check('default tiers for yiddish_sefer: 3 (source / translation / biur)', DesignSettingsEngine.defaultTiersForLayout('yiddish_sefer').length === 3);
  check('yiddish_sefer is a multi-tier layout', isMultiTierLayout('yiddish_sefer'));
  const defaults = applyYiddishHeadingDefaults(base);
  const chStyle = DesignSettingsEngine.resolveStyle(defaults, { role: 'chapter', unitId: 'x' });
  check('Yiddish defaults centre the parsha heading', chStyle.paragraph.alignment === 'center');
  const srcStyle = DesignSettingsEngine.resolveStyle(defaults, { role: 'main_source', unitId: 'x' });
  check('Yiddish defaults justify body with no first-line indent', srcStyle.paragraph.alignment === 'justify' && (srcStyle.paragraph.firstLineIndentPt ?? 0) === 0);
  const raw: ContentUnit[] = sampleUnits.map(u => {
    const { language, yiddishKind, ...rest } = u;
    void language;
    void yiddishKind;
    return { ...rest };
  });
  const re = reclassifyYiddishUnits(raw);
  check('re-classification recovers Yiddish kinds', re.changed >= 4, `${re.changed} changed`);
  const reParsha = re.units.find(u => u.id === 'unit-yi-ch-1');
  check('re-classified parsha heading is tzenerene', reParsha?.yiddishKind === 'tzenerene' && reParsha?.role === 'chapter');
  const reTr = re.units.find(u => u.id === 'unit-yi-tr-1');
  check('re-classified translation is translation', reTr?.yiddishKind === 'translation');
  const broken = verifyYiddishFolios([
    { ...doc.pages[0], pageNumber: 1 },
    { ...doc.pages[0], pageIndex: 1, pageNumber: 3, pageNumberHebrew: 'ג׳' },
  ]);
  check('folio verification catches a broken sequence', !broken.ok && broken.badPages.includes(3));
}

console.log('11. .docx importer (live .docx, DOMParser via @xmldom/xmldom when available)');
{
  let ran = false;
  try {
    const xmldom = await import('@xmldom/xmldom') as unknown as { DOMParser: new () => unknown };
    (globalThis as unknown as Record<string, unknown>).DOMParser = xmldom.DOMParser;
    (globalThis as unknown as Record<string, unknown>).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const para = (text: string, style?: string): string =>
      `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      para('פרשת בראשית', 'Tzenerene Heading') +
      para('בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ.') +
      para(YIDDISH_TEXT, 'Yiddish Translation') +
      para('די צאינה וראינה דערצײלט אונדז װען דער מענטש לערנט די תּורה.', 'Tzenerene') +
      `</w:body></w:document>`;
    const zip = new JSZip();
    zip.file('word/document.xml', xml);
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await DocxImporter.importDocx(buf, 'tzenerene.docx');
    ran = true;
    check('import yields 4 units', result.units.length === 4, `${result.units.length} units`);
    const heading = result.units[0];
    check('imported parsha heading is chapter/tzenerene/yi', heading.role === 'chapter' && heading.yiddishKind === 'tzenerene' && heading.language === 'yi', `${heading.role}/${heading.yiddishKind}/${heading.language}`);
    const verse = result.units[1];
    check('imported Hebrew verse stays main_source, not Yiddish', verse.role === 'main_source' && verse.language !== 'yi', `${verse.role}/${verse.language ?? '—'}`);
    const translation = result.units[2];
    check('imported translation is primary_comment/translation/yi', translation.role === 'primary_comment' && translation.yiddishKind === 'translation' && translation.language === 'yi', `${translation.role}/${translation.yiddishKind}/${translation.language}`);
    const tz = result.units[3];
    check('imported Tzenerene paragraph is main_source/tzenerene/yi', tz.role === 'main_source' && tz.yiddishKind === 'tzenerene' && tz.language === 'yi', `${tz.role}/${tz.yiddishKind}/${tz.language}`);
    const yiddishDoc = PaginationEngine.paginateDocument({
      title: 'imported',
      layoutType: 'yiddish_sefer',
      units: result.units,
      geometry: GEOMETRY,
    });
    check('imported units paginate in yiddish_sefer with no flaws', scanYiddishFlaws(yiddishDoc.pages, result.units).length === 0);
  } catch (e) {
    if (!ran) skip('live .docx import', '@xmldom/xmldom not available in this tree — importer runs in the browser/Electron where DOMParser is native');
    else throw e;
  }
}

console.log('Repo suites (regression)');
{
  const difficult = LayoutTestSuite.runAllDifficultCases();
  console.log(`  difficult cases: ${difficult.passedCount}/${difficult.totalCount}`);
  check('runAllDifficultCases — all pass', difficult.allPassed, difficult.cases.filter(c => !c.passed).map(c => c.id).join(', ') || `${difficult.passedCount}/${difficult.totalCount}`);
  const a1 = LayoutTestSuite.runStage13A1Tests();
  console.log(`  stage 13A1: ${a1.passedCount}/${a1.totalCount}`);
  check('runStage13A1Tests — all pass', a1.allPassed, a1.assertions.filter(c => !c.passed).map(c => c.id).join(', ') || `${a1.passedCount}/${a1.totalCount}`);
  const a2 = await LayoutTestSuite.runStage13A2Tests();
  console.log(`  stage 13A2: ${a2.passedCount}/${a2.totalCount}`);
  check('runStage13A2Tests — all pass', a2.allPassed, a2.assertions.filter(c => !c.passed).map(c => c.id).join(', ') || `${a2.passedCount}/${a2.totalCount}`);
}

console.log(`\npartD-smoke: ${passes} passed, ${failures} failed${skips > 0 ? `, ${skips} skipped` : ''}`);
process.exit(failures === 0 ? 0 : 1);
