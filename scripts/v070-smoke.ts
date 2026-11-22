/**
 * KETER-TYPE v0.7.0 — merged-tree smoke test (Part 3: Vilna Shas; Part 2:
 * frame tools; Part 1: workspace layout). Run from the tree root with:
 *   npx tsx scripts/v070-smoke.ts
 *
 * Pure-engine checks only (no DOM, no React render): spread/folio/flank
 * rules, dibbur verification + re-link fix, flaw scan, Shas classification,
 * NL commands, Vilna defaults, frame tools + threading, workspace
 * persistence, Gemini action types, and the knee-engine verso mirror
 * (Rashi must move from the right flank to the left flank when
 * mirrorFlanks is on, keeping its role + unit id).
 */
import {
  applyVilnaShasDefaults,
  buildMichtavBox,
  classifyShasParagraph,
  flankPhysicalSides,
  fixShasFlaws,
  folioLatin,
  folioLatinTalmud,
  parseShasCommand,
  scanShasFlaws,
  spreadSide,
  spreadSideForPageIndex,
  verifyDibburHamatchil,
} from '../src/engine/vilna-shas';
// Part 1/2 modules live in the merged tree; in a Part-C-only tree they are
// absent, so import them lazily and skip those sections if unavailable.
let frameTools: typeof import('../src/engine/frame-tools') | null = null;
let workspaceLayout: typeof import('../src/engine/workspace-layout') | null = null;
let polygonPresetPoints: typeof import('../src/engine/custom-layout-engine').polygonPresetPoints | null = null;
try {
  frameTools = await import('../src/engine/frame-tools');
  workspaceLayout = await import('../src/engine/workspace-layout');
  ({ polygonPresetPoints } = await import('../src/engine/custom-layout-engine'));
} catch {
  console.log('  (note: Part 1/2 modules not present in this tree — those checks skipped)');
}
import { GEMINI_ACTION_TYPES } from '../src/engine/gemini-service';
import { reorderPageUnits } from '../src/engine/page-operations';
import { folioLabel, spreadPairs } from '../src/engine/page-labels';
import { DynamicKneeEngine } from '../src/engine/dynamic-knee';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import type { ContentUnit, PageTypesetResult, RavTextLink } from '../src/types/typesetter';

const store = new Map<string, string>();
// Minimal localStorage shim for the workspace round-trip check.
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  length: 0,
} as Storage;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
}

const GEMARA = 'אמר רב יהודה אמר שמואל כל השונה הלכות בכל יום מובטח לו שהוא בן העולם הבא';
const RASHI = 'כל השונה הלכות פירוש משנה וגמרא בכל יום ויום מובטח לו שהוא בן העולם הבא שנאמר אשרי תמימי דרך';
const TOSAFOT = 'כל השונה הלכות קשה דהא אמרינן בפרק קמא דברכות דכל העוסק בתורה בלבד אינו נוטל שכר';

const units: ContentUnit[] = [
  { id: 'u-gemara', role: 'main_source', rawText: GEMARA, styleName: 'Normal', order: 0, hierarchyLevel: 2 },
  { id: 'u-rashi', role: 'primary_comment', rawText: `${'כל השונה הלכות'} ${RASHI}`, styleName: 'Normal', order: 1, hierarchyLevel: 3, dibburHamatchil: 'כל השונה הלכות' },
  { id: 'u-tos', role: 'secondary_comment', rawText: `${'כל השונה הלכות'} ${TOSAFOT}`, styleName: 'Normal', order: 2, hierarchyLevel: 3, dibburHamatchil: 'כל השונה הלכות' },
  { id: 'u-bad', role: 'primary_comment', rawText: 'פירוש אחר לגמרי שאינו מצטט דבר', styleName: 'Normal', order: 3, hierarchyLevel: 3, dibburHamatchil: 'מילים שלא קיימות בגמרא' },
];
const links: RavTextLink[] = [
  { linkId: 'link-1', sourceUnitId: 'u-gemara', commentaryUnitId: 'u-rashi', dibburHamatchil: 'כל השונה הלכות', isUserLocked: false, confidenceScore: 0.95, sourceSnippet: 'כל השונה הלכות', commentarySnippet: 'כל השונה הלכות', commentaryType: 'Rashi' },
  { linkId: 'link-2', sourceUnitId: 'u-gemara', commentaryUnitId: 'u-bad', dibburHamatchil: 'מילים שלא קיימות בגמרא', isUserLocked: false, confidenceScore: 0.4, sourceSnippet: 'מילים שלא קיימות', commentarySnippet: 'פירוש אחר', commentaryType: 'Rashi' },
];

function fakePage(pageNumber: number, hebrew: string): PageTypesetResult {
  return {
    pageIndex: pageNumber - 1,
    pageNumber,
    pageNumberHebrew: hebrew,
    headerTitle: '',
    layoutType: 'rav_text',
    geometry: { pageWidth: 482, pageHeight: 680, marginTop: 48, marginBottom: 48, marginInside: 46, marginOutside: 42, isVerso: false },
    sourceLines: [],
    rashiLines: [],
    tosafotLines: [],
    footnoteLines: [],
    knee: { pageContentWidth: 394, pageContentHeight: 584, topY: 0, kneeJunctionY: 300, bottomY: 584, upperSourceWidth: 200, lowerSourceWidth: 200, innerXOffset: 0, isLeftStepped: false, rightCommentaryWidth: 80, leftCommentaryWidth: 80, gutterWidth: 12 },
  } as unknown as PageTypesetResult;
}

console.log('v0.7.0 smoke:');
/* Spread / folio / flanks — v0.8.0 Part C (§4): the rule is ONE consistent
   Hebrew-book rule (Rashi INNER, Tosafot OUTER). Hebrew books open
   left-to-right-reversed, so the recto/a-side (e.g. 2a) is the LEFT-hand
   page of the spread and the verso/b-side (e.g. 2b) is the RIGHT-hand
   page — the v0.7.0 assertions below had the English-book convention
   (recto right, verso left) and were inverted. Evidence: Wikipedia
   "Recto and verso" (in right-to-left scripts the recto is to the left),
   Wikipedia "Tosafot" (folio 2a: Rashi on the inner/right margin,
   Tosafot on the outer/left margin), and the Vilna Edition Shas article
   (Rashi inner, Tosafot outer). The knee solver + mirrorFlanks already
   matched the real daf; only these helpers/docs/smoke lines were wrong. */
check('spread: standard 1 left, 2 right', spreadSide(1) === 'left' && spreadSide(2) === 'right');
check('spread: talmud 2 (2a) left, 3 (2b) right', spreadSide(2, 'talmud') === 'left' && spreadSide(3, 'talmud') === 'right');
check('spread by page index: 0 left, 1 right', spreadSideForPageIndex(0) === 'left' && spreadSideForPageIndex(1) === 'right');
check('folio latin standard: 1→1a, 2→1b, 3→2a', folioLatin(1) === '1a' && folioLatin(2) === '1b' && folioLatin(3) === '2a');
check('folio latin talmud: 2→2a, 3→2b, 4→3a', folioLatinTalmud(2) === '2a' && folioLatinTalmud(3) === '2b' && folioLatinTalmud(4) === '3a');
check('flanks recto: Rashi right(inner), Tosafot left(outer)', (() => { const f = flankPhysicalSides(1); return f.rashi === 'right' && f.tosafot === 'left'; })());
check('flanks verso: Rashi left(inner), Tosafot right(outer)', (() => { const f = flankPhysicalSides(2); return f.rashi === 'left' && f.tosafot === 'right'; })());
check('flanks talmud: 2a recto Rashi right, 2b verso Rashi left', (() => { const a = flankPhysicalSides(2, 'talmud'); const b = flankPhysicalSides(3, 'talmud'); return a.rashi === 'right' && a.tosafot === 'left' && b.rashi === 'left' && b.tosafot === 'right'; })());

/* Dibbur verification + flaw scan + fix */
const ver = verifyDibburHamatchil(units, links);
check('dibbur verify: good link passes', ver.find(v => v.linkId === 'link-1')?.ok === true);
check('dibbur verify: bad link fails, no suggestion', ver.find(v => v.linkId === 'link-2')?.ok === false);
const pages = [fakePage(1, 'א׳'), fakePage(2, '')];
const flaws = scanShasFlaws(pages, units, links);
check('flaw scan finds missing folio', flaws.some(f => f.kind === 'missing_folio' && f.pageNumber === 2));
check('flaw scan finds broken dibbur link', flaws.some(f => f.kind === 'broken_dibbur_link'));
const badLinkFixed = verifyDibburHamatchil(units, [
  { ...links[1], sourceUnitId: 'u-gemara' },
]);
void badLinkFixed;
const fixUnits = [...units, { id: 'u-alt', role: 'main_source', rawText: 'מילים שלא קיימות בגמרא מופיעות כאן', styleName: 'Normal', order: 4, hierarchyLevel: 2 } as ContentUnit];
const ver2 = verifyDibburHamatchil(fixUnits, links);
check('dibbur verify suggests the unit that contains the words', ver2.find(v => v.linkId === 'link-2')?.suggestedSourceUnitId === 'u-alt');
const fix = fixShasFlaws(scanShasFlaws(pages, fixUnits, links), fixUnits, links, pages);
check('one-click fix re-links the broken dibbur', fix.links.find(l => l.linkId === 'link-2')?.sourceUnitId === 'u-alt' && fix.fixedCount >= 1);

/* Classification + NL commands */
check('classify: Mishna → main_source', classifyShasParagraph('משנה ראשונה במסכת', '')?.role === 'main_source');
check('classify: Ein Mishpat → tertiary', classifyShasParagraph('עין משפט סימן א', '')?.role === 'tertiary_comment');
check('classify: Masoret HaShas → tertiary', classifyShasParagraph('מסורת הש״ס ברכות ב.', '')?.role === 'tertiary_comment');
check('classify: marginal reference → cross_reference', classifyShasParagraph('עיין ברכות דף ב.', '')?.role === 'cross_reference');
check('NL: move Rashi closer', parseShasCommand('Move Rashi closer to the Gemara column')?.action === 'move_rashi');
check('NL: expand Tosafot width', parseShasCommand('Expand Tosafot width')?.action === 'expand_tosafot');
check('NL: check footer alignment', parseShasCommand('Check alignment of footer references')?.action === 'check_footer_alignment');
check('NL: verify folio sequence', parseShasCommand('Verify folio pagination sequence')?.action === 'verify_folio_sequence');
check('NL: Hebrew dibbur check', parseShasCommand('בדוק דיבור המתחיל')?.action === 'verify_dibbur');

/* Vilna defaults + Michtav */
const defaults = DesignSettingsEngine.createDefaultSettings({ layoutType: 'rav_text' });
const vilna = applyVilnaShasDefaults(defaults);
const ch = DesignSettingsEngine.resolveRoleAndUnitStyle(vilna, 'chapter').paragraph;
const src = DesignSettingsEngine.resolveRoleAndUnitStyle(vilna, 'main_source').paragraph;
check('vilna defaults: perek title centred', ch.alignment === 'center');
check('vilna defaults: second-row indent (hanging 12, first-line 0)', src.hangingIndentPt === 12 && src.firstLineIndentPt === 0);
check('vilna defaults: gemara justified', src.alignment === 'justify');
const michtav = buildMichtavBox('חבל');
check('michtav box centred above gemara', michtav.role === 'header' && michtav.xPct === 20 && michtav.widthPct === 60 && michtav.yPct < 10);

if (frameTools && workspaceLayout && polygonPresetPoints) {
/* Frame tools + threading + ellipse */
check('ellipse preset: 16 vertices', polygonPresetPoints!('ellipse').length === 16);
check('ellipse points helper: 16 vertices', frameTools!.ellipsePoints().length === 16);
const lBox = frameTools!.createFrameBox('polygon', 'main_text', 'l_shape');
check('polygon L frame carries L shape', lBox.shape?.kind === 'l_shape' && (lBox.shape?.points.length ?? 0) === 6);
const eBox = frameTools!.createFrameBox('ellipse', 'commentary');
check('ellipse frame carries ellipse shape', eBox.shape?.kind === 'ellipse');
const moved = frameTools!.moveBoxVertex(lBox, 0, 0.1, 0.2);
check('vertex move edits one vertex only', moved.shape?.points[0].x === 0.1 && moved.shape?.points[1].x === lBox.shape?.points[1].x);
check('polygon variants: T has 8 points', frameTools!.polygonVariantPoints('t_shape').length === 8);
const threadPages = [fakePage(1, 'א׳')] as PageTypesetResult[];
(threadPages[0] as unknown as { sourceLines: unknown[] }).sourceLines = [
  { unitId: 'u1', customLayoutBoxId: 'box-a' },
  { unitId: 'u2', customLayoutBoxId: 'box-b' },
] as never;
const threadLinks = frameTools!.computeThreadLinks(threadPages, 0);
check('threading: box-a → box-b link', threadLinks.length === 1 && threadLinks[0].fromBoxId === 'box-a' && threadLinks[0].toBoxId === 'box-b');

/* Workspace layout */
const wsHe = workspaceLayout!.defaultWorkspaceLayout('he');
// v0.8.0 Part B: the mock panels (page_design / layers / glyphs) are
// gone; the left dock in Hebrew now holds the real style panels.
check('workspace RTL: paragraph styles docked left in Hebrew', wsHe.panels.find(p => p.id === 'paragraph_styles')?.side === 'left');
check('workspace v080: only real panels remain', wsHe.panels.length === 3 && wsHe.panels.every(p => ['paragraph_styles', 'character_styles', 'links'].includes(p.id)));
check('workspace v080: panels default collapsed so the canvas is wide', wsHe.panels.every(p => p.collapsed));
// v0.8.0 Part B: a persisted pre-v0.8.0 layout is migrated — removed
// panels dropped, survivors collapsed, missing panels added back.
const legacyLayout = { name: 'old', panels: [
  { id: 'page_design', side: 'left', order: 0, collapsed: false },
  { id: 'paragraph_styles', side: 'left', order: 1, collapsed: false },
  { id: 'glyphs', side: 'right', order: 0, collapsed: false },
] } as unknown as Parameters<typeof workspaceLayout.normalizeWorkspaceLayout>[0];
const migrated = workspaceLayout!.normalizeWorkspaceLayout(legacyLayout, 'he');
check('workspace v080: migration drops removed panels', migrated.panels.every(p => ['paragraph_styles', 'character_styles', 'links'].includes(p.id)));
check('workspace v080: migration adds missing panels + collapses survivors', migrated.panels.length === 3 && migrated.panels.every(p => p.collapsed));
// v0.8.0 Part B: named workspaces can be saved, listed and deleted.
workspaceLayout!.saveWorkspaceNamed({ ...wsHe, name: 'smoke-test-ws' });
check('workspace v080: named workspace listed after save', workspaceLayout!.loadSavedWorkspaces().some(w => w.name === 'smoke-test-ws'));
workspaceLayout!.deleteSavedWorkspace('smoke-test-ws');
check('workspace v080: named workspace gone after delete', !workspaceLayout!.loadSavedWorkspaces().some(w => w.name === 'smoke-test-ws'));
workspaceLayout!.saveWorkspace(wsHe);
check('workspace save/load round-trip', workspaceLayout!.loadWorkspace()?.name === wsHe.name);
const originRecto = workspaceLayout!.resolveMeasurementOrigin(10, 482, false);
const originVerso = workspaceLayout!.resolveMeasurementOrigin(10, 482, true);
// v0.8.0 Part C (§4/§5): corrected flank rule — recto is the LEFT-hand
// page, so its inside (binding) edge is the RIGHT edge and the origin
// flips (482−10=472); verso is the RIGHT-hand page, inside = LEFT edge,
// no flip. v0.7.0 had this backwards (English-book convention).
check('measurement origin: inside edge both facings', originRecto.xFromOriginPt === 472 && originVerso.xFromOriginPt === 10);

} // end Part 1/2 section

/* Gemini action types */
for (const t of ['verify_dibbur', 'fix_shas_flaws', 'apply_vilna_defaults', 'move_rashi', 'expand_tosafot', 'verify_folio_sequence', 'check_footer_alignment']) {
  check(`gemini action type registered: ${t}`, (GEMINI_ACTION_TYPES as readonly string[]).includes(t));
}

/* Page labels (v0.9.2 Part B: folioLabel/spreadPairs moved from the deleted
   PagesPanel to engine/page-labels.ts) + real reorder */
const p1 = fakePage(1, 'א׳');
const p2 = fakePage(2, 'ב׳');
const p3 = fakePage(3, 'ג׳');
const pairs = spreadPairs([p1, p2, p3]);
check('pages panel: spread pairs are [right,left] RTL', pairs.length === 2 && pairs[0][0] === p1 && pairs[0][1] === p2 && pairs[1][0] === p3 && pairs[1][1] === null);
check('pages panel: folio label standard 2 → 1b', folioLabel(p2).latin === '1b');
check('pages panel: folio label rav_text 2 → 2a', folioLabel(p2, 'rav_text').latin === '2a');
const bookUnits: ContentUnit[] = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, role: 'main_source', rawText: id, styleName: 'Normal', order: i, hierarchyLevel: 2 } as ContentUnit));
const movedDown = reorderPageUnits(bookUnits, ['a', 'b'], ['c', 'd'], 0, 1);
check('pages reorder: moving page 0 down puts its units after page 1', movedDown.map(u => u.id).join('') === 'cdabe');
const movedUp = reorderPageUnits(bookUnits, ['d', 'e'], ['a', 'b'], 2, 0);
check('pages reorder: moving last page up puts its units first', movedUp.map(u => u.id).join('') === 'deabc');
check('pages reorder: same index is a no-op', reorderPageUnits(bookUnits, ['a'], ['b'], 0, 0) === bookUnits);

/* Shortcuts + context menu + Pages Panel wiring (static: the handlers
   cannot run without a DOM, so verify the wiring textually). */
import * as fs from 'node:fs';
const appSrc = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const menuSrc = fs.readFileSync(new URL('../src/components/FrameContextMenu.tsx', import.meta.url), 'utf8');
check('shortcut V selects the selection tool', appSrc.includes("e.key === 'v'") && appSrc.includes("setActiveTool('select')"));
check('shortcut T arms the internal type tool + starts editing the selected unit (v0.8.0 merge, task §3)', appSrc.includes("e.key === 't'") && appSrc.includes('setEditingUnitId(selectedUnitId)') && appSrc.includes("setActiveTool('type')"));
check('frame tools v080: no dead Type tool button', !fs.readFileSync(new URL('../src/components/FrameToolsToolbar.tsx', import.meta.url), 'utf8').includes("id: 'type'"));
check('context menu v080: assign-style reveals the real style panels', appSrc.includes("handleRevealStylesPanel('paragraph_styles')") && appSrc.includes("handleRevealStylesPanel('character_styles')"));
check('workspace menu v080: named workspaces load via picker', appSrc.includes('handleLoadNamedWorkspace') && appSrc.includes('loadSavedWorkspaces()'));
check('shortcut Ctrl+Tab toggles story view', appSrc.includes("key === 'tab'") && appSrc.includes('setStoryView(v => !v)'));
check('shortcut Ctrl+Shift+>/< changes font size', appSrc.includes("key === '>'") && appSrc.includes("fontSizePt: next"));
check('shortcut Ctrl+Alt+Shift+C auto-centres', appSrc.includes("key === 'c' && e.altKey && e.shiftKey") && appSrc.includes('autoCenterRef.current()'));
check('context menu: dead "Text Frame Options" entry is gone (v0.8.0 Part E #22)', !appSrc.includes('onTextFrameOptions') && !menuSrc.includes('אפשרויות מסגרת טקסט'));
check('context menu: Fitting calls auto-center', appSrc.includes('onFittingAutoCenter={() => handleAutoCenterSelectedBlock()'));
check('context menu: Story Editor opens story view', appSrc.includes('onOpenStoryEditor={() => setStoryView(true)}'));
check('context menu: copy + delete call real handlers', appSrc.includes('onCopyText={() => {') && appSrc.includes('onDeleteUnit={() => {'));
check('pages panel wired to the real reorder handler', appSrc.includes('onReorderPage={handleReorderPage}') && appSrc.includes('onInsertPage={handleInsertPage}') && appSrc.includes('onDeletePage={handleDeletePage}'));
check('control panel + dockable panels rendered', appSrc.includes('<ControlPanel') && appSrc.includes('<DockablePanels') && appSrc.includes('<PageNavigatorSidebar'));
check('threading links passed to the canvas', appSrc.includes('threadLinks={threadLinks}'));
check('shas panel wired', appSrc.includes('<ShasQaPanel') && appSrc.includes('onApplyFixes={handleApplyShasFixes}'));

/* Knee mirror: Rashi must flip flanks, keeping role + unit id */
try {
  const geo = { pageWidth: 482, pageHeight: 680, marginTop: 48, marginBottom: 48, marginInside: 46, marginOutside: 42, isVerso: false };
  const base = {
    sourceText: Array(40).fill('גמרא').join(' '),
    rashiText: RASHI,
    tosafotText: TOSAFOT,
    sourceUnitId: 'u-gemara',
    rashiUnitId: 'u-rashi',
    tosafotUnitId: 'u-tos',
    geometry: geo,
  };
  const recto = DynamicKneeEngine.layoutRavTextPage({ ...base, mirrorFlanks: false });
  const verso = DynamicKneeEngine.layoutRavTextPage({ ...base, mirrorFlanks: true });
  // xLeft/xRight are the physical page coordinates (xStart is always 0
  // in knee output); the line centre is (xLeft + xRight) / 2.
  const meanCentre = (lines: { xLeft?: number; xRight?: number }[]) =>
    lines.length ? lines.reduce((s, l) => s + ((l.xLeft ?? 0) + (l.xRight ?? 0)) / 2, 0) / lines.length : NaN;
  const rRecto = meanCentre(recto.rashiLines);
  const rVerso = meanCentre(verso.rashiLines);
  const contentW = geo.pageWidth - geo.marginInside - geo.marginOutside;
  check(
    'knee mirror: Rashi moves from right flank (recto) to left flank (verso)',
    Number.isFinite(rRecto) && Number.isFinite(rVerso) && rRecto > contentW / 2 && rVerso < contentW / 2,
    `recto mean ${Math.round(rRecto)} vs verso mean ${Math.round(rVerso)} (contentW ${contentW})`
  );
  check(
    'knee mirror: roles + unit ids preserved after swap',
    verso.rashiLines.every(l => l.role === 'primary_comment' && l.unitId === 'u-rashi') &&
      verso.tosafotLines.every(l => l.role === 'secondary_comment' && l.unitId === 'u-tos')
  );
  check(
    'knee mirror: same word counts consumed on both facings',
    verso.consumedRashiWords === recto.consumedRashiWords && verso.consumedTosafotWords === recto.consumedTosafotWords
  );
  // v0.8.0 Part C (§4): ONE rule — the solver's recto Rashi side must
  // agree with flankPhysicalSides(2a). (The v0.7.0 smoke asserted both
  // sides at once because the helpers and the solver disagreed; the
  // helpers were the inverted side.)
  check(
    'flank consistency: knee recto Rashi side == flankPhysicalSides(2a).rashi',
    rRecto > contentW / 2 && flankPhysicalSides(2, 'talmud').rashi === 'right'
  );
} catch (e) {
  failed += 3;
  console.log(`  FAIL knee mirror checks (threw) — ${(e as Error).message}`);
}

console.log(`\nv0.7.0 smoke: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
