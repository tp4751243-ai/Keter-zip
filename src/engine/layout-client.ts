/**
 * Main-thread side of the background layout (see layout-worker.ts).
 *
 * T14 (performance):
 * - A POOL of workers (up to 4, one per spare core). A Talmud book laid
 *   out one amud per page is split into small consecutive shares of amudim;
 *   the workers lay them out at the same time, so a whole tractate takes
 *   a fraction of the time, and every share that completes in order is
 *   shown at once (`onProgress`) — the first pages appear in seconds.
 * - A share always goes to the same worker, whose per-amud cache then
 *   re-lays only the amudim an edit changed.
 * - Other books (one flowing stream) lay out in one worker, as before.
 * - The bundled faces and the user's fonts are sent to each worker as
 *   bytes (measurement must match the page exactly).
 * - A newer request supersedes an older one: the older one's remaining
 *   shares are never sent, and its results are ignored.
 * - The worker is bundled inline (a blob: worker), which also starts in
 *   the installed app, whose pages load from file://.
 * - When no worker can start, the promise rejects and the caller lays the
 *   book out on the main thread as before.
 */
import type { BookTypesetDocument } from '../types/typesetter';
import { splitTalmudIntoAmudim, type PaginationInput } from './pagination-engine';
import { isTalmudFolio } from './sefer-type';
import { KETER_EMBEDDED_FONTS, PdfNativeTextEngine } from './pdf-native-text-engine';
import { registeredFontBinaries } from './font-library';
import LayoutWorker from './layout-worker?worker&inline';

type FontMsg = { family: string; weight?: string; data: ArrayBuffer };

interface PoolWorker {
  w: Worker;
  ready: Promise<void>;
  /** id of the layout whose input this worker holds */
  inputId: number;
  busy: boolean;
}

let pool: PoolWorker[] = [];
let poolFontCount = -1;
let fontBytes: Promise<FontMsg[]> | null = null;
let nextId = 0;

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

function startWorker(): PoolWorker {
  const w = new LayoutWorker();
  const pw: PoolWorker = { w, ready: Promise.resolve(), inputId: -1, busy: false };
  pw.ready = (async () => {
    const fonts = await collectFonts();
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
  return pw;
}

function poolSize(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(4, cores - 1));
}

function ensurePool(size: number): PoolWorker[] {
  // a font the user added since the pool started: start fresh workers
  const userFonts = registeredFontBinaries().length;
  if (userFonts !== poolFontCount) {
    for (const p of pool) p.w.terminate();
    pool = [];
    poolFontCount = userFonts;
  }
  while (pool.length < size) pool.push(startWorker());
  return pool.slice(0, size);
}

/** Can layout run in the background here (a browser with workers and OffscreenCanvas)? */
export function backgroundLayoutAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof window !== 'undefined';
}

/** Join shares laid out separately into one book, pages in amud order. */
function joinShares(docs: BookTypesetDocument[]): BookTypesetDocument {
  const pages = docs.flatMap(d => d.pages).map((p, i) => ({ ...p, pageIndex: i, bodyPageIndex: i, physicalPageNumber: i + 1 }));
  return { ...docs[0], pages, totalPages: pages.length };
}

/** Send one message and wait for the worker's answer to it. */
function runOnWorker(pw: PoolWorker, msg: Record<string, unknown>, id: number): Promise<BookTypesetDocument> {
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m?.id !== id || m?.chunk !== msg.chunk) return;
      pw.w.removeEventListener('message', onMsg);
      pw.busy = false;
      if (m.type === 'done') resolve(m.doc as BookTypesetDocument);
      else reject(new Error(m.message));
    };
    pw.w.addEventListener('message', onMsg);
    pw.busy = true;
    pw.w.postMessage(msg);
  });
}

/**
 * Lay the book out in the background. `onProgress` receives the pages laid
 * out so far (in order) while a Talmud book is still being laid out.
 * Rejects with 'superseded' when a newer request arrives, or when no
 * worker can run.
 */
export async function layoutInBackground(
  input: PaginationInput,
  onProgress?: (partial: BookTypesetDocument) => void
): Promise<{ doc: BookTypesetDocument; ms: number }> {
  const id = ++nextId;
  const t0 = performance.now();
  const amudim =
    input.layoutType === 'rav_text' && isTalmudFolio(input.designSettings, input.layoutType)
      ? splitTalmudIntoAmudim(input.units)
      : null;
  const size = amudim ? poolSize() : 1;
  const workers = ensurePool(size);
  await Promise.all(workers.map(p => p.ready));
  if (id !== nextId) throw new Error('superseded');

  // each worker gets this layout's input once
  for (const pw of workers) {
    if (pw.inputId !== id) {
      pw.w.postMessage({ type: 'input', id, input });
      pw.inputId = id;
    }
  }

  if (!amudim) {
    const doc = await runOnWorker(workers[0], { type: 'layout', id, chunk: 0 }, id);
    if (id !== nextId) throw new Error('superseded');
    return { doc, ms: Math.round(performance.now() - t0) };
  }

  // Talmud: small consecutive shares (about 3 per worker, at most 8 amudim),
  // share i always on worker i % size (its cache knows those amudim).
  const keys = amudim.map(a => a.key);
  const per = Math.max(1, Math.min(8, Math.ceil(keys.length / (size * 3))));
  const shares: string[][] = [];
  for (let i = 0; i < keys.length; i += per) shares.push(keys.slice(i, i + per));
  const done: Array<BookTypesetDocument | undefined> = new Array(shares.length);
  let shown = 0;

  const runWorker = async (wi: number) => {
    for (let si = wi; si < shares.length; si += size) {
      if (id !== nextId) return; // superseded: send nothing more
      done[si] = await runOnWorker(workers[wi], { type: 'layout', id, chunk: si, amudSubset: shares[si] }, id);
      if (id !== nextId) return;
      // show every share that is complete from the start of the book
      let k = shown;
      while (k < shares.length && done[k]) k++;
      if (k > shown && k < shares.length && onProgress) {
        shown = k;
        onProgress(joinShares(done.slice(0, k) as BookTypesetDocument[]));
      } else if (k > shown) shown = k;
    }
  };
  await Promise.all(workers.map((_, wi) => runWorker(wi)));
  if (id !== nextId) throw new Error('superseded');
  return { doc: joinShares(done as BookTypesetDocument[]), ms: Math.round(performance.now() - t0) };
}
