import { describe, expect, it } from "vitest";

import type { PoEntry } from "@/i18n/poFile";

import type { ReviewSuggestion } from "./reviewApi";
import {
  GROUPS,
  groupOf,
  languageStatus,
  progressOf,
  reviewItems,
  visibleItems,
} from "./reviewModel";

function entry(change: Partial<PoEntry>): PoEntry {
  return {
    context: "",
    msgid: "Start",
    msgstr: "Commencer",
    notes: [],
    origins: ["src/app/HomePage.tsx"],
    ...change,
  };
}

let nextId = 1;
function said(change: Partial<ReviewSuggestion>): ReviewSuggestion {
  const id = nextId;
  nextId += 1;
  return {
    id,
    reviewer: "Awa",
    context: "",
    msgid: "Start",
    seen: "Commencer",
    verdict: "ok",
    text: "Commencer",
    at: "2026-11-15T10:00:00.000Z",
    ...change,
  };
}

describe("groupOf", () => {
  it.each([
    [["src/app/HomePage.tsx"], "home"],
    [["src/features/panel/GenomeSection.tsx"], "panel"],
    [["src/features/librarySamples/LibrarySamplesStep.tsx"], "specimens"],
    [["src/domain/fields/samples.ts"], "specimens"],
    [["src/domain/fields/microhaplotypes.ts"], "microhaplotypes"],
    [["src/domain/build/runName.ts"], "sequencing"],
    [["src/domain/fields/records.ts"], "forms"],
    [["src/domain/build/merge.ts"], "checks"],
    [["src/features/review/PublishToZenodo.tsx"], "publishing"],
    [["src/features/review/VerdictCard.tsx"], "review"],
    [["src/features/table-import/TableFile.tsx"], "tables"],
    [["src/domain/import/messages.ts"], "tables"],
    [["src/ui/Toast.tsx"], "controls"],
    [["src/features/pmo-file/SubsetPanel.tsx"], "tools"],
    [[], "home"],
  ])("puts %j in %s", (origins, group) => {
    expect(groupOf(origins)).toBe(group);
  });

  it("only names groups that exist", () => {
    const ids = new Set(GROUPS.map((group) => group.id));
    const every = [
      "src/features/microhaplotypes/x.tsx",
      "src/features/specimens/x.tsx",
      "src/features/project/x.tsx",
      "src/features/bioinformatics/x.tsx",
      "src/features/readCounts/x.tsx",
      "src/features/published/x.tsx",
      "src/features/records/x.tsx",
      "src/domain/build/readCounts.ts",
      "src/worker/x.ts",
    ];
    for (const origin of every) expect(ids).toContain(groupOf([origin]));
  });
});

describe("reviewItems", () => {
  it("marks a message nobody has said anything about as unchecked", () => {
    expect(reviewItems([entry({})], [])[0]?.status).toBe("unchecked");
  });

  it("marks a message approved when someone said its current translation looks right", () => {
    expect(reviewItems([entry({})], [said({})])[0]?.status).toBe("approved");
  });

  it("marks a message with a pending change", () => {
    const items = reviewItems([entry({})], [said({ verdict: "edit", text: "Démarrer" })]);
    expect(items[0]?.status).toBe("changes");
  });

  it("counts a change already taken into the catalog as a check", () => {
    const items = reviewItems(
      [entry({ msgstr: "Démarrer" })],
      [said({ seen: "Commencer", verdict: "edit", text: "Démarrer" })],
    );
    expect(items[0]?.status).toBe("approved");
    expect(items[0]?.suggestions).toHaveLength(1);
  });

  it("forgets an approval once the translation has changed", () => {
    const items = reviewItems([entry({ msgstr: "Démarrer" })], [said({ seen: "Commencer" })]);
    expect(items[0]?.status).toBe("unchecked");
    expect(items[0]?.suggestions).toEqual([]);
  });

  it("keeps messages with the same English apart by their context", () => {
    const items = reviewItems(
      [entry({}), entry({ context: "position on a chromosome", msgstr: "Début" })],
      [said({})],
    );
    expect(items.map((item) => item.status)).toEqual(["approved", "unchecked"]);
  });
});

describe("visibleItems and progressOf", () => {
  const items = reviewItems(
    [
      entry({ msgid: "Start" }),
      entry({ msgid: "Download", msgstr: "Télécharger" }),
      entry({ msgid: "Genome", msgstr: "Génome", origins: ["src/features/panel/G.tsx"] }),
    ],
    [said({})],
  );

  it("shows one group's unchecked messages", () => {
    const shown = visibleItems(items, { group: "home", filter: "unchecked", search: "" });
    expect(shown.map((item) => item.entry.msgid)).toEqual(["Download"]);
  });

  it("searches every group, in English and in the translation", () => {
    const shown = visibleItems(items, { group: "home", filter: "all", search: "génome" });
    expect(shown.map((item) => item.entry.msgid)).toEqual(["Genome"]);
  });

  it("counts what has been checked", () => {
    expect(progressOf(items)).toEqual({ total: 3, checked: 1, changes: 0 });
  });
});

describe("languageStatus", () => {
  const entries = [
    entry({ msgid: "Start", msgstr: "Commencer" }),
    entry({ msgid: "Download", msgstr: "Télécharger" }),
    entry({ msgid: "Genome", msgstr: "" }),
  ];

  it("counts translated, checked and changed messages, and reviewers", () => {
    const status = languageStatus(entries, [
      said({ reviewer: "Awa" }),
      said({
        reviewer: "Jean",
        msgid: "Download",
        seen: "Télécharger",
        verdict: "edit",
        text: "Exporter",
      }),
    ]);
    expect(status).toEqual({
      messages: 3,
      translated: 2,
      checked: 2,
      changes: 1,
      reviewers: 2,
      ready: false,
    });
  });

  it("is ready only when every message is translated and nearly all are checked", () => {
    const full = [entry({ msgid: "Start", msgstr: "Commencer" })];
    expect(languageStatus(full, []).ready).toBe(false);
    expect(languageStatus(full, [said({})]).ready).toBe(true);
    expect(
      languageStatus(
        entries,
        entries.map((item) => said({ msgid: item.msgid, seen: item.msgstr })),
      ).ready,
    ).toBe(false);
  });

  it("stops counting an approval once the translation changes", () => {
    const changed = [entry({ msgid: "Start", msgstr: "Démarrer" })];
    expect(languageStatus(changed, [said({ seen: "Commencer" })]).checked).toBe(0);
  });
});
