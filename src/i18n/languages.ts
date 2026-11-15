/**
 * The interface languages, without loading any catalog. Kept apart from
 * `index.ts` so that code which only needs to know the locale, such as number
 * formatting, does not pull the catalogs in.
 */

/** Every language the catalogs exist for, with its name in that language. */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "pt", name: "Português" },
] as const;

/** A language with a catalog. */
export type LanguageCode = (typeof LANGUAGES)[number]["code"];

/** The test language, made from English. Reached only with `?lang=pseudo`. */
export const PSEUDO = "pseudo";

/** A locale the interface can be in. */
export type Locale = LanguageCode | typeof PSEUDO;

/**
 * The languages offered to users. A language joins this list once its
 * translation is complete and reviewed by people who use the app in it.
 * Until then it can be previewed with `?lang=fr`.
 */
export const OFFERED: readonly LanguageCode[] = ["en"];

/** Where the user's choice of language is kept. */
export const LANGUAGE_KEY = "pmo-builder.language";

let current: Locale = "en";

/** The locale the interface is in. */
export function currentLocale(): Locale {
  return current;
}

/** Records the locale the interface is now in. Called by `activateLocale`. */
export function setCurrentLocale(locale: Locale): void {
  current = locale;
}

/**
 * The locale for `Intl` formatting. English formats as British English, for
 * day-first dates ("14 November 2026") that read the same everywhere; the test
 * language formats as English.
 */
export function intlLocale(): string {
  return current === PSEUDO || current === "en" ? "en-GB" : current;
}

/** True when `value` is a locale with a catalog. */
export function isLocale(value: unknown): value is Locale {
  return value === PSEUDO || LANGUAGES.some((language) => language.code === value);
}

function offered(code: string): LanguageCode | null {
  return OFFERED.find((language) => language === code) ?? null;
}

/**
 * Picks the interface locale: a `?lang=` in the address (to preview or test a
 * language), then the user's own choice, then the first offered language the
 * browser asks for, then English.
 */
export function chooseLocale(options: {
  readonly search: string;
  readonly stored: string | null;
  readonly browser: readonly string[];
}): Locale {
  const asked = new URLSearchParams(options.search).get("lang");
  if (isLocale(asked)) return asked;
  if (options.stored !== null) {
    const stored = offered(options.stored);
    if (stored !== null) return stored;
  }
  for (const tag of options.browser) {
    const match = offered(tag.toLowerCase().split("-")[0] ?? "");
    if (match !== null) return match;
  }
  return "en";
}
