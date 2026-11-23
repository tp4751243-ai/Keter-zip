/**
 * Layout training T6 — fetch a Chumash / Mikraot Gedolot reference corpus.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/training/fetch-sefaria-chumash.ts Deuteronomy 1 2
 *
 * Writes training/chumash/<book>/corpus.json. Versions are chosen for a
 * commercial product (public domain only):
 *  - pasuk   — "Tanach with Ta'amei Hamikra" (nikkud + teamim), Public Domain
 *  - onkelos — "Onkelos <Book>", Public Domain
 *  - rashi   — Rosenbaum & Silbermann Rashi (1929–34), Public Domain
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const API = 'https://www.sefaria.org';

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch {
      /* retry */
    }
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error(`fetch failed: ${url}`);
}

const clean = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();

async function text(ref: string, version: string): Promise<unknown[]> {
  const d = await getJson(`${API}/api/v3/texts/${encodeURIComponent(ref)}?version=hebrew|${encodeURIComponent(version)}`);
  const t = d?.versions?.[0]?.text;
  return Array.isArray(t) ? t : [];
}

async function main() {
  const [book = 'Deuteronomy', from = '1', to = '1'] = process.argv.slice(2);
  const index = await getJson(`${API}/api/v2/raw/index/${encodeURIComponent(book)}`);
  const bookHe: string =
    (index?.schema?.titles ?? []).find((t: any) => t.lang === 'he' && t.primary)?.text ?? book;
  const chapters = [];
  for (let ch = Number(from); ch <= Number(to); ch++) {
    const ref = `${book} ${ch}`;
    const pesukim = (await text(ref, "Tanach with Ta'amei Hamikra")).map(s => clean(String(s)));
    const onkelos = (await text(`Onkelos ${ref}`, `Onkelos ${book}`)).map(s => clean(String(s)));
    const rashiRaw = await text(`Rashi on ${ref}`, 'Pentateuch with Rashi\'s commentary by M. Rosenbaum and A.M. Silbermann, 1929-1934');
    const rashi = pesukim.map((_, i) =>
      Array.isArray(rashiRaw[i]) ? (rashiRaw[i] as unknown[]).map(s => clean(String(s))).filter(Boolean) : []
    );
    console.log(`${ref}: ${pesukim.length} pesukim, ${onkelos.length} onkelos, ${rashi.flat().length} rashi`);
    chapters.push({ chapter: ch, pesukim, onkelos, rashi });
  }
  const out = {
    book,
    bookHe,
    source: 'https://www.sefaria.org',
    licenses: {
      pesukim: "Tanach with Ta'amei Hamikra — Public Domain (via Sefaria)",
      onkelos: 'Onkelos — Public Domain (via Sefaria)',
      rashi: 'Rashi, Rosenbaum & Silbermann 1929–1934 — Public Domain (via Sefaria)',
    },
    chapters,
  };
  const dir = path.resolve('training', 'chumash', book.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'corpus.json'), JSON.stringify(out, null, 1));
  console.log(`wrote ${path.join(dir, 'corpus.json')}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
