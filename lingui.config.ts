import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

/**
 * The languages the interface can be shown in, and where their catalogs
 * live. English is the source: the text in the code is the English text.
 * `pseudo` is a test language, made automatically from English, that shows
 * text left out of the catalog and text that will run long in translation.
 */
export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "fr", "pt", "pseudo"],
  pseudoLocale: {
    locale: "pseudo",
    prepend: "⟦",
    append: "⟧",
    extend: 0.3,
    extendCharacter: "~",
  },
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}",
      include: ["<rootDir>/src"],
      exclude: [
        "**/*.test.*",
        "<rootDir>/src/test/**",
        "<rootDir>/src/app/styleguide/**",
        // The review page is read by translators, in English. See its header.
        "<rootDir>/src/features/translate/**",
        "**/testing.ts",
        "**/testing.tsx",
      ],
    },
  ],
  format: formatter({ lineNumbers: false }),
});
