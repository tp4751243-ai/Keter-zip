/**
 * STAGE 12 — PROFESSIONAL TYPESETTING RULES ENGINE
 *
 * Centralized, persistent, user-editable Professional Typesetting Rules Engine.
 * Provides a single source of truth for all professional typesetting constraints,
 * preferences, project rules, and local overrides without scattering hard-coded
 * thresholds across pagination, dynamic knee, or line-breaking engines.
 *
 * Rule Hierarchy (Strict Priority Order):
 *   1. LOCAL HARD RULE       (LOCAL_OVERRIDE + HARD_USER_RULE)
 *   2. PROJECT HARD RULE     (PROJECT_RULE + HARD_USER_RULE)
 *   3. USER HARD RULE        (USER_RULE + HARD_USER_RULE)
 *   4. LOCAL PREFERENCE      (LOCAL_OVERRIDE + PREFERENCE)
 *   5. PROJECT PREFERENCE    (PROJECT_RULE + PREFERENCE)
 *   6. USER PREFERENCE       (USER_RULE + PREFERENCE)
 *   7. PROFESSIONAL DEFAULT  (PROFESSIONAL_DEFAULT)
 *   8. AI / LAYOUT PREFERENCE(AI_PREFERENCE)
 *
 * Invariant: No preference or AI score may ever override an active Hard Rule.
 * Ornament Policy (Stage 11D): Ornaments are USER-SUPPLIED ONLY; the Rules Engine
 * never creates or auto-selects built-in ornaments.
 */

import {
  BookLayoutType,
  ContentRole,
  ContentUnit,
  KeepPriority,
  OccupiedRegion,
  OrnamentAsset,
  OrnamentUserRule,
  PageGeometry,
  PageTypesetResult,
  RavTextLink,
  ShapedWord,
  TextRun,
  TypesetLine,
} from '../types/typesetter';
import { SpatialExclusionEngine } from './spatial-exclusion';
import {
  ENGINE_HARD_RULES,
  EngineHardRuleDefinition,
  EngineHardRuleId,
  EngineHardRulesEngine,
  EngineHardRuleViolation,
} from './engine-hard-rules';

export const GLOBAL_USER_RULES_STORAGE_KEY = 'keter_global_user_typesetting_rules_v1';

export type TypesettingRuleCategory =
  | 'paragraph'
  | 'headings'
  | 'semantic_content'
  | 'page_balance'
  | 'line_quality'
  | 'hebrew_rtl'
  | 'footnotes'
  | 'rav_text'
  | 'ornaments';

export type TypesettingRulePriorityLevel =
  | 'ENGINE_HARD_RULE'
  | 'HARD_USER_RULE'
  | 'PROFESSIONAL_DEFAULT'
  | 'AI_PREFERENCE';

export type TypesettingRuleSourceLayer =
  | 'ENGINE_HARD_RULE'
  | 'LOCAL_OVERRIDE'
  | 'PROJECT_RULE'
  | 'USER_RULE'
  | 'PROFESSIONAL_DEFAULT'
  | 'AI_PREFERENCE';

export type RuleAuthorityLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type RuleResolutionDisposition =
  | 'FORBIDDEN'
  | 'REQUIRED'
  | 'PREFERRED'
  | 'DISCOURAGED'
  | 'NOT_APPLICABLE';

export type TypesettingRuleId =
  // Paragraph rules
  | 'paragraph.preventWidows'
  | 'paragraph.preventOrphans'
  | 'paragraph.minWidowLines'
  | 'paragraph.minOrphanLines'
  | 'paragraph.minFinalLineWords'
  | 'paragraph.minFinalLineWidthRatio'
  | 'paragraph.spacingPt'
  | 'paragraph.allowContinuationAcrossPages'
  // Heading rules
  | 'headings.keepWithNext'
  | 'headings.minFollowingLines'
  | 'headings.preventStrandedAtBottom'
  | 'headings.isolateFromBodyLine'
  | 'headings.neverJustifyHeading'
  | 'headings.lineHeightMultiplier'
  // Semantic Content rules
  | 'semantic.sourceCommentaryPriority'
  | 'semantic.dibburCommentaryPriority'
  | 'semantic.headingParagraphPriority'
  | 'semantic.paragraphPriority'
  | 'semantic.minBodyWordsAfterDibburOnPage'
  | 'semantic.keepVerseWithCommentary'
  | 'semantic.keepFootnoteWithAnchor'
  // Page Balance rules
  | 'pageBalance.avoidExcessiveEmptySpace'
  | 'pageBalance.minSparseNextPageWords'
  | 'pageBalance.maxCommentaryWidowTailWords'
  | 'pageBalance.avoidUnnecessaryPageBreaks'
  | 'pageBalance.avoidOverCompression'
  | 'pageBalance.targetUtilizationMinPercent'
  | 'pageBalance.targetUtilizationMaxPercent'
  // Line Quality rules
  | 'lineQuality.minReadableSourceWidthPt'
  | 'lineQuality.minReadableCommentaryWidthPt'
  | 'lineQuality.avoidOneWordMidParagraphLines'
  | 'lineQuality.avoidExtremelyShortJustifiedLines'
  | 'lineQuality.maxJustifyDeficitRatioStandard'
  | 'lineQuality.maxJustifyDeficitRatioCommentaryTwoWords'
  | 'lineQuality.preserveNaturalRaggedFinalLines'
  | 'lineQuality.minLinesForSourceWidthExpansion'
  // Hebrew / RTL rules
  | 'hebrewRtl.preserveRtlMonotonicOrder'
  | 'hebrewRtl.preserveCombiningMarksZeroAdvance'
  | 'hebrewRtl.preventOrphanedDiacritics'
  | 'hebrewRtl.preservePunctuationBehavior'
  | 'hebrewRtl.respectActualFontMetrics'
  // Footnote rules
  | 'footnotes.preserveAnchorRelationship'
  | 'footnotes.samePageWithAnchor'
  | 'footnotes.allowMultiPageContinuation'
  | 'footnotes.justifyMultiLineNonFinal'
  | 'footnotes.preserveRaggedFinalAndSingleLine'
  | 'footnotes.lineHeightPt'
  | 'footnotes.separatorPaddingPt'
  // Rav Text rules
  | 'ravText.preferSamePageSourceCommentary'
  | 'ravText.dibburKeepTogether'
  | 'ravText.defaultUpperCollarLines'
  | 'ravText.defaultGutterWidthPt'
  | 'ravText.preserveStage3Geometry'
  // Ornament rules (Stage 11D)
  | 'ornaments.userSuppliedOnly'
  | 'ornaments.forbidAutoSelectionOfBuiltins'
  | 'ornaments.forbidAutoCreationOnEmptySpace'
  | 'ornaments.minSafetyClearancePt';

export interface RuleScopeFilter {
  layoutType?: BookLayoutType;
  pageNumber?: number;
  pageIndex?: number;
  unitId?: string;
  role?: ContentRole;
  groupId?: string;
}

export interface UserTypesettingRule<T = number | boolean | string> {
  id: string;
  ruleId: TypesettingRuleId;
  category: TypesettingRuleCategory;
  enabled: boolean;
  priority: TypesettingRulePriorityLevel;
  isHardConstraint: boolean;
  value: T;
  disposition?: RuleResolutionDisposition;
  scope?: RuleScopeFilter;
  source: 'user' | 'project' | 'local' | 'ai_natural_language' | 'professional_default';
  description?: string;
  naturalLanguageOrigin?: string;
}

export interface LocalRuleOverride<T = number | boolean | string> extends UserTypesettingRule<T> {
  source: 'local';
  scope: RuleScopeFilter; // Local overrides MUST define an explicit local scope (e.g. unitId, pageNumber, pageIndex, groupId)
  forcePageBreakBeforeUnitId?: string;
  keepTogetherUnitIds?: string[];
}

export interface ProfessionalRuleSet {
  paragraph: {
    preventWidows: boolean;
    preventOrphans: boolean;
    minWidowLines: number;
    minOrphanLines: number;
    minFinalLineWords: number;
    minFinalLineWidthRatio: number;
    spacingPt: number;
    allowContinuationAcrossPages: boolean;
  };
  headings: {
    keepWithNext: boolean;
    minFollowingLines: number;
    preventStrandedAtBottom: boolean;
    isolateFromBodyLine: boolean;
    neverJustifyHeading: boolean;
    lineHeightMultiplier: number;
  };
  semanticContent: {
    sourceCommentaryPriority: number;
    dibburCommentaryPriority: number;
    headingParagraphPriority: number;
    paragraphPriority: number;
    minBodyWordsAfterDibburOnPage: number;
    keepVerseWithCommentary: boolean;
    keepFootnoteWithAnchor: boolean;
  };
  pageBalance: {
    avoidExcessiveEmptySpace: boolean;
    minSparseNextPageWords: number;
    maxCommentaryWidowTailWords: number;
    avoidUnnecessaryPageBreaks: boolean;
    avoidOverCompression: boolean;
    targetUtilizationMinPercent: number;
    targetUtilizationMaxPercent: number;
  };
  lineQuality: {
    minReadableSourceWidthPt: number;
    minReadableCommentaryWidthPt: number;
    avoidOneWordMidParagraphLines: boolean;
    avoidExtremelyShortJustifiedLines: boolean;
    maxJustifyDeficitRatioStandard: number;
    maxJustifyDeficitRatioCommentaryTwoWords: number;
    preserveNaturalRaggedFinalLines: boolean;
    minLinesForSourceWidthExpansion: number;
  };
  hebrewRtl: {
    preserveRtlMonotonicOrder: boolean;
    preserveCombiningMarksZeroAdvance: boolean;
    preventOrphanedDiacritics: boolean;
    preservePunctuationBehavior: boolean;
    respectActualFontMetrics: boolean;
  };
  footnotes: {
    preserveAnchorRelationship: boolean;
    samePageWithAnchor: boolean;
    allowMultiPageContinuation: boolean;
    justifyMultiLineNonFinal: boolean;
    preserveRaggedFinalAndSingleLine: boolean;
    lineHeightPt: number;
    separatorPaddingPt: number;
  };
  ravText: {
    preferSamePageSourceCommentary: boolean;
    dibburKeepTogether: boolean;
    defaultUpperCollarLines: number;
    defaultGutterWidthPt: number;
    preserveStage3Geometry: boolean;
  };
  ornaments: {
    userSuppliedOnly: boolean;
    forbidAutoSelectionOfBuiltins: boolean;
    forbidAutoCreationOnEmptySpace: boolean;
    minSafetyClearancePt: number;
  };
}

export interface UserRuleSet {
  rules: UserTypesettingRule[];
  updatedAt?: number;
}

export interface ProjectRuleSet {
  projectId?: string;
  rules: UserTypesettingRule[];
  updatedAt?: number;
}

export interface LocalRuleOverrideSet {
  overrides: LocalRuleOverride[];
}

export interface TypesettingRulesConfig {
  professionalDefaults: ProfessionalRuleSet;
  userRules: UserRuleSet;
  projectRules: ProjectRuleSet;
  localOverrides: LocalRuleOverrideSet;
}

export interface RuleResolutionContext {
  layoutType?: BookLayoutType;
  pageNumber?: number;
  pageIndex?: number;
  unitId?: string;
  role?: ContentRole;
  groupId?: string;
  aiPreferenceValue?: number | boolean | string;
}

export interface ResolvedTypesettingRule<T = any> {
  ruleId: TypesettingRuleId;
  category: TypesettingRuleCategory;
  value: T;
  disposition: RuleResolutionDisposition;
  priority: TypesettingRulePriorityLevel;
  sourceLayer: TypesettingRuleSourceLayer;
  authorityLevel: RuleAuthorityLevel;
  isHardConstraint: boolean;
  isEngineHardRule?: boolean;
  engineRuleId?: EngineHardRuleId;
  appliedRuleId?: string;
  description?: string;
}

export interface RuleViolationRecord {
  ruleId: TypesettingRuleId | EngineHardRuleId;
  category: TypesettingRuleCategory | string;
  severity:
    | 'ENGINE_HARD_VIOLATION'
    | 'HARD_VIOLATION'
    | 'PROFESSIONAL_VIOLATION'
    | 'PREFERENCE_VIOLATION';
  sourceLayer: TypesettingRuleSourceLayer;
  disposition: RuleResolutionDisposition;
  message: string;
  pageNumber?: number;
  unitId?: string;
  measuredValue?: number | string;
  requiredValue?: number | string;
  penaltyPoints: number;
}

export interface TypesettingRuleEvaluationContext {
  currentPage: PageTypesetResult;
  previousPage?: PageTypesetResult;
  nextPage?: PageTypesetResult;
  units?: ContentUnit[];
  textRuns?: TextRun[];
  shapedLines?: TypesetLine[];
  links?: RavTextLink[];
  occupiedRegions?: OccupiedRegion[];
  geometry?: PageGeometry;
  rulesConfig?: TypesettingRulesConfig;
  userSuppliedOrnaments?: OrnamentAsset[];
  userOrnamentRules?: OrnamentUserRule[];
  userSuppliedOrnamentsCount?: number;
  unplacedWordsCount?: number;
  expectedSourceWordCount?: number;
  actualSourceWordCount?: number;
  expectedCommentaryWordCount?: number;
  actualCommentaryWordCount?: number;
}

export interface TypesettingRuleEvaluationResult {
  passedAllEngineHardRules: boolean;
  passedAllHardRules: boolean;
  disqualifiedCandidate: boolean;
  candidateValidity: 'VALID' | 'INVALID_ENGINE_HARD_RULE' | 'INVALID_USER_HARD_RULE' | 'INVALID_PROTECTED_PROFESSIONAL_RULE';
  engineHardViolations: EngineHardRuleViolation[];
  hardViolations: RuleViolationRecord[];
  professionalViolations: RuleViolationRecord[];
  preferencesSatisfied: TypesettingRuleId[];
  preferencesViolated: RuleViolationRecord[];
  qualityImpact: {
    hardPenalty: number;
    professionalPenalty: number;
    preferenceBonus: number;
    netScoreDelta: number;
    adjustedTotalScore: number;
  };
}

/**
 * Built-in Professional Typesetting Defaults matching the exact proven behavior
 * of Stages 1–11D.
 */
export const DEFAULT_PROFESSIONAL_RULES: ProfessionalRuleSet = {
  paragraph: {
    preventWidows: true,
    preventOrphans: true,
    minWidowLines: 2,
    minOrphanLines: 2,
    minFinalLineWords: 2,
    minFinalLineWidthRatio: 0.18,
    spacingPt: 0,
    allowContinuationAcrossPages: true,
  },
  headings: {
    keepWithNext: true,
    minFollowingLines: 1,
    preventStrandedAtBottom: true,
    isolateFromBodyLine: true,
    neverJustifyHeading: true,
    lineHeightMultiplier: 1.25,
  },
  semanticContent: {
    sourceCommentaryPriority: KeepPriority.SOURCE_COMMENTARY, // 100
    dibburCommentaryPriority: KeepPriority.DIBBUR_COMMENTARY, // 90
    headingParagraphPriority: KeepPriority.HEADING_PARAGRAPH, // 80
    paragraphPriority: KeepPriority.PARAGRAPH,                // 60
    minBodyWordsAfterDibburOnPage: 2,
    keepVerseWithCommentary: true,
    keepFootnoteWithAnchor: true,
  },
  pageBalance: {
    avoidExcessiveEmptySpace: true,
    minSparseNextPageWords: 12,
    maxCommentaryWidowTailWords: 14,
    avoidUnnecessaryPageBreaks: true,
    avoidOverCompression: true,
    targetUtilizationMinPercent: 78,
    targetUtilizationMaxPercent: 92,
  },
  lineQuality: {
    minReadableSourceWidthPt: SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT, // 135pt
    minReadableCommentaryWidthPt: SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT, // 78pt
    avoidOneWordMidParagraphLines: true,
    avoidExtremelyShortJustifiedLines: true,
    maxJustifyDeficitRatioStandard: 0.35,
    maxJustifyDeficitRatioCommentaryTwoWords: 0.52,
    preserveNaturalRaggedFinalLines: true,
    minLinesForSourceWidthExpansion: 2,
  },
  hebrewRtl: {
    preserveRtlMonotonicOrder: true,
    preserveCombiningMarksZeroAdvance: true,
    preventOrphanedDiacritics: true,
    preservePunctuationBehavior: true,
    respectActualFontMetrics: true,
  },
  footnotes: {
    preserveAnchorRelationship: true,
    samePageWithAnchor: true,
    allowMultiPageContinuation: true,
    justifyMultiLineNonFinal: true,
    preserveRaggedFinalAndSingleLine: true,
    lineHeightPt: 13,
    separatorPaddingPt: 14,
  },
  ravText: {
    preferSamePageSourceCommentary: true,
    dibburKeepTogether: true,
    defaultUpperCollarLines: 4,
    defaultGutterWidthPt: 11,
    preserveStage3Geometry: true,
  },
  ornaments: {
    userSuppliedOnly: true,
    forbidAutoSelectionOfBuiltins: true,
    forbidAutoCreationOnEmptySpace: true,
    minSafetyClearancePt: 3.5,
  },
};

export class TypesettingRulesEngine {
  /**
   * Returns a read-only list of all Level 0 Owner / Engine Hard Rules (`ENGINE_HARD_RULES`).
   * Engine Hard Rules are immutable application laws stored in code, never in localStorage or project JSON.
   */
  public static getEngineHardRules(): ReadonlyArray<EngineHardRuleDefinition> {
    return ENGINE_HARD_RULES;
  }

  /**
   * Returns a deep-cloned copy of the built-in Professional Defaults so callers
   * or project/user mutations can never mutate the canonical defaults.
   */
  public static getProfessionalDefaults(): ProfessionalRuleSet {
    return JSON.parse(JSON.stringify(DEFAULT_PROFESSIONAL_RULES)) as ProfessionalRuleSet;
  }

  /**
   * Returns all built-in Professional Default rules as an explicit list of `UserTypesettingRule` items
   * across all 9 typographic categories.
   */
  public static getProfessionalDefaultRulesList(): UserTypesettingRule[] {
    const allIds: TypesettingRuleId[] = [
      'paragraph.preventWidows',
      'paragraph.preventOrphans',
      'paragraph.minWidowLines',
      'paragraph.minOrphanLines',
      'paragraph.minFinalLineWords',
      'paragraph.minFinalLineWidthRatio',
      'paragraph.spacingPt',
      'paragraph.allowContinuationAcrossPages',
      'headings.keepWithNext',
      'headings.minFollowingLines',
      'headings.preventStrandedAtBottom',
      'headings.isolateFromBodyLine',
      'headings.neverJustifyHeading',
      'headings.lineHeightMultiplier',
      'semantic.sourceCommentaryPriority',
      'semantic.dibburCommentaryPriority',
      'semantic.headingParagraphPriority',
      'semantic.paragraphPriority',
      'semantic.minBodyWordsAfterDibburOnPage',
      'semantic.keepVerseWithCommentary',
      'semantic.keepFootnoteWithAnchor',
      'pageBalance.avoidExcessiveEmptySpace',
      'pageBalance.minSparseNextPageWords',
      'pageBalance.maxCommentaryWidowTailWords',
      'pageBalance.avoidUnnecessaryPageBreaks',
      'pageBalance.avoidOverCompression',
      'pageBalance.targetUtilizationMinPercent',
      'pageBalance.targetUtilizationMaxPercent',
      'lineQuality.minReadableSourceWidthPt',
      'lineQuality.minReadableCommentaryWidthPt',
      'lineQuality.avoidOneWordMidParagraphLines',
      'lineQuality.avoidExtremelyShortJustifiedLines',
      'lineQuality.maxJustifyDeficitRatioStandard',
      'lineQuality.maxJustifyDeficitRatioCommentaryTwoWords',
      'lineQuality.preserveNaturalRaggedFinalLines',
      'lineQuality.minLinesForSourceWidthExpansion',
      'hebrewRtl.preserveRtlMonotonicOrder',
      'hebrewRtl.preserveCombiningMarksZeroAdvance',
      'hebrewRtl.preventOrphanedDiacritics',
      'hebrewRtl.preservePunctuationBehavior',
      'hebrewRtl.respectActualFontMetrics',
      'footnotes.preserveAnchorRelationship',
      'footnotes.samePageWithAnchor',
      'footnotes.allowMultiPageContinuation',
      'footnotes.justifyMultiLineNonFinal',
      'footnotes.preserveRaggedFinalAndSingleLine',
      'footnotes.lineHeightPt',
      'footnotes.separatorPaddingPt',
      'ravText.preferSamePageSourceCommentary',
      'ravText.dibburKeepTogether',
      'ravText.defaultUpperCollarLines',
      'ravText.defaultGutterWidthPt',
      'ravText.preserveStage3Geometry',
      'ornaments.userSuppliedOnly',
      'ornaments.forbidAutoSelectionOfBuiltins',
      'ornaments.forbidAutoCreationOnEmptySpace',
      'ornaments.minSafetyClearancePt',
    ];
    return allIds.map(ruleId => {
      const entry = this.getProfessionalDefaultEntry(ruleId);
      return {
        id: `prof-default-${ruleId}`,
        ruleId,
        category: entry.category,
        enabled: true,
        priority: 'PROFESSIONAL_DEFAULT',
        isHardConstraint: entry.isHardByDefault,
        value: entry.value,
        disposition: entry.disposition,
        source: 'professional_default',
      };
    });
  }

  /**
   * Creates a fresh `TypesettingRulesConfig` combining:
   * - `professionalDefaults` (immutable built-in defaults)
   * - `userRules` (loaded from persistent global user storage unless overridden)
   * - `projectRules` (book/project-specific rules)
   * - `localOverrides` (scoped page/unit/group overrides)
   */
  public static createConfig(partial?: {
    userRules?: UserTypesettingRule[];
    projectRules?: UserTypesettingRule[];
    localOverrides?: LocalRuleOverride[];
    projectId?: string;
    ignoreStoredGlobalUserRules?: boolean;
  }): TypesettingRulesConfig {
    const globalUserRules = partial?.ignoreStoredGlobalUserRules
      ? []
      : this.loadGlobalUserRules().rules;

    return {
      professionalDefaults: this.getProfessionalDefaults(),
      userRules: {
        rules: partial?.userRules
          ? JSON.parse(JSON.stringify(partial.userRules))
          : globalUserRules,
        updatedAt: Date.now(),
      },
      projectRules: {
        projectId: partial?.projectId,
        rules: partial?.projectRules
          ? JSON.parse(JSON.stringify(partial.projectRules))
          : [],
        updatedAt: Date.now(),
      },
      localOverrides: {
        overrides: partial?.localOverrides
          ? JSON.parse(JSON.stringify(partial.localOverrides))
          : [],
      },
    };
  }

  /**
   * Loads persistent global `UserRuleSet` from localStorage (`GLOBAL_USER_RULES_STORAGE_KEY`).
   * Global user rules are stored separately from individual projects.
   */
  public static loadGlobalUserRules(): UserRuleSet {
    try {
      if (typeof localStorage === 'undefined') {
        return { rules: [] };
      }
      const raw = localStorage.getItem(GLOBAL_USER_RULES_STORAGE_KEY);
      if (!raw) return { rules: [] };
      const parsed = JSON.parse(raw) as UserRuleSet;
      if (parsed && Array.isArray(parsed.rules)) {
        return parsed;
      }
      return { rules: [] };
    } catch {
      return { rules: [] };
    }
  }

  /**
   * Saves global `UserRuleSet` to localStorage (`GLOBAL_USER_RULES_STORAGE_KEY`).
   * Does NOT mutate `DEFAULT_PROFESSIONAL_RULES` or any project's `projectRules`.
   */
  public static saveGlobalUserRules(rules: UserTypesettingRule[]): UserRuleSet {
    const payload: UserRuleSet = {
      rules: JSON.parse(JSON.stringify(rules)),
      updatedAt: Date.now(),
    };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(GLOBAL_USER_RULES_STORAGE_KEY, JSON.stringify(payload));
      }
    } catch {
      // Ignore storage quota errors in restricted environments
    }
    return payload;
  }

  /**
   * Clears global user rules from localStorage.
   */
  public static clearGlobalUserRules(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(GLOBAL_USER_RULES_STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
  }

  public static loadGlobalUserRuleSet(): UserRuleSet {
    return this.loadGlobalUserRules();
  }

  public static saveGlobalUserRuleSet(ruleSet: UserRuleSet): UserRuleSet {
    return this.saveGlobalUserRules(ruleSet.rules);
  }

  public static resetGlobalUserRuleSet(): void {
    this.clearGlobalUserRules();
  }

  /**
   * Translates a Hebrew or English natural-language typesetting instruction into
   * structured, typed `UserTypesettingRule[]` objects so natural-language rules are
   * never stored only as free text.
   */
  public static parseNaturalLanguageInstruction(
    instruction: string,
    options?: {
      targetLayer?: 'user' | 'project' | 'local';
      makeHardConstraint?: boolean;
      scope?: RuleScopeFilter;
    }
  ): UserTypesettingRule[] {
    const text = instruction.trim();
    if (!text) return [];
    const lower = text.toLowerCase();
    const isHard =
      options?.makeHardConstraint ??
      (lower.includes('never') ||
        lower.includes('must') ||
        lower.includes('always') ||
        text.includes('לעולם') ||
        text.includes('אל ') ||
        text.includes('חובה') ||
        text.includes('אסור'));
    const sourceLayer: UserTypesettingRule['source'] =
      options?.targetLayer === 'project'
        ? 'project'
        : options?.targetLayer === 'local'
        ? 'local'
        : 'user';

    const results: UserTypesettingRule[] = [];
    const addRule = (
      ruleId: TypesettingRuleId,
      category: TypesettingRuleCategory,
      value: number | boolean | string
    ) => {
      const mappedEngineRule = EngineHardRulesEngine.getMappedEngineHardRule(ruleId);
      let safeValue: number | boolean | string = value;
      if (mappedEngineRule) {
        if (mappedEngineRule.minimumThreshold !== undefined && typeof safeValue === 'number') {
          safeValue = Math.max(mappedEngineRule.minimumThreshold, safeValue);
        } else {
          safeValue = mappedEngineRule.enforcedValue;
        }
      }
      results.push({
        id: `nl-${ruleId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        ruleId,
        category,
        enabled: true,
        priority: isHard ? 'HARD_USER_RULE' : 'PROFESSIONAL_DEFAULT',
        isHardConstraint: isHard,
        value: safeValue,
        disposition: isHard ? (safeValue === false ? 'FORBIDDEN' : 'REQUIRED') : 'PREFERRED',
        scope: options?.scope,
        source: sourceLayer,
        description: `כלל מובנה מהוראת שפה טבעית: ${text}`,
        naturalLanguageOrigin: text,
      });
    };

    // 1. Heading minimum following lines ("Never leave a heading with fewer than 3 lines" / "כותרת עם פחות מ-3 שורות")
    if (
      lower.includes('heading') ||
      lower.includes('chapter') ||
      text.includes('כותרת') ||
      text.includes('פרק') ||
      text.includes('סימן')
    ) {
      const numMatch = text.match(/(\d+)/);
      const minLines = numMatch ? Math.max(1, parseInt(numMatch[1], 10)) : 2;
      addRule('headings.keepWithNext', 'headings', true);
      addRule('headings.minFollowingLines', 'headings', minLines);
      addRule('headings.preventStrandedAtBottom', 'headings', true);
    }

    // 2. Ornaments user-only policy ("Do not add ornaments automatically" / "אל תוסיף עיטורים אוטומטית")
    if (
      lower.includes('ornament') ||
      text.includes('עיטור') ||
      text.includes('קישוט')
    ) {
      addRule('ornaments.userSuppliedOnly', 'ornaments', true);
      addRule('ornaments.forbidAutoSelectionOfBuiltins', 'ornaments', true);
      addRule('ornaments.forbidAutoCreationOnEmptySpace', 'ornaments', true);
    }

    // 3. Widows / Orphans ("Prevent widows/orphans" / "יתומים" / "אלמנות")
    if (
      lower.includes('widow') ||
      lower.includes('orphan') ||
      text.includes('יתומ') ||
      text.includes('אלמנ')
    ) {
      const numMatch = text.match(/(\d+)/);
      const minLines = numMatch ? Math.max(2, parseInt(numMatch[1], 10)) : 2;
      addRule('paragraph.preventWidows', 'paragraph', true);
      addRule('paragraph.preventOrphans', 'paragraph', true);
      addRule('paragraph.minWidowLines', 'paragraph', minLines);
      addRule('paragraph.minOrphanLines', 'paragraph', minLines);
    }

    // 4. Dibbur HaMatchil keep-together ("Dibbur" / "דיבור המתחיל")
    if (lower.includes('dibbur') || text.includes('דיבור המתחיל') || text.includes('ד״ה')) {
      addRule('ravText.dibburKeepTogether', 'rav_text', true);
      const numMatch = text.match(/(\d+)/);
      if (numMatch) {
        addRule('semantic.minBodyWordsAfterDibburOnPage', 'semantic_content', Math.max(1, parseInt(numMatch[1], 10)));
      }
    }

    // 5. Minimum final line words ("one-word tail" / "מילה בודדת בשורה אחרונה")
    if (
      lower.includes('final line') ||
      lower.includes('one-word') ||
      text.includes('מילה אחת') ||
      text.includes('מילה בודדת')
    ) {
      const numMatch = text.match(/(\d+)/);
      const minWords = numMatch ? Math.max(2, parseInt(numMatch[1], 10)) : 2;
      addRule('paragraph.minFinalLineWords', 'paragraph', minWords);
    }

    return results;
  }

  public static evaluateCandidate(
    evalContext: TypesettingRuleEvaluationContext,
    config?: TypesettingRulesConfig
  ): TypesettingRuleEvaluationResult {
    return this.evaluateTypesettingRules({
      ...evalContext,
      rulesConfig: config ?? evalContext.rulesConfig,
    });
  }

  /**
   * Converts a future AI natural-language structured rule specification into a
   * validated `UserTypesettingRule` (never stored only as free text).
   * Enforces Level 0 Engine Hard Rules so natural-language instructions can NEVER
   * weaken or disable an Engine Hard Rule!
   */
  public static createStructuredRuleFromNaturalLanguage(input: {
    ruleId: TypesettingRuleId;
    category: TypesettingRuleCategory;
    value: number | boolean | string;
    priority?: TypesettingRulePriorityLevel;
    isHardConstraint?: boolean;
    disposition?: RuleResolutionDisposition;
    scope?: RuleScopeFilter;
    targetLayer?: 'user' | 'project' | 'local';
    naturalLanguagePrompt: string;
  }): UserTypesettingRule {
    const mappedEngineRule = EngineHardRulesEngine.getMappedEngineHardRule(input.ruleId);
    let safeValue: number | boolean | string = input.value;
    if (mappedEngineRule) {
      if (mappedEngineRule.minimumThreshold !== undefined && typeof safeValue === 'number') {
        safeValue = Math.max(mappedEngineRule.minimumThreshold, safeValue);
      } else {
        safeValue = mappedEngineRule.enforcedValue;
      }
    }

    const isHard =
      input.isHardConstraint ?? input.priority === 'HARD_USER_RULE';
    return {
      id: `nl-rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ruleId: input.ruleId,
      category: input.category,
      enabled: true,
      priority: input.priority ?? (isHard ? 'HARD_USER_RULE' : 'PROFESSIONAL_DEFAULT'),
      isHardConstraint: isHard,
      value: safeValue,
      disposition:
        input.disposition ??
        (isHard
          ? safeValue === false
            ? 'FORBIDDEN'
            : 'REQUIRED'
          : 'PREFERRED'),
      scope: input.scope,
      source: 'ai_natural_language',
      description: `כלל מובנה מהוראת משתמש: ${input.naturalLanguagePrompt}`,
      naturalLanguageOrigin: input.naturalLanguagePrompt,
    };
  }

  /**
   * Checks whether a rule's `scope` filter matches the current `RuleResolutionContext`.
   * - If a rule has no `scope` (global/project-wide), it matches any context.
   * - If a rule is a `LocalRuleOverride` (or specifies scope fields), every specified scope field
   *   must match the context; otherwise the rule does NOT leak to other pages/units/layouts!
   */
  public static doesScopeMatch(
    scope: RuleScopeFilter | undefined,
    context: RuleResolutionContext,
    requireExplicitScopeMatch: boolean = false
  ): boolean {
    if (!scope) {
      return !requireExplicitScopeMatch;
    }

    const hasAnyConstraint =
      scope.layoutType !== undefined ||
      scope.pageNumber !== undefined ||
      scope.pageIndex !== undefined ||
      scope.unitId !== undefined ||
      scope.role !== undefined ||
      scope.groupId !== undefined;

    if (requireExplicitScopeMatch && !hasAnyConstraint) {
      return false;
    }

    if (scope.layoutType !== undefined && scope.layoutType !== context.layoutType) {
      return false;
    }
    if (scope.pageNumber !== undefined && scope.pageNumber !== context.pageNumber) {
      return false;
    }
    if (scope.pageIndex !== undefined && scope.pageIndex !== context.pageIndex) {
      return false;
    }
    if (scope.unitId !== undefined && scope.unitId !== context.unitId) {
      return false;
    }
    if (scope.role !== undefined && scope.role !== context.role) {
      return false;
    }
    if (scope.groupId !== undefined && scope.groupId !== context.groupId) {
      return false;
    }

    return true;
  }

  /**
   * Look up the built-in Professional Default metadata and value for any `TypesettingRuleId`.
   */
  public static getProfessionalDefaultEntry(
    ruleId: TypesettingRuleId,
    defaults: ProfessionalRuleSet = DEFAULT_PROFESSIONAL_RULES
  ): {
    category: TypesettingRuleCategory;
    value: any;
    disposition: RuleResolutionDisposition;
    isHardByDefault: boolean;
  } {
    switch (ruleId) {
      // Paragraph
      case 'paragraph.preventWidows':
        return { category: 'paragraph', value: defaults.paragraph.preventWidows, disposition: 'PREFERRED', isHardByDefault: false };
      case 'paragraph.preventOrphans':
        return { category: 'paragraph', value: defaults.paragraph.preventOrphans, disposition: 'PREFERRED', isHardByDefault: false };
      case 'paragraph.minWidowLines':
        return { category: 'paragraph', value: defaults.paragraph.minWidowLines, disposition: 'PREFERRED', isHardByDefault: false };
      case 'paragraph.minOrphanLines':
        return { category: 'paragraph', value: defaults.paragraph.minOrphanLines, disposition: 'PREFERRED', isHardByDefault: false };
      case 'paragraph.minFinalLineWords':
        return { category: 'paragraph', value: defaults.paragraph.minFinalLineWords, disposition: 'PREFERRED', isHardByDefault: false };
      case 'paragraph.minFinalLineWidthRatio':
        return { category: 'paragraph', value: defaults.paragraph.minFinalLineWidthRatio, disposition: 'PREFERRED', isHardByDefault: false };
      case 'paragraph.spacingPt':
        return { category: 'paragraph', value: defaults.paragraph.spacingPt, disposition: 'PREFERRED', isHardByDefault: false };
      case 'paragraph.allowContinuationAcrossPages':
        return { category: 'paragraph', value: defaults.paragraph.allowContinuationAcrossPages, disposition: 'PREFERRED', isHardByDefault: false };

      // Headings
      case 'headings.keepWithNext':
        return { category: 'headings', value: defaults.headings.keepWithNext, disposition: 'PREFERRED', isHardByDefault: false };
      case 'headings.minFollowingLines':
        return { category: 'headings', value: defaults.headings.minFollowingLines, disposition: 'PREFERRED', isHardByDefault: false };
      case 'headings.preventStrandedAtBottom':
        return { category: 'headings', value: defaults.headings.preventStrandedAtBottom, disposition: 'PREFERRED', isHardByDefault: false };
      case 'headings.isolateFromBodyLine':
        return { category: 'headings', value: defaults.headings.isolateFromBodyLine, disposition: 'REQUIRED', isHardByDefault: true };
      case 'headings.neverJustifyHeading':
        return { category: 'headings', value: defaults.headings.neverJustifyHeading, disposition: 'FORBIDDEN', isHardByDefault: true };
      case 'headings.lineHeightMultiplier':
        return { category: 'headings', value: defaults.headings.lineHeightMultiplier, disposition: 'PREFERRED', isHardByDefault: false };

      // Semantic Content
      case 'semantic.sourceCommentaryPriority':
        return { category: 'semantic_content', value: defaults.semanticContent.sourceCommentaryPriority, disposition: 'PREFERRED', isHardByDefault: false };
      case 'semantic.dibburCommentaryPriority':
        return { category: 'semantic_content', value: defaults.semanticContent.dibburCommentaryPriority, disposition: 'PREFERRED', isHardByDefault: false };
      case 'semantic.headingParagraphPriority':
        return { category: 'semantic_content', value: defaults.semanticContent.headingParagraphPriority, disposition: 'PREFERRED', isHardByDefault: false };
      case 'semantic.paragraphPriority':
        return { category: 'semantic_content', value: defaults.semanticContent.paragraphPriority, disposition: 'PREFERRED', isHardByDefault: false };
      case 'semantic.minBodyWordsAfterDibburOnPage':
        return { category: 'semantic_content', value: defaults.semanticContent.minBodyWordsAfterDibburOnPage, disposition: 'PREFERRED', isHardByDefault: false };
      case 'semantic.keepVerseWithCommentary':
        return { category: 'semantic_content', value: defaults.semanticContent.keepVerseWithCommentary, disposition: 'PREFERRED', isHardByDefault: false };
      case 'semantic.keepFootnoteWithAnchor':
        return { category: 'semantic_content', value: defaults.semanticContent.keepFootnoteWithAnchor, disposition: 'REQUIRED', isHardByDefault: true };

      // Page Balance
      case 'pageBalance.avoidExcessiveEmptySpace':
        return { category: 'page_balance', value: defaults.pageBalance.avoidExcessiveEmptySpace, disposition: 'PREFERRED', isHardByDefault: false };
      case 'pageBalance.minSparseNextPageWords':
        return { category: 'page_balance', value: defaults.pageBalance.minSparseNextPageWords, disposition: 'PREFERRED', isHardByDefault: false };
      case 'pageBalance.maxCommentaryWidowTailWords':
        return { category: 'page_balance', value: defaults.pageBalance.maxCommentaryWidowTailWords, disposition: 'PREFERRED', isHardByDefault: false };
      case 'pageBalance.avoidUnnecessaryPageBreaks':
        return { category: 'page_balance', value: defaults.pageBalance.avoidUnnecessaryPageBreaks, disposition: 'PREFERRED', isHardByDefault: false };
      case 'pageBalance.avoidOverCompression':
        return { category: 'page_balance', value: defaults.pageBalance.avoidOverCompression, disposition: 'PREFERRED', isHardByDefault: false };
      case 'pageBalance.targetUtilizationMinPercent':
        return { category: 'page_balance', value: defaults.pageBalance.targetUtilizationMinPercent, disposition: 'PREFERRED', isHardByDefault: false };
      case 'pageBalance.targetUtilizationMaxPercent':
        return { category: 'page_balance', value: defaults.pageBalance.targetUtilizationMaxPercent, disposition: 'PREFERRED', isHardByDefault: false };

      // Line Quality
      case 'lineQuality.minReadableSourceWidthPt':
        return { category: 'line_quality', value: defaults.lineQuality.minReadableSourceWidthPt, disposition: 'REQUIRED', isHardByDefault: true };
      case 'lineQuality.minReadableCommentaryWidthPt':
        return { category: 'line_quality', value: defaults.lineQuality.minReadableCommentaryWidthPt, disposition: 'REQUIRED', isHardByDefault: true };
      case 'lineQuality.avoidOneWordMidParagraphLines':
        return { category: 'line_quality', value: defaults.lineQuality.avoidOneWordMidParagraphLines, disposition: 'PREFERRED', isHardByDefault: false };
      case 'lineQuality.avoidExtremelyShortJustifiedLines':
        return { category: 'line_quality', value: defaults.lineQuality.avoidExtremelyShortJustifiedLines, disposition: 'PREFERRED', isHardByDefault: false };
      case 'lineQuality.maxJustifyDeficitRatioStandard':
        return { category: 'line_quality', value: defaults.lineQuality.maxJustifyDeficitRatioStandard, disposition: 'PREFERRED', isHardByDefault: false };
      case 'lineQuality.maxJustifyDeficitRatioCommentaryTwoWords':
        return { category: 'line_quality', value: defaults.lineQuality.maxJustifyDeficitRatioCommentaryTwoWords, disposition: 'PREFERRED', isHardByDefault: false };
      case 'lineQuality.preserveNaturalRaggedFinalLines':
        return { category: 'line_quality', value: defaults.lineQuality.preserveNaturalRaggedFinalLines, disposition: 'PREFERRED', isHardByDefault: false };
      case 'lineQuality.minLinesForSourceWidthExpansion':
        return { category: 'line_quality', value: defaults.lineQuality.minLinesForSourceWidthExpansion, disposition: 'PREFERRED', isHardByDefault: false };

      // Hebrew / RTL
      case 'hebrewRtl.preserveRtlMonotonicOrder':
        return { category: 'hebrew_rtl', value: defaults.hebrewRtl.preserveRtlMonotonicOrder, disposition: 'REQUIRED', isHardByDefault: true };
      case 'hebrewRtl.preserveCombiningMarksZeroAdvance':
        return { category: 'hebrew_rtl', value: defaults.hebrewRtl.preserveCombiningMarksZeroAdvance, disposition: 'REQUIRED', isHardByDefault: true };
      case 'hebrewRtl.preventOrphanedDiacritics':
        return { category: 'hebrew_rtl', value: defaults.hebrewRtl.preventOrphanedDiacritics, disposition: 'REQUIRED', isHardByDefault: true };
      case 'hebrewRtl.preservePunctuationBehavior':
        return { category: 'hebrew_rtl', value: defaults.hebrewRtl.preservePunctuationBehavior, disposition: 'PREFERRED', isHardByDefault: false };
      case 'hebrewRtl.respectActualFontMetrics':
        return { category: 'hebrew_rtl', value: defaults.hebrewRtl.respectActualFontMetrics, disposition: 'REQUIRED', isHardByDefault: true };

      // Footnotes
      case 'footnotes.preserveAnchorRelationship':
        return { category: 'footnotes', value: defaults.footnotes.preserveAnchorRelationship, disposition: 'REQUIRED', isHardByDefault: true };
      case 'footnotes.samePageWithAnchor':
        return { category: 'footnotes', value: defaults.footnotes.samePageWithAnchor, disposition: 'PREFERRED', isHardByDefault: false };
      case 'footnotes.allowMultiPageContinuation':
        return { category: 'footnotes', value: defaults.footnotes.allowMultiPageContinuation, disposition: 'PREFERRED', isHardByDefault: false };
      case 'footnotes.justifyMultiLineNonFinal':
        return { category: 'footnotes', value: defaults.footnotes.justifyMultiLineNonFinal, disposition: 'PREFERRED', isHardByDefault: false };
      case 'footnotes.preserveRaggedFinalAndSingleLine':
        return { category: 'footnotes', value: defaults.footnotes.preserveRaggedFinalAndSingleLine, disposition: 'PREFERRED', isHardByDefault: false };
      case 'footnotes.lineHeightPt':
        return { category: 'footnotes', value: defaults.footnotes.lineHeightPt, disposition: 'PREFERRED', isHardByDefault: false };
      case 'footnotes.separatorPaddingPt':
        return { category: 'footnotes', value: defaults.footnotes.separatorPaddingPt, disposition: 'PREFERRED', isHardByDefault: false };

      // Rav Text
      case 'ravText.preferSamePageSourceCommentary':
        return { category: 'rav_text', value: defaults.ravText.preferSamePageSourceCommentary, disposition: 'PREFERRED', isHardByDefault: false };
      case 'ravText.dibburKeepTogether':
        return { category: 'rav_text', value: defaults.ravText.dibburKeepTogether, disposition: 'PREFERRED', isHardByDefault: false };
      case 'ravText.defaultUpperCollarLines':
        return { category: 'rav_text', value: defaults.ravText.defaultUpperCollarLines, disposition: 'PREFERRED', isHardByDefault: false };
      case 'ravText.defaultGutterWidthPt':
        return { category: 'rav_text', value: defaults.ravText.defaultGutterWidthPt, disposition: 'PREFERRED', isHardByDefault: false };
      case 'ravText.preserveStage3Geometry':
        return { category: 'rav_text', value: defaults.ravText.preserveStage3Geometry, disposition: 'REQUIRED', isHardByDefault: true };

      // Ornaments (Stage 11D — Always Hard/Required User-Only Policy)
      case 'ornaments.userSuppliedOnly':
        return { category: 'ornaments', value: defaults.ornaments.userSuppliedOnly, disposition: 'REQUIRED', isHardByDefault: true };
      case 'ornaments.forbidAutoSelectionOfBuiltins':
        return { category: 'ornaments', value: defaults.ornaments.forbidAutoSelectionOfBuiltins, disposition: 'FORBIDDEN', isHardByDefault: true };
      case 'ornaments.forbidAutoCreationOnEmptySpace':
        return { category: 'ornaments', value: defaults.ornaments.forbidAutoCreationOnEmptySpace, disposition: 'FORBIDDEN', isHardByDefault: true };
      case 'ornaments.minSafetyClearancePt':
        return { category: 'ornaments', value: defaults.ornaments.minSafetyClearancePt, disposition: 'REQUIRED', isHardByDefault: true };
    }
  }

  /**
   * Central Rule Resolver (`resolveRule(ruleId, context, config)`).
   *
   * Enforces the strict Stage 12 Hierarchy:
   *   Hard Rules:
   *     LOCAL HARD RULE > PROJECT HARD RULE > USER HARD RULE
   *   Preferences:
   *     LOCAL PREFERENCE > PROJECT PREFERENCE > USER PREFERENCE > PROFESSIONAL DEFAULT > AI PREFERENCE
   *
   * Invariant:
   * - No preference (Local, Project, User, Professional Default, or AI Preference) may EVER override
   *   an active Hard Rule!
   * - Stage 11D Ornament Policy (`ornaments.userSuppliedOnly`, `ornaments.forbidAutoSelectionOfBuiltins`,
   *   `ornaments.forbidAutoCreationOnEmptySpace`) cannot be weakened to auto-create ornaments.
   */
  public static resolveRule<T = any>(
    ruleId: TypesettingRuleId,
    context: RuleResolutionContext = {},
    config?: TypesettingRulesConfig
  ): ResolvedTypesettingRule<T> {
    const activeConfig = config ?? this.createConfig();
    const profEntry = this.getProfessionalDefaultEntry(
      ruleId,
      activeConfig.professionalDefaults
    );

    const mappedEngineRule = EngineHardRulesEngine.getMappedEngineHardRule(ruleId);

    // LEVEL 0 — ENGINE HARD RULE (Absolute boolean/structural Engine Hard Rules cannot be overridden by AI, User, Project, Local Override, or NL input)
    if (mappedEngineRule && mappedEngineRule.minimumThreshold === undefined) {
      return {
        ruleId,
        category: profEntry.category,
        value: mappedEngineRule.enforcedValue as unknown as T,
        disposition: mappedEngineRule.disposition,
        priority: 'ENGINE_HARD_RULE',
        sourceLayer: 'ENGINE_HARD_RULE',
        authorityLevel: 0,
        isHardConstraint: true,
        isEngineHardRule: true,
        engineRuleId: mappedEngineRule.definition.ruleId,
        description: mappedEngineRule.definition.descriptionHe,
      };
    }

    const matchingLocal = (activeConfig.localOverrides?.overrides ?? []).filter(
      o => o.enabled && o.ruleId === ruleId && this.doesScopeMatch(o.scope, context, true)
    );
    const matchingProject = (activeConfig.projectRules?.rules ?? []).filter(
      r => r.enabled && r.ruleId === ruleId && this.doesScopeMatch(r.scope, context, false)
    );
    const matchingUser = (activeConfig.userRules?.rules ?? []).filter(
      r => r.enabled && r.ruleId === ruleId && this.doesScopeMatch(r.scope, context, false)
    );

    const toDisposition = (
      rule: UserTypesettingRule,
      isHard: boolean
    ): RuleResolutionDisposition => {
      if (rule.disposition) return rule.disposition;
      if (!rule.enabled) return 'NOT_APPLICABLE';
      if (isHard) {
        return rule.value === false ? 'FORBIDDEN' : 'REQUIRED';
      }
      return rule.value === false ? 'DISCOURAGED' : 'PREFERRED';
    };

    const isHardRule = (r: UserTypesettingRule) =>
      Boolean(r.isHardConstraint || r.priority === 'HARD_USER_RULE');
    const isAiRule = (r: UserTypesettingRule) =>
      r.priority === 'AI_PREFERENCE';

    // Helper: if this rule has a Level 0 Engine Hard Rule minimum floor (`minimumThreshold`),
    // any attempt (even by a Hard User/Project/Local rule) to set a value below the floor is blocked by Level 0!
    const violatesEngineHardFloor = (candidateVal: any): boolean => {
      if (!mappedEngineRule || mappedEngineRule.minimumThreshold === undefined) return false;
      if (typeof candidateVal !== 'number') return true;
      return candidateVal < mappedEngineRule.minimumThreshold;
    };

    /**
     * Checks whether a proposed value weakens or disables the built-in Professional Default.
     * AI / Layout Preference must NEVER disable (`value === false` when default is `true`),
     * weaken a minimum threshold (`value < profDefault` for min/priority rules),
     * or relax a maximum threshold (`value > profDefault` for max deficit rules).
     */
    const weakensProfessionalDefault = (candidateVal: any): boolean => {
      if (violatesEngineHardFloor(candidateVal)) return true;
      if (profEntry.value === undefined) return false;
      if (typeof profEntry.value === 'boolean') {
        // Disabling an enabled professional default (`true -> false`) or enabling a forbidden one
        if (profEntry.value === true && candidateVal === false) return true;
        if (profEntry.disposition === 'FORBIDDEN' && candidateVal !== profEntry.value) return true;
        if (profEntry.disposition === 'REQUIRED' && candidateVal !== profEntry.value) return true;
      }
      if (typeof profEntry.value === 'number' && typeof candidateVal === 'number') {
        const isUpperBoundRule =
          ruleId === 'lineQuality.maxJustifyDeficitRatioStandard' ||
          ruleId === 'lineQuality.maxJustifyDeficitRatioCommentaryTwoWords';
        if (isUpperBoundRule) {
          return candidateVal > profEntry.value;
        }
        // For minimum thresholds (`minFollowingLines`, `minWidowLines`, `minOrphanLines`, `minFinalLineWords`, `minReadableSourceWidthPt`, etc.),
        // any smaller number weakens the Professional Default!
        return candidateVal < profEntry.value;
      }
      return false;
    };

    // If any Local, Project, User, or AI rule attempts to violate a Level 0 Engine Hard Floor,
    // and no valid stricter rule exists above it, Level 0 Engine Hard Rule immediately blocks the weakening.
    const localHard = matchingLocal.find(r => isHardRule(r) && !violatesEngineHardFloor(r.value));
    if (localHard) {
      return {
        ruleId,
        category: profEntry.category,
        value: localHard.value as unknown as T,
        disposition: toDisposition(localHard, true),
        priority: 'HARD_USER_RULE',
        sourceLayer: 'LOCAL_OVERRIDE',
        authorityLevel: 1,
        isHardConstraint: true,
        appliedRuleId: localHard.id,
        description: localHard.description,
      };
    }

    // 2. PROJECT HARD RULE (Absolute constraint subject to Level 0 Engine Hard Rules)
    const projectHard = matchingProject.find(r => isHardRule(r) && !violatesEngineHardFloor(r.value));
    if (projectHard) {
      return {
        ruleId,
        category: profEntry.category,
        value: projectHard.value as unknown as T,
        disposition: toDisposition(projectHard, true),
        priority: 'HARD_USER_RULE',
        sourceLayer: 'PROJECT_RULE',
        authorityLevel: 1,
        isHardConstraint: true,
        appliedRuleId: projectHard.id,
        description: projectHard.description,
      };
    }

    // 3. USER HARD RULE (Absolute constraint subject to Level 0 Engine Hard Rules)
    const userHard = matchingUser.find(r => isHardRule(r) && !violatesEngineHardFloor(r.value));
    if (userHard) {
      return {
        ruleId,
        category: profEntry.category,
        value: userHard.value as unknown as T,
        disposition: toDisposition(userHard, true),
        priority: 'HARD_USER_RULE',
        sourceLayer: 'USER_RULE',
        authorityLevel: 1,
        isHardConstraint: true,
        appliedRuleId: userHard.id,
        description: userHard.description,
      };
    }

    // If a Level 0 floor rule was targeted by a weakening rule (or by default), return Level 0 authority
    if (mappedEngineRule && mappedEngineRule.minimumThreshold !== undefined) {
      return {
        ruleId,
        category: profEntry.category,
        value: mappedEngineRule.enforcedValue as unknown as T,
        disposition: mappedEngineRule.disposition,
        priority: 'ENGINE_HARD_RULE',
        sourceLayer: 'ENGINE_HARD_RULE',
        authorityLevel: 0,
        isHardConstraint: true,
        isEngineHardRule: true,
        engineRuleId: mappedEngineRule.definition.ruleId,
        description: mappedEngineRule.definition.descriptionHe,
      };
    }

    // 4. LOCAL PREFERENCE (non-AI, only if it does not weaken a Professional Default)
    const localPref = matchingLocal.find(
      r => !isHardRule(r) && !isAiRule(r) && !weakensProfessionalDefault(r.value)
    );
    if (localPref) {
      return {
        ruleId,
        category: profEntry.category,
        value: localPref.value as unknown as T,
        disposition: toDisposition(localPref, false),
        priority: 'PROFESSIONAL_DEFAULT',
        sourceLayer: 'LOCAL_OVERRIDE',
        authorityLevel: 4,
        isHardConstraint: false,
        appliedRuleId: localPref.id,
        description: localPref.description,
      };
    }

    // 5. PROJECT PREFERENCE (non-AI, only if it does not weaken a Professional Default)
    const projectPref = matchingProject.find(
      r => !isHardRule(r) && !isAiRule(r) && !weakensProfessionalDefault(r.value)
    );
    if (projectPref) {
      return {
        ruleId,
        category: profEntry.category,
        value: projectPref.value as unknown as T,
        disposition: toDisposition(projectPref, false),
        priority: 'PROFESSIONAL_DEFAULT',
        sourceLayer: 'PROJECT_RULE',
        authorityLevel: 3,
        isHardConstraint: false,
        appliedRuleId: projectPref.id,
        description: projectPref.description,
      };
    }

    // 6. USER PREFERENCE (non-AI, only if it does not weaken a Professional Default)
    const userPref = matchingUser.find(
      r => !isHardRule(r) && !isAiRule(r) && !weakensProfessionalDefault(r.value)
    );
    if (userPref) {
      return {
        ruleId,
        category: profEntry.category,
        value: userPref.value as unknown as T,
        disposition: toDisposition(userPref, false),
        priority: 'PROFESSIONAL_DEFAULT',
        sourceLayer: 'USER_RULE',
        authorityLevel: 2,
        isHardConstraint: false,
        appliedRuleId: userPref.id,
        description: userPref.description,
      };
    }

    // 7. PROFESSIONAL DEFAULT (Always precedes and blocks any weakening/overriding AI_PREFERENCE)
    if (profEntry.value !== undefined) {
      return {
        ruleId,
        category: profEntry.category,
        value: profEntry.value as T,
        disposition: profEntry.disposition,
        priority: 'PROFESSIONAL_DEFAULT',
        sourceLayer: 'PROFESSIONAL_DEFAULT',
        authorityLevel: 2,
        isHardConstraint: profEntry.isHardByDefault,
      };
    }

    // 8. AI / LAYOUT PREFERENCE (Tie-breaker & candidate-selection only; never overrides Professional Default)
    const aiRule =
      matchingLocal.find(isAiRule) ??
      matchingProject.find(isAiRule) ??
      matchingUser.find(isAiRule);
    if (aiRule) {
      return {
        ruleId,
        category: profEntry.category,
        value: aiRule.value as unknown as T,
        disposition: 'PREFERRED',
        priority: 'AI_PREFERENCE',
        sourceLayer: 'AI_PREFERENCE',
        authorityLevel: 5,
        isHardConstraint: false,
        appliedRuleId: aiRule.id,
        description: aiRule.description,
      };
    }

    if (context.aiPreferenceValue !== undefined) {
      return {
        ruleId,
        category: profEntry.category,
        value: context.aiPreferenceValue as T,
        disposition: 'PREFERRED',
        priority: 'AI_PREFERENCE',
        sourceLayer: 'AI_PREFERENCE',
        authorityLevel: 5,
        isHardConstraint: false,
      };
    }

    return {
      ruleId,
      category: profEntry.category,
      value: profEntry.value as T,
      disposition: 'NOT_APPLICABLE',
      priority: 'PROFESSIONAL_DEFAULT',
      sourceLayer: 'PROFESSIONAL_DEFAULT',
      authorityLevel: 2,
      isHardConstraint: false,
    };
  }

  /**
   * Checks whether a specific ContentUnit has a Local Override forcing a page break before it.
   */
  public static shouldForcePageBreakBeforeUnit(
    unitId: string | undefined,
    context: RuleResolutionContext,
    config?: TypesettingRulesConfig
  ): boolean {
    if (!unitId || !config?.localOverrides?.overrides) return false;
    return config.localOverrides.overrides.some(
      o =>
        o.enabled &&
        o.forcePageBreakBeforeUnitId === unitId &&
        this.doesScopeMatch(o.scope, { ...context, unitId }, true)
    );
  }

  /**
   * v0.8.0 Part C (§3): the set of unit ids that must not split across a
   * page break, collected from every enabled local override's
   * `keepTogetherUnitIds` (written by the Shas one-click widow/orphan fix
   * in vilna-shas.ts). Before this helper existed the field had zero
   * readers, so the fix reported success while doing nothing. The
   * paginators consult this set when choosing page breaks (hold the whole
   * unit to the next page when it would straddle the break).
   */
  public static keepTogetherUnitIds(config?: TypesettingRulesConfig): Set<string> {
    const ids = new Set<string>();
    for (const o of config?.localOverrides?.overrides ?? []) {
      if (!o.enabled) continue;
      for (const id of o.keepTogetherUnitIds ?? []) ids.add(id);
    }
    return ids;
  }

  /**
   * v0.8.0 Part C (§6): the set of unit ids a forced page break must
   * precede, from every enabled local override's
   * `forcePageBreakBeforeUnitId` (written by Insert Page). The paginators
   * consult this set so a break is honoured in every layout, not only in
   * `paginateSingleColumn`.
   */
  public static forcePageBreakUnitIds(config?: TypesettingRulesConfig): Set<string> {
    const ids = new Set<string>();
    for (const o of config?.localOverrides?.overrides ?? []) {
      if (!o.enabled) continue;
      if (o.forcePageBreakBeforeUnitId) ids.add(o.forcePageBreakBeforeUnitId);
    }
    return ids;
  }

  /**
   * Evaluates all active typesetting rules (`evaluateTypesettingRules(context)`) against
   * a solved or candidate `PageTypesetResult` using actual shaped glyph geometry, bounding boxes,
   * line widths, and semantic links — NEVER arbitrary word-count heuristics.
   *
   * Also runs the authoritative Level 0 `EngineHardRulesEngine.evaluateContext()` machine checks!
   */
  public static evaluateTypesettingRules(
    evalContext: TypesettingRuleEvaluationContext
  ): TypesettingRuleEvaluationResult {
    const {
      currentPage,
      nextPage,
      units = [],
      links = [],
      rulesConfig,
      userSuppliedOrnaments = [],
      userOrnamentRules = [],
      userSuppliedOrnamentsCount = 0,
      unplacedWordsCount,
      expectedSourceWordCount,
      actualSourceWordCount,
      expectedCommentaryWordCount,
      actualCommentaryWordCount,
    } = evalContext;

    const config = rulesConfig ?? this.createConfig();
    const baseCtx: RuleResolutionContext = {
      layoutType: currentPage.layoutType,
      pageNumber: currentPage.pageNumber,
      pageIndex: currentPage.pageIndex,
    };

    // LEVEL 0: Evaluate all Owner / Engine Hard Rules first
    const engineHardReport = EngineHardRulesEngine.evaluateContext({
      currentPage,
      nextPage,
      units,
      links,
      occupiedRegions: evalContext.occupiedRegions ?? currentPage.occupiedRegions,
      geometry: evalContext.geometry ?? currentPage.geometry,
      userSuppliedOrnaments,
      userOrnamentRules,
      userSuppliedOrnamentsCount,
      unplacedWordsCount,
      expectedSourceWordCount,
      actualSourceWordCount,
      expectedCommentaryWordCount,
      actualCommentaryWordCount,
    });

    const engineHardViolations: EngineHardRuleViolation[] = [...engineHardReport.violations];
    const hardViolations: RuleViolationRecord[] = engineHardViolations.map(ev => ({
      ruleId: ev.ruleId,
      category: ev.category,
      severity: 'ENGINE_HARD_VIOLATION',
      sourceLayer: 'ENGINE_HARD_RULE',
      disposition: 'FORBIDDEN',
      message: ev.message,
      pageNumber: ev.pageNumber,
      unitId: ev.unitId,
      measuredValue: ev.measuredValue,
      requiredValue: ev.requiredValue,
      penaltyPoints: 100,
    }));
    const professionalViolations: RuleViolationRecord[] = [];
    const preferencesSatisfied: TypesettingRuleId[] = [];
    const preferencesViolated: RuleViolationRecord[] = [];

    const recordViolation = (
      resolved: ResolvedTypesettingRule,
      message: string,
      penaltyPoints: number,
      extra?: { unitId?: string; measuredValue?: number | string; requiredValue?: number | string }
    ) => {
      const severity: RuleViolationRecord['severity'] = resolved.isEngineHardRule
        ? 'ENGINE_HARD_VIOLATION'
        : resolved.isHardConstraint
        ? 'HARD_VIOLATION'
        : resolved.sourceLayer === 'PROFESSIONAL_DEFAULT'
        ? 'PROFESSIONAL_VIOLATION'
        : 'PREFERENCE_VIOLATION';

      const rec: RuleViolationRecord = {
        ruleId: resolved.ruleId,
        category: resolved.category,
        severity,
        sourceLayer: resolved.sourceLayer,
        disposition: resolved.disposition,
        message,
        pageNumber: currentPage.pageNumber,
        unitId: extra?.unitId,
        measuredValue: extra?.measuredValue,
        requiredValue: extra?.requiredValue,
        penaltyPoints,
      };

      if (severity === 'ENGINE_HARD_VIOLATION' || severity === 'HARD_VIOLATION') {
        hardViolations.push(rec);
      } else if (severity === 'PROFESSIONAL_VIOLATION') {
        professionalViolations.push(rec);
      } else {
        preferencesViolated.push(rec);
      }
    };

    const markSatisfied = (ruleId: TypesettingRuleId) => {
      if (!preferencesSatisfied.includes(ruleId)) {
        preferencesSatisfied.push(ruleId);
      }
    };

    const allBodyLines = [
      ...currentPage.sourceLines,
      ...(currentPage.column2Lines ?? []),
      ...currentPage.rashiLines,
      ...currentPage.tosafotLines,
    ];

    // 1. HEBREW / RTL & COMBINING MARKS EVALUATION (Actual Glyph Advances & Monotonic Coordinates)
    const rtlRule = this.resolveRule<boolean>('hebrewRtl.preserveRtlMonotonicOrder', baseCtx, config);
    const markZeroRule = this.resolveRule<boolean>('hebrewRtl.preserveCombiningMarksZeroAdvance', baseCtx, config);
    let rtlViolationFound = false;
    let markAdvanceViolationFound = false;

    for (const line of [...allBodyLines, ...currentPage.footnoteLines]) {
      const realWords = line.words.filter(w => !w.isSpace && w.text.trim().length > 0);
      for (const w of realWords) {
        for (const g of w.glyphs ?? []) {
          if (g.isMark && Math.abs(g.xAdvance) > 0.001) {
            markAdvanceViolationFound = true;
          }
        }
      }
      if (line.xLeft !== undefined && line.xRight !== undefined && line.xRight < line.xLeft - 0.1) {
        rtlViolationFound = true;
      }
    }

    if (rtlViolationFound) {
      recordViolation(rtlRule, 'הפרת כיווניות RTL בגבולות שורה.', 50);
    } else {
      markSatisfied('hebrewRtl.preserveRtlMonotonicOrder');
    }

    if (markAdvanceViolationFound) {
      recordViolation(markZeroRule, 'סימן ניקוד/טעמים קיבל רוחב מתקדם שאינו אפס (xAdvance != 0).', 50);
    } else {
      markSatisfied('hebrewRtl.preserveCombiningMarksZeroAdvance');
    }

    // 2. LINE QUALITY — Minimum Readable Line Widths (Actual physical points, never word count)
    const minSrcWidthRule = this.resolveRule<number>('lineQuality.minReadableSourceWidthPt', baseCtx, config);
    const minComWidthRule = this.resolveRule<number>('lineQuality.minReadableCommentaryWidthPt', baseCtx, config);

    let narrowSourceFound = false;
    for (const sLine of currentPage.sourceLines) {
      if (sLine.targetWidth > 0 && sLine.targetWidth + 0.5 < minSrcWidthRule.value) {
        narrowSourceFound = true;
        recordViolation(
          minSrcWidthRule,
          `רוחב שורת מקור (${sLine.targetWidth.toFixed(1)}pt) קטן מהמינימום הקריא (${minSrcWidthRule.value}pt).`,
          35,
          { unitId: sLine.unitId, measuredValue: sLine.targetWidth, requiredValue: minSrcWidthRule.value }
        );
        break;
      }
    }
    if (!narrowSourceFound) markSatisfied('lineQuality.minReadableSourceWidthPt');

    let narrowCommentFound = false;
    for (const cLine of [...currentPage.rashiLines, ...currentPage.tosafotLines]) {
      if (cLine.targetWidth > 0 && cLine.targetWidth + 0.5 < minComWidthRule.value) {
        narrowCommentFound = true;
        recordViolation(
          minComWidthRule,
          `רוחב שורת פירוש (${cLine.targetWidth.toFixed(1)}pt) קטן מהמינימום הקריא (${minComWidthRule.value}pt).`,
          30,
          { unitId: cLine.unitId, measuredValue: cLine.targetWidth, requiredValue: minComWidthRule.value }
        );
        break;
      }
    }
    if (!narrowCommentFound) markSatisfied('lineQuality.minReadableCommentaryWidthPt');

    // 3. HEADINGS — Isolation from body text, Non-justification, Keep-With-Next (minimum following lines)
    const isolateHeadingRule = this.resolveRule<boolean>('headings.isolateFromBodyLine', baseCtx, config);
    const neverJustifyHeadingRule = this.resolveRule<boolean>('headings.neverJustifyHeading', baseCtx, config);

    let headingMerged = false;
    let headingJustified = false;
    for (const sLine of [...currentPage.sourceLines, ...(currentPage.column2Lines ?? [])]) {
      const realWords = sLine.words.filter(w => !w.isSpace && w.text.trim().length > 0);
      const hasHeadingWord = realWords.some(
        w => w.role === 'chapter' || w.role === 'heading' || w.role === 'main_title' || w.role === 'siman'
      );
      const hasBodyWord = realWords.some(
        w => w.role !== 'chapter' && w.role !== 'heading' && w.role !== 'main_title' && w.role !== 'siman'
      );
      if (hasHeadingWord && hasBodyWord && isolateHeadingRule.value) {
        headingMerged = true;
        recordViolation(
          isolateHeadingRule,
          'כותרת/פרק אוחדה לאותה שורה עם טקסט גוף המקור.',
          40,
          { unitId: sLine.unitId }
        );
      }
      const isHeadingRole =
        sLine.role === 'chapter' ||
        sLine.role === 'heading' ||
        sLine.role === 'main_title' ||
        sLine.role === 'siman';
      if (isHeadingRole && sLine.isJustified && neverJustifyHeadingRule.value) {
        headingJustified = true;
        recordViolation(
          neverJustifyHeadingRule,
          'שורת כותרת יושרה לשני הצדדים (Justified) במקום יישור כותרת ממורכז.',
          25,
          { unitId: sLine.unitId }
        );
      }
    }
    if (!headingMerged) markSatisfied('headings.isolateFromBodyLine');
    if (!headingJustified) markSatisfied('headings.neverJustifyHeading');

    // Check Heading Keep-With-Next & Minimum Following Lines on every column stream
    const checkStreamHeadingKeepWithNext = (streamLines: TypesetLine[]) => {
      for (let i = 0; i < streamLines.length; i++) {
        const ln = streamLines[i];
        const isHeading =
          ln.role === 'chapter' ||
          ln.role === 'heading' ||
          ln.role === 'main_title' ||
          ln.role === 'siman';
        if (!isHeading) continue;

        // Only check at the last line of this heading unit
        if (i + 1 < streamLines.length && streamLines[i + 1].unitId === ln.unitId) {
          continue;
        }

        const unitCtx: RuleResolutionContext = { ...baseCtx, unitId: ln.unitId, role: ln.role };
        const keepWithNextRule = this.resolveRule<boolean>('headings.keepWithNext', unitCtx, config);
        const minFollowingRule = this.resolveRule<number>('headings.minFollowingLines', unitCtx, config);

        if (!keepWithNextRule.value) continue;

        let followingBodyLinesInColumn = 0;
        for (let j = i + 1; j < streamLines.length; j++) {
          const nextLn = streamLines[j];
          const nextIsHeading =
            nextLn.role === 'chapter' ||
            nextLn.role === 'heading' ||
            nextLn.role === 'main_title' ||
            nextLn.role === 'siman';
          if (nextIsHeading) break;
          followingBodyLinesInColumn++;
        }

        const requiredFollowing = Math.max(1, Number(minFollowingRule.value) || 1);
        if (followingBodyLinesInColumn < requiredFollowing) {
          const effectiveRule =
            minFollowingRule.isHardConstraint || minFollowingRule.sourceLayer !== 'PROFESSIONAL_DEFAULT'
              ? minFollowingRule
              : keepWithNextRule;
          recordViolation(
            effectiveRule,
            `כותרת בתחתית העמוד/הטור עם ${followingBodyLinesInColumn} שורות המשך בלבד (נדרשות לפחות ${requiredFollowing} שורות).`,
            effectiveRule.isHardConstraint ? 60 : 18,
            {
              unitId: ln.unitId,
              measuredValue: followingBodyLinesInColumn,
              requiredValue: requiredFollowing,
            }
          );
        } else {
          markSatisfied('headings.keepWithNext');
          markSatisfied('headings.minFollowingLines');
        }
      }
    };

    checkStreamHeadingKeepWithNext(currentPage.sourceLines);
    if (currentPage.column2Lines && currentPage.column2Lines.length > 0) {
      checkStreamHeadingKeepWithNext(currentPage.column2Lines);
    }

    // 4. PARAGRAPH — Widow & Orphan Prevention across columns and pages (Measured by actual rendered lines)
    const preventOrphansRule = this.resolveRule<boolean>('paragraph.preventOrphans', baseCtx, config);
    const minOrphanLinesRule = this.resolveRule<number>('paragraph.minOrphanLines', baseCtx, config);
    const preventWidowsRule = this.resolveRule<boolean>('paragraph.preventWidows', baseCtx, config);
    const minWidowLinesRule = this.resolveRule<number>('paragraph.minWidowLines', baseCtx, config);

    const checkTransitionOrphanWidow = (
      prevStream: TypesetLine[],
      nextStream: TypesetLine[] | undefined
    ) => {
      if (!nextStream || prevStream.length === 0 || nextStream.length === 0) return;
      const lastPrev = prevStream[prevStream.length - 1];
      const firstNext = nextStream[0];
      if (!lastPrev.unitId || lastPrev.unitId !== firstNext.unitId) return;

      // Count how many lines of `lastPrev.unitId` are at the bottom of `prevStream`
      let tailCountOnPrev = 0;
      for (let i = prevStream.length - 1; i >= 0; i--) {
        if (prevStream[i].unitId === lastPrev.unitId) tailCountOnPrev++;
        else break;
      }

      // Count how many lines of `firstNext.unitId` are at the top of `nextStream`
      let headCountOnNext = 0;
      for (let i = 0; i < nextStream.length; i++) {
        if (nextStream[i].unitId === firstNext.unitId) headCountOnNext++;
        else break;
      }

      const unitCtx: RuleResolutionContext = {
        ...baseCtx,
        unitId: lastPrev.unitId,
        role: lastPrev.role,
      };
      const effOrphan = this.resolveRule<boolean>('paragraph.preventOrphans', unitCtx, config);
      const effMinOrphan = this.resolveRule<number>('paragraph.minOrphanLines', unitCtx, config);
      const effWidow = this.resolveRule<boolean>('paragraph.preventWidows', unitCtx, config);
      const effMinWidow = this.resolveRule<number>('paragraph.minWidowLines', unitCtx, config);

      if (effOrphan.value && tailCountOnPrev < effMinOrphan.value) {
        recordViolation(
          effMinOrphan.isHardConstraint ? effMinOrphan : effOrphan,
          `יתום בתחתית עמוד/טור: ${tailCountOnPrev} שורות בלבד מפסקה שהמשכה בעמוד/טור הבא (נדרשות לפחות ${effMinOrphan.value}).`,
          effMinOrphan.isHardConstraint || effOrphan.isHardConstraint ? 50 : 14,
          { unitId: lastPrev.unitId, measuredValue: tailCountOnPrev, requiredValue: effMinOrphan.value }
        );
      } else {
        markSatisfied('paragraph.preventOrphans');
      }

      if (effWidow.value && headCountOnNext < effMinWidow.value) {
        recordViolation(
          effMinWidow.isHardConstraint ? effMinWidow : effWidow,
          `אלמנה בראש עמוד/טור הבא: ${headCountOnNext} שורות בלבד בסיום פסקה (נדרשות לפחות ${effMinWidow.value}).`,
          effMinWidow.isHardConstraint || effWidow.isHardConstraint ? 50 : 14,
          { unitId: firstNext.unitId, measuredValue: headCountOnNext, requiredValue: effMinWidow.value }
        );
      } else {
        markSatisfied('paragraph.preventWidows');
      }
    };

    // Check Column 1 -> Column 2 transition on two-column pages
    if (currentPage.layoutType === 'two_column' && currentPage.column2Lines) {
      checkTransitionOrphanWidow(currentPage.sourceLines, currentPage.column2Lines);
    }
    // Check Current Page -> Next Page transition
    if (nextPage) {
      checkTransitionOrphanWidow(currentPage.sourceLines, nextPage.sourceLines);
      checkTransitionOrphanWidow(currentPage.rashiLines, nextPage.rashiLines);
      checkTransitionOrphanWidow(currentPage.tosafotLines, nextPage.tosafotLines);
    } else {
      if (preventOrphansRule.value) markSatisfied('paragraph.preventOrphans');
      if (preventWidowsRule.value) markSatisfied('paragraph.preventWidows');
      void minOrphanLinesRule;
      void minWidowLinesRule;
    }

    // 5. SEMANTIC CONTENT — Source/Commentary same-page alignment & Dibbur HaMatchil relationship
    const srcComRule = this.resolveRule<boolean>('ravText.preferSamePageSourceCommentary', baseCtx, config);
    const dibburRule = this.resolveRule<boolean>('ravText.dibburKeepTogether', baseCtx, config);
    const minBodyAfterDibburRule = this.resolveRule<number>(
      'semantic.minBodyWordsAfterDibburOnPage',
      baseCtx,
      config
    );

    if (links.length > 0) {
      const pageUnitIds = new Set<string>(allBodyLines.map(l => l.unitId));
      for (const ln of allBodyLines) {
        for (const w of ln.words) {
          if (w.unitId) pageUnitIds.add(w.unitId);
        }
      }
      const brokenLinks = links.filter(
        lnk =>
          pageUnitIds.has(lnk.sourceUnitId) &&
          !pageUnitIds.has(lnk.commentaryUnitId) &&
          !(currentPage.splitLinkIdsToNextPage ?? []).includes(lnk.linkId)
      );
      if (brokenLinks.length > 0 && srcComRule.value) {
        recordViolation(
          srcComRule,
          `פירוש מקושר (${brokenLinks[0].dibburHamatchil}) הופרד ממקורו ללא המשך חוקי.`,
          srcComRule.isHardConstraint ? 55 : 15,
          { unitId: brokenLinks[0].commentaryUnitId }
        );
      } else {
        markSatisfied('ravText.preferSamePageSourceCommentary');
      }
    } else {
      markSatisfied('ravText.preferSamePageSourceCommentary');
    }

    // Check Dibbur HaMatchil at the end of Rashi/Tosafot streams when continuing to nextPage
    if (nextPage && dibburRule.value) {
      for (const [stream, nextStream] of [
        [currentPage.rashiLines, nextPage.rashiLines],
        [currentPage.tosafotLines, nextPage.tosafotLines],
      ] as const) {
        if (stream.length === 0 || nextStream.length === 0) continue;
        const lastLn = stream[stream.length - 1];
        const firstNextLn = nextStream[0];
        if (lastLn.unitId && lastLn.unitId === firstNextLn.unitId) {
          const placedWordsOfUnit = stream
            .filter(l => l.unitId === lastLn.unitId)
            .flatMap(l => l.words)
            .filter(w => !w.isSpace && w.text.trim().length > 0);
          const hasDibbur = placedWordsOfUnit.some(w => w.isDibbur);
          const bodyWordsCount = placedWordsOfUnit.filter(w => !w.isDibbur).length;
          if (hasDibbur && bodyWordsCount < minBodyAfterDibburRule.value) {
            recordViolation(
              dibburRule.isHardConstraint ? dibburRule : minBodyAfterDibburRule,
              `דיבור המתחיל בתחתית העמוד עם ${bodyWordsCount} מילות גוף פירוש בלבד לפני מעבר עמוד.`,
              dibburRule.isHardConstraint ? 50 : 16,
              {
                unitId: lastLn.unitId,
                measuredValue: bodyWordsCount,
                requiredValue: minBodyAfterDibburRule.value,
              }
            );
          }
        }
      }
    }
    markSatisfied('ravText.dibburKeepTogether');

    // 6. FOOTNOTES — Anchor relationship & Multi-line justification
    const fnAnchorRule = this.resolveRule<boolean>('footnotes.preserveAnchorRelationship', baseCtx, config);
    const fnJustifyRule = this.resolveRule<boolean>('footnotes.justifyMultiLineNonFinal', baseCtx, config);

    const bodyAnchoredFnIds = new Set<string>();
    for (const ln of allBodyLines) {
      for (const w of ln.words) {
        if (w.footnoteUnitId) bodyAnchoredFnIds.add(w.footnoteUnitId);
      }
    }
    const pageFnUnitIds = new Set<string>(currentPage.footnoteLines.map(fl => fl.unitId));
    let missingAnchorFn = false;
    for (const reqFnId of bodyAnchoredFnIds) {
      if (
        !pageFnUnitIds.has(reqFnId) &&
        !(currentPage.continuedUnitIdsToNextPage ?? []).includes(reqFnId)
      ) {
        missingAnchorFn = true;
        recordViolation(
          fnAnchorRule,
          `הערת שוליים המעוגנת למילה בעמוד זה (${reqFnId}) אינה מופיעה בתחתית העמוד.`,
          45,
          { unitId: reqFnId }
        );
      }
    }
    if (!missingAnchorFn) markSatisfied('footnotes.preserveAnchorRelationship');

    let fnJustifyViolation = false;
    for (const fl of currentPage.footnoteLines) {
      if (!fl.isLastLine && !fl.isJustified && fnJustifyRule.value) {
        fnJustifyViolation = true;
        recordViolation(
          fnJustifyRule,
          'שורה פנימית בהערת שוליים מרובת שורות אינה מיושרת לשני הצדדים (Justified).',
          10,
          { unitId: fl.unitId }
        );
      }
    }
    if (!fnJustifyViolation) markSatisfied('footnotes.justifyMultiLineNonFinal');

    // 7. ORNAMENTS — Stage 11D User-Only Ornament Policy
    const ornUserOnlyRule = this.resolveRule<boolean>('ornaments.userSuppliedOnly', baseCtx, config);
    const ornClearanceRule = this.resolveRule<number>('ornaments.minSafetyClearancePt', baseCtx, config);
    const placedOrns = currentPage.placedOrnaments ?? [];
    const unitExplicitOrnCount = units.filter(u => Boolean(u.ornamentId)).length;
    const totalExplicitAllowed =
      userSuppliedOrnamentsCount +
      userSuppliedOrnaments.length +
      userOrnamentRules.length +
      unitExplicitOrnCount;

    if (placedOrns.length > 0 && totalExplicitAllowed === 0) {
      recordViolation(
        ornUserOnlyRule,
        `הפרת מדיניות עיטורים (Stage 11D): שובצו ${placedOrns.length} עיטורים אוטומטיים ללא בחירת משתמש מפורשת.`,
        100,
        { measuredValue: placedOrns.length, requiredValue: 0 }
      );
    } else {
      markSatisfied('ornaments.userSuppliedOnly');
      markSatisfied('ornaments.forbidAutoSelectionOfBuiltins');
      markSatisfied('ornaments.forbidAutoCreationOnEmptySpace');
    }

    // Check ornament geometric collision clearance if any user-supplied ornaments are placed
    if (placedOrns.length > 0) {
      const mInside = currentPage.geometry.marginInside;
      const nonOrnRegions = (currentPage.occupiedRegions ?? []).filter(r => r.role !== 'ornament');
      for (const orn of placedOrns) {
        const cXLeft = orn.x - mInside;
        const cXRight = cXLeft + orn.width;
        const cYTop = orn.y;
        const cYBottom = orn.y + orn.height;
        for (const reg of nonOrnRegions) {
          const hOverlap = Math.min(reg.xRight, cXRight) - Math.max(reg.xLeft, cXLeft);
          const vOverlap = Math.min(reg.yBottom, cYBottom) - Math.max(reg.yTop, cYTop);
          if (hOverlap > 0.1 && vOverlap > 0.1) {
            recordViolation(
              ornClearanceRule,
              'התנגשות גאומטרית בין עיטור שסופק ע״י המשתמש לבין אזור טקסט או הערת שוליים.',
              60,
              { unitId: orn.unitId }
            );
          }
        }
      }
    }

    // Compute Quality Score Impact (Integrating with physical LayoutQualityScore without replacing it)
    const hardPenalty = hardViolations.reduce((s, v) => s + v.penaltyPoints, 0);
    const professionalPenalty = professionalViolations.reduce((s, v) => s + v.penaltyPoints, 0);
    const prefViolationPenalty = preferencesViolated.reduce((s, v) => s + v.penaltyPoints, 0);
    const preferenceBonus = Math.min(6, preferencesSatisfied.length * 0.5);

    const basePhysicalScore = currentPage.layoutScore?.totalScore ?? 92;
    const netScoreDelta =
      engineHardViolations.length > 0
        ? -100
        : hardViolations.length > 0
        ? -Math.max(45, hardPenalty)
        : -(professionalPenalty + prefViolationPenalty);
    const adjustedTotalScore =
      engineHardViolations.length > 0
        ? 0
        : Math.max(
            0,
            Math.min(100, Math.round(basePhysicalScore + netScoreDelta))
          );

    const candidateValidity: TypesettingRuleEvaluationResult['candidateValidity'] =
      engineHardViolations.length > 0
        ? 'INVALID_ENGINE_HARD_RULE'
        : hardViolations.length > 0
        ? 'INVALID_USER_HARD_RULE'
        : professionalViolations.length > 0
        ? 'INVALID_PROTECTED_PROFESSIONAL_RULE'
        : 'VALID';

    return {
      passedAllEngineHardRules: engineHardViolations.length === 0,
      passedAllHardRules: engineHardViolations.length === 0 && hardViolations.length === 0,
      disqualifiedCandidate: engineHardViolations.length > 0 || hardViolations.length > 0,
      candidateValidity,
      engineHardViolations,
      hardViolations,
      professionalViolations,
      preferencesSatisfied,
      preferencesViolated,
      qualityImpact: {
        hardPenalty,
        professionalPenalty: professionalPenalty + prefViolationPenalty,
        preferenceBonus,
        netScoreDelta,
        adjustedTotalScore,
      },
    };
  }

  /**
   * Selects the best layout candidate according to the strict Stage 12 hierarchy:
   *   LEVEL 0 — Engine Hard Rules (Absolute developer-controlled laws; 0 engineHardViolations required)
   *   LEVEL 1 — Hard User / Project / Local Rule (= absolute user constraint; zero hardViolations wins)
   *   LEVEL 2 — Professional Default (= professional typesetting requirement; zero/fewer professionalViolations
   *             always beats a candidate that violates a Professional Default, regardless of AI score/utilization)
   *   LEVEL 5 — AI / Layout Preference (= tie-breaker and candidate-selection preference ONLY among candidates
   *             that satisfy Engine Hard Rules, User Hard Rules, and Professional Defaults)
   *
   * If EVERY candidate violates a Level 0 Engine Hard Rule:
   *   1. Attempts safe non-destructive automatic correction (`EngineHardRulesEngine.attemptSafeAutoCorrection`).
   *   2. If correction is impossible, returns `blockingError` (never silently accepts a corrupted candidate or drops text).
   */
  public static selectBestLayoutCandidate<T extends { currentPage: PageTypesetResult; aiTieBreakerScore?: number }>(
    candidates: T[],
    sharedContext: Omit<TypesettingRuleEvaluationContext, 'currentPage'> = {},
    config?: TypesettingRulesConfig
  ): {
    selectedCandidate: T;
    selectedIndex: number;
    evaluation: TypesettingRuleEvaluationResult;
    allEvaluations: TypesettingRuleEvaluationResult[];
    autoCorrectionApplied?: boolean;
    autoCorrectionActions?: string[];
    blockingError?: {
      code: 'ENGINE_HARD_RULE_BLOCKING_FAILURE';
      message: string;
      violations: EngineHardRuleViolation[];
      allSourceTextPreserved: boolean;
    };
  } {
    if (candidates.length === 0) {
      throw new Error('selectBestLayoutCandidate requires at least one candidate.');
    }

    const activeConfig = config ?? sharedContext.rulesConfig ?? this.createConfig();
    let workingCandidates = [...candidates];
    let allEvaluations = workingCandidates.map(cand =>
      this.evaluateTypesettingRules({
        ...sharedContext,
        currentPage: cand.currentPage,
        rulesConfig: activeConfig,
      })
    );

    let autoCorrectionApplied = false;
    const autoCorrectionActions: string[] = [];

    // Check if EVERY candidate violates a Level 0 Engine Hard Rule
    const allViolateEngineHardRules = allEvaluations.every(
      ev => !ev.passedAllEngineHardRules
    );

    if (allViolateEngineHardRules) {
      // Step 1: Attempt safe automatic correction on candidates (e.g. stripping illegal unrequested ornaments)
      workingCandidates = workingCandidates.map(cand => {
        const corr = EngineHardRulesEngine.attemptSafeAutoCorrection(cand.currentPage, {
          ...sharedContext,
          currentPage: cand.currentPage,
        });
        if (corr.applied) {
          autoCorrectionApplied = true;
          for (const act of corr.actions) {
            if (!autoCorrectionActions.includes(act)) autoCorrectionActions.push(act);
          }
          return { ...cand, currentPage: corr.correctedPage };
        }
        return cand;
      });

      if (autoCorrectionApplied) {
        allEvaluations = workingCandidates.map(cand =>
          this.evaluateTypesettingRules({
            ...sharedContext,
            currentPage: cand.currentPage,
            rulesConfig: activeConfig,
          })
        );
      }
    }

    let bestIdx = 0;
    for (let i = 1; i < workingCandidates.length; i++) {
      const currEval = allEvaluations[i];
      const bestEval = allEvaluations[bestIdx];

      // Tier 0: Level 0 Engine Hard Rules (Absolute developer law; AI score NEVER compensates)
      if (currEval.engineHardViolations.length !== bestEval.engineHardViolations.length) {
        if (currEval.engineHardViolations.length < bestEval.engineHardViolations.length) {
          bestIdx = i;
        }
        continue;
      }

      // Tier 1: Hard User / Project / Local Rules (Absolute constraint)
      if (currEval.hardViolations.length !== bestEval.hardViolations.length) {
        if (currEval.hardViolations.length < bestEval.hardViolations.length) {
          bestIdx = i;
        }
        continue;
      }

      // Tier 2: Professional Defaults (Must NEVER be overridden by AI / Layout Preference or page utilization)
      const currProfCount = currEval.professionalViolations.length + currEval.preferencesViolated.length;
      const bestProfCount = bestEval.professionalViolations.length + bestEval.preferencesViolated.length;
      if (currProfCount !== bestProfCount) {
        if (currProfCount < bestProfCount) {
          bestIdx = i;
        }
        continue;
      }

      if (currEval.qualityImpact.professionalPenalty !== bestEval.qualityImpact.professionalPenalty) {
        if (currEval.qualityImpact.professionalPenalty < bestEval.qualityImpact.professionalPenalty) {
          bestIdx = i;
        }
        continue;
      }

      // Tier 3: Both candidates satisfy Engine Hard Rules, User Hard Rules, and Professional Defaults equally ->
      // AI / Layout Preference may now act as tie-breaker and choose HOW to satisfy them!
      const currAiScore =
        workingCandidates[i].aiTieBreakerScore ??
        workingCandidates[i].currentPage.layoutScore?.totalScore ??
        currEval.qualityImpact.adjustedTotalScore;
      const bestAiScore =
        workingCandidates[bestIdx].aiTieBreakerScore ??
        workingCandidates[bestIdx].currentPage.layoutScore?.totalScore ??
        bestEval.qualityImpact.adjustedTotalScore;

      if (currAiScore > bestAiScore) {
        bestIdx = i;
      }
    }

    const winningEval = allEvaluations[bestIdx];
    const stillViolatesEngineHardRules = !winningEval.passedAllEngineHardRules;

    return {
      selectedCandidate: workingCandidates[bestIdx],
      selectedIndex: bestIdx,
      evaluation: winningEval,
      allEvaluations,
      autoCorrectionApplied,
      autoCorrectionActions,
      blockingError: stillViolatesEngineHardRules
        ? {
            code: 'ENGINE_HARD_RULE_BLOCKING_FAILURE',
            message: `כל המועמדים הפרו חוקי מנוע קשיחים (LEVEL 0) ולא ניתן היה לתקנם אוטומטית: ${winningEval.engineHardViolations
              .map(v => v.message)
              .join(' | ')}`,
            violations: winningEval.engineHardViolations,
            allSourceTextPreserved: true,
          }
        : undefined,
    };
  }
}
