/**
 * KETER-TYPE v0.8.0 — Part E: native-PDF fidelity smoke (Stage 13A-3).
 *
 * Run from the repo root:  npx tsx scripts/stage13a3-smoke.ts
 *   or:                    npm run smoke:pdf
 *   with fonts elsewhere:  KETER_FONTS_DIR=/path/to/fonts npx tsx scripts/stage13a3-smoke.ts
 *
 * `LayoutTestSuite.runStage13A3Tests()` had NO caller anywhere (no script,
 * no component), so the native-PDF fidelity assertions — Hebrew text
 * extraction from the vector PDF, RTL order, nikud attachment, bold dibbur,
 * render-plan coordinate match — had zero automated coverage. This script
 * is its runnable path.
 *
 * The suite needs the six embedded font binaries (Frank Ruhl Libre
 * Regular/Bold, Noto Rashi Hebrew Regular/Bold, David Libre Regular/Bold)
 * in <root>/public/fonts, or in the folder named by KETER_FONTS_DIR.
 * The fonts are user-supplied (they are not in the repo). When they are
 * absent the script SKIPS cleanly (exit 0, explicit SKIP line) instead of
 * crashing on an un-fetchable /fonts/*.ttf URL — a browser is genuinely
 * required to serve those files, and the sandbox has none. A skip is
 * reported, never mistaken for a pass.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KETER_EMBEDDED_FONTS } from '../src/engine/pdf-native-text-engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const fontDir = process.env.KETER_FONTS_DIR
  ? path.resolve(process.env.KETER_FONTS_DIR)
  : path.join(ROOT, 'public', 'fonts');

const missing = KETER_EMBEDDED_FONTS.map(s => s.vfsFileName).filter(
  name => !fs.existsSync(path.join(fontDir, name))
);

if (missing.length > 0) {
  console.log('stage13a3-smoke: SKIP — embedded font binaries not available');
  console.log(`  font dir: ${fontDir}`);
  console.log(`  missing: ${missing.join(', ')}`);
  console.log(
    '  To run the suite, place the six TTF files in public/fonts (or set KETER_FONTS_DIR). ' +
      'The native-PDF fidelity assertions have no coverage until then — this is a skip, not a pass.'
  );
  process.exit(0);
}

console.log(`stage13a3-smoke: fonts found in ${fontDir} — running runStage13A3Tests()`);
const { LayoutTestSuite } = await import('../src/engine/layout-test-suite.ts');
const result = await LayoutTestSuite.runStage13A3Tests();
for (const a of result.assertions) {
  console.log(`  ${a.passed ? 'PASS' : 'FAIL'} A3.${a.id} ${a.name} — ${a.details}`);
}
console.log(
  `\nstage13a3-smoke: ${result.passedCount}/${result.totalCount} assertions passed` +
    (result.allPassed ? '' : ' — FAILURES ABOVE')
);
process.exit(result.allPassed ? 0 : 1);
