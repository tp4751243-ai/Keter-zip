/**
 * v0.8.0 Part D — Native Yiddish Sefarim Support.
 *
 * NOTE ON "TRAINING": as with the Vilna module, there is no model training
 * here. Everything in this module is deterministic: detection heuristics
 * (Yiddish-only codepoints + function-word scoring), a semantic classifier
 * (Tzenerene / Chassidic commentary / translation / Biur / Hebrew source),
 * orthography helpers that keep Yiddish digraphs and orthographic dagesh
 * intact, facing-column geometry, and Gemini system-prompt context. That
 * is stated here and in PART-D-NOTES.md.
 *
 * The Yiddish support EXTENDS the existing Hebrew systems instead of
 * building a second one:
 * - Roles are the existing ContentRoles (`main_source`,
 *   `primary_comment`, `secondary_comment`, `chapter`, `heading`,
 *   `footnote`); the Yiddish kind travels on `ContentUnit.yiddishKind`
 *   and `ContentUnit.language = 'yi'`, so every existing stream, tier,
 *   exporter and QA check keeps working.
 * - The paginator (`paginateYiddishSefer`) reuses `TypesetterEngine`
 *   shaping, `SpatialExclusionEngine` collision checks, the anchored
 *   footnote resolver and the Hebrew-gematria folio numbering.
 * - The .docx importer calls `classifyYiddishParagraph` in the same
 *   chain as `classifyShasParagraph`.
 * - The AI reuses the validated `GEMINI_ACTION_TYPES` list + approval
 *   cards; three Yiddish action types were added there.
 *
 * Orthography facts the code below is built on (verified against the
 * Unicode chart, not assumed):
 * - Yiddish-only letters: U+05F0 װ (double vav), U+05F1 ױ (vav + yod),
 *   U+05F2 ײ (double yod). They are single codepoints, NOT two letters,
 *   and must never be split, reordered or folded.
 * - פּ (pe + dagesh U+05BC) = /p/ vs פ = /f/; פֿ (fe + rafe U+05BF)
 *   = /f/ vs ף/פ. The dagesh/rafe after pe/fe/beis is ORTHOGRAPHIC in
 *   Yiddish, not nikud — stripping it (as `NikudEngine.removeNikud`
 *   does for Hebrew) changes the word. `stripDiacriticsYiddishSafe`
 *   preserves it; `NikudEngine.processUnits` now skips Yiddish units.
 * - Yiddish text is usually unpointed, but pointed Yiddish (and Hebrew
 *   quotes inside Yiddish text) must keep combining marks attached to
 *   their base letter, including after a Yiddish digraph — the shaper's
 *   `canonicalReorder` now treats U+05F0–U+05F2 as base letters.
 * - The Hebrew search engine's ktiv normalisation drops medial/final
 *   ו/י and folds final letters; applied to Yiddish that destroys words
 *   (װ/ױ/ײ are built from ו/י, and ף must not fold to פ). `findAll`
 *   now detects Yiddish text and disables both for it.
 */
import type {
  ContentRole,
  ContentUnit,
  PageTypesetResult,
  TierConfig,
  YiddishKind,
} from '../types/typesetter';
import type { ProfessionalDesignSettings } from '../types/design-settings';
import { DesignSettingsEngine } from './design-settings-engine';

/** Yiddish-only codepoints: double vav, vav-yod, double yod. */
export const YIDDISH_DIGRAPH_CHARS = ['װ', 'ױ', 'ײ'] as const;
export const YIDDISH_DIGRAPH_RE = /[װױײ]/g;
/** Single-codepoint test (no /g/ state). */
const YIDDISH_DIGRAPH_TEST = /[װױײ]/;
/** Rafe U+05BF (פֿ) and dagesh U+05BC (פּ) — orthographic in Yiddish. */
export const YIDDISH_ORTHOGRAPHIC_MARKS = { dagesh: 'ּ', rafe: 'ֿ' } as const;

/**
 * Common Yiddish function words, used ONLY as scoring evidence, never as
 * proof on their own. Words that also occur in Hebrew/Aramaic (אין, אז,
 * דא, איך in the sense of "how") are deliberately NOT in this list.
 */
export const YIDDISH_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'איז', 'זענען', 'און', 'פון', 'מיט', 'צו', 'דאס', 'דעם', 'דער', 'די',
  'ווי', 'ווען', 'וואס', 'ווער', 'ווו', 'דארט', 'נישט', 'איך', 'דו', 'ער',
  'זי', 'מיר', 'איר', 'זיי', 'האט', 'האבן', 'געווען', 'געווארן', 'אבער',
  'ווייל', 'אזוי', 'איצט', 'יעצט', 'שוין', 'אלע', 'אלעס', 'נאר', 'קען',
  'וויל', 'מוז', 'זאל', 'פאר', 'אויף', 'אונטער', 'איבער', 'נאך', 'ביים',
  'ביי', 'אן', 'דורך', 'אליין', 'אנדערע', 'יעדע', 'יעדער', 'קיין',
  'נאכדעם', 'דערנאך', 'דערפאר', 'דעריבער', 'איז', 'עס',
]);

/** Words that are Yiddish-only spellings even without a digraph. */
const YIDDISH_ONLY_SPELLINGS = /\b(גע\w+ט|גע\w+ן|איז|זענען|נישט|און|פון)\b/;

export interface YiddishDetection {
  /** True when the evidence clears the threshold (see scoring below). */
  isYiddish: boolean;
  /** 0..1 evidence score. */
  score: number;
  /** Count of Yiddish-only codepoints (װ ױ ײ). */
  digraphCount: number;
  /** Distinct Yiddish function words found. */
  functionWordHits: string[];
  /** Human-readable evidence, for logs and the QA panel. */
  evidence: string[];
}

function tokenizeWords(text: string): string[] {
  return text.split(/[\s״"'.:;,\-–—()[\]!?׀]+/).filter(Boolean);
}

/**
 * Score-based Yiddish detection. A single digraph is strong evidence
 * (0.45) but not sufficient alone for a one-letter fragment; two distinct
 * function words (0.30) or a Yiddish-only spelling pattern also clear
 * the 0.30 threshold. Plain Hebrew (Berakhot sample, Gemara, Chumash)
 * scores 0 — verified in scripts/partD-smoke.ts.
 */
export function detectYiddish(text: string): YiddishDetection {
  const evidence: string[] = [];
  const digraphs = text.match(YIDDISH_DIGRAPH_RE);
  const digraphCount = digraphs ? digraphs.length : 0;
  if (digraphCount > 0) evidence.push(`${digraphCount} Yiddish digraph(s) (װ/ױ/ײ)`);

  const words = tokenizeWords(text);
  const hits: string[] = [];
  for (const w of words) {
    const bare = w.replace(/[֑-ׇ]/g, '');
    if (YIDDISH_FUNCTION_WORDS.has(bare) && !hits.includes(bare)) hits.push(bare);
  }
  if (hits.length > 0) evidence.push(`Yiddish function words: ${hits.slice(0, 6).join(', ')}`);

  // The גע- prefix (past participles: געווען, געשריבן, געמאכט) is
  // near-universal in Yiddish and rare in Hebrew text.
  const geCount = words.filter(w => /^גע[\u05D0-\u05EAװױײ]{2,}/.test(w.replace(/[֑-ׇ]/g, ''))).length;
  if (geCount > 0) evidence.push(`${geCount} גע- participle(s)`);

  const hasSpelling = YIDDISH_ONLY_SPELLINGS.test(text);
  if (hasSpelling) evidence.push('Yiddish-only spelling pattern');

  const score = Math.min(
    1,
    (digraphCount > 0 ? 0.45 : 0) +
      Math.min(0.45, hits.length * 0.15) +
      (hasSpelling ? 0.1 : 0) +
      (geCount > 0 ? 0.1 : 0)
  );
  return { isYiddish: score >= 0.3 && words.length > 0, score, digraphCount, functionWordHits: hits, evidence };
}

/** True when the text is Yiddish-dominant (used by the search engine). */
export function isYiddishDominant(text: string): boolean {
  return detectYiddish(text).isYiddish;
}

// ---------------------------------------------------------------------------
// Mixed Yiddish–Hebrew typography: per-word script runs.
// ---------------------------------------------------------------------------

export interface ScriptRun {
  script: 'he' | 'yi' | 'other';
  text: string;
}

/**
 * Split text into maximal runs of Yiddish words, Hebrew words and
 * everything else (numbers, punctuation, Latin). A word is Yiddish when
 * it contains a Yiddish digraph or is a Yiddish function word; a word of
 * plain Hebrew letters is Hebrew. The renderer keeps each run's original
 * characters — this function only labels runs, so BiDi ordering and font
 * fallback can be applied per run (both scripts are RTL, so the visual
 * order is the logical order; the run labels exist so a font without
 * U+05F0–U+05F2 can fall back per run instead of showing tofu).
 */
export function detectScriptRuns(text: string): ScriptRun[] {
  const runs: ScriptRun[] = [];
  const tokens = text.split(/(\s+)/);
  for (const tok of tokens) {
    if (!tok) continue;
    let script: ScriptRun['script'];
    if (/^\s+$/.test(tok)) {
      script = 'other';
    } else if (
      YIDDISH_DIGRAPH_TEST.test(tok) ||
      YIDDISH_FUNCTION_WORDS.has(tok.replace(/[֑-ׇ]/g, '')) ||
      // גע- past participles (געשריבן, געמאכט) are Yiddish.
      /^גע[\u05D0-\u05EAװױײ]{2,}/.test(tok.replace(/[֑-ׇ]/g, ''))
    ) {
      script = 'yi';
    } else if (/[\u05D0-\u05EA]/.test(tok)) {
      script = 'he';
    } else {
      script = 'other';
    }
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.text += tok;
    else runs.push({ script, text: tok });
  }
  return runs.filter(r => r.text.length > 0);
}

/** True when a line/paragraph mixes Yiddish and Hebrew words. */
export function isMixedYiddishHebrew(text: string): boolean {
  const scripts = new Set(detectScriptRuns(text).map(r => r.script));
  return scripts.has('yi') && scripts.has('he');
}

// ---------------------------------------------------------------------------
// Orthography: match canonicalisation + nikud-safe stripping.
// ---------------------------------------------------------------------------

/**
 * Canonical form for MATCHING only (never for display): folds the
 * two-letter spellings וו/וי/יי to the single-codepoint digraphs װ/ױ/ײ
 * and strips nikud/taamim EXCEPT dagesh (U+05BC), which is orthographic
 * in Yiddish (פּ vs פ). Both sides of a comparison must be passed
 * through this function. Final letters are NOT folded: in Yiddish ף
 * (final fe) and פ/פּ are distinct letters.
 */
export function canonicalizeYiddishForMatch(text: string): string {
  return text
    .replace(/וו/g, 'װ')
    .replace(/וי/g, 'ױ')
    .replace(/יי/g, 'ײ')
    .replace(/[֑-ְֱֲֳִֵֶַָׇֹֻֿׁׂׅ֯ׄ]/g, '');
}

/**
 * Remove nikud and taamim but keep the dagesh that is orthographic in
 * Yiddish: a dagesh after פ/ב/כ/ג/ד/ת/װ (פּ/בּ/כּ …) is a letter
 * distinction, not a vowel mark, and survives. A dagesh anywhere else
 * (e.g. inside a Hebrew quote) is removed like any other nikud mark.
 * The rafe (ֿ, U+05BF, in פֿ) is always kept.
 */
export function stripDiacriticsYiddishSafe(text: string): string {
  const chars = Array.from(text);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x05bc) {
      // A dagesh is orthographic when its BASE letter is פ/ב/כ/ג/ד/ת/װ.
      // Look back past any intervening combining marks: pointed text
      // may order the vowel before the dagesh (דָּ), so the immediately
      // preceding character is not always the base letter.
      let base = '';
      for (let j = i - 1; j >= 0; j--) {
        const bcp = chars[j].codePointAt(0) ?? 0;
        if (bcp >= 0x0591 && bcp <= 0x05c7) continue;
        base = chars[j];
        break;
      }
      out += ['פ', 'ב', 'כ', 'ג', 'ד', 'ת', 'װ'].includes(base) ? ch : '';
      continue;
    }
    if (cp === 0x05bf) {
      out += ch; // rafe — always orthographic (פֿ)
      continue;
    }
    if ((cp >= 0x0591 && cp <= 0x05af) || (cp >= 0x05b0 && cp <= 0x05bb) || cp === 0x05c1 || cp === 0x05c2 || cp === 0x05c4 || cp === 0x05c5 || cp === 0x05c7) {
      continue; // taamim / nikud / shin-sin dots — drop
    }
    out += ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classification (mirrors classifyShasParagraph's shape).
// ---------------------------------------------------------------------------

export interface YiddishClassification {
  role: ContentRole;
  styleName: string;
  yiddishKind: YiddishKind;
  language: 'yi' | 'he';
}

const PARSHA_HEADING_RE = /^(פרשת|פרשה|פ׳)\s+\S+/;
const TZENERENE_OPEN_RE = /^(צאינה וראינה|צאינה|צ״ו|צאינה־וראינה)/;

/**
 * Semantic classification for a raw .docx paragraph (Yiddish sefarim).
 * Checked by the importer AFTER the Shas classifier, so a Hebrew
 * paragraph that happens to match a Shas pattern keeps its Shas role.
 * Returns null when the paragraph is not recognisably Yiddish.
 */
export function classifyYiddishParagraph(
  text: string,
  styleVal: string
): YiddishClassification | null {
  const style = (styleVal || '').toLowerCase();
  const t = text.trim();
  if (!t) return null;
  const det = detectYiddish(t);
  const styleSaysYiddish =
    style.includes('yiddish') ||
    style.includes('tzenerene') ||
    style.includes('tzena') ||
    style.includes('tsene') ||
    style.includes('yidish') ||
    style.includes('צאינה') ||
    style.includes('יידיש');

  // Parsha / section heading in the traditional style: "פרשת בראשית"
  // followed by Yiddish text, or a Tzenerene opening line.
  if (PARSHA_HEADING_RE.test(t) && (det.isYiddish || styleSaysYiddish)) {
    return { role: 'chapter', styleName: 'Tzenerene Parsha Heading', yiddishKind: 'tzenerene', language: 'yi' };
  }
  if (TZENERENE_OPEN_RE.test(t)) {
    return { role: 'heading', styleName: 'Tzenerene Opening', yiddishKind: 'tzenerene', language: 'yi' };
  }
  if (style.includes('tzenerene') || style.includes('tzena') || style.includes('tsene') || style.includes('צאינה')) {
    return { role: 'main_source', styleName: 'Tzenerene', yiddishKind: 'tzenerene', language: 'yi' };
  }
  if (style.includes('chassidic') || style.includes('chassidus') || style.includes('חסיד')) {
    return { role: 'primary_comment', styleName: 'Chassidic Commentary', yiddishKind: 'chassidic_commentary', language: 'yi' };
  }
  if (
    style.includes('translation') ||
    style.includes('איבערזעצונג') ||
    style.includes('yiddish translation') ||
    /^(תרגום|איבערזעצונג)/.test(t)
  ) {
    return { role: 'primary_comment', styleName: 'Yiddish Translation', yiddishKind: 'translation', language: 'yi' };
  }
  if (style.includes('biur') || style.includes('ביאור') || /^(ביאור|ביאורים)/.test(t)) {
    return { role: 'secondary_comment', styleName: 'Biur', yiddishKind: 'biur', language: 'yi' };
  }
  if (det.isYiddish || styleSaysYiddish) {
    return { role: 'main_source', styleName: 'Yiddish Text', yiddishKind: 'yiddish_text', language: 'yi' };
  }
  return null;
}

/**
 * Re-classify already-imported units as Yiddish where the classifier
 * recognises them. Pure — returns new unit objects. Units that already
 * carry a yiddishKind keep it; Hebrew units are left untouched.
 */
export function reclassifyYiddishUnits(units: ContentUnit[]): {
  units: ContentUnit[];
  changed: number;
  classified: Array<{ id: string; kind: YiddishKind }>;
} {
  let changed = 0;
  const classified: Array<{ id: string; kind: YiddishKind }> = [];
  const next = units.map(u => {
    if (u.yiddishKind) return u;
    const c = classifyYiddishParagraph(u.rawText, u.styleName);
    if (!c) {
      // Still stamp the language when detection is confident but the
      // paragraph matched no specific structure (e.g. a short Yiddish
      // line inside a Hebrew book).
      if (detectYiddish(u.rawText).score >= 0.45 && u.language !== 'yi') {
        changed += 1;
        return { ...u, language: 'yi' as const };
      }
      return u;
    }
    changed += 1;
    classified.push({ id: u.id, kind: c.yiddishKind });
    return { ...u, role: c.role, styleName: c.styleName, yiddishKind: c.yiddishKind, language: c.language };
  });
  return { units: next, changed, classified };
}

// ---------------------------------------------------------------------------
// Layout: tiers, facing columns, heading defaults.
// ---------------------------------------------------------------------------

/** Yiddish tiers for the facing layout (Hebrew source + Yiddish text). */
export const YIDDISH_TIERS: TierConfig[] = [
  { role: 'main_source', tierIndex: 1, labelHe: 'מקור עברי', labelEn: 'Hebrew source', widthPct: 45, fontSizePt: 14.5, lineHeight: 1.32, side: 'right' },
  { role: 'primary_comment', tierIndex: 2, labelHe: 'תרגום יידיש', labelEn: 'Yiddish translation', widthPct: 55, fontSizePt: 11, lineHeight: 1.32, side: 'left' },
  { role: 'secondary_comment', tierIndex: 3, labelHe: 'ביאור', labelEn: 'Biur', widthPct: 100, fontSizePt: 10, lineHeight: 1.3, side: 'below' },
];

/**
 * Facing-column sides for the same-page Yiddish/Hebrew layout. In an
 * RTL book the first column is the RIGHT one, so the Hebrew source —
 * the text being translated/commented on — sits on the right and the
 * Yiddish text on the left, on every page (no verso mirroring: the two
 * texts face each other across the gutter, they do not swap sides).
 *
 * NOT built: whole-page spread facing (Hebrew on the right-hand page of
 * a spread, Yiddish on the left-hand page). The paginator is page-local
 * and has no spread-level pairing; the same-page facing columns carry
 * the same content and are the form most Yiddish sefarim actually use
 * for a translation. Recorded as a gap in PART-D-NOTES.md.
 */
export function yiddishFacingColumns(): { hebrew: 'right' | 'left'; yiddish: 'right' | 'left' } {
  return { hebrew: 'right', yiddish: 'left' };
}

/**
 * Yiddish defaults for the current design settings (pure — returns new
 * settings), mirroring `applyVilnaShasDefaults`:
 * - every parsha (chapter) heading centred, with breathing room above
 *   and below — the traditional Tzenerene heading style;
 * - Yiddish body text justified, no first-line indent (the Vilna
 *   second-row indent is NOT applied: Yiddish running text does not
 *   use the Gemara hanging indent);
 * - Yiddish translation/commentary justified at commentary size.
 */
export function applyYiddishHeadingDefaults(settings: ProfessionalDesignSettings): ProfessionalDesignSettings {
  let next = DesignSettingsEngine.updateRoleStyle(
    settings,
    'chapter',
    {
      character: { fontSizePt: 17 },
      paragraph: { alignment: 'center', spaceBeforePt: 12, spaceAfterPt: 8 },
    },
    'user',
    'Yiddish: parsha heading centred'
  ).settings;
  next = DesignSettingsEngine.updateRoleStyle(
    next,
    'main_source',
    { paragraph: { alignment: 'justify', firstLineIndentPt: 0, hangingIndentPt: 0 } },
    'user',
    'Yiddish: body justified, no first-line indent'
  ).settings;
  next = DesignSettingsEngine.updateRoleStyle(
    next,
    'primary_comment',
    { paragraph: { alignment: 'justify' } },
    'user',
    'Yiddish: translation justified'
  ).settings;
  return next;
}

// ---------------------------------------------------------------------------
// Verification: folios + placed-text integrity.
// ---------------------------------------------------------------------------

export interface YiddishFolioCheck {
  ok: boolean;
  checked: number;
  badPages: number[];
}

/** Yiddish folios use the same Hebrew-gematria numbering as the rest of the book. */
export function verifyYiddishFolios(pages: PageTypesetResult[]): YiddishFolioCheck {
  const badPages: number[] = [];
  pages.forEach((pg, i) => {
    if (!pg.pageNumberHebrew || !pg.pageNumberHebrew.trim()) badPages.push(pg.pageNumber);
    if (i > 0 && pg.pageNumber !== pages[i - 1].pageNumber + 1) badPages.push(pg.pageNumber);
  });
  return { ok: badPages.length === 0, checked: pages.length, badPages };
}

export type YiddishFlawKind =
  | 'yiddish_unit_dropped'
  | 'yiddish_digraph_lost'
  | 'yiddish_wrong_column';

export interface YiddishFlaw {
  kind: YiddishFlawKind;
  pageNumber: number;
  unitId?: string;
  messageHe: string;
}

/**
 * Scan typeset pages for Yiddish integrity failures:
 * - a Yiddish unit with no line on any page (dropped);
 * - a Yiddish digraph present in the source unit but missing from its
 *   placed lines (mangled / split);
 * - a Hebrew-source unit placed in the Yiddish column or vice versa.
 * The paginator is built so these cannot happen silently; this scan is
 * the independent check the smoke test runs against its output.
 */
export function scanYiddishFlaws(pages: PageTypesetResult[], units: ContentUnit[]): YiddishFlaw[] {
  const flaws: YiddishFlaw[] = [];
  const placedByUnit = new Map<string, { lines: number; inSource: boolean; inCol2: boolean; text: string }>();
  for (const pg of pages) {
    for (const l of pg.sourceLines) {
      const e = placedByUnit.get(l.unitId) ?? { lines: 0, inSource: false, inCol2: false, text: '' };
      e.lines += 1;
      e.inSource = true;
      e.text += l.words.map(w => w.text).join(' ');
      placedByUnit.set(l.unitId, e);
    }
    for (const l of pg.column2Lines ?? []) {
      const e = placedByUnit.get(l.unitId) ?? { lines: 0, inSource: false, inCol2: false, text: '' };
      e.lines += 1;
      e.inCol2 = true;
      e.text += l.words.map(w => w.text).join(' ');
      placedByUnit.set(l.unitId, e);
    }
  }
  for (const u of units) {
    if (u.role === 'footnote') continue;
    const isYiddish = u.language === 'yi' || !!u.yiddishKind;
    const isHebrewSource = u.yiddishKind === 'hebrew_source' || (u.language === 'he' && u.role === 'main_source');
    const placed = placedByUnit.get(u.id);
    if (!placed || placed.lines === 0) {
      if (u.rawText.trim().length > 0) {
        flaws.push({
          kind: 'yiddish_unit_dropped',
          pageNumber: 0,
          unitId: u.id,
          messageHe: `יחידה ${u.id} לא הוצבה על אף עמוד.`,
        });
      }
      continue;
    }
    if (isYiddish) {
      const srcDigraphs = (u.rawText.match(YIDDISH_DIGRAPH_RE) ?? []).length;
      const placedDigraphs = (placed.text.match(YIDDISH_DIGRAPH_RE) ?? []).length;
      if (srcDigraphs > 0 && placedDigraphs < srcDigraphs) {
        flaws.push({
          kind: 'yiddish_digraph_lost',
          pageNumber: 0,
          unitId: u.id,
          messageHe: `יחידה ${u.id}: ${srcDigraphs - placedDigraphs} דיגרף/ים יידיש אבדו בעימוד.`,
        });
      }
      if (placed.inSource && !placed.inCol2 && u.yiddishKind === 'translation') {
        flaws.push({
          kind: 'yiddish_wrong_column',
          pageNumber: 0,
          unitId: u.id,
          messageHe: `יחידת תרגום ${u.id} הוצבה בטור העברי במקום בטור היידיש.`,
        });
      }
    }
    if (isHebrewSource && placed.inCol2 && !placed.inSource) {
      flaws.push({
        kind: 'yiddish_wrong_column',
        pageNumber: 0,
        unitId: u.id,
        messageHe: `יחידת מקור עברי ${u.id} הוצבה בטור היידיש במקום בטור העברי.`,
      });
    }
  }
  return flaws;
}

// ---------------------------------------------------------------------------
// Natural-language Yiddish layout commands (Hebrew + English + Yiddish),
// local parser — mirrors parseShasCommand.
// ---------------------------------------------------------------------------

export interface YiddishCommand {
  action: 'apply_yiddish_defaults' | 'verify_yiddish_folio' | 'classify_yiddish_tiers';
  replyHe: string;
  data: Record<string, unknown>;
}

export function parseYiddishCommand(userText: string): YiddishCommand | null {
  const lower = userText.toLowerCase();
  const norm = lower.replace(/[־–—-]/g, ' ');
  if (
    norm.includes('החל כללי יידיש') ||
    norm.includes('כללי יידיש') ||
    norm.includes('apply yiddish defaults') ||
    norm.includes('yiddish defaults') ||
    norm.includes('צורת יידיש')
  ) {
    return { action: 'apply_yiddish_defaults', replyHe: 'אחיל את כללי היידיש: כותרת פרשה ממורכזת, גוף מיושר ללא הזחה בפתח.', data: {} };
  }
  if (
    (norm.includes('בדוק') && norm.includes('יידיש') && (norm.includes('דף') || norm.includes('עמוד') || norm.includes('רצף'))) ||
    norm.includes('verify yiddish folio') ||
    norm.includes('verify yiddish pagination') ||
    norm.includes('check yiddish folio')
  ) {
    return { action: 'verify_yiddish_folio', replyHe: 'אבדוק את רצף מספרי הדפים של הספר היידיש.', data: {} };
  }
  if (
    (norm.includes('סווג') || norm.includes('זהה') || norm.includes('סמן')) && norm.includes('יידיש') ||
    norm.includes('classify yiddish') ||
    norm.includes('detect yiddish') ||
    norm.includes('identify yiddish')
  ) {
    return { action: 'classify_yiddish_tiers', replyHe: 'אסווג מחדש את יחידות היידיש: צאינה וראינה, תרגום, ביאור ומקור עברי.', data: {} };
  }
  return null;
}
