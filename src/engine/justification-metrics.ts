/**
 * Layout training T10 — how even is the justification? Word gaps of the
 * JUSTIFIED lines as drawn by the print plan, in ems of the line's size.
 * Each line contributes its widest gap (the white the eye sees first).
 */
import type { PageTypesetResult } from '../types/typesetter';
import { PdfExporter } from './pdf-exporter';

export interface GapStats {
  lines: number;
  median: number;
  p95: number;
  max: number;
}

export function justificationGaps(pages: PageTypesetResult[], roles?: Set<string>): GapStats {
  const per: number[] = [];
  for (const p of pages) {
    for (const lc of PdfExporter.buildPageRenderPlan(p).lines) {
      if (!lc.isJustified || lc.isLastLine || (roles && !roles.has(lc.role))) continue;
      const ws = [...(lc.words ?? [])].sort((a, b) => b.xRight - a.xRight);
      if (ws.length < 3) continue;
      let worst = 0;
      for (let k = 1; k < ws.length; k++) worst = Math.max(worst, (ws[k - 1].xLeft - ws[k].xRight) / (lc.fontSizePt || 12));
      per.push(worst);
    }
  }
  per.sort((a, b) => a - b);
  const q = (f: number) => (per.length ? per[Math.min(per.length - 1, Math.floor(f * (per.length - 1)))] : 0);
  return { lines: per.length, median: q(0.5), p95: q(0.95), max: per.length ? per[per.length - 1] : 0 };
}
