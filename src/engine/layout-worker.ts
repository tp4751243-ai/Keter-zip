/// <reference lib="webworker" />
/**
 * Background layout. The whole-book layout (PaginationEngine) runs here,
 * off the main thread, so the window never freezes — a whole Shas
 * tractate takes about a minute to lay out, and every edit re-lays the
 * book out.
 *
 * Measurement must match the main thread exactly, so the worker measures
 * with an OffscreenCanvas and the SAME font files (sent as bytes by the
 * app: the bundled faces and every font the user added).
 *
 * Messages in:  { type: 'fonts', fonts: [{ family, weight, data }] }
 *               { type: 'layout', id, input }
 * Messages out: { type: 'fonts-ready' }
 *               { type: 'done', id, doc, ms } | { type: 'error', id, message }
 */

// The engine creates measuring canvases through document.createElement:
// in a worker that is an OffscreenCanvas (same text engine, same fonts).
(self as unknown as { document: unknown }).document = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`layout worker: no <${tag}> element`);
    const c = new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement & { style: Record<string, string> };
    (c as unknown as { style: Record<string, string> }).style = {};
    (c as unknown as { setAttribute: () => void }).setAttribute = () => {};
    return c;
  },
  baseURI: self.location?.href ?? '',
};

import { PaginationEngine, type PaginationInput } from './pagination-engine';
import { HarfBuzzShaperEngine } from './harfbuzz-emulator';
import { clearInkCache } from './ink-clearance';

type InMessage =
  | { type: 'fonts'; fonts: Array<{ family: string; weight?: string; data: ArrayBuffer }> }
  | { type: 'layout'; id: number; input: PaginationInput };

const scope = self as unknown as DedicatedWorkerGlobalScope & { fonts: FontFaceSet };

scope.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.type === 'fonts') {
    for (const f of msg.fonts) {
      try {
        const face = new FontFace(f.family, f.data, f.weight ? { weight: f.weight } : undefined);
        await face.load();
        scope.fonts.add(face);
      } catch {
        // a face that cannot load is measured in a fallback, as on screen
      }
    }
    HarfBuzzShaperEngine.clearMetricCache();
    clearInkCache();
    scope.postMessage({ type: 'fonts-ready' });
    return;
  }
  if (msg.type === 'layout') {
    const t0 = performance.now();
    try {
      const doc = PaginationEngine.paginateDocument(msg.input);
      scope.postMessage({ type: 'done', id: msg.id, doc, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      scope.postMessage({ type: 'error', id: msg.id, message: String((err as Error)?.message ?? err) });
    }
  }
};
