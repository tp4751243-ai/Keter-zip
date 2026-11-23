/**
 * v0.7.0 Part 3 — Vilna Shas Core Layout Engine & Spatial Geometry.
 *
 * NOTE ON "TRAINING": there is no model training here. A "trained" model
 * would require a corpus and a training run that this offline desktop app
 * does not have and must not fake. Everything in this module is
 * deterministic: engine rules (spread / flank geometry), an expanded
 * local parser (semantic classification + natural-language commands), and
 * Gemini system-prompt context. That is stated here and in MANIFEST.md.
 *
 * Verified against v0.3.0–v0.6.0 before writing (see MANIFEST.md §Part 2):
 * - ALREADY WORKING: justified central Gemara columns; folio numbering in
 *   Hebrew gematria (`pageNumberHebrew`); dibbur hamatchil extraction
 *   (bold lead / delimiter) + RavTextLink linking; Rashi/Tosafot tiers
 *   with `side: 'inside' / 'outside'` DECLARED in the Vilna preset.
 * - MISSING (built here): the facing-page rule was NOT honoured — the
 *   knee solver hardcodes Rashi right / Tosafot left, and the
 *   source-top/bottom layout hardcodes Rashi right / Tosafot left, so on
 *   verso pages Rashi sat on the OUTER margin. Fixed by `mirrorFlanks`
 *   in DynamicKneeEngine + the bottom-layout mirror in pagination-engine.
 *   Also missing: perek title centring, second-row indent, Michtav boxes,
 *   named secondary commentaries, dibbur verification, Shas flaw scan +
 *   one-click fixes, Shas NL commands, Mishna/marginal classification.
 *
 * v0.8.0 Part C (§4) — FACING-PAGE RULE, CORRECTED. The v0.7.0 text above
 * and `flankPhysicalSides` stated the rule backwards ("recto Rashi left")
 * because they used the English-book convention (recto = right-hand
 * page). For a Hebrew book the sides are reversed — Wikipedia, "Recto
 * and verso": "in right-to-left scripts, like Syriac, Arabic and Hebrew
 * … the recto page is to the left while the verso is to the right"
 * (en.wikipedia.org/wiki/Recto_and_verso). So on a Vilna daf:
 * - Amud Rishon (a-side, e.g. 2a) is the LEFT-hand page of the spread;
 *   its binding (inner) edge is its RIGHT edge → Rashi RIGHT, Tosafot
 *   LEFT. This is exactly what the Vilna 2a photograph shows — Wikipedia,
 *   "Tosafot": "The first page of the Vilna Edition Shas … folio 2a …
 *   To the right, on the inner margin of the page, is Rashi's commentary;
 *   to the left, on the outer margin, the Tosafot"
 *   (en.wikipedia.org/wiki/tosefos) — and Chabad: "On the right margin is
 *   the commentary of Rashi, and on the left the commentary of Tosafot.
 *   When he turns the page, the order is reversed."
 * - Amud Sheini (b-side, e.g. 2b) is the RIGHT-hand page; its inner edge
 *   is its LEFT edge → Rashi LEFT, Tosafot RIGHT.
 * The invariant is "Rashi INNER, Tosafot OUTER" (Vilna Edition article:
 * "the Gemara … centered with Rashi's commentary on the inner margin and
 * Tosafot on the outer margin"; Ariach's Tzuras HaDaf guide: "Rashi on
 * the inner side, next to the binding, and Tosafos on the outer side …
 * the Rashi of both pages meets in the middle").
 * The knee solver and the bottom-commentary path ALREADY implement this
 * (base: Rashi right; mirrored on verso pages) and were left untouched;
 * what was wrong was this module's `spreadSide` / `flankPhysicalSides`
 * (and the v070 smoke assertions on them), which claimed the opposite.
 * They are corrected here so solver, helpers, spread rule and smoke test
 * all assert the one rule above.
 */
import type { ContentRole, ContentUnit, PageTypesetResult, RavTextLink, TierConfig } from '../types/typesetter';
import type { CustomLayoutBox, ProfessionalDesignSettings } from '../types/design-settings';
import { DesignSettingsEngine } from './design-settings-engine';
import { DEFAULT_OPENING_DECORATION, DEFAULT_RUNNING_HEADER_SETTINGS } from '../types/design-settings';
import type { LocalRuleOverride } from './typesetting-rules-engine';

/**
 * 1-based page number → spread side. In a Hebrew book the recto (a-side)
 * is the LEFT-hand page of the spread and the verso (b-side) the
 * RIGHT-hand page — the reverse of an English book (see the module doc).
 * Two numberings exist in this codebase (verified 2026-11-10):
 * - 'standard' (single/two-column layouts): pageNumber = p+1, so 1 → left.
 * - 'talmud' (rav_text): pageNumber = p+2, numbering starts at Daf Bet,
 *   so 2 (2a) → left, 3 (2b) → right.
 * The invariant is the 0-based body-page index: the first body page is
 * left-facing (recto) — see `spreadSideForPageIndex`.
 */
export function spreadSide(pageNumber: number, numbering: 'standard' | 'talmud' = 'standard'): 'right' | 'left' {
  if (numbering === 'talmud') return pageNumber % 2 === 0 ? 'left' : 'right';
  return pageNumber % 2 === 1 ? 'left' : 'right';
}

/** Spread side from the 0-based body-page index (numbering-independent). */
export function spreadSideForPageIndex(pageIndex: number): 'right' | 'left' {
  return pageIndex % 2 === 0 ? 'left' : 'right';
}

/** True when the page is right-facing (verso / Amud Sheini). */
export function isVersoPage(pageNumber: number, numbering: 'standard' | 'talmud' = 'standard'): boolean {
  return spreadSide(pageNumber, numbering) === 'right';
}

import type { DafFormatMode } from '../types/typesetter';
import type { FolioNumberingSettings, PageElementsDesignSettings, RunningHeaderSettings } from '../types/design-settings';
import { resolveLogicalSide } from './vilna-preset';

function gematriaBare(num: number): string {
  const letters: Array<[number, string]> = [
    [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'],
    [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'],
    [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'],
    [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'],
    [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'],
    [2, 'ב'], [1, 'א'],
  ];
  const nSafe = Math.max(1, Math.floor(num));
  if (nSafe === 15) return 'טו';
  if (nSafe === 16) return 'טז';
  let n = nSafe;
  let res = '';
  for (const [val, ch] of letters) {
    while (n >= val) {
      res += ch;
      n -= val;
    }
  }
  return res || 'א';
}

function gematriaWithPunct(num: number): string {
  const bare = gematriaBare(num);
  return bare.length > 1 ? `${bare.slice(0, -1)}״${bare.slice(-1)}` : `${bare}׳`;
}

/**
 * Compute traditional Daf & Amud from 0-based body page index.
 * Traditional Shas starts at Daf ב (2), Amud א (a):
 * bodyPageIndex 0 -> Daf 2a ('ב.'), bodyPageIndex 1 -> Daf 2b ('ב:'),
 * bodyPageIndex 2 -> Daf 3a ('ג.'), bodyPageIndex 3 -> Daf 3b ('ג:').
 */
export function computeTalmudDafAmud(
  bodyPageIndex: number,
  startDaf = 2,
  startAmud: 'a' | 'b' = 'a'
): { daf: number; amud: 'a' | 'b'; latin: string } {
  const startHalf = Math.max(1, Math.floor(startDaf)) * 2 + (startAmud === 'b' ? 1 : 0);
  const absHalf = startHalf + Math.max(0, Math.floor(bodyPageIndex));
  const daf = Math.floor(absHalf / 2);
  const amud: 'a' | 'b' = absHalf % 2 === 0 ? 'a' : 'b';
  return { daf, amud, latin: `${daf}${amud}` };
}

export function formatTalmudDafLabel(
  bodyPageIndex: number,
  options?: Partial<FolioNumberingSettings>
): string {
  const startDaf = options?.startDaf ?? 2;
  const startAmud = options?.startAmud ?? 'a';
  const dafFormat: DafFormatMode = options?.dafFormat ?? 'dots';
  const { daf, amud } = computeTalmudDafAmud(bodyPageIndex, startDaf, startAmud);
  if (dafFormat === 'numbers') {
    return `${daf}${amud}`;
  }
  if (dafFormat === 'gematria') {
    return gematriaWithPunct(daf);
  }
  const heb = gematriaBare(daf);
  if (dafFormat === 'amud_hebrew') {
    return amud === 'a' ? `${heb} ע״א` : `${heb} ע״ב`;
  }
  // 'dots' (classic Vilna notation: ב. for a-side, ב: for b-side)
  return amud === 'a' ? `${heb}.` : `${heb}:`;
}

/** Format body folio display string respecting layout & folio numbering settings */
export function formatBodyFolioLabel(
  bodyPageIndex: number,
  layoutType: string,
  pageElements?: Partial<PageElementsDesignSettings> | null
): { folioDisplay: string; pageNumberHebrew: string; bodyNumber: number; latin: string } {
  const fn = pageElements?.folioNumbering;
  const pageNumberStyle = pageElements?.pageNumberStyle ?? 'hebrew';
  if (layoutType === 'rav_text' || fn) {
    const defaultStartDaf = layoutType === 'rav_text' ? 2 : 1;
    const dafFormat: DafFormatMode =
      fn?.dafFormat ??
      (layoutType === 'rav_text'
        ? 'dots'
        : pageNumberStyle === 'numbers'
          ? 'numbers'
          : 'gematria');
    if (layoutType === 'rav_text' || dafFormat === 'dots' || dafFormat === 'amud_hebrew') {
      const { daf, latin } = computeTalmudDafAmud(
        bodyPageIndex,
        fn?.startDaf ?? defaultStartDaf,
        fn?.startAmud ?? 'a'
      );
      const display = formatTalmudDafLabel(bodyPageIndex, {
        dafFormat,
        startDaf: fn?.startDaf ?? defaultStartDaf,
        startAmud: fn?.startAmud ?? 'a',
        excludeFrontMatter: fn?.excludeFrontMatter ?? true,
      });
      return { folioDisplay: display, pageNumberHebrew: display, bodyNumber: daf, latin };
    }
  }
  const num = bodyPageIndex + 1;
  const he = gematriaWithPunct(num);
  const display = pageNumberStyle === 'numbers' ? String(num) : he;
  return {
    folioDisplay: display,
    pageNumberHebrew: he,
    bodyNumber: num,
    latin: folioLatin(num),
  };
}

/**
 * Resolve structured Vilna Shas / General Sefer running header texts from
 * semantic fields (`masechetName`, `perekNumberText`, `perekTitleText`)
 * without overwriting explicit manual slot text.
 */
export function formatVilnaRunningHeader(
  rh: Partial<RunningHeaderSettings> | undefined | null,
  side: 'left' | 'right',
  fallbackBookTitle: string,
  fallbackEditionLabel: string
): { centerText: string; leftText: string } {
  const masechet = (rh?.masechetName ?? '').trim();
  const perekNum = (rh?.perekNumberText ?? '').trim();
  const perekTitle = (rh?.perekTitleText ?? '').trim();
  const hasSemantic = Boolean(masechet || perekNum || perekTitle);
  if (!hasSemantic && !rh?.useStructuredVilnaHeader) {
    return {
      centerText: (rh?.centerText ?? '').trim() || fallbackBookTitle,
      leftText: (rh?.leftText ?? '').trim() || fallbackEditionLabel,
    };
  }
  // Classic Vilna header strip: "הכל חייבין   פרק ראשון   חגיגה" or alternating sides
  const explicitCenter =
    side === 'right'
      ? (rh?.rightPageText ?? '').trim()
      : (rh?.leftPageText ?? '').trim();
  const combinedParts = [perekTitle, perekNum, masechet].filter(Boolean);
  const semanticCenter =
    combinedParts.length > 0
      ? combinedParts.join('   ')
      : fallbackBookTitle;
  const semanticLeft =
    side === 'left'
      ? perekNum || masechet || fallbackEditionLabel
      : masechet || perekTitle || fallbackEditionLabel;
  return {
    centerText: explicitCenter || (rh?.centerText ?? '').trim() || semanticCenter,
    leftText: (rh?.leftText ?? '').trim() || semanticLeft,
  };
}

export interface MishnahGemaraBoundaryCheck {
  isTransition: boolean;
  verified: boolean;
  confidence: number;
  reasonHe: string;
  reasonEn: string;
}

/**
 * Deterministic detector for verified Mishnah -> Gemara boundaries.
 * Never mutates unit.rawText; flags ambiguous boundaries so QA can prompt the user.
 */
export function detectMishnahGemaraBoundary(
  units: ContentUnit[],
  unitIndex: number
): MishnahGemaraBoundaryCheck {
  const cur = units[unitIndex];
  if (!cur || cur.role !== 'main_source') {
    return { isTransition: false, verified: false, confidence: 0, reasonHe: '', reasonEn: '' };
  }
  const text = (cur.rawText || '').trim();
  const style = (cur.styleName || '').toLowerCase();
  const startsWithGemaraToken = /^(?:גמרא|גמ׳|גמ'|גְמָרָא)(?:\s|$|:|\.)/.test(text);
  const styleIsGemara = style.includes('gemara') || style.includes('talmud');
  const styleIsMishna = style.includes('mishna') || /^(?:מתניתין|מתני׳|מַתְנִיתִין|משנה|מִשְׁנָה)(?:\s|:|\.|$)/.test(text);

  if (styleIsMishna) {
    return { isTransition: false, verified: true, confidence: 1, reasonHe: '', reasonEn: '' };
  }

  // Look back across immediately preceding main_source units to see if we just finished a Mishnah
  let prevMain: ContentUnit | undefined;
  for (let i = unitIndex - 1; i >= 0; i--) {
    if (units[i].role === 'main_source') {
      prevMain = units[i];
      break;
    }
    if (units[i].role === 'chapter' || units[i].role === 'heading') break;
  }

  const prevStyle = (prevMain?.styleName || '').toLowerCase();
  const prevText = (prevMain?.rawText || '').trim();
  const prevWasMishnah =
    Boolean(prevMain) &&
    (prevStyle.includes('mishna') ||
      /^(?:מתניתין|מתני׳|מַתְנִיתִין|משנה|מִשְׁנָה)(?:\s|:|\.|$)/.test(prevText));

  if (prevWasMishnah && (startsWithGemaraToken || styleIsGemara)) {
    return {
      isTransition: true,
      verified: true,
      confidence: 0.98,
      reasonHe: 'מעבר מאומת ממשנה לגמרא.',
      reasonEn: 'Verified Mishnah-to-Gemara transition.',
    };
  }

  // Starts with Gemara even if previous style wasn't tagged Mishnah (as long as prevMain exists)
  if (startsWithGemaraToken && prevMain) {
    return {
      isTransition: true,
      verified: true,
      confidence: 0.9,
      reasonHe: 'זוהתה פתיחת גמרא מפורשת.',
      reasonEn: 'Explicit Gemara opening token detected.',
    };
  }

  // Previous unit looks like a Mishnah, next unit is plain main_source without explicit 'גמ׳' / 'גמרא'
  if (prevWasMishnah) {
    const endsCleanly = /[:.׃]\s*$/.test(prevText);
    return {
      isTransition: true,
      verified: endsCleanly,
      confidence: endsCleanly ? 0.82 : 0.58,
      reasonHe: endsCleanly
        ? 'זוהתה יחידת גמרא מיד לאחר מתניתין.'
        : 'מעבר משנה→גמרא אפשרי אך לא מסומן במפורש — מומלץ לאמת.',
      reasonEn: endsCleanly
        ? 'Gemara unit directly follows a Mishnah.'
        : 'Possible Mishnah→Gemara boundary without explicit marker — verify.',
    };
  }

  return { isTransition: false, verified: false, confidence: 0, reasonHe: '', reasonEn: '' };
}

/** Latin folio label, standard numbering: page 1 → 1a, page 2 → 1b, page 3 → 2a, … */
export function folioLatin(pageNumber: number): string {
  return `${Math.ceil(pageNumber / 2)}${pageNumber % 2 === 1 ? 'a' : 'b'}`;
}

/** Latin folio label, Talmud numbering (rav_text): 2 → 2a, 3 → 2b, 4 → 3a, … */
export function folioLatinTalmud(pageNumber: number): string {
  return `${Math.floor(pageNumber / 2) + 1}${pageNumber % 2 === 0 ? 'a' : 'b'}`;
}

/**
 * Physical flank for each commentary on a facing page.
 * Rashi is always INNER, Tosafot always OUTER (see the module doc):
 * - recto / Amud Rishon (left-hand page, e.g. 2a): inside = right,
 *   outside = left → Rashi right, Tosafot left.
 * - verso / Amud Sheini (right-hand page, e.g. 2b): inside = left,
 *   outside = right → Rashi left, Tosafot right.
 * (v0.7.0 had this backwards — it claimed recto Rashi left — because it
 * used the English-book convention that the recto is the right-hand
 * page. The knee solver's base side (Rashi right on the first body
 * page) was already correct for the real Vilna daf; this helper now
 * agrees with it. Corrected 2026-11-10, v0.8.0 Part C §4.)
 */
export function flankPhysicalSides(pageNumber: number, numbering: 'standard' | 'talmud' = 'standard'): { rashi: 'left' | 'right'; tosafot: 'left' | 'right' } {
  // v0.9.9 (I2): one statement of the INNER/OUTER rule — the preset
  // helper resolves by body-page index (first body page = recto).
  // 'talmud' numbering: pageNumber = bodyPageIndex + 2, so
  // bodyPageIndex = pageNumber - 2; 'standard': bodyPageIndex =
  // pageNumber - 1. Both give the same parity as spreadSide above.
  const bodyPageIndex = numbering === 'talmud' ? pageNumber - 2 : pageNumber - 1;
  return {
    rashi: resolveLogicalSide('inner', bodyPageIndex),
    tosafot: resolveLogicalSide('outer', bodyPageIndex),
  };
}

/**
 * v0.9.9 (I2) — is this unit classified as a Mishnah? Shared by
 * `detectMishnahGemaraBoundary` and the pagination post-pass, which
 * flags a Mishnah whose following Gemara boundary cannot be
 * established at all (QA diagnostic, never a guessed marker).
 */
export function isMishnahUnit(unit: ContentUnit): boolean {
  if (!unit || unit.role !== 'main_source') return false;
  const style = (unit.styleName || '').toLowerCase();
  const text = (unit.rawText || '').trim();
  return (
    style.includes('mishna') ||
    /^(?:מתניתין|מתני׳|מַתְנִיתִין|משנה|מִשְׁנָה)(?:\s|:|\.|$)/.test(text)
  );
}

/** Strip nikud, taamim and punctuation for dibbur matching. */
export function normalizeHebrewForMatch(text: string): string {
  return text
    .replace(/[֑-ְֱֲֳִֵֶַׇָֹֻּֽֿׁׂׅׄ]/g, '')
    .replace(/[״״"'.:;,\-–—()[\]!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DibburVerification {
  linkId: string;
  dibburHamatchil: string;
  sourceUnitId: string | null;
  /** True when the dibbur words occur in the linked Gemara text. */
  ok: boolean;
  /** Best alternative source unit whose text contains the dibbur, if any. */
  suggestedSourceUnitId: string | null;
}

/**
 * Verify every dibbur hamatchil against the Gemara text it claims to
 * quote. A link passes when the normalized dibbur words occur in the
 * linked source unit; otherwise the whole Gemara stream is searched for
 * the unit that does contain them (a one-click re-link target).
 */
export function verifyDibburHamatchil(units: ContentUnit[], links: RavTextLink[]): DibburVerification[] {
  const byId = new Map(units.map(u => [u.id, u]));
  const gemara = units.filter(u => u.role === 'main_source');
  return links.map(link => {
    const dibbur = normalizeHebrewForMatch(link.dibburHamatchil || '');
    const source = link.sourceUnitId ? byId.get(link.sourceUnitId) : undefined;
    const sourceText = source ? normalizeHebrewForMatch(source.rawText) : '';
    if (dibbur && sourceText.includes(dibbur)) {
      return { linkId: link.linkId, dibburHamatchil: link.dibburHamatchil, sourceUnitId: link.sourceUnitId, ok: true, suggestedSourceUnitId: null };
    }
    const alt = dibbur ? gemara.find(u => normalizeHebrewForMatch(u.rawText).includes(dibbur)) : undefined;
    return {
      linkId: link.linkId,
      dibburHamatchil: link.dibburHamatchil,
      sourceUnitId: link.sourceUnitId,
      ok: false,
      suggestedSourceUnitId: alt ? alt.id : null,
    };
  });
}

/**
 * v0.9.0 Part C — dibbur hamatchil AUTOMATIC detection from the source
 * text. When a commentary paragraph carries no bold lead and no `ד״ה`
 * delimiter (the two signals the importer already uses), the opening
 * lemma is found by matching the commentary's own opening words against
 * the Gemara: the longest leading phrase (2–8 words) that occurs verbatim
 * (normalized: nikud / ktiv-malei / punctuation stripped) in some source
 * unit IS the dibbur, and the unit it occurs in is the link target. This
 * is the third dibbur signal in the importer, after bold-run and
 * delimiter detection — and it is what lets an unformatted .docx (plain
 * paragraphs, no bold, no colons) still link its commentaries.
 */
export function detectDibburFromSource(
  commentaryText: string,
  sourceUnits: ContentUnit[]
): { dibbur: string; sourceUnitId: string } | null {
  if (!commentaryText || sourceUnits.length === 0) return null;
  // Strip a leading author label ("רש״י", "תוספות", "ד״ה", "בד״ה") and
  // opening brackets/quotes before taking the opening words.
  const stripped = commentaryText
    .trim()
    .replace(/^[\s[\]()״"]+/, '')
    .replace(/^(?:רש["״]י|תוספות|תוס['׳]|ד["״]ה|בד["״]ה|רמב["״]ן|רשב["״]א)\s+/g, '')
    .trim();
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const normalizedSources = sourceUnits.map(u => ({
    id: u.id,
    text: normalizeHebrewForMatch(u.rawText),
  }));
  // Longest first: an 8-word lemma beats a 2-word one (a 2-word match is
  // often a coincidence — "אמר רבי" occurs everywhere).
  for (let len = Math.min(8, words.length); len >= 2; len -= 1) {
    const candidate = words.slice(0, len).join(' ');
    const norm = normalizeHebrewForMatch(candidate);
    if (norm.length < 4) continue;
    const hit = normalizedSources.find(s => s.text.includes(norm));
    if (hit) return { dibbur: candidate, sourceUnitId: hit.id };
  }
  return null;
}

/**
 * v0.9.0 Part C — bold the detected dibbur in a commentary unit's runs.
 * Returns a NEW unit: `dibburHamatchil` set (from the existing field, or
 * detected from the source text when missing) and `textRuns` rebuilt so
 * the leading lemma is a bold `isDibbur` run. When no dibbur can be found
 * the unit is returned unchanged — never guessed.
 */
export function boldDibburInUnit(unit: ContentUnit, sourceUnits: ContentUnit[]): ContentUnit {
  const dibbur = unit.dibburHamatchil ?? detectDibburFromSource(unit.rawText, sourceUnits)?.dibbur;
  if (!dibbur) return unit;
  const raw = unit.rawText;
  const idx = raw.indexOf(dibbur);
  if (idx < 0) return { ...unit, dibburHamatchil: dibbur };
  const after = raw.slice(idx + dibbur.length);
  const punct = after.match(/^(\s*[:—–.-])/);
  const split = idx + dibbur.length + (punct ? punct[0].length : 0);
  const runs: ContentUnit['textRuns'] = [];
  if (idx > 0) runs.push({ text: raw.slice(0, idx), isBold: false, isDibbur: false });
  runs.push({ text: raw.slice(idx, split), isBold: true, isDibbur: true });
  if (split < raw.length) runs.push({ text: raw.slice(split), isBold: false, isDibbur: false });
  return { ...unit, dibburHamatchil: dibbur, textRuns: runs };
}

export type ShasFlawKind =
  | 'widow'
  | 'orphan'
  | 'misaligned_flanks'
  | 'missing_folio'
  | 'broken_dibbur_link'
  // v0.9.0 Part C — geometry flaws (see scanShasFlaws below).
  | 'text_overlap'
  | 'knee_misalignment'
  | 'pagination_error';

export interface ShasFlaw {
  kind: ShasFlawKind;
  pageNumber: number;
  unitId?: string;
  linkId?: string;
  messageHe: string;
  autoFixable: boolean;
  /**
   * v0.9.0 Part C — corrective geometry shift this flaw suggests (gutter
   * widening for an overlap, knee-junction shift for a misaligned knee).
   * Applied only through the approval-card fix handler in App, which
   * sums and caps the shifts before writing them to the settings.
   */
  suggestedShift?: { gutterDeltaPt?: number; kneeJunctionDeltaPct?: number };
}

/**
 * Scan typeset pages for traditional Vilna flaws. Widow = the last line
 * of a unit alone at the top of a page; orphan = the first line of a
 * unit alone at the bottom. Misaligned flanks = a Rashi line and a
 * Tosafot line whose x-ranges overlap on the same band. Missing folio =
 * an empty Hebrew folio label. Broken dibbur = a failed verification.
 */
export function scanShasFlaws(
  pages: PageTypesetResult[],
  units: ContentUnit[],
  links: RavTextLink[]
): ShasFlaw[] {
  const flaws: ShasFlaw[] = [];
  const verification = verifyDibburHamatchil(units, links);
  for (const v of verification) {
    if (!v.ok) {
      flaws.push({
        kind: 'broken_dibbur_link',
        pageNumber: 0,
        linkId: v.linkId,
        messageHe: `דיבור המתחיל "${v.dibburHamatchil}" אינו נמצא בטקסט הגמרא המקושר${v.suggestedSourceUnitId ? ' — נמצאה יחידת מקור מתאימה' : ' — לא נמצאה יחידת מקור תואמת'}.`,
        autoFixable: v.suggestedSourceUnitId !== null,
      });
    }
  }
  // v0.8.0 Part C (§3): total line count per unit across the whole book
  // (a unit with a single line in the whole book cannot be a widow or an
  // orphan — flagging it was a false positive; see the loop below).
  const totalLinesByUnit = new Map<string, number>();
  for (const pg of pages) {
    for (const l of [...pg.sourceLines, ...pg.rashiLines, ...pg.tosafotLines]) {
      totalLinesByUnit.set(l.unitId, (totalLinesByUnit.get(l.unitId) ?? 0) + 1);
    }
  }
  for (const page of pages) {
    if (!page.pageNumberHebrew || !page.pageNumberHebrew.trim()) {
      flaws.push({ kind: 'missing_folio', pageNumber: page.pageNumber, messageHe: `עמוד ${page.pageNumber}: חסר מספר דף עברי.`, autoFixable: false });
    }
    const allLines = [...page.sourceLines, ...page.rashiLines, ...page.tosafotLines];
    // Widow / orphan from unit line sequences on this page.
    // v0.8.0 Part C (§3): a unit with a single line in the WHOLE book is
    // not a widow/orphan — it cannot be split, so flagging its one line
    // at the top/bottom of a page was a false positive that made the
    // one-click fix write a vacuous keep-together override for it.
    const byUnit = new Map<string, { first: number; last: number; count: number }>();
    allLines.forEach((l, i) => {
      const e = byUnit.get(l.unitId) ?? { first: i, last: i, count: 0 };
      e.last = i;
      e.count += 1;
      byUnit.set(l.unitId, e);
    });
    for (const [unitId, seq] of byUnit) {
      if (seq.count === 1 && allLines.length > 1 && (totalLinesByUnit.get(unitId) ?? 0) > 1) {
        const atTop = seq.first === 0;
        const atBottom = seq.last === allLines.length - 1;
        if (atTop) {
          flaws.push({ kind: 'widow', pageNumber: page.pageNumber, unitId, messageHe: `עמוד ${page.pageNumber}: שורה יחידה של יחידה בסוף עמוד קודם — אלמנה בראש העמוד.`, autoFixable: true });
        } else if (atBottom) {
          flaws.push({ kind: 'orphan', pageNumber: page.pageNumber, unitId, messageHe: `עמוד ${page.pageNumber}: שורה יחידה של יחידה בתחתית העמוד — יתום.`, autoFixable: true });
        }
      }
    }
    // Misaligned flanks: overlapping x-ranges on the same y-band.
    // v0.8.0 Part C (§3): compare ONLY physical coordinates (xLeft/xRight,
    // stamped by SpatialExclusionEngine.registerLine). The old code fell
    // back to xStart, which is measured from the RIGHT edge in rav-text
    // output, and mixed the two origins in one comparison.
    for (const r of page.rashiLines) {
      for (const t of page.tosafotLines) {
        if (Math.abs(r.yBaseline - t.yBaseline) < 2) {
          const rL = r.xLeft;
          const rR = r.xRight;
          const tL = t.xLeft;
          const tR = t.xRight;
          if (rL === undefined || rR === undefined || tL === undefined || tR === undefined) continue;
          if (rL < tR && tL < rR) {
            flaws.push({ kind: 'misaligned_flanks', pageNumber: page.pageNumber, messageHe: `עמוד ${page.pageNumber}: גבולות רש״י/תוספות חופפים באותה שורה.`, autoFixable: false });
            break;
          }
        }
      }
      if (flaws.some(f => f.kind === 'misaligned_flanks' && f.pageNumber === page.pageNumber)) break;
    }

    // v0.9.0 Part C — TEXT OVERLAP (any two streams, not just the
    // flanks): two lines from DIFFERENT streams whose physical x-ranges
    // overlap on the same y-band are printed on top of each other. One
    // flaw per page (the first pair found); the corrective shift widens
    // the gutter by 2pt per overlapping page (capped in fixGeometryFlaws).
    const streams: Array<Array<(typeof page.sourceLines)[number]>> = [
      page.sourceLines, page.rashiLines, page.tosafotLines,
      page.tertiaryLines ?? [], page.footnoteLines ?? [], page.column2Lines ?? [],
    ];
    const streamNames = ['מקור', 'רש״י', 'תוספות', 'מפרשים משניים', 'הערות שוליים', 'טור שני'];
    let overlapFound = false;
    for (let a = 0; a < streams.length && !overlapFound; a += 1) {
      for (let b = a + 1; b < streams.length && !overlapFound; b += 1) {
        for (const la of streams[a]) {
          for (const lb of streams[b]) {
            if (Math.abs(la.yBaseline - lb.yBaseline) >= 2) continue;
            if (la.xLeft === undefined || la.xRight === undefined || lb.xLeft === undefined || lb.xRight === undefined) continue;
            if (la.xLeft < lb.xRight && lb.xLeft < la.xRight) {
              flaws.push({
                kind: 'text_overlap',
                pageNumber: page.pageNumber,
                unitId: la.unitId,
                messageHe: `עמוד ${page.pageNumber}: חפיפת טקסט בין ${streamNames[a]} ל${streamNames[b]} באותה שורה — הטקסט מודפס זה על גבי זה.`,
                autoFixable: true,
                suggestedShift: { gutterDeltaPt: 2 },
              });
              overlapFound = true;
              break;
            }
          }
          if (overlapFound) break;
        }
      }
    }

    // v0.9.0 Part C — KNEE MISALIGNMENT: the two flanks' lowest
    // baselines differ by more than ~2 lines below the knee junction,
    // i.e. the knee steps down on one side and not the other. The
    // corrective shift is a bounded heuristic nudge — lower the junction
    // 2 points so the shorter flank gets room below the knee — and the
    // scan must be re-run after re-pagination to confirm it actually
    // helped; a geometry shift alone cannot guarantee a balanced knee.
    const kneeY = page.knee?.kneeJunctionY;
    if (kneeY !== undefined && page.rashiLines.length > 0 && page.tosafotLines.length > 0) {
      const maxR = Math.max(...page.rashiLines.map(l => l.yBaseline));
      const maxT = Math.max(...page.tosafotLines.map(l => l.yBaseline));
      const gap = Math.abs(maxR - maxT);
      if (maxR > kneeY && maxT > kneeY && gap > 36) {
        const lowerIsRashi = maxR > maxT;
        flaws.push({
          kind: 'knee_misalignment',
          pageNumber: page.pageNumber,
          messageHe: `עמוד ${page.pageNumber}: מפגש הברך אינו מאוזן — ${lowerIsRashi ? 'רש״י' : 'תוספות'} יורד ${Math.round(gap)}pt נמוך יותר מהצד השני.`,
          autoFixable: true,
          suggestedShift: { kneeJunctionDeltaPct: 2 },
        });
      }
    }

    // v0.9.0 Part C — PAGINATION ERROR: a page in the middle of the book
    // with no lines at all (an empty folio), or a break in the page-number
    // sequence. Not auto-fixable by a geometry shift — it needs a fresh
    // pagination, which the user triggers; the flaw is reported, never hidden.
    const pageLines = streams.reduce((n, s) => n + s.length, 0);
    const isLastPage = page.pageNumber === pages[pages.length - 1]?.pageNumber;
    if (pageLines === 0 && !isLastPage) {
      flaws.push({ kind: 'pagination_error', pageNumber: page.pageNumber, messageHe: `עמוד ${page.pageNumber}: עמוד ריק באמצע הספר — אין עליו שורות כלל.`, autoFixable: false });
    }
  }
  // v0.9.0 Part C — pagination sequence: page numbers must rise by 1.
  for (let i = 1; i < pages.length; i += 1) {
    if (pages[i].pageNumber !== pages[i - 1].pageNumber + 1) {
      flaws.push({ kind: 'pagination_error', pageNumber: pages[i].pageNumber, messageHe: `רצף הדפים שבור: עמוד ${pages[i - 1].pageNumber} ואחריו עמוד ${pages[i].pageNumber}.`, autoFixable: false });
    }
  }
  return flaws;
}

/**
 * v0.9.0 Part C — corrective geometry shifts for the auto-fixable
 * geometry flaws (text_overlap, knee_misalignment). Sums each flaw's
 * suggested shift and CAPS the total (gutter +8pt, knee ±10 points of
 * junction percent) so a bad scan can never wreck the page geometry.
 * The caller (App's approval-card handler) writes the shifts into the
 * design settings via updateRavTextSettings and re-paginates; this
 * function itself changes nothing.
 */
export interface GeometryShiftResult {
  gutterDeltaPt: number;
  kneeJunctionDeltaPct: number;
  fixedCount: number;
  skippedCount: number;
  reasonsHe: string[];
}

export function fixGeometryFlaws(flaws: ShasFlaw[]): GeometryShiftResult {
  let gutter = 0;
  let knee = 0;
  let fixed = 0;
  let skipped = 0;
  const reasonsHe: string[] = [];
  for (const f of flaws) {
    if ((f.kind === 'text_overlap' || f.kind === 'knee_misalignment') && f.autoFixable && f.suggestedShift) {
      if (f.suggestedShift.gutterDeltaPt) {
        gutter += f.suggestedShift.gutterDeltaPt;
        reasonsHe.push(`עמוד ${f.pageNumber}: הרחבת מרווח ב־${f.suggestedShift.gutterDeltaPt}pt`);
      }
      if (f.suggestedShift.kneeJunctionDeltaPct) {
        knee += f.suggestedShift.kneeJunctionDeltaPct;
        reasonsHe.push(`עמוד ${f.pageNumber}: הזזת מפגש הברך ב־${f.suggestedShift.kneeJunctionDeltaPct} נקודות`);
      }
      fixed += 1;
    } else if (f.kind === 'text_overlap' || f.kind === 'knee_misalignment' || f.kind === 'pagination_error') {
      skipped += 1;
    }
  }
  return {
    gutterDeltaPt: Math.max(0, Math.min(8, gutter)),
    kneeJunctionDeltaPct: Math.max(-10, Math.min(10, knee)),
    fixedCount: fixed,
    skippedCount: skipped,
    reasonsHe,
  };
}

export interface ShasFixResult {
  /** Re-linked links (broken dibbur → suggested source unit). */
  links: RavTextLink[];
  /** Local keep-together overrides for widow/orphan units. */
  overrides: LocalRuleOverride[];
  fixedCount: number;
  skippedCount: number;
}

/** One-click fixes: re-link broken dibburs; keep widow/orphan units together.
 *
 * v0.8.0 Part C (§3): the widow/orphan half used to report success while
 * doing nothing — it wrote `keepTogetherUnitIds`, a field no paginator
 * read. The paginators now honour that field (see
 * `TypesettingRulesEngine.keepTogetherUnitIds` + the hold-back logic in
 * pagination-engine), so these overrides take real effect on the next
 * pagination. Honesty rules enforced here:
 * - a flaw for a unit that does not exist, or for a unit with a single
 *   line in the whole book (cannot be split), is SKIPPED, never counted
 *   as fixed;
 * - one override per unit (a unit flagged on two pages gets one override);
 * - `fixedCount` counts only re-links actually performed plus overrides
 *   actually written.
 */
export function fixShasFlaws(
  flaws: ShasFlaw[],
  units: ContentUnit[],
  links: RavTextLink[],
  pages?: PageTypesetResult[]
): ShasFixResult {
  const verification = verifyDibburHamatchil(units, links);
  const byLinkId = new Map(verification.map(v => [v.linkId, v]));
  let fixed = 0;
  let skipped = 0;
  const nextLinks = links.map(l => {
    const v = byLinkId.get(l.linkId);
    if (v && !v.ok && v.suggestedSourceUnitId) {
      fixed += 1;
      return { ...l, sourceUnitId: v.suggestedSourceUnitId };
    }
    return l;
  });
  const unitIds = new Set(units.map(u => u.id));
  // Single-line units cannot be split, so a keep-together override for
  // one is vacuous — count its lines when the caller passes the pages.
  const linesByUnit = new Map<string, number>();
  if (pages) {
    for (const pg of pages) {
      for (const l of [...pg.sourceLines, ...pg.rashiLines, ...pg.tosafotLines]) {
        linesByUnit.set(l.unitId, (linesByUnit.get(l.unitId) ?? 0) + 1);
      }
    }
  }
  const overrides: LocalRuleOverride[] = [];
  const overriddenUnitIds = new Set<string>();
  for (const f of flaws) {
    if ((f.kind === 'widow' || f.kind === 'orphan') && f.unitId) {
      if (!unitIds.has(f.unitId)) {
        skipped += 1;
        continue;
      }
      if (overriddenUnitIds.has(f.unitId)) continue;
      if (pages && (linesByUnit.get(f.unitId) ?? 0) <= 1) {
        skipped += 1;
        continue;
      }
      overriddenUnitIds.add(f.unitId);
      overrides.push({
        id: `shas-keep-${f.kind}-${f.unitId}-${f.pageNumber}`,
        ruleId: 'paragraph.allowContinuationAcrossPages',
        category: 'paragraph',
        enabled: true,
        priority: 'HARD_USER_RULE',
        isHardConstraint: false,
        value: false,
        source: 'local',
        scope: { unitId: f.unitId },
        keepTogetherUnitIds: [f.unitId],
        description: `תיקון ש״ס אוטומטי: ${f.kind === 'widow' ? 'אלמנה' : 'יתום'} בעמוד ${f.pageNumber}`,
      });
      fixed += 1;
    } else if (!f.autoFixable) {
      skipped += 1;
    }
  }
  return { links: nextLinks, overrides, fixedCount: fixed, skippedCount: skipped };
}

/**
 * Vilna defaults for the current design settings (pure — returns new settings):
 * - every Perek (chapter) title centred at the top;
 * - Gemara justified;
 * - traditional second-row indent: NO first-line indent, a hanging indent
 *   on the SECOND and later rows of Gemara paragraphs;
 * - dibbur hamatchil bold.
 */
export function applyVilnaShasDefaults(settings: ProfessionalDesignSettings): ProfessionalDesignSettings {
  let next = DesignSettingsEngine.updateRoleStyle(
    settings,
    'chapter',
    { paragraph: { alignment: 'center' } },
    'user',
    'Vilna Shas: perek title centred'
  ).settings;
  next = DesignSettingsEngine.updateRoleStyle(
    next,
    'main_source',
    { paragraph: { alignment: 'justify', firstLineIndentPt: 0, hangingIndentPt: 12 } },
    'user',
    'Vilna Shas: second-row indent'
  ).settings;
  next = DesignSettingsEngine.updateRavTextSettings(next, { dibburHamatchilBold: true }, 'user');
  // v0.8.0 Part C (§7): Vilna defaults also switch the centred decorative
  // Michtav box on for the first daf (toggleable in the design panel).
  // Layout training T2.2 — the Vilna opening is the framed first word in
  // the Gemara column (the full-width Michtav strip is not Vilna).
  next = DesignSettingsEngine.updateRavTextSettings(
    next,
    {
      michtavEnabled: false,
      openingDecoration: {
        ...DEFAULT_OPENING_DECORATION,
        ...(next.ravText?.openingDecoration ?? {}),
        enabled: true,
        scope: 'masechet_start',
      },
    },
    'user'
  );
  // Layout training T2.1 — the Vilna running head (perek name, perek
  // number, masechta; folio on the outer corner).
  next = DesignSettingsEngine.updatePageElementsSettings(
    next,
    {
      runningHeader: {
        ...DEFAULT_RUNNING_HEADER_SETTINGS,
        ...(next.pageElements?.runningHeader ?? {}),
        useStructuredVilnaHeader: true,
      },
    },
    'user'
  );
  return next;
}

/** Secondary Vilna commentaries as tiers 4–7 (outer / bottom margins, distinct rules).
 * v0.8.0 Part C (§2): the old list gave Torah Or AND Masoret HaShas the
 * same tierIndex 6, so `sanitizeTierConfigs` (de-dupe by tierIndex, last
 * wins) silently dropped Torah Or. Each commentary now has its own index.
 * All four share the `tertiary_comment` role and render in the one
 * tertiary band below the knee (see pagination-engine); tier 4 carries
 * the band's typography, tiers 5–7 name the commentaries in the band. */
export const SECONDARY_COMMENTARY_TIERS: TierConfig[] = [
  { role: 'tertiary_comment', tierIndex: 4, labelHe: 'עין משפט', labelEn: 'Ein Mishpat', widthPct: 18, fontSizePt: 9, lineHeight: 1.25, side: 'outside' },
  { role: 'tertiary_comment', tierIndex: 5, labelHe: 'נר מצווה', labelEn: 'Ner Mitzvah', widthPct: 18, fontSizePt: 9, lineHeight: 1.25, side: 'outside' },
  { role: 'tertiary_comment', tierIndex: 6, labelHe: 'תורה אור', labelEn: 'Torah Or', widthPct: 18, fontSizePt: 9, lineHeight: 1.25, side: 'below' },
  { role: 'tertiary_comment', tierIndex: 7, labelHe: 'מסורת הש״ס', labelEn: 'Masoret HaShas', widthPct: 18, fontSizePt: 9, lineHeight: 1.25, side: 'below' },
];

/**
 * A centred decorative / Michtav box above the Gemara text (the "Chavel"
 * box): a header-role custom-layout box, centred, spanning the Gemara
 * column width. The caller saves it as the page's custom-layout box.
 * v0.8.0 Part C (§7): the id is stable (derived from the text), not
 * `Date.now()` — the box is created on every pagination, and a fresh id
 * each time broke React keys and made the box unfindable across renders.
 * Wired in: `paginateRavText` places it on the first Vilna page when
 * `ravText.michtavEnabled` is on (see pagination-engine).
 */
export function buildMichtavBox(text: string): CustomLayoutBox {
  const slug = (text || 'michtav').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 24) || 'michtav';
  return {
    id: `michtav-${slug}`,
    role: 'header',
    labelHe: text ? `תיבת מכתב: ${text.slice(0, 24)}` : 'תיבת מכתב',
    labelEn: 'Michtav box',
    // v0.8.0 Part C (§7): the text to render inside the box.
    text: text || '',
    xPct: 20,
    yPct: 2,
    widthPct: 60,
    heightPct: 8,
  };
}

/** Semantic classification for a raw .docx paragraph (Vilna Shas).
 *
 * v0.9.0 Part C — marginalia from the Vilna Daf anatomy (reference photo
 * `~/workspace/user/files/10450_3_ketm.png`, structural reference only):
 * Gilyon ha-Shas (R. Akiva Eiger) and Hagahot ha-Bach (R. Yoel Sirkis)
 * are marginal notes → `side_note`; the tractate-dependent outer-margin
 * commentaries (Rabbeinu Chananel, Rabbeinu Nissim / Ran, Ramban, Rashba,
 * Ritva, Maharsha) → `secondary_comment` with their own style name;
 * Targum Onkelos → `primary_comment`. The header band (daf/folio number,
 * running header) → `page_element`. The importer calls this before the
 * Yiddish classifier, so a Hebrew paragraph that matches a Shas pattern
 * keeps its Shas role.
 */
export function classifyShasParagraph(
  text: string,
  styleVal: string
): { role: ContentRole; styleName: string } | null {
  const style = (styleVal || '').toLowerCase();
  const t = text.trim();
  if (style.includes('mishna') || t.startsWith('משנה') || t.startsWith('מִשְׁנָה')) {
    return { role: 'main_source', styleName: 'Mishna' };
  }
  // v0.9.0 Part C — header band: daf/folio number or running header.
  if (
    style.includes('folio') || style.includes('running header') || style.includes('header') ||
    /^(דף\s+[א-ת]+[׳״]?\s*[אב]?\s*\.?|מסכת\s+\S+\s+דף\s+[א-ת])/.test(t)
  ) {
    return { role: 'page_element', styleName: 'Running Header / Folio' };
  }
  if (/^(עין משפט|עֵין מִשְׁפָּט)/.test(t) || style.includes('ein mishpat') || style.includes('ein_mishpat')) {
    return { role: 'tertiary_comment', styleName: 'Ein Mishpat' };
  }
  if (/^(נר מצוה|נר מצווה)/.test(t) || style.includes('ner mitzvah')) {
    return { role: 'tertiary_comment', styleName: 'Ner Mitzvah' };
  }
  if (/^(תורה אור|תּוֹרָה אוֹר)/.test(t) || style.includes('torah or')) {
    return { role: 'tertiary_comment', styleName: 'Torah Or' };
  }
  if (/^(מסורת הש״ס|מסורת השס|מסו׳ הש״ס)/.test(t) || style.includes('masoret')) {
    return { role: 'tertiary_comment', styleName: 'Masoret HaShas' };
  }
  // v0.9.0 Part C — marginal notes from the Vilna anatomy.
  if (/^(גליון|גליון הש״ס|גליון השס)/.test(t) || style.includes('gilyon')) {
    return { role: 'side_note', styleName: 'Gilyon HaShas' };
  }
  if (/^(הגהות|הגהת הב״ח|הגהות הב״ח|ב״ח)/.test(t) || style.includes('hagahot') || style.includes('habach')) {
    return { role: 'side_note', styleName: 'Hagahot HaBach' };
  }
  // v0.9.0 Part C — tractate-dependent outer-margin commentaries.
  if (/^(רבינו חננאל|ר"ח)/.test(t) || style.includes('chananel')) {
    return { role: 'secondary_comment', styleName: 'Rabbeinu Chananel' };
  }
  if (/^(ר״ן|רבינו ניסים)/.test(t) || /(^|[^a-z])ran([^a-z]|$)/.test(style) || style.includes('rabbeinu nissim')) {
    return { role: 'secondary_comment', styleName: 'Rabbeinu Nissim (Ran)' };
  }
  if (/^(רמב״ן|רמב"ן)/.test(t) || style.includes('ramban')) {
    return { role: 'secondary_comment', styleName: 'Ramban' };
  }
  if (/^(אבן עזרא|אב"ע|ראב"ע)/.test(t) || style.includes('ibn ezra') || style.includes('ibnezra')) {
    return { role: 'secondary_comment', styleName: 'Ibn Ezra' };
  }
  if (/^(ספורנו)/.test(t) || style.includes('sforno')) {
    return { role: 'secondary_comment', styleName: 'Sforno' };
  }
  if (/^(רלב״ג|רלב"ג)/.test(t) || style.includes('ralbag')) {
    return { role: 'secondary_comment', styleName: 'Ralbag' };
  }
  if (/^(רשב״א|רשב"א)/.test(t) || style.includes('rashba')) {
    return { role: 'secondary_comment', styleName: 'Rashba' };
  }
  if (/^(ריטב״א|ריטב"א)/.test(t) || style.includes('ritva')) {
    return { role: 'secondary_comment', styleName: 'Ritva' };
  }
  if (/^(מהרש״א|מהרש"א)/.test(t) || style.includes('maharsha')) {
    return { role: 'secondary_comment', styleName: 'Maharsha' };
  }
  if (/^(אונקלוס|תרגום אונקלוס)/.test(t) || style.includes('onkelos')) {
    return { role: 'primary_comment', styleName: 'Onkelos' };
  }
  if (/^(מראה מקום|מראי מקום|עיין|עי׳)/.test(t) || style.includes('cross_reference') || style.includes('marginal')) {
    return { role: 'cross_reference', styleName: 'Marginal reference' };
  }
  return null;
}

/** Natural-language Vilna layout commands (Hebrew + English), local parser. */
export interface ShasCommand {
  action: 'verify_dibbur' | 'fix_shas_flaws' | 'apply_vilna_defaults' | 'move_rashi' | 'expand_tosafot' | 'verify_folio_sequence' | 'check_footer_alignment';
  replyHe: string;
  data: Record<string, unknown>;
}

export function parseShasCommand(userText: string): ShasCommand | null {
  const lower = userText.toLowerCase();
  const norm = lower.replace(/[־–—-]/g, ' ');
  if (norm.includes('קרב את רשי') || norm.includes('קרב את רש״י') || norm.includes('הזז את רשי') || norm.includes('move rashi closer') || norm.includes('move rashi')) {
    return { action: 'move_rashi', replyHe: 'אקרב את רש״י לעמודת הגמרא (הקטנת המרווח). יש לאשר בכרטיס.', data: { closer: true } };
  }
  if (norm.includes('הרחב את תוספות') || norm.includes('הרחב תוספות') || norm.includes('expand tosafot')) {
    return { action: 'expand_tosafot', replyHe: 'ארחיב את טור תוספות. יש לאשר בכרטיס.', data: { widthPct: 30 } };
  }
  if (norm.includes('בדוק יישור') && norm.includes('הערות') || norm.includes('check alignment of footer') || norm.includes('check footer alignment')) {
    return { action: 'check_footer_alignment', replyHe: 'אבדוק את יישור הערות השוליים בכל הדפים.', data: {} };
  }
  if (norm.includes('בדוק רצף') && (norm.includes('דף') || norm.includes('עמוד')) || norm.includes('verify folio pagination') || norm.includes('folio pagination sequence') || norm.includes('בדוק את רצף הדפים')) {
    return { action: 'verify_folio_sequence', replyHe: 'אבדוק את רצף מספרי הדפים (א׳/ב׳).', data: {} };
  }
  if (norm.includes('בדוק דיבור') || norm.includes('אמת דיבור') || norm.includes('verify dibbur') || norm.includes('check dibbur')) {
    return { action: 'verify_dibbur', replyHe: 'אאמת שכל דיבור מתחיל תואם את מילות הגמרא.', data: {} };
  }
  if (norm.includes('תקן') && (norm.includes('ש״ס') || norm.includes('שגיאות עימוד') || norm.includes('פגמים')) || norm.includes('fix shas') || norm.includes('fix vilna')) {
    return { action: 'fix_shas_flaws', replyHe: 'אסרוק את הדפים לפגמי עימוד ש״ס ואתקן את הניתנים לתיקון אוטומטי.', data: {} };
  }
  if (norm.includes('החל כללי ש״ס') || norm.includes('כללי וילנא') || norm.includes('apply vilna') || norm.includes('vilna defaults')) {
    return { action: 'apply_vilna_defaults', replyHe: 'אחיל את כללי וילנא: כותרת פרק ממורכזת, הזחה בשורה השנייה, דיבור מודגש.', data: {} };
  }
  return null;
}
