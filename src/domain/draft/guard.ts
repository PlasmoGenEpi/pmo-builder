/**
 * Checks that a value loaded from storage is a draft of the current version.
 *
 * Each check below is typed by what it accepts, and `object` requires a check
 * for every key of its type, so the guard cannot drift from the `Draft` type
 * without a compile error.
 */
import type { ColumnMapping, TableFormat } from "@/domain/types";

import {
  GENOME_FORM_FIELDS,
  METHOD_STEP_FORM_FIELDS,
  PROJECT_FORM_FIELDS,
  RUN_FORM_FIELDS,
  SEQUENCING_FORM_FIELDS,
} from "./forms";
import {
  DRAFT_VERSION,
  type BioinformaticsDraft,
  type Draft,
  type FormRecord,
  type GenomeChoice,
  type JsonValue,
  type KeyValueEntry,
  type MappedTable,
  type MethodRecord,
  type PanelEntry,
  type RunNameChoice,
  type RunRecord,
  type SavedPanelChoice,
  type TableRef,
} from "./model";

/** A check of one value. Returns a description of the first problem, or `null`. */
interface Check<T> {
  readonly run: (value: unknown, path: string) => string | null;
  /** Carries the checked type. Never set. */
  readonly checked?: T;
}

function check<T>(run: (value: unknown, path: string) => string | null): Check<T> {
  return { run };
}

const string: Check<string> = check((value, path) =>
  typeof value === "string" ? null : `${path} is not text`,
);

const finiteNumber: Check<number> = check((value, path) =>
  typeof value === "number" && Number.isFinite(value) ? null : `${path} is not a number`,
);

function literal<const T extends string | number>(...allowed: readonly T[]): Check<T> {
  return check((value, path) =>
    allowed.some((item) => item === value) ? null : `${path} is not one of ${allowed.join(", ")}`,
  );
}

/** A key that may be absent. Present, it must pass `inner`. */
function optional<T>(inner: Check<T>): Check<T | undefined> {
  return check((value, path) => (value === undefined ? null : inner.run(value, path)));
}

function nullable<T>(inner: Check<T>): Check<T | null> {
  return check((value, path) => (value === null ? null : inner.run(value, path)));
}

function arrayOf<T>(inner: Check<T>): Check<readonly T[]> {
  return check((value, path) => {
    if (!Array.isArray(value)) return `${path} is not a list`;
    for (const [index, item] of value.entries()) {
      const problem = inner.run(item, `${path}[${index}]`);
      if (problem !== null) return problem;
    }
    return null;
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object<T>(shape: { readonly [K in keyof T]-?: Check<T[K]> }): Check<T> {
  return check((value, path) => {
    if (!isRecord(value)) return `${path} is not an object`;
    for (const key of Object.keys(shape)) {
      const field: Check<unknown> | undefined = Object.getOwnPropertyDescriptor(shape, key)?.value;
      if (field === undefined) continue;
      const problem = field.run(value[key], `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  });
}

function stringRecord<K extends string>(
  keys: readonly { readonly key: K }[],
): Check<Readonly<Record<K, string>>> {
  return check((value, path) => {
    if (!isRecord(value)) return `${path} is not an object`;
    for (const { key } of keys) {
      if (typeof value[key] !== "string") return `${path}.${key} is not text`;
    }
    return null;
  });
}

function mapOfNullableStrings(): Check<Readonly<Record<string, string | null>>> {
  return check((value, path) => {
    if (!isRecord(value)) return `${path} is not an object`;
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && typeof item !== "string") return `${path}.${key} is not text or empty`;
    }
    return null;
  });
}

const json: Check<JsonValue> = check(function run(value, path): string | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number")
    return Number.isFinite(value) ? null : `${path} is not a finite number`;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const problem = run(item, `${path}[${index}]`);
      if (problem !== null) return problem;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const problem = run(item, `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  }
  return `${path} is not JSON`;
});

const tableFormat: Check<TableFormat> = literal("delimited", "xlsx");

const tableRef: Check<TableRef> = object<TableRef>({
  id: string,
  fileName: string,
  fileSize: finiteNumber,
  format: tableFormat,
  sheetNames: nullable(arrayOf(string)),
  sheetName: nullable(string),
  columns: arrayOf(string),
  rowCount: nullable(finiteNumber),
});

const columnMapping: Check<ColumnMapping> = object<ColumnMapping>({
  fields: mapOfNullableStrings(),
  additionalColumns: arrayOf(string),
});

function mapOfStrings(): Check<Readonly<Record<string, string>>> {
  return check((value, path) => {
    if (!isRecord(value)) return `${path} is not an object`;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string") return `${path}.${key} is not text`;
    }
    return null;
  });
}

const mappedTable: Check<MappedTable> = object<MappedTable>({
  table: tableRef,
  mapping: columnMapping,
  confirmedMatches: optional(mapOfStrings()),
});

const optionalTable = nullable(mappedTable);

const keyValue: Check<KeyValueEntry> = object<KeyValueEntry>({
  id: string,
  key: string,
  value: string,
});

function formRecord<K extends string>(keys: readonly { readonly key: K }[]): Check<FormRecord<K>> {
  return object<FormRecord<K>>({
    id: string,
    values: stringRecord(keys),
    extra: arrayOf(keyValue),
  });
}

const runNameChoice: Check<RunNameChoice> = object<RunNameChoice>({
  mode: literal("none", "fixed", "column"),
  fixedName: string,
  column: nullable(string),
});

const genomeChoice: Check<GenomeChoice> = object<GenomeChoice>({
  mode: literal("none", "manual", "table"),
  manual: formRecord(GENOME_FORM_FIELDS),
  table: optionalTable,
});

const savedPanel: Check<SavedPanelChoice> = object<SavedPanelChoice>({
  savedPanelId: string,
  name: string,
  savedAt: string,
  fragment: json,
});

const panelEntry: Check<PanelEntry> = object<PanelEntry>({
  id: string,
  name: string,
  source: literal("table", "saved"),
  table: optionalTable,
  genome: genomeChoice,
  saved: nullable(savedPanel),
});

const entryMode = literal("manual", "table");

const methodRecord: Check<MethodRecord> = object<MethodRecord>({
  id: string,
  name: string,
  steps: arrayOf(formRecord(METHOD_STEP_FORM_FIELDS)),
});

const runRecord: Check<RunRecord> = object<RunRecord>({
  id: string,
  values: stringRecord(RUN_FORM_FIELDS),
  extra: arrayOf(keyValue),
  methodRef: nullable(string),
});

const bioinformatics: Check<BioinformaticsDraft> = object<BioinformaticsDraft>({
  methods: object<BioinformaticsDraft["methods"]>({
    mode: entryMode,
    records: arrayOf(methodRecord),
    table: object<BioinformaticsDraft["methods"]["table"]>({
      table: optionalTable,
      groupColumn: nullable(string),
    }),
  }),
  runs: object<BioinformaticsDraft["runs"]>({
    mode: entryMode,
    records: arrayOf(runRecord),
    table: object<BioinformaticsDraft["runs"]["table"]>({
      table: optionalTable,
      methodMode: literal("same", "column"),
      methodRef: nullable(string),
      methodColumn: nullable(string),
    }),
  }),
});

const draftCheck: Check<Draft> = object<Draft>({
  version: literal(DRAFT_VERSION),
  microhaplotypes: object<Draft["microhaplotypes"]>({
    table: optionalTable,
    runName: runNameChoice,
    representativeColumns: arrayOf(string),
  }),
  panel: object<Draft["panel"]>({ panels: arrayOf(panelEntry) }),
  specimens: object<Draft["specimens"]>({ table: optionalTable }),
  librarySamples: object<Draft["librarySamples"]>({ table: optionalTable }),
  project: object<Draft["project"]>({
    mode: entryMode,
    records: arrayOf(formRecord(PROJECT_FORM_FIELDS)),
    table: optionalTable,
  }),
  sequencing: object<Draft["sequencing"]>({
    mode: entryMode,
    records: arrayOf(formRecord(SEQUENCING_FORM_FIELDS)),
    table: optionalTable,
  }),
  bioinformatics,
  readCounts: object<Draft["readCounts"]>({
    totals: optionalTable,
    byStage: optionalTable,
    runName: runNameChoice,
  }),
});

/** What {@link checkDraft} returns. */
export type DraftCheck =
  | { readonly ok: true; readonly draft: Draft }
  | {
      readonly ok: false;
      /** Says where the value differs from a draft, such as `draft.panel.panels[0].name is not text`. */
      readonly problem: string;
    };

/**
 * Brings a stored draft up to date before it is checked. Drafts saved before
 * confirmed matches were kept with each table get an empty
 * `confirmedMatches` on every table. Returns the value unchanged when there
 * is nothing to do; never changes its input.
 */
export function migrateDraft(value: unknown): unknown {
  return addConfirmedMatches(value);
}

/** Whether a value looks like a stored `MappedTable`: a table reference and a mapping. */
function looksMapped(value: Readonly<Record<string, unknown>>): boolean {
  return isRecord(value["table"]) && isRecord(value["mapping"]) && "fields" in value["mapping"];
}

function addConfirmedMatches(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    const next = items.map(addConfirmedMatches);
    return next.some((item, index) => item !== items[index]) ? next : value;
  }
  if (!isRecord(value)) return value;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const migrated = addConfirmedMatches(item);
    if (migrated !== item) changed = true;
    next[key] = migrated;
  }
  if (looksMapped(value) && value["confirmedMatches"] === undefined) {
    next["confirmedMatches"] = {};
    changed = true;
  }
  return changed ? next : value;
}

/** Whether a value is a draft of the current version. */
export function isDraft(value: unknown): value is Draft {
  return draftCheck.run(value, "draft") === null;
}

/**
 * Checks a value loaded from storage, after {@link migrateDraft}. A draft of
 * another version is rejected with a problem that says so.
 */
export function checkDraft(value: unknown): DraftCheck {
  if (
    isRecord(value) &&
    value["version"] !== DRAFT_VERSION &&
    typeof value["version"] === "number"
  ) {
    return {
      ok: false,
      problem: `The saved draft is version ${value["version"]}; this app reads version ${DRAFT_VERSION}.`,
    };
  }
  const migrated = migrateDraft(value);
  if (isDraft(migrated)) return { ok: true, draft: migrated };
  return {
    ok: false,
    problem: draftCheck.run(migrated, "draft") ?? "The saved draft is not readable.",
  };
}
