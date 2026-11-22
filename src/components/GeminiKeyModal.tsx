import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useEscapeToClose } from './useDialogEscape';
import {
  clearGeminiKey,
  describeGeminiError,
  GEMINI_ERROR_HEBREW,
  getGeminiKey,
  hasGeminiKey,
  looksLikeGoogleApiKey,
  saveGeminiKey,
  testGeminiKey,
} from '../engine/gemini-service';

interface GeminiKeyModalProps {
  onClose: () => void;
  onNotify: (message: string, type: 'success' | 'error') => void;
  onKeyChanged: () => void;
}

export const GeminiKeyModal: React.FC<GeminiKeyModalProps> = ({
  onClose,
  onNotify,
  onKeyChanged,
}) => {
  const { t, dir } = useLanguage();
  useEscapeToClose(onClose);
  const [keyInput, setKeyInput] = useState<string>('');
  const [keyPresent, setKeyPresent] = useState<boolean>(() => hasGeminiKey());
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);
  // The saved key may itself be malformed (e.g. a wrong key saved before
  // v0.3.2) — flag it even though the key itself is never displayed.
  const [savedKeyBadFormat, setSavedKeyBadFormat] = useState<boolean>(() => {
    const saved = getGeminiKey();
    return saved !== null && !looksLikeGoogleApiKey(saved);
  });
  const inputLooksWrong = keyInput.trim() !== '' && !looksLikeGoogleApiKey(keyInput);

  const handleSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!keyInput.trim()) {
      onNotify(t('הזן מפתח לפני השמירה'), 'error');
      return;
    }
    saveGeminiKey(keyInput.trim());
    setSavedKeyBadFormat(!looksLikeGoogleApiKey(keyInput.trim()));
    setTestState('idle');
    setTestMessage(null);
    setKeyInput('');
    setKeyPresent(true);
    onKeyChanged();
    onNotify(t('מפתח Gemini נשמר — הצעות AI מופעלות'), 'success');
  };

  const handleClear = () => {
    clearGeminiKey();
    setKeyPresent(false);
    setSavedKeyBadFormat(false);
    setTestState('idle');
    setTestMessage(null);
    onKeyChanged();
    onNotify(t('מפתח Gemini נמחק — העוזר חוזר לכללים מקומיים'), 'success');
  };

  /**
   * v0.3.2 — test the key against Gemini itself. Saves whatever was typed
   * first (so the tested key is the saved key), then sends one tiny
   * request and reports success or the specific failure reason. The key
   * is only ever sent to Google's Gemini API.
   */
  const handleTest = async () => {
    if (testState === 'testing') return;
    const candidate = keyInput.trim();
    if (candidate) {
      saveGeminiKey(candidate);
      setSavedKeyBadFormat(!looksLikeGoogleApiKey(candidate));
      setKeyInput('');
      setKeyPresent(true);
      onKeyChanged();
    } else if (!hasGeminiKey()) {
      onNotify(t('הזן מפתח לפני הבדיקה'), 'error');
      return;
    }
    setTestState('testing');
    setTestMessage(null);
    try {
      await testGeminiKey();
      setTestState('ok');
      setTestMessage(t('המפתח תקין — Gemini עונה'));
    } catch (err) {
      const info = describeGeminiError(err);
      const reason = t(GEMINI_ERROR_HEBREW[info.kind]);
      setTestState('error');
      setTestMessage(info.detail ? `${reason} — ${info.detail}` : reason);
    }
  };

  return (
    <div
      dir={dir}
      className="keter-dialog-backdrop" onClick={onClose}
    >
      <div className="keter-dialog-surface rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden text-[var(--ui-text-primary)]" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="px-5 py-4 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#D4AF6A]/15 border border-[#D4AF6A]/40 flex items-center justify-center text-[#E6C786]">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">{t('מפתח Gemini AI')}</h2>
              <p className="text-[11px] text-[var(--ui-text-secondary)]">
                {t('הצעות AI חכמות מבוססות Gemini')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--ui-surface-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
            title={t('סגור')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* AI on/off status */}
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
              keyPresent
                ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-200'
                : 'bg-[var(--ui-surface-subtle)]/80 border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
            }`}
          >
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-[#E6C786]" />
            <div className="space-y-1">
              <div className="font-bold">
                {keyPresent ? t('מפתח ה־AI מופעל') : t('מפתח ה־AI לא הוגדר')}
              </div>
              <p className="leading-relaxed text-[var(--ui-text-secondary)]">
                {t(
                  'כאשר מפתח מוגדר, עוזר העימוד שולח את הבקשה שלך ל־Gemini ומציע שינויים לאישורך. בלי מפתח, העוזר ממשיך לעבוד עם כללים מקומיים בלבד.'
                )}
              </p>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-[11px] text-[var(--ui-text-secondary)] mb-1">
                {t('מפתח API של Gemini')}
              </label>
              <input
                type="password"
                dir="ltr"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                placeholder={t('הדבק כאן את המפתח מ־Google AI Studio')}
                autoComplete="off"
                className="w-full px-3 py-2 rounded-lg bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] text-[var(--ui-text-primary)] font-mono text-xs focus:outline-none focus:border-[#D4AF6A]"
              />
              {/* v0.3.3 — both current (AQ.) and legacy (AIza) key formats work */}
              <p className="text-[11px] text-[var(--ui-text-muted)] leading-relaxed mt-1">
                {t(
                  'מפתחות חדשים מ־Google AI Studio מתחילים ב־AQ. ומפתחות ישנים ב־AIza — שני הסוגים עובדים.'
                )}
              </p>
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[#E6C786] hover:text-[#F0D49A] flex items-center gap-1 font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{t('קבלת מפתח ב־Google AI Studio')}</span>
              </a>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testState === 'testing'}
                  className="px-3.5 py-2 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-primary)] font-bold text-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {testState === 'testing' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>{testState === 'testing' ? t('בודק מפתח…') : t('בדוק מפתח')}</span>
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-gradient-to-b from-[#D4AF6A] to-[#B89047] hover:from-[#DFBE7D] hover:to-[#C59D52] text-[#0B0F17] font-bold text-xs transition-all flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{t('שמור מפתח')}</span>
                </button>
              </div>
            </div>
          </form>

          {/* v0.3.3 — key format warnings: current keys start with AQ., legacy with AIza; anything else is flagged */}
          {inputLooksWrong && (
            <div className="p-3 rounded-xl bg-amber-950/50 border border-amber-700/60 flex items-start gap-2 text-amber-200 leading-relaxed">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <p>
                {t(
                  'המפתח לא נראה כמו מפתח API — מפתחות חדשים מ־Google AI Studio מתחילים ב־AQ. וישנים ב־AIza. בדוק שהעתקת את המפתח הנכון.'
                )}
              </p>
            </div>
          )}
          {savedKeyBadFormat && !keyInput.trim() && (
            <div className="p-3 rounded-xl bg-amber-950/50 border border-amber-700/60 flex items-start gap-2 text-amber-200 leading-relaxed">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <p>
                {t(
                  'המפתח השמור לא נראה כמו מפתח API — מפתחות חדשים מ־Google AI Studio מתחילים ב־AQ. וישנים ב־AIza. מחק אותו והדבק מפתח חדש מ־Google AI Studio.'
                )}
              </p>
            </div>
          )}

          {/* v0.3.2 — test result */}
          {testState !== 'idle' && testMessage && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2 leading-relaxed ${
                testState === 'ok'
                  ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-200'
                  : testState === 'testing'
                    ? 'bg-[var(--ui-surface-subtle)]/80 border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                    : 'bg-rose-950/50 border-rose-700/60 text-rose-200'
              }`}
            >
              {testState === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              ) : testState === 'testing' ? (
                <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin text-[var(--ui-text-secondary)]" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              )}
              <p>{testMessage}</p>
            </div>
          )}

          {keyPresent && (
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-700/60 text-rose-200 font-medium flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('מחק מפתח שמור')}</span>
            </button>
          )}

          {/* Plain-text storage caveat */}
          <div className="p-3 rounded-xl bg-[var(--ui-surface-subtle)]/80 border border-[var(--ui-border)] flex items-start gap-2 text-[var(--ui-text-secondary)] leading-relaxed">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <p>
              {t(
                'המפתח נשמר במחשב זה בלבד (אחסון מקומי, ללא הצפנה). כל מי שיש לו גישה למחשב יכול לקרוא אותו — השתמש במפתח שאפשר לבטל או להחליף.'
              )}
            </p>
          </div>

          {keyPresent && getGeminiKey() && (
            <p className="text-[11px] text-[var(--ui-text-muted)]">
              {t('מפתח שמור כעת במחשב זה. המפתח עצמו אינו מוצג כאן.')}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-[var(--ui-surface-subtle)] border-t border-[var(--ui-border)] flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-primary)] text-xs font-medium transition-colors"
          >
            {t('סגור')}
          </button>
        </div>
      </div>
    </div>
  );
};
