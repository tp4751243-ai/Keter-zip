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

import { PaginationEngine, clearAmudLayoutCache, type PaginationInput } from './pagination-engine';
import type { BookTypesetDocument } from '../types/typesetter';
import { HarfBuzzShaperEngine } from './harfbuzz-emulator';
import { clearInkCache } from './ink-clearance';

type InMessage =
  | { type: 'fonts'; fonts: Array<{ family: string; weight?: string; data: ArrayBuffer }> }
  | { type: 'input'; id: number; input: PaginationInput }
  | { type: 'layout'; id: number; chunk?: number; amudSubset?: string[]; input?: PaginationInput };

// the book of the latest layout request (sent once; shares refer to it)
let currentInput: { id: number; input: PaginationInput } | null = null;

const scope = self as unknown as DedicatedWorkerGlobalScope & { fonts: FontFaceSet };

/**
 * T14 (performance) — the same word in the same style has the same glyph
 * records wherever it occurs; they were sent (and kept) once per
 * occurrence — most of a laid-out book's size (a tractate: ~250 MB, and
 * copying it to the window stalled the window for 1–2 s). Equal glyph
 * arrays now share one array; the copy to the window keeps the sharing.
 * Glyph records are never changed after shaping.
 */
function shareGlyphArrays(doc: BookTypesetDocument): void {
  const seen = new Map<string, unknown>();
  for (const pg of doc.pages) {
    for (const ls of [pg.sourceLines, pg.rashiLines, pg.tosafotLines, pg.footnoteLines, pg.tertiaryLines, pg.sideNoteLines, pg.column2Lines, pg.marginLines]) {
      if (!ls) continue;
      for (const l of ls) {
        for (const w of l.words) {
          if (!w.glyphs || w.glyphs.length === 0) continue;
          const key = JSON.stringify(w.glyphs);
          const prev = seen.get(key);
          if (prev) (w as { glyphs: unknown }).glyphs = prev;
          else seen.set(key, w.glyphs);
        }
      }
    }
  }
}

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
    clearAmudLayoutCache();
    scope.postMessage({ type: 'fonts-ready' });
    return;
  }
  if (msg.type === 'input') {
    currentInput = { id: msg.id, input: msg.input };
    return;
  }
  if (msg.type === 'layout') {
    const t0 = performance.now();
    try {
      const base = msg.input ?? (currentInput && currentInput.id === msg.id ? currentInput.input : null);
      if (!base) throw new Error('layout worker: no book for this request');
      const doc = PaginationEngine.paginateDocument(msg.amudSubset ? { ...base, amudSubset: msg.amudSubset } : base);
      shareGlyphArrays(doc);
      scope.postMessage({ type: 'done', id: msg.id, chunk: msg.chunk, doc, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      scope.postMessage({ type: 'error', id: msg.id, chunk: msg.chunk, message: String((err as Error)?.message ?? err) });
    }
  }
};
