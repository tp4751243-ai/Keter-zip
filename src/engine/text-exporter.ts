/**
 * Keter Typesetter — Plain-Text Exporter (v0.3.0, module B)
 *
 * Original offline code. Exports the book as plain UTF-8 text: one text
 * line per typeset line, headings on their own lines. Also hosts the shared
 * `BookExportSource` normalizer used by the Word / EPUB / HTML exporters,
 * so every exporter accepts either raw content units or a typeset book.
 */

import {
  BookTypesetDocument,
  ContentUnit,
  PageTypesetResult,
  TypesetLine,
} from '../types/typesetter';

/** Everything the v0.3.0 exporters accept as input. */
export type BookExportSource = ContentUnit[] | BookTypesetDocument;

export function isBookDocument(source: BookExportSource): source is BookTypesetDocument {
  return !Array.isArray(source) && Array.isArray((source as BookTypesetDocument).pages);
}

/** Plain text of one unit: rawText, or its text runs joined. */
export function unitPlainText(unit: ContentUnit): string {
  if (unit.rawText && unit.rawText.trim().length > 0) return unit.rawText;
  if (unit.textRuns && unit.textRuns.length > 0) {
    return unit.textRuns.map(r => r.text).join('');
  }
  if (unit.tableData?.rows) {
    return (unit.tableData.rows as Array<{ cells?: Array<{ content?: string }> }>)
      .map(row => (row.cells ?? []).map(c => c.content ?? '').join(' | '))
      .join('\n');
  }
  return '';
}

function linePlainText(line: TypesetLine): string {
  const words = (line.words ?? [])
    .filter(w => !w.isSpace && w.text.trim().length > 0)
    .map(w => w.text);
  return words.join(' ');
}

/**
 * Normalize a book document into content units by grouping each page's
 * solved lines by (unitId, role). Footnote lines become `footnote` units;
 * heading lines keep their chapter/siman/heading roles. Order follows
 * page order, then line order.
 */
export function normalizeExportUnits(source: BookExportSource): ContentUnit[] {
  if (Array.isArray(source)) {
    return [...source].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  const units: ContentUnit[] = [];
  let order = 0;

  const pushLinesAsUnit = (page: PageTypesetResult, lines: TypesetLine[], group: string) => {
    let current: ContentUnit | null = null;
    const flush = () => {
      if (current && current.rawText.trim().length > 0) units.push(current);
      current = null;
    };
    for (const line of lines) {
      const text = linePlainText(line);
      if (!text) continue;
      const key = `${line.unitId ?? ''}|${line.role}`;
      if (!current || current.id !== `page-${page.pageIndex}-${group}-${key}`) {
        flush();
        current = {
          id: `page-${page.pageIndex}-${group}-${key}`,
          role: line.role,
          rawText: text,
          styleName: 'keter-export',
          order: order++,
          hierarchyLevel: 0,
        };
        if (line.role === 'footnote') {
          current.footnoteAnchorUnitId = line.unitId;
        }
      } else {
        current.rawText += `\n${text}`;
      }
    }
    flush();
  };

  for (const page of source.pages) {
    pushLinesAsUnit(page, page.sourceLines ?? [], 'source');
    pushLinesAsUnit(page, page.column2Lines ?? [], 'column2');
    pushLinesAsUnit(page, page.rashiLines ?? [], 'rashi');
    pushLinesAsUnit(page, page.tosafotLines ?? [], 'tosafot');
    pushLinesAsUnit(page, page.footnoteLines ?? [], 'footnote');
  }
  return units;
}

/** Heading roles get a blank line before them and are upper-cased visually by the caller if wanted. */
const HEADING_ROLES = new Set(['main_title', 'chapter', 'siman', 'heading', 'subheading', 'subtitle']);

/** Render units as plain text: one text line per line, headings on their own lines. */
export function unitsToPlainText(units: ContentUnit[], title?: string): string {
  const out: string[] = [];
  if (title) {
    out.push(title, '');
  }
  for (const unit of units) {
    const text = unitPlainText(unit);
    if (!text.trim()) continue;
    if (HEADING_ROLES.has(unit.role)) {
      out.push('', text, '');
    } else if (unit.role === 'footnote') {
      out.push(`[${unit.footnoteNumber ?? ''}] ${text}`.replace(/^\[\] /, ''));
    } else {
      out.push(text);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Main entry: export the book (units or typeset document) as a UTF-8 .txt Blob. */
export function exportText(source: BookExportSource, title?: string): Blob {
  const units = normalizeExportUnits(source);
  const docTitle = title ?? (isBookDocument(source) ? source.title : undefined);
  return new Blob([unitsToPlainText(units, docTitle)], { type: 'text/plain;charset=utf-8' });
}
