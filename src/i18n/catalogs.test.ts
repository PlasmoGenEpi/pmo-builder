/**
 * Checks the translation catalogs in `src/locales/`: every translation keeps
 * the placeholders, plural and select variables, and tags of its English
 * message, so a translator cannot drop or invent one. An empty translation
 * is allowed: the app shows the English.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { OFFERED } from "./languages";
import { translationProblem } from "./messageShape";
import { messageKey, parsePo, type PoEntry } from "./poFile";

function readCatalog(locale: string): PoEntry[] {
  return parsePo(readFileSync(`src/locales/${locale}.po`, "utf8"));
}

describe.each(["fr", "pt"])("the %s catalog", (locale) => {
  const entries = readCatalog(locale);
  const english = readCatalog("en");

  it("has an entry for every English message", () => {
    expect(entries.map(messageKey).toSorted()).toEqual(english.map(messageKey).toSorted());
  });

  it("keeps the placeholders, plurals, selects and tags of each English message", () => {
    const broken = entries.flatMap((entry) => {
      const problem = translationProblem(entry.msgid, entry.msgstr);
      return problem === null ? [] : [`${problem} ${entry.msgid} => ${entry.msgstr}`];
    });
    expect(broken).toEqual([]);
  });
});

/**
 * A language offered to users must have every message translated: the app
 * would otherwise show English in the middle of it. Languages still in
 * preview may have gaps.
 */
describe("offered languages", () => {
  it("have a translation for every message", () => {
    const gaps = OFFERED.filter((locale) => locale !== "en").flatMap((locale) =>
      readCatalog(locale)
        .filter((entry) => entry.msgstr.trim() === "")
        .map((entry) => `${locale}: ${messageKey(entry)}`),
    );
    expect(gaps).toEqual([]);
  });
});
