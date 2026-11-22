/**
 * KETER-TYPE v0.8.1 — Playwright client-render smoke (real Chromium).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v081-playwright-smoke.mjs
 *
 * Serves the built dist/ over HTTP and drives it in a real browser:
 *
 *  Test A — the exact user-reported path: Home → "create a new project"
 *  (blank, the default) → the page-layout (edit) view. Asserts the view
 *  renders the new empty-state banner ("הספר ריק"), the window is NOT
 *  blank white, NO ErrorBoundary fallback appears (the root cause is
 *  fixed, so nothing throws), and no uncaught page errors occur.
 *
 *  Test B — the ErrorBoundary fallback in a real client render: a tiny
 *  page that bundles the ACTUAL src/components/ErrorBoundary.tsx (via
 *  esbuild, in memory) around a deliberately throwing child. Asserts the
 *  friendly fallback renders (title, Reload / Back to Home / New project
 *  buttons, error details) and the error was logged to localStorage
 *  (keter-last-error).
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 * (Requires the Playwright chromium headless shell:
 *  `npx playwright install chromium-headless-shell`.)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// --- Bundle the real ErrorBoundary + a throwing child for Test B --------
const boundaryEntry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from './src/i18n/LanguageContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
const Thrower = () => { throw new Error('deliberate render boom'); };
createRoot(document.getElementById('root')).render(
  React.createElement(LanguageProvider, null,
    React.createElement(ErrorBoundary, {
      label: 'playwright-test',
      onReset: () => { document.title = 'reset-clicked'; },
      onNewProject: () => { document.title = 'new-project-clicked'; },
    }, React.createElement(Thrower)))
);
`;
const boundaryBundle = await esbuild.build({
  stdin: {
    contents: boundaryEntry,
    resolveDir: ROOT,
    loader: 'tsx',
  },
  bundle: true,
  format: 'iife',
  write: false,
  logLevel: 'silent',
});
const boundaryJs = boundaryBundle.outputFiles[0].text;
const boundaryHtml = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>boundary test</title></head><body><div id="root"></div><script src="/boundary-test/app.js"></script></body></html>`;

// --- Static server: dist/ + the boundary test page ----------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/boundary-test/' || url.pathname === '/boundary-test') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(boundaryHtml);
    return;
  }
  if (url.pathname === '/boundary-test/app.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(boundaryJs);
    return;
  }
  let filePath = path.join(DIST, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html');
  }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
try {
  // ---------------------------------------------------------- Test A
  console.log('Test A — blank project → page-layout view (the reported path)');
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageErrorsA = [];
  pageA.on('pageerror', (e) => pageErrorsA.push(String(e)));
  // Skip the first-run welcome modal.
  await pageA.addInitScript(() => {
    localStorage.setItem('keter-welcome-seen-v040', '1');
  });
  await pageA.goto(base + '/', { waitUntil: 'networkidle' });
  // The Home button opens the one New Project modal (v0.9.2 Part B —
  // the inline wizard is gone). The modal defaults to a SAMPLE book
  // when opened from Home, so pick the blank starter first: this is
  // the exact state the user reported (new blank project → white screen).
  // NOTE: a "blank" project ships with 3 placeholder units by design
  // (t-121 asserts a blank project has ≥1 unit), so reaching a truly
  // empty book needs deleting them — which is also the real user path
  // to an empty book. Units are deleted via the navigator sidebar
  // (canvas word-clicks do not leave a selection — see MANIFEST §5).
  // v0.9.4 — the new-project form is inline on Home now (no modal to
  // open first): pick the blank starter in the inline form, then
  // create.
  await pageA.getByRole('button', { name: 'מסמך חדש נקי (מוכן להקלדה / ייבוא וורד)' }).click();
  await pageA.getByRole('button', { name: 'צור פרויקט חדש ועבור לעריכה' }).click();
  await pageA.waitForTimeout(1500);
  // Open the navigator sidebar (unit list lives in the 'פסקאות' tab).
  await pageA.getByText('דפים', { exact: true }).first().click();
  await pageA.waitForTimeout(600);
  await pageA.getByText('פסקאות', { exact: true }).first().click();
  await pageA.waitForTimeout(600);
  const vp = pageA.viewportSize();
  for (const snippet of ['מתניתין', 'רַשִׁ״י', 'תּוֹסָפוֹת']) {
    const row = pageA.locator('p', { hasText: snippet }).first();
    if ((await row.count()) === 0) continue;
    await row.click({ timeout: 5000 });
    await pageA.waitForTimeout(300);
    await pageA.mouse.click(vp.width / 2, vp.height / 2, { button: 'right' });
    await pageA.waitForTimeout(400);
    const del = pageA.getByText('מחק יחידה').first();
    if (await del.isEnabled().catch(() => false)) {
      await del.click();
      await pageA.waitForTimeout(500);
    } else {
      await pageA.keyboard.press('Escape');
    }
  }
  await pageA.waitForTimeout(800);
  const bodyTextA = (await pageA.evaluate(() => document.body.innerText ?? '')).trim();
  check('layout view is not a blank white window', bodyTextA.length > 500, `body text length=${bodyTextA.length}`);
  check('empty-book state is shown', bodyTextA.includes('הספר ריק'), 'banner "הספר ריק" present');
  check('no ErrorBoundary fallback appears (nothing threw)', !bodyTextA.includes('משהו השתבש'));
  check('no uncaught page errors', pageErrorsA.length === 0, pageErrorsA.join(' | ').slice(0, 300));
  await ctxA.close();

  // ---------------------------------------------------------- Test B
  console.log('Test B — ErrorBoundary fallback in a real client render');
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const pageErrorsB = [];
  pageB.on('pageerror', (e) => pageErrorsB.push(String(e)));
  await pageB.goto(base + '/boundary-test/', { waitUntil: 'networkidle' });
  await pageB.waitForTimeout(1000);
  const bodyTextB = (await pageB.evaluate(() => document.body.innerText ?? '')).trim();
  check('fallback title renders', bodyTextB.includes('משהו השתבש'));
  check('Reload button renders', bodyTextB.includes('טעינה מחדש'));
  check('Back to Home button renders', bodyTextB.includes('חזרה לדף הבית'));
  check('New project button renders', bodyTextB.includes('פרויקט חדש'));
  check('error details section renders', bodyTextB.includes('פרטי השגיאה'));
  const logged = await pageB.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('keter-last-error') ?? '[]');
    } catch {
      return [];
    }
  });
  check(
    'error logged to localStorage (keter-last-error)',
    Array.isArray(logged) && logged.length >= 1 && logged[0].message === 'deliberate render boom',
    `entries=${Array.isArray(logged) ? logged.length : 'n/a'}`
  );
  // The fallback must not itself crash the page: only the deliberate
  // error may surface (React logs it as a page error via the boundary).
  check(
    'no page errors other than the deliberate one',
    pageErrorsB.every((e) => e.includes('deliberate render boom')),
    pageErrorsB.join(' | ').slice(0, 300)
  );
  await ctxB.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv081-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
