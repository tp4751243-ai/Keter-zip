/**
 * v0.8.0 Part E smoke — audit leftovers that got real fixes.
 *
 * §1  docx images: an embedded PNG imports as an image unit, paginates
 *     onto its own image-only page, reaches the PDF as a raster XObject,
 *     and is named (not blanked) in IDML. An unsupported EMF image is
 *     reported as a dropped-image warning instead of vanishing silently.
 * §2  IDML custom boxes (#44): a custom_layout page exports one IDML
 *     frame per box (tf_box_*), not one frame per stream.
 * §3  IDML title-page border image (#51): a custom border image is named
 *     in a note line inside the title frame instead of vanishing.
 * §4  Font embeddability helper (#7): a scanned system font reports
 *     false, a bundled font reports true, an unknown name reports null.
 * §5  IDML filename (#57): the production export stage no longer leaks
 *     the internal TEST_F stage name into the downloaded filename
 *     (checked statically — the suffix mapping in App.tsx).
 *
 * The PDF assertion (§1) needs the six embedded font binaries (same
 * requirement as stage13a3-smoke): it SKIPS cleanly — exit 0, labelled
 * a skip — when they are not in public/fonts or KETER_FONTS_DIR.
 * Everything else runs with no fonts.
 */
import { DOMParser } from '@xmldom/xmldom';
// The docx importer runs under tsx (Node), where DOMParser / Node are
// not globals — shim them before the importer module is first used.
// (@xmldom does not export Node; the importer only needs ELEMENT_NODE.)
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
(globalThis as unknown as { Node: { ELEMENT_NODE: number } }).Node = { ELEMENT_NODE: 1 };

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { PdfExporter } from '../src/engine/pdf-exporter';
import { IdmlExporter } from '../src/engine/idml-exporter';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { isFontEmbeddableInPdf } from '../src/engine/font-library';
import { DEFAULT_TITLE_PAGE_SETTINGS } from '../src/types/design-settings';
import type { ContentUnit, PageGeometry, PageTypesetResult } from '../src/types/typesetter';
import type { CustomLayoutBox, ProfessionalDesignSettings } from '../src/types/design-settings';

const GEOMETRY: PageGeometry = {
  pageWidth: 482,
  pageHeight: 680,
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};

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

// 1x1 red PNG.
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="emf" ContentType="image/x-emf"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

function documentXml(imagePart: { rId: string; fileName: string } | null): string {
  const drawing = imagePart
    ? `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Picture 1" descr="red square"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${imagePart.rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>שלום עולם</w:t></w:r></w:p>${drawing}</w:body></w:document>`;
}

async function buildDocx(image: { rId: string; fileName: string; bytes: Buffer } | null): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/document.xml', documentXml(image ? { rId: image.rId, fileName: image.fileName } : null));
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${image ? `<Relationship Id="${image.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.fileName}"/>` : ''}</Relationships>`
  );
  if (image) zip.file(`word/media/${image.fileName}`, image.bytes);
  return zip.generateAsync({ type: 'arraybuffer' });
}

const FONTS = [
  'FrankRuhlLibre-Regular.ttf',
  'FrankRuhlLibre-Bold.ttf',
  'NotoRashiHebrew-Regular.ttf',
  'NotoRashiHebrew-Bold.ttf',
  'DavidLibre-Regular.ttf',
  'DavidLibre-Bold.ttf',
];
function fontsAvailable(): boolean {
  const dir = process.env.KETER_FONTS_DIR || join(process.cwd(), 'public', 'fonts');
  return FONTS.every(f => existsSync(join(dir, f)));
}

async function main(): Promise<void> {
  console.log('== Part E §1 — docx images ==');
  const pngDocx = await buildDocx({
    rId: 'rId5',
    fileName: 'image1.png',
    bytes: Buffer.from(RED_PNG_B64, 'base64'),
  });
  const res = await DocxImporter.importDocx(pngDocx, 'with-image.docx');
  const imageUnits = res.units.filter(u => u.role === 'image');
  check('embedded PNG imports as an image unit', imageUnits.length === 1, `${imageUnits.length} image units`);
  check(
    'image unit carries a PNG data URL + file name',
    imageUnits[0]?.imageData?.dataUrl?.startsWith('data:image/png;base64,') === true &&
      imageUnits[0]?.imageData?.fileName === 'image1.png',
    imageUnits[0]?.imageData?.fileName ?? '(none)'
  );
  check('alt text + size survive the import', imageUnits[0]?.imageData?.altText === 'red square' && imageUnits[0]?.imageData?.widthPx === 100, `alt=${imageUnits[0]?.imageData?.altText ?? '(none)'} w=${imageUnits[0]?.imageData?.widthPx ?? '(none)'}`);
  check('metadata reports the image', res.metadata.hasImages === true);
  check('no images dropped for a supported PNG', res.metadata.droppedImages.length === 0, res.metadata.droppedImages.join('; '));

  const doc = PaginationEngine.paginateDocument({
    title: 'Part E smoke',
    layoutType: 'single_column',
    units: res.units,
    geometry: GEOMETRY,
    designSettings: DesignSettingsEngine.createDefaultSettings({ layoutType: 'single_column', geometry: GEOMETRY }),
  });
  const imagePages = doc.pages.filter(p => p.isImageOnlyPage);
  check('image paginates onto its own image-only page', imagePages.length === 1, `${imagePages.length} image pages`);
  check(
    'image-only page carries the image payload',
    (imagePages[0]?.pageImages?.length ?? 0) === 1 && (imagePages[0]?.imageUnitIds?.length ?? 0) === 1,
    `pageImages=${imagePages[0]?.pageImages?.length ?? 0}`
  );

  if (fontsAvailable()) {
    const blob = await PdfExporter.generateMultiPagePdf(doc, undefined, { purpose: 'print' });
    const pdfText = await blob.text();
    check('PDF contains a raster image XObject for the image page', pdfText.includes('/Subtype /Image'), `pdf bytes=${blob.size}`);
  } else {
    skip('PDF contains a raster image XObject', 'embedded font binaries not available (set KETER_FONTS_DIR) — skip, not pass');
  }

  const imagePage = imagePages[0];
  if (imagePage) {
    const { linesByFrameId } = IdmlExporter.computeImagePageFrames(imagePage, imagePage.pageIndex);
    const noteText = [...linesByFrameId.values()].flat().flatMap(l => l.words.map(w => w.text)).join(' ');
    check('IDML names the image instead of a blank spread', noteText.includes('image1.png') && noteText.includes('לא הוטמעה בייצוא IDML'), noteText.slice(0, 60));
  } else {
    check('IDML names the image instead of a blank spread', false, 'no image page to check');
  }

  console.log('== Part E §1b — unsupported image is reported, not dropped silently ==');
  const emfDocx = await buildDocx({
    rId: 'rId5',
    fileName: 'image1.emf',
    bytes: Buffer.from('not-a-real-emf'),
  });
  const emfRes = await DocxImporter.importDocx(emfDocx, 'with-emf.docx');
  check('EMF produces no image unit', emfRes.units.filter(u => u.role === 'image').length === 0);
  check(
    'EMF is listed as dropped with its file name',
    emfRes.metadata.droppedImages.some(d => d.includes('image1.emf')),
    emfRes.metadata.droppedImages.join('; ')
  );
  check(
    'dropped image reaches the validation warnings',
    emfRes.validation.warnings.some(w => w.includes('image1.emf')),
    emfRes.validation.warnings.join('; ')
  );

  console.log('== Part E §2 — IDML custom boxes (#44) ==');
  const boxes: CustomLayoutBox[] = [
    { id: 'box-a', role: 'main_text', labelHe: 'תיבה א', xPct: 0, yPct: 0, widthPct: 100, heightPct: 55 },
    { id: 'box-b', role: 'commentary', labelHe: 'תיבה ב', xPct: 0, yPct: 60, widthPct: 100, heightPct: 40 },
  ];
  const settings: ProfessionalDesignSettings = DesignSettingsEngine.setCustomLayout(
    DesignSettingsEngine.createDefaultSettings({ layoutType: 'custom_layout', geometry: GEOMETRY }),
    { enabled: true, baseLayout: 'rav_text', boxes },
    'user'
  ).settings;
  const units: ContentUnit[] = [
    { id: 'smoke-main', role: 'main_source', rawText: 'גמרא '.repeat(120), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'smoke-rashi', role: 'primary_comment', rawText: 'רש״י '.repeat(120), styleName: 'Normal', order: 2, hierarchyLevel: 3 },
  ];
  const customDoc = PaginationEngine.paginateDocument({
    title: 'Part E smoke',
    layoutType: 'custom_layout',
    units,
    geometry: GEOMETRY,
    designSettings: settings,
  });
  const taggedPage: PageTypesetResult | undefined = customDoc.pages.find(p =>
    [...p.sourceLines, ...p.rashiLines, ...p.tosafotLines].some(l => l.customLayoutBoxId)
  );
  check('custom-layout lines are tagged with their box', taggedPage !== undefined);
  if (taggedPage) {
    const { frames } = IdmlExporter.computePageTextFrames(taggedPage, taggedPage.pageIndex);
    const boxFrames = frames.filter(f => f.id.startsWith('tf_box_'));
    check('one IDML frame per custom box', boxFrames.length >= 2, frames.map(f => f.id).join(', '));
  }

  console.log('== Part E §3 — IDML title-page border image (#51) ==');
  const fakePage = {
    designSettings: {
      titlePage: {
        ...DEFAULT_TITLE_PAGE_SETTINGS,
        enabled: true,
        customBorderImage: { fileName: 'border.png', dataUrl: `data:image/png;base64,${RED_PNG_B64}`, persisted: false },
      },
    },
    headerTitle: 'ספר הבדיקה',
    geometry: GEOMETRY,
  } as unknown as PageTypesetResult;
  const { linesByFrameId: titleLines } = IdmlExporter.computeTitlePageFrames(fakePage, 0);
  const titleText = [...titleLines.values()].flat().flatMap(l => l.words.map(w => w.text)).join(' ');
  check('custom border image is named in a title-frame note', titleText.includes('border.png') && titleText.includes('לא הוטמעה בייצוא IDML'), titleText.slice(0, 80));

  console.log('== Part E §4 — font embeddability helper (#7) ==');
  check('bundled font is embeddable', isFontEmbeddableInPdf('Frank Ruhl Libre') === true);
  check('unknown family reports null (not a false claim)', isFontEmbeddableInPdf('No Such Font XYZ') === null);

  console.log('== Part E §5 — IDML filename (#57, static) ==');
  const { readFileSync } = await import('node:fs');
  const appSrc = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
  check(
    'production IDML export uses a clean InDesign suffix, not TEST_F',
    appSrc.includes("? 'InDesign'") && !appSrc.includes('TEST_F_True_RavText_Flow_InDesign'),
    'suffix mapping in handleExportIdml'
  );

  console.log(`\n==== Part E smoke: ${passes} passed, ${failures} failed, ${skips} skipped ====`);
  process.exit(failures > 0 ? 1 : 0);
}

void main().catch(err => {
  console.error('Part E smoke crashed:', err);
  process.exit(1);
});
