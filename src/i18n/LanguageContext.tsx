import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { EN_STRINGS, EN_STRING_TEMPLATES } from './strings';

export type UiLanguage = 'he' | 'en';

export const LANGUAGE_STORAGE_KEY = 'keter-ui-lang';

function readStoredLanguage(): UiLanguage {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'he';
  } catch {
    return 'he';
  }
}

/**
 * Non-hook translation for engine (non-React) code: reads the stored language
 * directly instead of React context. UI components should use `useLanguage().t`
 * so they re-render when the language toggles; engine code produces a fresh
 * string on each call, so reading localStorage at production time is correct.
 */
export function translateUiString(he: string): string {
  try {
    if (localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en') {
      return EN_STRINGS[he] ?? he;
    }
  } catch {
    // ignore storage errors — fall through to Hebrew
  }
  return he;
}

interface LanguageContextValue {
  lang: UiLanguage;
  dir: 'rtl' | 'ltr';
  t: (he: string) => string;
  /**
   * v0.9.8 Bilingual Audit — parameterized translation.
   * `t()` can only look up an exact literal, so a template literal with
   * ${...} interpolation NEVER translates (it silently falls back to
   * Hebrew in English mode). `tf()` looks the whole template up in
   * EN_STRING_TEMPLATES (placeholders are {name}) and substitutes the
   * values verbatim. Values must already be language-neutral (numbers,
   * ids, file names) or localized by the caller (e.g. recipe nameEn).
   */
  tf: (heTemplate: string, params: Record<string, string | number>) => string;
  toggleLanguage: () => void;
  setLanguage: (lang: UiLanguage) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<UiLanguage>(() => readStoredLanguage());

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // ignore storage errors
    }
  }, [lang]);

  const setLanguage = useCallback((next: UiLanguage) => {
    setLangState(next);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLangState(prev => (prev === 'he' ? 'en' : 'he'));
  }, []);

  const t = useCallback(
    (he: string) => (lang === 'en' ? EN_STRINGS[he] ?? he : he),
    [lang]
  );

  const tf = useCallback(
    (heTemplate: string, params: Record<string, string | number>) => {
      const template =
        lang === 'en' ? EN_STRING_TEMPLATES[heTemplate] ?? heTemplate : heTemplate;
      return template.replace(/\{(\w+)\}/g, (_, k: string) =>
        params[k] !== undefined ? String(params[k]) : `{${k}}`
      );
    },
    [lang]
  );

  const dir: 'rtl' | 'ltr' = lang === 'he' ? 'rtl' : 'ltr';

  const value = useMemo(
    () => ({ lang, dir, t, tf, toggleLanguage, setLanguage }),
    [lang, dir, t, tf, toggleLanguage, setLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used inside <LanguageProvider>');
  }
  return ctx;
}
