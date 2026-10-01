/**
 * Lightweight i18n.
 *
 * Pure homegrown — no `react-i18next` or FormatJS dep. The dictionary lives
 * in `src/locales/*.ts`, keyed by dot-notation strings (`'settings.title'`).
 * Components subscribe via the `useT()` hook which returns a stable
 * translator that re-renders only when the active locale changes.
 *
 * Fallback chain: requested locale → English → key literal (so missing
 * translations are obvious in dev but never crash render).
 */
import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import * as settings from './settings';

import en from '../locales/en';
import pt from '../locales/pt';
import de from '../locales/de';
import ru from '../locales/ru';

export const KEY_LOCALE = 'locale';

export type Locale = 'en' | 'pt' | 'de' | 'ru';

export interface LocaleMeta {
  id: Locale;
  label: string;       // own-language label (e.g. "Deutsch")
  englishLabel: string; // English label (for tooltip)
  flag: string;        // emoji for the picker
}

export const LOCALES: LocaleMeta[] = [
  { id: 'en', label: 'English',    englishLabel: 'English',    flag: '🇬🇧' },
  { id: 'pt', label: 'Português',  englishLabel: 'Portuguese', flag: '🇧🇷' },
  { id: 'de', label: 'Deutsch',    englishLabel: 'German',     flag: '🇩🇪' },
  { id: 'ru', label: 'Русский',    englishLabel: 'Russian',    flag: '🇷🇺' },
];

const DICTS: Record<Locale, Record<string, string>> = { en, pt, de, ru };
const DEFAULT_LOCALE: Locale = 'pt';

/**
 * Look up a key in `locale`, falling back to English, then to the key itself.
 * `vars` are simple `{name}` placeholder substitutions (no plural/format).
 */
function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = DICTS[locale]?.[key] ?? DICTS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => Promise<void>;
}

const LocaleContext = createContext<Ctx>({
  locale: DEFAULT_LOCALE,
  setLocale: async () => {},
});

/**
 * Wrap your tree once. Loads the saved locale from `app_settings` on mount
 * and exposes a setter that persists changes. Render is blocked until the
 * initial load completes so the first paint already shows the right
 * language.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await settings.get(KEY_LOCALE);
        if (saved && LOCALES.some((l) => l.id === saved)) {
          setLocaleState(saved as Locale);
          setActiveLocale(saved as Locale);
        }
      } catch (err) {
        // Migration v4 may not have applied yet on a first launch.
        console.warn('[i18n] failed to load saved locale', err);
      }
      setReady(true);
    })();
  }, []);

  // Keep the module-level mirror in sync so `tStandalone()` (used in event
  // handlers and catch blocks) follows the React state.
  useEffect(() => {
    setActiveLocale(locale);
  }, [locale]);

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    setActiveLocale(next);
    try {
      await settings.set(KEY_LOCALE, next);
    } catch (err) {
      console.warn('[i18n] failed to persist', err);
    }
  }, []);

  if (!ready) return null;

  return createElement(LocaleContext.Provider, { value: { locale, setLocale } }, children);
}

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

/** React hook returning the translator + the active locale + setter. */
export function useT() {
  const { locale, setLocale } = useContext(LocaleContext);
  const t = useCallback<TFunction>(
    (key, vars) => translate(locale, key, vars),
    [locale],
  );
  return { t, locale, setLocale };
}

/** Non-React translator for code that runs outside a component (events,
 *  catch blocks, etc.). Reads from a module-level current-locale cell that
 *  the provider keeps in sync via a side effect. */
let _currentLocale: Locale = DEFAULT_LOCALE;
export function setActiveLocale(l: Locale) {
  _currentLocale = l;
}
export function tStandalone(
  key: string,
  vars?: Record<string, string | number>,
): string {
  return translate(_currentLocale, key, vars);
}
