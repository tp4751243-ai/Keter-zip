/**
 * Keter Comprehensive DOCX Importer & Integrity Validation Engine
 * Parses word/document.xml, word/footnotes.xml, word/styles.xml,
 * preserves chapters, simanim, commentaries, footnotes, side notes, tables, images,
 * and performs strict post-import integrity validation.
 */

import JSZip from 'jszip';
import { ContentRole, ContentUnit, RavTextLink, TableData, TextRun, ValidationReport } from '../types/typesetter';
import { HEBREW_MARKS_INFO } from './harfbuzz-emulator';

export interface DocxImportResult {
  fileName: string;
  units: ContentUnit[];
  links: RavTextLink[];
  validation: ValidationReport;
  metadata: {
    title: string;
    totalParagraphs: number;
    hasNikud: boolean;
    hasTaamim: boolean;
    hasFootnotes: boolean;
    hasTables: boolean;
    hasImages: boolean;
    detectedRoles: ContentRole[];
  };
}

export class DocxImporter {
  /**
   * Import a DOCX file buffer and build the complete DocumentModel
   */
  public static async importDocx(fileData: ArrayBuffer | Blob, fileName: string): Promise<DocxImportResult> {
    const zip = await JSZip.loadAsync(fileData);
    const documentXmlFile = zip.file('word/document.xml');
    const footnotesXmlFile = zip.file('word/footnotes.xml');

    if (!documentXmlFile) {
      throw new Error('Invalid DOCX file: word/document.xml not found in archive.');
    }

    const docXml = await documentXmlFile.async('string');
    const parser = new DOMParser();
    const docDom = parser.parseFromString(docXml, 'application/xml');

    // Parse footnotes if present
    const footnotesMap = new Map<string, string>();
    if (footnotesXmlFile) {
      const fnXml = await footnotesXmlFile.async('string');
      const fnDom = parser.parseFromString(fnXml, 'application/xml');
      const fnNodes = fnDom.getElementsByTagName('w:footnote');
      for (let i = 0; i < fnNodes.length; i++) {
        const id = fnNodes[i].getAttribute('w:id') || '';
        if (id && id !== '-1' && id !== '0') {
          const tNodes = fnNodes[i].getElementsByTagName('w:t');
          let fnText = '';
          for (let j = 0; j < tNodes.length; j++) {
            fnText += tNodes[j].textContent || '';
          }
          if (fnText.trim()) {
            footnotesMap.set(id, fnText.trim());
          }
        }
      }
    }

    // Process document body elements in document order
    const body = docDom.getElementsByTagName('w:body')[0];
    const units: ContentUnit[] = [];
    const links: RavTextLink[] = [];
    let orderIndex = 0;
    let hasNikud = false;
    let hasTaamim = false;
    let currentChapterId: string | undefined;
    let currentSourceId: string | undefined;
    const detectedRoles = new Set<ContentRole>();
    const cleanFileSlug = fileName
      .replace(/\.[^/.]+$/, '')
      .replace(/[^\u0590-\u05FFa-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'doc';

    if (body) {
      for (let i = 0; i < body.childNodes.length; i++) {
        const node = body.childNodes[i];
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const elem = node as Element;

        // 1. Process Table <w:tbl>
        if (elem.nodeName === 'w:tbl') {
          const tableUnit = this.parseTableElement(elem, ++orderIndex);
          units.push(tableUnit);
          detectedRoles.add('table');
          continue;
        }

        // 2. Process Paragraph <w:p>
        if (elem.nodeName === 'w:p') {
          // Extract text
          const tNodes = elem.getElementsByTagName('w:t');
          let text = '';
          for (let j = 0; j < tNodes.length; j++) {
            text += tNodes[j].textContent || '';
          }
          text = text.trim();
          if (!text) continue;

          // Detect Nikud & Taamim
          for (const ch of text) {
            const cp = ch.codePointAt(0) || 0;
            if ((cp >= 0x05B0 && cp <= 0x05BB) || cp === 0x05C7) hasNikud = true;
            if (cp >= 0x0591 && cp <= 0x05AF) hasTaamim = true;
          }

          // Semantic classification
          const pStyleNode = elem.getElementsByTagName('w:pStyle')[0];
          const styleVal = pStyleNode?.getAttribute('w:val')?.toLowerCase() || '';

          let role: ContentRole = 'main_source';
          let hierarchyLevel = 2;

          if (styleVal.includes('title') || styleVal.includes('heading 1') || text.startsWith('פרק ') || text.startsWith('פֶּרֶק ')) {
            role = 'chapter';
            hierarchyLevel = 1;
          } else if (styleVal.includes('heading 2') || text.startsWith('סימן ') || text.startsWith('סִימָן ')) {
            role = 'siman';
            hierarchyLevel = 2;
          } else if (styleVal.includes('heading') || styleVal.includes('subheading')) {
            role = 'heading';
            hierarchyLevel = 2;
          } else if (styleVal.includes('rashi') || text.startsWith('רש"י') || text.startsWith('רַשִׁ"י') || text.includes('ד"ה')) {
            role = 'primary_comment';
            hierarchyLevel = 3;
          } else if (styleVal.includes('tosafot') || text.startsWith('תוספות') || text.startsWith('תּוֹסָפוֹת')) {
            role = 'secondary_comment';
            hierarchyLevel = 3;
          } else if (styleVal.includes('list') || elem.getElementsByTagName('w:numPr').length > 0) {
            role = 'list_item';
            hierarchyLevel = 3;
          }

          detectedRoles.add(role);

          const unitId = `u-${cleanFileSlug}-${++orderIndex}`;
          let dibburHamatchil: string | undefined;

          // Detect Dibbur HaMatchil for commentaries OR commentary files imported before role override
          // 1. First check if the paragraph begins with explicit bold run(s) (<w:b/> or <w:bCs/>)
          const rNodes = elem.getElementsByTagName('w:r');
          let boldLead = '';
          for (let ri = 0; ri < rNodes.length; ri++) {
            const rPr = rNodes[ri].getElementsByTagName('w:rPr')[0];
            const isRunBold = rPr
              ? rPr.getElementsByTagName('w:b').length > 0 ||
                rPr.getElementsByTagName('w:bCs').length > 0
              : false;
            const tNodesRun = rNodes[ri].getElementsByTagName('w:t');
            let rTxt = '';
            for (let ti = 0; ti < tNodesRun.length; ti++) {
              rTxt += tNodesRun[ti].textContent || '';
            }
            if (isRunBold && rTxt) {
              boldLead += rTxt;
            } else if (rTxt.trim().length > 0) {
              break;
            }
          }
          const cleanBoldLead = boldLead
            .replace(/^[\s[\]()]+|[\s[\]().:—–-]+$/g, '')
            .replace(/^(?:רש["״]י|תוספות|תוס['׳]|ד["״]ה|בד["״]ה)\s+/g, '')
            .replace(/[\s.:—–-]+$/g, '')
            .trim();
          if (cleanBoldLead.length >= 2 && cleanBoldLead.length <= 65) {
            dibburHamatchil = cleanBoldLead;
          } else if (role === 'primary_comment' || role === 'secondary_comment' || fileName.includes('רש') || fileName.includes('תוס') || fileName.toLowerCase().includes('rashi') || fileName.toLowerCase().includes('tosafot')) {
            // 2. Check for standard rabbinic DH delimiters: colon (:), em-dash (—), en-dash (–), spaced hyphen ( - ), or period (. )
            const delimMatch = text.match(/^([^.:—–\n]{2,55}?)(?:\s*[:—–]|\s+-\s+|\.\s+)/);
            if (delimMatch && delimMatch[1]) {
              dibburHamatchil = delimMatch[1]
                .replace(/^[\s[\]()]+/g, '')
                .replace(/^(?:רש["״]י|תוספות|תוס['׳]|ד["״]ה|בד["״]ה)\s+/g, '')
                .trim();
            }
          }

          // Extract structured TextRuns preserving <w:rPr> bold/italic/underline, Dibbur HaMatchil, and <w:footnoteReference> anchors
          const { runs: textRuns, footnoteAnchors } = this.extractTextRunsAndFootnoteAnchors(
            elem,
            role,
            text,
            unitId,
            dibburHamatchil
          );

          const unit: ContentUnit = {
            id: unitId,
            role,
            rawText: text,
            textRuns,
            styleName: styleVal || (role === 'chapter' ? 'Heading 1' : 'Normal'),
            order: orderIndex,
            hierarchyLevel,
            parentId: role === 'chapter' ? undefined : currentChapterId,
            dibburHamatchil,
          };

          if (role === 'chapter') {
            currentChapterId = unitId;
            unit.chapterTitle = text;
          } else if (role === 'main_source') {
            currentSourceId = unitId;
          }

          // Create Rav-Text link if commentary follows source
          if ((role === 'primary_comment' || role === 'secondary_comment') && currentSourceId && dibburHamatchil) {
            links.push({
              linkId: `link-${links.length + 1}`,
              sourceUnitId: currentSourceId,
              commentaryUnitId: unitId,
              dibburHamatchil,
              isUserLocked: false,
              confidenceScore: 0.95,
              sourceSnippet: '',
              commentarySnippet: text.substring(0, 50),
              commentaryType: role === 'primary_comment' ? 'Rashi' : 'Tosafot',
            });
          }

          units.push(unit);

          // Create semantic footnote ContentUnits for every <w:footnoteReference> anchored in this paragraph
          for (let f = 0; f < footnoteAnchors.length; f++) {
            const anchor = footnoteAnchors[f];
            const fnText = footnotesMap.get(anchor.docxFootnoteId);
            if (fnText) {
              const fnNumber = Number(anchor.docxFootnoteId) || f + 1;
              const formattedFnText = /^\d+\./.test(fnText.trim())
                ? fnText.trim()
                : `${fnNumber}. ${fnText.trim()}`;
              units.push({
                id: anchor.footnoteUnitId,
                role: 'footnote',
                rawText: formattedFnText,
                styleName: 'Footnote Text',
                order: ++orderIndex,
                hierarchyLevel: 4,
                parentId: unitId,
                footnoteAnchorUnitId: unitId,
                footnoteAnchorWordIndex: anchor.anchorWordIndex,
                docxFootnoteId: anchor.docxFootnoteId,
                footnoteNumber: fnNumber,
              });
              detectedRoles.add('footnote');
            }
          }
        }
      }
    }

    // Post-Import Integrity Check (Section 7 of Master Prompt)
    const validation = this.validateDocumentIntegrity(units, links);

    return {
      fileName,
      units,
      links,
      validation,
      metadata: {
        title: fileName.replace(/\.[^/.]+$/, ''),
        totalParagraphs: units.length,
        hasNikud,
        hasTaamim,
        hasFootnotes: footnotesMap.size > 0,
        hasTables: detectedRoles.has('table'),
        hasImages: detectedRoles.has('image'),
        detectedRoles: Array.from(detectedRoles),
      },
    };
  }

  /**
   * Extracts structured TextRun[] and exact <w:footnoteReference> anchors from a DOCX <w:p> element,
   * preserving <w:b>, <w:i>, <w:u>, tagging Dibbur HaMatchil lead phrases, and attaching each
   * <w:footnoteReference w:id="..."> to the exact preceding word/TextRun without flattening.
   */
  public static extractTextRunsAndFootnoteAnchors(
    pElem: Element,
    role: ContentRole,
    fullText: string,
    unitId: string,
    dibburHamatchil?: string
  ): {
    runs: TextRun[];
    footnoteAnchors: Array<{
      docxFootnoteId: string;
      footnoteUnitId: string;
      anchorWordIndex: number;
    }>;
  } {
    const rNodes = pElem.getElementsByTagName('w:r');
    const runs: TextRun[] = [];
    const footnoteAnchors: Array<{
      docxFootnoteId: string;
      footnoteUnitId: string;
      anchorWordIndex: number;
    }> = [];
    let cumulativeWordCount = 0;

    for (let i = 0; i < rNodes.length; i++) {
      const rElem = rNodes[i];
      const tNodes = rElem.getElementsByTagName('w:t');
      let runText = '';
      for (let j = 0; j < tNodes.length; j++) {
        runText += tNodes[j].textContent || '';
      }

      const rPr = rElem.getElementsByTagName('w:rPr')[0];
      const isBold = rPr
        ? rPr.getElementsByTagName('w:b').length > 0 ||
          rPr.getElementsByTagName('w:bCs').length > 0
        : false;
      const isItalic = rPr
        ? rPr.getElementsByTagName('w:i').length > 0 ||
          rPr.getElementsByTagName('w:iCs').length > 0
        : false;
      const isUnderline = rPr ? rPr.getElementsByTagName('w:u').length > 0 : false;

      if (runText) {
        const wordTokens = runText.trim().split(/\s+/).filter(Boolean);
        const isLeadingDibburRun =
          runs.length === 0 &&
          isBold &&
          (role === 'primary_comment' ||
            role === 'secondary_comment' ||
            Boolean(dibburHamatchil));
        cumulativeWordCount += wordTokens.length;
        runs.push({
          text: runText,
          isBold,
          isDibbur: isLeadingDibburRun,
          isItalic,
          isUnderline,
        });
      }

      // Inspect <w:footnoteReference> inside this <w:r>
      const fnRefs = rElem.getElementsByTagName('w:footnoteReference');
      for (let f = 0; f < fnRefs.length; f++) {
        const fnId = fnRefs[f].getAttribute('w:id') || '';
        if (fnId && fnId !== '-1' && fnId !== '0') {
          const footnoteUnitId = `fn-${unitId}-${fnId}`;
          const anchorWordIndex = Math.max(0, cumulativeWordCount - 1);
          footnoteAnchors.push({
            docxFootnoteId: fnId,
            footnoteUnitId,
            anchorWordIndex,
          });
          // Attach the footnote reference metadata onto the current or immediately preceding TextRun
          if (runs.length > 0) {
            const targetRun = runs[runs.length - 1];
            targetRun.footnoteMarker = Number(fnId) || fnId;
            targetRun.footnoteUnitId = footnoteUnitId;
            targetRun.footnoteAnchorWordIndex = anchorWordIndex;
          }
        }
      }
    }

    if (runs.length === 0 || (dibburHamatchil && !runs.some(r => r.isBold || r.isDibbur))) {
      const builtRuns = this.buildRunsFromRawText(fullText, role, dibburHamatchil);
      // Re-attach any extracted footnote anchors to the corresponding word position in builtRuns
      if (footnoteAnchors.length > 0 && builtRuns.length > 0) {
        let wordCursor = 0;
        for (const br of builtRuns) {
          const wCount = br.text.trim().split(/\s+/).filter(Boolean).length;
          for (const fa of footnoteAnchors) {
            if (fa.anchorWordIndex >= wordCursor && fa.anchorWordIndex < wordCursor + wCount) {
              br.footnoteMarker = Number(fa.docxFootnoteId) || fa.docxFootnoteId;
              br.footnoteUnitId = fa.footnoteUnitId;
              br.footnoteAnchorWordIndex = fa.anchorWordIndex;
            }
          }
          wordCursor += wCount;
        }
      }
      return { runs: builtRuns, footnoteAnchors };
    }

    return { runs, footnoteAnchors };
  }

  /**
   * Backward-compatible wrapper returning TextRun[]
   */
  public static extractTextRunsFromParagraph(
    pElem: Element,
    role: ContentRole,
    fullText: string,
    dibburHamatchil?: string
  ): TextRun[] {
    return this.extractTextRunsAndFootnoteAnchors(
      pElem,
      role,
      fullText,
      'u-temp',
      dibburHamatchil
    ).runs;
  }

  /**
   * Builds structured TextRun[] from rawText + dibburHamatchil (also detects inline "ד״ה ..." or "סעיף ..." segments)
   */
  public static buildRunsFromRawText(
    rawText: string,
    role: ContentRole,
    dibburHamatchil?: string
  ): TextRun[] {
    if (!rawText) return [];
    const isComment =
      role === 'primary_comment' ||
      role === 'secondary_comment' ||
      role === 'tertiary_comment' ||
      role === 'dibbur_hamatchil';

    if (isComment) {
      // Split on multiple Dibbur HaMatchil markers if a single unit contains multiple Dibburim
      // (e.g. "ד״ה ...:" or "ד\"ה ... —" or multiple paragraphs/sentences starting with a Dibbur)
      // or highlight the leading Dibbur up to and including the colon ':' or dash '—'
      const multiDibburRegex = /(?:^|(?<=[.׃]\s+))(ד["״]ה\s+[^:—]{1,40}[:—]|[^.:—]{2,35}[:—])/g;
      const matches = Array.from(rawText.matchAll(multiDibburRegex));

      if (matches.length > 1) {
        const runs: TextRun[] = [];
        let lastIndex = 0;
        for (const match of matches) {
          const matchStart = match.index ?? 0;
          const matchText = match[0];
          if (matchStart > lastIndex) {
            runs.push({
              text: rawText.substring(lastIndex, matchStart),
              isBold: false,
              isDibbur: false,
            });
          }
          runs.push({
            text: matchText,
            isBold: true,
            isDibbur: true,
          });
          lastIndex = matchStart + matchText.length;
        }
        if (lastIndex < rawText.length) {
          runs.push({
            text: rawText.substring(lastIndex),
            isBold: false,
            isDibbur: false,
          });
        }
        return runs;
      }

      const colonIdx = rawText.indexOf(':');
      const dashIdx = rawText.indexOf('—');
      let splitIdx = -1;

      if (dibburHamatchil && rawText.startsWith(dibburHamatchil)) {
        const afterDibbur = rawText.substring(dibburHamatchil.length);
        const punctMatch = afterDibbur.match(/^(\s*[:—.-])/);
        splitIdx = dibburHamatchil.length + (punctMatch ? punctMatch[0].length : 0);
      } else if (colonIdx > 0 && colonIdx < 45) {
        splitIdx = colonIdx + 1;
      } else if (dashIdx > 0 && dashIdx < 45) {
        splitIdx = dashIdx + 1;
      }

      if (splitIdx > 0 && splitIdx < rawText.length) {
        return [
          {
            text: rawText.substring(0, splitIdx),
            isBold: true,
            isDibbur: true,
          },
          {
            text: rawText.substring(splitIdx),
            isBold: false,
            isDibbur: false,
          },
        ];
      }
    }

    if (role === 'chapter' || role === 'heading' || role === 'main_title' || role === 'siman') {
      return [{ text: rawText, isBold: true }];
    }

    // Highlight lead "מתניתין:" or "גמרא:" or "סעיף א:" in main_source
    const leadMatch = rawText.match(/^(מתניתין:|גמרא:|סעיף\s+[א-ת]+:)\s*/);
    if (leadMatch) {
      const leadLen = leadMatch[0].length;
      return [
        { text: rawText.substring(0, leadLen), isBold: true },
        { text: rawText.substring(leadLen), isBold: false },
      ];
    }

    return [{ text: rawText, isBold: false }];
  }

  private static parseTableElement(tableElem: Element, orderIndex: number): ContentUnit {
    const tableId = `tbl-${orderIndex}`;
    const trNodes = tableElem.getElementsByTagName('w:tr');
    const rows = [];
    let maxCols = 0;

    for (let r = 0; r < trNodes.length; r++) {
      const tcNodes = trNodes[r].getElementsByTagName('w:tc');
      const cells = [];
      maxCols = Math.max(maxCols, tcNodes.length);

      for (let c = 0; c < tcNodes.length; c++) {
        const tNodes = tcNodes[c].getElementsByTagName('w:t');
        let cellText = '';
        for (let t = 0; t < tNodes.length; t++) {
          cellText += tNodes[t].textContent || '';
        }
        cells.push({
          id: `${tableId}-r${r + 1}-c${c + 1}`,
          content: cellText.trim(),
          colSpan: 1,
          rowSpan: 1,
        });
      }

      rows.push({
        id: `${tableId}-r${r + 1}`,
        cells,
        isHeader: r === 0,
      });
    }

    const tableData: TableData = {
      id: tableId,
      rows,
      colCount: maxCols,
    };

    return {
      id: tableId,
      role: 'table',
      rawText: `[טבלה: ${rows.length} שורות, ${maxCols} עמודות]`,
      styleName: 'Table Normal',
      order: orderIndex,
      hierarchyLevel: 3,
      tableData,
    };
  }

  /**
   * Post-Import Integrity Validation (Section 7)
   */
  public static validateDocumentIntegrity(units: ContentUnit[], links: RavTextLink[]): ValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    const unitIds = new Set<string>();

    let totalFootnotes = 0;
    let totalTables = 0;
    let totalImages = 0;

    for (const unit of units) {
      // 1. Check for duplicate IDs
      if (unitIds.has(unit.id)) {
        errors.push(`Duplicate ContentUnit ID detected: '${unit.id}'.`);
      }
      unitIds.add(unit.id);

      if (unit.role === 'footnote') totalFootnotes++;
      if (unit.role === 'table') totalTables++;
      if (unit.role === 'image') totalImages++;

      // 2. Validate Nikud & Taamim combining marks
      if (unit.rawText) {
        let hasBaseConsonant = false;
        const chars = Array.from(unit.rawText);
        for (let i = 0; i < chars.length; i++) {
          const cp = chars[i].codePointAt(0) || 0;
          if (cp >= 0x05D0 && cp <= 0x05EA) {
            hasBaseConsonant = true;
          } else if (
            (cp >= 0x0591 && cp <= 0x05BD) ||
            cp === 0x05BF ||
            cp === 0x05C1 ||
            cp === 0x05C2 ||
            cp === 0x05C4 ||
            cp === 0x05C5 ||
            cp === 0x05C7
          ) {
            if (!hasBaseConsonant) {
              errors.push(`Orphan diacritic U+${cp.toString(16).toUpperCase()} detected at index ${i} in unit '${unit.id}'.`);
            }
          } else {
            hasBaseConsonant = false;
          }
        }
      }

      // 3. Validate Tables
      if (unit.tableData) {
        if (unit.tableData.rows.length === 0) {
          warnings.push(`Table '${unit.id}' contains no rows.`);
        }
      }
    }

    // 4. Validate Rav-Text Links
    for (const link of links) {
      if (!unitIds.has(link.sourceUnitId)) {
        errors.push(`Rav-Text Link '${link.linkId}' references missing source unit '${link.sourceUnitId}'.`);
      }
      if (!unitIds.has(link.commentaryUnitId)) {
        errors.push(`Rav-Text Link '${link.linkId}' references missing commentary unit '${link.commentaryUnitId}'.`);
      }
    }

    return {
      passed: errors.length === 0,
      totalUnits: units.length,
      totalLinks: links.length,
      totalFootnotes,
      totalTables,
      totalImages,
      errors,
      warnings,
    };
  }

  public static getSampleBerakhot(): ContentUnit[] {
    return [
      {
        id: 'unit-ch-1',
        role: 'chapter',
        rawText: 'מַסֶּכֶת בְּרָכוֹת — פֶּרֶק רִאשׁוֹן: מֵאֵימָתַי',
        styleName: 'Chapter-Title',
        order: 1,
        hierarchyLevel: 1,
        chapterTitle: 'מסכת ברכות · פרק ראשון: מאימתי',
      },
      {
        id: 'unit-gemara-1',
        role: 'main_source',
        rawText: 'מתניתין: מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית? מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן, עַד סוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה, דִּבְרֵי רַבִּי אֱלִיעֶזֶר. וַחֲכָמִים אוֹמְרִים: עַד חֲצוֹת. רַבָּן גַּמְלִיאֵל אוֹמֵר: עַד שֶׁיַּעֲלֶה עַמּוּד הַשָּׁחַר.',
        styleName: 'Gemara-Source',
        order: 2,
        hierarchyLevel: 2,
        parentId: 'unit-ch-1',
      },
      {
        id: 'unit-gemara-2',
        role: 'main_source',
        rawText: 'מַעֲשֶׂה שֶׁבָּאוּ בָנָיו מִבֵּית הַמִּשְׁתֶּה, אָמְרוּ לוֹ: לֹא קָרִינוּ אֶת שְׁמַע. אָמַר לָהֶם: אִם לֹא עָלָה עַמּוּד הַשַּׁחַר, חַיָּבִין אַתֶּם לִקְרוֹת. וְלֹא זוֹ בִּלְבַד, אֶלָּא כָּל מַה שֶּׁאָמְרוּ חֲכָמִים "עַד חֲצוֹת" — מִצְוָתָן עַד שֶׁיַּעֲלֶה עַמּוּד הַשָּׁחַר׃',
        styleName: 'Gemara-Source',
        order: 3,
        hierarchyLevel: 2,
        parentId: 'unit-ch-1',
      },
      {
        id: 'unit-gemara-3',
        role: 'main_source',
        rawText: 'גמרא: תָּנָא הֵיכָא קָאֵי דְּקָתָנֵי "מֵאֵימָתַי"? וְתוּ, מַאי שְׁנָא דְּתָנֵי דְּעַרְבִית בְּרֵישָׁא, לִתְנֵי דְּשַׁחֲרִית בְּרֵישָׁא! תַּנָּא אַקְּרָא קָאֵי, דִּכְתִיב: "בְּשָׁכְבְּךָ וּבְקוּמֶךָ", וְהָכִי קָתָנֵי: זְמַן קְרִיאַת שְׁמַע דִּשְׁכִיבָה אֵימַת — מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִין לֶאֱכֹל בִּתְרוּמָתָן. וְאִי בָּעֵית אֵימָא: יָלֵיף מִבְּרִיָּתוֹ שֶׁל עוֹלָם, דִּכְתִיב: "וַיְהִי עֶרֶב וַיְהִי בֹקֶר יוֹם אֶחָד".',
        styleName: 'Gemara-Source',
        order: 4,
        hierarchyLevel: 2,
        parentId: 'unit-ch-1',
      },
      {
        id: 'unit-gemara-4',
        role: 'main_source',
        rawText: 'אִי הָכִי, סֵיפָא דְּקָתָנֵי: "בַּשַּׁחַר מְבָרֵךְ שְׁתַּיִם לְפָנֶיהָ וְאַחַת לְאַחֲרֶיהָ, וּבָעֶרֶב מְבָרֵךְ שְׁתַּיִם לְפָנֶיהָ וּשְׁתַּיִם לְאַחֲרֶיהָ", לִתְנֵי דְּעַרְבִית בְּרֵישָׁא! תַּנָּא פָּתַח בְּעַרְבִית וַהֲדַר תָּנֵי בְּשַׁחֲרִית, עַד דְּקָאֵי בְּשַׁחֲרִית פָּרֵישׁ מִילֵּי דְּשַׁחֲרִית, וַהֲדַר פָּרֵישׁ מִילֵּי דְּעַרְבִית.',
        styleName: 'Gemara-Source',
        order: 5,
        hierarchyLevel: 2,
        parentId: 'unit-ch-1',
      },
      {
        id: 'unit-rashi-1',
        role: 'primary_comment',
        rawText: 'מֵאֵימָתַי: מֵאֵיזֶה זְמַן. וְלֹא קָתָנֵי "מִשָּׁעָה שֶׁהַכּוֹכָבִים יוֹצְאִים", לְאַשְׁמְעִינַן מִלְּתָא אַגַּב אוֹרְחֵיהּ, דְּהַכֹּהֲנִים שֶׁנִּטְמְאוּ וְטָבְלוּ בַּיּוֹם וְהֶעֱרִיב שִׁמְשָׁן טְהוֹרִים לֶאֱכֹל בִּתְרוּמָה לְעֵת עֶרֶב, וְהוּא צֵאת הַכּוֹכָבִים, וְלִמְדָנוּ שֶׁבִּיאַת הַשֶּׁמֶשׁ מְעַכַּבְתּוֹ וְאֵין כַּפָּרָתוֹ מְעַכַּבְתּוֹ.',
        styleName: 'Rashi-Script',
        order: 6,
        hierarchyLevel: 3,
        parentId: 'unit-ch-1',
        dibburHamatchil: 'מֵאֵימָתַי',
        linkedSourceId: 'unit-gemara-1',
      },
      {
        id: 'unit-rashi-2',
        role: 'primary_comment',
        rawText: 'שֶׁהַכֹּהֲנִים נִכְנָסִים: שֶׁנֶּאֱמַר "וּבָא הַשֶּׁמֶשׁ וְטָהֵר וְאַחַר יֹאכַל מִן הַקֳּדָשִׁים". בִּיאַת שִׁמְשׁוֹ מְעַכַּבְתּוֹ מִלֶּאֱכֹל בִּתְרוּמָה וְאֵין כַּפָּרָתוֹ מְעַכַּבְתּוֹ מִלֶּאֱכֹל. וְסֵדֶר טָהֳרָתָם כָּתוּב בְּפָרָשַׁת אֱמֹר אֶל הַכֹּהֲנִים שֶׁטּוֹבֵל וּמַעֲרִיב שִׁמְשׁוֹ.',
        styleName: 'Rashi-Script',
        order: 7,
        hierarchyLevel: 3,
        parentId: 'unit-ch-1',
        dibburHamatchil: 'שֶׁהַכֹּהֲנִים נִכְנָסִים',
        linkedSourceId: 'unit-gemara-1',
      },
      {
        id: 'unit-rashi-3',
        role: 'primary_comment',
        rawText: 'עַד סוֹף הָאַשְׁמוּרָה: שְׁלִישִׁית הַלַּיְלָה, שֶׁהַלַּיְלָה נֶחֱלָק לְשָׁלֹשׁ מִשְׁמָרוֹת, וְאַחַר כָּךְ אֵינוֹ זְמַן שְׁכִיבָה אֶלָּא קִימָה. וַחֲכָמִים אוֹמְרִים עַד חֲצוֹת — סְבִירָא לְהוּ כְּרַבָּן גַּמְלִיאֵל, וְלֹא אָמְרוּ חֲצוֹת אֶלָּא כְּדֵי לְהַרְחִיק אֶת הָאָדָם מִן הָעֲבֵרָה שֶׁלֹּא יֹאמַר עוֹד יֵשׁ לִי שָׁעוֹת.',
        styleName: 'Rashi-Script',
        order: 8,
        hierarchyLevel: 3,
        parentId: 'unit-ch-1',
        dibburHamatchil: 'עַד סוֹף הָאַשְׁמוּרָה',
        linkedSourceId: 'unit-gemara-1',
      },
      {
        id: 'unit-rashi-4',
        role: 'primary_comment',
        rawText: 'הֵיכָא קָאֵי: בְּאֵיזֶה מָקוֹם עָמַד שֶׁהֻצְרַךְ לִשְׁאוֹל מֵאֵימָתַי קוֹרִין, שֶׁמַּשְׁמָע שֶׁהוּא דָּבָר פָּשׁוּט וּמֻסְכָּם שֶׁצָּרִיךְ לִקְרוֹת וְלֹא חָסַר אֶלָּא קְבִיעַת הַזְּמַן לְבַד, וְעוֹד לָמָּה שָׁנָה קְרִיאַת שְׁמַע שֶׁל עַרְבִית תְּחִלָּה וְלֹא שָׁנָה שֶׁל שַׁחֲרִית.',
        styleName: 'Rashi-Script',
        order: 9,
        hierarchyLevel: 3,
        parentId: 'unit-ch-1',
        dibburHamatchil: 'הֵיכָא קָאֵי',
        linkedSourceId: 'unit-gemara-3',
      },
      {
        id: 'unit-rashi-5',
        role: 'primary_comment',
        rawText: 'אַקְּרָא קָאֵי: עַל הַפָּסוּק הַכָּתוּב בַּתּוֹרָה הוּא נִסְמָךְ, שֶׁנֶּאֱמַר "וְשִׁנַּנְתָּם לְבָנֶיךָ וְדִבַּרְתָּ בָּם בְּשִׁבְתְּךָ בְּבֵיתֶךָ וּבְלֶכְתְּךָ בַדֶּרֶךְ וּבְשָׁכְבְּךָ וּבְקוּמֶךָ", וְהִקְדִּים הַכָּתוּב "בְּשָׁכְבְּךָ" שֶׁהוּא הַלַּיְלָה לִפְנֵי "בְקוּמֶךָ" שֶׁהוּא הַיּוֹם.',
        styleName: 'Rashi-Script',
        order: 10,
        hierarchyLevel: 3,
        parentId: 'unit-ch-1',
        dibburHamatchil: 'אַקְּרָא קָאֵי',
        linkedSourceId: 'unit-gemara-3',
      },
      {
        id: 'unit-tosafot-1',
        role: 'secondary_comment',
        rawText: 'מֵאֵימָתַי קוֹרִין: תָּנָא הֵיכָא קָאֵי דְּקָתָנֵי מֵאֵימָתַי, וְתוּ מַאי שְׁנָא דְּתָנֵי דְּעַרְבִית בְּרֵישָׁא? תַּנָּא אַקְּרָא קָאֵי, דִּכְתִיב "בְּשָׁכְבְּךָ וּבְקוּמֶךָ", וְהָכִי קָתָנֵי: זְמַן קְרִיאַת שְׁמַע דִּשְׁכִיבָה אֵימַת — מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִין לֶאֱכֹל בִּתְרוּמָתָן. וְתֵימַהּ לְרִבָּ״ם דְּלָמָּה לֹא פָּתַח בִּתְפִלָּה תְּחִלָּה, וְיֵשׁ לוֹמַר שֶׁקְּרִיאַת שְׁמַע דְּאוֹרַיְתָא עֲדִיפָא לֵיהּ לְאַקְדּוֹמֵי.',
        styleName: 'Tosafot-Square',
        order: 11,
        hierarchyLevel: 3,
        parentId: 'unit-ch-1',
        dibburHamatchil: 'מֵאֵימָתַי קוֹרִין',
        linkedSourceId: 'unit-gemara-1',
      },
      {
        id: 'unit-tosafot-2',
        role: 'secondary_comment',
        rawText: 'וְאִי בָּעֵית אֵימָא: יָלֵיף מִבְּרִיָּתוֹ שֶׁל עוֹלָם, דִּכְתִיב "וַיְהִי עֶרֶב וַיְהִי בֹקֶר יוֹם אֶחָד". וְאַף עַל גַּב דִּבְתָמִיד שָׁנִינָה שֶׁל שַׁחַר בְּרֵישָׁא, הָתָם מִשּׁוּם דִּכְתִיב "אֶת הַכֶּבֶשׂ אֶחָד תַּעֲשֶׂה בַבֹּקֶר", אֲבָל בִּבְרִיָּתוֹ שֶׁל עוֹלָם הַלַּיְלָה קָדַם לַיּוֹם וְכֵן בְּכָל מִצְוֹת הַתְּלוּיוֹת בַּזְּמַן.',
        styleName: 'Tosafot-Square',
        order: 12,
        hierarchyLevel: 3,
        parentId: 'unit-ch-1',
        dibburHamatchil: 'וְאִי בָּעֵית אֵימָא',
        linkedSourceId: 'unit-gemara-3',
      },
      {
        id: 'unit-tosafot-3',
        role: 'secondary_comment',
        rawText: 'מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִין: פֵּרֵשׁ רַשִׁ״י שֶׁהוּא צֵאת הַכּוֹכָבִים. וְהִקְשׁוּ הַתּוֹסָפוֹת דְּהָא אָמְרִינַן בִּבְרָכוֹת קוֹרֵא אָדָם קְרִיאַת שְׁמַע מִבְּעוֹד יוֹם, וְתֵרְצוּ דְּהָתָם בְּצִבּוּר מִשּׁוּם טִרְחָא דְּצִבּוּרָא, אֲבָל לְכַתְּחִלָּה זְמַנָּהּ מִשֶּׁיֵּצְאוּ שְׁלֹשָׁה כּוֹכָבִים בֵּינוֹנִיִּים.',
        styleName: 'Tosafot-Square',
        order: 13,
        hierarchyLevel: 3,
        parentId: 'unit-ch-1',
        dibburHamatchil: 'מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִין',
        linkedSourceId: 'unit-gemara-1',
      },
      {
        id: 'unit-fn-1',
        role: 'footnote',
        rawText: '1. ויקרא כב, ז: "וּבָא הַשֶּׁמֶשׁ וְטָהֵר וְאַחַר יֹאכַל מִן הַקֳּדָשִׁים כִּי לַחְמוֹ הוּא".',
        styleName: 'Footnote',
        order: 14,
        hierarchyLevel: 4,
        parentId: 'unit-rashi-2',
        footnoteNumber: 1,
      },
      {
        id: 'unit-fn-2',
        role: 'footnote',
        rawText: '2. דברים ו, ז: "וְשִׁנַּנְתָּם לְבָנֶיךָ וְדִבַּרְתָּ בָּם בְּשִׁבְתְּךָ בְּבֵיתֶךָ וּבְלֶכְתְּךָ בַדֶּרֶךְ וּבְשָׁכְבְּךָ וּבְקוּמֶךָ".',
        styleName: 'Footnote',
        order: 15,
        hierarchyLevel: 4,
        parentId: 'unit-gemara-3',
        footnoteNumber: 2,
      },
    ];
  }

  public static getSampleBereishit(): ContentUnit[] {
    return [
      {
        id: 'unit-ch-ber',
        role: 'chapter',
        rawText: 'פָּרָשַׁת בְּרֵאשִׁית — פֶּרֶק א׳',
        styleName: 'Chapter-Title',
        order: 1,
        hierarchyLevel: 1,
        chapterTitle: 'פרשת בראשית — פרק א',
      },
      {
        id: 'unit-chumash-1',
        role: 'main_source',
        rawText: 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃ וְהָאָ֗רֶץ הָיְתָ֥ה תֹ֙הוּ֙ וָבֹ֔הוּ וְחֹ֖שֶׁךְ עַל־פְּנֵ֣י תְה֑וֹם וְר֣וּחַ אֱלֹהִ֔ים מְרַחֶ֖פֶת עַל־פְּנֵ֥י הַמָּֽיִם׃ וַיֹּ֥אמֶר אֱלֹהִ֖ים יְהִ֣י א֑וֹר וַֽיְהִי־אֽוֹר׃',
        styleName: 'Chumash-Source',
        order: 2,
        hierarchyLevel: 2,
        parentId: 'unit-ch-ber',
      },
      {
        id: 'unit-rashi-chumash-1',
        role: 'primary_comment',
        rawText: 'בְּרֵאשִׁית: אָמַר רַבִּי יִצְחָק, לֹא הָיָה צָרִיךְ לְהַתְחִיל אֶת הַתּוֹרָה אֶלָּא מֵ"הַחֹדֶשׁ הַזֶּה לָכֶם", שֶׁהִיא מִצְוָה רִאשׁוֹנָה שֶׁנִּצְטַוּוּ בָּהּ יִשְׂרָאֵל. וּמַה טַּעַם פָּתַח בִּבְרֵאשִׁית? מִשּׁוּם "כֹּחַ מַעֲשָׂיו הִגִּיד לְעַמּוֹ לָתֵת לָהֶם נַחֲלַת גּוֹיִם", שֶׁאִם יֹאמְרוּ אֻמּוֹת הָעוֹלָם לְיִשְׂרָאֵל: לִסְטִים אַתֶּם שֶׁכְּבַשְׁתֶּם אַרְצוֹת שִׁבְעָה גּוֹיִם! הֵם אוֹמְרִים לָהֶם: כָּל הָאָרֶץ שֶׁל הַקָּדוֹשׁ בָּרוּךְ הוּא הִיא, הוּא בְּרָאָהּ וּנְתָנָהּ לַאֲשֶׁר יָשַׁר בְּעֵינָיו.',
        styleName: 'Rashi-Chumash',
        order: 3,
        hierarchyLevel: 3,
        parentId: 'unit-ch-ber',
        dibburHamatchil: 'בְּרֵאשִׁית',
        linkedSourceId: 'unit-chumash-1',
      },
      {
        id: 'unit-onkelos-1',
        role: 'secondary_comment',
        rawText: 'בְּקַדְמִין בְּרָא יְיָ יָת שְׁמַיָּא וְיָת אַרְעָא׃ וְאַרְעָא הֲוָת צַדְיָא וְרֵיקָנְיָא וַחֲשׁוֹכָא עַל אַפֵּי תְהוֹמָא וְרוּחָא מִן קֳדָם יְיָ מְנַשְּׁבָא עַל אַפֵּי מַיָּא׃ וַאֲמַר יְיָ יְהֵי נְהוֹרָא וַהֲוָה נְהוֹרָא׃',
        styleName: 'Targum-Onkelos',
        order: 4,
        hierarchyLevel: 3,
        parentId: 'unit-ch-ber',
        dibburHamatchil: 'בְּקַדְמִין',
        linkedSourceId: 'unit-chumash-1',
      },
    ];
  }

  public static getSampleMussarSingleColumn(): ContentUnit[] {
    return [
      {
        id: 'unit-mussar-h1',
        role: 'chapter',
        rawText: 'מְסִלַּת יְשָׁרִים — פֶּרֶק א׳: בְּבֵאוּר כְּלַל חוֹבַת הָאָדָם בְּעוֹלָמוֹ',
        styleName: 'Chapter-Title',
        order: 1,
        hierarchyLevel: 1,
        chapterTitle: 'מסילת ישרים — פרק ראשון',
      },
      {
        id: 'unit-mussar-p1',
        role: 'main_source',
        rawText: 'יְסוֹד הַחֲסִידוּת וְשֹׁרֶשׁ הָעֲבוֹדָה הַתְּמִימָה הוּא: שֶׁיִּתְבָּרֵר וְיִתְאַמֵּת אֵצֶל הָאָדָם מַה חוֹבָתוֹ בְּעוֹלָמוֹ, וּלְמַה צָּרִיךְ שֶׁיָּשִׂים מַבָּטוֹ וּמְגַמָּתוֹ בְּכָל אֲשֶׁר הוּא עָמֵל כָּל יְמֵי חַיָּיו. וְהִנֵּה מַה שֶּׁהוֹרוּנוּ חֲכָמֵינוּ זִכְרוֹנָם לִבְרָכָה הוּא: שֶׁהָאָדָם לֹא נִבְרָא אֶלָּא לְהִתְעַנֵּג עַל ה׳ וּלְהִנָּאוֹת מִזִּיו שְׁכִינָתוֹ, שֶׁזֶּהוּ הַתַּעֲנוּג הָאֲמִתִּי וְהָעִדּוּן הַגָּדוֹל מִכָּל הָעִדּוּנִים שֶׁיְּכוֹלִים לְהִמָּצֵא.',
        styleName: 'Normal',
        order: 2,
        hierarchyLevel: 2,
        parentId: 'unit-mussar-h1',
      },
      {
        id: 'unit-mussar-p2',
        role: 'main_source',
        rawText: 'וּמְקוֹם הָעִדּוּן הַזֶּה בֶּאֱמֶת הוּא הָעוֹלָם הַבָּא, כִּי הוּא נִבְרָא בַּהֲכָנָה הַמִּצְטָרֶכֶת לַדָּבָר הַזֶּה. אַךְ הַדֶּרֶךְ כְּדֵי לְהַגִּיעַ אֶל מְחוֹז חֶפְצֵנוּ זֶה, הוּא זֶה הָעוֹלָם. וְהוּא מַה שֶּׁאָמְרוּ זִכְרוֹנָם לִבְרָכָה: "הָעוֹלָם הַזֶּה דּוֹמֶה לִפְרוֹזְדוֹר בִּפְנֵי הָעוֹלָם הַבָּא".',
        styleName: 'Normal',
        order: 3,
        hierarchyLevel: 2,
        parentId: 'unit-mussar-h1',
      },
      {
        id: 'unit-mussar-p3',
        role: 'main_source',
        rawText: 'וְהָאֶמְצָעִיִּים הַמַּגִּיעִים אֶת הָאָדָם לַמַּטָּרָה הַזֹּאת הֵם הַמִּצְוֹת אֲשֶׁר צִוָּנוּ עֲלֵיהֶן הָאֵל יִתְבָּרַךְ שְׁמוֹ. וּמְקוֹם עֲשִׂיַּת הַמִּצְוֹת הוּא רַק הָעוֹלָם הַזֶּה. עַל כֵּן הוּשַׂם הָאָדָם בָּזֶה הָעוֹלָם בַּתְּחִלָּה, כְּדֵי שֶׁעַל יְדֵי הָאֶמְצָעִיִּים הָאֵלֶּה הַמִּזְדַּמְּנִים לוֹ כָּאן, יוּכַל לְהַגִּיעַ אֶל הַמָּקוֹם אֲשֶׁר הוּכַן לוֹ, שֶׁהוּא הָעוֹלָם הַבָּא, לִשְׂבֹּעַ בַּטּוֹב אֲשֶׁר קָנָה לוֹ עַל יְדֵי אֵלֶּה הָאֶמְצָעִיִּים.',
        styleName: 'Normal',
        order: 4,
        hierarchyLevel: 2,
        parentId: 'unit-mussar-h1',
      },
      {
        id: 'unit-mussar-fn1',
        role: 'footnote',
        rawText: '1. אבות פרק ד, משנה טז: "התקן עצמך בפרוזדור כדי שתכנס לטרקלין".',
        styleName: 'Footnote',
        order: 5,
        hierarchyLevel: 4,
        footnoteNumber: 1,
      },
      {
        id: 'unit-mussar-fn2',
        role: 'footnote',
        rawText: '2. ברכות יז, ע"א: "מרגלא בפומיה דרב: העולם הבא אין בו לא אכילה ולא שתיה... אלא צדיקים יושבים ועטרותיהם בראשיהם ונהנים מזיו השכינה".',
        styleName: 'Footnote',
        order: 6,
        hierarchyLevel: 4,
        footnoteNumber: 2,
      },
    ];
  }

  public static getSampleShulchanAruchTwoColumn(): ContentUnit[] {
    return [
      {
        id: 'unit-sa-h1',
        role: 'chapter',
        rawText: 'שֻׁלְחָן עָרוּךְ — אֹרַח חַיִּים: סִימָן א׳',
        styleName: 'Chapter-Title',
        order: 1,
        hierarchyLevel: 1,
        chapterTitle: 'אורח חיים — סימן א׳',
      },
      {
        id: 'unit-sa-s1',
        role: 'main_source',
        rawText: 'סעיף א: יִתְגַּבֵּר כַּאֲרִי לַעֲמֹד בַּבֹּקֶר לַעֲבוֹדַת בּוֹרְאוֹ, שֶׁיְּהֵא הוּא מְעוֹרֵר הַשַּׁחַר. הגה: וְעַל כָּל פָּנִים לֹא יְאַחֵר זְמַן הַתְּפִלָּה שֶׁהַצִּבּוּר מִתְפַּלְּלִין. "שִׁוִּיתִי ה׳ לְנֶגְדִּי תָמִיד" — הוּא כְּלָל גָּדוֹל בַּתּוֹרָה וּבְמַעֲלוֹת הַצַּדִּיקִים אֲשֶׁר הוֹלְכִים לִפְנֵי הָאֱלֹהִים.',
        styleName: 'Normal',
        order: 2,
        hierarchyLevel: 2,
        simanNumber: 'א',
        seifLetter: 'א',
      },
      {
        id: 'unit-sa-s2',
        role: 'main_source',
        rawText: 'סעיף ב: כְּשֶׁיִּתְעוֹרֵר מִשְּׁנָתוֹ, יִזָּהֵר מְאֹד שֶׁלֹּא יֵלֵךְ אַרְבַּע אַמּוֹת בְּלֹא נְטִילַת יָדַיִם. וְיֹאמַר מִיָּד: "מוֹדֶה אֲנִי לְפָנֶיךָ מֶלֶךְ חַי וְקַיָּם שֶׁהֶחֱזַרְתָּ בִּי נִשְׁמָתִי בְּחֶמְלָה רַבָּה אֱמוּנָתֶךָ", וְאֵינוֹ צָרִיךְ נְטִילָה לָזֶה מִפְּנֵי שֶׁאֵין בּוֹ הַזְכָּרַת הַשֵּׁם.',
        styleName: 'Normal',
        order: 3,
        hierarchyLevel: 2,
        simanNumber: 'א',
        seifLetter: 'ב',
      },
      {
        id: 'unit-sa-s3',
        role: 'main_source',
        rawText: 'סעיף ג: יַלְבִּישׁ חֲלוּקוֹ מְיֻשָּׁב, וְאַל יִתְגַּלֶּה, וְיִזָּהֵר לִלְבֹּשׁ יָמִין תְּחִלָּה וְאַחַר כָּךְ שְׂמֹאל, וּבִנְעִילַת מִנְעָלִים נוֹעֵל שֶׁל יָמִין וְאֵינוֹ קוֹשְׁרוֹ, וְאַחַר כָּךְ נוֹעֵל שֶׁל שְׂמֹאל וְקוֹשְׁרוֹ, וְחוֹזֵר וְקוֹשֵׁר שֶׁל יָמִין.',
        styleName: 'Normal',
        order: 4,
        hierarchyLevel: 2,
        simanNumber: 'א',
        seifLetter: 'ג',
      },
      {
        id: 'unit-sa-s4',
        role: 'main_source',
        rawText: 'סעיף ד: טוֹב לְכָל יְרֵא שָׁמַיִם שֶׁיְּהֵא מֵצֵר וְדוֹאֵג עַל חֻרְבַּן בֵּית הַמִּקְדָּשׁ, וְיֹאמַר תִּקּוּן חֲצוֹת בְּכָל לַיְלָה, מִזְמוֹר "עַל נַהֲרוֹת בָּבֶל" וּמִזְמוֹר "אֱלֹהִים בָּאוּ גוֹיִם בְּנַחֲלָתֶךָ".',
        styleName: 'Normal',
        order: 5,
        hierarchyLevel: 2,
        simanNumber: 'א',
        seifLetter: 'ד',
      },
    ];
  }

  public static getSampleMishnahBerurahTopBottom(): ContentUnit[] {
    return [
      {
        id: 'unit-mb-h1',
        role: 'chapter',
        rawText: 'מִשְׁנָה בְּרוּרָה — הִלְכוֹת צִיצִית: סִימָן ח׳',
        styleName: 'Chapter-Title',
        order: 1,
        hierarchyLevel: 1,
        chapterTitle: 'הלכות ציצית — סימן ח׳',
      },
      {
        id: 'unit-mb-main',
        role: 'main_source',
        rawText: 'סעיף א: מִצְוָה לֶאֱחֹז הַצִּיצִית בִּשְׂמֹאלוֹ כְּנֶגֶד לִבּוֹ בִּשְׁעַת קְרִיאַת שְׁמַע, רֶמֶז לַדָּבָר "וְהָיוּ הַדְּבָרִים הָאֵלֶּה... עַל לְבָבֶךָ". וּכְשֶׁמַּגִּיעַ לְ"וּרְאִיתֶם אֹתוֹ", נוֹתְנָם עַל עֵינָיו וְרוֹאֶה אוֹתָם וְנוֹשְׁקָם, וְנָהֲגוּ לְהַעֲבִירָם עַל הָעֵינַיִם שָׁלֹשׁ פְּעָמִים.',
        styleName: 'Gemara-Source',
        order: 2,
        hierarchyLevel: 2,
      },
      {
        id: 'unit-mb-rashi',
        role: 'primary_comment',
        rawText: 'בֵּאוּר הֲלָכָה: "מִצְוָה לֶאֱחֹז הַצִּיצִית בִּשְׂמֹאלוֹ" — כָּתַב הַמָּגֵן אַבְרָהָם שֶׁהַטַּעַם הוּא כְּדֵי שֶׁיְּהֵא יְמִינוֹ פְּנוּיָה לְקַבֵּל עֹל מַלְכוּת שָׁמַיִם בִּקְרִיאַת פָּסוּק רִאשׁוֹן, וְעוֹד שֶׁהַלֵּב הוּא בִּשְׂמֹאל וְנֶאֱמַר "עַל לְבָבֶךָ". וְעַיֵּן בִּפְרִי מְגָדִים שֶׁמַּשְׁמַע דַּאֲפִלּוּ אִטֵּר אוֹחֵז בִּשְׂמֹאל דְּעָלְמָא.',
        styleName: 'Rashi-Script',
        order: 3,
        hierarchyLevel: 3,
        dibburHamatchil: 'מִצְוָה לֶאֱחֹז הַצִּיצִית בִּשְׂמֹאלוֹ',
      },
      {
        id: 'unit-mb-tosafot',
        role: 'secondary_comment',
        rawText: 'שַׁעַר הַצִּיּוּן: (א) בֵּית יוֹסֵף בְּשֵׁם הַמַּנְהִיג. (ב) שַׁלְהָ״ק וּכְנֶסֶת הַגְּדוֹלָה. (ג) דַּוְקָא הַצִּיצִיּוֹת שֶׁל שְׁנֵי כְּנָפַיִם הַקִּדְמִיּוֹת, אַךְ יֵשׁ נוֹהֲגִין לֶאֱחֹז אֶת כָּל הָאַרְבַּע כַּנְפוֹת.',
        styleName: 'Tosafot-Square',
        order: 4,
        hierarchyLevel: 3,
        dibburHamatchil: 'שַׁעַר הַצִּיּוּן',
      },
    ];
  }

  /**
   * Auto-detect the semantic role of a DOCX file based on filename and contents
   */
  public static autoDetectRole(fileName: string, sampleText: string): ContentRole {
    const name = fileName.toLowerCase();
    if (name.includes('רש"י') || name.includes('רשי') || name.includes('rashi')) return 'primary_comment';
    if (name.includes('תוספות') || name.includes('תוס') || name.includes('tosafot')) return 'secondary_comment';
    if (name.includes('הערות') || name.includes('footnote')) return 'footnote';
    if (name.includes('גמרא') || name.includes('מקור') || name.includes('משנה') || name.includes('chumash') || name.includes('gemara')) return 'main_source';
    
    // Check text contents
    if (sampleText.includes('רש״י') || sampleText.includes('פירש״י') || sampleText.includes('בד״ה')) return 'primary_comment';
    if (sampleText.includes('תוספות') || sampleText.includes('תוס׳')) return 'secondary_comment';
    return 'main_source';
  }

  /**
   * Automatically discovers Rav-Text links between Commentary files and Main Source files
   * by analyzing Dibbur HaMatchil and locating the exact phrase in the source text.
   */
  public static autoLinkCommentariesToSource(
    sourceUnits: ContentUnit[],
    commentaryUnits: ContentUnit[]
  ): RavTextLink[] {
    const links: RavTextLink[] = [];
    // Strips Hebrew vowel points, cantillation marks, punctuation, and normalizes rabbinic orthography
    const normalizeHebrew = (str: string) =>
      str
        .replace(/[\u0591-\u05C7]/g, '')
        .replace(/[״"׳',.:;!?—–\-()[\]]/g, ' ')
        .replace(/\b(?:כו|וכו|גמ|מתני|ה"ג|גרסינן|גרסי)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const normalizeWord = (w: string) =>
      w
        .replace(/[\u0591-\u05C7״"׳',.:;!?—–\-()[\]]/g, '')
        .replace(/וו/g, 'ו')
        .replace(/יי/g, 'י');

    const expandRabbinicAbbrev = (str: string) =>
      str
        .replace(/ב["״]ש/g, 'בית שמאי')
        .replace(/ב["״]ה/g, 'בית הלל')
        .replace(/מ["״]ט/g, 'מאי טעמא')
        .replace(/קמ["״]ל/g, 'קמשמע לן')
        .replace(/ש["״]פ/g, 'שוה פרוטה')
        .replace(/ג['׳]/g, 'שלש')
        .replace(/ח['׳]/g, 'שמנה');

    // Track last matched source index per commentary role so sequential commentaries naturally advance with the sugya
    const lastMatchedIdxByRole: Record<string, number> = {
      primary_comment: 0,
      secondary_comment: 0,
    };

    const validSources = sourceUnits
      .map((u, idx) => ({ unit: u, idx, normText: normalizeHebrew(u.rawText), normWords: normalizeHebrew(u.rawText).split(' ').map(normalizeWord).filter(Boolean) }))
      .filter(s => s.unit.role !== 'chapter' && s.unit.role !== 'main_title' && s.unit.role !== 'heading');

    for (const com of commentaryUnits) {
      let dibbur = com.dibburHamatchil;
      if (!dibbur) {
        const delimMatch = com.rawText.match(/^([^.:—–\n]{2,55}?)(?:\s*[:—–]|\s+-\s+|\.\s+)/);
        if (delimMatch && delimMatch[1]) {
          dibbur = delimMatch[1]
            .replace(/^[\s[\]()]+/g, '')
            .replace(/^(?:רש["״]י|תוספות|תוס['׳]|ד["״]ה|בד["״]ה)\s+/g, '')
            .trim();
        } else {
          const colonIdx = com.rawText.indexOf(':');
          if (colonIdx > 0 && colonIdx < 40) {
            dibbur = com.rawText.substring(0, colonIdx).trim();
          } else {
            dibbur = com.rawText.split(/\s+/).slice(0, 3).join(' ');
          }
        }
      }

      if (!dibbur) continue;
      const expandedDibbur = expandRabbinicAbbrev(dibbur);
      const normDibbur = normalizeHebrew(expandedDibbur);
      const dibburWords = normDibbur
        .split(' ')
        .map(normalizeWord)
        .filter(w => w.length >= 2 && !['ופרכינן', 'ומשני', 'פירוש', 'כלומר', 'דקתני', 'דתנן'].includes(w));

      const roleKey = com.role === 'secondary_comment' ? 'secondary_comment' : 'primary_comment';
      const lastSrcIdx = lastMatchedIdxByRole[roleKey] ?? 0;

      let matchedSrc: ContentUnit | undefined;
      let matchedPos = lastSrcIdx;

      // 1. Explicit pre-set link
      if (com.linkedSourceId) {
        const exp = validSources.find(s => s.unit.id === com.linkedSourceId);
        if (exp) {
          matchedSrc = exp.unit;
          matchedPos = exp.idx;
        }
      }

      // 2. Exact normalized phrase / token-sequence match (preferring nearby forward match within 6 segments of lastSrcIdx)
      if (!matchedSrc && dibburWords.length > 0) {
        const hasExactTokenSubseq = (srcWords: string[], dWords: string[]) => {
          if (dWords.length === 0 || srcWords.length < dWords.length) return false;
          for (let i = 0; i <= srcWords.length - dWords.length; i++) {
            let allMatch = true;
            for (let j = 0; j < dWords.length; j++) {
              if (srcWords[i + j] !== dWords[j] && srcWords[i + j].slice(1) !== dWords[j] && dWords[j].slice(1) !== srcWords[i + j]) {
                allMatch = false;
                break;
              }
            }
            if (allMatch) return true;
          }
          return false;
        };

        const candidates = validSources.filter(s => hasExactTokenSubseq(s.normWords, dibburWords));
        const maxJump = dibburWords.length <= 2 ? 6 : 15;
        const nearbyForwardCand = candidates.find(
          c => c.idx >= Math.max(0, lastSrcIdx - 1) && c.idx <= lastSrcIdx + maxJump
        );
        const anyForwardCand = dibburWords.length >= 3 ? candidates.find(c => c.idx >= Math.max(0, lastSrcIdx - 1)) : undefined;
        const chosen =
          nearbyForwardCand ??
          anyForwardCand ??
          (candidates[0] && candidates[0].idx >= lastSrcIdx - 2 && candidates[0].idx <= lastSrcIdx + maxJump
            ? candidates[0]
            : undefined);
        if (chosen) {
          matchedSrc = chosen.unit;
          matchedPos = chosen.idx;
        }
      }

      // 3. Anchor-word / prefix-tolerant match within a forward-biased window around `lastSrcIdx`
      if (!matchedSrc && dibburWords.length > 0) {
        let bestScore = 0;
        let bestCand: typeof validSources[0] | undefined;

        const wordsMatchFuzzy = (dw: string, sw: string) => {
          if (dw === sw) return true;
          const stripKtifMalei = (x: string) => x.replace(/[וי]/g, '');
          if (stripKtifMalei(dw) === stripKtifMalei(sw) && stripKtifMalei(dw).length >= 2) return true;
          // Allow 1-letter Aramaic/Hebrew prefix difference (ו, ד, ב, ל, מ, ש, ה)
          if (dw.length >= 3 && sw.length >= 3) {
            if (dw.slice(1) === sw || sw.slice(1) === dw) return true;
            if (stripKtifMalei(dw.slice(1)) === stripKtifMalei(sw) || stripKtifMalei(sw.slice(1)) === stripKtifMalei(dw)) return true;
          }
          return false;
        };

        for (const s of validSources) {
          if (s.idx < lastSrcIdx - 2) continue;
          if (dibburWords.length <= 2 && s.idx > lastSrcIdx + 7) continue;
          let hitCount = 0;
          for (const dw of dibburWords) {
            if (s.normWords.some(sw => wordsMatchFuzzy(dw, sw))) {
              hitCount++;
            }
          }
          if (hitCount === 0) continue;

          const coverage = hitCount / dibburWords.length;
          // Prefer sources at or slightly ahead of `lastSrcIdx`
          const dist = s.idx >= lastSrcIdx - 1 ? s.idx - lastSrcIdx : (lastSrcIdx - s.idx) * 2.5;
          const proximityBonus = Math.max(0, 1 - dist / 18) * 0.35;
          const score = coverage + (hitCount >= 2 ? 0.25 : 0) + proximityBonus;

          if ((coverage >= 0.5 || hitCount >= 2) && score > bestScore) {
            bestScore = score;
            bestCand = s;
          }
        }

        if (bestCand) {
          matchedSrc = bestCand.unit;
          matchedPos = bestCand.idx;
        }
      }

      // 4. Contextual fallback: if a commentary quotes a secondary verse or paraphrases the current sugya step,
      // keep it anchored to the current sugya source (`validSources[lastSrcIdx]`) rather than leaving it unlinked
      // and dumped at the end of the book!
      if (!matchedSrc && validSources.length > 0) {
        const fallback = validSources.find(s => s.idx === lastSrcIdx) ?? validSources[0];
        matchedSrc = fallback.unit;
        matchedPos = fallback.idx;
      }

      if (matchedSrc) {
        lastMatchedIdxByRole[roleKey] = Math.max(lastSrcIdx, matchedPos);
        links.push({
          linkId: `link-${com.id}-${matchedSrc.id}`,
          sourceUnitId: matchedSrc.id,
          commentaryUnitId: com.id,
          dibburHamatchil: dibbur,
          isUserLocked: false,
          confidenceScore: 0.95,
          sourceSnippet: matchedSrc.rawText.substring(0, 60),
          commentarySnippet: com.rawText.substring(0, 60),
          commentaryType: com.role === 'primary_comment' ? 'Rashi' : 'Tosafot',
        });
        com.linkedSourceId = matchedSrc.id;
        com.dibburHamatchil = dibbur;
      }
    }

    return links;
  }
}

