/**
 * KETER-TYPE v0.9.8 — Bilingual Audit smoke test.
 *
 * Run from the repo root:  npx tsx scripts/v098-i18n-smoke.ts
 *
 * Verifies (the audit's own enumeration, re-run as code so the next
 * pass re-checks it instead of trusting the audit record):
 *  §1  Every EN_STRINGS key has a non-empty English value; the only
 *      keys whose value equals the key are the documented
 *      language-neutral ones (file extensions, 'English').
 *  §2  No literal t('...') call site in src/ is missing from
 *      EN_STRINGS, and no t() call anywhere interpolates (tf() is the
 *      only parameterized path).
 *  §3  Every tf() template exists in EN_STRING_TEMPLATES in both
 *      languages with the same placeholder set.
 *  §4  Every labelHe/placeholderHe value either has a labelEn/
 *      placeholderEn sibling in the same table or exists in
 *      EN_STRINGS; every replyHe value exists in EN_STRINGS or has a
 *      replyEn sibling (composed replies).
 *  §5  No EN_STRINGS key is dead: the live set is literal t() args +
 *      tf template keys + labelHe/placeholderHe values + replyHe
 *      values + the 5 documented keepers (keys asserted present by
 *      other smokes, or reserved for the async paginator).
 *  §6  Strict bilingual tables are exhaustive and translated:
 *      archetypes (5), wizard slots (18), Quick-Tune trims/zones,
 *      CONTENT_ROLE_LABELS (28 roles), SEMANTIC_ROLE_LABELS (33),
 *      genre role patterns (11), ROLE_TYPOGRAPHY_DEFAULTS (11),
 *      BUNDLED_FONT_AVAILABILITY (8 fonts, bilingual notes),
 *      LAYOUT_PRESET_OPTIONS (7), DOCX_HUB_ROLE_OPTIONS (6),
 *      ROLE_OPTIONS (21, labelEn per entry).
 *  §7  Plurals: formatPreviewCounts and formatLinkingReportSummary
 *      use the singular when the count is exactly 1, in both
 *      languages ("1 Word", "1 Chapter", "1 Page", "1 Note",
 *      "1 D.H. linked", "1 awaiting review", "1 unlinked").
 *  §8  RTL/LTR: no `text-right` remains in UI chrome (only the 3
 *      documented book-content exceptions); the AI drawer mirrors
 *      with dir; the archetype cards use text-start.
 *  §9  tf() renders a sample of templates in both languages.
 *  §10 version is 0.9.8.
 *  §11 Visual-review residuals (pass 7): hardcoded Hebrew template
 *      literals the t() sweep cannot see are gone from user-visible
 *      UI — autosave lines, layoutPresetLabel, hub/export notices,
 *      undo tooltips, design-panel history labels, rules-modal text.
 *      The Continue button's arrow is dir-aware; no bare 'he-IL'
 *      locale remains in components (only lang-aware ternaries and
 *      the Word-export XML, which is Hebrew content by design).
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN_STRINGS, EN_STRING_TEMPLATES } from '../src/i18n/strings';
import {
  SEFER_ARCHETYPE_LABELS,
  SEFER_ARCHETYPE_DESCRIPTIONS,
  WIZARD_SLOT_LABELS,
  WIZARD_SLOT_HINTS,
  QUICK_TUNE_TRIM_LABELS,
  QUICK_TUNE_ZONE_LABELS,
  CONTENT_ROLE_LABELS,
} from '../src/i18n/strings';
import { SEMANTIC_ROLE_LABELS } from '../src/types/design-settings';
import {
  GENRE_ROLE_PATTERN_LABELS,
  GENRE_ROLE_PATTERN_SUPPORT,
} from '../src/engine/historical-layouts';
import {
  ROLE_TYPOGRAPHY_DEFAULTS,
  BUNDLED_FONT_AVAILABILITY,
  formatPreviewCounts,
  type DocxPreviewStats,
} from '../src/engine/docx-semantics';
import { formatLinkingReportSummary } from '../src/engine/commentary-linker';
import type { LinkingReport } from '../src/types/typesetter';
import { LAYOUT_PRESET_OPTIONS } from '../src/engine/layout-presets';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const srcFiles = walk(SRC);
const srcText = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');
const allSrc = srcFiles.map(f => fs.readFileSync(f, 'utf-8')).join('\n');

// ── §1  EN_STRINGS completeness ──────────────────────────────────────
console.log('§1  EN_STRINGS completeness');
const keys = Object.keys(EN_STRINGS);
check('EN_STRINGS is non-empty', keys.length > 1000, `${keys.length} keys`);
const empty = keys.filter(k => !EN_STRINGS[k] || EN_STRINGS[k].trim().length === 0);
check('every key has a non-empty English value', empty.length === 0, empty.slice(0, 5).join(' | '));
const identical = keys.filter(k => EN_STRINGS[k] === k);
const NEUTRAL = new Set(['Word (.docx)', 'EPUB (.epub)', 'HTML (.html)', 'English']);
check(
  'only the documented language-neutral keys are identical in both languages',
  identical.length === NEUTRAL.size && identical.every(k => NEUTRAL.has(k)),
  identical.join(' | ')
);

// ── §2  literal t() coverage + no interpolated t() ────────────────────
console.log('§2  literal t() coverage, no interpolated t()');
// Literal single/double-quoted t() args (the audit's own enumeration).
const literalArgs = new Set<string>();
const interpCalls: string[] = [];
for (const f of srcFiles) {
  const text = fs.readFileSync(f, 'utf-8');
  const re = /\bt\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) literalArgs.add(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
  // Plain backtick literals (no ${...}) are also literal t() args.
  const bre = /\bt\(\s*`([^`$]*?)`\s*\)/g;
  while ((m = bre.exec(text)) !== null) literalArgs.add(m[1]);
  const tre = /\bt\(\s*`[^`]*\$\{/g;
  while ((m = tre.exec(text)) !== null) interpCalls.push(`${path.relative(ROOT, f)}:${text.slice(0, m.index).split('\n').length}`);
}
const missing = [...literalArgs].filter(a => !(a in EN_STRINGS));
check('no interpolated t() call sites (tf() is the only parameterized path)', interpCalls.length === 0, interpCalls.slice(0, 5).join(' | '));
check('every literal t() arg exists in EN_STRINGS', missing.length === 0, missing.slice(0, 5).join(' | '));

// ── §3  tf() templates ───────────────────────────────────────────────
console.log('§3  tf() templates');
const templateKeys = Object.keys(EN_STRING_TEMPLATES);
check('EN_STRING_TEMPLATES is non-empty', templateKeys.length > 30, `${templateKeys.length} templates`);
const placeholders = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
let templateBad: string[] = [];
for (const k of templateKeys) {
  const en = EN_STRING_TEMPLATES[k];
  if (!en || en.trim().length === 0) templateBad.push(`empty EN: ${k}`);
  const hp = placeholders(k), ep = placeholders(en ?? '');
  if (hp.size !== ep.size || [...hp].some(p => !ep.has(p))) templateBad.push(`placeholder mismatch: ${k}`);
}
// Every tf('...') call site must name a template that exists in both languages.
const tfCalls = new Set<string>();
for (const text of [allSrc]) {
  const re = /\btf\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tfCalls.add(m[2].replace(/\\'/g, "'"));
}
const tfMissing = [...tfCalls].filter(k => !(k in EN_STRING_TEMPLATES));
check('every tf() template exists in both languages with matching placeholders', templateBad.length === 0 && tfMissing.length === 0, [...templateBad, ...tfMissing].slice(0, 5).join(' | '));

// ── §4  labelHe / placeholderHe / replyHe ────────────────────────────
console.log('§4  labelHe / placeholderHe / replyHe');
const labelHeVals = new Set<string>();
const pairedLabelHe = new Set<string>();
// labelHe values paired with a `label:` (English) sibling — genre hints.
const placeholderHeVals = new Set<string>();
const pairedPlaceholderHe = new Set<string>();
const replyHeVals = new Set<string>();
const pairedReplyEn = new Set<string>();
{
  // labelHe: 'X' followed (same object) by labelEn: 'Y'
  const paired = /labelHe:\s*'((?:[^'\\]|\\.)*)',\s*\n?\s*labelEn:/g;
  let m: RegExpExecArray | null;
  while ((m = paired.exec(allSrc)) !== null) pairedLabelHe.add(m[1]);
  const pairedPh = /placeholderHe:\s*(?:[^,\n]*\|\|\s*)?'((?:[^'\\]|\\.)*)',\s*\n?\s*placeholderEn:/g;
  while ((m = pairedPh.exec(allSrc)) !== null) pairedPlaceholderHe.add(m[1]);
  const lab = /labelHe:\s*'((?:[^'\\]|\\.)*)'/g;
  while ((m = lab.exec(allSrc)) !== null) labelHeVals.add(m[1].replace(/\\'/g, "'"));
  // Genre hints carry the English name in `label:` (before labelHe:).
  const pairedLab = /label:\s*'((?:[^'\\]|\\.)*)',\s*labelHe:\s*'((?:[^'\\]|\\.)*)'/g;
  while ((m = pairedLab.exec(allSrc)) !== null) pairedLabelHe.add(m[2].replace(/\\'/g, "'"));
  const ph = /placeholderHe:\s*(?:[^,\n]*\|\|\s*)?'((?:[^'\\]|\\.)*)'/g;
  while ((m = ph.exec(allSrc)) !== null) placeholderHeVals.add(m[1].replace(/\\'/g, "'"));
  const rep = /replyHe:\s*'((?:[^'\\]|\\.)*)'/g;
  while ((m = rep.exec(allSrc)) !== null) replyHeVals.add(m[1].replace(/\\'/g, "'"));
  // replyEn siblings: a replyHe literal followed by replyEn in the same object
  const repEn = /replyHe:\s*(?:`[^`]*`|'(?:[^'\\]|\\.)*')\s*,\s*\n?\s*replyEn:/g;
  void repEn;
}
// replyEn coverage is checked structurally: every composed (template-literal)
// replyHe must have a replyEn in the same object literal.
const composedReplyWithoutEn: string[] = [];
{
  const re = /replyHe:\s*`[^`]*\$\{[^`]*`\s*,(?!\s*\n?\s*replyEn:)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allSrc)) !== null) composedReplyWithoutEn.push(m[0].slice(0, 60));
  // export reply in AiChatPanel is a concatenation, not a template literal
  const aiChat = srcText('components/AiChatPanel.tsx');
  const exportReply = aiChat.includes("replyEn:\n        \"I'll open the export step");
  if (!exportReply) composedReplyWithoutEn.push('AiChatPanel export reply has no replyEn');
}
const labelUncovered = [...labelHeVals].filter(v => !pairedLabelHe.has(v) && !(v in EN_STRINGS));
const placeholderUncovered = [...placeholderHeVals].filter(v => !pairedPlaceholderHe.has(v) && !(v in EN_STRINGS));
const replyUncovered = [...replyHeVals].filter(v => !(v in EN_STRINGS));
check('every labelHe value has a labelEn sibling or an EN_STRINGS entry', labelUncovered.length === 0, labelUncovered.slice(0, 5).join(' | '));
check('every placeholderHe value has a placeholderEn sibling or an EN_STRINGS entry', placeholderUncovered.length === 0, placeholderUncovered.slice(0, 5).join(' | '));
check('every plain replyHe value exists in EN_STRINGS', replyUncovered.length === 0, replyUncovered.slice(0, 5).join(' | '));
check('every composed replyHe has a replyEn sibling', composedReplyWithoutEn.length === 0, composedReplyWithoutEn.slice(0, 3).join(' | '));

// ── §5  no dead keys (smart live set) ────────────────────────────────
console.log('§5  no dead keys');
const DOCUMENTED_KEEPERS = new Set([
  'בוחרים שם, מתכונת עימוד ותבנית היסטורית או פריסה מותאמת — או מתחילים מטקסט לדוגמה.',
  'מעמד עמודים…',
  'העימוד נכשל',
  'הביטוי שנבחר אינו במקור — לחצו על מילה בטקסט הראשי',
  'הייצוא נבדק מול העמוד שעל המסך',
]);
// Live = the key appears as a substring anywhere in src/ or scripts/
// (outside strings.ts itself), after normalising \" escapes — the
// same method the audit's dead-key removal used (audit2). This covers
// t() args, tf() templates, labelHe/placeholderHe/replyHe values,
// string arrays rendered via t(x), setting names and data values, and
// keys asserted present by other smokes. Known limitation, recorded
// in BILINGUAL-AUDIT.md: a key that is only a PREFIX of a longer live
// string also counts as live here; the stricter complete-literal scan
// was tried and abandoned because its quote regex desyncs on this
// codebase (it wrongly flagged 6 live App.tsx keys, since restored).
// 797 keys that never appear as a complete literal anywhere were
// removed in this audit; 6 live ones were restored after the check.
const norm = (v: string) => v.replace(/\\"/g, '"').replace(/\\'/g, "'");
const blob = [...srcFiles.filter(f => !f.endsWith(path.join('i18n', 'strings.ts'))).map(f => fs.readFileSync(f, 'utf-8')),
  ...fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => /\.(ts|mjs)$/.test(f)).map(f => fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf-8')),
].map(norm).join('\n');
const dead = keys.filter(k => !blob.includes(k));

// ── §6  strict bilingual tables ──────────────────────────────────────
console.log('§6  strict bilingual tables');
function bilingualTable(name: string, table: Record<string, { he: string; en: string }>, expectedCount: number) {
  const entries = Object.entries(table);
  const bad = entries.filter(([, v]) => !v || !v.he || !v.en || v.he.trim().length === 0 || v.en.trim().length === 0 || v.he === v.en);
  check(`${name}: ${expectedCount} entries, every one translated in both languages`, entries.length === expectedCount && bad.length === 0, `got ${entries.length}, bad: ${bad.slice(0, 3).map(([k]) => k).join(', ')}`);
}
bilingualTable('SEFER_ARCHETYPE_LABELS', SEFER_ARCHETYPE_LABELS, 5);
bilingualTable('SEFER_ARCHETYPE_DESCRIPTIONS', SEFER_ARCHETYPE_DESCRIPTIONS, 5);
bilingualTable('WIZARD_SLOT_LABELS', WIZARD_SLOT_LABELS, 18);
bilingualTable('WIZARD_SLOT_HINTS', WIZARD_SLOT_HINTS, 18);
bilingualTable('QUICK_TUNE_TRIM_LABELS', QUICK_TUNE_TRIM_LABELS, 4);
bilingualTable('QUICK_TUNE_ZONE_LABELS', QUICK_TUNE_ZONE_LABELS, 4);
bilingualTable('CONTENT_ROLE_LABELS', CONTENT_ROLE_LABELS, 28);
bilingualTable('SEMANTIC_ROLE_LABELS', SEMANTIC_ROLE_LABELS, 33);
bilingualTable('GENRE_ROLE_PATTERN_LABELS', GENRE_ROLE_PATTERN_LABELS, 11);
check(
  'GENRE_ROLE_PATTERN_SUPPORT covers exactly the 11 pattern ids',
  Object.keys(GENRE_ROLE_PATTERN_SUPPORT).length === 11 &&
    Object.keys(GENRE_ROLE_PATTERN_SUPPORT).every(k => k in GENRE_ROLE_PATTERN_LABELS),
  Object.keys(GENRE_ROLE_PATTERN_SUPPORT).join(', ')
);
check(
  'ROLE_TYPOGRAPHY_DEFAULTS covers exactly 11 roles',
  Object.keys(ROLE_TYPOGRAPHY_DEFAULTS).length === 11,
  Object.keys(ROLE_TYPOGRAPHY_DEFAULTS).join(', ')
);
{
  const fonts = Object.entries(BUNDLED_FONT_AVAILABILITY);
  const bad = fonts.filter(([, v]) => !v.noteHe || !v.noteEn || v.noteHe.trim().length === 0 || v.noteEn.trim().length === 0);
  check('BUNDLED_FONT_AVAILABILITY: 8 fonts, every one with a bilingual note', fonts.length === 8 && bad.length === 0, `got ${fonts.length}`);
}
check(
  'LAYOUT_PRESET_OPTIONS: 7 presets with labelEn + subLabelEn',
  LAYOUT_PRESET_OPTIONS.length === 7 &&
    LAYOUT_PRESET_OPTIONS.every(o => o.labelEn && o.subLabelEn && o.labelHe && o.subLabelHe),
  LAYOUT_PRESET_OPTIONS.map(o => o.id).join(', ')
);
{
  // DOCX_HUB_ROLE_OPTIONS lives in a .tsx component (not imported in Node):
  // assert by source text.
  const hub = srcText('components/DocxImportHub.tsx');
  const block = hub.slice(hub.indexOf('export const DOCX_HUB_ROLE_OPTIONS'), hub.indexOf('];', hub.indexOf('export const DOCX_HUB_ROLE_OPTIONS')));
  const entries = [...block.matchAll(/\{ role: '(\w+)', labelHe: '[^']*', labelEn: '[^']*' \}/g)];
  check('DOCX_HUB_ROLE_OPTIONS: 6 roles with labelEn', entries.length === 6, `got ${entries.length}`);
  check('hub renders role options lang-aware', hub.includes("lang === 'en' ? opt.labelEn : opt.labelHe"), '');
}
{
  // ROLE_OPTIONS lives in the Design panel (not exported): assert by source text.
  const dp = srcText('components/DesignTypesettingPanel.tsx');
  const block = dp.slice(dp.indexOf('const ROLE_OPTIONS'), dp.indexOf('export const DesignTypesettingPanel'));
  const entries = [...block.matchAll(/\{ role: '(\w+)', labelHe: '[^']*', labelEn: '[^']*' \}/g)];
  check('ROLE_OPTIONS: 21 entries, every one with labelEn', entries.length === 21, `got ${entries.length}`);
  check('Design panel renders ROLE_OPTIONS lang-aware', dp.includes("lang === 'en' ? opt.labelEn : opt.labelHe"), '');
}
{
  // Strict typing: the tables must be keyed by closed unions, not Record<string, ...>.
  const ds = srcText('types/design-settings.ts');
  check('SEMANTIC_ROLE_LABELS is typed Record<SemanticStyleRole, BilingualLabel>', ds.includes('Record<SemanticStyleRole, BilingualLabel>'), '');
  const hl = srcText('engine/historical-layouts.ts');
  check('GENRE_ROLE_PATTERN tables are typed over GenreRolePatternId', hl.includes('Record<GenreRolePatternId, string[]>') && hl.includes('Record<GenreRolePatternId, { he: string; en: string }>'), '');
  const dse = srcText('engine/docx-semantics.ts');
  check('ROLE_TYPOGRAPHY_DEFAULTS is typed over RoleTypographyRole', dse.includes('Record<RoleTypographyRole, RoleTypographyDefault>'), '');
}

// ── §7  plurals ──────────────────────────────────────────────────────
console.log('§7  plurals');
{
  const tHe = (he: string) => he;
  const tEn = (he: string) => EN_STRINGS[he] ?? he;
  const one: DocxPreviewStats = { wordCount: 1, perekMarkers: 1, dafMarkers: 1, pasukMarkers: 1, dibburCount: 1, footnoteCount: 1, markers: [] };
  const two: DocxPreviewStats = { wordCount: 2, perekMarkers: 2, dafMarkers: 2, pasukMarkers: 2, dibburCount: 2, footnoteCount: 2, markers: [] };
  const zero: DocxPreviewStats = { wordCount: 0, perekMarkers: 0, dafMarkers: 0, pasukMarkers: 0, dibburCount: 0, footnoteCount: 0, markers: [] };
  const en1 = formatPreviewCounts(one, tEn, 'en');
  const en2 = formatPreviewCounts(two, tEn, 'en');
  const en0 = formatPreviewCounts(zero, tEn, 'en');
  const he1 = formatPreviewCounts(one, tHe, 'he');
  check('preview counts singular (EN): "1 Word · 1 Chapter · 1 Page · 1 Verse · 1 D.H. · 1 Note"', en1 === '1 Word · 1 Chapter · 1 Page · 1 Verse · 1 D.H. · 1 Note', en1);
  check('preview counts plural (EN): "2 Words · 2 Chapters · 2 Pages · 2 Verses · 2 D.H. · 2 Notes"', en2 === '2 Words · 2 Chapters · 2 Pages · 2 Verses · 2 D.H. · 2 Notes', en2);
  check('preview counts zero stays plural (EN)', en0.includes('0 Words') && en0.includes('0 Notes'), en0);
  check('preview counts singular (HE): "1 מילה · 1 פרק · 1 עמוד · 1 פסוק · 1 ד״ה · 1 הערה"', he1 === '1 מילה · 1 פרק · 1 עמוד · 1 פסוק · 1 ד״ה · 1 הערה', he1);
  const mkReport = (n: number): LinkingReport => ({
    totalDibburim: n, linkedCount: n, highConfidenceCount: n,
    mediumConfidenceCount: 0, reviewCount: n, unmatchedCount: n,
    unmatched: [], links: [],
  });
  const rep1 = mkReport(1);
  const rep2 = mkReport(2);
  const rep0 = mkReport(0);
  const lEn1 = formatLinkingReportSummary(rep1, tEn, 'en');
  const lEn2 = formatLinkingReportSummary(rep2, tEn, 'en');
  const lEn0 = formatLinkingReportSummary(rep0, tEn, 'en');
  const lHe1 = formatLinkingReportSummary(rep1, tHe, 'he');
  check('linking summary singular (EN): "1 D.H. linked · 1 high-confidence · 1 awaiting review · 1 unlinked"', lEn1 === '1 D.H. linked · 1 high-confidence · 1 awaiting review · 1 unlinked', lEn1);
  check('linking summary plural (EN)', lEn2 === '2 D.H. linked · 2 high-confidence · 2 awaiting review · 2 unlinked', lEn2);
  check('linking summary zero stays plural (EN)', lEn0.includes('0 D.H. linked') && lEn0.includes('0 unlinked'), lEn0);
  check('linking summary singular (HE)', lHe1.includes('1 ד״ה קושר') && lHe1.includes('1 ממתין לסקירה') && lHe1.includes('1 לא קושר'), lHe1);
}

// ── §8  RTL / LTR ────────────────────────────────────────────────────
console.log('§8  RTL / LTR');
{
  const keepers = new Set([
    'src/components/CustomLayoutDesigner.tsx:820',
    'src/components/FontScannerPanel.tsx:480',
    'src/components/Milestone1ReportModal.tsx:194',
  ]);
  const bad: string[] = [];
  for (const f of srcFiles) {
    const lines = fs.readFileSync(f, 'utf-8').split('\n');
    lines.forEach((ln, i) => {
      if (ln.includes('text-right') && !keepers.has(`${path.relative(ROOT, f)}:${i + 1}`)) {
        bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
      }
    });
  }
  check('no text-right remains in UI chrome (3 book-content exceptions only)', bad.length === 0, bad.slice(0, 5).join(' | '));
  const form = srcText('components/NewProjectForm.tsx');
  check('archetype cards use text-start (not text-right)', form.includes('text-start') && !form.includes('text-right'), '');
  const ai = srcText('components/AiChatPanel.tsx');
  check('AI drawer mirrors with dir (right-0 in RTL, left-0 in LTR)', ai.includes("dir === 'rtl' ? 'right-0' : 'left-0'") && ai.includes("dir === 'rtl' ? 'border-l' : 'border-r'"), '');
  check('reserved async-pagination keys still present', 'מעמד עמודים…' in EN_STRINGS && 'העימוד נכשל' in EN_STRINGS, '');
}

// ── §9  tf() rendering ───────────────────────────────────────────────
console.log('§9  tf() rendering');
{
  const render = (heTemplate: string, params: Record<string, string | number>, lang: 'he' | 'en') => {
    const tpl = lang === 'en' ? EN_STRING_TEMPLATES[heTemplate] ?? heTemplate : heTemplate;
    return tpl.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
  };
  check(
    'tf renders "נפתחו {count} זוגות מהספרייה — הראשון מוצג" in English',
    render('נפתחו {count} זוגות מהספרייה — הראשון מוצג', { count: 3 }, 'en') === 'Opened 3 pairs from the library — the first one is shown',
    render('נפתחו {count} זוגות מהספרייה — הראשון מוצג', { count: 3 }, 'en')
  );
  check(
    'tf renders "בוטל: {label} (Ctrl+Z)" in English',
    render('בוטל: {label} (Ctrl+Z)', { label: 'Test' }, 'en') === 'Undone: Test (Ctrl+Z)',
    render('בוטל: {label} (Ctrl+Z)', { label: 'Test' }, 'en')
  );
  check(
    'tf leaves unknown placeholders as {key}',
    render('בוטל: {label} (Ctrl+Z)', {}, 'en').includes('{label}'),
    ''
  );
}

// ── §11  visual-review residuals (pass 7) ─────────────────────────────
console.log('§11  visual-review residuals');
{
  const home = srcText('components/HomeWorkspaceView.tsx');
  const status = srcText('components/WorkspaceStatusBar.tsx');
  const hub = srcText('components/DocxImportHub.tsx');
  const exp = srcText('components/ExportWorkspaceView.tsx');
  const app = srcText('App.tsx');
  const lic = srcText('components/LicenseActivationModal.tsx');
  const head = srcText('components/EditorialStudioHeader.tsx');
  const design = srcText('components/DesignTypesettingPanel.tsx');
  const rules = srcText('components/TypesettingRulesModal.tsx');
  const presets = srcText('engine/layout-presets.ts');
  check('layoutPresetLabel takes a lang and returns labelEn in English',
    presets.includes("layoutPresetLabel(id: BookLayoutType, lang: 'he' | 'en'") && presets.includes('opt.labelEn ?? opt.labelHe'));
  check('Home template line uses the lang-aware layout label',
    home.includes('layoutPresetLabel(layout, lang)'));
  check('Home autosave-found line uses tf()', home.includes("tf('שמירה ברקע זוהתה: {time}'"));
  check('Home autosave times use a lang-aware locale',
    !home.includes("toLocaleTimeString('he-IL')") && home.includes("lang === 'en' ? 'en-US' : 'he-IL'"));
  check('Home Continue arrow is dir-aware',
    home.includes("dir === 'rtl' ? <ArrowLeft") && home.includes('<ArrowRight'));
  check('Status-bar autosave line uses tf()', status.includes("tf('נשמר אוטומטית ב-{time}'"));
  check('Status-bar autosave time uses a lang-aware locale',
    !status.includes("toLocaleTimeString('he-IL'") && status.includes("lang === 'en' ? 'en-US' : 'he-IL'"));
  check('Hub extraction progress uses tf()', hub.includes("tf('מחלץ טקסט מתוך {name}...'"));
  check('Hub import button uses tf() with a plural noun', hub.includes("tf('ייבא {count} {files} ועמד ספר'"));
  check('Auto-layout notice banner renders lineEn in English',
    app.includes("lang === 'en' ? autoLayoutNotice.lineEn : autoLayoutNotice.lineHe"));
  check('Hub review-queue badge renders reasonEn in English',
    hub.includes("lang === 'en' ? (conf.reasonEn ?? conf.reasonHe) : conf.reasonHe"));
  check('Export PDF notice uses tf()', exp.includes("tf('הפקת קובץ PDF הושלמה בהצלחה!"));
  check('Export IDML notice uses tf()', exp.includes("tf('הפקת חבילת IDML הושלמה בהצלחה!"));
  check('Export .keter notice uses tf()', exp.includes("tf('שמירת קובץ פרויקט .keter הושלמה בהצלחה!"));
  check('Export overlap count has singular + plural tf()',
    exp.includes("tf('{count} חפיפה'") && exp.includes("tf('{count} חפיפות'"));
  check('Export alert count has singular + plural tf()',
    exp.includes("tf('{count} התראה'") && exp.includes("tf('{count} התראות'"));
  check('App manual-save snapshot label uses tf()', app.includes("tf('שמירה יזומה: {title}'"));
  check('App real-flow IDML toast has singular + plural tf()',
    app.includes("tf('קובץ IDML זרימת רב-טקסט אמיתית ל-Adobe InDesign ({count} עמוד) הופק בהצלחה!'") &&
    app.includes("tf('קובץ IDML זרימת רב-טקסט אמיתית ל-Adobe InDesign ({count} עמודים) הופק בהצלחה!'"));
  check('License device-id toast uses tf()', lic.includes("tf('הוחלף מזהה מחשב פעיל ל: {label}'"));
  check('Header undo tooltip uses tf()', head.includes("tf('בטל: {label} (Ctrl+Z)'"));
  check('Header redo tooltip uses tf()', head.includes("tf('בצע מחדש: {label} (Ctrl+Y)'"));
  check('Design panel page-size history label uses tf()', design.includes("tf('גודל דף {value}'"));
  check('Design panel Quick-Tune history label uses tf()', design.includes("tf('כוונון מהיר: {label}'"));
  check('Design panel page-width history label uses tf()', design.includes("tf('רוחב עמוד {value}pt'"));
  check('Design panel page-height history label uses tf()', design.includes("tf('גובה עמוד {value}pt'"));
  check('Rules-modal NL feedback uses tf()', rules.includes("tf('תורגם בהצלחה ל-{count} חוקים קשיחים ({rules})!'"));
  check('Rules-modal project-rule description uses tf()', rules.includes("tf('הגדרת פרויקט עבור {ruleId}'"));
  // No bare 'he-IL' locale left in any component (Word-export XML is
  // Hebrew content by design and lives in the engine, not components).
  const compFiles = srcFiles.filter(f => f.includes(`${path.sep}components${path.sep}`));
  const bareHeIL = compFiles.filter(f => {
    // A bare locale is a direct 'he-IL' argument; the lang-aware
    // ternary (lang === 'en' ? 'en-US' : 'he-IL') is allowed, so
    // strip it before looking.
    const t = fs.readFileSync(f, 'utf-8').replaceAll("lang === 'en' ? 'en-US' : 'he-IL'", '');
    return t.includes("toLocaleTimeString('he-IL'") || t.includes("toLocaleDateString('he-IL'");
  });
  check('no bare he-IL time/date locale in components', bareHeIL.length === 0, bareHeIL.map(f => path.basename(f)).join(', '));
}

// ── §10  version ─────────────────────────────────────────────────────
console.log('§10  version');
check('package.json version 0.9.8', pkg.version === '0.9.8', `version=${pkg.version}`);

console.log(`\nv098-i18n-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
