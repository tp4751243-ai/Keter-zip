/**
 * KETER-TYPE v0.9.8 Phases 3+4 — Playwright live drive-through (real Chromium).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v098-phase34-playwright-smoke.mjs
 *
 * Fixtures: scripts/v098-make-test-docx.py generates gemara-50.docx
 * (31 Gemara units), rashi-50.docx (50 matched + 5 orphan dibburim)
 * and tosafot-50.docx (50 matched + 3 orphan dibburim) — 100 matched
 * dibburim with bold leads, nikkud variants and citations, plus 8
 * deliberate orphans so the review queue (and the LinkingReport line)
 * appears.
 *
 * Flow (light/day theme, Hebrew):
 *  A. Home: pick the Shas archetype; the hub shows the Gemara / Rashi /
 *     Tosafot slot matrix.
 *  B. Upload the three fixtures into their slots: per-file preview
 *     counts appear (words / dibburim) BEFORE Generate is clicked.
 *  C. Click Generate (Step 3): the import runs the old linker + the new
 *     CommentaryLinkerEngine, merges them, and holds the import in the
 *     review queue because the 8 orphans score below threshold.
 *  D. The review queue shows the Phase 3 LinkingReport line
 *     (data-testid docx-hub-home-linking-report): linked count,
 *     high-confidence count, awaiting-review count, unlinked count —
 *     with real numbers (linked >= 90, unlinked >= 1).
 *  E. "Confident only" resolves the queue: the book imports, the Home
 *     banner offers "continue to the last project", and the editor
 *     opens (Design button visible) with the paginated book.
 *  F. English mode (fresh page, keter-ui-lang=en): the same flow to the
 *     report line, which renders fully in English with no Hebrew.
 *
 * The Welcome modal opens on first load in a fresh profile and covers
 * Home, so every load dismisses it first via its close button
 * (aria-label "סגור" / "Close").
 *
 * Screenshots: screenshots/v098/11-*.png … 16-*.png
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

// Test .docx files (generated fresh each run).
const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'keter-v098-34-'));
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

async function uploadToSlot(pg, slot, fileName, previewWord) {
  const file = path.join(FIXTURES, fileName);
  check(`fixture ${fileName} exists`, fs.existsSync(file));
  const input = pg.locator(`[data-testid="docx-hub-home-slot-${slot}"] input[type="file"]`);
  await input.setInputFiles(file);
  await pg.waitForFunction(
    (testId) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.includes('מילים') ||
      document.querySelector(`[data-testid="${testId}"]`)?.textContent?.includes('Words'),
    `docx-hub-home-preview-${slot}`,
    { timeout: 20000 }
  );
  const preview = await pg.locator(`[data-testid="docx-hub-home-preview-${slot}"]`).innerText();
  check(`${slot} slot preview shows words + dibburim`, /מילים|Words/.test(preview) && /ד״ה|D\.H\./.test(preview), preview.replace(/\n/g, ' '));
  return preview;
}

/** Parse the LinkingReport line: first number = linked, last = unlinked. */
function reportNumbers(text) {
  const nums = [...text.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
  return nums;
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

  // ── A. Shas archetype → slot matrix ──
  await page.locator('[data-testid="new-project-form-home-wizard-archetype-shas"]').click();
  await page.waitForTimeout(600);
  check('A Shas slot matrix visible', await page.locator('[data-testid="docx-hub-home-wizard-slots"]').count() === 1);
  check('A Gemara/Rashi/Tosafot slots present',
    (await page.locator('[data-testid="docx-hub-home-slot-gemara"]').count()) === 1 &&
    (await page.locator('[data-testid="docx-hub-home-slot-rashi"]').count()) === 1 &&
    (await page.locator('[data-testid="docx-hub-home-slot-tosafot"]').count()) === 1);

  // ── B. Upload the three 50-dibbur fixtures ──
  await uploadToSlot(page, 'gemara', 'gemara-50.docx');
  await uploadToSlot(page, 'rashi', 'rashi-50.docx');
  await uploadToSlot(page, 'tosafot', 'tosafot-50.docx');
  await page.screenshot({ path: path.join(SHOTS, '11-shas-50-slots.png') });

  // ── C. Generate → review queue ──
  await page.locator('[data-testid="docx-hub-home-import"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="docx-hub-home-linking-report"]') !== null,
    { timeout: 60000 }
  );
  await page.waitForTimeout(500);

  // ── D. LinkingReport line ──
  const reportEl = page.locator('[data-testid="docx-hub-home-linking-report"]');
  check('D LinkingReport line appears in the review queue', (await reportEl.count()) === 1);
  const reportText = await reportEl.innerText();
  const nums = reportNumbers(reportText);
  check('D report line shows linked + unlinked counts', /קושרו/.test(reportText) && /לא קושרו/.test(reportText), reportText);
  check('D report links >= 90 dibburim (100 matched in the fixtures)', (nums[0] ?? 0) >= 90, `linked=${nums[0]}`);
  check('D report shows >= 1 unlinked (8 deliberate orphans)', (nums[nums.length - 1] ?? 0) >= 1, `unlinked=${nums[nums.length - 1]}`);
  check('D report line is Hebrew in Hebrew mode', /דו״ח קישור דיבורי המתחיל/.test(reportText), reportText);
  const reviewHeading = await page.locator('text=סקירת קישורים לא ודאיים').count();
  check('D uncertain-link review queue is shown', reviewHeading >= 1, `headings=${reviewHeading}`);
  await page.screenshot({ path: path.join(SHOTS, '12-linking-report.png') });

  // ── E. Confident-only → import → editor ──
  await page.locator('[data-testid="docx-hub-home-confident-only"]').click();
  await page.waitForTimeout(2500);
  const cont = page.getByRole('button', { name: 'המשך לפרויקט האחרון' });
  check('E Home banner offers "continue to the last project" after import', await cont.isVisible().catch(() => false));
  if (await cont.isVisible().catch(() => false)) {
    await cont.click();
    await page.waitForTimeout(2000);
  }
  check('E editor opens (Design button visible)', await page.getByRole('button', { name: 'עיצוב העמוד' }).isVisible());
  await page.screenshot({ path: path.join(SHOTS, '13-editor-paginated.png') });

  // ── F. English mode — same flow to the report line ──
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
  await pageEn.locator('[data-testid="new-project-form-home-wizard-archetype-shas"]').click();
  await pageEn.waitForTimeout(600);
  for (const [slot, file] of [['gemara', 'gemara-50.docx'], ['rashi', 'rashi-50.docx'], ['tosafot', 'tosafot-50.docx']]) {
    const input = pageEn.locator(`[data-testid="docx-hub-home-slot-${slot}"] input[type="file"]`);
    await input.setInputFiles(path.join(FIXTURES, file));
    await pageEn.waitForFunction(
      (testId) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.includes('Words'),
      `docx-hub-home-preview-${slot}`,
      { timeout: 20000 }
    );
  }
  await pageEn.locator('[data-testid="docx-hub-home-import"]').click();
  await pageEn.waitForFunction(
    () => document.querySelector('[data-testid="docx-hub-home-linking-report"]') !== null,
    { timeout: 60000 }
  );
  const reportEn = await pageEn.locator('[data-testid="docx-hub-home-linking-report"]').innerText();
  const numsEn = reportNumbers(reportEn);
  check('F report line is English in English mode', /linking report/i.test(reportEn) && /linked/i.test(reportEn), reportEn);
  check('F English report has no Hebrew', !/[\u0590-\u05FF]/.test(reportEn), reportEn);
  check('F English report links >= 90', (numsEn[0] ?? 0) >= 90, `linked=${numsEn[0]}`);
  await pageEn.screenshot({ path: path.join(SHOTS, '14-linking-report-en.png') });
  await pageEn.locator('[data-testid="docx-hub-home-confident-only"]').click();
  await pageEn.waitForTimeout(2500);
  check('F English import completes (banner offers last project)', await pageEn.getByRole('button', { name: /last project/i }).isVisible().catch(() => false));
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

console.log(`\nv098-phase34-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
