/**
 * Hand-entered records, and tables of the same records: project, sequencing,
 * genomes, bioinformatics steps and runs.
 *
 * A table row is turned into the same values a form holds, so both are
 * checked by one function: required fields, schema formats, blanks dropped.
 */
import { plural, t } from "@lingui/core/macro";
import type { ProjectInfo, SequencingInfo } from "pmotools-ts";

import {
  PROJECT_FORM_FIELDS,
  SEQUENCING_FORM_FIELDS,
  isBlankRecord,
  readFieldValue,
  type FormFieldSpec,
  type FormRecord,
  type KeyValueEntry,
  type MappedTable,
  type ValueOrigin,
  mappedColumns,
} from "@/domain/draft";
import type { FieldSetId, Notice, RawTable, SectionId, SectionStatus } from "@/domain/types";

import type { BuildContext } from "./context";
import { listItems, makeNotice, quoteItems, quoteLabel } from "./notices";
import {
  notReady,
  ready,
  type SectionFragments,
  type SectionResult,
  type SectionSummaries,
} from "./results";
import { checkTable } from "./table";

/** A record's values as written into the PMO: text, a list of text, or a list of whole numbers. */
export type RecordValue = string | readonly string[] | readonly number[];

/** One record ready to be written: its checked values, and where it came from for messages. */
export interface CheckedRecord<K extends string, E extends EnteredRecord<K> = EnteredRecord<K>> {
  /** "Project 2" or "row 5", for messages. */
  readonly label: string;
  readonly values: ReadonlyMap<K, RecordValue>;
  /** Extra fields: key to value, blanks dropped. */
  readonly extra: Readonly<Record<string, string>>;
  /**
   * The record as entered. Checking drops records with nothing to write, so
   * read anything else about a record (a run's method, a table row) from
   * here, never by position.
   */
  readonly source: E;
}

/** What checking a set of records found. */
export interface RecordCheck<K extends string, E extends EnteredRecord<K> = EnteredRecord<K>> {
  readonly status: SectionStatus;
  readonly records: readonly CheckedRecord<K, E>[];
  readonly notices: readonly Notice[];
}

/** A record as entered, before checking: from a form or a table row. */
export interface EnteredRecord<K extends string> {
  readonly label: string;
  readonly values: Readonly<Partial<Record<K, string | null>>>;
  readonly extra: readonly Pick<KeyValueEntry, "key" | "value">[];
  readonly origin: ValueOrigin;
}

/**
 * Checks entered records against their fields. Blank records are dropped.
 * A blank required field makes the result `incomplete`; a value in the wrong
 * format, or an extra field that repeats a field name, makes it `error`.
 */
export function checkRecords<K extends string, E extends EnteredRecord<K>>(
  fields: readonly FormFieldSpec<K>[],
  entered: readonly E[],
): RecordCheck<K, E> {
  const records: CheckedRecord<K, E>[] = [];
  const notices: Notice[] = [];
  let missing = false;
  let invalid = false;
  for (const record of entered) {
    const values = new Map<K, RecordValue>();
    const blanks: string[] = [];
    const problems: string[] = [];
    for (const field of fields) {
      const value = readFieldValue(field, record.values[field.key], record.origin);
      switch (value.kind) {
        case "blank":
          if (field.required) blanks.push(quoteLabel(field.label));
          break;
        case "invalid":
          problems.push(value.message);
          break;
        case "text":
        case "list":
        case "integers":
          values.set(field.key, value.value);
          break;
      }
    }
    const extra: Record<string, string> = {};
    const fieldKeys = new Set<string>(fields.map((field) => field.key));
    for (const entry of record.extra) {
      const key = entry.key.trim();
      const value = entry.value.trim();
      if (key === "" && value === "") continue;
      if (key === "") {
        problems.push(t`An extra field with the value "${value}" has no name.`);
      } else if (fieldKeys.has(key)) {
        problems.push(
          t`The extra field "${key}" has the same name as a field above. Fill in that field instead.`,
        );
      } else if (value !== "") {
        extra[key] = value;
      }
    }
    if (values.size === 0 && Object.keys(extra).length === 0 && problems.length === 0) continue;
    const label = record.label;
    if (blanks.length > 0) {
      missing = true;
      const fieldList = listItems(blanks);
      notices.push(
        makeNotice(
          "error",
          "form/missing-required",
          t({
            message: `${label}: fill in ${fieldList}.`,
            comment:
              "{label} names a record, such as 'Project 2' or 'Row 5'. {fieldList} is a list of quoted field labels, such as '“Project name” and “Description”'.",
          }),
        ),
      );
    }
    for (const problem of problems) {
      invalid = true;
      notices.push(
        makeNotice(
          "error",
          "form/invalid-value",
          t({
            message: `${label}: ${problem}`,
            comment:
              "{label} names a record, such as 'Project 2' or 'Row 5'. {problem} is a translated message about one of its values.",
          }),
        ),
      );
    }
    records.push({ label: record.label, values, extra, source: record });
  }
  const status: SectionStatus = invalid
    ? "error"
    : missing
      ? "incomplete"
      : records.length > 0
        ? "ready"
        : "empty";
  return { status, records, notices };
}

/** A form record as entered, with the form record it came from. */
export interface FormEntry<K extends string, R extends FormRecord<K>> extends EnteredRecord<K> {
  readonly form: R;
}

/** A table row as entered, with its index among the table's rows. */
export interface TableEntry<K extends string> extends EnteredRecord<K> {
  readonly rowIndex: number;
}

/**
 * Form records as entered records. Blank records are left out. `label`
 * names a record for messages from its position, counting from 1, such as
 * "Project 2".
 */
export function fromForms<K extends string, R extends FormRecord<K>>(
  records: readonly R[],
  label: (position: number) => string,
): FormEntry<K, R>[] {
  return records
    .filter((record) => !isBlankRecord(record))
    .map((record, index) => ({
      label: label(index + 1),
      values: record.values,
      extra: record.extra,
      origin: "form",
      form: record,
    }));
}

/** Table rows as entered records: mapped columns become fields, extra columns become extra fields. */
export function fromTable<K extends string>(
  fields: readonly FormFieldSpec<K>[],
  raw: RawTable,
  mapped: MappedTable,
): TableEntry<K>[] {
  const columns = mappedColumns(mapped);
  return raw.rows.map((row, index) => {
    const values: Partial<Record<K, string | null>> = {};
    for (const field of fields) {
      const column = columns[field.key];
      if (column !== undefined) values[field.key] = row[column] ?? null;
    }
    const extra = mapped.mapping.additionalColumns.map((column) => ({
      key: column,
      value: row[column] ?? "",
    }));
    return {
      label: rowLabel(index),
      values,
      extra,
      origin: "table",
      rowIndex: index,
    };
  });
}

/** "Row 5", naming a table row in messages, from its 0-based data row index. */
export function rowLabel(index: number): string {
  const row = index + 2;
  return t({
    message: `Row ${row}`,
    comment: "A spreadsheet row, starting a message about it, such as 'Row 5: fill in “Program”.'",
  });
}

/** Copies a checked record's values and extra fields onto a PMO record. */
export function writeRecord<K extends string>(
  target: Record<string, unknown>,
  record: CheckedRecord<K>,
): void {
  for (const [key, value] of record.values) target[key] = value;
  for (const [key, value] of Object.entries(record.extra)) target[key] = value;
}

/** A required text value, which `checkRecords` has made sure is present. */
export function requiredText<K extends string>(record: CheckedRecord<K>, key: K): string {
  const value = record.values.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Notices for names that appear more than once among records. `message`
 * words the notice from the quoted names and how many there are.
 */
export function duplicateNameNotices(
  names: readonly string[],
  message: (repeatedNames: string, count: number) => string,
): Notice[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) repeated.add(name);
    seen.add(name);
  }
  if (repeated.size === 0) return [];
  return [
    makeNotice("error", "form/duplicate-name", message(quoteItems([...repeated]), repeated.size)),
  ];
}

/** What reading a section's records, by hand or from a table, gives. */
export type EnteredRecords<K extends string> =
  | { readonly kind: "records"; readonly records: readonly TableEntry<K>[] }
  | {
      readonly kind: "blocked";
      readonly status: Extract<SectionStatus, "empty" | "incomplete" | "error">;
      readonly notices: readonly Notice[];
    };

/** Reads the records of a section in table mode: checks the mapping, then turns rows into records. */
export function enteredFromTable<K extends string>(
  input: {
    readonly fields: readonly FormFieldSpec<K>[];
    readonly mapped: MappedTable | null;
    readonly fieldSetId: FieldSetId;
    readonly tableLabel: string;
  },
  context: BuildContext,
): EnteredRecords<K> {
  if (input.mapped === null) return { kind: "blocked", status: "empty", notices: [] };
  // Rows are read as text, so the table is only checked, not typed.
  const prepared = checkTable(
    { mapped: input.mapped, fieldSetId: input.fieldSetId, tableLabel: input.tableLabel },
    context,
  );
  if (prepared.kind === "blocked")
    return { kind: "blocked", status: prepared.status, notices: prepared.notices };
  return { kind: "records", records: fromTable(input.fields, prepared.raw, input.mapped) };
}

interface RecordSectionConfig<S extends SectionId, K extends string, T> {
  readonly section: S;
  readonly fields: readonly FormFieldSpec<K>[];
  readonly fieldSetId: FieldSetId;
  /** Names a typed-in record from its position, such as "Project 2". */
  readonly recordLabel: (position: number) => string;
  /** Words the notice for repeated names. */
  readonly duplicateMessage: (repeatedNames: string, count: number) => string;
  readonly tableLabel: string;
  readonly nameKey: K;
  readonly toRecord: (record: CheckedRecord<K>) => T;
  readonly fragment: (records: readonly T[]) => SectionFragments[S];
  readonly summary: (names: readonly string[]) => SectionSummaries[S];
}

function buildRecordSection<S extends SectionId, K extends string, T>(
  config: RecordSectionConfig<S, K, T>,
  draft: {
    readonly mode: "manual" | "table";
    readonly records: readonly FormRecord<K>[];
    readonly table: MappedTable | null;
  },
  context: BuildContext,
): SectionResult<S> {
  const entered:
    | EnteredRecords<K>
    | { readonly kind: "records"; readonly records: readonly EnteredRecord<K>[] } =
    draft.mode === "manual"
      ? { kind: "records", records: fromForms(draft.records, config.recordLabel) }
      : enteredFromTable(
          {
            fields: config.fields,
            mapped: draft.table,
            fieldSetId: config.fieldSetId,
            tableLabel: config.tableLabel,
          },
          context,
        );
  if (entered.kind === "blocked") return notReady(config.section, entered.status, entered.notices);
  const checked = checkRecords(config.fields, entered.records);
  const names = checked.records
    .map((record) => requiredText(record, config.nameKey))
    .filter((name) => name !== "");
  const duplicates = duplicateNameNotices(names, config.duplicateMessage);
  const notices = [...checked.notices, ...duplicates];
  if (checked.status === "empty") {
    const table = config.tableLabel;
    return draft.mode === "table"
      ? notReady(config.section, "incomplete", [
          makeNotice(
            "error",
            "table/no-rows",
            t({
              message: `The ${table} has no rows with values.`,
              comment:
                "{table} is a table name in lower case, such as 'project table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
            }),
          ),
        ])
      : notReady(config.section, "empty");
  }
  const status = duplicates.length > 0 ? "error" : checked.status;
  if (status !== "ready") return notReady(config.section, status, notices);
  const records = checked.records.map(config.toRecord);
  return ready(config.section, config.fragment(records), config.summary(names), notices);
}

type ProjectKey = (typeof PROJECT_FORM_FIELDS)[number]["key"];
type SequencingKey = (typeof SEQUENCING_FORM_FIELDS)[number]["key"];

/**
 * Builds the project section from projects typed in or a project table.
 * `empty` when nothing is entered; `incomplete` when a name or description
 * is missing; `error` for a value the schema would reject or a repeated name.
 */
export function buildProject(
  section: {
    readonly mode: "manual" | "table";
    readonly records: readonly FormRecord<ProjectKey>[];
    readonly table: MappedTable | null;
  },
  context: BuildContext,
): SectionResult<"project"> {
  return buildRecordSection(
    {
      section: "project",
      fields: PROJECT_FORM_FIELDS,
      fieldSetId: "project",
      recordLabel: (position) => t`Project ${position}`,
      duplicateMessage: (repeatedNames, count) =>
        plural(count, {
          one: `Each project needs its own name, but ${repeatedNames} is used more than once.`,
          other: `Each project needs its own name, but ${repeatedNames} are used more than once.`,
        }),
      tableLabel: t({
        message: "project table",
        comment:
          "A table name in lower case, used inside other messages, such as 'The project table has no rows with values.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
      }),
      nameKey: "project_name",
      toRecord: (record): ProjectInfo => {
        const info: ProjectInfo = {
          project_name: requiredText(record, "project_name"),
          project_description: requiredText(record, "project_description"),
        };
        writeRecord(info, record);
        return info;
      },
      fragment: (records) => records,
      summary: (names) => ({ projects: names.length, names }),
    },
    section,
    context,
  );
}

/**
 * Builds the sequencing section from runs typed in or a sequencing table.
 * Same status rules as {@link buildProject}.
 */
export function buildSequencing(
  section: {
    readonly mode: "manual" | "table";
    readonly records: readonly FormRecord<SequencingKey>[];
    readonly table: MappedTable | null;
  },
  context: BuildContext,
): SectionResult<"sequencing"> {
  return buildRecordSection(
    {
      section: "sequencing",
      fields: SEQUENCING_FORM_FIELDS,
      fieldSetId: "sequencing",
      recordLabel: (position) => t`Sequencing run ${position}`,
      duplicateMessage: (repeatedNames, count) =>
        plural(count, {
          one: `Each sequencing run needs its own name, but ${repeatedNames} is used more than once.`,
          other: `Each sequencing run needs its own name, but ${repeatedNames} are used more than once.`,
        }),
      tableLabel: t({
        message: "sequencing table",
        comment:
          "A table name in lower case, used inside other messages, such as 'The sequencing table has no rows with values.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
      }),
      nameKey: "sequencing_info_name",
      toRecord: (record): SequencingInfo => {
        const info: SequencingInfo = {
          sequencing_info_name: requiredText(record, "sequencing_info_name"),
          seq_platform: requiredText(record, "seq_platform"),
          seq_instrument_model: requiredText(record, "seq_instrument_model"),
          library_layout: requiredText(record, "library_layout"),
          library_strategy: requiredText(record, "library_strategy"),
          library_source: requiredText(record, "library_source"),
          library_selection: requiredText(record, "library_selection"),
        };
        writeRecord(info, record);
        return info;
      },
      fragment: (records) => records,
      summary: (names) => ({ runs: names.length, names }),
    },
    section,
    context,
  );
}
