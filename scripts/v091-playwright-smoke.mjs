/**
 * KETER-TYPE v0.9.1 — Playwright client-render smoke (real Chromium).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v091-playwright-smoke.mjs
 *
 * Regression for the user report of 2026-11-11 00:46 EST: opening
 * "Page design" ("עיצוב העמוד") in the installed v0.9.0 app crashed the
 * view — the v0.8.1 ErrorBoundary caught it ("משהו השתבש" fallback).
 * Root cause: PRESET_CATEGORY_LABELS had no 'yiddish' entry while
 * READY_DESIGNS has two 'yiddish' presets, so the category-chip map in
 * DesignTypesettingPanel threw `Cannot read properties of undefined
 * (reading 'he' / 'en')` at panel mount, for every project.
 *
 *  Test A — fresh blank project → Page design (Hebrew): the panel
 *  renders, the 'יידיש' chip is visible, no fallback, no page errors,
 *  nothing logged to keter-last-error.
 *  Test B — same path in English mode (the user's error read 'en'):
 *  the panel renders, the 'Yiddish' chip is visible, no fallback.
 *  Test C — old-shape project: an autosave with designSettings removed
 *  entirely (C1), and one with designSettings present but the
 *  pageLayout/ravText/footnotes/projectRoleStyles/localOverrides
 *  sub-objects removed (C2, the partial-shape crash found by
 *  v091-smoke §C) — recover each from Home and open Page design: no
 *  fallback, no page errors.
 *  Test D — in the page-geometry tab, apply each of the 9 historical
 *  library recipes in turn: no fallback, no page errors after any of
 *  them.
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
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let filePath = path.join(DIST, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html');
  }
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const FALLBACK_TEXTS = ['משהו השתבש', 'Something went wrong'];

async function fallbackShown(page) {
  const text = await page.evaluate(() => document.body.innerText);
  return FALLBACK_TEXTS.some(t => text.includes(t));
}

async function openPageDesign(page) {
  await page.getByText('עיצוב העמוד').first().click();
  await page.waitForTimeout(1200);
}
async function openPageDesignEn(page) {
  await page.getByText('Page design').first().click();
  await page.waitForTimeout(1200);
}

async function createBlankProject(page, he = true) {
  // v0.9.4 — the new-project form is inline on Home now (no modal to
  // open first): pick the blank starter in the inline form, then
  // create. (Role-based clicks: the form's option buttons contain
  // inner divs that intercept text-based clicks.)
  await page.getByRole('button', { name: he ? 'מסמך חדש נקי (מוכן להקלדה / ייבוא וורד)' : 'A clean new document (ready for typing / Word import)' }).click();
  await page.getByRole('button', { name: he ? 'צור פרויקט חדש ועבור לעריכה' : 'Create a new project and go to editing' }).click();
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch();
try {
  // ---------------------------------------------------------- Test A
  console.log('Test A — fresh project → Page design (Hebrew)');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => {
      localStorage.setItem('keter-welcome-seen-v040', '1');
    });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await createBlankProject(page);
    await openPageDesign(page);
    check('Page design opens without the ErrorBoundary fallback', !(await fallbackShown(page)));
    check("the 'יידיש' category chip renders", await page.getByText('יידיש', { exact: true }).first().isVisible().catch(() => false));
    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    const lastError = await page.evaluate(() => localStorage.getItem('keter-last-error'));
    check('nothing logged to keter-last-error', !lastError || lastError === '[]', String(lastError ?? '').slice(0, 200));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test B
  console.log('Test B — fresh project → Page design (English)');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => {
      localStorage.setItem('keter-welcome-seen-v040', '1');
      localStorage.setItem('keter-ui-lang', 'en');
    });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await createBlankProject(page, false);
    await openPageDesignEn(page);
    check('Page design opens without the fallback (English)', !(await fallbackShown(page)));
    check("the 'Yiddish' category chip renders", await page.getByText('Yiddish', { exact: true }).first().isVisible().catch(() => false));
    check('no page errors (English)', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test C
  console.log('Test C — old-shape autosave recovery → Page design');
  for (const variant of ['missing', 'partial']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => {
      localStorage.setItem('keter-welcome-seen-v040', '1');
    });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await createBlankProject(page);
    // The fresh project autosaved on load — strip it to the old shape.
    await page.evaluate((v) => {
      const strip = (raw) => {
        if (!raw) return raw;
        const snap = JSON.parse(raw);
        if (v === 'missing') {
          delete snap.designSettings;
          delete snap.kneeSettings;
        } else {
          // Partial designSettings: present, but the sub-objects an
          // older save never wrote are gone.
          if (snap.designSettings) {
            delete snap.designSettings.pageLayout;
            delete snap.designSettings.ravText;
            delete snap.designSettings.footnotes;
            delete snap.designSettings.projectRoleStyles;
            delete snap.designSettings.localOverrides;
          }
        }
        return JSON.stringify(snap);
      };
      const primary = localStorage.getItem('keter_autosave_state_v2');
      const backup = localStorage.getItem('keter_autosave_last_known_good_v2');
      if (primary) localStorage.setItem('keter_autosave_state_v2', strip(primary));
      if (backup) localStorage.setItem('keter_autosave_last_known_good_v2', strip(backup));
    }, variant);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.getByText('שחזר כעת ועבור לעריכה').first().click();
    await page.waitForTimeout(1500);
    await openPageDesign(page);
    check(`Page design opens after recovering a ${variant}-settings autosave`, !(await fallbackShown(page)));
    check(`no page errors (${variant} autosave)`, pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test D
  console.log('Test D — apply each of the 9 historical recipes');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => {
      localStorage.setItem('keter-welcome-seen-v040', '1');
    });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await createBlankProject(page);
    await openPageDesign(page);
    check('Page design opens before the recipe pass', !(await fallbackShown(page)));
    // The historical recipes live in the page-geometry tab.
    await page.getByText('עמוד ושוליים').first().click();
    await page.waitForTimeout(800);
    const heading = page.getByText('תבניות היסטוריות — עימוד קלאסי מוכן').first();
    const recipeButtons = heading.locator('..').locator('button');
    const count = await recipeButtons.count();
    check('9 historical recipes are listed', count === 9, `found ${count}`);
    for (let i = 0; i < count; i++) {
      const name = (await recipeButtons.nth(i).innerText()).split('\n')[0];
      await recipeButtons.nth(i).click();
      await page.waitForTimeout(900);
      const ok = !(await fallbackShown(page));
      check(`applying recipe ${i + 1}/9 (${name}) — no fallback`, ok);
      if (!ok) break;
    }
    check('no page errors during the recipe pass', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv091-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
