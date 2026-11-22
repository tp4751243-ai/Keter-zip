# KETER-TYPE v0.9.2 — MANIFEST

**Base:** the complete v0.9.1 tree (remote `7c98d6b9`, pushed 2026-11-11 00:57 EST — see `MANIFEST-v0.9.1.md`). `package.json` version bumped to 0.9.2 (version field only). **Not pushed, not committed, no installer built** — staging only, as instructed. `MANIFEST.md` is excluded from the push, as always. `package-lock.json` is byte-identical to v0.9.1.

**User report (2026-11-11 01:10 EST, installed v0.9.1, Page design now opens):** "A lot of the features don't work and are not uniform, like the same features are found in multiple places, and the edit text in place doesn't work."

This release is a fix + consolidate pass — no new features. It was built in three parallel parts (A: function audit, B: uniformity/dedup, C: Edit text in place) on separate copies of the v0.9.1 tree and merged by the coordinator. Part records: `PART-A.md`, `PART-B.md`, `PART-C.md` in the part trees (`~/workspace/KETER-TYPE-v0.9.2-A/B/C/`).

## 1. Part A — full function audit

Method (verify-first): every user-facing control traced from its UI label to its handler in code and, where the repo's Playwright smoke can drive it, in real Chromium. A control was only called "working" when the trace showed the handler doing what the label promises. Re-checked all 66 items from the v0.8.0 audit (`AUDIT-FINDINGS.md`) plus everything added in v0.9.0/v0.9.1. Admitted design limits were NOT re-litigated (tiers 4–7 share one tertiary band; tables flow as text; recipes apply recto-only; dibbur brackets / justification-expansion / invocation text are recorded in recipes but have no settings field) — but controls around them were checked, and a control promising what the engine cannot do was treated as fake.

**Counts: ~140 controls traced. Working: everything else. Broken: 2. Fake: 3. Dead: 2. All 6 findings fixed.**

### Audit table

| Area / control | File:line | Verdict | Action |
|---|---|---|---|
| Manuscript Designer box tier dropdown (11 tiers) | `CustomLayoutDesigner` / `custom-layout-engine.ts:144` | Fake — write-only, tier never read in real flow | **Fixed (A1):** tier is now the flow key (`acceptedRolesForBox`); paginator flows by tier |
| Rule inspector: min/max font | `custom-layout-engine.ts:181`, `pagination-engine.ts:1354` | Fake — write-only | **Fixed (A1):** clamped in paginator (verified live: 20pt→16, 10pt→14) |
| Rule inspector: line-height ratio | `pagination-engine.ts:1307` | Fake — write-only | **Fixed (A1):** preferred over legacy `lineHeight` (verified: ratio 2.0 at 14.5pt → 29pt lines) |
| Rule inspector: alignment | `pagination-engine.ts:1354` | Fake — write-only | **Fixed (A1):** stamped on lines, no justify stretch |
| Rule inspector: column gutter | `CustomLayoutDesigner.tsx` | Dead — no effect for a single box | **Removed (A1):** field removed from the designer UI (type field kept; template round-trip preserves it) |
| Template export / import round-trip | `layout-recipes.ts:728` | Partial — lost tier + rules | **Fixed (A1):** tier + rules restored; new optional region fields `minFontSizePt` / `maxFontSizePt` / `alignment` (backwards compatible) |
| Gemini Shas/Yiddish/recipe actions (16) | `AiChatPanel.tsx:541` | Broken — all refused as "unknown or unsafe" although the system prompt advertises them and `App` handles them | **Fixed (A2):** validated pass-throughs (`move_rashi` needs boolean `closer`; `expand_tosafot` needs `widthPct` 20–40; recipe actions need a resolving `recipeId`; `templateId`-only still refused, as in App) |
| Gemini older actions | `AiChatPanel.tsx:541` | Working | — |
| Local NL parsers (Shas / Yiddish / auto-layout) | `vilna-shas`, `yiddish-sefarim`, `auto-layout` | Working | — |
| QA fix button: collision / orphan_mark / folio | `qa-engine.ts:79,101,250` | Fake — button shown, handler has no branch, only toasted "no automatic fix" | **Fixed (A3):** all three `autoFixable: false`; only `balance` / `widow_orphan` offer a fix, exactly what the handler fixes |
| `balanceTierGrid` gutter scaling | `auto-layout.ts:833` | Dead — exported, zero callers; every library recipe's raw tier widths summed 188–462% | **Fixed (A4):** moved to `layout-recipes.ts` and wired into `applyRecipeToSettings`; all sampled recipes now land ≤100% with knee-solver ratios unchanged |
| Automated Test panel: 23 static "passed" rows | `AutomatedTestPanel.tsx` | Fake — hardcoded passes + times, never execute | **Removed (A5):** rows deleted; panel shows only tests that run |
| Test panel: header %, total time, per-test times, PASS badge, footer command | `AutomatedTestPanel.tsx` | Fake — hardcoded "(100%)", "14.8 ms", `Math.random()` times, badge always PASS, footer pointed at a nonexistent `python3` script | **Fixed (A5):** header computes real pass rate + `performance.now()`-measured total; badge from `test.status`; footer points at real `npm run smoke:partC` |
| Test panel: opens at all | `AutomatedTestPanel.tsx:1384` | Broken — crashed on mount (`pdfTestDoc.pages[1]` doesn't exist; sample Berakhot = 1 page) | **Fixed (A6):** page-2 checks run against a doubled-sample multi-page Berakhot with guards; B-1/B-3 now pass |
| v0.8.0 audit fixes (66 items re-checked) | pagination-engine, design-settings-engine, App, etc. | Working — all confirmed intact | — |
| v0.8.1 white-screen fix + ErrorBoundary | App / v081-playwright 11/11 | Working | — |
| v0.9.0 library (10 recipes), recipes, auto-layout on import, flaw scan, dibbur detection | historical-layouts, layout-recipes, auto-layout | Working | — |
| v0.9.1 Yiddish label, derived-views heal, QaFixList fallbacks | DesignTypesettingPanel, design-settings-engine, QaFixList | Working | — |
| Home / New Project / header menus / Pages / frames / context menu / Shas QA / search-replace / export options / DOCX import / command palette / shortcuts / save / draw-frame / story view | App + components | Working (traced; export options genuinely consumed in pdf-exporter) | — |
| Typesetting rules modal, License modal, Gemini key modal, Content editor, Font scanner, Secondary DOCX import, Title page | respective modals/panels | Working | — |
| Inline editor alignment | `InlineTextEditor.tsx` | Working (`document.execCommand` — deprecated but functional) | — |
| `boldDibburInUnit` | `docx-importer.ts:800` | Unused tested utility — dead code, not a user-facing defect; left in place | — |
| `microSpaceLine` / `auditMicroSpacing` | `balance-engine.ts:401` | Working (called in the balancing pass) | — |

Regression caught and fixed during Part A verification: the first A1 sink (`main_text` tier only) broke the chassidic-drush recipe (8 units unplaced — a homeless role blocked the book); `isMainTextBox` now matches `main_text` **or** `main_drush`, pinned by two new v092a checks.

## 2. Part B — uniformity / deduplication

Every feature below was verified in code before it was touched. For each duplicated feature one canonical home was picked (the place a non-expert user would look), every entry point wired to the SAME handler, and redundant copies removed. One name per feature, Hebrew and English through `src/i18n/strings.ts` + `t()`.

| # | Feature | Canonical home | Handler | What was removed |
|---|---|---|---|---|
| B1 | Page navigation (3 surfaces) | Navigator sidebar (`PageNavigatorSidebar`) | `handleReorderPage` / `handleInsertPage` / `handleDeletePage` in App | `src/components/PagesPanel.tsx`, `src/components/ThumbnailOverview.tsx`, `showPagesPanel` / `showOverview` state, "לוחות עמודים" + "סקירת עמודים" buttons. PagesPanel's abilities moved into the navigator: drag-reorder, per-page "⋯" menu (insert/delete), Latin folio on each thumb (`folioLabel` / `spreadPairs` moved verbatim to `src/engine/page-labels.ts`) |
| B2 | Text styles (3 divergent writers + 2 hidden bypasses) | One shared handler `src/engine/text-style-apply.ts` (word > unit > role, hard-rule guard on every write) | `applyCharacterStyleChange` / `applyParagraphStyleChange` — floating toolbar, Design panel, keyboard shortcut, style panels, in-place edit | All text controls from Control Panel (font family, size, leading, tracking, baseline, kerning, indents, space before/after). Control Panel is now **frame-geometry only** (X/Y/W/H, rotation, skew, auto-center) and says so in its header ("גאומטריית מסגרת"). This also fixes a real drift bug: Control Panel's absolute `leadingPt` writes shadowed `lineSpacingRatio`, silently breaking the floating leading stepper. Leading is driven by `lineSpacingRatio` everywhere now; old explicit `leadingPt` overrides in existing projects are still honoured by the resolver (pre-existing behaviour, unchanged) |
| B3 | Export | Export workspace only (`ExportWorkspaceView`) | `handleExportPdf` / `handleExportIdml`, passed only to the Export workspace | Header one-click "ייצוא PDF" button + `onExportPdf` / `onExportIdml` header props. Header keeps "ייצוא לדפוס" → Export workspace |
| B4 | Layout pickers (4 lists, 4 name sets) | One list `src/engine/layout-presets.ts` (7 layouts, canonical `labelHe` + `subLabelHe`) | Header, New Project modal and auto-layout banner render from it; historical library canonical in Design panel + New Project modal | Duplicate name sets; header-menu historical-library section (menu keeps the quick layout-type switch) |
| B5 | Knee guide | Floating toolbar + Design panel (Rav-text tab) | Same state toggle | Header "Project" menu knee-guide toggle |
| B6 | New project (2 creation UIs) | New Project modal (`NewProjectModal`) | Home card opens it (`onOpenNewProject`); per-entry defaults preserved via new `initialMode` prop (`sample` from Home, `blank` elsewhere) | Whole inline wizard from `HomeWorkspaceView` (state, layout cards, custom-box designer use there, title field, starter toggle) |
| B7 | DOCX import (2 UIs, divergent behaviour) | Import modal (`DocxImportModal`, auto-layout classification + stated reason + Change-layout banner) | Home card opens it (`onOpenDocxImport`); divergent Home handler deleted entirely | Staged importer from `HomeWorkspaceView` (state, `DocxImporter` use there, role selects, layout select, auto-link checkbox, import runner) |
| B8 | Naming | One name per feature, HE + EN via `strings.ts` | — | "לוחות עמודים" / "סקירת עמודים" gone from the UI (EN entries remain as orphans in the dict, harmless); auto-center is "מרכוז אוטומטי" on all 4 entry points (floating toolbar, Design panel, Control Panel frame button, context menu — the last was "התאמה — מרכוז אוטומטי של המסגרת"); "דפים" everywhere for Pages. New English entries: "גאומטריית מסגרת", Control Panel empty hint, Home create-card sentence, Yiddish sublabel |

Verified single-home and left alone: frame tools (`FrameToolsToolbar`, one picker, `setActiveTool`); AI actions (chat panel routes through App handlers; palette only opens the drawer); undo/redo/save/new/open (menu, palette and keyboard call the same App handlers); `CustomLayoutDesigner` in 3 hosts (already one shared component; hosts are different contexts); QA surfaces (different scopes, not duplicates); font pickers (Design panel `FontDropdown` vs floating toolbar `<select>` — quick vs full, same library, same change handler); Home recent-projects / ".keter open" cards.

## 3. Part C — "Edit text in place" (top priority, user-named)

### Root cause — three compounding faults, all in the activation/focus path

The commit path itself was verified sound first: button → `setEditingUnitId` → `handleCommitInPlaceUnitEdit` → `ProjectPersistenceEngine.updateContentUnitText` → `UndoRedoHistoryManager` (500 steps, coalesced) → autosave works — which is why the Story Editor's `ContentEditorModal` path (same commit handler) kept working while this button's path did not. The breaks were all between the button and the commit. Reproduced in real Chromium on the unfixed tree with an instrumented scratch copy before changing anything (the editor opened and died within ~10ms of the button click; a word click opened it and the same click closed it again).

1. **Focus steal (the reported symptom)** — `src/components/PageCanvas.tsx`, the `editingUnitId` sync effect: 10ms after the button opened the editor, it focused the hidden input bridge. The contenteditable overlay blurred, its `onBlur={commit}` committed the *unchanged* text and closed the editor — so it lived ~10ms and typing went nowhere. Same steal at the other four `hiddenInputRef.current?.focus()` sites (global mouseup listener, line mousedown, word mousedown, word double-click).
2. **Click retarget** — a mousedown on a word opened the editor, the overlay covered the word, and the ensuing `click` was retargeted onto the page sheet (`target === currentTarget`), whose empty-space handler ran `exitInPlaceEditing()` + `onSelectUnit(null)` in the very click that opened the edit. Single-click and double-click died identically (the word's `onDoubleClick` never fired). This is the same mechanism behind the known open issue "single-click word selection doesn't stick".
3. **Page jump** — selecting a unit grew the Control Panel (34→70px) and floating-toolbar wrapper (62→71px) in-flow, shifting the canvas down 45px, so the second click of a double-click landed on empty sheet where the word had been, blurring the editor shut. (Also: every word click made the page hop.)

### Fix (4 source files, no new strings)

- `src/components/PageCanvas.tsx` — new refs (`enableContentEditableEditingRef`, `pointerDownOnTextRef`, `editingUnitIdRef`); all five hidden-input focus sites guarded by `!enableContentEditableEditingRef.current` (the Stage-17I hidden-input caret path is untouched when the flag is off); word/line pointerdowns mark `pointerDownOnTextRef` so the three empty-space `onClick` clear sites never treat a text click as "clicked empty space" (genuine empty clicks still clear); `preventDefault()` on word/line mousedown so a mousedown on another word cannot blur an open contenteditable; `commitUnitEdit` only moves the caret when the committed unit is still the active edit; overlay `onCommit`/`onCancel` exit only when the committed unit is the active edit.
- `src/components/InlineTextEditor.tsx` — unit-switch commit: when the edited unit changes under the editor, the previous unit's pending text is committed through its own `onCommit` before the box swaps (otherwise uncommitted keystrokes were silently lost).
- `src/App.tsx` + `src/components/ControlPanel.tsx` — `min-h-[71px]` / `min-h-[70px]` reserving the selected-state bar heights, so the canvas never moves on selection (`min-h`, not fixed height, so taller content can still grow the bar).

Result: click the button (or double-click a text frame) → text becomes editable in place → typing edits the actual unit → edits save into the project + 500-step undo history + exports (same commit path as the working Story Editor; save/reload round-trip proven in Test D + §D).

## 4. Merge notes (coordinator)

Three-way merges (`git merge-file`, base v0.9.1) of the files two parts touched — `src/App.tsx` (B + C), `src/components/ControlPanel.tsx` (B + C), `scripts/v090-partB-smoke.ts` (A + B) — all clean, zero conflict markers. Both sides' changes verified present in each merged file (B's handlers + C's `min-h-[71px]` in App; B's frame-geometry-only Control Panel + C's `min-h-[70px]`; A + B smoke expectations). Remaining `PagesPanel` / `ThumbnailOverview` mentions in the merged tree are comments only, zero code references in `src/`.

One merge fix by the coordinator: `scripts/v092c-playwright-smoke.mjs` `createBlankProject` still drove the removed Home inline wizard (`getByText('פרויקט נקי להזנת תוכן')` timed out on the merged tree). Re-pointed to the new modal flow exactly as Part B re-pointed the v081/v091 Playwright smokes (role-based clicks; modal option buttons contain inner divs that intercept text-based clicks). The product code was not at fault — the test's setup path was stale.

## 5. Files changed vs v0.9.1 (38 diff entries)

- New: `src/engine/layout-presets.ts`, `src/engine/page-labels.ts`, `src/engine/text-style-apply.ts`, `scripts/v092a-audit-smoke.ts`, `scripts/v092b-uniformity-smoke.ts`, `scripts/v092b-playwright-smoke.mjs`, `scripts/v092c-edit-in-place-smoke.ts`, `scripts/v092c-playwright-smoke.mjs`.
- Deleted: `src/components/PagesPanel.tsx`, `src/components/ThumbnailOverview.tsx` (cannot be deleted by the push tool — see §7).
- Modified: `package.json` (version only), `src/App.tsx`, `src/components/AiChatPanel.tsx`, `src/components/AutomatedTestPanel.tsx`, `src/components/ControlPanel.tsx`, `src/components/CustomLayoutDesigner.tsx`, `src/components/DesignTypesettingPanel.tsx`, `src/components/EditorialStudioHeader.tsx`, `src/components/FloatingContextToolbar.tsx`, `src/components/FrameContextMenu.tsx`, `src/components/HomeWorkspaceView.tsx`, `src/components/InlineTextEditor.tsx`, `src/components/NewProjectModal.tsx`, `src/components/PageCanvas.tsx`, `src/components/PageNavigatorSidebar.tsx`, `src/engine/auto-layout.ts`, `src/engine/custom-layout-engine.ts`, `src/engine/layout-recipes.ts`, `src/engine/pagination-engine.ts`, `src/engine/qa-engine.ts`, `src/i18n/strings.ts`, `scripts/integrator-smoke.ts`, `scripts/partA-smoke.ts`, `scripts/v070-smoke.ts`, `scripts/v081-playwright-smoke.mjs`, `scripts/v090-partB-smoke.ts`, `scripts/v091-playwright-smoke.mjs`.
- Preserved: `MANIFEST-v0.9.1.md` (the v0.9.1 manifest, kept in the tree). Part records `PART-A.md` / `PART-B.md` / `PART-C.md` live in the part trees, not in this tree.

## 6. Verification (merged tree, scratch copy `~/workspace/.v092-verify/`)

- `npm install` PASS, `npx tsc --noEmit` PASS (zero errors), `npm run build` PASS (2.45s).
- New smokes: v092a-audit **82/82**, v092b-uniformity **37/37**, v092c-edit-in-place **20/20**.
- Regressions all green: v091 **16/16**, v090 **53/53**, v090-partA **126/126**, v090-partB **91/91**, v090-partC **73/73**, v081 **22/22**, v080 **38/38**, v070 **76/76**, partA exit 0, partB **77/77**, partc **46/46**, partC-render **47/47**, partD **86/86**, partE **17 passed / 1 skipped**, integrator **24/24**.
- Playwright (real Chromium, built `dist/`, `TMPDIR=~/workspace/.tmp-chrome` — `/tmp` is a 512M tmpfs): v081 **11/11**, v091 **23/23**, v092b **22/22**, v092c **32/32** (button path, double-click path, Ctrl+Z/Ctrl+Y, reload + autosave restore, empty-space click still clears, mid-edit unit switch with no data loss; no page errors).
- `stage13a3` PDF smoke not re-run on the merged tree (skips on missing TTF fonts in `public/fonts` — pre-existing environmental skip, same as prior versions).

## 7. Not done / known open (and why)

- **Story Editor vs "Edit text in place"** — both edit the same unit's text (right-click "עורך סיפור (Story Editor)" vs floating toolbar "ערוך טקסט במקום"). Part B deliberately left the Story Editor alone because in-place was the reported-broken feature and removing the Story Editor would have removed the only working entry point. Now that in-place works, the one-editor decision is still open for a future pass — both entry points work, they are not duplicates that break anything.
- **13 pre-existing failing tests in the Automated Test panel** (t-30, t-32, t-39, t-47, t-59, t-62, t-67, t-75, t-86, t-96, t-104, t-105, t-131), now visible because A6 un-crashed the panel (it now reports 97/110, 88%, measured 2505.3 ms). Proven pre-existing by running the suite on the pristine v0.9.1 tree with only the crash neutralised (same 13 fail there). Each needs its own diagnosis pass — several look like stale test expectations, not engine bugs (e.g. t-30 expects 5 active links, the engine now produces 8).
- **Single-click word selection** — fixed as a side effect of Part C's Fault 2 (click retarget): a click that starts on text is no longer treated as an empty-space click. The v0.8.1 note ("right-click 'מחק יחידה' disabled after a word-click") should be re-verified live on the installed app; the mechanism behind it is fixed in code.
- **Part C cosmetic quirks (out of scope, not regressions):** the overlay editor's text sits ~one line below the block's first line (mini-toolbar occupies the top of the box); double-click places the caret but does not range-select the word inside the editor; deleting all text in the editor and committing is a no-op (pre-existing `commitUnitEdit` empty-text early return, same as the hidden-input path).
- **Part C note:** exports (PDF/IDML) were not re-run end-to-end for the edit chain — the edit flows through the same `contentUnits` state and the same commit path as the working Story Editor modal, and the save/reload round-trip proves the edited text is in the persisted project that exports read from.
- **Push note:** `push-files` cannot delete files, so `PagesPanel.tsx` and `ThumbnailOverview.tsx` will remain in the remote repo as unimported dead files after the push (same as the v0.4.0 deletions). Delete them from the repo separately if a clean remote is wanted.
- **No pushes, no GitHub writes, no installer build** — per the task. Push + rebuild await the user saying he is watching and ready to tap approve.
