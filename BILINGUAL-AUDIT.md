# BILINGUAL AUDIT — KETER-TYPE v0.9.8

**Auditor:** Bilingual Audit worker (last verification pass of v0.9.8)
**Date:** 2026-11-15
**Tree:** `~/workspace/KETER-TYPE-v0.9.8/` (`package.json` 0.9.8; all 6 phases + uniformity audit done before this pass)
**Verdict: PASS.** No missing keys in either language, no silent fallback left in any user-visible surface the audit could reach, RTL/LTR verified live in both locales, plurals fixed. The tree compiles clean and the full regression battery matches the inherited baseline (only the two known pre-existing failures remain, plus version-check failures in the old v0.9.6/v0.9.7 smokes, which are expected on a 0.9.8 tree).

**Headline numbers**

| Measure | Result |
|---|---|
| `EN_STRINGS` keys | **1,626** (was 2,882 at audit start) |
| `EN_STRING_TEMPLATES` (`tf()` templates) | **85** (was 0; 32 in pass 1, +13 pass 2, +6 pass 3, +11 pass 4, +23 pass 7) |
| Literal `t('...')` call sites | 1,476 at audit start → **1,447** now (29 label renders no longer go through `t()`) |
| Missing literal `t()` keys | **0** (was 1 + 13 `labelHe` + 2 preset + 1 placeholder = 17) |
| Interpolated `t()` calls (`t(\`...${...}\`)`) | **0** (was 35) |
| Dead keys remaining (substring method) | **0** |
| Keys removed as dead | 1,311 gross, 6 restored → **1,305 net** |
| `t()` call sites converted to `tf()` | 35 (pass 1) + all composed history/toast labels (passes 2–4, 7) |
| i18n Node smoke (`scripts/v098-i18n-smoke.ts`) | **75 passed, 0 failed** (§1–§11) |
| i18n Playwright smoke (`scripts/v098-i18n-playwright-smoke.mjs`) | **50 passed, 0 failed** (Hebrew + English, 0 page errors each) |
| Existing Playwright smokes re-run | phase1 35/35, phase34 22/22, phase56 22/22, uniformity 35/35 |

---

## 1. How the audit enumerated keys (do not trust phase claims)

Three independent enumerations, all re-run at the end of the pass:

1. **`t()` sweep** (`/tmp/i18n-audit.py`, recreated after the session handover as `/tmp/i18n-audit-final.py`): every `t('...')` literal arg in `src/` checked against `EN_STRINGS`; every `t()` call checked for `${...}` interpolation; every `labelHe` / `placeholderHe` / `replyHe` value checked for an `EN_STRINGS` entry or a `labelEn` / `replyEn` sibling. Final re-run: **0 missing, 0 interpolated**.
2. **Dead-key scan** (substring method): a key counts as live if it appears as a substring anywhere in `src/` + `scripts/` outside `strings.ts` (after normalising `\"` escapes, which the TypesettingRulesModal keys need). Final re-run: **0 dead**.
3. **`scripts/v098-i18n-smoke.ts`** (§1–§11, 75 checks) re-implements the same enumeration as code so the next pass re-checks it instead of trusting this document.

### The complete-literal scan that was tried and abandoned
A stricter scan (key must appear as a *complete* quoted literal) flagged 797 keys as dead. All 797 were removed — and the scan was then proven wrong about **6 live keys** in `src/App.tsx` (its quote regex desyncs on this codebase: an odd quote count somewhere in `App.tsx` makes one giant match swallow a whole region of literals). The 6 were restored from backup with their original English values:

- `'התוכן עודכן והספר עומד מחדש בהצלחה!'` (App.tsx:1974)
- `'קובץ IDML מינימלי ידוע-כתקין (TEST A — מסכת ברכות) הופק בהצלחה!'` (2094)
- `'קובץ PDF הופק באמצעות המייצא המובנה (שרת Chromium לא זמין באפליקציה המותקנת)'` (2043)
- `'שגיאה בהפקת IDML: '` (2100), `'שגיאה בהפקת PDF: '` (2049)
- `'תיקוני ההגהה הוחלו'` (2180)

Three further candidates from that scan were correctly **not** restored (false positives: code comments / parts of interpolated templates — `'יתומים" / "אלמנות'` in `typesetting-rules-engine.ts:740`, `'מרווח פסקאות", "רווח בין פסקאות'` in `design-settings-engine.ts:6184`, `` `רש״י': 'תוספות` `` in `vilna-shas.ts:389`). The smoke's §5 therefore uses the substring method, with the documented limitation that a key which is only a *prefix* of a longer live string counts as live there.

### Note on the removed-keys list
The original removed-key files (`/tmp/dead-keys.json`, `/tmp/dead797-removed.json`, `/tmp/i18n-changes.json`) were lost when `/tmp` was cleared in the session handover. The list was **regenerated** by diffing `EN_STRINGS` in the pristine `~/workspace/KETER-TYPE-v0.9.7/` tree against this tree and saved as `scripts/v098-i18n-removed-keys.json` (1,304 keys present in v0.9.7, absent now; the file also lists the 112 keys added since v0.9.7). Reconciliation: the audit removed 1,311 keys gross and restored 6 → 1,305 net; the v0.9.7 diff shows 1,304 — the 1-key gap is a phase-added key the audit removed (it never existed in v0.9.7). The added side reconciles exactly: 64 phase-added + 38 (pass 1) + 2 (pass 2) + 3 (pass 5) + 5 (pass 7) = 112.

### The parser incident (pass 1)
The first `strings.ts` surgery script's line-anchored entry regex parsed only 2,881 of 2,882 entries and silently dropped one live key, `'הדביקו טקסט חדש או ערכו את הקיים — פסקאות שלא נגעתם בהן נשארות בדיוק כמו שהן.'` (used at `ContentEditorModal.tsx:231`). It was restored with a comment in the file. Verified after restore: old-minus-new = exactly the 504 dead keys, no unintended loss.

---

## 2. Keys added / fixed

### 2a. New `EN_STRINGS` keys (53)
The 48 in the marked `v0.9.8 Bilingual Audit` section of `strings.ts`, plus 5 just above it (passes 2/5):

| Hebrew key | English value | Why added |
|---|---|---|
| `היבוא מוכן, אך יש אזהרות — יש לסקור אותן לפני ההמשך.` | The import is ready, but there are warnings — please review them before continuing. | missing literal `t()` in `DocxImportHub.tsx:485` |
| `אוטומטי: מספר העמוד` | Automatic: page number | Design-panel running-header placeholder |
| `אוטומטי: תווית המהדורה` | Automatic: edition label | Design-panel running-header placeholder |
| `אוטומטי: שם הספר` | Automatic: book name | center running-header placeholder (found in pass 4) |
| `הצג כותרת פרק / מהדורה בכותרת` | Show the chapter / edition title in the header | Design-panel toggle label |
| `הצג מספר עמוד בכותרת` | Show the page number in the header | Design-panel toggle label |
| `הצג שם ספר בכותרת` | Show the book name in the header | Design-panel toggle label |
| `טקסט באמצע בעמוד זה` | Middle text on this page | running-header per-page field |
| `טקסט באמצע — שם הספר` | Middle text — book name | running-header field |
| `טקסט מימין בעמוד זה` | Right text on this page | running-header per-page field |
| `טקסט מימין — מספר העמוד` | Right text — page number | running-header field |
| `טקסט משמאל בעמוד זה` | Left text on this page | running-header per-page field |
| `טקסט משמאל — כותרת פרק / מהדורה` | Left text — chapter / edition title | running-header field |
| `פירוש משני (תוספות / ש״ך)` | Secondary commentary (Tosafot / Shakh) | `ROLE_OPTIONS` entry |
| `חומש עם ראשונים` | Chumash with Rishonim | `layout-presets.ts` labelHe |
| `משנה עם ברטנורא` | Mishnah with Bartenura | `layout-presets.ts` labelHe |
| `למשל: הרב אליהו טוגר` | e.g. Rabbi Eliyahu Touger | TitlePagePanel placeholder |
| `הקטן את מסגרת עמוד השער` | Shrink the title-page frame | missing `AI_EXAMPLE_PROMPTS` entry |
| `אאמת שכל דיבור מתחיל תואם את מילות הגמרא.` | I will verify that every dibbur hamatchil matches the Gemara words. | plain AI `replyHe` (vilna-shas) |
| `אבדוק את יישור הערות השוליים בכל הדפים.` | I will check the footnote alignment on all pages. | plain AI `replyHe` (vilna-shas) |
| `אבדוק את רצף מספרי הדפים (א׳/ב׳).` | I will check the folio number sequence (a/b). | plain AI `replyHe` (vilna-shas) |
| `אבדוק את רצף מספרי הדפים של הספר היידיש.` | I will check the folio number sequence of the Yiddish sefer. | plain AI `replyHe` (yiddish-sefarim) |
| `אחיל את כללי היידיש: כותרת פרשה ממורכזת, גוף מיושר ללא הזחה בפתח.` | I will apply the Yiddish rules: centred parashah heading, justified body with no opening indent. | plain AI `replyHe` (yiddish-sefarim) |
| `אחיל את כללי וילנא: כותרת פרק ממורכזת, הזחה בשורה השנייה, דיבור מודגש.` | I will apply the Vilna rules: centred chapter heading, second-line indent, bold dibbur. | plain AI `replyHe` (vilna-shas) |
| `אסווג מחדש את יחידות היידיש: צאינה וראינה, תרגום, ביאור ומקור עברי.` | I will re-classify the Yiddish units: Tzenerene, translation, commentary, and Hebrew source. | plain AI `replyHe` (yiddish-sefarim) |
| `אסרוק את הדפים לפגמי עימוד ש״ס ואתקן את הניתנים לתיקון אוטומטי.` | I will scan the pages for Shas typesetting flaws and fix the ones that can be fixed automatically. | plain AI `replyHe` (vilna-shas) |
| `אפתח את בורר התבניות כדי לבחור עימוד אחר.` | I will open the template picker to choose a different layout. | plain AI `replyHe` (auto-layout) |
| `אקרב את רש״י לעמודת הגמרא (הקטנת המרווח). יש לאשר בכרטיס.` | I will bring Rashi closer to the Gemara column (reducing the spacing). Please approve on the card. | plain AI `replyHe` (vilna-shas) |
| `ארחיב את טור תוספות. יש לאשר בכרטיס.` | I will widen the Tosafot column. Please approve on the card. | plain AI `replyHe` (vilna-shas) |
| `הערה` | Note | singular for `formatPreviewCounts` |
| `קושר` | linked | singular for `formatLinkingReportSummary` |
| `ממתין לסקירה` | awaiting review | singular for `formatLinkingReportSummary` |
| `לא קושר` | unlinked | singular for `formatLinkingReportSummary` |
| `אלמנה` | widow | singular for balance toasts |
| `טור אוזן` | column balanced | singular for balance toasts |
| `בעמוד השער עודכן` | updated on the title page | TitlePagePanel history-label suffix |
| `— גופן עודכן` | — font updated | TitlePagePanel history-label suffix |
| `— גודל עודכן` | — size updated | TitlePagePanel history-label suffix |
| `— יישור עודכן` | — alignment updated | TitlePagePanel history-label suffix |
| `— מרווח עודכן` | — spacing updated | TitlePagePanel history-label suffix (×2 sites) |
| `— מרווח שורות עודכן` | — line spacing updated | TitlePagePanel history-label suffix |
| `חפיפה` | Overlap | singular for export QA counts (pass 7) |
| `התראה` | Alert | singular for export QA counts (pass 7) |
| `התראות` | Alerts | plural for export QA counts (pass 7) |
| `קובץ` | File | singular for hub import button (pass 7) |
| `קבצים` | files | plural for hub import button (pass 7) |
| `לא זוהה כלל מובנה בהוראה זו. נסה למשל: "לעולם אל תשאיר כותרת עם פחות מ-3 שורות המשך"` | No built-in rule was recognised in this instruction. Try e.g.: "Never leave a heading with fewer than 3 continuation lines" | `TypesettingRulesModal.tsx:157` (pass 5) |
| `למשל: "לעולם אל תשאיר כותרת עם פחות מ-3 שורות המשך" או "אל תוסיף עיטורים אוטומטית"` | e.g.: "Never leave a heading with fewer than 3 continuation lines" or "Do not add ornaments automatically" | `TypesettingRulesModal.tsx:258` (pass 5) |
| `קיימים שינויי תוכן או עיצוב שטרם נשמרו לקובץ פרויקט (\`.keter.json\`).` | There are content or design changes not yet saved to the project file (`.keter.json`). | `UnsavedChangesModal.tsx:53` — the `t()` arg was a multi-line literal that could never match a key; the call site was changed to this single-line key (pass 5) |

### 2b. `tf()` parameterized templates (85)
`t()` can only look up an exact literal, so any template literal with `${...}` interpolation **never** translates — all 35 such `t()` sites were converted to the new `tf(heTemplate, params)` helper in `src/i18n/LanguageContext.tsx` (`tf` looks the whole template up in `EN_STRING_TEMPLATES`, falls back to the Hebrew template itself, substitutes `{key}` placeholders verbatim, and leaves unknown placeholders as `{key}`). Callers pass already-localized or language-neutral values (numbers, ids, file names, `nameEn`/`nameHe` chosen by `lang`).

Pass 7 added 23 templates (the rest were added in passes 1–4; the full list lives in `EN_STRING_TEMPLATES` in `strings.ts`):

| Hebrew template | English template |
|---|---|
| `שמירה ברקע זוהתה: {time}` | Background save found: {time} |
| `נשמר אוטומטית ב-{time}` | Autosaved at {time} |
| `מחלץ טקסט מתוך {name}...` | Extracting text from {name}… |
| `ייבא {count} {files} ועמד ספר` | Imported {count} {files} and typeset a book |
| `הפקת קובץ PDF הושלמה בהצלחה! הקובץ "{name}" הורד לתיקיית ההורדות.` | PDF export completed successfully! The file "{name}" was downloaded to your Downloads folder. |
| `הפקת חבילת IDML הושלמה בהצלחה! הקובץ "{name}" הורד לתיקיית ההורדות.` | IDML package export completed successfully! The file "{name}" was downloaded to your Downloads folder. |
| `שמירת קובץ פרויקט .keter הושלמה בהצלחה! הקובץ "{name}" הורד לתיקיית ההורדות.` | Saving the .keter project file completed successfully! The file "{name}" was downloaded to your Downloads folder. |
| `{count} חפיפה` / `{count} חפיפות` | {count} overlap / {count} overlaps |
| `{count} התראה` / `{count} התראות` | {count} alert / {count} alerts |
| `קובץ IDML זרימת רב-טקסט אמיתית ל-Adobe InDesign ({count} עמוד) הופק בהצלחה!` | Real multi-text-flow IDML file for Adobe InDesign ({count} page) was created successfully! |
| `קובץ IDML זרימת רב-טקסט אמיתית ל-Adobe InDesign ({count} עמודים) הופק בהצלחה!` | Real multi-text-flow IDML file for Adobe InDesign ({count} pages) was created successfully! |
| `הוחלף מזהה מחשב פעיל ל: {label}` | Active computer ID changed to: {label} |
| `בטל: {label} (Ctrl+Z)` | Undo: {label} (Ctrl+Z) |
| `בצע מחדש: {label} (Ctrl+Y)` | Redo: {label} (Ctrl+Y) |
| `גודל דף {value}` | Page size {value} |
| `כוונון מהיר: {label}` | Quick-Tune: {label} |
| `רוחב עמוד {value}pt` | Page width {value}pt |
| `גובה עמוד {value}pt` | Page height {value}pt |
| `שמירה יזומה: {title}` | Manual save: {title} |
| `תורגם בהצלחה ל-{count} חוקים קשיחים ({rules})!` | Translated successfully into {count} hard rules ({rules})! |
| `הגדרת פרויקט עבור {ruleId}` | Project setting for {ruleId} |

Earlier templates (passes 1–4, 62): the 32 original interpolated-`t()` conversions (undo/redo toasts, PDF/IDML export toasts, AI layout messages, proofreading/QA/search counts, `תקן הכל ({count})`, etc.), 11 layout-switch/history templates, 6 history-scope templates, and 13 Design-panel `handleUpdateChar`/`handleUpdatePara` templates (`גופן {value}`, `גודל גופן {value}pt`, `משקל גופן {value}`, `ריווח אותיות {value}em`, `רווח מילים {value}%`, `רוחב אות {value}%`, `יישור {label}`, `שורה אחרונה: {value}`, `מרווח שורות {value}`, `מרווח אחרי פסקה {value}pt`, `הזחת שורה ראשונה {value}pt`, `כניסה מימין {value}pt`, `כניסה משמאל {value}pt`).

### 2c. Keys deliberately KEPT (not dead)
- `'מעמד עמודים…'` / `'העימוד נכשל'` — zero UI call sites (`paginateDocumentAsync` is never called from UI) but asserted by `scripts/v098-phase3-smoke.ts:254`; recorded as **reserved**, not dead.
- `'בוחרים שם...'` — asserted present by `v092b-uniformity-smoke` (`needEn`).
- `'הביטוי שנבחר אינו במקור...'` / `'הייצוא נבדק מול העמוד שעל המסך'` — asserted by `v098-phase5-smoke` NEW_KEYS.
- The 2 TypesettingRulesModal keys look "dead" to a naive substring search only because the source escapes their inner quotes (`\"`); they are live literal `t()` args.

---

## 3. Tables re-typed (v0.9.1 lesson)

Strict `Record<Category, {he, en}>` typing, so TypeScript fails the build if a category ships without a label in either language:

| Table | Change |
|---|---|
| `SEMANTIC_ROLE_LABELS` (`src/types/design-settings.ts`) | Was two parallel `Record<string, string>` maps (HE/EN) over `SemanticStyleRole`; now **one** `Record<SemanticStyleRole, BilingualLabel>` with all **33 roles**; the old maps are derived from it (same values, exports kept). `getSemanticRoleLabel` reimplemented on the strict table. |
| `GENRE_ROLE_PATTERN_LABELS` + `GENRE_ROLE_PATTERN_SUPPORT` (`src/engine/historical-layouts.ts`) | New closed union `GenreRolePatternId` (**11** values); both tables re-typed over it; `isGenreRolePatternId` guard added; use sites narrowed (no more `?.en ?? p` / `?.he ?? p` fallbacks). |
| `ROLE_TYPOGRAPHY_DEFAULTS` (`src/engine/docx-semantics.ts`) | New closed union `RoleTypographyRole` (**11** keys); `roleTypographyDefault(role)` narrows via `Partial<Record<ContentRole, …>>` with the `regular_paragraph` fallback unchanged. |
| `DOCX_HUB_ROLE_OPTIONS` (`DocxImportHub.tsx`) | Added `labelEn` (6 roles); render lang-aware. |
| `ROLE_OPTIONS` (`DesignTypesettingPanel.tsx`) | Added `labelEn` (21 entries; faithful translations of the `ROLE_OPTIONS` Hebrew wording, **not** the semantic-map wording where they differ — e.g. main_source 'Main source (Gemara / Mishnah / penim)', secondary_comment 'Secondary commentary (Tosafot / Shakh)'). |
| `BASE_LAYOUT_OPTIONS` (`CustomLayoutDesigner.tsx`) | Added `labelEn` (5); render lang-aware. |
| `LAYOUT_PRESET_OPTIONS` (`src/engine/layout-presets.ts`) | Added `labelEn` + `subLabelEn` (7 presets); renders lang-aware in `EditorialStudioHeader.tsx` and `App.tsx`. **Pass 7:** `layoutPresetLabel(id)` returned `labelHe` unconditionally — now `layoutPresetLabel(id, lang)` returns `labelEn` in English mode (used by the Home template line and the recent-projects list). |
| `CONTENT_ROLE_LABELS` | Already strict: `Record<ContentRole, BilingualLabel>`, 28 roles — verified exhaustive. |
| `SEFER_ARCHETYPE_LABELS` / `SEFER_ARCHETYPE_DESCRIPTIONS` | Already strict, 5 archetypes — verified. |
| `WIZARD_SLOT_LABELS` / `WIZARD_SLOT_HINTS` | Already strict, 18 slot keys — verified. |
| `QUICK_TUNE_TRIM_LABELS` / `QUICK_TUNE_ZONE_LABELS` | Already strict, 4 + 4 — verified. |
| `BUNDLED_FONT_AVAILABILITY` (`docx-semantics.ts`) | **Intentionally left open-keyed**: keys are font names, an open-ended catalogue in principle; only consumed by smoke scripts via `?.` access. The i18n smoke §6 asserts all 8 known fonts have non-empty bilingual notes. |

---

## 4. RTL / LTR findings per surface

| Surface | Finding |
|---|---|
| **Archetype cards — REAL BUG, fixed** | `NewProjectForm.tsx:297/386/453/474` hardcoded `text-right`, so in English mode titles/descriptions rendered right-aligned. Tailwind v4.3.3 supports `text-start`, and the codebase already used it in places. **Fix:** replaced physical `text-right` with logical `text-start` in UI chrome — **46 occurrences across 13 files** (CustomLayoutDesigner 2, DesignTypesettingPanel 1, DocxImportHub 4, EditorialStudioHeader 20, ExportWorkspaceView 3, FontDropdown 1, HomeWorkspaceView 1, LicenseActivationModal 4, NewProjectForm 4, PageCanvas 1, PageNavigatorSidebar 1, TypesettingRulesModal 1, App 1). Verified live: English wizard cards are left-aligned, Hebrew cards right-aligned (screenshots 30/35). |
| `text-right` keepers (book content, must stay right-aligned) | `CustomLayoutDesigner.tsx:820` (fitted Hebrew preview, explicit `dir="rtl"`), `FontScannerPanel.tsx:480` (paper-coloured Hebrew font preview swatch), `Milestone1ReportModal.tsx:194` (Hebrew-only dev report table). `FontScannerPanel.tsx:434` `text-left` is a numeric score display — language-neutral, kept. `PageNavigatorSidebar.tsx:553` search input `pr-8 pl-2.5` + icon `absolute right-2.5`: icon and padding stay on the right in both languages — consistent, not broken; kept. |
| **AI drawer — REAL BUG, fixed** | `AiChatPanel.tsx:1089` hardcoded `fixed inset-y-0 left-0 … border-r` in floating mode. Fixed to dir-aware classes (`right-0` + `border-l` in RTL, `left-0` + `border-r` in LTR) for the floating branch and the docked branch's inner border. The drawer docks on the start side (right in Hebrew, left in English) and its inner border faces the canvas. |
| **Continue button arrow — REAL BUG, fixed (pass 7)** | `HomeWorkspaceView.tsx:195` used a static `<ArrowLeft>`; in English mode "Continue to the last project ←" pointed the wrong way. Now dir-aware (`ArrowLeft` in RTL, `ArrowRight` in LTR). |
| Dock order | Already mirrored: `App.tsx:3654` (`side={dir === 'rtl' ? 'right' : 'left'}`) and `:4066` (opposite side); `dir={dir}` widely used on panels (DesignTypesettingPanel, HomeWorkspaceView, AiChatPanel, CommandPalette, ControlPanel, CustomLayoutDesigner, ExportWorkspaceView, GeminiKeyModal, LicenseActivationModal, FloatingContextToolbar, EditorialStudioHeader). Verified live: in Hebrew the Design panel docks right and the canvas sits left (screenshot 34); in English the panel docks left and the canvas sits right (screenshot 39). |
| Stepper arrows | Flip with dir (`HomeWorkspaceView.tsx:219`: `dir === 'rtl' ? '←' : '→'`); English wizard reads "1 Choose a book type → 2 Add Word files → 3 Generate the sefer layout" (screenshot 35). |
| Region / box labels | `PageCanvas.tsx:2701` (`{box.labelHe ?? box.role}`), `CustomLayoutDesigner.tsx:764/811/974/1041` rendered Hebrew-only though `labelEn` exists on the data — all fixed to lang-aware (`CUSTOM_LAYOUT_BOX_ROLE_LABELS_EN`, `boxRoleLabel` helper). |
| Title-page border styles | `TITLE_PAGE_BORDER_STYLES` already carries `nameEn`/`descriptionEn` for all 7 styles; `TitlePagePanel.tsx:368/374` wrongly used `t(style.nameHe)` / `t(descriptionHe)` — fixed to the lang ternary (no keys added). |
| Auto-layout notice banner | `App.tsx:3682` rendered `{autoLayoutNotice.lineHe}` although the state type already carries `lineEn` (all three set-sites populate it). **Fixed (pass 7)** to `lang === 'en' ? lineEn : lineHe`. Verified live: "Laid out as Vilna Shas — Rashi detected (inner commentary) · Tosafot detected (outer commentary) · …" (screenshot 38, regenerated). |
| Review-queue reason badges | `DocxImportHub.tsx:830` rendered `{conf.reasonHe}` although `MatchConfidence` already carries `reasonEn`. **Fixed (pass 7)**. Verified live: "66% · Partial / fuzzy match on dibur-hamatchil words", "40% · No direct match found — assigned to the current sugya position, awaiting review" (screenshot 37, regenerated). |
| Quick-Tune tab truncation (cosmetic, pre-existing) | In the English editor the Design-panel tab labels truncate ("Quick-Tu…", "Letters a…", "Paragra…") because the ~300px panel holds 6 tabs. Same truncation behaviour exists in Hebrew; it is a narrow-panel layout property, not a bilingual bug — recorded, not fixed in this pass. |
| Nikud clipping (Rule 5) | No overflow/clipping of Hebrew strings with nikkud observed in any screenshot (wizard, slots, linking report with nikkud badges, Quick-Tune, editor canvas). The Playwright smoke also asserts `document.scrollWidth <= innerWidth` on the wizard in both locales (pass). Hebrew book content with nikkud renders correctly on the canvas in both locales (screenshots 33/38). |

---

## 5. Dynamic strings (Rule 4)

- **`tf()` system** (see §2b): all 35 interpolated `t()` sites converted; every composed history label, toast, and button label found in passes 2–4 and 7 now goes through `tf()` with whole-string templates. One mid-pass incident: a `QaFixList.tsx` replacement broke a `failed ? A : B` ternary (`? tf(...)` instead of `: tf(...)` plus a missing closing `}`) — fixed by hand; `tsc` clean afterwards.
- **Plurals — Phase 1 quirk FIXED**: `formatPreviewCounts` (`docx-semantics.ts`) and `formatLinkingReportSummary` (`commentary-linker.ts`) used plural-only nouns ("1 Chapters", "1 Notes"). Both now use the singular when the count is exactly 1, in **both** languages. Live proof from the Playwright drive: Gemara preview reads "698 Words · 1 Chapter · 0 Pages · 0 Verses · 0 D.H. · 0 Notes" in English; linking report "Dibbur HaMatchil linking report: 100 D.H. linked · 100 high-confidence · 0 awaiting review · 7 unlinked" (Hebrew: "דו״ח קישור דיבורי המתחיל: 100 ד״ה קושרו · 100 בוודאות גבוהה · 0 ממתינים לסקירה · 7 לא קושרו"). Note: for the daf/page count the singular is `'עמוד'` (Page), not `'דף'` (Folio), because the plural noun is `'דפים'` → 'Pages'. `'בוודאות גבוהה'` is adverbial — no singular/plural distinction.
- **Balance toasts** (`App.tsx:2199`, `3100`): singular noun when count === 1 (`'אלמנה'` / `'יתום'` / `'טור אוזן'`), plural otherwise.
- **Layout-switch report** (`layout-transaction.ts`): report lines were Hebrew-only by design; now built in parallel as `reportEn` (5 English lines, same order/counts) and joined lang-aware in `App.tsx:1822/1879`.
- **Export QA counts** (`ExportWorkspaceView.tsx:1016/1057`): `${n} חפיפות` / `${n} התראות` were raw template literals; now singular/plural `tf()` (pass 7).
- **Hub import button** (`DocxImportHub.tsx:1027`): `ייבא ${n} קבצים ועמד ספר` was a raw template literal; now `tf()` with the noun chosen by count (`קובץ` / `קבצים`) (pass 7). Live: "Imported 0 files and typeset a book" (screenshot 42).
- **IDML toast** (`App.tsx:2095`): singular/plural `tf()` on `עמוד`/`עמודים` (pass 7).
- **Autosave times**: `HomeWorkspaceView.tsx:156/295/389` and `WorkspaceStatusBar.tsx:105` used a hardcoded `'he-IL'` locale for `toLocaleTimeString`/`toLocaleDateString`; now lang-aware (`'en-US'` in English). The status bar reads "Autosaved at 08:02 AM" in English (screenshots 38/42). No bare `'he-IL'` time/date locale remains in any component (smoke §11 asserts this; the only remaining `'he-IL'` in `src/` is the Word-export XML in `word-exporter.ts`, which is Hebrew document content by design, and the lang-aware ternaries themselves).
- **AI composed replies**: `auto-layout.ts` composed `replyHe` templates (explainRecipe, applyTemplate byName/byId, applyHistoricalLayout) cannot be fixed by keys — fixed with an optional `replyEn` field on `AutoLayoutCommand` and `PanelIntentResult`, populated at all 5 sites plus the export reply in `AiChatPanel.tsx:481`; `localizeIntent` prefers `replyEn` in English mode. The `auto-layout.ts` `lineHe`/`lineEn` pairs and `design-settings-engine.ts` `summaryHe`/`summaryEn` pairs were verified correct (He uses `nameHe`, En uses `nameEn`) — not bugs.
- **Residual dynamic risk (recorded, not fixed)**: `AiChatPanel.tsx:767/771/775/779` (`t(intent.action.label)`, `t(diff.settingName/oldValue/newValue)`) can still fall back when the engine composes a label at runtime (e.g. `design-settings-engine.ts:5467`); only the literal path is covered. The undo-toast `label` in `App.tsx:1195/1206` can still be Hebrew if a stored history label was built from raw Hebrew elsewhere; the labels fixed in passes 2–4 and 7 cover the known sites.

---

## 6. Language-neutral strings (do not re-flag)

- The 4 identical he==en `EN_STRINGS` entries: `'Word (.docx)'`, `'EPUB (.epub)'`, `'HTML (.html)'`, `'English'` (file extensions / the language name itself).
- File extensions and format names (`.keter`, `.docx`, `PDF`, `IDML`, `InDesign`, `TEST A`), file names (`gemara-50.docx`, `tosafot-50.docx`), recipe ids, font names, and book titles the user typed (e.g. `מסכת ברכות — דף ב ע״א` stays Hebrew in English mode — it is the book's title, a proper noun).
- Hebrew book **content** (Gemara/Rashi/Tosafot text, dibbur hamatchil strings, folio text on the canvas) stays Hebrew in both locales by design; only the UI chrome around it translates.
- Download file names (`App.tsx:1995/1996`: `${title}_ספר_מלא_${n}_עמודים.pdf`) use Hebrew words by design — a file-naming choice, not a UI string.
- Recipe rules (`HISTORICAL_RECIPE_RULES` values, e.g. 'Rashi always INNER, Tosafot always OUTER…') are English by design; recipes carry `summaryEn`.
- `buildRecipePromptContext` (`auto-layout.ts:1320`) is a Gemini prompt containing both names — intentional prompt data, not UI.
- `layout-recipes.ts:1011` overlap warning uses `labelHe` in a `console.warn` only — log-only, left as is.
- `lastModificationSummary` is Hebrew-only in stored settings but never rendered in UI — left as is.

---

## 7. What was NOT fixed in this pass (recorded honestly)

- **Hardcoded-Hebrew dev panels (pre-existing, large)**: `AutomatedTestPanel.tsx` (~178 lines with Hebrew, 0 `t()` calls) and `Milestone1ReportModal.tsx` (~63 lines) are Developer-Mode-gated dev surfaces — Hebrew-only in English mode. `AiChatPanel.tsx` (~113 Hebrew lines) mixes translated `t()` literals with hardcoded fragments. Rewriting these panels is out of proportion for this pass; they are the next remediation, not silently claimed as covered. (`WelcomeModal` steps are fine — all in `EN_STRINGS`.)
- `translateUiString` (engine, non-React) has zero call sites outside `LanguageContext.tsx` — dead infrastructure; left, recorded.
- `paginateDocumentAsync` is never called from UI, so `'מעמד עמודים…'` / `'העימוד נכשל'` have no live UI surface (kept as reserved keys, §2c).
- The `unpaired` reasons from `detectLibraryPairs` (`library-folder.ts`: `reasonHe`/`reasonEn` both exist) are not rendered in the App flow that consumes them (only a generic toast) — no render site to fix.
- Phase 4 flush gap (25.4pt vs 19.14pt) and async-pagination page inflation (+~1 page per chunk boundary) are pre-existing engine gaps, unrelated to i18n — untouched.
- Not yet run in the installed Electron app (standing gap since v0.9.6/v0.9.7); verification is Node/tsx + headless Chromium against `dist/` only. Sandbox-only external note: Google Fonts CSS is unreachable here (`ERR_TUNNEL_CONNECTION_FAILED`); the app falls back to system fonts; no `.ttf` files ship in the repo (pre-existing gap, recorded in Phase 1-2).
- The Playwright drive's Story Editor / New Project / DOCX modal checks needed two app-behaviour facts, not i18n fixes: (a) the frame context menu only opens on a right-click **on the sheet** (beside-sheet clicks miss the canvas container; the sheet is taller than the viewport, so the click point must be scrolled into view first); the menu's backdrop is dismissed by clicking, not by Escape. (b) New Project / Word import go through the Unsaved Changes guard when the project is modified — the smoke dismisses it with "Continue without saving". Both are now encoded in the smoke.

---

## 8. Verification

### New scripts
- **`scripts/v098-i18n-smoke.ts`** — **75 passed, 0 failed** (§1–§11). §11 (28 checks) covers the pass-7 visual-review residuals: `layoutPresetLabel` lang param, autosave `tf()` + lang-aware locales, dir-aware Continue arrow, hub/export notices, singular+plural export counts, IDML toast singular/plural, license toast, undo/redo tooltips, design-panel history labels, rules-modal text, review-queue `reasonEn`, auto-layout banner `lineEn`, and no bare `'he-IL'` locale in components.
- **`scripts/v098-i18n-playwright-smoke.mjs`** — **50 passed, 0 failed**. Drives wizard + hub import + anchor overlay + Quick-Tune + Story Editor + New Project modal + DOCX import modal in Hebrew and again in English, 0 page errors in each. Screenshots `screenshots/v098/30-i18n-*.png` … `42-i18n-*.png` (regenerated after the final build; see §9). The smoke's own fixes during this pass: alignment checks assert computed `textAlign === 'start'` (Chrome returns the logical value); the D toggle accepts `'קישורי'` (actual label is the abbreviated `'קישורי ד״ה'`); the Project menu trigger is `button[title="Book menu and settings"]`.

### Regression battery (final run, after all fixes)
| Smoke | Result |
|---|---|
| v098-phase1-smoke | 66 passed, 0 failed |
| v098-phase2-smoke | 54 passed, 0 failed |
| v098-phase3-smoke | 68 passed, 0 failed (65 baseline + 3 new singular-key assertions) |
| v098-phase4-smoke | 34 passed, **2 failed** — known pre-existing Rule 3/Rule 2 flush gap, 25.4pt vs 19.14pt tolerance, proven pre-existing by old-linker-only run; not silently edited |
| v098-phase5-smoke | 52 passed, 0 failed |
| v098-phase6-smoke | 16 passed, 0 failed, 3 skipped without fonts |
| v098-uniformity-smoke | 83 passed, 0 failed |
| v098-i18n-smoke | **75 passed, 0 failed** |
| v097-smoke | 73 passed, 1 failed (expected version check — package is 0.9.8) |
| v096-smoke | 191 passed, 1 failed (version check only) |
| partE-smoke | 17 passed, 0 failed, 1 skipped without fonts |
| verify_sefer_pipeline | 15 passed, 0 failed, 3 skipped without fonts |
| Playwright phase1 | 35 passed, 0 failed |
| Playwright phase34 | 22 passed, 0 failed |
| Playwright phase56 | 22 passed, 0 failed |
| Playwright uniformity | 35 passed, 0 failed |
| Playwright i18n | **50 passed, 0 failed** |

Font-dependent checks (phase6/partE/pipeline) skip without fonts in this session because `/tmp/keter-fonts` no longer exists after the `/tmp` clear; the no-fonts results are identical to the inherited baseline, and the skipped checks are font-loading checks unrelated to i18n. With fonts, the inherited baseline was 21/0/0, 18/0/0, 19/0/0 — not re-proven here for lack of the font directory.

### Final sweep (before finishing)
- `npm install` PASS; `npx tsc --noEmit` clean; `npm run build` PASS (built in 2.74s).
- Independent audit re-run (`/tmp/i18n-audit-final.py`, recreated after `/tmp` was cleared): **AUDIT PASS** — 1,626 keys, 85 templates, 0 missing literal keys, 0 interpolated `t()`, 0 dead keys, 0 missing `tf()` templates.

---

## 9. Screenshots (visual review — nikud, clipping, alignment)

All in `~/workspace/KETER-TYPE-v0.9.8/screenshots/v098/`, regenerated by the final Playwright run:

| File | What it shows | Verdict |
|---|---|---|
| `30-i18n-wizard-he.png` | Home wizard, Hebrew | RTL correct, no clipping |
| `31-i18n-slots-he.png` | Wizard slots, Hebrew | slot labels right-aligned, no clipping |
| `32-i18n-linking-he.png` | Linking report + review queue, Hebrew | nikkud badges render cleanly |
| `33-i18n-editor-he.png` | Editor, Hebrew | panel docked right, canvas left |
| `34-i18n-quick-tune-he.png` | Quick-Tune, Hebrew | panel docked right |
| `35-i18n-wizard-en.png` | Home wizard, English | LTR; archetype cards **left-aligned** (text-start fix); stepper arrows → |
| `36-i18n-slots-en.png` | Wizard slots, English | "Step 2 — Word files by role (Shas / Gemara):" in English; autosave "Autosaved at …" |
| `37-i18n-linking-en.png` | Linking report + review queue, English | report line fully English; badges English ("Partial / fuzzy match…", "No direct match found…"); dibbur content stays Hebrew (correct) |
| `38-i18n-anchor-en.png` | Anchor overlay, English | banner fully English ("Laid out as Vilna Shas — Rashi detected…"); connectors visible; "Push line to next page" / "Pull line to this page" |
| `39-i18n-quick-tune-en.png` | Quick-Tune, English | panel docked **left** (mirrored); all groups English; "Re-anchoring cancelled" toast |
| `40-i18n-story-en.png` | Story Editor, English | header English |
| `41-i18n-newproject-en.png` | New Project modal, English | "Opening a new book project", "Book / project name", "Create a new project" |
| `42-i18n-docx-modal-en.png` | DOCX import modal, English | "Import Word files", "Imported 0 files and typeset a book" |

What the visual review caught that the `t()` sweep could not (pass 7): the autosave lines, `layoutPresetLabel` Hebrew-only, the static Continue arrow, the auto-layout banner `lineHe`, the review-queue `reasonHe`, and the export/hub/license/rules hardcoded template literals — all fixed and re-screenshotted (see §4–§5).

---

## 10. Files changed vs the tree inherited

(Phases 1–6 + uniformity audit were already in the tree; this list is only the audit's own changes.)

**i18n core**
- `src/i18n/strings.ts` — 1,626 keys (1,305 net removed), 85 `tf()` templates, 53 new keys, 6 restored keys
- `src/i18n/LanguageContext.tsx` — `tf()` helper added to the context

**Engine**
- `src/engine/layout-transaction.ts` — parallel `reportEn`
- `src/engine/docx-semantics.ts` — `formatPreviewCounts` plurals; `RoleTypographyRole` closed union
- `src/engine/commentary-linker.ts` — `formatLinkingReportSummary` plurals
- `src/engine/auto-layout.ts` — `replyEn` on composed commands
- `src/engine/historical-layouts.ts` — `GenreRolePatternId` closed union, strict tables
- `src/engine/layout-presets.ts` — `labelEn`/`subLabelEn`; `layoutPresetLabel(id, lang)`

**Types**
- `src/types/design-settings.ts` — strict `SEMANTIC_ROLE_LABELS` (33 roles)

**Components**
- `src/App.tsx` — 22 interpolated `t()` → `tf()`; raw-Hebrew toasts; history labels; balance plurals; layout-switch `reportEn`; auto-layout banner `lineEn`; manual-save label; IDML toast singular/plural
- `src/components/DesignTypesettingPanel.tsx` — 2 interpolated `t()` → `tf()`; `ROLE_OPTIONS` labelEn; history labels (char/para/margin/header/mode); page-size/Quick-Tune/width/height history labels
- `src/components/DocxImportHub.tsx` — `DOCX_HUB_ROLE_OPTIONS` labelEn; extraction progress + import button `tf()`; review-queue badge `reasonEn`
- `src/components/EditorialStudioHeader.tsx` — `LAYOUT_PRESET_OPTIONS` render; `WORK_MODES` labelEn; undo/redo tooltips `tf()`
- `src/components/CustomLayoutDesigner.tsx` — `BASE_LAYOUT_OPTIONS` labelEn; region labels lang-aware; 2× `text-right` → `text-start`
- `src/components/PageCanvas.tsx` — region label lang-aware; 1× `text-right` → `text-start`
- `src/components/TitlePagePanel.tsx` — history-label suffixes; border name/description lang-aware
- `src/components/FloatingContextToolbar.tsx` — composed summaries lang-aware
- `src/components/AiChatPanel.tsx` — `replyEn` pass-through; drawer mirroring
- `src/components/HomeWorkspaceView.tsx` — autosave lines + locales; Continue arrow dir-aware; recent-project date locale; 1× `text-right` → `text-start`
- `src/components/WorkspaceStatusBar.tsx` — autosave line + locale `tf()`
- `src/components/ExportWorkspaceView.tsx` — 3 export notices + QA counts `tf()`; 3× `text-right` → `text-start`
- `src/components/ProofreadingPanel.tsx`, `QaFixList.tsx`, `SearchReplacePanel.tsx`, `ShasQaPanel.tsx` — interpolated `t()` → `tf()`
- `src/components/LicenseActivationModal.tsx` — device-id toast `tf()`; 4× `text-right` → `text-start`
- `src/components/TypesettingRulesModal.tsx` — NL feedback + rule description `tf()`; 1× `text-right` → `text-start`
- `src/components/UnsavedChangesModal.tsx` — multi-line `t()` arg replaced with a single-line key
- `src/components/NewProjectForm.tsx`, `FontDropdown.tsx`, `PageNavigatorSidebar.tsx` — `text-right` → `text-start`

**Scripts (new / modified)**
- `scripts/v098-i18n-smoke.ts` — **new**, 75 checks (§1–§11)
- `scripts/v098-i18n-playwright-smoke.mjs` — **new**, 50 checks (Hebrew + English)
- `scripts/v098-phase3-smoke.ts` — NEW_KEYS extended with the 3 new singular keys (`'קושר'`, `'ממתין לסקירה'`, `'לא קושר'`)
- `scripts/v098-i18n-removed-keys.json` — **new**, regenerated v0.9.7→v0.9.8 key diff (1,304 removed / 112 added)

**Not done (per task constraints):** no push, no GitHub build, no installer delivery, no `MANIFEST.md` (the coordinator consolidates this record into it).
