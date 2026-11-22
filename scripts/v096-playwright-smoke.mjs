/**
 * KETER-TYPE v0.9.6 — Playwright live dialog-opacity drive-through
 * (real Chromium).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v096-playwright-smoke.mjs
 *
 * The v0.9.5 bug (user's photos, 2026-11-12): the "Vilna Shas check"
 * dialog was see-through — page text and the toolbar strip bled through
 * its body. Root cause: the dialog card used bg-[var(--ui-panel-bg)]
 * with --ui-panel-bg undefined in the theme, so it computed to
 * transparent (see MANIFEST).
 *
 * Flow (light/day theme, the theme in the user's screenshots):
 *   1. Home: create a book from the Vilna Shas recipe with the SAMPLE
 *      starter, so the page behind the dialogs carries real Gemara /
 *      Rashi text — a bleed-through witness.
 *   2. In the editor, open EACH toolbar dialog in turn and prove it
 *      is fully opaque with a dimmed backdrop, from the LIVE computed
 *      style (not the source): card background-color alpha === 1,
 *      backdrop alpha >= 0.4. Screenshot each one.
 *      Vilna Shas check, Proofreading, Search & replace, Workspaces,
 *      ⌘K Commands palette.
 *   3. New Project modal (from Home, "פרויקט חדש..."): same opacity
 *      proof + screenshot.
 *   4. No page errors anywhere.
 *
 * Screenshots: screenshots/v096-dialogs/<name>.png
 * Exit code 0 = every check passed; 1 = a failure.
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
const SHOTS = path.join(ROOT, 'screenshots', 'v096-dialogs');
fs.mkdirSync(SHOTS, { recursive: true });

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

/** background-color of an element, parsed to { rgb, alpha }. */
async function bgOf(page, locator) {
  const raw = await locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  const m = raw.match(/rgba?\(([^)]+)\)/);
  const parts = m ? m[1].split(',').map((s) => parseFloat(s.trim())) : [];
  return { raw, alpha: parts.length === 4 ? parts[3] : 1 };
}

const pageErrors = [];
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Theme must be the light/day theme from the user's screenshots.
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('app opens in the light (day) theme, as in the user photos', theme === 'day' || theme === null, `data-theme=${theme}`);

  // First run shows the Welcome modal on top of Home — prove IT is
  // opaque too (bonus dialog), then dismiss it to reach Home.
  const welcome = page.locator('div[role="dialog"][aria-label="איך משתמשים בכתר?"]');  if (await welcome.isVisible().catch(() => false)) {
    const wCard = welcome.locator('> div').first();
    const wBg = await wCard.evaluate((el) => getComputedStyle(el).backgroundColor);
    check('Welcome modal: card background fully opaque', !/rgba\([^)]*,\s*0(\.\d+)?\)/.test(wBg) && wBg.startsWith('rgb'), wBg);
    await page.screenshot({ path: path.join(SHOTS, '00-welcome-modal.png') });
    await page.getByRole('button', { name: 'הבנתי, מתחילים' }).click();
    await page.waitForTimeout(600);
    check('Welcome modal closes', !(await welcome.isVisible().catch(() => false)));
  }

  // ── 1. Create a Vilna Shas book with SAMPLE content ──────────────────
  // v0.9.7 — the start screen shows the 11 core cards; Vilna Shas is
  // the rav_text core card now (the old talmud-bavli recipe card left
  // the start screen with the other shelves; the recipe still lives in
  // the Design picker).
  await page.locator('[data-testid="new-project-form-home-layout-rav_text"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="new-project-form-home-starter-sample"]').click();
  await page.locator('[data-testid="new-project-form-home-submit"]').click();
  await page.waitForTimeout(2000);
  const shasBtn = page.getByRole('button', { name: 'בדיקת ש״ס' });
  check('editor opens with the toolbar strip (Vilna Shas check button)', await shasBtn.isVisible());
  await page.screenshot({ path: path.join(SHOTS, '00-editor-baseline.png') });

  /** Open a dialog, prove opacity from live computed style, shoot it, close it. */
  async function proveDialog(name, open, cardLocator, backdropLocator, close) {
    await open();
    await page.waitForTimeout(600);
    check(`${name}: dialog is visible`, await cardLocator.isVisible());
    const cardBg = await bgOf(page, cardLocator);
    check(`${name}: card background is fully opaque (alpha 1)`, cardBg.alpha === 1, cardBg.raw);
    if (backdropLocator) {
      const bdBg = await bgOf(page, backdropLocator);
      check(`${name}: backdrop is dimmed (alpha >= 0.4)`, bdBg.alpha >= 0.4, bdBg.raw);
    }
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    if (close) { await close(); await page.waitForTimeout(500); }
    check(`${name}: dialog closes again`, !(await cardLocator.isVisible().catch(() => false)));
  }

  const bottomPanel = page.locator('div.fixed.bottom-11.left-5').first();

  // ── 2a. Vilna Shas check (the reported dialog) ───────────────────────
  await proveDialog(
    '01-vilna-shas-check',
    () => shasBtn.click(),
    page.locator('[data-testid="shas-qa-panel"] > div').first(),
    page.locator('[data-testid="shas-qa-panel"]'),
    () => page.getByRole('button', { name: 'סגור', exact: true }).last().click(),
  );
  // Re-open briefly to confirm the section text is present while open.
  await shasBtn.click();
  await page.waitForTimeout(500);
  check('Shas dialog body text is present while open',
    (await page.getByText('אימות דיבור המתחיל').isVisible().catch(() => false)) &&
    (await page.getByText('רצף דפים').isVisible().catch(() => false)));
  await page.getByRole('button', { name: 'סגור', exact: true }).last().click();
  await page.waitForTimeout(500);

  // ── 2b. Proofreading (floating panel, no backdrop by design) ─────────
  await proveDialog(
    '02-proofreading',
    () => page.getByRole('button', { name: /^הגהה/ }).click(),
    bottomPanel,
    null,
    () => page.getByRole('button', { name: /^הגהה/ }).click(),
  );

  // ── 2c. Search & replace (floating panel, no backdrop by design) ────
  await proveDialog(
    '03-search-replace',
    () => page.getByRole('button', { name: 'חיפוש והחלפה' }).click(),
    bottomPanel,
    null,
    () => page.getByRole('button', { name: 'חיפוש והחלפה' }).click(),
  );

  // ── 2d. Workspaces menu ──────────────────────────────────────────────
  await proveDialog(
    '04-workspaces-menu',
    () => page.getByRole('button', { name: 'סביבות עבודה' }).click(),
    page.locator('[data-testid="workspace-menu"]'),
    null,
    () => page.mouse.click(8, 8), // the z-40 click-catcher behind the menu
  );

  // ── 2e. ⌘K Commands palette ──────────────────────────────────────────
  const palette = page.locator('[role="dialog"]');
  await proveDialog(
    '05-command-palette',
    () => page.getByRole('button', { name: /פקודות/ }).click(),
    palette,
    palette.locator('xpath=..'),
    () => page.keyboard.press('Escape'),
  );

  // ── 3. New Project modal (from the editor, via the ⌘K palette's
  // "פרויקט חדש…" command — the modal opens over the editor; going
  // back Home first needs the header project menu plus the
  // unsaved-changes guard, so the palette path is the stable one) ───
  await page.getByRole('button', { name: /פקודות/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'פרויקט חדש…' }).click();
  await page.waitForTimeout(600);
  // The book is dirty: the unsaved-changes guard may intercept the
  // open — discarding lets the modal through (v0.9.4 pattern).
  const guard = page.getByText('שינויים שלא נשמרו לקובץ פרויקט').first();
  if (await guard.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'המשך ללא שמירה (Discard)' }).click();
    await page.waitForTimeout(900);
  }
  const modalCard = page.locator('div.fixed.inset-0.z-50 > div').first();
  check('New Project modal opens', await modalCard.isVisible());
  const npBg = await bgOf(page, modalCard);
  check('New Project modal: card background is fully opaque (alpha 1)', npBg.alpha === 1, npBg.raw);
  const npBackdrop = page.locator('div.fixed.inset-0.z-50').first();
  const npBdBg = await bgOf(page, npBackdrop);
  check('New Project modal: backdrop is dimmed (alpha >= 0.4)', npBdBg.alpha >= 0.4, npBdBg.raw);
  await page.screenshot({ path: path.join(SHOTS, '06-new-project-modal.png') });
  await page.getByTestId('new-project-form-modal').getByRole('button', { name: 'ביטול' }).click();
  await page.waitForTimeout(500);
  check('New Project modal closes again', !(await modalCard.isVisible().catch(() => false)));

  check('no page errors across the whole run', pageErrors.length === 0, pageErrors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv096-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
