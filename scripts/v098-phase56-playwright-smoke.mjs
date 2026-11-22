/**
 * KETER-TYPE v0.9.8 Phases 5+6 — Playwright live drive-through (real Chromium).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v098-phase56-playwright-smoke.mjs
 *
 * Reuses the Phase 3–4 import flow (Shas archetype, three 50-dibbur
 * fixtures, confident-only import, continue to the last project) and
 * then drives the Phase 5 studio live:
 *  G. Select a Main Text word: the floating toolbar shows Push/Pull.
 *     Push moves the last line to the next page (toast); Pull brings it
 *     back (toast) — the room the push freed makes the pull succeed.
 *  H. "Show Anchor Links" overlay: connector lines appear between real
 *     rendered dibbur words and their target phrases (not a fixed arc).
 *  I. Click-to-re-anchor: click a dibbur word (hint bar appears), then
 *     a Main Text word — the link updates (toast) and the book
 *     re-paginates.
 *  J. Design panel → Quick-Tune tab: change trim size to 6×9 and the
 *     live page geometry shrinks (overlay SVG content width follows
 *     the new trim: 344/394 of the Vilna-folio width).
 *  K. English mode (fresh page, keter-ui-lang=en): same import to the
 *     editor; the overlay toggle reads "Dibbur links" and the Design
 *     panel has a "Quick-Tune" tab — no Hebrew in the new strings.
 *
 * Screenshots: screenshots/v098/15-*.png … 20-*.png
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

const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'keter-v098-56-'));
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
  check('a Main Text word is clickable', c !== null, c ? `${c.x.toFixed(0)},${c.y.toFixed(0)}` : '');
  if (c) {
    await pg.mouse.click(c.x, c.y);
    await pg.waitForTimeout(600);
  }
  return c !== null;
}

/** Aspect ratio (width / height) of the rendered page sheet. Scale-free:
 *  zoom changes the size, not the ratio, so the ratio proves the trim. */
async function sheetAspect(pg) {
  return pg.evaluate(() => {
    const sheet = [...document.querySelectorAll('div')].find((d) => d.className.includes('ui-page-bg'));
    if (!sheet) return 0;
    const w = parseFloat(sheet.style.width || '0');
    const h = parseFloat(sheet.style.height || '0');
    return h > 0 ? w / h : 0;
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
  await importFixtures(page);

  // ── G. Push / pull micro-adjustments ──
  await clickSourceWord(page);
  const pushBtn = page.locator('[data-testid="toolbar-push-line"]');
  check('G floating toolbar shows Push line after selecting a word', await pushBtn.isVisible().catch(() => false));
  const pullBtn = page.locator('[data-testid="toolbar-pull-line"]');
  check('G floating toolbar shows Pull line', await pullBtn.isVisible().catch(() => false));
  if (await pushBtn.isVisible().catch(() => false)) {
    await pushBtn.click();
    const pushToast = await page.getByText('השורה נדחפה לעמוד הבא').first().isVisible().catch(() => false);
    check('G Push shows the pushed toast', pushToast);
    await page.screenshot({ path: path.join(SHOTS, '15-push-line.png') });
  }
  // Re-select (re-pagination may drop the selection), then pull the line back.
  await clickSourceWord(page);
  if (await pullBtn.isVisible().catch(() => false)) {
    await pullBtn.click();
    const pullToast = await page.getByText('השורה נמשכה לעמוד זה').first().isVisible().catch(() => false);
    check('G Pull shows the pulled toast (room freed by the push)', pullToast);
  } else {
    check('G Pull button visible after re-select', false);
  }

  // ── H. Anchor overlay ──
  await page.getByRole('button', { name: 'אפשרויות נוספות' }).click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="toggle-anchor-links"]').click();
  await page.waitForTimeout(1200);
  const connectors = page.locator('[data-testid="anchor-connectors"] path');
  const connectorCount = await connectors.count();
  check('H overlay draws connector lines between real words', connectorCount >= 1, `${connectorCount} connectors`);
  const dibburHandles = await page.locator('[data-anchor-dibbur]').count();
  check('H dibbur words become re-anchor handles', dibburHandles >= 1, `${dibburHandles} handles`);
  await page.screenshot({ path: path.join(SHOTS, '16-anchor-overlay.png') });

  // ── I. Click-to-re-anchor ──
  const firstDibbur = page.locator('[data-anchor-dibbur]').first();
  const dibburBox = await firstDibbur.boundingBox();
  check('I a dibbur word has a clickable box', dibburBox !== null);
  if (dibburBox) {
    await page.mouse.click(dibburBox.x + dibburBox.width / 2, dibburBox.y + dibburBox.height / 2);
    await page.waitForTimeout(500);
    check('I re-anchor hint bar appears after clicking a dibbur', (await page.locator('[data-testid="reanchor-hint"]').count()) === 1);
    await clickSourceWord(page);
    const reanchorToast = await page.getByText('הקישור עודכן').first().isVisible().catch(() => false);
    check('I re-anchor updates the link (toast)', reanchorToast);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, '17-reanchor.png') });
  }

  // ── J. Quick-Tune ──
  await page.getByRole('button', { name: 'עיצוב העמוד' }).click();
  await page.waitForTimeout(800);
  await page.getByText('כוונון מהיר', { exact: true }).first().click();
  await page.waitForTimeout(500);
  check('J Quick-Tune panel opens', (await page.locator('[data-testid="quick-tune-panel"]').count()) === 1);
  const aspectBefore = await sheetAspect(page);
  await page.locator('[data-testid="quick-tune-trim-size"]').selectOption('trim_6x9');
  await page.waitForTimeout(1200);
  const aspectAfter = await sheetAspect(page);
  // 6×9 trim is 432×648pt: aspect 0.6667. The SVG width also changes,
  // but it conflates geometry with the auto-fit zoom, so the scale-free
  // sheet aspect ratio is the assertion (it must move to 0.667).
  check('J trim 6×9 changes the live page aspect to 6:9', Math.abs(aspectAfter - 432 / 648) < 0.01 && Math.abs(aspectAfter - aspectBefore) > 0.02, `aspect ${aspectBefore.toFixed(3)} → ${aspectAfter.toFixed(3)}`);
  const trimValue = await page.locator('[data-testid="quick-tune-trim-size"]').inputValue();
  check('J trim select holds the new size', trimValue === 'trim_6x9', trimValue);
  await page.screenshot({ path: path.join(SHOTS, '18-quick-tune-6x9.png') });

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
  await importFixtures(pageEn, { continueName: /last project/i, designName: /Page design/i });
  await pageEn.getByRole('button', { name: /More options/i }).click();
  await pageEn.waitForTimeout(400);
  const toggleEn = await pageEn.locator('[data-testid="toggle-anchor-links"]').innerText();
  check('K overlay toggle reads "Dibbur links" in English', toggleEn.trim() === 'Dibbur links', toggleEn);
  await pageEn.getByRole('button', { name: /Page design/i }).click();
  await pageEn.waitForTimeout(800);
  const quickTuneEn = await pageEn.getByText('Quick-Tune', { exact: true }).count();
  check('K Quick-Tune tab renders in English', quickTuneEn >= 1);
  await pageEn.getByText('Quick-Tune', { exact: true }).first().click();
  await pageEn.waitForTimeout(500);
  check('K Quick-Tune panel opens in English', (await pageEn.locator('[data-testid="quick-tune-panel"]').count()) === 1);
  await pageEn.screenshot({ path: path.join(SHOTS, '19-quick-tune-en.png') });
  await pageEn.close();

  check('no JS page errors during the drive', errors.length === 0, errors.slice(0, 3).join(' | '));
  const sameOriginFailures = failedRequests.filter((u) => u.startsWith(base));
  check('no same-origin resource failed to load', sameOriginFailures.length === 0, sameOriginFailures.join(' | '));
  const externalFailures = [...new Set(failedRequests.filter((u) => !u.startsWith(base)))];
  if (externalFailures.length > 0) console.log(`  (note) external resource unreachable in this sandbox: ${externalFailures.join(' | ')}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv098-phase56-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
