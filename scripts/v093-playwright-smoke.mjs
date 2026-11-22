/**
 * KETER-TYPE v0.9.3 — Playwright live click-through of the new historical
 * recipes (real Chromium). Fills the gap the v0.9.3 handoff named plainly:
 * "the new recipes weren't driven in a real browser yet, only in the engine."
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v093-playwright-smoke.mjs
 *
 * Flow: fresh blank project → Page design → scroll the Design panel to the
 * "תבניות היסטוריות" (Historical layouts) section → click EVERY library
 * entry one by one (27 recipes; the 28th engine entry is the vilna-shas
 * alias, deduped in the picker) and, after each, check there is no page
 *
 * Exit code 0 = every recipe applied live with no page error; 1 = a failure.
 * (Requires the Playwright chromium headless shell.)
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

async function createBlankProject(page) {
  // v0.9.4 — the new-project form is inline on Home now (no modal to
  // open first): pick the blank starter, then create.
  await page.getByRole('button', { name: 'מסמך חדש נקי (מוכן להקלדה / ייבוא וורד)' }).click();
  await page.getByRole('button', { name: 'צור פרויקט חדש ועבור לעריכה' }).click();
  await page.waitForTimeout(1500);
}
async function openPageDesign(page) {
  await page.getByText('עיצוב העמוד').first().click();
  await page.waitForTimeout(1200);
  // The Design panel (which holds the historical-layouts library) is a
  // right drawer. Open it from the floating toolbar's full-inspector
  // button (it appears once a word is selected), then switch to the
  // "עמוד ושוליים" (page_geometry) tab — the library lives in that tab.
  const word = page.locator('span.cursor-text').first();
  const box = await word.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.locator('button[title="פתח את כל אפשרויות העיצוב"]').first().click();
  await page.waitForTimeout(900);
  await page.getByText('עמוד ושוליים').first().click();
  await page.waitForTimeout(900);
}

// The historical-layout buttons live under the "תבניות היסטוריות" heading
// in the Design panel. Re-query them fresh on every step: applying a recipe
// re-renders the panel, so a stale handle would click the wrong entry.
async function libraryButtons(page) {
  return page.evaluate(() => {
    const section = (() => {
      const heads = [...document.querySelectorAll('div')].filter(
        (el) => el.textContent && el.textContent.trim() === 'תבניות היסטוריות — עימוד קלאסי מוכן',
      );
      if (!heads.length) return null;
      return heads[0].closest('div.pt-3') || heads[0].parentElement;
    })();
    if (!section) return { found: false, names: [] };
    const btns = [...section.querySelectorAll('button')].filter((b) => !b.disabled);
    return {
      found: true,
      names: btns.map((b) => (b.querySelector('span')?.textContent ?? b.textContent ?? '').trim().split('\n')[0]),
    };
  });
}
async function clickLibraryEntry(page, index) {
  return page.evaluate((idx) => {
    const heads = [...document.querySelectorAll('div')].filter(
      (el) => el.textContent && el.textContent.trim() === 'תבניות היסטוריות — עימוד קלאסי מוכן',
    );
    if (!heads.length) return false;
    const section = heads[0].closest('div.pt-3') || heads[0].parentElement;
    const btns = [...section.querySelectorAll('button')].filter((b) => !b.disabled);
    if (!btns[idx]) return false;
    btns[idx].scrollIntoView({ block: 'center' });
    btns[idx].click();
    return true;
  }, index);
}
async function pageStillRenders(page) {
  return page.evaluate(() => {
    const words = document.querySelectorAll('span.cursor-text').length;
    const textLen = document.body.innerText.length;
    return { words, textLen, ok: words > 0 && textLen > 100 };
  });
}

const browser = await chromium.launch();
try {
  console.log('Test — apply every historical layout live, one by one');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem('keter-welcome-seen-v040', '1'); });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await createBlankProject(page);
  await openPageDesign(page);

  // Bring the historical-layouts section into view.
  const heading = page.getByText('תבניות היסטוריות — עימוד קלאסי מוכן').first();
  await heading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(800);

  const lib = await libraryButtons(page);
  check('historical layouts section is present in Page design', lib.found);
  check('library lists 27 recipes (the 28th engine entry is the vilna-shas alias, deduped in the picker)', lib.names.length === 27, `got ${lib.names.length}: ${lib.names.slice(0, 5).join(' | ')}${lib.names.length > 5 ? ' …' : ''}`);
  console.log(`  Library entries: ${lib.names.join(' · ')}`);

  const baseline = await pageStillRenders(page);
  check('page renders before applying any recipe', baseline.ok, `words=${baseline.words}`);

  let applied = 0;
  for (let i = 0; i < lib.names.length; i++) {
    const name = lib.names[i];
    const errorsBefore = pageErrors.length;
    const clicked = await clickLibraryEntry(page, i);
    if (!clicked) { check(`apply "${name}" (button clickable)`, false); continue; }
    await page.waitForTimeout(700);
    const state = await pageStillRenders(page);
    const noNewErrors = pageErrors.length === errorsBefore;
    check(`apply "${name}" — no page error, page still renders`, noNewErrors && state.ok,
      noNewErrors ? `words=${state.words}` : `NEW ERROR: ${pageErrors.slice(errorsBefore).join(' | ')}`);
    if (noNewErrors && state.ok) applied++;
  }
  check(`all ${lib.names.length} recipes applied live`, applied === lib.names.length, `${applied}/${lib.names.length}`);
  check('no page errors across the whole run', pageErrors.length === 0, pageErrors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv093-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
