# KETER-TYPE v0.9.8 — Phases 5 + 6 Record

**Worker 3 — interactive canvas & one-click tweaking studio (Phase 5) + 1:1 export parity & automated regression verification (Phase 6).**
**Tree:** `~/workspace/KETER-TYPE-v0.9.8/` (`package.json` 0.9.8). Phases 1–4 inherited complete; this record covers only Phases 5–6. No push, no GitHub build, no installer delivery attempted by this worker. `MANIFEST.md` not written (coordinator consolidates).

**Final verification (2026-11-15):** `npm install` PASS · `npx tsc --noEmit` clean · `npm run build` PASS (3.98s).

---

## Phase 5 — Interactive canvas & one-click tweaking studio

### 5.1 "Show Anchor Links" overlay — `src/components/PageCanvas.tsx` + new `src/engine/anchor-overlay.ts`

**What existed already:** `PageCanvas.tsx` had a "hovered link connector", but it was a hardcoded decorative curve (`contentW*0.25, contentH*0.28 → contentW*0.72, contentH*0.32`) — it connected nothing real. Word spans were already registered in `wordDomMapRef` under keys `${lineKey}-w-${wordIndexInLine}` (lineKey = `${streamPrefix}-${line.lineIndex}`, prefixes `src` / `col2` / `rashi` / `tosafot` / `tertiary` / `fn`), and the SVG overlay is `absolute inset-0` over the content area, so DOM rects relative to the SVG rect are in the right coordinate space.

**What was genuinely built:**
- New pure helper module `src/engine/anchor-overlay.ts` (no DOM/React): `AnchorConnector`, `anchorConnectorColor(confidence, method)` (≥0.9 green `#2F6B3A`, ≥0.8 blue `#1D5FA8`, else amber `#B8741A`, unmatched red `#9B2C2C`), `ANCHOR_STREAMS`, `wordDomKey`, `rawTextWordOffsets`, `wordIndexAtCharOffset`, `findDibburWordKey` (first `isDibbur` word of a commentary unit on the page), `findTargetWordKey` (converts `AnchorLink.targetCharOffset` — an offset into the target unit's full `rawText` — into this page's slice via `buildUnitPageTextMap` + `pageWordStartIndex`), `wordGlobalIndexInUnit`, `charOffsetOfPageWord`, `anchorLinkTouchesPage`, `buildAnchorConnectors`, `buildConnectorPath` (cubic curve between two measured points), `reAnchorLink`, `applyReAnchorToUnits`, `unitGlobalWordIndexAcrossPages` (counts in exactly `findBreakAnchor`'s order).
- `PageCanvas.tsx`: toggleable overlay (`anchorLinks`, `showAnchorLinks` props). Connectors are measured from real DOM rects (`wordDomMapRef` → centres relative to the SVG rect), re-measured on typeset/zoom change, after 350ms, and on window resize. Dangling stubs (dibbur on page, target off-page) draw as a short dashed line from the dibbur end. The hardcoded fake curve was deleted. Connector group (`data-testid="anchor-connectors"`) has `pointerEvents: 'auto'` inside the otherwise pointer-events-none SVG; hover thickens the path; `<title>` shows dibbur → target text + "(קישור לא מאומת)" when unmatched; click selects the commentary unit.
- `App.tsx`: "קישורי ד״ה" toggle button (`data-testid="toggle-anchor-links"`) in the "More tools" disclosure (turning it off also clears any armed re-anchor); `showAnchorLinks` state (default false).

**Verified:** `v098-phase5-smoke.ts` §1 — 10 connectors built for page 1 of a real 6-page book, all 10 with both ends on the page, DOM keys matching the canvas key shape, dibbur/target word keys resolve, target char offset round-trips to the same word (±1 word), confidence colours, real curve path. Playwright `v098-phase56-playwright-smoke.mjs` §H — 22 connectors drawn live in Chromium, 69 dibbur re-anchor handles; screenshot `screenshots/v098/16-anchor-overlay.png`.

### 5.2 Click-to-re-anchor — `PageCanvas.tsx`, `anchor-overlay.ts`, `App.tsx`

**What existed already:** nothing — no re-anchor interaction existed. `bookDoc` in `App.tsx` is a `useMemo` over `contentUnits` (with `anchorLinks` from units and `links: ravTextLinks`); updating units triggers full re-pagination. No forward-only re-pagination API exists anywhere in the engine (Phase 4's async chunked pagination is preview-only).

**What was genuinely built:**
- Word-span `onMouseDown` interception, active only while the overlay is on AND `onReAnchorDibburPick` is provided (normal editing untouched when off): armed + Main Text/verse word (`word.role || line.role` is `main_source` or `verse`) → `onReAnchorTargetPick` with the char offset via `charOffsetOfPageWord`, early return; armed + dibbur word → re-arm to that dibbur; unarmed + dibbur word → arm. Double-click still opens in-place editing. Dibbur words get the re-anchor instruction as `title` and `data-anchor-dibbur={targetUnitId}` while the overlay is on. Re-anchor hint bar (`data-testid="reanchor-hint"`, cancel `data-testid="reanchor-cancel"`) at the top of the viewport while armed.
- `reAnchorLink(links, commentaryUnitId, targetMainNodeId, targetCharOffset, dibburText)`: replaces the link (confidence 1.0, method `'exact'`, `dibburSource: 'source-match'`, id `anchor-<unitId>`), never invents a target, inputs untouched. `applyReAnchorToUnits` stamps `anchorLink` on the commentary, `linkedSourceId`, and adds the id to the source's `anchoredCommentaryIds` (same-page gravity).
- `App.tsx` handlers: `handleReAnchorDibburPick` (arms + toast), `handleReAnchorCancel` (disarms + toast), `handleReAnchorTargetPick` (builds the link, `setContentUnits(applyReAnchorToUnits(...))`, `setRavTextLinks(mergeLinkSets(anchorLinksToRavTextLinks([link], contentUnits), prev))`, disarms + toast). Re-pagination is the full `bookDoc` recompute — the smallest correct option; recorded honestly (see Gaps).

**Verified:** phase5 smoke §2 — re-anchor replaces the link (exact, 1.0), keeps every other link, inputs untouched, stamps `anchorLink` + same-page gravity, merged `RavTextLink` follows the re-anchor. Playwright §I — hint bar appears on dibbur click, success toast after clicking a Main Text word; screenshot `screenshots/v098/17-reanchor.png`. (Test note: the first Playwright run clicked a heading word "מסכת" — the handler correctly ignored it, since the target must be `main_source`/`verse`; the test now picks a genuine Gemara word.)

### 5.3 Quick-Tune Design panel — `src/components/DesignTypesettingPanel.tsx`, `src/types/design-settings.ts`, `src/engine/design-settings-engine.ts`

**What existed already:** the v0.9.7 Design panel with tabs `typography | paragraph | page_geometry | rav_text | footnotes | title_page`; the `page_geometry` tab already had trim select, page W/H, margins, and a running-header section. Role-style updates already went through `applyCharacterStyleChange` / `applyParagraphStyleChange` + `applyWithHardRuleGuard`; `DesignSettingsEngine.resolveRoleAndUnitStyle` already existed; `lineSpacingRatio` is the line-height multiplier. Trim presets were cm-based only (`pocket` … `vilna_folio` 510×720); US sizes did not exist. `geometry.isVerso` is never set true by any solver and margins are never mirrored per page in the engine. `ornament-library.ts` has `orn-header-bar` ("Running Header Flourish", `builtin:header_flourish`), but `builtin:` SVG paths have NO renderer anywhere, `PageCanvas` does not render `placedOrnaments`, and `autoPlaceOrnaments` never auto-selects built-ins — so no flourish divider is available. Recto/verso-specific header text did not exist. Settled defaults were confirmed untouched: running header OFF (`showTopHeaderLine: false`), folio OFF (`showFolioNumber: false`), commentary labels OFF.

**What was genuinely built:**
- New first tab `quick_tune` ("כוונון מהיר" / "Quick-Tune", `data-testid="quick-tune-panel"`), extending the panel, not replacing it:
  1. **Page Geometry** — trim select (`data-testid="quick-tune-trim-size"`, 4 options: 6×9 / 7×10 / 8.5×11 / Vilna Folio; a disabled `__other__` option shows the current preset when it is not one of the four); 4 margin pt inputs (`quick-tune-marginTopPt|marginBottomPt|marginInsidePt|marginOutsidePt`); mirror toggle (`quick-tune-mirror-margins`).
  2. **Zone Typography** — rows per zone (`quick-tune-zone-main_source|primary_comment|secondary_comment|footnote`) with `FontDropdown` + size + line-spacing (sets `lineSpacingRatio` AND `leadingPt = fontSize * ratio`, mirroring the AI path); Dibbur HaMatchil row (`quick-tune-zone-dibbur_hamatchil`) with bold checkbox (`quick-tune-dibbur-bold`) + size. All via the existing style writers + hard-rule guard, read via `resolveRoleAndUnitStyle`.
  3. **Koteret** — enable toggle (`quick-tune-header-enabled`, `showTopHeaderLine`, default OFF untouched); right-page text input (`quick-tune-header-right`, placeholder = book title); left-page text input (`quick-tune-header-left`); divider toggle (`quick-tune-header-divider`, `showHeaderDividerRule`).
- `RunningHeaderSettings` += optional `rightPageText?`, `leftPageText?` (centre-slot text per spread side; per-folio override still wins; empty = old behaviour). Spread side: even 0-based page index = left-hand page (Amud Rishon), odd = right-hand page (Amud Sheini), per `spreadSideForPageIndex` in `engine/vilna-shas.ts`. `resolveRunningHeader(..., pageSide?: 'right' | 'left')` — new optional 5th param; callers omitting it get old behaviour exactly.
- `PageElementsDesignSettings` += `showHeaderDividerRule?: boolean` (default true; **plain typographic rule only** — the flourish asset has no renderable SVG, recorded in the code comment). `PageLayoutDesignSettings.pageSizePreset` += `'trim_6x9' | 'trim_7x10' | 'trim_letter'`; += `mirrorMargins?: boolean` (default true; when false both side margins equal the INSIDE margin — symmetric pages; honest scope note in the comment: the engine never swaps margins per page, so the toggle controls symmetric vs distinct side margins, not a per-page verso swap).
- `PAGE_SIZE_DIMENSIONS` += `trim_6x9: {432, 648}`, `trim_7x10: {504, 720}`, `trim_letter: {612, 792}`. `syncDerivedViews` heals the new defaults and applies the mirror rule (stored outside value kept, so re-enabling restores it). `createDefaultSettings` adds `showHeaderDividerRule: true`.
- **Bug found and fixed during verification:** the `updatePageElementsSettings` running-header merge is field-whitelisted and silently dropped `rightPageText`/`leftPageText` (phase5 smoke §4 failed twice). Added both fields to the whitelist merge in `design-settings-engine.ts`.
- **Bug found and fixed during verification (TypeScript):** `e.target.value as keyof typeof PAGE_SIZE_DIMENSIONS` then comparing to `'__other__'` is a TS2367 error — the value is first read as a plain string, checked against `'__other__'`, then cast.

**Verified:** phase5 smoke §4–§5 — settled defaults untouched; trims land in the geometry (432×648, 612×792); mirror OFF makes both side margins the inside margin and ON restores the distinct outside margin; right/left-page header text resolves per side; no-side callers get old behaviour; divider switchable; zone font/size/leading and dibbur bold land on the roles. Playwright §J — trim 6×9 changes the live page aspect ratio 0.706 → 0.666 (432/648 = 0.667) in Chromium; screenshot `screenshots/v098/18-quick-tune-6x9.png`. (Test note: the first assertion compared the overlay SVG width, which conflates geometry with the auto-fit zoom — the zoom re-fits when the panel is open, so the scale-free sheet aspect ratio is the correct assertion.)

### 5.4 Push / pull micro-adjustments — `src/engine/break-instructions.ts`, `src/components/FloatingContextToolbar.tsx`, `App.tsx`

**What existed already:** break instructions applied as a post-pass (`displayPages` useMemo: `wholeBookBalancingPass` then `applyBreakInstructions`); `oneLineLess` kind existed (page carries one line less); `oneLineMore` did NOT exist. `FloatingContextToolbar` had Auto-Center via `onAutoCenterBlock` (App owns break instructions) — the same pattern was reused. In-place editing (`in-place-edit-engine.ts`) untouched; the Story Editor vs Edit-in-place one-editor decision was NOT resolved (reserved for the final uniformity audit; both entry points left as they are).

**What was genuinely built:**
- `'oneLineMore'` added to `BreakInstructionKind` (pull: first line of the NEXT page moves onto this page; skipped with warning when no room) + `moveFirstLineToPrevPage` helper + the `oneLineMore` branch in `applyBreakInstructions` (refuses on page 0; room pre-check — deepest occupied bottom on the previous page + pulled line height incl. spacing vs `contentHeightPt`; records `report.moved` with `fromPageIndex`/`toPageIndex`/`lineCount: 1`).
- `FloatingContextToolbar`: new props `onPushLineToNextPage?`, `onPullLineToThisPage?`, `canPushLine?`, `canPullLine?`; button group (↓ push, ↑ pull) before "Open Full Inspector", `data-testid="toolbar-push-line"` / `"toolbar-pull-line"`, disabled states.
- `App.tsx`: `handlePushLineToNextPage` (last line of the last non-empty `LINE_STREAMS` stream on the current page; anchor = its first word via `unitGlobalWordIndexAcrossPages` — NOT wordIndex 0, which would resolve to the unit's first word on an earlier page; a bug found and fixed during writing; creates a deduped `oneLineLess` instruction; toast) and `handlePullLineToThisPage` (first line of the next page's first non-empty stream; same anchor helper; room pre-check with the "no room" toast on failure; creates `oneLineMore`; toast). Toolbar props wired with `canPushLine` / `canPullLine`.
- **Bug found and fixed during verification:** `applyBreakInstructions` called `nextPageOrCreate(pageIdx)` eagerly for EVERY instruction before the kind dispatch, so a `oneLineMore` anchored on the last page appended a blank trailing page (`pagesCreated: 1`) that nothing used. The `oneLineMore` branch is now dispatched BEFORE the eager next-page creation (commented in code). Regression check added to the phase5 smoke (`pagesCreated === 0`, page count unchanged).

**Verified:** phase5 smoke §3 — push moves exactly one line to the next page on a real 6-page book (100→99 lines, next 99→100); pull on a full page is refused with a warning; pull with room applies (3 lines / 1 line) and restacks below the existing lines and creates no blank page. Playwright §G — push toast, then pull toast (room freed by the push); screenshot `screenshots/v098/15-push-line.png`.

---

## Phase 6 — 1:1 export parity & automated regression verification

### 6.1 Exact coordinate & font parity — VERIFY-FIRST result: already consuming the same tree

**What existed already (verified by reading code, not rebuilt):**
- PDF: `PdfExporter.buildPageRenderPlan(page)` consumes the `PageTypesetResult` tree — line `xLeft`/`xRight`/`yBaseline`, `word.width` (shaped advances, fallback estimate only when width ≤ 0), fonts, weights. `renderPageToPdfNative` and `renderPageToCanvas` both consume the plan. `PdfExporter.generateMultiPagePdf(bookDoc, ...)` is the real export entry (used by `App.tsx` and `ExportWorkspaceView.tsx` on `displayBookDoc`). The plan maps `yBaseline = mTop + line.yBaseline`, `xLeft = mLeft + line.xLeft`, `xRight = mLeft + line.xRight` (rav-text branch).
- IDML: `IdmlExporter.computePageTextFrames(page, pageIndex)` consumes the tree (line x/y → polygon bands via `bandsToPolygonPoints`); `generateMultiPageIdml(bookDoc)` exists; Paragraph Styles (`ParagraphStyle/KeterHeading`, `KeterRashi`, `KeterTosafot`), Character Styles (`CharacterStyle/KeterDibburBold`, `KeterFootnoteRef`), threaded frames (`PreviousTextFrame`/`NextTextFrame`) already exist.
- Header divider: the Phase 5 `headerDividerRule` was wired into the plan and both renderers (`renderPageToPdfNative`: `doc.line(...)` gated on the flag; `renderPageToCanvas`: the divider block gated on it). `resolveRunningHeader` is passed the page side in both `PageCanvas` and `buildPageRenderPlan`.
- Fonts: `KETER_EMBEDDED_FONTS` declares Frank Ruhl Libre / Noto Rashi Hebrew / David Libre loaded at runtime from `/fonts/*.ttf` — **no `.ttf` files ship in the repo** (verified Phases 1–2 and again here). PDF export throws `Missing embedded Hebrew TTF font binary` without them. Nothing was faked: the test run fetched the real OFL fonts from the Google Fonts repository (David Libre static Regular/Bold; Frank Ruhl Libre and Noto Rashi Hebrew as variable `[wght]` fonts, instanced to static Regular 400 / Bold 700 with `fontTools varLib.instancer`) into `/tmp/keter-fonts`, used via `KETER_FONTS_DIR`. They are test inputs only, NOT bundled into the repo.

**What was genuinely built:** no exporter engine was rebuilt — the parity work is measurement. Two things the measurement turned up are recorded, not fixed by re-laying-out:
- The default 3mm bleed shifts the whole plan by exactly 8.5039pt on a media box enlarged by the same amount. The first smoke run showed a systematic +8.5pt offset on every extracted baseline; traced to `DEFAULT_PRINT_PDF_OPTIONS.bleedMm: 3` + `shiftRenderPlan` — the shift IS the bleed, verified by a dedicated bleed check (40/40 lines at plan + 8.50pt). The exact-parity gates run with `bleedMm: 0`.
- Rav-text foliation starts at Daf Bet: `pageNumber = pageIndex + 2` (`pagination-engine.ts:3504`). The extractor numbers PDF pages 1..N in order, so the smoke matches extracted pages by POSITION (`extracted.pages[page.pageIndex]`), not by `pageNumber` — the first smoke run's off-by-one (206/484) was a test bug, not an exporter divergence.

**Verified (phase6 smoke, 6-page fixture book):** §1 plan-vs-tree — 582 plan lines = tree lines, worst coordinate delta **0.00pt**, 2,403 plan words match shaped words. §2 real PDF (fonts via `KETER_FONTS_DIR=/tmp/keter-fonts`) — 109,858-byte valid PDF, same page count, **582/582** extracted lines land on plan baselines (≤2pt, worst 1.93pt), **561/579** lines in logical Hebrew order (96.9%; the 18 non-forward lines are short repetitive filler lines where the word-reversed string also appears as a substring by chance — an ambiguity of the fixture text, not a reversal: no line was actually word-reversed). Bleed check 40/40 at plan + 8.50pt. §3 IDML frames — 18 frames contain their lines, 0 overlapping pairs. §4 IDML package — 52,555-byte valid ZIP, audit passes, 0 overlapping frames, word conservation 2,403/2,403, Keter Paragraph/Character Styles present, 30 threaded frame links, RTL story + paragraph direction. §5 co-location 60/60 (100.0%).

### 6.2 `scripts/verify_sefer_pipeline.ts` — NEW, runs and passes

Loads the real user flow end to end: `python3 scripts/v098-make-test-docx.py` into a temp dir (gemara-50 / rashi-50 / tosafot-50 with nikkud, citations, 108 dibburim) → `DocxImporter.importDocx` per file (role by slot, exactly as the hub assigns; importer detected roles logged alongside) → `linkCommentariesToSource` → `PaginationEngine.paginateDocument` (rav_text) → `PdfExporter.generateMultiPagePdf` + `IdmlExporter.generateMultiPageIdml`. Asserts all four gates. **Result: 19 passed, 0 failed, 0 skipped** (with `KETER_FONTS_DIR=/tmp/keter-fonts`):
- G1 0 overlapping text boxes — PDF plan boxes (743 lines, incl. word-level x-overlap), IDML frame polygons, IDML audit: all 0.
- G2 Dibbur same-page co-location — **100/100 (100.0%)** of linked dibburim (100 linked of 108; the 8 deliberate orphans stay unlinked, as designed).
- G3 valid RTL glyph ordering — **722/743 lines (97.2%)** in logical order.
- G4 non-empty valid artifacts — PDF 147,236 bytes (`%PDF-`, 10 pages, extracted page count matches), IDML 65,583 bytes (ZIP `PK`, audit passes, word conservation 3,319/3,319). Artifacts saved under `/tmp/keter-v098-pipeline-*/` (paths printed by the run).
- Import notes: gemara file 32 units (importer detected `[chapter, main_source]`, `hasNikud=true`); rashi 55 units; tosafot 53 units. The importer detects some commentary paragraphs as `main_source` — the pipeline assigns roles by slot (the hub's behaviour) and logs the detected roles rather than hiding the difference.

### 6.3 Secondary import linker wiring — `src/engine/secondary-docx-import.ts` (Phase 3 gap, closed)

**What existed:** line ~168 called only the old linker (`DocxImporter.autoLinkCommentariesToSource`).
**What was built:** after the old linker, the new `linkCommentariesToSource(existingSources, importedCommentaries)` runs, converts via `anchorLinksToRavTextLinks`, merges with `mergeLinkSets` (higher confidence wins — same call shape as `DocxImportHub.tsx:471`), stamps `anchorLink` on the linked imported units, all inside try/catch so the new engine can never break a secondary import (the old linker's output stands on failure). Verified by phase5 smoke §7 (source check + the linker functions it calls are covered by the Phase 3 smoke).

---

## New smoke scripts

| Script | Result |
|---|---|
| `scripts/v098-phase5-smoke.ts` | **52 passed, 0 failed** (§1 overlay, §2 re-anchor, §3 push/pull incl. blank-page regression, §4 Quick-Tune settings, §5 zone writers, §6 i18n, §7 secondary wiring, §8 version) |
| `scripts/v098-phase6-smoke.ts` | **21 passed, 0 failed, 0 skipped** (run with `KETER_FONTS_DIR=/tmp/keter-fonts`; without fonts the 3 PDF gates skip with a reason, same gate as `partE-smoke.ts`) |
| `scripts/verify_sefer_pipeline.ts` | **19 passed, 0 failed, 0 skipped** (same font gate) |
| `scripts/v098-phase56-playwright-smoke.mjs` | **22 passed, 0 failed** in real Chromium (screenshots `screenshots/v098/15-push-line.png`, `16-anchor-overlay.png`, `17-reanchor.png`, `18-quick-tune-6x9.png`, `19-quick-tune-en.png`); 0 JS page errors, 0 same-origin failures. Note: Google Fonts CSS is unreachable in this sandbox (external only); the app falls back to local fonts. |

## Regression battery (this pass)

| Script | Result | Note |
|---|---|---|
| `v098-phase1-smoke.ts` | 66 passed, 0 failed | |
| `v098-phase2-smoke.ts` | 54 passed, 0 failed | |
| `v098-phase3-smoke.ts` | 65 passed, 0 failed | |
| `v098-phase4-smoke.ts` | 34 passed, **2 failed** | **Known pre-existing gap, unchanged by this pass** — Rule 3 worst flush deviation 25.4pt (tolerance 19.14pt) and the matching 25pt blank wraparound band; identical numbers to the Phase 4 record, proven pre-existing there by an old-linker-only run. Not silently re-fixed or hidden. |
| `v097-smoke.ts` | 73 passed, 1 failed | Expected: the version check (package.json is 0.9.8, smoke expects 0.9.7). |
| `partE-smoke.ts` | 18 passed, 0 failed, 0 skipped | Run with `KETER_FONTS_DIR=/tmp/keter-fonts`. |
| `v098-phase34-playwright-smoke.mjs` | not re-run | Superseded by the phase56 drive-through for this pass; its flow is reused inside it. |

---

## Bilingual strings — added keys (`src/i18n/strings.ts`)

33 new `EN_STRINGS` keys (all with Hebrew + English). Four first-draft keys were duplicates of pre-existing keys and were removed (kept the pre-existing values): `"גופן:"`, `"דיבור המתחיל"` (existing spelling "Hamatchil"), `"מודגש"`, `"כותרת רצה"` ("Running head"), `"הצג כותרת רצה בראש העמוד"`. Lesson recorded: check for existing keys before adding; `tsc` error TS1117 catches duplicates.

New keys: `"קישורי ד״ה"` / "Dibbur links"; `"הצג קישורי דיבור המתחיל על העמוד"`; `"לחצו על דיבור המתחיל, ואחר כך על הביטוי במקור, כדי לקשר מחדש"`; `"בחרו ביטוי במקור כדי לקשר את הדיבור"`; `"הקישור עודכן — הדיבור מקושר כעת לביטוי שבחרתם"`; `"הביטוי שנבחר אינו במקור — לחצו על מילה בטקסט הראשי"`; `"ביטול קישור מחדש"` / "Cancel re-anchoring"; `"קישור מחדש בוטל"`; `"קישור לא מאומת"`; `"כוונון מהיר"` / "Quick-Tune"; `"גודל דף, שוליים, גופנים וכותרת רצה — הכול במקום אחד."`; `"גאומטריית עמוד"`; `"גודל דף:"`; `"שוליים ממורכזים"`; `"שוליים פנימיים וחיצוניים נפרדים; כבוי = שני הצדדים שווים לשוליים הפנימיים."`; `"טיפוגרפיה לפי אזור"`; `"גודל (pt):"`; `"מרווח שורות:"`; `"כותרת בעמוד הימני"`; `"כותרת בעמוד השמאלי"`; `"ריק = כותרת הספר; פרק / דף / פרשה בעמוד השמאלי."`; `"קו מפריד מתחת לכותרת"`; `"דחוף שורה לעמוד הבא"`; `"משוך שורה לעמוד זה"`; `"דחוף את השורה האחרונה של העמוד לעמוד הבא"`; `"משוך את השורה הראשונה של העמוד הבא לעמוד זה"`; `"השורה נדחפה לעמוד הבא"`; `"השורה נמשכה לעמוד זה"`; `"אין מקום לשורה נוספת בעמוד זה"`; `"אין עמוד הבא"`; `"העמוד ריק"`; `"הייצוא נבדק מול העמוד שעל המסך"`.

New strict tables (`Record<…, BilingualLabel>`, exhaustive in both languages, checked in the phase5 smoke): `QuickTuneTrimId = 'trim_6x9' | 'trim_7x10' | 'trim_letter' | 'vilna_folio'` with `QUICK_TUNE_TRIM_LABELS`; `QuickTuneZoneId = 'main_source' | 'primary_comment' | 'secondary_comment' | 'footnote'` with `QUICK_TUNE_ZONE_LABELS`.

---

## Honest gaps (not done, and why)

1. **Forward-only re-pagination is not supported.** No forward-only API exists in the engine; click-to-re-anchor and push/pull re-paginate the whole book via the `bookDoc` useMemo. The re-pagination is the smallest correct one available; a forward-only pass would be a new engine feature.
2. **IDML drops running headers entirely.** `idml-exporter.ts` has no running-header rendering (verified by source search; the only "header" matches are CRC headers and the title page). InDesign users put running headers on master pages. Recorded, not faked.
3. **No decorative divider flourish.** The ornament library's `orn-header-bar` (`builtin:header_flourish`) has no SVG renderer anywhere in the codebase, so the Quick-Tune divider is a plain typographic rule only.
4. **No font files ship in the repo.** PDF export throws without font binaries. The test run used real OFL fonts fetched to `/tmp/keter-fonts` (not bundled); the app still needs the user/agency to supply fonts (or bundle them) for PDF export to work on a fresh machine.
5. **Mirror margins is symmetric-vs-distinct, not a per-page verso swap.** The engine never sets `geometry.isVerso` true and never mirrors margins per page, so the toggle cannot do a verso swap; it controls whether both side margins equal the inside margin.
6. **Phase 4 flush gap untouched:** worst non-final flush deviation 25.4pt vs 19.14pt tolerance (group-boundary quantization in the probe); needs leading-stretch or a fill-aware probe tiebreak, out of this pass.
7. **Async pagination costs ~+1 page per chunk boundary** (inherited from Phase 4) — single-shot remains the reference for final export.
8. **Not yet run in the installed Electron app.** All verification here is Node/tsx + headless Chromium against `dist/`; the Electron shell path is untested.
9. **RTL measurement caveat:** the extracted-PDF RTL check passes at 96.9% (phase6) / 97.2% (pipeline); the residual lines are short repetitive filler lines where the word-reversed string also appears as a substring by chance — no line was actually found word-reversed.

---

## Files changed vs the inherited tree

**New:** `src/engine/anchor-overlay.ts`; `scripts/v098-phase5-smoke.ts`; `scripts/v098-phase6-smoke.ts`; `scripts/verify_sefer_pipeline.ts`; `scripts/v098-phase56-playwright-smoke.mjs`; `PHASE-5-6.md` (this file).

**Edited:** `src/App.tsx` (anchor toggle + state, re-anchor handlers, push/pull handlers, `TypesetLine` import); `src/components/PageCanvas.tsx` (real measured overlay, re-anchor interception + hint bar, header side text + divider gating); `src/components/DesignTypesettingPanel.tsx` (Quick-Tune tab); `src/components/FloatingContextToolbar.tsx` (push/pull buttons); `src/engine/pdf-exporter.ts` (plan `headerDividerRule` + gating in both renderers); `src/types/design-settings.ts` (side header texts, divider flag, trims, mirror flag); `src/engine/design-settings-engine.ts` (trim dimensions, mirror/divider healing, **running-header whitelist fix**); `src/engine/break-instructions.ts` (`oneLineMore` + `moveFirstLineToPrevPage`, **blank-trailing-page fix**); `src/engine/secondary-docx-import.ts` (new linker wiring); `src/i18n/strings.ts` (33 keys + 2 strict tables).

**Not touched:** `MANIFEST.md`; `src/engine/in-place-edit-engine.ts`, `harfbuzz-emulator.ts`, `nikud-engine.ts`, `idml-exporter.ts`, `pdf-native-text-engine.ts`, `commentary-linker.ts`, `synchronized-pagination.ts` (verify-first: all already did their jobs).

## Directive file-name mapping

| Directive item | Real file |
|---|---|
| "Show Anchor Links" overlay in PageCanvas | `src/components/PageCanvas.tsx` + new `src/engine/anchor-overlay.ts` |
| Click-to-re-anchor + incremental re-pagination | same files + `src/App.tsx` (full re-pagination — forward-only does not exist; see Gap 1) |
| Simplified "Quick-Tune" Design panel | `src/components/DesignTypesettingPanel.tsx` (new `quick_tune` tab), `src/types/design-settings.ts`, `src/engine/design-settings-engine.ts` |
| Push / pull micro-adjustments | `src/engine/break-instructions.ts` (`oneLineMore`), `src/components/FloatingContextToolbar.tsx`, `src/App.tsx` |
| PDF/IDML consume the RenderedPage tree | verified already true in `src/engine/pdf-exporter.ts` / `src/engine/idml-exporter.ts` — measured, not rebuilt |
| `scripts/verify_sefer_pipeline.ts` | created, runs, passes (19/19) |
| Bilingual strings | `src/i18n/strings.ts` (33 keys + 2 strict tables) |
