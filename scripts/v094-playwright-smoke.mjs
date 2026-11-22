/**
 * KETER-TYPE v0.9.4 — Playwright live check of the restored Home
 * "start a book" section (real Chromium).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v094-playwright-smoke.mjs
 *
 * Flow:
 *   1. Home shows the inline section: title field, 7 base-layout
 *      cards, 27 historical-recipe cards in 10 group shelves,
 *      sample/blank, create button.
 *   2. Home path: pick the Mishnah Berurah recipe + blank, create —
 *      the book opens on that recipe (autosaved snapshot: title,
 *      layoutType 'custom_layout', recipe geometry).
 *   3. Back to Home, open the New Project modal from the header:
 *      it lists the SAME 27 recipes + 7 base layouts.
 *   4. Modal path: same title, same recipe, blank, create — the
 *      resulting snapshot is IDENTICAL to the Home-path one (one
 *      handler, one form).
 *   5. No page errors anywhere.
 *
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

const TITLE = 'בדיקת תבנית — משנה ברורה';
const RECIPE_ID = 'mishnah-berurah';

/** Read the autosaved snapshot (polls: autosave runs on snapshot change). */
async function readAutosavedSnapshot(page, wantTitle, timeoutMs = 12000, previousRaw = null) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await page.evaluate((prevRaw) => {
      const raw = localStorage.getItem('keter_autosave_state_v2');
      if (!raw || raw === prevRaw) return null;
      try { return { raw, snap: JSON.parse(raw) }; } catch { return null; }
    }, previousRaw);
    if (found && found.snap.documentTitle === wantTitle) return { snap: found.snap, raw: found.raw };
    await page.waitForTimeout(400);
  }
  return null;
}

/** Comparable signature of a created snapshot (recipe application). */
function signature(snap) {
  if (!snap) return null;
  return JSON.stringify({
    title: snap.documentTitle,
    layoutType: snap.layoutType,
    units: Array.isArray(snap.units) ? snap.units.length : null,
    geometry: snap.designSettings?.pageLayout?.geometry ?? null,
    customLayout: snap.designSettings?.pageLayout?.customLayout
      ? { boxes: (snap.designSettings.pageLayout.customLayout.boxes ?? []).length }
      : null,
  });
}

async function openProjectMenu(page) {
  // The header project menu trigger shows the open document title.
  await page.getByRole('button', { name: TITLE }).first().click();
  await page.waitForTimeout(500);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem('keter-welcome-seen-v040', '1'); });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ── 1. Home inline section renders ──────────────────────────────
  const homeForm = page.locator('[data-testid="new-project-form-home"]');
  check('Home inline new-project section is visible', await homeForm.isVisible());
  check('Home section has the book title field',
    await page.locator('[data-testid="new-project-form-home-title"]').isVisible());
  const homeLayouts = await page.locator('[data-testid^="new-project-form-home-layout-"]').count();
  check('Home picker lists all 7 base layouts', homeLayouts === 7, `got ${homeLayouts}`);
  // Recipe buttons are `…-recipe-<id>`; group headings are `…-recipe-group-<key>`.
  const homeRecipeCards = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="new-project-form-home-recipe-"]')]
      .filter(el => !el.dataset.testid.includes('-group-')).length);
  check('Home picker lists all 27 historical recipes', homeRecipeCards === 27, `got ${homeRecipeCards}`);
  const homeGroups = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="new-project-form-home-recipe-group-"]')].length);
  check('Home picker groups the recipes into shelves', homeGroups === 10, `got ${homeGroups} shelves`);
  check('Home section has the sample/blank choice',
    await page.locator('[data-testid="new-project-form-home-starter-sample"]').isVisible() &&
    await page.locator('[data-testid="new-project-form-home-starter-blank"]').isVisible());
  check('Home section has the create button',
    await page.locator('[data-testid="new-project-form-home-submit"]').isVisible());

  // ── 2. Home path: pick a recipe, create ────────────────────────
  await page.locator('[data-testid="new-project-form-home-title"]').fill(TITLE);
  await page.locator(`[data-testid="new-project-form-home-recipe-${RECIPE_ID}"]`).click();
  await page.waitForTimeout(300);
  check('picking the recipe shows the applied-on-create note',
    await page.getByText('התבנית ההיסטורית תוחל על הספר החדש עם יצירתו').first().isVisible());
  await page.locator('[data-testid="new-project-form-home-starter-blank"]').click();
  await page.locator('[data-testid="new-project-form-home-submit"]').click();
  await page.waitForTimeout(1500);
  const homeRead = await readAutosavedSnapshot(page, TITLE);
  const homeSnap = homeRead?.snap ?? null;
  check('Home path created the book (autosaved snapshot found)', Boolean(homeSnap));
  check('Home path applied the recipe (layoutType is custom_layout)',
    homeSnap?.layoutType === 'custom_layout', `layoutType=${homeSnap?.layoutType}`);
  // Blank mode is NOT empty: createBlankProjectSnapshot seeds the clean
  // opening paragraph (2 units). Sample mode would load a full sample
  // text instead — so 2 units proves the blank starter was honoured.
  check('Home path created a blank book (clean opening paragraph, 2 units)', homeSnap && Array.isArray(homeSnap.units) && homeSnap.units.length === 2,
    `units=${homeSnap?.units?.length}`);
  const homeSig = signature(homeSnap);
  console.log(`  Home-path signature: ${homeSig}`);

  // ── 3. Back Home, open the modal ───────────────────────────────
  await openProjectMenu(page);
  await page.getByRole('button', { name: 'חזרה למסך פתיחת הספר' }).click();
  await page.waitForTimeout(1000);
  check('returned to Home (inline section visible again)', await homeForm.isVisible());
  await openProjectMenu(page);
  await page.getByRole('button', { name: 'פרויקט חדש...' }).click();
  await page.waitForTimeout(900);
  // If the unsaved-changes guard appears, discard and continue.
  if (await page.getByText('שינויים שלא נשמרו לקובץ פרויקט').first().isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'המשך ללא שמירה (Discard)' }).click();
    await page.waitForTimeout(900);
  }
  const modalForm = page.locator('[data-testid="new-project-form-modal"]');
  check('New Project modal opened', await modalForm.isVisible());
  const modalRecipeCards = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="new-project-form-modal-recipe-"]')]
      .filter(el => !el.dataset.testid.includes('-group-')).length);
  check('modal picker lists the same 27 recipes as Home', modalRecipeCards === 27, `got ${modalRecipeCards}`);
  const modalLayouts = await page.locator('[data-testid^="new-project-form-modal-layout-"]').count();
  check('modal picker lists the same 7 base layouts as Home', modalLayouts === 7, `got ${modalLayouts}`);
  const modalGroups = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="new-project-form-modal-recipe-group-"]')].length);
  check('modal picker groups the recipes the same way', modalGroups === homeGroups, `got ${modalGroups}`);

  // ── 4. Modal path: same title, same recipe, blank, create ──────
  // Record the current autosave first: the modal path must produce a
  // NEW snapshot — comparing a stale Home-path snapshot to itself
  // would prove nothing.
  const homeRaw = homeRead?.raw ?? null;
  await page.locator('[data-testid="new-project-form-modal-title"]').fill(TITLE);
  await page.locator(`[data-testid="new-project-form-modal-recipe-${RECIPE_ID}"]`).click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="new-project-form-modal-starter-blank"]').click();
  await page.locator('[data-testid="new-project-form-modal-submit"]').click();
  await page.waitForTimeout(1500);
  const modalRead = await readAutosavedSnapshot(page, TITLE, 12000, homeRaw);
  const modalSnap = modalRead?.snap ?? null;
  check('modal path created the book (a NEW autosaved snapshot appeared)', Boolean(modalSnap));
  const modalSig = signature(modalSnap);
  console.log(`  Modal-path signature: ${modalSig}`);
  check('modal path gives the IDENTICAL result as the Home path (one handler)',
    homeSig !== null && homeSig === modalSig);

  check('no page errors across the whole run', pageErrors.length === 0, pageErrors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv094-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
