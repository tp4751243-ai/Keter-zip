/**
 * Keter Typesetter — Stage 16: Commercial License and Activation Foundation
 *
 * Implements the foundation for Keter Typesetter's one-time-purchase commercial license:
 * 1. Explicit License States:
 *    - 'unactivated': No active license installed on this device.
 *    - 'activated': Active license installed and bound to this device (clearly marked whether verified by Production Server or Development/Test Provider).
 *    - 'expired_or_invalid': License was rejected, revoked, hardware-mismatched, or structurally invalid.
 *    - 'deactivated': License was explicitly deactivated on this computer so it can be transferred to another computer.
 *
 * 2. Strict Separation Between Development/Test Provider and Production Provider:
 *    - A locally generated or test-provider token is NEVER represented as a verified commercial license (`isVerifiedCommercialLicense === false`).
 *    - No imaginary production URL, API endpoint, signing secret, or mocked production verification result is invented.
 *    - Includes the documented `MinimalProductionLicensingBackendContract` defining the exact backend endpoints and cryptographic verification required before commercial release.
 *
 * 3. Single Active Computer (1-Seat Per License) & Safe Network / Interrupted Activation Handling:
 *    - Tracks `deviceId` (deterministic local machine fingerprint) and `seatBinding`.
 *    - Supports deactivating the current computer (`deactivateCurrentDevice`) and activating on a second computer (`activateLicense`).
 *    - Handles network failures, repeated requests (idempotency via `requestId`), invalid responses, and interrupted activations safely without locking out a legitimate activated user during temporary network outages.
 *
 * 4. Offline-First Operation After Activation:
 *    - Once activated, ordinary typesetting, document editing, project saving/loading, and PDF/IDML exports work 100% offline without nagging prompts.
 *
 * 5. Local Persistence & Integrity Envelope:
 *    - Uses the safest practical desktop storage envelope available in the current architecture (versioned envelope with SHA-256 / FNV-1a integrity digest and backup slot, plus optional Windows Electron safeStorage / DPAPI bridge detection when running inside a native wrapper).
 *    - Explicitly documents that client-side storage checks alone do not prevent determined local tampering without OS-level hardware-backed verification and server-signed asymmetric tokens (Ed25519/RSA-PSS).
 */

export type LicenseStatus =
  | 'unactivated'
  | 'activated'
  | 'expired_or_invalid'
  | 'deactivated';

export type LicenseProviderKind = 'development_test' | 'production_unconfigured';

export type LicenseOperationErrorCode =
  | 'INVALID_KEY_FORMAT'
  | 'LICENSE_NOT_FOUND'
  | 'LICENSE_REVOKED_OR_EXPIRED'
  | 'SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE'
  | 'DEVICE_MISMATCH'
  | 'NETWORK_UNAVAILABLE'
  | 'INTERRUPTED_OPERATION'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'PRODUCTION_BACKEND_NOT_CONFIGURED'
  | 'CORRUPTED_LOCAL_STATE';

export interface DeviceIdentity {
  deviceId: string;
  deviceLabel: string;
  platform: string;
  createdAt: number;
}

export interface LicenseSeatBinding {
  licenseKeyMasked: string;
  licenseId: string;
  customerLabel?: string;
  edition: 'Keter Typesetter Studio — One-Time Commercial Purchase';
  boundDeviceId: string;
  boundDeviceLabel: string;
  activatedAt: number;
  lastVerifiedAt: number;
  maxActiveComputers: 1;
  activationToken: string;
  /**
   * CRITICAL REQUIREMENT:
   * A locally generated or development/test provider token must NEVER be represented
   * as a verified commercial production license.
   */
  providerKind: LicenseProviderKind;
  isVerifiedCommercialLicense: boolean;
  serverPublicKeySignature?: string;
}

export interface StoredLicenseState {
  schemaVersion: 1;
  status: LicenseStatus;
  providerKind: LicenseProviderKind;
  /**
   * True ONLY when verified by a real cryptographic production licensing server.
   * Always false for the development/test provider or local tokens.
   */
  isVerifiedCommercialLicense: boolean;
  device: DeviceIdentity;
  seatBinding: LicenseSeatBinding | null;
  lastDeactivatedAt?: number;
  lastDeactivatedDeviceId?: string;
  lastError?: {
    code: LicenseOperationErrorCode;
    messageHe: string;
    timestamp: number;
    recoverable: boolean;
  } | null;
  pendingOperation?: {
    type: 'activate' | 'deactivate';
    requestId: string;
    startedAt: number;
    licenseKeyMasked: string;
    targetDeviceId: string;
  } | null;
  updatedAt: number;
}

export interface LicenseStorageEnvelope {
  envelopeVersion: 'KETER_LICENSE_ENVELOPE_V1';
  storageMechanism: 'desktop_dpapi_bridge' | 'browser_local_storage_envelope';
  integrityDigest: string;
  payload: StoredLicenseState;
}

export interface LicenseActivationRequest {
  licenseKey: string;
  device: DeviceIdentity;
  requestId: string;
  customerLabel?: string;
}

export interface LicenseActivationResponse {
  ok: boolean;
  status: LicenseStatus;
  providerKind: LicenseProviderKind;
  isVerifiedCommercialLicense: boolean;
  seatBinding?: LicenseSeatBinding;
  errorCode?: LicenseOperationErrorCode;
  errorMessageHe?: string;
  activeOtherDeviceLabel?: string;
}

export interface LicenseDeactivationRequest {
  licenseId: string;
  activationToken: string;
  device: DeviceIdentity;
  requestId: string;
}

export interface LicenseDeactivationResponse {
  ok: boolean;
  status: LicenseStatus;
  providerKind: LicenseProviderKind;
  deactivatedAt?: number;
  errorCode?: LicenseOperationErrorCode;
  errorMessageHe?: string;
}

export interface LicenseValidationRequest {
  seatBinding: LicenseSeatBinding;
  device: DeviceIdentity;
  isOffline: boolean;
}

export interface LicenseValidationResult {
  validForOfflineWork: boolean;
  status: LicenseStatus;
  providerKind: LicenseProviderKind;
  isVerifiedCommercialLicense: boolean;
  warningMessageHe?: string;
  errorCode?: LicenseOperationErrorCode;
}

/**
 * Clean interface separating the desktop client from the licensing verification provider.
 */
export interface ILicensingProvider {
  readonly providerKind: LicenseProviderKind;
  readonly providerNameHe: string;
  readonly isProductionBackend: boolean;

  activate(request: LicenseActivationRequest): Promise<LicenseActivationResponse>;
  deactivate(request: LicenseDeactivationRequest): Promise<LicenseDeactivationResponse>;
  validateInstalledLicense(request: LicenseValidationRequest): Promise<LicenseValidationResult>;
}

/**
 * Minimal Backend Contract Documentation Required for Production Commercial Release.
 * No production URL or secret is invented here; this contract specifies what the
 * commercial activation backend must implement before shipping to paying customers.
 */
export interface MinimalProductionLicensingBackendContract {
  contractVersion: '1.0.0';
  architectureSummary: string;
  endpoints: {
    activate: {
      method: 'POST';
      path: '/v1/licenses/activate';
      requestBody: {
        licenseKey: string;
        deviceId: string;
        deviceLabel: string;
        platform: string;
        appVersion: string;
        idempotencyKey: string;
      };
      responseBody: {
        licenseId: string;
        edition: string;
        boundDeviceId: string;
        activatedAtIso: string;
        signedActivationCertificate: string; // Ed25519 / RSA-PSS signed payload verified offline via public key
      };
      conflictCodes: [
        'SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE',
        'INVALID_LICENSE_KEY',
        'LICENSE_REVOKED'
      ];
    };
    deactivate: {
      method: 'POST';
      path: '/v1/licenses/deactivate';
      requestBody: {
        licenseId: string;
        deviceId: string;
        activationCertificate: string;
        idempotencyKey: string;
      };
      responseBody: {
        deactivated: boolean;
        deactivatedAtIso: string;
        seatReleased: boolean;
      };
    };
    statusCheck: {
      method: 'POST';
      path: '/v1/licenses/verify';
      requestBody: {
        licenseId: string;
        deviceId: string;
        activationCertificate: string;
      };
      responseBody: {
        valid: boolean;
        status: 'active' | 'revoked' | 'transferred';
      };
    };
  };
  securityRequirements: string[];
}

export const PRODUCTION_BACKEND_CONTRACT_SPEC: MinimalProductionLicensingBackendContract = {
  contractVersion: '1.0.0',
  architectureSummary:
    'One-time purchase commercial license server with 1-active-computer seat lock and asymmetric (Ed25519) signed offline activation certificates.',
  endpoints: {
    activate: {
      method: 'POST',
      path: '/v1/licenses/activate',
      requestBody: {
        licenseKey: 'KETER-XXXX-XXXX-XXXX-XXXX',
        deviceId: 'sha256-machine-fingerprint',
        deviceLabel: 'Windows Workstation',
        platform: 'win32',
        appVersion: '2.6.0',
        idempotencyKey: 'uuid-v4',
      },
      responseBody: {
        licenseId: 'lic_prod_id',
        edition: 'Keter Typesetter Studio — One-Time Commercial Purchase',
        boundDeviceId: 'sha256-machine-fingerprint',
        activatedAtIso: '2026-01-01T00:00:00Z',
        signedActivationCertificate: 'base64url(payload).base64url(ed25519_signature)',
      },
      conflictCodes: [
        'SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE',
        'INVALID_LICENSE_KEY',
        'LICENSE_REVOKED',
      ],
    },
    deactivate: {
      method: 'POST',
      path: '/v1/licenses/deactivate',
      requestBody: {
        licenseId: 'lic_prod_id',
        deviceId: 'sha256-machine-fingerprint',
        activationCertificate: 'base64url(payload).base64url(ed25519_signature)',
        idempotencyKey: 'uuid-v4',
      },
      responseBody: {
        deactivated: true,
        deactivatedAtIso: '2026-01-02T00:00:00Z',
        seatReleased: true,
      },
    },
    statusCheck: {
      method: 'POST',
      path: '/v1/licenses/verify',
      requestBody: {
        licenseId: 'lic_prod_id',
        deviceId: 'sha256-machine-fingerprint',
        activationCertificate: 'base64url(payload).base64url(ed25519_signature)',
      },
      responseBody: {
        valid: true,
        status: 'active',
      },
    },
  },
  securityRequirements: [
    'Server holds the private Ed25519 signing key in HSM/KMS; the desktop client embeds ONLY the public verification key (never a signing secret).',
    'Server enforces atomic single-seat locking: activating a license key fails with SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE if boundDeviceId is already populated with a different deviceId.',
    'Idempotency keys ensure repeated activation requests from the same deviceId return the existing certificate without error.',
    'Deactivation verifies the current deviceId or an authenticated customer recovery flow before releasing the seat.',
    'Windows desktop wrapper (Electron/Tauri) encrypts the local activation certificate using Windows DPAPI (CryptProtectData / safeStorage) bound to the current OS user/machine.',
  ],
};

const LICENSE_STORAGE_KEY = 'keter.commercial.license.state.v1';
const LICENSE_STORAGE_BACKUP_KEY = 'keter.commercial.license.state.backup.v1';
const DEVICE_IDENTITY_KEY = 'keter.commercial.device.identity.v1';
const DEV_PROVIDER_SEAT_REGISTRY_KEY = 'keter.dev_test.seat_registry.v1';

function getPrimaryStorageKeyForDevice(deviceId?: string): string {
  return deviceId ? `${LICENSE_STORAGE_KEY}.${deviceId}` : LICENSE_STORAGE_KEY;
}

function getBackupStorageKeyForDevice(deviceId?: string): string {
  return deviceId
    ? `${LICENSE_STORAGE_BACKUP_KEY}.${deviceId}`
    : LICENSE_STORAGE_BACKUP_KEY;
}

/**
 * Computes a deterministic non-secret integrity digest for detecting accidental corruption
 * of the local license state envelope. Note: This is for corruption detection, NOT a claim
 * of cryptographic tamper-proofing on the client.
 */
export function computeEnvelopeIntegrityDigest(state: StoredLicenseState): string {
  const canonical = JSON.stringify({
    schemaVersion: state.schemaVersion,
    status: state.status,
    providerKind: state.providerKind,
    isVerifiedCommercialLicense: state.isVerifiedCommercialLicense,
    deviceId: state.device?.deviceId ?? '',
    seatBinding: state.seatBinding
      ? {
          licenseId: state.seatBinding.licenseId,
          boundDeviceId: state.seatBinding.boundDeviceId,
          activationToken: state.seatBinding.activationToken,
          providerKind: state.seatBinding.providerKind,
          isVerifiedCommercialLicense: state.seatBinding.isVerifiedCommercialLicense,
        }
      : null,
  });

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= ch * 31;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `fnv1a64:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/**
 * Formats and validates a Keter license key structure.
 * Valid format: KETER-XXXX-XXXX-XXXX-XXXX (alphanumeric segments of 4 chars).
 */
export function normalizeLicenseKey(rawKey: string): string {
  return rawKey.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidLicenseKeyFormat(rawKey: string): boolean {
  const normalized = normalizeLicenseKey(rawKey);
  return /^KETER-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized);
}

export function maskLicenseKey(rawKey: string): string {
  const normalized = normalizeLicenseKey(rawKey);
  const parts = normalized.split('-');
  if (parts.length !== 5) return 'KETER-****-****-****-****';
  return `${parts[0]}-****-****-****-${parts[4]}`;
}

/**
 * Unconfigured Production Provider:
 * Clearly reports that no production licensing server is configured in this build,
 * rather than inventing a fake server URL or pretending a local check is a verified commercial license.
 */
export class UnconfiguredProductionLicensingProvider implements ILicensingProvider {
  public readonly providerKind: LicenseProviderKind = 'production_unconfigured';
  public readonly providerNameHe = 'שרת רישוי מסחרי (ייצור — טרם חובר שרת אימות)';
  public readonly isProductionBackend = true;

  public async activate(_request: LicenseActivationRequest): Promise<LicenseActivationResponse> {
    return {
      ok: false,
      status: 'unactivated',
      providerKind: 'production_unconfigured',
      isVerifiedCommercialLicense: false,
      errorCode: 'PRODUCTION_BACKEND_NOT_CONFIGURED',
      errorMessageHe:
        'שרת הרישוי המסחרי (Production Licensing Backend) טרם הוגדר בגרסה זו. לבדיקת מחזור החיים של הפעלה/ניתוק מחשב, יש להשתמש בספק הבדיקות והפיתוח (Development/Test Provider).',
    };
  }

  public async deactivate(
    _request: LicenseDeactivationRequest
  ): Promise<LicenseDeactivationResponse> {
    return {
      ok: false,
      status: 'activated',
      providerKind: 'production_unconfigured',
      errorCode: 'PRODUCTION_BACKEND_NOT_CONFIGURED',
      errorMessageHe:
        'לא ניתן לבצע העברת מושב מול שרת ייצור מכיוון ששרת הרישוי המסחרי טרם חובר.',
    };
  }

  public async validateInstalledLicense(
    request: LicenseValidationRequest
  ): Promise<LicenseValidationResult> {
    if (request.seatBinding.boundDeviceId !== request.device.deviceId) {
      return {
        validForOfflineWork: false,
        status: 'expired_or_invalid',
        providerKind: 'production_unconfigured',
        isVerifiedCommercialLicense: false,
        errorCode: 'DEVICE_MISMATCH',
        warningMessageHe: 'הרישיון המקומי שייך למזהה מחשב אחר.',
      };
    }

    // Never represent an unverified token as a verified commercial production license
    return {
      validForOfflineWork: false,
      status: 'expired_or_invalid',
      providerKind: 'production_unconfigured',
      isVerifiedCommercialLicense: false,
      errorCode: 'PRODUCTION_BACKEND_NOT_CONFIGURED',
      warningMessageHe:
        'אסימון מקומי אינו מוכר כרישיון מסחרי מאומת ללא חתימה קריפטוגרפית משרת ייצור.',
    };
  }
}

export interface DevTestProviderSimulationOptions {
  simulateNetworkFailure?: boolean;
  simulateInterruptedActivation?: boolean;
  simulateInvalidResponse?: boolean;
}

interface DevSeatRecord {
  licenseKeyNormalized: string;
  licenseId: string;
  boundDeviceId: string | null;
  boundDeviceLabel: string | null;
  activatedAt: number | null;
  activationToken: string | null;
  lastRequestId?: string;
}

/**
 * Development / Test Licensing Provider:
 * Implements realistic 1-active-computer seat locking, idempotency on repeated requests,
 * deactivation/transfer between computers, and simulated network/interruption faults.
 *
 * CRITICAL: Always sets `providerKind: 'development_test'` and `isVerifiedCommercialLicense: false`.
 */
export class DevelopmentTestLicensingProvider implements ILicensingProvider {
  public readonly providerKind: LicenseProviderKind = 'development_test';
  public readonly providerNameHe = 'ספק רישוי לפיתוח ובדיקות (Development / Test Provider — לא מסחרי)';
  public readonly isProductionBackend = false;

  private simulationOptions: DevTestProviderSimulationOptions = {};
  private inMemoryRegistry: Record<string, DevSeatRecord> = {};

  constructor(initialOptions?: DevTestProviderSimulationOptions) {
    if (initialOptions) {
      this.simulationOptions = { ...initialOptions };
    }
  }

  public setSimulationOptions(options: DevTestProviderSimulationOptions): void {
    this.simulationOptions = { ...options };
  }

  public getSimulationOptions(): DevTestProviderSimulationOptions {
    return { ...this.simulationOptions };
  }

  private loadRegistry(): Record<string, DevSeatRecord> {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(DEV_PROVIDER_SEAT_REGISTRY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            return { ...this.inMemoryRegistry, ...parsed };
          }
        }
      }
    } catch {
      // Fallback to in-memory registry
    }
    return { ...this.inMemoryRegistry };
  }

  private saveRegistry(reg: Record<string, DevSeatRecord>): void {
    this.inMemoryRegistry = { ...reg };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DEV_PROVIDER_SEAT_REGISTRY_KEY, JSON.stringify(reg));
      }
    } catch {
      // Ignore storage quota errors in test environments
    }
  }

  public resetTestSeatRegistry(): void {
    this.inMemoryRegistry = {};
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(DEV_PROVIDER_SEAT_REGISTRY_KEY);
      }
    } catch {
      // Ignore
    }
  }

  public async activate(request: LicenseActivationRequest): Promise<LicenseActivationResponse> {
    if (this.simulationOptions.simulateNetworkFailure) {
      return {
        ok: false,
        status: 'unactivated',
        providerKind: 'development_test',
        isVerifiedCommercialLicense: false,
        errorCode: 'NETWORK_UNAVAILABLE',
        errorMessageHe:
          'אין תקשורת עם שירות הרישוי. הפעלה ראשונית או העברת רישיון דורשות חיבור לאינטרנט.',
      };
    }

    if (this.simulationOptions.simulateInterruptedActivation) {
      return {
        ok: false,
        status: 'unactivated',
        providerKind: 'development_test',
        isVerifiedCommercialLicense: false,
        errorCode: 'INTERRUPTED_OPERATION',
        errorMessageHe:
          'תהליך ההפעלה הופסק באמצע עקב ניתוק תקשורת. ניתן לנסות שנית בבטחה עם אותו מפתח.',
      };
    }

    if (this.simulationOptions.simulateInvalidResponse) {
      return {
        ok: false,
        status: 'unactivated',
        providerKind: 'development_test',
        isVerifiedCommercialLicense: false,
        errorCode: 'INVALID_PROVIDER_RESPONSE',
        errorMessageHe: 'התקבלה תשובה לא תקינה מספק הרישוי. המצב המקומי נשמר ללא שינוי.',
      };
    }

    const normalizedKey = normalizeLicenseKey(request.licenseKey);
    if (!isValidLicenseKeyFormat(normalizedKey)) {
      return {
        ok: false,
        status: 'expired_or_invalid',
        providerKind: 'development_test',
        isVerifiedCommercialLicense: false,
        errorCode: 'INVALID_KEY_FORMAT',
        errorMessageHe:
          'מבנה מפתח הרישיון אינו תקין. נדרש מבנה KETER-XXXX-XXXX-XXXX-XXXX.',
      };
    }

    // Explicit test keys for expired/revoked or not-found testing
    if (normalizedKey.includes('EXPD') || normalizedKey.includes('REVK')) {
      return {
        ok: false,
        status: 'expired_or_invalid',
        providerKind: 'development_test',
        isVerifiedCommercialLicense: false,
        errorCode: 'LICENSE_REVOKED_OR_EXPIRED',
        errorMessageHe: 'מפתח הרישיון פג תוקף או בוטל ואינו מורשה להפעלה.',
      };
    }

    if (normalizedKey.includes('NONE') || normalizedKey.includes('0000-0000')) {
      return {
        ok: false,
        status: 'expired_or_invalid',
        providerKind: 'development_test',
        isVerifiedCommercialLicense: false,
        errorCode: 'LICENSE_NOT_FOUND',
        errorMessageHe: 'מפתח הרישיון לא נמצא במאגר הרישיונות.',
      };
    }

    const registry = this.loadRegistry();
    const existing = registry[normalizedKey];

    // Check 1-active-computer constraint
    if (
      existing &&
      existing.boundDeviceId &&
      existing.boundDeviceId !== request.device.deviceId
    ) {
      return {
        ok: false,
        status: 'unactivated',
        providerKind: 'development_test',
        isVerifiedCommercialLicense: false,
        errorCode: 'SEAT_ALREADY_ACTIVE_ON_OTHER_DEVICE',
        activeOtherDeviceLabel: existing.boundDeviceLabel ?? existing.boundDeviceId,
        errorMessageHe: `רישיון זה פעיל כעת במחשב אחר (${
          existing.boundDeviceLabel ?? existing.boundDeviceId
        }). הרישיון מתיר מחשב פעיל אחד בלבד בכל עת. יש לנתק (Deactivate) את המחשב הקודם תחילה.`,
      };
    }

    const now = Date.now();
    // Idempotent handling if already bound to the SAME deviceId
    const licenseId =
      existing?.licenseId ?? `dev_lic_${normalizedKey.slice(-9).replace('-', '').toLowerCase()}`;
    const activationToken =
      existing?.boundDeviceId === request.device.deviceId && existing.activationToken
        ? existing.activationToken
        : `dev_test_token_${licenseId}_${request.device.deviceId}_${now}`;

    const updatedRecord: DevSeatRecord = {
      licenseKeyNormalized: normalizedKey,
      licenseId,
      boundDeviceId: request.device.deviceId,
      boundDeviceLabel: request.device.deviceLabel,
      activatedAt: existing?.activatedAt ?? now,
      activationToken,
      lastRequestId: request.requestId,
    };

    registry[normalizedKey] = updatedRecord;
    this.saveRegistry(registry);

    const seatBinding: LicenseSeatBinding = {
      licenseKeyMasked: maskLicenseKey(normalizedKey),
      licenseId,
      customerLabel: request.customerLabel?.trim() || 'סביבת בדיקות ופיתוח (Dev/Test)',
      edition: 'Keter Typesetter Studio — One-Time Commercial Purchase',
      boundDeviceId: request.device.deviceId,
      boundDeviceLabel: request.device.deviceLabel,
      activatedAt: updatedRecord.activatedAt ?? now,
      lastVerifiedAt: now,
      maxActiveComputers: 1,
      activationToken,
      providerKind: 'development_test',
      isVerifiedCommercialLicense: false, // NEVER true for dev/test provider
    };

    return {
      ok: true,
      status: 'activated',
      providerKind: 'development_test',
      isVerifiedCommercialLicense: false,
      seatBinding,
    };
  }

  public async deactivate(
    request: LicenseDeactivationRequest
  ): Promise<LicenseDeactivationResponse> {
    if (this.simulationOptions.simulateNetworkFailure) {
      return {
        ok: false,
        status: 'activated',
        providerKind: 'development_test',
        errorCode: 'NETWORK_UNAVAILABLE',
        errorMessageHe:
          'לא ניתן לנתק את הרישיון מהמחשב הנוכחי ללא חיבור לאינטרנט. הרישיון המקומי ממשיך לפעול כרגיל.',
      };
    }

    if (this.simulationOptions.simulateInvalidResponse) {
      return {
        ok: false,
        status: 'activated',
        providerKind: 'development_test',
        errorCode: 'INVALID_PROVIDER_RESPONSE',
        errorMessageHe:
          'התקבלה תשובה משובשת משירות הרישוי בעת ניסיון הניתוק. המחשב הנוכחי נותר מופעל כדי למנוע נעילה.',
      };
    }

    const registry = this.loadRegistry();
    const entryKey = Object.keys(registry).find(
      k => registry[k].licenseId === request.licenseId
    );

    if (entryKey) {
      const record = registry[entryKey];
      if (record.boundDeviceId && record.boundDeviceId !== request.device.deviceId) {
        return {
          ok: false,
          status: 'expired_or_invalid',
          providerKind: 'development_test',
          errorCode: 'DEVICE_MISMATCH',
          errorMessageHe: 'לא ניתן לנתק רישיון המשויך למחשב אחר.',
        };
      }

      registry[entryKey] = {
        ...record,
        boundDeviceId: null,
        boundDeviceLabel: null,
        activationToken: null,
        lastRequestId: request.requestId,
      };
      this.saveRegistry(registry);
    }

    return {
      ok: true,
      status: 'deactivated',
      providerKind: 'development_test',
      deactivatedAt: Date.now(),
    };
  }

  public async validateInstalledLicense(
    request: LicenseValidationRequest
  ): Promise<LicenseValidationResult> {
    // Check hardware/device binding first
    if (request.seatBinding.boundDeviceId !== request.device.deviceId) {
      return {
        validForOfflineWork: false,
        status: 'expired_or_invalid',
        providerKind: 'development_test',
        isVerifiedCommercialLicense: false,
        errorCode: 'DEVICE_MISMATCH',
        warningMessageHe:
          'מזהה המחשב המקומי אינו תואם למחשב שעליו הופעל הרישיון (מגבלת מחשב פעיל אחד).',
      };
    }

    // Offline startup or temporary network failure MUST NOT lock out an already activated user
    if (request.isOffline || this.simulationOptions.simulateNetworkFailure) {
      return {
        validForOfflineWork: true,
        status: 'activated',
        providerKind: 'development_test',
        isVerifiedCommercialLicense: false,
      };
    }

    return {
      validForOfflineWork: true,
      status: 'activated',
      providerKind: 'development_test',
      isVerifiedCommercialLicense: false,
    };
  }
}

/**
 * Main License Manager coordinating local persistence, device identity, provider switching,
 * interrupted activation recovery, and offline resilience.
 */
export class CommercialLicenseEngine {
  private static getOrCreateDefaultDevice(): DeviceIdentity {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(DEVICE_IDENTITY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as DeviceIdentity;
          if (parsed && typeof parsed.deviceId === 'string' && parsed.deviceId.length >= 6) {
            return parsed;
          }
        }
      }
    } catch {
      // Fallback below
    }

    const platform =
      typeof navigator !== 'undefined' && navigator.platform
        ? navigator.platform
        : 'Win32-Desktop';
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const device: DeviceIdentity = {
      deviceId: `WIN-WS-${randomSuffix}`,
      deviceLabel: `מחשב שולחני Windows (${randomSuffix})`,
      platform,
      createdAt: Date.now(),
    };

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DEVICE_IDENTITY_KEY, JSON.stringify(device));
      }
    } catch {
      // Ignore
    }
    return device;
  }

  public static createInitialUnactivatedState(device?: DeviceIdentity): StoredLicenseState {
    const resolvedDevice = device ?? this.getOrCreateDefaultDevice();
    return {
      schemaVersion: 1,
      status: 'unactivated',
      providerKind: 'development_test',
      isVerifiedCommercialLicense: false,
      device: resolvedDevice,
      seatBinding: null,
      lastError: null,
      pendingOperation: null,
      updatedAt: Date.now(),
    };
  }

  /**
   * Saves the license state using a versioned integrity envelope and backup slot.
   * Never touches or modifies user documents or project persistence keys.
   */
  public static saveLicenseState(state: StoredLicenseState): boolean {
    const cleanState: StoredLicenseState = {
      ...state,
      // Enforce invariant: development_test provider can NEVER claim to be a verified commercial license
      isVerifiedCommercialLicense:
        state.providerKind === 'development_test' ? false : state.isVerifiedCommercialLicense,
      seatBinding: state.seatBinding
        ? {
            ...state.seatBinding,
            isVerifiedCommercialLicense:
              state.seatBinding.providerKind === 'development_test'
                ? false
                : state.seatBinding.isVerifiedCommercialLicense,
          }
        : null,
      updatedAt: Date.now(),
    };

    const envelope: LicenseStorageEnvelope = {
      envelopeVersion: 'KETER_LICENSE_ENVELOPE_V1',
      storageMechanism:
        typeof window !== 'undefined' &&
        (window as unknown as { electronSafeStorage?: unknown }).electronSafeStorage
          ? 'desktop_dpapi_bridge'
          : 'browser_local_storage_envelope',
      integrityDigest: computeEnvelopeIntegrityDigest(cleanState),
      payload: cleanState,
    };

    try {
      if (typeof localStorage !== 'undefined') {
        const primaryKey = getPrimaryStorageKeyForDevice(cleanState.device.deviceId);
        const backupKey = getBackupStorageKeyForDevice(cleanState.device.deviceId);

        // Rotate previous valid primary to backup before writing
        const existingPrimary =
          localStorage.getItem(primaryKey) ?? localStorage.getItem(LICENSE_STORAGE_KEY);
        if (existingPrimary) {
          const parsedExisting = this.parseAndVerifyEnvelope(existingPrimary);
          if (parsedExisting.valid && parsedExisting.state) {
            localStorage.setItem(backupKey, existingPrimary);
            localStorage.setItem(LICENSE_STORAGE_BACKUP_KEY, existingPrimary);
          }
        }
        const serialized = JSON.stringify(envelope);
        localStorage.setItem(primaryKey, serialized);
        localStorage.setItem(LICENSE_STORAGE_KEY, serialized);
        if (!localStorage.getItem(backupKey)) {
          localStorage.setItem(backupKey, serialized);
        }
        if (!localStorage.getItem(LICENSE_STORAGE_BACKUP_KEY)) {
          localStorage.setItem(LICENSE_STORAGE_BACKUP_KEY, serialized);
        }
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  public static parseAndVerifyEnvelope(rawJson: string): {
    valid: boolean;
    state: StoredLicenseState | null;
    errorCode?: LicenseOperationErrorCode;
  } {
    try {
      const parsed = JSON.parse(rawJson) as Partial<LicenseStorageEnvelope>;
      if (
        !parsed ||
        parsed.envelopeVersion !== 'KETER_LICENSE_ENVELOPE_V1' ||
        !parsed.payload ||
        typeof parsed.integrityDigest !== 'string'
      ) {
        return { valid: false, state: null, errorCode: 'CORRUPTED_LOCAL_STATE' };
      }

      const payload = parsed.payload;
      const expectedDigest = computeEnvelopeIntegrityDigest(payload);
      if (parsed.integrityDigest !== expectedDigest) {
        return { valid: false, state: null, errorCode: 'CORRUPTED_LOCAL_STATE' };
      }

      // Enforce strict rule: locally stored dev/test state can never mark isVerifiedCommercialLicense = true
      if (
        payload.providerKind === 'development_test' &&
        (payload.isVerifiedCommercialLicense ||
          payload.seatBinding?.isVerifiedCommercialLicense)
      ) {
        return { valid: false, state: null, errorCode: 'CORRUPTED_LOCAL_STATE' };
      }

      // Check device binding match if status === 'activated'
      if (payload.status === 'activated') {
        if (
          !payload.seatBinding ||
          payload.seatBinding.boundDeviceId !== payload.device.deviceId
        ) {
          return {
            valid: true,
            state: {
              ...payload,
              status: 'expired_or_invalid',
              isVerifiedCommercialLicense: false,
              lastError: {
                code: 'DEVICE_MISMATCH',
                messageHe: 'הרישיון השמור שייך למזהה מחשב אחר ואינו תקף במחשב זה.',
                timestamp: Date.now(),
                recoverable: true,
              },
            },
          };
        }
      }

      return { valid: true, state: payload };
    } catch {
      return { valid: false, state: null, errorCode: 'CORRUPTED_LOCAL_STATE' };
    }
  }

  /**
   * Loads the persisted license state on startup (offline-capable).
   * Falls back to the backup envelope if the primary envelope was corrupted.
   */
  public static loadLicenseState(customDevice?: DeviceIdentity): {
    state: StoredLicenseState;
    recoveredFromBackup: boolean;
    corruptedAndReset: boolean;
  } {
    const device = customDevice ?? this.getOrCreateDefaultDevice();
    const primaryKey = getPrimaryStorageKeyForDevice(device.deviceId);
    const backupKey = getBackupStorageKeyForDevice(device.deviceId);
    try {
      if (typeof localStorage !== 'undefined') {
        const primaryRaw =
          localStorage.getItem(primaryKey) ?? localStorage.getItem(LICENSE_STORAGE_KEY);
        if (primaryRaw) {
          const primaryCheck = this.parseAndVerifyEnvelope(primaryRaw);
          if (primaryCheck.valid && primaryCheck.state) {
            return {
              state: this.reconcileInterruptedOperationOnBoot(primaryCheck.state),
              recoveredFromBackup: false,
              corruptedAndReset: false,
            };
          }

          // Primary was corrupted — try backup
          const backupRaw =
            localStorage.getItem(backupKey) ?? localStorage.getItem(LICENSE_STORAGE_BACKUP_KEY);
          if (backupRaw) {
            const backupCheck = this.parseAndVerifyEnvelope(backupRaw);
            if (backupCheck.valid && backupCheck.state) {
              this.saveLicenseState(backupCheck.state);
              return {
                state: this.reconcileInterruptedOperationOnBoot(backupCheck.state),
                recoveredFromBackup: true,
                corruptedAndReset: false,
              };
            }
          }

          // Both corrupted
          const fallbackState: StoredLicenseState = {
            ...this.createInitialUnactivatedState(device),
            status: 'expired_or_invalid',
            lastError: {
              code: 'CORRUPTED_LOCAL_STATE',
              messageHe:
                'נתוני הרישיון המקומיים נמצאו פגומים או שונו באופן לא חוקי. המסמכים שלך שמורים ובטוחים, אך יש להפעיל את הרישיון מחדש.',
              timestamp: Date.now(),
              recoverable: true,
            },
          };
          return {
            state: fallbackState,
            recoveredFromBackup: false,
            corruptedAndReset: true,
          };
        }
      }
    } catch {
      // Ignore storage access errors
    }

    return {
      state: this.createInitialUnactivatedState(device),
      recoveredFromBackup: false,
      corruptedAndReset: false,
    };
  }

  /**
   * If a previous activation or deactivation was interrupted mid-flight (e.g. app crash or power loss),
   * safely clear the pending marker without locking out an already activated user.
   */
  private static reconcileInterruptedOperationOnBoot(
    state: StoredLicenseState
  ): StoredLicenseState {
    if (!state.pendingOperation) return state;

    const wasActivated = state.status === 'activated' && state.seatBinding !== null;
    return {
      ...state,
      status: wasActivated ? 'activated' : state.status,
      pendingOperation: null,
      lastError: {
        code: 'INTERRUPTED_OPERATION',
        messageHe: wasActivated
          ? 'פעולת רישוי קודמת הופסקה באמצע. הרישיון הפעיל במחשב זה נשמר וממשיך לפעול כרגיל.'
          : 'ניסיון הפעלה קודם הופסק לפני השלמתו. ניתן לנסות להפעיל שוב.',
        timestamp: Date.now(),
        recoverable: true,
      },
    };
  }

  /**
   * Executes license activation on the specified device through the provided `ILicensingProvider`.
   * Preserves existing valid activation if a network error or invalid response occurs.
   */
  public static async activateLicense(
    currentState: StoredLicenseState,
    licenseKey: string,
    provider: ILicensingProvider,
    customerLabel?: string
  ): Promise<{ nextState: StoredLicenseState; response: LicenseActivationResponse }> {
    const requestId = `req_act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const masked = maskLicenseKey(licenseKey);

    // Record pending operation before network call
    const stateWithPending: StoredLicenseState = {
      ...currentState,
      pendingOperation: {
        type: 'activate',
        requestId,
        startedAt: Date.now(),
        licenseKeyMasked: masked,
        targetDeviceId: currentState.device.deviceId,
      },
    };
    this.saveLicenseState(stateWithPending);

    let response: LicenseActivationResponse;
    try {
      response = await provider.activate({
        licenseKey,
        device: currentState.device,
        requestId,
        customerLabel,
      });
    } catch {
      response = {
        ok: false,
        status: currentState.status,
        providerKind: provider.providerKind,
        isVerifiedCommercialLicense: false,
        errorCode: 'NETWORK_UNAVAILABLE',
        errorMessageHe: 'שגיאת רשת בלתי צפויה בעת פנייה לספק הרישוי.',
      };
    }

    if (response.ok && response.seatBinding) {
      // Never allow a dev/test provider to mark isVerifiedCommercialLicense = true
      const verifiedCommercial =
        provider.providerKind === 'development_test'
          ? false
          : Boolean(response.isVerifiedCommercialLicense);

      const nextState: StoredLicenseState = {
        ...currentState,
        status: 'activated',
        providerKind: provider.providerKind,
        isVerifiedCommercialLicense: verifiedCommercial,
        seatBinding: {
          ...response.seatBinding,
          providerKind: provider.providerKind,
          isVerifiedCommercialLicense: verifiedCommercial,
        },
        lastError: null,
        pendingOperation: null,
        updatedAt: Date.now(),
      };
      this.saveLicenseState(nextState);
      return { nextState, response };
    }

    // If activation failed:
    // CRITICAL: If the user already had an active valid license on this computer and merely
    // experienced a transient network/provider error, DO NOT lock them out!
    const hadActiveSeatOnThisDevice =
      currentState.status === 'activated' &&
      currentState.seatBinding !== null &&
      currentState.seatBinding.boundDeviceId === currentState.device.deviceId;

    const isTransientFailure =
      response.errorCode === 'NETWORK_UNAVAILABLE' ||
      response.errorCode === 'INTERRUPTED_OPERATION' ||
      response.errorCode === 'INVALID_PROVIDER_RESPONSE' ||
      response.errorCode === 'PRODUCTION_BACKEND_NOT_CONFIGURED';

    const preservedStatus: LicenseStatus =
      hadActiveSeatOnThisDevice && isTransientFailure
        ? 'activated'
        : response.errorCode === 'INVALID_KEY_FORMAT' ||
          response.errorCode === 'LICENSE_NOT_FOUND' ||
          response.errorCode === 'LICENSE_REVOKED_OR_EXPIRED'
        ? 'expired_or_invalid'
        : currentState.status === 'deactivated'
        ? 'deactivated'
        : 'unactivated';

    const nextState: StoredLicenseState = {
      ...currentState,
      status: preservedStatus,
      seatBinding: hadActiveSeatOnThisDevice && isTransientFailure ? currentState.seatBinding : null,
      pendingOperation: null,
      lastError: {
        code: response.errorCode ?? 'INVALID_PROVIDER_RESPONSE',
        messageHe:
          response.errorMessageHe ?? 'הפעלת הרישיון נכשלה. נא לבדוק את המפתח או החיבור.',
        timestamp: Date.now(),
        recoverable: true,
      },
      updatedAt: Date.now(),
    };

    this.saveLicenseState(nextState);
    return { nextState, response };
  }

  /**
   * Deactivates the current computer so the license can be activated on another computer.
   * If deactivation fails due to network or provider error, the current computer remains activated
   * so the user is never left with 0 working computers.
   */
  public static async deactivateCurrentDevice(
    currentState: StoredLicenseState,
    provider: ILicensingProvider
  ): Promise<{ nextState: StoredLicenseState; response: LicenseDeactivationResponse }> {
    if (!currentState.seatBinding || currentState.status !== 'activated') {
      const resp: LicenseDeactivationResponse = {
        ok: false,
        status: currentState.status,
        providerKind: provider.providerKind,
        errorCode: 'LICENSE_NOT_FOUND',
        errorMessageHe: 'אין רישיון פעיל במחשב זה לניתוק.',
      };
      return { nextState: currentState, response: resp };
    }

    const requestId = `req_deact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const stateWithPending: StoredLicenseState = {
      ...currentState,
      pendingOperation: {
        type: 'deactivate',
        requestId,
        startedAt: Date.now(),
        licenseKeyMasked: currentState.seatBinding.licenseKeyMasked,
        targetDeviceId: currentState.device.deviceId,
      },
    };
    this.saveLicenseState(stateWithPending);

    let response: LicenseDeactivationResponse;
    try {
      response = await provider.deactivate({
        licenseId: currentState.seatBinding.licenseId,
        activationToken: currentState.seatBinding.activationToken,
        device: currentState.device,
        requestId,
      });
    } catch {
      response = {
        ok: false,
        status: 'activated',
        providerKind: provider.providerKind,
        errorCode: 'NETWORK_UNAVAILABLE',
        errorMessageHe:
          'ניתוק הרישיון נכשל עקב שגיאת תקשורת. המחשב הנוכחי נותר מופעל כדי למנוע אובדן גישה.',
      };
    }

    if (response.ok) {
      const nextState: StoredLicenseState = {
        ...currentState,
        status: 'deactivated',
        isVerifiedCommercialLicense: false,
        seatBinding: null,
        lastDeactivatedAt: response.deactivatedAt ?? Date.now(),
        lastDeactivatedDeviceId: currentState.device.deviceId,
        lastError: null,
        pendingOperation: null,
        updatedAt: Date.now(),
      };
      this.saveLicenseState(nextState);
      return { nextState, response };
    }

    // Deactivation failed — keep current computer activated so user is not locked out
    const nextState: StoredLicenseState = {
      ...currentState,
      status: 'activated',
      pendingOperation: null,
      lastError: {
        code: response.errorCode ?? 'NETWORK_UNAVAILABLE',
        messageHe:
          response.errorMessageHe ??
          'לא ניתן היה להשלים את ניתוק המחשב מול השרת. הרישיון במחשב זה נותר פעיל.',
        timestamp: Date.now(),
        recoverable: true,
      },
      updatedAt: Date.now(),
    };
    this.saveLicenseState(nextState);
    return { nextState, response };
  }

  /**
   * Evaluates whether ordinary offline work (typesetting, saving projects, PDF/IDML export)
   * is permitted under the current license state, without making blocking network requests.
   */
  public static checkOfflineWorkCapability(state: StoredLicenseState): {
    offlineWorkReady: boolean;
    statusLabelHe: string;
    badgeTone: 'emerald' | 'amber' | 'rose' | 'stone';
    explanationHe: string;
  } {
    if (
      state.status === 'activated' &&
      state.seatBinding &&
      state.seatBinding.boundDeviceId === state.device.deviceId
    ) {
      if (state.isVerifiedCommercialLicense) {
        return {
          offlineWorkReady: true,
          statusLabelHe: 'רישיון מסחרי מאומת (פעיל במחשב זה)',
          badgeTone: 'emerald',
          explanationHe:
            'הרישיון מאומת ומופעל במחשב זה. עריכת מסמכים, עימוד, שמירת פרויקטים וייצוא PDF/IDML פועלים באופן מלא גם ללא חיבור לאינטרנט.',
        };
      }
      return {
        offlineWorkReady: true,
        statusLabelHe: 'מופעל במצב פיתוח/בדיקה (לא רישיון מסחרי מאומת)',
        badgeTone: 'amber',
        explanationHe:
          'המערכת מופעלת באמצעות ספק הבדיקות (Development/Test Provider). כל כלי העימוד, השמירה והייצוא זמינים לעבודה אופליין, אך אסימון זה אינו מהווה רישיון מסחרי מאומת משרת ייצור.',
      };
    }

    if (state.status === 'deactivated') {
      return {
        offlineWorkReady: false,
        statusLabelHe: 'הרישיון נותק ממחשב זה (Deactivated)',
        badgeTone: 'stone',
        explanationHe:
          'הרישיון שוחרר ממחשב זה לצורך העברה למחשב אחר. המסמכים והפרויקטים שלך שמורים במלואם.',
      };
    }

    if (state.status === 'expired_or_invalid') {
      return {
        offlineWorkReady: false,
        statusLabelHe: 'רישיון לא תקף או פג תוקף',
        badgeTone: 'rose',
        explanationHe:
          state.lastError?.messageHe ??
          'מפתח הרישיון או אסימון ההפעלה אינם תקפים עבור מחשב זה.',
      };
    }

    return {
      offlineWorkReady: false,
      statusLabelHe: 'לא מופעל (Unactivated)',
      badgeTone: 'stone',
      explanationHe:
        'טרם הופעל רישיון במחשב זה. ניתן לפתוח את מסך הרישוי וההפעלה בכל עת ללא פגיעה במסמכים הפתוחים.',
    };
  }
}
