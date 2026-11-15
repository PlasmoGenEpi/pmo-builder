import { describe, expect, it } from "vitest";

import { translationProblem } from "./messageShape";
import { messageKey, parsePo, setTranslation } from "./poFile";

const CATALOG = `msgid ""
msgstr ""

#. Field label: where an allele starts on the chromosome
#: src/domain/fields/microhaplotypes.ts
msgctxt "position on a chromosome"
msgid "Start"
msgstr "Début"

#: src/app/HomePage.tsx
#: src/app/StepNav.tsx
msgid "Start"
msgstr ""

#: src/features/review/ReviewStep.tsx
msgid "Saved \\"{fileName}\\""
msgstr "Enregistré"
" « {fileName} »"
`;

describe("parsePo", () => {
  it("reads each message with its context, notes and files", () => {
    expect(parsePo(CATALOG)).toEqual([
      {
        context: "position on a chromosome",
        msgid: "Start",
        msgstr: "Début",
        notes: ["Field label: where an allele starts on the chromosome"],
        origins: ["src/domain/fields/microhaplotypes.ts"],
      },
      {
        context: "",
        msgid: "Start",
        msgstr: "",
        notes: [],
        origins: ["src/app/HomePage.tsx", "src/app/StepNav.tsx"],
      },
      {
        context: "",
        msgid: 'Saved "{fileName}"',
        msgstr: "Enregistré « {fileName} »",
        notes: [],
        origins: ["src/features/review/ReviewStep.tsx"],
      },
    ]);
  });
});

describe("messageKey", () => {
  it("keeps messages with the same English apart by their context", () => {
    const [withContext, plain] = parsePo(CATALOG);
    expect(withContext && messageKey(withContext)).not.toBe(plain && messageKey(plain));
  });
});

describe("setTranslation", () => {
  it("replaces one message's translation and leaves the rest as written", () => {
    const changed = setTranslation(CATALOG, { context: "", msgid: "Start" }, "Commencer");
    expect(changed).not.toBeNull();
    const entries = parsePo(changed ?? "");
    expect(entries.map((entry) => entry.msgstr)).toEqual([
      "Début",
      "Commencer",
      "Enregistré « {fileName} »",
    ]);
    expect(changed).toContain('#: src/app/HomePage.tsx\n#: src/app/StepNav.tsx\nmsgid "Start"');
  });

  it("replaces a translation written over several lines", () => {
    const changed = setTranslation(
      CATALOG,
      { context: "", msgid: 'Saved "{fileName}"' },
      "Enregistré : {fileName}",
    );
    expect(parsePo(changed ?? "")[2]?.msgstr).toBe("Enregistré : {fileName}");
    expect(changed).not.toContain(" « {fileName} »");
  });

  it("returns null for a message the catalog does not have", () => {
    expect(setTranslation(CATALOG, { context: "", msgid: "Stop" }, "Arrêter")).toBeNull();
  });
});

describe("translationProblem", () => {
  it("accepts a translation that keeps every placeholder", () => {
    expect(translationProblem("Saved {fileName}", "{fileName} enregistré")).toBeNull();
  });

  it("accepts an empty translation", () => {
    expect(translationProblem("Saved {fileName}", "")).toBeNull();
  });

  it("names a dropped placeholder", () => {
    expect(translationProblem("Saved {fileName}", "Enregistré")).toBe(
      "Keep {fileName} exactly as in the English.",
    );
  });

  it("names an invented placeholder", () => {
    expect(translationProblem("Saved", "Enregistré {fichier}")).toBe(
      "{fichier} is not in the English. Use only its placeholders.",
    );
  });

  it("finds braces that do not pair up", () => {
    expect(translationProblem("Saved {fileName}", "Enregistré {fileName")).toMatch(/braces/);
  });

  it("finds a dropped tag", () => {
    expect(translationProblem("Read <0>the guide</0>.", "Lisez le guide.")).toMatch(/tag/);
  });

  it("finds a plural without its number", () => {
    expect(
      translationProblem(
        "{count, plural, one {# specimen} other {# specimens}}",
        "{count, plural, one {un spécimen} other {des spécimens}}",
      ),
    ).toMatch(/#/);
  });
});
