/**
 * KETER-TYPE v0.9.2 Part C — Playwright client-render smoke (real Chromium).
 *
 * Run from the repo root (after `npm run build`):
 *   node scripts/v092c-playwright-smoke.mjs
 *
 * Regression for the user report of 2026-11-11 01:10 EST (installed
 * v0.9.1): "the edit text in place doesn't work" — the "Edit text in
 * place" button was visible but did nothing. Root cause (see PART-C.md):
 * two compounding faults in the activation/focus path — (1) the
 * `editingUnitId` sync effect in PageCanvas focused the hidden input
 * bridge 10ms after the button opened the editor, so the contenteditable
 * overlay blurred, committed unchanged, and closed ~10ms after opening;
 * (2) a mousedown on a word opened the editor, the overlay covered the
 * word, and the ensuing click was retargeted onto the page sheet, whose
 * empty-space handler exited editing + cleared the selection in the very
 * click that opened it (single-click and double-click alike).
 *
 *  Test A — button path: fresh blank project → Page design → click a
 *  word (editor opens) → Escape (closes, unit stays selected) → click
 *  "ערוך טקסט במקום" → the editor is open AND focused (contenteditable
 *  is document.activeElement) → type ZZZ → the editor text contains
 *  ZZZ → Escape commits → the on-page text contains ZZZ.
 *  Test B — double-click path: double-click a word → the editor opens
 *  → type WWW → Escape commits → the on-page text contains WWW.
 *  Test C — undo / redo: make an edit (QQQ via the button path), Ctrl+Z
 *  removes it from the page, Ctrl+Y brings it back.
 *  Test D — save / reload: after the Test C edit, reload and restore
 *  from autosave → the edited text is still on the page.
 *  Test E — empty-space click still clears: click a word (editor opens)
 *  → click the viewport margin outside the page sheet → the editor
 *  closes and the unit is deselected (the button disappears).
 *  Test F — mid-edit unit switch: type AAA into unit 1, then click a
 *  word in a different unit → the editor switches to that unit AND
 *  unit 1 keeps AAA (no silent loss of uncommitted keystrokes).
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

async function createBlankProject(page) {
  // v0.9.4 — the new-project form is inline on Home now (no modal to
  // open first): pick the blank starter in the inline form, then
  // create. (Role-based clicks: the form's option buttons contain
  // inner divs that intercept text-based clicks.)
  await page.getByRole('button', { name: 'מסמך חדש נקי (מוכן להקלדה / ייבוא וורד)' }).click();
  await page.getByRole('button', { name: 'צור פרויקט חדש ועבור לעריכה' }).click();
  await page.waitForTimeout(1500);
}
async function openPageDesign(page) {
  await page.getByText('עיצוב העמוד').first().click();
  await page.waitForTimeout(1200);
}
async function editorState(page) {
  return page.evaluate(() => {
    const ae = document.activeElement;
    const ed = document.querySelector('[data-keter-inline-editor]');
    return {
      editorVisible: !!ed,
      editorText: ed ? ed.textContent : null,
      activeIsEditor: !!ae && ae.isContentEditable && !!ae.getAttribute('data-keter-inline-editor'),
      activeTag: ae ? ae.tagName : 'none',
    };
  });
}
async function editButtonVisible(page) {
  const btn = page.getByText('ערוך טקסט במקום').first();
  return btn.isVisible().catch(() => false);
}
async function pageContains(page, text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}

const browser = await chromium.launch();
try {
  // ---------------------------------------------------------- Test A
  console.log('Test A — button path: click button → type → commit');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => { localStorage.setItem('keter-welcome-seen-v040', '1'); });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await createBlankProject(page);
    await openPageDesign(page);
    // Select a unit by clicking a word, then close the editor again so
    // the button path itself is what opens it.
    const word = page.locator('span.cursor-text').first();
    const box = await word.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    const s1 = await editorState(page);
    check('single click on a word opens the editor', s1.editorVisible);
    check('the editor is focused (contenteditable is activeElement)', s1.activeIsEditor, `active=${s1.activeTag}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check('Escape closes the editor', !(await editorState(page)).editorVisible);
    check('the unit stays selected (button still visible)', await editButtonVisible(page));
    // The reported path: the button.
    await page.getByText('ערוך טקסט במקום').first().click();
    await page.waitForTimeout(150);
    const s2 = await editorState(page);
    check('button opens the editor', s2.editorVisible);
    check('editor still open after the focus-steal window (+150ms)', s2.editorVisible);
    check('button path: the editor is focused', s2.activeIsEditor, `active=${s2.activeTag}`);
    await page.waitForTimeout(400);
    const s3 = await editorState(page);
    check('editor still open at +550ms (no 10ms blur-close)', s3.editorVisible && s3.activeIsEditor);
    await page.keyboard.type('ZZZ');
    await page.waitForTimeout(500);
    const s4 = await editorState(page);
    check('typing lands in the editor', !!s4.editorText && s4.editorText.includes('ZZZ'), `editor text tail: ${String(s4.editorText).slice(-20)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    check('Escape commits: the on-page text contains ZZZ', await pageContains(page, 'ZZZ'));
    check('no page errors (button path)', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test B
  console.log('Test B — double-click path');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => { localStorage.setItem('keter-welcome-seen-v040', '1'); });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await createBlankProject(page);
    await openPageDesign(page);
    const word = page.locator('span.cursor-text').first();
    const box = await word.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 });
    await page.waitForTimeout(500);
    const s = await editorState(page);
    check('double-click opens the editor', s.editorVisible);
    check('double-click: the editor is focused', s.activeIsEditor, `active=${s.activeTag}`);
    await page.keyboard.type('WWW');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    check('double-click edit commits: page contains WWW', await pageContains(page, 'WWW'));
    check('no page errors (double-click path)', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test C + D
  console.log('Test C — undo / redo; Test D — save / reload');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => { localStorage.setItem('keter-welcome-seen-v040', '1'); });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await createBlankProject(page);
    await openPageDesign(page);
    // Make an edit via the button path.
    const word = page.locator('span.cursor-text').first();
    const box = await word.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.getByText('ערוך טקסט במקום').first().click();
    await page.waitForTimeout(400);
    await page.keyboard.type('QQQ');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    check('edit committed: page contains QQQ', await pageContains(page, 'QQQ'));
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(900);
    check('Ctrl+Z undoes the edit: page no longer contains QQQ', !(await pageContains(page, 'QQQ')));
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(900);
    check('Ctrl+Y redoes the edit: page contains QQQ again', await pageContains(page, 'QQQ'));
    // Test D — reload and restore from autosave.
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.getByText('שחזר כעת ועבור לעריכה').first().click();
    await page.waitForTimeout(1500);
    check('reload + restore: the edit survives (page contains QQQ)', await pageContains(page, 'QQQ'));
    check('no page errors (undo/redo/reload)', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test E
  console.log('Test E — empty-space click still clears selection/editing');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => { localStorage.setItem('keter-welcome-seen-v040', '1'); });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await createBlankProject(page);
    await openPageDesign(page);
    const word = page.locator('span.cursor-text').first();
    const box = await word.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    check('editor opens before the empty-space click', (await editorState(page)).editorVisible);
    check('button visible before the empty-space click', await editButtonVisible(page));
    // Click the viewport margin right of the page sheet (grey area).
    await page.mouse.click(1300, 500);
    await page.waitForTimeout(500);
    check('empty-space click closes the editor', !(await editorState(page)).editorVisible);
    check('empty-space click deselects the unit (button hidden)', !(await editButtonVisible(page)));
    check('no page errors (empty-space click)', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------- Test F
  console.log('Test F — mid-edit unit switch keeps the first unit\'s text');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => { localStorage.setItem('keter-welcome-seen-v040', '1'); });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await createBlankProject(page);
    await openPageDesign(page);
    const words = page.locator('span.cursor-text');
    const count = await words.count();
    check('page has word spans to click', count > 5, `count=${count}`);
    // Unit 1: the first word on the page.
    const first = words.first();
    const firstBox = await first.boundingBox();
    await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.waitForTimeout(400);
    const unit1Text = (await editorState(page)).editorText;
    check('editor opens on unit 1', !!unit1Text);
    await page.keyboard.type('AAA');
    await page.waitForTimeout(400);
    // A word in a different unit: the bottom-most word on the page.
    let bottomIdx = 0;
    let bottomY = -1;
    for (let i = 0; i < count; i++) {
      const b = await words.nth(i).boundingBox();
      if (b && b.y > bottomY) { bottomY = b.y; bottomIdx = i; }
    }
    const bottom = words.nth(bottomIdx);
    const bottomBox = await bottom.boundingBox();
    await page.mouse.click(bottomBox.x + bottomBox.width / 2, bottomBox.y + bottomBox.height / 2);
    await page.waitForTimeout(700);
    const s = await editorState(page);
    check('editor stays open after switching units', s.editorVisible);
    check('editor switched to a different unit', !!s.editorText && s.editorText !== unit1Text, `switched text head: ${String(s.editorText).slice(0, 30)}`);
    check('unit 1 keeps the uncommitted AAA (no silent loss)', await pageContains(page, 'AAA'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    check('unit 1 still has AAA after closing the editor', await pageContains(page, 'AAA'));
    check('no page errors (unit switch)', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\nv092c-playwright-smoke: ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
