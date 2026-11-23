/**
 * Keter Typesetter — Word (.docx) Exporter (v0.3.0, module B)
 *
 * Original offline code. Builds a minimal but valid Word document with
 * JSZip: [Content_Types].xml, _rels/.rels, word/document.xml,
 * word/footnotes.xml, word/styles.xml and the footnotes relationship.
 * Headings map to Word Heading 1–3, commentary/source keep their roles as
 * paragraph styles, and every `footnote` content unit becomes a real Word
 * footnote anchored at the end of its anchor unit's paragraph
 * (`footnoteAnchorUnitId`, as produced by the .docx importer).
 *
 * Fidelity limits (see report): no HarfBuzz shaping metadata, no nikud
 * positioning beyond the Unicode text itself, no tables/images, no
 * two-column / knee layout — Word reflows the text with its own engine.
 * Footnote anchors land at the end of the anchor paragraph, not at the
 * exact anchor word.
 */

import JSZip from 'jszip';
import { ContentUnit } from '../types/typesetter';
import {
  BookExportSource,
  isBookDocument,
  normalizeExportUnits,
  unitPlainText,
} from './text-exporter';
import { paraIsRtl, splitByScript, stripDirectionalMarks } from './docx-rtl';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Word half-point size per role (1pt = 2 half-points). */
function roleFontSizeHalfPoints(role: string): number {
  switch (role) {
    case 'main_title':
      return 44;
    case 'chapter':
    case 'siman':
      return 32;
    case 'heading':
      return 28;
    case 'subheading':
    case 'seif':
      return 26;
    case 'main_source':
      return 28;
    case 'primary_comment':
    case 'secondary_comment':
    case 'tertiary_comment':
      return 22;
    case 'footnote':
      return 20;
    default:
      return 24;
  }
}

function roleParagraphStyle(role: string): string {
  switch (role) {
    case 'main_title':
      return 'Title';
    case 'chapter':
    case 'siman':
      return 'Heading1';
    case 'heading':
    case 'subtitle':
      return 'Heading2';
    case 'subheading':
    case 'seif':
      return 'Heading3';
    default:
      return 'Normal';
  }
}

function roleIsBold(role: string): boolean {
  return (
    role === 'main_title' ||
    role === 'chapter' ||
    role === 'siman' ||
    role === 'heading' ||
    role === 'main_source' ||
    role === 'dibbur_hamatchil'
  );
}

const WORD_FONT = 'Frank Ruhl Libre';

/**
 * Text runs; `text` may contain \n which become <w:br/>.
 * Layout training T4 (hebrew-document-generator rules, docx-rtl.ts): the
 * text is split into runs by script, Hebrew runs carry <w:rtl/>, Latin
 * and digit runs never do; every run sets the complex-script font/size,
 * and bold/italic set w:bCs/w:iCs too (Word applies w:b only to Latin);
 * directional marks are stripped (Word draws them as boxes).
 */
function runXml(text: string, opts: { bold?: boolean; sizeHp?: number; italic?: boolean } = {}): string {
  const parts = stripDirectionalMarks(text).split('\n');
  const rPr = (rtl: boolean) =>
    [
      `<w:rFonts w:ascii="${WORD_FONT}" w:hAnsi="${WORD_FONT}" w:cs="${WORD_FONT}"/>`,
      opts.bold ? '<w:b/><w:bCs/>' : '',
      opts.italic ? '<w:i/><w:iCs/>' : '',
      opts.sizeHp ? `<w:sz w:val="${opts.sizeHp}"/><w:szCs w:val="${opts.sizeHp}"/>` : '',
      rtl ? '<w:rtl/>' : '',
    ].join('');
  return parts
    .map((part, i) => {
      const br = i > 0 ? `<w:r>${'<w:br/>'}</w:r>` : '';
      if (!part) return br;
      return (
        br +
        splitByScript(part)
          .map(([seg, rtl]) => {
            const space = /^\s|\s$/.test(seg) ? ' xml:space="preserve"' : '';
            return `<w:r><w:rPr>${rPr(rtl)}</w:rPr><w:t${space}>${escapeXml(seg)}</w:t></w:r>`;
          })
          .join('')
      );
    })
    .join('');
}

/**
 * Paragraph properties for a Hebrew book paragraph. RTL paragraphs never
 * get jc="right" (logical: that is the line END = visual LEFT in Word);
 * no jc starts at the visual right. Titles centre; body text justifies.
 */
function paragraphPPr(style: string, text: string, align: 'center' | 'start' | 'justify'): string {
  const rtl = paraIsRtl(text);
  const jc =
    align === 'center' ? '<w:jc w:val="center"/>' : align === 'justify' ? '<w:jc w:val="both"/>' : rtl ? '' : '<w:jc w:val="left"/>';
  return `<w:pStyle w:val="${style}"/>${rtl ? '<w:bidi w:val="1"/>' : ''}${jc}`;
}

function paragraphXml(
  unit: ContentUnit,
  footnoteRefs: number[],
  footnoteIdByUnit: Map<string, number>
): string {
  const style = roleParagraphStyle(unit.role);
  const sizeHp = roleFontSizeHalfPoints(unit.role);
  const bold = roleIsBold(unit.role);
  const align: 'center' | 'start' | 'justify' =
    unit.role === 'main_title' || unit.role === 'subtitle'
      ? 'center'
      : unit.role === 'chapter' || unit.role === 'heading' || unit.role === 'subheading'
        ? 'start'
        : 'justify';

  const refsXml = footnoteRefs
    .map(
      id =>
        `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`
    )
    .join('');

  // Runs that carry an explicit footnote marker get their reference inline
  // right after the run; other footnotes anchor at the paragraph end.
  let runsXml = '';
  const runs = unit.textRuns ?? [];
  if (runs.length > 0 && runs.some(r => r.footnoteMarker !== undefined || r.text)) {
    for (const r of runs) {
      runsXml += runXml(r.text, {
        bold: bold || r.isBold,
        italic: r.isItalic,
        sizeHp: r.fontSizePt ? Math.round(r.fontSizePt * 2) : sizeHp,
      });
      if (r.footnoteUnitId) {
        const id = footnoteIdByUnit.get(r.footnoteUnitId);
        if (id !== undefined) {
          runsXml += `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
        }
      }
    }
  } else {
    runsXml = runXml(unitPlainText(unit), { bold, sizeHp });
  }

  return `<w:p><w:pPr>${paragraphPPr(style, unitPlainText(unit), align)}<w:rPr><w:rFonts w:ascii="${WORD_FONT}" w:hAnsi="${WORD_FONT}" w:cs="${WORD_FONT}"/><w:sz w:val="${sizeHp}"/><w:szCs w:val="${sizeHp}"/></w:rPr></w:pPr>${runsXml}${refsXml}</w:p>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>
`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>
`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="${WORD_FONT}" w:hAnsi="${WORD_FONT}" w:cs="${WORD_FONT}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="he-IL" w:bidi="he-IL"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:bidi w:val="1"/><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:bidi w:val="1"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:bidi w:val="1"/><w:jc w:val="center"/><w:spacing w:before="480" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:bidi w:val="1"/><w:spacing w:before="360" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:bidi w:val="1"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:bidi w:val="1"/><w:spacing w:before="240" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="Footnote Reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="Footnote Text"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi w:val="1"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
</w:styles>
`;

const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:bidi w:val="1"/>
  <w:defaultTabStop w:val="720"/>
  <w:footnotePr><w:pos w:val="pageBottom"/><w:numFmt w:val="decimal"/></w:footnotePr>
</w:settings>
`;

/** Main entry: export the book (units or typeset document) as a .docx Blob. */
export async function exportWord(source: BookExportSource, title?: string): Promise<Blob> {
  const units = normalizeExportUnits(source);
  const docTitle = title ?? (isBookDocument(source) ? source.title : undefined) ?? 'ספר קודש';

  // Word reserves footnote ids 0 (separator) and 1 (continuation); ours start at 2.
  const footnoteUnits = units.filter(u => u.role === 'footnote');
  const footnoteIdByUnit = new Map<string, number>();
  footnoteUnits.forEach((u, i) => footnoteIdByUnit.set(u.id, i + 2));

  // Which footnote ids anchor on each paragraph (by anchor unit id).
  const refsByAnchorUnit = new Map<string, number[]>();
  for (const fn of footnoteUnits) {
    const anchorId = fn.footnoteAnchorUnitId;
    if (!anchorId) continue;
    const id = footnoteIdByUnit.get(fn.id)!;
    const list = refsByAnchorUnit.get(anchorId) ?? [];
    list.push(id);
    refsByAnchorUnit.set(anchorId, list);
  }

  const bodyUnits = units.filter(u => u.role !== 'footnote');
  const paragraphs: string[] = [];

  // Title paragraph from the document title when no main_title unit exists.
  if (!bodyUnits.some(u => u.role === 'main_title')) {
    paragraphs.push(
      `<w:p><w:pPr><w:pStyle w:val="Title"/><w:bidi w:val="1"/><w:jc w:val="center"/></w:pPr>${runXml(docTitle, { bold: true, sizeHp: 44 })}</w:p>`
    );
  }

  for (const unit of bodyUnits) {
    if (!unitPlainText(unit).trim() && !(unit.textRuns ?? []).some(r => r.text.trim())) continue;
    // Footnote refs already emitted inline from a run's footnoteUnitId are
    // skipped here so they are not duplicated at the paragraph end.
    const inlineIds = new Set(
      (unit.textRuns ?? [])
        .map(r => (r.footnoteUnitId ? footnoteIdByUnit.get(r.footnoteUnitId) : undefined))
        .filter((n): n is number => n !== undefined)
    );
    const refs = (refsByAnchorUnit.get(unit.id) ?? []).filter(id => !inlineIds.has(id));
    paragraphs.push(paragraphXml(unit, refs, footnoteIdByUnit));
  }

  // Footnotes whose anchor unit is missing still get a home: append their
  // reference to the last paragraph so the note is reachable.
  const orphanIds = footnoteUnits
    .filter(fn => !fn.footnoteAnchorUnitId || !bodyUnits.some(u => u.id === fn.footnoteAnchorUnitId))
    .map(fn => footnoteIdByUnit.get(fn.id)!);
  if (orphanIds.length > 0 && paragraphs.length > 0) {
    const refsXml = orphanIds
      .map(
        id =>
          `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`
      )
      .join('');
    paragraphs[paragraphs.length - 1] = paragraphs[paragraphs.length - 1].replace(
      /<\/w:p>$/,
      `${refsXml}</w:p>`
    );
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paragraphs.join('\n')}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>
`;

  const footnoteEntries = footnoteUnits.map(fn => {
    const id = footnoteIdByUnit.get(fn.id)!;
    const num = fn.footnoteNumber ?? id - 1;
    const text = unitPlainText(fn);
    return `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/><w:bidi w:val="1"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef w:id="${id}"/></w:r>${runXml(`${num}. ${text}`, { sizeHp: 20 })}</w:p></w:footnote>`;
  });

  const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
${footnoteEntries.join('\n')}
</w:footnotes>
`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', PACKAGE_RELS);
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', STYLES_XML);
  zip.file('word/settings.xml', SETTINGS_XML);
  zip.file('word/footnotes.xml', footnotesXml);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
