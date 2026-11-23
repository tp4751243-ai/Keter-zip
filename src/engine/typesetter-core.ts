/**
 * Keter Core Typesetter Engine
 * Performs exact glyph advance line-breaking, paragraph composition,
 * and RTL right-aligned holy-book justification.
 */

import {
  ContentRole,
  ContentUnit,
  ParagraphIndentMode,
  ShapedWord,
  TextRun,
  TypesetLine,
} from '../types/typesetter';
import { HarfBuzzShaperEngine } from './harfbuzz-emulator';
import { DocxImporter } from './docx-importer';
import {
  TypesettingRulesConfig,
  TypesettingRulesEngine,
} from './typesetting-rules-engine';
import { ParagraphStyleSettings, ProfessionalDesignSettings } from '../types/design-settings';
import { DesignSettingsEngine } from './design-settings-engine';

/**
 * Shared RTL indentation resolver for paragraph lines.
 * Keeps `hangingIndentPt` cleanly separate from `rightIndentPt` while supporting
 * standard, hanging, and Chalon ("window") second-line / multi-line indentation.
 * Chalon modes (v0.9.9 I2): 'chalon_second_line' indents line 2 only,
 * 'chalon_window' indents lines 2..1+chalonLineCount, 'chalon_all'
 * indents line 2 onward. All three read the chalon amount
 * (`chalonIndentPt`, default 18pt) — never the hanging amount.
 */
export function computeParagraphLineIndents(
  p: Partial<
    Pick<
      ParagraphStyleSettings,
      | 'firstLineIndentPt'
      | 'hangingIndentPt'
      | 'rightIndentPt'
      | 'leftIndentPt'
      | 'indentMode'
      | 'chalonIndentPt'
      | 'chalonLineCount'
    >
  >,
  lineIndexInUnit: number
): {
  firstLineIndentPt: number;
  hangingIndentPt: number;
  rightIndentPt: number;
  leftIndentPt: number;
} {
  const baseRight = Math.max(0, p.rightIndentPt || 0);
  const baseLeft = Math.max(0, p.leftIndentPt || 0);
  const rawFirst = Math.max(0, p.firstLineIndentPt || 0);
  const rawHang = Math.max(0, p.hangingIndentPt || 0);
  const mode: ParagraphIndentMode | undefined = p.indentMode;

  if (!mode) {
    return {
      firstLineIndentPt: lineIndexInUnit === 0 ? rawFirst : 0,
      hangingIndentPt: lineIndexInUnit >= 1 ? rawHang : 0,
      rightIndentPt: baseRight,
      leftIndentPt: baseLeft,
    };
  }

  const chalonPts = Math.max(0, p.chalonIndentPt ?? (rawHang > 0 ? rawHang : 18));
  const chalonLines = Math.max(1, Math.min(6, Math.round(p.chalonLineCount ?? 2)));

  let firstLineIndentPt = 0;
  let hangingIndentPt = 0;
  if (mode === 'first_line') {
    firstLineIndentPt = lineIndexInUnit === 0 ? rawFirst : 0;
  } else if (mode === 'hanging') {
    hangingIndentPt = lineIndexInUnit >= 1 ? rawHang : 0;
  } else if (mode === 'chalon_second_line') {
    hangingIndentPt = lineIndexInUnit === 1 ? chalonPts : 0;
  } else if (mode === 'chalon_window') {
    hangingIndentPt = lineIndexInUnit >= 1 && lineIndexInUnit <= chalonLines ? chalonPts : 0;
  } else if (mode === 'chalon_all') {
    // v0.9.9 (I2): chalon "line 2 onward" — every line after the first
    // takes the chalon indent. Distinct from 'hanging' (which uses the
    // hangingIndentPt amount) and from 'chalon_second_line' (line 2
    // only) / 'chalon_window' (lines 2..1+count). The catalog leaves
    // "second line only vs all following lines" ambiguous (§B4), so all
    // three chalon readings are offered and the default mode is 'none'.
    hangingIndentPt = lineIndexInUnit >= 1 ? chalonPts : 0;
  }

  return {
    firstLineIndentPt,
    hangingIndentPt,
    rightIndentPt: baseRight,
    leftIndentPt: baseLeft,
  };
}

import { TEAMIM_FALLBACK_FONT, fontLacksTeamim, wordHasTeamim } from './font-analyzer';

export class TypesetterEngine {
  private shaper: HarfBuzzShaperEngine;
  private rulesConfig?: TypesettingRulesConfig;
  private designSettings?: ProfessionalDesignSettings;
  private defaultFontSize: number;

  constructor(
    fontSize: number = 14,
    rulesConfig?: TypesettingRulesConfig,
    designSettings?: ProfessionalDesignSettings
  ) {
    this.defaultFontSize = fontSize;
    this.shaper = new HarfBuzzShaperEngine(fontSize);
    this.rulesConfig = rulesConfig;
    this.designSettings = designSettings;
  }

  public setDesignSettings(designSettings?: ProfessionalDesignSettings) {
    this.designSettings = designSettings;
  }

  public getDesignSettings(): ProfessionalDesignSettings | undefined {
    return this.designSettings;
  }

  public setRulesConfig(rulesConfig?: TypesettingRulesConfig) {
    this.rulesConfig = rulesConfig;
  }

  public getRulesConfig(): TypesettingRulesConfig | undefined {
    return this.rulesConfig;
  }

  public setFontSize(fontSize: number) {
    this.defaultFontSize = fontSize;
    this.shaper.setFontSize(fontSize);
  }

  public getShaper(): HarfBuzzShaperEngine {
    return this.shaper;
  }

  /**
   * Shapes a single ContentUnit into non-space ShapedWords while preserving:
   * - unitId, role, linkedSourceId
   * - TextRun formatting (isBold, isItalic, isUnderline)
   * - Dibbur HaMatchil words (isDibbur = true, isBold = true for all words in the Dibbur)
   * - Paragraph end boundary (isParagraphEnd = true on the last word of the unit)
   */
  public shapeContentUnit(unit: ContentUnit): ShapedWord[] {
    const runs: TextRun[] =
      unit.textRuns && unit.textRuns.length > 0
        ? unit.textRuns
        : DocxImporter.buildRunsFromRawText(unit.rawText, unit.role, unit.dibburHamatchil);

    const words: ShapedWord[] = [];
    let globalWordIndex = 0;

    for (const run of runs) {
      const tokens = run.text.trim().split(/\s+/).filter(Boolean);
      for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
        const token = tokens[tIdx];

        let resolvedChar = undefined;
        if (this.designSettings) {
          const effRole = run.isDibbur ? 'dibbur_hamatchil' : unit.role;
          resolvedChar = DesignSettingsEngine.resolveRoleAndUnitStyle(
            this.designSettings,
            effRole,
            unit.id,
            globalWordIndex
          ).character;
          this.shaper.setFontFamily(resolvedChar.fontFamily);
          this.shaper.setFontSize(resolvedChar.fontSizePt);
          this.shaper.setFontWeight(resolvedChar.fontWeight);
          this.shaper.setTrackingEm(resolvedChar.trackingEm);
          this.shaper.setHorizontalScalePercent(resolvedChar.horizontalScalePercent);
          this.shaper.setWordSpacingRatio(resolvedChar.wordSpacingRatio);
          this.shaper.setOpenTypeFeatures(resolvedChar.openTypeFeatures);
        }

        // v0.9.8 Phase 2 — run-level semantic rendering, overriding the
        // resolved role style for this run only: citation spans render
        // slightly smaller (×0.85), Rema glosses in Rashi script.
        // The dibbur role style above is untouched (isDibbur wins the
        // role; a dibbur is never also a citation/rema run).
        let runFontFamily = resolvedChar?.fontFamily;
        let runFontSizePt = resolvedChar?.fontSizePt;
        if (run.isCitation && runFontSizePt) {
          runFontSizePt = Number((runFontSizePt * 0.85).toFixed(2));
        }
        if (run.isRemaGloss) runFontFamily = 'Noto Rashi Hebrew';
        // Layout training T3.6 — a word with teamim is set whole in a font
        // that has them when the run's font has none (never mark-by-mark).
        if (wordHasTeamim(token) && fontLacksTeamim(runFontFamily ?? resolvedChar?.fontFamily)) {
          runFontFamily = TEAMIM_FALLBACK_FONT;
        }
        if (runFontFamily) this.shaper.setFontFamily(runFontFamily);
        if (runFontSizePt) this.shaper.setFontSize(runFontSizePt);

        const effectiveIsBold = resolvedChar
          ? Boolean(resolvedChar.isBold || (!run.isDibbur && run.isBold))
          : Boolean(run.isBold || run.isDibbur);

        const shaped = this.shaper.shapeWord(token, {
          isBold: effectiveIsBold,
          isItalic: Boolean(run.isItalic || resolvedChar?.isItalic),
          isDibbur: Boolean(run.isDibbur),
          unitId: unit.id,
          baselineShiftPt: resolvedChar?.baselineShiftPt,
        });
        shaped.unitId = unit.id;
        shaped.role = unit.role;
        shaped.linkedSourceId = unit.linkedSourceId;
        if (unit.linkedSourceId) {
          shaped.linkId = `link-${unit.id}-${unit.linkedSourceId}`;
        }
        shaped.isBold = effectiveIsBold;
        if (run.isDibbur) shaped.isDibbur = true;
        if (run.isCitation) shaped.isCitation = true;
        if (run.isRemaGloss) shaped.isRemaGloss = true;
        if (run.isItalic || resolvedChar?.isItalic) shaped.isItalic = true;
        if (run.isUnderline || resolvedChar?.isUnderline) shaped.isUnderline = true;
        if (resolvedChar) {
          shaped.fontFamily = runFontFamily ?? resolvedChar.fontFamily;
          shaped.fontSizePt = runFontSizePt ?? resolvedChar.fontSizePt;
          shaped.fontWeight = effectiveIsBold ? Math.max(700, resolvedChar.fontWeight) : resolvedChar.fontWeight;
          shaped.trackingEm = resolvedChar.trackingEm;
          shaped.wordSpacingRatio = resolvedChar.wordSpacingRatio;
          shaped.horizontalScalePercent = resolvedChar.horizontalScalePercent;
          shaped.baselineShiftPt = resolvedChar.baselineShiftPt;
          shaped.textColor = resolvedChar.textColor;
        }
        // If this TextRun carries a DOCX <w:footnoteReference>, attach it to the anchored word of the run
        if (run.footnoteMarker !== undefined && tIdx === tokens.length - 1) {
          shaped.footnoteMarker = run.footnoteMarker;
          shaped.footnoteUnitId = run.footnoteUnitId;
        }
        words.push(shaped);
        globalWordIndex++;
      }
    }

    // Restore base shaper font size if designSettings temporarily modified it
    if (this.designSettings) {
      this.shaper.setFontSize(this.defaultFontSize);
      this.shaper.setTrackingEm(0);
      this.shaper.setHorizontalScalePercent(100);
      this.shaper.setWordSpacingRatio(1.0);
    }

    if (words.length > 0) {
      words[words.length - 1].isParagraphEnd = true;
    }

    return words;
  }

  /**
   * Shapes an ordered array of ContentUnits into a structured sequence of ShapedWords
   * without flattening or losing unit identity, Dibbur HaMatchil, or link associations.
   */
  public shapeUnitSequence(units: ContentUnit[]): ShapedWord[] {
    const allWords: ShapedWord[] = [];
    for (const unit of units) {
      allWords.push(...this.shapeContentUnit(unit));
    }
    return allWords;
  }

  /**
   * Typesets a single ContentUnit into lines while preserving its TextRuns and Dibbur HaMatchil
   */
  public typesetContentUnit(
    unit: ContentUnit,
    targetWidth: number,
    lineHeight?: number,
    justify: boolean = true
  ): TypesetLine[] {
    const unitWords = this.shapeContentUnit(unit);
    if (unitWords.length === 0 || targetWidth <= 10) return [];
    return this.typesetShapedWords(
      unitWords,
      targetWidth,
      unit.role,
      unit.id,
      lineHeight,
      justify
    );
  }

  /**
   * Composes pre-shaped words (preserving isDibbur, isBold, unitId, linkedSourceId, isParagraphEnd)
   * into justified TypesetLines.
   */
  public typesetShapedWords(
    nonSpaceWords: ShapedWord[],
    targetWidth: number,
    defaultRole: ContentRole = 'main_source',
    defaultUnitId: string = 'unit-1',
    lineHeight?: number,
    justify: boolean = true
  ): TypesetLine[] {
    if (nonSpaceWords.length === 0 || targetWidth <= 10) return [];

    const effectiveLineHeight = lineHeight ?? this.shaper.getLineHeight();
    const spaceWord = this.shaper.shapeWord(' ');
    const lines: TypesetLine[] = [];
    let currentWords: ShapedWord[] = [];
    let currentWidth = 0;
    let lineIdx = 0;

    const isolateHeadingRule = TypesettingRulesEngine.resolveRule<boolean>(
      'headings.isolateFromBodyLine',
      { role: defaultRole, unitId: defaultUnitId },
      this.rulesConfig
    );
    const neverJustifyHeadingRule = TypesettingRulesEngine.resolveRule<boolean>(
      'headings.neverJustifyHeading',
      { role: defaultRole, unitId: defaultUnitId },
      this.rulesConfig
    );
    const maxDeficitRule = TypesettingRulesEngine.resolveRule<number>(
      'lineQuality.maxJustifyDeficitRatioStandard',
      { role: defaultRole, unitId: defaultUnitId },
      this.rulesConfig
    );
    const minFinalWordsRule = TypesettingRulesEngine.resolveRule<number>(
      'paragraph.minFinalLineWords',
      { role: defaultRole, unitId: defaultUnitId },
      this.rulesConfig
    );

    for (let i = 0; i < nonSpaceWords.length; i++) {
      const word = nonSpaceWords[i];
      const prevNonSpace =
        currentWords.length > 0 ? currentWords[currentWords.length - 1] : null;

      // If unitId changed and previous unit was a heading/chapter, force a line break!
      const forceParagraphBreak =
        Boolean(isolateHeadingRule.value) &&
        prevNonSpace &&
        prevNonSpace.unitId !== word.unitId &&
        (prevNonSpace.role === 'chapter' ||
          prevNonSpace.role === 'heading' ||
          prevNonSpace.role === 'main_title' ||
          prevNonSpace.role === 'siman' ||
          word.role === 'chapter' ||
          word.role === 'heading');

      const candidateRole = currentWords.length > 0 ? (currentWords[0].role ?? defaultRole) : (word.role ?? defaultRole);
      const candidateUnitId = currentWords.length > 0 ? (currentWords[0].unitId ?? defaultUnitId) : (word.unitId ?? defaultUnitId);
      let lineIndexInUnit = 0;
      for (let li = lines.length - 1; li >= 0 && lines[li].unitId === candidateUnitId; li--) {
        lineIndexInUnit++;
      }
      let lineAvailableWidth = targetWidth;
      let unitSpaceWidth = spaceWord.width;
      if (this.designSettings) {
        const resStyle = DesignSettingsEngine.resolveStyle(this.designSettings, {
          role: candidateRole,
          unitId: candidateUnitId,
        });
        const ind = computeParagraphLineIndents(resStyle.paragraph, lineIndexInUnit);
        lineAvailableWidth = Math.max(
          40,
          targetWidth - ind.firstLineIndentPt - ind.hangingIndentPt - ind.rightIndentPt - ind.leftIndentPt
        );
        const wsRatio = word.wordSpacingRatio ?? resStyle.character.wordSpacingRatio ?? 1.0;
        const fSize = word.fontSizePt ?? resStyle.character.fontSizePt ?? this.defaultFontSize;
        unitSpaceWidth = Math.max(1.5, fSize * 0.32 * wsRatio);
      }

      const spaceNeeded = currentWords.length > 0 ? unitSpaceWidth : 0;

      if (
        (forceParagraphBreak || currentWidth + spaceNeeded + word.width > lineAvailableWidth) &&
        currentWords.length > 0
      ) {
        const lineRole = currentWords[0].role ?? defaultRole;
        const lineUnitId = currentWords[0].unitId ?? defaultUnitId;
        const isHeadingLine =
          Boolean(neverJustifyHeadingRule.value) &&
          (lineRole === 'chapter' || lineRole === 'heading' || lineRole === 'main_title');
        const spaceCount = currentWords.filter(w => w.isSpace).length;
        const deficit = lineAvailableWidth - currentWidth;
        let extraSpace = 0;
        let isJustified = false;

        if (
          justify &&
          !isHeadingLine &&
          !forceParagraphBreak &&
          spaceCount > 0 &&
          deficit > 0 &&
          deficit < lineAvailableWidth * maxDeficitRule.value
        ) {
          extraSpace = deficit / spaceCount;
          isJustified = true;
          currentWidth = lineAvailableWidth;
        }

        lines.push({
          lineIndex: lineIdx++,
          words: [...currentWords],
          width: currentWidth,
          targetWidth: lineAvailableWidth,
          xStart: 0,
          yBaseline: 0,
          height: effectiveLineHeight,
          ascent: this.shaper.getAscent(),
          descent: this.shaper.getDescent(),
          isLastLine: Boolean(forceParagraphBreak),
          isJustified,
          extraSpacePerWord: extraSpace,
          role: lineRole,
          unitId: lineUnitId,
        });

        currentWords = [word];
        currentWidth = word.width;
      } else {
        if (currentWords.length > 0) {
          currentWords.push({ ...spaceWord, width: unitSpaceWidth });
          currentWidth += unitSpaceWidth;
        }
        currentWords.push(word);
        currentWidth += word.width;
      }
    }

    if (currentWords.length > 0) {
      const lineRole = currentWords[0].role ?? defaultRole;
      const lineUnitId = currentWords[0].unitId ?? defaultUnitId;
      let lineIndexInUnit = 0;
      for (let li = lines.length - 1; li >= 0 && lines[li].unitId === lineUnitId; li--) {
        lineIndexInUnit++;
      }
      let lastLineAvailableWidth = targetWidth;
      if (this.designSettings) {
        const resPara = DesignSettingsEngine.resolveStyle(this.designSettings, {
          role: lineRole,
          unitId: lineUnitId,
        }).paragraph;
        const ind = computeParagraphLineIndents(resPara, lineIndexInUnit);
        lastLineAvailableWidth = Math.max(
          40,
          targetWidth - ind.firstLineIndentPt - ind.hangingIndentPt - ind.rightIndentPt - ind.leftIndentPt
        );
      }
      lines.push({
        lineIndex: lineIdx++,
        words: [...currentWords],
        width: currentWidth,
        targetWidth: lastLineAvailableWidth,
        xStart: 0,
        yBaseline: 0,
        height: effectiveLineHeight,
        ascent: this.shaper.getAscent(),
        descent: this.shaper.getDescent(),
        isLastLine: true,
        isJustified: false,
        extraSpacePerWord: 0,
        role: lineRole,
        unitId: lineUnitId,
      });
    }

    // Local 2-Line Tail Reflow:
    // If the final line of a paragraph/unit is an isolated 1-word tail (or tiny heading fragment like "א׳")
    // and the immediately preceding line belongs to the same unit and has >= 3 real words,
    // pull the last real word from the preceding line onto the final line so the final line has 2 words,
    // provided both lines fit within targetWidth and the preceding line's word spacing remains comfortable.
    if (minFinalWordsRule.value >= 2) {
      for (let k = 1; k < lines.length; k++) {
        const currLine = lines[k];
        const prevLine = lines[k - 1];
        if (!currLine.isLastLine || currLine.unitId !== prevLine.unitId) continue;

        const currReal = currLine.words.filter(w => !w.isSpace && w.text.trim().length > 0);
        const prevReal = prevLine.words.filter(w => !w.isSpace && w.text.trim().length > 0);

        if (currReal.length === 1 && prevReal.length >= 3) {
          const movedWord = prevReal[prevReal.length - 1];
          const newCurrNaturalW = movedWord.width + spaceWord.width + currReal[0].width;
          if (newCurrNaturalW <= currLine.targetWidth) {
            const remainingPrevReal = prevReal.slice(0, -1);
            const newPrevNaturalW =
              remainingPrevReal.reduce((s, w) => s + w.width, 0) +
              Math.max(0, remainingPrevReal.length - 1) * spaceWord.width;
            const isHeading =
              prevLine.role === 'chapter' ||
              prevLine.role === 'heading' ||
              prevLine.role === 'main_title' ||
              prevLine.role === 'siman';
            const prevGaps = Math.max(1, remainingPrevReal.length - 1);
            const prevExtra = (prevLine.targetWidth - newPrevNaturalW) / prevGaps;

            if (isHeading || !justify || prevExtra <= this.shaper.getFontSize() * 1.45) {
              // Rebuild prevLine words
              const rebuiltPrevWords: ShapedWord[] = [];
              for (let wIdx = 0; wIdx < remainingPrevReal.length; wIdx++) {
                if (wIdx > 0) rebuiltPrevWords.push({ ...spaceWord });
                rebuiltPrevWords.push(remainingPrevReal[wIdx]);
              }
              prevLine.words = rebuiltPrevWords;
              if (justify && !isHeading && remainingPrevReal.length > 1) {
                prevLine.width = prevLine.targetWidth;
                prevLine.isJustified = true;
                prevLine.extraSpacePerWord = Math.max(0, prevExtra);
              } else {
                prevLine.width = newPrevNaturalW;
                prevLine.isJustified = false;
                prevLine.extraSpacePerWord = 0;
              }

              // Rebuild currLine words with [movedWord, space, currReal[0]]
              currLine.words = [movedWord, { ...spaceWord }, currReal[0]];
              currLine.width = newCurrNaturalW;
            }
          }
        }
      }
    }

    return lines.map((line, idx) => {
      const isBoundaryAfter = idx === lines.length - 1 || lines[idx + 1].unitId !== line.unitId;
      line.unitBoundaryAfter = isBoundaryAfter;
      if (this.designSettings) {
        const resolved = DesignSettingsEngine.resolveStyle(this.designSettings, {
          role: line.role ?? defaultRole,
          unitId: line.unitId ?? defaultUnitId,
        });
        const p = resolved.paragraph;
        const c = resolved.character;
        const isLastOfUnit = Boolean(line.isLastLine) || isBoundaryAfter;
        line.isLastLine = isLastOfUnit;
        const effAlign = isLastOfUnit && lines.length > 1 ? p.lastLineAlignment : p.alignment;
        const realWordsCount = line.words.filter(w => !w.isSpace && w.text.trim().length > 0).length;
        if (effAlign !== 'justify' && line.isJustified) {
          const naturalW = line.words.reduce((acc, w) => acc + w.width, 0);
          line.width = naturalW;
          line.isJustified = false;
          line.extraSpacePerWord = 0;
        } else if (effAlign === 'justify' && !line.isJustified && realWordsCount > 1) {
          const naturalW = line.words.reduce((acc, w) => acc + w.width, 0);
          const spaceCount = Math.max(1, line.words.filter(w => w.isSpace).length);
          const deficit = Math.max(0, line.targetWidth - naturalW);
          line.isJustified = true;
          line.extraSpacePerWord = deficit / spaceCount;
          line.width = line.targetWidth;
        }
        line.fontFamily = c.fontFamily;
        line.fontSizePt = c.fontSizePt;
        line.fontWeight = c.isBold ? 700 : c.fontWeight;
        line.isItalic = c.isItalic;
        line.isUnderline = c.isUnderline;
        line.textColor = c.textColor;
        line.trackingEm = c.trackingEm;
        line.wordSpacingRatio = c.wordSpacingRatio;
        line.horizontalScalePercent = c.horizontalScalePercent;
        line.baselineShiftPt = c.baselineShiftPt;
        line.alignment = effAlign;
        line.paragraphAlignment = effAlign;
        line.lastLineAlignment = p.lastLineAlignment;
        line.direction = p.direction;
        let lineIndexInUnit = 0;
        for (let k = idx - 1; k >= 0 && lines[k].unitId === line.unitId; k--) {
          lineIndexInUnit++;
        }
        const isFirstOfUnit = lineIndexInUnit === 0;
        const ind = computeParagraphLineIndents(p, lineIndexInUnit);
        line.firstLineIndent = ind.firstLineIndentPt;
        line.firstLineIndentPt = ind.firstLineIndentPt;
        line.hangingIndentPt = ind.hangingIndentPt;
        line.rightIndentPt = ind.rightIndentPt;
        line.leftIndentPt = ind.leftIndentPt;
        line.spaceBeforePt = isFirstOfUnit ? p.spaceBeforePt : 0;
        const unitRole = line.role ?? defaultRole;
        const isCommentaryLine =
          unitRole === 'primary_comment' ||
          unitRole === 'secondary_comment' ||
          unitRole === 'tertiary_comment' ||
          unitRole === 'dibbur_hamatchil';
        const activeSepStyle = isCommentaryLine
          ? this.designSettings.ravText?.commentarySeparator?.styleId
          : this.designSettings.ravText?.paragraphSeparator?.styleId;
        const sepClearancePt = isLastOfUnit && activeSepStyle && activeSepStyle !== 'none' ? 6 : 0;
        line.spaceAfterPt = isLastOfUnit ? Math.max(p.spaceAfterPt, sepClearancePt) : 0;
        const ratio = Number.isFinite(p.lineSpacingRatio) && p.lineSpacingRatio > 0 ? p.lineSpacingRatio : 1.32;
        line.leadingPt =
          p.leadingMode === 'fixed' && Number.isFinite(p.leadingPt) && p.leadingPt > 0
            ? p.leadingPt
            : Number((c.fontSizePt * ratio).toFixed(2));
        // v0.8.0 Part C (§9): never let a leading below the glyph extent
        // (ascent 0.82 + descent 0.24 = 1.06 × font size) through — it
        // overlaps adjacent lines. The resolver clamps first; this is the
        // last line of defence for lines built without resolved settings.
        if (line.leadingPt > 0 && line.leadingPt < c.fontSizePt * 1.06) {
          line.leadingPt = Number((c.fontSizePt * 1.06).toFixed(2));
        }
        if (line.leadingPt > 0 && Number.isFinite(line.leadingPt)) {
          line.height = line.leadingPt;
        }
        line.ascent = c.fontSizePt * 0.82;
        line.descent = c.fontSizePt * 0.24;
      }
      return line;
    });
  }

  /**
   * Break a text paragraph into typeset lines with exact HarfBuzz advances
   */
  public typesetParagraph(
    text: string,
    targetWidth: number,
    role: ContentRole = 'main_source',
    unitId: string = 'unit-1',
    lineHeight?: number,
    justify: boolean = true
  ): TypesetLine[] {
    if (!text || targetWidth <= 10) return [];

    const effectiveLineHeight = lineHeight ?? this.shaper.getLineHeight();
    const tokens = text.split(/(\s+)/);
    const shapedWords: ShapedWord[] = [];

    for (const token of tokens) {
      if (!token) continue;
      if (/^\s+$/.test(token)) {
        shapedWords.push(this.shaper.shapeWord(' '));
      } else {
        shapedWords.push(this.shaper.shapeWord(token));
      }
    }

    const lines: TypesetLine[] = [];
    let currentWords: ShapedWord[] = [];
    let currentWidth = 0;
    let lineIdx = 0;

    for (let i = 0; i < shapedWords.length; i++) {
      const word = shapedWords[i];

      if (word.isSpace) {
        if (currentWords.length > 0) {
          currentWords.push(word);
          currentWidth += word.width;
        }
        continue;
      }

      const testWidth = currentWidth + word.width;

      if (testWidth > targetWidth && currentWords.length > 0) {
        // Trim trailing space
        while (currentWords.length > 0 && currentWords[currentWords.length - 1].isSpace) {
          currentWidth -= currentWords[currentWords.length - 1].width;
          currentWords.pop();
        }

        // Justification
        let extraSpace = 0;
        let isJustified = false;
        const spaceCount = currentWords.filter(w => w.isSpace).length;
        const deficit = targetWidth - currentWidth;

        if (justify && spaceCount > 0 && deficit > 0 && deficit < targetWidth * 0.35) {
          extraSpace = deficit / spaceCount;
          isJustified = true;
          currentWidth = targetWidth;
        }

        lines.push({
          lineIndex: lineIdx++,
          words: [...currentWords],
          width: currentWidth,
          targetWidth,
          xStart: 0,
          yBaseline: 0, // Assigned in pagination stage
          height: effectiveLineHeight,
          ascent: this.shaper.getAscent(),
          descent: this.shaper.getDescent(),
          isLastLine: false,
          isJustified,
          extraSpacePerWord: extraSpace,
          role,
          unitId,
        });

        currentWords = [word];
        currentWidth = word.width;
      } else {
        currentWords.push(word);
        currentWidth += word.width;
      }
    }

    // Flush last line
    if (currentWords.length > 0) {
      while (currentWords.length > 0 && currentWords[currentWords.length - 1].isSpace) {
        currentWidth -= currentWords[currentWords.length - 1].width;
        currentWords.pop();
      }

      lines.push({
        lineIndex: lineIdx++,
        words: [...currentWords],
        width: currentWidth,
        targetWidth,
        xStart: 0,
        yBaseline: 0,
        height: effectiveLineHeight,
        ascent: this.shaper.getAscent(),
        descent: this.shaper.getDescent(),
        isLastLine: true,
        isJustified: false,
        extraSpacePerWord: 0,
        role,
        unitId,
      });
    }

    return lines;
  }
}
