/**
 * Layout training T2.2 — the Vilna opening frame (the ornamented box
 * around the first word of a masechta, rule 7 of the annotated daf).
 *
 * Measured on the Vilna reference PDFs in the training set (Berakhot 2a,
 * Chagiga 2a — scripts/training/measure_reference_pdf.py):
 *  - the frame sits at the TOP OF THE GEMARA COLUMN, centred on it;
 *    Rashi and Tosafot run beside it from the top of the page;
 *  - width ≈ 0.73 × the Gemara column, height ≈ 5.1 × the Gemara size;
 *  - the framed word is ≈ 2.4 × the Gemara size;
 *  - the Gemara text starts about one line below the frame;
 *  - the framed word (and a leading מתני׳ / גמ׳ marker) is NOT repeated
 *    in the running text — the text under the frame starts with the
 *    second word.
 */
import type { ContentUnit } from '../types/typesetter';

const MARKER = /^(?:מתני[׳']?|מתניתין|גמ[׳']?|גמרא)[:.]?$/;

export interface OpeningFrameGeometry {
  boxHeightPt: number;
  gapBelowPt: number;
  widthRatio: number;
  /** Height reserved at the top of the Gemara column on the frame's page. */
  reservePt: number;
}

export function openingFrameGeometry(gemaraSizePt: number): OpeningFrameGeometry {
  const boxHeightPt = Math.round(gemaraSizePt * 5.1 * 10) / 10;
  const gapBelowPt = Math.round(gemaraSizePt * 0.6 * 10) / 10;
  return { boxHeightPt, gapBelowPt, widthRatio: 0.73, reservePt: boxHeightPt + gapBelowPt + 2 };
}

export interface ExtractedOpeningWord {
  /** Units with the framed word(s) removed from the first Gemara unit. */
  units: ContentUnit[];
  /** The word(s) shown in the frame. */
  text: string;
  unitId: string;
}

/**
 * Take the first `wordCount` words of the first Gemara unit out of the
 * running text (skipping a leading מתני׳ / גמ׳ marker, which the frame
 * replaces). Returns null when there is no Gemara text.
 *
 * Only `rawText` (and `textRuns`, when present) of that one unit change;
 * the unit keeps its id, so links and anchors stay valid.
 */
export function extractOpeningWord(units: ContentUnit[], wordCount = 1): ExtractedOpeningWord | null {
  const idx = units.findIndex(u => u.role === 'main_source' && u.rawText.trim().length > 0);
  if (idx < 0) return null;
  const unit = units[idx];
  const tokens = unit.rawText.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && MARKER.test(tokens[i])) i++;
  const take = Math.max(1, Math.min(4, wordCount));
  const framed = tokens.slice(i, i + take);
  if (framed.length === 0) return null;
  const rest = tokens.slice(i + take).join(' ');
  const text = framed.map(w => w.replace(/[.,:;]+$/, '')).join(' ');

  const next: ContentUnit = { ...unit, rawText: rest };
  if (unit.textRuns && unit.textRuns.length > 0) {
    // Drop the same number of leading words from the runs.
    let toDrop = i + take;
    const runs = [];
    for (const r of unit.textRuns) {
      if (toDrop <= 0) {
        runs.push(r);
        continue;
      }
      const ws = r.text.trim().split(/\s+/).filter(Boolean);
      if (ws.length <= toDrop) {
        toDrop -= ws.length;
        continue;
      }
      runs.push({ ...r, text: ws.slice(toDrop).join(' ') + (r.text.endsWith(' ') ? ' ' : '') });
      toDrop = 0;
    }
    next.textRuns = runs;
  }
  const out = [...units];
  out[idx] = next;
  return { units: out, text, unitId: unit.id };
}
