# KETER-TYPE v0.9.8 — Phases 3 + 4 Record

**Worker 2 — CommentaryLinkerEngine (Phase 3) + synchronized pagination /
Tzuras HaDaf solver (Phase 4).** Built on the staged v0.9.7 tree in
`~/workspace/KETER-TYPE-v0.9.8/` (package.json 0.9.8). Phases 1 + 2 were
done before this work started (see `PHASE-1-2.md`); this record covers
only Phases 3 + 4. **Do not push, build on GitHub, or deliver an
installer from this tree** — that step awaits the user watching and
ready to approve (coordinator consolidates this file into
`MANIFEST.md`).

**Verify-first was followed throughout:** every item below starts with
what the code already did, measured, before any new code was written.
Nothing working was rebuilt; the two real bugs found during
verification (a verso mirror mislabel and a tail-split in the
look-ahead probe) were fixed minimally and re-verified.

---

## Phase 3 — Dibbur HaMaschil auto-linking engine

Directive file: `src/engine/commentary-linker.ts` (new). Type
definitions live in `src/types/typesetter.ts` (not in the linker
module) to avoid circular imports.

### 3.1 One canonical Hebrew normalizer

**What existed already (three overlapping normalizers, no canonical
one):**

| Location | Behaviour |
|---|---|
| `normalizeHebrewForMatch` (`src/engine/vilna-shas.ts`) | strips nikud/taamim + punctuation; NO final-letter folding, NO ktiv handling |
| `normalizeHebrew` inside `DocxImporter.autoLinkCommentariesToSource` (`src/engine/docx-importer.ts`) | strips marks/punctuation, abbreviation expansion, וו→ו |
| `src/engine/hebrew-search.ts` | full cell model — ktiv dropping (`normalizeKtiv`), final-letter folding (internal, not exported), prefix expansion, Yiddish-safe mode; built for search, not linking |
| `src/engine/nikud-engine.ts` | remove/strip/apply only, no sanitise (Phase 2 added sanitise in `docx-semantics.ts`) |

**What was genuinely built:** `normalizeHebrewForMatching` in
`commentary-linker.ts` — ONE canonical normalizer composing the
existing `stripNikudTaamim` / `normalizeKtiv` from `hebrew-search`:
strips nikkud (U+0591–U+05C7) + ta'amim, ד"ה / בד"ה prefixes and
punctuation, folds finals (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ), collapses
whitespace. Ktiv malei/chaser is a **secondary** key only
(`normalizeHebrewForMatchingKtivInsensitive`); the primary key keeps
ו/י so distinct words are not over-merged. **Bug found and fixed in
testing:** gershayim/gersh/ASCII quotes are now DELETED, not replaced
with a space — spacing split רש״י into "רש י" and broke token
matching.

Also built: `levenshtein`, `ngramSimilarity` (Dice on bigrams),
`wordSimilarity` (exact 1 → ktiv-equal 0.95 → one-letter משה-וכלב
prefix 0.9 → Levenshtein-based, only for maxLen ≥ 4 and dist ≤ 2).

### 3.2 Sequential sliding-window anchor resolution

**What existed already (the old linker — built on, not replaced):**
`DocxImporter.autoLinkCommentariesToSource`
(`docx-importer.ts:1588`): per-role monotonic cursors, 4 stages
(pre-set 1.0 / exact token subsequence 1.0–0.9 / fuzzy word-coverage
0.5–0.9 / contextual fallback 0.4), review queue below 0.8 via
`flagUncertainMatches`. No Levenshtein/N-gram, no char offsets,
windows are unit-index based (±6/15 units), not word based. Tertiary
track exists (v0.9.7). `verifyDibburHamatchil` and
`detectDibburFromSource` in `vilna-shas.ts` (longest leading phrase
2–8 words, verbatim normalized match). The review queue lives in
`DocxImportHub.tsx` (`reviewLinks` state, accept/reassign/drop UI);
`SuggestionReviewPanel.tsx` is unrelated (snapshot suggestions).
Call sites of the old linker: `DocxImportHub.tsx:443`,
`secondary-docx-import.ts:168`, `pagination-engine.ts:3030` (inside
`buildLinkedRavGroups`), `App.tsx:2429`,
`layout-test-suite.ts:430`.

**What was genuinely built:**
`linkCommentariesToSource(sourceUnits, commentaryUnits, opts)` in
`commentary-linker.ts` — sequential sliding-window resolution in
**word** space (not unit space): `buildSourceWordIndex` builds a flat
word stream with exact char offsets per word; per-role monotonic
cursors; defaults lookback 30 words / forward window 500 words /
fuzzy accept 0.65 / review threshold 0.8 / high-confidence 0.9.
Exact token subsequence wins (1.0 verbatim / 0.95 normalised); else
best fuzzy span (mean wordSimilarity, bigram tiebreak), confidence
0.5 + 0.4×score capped 0.9; otherwise `unmatched` (no guessing,
cursor not moved). **Monotonicity bug found and fixed in testing:** a
lookback match must not move the cursor backwards — now
`cursors[key] = Math.max(cursor, end)` in both exact and fuzzy
branches. Each commentary paragraph gets `targetMainNodeId` +
`targetCharOffset` + `targetWordIndex` + `linkConfidence` 0.0–1.0 via
the `AnchorLink` interface (`linkId`, `commentaryUnitId`, `dibburId?`,
`dibburText`, `targetMainNodeId?`, `targetCharOffset?`,
`targetWordIndex?`, `linkConfidence`, `method:
'exact'|'fuzzy'|'contextual'|'unmatched'`, `dibburSource:
'dibbur-node'|'dibbur-field'|'source-match'|'none'`, `matchedText?`).

`dibburNodesToAnchorLinks` consumes the Phase 2 `DibburNode`
(`dibburId` travels on the AnchorLink);
`anchorLinksToRavTextLinks` converts AnchorLinks to the paginator's
`RavTextLink` shape (unmatched entries become ≤0.4 links to the
current sugya position, labelled awaiting review — same visibility as
the old 0.4 contextual fallback, never presented as a match);
`mergeLinkSets` keeps the higher-confidence link per commentary (old
linker stays fallback; merge never drops a commentary).

**Old vs new linker, side by side:**

| | Old (`autoLinkCommentariesToSource`) | New (`commentary-linker.ts`) |
|---|---|---|
| Window | unit-index ±6/15 units | word space, 30-word lookback / 500-word forward |
| Similarity | word-coverage 0.5–0.9, no edit distance | Levenshtein + bigram Dice + ktiv-aware word similarity |
| Anchor precision | unit id only | unit id + exact char offset + word index |
| Normalization | local, strips marks only | canonical `normalizeHebrewForMatching` (nikkud/taamim/finals/ד"ה, ktiv secondary key) |
| Unmatched | 0.4 contextual fallback | explicit `unmatched`, cursor not moved |
| Dibbur input | `dibburHamatchil` field | Phase 2 `DibburNode` (ד"ה / bold-lead / delimiter / source-match) |
| Output | `RavTextLink[]` | `AnchorLink[]` + `LinkingReport` |

### 3.3 LinkingReport in the existing review queue

**What existed:** the review queue UI in `DocxImportHub.tsx`
(`reviewLinks`, accept/reassign/drop). No report line.

**What was built:** `LinkingReport` (`totalDibburim`, `linkedCount`,
`highConfidenceCount`, `mediumConfidenceCount`, `reviewCount`,
`unmatchedCount`, `unmatched`, `links`), `buildLinkingReport`,
`linkingReportFromRavTextLinks`, `formatLinkingReportSummary` (same
composition style as Phase 2 `formatPreviewCounts`, counts through
the caller's `t()`, locale numbers). The hub runs the new linker
after the old one in `handleProcessImport`, merges via
`mergeLinkSets`, stamps `unit.anchorLink` on linked commentaries,
sets `linkingReport` state; wrapped in try/catch so the new engine
can never break an import (old linker's output stands on failure).
The review queue shows the one-line report summary above the
uncertain links (`data-testid="${testIdPrefix}-linking-report"`).
Report state cleared in `resetAfterImport`. Step-3 `<details>` text
updated (both languages) — it no longer says the full linking engine
"comes in a later phase"; it now says the new engine matches
dibburim without nikud with fuzzy matching and a sliding window.
**No second review UI was invented.**

Live result (Playwright, real browser): `דו״ח קישור דיבורי
המתחיל: 100 ד״ה קושרו · 100 בוודאות גבוהה · 0 ממתינים לסקירה · 7
לא קושרו` / `Dibbur HaMatchil linking report: 100 D.H. linked · 100
high-confidence · 0 awaiting review · 7 unlinked`.

### 3.4 AnchorLink constraints into pagination

**What was built:** `ContentUnit` gained `anchorLink?: AnchorLink`
and `anchoredCommentaryIds?: string[]`. `PaginationInput` gained
optional `anchorLinks?: AnchorLink[]`. When `input.links` is absent
and `anchorLinks` present, they are converted via
`anchorLinksToRavTextLinks` (fallback source = first `main_source`
unit) and fed to the rav-text path (`paginateRavText`) as explicit
links. Explicit `links` always win. Only the rav-text path consumes
them (single/two-column paths have no commentary flanks).
`src/App.tsx`: the `bookDoc` useMemo `paginateDocument` call now
also passes `anchorLinks` from the content units' stamped links.

**Gap (recorded, not hidden):** `src/engine/secondary-docx-import.ts`
still uses the old linker only — the new engine is wired in the
hub/main flow only.

### 3.5 Phase 3 verification

`scripts/v098-phase3-smoke.ts`: **65 passed, 0 failed.** Covers §1
normalizer (nikkud/taamim stripped, finals folded, ד"ה/בד"ה, quotes
deleted, ktiv secondary key, window defaults 30/500); §2 similarity
(levenshtein, ngram Dice — one-letter typo 0.727 so the threshold is
>0.7 not >0.8, wordSimilarity ktiv 0.95, genuine typo ≈0.857); §3
sliding-window (9 commentaries over a word-counted 6-unit source
stream); §4 report counts (total 9, linked 7, high 6, medium 1,
review 0, unmatched 2); §5 DibburNode→AnchorLink (dibburId travels,
targets agree with direct run); §6 conversion + merge + review queue
(merge keeps max per commentary; `flagUncertainMatches` flags c6 and
c9); §7 i18n (all 8 new keys exist; summary renders he + en with no
Hebrew left in English); §8 version 0.9.8.

Phase 3 fixture (word-counted source stream): s1 [0-9] "מאימתי קורין
את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן"; s2 [10-20] "עד
סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות"; s3
[21-32] "רבן גמליאל אומר עד שיעלה עמוד השחר ומעשה ובאו בניו מבית
המשתה"; s4 [33-42] "תנא היכא קאי דקתני מאי שנא הכא בראש הפרק"; s5
[43-50] pointed "מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית עַד סוֹף
הָאַשְׁמוּרָה"; s6 [51-60] "אמר רבי יהושע בן לוי זמן קריאת שמע של
ערבית כרבי אליעזר". Deliberate fixture design: s4 does NOT repeat
"מאימתי קורין" and s5 does NOT repeat "משעה שהכהנים נכנסים" (those
phrases belong to s1 alone) so forward-preference and
beyond-lookback checks are meaningful. Commentaries in order: c1
"מאימתי קורין"→s1 1.0; c2 "עד סוף האשמורה"→s2 1.0; c7 "עד סוף
האשמורה הראשונא" (ה→א typo, NOT ktiv variation) → fuzzy s2 0.886 —
placed early while cursor is still at s2; c3 "רבן גמליאל אומר"→s3
1.0; c4 unpointed "מאימתי קורין"→pointed s5 0.95; c5 "תנא היכא
קאי"→s4 lookback 1.0; c6 "דבר שאינו כתוב כלל בגמרא"→unmatched; c8
"אמר רבי יהושע"→s6 1.0; c9 "משעה שהכהנים נכנסים"→unmatched (40+
words behind cursor, beyond 30-word lookback; proves cursor did not
regress after lookback matches). Control run: far phrase found via
forward window; phrase 45+ words behind cursor unmatched.

Lessons from Phase 3 test failures (fixture/expectations, not engine
bugs, except the quote bug): "הראשנה" vs "הראשונה" differs only by a
vav, i.e. ktiv variation, so the exact branch correctly takes it
(0.95) — a genuine typo test needs ה→א ("הראשונא"). The fuzzy dibbur
must come before the cursor advances past its target.

---

## Phase 4 — Synchronized pagination & Tzuras HaDaf solver

Directive files: `src/engine/pagination-engine.ts`,
`dynamic-knee.ts`, `spatial-exclusion.ts`, `engine-hard-rules.ts`,
`typesetter-core.ts`, `harfbuzz-emulator.ts` (all verified to exist).
New module: `src/engine/synchronized-pagination.ts`.

### 4.0 Verify-first: what the solver already did (measured, not assumed)

- `PaginationEngine.paginateDocument` is fully synchronous, no
  progress callback, no async entry. Rav-text path already groups
  linked commentaries with source (`LinkedRavGroup`,
  `buildLinkedRavGroups`), already enforces keep-together Priority 90
  (dibbur + commentary body) and Priority 80 (heading + opening
  paragraph), already moves 1–2 line commentary widow tails
  (`paginateRavText` Stage 4).
- `DynamicKneeEngine` (`dynamic-knee.ts`, 2319 lines) ALREADY queries
  `SpatialExclusionEngine.queryAvailableIntervals` per line band,
  already wraps excess commentary below the source in a 50/50 lower
  split or full-width span, already raises the knee
  (`maxSourceEndY`) from measured excess commentary lines. **There
  was no step-interval approximation left to replace — the directive's
  premise was outdated.**
- `HarfBuzzShaperEngine.metricCache` already memoizes glyph-advance
  measurement. Line-breaking trial counts were NOT memoized.
- `EngineHardRulesEngine` already checks LEVEL-0 rav-text link
  survival; there is no separate widow/orphan rule id — the paginator
  enforces it inline.
- `spatial-exclusion.ts` (296 lines): `queryAvailableIntervals`,
  `detectCollisions`, `auditPageCollisions`, min readable widths
  (source 135pt, commentary 78pt).

Probe measurements (temporary `scripts/v098-probe.ts`, since
deleted; geometry Vilna-ish `{pageWidth: 482, pageHeight: 680,
marginTop: 48, marginBottom: 48, marginInside: 46, marginOutside: 42,
isVerso: false}`, contentHeight 584, contentWidth 394):

- **Moderate fixture** (Gemara ×10 repeats, Rashi ×4, Tosafot ×8):
  29 source lines, 18 Rashi, 36 Tosafot; 0 collisions; no blank
  bands ≥6pt; source bottom flush 1.8pt from content bottom; Rashi /
  Tosafot bottoms far above bottom because their text was exhausted
  (honest white space, not a flush failure).
- **Extreme fixture** (Gemara ×14, Rashi ×6, Tosafot ×18, commentary
  ~3.5× source): **0 source lines, 0 source words consumed** before
  the fix — a page of pure commentary. Root cause found: the per-line
  dynamic clearance check in `dynamic-knee.ts` (`curSourceY +
  sourceLineHeight + sourceDescent > contentHeight -
  dynamicClearancePt - 2.0`) fired before the first source line
  because `dynamicClearancePt` exceeded the whole content height.

### 4.1 Main-text blocks carry their anchored commentaries (Rule 1)

**Built:** `attachAnchoredCommentaries` in
`synchronized-pagination.ts` (returns new unit objects, not mutated;
`bySource` map). `planSamePageGroups` (pure same-page-gravity
planner; flank + lower-wrap capacity; a single sugya whose
commentary alone overflows is emitted with `fitsOnOnePage: false` +
`overflowCommentaryLines`). The paginator consumes the anchors via
§3.4; the rav-text path's `buildLinkedRavGroups` already groups
linked commentaries with their source.

### 4.2 Dynamic knee / wraparound (Rule 2)

**Built in `spatial-exclusion.ts`:** `computeWraparoundPolygon(topY,
bottomY, lineHeight, gutter)` — first-class line-by-line wraparound
polygon API over `queryAvailableIntervals` (headers/footers live
outside [0..contentHeight], so they can never appear in it). Static
`measureBlankBands(regions, contentHeight, minHeightPt=13)` —
vertical blank-band audit.

**Built in `dynamic-knee.ts` — clearance cap fix:** per-line
`dynamicClearancePt` is now capped at `min(dynamicClearancePt,
(contentHeight - gemaraStartY) * 0.5, contentHeight - gemaraStartY -
2*sourceLineHeight - sourceDescent - 2.0)`. The 50% cap matches the
existing default knee junction (50%); overflow commentary flows to
the next page via consumed-word counts. Verified: extreme fixture
went 0 → 1 → 13 source lines (first cap, leave 2 source lines, only
bought 1 line; final cap yields 13 source lines, knee junction
303.4, lower split zone active, 0 collisions).

**Two real bugs found during verification and fixed:**

1. **Verso mirror mislabel (pre-existing, fixed in v0.9.8).**
   Symptom: sync `paginateDocument` (rav_text) "dropped" linked
   commentaries while placing their sources — `buildBook(1)` (10
   sources): unplaced `["r-0-6","t-0-6","r-0-7","t-0-7"]`;
   `buildBook(3)`: 20 unplaced. Proven pre-existing: same units
   dropped with OLD-linker-only links (no anchorLinks). Per-page
   instrumentation showed the truth: on verso page p=1 the solver
   reported all 79 words consumed but placed lines for only one
   unit. Root cause: the mirror branch in `dynamic-knee.ts`
   (`layoutRavTextPage`, `mirrorFlanks`) remapped every line with
   the SINGLE `input.rashiUnitId` / `input.tosafotUnitId` — the first
   unit id of the page slice. `consumeOneLine` preserves true
   per-word unit ids; the remap destroyed them. The words were ON
   the page, mislabelled — so same-page gravity, continuation
   tracking and per-unit editing all saw the wrong attribution, and
   every other (verso) page was affected. Fix: the remap now only
   swaps the ROLE and keeps each word's — and each line's — true
   unit id. Result: unplaced 0, same-page gravity 20/20.
2. **Tail split in the look-ahead probe (pre-existing, fixed in
   v0.9.8).** The two-page balance optimizer split a book that fits
   on one page into two pages whenever full-fit utilization was
   ≥70%: a 5-source book took 2 pages; a 30-source book's last 5
   sources split 3+2, leaving a non-final page 241pt short of the
   margin box. Fix in `pagination-engine.ts`: when ALL remaining
   groups fit on this page (`fullFitCand` exists — it already passed
   `fitsCompletely`: all streams consumed, 0 collisions), end the
   book there instead of splitting. This branch only fires on the
   tail (`fullFitCand` is null on middle pages), so mid-book
   balancing is unchanged. Result: fixture book 7 → 6 pages; the
   241pt deviation is gone; async-vs-sync diff 8 → 2.

### 4.3 Bottom-line flush (Rule 3) — honest gap, measured

**Built:** `checkBottomFlush` (Rule 3; interpretation recorded
honestly: the check is on the DEEPEST stream — a stream that
exhausted its text ends early, which is white space not a failure;
`withinTolerance` = deepest stream within one line-height of the
margin box; per-stream deviations reported). **Bug fixed in my own
code:** the first version used `pageHeight - marginBottom` (632pt)
as the content bottom, but lines are content-relative (0..584), so
every deviation was overstated by exactly marginTop (48pt). Fixed
to `pageHeight - marginTop - marginBottom` (584pt).

**Measured result (fixture book, 6 pages):** non-final deviations
11.6 / 25.4 / 11.6 / 25.4 / 11.6 pt against a 19.14pt tolerance —
3 pages inside, 2 pages 6.3pt outside. **This is a KNOWN GAP,
proven pre-existing:** an old-linker-only run of the same fixture
gives IDENTICAL deviations (11.6/25.4/11.6/25.4/11.6) and the same
blank bands, so the new linker is not the cause; an
identical-content test proved the mirror path is NOT the cause
(recto/verso byte-identical bottoms, 520.3pt both). Root cause:
the probe can only break at linked-group boundaries — a page
holding N groups ends where the Nth group's text ends, up to
~1–3 lines short of the margin box. A varied-content fixture is
worse (worst non-final deviation 191pt), so this is not a fixture
artifact. Closing the remaining 25.4pt needs vertical leading
stretch or a fill-aware probe tiebreak — both change the
pre-existing paginator's behaviour on every page and were judged
out of scope for this pass; the gap is recorded here, not hidden
by loosening the tolerance. The v0.9.8 tail fix (fullFitCand-first)
removed the worst case (241pt tail split).

### 4.4 Widow/orphan/heading protection (Rule 4)

**Built:** `checkStrandedDibburHeaders` (Rule 4; a heading as last
line of a stream with no body after it, or a dibbur-opening line
alone on the page for its unit; single-heading title pages not
flagged). The paginator's own inline enforcement (Priority 90/80
keep-together, Stage 4 widow-tail move) already existed — verified,
not rebuilt. `measureWraparoundGaps` (Rule 2 audit; rebuilds
regions from lines when `occupiedRegions` absent).

**Measured:** 0 stranded dibbur headers on the real fixture book;
the synthetic stranded-header detector fires correctly (§5b of the
Phase 4 smoke). The Rule 2 blank-band check reports the same two
25pt bands as Rule 3 (`[{yTop:559, yBottom:584, heightPt:25}]` ×2)
— the flush shortfall measured as a band, not a separate
wraparound failure; no band appears mid-page.

### 4.5 Performance: async progress + memoized line-breaking

**Built:**

- `paginateDocumentAsync(input, onProgress)` in
  `synchronized-pagination.ts`: `splitIntoAnchorSafeChunks`
  (commentary always travels with its anchor source; no AnchorLink
  crosses a chunk boundary; each chunk paginated by the real
  `PaginationEngine`; event loop yielded between chunks via
  `setTimeout(0)`; progress percent = pages-done vs planner's
  estimated total, clamped to 99 until the final chunk, then 100;
  pages renumbered sequentially using `toHebrewGematria` from
  `break-instructions.ts`).
- **Memoized `countTrialLines`** in `dynamic-knee.ts`: per-
  `solveSingleCandidate` `Map` keyed
  `role|startIdx|width|lineH`; module-level exported
  `trialLineCacheStats {hits, misses}` + `resetTrialLineCacheStats()`.
  Cache is per-candidate (word arrays are built once per call, so the
  key is unambiguous inside one call). Measured in smoke: hits=40,
  misses=749 on one moderate solve.

**Chunk sizing (fixed during verification):** the planner groups
are conservative (≈2 sources per group vs ≈5 per real page), so
`estimatedTotalPages` runs ≈2× the real page count. Chunking at
one chunk per estimated page (the first default of 8) let the
paginator's two-page balance optimizer re-balance EACH chunk as a
standalone book and inflated the 7-page fixture book to 15 pages.
Chunks are now ≈4 estimated pages (≈2 real pages):
`targetChunkCount = clamp(ceil(estimatedTotalPages / 4), 1, 8)`.
Measured inflation by chunk count (30-source book, sync = 7 pages
before the tail fix): 2 chunks → 8 pages, 3 → 9, 4 → 11, 6 → 12 —
roughly +1 page per chunk boundary. After the tail fix the async
run is 8 pages vs sync 6 (diff 2, within the smoke's ±3).

**Honest limits (recorded in code and here):** chunk boundaries
limit the paginator's global look-ahead to within a chunk, so a
long book paginated this way can differ by a page or two from
single-shot `paginateDocument`; single-shot remains the reference
for final export. Progress percent uses the planner's estimated
total as denominator, so intermediate percents are estimates
(pagesDone is real, the total is the planner's); the final event
is always exactly 100. Async pagination is for live preview during
font-size/margin tweaks, not for final export.

### 4.6 Phase 4 verification

`scripts/v098-phase4-smoke.ts`: **34 passed, 2 failed** (the 2
failures are the Rule 3 / Rule 2 quantization gap documented in
§4.3/§4.4, proven pre-existing by the old-linker-only run with
identical numbers). Passing parts include: §1 attach (source
carries both commentary ids; input not mutated); §2 planner
(groups cover all sources in order; gigantic commentary flagged
`fitsOnOnePage:false` with overflow); §3 knee cap + 0 collisions +
no blank bands on moderate fixture; §5b synthetic stranded-dibbur
detection; §6b polygon API (42 bands; blocked band excludes
x-range with gutter; blank-band audit finds a 40pt synthetic gap);
§7 memo hits=40/misses=749; §8 async progress (4 events, percents
20,40,60,100 monotonic; final pagesDone == totalPages 8; page
numbers sequential 2–9 Talmud numbering; Hebrew folio labels
present; 90/90 units placed in async run; no AnchorLink crosses a
chunk boundary, 4 chunks); §9 anchorLinks alone produce links (20
links); §10 version 0.9.8.

Phase 4 fixture: `buildBook(copies)` — 10 phrases × copies; each
source unit = phrase + FILLER×2 ("פירוש וביאור ארוך על הסוגיא
חילוקים וראיות מן הראשונים והאחרונים "); each Rashi/Tosafot
commentary = phrase + ": " + FILLER×2 with `dibburHamatchil` =
phrase. `buildBook(3)` = 30 sources + 60 commentaries; sync
paginates to 6 pages (7 before the tail fix); async to 8 pages.

---

## Bilingual strings (Phases 3 + 4)

Every user-facing string added goes into `src/i18n/strings.ts`
with BOTH Hebrew and English. 7 new keys + 1 updated key:

| Hebrew key | English |
|---|---|
| `דו״ח קישור דיבורי המתחיל` | `Dibbur HaMatchil linking report` |
| `קושרו` | `linked` |
| `בוודאות גבוהה` | `high-confidence` |
| `ממתינים לסקירה` | `awaiting review` |
| `לא קושרו` | `unlinked` |
| `מעמד עמודים…` | `Paginating pages…` |
| `העימוד נכשל` | `Pagination failed` |
| (updated) `קישורים בודאות 80% ומעלה … מנוע הקישור החדש משווה דיבורים למקור ללא ניקוד, עם התאמה מטושטשת וחלון חיפוש עוקב.` | `Links at 80% confidence or above are applied automatically; weaker ones wait for review above — nothing is guessed. The new linking engine matches dibburim to the source without nikud, with fuzzy matching and a sliding search window.` |

The old step-3 key (ending "…יגיע בשלב מאוחר יותר", "arrives in a
later phase") was replaced, not left dangling. New label tables use
strict `Record<…, {he, en}>` typing where added; parameterized
strings (counts) render through the caller's `t()` in both
languages (verified in Phase 3 smoke §7 and in the live Playwright
run, Hebrew and English).

---

## Playwright live drive (real Chromium)

`scripts/v098-phase34-playwright-smoke.mjs` (new) +
`scripts/v098-make-test-docx.py` (new fixture generator):
`gemara-50.docx` (32 paras: heading + Mishna + 30 Gemara, all 60
anchors verbatim), `rashi-50.docx` (55 paras: 50 matched bold-lead
dibburim + 5 deliberate orphans), `tosafot-50.docx` (53 paras: 50
matched + 3 orphans). 100 matched dibburim with bold leads, nikkud
variants and parenthesized citations (`(ברכות ב.)`); 8 deliberate
orphans so the review queue appears. Contents are short
classical-Hebrew test phrases assembled for this test — no copied
book text.

**Result: `v098-phase34-playwright-smoke: 22 passed, 0 failed`**
(run after `npm run build`, real Chromium, static server over
`dist/`). Flow: Shas archetype → slot matrix → all three fixtures
uploaded (preview counts before Generate: Gemara 698 words,
Rashi 1,284 words / 55 ד״ה, Tosafot 1,229 words / 53 ד״ה) →
Generate → review queue with the LinkingReport line →
"confident-only" → Home banner "continue to the last project" →
editor opens (Design button visible) with the paginated book.
English mode repeats the flow to the report line, fully in English.
No JS page errors, no same-origin resource failures. (The only
external failure is the Google Fonts CSS, unreachable in this
sandbox — pre-existing: no font files ship in the repo, see
PHASE-1-2.md.)

Screenshots (`~/workspace/KETER-TYPE-v0.9.8/screenshots/v098/`):

- `11-shas-50-slots.png` — Shas slot matrix with the three fixtures uploaded
- `12-linking-report.png` — review queue with the Hebrew LinkingReport line
- `13-editor-paginated.png` — editor showing the imported book paginated as a Vilna page (דף ב׳, 2/7, Gemara center with Rashi/Tosafot flanks)
- `14-linking-report-en.png` — English LinkingReport line

---

## Regression battery (final run, 2026-11-15)

| Smoke | Result | Note |
|---|---|---|
| `v098-phase1-smoke.ts` | **66 passed, 0 failed** | 2 assertions updated in this pass: the step-3 note no longer says the linker "comes in a later phase" (Phase 3 shipped it) and the old step-3 string key was replaced — see §"Bilingual strings". The assertions now check the new present-tense text and key. |
| `v098-phase2-smoke.ts` | **54 passed, 0 failed** | |
| `v098-phase3-smoke.ts` | **65 passed, 0 failed** | |
| `v098-phase4-smoke.ts` | **34 passed, 2 failed** | Both failures are the documented pre-existing group-boundary quantization gap (§4.3/§4.4), proven by the old-linker-only run with identical numbers. Not silently edited. |
| `v097-smoke.ts` | **73 passed, 1 failed** | The 1 failure is the expected pre-existing version check (package.json is 0.9.8, the v0.9.7 smoke expects 0.9.7). |
| `v098-phase34-playwright-smoke.mjs` | **22 passed, 0 failed** | Real Chromium (above). |

Final verification: `npm install` PASS, `npx tsc --noEmit` clean,
`npm run build` PASS. No temporary debug scripts remain in the
tree (`scripts/v098-probe.ts`, `v098-dbg*.ts` were created, used,
and deleted).

---

## Files changed vs the inherited tree

**New:**

- `src/engine/commentary-linker.ts` — Phase 3 engine (normalizer, similarity, sliding-window resolution, LinkingReport, DibburNode→AnchorLink, merge)
- `src/engine/synchronized-pagination.ts` — Phase 4 (attach/planner, flush + stranded-header + gap audits, async chunked pagination, wraparound helpers)
- `scripts/v098-phase3-smoke.ts` — 65 checks
- `scripts/v098-phase4-smoke.ts` — 36 checks (34 pass, 2 documented pre-existing failures)
- `scripts/v098-make-test-docx.py` — 50+ dibbur fixture generator
- `scripts/v098-phase34-playwright-smoke.mjs` — 22 live-browser checks
- `screenshots/v098/11-shas-50-slots.png`, `12-linking-report.png`, `13-editor-paginated.png`, `14-linking-report-en.png`

**Edited:**

- `src/types/typesetter.ts` — `AnchorLink`, `LinkingReport`, `ContentUnit.anchorLink` / `anchoredCommentaryIds`
- `src/engine/spatial-exclusion.ts` — `computeWraparoundPolygon`, `measureBlankBands`
- `src/engine/dynamic-knee.ts` — clearance cap fix; memoized `countTrialLines` + stats; **verso mirror remap fix** (keeps true per-word unit ids)
- `src/engine/pagination-engine.ts` — `anchorLinks` threading into the rav-text path; **tail fix** (fullFitCand-first in the look-ahead probe)
- `src/engine/synchronized-pagination.ts` (same file as above, new) — `checkBottomFlush` content-bottom fix; chunk sizing (~4 estimated pages per chunk)
- `src/components/DocxImportHub.tsx` — new-linker merge + `anchorLink` stamping + LinkingReport line in the review queue + updated step-3 text
- `src/App.tsx` — `anchorLinks` into the `bookDoc` pagination call
- `src/i18n/strings.ts` — 7 new EN_STRINGS entries + 1 updated step-3 sentence key
- `scripts/v098-phase1-smoke.ts` — 2 assertions updated to the Phase 3 reality (step-3 note text + key)
- `scripts/v098-phase4-smoke.ts` — comments documenting the 2 known pre-existing failures

**Not touched:** `src/engine/secondary-docx-import.ts` (still uses
the old linker only — recorded gap), `MANIFEST.md` (must not be
written by this worker), Phase 1+2 files except the step-3 string
update noted above.

---

## Honest gaps (summary)

1. **Rule 3 / Rule 2 flush shortfall (pre-existing, proven):**
   worst non-final deviation 25.4pt vs 19.14pt tolerance on 2 of 5
   non-final pages; same two 25pt blank bands. Group-boundary
   quantization in the pre-existing probe; identical numbers on an
   old-linker-only run; mirror ruled out by an identical-content
   test. Needs vertical leading stretch or a fill-aware probe
   tiebreak (design decision, out of this pass).
2. **Async pagination inflates page count:** ~+1 page per chunk
   boundary (balance optimizer re-balances each chunk standalone);
   measured 8 vs 6 pages on the fixture book. Single-shot remains
   the reference for final export; async is for live preview.
   Progress percent's denominator is the planner's estimated total
   (pagesDone is real; final event is exactly 100).
3. **New linker not wired in `secondary-docx-import.ts`** (old
   linker only there).
4. **No font files ship in the repo** (inherited from Phases 1+2);
   the sandbox's Google Fonts request fails and the app falls back
   to system fonts — pre-existing, not a v0.9.8 regression.
5. **Not yet run in the installed Electron app** (inherited).
6. **Ctrl+Shift+D may clash with browser shortcuts; English counts
   reuse plural-only pre-existing translations ("1 Chapters");
   archetype-card descriptions are right-aligned in English per the
   existing text-right convention** (all inherited from Phases 1+2,
   final-audit items).
