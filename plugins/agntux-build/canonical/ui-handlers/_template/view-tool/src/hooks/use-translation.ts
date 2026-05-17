import { useMemo } from 'react';
import { useHostContext } from '../lib/apps-react/index.js';

// Pre-import all locales statically so Vite can bundle them
import enUS from '../../locales/en-US.json';
import esES from '../../locales/es-ES.json';
import esMX from '../../locales/es-MX.json';
import frFR from '../../locales/fr-FR.json';
import deDE from '../../locales/de-DE.json';
import jaJP from '../../locales/ja-JP.json';
import zhCN from '../../locales/zh-CN.json';
import ptBR from '../../locales/pt-BR.json';
import itIT from '../../locales/it-IT.json';
import koKR from '../../locales/ko-KR.json';
import ruRU from '../../locales/ru-RU.json';

type TranslationMap = Record<string, string>;

// Pre-loaded translations map
const translationsMap: Record<string, TranslationMap> = {
  'en-US': enUS,
  'es-ES': esES,
  'es-MX': esMX,
  'fr-FR': frFR,
  'de-DE': deDE,
  'ja-JP': jaJP,
  'zh-CN': zhCN,
  'pt-BR': ptBR,
  'it-IT': itIT,
  'ko-KR': koKR,
  'ru-RU': ruRU,
};

// Default fallback locale
const DEFAULT_LOCALE = 'en-US';

/**
 * Normalizes a BCP 47 locale string to a file-safe format.
 * Examples: 'en-US' -> 'en-US', 'en' -> 'en-US', 'fr-FR' -> 'fr-FR'
 */
function normalizeLocale(locale: string | undefined): string {
  if (!locale) return DEFAULT_LOCALE;

  // Handle full locale codes (e.g., 'en-US', 'es-MX')
  if (locale.includes('-')) {
    return locale;
  }

  // Handle language-only codes (e.g., 'en' -> 'en-US', 'es' -> 'es-ES')
  const languageMap: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    ja: 'ja-JP',
    zh: 'zh-CN',
    pt: 'pt-BR',
    it: 'it-IT',
    ko: 'ko-KR',
    ru: 'ru-RU',
  };

  return languageMap[locale] ?? DEFAULT_LOCALE;
}

/**
 * Loads a locale from the pre-loaded translations map.
 * Falls back to en-US if the requested locale is not available.
 */
function loadLocale(locale: string): TranslationMap {
  const normalized = normalizeLocale(locale);
  return translationsMap[normalized] ?? translationsMap[DEFAULT_LOCALE] ?? {};
}

/**
 * Substitutes parameters in a translation string.
 * Supports {{key}} syntax for parameter replacement.
 * Example: t('welcome.message', { name: 'John' }) with "Hello {{name}}" -> "Hello John"
 */
function substituteParams(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;

  let result = template;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder, 'g'), String(value));
  }
  return result;
}

/**
 * Hook for accessing translations in widgets.
 *
 * Automatically reads the locale from the host context and loads
 * the appropriate translation file. Falls back to en-US if the locale
 * is not available.
 *
 * Works with MCP Apps protocol.
 *
 * @example
 * ```tsx
 * const { t, locale } = useTranslation()
 * return <h1>{t('welcome.title')}</h1>
 * ```
 *
 * @example With parameters
 * ```tsx
 * const { t } = useTranslation()
 * return <p>{t('welcome.message', { name: 'John' })}</p>
 * // Translation: "Hello {{name}}" -> "Hello John"
 * ```
 */
export function useTranslation() {
  const hostContext = useHostContext();
  const hostLocale = hostContext.locale;

  const normalizedLocale = useMemo(
    () => normalizeLocale(hostLocale),
    [hostLocale],
  );

  const translations = useMemo(
    () => loadLocale(normalizedLocale),
    [normalizedLocale],
  );

  /**
   * Translates a key to its localized string.
   * Supports parameter substitution using {{key}} syntax.
   *
   * @param key - Translation key in dot notation (e.g., 'button.increment')
   * @param params - Optional parameters to substitute in the translation
   * @returns The translated string, or the key if translation is missing
   */
  const t = useMemo(
    () =>
      (key: string, params?: Record<string, string | number>): string => {
        const translation = translations[key];
        if (!translation) {
          // In development, log missing keys for debugging
          if (import.meta.env.DEV) {
            console.warn(
              `Translation key missing: ${key} (locale: ${normalizedLocale})`,
            );
          }
          return key;
        }
        return substituteParams(translation, params);
      },
    [translations, normalizedLocale],
  );

  return {
    t,
    locale: normalizedLocale,
    isLoading: false, // No longer async, so always false
  };
}
