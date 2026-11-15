import { describe, expect, it } from "vitest";

import { parsePo } from "./poFile";
import { applySuggestions, formatReport, type StoredSuggestion } from "./reviewPull";

const CATALOG = `msgid ""
msgstr ""

#: src/app/HomePage.tsx
msgid "Start"
msgstr "Début"

#: src/app/HomePage.tsx
msgid "Saved {fileName}"
msgstr "{fileName} enregistré"

#: src/app/HomePage.tsx
msgid "Download"
msgstr "Télécharger"
`;

let nextId = 1;
function suggestion(change: Partial<StoredSuggestion>): StoredSuggestion {
  const id = nextId;
  nextId += 1;
  return {
    id,
    reviewer: "Awa",
    link: "Bamako lab",
    context: "",
    msgid: "Start",
    seen: "Début",
    verdict: "edit",
    text: "Commencer",
    at: "2026-11-15T10:00:00.000Z",
    ...change,
  };
}

function translations(catalog: string): Record<string, string> {
  return Object.fromEntries(parsePo(catalog).map((entry) => [entry.msgid, entry.msgstr]));
}

describe("applySuggestions", () => {
  it("takes a change to the translation the reviewer saw", () => {
    const { catalog, outcomes } = applySuggestions(CATALOG, [suggestion({})]);
    expect(translations(catalog)["Start"]).toBe("Commencer");
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["applied"]);
  });

  it("records an approval without changing the catalog", () => {
    const { catalog, outcomes } = applySuggestions(CATALOG, [
      suggestion({ verdict: "ok", text: "Début" }),
    ]);
    expect(catalog).toBe(CATALOG);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["approved"]);
  });

  it("takes the newest of two different changes and reports the other", () => {
    const older = suggestion({ text: "Démarrer", reviewer: "Jean" });
    const newer = suggestion({ text: "Commencer" });
    const { catalog, outcomes } = applySuggestions(CATALOG, [newer, older]);
    expect(translations(catalog)["Start"]).toBe("Commencer");
    expect(outcomes).toEqual([
      { kind: "passed-over", suggestion: older, taken: "Commencer" },
      { kind: "applied", suggestion: newer, was: "Début" },
    ]);
  });

  it("does not let a suggestion overwrite a translation changed since the reviewer saw it", () => {
    const stale = suggestion({ seen: "Démarrer", text: "Lancer" });
    const { catalog, outcomes } = applySuggestions(CATALOG, [stale]);
    expect(catalog).toBe(CATALOG);
    expect(outcomes).toEqual([{ kind: "outdated", suggestion: stale, now: "Début" }]);
  });

  it("treats a change already in the catalog as current, so pulling twice changes nothing", () => {
    const first = applySuggestions(CATALOG, [suggestion({})]);
    const again = applySuggestions(first.catalog, [suggestion({})]);
    expect(again.catalog).toBe(first.catalog);
    expect(again.outcomes.map((outcome) => outcome.kind)).toEqual(["current"]);
  });

  it("refuses a change that drops a placeholder", () => {
    const broken = suggestion({
      msgid: "Saved {fileName}",
      seen: "{fileName} enregistré",
      text: "Enregistré",
    });
    const { catalog, outcomes } = applySuggestions(CATALOG, [broken]);
    expect(catalog).toBe(CATALOG);
    expect(outcomes).toEqual([
      {
        kind: "invalid",
        suggestion: broken,
        problem: "Keep {fileName} exactly as in the English.",
      },
    ]);
  });

  it("reports a suggestion for a message the catalog no longer has", () => {
    const gone = suggestion({ msgid: "Begin" });
    expect(applySuggestions(CATALOG, [gone]).outcomes).toEqual([
      { kind: "unknown", suggestion: gone },
    ]);
  });
});

describe("formatReport", () => {
  it("lists each change with who made it, the approvals per reviewer, and what was not taken", () => {
    const { outcomes } = applySuggestions(CATALOG, [
      suggestion({ id: 101, text: "Démarrer", reviewer: "Jean", link: "Lyon" }),
      suggestion({ id: 102 }),
      suggestion({
        id: 103,
        msgid: "Download",
        seen: "Télécharger",
        verdict: "ok",
        text: "Télécharger",
      }),
      suggestion({ id: 104, msgid: "Saved {fileName}", seen: "x", text: "y" }),
    ]);
    expect(formatReport("French", outcomes)).toBe(
      [
        "## French",
        "",
        "4 suggestions from 2 reviewers: 1 messages changed, 1 approvals.",
        "",
        "### Changed",
        "",
        "- “Start”: “Début” → “Commencer”. By Awa (Bamako lab, 2026-11-15).",
        "  - Not taken: “Démarrer” by Jean (Lyon, 2026-11-15)",
        "",
        "### Approved as they are",
        "",
        "- Awa: 1",
        "",
        "### Not taken",
        "",
        "- “Saved {fileName}”: “y” by Awa (Bamako lab, 2026-11-15). Keep {fileName} exactly as in the English.",
        "",
      ].join("\n"),
    );
  });
});
