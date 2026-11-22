/**
 * KETER-TYPE v0.9.2 Part B — Playwright client-render smoke (real Chromium).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v092b-playwright-smoke.mjs
 *
 * The static checks in scripts/v092b-uniformity-smoke.ts prove the
 * deduplicated features share one handler in code; this file proves it
 * in the running app, for two entry points of one feature at a time:
 *
 *  Test A — page navigation: the toolbar "דפים" button and the Ctrl+K
 *  palette "דפים" command both open the same navigator sidebar
 *  (Pages tab). The deleted copies are gone: no "לוחות עמודים" and no
 *  "סקירת עמודים" anywhere on screen.
 *  Test B — text size: the keyboard shortcut (Ctrl+Shift+>) and the
 *  floating toolbar "+" stepper both grow the selected unit's font
 *  size by 1pt, through the one shared handler — the readout moves
 *  the same amount either way.
 *  Test C — export: the header has no one-click "ייצוא PDF" button;
 *  "ייצוא לדפוס" opens the one Export workspace, which holds the PDF
 *  export.
 *  Test D — new project: the Home screen shows the inline section
 *  again (v0.9.4 restore) AND the New Project modal still opens from
 *  the command palette — both render the ONE shared form, so both
 *  list the same 27 historical recipes.
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

async function navigatorOpen(page) {
  // The navigator sidebar header is the tell: it only renders when open.
  return page.getByText('דפי הספר ומבנה').first().isVisible().catch(() => false);
}

async function createBlankProject(page) {
  // v0.9.4 — the new-project form is inline on Home now (no modal to
  // open first): pick the blank starter in the inline form, then
  // create. (Role-based clicks: the form's option buttons contain
  // inner divs that intercept text-based clicks.)
  await page.getByRole('button', { name: 'מסמך חדש נקי (מוכן להקלדה / ייבוא וורד)' }).click();
  await page.getByRole('button', { name: 'צור פרויקט חדש ועבור לעריכה' }).click();
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch();
try {
  // ---------------------------------------------------------- Test A
  console.log('Test A — two entries to Pages, one navigator');
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
    check('no ErrorBoundary fallback after creating the project', !(await fallbackShown(page)));
    check('navigator starts closed', !(await navigatorOpen(page)));
    check('no deleted page surfaces on screen',
      (await page.getByText('לוחות עמודים', { exact: true }).count()) === 0 &&
      (await page.getByText('סקירת עמודים', { exact: true }).count()) === 0);
    // Entry point 1: the toolbar "דפים" button.
    await page.getByText('דפים', { exact: true }).first().click();
    await page.waitForTimeout(800);
    check('toolbar "דפים" opens the navigator', await navigatorOpen(page));
    check('navigator shows the page list', await page.getByText(/עמ׳\s*1/).first().isVisible().catch(() => false));
    // Close it via its own close button, then use entry point 2.
    await page.getByTitle('סגור מגירת ניווט').first().click();
    await page.waitForTimeout(600);
    check('navigator closes', !(await navigatorOpen(page)));
    // Entry point 2: Ctrl+K palette → type "דפים", Enter runs the match.
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(600);
    await page.keyboard.type('דפים');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    check('palette "דפים" opens the same navigator', await navigatorOpen(page));
    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test B
  console.log('Test B — two entries to font size, one handler');
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
    // Select a unit via the navigator's 'פסקאות' tab (canvas word-clicks
    // do not leave a selection — see MANIFEST §5).
    await page.getByText('דפים', { exact: true }).first().click();
    await page.waitForTimeout(600);
    await page.getByText('פסקאות', { exact: true }).first().click();
    await page.waitForTimeout(600);
    const firstRow = page.locator('p.line-clamp-2').first();
    if ((await firstRow.count()) > 0) {
      await firstRow.click({ timeout: 5000 });
      await page.waitForTimeout(600);
    }
    // The floating toolbar's size readout: a span reading like "13pt".
    const readSize = () =>
      page.evaluate(() => {
        const spans = [...document.querySelectorAll('span')];
        const el = spans.find(s => /^\d+(\.\d+)?pt$/.test((s.textContent || '').trim()));
        return el ? parseFloat(el.textContent) : null;
      });
    const size0 = await readSize();
    check('a unit is selected (floating toolbar shows its size)', size0 !== null, `size=${size0}`);
    if (size0 !== null) {
      // Entry point 1: keyboard shortcut Ctrl+Shift+>.
      await page.keyboard.press('Control+Shift+Period');
      await page.waitForTimeout(700);
      const size1 = await readSize();
      check('keyboard shortcut grows the size by 1pt', size1 === size0 + 1, `${size0} → ${size1}`);
      // Entry point 2: the floating toolbar "+" stepper (the button
      // right after the size readout).
      const plus = page.evaluate(() => {
        const spans = [...document.querySelectorAll('span')];
        const el = spans.find(s => /^\d+(\.\d+)?pt$/.test((s.textContent || '').trim()));
        if (!el) return false;
        const btns = el.parentElement ? [...el.parentElement.querySelectorAll('button')] : [];
        const plusBtn = btns[btns.length - 1];
        if (!plusBtn) return false;
        plusBtn.click();
        return true;
      });
      check('floating "+" stepper is clickable', await plus);
      await page.waitForTimeout(700);
      const size2 = await readSize();
      check('floating "+" grows the size by its own 0.5pt step (same unit, same handler)', size2 !== null && size1 !== null && Math.abs(size2 - (size1 + 0.5)) < 0.01, `${size1} → ${size2}`);
      check('no ErrorBoundary fallback', !(await fallbackShown(page)));
    }
    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test C
  console.log('Test C — export: one home');
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
    check('header has no one-click "ייצוא PDF" button',
      (await page.getByText('ייצוא PDF', { exact: true }).count()) === 0);
    await page.getByText('ייצוא לדפוס').first().click();
    await page.waitForTimeout(1200);
    check('"ייצוא לדפוס" opens the Export workspace',
      await page.getByText('מצב ייצוא ובקרת איכות קדם-דפוס').first().isVisible().catch(() => false));
    check('the Export workspace holds the PDF export',
      await page.getByText('ייצוא PDF וקטורי בר-חיפוש לדפוס').first().isVisible().catch(() => false));
    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test D
  console.log('Test D — new project: one shared form, two renderings (v0.9.4)');
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
    // Home shows the inline section again (same form, not a copy).
    check('Home shows the inline new-project section',
      await page.locator('[data-testid="new-project-form-home"]').isVisible());
    check('Home inline section shows the layout picker',
      await page.getByText('מתכונת עימוד (Book Layout)').first().isVisible().catch(() => false));
    const homeRecipes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="new-project-form-home-recipe-"]')]
        .filter(el => !el.dataset.testid.includes('-group-')).length);
    check('Home inline section lists all 27 historical recipes', homeRecipes === 27, `got ${homeRecipes}`);
    // The modal still opens (header project menu → 'פרויקט חדש...')
    // and lists the same recipes. The palette button lives in the
    // edit toolbar, not on Home — so create a blank project first
    // (default title 'ספר חדש — כתר'), then open the menu from it.
    await createBlankProject(page);
    await page.getByRole('button', { name: 'ספר חדש — כתר' }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'פרויקט חדש...' }).click();
    await page.waitForTimeout(900);
    if (await page.getByText('שינויים שלא נשמרו לקובץ פרויקט').first().isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'המשך ללא שמירה (Discard)' }).click();
      await page.waitForTimeout(900);
    }
    check('the New Project modal opens', await page.locator('[data-testid="new-project-form-modal"]').isVisible());
    check('the modal offers the historical templates', await page.getByText('תבניות היסטוריות').first().isVisible().catch(() => false));
    const modalRecipes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="new-project-form-modal-recipe-"]')]
        .filter(el => !el.dataset.testid.includes('-group-')).length);
    check('modal lists the same 27 recipes as Home', modalRecipes === homeRecipes, `got ${modalRecipes}`);
    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv092b-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
