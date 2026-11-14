/**
 * What every section build needs from outside the draft: the raw tables, and
 * the import, field and matching functions (injectable for tests).
 */
import { getFieldSet } from "@/domain/fields";
import { typeTable } from "@/domain/import";
import { checkMapping } from "@/domain/matching";
import type { FieldSetId, FieldSetSpec, RawTable } from "@/domain/types";

/** The functions a build borrows from the import, fields and matching modules. */
export interface BuildDeps {
  readonly getFieldSet: (id: FieldSetId) => FieldSetSpec;
  readonly checkMapping: typeof checkMapping;
  readonly typeTable: typeof typeTable;
}

/** The real import, fields and matching functions. */
export const DEFAULT_BUILD_DEPS: BuildDeps = { getFieldSet, checkMapping, typeTable };

/** What looking up an imported table by id gives. */
export type TableLookupResult =
  | { readonly kind: "ready"; readonly table: RawTable }
  /** The file is not loaded: its bytes were not kept, or it was never imported here. */
  | { readonly kind: "missing" }
  /** The file is there but could not be read again. */
  | { readonly kind: "failed"; readonly message: string };

/** Finds an imported table by id. */
export type TableLookup = (tableId: string) => TableLookupResult;

/** Everything a section build needs besides its part of the draft. */
export interface BuildContext {
  readonly tables: TableLookup;
  readonly deps: BuildDeps;
}

/** A context over a fixed set of tables, with the real dependencies unless others are given. */
export function createBuildContext(
  tables: ReadonlyMap<string, RawTable> | TableLookup,
  deps: BuildDeps = DEFAULT_BUILD_DEPS,
): BuildContext {
  if (typeof tables === "function") return { tables, deps };
  return {
    tables: (id) => {
      const table = tables.get(id);
      return table === undefined ? { kind: "missing" } : { kind: "ready", table };
    },
    deps,
  };
}
