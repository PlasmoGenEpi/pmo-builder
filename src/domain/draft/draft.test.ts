import { describe, expect, it } from "vitest";

import {
  addListItem,
  applyModeChange,
  hasListItem,
  moveListItem,
  removeListItem,
  setRecordValue,
  updateListItem,
} from "./edit";
import {
  readFieldValue,
  splitListValue,
  toListText,
  PROJECT_FORM_FIELDS,
  formField,
  SEQUENCING_FORM_FIELDS,
} from "./forms";
import { checkDraft, isDraft, migrateDraft } from "./guard";
import { createEmptyDraft, isBlankRecord, isMatchConfirmed, type MappedTable } from "./model";
import { panelContentKey } from "./panels";
import {
  confirmSlotMatch,
  fieldSetForSlot,
  getSlotTable,
  listFilledSlots,
  referencedTableIds,
  setSlotMapping,
  setSlotTable,
  slotExists,
} from "./slots";

const TABLE: MappedTable = {
  table: {
    id: "t1",
    fileName: "a.csv",
    fileSize: 10,
    format: "delimited",
    sheetNames: null,
    sheetName: null,
    columns: ["a"],
    rowCount: 1,
  },
  mapping: { fields: { targetName: "a" }, additionalColumns: [] },
};

describe("the empty draft", () => {
  it("is JSON, passes the guard, and has nothing entered", () => {
    const draft = createEmptyDraft();
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
    expect(isDraft(draft)).toBe(true);
    expect(draft.project.records.every((record) => isBlankRecord(record))).toBe(true);
    expect(referencedTableIds(draft)).toEqual([]);
  });
});

describe("checkDraft", () => {
  it("names where a value differs from a draft", () => {
    const draft = createEmptyDraft();
    expect(
      checkDraft({ ...draft, readCounts: { ...draft.readCounts, runName: { mode: "sometimes" } } }),
    ).toEqual({
      ok: false,
      problem: "draft.readCounts.runName.mode is not one of none, fixed, column",
    });
    expect(checkDraft(null)).toEqual({ ok: false, problem: "draft is not an object" });
    expect(checkDraft("draft")).toMatchObject({ ok: false });
  });

  it("checks saved panel fragments are JSON", () => {
    const draft = createEmptyDraft();
    const panel = draft.panel.panels[0];
    if (panel === undefined) throw new Error("no panel");
    const saved = { savedPanelId: "s", name: "n", savedAt: "d", fragment: { a: [1, "b", null] } };
    expect(isDraft({ ...draft, panel: { panels: [{ ...panel, saved }] } })).toBe(true);
    expect(
      isDraft({
        ...draft,
        panel: { panels: [{ ...panel, saved: { ...saved, fragment: { a: Number.NaN } } }] },
      }),
    ).toBe(false);
  });
});

describe("confirmed matches", () => {
  it("are kept with the slot's table, and a new table starts without them", () => {
    const slot = { section: "specimens" } as const;
    const draft = setSlotTable(createEmptyDraft(), slot, TABLE);
    const confirmed = confirmSlotMatch(draft, slot, { fieldKey: "targetName", column: "a" });
    const mapped = getSlotTable(confirmed, slot);
    if (mapped === null) throw new Error("no table");
    expect(isMatchConfirmed(mapped, "targetName", "a")).toBe(true);
    expect(isMatchConfirmed(mapped, "targetName", "b")).toBe(false);
    expect(confirmSlotMatch(confirmed, slot, { fieldKey: "targetName", column: "a" })).toBe(
      confirmed,
    );
    expect(isDraft(confirmed)).toBe(true);
    expect(
      getSlotTable(setSlotTable(confirmed, slot, TABLE), slot)?.confirmedMatches,
    ).toBeUndefined();
  });

  it("are added, empty, to every table of a draft saved without them", () => {
    const draft = createEmptyDraft();
    const panelId = draft.panel.panels[0]?.id ?? "";
    const stored: unknown = JSON.parse(
      JSON.stringify(
        setSlotTable(
          setSlotTable(draft, { section: "microhaplotypes" }, TABLE),
          { section: "panel", panelId, part: "targets" },
          TABLE,
        ),
      ),
    );
    const result = checkDraft(stored);
    if (!result.ok) throw new Error(result.problem);
    expect(result.draft.microhaplotypes.table?.confirmedMatches).toEqual({});
    expect(result.draft.panel.panels[0]?.table?.confirmedMatches).toEqual({});
    // A draft with nothing to add comes back as it was.
    const fresh = createEmptyDraft();
    expect(migrateDraft(fresh)).toBe(fresh);
  });

  it("must map fields to text when present", () => {
    const draft = setSlotTable(
      createEmptyDraft(),
      { section: "specimens" },
      {
        ...TABLE,
        confirmedMatches: { targetName: "a" },
      },
    );
    expect(isDraft(draft)).toBe(true);
    const broken: unknown = JSON.parse(
      JSON.stringify(draft).replace('"targetName":"a"}}', '"targetName":3}}'),
    );
    expect(checkDraft(broken)).toMatchObject({ ok: false });
  });
});

describe("table slots", () => {
  it("puts tables in slots, changes their mapping and lists them", () => {
    const draft = createEmptyDraft();
    const panelId = draft.panel.panels[0]?.id ?? "";
    const slot = { section: "panel", panelId, part: "genome" } as const;
    expect(fieldSetForSlot(slot)).toBe("genomes");
    const withTable = setSlotTable(draft, slot, TABLE);
    expect(getSlotTable(withTable, slot)).toBe(TABLE);
    const remapped = setSlotMapping(withTable, slot, { fields: {}, additionalColumns: ["a"] });
    expect(getSlotTable(remapped, slot)?.mapping.additionalColumns).toEqual(["a"]);
    expect(listFilledSlots(remapped).map((filled) => filled.slot)).toEqual([slot]);
    expect(referencedTableIds(remapped)).toEqual(["t1"]);
    expect(slotExists(remapped, { ...slot, panelId: "gone" })).toBe(false);
    const readCounts = setSlotTable(draft, { section: "readCounts", part: "byStage" }, TABLE);
    expect(readCounts.readCounts.byStage).toBe(TABLE);
  });
});

describe("list edits", () => {
  it("adds, updates, moves and removes items", () => {
    const start = createEmptyDraft();
    const { draft: two, id } = addListItem(start, { list: "projects" });
    expect(two.project.records).toHaveLength(2);
    const named = setRecordValue(two, { list: "projects", id, key: "project_name", value: "P2" });
    expect(named.project.records[1]?.values.project_name).toBe("P2");
    const moved = moveListItem(named, { list: "projects" }, id, 0);
    expect(moved.project.records[0]?.id).toBe(id);
    const updated = updateListItem(moved, {
      list: "projects",
      id,
      recipe: (record) => ({
        ...record,
        id: "changed",
        extra: [{ id: "e", key: "k", value: "v" }],
      }),
    });
    expect(updated.project.records[0]).toMatchObject({ id, extra: [{ key: "k" }] });
    const removed = removeListItem(updated, { list: "projects" }, id);
    expect(removed.project.records).toHaveLength(1);
    expect(hasListItem(removed, { list: "projects" }, id)).toBe(false);
  });

  it("adds steps to a method and leaves the input untouched", () => {
    const start = createEmptyDraft();
    const methodId = start.bioinformatics.methods.records[0]?.id ?? "";
    const { draft, id } = addListItem(start, { list: "methodSteps", methodId });
    expect(draft.bioinformatics.methods.records[0]?.steps).toHaveLength(2);
    expect(start.bioinformatics.methods.records[0]?.steps).toHaveLength(1);
    const valued = setRecordValue(draft, {
      list: "methodSteps",
      methodId,
      id,
      key: "program",
      value: "dada2",
    });
    expect(valued.bioinformatics.methods.records[0]?.steps[1]?.values.program).toBe("dada2");
    expect(addListItem(start, { list: "methodSteps", methodId: "missing" }).draft).toBe(start);
  });
});

describe("mode changes", () => {
  it("keep what was entered under the other mode", () => {
    const start = createEmptyDraft();
    const recordId = start.project.records[0]?.id ?? "";
    const typed = setRecordValue(start, {
      list: "projects",
      id: recordId,
      key: "project_name",
      value: "Kept",
    });
    const withTable = setSlotTable(typed, { section: "project" }, TABLE);
    const tableMode = applyModeChange(withTable, { target: "project", mode: "table" });
    const back = applyModeChange(tableMode, { target: "project", mode: "manual" });
    expect(back.project.records[0]?.values.project_name).toBe("Kept");
    expect(back.project.table).toBe(TABLE);

    const panelId = start.panel.panels[0]?.id ?? "";
    const genome = applyModeChange(start, { target: "panelGenome", panelId, mode: "manual" });
    expect(genome.panel.panels[0]?.genome.mode).toBe("manual");
    const runName = applyModeChange(
      {
        ...start,
        microhaplotypes: {
          ...start.microhaplotypes,
          runName: { mode: "fixed", fixedName: "r1", column: null },
        },
      },
      { target: "microhaplotypesRunName", mode: "column" },
    );
    expect(runName.microhaplotypes.runName).toEqual({
      mode: "column",
      fixedName: "r1",
      column: null,
    });
  });
});

describe("form values", () => {
  const name = formField(PROJECT_FORM_FIELDS, "project_name");
  const contributors = formField(PROJECT_FORM_FIELDS, "project_contributors");
  const seqDate = SEQUENCING_FORM_FIELDS.find((field) => field.key === "seq_date");

  it("trims, splits lists and checks the schema format", () => {
    expect(readFieldValue(name, "  Study 1 ", "form")).toEqual({ kind: "text", value: "Study 1" });
    expect(readFieldValue(name, "   ", "form")).toEqual({ kind: "blank" });
    expect(readFieldValue(name, "Study#1", "form")).toEqual({
      kind: "invalid",
      message:
        'Project name is "Study#1", but it can only hold letters, numbers, spaces and . _ -.',
    });
    expect(readFieldValue(contributors, "Ann\nBen\n", "form")).toEqual({
      kind: "list",
      value: ["Ann", "Ben"],
    });
    expect(readFieldValue(contributors, "Ann, Ben", "table")).toEqual({
      kind: "list",
      value: ["Ann", "Ben"],
    });
    if (seqDate === undefined) throw new Error("no field");
    expect(readFieldValue(seqDate, "2024-13", "form").kind).toBe("invalid");
    expect(readFieldValue(seqDate, "2024-12-31", "form").kind).toBe("text");
  });

  it("turns pasted lists into one item per line", () => {
    expect(toListText("max, nick ,kathryn", "comma")).toBe("max\nnick\nkathryn");
    expect(splitListValue("a\r\n\r\nb", "form")).toEqual(["a", "b"]);
  });
});

describe("panelContentKey", () => {
  it("is the same for the same data in any key order, and differs for other data", () => {
    const a = { panel_info: [{ panel_name: "P", targets: [0, 1] }], target_info: [{ x: 1 }] };
    const b = { target_info: [{ x: 1 }], panel_info: [{ targets: [0, 1], panel_name: "P" }] };
    expect(panelContentKey(a)).toBe(panelContentKey(b));
    expect(panelContentKey(a)).not.toBe(
      panelContentKey({ ...a, panel_info: [{ panel_name: "Q", targets: [0, 1] }] }),
    );
    expect(panelContentKey(a)).not.toBe(panelContentKey({ ...a, target_info: [{ x: 2 }] }));
  });
});
