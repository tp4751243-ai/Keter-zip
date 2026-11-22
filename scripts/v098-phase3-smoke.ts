/**
 * KETER-TYPE v0.9.8 Phase 3 — CommentaryLinkerEngine (Dibbur HaMatchil
 * auto-linking) smoke test.
 *
 * Run from the repo root:  npx tsx scripts/v098-phase3-smoke.ts
 *
 * Verifies:
 *  §1  One canonical normaliser: nikkud + ta'amim stripped, final
 *      letters folded, ד"ה / בד"ה prefixes stripped, quotes stripped,
 *      ktiv malei/chaser as a secondary key only.
 *  §2  String similarity: Levenshtein, N-gram (Dice), wordSimilarity
 *      (exact → ktiv-equal → prefix-tolerant → Levenshtein).
 *  §3  Sliding-window anchor resolution: dibburim link to the right
 *      anchors in document order with confidences; forward preference;
 *      ~30-word lookback; beyond-lookback does NOT match; the cursor
 *      never moves backwards after a lookback match; no guessing.
 *  §4  LinkingReport counts (total / linked / high / medium / review /
 *      unmatched) and the bilingual summary line.
 *  §5  DibburNode → AnchorLink wiring (Phase 2 tokenisation output).
 *  §6  RavTextLink conversion + merge over the old linker + the
 *      EXISTING review queue flags the uncertain ones.
 *  §7  Bilingual i18n: every new key exists in EN_STRINGS; the summary
 *      renders in Hebrew and in English.
 *  §8  version is 0.9.8.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { DOMParser } from '@xmldom/xmldom';
// The linker imports docx-importer (threshold constant); install the
// @xmldom shims before importing it, as the Phase 2 smoke does.
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
(globalThis as unknown as { Node: unknown }).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeHebrewForMatching,
  normalizeHebrewForMatchingKtivInsensitive,
  levenshtein,
  ngramSimilarity,
  wordSimilarity,
  linkCommentariesToSource,
  buildLinkingReport,
  linkingReportFromRavTextLinks,
  formatLinkingReportSummary,
  dibburNodesToAnchorLinks,
  anchorLinksToRavTextLinks,
  mergeLinkSets,
  DEFAULT_LINKER_OPTIONS,
} from '../src/engine/commentary-linker';
import { flagUncertainMatches } from '../src/engine/docx-importer';
import { tokenizeDibbur } from '../src/engine/docx-semantics';
import { EN_STRINGS } from '../src/i18n/strings';
import type { ContentUnit, RavTextLink } from '../src/types/typesetter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function unit(id: string, role: ContentUnit['role'], rawText: string, extra: Partial<ContentUnit> = {}): ContentUnit {
  return { id, role, rawText, styleName: 'Normal', order: 0, hierarchyLevel: 0, ...extra };
}

// Word-counted source stream (stream indices in brackets):
// s1 [0-9]   "מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן"
// s2 [10-20] "עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות"
// s3 [21-32] "רבן גמליאל אומר עד שיעלה עמוד השחר ומעשה ובאו בניו מבית המשתה"
// s4 [33-42] "תנא היכא קאי דקתני מאי שנא הכא בראש הפרק"
// s5 [43-50] pointed "מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית עַד סוֹף הָאַשְׁמוּרָה"
// s6 [51-60] "אמר רבי יהושע בן לוי זמן קריאת שמע של ערבית כרבי אליעזר"
// NOTE: s4 deliberately does NOT repeat "מאימתי קורין", and s5 does NOT
// repeat "משעה שהכהנים נכנסים" — those phrases belong to s1 alone, so
// the forward-preference and beyond-lookback checks below are meaningful.
const SOURCES: ContentUnit[] = [
  unit('s1', 'main_source', 'מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן'),
  unit('s2', 'main_source', 'עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות'),
  unit('s3', 'main_source', 'רבן גמליאל אומר עד שיעלה עמוד השחר ומעשה ובאו בניו מבית המשתה'),
  unit('s4', 'main_source', 'תנא היכא קאי דקתני מאי שנא הכא בראש הפרק'),
  unit('s5', 'main_source', 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית עַד סוֹף הָאַשְׁמוּרָה'),
  unit('s6', 'main_source', 'אמר רבי יהושע בן לוי זמן קריאת שמע של ערבית כרבי אליעזר'),
];

function commentary(id: string, dibbur: string, body = 'פירוש קצר על הדיבור.'): ContentUnit {
  const rawText = `${dibbur}: ${body}`;
  const node = tokenizeDibbur(rawText, id, { knownDibbur: dibbur });
  return unit(id, 'primary_comment', rawText, {
    dibburHamatchil: dibbur,
    ...(node ? { dibburNode: node } : {}),
  });
}

console.log('§1  Canonical normaliser (one, not three)');
check('nikkud stripped, letters kept', normalizeHebrewForMatching('מֵאֵימָתַי') === 'מאימתי', normalizeHebrewForMatching('מֵאֵימָתַי'));
check('taamim stripped', normalizeHebrewForMatching('בְּרֵאשִׁ֖ית') === 'בראשית', normalizeHebrewForMatching('בְּרֵאשִׁ֖ית'));
check('final letters folded ך→כ ם→מ ן→נ ף→פ ץ→צ',
  normalizeHebrewForMatching('מלך סוף אף עץ') === 'מלכ סופ אפ עצ',
  normalizeHebrewForMatching('מלך סוף אף עץ'));
check('ד"ה prefix stripped', normalizeHebrewForMatching('ד"ה מאימתי') === 'מאימתי');
check('בד"ה prefix stripped (final ן folds to נ)', normalizeHebrewForMatching('בד"ה מאימתי קורין') === 'מאימתי קורינ');
check('quotation marks deleted inside words, not spaced (רש״י → רשי)', normalizeHebrewForMatching('רש״י אומר') === 'רשי אומר', normalizeHebrewForMatching('רש״י אומר'));
check('punctuation stripped (final ן folds to נ)', normalizeHebrewForMatching('מאימתי, קורין.') === 'מאימתי קורינ');
check('ktiv secondary key: דווד == דוד',
  normalizeHebrewForMatchingKtivInsensitive('דווד') === normalizeHebrewForMatchingKtivInsensitive('דוד'),
  `${normalizeHebrewForMatchingKtivInsensitive('דווד')} vs ${normalizeHebrewForMatchingKtivInsensitive('דוד')}`);
check('primary key keeps ו/י (no over-merge)',
  normalizeHebrewForMatching('דווד') !== normalizeHebrewForMatching('דוד'));
check('window defaults: lookback 30, forward 500',
  DEFAULT_LINKER_OPTIONS.lookbackWords === 30 && DEFAULT_LINKER_OPTIONS.forwardWindowWords === 500);

console.log('§2  String similarity');
check('levenshtein identical = 0', levenshtein('מלך', 'מלך') === 0);
check('levenshtein one edit = 1', levenshtein('מלך', 'מלכ') === 1);
check('levenshtein empty = length', levenshtein('', 'שלום') === 4);
check('ngram identical = 1', ngramSimilarity('מאימתי', 'מאימתי') === 1);
check('ngram one-letter typo > 0.7', ngramSimilarity('הראשונה', 'הראשנה') > 0.7, ngramSimilarity('הראשונה', 'הראשנה').toFixed(3));
check('ngram unrelated < 0.3', ngramSimilarity('מאימתי', 'בננה') < 0.3);
check('wordSimilarity exact = 1', wordSimilarity('מאימתי', 'מאימתי') === 1);
check('wordSimilarity ktiv-equal = 0.95 (ו dropped)', wordSimilarity('דווד', 'דוד') === 0.95);
check('wordSimilarity genuine typo ≈ 0.86 (ה→א, ktiv differs)', Math.abs(wordSimilarity('הראשונה', 'הראשונא') - (1 - 1 / 7)) < 0.01);
check('wordSimilarity unrelated = 0', wordSimilarity('מאימתי', 'בננה') === 0);
check('wordSimilarity short words need exact (no 1-edit credit)', wordSimilarity('עד', 'עז') === 0);

console.log('§3  Sliding-window anchor resolution');
const COMMENTARIES: ContentUnit[] = [
  commentary('c1', 'מאימתי קורין'),
  commentary('c2', 'עד סוף האשמורה'),
  // One-letter typo in the dibbur (ה→א at the end — NOT a ktiv
  // variation, so the exact branch must not take it): fuzzy match on
  // s2. Placed here, while the cursor is still at s2: after c4 the
  // cursor has advanced 35 words past s2, beyond the lookback.
  commentary('c7', 'עד סוף האשמורה הראשונא'),
  commentary('c3', 'רבן גמליאל אומר'),
  // Unpointed dibbur against the POINTED s5 source: normalised exact, not verbatim.
  commentary('c4', 'מאימתי קורין'),
  // Lookback: s4 sits ~10 words behind the cursor.
  commentary('c5', 'תנא היכא קאי'),
  // No such phrase anywhere: must stay unmatched, never guessed.
  commentary('c6', 'דבר שאינו כתוב כלל בגמרא'),
  // Forward again after lookback matches: s6.
  commentary('c8', 'אמר רבי יהושע'),
  // Phrase 40+ words behind the cursor (s1): beyond the 30-word lookback.
  commentary('c9', 'משעה שהכהנים נכנסים'),
];
const links = linkCommentariesToSource(SOURCES, COMMENTARIES);
const byId = new Map(links.map(l => [l.commentaryUnitId, l]));
const show = (id: string) => {
  const l = byId.get(id)!;
  return `${l.method} ${l.linkConfidence.toFixed(2)} → ${l.targetMainNodeId ?? '(none)'} @${l.targetCharOffset ?? '-'}`;
};
check('c1 exact → s1, confidence 1.0 (verbatim)', byId.get('c1')?.targetMainNodeId === 's1' && byId.get('c1')?.linkConfidence === 1.0, show('c1'));
check('c2 exact → s2, confidence 1.0', byId.get('c2')?.targetMainNodeId === 's2' && byId.get('c2')?.linkConfidence === 1.0, show('c2'));
check('c3 exact → s3, confidence 1.0', byId.get('c3')?.targetMainNodeId === 's3' && byId.get('c3')?.linkConfidence === 1.0, show('c3'));
check('c4 unpointed dibbur → pointed s5, normalised 0.95 (not verbatim)',
  byId.get('c4')?.targetMainNodeId === 's5' && byId.get('c4')?.linkConfidence === 0.95, show('c4'));
check('c4 char offset lands inside s5', (byId.get('c4')?.targetCharOffset ?? -1) >= 0);
check('c5 lookback → s4 (behind the cursor)', byId.get('c5')?.targetMainNodeId === 's4', show('c5'));
check('c6 unmatched: no target, method unmatched, confidence < 0.65',
  byId.get('c6')?.method === 'unmatched' && !byId.get('c6')?.targetMainNodeId && (byId.get('c6')?.linkConfidence ?? 1) < 0.65, show('c6'));
check('c7 fuzzy (typo) → s2, confidence in [0.8, 0.9]',
  byId.get('c7')?.method === 'fuzzy' && byId.get('c7')?.targetMainNodeId === 's2' &&
  (byId.get('c7')?.linkConfidence ?? 0) >= 0.8 && (byId.get('c7')?.linkConfidence ?? 1) <= 0.9, show('c7'));
check('c8 forward after lookback matches → s6', byId.get('c8')?.targetMainNodeId === 's6', show('c8'));
check('c9 beyond lookback → unmatched (cursor did not regress)',
  byId.get('c9')?.method === 'unmatched' && !byId.get('c9')?.targetMainNodeId, show('c9'));
check('targets in document order for the forward chain (c1→c2→c3→c4→c8)',
  ['c1', 'c2', 'c3', 'c4', 'c8'].map(id => byId.get(id)?.targetMainNodeId).join(',') === 's1,s2,s3,s5,s6');

// Separate beyond-lookback control: cursor advanced far past the phrase.
const CTRL_SOURCES: ContentUnit[] = [
  unit('a1', 'main_source', 'אחד שנים שלשה ארבעה חמשה'),
  unit('a2', 'main_source', 'אבטיח בננה גזר דלעת הדר ורד זית חיטה טלה ירק כרוב לימון מלפפון נענע סלק ענב פרי צנון קישוא רימון שזיף תאנה תמר אבטיח בננה גזר דלעת הדר ורד זית חיטה טלה ירק כרוב לימון מלפפון נענע סלק ענב פרי צנון קישוא רימון'),
  unit('a3', 'main_source', 'ששה שבעה שמונה תשעה עשרה'),
];
const CTRL_COMS: ContentUnit[] = [
  commentary('k1', 'ששה שבעה שמונה'),
  commentary('k2', 'אחד שנים שלשה'),
];
const ctrlLinks = linkCommentariesToSource(CTRL_SOURCES, CTRL_COMS);
check('control: first dibbur finds the far phrase (forward window)', ctrlLinks[0]?.targetMainNodeId === 'a3', `${ctrlLinks[0]?.method} → ${ctrlLinks[0]?.targetMainNodeId}`);
check('control: phrase 45+ words behind the cursor is unmatched', ctrlLinks[1]?.method === 'unmatched' && !ctrlLinks[1]?.targetMainNodeId, `${ctrlLinks[1]?.method} → ${ctrlLinks[1]?.targetMainNodeId ?? '(none)'}`);

console.log('§4  LinkingReport counts');
const report = buildLinkingReport(links);
check('total = 9 dibburim', report.totalDibburim === 9, String(report.totalDibburim));
check('linked = 7', report.linkedCount === 7, String(report.linkedCount));
check('high-confidence (≥0.9) = 6', report.highConfidenceCount === 6, String(report.highConfidenceCount));
check('medium (0.8–0.9) = 1 (the fuzzy c7)', report.mediumConfidenceCount === 1, String(report.mediumConfidenceCount));
check('review (<0.8, linked) = 0', report.reviewCount === 0, String(report.reviewCount));
check('unmatched = 2 (c6, c9)', report.unmatchedCount === 2 && report.unmatched.length === 2, String(report.unmatchedCount));
check('report.links preserves commentary order',
  report.links.map(l => l.commentaryUnitId).join(',') === COMMENTARIES.map(c => c.id).join(','));

console.log('§5  DibburNode → AnchorLink wiring');
const nodeLinks = dibburNodesToAnchorLinks([...SOURCES, ...COMMENTARIES], SOURCES);
check('nodes link the 9 commentary units', nodeLinks.length === 9, String(nodeLinks.length));
check('dibburId travels on the AnchorLink', nodeLinks.every(l => l.dibburId === `dibbur-${l.commentaryUnitId}`), nodeLinks[0]?.dibburId ?? '(none)');
check('node run agrees with the direct run on targets',
  nodeLinks.map(l => l.targetMainNodeId ?? '').join(',') === links.map(l => l.targetMainNodeId ?? '').join(','));

console.log('§6  RavTextLink conversion + merge + review queue');
const ravLinks = anchorLinksToRavTextLinks(links, [...SOURCES, ...COMMENTARIES], SOURCES[0]);
check('conversion yields one RavTextLink per anchor (incl. unmatched)', ravLinks.length === 9, String(ravLinks.length));
const ravById = new Map(ravLinks.map(l => [l.commentaryUnitId, l]));
check('exact link keeps confidence 1.0', ravById.get('c1')?.confidenceScore === 1.0);
check('unmatched becomes a ≤0.4 link labelled awaiting review',
  (ravById.get('c6')?.confidenceScore ?? 1) <= 0.4 &&
  (ravById.get('c6')?.matchConfidence?.reasonHe ?? '').includes('ממתין לסקירה'),
  ravById.get('c6')?.matchConfidence?.reasonHe ?? '');
check('unmatched fallback target is the current sugya position (s1)',
  ravById.get('c6')?.sourceUnitId === 's1');
// Old linker output: c1 weaker (0.9), c6 stronger (0.7 fuzzy) than the new engine.
const oldLinks: RavTextLink[] = [
  { linkId: 'old-c1', sourceUnitId: 's1', commentaryUnitId: 'c1', dibburHamatchil: 'מאימתי קורין', isUserLocked: false, confidenceScore: 0.9, sourceSnippet: '', commentarySnippet: '', commentaryType: 'Rashi' },
  { linkId: 'old-c6', sourceUnitId: 's2', commentaryUnitId: 'c6', dibburHamatchil: 'דבר שאינו כתוב כלל בגמרא', isUserLocked: false, confidenceScore: 0.7, sourceSnippet: '', commentarySnippet: '', commentaryType: 'Rashi' },
];
const merged = mergeLinkSets(ravLinks, oldLinks);
const mergedById = new Map(merged.map(l => [l.commentaryUnitId, l]));
check('merge keeps the higher-confidence link per commentary (new 1.0 beats old 0.9)',
  mergedById.get('c1')?.confidenceScore === 1.0);
check('merge keeps the old link where the new engine is weaker (old 0.7 beats new 0.35)',
  mergedById.get('c6')?.confidenceScore === 0.7 && mergedById.get('c6')?.linkId === 'old-c6');
check('merge never drops a commentary', merged.length === 9);
const uncertain = flagUncertainMatches(merged);
check('review queue flags only the <0.8 merged links (c6 old 0.7, c9 unmatched)',
  uncertain.length === 2 &&
  uncertain.map(l => l.commentaryUnitId).sort().join(',') === 'c6,c9',
  uncertain.map(l => l.commentaryUnitId).join(','));
const ravReport = linkingReportFromRavTextLinks(merged);
check('report from RavTextLinks agrees on totals', ravReport.totalDibburim === 9 && ravReport.linkedCount === 9, `${ravReport.totalDibburim}/${ravReport.linkedCount}`);

console.log('§7  Bilingual i18n');
const tHe = (he: string) => he;
const tEn = (he: string) => EN_STRINGS[he] ?? he;
const NEW_KEYS = [
  'דו״ח קישור דיבורי המתחיל',
  'קושרו',
  'קושר', // v0.9.8 Bilingual Audit — singular (count === 1)
  'בוודאות גבוהה',
  'ממתינים לסקירה',
  'ממתין לסקירה', // v0.9.8 Bilingual Audit — singular (count === 1)
  'לא קושרו',
  'לא קושר', // v0.9.8 Bilingual Audit — singular (count === 1)
  'מעמד עמודים…',
  'העימוד נכשל',
  'קישורים בודאות 80% ומעלה מוחלים אוטומטית; חלשים יותר ממתינים לסקירה למעלה — שום דבר לא מנוחש. מנוע הקישור החדש משווה דיבורים למקור ללא ניקוד, עם התאמה מטושטשת וחלון חיפוש עוקב.',
];
for (const k of NEW_KEYS) {
  check(`EN_STRINGS has "${k.slice(0, 28)}…"`, typeof EN_STRINGS[k] === 'string' && EN_STRINGS[k].length > 0);
}
const summaryHe = formatLinkingReportSummary(report, tHe, 'he');
const summaryEn = formatLinkingReportSummary(report, tEn, 'en');
check('summary renders in Hebrew', summaryHe.includes('ד״ה') && summaryHe.includes('קושרו'), summaryHe);
check('summary renders in English (no Hebrew left)', !/[\u0590-\u05FF]/.test(summaryEn) && summaryEn.includes('linked'), summaryEn);
check('summary counts are right (7 linked · 6 high · 0 review · 2 unlinked)',
  summaryEn.startsWith('7 D.H. linked · 6 high-confidence · 0 awaiting review · 2 unlinked'), summaryEn);

console.log('§8  version is 0.9.8');
check('package.json version 0.9.8', pkg.version === '0.9.8', `version=${pkg.version}`);

console.log(`\nv098-phase3-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
