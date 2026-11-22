/**
 * KETER-TYPE v0.9.5 — Playwright live drive-through of the UNIFIED picker
 * (real Chromium).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v095-playwright-smoke.mjs
 *
 * Flow:
 *   1. Home shows the inline section: title field, 7 base-layout
 *      cards, 27 historical-recipe cards in 10 group shelves,
 *      sample/blank, create button.
 *   2. Language: the picker renders the recipe names from the unified
 *      metadata, not the i18n table — switch to English and the
 *      Mishnah Berurah card shows "Mishnah Berurah" (nameEn); switch
 *      back to Hebrew and it shows "משנה ברורה" (nameHe).
 *   3. Every recipe, one by one, from the Home section: pick it,
 *      blank, create — the book opens on that recipe, no fallback:
 *      the autosaved snapshot has layoutType 'custom_layout' AND the
 *      custom-layout box count equals the recipe's region count
 *      (expected counts generated from the library by
 *      `npx tsx` over src/engine/historical-layouts.ts).
 *   4. No page errors anywhere.
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

// Region counts per recipe, in library order (generated from the
// unified library: npx tsx -e over src/engine/historical-layouts.ts).
// If a recipe's geometry changes, this map must be regenerated —
// that is the point: the drive-through pins the applied geometry.
const RECIPE_IDS = [
  'talmud-bavli', 'mikraot-gedolot', 'shulchan-aruch', 'chumash-rishonim',
  'responsa', 'chassidic-drush', 'yiddish-sefer', 'machon-edition', 'siddur',
  'shas-oz-vehadar', 'shas-artscroll', 'shas-steinzaltz', 'yerushalmi',
  'mishnah-classic', 'mishnah-kehati', 'mishneh-torah', 'mishnah-berurah',
  'aruch-hashulchan', 'tur', 'kitzur-shulchan-aruch', 'chumash',
  'tanach-commentary', 'midrash', 'ein-yaakov', 'mussar', 'tanya', 'machzor',
];
const EXPECTED_BOXES = {
  'talmud-bavli': 11, 'mikraot-gedolot': 8, 'shulchan-aruch': 9,
  'chumash-rishonim': 7, responsa: 3, 'chassidic-drush': 3,
  'yiddish-sefer': 4, 'machon-edition': 3, siddur: 2,
  'shas-oz-vehadar': 13, 'shas-artscroll': 11, 'shas-steinzaltz': 12,
  yerushalmi: 8, 'mishnah-classic': 6, 'mishnah-kehati': 5,
  'mishneh-torah': 8, 'mishnah-berurah': 7, 'aruch-hashulchan': 3,
  tur: 7, 'kitzur-shulchan-aruch': 3, chumash: 5, 'tanach-commentary': 6,
  midrash: 3, 'ein-yaakov': 4, mussar: 3, tanya: 3, machzor: 2,
};

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

async function dismissGuardIfPresent(page) {
  // The app guards any navigation/create while the open book is dirty
  // (UnsavedChangesModal: "שינויים שלא נשמרו לקובץ פרויקט"). Discard
  // continues the pending action — so dismissing after a gated submit
  // lets the create proceed. Returns true when a guard was dismissed.
  const guard = page.getByText('שינויים שלא נשמרו לקובץ פרויקט').first();
  if (await guard.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'המשך ללא שמירה (Discard)' }).click();
    await page.waitForTimeout(900);
    return true;
  }
  return false;
}

async function goHome(page, currentTitle) {
  // The header project menu trigger shows the open document title.
  await page.getByRole('button', { name: currentTitle }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'חזרה למסך פתיחת הספר' }).click();
  await page.waitForTimeout(1500);
  await dismissGuardIfPresent(page);
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
  const homeLayouts = await page.locator('[data-testid^="new-project-form-home-layout-"]').count();
  check('Home picker lists all 7 base layouts', homeLayouts === 7, `got ${homeLayouts}`);
  const homeRecipeCards = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="new-project-form-home-recipe-"]')]
      .filter(el => !el.dataset.testid.includes('-group-')).length);
  check('Home picker lists all 27 historical recipes', homeRecipeCards === 27, `got ${homeRecipeCards}`);
  const homeGroups = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="new-project-form-home-recipe-group-"]')].length);
  check('Home picker groups the recipes into shelves', homeGroups === 10, `got ${homeGroups} shelves`);

  // ── 2. Names come from the metadata in both languages ──────────
  // English rendering is checked in a second context that starts with
  // the stored language set to English (keter-ui-lang) — the picker
  // shows the metadata nameEn/descriptionEn with no i18n lookup.
  {
    const ctxEn = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const pageEn = await ctxEn.newPage();
    pageEn.on('pageerror', (e) => pageErrors.push('en-context: ' + String(e)));
    await pageEn.addInitScript(() => {
      localStorage.setItem('keter-welcome-seen-v040', '1');
      localStorage.setItem('keter-ui-lang', 'en');
    });
    await pageEn.goto(base + '/', { waitUntil: 'networkidle' });
    await pageEn.waitForTimeout(1200);
    const mbEn = await pageEn.locator('[data-testid="new-project-form-home-recipe-mishnah-berurah"]').innerText();
    check('English mode shows the English name (Mishnah Berurah)', mbEn.includes('Mishnah Berurah'), mbEn.slice(0, 80));
    check('English mode shows the English description', mbEn.includes('Shulchan Aruch'));
    const siddurEn = await pageEn.locator('[data-testid="new-project-form-home-recipe-siddur"]').innerText();
    check('English mode shows the Siddur name + description', siddurEn.includes('Siddur') && siddurEn.includes('prayer'));
    await ctxEn.close();
  }
  const mbHe = await page.locator('[data-testid="new-project-form-home-recipe-mishnah-berurah"]').innerText();
  check('Hebrew mode shows the Hebrew name (משנה ברורה)', mbHe.includes('משנה ברורה'));

  // ── 3. Every recipe, one by one, from the Home section ─────────
  let previousRaw = null;
  for (const id of RECIPE_IDS) {
    const title = `v095 ${id}`;
    // A guard left over from the previous iteration (dirty book) would
    // block the form; discard it — nothing in this smoke needs keeping.
    await dismissGuardIfPresent(page);
    await page.locator('[data-testid="new-project-form-home-title"]').fill(title);
    await page.locator(`[data-testid="new-project-form-home-recipe-${id}"]`).click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="new-project-form-home-starter-blank"]').click();
    await page.locator('[data-testid="new-project-form-home-submit"]').click();
    await page.waitForTimeout(1200);
    let read = await readAutosavedSnapshot(page, title, 5000, previousRaw);
    if (!read) {
      // The submit may have been gated by the unsaved-changes guard
      // (the previous book is dirty until its autosave settles);
      // discarding continues the pending create.
      await dismissGuardIfPresent(page);
      read = await readAutosavedSnapshot(page, title, 12000, previousRaw);
    }
    const snap = read?.snap ?? null;
    previousRaw = read?.raw ?? previousRaw;
    const boxes = snap?.designSettings?.pageLayout?.customLayout?.boxes?.length ?? null;
    check(`'${id}' creates the book (layoutType custom_layout)`,
      snap?.layoutType === 'custom_layout', `layoutType=${snap?.layoutType ?? 'no snapshot'}`);
    check(`'${id}' applies its real geometry (${EXPECTED_BOXES[id]} boxes, no fallback)`,
      boxes === EXPECTED_BOXES[id], `boxes=${boxes}`);
    if (snap) {
      await goHome(page, title);
      check(`returned Home after '${id}'`, await homeForm.isVisible());
    }
  }

  check('no page errors across the whole run', pageErrors.length === 0, pageErrors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv095-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
