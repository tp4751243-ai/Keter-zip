/**
 * KETER-TYPE v0.9.6 — night-theme spot check for the Shas dialog
 * (real Chromium). Companion to v096-playwright-smoke.mjs, which
 * covers the light/day theme.
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v096-night-check.mjs
 *
 * Sets the saved theme to night before load, creates the same Vilna
 * Shas sample book, opens the Shas dialog and proves from the live
 * computed style that the card is solid dark surface (#1E232B,
 * alpha 1) with a dimmed backdrop. Screenshot:
 * screenshots/v096-dialogs/07-vilna-shas-check-night.png
 *
 * Exit code 0 = every check passed; 1 = a failure.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'screenshots', 'v096-dialogs');

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
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
const base = `http://127.0.0.1:${server.address().port}`;
const pageErrors = [];
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('keter-ui-theme', 'night');
    localStorage.setItem('keter-welcome-seen-v040', '1');
  });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('app opens in the night theme',
    (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'night');
  // v0.9.7: Vilna Shas is the rav_text core card now, not a historical-shelf recipe.
  await page.locator('[data-testid="new-project-form-home-layout-rav_text"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="new-project-form-home-starter-sample"]').click();
  await page.locator('[data-testid="new-project-form-home-submit"]').click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'בדיקת ש״ס' }).click();
  await page.waitForTimeout(600);
  const card = page.locator('[data-testid="shas-qa-panel"] > div').first();
  check('Shas dialog is visible in night mode', await card.isVisible());
  const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  check('Shas card is solid dark surface #1E232B (alpha 1)', bg === 'rgb(30, 35, 43)', bg);
  const bd = await page.locator('[data-testid="shas-qa-panel"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  check('Shas backdrop is dimmed in night mode', bd.includes('0.5'), bd);
  await page.screenshot({ path: path.join(SHOTS, '07-vilna-shas-check-night.png') });
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`\nv096-night-check: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
