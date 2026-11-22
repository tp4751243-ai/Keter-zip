/**
 * STAGE 13 — PROFESSIONAL DESIGN & TYPESETTING CONTROL ENGINE
 *
 * Single authoritative engine (`DesignSettingsEngine`) that manages `ProfessionalDesignSettings`:
 * 1. Holds immutable Global Styles (`GLOBAL_ROLE_STYLES`) for all semantic roles (`main_title`,
 *    `subtitle`, `chapter`, `siman`, `heading`, `subheading`, `main_source`, `verse`,
 *    `regular_paragraph`, `bold_special`, `primary_comment`, `secondary_comment`,
 *    `tertiary_comment`, `dibbur_hamatchil`, `footnote`, `side_note`, `introduction`,
 *    `continuation`, `page_element`, etc.).
 * 2. Resolves effective formatting across the 3-tier hierarchy:
 *      GLOBAL_STYLE -> PROJECT_STYLE -> LOCAL_OVERRIDE
 *    and detects `"Mixed"` values across multi-unit or multi-word selections without destroying
 *    local overrides unless explicitly requested.
 * 3. Enforces Stage 12 Level 0 Universal Engine Hard Rules on every user or AI design modification:
 *    - Clamps unreadable font sizes (< 6pt or > 72pt)
 *    - Clamps horizontal character scale to [90%..110%] (no glyph distortion)
 *    - Clamps margins and column widths so content area never drops below Level 0 minimum
 *      readable widths (`135pt` Source, `78pt` Commentary)
 *    - Preserves RTL logical/visual integrity and combining mark zero-advance invariants
 *    - Never invents or enables automatic ornaments (Stage 11D / Level 0 Law #12)
 *    - Never alters authoritative source/commentary/footnote text (Level 0 Law #1 & #2)
 * 4. Translates natural-language AI commands (Hebrew & English) into structured updates on the
 *    exact same `ProfessionalDesignSettings` model used by the UI panel.
 */

import {
  BookLayoutType,
  ContentRole,
  ContentUnit,
  KneeCustomSettings,
  PageGeometry,
} from '../types/typesetter';
import {
  TypesettingRuleCategory,
  TypesettingRuleId,
  TypesettingRulesConfig,
  TypesettingRulesEngine,
  UserTypesettingRule,
} from './typesetting-rules-engine';
import {
  CharacterStyleSettings,
  ColumnDesignSettings,
  DesignAlignment,
  DesignScopeLevel,
  DesignSelectionTarget,
  EffectiveResolvedFormatting,
  FootnoteDesignSettings,
  LocalFormattingOverride,
  OpenTypeFeaturesConfig,
  PageElementsDesignSettings,
  PageLayoutDesignSettings,
  ParagraphStyleSettings,
  ProfessionalDesignSettings,
  RavTextDesignSettings,
  RoleDesignStyle,
  SemanticStyleRole,
} from '../types/design-settings';
import { KNOWN_HOLY_BOOK_FONTS } from './font-analyzer';
import { SpatialExclusionEngine } from './spatial-exclusion';

const DEFAULT_OPENTYPE_FEATURES: OpenTypeFeaturesConfig = Object.freeze({
  ligatures: true,
  contextualAlternates: true,
  markPositioning: true,
  markToMark: true,
  kerning: true,
  hebrewTypographyMode: 'rabbinic_classic',
});

function createRoleStyle(
  role: SemanticStyleRole,
  displayNameHe: string,
  displayNameEn: string,
  charOverrides: Partial<CharacterStyleSettings>,
  paraOverrides: Partial<ParagraphStyleSettings>
): RoleDesignStyle {
  const fontSizePt = charOverrides.fontSizePt ?? 13.5;
  const lineSpacingRatio = paraOverrides.lineSpacingRatio ?? 1.28;
  const leadingPt =
    paraOverrides.leadingPt ?? Number((fontSizePt * lineSpacingRatio).toFixed(2));

  return Object.freeze({
    role,
    displayNameHe,
    displayNameEn,
    character: Object.freeze({
      fontFamily: 'Frank Ruhl Libre',
      fontSizePt,
      fontWeight: 400,
      fontStyle: 'normal',
      isBold: false,
      isItalic: false,
      isUnderline: false,
      textColor: '#121214',
      trackingEm: 0,
      wordSpacingRatio: 1.0,
      horizontalScalePercent: 100,
      baselineShiftPt: 0,
      scriptPosition: 'normal',
      openTypeFeatures: { ...DEFAULT_OPENTYPE_FEATURES },
      ...charOverrides,
    }),
    paragraph: Object.freeze({
      alignment: 'justify',
      lastLineAlignment: 'right',
      direction: 'rtl',
      leadingMode: 'auto',
      leadingPt,
      lineSpacingRatio,
      spaceBeforePt: 0,
      spaceAfterPt: 2,
      firstLineIndentPt: 0,
      rightIndentPt: 0,
      leftIndentPt: 0,
      hangingIndentPt: 0,
      tabStopsPt: [],
      justifyNonFinalLines: true,
      hyphenation: 'hebrew_maqaf',
      keepWithNext: false,
      keepWithNextLines: paraOverrides.keepWithNext ? (paraOverrides.minFollowingLines ?? 2) : 0,
      keepLinesTogether: false,
      minFollowingLines: 1,
      minOrphanLines: 2,
      minWidowLines: 2,
      minFinalLineWords: 2,
      startOnNewPage: false,
      preventWidows: true,
      preventOrphans: true,
      ...paraOverrides,
    }),
  });
}

/**
 * Authoritative Global Styles (`GLOBAL_STYLE`) for all semantic roles in Keter Typesetter.
 * Frozen in memory so project or local edits never mutate canonical application defaults.
 */
export const GLOBAL_ROLE_STYLES: Readonly<Record<SemanticStyleRole, RoleDesignStyle>> = Object.freeze({
  book: createRoleStyle(
    'book',
    'ספר / מסמך ראשי',
    'Book Root',
    { fontSizePt: 14.5, fontWeight: 400 },
    { alignment: 'justify', lineSpacingRatio: 1.32 }
  ),
  main_title: createRoleStyle(
    'main_title',
    'כותרת ראשית / שער',
    'Main Title',
    { fontSizePt: 20.0, fontWeight: 700, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.25,
      spaceBeforePt: 8,
      spaceAfterPt: 6,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  subtitle: createRoleStyle(
    'subtitle',
    'כותרת משנה',
    'Subtitle',
    { fontSizePt: 15.0, fontWeight: 600, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.25,
      spaceBeforePt: 4,
      spaceAfterPt: 4,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  introduction: createRoleStyle(
    'introduction',
    'הקדמה / מבוא',
    'Introduction',
    { fontSizePt: 13.0, fontWeight: 400 },
    { alignment: 'justify', lineSpacingRatio: 1.3, firstLineIndentPt: 12, spaceAfterPt: 3 }
  ),
  chapter: createRoleStyle(
    'chapter',
    'פרק / כותרת פרק',
    'Chapter Heading',
    { fontSizePt: 16.0, fontWeight: 700, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.3,
      spaceBeforePt: 6,
      spaceAfterPt: 4,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  siman: createRoleStyle(
    'siman',
    'סימן (שולחן ערוך / הלכה)',
    'Siman Heading',
    { fontSizePt: 15.0, fontWeight: 700, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.28,
      spaceBeforePt: 5,
      spaceAfterPt: 3,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  seif: createRoleStyle(
    'seif',
    'סעיף הלכתי',
    'Seif',
    { fontSizePt: 13.0, fontWeight: 600, isBold: true },
    { alignment: 'justify', lineSpacingRatio: 1.26, keepWithNext: true }
  ),
  heading: createRoleStyle(
    'heading',
    'כותרת',
    'Heading',
    { fontSizePt: 16.0, fontWeight: 700, isBold: true, textColor: '#451A03' },
    {
      alignment: 'center',
      lastLineAlignment: 'center',
      lineSpacingRatio: 1.3,
      spaceBeforePt: 6,
      spaceAfterPt: 4,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  subheading: createRoleStyle(
    'subheading',
    'כותרת משנית',
    'Subheading',
    { fontSizePt: 14.0, fontWeight: 600, isBold: true },
    {
      alignment: 'right',
      lastLineAlignment: 'right',
      lineSpacingRatio: 1.25,
      spaceBeforePt: 4,
      spaceAfterPt: 2,
      justifyNonFinalLines: false,
      keepWithNext: true,
      minFollowingLines: 2,
    }
  ),
  main_source: createRoleStyle(
    'main_source',
    'מקור ראשי (גמרא / משנה / פנים)',
    'Main Source',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.5, fontWeight: 600 },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 2 }
  ),
  verse: createRoleStyle(
    'verse',
    'פסוק (מקראות גדולות / תנ״ך)',
    'Biblical Verse',
    {
      fontFamily: 'Taamey Frank CLM',
      fontSizePt: 16.0,
      fontWeight: 600,
      openTypeFeatures: {
        ...DEFAULT_OPENTYPE_FEATURES,
        hebrewTypographyMode: 'biblical_taamim',
      },
    },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.35, spaceAfterPt: 3 }
  ),
  regular_paragraph: createRoleStyle(
    'regular_paragraph',
    'גוף טקסט / פסקה רגילה',
    'Body Paragraph',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 13.5, fontWeight: 400 },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 2 }
  ),
  bold_special: createRoleStyle(
    'bold_special',
    'טקסט מודגש / מיוחד',
    'Special Bold Text',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 13.5, fontWeight: 700, isBold: true },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.3 }
  ),
  primary_comment: createRoleStyle(
    'primary_comment',
    'פירוש ראשי (רש״י / משנה ברורה)',
    'Primary Commentary (Rashi)',
    { fontFamily: 'Noto Rashi Hebrew', fontSizePt: 10.5, fontWeight: 400, textColor: '#222120' },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 1.5 }
  ),
  secondary_comment: createRoleStyle(
    'secondary_comment',
    'פירוש משני (תוספות / ש״ך / ביאור הלכה)',
    'Secondary Commentary (Tosafot)',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 400, textColor: '#222120' },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 1.5 }
  ),
  tertiary_comment: createRoleStyle(
    'tertiary_comment',
    'פירוש שלישי (עין משפט / מסורת הש״ס)',
    'Tertiary Commentary',
    { fontFamily: 'David Libre', fontSizePt: 9.0, fontWeight: 400, textColor: '#2C2A29' },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.24, spaceAfterPt: 1 }
  ),
  dibbur_hamatchil: createRoleStyle(
    'dibbur_hamatchil',
    'דיבור המתחיל (ד״ה)',
    'Dibbur HaMatchil',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 700, isBold: true },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, keepWithNext: true }
  ),
  footnote: createRoleStyle(
    'footnote',
    'הערות שוליים',
    'Footnote',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 9.5, fontWeight: 400, textColor: '#3A3836' },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.36, leadingPt: 13.0, spaceAfterPt: 1.5 }
  ),
  side_note: createRoleStyle(
    'side_note',
    'הערת צד / גליון הש״ס',
    'Side Note',
    { fontFamily: 'David Libre', fontSizePt: 8.5, fontWeight: 400 },
    { alignment: 'right', lastLineAlignment: 'right', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  cross_reference: createRoleStyle(
    'cross_reference',
    'מראה מקום / הפניה',
    'Cross Reference',
    { fontFamily: 'David Libre', fontSizePt: 8.5, fontWeight: 600, isBold: true },
    { alignment: 'right', lastLineAlignment: 'right', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  ornament: createRoleStyle(
    'ornament',
    'עיטור / מסגרת (משתמש בלבד)',
    'User Ornament',
    { fontSizePt: 12.0, fontWeight: 400 },
    { alignment: 'center', lastLineAlignment: 'center', justifyNonFinalLines: false }
  ),
  continuation: createRoleStyle(
    'continuation',
    'שורת המשך (המשך מעמוד קודם / לעמוד הבא)',
    'Continuation Marker',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 8.5, fontWeight: 600, textColor: '#5C5346' },
    { alignment: 'left', lastLineAlignment: 'left', lineSpacingRatio: 1.15, justifyNonFinalLines: false }
  ),
  page_element: createRoleStyle(
    'page_element',
    'כותרת רצה ומספור דפים',
    'Running Header & Folio',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 600, textColor: '#2C2A29' },
    { alignment: 'center', lastLineAlignment: 'center', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  table: createRoleStyle(
    'table',
    'טבלה',
    'Table',
    { fontSizePt: 11.0, fontWeight: 400 },
    { alignment: 'right', lineSpacingRatio: 1.25 }
  ),
  image: createRoleStyle(
    'image',
    'תמונה / שרטוט',
    'Image',
    { fontSizePt: 10.0, fontWeight: 400 },
    { alignment: 'center', lineSpacingRatio: 1.2 }
  ),
  chart: createRoleStyle(
    'chart',
    'תרשים',
    'Chart',
    { fontSizePt: 10.0, fontWeight: 400 },
    { alignment: 'center', lineSpacingRatio: 1.2 }
  ),
  caption: createRoleStyle(
    'caption',
    'כיתוב תמונה / טבלה',
    'Caption',
    { fontSizePt: 9.5, fontWeight: 500, isItalic: true, fontStyle: 'italic' },
    { alignment: 'center', lineSpacingRatio: 1.25 }
  ),
  list_item: createRoleStyle(
    'list_item',
    'פריט רשימה',
    'List Item',
    { fontSizePt: 13.0, fontWeight: 400 },
    { alignment: 'justify', rightIndentPt: 14, hangingIndentPt: 10, lineSpacingRatio: 1.28 }
  ),
  header_running: createRoleStyle(
    'header_running',
    'כותרת רצה בראש עמוד',
    'Running Header',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 600, textColor: '#2C2A29' },
    { alignment: 'center', lastLineAlignment: 'center', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  folio_number: createRoleStyle(
    'folio_number',
    'מספר דף / עמוד',
    'Folio Number',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 10.5, fontWeight: 700, isBold: true, textColor: '#2C2A29' },
    { alignment: 'right', lastLineAlignment: 'right', lineSpacingRatio: 1.2, justifyNonFinalLines: false }
  ),
  halakha: createRoleStyle(
    'halakha',
    'הלכה פסוקה',
    'Halakha',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 14.0, fontWeight: 600 },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 2 }
  ),
  quote: createRoleStyle(
    'quote',
    'ציטוט / מובאה',
    'Quote',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 12.5, fontWeight: 400 },
    { alignment: 'justify', lastLineAlignment: 'right', rightIndentPt: 12, leftIndentPt: 12, lineSpacingRatio: 1.28 }
  ),
  body: createRoleStyle(
    'body',
    'גוף טקסט ראשי',
    'Body Text',
    { fontFamily: 'Frank Ruhl Libre', fontSizePt: 13.5, fontWeight: 400 },
    { alignment: 'justify', lastLineAlignment: 'right', lineSpacingRatio: 1.32, spaceAfterPt: 2 }
  ),
});

export interface DesignUpdateSafetyReport {
  clampedByEngineHardRule: boolean;
  warnings: string[];
  settings: ProfessionalDesignSettings;
}

export interface AiDesignCommandResult {
  handled: boolean;
  matched: boolean;
  summaryHe: string;
  summaryEn: string;
  updatedSettings: ProfessionalDesignSettings;
  clampedByEngineHardRule: boolean;
  warnings: string[];
  requiresPreviewConfirmation: boolean;
}

export class DesignSettingsEngine {
  /**
   * Rebuilds the derived `roleStyles`, `layout`, `localUnitOverrides`, and `localWordOverrides`
   * views on a `ProfessionalDesignSettings` instance so direct readers (`settings.roleStyles.main_source...`)
   * and method callers (`resolveStyle` / `resolveRoleAndUnitStyle`) always see the exact same data.
   */
  public static syncDerivedViews(
    settings: ProfessionalDesignSettings
  ): ProfessionalDesignSettings {
    settings.revision = settings.version;
    settings.pageLayout.layoutType = settings.layoutType;
    settings.pageLayout.geometry = {
      pageWidth: settings.pageLayout.pageWidthPt,
      pageHeight: settings.pageLayout.pageHeightPt,
      marginTop: settings.pageLayout.marginTopPt,
      marginBottom: settings.pageLayout.marginBottomPt,
      marginInside: settings.pageLayout.marginInsidePt,
      marginOutside: settings.pageLayout.marginOutsidePt,
      isVerso: false,
    };
    settings.layout = settings.pageLayout;

    if (!settings.columns) {
      settings.columns = {
        columnCount: settings.pageLayout.columnCount,
        columnGapPt: settings.pageLayout.columnGutterPt,
        minColumnWidthPt: 78,
        balanceColumns: true,
      };
    } else {
      settings.columns.columnCount = settings.pageLayout.columnCount;
      settings.columns.columnGapPt = settings.pageLayout.columnGutterPt;
    }

    if (!settings.pageElements) {
      settings.pageElements = {
        showRunningHeader: settings.pageLayout.showRunningHeader,
        showFolioNumber: true,
        showDecorativeFrame: true,
        runningHeaderFontSizePt: settings.pageLayout.runningHeaderFontSizePt,
        folioNumberPosition: settings.pageLayout.pageNumberPosition,
      };
    }

    // Sync RavText aliases
    settings.ravText.dibburBold = settings.ravText.dibburHamatchilBold;
    if (settings.ravText.dibburScalePercent === undefined) {
      settings.ravText.dibburScalePercent = 100;
    }
    if (settings.ravText.minSourceWidthPt === undefined) {
      settings.ravText.minSourceWidthPt = 135;
    }
    if (settings.ravText.minCommentaryWidthPt === undefined) {
      settings.ravText.minCommentaryWidthPt = 78;
    }
    settings.ravText.kneeSettings = {
      mode: settings.ravText.kneeMode,
      upperKneeLines: settings.ravText.upperCollarLines,
      upperKneeInwardStep: settings.ravText.upperCollarInwardStepPt,
      junctionPercent: settings.ravText.kneeJunctionPercent,
      lowerWidthPercent: settings.ravText.lowerSourceWidthPercent,
      stepDirection: settings.ravText.kneeStepDirection,
      gutterWidth: settings.ravText.gutterWidthPt,
    };

    // Sync Footnote aliases
    settings.footnotes.leadingPt = settings.footnotes.lineSpacingPt;
    settings.footnotes.showSeparatorLine = settings.footnotes.showSeparatorRule;
    settings.footnotes.justifyMultiLineNonFinal = settings.footnotes.justifyMultiLineFootnotes;

    // Rebuild roleStyles for every SemanticStyleRole
    const allRoleStyles = {} as Record<SemanticStyleRole, RoleDesignStyle>;
    for (const roleKey of Object.keys(GLOBAL_ROLE_STYLES) as SemanticStyleRole[]) {
      const globalStyle = GLOBAL_ROLE_STYLES[roleKey];
      const resolved = this.resolveRoleAndUnitStyle(settings, roleKey as ContentRole);
      allRoleStyles[roleKey] = {
        role: roleKey,
        displayNameHe: globalStyle.displayNameHe,
        displayNameEn: globalStyle.displayNameEn,
        character: resolved.character,
        paragraph: resolved.paragraph,
      };
    }
    settings.roleStyles = allRoleStyles;
    settings.globalRoleStyles = allRoleStyles;

    // Rebuild localUnitOverrides & localWordOverrides maps from localOverrides array
    const unitMap: Record<
      string,
      {
        character?: Partial<CharacterStyleSettings>;
        paragraph?: Partial<ParagraphStyleSettings>;
      }
    > = {};
    const wordMap: Record<string, Partial<CharacterStyleSettings>> = {};
    for (const loc of settings.localOverrides || []) {
      if (loc.wordRange) {
        for (
          let wIdx = loc.wordRange.startWordIndex;
          wIdx <= loc.wordRange.endWordIndex;
          wIdx++
        ) {
          const key = `${loc.unitId}:${wIdx}`;
          wordMap[key] = {
            ...(wordMap[key] ?? {}),
            ...(loc.characterOverrides ?? {}),
          };
        }
      } else {
        unitMap[loc.unitId] = {
          character: {
            ...(unitMap[loc.unitId]?.character ?? {}),
            ...(loc.characterOverrides ?? {}),
          },
          paragraph: {
            ...(unitMap[loc.unitId]?.paragraph ?? {}),
            ...(loc.paragraphOverrides ?? {}),
          },
        };
      }
    }
    settings.localUnitOverrides = unitMap;
    settings.localWordOverrides = wordMap;

    return settings;
  }

  /**
   * Creates a clean, canonical `ProfessionalDesignSettings` instance synchronized with
   * initial layout/geometry/font parameters.
   */
  public static createDefaultSettings(options?: {
    projectId?: string;
    layoutType?: BookLayoutType;
    geometry?: PageGeometry;
    kneeSettings?: KneeCustomSettings;
    sourceFontFamily?: string;
    rashiFontFamily?: string;
    tosafotFontFamily?: string;
    sourceFontSizePt?: number;
    commentaryFontSizePt?: number;
  }): ProfessionalDesignSettings {
    const layoutType = options?.layoutType ?? 'rav_text';
    const geo = options?.geometry ?? {
      pageWidth: 482.0,
      pageHeight: 680.0,
      marginTop: 48.0,
      marginBottom: 48.0,
      marginInside: 46.0,
      marginOutside: 42.0,
      isVerso: false,
    };
    const knee = options?.kneeSettings ?? {
      mode: 'auto',
      upperKneeLines: 4,
      junctionPercent: 50,
      lowerWidthPercent: 72,
      stepDirection: 'auto',
      gutterWidth: 12,
    };

    const sourceFontFamily = options?.sourceFontFamily ?? 'Frank Ruhl Libre';
    const rashiFontFamily = options?.rashiFontFamily ?? 'Noto Rashi Hebrew';
    const tosafotFontFamily = options?.tosafotFontFamily ?? 'Frank Ruhl Libre';
    const sourceFontSizePt =
      options?.sourceFontSizePt ?? (layoutType === 'mikraot_gedolot' ? 16.0 : 14.5);
    const commentaryFontSizePt = options?.commentaryFontSizePt ?? 10.5;

    const pageLayout: PageLayoutDesignSettings = {
      layoutType,
      geometry: { ...geo },
      pageSizePreset: 'royal_holy_book',
      orientation: geo.pageWidth > geo.pageHeight ? 'landscape' : 'portrait',
      pageWidthPt: geo.pageWidth,
      pageHeightPt: geo.pageHeight,
      marginTopPt: geo.marginTop,
      marginBottomPt: geo.marginBottom,
      marginInsidePt: geo.marginInside,
      marginOutsidePt: geo.marginOutside,
      columnCount: layoutType === 'two_column' ? 2 : 1,
      columnGutterPt: layoutType === 'two_column' ? 16.0 : 14.0,
      headerBandHeightPt: 24.0,
      footerBandHeightPt: 22.0,
      pageNumberPosition: 'top_outside',
      showRunningHeader: true,
      showRunningFooter: true,
      runningHeaderFontSizePt: 10.5,
    };

    const base: ProfessionalDesignSettings = {
      projectId: options?.projectId ?? 'default-project',
      version: 1,
      revision: 1,
      updatedAt: Date.now(),
      lastModifiedBy: 'system',
      layoutType,
      pageLayout,
      layout: pageLayout,
      columns: {
        columnCount: layoutType === 'two_column' ? 2 : 1,
        columnGapPt: layoutType === 'two_column' ? 16.0 : 14.0,
        minColumnWidthPt: 78,
        balanceColumns: true,
      },
      pageElements: {
        showRunningHeader: true,
        showFolioNumber: true,
        showDecorativeFrame: true,
        runningHeaderFontSizePt: 10.5,
        folioNumberPosition: 'top_outside',
      },
      ravText: {
        sourceFontFamily,
        rashiFontFamily,
        tosafotFontFamily,
        sourceFontSizePt,
        rashiFontSizePt: commentaryFontSizePt,
        tosafotFontSizePt: commentaryFontSizePt,
        sourceLineSpacingRatio: 1.32,
        commentaryLineSpacingRatio: 1.32,
        commentaryToSourceScaleRatio: Number((commentaryFontSizePt / sourceFontSizePt).toFixed(2)),
        gutterWidthPt: knee.gutterWidth ?? 11,
        upperCollarLines: knee.upperKneeLines ?? 4,
        upperCollarInwardStepPt: knee.upperKneeInwardStep ?? 18,
        kneeJunctionPercent: knee.junctionPercent ?? 50,
        lowerSourceWidthPercent: knee.lowerWidthPercent ?? 78,
        kneeStepDirection: knee.stepDirection ?? 'auto',
        kneeMode: knee.mode ?? 'auto',
        kneeSettings: { ...knee },
        minSourceWidthPt: 135,
        minCommentaryWidthPt: 78,
        rashiWidthRatio: 0.5,
        tosafotWidthRatio: 0.5,
        sourceExpansionBehavior: 'dynamic_contour',
        dibburHamatchilBold: true,
        dibburBold: true,
        dibburHamatchilFontSizeDeltaPt: 0,
        dibburScalePercent: 100,
        preferSamePageSourceCommentary: true,
        continuationMarkerStyle: 'traditional_hebrew',
      },
      footnotes: {
        fontFamily: sourceFontFamily,
        fontSizePt: 9.5,
        lineSpacingPt: 13.0,
        leadingPt: 13.0,
        paragraphSpacingPt: 1.5,
        showSeparatorRule: true,
        showSeparatorLine: true,
        separatorWidthRatio: 0.25,
        separatorSpacingAbovePt: 6.0,
        separatorSpacingBelowPt: 4.0,
        indentPt: 0,
        placement: 'bottom_of_page',
        justifyMultiLineFootnotes: true,
        justifyMultiLineNonFinal: true,
        allowMultiPageContinuation: true,
      },
      roleStyles: {} as Record<SemanticStyleRole, RoleDesignStyle>,
      projectRoleStyles: {},
      localOverrides: [],
      localUnitOverrides: {},
      localWordOverrides: {},
    };

    return this.syncDerivedViews(base);
  }

  /**
   * Deep-clones a `ProfessionalDesignSettings` object.
   */
  public static cloneSettings(settings: ProfessionalDesignSettings): ProfessionalDesignSettings {
    const cloned = JSON.parse(JSON.stringify(settings)) as ProfessionalDesignSettings;
    return this.syncDerivedViews(cloned);
  }

  /**
   * Returns a read-only copy of the canonical Global Style (`GLOBAL_STYLE`) for a given role.
   */
  public static getGlobalRoleStyle(role: SemanticStyleRole | ContentRole): RoleDesignStyle {
    return GLOBAL_ROLE_STYLES[role as SemanticStyleRole] ?? GLOBAL_ROLE_STYLES.regular_paragraph;
  }

  /**
   * Checks whether a requested font family is installed/supported for Hebrew holy-book typesetting,
   * and returns its availability + fallback information without modifying text.
   */
  public static checkFontAvailability(requestedFont: string): {
    requestedFont: string;
    isAvailable: boolean;
    isAvailableOnSystem: boolean;
    effectiveFont: string;
    effectiveFallbackFont?: string;
    warningHe?: string;
    warningMessage?: string;
  } {
    const clean = (requestedFont || '').trim();
    if (!clean) {
      return {
        requestedFont: 'Frank Ruhl Libre',
        isAvailable: true,
        isAvailableOnSystem: true,
        effectiveFont: 'Frank Ruhl Libre',
      };
    }

    const known = KNOWN_HOLY_BOOK_FONTS.find(
      f => f.family.toLowerCase() === clean.toLowerCase()
    );
    if (known && known.hasHebrew) {
      if (!known.hasNikud) {
        const msg = `הגופן "${known.family}" אינו תומך בניקוד מלא (GPOS). מופעל מנגנון גיבוי אוטומטי לניקוד ("Frank Ruhl Libre").`;
        return {
          requestedFont: known.family,
          isAvailable: true,
          isAvailableOnSystem: true,
          effectiveFont: 'Frank Ruhl Libre',
          effectiveFallbackFont: 'Frank Ruhl Libre',
          warningHe: msg,
          warningMessage: msg,
        };
      }
      return {
        requestedFont: known.family,
        isAvailable: true,
        isAvailableOnSystem: true,
        effectiveFont: known.family,
      };
    }

    if (clean.toLowerCase() === 'miriam libre') {
      return {
        requestedFont: 'Miriam Libre',
        isAvailable: true,
        isAvailableOnSystem: true,
        effectiveFont: 'Miriam Libre',
      };
    }

    const msg = `הגופן "${clean}" אינו מותקן או אינו תומך בעברית מלאה במחשב זה. התצוגה משתמשת בגופן הגיבוי "Frank Ruhl Libre" תוך שמירה מלאה על הטקסט.`;
    return {
      requestedFont: clean,
      isAvailable: false,
      isAvailableOnSystem: false,
      effectiveFont: 'Frank Ruhl Libre',
      effectiveFallbackFont: 'Frank Ruhl Libre',
      warningHe: msg,
      warningMessage: msg,
    };
  }

  public static resolveFontAvailability(
    requestedFont: string,
    _role?: SemanticStyleRole | ContentRole
  ) {
    return this.checkFontAvailability(requestedFont);
  }

  /**
   * Enforces Stage 12 Level 0 Universal Engine Hard Rules on any candidate `ProfessionalDesignSettings`:
   * - Clamps unreadable font sizes (< 6pt or > 72pt)
   * - Clamps horizontal character scale to [90%..110%] (prevents glyph distortion — Law #6)
   * - Clamps wordSpacingRatio to [0.75..1.60] and trackingEm to [-0.05..0.25]
   * - Clamps lineSpacingRatio to [1.05..2.50] (prevents vertical text collision — Law #4)
   * - Clamps page margins and gutters so content width never falls below Level 0 minimum readable width
   *   (`135pt` Source, `78pt` Commentary)
   * - Preserves Hebrew RTL direction for Hebrew holy-book roles unless explicitly valid
   */
  public static sanitizeAndEnforceHardRules(
    raw: ProfessionalDesignSettings
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(raw);
    const warnings: string[] = [];
    let clamped = false;

    const clampNum = (
      val: number,
      min: number,
      max: number,
      labelHe: string
    ): number => {
      if (Number.isNaN(val)) return min;
      if (val < min) {
        clamped = true;
        warnings.push(
          `חוק מנוע קשיח (LEVEL 0 — הגנת קריאות וגאומטריה): ${labelHe} (${val}) הוגבל למינימום החוקי (${min}).`
        );
        return min;
      }
      if (val > max) {
        clamped = true;
        warnings.push(
          `חוק מנוע קשיח (LEVEL 0 — הגנת קריאות וגאומטריה): ${labelHe} (${val}) הוגבל למקסימום החוקי (${max}).`
        );
        return max;
      }
      return val;
    };

    // 1. Page Layout bounds
    next.pageLayout.pageWidthPt = clampNum(
      next.pageLayout.pageWidthPt,
      280,
      1200,
      'רוחב עמוד'
    );
    next.pageLayout.pageHeightPt = clampNum(
      next.pageLayout.pageHeightPt,
      360,
      1600,
      'גובה עמוד'
    );
    next.pageLayout.marginTopPt = clampNum(
      next.pageLayout.marginTopPt,
      18,
      next.pageLayout.pageHeightPt * 0.3,
      'שוליים עליונים'
    );
    next.pageLayout.marginBottomPt = clampNum(
      next.pageLayout.marginBottomPt,
      18,
      next.pageLayout.pageHeightPt * 0.3,
      'שוליים תחתונים'
    );
    next.pageLayout.marginInsidePt = clampNum(
      next.pageLayout.marginInsidePt,
      18,
      next.pageLayout.pageWidthPt * 0.28,
      'שוליים פנימיים'
    );
    next.pageLayout.marginOutsidePt = clampNum(
      next.pageLayout.marginOutsidePt,
      18,
      next.pageLayout.pageWidthPt * 0.28,
      'שוליים חיצוניים'
    );
    next.pageLayout.columnGutterPt = clampNum(
      next.pageLayout.columnGutterPt,
      6,
      48,
      'מרווח בין טורים (Gutter)'
    );

    // Ensure usable content width satisfies Level 0 minimum readable width
    const minReqContentW =
      next.layoutType === 'rav_text' || next.layoutType === 'mikraot_gedolot'
        ? SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT +
          2 * SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT +
          2 * (next.ravText.gutterWidthPt || 11)
        : next.layoutType === 'two_column'
        ? 2 * SpatialExclusionEngine.MIN_READABLE_COMMENT_WIDTH_PT +
          next.pageLayout.columnGutterPt
        : SpatialExclusionEngine.MIN_READABLE_SOURCE_WIDTH_PT;

    const currentContentW =
      next.pageLayout.pageWidthPt -
      next.pageLayout.marginInsidePt -
      next.pageLayout.marginOutsidePt;

    if (currentContentW < minReqContentW) {
      clamped = true;
      const maxTotalHorizontalMargins = Math.max(
        36,
        next.pageLayout.pageWidthPt - minReqContentW
      );
      next.pageLayout.marginInsidePt = Math.floor(maxTotalHorizontalMargins / 2);
      next.pageLayout.marginOutsidePt = Math.floor(maxTotalHorizontalMargins / 2);
      warnings.push(
        `חוק מנוע קשיח (LEVEL 0 — רוחב קריאה מינימלי): השוליים הותאמו כדי לשמור על רוחב טקסט חוקי מינימלי (${minReqContentW}pt).`
      );
    }

    // 2. Rav Text bounds
    next.ravText.sourceFontSizePt = clampNum(
      next.ravText.sourceFontSizePt,
      8.0,
      36.0,
      'גודל גופן מקור'
    );
    next.ravText.rashiFontSizePt = clampNum(
      next.ravText.rashiFontSizePt,
      7.0,
      28.0,
      'גודל גופן רש״י'
    );
    next.ravText.tosafotFontSizePt = clampNum(
      next.ravText.tosafotFontSizePt,
      7.0,
      28.0,
      'גודל גופן תוספות'
    );
    next.ravText.gutterWidthPt = clampNum(
      next.ravText.gutterWidthPt,
      8.0,
      32.0,
      'מרווח רב-טקסט (Gutter)'
    );
    next.ravText.minSourceWidthPt = clampNum(
      next.ravText.minSourceWidthPt ?? 135,
      135,
      320,
      'רוחב מקור מינימלי'
    );
    next.ravText.minCommentaryWidthPt = clampNum(
      next.ravText.minCommentaryWidthPt ?? 78,
      78,
      220,
      'רוחב מפרש מינימלי'
    );
    next.ravText.upperCollarLines = Math.round(
      clampNum(next.ravText.upperCollarLines, 0, 12, 'מספר שורות ברך עליונה')
    );
    next.ravText.kneeJunctionPercent = clampNum(
      next.ravText.kneeJunctionPercent,
      25,
      85,
      'אחוז צומת ברך'
    );
    next.ravText.lowerSourceWidthPercent = clampNum(
      next.ravText.lowerSourceWidthPercent,
      55,
      125,
      'אחוז רוחב מקור תחתון'
    );
    next.ravText.sourceLineSpacingRatio = clampNum(
      next.ravText.sourceLineSpacingRatio,
      1.05,
      2.2,
      'מרווח שורות מקור'
    );
    next.ravText.commentaryLineSpacingRatio = clampNum(
      next.ravText.commentaryLineSpacingRatio,
      1.05,
      2.2,
      'מרווח שורות מפרשים'
    );
    next.ravText.commentaryToSourceScaleRatio = Number(
      (next.ravText.rashiFontSizePt / Math.max(1, next.ravText.sourceFontSizePt)).toFixed(2)
    );

    // 3. Footnotes bounds
    next.footnotes.fontSizePt = clampNum(
      next.footnotes.fontSizePt,
      6.5,
      18.0,
      'גודל גופן הערות שוליים'
    );
    next.footnotes.lineSpacingPt = clampNum(
      next.footnotes.lineSpacingPt,
      Math.max(8.0, next.footnotes.fontSizePt * 1.08),
      32.0,
      'מרווח שורות הערות שוליים'
    );
    next.footnotes.paragraphSpacingPt = clampNum(
      next.footnotes.paragraphSpacingPt,
      0,
      18.0,
      'מרווח פסקאות הערות שוליים'
    );

    // 4. Sanitize projectRoleStyles
    const sanitizeChar = (c: Partial<CharacterStyleSettings>, roleLabel: string) => {
      if (c.fontSizePt !== undefined) {
        c.fontSizePt = clampNum(c.fontSizePt, 6.5, 48.0, `גודל גופן (${roleLabel})`);
      }
      if (c.horizontalScalePercent !== undefined) {
        c.horizontalScalePercent = clampNum(
          c.horizontalScalePercent,
          90,
          110,
          `מתיחה אופקית של אותיות (${roleLabel})`
        );
      }
      if (c.wordSpacingRatio !== undefined) {
        c.wordSpacingRatio = clampNum(
          c.wordSpacingRatio,
          0.75,
          1.6,
          `מרווח מילים (${roleLabel})`
        );
      }
      if (c.trackingEm !== undefined) {
        c.trackingEm = clampNum(
          c.trackingEm,
          -0.05,
          0.25,
          `מרווח אותיות (${roleLabel})`
        );
      }
      if (c.baselineShiftPt !== undefined) {
        c.baselineShiftPt = clampNum(
          c.baselineShiftPt,
          -6,
          8,
          `היסט קו בסיס (${roleLabel})`
        );
      }
      if (c.openTypeFeatures) {
        // Level 0 Law #10: Combining mark positioning cannot be disabled for Hebrew
        if (c.openTypeFeatures.markPositioning === false) {
          c.openTypeFeatures.markPositioning = true;
          clamped = true;
          warnings.push(
            'חוק מנוע קשיח (LEVEL 0 — שלמות ניקוד וטעמים): לא ניתן לכבות הצמדת סימני ניקוד לאותיות הבסיס (GPOS mark).'
          );
        }
      }
    };

    const sanitizePara = (p: Partial<ParagraphStyleSettings>, roleLabel: string) => {
      if (p.lineSpacingRatio !== undefined) {
        p.lineSpacingRatio = clampNum(
          p.lineSpacingRatio,
          1.05,
          2.5,
          `מרווח שורות (${roleLabel})`
        );
      }
      if (p.leadingPt !== undefined) {
        p.leadingPt = clampNum(p.leadingPt, 7.5, 72.0, `Leading (${roleLabel})`);
      }
      if (p.spaceBeforePt !== undefined) {
        p.spaceBeforePt = clampNum(p.spaceBeforePt, 0, 48.0, `מרווח לפני פסקה (${roleLabel})`);
      }
      if (p.spaceAfterPt !== undefined) {
        p.spaceAfterPt = clampNum(p.spaceAfterPt, 0, 48.0, `מרווח אחרי פסקה (${roleLabel})`);
      }
      if (p.firstLineIndentPt !== undefined) {
        p.firstLineIndentPt = clampNum(
          p.firstLineIndentPt,
          0,
          72.0,
          `כניסת שורה ראשונה (${roleLabel})`
        );
      }
      if (p.rightIndentPt !== undefined) {
        p.rightIndentPt = clampNum(p.rightIndentPt, 0, 72.0, `כניסה מימין (${roleLabel})`);
      }
      if (p.leftIndentPt !== undefined) {
        p.leftIndentPt = clampNum(p.leftIndentPt, 0, 72.0, `כניסה משמאל (${roleLabel})`);
      }
      if (p.hangingIndentPt !== undefined) {
        p.hangingIndentPt = clampNum(p.hangingIndentPt, 0, 72.0, `הזחה תלויה (${roleLabel})`);
      }
      if (p.minFollowingLines !== undefined) {
        p.minFollowingLines = Math.round(
          clampNum(p.minFollowingLines, 1, 8, `מינימום שורות המשך (${roleLabel})`)
        );
      }
      if (p.keepWithNextLines !== undefined && p.keepWithNext === undefined) {
        p.keepWithNext = p.keepWithNextLines > 0;
        if (p.keepWithNextLines > 0) {
          p.minFollowingLines = p.keepWithNextLines;
        }
      }
    };

    for (const [roleKey, entry] of Object.entries(next.projectRoleStyles)) {
      if (!entry) continue;
      if (entry.character) sanitizeChar(entry.character, roleKey);
      if (entry.paragraph) sanitizePara(entry.paragraph, roleKey);
    }

    for (const loc of next.localOverrides) {
      if (loc.characterOverrides) sanitizeChar(loc.characterOverrides, `דריסה מקומית ${loc.unitId}`);
      if (loc.paragraphOverrides) sanitizePara(loc.paragraphOverrides, `דריסה מקומית ${loc.unitId}`);
    }

    this.syncDerivedViews(next);

    return {
      clampedByEngineHardRule: clamped,
      warnings,
      settings: next,
    };
  }

  /**
   * Resolves the effective `RoleDesignStyle` (`CharacterStyleSettings` + `ParagraphStyleSettings`)
   * for a given `ContentRole`, optional `unitId`, and optional `wordIndex` by combining:
   *   1. `GLOBAL_ROLE_STYLES[role]`
   *   2. Synchronization from `ravText` / `footnotes` role-specific settings
   *   3. `settings.projectRoleStyles[role]` (`PROJECT_STYLE`)
   *   4. Matching `settings.localOverrides` (`LOCAL_OVERRIDE`)
   */
  public static resolveRoleAndUnitStyle(
    settings: ProfessionalDesignSettings,
    role: SemanticStyleRole | ContentRole,
    unitId?: string,
    wordIndex?: number
  ): {
    character: CharacterStyleSettings;
    paragraph: ParagraphStyleSettings;
    styleTier: 'GLOBAL_STYLE' | 'PROJECT_STYLE' | 'LOCAL_OVERRIDE';
    sourceScope: DesignScopeLevel;
    hasLocalOverride: boolean;
    localOverrideIds: string[];
  } {
    const globalBase = this.getGlobalRoleStyle(role);
    const char: CharacterStyleSettings = {
      ...globalBase.character,
      openTypeFeatures: { ...globalBase.character.openTypeFeatures },
    };
    const para: ParagraphStyleSettings = {
      ...globalBase.paragraph,
      tabStopsPt: [...globalBase.paragraph.tabStopsPt],
    };

    // Synchronize domain-specific settings (Rav Text / Footnotes / Page Elements)
    if (role === 'main_source' || role === 'regular_paragraph' || role === 'body') {
      char.fontFamily = settings.ravText.sourceFontFamily || char.fontFamily;
      if (role === 'main_source') {
        char.fontSizePt = settings.ravText.sourceFontSizePt;
      }
      para.lineSpacingRatio = settings.ravText.sourceLineSpacingRatio;
      para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
    } else if (role === 'primary_comment') {
      char.fontFamily = settings.ravText.rashiFontFamily || char.fontFamily;
      char.fontSizePt = settings.ravText.rashiFontSizePt;
      para.lineSpacingRatio = settings.ravText.commentaryLineSpacingRatio;
      para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
    } else if (role === 'secondary_comment') {
      char.fontFamily = settings.ravText.tosafotFontFamily || char.fontFamily;
      char.fontSizePt = settings.ravText.tosafotFontSizePt;
      para.lineSpacingRatio = settings.ravText.commentaryLineSpacingRatio;
      para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
    } else if (role === 'dibbur_hamatchil') {
      char.isBold = settings.ravText.dibburHamatchilBold;
      char.fontWeight = settings.ravText.dibburHamatchilBold ? 700 : 400;
      const scaleMult = (settings.ravText.dibburScalePercent ?? 100) / 100.0;
      char.fontSizePt = Number(
        (
          (settings.ravText.rashiFontSizePt + settings.ravText.dibburHamatchilFontSizeDeltaPt) *
          scaleMult
        ).toFixed(2)
      );
    } else if (role === 'footnote') {
      char.fontFamily = settings.footnotes.fontFamily || char.fontFamily;
      char.fontSizePt = settings.footnotes.fontSizePt;
      para.leadingPt = settings.footnotes.lineSpacingPt;
      para.lineSpacingRatio = Number(
        (settings.footnotes.lineSpacingPt / Math.max(1, settings.footnotes.fontSizePt)).toFixed(2)
      );
      para.spaceAfterPt = settings.footnotes.paragraphSpacingPt;
      para.rightIndentPt = settings.footnotes.indentPt;
      para.justifyNonFinalLines = settings.footnotes.justifyMultiLineFootnotes;
      para.alignment = settings.footnotes.justifyMultiLineFootnotes ? 'justify' : 'right';
    } else if (role === 'page_element' || role === 'header_running' || role === 'folio_number') {
      char.fontSizePt = settings.pageLayout.runningHeaderFontSizePt;
    }

    let styleTier: 'GLOBAL_STYLE' | 'PROJECT_STYLE' | 'LOCAL_OVERRIDE' = 'GLOBAL_STYLE';
    let sourceScope: DesignScopeLevel = 'role';

    // Apply PROJECT_STYLE overrides for this role
    const projOverride = settings.projectRoleStyles[role as SemanticStyleRole];
    if (projOverride) {
      if (projOverride.character && Object.keys(projOverride.character).length > 0) {
        Object.assign(char, projOverride.character);
        if (projOverride.character.openTypeFeatures) {
          char.openTypeFeatures = {
            ...char.openTypeFeatures,
            ...projOverride.character.openTypeFeatures,
          };
        }
        if (projOverride.character.isBold !== undefined) {
          char.fontWeight = projOverride.character.isBold
            ? Math.max(600, char.fontWeight)
            : projOverride.character.fontWeight ?? 400;
        }
        styleTier = 'PROJECT_STYLE';
      }
      if (projOverride.paragraph && Object.keys(projOverride.paragraph).length > 0) {
        Object.assign(para, projOverride.paragraph);
        if (
          projOverride.paragraph.lineSpacingRatio !== undefined &&
          projOverride.paragraph.leadingPt === undefined
        ) {
          para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
        } else if (
          projOverride.paragraph.leadingPt !== undefined &&
          projOverride.paragraph.lineSpacingRatio === undefined
        ) {
          para.lineSpacingRatio = Number(
            (para.leadingPt / Math.max(1, char.fontSizePt)).toFixed(2)
          );
        }
        if (projOverride.paragraph.alignment !== undefined) {
          para.justifyNonFinalLines = projOverride.paragraph.alignment === 'justify';
        }
        styleTier = 'PROJECT_STYLE';
      }
    }

    // Apply LOCAL_OVERRIDE if unitId is specified
    const matchingLocalIds: string[] = [];
    if (unitId) {
      for (const loc of settings.localOverrides) {
        if (loc.unitId !== unitId) continue;
        if (loc.wordRange && wordIndex !== undefined) {
          if (wordIndex < loc.wordRange.startWordIndex || wordIndex > loc.wordRange.endWordIndex) {
            continue;
          }
        } else if (loc.wordRange && wordIndex === undefined) {
          // Word-range override only applies when inspecting that word or rendering that word
          continue;
        }
        matchingLocalIds.push(loc.id);
        if (loc.characterOverrides) {
          Object.assign(char, loc.characterOverrides);
          if (loc.characterOverrides.openTypeFeatures) {
            char.openTypeFeatures = {
              ...char.openTypeFeatures,
              ...loc.characterOverrides.openTypeFeatures,
            };
          }
          if (loc.characterOverrides.isBold !== undefined) {
            char.fontWeight = loc.characterOverrides.isBold ? 700 : 400;
          }
        }
        if (loc.paragraphOverrides) {
          Object.assign(para, loc.paragraphOverrides);
          if (
            loc.paragraphOverrides.lineSpacingRatio !== undefined &&
            loc.paragraphOverrides.leadingPt === undefined
          ) {
            para.leadingPt = Number((char.fontSizePt * para.lineSpacingRatio).toFixed(2));
          } else if (
            loc.paragraphOverrides.leadingPt !== undefined &&
            loc.paragraphOverrides.lineSpacingRatio === undefined
          ) {
            para.lineSpacingRatio = Number(
              (para.leadingPt / Math.max(1, char.fontSizePt)).toFixed(2)
            );
          }
          if (loc.paragraphOverrides.alignment !== undefined) {
            para.justifyNonFinalLines = loc.paragraphOverrides.alignment === 'justify';
          }
        }
        styleTier = 'LOCAL_OVERRIDE';
        sourceScope = loc.wordRange ? 'local_word' : 'local_unit';
      }
    }

    return {
      character: char,
      paragraph: para,
      styleTier,
      sourceScope,
      hasLocalOverride: matchingLocalIds.length > 0,
      localOverrideIds: matchingLocalIds,
    };
  }

  public static resolveStyle(
    settings: ProfessionalDesignSettings,
    context: {
      role?: SemanticStyleRole | ContentRole;
      unitId?: string;
      wordIndex?: number;
      pageIndex?: number;
    }
  ): {
    character: CharacterStyleSettings;
    paragraph: ParagraphStyleSettings;
    styleTier: 'GLOBAL_STYLE' | 'PROJECT_STYLE' | 'LOCAL_OVERRIDE';
    sourceScope: DesignScopeLevel;
    hasLocalOverride: boolean;
    localOverrideIds: string[];
  } {
    return this.resolveRoleAndUnitStyle(
      settings,
      context.role ?? 'main_source',
      context.unitId,
      context.wordIndex
    );
  }

  /**
   * Resolves the effective formatting for the current user selection (`DesignSelectionTarget`),
   * including `"Mixed"` field detection when multiple selected units or words have differing values.
   */
  public static resolveSelectionFormatting(
    settings: ProfessionalDesignSettings,
    selection: DesignSelectionTarget | null | undefined,
    units: ContentUnit[] = []
  ): EffectiveResolvedFormatting {
    if (!selection || selection.unitIds.length === 0) {
      const defaultRole: ContentRole = selection?.role ?? 'main_source';
      const resolved = this.resolveRoleAndUnitStyle(settings, defaultRole);
      return {
        targetScope: selection?.role ? 'role' : 'document',
        sourceScope: resolved.sourceScope,
        activeRole: defaultRole,
        styleTier: resolved.styleTier,
        hasLocalOverride: false,
        localOverrideIds: [],
        mixedFields: [],
        character: resolved.character,
        paragraph: resolved.paragraph,
        fontAvailability: this.checkFontAvailability(resolved.character.fontFamily),
      };
    }

    const resolvedItems = selection.unitIds.map(uId => {
      const unit = units.find(u => u.id === uId);
      const role = unit?.role ?? selection.role ?? 'main_source';
      return {
        unitId: uId,
        role,
        ...this.resolveRoleAndUnitStyle(settings, role, uId, selection.wordIndex),
      };
    });

    // Also check if a single unit has mixed word-range local overrides when no specific wordIndex is selected
    if (
      selection.unitIds.length === 1 &&
      selection.wordIndex === undefined
    ) {
      const singleUnitId = selection.unitIds[0];
      const wordRangeOverrides = settings.localOverrides.filter(
        o => o.unitId === singleUnitId && Boolean(o.wordRange)
      );
      if (wordRangeOverrides.length > 0) {
        const baseItem = resolvedItems[0];
        for (const wro of wordRangeOverrides) {
          resolvedItems.push(
            {
              unitId: singleUnitId,
              role: baseItem.role,
              ...this.resolveRoleAndUnitStyle(
                settings,
                baseItem.role,
                singleUnitId,
                wro.wordRange!.startWordIndex
              ),
            }
          );
        }
      }
    }

    const first = resolvedItems[0];
    const mixedFields: string[] = [];

    if (resolvedItems.length > 1) {
      const charKeys: Array<keyof CharacterStyleSettings> = [
        'fontFamily',
        'fontSizePt',
        'fontWeight',
        'fontStyle',
        'isBold',
        'isItalic',
        'isUnderline',
        'trackingEm',
        'wordSpacingRatio',
        'horizontalScalePercent',
        'baselineShiftPt',
      ];
      for (const k of charKeys) {
        const firstVal = first.character[k];
        if (resolvedItems.some(item => item.character[k] !== firstVal)) {
          mixedFields.push(`character.${k}`);
        }
      }

      const paraKeys: Array<keyof ParagraphStyleSettings> = [
        'alignment',
        'lastLineAlignment',
        'direction',
        'leadingPt',
        'lineSpacingRatio',
        'spaceBeforePt',
        'spaceAfterPt',
        'firstLineIndentPt',
        'rightIndentPt',
        'leftIndentPt',
      ];
      for (const k of paraKeys) {
        const firstVal = first.paragraph[k];
        if (resolvedItems.some(item => item.paragraph[k] !== firstVal)) {
          mixedFields.push(`paragraph.${k}`);
        }
      }
    }

    const allLocalIds = Array.from(
      new Set(resolvedItems.flatMap(r => r.localOverrideIds))
    );
    const hasLocal = allLocalIds.length > 0;

    return {
      targetScope:
        mixedFields.length > 0 || selection.unitIds.length > 1
          ? 'mixed_selection'
          : selection.wordIndex !== undefined
          ? 'word_range'
          : 'unit',
      sourceScope: hasLocal ? 'local_selection' : 'role',
      activeRole: first.role,
      styleTier: hasLocal ? 'LOCAL_OVERRIDE' : first.styleTier,
      hasLocalOverride: hasLocal,
      localOverrideIds: allLocalIds,
      mixedFields,
      character: first.character,
      paragraph: first.paragraph,
      fontAvailability: this.checkFontAvailability(first.character.fontFamily),
    };
  }

  public static updateRoleCharacterStyle(
    current: ProfessionalDesignSettings,
    role: SemanticStyleRole | ContentRole,
    patch: Partial<CharacterStyleSettings>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.updateRoleStyle(
      current,
      role as ContentRole,
      { character: patch },
      actor
    ).settings;
  }

  public static updateRoleParagraphStyle(
    current: ProfessionalDesignSettings,
    role: SemanticStyleRole | ContentRole,
    patch: Partial<ParagraphStyleSettings>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.updateRoleStyle(
      current,
      role as ContentRole,
      { paragraph: patch },
      actor
    ).settings;
  }

  public static setLocalUnitOverride(
    current: ProfessionalDesignSettings,
    unitId: string,
    updates: {
      character?: Partial<CharacterStyleSettings>;
      paragraph?: Partial<ParagraphStyleSettings>;
    },
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.applyLocalOverride(current, { unitIds: [unitId] }, updates, actor).settings;
  }

  public static setLocalWordOverride(
    current: ProfessionalDesignSettings,
    unitId: string,
    wordIndex: number,
    patch: Partial<CharacterStyleSettings>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.applyLocalOverride(
      current,
      { unitIds: [unitId], wordRange: { startWordIndex: wordIndex, endWordIndex: wordIndex } },
      { character: patch },
      actor
    ).settings;
  }

  public static clearLocalUnitOverride(
    current: ProfessionalDesignSettings,
    unitId: string,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.clearLocalOverrides(current, [unitId], actor);
  }

  public static resetRoleToDefault(
    current: ProfessionalDesignSettings,
    role: SemanticStyleRole | ContentRole,
    _actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.resetRoleStyleToGlobal(current, role as ContentRole, false);
  }

  public static updateLayoutSettings(
    current: ProfessionalDesignSettings,
    patch: { layoutType?: BookLayoutType; geometry?: Partial<PageGeometry> },
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    if (patch.layoutType) {
      next.layoutType = patch.layoutType;
      next.pageLayout.layoutType = patch.layoutType;
      if (patch.layoutType === 'two_column') {
        next.pageLayout.columnCount = 2;
      }
    }
    if (patch.geometry) {
      if (patch.geometry.pageWidth !== undefined) next.pageLayout.pageWidthPt = patch.geometry.pageWidth;
      if (patch.geometry.pageHeight !== undefined) next.pageLayout.pageHeightPt = patch.geometry.pageHeight;
      if (patch.geometry.marginTop !== undefined) next.pageLayout.marginTopPt = patch.geometry.marginTop;
      if (patch.geometry.marginBottom !== undefined) next.pageLayout.marginBottomPt = patch.geometry.marginBottom;
      if (patch.geometry.marginInside !== undefined) next.pageLayout.marginInsidePt = patch.geometry.marginInside;
      if (patch.geometry.marginOutside !== undefined) next.pageLayout.marginOutsidePt = patch.geometry.marginOutside;
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  public static updatePageGeometry(
    current: ProfessionalDesignSettings,
    patch: Partial<PageGeometry>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    return this.updateLayoutSettings(current, { geometry: patch }, actor);
  }

  public static updateColumnSettings(
    current: ProfessionalDesignSettings,
    patch: Partial<ColumnDesignSettings>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    next.columns = {
      ...next.columns,
      ...patch,
    };
    if (patch.columnGapPt !== undefined) {
      next.pageLayout.columnGutterPt = patch.columnGapPt;
    }
    if (patch.columnCount !== undefined) {
      next.pageLayout.columnCount = patch.columnCount;
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  public static updatePageElementsSettings(
    current: ProfessionalDesignSettings,
    patch: Partial<PageElementsDesignSettings>,
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    next.pageElements = {
      ...next.pageElements,
      ...patch,
    };
    if (patch.showRunningHeader !== undefined) {
      next.pageLayout.showRunningHeader = patch.showRunningHeader;
    }
    if (patch.runningHeaderFontSizePt !== undefined) {
      next.pageLayout.runningHeaderFontSizePt = patch.runningHeaderFontSizePt;
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  /**
   * Modifies a Project Style (`PROJECT_STYLE`) for a given semantic `ContentRole`.
   * Updates all content using that role unless a local override exists on a specific unit.
   */
  public static updateRoleStyle(
    current: ProfessionalDesignSettings,
    role: ContentRole,
    updates: {
      character?: Partial<CharacterStyleSettings>;
      paragraph?: Partial<ParagraphStyleSettings>;
    },
    actor: 'user' | 'ai' = 'user',
    summary?: string
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    const rolesToSync: SemanticStyleRole[] =
      role === 'main_source' || role === 'regular_paragraph' || (role as SemanticStyleRole) === 'body'
        ? ['main_source', 'regular_paragraph', 'body']
        : [role];

    for (const rKey of rolesToSync) {
      const existing = next.projectRoleStyles[rKey] ?? {};
      next.projectRoleStyles[rKey] = {
        character: {
          ...(existing.character ?? {}),
          ...(updates.character ?? {}),
        },
        paragraph: {
          ...(existing.paragraph ?? {}),
          ...(updates.paragraph ?? {}),
        },
      };
    }

    // Keep top-level domain shortcuts (`ravText`, `footnotes`, `pageLayout`) synchronized with role style updates
    if (role === 'main_source' || role === 'regular_paragraph' || (role as SemanticStyleRole) === 'body') {
      if (updates.character?.fontFamily) {
        next.ravText.sourceFontFamily = updates.character.fontFamily;
      }
      if (role === 'main_source' && updates.character?.fontSizePt !== undefined) {
        next.ravText.sourceFontSizePt = updates.character.fontSizePt;
      }
      if (updates.paragraph?.lineSpacingRatio !== undefined) {
        next.ravText.sourceLineSpacingRatio = updates.paragraph.lineSpacingRatio;
      } else if (updates.paragraph?.leadingPt !== undefined) {
        const effSize =
          updates.character?.fontSizePt ??
          this.resolveRoleAndUnitStyle(current, role).character.fontSizePt;
        next.ravText.sourceLineSpacingRatio = Number(
          (updates.paragraph.leadingPt / Math.max(1, effSize)).toFixed(2)
        );
      }
    } else if (role === 'primary_comment') {
      if (updates.character?.fontFamily) {
        next.ravText.rashiFontFamily = updates.character.fontFamily;
      }
      if (updates.character?.fontSizePt !== undefined) {
        next.ravText.rashiFontSizePt = updates.character.fontSizePt;
      }
      if (updates.paragraph?.lineSpacingRatio !== undefined) {
        next.ravText.commentaryLineSpacingRatio = updates.paragraph.lineSpacingRatio;
      } else if (updates.paragraph?.leadingPt !== undefined) {
        const effSize =
          updates.character?.fontSizePt ?? next.ravText.rashiFontSizePt;
        next.ravText.commentaryLineSpacingRatio = Number(
          (updates.paragraph.leadingPt / Math.max(1, effSize)).toFixed(2)
        );
      }
    } else if (role === 'secondary_comment') {
      if (updates.character?.fontFamily) {
        next.ravText.tosafotFontFamily = updates.character.fontFamily;
      }
      if (updates.character?.fontSizePt !== undefined) {
        next.ravText.tosafotFontSizePt = updates.character.fontSizePt;
      }
      if (updates.paragraph?.lineSpacingRatio !== undefined) {
        next.ravText.commentaryLineSpacingRatio = updates.paragraph.lineSpacingRatio;
      }
    } else if (role === 'footnote') {
      if (updates.character?.fontFamily) {
        next.footnotes.fontFamily = updates.character.fontFamily;
      }
      if (updates.character?.fontSizePt !== undefined) {
        next.footnotes.fontSizePt = updates.character.fontSizePt;
      }
      if (updates.paragraph?.leadingPt !== undefined) {
        next.footnotes.lineSpacingPt = updates.paragraph.leadingPt;
      } else if (updates.paragraph?.lineSpacingRatio !== undefined) {
        const effSize = updates.character?.fontSizePt ?? next.footnotes.fontSizePt;
        next.footnotes.lineSpacingPt = Number(
          (effSize * updates.paragraph.lineSpacingRatio).toFixed(1)
        );
      }
      if (updates.paragraph?.spaceAfterPt !== undefined) {
        next.footnotes.paragraphSpacingPt = updates.paragraph.spaceAfterPt;
      }
      if (updates.paragraph?.alignment !== undefined) {
        next.footnotes.justifyMultiLineFootnotes = updates.paragraph.alignment === 'justify';
      }
    }

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary =
      summary ?? `עדכון סגנון ${GLOBAL_ROLE_STYLES[role]?.displayNameHe ?? role}`;

    return this.sanitizeAndEnforceHardRules(next);
  }

  /**
   * Creates or updates a Local Formatting Override (`LOCAL_OVERRIDE`) on one or more `unitIds`
   * (or a specific `wordRange`) without modifying the parent `PROJECT_STYLE` or `GLOBAL_STYLE`.
   */
  public static applyLocalOverride(
    current: ProfessionalDesignSettings,
    target: {
      unitIds: string[];
      wordRange?: { startWordIndex: number; endWordIndex: number };
    },
    updates: {
      character?: Partial<CharacterStyleSettings>;
      paragraph?: Partial<ParagraphStyleSettings>;
    },
    actor: 'user' | 'ai' = 'user',
    summary?: string
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);

    for (const unitId of target.unitIds) {
      const existingIdx = next.localOverrides.findIndex(
        o =>
          o.unitId === unitId &&
          JSON.stringify(o.wordRange ?? null) === JSON.stringify(target.wordRange ?? null)
      );

      if (existingIdx >= 0) {
        const prev = next.localOverrides[existingIdx];
        next.localOverrides[existingIdx] = {
          ...prev,
          characterOverrides: {
            ...(prev.characterOverrides ?? {}),
            ...(updates.character ?? {}),
          },
          paragraphOverrides: {
            ...(prev.paragraphOverrides ?? {}),
            ...(updates.paragraph ?? {}),
          },
          createdAt: Date.now(),
          sourceActor: actor,
        };
      } else {
        next.localOverrides.push({
          id: `loc-fmt-${unitId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          unitId,
          wordRange: target.wordRange ? { ...target.wordRange } : undefined,
          characterOverrides: updates.character ? { ...updates.character } : undefined,
          paragraphOverrides: updates.paragraph ? { ...updates.paragraph } : undefined,
          createdAt: Date.now(),
          sourceActor: actor,
        });
      }
    }

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary =
      summary ?? `דריסת עיצוב מקומית (${target.unitIds.join(', ')})`;

    return this.sanitizeAndEnforceHardRules(next);
  }

  /**
   * Removes local formatting overrides for specific `unitIds` (or all units if omitted),
   * resetting them cleanly to their parent `PROJECT_STYLE` / `GLOBAL_STYLE`.
   */
  public static clearLocalOverrides(
    current: ProfessionalDesignSettings,
    unitIds?: string[],
    actor: 'user' | 'ai' = 'user'
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    if (!unitIds || unitIds.length === 0) {
      next.localOverrides = [];
    } else {
      const idSet = new Set(unitIds);
      next.localOverrides = next.localOverrides.filter(o => !idSet.has(o.unitId));
    }
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = 'איפוס דריסות מקומיות לסגנון האב';
    return this.syncDerivedViews(next);
  }

  /**
   * Resets a role's `PROJECT_STYLE` back to its canonical `GLOBAL_STYLE` (optionally preserving or clearing local overrides).
   */
  public static resetRoleStyleToGlobal(
    current: ProfessionalDesignSettings,
    role: ContentRole,
    clearRoleLocalOverrides: boolean = false,
    units: ContentUnit[] = []
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    delete next.projectRoleStyles[role];

    const globalStyle = this.getGlobalRoleStyle(role);
    if (role === 'main_source') {
      next.ravText.sourceFontFamily = globalStyle.character.fontFamily;
      next.ravText.sourceFontSizePt = globalStyle.character.fontSizePt;
      next.ravText.sourceLineSpacingRatio = globalStyle.paragraph.lineSpacingRatio;
    } else if (role === 'primary_comment') {
      next.ravText.rashiFontFamily = globalStyle.character.fontFamily;
      next.ravText.rashiFontSizePt = globalStyle.character.fontSizePt;
      next.ravText.commentaryLineSpacingRatio = globalStyle.paragraph.lineSpacingRatio;
    } else if (role === 'secondary_comment') {
      next.ravText.tosafotFontFamily = globalStyle.character.fontFamily;
      next.ravText.tosafotFontSizePt = globalStyle.character.fontSizePt;
    } else if (role === 'footnote') {
      next.footnotes.fontFamily = globalStyle.character.fontFamily;
      next.footnotes.fontSizePt = globalStyle.character.fontSizePt;
      next.footnotes.lineSpacingPt = globalStyle.paragraph.leadingPt;
    }

    if (clearRoleLocalOverrides && units.length > 0) {
      const roleUnitIds = new Set(units.filter(u => u.role === role).map(u => u.id));
      next.localOverrides = next.localOverrides.filter(o => !roleUnitIds.has(o.unitId));
    }

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = 'user';
    next.lastModificationSummary = `איפוס סגנון ${globalStyle.displayNameHe} לברירת מחדל גלובלית`;
    return this.syncDerivedViews(next);
  }

  /**
   * Updates Page & Layout settings (`PageLayoutDesignSettings`) and enforces Level 0 boundary laws.
   */
  public static updatePageLayout(
    current: ProfessionalDesignSettings,
    updates: Partial<PageLayoutDesignSettings>,
    actor: 'user' | 'ai' = 'user',
    summary?: string
  ): DesignUpdateSafetyReport {
    const next = this.cloneSettings(current);
    next.pageLayout = {
      ...next.pageLayout,
      ...updates,
    };
    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = summary ?? 'עדכון הגדרות עמוד ושוליים';
    return this.sanitizeAndEnforceHardRules(next);
  }

  /**
   * Updates Rav Text & Dynamic Knee design settings (`RavTextDesignSettings`).
   */
  public static updateRavTextSettings(
    current: ProfessionalDesignSettings,
    updates: Partial<RavTextDesignSettings>,
    actor: 'user' | 'ai' = 'user',
    summary?: string
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    if (updates.dibburBold !== undefined && updates.dibburHamatchilBold === undefined) {
      updates.dibburHamatchilBold = updates.dibburBold;
    }
    if (updates.kneeSettings) {
      updates.kneeMode = updates.kneeSettings.mode;
      if (updates.kneeSettings.upperKneeLines !== undefined) {
        updates.upperCollarLines = updates.kneeSettings.upperKneeLines;
      }
      if (updates.kneeSettings.junctionPercent !== undefined) {
        updates.kneeJunctionPercent = updates.kneeSettings.junctionPercent;
      }
      if (updates.kneeSettings.lowerWidthPercent !== undefined) {
        updates.lowerSourceWidthPercent = updates.kneeSettings.lowerWidthPercent;
      }
      if (updates.kneeSettings.gutterWidth !== undefined) {
        updates.gutterWidthPt = updates.kneeSettings.gutterWidth;
      }
    }
    next.ravText = {
      ...next.ravText,
      ...updates,
    };

    // Keep projectRoleStyles synchronized if fonts or sizes were updated via RavText panel
    if (updates.sourceFontFamily !== undefined || updates.sourceFontSizePt !== undefined || updates.sourceLineSpacingRatio !== undefined) {
      const srcEntry = next.projectRoleStyles.main_source ?? {};
      next.projectRoleStyles.main_source = {
        character: {
          ...(srcEntry.character ?? {}),
          ...(updates.sourceFontFamily !== undefined ? { fontFamily: updates.sourceFontFamily } : {}),
          ...(updates.sourceFontSizePt !== undefined ? { fontSizePt: updates.sourceFontSizePt } : {}),
        },
        paragraph: {
          ...(srcEntry.paragraph ?? {}),
          ...(updates.sourceLineSpacingRatio !== undefined
            ? { lineSpacingRatio: updates.sourceLineSpacingRatio }
            : {}),
        },
      };
    }

    if (updates.rashiFontFamily !== undefined || updates.rashiFontSizePt !== undefined || updates.commentaryLineSpacingRatio !== undefined) {
      const rEntry = next.projectRoleStyles.primary_comment ?? {};
      next.projectRoleStyles.primary_comment = {
        character: {
          ...(rEntry.character ?? {}),
          ...(updates.rashiFontFamily !== undefined ? { fontFamily: updates.rashiFontFamily } : {}),
          ...(updates.rashiFontSizePt !== undefined ? { fontSizePt: updates.rashiFontSizePt } : {}),
        },
        paragraph: {
          ...(rEntry.paragraph ?? {}),
          ...(updates.commentaryLineSpacingRatio !== undefined
            ? { lineSpacingRatio: updates.commentaryLineSpacingRatio }
            : {}),
        },
      };
    }

    if (updates.tosafotFontFamily !== undefined || updates.tosafotFontSizePt !== undefined || updates.commentaryLineSpacingRatio !== undefined) {
      const tEntry = next.projectRoleStyles.secondary_comment ?? {};
      next.projectRoleStyles.secondary_comment = {
        character: {
          ...(tEntry.character ?? {}),
          ...(updates.tosafotFontFamily !== undefined ? { fontFamily: updates.tosafotFontFamily } : {}),
          ...(updates.tosafotFontSizePt !== undefined ? { fontSizePt: updates.tosafotFontSizePt } : {}),
        },
        paragraph: {
          ...(tEntry.paragraph ?? {}),
          ...(updates.commentaryLineSpacingRatio !== undefined
            ? { lineSpacingRatio: updates.commentaryLineSpacingRatio }
            : {}),
        },
      };
    }

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = summary ?? 'עדכון הגדרות רב-טקסט וברכיים';
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  /**
   * Updates Footnote design settings (`FootnoteDesignSettings`).
   */
  public static updateFootnoteSettings(
    current: ProfessionalDesignSettings,
    updates: Partial<FootnoteDesignSettings>,
    actor: 'user' | 'ai' = 'user',
    summary?: string
  ): ProfessionalDesignSettings {
    const next = this.cloneSettings(current);
    if (updates.leadingPt !== undefined && updates.lineSpacingPt === undefined) {
      updates.lineSpacingPt = updates.leadingPt;
    }
    if (updates.showSeparatorLine !== undefined && updates.showSeparatorRule === undefined) {
      updates.showSeparatorRule = updates.showSeparatorLine;
    }
    if (updates.justifyMultiLineNonFinal !== undefined && updates.justifyMultiLineFootnotes === undefined) {
      updates.justifyMultiLineFootnotes = updates.justifyMultiLineNonFinal;
    }
    next.footnotes = {
      ...next.footnotes,
      ...updates,
    };

    const fnEntry = next.projectRoleStyles.footnote ?? {};
    next.projectRoleStyles.footnote = {
      character: {
        ...(fnEntry.character ?? {}),
        ...(updates.fontFamily !== undefined ? { fontFamily: updates.fontFamily } : {}),
        ...(updates.fontSizePt !== undefined ? { fontSizePt: updates.fontSizePt } : {}),
      },
      paragraph: {
        ...(fnEntry.paragraph ?? {}),
        ...(updates.lineSpacingPt !== undefined ? { leadingPt: updates.lineSpacingPt } : {}),
        ...(updates.paragraphSpacingPt !== undefined
          ? { spaceAfterPt: updates.paragraphSpacingPt }
          : {}),
        ...(updates.indentPt !== undefined ? { rightIndentPt: updates.indentPt } : {}),
        ...(updates.justifyMultiLineFootnotes !== undefined
          ? {
              justifyNonFinalLines: updates.justifyMultiLineFootnotes,
              alignment: updates.justifyMultiLineFootnotes ? 'justify' : 'right',
            }
          : {}),
      },
    };

    next.version += 1;
    next.updatedAt = Date.now();
    next.lastModifiedBy = actor;
    next.lastModificationSummary = summary ?? 'עדכון עיצוב הערות שוליים';
    return this.sanitizeAndEnforceHardRules(next).settings;
  }

  /**
   * Converts `ProfessionalDesignSettings` into the `PageGeometry` and `KneeCustomSettings`
   * structures consumed by `PaginationEngine` and `DynamicKneeEngine`.
   */
  public static toEngineGeometryAndKnee(settings: ProfessionalDesignSettings): {
    geometry: PageGeometry;
    kneeSettings: KneeCustomSettings;
  } {
    const pl = settings.pageLayout;
    const rt = settings.ravText;
    return {
      geometry: {
        pageWidth: pl.pageWidthPt,
        pageHeight: pl.pageHeightPt,
        marginTop: pl.marginTopPt,
        marginBottom: pl.marginBottomPt,
        marginInside: pl.marginInsidePt,
        marginOutside: pl.marginOutsidePt,
        isVerso: false,
      },
      kneeSettings: {
        mode: rt.kneeMode,
        upperKneeLines: rt.upperCollarLines,
        upperKneeInwardStep: rt.upperCollarInwardStepPt,
        junctionPercent: rt.kneeJunctionPercent,
        lowerWidthPercent: rt.lowerSourceWidthPercent,
        stepDirection: rt.kneeStepDirection,
        gutterWidth: rt.gutterWidthPt,
      },
    };
  }

  /**
   * Synchronizes `ProfessionalDesignSettings` paragraph flow, Rav Text, and Footnote settings
   * into the `TypesettingRulesConfig` consumed by `PaginationEngine` and `DynamicKneeEngine`.
   */
  public static syncToTypesettingRulesConfig(
    settings: ProfessionalDesignSettings,
    baseConfig?: TypesettingRulesConfig
  ): TypesettingRulesConfig {
    const base = baseConfig ?? TypesettingRulesEngine.createConfig();
    const config: TypesettingRulesConfig = {
      professionalDefaults: TypesettingRulesEngine.getProfessionalDefaults(),
      userRules: {
        rules: Array.isArray(base.userRules?.rules) ? [...base.userRules.rules] : [],
        updatedAt: base.userRules?.updatedAt,
      },
      projectRules: {
        projectId: base.projectRules?.projectId ?? settings.projectId,
        rules: Array.isArray(base.projectRules?.rules) ? [...base.projectRules.rules] : [],
        updatedAt: settings.updatedAt || Date.now(),
      },
      localOverrides: {
        overrides: Array.isArray(base.localOverrides?.overrides)
          ? [...base.localOverrides.overrides]
          : [],
      },
    };

    const upsertProjectRule = (
      ruleId: TypesettingRuleId,
      category: TypesettingRuleCategory,
      value: boolean | number | string,
      description: string
    ) => {
      const id = `design-sync-${ruleId}`;
      const existingCustomRule = config.projectRules.rules.find(
        r => r.ruleId === ruleId && r.id !== id
      );
      if (existingCustomRule) {
        // Respect explicit project rule set via Stage 12 Rules Engine
        return;
      }
      const filtered = config.projectRules.rules.filter(r => r.id !== id);
      filtered.push({
        id,
        ruleId,
        category,
        enabled: true,
        priority: 'PROFESSIONAL_DEFAULT',
        isHardConstraint: false,
        value,
        source: 'project',
        description,
      });
      config.projectRules.rules = filtered;
    };

    const mainPara =
      settings.roleStyles?.main_source?.paragraph ??
      this.resolveRoleAndUnitStyle(settings, 'main_source').paragraph;
    const chapPara =
      settings.roleStyles?.chapter?.paragraph ??
      this.resolveRoleAndUnitStyle(settings, 'chapter').paragraph;

    upsertProjectRule(
      'paragraph.preventWidows',
      'paragraph',
      Boolean(mainPara.preventWidows),
      'מניעת שורות אלמנות מהגדרות עיצוב וטיפוגרפיה'
    );
    upsertProjectRule(
      'paragraph.preventOrphans',
      'paragraph',
      Boolean(mainPara.preventOrphans),
      'מניעת שורות יתומות מהגדרות עיצוב וטיפוגרפיה'
    );
    upsertProjectRule(
      'paragraph.minWidowLines',
      'paragraph',
      Math.max(1, mainPara.minWidowLines ?? 2),
      'מספר שורות מינימלי למניעת אלמנה'
    );
    upsertProjectRule(
      'paragraph.minOrphanLines',
      'paragraph',
      Math.max(1, mainPara.minOrphanLines ?? 2),
      'מספר שורות מינימלי למניעת יתום'
    );
    upsertProjectRule(
      'paragraph.minFinalLineWords',
      'paragraph',
      Math.max(1, mainPara.minFinalLineWords ?? 2),
      'מספר מילים מינימלי בשורת סיום פסקה'
    );
    upsertProjectRule(
      'headings.keepWithNext',
      'headings',
      Boolean(chapPara.keepWithNext || (chapPara.keepWithNextLines ?? 0) > 0),
      'שמירת כותרת עם שורות ההמשך'
    );
    upsertProjectRule(
      'headings.minFollowingLines',
      'headings',
      Math.max(1, chapPara.keepWithNextLines || chapPara.minFollowingLines || 1),
      'מספר שורות המשך מינימלי אחרי כותרת'
    );
    upsertProjectRule(
      'ravText.defaultGutterWidthPt',
      'rav_text',
      Math.max(8, settings.ravText.gutterWidthPt ?? 11),
      'מרווח רב-טקסט (Gutter)'
    );
    upsertProjectRule(
      'lineQuality.minReadableSourceWidthPt',
      'line_quality',
      Math.max(135, settings.ravText.minSourceWidthPt ?? 135),
      'רוחב מקור מינימלי קריא'
    );
    upsertProjectRule(
      'lineQuality.minReadableCommentaryWidthPt',
      'line_quality',
      Math.max(78, settings.ravText.minCommentaryWidthPt ?? 78),
      'רוחב פירוש מינימלי קריא'
    );
    upsertProjectRule(
      'footnotes.justifyMultiLineNonFinal',
      'footnotes',
      Boolean(settings.footnotes.justifyMultiLineFootnotes),
      'יישור דו-צדדי להערות שוליים מרובות שורות'
    );

    return config;
  }

  /**
   * AI Natural-Language Controller:
   * Parses natural-language design & typesetting commands (English & Hebrew) and modifies
   * the exact same `ProfessionalDesignSettings` model used by the UI panel.
   *
   * Supports relative commands ("Make it slightly smaller", "Increase line spacing slightly",
   * "Make the footnotes 1 point smaller") by reading the CURRENT live values in `current`
   * (including any prior manual user changes in the panel!).
   */
  public static applyNaturalLanguageCommand(
    current: ProfessionalDesignSettings,
    instruction: string,
    actor: 'user' | 'ai' = 'ai',
    selectedUnitId?: string
  ): AiDesignCommandResult {
    const lower = instruction.trim().toLowerCase();

    // Check for compound instructions or specific width clamp requests first
    if (
      (lower.includes('רוחב מקור') || lower.includes('source width')) &&
      /\d+/.test(lower)
    ) {
      const m = instruction.match(/(\d+(?:\.\d+)?)/);
      const val = m ? Number(m[1]) : 135;
      const updated = this.updateRavTextSettings(
        current,
        { minSourceWidthPt: val },
        actor,
        `${actor.toUpperCase()}: עדכון רוחב מקור מינימלי`
      );
      return {
        handled: true,
        matched: true,
        summaryHe: `רוחב מקור מינימלי עודכן ל-${updated.ravText.minSourceWidthPt}pt (כפוף לחוק מנוע קשיח Level 0).`,
        summaryEn: `Updated minimum source width to ${updated.ravText.minSourceWidthPt}pt.`,
        updatedSettings: updated,
        clampedByEngineHardRule: updated.ravText.minSourceWidthPt !== val,
        warnings: [],
        requiresPreviewConfirmation: false,
      };
    }

    // Support compound commands joined by "ו" / "and" (e.g. "הגדל את גופן רש״י ל-12pt ומרכז כותרות פרקים")
    if (
      (lower.includes('רש״י') || lower.includes('רשי') || lower.includes('rashi')) &&
      (lower.includes('מרכז') || lower.includes('center')) &&
      (lower.includes('כותרות') || lower.includes('פרק') || lower.includes('chapter'))
    ) {
      const m = instruction.match(/(\d+(?:\.\d+)?)/);
      const rashiSize = m ? Number(m[1]) : 12;
      let step1 = this.updateRoleCharacterStyle(
        current,
        'primary_comment',
        { fontSizePt: rashiSize },
        actor
      );
      let step2 = this.updateRoleParagraphStyle(
        step1,
        'chapter',
        { alignment: 'center', lastLineAlignment: 'center' },
        actor
      );
      step2.lastModifiedBy = actor;
      return {
        handled: true,
        matched: true,
        summaryHe: `גופן רש״י עודכן ל-${rashiSize}pt וכותרות הפרקים ממורכזות.`,
        summaryEn: `Updated Rashi font size to ${rashiSize}pt and centered chapter headings.`,
        updatedSettings: step2,
        clampedByEngineHardRule: false,
        warnings: [],
        requiresPreviewConfirmation: false,
      };
    }

    // Support multi-clause commands separated by commas or "and" / "ו-"
    const clauses = instruction
      .split(/(?:,\s*and\s+|,\s*|\s+and\s+)/i)
      .map(c => c.trim())
      .filter(Boolean);
    if (clauses.length > 1) {
      let working = current;
      let anyHandled = false;
      let anyClamped = false;
      const summariesHe: string[] = [];
      const summariesEn: string[] = [];
      const allWarnings: string[] = [];

      for (const clause of clauses) {
        const subRes = this.applyAiDesignCommand(working, clause, 'main_source');
        if (subRes.handled) {
          anyHandled = true;
          working = subRes.updatedSettings;
          if (subRes.clampedByEngineHardRule) anyClamped = true;
          summariesHe.push(subRes.summaryHe);
          summariesEn.push(subRes.summaryEn);
          allWarnings.push(...subRes.warnings);
        }
      }

      if (anyHandled) {
        working.lastModifiedBy = actor;
        this.syncDerivedViews(working);
        return {
          handled: true,
          matched: true,
          summaryHe: summariesHe.join(' | '),
          summaryEn: summariesEn.join(' | '),
          updatedSettings: working,
          clampedByEngineHardRule: anyClamped,
          warnings: allWarnings,
          requiresPreviewConfirmation: clauses.length >= 2,
        };
      }
    }

    const res = this.applyAiDesignCommand(current, instruction, 'main_source');
    if (res.handled) {
      res.updatedSettings.lastModifiedBy = actor;
      this.syncDerivedViews(res.updatedSettings);
    }
    return {
      ...res,
      matched: res.handled,
    };
  }

  public static applyAiDesignCommand(
    current: ProfessionalDesignSettings,
    instruction: string,
    activeRoleContext: ContentRole = 'regular_paragraph'
  ): AiDesignCommandResult {
    const text = instruction.trim();
    const lower = text.toLowerCase();

    // Detect if the user or AI is attempting to invent/auto-add ornaments without explicit user asset
    if (
      (lower.includes('ornament') || lower.includes('עיטור') || lower.includes('decorative')) &&
      (lower.includes('auto') ||
        lower.includes('invent') ||
        lower.includes('add') ||
        lower.includes('הוסף') ||
        lower.includes('אוטומט'))
    ) {
      return {
        handled: true,
        matched: true,
        summaryHe:
          'נחסם ע״י חוק מנוע קשיח (LEVEL 0 — Stage 11D): המערכת אינה ממציאה או מוסיפה עיטורים אוטומטית ללא בחירת קובץ עיטור מפורשת ע״י המשתמש.',
        summaryEn:
          'Blocked by Level 0 Engine Hard Rule (Stage 11D): Unauthorized automatic ornament invention is forbidden.',
        updatedSettings: this.cloneSettings(current),
        clampedByEngineHardRule: true,
        warnings: [
          'חוק מנוע קשיח (LEVEL 0 — ORNAMENT_SAFETY): לעולם אין להמציא או לבחור עיטור אוטומטית ללא בחירת משתמש.',
        ],
        requiresPreviewConfirmation: false,
      };
    }

    // Identify target role from instruction
    let targetRole: ContentRole | null = null;
    if (lower.includes('body') || lower.includes('גוף') || lower.includes('פסקה')) {
      targetRole = 'regular_paragraph';
    } else if (
      lower.includes('source') ||
      lower.includes('גמרא') ||
      lower.includes('מקור')
    ) {
      targetRole = 'main_source';
    } else if (
      lower.includes('chapter') ||
      lower.includes('heading') ||
      lower.includes('title') ||
      lower.includes('כותרת') ||
      lower.includes('פרק')
    ) {
      targetRole = 'chapter';
    } else if (
      lower.includes('footnote') ||
      lower.includes('הערות שוליים') ||
      lower.includes('הערת שוליים')
    ) {
      targetRole = 'footnote';
    } else if (
      lower.includes('rashi') ||
      lower.includes('commentary') ||
      lower.includes('רש״י') ||
      lower.includes('רשי') ||
      lower.includes('פירוש') ||
      lower.includes('מפרשים')
    ) {
      targetRole = 'primary_comment';
    } else if (lower.includes('tosafot') || lower.includes('תוספות')) {
      targetRole = 'secondary_comment';
    } else if (lower.includes('dibbur') || lower.includes('דיבור המתחיל')) {
      targetRole = 'dibbur_hamatchil';
    }

    const effectiveRole: ContentRole =
      targetRole ??
      (current.projectRoleStyles.regular_paragraph
        ? 'regular_paragraph'
        : activeRoleContext);

    const currentRoleResolved = this.resolveRoleAndUnitStyle(current, effectiveRole);

    // Extract numeric value if present
    const numMatch = text.match(/(-?\d+(?:\.\d+)?)/);
    const parsedNum = numMatch ? Number(numMatch[1]) : undefined;

    // 1. Font Family changes (e.g., "Use Frank Ruhl Libre for the commentary", "Use David Libre for body")
    for (const fontEntry of KNOWN_HOLY_BOOK_FONTS) {
      if (lower.includes(fontEntry.family.toLowerCase())) {
        const roleToUpdate = targetRole ?? 'primary_comment';
        const report = this.updateRoleStyle(
          current,
          roleToUpdate,
          { character: { fontFamily: fontEntry.family } },
          'ai',
          `AI: שינוי גופן ${GLOBAL_ROLE_STYLES[roleToUpdate].displayNameHe} ל-${fontEntry.family}`
        );
        return {
          handled: true,
          matched: true,
          summaryHe: `הגופן של ${GLOBAL_ROLE_STYLES[roleToUpdate].displayNameHe} עודכן ל-"${fontEntry.family}".`,
          summaryEn: `Updated ${roleToUpdate} font family to "${fontEntry.family}".`,
          updatedSettings: report.settings,
          clampedByEngineHardRule: report.clampedByEngineHardRule,
          warnings: report.warnings,
          requiresPreviewConfirmation: false,
        };
      }
    }

    // 2. Column Gutter / Rav Text Gutter changes ("Reduce the gutter between the two columns", "צמצם רווח עמודות")
    if (lower.includes('gutter') || lower.includes('בין הטורים') || lower.includes('מרווח עמודות') || lower.includes('רווח בין')) {
      if (lower.includes('two column') || lower.includes('שני טורים') || lower.includes('columns')) {
        const nextGutter =
          parsedNum !== undefined
            ? parsedNum
            : lower.includes('reduce') || lower.includes('צמצם') || lower.includes('smaller')
            ? Math.max(6, current.pageLayout.columnGutterPt - 2)
            : current.pageLayout.columnGutterPt + 2;
        const report = this.updatePageLayout(
          current,
          { columnGutterPt: nextGutter },
          'ai',
          `AI: עדכון מרווח בין שני הטורים ל-${nextGutter}pt`
        );
        return {
          handled: true,
          matched: true,
          summaryHe: `המרווח בין הטורים עודכן ל-${report.settings.pageLayout.columnGutterPt}pt.`,
          summaryEn: `Updated column gutter to ${report.settings.pageLayout.columnGutterPt}pt.`,
          updatedSettings: report.settings,
          clampedByEngineHardRule: report.clampedByEngineHardRule,
          warnings: report.warnings,
          requiresPreviewConfirmation: false,
        };
      } else {
        const nextRavGutter =
          parsedNum !== undefined
            ? parsedNum
            : lower.includes('reduce') || lower.includes('צמצם') || lower.includes('smaller')
            ? Math.max(8, current.ravText.gutterWidthPt - 1.5)
            : current.ravText.gutterWidthPt + 1.5;
        const updated = this.updateRavTextSettings(
          current,
          { gutterWidthPt: nextRavGutter },
          'ai',
          `AI: עדכון מרווח רב-טקסט ל-${nextRavGutter}pt`
        );
        return {
          handled: true,
          matched: true,
          summaryHe: `המרווח בין המקור למפרשים (Gutter) עודכן ל-${updated.ravText.gutterWidthPt}pt.`,
          summaryEn: `Updated Rav Text gutter to ${updated.ravText.gutterWidthPt}pt.`,
          updatedSettings: updated,
          clampedByEngineHardRule: updated.ravText.gutterWidthPt !== nextRavGutter,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
    }

    // 3. Compact Layout preset ("Use a more compact layout", "עימוד צפוף יותר")
    if (lower.includes('compact') || lower.includes('צפוף')) {
      const next = this.cloneSettings(current);
      next.ravText.sourceLineSpacingRatio = Number(
        Math.max(1.12, next.ravText.sourceLineSpacingRatio - 0.08).toFixed(2)
      );
      next.ravText.commentaryLineSpacingRatio = Number(
        Math.max(1.12, next.ravText.commentaryLineSpacingRatio - 0.08).toFixed(2)
      );
      next.ravText.gutterWidthPt = Math.max(8, next.ravText.gutterWidthPt - 1.5);
      next.pageLayout.columnGutterPt = Math.max(10, next.pageLayout.columnGutterPt - 2);
      next.version += 1;
      next.updatedAt = Date.now();
      next.lastModifiedBy = 'ai';
      next.lastModificationSummary = 'AI: מעבר לעימוד קומפקטי וצפוף יותר';
      const report = this.sanitizeAndEnforceHardRules(next);
      return {
        handled: true,
        matched: true,
        summaryHe: 'הוחל עימוד קומפקטי יותר (צמצום עדין של מרווחי שורות ומרווחי טורים תוך שמירה על חוקי המנוע).',
        summaryEn: 'Applied compact layout adjustments to line spacing and gutters.',
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: true,
      };
    }

    // 4. Paragraph spacing ("paragraph spacing", "space after", "מרווח פסקאות", "רווח בין פסקאות")
    if (
      lower.includes('paragraph spacing') ||
      lower.includes('space after') ||
      lower.includes('space before') ||
      lower.includes('מרווח פסקאות') ||
      lower.includes('רווח בין פסקאות')
    ) {
      const curAfter = currentRoleResolved.paragraph.spaceAfterPt;
      const nextAfter =
        parsedNum !== undefined
          ? parsedNum
          : lower.includes('increase') || lower.includes('larger') || lower.includes('הגדל')
          ? Number((curAfter + 2).toFixed(1))
          : lower.includes('decrease') || lower.includes('smaller') || lower.includes('הקטן')
          ? Math.max(0, Number((curAfter - 1.5).toFixed(1)))
          : Number((curAfter + 2).toFixed(1));

      const report = this.updateRoleStyle(
        current,
        effectiveRole,
        { paragraph: { spaceAfterPt: nextAfter } },
        'ai',
        `AI: עדכון מרווח אחרי פסקה ל-${nextAfter}pt`
      );
      const finalVal = this.resolveRoleAndUnitStyle(report.settings, effectiveRole).paragraph.spaceAfterPt;
      return {
        handled: true,
        matched: true,
        summaryHe: `מרווח הפסקאות של ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} עודכן ל-${finalVal}pt.`,
        summaryEn: `Updated ${effectiveRole} paragraph spacing to ${finalVal}pt.`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: false,
      };
    }

    // 5. Line spacing / Leading ("Increase the line spacing slightly", "מרווח שורות")
    if (
      lower.includes('line spacing') ||
      lower.includes('leading') ||
      lower.includes('מרווח שורות') ||
      lower.includes('גובה שורה')
    ) {
      const curRatio = currentRoleResolved.paragraph.lineSpacingRatio;
      let nextRatio = curRatio;
      if (parsedNum !== undefined) {
        if (parsedNum > 4) {
          // Provided in points (leadingPt)
          nextRatio = Number(
            (parsedNum / Math.max(1, currentRoleResolved.character.fontSizePt)).toFixed(2)
          );
        } else {
          nextRatio = parsedNum;
        }
      } else if (lower.includes('slightly') || lower.includes('מעט')) {
        nextRatio =
          lower.includes('decrease') || lower.includes('smaller') || lower.includes('הקטן')
            ? Number((curRatio - 0.05).toFixed(2))
            : Number((curRatio + 0.06).toFixed(2));
      } else if (lower.includes('decrease') || lower.includes('smaller') || lower.includes('הקטן')) {
        nextRatio = Number((curRatio - 0.1).toFixed(2));
      } else {
        nextRatio = Number((curRatio + 0.1).toFixed(2));
      }

      const nextLeading = Number(
        (currentRoleResolved.character.fontSizePt * nextRatio).toFixed(2)
      );
      const report = this.updateRoleStyle(
        current,
        effectiveRole,
        { paragraph: { lineSpacingRatio: nextRatio, leadingPt: nextLeading } },
        'ai',
        `AI: עדכון מרווח שורות ל-${nextRatio}x (${nextLeading}pt)`
      );
      const finalPara = this.resolveRoleAndUnitStyle(report.settings, effectiveRole).paragraph;
      return {
        handled: true,
        matched: true,
        summaryHe: `מרווח השורות של ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} עודכן ל-${finalPara.lineSpacingRatio} (${finalPara.leadingPt}pt).`,
        summaryEn: `Updated ${effectiveRole} line spacing to ${finalPara.lineSpacingRatio} (${finalPara.leadingPt}pt).`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: false,
      };
    }

    // 6. Rav Text / Upper Collar / Knee settings via AI
    if (
      lower.includes('rav text') ||
      lower.includes('upper collar') ||
      lower.includes('knee') ||
      lower.includes('ברך') ||
      lower.includes('רב-טקסט')
    ) {
      if (lower.includes('collar') || lower.includes('עליונה') || lower.includes('upper')) {
        const nextLines =
          parsedNum !== undefined ? Math.round(parsedNum) : current.ravText.upperCollarLines + 1;
        const updated = this.updateRavTextSettings(
          current,
          { upperCollarLines: nextLines },
          'ai',
          `AI: עדכון שורות ברך עליונה ל-${nextLines}`
        );
        return {
          handled: true,
          matched: true,
          summaryHe: `מספר שורות הברך העליונה ברב-טקסט עודכן ל-${updated.ravText.upperCollarLines}.`,
          summaryEn: `Updated Rav Text upper collar lines to ${updated.ravText.upperCollarLines}.`,
          updatedSettings: updated,
          clampedByEngineHardRule: updated.ravText.upperCollarLines !== nextLines,
          warnings: [],
          requiresPreviewConfirmation: false,
        };
      }
      const nextJunction =
        parsedNum !== undefined
          ? parsedNum > 100
            ? Math.round((parsedNum / current.pageLayout.pageHeightPt) * 100)
            : parsedNum
          : Math.min(75, current.ravText.kneeJunctionPercent + 6);
      const updated = this.updateRavTextSettings(
        current,
        { kneeJunctionPercent: nextJunction },
        'ai',
        `AI: כוונון צומת ברך ל-${nextJunction}%`
      );
      return {
        handled: true,
        matched: true,
        summaryHe: `צומת הברך ברב-טקסט עודכן ל-${updated.ravText.kneeJunctionPercent}%.`,
        summaryEn: `Updated Rav Text knee junction to ${updated.ravText.kneeJunctionPercent}%.`,
        updatedSettings: updated,
        clampedByEngineHardRule: updated.ravText.kneeJunctionPercent !== nextJunction,
        warnings: [],
        requiresPreviewConfirmation: false,
      };
    }

    // 7. Font Size / Relative Size changes:
    if (
      lower.includes('point') ||
      lower.includes('pt') ||
      lower.includes('size') ||
      lower.includes('smaller') ||
      lower.includes('larger') ||
      lower.includes('bigger') ||
      lower.includes('גודל') ||
      lower.includes('נקודות') ||
      lower.includes('הגדל') ||
      lower.includes('הקטן')
    ) {
      const curSize = currentRoleResolved.character.fontSizePt;
      let nextSize = curSize;

      const isDeltaSmaller =
        (lower.includes('smaller') || lower.includes('reduce') || lower.includes('הקטן')) &&
        parsedNum !== undefined &&
        parsedNum <= 5 &&
        (lower.includes('smaller') || lower.includes('by ') || lower.includes('ב-'));
      const isDeltaLarger =
        (lower.includes('larger') || lower.includes('bigger') || lower.includes('increase') || lower.includes('הגדל')) &&
        parsedNum !== undefined &&
        parsedNum <= 5 &&
        (lower.includes('larger') || lower.includes('bigger') || lower.includes('by ') || lower.includes('ב-'));

      if (isDeltaSmaller && parsedNum !== undefined) {
        nextSize = Number((curSize - parsedNum).toFixed(2));
      } else if (isDeltaLarger && parsedNum !== undefined) {
        nextSize = Number((curSize + parsedNum).toFixed(2));
      } else if (parsedNum !== undefined) {
        nextSize = parsedNum;
      } else if (lower.includes('slightly smaller') || lower.includes('קטן מעט')) {
        nextSize = Number((curSize - 0.25).toFixed(2));
      } else if (lower.includes('slightly larger') || lower.includes('slightly bigger') || lower.includes('גדול מעט')) {
        nextSize = Number((curSize + 0.25).toFixed(2));
      } else if (lower.includes('smaller') || lower.includes('הקטן')) {
        nextSize = Number((curSize - 1.0).toFixed(2));
      } else if (lower.includes('larger') || lower.includes('bigger') || lower.includes('הגדל')) {
        nextSize = Number((curSize + 1.5).toFixed(2));
      }

      const charUpdate: Partial<CharacterStyleSettings> = { fontSizePt: nextSize };
      if (
        (effectiveRole === 'chapter' || effectiveRole === 'heading' || effectiveRole === 'main_title') &&
        (lower.includes('bold') || lower.includes('מודגש') || lower.includes('heading'))
      ) {
        charUpdate.isBold = true;
        charUpdate.fontWeight = 700;
      }

      const report = this.updateRoleStyle(
        current,
        effectiveRole,
        { character: charUpdate },
        'ai',
        `AI: שינוי גודל גופן ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} ל-${nextSize}pt`
      );
      const finalSize = this.resolveRoleAndUnitStyle(report.settings, effectiveRole).character.fontSizePt;

      return {
        handled: true,
        matched: true,
        summaryHe: `גודל הגופן של ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} עודכן מ-${curSize}pt ל-${finalSize}pt.`,
        summaryEn: `Updated ${effectiveRole} font size from ${curSize}pt to ${finalSize}pt.`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: false,
      };
    }

    // 8. Alignment changes via AI
    if (
      lower.includes('center') ||
      lower.includes('justify') ||
      lower.includes('align right') ||
      lower.includes('align left') ||
      lower.includes('ממורכז') ||
      lower.includes('מרכז') ||
      lower.includes('יישור')
    ) {
      let align: DesignAlignment = 'justify';
      if (lower.includes('center') || lower.includes('ממורכז') || lower.includes('מרכז')) align = 'center';
      else if (lower.includes('right') || lower.includes('ימין')) align = 'right';
      else if (lower.includes('left') || lower.includes('שמאל')) align = 'left';

      const report = this.updateRoleStyle(
        current,
        effectiveRole,
        { paragraph: { alignment: align } },
        'ai',
        `AI: שינוי יישור ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} ל-${align}`
      );
      return {
        handled: true,
        matched: true,
        summaryHe: `היישור של ${GLOBAL_ROLE_STYLES[effectiveRole].displayNameHe} עודכן ל-${align}.`,
        summaryEn: `Updated ${effectiveRole} alignment to ${align}.`,
        updatedSettings: report.settings,
        clampedByEngineHardRule: report.clampedByEngineHardRule,
        warnings: report.warnings,
        requiresPreviewConfirmation: false,
      };
    }

    return {
      handled: false,
      matched: false,
      summaryHe: 'הפקודה לא זוהתה כשינוי עיצוב ישיר.',
      summaryEn: 'Command did not match a direct design setting.',
      updatedSettings: this.cloneSettings(current),
      clampedByEngineHardRule: false,
      warnings: [],
      requiresPreviewConfirmation: false,
    };
  }
}
