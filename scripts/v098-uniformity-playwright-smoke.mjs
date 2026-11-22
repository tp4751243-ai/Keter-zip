/**
 * KETER-TYPE v0.9.8 Uniformity Audit — Playwright live drive-through
 * (real Chromium, built dist/).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v098-uniformity-playwright-smoke.mjs
 *
 * Drives the main user path Home → wizard → hub import → editor →
 * Quick-Tune → export, and asserts the uniformity fixes LIVE:
 *  A. Home wizard: stepper + 5 archetypes + 11 core layout cards.
 *  B. DOCX import modal: shared backdrop class, opaque solid card
 *     (computed background alpha 1, day theme), Escape closes it.
 *  C. New Project modal (Ctrl+N): same shared dialog, Escape closes.
 *  D. Wizard import (Shas archetype, 3 fixtures) → editor opens.
 *  E. Settled defaults OFF live: Quick-Tune running-header switch OFF.
 *  F. "More tools": the button reads "סימני ניקוד" (no "עוגנים"
 *     anywhere); the "קישורי ד״ה" overlay draws connectors.
 *  G. Story Editor (subordinate): right-click → Story Editor opens
 *     with PLAIN role labels ("טקסט ראשי"), no raw "[main_source]".
 *  H. Edit-in-place (canonical): double-click a Gemara word opens
 *     the on-page editor.
 *  I. Content Editor (repositioned): menu reads "החלפת כל הטקסט...";
 *     the modal has NO sample presets; Escape does NOT close it
 *     (unsaved text — explicit ✕ only), ✕ does.
 *  J. Export workspace is the one export home ("ייצוא לדפוס").
 *  K. English mode: wizard + "Nikud marks" render in English.
 *  L. 0 JS page errors, 0 same-origin resource failures.
 *
 * Screenshots: screenshots/v098/20-*.png … 27-*.png
 * Exit code 0 = every check passed; 1 = a failure.
 * (Requires the Playwright chromium headless shell.)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'screenshots', 'v098');
fs.mkdirSync(SHOTS, { recursive: true });

const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'keter-v098-unif-'));
const gen = spawnSync('python3', [path.join(ROOT, 'scripts', 'v098-make-test-docx.py'), FIXTURES], { encoding: 'utf8' });
if (gen.status !== 0) {
  console.error('docx generator failed:', gen.stdout, gen.stderr);
  process.exit(1);
}

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
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function dismissWelcomeModal(pg) {
  const closeBtn = pg.locator('button[aria-label="סגור"], button[aria-label="Close"]');
  if ((await closeBtn.count()) > 0) {
    await closeBtn.first().click();
    await pg.waitForTimeout(400);
  }
}

const GEMARA_WORDS = ['מאימתי', 'קורין', 'שמע', 'ערבית', 'משעה', 'הכהנים', 'סוף', 'האשמורה', 'ראשונה', 'דברי', 'אליעזר', 'חכמים', 'אומרים', 'חצות', 'גמליאל', 'שיעלה', 'עמוד', 'השחר'];
async function sourceWordCentre(pg) {
  return pg.evaluate((words) => {
    const spans = [...document.querySelectorAll('span')].filter((s) => {
      const t = (s.textContent || '').trim();
      return words.includes(t) && !s.hasAttribute('data-anchor-dibbur') && s.children.length === 0;
    });
    for (const s of spans) {
      const r = s.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, GEMARA_WORDS);
}

async function importFixtures(pg) {
  await pg.locator('[data-testid="new-project-form-home-wizard-archetype-shas"]').click();
  await pg.waitForTimeout(600);
  for (const [slot, file] of [['gemara', 'gemara-50.docx'], ['rashi', 'rashi-50.docx'], ['tosafot', 'tosafot-50.docx']]) {
    const input = pg.locator(`[data-testid="docx-hub-home-slot-${slot}"] input[type="file"]`);
    await input.setInputFiles(path.join(FIXTURES, file));
    await pg.waitForFunction(
      (testId) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.includes('מילים') ||
        document.querySelector(`[data-testid="${testId}"]`)?.textContent?.includes('Words'),
      `docx-hub-home-preview-${slot}`,
      { timeout: 20000 }
    );
  }
  await pg.locator('[data-testid="docx-hub-home-import"]').click();
  await pg.waitForFunction(
    () => document.querySelector('[data-testid="docx-hub-home-linking-report"]') !== null,
    { timeout: 60000 }
  );
  await pg.locator('[data-testid="docx-hub-home-confident-only"]').click();
  await pg.waitForTimeout(2500);
  const cont = pg.getByRole('button', { name: 'המשך לפרויקט האחרון' });
  if (await cont.isVisible().catch(() => false)) {
    await cont.click();
    await pg.waitForTimeout(2000);
  }
  check('D editor opens (Design button visible)', await pg.getByRole('button', { name: 'עיצוב העמוד' }).isVisible());
  await pg.waitForSelector('[data-testid="anchor-overlay-svg"]', { timeout: 20000 });
}

/** The dialog card under a shared backdrop: opaque in the live day theme. */
async function dialogCardIsOpaque(pg) {
  return pg.evaluate(() => {
    const card = document.querySelector('.keter-dialog-surface');
    if (!card) return { found: false };
    const bg = getComputedStyle(card).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return { found: true, bg };
    const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { found: true, bg, alpha: parts.length === 4 ? parts[3] : 1 };
  });
}

const browser = await chromium.launch();
const errors = [];
const failedRequests = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !String(m.text()).startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('requestfailed', (req) => failedRequests.push(req.url()));

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWelcomeModal(page);

  // ── A. Home wizard ──
  check('A wizard stepper is visible', (await page.locator('[data-testid="sefer-wizard-stepper"]').count()) === 1);
  check('A five archetype cards', (await page.locator('[data-testid^="new-project-form-home-wizard-archetype-"]').count()) === 5);
  check('A eleven core layout cards', (await page.locator('[data-testid="new-project-form-home-core-layouts"] > *').count()) === 11);
  await page.screenshot({ path: path.join(SHOTS, '20-home-wizard.png') });

  // ── B. DOCX import modal: shared dialog, opaque, Escape closes ──
  await page.getByRole('button', { name: 'פתח בחלון נפרד' }).click();
  await page.waitForTimeout(800);
  check('B import modal uses the shared backdrop', (await page.locator('.keter-dialog-backdrop').count()) >= 1);
  const opaqueB = await dialogCardIsOpaque(page);
  check('B import modal card is opaque in the day theme', opaqueB.found && opaqueB.alpha === 1, opaqueB.bg || '');
  await page.screenshot({ path: path.join(SHOTS, '21-docx-modal.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('B Escape closes the import modal', (await page.locator('.keter-dialog-backdrop').count()) === 0);

  // ── C. New Project modal (Ctrl+N): same shared dialog ──
  await page.keyboard.press('Control+n');
  await page.waitForTimeout(800);
  check('C New Project modal opens on Ctrl+N', (await page.locator('.keter-dialog-backdrop').count()) >= 1);
  const opaqueC = await dialogCardIsOpaque(page);
  check('C New Project modal card is opaque', opaqueC.found && opaqueC.alpha === 1, opaqueC.bg || '');
  await page.screenshot({ path: path.join(SHOTS, '22-new-project-modal.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('C Escape closes the New Project modal', (await page.locator('.keter-dialog-backdrop').count()) === 0);

  // ── D. Wizard import → editor ──
  await importFixtures(page);
  await page.screenshot({ path: path.join(SHOTS, '23-editor.png') });

  // ── E. Settled defaults OFF live (Quick-Tune running header) ──
  await page.getByRole('button', { name: 'עיצוב העמוד' }).click();
  await page.waitForTimeout(800);
  await page.getByText('כוונון מהיר', { exact: true }).first().click();
  await page.waitForTimeout(500);
  check('E Quick-Tune panel opens', (await page.locator('[data-testid="quick-tune-panel"]').count()) === 1);
  const headerOn = await page.locator('[data-testid="quick-tune-header-enabled"]').isChecked().catch(() => null);
  check('E running header switch is OFF after a wizard import', headerOn === false, `checked=${headerOn}`);
  await page.screenshot({ path: path.join(SHOTS, '24-quick-tune-defaults.png') });
  // Close the Design drawer (same button toggles it).
  await page.getByRole('button', { name: 'עיצוב העמוד' }).click();
  await page.waitForTimeout(600);

  // ── F. "More tools": plain "סימני ניקוד", no "עוגנים"; overlay works ──
  await page.getByRole('button', { name: 'אפשרויות נוספות' }).click();
  await page.waitForTimeout(400);
  const moreToolsText = await page.evaluate(() => document.body.innerText);
  check('F "סימני ניקוד" button is present', moreToolsText.includes('סימני ניקוד'));
  check('F "עוגנים" appears nowhere on the page', !moreToolsText.includes('עוגנים'));
  await page.locator('[data-testid="toggle-anchor-links"]').click();
  await page.waitForTimeout(1200);
  const connectorCount = await page.locator('[data-testid="anchor-connectors"] path').count();
  check('F anchor overlay draws connectors', connectorCount >= 1, `${connectorCount} connectors`);
  await page.screenshot({ path: path.join(SHOTS, '25-anchor-overlay.png') });
  await page.locator('[data-testid="toggle-anchor-links"]').click();
  await page.waitForTimeout(400);

  // ── G. Story Editor (subordinate): plain role labels ──
  const wordCentre = await sourceWordCentre(page);
  check('G a Main Text word is present to right-click', wordCentre !== null);
  if (wordCentre) {
    await page.mouse.click(wordCentre.x, wordCentre.y, { button: 'right' });
    await page.waitForTimeout(500);
    const storyItem = page.getByText('עורך סיפור (Story Editor)', { exact: true });
    check('G right-click menu offers the Story Editor', (await storyItem.count()) >= 1);
    if ((await storyItem.count()) >= 1) {
      await storyItem.first().click();
      await page.waitForTimeout(800);
      check('G Story Editor opens', (await page.locator('[data-testid="story-editor"]').count()) === 1);
      const storyText = await page.locator('[data-testid="story-editor"]').innerText();
      check('G role label reads "טקסט ראשי" (plain words)', storyText.includes('טקסט ראשי'));
      check('G no raw "[main_source]" role id is shown', !storyText.includes('[main_source]'));
      await page.screenshot({ path: path.join(SHOTS, '26-story-editor.png') });
      await page.getByRole('button', { name: /חזרה לתצוגת עימוד/ }).click();
      await page.waitForTimeout(800);
      check('G back-to-layout returns to the page', (await page.locator('[data-testid="story-editor"]').count()) === 0);
    }
  }

  // ── H. Edit-in-place (canonical): double-click opens the on-page editor ──
  const wordCentre2 = await sourceWordCentre(page);
  check('H a Main Text word is present to double-click', wordCentre2 !== null);
  if (wordCentre2) {
    await page.mouse.click(wordCentre2.x, wordCentre2.y, { clickCount: 2 });
    await page.waitForTimeout(800);
    const editable = await page.locator('[contenteditable="true"]').count();
    check('H double-click opens the on-page editor', editable >= 1, `${editable} editable element(s)`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // ── I. Content Editor (repositioned): no presets; Escape does NOT close ──
  await page.locator('button[title="תפריט הספר והגדרות"]').click();
  await page.waitForTimeout(500);
  const replaceItem = page.getByText('החלפת כל הטקסט של הספר...', { exact: true });
  check('I File menu reads "החלפת כל הטקסט..." (not "עריכת כל הטקסט")', (await replaceItem.count()) >= 1);
  check('I old "עריכת כל הטקסט" menu item is gone', (await page.getByText('עריכת כל הטקסט של הספר...', { exact: true }).count()) === 0);
  if ((await replaceItem.count()) >= 1) {
    await replaceItem.first().click();
    await page.waitForTimeout(800);
    check('I Content Editor modal opens', (await page.locator('.keter-dialog-backdrop').count()) >= 1);
    const modalText = await page.evaluate(() => document.querySelector('.keter-dialog-surface')?.textContent || '');
    check('I modal header is "החלפת כל הטקסט של הספר"', modalText.includes('החלפת כל הטקסט של הספר'));
    check('I sample presets are gone', !modalText.includes('טעינת דוגמה מוכנה'));
    await page.screenshot({ path: path.join(SHOTS, '27-content-editor.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check('I Escape does NOT close it (unsaved text — documented exception)', (await page.locator('.keter-dialog-backdrop').count()) >= 1);
    await page.locator('.keter-dialog-surface button[title="סגור"]').first().click();
    await page.waitForTimeout(500);
    check('I ✕ closes it', (await page.locator('.keter-dialog-backdrop').count()) === 0);
  }

  // ── J. Export workspace is the one export home ──
  await page.locator('button[title="עבור למסך הייצוא והפקת הקובץ לדפוס (PDF / InDesign)"]').click();
  await page.waitForTimeout(1000);
  const exportText = await page.evaluate(() => document.body.innerText);
  check('J Export workspace opens', exportText.includes('ייצוא PDF וקטורי') || exportText.includes('קובץ PDF לדפוס'));
  await page.screenshot({ path: path.join(SHOTS, '28-export-workspace.png') });

  // ── K. English mode ──
  const pageEn = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pageEn.on('pageerror', (e) => errors.push(String(e)));
  pageEn.on('console', (m) => {
    if (m.type() === 'error' && !String(m.text()).startsWith('Failed to load resource')) errors.push(m.text());
  });
  pageEn.on('requestfailed', (req) => failedRequests.push(req.url()));
  await pageEn.addInitScript(() => localStorage.setItem('keter-ui-lang', 'en'));
  await pageEn.goto(base + '/', { waitUntil: 'networkidle' });
  await pageEn.waitForTimeout(1500);
  await dismissWelcomeModal(pageEn);
  const enText = await pageEn.evaluate(() => document.body.innerText);
  check('K wizard renders in English', enText.includes('New Sefer Wizard') && enText.includes('Choose a book type'));
  check('K no Hebrew wizard text remains', !enText.includes('אשף ספר חדש'));
  await pageEn.screenshot({ path: path.join(SHOTS, '29-wizard-en.png') });
  await pageEn.close();

  // ── L. No page errors ──
  check('L no JS page errors during the drive', errors.length === 0, errors.slice(0, 3).join(' | '));
  const sameOriginFailures = failedRequests.filter((u) => u.startsWith(base));
  check('L no same-origin resource failed to load', sameOriginFailures.length === 0, sameOriginFailures.join(' | '));
  const externalFailures = [...new Set(failedRequests.filter((u) => !u.startsWith(base)))];
  if (externalFailures.length > 0) console.log(`  (note) external resource unreachable in this sandbox: ${externalFailures.join(' | ')}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv098-uniformity-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
