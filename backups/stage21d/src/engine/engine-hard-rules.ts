/**
 * STAGE 12 — OWNER / ENGINE HARD RULES (LEVEL 0 — IMMUTABLE DEVELOPER LAWS)
 *
 * Central authoritative source of truth (`ENGINE_HARD_RULES`) for the fundamental
 * professional typesetting laws of Keter Typesetter.
 *
 * LEVEL 0 — ENGINE HARD RULES:
 * - Developer-controlled, immutable in runtime memory (`Object.freeze`).
 * - NEVER stored in localStorage, project JSON, .keter.json, or user preferences.
 * - NEVER editable or disableable by User Rules, Project Rules, Local Overrides,
 *   Natural-Language Instructions, or AI / Layout Preferences.
 * - Enforceable across typesetter-core, dynamic-knee, pagination-engine,
 *   footnote placement, Rav Text solver, quality scoring, candidate selection,
 *   preflight (qa-engine), PDF export, and IDML export.
 */

import {
  BookTypesetDocument,
  ContentRole,
  ContentUnit,
  OccupiedRegion,
  OrnamentAsset,
  OrnamentUserRule,
  PageGeometry,
  PageTypesetResult,
  PlacedOrnament,
  RavTextLink,
  ShapedWord,
  TypesetLine,
} from '../types/typesetter';
import { SpatialExclusionEngine } from './spatial-exclusion';

export type EngineHardRuleCategory =
  | 'DATA_INTEGRITY'
  | 'TEXT_CONSERVATION'
  | 'RTL_HEBREW_INTEGRITY'
  | 'FONT_SHAPING_INTEGRITY'
  | 'RAV_TEXT_RELATIONSHIP_INTEGRITY'
  | 'GEOMETRIC_COLLISION_SAFETY'
  | 'FOOTNOTE_ANCHOR_INTEGRITY'
  | 'ORNAMENT_SAFETY'
  | 'PAGINATION_SAFETY'
  | 'EXPORT_INTEGRITY'
  | 'IDML_STRUCTURAL_INTEGRITY'
  | 'USER_DATA_SAFETY';

export type EngineHardRuleId =
  // 1. DATA INTEGRITY
  | 'engine.dataIntegrity.uniqueUnitIdsAndValidHierarchy'
  // 2. TEXT CONSERVATION
  | 'engine.textConservation.neverLoseOrDuplicateSourceText'
  | 'engine.textConservation.neverLoseOrDuplicateCommentaryText'
  | 'engine.textConservation.neverHeadingRuleCausesTextLoss'
  // 3. RTL / HEBREW INTEGRITY
  | 'engine.rtlHebrew.neverAllowDetachedOrphanCombiningMarks'
  | 'engine.rtlHebrew.neverViolateRtlLogicalOrder'
  // 4. FONT / SHAPING INTEGRITY
  | 'engine.fontShaping.combiningMarksZeroAdvanceAndRealMetrics'
  // 5. RAV TEXT RELATIONSHIP INTEGRITY
  | 'engine.ravText.neverBreakSourceCommentaryRelationship'
  // 6. GEOMETRIC COLLISION SAFETY
  | 'engine.geometry.neverCreateTextCollisions'
  | 'engine.geometry.neverViolateFundamentalMinimumReadableWidth'
  // 7. FOOTNOTE ANCHOR INTEGRITY
  | 'engine.footnotes.neverLoseFootnoteAnchorRelationship'
  // 8. ORNAMENT SAFETY (Stage 11D)
  | 'engine.ornaments.neverIntroduceUnsuppliedOrnaments'
  | 'engine.ornaments.neverAutoSelectBuiltinOrnaments'
  // 9. PAGINATION SAFETY
  | 'engine.pagination.neverSilentlyDiscardOverflowText'
  // 10. EXPORT INTEGRITY
  | 'engine.export.neverExportUnresolvedLayoutLoss'
  // 11. IDML STRUCTURAL INTEGRITY
  | 'engine.idml.neverFlattenToRasterImagesAndPreserveFrames'
  // 12. USER DATA SAFETY
  | 'engine.userData.neverMutateUserLockedLinksOrCanonicalDefaults';

/**
 * Maps configurable `TypesettingRuleId` keys that correspond directly to an immutable
 * Level 0 Engine Hard Rule so `TypesettingRulesEngine.resolveRule()` always resolves
 * them at `LEVEL 0 — ENGINE_HARD_RULE` and blocks any override from AI, User, Project,
 * Local Override, or Natural-Language input.
 */
export const TYPESETTING_RULE_TO_ENGINE_HARD_RULE_MAP: Readonly<
  Record<
    string,
    {
      engineRuleId: EngineHardRuleId;
      enforcedValue: boolean | number;
      disposition: 'REQUIRED' | 'FORBIDDEN';
      minimumThreshold?: number;
    }
  >
> = Object.freeze({
  'ornaments.userSuppliedOnly': {
    engineRuleId: 'engine.ornaments.neverIntroduceUnsuppliedOrnaments',
    enforcedValue: true,
    disposition: 'REQUIRED',
  },
  'ornaments.forbidAutoSelectionOfBuiltins': {
    engineRuleId: 'engine.ornaments.neverAutoSelectBuiltinOrnaments',
    enforcedValue: true,
    disposition: 'FORBIDDEN',
  },
  'ornaments.forbidAutoCreationOnEmptySpace': {
    engineRuleId: 'engine.ornaments.neverIntroduceUnsuppliedOrnaments',
    enforcedValue: true,
    disposition: 'FORBIDDEN',
  },
  'hebrewRtl.preserveRtlMonotonicOrder': {
    engineRuleId: 'engine.rtlHebrew.neverViolateRtlLogicalOrder',
    enforcedValue: true,
    disposition: 'REQUIRED',
  },
  'hebrewRtl.preserveCombiningMarksZeroAdvance': {
    engineRuleId: 'engine.fontShaping.combiningMarksZeroAdvanceAndRealMetrics',
    enforcedValue: true,
    disposition: 'REQUIRED',
  },
  'hebrewRtl.preventOrphanedDiacritics': {
    engineRuleId: 'engine.rtlHebrew.neverAllowDetachedOrphanCombiningMarks',
    enforcedValue: true,
    disposition: 'REQUIRED',
  },
  'hebrewRtl.respectActualFontMetrics': {
    engineRuleId: 'engine.fontShaping.combiningMarksZeroAdvanceAndRealMetrics',
    enforcedValue: true,
    disposition: 'REQUIRED',
  },
  'footnotes.preserveAnchorRelationship': {
    engineRuleId: 'engine.footnotes.neverLoseFootnoteAnchorRelationship',
    enforcedValue: true,
    disposition: 'REQUIRED',
  },
  'semantic.keepFootnoteWithAnchor': {
    engineRuleId: 'engine.footnotes.neverLoseFootnoteAnchorRelationship',
    enforcedValue: true,
    disposition: 'REQUIRED',
  },
  'headings.isolateFromBodyLine': {
    engineRuleId: 'engine.textConservation.neverHeadingRuleCausesTextLoss',
    enforcedValue: true,
    disposition: 'REQUIRED',
  },
  'ravText.preserveStage3Geometry': {
    engineRuleId: 'engine.ravText.neverBreakSourceCommentaryRelationship',
    enforcedValue: true,
    disposition: 'REQUIRED',
  },
  // Fundamental minimum readable geometry floor (User/Project may increase above the floor, never weaken below it)
  'lineQuality.minReadableSourceWidthPt': {
    engineRuleId: 'engine.geometry.neverViolateFundamentalMinimumReadableWidth',
    enforcedValue: SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT, // 135pt
    disposition: 'REQUIRED',
    minimumThreshold: SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT,
  },
  'lineQuality.minReadableCommentaryWidthPt': {
    engineRuleId: 'engine.geometry.neverViolateFundamentalMinimumReadableWidth',
    enforcedValue: SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT, // 78pt
    disposition: 'REQUIRED',
    minimumThreshold: SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT,
  },
});

export interface EngineHardRuleMachineContext {
  currentPage?: PageTypesetResult;
  nextPage?: PageTypesetResult;
  bookDoc?: BookTypesetDocument;
  units?: ContentUnit[];
  links?: RavTextLink[];
  occupiedRegions?: OccupiedRegion[];
  geometry?: PageGeometry;
  userSuppliedOrnaments?: OrnamentAsset[];
  userOrnamentRules?: OrnamentUserRule[];
  userSuppliedOrnamentsCount?: number;
  unplacedWordsCount?: number;
  expectedSourceWordCount?: number;
  actualSourceWordCount?: number;
  expectedCommentaryWordCount?: number;
  actualCommentaryWordCount?: number;
  idmlAudit?: {
    hasRasterizedSubstitutes?: boolean;
    overlappingTextFrames?: string[];
    brokenStoryReferences?: string[];
    conservedWordCount?: number;
    expectedWordCount?: number;
  };
}

export interface EngineHardRuleCheckOutcome {
  passed: boolean;
  message?: string;
  unitId?: string;
  pageNumber?: number;
  measuredValue?: number | string;
  requiredValue?: number | string;
  safeAutoRecoverable?: boolean;
}

export interface EngineHardRuleDefinition {
  ruleId: EngineHardRuleId;
  universalRuleNumber?: number;
  universalLawKey?: string;
  category: EngineHardRuleCategory;
  severity: 'ENGINE_HARD_BLOCKING';
  level: 0;
  authority: 'ENGINE_HARD_RULE' | 'ENGINE_HARD';
  enforcementBehavior?: string;
  blockingBehavior?: string;
  description: string;
  descriptionHe: string;
  blocksPagination: boolean;
  blocksExport: boolean;
  blocksAiCandidateSelection: boolean;
  userEditable: false;
  check: (ctx: EngineHardRuleMachineContext) => EngineHardRuleCheckOutcome;
}

export interface EngineHardRuleViolation {
  ruleId: EngineHardRuleId;
  category: EngineHardRuleCategory;
  severity: 'ENGINE_HARD_BLOCKING';
  authority: 'ENGINE_HARD_RULE';
  message: string;
  pageNumber?: number;
  unitId?: string;
  measuredValue?: number | string;
  requiredValue?: number | string;
  blocksPagination: boolean;
  blocksExport: boolean;
  blocksAiCandidateSelection: boolean;
}

export interface EngineHardRuleEnforcementReport {
  passed: boolean;
  violations: EngineHardRuleViolation[];
  blocksPagination: boolean;
  blocksExport: boolean;
  blocksAiCandidateSelection: boolean;
  autoCorrectionApplied: boolean;
  autoCorrectionActions: string[];
}

function countNonSpaceWordsInLines(lines: TypesetLine[] | undefined): number {
  if (!lines) return 0;
  let count = 0;
  for (const ln of lines) {
    for (const w of ln.words) {
      if (!w.isSpace && w.text.trim().length > 0) count++;
    }
  }
  return count;
}

function countUnitWords(unit: ContentUnit): number {
  if (unit.textRuns && unit.textRuns.length > 0) {
    let total = 0;
    for (const r of unit.textRuns) {
      total += r.text.trim().split(/\s+/).filter(Boolean).length;
    }
    return total;
  }
  return unit.rawText.trim().split(/\s+/).filter(Boolean).length;
}

export interface UniversalEngineHardLaw {
  lawNumber: number;
  ruleId: string;
  category: EngineHardRuleCategory;
  title: string;
  description: string;
  severity: 'ENGINE_HARD_BLOCKING';
  authority: 'ENGINE_HARD';
  level: 0;
  enforcementBehavior: string;
  blockingBehavior: string;
  userEditable: false;
}

/**
 * The 15 Universal Engine Hard Rules of Keter Typesetter (Level 0 Laws).
 * Application-level laws stored strictly in code, never in localStorage or project JSON.
 */
export const UNIVERSAL_ENGINE_HARD_LAWS: ReadonlyArray<UniversalEngineHardLaw> = Object.freeze([
  {
    lawNumber: 1,
    ruleId: 'universal.1.textIntegrity',
    category: 'TEXT_CONSERVATION',
    title: '1. TEXT INTEGRITY',
    description:
      'Never lose, omit, duplicate, add, or modify content supplied by the user during line breaking, page breaking, positioning, spacing, font selection, styling, or pagination.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Verifies 100% word and character conservation across Source, Commentary, and Footnote streams on every page and book document.',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 2,
    ruleId: 'universal.2.noTextCorrectionOrValidation',
    category: 'USER_DATA_SAFETY',
    title: '2. NO TEXT CORRECTION / TEXT VALIDATION',
    description:
      'Treat user-supplied text as authoritative source content. Never detect, correct, flag, or suggest corrections for spelling, grammar, wording, punctuation, or religious/textual variants.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Forbids spellcheck/grammar/textual-mistake flagging or automatic wording modification during import, shaping, pagination, and QA.',
    blockingBehavior: 'BLOCKS_UNAUTHORIZED_TEXT_MUTATION',
    userEditable: false,
  },
  {
    lawNumber: 3,
    ruleId: 'universal.3.preserveContentOrder',
    category: 'DATA_INTEGRITY',
    title: '3. PRESERVE CONTENT ORDER',
    description:
      'Preserve the logical order of characters, words, sentences, paragraphs, and semantic content units; never reorder textual content merely to improve visual appearance.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Enforces monotonic stream cursor progression across all content units, lines, and pages.',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 4,
    ruleId: 'universal.4.noHarmfulCollisions',
    category: 'GEOMETRIC_COLLISION_SAFETY',
    title: '4. NO HARMFUL COLLISIONS',
    description:
      'No typeset element may overlap another element (text vs text, footnotes, graphics, source vs commentary, headings vs body, ornaments vs text, diacritics vs glyphs).',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Runs 2D spatial exclusion and bounding-box collision verification across all placed regions.',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 5,
    ruleId: 'universal.5.respectDefinedLayoutArea',
    category: 'GEOMETRIC_COLLISION_SAFETY',
    title: '5. RESPECT THE DEFINED LAYOUT AREA',
    description:
      'Text and layout elements must remain inside the layout area defined for the page/project (page boundaries, user-defined margins, and safe areas).',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Verifies all placed lines, columns, footnotes, and ornaments stay within the configured page content bounds.',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 6,
    ruleId: 'universal.6.doNotSacrificeReadability',
    category: 'GEOMETRIC_COLLISION_SAFETY',
    title: '6. DO NOT SACRIFICE READABILITY',
    description:
      'Never solve a layout problem by compressing text beyond acceptable limits, shrinking text to force it onto a page, distorting glyphs, or creating unusably narrow text regions.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Enforces minimum readable column widths (Source >= 135pt, Commentary >= 78pt) and forbids glyph distortion; reflows to next page instead.',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 7,
    ruleId: 'universal.7.noContentLossDueToLackOfSpace',
    category: 'PAGINATION_SAFETY',
    title: '7. NO CONTENT LOSS DUE TO LACK OF SPACE',
    description:
      'If content does not fit in the available area, it must continue into the next available valid area/page and never be silently discarded, truncated, hidden, or skipped.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Verifies unplacedWordsCount === 0 and full continuation across pages for Source, Commentary, and Footnote streams.',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 8,
    ruleId: 'universal.8.preserveSemanticRelationships',
    category: 'RAV_TEXT_RELATIONSHIP_INTEGRITY',
    title: '8. PRESERVE SEMANTIC RELATIONSHIPS',
    description:
      'Any semantic relationship in the document model (source <-> commentary/Rashi/Tosafot, Dibbur HaMatchil <-> commentary, footnote anchor <-> footnote, heading <-> content) must survive typesetting and pagination.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Verifies activeLinks, splitLinkIds, and footnoteAnchorUnitId/footnoteUnitId integrity on every page.',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 9,
    ruleId: 'universal.9.preserveRtlBidiIntegrity',
    category: 'RTL_HEBREW_INTEGRITY',
    title: '9. PRESERVE RTL / BIDI INTEGRITY',
    description:
      'Preserve correct logical and visual ordering for Hebrew and mixed RTL/LTR text, numbers, punctuation, and abbreviations without naive string reversal.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Verifies monotonic RTL word placement (xRight >= xLeft and right-to-left word progression) and ICU BiDi run ordering.',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 10,
    ruleId: 'universal.10.preserveCombiningMarkRelationships',
    category: 'RTL_HEBREW_INTEGRITY',
    title: '10. PRESERVE COMBINING MARK RELATIONSHIPS',
    description:
      'Hebrew vowel points (Nikud), cantillation marks (Taamim), and other combining marks must remain attached to their base characters and never be detached or orphaned.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Verifies every combining mark is attached to a valid base character with zero horizontal advance (xAdvance === 0).',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 11,
    ruleId: 'universal.11.fontCapabilityIntegrity',
    category: 'FONT_SHAPING_INTEGRITY',
    title: '11. FONT CAPABILITY INTEGRITY',
    description:
      'Never knowingly use a font incapable of representing required Hebrew characters/marks without supported fallback, and always use actual font metrics for text geometry.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Enforces real shaped glyph advance widths and font capability verification.',
    blockingBehavior: 'BLOCKS_CANDIDATE_AND_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 12,
    ruleId: 'universal.12.noUnauthorizedDecorativeElements',
    category: 'ORNAMENT_SAFETY',
    title: '12. NO UNAUTHORIZED DECORATIVE ELEMENTS',
    description:
      'Never invent an ornament, generate a decorative element, or automatically select a built-in ornament merely because empty space exists. If no ornament was supplied or selected by the user: NO ORNAMENT.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Blocks any ornament placement when user-supplied ornaments and explicit user ornament rules are empty; strips unrequested ornaments in safe auto-recovery.',
    blockingBehavior: 'AUTO_STRIP_OR_BLOCK_CANDIDATE',
    userEditable: false,
  },
  {
    lawNumber: 13,
    ruleId: 'universal.13.userSuppliedGraphicsMustNotDamageContent',
    category: 'ORNAMENT_SAFETY',
    title: '13. USER-SUPPLIED GRAPHICS MUST NOT DAMAGE CONTENT',
    description:
      'Explicitly user-supplied graphics/ornaments must never cover text, clip text, create harmful collisions, push content outside the layout area, or cause silent content loss.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Verifies user-supplied ornaments have zero bounding-box overlap with any text or footnote region and stay inside page margins.',
    blockingBehavior: 'REPOSITION_OR_BLOCK_COLLIDING_GRAPHIC',
    userEditable: false,
  },
  {
    lawNumber: 14,
    ruleId: 'universal.14.exportMustPreserveApprovedResult',
    category: 'EXPORT_INTEGRITY',
    title: '14. EXPORT MUST PRESERVE THE APPROVED RESULT',
    description:
      'PDF and IDML export must represent the final approved PageTypesetResult without performing an independent layout/reflow that alters approved geometry or content.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Verifies 1:1 line, word, and coordinate parity between PageTypesetResult and PDF/IDML export plans.',
    blockingBehavior: 'BLOCKS_DIVERGENT_EXPORT',
    userEditable: false,
  },
  {
    lawNumber: 15,
    ruleId: 'universal.15.noExportWithUnresolvedCriticalFailure',
    category: 'EXPORT_INTEGRITY',
    title: '15. NO EXPORT WITH UNRESOLVED CRITICAL FAILURE',
    description:
      'If a critical universal invariant is violated and cannot be safely auto-corrected, produce a structured blocking error, preserve original content, and prevent final export.',
    severity: 'ENGINE_HARD_BLOCKING',
    authority: 'ENGINE_HARD',
    level: 0,
    enforcementBehavior:
      'Attempts non-destructive auto-correction; if impossible, emits EngineHardRuleBlockingError and blocks PDF/IDML export while preserving 100% of source content.',
    blockingBehavior: 'STRUCTURED_BLOCKING_ERROR',
    userEditable: false,
  },
]);
export const ENGINE_HARD_RULES: ReadonlyArray<EngineHardRuleDefinition> = Object.freeze([
  // ============================================================================
  // 1. DATA INTEGRITY
  // ============================================================================
  {
    ruleId: 'engine.dataIntegrity.uniqueUnitIdsAndValidHierarchy',
    category: 'DATA_INTEGRITY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never allow duplicate ContentUnit IDs or corrupted unit identity in the document model.',
    descriptionHe:
      'איסור מוחלט על כפילות מזהי יחידות תוכן (ContentUnit IDs) או פגיעה בשלמות מבנה המסמך.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const units = ctx.units ?? [];
      if (units.length === 0) return { passed: true };
      const seen = new Set<string>();
      for (const u of units) {
        if (!u.id || seen.has(u.id)) {
          return {
            passed: false,
            message: `הפרת שלמות נתונים (LEVEL 0): מזהה יחידה כפול או חסר ('${u.id || 'empty'}').`,
            unitId: u.id,
          };
        }
        seen.add(u.id);
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 2. TEXT CONSERVATION
  // ============================================================================
  {
    ruleId: 'engine.textConservation.neverLoseOrDuplicateSourceText',
    category: 'TEXT_CONSERVATION',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never lose, truncate, or duplicate source text across shaping, pagination, or export.',
    descriptionHe:
      'שימור 100% מטקסט המקור: לעולם אין לאבד, לקטוע או לשכפל מילות מקור בעימוד או בייצוא.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      if (
        ctx.expectedSourceWordCount !== undefined &&
        ctx.actualSourceWordCount !== undefined &&
        ctx.expectedSourceWordCount !== ctx.actualSourceWordCount
      ) {
        return {
          passed: false,
          message: `הפרת שימור טקסט מקור (LEVEL 0): צפויות ${ctx.expectedSourceWordCount} מילים אך שובצו ${ctx.actualSourceWordCount}.`,
          measuredValue: ctx.actualSourceWordCount,
          requiredValue: ctx.expectedSourceWordCount,
        };
      }
      if (ctx.bookDoc && ctx.units && ctx.units.length > 0) {
        const isCommentaryOrFn = (r: ContentRole) =>
          r === 'primary_comment' ||
          r === 'secondary_comment' ||
          r === 'tertiary_comment' ||
          r === 'footnote' ||
          r === 'side_note' ||
          r === 'ornament';
        const expectedSrc = ctx.units
          .filter(u => !isCommentaryOrFn(u.role))
          .reduce((s, u) => s + countUnitWords(u), 0);
        const actualSrc = ctx.bookDoc.pages.reduce(
          (s, p) =>
            s +
            countNonSpaceWordsInLines(p.sourceLines) +
            countNonSpaceWordsInLines(p.column2Lines),
          0
        );
        if (expectedSrc > 0 && actualSrc !== expectedSrc) {
          return {
            passed: false,
            message: `הפרת שימור טקסט מקור בספר (LEVEL 0): ${actualSrc}/${expectedSrc} מילים.`,
            measuredValue: actualSrc,
            requiredValue: expectedSrc,
          };
        }
      }
      return { passed: true };
    },
  },
  {
    ruleId: 'engine.textConservation.neverLoseOrDuplicateCommentaryText',
    category: 'TEXT_CONSERVATION',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never lose, truncate, or duplicate commentary or footnote text across pagination or export.',
    descriptionHe:
      'שימור 100% מטקסט המפרשים והערות השוליים: לעולם אין לאבד או לשכפל מילות פירוש.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      if (
        ctx.expectedCommentaryWordCount !== undefined &&
        ctx.actualCommentaryWordCount !== undefined &&
        ctx.expectedCommentaryWordCount !== ctx.actualCommentaryWordCount
      ) {
        return {
          passed: false,
          message: `הפרת שימור טקסט מפרשים (LEVEL 0): צפויות ${ctx.expectedCommentaryWordCount} מילים אך שובצו ${ctx.actualCommentaryWordCount}.`,
          measuredValue: ctx.actualCommentaryWordCount,
          requiredValue: ctx.expectedCommentaryWordCount,
        };
      }
      if (ctx.bookDoc && ctx.units && ctx.units.length > 0) {
        const expectedCom = ctx.units
          .filter(u => u.role === 'primary_comment' || u.role === 'secondary_comment')
          .reduce((s, u) => s + countUnitWords(u), 0);
        const actualCom = ctx.bookDoc.pages.reduce(
          (s, p) =>
            s +
            countNonSpaceWordsInLines(p.rashiLines) +
            countNonSpaceWordsInLines(p.tosafotLines),
          0
        );
        if (
          expectedCom > 0 &&
          (ctx.bookDoc.layoutType === 'rav_text' ||
            ctx.bookDoc.layoutType === 'mikraot_gedolot' ||
            ctx.bookDoc.layoutType === 'source_top_commentary_bottom') &&
          actualCom !== expectedCom
        ) {
          return {
            passed: false,
            message: `הפרת שימור טקסט מפרשים בספר (LEVEL 0): ${actualCom}/${expectedCom} מילים.`,
            measuredValue: actualCom,
            requiredValue: expectedCom,
          };
        }
      }
      return { passed: true };
    },
  },
  {
    ruleId: 'engine.textConservation.neverHeadingRuleCausesTextLoss',
    category: 'TEXT_CONSERVATION',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never allow a heading keep-with-next or isolation rule to discard heading or body text or merge heading and body onto the same line.',
    descriptionHe:
      'איסור מוחלט על איבוד טקסט או מיזוג כותרת עם גוף הטקסט באותה שורה עקב חוקי כותרות.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const pages = ctx.bookDoc ? ctx.bookDoc.pages : ctx.currentPage ? [ctx.currentPage] : [];
      const isHeading = (r?: ContentRole) =>
        r === 'chapter' || r === 'heading' || r === 'main_title' || r === 'siman';
      for (const page of pages) {
        for (const ln of [...page.sourceLines, ...(page.column2Lines ?? [])]) {
          const realWords = ln.words.filter(w => !w.isSpace && w.text.trim().length > 0);
          const hasHeading = realWords.some(w => isHeading(w.role));
          const hasBody = realWords.some(w => !isHeading(w.role));
          if (hasHeading && hasBody) {
            return {
              passed: false,
              message: `הפרת בידוד כותרת (LEVEL 0): כותרת וטקסט גוף אוחדו לאותה שורה בעמוד ${page.pageNumber}.`,
              pageNumber: page.pageNumber,
              unitId: ln.unitId,
            };
          }
        }
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 3. RTL / HEBREW INTEGRITY
  // ============================================================================
  {
    ruleId: 'engine.rtlHebrew.neverAllowDetachedOrphanCombiningMarks',
    category: 'RTL_HEBREW_INTEGRITY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never allow Hebrew combining marks (Nikud, Dagesh, Shin/Sin dot, Taamim) to become detached or orphaned without a preceding base consonant.',
    descriptionHe:
      'איסור מוחלט על סימני ניקוד או טעמים יתומים/מנותקים מאות הבסיס שלהם.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const pages = ctx.bookDoc ? ctx.bookDoc.pages : ctx.currentPage ? [ctx.currentPage] : [];
      for (const page of pages) {
        const allLines = [
          ...page.sourceLines,
          ...(page.column2Lines ?? []),
          ...page.rashiLines,
          ...page.tosafotLines,
          ...page.footnoteLines,
        ];
        for (const ln of allLines) {
          for (const w of ln.words) {
            if (w.isSpace || !w.glyphs || w.glyphs.length === 0) continue;
            if (w.glyphs[0].isMark) {
              return {
                passed: false,
                message: `הפרת שלמות ניקוד/טעמים (LEVEL 0): סימן ניקוד יתום בתחילת המילה '${w.text}' ללא אות בסיס.`,
                pageNumber: page.pageNumber,
                unitId: ln.unitId,
              };
            }
          }
        }
      }
      return { passed: true };
    },
  },
  {
    ruleId: 'engine.rtlHebrew.neverViolateRtlLogicalOrder',
    category: 'RTL_HEBREW_INTEGRITY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never violate Right-to-Left (RTL) logical and visual monotonic order (`xRight >= xLeft` and monotonic right-to-left word progression).',
    descriptionHe:
      'איסור מוחלט על הפרת סדר וכיווניות עברית מימין לשמאל (RTL).',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const pages = ctx.bookDoc ? ctx.bookDoc.pages : ctx.currentPage ? [ctx.currentPage] : [];
      for (const page of pages) {
        const allLines = [
          ...page.sourceLines,
          ...(page.column2Lines ?? []),
          ...page.rashiLines,
          ...page.tosafotLines,
          ...page.footnoteLines,
        ];
        for (const ln of allLines) {
          if (
            ln.xLeft !== undefined &&
            ln.xRight !== undefined &&
            ln.xRight < ln.xLeft - 0.1
          ) {
            return {
              passed: false,
              message: `הפרת כיווניות RTL (LEVEL 0): גבולות שורה הפוכים (xRight=${ln.xRight} < xLeft=${ln.xLeft}) בעמוד ${page.pageNumber}.`,
              pageNumber: page.pageNumber,
              unitId: ln.unitId,
              measuredValue: ln.xRight - ln.xLeft,
              requiredValue: '>= 0',
            };
          }
        }
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 4. FONT / SHAPING INTEGRITY
  // ============================================================================
  {
    ruleId: 'engine.fontShaping.combiningMarksZeroAdvanceAndRealMetrics',
    category: 'FONT_SHAPING_INTEGRITY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Combining marks (Nikud and Taamim) must maintain zero horizontal advance (`xAdvance === 0`) and line breaking must use real shaped glyph widths rather than word-count heuristics.',
    descriptionHe:
      'סימני ניקוד וטעמים חייבים להיות בעלי רוחב מתקדם אפס (xAdvance = 0), ושבירת שורות חייבת להתבסס על מדידת גליפים אמיתית.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const pages = ctx.bookDoc ? ctx.bookDoc.pages : ctx.currentPage ? [ctx.currentPage] : [];
      for (const page of pages) {
        const allLines = [
          ...page.sourceLines,
          ...(page.column2Lines ?? []),
          ...page.rashiLines,
          ...page.tosafotLines,
          ...page.footnoteLines,
        ];
        for (const ln of allLines) {
          for (const w of ln.words) {
            if (w.isSpace) continue;
            for (const g of w.glyphs ?? []) {
              if (g.isMark && Math.abs(g.xAdvance) > 0.001) {
                return {
                  passed: false,
                  message: `הפרת עיצוב גופנים (LEVEL 0): סימן ניקוד/טעמים קיבל xAdvance=${g.xAdvance} במקום 0 במילה '${w.text}'.`,
                  pageNumber: page.pageNumber,
                  unitId: ln.unitId,
                  measuredValue: g.xAdvance,
                  requiredValue: 0,
                };
              }
            }
          }
        }
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 5. RAV TEXT RELATIONSHIP INTEGRITY
  // ============================================================================
  {
    ruleId: 'engine.ravText.neverBreakSourceCommentaryRelationship',
    category: 'RAV_TEXT_RELATIONSHIP_INTEGRITY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never break a Rav Text source/commentary relationship incorrectly: a linked commentary unit must either appear on the same page as its linked source unit or be explicitly tracked in splitLinkIdsToNextPage / continuedUnitIdsFromPrevPage.',
    descriptionHe:
      'איסור מוחלט על ניתוק שגוי של קשר מקור-מפרש ברב-טקסט ללא מעקב המשך חוקי.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const links = ctx.links ?? ctx.bookDoc?.links ?? [];
      if (links.length === 0) return { passed: true };

      if (ctx.bookDoc) {
        const allPlacedUnitIds = new Set<string>();
        for (const p of ctx.bookDoc.pages) {
          for (const ln of [
            ...p.sourceLines,
            ...(p.column2Lines ?? []),
            ...p.rashiLines,
            ...p.tosafotLines,
          ]) {
            if (ln.unitId) allPlacedUnitIds.add(ln.unitId);
            for (const w of ln.words) {
              if (w.unitId) allPlacedUnitIds.add(w.unitId);
            }
          }
        }
        for (const lnk of links) {
          if (
            allPlacedUnitIds.has(lnk.sourceUnitId) &&
            !allPlacedUnitIds.has(lnk.commentaryUnitId)
          ) {
            return {
              passed: false,
              message: `הפרת קשר רב-טקסט (LEVEL 0): יחידת הפירוש המקושרת '${lnk.commentaryUnitId}' (${lnk.dibburHamatchil}) נותקה לחלוטין ממקורה '${lnk.sourceUnitId}'.`,
              unitId: lnk.commentaryUnitId,
            };
          }
        }
      } else if (ctx.currentPage) {
        const page = ctx.currentPage;
        const pageUnitIds = new Set<string>();
        for (const ln of [
          ...page.sourceLines,
          ...(page.column2Lines ?? []),
          ...page.rashiLines,
          ...page.tosafotLines,
        ]) {
          if (ln.unitId) pageUnitIds.add(ln.unitId);
          for (const w of ln.words) {
            if (w.unitId) pageUnitIds.add(w.unitId);
          }
        }
        const splitLinks = new Set<string>([
          ...(page.splitLinkIdsToNextPage ?? []),
          ...(page.splitLinkIdsFromPrevPage ?? []),
        ]);
        const nextPageUnitIds = new Set<string>();
        if (ctx.nextPage) {
          for (const ln of [
            ...ctx.nextPage.sourceLines,
            ...ctx.nextPage.rashiLines,
            ...ctx.nextPage.tosafotLines,
          ]) {
            if (ln.unitId) nextPageUnitIds.add(ln.unitId);
            for (const w of ln.words) {
              if (w.unitId) nextPageUnitIds.add(w.unitId);
            }
          }
        }

        for (const lnk of links) {
          if (
            pageUnitIds.has(lnk.sourceUnitId) &&
            !pageUnitIds.has(lnk.commentaryUnitId) &&
            !splitLinks.has(lnk.linkId) &&
            !nextPageUnitIds.has(lnk.commentaryUnitId)
          ) {
            return {
              passed: false,
              message: `הפרת קשר רב-טקסט בעמוד ${page.pageNumber} (LEVEL 0): פירוש '${lnk.dibburHamatchil}' הופרד ממקורו ללא המשך חוקי.`,
              pageNumber: page.pageNumber,
              unitId: lnk.commentaryUnitId,
            };
          }
        }
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 6. GEOMETRIC COLLISION SAFETY
  // ============================================================================
  {
    ruleId: 'engine.geometry.neverCreateTextCollisions',
    category: 'GEOMETRIC_COLLISION_SAFETY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never create 2D geometric collisions between Source, Rashi, Tosafot, Two-Column streams, Footnotes, or Ornaments.',
    descriptionHe:
      'איסור מוחלט על התנגשויות גאומטריות (2D Collisions) בין מקור, מפרשים, הערות שוליים או עיטורים.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const pages = ctx.bookDoc ? ctx.bookDoc.pages : ctx.currentPage ? [ctx.currentPage] : [];
      for (const page of pages) {
        const reportedCollisions = page.layoutScore?.collisionCount ?? 0;
        if (reportedCollisions > 0) {
          return {
            passed: false,
            message: `הפרת בטיחות גאומטרית (LEVEL 0): זוהו ${reportedCollisions} התנגשויות טקסט בעמוד ${page.pageNumber}.`,
            pageNumber: page.pageNumber,
            measuredValue: reportedCollisions,
            requiredValue: 0,
          };
        }

        const contentW =
          page.geometry.pageWidth - page.geometry.marginInside - page.geometry.marginOutside;
        const auditedCollisions = SpatialExclusionEngine.auditPageCollisions(
          page.sourceLines,
          page.rashiLines,
          page.tosafotLines,
          page.footnoteLines,
          page.column2Lines ?? [],
          contentW
        );
        if (auditedCollisions.length > 0) {
          const c = auditedCollisions[0];
          return {
            passed: false,
            message: `הפרת בטיחות גאומטרית (LEVEL 0): חפיפה פיזית בין '${c.regionA.id}' ל-'${c.regionB.id}' (${c.overlapAreaPt2.toFixed(1)}pt²) בעמוד ${page.pageNumber}.`,
            pageNumber: page.pageNumber,
            measuredValue: auditedCollisions.length,
            requiredValue: 0,
          };
        }
      }
      return { passed: true };
    },
  },
  {
    ruleId: 'engine.geometry.neverViolateFundamentalMinimumReadableWidth',
    category: 'GEOMETRIC_COLLISION_SAFETY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never violate fundamental minimum readable geometry constraints (Source >= 135pt, Commentary >= 78pt).',
    descriptionHe:
      'איסור מוחלט על ירידה מתחת לרוחב הקריאה הפיזי המינימלי של המנוע (135pt למקור, 78pt למפרשים).',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const pages = ctx.bookDoc ? ctx.bookDoc.pages : ctx.currentPage ? [ctx.currentPage] : [];
      const minSrc =
        SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT -
        SpatialExclusionEngine.GEOMETRIC_EPSILON_PT;
      const minCom =
        SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT -
        SpatialExclusionEngine.GEOMETRIC_EPSILON_PT;

      for (const page of pages) {
        for (const sLine of page.sourceLines) {
          if (sLine.targetWidth > 0 && sLine.targetWidth < minSrc - 0.5) {
            return {
              passed: false,
              message: `הפרת גאומטריה מינימלית (LEVEL 0): רוחב שורת מקור (${sLine.targetWidth.toFixed(1)}pt) קטן מסף המנוע הקשיח (${SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT}pt).`,
              pageNumber: page.pageNumber,
              unitId: sLine.unitId,
              measuredValue: sLine.targetWidth,
              requiredValue: SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT,
            };
          }
        }
        for (const cLine of [...page.rashiLines, ...page.tosafotLines]) {
          if (cLine.targetWidth > 0 && cLine.targetWidth < minCom - 0.5) {
            return {
              passed: false,
              message: `הפרת גאומטריה מינימלית (LEVEL 0): רוחב שורת פירוש (${cLine.targetWidth.toFixed(1)}pt) קטן מסף המנוע הקשיח (${SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT}pt).`,
              pageNumber: page.pageNumber,
              unitId: cLine.unitId,
              measuredValue: cLine.targetWidth,
              requiredValue: SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT,
            };
          }
        }
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 7. FOOTNOTE ANCHOR INTEGRITY
  // ============================================================================
  {
    ruleId: 'engine.footnotes.neverLoseFootnoteAnchorRelationship',
    category: 'FOOTNOTE_ANCHOR_INTEGRITY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never allow a footnote anchor relationship to be lost: every body word carrying a footnoteUnitId must have its footnote placed on the same page or tracked via multi-page continuation.',
    descriptionHe:
      'איסור מוחלט על איבוד קשר עוגן הערת שוליים: כל הערת שוליים המעוגנת למילה בגוף העמוד חייבת להופיע בתחתית העמוד או בהמשך חוקי.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const pages = ctx.bookDoc ? ctx.bookDoc.pages : ctx.currentPage ? [ctx.currentPage] : [];
      for (const page of pages) {
        const allBodyLines = [
          ...page.sourceLines,
          ...(page.column2Lines ?? []),
          ...page.rashiLines,
          ...page.tosafotLines,
        ];
        const anchoredIds = new Set<string>();
        for (const ln of allBodyLines) {
          for (const w of ln.words) {
            if (w.footnoteUnitId) anchoredIds.add(w.footnoteUnitId);
          }
        }
        if (anchoredIds.size === 0) continue;

        const placedFnIds = new Set<string>(page.footnoteLines.map(fl => fl.unitId));
        const continuedIds = new Set<string>(page.continuedUnitIdsToNextPage ?? []);
        for (const reqId of anchoredIds) {
          if (!placedFnIds.has(reqId) && !continuedIds.has(reqId)) {
            return {
              passed: false,
              message: `הפרת שלמות עוגן הערת שוליים (LEVEL 0): הערת שוליים '${reqId}' המעוגנת בעמוד ${page.pageNumber} חסרה מתחתית העמוד.`,
              pageNumber: page.pageNumber,
              unitId: reqId,
            };
          }
        }
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 8. ORNAMENT SAFETY (Stage 11D)
  // ============================================================================
  {
    ruleId: 'engine.ornaments.neverIntroduceUnsuppliedOrnaments',
    category: 'ORNAMENT_SAFETY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never introduce decorative elements or ornaments that the user did not explicitly provide or select.',
    descriptionHe:
      'מדיניות עיטורים קשיחה (Stage 11D / LEVEL 0): לעולם אין להמציא או להוסיף עיטורים שלא סופקו או נבחרו במפורש ע״י המשתמש.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const pages = ctx.bookDoc ? ctx.bookDoc.pages : ctx.currentPage ? [ctx.currentPage] : [];
      const units = ctx.units ?? [];
      const unitExplicitCount = units.filter(u => Boolean(u.ornamentId)).length;
      const suppliedCount =
        (ctx.userSuppliedOrnamentsCount ?? 0) +
        (ctx.userSuppliedOrnaments?.length ?? 0) +
        (ctx.userOrnamentRules?.length ?? 0) +
        unitExplicitCount;

      for (const page of pages) {
        const placed = page.placedOrnaments ?? [];
        if (placed.length > 0 && suppliedCount === 0) {
          return {
            passed: false,
            message: `הפרת חוק מנוע קשיח (LEVEL 0 — ORNAMENT_SAFETY): שובצו ${placed.length} עיטורים בעמוד ${page.pageNumber} ללא בחירת משתמש מפורשת.`,
            pageNumber: page.pageNumber,
            measuredValue: placed.length,
            requiredValue: 0,
            safeAutoRecoverable: true,
          };
        }
      }
      return { passed: true };
    },
  },
  {
    ruleId: 'engine.ornaments.neverAutoSelectBuiltinOrnaments',
    category: 'ORNAMENT_SAFETY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never permit automatic selection of built-in ornaments merely because empty space exists when no user ornament or rule was supplied.',
    descriptionHe:
      'איסור מוחלט על בחירה אוטומטית של עיטורים מובנים מהספרייה בגלל שטח פנוי בעמוד ללא הוראת משתמש מפורשת.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const pages = ctx.bookDoc ? ctx.bookDoc.pages : ctx.currentPage ? [ctx.currentPage] : [];
      const units = ctx.units ?? [];
      const allowedIds = new Set<string>();
      for (const u of units) {
        if (u.ornamentId) allowedIds.add(u.ornamentId);
      }
      for (const s of ctx.userSuppliedOrnaments ?? []) {
        allowedIds.add(s.id);
      }
      for (const r of ctx.userOrnamentRules ?? []) {
        allowedIds.add(r.ornamentId);
      }

      const explicitCountHint = ctx.userSuppliedOrnamentsCount ?? 0;
      for (const page of pages) {
        for (const orn of page.placedOrnaments ?? []) {
          if (
            orn.asset.format === 'svg_builtin' &&
            !orn.asset.isUserUploaded &&
            allowedIds.size === 0 &&
            explicitCountHint === 0
          ) {
            return {
              passed: false,
              message: `הפרת חוק מנוע קשיח (LEVEL 0 — ORNAMENT_SAFETY): עיטור מובנה '${orn.asset.id}' נבחר אוטומטית ללא בחירת משתמש.`,
              pageNumber: page.pageNumber,
              measuredValue: orn.asset.id,
              requiredValue: 'none',
              safeAutoRecoverable: true,
            };
          }
        }
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 9. PAGINATION SAFETY
  // ============================================================================
  {
    ruleId: 'engine.pagination.neverSilentlyDiscardOverflowText',
    category: 'PAGINATION_SAFETY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never silently discard overflow text on any page or candidate layout (`unplacedWordsCount === 0`).',
    descriptionHe:
      'איסור מוחלט על השמטה שקטה של טקסט גולש (Overflow) בעת עימוד עמוד או בחירת מועמד.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      if (ctx.unplacedWordsCount !== undefined && ctx.unplacedWordsCount > 0) {
        return {
          passed: false,
          message: `הפרת בטיחות עימוד (LEVEL 0): ${ctx.unplacedWordsCount} מילים לא שובצו בעמוד (Overflow Loss).`,
          measuredValue: ctx.unplacedWordsCount,
          requiredValue: 0,
        };
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 10. EXPORT INTEGRITY
  // ============================================================================
  {
    ruleId: 'engine.export.neverExportUnresolvedLayoutLoss',
    category: 'EXPORT_INTEGRITY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never knowingly export a PDF or IDML document containing unresolved layout loss, empty pages on non-empty input, or active hard-rule violations.',
    descriptionHe:
      'איסור מוחלט על ייצוא מסמך (PDF/IDML) המכיל איבוד טקסט או הפרת חוק מנוע קשיח לא פתורה.',
    blocksPagination: false,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      if (ctx.bookDoc) {
        if (ctx.bookDoc.pages.length === 0) {
          return {
            passed: false,
            message: 'הפרת שלמות ייצוא (LEVEL 0): המסמך אינו מכיל עמודים מעומדים לייצוא.',
            measuredValue: 0,
            requiredValue: '>= 1',
          };
        }
        for (const p of ctx.bookDoc.pages) {
          if ((p.layoutScore?.collisionCount ?? 0) > 0) {
            return {
              passed: false,
              message: `הפרת שלמות ייצוא (LEVEL 0): עמוד ${p.pageNumber} מכיל התנגשויות גאומטריות לא פתורות.`,
              pageNumber: p.pageNumber,
            };
          }
        }
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 11. IDML STRUCTURAL INTEGRITY
  // ============================================================================
  {
    ruleId: 'engine.idml.neverFlattenToRasterImagesAndPreserveFrames',
    category: 'IDML_STRUCTURAL_INTEGRITY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never allow an IDML export to flatten the document into raster images; always emit editable InDesign Stories and non-overlapping polygonal/rectangular TextFrames.',
    descriptionHe:
      'איסור מוחלט על השטחת ייצוא IDML לתמונות רסטר: חובה לשמור על מסגרות טקסט פוליגוניות/מלבניות וסיפורים (Stories) ניתנים לעריכה מלאה באינדיזיין.',
    blocksPagination: false,
    blocksExport: true,
    blocksAiCandidateSelection: false,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      if (ctx.idmlAudit) {
        if (ctx.idmlAudit.hasRasterizedSubstitutes) {
          return {
            passed: false,
            message:
              'הפרת שלמות IDML (LEVEL 0): נמצאו תחליפי תמונה רסטריים במקום מסגרות טקסט חיות של אינדיזיין.',
          };
        }
        if ((ctx.idmlAudit.overlappingTextFrames?.length ?? 0) > 0) {
          return {
            passed: false,
            message: `הפרת שלמות IDML (LEVEL 0): נמצאו מסגרות טקסט חופפות (${ctx.idmlAudit.overlappingTextFrames![0]}).`,
          };
        }
        if ((ctx.idmlAudit.brokenStoryReferences?.length ?? 0) > 0) {
          return {
            passed: false,
            message: `הפרת שלמות IDML (LEVEL 0): הפניית Story שבורה (${ctx.idmlAudit.brokenStoryReferences![0]}).`,
          };
        }
        if (
          ctx.idmlAudit.expectedWordCount !== undefined &&
          ctx.idmlAudit.conservedWordCount !== undefined &&
          ctx.idmlAudit.expectedWordCount !== ctx.idmlAudit.conservedWordCount
        ) {
          return {
            passed: false,
            message: `הפרת שימור טקסט ב-IDML (LEVEL 0): ${ctx.idmlAudit.conservedWordCount}/${ctx.idmlAudit.expectedWordCount} מילים.`,
            measuredValue: ctx.idmlAudit.conservedWordCount,
            requiredValue: ctx.idmlAudit.expectedWordCount,
          };
        }
      }
      return { passed: true };
    },
  },

  // ============================================================================
  // 12. USER DATA SAFETY
  // ============================================================================
  {
    ruleId: 'engine.userData.neverMutateUserLockedLinksOrCanonicalDefaults',
    category: 'USER_DATA_SAFETY',
    severity: 'ENGINE_HARD_BLOCKING',
    level: 0,
    authority: 'ENGINE_HARD_RULE',
    description:
      'Never overwrite user-locked Rav Text links (`isUserLocked === true`) or mutate canonical application defaults.',
    descriptionHe:
      'בטיחות נתוני משתמש (LEVEL 0): לעולם אין לדרוס קישורי רב-טקסט שננעלו ע״י המשתמש או לשנות את ברירות המחדל הקנוניות של המנוע.',
    blocksPagination: true,
    blocksExport: true,
    blocksAiCandidateSelection: true,
    userEditable: false,
    check: (ctx: EngineHardRuleMachineContext): EngineHardRuleCheckOutcome => {
      const links = ctx.links ?? ctx.bookDoc?.links ?? [];
      for (const lnk of links) {
        if (lnk.isUserLocked && (!lnk.sourceUnitId || !lnk.commentaryUnitId)) {
          return {
            passed: false,
            message: `הפרת בטיחות נתוני משתמש (LEVEL 0): קישור נעול '${lnk.linkId}' נפגם או איבד את יחידות המקור/פירוש שלו.`,
          };
        }
      }
      return { passed: true };
    },
  },
]);

export class EngineHardRuleError extends Error {
  public readonly violations: EngineHardRuleViolation[];

  constructor(message: string, violations: EngineHardRuleViolation[]) {
    super(message);
    this.name = 'EngineHardRuleError';
    this.violations = violations;
  }
}

export class EngineHardRulesEngine {
  /**
   * Returns a read-only list of all 15 Universal Engine Hard Laws (Level 0).
   */
  public static getUniversalLaws(): ReadonlyArray<UniversalEngineHardLaw> {
    return UNIVERSAL_ENGINE_HARD_LAWS;
  }

  /**
   * Returns a read-only list of all Level 0 Owner / Engine Hard Rules.
   */
  public static getAllRules(): ReadonlyArray<EngineHardRuleDefinition> {
    return ENGINE_HARD_RULES;
  }

  /**
   * Looks up a specific Engine Hard Rule by its `EngineHardRuleId`.
   */
  public static getRuleById(ruleId: EngineHardRuleId): EngineHardRuleDefinition | undefined {
    return ENGINE_HARD_RULES.find(r => r.ruleId === ruleId);
  }

  /**
   * Checks whether a `TypesettingRuleId` is governed by an immutable Level 0 Engine Hard Rule.
   */
  public static getMappedEngineHardRule(typesettingRuleId: string): {
    definition: EngineHardRuleDefinition;
    enforcedValue: boolean | number;
    disposition: 'REQUIRED' | 'FORBIDDEN';
    minimumThreshold?: number;
  } | null {
    const entry = TYPESETTING_RULE_TO_ENGINE_HARD_RULE_MAP[typesettingRuleId];
    if (!entry) return null;
    const def = this.getRuleById(entry.engineRuleId);
    if (!def) return null;
    return {
      definition: def,
      enforcedValue: entry.enforcedValue,
      disposition: entry.disposition,
      minimumThreshold: entry.minimumThreshold,
    };
  }

  /**
   * Evaluates all Level 0 Engine Hard Rules against the provided machine context.
   */
  public static evaluateContext(
    ctx: EngineHardRuleMachineContext
  ): EngineHardRuleEnforcementReport {
    const violations: EngineHardRuleViolation[] = [];

    for (const rule of ENGINE_HARD_RULES) {
      const outcome = rule.check(ctx);
      if (!outcome.passed) {
        violations.push({
          ruleId: rule.ruleId,
          category: rule.category,
          severity: 'ENGINE_HARD_BLOCKING',
          authority: 'ENGINE_HARD_RULE',
          message: outcome.message || rule.descriptionHe,
          pageNumber: outcome.pageNumber ?? ctx.currentPage?.pageNumber,
          unitId: outcome.unitId,
          measuredValue: outcome.measuredValue,
          requiredValue: outcome.requiredValue,
          blocksPagination: rule.blocksPagination,
          blocksExport: rule.blocksExport,
          blocksAiCandidateSelection: rule.blocksAiCandidateSelection,
        });
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      blocksPagination: violations.some(v => v.blocksPagination),
      blocksExport: violations.some(v => v.blocksExport),
      blocksAiCandidateSelection: violations.some(v => v.blocksAiCandidateSelection),
      autoCorrectionApplied: false,
      autoCorrectionActions: [],
    };
  }

  /**
   * Attempts safe, non-destructive automatic correction on a page or document when an
   * Engine Hard Rule violation is safely recoverable without losing any source/commentary/footnote text
   * (for example, stripping an unrequested ornament if one was ever injected into a candidate page).
   *
   * NEVER drops or truncates text.
   */
  public static attemptSafeAutoCorrection(
    page: PageTypesetResult,
    ctx: EngineHardRuleMachineContext
  ): {
    correctedPage: PageTypesetResult;
    applied: boolean;
    actions: string[];
  } {
    let applied = false;
    const actions: string[] = [];
    let nextPlacedOrnaments: PlacedOrnament[] | undefined = page.placedOrnaments;
    let nextOccupiedRegions: OccupiedRegion[] | undefined = page.occupiedRegions;

    const units = ctx.units ?? [];
    const unitExplicitOrnCount = units.filter(u => Boolean(u.ornamentId)).length;
    const totalExplicitOrns =
      (ctx.userSuppliedOrnamentsCount ?? 0) +
      (ctx.userSuppliedOrnaments?.length ?? 0) +
      (ctx.userOrnamentRules?.length ?? 0) +
      unitExplicitOrnCount;

    if ((page.placedOrnaments?.length ?? 0) > 0 && totalExplicitOrns === 0) {
      nextPlacedOrnaments = [];
      nextOccupiedRegions = (page.occupiedRegions ?? []).filter(r => r.role !== 'ornament');
      applied = true;
      actions.push(
        'תיקון אוטומטי בטוח (LEVEL 0 — ORNAMENT_SAFETY): הוסרו עיטורים שלא סופקו במפורש ע״י המשתמש תוך שימור 100% מהטקסט.'
      );
    }

    if (!applied) {
      return { correctedPage: page, applied: false, actions: [] };
    }

    return {
      correctedPage: {
        ...page,
        placedOrnaments: nextPlacedOrnaments,
        occupiedRegions: nextOccupiedRegions,
      },
      applied: true,
      actions,
    };
  }

  /**
   * Enforces Level 0 Engine Hard Rules prior to PDF or IDML export.
   * Throws a structured `EngineHardRuleError` if any export-blocking Engine Hard Rule is violated.
   */
  public static assertExportAllowed(ctx: EngineHardRuleMachineContext): EngineHardRuleEnforcementReport {
    const report = this.evaluateContext(ctx);
    const blocking = report.violations.filter(v => v.blocksExport);
    if (blocking.length > 0) {
      throw new EngineHardRuleError(
        `ייצוא נחסם ע״י חוקי מנוע קשיחים (LEVEL 0 ENGINE HARD RULES): ${blocking
          .map(b => b.message)
          .join(' | ')}`,
        blocking
      );
    }
    return report;
  }
}
