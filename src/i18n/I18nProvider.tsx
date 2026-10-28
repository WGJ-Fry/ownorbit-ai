import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, loadTranslations, localeLabels } from "./translations";
import type { Locale, TranslationKey, TranslationMessages } from "./translations";

type TranslationValues = Record<string, string | number | boolean | null | undefined>;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  localeLabels: Record<Locale, string>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function normalizeLocale(value: string | null | undefined): Locale {
  if (value === "en-US" || value?.toLowerCase().startsWith("en")) return "en-US";
  if (value === "zh-CN" || value?.toLowerCase().startsWith("zh")) return "zh-CN";
  return DEFAULT_LOCALE;
}

function readInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY) || window.navigator.language);
}

function interpolate(template: string, values?: TranslationValues) {
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readInitialLocale());
  const [messages, setMessages] = useState<TranslationMessages | null>(null);
  const loadVersionRef = useRef(0);

  const setLocale = useCallback((nextLocale: Locale) => {
    const loadVersion = ++loadVersionRef.current;
    void loadTranslations(nextLocale)
      .then((nextMessages) => {
        if (loadVersion !== loadVersionRef.current) return;
        setMessages(nextMessages);
        setLocaleState(nextLocale);
        window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
      })
      .catch((error) => {
        console.error(`Failed to load ${nextLocale} translations`, error);
      });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const loadVersion = ++loadVersionRef.current;
    void loadTranslations(locale)
      .then((nextMessages) => {
        if (loadVersion !== loadVersionRef.current) return;
        setMessages(nextMessages);
      })
      .catch(async (error) => {
        console.error(`Failed to load ${locale} translations`, error);
        if (locale === DEFAULT_LOCALE || loadVersion !== loadVersionRef.current) return;
        try {
          const fallbackMessages = await loadTranslations(DEFAULT_LOCALE);
          if (loadVersion !== loadVersionRef.current) return;
          setMessages(fallbackMessages);
          setLocaleState(DEFAULT_LOCALE);
          window.localStorage.setItem(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
        } catch (fallbackError) {
          console.error("Failed to load fallback translations", fallbackError);
        }
      });
    return () => {
      if (loadVersion === loadVersionRef.current) loadVersionRef.current += 1;
    };
  }, []);

  const t = useCallback((key: TranslationKey, values?: TranslationValues) => {
    const template = messages?.[key] || key;
    return interpolate(template, values);
  }, [messages]);

  const value = useMemo(() => ({ locale, setLocale, t, localeLabels }), [locale, setLocale, t]);

  if (!messages) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060a10] text-zinc-100" role="status" aria-label="OwnOrbit AI">
        <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-sm font-bold text-zinc-300">
          <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
          OwnOrbit AI
        </div>
      </div>
    );
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}
