/**
 * Layout training T8 — fetch a prose sefer (Mesillat Yesharim, CC0
 * "Sefaria Vocalized Edition") for the brace-tag import + prose layout test.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/training/fetch-sefaria-prose.ts 1 2
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const clean = (s: string) => s.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim();

async function main() {
  const [from = '1', to = '2'] = process.argv.slice(2);
  const chapters = [];
  for (let ch = Number(from); ch <= Number(to); ch++) {
    const d = await (await fetch(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(`Mesillat Yesharim ${ch}`)}?version=hebrew|Sefaria Vocalized Edition`)).json();
    const v = d.versions[0];
    const raw: string[] = v.text.map((x: unknown) => String(x));
    // The first segment opens with the chapter subtitle in <b>…</b><br>.
    const m = /^<b>(.*?)<\/b>\s*<br\s*\/?>/.exec(raw[0]);
    const subtitle = m ? clean(m[1]) : '';
    if (m) raw[0] = raw[0].slice(m[0].length);
    chapters.push({ chapter: ch, subtitle, paragraphs: raw.map(clean).filter(Boolean), license: v.license, versionTitle: v.versionTitle });
    console.log(`ch ${ch}: "${subtitle}" ${raw.length} paragraphs (${v.license})`);
  }
  const out = { book: 'Mesillat Yesharim', bookHe: 'מסילת ישרים', source: 'https://www.sefaria.org', license: 'CC0 (Sefaria Vocalized Edition)', chapters };
  fs.writeFileSync(path.resolve('training/prose/mesillat-yesharim/corpus.json'), JSON.stringify(out, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
