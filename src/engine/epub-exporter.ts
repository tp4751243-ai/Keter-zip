/**
 * Keter Typesetter — EPUB 3 Exporter (v0.3.0, module B)
 *
 * Original offline code. Builds a valid EPUB 3 package with JSZip:
 * uncompressed `mimetype` first, META-INF/container.xml, OEBPS/content.opf,
 * OEBPS/nav.xhtml and one XHTML file per chapter (split on chapter / siman
 * / main_title units). RTL throughout, Hebrew language tag.
 *
 * Limits (see report): no embedded fonts, no images, no footnotes as
 * popups — footnotes render as endnote-style linked notes at the end of
 * their chapter file.
 */

import JSZip from 'jszip';
import { ContentUnit } from '../types/typesetter';
import {
  BookExportSource,
  isBookDocument,
  normalizeExportUnits,
  unitPlainText,
} from './text-exporter';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CHAPTER_ROLES = new Set(['main_title', 'chapter', 'siman']);

interface EpubChapter {
  id: string;
  title: string;
  units: ContentUnit[];
}

function splitChapters(units: ContentUnit[]): EpubChapter[] {
  const chapters: EpubChapter[] = [];
  let current: EpubChapter | null = null;
  for (const unit of units) {
    if (CHAPTER_ROLES.has(unit.role) && unitPlainText(unit).trim()) {
      current = { id: `chapter-${chapters.length + 1}`, title: unitPlainText(unit).trim(), units: [unit] };
      chapters.push(current);
    } else if (current) {
      current.units.push(unit);
    } else {
      current = { id: 'chapter-1', title: '', units: [unit] };
      chapters.push(current);
    }
  }
  return chapters.filter(c => c.units.length > 0);
}

function unitToXhtml(unit: ContentUnit, footnoteIds: Map<string, number>): string {
  const text = escapeXml(unitPlainText(unit));
  if (!text.trim()) return '';
  const para = text.replace(/\n/g, '<br/>');
  switch (unit.role) {
    case 'main_title':
      return `<h1>${para}</h1>`;
    case 'chapter':
    case 'siman':
      return `<h2>${para}</h2>`;
    case 'heading':
    case 'subtitle':
      return `<h2>${para}</h2>`;
    case 'subheading':
    case 'seif':
      return `<h3>${para}</h3>`;
    case 'footnote': {
      const n = footnoteIds.get(unit.id) ?? 0;
      return `<li class="footnote" id="fn-${n}">${para}</li>`;
    }
    default:
      return `<p class="${escapeXml(unit.role)}">${para}</p>`;
  }
}

function chapterXhtml(chapter: EpubChapter, title: string): string {
  const footnoteIds = new Map<string, number>();
  let fnCount = 0;
  for (const u of chapter.units) {
    if (u.role === 'footnote') footnoteIds.set(u.id, ++fnCount);
  }
  const body: string[] = [];
  const notes: string[] = [];
  for (const unit of chapter.units) {
    if (unit.role === 'footnote') {
      notes.push(unitToXhtml(unit, footnoteIds));
    } else {
      body.push(unitToXhtml(unit, footnoteIds));
    }
  }
  if (notes.length > 0) {
    body.push('<section class="footnotes"><h2>הערות שוליים</h2><ol>' + notes.join('\n') + '</ol></section>');
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="he" dir="rtl" xml:lang="he">
<head><title>${escapeXml(chapter.title || title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body.join('\n')}
</body>
</html>
`;
}

const EPUB_CSS = `body { font-family: serif; line-height: 1.7; direction: rtl; }
h1 { text-align: center; font-size: 1.8em; margin: 1.5em 0 0.5em; }
h2 { font-size: 1.35em; margin: 1.5em 0 0.6em; border-bottom: 1px solid #ccc; padding-bottom: 0.2em; }
h3 { font-size: 1.15em; margin: 1.2em 0 0.5em; }
p { text-align: justify; margin: 0 0 0.8em; }
p.main_source { font-size: 1.1em; font-weight: bold; }
p.primary_comment, p.secondary_comment, p.tertiary_comment { font-size: 0.92em; }
section.footnotes { border-top: 1px solid #999; margin-top: 2em; padding-top: 0.8em; font-size: 0.88em; }
li.footnote { margin-bottom: 0.4em; }
`;

/** Main entry: export the book (units or typeset document) as an EPUB 3 Blob. */
export async function exportEpub(source: BookExportSource, title?: string): Promise<Blob> {
  const units = normalizeExportUnits(source);
  const docTitle = title ?? (isBookDocument(source) ? source.title : undefined) ?? 'ספר קודש';
  const chapters = splitChapters(units);
  const uuid = `urn:uuid:keter-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
  );

  const manifestItems = chapters
    .map(c => `    <item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spineItems = chapters.map(c => `    <itemref idref="${c.id}"/>`).join('\n');
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0" xml:lang="he">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(uuid)}</dc:identifier>
    <dc:title>${escapeXml(docTitle)}</dc:title>
    <dc:language>he</dc:language>
    <dc:creator>Keter Typesetter</dc:creator>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine page-progression-direction="rtl">
${spineItems}
  </spine>
</package>
`
  );

  const navPoints = chapters
    .map(
      (c, i) =>
        `      <li><a href="${c.id}.xhtml">${escapeXml(c.title || `${docTitle} — ${i + 1}`)}</a></li>`
    )
    .join('\n');
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="he" dir="rtl" xml:lang="he">
<head><title>תוכן העניינים</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>תוכן העניינים</h1><ol>
${navPoints}
</ol></nav>
</body>
</html>
`
  );

  zip.file('OEBPS/style.css', EPUB_CSS);
  for (const chapter of chapters) {
    zip.file(`OEBPS/${chapter.id}.xhtml`, chapterXhtml(chapter, docTitle));
  }

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}
