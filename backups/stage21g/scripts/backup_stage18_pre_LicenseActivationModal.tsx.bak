import React, { useState } from 'react';
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Laptop,
  Wifi,
  WifiOff,
  RefreshCw,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  X,
  Lock,
  Server,
  FileCode2,
  ArrowRightLeft,
} from 'lucide-react';
import {
  CommercialLicenseEngine,
  DeviceIdentity,
  DevelopmentTestLicensingProvider,
  ILicensingProvider,
  LicenseProviderKind,
  PRODUCTION_BACKEND_CONTRACT_SPEC,
  StoredLicenseState,
  UnconfiguredProductionLicensingProvider,
} from '../engine/license-engine';

interface LicenseActivationModalProps {
  licenseState: StoredLicenseState;
  onUpdateLicenseState: (nextState: StoredLicenseState) => void;
  devProvider: DevelopmentTestLicensingProvider;
  prodProvider: UnconfiguredProductionLicensingProvider;
  onClose: () => void;
  onNotify: (message: string, type: 'success' | 'error') => void;
}

export const LicenseActivationModal: React.FC<LicenseActivationModalProps> = ({
  licenseState,
  onUpdateLicenseState,
  devProvider,
  prodProvider,
  onClose,
  onNotify,
}) => {
  const [selectedProviderKind, setSelectedProviderKind] = useState<LicenseProviderKind>(
    licenseState.providerKind
  );
  const [licenseKeyInput, setLicenseKeyInput] = useState<string>(
    'KETER-5786-VILN-SHAS-0001'
  );
  const [customerLabelInput, setCustomerLabelInput] = useState<string>(
    licenseState.seatBinding?.customerLabel ?? 'מכון הוצאה לאור — עמדת עימוד ראשית'
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'activation' | 'transfer' | 'contract'>(
    'activation'
  );

  // Simulation controls for testing network failures, interrupted activations, and second computer transfer
  const [simulateNetworkOffline, setSimulateNetworkOffline] = useState<boolean>(
    Boolean(devProvider.getSimulationOptions().simulateNetworkFailure)
  );
  const [simulateInterrupted, setSimulateInterrupted] = useState<boolean>(
    Boolean(devProvider.getSimulationOptions().simulateInterruptedActivation)
  );

  const activeProvider: ILicensingProvider =
    selectedProviderKind === 'production_unconfigured' ? prodProvider : devProvider;

  const offlineCapability = CommercialLicenseEngine.checkOfflineWorkCapability(licenseState);

  const handleToggleNetworkSimulation = (nextOffline: boolean) => {
    setSimulateNetworkOffline(nextOffline);
    devProvider.setSimulationOptions({
      ...devProvider.getSimulationOptions(),
      simulateNetworkFailure: nextOffline,
    });
  };

  const handleToggleInterruptSimulation = (nextInterrupt: boolean) => {
    setSimulateInterrupted(nextInterrupt);
    devProvider.setSimulationOptions({
      ...devProvider.getSimulationOptions(),
      simulateInterruptedActivation: nextInterrupt,
    });
  };

  const handleActivate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    try {
      const { nextState, response } = await CommercialLicenseEngine.activateLicense(
        licenseState,
        licenseKeyInput,
        activeProvider,
        customerLabelInput
      );
      onUpdateLicenseState(nextState);
      if (response.ok) {
        onNotify(
          'הרישיון הופעל בהצלחה במחשב זה (ספק בדיקות ופיתוח — לא רישיון מסחרי מאומת).',
          'success'
        );
      } else {
        onNotify(response.errorMessageHe ?? 'הפעלת הרישיון נכשלה.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivateCurrentComputer = async () => {
    setIsSubmitting(true);
    try {
      const { nextState, response } = await CommercialLicenseEngine.deactivateCurrentDevice(
        licenseState,
        activeProvider
      );
      onUpdateLicenseState(nextState);
      if (response.ok) {
        onNotify(
          'הרישיון נותק ממחשב זה בהצלחה. כעת ניתן להפעיל את המפתח במחשב אחר.',
          'success'
        );
      } else {
        onNotify(
          response.errorMessageHe ?? 'ניתוק המחשב נכשל. הרישיון המקומי נותר פעיל.',
          'error'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSwitchSimulatedDevice = (targetSlot: 'A' | 'B') => {
    const nextDevice: DeviceIdentity =
      targetSlot === 'A'
        ? {
            deviceId: 'WIN-WORKSTATION-A100',
            deviceLabel: 'מחשב עימוד ראשי — עמדה A (Windows 11 Pro)',
            platform: 'Win32',
            createdAt: licenseState.device.createdAt,
          }
        : {
            deviceId: 'WIN-LAPTOP-B200',
            deviceLabel: 'מחשב נייד עורך — עמדה B (Windows 11)',
            platform: 'Win32',
            createdAt: Date.now(),
          };

    // Evaluate how the switched machine sees the state
    const isBoundToTarget =
      licenseState.seatBinding &&
      licenseState.seatBinding.boundDeviceId === nextDevice.deviceId;

    const updatedState: StoredLicenseState = {
      ...licenseState,
      device: nextDevice,
      status: isBoundToTarget
        ? 'activated'
        : licenseState.status === 'deactivated'
        ? 'deactivated'
        : 'unactivated',
      seatBinding: isBoundToTarget ? licenseState.seatBinding : null,
      lastError: null,
      updatedAt: Date.now(),
    };
    CommercialLicenseEngine.saveLicenseState(updatedState);
    onUpdateLicenseState(updatedState);
    onNotify(`הוחלף מזהה מחשב פעיל ל: ${nextDevice.deviceLabel}`, 'success');
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 bg-[#0B0F17]/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-[#0F1623] border border-[#1E293B] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden text-slate-200">
        {/* Modal Header */}
        <div className="px-5 py-4 bg-[#0B0F17] border-b border-[#1E293B] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#D4AF6A]/15 border border-[#D4AF6A]/40 flex items-center justify-center text-[#E6C786]">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                רישוי מסחרי והפעלת מערכת — כתר (Keter Typesetter)
              </h2>
              <p className="text-[11px] text-slate-400">
                רישיון רכישה חד-פעמית (One-Time Purchase) · מחשב פעיל אחד בכל עת · עבודה מלאה אופליין לאחר הפעלה
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#192338] text-slate-400 hover:text-slate-100 transition-colors"
            title="סגור חלון רישוי"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top Status Banner */}
        <div className="px-5 py-3 bg-[#131B2B] border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <span
              className={`px-2.5 py-1 rounded-md text-xs font-bold border flex items-center gap-1.5 ${
                licenseState.status === 'activated' && licenseState.isVerifiedCommercialLicense
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                  : licenseState.status === 'activated'
                  ? 'bg-[#D4AF6A]/15 text-[#E6C786] border-[#D4AF6A]/40'
                  : licenseState.status === 'expired_or_invalid'
                  ? 'bg-rose-950/80 text-rose-300 border-rose-600/50'
                  : 'bg-[#0B0F17] text-slate-300 border-[#1E293B]'
              }`}
            >
              {licenseState.status === 'activated' ? (
                <ShieldCheck className="w-3.5 h-3.5" />
              ) : licenseState.status === 'expired_or_invalid' ? (
                <ShieldAlert className="w-3.5 h-3.5" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
              <span>
                {licenseState.status === 'activated'
                  ? licenseState.isVerifiedCommercialLicense
                    ? 'מופעל — רישיון מסחרי מאומת'
                    : 'מופעל (ספק פיתוח/בדיקה — לא רישיון מסחרי מאומת)'
                  : licenseState.status === 'deactivated'
                  ? 'מנותק ממחשב זה (Deactivated)'
                  : licenseState.status === 'expired_or_invalid'
                  ? 'לא תקף / פג תוקף (Invalid / Expired)'
                  : 'לא מופעל (Unactivated)'}
              </span>
            </span>

            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <Laptop className="w-3.5 h-3.5 text-slate-500" />
              <span>מחשב נוכחי:</span>
              <strong className="font-mono text-slate-200" dir="ltr">
                {licenseState.device.deviceId}
              </strong>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            {offlineCapability.offlineWorkReady ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>מוכן לעבודה אופליין (עימוד, שמירה וייצוא PDF/IDML)</span>
              </span>
            ) : (
              <span className="text-slate-400 flex items-center gap-1">
                <Wifi className="w-3.5 h-3.5 text-[#D4AF6A]" />
                <span>נדרש חיבור לאינטרנט להפעלה ראשונית</span>
              </span>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-2 bg-[#0B0F17] border-b border-[#1E293B] flex items-center gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('activation')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'activation'
                ? 'border-[#D4AF6A] text-[#E6C786]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>הפעלה ומצב רישיון</span>
          </button>

          <button
            onClick={() => setActiveTab('transfer')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'transfer'
                ? 'border-[#D4AF6A] text-[#E6C786]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>מחשב פעיל אחד והדמיית העברה / תקלות רשת</span>
          </button>

          <button
            onClick={() => setActiveTab('contract')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'contract'
                ? 'border-[#D4AF6A] text-[#E6C786]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>מפרט שרת ייצור ואבטחה (Production Contract)</span>
          </button>
        </div>

        {/* Main Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* Error / Recovery Alert if present */}
          {licenseState.lastError && (
            <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-700/60 text-rose-200 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-rose-100">
                    שגיאת פעולת רישוי ({licenseState.lastError.code})
                  </div>
                  <p className="text-rose-200/90 leading-relaxed">
                    {licenseState.lastError.messageHe}
                  </p>
                  <p className="text-[11px] text-emerald-300/90">
                    המסמכים, העימוד וקובצי הפרויקט שלך (.keter.json) שמורים במלואם ולא נפגעו.
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleActivate()}
                disabled={isSubmitting}
                className="px-2.5 py-1 rounded-lg bg-rose-800/70 hover:bg-rose-700 text-rose-100 text-[11px] font-medium shrink-0 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${isSubmitting ? 'animate-spin' : ''}`} />
                <span>נסה שנית</span>
              </button>
            </div>
          )}

          {activeTab === 'activation' && (
            <div className="space-y-4">
              {/* Provider Selector */}
              <div className="p-4 rounded-xl bg-[#131B2B]/80 border border-[#1E293B] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-[#D4AF6A]" />
                    <span>ספק אימות רישוי (Licensing Provider Architecture)</span>
                  </span>
                  <span className="text-[11px] text-slate-400">
                    הפרדה מוחלטת בין ספק בדיקות לרישוי ייצור מסחרי
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedProviderKind('development_test')}
                    className={`p-3 rounded-xl border text-right transition-all ${
                      selectedProviderKind === 'development_test'
                        ? 'bg-[#D4AF6A]/12 border-[#D4AF6A]/50 text-slate-100'
                        : 'bg-[#0B0F17]/70 border-[#1E293B] text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-[#E6C786] flex items-center justify-between">
                      <span>ספק פיתוח ובדיקות (Development / Test Provider)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#D4AF6A]/20 text-[#E6C786]">
                        לא מסחרי
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      מדמה מחזור חיים מלא (הפעלה, נעילת מחשב יחיד, ניתוק והעברה למחשב שני, ועבודה אופליין). אינו מייצג רישיון מסחרי מאומת.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedProviderKind('production_unconfigured')}
                    className={`p-3 rounded-xl border text-right transition-all ${
                      selectedProviderKind === 'production_unconfigured'
                        ? 'bg-sky-950/30 border-sky-500/60 text-slate-100'
                        : 'bg-[#0B0F17]/70 border-[#1E293B] text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-sky-300 flex items-center justify-between">
                      <span>שרת רישוי מסחרי (Production Provider)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#131B2B] text-slate-300">
                        טרם חובר שרת
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      ממשק ייצור נקי ללא כתובת שרת בדויה או מפתח חתימה פנימי. מחזיר הודעה מפורשת ששרת הייצור טרם חובר.
                    </p>
                  </button>
                </div>
              </div>

              {/* Active Seat Details or Activation Form */}
              {licenseState.status === 'activated' && licenseState.seatBinding ? (
                <div className="p-4 rounded-xl bg-[#131B2B]/80 border border-[#1E293B] space-y-3">
                  <div className="flex items-center justify-between border-b border-[#1E293B] pb-2.5">
                    <div>
                      <h3 className="font-bold text-slate-100 text-sm">
                        פרטי רישיון פעיל במחשב זה
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        {licenseState.isVerifiedCommercialLicense
                          ? 'מאומת בחתימת שרת רישוי מסחרי'
                          : 'מופעל תחת ספק הפיתוח והבדיקות (Development/Test Provider — אינו רישיון מסחרי מאומת)'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeactivateCurrentComputer}
                      disabled={isSubmitting}
                      className="px-3 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-700/60 text-rose-200 font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>נתק מחשב זה (Deactivate להעברה למחשב אחר)</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-[#0B0F17] border border-[#1E293B]">
                      <div className="text-[10px] text-slate-500">מפתח רישיון</div>
                      <div className="font-mono font-bold text-slate-200 mt-0.5" dir="ltr">
                        {licenseState.seatBinding.licenseKeyMasked}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0B0F17] border border-[#1E293B]">
                      <div className="text-[10px] text-slate-500">מזהה מחשב משויך (1 Seat)</div>
                      <div className="font-mono font-bold text-[#E6C786] mt-0.5" dir="ltr">
                        {licenseState.seatBinding.boundDeviceId}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0B0F17] border border-[#1E293B]">
                      <div className="text-[10px] text-slate-500">סטטוס אימות מסחרי</div>
                      <div className="font-bold text-[#D4AF6A] mt-0.5">
                        {licenseState.isVerifiedCommercialLicense
                          ? 'מאומת מסחרית (Production)'
                          : 'אסימון בדיקה (Test Provider)'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handleActivate}
                  className="p-4 rounded-xl bg-[#131B2B]/80 border border-[#1E293B] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-100 text-sm">
                      הפעלת רישיון במחשב זה (Activate This Computer)
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setLicenseKeyInput('KETER-5786-VILN-SHAS-0001')}
                        className="px-2 py-0.5 rounded bg-[#0B0F17] hover:bg-[#192338] border border-[#1E293B] text-[10px] text-[#E6C786]"
                      >
                        מפתח בדיקה תקין
                      </button>
                      <button
                        type="button"
                        onClick={() => setLicenseKeyInput('KETER-EXPD-0000-REVK-9999')}
                        className="px-2 py-0.5 rounded bg-[#0B0F17] hover:bg-[#192338] border border-[#1E293B] text-[10px] text-rose-300"
                      >
                        מפתח פג תוקף לבדיקה
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        מפתח רישיון (KETER-XXXX-XXXX-XXXX-XXXX)
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={licenseKeyInput}
                        onChange={e => setLicenseKeyInput(e.target.value)}
                        placeholder="KETER-XXXX-XXXX-XXXX-XXXX"
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-[#1E293B] text-slate-100 font-mono text-xs focus:outline-none focus:border-[#D4AF6A]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        תיאור עמדה / בעל הרישיון
                      </label>
                      <input
                        type="text"
                        value={customerLabelInput}
                        onChange={e => setCustomerLabelInput(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-[#0B0F17] border border-[#1E293B] text-slate-100 text-xs focus:outline-none focus:border-[#D4AF6A]"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[11px] text-slate-400">
                      הפעלה משייכת את הרישיון למחשב <strong dir="ltr">{licenseState.device.deviceId}</strong>.
                    </span>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-4 py-2 rounded-lg bg-gradient-to-b from-[#D4AF6A] to-[#B89047] hover:from-[#DFBE7D] hover:to-[#C59D52] text-[#0B0F17] font-bold text-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>
                        {isSubmitting ? 'מאמת מול ספק הרישוי...' : 'הפעל רישיון במחשב זה'}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {activeTab === 'transfer' && (
            <div className="space-y-4">
              {/* Single Active Computer Seat Transfer Simulator */}
              <div className="p-4 rounded-xl bg-[#131B2B]/80 border border-[#1E293B] space-y-3">
                <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-[#D4AF6A]" />
                  <span>אכיפת מחשב פעיל אחד (One Active Computer) והעברה בין מחשבים</span>
                </h3>
                <p className="text-slate-400 leading-relaxed">
                  רישיון כתר מתיר מחשב פעיל אחד בכל עת. כדי להעביר את הרישיון למחשב שני, יש לנתק (Deactivate) את המחשב הראשון ולאחר מכן להפעיל במחשב השני. ניתן לבדוק זאת כאן בזמן אמת:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSwitchSimulatedDevice('A')}
                    className={`p-3 rounded-xl border text-right transition-all ${
                      licenseState.device.deviceId === 'WIN-WORKSTATION-A100'
                        ? 'bg-[#D4AF6A]/12 border-[#D4AF6A]/50 text-slate-100'
                        : 'bg-[#0B0F17]/70 border-[#1E293B] text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-slate-200">עמדה A: WIN-WORKSTATION-A100</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      מחשב עימוד ראשי — לחץ למעבר לעמדה זו
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSwitchSimulatedDevice('B')}
                    className={`p-3 rounded-xl border text-right transition-all ${
                      licenseState.device.deviceId === 'WIN-LAPTOP-B200'
                        ? 'bg-[#D4AF6A]/12 border-[#D4AF6A]/50 text-slate-100'
                        : 'bg-[#0B0F17]/70 border-[#1E293B] text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-slate-200">עמדה B: WIN-LAPTOP-B200</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      מחשב נייד שני — יידחה אם עמדה A עדיין מופעלת
                    </div>
                  </button>
                </div>
              </div>

              {/* Network Failure & Interrupted Activation Fault Injection */}
              <div className="p-4 rounded-xl bg-[#131B2B]/80 border border-[#1E293B] space-y-3">
                <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <WifiOff className="w-4 h-4 text-sky-400" />
                  <span>בדיקת עמידות: ניתוק אינטרנט והפסקת הפעלה באמצע</span>
                </h3>
                <p className="text-slate-400 leading-relaxed">
                  כשל רשת זמני לעולם אינו נועל משתמש שכבר הפעיל את הרישיון במחשב שלו, ואינו פוגע במסמכים הפתוחים.
                </p>

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={simulateNetworkOffline}
                      onChange={e => handleToggleNetworkSimulation(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0B0F17] text-[#D4AF6A]"
                    />
                    <span>הדמיית ניתוק אינטרנט (Offline / Network Failure)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={simulateInterrupted}
                      onChange={e => handleToggleInterruptSimulation(e.target.checked)}
                      className="rounded border-[#1E293B] bg-[#0B0F17] text-[#D4AF6A]"
                    />
                    <span>הדמיית הפסקת הפעלה באמצע (Interrupted Activation)</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'contract' && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-[#131B2B]/80 border border-[#1E293B] space-y-2">
                <h3 className="font-bold text-slate-100 text-sm">
                  מפרט שרת רישוי מינימלי לייצור (Minimal Production Backend Contract)
                </h3>
                <p className="text-slate-400 leading-relaxed">
                  בהתאם לדרישות האבטחה של שלב 16, גרסת הלקוח אינה מכילה מפתחות חתימה פרטיים (Signing Secrets) ואינה מדמה שרת ייצור בדוי. להלן חוזה ה-API המדויק שנדרש לחבר לפני הפצה מסחרית:
                </p>
                <pre
                  dir="ltr"
                  className="p-3 rounded-lg bg-[#0B0F17] border border-[#1E293B] text-[11px] font-mono text-[#E6C786]/90 overflow-x-auto"
                >
                  {JSON.stringify(PRODUCTION_BACKEND_CONTRACT_SPEC, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-[#0B0F17] border-t border-[#1E293B] flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span>
            אחסון מקומי: מעטפת שלמות חתומה + גיבוי אוטומטי (בסביבת Windows עוטפת: הצפנת DPAPI / safeStorage)
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#131B2B] hover:bg-[#192338] border border-[#1E293B] text-slate-200 font-medium transition-colors"
          >
            סגור והמשך בעבודה
          </button>
        </div>
      </div>
    </div>
  );
};
