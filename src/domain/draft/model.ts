/**
 * The draft: everything the user has entered, and nothing computed from it.
 *
 * A draft is plain JSON. It is saved to the browser as the user works and
 * crosses the worker boundary on every build. Imported files are referenced
 * by id with light metadata ({@link TableRef}); their bytes and parsed rows
 * live elsewhere (IndexedDB and the engine).
 *
 * Where a section has modes (typed by hand or imported, a fixed run name or a
 * column), the draft keeps the data of every mode and a `mode` field that
 * says which one is used. Switching mode never discards what was typed.
 */
import type { ColumnMapping, TableFormat } from "@/domain/types";

import type {
  GenomeFieldKey,
  MethodStepFieldKey,
  ProjectFieldKey,
  RunFieldKey,
  SequencingFieldKey,
} from "./forms";
import {
  GENOME_FORM_FIELDS,
  METHOD_STEP_FORM_FIELDS,
  PROJECT_FORM_FIELDS,
  RUN_FORM_FIELDS,
  SEQUENCING_FORM_FIELDS,
} from "./forms";

/** The current draft format. A stored draft of another version is not loaded. */
export const DRAFT_VERSION = 1;

/** Any JSON value. Used for saved panel fragments, which are kept as they were built. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** An imported file, as the draft refers to it. The bytes and rows are kept elsewhere, by `id`. */
export interface TableRef {
  /** Stable id of the imported file. Keys its bytes in storage and its rows in the engine. */
  readonly id: string;
  readonly fileName: string;
  /** Size of the original file in bytes. */
  readonly fileSize: number;
  readonly format: TableFormat;
  /** Every sheet of a workbook, or `null` for delimited files. */
  readonly sheetNames: readonly string[] | null;
  /** The sheet in use, or `null` for delimited files. */
  readonly sheetName: string | null;
  /** Column names in file order. */
  readonly columns: readonly string[];
  readonly rowCount: number;
}

/** An imported table and the user's choice of which column feeds which field. */
export interface MappedTable {
  readonly table: TableRef;
  readonly mapping: ColumnMapping;
  /**
   * Matches made from a similar column name that the user confirmed: field
   * key to the column confirmed for it. A match is confirmed only while the
   * field still has that column. Absent in tables made before this was kept
   * (a stored draft gets `{}` when it is loaded); absent means none.
   */
  readonly confirmedMatches?: Readonly<Record<string, string>>;
}

/** Whether the user confirmed `column` for the field `fieldKey` of a table. */
export function isMatchConfirmed(mapped: MappedTable, fieldKey: string, column: string): boolean {
  return mapped.confirmedMatches?.[fieldKey] === column;
}

/** The mapped fields of a mapping: field key to column, without the unmapped ones. */
export function mappedColumns(mapped: MappedTable): Record<string, string> {
  const columns: Record<string, string> = {};
  for (const [key, column] of Object.entries(mapped.mapping.fields)) {
    if (column !== null && column !== "") columns[key] = column;
  }
  return columns;
}

/** How a bioinformatics run name is given for a whole table. */
export type RunNameMode = "none" | "fixed" | "column";

/**
 * A run name for a table: none, one name for every row, or the values of a
 * column. Both the fixed name and the column are kept when the mode changes.
 */
export interface RunNameChoice {
  readonly mode: RunNameMode;
  /** Used when `mode` is `fixed`. */
  readonly fixedName: string;
  /** Used when `mode` is `column`. */
  readonly column: string | null;
}

/** A free key and value added to a hand-entered record. Written into the PMO under `key`. */
export interface KeyValueEntry {
  readonly id: string;
  readonly key: string;
  readonly value: string;
}

/**
 * One hand-entered record. Values are kept exactly as typed, as text; list
 * values hold one item per line. Blank values are dropped at build time.
 */
export interface FormRecord<K extends string> {
  readonly id: string;
  readonly values: Readonly<Record<K, string>>;
  /** Extra fields the schema does not name. */
  readonly extra: readonly KeyValueEntry[];
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** The allele table: one row per sample, target and microhaplotype. Required. */
export interface MicrohaplotypesDraft {
  readonly table: MappedTable | null;
  readonly runName: RunNameChoice;
  /**
   * Columns copied onto each representative microhaplotype. The mapping's
   * `additionalColumns` are copied onto each detected microhaplotype.
   */
  readonly representativeColumns: readonly string[];
}

/** Where a panel comes from. */
export type PanelSourceMode = "table" | "saved";

/** Whether a panel has genome information, and how it is given. */
export type GenomeMode = "none" | "manual" | "table";

/** A panel's reference genome. The typed values and the table are both kept when the mode changes. */
export interface GenomeChoice {
  readonly mode: GenomeMode;
  readonly manual: FormRecord<GenomeFieldKey>;
  /** One genome per row. */
  readonly table: MappedTable | null;
}

/**
 * A panel taken from the saved-panel library. The built fragment is copied
 * into the draft, so the draft still builds if the saved panel is deleted.
 */
export interface SavedPanelChoice {
  readonly savedPanelId: string;
  readonly name: string;
  /** ISO 8601 time the panel was saved. */
  readonly savedAt: string;
  /** The panel fragment as `panelInfoTableToPmo` built it. Checked again at build time. */
  readonly fragment: JsonValue;
}

/** One panel of the panel section. */
export interface PanelEntry {
  readonly id: string;
  /** The panel name written into the PMO. Used when `source` is `table`. */
  readonly name: string;
  readonly source: PanelSourceMode;
  /** The target table: one row per target. Used when `source` is `table`. */
  readonly table: MappedTable | null;
  /** Used when `source` is `table`. */
  readonly genome: GenomeChoice;
  /** Used when `source` is `saved`. */
  readonly saved: SavedPanelChoice | null;
}

/** The panel section: one or more panels, merged when there are several. Required. */
export interface PanelDraft {
  readonly panels: readonly PanelEntry[];
}

/** A section that is one imported table: specimens or library samples. */
export interface TableSectionDraft {
  readonly table: MappedTable | null;
}

/** Whether a section is typed in by hand or imported from a table. */
export type EntryMode = "manual" | "table";

/** A hand-entered project. */
export type ProjectRecord = FormRecord<ProjectFieldKey>;

/** The project section: projects typed in, or a table with one project per row. */
export interface ProjectDraft {
  readonly mode: EntryMode;
  readonly records: readonly ProjectRecord[];
  readonly table: MappedTable | null;
}

/** A hand-entered sequencing run. */
export type SequencingRecord = FormRecord<SequencingFieldKey>;

/** The sequencing section: sequencing runs typed in, or a table with one run per row. */
export interface SequencingDraft {
  readonly mode: EntryMode;
  readonly records: readonly SequencingRecord[];
  readonly table: MappedTable | null;
}

/** One step of a bioinformatics method: a program and how it was run. */
export type MethodStepRecord = FormRecord<MethodStepFieldKey>;

/** A bioinformatics method typed in by hand: a name and its steps. */
export interface MethodRecord {
  readonly id: string;
  /** Written as `bioinformatics_method_name` when not blank. */
  readonly name: string;
  readonly steps: readonly MethodStepRecord[];
}

/** Methods imported from a table: one step per row. */
export interface MethodTableDraft {
  readonly table: MappedTable | null;
  /** A column whose values split the rows into methods, one per value. `null` makes one method. */
  readonly groupColumn: string | null;
}

/** A bioinformatics run typed in by hand. */
export interface RunRecord extends FormRecord<RunFieldKey> {
  /**
   * The method this run used: a `MethodRecord` id when methods are typed in,
   * or a method key from the bioinformatics summary when they are imported.
   * `null` picks the only method when there is exactly one.
   */
  readonly methodRef: string | null;
}

/** How imported runs say which method they used. */
export type RunMethodMode = "same" | "column";

/** Runs imported from a table: one run per row. */
export interface RunTableDraft {
  readonly table: MappedTable | null;
  readonly methodMode: RunMethodMode;
  /** The method of every run, when `methodMode` is `same`. Same meaning as `RunRecord.methodRef`. */
  readonly methodRef: string | null;
  /** A column holding each run's method name, when `methodMode` is `column`. */
  readonly methodColumn: string | null;
}

/** The bioinformatics section: methods and the runs that used them. */
export interface BioinformaticsDraft {
  readonly methods: {
    readonly mode: EntryMode;
    readonly records: readonly MethodRecord[];
    readonly table: MethodTableDraft;
  };
  readonly runs: {
    readonly mode: EntryMode;
    readonly records: readonly RunRecord[];
    readonly table: RunTableDraft;
  };
}

/** Read counts: total reads per sample and, optionally, reads per sample, target and stage. */
export interface ReadCountsDraft {
  /** One row per library sample. Needed whenever this section is used. */
  readonly totals: MappedTable | null;
  /** One row per library sample, target and pipeline stage. */
  readonly byStage: MappedTable | null;
  /** The run name. A column must be in the totals table. */
  readonly runName: RunNameChoice;
}

/** Everything the user has entered, by section. Keys are `SectionId`s. */
export interface Draft {
  readonly version: typeof DRAFT_VERSION;
  readonly microhaplotypes: MicrohaplotypesDraft;
  readonly panel: PanelDraft;
  readonly specimens: TableSectionDraft;
  readonly librarySamples: TableSectionDraft;
  readonly project: ProjectDraft;
  readonly sequencing: SequencingDraft;
  readonly bioinformatics: BioinformaticsDraft;
  readonly readCounts: ReadCountsDraft;
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * A new random id. Uses `crypto.randomUUID` where the browser offers it (it
 * needs a secure context) and falls back to random digits otherwise.
 */
export function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function hasEveryKey<K extends string>(
  values: Partial<Record<K, string>>,
  fields: readonly { readonly key: K }[],
): values is Record<K, string> {
  return fields.every((field) => typeof values[field.key] === "string");
}

/** Values for every field of a form, blank unless given. */
function fromPartial<K extends string>(
  values: Partial<Record<K, string>>,
  fields: readonly { readonly key: K }[],
): Record<K, string> {
  const result: Partial<Record<K, string>> = {};
  for (const field of fields) result[field.key] = values[field.key] ?? "";
  if (!hasEveryKey(result, fields)) throw new Error("A form value is missing");
  return result;
}

/** A blank project record. */
export function createProjectRecord(
  values: Partial<Record<ProjectFieldKey, string>> = {},
): ProjectRecord {
  return { id: newId(), values: fromPartial(values, PROJECT_FORM_FIELDS), extra: [] };
}

/** A blank sequencing record. */
export function createSequencingRecord(
  values: Partial<Record<SequencingFieldKey, string>> = {},
): SequencingRecord {
  return { id: newId(), values: fromPartial(values, SEQUENCING_FORM_FIELDS), extra: [] };
}

/** A blank method step. */
export function createMethodStep(
  values: Partial<Record<MethodStepFieldKey, string>> = {},
): MethodStepRecord {
  return { id: newId(), values: fromPartial(values, METHOD_STEP_FORM_FIELDS), extra: [] };
}

/** A method with one blank step. */
export function createMethodRecord(name = ""): MethodRecord {
  return { id: newId(), name, steps: [createMethodStep()] };
}

/** A blank run record. */
export function createRunRecord(
  values: Partial<Record<RunFieldKey, string>> = {},
  methodRef: string | null = null,
): RunRecord {
  return { id: newId(), values: fromPartial(values, RUN_FORM_FIELDS), extra: [], methodRef };
}

/** A blank free key and value. */
export function createKeyValue(key = "", value = ""): KeyValueEntry {
  return { id: newId(), key, value };
}

/** A blank genome choice, set to no genome. */
export function createGenomeChoice(): GenomeChoice {
  return {
    mode: "none",
    manual: { id: newId(), values: fromPartial({}, GENOME_FORM_FIELDS), extra: [] },
    table: null,
  };
}

/** A new panel, to be filled from a target table. */
export function createPanelEntry(name = ""): PanelEntry {
  return {
    id: newId(),
    name,
    source: "table",
    table: null,
    genome: createGenomeChoice(),
    saved: null,
  };
}

/** A run name choice set to none. */
export function createRunNameChoice(): RunNameChoice {
  return { mode: "none", fixedName: "", column: null };
}

/**
 * A draft with nothing entered. The panel section starts with one empty
 * panel, and the hand-entered sections with one blank record each, so a page
 * has a form to show. Blank records do not count as entered.
 */
export function createEmptyDraft(): Draft {
  return {
    version: DRAFT_VERSION,
    microhaplotypes: { table: null, runName: createRunNameChoice(), representativeColumns: [] },
    panel: { panels: [createPanelEntry()] },
    specimens: { table: null },
    librarySamples: { table: null },
    project: { mode: "manual", records: [createProjectRecord()], table: null },
    sequencing: { mode: "manual", records: [createSequencingRecord()], table: null },
    bioinformatics: {
      methods: {
        mode: "manual",
        records: [createMethodRecord()],
        table: { table: null, groupColumn: null },
      },
      runs: {
        mode: "manual",
        records: [createRunRecord()],
        table: { table: null, methodMode: "same", methodRef: null, methodColumn: null },
      },
    },
    readCounts: { totals: null, byStage: null, runName: createRunNameChoice() },
  };
}

/** True when every value of a record, and every extra entry, is blank. */
export function isBlankRecord<K extends string>(record: FormRecord<K>): boolean {
  const valuesBlank = Object.values<string>(record.values).every((value) => value.trim() === "");
  const extraBlank = record.extra.every(
    (entry) => entry.key.trim() === "" && entry.value.trim() === "",
  );
  return valuesBlank && extraBlank;
}

/** An error's message, for logs and debugging. Not for the screen: it is not translated. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Marks the end of an exhaustive `switch`. The compiler checks that `value`
 * is `never`; reaching it at run time means a value came from outside the types.
 */
export function unreachable(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

/** Whether a value is plain JSON: no `undefined`, functions, non-finite numbers or class instances. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every(isJsonValue);
}

/** A JSON copy of a value (via `JSON.stringify`), or `null` when it cannot be written as JSON. */
export function toJsonValue(value: unknown): JsonValue | null {
  try {
    const copy: unknown = JSON.parse(JSON.stringify(value) ?? "null");
    return isJsonValue(copy) ? copy : null;
  } catch {
    return null;
  }
}

/**
 * Whether a value is a Blob. Also accepts a Blob from another realm (an
 * iframe, or a test environment's IndexedDB), which `instanceof` rejects.
 */
export function isBlob(value: unknown): value is Blob {
  if (value instanceof Blob) return true;
  if (typeof value !== "object" || value === null) return false;
  return (
    (Object.prototype.toString.call(value) === "[object Blob]" ||
      Object.prototype.toString.call(value) === "[object File]") &&
    "size" in value &&
    typeof value.size === "number" &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}
