# Layout training

"Training" in Keter means turning real reference pages into **rules,
reference text and automatic checks**. Every layout change is measured
against a real page. Nothing in the app learns from images.

## Vilna Shas

| Path | What it is |
|---|---|
| `vilna/<tractate>/corpus.json` | Reference text fetched from Sefaria (Gemara, Rashi, Tosafot, Gilyon HaShas, plus Ein Mishpat / Torah Or refs derived from Sefaria links). See `licenses` inside the file. |
| `vilna/<tractate>/baseline-<profile>.md` | Scorecard committed as a reference point. Compare new runs against it. |
| `out/` | Harness output: rendered pages + scorecards. Git-ignored. |

### Fetch a corpus (needs network access to www.sefaria.org)

```bash
NODE_USE_ENV_PROXY=1 npx tsx scripts/training/fetch-sefaria-vilna.ts Berakhot 2a 3b
```

### Score the engine

```bash
npx tsx scripts/training/vilna-harness.ts berakhot
```

Options:
- `--profile recipe|rav_text|all`
  - `recipe` is what the Shas wizard and DOCX import produce.
  - `rav_text` is the built-in sample path.
- `--ref <dir>` puts reference scans (`2a.png`, `2b.png` …) next to each rendered page.
- `--min-score N` exits 1 below N, so the harness can act as a CI gate.

### Rules scored

Rules come from the annotated Vilna pages:

| Rule | What is checked |
|---|---|
| D1 | Density: page count compared with the Vilna page count |
| H1 | Running head: perek name + `פרק N` + masechta |
| H2 | Folio (`ב.` / `ב:`) on the outer corner |
| F1 / F2 | Opening-word frame on the first daf only: correct word, tall enough, centred, word not repeated, no overlap |
| R1 | Rashi inner, Tosafot outer, mirrored per amud |
| M1 | Marginal apparatus drawn as side columns |
| L1 | Gemara / commentary size ratio |
| L2 | Even justification |
| P1 | Page filled to the bottom margin |
| P2 | No overlapping lines, nothing off the page |
| T1 / A1 | Info only: `גמ׳` markers, amud alignment |
