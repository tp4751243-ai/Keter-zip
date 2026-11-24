/**
 * Main-thread side of the background layout (see layout-worker.ts).
 *
 * - One worker; the bundled faces and the user's fonts are sent to it as
 *   bytes once (and again when the user adds a font).
 * - A request supersedes the one before it: if the worker is still busy
 *   with an older version of the book, that worker is ended and a fresh
 *   one starts on the new version (an old layout is never waited for).
 * - The worker is bundled inline (a blob: worker), which also starts in
 *   the installed app, whose pages load from file://.
 * - When a worker cannot start, `request` rejects and the caller lays
 *   the book out on the main thread as before.
 */
import type { BookTypesetDocument } from '../types/typesetter';
import type { PaginationInput } from './pagination-engine';
import { KETER_EMBEDDED_FONTS, PdfNativeTextEngine } from './pdf-native-text-engine';
import { registeredFontBinaries } from './font-library';
import LayoutWorker from './layout-worker?worker&inline';

type FontMsg = { family: string; weight?: string; data: ArrayBuffer };

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let busyId = 0;
let nextId = 0;
let fontBytes: Promise<FontMsg[]> | null = null;
let userFontCount = -1;

async function collectFonts(): Promise<FontMsg[]> {
  if (!fontBytes) {
    fontBytes = Promise.all(
      KETER_EMBEDDED_FONTS.map(async (spec): Promise<FontMsg | null> => {
        const data = await PdfNativeTextEngine.loadPublicBinary(spec.publicPath);
        return data ? { family: spec.fontFamily, weight: spec.fontStyle === 'bold' ? '700' : '400', data } : null;
      })
    ).then(list => list.filter((f): f is FontMsg => f !== null));
  }
  const bundled = await fontBytes;
  return [...bundled.map(f => ({ ...f, data: f.data.slice(0) })), ...registeredFontBinaries()];
}

function startWorker(): Promise<void> {
  worker = new LayoutWorker();
  const w = worker;
  workerReady = (async () => {
    const fonts = await collectFonts();
    userFontCount = registeredFontBinaries().length;
    await new Promise<void>((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'fonts-ready') {
          w.removeEventListener('message', onMsg);
          resolve();
        }
      };
      w.addEventListener('message', onMsg);
      w.addEventListener('error', ev => reject(new Error(ev.message || 'layout worker failed')), { once: true });
      w.postMessage({ type: 'fonts', fonts }, fonts.map(f => f.data));
    });
  })();
  return workerReady;
}

/** Can layout run in the background here (a browser with workers and OffscreenCanvas)? */
export function backgroundLayoutAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof window !== 'undefined';
}

/** Lay the book out in the background. Rejects if superseded or if no worker can run. */
export async function layoutInBackground(input: PaginationInput): Promise<{ doc: BookTypesetDocument; ms: number }> {
  const id = ++nextId;
  // An older layout still running is no longer wanted: end that worker.
  // A font the user added since the worker started: start a fresh one.
  if (worker && (busyId !== 0 || registeredFontBinaries().length !== userFontCount)) {
    worker.terminate();
    worker = null;
  }
  if (!worker) await startWorker();
  else await workerReady;
  if (id !== nextId) throw new Error('superseded');
  const w = worker!;
  busyId = id;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m?.id !== id) return;
      w.removeEventListener('message', onMsg);
      busyId = 0;
      if (m.type === 'done') resolve({ doc: m.doc as BookTypesetDocument, ms: m.ms });
      else reject(new Error(m.message));
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'layout', id, input });
  });
}
