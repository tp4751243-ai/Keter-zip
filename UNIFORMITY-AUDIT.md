# UNIFORMITY AUDIT — KETER-TYPE v0.9.8

Final UI/UX pass over the merged v0.9.8 tree (all 6 phases done). Method:
verify-first — every finding below was checked against the source with
file:line evidence before any fix, and every fix is covered by the new
`scripts/v098-uniformity-smoke.ts` (83 checks) and the live Playwright
drive `scripts/v098-uniformity-playwright-smoke.mjs` (35 checks, 0 page
errors). Do NOT push / build on GitHub / deliver an installer from this
tree — the coordinator consolidates this record into MANIFEST.md.

Scope audited: Sefer Wizard (Steps 1–3), DOCX hub (inline + modal),
Design / Quick-Tune panel, canvas toolbars (`PageCanvas`,
`FloatingContextToolbar`, `ControlPanel`), navigator
(`PageNavigatorSidebar`), export view (`ExportWorkspaceView`), anchor
overlay, every dialog including the new wizard dialogs.

## (1) Duplicate entry points — the 8 v0.9.2 consolidations

| # | Consolidation (v0.9.2) | Holds in v0.9.8? |
|---|---|---|
| B1 | Page navigation → navigator sidebar only | YES. `PagesPanel.tsx` / `ThumbnailOverview.tsx` deleted (only comments remain, `PageNavigatorSidebar.tsx:43,75,283`, `App.tsx:354`). |
| B2 | Text styles → one shared handler | YES. `ControlPanel.tsx` is frame-geometry only (header "גאומטריית מסגרת"); one handler `src/engine/text-style-apply.ts`. |
| B3 | Export → Export workspace only | YES. Header has no `onExportPdf` / `onExportIdml`; header keeps "ייצוא לדפוס" → Export workspace. |
| B4 | Layout pickers → one list | YES. `src/engine/layout-presets.ts` (`CORE_START_LAYOUTS` in `NewProjectForm.tsx:362`; `LAYOUT_PRESET_OPTIONS` in `EditorialStudioHeader.tsx:34,538`). |
| B5 | Knee guide → floating toolbar + Design panel | YES. No knee toggle in header; toggle in floating toolbar (`FloatingContextToolbar.tsx:401`, `onToggleKneeGuide`) + Design panel rav_text tab. |
| B6 | New project → New Project modal only | SUPERSEDED DELIBERATELY in v0.9.7. Home renders the shared `NewProjectForm` inline AND `NewProjectModal` hosts it; same component, two hosts, same behaviour (`HomeWorkspaceView.tsx:410-435`, `App.tsx:1396-1404`). Not a regression. |
| B7 | DOCX import → import modal only | SUPERSEDED DELIBERATELY in v0.9.7. Same pattern: Home renders shared `DocxImportHub` inline AND `DocxImportModal` hosts it (one component, two hosts). |
| B8 | Unified naming ("מרכוז אוטומטי") | YES. Identical wording at all 4 entry points (`ControlPanel.tsx:165`, `DesignTypesettingPanel.tsx:1459`, `FloatingContextToolbar.tsx:392`, `FrameContextMenu.tsx:56`). |

New surfaces checked for re-duplication:

- **Quick-Tune** (Phase 5 first tab of the Design panel) repeats
  trim / margins / zone-typography / header controls that also exist in
  other Design tabs. DELIBERATE: quick-vs-full view inside the same
  panel, same handlers (v0.9.2 font-picker precedent), not a second entry
  point.
- **Two "ייצוא לדפוס" buttons** (header work-mode switcher + Guided
  Steps bar step) both go to the Export workspace — same destination,
  different contexts (mode switch vs guided-step navigator), not a
  duplicate to remove. Noted because the Playwright drive hit a strict-
  mode violation on the shared name; the script now targets the header
  button by its title.
- **Dead `showLinks`** — FIXED (see §3).
- **Three text editors** — RESOLVED (see §6).

## (2) Inconsistent naming

- "עוגנים" (nikud/taamim anchor marks, `App.tsx` More-tools row) read as
  dibbur-anchor links next to "קישורי ד״ה" → renamed **"סימני ניקוד"**
  (`src/i18n/strings.ts`: "הצג סימני ניקוד וטעמים על העמוד" /
  "Show nikud and taamim marks on the page"). Live-verified: "עוגנים"
  appears nowhere on the page; the button reads "סימני ניקוד".
- Story Editor rendered raw role ids (`[{u.role}]`, e.g.
  `[main_source]`) → strict role-label table (see §6).
- `ContentEditorModal` header mixed English: "עריכת תוכן והזנת טקסטים
  חופשיים (Custom Holy-Book Content)" → renamed (see §6).
- Whole-tree `t("...")` sweep (785 literals): 3 Phase-5 stragglers were
  genuinely missing from `EN_STRINGS` and were added ("קישור מחדש של
  דיבור המתחיל", "לא נמצאה השורה לחלוקה — נסו שורה אחרת.", "לא נמצאה
  השורה למשיכה — נסו שורה אחרת."). Three more apparent misses were FALSE
  POSITIVES of the first sweep script (escaped quotes / `\n` compared raw
  vs parsed keys); the corrected sweep unescapes captures via
  `JSON.parse` and passes.

## (3) Dead / promising-but-dead controls — fixed

- **`showLinks` state** (`App.tsx:308`, default true): `PageCanvas`
  accepted the prop but never read it (only declaration/default lines),
  no UI ever toggled it → **REMOVED** (state + prop + PageCanvas prop).
- **`DocxImportHub` `variant="dark"` tone map**: only caller left was the
  modal; after dialog unification the modal uses light tone → **dark tone
  REMOVED** (type now `'light'` only); leftover `divide-stone-800` in hub
  line 721 fixed to a theme var.
- **`ContentEditorModal` sample presets** (5 buttons loading sample
  books) duplicated New Project sample mode, and one click wiped the open
  book's text → **REMOVED** (function + bar; slim Clear-All-only row
  remains).
- No empty `onClick={() => {}}` handlers anywhere in `src/`.
- `AiChatPanel.tsx:1038` "הוספת מפרש עדיין לא מחוברת" message is a dead
  branch in practice — `App.tsx:4098` DOES pass
  `onImportCommentaryUnits`, so the AI add-commentator action works;
  left as defensive code, noted only.
- **Toast confirmations killed early — REAL BUG, FIXED.** `showToast`
  (`App.tsx:1166-1169`) scheduled an unconditional
  `setTimeout(() => setNotification(null), 4000)` per call, so an earlier
  toast's timer cleared a later toast. Found via the phase56 regression
  (see Verification): the pull-line toast's timer fired ~1s after the
  re-anchor confirmation appeared, so "הקישור עודכן" lived ~0.5–1s
  instead of 4s and the Playwright check failed. Root-caused with a
  50ms sampler (pull toast shown 2387ms → re-anchor toast shown 5288ms
  → gone 6265ms, i.e. pull+4000ms − ~120ms render lag). Fix: a
  `toastTimerRef` — each new toast cancels the previous timer, so every
  confirmation gets its full 4s. Pre-existing (old `showToast`, not Phase
  1–6 code); the test caught a real defect, so the app was fixed, not the
  test. Covered by a new uniformity-smoke check (§6).

## (4) Plain words

- Role labels, "סימני ניקוד", Content Editor rename + one plain sentence
  ("הדביקו טקסט חדש או ערכו את הקיים — פסקאות שלא נגעתם בהן נשארות
  בדיוק כמו שהן."). Story Editor header already says "תצוגת טקסט בלבד
  — ללא עימוד".
- Advanced controls stay behind "More options" per the settled
  preference; no new advanced surface was added in this pass.

## (5) Settled defaults — REAL VIOLATION FOUND AND FIXED

- `DesignSettingsEngine.createDefaultSettings`
  (`design-settings-engine.ts` ~2295): `showFolioNumber: false`,
  `showTopHeaderLine: false`, `showCommentaryLabels: false` — correct for
  fresh books. Legacy heal path (~1983) sets folio/labels `true` for
  pre-v0.5.0 saved projects — pre-existing migration, KEPT.
- **Violation**: applying a historical recipe turned header + folio ON
  (`layout-recipes.ts:1123` `showTopHeaderLine = true` when the recipe
  has running-header text; folioStyle → `showFolioNumber = true`;
  `auto-layout.ts:919-926` `folioHebrew()` / `folioDafAmud()` /
  `folioNumbersOuterTop()` called for nearly every recipe). So a wizard
  archetype pick (Shas etc.) turned folio + header ON. **Fix scoped to
  the wizard only**: `src/engine/sefer-wizard.ts` —
  `applySettledDefaultsOff(settings)` forces the three settled switches
  off via `updatePageElementsSettings`; `applyArchetypeToSettings` now
  returns `applySettledDefaultsOff(applyRecipeToSettings(...))`;
  `archetypeDefaultsSummary` folio fragment now reads
  `· folio <style> (off by default)`. `App.tsx` `handleImportUnits`
  uses `applyArchetypeToSettings` when a pending archetype exists (else
  the classifier recipe whole); the blank-create pending-recipe block
  consumes the pending archetype and forces settled defaults off.
  `NewProjectForm.tsx` saves the pending archetype ONLY if it has a
  `recipeId` (avoids a stale 'classic' steering a later import).
  Live-verified: Quick-Tune running-header switch is OFF after a wizard
  import (`checked=false`).
- DELIBERATE, unchanged: applying a recipe directly in the Design panel,
  or the auto-layout import decision, still applies the recipe whole
  (folio/header ON) — pre-existing v0.9.7 behaviour; the wizard is the
  new-user path, the panel is the explicit-designer path.

## (6) Story Editor vs Edit-in-Place — RESOLVED

Three text-editing surfaces existed; the decision is made, not left open:

1. **Edit-in-place — CANONICAL.** Double-click a word on the page →
   `InlineTextEditor` overlay (`PageCanvas.tsx:2358,2572`); floating-
   toolbar button "ערוך טקסט במקום" (`FloatingContextToolbar.tsx:221`);
   commits via `handleCommitInPlaceUnitEdit` (undoable). This is the one
   text-editing entry point a user is taught.
2. **StoryEditor — SUBORDINATE, kept.** Whole-book plain-text view
   replacing the canvas (`App.tsx:3856`, `storyView` state). Entry points:
   Ctrl+Tab toggle (`App.tsx:1649`), right-click context menu "עורך סיפור
   (Story Editor)" (`FrameContextMenu.tsx:62-63`, `App.tsx:3993`), and
   auto-open after the Type tool creates an empty unit (`App.tsx:1320`, a
   creation flow, not an editing entry). No header/toolbar button. Header
   already labels it "תצוגת טקסט בלבד — ללא עימוד". Why kept: it is the
   only whole-book plain-text view (proofing a full sefer), which
   edit-in-place cannot do. Why subordinate: it is not advertised next to
   editing; its header says plainly it is text-only, no pagination.
   Plain role names now via strict `CONTENT_ROLE_LABELS`
   (`src/i18n/strings.ts`, `Record<ContentRole, BilingualLabel>`, 26
   roles, HE+EN, distinct) — live-verified: "טקסט ראשי", no
   `[main_source]`.
3. **ContentEditorModal — REPOSITIONED, not a third editor.** Bulk
   paste-by-role that REPLACES whole-book text (preserves unchanged
   paragraphs by text match; new units keep `linkedSourceId` where
   matched). Menu "עריכת כל הטקסט של הספר..." → renamed **"החלפת כל
   הטקסט של הספר..."** (header "החלפת כל הטקסט של הספר"); sample presets
   removed (§3); layout switch removed (`activeLayout` is now just
   `layoutType` — no UI ever changed it). The rename says what it does:
   replace, not edit.

## (7) Dialogs — REAL INCONSISTENCY FOUND AND FIXED

- Shared classes `.keter-dialog-backdrop` / `.keter-dialog-surface`
  existed in `src/index.css:165-177` but **ZERO components used them**.
  Backdrops were ad-hoc `bg-black/45`, `/50`, `/75`, `/80`, `/90`,
  `bg-[#0B0F17]/80`. Cards: theme-var dialogs (NewProjectModal,
  SecondaryDocxImportModal, ShasQaPanel, UnsavedChangesModal,
  WelcomeModal) vs hardcoded dark `bg-stone-900` cards (DocxImportModal,
  ContentEditorModal, FontScannerPanel, Milestone1ReportModal,
  SuggestionReviewPanel, TypesettingRulesModal, AutomatedTestPanel) vs
  hex-dark `bg-[#0F1623]` (GeminiKeyModal, LicenseActivationModal).
  Default theme is DAY (`App.tsx:329`), so dark cards were wrong in day
  mode. v0.9.6 smoke §3 had blessed stone-900 as "deliberate" —
  superseded by this pass.
- **Migrated to the shared backdrop/surface + theme vars, with
  `useEscapeToClose`** (new `src/components/useDialogEscape.ts`, capture-
  phase Escape handler) **and backdrop-click close**: DocxImportModal
  (hub variant `"dark"`→`"light"`), FontScannerPanel,
  Milestone1ReportModal, SuggestionReviewPanel, TypesettingRulesModal,
  AutomatedTestPanel, GeminiKeyModal, LicenseActivationModal,
  NewProjectModal, SecondaryDocxImportModal, UnsavedChangesModal
  (close prop is `onCancel` — Escape/backdrop map to `onCancel`),
  ShasQaPanel, WelcomeModal (backdrop keeps z-70 via
  `style={{ zIndex: 70 }}` + `keter-fade-in`). PDF export progress overlay
  → shared classes too (not closable by design). Live-verified: DOCX
  modal card computed background `rgb(255, 255, 255)` (opaque, day
  theme); Escape closes the import and New Project modals.
- **Close behaviour unified**: previously only CommandPalette handled
  Escape; only WelcomeModal closed on backdrop click. Now every dialog
  closes on Escape and backdrop click, EXCEPT ContentEditorModal (no
  Escape / no backdrop-click BY DESIGN — it holds unsaved pasted text;
  closes only via ✕ / Cancel / Save; asserted in the smoke script).
- **Six dialog ✕ buttons had no `title`/`aria-label`** (DocxImportModal,
  ContentEditorModal, FontScannerPanel, Milestone1ReportModal,
  AutomatedTestPanel, TypesettingRulesModal) → `title="סגור"` added
  (plain string for the two with no i18n; `t("סגור")` elsewhere).
  WelcomeModal ✕ already had `aria-label={t('סגור')}`. Smoke now asserts
  every dialog ✕ carries a title/aria-label ("סגור" / "ביטול").
- **Re-anchor hint bar was `z-50`** (`PageCanvas.tsx:2198`) — lowered to
  `z-40` per the v0.9.6 §4 rule (canvas-local overlays ≤ z-40, never
  cover a dialog).
- `PageCanvas.tsx:2150` `bg-black/90` is the fullscreen preview, NOT a
  dialog — left alone. CommandPalette keeps its own top-anchored backdrop
  (palette, not dialog) with same dim + Escape.
- Deliberate leftovers in dialogs: `FontScannerPanel.tsx:480`
  font-preview swatch `bg-[#FCFAF5] text-stone-900` is paper-coloured
  content, kept; gold gradient buttons in Gemini/License keep dark
  `text-[#0B0F17]` (correct contrast on gold in both themes).

## Files changed vs the inherited tree

- NEW `src/components/useDialogEscape.ts` — shared Escape-to-close hook.
- `src/i18n/strings.ts` — "סימני ניקוד" renames; 3 missing Phase-5 keys;
  Content Editor keys; strict `CONTENT_ROLE_LABELS`
  (`Record<ContentRole, BilingualLabel>`, 26 roles).
- `src/engine/sefer-wizard.ts` — `applySettledDefaultsOff`,
  `applyArchetypeToSettings` forces settled defaults off,
  `archetypeDefaultsSummary` folio fragment.
- `src/App.tsx` — imports `applyArchetypeToSettings` /
  `applySettledDefaultsOff`; `handleImportUnits` + blank-create use the
  wizard path; dead `showLinks` removed; "עוגנים" → "סימני ניקוד";
  PDF export overlay → shared dialog classes; **toast timer fix**
  (`toastTimerRef` — each new toast cancels the previous dismissal
  timer).
- `src/components/NewProjectForm.tsx` — saves pending archetype only
  when it has a `recipeId`.
- `src/components/StoryEditor.tsx` — `CONTENT_ROLE_LABELS` + `lang`.
- `src/components/EditorialStudioHeader.tsx` — File-menu item renamed.
- `src/components/PageCanvas.tsx` — `showLinks` prop removed; re-anchor
  hint bar z-50 → z-40.
- `src/components/ContentEditorModal.tsx` — sample presets removed;
  `activeLayout` state removed; header renamed + plain sentence; shared
  backdrop/surface + theme vars; no Escape/backdrop-close by design.
- `src/components/DocxImportHub.tsx` — dark tone map deleted
  (`'light'` only); `divide-stone-800` → theme var.
- Dialog migration (shared backdrop/surface + theme vars +
  `useEscapeToClose` + ✕ titles): DocxImportModal, FontScannerPanel,
  Milestone1ReportModal, SuggestionReviewPanel, TypesettingRulesModal,
  AutomatedTestPanel, GeminiKeyModal, LicenseActivationModal,
  NewProjectModal, SecondaryDocxImportModal, UnsavedChangesModal,
  ShasQaPanel, WelcomeModal.
- `scripts/v096-smoke.ts` — §2/§3/§4 updated for the shared dialog
  classes (incl. welcome z-70 via `zIndex: 70`, export overlay shared
  classes, PageCanvas z-50 check strips `//` comments).
- `scripts/v097-smoke.ts` — "DocxImportModal is a thin shell" assertion
  updated `variant="dark"` → `variant="light"` (this audit's own change).
- NEW `scripts/v098-uniformity-smoke.ts` — 83 checks in 7 sections
  (§1 canonical entry points incl. B1–B8 + v0.9.8 surfaces; §2 labels
  incl. whole-tree `t()` sweep with `JSON.parse` unescaping; §3 settled
  defaults incl. live `applyArchetypeToSettings` per archetype; §4
  dialogs; §5 Story Editor decision; §6 dead controls + toast timer;
  §7 version).
- NEW `scripts/v098-uniformity-playwright-smoke.mjs` — sections A–L,
  35 checks, 0 page errors; screenshots `screenshots/v098/20–29`.

## Verification

- `npm install` PASS; `npx tsc --noEmit` clean; `npm run build` PASS.
- `scripts/v098-uniformity-smoke.ts`: **83 passed, 0 failed**.
- `scripts/v096-smoke.ts`: **191 passed, 1 failed** — only the expected
  version check (expects 0.9.6, package is 0.9.8). Pristine v0.9.7 tree:
  163 passed, 1 failed (version only) — the PageCanvas z-50 pill failure
  was introduced by Phase 5's re-anchor hint bar (absent in v0.9.7),
  fixed by z-40.
- Regression battery (final run, after the toast fix):
  phase1 **66/0**, phase2 **54/0**, phase3 **65/0**, phase4 **34 passed,
  2 failed** (known pre-existing Rule 3 / Rule 2 flush gap, 25.4pt vs
  19.14pt tolerance — unchanged), phase5 **52/0**, phase6 **21/0/0**
  (with `KETER_FONTS_DIR=/tmp/keter-fonts`; 16/0/3 skipped without
  fonts), v097 **73 passed, 1 failed** (version only),
  `partE-smoke.ts` **18/0/0**, `verify_sefer_pipeline.ts` **19/0/0**.
- Playwright (real Chromium, static server over `dist/`):
  uniformity **35 passed, 0 failed**; phase1 **35/0**; phase34 **22/0**;
  phase56 **22/0** (was 21/1 before the toast fix — the re-anchor toast
  check; root cause and fix in §3). 0 JS page errors, 0 same-origin
  failures in every drive. One external resource is unreachable in this
  sandbox (Google Fonts css2 — pre-existing, sandbox-only, not counted).
- Live evidence captured: DOCX modal card `rgb(255, 255, 255)` opaque in
  day theme; Quick-Tune running-header switch OFF after wizard import;
  anchor overlay drew 22 connectors; Story Editor showed "טקסט ראשי",
  no `[main_source]`; double-click opened 1 contenteditable element;
  "עוגנים" appears nowhere on the page; re-anchor toast now survives
  its full 4s.

## Screenshots (`screenshots/v098/`)

- `20-home-wizard.png` — Home with the wizard (5 archetypes, 11 core layouts)
- `21-docx-modal.png` — DOCX import modal, light solid card (visually checked)
- `22-new-project-modal.png` — New Project modal
- `23-editor.png` — editor after wizard import
- `24-quick-tune-defaults.png` — Quick-Tune with settled defaults off
- `25-anchor-overlay.png` — anchor overlay, 22 connectors
- `26-story-editor.png` — Story Editor with plain role labels
- `27-content-editor.png` — Content Editor, renamed header, no presets
- `28-export-workspace.png` — Export workspace
- `29-wizard-en.png` — wizard rendered in English (no Hebrew text remains)

## Deliberately left (with reasons)

- B6/B7 two-host shared components (Home inline + modal host) — v0.9.7
  deliberate; one component, same behaviour.
- Quick-Tune as same-panel quick view — same handlers, not a second
  entry point.
- Design-panel recipe pick / auto-layout import still apply a historical
  recipe whole (folio/header ON) — pre-existing v0.9.7 behaviour; the
  wizard-only fix covers the new-user path.
- CommandPalette keeps its own top-anchored backdrop (palette, not dialog).
- ContentEditorModal has no Escape/backdrop-close by design (unsaved
  pasted text).
- FontScannerPanel paper preview swatch; gold-button dark text — correct
  contrast, kept.
- Legacy-settings heal keeps folio/labels ON for pre-v0.5.0 projects
  (migration, not a default).
- `AiChatPanel.tsx:1038` "not connected" message — defensive branch; the
  action works (`App.tsx:4098` passes `onImportCommentaryUnits`).
- Two "ייצוא לדפוס" buttons (header mode switch + Guided Steps bar) —
  same destination, different contexts.

## Honest leftovers — needs the user's live try on the installed app

- The dialog unification was verified in real Chromium at 1440×900 in
  day theme. Night theme dialog rendering was verified by the smoke
  (theme vars defined in both blocks, v0.9.6) but not eyeballed
  screenshot-by-screenshot in this pass — worth one look on the
  installed app.
- The toast fix is verified live (phase56 22/0), but a real user doing
  rapid actions (push → pull → re-anchor within seconds) is the true
  test — the failure only showed up at machine-speed timing.
- The Story Editor decision (edit-in-place canonical, Story Editor
  subordinate) is a UX call: if he actually proofs whole books in the
  Story Editor daily, its Ctrl+Tab / right-click entries may deserve a
  visible home; if not, they stay tucked away as they are.
- The wizard-only settled-defaults fix means a user who picks a
  historical recipe in the Design panel still gets folio/header ON — if
  he expects OFF everywhere, that panel path needs the same treatment;
  it was left as-is because it is the explicit-designer path and
  changing it would alter v0.9.7 behaviour.
