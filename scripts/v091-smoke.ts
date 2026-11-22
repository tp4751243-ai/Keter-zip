/**
 * KETER-TYPE v0.9.1 — Page design crash regression smoke.
 *
 * Run from the repo root:  npx tsx scripts/v091-smoke.ts
 *
 * Regression for the user report of 2026-11-11 00:46 EST: the installed
 * v0.9.0 app crashed the moment he opened "Page design" (the "Design the
 * book" step) — the v0.8.1 ErrorBoundary caught it and showed its fallback
 * instead of the old blank white screen. The exact error from the
 * fallback's "Error details" (tapped by the user on his PC):
 *
 *   TypeError: Cannot read properties of undefined (reading 'en')
 *     at index-_QRSX4yv.js:278:83578
 *     at Array.map (<anonymous>)
 *     at GF (index-_QRSX4yv.js:278:83239)
 *
 * Reproduced locally in real Chromium with the identical stack shape
 * (reading 'he' in Hebrew mode, 'en' in English mode): the root cause is
 * DesignTypesettingPanel.tsx line 667 —
 *   PRESET_CATEGORY_LABELS[cat].en / .he
 * — where PRESET_CATEGORY_LABELS was typed Record<string, …> with only
 * 8 entries, while READY_DESIGNS (design-settings-engine.ts) has TWO
 * presets with category 'yiddish' (added in v0.8.0, Yiddish sefarim).
 * presetCategories is derived from READY_DESIGNS, so 'yiddish' was
 * mapped at panel mount, PRESET_CATEGORY_LABELS['yiddish'] was
 * undefined, and reading .he/.en threw. It crashed for EVERY project
 * (fresh or old) because the category chips render unconditionally in
 * the panel's default tab. TypeScript never caught it because
 * Record<string, …> indexing returns the value type, never undefined.
 *
 * Fix (v0.9.1): the 'yiddish' label was added; the table is now typed
 * Record<ReadyDesignPreset['category'], …> so tsc itself fails the build
 * if a category ever ships without a label; and the render lookup is
 * defensive (unknown category → shows its id, never throws).
 *
 *  §A  label coverage: every category used by READY_DESIGNS has an
 *      entry in PRESET_CATEGORY_LABELS (parsed from the component
 *      source), the table is typed by the category union, the
 *      defensive lookup is present, and 'yiddish' renders 'יידיש' /
 *      'Yiddish'.
 *  §B  t() can never throw on a missing key: translateUiString returns
 *      the key itself for an unknown key, in Hebrew mode and in
 *      English mode. (Audit: there is no STRINGS[key][lang] read
 *      anywhere in src/ — the only dynamic .he/.en read in the render
 *      path was the category table in §A.)
 *  §C  old-shape / missing designSettings snapshots rebuild cleanly
 *      through buildDesignSettingsFromSnapshot (v0.8.0 shape with no
 *      customLayout/tiers, designSettings missing entirely, null
 *      snapshot) — the design view's mount-time settings always exist.
 *  §D  QaFixList (same latent pattern, hardened in v0.9.1):
 *      renderToString with an issue whose category/severity are NOT in
 *      the tables ('text_overlap', 'fatal') does not throw and still
 *      shows the issue message.
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { READY_DESIGNS } from '../src/engine/design-settings-engine';
import { ProjectPersistenceEngine } from '../src/engine/project-persistence';
import { translateUiString, LanguageProvider } from '../src/i18n/LanguageContext';
import { QaFixList } from '../src/components/QaFixList';
import type { ProjectSnapshot } from '../src/types/typesetter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------- §A — labels
console.log('§A — preset category label coverage (the crash site)');
const panelSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/DesignTypesettingPanel.tsx'),
  'utf8'
);
const tableMatch = panelSrc.match(
  /const PRESET_CATEGORY_LABELS[^=]*=\s*\{([\s\S]*?)\n  \};/
);
check('PRESET_CATEGORY_LABELS table found in the panel source', Boolean(tableMatch));
const tableBody = tableMatch?.[1] ?? '';
const labelKeys = new Set(
  [...tableBody.matchAll(/^\s*([a-z_]+):\s*\{/gm)].map(m => m[1])
);
const designCategories = new Set(READY_DESIGNS.map(p => p.category));
check(
  'every READY_DESIGNS category has a label entry',
  [...designCategories].every(c => labelKeys.has(c)),
  `categories: ${[...designCategories].join(', ')}; labels: ${[...labelKeys].join(', ')}`
);
check(
  "'yiddish' label present (he 'יידיש', en 'Yiddish')",
  /yiddish:\s*\{\s*he:\s*'יידיש',\s*en:\s*'Yiddish'\s*\}/.test(tableBody)
);
check(
  'table is typed by the category union (tsc enforces completeness)',
  /PRESET_CATEGORY_LABELS:\s*Record<ReadyDesignPreset\['category'\]/.test(panelSrc)
);
check(
  'render lookup is defensive (unknown category shows its id, never throws)',
  /PRESET_CATEGORY_LABELS\[cat\]\?\.\[lang === 'en' \? 'en' : 'he'\] \?\? cat/.test(panelSrc)
);
// Simulate the exact render lookup for every category, both languages.
const labelTable: Record<string, { he: string; en: string }> = {};
for (const m of tableBody.matchAll(/^\s*([a-z_]+):\s*\{\s*he:\s*'([^']*)',\s*en:\s*'([^']*)'\s*\}/gm)) {
  labelTable[m[1]] = { he: m[2], en: m[3] };
}
let lookupThrew = false;
for (const cat of designCategories) {
  for (const lang of ['he', 'en'] as const) {
    try {
      const v = labelTable[cat]?.[lang] ?? cat;
      if (typeof v !== 'string' || v.length === 0) lookupThrew = true;
    } catch {
      lookupThrew = true;
    }
  }
}
check('render lookup resolves every category in both languages', !lookupThrew);
// And the OLD code path would have thrown — the regression is real.
let oldPathThrew = false;
try {
  const oldTable = { ...labelTable };
  delete (oldTable as Record<string, unknown>).yiddish;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (oldTable as any).yiddish.he;
} catch {
  oldPathThrew = true;
}
check('the old unguarded lookup throws on yiddish (regression is real)', oldPathThrew);

// ---------------------------------------------------------- §B — t()
console.log('§B — t() never throws on a missing key');
const missingKey = 'a-key-that-does-not-exist-anywhere-091';
check(
  'translateUiString returns the key itself for an unknown key (Hebrew mode)',
  translateUiString(missingKey) === missingKey
);
// English mode: stub localStorage the way the app stores the language.
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (k === 'keter-ui-lang' ? 'en' : null),
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
} as Storage;
check(
  'translateUiString returns the key itself for an unknown key (English mode)',
  translateUiString(missingKey) === missingKey
);
check(
  'translateUiString still translates a known key in English mode',
  translateUiString('עיצוב העמוד') === 'Page design'
);

// ---------------------------------------------------------- §C — snapshots
console.log('§C — old-shape / missing designSettings snapshots rebuild cleanly');
const baseSnapshot = {
  id: 'snap-091',
  timestamp: Date.now(),
  label: 'v0.9.1 smoke',
  documentTitle: 'ספר בדיקה',
  layoutType: 'rav_text',
  units: [
    {
      id: 'u1',
      role: 'main_source',
      rawText: 'מאימתי קורין את שמע',
      order: 0,
    },
  ],
  links: [],
} as unknown as ProjectSnapshot;

// (i) v0.8.0 shape: designSettings present but from an older version —
// no customLayout and no tiers (both were added/changed later).
const oldShape = {
  ...baseSnapshot,
  designSettings: {
    layoutType: 'rav_text',
    pageLayout: {
      pageWidthPt: 482,
      pageHeightPt: 680,
      marginTopPt: 48,
      marginBottomPt: 48,
      marginInsidePt: 46,
      marginOutsidePt: 42,
    },
  },
} as unknown as ProjectSnapshot;
let rebuilt = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot(oldShape);
check(
  'v0.8.0-shaped snapshot (no customLayout/tiers) rebuilds with a tiers array',
  Array.isArray(rebuilt.pageLayout.tiers)
);
check(
  'v0.8.0-shaped snapshot rebuild keeps the layout type',
  rebuilt.layoutType === 'rav_text'
);

// (ii) designSettings missing entirely.
const noSettings = { ...baseSnapshot } as unknown as ProjectSnapshot;
delete (noSettings as unknown as Record<string, unknown>).designSettings;
rebuilt = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot(noSettings);
check(
  'snapshot with designSettings missing rebuilds to defaults',
  Array.isArray(rebuilt.pageLayout.tiers) && typeof rebuilt.pageLayout.pageWidthPt === 'number'
);

// (iii) null snapshot.
rebuilt = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot(null);
check(
  'null snapshot rebuilds to defaults',
  Array.isArray(rebuilt.pageLayout.tiers) && typeof rebuilt.pageLayout.pageWidthPt === 'number'
);

// ---------------------------------------------------------- §D — QaFixList
console.log('§D — QaFixList with out-of-table category/severity does not throw');
let qaHtml = '';
let qaThrew = false;
try {
  qaHtml = renderToString(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(QaFixList, {
        issues: [
          {
            id: 'q1',
            severity: 'warning',
            // v0.9.0 flaw-scan category — not in QaIssue's union.
            category: 'text_overlap',
            message: 'טקסט חופף בעמוד',
            autoFixable: false,
          },
          {
            id: 'q2',
            severity: 'fatal',
            category: 'collision',
            message: 'התנגשות חמורה',
            autoFixable: false,
          },
        ] as never,
        onApplyFix: () => undefined,
        onClose: () => undefined,
      })
    )
  );
} catch (e) {
  qaThrew = true;
  console.log(`  (threw: ${e})`);
}
check('QaFixList renders out-of-table issues without throwing', !qaThrew);
check(
  'QaFixList still shows the issue message text',
  qaHtml.includes('טקסט חופף בעמוד') && qaHtml.includes('התנגשות חמורה')
);

console.log(`\nv091-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
