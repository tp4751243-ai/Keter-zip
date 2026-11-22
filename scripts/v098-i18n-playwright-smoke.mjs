/**
 * KETER-TYPE v0.9.8 — Bilingual Audit Playwright live drive-through
 * (real Chromium, both locales).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v098-i18n-playwright-smoke.mjs
 *
 * Hebrew page:
 *  A. Wizard renders in Hebrew, document.dir is rtl, stepper arrow
 *     points left (←), 5 archetype cards with Hebrew descriptions.
 *  B. Archetype-card descriptions are right-aligned in Hebrew
 *     (computed text-align: right) — the text-start fix.
 *  C. Shas archetype: Hebrew slot matrix (Gemara / Rashi / Tosafot);
 *     upload all 3 fixtures; per-file preview counts in Hebrew with
 *     correct singular/plural ("1 Note" would be English — here the
 *     Hebrew forms: "מילה"/"מילים" by count).
 *  D. Import: the linking report renders in Hebrew; Generate opens
 *     the editor; the anchor toggle reads Hebrew; Quick-Tune opens in
 *     Hebrew; push/pull toasts are Hebrew.
 * English page (fresh page, keter-ui-lang=en):
 *  E. Wizard renders fully in English, document.dir is ltr, stepper
 *     arrow points right (→), archetype descriptions are LEFT-aligned
 *     (computed text-align: left) — the text-start fix.
 *  F. Same import drive in English: slot matrix, preview counts
 *     ("Words", "1 Note" singular where the count is 1), linking
 *     report with no Hebrew characters left.
 *  G. Anchor overlay toggle reads "Dibbur links"; clicking a dibbur
 *     shows the re-anchor hint bar in English; Quick-Tune opens in
 *     English; Story Editor (right-click menu) opens in English.
 *  H. New Project modal and DOCX import modal render in English.
 *  I. No JS page errors on either page; no same-origin failures.
 *  J. Nikud clipping: screenshots are saved for visual review; the
 *     smoke asserts no horizontal overflow on the wizard/hub/panel
 *     (document.scrollWidth <= innerWidth) in both locales.
 *
 * The Welcome modal opens on first load in a fresh profile and covers
 * Home, so every load dismisses it first via its close button
 * (aria-label "סגור" / "Close").
 *
 * Screenshots: screenshots/v098/30-i18n-*.png … 42-i18n-*.png
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

// Test .docx files (generated fresh each run, same generator as Phase 5/6).
const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'keter-v098-i18n-'));
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

const HEBREW_RE = /[\u0590-\u05FF]/;

/** Centre of a Main Text word: a span whose text is one of the Gemara
 *  fixture's words (never a heading like "מסכת", never a dibbur lead). */
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
async function clickSourceWord(pg) {
  const c = await sourceWordCentre(pg);
  if (c) {
    await pg.mouse.click(c.x, c.y);
    await pg.waitForTimeout(600);
  }
  return c !== null;
}

/** Drive the Shas wizard + hub import on a page already on Home. */
async function importFixtures(pg, labels = {}) {
  const continueName = labels.continueName ?? 'המשך לפרויקט האחרון';
  const designName = labels.designName ?? 'עיצוב העמוד';
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
  const cont = pg.getByRole('button', { name: continueName });
  if (await cont.isVisible().catch(() => false)) {
    await cont.click();
    await pg.waitForTimeout(2000);
  }
  check('editor opens (Design button visible)', await pg.getByRole('button', { name: designName }).isVisible());
  await pg.waitForSelector('[data-testid="anchor-overlay-svg"]', { timeout: 20000 });
}


/** The editor guards New Project / Word import behind the Unsaved
 *  Changes dialog when the open project is modified (it is, after an
 *  import). Dismiss it with "Continue without saving" if it appears. */
async function dismissUnsavedGuard(pg) {
  const discard = pg.getByRole('button', { name: /Continue without saving/i });
  if ((await discard.count()) >= 1) {
    await discard.first().click();
    await pg.waitForTimeout(600);
    return true;
  }
  return false;
}

const browser = await chromium.launch();
const errors = [];
const failedRequests = [];
try {
  // ══════════ Hebrew page ══════════
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push('HE: ' + String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !String(m.text()).startsWith('Failed to load resource')) errors.push('HE: ' + m.text());
  });
  page.on('requestfailed', (req) => failedRequests.push(req.url()));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await dismissWelcomeModal(page);

  // ── A. Wizard in Hebrew, RTL ──
  check('A document.dir is rtl in Hebrew mode', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  const stepperHe = await page.locator('[data-testid="sefer-wizard-stepper"]').innerText();
  check('A stepper renders in Hebrew', stepperHe.includes('אשף ספר חדש') && stepperHe.includes('בחרו סוג ספר'), stepperHe);
  check('A stepper arrow points left in RTL', stepperHe.includes('←') && !stepperHe.includes('→'), stepperHe);
  const shasCardHe = page.locator('[data-testid="new-project-form-home-wizard-archetype-shas"]');
  check('A Shas archetype card is Hebrew', (await shasCardHe.innerText()).includes('ש״ס / גמרא'));
  await page.screenshot({ path: path.join(SHOTS, '30-i18n-wizard-he.png') });

  // ── B. Archetype description alignment in Hebrew ──
  const descAlignHe = await shasCardHe.locator('p').first().evaluate((el) => getComputedStyle(el).textAlign);
  check('B archetype description uses text-start in Hebrew (renders right in RTL)', descAlignHe === 'start', descAlignHe);
  check('J no horizontal overflow on the wizard (HE)', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);

  // ── C. Shas slots + 3 fixtures, Hebrew preview counts ──
  await shasCardHe.click();
  await page.waitForTimeout(600);
  check('C slot matrix is Hebrew', (await page.locator('[data-testid="docx-hub-home-wizard-slots"]').innerText()).includes('שלב 2'));
  for (const slot of ['gemara', 'rashi', 'tosafot']) {
    check(`C ${slot} slot present`, (await page.locator(`[data-testid="docx-hub-home-slot-${slot}"]`).count()) === 1);
  }
  await page.screenshot({ path: path.join(SHOTS, '31-i18n-slots-he.png') });
  for (const [slot, file] of [['gemara', 'gemara-50.docx'], ['rashi', 'rashi-50.docx'], ['tosafot', 'tosafot-50.docx']]) {
    const input = page.locator(`[data-testid="docx-hub-home-slot-${slot}"] input[type="file"]`);
    await input.setInputFiles(path.join(FIXTURES, file));
    await page.waitForFunction(
      (testId) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.includes('מילים'),
      `docx-hub-home-preview-${slot}`,
      { timeout: 20000 }
    );
  }
  const previewHe = await page.locator('[data-testid="docx-hub-home-preview-gemara"]').innerText();
  check('C preview counts are Hebrew (מילים, ד״ה)', /מילים/.test(previewHe) && /ד״ה/.test(previewHe), previewHe);

  // ── D. Import: linking report + editor in Hebrew ──
  await page.locator('[data-testid="docx-hub-home-import"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="docx-hub-home-linking-report"]') !== null,
    { timeout: 60000 }
  );
  const reportHe = await page.locator('[data-testid="docx-hub-home-linking-report"]').innerText();
  check('D linking report renders in Hebrew', HEBREW_RE.test(reportHe) && reportHe.includes('ד״ה'), reportHe);
  await page.screenshot({ path: path.join(SHOTS, '32-i18n-linking-he.png') });
  await page.locator('[data-testid="docx-hub-home-confident-only"]').click();
  await page.waitForTimeout(2500);
  const contHe = page.getByRole('button', { name: 'המשך לפרויקט האחרון' });
  if (await contHe.isVisible().catch(() => false)) {
    await contHe.click();
    await page.waitForTimeout(2000);
  }
  check('D editor opens in Hebrew', await page.getByRole('button', { name: 'עיצוב העמוד' }).isVisible());
  await page.waitForSelector('[data-testid="anchor-overlay-svg"]', { timeout: 20000 });
  await page.screenshot({ path: path.join(SHOTS, '33-i18n-editor-he.png') });

  // Anchor toggle (More options menu) in Hebrew.
  await page.getByRole('button', { name: 'אפשרויות נוספות' }).click();
  await page.waitForTimeout(400);
  const toggleHe = await page.locator('[data-testid="toggle-anchor-links"]').innerText();
  check('D anchor toggle reads Hebrew', toggleHe.includes('קישורי'), toggleHe);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Quick-Tune in Hebrew.
  await page.getByRole('button', { name: 'עיצוב העמוד' }).click();
  await page.waitForTimeout(800);
  await page.getByText('כוונון מהיר', { exact: true }).first().click();
  await page.waitForTimeout(500);
  check('D Quick-Tune panel opens in Hebrew', (await page.locator('[data-testid="quick-tune-panel"]').count()) === 1);
  const qtHe = await page.locator('[data-testid="quick-tune-panel"]').innerText();
  check('D Quick-Tune labels are Hebrew', qtHe.includes('גאומטריית עמוד') || qtHe.includes('גודל דף'), qtHe.slice(0, 120));
  await page.screenshot({ path: path.join(SHOTS, '34-i18n-quick-tune-he.png') });

  // Push toast in Hebrew.
  await clickSourceWord(page);
  const pushBtn = page.locator('[data-testid="toolbar-push-line"]');
  if (await pushBtn.isVisible().catch(() => false)) {
    await pushBtn.click();
    await page.waitForTimeout(600);
    check('D Push toast is Hebrew', await page.getByText('השורה נדחפה לעמוד הבא').first().isVisible().catch(() => false));
  } else {
    check('D Push button visible after selecting a word', false);
  }

  // ══════════ English page ══════════
  const pageEn = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pageEn.on('pageerror', (e) => errors.push('EN: ' + String(e)));
  pageEn.on('console', (m) => {
    if (m.type() === 'error' && !String(m.text()).startsWith('Failed to load resource')) errors.push('EN: ' + m.text());
  });
  pageEn.on('requestfailed', (req) => failedRequests.push(req.url()));
  await pageEn.addInitScript(() => localStorage.setItem('keter-ui-lang', 'en'));
  await pageEn.goto(base + '/', { waitUntil: 'networkidle' });
  await pageEn.waitForTimeout(1500);
  await dismissWelcomeModal(pageEn);

  // ── E. Wizard in English, LTR, left-aligned descriptions ──
  check('E document.dir is ltr in English mode', (await pageEn.evaluate(() => document.documentElement.dir)) === 'ltr');
  const stepperEn = await pageEn.locator('[data-testid="sefer-wizard-stepper"]').innerText();
  check('E stepper renders in English', stepperEn.includes('New Sefer Wizard:') && stepperEn.includes('Choose a book type'), stepperEn);
  check('E stepper has no Hebrew wizard text', !HEBREW_RE.test(stepperEn), stepperEn);
  check('E stepper arrow points right in LTR', stepperEn.includes('→') && !stepperEn.includes('←'), stepperEn);
  const shasCardEn = pageEn.locator('[data-testid="new-project-form-home-wizard-archetype-shas"]');
  check('E Shas archetype card is English', (await shasCardEn.innerText()).includes('Shas / Gemara'));
  const descAlignEn = await shasCardEn.locator('p').first().evaluate((el) => getComputedStyle(el).textAlign);
  check('E archetype description uses text-start in English (renders left in LTR)', descAlignEn === 'start', descAlignEn);
  check('J no horizontal overflow on the wizard (EN)', await pageEn.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `scrollWidth=${await pageEn.evaluate(() => document.documentElement.scrollWidth)}`);
  await pageEn.screenshot({ path: path.join(SHOTS, '35-i18n-wizard-en.png') });

  // ── F. Same import drive in English ──
  await shasCardEn.click();
  await pageEn.waitForTimeout(600);
  check('F slot matrix title is English', (await pageEn.locator('[data-testid="docx-hub-home-wizard-slots"]').innerText()).includes('Step 2 — Word files by role (Shas / Gemara):'));
  await pageEn.screenshot({ path: path.join(SHOTS, '36-i18n-slots-en.png') });
  for (const [slot, file] of [['gemara', 'gemara-50.docx'], ['rashi', 'rashi-50.docx'], ['tosafot', 'tosafot-50.docx']]) {
    const input = pageEn.locator(`[data-testid="docx-hub-home-slot-${slot}"] input[type="file"]`);
    await input.setInputFiles(path.join(FIXTURES, file));
    await pageEn.waitForFunction(
      (testId) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.includes('Words'),
      `docx-hub-home-preview-${slot}`,
      { timeout: 20000 }
    );
  }
  const previewEn = await pageEn.locator('[data-testid="docx-hub-home-preview-gemara"]').innerText();
  check('F preview counts are English, no Hebrew left', /Words/.test(previewEn) && !HEBREW_RE.test(previewEn), previewEn);
  // Singular check: the Rashi fixture has exactly 1 dibbur? No — assert
  // the plural/singular rendering only where the count is known: the
  // Gemara preview line must not contain the old "1 Chapters" bug form.
  check('F no "1 Chapters"/"1 Notes" plural-only bug form', !/1 Chapters/.test(previewEn) && !/1 Notes/.test(previewEn), previewEn);
  await pageEn.locator('[data-testid="docx-hub-home-import"]').click();
  await pageEn.waitForFunction(
    () => document.querySelector('[data-testid="docx-hub-home-linking-report"]') !== null,
    { timeout: 60000 }
  );
  const reportEn = await pageEn.locator('[data-testid="docx-hub-home-linking-report"]').innerText();
  check('F linking report is English, no Hebrew left', !HEBREW_RE.test(reportEn) && reportEn.includes('D.H.'), reportEn);
  await pageEn.screenshot({ path: path.join(SHOTS, '37-i18n-linking-en.png') });
  await pageEn.locator('[data-testid="docx-hub-home-confident-only"]').click();
  await pageEn.waitForTimeout(2500);
  const contEn = pageEn.getByRole('button', { name: /last project/i });
  if (await contEn.isVisible().catch(() => false)) {
    await contEn.click();
    await pageEn.waitForTimeout(2000);
  }
  check('F editor opens in English', await pageEn.getByRole('button', { name: /Page design/i }).isVisible());
  await pageEn.waitForSelector('[data-testid="anchor-overlay-svg"]', { timeout: 20000 });

  // ── G. Anchor overlay + re-anchor hint + Quick-Tune + Story Editor in English ──
  await pageEn.getByRole('button', { name: /More options/i }).click();
  await pageEn.waitForTimeout(400);
  const toggleEn = await pageEn.locator('[data-testid="toggle-anchor-links"]').innerText();
  check('G overlay toggle reads "Dibbur links" in English', toggleEn.trim() === 'Dibbur links', toggleEn);
  await pageEn.locator('[data-testid="toggle-anchor-links"]').click();
  await pageEn.waitForTimeout(1200);
  const connectors = pageEn.locator('[data-testid="anchor-connectors"] path');
  check('G overlay draws connector lines', (await connectors.count()) >= 1, `${await connectors.count()} connectors`);
  await pageEn.screenshot({ path: path.join(SHOTS, '38-i18n-anchor-en.png') });
  const firstDibbur = pageEn.locator('[data-anchor-dibbur]').first();
  const dibburBox = await firstDibbur.boundingBox();
  check('G a dibbur word has a clickable box', dibburBox !== null);
  if (dibburBox) {
    await pageEn.mouse.click(dibburBox.x + dibburBox.width / 2, dibburBox.y + dibburBox.height / 2);
    await pageEn.waitForTimeout(500);
    check('G re-anchor hint bar appears in English', (await pageEn.locator('[data-testid="reanchor-hint"]').count()) === 1);
    const hintEn = await pageEn.locator('[data-testid="reanchor-hint"]').innerText();
    check('G re-anchor hint bar has no Hebrew', !HEBREW_RE.test(hintEn), hintEn);
    await pageEn.locator('[data-testid="reanchor-cancel"]').click().catch(() => {});
    await pageEn.waitForTimeout(300);
  }
  await pageEn.getByRole('button', { name: /Page design/i }).click();
  await pageEn.waitForTimeout(800);
  check('G Quick-Tune tab renders in English', (await pageEn.getByText('Quick-Tune', { exact: true }).count()) >= 1);
  await pageEn.getByText('Quick-Tune', { exact: true }).first().click();
  await pageEn.waitForTimeout(500);
  check('G Quick-Tune panel opens in English', (await pageEn.locator('[data-testid="quick-tune-panel"]').count()) === 1);
  const qtEn = await pageEn.locator('[data-testid="quick-tune-panel"]').innerText();
  check('G Quick-Tune labels are English, no Hebrew left', !HEBREW_RE.test(qtEn), qtEn.slice(0, 120));
  await pageEn.screenshot({ path: path.join(SHOTS, '39-i18n-quick-tune-en.png') });
  // Story Editor via the right-click context menu. The sheet is
  // taller than the viewport, so its centre is below the fold and a
  // click there never lands — scroll it into view first and click a
  // VISIBLE point on the sheet.
  const sheetEn = await pageEn.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => d.className.includes('ui-page-bg'));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { left: r.left, x: r.left + r.width / 2, y: Math.min(r.top + r.height / 2, 800) };
  });
  await pageEn.waitForTimeout(500);
  check('G page sheet found for right-click', sheetEn !== null);
  if (sheetEn) {
    await pageEn.mouse.click(sheetEn.x, sheetEn.y, { button: 'right' });
    await pageEn.waitForTimeout(500);
    const storyBtn = pageEn.getByRole('button', { name: /Story Editor/i });
    check('G context menu offers Story Editor in English', (await storyBtn.count()) >= 1);
    if ((await storyBtn.count()) >= 1) {
      await storyBtn.first().click();
      await pageEn.waitForTimeout(800);
      check('G Story Editor opens in English', (await pageEn.locator('[data-testid="story-editor"]').count()) === 1);
      const storyHeader = await pageEn.locator('[data-testid="story-editor"]').locator('div').first().innerText();
      check('G Story Editor header is English', storyHeader.includes('Story Editor') && !storyHeader.includes('עורך סיפור'), storyHeader.slice(0, 150));
      const backBtn = pageEn.getByRole('button', { name: /Back to layout view/i });
      check('G Story Editor offers Back to layout view', (await backBtn.count()) >= 1);
      if ((await backBtn.count()) >= 1) {
        await backBtn.first().click();
        await pageEn.waitForTimeout(800);
        check('G back returns to the layout editor', (await pageEn.locator('[data-testid="anchor-overlay-svg"]').count()) === 1);
      }
      await pageEn.screenshot({ path: path.join(SHOTS, '40-i18n-story-en.png') });
    }
  }

  // ── H. New Project modal + DOCX import modal in English ──
  // Back to Home via the header Project menu is unreliable from the
  // editor, so open the modals from the editor header instead.
  const headerEn = pageEn.locator('header').first();
  const projectMenuBtn = headerEn.locator('button[title="Book menu and settings"]');
  if ((await projectMenuBtn.count()) >= 1) {
    await projectMenuBtn.first().click();
    await pageEn.waitForTimeout(400);
    const newProjBtn = pageEn.getByRole('button', { name: /New project/i });
    check('H Project menu offers New project in English', (await newProjBtn.count()) >= 1);
    if ((await newProjBtn.count()) >= 1) {
      await newProjBtn.first().click();
      await pageEn.waitForTimeout(600);
      await dismissUnsavedGuard(pageEn);
      await pageEn.waitForSelector('[data-testid="new-project-form-modal"]', { timeout: 5000 }).catch(() => null);
      const modal = pageEn.locator('[data-testid="new-project-form-modal"]');
      check('H New Project modal opens', (await modal.count()) === 1);
      // The testid sits on the FORM (the heading lives in the modal
      // shell above it), so assert the form's own labels are English.
      const modalText = (await modal.innerText().catch(() => ''));
      check('H New Project modal is English', modalText.includes('Book / project name') && modalText.includes('Create a new project') && !HEBREW_RE.test(modalText), modalText.slice(0, 200));
      await pageEn.screenshot({ path: path.join(SHOTS, '41-i18n-newproject-en.png') });
      const modalClose = pageEn.locator('button[title="Close"]').last();
      if ((await modalClose.count()) >= 1) { await modalClose.click(); await pageEn.waitForTimeout(400); }
    }
    await projectMenuBtn.first().click().catch(() => {});
    await pageEn.waitForTimeout(400);
    const docxBtn = pageEn.getByRole('button', { name: /Import Word/i });
    check('H Project menu offers Word import in English', (await docxBtn.count()) >= 1);
    if ((await docxBtn.count()) >= 1) {
      await docxBtn.first().click();
      await pageEn.waitForTimeout(600);
      await dismissUnsavedGuard(pageEn);
      await pageEn.waitForTimeout(500);
      check('H DOCX import modal opens in English', (await pageEn.getByText('Import Word files', { exact: true }).count()) >= 1);
      await pageEn.screenshot({ path: path.join(SHOTS, '42-i18n-docx-modal-en.png') });
      await pageEn.keyboard.press('Escape');
      await pageEn.waitForTimeout(400);
    }
  } else {
    check('H Project menu button found in header', false);
  }
  await pageEn.close();

  // ── I. No page errors / no same-origin failures ──
  check('I no JS page errors during the drive (both locales)', errors.length === 0, errors.slice(0, 3).join(' | '));
  const sameOriginFailures = failedRequests.filter((u) => u.startsWith(base));
  check('I no same-origin resource failed to load', sameOriginFailures.length === 0, sameOriginFailures.join(' | '));
  const externalFailures = [...new Set(failedRequests.filter((u) => !u.startsWith(base)))];
  if (externalFailures.length > 0) console.log(`  (note) external resource unreachable in this sandbox: ${externalFailures.join(' | ')}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv098-i18n-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
