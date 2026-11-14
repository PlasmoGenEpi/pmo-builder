/**
 * Table slots: every place in a draft that holds an imported table, with the
 * field set its columns are mapped to.
 */
import type { ColumnMapping, FieldSetId, SectionId } from "@/domain/types";

import type { Draft, MappedTable, PanelEntry } from "./model";
import { unreachable } from "./model";

/** One place in the draft that holds an imported table. */
export type TableSlot =
  | { readonly section: "microhaplotypes" }
  | { readonly section: "panel"; readonly panelId: string; readonly part: "targets" | "genome" }
  | { readonly section: "specimens" }
  | { readonly section: "librarySamples" }
  | { readonly section: "project" }
  | { readonly section: "sequencing" }
  | { readonly section: "bioinformatics"; readonly part: "methods" | "runs" }
  | { readonly section: "readCounts"; readonly part: "totals" | "byStage" };

/** The field set a slot's columns are mapped to. */
export function fieldSetForSlot(slot: TableSlot): FieldSetId {
  switch (slot.section) {
    case "microhaplotypes":
      return "microhaplotypes";
    case "panel":
      return slot.part === "targets" ? "panelTargets" : "genomes";
    case "specimens":
      return "specimens";
    case "librarySamples":
      return "librarySamples";
    case "project":
      return "project";
    case "sequencing":
      return "sequencing";
    case "bioinformatics":
      return slot.part === "methods" ? "bioinformaticsMethods" : "bioinformaticsRuns";
    case "readCounts":
      return slot.part === "totals" ? "readCountTotals" : "readCountsByStage";
    default:
      return unreachable(slot);
  }
}

/** A string that identifies a slot, for use as a React key or a map key. */
export function slotKey(slot: TableSlot): string {
  switch (slot.section) {
    case "panel":
      return `panel:${slot.panelId}:${slot.part}`;
    case "bioinformatics":
    case "readCounts":
      return `${slot.section}:${slot.part}`;
    case "microhaplotypes":
    case "specimens":
    case "librarySamples":
    case "project":
    case "sequencing":
      return slot.section;
    default:
      return unreachable(slot);
  }
}

function findPanel(draft: Draft, panelId: string): PanelEntry | undefined {
  return draft.panel.panels.find((panel) => panel.id === panelId);
}

/** Whether the slot exists in the draft. A panel slot disappears when its panel is removed. */
export function slotExists(draft: Draft, slot: TableSlot): boolean {
  return slot.section !== "panel" || findPanel(draft, slot.panelId) !== undefined;
}

/** The table in a slot, or `null` when the slot is empty or no longer exists. */
export function getSlotTable(draft: Draft, slot: TableSlot): MappedTable | null {
  switch (slot.section) {
    case "microhaplotypes":
      return draft.microhaplotypes.table;
    case "panel": {
      const panel = findPanel(draft, slot.panelId);
      if (panel === undefined) return null;
      return slot.part === "targets" ? panel.table : panel.genome.table;
    }
    case "specimens":
      return draft.specimens.table;
    case "librarySamples":
      return draft.librarySamples.table;
    case "project":
      return draft.project.table;
    case "sequencing":
      return draft.sequencing.table;
    case "bioinformatics":
      return slot.part === "methods"
        ? draft.bioinformatics.methods.table.table
        : draft.bioinformatics.runs.table.table;
    case "readCounts":
      return slot.part === "totals" ? draft.readCounts.totals : draft.readCounts.byStage;
    default:
      return unreachable(slot);
  }
}

/**
 * Puts a table in a slot, or empties it with `null`. Returns a new draft; a
 * panel slot whose panel no longer exists leaves the draft as it is.
 */
export function setSlotTable(draft: Draft, slot: TableSlot, table: MappedTable | null): Draft {
  switch (slot.section) {
    case "microhaplotypes":
      return { ...draft, microhaplotypes: { ...draft.microhaplotypes, table } };
    case "panel":
      return {
        ...draft,
        panel: {
          panels: draft.panel.panels.map((panel) => {
            if (panel.id !== slot.panelId) return panel;
            return slot.part === "targets"
              ? { ...panel, table }
              : { ...panel, genome: { ...panel.genome, table } };
          }),
        },
      };
    case "specimens":
      return { ...draft, specimens: { table } };
    case "librarySamples":
      return { ...draft, librarySamples: { table } };
    case "project":
      return { ...draft, project: { ...draft.project, table } };
    case "sequencing":
      return { ...draft, sequencing: { ...draft.sequencing, table } };
    case "bioinformatics": {
      const bio = draft.bioinformatics;
      if (slot.part === "methods") {
        return {
          ...draft,
          bioinformatics: {
            ...bio,
            methods: { ...bio.methods, table: { ...bio.methods.table, table } },
          },
        };
      }
      return {
        ...draft,
        bioinformatics: { ...bio, runs: { ...bio.runs, table: { ...bio.runs.table, table } } },
      };
    }
    case "readCounts":
      return slot.part === "totals"
        ? { ...draft, readCounts: { ...draft.readCounts, totals: table } }
        : { ...draft, readCounts: { ...draft.readCounts, byStage: table } };
    default:
      return unreachable(slot);
  }
}

/** Replaces the mapping of the table in a slot. Does nothing when the slot is empty. */
export function setSlotMapping(draft: Draft, slot: TableSlot, mapping: ColumnMapping): Draft {
  const current = getSlotTable(draft, slot);
  if (current === null) return draft;
  return setSlotTable(draft, slot, { ...current, mapping });
}

/**
 * Records that the user confirmed `column` for `fieldKey` in the table of a
 * slot. Does nothing when the slot is empty or already says so.
 */
export function confirmSlotMatch(
  draft: Draft,
  slot: TableSlot,
  confirmation: { readonly fieldKey: string; readonly column: string },
): Draft {
  const current = getSlotTable(draft, slot);
  if (current === null) return draft;
  if (current.confirmedMatches?.[confirmation.fieldKey] === confirmation.column) return draft;
  return setSlotTable(draft, slot, {
    ...current,
    confirmedMatches: { ...current.confirmedMatches, [confirmation.fieldKey]: confirmation.column },
  });
}

/** One filled slot of a draft. */
export interface FilledSlot {
  readonly slot: TableSlot;
  readonly table: MappedTable;
}

/** Every slot of the draft, filled or not, in section order. */
export function listSlots(draft: Draft): TableSlot[] {
  return [
    { section: "microhaplotypes" },
    ...draft.panel.panels.flatMap((panel): TableSlot[] => [
      { section: "panel", panelId: panel.id, part: "targets" },
      { section: "panel", panelId: panel.id, part: "genome" },
    ]),
    { section: "specimens" },
    { section: "librarySamples" },
    { section: "project" },
    { section: "sequencing" },
    { section: "bioinformatics", part: "methods" },
    { section: "bioinformatics", part: "runs" },
    { section: "readCounts", part: "totals" },
    { section: "readCounts", part: "byStage" },
  ];
}

/** Every slot that holds a table, with its table. */
export function listFilledSlots(draft: Draft): FilledSlot[] {
  return listSlots(draft).flatMap((slot) => {
    const table = getSlotTable(draft, slot);
    return table === null ? [] : [{ slot, table }];
  });
}

/** Ids of every table the draft refers to. */
export function referencedTableIds(draft: Draft): string[] {
  return [...new Set(listFilledSlots(draft).map((filled) => filled.table.table.id))];
}

/** Ids of the tables one section refers to. */
export function sectionTableIds(draft: Draft, section: SectionId): string[] {
  return listFilledSlots(draft)
    .filter((filled) => filled.slot.section === section)
    .map((filled) => filled.table.table.id);
}
