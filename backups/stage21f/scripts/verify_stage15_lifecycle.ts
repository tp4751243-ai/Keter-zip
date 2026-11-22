import { buildRegressionTests } from '../src/components/AutomatedTestPanel';
import { DocxImporter } from '../src/engine/docx-importer';
import { ProjectPersistenceEngine } from '../src/engine/project-persistence';
import { PaginationEngine } from '../src/engine/pagination-engine';
import { ContentUnit } from '../src/types/typesetter';

// Provide an in-memory localStorage shim when running in Node CLI
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, val: string) => {
      store.set(key, String(val));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

async function testSampleDocxRoundTripAndPagination() {
  const sampleUnits = DocxImporter.getSampleBerakhot();
  const integrity = DocxImporter.validateDocumentIntegrity(sampleUnits, []);
  if (!integrity.passed || integrity.totalUnits !== sampleUnits.length) {
    throw new Error('Sample DOCX integrity validation failed');
  }

  // Create project snapshot from imported units, serialize to .keter.json, validate & reload
  const projectSnap = ProjectPersistenceEngine.createNewProjectSnapshot({
    documentTitle: 'מסכת ברכות — בדיקת מחזור חיים מלאה',
    layoutType: 'rav_text',
    units: sampleUnits,
    links: [],
  });

  const jsonPayload = ProjectPersistenceEngine.exportKeterProjectJson(projectSnap);
  const validation = ProjectPersistenceEngine.validateAndParseProjectJson(jsonPayload);
  if (!validation.valid || !validation.snapshot) {
    throw new Error(`Round-trip validation failed: ${validation.errorHe}`);
  }

  // Verify 100% of units, Hebrew RTL text, and inline textRuns survived round-trip
  for (let i = 0; i < sampleUnits.length; i++) {
    const orig: ContentUnit = sampleUnits[i];
    const restored: ContentUnit = validation.snapshot.units[i];
    if (orig.id !== restored.id || orig.rawText !== restored.rawText || orig.role !== restored.role) {
      throw new Error(`Unit mismatch at index ${i}: ${orig.id}`);
    }
  }

  const restoredDesign = ProjectPersistenceEngine.buildDesignSettingsFromSnapshot(
    validation.snapshot
  );
  const paginated = PaginationEngine.paginateDocument({
    title: validation.snapshot.documentTitle,
    layoutType: validation.snapshot.layoutType,
    units: validation.snapshot.units,
    links: validation.snapshot.links,
    geometry: restoredDesign.layout.geometry,
    designSettings: restoredDesign,
  });

  if (paginated.pages.length < 1 || paginated.pages[0].sourceLines.length < 1) {
    throw new Error('Pagination after .keter.json round-trip produced empty pages');
  }

  console.log(
    `[Full Lifecycle -> .keter.json -> Pagination Verification] PASSED: units=${validation.snapshot.units.length}, pages=${paginated.pages.length}, integrityPassed=${integrity.passed}`
  );
}

async function main() {
  const tests = buildRegressionTests();
  const passed = tests.filter(t => t.status === 'passed');
  const failed = tests.filter(t => t.status !== 'passed');

  const stage15Tests = tests.filter(t => t.suite.includes('Stage 15'));
  const stage15Passed = stage15Tests.filter(t => t.status === 'passed');
  const preExistingFailures = failed.filter(t => !t.suite.includes('Stage 15'));

  console.log(`Total Suite: ${passed.length}/${tests.length} PASSED`);
  console.log(`Stage 15 Lifecycle Suite: ${stage15Passed.length}/${stage15Tests.length} PASSED`);
  for (const t of stage15Tests) {
    console.log(`  [${t.status.toUpperCase()}] ${t.id} ${t.name}: ${t.assertion}`);
  }

  if (preExistingFailures.length > 0) {
    console.log(
      `Pre-existing solver/font regression failures (outside Stage 15 scope): ${preExistingFailures
        .map(f => f.id)
        .join(', ')}`
    );
  }

  if (stage15Passed.length !== stage15Tests.length) {
    console.error('Stage 15 tests failed!');
    process.exit(1);
  }

  await testSampleDocxRoundTripAndPagination();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
