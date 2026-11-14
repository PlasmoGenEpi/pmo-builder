import { describe, expect, it } from "vitest";

import { createPanelEntry, type SavedPanelSummary } from "@/domain/draft";
import type { Notice } from "@/domain/types";

import { matchInLibrary, noticesForPanel } from "./panelModel";

describe("noticesForPanel", () => {
  it("finds a panel's notices by its id, not by its name", () => {
    const first = createPanelEntry("P1");
    const second = createPanelEntry("P1");
    const notices: Notice[] = [
      {
        severity: "error",
        code: "table/not-imported",
        message: 'Panel "P1": Import it.',
        panelId: second.id,
      },
      { severity: "error", code: "panel/duplicate-panel-names", message: '"P1" is used twice.' },
    ];
    expect(noticesForPanel(notices, first, 0)).toEqual([]);
    expect(noticesForPanel(notices, second, 1)).toEqual([
      { severity: "error", code: "table/not-imported", message: "Import it.", panelId: second.id },
    ]);
  });
});

function saved(id: string, name: string, contentKey: string): SavedPanelSummary {
  return {
    id,
    name,
    contentKey,
    savedAt: "2026-01-01T00:00:00.000Z",
    targetCount: 1,
  };
}

describe("matchInLibrary", () => {
  it("is saved for the same name and content, and offers to replace for the same name only", () => {
    const library = [saved("a", "P", "k1"), saved("b", "Q", "k2")];
    expect(matchInLibrary(library, { name: "P", contentKey: "k1" })).toEqual({ kind: "saved" });
    expect(matchInLibrary(library, { name: "P", contentKey: "k9" })).toEqual({
      kind: "name-taken",
      existing: library[0],
    });
    expect(matchInLibrary(library, { name: "R", contentKey: "k1" })).toEqual({ kind: "new" });
  });
});
