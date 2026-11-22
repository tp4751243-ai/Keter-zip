/**
 * Layout training — fetch a Vilna Shas reference corpus from Sefaria.
 *
 * Run (needs network access to www.sefaria.org; Node's fetch reads the
 * proxy only with NODE_USE_ENV_PROXY=1):
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/training/fetch-sefaria-vilna.ts Berakhot 2a 3b
 *
 * Writes training/vilna/<tractate>/corpus.json. The harness
 * (scripts/training/vilna-harness.ts) reads only that file, so it runs
 * offline once the corpus is committed.
 *
 * Streams and where they come from:
 *  - gemara       — "Wikisource Talmud Bavli" (unvocalized, Vilna wording), CC-BY-SA
 *  - rashi        — "Rashi on <T>",   Vilna Edition, public domain
 *  - tosafot      — "Tosafot on <T>", Vilna Edition, public domain
 *  - gilyon       — "Gilyon HaShas on <T>", Vilna Edition, public domain
 *  - einMishpat   — DERIVED: Sefaria links typed "ein mishpat / ner mitsvah"
 *                   (the real references, but not the printed wording)
 *  - torahOr      — DERIVED: Sefaria Tanakh links anchored to one segment
 *                   (the cited verse refs, not the printed wording)
 * Masoret HaShas / Hagahot HaBach are not on Sefaria for the Bavli.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const API = 'https://www.sefaria.org';

interface AmudCorpus {
  ref: string;            // e.g. "Berakhot 2a"
  daf: number;            // 2
  amud: 'a' | 'b';
  gemara: string[];       // Sefaria segments (1-based index = segment number)
  rashi: string[][];      // rashi[segIdx] = comments anchored to that segment
  tosafot: string[][];
  gilyon: string[];       // flat (no segment anchor on Sefaria)
  einMishpat: Array<{ segment: number; refHe: string; ref: string }>;
  torahOr: Array<{ segment: number; refHe: string; ref: string }>;
}

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

/** Sefaria HTML → plain text (keeps Hebrew punctuation, drops tags/entities). */
function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function text(ref: string, version?: string): Promise<unknown[]> {
  const v = version ? `hebrew|${encodeURIComponent(version)}` : 'hebrew';
  const d = await getJson(`${API}/api/v3/texts/${encodeURIComponent(ref)}?version=${v}`);
  const t = d?.versions?.[0]?.text;
  return Array.isArray(t) ? t : [];
}

function segmentOf(anchorRef: string): number | null {
  const m = /:(\d+)$/.exec(anchorRef ?? '');
  return m ? Number(m[1]) : null;
}

async function fetchAmud(tractate: string, daf: number, amud: 'a' | 'b'): Promise<AmudCorpus> {
  const ref = `${tractate} ${daf}${amud}`;
  const gemara = (await text(ref, 'Wikisource Talmud Bavli')).map(s => clean(String(s)));
  const nested = (raw: unknown[]) =>
    gemara.map((_, i) => (Array.isArray(raw[i]) ? (raw[i] as unknown[]).map(s => clean(String(s))).filter(Boolean) : []));
  const rashi = nested(await text(`Rashi on ${ref}`));
  const tosafot = nested(await text(`Tosafot on ${ref}`));
  const gilyon = (await text(`Gilyon HaShas on ${ref}`)).flat().map(s => clean(String(s))).filter(Boolean);

  const related = await getJson(`${API}/api/related/${encodeURIComponent(ref)}`);
  const links: any[] = related?.links ?? [];
  const einMishpat: AmudCorpus['einMishpat'] = [];
  const torahOr: AmudCorpus['torahOr'] = [];
  const seen = new Set<string>();
  for (const l of links) {
    const seg = segmentOf(l.anchorRef);
    if (seg === null) continue; // range anchors are too loose to place
    const key = `${l.category}|${seg}|${l.sourceRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (l.category === 'Halakhah' && String(l.type ?? '').includes('ein mishpat')) {
      einMishpat.push({ segment: seg, refHe: clean(l.sourceHeRef ?? ''), ref: l.sourceRef });
    } else if (l.category === 'Tanakh') {
      torahOr.push({ segment: seg, refHe: clean(l.sourceHeRef ?? ''), ref: l.sourceRef });
    }
  }
  einMishpat.sort((a, b) => a.segment - b.segment);
  torahOr.sort((a, b) => a.segment - b.segment);
  return { ref, daf, amud, gemara, rashi, tosafot, gilyon, einMishpat, torahOr };
}

function parseAmud(s: string): { daf: number; amud: 'a' | 'b' } {
  const m = /^(\d+)([ab])$/.exec(s);
  if (!m) throw new Error(`bad amud "${s}" (expected e.g. 2a)`);
  return { daf: Number(m[1]), amud: m[2] as 'a' | 'b' };
}

async function main() {
  const [tractate = 'Berakhot', from = '2a', to = '3b'] = process.argv.slice(2);
  const start = parseAmud(from);
  const end = parseAmud(to);

  const index = await getJson(`${API}/api/v2/raw/index/${encodeURIComponent(tractate)}`);
  const heTitle: string =
    index?.heTitle ??
    (index?.schema?.titles ?? []).find((t: any) => t.lang === 'he' && t.primary)?.text ??
    tractate;
  const chapters = (index?.alt_structs?.Chapters?.nodes ?? []).map((n: any, i: number) => ({
    number: n.numeric_equivalent ?? i + 1,
    nameHe: (n.titles ?? []).find((t: any) => t.lang === 'he' && t.primary)?.text ?? '',
    wholeRef: n.wholeRef as string,
  }));

  const amudim: AmudCorpus[] = [];
  for (let daf = start.daf; daf <= end.daf; daf++) {
    for (const amud of ['a', 'b'] as const) {
      if (daf === start.daf && amud < start.amud) continue;
      if (daf === end.daf && amud > end.amud) continue;
      process.stdout.write(`fetching ${tractate} ${daf}${amud} … `);
      const a = await fetchAmud(tractate, daf, amud);
      console.log(
        `gemara ${a.gemara.length} seg, rashi ${a.rashi.flat().length}, tosafot ${a.tosafot.flat().length}, ` +
          `gilyon ${a.gilyon.length}, einMishpat ${a.einMishpat.length}, torahOr ${a.torahOr.length}`
      );
      amudim.push(a);
    }
  }

  const out = {
    tractate,
    tractateHe: heTitle,
    fetchedAt: new Date().toISOString(),
    source: 'https://www.sefaria.org',
    licenses: {
      gemara: 'Wikisource Talmud Bavli — CC-BY-SA (via Sefaria)',
      rashi: 'Vilna Edition — Public Domain (via Sefaria)',
      tosafot: 'Vilna Edition — Public Domain (via Sefaria)',
      gilyon: 'Vilna Edition — Public Domain (via Sefaria)',
      einMishpat: 'Derived from Sefaria link data (ein mishpat / ner mitsvah)',
      torahOr: 'Derived from Sefaria Tanakh link data',
    },
    chapters,
    amudim,
  };
  const dir = path.resolve('training', 'vilna', tractate.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'corpus.json'), JSON.stringify(out, null, 1));
  console.log(`wrote ${path.join(dir, 'corpus.json')}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
