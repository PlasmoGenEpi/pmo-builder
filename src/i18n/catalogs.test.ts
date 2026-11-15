/**
 * Checks the translation catalogs in `src/locales/`: every translation keeps
 * the placeholders, plural and select variables, and tags of its English
 * message, so a translator cannot drop or invent one. An empty translation
 * is allowed: the app shows the English.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { messageShape } from "./messageShape";

interface Entry {
  readonly msgid: string;
  readonly msgstr: string;
}

/** A quoted `.po` string as text. */
function unquote(text: string): string {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === "string" ? parsed : "";
}

/** Reads a `.po` file's entries. Enough for the files `lingui extract` writes. */
function readCatalog(locale: string): Entry[] {
  const lines = readFileSync(`src/locales/${locale}.po`, "utf8").split("\n");
  const entries: Entry[] = [];
  let msgid: string | null = null;
  let msgstr: string | null = null;
  let field: "msgid" | "msgstr" | null = null;
  const flush = (): void => {
    if (msgid !== null && msgid !== "") entries.push({ msgid, msgstr: msgstr ?? "" });
    msgid = null;
    msgstr = null;
    field = null;
  };
  for (const line of lines) {
    if (line.startsWith("msgid ")) {
      msgid = unquote(line.slice(6));
      field = "msgid";
    } else if (line.startsWith("msgstr ")) {
      msgstr = unquote(line.slice(7));
      field = "msgstr";
    } else if (line.startsWith('"') && field === "msgid") {
      msgid = (msgid ?? "") + unquote(line);
    } else if (line.startsWith('"') && field === "msgstr") {
      msgstr = (msgstr ?? "") + unquote(line);
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return entries;
}

describe.each(["fr", "pt"])("the %s catalog", (locale) => {
  const entries = readCatalog(locale);
  const english = readCatalog("en");

  it("has an entry for every English message", () => {
    expect(entries.map((entry) => entry.msgid).toSorted()).toEqual(
      english.map((entry) => entry.msgid).toSorted(),
    );
  });

  it("keeps the placeholders, plurals, selects and tags of each English message", () => {
    const broken: string[] = [];
    for (const entry of entries.filter((item) => item.msgstr !== "")) {
      let reason: string | null = null;
      try {
        const source = messageShape(entry.msgid);
        const target = messageShape(entry.msgstr);
        if (source.variables.join() !== target.variables.join()) reason = "placeholders differ";
        else if (source.tags.join() !== target.tags.join()) reason = "tags differ";
        else if (source.octothorpe && !target.octothorpe) reason = "# is missing";
      } catch (error) {
        reason = `not valid: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (reason !== null) broken.push(`${reason}: ${entry.msgid} => ${entry.msgstr}`);
    }
    expect(broken).toEqual([]);
  });
});
