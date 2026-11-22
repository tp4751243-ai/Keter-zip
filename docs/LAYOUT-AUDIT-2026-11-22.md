# Keter Typesetter — Layout Audit (v0.9.9)

**Date:** 2026-11-22
**Scope:** How close the auto-layout output is to real sefarim, judged against the user's training material:
- the annotated Vilna 2a page (`Untitled (2).png`, `123.png`)
- the Vilna Chagiga 2a/2b/3a/3b/4a scans
- the Shulchan Aruch / Magen Avraham page
- hebrewbooks title pages
- two professionally typeset reference books: *Ateres Tzvi* (ariach.com, vector) and *Tanya* (preview PDF)

**Method:**
1. Built `dist/` and drove the real app in headless Chromium.
2. Created a new **Shas** project with the built-in sample (Berakhot 2a) and a **Classic sefer** project with its sample.
3. Screenshotted the rendered pages.
4. Traced each rule into the code.

Screenshots are in `docs/audit/`.

> "Training" here means **encoding the rules of each traditional layout into the engine and checking the output against reference pages**. Nothing in the app learns from images. The plan at the end turns your annotated pages into rules, sample data and automatic checks.

---

## 1. Bottom line

The engine has the **plumbing** for most Vilna features: knees, inner/outer mirroring, gematria folios, the `גמ׳` marker, an opening-word frame, separators, chalon, and marginal slots. But the **default Shas project shows almost none of them**, and where they do appear they are often wrong. Side by side with a real daf (`docs/audit/vilna-2a-reference-vs-keter.png`), the Keter page does not yet read as a Vilna page.

The main problems:
1. **Missing:** no running header, no opening-word frame, and no side-margin apparatus (Ein Mishpat, Masoret HaShas, etc.).
2. **Proportions:** the type sizes and column proportions are far from the real page.
3. **Uneven text:** justification leaves huge word gaps in the Gemara.
4. **Commentary bottoms:** at the bottom, the commentaries merge into one full-width paragraph instead of each widening on its own side.
5. **Wrong headings and markers:** the `גמ׳` marker and the perek heading are in the wrong places.
6. **Thin sample:** the sample text is too short to test multi-page behaviour.

---

## 2. Vilna Shas — rule-by-rule (your annotated 2a page)

| # | Rule (from your annotations) | Keter today | Verdict |
|---|---|---|---|
| 1 | Running head: **perek name** (first 2 words of the perek) | No running head is drawn on the Shas sample. Instead `מסכת ברכות — פרק ראשון: מאימתי` is typeset as a **heading inside the Gemara column**. | ❌ Wrong place |
| 2 | Running head: **perek number in words** (ראשון, שני…) | Same as above: not in a header | ❌ |
| 3 | Running head: **masechta name** | Same | ❌ |
| 4 | Folio **ב. ב: ג. ג:** starting at daf ב, placed in the head on the outer corner | The logic exists (`computeTalmudDafAmud` and `formatBodyFolioLabel` in `vilna-shas.ts`, `pagination-engine.ts:679`) but **isn't printed on the page**. It shows only in the app's page navigator. | ⚠️ Computed, not drawn |
| 5 | **Rashi on the inner side** (by the binding), starting with dibbur hamatchil, same page as its Gemara | The mirroring rule is implemented and documented correctly (`vilna-shas.ts` header, `resolveLogicalSide`). Dibbur bold works. I didn't verify on the sample which column is Rashi. | ✅ Logic / ⚠️ unverified visually |
| 6 | **Tosafot on the outer side**, same page | Same as above | ✅ / ⚠️ |
| 7 | **Ornate frame around the first word** at the start of a masechta, with several frame designs to choose from | The code exists (`openingWordBox`, `ornament-library.ts:706`), but the preset ships it **off** (`vilna-preset.ts:199`, `enabled: false`). Nothing tells the engine to draw a large centred box holding **only the first word**. You flagged it as untrained, and that's confirmed. | ❌ Off / wrong model |
| 8 | **Chalon** (חלון) = indent on the **second row only**, offered as an option | **Two conflicting implementations:** `applyVilnaShasDefaults` sets `hangingIndentPt: 12`, which indents rows 2…n (`vilna-shas.ts:835`). The preset has a proper `chalon` setting but ships it as `mode: 'none'` (`vilna-preset.ts:222`). | ❌ Conflicting |
| 9 | **Side apparatus**: Ein Mishpat / Ner Mitzvah (outer), Masoret HaShas, Torah Or, Hagahot HaBach, Gilyon HaShas (inner), Rabbeinu Chananel (outer) | Slots are declared, but all of them render in **one shared "tertiary band below the knee"** (`vilna-shas.ts:851`, `pagination-engine.ts:159`), not as **narrow side columns**. Torah Or and Hagahot HaBach are set to `placement: 'below'` (`vilna-preset.ts:227,229`), but on the real page they are in the inner margin. The sample has no apparatus text at all. | ❌ Structurally wrong |
| 10 | **Amud bet (ב:) is a right-hand page**, so everything flips | The spread logic is right (`spreadSideForPageIndex`). But on the sample, 2b is **only Gemara set full-width** at the same large size, with ~60% of the page blank (`docs/audit/keter-2b.png`). | ⚠️ Logic OK, output poor |
| — | **Ornament between each meforash** in the margins (the small flourish above "מוסף רש״י", "תורה אור", "רבינו חננאל"…), plus the same option between paragraphs in other sefarim | The default commentary separator is `styleId: 'colon'` (`vilna-preset.ts:209`), not a flourish. There is no per-section **title + flourish** for the marginal commentaries. | ❌ |
| — | **`גמ׳`** after every Mishna, where the Gemara starts | The marker exists, but it is drawn at the **right edge of the first line of the unit** (`pagination-engine.ts:705`), not at the word where the Gemara begins. In the sample it lands in the middle of the Mishna (`גמ' שבאו בניו…`), and the text also contains a literal `גמרא:` later on, so the marker appears twice. | ❌ Misplaced |

### Other Vilna page problems (from the screenshot)

- **Gemara/commentary size ratio.** Gemara is 14.5 pt against 10.5 pt commentary, about 1.6×. Real Vilna is closer to 1.3–1.4×, and the Gemara column is much narrower and denser.
- **Justification rivers.** The Gemara lines hold 4–5 words with big gaps. Real Vilna fits 7–9 words a line with tight, even spacing.
- **Bottom of page.** Below the end of the Gemara, the Rashi and Tosafot text runs as **one full-width paragraph**. On a real daf, each commentary widens into its own half-width block on its own side, after the "knee".
- **Page not filled.** About 20% of 2a is blank at the bottom. The Torah Or references are set as Latin-numbered footnotes (`1. ויקרא כב, ז`) instead of the Torah Or margin column.
- **Margins.** The real daf runs almost edge to edge, with narrow margins and the marginal columns filling them. Keter's margins are wide and empty.

---

## 3. Classic single-column sefer (Tanya / Ateres Tzvi references)

Compared in `docs/audit/classic-reference-vs-keter.png`.

| Feature in the references | Keter "Classic" sample |
|---|---|
| Running head with book name, ornament ❦ and chapter (e.g. `תניא ❦ פרק ב`), plus a Hebrew folio in the outer corner | ❌ No running head, no folio |
| Dense body (~11–12 pt), full justification, 14–16 words a line | ❌ Very large type (~14.5 pt at this trim), 7–8 words a line |
| **Bold opening words** (פתיח) at each paragraph | ❌ None |
| **Chalon** second-row indent | ❌ None |
| Chapter breaks as **`—— ✻ פרק ב ✻ ——`** rules | ⚠️ A centred title is drawn, without the flanking ornamented rule |
| Footnotes with Hebrew letters | ❌ Latin `1.` `2.` |
| Pages filled to the bottom margin | ❌ About 35% blank |
| Layout name on the page | ⚠️ `טקסט רץ · טור יחיד` / `ש״ס וילנא · רב-טקסט` are drawn at the foot of the sheet. Check whether this leaks into the export. |

The Tanya and *Ateres Tzvi* references are good targets. They're consistent, and every feature above can be written as a rule.

---

## 4. Engine and export issues found along the way

1. **Exports guess word widths from character counts.** `pdf-exporter.ts:462, 499, 536, 734, 2776, 2867` and `idml-exporter.ts:1057, 1181` use `length × fontSize × 0.52`. This breaks invariant #3 in `ARCHITECTURE_AND_MILESTONE1.md` ("no naive metric estimates"). Canvas line-breaking measures real widths, but these export paths can drift away from what the screen shows.
2. **HarfBuzz isn't used for layout.** `harfbuzz-real-shaper.ts` is only used by an audit script. Layout uses Canvas `measureText` through `harfbuzz-emulator.ts`. That's acceptable for now, but the docs claim HarfBuzz shaping.
3. **The Vilna preset isn't applied when you pick the Shas archetype.** It only runs from a button deep in Design → גמרא ומפרשים → "החל תבנית וילנא קלאסית". Even then, it leaves the opening frame and chalon off.
4. **PageDown in the editor pushes a line to the next page.** I hit this by accident while navigating ("השורה נדחפה לעמוד הבא"). That's a dangerous shortcut.
5. **Stale smoke tests.** The Playwright smoke tests (e.g. `v098-phase56-playwright-smoke.mjs`) target old test ids (`new-project-form-home-wizard-…`) and fail on v0.9.9. Three `.ts` smoke scripts fail `tsc` because they import renamed functions.
6. **Dead weight.** About 18 MB of `backups/` plus `*.bak` files in `src/engine/` and `scripts/` add noise for anyone navigating the code.

---

## 5. Proposed "layout training" plan

The goal is to turn your annotated pages into **rules, sample data and automatic checks**, so every change can be measured against a real daf.

**Phase T1: Reference corpus and scoring harness**
- Add `training/vilna/`: real Chagiga 2a–4b (or Berakhot 2a–3b) text split into gemara / rashi / tosafot / ein-mishpat / masoret / torah-or / hagahot / rabbeinu-chananel `.docx` or JSON, with the matching scans.
- A headless script renders each daf and checks it mechanically, then writes a side-by-side PNG and a scorecard. Checks:
  - header present with perek, number, masechta and folio
  - Rashi inner, Tosafot outer
  - marginal columns present
  - frame around the first word on daf 2a
  - `גמ׳` placed at the boundary word
  - page fill ≥ 95%
  - word-gap spread within tolerance
  - Gemara : commentary size ratio within range
- Repeat the same harness for the classic single-column layout against the Tanya / *Ateres Tzvi* pages.

**Phase T2: Fix the Vilna page structure (by impact)**
1. Real **running head** (perek name, perek number, masechta, folio), mirrored per amud.
2. **Opening-word frame**: a large centred box holding only the first word, with 3–4 frame designs. On for the first daf of a masechta, and optionally at each perek.
3. **Marginal apparatus as side columns** in the outer and inner margins, each with a title and flourish, flowing top to bottom and mirrored per amud.
4. **Correct proportions**: Gemara/commentary size ratio, column widths and margins tuned against the scans.
5. **Bottom-of-page knee**: Rashi and Tosafot each widen on their own side under the Gemara, with no shared full-width paragraph.
6. **`גמ׳` at the boundary word**, with no duplicates.
7. **Chalon**: one implementation, second row only, user option.
8. Apply the whole Vilna preset automatically when the Shas archetype is chosen.

**Phase T3: Classic sefer quality**
- Running head with ornament, Hebrew folio, bold opening words, chalon, ornamented chapter rules, Hebrew-letter footnotes, filled pages, denser default size.
- Paragraph-ornament options shared with the Vilna marginal flourishes.

**Phase T4: Hygiene**
- Fix or remove the stale smoke tests.
- Move `backups/` and `*.bak` out of the tree.
- Replace character-count width guesses in the exporters with real measurements.
- Remove PageDown as the push-line shortcut.
