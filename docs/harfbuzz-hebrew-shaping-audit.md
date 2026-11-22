# KETER-TYPE — Hebrew Shaping / Regression Audit

Date: 2026-10-18 (UTC workflow run completed 2026-10-19)
Branch: `fix/harfbuzz-hebrew-shaping`
Audited commit: `a3930507e3c635716e60622eae44f782f523f9c2`
Workflow: [Stage 22B–23 Regression Loop](https://github.com/itzkovitzshlomo/KETER-TYPE/actions/runs/39181485764)

## Executive status

**Not release-ready for full Hebrew cantillation coverage.** The branch builds and the existing regression suites pass, but the shaping audit detects a real glyph-coverage gap in four bundled font faces. The workflow correctly remains failed. No changes were made to `main`.

## Confirmed checks

The workflow summary reports success for:
- Real DOCX import preservation audit
- Berakhot content-preservation audit
- TypeScript (`npm run lint`)
- Production build (`npm run build`)
- Difficult-layout regression suite
- Engine/PDF regression assertions

The run's overall conclusion is **failure** because the HarfBuzz shaping audit reports 14 of 18 checks passing.

## Confirmed defect

Test sample: `בְּרֵאשִׁ֖ית` (Hebrew with niqqud and cantillation).
Missing mark: U+0596 HEBREW ACCENT TIPEHA (֖).

The per-face audit reports a missing glyph for:
- `FrankRuhlLibre-Regular.ttf`
- `FrankRuhlLibre-Bold.ttf`
- `DavidLibre-Regular.ttf`
- `DavidLibre-Bold.ttf`

The two Noto Rashi Hebrew faces did not appear among the four failed checks in this run. That is evidence of better coverage for this test case, not a guarantee that every Hebrew mark is supported.

## Changes already made on this branch

1. `getFontBinary(fontFamily, fontStyle?)` can select the regular or bold file separately.
2. The shaping audit now runs against all six bundled font files rather than only one face per family.
3. A misleading comment claiming complete Hebrew/niqqud/cantillation coverage was corrected to point to the audit.

Commits:
- [1d415e4 — load regular/bold font binaries separately](https://github.com/itzkovitzshlomo/KETER-TYPE/commit/1d415e438630f130245a4f8f7e0d9639b963d8be)
- [a393050 — audit all six bundled faces](https://github.com/itzkovitzshlomo/KETER-TYPE/commit/a3930507e3c635716e60622eae44f782f523f9c2)

## Other known concerns

- Dependency installation uses `npm install --legacy-peer-deps`; the workflow explicitly records an unresolved package peer-dependency conflict. The available log does not establish that this causes a runtime defect, but it should be resolved deliberately rather than hidden.
- The existing native PDF text engine maps characters to glyphs in the selected jsPDF font. HarfBuzz glyph IDs cannot safely be inserted directly into the PDF text stream without accounting for jsPDF font subsetting/remapping.
- Search/copy/selectable text and visual PDF output are separate paths in the RTL renderer. No new end-to-end PDF viewer verification was performed as part of this shaping fix.

## Recommended next actions

1. Decide a real rendering policy for unsupported cantillation marks: provide a compatible font/coverage or implement a verified fallback path that preserves mark positioning and PDF font/subset mapping.
2. Add coverage tests for the full relevant Hebrew combining-mark range across each supported font face, not just one sample word.
3. Generate PDFs containing the affected mark and verify visual placement plus copy/search/selection in an actual PDF reader.
4. Investigate and resolve the npm peer-dependency conflict with a normal install if possible.
5. Re-run the full workflow. Keep the gate failing until the missing glyph is genuinely handled.

## Limitations of this report

This report records what the repository workflow and audit output establish. It does not claim that all possible bugs in the application have been exhausted, and it does not claim the PDF selection/search behavior is newly verified.
