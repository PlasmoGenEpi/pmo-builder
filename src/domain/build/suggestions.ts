/**
 * Values that one section can offer another: names found in the imported
 * tables, read straight from their mapped columns so they are there even
 * while a section has errors.
 *
 * This module must not import pmotools-ts at run time: the main thread
 * imports {@link NO_SUGGESTIONS} from it directly.
 */
import { mappedColumns, type Draft, type MappedTable } from "@/domain/draft";
import type { RawTable } from "@/domain/types";

import type { TableLookup } from "./context";

/** Names to suggest on other steps. Each list is in table order, without repeats. */
export interface Suggestions {
  /** Panel names in the library sample table, for naming a panel. */
  readonly panelNames: readonly string[];
  /** Sequencing run names in the library sample table, for the Sequencing step. */
  readonly sequencingNames: readonly string[];
  /** Project names in the specimen table, for the Project step. */
  readonly projectNames: readonly string[];
  /** Run names in the allele table, for the bioinformatics runs. */
  readonly runNames: readonly string[];
}

/** No suggestions. */
export const NO_SUGGESTIONS: Suggestions = {
  panelNames: [],
  sequencingNames: [],
  projectNames: [],
  runNames: [],
};

/** What {@link distinctValues} returns. */
export interface DistinctValues {
  /** Distinct non-blank values, trimmed, in order of first appearance. */
  readonly values: readonly string[];
  /** True when there were more than `limit` values. */
  readonly truncated: boolean;
}

/** The distinct non-blank values of one column, up to `limit`. */
export function distinctValues(table: RawTable, column: string, limit = 200): DistinctValues {
  const seen = new Set<string>();
  for (const row of table.rows) {
    const value = (row[column] ?? "").trim();
    if (value === "" || seen.has(value)) continue;
    if (seen.size >= limit) return { values: [...seen], truncated: true };
    seen.add(value);
  }
  return { values: [...seen], truncated: false };
}

function columnValues(tables: TableLookup, mapped: MappedTable | null, fieldKey: string): string[] {
  if (mapped === null) return [];
  const column = mappedColumns(mapped)[fieldKey];
  if (column === undefined) return [];
  const lookup = tables(mapped.table.id);
  if (lookup.kind !== "ready" || !lookup.table.columns.includes(column)) return [];
  return [...distinctValues(lookup.table, column).values];
}

/** Collects the suggestions one draft offers. */
export function collectSuggestions(draft: Draft, tables: TableLookup): Suggestions {
  const mhap = draft.microhaplotypes;
  let runNames: string[] = [];
  if (mhap.runName.mode === "fixed" && mhap.runName.fixedName.trim() !== "") {
    runNames = [mhap.runName.fixedName.trim()];
  } else if (
    mhap.runName.mode === "column" &&
    mhap.runName.column !== null &&
    mhap.table !== null
  ) {
    const lookup = tables(mhap.table.table.id);
    if (lookup.kind === "ready" && lookup.table.columns.includes(mhap.runName.column)) {
      runNames = [...distinctValues(lookup.table, mhap.runName.column).values];
    }
  }
  return {
    panelNames: columnValues(tables, draft.librarySamples.table, "panelName"),
    sequencingNames: columnValues(tables, draft.librarySamples.table, "sequencingInfoName"),
    projectNames: columnValues(tables, draft.specimens.table, "projectName"),
    runNames,
  };
}
