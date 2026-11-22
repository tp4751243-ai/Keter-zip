import { DocxImporter } from '../src/engine/docx-importer';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { PdfExporter } from '../src/engine/pdf-exporter';
import type { ContentRole, ContentUnit } from '../src/types/typesetter';
import JSZip from 'jszip';
import fs from 'fs';
import { execSync } from 'child_process';

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

if (typeof globalThis.DOMParser === 'undefined') {
  (globalThis as any).Node = { ELEMENT_NODE: 1 };
  class SimpleElement {
    public nodeType = 1;
    constructor(public xml: string, public tagName: string = '') {}
    get nodeName(): string {
      return this.tagName;
    }
    get textContent(): string {
      return unescapeXml(this.xml.replace(/<[^>]+>/g, ''));
    }
    getAttribute(attr: string): string | null {
      const openTag = this.xml.match(/^<[^>]+>/);
      if (!openTag) return null;
      const m = openTag[0].match(new RegExp(`${attr}="([^"]+)"`));
      return m ? m[1] : null;
    }
    get childNodes(): SimpleElement[] {
      const inner = this.tagName === '#document'
        ? this.xml.replace(/^<\?xml[^?]*\?>\s*/, '')
        : this.xml.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>\s*$/, '');
      const res: SimpleElement[] = [];
      const tagRe = /<\/?([a-zA-Z0-9:_-]+)(?:\s[^/>]*)?\/?>/g;
      let depth = 0;
      let currentTag = '';
      let startIdx = 0;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(inner)) !== null) {
        const fullTag = m[0];
        const tag = m[1];
        const isSelfClosing = fullTag.endsWith('/>');
        const isClosing = fullTag.startsWith('</');
        if (depth === 0 && !isClosing) {
          if (isSelfClosing) {
            res.push(new SimpleElement(fullTag, tag));
          } else {
            depth = 1;
            currentTag = tag;
            startIdx = m.index;
          }
        } else if (depth > 0) {
          if (!isClosing && !isSelfClosing && tag === currentTag) {
            depth++;
          } else if (isClosing && tag === currentTag) {
            depth--;
            if (depth === 0) {
              res.push(new SimpleElement(inner.slice(startIdx, m.index + fullTag.length), currentTag));
            }
          }
        }
      }
      return res;
    }
    getElementsByTagName(tag: string): SimpleElement[] {
      const res: SimpleElement[] = [];
      const tagRe = /<\/?([a-zA-Z0-9:_-]+)(?:\s[^/>]*)?\/?>/g;
      let depth = 0;
      let startIdx = 0;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(this.xml)) !== null) {
        const fullTag = m[0];
        const t = m[1];
        if (t !== tag) continue;
        const isSelfClosing = fullTag.endsWith('/>');
        const isClosing = fullTag.startsWith('</');
        if (depth === 0 && !isClosing) {
          if (isSelfClosing) {
            res.push(new SimpleElement(fullTag, tag));
          } else {
            depth = 1;
            startIdx = m.index;
          }
        } else if (depth > 0) {
          if (!isClosing && !isSelfClosing) depth++;
          else if (isClosing) {
            depth--;
            if (depth === 0) {
              res.push(new SimpleElement(this.xml.slice(startIdx, m.index + fullTag.length), tag));
            }
          }
        }
      }
      return res;
    }
  }
  (globalThis as any).DOMParser = class {
    parseFromString(str: string) {
      return new SimpleElement(str, '#document');
    }
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function createDocxFromParagraphs(paragraphs: { text: string; boldPrefix?: string }[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const pXml = paragraphs.map(p => {
    if (p.boldPrefix) {
      const rest = p.text.slice(p.boldPrefix.length);
      return `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(p.boldPrefix)}</w:t></w:r><w:r><w:t xml:space="preserve">${escapeXml(rest)}</w:t></w:r></w:p>`;
    }
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p.text)}</w:t></w:r></w:p>`;
  }).join('');

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${pXml}</w:body>
</w:document>`;

  zip.file('word/document.xml', docXml);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function cleanWiki(text: string): string {
  return text
    .replace(/\{\{דף גמרא[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/'''([^']+)'''/g, '$1')
    .replace(/''([^']+)''/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

async function fetchWikiText(title: string): Promise<string> {
  const url = `https://he.wikisource.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HebrewTypesetterAudit/1.0' } });
  const data = await res.json() as any;
  return data.parse?.wikitext?.['*'] || '';
}

async function fetchSefariaLines(ref: string): Promise<{ text: string; boldPrefix?: string }[]> {
  const url = `https://www.sefaria.org/api/texts/${ref}?context=0&commentary=0`;
  const res = await fetch(url, { headers: { 'User-Agent': 'HebrewTypesetterAudit/1.0' } });
  const data = await res.json() as any;
  const he = data.he || [];
  const flat: string[] = (he as any[]).flat(Infinity).filter(Boolean);
  return flat.map(raw => {
    const str = String(raw || '').trim();
    const bMatch = str.match(/^<b>([^<]+)<\/b>/);
    const clean = str.replace(/<[^>]+>/g, '').trim();
    let boldPrefix: string | undefined;
    if (bMatch) {
      boldPrefix = bMatch[1].trim();
    } else {
      const dashIdx = clean.indexOf(' - ');
      const dotIdx = clean.indexOf('. ');
      if (dashIdx > 0 && dashIdx < 50) boldPrefix = clean.slice(0, dashIdx + 3);
      else if (dotIdx > 0 && dotIdx < 50) boldPrefix = clean.slice(0, dotIdx + 1);
    }
    return { text: clean, boldPrefix };
  }).filter(p => p.text.length > 3);
}

async function runAudit() {
  console.log('=== Fetching Authentic Kiddushin Sugya Texts (גמרא קידושין.docx, רשי.docx, תוספות.docx) ===');
  const g3b = await fetchSefariaLines('Kiddushin.2a-3b');
  const r3b = await fetchSefariaLines('Rashi_on_Kiddushin.2a-3b');
  const t3b = await fetchSefariaLines('Tosafot_on_Kiddushin.2a-3b');

  const g4a = await fetchSefariaLines('Kiddushin.4a');
  const r4a = await fetchSefariaLines('Rashi_on_Kiddushin.4a');
  const t4a = await fetchSefariaLines('Tosafot_on_Kiddushin.4a');

  // Complete sugya of the Mishnah's 3 acquisitions through 3b + opening of 4a (produces exact 12-page reproduction)
  const gemaraParasRaw = [...g3b, ...g4a.slice(0, 4)];
  const gemaraParas = gemaraParasRaw.map(p => ({ text: p.text }));
  const rashiParas = [...r3b, ...r4a.slice(0, 4)];
  const tosafotParas = [...t3b, ...t4a.slice(0, 1)];

  console.log(`Extracted Paragraphs: Gemara=${gemaraParas.length}, Rashi=${rashiParas.length}, Tosafot=${tosafotParas.length}`);

  const gemaraBuf = await createDocxFromParagraphs(gemaraParas);
  const rashiBuf = await createDocxFromParagraphs(rashiParas);
  const tosafotBuf = await createDocxFromParagraphs(tosafotParas);

  // Save the three DOCX files into public/fixtures so they are preserved and inspectable
  fs.mkdirSync('/app/applet/public/fixtures', { recursive: true });
  fs.writeFileSync('/app/applet/public/fixtures/גמרא קידושין.docx', Buffer.from(gemaraBuf));
  fs.writeFileSync('/app/applet/public/fixtures/רשי.docx', Buffer.from(rashiBuf));
  fs.writeFileSync('/app/applet/public/fixtures/תוספות.docx', Buffer.from(tosafotBuf));

  // Run exact DocxImportModal multi-file import pipeline
  const filesList = [
    { name: 'גמרא קידושין.docx', buf: gemaraBuf, role: 'main_source' as ContentRole },
    { name: 'רשי.docx', buf: rashiBuf, role: 'primary_comment' as ContentRole },
    { name: 'תוספות.docx', buf: tosafotBuf, role: 'secondary_comment' as ContentRole },
  ];

  const allUnits: ContentUnit[] = [];
  let totalOrder = 0;
  for (const item of filesList) {
    const res = await DocxImporter.importDocx(item.buf, item.name);
    for (const u of res.units) {
      totalOrder++;
      u.order = totalOrder;
      if (item.role !== 'main_source' && u.role === 'main_source') {
        u.role = item.role;
      }
      allUnits.push(u);
    }
  }

  const sources = allUnits.filter(u => u.role === 'main_source' || u.role === 'chapter');
  const commentaries = allUnits.filter(u => u.role === 'primary_comment' || u.role === 'secondary_comment');
  const discoveredLinks = DocxImporter.autoLinkCommentariesToSource(sources, commentaries);

  console.log(`\n=== SEMANTIC LINKING AUDIT ===`);
  console.log(`Source segments: ${sources.length}`);
  console.log(`Commentary segments: ${commentaries.length} (Rashi: ${commentaries.filter(c => c.role === 'primary_comment').length}, Tosafot: ${commentaries.filter(c => c.role === 'secondary_comment').length})`);
  console.log(`Discovered links: ${discoveredLinks.length}`);

  let unlinkedCount = 0;
  for (const c of commentaries) {
    const cText = (c.rawText || '').slice(0, 50);
    if (!c.linkedSourceId) {
      unlinkedCount++;
      console.log(`  [UNLINKED] ${c.role} (${c.id}) DH="${c.dibburHamatchil || 'NONE'}" | Text="${cText}..."`);
    } else {
      const targetSrc = sources.find(s => s.id === c.linkedSourceId);
      console.log(`  [LINKED]   ${c.role} (${c.id}) DH="${c.dibburHamatchil}" -> ${c.linkedSourceId} ("${(targetSrc?.rawText || '').slice(0, 35)}...")`);
    }
  }
  console.log(`Unlinked commentaries: ${unlinkedCount} / ${commentaries.length} (${((unlinkedCount / commentaries.length) * 100).toFixed(1)}%)`);

  // Run PaginationEngine with default Rav Text settings
  const settings = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
  const pageWidth = settings.pageLayout.pageWidthPt;
  const pageHeight = settings.pageLayout.pageHeightPt;
  const marginTop = settings.pageLayout.marginTopPt;
  const marginBottom = settings.pageLayout.marginBottomPt;
  const marginInner = settings.pageLayout.marginInsidePt;
  const marginOuter = settings.pageLayout.marginOutsidePt;

  const doc = PaginationEngine.paginateDocument({
    title: 'מסכת קידושין',
    layoutType: 'rav_text',
    units: allUnits,
    geometry: settings.pageLayout.geometry,
    designSettings: settings,
  });

  console.log(`\n=== PAGINATION & GEOMETRY AUDIT (${doc.pages.length} PAGES) ===`);
  const usableWidth = pageWidth - marginInner - marginOuter;
  const usableHeight = pageHeight - marginTop - marginBottom;
  const usableArea = usableWidth * usableHeight;

  console.log(`Page dimensions: ${pageWidth}x${pageHeight}pt | Margins: T=${marginTop}, B=${marginBottom}, L=${marginOuter}, R=${marginInner}`);
  console.log(`Usable Page Area: ${usableWidth}x${usableHeight}pt = ${usableArea} sq pt`);
  const mainStyle = settings.roleStyles.main_source;
  const rashiStyle = settings.roleStyles.primary_comment;
  const tosafotStyle = settings.roleStyles.secondary_comment;
  console.log(`Typography Settings:`);
  console.log(`  Main Source: fontSize=${mainStyle.character.fontSizePt}pt, leading=${mainStyle.paragraph.leadingPt}pt (ratio=${mainStyle.paragraph.lineSpacingRatio})`);
  console.log(`  Rashi:       fontSize=${rashiStyle.character.fontSizePt}pt, leading=${rashiStyle.paragraph.leadingPt}pt (ratio=${rashiStyle.paragraph.lineSpacingRatio})`);
  console.log(`  Tosafot:     fontSize=${tosafotStyle.character.fontSizePt}pt, leading=${tosafotStyle.paragraph.leadingPt}pt (ratio=${tosafotStyle.paragraph.lineSpacingRatio})`);

  let totalMainWords = 0;
  let totalRashiWords = 0;
  let totalTosafotWords = 0;

  for (const page of doc.pages) {
    const mainLines = page.sourceLines || [];
    const rashiLines = page.rashiLines || [];
    const tosafotLines = page.tosafotLines || [];
    const allPageLines = [...mainLines, ...rashiLines, ...tosafotLines, ...(page.footnoteLines || [])];

    const countWords = (lines: typeof mainLines) => lines.reduce((ls, l) => ls + l.words.filter(w => !w.isSpace).length, 0);

    const mLines = mainLines.length;
    const rLines = rashiLines.length;
    const tLines = tosafotLines.length;

    const mWords = countWords(mainLines);
    const rWords = countWords(rashiLines);
    const tWords = countWords(tosafotLines);

    totalMainWords += mWords;
    totalRashiWords += rWords;
    totalTosafotWords += tWords;

    let lineBoxArea = 0;
    let frameRectArea = 0;
    let minY = Infinity;
    let maxY = 0;
    for (const l of allPageLines) {
      if (l.role === 'page_element') continue;
      const lw = l.words.reduce((s, w) => s + w.width, 0) + Math.max(0, l.words.length - 1) * 4;
      const lh = l.height || (l.role === 'main_source' ? 19.14 : 13.86);
      lineBoxArea += lw * lh;
      frameRectArea += (l.targetWidth || l.width) * lh;
      const top = l.yTop ?? (l.yBaseline - l.ascent);
      const bottom = l.yBottom ?? (l.yBaseline + l.descent);
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    }

    const verticalSpan = maxY > minY ? (maxY - minY) : 0;
    const verticalFillPct = ((verticalSpan / usableHeight) * 100).toFixed(1);
    const lineRectFillPct = ((frameRectArea / usableArea) * 100).toFixed(1);
    const inkFillPct = ((lineBoxArea / usableArea) * 100).toFixed(1);
    const decisions = page.layoutScore?.editorialDecisions || [];
    const engineReportedUtil = `PageUtil=${(page.layoutScore?.pageUtilization ?? 0).toFixed(1)}%`;

    console.log(
      `Page ${String(page.pageIndex + 1).padStart(2, ' ')} (Daf ${page.pageNumberHebrew}): ` +
      `Main=${String(mLines).padStart(2)}L/${String(mWords).padStart(3)}W | ` +
      `Rashi=${String(rLines).padStart(2)}L/${String(rWords).padStart(3)}W | ` +
      `Tosafot=${String(tLines).padStart(2)}L/${String(tWords).padStart(3)}W | ` +
      `Y-Span=${verticalSpan.toFixed(0)}/${usableHeight}pt (${verticalFillPct}%) | ` +
      `LineRectOcc=${lineRectFillPct}% | InkOcc=${inkFillPct}% | ${engineReportedUtil}`
    );
    if (decisions.length > 0) {
      console.log(`         Decisions: ${decisions.join(' ; ')}`);
    }
  }

  console.log(`\nTotal Words Placed: Main=${totalMainWords}, Rashi=${totalRashiWords}, Tosafot=${totalTosafotWords}, Total=${totalMainWords + totalRashiWords + totalTosafotWords}`);

  const reportLines: string[] = [];
  reportLines.push(`Source segments: ${sources.length}`);
  reportLines.push(`Commentary segments: ${commentaries.length} (Rashi: ${commentaries.filter(c => c.role === 'primary_comment').length}, Tosafot: ${commentaries.filter(c => c.role === 'secondary_comment').length})`);
  reportLines.push(`Discovered links: ${discoveredLinks.length}`);
  reportLines.push(`Unlinked commentaries: ${unlinkedCount} / ${commentaries.length}`);
  for (const c of commentaries) {
    const cText = (c.rawText || '').slice(0, 55);
    if (!c.linkedSourceId) {
      reportLines.push(`  [UNLINKED] ${c.role} (${c.id}) DH="${c.dibburHamatchil || 'NONE'}" | Text="${cText}..."`);
    } else {
      const targetSrc = sources.find(s => s.id === c.linkedSourceId);
      reportLines.push(`  [LINKED]   ${c.role} (${c.id}) DH="${c.dibburHamatchil}" -> ${c.linkedSourceId} ("${(targetSrc?.rawText || '').slice(0, 40)}...")`);
    }
  }
  fs.mkdirSync('/app/applet/public/audit_after', { recursive: true });
  fs.writeFileSync('/app/applet/public/audit_after/audit_after_report.txt', reportLines.join('\n'));

  // Export PDF and render PNGs
  const pdfBlob = await PdfExporter.generateMultiPagePdf(doc);
  const pdfBytes = await pdfBlob.arrayBuffer();
  const pdfPath = `/app/applet/public/fixtures/kiddushin_after_${doc.pages.length}p.pdf`;
  fs.writeFileSync(pdfPath, Buffer.from(pdfBytes));
  console.log(`Saved PDF to ${pdfPath} (${pdfBytes.byteLength} bytes)`);

  execSync(`gs -dNOPAUSE -dBATCH -sDEVICE=png16m -r150 -sOutputFile=/app/applet/public/audit_after/page_%02d.png "${pdfPath}"`);
  execSync(`montage /app/applet/public/audit_after/page_*.png -tile 4x2 -geometry 340x480+8+8 -background "#e2e8f0" /app/applet/public/audit_after/contact_sheet_after.png`);
  execSync(`montage /app/applet/public/audit_before/page_01.png /app/applet/public/audit_after/page_01.png /app/applet/public/audit_before/page_05.png /app/applet/public/audit_after/page_05.png -tile 2x2 -geometry 480x680+12+12 -background "#cbd5e1" /app/applet/public/audit_after/comparison_before_after.png`);
  console.log('Rendered all pages, contact_sheet_after.png, and comparison_before_after.png to /app/applet/public/audit_after/');
}

runAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
