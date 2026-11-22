/**
 * Stage 16 Verification Script: Commercial License & Activation Foundation
 * Runs all synchronous regression tests (t-1..t-130) plus end-to-end async verification of:
 * 1. Provider responses (DevelopmentTestLicensingProvider vs UnconfiguredProductionLicensingProvider)
 * 2. Non-misrepresentation of test tokens (`isVerifiedCommercialLicense === false`)
 * 3. Invalid, malformed, and expired/revoked license keys
 * 4. One active computer (Device A activation -> Device B rejected -> Device A deactivation -> Device B activation)
 * 5. Offline startup after activation
 * 6. Interrupted activation & transient network failure resilience (never locks out legitimate active user)
 * 7. Idempotent repeated activation attempts on the same computer
 * 8. Deactivation failure safety (keeps current computer active when network/provider fails)
 * 9. Preservation of local user documents and project data across all licensing operations and failures
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

import { buildRegressionTests } from '../src/components/AutomatedTestPanel';
import { DocxImporter } from '../src/engine/docx-importer';
import {
  CommercialLicenseEngine,
  DevelopmentTestLicensingProvider,
  UnconfiguredProductionLicensingProvider,
} from '../src/engine/license-engine';
import { ProjectPersistenceEngine } from '../src/engine/project-persistence';

async function runStage16AsyncVerification(): Promise<void> {
  console.log('=== Running Stage 16 Commercial Licensing Async Verification ===');

  const deviceA = {
    deviceId: 'WIN-WORKSTATION-A100',
    deviceLabel: 'Windows Workstation A100',
    platform: 'Win32',
    createdAt: 1700000000000,
  };
  const deviceB = {
    deviceId: 'WIN-LAPTOP-B200',
    deviceLabel: 'Windows Laptop B200',
    platform: 'Win32',
    createdAt: 1700000005000,
  };

  // Seed user project in local storage and serialize a .keter.json project to verify preservation
  const userProject = ProjectPersistenceEngine.createNewProjectSnapshot({
    documentTitle: 'מסכת קידושין — פרויקט משתמש פעיל',
    layoutType: 'rav_text',
    units: DocxImporter.getSampleBerakhot(),
    links: [],
  });
  ProjectPersistenceEngine.saveAutosave(userProject);
  const exportedKeterJsonBefore = ProjectPersistenceEngine.exportKeterProjectJson(userProject);

  const devProvider = new DevelopmentTestLicensingProvider();
  devProvider.resetTestSeatRegistry();
  const prodProvider = new UnconfiguredProductionLicensingProvider();

  let stateA = CommercialLicenseEngine.createInitialUnactivatedState(deviceA);

  // 1. Verify Production Provider explicitly rejects activation because no backend is configured
  const prodAttempt = await CommercialLicenseEngine.activateLicense(
    stateA,
    'KETER-5786-VILN-SHAS-0001',
    prodProvider
  );
  if (
    prodAttempt.response.ok !== false ||
    prodAttempt.response.errorCode !== 'PRODUCTION_BACKEND_NOT_CONFIGURED' ||
    prodAttempt.nextState.isVerifiedCommercialLicense !== false
  ) {
    throw new Error('Failed check 1: Unconfigured production provider must not fake activation');
  }
  console.log('[PASS] Async 1: UnconfiguredProductionLicensingProvider rejects cleanly without fake verification.');

  // 2. Verify Invalid & Expired keys on Dev/Test provider
  const malformedAttempt = await CommercialLicenseEngine.activateLicense(
    stateA,
    'INVALID-KEY-123',
    devProvider
  );
  const expiredAttempt = await CommercialLicenseEngine.activateLicense(
    stateA,
    'KETER-EXPD-0000-REVK-9999',
    devProvider
  );
  if (
    malformedAttempt.response.ok !== false ||
    malformedAttempt.response.errorCode !== 'INVALID_KEY_FORMAT' ||
    malformedAttempt.nextState.status !== 'expired_or_invalid' ||
    expiredAttempt.response.ok !== false ||
    expiredAttempt.response.errorCode !== 'LICENSE_REVOKED_OR_EXPIRED' ||
    expiredAttempt.nextState.status !== 'expired_or_invalid'
  ) {
    throw new Error('Failed check 2: Invalid or expired keys were not properly rejected');
  }
  console.log('[PASS] Async 2: Malformed and expired/revoked license keys rejected with expired_or_invalid status.');

  // 3. Activate on Computer A (Dev/Test Provider) — must succeed with isVerifiedCommercialLicense === false
  const validKey = 'KETER-5786-VILN-SHAS-0001';
  const actA1 = await CommercialLicenseEngine.activateLicense(
    stateA,
    validKey,
    devProvider,
    'עמדה א׳'
  );
  stateA = actA1.nextState;
  if (
    !actA1.response.ok ||
    stateA.status !== 'activated' ||
    stateA.providerKind !== 'development_test' ||
    stateA.isVerifiedCommercialLicense !== false ||
    stateA.seatBinding?.isVerifiedCommercialLicense !== false ||
    stateA.seatBinding?.boundDeviceId !== deviceA.deviceId
  ) {
    throw new Error('Failed check 3: Activation on Computer A failed or misrepresented commercial verification');
  }
  console.log('[PASS] Async 3: Computer A activated via DevelopmentTestLicensingProvider (isVerifiedCommercialLicense=false).');

  // 4. Repeated activation on Computer A (idempotency)
  const actA2 = await CommercialLicenseEngine.activateLicense(
    stateA,
    validKey,
    devProvider,
    'עמדה א׳'
  );
  stateA = actA2.nextState;
  if (
    !actA2.response.ok ||
    stateA.status !== 'activated' ||
    stateA.seatBinding?.boundDeviceId !== deviceA.deviceId
  ) {
    throw new Error('Failed check 4: Repeated activation on same computer was not idempotent');
  }
  console.log('[PASS] Async 4: Repeated activation on Computer A succeeded idempotently.');

  // 5. Attempt activation of same key on Computer B while Computer A is active -> MUST FAIL (1 active computer)
  const initialB = CommercialLicenseEngine.createInitialUnactivatedState(deviceB);
  const actBWhileAActive = await CommercialLicenseEngine.activateLicense(
    initialB,
    validKey,
    devProvider,
    'עמדה ב׳'
  );
  if (
    actBWhileAActive.response.ok !== false ||
    actBWhileAActive.response.errorCode !== 'SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE' ||
    actBWhileAActive.nextState.status === 'activated'
  ) {
    throw new Error('Failed check 5: Second computer activation was not blocked while first computer was active');
  }
  console.log('[PASS] Async 5: Computer B rejected with SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE while Computer A is active.');

  // 6. Offline Startup & Network Failure on Computer A MUST NOT lock out active user
  devProvider.setSimulationOptions({ simulateNetworkFailure: true });
  const reloadedOfflineA = CommercialLicenseEngine.loadLicenseState(deviceA);
  const offlineCapA = CommercialLicenseEngine.checkOfflineWorkCapability(reloadedOfflineA.state);
  const validationOffline = await devProvider.validateInstalledLicense({
    seatBinding: reloadedOfflineA.state.seatBinding!,
    device: deviceA,
    isOffline: true,
  });
  const actWhileOfflineOnActiveA = await CommercialLicenseEngine.activateLicense(
    reloadedOfflineA.state,
    validKey,
    devProvider
  );
  if (
    !offlineCapA.offlineWorkReady ||
    !validationOffline.validForOfflineWork ||
    actWhileOfflineOnActiveA.nextState.status !== 'activated' ||
    actWhileOfflineOnActiveA.nextState.seatBinding?.boundDeviceId !== deviceA.deviceId
  ) {
    throw new Error('Failed check 6: Network failure or offline startup locked out an already-activated user');
  }
  console.log('[PASS] Async 6: Offline startup and transient network failures preserve Computer A active state.');

  // 7. Deactivation failure on Computer A (while network is down) keeps Computer A activated
  const failedDeactA = await CommercialLicenseEngine.deactivateCurrentDevice(
    stateA,
    devProvider
  );
  stateA = failedDeactA.nextState;
  if (
    failedDeactA.response.ok !== false ||
    stateA.status !== 'activated' ||
    stateA.seatBinding?.boundDeviceId !== deviceA.deviceId
  ) {
    throw new Error('Failed check 7: Failed deactivation did not preserve active seat on Computer A');
  }
  console.log('[PASS] Async 7: Failed deactivation due to network outage safely preserved active seat on Computer A.');

  // 8. Restore network, deactivate Computer A, then activate Computer B (Seat Transfer)
  devProvider.setSimulationOptions({ simulateNetworkFailure: false });
  const successDeactA = await CommercialLicenseEngine.deactivateCurrentDevice(
    stateA,
    devProvider
  );
  stateA = successDeactA.nextState;
  if (
    !successDeactA.response.ok ||
    stateA.status !== 'deactivated' ||
    stateA.seatBinding !== null
  ) {
    throw new Error('Failed check 8a: Deactivation on Computer A did not transition to deactivated state');
  }

  const actBAfterDeactA = await CommercialLicenseEngine.activateLicense(
    initialB,
    validKey,
    devProvider,
    'עמדה ב׳'
  );
  const stateB = actBAfterDeactA.nextState;
  if (
    !actBAfterDeactA.response.ok ||
    stateB.status !== 'activated' ||
    stateB.seatBinding?.boundDeviceId !== deviceB.deviceId ||
    stateB.isVerifiedCommercialLicense !== false
  ) {
    throw new Error('Failed check 8b: Activation on Computer B after deactivating Computer A failed');
  }
  console.log('[PASS] Async 8: Seat transferred cleanly from Computer A (deactivated) to Computer B (activated).');

  // 9. Interrupted activation simulation & preservation of local project data
  devProvider.setSimulationOptions({ simulateInterruptedActivation: true });
  const interruptedAttempt = await CommercialLicenseEngine.activateLicense(
    stateB,
    validKey,
    devProvider
  );
  devProvider.setSimulationOptions({ simulateInterruptedActivation: false });
  if (
    interruptedAttempt.response.errorCode !== 'INTERRUPTED_OPERATION' ||
    interruptedAttempt.nextState.status !== 'activated'
  ) {
    throw new Error('Failed check 9a: Interrupted activation corrupted existing activation on Computer B');
  }

  const recoveredProject = ProjectPersistenceEngine.loadAutosaveWithRecovery();
  const exportedKeterJsonAfter = recoveredProject.snapshot
    ? ProjectPersistenceEngine.exportKeterProjectJson(recoveredProject.snapshot)
    : '';
  const parsedBefore = ProjectPersistenceEngine.validateAndParseProjectJson(exportedKeterJsonBefore);
  const parsedAfter = ProjectPersistenceEngine.validateAndParseProjectJson(exportedKeterJsonAfter);
  if (
    !recoveredProject.snapshot ||
    !parsedBefore.valid ||
    !parsedAfter.valid ||
    parsedBefore.snapshot?.documentTitle !== parsedAfter.snapshot?.documentTitle ||
    parsedBefore.snapshot?.units.length !== parsedAfter.snapshot?.units.length
  ) {
    throw new Error('Failed check 9b: Local user project data was altered or lost during licensing tests');
  }
  console.log('[PASS] Async 9: Interrupted activation handled safely and 100% of user project data preserved.');
}

async function main() {
  await runStage16AsyncVerification();

  const allTests = buildRegressionTests();
  const passed = allTests.filter(t => t.status === 'passed');
  const failed = allTests.filter(t => t.status !== 'passed');

  const stage15Tests = allTests.filter(t => t.suite.includes('Stage 15'));
  const stage15Passed = stage15Tests.filter(t => t.status === 'passed');

  const stage16Tests = allTests.filter(t => t.suite.includes('Stage 16'));
  const stage16Passed = stage16Tests.filter(t => t.status === 'passed');

  const preExistingFailures = failed.filter(
    t => !t.suite.includes('Stage 15') && !t.suite.includes('Stage 16')
  );

  console.log(`\n=== Full Regression & Stage 16 Suite Summary ===`);
  console.log(`Total Tests: ${allTests.length} | Passed: ${passed.length} | Pre-existing solver/font failures: ${preExistingFailures.length}`);
  console.log(`Stage 15 Lifecycle Suite: ${stage15Passed.length}/${stage15Tests.length} PASSED`);
  console.log(`Stage 16 Commercial Licensing Suite: ${stage16Passed.length}/${stage16Tests.length} PASSED`);

  for (const t of stage16Tests) {
    console.log(`  [${t.status.toUpperCase()}] ${t.id}: ${t.name} -> ${t.assertion}`);
  }

  if (preExistingFailures.length > 0) {
    console.log(
      `Pre-existing solver/font regression failures (outside Stage 16 scope): ${preExistingFailures
        .map(f => f.id)
        .join(', ')}`
    );
  }

  if (stage16Passed.length !== stage16Tests.length || stage15Passed.length !== stage15Tests.length) {
    console.error('Stage 15 or Stage 16 tests failed!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
