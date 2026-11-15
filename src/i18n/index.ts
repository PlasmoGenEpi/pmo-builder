/**
 * The interface language: choosing it, loading its catalog and switching.
 *
 * Text in the code is written with Lingui's macros (`t`, `plural`, `Trans`).
 * The locale is chosen and its catalog loaded before the app is imported, so
 * text worked out when a module loads is already in the right language.
 * Changing the language reloads the page.
 */
import { i18n, type Messages } from "@lingui/core";

import { messages as english } from "../locales/en.po";
import {
  chooseLocale,
  LANGUAGE_KEY,
  PSEUDO,
  setCurrentLocale,
  type LanguageCode,
  type Locale,
} from "./languages";

export * from "./languages";
export { i18n };

/** The catalogs other than English, each loaded only when needed. */
const CATALOGS: Readonly<Record<Exclude<Locale, "en">, () => Promise<{ messages: Messages }>>> = {
  fr: () => import("../locales/fr.po"),
  pt: () => import("../locales/pt.po"),
  [PSEUDO]: () => import("../locales/pseudo.po"),
};

// English is always there: it is the source, and the fallback for anything
// a catalog does not have yet.
i18n.load("en", english);
i18n.activate("en");

/** Loads a locale's catalog and switches the interface to it. */
export async function activateLocale(locale: Locale): Promise<void> {
  if (locale !== "en") {
    const { messages } = await CATALOGS[locale]();
    i18n.load(locale, messages);
  }
  i18n.activate(locale);
  setCurrentLocale(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === PSEUDO ? "en" : locale;
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

/** Chooses the locale for this page load and activates it. Falls back to English on any failure. */
export async function initLocale(): Promise<Locale> {
  const locale = chooseLocale({
    search: window.location.search,
    stored: readStored(),
    browser: navigator.languages,
  });
  try {
    await activateLocale(locale);
    return locale;
  } catch {
    await activateLocale("en");
    return "en";
  }
}

/** Remembers the user's language and reloads the page in it. */
export function chooseLanguage(code: LanguageCode): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, code);
  } catch {
    // Storage can be blocked. The language then lasts until the page closes.
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("lang");
  window.location.replace(url.href);
}
