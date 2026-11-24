/**
 * Layout training T6 — the Word-import auto-layout must not mistake a
 * Chumash for a Gemara (reported: Chumash + Rashi imported into a Mikraot
 * Gedolot book was "Laid out as Vilna Shas — Rashi detected").
 *   npx tsx scripts/training/import-classifier-test.ts
 */
import * as fs from 'node:fs';
import { classifyForImport, constrainDecisionToSeferType } from '../../src/engine/auto-layout';
import { seferTypeForRecipe } from '../../src/engine/sefer-type';
import type { ContentUnit, RavTextLink } from '../../src/types/typesetter';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};
const unit = (id: string, role: ContentUnit['role'], rawText: string, extra: Partial<ContentUnit> = {}) =>
  ({ id, role, rawText, styleName: role, order: 0, hierarchyLevel: 1, language: 'he', ...extra }) as ContentUnit;

const chumash = JSON.parse(fs.readFileSync('training/chumash/deuteronomy/corpus.json', 'utf8'));
const stripTeamim = (s: string) => s.replace(/[֑-֯]/g, '');
const stripAll = (s: string) => s.replace(/[֑-ׇ]/g, '');
function chumashUnits(mode: 'teamim' | 'nikkud' | 'plain'): { units: ContentUnit[]; links: RavTextLink[] } {
  const units: ContentUnit[] = [];
  const links: RavTextLink[] = [];
  const c = chumash.chapters[0];
  c.pesukim.slice(0, 12).forEach((p: string, i: number) => {
    const text = mode === 'teamim' ? p : mode === 'nikkud' ? stripTeamim(p) : stripAll(p);
    units.push(unit(`p${i}`, 'main_source', text));
    (c.rashi[i] ?? []).forEach((r: string, k: number) => {
      const dib = r.split('.')[0];
      units.push(unit(`r${i}-${k}`, 'primary_comment', r, { dibburHamatchil: dib, linkedSourceId: `p${i}`, styleName: 'רש"י' }));
      links.push({ linkId: `l${i}-${k}`, sourceUnitId: `p${i}`, commentaryUnitId: `r${i}-${k}`, dibburHamatchil: dib, isUserLocked: false, confidenceScore: 0.9, sourceSnippet: '', commentarySnippet: '', commentaryType: 'Rashi' });
    });
  });
  return { units, links };
}
const typeOf = (id: string) => seferTypeForRecipe(id);

for (const mode of ['teamim', 'nikkud'] as const) {
  const { units, links } = chumashUnits(mode);
  const d = classifyForImport(units, links, { fileName: 'import.docx' }).decision;
  check(`Chumash (${mode}) + Rashi is NOT laid out as a Gemara`, typeOf(d.recipeId) !== 'talmud', `${d.recipeId}: ${d.lineEn}`);
  check(`Chumash (${mode}) + Rashi is laid out as a Chumash`, typeOf(d.recipeId) === 'chumash', d.recipeId);
}
{
  const { units, links } = chumashUnits('plain');
  const d = classifyForImport(units, links, { fileName: 'Parashat_Chayei_Sara_Chumash.docx' }).decision;
  check('unvocalized Chumash + Rashi named Parashat_Chayei_Sara_Chumash → Chumash', typeOf(d.recipeId) === 'chumash', d.recipeId);
}

// A real Gemara stays a Gemara.
const berakhot = JSON.parse(fs.readFileSync('training/vilna/berakhot/corpus.json', 'utf8'));
{
  const units: ContentUnit[] = [];
  const a = berakhot.amudim[0];
  a.gemara.forEach((g: string, i: number) => {
    units.push(unit(`g${i}`, 'main_source', g));
    (a.rashi[i] ?? []).forEach((r: string, k: number) => units.push(unit(`r${i}-${k}`, 'primary_comment', r, { dibburHamatchil: r.split('–')[0], styleName: 'רש"י' })));
    (a.tosafot[i] ?? []).forEach((r: string, k: number) => units.push(unit(`t${i}-${k}`, 'secondary_comment', r, { dibburHamatchil: r.split('–')[0], styleName: 'תוספות' })));
  });
  const d = classifyForImport(units, [], { fileName: 'berakhot.docx' }).decision;
  check('Berakhot (Gemara + Rashi + Tosafot) is still laid out as a Gemara', typeOf(d.recipeId) === 'talmud', `${d.recipeId}: ${d.lineEn}`);
  // Imported while the home screen still had the Chumash card selected
  // (user report, T13): unmistakable Gemara — Tosafot + Gemara phrasing —
  // is laid out as a Gemara, not forced into the card's type.
  const info = classifyForImport(units, [], { fileName: 'berakhot.docx' });
  const kept = constrainDecisionToSeferType(info.decision, info.classification, 'chumash');
  check('clear Gemara imported with the Chumash card selected → Gemara', typeOf(kept.recipeId) === 'talmud', kept.lineEn);
}
{
  // Content WITHOUT clear evidence keeps the type the user chose.
  const units = ['והנה עיקר הדבר הוא', 'ועל כן יש לומר כך', 'וזה מה שאמרו חכמים'].map((t, i) => unit(`p${i}`, 'main_source', t.repeat(4)));
  const info = classifyForImport(units, [], { fileName: 'notes.docx' });
  const kept = constrainDecisionToSeferType(info.decision, info.classification, 'chumash');
  check('ambiguous text imported into a Chumash book keeps the Chumash type', typeOf(kept.recipeId) === 'chumash', `${kept.recipeId}: ${kept.lineEn}`);
  const free = constrainDecisionToSeferType(info.decision, info.classification, 'talmud');
  check('import into a Talmud (default) book lets the content decide', free.recipeId === info.decision.recipeId);
}

console.log(fails ? `${fails} FAILED` : 'all import-classifier checks pass');
process.exit(fails ? 1 : 0);
