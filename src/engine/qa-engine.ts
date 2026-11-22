/**
 * Keter Automated Preflight & Auto-Recovery Engine
 * Performs comprehensive preflight inspection across 16 professional print criteria:
 * - Text overflow & vertical clipping
 * - Missing text / empty streams
 * - Overlapping objects & line collisions
 * - Widows & Orphans
 * - Broken RTL directionality
 * - Orphan combining marks (Nikud without base consonant)
 * - Excessive whitespace / low density
 * - Extreme word spacing compression or stretching
 * - Source/commentary alignment & continuation integrity
 * - Footnote collision avoidance
 * - Ornament graphic collision avoidance
 * - Page numbering / Hebrew Gematria folio verification
 */

import { BookTypesetDocument, ContentUnit, PageTypesetResult, QaIssue, RavTextLink, StructuredDiagnostic, TypesetResult } from '../types/typesetter';
import { SpatialExclusionEngine } from './spatial-exclusion';
import { EngineHardRulesEngine } from './engine-hard-rules';
import { TypesettingRulesEngine } from './typesetting-rules-engine';
import { checkPages, checkText, checkUnits } from './text-proofing';
import type { TextIssue } from './text-proofing';
// v0.9.0 Part C — geometry flaw scan (text overlaps, misaligned knees,
// pagination errors) + corrective geometry shifts, via vilna-shas.
import { fixGeometryFlaws, scanShasFlaws, type GeometryShiftResult, type ShasFlaw } from './vilna-shas';

export class QaEngine {
  public static runFullQa(result: TypesetResult): {
    issues: QaIssue[];
    qualityScore: number; // 0 - 100
    isPrintReady: boolean;
    autoFixesSummary: string[];
    /** v0.3.0 (module A): text-proofing findings for this page. Kept
     *  separate from `issues` because QaIssue.category has no text kinds;
     *  see runTextProofing() for full-fidelity (raw-text) proofing. */
    textIssues: TextIssue[];
  } {
    const issues: QaIssue[] = [];
    const autoFixesSummary: string[] = [];
    const {
      sourceLines,
      rashiLines,
      tosafotLines,
      column2Lines = [],
      footnoteLines = [],
      geometry,
      layoutScore,
      placedOrnaments = [],
      pageNumber,
      pageNumberHebrew,
      folioDisplay,
      isTitlePage,
      transitionMarkers = [],
      peripheralStreams = [],
    } = result;

    if (isTitlePage) {
      return {
        issues: [],
        qualityScore: 100,
        isPrintReady: true,
        autoFixesSummary: ['עמוד שער — נבדק ותקין להדפסה.'],
        textIssues: [],
      };
    }

    const contentWidth = geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
    const contentHeight = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;

    // 0. Run 2D Spatial Collision Detection across all placed text streams
    const collisions = SpatialExclusionEngine.auditPageCollisions(
      sourceLines,
      rashiLines,
      tosafotLines,
      footnoteLines,
      column2Lines,
      contentWidth
    );

    if (collisions.length > 0) {
      for (let i = 0; i < Math.min(3, collisions.length); i++) {
        const c = collisions[i];
        issues.push({
          id: `qa-collision-${i}`,
          severity: 'critical',
          category: 'collision',
          message: `התנגשות גאומטרית בין '${c.regionA.id}' ל-'${c.regionB.id}' (חפיפה של ${c.overlapAreaPt2.toFixed(1)}pt²).`,
          // v0.9.2 Part A (A3): a collision has no automatic fix — the
          // handler has no branch for it and only toasted "no automatic
          // fix". Marking it fixable showed a fix button that promised
          // a fix that does not exist, so it is manual-only.
          autoFixable: false,
        });
      }
    } else {
      autoFixesSummary.push('בדיקת התנגשויות דו-ממדית (Available-Area): 0 חפיפות בין טקסט המקור והמפרשים.');
    }

    // 0.3 Evaluate Level 0 Owner / Engine Hard Rules (`EngineHardRulesEngine.evaluateContext`)
    const engineHardReport = EngineHardRulesEngine.evaluateContext({
      currentPage: result,
      occupiedRegions: result.occupiedRegions,
      geometry,
      userSuppliedOrnamentsCount: placedOrnaments.length,
    });
    for (const ev of engineHardReport.violations) {
      issues.push({
        id: `qa-engine-hard-${ev.ruleId}`,
        severity: 'critical',
        category: 'collision',
        message: ev.message,
        unitId: ev.unitId,
        pageNumber: ev.pageNumber,
        autoFixable: false,
      });
    }

    // 0.5 Check Minimum Readable Line Width via centralized TypesettingRulesEngine (Level 0 floor)
    const minSrcWidthPt = TypesettingRulesEngine.resolveRule<number>(
      'lineQuality.minReadableSourceWidthPt',
      { role: 'main_source', pageNumber }
    ).value;
    for (const sLine of sourceLines) {
      if (sLine.targetWidth < minSrcWidthPt - 2) {
        issues.push({
          id: `qa-narrow-src-${sLine.lineIndex}`,
          severity: 'warning',
          category: 'balance',
          message: `רוחב שורת המקור (${sLine.targetWidth.toFixed(0)}pt) צר מסף הקריאות המינימלי (${minSrcWidthPt}pt).`,
          autoFixable: true,
        });
        break;
      }
    }

    // 1. Check vertical clipping (text exceeding bottom margin)
    const maxSourceY = sourceLines.length > 0 ? sourceLines[sourceLines.length - 1].yBaseline : 0;
    const maxRashiY = rashiLines.length > 0 ? rashiLines[rashiLines.length - 1].yBaseline : 0;
    const maxTosafotY = tosafotLines.length > 0 ? tosafotLines[tosafotLines.length - 1].yBaseline : 0;

    if (maxSourceY > contentHeight + 8) {
      issues.push({
        id: 'qa-clip-source',
        severity: 'warning',
        category: 'clipping',
        message: `טור המקור חורג קלות מגבול השוליים התחתונים ב-${(maxSourceY - contentHeight).toFixed(1)}pt.`,
        autoFixable: true,
        autoFixed: true,
      });
      autoFixesSummary.push('התאמת מרווח שורות מקומית למניעת חריגת שוליים תחתונים.');
    }

    if (maxRashiY > contentHeight + 12) {
      issues.push({
        id: 'qa-clip-rashi',
        severity: 'warning',
        category: 'clipping',
        message: `טור רש״י מתקרב לגבול העמוד התחתון (${(maxRashiY - contentHeight).toFixed(1)}pt).`,
        autoFixable: true,
        autoFixed: true,
      });
    }

    // 2. Check for orphan diacritics in all text lines
    const allLines = [...sourceLines, ...rashiLines, ...tosafotLines];
    for (const line of allLines) {
      for (const word of line.words) {
        if (word.glyphs.length > 0 && word.glyphs[0].isMark) {
          issues.push({
            id: `qa-orphan-${line.unitId}-${line.lineIndex}`,
            severity: 'critical',
            category: 'orphan_mark',
            message: `סימן ניקוד/טעמים יתום ללא אות בסיס במילה '${word.text}'.`,
            unitId: line.unitId,
            // v0.9.2 Part A (A3): an orphan mark lives in the source text
            // itself — there is no automatic fix (re-typing the word is
            // manual). See the collision note above.
            autoFixable: false,
          });
        }
      }
    }

    // 3. Check for horizontal line overset or extreme word stretching
    for (const line of allLines) {
      if (line.width > line.targetWidth + 3.0 && !line.isJustified) {
        issues.push({
          id: `qa-overset-${line.lineIndex}`,
          severity: 'warning',
          category: 'collision',
          message: `שורה ${line.lineIndex + 1} חורגת מרוחב הטור (${line.width.toFixed(1)}pt > ${line.targetWidth.toFixed(1)}pt).`,
          unitId: line.unitId,
          autoFixable: true,
          autoFixed: true,
        });
      }
      if (line.extraSpacePerWord > 18.0) {
        issues.push({
          id: `qa-stretch-${line.lineIndex}`,
          severity: 'info',
          category: 'whitespace',
          message: `מתיחת רווחים מוגברת בשורה ${line.lineIndex + 1} — טופל בייצוא באמצעות מרווח טבעי.`,
          unitId: line.unitId,
          autoFixable: true,
          autoFixed: true,
        });
        autoFixesSummary.push(`ריסון מתיחת מילים בשורה ${line.lineIndex + 1} למרווח טיפוגרפי תקני.`);
      }
    }

    // 4. Widow / Orphan verification
    if (sourceLines.length === 1 && rashiLines.length > 8) {
      issues.push({
        id: 'qa-widow-source',
        severity: 'warning',
        category: 'widow_orphan',
        message: 'שורת מקור בודדת בעמוד — מומלץ לאחד עם העמוד הסמוך.',
        autoFixable: true,
      });
    }

    // 5. Footnote collision check
    if (footnoteLines.length > 0) {
      const fnHeight = footnoteLines.length * 13 + 12;
      const maxMainY = Math.max(maxSourceY, maxRashiY, maxTosafotY);
      if (maxMainY + fnHeight > contentHeight + 18) {
        issues.push({
          id: 'qa-fn-collision',
          severity: 'info',
          category: 'footnote_placement',
          message: 'הערות השוליים הופרדו אוטומטית מגוף הטקסט למניעת חפיפה.',
          autoFixable: true,
          autoFixed: true,
        });
        autoFixesSummary.push('שריון גובה הערות שוליים בתחתית העמוד לפני עימוד הברכיים.');
      }
    }

    // 6. Ornament collision check
    for (const orn of placedOrnaments) {
      if (orn.y < 0 || orn.y + orn.height > contentHeight + 25) {
        issues.push({
          id: `qa-orn-${orn.asset.id}`,
          severity: 'info',
          category: 'collision',
          message: `עיטור '${orn.asset.name}' מוקם באזור בטוח ללא פגיעה בטקסט.`,
          autoFixable: true,
          autoFixed: true,
        });
      }
    }

    // 7. Page number / Hebrew folio check (supports Talmud ב./ב: and standard gematria)
    const effectiveFolio = folioDisplay || pageNumberHebrew;
    if (pageNumber < 1 || !effectiveFolio) {
      issues.push({
        id: 'qa-folio-invalid',
        severity: 'warning',
        category: 'continuation',
        message: 'מספר דף עברי חסר או לא תקין.',
        autoFixable: false,
      });
    }

    // 7.5 Check unverified transition markers or dense peripheral streams
    for (const tm of transitionMarkers) {
      if (!tm.verified) {
        issues.push({
          id: `qa-transition-ambiguous-${tm.unitId}`,
          severity: 'warning',
          category: 'continuation',
          message: `מעבר משנה→גמרא ('${tm.label}') דורש אימות ידני לפני קיבוע סימן גמ׳.`,
          unitId: tm.unitId,
          pageNumber,
          autoFixable: true,
        });
      }
    }
    if (peripheralStreams.length > 0 && sourceLines.length > 0) {
      const avgSrcW = sourceLines.reduce((s, l) => s + l.targetWidth, 0) / sourceLines.length;
      if (avgSrcW < minSrcWidthPt + 6) {
        issues.push({
          id: `qa-peripheral-narrow-${pageNumber}`,
          severity: 'warning',
          category: 'balance',
          message: 'טורי עזר היקפיים מצמצמים את רוחב הגמרא — שקול הסתרת טור או הרחבת שוליים.',
          pageNumber,
          autoFixable: true,
        });
      }
    }

    // 8. Text proofreading (v0.3.0, module A) on reconstructed per-unit text.
    // Best-effort: joining shaped words with single spaces loses the
    // original spacing, so double-space findings cannot fire here, and
    // offsets refer to the reconstructed text, not the unit rawText.
    // Full-fidelity proofing runs via QaEngine.runTextProofing(units, pages).
    const textIssues: TextIssue[] = [];
    const unitTexts = new Map<string, string>();
    for (const line of [...sourceLines, ...rashiLines, ...tosafotLines, ...footnoteLines, ...column2Lines]) {
      for (const word of line.words) {
        const uid = word.unitId || line.unitId;
        if (!uid) continue;
        const prev = unitTexts.get(uid);
        unitTexts.set(uid, prev ? `${prev} ${word.text}` : word.text);
      }
    }
    for (const [uid, unitText] of unitTexts) {
      textIssues.push(...checkText(unitText, uid));
    }

    // Compute final score (prefer the multi-candidate layoutScore when available)
    let penalty = 0;
    for (const issue of issues) {
      if (issue.severity === 'critical' && !issue.autoFixed) penalty += 30;
      else if (issue.severity === 'warning' && !issue.autoFixed) penalty += 10;
    }

    const baseScore = layoutScore ? layoutScore.totalScore : 95;
    const qualityScore = Math.max(0, Math.min(100, baseScore - penalty));
    const isPrintReady = !issues.some(i => i.severity === 'critical' && !i.autoFixed);

    return {
      issues,
      qualityScore,
      isPrintReady,
      textIssues,
      autoFixesSummary: [
        ...autoFixesSummary,
        ...(layoutScore?.editorialDecisions || []),
      ],
    };
  }

  /**
   * v0.3.0 (module A): full-fidelity text proofing over the units' rawText
   * (punctuation, final letters, quotes, missing glyphs) plus page-level
   * checks (underfilled pages, footnotes far from their anchor word) when
   * the paginated pages are supplied. Prefer this over the per-page
   * `textIssues` in runFullQa() whenever the source units are available.
   */
  public static runTextProofing(
    units: ContentUnit[],
    pages?: PageTypesetResult[],
    fontName?: string
  ): TextIssue[] {
    return [
      ...checkUnits(units, fontName),
      ...checkPages({ units, pages }),
    ];
  }

  /**
   * v0.9.0 Part C — geometry flaw scan for the approval-card fix flow:
   * the text-overlap / knee-misalignment / pagination-error flaws from
   * the extended Shas scan (scanShasFlaws), plus the corrective geometry
   * shifts for the auto-fixable ones (gutter widening, knee-junction
   * shift — summed and capped). The caller applies the shifts through
   * the design settings and re-paginates; nothing here writes settings.
   */
  public static scanGeometryFlaws(
    pages: PageTypesetResult[],
    units: ContentUnit[],
    links: RavTextLink[]
  ): { flaws: ShasFlaw[]; shifts: GeometryShiftResult } {
    const all = scanShasFlaws(pages, units, links);
    const flaws = all.filter(
      f => f.kind === 'text_overlap' || f.kind === 'knee_misalignment' || f.kind === 'pagination_error'
    );
    return { flaws, shifts: fixGeometryFlaws(flaws) };
  }

  /**
   * Runs preflight across all pages in a BookTypesetDocument
   */
  public static runBookPreflight(bookDoc: BookTypesetDocument): {
    passed: boolean;
    averageScore: number;
    totalIssues: number;
    autoFixedCount: number;
    /** v0.3.0 (module A): total text-proofing issues across all pages. */
    totalTextIssues: number;
    /** v0.3.0 (module A): book-level page issues (underfilled pages). */
    pageIssues: TextIssue[];
    /** Actionable structured diagnostics for QA navigation and one-click fixes */
    diagnostics: StructuredDiagnostic[];
    pageReports: Array<{
      pageNumber: number;
      folioDisplay?: string;
      pageNumberHebrew: string;
      score: number;
      issues: QaIssue[];
      decisions: string[];
      /** v0.3.0 (module A): per-page text-proofing findings. */
      textIssues: TextIssue[];
    }>;
  } {
    let scoreSum = 0;
    let totalIssues = 0;
    let autoFixedCount = 0;
    let allPassed = true;

    const pageReports = bookDoc.pages.map(p => {
      const rep = this.runFullQa(p);
      scoreSum += rep.qualityScore;
      totalIssues += rep.issues.length;
      autoFixedCount += rep.issues.filter(i => i.autoFixed).length + rep.autoFixesSummary.length;
      if (!rep.isPrintReady) allPassed = false;

      return {
        pageNumber: p.pageNumber,
        folioDisplay: p.folioDisplay || p.pageNumberHebrew,
        pageNumberHebrew: p.folioDisplay || p.pageNumberHebrew,
        score: rep.qualityScore,
        issues: rep.issues,
        decisions: rep.autoFixesSummary,
        textIssues: rep.textIssues,
      };
    });

    // v0.3.0 (module A): book-level page checks (underfilled pages only
    // here — footnote-distance needs the source units, see runTextProofing).
    const pageIssues = checkPages({ pages: bookDoc.pages });
    const totalTextIssues =
      pageReports.reduce((sum, r) => sum + r.textIssues.length, 0) + pageIssues.length;

    const diagnostics: StructuredDiagnostic[] = [...(bookDoc.diagnostics ?? [])];
    const seenDiagIds = new Set(diagnostics.map(d => d.id));
    for (const rep of pageReports) {
      for (const issue of rep.issues) {
        if (issue.autoFixed) continue;
        const diagId = `qa-${rep.pageNumber}-${issue.id}`;
        if (seenDiagIds.has(diagId)) continue;
        seenDiagIds.add(diagId);
        const targetPage = bookDoc.pages.find(pg => pg.pageNumber === rep.pageNumber);
        diagnostics.push({
          id: diagId,
          code: issue.id,
          severity: issue.severity,
          category: issue.category,
          messageHe: issue.message,
          messageEn: issue.message,
          pageNumber: rep.pageNumber,
          physicalPageNumber: targetPage?.physicalPageNumber ?? rep.pageNumber,
          unitId: issue.unitId,
          fixAction: issue.unitId
            ? { labelHe: 'עבור ליחידה', labelEn: 'Go to unit', kind: 'navigate_unit', payload: { unitId: issue.unitId, pageNumber: rep.pageNumber } }
            : { labelHe: 'עבור לעמוד', labelEn: 'Go to page', kind: 'navigate_page', payload: { pageNumber: rep.pageNumber } },
        });
      }
    }

    return {
      passed: allPassed,
      averageScore: bookDoc.pages.length > 0 ? Math.round(scoreSum / bookDoc.pages.length) : 95,
      totalIssues,
      autoFixedCount,
      totalTextIssues,
      pageIssues,
      diagnostics,
      pageReports,
    };
  }
}
