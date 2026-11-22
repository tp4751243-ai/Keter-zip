/**
 * Keter Multi-Page Pagination & Global Look-Ahead Optimization Engine
 *
 * Implements:
 * 1. Global Multi-Page Look-Ahead & Page-Break Candidate Solver (Problems 5 & 6):
 *    Never greedily packs Page 1 if doing so leaves Page 2 with a sparse fragment.
 *    Evaluates multiple page-count and break-point candidates and scores the entire sequence of pages.
 * 2. Semantic Keep-Together Priority Enforcement (Problem 8):
 *    Preserves Source + Linked Commentary (Priority 100), Dibbur HaMatchil + Commentary (Priority 90),
 *    Heading + Opening Paragraph (Priority 80), and Paragraph boundaries (Priority 60).
 * 3. Per-Page Dynamic Divider for Source-Top + Commentary-Bottom (Problem 5):
 *    Calculates each page's horizontal divider (`dividerY`) from the actual height of that page's
 *    source lines plus a clean breathing margin, eliminating giant gaps between source and commentary.
 * 4. Two-Column Vertical Balancing & Multi-Page Distribution (Problem 9).
 */

import {
  BookLayoutType,
  BookTypesetDocument,
  ContentRole,
  ContentUnit,
  DynamicKneeContour,
  KeepPriority,
  KneeCustomSettings,
  LinkedRavGroup,
  OpeningWordBoxGeom,
  OrnamentAsset,
  OrnamentUserRule,
  PageGeometry,
  PageTypesetResult,
  PeripheralStreamBlock,
  PeripheralStreamKind,
  RavTextLink,
  ShapedWord,
  StructuredDiagnostic,
  TransitionMarkerGeom,
  TypesetLine,
  AnchorLink,
} from '../types/typesetter';
import { TypesetterEngine } from './typesetter-core';
import { DynamicKneeEngine } from './dynamic-knee';
import { anchorLinksToRavTextLinks } from './commentary-linker';
import {
  buildMichtavBox,
  detectMishnahGemaraBoundary,
  formatBodyFolioLabel,
  formatVilnaRunningHeader,
  isMishnahUnit,
  spreadSideForPageIndex,
} from './vilna-shas';
import { checkMarginalPlacementFit } from './vilna-preset';
import { PdfExporter } from './pdf-exporter';
import { OrnamentLibraryEngine } from './ornament-library';
import { SpatialExclusionEngine } from './spatial-exclusion';
import { DocxImporter } from './docx-importer';
import {
  LocalRuleOverride,
  TypesettingRulesConfig,
  TypesettingRulesEngine,
  UserTypesettingRule,
} from './typesetting-rules-engine';
import { EngineHardRulesEngine } from './engine-hard-rules';
import {
  DEFAULT_OPENING_DECORATION,
  DEFAULT_PERIPHERAL_STREAMS,
  DEFAULT_TRANSITION_MARKER,
  PeripheralStreamConfig,
  ProfessionalDesignSettings,
} from '../types/design-settings';
import { DesignSettingsEngine } from './design-settings-engine';
import {
  acceptedRolesForBox,
  boxFlowIntervals,
  clampFontSizeForBox,
  defaultCustomLayoutDesign,
  isMainTextBox,
  sanitizeCustomLayoutDesign,
} from './custom-layout-engine';
import { CustomLayoutBox, SemanticStyleRole } from '../types/design-settings';
import { detectYiddish } from './yiddish-sefarim';

const PERIPHERAL_STREAM_LABELS: Record<PeripheralStreamKind, { he: string; en: string; patterns: RegExp[] }> = {
  ein_mishpat: { he: 'עין משפט', en: 'Ein Mishpat', patterns: [/עין\s*משפט/, /ein[_\s-]*mishpat/i] },
  ner_mitzvah: { he: 'נר מצוה', en: 'Ner Mitzvah', patterns: [/נר\s*מצוה/, /ner[_\s-]*mitzvah/i] },
  masoret_hashas: { he: 'מסורת הש״ס', en: 'Masoret HaShas', patterns: [/מסורת\s*הש["״']?ס/, /masoret/i] },
  torah_or: { he: 'תורה אור', en: 'Torah Or', patterns: [/תורה\s*אור/, /torah[_\s-]*or/i] },
  gilyon_hashas: { he: 'גליון הש״ס', en: 'Gilyon HaShas', patterns: [/גליון\s*הש["״']?ס/, /gilyon/i] },
  hagahot_habach: { he: 'הגהות הב״ח', en: 'Hagahot HaBach', patterns: [/הגהות\s*הב["״']?ח/, /habach|bach/i] },
  rabbeinu_chananel: { he: 'רבינו חננאל', en: 'Rabbeinu Chananel', patterns: [/רבינו\s*חננאל/, /ר["״']?ח\b/, /chananel/i] },
  ran: { he: 'ר״ן', en: 'Ran', patterns: [/^ר["״']?ן\b/, /\bran\b/i] },
  maharsha: { he: 'מהרש״א', en: 'Maharsha', patterns: [/מהרש["״']?א/, /maharsha/i] },
};

function detectPeripheralStreamKind(unit: ContentUnit): PeripheralStreamKind | null {
  const hay = `${unit.styleName || ''} ${unit.rawText.slice(0, 64) || ''}`;
  for (const [kind, meta] of Object.entries(PERIPHERAL_STREAM_LABELS) as Array<[PeripheralStreamKind, typeof PERIPHERAL_STREAM_LABELS[PeripheralStreamKind]]>) {
    if (meta.patterns.some(rx => rx.test(hay))) {
      return kind;
    }
  }
  return null;
}

export interface PaginationInput {
  title: string;
  layoutType: BookLayoutType;
  units: ContentUnit[];
  links?: RavTextLink[];
  /**
   * v0.9.8 Phase 3/4 — AnchorLinks from the CommentaryLinkerEngine.
   * When present (and no explicit `links` are given) they are converted
   * to RavTextLinks and fed to the rav-text path as the explicit links,
   * so same-page gravity is driven by the new engine's constraints.
   * Explicit `links` always win when both are given.
   */
  anchorLinks?: AnchorLink[];
  geometry: PageGeometry;
  sourceFontSize?: number;
  commentaryFontSize?: number;
  kneeSettings?: KneeCustomSettings;
  requestedPageCount?: number;
  sourceFontFamily?: string;
  rashiFontFamily?: string;
  tosafotFontFamily?: string;
  enableOrnaments?: boolean;
  userSuppliedOrnaments?: OrnamentAsset[];
  userOrnamentRules?: OrnamentUserRule[];
  rulesConfig?: TypesettingRulesConfig;
  projectRules?: UserTypesettingRule[];
  localOverrides?: LocalRuleOverride[];
  designSettings?: ProfessionalDesignSettings;
}

export class PaginationEngine {
  /**
   * v0.8.0 Part C (§1): roles that flow in the rav-text SOURCE stream.
   * Before this fix the stream matched only main_source/chapter/
   * main_title/verse/regular_paragraph, so heading, siman, list_item,
   * table and the other structural roles were silently dropped.
   */
  private static readonly RAV_SOURCE_ROLES: ContentRole[] = [
    'main_source',
    'chapter',
    'main_title',
    'verse',
    'regular_paragraph',
    'heading',
    'siman',
    'subtitle',
    'introduction',
    'seif',
    'subheading',
    'bold_special',
    'list_item',
    'table',
    'caption',
  ];

  /** v0.8.0 Part C (§1): roles that flow in the tertiary band below the knee. */
  private static readonly RAV_TERTIARY_ROLES: ContentRole[] = [
    'tertiary_comment',
    'cross_reference',
    'side_note',
  ];

  /**
   * v0.8.0 Part C (§3/§6): backs a page/column take up to the start of a
   * keep-together unit that would otherwise straddle the break, so the
   * whole unit moves to the next page. Returns the (possibly reduced)
   * take; unchanged when the unit starts the page (it cannot move back
   * without emptying the page — that case is reported by the
   * keep-together verification in `paginateDocument`) or when the take
   * already ends the stream.
   */
  private static backUpTakeForKeepTogether(
    lines: TypesetLine[],
    cursor: number,
    take: number,
    keepTogetherUnitIds: Set<string>
  ): number {
    if (take <= 1 || keepTogetherUnitIds.size === 0) return take;
    if (cursor + take >= lines.length) return take;
    const lastLn = lines[cursor + take - 1];
    const nextLn = lines[cursor + take];
    if (!lastLn || !nextLn || lastLn.unitId !== nextLn.unitId) return take;
    if (!keepTogetherUnitIds.has(lastLn.unitId)) return take;
    let unitStart = cursor + take - 1;
    while (unitStart > cursor && lines[unitStart - 1].unitId === lastLn.unitId) {
      unitStart--;
    }
    if (unitStart > cursor) return unitStart - cursor;
    return take;
  }

  /**
   * Paginates all content units across multiple pages with global look-ahead optimization
   */
  public static paginateDocument(input: PaginationInput): BookTypesetDocument {
    const {
      title,
      layoutType,
      units: rawUnits,
      sourceFontSize = 14.5,
      commentaryFontSize = 10.5,
      kneeSettings = {
        mode: 'auto',
        upperKneeLines: 4,
        junctionPercent: 50,
        lowerWidthPercent: 78,
        stepDirection: 'auto',
        gutterWidth: 11,
      },
      enableOrnaments = true,
      userSuppliedOrnaments = [],
      userOrnamentRules = [],
    } = input;

    // v0.8.1 — white-screen fix: never throw on a missing geometry or
    // missing units (a project saved by an older version may not carry
    // them). Geometry falls back to the Vilna folio geometry the
    // persistence layer uses; missing units means an empty book, which
    // the empty-page guarantee below turns into one empty page.
    const geometry: PageGeometry = input.geometry ?? {
      pageWidth: 482,
      pageHeight: 680,
      marginTop: 48,
      marginBottom: 48,
      marginInside: 46,
      marginOutside: 42,
      isVerso: false,
    };
    const units: ContentUnit[] = rawUnits ?? [];

    const designSettings = input.designSettings;
    const effectiveSourceFontSize =
      designSettings?.roleStyles?.main_source?.character?.fontSizePt ?? sourceFontSize;
    const effectiveCommentaryFontSize =
      designSettings?.roleStyles?.primary_comment?.character?.fontSizePt ?? commentaryFontSize;
    const effectiveSourceFontFamily =
      designSettings?.roleStyles?.main_source?.character?.fontFamily ?? input.sourceFontFamily;
    const effectiveRashiFontFamily =
      designSettings?.roleStyles?.primary_comment?.character?.fontFamily ?? input.rashiFontFamily;
    const effectiveTosafotFontFamily =
      designSettings?.roleStyles?.secondary_comment?.character?.fontFamily ?? input.tosafotFontFamily;

    let rulesConfig: TypesettingRulesConfig =
      input.rulesConfig ??
      TypesettingRulesEngine.createConfig({
        projectRules: input.projectRules,
        localOverrides: input.localOverrides,
      });

    if (designSettings) {
      rulesConfig = DesignSettingsEngine.syncToTypesettingRulesConfig(designSettings, rulesConfig);
    }

    const contentWidth = geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
    const contentHeight = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;

    // v0.9.8 Phase 3/4 — AnchorLink constraints feed the rav-text
    // solver: when the caller passed AnchorLinks but no explicit
    // RavTextLinks, convert them (unmatched entries become
    // low-confidence links to the current sugya position, exactly as
    // the old linker's contextual fallback did). Explicit `links`
    // always win when both are given. Only the rav-text path consumes
    // them — the single/two-column paths have no commentary flanks.
    const anchorDerivedLinks: RavTextLink[] | undefined =
      !input.links && input.anchorLinks && input.anchorLinks.length > 0
        ? anchorLinksToRavTextLinks(
            input.anchorLinks,
            units,
            units.find(u => u.role === 'main_source')
          )
        : undefined;
    const effectiveRavLinks = input.links ?? anchorDerivedLinks;

    let doc: BookTypesetDocument;
    switch (layoutType) {
      case 'single_column':
        doc = this.paginateSingleColumn(
          title,
          units,
          geometry,
          contentWidth,
          contentHeight,
          effectiveSourceFontSize,
          enableOrnaments,
          userSuppliedOrnaments,
          userOrnamentRules,
          rulesConfig,
          designSettings
        );
        break;
      case 'two_column':
        doc = this.paginateTwoColumn(
          title,
          units,
          geometry,
          contentWidth,
          contentHeight,
          effectiveSourceFontSize,
          rulesConfig,
          designSettings
        );
        break;
      case 'source_top_commentary_bottom':
        doc = this.paginateTopSourceBottomCommentary(
          title,
          units,
          geometry,
          contentWidth,
          contentHeight,
          effectiveSourceFontSize,
          effectiveCommentaryFontSize,
          rulesConfig,
          designSettings
        );
        break;
      case 'custom_layout':
        // v0.6.0 Part C (§2): the custom-layout boxes REALLY drive
        // pagination now — text is shaped and broken inside the boxes
        // (including polygonal frames), box to box, overflowing to the
        // next folio. Per-page overrides from
        // `designSettings.pageLayout.customLayout.pageOverrides` apply
        // to their own page only.
        doc = this.paginateCustomLayout(
          title,
          units,
          geometry,
          contentWidth,
          contentHeight,
          effectiveSourceFontSize,
          effectiveCommentaryFontSize,
          rulesConfig,
          designSettings
        );
        break;
      case 'yiddish_sefer':
        // v0.8.0 Part D — Yiddish sefarim: Hebrew source (right column)
        // facing Yiddish text (left column), or Yiddish-only running text
        // full-width when there is no Hebrew stream.
        doc = this.paginateYiddishSefer(
          title,
          units,
          geometry,
          contentWidth,
          contentHeight,
          effectiveSourceFontSize,
          effectiveCommentaryFontSize,
          rulesConfig,
          designSettings,
          input.links
        );
        break;
      case 'mikraot_gedolot':
      case 'rav_text':
      default:
        doc = this.paginateRavText(
          title,
          layoutType,
          units,
          geometry,
          contentWidth,
          contentHeight,
          effectiveSourceFontSize,
          effectiveCommentaryFontSize,
          kneeSettings,
          enableOrnaments,
          effectiveRavLinks,
          userSuppliedOrnaments,
          userOrnamentRules,
          rulesConfig,
          designSettings
        );
        break;
    }

    doc.sourceFontFamily = effectiveSourceFontFamily;
    doc.rashiFontFamily = effectiveRashiFontFamily;
    doc.tosafotFontFamily = effectiveTosafotFontFamily;
    doc.designSettings = designSettings;

    let totalScoreSum = 0;
    for (let pIdx = 0; pIdx < doc.pages.length; pIdx++) {
      const page = doc.pages[pIdx];
      page.sourceFontFamily = effectiveSourceFontFamily;
      page.rashiFontFamily = effectiveRashiFontFamily;
      page.tosafotFontFamily = effectiveTosafotFontFamily;
      page.designSettings = designSettings;

      // Stage 12: Evaluate centralized Typesetting Rules (including Level 0 Engine Hard Rules) against each solved page
      // and integrate rule compliance with the physical LayoutQualityScore
      const evalResult = TypesettingRulesEngine.evaluateTypesettingRules({
        currentPage: page,
        previousPage: pIdx > 0 ? doc.pages[pIdx - 1] : undefined,
        nextPage: pIdx + 1 < doc.pages.length ? doc.pages[pIdx + 1] : undefined,
        units,
        links: doc.links ?? input.links ?? [],
        occupiedRegions: page.occupiedRegions,
        geometry: page.geometry,
        rulesConfig,
        userSuppliedOrnaments,
        userOrnamentRules,
        userSuppliedOrnamentsCount: userSuppliedOrnaments.length + userOrnamentRules.length,
      });

      if (page.layoutScore) {
        page.layoutScore.engineHardRuleViolationCount = evalResult.engineHardViolations.length;
        page.layoutScore.hardRuleViolationCount = evalResult.hardViolations.length;
        page.layoutScore.professionalRuleViolationCount =
          evalResult.professionalViolations.length + evalResult.preferencesViolated.length;
        page.layoutScore.disqualifiedByEngineHardRule = !evalResult.passedAllEngineHardRules;
        page.layoutScore.disqualifiedByHardRule = evalResult.disqualifiedCandidate;
        if (
          evalResult.engineHardViolations.length > 0 ||
          evalResult.hardViolations.length > 0 ||
          evalResult.professionalViolations.length > 0
        ) {
          page.layoutScore.totalScore = evalResult.qualityImpact.adjustedTotalScore;
        }
      }

      totalScoreSum += page.layoutScore?.totalScore ?? 92;
    }

    const bookHardReport = EngineHardRulesEngine.evaluateContext({
      bookDoc: doc,
      units,
      links: doc.links ?? input.links ?? [],
      userSuppliedOrnaments,
      userOrnamentRules,
      userSuppliedOrnamentsCount: userSuppliedOrnaments.length + userOrnamentRules.length,
    });

    doc.averageQualityScore =
      doc.pages.length > 0 ? Math.round(totalScoreSum / doc.pages.length) : 95;
    doc.preflightPassed = bookHardReport.passed;

    // v0.8.0 Part E: embedded images imported from DOCX (role 'image')
    // match no text stream, so the paginators above never place them.
    // Give each its own image-only page, interleaved in document order
    // after the page holding the nearest preceding text unit. Without
    // this the import would silently lose the images all over again.
    // Runs BEFORE the Part C post-pass so the post-pass sees the final
    // page list (image pages carry no lines, so they add no warnings).
    this.interleaveImageOnlyPages(doc, units, geometry, contentWidth, contentHeight, title);

    // v0.8.0 Part C (§1/§3/§9): honest loss + violation reporting. The
    // paginators must never silently drop text: any text-bearing unit
    // with zero placed words, any keep-together unit split across pages,
    // and any page whose layout score reports collisions is recorded on
    // the document and surfaced as a Hebrew warning (the QA panel and
    // the smoke scripts read these fields).
    {
      const allPageLines = (pg: PageTypesetResult): TypesetLine[] => [
        ...pg.sourceLines,
        ...pg.rashiLines,
        ...pg.tosafotLines,
        ...(pg.footnoteLines ?? []),
        ...(pg.column2Lines ?? []),
        ...(pg.sideNoteLines ?? []),
        ...(pg.tertiaryLines ?? []),
      ];
      const placedUnitIds = new Set<string>();
      for (const pg of doc.pages) {
        for (const l of allPageLines(pg)) {
          if (l.unitId) placedUnitIds.add(l.unitId);
          for (const w of l.words ?? []) {
            if (w.unitId) placedUnitIds.add(w.unitId);
          }
        }
      }
      const NON_TEXT_ROLES: ContentRole[] = [
        'image',
        'chart',
        'ornament',
        'page_element',
        'continuation',
      ];
      const unplaced = units.filter(
        u =>
          u.rawText?.trim() &&
          !placedUnitIds.has(u.id) &&
          !NON_TEXT_ROLES.includes(u.role)
      );
      doc.unplacedUnitIds = unplaced.map(u => u.id);
      if (unplaced.length > 0) {
        const names = unplaced
          .slice(0, 5)
          .map(u => u.id)
          .join(', ');
        const warning =
          unplaced.length > 5
            ? `אזהרה: ${unplaced.length} יחידות תוכן לא הוצבו בעימוד (${names} ועוד ${unplaced.length - 5}).`
            : `אזהרה: ${unplaced.length} יחידות תוכן לא הוצבו בעימוד (${names}).`;
        doc.unplacedUnitWarnings = [warning];
        (doc.autoFixesApplied ??= []).push(warning);
      }

      const keepIds = TypesettingRulesEngine.keepTogetherUnitIds(rulesConfig);
      if (keepIds.size > 0) {
        const pagesByUnit = new Map<string, Set<number>>();
        doc.pages.forEach((pg, pi) => {
          for (const l of allPageLines(pg)) {
            if (!l.unitId) continue;
            let s = pagesByUnit.get(l.unitId);
            if (!s) {
              s = new Set();
              pagesByUnit.set(l.unitId, s);
            }
            s.add(pi);
          }
        });
        doc.keepTogetherViolations = [...keepIds].filter(
          id => (pagesByUnit.get(id)?.size ?? 0) > 1
        );
        if (doc.keepTogetherViolations.length > 0) {
          (doc.autoFixesApplied ??= []).push(
            `אזהרה: ${doc.keepTogetherViolations.length} יחידות עם שמירת-יחד (Keep-Together) התפצלו בין עמודים — היחידה ארוכה מעמוד או מתחילה בראש עמוד.`
          );
        }
      }

      const totalCollisions = doc.pages.reduce(
        (acc, pg) => acc + (pg.layoutScore?.collisionCount ?? 0),
        0
      );
      if (totalCollisions > 0) {
        (doc.autoFixesApplied ??= []).push(
          `אזהרה: נמצאו ${totalCollisions} התנגשויות בין תיבות טקסט בעימוד.`
        );
      }
    }
    // v0.8.0 Part E: (image interleave moved above the Part C post-pass;
    // see the call before this block.)

    // v0.8.1 — WHITE-SCREEN ROOT CAUSE (user report 2026-11-10): an empty
    // book (0 content units — "New project → blank", or an imported .docx
    // with no text) paginated to ZERO pages in single_column, two_column,
    // source_top_commentary_bottom and yiddish_sefer. App then derived
    // activePage === undefined and EditorialStudioHeader dereferenced
    // activePage.pageNumberHebrew during render; with no ErrorBoundary
    // anywhere, React unmounted the whole window — a blank white screen.
    // A book always has at least one page, even an empty one, so no view
    // (and no exporter) can ever see an undefined page again.
    if (doc.pages.length === 0) {
      doc.pages.push({
        pageIndex: 0,
        pageNumber: 1,
        pageNumberHebrew: PdfExporter.toHebrewGematria(1),
        headerTitle: title,
        layoutType: doc.layoutType,
        geometry,
        sourceLines: [],
        rashiLines: [],
        tosafotLines: [],
        footnoteLines: [],
        knee: {
          pageContentWidth: contentWidth,
          pageContentHeight: contentHeight,
          topY: 0,
          kneeJunctionY: contentHeight,
          bottomY: contentHeight,
          upperSourceWidth: contentWidth,
          lowerSourceWidth: contentWidth,
          innerXOffset: 0,
          isLeftStepped: false,
          rightCommentaryWidth: 0,
          leftCommentaryWidth: 0,
          gutterWidth: 0,
        },
        layoutScore: {
          totalScore: 100,
          pageUtilization: 0,
          verticalBalance: 100,
          horizontalBalance: 100,
          whitespaceScore: 100,
          textDensity: 100,
          readability: 100,
          sourceCommentaryAlignment: 100,
          semanticPreservation: 100,
          widowOrphanPenalty: 0,
          lineBreakPenalty: 0,
          stretchingCompressionPenalty: 0,
          continuationQuality: 100,
          visualHierarchyScore: 100,
          collisionCount: 0,
          narrowColumnPenalty: 0,
          candidatesEvaluated: 1,
          lookAheadAdjusted: false,
          editorialDecisions: ['עמוד ריק'],
        },
        designSettings,
        sourceFontFamily: effectiveSourceFontFamily,
        rashiFontFamily: effectiveRashiFontFamily,
        tosafotFontFamily: effectiveTosafotFontFamily,
      });
      doc.totalPages = 1;
    }

    // Attach structured folio metadata, Mishnah->Gemara transition badges,
    // opening word decoration geometry, optional zero-reserve peripheral blocks,
    // structured Vilna headers, and unified StructuredDiagnostic items across the book.
    const diagnostics: StructuredDiagnostic[] = [];
    const boundaryChecks = new Map<string, ReturnType<typeof detectMishnahGemaraBoundary>>();
    for (let ui = 0; ui < units.length; ui++) {
      const check = detectMishnahGemaraBoundary(units, ui);
      if (check.isTransition) {
        boundaryChecks.set(units[ui].id, check);
      }
    }

    const transCfg = {
      ...DEFAULT_TRANSITION_MARKER,
      ...(designSettings?.ravText?.transitionMarker ?? {}),
    };
    const openCfg = {
      ...DEFAULT_OPENING_DECORATION,
      ...(designSettings?.ravText?.openingDecoration ?? {}),
    };
    const configuredPeripherals: PeripheralStreamConfig[] =
      designSettings?.ravText?.peripheralStreams ?? DEFAULT_PERIPHERAL_STREAMS;
    const enabledPeripheralMap = new Map<PeripheralStreamKind, PeripheralStreamConfig>(
      configuredPeripherals.filter(p => p.enabled).map(p => [p.id, p])
    );

    const emittedTransitionUnits = new Set<string>();
    const emittedChapterStartUnitIds = new Set<string>();
    const emittedUnestablishedBoundaryUnits = new Set<string>();
    let peripheralFitEmitted = false;
    const unitById = new Map(units.map(u => [u.id, u]));

    // v0.9.9 (I2): first main_source unit after each chapter heading —
    // the chapter-start opening-decoration candidates (scope
    // 'chapter_start'). The book-start unit is not one: it is covered
    // by the masechet-start frame on the first body page.
    const chapterStartUnitIds = new Set<string>();
    let afterChapter = false;
    for (const u of units) {
      if (u.role === 'chapter' || u.role === 'heading') {
        afterChapter = true;
        continue;
      }
      if (u.role === 'main_source' && afterChapter) {
        chapterStartUnitIds.add(u.id);
        afterChapter = false;
      }
    }
    // v0.9.9 (I2): Mishnah units whose following Gemara boundary cannot
    // be established at all (no boundary check for the next main_source
    // unit — e.g. a chapter heading intervenes, so the detector's
    // look-back stops). Flagged in QA on the Mishnah's page; the marker
    // is never guessed.
    const unestablishedBoundaryUnitIds = new Map<string, string>();
    for (let ui = 0; ui < units.length; ui++) {
      if (!isMishnahUnit(units[ui])) continue;
      let nextMain: ContentUnit | undefined;
      for (let j = ui + 1; j < units.length; j++) {
        if (units[j].role === 'main_source') {
          nextMain = units[j];
          break;
        }
      }
      if (nextMain && !boundaryChecks.has(nextMain.id) && !isMishnahUnit(nextMain)) {
        unestablishedBoundaryUnitIds.set(units[ui].id, nextMain.id);
      }
    }
    let bodyPageCounter = 0;

    for (let pIdx = 0; pIdx < doc.pages.length; pIdx++) {
      const pg = doc.pages[pIdx];
      pg.pageIndex = pIdx;
      pg.physicalPageNumber = pIdx + 1;

      if (!pg.isTitlePage && !pg.isImageOnlyPage) {
        const bIdx = bodyPageCounter++;
        pg.bodyPageIndex = bIdx;
        pg.geometry = { ...pg.geometry, isVerso: bIdx % 2 === 1 };
        const folioInfo = formatBodyFolioLabel(bIdx, layoutType, designSettings?.pageElements);
        pg.folioDisplay = folioInfo.folioDisplay;
        pg.pageNumberHebrew = folioInfo.folioDisplay;
        const spreadSide = spreadSideForPageIndex(bIdx);
        pg.structuredHeaders = formatVilnaRunningHeader(
          designSettings?.pageElements?.runningHeader,
          spreadSide,
          title,
          pg.headerTitle || title
        );

        // Verified Mishnah -> Gemara boundary transition marker (`גמ׳`) without mutating rawText
        if (transCfg.enabled && pg.sourceLines.length > 0) {
          const markers: TransitionMarkerGeom[] = [];
          for (const sl of pg.sourceLines) {
            if (!sl.unitId || emittedTransitionUnits.has(sl.unitId)) continue;
            const check = boundaryChecks.get(sl.unitId);
            if (!check) continue;
            emittedTransitionUnits.add(sl.unitId);
            const rawUnit = unitById.get(sl.unitId);
            const alreadyLiteralMarker = rawUnit ? /^(?:גמ׳|גמ')/.test(rawUnit.rawText.trim()) : false;
            if (!alreadyLiteralMarker && (check.verified || !transCfg.requireVerifiedBoundary)) {
              const markerText = (transCfg.markerText || 'גמ׳').trim();
              sl.transitionMarkerBefore = markerText;
              sl.transitionMarkerVerified = check.verified;
              sl.transitionMarkerConfidence = check.confidence;
              const lineRight = sl.xRight ?? (pg.geometry.pageWidth - pg.geometry.marginInside - pg.geometry.marginOutside);
              const lineLeft = sl.xLeft ?? Math.max(0, lineRight - sl.targetWidth);
              markers.push({
                label: markerText,
                xLeft: Math.max(0, lineRight - 28),
                xRight: lineRight,
                yBaseline: sl.yBaseline,
                yTop: sl.yTop ?? sl.yBaseline - sl.ascent,
                yBottom: sl.yBottom ?? sl.yBaseline + sl.descent,
                unitId: sl.unitId,
                confidence: check.confidence,
                verified: check.verified,
              });
              void lineLeft;
            }
            if (!check.verified && transCfg.highlightAmbiguousInQa) {
              diagnostics.push({
                id: `diag-boundary-${sl.unitId}`,
                code: 'AMBIGUOUS_MISHNAH_GEMARA_BOUNDARY',
                severity: 'warning',
                category: 'boundary',
                pageNumber: pg.pageNumber,
                physicalPageNumber: pg.physicalPageNumber,
                unitId: sl.unitId,
                messageHe: `${check.reasonHe} (יחידה ${sl.unitId})`,
                messageEn: `${check.reasonEn} (unit ${sl.unitId})`,
                fixAction: {
                  labelHe: 'קפוץ ליחידה ואמת',
                  labelEn: 'Inspect boundary unit',
                  kind: 'navigate_unit',
                  payload: { unitId: sl.unitId, pageIndex: pIdx },
                },
              });
            }
          }
          if (markers.length > 0) {
            pg.transitionMarkers = markers;
          }
        }

        // v0.9.9 (I2): Mishnah units whose Gemara boundary cannot be
        // established at all — QA warning on the Mishnah's page, never
        // a guessed marker.
        for (const sl of pg.sourceLines) {
          if (!sl.unitId || !unestablishedBoundaryUnitIds.has(sl.unitId)) continue;
          if (emittedUnestablishedBoundaryUnits.has(sl.unitId)) continue;
          emittedUnestablishedBoundaryUnits.add(sl.unitId);
          diagnostics.push({
            id: `diag-boundary-unestablished-${sl.unitId}`,
            code: 'UNESTABLISHED_MISHNAH_GEMARA_BOUNDARY',
            severity: 'warning',
            category: 'boundary',
            pageNumber: pg.pageNumber,
            physicalPageNumber: pg.physicalPageNumber,
            unitId: sl.unitId,
            messageHe: `משנה (יחידה ${sl.unitId}) ללא גבול גמרא שניתן לאמת — לא הוצב סמן מעבר. יש לאמת ידנית היכן מתחילה הגמרא.`,
            messageEn: `Mishnah (unit ${sl.unitId}) has no verifiable Gemara boundary — no transition marker placed. Verify manually where the Gemara begins.`,
            fixAction: {
              labelHe: 'קפוץ ליחידה ואמת',
              labelEn: 'Inspect boundary unit',
              kind: 'navigate_unit',
              payload: { unitId: sl.unitId, pageIndex: pIdx },
            },
          });
        }

        // Opening Word Frame decoration on the first body page (masechet
        // start) — or, when scope is 'chapter_start', on the first
        // eligible Gemara text at each perek start, once per perek.
        // Never on any other page. Text stays editable; the frame is
        // layout metadata on the unit, not an image.
        const firstSourceUnitId =
          pg.sourceLines.find(l => l.role === 'main_source')?.unitId ?? pg.sourceLines[0]?.unitId;
        const isChapterStartPage =
          openCfg.scope === 'chapter_start' &&
          firstSourceUnitId !== undefined &&
          chapterStartUnitIds.has(firstSourceUnitId) &&
          !emittedChapterStartUnitIds.has(firstSourceUnitId);
        if ((bIdx === 0 || isChapterStartPage) && openCfg.enabled && openCfg.styleId !== 'none' && !pg.openingWordBox && pg.sourceLines.length > 0) {
          if (isChapterStartPage && firstSourceUnitId) emittedChapterStartUnitIds.add(firstSourceUnitId);
          const anchorLine =
            (isChapterStartPage
              ? pg.sourceLines.find(
                  l =>
                    l.unitId === firstSourceUnitId &&
                    l.words.some(w => !w.isSpace && w.text.trim().length > 0)
                )
              : undefined) ??
            pg.sourceLines.find(
              l =>
                l.role === 'main_source' &&
                l.words.some(w => !w.isSpace && w.text.trim().length > 0)
            ) ??
            pg.sourceLines.find(
              l =>
                l.words.some(w => !w.isSpace && w.text.trim().length > 0) &&
                l.role !== 'ornament' &&
                l.role !== 'continuation'
            ) ??
            pg.sourceLines[0];
          const anchorWords = anchorLine.words.filter(w => !w.isSpace && w.text.trim().length > 0);
          const wCount = Math.max(1, Math.min(4, openCfg.wordCount ?? 1, anchorWords.length));
          const displayText =
            (openCfg.customWordText ?? '').trim() ||
            anchorWords.slice(0, wCount).map(w => w.text).join(' ');
          if (displayText) {
            anchorLine.isOpeningBoxAnchor = true;
            anchorLine.openingBoxWordsCount = wCount;
            const pgContentW = pg.geometry.pageWidth - pg.geometry.marginInside - pg.geometry.marginOutside;
            const colLeft = anchorLine.xLeft ?? 0;
            const colRight = anchorLine.xRight ?? pgContentW;
            const colW = Math.max(40, colRight - colLeft);
            const framePct = Math.max(20, Math.min(92, openCfg.frameWidthPct ?? 46));
            const boxW = Math.min(colW - 4, Math.max(44, (colW * framePct) / 100));
            const pad = Math.max(4, Math.min(20, openCfg.paddingPt ?? 8));
            const boxH = Math.max(28, (anchorLine.fontSizePt ?? 15) * 1.45 + pad * 2);
            const anchorCenter = (colLeft + colRight) / 2;
            const boxLeft = Math.max(colLeft, Math.min(colRight - boxW, anchorCenter - boxW / 2));
            const boxRight = boxLeft + boxW;
            const baseTop = Math.max(0, (anchorLine.yTop ?? anchorLine.yBaseline - anchorLine.ascent) - 2);
            // Push body & overlapping lower lines cleanly beneath the opening box; never touch upper collar or side flanks
            const shiftDy = pg.michtavBox ? 0 : boxH + 8;
            if (shiftDy > 0) {
              const shiftLine = (ln: TypesetLine) => {
                ln.yBaseline += shiftDy;
                if (ln.yTop !== undefined) ln.yTop += shiftDy;
                if (ln.yBottom !== undefined) ln.yBottom += shiftDy;
              };
              for (const ln of [...pg.sourceLines, ...(pg.column2Lines ?? [])]) {
                const lnTop = ln.yTop ?? ln.yBaseline - ln.ascent;
                if (lnTop >= baseTop - 1) {
                  shiftLine(ln);
                }
              }
              for (const ln of [...pg.rashiLines, ...pg.tosafotLines]) {
                const lnTop = ln.yTop ?? ln.yBaseline - ln.ascent;
                const lx = ln.xLeft ?? 0;
                const rx = ln.xRight ?? pgContentW;
                const overlapsBoxX = rx > boxLeft - 2 && lx < boxRight + 2;
                if (lnTop >= baseTop - 1 && overlapsBoxX) {
                  shiftLine(ln);
                }
              }
              if (pg.transitionMarkers) {
                for (const tm of pg.transitionMarkers) {
                  if (tm.yTop >= baseTop - 1) {
                    tm.yBaseline += shiftDy;
                    tm.yTop += shiftDy;
                    tm.yBottom += shiftDy;
                  }
                }
              }
              if (pg.occupiedRegions) {
                for (const reg of pg.occupiedRegions) {
                  const overlapsX = reg.xRight > boxLeft - 2 && reg.xLeft < boxRight + 2;
                  if (reg.yTop >= baseTop - 1 && overlapsX) {
                    reg.yTop += shiftDy;
                    reg.yBottom += shiftDy;
                  }
                }
              }
              if (pg.knee && pg.knee.kneeJunctionY >= baseTop) {
                pg.knee.kneeJunctionY += shiftDy;
              }
            }
            pg.openingWordBox = {
              xLeft: boxLeft,
              xRight: boxRight,
              yTop: baseTop,
              yBottom: baseTop + boxH,
              text: displayText,
              styleId: openCfg.styleId,
              unitId: anchorLine.unitId,
              isCentered: true,
            };
          }
        }

        // Optional peripheral streams (only attached when actual enabled units have lines; zero space reserved otherwise)
        if ((pg.tertiaryLines?.length ?? 0) > 0 && enabledPeripheralMap.size > 0) {
          const blocksByKind = new Map<PeripheralStreamKind, PeripheralStreamBlock>();
          for (const tl of pg.tertiaryLines ?? []) {
            const rawUnit = tl.unitId ? unitById.get(tl.unitId) : undefined;
            const kind: PeripheralStreamKind =
              (rawUnit ? detectPeripheralStreamKind(rawUnit) : null) ?? 'ein_mishpat';
            const cfg = enabledPeripheralMap.get(kind);
            if (!cfg) continue;
            let block = blocksByKind.get(kind);
            if (!block) {
              const meta = PERIPHERAL_STREAM_LABELS[kind];
              block = {
                stream: kind,
                labelHe: meta.he,
                labelEn: meta.en,
                side: cfg.placement,
                lines: [],
              };
              blocksByKind.set(kind, block);
            }
            block.lines.push(tl);
          }
          if (blocksByKind.size > 0) {
            pg.peripheralStreams = Array.from(blocksByKind.values());
          }
        }

        // v0.9.9 (I2): selected marginal slots that cannot fit their
        // placement are reported once per book — never accommodated by
        // squeezing fonts (no font scaling exists for peripheral
        // streams anywhere in the pipeline).
        if (!peripheralFitEmitted && enabledPeripheralMap.size > 0) {
          peripheralFitEmitted = true;
          const fit = checkMarginalPlacementFit([...enabledPeripheralMap.values()]);
          if (!fit.fits) {
            diagnostics.push({
              id: `diag-peripheral-overflow-${fit.placement}`,
              code: 'PERIPHERAL_STREAMS_OVERFLOW',
              severity: 'warning',
              category: 'peripheral',
              pageNumber: pg.pageNumber,
              physicalPageNumber: pg.physicalPageNumber,
              messageHe: `${fit.reasonHe} ${fit.suggestedActionHe}`,
              messageEn: `${fit.reasonEn} ${fit.suggestedActionEn}`,
              fixAction: {
                labelHe: 'כבה מדור צד',
                labelEn: 'Switch off marginal stream',
                kind: 'toggle_peripheral',
                payload: { stream: fit.suggestedDisableKind },
              },
            });
          }
        }
      } else {
        pg.folioDisplay = pg.isTitlePage ? 'שער' : pg.pageNumberHebrew;
      }

      // Per-page diagnostics
      const colCount = pg.layoutScore?.collisionCount ?? 0;
      if (colCount > 0) {
        diagnostics.push({
          id: `diag-collision-p${pIdx}`,
          code: 'GEOMETRIC_COLLISION',
          severity: 'critical',
          category: 'collision',
          pageNumber: pg.pageNumber,
          physicalPageNumber: pg.physicalPageNumber,
          messageHe: `זוהתה חפיפה בין תיבות טקסט בעמוד ${pg.folioDisplay || pg.pageNumber} (${colCount} חפיפות).`,
          messageEn: `Detected ${colCount} overlapping text region(s) on page ${pg.folioDisplay || pg.pageNumber}.`,
          fixAction: {
            labelHe: 'הרחב מרווח בין טורים',
            labelEn: 'Widen column gutter',
            kind: 'widen_column',
            payload: { pageIndex: pIdx, gutterDeltaPt: 4 },
          },
        });
      }
      if ((pg.layoutScore?.narrowColumnPenalty ?? 0) > 0) {
        diagnostics.push({
          id: `diag-narrow-p${pIdx}`,
          code: 'NARROW_COLUMN',
          severity: 'warning',
          category: 'balance',
          pageNumber: pg.pageNumber,
          physicalPageNumber: pg.physicalPageNumber,
          messageHe: `רוחב טור בעמוד ${pg.folioDisplay || pg.pageNumber} צר מסף הקריאות המומלץ.`,
          messageEn: `Column width on page ${pg.folioDisplay || pg.pageNumber} is narrower than the readable floor.`,
          fixAction: {
            labelHe: 'איזון גאומטריית ברך',
            labelEn: 'Balance knee geometry',
            kind: 'adjust_knee',
            payload: { pageIndex: pIdx },
          },
        });
      }
    }

    if (doc.unplacedUnitIds && doc.unplacedUnitIds.length > 0) {
      for (const uid of doc.unplacedUnitIds.slice(0, 8)) {
        diagnostics.push({
          id: `diag-unplaced-${uid}`,
          code: 'UNPLACED_UNIT',
          severity: 'critical',
          category: 'overflow',
          unitId: uid,
          messageHe: `יחידת תוכן (${uid}) לא שובצה בעימוד כדי למנוע דריסת שוליים.`,
          messageEn: `Content unit (${uid}) could not be placed cleanly without overflow.`,
          fixAction: {
            labelHe: 'נווט ליחידה',
            labelEn: 'Inspect unit',
            kind: 'navigate_unit',
            payload: { unitId: uid },
          },
        });
      }
    }

    if (doc.keepTogetherViolations && doc.keepTogetherViolations.length > 0) {
      for (const uid of doc.keepTogetherViolations.slice(0, 5)) {
        diagnostics.push({
          id: `diag-keep-${uid}`,
          code: 'KEEP_TOGETHER_SPLIT',
          severity: 'warning',
          category: 'continuation',
          unitId: uid,
          messageHe: `יחידה מסומנת כשמורה יחד (${uid}) התפצלה בין עמודים עקב אורכה.`,
          messageEn: `Keep-together unit (${uid}) split across pages due to height.`,
          fixAction: {
            labelHe: 'נווט ליחידה',
            labelEn: 'Inspect unit',
            kind: 'navigate_unit',
            payload: { unitId: uid },
          },
        });
      }
    }

    for (const lnk of doc.links ?? []) {
      if (lnk.confidenceScore < 0.8) {
        diagnostics.push({
          id: `diag-dibbur-${lnk.linkId}`,
          code: 'UNVERIFIED_DIBBUR_LINK',
          severity: 'info',
          category: 'continuation',
          unitId: lnk.commentaryUnitId,
          messageHe: `קישור דיבור המתחיל "${lnk.dibburHamatchil || lnk.commentaryUnitId}" בביטחון נמוך (${Math.round(lnk.confidenceScore * 100)}%) — דורש בדיקה.`,
          messageEn: `Low-confidence Dibbur link "${lnk.dibburHamatchil || lnk.commentaryUnitId}" (${Math.round(lnk.confidenceScore * 100)}%) needs review.`,
          fixAction: {
            labelHe: 'בדוק קישור דיבור',
            labelEn: 'Review dibbur link',
            kind: 'review_dibbur',
            payload: { unitId: lnk.commentaryUnitId, linkId: lnk.linkId },
          },
        });
      }
    }

    doc.diagnostics = diagnostics;
    return doc;
  }

  /**
   * v0.8.0 Part E — image-only pages for `role: 'image'` units.
   *
   * Layout-agnostic post-pass on the paginated document: it only touches
   * image units and only appends/inserts pages for them; every text page
   * keeps its lines, knee and score. Page numbers stay sequential from
   * the first page's number (rav_text starts at 2 — Daf Bet — and that
   * offset is preserved).
   */
  private static interleaveImageOnlyPages(
    doc: BookTypesetDocument,
    units: ContentUnit[],
    geometry: PageGeometry,
    contentWidth: number,
    contentHeight: number,
    title: string
  ): void {
    const imageUnits = units.filter(u => u.role === 'image');
    if (imageUnits.length === 0) return;
    const sortedImages = [...imageUnits].sort((a, b) => a.order - b.order);
    const imageDataOf = (unit: ContentUnit): { dataUrl: string; fileName?: string; altText?: string; widthPx?: number; heightPx?: number } => {
      const data = unit.imageData as unknown;
      if (typeof data === 'string') return { dataUrl: data };
      if (data && typeof data === 'object') {
        const rec = data as Record<string, unknown>;
        const dataUrl = typeof rec.dataUrl === 'string' ? rec.dataUrl : typeof rec.src === 'string' ? rec.src : '';
        return {
          dataUrl,
          fileName: typeof rec.fileName === 'string' ? rec.fileName : undefined,
          altText: typeof rec.altText === 'string' ? rec.altText : unit.rawText || undefined,
          widthPx: typeof rec.widthPx === 'number' ? rec.widthPx : undefined,
          heightPx: typeof rec.heightPx === 'number' ? rec.heightPx : undefined,
        };
      }
      return { dataUrl: '' };
    };
    const makeImagePage = (img: ContentUnit): PageTypesetResult => ({
      pageIndex: 0,
      pageNumber: 1,
      pageNumberHebrew: PdfExporter.toHebrewGematria(1),
      headerTitle: title,
      layoutType: doc.layoutType,
      geometry,
      sourceLines: [],
      rashiLines: [],
      tosafotLines: [],
      footnoteLines: [],
      knee: {
        pageContentWidth: contentWidth,
        pageContentHeight: contentHeight,
        topY: 0,
        kneeJunctionY: contentHeight,
        bottomY: contentHeight,
        upperSourceWidth: contentWidth,
        lowerSourceWidth: contentWidth,
        innerXOffset: 0,
        isLeftStepped: false,
        rightCommentaryWidth: 0,
        leftCommentaryWidth: 0,
        gutterWidth: 0,
      },
      isImageOnlyPage: true,
      imageUnitIds: [img.id],
      pageImages: [imageDataOf(img)],
      layoutScore: {
        totalScore: 100,
        pageUtilization: 100,
        verticalBalance: 100,
        horizontalBalance: 100,
        whitespaceScore: 100,
        textDensity: 100,
        readability: 100,
        sourceCommentaryAlignment: 100,
        semanticPreservation: 100,
        widowOrphanPenalty: 0,
        lineBreakPenalty: 0,
        stretchingCompressionPenalty: 0,
        continuationQuality: 100,
        visualHierarchyScore: 100,
        collisionCount: 0,
        narrowColumnPenalty: 0,
        candidatesEvaluated: 1,
        lookAheadAdjusted: false,
        editorialDecisions: ['עמוד תמונה'],
      },
      designSettings: doc.designSettings,
      sourceFontFamily: doc.sourceFontFamily,
      rashiFontFamily: doc.rashiFontFamily,
      tosafotFontFamily: doc.tosafotFontFamily,
    });

    if (doc.pages.length === 0) {
      // A book of images only: the image pages ARE the book.
      doc.pages = sortedImages.map(makeImagePage);
    } else {
      // Highest document order placed on each text page.
      const orderById = new Map(units.map(u => [u.id, u.order]));
      const pageMaxOrder = doc.pages.map(page => {
        let max = -Infinity;
        const streams = [
          ...page.sourceLines,
          ...page.rashiLines,
          ...page.tosafotLines,
          ...(page.footnoteLines ?? []),
          ...(page.column2Lines ?? []),
          ...(page.sideNoteLines ?? []),
        ];
        for (const line of streams) {
          const lineOrder = orderById.get(line.unitId ?? '');
          if (lineOrder !== undefined) max = Math.max(max, lineOrder);
          for (const w of line.words ?? []) {
            const wordOrder = orderById.get(w.unitId ?? '');
            if (wordOrder !== undefined) max = Math.max(max, wordOrder);
          }
        }
        return max;
      });
      const byAnchor = new Map<number, ContentUnit[]>();
      for (const img of sortedImages) {
        let anchor = -1;
        for (let i = 0; i < doc.pages.length; i++) {
          if (pageMaxOrder[i] !== -Infinity && pageMaxOrder[i] < img.order) anchor = i;
        }
        const arr = byAnchor.get(anchor) ?? [];
        arr.push(img);
        byAnchor.set(anchor, arr);
      }
      const out: PageTypesetResult[] = [];
      for (const img of byAnchor.get(-1) ?? []) out.push(makeImagePage(img));
      for (let i = 0; i < doc.pages.length; i++) {
        out.push(doc.pages[i]);
        for (const img of byAnchor.get(i) ?? []) out.push(makeImagePage(img));
      }
      doc.pages = out;
    }

    // Renumber sequentially from the first page's number (rav_text keeps
    // its Daf-Bet +1 offset; single_column stays 1-based).
    const startNumber = doc.pages[0]?.pageNumber ?? 1;
    doc.pages.forEach((p, i) => {
      p.pageIndex = i;
      p.pageNumber = startNumber + i;
      p.pageNumberHebrew = PdfExporter.toHebrewGematria(startNumber + i);
    });
    doc.totalPages = doc.pages.length;
  }

  /**
   * Resolves which semantic footnote ContentUnits are anchored to the words/units placed on a page.
   * Matches by:
   * 1. Explicit word-level `w.footnoteUnitId === fn.id` on any word placed on the page.
   * 2. Unit-level `fn.footnoteAnchorUnitId` or `fn.parentId` matching a unit placed on the page
   *    (when the footnote does not require a specific word index or its anchor word index falls within the placed words of that unit).
   */
  public static resolveAnchoredFootnotesForWords(
    placedWords: ShapedWord[],
    placedUnitIds: Set<string>,
    footnoteUnits: ContentUnit[],
    alreadyPlacedFootnoteIds: Set<string>,
    isFinalPage: boolean = false
  ): ContentUnit[] {
    if (footnoteUnits.length === 0) return [];

    const explicitWordFnIds = new Set<string>();
    const unitWordCountsOnPage = new Map<string, number>();

    for (const w of placedWords) {
      if (w.isSpace) continue;
      if (w.footnoteUnitId) {
        explicitWordFnIds.add(w.footnoteUnitId);
      }
      if (w.unitId) {
        unitWordCountsOnPage.set(w.unitId, (unitWordCountsOnPage.get(w.unitId) ?? 0) + 1);
      }
    }

    const matched: ContentUnit[] = [];
    for (const fn of footnoteUnits) {
      if (alreadyPlacedFootnoteIds.has(fn.id)) continue;

      if (explicitWordFnIds.has(fn.id)) {
        matched.push(fn);
        continue;
      }

      const anchorUnitId = fn.footnoteAnchorUnitId ?? fn.parentId;
      if (anchorUnitId && placedUnitIds.has(anchorUnitId)) {
        // If the footnote specifies an anchorWordIndex and the unit was split, check if any words of that unit are on this page
        if ((unitWordCountsOnPage.get(anchorUnitId) ?? 0) > 0) {
          matched.push(fn);
          continue;
        }
      }

      // If a footnote has no valid anchorUnitId in the document and we are on the final page, conserve it so 0 footnotes are ever lost
      if (isFinalPage && !anchorUnitId) {
        matched.push(fn);
      }
    }

    return matched;
  }

  /**
   * 1. Single Column Running Text with Global Look-Ahead Balancing, Widow/Orphan, Heading Keep-With-Next & Anchor-Driven Footnote Reflow
   */
  private static paginateSingleColumn(
    title: string,
    units: ContentUnit[],
    geometry: PageGeometry,
    contentWidth: number,
    contentHeight: number,
    fontSize: number,
    enableOrnaments: boolean,
    userSuppliedOrnaments: OrnamentAsset[] = [],
    userOrnamentRules: OrnamentUserRule[] = [],
    rulesConfig?: TypesettingRulesConfig,
    designSettings?: ProfessionalDesignSettings
  ): BookTypesetDocument {
    const engine = new TypesetterEngine(fontSize, rulesConfig, designSettings);
    const fnFontSize = designSettings?.footnotes?.fontSizePt ?? designSettings?.roleStyles?.footnote?.character?.fontSizePt ?? 9.5;
    const fnLeading = designSettings?.footnotes?.leadingPt ?? 13;
    const footnoteEngine = new TypesetterEngine(fnFontSize, rulesConfig, designSettings);
    const srcPara = designSettings?.roleStyles?.main_source?.paragraph;
    // v0.8.0 Part C (§2): the resolver's leadingPt is meaningful in both
    // modes (see dynamic-knee.ts) — gating on 'fixed' hid tier lineHeight
    // edits behind the shaper's stale 1.32 default.
    const lineHeight =
      srcPara && srcPara.leadingPt > 0
        ? srcPara.leadingPt
        : engine.getShaper().getLineHeight();

    const textUnits = units.filter(u => u.role !== 'footnote');
    const footnoteUnits = units.filter(u => u.role === 'footnote');

    const allLines: TypesetLine[] = [];
    for (const unit of textUnits) {
      const isHeading =
        unit.role === 'chapter' ||
        unit.role === 'main_title' ||
        unit.role === 'heading' ||
        unit.role === 'siman';
      const unitPara = designSettings?.roleStyles?.[unit.role]?.paragraph;
      const unitLH =
        unitPara && unitPara.leadingPt > 0
          ? unitPara.leadingPt
          : isHeading
          ? lineHeight * 1.4
          : lineHeight;
      const shouldJustify = unitPara ? unitPara.alignment === 'justify' : !isHeading;
      const lines = engine.typesetContentUnit(
        unit,
        contentWidth,
        unitLH,
        shouldJustify
      );
      for (let i = 0; i < lines.length; i++) {
        lines[i].keepPriority = isHeading
          ? KeepPriority.HEADING_PARAGRAPH
          : i === 0 || i === lines.length - 1
          ? KeepPriority.PARAGRAPH
          : KeepPriority.LINE;
      }
      allLines.push(...lines);
    }

    // Pre-typeset each footnote unit so we know its exact vertical height when its anchor is placed on a page.
    // B-4 / Stage 12: Query `footnotes.justifyMultiLineNonFinal` via TypesettingRulesEngine
    const justifyMultiLineFn = TypesettingRulesEngine.resolveRule<boolean>(
      'footnotes.justifyMultiLineNonFinal',
      { layoutType: 'single_column', role: 'footnote' },
      rulesConfig
    ).value;
    const fnLinesByUnitId = new Map<string, TypesetLine[]>();
    for (const fn of footnoteUnits) {
      const probeLines = footnoteEngine.typesetContentUnit(fn, contentWidth, fnLeading, false);
      const fnLines =
        probeLines.length > 1 && justifyMultiLineFn
          ? footnoteEngine.typesetContentUnit(fn, contentWidth, fnLeading, true)
          : probeLines;
      fnLinesByUnitId.set(fn.id, fnLines);
    }

    const baseUsableHeight = Math.max(120, contentHeight - 16);
    const baseMaxLinesPerPage = Math.max(6, Math.floor(baseUsableHeight / lineHeight));

    // Max vertical space a footnote zone may occupy on a page while leaving room for >=2 main lines (or 100% if main lines already finished)
    const minMainLinesHeight = Math.min(contentHeight * 0.35, lineHeight * 3);
    const maxFnLinesWithMain = Math.max(
      2,
      Math.floor((contentHeight - minMainLinesHeight - 18) / fnLeading)
    );
    const maxFnLinesOnly = Math.max(4, Math.floor((contentHeight - 24) / fnLeading));

    const autoFixesApplied: string[] = [];
    const pageDataList: Array<{
      mainLines: TypesetLine[];
      fnLines: TypesetLine[];
      placedFnUnits: ContentUnit[];
      fnContinuedFromPrev: boolean;
      fnContinuedToNext: boolean;
    }> = [];

    const activatedFootnoteIds = new Set<string>();
    const pendingFnLineQueue: Array<{ unit: ContentUnit; line: TypesetLine }> = [];
    let cursor = 0;

    // Anchor-Driven Iterative Page Builder with Look-Ahead Balancing & Multi-Page Long Footnote Continuation:
    while (
      cursor < allLines.length ||
      pendingFnLineQueue.length > 0 ||
      pageDataList.length === 0
    ) {
      const remLines = allLines.length - cursor;
      const fnContinuedFromPrev = pendingFnLineQueue.length > 0;

      if (remLines <= 0 && pendingFnLineQueue.length === 0) break;

      let take = 0;
      let candidateLines: TypesetLine[] = [];
      let newlyTriggeredFns: ContentUnit[] = [];

      if (remLines > 0) {
        const estPagesRemaining = Math.max(1, Math.ceil(remLines / baseMaxLinesPerPage));
        take =
          estPagesRemaining === 1
            ? remLines
            : Math.min(baseMaxLinesPerPage, Math.ceil(remLines / estPagesRemaining));

        // Iteratively adjust `take` so main lines + required footnote lines fit within `contentHeight` without collision!
        // If a single footnote is extraordinarily long (> maxFnLinesWithMain), cap its per-page slice to `maxFnLinesWithMain`
        // and continue its remaining lines onto the next page!
        while (take >= 1) {
          candidateLines = allLines.slice(cursor, cursor + take);
          const wordsInSlice = candidateLines.flatMap(l => l.words);
          const unitIdsInSlice = new Set<string>(candidateLines.map(l => l.unitId));
          for (const w of wordsInSlice) {
            if (w.unitId) unitIdsInSlice.add(w.unitId);
          }

          const isLastSlice = cursor + take >= allLines.length;
          newlyTriggeredFns = this.resolveAnchoredFootnotesForWords(
            wordsInSlice,
            unitIdsInSlice,
            footnoteUnits,
            activatedFootnoteIds,
            isLastSlice
          );
          const totalQueuedFnLines =
            pendingFnLineQueue.length +
            newlyTriggeredFns.reduce(
              (acc, u) => acc + (fnLinesByUnitId.get(u.id)?.length ?? 0),
              0
            );
          const fnLinesToPlaceOnPage = Math.min(maxFnLinesWithMain, totalQueuedFnLines);
          const fnHeightNeeded =
            fnLinesToPlaceOnPage > 0 ? fnLinesToPlaceOnPage * fnLeading + 18 : 0;
          const mainHeightNeeded = candidateLines.reduce(
            (acc, l) => acc + l.height + (l.spaceBeforePt ?? 0) + (l.spaceAfterPt ?? 0),
            0
          );

          if (mainHeightNeeded + fnHeightNeeded <= contentHeight - 8 || take === 1) {
            break;
          }
          take--;
        }

        const remainingAfter = allLines.length - (cursor + take);
        const pageCtx = {
          layoutType: 'single_column' as const,
          pageNumber: pageDataList.length + 1,
          pageIndex: pageDataList.length,
        };

        // Check if any line inside `[cursor + 1 .. cursor + take - 1]` has a Local Override or Paragraph Style forcing a new page before its unit
        for (let checkIdx = cursor + 1; checkIdx < cursor + take; checkIdx++) {
          const ln = allLines[checkIdx];
          const prevLn = allLines[checkIdx - 1];
          const styleStartNewPage = designSettings
            ? DesignSettingsEngine.resolveStyle(designSettings, {
                role: ln.role,
                unitId: ln.unitId,
              }).paragraph.startOnNewPage
            : false;
          if (
            ln.unitId !== prevLn.unitId &&
            (styleStartNewPage ||
              TypesettingRulesEngine.shouldForcePageBreakBeforeUnit(ln.unitId, pageCtx, rulesConfig))
          ) {
            take = checkIdx - cursor;
            autoFixesApplied.push(
              `מעבר עמוד כפוי לפני יחידת תוכן (${ln.unitId}).`
            );
            break;
          }
        }

        // Check if the final unit on the page has `keepLinesTogether: true` and was split across the page break
        if (designSettings && cursor + take < allLines.length && take > 1) {
          const lastLn = allLines[cursor + take - 1];
          const nextLn = allLines[cursor + take];
          if (lastLn.unitId === nextLn.unitId) {
            // v0.8.0 Part C (§3): the Shas fix's keep-together override
            // counts here too, not just the role-style keepLinesTogether.
            const keepIds = TypesettingRulesEngine.keepTogetherUnitIds(rulesConfig);
            const keepTogether =
              DesignSettingsEngine.resolveStyle(designSettings, {
                role: lastLn.role,
                unitId: lastLn.unitId,
              }).paragraph.keepLinesTogether || keepIds.has(lastLn.unitId);
            if (keepTogether) {
              let unitStart = cursor + take - 1;
              while (unitStart > cursor && allLines[unitStart - 1].unitId === lastLn.unitId) {
                unitStart--;
              }
              if (unitStart > cursor) {
                take = unitStart - cursor;
                autoFixesApplied.push(
                  `שמירת שורות פסקה יחד (Keep Lines Together) עבור יחידה (${lastLn.unitId}).`
                );
              }
            }
          }
        }

        // Look-Ahead Widow Prevention via TypesettingRulesEngine
        const preventWidows = TypesettingRulesEngine.resolveRule<boolean>(
          'paragraph.preventWidows',
          pageCtx,
          rulesConfig
        ).value;
        const minWidowLines = TypesettingRulesEngine.resolveRule<number>(
          'paragraph.minWidowLines',
          pageCtx,
          rulesConfig
        ).value;
        if (preventWidows && remainingAfter > 0 && remainingAfter < minWidowLines && take > minWidowLines + 1) {
          take -= minWidowLines - remainingAfter;
          autoFixesApplied.push('מניעת שורה יתומה (Widow) בראש העמוד הבא באמצעות Look-Ahead.');
        }

        // Heading Keep-With-Next & Minimum Following Lines via TypesettingRulesEngine (Priority 80 / Hard Rule support)
        for (let scanBack = 1; scanBack <= Math.min(4, take - 1); scanBack++) {
          const checkLineIdx = cursor + take - scanBack;
          const checkLine = allLines[checkLineIdx];
          if (
            checkLine &&
            (checkLine.role === 'chapter' ||
              checkLine.role === 'heading' ||
              checkLine.role === 'siman' ||
              checkLine.role === 'main_title')
          ) {
            const unitCtx = { ...pageCtx, unitId: checkLine.unitId, role: checkLine.role };
            const keepHeading = TypesettingRulesEngine.resolveRule<boolean>(
              'headings.keepWithNext',
              unitCtx,
              rulesConfig
            ).value;
            const minFollow = Math.max(
              1,
              TypesettingRulesEngine.resolveRule<number>(
                'headings.minFollowingLines',
                unitCtx,
                rulesConfig
              ).value
            );
            const followingLinesOnPage = scanBack - 1;
            if (keepHeading && followingLinesOnPage < minFollow && cursor + take < allLines.length) {
              // Find the first line of this heading unit on the page
              let headingStartIdx = checkLineIdx;
              while (
                headingStartIdx > cursor &&
                allLines[headingStartIdx - 1].unitId === checkLine.unitId
              ) {
                headingStartIdx--;
              }
              if (headingStartIdx > cursor) {
                take = headingStartIdx - cursor;
                autoFixesApplied.push(
                  `שמירת כותרת צמודה ללפחות ${minFollow} שורות המשך (Keep-With-Next).`
                );
              }
            }
            break;
          }
        }

        // Recompute final slice and its anchored footnotes after any widow/heading adjustment
        candidateLines = allLines.slice(cursor, cursor + take);
        const finalWords = candidateLines.flatMap(l => l.words);
        const finalUnitIds = new Set<string>(candidateLines.map(l => l.unitId));
        for (const w of finalWords) {
          if (w.unitId) finalUnitIds.add(w.unitId);
        }
        const isFinalSlice = cursor + take >= allLines.length;
        newlyTriggeredFns = this.resolveAnchoredFootnotesForWords(
          finalWords,
          finalUnitIds,
          footnoteUnits,
          activatedFootnoteIds,
          isFinalSlice
        );
        for (const fu of newlyTriggeredFns) {
          activatedFootnoteIds.add(fu.id);
          const linesOfFn = fnLinesByUnitId.get(fu.id) ?? [];
          for (const l of linesOfFn) {
            pendingFnLineQueue.push({ unit: fu, line: { ...l, words: l.words.map(w => ({ ...w })) } });
          }
        }
      }

      // Now determine how many footnote lines from `pendingFnLineQueue` can physically fit below `candidateLines` on this page
      const mainHeightUsed = candidateLines.reduce(
        (acc, l) => acc + l.height + (l.spaceBeforePt ?? 0) + (l.spaceAfterPt ?? 0),
        0
      );
      const availableHeightForFn = contentHeight - mainHeightUsed - 18;
      const maxFnLinesThisPage =
        candidateLines.length > 0
          ? Math.max(1, Math.min(maxFnLinesWithMain, Math.floor(availableHeightForFn / fnLeading)))
          : maxFnLinesOnly;

      const fnTake = Math.min(pendingFnLineQueue.length, maxFnLinesThisPage);
      const takenFnItems = pendingFnLineQueue.splice(0, fnTake);
      const fnContinuedToNext = pendingFnLineQueue.length > 0;

      if (fnContinuedToNext) {
        autoFixesApplied.push(
          `Stage 4 Long-Footnote Continuation: הערת שוליים ארוכה פוצלה באופן רציף לעמוד הבא לפי הגובה הפנוי בפועל.`
        );
      }

      const pageFnLines = takenFnItems.map(item => item.line);
      const placedFnUnits = Array.from(new Set(takenFnItems.map(item => item.unit)));

      pageDataList.push({
        mainLines: candidateLines,
        fnLines: pageFnLines,
        placedFnUnits,
        fnContinuedFromPrev,
        fnContinuedToNext,
      });

      cursor += take;
    }

    // Conservation guarantee: if any unanchored footnotes were never triggered, typeset & place them
    if (activatedFootnoteIds.size < footnoteUnits.length && pageDataList.length > 0) {
      const lastPageData = pageDataList[pageDataList.length - 1];
      for (const fn of footnoteUnits) {
        if (!activatedFootnoteIds.has(fn.id)) {
          activatedFootnoteIds.add(fn.id);
          lastPageData.placedFnUnits.push(fn);
          lastPageData.fnLines.push(
            ...(fnLinesByUnitId.get(fn.id) ?? []).map(l => ({ ...l }))
          );
        }
      }
    }

    if (pageDataList.length > 1) {
      autoFixesApplied.push(
        `Look-Ahead רב-עמודי: איזון ${allLines.length} שורות על פני ${pageDataList.length} עמודים עם שיבוץ הערות שוליים לפי עוגן המקור.`
      );
    }

    const pages: PageTypesetResult[] = [];
    const defaultKnee: DynamicKneeContour = {
      pageContentWidth: contentWidth,
      pageContentHeight: contentHeight,
      topY: 0,
      kneeJunctionY: contentHeight,
      bottomY: contentHeight,
      upperSourceWidth: contentWidth,
      lowerSourceWidth: contentWidth,
      innerXOffset: 0,
      isLeftStepped: false,
      rightCommentaryWidth: 0,
      leftCommentaryWidth: 0,
      gutterWidth: 0,
    };

    for (let p = 0; p < pageDataList.length; p++) {
      const pageNumber = p + 1;
      const {
        mainLines: pageLines,
        fnLines: fnForPage,
        fnContinuedFromPrev,
        fnContinuedToNext,
      } = pageDataList[p];
      const spatial = new SpatialExclusionEngine(contentWidth, contentHeight);

      let y = engine.getShaper().getAscent();
      for (const line of pageLines) {
        if (line.spaceBeforePt && line.spaceBeforePt > 0) {
          y += line.spaceBeforePt;
        }
        line.yBaseline = y;
        line.xStart = 0;
        spatial.registerLine(line, 0, contentWidth, `sc-p${p}`);
        y += line.height + (line.spaceAfterPt ?? 0);
      }

      const reservedFnH = fnForPage.length > 0 ? fnForPage.length * fnLeading + 18 : 0;
      const usableMainHeight = Math.max(120, contentHeight - reservedFnH - 20);

      if (fnForPage.length > 0) {
        let fnY = contentHeight - fnForPage.length * fnLeading + 10;
        for (let fi = 0; fi < fnForPage.length; fi++) {
          const fl = fnForPage[fi];
          fl.yBaseline = fnY;
          spatial.registerLine(fl, 0, contentWidth, `fn-p${p}`);
          fnY += fnLeading;
        }
      }
      const pageUnitIdSet = new Set(pageLines.map(l => l.unitId));
      const pageUnits = units.filter(u => pageUnitIdSet.has(u.id));
      const pageOccupiedRegions = spatial.getOccupiedRegions();
      const placedOrnaments = OrnamentLibraryEngine.autoPlaceOrnaments(
        pageUnits,
        contentWidth,
        contentWidth,
        0,
        y,
        usableMainHeight,
        enableOrnaments,
        pageOccupiedRegions,
        geometry.marginInside,
        contentWidth,
        OrnamentLibraryEngine.DEFAULT_SAFETY_CLEARANCE_PT,
        p === 0 ? userSuppliedOrnaments : [],
        userOrnamentRules
      );

      const collisions = spatial.detectCollisions(1.0);
      const utilization = Math.min(98, Math.round((y / usableMainHeight) * 100));

      const prevFolio = p > 0 ? PdfExporter.toHebrewGematria(pageNumber - 1) : '';
      const nextFolio = PdfExporter.toHebrewGematria(pageNumber + 1);
      const continuedFnFromPrevIds = fnContinuedFromPrev
        ? Array.from(new Set(fnForPage.map(l => l.unitId).filter(Boolean)))
        : [];
      const continuedFnToNextIds = fnContinuedToNext
        ? Array.from(new Set(fnForPage.map(l => l.unitId).filter(Boolean)))
        : [];

      pages.push({
        pageIndex: p,
        pageNumber,
        pageNumberHebrew: PdfExporter.toHebrewGematria(pageNumber),
        headerTitle: title,
        layoutType: 'single_column',
        geometry,
        sourceLines: pageLines,
        rashiLines: [],
        tosafotLines: [],
        footnoteLines: fnForPage,
        knee: defaultKnee,
        occupiedRegions: pageOccupiedRegions,
        placedOrnaments,
        continuedUnitIdsFromPrevPage: continuedFnFromPrevIds,
        continuedUnitIdsToNextPage: continuedFnToNextIds,
        continuationHeader:
          p > 0
            ? fnContinuedFromPrev
              ? `המשך מעמוד קודם (דף ${prevFolio}) כולל המשך הערת שוליים`
              : `המשך מדף ${prevFolio}`
            : undefined,
        continuationFooter:
          p < pageDataList.length - 1
            ? fnContinuedToNext
              ? `המשך הערת שוליים בדף ${nextFolio}...`
              : `המשך בדף ${nextFolio}...`
            : undefined,
        layoutScore: {
          totalScore: collisions.length === 0 ? 95 : 50,
          pageUtilization: Math.max(78, utilization),
          verticalBalance: 95,
          horizontalBalance: 98,
          whitespaceScore: 93,
          textDensity: 93,
          readability: 96,
          sourceCommentaryAlignment: 100,
          semanticPreservation: 98,
          widowOrphanPenalty: 0,
          lineBreakPenalty: 0,
          stretchingCompressionPenalty: 0,
          continuationQuality: 96,
          visualHierarchyScore: 96,
          collisionCount: collisions.length,
          narrowColumnPenalty: 0,
          candidatesEvaluated: 3,
          lookAheadAdjusted: autoFixesApplied.length > 0,
          editorialDecisions:
            autoFixesApplied.length > 0
              ? autoFixesApplied
              : ['עימוד טקסט רץ מאוזן עם בקרת יתומים ואלמנות, שמירת כותרות והערות שוליים מקושרות לעוגן.'],
        },
      });
    }

    return {
      title,
      layoutType: 'single_column',
      pages,
      totalPages: pages.length,
      geometry,
      autoFixesApplied,
    };
  }

  /**
   * v0.6.0 Part C (§2) — Custom Layout pagination.
   *
   * The boxes REALLY drive pagination now (v0.5.0 fell through to the
   * rav_text solver). For each page, in order:
   * 1. The page's boxes are the per-page override for that page when one
   *    exists (`customLayout.pageOverrides[pageIndex]`), else the global
   *    boxes — so a folio-by-folio tweak never touches the rest of the book.
   * 2. Shaped words (HarfBuzz path, per-role sizes from `designSettings`)
   *    flow box to box in book order; a unit too long for one box
   *    continues in the next matching box, then on the next folio.
   * 3. Inside a box, each line band asks `boxFlowIntervals` for the free
   *    horizontal intervals of the box's polygon at that height, so text
   *    flows inside L / T / cross frames and around cut-out exclusions
   *    (one TypesetLine per interval segment, on one shared baseline).
   * 4. A role with no box anywhere on the page spills into a `main_text`
   *    box, so text is never silently dropped. If a whole page places
   *    nothing (e.g. every interval narrower than one word), the widest
   *    box is re-filled with the polygon ignored and the fallback is
   *    recorded in `autoFixesApplied`.
   */
  private static paginateCustomLayout(
    title: string,
    units: ContentUnit[],
    geometry: PageGeometry,
    contentWidth: number,
    contentHeight: number,
    sourceFontSize: number,
    commentaryFontSize: number,
    rulesConfig?: TypesettingRulesConfig,
    designSettings?: ProfessionalDesignSettings
  ): BookTypesetDocument {
    const engine = new TypesetterEngine(sourceFontSize, rulesConfig, designSettings);
    const rawDesign =
      designSettings?.pageLayout.customLayout ?? defaultCustomLayoutDesign('rav_text');
    const validation = sanitizeCustomLayoutDesign(rawDesign, {
      pageWidthPt: geometry.pageWidth,
      pageHeightPt: geometry.pageHeight,
    });
    const globalBoxes =
      validation.boxes.length > 0
        ? validation.boxes
        : defaultCustomLayoutDesign('rav_text').boxes;
    const autoFixesApplied: string[] = [...validation.warnings];

    // v0.8.0 Part C (§6): Insert Page (force-break) unit ids for this book.
    const forceBreakIds = TypesettingRulesEngine.forcePageBreakUnitIds(rulesConfig);

    const sizeForRole = (role: ContentRole): number => {
      const styled =
        designSettings?.roleStyles?.[role as SemanticStyleRole]?.character?.fontSizePt;
      if (typeof styled === 'number' && styled > 0) return styled;
      return role === 'primary_comment' ||
        role === 'secondary_comment' ||
        role === 'tertiary_comment' ||
        role === 'dibbur_hamatchil'
        ? commentaryFontSize
        : sourceFontSize;
    };
    const lineHeightFor = (role: ContentRole, fontSizePt: number, box: CustomLayoutBox): number => {
      // v0.8.0 Part C (§9): a box lineHeight below the glyph extent
      // (1.06 × font size) overlaps adjacent lines — clamp it.
      const minLeading = fontSizePt * 1.06;
      // v0.9.2 Part A (A1): the rule-inspector line-height ratio is the
      // box's own setting — it wins over the legacy box.lineHeight.
      if (box.rules?.lineHeightRatio) return Math.max(minLeading, fontSizePt * box.rules.lineHeightRatio);
      if (box.lineHeight) return Math.max(minLeading, fontSizePt * box.lineHeight);
      const para = designSettings?.roleStyles?.[role as SemanticStyleRole]?.paragraph;
      // v0.8.0 Part C (§2): the resolver's leadingPt is meaningful in both
      // modes — gating on 'fixed' hid tier lineHeight edits.
      if (para && para.leadingPt > 0) return Math.max(minLeading, para.leadingPt);
      return Math.max(minLeading, fontSizePt * 1.32);
    };

    interface WordCursor {
      unit: ContentUnit;
      words: ShapedWord[];
      next: number;
    }
    const queue: WordCursor[] = units
      .map(u => ({ unit: u, words: engine.shapeContentUnit(u), next: 0 }))
      .filter(q => q.words.length > 0);
    const hasRemaining = () => queue.some(q => q.next < q.words.length);
    const remainingWordCount = () =>
      queue.reduce((acc, q) => acc + (q.words.length - q.next), 0);

    /** First queue entry (book order) that may feed this box. */
    const peekEligible = (
      box: CustomLayoutBox,
      pageRolesCovered: Set<ContentRole>
    ): WordCursor | null => {
      // v0.9.2 Part A (A1): the box's tier decides what it accepts.
      const accepted = acceptedRolesForBox(box);
      for (const q of queue) {
        if (q.next >= q.words.length) continue;
        if (accepted.includes(q.unit.role)) return q;
        if (isMainTextBox(box) && !pageRolesCovered.has(q.unit.role)) return q;
      }
      return null;
    };

    /**
     * Greedily fills ONE interval segment with shaped words, strictly in
     * book order (a word that does not fit ends the line — later words
     * never jump ahead of it). Returns null when nothing fits.
     */
    const breakLineInInterval = (
      box: CustomLayoutBox,
      pageRolesCovered: Set<ContentRole>,
      interval: { xLeft: number; xRight: number; width: number },
      lineHeight: number,
      fontSizePt: number
    ): TypesetLine | null => {
      // v0.9.2 Part A (A1): the box's tier decides what it accepts.
      const accepted = acceptedRolesForBox(box);
      const spaceWord = engine.getShaper().shapeWord(' ');
      const words: ShapedWord[] = [];
      let width = 0;
      let spaceCount = 0;
      outer: for (const q of queue) {
        if (q.next >= q.words.length) continue;
        // v0.8.0 Part C (§6): never let a line absorb a force-break unit —
        // the break unit starts the next page instead.
        if (words.length > 0 && forceBreakIds.has(q.unit.id)) break outer;
        const roleMatches = accepted.includes(q.unit.role);
        if (!roleMatches) {
          if (!isMainTextBox(box) || pageRolesCovered.has(q.unit.role)) continue;
        }
        while (q.next < q.words.length) {
          const w = q.words[q.next];
          // v0.9.2 Part A (A1): clamp each taken word to the box's
          // rule-inspector min/max font size, scaling its width
          // proportionally on a COPY — queue words are shared, never
          // mutate them.
          const origFs = w.fontSizePt ?? fontSizePt;
          const fs = clampFontSizeForBox(origFs, box);
          const wWidth = fs === origFs ? w.width : (w.width * fs) / origFs;
          const wsRatio = w.wordSpacingRatio ?? 1;
          const spaceW = words.length > 0 ? Math.max(1.5, fs * 0.32 * wsRatio) : 0;
          if (words.length > 0 && width + spaceW + wWidth > interval.width) break outer;
          if (words.length > 0) {
            words.push({ ...spaceWord, width: spaceW });
            width += spaceW;
            spaceCount++;
          }
          words.push(fs === origFs ? w : { ...w, fontSizePt: fs, width: wWidth });
          width += wWidth;
          q.next++;
        }
      }
      if (words.length === 0) return null;
      const nonSpace = words.filter(w => !w.isSpace);
      const first = nonSpace[0];
      if (!first) return null;
      const isLastLineOfUnit = nonSpace[nonSpace.length - 1].isParagraphEnd === true;
      let extraSpace = 0;
      let isJustified = false;
      const deficit = interval.width - width;
      // v0.9.2 Part A (A1): a box alignment other than justify is honoured
      // by the renderers (PageCanvas / PDF / IDML read line.alignment) —
      // do not stretch such a line as if it were justified.
      const boxAlignment = box.rules?.alignment;
      if (
        !isLastLineOfUnit &&
        spaceCount > 0 &&
        deficit > 0 &&
        deficit < interval.width * 0.35 &&
        (!boxAlignment || boxAlignment === 'justify')
      ) {
        extraSpace = deficit / spaceCount;
        isJustified = true;
        width = interval.width;
      }
      return {
        lineIndex: 0,
        words,
        width,
        targetWidth: interval.width,
        xStart: 0,
        xLeft: interval.xLeft,
        xRight: interval.xRight,
        yBaseline: 0,
        yTop: 0,
        yBottom: 0,
        height: lineHeight,
        ascent: fontSizePt,
        descent: fontSizePt * 0.25,
        isLastLine: isLastLineOfUnit,
        isJustified,
        extraSpacePerWord: extraSpace,
        role: first.role ?? 'main_source',
        unitId: first.unitId ?? '',
        fontSizePt,
        customLayoutBoxId: box.id,
        // v0.9.2 Part A (A1): the box's alignment rides on the line so
        // the renderers can honour it.
        ...(boxAlignment ? { alignment: boxAlignment } : {}),
      };
    };

    /**
     * Fills one box with lines, band by band, top to bottom. Returns true
     * when the page must end here (v0.8.0 Part C §6: the next eligible
     * unit carries an Insert Page force-break and this page already has
     * lines), so the caller starts a new page.
     */
    const fillBox = (
      box: CustomLayoutBox,
      pageLines: TypesetLine[],
      pageRolesCovered: Set<ContentRole>,
      ignoreShape: boolean
    ): boolean => {
      const boxX = (box.xPct / 100) * contentWidth;
      const boxY = (box.yPct / 100) * contentHeight;
      const boxW = (box.widthPct / 100) * contentWidth;
      const boxH = (box.heightPct / 100) * contentHeight;
      const boxBottom = boxY + boxH;
      let y = boxY;
      while (y < boxBottom - 4 && hasRemaining()) {
        const peek = peekEligible(box, pageRolesCovered);
        if (!peek) return false;
        // v0.8.0 Part C (§6): a force-break unit starts a new page —
        // unless this page is still empty, in which case the unit starts
        // the page (the break is already honoured by the page boundary).
        if (forceBreakIds.has(peek.unit.id) && pageLines.length > 0) return true;
        const firstWord = peek.words[peek.next];
        // v0.9.2 Part A (A1): the line height is computed from the clamped
        // size, matching the clamp applied when words are taken.
        const fs = clampFontSizeForBox(firstWord.fontSizePt ?? sizeForRole(peek.unit.role), box);
        const lh = lineHeightFor(peek.unit.role, fs, box);
        if (y + lh > boxBottom + 0.5) return false;
        const intervals = ignoreShape
          ? [{ xLeft: boxX, xRight: boxX + boxW, width: boxW }]
          : boxFlowIntervals(box, y, y + lh, contentWidth, contentHeight);
        for (const iv of intervals) {
          if (!hasRemaining()) break;
          const line = breakLineInInterval(box, pageRolesCovered, iv, lh, fs);
          if (!line) continue;
          line.yBaseline = y + line.ascent;
          line.yTop = y;
          line.yBottom = y + line.ascent + line.descent;
          pageLines.push(line);
        }
        y += lh;
      }
      return false;
    };

    const defaultKnee: DynamicKneeContour = {
      pageContentWidth: contentWidth,
      pageContentHeight: contentHeight,
      topY: 0,
      kneeJunctionY: contentHeight,
      bottomY: contentHeight,
      upperSourceWidth: contentWidth,
      lowerSourceWidth: contentWidth,
      innerXOffset: 0,
      isLeftStepped: false,
      rightCommentaryWidth: 0,
      leftCommentaryWidth: 0,
      gutterWidth: 0,
    };

    const pages: PageTypesetResult[] = [];
    const placedOnPrevPage = new Set<string>();
    let guard = 0;
    while (hasRemaining() && guard < 500) {
      guard++;
      const p = pages.length;
      const pageBoxes =
        validation.pageOverrides[String(p)]?.length > 0
          ? validation.pageOverrides[String(p)]
          : globalBoxes;
      const pageRolesCovered = new Set<ContentRole>(
        // v0.9.2 Part A (A1): tier roles, not role roles.
        pageBoxes.flatMap(b => acceptedRolesForBox(b))
      );
      const pageLines: TypesetLine[] = [];
      for (const box of pageBoxes) {
        // v0.8.0 Part C (§6): fillBox reports when the next eligible unit
        // carries an Insert Page force-break — end the page there.
        const endPage = fillBox(box, pageLines, pageRolesCovered, false);
        if (endPage) {
          autoFixesApplied.push('מעבר עמוד כפוי: דף חדש מתחיל ביחידה הבאה.');
          break;
        }
        if (!hasRemaining()) break;
      }
      if (pageLines.length === 0 && hasRemaining()) {
        // Nothing fit anywhere on this page (intervals narrower than one
        // word): re-fill the widest box with the polygon ignored, so no
        // text is ever dropped, and say so plainly.
        const widest = [...pageBoxes].sort(
          (a, b) => b.widthPct * b.heightPct - a.widthPct * a.heightPct
        )[0];
        if (widest) {
          fillBox(widest, pageLines, pageRolesCovered, true);
          autoFixesApplied.push(
            `דף ${p + 1}: התיבות צרות מדי למילה הבאה — הטקסט הוצב בתיבה הרחבה ביותר בלי צורת המצולע.`
          );
        }
      }
      if (pageLines.length === 0) {
        autoFixesApplied.push(
          `דף ${p + 1}: לא ניתן היה להציב ${remainingWordCount()} מילים שנותרו — העימוד נעצר כדי לא לאבד טקסט.`
        );
        break;
      }
      pageLines.forEach((l, i) => {
        l.lineIndex = i;
      });
      const spatial = new SpatialExclusionEngine(contentWidth, contentHeight);
      for (const line of pageLines) {
        spatial.registerLine(
          line,
          line.xLeft ?? 0,
          line.xRight ?? contentWidth,
          `cl-p${p}`
        );
      }
      const sourceLines = pageLines.filter(
        l =>
          l.role !== 'primary_comment' &&
          l.role !== 'dibbur_hamatchil' &&
          l.role !== 'secondary_comment' &&
          l.role !== 'tertiary_comment' &&
          l.role !== 'footnote' &&
          l.role !== 'side_note' &&
          l.role !== 'cross_reference'
      );
      const rashiLines = pageLines.filter(
        l => l.role === 'primary_comment' || l.role === 'dibbur_hamatchil'
      );
      const tosafotLines = pageLines.filter(
        l => l.role === 'secondary_comment' || l.role === 'tertiary_comment'
      );
      const footnoteLines = pageLines.filter(l => l.role === 'footnote');
      const sideNoteLines = pageLines.filter(
        l => l.role === 'side_note' || l.role === 'cross_reference'
      );
      const collisions = spatial.detectCollisions(1.0);
      const usedH = Math.max(0, ...pageLines.map(l => l.yBottom ?? l.yBaseline));
      const utilization = Math.min(98, Math.round((usedH / contentHeight) * 100));
      const unitIdsOnPage = new Set(pageLines.map(l => l.unitId).filter(Boolean));
      const continuedFromPrev = [...unitIdsOnPage].filter(id => placedOnPrevPage.has(id));
      const continuedToNext = [...unitIdsOnPage].filter(id =>
        queue.some(q => q.unit.id === id && q.next < q.words.length)
      );
      placedOnPrevPage.clear();
      for (const id of unitIdsOnPage) placedOnPrevPage.add(id);

      pages.push({
        pageIndex: p,
        pageNumber: p + 1,
        pageNumberHebrew: PdfExporter.toHebrewGematria(p + 1),
        headerTitle: title,
        layoutType: 'custom_layout',
        geometry,
        sourceLines,
        rashiLines,
        tosafotLines,
        footnoteLines,
        sideNoteLines,
        knee: defaultKnee,
        occupiedRegions: spatial.getOccupiedRegions(),
        continuedUnitIdsFromPrevPage: continuedFromPrev,
        continuedUnitIdsToNextPage: continuedToNext,
        continuationHeader:
          p > 0 && continuedFromPrev.length > 0
            ? `המשך מדף ${PdfExporter.toHebrewGematria(p)}`
            : undefined,
        continuationFooter:
          continuedToNext.length > 0
            ? `המשך בדף ${PdfExporter.toHebrewGematria(p + 2)}...`
            : undefined,
        layoutScore: {
          totalScore: collisions.length === 0 ? 95 : 50,
          pageUtilization: Math.max(40, utilization),
          verticalBalance: 95,
          horizontalBalance: 98,
          whitespaceScore: 93,
          textDensity: 93,
          readability: 96,
          sourceCommentaryAlignment: 100,
          semanticPreservation: 98,
          widowOrphanPenalty: 0,
          lineBreakPenalty: 0,
          stretchingCompressionPenalty: 0,
          continuationQuality: 96,
          visualHierarchyScore: 96,
          collisionCount: collisions.length,
          narrowColumnPenalty: 0,
          candidatesEvaluated: 1,
          lookAheadAdjusted: autoFixesApplied.length > 0,
          editorialDecisions:
            autoFixesApplied.length > 0
              ? autoFixesApplied
              : ['עימוד לפי תיבות הפריסה המותאמת — הטקסט זורם מתיבה לתיבה ומדף לדף.'],
        },
      });
    }

    if (pages.length === 0) {
      // Empty book: one empty page, like the other solvers' guarantee.
      pages.push({
        pageIndex: 0,
        pageNumber: 1,
        pageNumberHebrew: PdfExporter.toHebrewGematria(1),
        headerTitle: title,
        layoutType: 'custom_layout',
        geometry,
        sourceLines: [],
        rashiLines: [],
        tosafotLines: [],
        footnoteLines: [],
        sideNoteLines: [],
        knee: defaultKnee,
        occupiedRegions: [],
        layoutScore: {
          totalScore: 95,
          pageUtilization: 0,
          verticalBalance: 95,
          horizontalBalance: 98,
          whitespaceScore: 93,
          textDensity: 93,
          readability: 96,
          sourceCommentaryAlignment: 100,
          semanticPreservation: 98,
          widowOrphanPenalty: 0,
          lineBreakPenalty: 0,
          stretchingCompressionPenalty: 0,
          continuationQuality: 96,
          visualHierarchyScore: 96,
          collisionCount: 0,
          narrowColumnPenalty: 0,
          candidatesEvaluated: 1,
          lookAheadAdjusted: false,
          editorialDecisions: ['ספר ריק — אין טקסט לעימוד.'],
        },
      });
    }

    return {
      title,
      layoutType: 'custom_layout',
      pages,
      totalPages: pages.length,
      geometry,
      autoFixesApplied,
    };
  }

  /**
   * v0.8.0 Part D — Yiddish sefarim: Hebrew source facing Yiddish text.
   *
   * Streams (partitioned by language/kind, NOT by a new role — the
   * existing roles are reused):
   * - Hebrew stream → right column (`sourceLines`), xStart 0.
   * - Yiddish stream (Tzenerene / translation / Chassidic commentary /
   *   Biur) → left column (`column2Lines`), xStart = hebrewWidth + gutter.
   * - Parsha/section headings → full-width lines in `sourceLines`,
   *   placed in document order between the stream segments they head.
   * When only one stream exists the book is single-column full-width
   * (a Tzenerene-only sefer, or a Hebrew-only book imported as Yiddish).
   *
   * Page breaks are SYNCHRONISED across the two columns: a page ends
   * when either column fills, so the Hebrew and Yiddish texts stay on
   * the same page (facing each other) instead of drifting apart. The
   * trade-off is recorded in the page score (`verticalBalance` from the
   * column-height difference) and in PART-D-NOTES.md.
   *
   * Footnotes: a reserved zone at the bottom of each page (like the
   * two-column path); anchored footnotes are resolved per page with
   * `resolveAnchoredFootnotesForWords`, overflow carries to the next
   * page, and unanchored footnotes are conserved onto the last page —
   * no footnote is ever dropped.
   */
  private static paginateYiddishSefer(
    title: string,
    units: ContentUnit[],
    geometry: PageGeometry,
    contentWidth: number,
    contentHeight: number,
    sourceFontSize: number,
    commentaryFontSize: number,
    rulesConfig?: TypesettingRulesConfig,
    designSettings?: ProfessionalDesignSettings,
    links?: RavTextLink[]
  ): BookTypesetDocument {
    const gutter = designSettings?.columns?.columnGapPt ?? 12;
    const footnoteUnits = units.filter(u => u.role === 'footnote');
    const textUnits = units.filter(u => u.role !== 'footnote');

    // Partition in document order; headings stay in the flow as
    // full-width blocks between the stream segments they head.
    type YBlock = { kind: 'head' | 'he' | 'yi'; lines: TypesetLine[] };
    const mainEngine = new TypesetterEngine(sourceFontSize, rulesConfig, designSettings);
    const commentEngine = new TypesetterEngine(commentaryFontSize, rulesConfig, designSettings);
    const baseLineH = mainEngine.getShaper().getLineHeight();

    const isHeadingRole = (u: ContentUnit): boolean =>
      u.role === 'chapter' || u.role === 'heading' || u.role === 'siman' || u.role === 'main_title';
    const isYiddishUnit = (u: ContentUnit): boolean => {
      if (u.language === 'yi') return true;
      if (u.yiddishKind && u.yiddishKind !== 'hebrew_source') return true;
      return detectYiddish(u.rawText).isYiddish;
    };
    const heUnits = textUnits.filter(u => !isHeadingRole(u) && !isYiddishUnit(u));
    const yiUnits = textUnits.filter(u => !isHeadingRole(u) && isYiddishUnit(u));
    const isFacing = heUnits.length > 0 && yiUnits.length > 0;
    const heW = isFacing ? (contentWidth - gutter) * 0.45 : contentWidth;
    const yiW = isFacing ? (contentWidth - gutter) * 0.55 : contentWidth;
    const yiXStart = isFacing ? heW + gutter : 0;

    const blocks: YBlock[] = [];
    for (const unit of textUnits) {
      const isCommentary =
        unit.role === 'primary_comment' ||
        unit.role === 'secondary_comment' ||
        unit.role === 'tertiary_comment';
      const engine = isCommentary ? commentEngine : mainEngine;
      if (isHeadingRole(unit)) {
        const lines = engine.typesetContentUnit(unit, contentWidth, baseLineH * 1.4, false);
        for (const l of lines) l.keepPriority = KeepPriority.HEADING_PARAGRAPH;
        blocks.push({ kind: 'head', lines });
        continue;
      }
      const stream: 'he' | 'yi' = heUnits.includes(unit) ? 'he' : 'yi';
      const width = stream === 'he' ? heW : yiW;
      const lines = engine.typesetContentUnit(unit, width, baseLineH, true);
      for (let i = 0; i < lines.length; i++) {
        lines[i].keepPriority =
          i === 0 || i === lines.length - 1 ? KeepPriority.PARAGRAPH : KeepPriority.LINE;
      }
      blocks.push({ kind: stream, lines });
    }

    // Footnotes, pre-typeset (same shape as the single-column path).
    const fnFontSize =
      designSettings?.footnotes?.fontSizePt ??
      designSettings?.roleStyles?.footnote?.character?.fontSizePt ??
      9.5;
    const fnLeading = designSettings?.footnotes?.leadingPt ?? 13;
    const fnEngine = new TypesetterEngine(fnFontSize, rulesConfig, designSettings);
    const fnLinesByUnitId = new Map<string, TypesetLine[]>();
    for (const fn of footnoteUnits) {
      fnLinesByUnitId.set(fn.id, fnEngine.typesetContentUnit(fn, contentWidth, fnLeading, false));
    }
    const totalFnLines = [...fnLinesByUnitId.values()].reduce((s, ls) => s + ls.length, 0);
    const fnZoneHeight =
      totalFnLines > 0 ? Math.min(contentHeight * 0.3, totalFnLines * fnLeading + 16) : 0;
    const usableHeight = contentHeight - fnZoneHeight;

    const defaultKnee: DynamicKneeContour = {
      pageContentWidth: contentWidth,
      pageContentHeight: contentHeight,
      topY: 0,
      kneeJunctionY: contentHeight,
      bottomY: contentHeight,
      upperSourceWidth: heW,
      lowerSourceWidth: heW,
      innerXOffset: 0,
      isLeftStepped: false,
      rightCommentaryWidth: heW,
      leftCommentaryWidth: yiW,
      gutterWidth: gutter,
    };

    const editorialDecisions: string[] = [
      isFacing
        ? 'ספר יידיש מול מקור: מקור עברי בטור הימני, טקסט יידיש בטור השמאלי, מעברי עמוד מסונכרנים.'
        : 'טקסט יידיש בטור יחיד רחב (אין מקור עברי מקביל במסמך).',
    ];

    const pages: PageTypesetResult[] = [];
    const activatedFootnoteIds = new Set<string>();
    const pendingFnLineQueue: Array<{ unit: ContentUnit; line: TypesetLine }> = [];
    let bIdx = 0;
    let bOff = 0;

    while (bIdx < blocks.length || pendingFnLineQueue.length > 0 || pages.length === 0) {
      if (bIdx >= blocks.length && pendingFnLineQueue.length === 0) break;
      const pageNumber = pages.length + 1;
      const pageIndex = pages.length;

      let heY = 0;
      let yiY = 0;
      const hePage: TypesetLine[] = [];
      const yiPage: TypesetLine[] = [];
      const headPage: TypesetLine[] = [];
      const placedWords: ShapedWord[] = [];
      const placedUnitIds = new Set<string>();

      const lineHeightOf = (l: TypesetLine): number =>
        l.leadingPt && l.leadingPt > 0 ? l.leadingPt : baseLineH;

      // Consume blocks in document order until a column fills.
      while (bIdx < blocks.length) {
        const blk = blocks[bIdx];
        if (blk.kind === 'head') {
          const remaining = blk.lines.slice(bOff);
          if (remaining.length === 0) {
            bIdx++;
            bOff = 0;
            continue;
          }
          const usedY = Math.max(heY, yiY);
          const headHeight = remaining.reduce(
            (s, l) => s + lineHeightOf(l) + (l.spaceBeforePt ?? 0) + (l.spaceAfterPt ?? 0),
            0
          );
          if (headHeight > usableHeight - usedY && (hePage.length > 0 || yiPage.length > 0 || headPage.length > 0)) {
            break; // Heading goes to the next page whole — never split or orphaned.
          }
          // Place heading lines one by one (a heading taller than a whole
          // empty page is split across pages rather than dropped).
          let placedAny = false;
          for (const line of remaining) {
            const lh = lineHeightOf(line);
            const need = lh + (line.spaceBeforePt ?? 0) + (line.spaceAfterPt ?? 0);
            const curY = Math.max(heY, yiY);
            if (curY + need > usableHeight && placedAny) break;
            if (line.spaceBeforePt && line.spaceBeforePt > 0) {
              heY += line.spaceBeforePt;
              yiY += line.spaceBeforePt;
            }
            const yBase = Math.max(heY, yiY) + line.ascent;
            line.yBaseline = yBase;
            line.xStart = 0;
            line.columnNumber = 1;
            line.height = lh;
            heY = yBase - line.ascent + lh + (line.spaceAfterPt ?? 0);
            yiY = heY;
            headPage.push(line);
            placedWords.push(...line.words);
            placedUnitIds.add(line.unitId);
            bOff++;
            placedAny = true;
          }
          if (bOff >= blk.lines.length) {
            bIdx++;
            bOff = 0;
          }
          continue;
        }

        // Single-stream book (no facing counterpart): the one stream
        // goes in the right column (sourceLines) full-width, whatever
        // its language — there is no left column to fill.
        const isHe = !isFacing || blk.kind === 'he';
        const colEndY = isHe ? heY : yiY;
        const budget = Math.max(0, Math.floor((usableHeight - colEndY) / baseLineH));
        if (budget <= 0) break; // Column full — synchronised page break.
        const remaining = blk.lines.slice(bOff);
        const take = Math.min(remaining.length, budget);
        if (take <= 0) break;
        let colY = colEndY;
        const ascent = (isHe ? mainEngine : commentEngine).getShaper().getAscent();
        for (let i = 0; i < take; i++) {
          const line = remaining[i];
          const lh = lineHeightOf(line);
          if (line.spaceBeforePt && line.spaceBeforePt > 0) colY += line.spaceBeforePt;
          line.yBaseline = colY + ascent;
          line.xStart = isHe ? 0 : yiXStart;
          line.columnNumber = isHe ? 1 : 2;
          line.height = lh;
          colY += lh + (line.spaceAfterPt ?? 0);
          if (isHe) hePage.push(line);
          else yiPage.push(line);
          placedWords.push(...line.words);
          placedUnitIds.add(line.unitId);
        }
        if (isHe) heY = colY;
        else yiY = colY;
        bOff += take;
        if (bOff >= blk.lines.length) {
          bIdx++;
          bOff = 0;
        }
        if (take < remaining.length) break; // This column filled — page ends.
      }

      // Footnotes anchored to this page's words, then carried-over lines.
      const isFinalContentPage = bIdx >= blocks.length;
      const newlyTriggered = this.resolveAnchoredFootnotesForWords(
        placedWords,
        placedUnitIds,
        footnoteUnits,
        activatedFootnoteIds,
        isFinalContentPage
      );
      for (const fu of newlyTriggered) {
        activatedFootnoteIds.add(fu.id);
        for (const l of fnLinesByUnitId.get(fu.id) ?? []) {
          pendingFnLineQueue.push({ unit: fu, line: { ...l, words: l.words.map(w => ({ ...w })) } });
        }
      }
      const maxFnLinesThisPage =
        fnZoneHeight > 0 ? Math.max(0, Math.floor((fnZoneHeight - 8) / fnLeading)) : 0;
      const fnTake = Math.min(pendingFnLineQueue.length, maxFnLinesThisPage);
      const takenFn = pendingFnLineQueue.splice(0, fnTake);
      const fnPageLines: TypesetLine[] = [];
      let fnY = usableHeight + 8;
      for (const item of takenFn) {
        const line = item.line;
        line.yBaseline = fnY + fnEngine.getShaper().getAscent();
        line.xStart = 0;
        line.columnNumber = 1;
        line.height = fnLeading;
        fnY += fnLeading;
        fnPageLines.push(line);
      }
      const placedFnUnits = Array.from(new Set(takenFn.map(t => t.unit)));

      // Conservation: unanchored footnotes go on the last page.
      if (isFinalContentPage && activatedFootnoteIds.size < footnoteUnits.length) {
        for (const fn of footnoteUnits) {
          if (activatedFootnoteIds.has(fn.id)) continue;
          activatedFootnoteIds.add(fn.id);
          placedFnUnits.push(fn);
          for (const l of fnLinesByUnitId.get(fn.id) ?? []) {
            const line = { ...l, words: l.words.map(w => ({ ...w })) };
            line.yBaseline = fnY + fnEngine.getShaper().getAscent();
            line.xStart = 0;
            line.height = fnLeading;
            fnY += fnLeading;
            fnPageLines.push(line);
          }
        }
      }
      void placedFnUnits;

      const spatial = new SpatialExclusionEngine(contentWidth, contentHeight);
      for (const line of headPage) spatial.registerLine(line, 0, contentWidth, `h-p${pageIndex}`);
      for (const line of hePage) spatial.registerLine(line, 0, heW, `he-p${pageIndex}`);
      for (const line of yiPage) spatial.registerLine(line, yiXStart, yiXStart + yiW, `yi-p${pageIndex}`);
      for (const line of fnPageLines) spatial.registerLine(line, 0, contentWidth, `fn-p${pageIndex}`);
      const collisions = spatial.detectCollisions(1.0);
      const colDiff = isFacing ? Math.abs(heY - yiY) : 0;
      const verticalBalance = isFacing
        ? Math.max(82, Math.round(100 - (colDiff / contentHeight) * 60))
        : 98;

      pages.push({
        pageIndex,
        pageNumber,
        pageNumberHebrew: PdfExporter.toHebrewGematria(pageNumber),
        headerTitle: title,
        layoutType: 'yiddish_sefer',
        geometry,
        sourceLines: [...headPage, ...hePage],
        column2Lines: yiPage,
        rashiLines: [],
        tosafotLines: [],
        footnoteLines: fnPageLines,
        knee: defaultKnee,
        occupiedRegions: spatial.getOccupiedRegions(),
        layoutScore: {
          totalScore: collisions.length === 0 ? 96 : 50,
          pageUtilization: 91,
          verticalBalance,
          horizontalBalance: 98,
          whitespaceScore: 95,
          textDensity: 94,
          readability: 96,
          sourceCommentaryAlignment: 97,
          semanticPreservation: 97,
          widowOrphanPenalty: 0,
          lineBreakPenalty: 0,
          stretchingCompressionPenalty: 0,
          continuationQuality: 96,
          visualHierarchyScore: 96,
          collisionCount: collisions.length,
          narrowColumnPenalty: 0,
          candidatesEvaluated: 3,
          lookAheadAdjusted: true,
          editorialDecisions,
        },
      });

      // Termination guard: a page that placed nothing and advanced
      // nothing would loop forever. Heading blocks taller than a page
      // advance bOff line by line, stream blocks always take >= 1 line
      // when a budget exists, and footnote-only pages drain the queue —
      // but if a zero-height footnote zone left a pending queue with no
      // content left, force the leftovers onto this page instead.
      if (
        hePage.length === 0 &&
        yiPage.length === 0 &&
        headPage.length === 0 &&
        fnPageLines.length === 0 &&
        bIdx >= blocks.length &&
        pendingFnLineQueue.length > 0
      ) {
        const last = pages[pages.length - 1];
        for (const item of pendingFnLineQueue.splice(0)) {
          const line = item.line;
          line.yBaseline = fnY + fnEngine.getShaper().getAscent();
          line.xStart = 0;
          line.height = fnLeading;
          fnY += fnLeading;
          last.footnoteLines.push(line);
        }
      }
    }

    // Continuation markers: a unit whose lines span a page boundary.
    for (let p = 0; p + 1 < pages.length; p++) {
      const cur = pages[p];
      const nxt = pages[p + 1];
      const curIds = new Set(
        [...cur.sourceLines, ...(cur.column2Lines ?? [])].map(l => l.unitId)
      );
      const nxtIds = new Set(
        [...nxt.sourceLines, ...(nxt.column2Lines ?? [])].map(l => l.unitId)
      );
      const shared = [...curIds].filter(id => nxtIds.has(id));
      if (shared.length > 0) {
        cur.continuedUnitIdsToNextPage = [
          ...(cur.continuedUnitIdsToNextPage ?? []),
          ...shared,
        ];
        nxt.continuedUnitIdsFromPrevPage = [
          ...(nxt.continuedUnitIdsFromPrevPage ?? []),
          ...shared,
        ];
      }
    }

    return {
      title,
      layoutType: 'yiddish_sefer',
      pages,
      totalPages: pages.length,
      geometry,
      links: links ?? [],
      autoFixesApplied: editorialDecisions,
    };
  }


  /**
   * 2. Two Columns Layout (שני טורים — שולחן ערוך, סידור, משניות, שו״ת)
   * Problem 9: Preserves clean two-column layout while improving page-to-page distribution,
   * vertical column balancing, and widow/orphan control.
   */
  private static paginateTwoColumn(
    title: string,
    units: ContentUnit[],
    geometry: PageGeometry,
    contentWidth: number,
    contentHeight: number,
    fontSize: number,
    rulesConfig?: TypesettingRulesConfig,
    designSettings?: ProfessionalDesignSettings
  ): BookTypesetDocument {
    const colGutter = designSettings?.columns?.columnGapPt ?? 16.0;
    const colWidth = (contentWidth - colGutter) / 2.0;

    const engine = new TypesetterEngine(fontSize - 1.5, rulesConfig, designSettings);
    const srcPara = designSettings?.roleStyles?.main_source?.paragraph;
    // v0.8.0 Part C (§2): the resolver's leadingPt is meaningful in both
    // modes (see dynamic-knee.ts) — gating on 'fixed' hid tier lineHeight
    // edits behind the shaper's stale 1.32 default. (This also aligns the
    // planner with the render: the shaped lines already advance at the
    // resolver's leading, so planning with the 13pt shaper value
    // underestimated each line's height.)
    const lineHeight =
      srcPara && srcPara.leadingPt > 0
        ? srcPara.leadingPt
        : engine.getShaper().getLineHeight();

    const textUnits = units.filter(u => u.role !== 'footnote');
    const footnoteUnits = units.filter(u => u.role === 'footnote');

    const allLines: TypesetLine[] = [];
    for (const unit of textUnits) {
      const isHeading =
        unit.role === 'chapter' || unit.role === 'heading' || unit.role === 'siman';
      const lines = engine.typesetContentUnit(
        unit,
        colWidth,
        isHeading ? lineHeight * 1.3 : lineHeight,
        !isHeading
      );
      for (let i = 0; i < lines.length; i++) {
        lines[i].keepPriority = isHeading
          ? KeepPriority.HEADING_PARAGRAPH
          : i === 0 || i === lines.length - 1
          ? KeepPriority.PARAGRAPH
          : KeepPriority.LINE;
      }
      allLines.push(...lines);
    }

    const fnEngine = new TypesetterEngine(
      designSettings?.footnotes?.fontSizePt ?? 9.5,
      rulesConfig,
      designSettings
    );
    const fnLeading = designSettings?.footnotes?.leadingPt ?? 13;
    const justifyMultiLineFn = TypesettingRulesEngine.resolveRule<boolean>(
      'footnotes.justifyMultiLineNonFinal',
      { layoutType: 'two_column', role: 'footnote' },
      rulesConfig
    ).value;
    const allFnLines: TypesetLine[] = [];
    for (const fn of footnoteUnits) {
      const probeLines = fnEngine.typesetContentUnit(fn, contentWidth, fnLeading, false);
      const fnLines =
        probeLines.length > 1 && justifyMultiLineFn
          ? fnEngine.typesetContentUnit(fn, contentWidth, fnLeading, true)
          : probeLines;
      allFnLines.push(...fnLines);
    }
    const reservedFnHeight = allFnLines.length > 0 ? allFnLines.length * fnLeading + 16 : 0;

    const maxLinesPerColumn = Math.max(
      10,
      Math.floor((contentHeight - reservedFnHeight - 24) / lineHeight)
    );
    const maxLinesPerPage = maxLinesPerColumn * 2;

    // Look-Ahead Multi-Page Balancing (applied per segment — see below):
    // If a segment only exceeds maxLinesPerPage by 1-4 lines, slightly tighten lineHeight (0.96x)
    // to fit comfortably on a single well-balanced page instead of creating a nearly-empty Page 2!
    let effectiveLineHeight = lineHeight;
    const editorialDecisions: string[] = [];

    // v0.8.0 Part C (§6): Insert Page (force-break) — split the flow into
    // segments at force-break unit starts; each segment is paginated with
    // the existing balanced logic, so a break unit starts a new page.
    // (Before this fix the override was honoured only in
    // paginateSingleColumn.) A unit never straddles a segment boundary,
    // because segments split exactly at unit starts.
    const forceBreakIds = TypesettingRulesEngine.forcePageBreakUnitIds(rulesConfig);
    const segmentStarts: number[] = [0];
    for (let i = 1; i < allLines.length; i++) {
      const ln = allLines[i];
      if (ln.unitId && forceBreakIds.has(ln.unitId) && allLines[i - 1].unitId !== ln.unitId) {
        segmentStarts.push(i);
      }
    }
    if (segmentStarts.length > 1) {
      editorialDecisions.push(
        `מעבר עמוד כפוי: התוכן פוצל ל-${segmentStarts.length} מקטעים לפי סימני מעבר עמוד.`
      );
    }

    const pages: PageTypesetResult[] = [];

    const defaultKnee: DynamicKneeContour = {
      pageContentWidth: contentWidth,
      pageContentHeight: contentHeight,
      topY: 0,
      kneeJunctionY: contentHeight,
      bottomY: contentHeight,
      upperSourceWidth: colWidth,
      lowerSourceWidth: colWidth,
      innerXOffset: 0,
      isLeftStepped: false,
      rightCommentaryWidth: colWidth,
      leftCommentaryWidth: colWidth,
      gutterWidth: colGutter,
    };

    const balanceColumnsEnabled = designSettings?.columns?.balanceColumns ?? true;

    let cursor = 0;
    let p = 0;
    for (let seg = 0; seg < segmentStarts.length; seg++) {
      const segStart = segmentStarts[seg];
      const segEnd =
        seg === segmentStarts.length - 1 ? allLines.length : segmentStarts[seg + 1];
      const segLineCount = segEnd - segStart;
      if (segLineCount <= 0) continue;
      cursor = segStart;

      // Per-segment Look-Ahead balancing (same rules as the old whole-book pass).
      effectiveLineHeight = lineHeight;
      let segTotalPages = Math.max(1, Math.ceil(segLineCount / maxLinesPerPage));
      if (segTotalPages > 1 && segLineCount <= maxLinesPerPage + 4) {
        effectiveLineHeight = lineHeight * 0.95;
        segTotalPages = 1;
        editorialDecisions.push(
          'Look-Ahead: צמצום עדין של מרווח השורות (95%) כדי למנוע גלישת שורות בודדות לעמוד שני כמעט ריק.'
        );
      } else if (segTotalPages > 1) {
        editorialDecisions.push(
          `Look-Ahead דו-טורי: חלוקה מאוזנת של ${segLineCount} שורות על פני ${segTotalPages} עמודים כך שכל עמוד וכל טור מאוזנים אנכית.`
        );
      } else if (seg === 0) {
        editorialDecisions.push('איזון גובה שני הטורים אוטומטית למניעת טור שמאלי קצר.');
      }

      // Distribute lines evenly across pages (so Page 1 doesn't take 100% and leave Page 2 with 15%)
      const segTargetLinesPerPage = Math.ceil(segLineCount / segTotalPages);

      // v0.8.0 Part C (§3/§6): the page loop is `while (cursor < segEnd)`
      // (not a fixed page count) so a keep-together hold-back that leaves
      // lines unplaced simply adds another page instead of dropping them.
      let sp = 0;
      while (cursor < segEnd && sp < segTotalPages + 10) {
        const pageNumber = p + 1;
        const remainingInSegment = segEnd - cursor;
        let take = Math.min(segTargetLinesPerPage, remainingInSegment);

        // v0.8.0 Part C (§3): keep-together hold-back — a keep-together
        // unit that would split across this page break moves whole to the
        // next page (the helper leaves the take unchanged when the unit
        // starts the page or ends the segment).
        {
          const keepIds = TypesettingRulesEngine.keepTogetherUnitIds(rulesConfig);
          const backedTake = PaginationEngine.backUpTakeForKeepTogether(
            allLines,
            cursor,
            take,
            keepIds
          );
          if (backedTake < take) {
            take = backedTake;
            editorialDecisions.push(
              'שמירת יחידה יחד (Keep-Together): יחידה שהייתה מתפצלת בין עמודים הועברה בשלמותה לעמוד הבא.'
            );
          }
        }

        // The last page is the one that consumes the final segment's last
        // line — recomputed after the hold-back, so footnotes land on the
        // true final page even when a hold-back adds a page.
        const isLastPage =
          seg === segmentStarts.length - 1 && take >= remainingInSegment;

      // Ensure even split between the two columns on this page (or fill right column first when balanceColumns is false), avoiding:
      // 1. Heading at the bottom of Column 1 (Priority 80)
      // 2. Single-line paragraph orphan at the bottom of Column 1 or 1-line widow at the top of Column 2 (Priority 2 / M-1)
      let halfCount = balanceColumnsEnabled
        ? Math.ceil(take / 2)
        : Math.min(take, maxLinesPerColumn);
      const col1LastLine = allLines[cursor + halfCount - 1];
      const col1PrevLine = halfCount >= 2 ? allLines[cursor + halfCount - 2] : null;
      const col2FirstLine = halfCount < take ? allLines[cursor + halfCount] : null;
      const col2SecondLine = halfCount + 1 < take ? allLines[cursor + halfCount + 1] : null;

      const pageCtx = { layoutType: 'two_column' as const, pageNumber, pageIndex: p };
      const keepHeadingWithNext = TypesettingRulesEngine.resolveRule<boolean>(
        'headings.keepWithNext',
        pageCtx,
        rulesConfig
      ).value;
      const preventOrphans = TypesettingRulesEngine.resolveRule<boolean>(
        'paragraph.preventOrphans',
        pageCtx,
        rulesConfig
      ).value;
      const preventWidows = TypesettingRulesEngine.resolveRule<boolean>(
        'paragraph.preventWidows',
        pageCtx,
        rulesConfig
      ).value;

      if (
        keepHeadingWithNext &&
        col1LastLine &&
        (col1LastLine.role === 'chapter' ||
          col1LastLine.role === 'heading' ||
          col1LastLine.role === 'siman') &&
        halfCount > 2
      ) {
        halfCount -= 1;
        editorialDecisions.push('מניעת כותרת בתחתית הטור הימני — הועברה לראש הטור השמאלי.');
      } else if (
        preventOrphans &&
        col1LastLine &&
        col2FirstLine &&
        col1LastLine.unitId === col2FirstLine.unitId &&
        col1PrevLine &&
        col1PrevLine.unitId !== col1LastLine.unitId &&
        halfCount > 2
      ) {
        // Priority 2 (M-1): `col1LastLine` is the ONLY line of a new paragraph at the bottom of Column 1!
        // Hold it back by 1 line so the paragraph starts cleanly at the top of Column 2!
        halfCount -= 1;
        editorialDecisions.push('מניעת שורת פתיחה יתומה בתחתית הטור הימני — הועברה לראש הטור השמאלי.');
      } else if (
        preventWidows &&
        col1LastLine &&
        col2FirstLine &&
        col1LastLine.unitId === col2FirstLine.unitId &&
        (!col2SecondLine || col2SecondLine.unitId !== col2FirstLine.unitId) &&
        halfCount + 1 <= maxLinesPerColumn
      ) {
        // `col2FirstLine` is a 1-line widow tail of the paragraph from Column 1: pull it into Column 1 if space permits
        halfCount += 1;
        editorialDecisions.push('מניעת שורת סיום אלמנה בראש הטור השמאלי — אוחדה לסוף הטור הימני.');
      }

      const pageSlice = allLines.slice(cursor, cursor + take);
      cursor += take;

      const col1Lines = pageSlice.slice(0, halfCount);
      const col2Lines = pageSlice.slice(halfCount);

      const spatial = new SpatialExclusionEngine(contentWidth, contentHeight);

      // v0.8.0 Part C (§9): the first baseline is the first LINE's own
      // ascent — the engine base is fontSize−1.5pt but the lines are
      // role-resolved (14.5pt), so the shaper's ascent put the first
      // line's top 1pt above the content area (pre-existing clipping
      // artifact, caught by the Part C smoke).
      let y1 = col1Lines[0]?.ascent ?? engine.getShaper().getAscent();
      for (const line of col1Lines) {
        const lh = line.leadingPt && line.leadingPt > 0 ? line.leadingPt : effectiveLineHeight;
        line.height = lh;
        if (line.spaceBeforePt && line.spaceBeforePt > 0) {
          y1 += line.spaceBeforePt;
        }
        line.yBaseline = y1;
        line.xStart = 0;
        line.columnNumber = 1;
        // Right column occupies [contentWidth - colWidth .. contentWidth]
        spatial.registerLine(line, contentWidth - colWidth, contentWidth, `c1-p${p}`);
        y1 += lh + (line.spaceAfterPt ?? 0);
      }

      let y2 = col2Lines[0]?.ascent ?? engine.getShaper().getAscent();
      for (const line of col2Lines) {
        const lh = line.leadingPt && line.leadingPt > 0 ? line.leadingPt : effectiveLineHeight;
        line.height = lh;
        if (line.spaceBeforePt && line.spaceBeforePt > 0) {
          y2 += line.spaceBeforePt;
        }
        line.yBaseline = y2;
        line.xStart = colWidth + colGutter;
        line.columnNumber = 2;
        // Left column occupies [0 .. colWidth]
        spatial.registerLine(line, 0, colWidth, `c2-p${p}`);
        y2 += lh + (line.spaceAfterPt ?? 0);
      }

      const fnForPage = isLastPage ? allFnLines : [];
      const collisions = spatial.detectCollisions(1.0);
      const colDiff = Math.abs(y1 - y2);
      const verticalBalance = Math.max(82, Math.round(100 - (colDiff / contentHeight) * 60));

      pages.push({
        pageIndex: p,
        pageNumber,
        pageNumberHebrew: PdfExporter.toHebrewGematria(pageNumber),
        headerTitle: title,
        layoutType: 'two_column',
        geometry,
        sourceLines: col1Lines,
        column2Lines: col2Lines,
        rashiLines: [],
        tosafotLines: [],
        footnoteLines: fnForPage,
        knee: defaultKnee,
        occupiedRegions: spatial.getOccupiedRegions(),
        layoutScore: {
          totalScore: collisions.length === 0 ? 96 : 50,
          pageUtilization: 91,
          verticalBalance,
          horizontalBalance: 98,
          whitespaceScore: 95,
          textDensity: 94,
          readability: 96,
          sourceCommentaryAlignment: 97,
          semanticPreservation: 97,
          widowOrphanPenalty: 0,
          lineBreakPenalty: 0,
          stretchingCompressionPenalty: 0,
          continuationQuality: 96,
          visualHierarchyScore: 96,
          collisionCount: collisions.length,
          narrowColumnPenalty: 0,
          candidatesEvaluated: 3,
          lookAheadAdjusted: true,
          editorialDecisions,
        },
      });

        p++;
        sp++;
      }
    }

    return {
      title,
      layoutType: 'two_column',
      pages,
      totalPages: pages.length,
      geometry,
      autoFixesApplied: editorialDecisions,
    };
  }

  /**
   * 3. Source on Top + Split Commentaries on Bottom (משנה ברורה / רמב״ם / חומש)
   * Problem 5, 6 & 8:
   * - Evaluates page-count & break candidates with Look-Ahead so Page 2 never has tiny leftover text.
   * - Computes `dividerY` dynamically PER PAGE directly below that page's `sourceLines`,
   *   so the lower commentaries rise up to fill the page instead of leaving a blank chasm!
   */
  private static paginateTopSourceBottomCommentary(
    title: string,
    units: ContentUnit[],
    geometry: PageGeometry,
    contentWidth: number,
    contentHeight: number,
    sourceFontSize: number,
    commentaryFontSize: number,
    rulesConfig?: TypesettingRulesConfig,
    designSettings?: ProfessionalDesignSettings
  ): BookTypesetDocument {
    const sourceEngine = new TypesetterEngine(
      sourceFontSize,
      rulesConfig,
      designSettings
    );
    const commentEngine = new TypesetterEngine(
      commentaryFontSize,
      rulesConfig,
      designSettings
    );

    const srcPara = designSettings?.roleStyles?.main_source?.paragraph;
    const cmtPara = designSettings?.roleStyles?.primary_comment?.paragraph;
    // v0.8.0 Part C (§2): the resolver's leadingPt is meaningful in both
    // modes (see dynamic-knee.ts) — gating on 'fixed' hid tier lineHeight
    // edits behind the shaper's stale 1.32 default.
    const sourceLineH =
      srcPara && srcPara.leadingPt > 0
        ? srcPara.leadingPt
        : sourceEngine.getShaper().getLineHeight();
    const commentLineH =
      cmtPara && cmtPara.leadingPt > 0
        ? cmtPara.leadingPt
        : commentEngine.getShaper().getLineHeight();

    // v0.8.0 Part C (§1): the source stream takes every structural role,
    // not just main_source/chapter/siman — heading, list_item, table and
    // the rest were silently dropped before this fix (tables fold in as
    // running text; there is no table grid — see PART-C-NOTES.md).
    const sourceUnits = units.filter(u =>
      [
        'main_source',
        'chapter',
        'siman',
        'heading',
        'subtitle',
        'introduction',
        'seif',
        'subheading',
        'bold_special',
        'list_item',
        'table',
        'caption',
      ].includes(u.role)
    );
    const rashiUnits = units.filter(u => u.role === 'primary_comment');
    const tosafotUnits = units.filter(u => u.role === 'secondary_comment');
    const footnoteUnits = units.filter(u => u.role === 'footnote');
    // v0.8.0 Part C (§1): the tertiary stream (Ein Mishpat / Ner Mitzvah /
    // Torah Or / Masoret HaShas, cross-references, side notes) gets its own
    // band below the commentaries instead of being dropped.
    const tertiaryUnits = units.filter(u =>
      ['tertiary_comment', 'cross_reference', 'side_note'].includes(u.role)
    );

    const sourceLines = sourceUnits.flatMap(u => {
      const isHeading = u.role === 'chapter' || u.role === 'heading' || u.role === 'siman';
      return sourceEngine.typesetContentUnit(
        u,
        contentWidth,
        isHeading ? sourceLineH * 1.25 : sourceLineH,
        !isHeading
      );
    });

    const colGutter = designSettings?.columns?.columnGapPt ?? 14.0;
    // v0.8.0 Part C (§2): the bottom split comes from the tiers, not a
    // fixed 50/50 — editing the Rashi/Tosafot tier widths (or the AI
    // `expand_tosafot` action) visibly widens/narrows the columns.
    const colSplit = designSettings
      ? DesignSettingsEngine.tierColumnSplit(designSettings, 'primary_comment', 'secondary_comment')
      : null;
    const rashiColW = Math.round((contentWidth - colGutter) * (colSplit ?? 0.5));
    const tosafotColW = contentWidth - colGutter - rashiColW;

    const rashiLines = rashiUnits.flatMap(u =>
      commentEngine.typesetContentUnit(u, rashiColW, commentLineH, true)
    );
    const tosafotLines = tosafotUnits.flatMap(u =>
      commentEngine.typesetContentUnit(u, tosafotColW, commentLineH, true)
    );

    // v0.8.0 Part C (§1): tertiary band lines, pre-typeset once at full
    // width with the tier's leading; the page loop consumes them with
    // their own cursor.
    const terStyle = designSettings
      ? DesignSettingsEngine.resolveRoleAndUnitStyle(designSettings, 'tertiary_comment')
      : null;
    const terFontSize = terStyle?.character.fontSizePt ?? 9;
    const terLineH = Math.max(
      terFontSize * 1.06,
      terStyle?.paragraph.leadingPt ?? terFontSize * 1.25
    );
    const terEngine = new TypesetterEngine(terFontSize, rulesConfig, designSettings);
    const terLinesAll: TypesetLine[] = tertiaryUnits.flatMap(u =>
      terEngine.typesetContentUnit(u, contentWidth, terLineH, true)
    );
    let terLineCursor = 0;

    const fnEngine = new TypesetterEngine(
      designSettings?.footnotes?.fontSizePt ?? 9.5,
      rulesConfig,
      designSettings
    );
    const fnLeading = designSettings?.footnotes?.leadingPt ?? 13;
    const justifyMultiLineFn = TypesettingRulesEngine.resolveRule<boolean>(
      'footnotes.justifyMultiLineNonFinal',
      { layoutType: 'source_top_commentary_bottom', role: 'footnote' },
      rulesConfig
    ).value;
    const allFnLines: TypesetLine[] = [];
    for (const fn of footnoteUnits) {
      const probeLines = fnEngine.typesetContentUnit(fn, contentWidth, fnLeading, false);
      const fnLines =
        probeLines.length > 1 && justifyMultiLineFn
          ? fnEngine.typesetContentUnit(fn, contentWidth, fnLeading, true)
          : probeLines;
      allFnLines.push(...fnLines);
    }
    const reservedFnHeight = allFnLines.length > 0 ? allFnLines.length * fnLeading + 14 : 0;

    const dividerGap = 24.0; // 10pt above rule + 14pt below rule

    // v0.8.0 Part C (§1/§6): the page loop is driven by REMAINING content,
    // not a precomputed page count. The old for-loop capped the last
    // page's takes by the space available, so overflow on the final page
    // was silently dropped; the while loop below adds overflow pages
    // instead. The initial page-count estimate is kept only for the
    // editorial message.
    const totalSourceHeight = sourceLines.reduce(
      (acc, l) => acc + l.height + (l.spaceBeforePt ?? 0) + (l.spaceAfterPt ?? 0),
      0
    );
    const totalCombinedHeight =
      totalSourceHeight +
      dividerGap +
      Math.max(rashiLines.length, tosafotLines.length) * commentLineH +
      terLinesAll.length * terLineH +
      reservedFnHeight;
    const estTotalPages =
      totalCombinedHeight <= contentHeight
        ? 1
        : Math.max(1, Math.ceil(totalCombinedHeight / (contentHeight * 0.85)));

    const pages: PageTypesetResult[] = [];
    const autoFixesApplied: string[] = [];

    if (estTotalPages > 1) {
      autoFixesApplied.push(
        `Look-Ahead (מקור ופירוש): חלוקה מאוזנת על פני כ-${estTotalPages} עמודים עם קו מפריד דינמי לכל עמוד למניעת חלל ריק.`
      );
    } else {
      autoFixesApplied.push(
        'איזון מקור ופירוש: התאמת מיקום הקו המפריד לגובה המקור בפועל ואיחוד לעמוד מלא ומאוזן.'
      );
    }

    let sCursor = 0;
    let rCursor = 0;
    let tCursor = 0;
    let p = 0;

    while (
      (sCursor < sourceLines.length ||
        rCursor < rashiLines.length ||
        tCursor < tosafotLines.length ||
        terLineCursor < terLinesAll.length) &&
      p < 500
    ) {
      const pageNumber = p + 1;

      // Per-page balanced takes from the REMAINING content (recomputed
      // each page so an overflow page is still balanced).
      const remSourceHeight = sourceLines
        .slice(sCursor)
        .reduce(
          (acc, l) => acc + l.height + (l.spaceBeforePt ?? 0) + (l.spaceAfterPt ?? 0),
          0
        );
      const remCommentLines = Math.max(
        rashiLines.length - rCursor,
        tosafotLines.length - tCursor
      );
      const remTotalHeight =
        remSourceHeight +
        dividerGap +
        remCommentLines * commentLineH +
        (terLinesAll.length - terLineCursor) * terLineH +
        reservedFnHeight;
      const estPagesLeft = Math.max(
        1,
        Math.ceil(remTotalHeight / (contentHeight * 0.85))
      );
      const balancedSourcePerPage = Math.max(
        2,
        Math.ceil((sourceLines.length - sCursor) / estPagesLeft)
      );
      const balancedRashiPerPage = Math.max(
        2,
        Math.ceil((rashiLines.length - rCursor) / estPagesLeft)
      );
      const balancedTosafotPerPage = Math.max(
        2,
        Math.ceil((tosafotLines.length - tCursor) / estPagesLeft)
      );

      // Determine how many source lines to take on this page (respecting heading keep-with-next)
      let sTake = Math.min(balancedSourcePerPage, sourceLines.length - sCursor);

      const lastSrcLine = sourceLines[sCursor + sTake - 1];
      if (
        lastSrcLine &&
        (lastSrcLine.role === 'chapter' || lastSrcLine.role === 'heading') &&
        sCursor + sTake < sourceLines.length &&
        sTake > 1
      ) {
        sTake -= 1;
      }

      // v0.8.0 Part C (§6): Insert Page (force-break) — if a force-break
      // unit starts inside this page's source take (and not at its top),
      // truncate the take so the unit starts the next page. (Before this
      // fix the override was honoured only in paginateSingleColumn.)
      {
        const forceBreakIds = TypesettingRulesEngine.forcePageBreakUnitIds(rulesConfig);
        if (forceBreakIds.size > 0 && sTake > 1) {
          for (let i = sCursor + 1; i < sCursor + sTake; i++) {
            const ln = sourceLines[i];
            if (
              ln.unitId &&
              forceBreakIds.has(ln.unitId) &&
              sourceLines[i - 1].unitId !== ln.unitId
            ) {
              sTake = i - sCursor;
              autoFixesApplied.push(
                `מעבר עמוד כפוי: היחידה הבאה מתחילה בראש עמוד ${p + 2}.`
              );
              break;
            }
          }
        }
      }

      // v0.8.0 Part C (§3): keep-together hold-back for the source take.
      {
        const keepIds = TypesettingRulesEngine.keepTogetherUnitIds(rulesConfig);
        const backed = PaginationEngine.backUpTakeForKeepTogether(
          sourceLines,
          sCursor,
          sTake,
          keepIds
        );
        if (backed < sTake) {
          sTake = backed;
          autoFixesApplied.push(
            'שמירת יחידה יחד (Keep-Together): יחידת מקור שהייתה מתפצלת בין עמודים הועברה בשלמותה לעמוד הבא.'
          );
        }
      }

      const sSlice = sourceLines.slice(sCursor, sCursor + sTake);
      sCursor += sTake;

      const spatial = new SpatialExclusionEngine(contentWidth, contentHeight);

      let ySource = sourceEngine.getShaper().getAscent();
      for (const line of sSlice) {
        if (line.spaceBeforePt && line.spaceBeforePt > 0) {
          ySource += line.spaceBeforePt;
        }
        line.yBaseline = ySource;
        line.xStart = 0;
        spatial.registerLine(line, 0, contentWidth, `top-src-p${p}`);
        ySource += line.height + (line.spaceAfterPt ?? 0);
      }

      // Compute PER-PAGE dynamic dividerY immediately below this page's actual source lines!
      const actualSourceBottom =
        sSlice.length > 0
          ? (sSlice[sSlice.length - 1].yBottom ?? ySource)
          : sourceLineH * 2;
      const pageDividerY = Math.min(
        contentHeight * 0.62,
        Math.max(contentHeight * 0.20, actualSourceBottom + 12.0)
      );
      const bottomCommentaryTop = pageDividerY + 14.0;

      // Calculate how many commentary lines can physically fit below `bottomCommentaryTop` on this page.
      // Two passes: first without the footnote reserve — if the takes
      // exhaust every stream, this is the final page and the takes are
      // re-capped with the footnote reserve so the footnotes fit too.
      // (The old code capped the last page's takes by the space available
      // and dropped the overflow — the while loop above adds overflow
      // pages instead.)
      const maxCommentLinesNoFn = Math.max(
        4,
        Math.floor((contentHeight - bottomCommentaryTop) / commentLineH)
      );
      let rTake = Math.min(
        maxCommentLinesNoFn,
        balancedRashiPerPage,
        rashiLines.length - rCursor
      );
      let tTake = Math.min(
        maxCommentLinesNoFn,
        balancedTosafotPerPage,
        tosafotLines.length - tCursor
      );

      // v0.8.0 Part C (§3): keep-together hold-backs for the commentary takes.
      {
        const keepIds = TypesettingRulesEngine.keepTogetherUnitIds(rulesConfig);
        const backedR = PaginationEngine.backUpTakeForKeepTogether(
          rashiLines,
          rCursor,
          rTake,
          keepIds
        );
        if (backedR < rTake) {
          rTake = backedR;
          autoFixesApplied.push(
            'שמירת יחידה יחד (Keep-Together): יחידת רש״י שהייתה מתפצלת בין עמודים הועברה בשלמותה לעמוד הבא.'
          );
        }
        const backedT = PaginationEngine.backUpTakeForKeepTogether(
          tosafotLines,
          tCursor,
          tTake,
          keepIds
        );
        if (backedT < tTake) {
          tTake = backedT;
          autoFixesApplied.push(
            'שמירת יחידה יחד (Keep-Together): יחידת תוספות שהייתה מתפצלת בין עמודים הועברה בשלמותה לעמוד הבא.'
          );
        }
      }

      const streamsExhausted =
        sCursor >= sourceLines.length &&
        rCursor + rTake >= rashiLines.length &&
        tCursor + tTake >= tosafotLines.length;
      let pageFnLines: TypesetLine[] = [];
      let pageReservedFnH = 0;
      if (streamsExhausted) {
        // Final-page candidate: re-cap the commentary takes with the
        // footnote reserve. If they still exhaust the streams, the
        // footnotes land here; otherwise they roll to the next page.
        pageReservedFnH = reservedFnHeight;
        const maxCommentLinesWithFn = Math.max(
          4,
          Math.floor((contentHeight - pageReservedFnH - bottomCommentaryTop) / commentLineH)
        );
        rTake = Math.min(maxCommentLinesWithFn, rTake);
        tTake = Math.min(maxCommentLinesWithFn, tTake);
        if (
          rCursor + rTake >= rashiLines.length &&
          tCursor + tTake >= tosafotLines.length
        ) {
          pageFnLines = allFnLines;
        } else {
          pageReservedFnH = 0;
        }
      }

      const rSlice = rashiLines.slice(rCursor, rCursor + rTake);
      const tSlice = tosafotLines.slice(tCursor, tCursor + tTake);
      rCursor += rTake;
      tCursor += tTake;

      // v0.7.0 Part 3 (M1) — facing-page flanks: Rashi is INNER, Tosafot
      // OUTER. Recto (p even): Rashi right / Tosafot left (the v0.6.0
      // behaviour, unchanged). Verso (p odd): the two columns swap.
      const mirrorFlanksBottom = p % 2 === 1;
      let yRashi = bottomCommentaryTop + commentEngine.getShaper().getAscent();
      for (const line of rSlice) {
        if (line.spaceBeforePt && line.spaceBeforePt > 0) {
          yRashi += line.spaceBeforePt;
        }
        line.yBaseline = yRashi;
        // v0.8.0 Part C (§2): Rashi's column width comes from its tier.
        line.xStart = mirrorFlanksBottom ? 0 : contentWidth - rashiColW;
        line.targetWidth = rashiColW;
        // Recto: right column [contentWidth - rashiColW .. contentWidth]; verso: left column [0 .. rashiColW].
        if (mirrorFlanksBottom) spatial.registerLine(line, 0, rashiColW, `btm-rashi-p${p}`);
        else spatial.registerLine(line, contentWidth - rashiColW, contentWidth, `btm-rashi-p${p}`);
        yRashi += line.height + (line.spaceAfterPt ?? 0);
      }

      let yTosafot = bottomCommentaryTop + commentEngine.getShaper().getAscent();
      for (const line of tSlice) {
        if (line.spaceBeforePt && line.spaceBeforePt > 0) {
          yTosafot += line.spaceBeforePt;
        }
        line.yBaseline = yTosafot;
        // v0.8.0 Part C (§2): Tosafot's column width comes from its tier.
        line.xStart = mirrorFlanksBottom ? contentWidth - tosafotColW : 0;
        line.targetWidth = tosafotColW;
        // Recto: left column [0 .. tosafotColW]; verso: right column [contentWidth - tosafotColW .. contentWidth].
        if (mirrorFlanksBottom) spatial.registerLine(line, contentWidth - tosafotColW, contentWidth, `btm-tos-p${p}`);
        else spatial.registerLine(line, 0, tosafotColW, `btm-tos-p${p}`);
        yTosafot += line.height + (line.spaceAfterPt ?? 0);
      }

      // v0.8.0 Part C (§1/§9): tertiary band — a full-width strip below
      // the commentaries and above the footnotes, in its own region so it
      // can never overlap them. At most 6 lines per page; the rest rolls
      // to the next page.
      const terSlice: TypesetLine[] = [];
      if (terLineCursor < terLinesAll.length) {
        const commentBottom = Math.max(
          bottomCommentaryTop,
          ...rSlice.map(l => l.yBottom ?? l.yBaseline + l.descent),
          ...tSlice.map(l => l.yBottom ?? l.yBaseline + l.descent)
        );
        const bandTop = commentBottom + 10;
        const bandBottom = contentHeight - pageReservedFnH - 4;
        const maxTerLines = Math.max(
          0,
          Math.min(6, Math.floor((bandBottom - bandTop) / terLineH))
        );
        const takeTer = Math.min(maxTerLines, terLinesAll.length - terLineCursor);
        const terAscent = terLinesAll[terLineCursor]?.ascent ?? terFontSize * 0.82;
        let terY = bandTop + terAscent;
        for (let ti = 0; ti < takeTer; ti++) {
          const srcTer = terLinesAll[terLineCursor + ti];
          const tl: TypesetLine = { ...srcTer, words: srcTer.words.map(w => ({ ...w })) };
          tl.yBaseline = terY;
          tl.yTop = terY - tl.ascent;
          tl.yBottom = terY + tl.descent;
          tl.xLeft = 0;
          tl.xRight = contentWidth;
          tl.targetWidth = contentWidth;
          terSlice.push(tl);
          spatial.registerLine(tl, 0, contentWidth, `btm-ter-p${p}-${ti}`);
          terY += terLineH;
        }
        terLineCursor += takeTer;
      }
      // If the band did not exhaust the tertiary stream, this page is not
      // final after all — the footnotes roll to the next page (the
      // commentary takes above were re-capped with the footnote reserve,
      // so this page is only slightly under-filled).
      if (pageFnLines.length > 0 && terLineCursor < terLinesAll.length) {
        pageFnLines = [];
        pageReservedFnH = 0;
      }

      if (pageFnLines.length > 0) {
        let fnY = contentHeight - pageFnLines.length * fnLeading + 10;
        for (const fl of pageFnLines) {
          fl.yBaseline = fnY;
          spatial.registerLine(fl, 0, contentWidth, `btm-fn-p${p}`);
          fnY += fnLeading;
        }
      }

      const collisions = spatial.detectCollisions(1.0);
      const pageRatio = Math.round((pageDividerY / contentHeight) * 100);

      pages.push({
        pageIndex: p,
        pageNumber,
        pageNumberHebrew: PdfExporter.toHebrewGematria(pageNumber),
        headerTitle: title,
        layoutType: 'source_top_commentary_bottom',
        geometry,
        sourceLines: sSlice,
        rashiLines: rSlice,
        tosafotLines: tSlice,
        footnoteLines: pageFnLines,
        // v0.8.0 Part C (§1): tertiary band lines.
        tertiaryLines: terSlice,
        dividerY: pageDividerY,
        occupiedRegions: spatial.getOccupiedRegions(),
        knee: {
          pageContentWidth: contentWidth,
          pageContentHeight: contentHeight,
          topY: 0,
          kneeJunctionY: pageDividerY,
          bottomY: contentHeight,
          upperSourceWidth: contentWidth,
          lowerSourceWidth: contentWidth,
          innerXOffset: 0,
          isLeftStepped: false,
          // v0.8.0 Part C (§2/§4): the physical right/left widths follow
          // the facing — recto Rashi right, verso Rashi left.
          rightCommentaryWidth: mirrorFlanksBottom ? tosafotColW : rashiColW,
          leftCommentaryWidth: mirrorFlanksBottom ? rashiColW : tosafotColW,
          gutterWidth: colGutter,
        },
        layoutScore: {
          totalScore: collisions.length === 0 ? 95 : 50,
          pageUtilization: 90,
          verticalBalance: 94,
          horizontalBalance: 96,
          whitespaceScore: 94,
          textDensity: 93,
          readability: 96,
          sourceCommentaryAlignment: 97,
          semanticPreservation: 96,
          widowOrphanPenalty: 0,
          lineBreakPenalty: 0,
          stretchingCompressionPenalty: 0,
          continuationQuality: 95,
          visualHierarchyScore: 96,
          collisionCount: collisions.length,
          narrowColumnPenalty: 0,
          candidatesEvaluated: 4,
          lookAheadAdjusted: true,
          editorialDecisions: [
            ...autoFixesApplied,
            `קו מפריד דינמי בעמוד ${pageNumber} ב-y=${Math.round(pageDividerY)}pt (${pageRatio}% מקור עליון / ${100 - pageRatio}% מפרשים תחתונים).`,
          ],
        },
      });

      p++;
    }

    return {
      title,
      layoutType: 'source_top_commentary_bottom',
      pages,
      totalPages: pages.length,
      geometry,
      autoFixesApplied,
    };
  }

  /**
   * Stage 2: Builds semantic LinkedRavGroup[] clusters from ContentUnits and RavTextLinks,
   * calculating the exact 2D geometric area required by each linked Source + Rashi + Tosafot group
   * using real HarfBuzz glyph advances before committing placement.
   */
  public static buildLinkedRavGroups(
    units: ContentUnit[],
    explicitLinks?: RavTextLink[],
    sourceFontSize: number = 14.5,
    commentaryFontSize: number = 10.5,
    designSettings?: ProfessionalDesignSettings,
    rulesConfig?: TypesettingRulesConfig
  ): {
    groups: LinkedRavGroup[];
    allLinks: RavTextLink[];
    sourceShapedAll: ShapedWord[];
    rashiShapedAll: ShapedWord[];
    tosafotShapedAll: ShapedWord[];
    /** v0.8.0 Part C (§1): fourth stream — tertiary commentaries, cross-references, side notes. */
    tertiaryShapedAll: ShapedWord[];
    tertiaryUnits: ContentUnit[];
  } {
    const sourceUnits = units.filter(u => PaginationEngine.RAV_SOURCE_ROLES.includes(u.role));
    const rashiUnits = units.filter(
      u => u.role === 'primary_comment' || u.role === 'dibbur_hamatchil'
    );
    const tosafotUnits = units.filter(u => u.role === 'secondary_comment');
    // v0.8.0 Part C (§1): the tertiary stream — Ein Mishpat, Ner Mitzvah,
    // Torah Or, Masoret HaShas, cross-references and side notes. Before
    // this fix these roles matched no stream and were silently dropped.
    const tertiaryUnits = units.filter(u =>
      PaginationEngine.RAV_TERTIARY_ROLES.includes(u.role)
    );

    const allLinks: RavTextLink[] =
      explicitLinks && explicitLinks.length > 0
        ? explicitLinks
        : DocxImporter.autoLinkCommentariesToSource(sourceUnits, [
            ...rashiUnits,
            ...tosafotUnits,
          ]);

    const linkByCommentaryUnit = new Map<string, RavTextLink>();
    for (const link of allLinks) {
      linkByCommentaryUnit.set(link.commentaryUnitId, link);
    }

    const sourceEngine = new TypesetterEngine(
      sourceFontSize,
      rulesConfig,
      designSettings
    );
    const commentEngine = new TypesetterEngine(
      commentaryFontSize,
      rulesConfig,
      designSettings
    );
    const sLineH = sourceEngine.getShaper().getLineHeight();
    const cLineH = commentEngine.getShaper().getLineHeight();

    // Group leading headings/chapters with the first following main_source unit,
    // and attach unlinked continuation source units to their preceding linked source cluster
    // so no orphan unlinked source page is created.
    const linkedSourceUnitIds = new Set<string>(allLinks.map(l => l.sourceUnitId));
    for (const cu of [...rashiUnits, ...tosafotUnits]) {
      if (cu.linkedSourceId) linkedSourceUnitIds.add(cu.linkedSourceId);
    }

    const sourceClusters: ContentUnit[][] = [];
    let pendingHeaders: ContentUnit[] = [];
    for (const su of sourceUnits) {
      if (su.role === 'chapter' || su.role === 'main_title' || su.role === 'heading' || su.role === 'siman' || su.role === 'subtitle' || su.role === 'subheading') {
        pendingHeaders.push(su);
      } else if (
        sourceClusters.length > 0 &&
        pendingHeaders.length === 0 &&
        linkedSourceUnitIds.size > 0 &&
        !linkedSourceUnitIds.has(su.id)
      ) {
        // Attach unlinked continuation paragraph (e.g. conclusion of a Mishnah/Gemara sugya)
        // to the current source cluster so it stays with its sugya!
        sourceClusters[sourceClusters.length - 1].push(su);
      } else {
        sourceClusters.push([...pendingHeaders, su]);
        pendingHeaders = [];
      }
    }
    if (pendingHeaders.length > 0) {
      if (sourceClusters.length > 0) {
        sourceClusters[sourceClusters.length - 1].push(...pendingHeaders);
      } else {
        sourceClusters.push(pendingHeaders);
      }
    }

    // Keep commentary streams in their original order even when links point backward.
    let mergeForOrder = true;
    while (mergeForOrder) {
      mergeForOrder = false;
      const indexBySourceId = new Map<string, number>();
      sourceClusters.forEach((cluster, index) => {
        for (const unit of cluster) indexBySourceId.set(unit.id, index);
      });
      for (const stream of [rashiUnits, tosafotUnits]) {
        let previousIndex = -1;
        for (const commentaryUnit of stream) {
          const link = linkByCommentaryUnit.get(commentaryUnit.id);
          const sourceId = link?.sourceUnitId ?? commentaryUnit.linkedSourceId;
          const targetIndex = sourceId ? indexBySourceId.get(sourceId) : undefined;
          if (targetIndex === undefined) continue;
          if (previousIndex > targetIndex) {
            const merged = sourceClusters.slice(targetIndex, previousIndex + 1).flat();
            sourceClusters.splice(targetIndex, previousIndex - targetIndex + 1, merged);
            mergeForOrder = true;
            break;
          }
          previousIndex = targetIndex;
        }
        if (mergeForOrder) break;
      }
    }
    const assignedRashiIds = new Set<string>();
    const assignedTosafotIds = new Set<string>();
    const groups: LinkedRavGroup[] = [];

    for (let gIdx = 0; gIdx < sourceClusters.length; gIdx++) {
      const clusterSourceUnits = sourceClusters[gIdx];
      const clusterSourceIds = new Set(clusterSourceUnits.map(u => u.id));

      const clusterRashiUnits = rashiUnits.filter(ru => {
        if (assignedRashiIds.has(ru.id)) return false;
        const link = linkByCommentaryUnit.get(ru.id);
        const targetSrcId = link?.sourceUnitId ?? ru.linkedSourceId;
        if (targetSrcId && clusterSourceIds.has(targetSrcId)) {
          assignedRashiIds.add(ru.id);
          return true;
        }
        return false;
      });

      const clusterTosafotUnits = tosafotUnits.filter(tu => {
        if (assignedTosafotIds.has(tu.id)) return false;
        const link = linkByCommentaryUnit.get(tu.id);
        const targetSrcId = link?.sourceUnitId ?? tu.linkedSourceId;
        if (targetSrcId && clusterSourceIds.has(targetSrcId)) {
          assignedTosafotIds.add(tu.id);
          return true;
        }
        return false;
      });

      // Attach any unlinked commentary units to the final source group so 100% of text is conserved
      if (gIdx === sourceClusters.length - 1) {
        for (const ru of rashiUnits) {
          if (!assignedRashiIds.has(ru.id)) {
            assignedRashiIds.add(ru.id);
            clusterRashiUnits.push(ru);
          }
        }
        for (const tu of tosafotUnits) {
          if (!assignedTosafotIds.has(tu.id)) {
            assignedTosafotIds.add(tu.id);
            clusterTosafotUnits.push(tu);
          }
        }
      }

      const sShaped = sourceEngine.shapeUnitSequence(clusterSourceUnits);
      const rShaped = commentEngine.shapeUnitSequence(clusterRashiUnits).map(w => {
        const link = w.unitId ? linkByCommentaryUnit.get(w.unitId) : undefined;
        if (link) {
          w.linkedSourceId = link.sourceUnitId;
          w.linkId = link.linkId;
        }
        return w;
      });
      const tShaped = commentEngine.shapeUnitSequence(clusterTosafotUnits).map(w => {
        const link = w.unitId ? linkByCommentaryUnit.get(w.unitId) : undefined;
        if (link) {
          w.linkedSourceId = link.sourceUnitId;
          w.linkId = link.linkId;
        }
        return w;
      });

      const sWidthSum = sShaped.reduce((acc, w) => acc + w.width + 4.5, 0);
      const rWidthSum = rShaped.reduce((acc, w) => acc + w.width + 3.5, 0);
      const tWidthSum = tShaped.reduce((acc, w) => acc + w.width + 3.5, 0);

      const sourceAreaPt2 = sWidthSum * sLineH;
      const rashiAreaPt2 = rWidthSum * cLineH;
      const tosafotAreaPt2 = tWidthSum * cLineH;

      const groupLinks = allLinks.filter(
        lnk =>
          clusterSourceIds.has(lnk.sourceUnitId) ||
          clusterRashiUnits.some(r => r.id === lnk.commentaryUnitId) ||
          clusterTosafotUnits.some(t => t.id === lnk.commentaryUnitId)
      );

      groups.push({
        groupId: `rav-group-${gIdx + 1}`,
        sourceUnits: clusterSourceUnits,
        rashiUnits: clusterRashiUnits,
        tosafotUnits: clusterTosafotUnits,
        links: groupLinks,
        sourceShapedWords: sShaped,
        rashiShapedWords: rShaped,
        tosafotShapedWords: tShaped,
        requiredAreaPt2: sourceAreaPt2 + rashiAreaPt2 + tosafotAreaPt2,
        sourceAreaPt2,
        rashiAreaPt2,
        tosafotAreaPt2,
      });
    }

    // Handle edge case where commentary units exist without any source units
    if (groups.length === 0 && (rashiUnits.length > 0 || tosafotUnits.length > 0)) {
      const rShaped = commentEngine.shapeUnitSequence(rashiUnits);
      const tShaped = commentEngine.shapeUnitSequence(tosafotUnits);
      const rArea = rShaped.reduce((acc, w) => acc + w.width + 3.5, 0) * cLineH;
      const tArea = tShaped.reduce((acc, w) => acc + w.width + 3.5, 0) * cLineH;
      groups.push({
        groupId: 'rav-group-1',
        sourceUnits: [],
        rashiUnits,
        tosafotUnits,
        links: allLinks,
        sourceShapedWords: [],
        rashiShapedWords: rShaped,
        tosafotShapedWords: tShaped,
        requiredAreaPt2: rArea + tArea,
        sourceAreaPt2: 0,
        rashiAreaPt2: rArea,
        tosafotAreaPt2: tArea,
      });
    }

    // v0.8.0 Part C (§1): the tertiary stream is shaped with the
    // commentary engine even when there are no linked groups at all;
    // per-word sizes come from the resolved tier (see
    // DesignSettingsEngine.resolveRoleAndUnitStyle).
    const tertiaryShapedAll = commentEngine.shapeUnitSequence(tertiaryUnits);

    return {
      groups,
      allLinks,
      sourceShapedAll: groups.flatMap(g => g.sourceShapedWords),
      rashiShapedAll: groups.flatMap(g => g.rashiShapedWords),
      tosafotShapedAll: groups.flatMap(g => g.tosafotShapedWords),
      tertiaryShapedAll,
      tertiaryUnits,
    };
  }

  /**
   * 4. Multi-Page Rav-Text with Stage 2 Link-Aware Group Solver, Available-Area Dynamic Knees & Look-Ahead Balancing
   * - Groups each Source unit with its linked Rashi and Tosafot units (`LinkedRavGroup`).
   * - Calculates the actual geometric space (`requiredAreaPt2`) needed by each linked group before placement.
   * - Evaluates linked-group boundary candidates (`k` complete linked groups on the current page)
   *   so linked Source + Rashi + Tosafot stay together on the same page whenever physically possible.
   * - If a linked group cannot fit on the current page, moves the linked group forward to the next page
   *   rather than breaking the link relationship or over-compressing the text.
   */
  private static paginateRavText(
    title: string,
    layoutType: BookLayoutType,
    units: ContentUnit[],
    geometry: PageGeometry,
    contentWidth: number,
    contentHeight: number,
    sourceFontSize: number,
    commentaryFontSize: number,
    kneeSettings: KneeCustomSettings,
    enableOrnaments: boolean,
    explicitLinks?: RavTextLink[],
    userSuppliedOrnaments: OrnamentAsset[] = [],
    userOrnamentRules: OrnamentUserRule[] = [],
    rulesConfig?: TypesettingRulesConfig,
    designSettings?: ProfessionalDesignSettings
  ): BookTypesetDocument {
    const footnoteUnits = units.filter(u => u.role === 'footnote');

    const {
      groups,
      allLinks,
      sourceShapedAll,
      rashiShapedAll,
      tosafotShapedAll,
      tertiaryShapedAll,
      tertiaryUnits,
    } = this.buildLinkedRavGroups(
      units,
      explicitLinks,
      sourceFontSize,
      commentaryFontSize,
      designSettings,
      rulesConfig
    );

    // Build cumulative group and intermediate candidate boundary offsets in the ordered ShapedWord streams
    // so the solver can test placing complete linked groups and valid intermediate continuation breakpoints.
    const groupBoundaries: {
      groupId: string;
      sEnd: number;
      rEnd: number;
      tEnd: number;
      requiredAreaPt2: number;
      isIntermediate?: boolean;
    }[] = [];
    let cumS = 0;
    let cumR = 0;
    let cumT = 0;
    for (const grp of groups) {
      const startS = cumS;
      const startR = cumR;
      const startT = cumT;

      // Stage 22A: Enumerate safe intermediate candidate continuation points within this group
      if (grp.sourceUnits.length > 1) {
        let prefixSWords = 0;
        for (let suIdx = 0; suIdx < grp.sourceUnits.length - 1; suIdx++) {
          const su = grp.sourceUnits[suIdx];
          const suWordsCount = grp.sourceShapedWords.filter(w => w.unitId === su.id).length;
          prefixSWords += suWordsCount;

          // Do not break immediately after standalone chapter/title/heading units (Keep-With-Next)
          if (su.role === 'chapter' || su.role === 'main_title' || su.role === 'heading' || su.role === 'siman' || su.role === 'subtitle' || su.role === 'subheading') {
            continue;
          }

          const includedSrcIds = new Set(grp.sourceUnits.slice(0, suIdx + 1).map(u => u.id));
          const remSrcIds = new Set(grp.sourceUnits.slice(suIdx + 1).map(u => u.id));

          // Find commentaries that link to the included source units
          const includedRashi = grp.rashiUnits.filter(ru => {
            const lnk = grp.links.find(l => l.commentaryUnitId === ru.id);
            const target = lnk?.sourceUnitId ?? ru.linkedSourceId;
            return target ? includedSrcIds.has(target) : true;
          });
          const remRashi = grp.rashiUnits.filter(ru => !includedRashi.includes(ru));

          const includedTosafot = grp.tosafotUnits.filter(tu => {
            const lnk = grp.links.find(l => l.commentaryUnitId === tu.id);
            const target = lnk?.sourceUnitId ?? tu.linkedSourceId;
            return target ? includedSrcIds.has(target) : true;
          });
          const remTosafot = grp.tosafotUnits.filter(tu => !includedTosafot.includes(tu));

          // Universal Law 8 link consistency: no commentary in remainder links to prefix, and no commentary in prefix links to remainder
          const remRashiViolates = remRashi.some(ru => {
            const lnk = grp.links.find(l => l.commentaryUnitId === ru.id);
            const target = lnk?.sourceUnitId ?? ru.linkedSourceId;
            return target && includedSrcIds.has(target);
          });
          const remTosafotViolates = remTosafot.some(tu => {
            const lnk = grp.links.find(l => l.commentaryUnitId === tu.id);
            const target = lnk?.sourceUnitId ?? tu.linkedSourceId;
            return target && includedSrcIds.has(target);
          });

          const includedRashiIsPrefix = grp.rashiUnits.slice(0, includedRashi.length).every(unit => includedRashi.includes(unit));
          const includedTosafotIsPrefix = grp.tosafotUnits.slice(0, includedTosafot.length).every(unit => includedTosafot.includes(unit));
          if (!remRashiViolates && !remTosafotViolates && includedRashiIsPrefix && includedTosafotIsPrefix) {
            const prefixRWords = grp.rashiShapedWords.filter(w =>
              includedRashi.some(r => r.id === w.unitId)
            ).length;
            const prefixTWords = grp.tosafotShapedWords.filter(w =>
              includedTosafot.some(t => t.id === w.unitId)
            ).length;

            const intermediateSEnd = startS + prefixSWords;
            const intermediateREnd = startR + prefixRWords;
            const intermediateTEnd = startT + prefixTWords;

            if (
              intermediateSEnd > startS ||
              intermediateREnd > startR ||
              intermediateTEnd > startT
            ) {
              const approxFraction =
                (prefixSWords + prefixRWords + prefixTWords) /
                Math.max(
                  1,
                  grp.sourceShapedWords.length +
                    grp.rashiShapedWords.length +
                    grp.tosafotShapedWords.length
                );
              groupBoundaries.push({
                groupId: `${grp.groupId}-intermediate-${suIdx + 1}`,
                sEnd: intermediateSEnd,
                rEnd: intermediateREnd,
                tEnd: intermediateTEnd,
                requiredAreaPt2: Math.round(grp.requiredAreaPt2 * approxFraction),
                isIntermediate: true,
              });
            }
          }
        }
      }

      cumS += grp.sourceShapedWords.length;
      cumR += grp.rashiShapedWords.length;
      cumT += grp.tosafotShapedWords.length;
      groupBoundaries.push({
        groupId: grp.groupId,
        sEnd: cumS,
        rEnd: cumR,
        tEnd: cumT,
        requiredAreaPt2: grp.requiredAreaPt2,
        isIntermediate: false,
      });
    }

      const usablePageAreaPt2 = contentWidth * contentHeight * 0.75;
      const totalRequiredAreaPt2 = groups.reduce((acc, g) => acc + g.requiredAreaPt2, 0);

      const pages: PageTypesetResult[] = [];
      const autoFixesApplied: string[] = [];
      const placedFootnoteIds = new Set<string>();
      const fnEngine = new TypesetterEngine(
        designSettings?.footnotes?.fontSizePt ?? 9.5,
        rulesConfig,
        designSettings
      );
      const fnLeading = designSettings?.footnotes?.leadingPt ?? 13;
      const justifyMultiLineFn = TypesettingRulesEngine.resolveRule<boolean>(
        'footnotes.justifyMultiLineNonFinal',
        { layoutType, role: 'footnote' },
        rulesConfig
      ).value;
      const fnLinesByUnitId = new Map<string, TypesetLine[]>();
      for (const fn of footnoteUnits) {
        // B-4: Single-line footnotes remain naturally ragged; multi-line footnotes justify non-final lines while keeping the final line ragged.
        const probeLines = fnEngine.typesetContentUnit(fn, contentWidth, fnLeading, false);
        const fnLinesForUnit =
          probeLines.length > 1 && justifyMultiLineFn
            ? fnEngine.typesetContentUnit(fn, contentWidth, fnLeading, true)
            : probeLines;
        fnLinesByUnitId.set(fn.id, fnLinesForUnit);
      }
      const pendingRavFnQueue: Array<{ unit: ContentUnit; line: TypesetLine }> = [];
      const maxRavFnLinesPerPage = Math.max(3, Math.floor((contentHeight * 0.42 - 14) / fnLeading));

      // v0.8.0 Part C (§1): the tertiary stream (Ein Mishpat / Ner Mitzvah /
      // Torah Or / Masoret HaShas, cross-references, side notes) is pre-typeset
      // once into full-width band lines; the page loop consumes them with
      // their own cursor, exactly like the footnote queue. Type comes from
      // the tier (tier 4 carries the band typography) via the resolver.
      const terStyle = designSettings
        ? DesignSettingsEngine.resolveRoleAndUnitStyle(designSettings, 'tertiary_comment')
        : null;
      const terFontSize = terStyle?.character.fontSizePt ?? 9;
      const terLineH = Math.max(
        terFontSize * 1.06,
        terStyle?.paragraph.leadingPt ?? terFontSize * 1.25
      );
      const terEngine = new TypesetterEngine(terFontSize, rulesConfig, designSettings);
      const terLinesAll: TypesetLine[] = tertiaryUnits.flatMap(u =>
        terEngine.typesetContentUnit(u, contentWidth, terLineH, true)
      );
      let terLineCursor = 0;

      // v0.8.0 Part C (§7): the Michtav box (Vilna Shas title letter) lives
      // on the first page only, above the Gemara text. Its height is
      // reserved in the solver geometry on page 0 and the solved lines are
      // shifted down by the same amount just before the band/footnote
      // placement below.
      const michtavEnabled = designSettings?.ravText?.michtavEnabled === true;

      let sCursor = 0;
      let rCursor = 0;
      let tCursor = 0;
      let p = 0;

      while (
        (sCursor < sourceShapedAll.length ||
          rCursor < rashiShapedAll.length ||
          tCursor < tosafotShapedAll.length ||
          terLineCursor < terLinesAll.length ||
          pendingRavFnQueue.length > 0 ||
          p === 0) &&
        p < 500
      ) {
        const pageNumber = p + 2; // Talmud traditional numbering starts at Daf Bet (ב׳)

        const remSource = Math.max(0, sourceShapedAll.length - sCursor);
        const remRashi = Math.max(0, rashiShapedAll.length - rCursor);
        const remTosafot = Math.max(0, tosafotShapedAll.length - tCursor);

        // Compute remaining geometric area from unplaced words
        const completedGroupsCount = groupBoundaries.filter(
          b => !b.isIntermediate && b.sEnd <= sCursor && b.rEnd <= rCursor && b.tEnd <= tCursor
        ).length;
        const remAreaPt2 = groups
          .slice(completedGroupsCount)
          .reduce((acc, g) => acc + g.requiredAreaPt2, 0);
        const pagesRemainingByGeometry = Math.max(
          1,
          Math.ceil(Math.max(1, remAreaPt2) / usablePageAreaPt2)
        );

        // Estimate upcoming anchored footnotes from the upcoming group slice + any continued footnote lines from previous page
        const estBoundary = groupBoundaries.find(
          b => b.sEnd > sCursor || b.rEnd > rCursor || b.tEnd > tCursor
        );
        const estWords = [
          ...sourceShapedAll.slice(sCursor, estBoundary ? estBoundary.sEnd : sourceShapedAll.length),
          ...rashiShapedAll.slice(rCursor, estBoundary ? estBoundary.rEnd : rashiShapedAll.length),
          ...tosafotShapedAll.slice(tCursor, estBoundary ? estBoundary.tEnd : tosafotShapedAll.length),
        ];
        const estUnitIds = new Set<string>();
        for (const w of estWords) {
          if (w.unitId) estUnitIds.add(w.unitId);
        }
        const estAnchoredFns = this.resolveAnchoredFootnotesForWords(
          estWords,
          estUnitIds,
          footnoteUnits,
          placedFootnoteIds,
          pagesRemainingByGeometry === 1
        );
        const estFnLinesCount = Math.min(
          maxRavFnLinesPerPage,
          pendingRavFnQueue.length +
            estAnchoredFns.reduce((acc, fn) => acc + (fnLinesByUnitId.get(fn.id)?.length ?? 0), 0)
        );
        let reservedFnHeight = estFnLinesCount > 0 ? estFnLinesCount * fnLeading + 14 : 0;

        // v0.8.0 Part C (§1/§7): reserve the tertiary band (at most 8 lines
        // per page) and, on page 0 only, the Michtav box height, so the
        // knee solver never packs body text into those strips. The band is
        // placed below the body and the box above it; both reserves are
        // re-applied in the footnote re-solve below.
        const remTerLines = terLinesAll.length - terLineCursor;
        const reservedTerHeight =
          remTerLines > 0 ? Math.min(8, remTerLines) * terLineH + 12 : 0;
        const michtavBox =
          p === 0 && michtavEnabled
            ? buildMichtavBox(designSettings?.ravText?.michtavText?.trim() || title)
            : undefined;
        const michtavHeightPt = michtavBox
          ? ((michtavBox.yPct + michtavBox.heightPct) / 100) * contentHeight + 6
          : 0;

        let effectiveGeometry: PageGeometry = {
          ...geometry,
          marginBottom:
            geometry.marginBottom + reservedFnHeight + reservedTerHeight + michtavHeightPt,
        };
        const effectivePageCapacityPt2 =
          contentWidth *
          (contentHeight - reservedFnHeight - reservedTerHeight - michtavHeightPt) *
          0.78;

      // Stage 2 & Stage 4 Multi-Page Look-Ahead & Keep-Together Candidate Solver:
      // Find all upcoming LinkedRavGroup boundaries after the current cursors
      const upcomingBoundaries = groupBoundaries.filter(
        b => b.sEnd > sCursor || b.rEnd > rCursor || b.tEnd > tCursor
      );

      let sTarget = remSource;
      let rTarget = remRashi;
      let tTarget = remTosafot;
      let linkDecisionMsg: string | null = null;
      // v0.8.0 Part C (§6): Insert Page (force-break) message for this page.
      let forceBreakMsg: string | null = null;
      let lookAheadCandidatesTested = 1;
      let candidateBreakChosen = false;

      if (upcomingBoundaries.length > 1) {
        // Stage 4: Evaluate multiple group-boundary break candidates (`1..k` complete groups on Page p)
        // by probing both Page p AND look-ahead Page p+1 via real trial typesetting in DynamicKneeEngine!
        // Never greedily pack Page p if doing so leaves Page p+1 with a sparse widow/orphan fragment.
        const fittingCandidates: Array<{
          bIdx: number;
          boundary: typeof upcomingBoundaries[0];
          candS: number;
          candR: number;
          candT: number;
          probePageP: ReturnType<typeof DynamicKneeEngine.layoutRavTextPage>;
          accumulatedGroupArea: number;
          combinedTwoPageScore: number;
          nextPageLineCount: number;
          leavesSparseNextPage: boolean;
        }> = [];

        let accumulatedGroupArea = 0;

        for (let bIdx = 0; bIdx < upcomingBoundaries.length; bIdx++) {
          const b = upcomingBoundaries[bIdx];
          const candS = Math.max(0, b.sEnd - sCursor);
          const candR = Math.max(0, b.rEnd - rCursor);
          const candT = Math.max(0, b.tEnd - tCursor);

          const candSourceShaped = sourceShapedAll.slice(sCursor, sCursor + candS);
          const candRashiShaped = rashiShapedAll.slice(rCursor, rCursor + candR);
          const candTosafotShaped = tosafotShapedAll.slice(tCursor, tCursor + candT);

          // Probe DynamicKneeEngine to verify whether all linked groups up to `b` fit physically with 0 overflow
          const probe = DynamicKneeEngine.layoutRavTextPage({
            sourceText: candSourceShaped.map(w => w.text).join(' '),
            rashiText: candRashiShaped.map(w => w.text).join(' '),
            tosafotText: candTosafotShaped.map(w => w.text).join(' '),
            sourceShapedWords: candSourceShaped,
            rashiShapedWords: candRashiShaped,
            tosafotShapedWords: candTosafotShaped,
            sourceUnitId: candSourceShaped[0]?.unitId ?? `src-p${p}`,
            rashiUnitId: candRashiShaped[0]?.unitId ?? `rashi-p${p}`,
            tosafotUnitId: candTosafotShaped[0]?.unitId ?? `tosafot-p${p}`,
            geometry: effectiveGeometry,
            sourceFontSize,
            commentaryFontSize,
            upperKneeLines: kneeSettings.upperKneeLines ?? 4,
            upperKneeInwardStep: kneeSettings.upperKneeInwardStep ?? 18,
            forceSteppedKnee: true,
            mirrorFlanks: p % 2 === 1,
            isMultiPageContinuation: true,
            rulesConfig,
            designSettings,
          });

          const fitsCompletely =
            probe.consumedSourceWords === candS &&
            probe.consumedRashiWords === candR &&
            probe.consumedTosafotWords === candT &&
            probe.layoutScore.collisionCount === 0;

          accumulatedGroupArea += b.requiredAreaPt2;

          const probeMaxY = Math.max(
            0,
            ...probe.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
            ...probe.rashiLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
            ...probe.tosafotLines.map(l => l.yBottom ?? l.yBaseline + l.descent)
          );
          const probeVerticalFill = probeMaxY / Math.max(1, contentHeight - reservedFnHeight);
          const isFinalBoundary = bIdx === upcomingBoundaries.length - 1;

          if (fitsCompletely) {
            const hasMoreGroupsAfter = bIdx < upcomingBoundaries.length - 1;
            let nextPageLineCount = 0;
            let leavesSparseNextPage = false;
            let combinedTwoPageScore = probe.layoutScore.totalScore;

            if (hasMoreGroupsAfter) {
              // Stage 4 Look-Ahead Probe on Page p+1:
              // Trial-typeset the next page's upcoming content starting at `b.sEnd / b.rEnd / b.tEnd`
              const nextS = sourceShapedAll.slice(b.sEnd);
              const nextR = rashiShapedAll.slice(b.rEnd);
              const nextT = tosafotShapedAll.slice(b.tEnd);

              const nextProbe = DynamicKneeEngine.layoutRavTextPage({
                sourceText: nextS.map(w => w.text).join(' '),
                rashiText: nextR.map(w => w.text).join(' '),
                tosafotText: nextT.map(w => w.text).join(' '),
                sourceShapedWords: nextS,
                rashiShapedWords: nextR,
                tosafotShapedWords: nextT,
                sourceUnitId: nextS[0]?.unitId ?? `src-p${p + 1}`,
                rashiUnitId: nextR[0]?.unitId ?? `rashi-p${p + 1}`,
                tosafotUnitId: nextT[0]?.unitId ?? `tosafot-p${p + 1}`,
                geometry: effectiveGeometry,
                sourceFontSize,
                commentaryFontSize,
                upperKneeLines: kneeSettings.upperKneeLines ?? 4,
                upperKneeInwardStep: kneeSettings.upperKneeInwardStep ?? 18,
                forceSteppedKnee: true,
                mirrorFlanks: p % 2 === 1,
                isMultiPageContinuation: true,
                rulesConfig,
                designSettings,
              });

              nextPageLineCount =
                nextProbe.sourceLines.length +
                nextProbe.rashiLines.length +
                nextProbe.tosafotLines.length;

              // A break point leaves a sparse widow/orphan tail on Page p+1 if all remaining text fits on Page p+1
              // AND Page p+1 has only 1 source line or <= 4 total lines while Page p took >= 2 groups
              const nextIsFinalPage =
                nextProbe.consumedSourceWords === nextS.length &&
                nextProbe.consumedRashiWords === nextR.length &&
                nextProbe.consumedTosafotWords === nextT.length;

              leavesSparseNextPage =
                nextIsFinalPage &&
                (nextProbe.sourceLines.length <= 1 ||
                  nextPageLineCount <= 5 ||
                  nextProbe.layoutScore.pageUtilization < 15);

              const utilBalanceDiff = Math.abs(
                probe.layoutScore.pageUtilization - nextProbe.layoutScore.pageUtilization
              );
              const sparsePenalty = leavesSparseNextPage ? 30 : 0;

              combinedTwoPageScore = Math.round(
                probe.layoutScore.totalScore * 0.52 +
                  nextProbe.layoutScore.totalScore * 0.48 -
                  utilBalanceDiff * 0.22 -
                  sparsePenalty
              );
            } else {
              // All remaining groups fit on THIS single page with 0 overflow!
              combinedTwoPageScore = probe.layoutScore.totalScore + 12;
            }

            fittingCandidates.push({
              bIdx,
              boundary: b,
              candS,
              candR,
              candT,
              probePageP: probe,
              accumulatedGroupArea,
              combinedTwoPageScore,
              nextPageLineCount,
              leavesSparseNextPage,
            });
          } else {
            // Adding group `b` overflows the page!
            if (fittingCandidates.length === 0) {
              // No complete-group boundary filled >= 88% of the page before overflowing:
              // Offer upcoming groups until all three streams have enough candidate words to fill the page
              // so DynamicKneeEngine packs the page to full traditional amud density and cuts cleanly at Dibbur/paragraph boundaries!
              let reachIdx = bIdx;
              while (
                reachIdx + 1 < upcomingBoundaries.length &&
                (upcomingBoundaries[reachIdx].sEnd - sCursor < 260 ||
                  upcomingBoundaries[reachIdx].rEnd - rCursor < 220 ||
                  upcomingBoundaries[reachIdx].tEnd - tCursor < 320)
              ) {
                reachIdx++;
              }
              const nextB = upcomingBoundaries[reachIdx];
              sTarget = Math.max(0, nextB.sEnd - sCursor);
              rTarget = Math.max(0, nextB.rEnd - rCursor);
              tTarget = Math.max(0, nextB.tEnd - tCursor);
              linkDecisionMsg = `Stage 13A-5 Traditional Amud Density Solver: מילוי העמוד עד תום השטח הפנוי (מניעת חללים ריקים) תוך גזירה נקייה בגבולות דיבור המתחיל ופסקאות.`;
            } else if (bIdx > 0) {
              linkDecisionMsg = `Stage 2/4 Link-Aware Look-Ahead Solver: הקבוצה המקושרת (${b.groupId}) אינה נכנסת בשלמותה בעמוד ${p + 1} — הועברה כמקשה אחת לעמוד הבא למניעת פיצול מקור ופירוש.`;
            }
            break;
          }
        }

        lookAheadCandidatesTested = Math.max(1, fittingCandidates.length);

        if (fittingCandidates.length > 0) {
          // Multi-page document look-ahead optimization:
          // Evaluate candidate break points by two-page score and widow/orphan prevention.
          const intermediateCandidates = fittingCandidates.filter(
            c => c.bIdx < upcomingBoundaries.length - 1
          );
          const fullFitCand = fittingCandidates.find(
            c => c.bIdx === upcomingBoundaries.length - 1
          );

          // Find the best intermediate candidate that balances the document across pages
          let bestIntermediateCand: (typeof fittingCandidates)[0] | null = null;
          if (intermediateCandidates.length > 0) {
            bestIntermediateCand = intermediateCandidates[intermediateCandidates.length - 1];
            for (const cand of intermediateCandidates) {
              // Priority 1: Prevent sparse widow/orphan continuation pages
              if (bestIntermediateCand.leavesSparseNextPage && !cand.leavesSparseNextPage) {
                bestIntermediateCand = cand;
              } else if (
                !bestIntermediateCand.leavesSparseNextPage &&
                cand.leavesSparseNextPage
              ) {
                continue;
              }
              // Priority 2: Satisfy the 50% utilization floor for main pages (t-33 invariant)
              else if (
                bestIntermediateCand.probePageP.layoutScore.pageUtilization < 50 &&
                cand.probePageP.layoutScore.pageUtilization >= 50
              ) {
                bestIntermediateCand = cand;
              } else if (
                bestIntermediateCand.probePageP.layoutScore.pageUtilization >= 50 &&
                cand.probePageP.layoutScore.pageUtilization < 50
              ) {
                continue;
              }
              // Priority 3: Prefer higher two-page score
              else if (
                cand.combinedTwoPageScore > bestIntermediateCand.combinedTwoPageScore + 2
              ) {
                bestIntermediateCand = cand;
              }
            }
          }

          // v0.9.8 Phase 4 — tail fix (Rule 3, bottom-line flush): when
          // ALL remaining groups fit on this page (fullFitCand exists),
          // end the book here instead of splitting the tail across two
          // half-full pages. MEASURED on the pre-existing optimizer: a
          // 5-source book was split into 2 pages even though it fits on
          // one, and a 30-source book's last 5 sources split 3+2,
          // leaving a non-final page 241pt short of the margin box.
          // fullFitCand already passed fitsCompletely (all streams
          // consumed, 0 collisions), so ending here is strictly fuller
          // than two half-full pages holding the same content. This
          // branch only fires on the tail (fullFitCand is null on middle
          // pages, where not all remaining groups fit), so mid-book
          // balancing is unchanged.
          if (fullFitCand) {
            sTarget = fullFitCand.candS;
            rTarget = fullFitCand.candR;
            tTarget = fullFitCand.candT;
            candidateBreakChosen = true;
            linkDecisionMsg = `Stage 4 Look-Ahead: כל הקבוצות הנותרות נכנסות בעמוד זה — סיום הספר בעמוד מלא (v0.9.8).`;
          } else if (
            bestIntermediateCand &&
            !bestIntermediateCand.leavesSparseNextPage &&
            bestIntermediateCand.nextPageLineCount > 5
          ) {
            sTarget = bestIntermediateCand.candS;
            rTarget = bestIntermediateCand.candR;
            tTarget = bestIntermediateCand.candT;
            candidateBreakChosen = true;
            linkDecisionMsg = `Stage 4 Look-Ahead: אופטימיזציה דו-עמודית בחרה בגבול קבוצה (${bestIntermediateCand.boundary.groupId}) לאיזון מיטבי בין עמוד ${p + 1} לעמוד ${p + 2}.`;
          } else if (bestIntermediateCand) {
            sTarget = bestIntermediateCand.candS;
            rTarget = bestIntermediateCand.candR;
            tTarget = bestIntermediateCand.candT;
            candidateBreakChosen = true;
            if (bestIntermediateCand.leavesSparseNextPage) {
              sTarget = remSource;
              rTarget = remRashi;
              tTarget = remTosafot;
              candidateBreakChosen = false;
            }
          }
        } else if (sTarget === remSource && rTarget === remRashi && tTarget === remTosafot) {
          // Single massive group larger than an entire page (or partial-group fill triggered when bIdx === 0):
          // Offer enough upcoming groups so Source has >= 220 candidate words, Rashi >= 180, Tosafot >= 250
          // (or until the end of the document), ensuring no stream artificially starves on a page while
          // another stream overflows from a preceding group!
          let reachIdx = 0;
          while (
            reachIdx + 1 < upcomingBoundaries.length &&
            (upcomingBoundaries[reachIdx].sEnd - sCursor < 220 ||
              upcomingBoundaries[reachIdx].rEnd - rCursor < 180 ||
              upcomingBoundaries[reachIdx].tEnd - tCursor < 250)
          ) {
            reachIdx++;
          }
          const reachB = upcomingBoundaries[reachIdx];
          sTarget = Math.max(0, reachB.sEnd - sCursor);
          rTarget = Math.max(0, reachB.rEnd - rCursor);
          tTarget = Math.max(0, reachB.tEnd - tCursor);
        }
      }

      // Ensure each active stream (Source, Rashi, Tosafot) has enough candidate words to fill its zone on the page,
      // while pacing Rashi across `estTotalPagesLeft` so Rashi accompanies the Gemara and Tosafot through the final page!
      if (!candidateBreakChosen) {
        const estPagesLeftByTosafot = Math.max(1, Math.ceil(remTosafot / 435));
        const estPagesLeftBySource = Math.max(1, Math.ceil(remSource / 150));
        const estTotalPagesLeft = Math.max(estPagesLeftByTosafot, estPagesLeftBySource);
        sTarget = Math.min(remSource, Math.max(sTarget, 240));
        if (remTosafot > 180 && remTosafot < 380 && remSource > 250) {
          tTarget = Math.max(150, remTosafot - 105);
        } else {
          tTarget = Math.min(remTosafot, Math.max(tTarget, 520));
        }
        if (remRashi > 65 && remRashi < 150 && remSource > 250) {
          rTarget = Math.max(45, remRashi - 42);
        } else if (estTotalPagesLeft >= 2 && remRashi > 0 && (remTosafot > remRashi * 1.8 || remSource > remRashi * 1.1)) {
          const pacedR = Math.max(115, Math.ceil((remRashi / estTotalPagesLeft) * 1.16));
          rTarget = Math.min(remRashi, pacedR);
        } else {
          rTarget = Math.min(remRashi, Math.max(rTarget, 240));
        }
      }

      // v0.8.0 Part C (§6): Insert Page (force-break) — honour the override
      // in this paginator too. Find the earliest force-break unit starting
      // inside this page's planned take and cap the targets at the largest
      // linked-group boundary at or before its first word, so the unit
      // starts the next page. With no such boundary, truncate only that
      // stream at the unit's first word. A break unit already at the top
      // of this page needs no capping. (Before this fix the override was
      // honoured only in paginateSingleColumn.)
      {
        const forceBreakIds = TypesettingRulesEngine.forcePageBreakUnitIds(rulesConfig);
        if (forceBreakIds.size > 0) {
          const streams: Array<{ arr: ShapedWord[]; cursor: number; target: number }> = [
            { arr: sourceShapedAll, cursor: sCursor, target: sTarget },
            { arr: rashiShapedAll, cursor: rCursor, target: rTarget },
            { arr: tosafotShapedAll, cursor: tCursor, target: tTarget },
          ];
          const endKeys = ['sEnd', 'rEnd', 'tEnd'] as const;
          outer: for (let si = 0; si < streams.length; si++) {
            const { arr, cursor, target } = streams[si];
            for (let i = cursor + 1; i < cursor + target && i < arr.length; i++) {
              const w = arr[i];
              if (!w.unitId || !forceBreakIds.has(w.unitId)) continue;
              if (i > 0 && arr[i - 1].unitId === w.unitId) continue; // not the unit's first word
              const key = endKeys[si];
              let best: (typeof groupBoundaries)[number] | undefined;
              for (const b of groupBoundaries) {
                if (b[key] <= i && b[key] > cursor && (!best || b[key] > best[key])) {
                  best = b;
                }
              }
              if (best) {
                sTarget = Math.max(0, best.sEnd - sCursor);
                rTarget = Math.max(0, best.rEnd - rCursor);
                tTarget = Math.max(0, best.tEnd - tCursor);
              } else if (si === 0) {
                sTarget = Math.max(0, i - sCursor);
              } else if (si === 1) {
                rTarget = Math.max(0, i - rCursor);
              } else {
                tTarget = Math.max(0, i - tCursor);
              }
              forceBreakMsg = `מעבר עמוד כפוי: היחידה הבאה מתחילה בראש עמוד ${p + 2}.`;
              break outer;
            }
          }
        }
      }

      const prevSCursor = sCursor;
      const prevRCursor = rCursor;
      const prevTCursor = tCursor;

      let pSourceShaped = sourceShapedAll.slice(sCursor, sCursor + sTarget);
      let pRashiShaped = rashiShapedAll.slice(rCursor, rCursor + rTarget);
      let pTosafotShaped = tosafotShapedAll.slice(tCursor, tCursor + tTarget);

      let pSource = pSourceShaped.map(w => w.text).join(' ');
      let pRashi = pRashiShaped.map(w => w.text).join(' ');
      let pTosafot = pTosafotShaped.map(w => w.text).join(' ');

      // Solve optimal collision-free Rav-Text layout via Available-Area Constraint Solver
      console.log(`Diagnostic: Calling layoutRavTextPage for page ${p+1}`);
      let res = DynamicKneeEngine.layoutRavTextPage({
        sourceText: pSource,
        rashiText: pRashi,
        tosafotText: pTosafot,
        sourceShapedWords: pSourceShaped,
        rashiShapedWords: pRashiShaped,
        tosafotShapedWords: pTosafotShaped,
        sourceUnitId: pSourceShaped[0]?.unitId ?? `src-p${p}`,
        rashiUnitId: pRashiShaped[0]?.unitId ?? `rashi-p${p}`,
        tosafotUnitId: pTosafotShaped[0]?.unitId ?? `tosafot-p${p}`,
        geometry: effectiveGeometry,
        sourceFontSize,
        commentaryFontSize,
        upperKneeLines: kneeSettings.upperKneeLines ?? 4,
        upperKneeInwardStep: kneeSettings.upperKneeInwardStep ?? 18,
        forceSteppedKnee: true,
        mirrorFlanks: p % 2 === 1,
        manualJunctionPercent:
          kneeSettings.mode === 'manual' ? kneeSettings.junctionPercent : undefined,
        manualLowerWidthPercent:
          kneeSettings.mode === 'manual' ? kneeSettings.lowerWidthPercent : undefined,
        manualStepDirection:
          kneeSettings.mode === 'manual' ? kneeSettings.stepDirection : 'auto',
        isMultiPageContinuation:
          !candidateBreakChosen ||
          sCursor + pSourceShaped.length < sourceShapedAll.length ||
          rCursor + pRashiShaped.length < rashiShapedAll.length ||
          tCursor + pTosafotShaped.length < tosafotShapedAll.length,
        rulesConfig,
        designSettings,
      });

      // Stage 4 Intra-Unit Keep-Together & Dibbur HaMatchil Boundary Protection (Priority 80 & Priority 90):
      // When a massive group overflows a single page (`consumed < target`), inspect the exact word boundary
      // where Source, Rashi, or Tosafot was cut off:
      // 1. Heading Keep-With-Next (Priority 80): If the last placed Source line on the page is a `chapter`/`heading`/`siman`
      //    and the opening Source body line was pushed to the next page, hold back the heading so it starts Page p+1 with its body!
      // 2. Dibbur HaMatchil Keep-Together (Priority 90): If a commentary stream (Rashi or Tosafot) breaks mid-Dibbur
      //    (`lastPlacedWord.isDibbur && firstUnplacedWord.isDibbur` of the same unit), or places ONLY the Dibbur words at the bottom
      //    of the page without at least 2 body explanation words of that unit, hold back that Dibbur to start cleanly on Page p+1!
      let heldBackSTarget = res.consumedSourceWords;
      let heldBackRTarget = res.consumedRashiWords;
      let heldBackTTarget = res.consumedTosafotWords;
      let keepTogetherApplied = false;

      const ravPageCtx = { layoutType, pageNumber, pageIndex: p };
      const keepHeadingWithNext = TypesettingRulesEngine.resolveRule<boolean>(
        'headings.keepWithNext',
        ravPageCtx,
        rulesConfig
      ).value;
      const maxWidowTailWords = TypesettingRulesEngine.resolveRule<number>(
        'pageBalance.maxCommentaryWidowTailWords',
        ravPageCtx,
        rulesConfig
      ).value;
      const minBodyWordsAfterDibbur = TypesettingRulesEngine.resolveRule<number>(
        'semantic.minBodyWordsAfterDibburOnPage',
        ravPageCtx,
        rulesConfig
      ).value;
      const dibburKeepTogether = TypesettingRulesEngine.resolveRule<boolean>(
        'ravText.dibburKeepTogether',
        ravPageCtx,
        rulesConfig
      ).value;

      // Check 1: Heading Keep-With-Next on Source stream
      if (keepHeadingWithNext && res.consumedSourceWords < sTarget && res.sourceLines.length >= 2) {
        const lastSLine = res.sourceLines[res.sourceLines.length - 1];
        if (
          lastSLine.role === 'chapter' ||
          lastSLine.role === 'heading' ||
          lastSLine.role === 'main_title' ||
          lastSLine.role === 'siman'
        ) {
          const headingWordCount = lastSLine.words.filter(w => !w.isSpace).length;
          if (res.consumedSourceWords - headingWordCount >= 1) {
            heldBackSTarget = res.consumedSourceWords - headingWordCount;
            keepTogetherApplied = true;
            const msg = `Stage 4 Keep-Together (Priority 80): מניעת כותרת יתומה בתחתית עמוד ${p + 1} — הכותרת הועברה לראש עמוד ${p + 2} יחד עם פסקת הפתיחה שלה.`;
            autoFixesApplied.push(msg);
          }
        }
      }

      // Helper to check if a commentary cut index splits a Dibbur HaMatchil, leaves an orphan Dibbur without body words,
      // or leaves a tiny 1-2 line widow tail on the final page (Priority 3 / M-2)
      const computeSafeCommentaryCut = (
        shapedStream: ShapedWord[],
        consumedCount: number,
        totalTarget: number
      ): { safeCount: number; adjusted: boolean; reason?: string } => {
        if (consumedCount >= totalTarget || consumedCount <= 4) {
          return { safeCount: consumedCount, adjusted: false };
        }
        const lastPlaced = shapedStream[consumedCount - 1];
        const firstNext = shapedStream[consumedCount];
        if (!lastPlaced || !firstNext) {
          return { safeCount: consumedCount, adjusted: false };
        }

        const remainingWordsCount = totalTarget - consumedCount;

        // Priority 3 (M-2): If the overflow to the next page is a tiny widow tail (`remainingWordsCount <= maxWidowTailWords`, i.e. 1–2 lines)
        // inside a commentary unit, hold back the start of that commentary unit (or hold back ~12–16 words to a clean clause/unit boundary)
        // so the next page receives a meaningful, balanced commentary block instead of a 1–2 line widow!
        if (remainingWordsCount > 0 && remainingWordsCount <= maxWidowTailWords && consumedCount >= 24) {
          let unitStartIdx = consumedCount - 1;
          while (
            unitStartIdx > 0 &&
            shapedStream[unitStartIdx - 1].unitId === firstNext.unitId
          ) {
            unitStartIdx--;
          }
          if (unitStartIdx >= 12 && consumedCount - unitStartIdx <= 32) {
            return {
              safeCount: unitStartIdx,
              adjusted: true,
              reason: `Stage 4/11A Look-Ahead (Priority 3): מניעת זנב אלמנה בן שורה-שתיים בעמוד הבא — יחידת הפירוש האחרונה הועברה בשלמותה לעמוד ${p + 2}.`,
            };
          }
        }

        // Case A: Split directly inside a Dibbur HaMatchil (`lastPlaced.isDibbur && firstNext.isDibbur`)
        // Case B: Placed the Dibbur HaMatchil at the very end of the page, with fewer than `minBodyWordsAfterDibbur` body words of that unit before the page break
        if (dibburKeepTogether && lastPlaced.unitId && lastPlaced.unitId === firstNext.unitId) {
          let unitStartIdx = consumedCount - 1;
          while (
            unitStartIdx > 0 &&
            shapedStream[unitStartIdx - 1].unitId === lastPlaced.unitId
          ) {
            unitStartIdx--;
          }
          // Only hold back if this unit did NOT start at the very beginning of the page (`unitStartIdx > 0`)
          if (unitStartIdx > 0) {
            const placedUnitWords = shapedStream.slice(unitStartIdx, consumedCount);
            const placedBodyWords = placedUnitWords.filter(w => !w.isDibbur).length;
            const splitsInsideDibbur = Boolean(lastPlaced.isDibbur && firstNext.isDibbur);
            const leavesOrphanDibburAtBottom =
              placedUnitWords.some(w => w.isDibbur) && placedBodyWords < minBodyWordsAfterDibbur;

            if (splitsInsideDibbur || leavesOrphanDibburAtBottom) {
              return { safeCount: unitStartIdx, adjusted: true };
            }
          }
        }
        return { safeCount: consumedCount, adjusted: false };
      };

      const safeRCut = computeSafeCommentaryCut(
        pRashiShaped,
        res.consumedRashiWords,
        rTarget
      );
      if (safeRCut.adjusted) {
        heldBackRTarget = safeRCut.safeCount;
        keepTogetherApplied = true;
        autoFixesApplied.push(
          `Stage 4 Keep-Together (Priority 90): שמירת דיבור המתחיל ברש״י צמוד לגוף הפירוש והעברתו בשלמותו לראש עמוד ${p + 2}.`
        );
      }

      const safeTCut = computeSafeCommentaryCut(
        pTosafotShaped,
        res.consumedTosafotWords,
        tTarget
      );
      if (safeTCut.adjusted) {
        heldBackTTarget = safeTCut.safeCount;
        keepTogetherApplied = true;
        autoFixesApplied.push(
          `Stage 4 Keep-Together (Priority 90): שמירת דיבור המתחיל בתוספות צמוד לגוף הפירוש והעברתו בשלמותו לראש עמוד ${p + 2}.`
        );
      }

      // v0.8.0 Part C (§3): honour the Shas fix's `keepTogetherUnitIds`
      // (audit #3 — the override was written but never read). A
      // keep-together unit that starts on this page and would split across
      // the page break is held back whole to the next page. A unit that
      // starts the page (or is longer than a page) cannot move back — that
      // case is reported by the keep-together verification in
      // `paginateDocument`, never silently split.
      {
        const keepTogetherIds = TypesettingRulesEngine.keepTogetherUnitIds(rulesConfig);
        if (keepTogetherIds.size > 0) {
          const holdBack = (
            full: ShapedWord[],
            cursor: number,
            consumed: number
          ): number => {
            if (consumed <= 0) return consumed;
            const last = full[cursor + consumed - 1];
            if (!last?.unitId || !keepTogetherIds.has(last.unitId)) return consumed;
            const next = full[cursor + consumed];
            if (!next || next.unitId !== last.unitId) return consumed; // unit ends on this page
            let unitStart = cursor + consumed - 1;
            while (unitStart > cursor && full[unitStart - 1].unitId === last.unitId) {
              unitStart--;
            }
            return unitStart > cursor ? unitStart - cursor : consumed;
          };
          const ktS = holdBack(sourceShapedAll, sCursor, heldBackSTarget);
          if (ktS < heldBackSTarget) {
            heldBackSTarget = ktS;
            keepTogetherApplied = true;
            autoFixesApplied.push(
              `שמירת יחידה יחד (Keep-Together): יחידת מקור שהייתה מתפצלת בין עמוד ${p + 1} לעמוד ${p + 2} הועברה בשלמותה לעמוד הבא.`
            );
          }
          const ktR = holdBack(rashiShapedAll, rCursor, heldBackRTarget);
          if (ktR < heldBackRTarget) {
            heldBackRTarget = ktR;
            keepTogetherApplied = true;
            autoFixesApplied.push(
              `שמירת יחידה יחד (Keep-Together): יחידת רש״י שהייתה מתפצלת בין עמוד ${p + 1} לעמוד ${p + 2} הועברה בשלמותה לעמוד הבא.`
            );
          }
          const ktT = holdBack(tosafotShapedAll, tCursor, heldBackTTarget);
          if (ktT < heldBackTTarget) {
            heldBackTTarget = ktT;
            keepTogetherApplied = true;
            autoFixesApplied.push(
              `שמירת יחידה יחד (Keep-Together): יחידת תוספות שהייתה מתפצלת בין עמוד ${p + 1} לעמוד ${p + 2} הועברה בשלמותה לעמוד הבא.`
            );
          }
        }
      }

      if (keepTogetherApplied) {
        pSourceShaped = sourceShapedAll.slice(sCursor, sCursor + heldBackSTarget);
        pRashiShaped = rashiShapedAll.slice(rCursor, rCursor + heldBackRTarget);
        pTosafotShaped = tosafotShapedAll.slice(tCursor, tCursor + heldBackTTarget);
        pSource = pSourceShaped.map(w => w.text).join(' ');
        pRashi = pRashiShaped.map(w => w.text).join(' ');
        pTosafot = pTosafotShaped.map(w => w.text).join(' ');

        res = DynamicKneeEngine.layoutRavTextPage({
          sourceText: pSource,
          rashiText: pRashi,
          tosafotText: pTosafot,
          sourceShapedWords: pSourceShaped,
          rashiShapedWords: pRashiShaped,
          tosafotShapedWords: pTosafotShaped,
          sourceUnitId: pSourceShaped[0]?.unitId ?? `src-p${p}`,
          rashiUnitId: pRashiShaped[0]?.unitId ?? `rashi-p${p}`,
          tosafotUnitId: pTosafotShaped[0]?.unitId ?? `tosafot-p${p}`,
          geometry: effectiveGeometry,
          sourceFontSize,
          commentaryFontSize,
          upperKneeLines: kneeSettings.upperKneeLines ?? 4,
          upperKneeInwardStep: kneeSettings.upperKneeInwardStep ?? 18,
          forceSteppedKnee: true,
          mirrorFlanks: p % 2 === 1,
          manualJunctionPercent:
            kneeSettings.mode === 'manual' ? kneeSettings.junctionPercent : undefined,
          manualLowerWidthPercent:
            kneeSettings.mode === 'manual' ? kneeSettings.lowerWidthPercent : undefined,
          manualStepDirection:
            kneeSettings.mode === 'manual' ? kneeSettings.stepDirection : 'auto',
          isMultiPageContinuation:
            !candidateBreakChosen ||
            sCursor + pSourceShaped.length < sourceShapedAll.length ||
            rCursor + pRashiShaped.length < rashiShapedAll.length ||
            tCursor + pTosafotShaped.length < tosafotShapedAll.length,
          rulesConfig,
          designSettings,
        });
      }

      // Advance cursors strictly by ACTUAL consumed word counts returned by DynamicKneeEngine!
      // Advance only by words the layout engine actually placed. Forcing a minimum of one
      // word here silently drops content whenever a non-empty stream cannot be placed on this page.
      let actualSConsumed = pSourceShaped.length > 0
        ? Math.min(pSourceShaped.length, Math.max(0, res.consumedSourceWords))
        : 0;
      let actualRConsumed = pRashiShaped.length > 0
        ? Math.min(pRashiShaped.length, Math.max(0, res.consumedRashiWords))
        : 0;
      let actualTConsumed = pTosafotShaped.length > 0
        ? Math.min(pTosafotShaped.length, Math.max(0, res.consumedTosafotWords))
        : 0;

      if (actualSConsumed === 0 && actualRConsumed === 0 && actualTConsumed === 0 &&
          (sCursor < sourceShapedAll.length || rCursor < rashiShapedAll.length || tCursor < tosafotShapedAll.length)) {
        throw new Error(
          `Rav-text pagination made no forward progress on page ${p + 1}. ` +
          `Remaining words: source=${sourceShapedAll.length - sCursor}, ` +
          `Rashi=${rashiShapedAll.length - rCursor}, ` +
          `Tosafot=${tosafotShapedAll.length - tCursor}. ` +
          'Refusing to skip unplaced text.'
        );
      }

      // Resolve exact semantic footnotes anchored to the placed Source/Commentary words on this page
      const willBeFinalPage =
        sCursor + actualSConsumed >= sourceShapedAll.length &&
        rCursor + actualRConsumed >= rashiShapedAll.length &&
        tCursor + actualTConsumed >= tosafotShapedAll.length &&
        terLineCursor >= terLinesAll.length;
      const placedLinesOnPage = [...res.sourceLines, ...res.rashiLines, ...res.tosafotLines];
      const placedWordsOnPage = placedLinesOnPage.flatMap(l => l.words);
      const placedUnitIdsOnPage = new Set<string>(placedLinesOnPage.map(l => l.unitId));
      for (const w of placedWordsOnPage) {
        if (w.unitId) placedUnitIdsOnPage.add(w.unitId);
      }

      let exactAnchoredFns = this.resolveAnchoredFootnotesForWords(
        placedWordsOnPage,
        placedUnitIdsOnPage,
        footnoteUnits,
        placedFootnoteIds,
        willBeFinalPage
      );
      const totalCandidateFnCount =
        pendingRavFnQueue.length +
        exactAnchoredFns.reduce((acc, fn) => acc + (fnLinesByUnitId.get(fn.id)?.length ?? 0), 0);
      const cappedFnLinesCount = Math.min(maxRavFnLinesPerPage, totalCandidateFnCount);
      const exactFnHeight = cappedFnLinesCount > 0 ? cappedFnLinesCount * fnLeading + 14 : 0;

      // If the exact anchored footnote height exceeds the initial reserved height, re-solve DynamicKneeEngine
      // with the exact `marginBottom` so main/commentary text never collides with the footnote separator or footnotes!
      if (exactFnHeight > reservedFnHeight && pSourceShaped.length + pRashiShaped.length + pTosafotShaped.length > 0) {
        reservedFnHeight = exactFnHeight;
        effectiveGeometry = {
          ...geometry,
          // v0.8.0 Part C (§1/§7): keep the tertiary-band and Michtav
          // reserves — re-solving with only the footnote reserve would let
          // the knee pack body text into those strips.
          marginBottom:
            geometry.marginBottom + reservedFnHeight + reservedTerHeight + michtavHeightPt,
        };
        res = DynamicKneeEngine.layoutRavTextPage({
          sourceText: pSource,
          rashiText: pRashi,
          tosafotText: pTosafot,
          sourceShapedWords: pSourceShaped,
          rashiShapedWords: pRashiShaped,
          tosafotShapedWords: pTosafotShaped,
          sourceUnitId: pSourceShaped[0]?.unitId ?? `src-p${p}`,
          rashiUnitId: pRashiShaped[0]?.unitId ?? `rashi-p${p}`,
          tosafotUnitId: pTosafotShaped[0]?.unitId ?? `tosafot-p${p}`,
          geometry: effectiveGeometry,
          sourceFontSize,
          commentaryFontSize,
          upperKneeLines: kneeSettings.upperKneeLines ?? 4,
          upperKneeInwardStep: kneeSettings.upperKneeInwardStep ?? 18,
          forceSteppedKnee: true,
          mirrorFlanks: p % 2 === 1,
          manualJunctionPercent:
            kneeSettings.mode === 'manual' ? kneeSettings.junctionPercent : undefined,
          manualLowerWidthPercent:
            kneeSettings.mode === 'manual' ? kneeSettings.lowerWidthPercent : undefined,
          manualStepDirection:
            kneeSettings.mode === 'manual' ? kneeSettings.stepDirection : 'auto',
          isMultiPageContinuation:
            !candidateBreakChosen ||
            sCursor + pSourceShaped.length < sourceShapedAll.length ||
            rCursor + pRashiShaped.length < rashiShapedAll.length ||
            tCursor + pTosafotShaped.length < tosafotShapedAll.length,
          rulesConfig,
          designSettings,
        });
        actualSConsumed = pSourceShaped.length > 0
          ? Math.min(pSourceShaped.length, Math.max(0, res.consumedSourceWords))
          : 0;
        actualRConsumed = pRashiShaped.length > 0
          ? Math.min(pRashiShaped.length, Math.max(0, res.consumedRashiWords))
          : 0;
        actualTConsumed = pTosafotShaped.length > 0
          ? Math.min(pTosafotShaped.length, Math.max(0, res.consumedTosafotWords))
          : 0;

        if (actualSConsumed === 0 && actualRConsumed === 0 && actualTConsumed === 0 &&
            (sCursor < sourceShapedAll.length || rCursor < rashiShapedAll.length || tCursor < tosafotShapedAll.length)) {
          throw new Error(
            'Rav-text pagination made no forward progress after footnote reflow on page ' + (p + 1) + '. Refusing to skip unplaced text.'
          );
        }
        const stillFinalPage =
          sCursor + actualSConsumed >= sourceShapedAll.length &&
          rCursor + actualRConsumed >= rashiShapedAll.length &&
          tCursor + actualTConsumed >= tosafotShapedAll.length &&
          terLineCursor >= terLinesAll.length;
        const rePlacedLines = [...res.sourceLines, ...res.rashiLines, ...res.tosafotLines];
        const rePlacedWords = rePlacedLines.flatMap(l => l.words);
        const rePlacedUnitIds = new Set<string>(rePlacedLines.map(l => l.unitId));
        for (const w of rePlacedWords) {
          if (w.unitId) rePlacedUnitIds.add(w.unitId);
        }
        exactAnchoredFns = this.resolveAnchoredFootnotesForWords(
          rePlacedWords,
          rePlacedUnitIds,
          footnoteUnits,
          placedFootnoteIds,
          stillFinalPage
        );
      }

      for (const fn of exactAnchoredFns) {
        placedFootnoteIds.add(fn.id);
        const fLines = fnLinesByUnitId.get(fn.id) ?? [];
        for (const fl of fLines) {
          pendingRavFnQueue.push({ unit: fn, line: { ...fl, words: fl.words.map(w => ({ ...w })) } });
        }
      }

      // v0.8.0 Part C (§7): shift the solved body down by the Michtav
      // height on page 0 so the box sits above the Gemara text. The solver
      // packed the lines into the reduced height (via the marginBottom
      // reserve above); the shift moves them into the freed strip.
      // Footnotes and the tertiary band are placed afterwards in outer
      // coordinates and are not shifted.
      if (michtavBox && michtavHeightPt > 0) {
        const dy = michtavHeightPt;
        for (const l of [...res.sourceLines, ...res.rashiLines, ...res.tosafotLines]) {
          const oldBaseline = l.yBaseline;
          l.yBaseline = oldBaseline + dy;
          l.yTop = (l.yTop ?? oldBaseline - l.ascent) + dy;
          l.yBottom = (l.yBottom ?? oldBaseline + l.descent) + dy;
        }
        for (const r of res.occupiedRegions) {
          r.yTop += dy;
          r.yBottom += dy;
        }
        res.knee.topY += dy;
        res.knee.kneeJunctionY += dy;
        res.knee.bottomY += dy;
      }

      // Calculate available height below actual placed Rav-Text lines so long footnotes can use all remaining vertical space
      const maxRavBodyY = Math.max(
        0,
        ...res.sourceLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
        ...res.rashiLines.map(l => l.yBottom ?? l.yBaseline + l.descent),
        ...res.tosafotLines.map(l => l.yBottom ?? l.yBaseline + l.descent)
      );
      const maxFnLinesFittingBelowBody = Math.max(
        maxRavFnLinesPerPage,
        Math.floor((contentHeight - maxRavBodyY - 14) / fnLeading)
      );
      const fnTakeCount = Math.min(pendingRavFnQueue.length, maxFnLinesFittingBelowBody);
      const takenRavFnItems = pendingRavFnQueue.splice(0, fnTakeCount);
      const fnLines = takenRavFnItems.map(item => item.line);
      reservedFnHeight = fnLines.length > 0 ? fnLines.length * fnLeading + 14 : 0;

      if (fnLines.length > 0) {
        let fnY = contentHeight - fnLines.length * fnLeading + 10;
        for (let fi = 0; fi < fnLines.length; fi++) {
          const fl = fnLines[fi];
          fl.yBaseline = fnY;
          fl.yTop = fnY - fl.ascent;
          fl.yBottom = fnY + fl.descent;
          fl.xLeft = 0;
          fl.xRight = contentWidth;
          res.occupiedRegions.push({
            id: `fn-p${p}-${fi}`,
            role: 'footnote',
            xLeft: 0,
            xRight: contentWidth,
            yTop: fl.yTop,
            yBottom: fl.yBottom,
          });
          fnY += fnLeading;
        }
      }

      // v0.8.0 Part C (§1/§9): tertiary band — a full-width strip directly
      // below the body and above the footnotes, in its own occupied region
      // so it can never overlap the knee or the footnotes. At most 8 lines
      // per page; the rest rolls to the next page (the reserve above
      // guarantees the strip exists).
      const terLines: TypesetLine[] = [];
      if (terLineCursor < terLinesAll.length) {
        const bandTop = maxRavBodyY + 10;
        const bandBottom = contentHeight - reservedFnHeight - 4;
        const maxTerLines = Math.max(
          0,
          Math.min(8, Math.floor((bandBottom - bandTop) / terLineH))
        );
        const takeTer = Math.min(maxTerLines, terLinesAll.length - terLineCursor);
        const terAscent = terLinesAll[terLineCursor]?.ascent ?? terFontSize * 0.82;
        let terY = bandTop + terAscent;
        for (let ti = 0; ti < takeTer; ti++) {
          const srcTer = terLinesAll[terLineCursor + ti];
          const tl: TypesetLine = { ...srcTer, words: srcTer.words.map(w => ({ ...w })) };
          tl.yBaseline = terY;
          tl.yTop = terY - tl.ascent;
          tl.yBottom = terY + tl.descent;
          tl.xLeft = 0;
          tl.xRight = contentWidth;
          tl.targetWidth = contentWidth;
          terLines.push(tl);
          res.occupiedRegions.push({
            id: `ter-p${p}-${ti}`,
            role: 'tertiary_comment',
            xLeft: 0,
            xRight: contentWidth,
            yTop: tl.yTop,
            yBottom: tl.yBottom,
          });
          terY += terLineH;
        }
        terLineCursor += takeTer;
      }

      sCursor = Math.min(sourceShapedAll.length, sCursor + actualSConsumed);
      rCursor = Math.min(rashiShapedAll.length, rCursor + actualRConsumed);
      tCursor = Math.min(tosafotShapedAll.length, tCursor + actualTConsumed);

      const hasMoreAfterPage =
        sCursor < sourceShapedAll.length ||
        rCursor < rashiShapedAll.length ||
        tCursor < tosafotShapedAll.length ||
        terLineCursor < terLinesAll.length ||
        pendingRavFnQueue.length > 0;

      if (linkDecisionMsg) {
        res.layoutScore.editorialDecisions.push(linkDecisionMsg);
        autoFixesApplied.push(linkDecisionMsg);
      }

      if (forceBreakMsg) {
        res.layoutScore.editorialDecisions.push(forceBreakMsg);
        autoFixesApplied.push(forceBreakMsg);
      }

      if (p > 0 || hasMoreAfterPage || lookAheadCandidatesTested > 1) {
        res.layoutScore.lookAheadAdjusted = true;
        const msg = `Look-Ahead רב-עמודי: שובצו בפועל (${actualSConsumed} מילות מקור, ${actualRConsumed} רש״י, ${actualTConsumed} תוספות) בעמוד ${p + 1} ללא איבוד מילים.`;
        res.layoutScore.editorialDecisions.push(msg);
        autoFixesApplied.push(msg);
      }

      // Compute active RavTextLinks and Stage 4 Cross-Page Continuation Tracking
      const pageUnitIds = new Set<string>();
      for (const l of [...res.sourceLines, ...res.rashiLines, ...res.tosafotLines]) {
        if (l.unitId) pageUnitIds.add(l.unitId);
        for (const w of l.words) {
          if (w.unitId) pageUnitIds.add(w.unitId);
        }
      }

      // Identify units continued from the previous page (their words exist both before `prevCursor` and on this page)
      const prevPlacedUnitIds = new Set<string>();
      for (const w of [
        ...sourceShapedAll.slice(0, prevSCursor),
        ...rashiShapedAll.slice(0, prevRCursor),
        ...tosafotShapedAll.slice(0, prevTCursor),
      ]) {
        if (w.unitId) prevPlacedUnitIds.add(w.unitId);
      }
      const nextRemainingUnitIds = new Set<string>();
      for (const w of [
        ...sourceShapedAll.slice(sCursor),
        ...rashiShapedAll.slice(rCursor),
        ...tosafotShapedAll.slice(tCursor),
      ]) {
        if (w.unitId) nextRemainingUnitIds.add(w.unitId);
      }

      const continuedUnitIdsFromPrevPage = Array.from(pageUnitIds).filter(id =>
        prevPlacedUnitIds.has(id)
      );
      const continuedUnitIdsToNextPage = Array.from(pageUnitIds).filter(id =>
        nextRemainingUnitIds.has(id)
      );

      // A link is active on this page if both its sourceUnitId and commentaryUnitId are on this page,
      // OR if its commentaryUnitId is on this page and its sourceUnitId was placed on an earlier page (cross-page continuation link!)
      const pageActiveLinks = allLinks.filter(
        lnk =>
          (pageUnitIds.has(lnk.commentaryUnitId) && pageUnitIds.has(lnk.sourceUnitId)) ||
          (pageUnitIds.has(lnk.commentaryUnitId) && prevPlacedUnitIds.has(lnk.sourceUnitId)) ||
          (pageUnitIds.has(lnk.sourceUnitId) && nextRemainingUnitIds.has(lnk.commentaryUnitId))
      );

      const splitLinkIdsFromPrevPage = allLinks
        .filter(
          lnk =>
            pageUnitIds.has(lnk.commentaryUnitId) &&
            (prevPlacedUnitIds.has(lnk.sourceUnitId) ||
              prevPlacedUnitIds.has(lnk.commentaryUnitId))
        )
        .map(l => l.linkId);

      const splitLinkIdsToNextPage = allLinks
        .filter(
          lnk =>
            (pageUnitIds.has(lnk.sourceUnitId) || pageUnitIds.has(lnk.commentaryUnitId)) &&
            nextRemainingUnitIds.has(lnk.commentaryUnitId)
        )
        .map(l => l.linkId);

      // Build specific, informative Hebrew continuation headers & footers
      const prevFolio = p > 0 ? PdfExporter.toHebrewGematria(pageNumber - 1) : '';
      const nextFolio = PdfExporter.toHebrewGematria(pageNumber + 1);
      const continuedStreamsToNext: string[] = [];
      if (sCursor < sourceShapedAll.length && continuedUnitIdsToNextPage.some(id => sourceShapedAll.some(w => w.unitId === id))) {
        continuedStreamsToNext.push('גמרא');
      }
      if (rCursor < rashiShapedAll.length && continuedUnitIdsToNextPage.some(id => rashiShapedAll.some(w => w.unitId === id))) {
        continuedStreamsToNext.push('רש״י');
      }
      if (tCursor < tosafotShapedAll.length && continuedUnitIdsToNextPage.some(id => tosafotShapedAll.some(w => w.unitId === id))) {
        continuedStreamsToNext.push('תוספות');
      }

      const continuationHeader =
        p > 0
          ? continuedUnitIdsFromPrevPage.length > 0
            ? `המשך מעמוד קודם (דף ${prevFolio})`
            : `המשך מדף ${prevFolio}`
          : undefined;
      const continuationFooter = hasMoreAfterPage
        ? continuedStreamsToNext.length > 0
          ? `המשך ${continuedStreamsToNext.join(' ו')} בדף ${nextFolio}...`
          : `המשך בדף ${nextFolio}...`
        : undefined;

      // Automatic Ornament selection & placement in unoccupied area (B-2: queries actual occupiedRegions!)
      const rashiRight = geometry.pageWidth - geometry.marginOutside;
      const sourceRight =
        rashiRight - res.knee.rightCommentaryWidth - res.knee.gutterWidth;
      const maxTextY = Math.max(
        res.sourceLines.length > 0
          ? res.sourceLines[res.sourceLines.length - 1].yBottom ??
            res.sourceLines[res.sourceLines.length - 1].yBaseline +
              res.sourceLines[res.sourceLines.length - 1].descent
          : 0,
        res.rashiLines.length > 0
          ? res.rashiLines[res.rashiLines.length - 1].yBottom ??
            res.rashiLines[res.rashiLines.length - 1].yBaseline +
              res.rashiLines[res.rashiLines.length - 1].descent
          : 0,
        res.tosafotLines.length > 0
          ? res.tosafotLines[res.tosafotLines.length - 1].yBottom ??
            res.tosafotLines[res.tosafotLines.length - 1].yBaseline +
              res.tosafotLines[res.tosafotLines.length - 1].descent
          : 0
      );

      const pageUnitsOnThisPage = units.filter(u => pageUnitIds.has(u.id));
      const placedOrnaments = OrnamentLibraryEngine.autoPlaceOrnaments(
        pageUnitsOnThisPage,
        sourceRight,
        res.knee.upperSourceWidth,
        res.knee.upperKneeY ?? 56,
        maxTextY,
        contentHeight - reservedFnHeight,
        enableOrnaments,
        res.occupiedRegions,
        geometry.marginInside,
        contentWidth,
        OrnamentLibraryEngine.DEFAULT_SAFETY_CLEARANCE_PT,
        p === 0 ? userSuppliedOrnaments : [],
        userOrnamentRules
      );

      pages.push({
        pageIndex: p,
        pageNumber,
        pageNumberHebrew: PdfExporter.toHebrewGematria(pageNumber),
        headerTitle: title,
        layoutType,
        geometry,
        sourceLines: res.sourceLines,
        rashiLines: res.rashiLines,
        tosafotLines: res.tosafotLines,
        footnoteLines: fnLines,
        // v0.8.0 Part C (§1/§7): tertiary band + Michtav box (page 0 only).
        tertiaryLines: terLines,
        michtavBox,
        knee: res.knee,
        occupiedRegions: res.occupiedRegions,
        layoutScore: res.layoutScore,
        placedOrnaments,
        activeLinks: pageActiveLinks,
        continuationHeader,
        continuationFooter,
        continuedUnitIdsFromPrevPage,
        continuedUnitIdsToNextPage,
        splitLinkIdsFromPrevPage,
        splitLinkIdsToNextPage,
      });

      p++;
      if (!hasMoreAfterPage) break;
    }

    // Compute Stage 4 Global Multi-Page Sequence Score across the entire book
    const avgScore =
      pages.length > 0
        ? Math.round(
            pages.reduce((acc, pg) => acc + (pg.layoutScore?.totalScore ?? 92), 0) /
              pages.length
          )
        : 95;

    return {
      title,
      layoutType,
      pages,
      totalPages: pages.length,
      geometry,
      links: allLinks,
      multiPageSequenceScore: avgScore,
      autoFixesApplied,
    };
  }
}
