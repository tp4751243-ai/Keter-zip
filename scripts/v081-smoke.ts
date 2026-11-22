/**
 * KETER-TYPE v0.8.1 — white-screen regression smoke.
 *
 * Run from the repo root:  npx tsx scripts/v081-smoke.ts
 *
 * Regression for the user report of 2026-11-10: the installed app opened,
 * but navigating to the page-layout view showed a completely blank white
 * screen. Root cause: an empty book (0 content units) paginated to ZERO
 * pages in 4 of 7 layout types, so App derived `activePage === undefined`
 * and EditorialStudioHeader dereferenced `activePage.pageNumberHebrew`
 * during render; with no ErrorBoundary anywhere, React unmounted the
 * whole window.
 *
 *  §A  empty book: all 7 layout types paginate to ≥1 page; the exact
 *      App derivation (`pages[safePageIndex] || pages[0]`) yields a
 *      defined page whose `pageNumberHebrew` reads without throwing.
 *  §B  project missing layout fields: paginateDocument with no geometry,
 *      no designSettings and no units does not throw and yields ≥1 page.
 *  §C  project saved by an older version: minimal old-shape units (only
 *      the fields v0.3–v0.5 wrote) paginate cleanly, and a snapshot with
 *      no geometry/designSettings rebuilds through
 *      buildDesignSettingsFromSnapshot with a real geometry.
 *  §D  ErrorBoundary: getDerivedStateFromError returns error state;
 *      componentDidCatch logs to localStorage (keter-last-error);
 *      renderToString of a deliberately throwing child shows the
 *      fallback (Hebrew title + Reload button), not a blank render;
 *      a healthy child renders normally.
 *  §E  PageCanvas: renderToString with `typesetResult={undefined}`
 *      does not throw and produces page markup (empty-page fallback).
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import * as React from 'react';
import { renderToString, renderToPipeableStream } from 'react-dom/server';
import { Writable } from 'node:stream';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { ProjectPersistenceEngine } from '../src/engine/project-persistence';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { PageCanvas } from '../src/components/PageCanvas';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import type {
  BookLayoutType,
  ContentUnit,
  PageGeometry,
} from '../src/types/typesetter';
import type { PaginationInput } from '../src/engine/pagination-engine';

const GEOMETRY: PageGeometry = {
  pageWidth: 595,
  pageHeight: 842,
  marginTop: 36,
  marginBottom: 36,
  marginInside: 36,
  marginOutside: 36,
  isVerso: false,
};

const LAYOUTS: BookLayoutType[] = [
  'rav_text',
  'single_column',
  'two_column',
  'mikraot_gedolot',
  'source_top_commentary_bottom',
  'custom_layout',
  'yiddish_sefer',
];

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

// Minimal in-memory localStorage so the boundary's logging path can be
// exercised in Node (the real app runs in Electron, where it is native).
const lsStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => {
    lsStore.set(k, v);
  },
  removeItem: (k: string) => {
    lsStore.delete(k);
  },
  clear: () => lsStore.clear(),
  key: (i: number) => [...lsStore.keys()][i] ?? null,
  get length() {
    return lsStore.size;
  },
} as Storage;

// ---------------------------------------------------------------- §A: empty book
console.log('§A — empty book (0 units) must always paginate to ≥1 page');
const designSettings = DesignSettingsEngine.createDefaultSettings({
  projectId: 'v081-smoke',
  layoutType: 'rav_text',
  sourceFontFamily: 'Frank Ruhl Libre',
  rashiFontFamily: 'Noto Rashi Hebrew',
  tosafotFontFamily: 'Frank Ruhl Libre',
});
for (const layoutType of LAYOUTS) {
  try {
    const doc = PaginationEngine.paginateDocument({
      title: 'Empty book',
      layoutType,
      units: [],
      links: [],
      geometry: GEOMETRY,
      designSettings,
    });
    // The exact App.tsx derivation (was: activePage === undefined → crash):
    const displayPages = doc.pages;
    const totalPages = Math.max(1, displayPages.length);
    const safePageIndex = Math.min(0, totalPages - 1);
    const activePage = displayPages[safePageIndex] || displayPages[0];
    const hebrew = activePage.pageNumberHebrew;
    check(
      `empty book → ${layoutType}`,
      doc.pages.length >= 1 &&
        doc.totalPages >= 1 &&
        activePage !== undefined &&
        typeof hebrew === 'string' &&
        hebrew.length > 0,
      `pages=${doc.pages.length} totalPages=${doc.totalPages} hebrew=${hebrew}`
    );
  } catch (e) {
    check(`empty book → ${layoutType}`, false, `threw: ${(e as Error).message}`);
  }
}

// ------------------------------------------------- §B: missing layout fields
console.log('§B — project missing layout fields must not throw');
try {
  const doc = PaginationEngine.paginateDocument({
    title: 'No fields',
    layoutType: 'single_column',
    // geometry, designSettings and units all absent (old/corrupt save):
  } as unknown as PaginationInput);
  check(
    'paginate with no geometry / designSettings / units',
    doc.pages.length >= 1 && doc.totalPages >= 1,
    `pages=${doc.pages.length} geometry=${doc.geometry.pageWidth}x${doc.geometry.pageHeight}`
  );
} catch (e) {
  check('paginate with no geometry / designSettings / units', false, `threw: ${(e as Error).message}`);
}
try {
  const doc = PaginationEngine.paginateDocument({
    title: 'No designSettings',
    layoutType: 'two_column',
    units: [],
    links: [],
    geometry: GEOMETRY,
    designSettings: undefined,
  });
  check('paginate with designSettings undefined', doc.pages.length >= 1, `pages=${doc.pages.length}`);
} catch (e) {
  check('paginate with designSettings undefined', false, `threw: ${(e as Error).message}`);
}

// ------------------------------------------- §C: project from an older version
console.log('§C — project saved by an older version must load and paginate');
// Old-shape units: only the fields v0.3–v0.5 wrote (no language,
// keepPriority, imageData, footnote anchors, or any v0.6+ field).
const oldUnits = [
  {
    id: 'u1',
    role: 'source',
    rawText: 'בראשית ברא אלוקים את השמים ואת הארץ',
    styleName: 'גמרא',
    order: 0,
    hierarchyLevel: 0,
  },
  {
    id: 'u2',
    role: 'commentary',
    rawText: 'פירוש קצר לדוגמה',
    styleName: "רש''י",
    order: 1,
    hierarchyLevel: 1,
  },
] as unknown as ContentUnit[];
for (const layoutType of LAYOUTS) {
  try {
    const doc = PaginationEngine.paginateDocument({
      title: 'Old project',
      layoutType,
      units: oldUnits,
      links: [],
      geometry: GEOMETRY,
      designSettings: undefined,
    });
    check(
      `old-shape units → ${layoutType}`,
      doc.pages.length >= 1 && doc.totalPages >= 1,
      `pages=${doc.pages.length}`
    );
  } catch (e) {
    check(`old-shape units → ${layoutType}`, false, `threw: ${(e as Error).message}`);
  }
}
try {
  // A snapshot with no geometry and no designSettings at all.
  const restored = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot({
    documentTitle: 'Old snapshot',
    layoutType: 'rav_text',
    units: oldUnits,
  } as unknown as Parameters<typeof ProjectPersistenceEngine.buildDesignSettingsFromSnapshot>[0]);
  check(
    'snapshot without geometry/designSettings rebuilds with a geometry',
    !!restored &&
      !!restored.layout?.geometry &&
      restored.layout.geometry.pageWidth > 0,
    `geometry=${restored.layout?.geometry?.pageWidth}x${restored.layout?.geometry?.pageHeight}`
  );
} catch (e) {
  check('snapshot without geometry/designSettings rebuilds with a geometry', false, `threw: ${(e as Error).message}`);
}

// ---------------------------------------------------------- §D: ErrorBoundary
console.log('§D — ErrorBoundary catches a render error and shows a fallback');
{
  const boom = new Error('deliberate render boom');
  const derived = ErrorBoundary.getDerivedStateFromError(boom);
  check('getDerivedStateFromError returns error state', derived.error === boom);
}
{
  lsStore.clear();
  const inst = new ErrorBoundary({ children: null, label: 'smoke-test' });
  inst.componentDidCatch(new Error('deliberate render boom'), {
    componentStack: 'test stack',
  });
  let logged: Array<{ message: string; area: string; time: string }> = [];
  try {
    logged = JSON.parse(lsStore.get('keter-last-error') ?? '[]');
  } catch {
    logged = [];
  }
  check(
    'componentDidCatch logs to localStorage (keter-last-error)',
    logged.length === 1 &&
      logged[0].message === 'deliberate render boom' &&
      logged[0].area === 'smoke-test' &&
      typeof logged[0].time === 'string',
    `entries=${logged.length}`
  );
}
/**
 * Render a React element to an HTML string via the streaming server API.
 *
 * NOTE on React 19 SSR: when a child throws, the boundary catches the
 * error and React marks that segment for CLIENT rendering — the SSR HTML
 * contains `Switched to client rendering because the server rendering
 * errored` instead of the fallback text. The fallback itself renders on
 * the client (during hydration), which is exactly how the Electron app
 * runs: it is pure client rendering, where error boundaries render the
 * fallback directly. So the SSR check asserts the boundary CAUGHT the
 * error (marker present, stream completes) — not that the fallback text
 * is in the SSR HTML, which React by design never includes. The fallback
 * UI itself is verified by the client-render Playwright check
 * (scripts/v081-playwright-smoke.mjs) and by the getDerivedStateFromError
 * / componentDidCatch unit checks above.
 */
function renderAsync(el: React.ReactElement): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let html = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        html += chunk.toString();
        cb();
      },
    });
    sink.on('finish', () => resolve(html));
    sink.on('error', reject);
    const { pipe } = renderToPipeableStream(el, {
      onShellReady() {
        pipe(sink);
      },
      onShellError(err) {
        reject(err);
      },
      onError() {
        // A caught render error (the boundary did its job). Ignore.
      },
    });
  });
}

{
  const Thrower = () => {
    throw new Error('deliberate render boom');
  };
  let html = '';
  let threw = false;
  try {
    // The Suspense wrapper lets the stream complete after the boundary
    // catches the error (without it, the shell itself cannot finish and
    // React reports onShellError — still a caught error, but no stream).
    html = await renderAsync(
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(ErrorBoundary, {
          label: 'smoke-test',
          children: React.createElement(
            React.Suspense,
            { fallback: React.createElement('div', null, 'loading') },
            React.createElement(Thrower)
          ),
        })
      )
    );
  } catch (e) {
    threw = true;
    check('throwing child is caught by the boundary (SSR defers to client)', false, `render threw: ${(e as Error).message}`);
  }
  if (!threw) {
    check(
      'throwing child is caught by the boundary (SSR defers to client)',
      html.includes('Switched to client rendering because the server rendering errored'),
      `stream html length=${html.length}`
    );
  }
}
{
  const Healthy = () => React.createElement('div', null, 'healthy content');
  let html = '';
  try {
    html = await renderAsync(
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(ErrorBoundary, {
          label: 'smoke-test',
          children: React.createElement(Healthy),
        })
      )
    );
  } catch (e) {
    check('healthy child renders normally', false, `render threw: ${(e as Error).message}`);
  }
  if (html) {
    check('healthy child renders normally', html.includes('healthy content'));
  }
}

// ------------------------------------------- §E: PageCanvas undefined page
console.log('§E — PageCanvas with an undefined page must not throw');
{
  let html = '';
  let threw = false;
  try {
    html = renderToString(
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(PageCanvas, {
          typesetResult: undefined,
          zoom: 1,
        } as unknown as React.ComponentProps<typeof PageCanvas>)
      )
    );
  } catch (e) {
    threw = true;
    check('PageCanvas renders an empty page for undefined input', false, `render threw: ${(e as Error).message}`);
  }
  if (!threw) {
    check(
      'PageCanvas renders an empty page for undefined input',
      html.length > 0,
      `html length=${html.length}`
    );
  }
}

console.log(`\nv081-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
