# KETER-TYPE v0.9.8 — Phase 1 + 2 Record (Worker 1)

**Tree:** `~/workspace/KETER-TYPE-v0.9.8/` (staged copy of pushed v0.9.7, `package.json` already `0.9.8`).
**Scope:** Phase 1 (streamline UI, hide developer clutter) + Phase 2 (.docx parser & Hebrew semantic extractor) only.
**Rules followed:** verify-first (read the real code before building); do NOT push, do NOT run the GitHub build, do NOT attempt installer delivery; do NOT write `MANIFEST.md` (this file is the coordinator's input). Do NOT expand scope: the full-tree UI/UX uniformity audit and the full-tree i18n audit run as FINAL passes after all 6 phases merge — this record covers only Phases 1+2. Wizard/hub labels are in plain words (one clear sentence per section, technical detail behind "More details"); settled defaults untouched (Rashi/Tosafot labels, running header, page numbers all OFF by default). Story Editor vs Edit-in-place left as-is for the final audit.

## Verified baseline (pristine v0.9.7 tree, before any edits)

| Check | Result |
|---|---|
| `npm install` | PASS (480 packages, exit 0) |
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run build` | PASS (exit 0, 3.35s) |
| `npx tsx scripts/v097-smoke.ts` | 73 passed, 1 failed — §6 version check only (`package.json` is 0.9.8 in the staged tree). Pre-existing and expected, not a regression. |

## Audit findings (verified in the tree before building)

- Directive-named files that EXIST: `src/engine/pagination-engine.ts`, `dynamic-knee.ts`, `spatial-exclusion.ts`, `typesetter-core.ts`, `harfbuzz-emulator.ts`, `nikud-engine.ts`, `in-place-edit-engine.ts`, `ornament-library.ts`, `src/components/FloatingContextToolbar.tsx`, `Milestone1ReportModal.tsx`, `EditorialStudioHeader.tsx`, `AutomatedTestPanel.tsx`.
- MISSING (confirmed, not searched for again): `src/components/DynamicKneeInspector.tsx`, `DocumentHierarchyInspector.tsx`, `Toolbar.tsx` (removed in v0.4.0 / never existed). `src/engine/commentary-linker.ts` does NOT exist yet — a later worker creates it.
- Built on, not replaced: v0.9.7 start screen with 11 core layouts (`NewProjectForm.tsx` + `CORE_START_LAYOUTS` in `layout-presets.ts`; Home and modal share one form); v0.9.7 multi-file DOCX hub (`DocxImportHub.tsx`, shared by Home and `DocxImportModal`); v0.5.0 secondary .docx import with tier assignment + dibbur linking at ≥0.8 confidence + review queue; v0.9.7 `autoLinkCommentariesToSource` / `classifyUnitTier` (`auto-layout.ts`, `docx-importer.ts`, `secondary-docx-import.ts`); knee solver with `mirrorFlanks`; PDF + IDML exporters.
- No `public/` directory and no `.ttf` files anywhere in the repo tree. `KETER_EMBEDDED_FONTS` (`pdf-native-text-engine.ts`) declares Frank Ruhl Libre, Noto Rashi Hebrew, David Libre loaded at runtime from `/fonts/*.ttf` — the files do not ship in the tree, so on-disk presence could not be verified. The app also fetches Google Fonts CSS at runtime (`fonts.googleapis.com`); in this sandbox that request fails (`ERR_TUNNEL_CONNECTION_FAILED`) and the app falls back to system fonts. Pre-existing gap, recorded honestly.
- `nikud-engine.ts` had only remove/strip/apply functions, no sanitise function.
- `classifyShasParagraph` (`vilna-shas.ts`) already handled `משנה …` → main_source, `דף …` → page_element, Ein Mishpat / Ner Mitzvah / Torah Or / Masoret HaShas → tertiary_comment. Heading 1/2, `פרק …`, `סימן …` already handled in the importer. `normalizeHebrewForMatch` is exported from `vilna-shas.ts` (reused for `DibburNode.normalizedText`).
- Developer/QA entry points found: header menu "כלים למפתחים" section (`EditorialStudioHeader.tsx` ~line 458); status-bar QA button (`WorkspaceStatusBar.tsx`, `onOpenTests`); `QaFixList` "תיקוני עמוד" button (`App.tsx` ~line 3452, behind "אפשרויות נוספות"); `AutomatedTestPanel` / `Milestone1ReportModal` mounts (`App.tsx` ~lines 4007–4015); `ShasQaPanel` "בדיקת ש״ס" button (kept visible — editorial verification, like proofreading, not a dev surface); `ProofreadingPanel`, `SuggestionReviewPanel`, `FontScannerPanel` (kept visible — editorial). Command palette has NO dev commands. No stage-badge component exists (`test_*` names are export-internal stage ids only). "Inspector" in this codebase = the Design panel (typography/layout) — editorial, kept. The `rav_text` tab in `DesignTypesettingPanel` is knee controls — editorial, kept.
- Recipe ids verified in `historical-layouts.ts`: `talmud-bavli`, `chumash-rishonim`, `mishnah-classic`, `shulchan-aruch`, `mikraot-gedolot`, `siddur` (none are aliases; `vilna-shas` aliases `talmud-bavli`).
- `DesignSettingsEngine.createDefaultSettings` accepts `layoutType`, `geometry`, `sourceFontFamily`, `rashiFontFamily`, `tosafotFontFamily`, font sizes. Recipes carry full `page` geometry (mm), `typography` (main/commentary pt), `headerFooter` — these ARE the archetype calibrated defaults, read live, not copied.
- `applyRecipeToSettings` in `auto-layout.ts` is id-based (resolves aliases, falls back safely) — used for archetype application, same function `handleImportUnits` already uses. `App.tsx` imports it as `applyRecipeToSettingsById`.

---

## Phase 1 — streamline UI, hide developer clutter

### 1.1 Developer Mode (new: `src/engine/developer-mode.ts`)

- **Existed:** nothing — no dev-mode concept, no gating; every QA surface was always reachable.
- **Built:** `DEVELOPER_MODE_STORAGE_KEY = 'keter-developer-mode'`; `isDeveloperModeEnabled()` / `setDeveloperModeEnabled()` (localStorage `'1'`/`'0'`, lazy read, best-effort on failure). Default OFF.
- **Gating (App + header + status bar):**
  - `src/App.tsx`: `developerMode` state (init from `isDeveloperModeEnabled()`), `handleToggleDeveloperMode` (useCallback), separate `useEffect` for Ctrl+Shift+D (does not touch the existing Ctrl+Z/S/K handler). Props passed to header (`developerMode`, `onToggleDeveloperMode`) and status bar (`developerMode`). Gated mounts: `developerMode && isTestPanelOpen` (AutomatedTestPanel), `developerMode && isReportModalOpen` (Milestone1ReportModal), `developerMode && showQaFixList` (panel) and the "תיקוני עמוד" toolbar button (`{developerMode && (...)}`).
  - `src/components/EditorialStudioHeader.tsx`: optional props `developerMode` (default false), `onToggleDeveloperMode`. The "כלים למפתחים" divider + Automated Tests + Architecture Report buttons render only when `developerMode`. A discreet always-visible toggle button at the menu bottom (`data-testid="developer-mode-toggle"`, label "מצב מפתח", state פעיל/כבוי, hint "Ctrl+Shift+D"); it does not close the menu so the section appearing/disappearing is visible.
  - `src/components/WorkspaceStatusBar.tsx`: optional prop `developerMode` (default false). When ON, the QA button (`data-testid="statusbar-qa-button"`); when OFF, the same "תקינות: X%" score as plain non-clickable text (`data-testid="statusbar-qa-score"`).
- **Deliberate judgement calls:** `ShasQaPanel` ("בדיקת ש״ס"), `ProofreadingPanel`, `SuggestionReviewPanel`, `FontScannerPanel` stay visible as editorial tools; only the generic QA-audit surfaces are gated. When ON, everything is reachable exactly as before.
- **Gap:** Ctrl+Shift+D may be bound by some browsers (Firefox "Bookmark All Tabs"); the header-menu toggle is the fallback.

### 1.2 New Sefer Wizard (new: `src/engine/sefer-wizard.ts`; extends the v0.9.7 form + hub)

- **Existed:** the 11 core layouts + 27 historical recipes; the multi-file DOCX hub with per-file role tagging; `applyRecipeToSettings`; the pending-recipe seam pattern (`savePendingHistoricalRecipe`).
- **Built:** 5 archetypes, each a SELECTION of an existing core layout + historical recipe (no parallel preset table):

  | Archetype | Core layout | Recipe | Slots (role) |
  |---|---|---|---|
  | Shas / Gemara (`shas`) | `rav_text` | `talmud-bavli` | Gemara `main_source` (required), Rashi `primary_comment`, Tosafot `secondary_comment` |
  | Chumash — Mikraot Gedolot (`chumash`) | `mikraot_gedolot` | `chumash-rishonim` | Chumash `main_source` (required), Targum `verse`, Rashi `primary_comment`, Ramban `secondary_comment`, Ibn Ezra `tertiary_comment`, Sforno `tertiary_comment` |
  | Mishnayot (`mishnayos`) | `mishnah-classic` | `mishnah-classic` | Mishnah `main_source` (required), Bartenura `primary_comment`, Tosafot Yom Tov `secondary_comment` |
  | Halakha — Shulchan Aruch (`halacha`) | `shulchan-aruch` | `shulchan-aruch` | Shulchan Aruch `main_source` (required), Mishnah Berurah `primary_comment`, Biur Halacha `secondary_comment` |
  | Classic sefer — single column (`classic`) | `single_column` | none | Main text `main_source` (required), Commentary `primary_comment`, Footnotes `footnote` |

  Every archetype has `additionalSlot` = Additional mefaresh (`tertiary_comment`); exactly one required slot each. Exports `SEFER_ARCHETYPES`, `getArchetypeById`, `validateArchetypeMapping`, `archetypeDefaultsSummary` (reads page/typography/headerFooter live from the recipe, e.g. Shas: "240×340 mm · margins 12/12/12/10 mm · main 14.5pt · commentary 10.5pt · folio daf-amud"; classic falls back to "Single column · Frank Ruhl Libre 14.5pt · royal page"), pending seam `savePendingArchetype` / `consumePendingArchetype` (consumed once) / `clearPendingArchetype` (localStorage `keter-pending-archetype`), and `applyArchetypeToSettings` (id-based applier, returns settings unchanged for classic/unresolvable).
- **Wizard UI (Step 1 in the form, Steps 2–3 in the hub, wired on Home):**
  - `src/components/NewProjectForm.tsx`: optional prop `onArchetypeChange`. New Step-1 section above the core-layout grid: 5 archetype cards (`data-testid="${testId}-wizard-archetype-${id}"`, in `SEFER_ARCHETYPES` order) with one-line descriptions. Picking one selects the mapped core layout + historical recipe in the EXISTING state (`setSelectedLayout(archetype.baseLayout)`, `setHistoricalRecipeId(archetype.recipeId)`) and notifies the parent; picking a core card directly clears the archetype. Selected archetype shows one plain sentence: "תבנית מכוילת: גודל הדף, השוליים והגופנים נקבעו מראש — אפשר לשנות הכול אחר כך בעיצוב." plus a `<details>` "פרטים נוספים" with the technical summary (mm/pt).
  - `src/components/DocxImportHub.tsx`: optional props `archetypeId`, `generateLabel`. When an archetype is set, the generic dropzone + file list are replaced by the slot matrix (`data-testid="${testIdPrefix}-wizard-slots"`): one dropzone per slot (`data-testid="...-slot-${slot.key}"`), a file dropped in a slot takes the slot's role instantly, one file per slot (drop into an occupied slot replaces it), "הוסף מפרש נוסף" button (`data-testid="...-add-mefaresh"`) appends extra tertiary slots, auto-link checkbox shown when >1 file. Per-file preview stats under each file (`data-testid="...-preview-${slot.key}"`, e.g. "232 מילים · 1 פרקים · 0 דפים · 0 פסוקים · 0 ד״ה · 0 הערות"), computed by parsing the file once via `DocxImporter.importDocx` and caching the result in `parsedCacheRef` (reused by `handleProcessImport`, so no double parse); preview failure is best-effort (nothing shown, real import surfaces errors). The generic file table shows the same stats line. Step-3 note (`data-testid="...-wizard-step3-note"`) is one plain sentence — "הלחיצה מייבאת את הקבצים, מקשרת דיבורי מתחיל למקור ומעמדת את הספר לפי התבנית שבחרתם." — with the honest scope detail (≥0.8 auto-apply, weaker links wait in the review queue, full CommentaryLinkerEngine comes in a later phase) inside a `<details>` "פרטים נוספים". The import button uses `generateLabel` when provided. `handleProcessImport` calls `savePendingArchetype(archetypeId)` exactly when the wizard import runs. `resetAfterImport` also clears extra slots, previews, and the parse cache. `handleRemoveFile` cleans the removed entry's preview/cache.
  - `src/components/HomeWorkspaceView.tsx`: `wizardArchetypeId` state; stepper header (`data-testid="sefer-wizard-stepper"`: "אשף ספר חדש:" + steps 1 בחרו סוג ספר / 2 הוסיפו קבצי Word / 3 צרו את פריסת הספר, step 1 shows ✓ + archetype label when picked). Passes `onArchetypeChange={setWizardArchetypeId}` to the Home form and `archetypeId={wizardArchetypeId}` + `generateLabel="צור פריסת ספר (שלב 3)"` (when an archetype is picked) to the inline hub. The modal form has no hub, so it never sets this state — it only selects the mapped layout + recipe. Steps are a guide, not a gate: the classic flow still works with no archetype.
  - `src/App.tsx`: `handleImportUnits` consumes the pending archetype once and applies its recipe over the auto-layout decision (`archetypeRecipeId ?? decision.recipeId`); the auto-layout notice records the applied recipe id.
- **Defaults untouched:** I did not edit `design-settings-engine.ts`, `GLOBAL_ROLE_STYLES`, or page-number/header defaults. Blank-create via archetype uses the same pending-recipe seam as picking that recipe card in v0.9.7; import via archetype uses the same auto-layout recipe applier with a different recipe id only when the user explicitly chose the archetype. Story Editor and Edit-in-place entry points untouched.

---

## Phase 2 — .docx parser & Hebrew semantic extractor

### 2.1 New module `src/engine/docx-semantics.ts` (pure helpers)

- **Existed:** `nikud-engine.ts` (remove/strip/apply only, no sanitise), the importer's own dibbur detection + ≥0.8 linking + review queue, `normalizeHebrewForMatch` in `vilna-shas.ts`.
- **Built:**
  - `sanitizeNikudText` (NFC, drop orphan leading combining marks, collapse duplicate identical marks; nikud preserved, never stripped).
  - `stripDirtyRunProperties(docDom)` (removes `w:rFonts`, `w:color`, `w:spacing`, `w:position`, `w:shd`, `w:highlight` from every `w:rPr` and `w:spacing` from every `w:pPr`; KEEPS `w:b`/`w:bCs`, `w:i`, `w:u`, `w:sz`/`w:szCs`, `w:jc`, `w:ind`, `w:pStyle`; returns counts).
  - `runFontSizePt(rPr)` (reads `w:sz`/2); `computeModalFontSizePt(units)`.
  - `detectSectionHeader` (centred + bold + ≤12 words → heading; `סעיף X` at line start with ≤10 words → siman + `seifLetter`/`simanNumber`; does NOT re-implement `דף`/`משנה`/`פרק`/`סימן`).
  - `findCitationSpans` (parenthesised/bracketed ≤40 chars, Hebrew + known sefer/marker word, daf ref, or gershayim abbreviation; plain asides excluded).
  - `findRemaGlossSpans` (`הגה:` to next `. `, bracket, or next `הגה:`, capped 400 chars) + `isShulchanAruchContext(fileName, units)` (filename match or any siman unit).
  - `tokenizeDibbur` (returns `DibburNode` or null; methods `explicit-dalet-he` 0.95 / `bold-lead` 0.9 / `delimiter` 0.85 within first 2–12 words / `source-match` 0.8; wraps the importer's already-detected dibbur when `knownDibbur` is given without re-deciding).
  - `splitRunsBySpans` (splits TextRuns at span boundaries, sets `isCitation`/`isRemaGloss`).
  - `ROLE_TYPOGRAPHY_DEFAULTS` (main_source Frank Ruhl Libre 14.5/1.32; verse 16/1.35; primary/secondary_comment Noto Rashi Hebrew 10.5/1.32; tertiary 9/1.25; chapter/heading/siman David Libre 20/15/15 bold; footnote Frank Ruhl Libre 9/1.25; dibbur_hamatchil Frank Ruhl Libre 13.5 bold; regular_paragraph 13.5) + `BUNDLED_FONT_AVAILABILITY` (Frank Ruhl Libre / Noto Rashi Hebrew / David Libre declared bundled with the note that no .ttf ships in the repo; Vilna/Guttman Vilna, Guttman Rashi, Drugulin, Taamey Frank CLM, Rashi Script CLM honestly NOT bundled).
  - `analyzeImportedDocx(units)` → `{wordCount, perekMarkers, dafMarkers, pasukMarkers, dibburCount, footnoteCount, markers}`.
  - `formatPreviewCounts(stats, t, lang)` — the per-file counts line in both languages (see §4 below).
- **Bug found and fixed during testing:** `findRemaGlossSpans` mixed a rest-relative `end` with the global `start` in the `end - start < 4` check, which wrongly dropped glosses starting later in a paragraph. Fixed to use a local `localEnd` and convert only when pushing the span.

### 2.2 `src/types/typesetter.ts`

- `TextRun` gains `isCitation?`, `isRemaGloss?`, `footnoteAnchorCharOffset?`. New `DibburNode` interface (`{id, rawText, normalizedText, targetAnchorId?, confidence, method: 'explicit-dalet-he' | 'bold-lead' | 'delimiter' | 'source-match'}`). `ContentUnit` gains `dibburNode?`, `hasRemaGloss?`, `footnoteAnchorCharOffset?`. `ShapedWord` gains `isCitation?`, `isRemaGloss?`.

### 2.3 `src/engine/docx-importer.ts` integration

- Imports the new helpers from `docx-semantics`. Calls `stripDirtyRunProperties(docDom)` right after parsing `word/document.xml`, and on `footnotes.xml` too.
- Paragraph text is passed through `sanitizeNikudText` after trim.
- Computes `isCentered` (`w:jc === 'center'`) and bold share (≥60% of chars bold) per paragraph; `detectSectionHeader` result is consulted in the role chain AFTER the Shas/Yiddish/Rashi/Tosafot branches (deliberate ordering so existing classifications win: a centred bold `דף` line stays `page_element`, a centred bold dibbur line stays commentary, `משנה` stays main_source). `simanNumber`/`seifLetter` are set on the unit when present.
- `extractTextRunsAndFootnoteAnchors`: captures `fontSizePt` per run from `w:sz`; tracks `cumulativeCharCount`; footnote anchors gain `anchorCharOffset` (exact char offset in the paragraph text) on the anchor record, the run (`footnoteAnchorCharOffset`), and the footnote `ContentUnit`; the fallback rebuilt-runs path also re-attaches `footnoteAnchorCharOffset`.
- After the body loop, a second pass over units: `findCitationSpans` → `splitRunsBySpans(..., 'isCitation')`; runs with `fontSizePt < 0.8 × modalSize` → `isCitation = true`; when `isShulchanAruchContext`, `main_source` units get `findRemaGlossSpans` → `isRemaGloss` runs + `hasRemaGloss = true`. Footnote/table/image units are skipped.
- After the existing dibbur detection, builds `unit.dibburNode` via `tokenizeDibbur(text, unitId, {boldLead: cleanBoldLead, sourceUnits: units.filter(main_source), knownDibbur, targetAnchorId: linkSourceId})` whenever `dibburHamatchil` exists (tertiary commentaries get a node too, though the v0.9.7 link block only links primary/secondary). Existing `dibburHamatchil` / link / review-queue behaviour untouched.
- `src/engine/secondary-docx-import.ts`: NO changes needed — it already delegates to `DocxImporter.importDocx`, so Phase 2 flows through; verified the merge keeps `DibburNode` on added units.

### 2.4 Renderer pickup `src/engine/typesetter-core.ts`

- In `shapeContentUnit`, after the role style resolves: citation runs render at `fontSizePt × 0.85`; Rema runs render in `'Noto Rashi Hebrew'`; both override the shaper and the shaped word's `fontFamily`/`fontSizePt`, and set `shaped.isCitation` / `shaped.isRemaGloss`. Dibbur role style is untouched.

### 2.5 What the old code already did vs what was added (dibbur)

- **Already existed (v0.5.0 / v0.9.7):** bold-lead detection, `ד"ה` prefix handling, ≥0.8 auto-link with `targetAnchorId`, review queue for weaker links, primary/secondary link tracks.
- **Added:** the structured `DibburNode` (`{id, rawText, normalizedText, targetAnchorId, confidence, method}`) wrapping the detected dibbur; the `delimiter` method (text before `כו' -`, `וכו'.`, `–`, `:` within the first 2–12 words, 0.85); the `source-match` method (0.8); `normalizedText` via the existing `normalizeHebrewForMatch`; nodes on tertiary commentaries too (link block still primary/secondary only — the full linker is a later phase).

---

## §4 — Bilingual i18n (second scoping note)

Every user-facing string added in Phases 1+2 goes into `src/i18n/strings.ts` with BOTH a Hebrew and an English entry — a string that silently falls back to the other language is a bug. Label/category tables use strict typing `Record<Category, { he: string; en: string }>` over CLOSED unions, so TypeScript FAILS the build if a category ships without a label in either language (the v0.9.1 lesson — the missing `yiddish` entry hidden by `Record<string, ...>` typing crashed Page design).

### 4.1 New `EN_STRINGS` keys (19 — all in `src/i18n/strings.ts`, v0.9.8 section)

| Hebrew key | English value | Where used |
|---|---|---|
| סוג הספר — אשף ספר חדש (שלב 1 מתוך 3) | Book type — New Sefer Wizard (step 1 of 3) | Form Step-1 heading |
| תבנית מכוילת: גודל הדף, השוליים והגופנים נקבעו מראש — אפשר לשנות הכול אחר כך בעיצוב. | Calibrated template: page size, margins and fonts are pre-set — you can change everything later in Design. | Form calibrated line |
| פרטים נוספים | More details | Form + hub `<details>` |
| טור יחיד — ברירות המחדל של התוכנה (Frank Ruhl Libre 14.5pt) | Single column — the app defaults (Frank Ruhl Libre 14.5pt) | Form classic `<details>` |
| מצב מפתח | Developer mode | Header toggle |
| מצב מפתח: הצגת כלי בדיקה ודוחות פנימיים (Ctrl+Shift+D) | Developer mode: show internal test tools and reports (Ctrl+Shift+D) | Header toggle title |
| אשף ספר חדש: | New Sefer Wizard: | Stepper |
| בחרו סוג ספר | Choose a book type | Stepper step 1 |
| הוסיפו קבצי Word | Add Word files | Stepper step 2 |
| צרו את פריסת הספר | Generate the sefer layout | Stepper step 3 |
| צור פריסת ספר (שלב 3) | Generate sefer layout (step 3) | Hub Generate button (Home) |
| גרור לכאן או לחץ לבחירת קובץ | Drag here or click to choose a file | Slot dropzone |
| הוסף מפרש נוסף | Add another mefaresh | Hub add-mefaresh button |
| מנתח את הקובץ… | Analysing the file… | Preview placeholder |
| תפקיד: | Role: | Slot file role line |
| פסוקים | Verses | Preview counts |
| שלב 3 — יצירת פריסת הספר: | Step 3 — Generate the sefer layout: | Step-3 note |
| הלחיצה מייבאת את הקבצים, מקשרת דיבורי מתחיל למקור ומעמדת את הספר לפי התבנית שבחרתם. | Clicking imports the files, links each dibbur hamatchil to its source and lays out the sefer using the template you chose. | Step-3 note |
| קישורים בודאות 80% ומעלה מוחלים אוטומטית; חלשים יותר ממתינים לסקירה למעלה — שום דבר לא מנוחש. מנוע הקישור המלא (התאמה מטושטשת ללא ניקוד) יגיע בשלב מאוחר יותר. | Links at 80% confidence or above are applied automatically; weaker ones wait for review above — nothing is guessed. The full linking engine (fuzzy matching without nikud) comes in a later phase. | Step-3 `<details>` |

Pre-existing keys reused by the new strings and asserted in the smoke script so they cannot silently fall back later: `פעיל`, `כבוי` (dev toggle states), `מילים`, `פרקים`, `דפים`, `ד״ה`, `הערות` (preview counts), `מצא וקשר אוטומטית דיבורי המתחיל בין המפרשים לגמרא` (auto-link checkbox), `הסר קובץ` (remove-file title). A mechanical check of all 221 `t()` literals in the touched files found zero missing from `EN_STRINGS`.

### 4.2 Strict label tables (`src/i18n/strings.ts`, after `EN_STRINGS`)

- `SeferArchetypeId` = `'shas' | 'chumash' | 'mishnayos' | 'halacha' | 'classic'` (moved here from `sefer-wizard.ts`; re-exported from there).
- `WizardSlotKey` = the 18 slot keys (`gemara`, `rashi`, `tosafot`, `chumash`, `targum`, `ramban`, `ibn-ezra`, `sforno`, `mishnah`, `bartenura`, `tosafot-yom-tov`, `shulchan-aruch`, `mishnah-berurah`, `biur-halacha`, `main-text`, `commentary`, `footnotes`, `additional-mefaresh`).
- `SEFER_ARCHETYPE_LABELS: Record<SeferArchetypeId, { he, en }>` (5 entries), `SEFER_ARCHETYPE_DESCRIPTIONS: Record<SeferArchetypeId, { he, en }>` (5), `WIZARD_SLOT_LABELS: Record<WizardSlotKey, { he, en }>` (18), `WIZARD_SLOT_HINTS: Record<WizardSlotKey, { he, en }>` (18). The archetype/slot definitions in `sefer-wizard.ts` no longer carry inline `labelHe/labelEn/descriptionHe/hintHe` fields at all — labels come only from these tables via `archetypeLabel(archetype, lang)`, `archetypeDescription(archetype, lang)`, `wizardSlotLabel(slot, lang)`, `wizardSlotHint(slot, lang)` (all in `sefer-wizard.ts`). Extra slots carry keys like `additional-mefaresh-2` (template-literal type `WizardSlotKey | \`additional-mefaresh-${number}\``) and resolve to the base `additional-mefaresh` entry — the key shape is enforced by the type, so no slot can reach the helpers unlabelled.
- The pre-existing v0.9.4 historical-shelf labels and `DOCX_HUB_ROLE_OPTIONS` still use their own `labelHe` + `t()` pattern — they were NOT touched; the final full-tree i18n audit owns them.
- `ROLE_TYPOGRAPHY_DEFAULTS` / `BUNDLED_FONT_AVAILABILITY` notes were already bilingual pairs (`noteHe`/`noteEn`) before this change; left as-is.

### 4.3 Parameterized strings + RTL/LTR

- No translated fragments: the Step-2 title was first written as `t("שלב 2 — קבצי Word לפי תפקיד (") + label + t("):")` — replaced with `wizardStep2Title(archetype, lang)`, one whole string per language ("שלב 2 — קבצי Word לפי תפקיד (ש״ס / גמרא):" / "Step 2 — Word files by role (Shas / Gemara):"). The hub now contains no `t("(")` / `t("):")` (asserted in smoke §10).
- Per-file counts use `formatPreviewCounts(stats, t, lang)` (`docx-semantics.ts`): count words go through the caller's `t()` and numbers use the UI language's locale (`he-IL` / `en-US`). Number–noun order is the same in both languages, so one composition works for both: "12,345 מילים · 3 פרקים · 2 דפים · 4 פסוקים · 7 ד״ה · 1 הערות" / "12,345 Words · 3 Chapters · 2 Pages · 4 Verses · 7 D.H. · 1 Notes" (live fixture: "232 Words · 1 Chapters · 0 Pages · 0 Verses · 0 D.H. · 0 Notes").
- RTL/LTR: the wizard stepper arrow flips with the document direction (`dir === 'rtl' ? '←' : '→'` — verified live: `→` in English, `←` in Hebrew; `document.documentElement.dir` is `ltr` in English mode). Slot grid and cards are direction-agnostic flex/grid. The archetype-card text uses the existing `text-right` convention (same as the core cards), so in English the card descriptions render right-aligned under a left-aligned title — cosmetic, consistent with the existing cards; per-language text alignment is a final-audit item. No overflow/clipping of Hebrew strings with nikkud was observed in the screenshots. Dialog alignment/dock order were not changed (no new dialogs or docks).

### 4.4 i18n verification

- Smoke §10 (15 checks, in `scripts/v098-phase1-smoke.ts`): every new key exists in `EN_STRINGS` (non-empty); all four strict tables are exhaustive, non-empty in both languages, and actually translated (`he !== en`); every archetype slot + the `additional-mefaresh-2` extra resolves in both languages; the Step-2 title is a whole string per language; `formatPreviewCounts` renders Hebrew in Hebrew mode and English in English mode through the real `EN_STRINGS` map; source checks that the hub/form use the bilingual helpers and that the stepper arrow flips with `dir`.
- Playwright §F (live, fresh page, `keter-ui-lang=en`): stepper, archetype cards, slot matrix title, Add Another Mefaresh, Step-3 note, Generate button, and per-file preview counts all render in English with no Hebrew wizard text remaining; `dir` is `ltr`; screenshot `screenshots/v098/06-wizard-en.png`.

---

## Verification results (final sweep, after all edits incl. i18n)

| Check | Result |
|---|---|
| `npm install` | PASS (480 packages, exit 0) |
| `npx tsc --noEmit` | PASS (exit 0) — run after engine changes, after UI changes, after label simplification, and after the i18n refactor |
| `npm run build` | PASS (exit 0, built in 3.40s) |
| `npx tsx scripts/v098-phase1-smoke.ts` | **66 passed, 0 failed** (51 before the i18n section; +15 §10 checks) |
| `npx tsx scripts/v098-phase2-smoke.ts` | **54 passed, 0 failed** |
| `npx tsx scripts/v097-smoke.ts` (regression) | 73 passed, 1 failed — the single failure is the same pre-existing §6 version check as baseline. No regressions. |
| `node scripts/v098-phase1-playwright-smoke.mjs` | **35 passed, 0 failed** (real Chromium, fresh `dist/` build) |

Playwright drive (sections A–F): A stepper + 5 archetypes + 11 core cards, no dev text on Home; B Shas pick selects the Vilna core card, calibrated line, slot matrix, Generate label; C Gemara .docx into the Gemara slot shows preview counts ("232 מילים · 1 פרקים · 0 דפים · 0 פסוקים · 0 ד״ה · 0 הערות") BEFORE Generate; D editor status-bar QA button hidden when OFF, score as plain text; E Ctrl+Shift+D shows the QA button and persists `'1'`, again hides it and persists `'0'`; F full English render (see §4.4). Zero JS page errors; zero same-origin resource failures.

Two Playwright issues found and fixed during the run (both in the script, not the app): (1) the first-run Welcome modal ("איך משתמשים בכתר?") covers Home in a fresh profile and intercepts pointer events — the script now dismisses it via its close button (`aria-label="סגור"` / `"Close"`) after every load; (2) the preview-count wait matched the placeholder element immediately — it now waits for the counts text itself (`waitForFunction` on `מילים` / `Words`).

Screenshots (`~/workspace/KETER-TYPE-v0.9.8/screenshots/v098/`):
- `01-home-wizard.png` — Home with wizard stepper + 5 archetypes
- `02-shas-slots.png` — Shas slot matrix
- `03-gemara-slot-preview.png` — Gemara slot with preview counts
- `04-editor-dev-off.png` — editor, developer mode OFF
- `05-editor-dev-on.png` — editor, developer mode ON (Ctrl+Shift+D)
- `06-wizard-en.png` — wizard fully in English (LTR)

## Honest gaps

- No font files ship in the repo, so bundled-font presence is unverifiable on disk; the app fetches Google Fonts CSS at runtime and falls back to system fonts when that host is unreachable (observed in the sandbox). `ROLE_TYPOGRAPHY_DEFAULTS` maps only to Frank Ruhl Libre / Noto Rashi Hebrew / David Libre; Vilna/Guttman Vilna, Guttman Rashi, Drugulin, Taamey Frank CLM, Rashi Script CLM are honestly recorded as NOT bundled.
- Ctrl+Shift+D may clash with browser shortcuts (Firefox "Bookmark All Tabs"); the header-menu toggle is the fallback.
- The full CommentaryLinkerEngine is a later worker's job; Step 3 honestly says so in the UI (≥0.8 auto-apply, weaker links wait in review).
- `דף`/`משנה` header handling was already owned by v0.9.7; Phase 2 deliberately did not re-implement it.
- Rema gloss end-detection is a `. `-period heuristic (capped 400 chars); delimiter dibbur is capped at the first 2–12 words; small-type citation threshold is 0.8× modal size; footnote char offsets are relative to the paragraph's concatenated run text.
- English preview counts reuse the pre-existing plural-only translations ("1 Chapters", "1 Notes", "0 D.H.") — no pluralization in the current i18n system; a final-audit item, not introduced by this phase.
- The `archetypeDefaultsSummary` technical string (mm/pt) is language-neutral numbers + units; it lives inside the "More details" disclosure, not in the plain label.
- Not yet run in the installed Electron app (same standing gap as v0.9.6/v0.9.7); verification is browser + build only.

## Files changed vs v0.9.7

**New:**
- `src/engine/developer-mode.ts`
- `src/engine/sefer-wizard.ts`
- `src/engine/docx-semantics.ts`
- `scripts/v098-phase1-smoke.ts`
- `scripts/v098-phase2-smoke.ts`
- `scripts/v098-phase1-playwright-smoke.mjs`

**Edited:**
- `src/types/typesetter.ts`
- `src/engine/docx-importer.ts`
- `src/engine/typesetter-core.ts`
- `src/i18n/strings.ts` (19 new EN_STRINGS entries + 4 strict bilingual tables + 2 id unions)
- `src/App.tsx`
- `src/components/EditorialStudioHeader.tsx`
- `src/components/WorkspaceStatusBar.tsx`
- `src/components/NewProjectForm.tsx`
- `src/components/DocxImportHub.tsx`
- `src/components/HomeWorkspaceView.tsx`

**Not touched:** `src/engine/secondary-docx-import.ts` (delegates to the importer — Phase 2 flows through unchanged), `design-settings-engine.ts` / `GLOBAL_ROLE_STYLES` / page-number & header defaults, Story Editor and Edit-in-place entry points, the v0.9.4 historical-shelf labels, `DOCX_HUB_ROLE_OPTIONS`.
