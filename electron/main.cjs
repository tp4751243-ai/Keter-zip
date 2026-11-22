/**
 * Keter Typesetter — Electron desktop shell.
 *
 * Loads the Vite production build (dist/index.html) from disk, so the app
 * runs as a real Windows program with no browser and no local web server.
 * In development (KETER_DEV=1) it loads the Vite dev server instead.
 *
 * Security: no Node integration in the renderer, context isolation on,
 * and only the small, explicit API in preload.cjs is exposed to the page.
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const isDev = process.env.KETER_DEV === '1';
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Keter Typesetter',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Open http(s) links in the user's browser instead of inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:3000').catch(() => {
      mainWindow.loadURL('http://localhost:3000');
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- File dialogs / saving (used by the app through window.keterDesktop) ---

ipcMain.handle('keter:save-file', async (_event, { defaultPath, data, encoding }) => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath });
  if (result.canceled || !result.filePath) return { canceled: true };
  const buffer = encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(String(data ?? ''), 'utf8');
  await fs.writeFile(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('keter:open-file', async (_event, { filters } = {}) => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const data = await fs.readFile(filePath);
  return { canceled: false, filePath, name: path.basename(filePath), data: data.toString('base64') };
});

// --- System font directory scan (v0.6.0 Part A — §1) ----------------------
// Read-only listing of the platform's well-known font folders. The
// renderer passes NO path (nothing arbitrary is ever read): the handler
// only ever looks in these fixed directories, only lists font files, and
// only returns family names parsed from each file's `name` table — never
// file contents, never a shell, never a path the page chose. A scanned
// font therefore renders on screen but still needs its TTF/OTF uploaded
// for PDF embedding (same honest limit as the Local Font Access scan).

function parseFontFamilyName(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // TrueType Collections ('ttcf') hold several fonts; use the first one.
  let base = 0;
  if (buffer.toString('ascii', 0, 4) === 'ttcf') {
    if (buffer.length < 16) return null;
    const numFonts = buffer.readUInt32BE(8);
    if (numFonts < 1) return null;
    base = buffer.readUInt32BE(12);
    if (base + 12 > buffer.length) return null;
  }
  const numTables = buffer.readUInt16BE(base + 4);
  let nameOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const off = base + 12 + i * 16;
    if (off + 16 > buffer.length) break;
    if (buffer.toString('ascii', off, off + 4) === 'name') {
      nameOffset = buffer.readUInt32BE(off + 8);
      break;
    }
  }
  if (nameOffset < 0 || nameOffset + 6 > buffer.length) return null;
  const format = buffer.readUInt16BE(nameOffset);
  if (format !== 0 && format !== 1) return null;
  const count = buffer.readUInt16BE(nameOffset + 2);
  const stringOffset = buffer.readUInt16BE(nameOffset + 4);
  const storageBase = nameOffset + stringOffset;
  const records = [];
  for (let i = 0; i < count; i++) {
    const rOff = nameOffset + 6 + i * 12;
    if (rOff + 12 > buffer.length) break;
    records.push({
      platformID: buffer.readUInt16BE(rOff),
      encodingID: buffer.readUInt16BE(rOff + 2),
      languageID: buffer.readUInt16BE(rOff + 4),
      nameID: buffer.readUInt16BE(rOff + 6),
      length: buffer.readUInt16BE(rOff + 8),
      offset: buffer.readUInt16BE(rOff + 10),
    });
  }
  const decode = rec => {
    const start = storageBase + rec.offset;
    const end = start + rec.length;
    if (start < 0 || end > buffer.length) return '';
    const slice = buffer.subarray(start, end);
    if (rec.platformID === 3 || rec.platformID === 0) {
      // UTF-16BE.
      let s = '';
      for (let j = 0; j + 1 < slice.length; j += 2) s += String.fromCharCode(slice.readUInt16BE(j));
      return s;
    }
    return slice.toString('latin1');
  };
  const pick = nameID => {
    const cands = records.filter(r => r.nameID === nameID);
    const pref =
      cands.find(r => r.platformID === 3 && r.encodingID === 1 && r.languageID === 0x409) ||
      cands.find(r => r.platformID === 3 && r.encodingID === 1) ||
      cands.find(r => r.platformID === 0) ||
      cands.find(r => r.platformID === 1) ||
      cands[0];
    return pref ? decode(pref).trim() : '';
  };
  const family = pick(16) || pick(1);
  if (!family) return null;
  return { family, fullName: pick(4) || family, postScriptName: pick(6) || '' };
}

/** Best-effort family name from a WOFF/WOFF2 file name (no name table). */
function familyFromFileName(fileName) {
  const base = fileName.replace(/\.[^/.]+$/, '');
  const cleaned = base
    .replace(/(Regular|Bold|Italic|Light|Medium|SemiBold|ExtraBold|Black|Thin|Oblique)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || base;
}

async function listSystemFontFiles() {
  const home = os.homedir();
  const winRoot = process.env.SystemRoot || 'C:\\Windows';
  const dirs =
    process.platform === 'win32'
      ? [
          path.join(winRoot, 'Fonts'),
          path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts'),
        ]
      : process.platform === 'darwin'
        ? ['/Library/Fonts', path.join(home, 'Library', 'Fonts'), '/System/Library/Fonts']
        : [
            '/usr/share/fonts',
            '/usr/local/share/fonts',
            path.join(home, '.fonts'),
            path.join(home, '.local', 'share', 'fonts'),
          ];
  const exts = new Set(['.ttf', '.otf', '.ttc', '.woff', '.woff2']);
  const out = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (out.length >= 3000) break;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (out.length >= 3000) break;
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!exts.has(ext)) continue;
      const key = ent.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const full = path.join(dir, ent.name);
      try {
        const stat = await fs.stat(full);
        if (!stat.isFile() || stat.size > 60 * 1024 * 1024) continue;
      } catch {
        continue;
      }
      if (ext === '.woff' || ext === '.woff2') {
        out.push({ family: familyFromFileName(ent.name), fileName: ent.name, format: ext.slice(1) });
        continue;
      }
      try {
        const buf = await fs.readFile(full);
        const parsed = parseFontFamilyName(buf);
        if (parsed) out.push({ ...parsed, fileName: ent.name, format: ext.slice(1) });
      } catch {
        // Unreadable or malformed font file — skip it, keep scanning.
      }
    }
  }
  return out;
}

ipcMain.handle('keter:list-system-fonts', async () => listSystemFontFiles());

// Print the current page to PDF using Electron's own Chromium (no extra
// Playwright/Chromium install needed in the packaged app).
ipcMain.handle('keter:print-pdf', async (_event, { defaultPath } = {}) => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'keter-page.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const data = await mainWindow.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
  await fs.writeFile(result.filePath, data);
  return { canceled: false, filePath: result.filePath };
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
