/**
 * Keter Dynamic Knee ("Berayim") & Available-Area Constraint-Solving Rav-Text Engine
 *
 * Solves classic Jewish holy-book multi-text layouts (Gemara Vilna, Chumash Mikraot Gedolot,
 * Rambam, Shulchan Aruch) using a genuine 2D Available-Area & Exclusion-Zone model:
 *
 * 1. Places the central Source text with irregular/stepped polygonal contour and registers
 *    every Source line's exact [xLeft, xRight, yTop, yBottom] into SpatialExclusionEngine.
 * 2. Enforces professional Minimum Readable Line Lengths (never allowing Source to collapse
 *    below 135pt or Commentary below 78pt).
 * 3. For every vertical line slice y, queries SpatialExclusionEngine.queryAvailableIntervals()
 *    to determine the exact remaining free horizontal intervals for Rashi (right) and Tosafot (left).
 * 4. Runs full 2D collision detection (SpatialExclusionEngine.detectCollisions). Any candidate
 *    with visual overlap is rejected or repaired before committing.
 */

import {
  DynamicKneeContour,
  KeepPriority,
  LayoutQualityScore,
  OccupiedRegion,
  PageGeometry,
  ShapedWord,
  SourceContourBand,
  TypesetLine,
} from '../types/typesetter';
import { TypesetterEngine, computeParagraphLineIndents } from './typesetter-core';
import { SpatialExclusionEngine } from './spatial-exclusion';
import {
  TypesettingRulesConfig,
  TypesettingRulesEngine,
} from './typesetting-rules-engine';
import { ProfessionalDesignSettings } from '../types/design-settings';
import { DesignSettingsEngine } from './design-settings-engine';
import { applyGlyphStretch } from './line-breaker';
import { isTalmudFolio } from './sefer-type';
import { VILNA_PRINT } from './vilna-fit';

export interface RavTextLayoutInput {
  sourceText: string;
  rashiText: string;
  tosafotText: string;
  sourceShapedWords?: ShapedWord[];
  rashiShapedWords?: ShapedWord[];
  tosafotShapedWords?: ShapedWord[];
  sourceUnitId: string;
  rashiUnitId: string;
  tosafotUnitId: string;
  geometry: PageGeometry;
  sourceFontSize?: number;
  commentaryFontSize?: number;
  upperKneeLines?: number;      // e.g. 4 lines of Rashi/Tosafot running above the Gemara
  upperKneeInwardStep?: number; // pt expansion into upper central zone
  forceSteppedKnee?: boolean;
  manualJunctionPercent?: number;
  manualLowerWidthPercent?: number;
  manualStepDirection?: 'auto' | 'left' | 'right' | 'none';
  /** v0.7.0 Part 3 (M1): mirror the flanks for a verso (left-facing) page —
   *  Rashi to the inner margin, Tosafot to the outer margin. Implemented by
   *  solving the page with the Rashi/Tosafot streams swapped and swapping
   *  the results back (roles + unit ids remapped), so the verso page is the
   *  exact mirror image of a recto page. */
  mirrorFlanks?: boolean;
  /**
   * Layout training T2.2 — height (pt) kept free at the TOP OF THE GEMARA
   * COLUMN only (the masechta opening frame). The commentaries still start
   * at the top and run beside the reserve; the Gemara starts below it.
   */
  sourceTopReservePt?: number;
  /**
   * v0.8.0 Part C (§2): internal — explicit Rashi share for the swapped
   * (verso) solve. The tier share is role-based, so the swapped solve
   * must use 1 − share (its "rashi" slot holds Tosafot content); without
   * this the two commentaries would trade widths on every verso page.
   * Set only by the mirror branch below; callers leave it unset.
   */
  tierFlankShareOverride?: number;
  /** When true, unconsumed words from the supplied buffer roll to subsequent pages and are not penalized as overflow */
  isMultiPageContinuation?: boolean;
  rulesConfig?: TypesettingRulesConfig;
  designSettings?: ProfessionalDesignSettings;
}

interface CandidateConfig {
  sourceWidthRatio: number;     // e.g. 0.42, 0.46, 0.50, 0.54
  upperKneeLines: number;       // e.g. 2, 3, 4, 5
  stepLowerRatio: number;       // e.g. 0.76, 0.80, 0.84, 1.15 (contraction or expansion)
  stepJunctionRatio?: number;   // e.g. 0.48, 0.56, 0.64 (where along source height the knee occurs)
  rightFlankBias?: number;      // e.g. 0.50 (balanced), 0.58 (wider Rashi), 0.42 (wider Tosafot)
  lineHeightScale: number;      // e.g. 0.98, 1.0, 1.02
}

/**
 * v0.9.8 Phase 4 — trial line-count memo stats (module-level counters
 * only; the cache itself is per-candidate, see solveSingleCandidate).
 * `hits` counts trial counts served from the memo instead of
 * re-typesetting; `misses` counts fresh trial typesets.
 */
const prefixWidthCache = new WeakMap<ShapedWord[], Float64Array>();
export const trialLineCacheStats = { hits: 0, misses: 0, pageSolves: 0, candidateSolves: 0 };

export function resetTrialLineCacheStats(): void {
  trialLineCacheStats.hits = 0;
  trialLineCacheStats.misses = 0;
  trialLineCacheStats.pageSolves = 0;
  trialLineCacheStats.candidateSolves = 0;
}

/**
 * When one commentary ends on a page and the other continues, the Gemara
 * spreads into the freed flank (as in the Vilna) instead of leaving a
 * hole beside it. (Before, only a page with a very short commentary
 * — ≤ 65 words — let the Gemara spread.)
 */
const commentaryHoleReclaim = (globalThis as { __KETER_NO_HOLE_RECLAIM?: boolean }).__KETER_NO_HOLE_RECLAIM !== true;

export class DynamicKneeEngine {
  /**
   * Stage 3: Multi-candidate 2D contour & available-area constraint solver for a Rav-Text page.
   * Evaluates content-adaptive candidate geometries (varying source width, knee height, knee depth,
   * upper collar lines, and asymmetric Rashi/Tosafot flanking widths), verifies zero collisions,
   * and selects the highest-quality valid layout.
   */
  public static layoutRavTextPage(input: RavTextLayoutInput): {
    knee: DynamicKneeContour;
    sourceLines: TypesetLine[];
    rashiLines: TypesetLine[];
    tosafotLines: TypesetLine[];
    occupiedRegions: OccupiedRegion[];
    layoutScore: LayoutQualityScore;
    consumedSourceWords: number;
    consumedRashiWords: number;
    consumedTosafotWords: number;
  } {
    // v0.7.0 Part 3 (M1) — verso mirror: solve with the streams swapped,
    // then swap the results back with roles + unit ids remapped.
    if (input.mirrorFlanks) {
      // v0.8.0 Part C (§2): the tier flank share is role-based, so the
      // swapped solve needs the complement (1 − share) — its "rashi" slot
      // holds Tosafot content. The content-driven share self-corrects
      // (the word counts swap too), but the tier share does not.
      const baseShare = input.tierFlankShareOverride ??
        (input.designSettings ? DesignSettingsEngine.tierFlankShare(input.designSettings) : null);
      const swapped = this.layoutRavTextPage({
        ...input,
        mirrorFlanks: false,
        tierFlankShareOverride: baseShare !== null ? 1 - baseShare : undefined,
        rashiText: input.tosafotText,
        tosafotText: input.rashiText,
        rashiShapedWords: input.tosafotShapedWords,
        tosafotShapedWords: input.rashiShapedWords,
        rashiUnitId: input.tosafotUnitId,
        tosafotUnitId: input.rashiUnitId,
      });
      // v0.9.8 Phase 4 — FIX: the old remap stamped EVERY line (and
      // every word) with the single `input.rashiUnitId` /
      // `input.tosafotUnitId` — the FIRST unit id of the page slice.
      // MEASURED: on a verso page whose Rashi slice spans 3 units, all
      // lines came back labelled as the first unit, so the other two
      // units looked "unplaced" (and same-page gravity, continuation
      // tracking and per-unit editing all saw the wrong attribution)
      // even though their words WERE on the page. The swapped solve's
      // lines already carry the TRUE per-word unit ids (consumeOneLine
      // preserves them); the remap now only swaps the ROLE and keeps
      // each word's — and each line's — true unit id.
      const remap = (lines: import('../types/typesetter').TypesetLine[], role: 'primary_comment' | 'secondary_comment') =>
        lines.map(l => {
          const trueUnitId =
            l.words.find(w => !w.isSpace && w.unitId)?.unitId ?? l.unitId;
          return {
            ...l,
            role,
            unitId: trueUnitId,
            words: l.words.map(w => ({ ...w, role })),
          };
        });
      const rashiLines = remap(swapped.tosafotLines, 'primary_comment');
      const tosafotLines = remap(swapped.rashiLines, 'secondary_comment');
      // NOTE: the knee contour is NOT swapped: the swapped solve already
      // computed the mirrored geometry (right/left flank widths describe
      // the physical sides, which now hold the other commentary).
      const occupiedRegions = swapped.occupiedRegions.map(r =>
        r.role === 'primary_comment'
          ? { ...r, role: 'secondary_comment' as const }
          : r.role === 'secondary_comment'
            ? { ...r, role: 'primary_comment' as const }
            : r
      );
      return {
        ...swapped,
        rashiLines,
        tosafotLines,
        occupiedRegions,
        consumedRashiWords: swapped.consumedTosafotWords,
        consumedTosafotWords: swapped.consumedRashiWords,
      };
    }
    const isManual = input.manualJunctionPercent !== undefined;

    if (isManual) {
      const manualResult = this.solveSingleCandidate(input, {
        sourceWidthRatio: 0.44,
        upperKneeLines: input.upperKneeLines ?? 4,
        stepLowerRatio: Math.max(0.75, (input.manualLowerWidthPercent ?? 78) / 100.0),
        stepJunctionRatio: (input.manualJunctionPercent ?? 50) / 100.0,
        rightFlankBias: 0.5,
        lineHeightScale: 1.0,
      });
      manualResult.layoutScore.candidatesEvaluated = 1;
      manualResult.layoutScore.editorialDecisions.unshift(
        'מצב כוונון ידני פעיל: גאומטריית הברך נקבעה לפי העדפת המשתמש תוך אכיפת מניעת התנגשויות.'
      );
      return manualResult;
    }

    const baseUpperLines = input.upperKneeLines ?? 4;

    // Inspect content mass asymmetry to generate targeted 2D contour candidates
    const sCount =
      input.sourceShapedWords?.length ??
      (input.sourceText.trim() ? input.sourceText.trim().split(/\s+/).length : 0);
    const rCount =
      input.rashiShapedWords?.length ??
      (input.rashiText.trim() ? input.rashiText.trim().split(/\s+/).length : 0);
    const tCount =
      input.tosafotShapedWords?.length ??
      (input.tosafotText.trim() ? input.tosafotText.trim().split(/\s+/).length : 0);
    const commentTotal = Math.max(1, rCount + tCount);
    const naturalRashiShare =
      rCount > 0 && tCount > 0
        ? Math.min(0.64, Math.max(0.36, rCount / commentTotal))
        : rCount > 0
        ? 0.65
        : 0.35;

    // v0.8.0 Part C (§2): the tier widths are the user's explicit flank
    // split — when the layout's tiers carry Rashi/Tosafot widths, they
    // override the content-driven share, so editing a tier width (or the
    // AI `expand_tosafot` action) visibly widens/narrows the flank.
    // Without tier widths the content-driven share below is unchanged.
    // (`tierFlankShareOverride` is the mirror branch's complement.)
    const tierRashiShare = input.tierFlankShareOverride ?? (input.designSettings
      ? DesignSettingsEngine.tierFlankShare(input.designSettings)
      : null);
    const rashiShare = tierRashiShare ?? naturalRashiShare;

    // v0.8.0 Part C (§2): the main_source tier's width centres the
    // solver's sourceWidthRatio search (the candidates keep their spread
    // around it, so the solver still optimises for zero collisions).
    // Without a tier width the candidates are unchanged.
    const tierSourceShare = input.designSettings
      ? DesignSettingsEngine.tierSourceShare(input.designSettings)
      : null;
    const srcShift =
      tierSourceShare !== null
        ? Math.min(0.08, Math.max(-0.08, tierSourceShare - 0.46))
        : 0;
    const srcRatio = (base: number): number =>
      srcShift === 0 ? base : Math.min(0.6, Math.max(0.35, base + srcShift));

    const isShortSource = sCount > 0 && sCount <= 35 && commentTotal >= 80;
    const isLongSourceShortComment = sCount >= 70 && commentTotal <= 45;

    const candidates: CandidateConfig[] = [
      // Balanced classic Vilna candidates
      {
        sourceWidthRatio: srcRatio(0.43),
        upperKneeLines: baseUpperLines,
        stepLowerRatio: 0.80,
        stepJunctionRatio: 0.56,
        rightFlankBias: 0.50,
        lineHeightScale: 1.0,
      },
      {
        sourceWidthRatio: srcRatio(0.46),
        upperKneeLines: baseUpperLines,
        stepLowerRatio: 0.82,
        stepJunctionRatio: 0.56,
        rightFlankBias: rashiShare,
        lineHeightScale: 1.0,
      },
      {
        sourceWidthRatio: srcRatio(0.48),
        upperKneeLines: baseUpperLines,
        stepLowerRatio: 0.84,
        stepJunctionRatio: 0.60,
        rightFlankBias: rashiShare,
        lineHeightScale: 1.0,
      },
      // Deep knee / high commentary volume candidate
      {
        sourceWidthRatio: srcRatio(0.42),
        upperKneeLines: isShortSource ? baseUpperLines + 1 : baseUpperLines,
        stepLowerRatio: 0.78,
        stepJunctionRatio: 0.48,
        rightFlankBias: rashiShare,
        lineHeightScale: 0.98,
      },
      // Wide source / lower-step expansion candidate (for long source + short commentary)
      {
        sourceWidthRatio: isLongSourceShortComment ? srcRatio(0.54) : srcRatio(0.45),
        upperKneeLines: isLongSourceShortComment ? Math.max(1, baseUpperLines - 2) : Math.max(2, baseUpperLines - 1),
        stepLowerRatio: isLongSourceShortComment ? 1.12 : 0.80,
        stepJunctionRatio: 0.52,
        rightFlankBias: rashiShare,
        lineHeightScale: 1.0,
      },
      // Asymmetric flanking & deep upper collar candidate
      {
        sourceWidthRatio: srcRatio(0.47),
        upperKneeLines: baseUpperLines + 1,
        stepLowerRatio: 0.82,
        stepJunctionRatio: 0.55,
        rightFlankBias: rashiShare,
        lineHeightScale: 0.99,
      },
      // High-density balanced amud candidate (eliminates 1-2 line page-end widow overflows)
      {
        sourceWidthRatio: srcRatio(0.45),
        upperKneeLines: baseUpperLines,
        stepLowerRatio: 0.78,
        stepJunctionRatio: 0.50,
        rightFlankBias: rashiShare,
        lineHeightScale: 0.94,
      },
      // Heavy-commentary Vilna Daf candidate (wider flanking columns + 5 upper collar lines)
      {
        sourceWidthRatio: srcRatio(0.40),
        upperKneeLines: baseUpperLines + 1,
        stepLowerRatio: 0.76,
        stepJunctionRatio: 0.45,
        rightFlankBias: rashiShare,
        lineHeightScale: 0.93,
      },
    ];

    let bestResult: ReturnType<typeof this.solveSingleCandidate> | null = null;

    trialLineCacheStats.pageSolves++;
    for (const candidate of candidates) {
      trialLineCacheStats.candidateSolves++;
      const solved = this.solveSingleCandidate(input, candidate);
      const solvedOverflow =
        Math.max(0, sCount - solved.consumedSourceWords) +
        Math.max(0, rCount - solved.consumedRashiWords) +
        Math.max(0, tCount - solved.consumedTosafotWords);
      const bestOverflow = bestResult
        ? Math.max(0, sCount - bestResult.consumedSourceWords) +
          Math.max(0, rCount - bestResult.consumedRashiWords) +
          Math.max(0, tCount - bestResult.consumedTosafotWords)
        : Infinity;

      // 1. A candidate with collisions must NEVER beat a collision-free candidate
      // 2. Among collision-free candidates, prefer candidates that fit more content (less overflow),
      //    then highest composite layoutScore.totalScore!
      if (!bestResult) {
        bestResult = solved;
      } else {
        const solvedZeroCol = (solved.layoutScore.collisionCount ?? 0) === 0;
        const bestZeroCol = (bestResult.layoutScore.collisionCount ?? 0) === 0;

        if (solvedZeroCol && !bestZeroCol) {
          bestResult = solved;
        } else if (solvedZeroCol === bestZeroCol) {
          if (solvedOverflow < bestOverflow) {
            bestResult = solved;
          } else if (
            solvedOverflow === bestOverflow &&
            solved.layoutScore.totalScore > bestResult.layoutScore.totalScore
          ) {
            bestResult = solved;
          }
        }
      }
    }

    const finalResult = bestResult!;
    finalResult.layoutScore.candidatesEvaluated = candidates.length;
    return finalResult;
  }

  /**
   * Solves line-by-line available-area geometry for a specific candidate configuration,
   * registering all placed lines into `SpatialExclusionEngine` and verifying 0 collisions.
   */
  private static solveSingleCandidate(
    input: RavTextLayoutInput,
    candidate: CandidateConfig
  ): {
    knee: DynamicKneeContour;
    sourceLines: TypesetLine[];
    rashiLines: TypesetLine[];
    tosafotLines: TypesetLine[];
    occupiedRegions: OccupiedRegion[];
    layoutScore: LayoutQualityScore;
    consumedSourceWords: number;
    consumedRashiWords: number;
    consumedTosafotWords: number;
  } {
    // Vilna Shas page shape (the user's reference pages): the Gemara
    // column only ever WIDENS going down the page — never a contracting
    // knee; Rashi and Tosafot meet at the page centre above the Gemara;
    // below it, the commentary with more text left spreads under the
    // Gemara while the other keeps its own column.
    const vilnaShape = isTalmudFolio(input.designSettings, 'rav_text');
    if (vilnaShape && candidate.stepLowerRatio < 1) candidate = { ...candidate, stepLowerRatio: 1 };
    const {
      sourceText,
      rashiText,
      tosafotText,
      sourceUnitId,
      rashiUnitId,
      tosafotUnitId,
      geometry,
      sourceFontSize = 14.5,
      commentaryFontSize = 10.5,
      upperKneeInwardStep = 18.0,
      manualJunctionPercent,
      manualStepDirection = 'auto',
    } = input;

    const editorialDecisions: string[] = [];
    const contentWidth = geometry.pageWidth - geometry.marginInside - geometry.marginOutside;
    const contentHeight = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;
    const gutterRule = TypesettingRulesEngine.resolveRule<number>(
      'ravText.defaultGutterWidthPt',
      { layoutType: 'rav_text' },
      input.rulesConfig
    );
    const gutter = vilnaShape
      ? Math.max(6, Math.round(contentWidth * VILNA_PRINT.gutterOfBlock * 10) / 10)
      : input.designSettings?.ravText?.gutterWidthPt ?? gutterRule.value ?? 11.0;

    // Initialize 2D Spatial Available-Area & Exclusion Engine for this candidate
    const spatial = new SpatialExclusionEngine(contentWidth, contentHeight);

    // Enforce Problem 4: Minimum Readable Line Length for Source & Commentaries via centralized TypesettingRulesEngine
    const eps = SpatialExclusionEngine.GEOMETRIC_EPSILON_PT;
    const minSourceWRule = TypesettingRulesEngine.resolveRule<number>(
      'lineQuality.minReadableSourceWidthPt',
      { layoutType: 'rav_text', role: 'main_source' },
      input.rulesConfig
    );
    const minCommentWRule = TypesettingRulesEngine.resolveRule<number>(
      'lineQuality.minReadableCommentaryWidthPt',
      { layoutType: 'rav_text', role: 'primary_comment' },
      input.rulesConfig
    );
    const minSourceW = minSourceWRule.value ?? SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT;
    const minCommentW = minCommentWRule.value ?? SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT;

    const resolvedSrcFont =
      input.designSettings?.roleStyles?.main_source?.character?.fontFamily ?? 'Frank Ruhl Libre';
    const resolvedCmtFont =
      input.designSettings?.roleStyles?.primary_comment?.character?.fontFamily ?? 'Taamey Frank CLM';
    const resolvedSrcSize =
      input.designSettings?.roleStyles?.main_source?.character?.fontSizePt ?? sourceFontSize;
    const resolvedCmtSize =
      input.designSettings?.roleStyles?.primary_comment?.character?.fontSizePt ?? commentaryFontSize;

    const sourceEngine = new TypesetterEngine(
      resolvedSrcSize,
      input.rulesConfig,
      input.designSettings
    );
    const commentEngine = new TypesetterEngine(
      resolvedCmtSize,
      input.rulesConfig,
      input.designSettings
    );

    const srcPara = input.designSettings?.roleStyles?.main_source?.paragraph;
    const cmtPara = input.designSettings?.roleStyles?.primary_comment?.paragraph;
    // v0.8.0 Part C (§2): use the resolver's leadingPt whenever it is set.
    // The resolver always computes a meaningful leadingPt (fontSize ×
    // lineSpacingRatio, clamped to the 1.06× glyph extent) in BOTH modes —
    // 'fixed' only means user-pinned — so gating on 'fixed' made tier
    // lineHeight edits invisible (the shaper's 1.32 fallback is the stale
    // default no tier edit can reach). Default settings are unchanged:
    // resolver leadingPt = fontSize × 1.32 = the shaper value.
    const baseSrcLH =
      srcPara && srcPara.leadingPt > 0
        ? srcPara.leadingPt
        : sourceEngine.getShaper().getLineHeight();
    const baseCmtLH =
      cmtPara && cmtPara.leadingPt > 0
        ? cmtPara.leadingPt
        : commentEngine.getShaper().getLineHeight();

    const sourceLineHeight = baseSrcLH * candidate.lineHeightScale;
    const commentLineHeight = baseCmtLH * candidate.lineHeightScale;
    const sourceAscent = sourceEngine.getShaper().getAscent();
    const sourceDescent = sourceEngine.getShaper().getDescent();
    const commentAscent = commentEngine.getShaper().getAscent();
    const commentDescent = commentEngine.getShaper().getDescent();
    // A line one pitch below the line above it in the same column must
    // never read as a collision, even when the line pitch is tighter than
    // the font's full glyph box (compact candidates, Rashi script): the
    // vertical clearance of a query is capped at pitch − glyph box. Before,
    // such columns skipped every other line (gaps between dibburim).
    const commentClear = Math.min(1.5, commentLineHeight - (commentAscent + commentDescent) + 0.4);
    const sourceClear = Math.min(1.5, sourceLineHeight - (sourceAscent + sourceDescent) + 0.4);

    // Build or use structured ShapedWord[] preserving ContentUnit identity, TextRuns, and Dibbur HaMatchil
    const structuredSourceWords: ShapedWord[] =
      input.sourceShapedWords && input.sourceShapedWords.length > 0
        ? input.sourceShapedWords
        : (sourceText.trim() ? sourceText.trim().split(/\s+/) : []).map(w => {
            const sw = sourceEngine.getShaper().shapeWord(w);
            sw.unitId = sourceUnitId;
            sw.role = 'main_source';
            return sw;
          });

    const structuredRashiWords: ShapedWord[] =
      input.rashiShapedWords && input.rashiShapedWords.length > 0
        ? input.rashiShapedWords
        : (rashiText.trim() ? rashiText.trim().split(/\s+/) : []).map((w, idx) => {
            const sw = commentEngine.getShaper().shapeWord(w);
            sw.unitId = rashiUnitId;
            sw.role = 'primary_comment';
            if (idx === 0 && w.includes(':')) {
              sw.isDibbur = true;
              sw.isBold = true;
            }
            return sw;
          });

    const structuredTosafotWords: ShapedWord[] =
      input.tosafotShapedWords && input.tosafotShapedWords.length > 0
        ? input.tosafotShapedWords
        : (tosafotText.trim() ? tosafotText.trim().split(/\s+/) : []).map((w, idx) => {
            const sw = commentEngine.getShaper().shapeWord(w);
            sw.unitId = tosafotUnitId;
            sw.role = 'secondary_comment';
            if (idx === 0 && w.includes(':')) {
              sw.isDibbur = true;
              sw.isBold = true;
            }
            return sw;
          });

    const hasRashi = structuredRashiWords.length > 0;
    const hasTosafot = structuredTosafotWords.length > 0;
    const activeFlankCount = (hasRashi ? 1 : 0) + (hasTosafot ? 1 : 0);

    let maxSourceEndY = contentHeight + 2.0;

    // Stage 3 Jointly-Solved Top-Wrapping Knee & Flanking Geometry:
    // Calculate initial flanking widths from candidate ratios while guaranteeing >= minCommentW
    const maxAllowedSourceW =
      activeFlankCount === 2
        ? contentWidth - 2 * minCommentW - 2 * gutter
        : activeFlankCount === 1
        ? contentWidth - minCommentW - gutter
        : contentWidth;

    // Vilna (measured on the print): Gemara 40.6% of the block, Rashi and
    // Tosafot 26.3% each; with one commentary on the page the Gemara takes
    // the other side.
    const vilnaPrintFlankW = Math.round(contentWidth * VILNA_PRINT.flankOfBlock);
    const defaultSourceWidth = vilnaShape && activeFlankCount > 0
      ? activeFlankCount === 2
        ? Math.round(contentWidth - 2 * vilnaPrintFlankW - 2 * gutter)
        : Math.round(contentWidth - vilnaPrintFlankW - gutter)
      : Math.max(
      minSourceW,
      Math.min(
        maxAllowedSourceW,
        Math.round(
          contentWidth *
            (activeFlankCount === 1
              ? Math.min(0.60, candidate.sourceWidthRatio + 0.10)
              : activeFlankCount === 0
              ? 0.94
              : candidate.sourceWidthRatio)
        )
      )
    );

    const totalFlankingBudget = Math.max(
      0,
      contentWidth - defaultSourceWidth - gutter * activeFlankCount
    );
    const rightBias = vilnaShape ? 0.5 : candidate.rightFlankBias ?? 0.5;

    let defaultRashiWidth = 0;
    let defaultTosafotWidth = 0;

    if (hasRashi && hasTosafot) {
      defaultRashiWidth = Math.max(
        minCommentW,
        Math.min(totalFlankingBudget - minCommentW, Math.round(totalFlankingBudget * rightBias))
      );
      defaultTosafotWidth = Math.max(
        minCommentW,
        totalFlankingBudget - defaultRashiWidth
      );
    } else if (hasRashi && !hasTosafot) {
      defaultRashiWidth = Math.max(minCommentW, totalFlankingBudget);
      defaultTosafotWidth = 0;
    } else if (!hasRashi && hasTosafot) {
      defaultRashiWidth = 0;
      defaultTosafotWidth = Math.max(minCommentW, totalFlankingBudget);
    }

    // Measure actual glyph advance sums for Source, Rashi, and Tosafot
    const rAdvanceSum = structuredRashiWords.reduce((s, w) => s + w.width + 3.5, 0);
    const tAdvanceSum = structuredTosafotWords.reduce((s, w) => s + w.width + 3.5, 0);
    const sAdvanceSum = structuredSourceWords.reduce((s, w) => s + w.width + 4.5, 0);

    // Phase 1: Jointly solve Top-Wrapping ("Berayim") Commentary Bands above the Source!
    // In classic Vilna Rav-Text:
    // - Commentary wraps around the Source from above (`upper_collar`), meeting at the center gutter
    //   with ZERO center hole (`usableTopW = contentWidth - gutter` when both Rashi & Tosafot are active,
    //   or `contentWidth` when a single commentary wraps across the top).
    // - Replace heuristic multipliers with ACTUAL TRIAL LINE-COUNT MEASUREMENT:
    //   For each candidate top-wrap line count `k` (`candidate.upperKneeLines` down to `0`),
    //   we trial-typeset the `k` top-wrap lines using `this.consumeOneLine` and then trial-typeset
    //   the remaining `ShapedWord[]` slice at the actual flanking width (`defaultRashiWidth` / `defaultTosafotWidth`).
    //   We select the largest `k <= candidate.upperKneeLines` such that every active commentary
    //   with total capacity > 1 flanking line retains at least 1 real flanking line alongside the Source!
    const usableDualTopW = contentWidth - gutter;
    const topShareR =
      hasRashi && hasTosafot && vilnaShape
        ? 0.5
        : hasRashi && hasTosafot
        ? Math.min(0.62, Math.max(0.38, rAdvanceSum / Math.max(1, rAdvanceSum + tAdvanceSum)))
        : hasRashi
        ? 1.0
        : 0.0;
    const plannedTopRashiW =
      hasRashi && hasTosafot
        ? Math.max(minCommentW, Math.round(usableDualTopW * topShareR))
        : hasRashi
        ? contentWidth
        : 0;
    const plannedTopTosafotW =
      hasRashi && hasTosafot
        ? Math.max(minCommentW, usableDualTopW - plannedTopRashiW)
        : hasTosafot
        ? contentWidth
        : 0;

    // v0.9.8 Phase 4 — per-candidate memo for countTrialLines (see the
    // closure below). Fresh Map per solveSingleCandidate call.
    const trialLineCache = new Map<string, number>();
    // Helper: count exact real lines produced by trial-typesetting a slice of ShapedWord[] at `targetWidth`
    // v0.9.8 Phase 4 — memoized: within one candidate solve the same
    // (stream, startIdx, width, role, lineHeight) trial recurs — the
    // per-source-line remaining-height probes re-ask for the same
    // commentary start index on every source line until that commentary
    // advances, and the top-wrap loop re-asks the same start index per
    // tryK. The cache is per-solveSingleCandidate-call (created fresh
    // above the closure): the word arrays are built once per call, so a
    // key of role + startIdx + width + lineHeight is unambiguous inside
    // one call and can never leak across different texts. Hits/misses
    // are counted in the module-level `trialLineCacheStats` (exported
    // for the Phase 4 smoke test). Glyph measurement itself was already
    // memoized (HarfBuzzShaperEngine.metricCache); this memoizes the
    // line-breaking trial on top of it.
    const countTrialLines = (
      engine: TypesetterEngine,
      words: ShapedWord[],
      startIdx: number,
      targetWidth: number,
      role: 'main_source' | 'primary_comment' | 'secondary_comment',
      unitId: string | undefined,
      lineH: number
    ): number => {
      if (startIdx >= words.length || targetWidth < minCommentW - eps) return 0;
      const key = `${role}|${startIdx}|${targetWidth.toFixed(1)}|${lineH.toFixed(2)}`;
      const cached = trialLineCache.get(key);
      if (cached !== undefined) {
        trialLineCacheStats.hits++;
        return cached;
      }
      trialLineCacheStats.misses++;
      // The knee sets its lines one by one (first fit + T10 tightening),
      // so the planner counts them the same way — and fast.
      // T13 — a page only ever needs to know about text it could hold:
      // stop at ~2.5 pages' worth of lines (by natural width). Short
      // remainders are counted exactly as before; a whole tractate's
      // remainder no longer gets typeset again for every probe (that made
      // each page cost seconds and grow with the book).
      const capLines = Math.ceil((contentHeight * 2.5) / Math.max(4, lineH));
      const capWidth = capLines * targetWidth;
      // first index whose running width passes the cap (prefix sums +
      // binary search; walking the words for every probe was a hot spot)
      let prefix = prefixWidthCache.get(words);
      if (!prefix) {
        prefix = new Float64Array(words.length + 1);
        for (let i = 0; i < words.length; i++) prefix[i + 1] = prefix[i] + words[i].width + 3;
        prefixWidthCache.set(words, prefix);
      }
      let lo = startIdx;
      let hi = words.length;
      const limit = prefix[startIdx] + capWidth;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (prefix[mid] <= limit) lo = mid + 1;
        else hi = mid;
      }
      const endIdx = Math.min(words.length, lo + 1);
      const counted = engine.countGreedyLines(words, startIdx, endIdx, targetWidth, role, unitId ?? 'unit-1');
      if (trialLineCache.size > 4096) trialLineCache.clear();
      trialLineCache.set(key, counted);
      return counted;
    };

    const totalFlankOnlyLinesR = hasRashi
      ? countTrialLines(
          commentEngine,
          structuredRashiWords,
          0,
          defaultRashiWidth,
          'primary_comment',
          rashiUnitId,
          commentLineHeight
        )
      : 0;
    const totalFlankOnlyLinesT = hasTosafot
      ? countTrialLines(
          commentEngine,
          structuredTosafotWords,
          0,
          defaultTosafotWidth,
          'secondary_comment',
          tosafotUnitId,
          commentLineHeight
        )
      : 0;

    let upperKneeLines = 0;
    if (activeFlankCount > 0 && structuredSourceWords.length > 0) {
      const minRequiredFlankLinesR = totalFlankOnlyLinesR >= 3 ? 2 : totalFlankOnlyLinesR >= 2 ? 1 : 0;
      const minRequiredFlankLinesT = totalFlankOnlyLinesT >= 3 ? 2 : totalFlankOnlyLinesT >= 2 ? 1 : 0;

      for (let tryK = candidate.upperKneeLines; tryK >= 1; tryK--) {
        // Trial-consume `tryK` top-wrap lines using real shaped word metrics
        let simRIdx = 0;
        let simTIdx = 0;
        for (let step = 0; step < tryK; step++) {
          const rAct = simRIdx < structuredRashiWords.length;
          const tAct = simTIdx < structuredTosafotWords.length;
          if (!rAct && !tAct) break;
          const rW = rAct && tAct ? plannedTopRashiW : contentWidth;
          const tW = rAct && tAct ? plannedTopTosafotW : contentWidth;
          if (rAct) {
            const rStep = this.consumeOneLine(
              commentEngine,
              structuredRashiWords,
              simRIdx,
              rW,
              'primary_comment',
              rashiUnitId,
              step,
              commentAscent,
              commentLineHeight,
              'upper_collar'
            );
            if (rStep) simRIdx = rStep.nextWordIndex;
          }
          if (tAct) {
            const tStep = this.consumeOneLine(
              commentEngine,
              structuredTosafotWords,
              simTIdx,
              tW,
              'secondary_comment',
              tosafotUnitId,
              step,
              commentAscent,
              commentLineHeight,
              'upper_collar'
            );
            if (tStep) simTIdx = tStep.nextWordIndex;
          }
        }

        const remFlankLinesR = hasRashi
          ? countTrialLines(
              commentEngine,
              structuredRashiWords,
              simRIdx,
              defaultRashiWidth,
              'primary_comment',
              rashiUnitId,
              commentLineHeight
            )
          : 0;
        const remFlankLinesT = hasTosafot
          ? countTrialLines(
              commentEngine,
              structuredTosafotWords,
              simTIdx,
              defaultTosafotWidth,
              'secondary_comment',
              tosafotUnitId,
              commentLineHeight
            )
          : 0;

        const rSatisfied = !hasRashi || remFlankLinesR >= minRequiredFlankLinesR;
        const tSatisfied = !hasTosafot || remFlankLinesT >= minRequiredFlankLinesT;
        if (rSatisfied && tSatisfied) {
          upperKneeLines = tryK;
          break;
        }
      }
    }

    const rashiLines: TypesetLine[] = [];
    const tosafotLines: TypesetLine[] = [];
    let rIdx = 0;
    let tIdx = 0;
    let curRashiY = commentAscent;
    let curTosafotY = commentAscent;
    let lineCounter = 0;
    // Vilna: below / beside the end of the Gemara, the commentary with
    // less text left keeps its own column width, and the one with more
    // text spreads under the Gemara (never the other way round, and
    // never whichever commentary happens to set its line first).
    const vilnaFlankW = (side: 'r' | 't'): number => {
      const ls = side === 'r' ? rashiLines : tosafotLines;
      for (let q = ls.length - 1; q >= 0; q--) {
        const l = ls[q];
        if (l.zoneType === 'flanking_source' && l.xLeft !== undefined && l.xRight !== undefined) return l.xRight - l.xLeft;
      }
      return Math.max(minCommentW, side === 'r' ? defaultRashiWidth : defaultTosafotWidth);
    };
    const vilnaClampIv = <T extends { xLeft: number; xRight: number; width: number }>(side: 'r' | 't', iv: T | undefined): T | undefined => {
      if (!vilnaShape || !iv) return iv;
      // While the Gemara continues, each commentary stays in its own
      // column beside it — it never cuts into the Gemara's space.
      if (sIdx < structuredSourceWords.length && structuredSourceWords.length > 0) {
        // its own column at the page's outer edge — or no line at this height
        const w = vilnaFlankW(side);
        const colL = side === 'r' ? contentWidth - w : 0;
        const colR = side === 'r' ? contentWidth : w;
        if (iv.xLeft > colL + 1 || iv.xRight < colR - 1) return undefined;
        return { ...iv, xLeft: colL, xRight: colR, width: colR - colL };
      }
      const remRWords = structuredRashiWords.length - rIdx;
      const remTWords = structuredTosafotWords.length - tIdx;
      if (remRWords <= 0 || remTWords <= 0) return iv;
      const shorter: 'r' | 't' = remRWords < remTWords ? 'r' : 't';
      let { xLeft, xRight } = iv;
      if (side === shorter) {
        const w = vilnaFlankW(side);
        if (side === 'r') xLeft = Math.max(xLeft, xRight - w);
        else xRight = Math.min(xRight, xLeft + w);
      } else {
        const other = vilnaFlankW(shorter);
        if (side === 'r') xLeft = Math.max(xLeft, other + gutter);
        else xRight = Math.min(xRight, contentWidth - other - gutter);
      }
      if (xRight - xLeft < minCommentW - eps) return iv;
      return { ...iv, xLeft, xRight, width: xRight - xLeft };
    };
    const countTrailingLinesForUnit = (arr: TypesetLine[], uid?: string): number => {
      if (!uid) return 0;
      let c = 0;
      for (let i = arr.length - 1; i >= 0 && arr[i].unitId === uid; i--) c++;
      return c;
    };

    // Execute Phase 1 Top-Wrap Commentary placement first, registering each line into `spatial`
    for (let k = 0; k < upperKneeLines; k++) {
      const rActive = rIdx < structuredRashiWords.length;
      const tActive = tIdx < structuredTosafotWords.length;
      if (!rActive && !tActive) break;

      if (rActive && tActive) {
        // Coherent top wrap: Rashi and Tosafot meet cleanly at the center gutter with NO empty hole!
        const rRight = contentWidth;
        const rLeft = rRight - plannedTopRashiW;
        const rRes = this.consumeOneLine(
          commentEngine,
          structuredRashiWords,
          rIdx,
          plannedTopRashiW,
          'primary_comment',
          rashiUnitId,
          lineCounter,
          curRashiY,
          commentLineHeight,
          'upper_collar',
          countTrailingLinesForUnit(rashiLines, structuredRashiWords[rIdx]?.unitId)
        );
        if (rRes) {
          spatial.registerLine(rRes.line, rLeft, rRight, 'rashi');
          rashiLines.push(rRes.line);
          rIdx = rRes.nextWordIndex;
          curRashiY += commentLineHeight + (rRes.line.spaceAfterPt ?? 0);
        } else {
          curRashiY += commentLineHeight;
        }

        const tLeft = 0;
        const tRight = tLeft + plannedTopTosafotW;
        const tRes = this.consumeOneLine(
          commentEngine,
          structuredTosafotWords,
          tIdx,
          plannedTopTosafotW,
          'secondary_comment',
          tosafotUnitId,
          lineCounter,
          curTosafotY,
          commentLineHeight,
          'upper_collar',
          countTrailingLinesForUnit(tosafotLines, structuredTosafotWords[tIdx]?.unitId)
        );
        if (tRes) {
          spatial.registerLine(tRes.line, tLeft, tRight, 'tosafot');
          tosafotLines.push(tRes.line);
          tIdx = tRes.nextWordIndex;
          curTosafotY += commentLineHeight + (tRes.line.spaceAfterPt ?? 0);
        } else {
          curTosafotY += commentLineHeight;
        }
      } else if (rActive) {
        // Single commentary wrapping across the full top width above the Source
        const rCollarW = contentWidth;
        const rRes = this.consumeOneLine(
          commentEngine,
          structuredRashiWords,
          rIdx,
          rCollarW,
          'primary_comment',
          rashiUnitId,
          lineCounter,
          curRashiY,
          commentLineHeight,
          'upper_collar',
          countTrailingLinesForUnit(rashiLines, structuredRashiWords[rIdx]?.unitId)
        );
        if (rRes) {
          spatial.registerLine(rRes.line, 0, contentWidth, 'rashi');
          rashiLines.push(rRes.line);
          rIdx = rRes.nextWordIndex;
          curRashiY += commentLineHeight + (rRes.line.spaceAfterPt ?? 0);
        } else {
          curRashiY += commentLineHeight;
        }
      } else if (tActive) {
        // Single Tosafot commentary wrapping across the full top width above the Source
        const tCollarW = contentWidth;
        const tRes = this.consumeOneLine(
          commentEngine,
          structuredTosafotWords,
          tIdx,
          tCollarW,
          'secondary_comment',
          tosafotUnitId,
          lineCounter,
          curTosafotY,
          commentLineHeight,
          'upper_collar',
          countTrailingLinesForUnit(tosafotLines, structuredTosafotWords[tIdx]?.unitId)
        );
        if (tRes) {
          spatial.registerLine(tRes.line, 0, contentWidth, 'tosafot');
          tosafotLines.push(tRes.line);
          tIdx = tRes.nextWordIndex;
          curTosafotY += commentLineHeight + (tRes.line.spaceAfterPt ?? 0);
        } else {
          curTosafotY += commentLineHeight;
        }
      }

      lineCounter++;
    }

    const actualUpperKneeLines = lineCounter;
    const upperKneeHeight =
      actualUpperKneeLines > 0
        ? Math.max(
            0,
            ...rashiLines.map(l => (l.yBottom ?? l.yBaseline + commentDescent) + (l.spaceAfterPt ?? 0)),
            ...tosafotLines.map(l => (l.yBottom ?? l.yBaseline + commentDescent) + (l.spaceAfterPt ?? 0))
          )
        : 0;
    // Ensure flanking streams don't start above upper collar clearance if one stream was inactive during collar
    curRashiY = Math.max(curRashiY, upperKneeLines > 0 ? upperKneeHeight + commentAscent - 0.5 : commentAscent);
    curTosafotY = Math.max(curTosafotY, upperKneeLines > 0 ? upperKneeHeight + commentAscent - 0.5 : commentAscent);
    // Set gemaraStartY so that the first Source line's yTop (`curSourceY - sourceAscent`) is strictly >= `upperKneeHeight + 4pt`
    // and aligns immediately with the next commentary line after the top wrap!
    const gemaraStartY =
      (actualUpperKneeLines > 0 ? upperKneeHeight + 4.0 : 0) + Math.max(0, input.sourceTopReservePt ?? 0);
    // Layout training T2.2 — the opening-frame reserve is a real obstacle:
    // registered over the Gemara column only, so the commentaries keep
    // flowing beside it (Vilna 2a: Rashi and Tosafot run alongside the
    // frame) instead of seeing one full-width free strip and skipping it.
    const sourceTopReservePt = Math.max(0, input.sourceTopReservePt ?? 0);
    if (sourceTopReservePt > 0) {
      spatial.registerRegion({
        id: 'opening-frame-reserve',
        role: 'ornament',
        xLeft: hasTosafot ? defaultTosafotWidth + gutter : 0,
        xRight: hasRashi ? contentWidth - defaultRashiWidth - gutter : contentWidth,
        yTop: gemaraStartY - sourceTopReservePt,
        yBottom: gemaraStartY,
      });
    }

    // Stage 21G: Verified Commentary Clearance Solver:
    // Calculate the actual geometric vertical clearance needed for commentary to wrap beneath the central Gemara column.
    let requiredCommentClearancePt = 0;
    if (activeFlankCount > 0) {
      const remRashiWordsAfterTop = structuredRashiWords.slice(rIdx);
      const remTosafotWordsAfterTop = structuredTosafotWords.slice(tIdx);
      const totalTrialRashiLines =
        remRashiWordsAfterTop.length > 0
          ? countTrialLines(
              commentEngine,
              structuredRashiWords,
              rIdx,
              Math.max(minCommentW, defaultRashiWidth),
              'primary_comment',
              rashiUnitId,
              commentLineHeight
            )
          : 0;
      const totalTrialTosafotLines =
        remTosafotWordsAfterTop.length > 0
          ? countTrialLines(
              commentEngine,
              structuredTosafotWords,
              tIdx,
              Math.max(minCommentW, defaultTosafotWidth),
              'secondary_comment',
              tosafotUnitId,
              commentLineHeight
            )
          : 0;

      const maxPossibleSourceH = Math.max(0, contentHeight - gemaraStartY);
      const maxFlankCommentLines = Math.floor(maxPossibleSourceH / commentLineHeight);

      const excessRashiLines = Math.max(0, totalTrialRashiLines - maxFlankCommentLines);
      const excessTosafotLines = Math.max(0, totalTrialTosafotLines - maxFlankCommentLines);

      if (vilnaShape && (excessRashiLines > 0 || excessTosafotLines > 0)) {
        // Vilna bottom: the shorter commentary continues in its own column
        // (its flank width); the longer one spreads under the Gemara
        // beside it, and over the full width once the shorter ends.
        const fR = Math.max(minCommentW, defaultRashiWidth);
        const fT = Math.max(minCommentW, defaultTosafotWidth);
        const rLonger = excessRashiLines >= excessTosafotLines;
        const shortEx = rLonger ? excessTosafotLines : excessRashiLines;
        const longEx = rLonger ? excessRashiLines : excessTosafotLines;
        const longFlank = rLonger ? fR : fT;
        const shortFlank = rLonger ? fT : fR;
        const wideW = Math.max(longFlank, contentWidth - gutter - shortFlank);
        // long-commentary lines (in flank-width units) absorbed beside the short column
        const absorbed = (shortEx * wideW) / longFlank;
        const restFull = Math.max(0, longEx - absorbed) * (longFlank / contentWidth);
        requiredCommentClearancePt = Math.ceil(shortEx + restFull) * commentLineHeight;
      } else if (excessRashiLines > 0 && excessTosafotLines > 0) {
        const lowerSplitLines = Math.max(
          Math.ceil(excessRashiLines / 1.75),
          Math.ceil(excessTosafotLines / 1.75)
        );
        requiredCommentClearancePt = lowerSplitLines * commentLineHeight;
      } else if (excessRashiLines > 0) {
        const lowerFullLines = Math.ceil(excessRashiLines / 2.4);
        requiredCommentClearancePt = lowerFullLines * commentLineHeight;
      } else if (excessTosafotLines > 0) {
        const lowerFullLines = Math.ceil(excessTosafotLines / 2.4);
        requiredCommentClearancePt = lowerFullLines * commentLineHeight;
      }
    }

    maxSourceEndY =
      requiredCommentClearancePt > 0
        ? Math.max(gemaraStartY + 2 * sourceLineHeight, contentHeight - requiredCommentClearancePt - 4.0)
        : contentHeight + 2.0;

    if (actualUpperKneeLines > 0) {
      editorialDecisions.push(
        `עטיפת ברך עליונה (Vilna Top-Wrap): ${actualUpperKneeLines} שורות מפרשים עוטפות את המקור מלמעלה ברצף מלא ללא חור מרכזי.`
      );
    }

    // Phase 2: Jointly solve line-by-line Source Contour & Flanking Commentary Flow!
    // Exact Y-band synchronization without lookahead notches or post-Source overruns:
    // 1. Before placing a Source line `[sBandTop, sBandBottom]`, we first advance any flanking
    //    commentary lines whose vertical band `[cTop, cBottom]` starts strictly above `sBandTop`
    //    and overlaps the preceding vertical band (`cBottom <= sBandTop + 1.5` or `cTop < sBandTop - eps`).
    //    Wait: if a Source line is about to contract its width at `sBandTop` (entering `stepped_knee`),
    //    any commentary line whose `cTop` is already in `[sBandTop - commentLineHeight * 0.5 .. sBandBottom]`
    //    must see the contracted Source contour, whereas any commentary line that was ALREADY placed
    //    and overlaps `sBandTop` (`lastRashiBottom > sBandTop + 1.5`) still occupies the pre-contraction
    //    flank, so the Source must NOT contract until `sBandTop >= lastRashiBottom - 1.5`!
    //    This guarantees ZERO 1-line notches between Source contraction and Commentary knee expansion!
    // 2. After registering the Source line `[sBandTop, sBandBottom]`, we advance flanking commentary lines
    //    whose `cTop = curCommentaryY - commentAscent` is strictly `< sBandBottom - 1.5` (and if this is
    //    the final Source line `sIdx >= structuredSourceWords.length`, we require `cBottom <= sBandBottom + 1.5`
    //    so a commentary line that extends below the ended Source is placed in Phase 3 across the full lower width
    //    instead of leaving a 1-line post-Source stepped-knee remnant!).
    const sourceLines: TypesetLine[] = [];
    const sourceContourBands: SourceContourBand[] = [];
    let sIdx = 0;
    let curSourceY = gemaraStartY + sourceAscent;
    let sourceLineCounter = 0;

    const estInitialSourceLines = Math.max(
      1,
      countTrialLines(
        sourceEngine,
        structuredSourceWords,
        0,
        defaultSourceWidth,
        'main_source',
        sourceUnitId,
        sourceLineHeight
      )
    );
    const junctionRatio =
      manualJunctionPercent !== undefined
        ? manualJunctionPercent / 100.0
        : candidate.stepJunctionRatio ?? 0.56;
    const kneeTriggerLineIdx = Math.max(2, Math.floor(estInitialSourceLines * junctionRatio));

    let upperSourceWidthRecorded = defaultSourceWidth;
    let lowerSourceWidthRecorded = defaultSourceWidth;
    let kneeJunctionY = gemaraStartY + kneeTriggerLineIdx * sourceLineHeight;
    let isLeftStepped = true;
    let kneeContractedActive = false;

    while (
      sIdx < structuredSourceWords.length &&
      curSourceY + sourceDescent <= maxSourceEndY
    ) {
      const sBandTop = curSourceY - sourceAscent;
      const sBandBottom = curSourceY + sourceDescent;

      // Advance any flanking commentary lines whose vertical midpoint (`cTop + 0.5 * (cBottom - cTop)`)
      // lies strictly above `sBandTop` BEFORE evaluating or registering this Source line!
      while (
        rIdx < structuredRashiWords.length &&
        curRashiY - commentAscent + (commentAscent + commentDescent) * 0.5 < sBandTop &&
        curRashiY + commentDescent <= contentHeight + 2.0
      ) {
        const cTop = curRashiY - commentAscent;
        const cBottom = curRashiY + commentDescent;
        const freeIvs = spatial.queryAvailableIntervals(cTop, cBottom, gutter, commentClear);
        const rightIv = vilnaClampIv('r', freeIvs[freeIvs.length - 1]);

        if (
          rightIv &&
          rightIv.xRight > contentWidth * 0.52 &&
          rightIv.width + eps >= minCommentW &&
          rightIv.width < contentWidth * 0.75
        ) {
          const zone: TypesetLine['zoneType'] =
            rightIv.width > defaultRashiWidth + 4 ? 'stepped_knee' : 'flanking_source';
          const rRes = this.consumeOneLine(
            commentEngine,
            structuredRashiWords,
            rIdx,
            rightIv.width,
            'primary_comment',
            rashiUnitId,
            lineCounter,
            curRashiY,
            commentLineHeight,
            zone,
            countTrailingLinesForUnit(rashiLines, structuredRashiWords[rIdx]?.unitId)
          );
          if (rRes) {
            spatial.registerLine(rRes.line, rightIv.xLeft, rightIv.xRight, 'rashi');
            rashiLines.push(rRes.line);
            rIdx = rRes.nextWordIndex;
            curRashiY += commentLineHeight + (rRes.line.spaceAfterPt ?? 0);
            lineCounter++;
            continue;
          }
        }
        curRashiY += commentLineHeight;
        lineCounter++;
      }

      while (
        tIdx < structuredTosafotWords.length &&
        curTosafotY - commentAscent + (commentAscent + commentDescent) * 0.5 < sBandTop &&
        curTosafotY + commentDescent <= contentHeight + 2.0
      ) {
        const cTop = curTosafotY - commentAscent;
        const cBottom = curTosafotY + commentDescent;
        const freeIvs = spatial.queryAvailableIntervals(cTop, cBottom, gutter, commentClear);
        const leftIv = vilnaClampIv('t', freeIvs[0]);

        if (
          leftIv &&
          leftIv.xLeft < contentWidth * 0.48 &&
          leftIv.width + eps >= minCommentW &&
          leftIv.width < contentWidth * 0.75
        ) {
          const zone: TypesetLine['zoneType'] =
            leftIv.width > defaultTosafotWidth + 4 ? 'stepped_knee' : 'flanking_source';
          const tRes = this.consumeOneLine(
            commentEngine,
            structuredTosafotWords,
            tIdx,
            leftIv.width,
            'secondary_comment',
            tosafotUnitId,
            lineCounter,
            curTosafotY,
            commentLineHeight,
            zone,
            countTrailingLinesForUnit(tosafotLines, structuredTosafotWords[tIdx]?.unitId)
          );
          if (tRes) {
            spatial.registerLine(tRes.line, leftIv.xLeft, leftIv.xRight, 'tosafot');
            tosafotLines.push(tRes.line);
            tIdx = tRes.nextWordIndex;
            curTosafotY += commentLineHeight + (tRes.line.spaceAfterPt ?? 0);
            lineCounter++;
            continue;
          }
        }
        curTosafotY += commentLineHeight;
        lineCounter++;
      }

      const lastRashiBottom =
        rashiLines.length > 0
          ? rashiLines[rashiLines.length - 1].yBottom ??
            rashiLines[rashiLines.length - 1].yBaseline + commentDescent
          : 0;
      const lastTosafotBottom =
        tosafotLines.length > 0
          ? tosafotLines[tosafotLines.length - 1].yBottom ??
            tosafotLines[tosafotLines.length - 1].yBaseline + commentDescent
          : 0;

      // A commentary side is occupied at this Source band if either:
      // 1. It still has unplaced words (`rIdx < structuredRashiWords.length`), OR
      // 2. Its last placed flanking line overlaps `[sBandTop, sBandBottom]` by > 1.5pt (`lastBottom > sBandTop + 1.5`)
      const rOccupiesRightHere =
        rIdx < structuredRashiWords.length ||
        (hasRashi && lastRashiBottom > sBandTop + 1.5 && sBandTop > gemaraStartY + 1.5);
      const tOccupiesLeftHere =
        tIdx < structuredTosafotWords.length ||
        (hasTosafot && lastTosafotBottom > sBandTop + 1.5 && sBandTop > gemaraStartY + 1.5);

      // Measure remaining vertical heights using actual trial line counts in current flanking widths
      const remSourceLinesHere = countTrialLines(
        sourceEngine,
        structuredSourceWords,
        sIdx,
        defaultSourceWidth,
        'main_source',
        sourceUnitId,
        sourceLineHeight
      );
      const remRashiLinesHere =
        rIdx < structuredRashiWords.length
          ? countTrialLines(
              commentEngine,
              structuredRashiWords,
              rIdx,
              Math.max(minCommentW, defaultRashiWidth),
              'primary_comment',
              rashiUnitId,
              commentLineHeight
            )
          : 0;
      const remTosafotLinesHere =
        tIdx < structuredTosafotWords.length
          ? countTrialLines(
              commentEngine,
              structuredTosafotWords,
              tIdx,
              Math.max(minCommentW, defaultTosafotWidth),
              'secondary_comment',
              tosafotUnitId,
              commentLineHeight
            )
          : 0;

      const remSourceHeightPt = remSourceLinesHere * sourceLineHeight;
      const remRashiHeightPt = remRashiLinesHere * commentLineHeight;
      const remTosafotHeightPt = remTosafotLinesHere * commentLineHeight;

      // Verified commentary clearance constraint:
      // If remaining commentary lines require lower wrap space beneath Gemara,
      // terminate Source when available vertical space below equals required lower commentary clearance!
      const vilnaLowerLines = (): number => {
        // Commentary lines that still fit BESIDE the rest of the Gemara
        // need no room below it; the rest wraps below in the Vilna shape
        // (shorter commentary in its column, longer one spread).
        const beside = Math.floor(remSourceHeightPt / commentLineHeight);
        const exR = Math.max(0, remRashiLinesHere - beside);
        const exT = Math.max(0, remTosafotLinesHere - beside);
        if (exR === 0 && exT === 0) return 0;
        const fR = Math.max(minCommentW, defaultRashiWidth);
        const fT = Math.max(minCommentW, defaultTosafotWidth);
        const rLonger = exR >= exT;
        const shortEx = rLonger ? exT : exR;
        const longEx = rLonger ? exR : exT;
        const longFlank = rLonger ? fR : fT;
        const shortFlank = rLonger ? fT : fR;
        const wideW = Math.max(longFlank, contentWidth - gutter - shortFlank);
        const absorbed = (shortEx * wideW) / longFlank;
        const restFull = Math.max(0, longEx - absorbed) * (longFlank / contentWidth);
        return Math.ceil(shortEx + restFull);
      };
      const dynamicLowerLines = vilnaShape
        ? vilnaLowerLines()
        : remRashiLinesHere > 0 && remTosafotLinesHere > 0
          ? Math.max(Math.ceil(remRashiLinesHere / 1.75), Math.ceil(remTosafotLinesHere / 1.75))
          : remRashiLinesHere > 0
          ? Math.ceil(remRashiLinesHere / 2.4)
          : remTosafotLinesHere > 0
          ? Math.ceil(remTosafotLinesHere / 2.4)
          : 0;
      const dynamicClearancePt = dynamicLowerLines * commentLineHeight;
      // v0.9.8 Phase 4 — cap the clearance so the Source is never
      // starved entirely. MEASURED (probe, before this fix): with
      // commentary ~3.5× the source, dynamicClearancePt exceeded the
      // whole content height, so `contentHeight - clearance - 2` went
      // negative and this `break` fired BEFORE THE FIRST source line —
      // a page of pure commentary with zero Gemara lines. A first cap
      // (leave 2 source lines) only bought 1 line, because the reserve
      // still claimed the whole page for commentary that cannot fit on
      // one page at all. The reserve is therefore ALSO capped at half
      // the usable page height below the Gemara start — the same 50%
      // the default knee junction uses — so the source always gets at
      // least half the page and the overflow commentary flows to the
      // next page via the paginator's consumed-word counts instead of
      // evicting the source from its own page. The Stage 21G
      // `maxSourceEndY` floor (gemaraStartY + 2 source lines) still
      // applies as the absolute minimum.
      const cappedClearancePt = Math.max(
        0,
        Math.min(
          dynamicClearancePt,
          (contentHeight - gemaraStartY) * 0.5,
          contentHeight - gemaraStartY - 2 * sourceLineHeight - sourceDescent - 2.0
        )
      );
      if (
        cappedClearancePt > 0 &&
        curSourceY + sourceLineHeight + sourceDescent > contentHeight - cappedClearancePt - 2.0
      ) {
        break;
      }

      // Synchronized boundary check for knee contraction:
      // Do NOT contract the Source on a given side if an already-placed narrower commentary line
      // on that side still overlaps `[sBandTop, sBandBottom]` by > 1.5pt! Wait until the next
      // commentary line (`curCommentaryY - commentAscent`) can immediately step into the freed knee space!
      const rReadyToStepInward = lastRashiBottom <= sBandTop + 1.5;
      const tReadyToStepInward = lastTosafotBottom <= sBandTop + 1.5;

      // Determine the exact horizontal interval `[sLeft, sRight]` for this Source line:
      let sLeft = 0;
      let sRight = contentWidth;
      let sZone: TypesetLine['zoneType'] = 'flanking_source';

      // Evaluate actual remaining Source geometry before allowing a single-line width jump (Priority 5 / H-2):
      // If a commentary has ended on one or both sides, check whether expanding the Source width
      // would produce at least 2 real Source lines at the wider width (`trialLinesAtWider >= 2`)!
      // If expanding the Source width would only produce a SINGLE closing line at the wider width
      // (whereas keeping the established Source column bounds `[prevSLeft, prevSRight]` flows 1–2 clean lines
      // aligned with the column above), keep `[prevSLeft, prevSRight]` so the final line never jumps its right/left margin for a 1-line tail!
      const prevSourceLine = sourceLines.length > 0 ? sourceLines[sourceLines.length - 1] : null;
      const prevSLeft =
        prevSourceLine?.xLeft ?? (hasTosafot ? defaultTosafotWidth + gutter : 0);
      const prevSRight =
        prevSourceLine?.xRight ?? (hasRashi ? contentWidth - defaultRashiWidth - gutter : contentWidth);
      const prevSWidth = Math.max(minSourceW, prevSRight - prevSLeft);
      const remSourceWordsSlice = structuredSourceWords.slice(sIdx);
      const remSourceNaturalWidth =
        remSourceWordsSlice.reduce((s, w) => s + w.width, 0) +
        Math.max(0, remSourceWordsSlice.length - 1) *
          sourceEngine.getShaper().shapeWord(' ').width;
      const fitsInSinglePrevWidthLine =
        sourceLines.length > 0 &&
        remSourceWordsSlice.length > 0 &&
        remSourceNaturalWidth <= prevSWidth * 0.96;

      // Also check how many lines would be produced if we widen to `contentWidth`:
      const trialFullWidthSourceLines =
        sourceLines.length > 0
          ? countTrialLines(
              sourceEngine,
              structuredSourceWords,
              sIdx,
              contentWidth,
              'main_source',
              sourceUnitId,
              sourceLineHeight
            )
          : 2;
      const prevWasAlreadyWide = prevSRight - prevSLeft > defaultSourceWidth + 20;
      const keepPrevSourceBounds =
        sourceLines.length > 0 &&
        !prevWasAlreadyWide &&
        (fitsInSinglePrevWidthLine || trialFullWidthSourceLines <= 1);

      if (!rOccupiesRightHere && !tOccupiesLeftHere) {
        if (keepPrevSourceBounds) {
          // Keep the established column bounds so the closing Source line(s) do not jump margins for a 1-line tail
          sLeft = prevSLeft;
          sRight = prevSRight;
          sZone = prevSourceLine?.zoneType ?? 'flanking_source';
        } else {
          // Both commentaries have ended and vertically cleared, and >= 2 wide Source lines remain:
          // Reclaim full available horizontal width (`[0 .. contentWidth]`) in authentic RTL alignment!
          sLeft = 0;
          sRight = contentWidth;
          sZone = 'single_side_wrap';
        }
      } else if (rOccupiesRightHere && !tOccupiesLeftHere) {
        // Only Rashi occupies the right; Tosafot has ended and cleared on the left:
        const shouldStepForRashi =
          kneeContractedActive ||
          (sourceLineCounter >= kneeTriggerLineIdx &&
            remRashiHeightPt > remSourceHeightPt &&
            rReadyToStepInward);
        if (shouldStepForRashi && !kneeContractedActive) {
          kneeContractedActive = true;
          kneeJunctionY = sBandTop;
        }
        const rWidthHere = shouldStepForRashi
          ? Math.min(
              contentWidth - minSourceW - gutter,
              Math.round(defaultRashiWidth + defaultSourceWidth * (1 - Math.min(0.92, candidate.stepLowerRatio)))
            )
          : defaultRashiWidth;
        sRight = contentWidth - rWidthHere - gutter;
        const trialLeftExpandedLines =
          sourceLines.length > 0
            ? countTrialLines(
                sourceEngine,
                structuredSourceWords,
                sIdx,
                sRight,
                'main_source',
                sourceUnitId,
                sourceLineHeight
              )
            : 2;
        const canReclaimLeftFlank =
          !hasTosafot ||
          ((structuredTosafotWords.length <= 65 || commentaryHoleReclaim) &&
            !fitsInSinglePrevWidthLine &&
            trialLeftExpandedLines >= 3);
        sLeft = !canReclaimLeftFlank
          ? Math.min(prevSLeft, sRight - minSourceW)
          : 0;
        sZone = shouldStepForRashi ? 'stepped_knee' : 'flanking_source';
      } else if (!rOccupiesRightHere && tOccupiesLeftHere) {
        // Only Tosafot occupies the left; Rashi has ended and cleared on the right:
        // Only expand Source into the right Rashi flank if Rashi was NEVER present on this page (`!hasRashi`)
        // OR if Rashi has already been cleared for >= 2 lines and the remaining Tosafot is not disproportionately longer
        // than the remaining Source (`remTosafotHeightPt <= remSourceHeightPt * 1.4`).
        // Otherwise keep the central Source column anchored in its traditional central bounds so the right flank
        // remains clean or allows Tosafot/Rashi to wrap beneath the Gemara!
        const shouldStepForTosafot =
          kneeContractedActive ||
          (sourceLineCounter >= kneeTriggerLineIdx &&
            remTosafotHeightPt > remSourceHeightPt &&
            tReadyToStepInward);
        if (shouldStepForTosafot && !kneeContractedActive) {
          kneeContractedActive = true;
          kneeJunctionY = sBandTop;
        }
        const tWidthHere = shouldStepForTosafot
          ? Math.min(
              contentWidth - minSourceW - gutter,
              Math.round(defaultTosafotWidth + defaultSourceWidth * (1 - Math.min(0.92, candidate.stepLowerRatio)))
            )
          : defaultTosafotWidth;
        sLeft = tWidthHere + gutter;
        const trialRightExpandedLines =
          sourceLines.length > 0
            ? countTrialLines(
                sourceEngine,
                structuredSourceWords,
                sIdx,
                contentWidth - sLeft,
                'main_source',
                sourceUnitId,
                sourceLineHeight
              )
            : 2;
        const canReclaimRightFlank =
          !hasRashi ||
          ((structuredRashiWords.length <= 65 || commentaryHoleReclaim) &&
            !fitsInSinglePrevWidthLine &&
            trialRightExpandedLines >= 3);
        sRight = !canReclaimRightFlank
          ? Math.max(prevSRight, sLeft + minSourceW)
          : contentWidth;
        sZone = shouldStepForTosafot ? 'stepped_knee' : 'flanking_source';
      } else {
        // Both Rashi and Tosafot occupy flanking space alongside this Source band:
        const inLowerKneeZone = sourceLineCounter >= kneeTriggerLineIdx;
        const heavyCommentaryRemains =
          Math.max(remRashiHeightPt, remTosafotHeightPt) > remSourceHeightPt;
        const targetStepLeft =
          manualStepDirection === 'left'
            ? true
            : manualStepDirection === 'right'
            ? false
            : remRashiHeightPt >= remTosafotHeightPt;
        const stepSideReady = targetStepLeft ? rReadyToStepInward : tReadyToStepInward;

        if (
          (kneeContractedActive || (inLowerKneeZone && heavyCommentaryRemains && stepSideReady)) &&
          candidate.stepLowerRatio < 1.0
        ) {
          if (!kneeContractedActive) {
            kneeContractedActive = true;
            isLeftStepped = targetStepLeft;
            kneeJunctionY = sBandTop;
          }
          const contractedW = Math.max(
            minSourceW,
            Math.round(defaultSourceWidth * candidate.stepLowerRatio)
          );
          const deltaW = defaultSourceWidth - contractedW;

          const rExtra = isLeftStepped ? deltaW : 0;
          const tExtra = isLeftStepped ? 0 : deltaW;
          const rWidthHere = defaultRashiWidth + rExtra;
          const tWidthHere = defaultTosafotWidth + tExtra;

          sRight = contentWidth - rWidthHere - gutter;
          sLeft = tWidthHere + gutter;
          sZone = 'stepped_knee';
        } else {
          sRight = contentWidth - defaultRashiWidth - gutter;
          sLeft = defaultTosafotWidth + gutter;
          sZone = 'flanking_source';
        }
      }

      if (vilnaShape && prevSourceLine) {
        // never narrower than the Gemara line above
        sLeft = Math.min(sLeft, prevSLeft);
        sRight = Math.max(sRight, prevSRight);
      }
      // Also intersect `[sLeft, sRight]` with `spatial.queryAvailableIntervals(sBandTop, sBandBottom, gutter, 1.5)`
      // so the Source line is mathematically guaranteed never to collide with any already-registered commentary line!
      const availForSource = spatial.queryAvailableIntervals(sBandTop, sBandBottom, gutter, sourceClear);
      const matchingSourceIv = availForSource.find(
        iv => Math.min(iv.xRight, sRight) - Math.max(iv.xLeft, sLeft) >= minSourceW - eps
      );
      if (!matchingSourceIv) {
        curSourceY += commentLineHeight * 0.5;
        continue;
      }
      sLeft = Math.max(sLeft, matchingSourceIv.xLeft);
      sRight = Math.min(sRight, matchingSourceIv.xRight);

      const targetSourceW = sRight - sLeft;
      if (sourceLineCounter === 0) {
        upperSourceWidthRecorded = targetSourceW;
      } else if (sourceLineCounter >= kneeTriggerLineIdx) {
        lowerSourceWidthRecorded = targetSourceW;
      }

      const sRes = this.consumeOneLine(
        sourceEngine,
        structuredSourceWords,
        sIdx,
        targetSourceW,
        'main_source',
        sourceUnitId,
        sourceLineCounter,
        curSourceY,
        sourceLineHeight,
        sZone,
        countTrailingLinesForUnit(sourceLines, structuredSourceWords[sIdx]?.unitId)
      );
      if (!sRes) break;

      sRes.line.keepPriority =
        sourceLineCounter === 0 ? KeepPriority.HEADING_PARAGRAPH : KeepPriority.PARAGRAPH;
      sRes.line.xStart = Math.max(0, contentWidth - defaultRashiWidth - gutter - sRight);

      const reg = spatial.registerLine(sRes.line, sLeft, sRight, 'source');
      sourceLines.push(sRes.line);
      sIdx = sRes.nextWordIndex;

      sourceContourBands.push({
        yTop: reg.yTop,
        yBottom: reg.yBottom,
        sourceXLeft: sLeft,
        sourceXRight: sRight,
        sourceWidth: targetSourceW,
        leftAvailableWidth: Math.max(0, sLeft - (tOccupiesLeftHere ? gutter : 0)),
        rightAvailableWidth: Math.max(0, contentWidth - sRight - (rOccupiesRightHere ? gutter : 0)),
        zoneType: sZone,
      });

      const isFinalSourceLine =
        sIdx >= structuredSourceWords.length ||
        curSourceY + sourceLineHeight + (sRes.line.spaceAfterPt ?? 0) + sourceDescent > maxSourceEndY;
      const nextSourceBandTop = curSourceY + sourceLineHeight + (sRes.line.spaceAfterPt ?? 0) - sourceAscent;

      // Advance flanking Rashi & Tosafot lines whose vertical band falls within the current Source band!
      while (
        rIdx < structuredRashiWords.length &&
        curRashiY - commentAscent < sBandBottom - 1.5 &&
        curRashiY + commentDescent <= contentHeight + 2.0
      ) {
        const cTop = curRashiY - commentAscent;
        const cBottom = curRashiY + commentDescent;
        if (!isFinalSourceLine && cBottom > nextSourceBandTop + 1.5) {
          break;
        }
        const freeIvs = spatial.queryAvailableIntervals(cTop, cBottom, gutter, commentClear);
        const rightIv = vilnaClampIv('r', freeIvs[freeIvs.length - 1]);
        if (
          rightIv &&
          rightIv.xRight > contentWidth * 0.52 &&
          rightIv.width + eps >= minCommentW
        ) {
          const zone: TypesetLine['zoneType'] =
            rightIv.width > defaultRashiWidth + 4 ? 'stepped_knee' : 'flanking_source';
          const rRes = this.consumeOneLine(
            commentEngine,
            structuredRashiWords,
            rIdx,
            rightIv.width,
            'primary_comment',
            rashiUnitId,
            lineCounter,
            curRashiY,
            commentLineHeight,
            zone,
            countTrailingLinesForUnit(rashiLines, structuredRashiWords[rIdx]?.unitId)
          );
          if (rRes) {
            spatial.registerLine(rRes.line, rightIv.xLeft, rightIv.xRight, 'rashi');
            rashiLines.push(rRes.line);
            rIdx = rRes.nextWordIndex;
            curRashiY += commentLineHeight + (rRes.line.spaceAfterPt ?? 0);
            lineCounter++;
            continue;
          }
        }
        curRashiY += commentLineHeight;
        lineCounter++;
      }

      while (
        tIdx < structuredTosafotWords.length &&
        curTosafotY - commentAscent < sBandBottom - 1.5 &&
        curTosafotY + commentDescent <= contentHeight + 2.0
      ) {
        const cTop = curTosafotY - commentAscent;
        const cBottom = curTosafotY + commentDescent;
        if (!isFinalSourceLine && cBottom > nextSourceBandTop + 1.5) {
          break;
        }
        const freeIvs = spatial.queryAvailableIntervals(cTop, cBottom, gutter, commentClear);
        const leftIv = vilnaClampIv('t', freeIvs[0]);
        if (
          leftIv &&
          leftIv.xLeft < contentWidth * 0.48 &&
          leftIv.width + eps >= minCommentW
        ) {
          const zone: TypesetLine['zoneType'] =
            leftIv.width > defaultTosafotWidth + 4 ? 'stepped_knee' : 'flanking_source';
          const tRes = this.consumeOneLine(
            commentEngine,
            structuredTosafotWords,
            tIdx,
            leftIv.width,
            'secondary_comment',
            tosafotUnitId,
            lineCounter,
            curTosafotY,
            commentLineHeight,
            zone,
            countTrailingLinesForUnit(tosafotLines, structuredTosafotWords[tIdx]?.unitId)
          );
          if (tRes) {
            spatial.registerLine(tRes.line, leftIv.xLeft, leftIv.xRight, 'tosafot');
            tosafotLines.push(tRes.line);
            tIdx = tRes.nextWordIndex;
            curTosafotY += commentLineHeight + (tRes.line.spaceAfterPt ?? 0);
            lineCounter++;
            continue;
          }
        }
        curTosafotY += commentLineHeight;
        lineCounter++;
      }

      curSourceY += sourceLineHeight + (sRes.line.spaceAfterPt ?? 0);
      sourceLineCounter++;
    }

    const actualSourceEndY =
      sourceLines.length > 0
        ? (sourceLines[sourceLines.length - 1].yBottom ??
            sourceLines[sourceLines.length - 1].yBaseline + sourceDescent) + 6.0
        : gemaraStartY;

    // Phase 3: Finish flowing any remaining flanking or lower-wrapping Commentary lines
    // down to `contentHeight` using `spatial.queryAvailableIntervals`!
    let hasLowerSplitZone = false;

    while (
      (rIdx < structuredRashiWords.length && curRashiY + commentDescent <= contentHeight + 2.0) ||
      (tIdx < structuredTosafotWords.length && curTosafotY + commentDescent <= contentHeight + 2.0)
    ) {
      const rCanRun = rIdx < structuredRashiWords.length && curRashiY + commentDescent <= contentHeight + 2.0;
      const tCanRun = tIdx < structuredTosafotWords.length && curTosafotY + commentDescent <= contentHeight + 2.0;
      const minActiveY = rCanRun && tCanRun
        ? Math.min(curRashiY, curTosafotY)
        : rCanRun
        ? curRashiY
        : curTosafotY;
      const stepR = rCanRun && curRashiY <= minActiveY + 0.5;
      const stepT = tCanRun && curTosafotY <= minActiveY + 0.5;
      const targetY = minActiveY;
      const lineTop = targetY - commentAscent;
      const lineBottom = targetY + commentDescent;

      const freeIntervals = spatial.queryAvailableIntervals(lineTop, lineBottom, gutter, commentClear);
      if (freeIntervals.length === 0) {
        if (stepR) curRashiY += commentLineHeight;
        if (stepT) curTosafotY += commentLineHeight;
        lineCounter++;
        continue;
      }

      // Case A: Below the Source — full unobstructed width interval `[0 .. contentWidth]`
      if (freeIntervals.length === 1 && freeIntervals[0].width > contentWidth * 0.75) {
        const fullIv = freeIntervals[0];

        if (rCanRun && tCanRun) {
          hasLowerSplitZone = true;
          const remR = structuredRashiWords.slice(rIdx).reduce((s, w) => s + w.width + 3.5, 0);
          const remT = structuredTosafotWords.slice(tIdx).reduce((s, w) => s + w.width + 3.5, 0);
          const lowerShareR = Math.min(0.62, Math.max(0.38, remR / Math.max(1, remR + remT)));
          const usableLowerW = fullIv.width - gutter;
          let rSplitW = Math.max(minCommentW, Math.round(usableLowerW * lowerShareR));
          let tSplitW = Math.max(minCommentW, usableLowerW - rSplitW);
          if (vilnaShape) {
            // The longer commentary wraps under the Gemara; the shorter
            // continues straight down in its own column (the width it had
            // beside the Gemara).
            if (structuredRashiWords.length - rIdx >= structuredTosafotWords.length - tIdx) {
              const w = vilnaFlankW('t');
              if (w > 0) {
                tSplitW = Math.max(minCommentW, w);
                rSplitW = Math.max(minCommentW, usableLowerW - tSplitW);
              }
            } else {
              const w = vilnaFlankW('r');
              if (w > 0) {
                rSplitW = Math.max(minCommentW, w);
                tSplitW = Math.max(minCommentW, usableLowerW - rSplitW);
              }
            }
          }

          if (stepR) {
            const rRight = fullIv.xRight;
            const rLeft = rRight - rSplitW;
            const rRes = this.consumeOneLine(
              commentEngine,
              structuredRashiWords,
              rIdx,
              rSplitW,
              'primary_comment',
              rashiUnitId,
              lineCounter,
              curRashiY,
              commentLineHeight,
              'lower_split_commentary',
              countTrailingLinesForUnit(rashiLines, structuredRashiWords[rIdx]?.unitId)
            );
            if (rRes) {
              spatial.registerLine(rRes.line, rLeft, rRight, 'rashi');
              rashiLines.push(rRes.line);
              rIdx = rRes.nextWordIndex;
              curRashiY += commentLineHeight + (rRes.line.spaceAfterPt ?? 0);
            } else {
              curRashiY += commentLineHeight;
            }
          }

          if (stepT) {
            const tLeft = fullIv.xLeft;
            const tRight = tLeft + tSplitW;
            const tRes = this.consumeOneLine(
              commentEngine,
              structuredTosafotWords,
              tIdx,
              tSplitW,
              'secondary_comment',
              tosafotUnitId,
              lineCounter,
              curTosafotY,
              commentLineHeight,
              'lower_split_commentary',
              countTrailingLinesForUnit(tosafotLines, structuredTosafotWords[tIdx]?.unitId)
            );
            if (tRes) {
              spatial.registerLine(tRes.line, tLeft, tRight, 'tosafot');
              tosafotLines.push(tRes.line);
              tIdx = tRes.nextWordIndex;
              curTosafotY += commentLineHeight + (tRes.line.spaceAfterPt ?? 0);
            } else {
              curTosafotY += commentLineHeight;
            }
          }
        } else if (stepR) {
          const prevRashiLine = rashiLines[rashiLines.length - 1];
          const prevRWidth = prevRashiLine ? prevRashiLine.targetWidth : defaultRashiWidth;
          const alreadyFullSpan = prevRashiLine?.zoneType === 'lower_full_span';
          const trialFullSpanLines = countTrialLines(
            commentEngine,
            structuredRashiWords,
            rIdx,
            fullIv.width,
            'primary_comment',
            rashiUnitId,
            commentLineHeight
          );
          const justifiesFullSpan = alreadyFullSpan || trialFullSpanLines >= 2;
          const wrapW = justifiesFullSpan ? fullIv.width : prevRWidth;
          const zone: TypesetLine['zoneType'] = justifiesFullSpan
            ? 'lower_full_span'
            : prevRashiLine?.zoneType === 'stepped_knee'
            ? 'stepped_knee'
            : 'lower_split_commentary';

          const rRight = fullIv.xRight;
          const rLeft = rRight - wrapW;
          const rRes = this.consumeOneLine(
            commentEngine,
            structuredRashiWords,
            rIdx,
            wrapW,
            'primary_comment',
            rashiUnitId,
            lineCounter,
            curRashiY,
            commentLineHeight,
            zone,
            countTrailingLinesForUnit(rashiLines, structuredRashiWords[rIdx]?.unitId)
          );
          if (rRes) {
            spatial.registerLine(rRes.line, rLeft, rRight, 'rashi');
            rashiLines.push(rRes.line);
            rIdx = rRes.nextWordIndex;
            curRashiY += commentLineHeight + (rRes.line.spaceAfterPt ?? 0);
          } else {
            curRashiY += commentLineHeight;
          }
        } else if (stepT) {
          const prevTosLine = tosafotLines[tosafotLines.length - 1];
          const prevTWidth = prevTosLine ? prevTosLine.targetWidth : defaultTosafotWidth;
          const alreadyFullSpan = prevTosLine?.zoneType === 'lower_full_span';
          const trialFullSpanLines = countTrialLines(
            commentEngine,
            structuredTosafotWords,
            tIdx,
            fullIv.width,
            'secondary_comment',
            tosafotUnitId,
            commentLineHeight
          );
          const justifiesFullSpan = alreadyFullSpan || trialFullSpanLines >= 2;
          const wrapW = justifiesFullSpan ? fullIv.width : prevTWidth;
          const zone: TypesetLine['zoneType'] = justifiesFullSpan
            ? 'lower_full_span'
            : prevTosLine?.zoneType === 'stepped_knee'
            ? 'stepped_knee'
            : 'lower_split_commentary';

          const tLeft = fullIv.xLeft;
          const tRight = tLeft + wrapW;
          const tRes = this.consumeOneLine(
            commentEngine,
            structuredTosafotWords,
            tIdx,
            wrapW,
            'secondary_comment',
            tosafotUnitId,
            lineCounter,
            curTosafotY,
            commentLineHeight,
            zone,
            countTrailingLinesForUnit(tosafotLines, structuredTosafotWords[tIdx]?.unitId)
          );
          if (tRes) {
            spatial.registerLine(tRes.line, tLeft, tRight, 'tosafot');
            tosafotLines.push(tRes.line);
            tIdx = tRes.nextWordIndex;
            curTosafotY += commentLineHeight + (tRes.line.spaceAfterPt ?? 0);
          } else {
            curTosafotY += commentLineHeight;
          }
        }
      } else {
        // Case B: Flanking intervals alongside the lower lines of the Source or sibling lower split column
        const rightIv = vilnaClampIv('r', freeIntervals[freeIntervals.length - 1]);
        const leftIv = vilnaClampIv('t', freeIntervals[0]);
        let placedRight = false;

        if (
          stepR &&
          rightIv &&
          rightIv.xRight > contentWidth * 0.52 &&
          rightIv.width + eps >= minCommentW
        ) {
          const zone: TypesetLine['zoneType'] =
            rightIv.width > defaultRashiWidth + 4 ? 'stepped_knee' : 'flanking_source';
          const rRes = this.consumeOneLine(
            commentEngine,
            structuredRashiWords,
            rIdx,
            rightIv.width,
            'primary_comment',
            rashiUnitId,
            lineCounter,
            curRashiY,
            commentLineHeight,
            zone,
            countTrailingLinesForUnit(rashiLines, structuredRashiWords[rIdx]?.unitId)
          );
          if (rRes) {
            spatial.registerLine(rRes.line, rightIv.xLeft, rightIv.xRight, 'rashi');
            rashiLines.push(rRes.line);
            rIdx = rRes.nextWordIndex;
            curRashiY += commentLineHeight + (rRes.line.spaceAfterPt ?? 0);
            placedRight = true;
          } else {
            curRashiY += commentLineHeight;
          }
        } else if (stepR) {
          curRashiY += commentLineHeight;
        }

        if (
          stepT &&
          leftIv &&
          (!placedRight || leftIv !== rightIv) &&
          leftIv.xLeft < contentWidth * 0.48 &&
          leftIv.width + eps >= minCommentW
        ) {
          const zone: TypesetLine['zoneType'] =
            leftIv.width > defaultTosafotWidth + 4 ? 'stepped_knee' : 'flanking_source';
          const tRes = this.consumeOneLine(
            commentEngine,
            structuredTosafotWords,
            tIdx,
            leftIv.width,
            'secondary_comment',
            tosafotUnitId,
            lineCounter,
            curTosafotY,
            commentLineHeight,
            zone,
            countTrailingLinesForUnit(tosafotLines, structuredTosafotWords[tIdx]?.unitId)
          );
          if (tRes) {
            spatial.registerLine(tRes.line, leftIv.xLeft, leftIv.xRight, 'tosafot');
            tosafotLines.push(tRes.line);
            tIdx = tRes.nextWordIndex;
            curTosafotY += commentLineHeight + (tRes.line.spaceAfterPt ?? 0);
          } else {
            curTosafotY += commentLineHeight;
          }
        } else if (stepT) {
          curTosafotY += commentLineHeight;
        }
      }

      lineCounter++;
    }

    if (hasLowerSplitZone) {
      editorialDecisions.push(
        'איזון תחתון דו-טורי (Available-Area): מתחת לגמרא רש״י ותוספות נפגשים באמצע העמוד בשני טורים ללא חפיפה.'
      );
    }

    // 4. COLLISION DETECTION VERIFICATION (Problem 2)
    const collisions = spatial.detectCollisions(1.0);
    const splitHalfWidth = (contentWidth - gutter) / 2.0;
    const wideWrapWidth = contentWidth;
    const upperSourceWidth = upperSourceWidthRecorded;
    const lowerSourceWidth = lowerSourceWidthRecorded;
    const innerXOffset = Math.abs(upperSourceWidth - lowerSourceWidth);

    const knee: DynamicKneeContour = {
      pageContentWidth: contentWidth,
      pageContentHeight: contentHeight,
      topY: 0,
      upperKneeY: gemaraStartY,
      upperKneeLines: actualUpperKneeLines,
      upperKneeInwardStep,
      kneeJunctionY: Math.min(kneeJunctionY, actualSourceEndY),
      sourceEndY: actualSourceEndY,
      bottomY: contentHeight,
      upperSourceWidth,
      lowerSourceWidth,
      innerXOffset,
      isLeftStepped,
      rightCommentaryWidth: defaultRashiWidth,
      leftCommentaryWidth: defaultTosafotWidth,
      lowerRightCommentaryWidth: hasLowerSplitZone ? splitHalfWidth : wideWrapWidth,
      lowerLeftCommentaryWidth: hasLowerSplitZone ? splitHalfWidth : defaultTosafotWidth,
      gutterWidth: gutter,
      hasLowerSplitZone,
      sourceContourBands,
    };

    const consumedSourceWords = sIdx;
    const consumedRashiWords = rIdx;
    const consumedTosafotWords = tIdx;

    const unplacedSourceWords = Math.max(0, structuredSourceWords.length - consumedSourceWords);
    const unplacedRashiWords = Math.max(0, structuredRashiWords.length - consumedRashiWords);
    const unplacedTosafotWords = Math.max(0, structuredTosafotWords.length - consumedTosafotWords);
    // When solving one page slice of a multi-page book, unconsumed tail words continue
    // onto the next page cleanly; only count them as overflow errors if nothing at all could fit.
    const scoreUnplacedWords = input.isMultiPageContinuation
      ? (structuredSourceWords.length > 0 && consumedSourceWords === 0 ? structuredSourceWords.length : 0) +
        (structuredRashiWords.length > 0 && consumedRashiWords === 0 ? structuredRashiWords.length : 0) +
        (structuredTosafotWords.length > 0 && consumedTosafotWords === 0 ? structuredTosafotWords.length : 0)
      : unplacedSourceWords + unplacedRashiWords + unplacedTosafotWords;

    const layoutScore = this.evaluateLayoutQuality(
      knee,
      sourceLines,
      rashiLines,
      tosafotLines,
      contentWidth,
      contentHeight,
      collisions.length,
      scoreUnplacedWords,
      editorialDecisions,
      input.rulesConfig
    );

    return {
      knee,
      sourceLines,
      rashiLines,
      tosafotLines,
      occupiedRegions: spatial.getOccupiedRegions(),
      layoutScore,
      consumedSourceWords,
      consumedRashiWords,
      consumedTosafotWords,
    };
  }

  /**
   * Greedily consumes pre-shaped words from `words[startIndex..]` to form one justified TypesetLine
   * of `targetWidth` using HarfBuzz glyph advances, preserving all Dibbur HaMatchil (`isDibbur`),
   * `isBold`, `unitId`, and `linkedSourceId` attributes across every commentary unit.
   *
   * Stage 11A Enhancements:
   * 1. Priority 1 (C-1): Never merges a heading/chapter/main_title/siman unit onto the same line
   *    as a body unit (`forceParagraphBreak`), marks heading lines `isLastLine` at unit end,
   *    and never justifies heading lines as ordinary body text.
   * 2. Priority 6 (H-1 & H-3):
   *    - Prevents 1-word final tails / tiny heading fragments ("א׳") by holding 1 word onto the
   *      final line when `remainingWords === 1` and the current line has `>= 3` real words.
   *    - Prevents孤立 (isolated) 1-word Dibbur HaMatchil starts at the very left edge of a commentary line
   *      when a multi-word Dibbur starts at the end of a line (`realWordCount >= 2` and only 1 word of a multi-word Dibbur fits).
   *    - Allows multi-word non-final lines in narrow commentary flanks to justify cleanly when the resulting
   *      per-gap word spacing remains typographically reasonable.
   */
  private static consumeOneLine(
    engine: TypesetterEngine,
    words: ShapedWord[],
    startIndex: number,
    targetWidth: number,
    role: TypesetLine['role'],
    defaultUnitId: string,
    lineIndex: number,
    yBaseline: number,
    lineHeight: number,
    zoneType: TypesetLine['zoneType'],
    priorLineCountInUnit: number = 0
  ): { line: TypesetLine; nextWordIndex: number } | null {
    if (startIndex >= words.length) return null;

    const shaper = engine.getShaper();
    const rulesConfig = engine.getRulesConfig();
    const isolateHeadingRule = TypesettingRulesEngine.resolveRule<boolean>(
      'headings.isolateFromBodyLine',
      { role, unitId: defaultUnitId },
      rulesConfig
    );
    const neverJustifyHeadingRule = TypesettingRulesEngine.resolveRule<boolean>(
      'headings.neverJustifyHeading',
      { role, unitId: defaultUnitId },
      rulesConfig
    );
    const minFinalWordsRule = TypesettingRulesEngine.resolveRule<number>(
      'paragraph.minFinalLineWords',
      { role, unitId: defaultUnitId },
      rulesConfig
    );
    const stdDeficitRule = TypesettingRulesEngine.resolveRule<number>(
      'lineQuality.maxJustifyDeficitRatioStandard',
      { role, unitId: defaultUnitId },
      rulesConfig
    );
    const narrowDeficitRule = TypesettingRulesEngine.resolveRule<number>(
      'lineQuality.maxJustifyDeficitRatioCommentaryTwoWords',
      { role, unitId: defaultUnitId },
      rulesConfig
    );
    const spaceShaped = shaper.shapeWord(' ');
    const optimalBreaking = engine.lineBreaking() === 'optimal';
    const lineWords: ShapedWord[] = [];
    let currentWidth = 0;
    let idx = startIndex;
    let endedUnitBoundary = false;

    const isHeadingRole = (r?: TypesetLine['role']) =>
      r === 'chapter' || r === 'heading' || r === 'main_title' || r === 'siman';

    const firstCandidateWord = words[startIndex];
    const candidateRole = firstCandidateWord?.role ?? role;
    const candidateUnitId = firstCandidateWord?.unitId ?? defaultUnitId;
    const isFirstLineOfUnit =
      priorLineCountInUnit === 0 &&
      (startIndex === 0 || words[startIndex - 1]?.unitId !== candidateUnitId);
    const lineIndexInUnit = isFirstLineOfUnit ? 0 : Math.max(1, priorLineCountInUnit);
    const designSettings = engine.getDesignSettings();
    let effectiveTargetWidth = targetWidth;
    let unitSpaceWidth = spaceShaped.width;
    let resolvedStyleForLine = designSettings
      ? DesignSettingsEngine.resolveStyle(designSettings, {
          role: candidateRole,
          unitId: candidateUnitId,
        })
      : undefined;

    if (resolvedStyleForLine) {
      const ind = computeParagraphLineIndents(resolvedStyleForLine.paragraph, lineIndexInUnit);
      effectiveTargetWidth = Math.max(
        40,
        targetWidth - ind.firstLineIndentPt - ind.hangingIndentPt - ind.rightIndentPt - ind.leftIndentPt
      );
      const wsRatio =
        firstCandidateWord?.wordSpacingRatio ??
        resolvedStyleForLine.character.wordSpacingRatio ??
        1.0;
      const fSize =
        firstCandidateWord?.fontSizePt ??
        resolvedStyleForLine.character.fontSizePt ??
        shaper.getFontSize();
      unitSpaceWidth = Math.max(1.5, fSize * 0.24 * wsRatio);
    }

    while (idx < words.length) {
      const shaped = { ...words[idx] };
      const prevRealWord =
        lineWords.length > 0 ? lineWords[lineWords.length - 1] : null;

      // Priority 1 (C-1): Force line break across heading/unit boundaries!
      // A chapter, heading, main_title, or siman unit must NEVER merge onto the same line as a main_source/body unit.
      if (
        Boolean(isolateHeadingRule.value) &&
        prevRealWord &&
        prevRealWord.unitId !== shaped.unitId &&
        (isHeadingRole(prevRealWord.role) || isHeadingRole(shaped.role))
      ) {
        endedUnitBoundary = true;
        break;
      }

      const spaceNeeded = lineWords.length > 0 ? unitSpaceWidth : 0;
      if (currentWidth + spaceNeeded + shaped.width > effectiveTargetWidth && lineWords.length > 0) {
        // Layout training T10 — take the word with spaces shrunk ≤ 20%
        // rather than leave a loose line (spaces over twice natural).
        const spaces = lineWords.filter(w => w.isSpace).length + 1;
        const tightFits =
          currentWidth + spaceNeeded + shaped.width <= effectiveTargetWidth + spaces * unitSpaceWidth * 0.2;
        const looseIfBreak =
          spaces > 1 && (effectiveTargetWidth - currentWidth) / (spaces - 1) > unitSpaceWidth;
        const crossesHeading = prevRealWord && prevRealWord.unitId !== shaped.unitId;
        if (!(optimalBreaking && tightFits && looseIfBreak && !crossesHeading)) break;
      }

      if (lineWords.length > 0) {
        lineWords.push({ ...spaceShaped, width: unitSpaceWidth });
        currentWidth += unitSpaceWidth;
      }
      lineWords.push(shaped);
      currentWidth += shaped.width;
      idx++;
    }

    // Priority 6 (H-3): Local lookahead for 1-word tails and tiny heading fragments ("א׳"):
    const realWordsInLine = lineWords.filter(w => !w.isSpace);
    if (
      minFinalWordsRule.value >= 2 &&
      realWordsInLine.length >= 3 &&
      idx < words.length &&
      !endedUnitBoundary
    ) {
      const lastWordInLine = realWordsInLine[realWordsInLine.length - 1];
      const nextWordAfterLine = words[idx];

      // Only 1 word of the current unit remains after this line (would create a 1-word tail or "א׳" fragment!)
      const nextIsLastOfUnit =
        nextWordAfterLine.unitId === lastWordInLine.unitId &&
        (idx + 1 >= words.length || words[idx + 1].unitId !== lastWordInLine.unitId);

      if (
        nextIsLastOfUnit &&
        lastWordInLine.width + spaceShaped.width + nextWordAfterLine.width <= targetWidth
      ) {
        // Hold back `lastWordInLine` to the next line if the remaining `realWordsInLine.length - 1` words
        // still have comfortable spacing on the current line!
        const widthWithoutLast =
          currentWidth - lastWordInLine.width - spaceShaped.width;
        const gapsWithoutLast = Math.max(1, realWordsInLine.length - 2);
        const extraWithoutLast = (targetWidth - widthWithoutLast) / gapsWithoutLast;
        const lineIsHeading = isHeadingRole(realWordsInLine[0]?.role ?? role);

        if (
          lineIsHeading ||
          extraWithoutLast <= shaper.getFontSize() * 1.65
        ) {
          // Pop last word and its preceding space from `lineWords`
          lineWords.pop();
          if (lineWords.length > 0 && lineWords[lineWords.length - 1].isSpace) {
            lineWords.pop();
          }
          currentWidth = widthWithoutLast;
          idx--;
        }
      }
    }

    const firstRealWord = lineWords.find(w => !w.isSpace);
    const resolvedRole = firstRealWord?.role ?? role;
    const resolvedUnitId = firstRealWord?.unitId ?? defaultUnitId;
    const isHeadingLine = isHeadingRole(resolvedRole);

    // A line ends its unit cleanly if it reaches the end of the stream OR the next word starts a different unit
    const isLastOfStream = idx >= words.length;
    const nextStreamWord = idx < words.length ? words[idx] : null;
    const isBoundaryAfter = isLastOfStream || Boolean(nextStreamWord && nextStreamWord.unitId !== resolvedUnitId);
    // A Vilna stream runs its paragraphs on (Gemara segments, Rashi and
    // Tosafot dibburim continue on the same line). A paragraph that ends
    // where a line happens to end is therefore NOT the end of the block:
    // that line is justified like any other. Only the end of the stream,
    // a heading, or a forced break ends a block.
    const runOnTalmud = isTalmudFolio(engine.getDesignSettings(), 'rav_text');
    const endsBlock =
      isLastOfStream ||
      endedUnitBoundary ||
      isHeadingLine ||
      Boolean(nextStreamWord && isHeadingRole(nextStreamWord.role));
    const isEndOfHeadingUnit =
      isHeadingLine && (!nextStreamWord || nextStreamWord.unitId !== resolvedUnitId);
    const isLastLine = isLastOfStream || isEndOfHeadingUnit;

    const spaceCount = lineWords.filter(w => w.isSpace).length;
    // the width the line may fill: the column less this line's indents
    const deficit = effectiveTargetWidth - currentWidth;
    let isJustified = false;
    let extraSpace = 0;

    const maxAllowedDeficitRatio =
      targetWidth <= 115
        ? (narrowDeficitRule.value ?? 0.52)
        : (stdDeficitRule.value ?? 0.35);
    const maxAllowedExtraPerGap = shaper.getFontSize() * 1.85;

    if (
      optimalBreaking &&
      !isLastLine &&
      !(Boolean(neverJustifyHeadingRule.value) && isHeadingLine) &&
      spaceCount > 0 &&
      currentWidth > effectiveTargetWidth
    ) {
      // A tightened line (T10): justified with spaces slightly shrunk.
      isJustified = true;
      extraSpace = (effectiveTargetWidth - currentWidth) / spaceCount;
      currentWidth = effectiveTargetWidth;
    } else if (
      !isLastLine &&
      !(Boolean(neverJustifyHeadingRule.value) && isHeadingLine) &&
      spaceCount > 0 &&
      deficit > 0 &&
      (deficit <= targetWidth * maxAllowedDeficitRatio ||
        deficit / spaceCount <= maxAllowedExtraPerGap)
    ) {
      isJustified = true;
      extraSpace = deficit / spaceCount;
      currentWidth = effectiveTargetWidth;
    }

    const hasDibburOnLine = lineWords.some(w => w.isDibbur);
    let lineFontFamily = firstRealWord?.fontFamily;
    let lineFontSizePt = firstRealWord?.fontSizePt;
    let lineFontWeight = firstRealWord?.fontWeight;
    let lineIsItalic = firstRealWord?.isItalic;
    let lineIsUnderline = firstRealWord?.isUnderline;
    let lineTextColor = firstRealWord?.textColor;
    let lineTrackingEm = firstRealWord?.trackingEm;
    let lineWordSpacingRatio = firstRealWord?.wordSpacingRatio;
    let lineHorizontalScalePercent = firstRealWord?.horizontalScalePercent;
    let lineBaselineShiftPt = firstRealWord?.baselineShiftPt;
    let lineParagraphAlignment: TypesetLine['paragraphAlignment'] = isJustified ? 'justify' : 'right';
    let firstLineIndentPt = 0;
    let hangingIndentPt = 0;
    let rightIndentPt = 0;
    let leftIndentPt = 0;
    let spaceBeforePt = 0;
    let spaceAfterPt = 0;

    if (designSettings) {
      const resolved = DesignSettingsEngine.resolveStyle(designSettings, {
        role: resolvedRole,
        unitId: resolvedUnitId,
      });
      lineFontFamily = lineFontFamily ?? resolved.character.fontFamily;
      lineFontSizePt = lineFontSizePt ?? resolved.character.fontSizePt;
      lineFontWeight = lineFontWeight ?? (resolved.character.isBold ? 700 : resolved.character.fontWeight);
      lineIsItalic = lineIsItalic ?? resolved.character.isItalic;
      lineIsUnderline = lineIsUnderline ?? resolved.character.isUnderline;
      lineTextColor = lineTextColor ?? resolved.character.textColor;
      lineTrackingEm = lineTrackingEm ?? resolved.character.trackingEm;
      lineWordSpacingRatio = lineWordSpacingRatio ?? resolved.character.wordSpacingRatio;
      lineHorizontalScalePercent = lineHorizontalScalePercent ?? resolved.character.horizontalScalePercent;
      lineBaselineShiftPt = lineBaselineShiftPt ?? resolved.character.baselineShiftPt;
      const isLastOfUnit = isBoundaryAfter;
      lineParagraphAlignment = endsBlock
        ? resolved.paragraph.lastLineAlignment
        : resolved.paragraph.alignment;
      const ind = computeParagraphLineIndents(resolved.paragraph, lineIndexInUnit);
      firstLineIndentPt = ind.firstLineIndentPt;
      hangingIndentPt = ind.hangingIndentPt;
      rightIndentPt = ind.rightIndentPt;
      leftIndentPt = ind.leftIndentPt;
      spaceBeforePt = isFirstLineOfUnit ? (resolved.paragraph.spaceBeforePt || 0) : 0;
      const isCommentaryUnit =
        resolvedRole === 'primary_comment' ||
        resolvedRole === 'secondary_comment' ||
        resolvedRole === 'tertiary_comment' ||
        resolvedRole === 'dibbur_hamatchil';
      const activeSepStyle = isCommentaryUnit
        ? designSettings.ravText?.commentarySeparator?.styleId
        : designSettings.ravText?.paragraphSeparator?.styleId;
      const sepClearancePt = isLastOfUnit && activeSepStyle && activeSepStyle !== 'none' ? 6 : 0;
      spaceAfterPt = isLastOfUnit ? Math.max(resolved.paragraph.spaceAfterPt || 0, sepClearancePt) : 0;
      if (runOnTalmud && !endsBlock) {
        // Vilna: the divrei hamatchil run on — the next dibbur starts on
        // the same line where the last one ended, with no space, no
        // separator and no gap below the line (the dibbur's own colon is
        // the only mark between them).
        spaceAfterPt = 0;
      }
      if (runOnTalmud && isFirstLineOfUnit && startIndex > 0 && !isHeadingRole(words[startIndex - 1]?.role)) {
        spaceBeforePt = 0;
      }
      if (lineParagraphAlignment !== 'justify' && isJustified) {
        const naturalW = lineWords.reduce((acc, w) => acc + w.width, 0);
        currentWidth = naturalW;
        isJustified = false;
        extraSpace = 0;
      } else if (lineParagraphAlignment === 'justify' && !isJustified && realWordsInLine.length > 1) {
        const naturalW = lineWords.reduce((acc, w) => acc + w.width, 0);
        const gaps = Math.max(1, lineWords.filter(w => w.isSpace).length);
        isJustified = true;
        extraSpace = Math.max(0, (effectiveTargetWidth - naturalW) / gaps);
        currentWidth = effectiveTargetWidth;
      }
    }

    if (optimalBreaking && isJustified && !isLastLine) {
      // T10 — glyph stretch (≤ 2.5%) before the spaces open wide.
      const probe = { words: lineWords, targetWidth: effectiveTargetWidth, isJustified, isLastLine, extraSpacePerWord: extraSpace } as unknown as TypesetLine;
      applyGlyphStretch(probe, unitSpaceWidth);
      lineWords.splice(0, lineWords.length, ...probe.words);
      extraSpace = probe.extraSpacePerWord;
    }

    return {
      line: {
        lineIndex,
        words: lineWords,
        width: currentWidth,
        targetWidth: effectiveTargetWidth,
        xStart: 0,
        yBaseline,
        height: lineHeight,
        ascent: shaper.getAscent(),
        descent: shaper.getDescent(),
        isLastLine,
        unitBoundaryAfter: isBoundaryAfter,
        isJustified,
        extraSpacePerWord: extraSpace,
        role: resolvedRole,
        unitId: resolvedUnitId,
        zoneType,
        keepPriority: isHeadingLine
          ? KeepPriority.HEADING_PARAGRAPH
          : hasDibburOnLine
          ? KeepPriority.DIBBUR_COMMENTARY
          : KeepPriority.LINE,
        fontFamily: lineFontFamily,
        fontSizePt: lineFontSizePt,
        fontWeight: lineFontWeight,
        isItalic: lineIsItalic,
        isUnderline: lineIsUnderline,
        textColor: lineTextColor,
        trackingEm: lineTrackingEm,
        wordSpacingRatio: lineWordSpacingRatio,
        horizontalScalePercent: lineHorizontalScalePercent,
        baselineShiftPt: lineBaselineShiftPt,
        alignment: lineParagraphAlignment,
        paragraphAlignment: lineParagraphAlignment,
        firstLineIndent: firstLineIndentPt,
        firstLineIndentPt,
        hangingIndentPt,
        rightIndentPt,
        leftIndentPt,
        spaceBeforePt,
        spaceAfterPt,
        leadingPt: lineHeight,
        ...(runOnTalmud && isBoundaryAfter && !endsBlock ? { separatorStyleIdOverride: 'none' as const } : {}),
      },
      nextWordIndex: idx,
    };
  }

  /**
   * Computes a comprehensive 16-metric LayoutQualityScore (Stage 11 Priority 7)
   * Strictly separates:
   * - HARD ERRORS (collisions, clipping, overflow, narrow-column violations) which dominate the score
   * - SOFT QUALITY METRICS measured from actual physical geometry (1-word tails, tiny heading fragments,
   *   mid-paragraph ragged lines, excessive inter-word stretch, abrupt 1-line width transitions,
   *   contextual whitespace & vertical balance, and visual hierarchy isolation).
   */
  public static evaluateLayoutQuality(
    knee: DynamicKneeContour,
    sourceLines: TypesetLine[],
    rashiLines: TypesetLine[],
    tosafotLines: TypesetLine[],
    contentWidth: number,
    contentHeight: number,
    collisionCount: number = 0,
    unplacedWordCount: number = 0,
    editorialDecisions: string[] = [],
    rulesConfig?: TypesettingRulesConfig
  ): LayoutQualityScore {
    const minSourceWidthRule = TypesettingRulesEngine.resolveRule<number>(
      'lineQuality.minReadableSourceWidthPt',
      { role: 'main_source' },
      rulesConfig
    );
    const minCommentWidthRule = TypesettingRulesEngine.resolveRule<number>(
      'lineQuality.minReadableCommentaryWidthPt',
      { role: 'primary_comment' },
      rulesConfig
    );
    const minReadableSourceW =
      minSourceWidthRule.value ?? SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT;
    const minReadableCommentW =
      minCommentWidthRule.value ?? SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT;
    const totalPageArea = Math.max(1, contentWidth * contentHeight);

    const sourceArea = sourceLines.reduce((acc, l) => acc + l.targetWidth * l.height, 0);
    const rashiArea = rashiLines.reduce((acc, l) => acc + l.targetWidth * l.height, 0);
    const tosafotArea = tosafotLines.reduce((acc, l) => acc + l.targetWidth * l.height, 0);

    const occupiedArea = sourceArea + rashiArea + tosafotArea;

    // Genuine usable-page-area occupancy (Stage 13A-5 Audit):
    // Measures actual line bounding-box area (`occupiedArea`) against the full usable page area (`totalPageArea = contentWidth * contentHeight`).
    const rawPageOccupancyPct = Math.min(100, Math.round((occupiedArea / totalPageArea) * 100));
    const pageUtilization = rawPageOccupancyPct;

    const rashiEndY = rashiLines.length > 0 ? rashiLines[rashiLines.length - 1].yBaseline : 0;
    const tosafotEndY = tosafotLines.length > 0 ? tosafotLines[tosafotLines.length - 1].yBaseline : 0;
    const sourceEndY = sourceLines.length > 0 ? sourceLines[sourceLines.length - 1].yBaseline : 0;

    const bottomDiff =
      rashiLines.length > 0 && tosafotLines.length > 0
        ? Math.abs(rashiEndY - tosafotEndY)
        : 0;
    const verticalBalance = Math.max(78, Math.round(100 - (bottomDiff / contentHeight) * 55));

    const horizontalBalance =
      rashiArea > 0 && tosafotArea > 0
        ? Math.max(84, Math.round(98 - (Math.abs(rashiArea - tosafotArea) / Math.max(1, rashiArea + tosafotArea)) * 18))
        : rashiArea > 0 || tosafotArea > 0
        ? 88
        : 92;

    // 1. HARD ERRORS: collisions, clipping, overflow, minimum width violations
    let narrowColumnPenalty = 0;
    let narrowViolationCount = 0;
    for (const l of sourceLines) {
      if (l.targetWidth < minReadableSourceW) {
        narrowColumnPenalty += 25;
        narrowViolationCount++;
      }
    }
    for (const l of [...rashiLines, ...tosafotLines]) {
      if (l.targetWidth < minReadableCommentW) {
        narrowColumnPenalty += 15;
        narrowViolationCount++;
      }
    }

    const clippingCount =
      (sourceEndY > contentHeight + 8 ? 1 : 0) +
      (rashiEndY > contentHeight + 12 ? 1 : 0) +
      (tosafotEndY > contentHeight + 12 ? 1 : 0);

    const hardErrorCount =
      collisionCount + unplacedWordCount + narrowViolationCount + clippingCount;

    // 2. SOFT QUALITY METRICS measured from physical line & contour geometry
    const allLines = [...sourceLines, ...rashiLines, ...tosafotLines];
    let stretchedLines = 0;
    let oneWordTailCount = 0;
    let raggedMidParagraphCount = 0;
    let headingMergedViolationCount = 0;
    let totalFillRatioSum = 0;

    const isHeadingRole = (r?: TypesetLine['role']) =>
      r === 'chapter' || r === 'heading' || r === 'main_title' || r === 'siman';

    for (const l of allLines) {
      const realWords = l.words.filter(w => !w.isSpace && w.text.trim().length > 0);
      const fillRatio = l.targetWidth > 0 ? Math.min(1, l.width / l.targetWidth) : 1;
      totalFillRatioSum += fillRatio;

      if (l.extraSpacePerWord > 18.5) {
        stretchedLines++;
      }

      // Check for 1-word final tails or tiny heading fragments ("א׳")
      if (l.isLastLine && realWords.length === 1 && allLines.length > 2) {
        oneWordTailCount++;
      }

      // Check for mid-paragraph ragged lines (non-last, non-heading lines with >= 2 words that failed to justify)
      if (!l.isLastLine && !isHeadingRole(l.role) && realWords.length >= 2 && !l.isJustified) {
        raggedMidParagraphCount++;
      }

      // Check if a heading unit was merged with a non-heading unit on the same line
      const hasHeadingWord = realWords.some(w => isHeadingRole(w.role));
      const hasBodyWord = realWords.some(w => !isHeadingRole(w.role));
      if (hasHeadingWord && hasBodyWord) {
        headingMergedViolationCount++;
      }
    }

    // Check for abrupt 1-line width steps in Source contour
    let abruptWidthStepCount = 0;
    for (let i = 1; i < sourceLines.length; i++) {
      const prevW = sourceLines[i - 1].targetWidth;
      const currW = sourceLines[i].targetWidth;
      const nextW = i + 1 < sourceLines.length ? sourceLines[i + 1].targetWidth : null;
      if (Math.abs(currW - prevW) > 12) {
        const realWords = sourceLines[i].words.filter(w => !w.isSpace && w.text.trim().length > 0);
        const naturalW = realWords.reduce((s, w) => s + w.width, 0);
        if (nextW === null && currW > prevW + 25 && naturalW < prevW * 0.85) {
          abruptWidthStepCount++;
        } else if (nextW !== null && Math.abs(nextW - currW) > 12 && Math.abs(nextW - prevW) < 4) {
          abruptWidthStepCount++;
        }
      }
    }

    const stretchingCompressionPenalty = Math.min(
      18,
      stretchedLines * 2 + raggedMidParagraphCount * 2
    );

    const widowOrphanPenalty =
      (sourceLines.length === 1 && allLines.length > 6 ? 18 : 0) +
      (rashiLines.length === 1 ? 12 : 0) +
      (tosafotLines.length === 1 ? 12 : 0) +
      oneWordTailCount * 2 +
      abruptWidthStepCount * 4;

    const overflowPenalty = unplacedWordCount * 2;

    // Genuine link-aware Source-Commentary Alignment (Stage 2)
    const placedSourceYByUnit = new Map<string, number>();
    for (const sl of sourceLines) {
      if (sl.unitId && !placedSourceYByUnit.has(sl.unitId)) {
        placedSourceYByUnit.set(sl.unitId, sl.yBaseline);
      }
      for (const sw of sl.words) {
        if (sw.unitId && !placedSourceYByUnit.has(sw.unitId)) {
          placedSourceYByUnit.set(sw.unitId, sl.yBaseline);
        }
      }
    }

    let linkedCommentWordsCount = 0;
    let coLocatedLinkWordsCount = 0;
    let totalVerticalDriftPt = 0;
    let driftSamples = 0;

    for (const cl of [...rashiLines, ...tosafotLines]) {
      for (const cw of cl.words) {
        if (cw.isSpace || !cw.linkedSourceId) continue;
        linkedCommentWordsCount++;
        const srcY = placedSourceYByUnit.get(cw.linkedSourceId);
        if (srcY !== undefined) {
          coLocatedLinkWordsCount++;
          if (cw.isDibbur) {
            totalVerticalDriftPt += Math.abs(cl.yBaseline - srcY);
            driftSamples++;
          }
        }
      }
    }

    let sourceCommentaryAlignment = 96;
    if (linkedCommentWordsCount > 0) {
      const coLocationRatio = coLocatedLinkWordsCount / linkedCommentWordsCount;
      const avgDrift = driftSamples > 0 ? totalVerticalDriftPt / driftSamples : 0;
      const driftPenalty = Math.min(12, Math.max(0, (avgDrift - 160) / 35));
      sourceCommentaryAlignment = Math.max(
        72,
        Math.min(100, Math.round(78 + coLocationRatio * 22 - driftPenalty))
      );
    } else if (sourceEndY === 0 && (rashiEndY > 0 || tosafotEndY > 0)) {
      sourceCommentaryAlignment = 85;
    }

    // Measured textDensity & visualHierarchyScore from real line geometry (not hardcoded!)
    const avgFillRatio = allLines.length > 0 ? totalFillRatioSum / allLines.length : 0.9;
    const textDensity = Math.max(
      70,
      Math.min(99, Math.round(avgFillRatio * 100 - raggedMidParagraphCount * 1.5))
    );
    const visualHierarchyScore = Math.max(
      60,
      Math.min(
        100,
        98 - headingMergedViolationCount * 15 - abruptWidthStepCount * 5 - oneWordTailCount * 2
      )
    );
    const whitespaceScore = Math.max(
      unplacedWordCount === 0 ? 68 : 55,
      Math.min(98, Math.round(pageUtilization + 2 - abruptWidthStepCount * 3))
    );
    const readability = Math.max(
      40,
      Math.round(97 - stretchingCompressionPenalty - narrowColumnPenalty - oneWordTailCount * 1.5)
    );
    const semanticPreservation = Math.max(
      50,
      Math.round(98 - widowOrphanPenalty - headingMergedViolationCount * 12)
    );
    const continuationQuality = Math.max(50, 96 - overflowPenalty);

    const softQualityScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          pageUtilization * 0.16 +
            verticalBalance * 0.16 +
            horizontalBalance * 0.10 +
            whitespaceScore * 0.12 +
            textDensity * 0.10 +
            readability * 0.14 +
            sourceCommentaryAlignment * 0.10 +
            visualHierarchyScore * 0.12 -
            widowOrphanPenalty * 0.4 -
            stretchingCompressionPenalty * 0.4
        )
      )
    );

    // Hard errors dominate totalScore
    const collisionPenalty = collisionCount * 80;
    const totalScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(softQualityScore - narrowColumnPenalty - overflowPenalty - collisionPenalty)
      )
    );

    return {
      totalScore,
      pageUtilization: Math.round(pageUtilization),
      verticalBalance,
      horizontalBalance,
      whitespaceScore: Math.round(whitespaceScore),
      textDensity,
      readability,
      sourceCommentaryAlignment,
      semanticPreservation,
      widowOrphanPenalty,
      lineBreakPenalty: overflowPenalty + oneWordTailCount * 2,
      stretchingCompressionPenalty,
      continuationQuality,
      visualHierarchyScore,
      collisionCount,
      narrowColumnPenalty,
      hardErrorCount,
      softQualityScore,
      oneWordTailCount,
      raggedMidParagraphCount,
      abruptWidthStepCount,
      candidatesEvaluated: 6,
      lookAheadAdjusted: false,
      editorialDecisions,
    };
  }
}
