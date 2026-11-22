/**
 * Keter Typesetter — Standalone HTML Exporter (v0.3.0, module B)
 *
 * Original offline code. Exports the book as a single self-contained RTL
 * HTML file with embedded CSS (no external fonts, scripts, or network).
 * Headings map to <h1>–<h3>, commentary to styled paragraphs, footnotes to
 * a numbered list with back-anchors.
 */

import { ContentUnit } from '../types/typesetter';
import {
  BookExportSource,
  isBookDocument,
  normalizeExportUnits,
  unitPlainText,
} from './text-exporter';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ROLE_CLASS: Partial<Record<string, string>> = {
  main_title: 'book-title',
  subtitle: 'subtitle',
  chapter: 'chapter',
  siman: 'siman',
  heading: 'heading',
  subheading: 'subheading',
  seif: 'seif',
  main_source: 'main-source',
  verse: 'verse',
  primary_comment: 'commentary primary',
  secondary_comment: 'commentary secondary',
  tertiary_comment: 'commentary tertiary',
  dibbur_hamatchil: 'dibbur',
  footnote: 'footnote',
  side_note: 'side-note',
  cross_reference: 'cross-ref',
  regular_paragraph: 'paragraph',
  list_item: 'list-item',
  caption: 'caption',
};

function unitToHtml(unit: ContentUnit, footnoteIndex: Map<string, number>): string {
  const text = escapeHtml(unitPlainText(unit)).replace(/\n/g, '<br>');
  if (!text.trim()) return '';
  const cls = ROLE_CLASS[unit.role] ?? 'paragraph';

  switch (unit.role) {
    case 'main_title':
      return `<h1 class="${cls}">${text}</h1>`;
    case 'chapter':
    case 'siman':
      return `<h2 class="${cls}">${text}</h2>`;
    case 'heading':
    case 'subtitle':
      return `<h2 class="${cls}">${text}</h2>`;
    case 'subheading':
    case 'seif':
      return `<h3 class="${cls}">${text}</h3>`;
    case 'footnote': {
      const n = footnoteIndex.get(unit.id) ?? 0;
      return `<li class="${cls}" id="fn-${n}">${text} <a class="fn-back" href="#fnref-${n}">↩</a></li>`;
    }
    case 'list_item':
      return `<li class="${cls}">${text}</li>`;
    default:
      return `<p class="${cls}">${text}</p>`;
  }
}

/** Render units as a standalone RTL HTML document string. */
export function unitsToHtml(units: ContentUnit[], title?: string): string {
  const body: string[] = [];
  const footnotes: ContentUnit[] = [];
  const footnoteIndex = new Map<string, number>();

  for (const unit of units) {
    if (unit.role === 'footnote') {
      footnoteIndex.set(unit.id, footnotes.length + 1);
      footnotes.push(unit);
      continue;
    }
    const text = unitPlainText(unit);
    if (!text.trim()) continue;
    // Inline footnote anchors: a run carrying footnoteMarker renders as a superscript link.
    let html = unitToHtml(unit, footnoteIndex);
    const markers = (unit.textRuns ?? []).filter(r => r.footnoteMarker !== undefined);
    if (markers.length > 0 && html.startsWith('<p')) {
      const sup = markers
        .map(r => {
          const fnUnit = footnotes.find(f => f.id === r.footnoteUnitId);
          const n = fnUnit ? footnoteIndex.get(fnUnit.id) ?? '' : r.footnoteMarker;
          return `<sup class="fn-ref"><a id="fnref-${n}" href="#fn-${n}">${n}</a></sup>`;
        })
        .join('');
      html = html.replace(/<\/p>$/, `${sup}</p>`);
    }
    body.push(html);
  }

  const footnotesHtml =
    footnotes.length > 0
      ? `<section class="footnotes"><h2 class="footnotes-title">הערות שוליים</h2><ol>${footnotes
          .map(u => unitToHtml(u, footnoteIndex))
          .join('\n')}</ol></section>`
      : '';

  const safeTitle = escapeHtml(title ?? 'ספר קודש');
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: "Frank Ruhl Libre", "Noto Serif Hebrew", "David", serif; max-width: 42em; margin: 0 auto; padding: 2rem 1.25rem 4rem; line-height: 1.7; color: #1c1a17; background: #fcfaf5; }
  h1.book-title { text-align: center; font-size: 2.1rem; margin: 2rem 0 0.5rem; }
  h2.subtitle { text-align: center; font-size: 1.25rem; font-weight: 400; color: #6b5e4c; margin: 0 0 2rem; }
  h2.chapter, h2.siman, h2.heading { font-size: 1.4rem; margin: 2rem 0 0.75rem; border-bottom: 1px solid #d8cfc2; padding-bottom: 0.25rem; }
  h3.subheading, h3.seif { font-size: 1.15rem; margin: 1.5rem 0 0.5rem; }
  p { margin: 0 0 0.9rem; text-align: justify; }
  p.main-source { font-size: 1.12rem; font-weight: 600; }
  p.commentary { font-size: 0.95rem; color: #2a2724; }
  p.dibbur { font-weight: 700; }
  p.side-note, p.cross-ref { font-size: 0.9rem; color: #6b5e4c; }
  sup.fn-ref a { color: #92400e; text-decoration: none; font-size: 0.75em; }
  section.footnotes { border-top: 1px solid #b8aea0; margin-top: 2.5rem; padding-top: 1rem; font-size: 0.88rem; }
  section.footnotes h2 { font-size: 1rem; }
  li.footnote { margin-bottom: 0.4rem; }
  a.fn-back { color: #92400e; text-decoration: none; }
  @media print { body { background: #fff; } }
</style>
</head>
<body>
${body.join('\n')}
${footnotesHtml}
</body>
</html>
`;
}

/** Main entry: export the book (units or typeset document) as a standalone .html Blob. */
export function exportHtml(source: BookExportSource, title?: string): Blob {
  const units = normalizeExportUnits(source);
  const docTitle = title ?? (isBookDocument(source) ? source.title : undefined);
  return new Blob([unitsToHtml(units, docTitle)], { type: 'text/html;charset=utf-8' });
}
