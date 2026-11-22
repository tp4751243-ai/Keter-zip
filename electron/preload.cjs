/**
 * Keter Typesetter — preload bridge.
 * Exposes only a small, explicit desktop API to the React app as
 * window.keterDesktop. The page gets no direct Node / Electron access.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keterDesktop', {
  isDesktop: true,
  platform: process.platform,

  /** Save text (or base64 data) to a file the user picks. */
  saveFile: (options) => ipcRenderer.invoke('keter:save-file', options),

  /** Open a file the user picks; returns its contents as base64. */
  openFile: (options) => ipcRenderer.invoke('keter:open-file', options),

  /** Print the current page to a PDF the user picks. */
  printToPdf: (options) => ipcRenderer.invoke('keter:print-pdf', options || {}),

  /**
   * v0.6.0 Part A (§1) — list the family names of the fonts installed in
   * the system font directories (names only; no file contents). The main
   * process reads only the fixed well-known font folders and takes no
   * path from the page, so there is no arbitrary file access here.
   */
  listSystemFontFiles: () => ipcRenderer.invoke('keter:list-system-fonts'),
});
