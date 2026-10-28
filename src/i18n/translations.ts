import type { zhCNTranslations } from "./translations.zh-CN";

export type Locale = "zh-CN" | "en-US";

export const DEFAULT_LOCALE: Locale = "zh-CN";

export const LOCALE_STORAGE_KEY = "lifeos_locale";

export const localeLabels: Record<Locale, string> = {
  "zh-CN": "中文",
  "en-US": "English",
};

export type TranslationKey = keyof typeof zhCNTranslations;
export type TranslationMessages = Record<TranslationKey, string>;

const translationLoaders: Record<Locale, () => Promise<TranslationMessages>> = {
  "zh-CN": () => import("./translations.zh-CN.ts").then((module) => module.zhCNTranslations),
  "en-US": () => import("./translations.en-US.ts").then((module) => module.enUSTranslations),
};

const translationPromises = new Map<Locale, Promise<TranslationMessages>>();

export function loadTranslations(locale: Locale) {
  const cached = translationPromises.get(locale);
  if (cached) return cached;
  const pending = translationLoaders[locale]().catch((error) => {
    translationPromises.delete(locale);
    throw error;
  });
  translationPromises.set(locale, pending);
  return pending;
}
