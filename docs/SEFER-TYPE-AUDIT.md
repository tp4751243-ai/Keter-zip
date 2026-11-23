# Sefer-type rules audit (v0.10.4–v0.10.5)

**Problem reported:** choosing Mikraot Gedolot (or any non-Talmud sefer) applied rules that belong only to a Gemara page.

**Method:** `scripts/training/sefer-type-audit.ts` builds every sefer type through the app's three real entry paths and checks the typeset pages:

| Path | What it simulates |
|---|---|
| **sample** | A new book of each layout type, opened with its built-in sample |
| **recipe** | Each of the 29 historical designs, applied as the wizard / Word import applies them |
| **switch** | A Shas book whose layout is then switched in the header |

**Before the fix: 11 of 40 clean. After: 40 of 40 clean.** The audit now runs in CI and blocks the Windows installer build if anything regresses.

## What was wrong

1. **Settings were one bag of switches, never reset when the type changed.** The wizard starts every book from a Shas setup, and a layout switch only changed the layout name. So a Chumash, Mishnah, Shulchan Aruch, Tur, Siddur, Tanya … kept:
   - daf folios `ב.` / `ב:`
   - the Vilna running head (perek / masechta)
   - the masechta opening frame

   Affected: 26 recipes and all 5 layout switches.
2. **No engine-level guard.** Talmud features ran whenever a setting said so.
   - Mikraot Gedolot shares the Talmud paginator, so it also numbered its first page **2** (daf ב).
3. **The `גמ׳` marker detection ran on non-Talmud text.** Tz'ena Ur'ena got a `גמ׳` marker.
4. **The Vilna folio page size (240×340 mm) stayed** after switching a Shas book to another layout.

## The fix: sefer-type profiles (`src/engine/sefer-type.ts`)

Every book has a `pageLayout.seferType`. It is set on every path that changes the type:
- new book
- layout switch
- recipe, archetype or Word auto-layout

Applying a type switches **every** type-specific rule explicitly:

| Rule | Talmud | Chumash | Mishnah | Halacha | Siddur | Yiddish | Prose |
|---|---|---|---|---|---|---|---|
| Folios | daf/amud `ב.` `ב:` from daf ב | page א… | page א… | page א… | page (digits by design) | page (digits by design) | page א… |
| Vilna running head (perek · masechta) | ✅ | — | — | — | — | — | — |
| Masechta opening frame | ✅ | — | — | — | — | — | — |
| `גמ׳` Mishna→Gemara marker | ✅ | — | — | — | — | — | — |
| Ein Mishpat / Masoret HaShas side columns | ✅ | — | — | — | — | — | — |
| Michtav strip | off | off | off | off | off | off | off |
| Vilna folio page inherited from a Shas book | kept | reset to the book page | reset | reset | reset | reset | reset |

Second layer: every Talmud-only engine feature checks `isTalmudFolio()` itself, so a setting left over in an old or hand-edited project cannot leak. A project saved before types existed is treated as Talmud only on the `rav_text` layout.

Rules shared on purpose (not leaks):
- **Rashi / commentary flanking:** used by both the Talmud page and Mikraot Gedolot.
- **Large folio page:** chosen by the Mikraot Gedolot, Shulchan Aruch, Tur, Rambam and Mishnah Berurah designs, matching their printed size.
- **Measured page planner:** applies to every multi-stream page.

## Entry points routed through the same applier (v0.10.5)

- **Recipe picker in the header and Design panel.** It applied recipes by a separate route that skipped the sefer type and the Vilna knee routing. It now goes through `applyRecipeToSettingsById`, like the wizard and Word import.
- **"Apply Vilna rules" and "Vilna classic preset" buttons.** Both now mark the book as Talmud explicitly.
- **New "סוג הספר / Sefer type" selector** at the top of Design → page tab. It shows the current type, and changing it applies that type's rules.

## Positive checks (each type keeps its own rules)

- **Talmud (`rav_text`):** every page has daf folios and the Vilna head, and page 1 has the opening frame.
- **Every other type:** page one is numbered 1 (`א`, or `1` where the design uses digits). No text is lost (≥ 90% of words placed), and there are no empty pages.

The Vilna scorecard is unchanged: 88% (wizard) and 90% (sample) on Berakhot 2a–3b.
