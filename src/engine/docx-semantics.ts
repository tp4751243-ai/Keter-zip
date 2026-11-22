/**
 * v0.9.8 Phase 2 — DOCX semantic extraction (Hebrew).
 *
 * Pure helpers the DOCX importer calls. VERIFY-FIRST record — what the
 * v0.9.7 importer ALREADY did (left untouched here):
 * - Heading 1/2 styles, `פרק …` → chapter, `סימן …` → siman.
 * - `classifyShasParagraph` (vilna-shas.ts): `משנה …` → main_source,
 *   `דף …` / folio style → page_element (running header / folio),
 *   Ein Mishpat / Ner Mitzvah / Torah Or / Masoret HaShas → tertiary.
 * - Bold-lead dibbur, delimiter dibbur, source-match dibbur
 *   (`detectDibburFromSource`), ≥0.8 review queue, footnote units bound
 *   by sequential ID to a WORD index (`footnoteAnchorWordIndex`).
 * - `w:rPr` bold / italic / underline preserved into TextRuns.
 *
 * What this module ADDS (genuine gaps):
 * 1. `stripDirtyRunProperties` — removes dirty Word inline overrides
 *    (arbitrary `w:rFonts`, RGB `w:color`, `w:spacing`, `w:position`,
 *    shading/highlight, paragraph `w:spacing`) from the parsed XML
 *    while KEEPING bold/italic/underline and `w:sz` (size is semantic:
 *    small type marks citations). The importer never read styles.xml,
 *    so direct formatting was the only dirty source.
 * 2. `detectSectionHeader` — centered bold short lines → heading, and
 *    `סעיף X` → siman (+ seifLetter). `דף`/`משנה`/`פרק`/`סימן` are NOT
 *    re-implemented here: the v0.9.7 code above already owns them.
 * 3. `findCitationSpans` — parenthesised / bracketed Mareh Mekomos
 *    citations like (ברכות ב.) or [שם], tagged as citation spans.
 * 4. `findRemaGlossSpans` — Rema glosses (`הגה:` up to the next
 *    period/bracket) for Shulchan Aruch text.
 * 5. `tokenizeDibbur` — wraps the already-detected dibbur in a
 *    structured `DibburNode` { id, rawText, normalizedText,
 *    targetAnchorId, confidence } (explicit ד"ה / בד"ה prefix, bold
 *    lead, delimiter within the first 2–12 words, or source match).
 * 6. `sanitizeNikudText` — nikud SANITISATION (new: `nikud-engine.ts`
 *    only had remove/strip/apply, no sanitise function): NFC, drop
 *    orphan leading combining marks, collapse duplicate identical
 *    marks. Nikud itself is PRESERVED, never stripped on import.
 * 7. `ROLE_TYPOGRAPHY_DEFAULTS` — per-role typography using ONLY the
 *    fonts declared in `KETER_EMBEDDED_FONTS` (Frank Ruhl Libre,
 *    Noto Rashi Hebrew, David Libre). Vilna / Guttman / Drugulin /
 *    Taamey Frank / Rashi CLM are NOT bundled — see
 *    `BUNDLED_FONT_AVAILABILITY`; no font mapping is faked for them.
 * 8. `analyzeImportedDocx` — per-file preview stats for the wizard
 *    (word count, Perek/Daf/Pasuk markers, dibbur + footnote counts).
 */

import type { ContentRole, ContentUnit, DibburNode, TextRun } from '../types/typesetter';
import { normalizeHebrewForMatch, detectDibburFromSource } from './vilna-shas';
import { NikudEngine } from './nikud-engine';

/* ── 6. Nikud sanitisation ─────────────────────────────────────────── */

/**
 * Sanitise nikud/taamim WITHOUT removing them: normalise to NFC, drop
 * combining marks that have no base consonant to attach to (they render
 * as floating marks / clip), and collapse a run of the SAME mark
 * repeated on one base (a Word copy/paste artefact that collides).
 * Plain text without marks passes through unchanged.
 */
export function sanitizeNikudText(text: string): string {
  if (!text) return text;
  const nfc = text.normalize('NFC');
  const chars = Array.from(nfc);
  const out: string[] = [];
  let prevMark = '';
  let hasBase = false;
  for (const ch of chars) {
    const cp = ch.codePointAt(0) ?? 0;
    const isMark = (cp >= 0x0591 && cp <= 0x05bd) || cp === 0x05bf || cp === 0x05c1 || cp === 0x05c2 || cp === 0x05c4 || cp === 0x05c5 || cp === 0x05c7;
    if (isMark) {
      // Orphan mark (no base consonant yet in this word): drop it.
      if (!hasBase) continue;
      // Same mark twice on the same base: keep one.
      if (ch === prevMark) continue;
      prevMark = ch;
      out.push(ch);
      continue;
    }
    prevMark = '';
    // A Hebrew letter, a space, or punctuation resets the base tracker.
    hasBase = cp >= 0x05d0 && cp <= 0x05ea;
    out.push(ch);
  }
  return out.join('');
}

/** Re-export for callers that want the nikud engine's strip helpers. */
export { NikudEngine };

/* ── 1. Dirty Word inline overrides ───────────────────────────────── */

export interface StripDirtyResult {
  removedRunProps: number;
  removedParaSpacing: number;
}

/**
 * Walk a parsed word/document.xml DOM and strip dirty direct formatting:
 * - every `w:rPr`: `w:rFonts` (arbitrary fonts), `w:color` (RGB),
 *   `w:spacing` (random character spacing), `w:position` (raised/lowered),
 *   `w:shd` (shading), `w:highlight`.
 * - every `w:pPr`: `w:spacing` (random line/paragraph spacing overrides).
 * KEPT (semantic): `w:b` / `w:bCs` (bold = dibbur), `w:i`, `w:u`,
 * `w:sz` / `w:szCs` (size — small type marks citations), `w:jc`
 * (alignment — centred lines are section headers), `w:ind`, `w:pStyle`.
 */
export function stripDirtyRunProperties(docDom: Document): StripDirtyResult {
  let removedRunProps = 0;
  let removedParaSpacing = 0;
  const RUN_DIRTY = ['w:rFonts', 'w:color', 'w:spacing', 'w:position', 'w:shd', 'w:highlight'];
  const rPrs = docDom.getElementsByTagName('w:rPr');
  for (let i = 0; i < rPrs.length; i++) {
    const rPr = rPrs[i];
    for (const tag of RUN_DIRTY) {
      const nodes = rPr.getElementsByTagName(tag);
      // Live NodeList: remove from the end.
      for (let j = nodes.length - 1; j >= 0; j--) {
        const n = nodes[j];
        if (n.parentNode) {
          n.parentNode.removeChild(n);
          removedRunProps++;
        }
      }
    }
  }
  const pPrs = docDom.getElementsByTagName('w:pPr');
  for (let i = 0; i < pPrs.length; i++) {
    const nodes = pPrs[i].getElementsByTagName('w:spacing');
    for (let j = nodes.length - 1; j >= 0; j--) {
      const n = nodes[j];
      if (n.parentNode) {
        n.parentNode.removeChild(n);
        removedParaSpacing++;
      }
    }
  }
  return { removedRunProps, removedParaSpacing };
}

/** Read a run's point size from `w:sz w:val` (half-points in Word). */
export function runFontSizePt(rPr: Element | null | undefined): number | undefined {
  if (!rPr) return undefined;
  const sz = rPr.getElementsByTagName('w:sz')[0];
  const val = sz?.getAttribute('w:val');
  const n = val ? Number(val) : NaN;
  return Number.isFinite(n) && n > 0 ? n / 2 : undefined;
}

/** Most common run size in the document (the body size citations are small against). */
export function computeModalFontSizePt(units: ContentUnit[]): number | undefined {
  const counts = new Map<number, number>();
  for (const u of units) {
    for (const r of u.textRuns ?? []) {
      if (r.fontSizePt && r.fontSizePt > 0) {
        counts.set(r.fontSizePt, (counts.get(r.fontSizePt) ?? 0) + 1);
      }
    }
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

/* ── 2. Section / chapter / daf headers ───────────────────────────── */

export interface SectionHeader {
  role: ContentRole;
  simanNumber?: string;
  seifLetter?: string;
}

export interface DetectSectionHeaderOptions {
  /** Lower-cased `w:pStyle w:val` ('' when none). */
  styleVal: string;
  /** `w:jc w:val === 'center'`. */
  isCentered: boolean;
  /** The paragraph's runs are (mostly) bold. */
  isBold: boolean;
}

/**
 * Genuinely-new header cases only (see module header — Heading 1/2,
 * `פרק`, `סימן`, `משנה`, `דף` are already owned by v0.9.7 code):
 * - a centred, bold, short line (≤12 words) → heading;
 * - `סעיף א` / `סעיף 3` at the line start → siman (+ seifLetter /
 *   simanNumber). A long paragraph that merely MENTIONS סעיף is not a
 *   header: the marker must open the line and the line must be short.
 */
export function detectSectionHeader(
  text: string,
  opts: DetectSectionHeaderOptions
): SectionHeader | null {
  const t = text.trim();
  if (!t) return null;
  const words = t.split(/\s+/).filter(Boolean);

  const seifMatch = t.match(/^סעיף\s+([א-ת]|[0-9]+)[\s.:)\]]/);
  if (seifMatch && words.length <= 10) {
    const mark = seifMatch[1];
    return /[0-9]/.test(mark)
      ? { role: 'siman', simanNumber: mark }
      : { role: 'siman', seifLetter: mark };
  }

  if (opts.isCentered && opts.isBold && words.length >= 1 && words.length <= 12) {
    return { role: 'heading' };
  }
  return null;
}

/* ── 3. Parenthesised citations ───────────────────────────────────── */

export interface TextSpan {
  start: number;
  end: number;
  text: string;
}

const TRACTATES_AND_MARKERS =
  '(ברכות|שבת|עירובין|פסחים|שקלים|יומא|סוכה|ביצה|ראש השנה|תענית|מגילה|מועד קטן|חגיגה|יבמות|כתובות|נדרים|נזיר|סוטה|גיטין|קידושין|בבא קמא|בבא מציעא|בבא בתרא|סנהדרין|מכות|שבועות|עבודה זרה|הוריות|זבחים|מנחות|חולין|בכורות|ערכין|תמורה|כריתות|מעילה|תמיד|מדות|קנים|נדה|משנה|תוספתא|ירושלמי|שם|עיין|דף|פרק|סימן|סעיף|רמב״ם|רמבם|שולחן ערוך|טור|הלכות)';

const CITATION_RE = new RegExp(
  `\\(([^()\\n]{1,40})\\)|\\[([^\\[\\]\\n]{1,40})\\]`,
  'g'
);

/**
 * Find Mareh Mekomos citation spans: a parenthesised / bracketed span
 * (≤40 chars) that contains Hebrew AND either a known sefer/marker word,
 * a daf reference (`ב.` / `ע״א` / `ע״ב`), or a gershayim abbreviation
 * (`כ״מ`, `רש״י`…). Plain parenthetical asides in the running text
 * (no marker) are NOT citations.
 */
export function findCitationSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  CITATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const markerRe = new RegExp(TRACTATES_AND_MARKERS);
  while ((m = CITATION_RE.exec(text)) !== null) {
    const inner = m[1] ?? m[2] ?? '';
    const innerTrim = inner.trim();
    if (!/[\u05D0-\u05EA]/.test(innerTrim)) continue;
    const looksLikeCitation =
      markerRe.test(innerTrim) ||
      /[א-ת]['׳״][א-ת]?/.test(innerTrim) ||
      /ע[״"]?[אב]/.test(innerTrim) ||
      /\b[א-ת]\.\s*$/.test(innerTrim);
    if (!looksLikeCitation) continue;
    const start = m.index;
    const end = m.index + m[0].length;
    spans.push({ start, end, text: m[0] });
  }
  return spans;
}

/* ── 4. Rema glosses (Shulchan Aruch) ─────────────────────────────── */

/**
 * Find Rema glosses: `הגה:` up to the next sentence end (`. `), the next
 * bracket, or the next `הגה:` — capped at 400 chars. The caller gates
 * this on Shulchan Aruch context (file name or a siman in the document);
 * `הגה:` on its own also appears in Hagahot, so the gate matters.
 */
export function findRemaGlossSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const re = /הגה\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const rest = text.slice(start);
    // All `end` arithmetic below is relative to `rest` (local); only the
    // pushed span converts back to document offsets.
    let localEnd = rest.length;
    const period = rest.search(/\.\s/);
    if (period >= 0) localEnd = Math.min(localEnd, period + 1);
    const bracket = rest.search(/[[(]/);
    if (bracket > 0) localEnd = Math.min(localEnd, bracket);
    const nextHagah = rest.slice(m[0].length).search(/הגה\s*:/);
    if (nextHagah > 0) localEnd = Math.min(localEnd, m[0].length + nextHagah);
    localEnd = Math.min(localEnd, 400);
    if (localEnd < 4) continue;
    spans.push({ start, end: start + localEnd, text: text.slice(start, start + localEnd) });
  }
  return spans;
}

/** File-name / document test for "this is a Shulchan Aruch file". */
export function isShulchanAruchContext(fileName: string, units: ContentUnit[]): boolean {
  const name = fileName.toLowerCase();
  if (
    name.includes('שולחן') ||
    name.includes('ש"ע') ||
    name.includes('shulchan') ||
    name.includes('shulchan-aruch') ||
    name.includes('shulchan_aruch') ||
    name.includes('mechaber') ||
    name.includes('מחבר')
  ) {
    return true;
  }
  return units.some(u => u.role === 'siman' || /^(סימן|סעיף)\s/.test(u.rawText.trim()));
}

/* ── 5. Dibbur HaMatchil tokenisation ─────────────────────────────── */

export interface DibburTokenizeOptions {
  /** The paragraph's cleaned bold lead, when the importer found one. */
  boldLead?: string;
  /** Source units for the source-match fallback. */
  sourceUnits?: ContentUnit[];
  /** Dibbur the importer's existing 3-step detection already found. */
  knownDibbur?: string;
  /** Link target the importer already resolved. */
  targetAnchorId?: string;
}

const EXPLICIT_DALET_HE_RE = /^[([{\s"״]*?(?:ד[״"]ה|בד[״"]ה)\s+(.{2,60}?)(?:\s*[:—–]|\s+-\s+|\.\s+|$)/;
const DELIMITER_RE = /^([^.:—–\n]{2,55}?)(?:\s*[:—–]|\s+-\s+|\.\s+)/;

/**
 * Wrap a dibbur in a structured node. When `knownDibbur` is given (the
 * importer's existing detection — bold lead / delimiter / source match),
 * this WRAPS it without re-deciding: the method is recovered from the
 * evidence (explicit prefix → bold lead → source match → delimiter).
 * When no dibbur is known yet, the same evidence is tried in priority
 * order, with the delimiter restricted to the first 2–12 words.
 */
export function tokenizeDibbur(
  text: string,
  unitId: string,
  opts: DibburTokenizeOptions = {}
): DibburNode | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const id = `dibbur-${unitId}`;

  const explicit = trimmed.match(EXPLICIT_DALET_HE_RE);
  if (explicit && explicit[1]) {
    const raw = explicit[1].trim();
    return {
      id,
      rawText: raw,
      normalizedText: normalizeHebrewForMatch(raw),
      targetAnchorId: opts.targetAnchorId,
      confidence: 0.95,
      method: 'explicit-dalet-he',
    };
  }

  if (opts.knownDibbur) {
    const raw = opts.knownDibbur.trim();
    let method: DibburNode['method'] = 'delimiter';
    let confidence = 0.85;
    if (opts.boldLead && opts.boldLead.trim() === raw) {
      method = 'bold-lead';
      confidence = 0.9;
    } else if (opts.sourceUnits && opts.sourceUnits.length > 0) {
      const found = detectDibburFromSource(text, opts.sourceUnits);
      if (found && found.dibbur === raw) {
        method = 'source-match';
        confidence = 0.8;
        return {
          id,
          rawText: raw,
          normalizedText: normalizeHebrewForMatch(raw),
          targetAnchorId: found.sourceUnitId,
          confidence,
          method,
        };
      }
    }
    return {
      id,
      rawText: raw,
      normalizedText: normalizeHebrewForMatch(raw),
      targetAnchorId: opts.targetAnchorId,
      confidence,
      method,
    };
  }

  if (opts.boldLead) {
    const raw = opts.boldLead.trim();
    if (raw.length >= 2 && raw.length <= 65) {
      return {
        id,
        rawText: raw,
        normalizedText: normalizeHebrewForMatch(raw),
        targetAnchorId: opts.targetAnchorId,
        confidence: 0.9,
        method: 'bold-lead',
      };
    }
  }

  const delim = trimmed.match(DELIMITER_RE);
  if (delim && delim[1]) {
    const raw = delim[1].replace(/^[\s[\\]()]+/, '').trim();
    const wordCount = raw.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 2 && wordCount <= 12) {
      return {
        id,
        rawText: raw,
        normalizedText: normalizeHebrewForMatch(raw),
        targetAnchorId: opts.targetAnchorId,
        confidence: 0.85,
        method: 'delimiter',
      };
    }
  }

  if (opts.sourceUnits && opts.sourceUnits.length > 0) {
    const found = detectDibburFromSource(text, opts.sourceUnits);
    if (found) {
      return {
        id,
        rawText: found.dibbur,
        normalizedText: normalizeHebrewForMatch(found.dibbur),
        targetAnchorId: found.sourceUnitId,
        confidence: 0.8,
        method: 'source-match',
      };
    }
  }
  return null;
}

/* ── Run splitting by character spans ─────────────────────────────── */

/**
 * Split TextRuns at span boundaries and set `flag` on the runs covered
 * by a span. Runs concatenate to the unit's rawText (footnote markers
 * carry no text), so offsets line up with the raw text.
 */
export function splitRunsBySpans(
  runs: TextRun[],
  spans: TextSpan[],
  flag: 'isCitation' | 'isRemaGloss'
): TextRun[] {
  if (spans.length === 0 || runs.length === 0) return runs;
  const out: TextRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    offset = runEnd;
    if (run.text.length === 0) {
      out.push(run);
      continue;
    }
    const cuts = new Set<number>([0, run.text.length]);
    for (const s of spans) {
      if (s.start > runStart && s.start < runEnd) cuts.add(s.start - runStart);
      if (s.end > runStart && s.end < runEnd) cuts.add(s.end - runStart);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const piece = run.text.slice(sorted[i], sorted[i + 1]);
      if (!piece) continue;
      const pieceStart = runStart + sorted[i];
      const pieceEnd = runStart + sorted[i + 1];
      const covered = spans.some(s => pieceStart >= s.start && pieceEnd <= s.end);
      out.push({ ...run, text: piece, [flag]: covered ? true : run[flag] });
    }
  }
  return out;
}

/* ── 7. Per-role typography defaults (bundled fonts only) ─────────── */

export interface RoleTypographyDefault {
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
  isBold?: boolean;
  noteHe: string;
  noteEn: string;
}

/**
 * Bundled-font availability, verified against `KETER_EMBEDDED_FONTS`
 * (pdf-native-text-engine.ts) AND the repo tree: the three families
 * below are DECLARED as embedded (loaded at runtime from
 * `/fonts/*.ttf`), but NO .ttf file ships in this repo tree (no
 * `public/` directory at all) — so on-disk presence could NOT be
 * verified here; the PDF engine fetches them at runtime. Everything
 * else is honestly NOT available: no mapping is faked for it.
 */
export const BUNDLED_FONT_AVAILABILITY: Readonly<Record<string, { bundled: boolean; noteHe: string; noteEn: string }>> =
  Object.freeze({
    'Frank Ruhl Libre': {
      bundled: true,
      noteHe: 'מוצהר כמוטמע (Regular + Bold) — קובץ ה־ttf אינו בתיקיית הפרויקט',
      noteEn: 'Declared embedded (Regular + Bold) — no .ttf file ships in the repo tree',
    },
    'Noto Rashi Hebrew': {
      bundled: true,
      noteHe: 'מוצהר כמוטמע (Regular + Bold) — כתב רש״י לרש״י ותוספות',
      noteEn: 'Declared embedded (Regular + Bold) — Rashi script for Rashi/Tosafot',
    },
    'David Libre': {
      bundled: true,
      noteHe: 'מוצהר כמוטמע (Regular + Bold) — כותרות ותתי־פירושים',
      noteEn: 'Declared embedded (Regular + Bold) — headers and sub-commentaries',
    },
    'Vilna / Guttman Vilna': {
      bundled: false,
      noteHe: 'אינו מוטמע בפרויקט — נופל חזרה ל־Frank Ruhl Libre',
      noteEn: 'Not bundled in the project — falls back to Frank Ruhl Libre',
    },
    'Guttman Rashi': {
      bundled: false,
      noteHe: 'אינו מוטמע בפרויקט — נופל חזרה ל־Noto Rashi Hebrew',
      noteEn: 'Not bundled in the project — falls back to Noto Rashi Hebrew',
    },
    Drugulin: {
      bundled: false,
      noteHe: 'אינו מוטמע בפרויקט ואינו מוצהר בקטלוג הגופנים',
      noteEn: 'Not bundled in the project and not declared in the font catalogue',
    },
    'Taamey Frank CLM': {
      bundled: false,
      noteHe: 'בקטלוג הגופנים בלבד — אינו מוטמע, לא נטען אוטומטית',
      noteEn: 'Font catalogue only — not embedded, not auto-loaded',
    },
    'Rashi Script CLM': {
      bundled: false,
      noteHe: 'בקטלוג הגופנים בלבד — אינו מוטמע, לא נטען אוטומטית',
      noteEn: 'Font catalogue only — not embedded, not auto-loaded',
    },
  });

/**
 * v0.9.8 Bilingual Audit — closed union of the roles that carry a
 * per-role typography default. The table is exhaustive over this union,
 * so a typo or a missing role fails the build (the v0.9.1 lesson).
 * Roles outside the union fall back to `regular_paragraph` at the
 * `roleTypographyDefault` call site below.
 */
export type RoleTypographyRole =
  | 'main_source'
  | 'verse'
  | 'primary_comment'
  | 'secondary_comment'
  | 'tertiary_comment'
  | 'chapter'
  | 'heading'
  | 'siman'
  | 'footnote'
  | 'dibbur_hamatchil'
  | 'regular_paragraph';

export const ROLE_TYPOGRAPHY_DEFAULTS: Readonly<Record<RoleTypographyRole, RoleTypographyDefault>> =
  Object.freeze({
    main_source: {
      fontFamily: 'Frank Ruhl Libre',
      fontSizePt: 14.5,
      lineHeight: 1.32,
      noteHe: 'גמרא / מקור ראשי — פרנק־ריהל',
      noteEn: 'Gemara / main source — Frank Ruhl Libre',
    },
    verse: {
      fontFamily: 'Frank Ruhl Libre',
      fontSizePt: 16,
      lineHeight: 1.35,
      noteHe: 'פסוק / תרגום — פרנק־ריהל גדול',
      noteEn: 'Verse / Targum — Frank Ruhl Libre, larger',
    },
    primary_comment: {
      fontFamily: 'Noto Rashi Hebrew',
      fontSizePt: 10.5,
      lineHeight: 1.32,
      noteHe: 'רש״י — כתב רש״י',
      noteEn: 'Rashi — Rashi script',
    },
    secondary_comment: {
      fontFamily: 'Noto Rashi Hebrew',
      fontSizePt: 10.5,
      lineHeight: 1.32,
      noteHe: 'תוספות — כתב רש״י',
      noteEn: 'Tosafot — Rashi script',
    },
    tertiary_comment: {
      fontFamily: 'Noto Rashi Hebrew',
      fontSizePt: 9,
      lineHeight: 1.25,
      noteHe: 'פירוש שלישי — כתב רש״י קטן',
      noteEn: 'Third commentary — smaller Rashi script',
    },
    chapter: {
      fontFamily: 'David Libre',
      fontSizePt: 20,
      lineHeight: 1.3,
      isBold: true,
      noteHe: 'כותרת פרק — דוד מודגש',
      noteEn: 'Chapter heading — David Libre, bold',
    },
    heading: {
      fontFamily: 'David Libre',
      fontSizePt: 15,
      lineHeight: 1.3,
      isBold: true,
      noteHe: 'כותרת — דוד מודגש',
      noteEn: 'Heading — David Libre, bold',
    },
    siman: {
      fontFamily: 'David Libre',
      fontSizePt: 15,
      lineHeight: 1.3,
      isBold: true,
      noteHe: 'סימן — דוד מודגש',
      noteEn: 'Siman — David Libre, bold',
    },
    footnote: {
      fontFamily: 'Frank Ruhl Libre',
      fontSizePt: 9,
      lineHeight: 1.25,
      noteHe: 'הערת שוליים — פרנק־ריהל קטן',
      noteEn: 'Footnote — smaller Frank Ruhl Libre',
    },
    dibbur_hamatchil: {
      fontFamily: 'Frank Ruhl Libre',
      fontSizePt: 13.5,
      lineHeight: 1.32,
      isBold: true,
      noteHe: 'דיבור המתחיל — פרנק־ריהל מודגש (במפרשים — בגופן המפרש)',
      noteEn: 'Dibbur HaMatchil — Frank Ruhl Libre bold (in commentaries, the commentary font)',
    },
    regular_paragraph: {
      fontFamily: 'Frank Ruhl Libre',
      fontSizePt: 13.5,
      lineHeight: 1.32,
      noteHe: 'טקסט רץ — פרנק־ריהל',
      noteEn: 'Running text — Frank Ruhl Libre',
    },
  });

export function roleTypographyDefault(role: ContentRole): RoleTypographyDefault {
  // The table is exhaustive over RoleTypographyRole only; any other
  // ContentRole falls back to regular_paragraph (unchanged behaviour).
  return (
    (ROLE_TYPOGRAPHY_DEFAULTS as Partial<Record<ContentRole, RoleTypographyDefault>>)[role] ??
    ROLE_TYPOGRAPHY_DEFAULTS.regular_paragraph
  );
}

/* ── 8. Per-file preview stats (wizard Step 2) ───────────────────── */

export interface DocxPreviewStats {
  wordCount: number;
  perekMarkers: number;
  dafMarkers: number;
  pasukMarkers: number;
  dibburCount: number;
  footnoteCount: number;
  markers: string[];
}

/**
 * Preview stats for one already-parsed DOCX result — shown in the
 * wizard BEFORE "Generate Sefer Layout" is clicked. Pure: reads units
 * only, never re-parses XML.
 */
export function analyzeImportedDocx(units: ContentUnit[]): DocxPreviewStats {
  let wordCount = 0;
  let perekMarkers = 0;
  let dafMarkers = 0;
  let pasukMarkers = 0;
  let dibburCount = 0;
  let footnoteCount = 0;
  const markers: string[] = [];
  for (const u of units) {
    if (u.role === 'footnote') footnoteCount++;
    if (u.dibburHamatchil) dibburCount++;
    if (u.role === 'image' || u.role === 'table') continue;
    const text = (u.rawText ?? '').trim();
    if (!text) continue;
    wordCount += text.split(/\s+/).filter(Boolean).length;
    if (/^פרק\s/.test(text) || u.role === 'chapter') {
      perekMarkers++;
      if (markers.length < 8) markers.push(text.slice(0, 40));
    }
    const dafHits = text.match(/דף\s+[א-ת]/g);
    if (dafHits) dafMarkers += dafHits.length;
    if (u.role === 'verse' || /^פסוק\s/.test(text)) pasukMarkers++;
  }
  return { wordCount, perekMarkers, dafMarkers, pasukMarkers, dibburCount, footnoteCount, markers };
}

/**
 * v0.9.8 Phase 1 — one-line per-file preview counts, rendered in BOTH
 * languages. The count words go through the caller's `t()` (every one
 * has an EN_STRINGS entry — asserted by the Phase 1 smoke script) and
 * numbers use the UI language's locale, so the line reads
 * "12,345 Words · 3 Chapters · ..." in English and
 * "12,345 מילים · 3 פרקים · ..." in Hebrew. Number–noun order is the
 * same in both languages, so one composition works for both.
 *
 * v0.9.8 Bilingual Audit — singular when the count is exactly 1 in
 * BOTH languages ("1 Word", "1 Chapter", "1 Page", "1 Note"; Hebrew
 * "מילה אחת" reads as "1 מילה"). The daf count's singular is 'עמוד'
 * (Page), not 'דף' (Folio), because the plural noun is 'דפים' →
 * 'Pages'. 'ד״ה' has no plural form in either language.
 */
export function formatPreviewCounts(
  stats: DocxPreviewStats,
  t: (he: string) => string,
  lang: 'he' | 'en',
): string {
  const locale = lang === 'en' ? 'en-US' : 'he-IL';
  const n = (v: number) => v.toLocaleString(locale);
  const word = (count: number, singular: string, plural: string) =>
    count === 1 ? t(singular) : t(plural);
  return (
    `${n(stats.wordCount)} ${word(stats.wordCount, 'מילה', 'מילים')} · ` +
    `${n(stats.perekMarkers)} ${word(stats.perekMarkers, 'פרק', 'פרקים')} · ` +
    `${n(stats.dafMarkers)} ${word(stats.dafMarkers, 'עמוד', 'דפים')} · ` +
    `${n(stats.pasukMarkers)} ${word(stats.pasukMarkers, 'פסוק', 'פסוקים')} · ` +
    `${n(stats.dibburCount)} ${t('ד״ה')} · ` +
    `${n(stats.footnoteCount)} ${word(stats.footnoteCount, 'הערה', 'הערות')}`
  );
}
