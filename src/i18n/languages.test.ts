import { describe, expect, it } from "vitest";

import { chooseLocale, isLocale, OFFERED } from "./languages";

describe("chooseLocale", () => {
  it("takes a language named in the address, to preview or test it", () => {
    expect(chooseLocale({ search: "?lang=fr", stored: "en", browser: ["en-US"] })).toBe("fr");
    expect(chooseLocale({ search: "?lang=pseudo", stored: null, browser: [] })).toBe("pseudo");
  });

  it("ignores an address naming a language with no catalog", () => {
    expect(chooseLocale({ search: "?lang=xx", stored: null, browser: [] })).toBe("en");
  });

  it("uses the user's choice, then the browser's languages, among those offered", () => {
    expect(chooseLocale({ search: "", stored: "en", browser: ["fr-FR"] })).toBe("en");
    expect(chooseLocale({ search: "", stored: null, browser: ["de-DE", "en-GB"] })).toBe("en");
  });

  it("does not offer a language until it is in the offered list", () => {
    const french = OFFERED.some((code) => code === "fr");
    expect(chooseLocale({ search: "", stored: "fr", browser: ["fr-FR"] })).toBe(
      french ? "fr" : "en",
    );
  });

  it("knows which locales have catalogs", () => {
    expect(isLocale("pt")).toBe(true);
    expect(isLocale("pseudo")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
