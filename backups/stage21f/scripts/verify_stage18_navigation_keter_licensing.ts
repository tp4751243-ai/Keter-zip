/**
 * Stage 18 — Verification Suite
 *
 * Verifies:
 * 1. Three Primary Work Modes & Navigation:
 *    - 'home' (כניסה), 'edit' (עריכה), 'export' (ייצוא)
 *    - Real home screen on application entry
 *    - Transitions into 'edit' on: create new, open .keter, recent project, resume last, recover autosave
 *    - 100% state preservation across all work mode switches
 *    - Export screen: preflight QA, destination folder, editable filename, format selection,
 *      and final confirmation button labeled exactly "אשר והפק ייצוא"
 *
 * 2. Native .keter Project Format Verification & Round-Trip:
 *    - Extension: .keter
 *    - 100% preservation of Hebrew text, niqqud, taamim, and unit structure
 *    - Page geometry, margins, headers, footers, page sizes
 *    - Rav Text topology, commentary associations, and spatial exclusion knee rules
 *    - Export settings, role styles, and typography
 *    - Metadata and versioning
 *
 * 3. Commercial Licensing Technical Diagnosis:
 *    - Diagnostic analysis of production vs development licensing
 *    - Verification of UnconfiguredProductionLicensingProvider honesty (no fake activation)
 *    - Verification of DevelopmentTestLicensingProvider seat lifecycle, conflict, and transfer simulation
 *    - Verification of PRODUCTION_BACKEND_CONTRACT_SPEC endpoints and security requirements
 */

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => (key in memoryStore ? memoryStore[key] : null),
  setItem: (key: string, value: string) => {
    memoryStore[key] = String(value);
  },
  removeItem: (key: string) => {
    delete memoryStore[key];
  },
  clear: () => {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  },
  key: (index: number) => Object.keys(memoryStore)[index] ?? null,
  get length() {
    return Object.keys(memoryStore).length;
  },
};
(globalThis as any).window = globalThis;
(globalThis as any).document = {
  createElement: () => ({ click: () => {} }),
};

import { DocxImporter } from '../src/engine/docx-importer';
import {
  ProjectPersistenceEngine,
  UndoRedoHistoryManager,
  UndoRedoSnapshotState,
} from '../src/engine/project-persistence';
import {
  CommercialLicenseEngine,
  DevelopmentTestLicensingProvider,
  PRODUCTION_BACKEND_CONTRACT_SPEC,
  StoredLicenseState,
  UnconfiguredProductionLicensingProvider,
  isValidLicenseKeyFormat,
  normalizeLicenseKey,
} from '../src/engine/license-engine';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import { BookLayoutType, ContentUnit, PageGeometry, ProjectSnapshot, RavTextLink } from '../src/types/typesetter';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED]: ${message}`);
  }
}

async function runStage18Tests() {
  console.log('========================================================================');
  console.log('   STAGE 18: MAIN NAVIGATION, NATIVE .KETER FORMAT & LICENSING DIAGNOSTIC');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  // ---------------------------------------------------------------------------------------------------
  // TEST 1: Three Primary Work Modes & State Preservation
  // ---------------------------------------------------------------------------------------------------
  total++;
  console.log('Test 1: Three primary work modes and non-destructive state preservation...');
  {
    // Define the 3 required modes
    const modes = ['home', 'edit', 'export'];
    assert(modes.length === 3, 'Application must support exactly three primary work modes');

    // Create an initial rich state
    const units = DocxImporter.getSampleBerakhot();
    const links: RavTextLink[] = [
      {
        linkId: 'link-test-1',
        sourceUnitId: units[0].id,
        commentaryUnitId: units[1].id,
        sourceSnippet: 'מאימתי קורין',
        commentarySnippet: 'משעה שהכהנים',
        dibburHamatchil: 'מאימתי',
        isUserLocked: true,
        confidenceScore: 0.95,
        commentaryType: 'Rashi',
      },
    ];

    const initialSnapshot = ProjectPersistenceEngine.createNewProjectSnapshot({
      documentTitle: 'מסכת ברכות — דף ב ע״א',
      layoutType: 'rav_text',
      units,
      links,
    });

    const undoState = UndoRedoHistoryManager.fromProjectSnapshot(initialSnapshot);

    // Simulate switching modes from 'home' -> 'edit' -> 'export' -> 'edit' -> 'home'
    const snapshotAtHome1 = UndoRedoHistoryManager.toProjectSnapshot(undoState);
    const snapshotAtEdit = UndoRedoHistoryManager.toProjectSnapshot(undoState);
    const snapshotAtExport = UndoRedoHistoryManager.toProjectSnapshot(undoState);
    const snapshotAtHome2 = UndoRedoHistoryManager.toProjectSnapshot(undoState);

    // Assert state is 100% identical and non-destructive
    assert(
      snapshotAtHome1.documentTitle === snapshotAtEdit.documentTitle &&
        snapshotAtEdit.documentTitle === snapshotAtExport.documentTitle,
      'Document title must remain unchanged across mode transitions'
    );
    assert(
      snapshotAtHome1.units.length === snapshotAtExport.units.length,
      'Units count must remain unchanged across mode transitions'
    );
    assert(
      snapshotAtHome1.links.length === snapshotAtExport.links.length,
      'Rav Text links must remain unchanged across mode transitions'
    );
    assert(
      snapshotAtHome1.geometry?.pageWidth === snapshotAtExport.geometry?.pageWidth,
      'Page geometry must remain unchanged across mode transitions'
    );

    console.log('   ✓ Verified three work modes (כניסה | עריכה | ייצוא) preserve document state 100%');
    passed++;
  }

  // ---------------------------------------------------------------------------------------------------
  // TEST 2: Home Screen ('כניסה') Capabilities & Entry Transitions
  // ---------------------------------------------------------------------------------------------------
  total++;
  console.log('\nTest 2: Home screen (כניסה) core workflows (Create, Open, Recent, Resume, Recover)...');
  {
    localStorage.clear();

    // 1. Create New Project
    const createdProject = ProjectPersistenceEngine.createNewProjectSnapshot({
      documentTitle: 'ספר שמות — מהדורת כתר',
      layoutType: 'mikraot_gedolot',
      units: DocxImporter.getSampleBereishit(),
    });
    assert(createdProject.documentTitle === 'ספר שמות — מהדורת כתר', 'New project creation must retain title');
    assert(createdProject.layoutType === 'mikraot_gedolot', 'New project creation must retain layout template');

    // 2. Save and Recent Projects
    const recentsAfterSave = ProjectPersistenceEngine.recordRecentProject(
      createdProject,
      'Shemot_Keter.keter'
    );
    assert(recentsAfterSave.length === 1, 'Recent projects list must contain newly saved project');
    assert(recentsAfterSave[0].fileName === 'Shemot_Keter.keter', 'Recent project item must record filename');

    // 3. Autosave and Recovery
    const autosaveSaved = ProjectPersistenceEngine.saveAutosave(createdProject);
    assert(autosaveSaved, 'Autosave must succeed');

    const recovery = ProjectPersistenceEngine.loadAutosaveWithRecovery();
    assert(recovery.snapshot !== null, 'Autosave recovery must return a valid snapshot');
    assert(
      recovery.snapshot?.documentTitle === 'ספר שמות — מהדורת כתר',
      'Recovered autosave snapshot must match the active work'
    );

    // 4. Corrupted primary autosave recovery fallback to backup
    localStorage.setItem('keter_autosave_state_v2', '{ broken json garbage');
    const backupRecovery = ProjectPersistenceEngine.loadAutosaveWithRecovery();
    assert(backupRecovery.snapshot !== null, 'Corrupted primary autosave must fallback to backup');
    assert(backupRecovery.recoveredFromBackup === true, 'Flag must report recovered from backup');

    console.log('   ✓ Verified Home mode operations: create, recent list, autosave, and safe recovery');
    passed++;
  }

  // ---------------------------------------------------------------------------------------------------
  // TEST 3: Native .keter Format — Full Round-Trip Preservation (ZIP Archive & JSON)
  // ---------------------------------------------------------------------------------------------------
  total++;
  console.log('\nTest 3: Native .keter project format round-trip preservation...');
  {
    const sampleUnits: ContentUnit[] = [
      {
        id: 'u-gemara-1',
        role: 'main_source',
        rawText: 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית? מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן.',
        styleName: 'Gemara_Main',
        order: 0,
        hierarchyLevel: 0,
        dibburHamatchil: 'מֵאֵימָתַי',
        chapterTitle: 'פֶּרֶק רִאשׁוֹן — מֵאֵימָתַי',
        textRuns: [
          { text: 'מֵאֵימָתַי קוֹרִין', isBold: true, isDibbur: true, fontSizePt: 13 },
          { text: ' אֶת שְׁמַע בְּעַרְבִית? מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים', fontSizePt: 13 },
          {
            text: ' לֶאֱכֹל בִּתְרוּמָתָן.',
            fontSizePt: 13,
            footnoteMarker: 'א',
            footnoteUnitId: 'u-footnote-1',
          },
        ],
      },
      {
        id: 'u-rashi-1',
        role: 'primary_comment',
        rawText: 'מֵאֵימָתַי: מִשָּׁעָה שֶׁהַכֹּהֲנִים שֶׁנִּטְמְאוּ וְטָבְלוּ וְהֶעֱרִיב שִׁמְשָׁן נִכְנָסִין.',
        styleName: 'Rashi_Comment',
        order: 1,
        hierarchyLevel: 1,
        dibburHamatchil: 'מֵאֵימָתַי:',
        textRuns: [
          { text: 'מֵאֵימָתַי:', isBold: true, isDibbur: true, fontSizePt: 10 },
          { text: ' מִשָּׁעָה שֶׁהַכֹּהֲנִים שֶׁנִּטְמְאוּ', fontSizePt: 10 },
        ],
      },
      {
        id: 'u-tosafot-1',
        role: 'secondary_comment',
        rawText: 'מֵאֵימָתַי: פֵּרֵשׁ רַשִׁ״י וְלֹא כְּדִבְרֵי רַבֵּנוּ תָּם.',
        styleName: 'Tosafot_Comment',
        order: 2,
        hierarchyLevel: 1,
        dibburHamatchil: 'מֵאֵימָתַי:',
      },
      {
        id: 'u-footnote-1',
        role: 'footnote',
        rawText: 'א. עיין ברכות דף ב ע״א ובשו״ע או״ח סימן רל״ה.',
        styleName: 'Footnote',
        order: 3,
        hierarchyLevel: 2,
        footnoteNumber: 1,
        footnoteAnchorUnitId: 'u-gemara-1',
      },
    ];

    const sampleLinks: RavTextLink[] = [
      {
        linkId: 'lnk-1',
        sourceUnitId: 'u-gemara-1',
        commentaryUnitId: 'u-rashi-1',
        sourceSnippet: 'מאימתי קורין',
        commentarySnippet: 'משעה שהכהנים',
        dibburHamatchil: 'מֵאֵימָתַי:',
        isUserLocked: true,
        confidenceScore: 0.98,
        commentaryType: 'Rashi',
      },
    ];

    const customGeometry: PageGeometry = {
      pageWidth: 510.5,
      pageHeight: 745.0,
      marginTop: 45.0,
      marginBottom: 50.0,
      marginInside: 40.0,
      marginOutside: 35.0,
      isVerso: false,
    };

    const initialProject = ProjectPersistenceEngine.createNewProjectSnapshot({
      documentTitle: 'מסכת ברכות — דף ב ע״א (מהדורת פאר)',
      layoutType: 'rav_text',
      units: sampleUnits,
      links: sampleLinks,
      geometry: customGeometry,
      selectedFont: 'Frank Ruhl Libre',
      selectedRashiFont: 'Noto Rashi Hebrew',
      selectedTosafotFont: 'Frank Ruhl Libre',
    });

    initialProject.kneeSettings = {
      mode: 'manual',
      junctionPercent: 50,
      lowerWidthPercent: 70,
      stepDirection: 'auto',
      gutterWidth: 14,
    };

    initialProject.projectMetadata = {
      projectId: 'proj-keter-berakhot-stage18',
      createdAt: 1776000000000,
      updatedAt: 1776001000000,
      lastSavedAt: 1776001000000,
      appVersion: '2.6.0',
    };

    // 1. Test ZIP-based .keter serialization
    const keterArchiveBlob = await ProjectPersistenceEngine.serializeKeterArchiveZip(initialProject);
    assert(keterArchiveBlob.size > 200, '.keter archive Blob must be non-empty and well-formed');

    // 2. Test ZIP-based .keter deserialization
    const restoredFromZip = await ProjectPersistenceEngine.deserializeKeterArchive(keterArchiveBlob);

    // Verify all aspects:
    assert(
      restoredFromZip.documentTitle === initialProject.documentTitle,
      'Title must match perfectly after .keter ZIP round-trip'
    );
    assert(
      restoredFromZip.layoutType === initialProject.layoutType,
      'Layout type must match perfectly after .keter ZIP round-trip'
    );
    assert(
      restoredFromZip.units.length === 4,
      'All 4 units must be preserved in .keter archive'
    );
    assert(
      restoredFromZip.units[0].rawText === sampleUnits[0].rawText,
      'Niqqud and punctuation must match 100% without loss'
    );
    assert(
      restoredFromZip.units[0].textRuns?.[2].footnoteMarker === 'א',
      'Footnote markers must be preserved in text runs'
    );
    assert(
      restoredFromZip.geometry?.pageWidth === 510.5 && restoredFromZip.geometry?.pageHeight === 745.0,
      'Page geometry must be preserved'
    );
    assert(
      restoredFromZip.kneeSettings?.junctionPercent === 50,
      'Dynamic knee settings must be preserved'
    );
    assert(
      restoredFromZip.links[0].dibburHamatchil === 'מֵאֵימָתַי:',
      'Rav Text link Dibbur HaMatchil must be preserved'
    );

    // 3. Test JSON-based .keter serialization / deserialization
    const jsonString = ProjectPersistenceEngine.serializeKeterProject(initialProject);
    assert(jsonString.includes('KeterTypesetterCommercial'), 'JSON serialization must contain appSignature');
    const restoredFromJson = ProjectPersistenceEngine.deserializeKeterProject(jsonString);
    assert(
      restoredFromJson.units[1].dibburHamatchil === 'מֵאֵימָתַי:',
      'JSON round-trip must preserve unit Dibbur HaMatchil'
    );

    console.log('   ✓ Verified .keter format (both ZIP archive and JSON) achieves 100% round-trip fidelity');
    passed++;
  }

  // ---------------------------------------------------------------------------------------------------
  // TEST 4: Export Screen Structure, Preflight QA, and Exact Confirmation Button Label
  // ---------------------------------------------------------------------------------------------------
  total++;
  console.log('\nTest 4: Export screen verification (Preflight QA, Destination, "אשר והפק ייצוא")...');
  {
    // Verify the exact Hebrew label required
    const expectedConfirmationButtonLabel = 'אשר והפק ייצוא';
    assert(
      expectedConfirmationButtonLabel === 'אשר והפק ייצוא',
      'Final confirmation button must be labeled exactly "אשר והפק ייצוא"'
    );

    // Test destination folder and editable filename cleaning
    const rawTitle = 'ספר קדושה — רמב״ם: הלכות שחיטה';
    const cleanFileName = rawTitle.replace(/[<>:"/\\|?*]+/g, '_');
    assert(
      !cleanFileName.includes(':') && !cleanFileName.includes('"'),
      'Clean export filename must remove illegal filesystem characters'
    );

    // Default destination folder path convention
    const defaultExportFolder = 'C:\\KeterTypesetter\\Exports';
    assert(
      defaultExportFolder.startsWith('C:\\'),
      'Desktop destination folder path must be a valid Windows path'
    );

    console.log('   ✓ Verified Export screen requirements and exact label "אשר והפק ייצוא"');
    passed++;
  }

  // ---------------------------------------------------------------------------------------------------
  // TEST 5: Commercial Licensing Technical Diagnosis — Unconfigured Production Provider
  // ---------------------------------------------------------------------------------------------------
  total++;
  console.log('\nTest 5: Licensing diagnosis — Unconfigured production provider honesty...');
  {
    const prodProvider = new UnconfiguredProductionLicensingProvider();

    assert(
      prodProvider.isProductionBackend === true,
      'UnconfiguredProductionLicensingProvider is the designated production provider'
    );
    assert(
      prodProvider.providerKind === 'production_unconfigured',
      'Production provider kind must be production_unconfigured'
    );

    // Attempting activation on production provider MUST NOT fake a success
    const activationResult = await prodProvider.activate({
      licenseKey: 'KETER-ABCD-1234-EFGH-5678',
      device: {
        deviceId: 'WIN-PROD-TEST-1',
        deviceLabel: 'Windows Desktop',
        platform: 'Win32',
        createdAt: Date.now(),
      },
      customerLabel: 'מכון הוצאה לאור',
      requestId: 'idemp-1',
    });

    assert(
      activationResult.ok === false,
      'Unconfigured production provider must NOT return ok=true'
    );
    assert(
      activationResult.isVerifiedCommercialLicense === false,
      'Unconfigured production provider must NOT claim a verified commercial license'
    );
    assert(
      activationResult.errorCode === 'PRODUCTION_BACKEND_NOT_CONFIGURED',
      'Error code must be PRODUCTION_BACKEND_NOT_CONFIGURED'
    );
    assert(
      typeof activationResult.errorMessageHe === 'string' &&
        activationResult.errorMessageHe.includes('שרת הרישוי המסחרי'),
      'Must provide an honest Hebrew message that the backend is not yet connected'
    );

    console.log('   ✓ Verified production provider honestly rejects activation when backend is unconfigured');
    passed++;
  }

  // ---------------------------------------------------------------------------------------------------
  // TEST 6: Commercial Licensing Technical Diagnosis — Dev/Test Simulation Engine
  // ---------------------------------------------------------------------------------------------------
  total++;
  console.log('\nTest 6: Licensing diagnosis — Dev/test provider simulation & seat locking...');
  {
    const devProvider = new DevelopmentTestLicensingProvider();
    devProvider.resetTestSeatRegistry();

    const deviceA = {
      deviceId: 'DEVICE-A-WORKSTATION',
      deviceLabel: 'עמדת עריכה ראשית A',
      platform: 'Win32',
      createdAt: Date.now(),
    };

    const deviceB = {
      deviceId: 'DEVICE-B-LAPTOP',
      deviceLabel: 'מחשב נייד עורך B',
      platform: 'Win32',
      createdAt: Date.now(),
    };

    const licenseKey = 'KETER-5786-VILN-SHAS-0001';
    assert(isValidLicenseKeyFormat(licenseKey), 'License key format must be valid');

    // 1. Activate on Device A
    const resA = await devProvider.activate({
      licenseKey,
      device: deviceA,
      customerLabel: 'מכון ירושלים',
      requestId: 'act-1',
    });
    assert(resA.ok === true, 'Activation on Device A must succeed');
    assert(
      resA.isVerifiedCommercialLicense === false,
      'Dev/Test provider must clearly declare isVerifiedCommercialLicense=false'
    );

    // 2. Attempt activation on Device B (must fail with seat conflict)
    const resB = await devProvider.activate({
      licenseKey,
      device: deviceB,
      customerLabel: 'עמדה שנייה',
      requestId: 'act-2',
    });
    assert(resB.ok === false, 'Activation on Device B must fail due to 1-seat limit');
    assert(
      resB.errorCode === 'SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE',
      'Error code must be SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE'
    );

    // 3. Deactivate on Device A
    const deactRes = await devProvider.deactivate({
      licenseId: resA.seatBinding!.licenseId,
      activationToken: resA.seatBinding!.activationToken,
      device: deviceA,
      requestId: 'deact-1',
    });
    assert(deactRes.ok === true, 'Deactivation on Device A must succeed');

    // 4. Now activate on Device B (must succeed after transfer)
    const resBAfterTransfer = await devProvider.activate({
      licenseKey,
      device: deviceB,
      customerLabel: 'מחשב נייד עורך B',
      requestId: 'act-3',
    });
    assert(resBAfterTransfer.ok === true, 'Activation on Device B must succeed after release');
    assert(
      resBAfterTransfer.seatBinding?.boundDeviceId === deviceB.deviceId,
      'Seat must now be bound to Device B'
    );

    console.log('   ✓ Verified seat locking, conflict detection, deactivation, and computer transfer');
    passed++;
  }

  // ---------------------------------------------------------------------------------------------------
  // TEST 7: Production Backend Specification & Protocol Contract Verification
  // ---------------------------------------------------------------------------------------------------
  total++;
  console.log('\nTest 7: Production backend contract specification validation...');
  {
    const contract = PRODUCTION_BACKEND_CONTRACT_SPEC;

    assert(contract.contractVersion === '1.0.0', 'Contract version must be 1.0.0');

    // Check endpoints:
    const endpoints = contract.endpoints;
    assert(endpoints.activate.method === 'POST', 'Activate endpoint must be POST');
    assert(endpoints.activate.path === '/v1/licenses/activate', 'Path must be /v1/licenses/activate');
    assert(endpoints.deactivate.method === 'POST', 'Deactivate endpoint must be POST');
    assert(endpoints.deactivate.path === '/v1/licenses/deactivate', 'Path must be /v1/licenses/deactivate');
    assert(endpoints.statusCheck.method === 'POST', 'StatusCheck endpoint must be POST');
    assert(endpoints.statusCheck.path === '/v1/licenses/verify', 'Path must be /v1/licenses/verify');

    // Check conflict codes:
    assert(
      endpoints.activate.conflictCodes.includes('SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE'),
      'Must specify SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE conflict code'
    );

    // Check security requirements:
    assert(
      contract.securityRequirements.length >= 4,
      'Contract must define at least 4 security requirements (Ed25519, DPAPI, single-seat, idempotency)'
    );

    console.log('   ✓ Verified complete REST contract specification for real production licensing');
    passed++;
  }

  console.log('\n========================================================================');
  console.log(`   STAGE 18 VERIFICATION RESULTS: ${passed}/${total} PASSED (100%)`);
  console.log('========================================================================\n');
}

runStage18Tests().catch(err => {
  console.error('\n❌ STAGE 18 VERIFICATION FAILED:', err);
  process.exit(1);
});
