/**
 * Getting an imported table ready for a pmotools-ts builder: find its rows,
 * check its mapping, type it, and turn the mapping into builder options.
 */
import { plural, t } from "@lingui/core/macro";
import type { Table } from "pmotools-ts";

import { mappedColumns, type MappedTable } from "@/domain/draft";
import { TEXT_KINDS, readBooleanCell } from "@/domain/import";
import type {
  FieldSetId,
  FieldSetSpec,
  FieldSpec,
  MappingProblem,
  Notice,
  RawTable,
  SectionStatus,
} from "@/domain/types";

import type { BuildContext } from "./context";
import {
  describeColumnAtStart,
  describeRowSample,
  makeNotice,
  mappingProblemNotice,
  quoteItems,
  type RowSample,
  type TableIssueContext,
} from "./notices";

/** A table whose mapping passed its checks, not yet typed. */
export interface CheckedTable {
  readonly kind: "ready";
  readonly raw: RawTable;
  readonly fieldSet: FieldSetSpec;
  /** Field key to column, for the mapped fields only. */
  readonly columns: Readonly<Record<string, string>>;
  /** Unmapped columns the user chose to carry into the PMO. */
  readonly additionalColumns: readonly string[];
  /** For wording notices about this table. `typed` is `null`. */
  readonly issues: TableIssueContext;
}

/** A table that passed its mapping checks and was typed. */
export interface PreparedTable extends CheckedTable {
  readonly typed: Table;
}

/** A table that cannot be built yet, and why. */
export interface BlockedTable {
  readonly kind: "blocked";
  readonly status: Extract<SectionStatus, "incomplete" | "error">;
  readonly notices: readonly Notice[];
}

/** What {@link checkTable} returns. */
export type TableCheck = CheckedTable | BlockedTable;

/** What {@link prepareTable} returns. */
export type TablePreparation = PreparedTable | BlockedTable;

/** What {@link prepareTable} needs. */
export interface PrepareTableInput {
  readonly mapped: MappedTable;
  readonly fieldSetId: FieldSetId;
  /** The table as the user knows it, in lower case to go inside a sentence, such as "allele table". */
  readonly tableLabel: string;
  /** More columns to keep as text, such as a run-name column. */
  readonly extraTextColumns?: readonly string[];
}

/** Mapping problems that only need more mapping, as opposed to a wrong mapping. */
export const INCOMPLETE_KINDS: ReadonlySet<MappingProblem["kind"]> = new Set([
  "missing-required",
  "incomplete-group",
]);

/** Notice for an imported table whose file is no longer loaded in memory. */
export function fileMissingNotice(input: {
  readonly fileName: string;
  readonly tableLabel: string;
  readonly tableId: string;
}): Notice {
  const { fileName, tableLabel: table, tableId } = input;
  return makeNotice(
    "error",
    "table/file-missing",
    t({
      message: `The file "${fileName}" for the ${table} is not loaded. Import it again.`,
      comment:
        "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
    }),
    { tableId },
  );
}

/** Notice for an imported table whose stored file could not be read. */
export function fileUnreadableNotice(input: {
  readonly fileName: string;
  readonly tableLabel: string;
  readonly tableId: string;
  readonly reason: string;
}): Notice {
  const { fileName, tableLabel: table, tableId, reason } = input;
  return makeNotice(
    "error",
    "table/unreadable",
    t({
      message: `The file "${fileName}" for the ${table} could not be read: ${reason}`,
      comment:
        "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). {reason} is a translated message saying why the file could not be read, or a technical message in English.",
    }),
    { tableId },
  );
}

/** Notice for blank cells in one required column, from a bounded {@link RowSample}. */
export function blankRequiredNotice(input: {
  readonly issues: TableIssueContext;
  readonly field: FieldSpec;
  readonly column: string;
  readonly rows: RowSample;
}): Notice {
  const { issues, field, column, rows } = input;
  const columnText = describeColumnAtStart(issues, column);
  const rowList = describeRowSample(rows);
  const rowCount = rows.count;
  const fieldName = field.label;
  return makeNotice(
    "error",
    "table/blank-required",
    t({
      message: plural(rowCount, {
        one: `${columnText} is blank in ${rowList}. Every row needs a value for “${fieldName}”. Fill it in.`,
        other: `${columnText} is blank in ${rowList}. Every row needs a value for “${fieldName}”. Fill them in.`,
      }),
      comment:
        "{columnText} starts the sentence and names a column, with any article, such as 'Column \"Target\"'. {rowList} is such as 'rows 5 and 9', without an article; {rowCount} is how many rows it lists. {fieldName} is a field label, quoted as a name, such as 'Target name'.",
    }),
    { tableId: issues.tableId ?? undefined, column, fieldKey: field.key },
  );
}

/** Notice for non-boolean values in one yes-or-no column, from a bounded {@link RowSample}. */
export function invalidBooleanNotice(input: {
  readonly issues: TableIssueContext;
  readonly column: string;
  readonly fieldKey?: string;
  readonly rows: RowSample;
  readonly values: readonly string[];
}): Notice {
  const { issues, column, fieldKey, rows, values } = input;
  const columnText = describeColumnAtStart(issues, column);
  const rowList = describeRowSample(rows);
  const rowCount = rows.count;
  const valueList = quoteItems(values);
  return makeNotice(
    "error",
    "table/invalid-boolean",
    t({
      message: plural(rowCount, {
        one: `${columnText} must hold yes or no (such as TRUE, FALSE, yes, no, 1 or 0), but ${rowList} holds ${valueList}. Correct it, leave it blank, or unmap the column.`,
        other: `${columnText} must hold yes or no (such as TRUE, FALSE, yes, no, 1 or 0), but ${rowList} hold ${valueList}. Correct them, leave them blank, or unmap the column.`,
      }),
      comment:
        "{columnText} starts the sentence and names a column, with any article, such as 'Column \"Present\"'. {rowList} is such as 'rows 5 and 9', without an article. {valueList} is a list of quoted values. TRUE, FALSE, yes, no, 1 and 0 are the values a file may hold; keep them in English.",
    }),
    { tableId: issues.tableId ?? undefined, column, fieldKey },
  );
}

/** Notice when column type inference throws unexpectedly. */
export function typingFailedNotice(input: {
  readonly tableLabel: string;
  readonly tableId: string | null;
  readonly error: unknown;
}): Notice {
  const detail = input.error instanceof Error ? input.error.message : String(input.error);
  const table = input.tableLabel;
  return makeNotice(
    "error",
    "table/typing-failed",
    t({
      message: `The ${table} could not be read: ${detail}`,
      comment:
        "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). {detail} is a technical message from the PMO library, in English.",
    }),
    { tableId: input.tableId ?? undefined },
  );
}

/**
 * Finds a table's rows and checks its mapping with `checkMapping`, without
 * typing it. For tables read as text, such as hand-entered records.
 *
 * Blocked as `incomplete` when the file is not loaded, a required field is
 * unmapped or a group of fields is only partly mapped, and as `error` when
 * the mapping is wrong in another way or the file cannot be read.
 */
export function checkTable(
  input: Pick<PrepareTableInput, "mapped" | "fieldSetId" | "tableLabel">,
  context: BuildContext,
): TableCheck {
  const { mapped, tableLabel } = input;
  const fileName = mapped.table.fileName;
  const tableId = mapped.table.id;
  const fieldSet = context.deps.getFieldSet(input.fieldSetId);
  const lookup = context.tables(tableId);
  if (lookup.kind === "missing") {
    return {
      kind: "blocked",
      status: "incomplete",
      notices: [fileMissingNotice({ fileName, tableLabel, tableId })],
    };
  }
  if (lookup.kind === "failed") {
    return {
      kind: "blocked",
      status: "error",
      notices: [fileUnreadableNotice({ fileName, tableLabel, tableId, reason: lookup.message })],
    };
  }
  const raw = lookup.table;
  const columns = mappedColumns(mapped);
  const issues: TableIssueContext = {
    tableLabel,
    tableId,
    fieldSet,
    columns,
    typed: null,
    raw,
  };

  const problems = context.deps.checkMapping(fieldSet, raw.columns, mapped.mapping);
  if (problems.length > 0) {
    const notices = problems.map((problem) => mappingProblemNotice(problem, issues));
    const onlyIncomplete = problems.every((problem) => INCOMPLETE_KINDS.has(problem.kind));
    return { kind: "blocked", status: onlyIncomplete ? "incomplete" : "error", notices };
  }
  return {
    kind: "ready",
    raw,
    fieldSet,
    columns,
    additionalColumns: mapped.mapping.additionalColumns,
    issues,
  };
}

/**
 * Error notices for blank cells in columns mapped to required fields, one per
 * column, naming its rows (the first few, then how many more). Caught here so
 * a blank primer or name is reported with its rows rather than reaching the
 * PMO and failing the format check there.
 */
function blankRequiredNotices(checked: CheckedTable): Notice[] {
  const notices: Notice[] = [];
  for (const field of checked.fieldSet.fields) {
    if (!field.required) continue;
    const column = checked.columns[field.key];
    if (column === undefined) continue;
    const rows: number[] = [];
    checked.raw.rows.forEach((row, index) => {
      if ((row[column] ?? "").trim() === "") rows.push(index);
    });
    if (rows.length === 0) continue;
    notices.push(
      blankRequiredNotice({
        issues: checked.issues,
        field,
        column,
        rows: { first: rows, count: rows.length },
      }),
    );
  }
  return notices;
}

/** Error notices for cells of yes-or-no columns that are neither yes nor no. */
function booleanNotices(checked: CheckedTable, booleanColumns: readonly string[]): Notice[] {
  const notices: Notice[] = [];
  for (const column of booleanColumns) {
    const rows: number[] = [];
    const values = new Set<string>();
    checked.raw.rows.forEach((row, index) => {
      const read = readBooleanCell(row[column] ?? null);
      if (read.kind !== "invalid") return;
      rows.push(index);
      values.add(read.text.trim());
    });
    if (rows.length === 0) continue;
    notices.push(
      invalidBooleanNotice({
        issues: checked.issues,
        column,
        fieldKey: Object.entries(checked.columns).find(([, mapped]) => mapped === column)?.[0],
        rows: { first: rows, count: rows.length },
        values: [...values],
      }),
    );
  }
  return notices;
}

/**
 * Finds a table's rows, checks its mapping (see {@link checkTable}), and
 * types it with `typeTable`, keeping as text the columns mapped to text,
 * date and list fields, the extra columns carried into the PMO (and any
 * `extraTextColumns`), and reading the columns mapped to yes-or-no fields as
 * booleans.
 *
 * Blocked as {@link checkTable} blocks, and as `error` when a yes-or-no
 * column holds something else or the table cannot be typed.
 */
export function prepareTable(input: PrepareTableInput, context: BuildContext): TablePreparation {
  const checked = checkTable(input, context);
  if (checked.kind === "blocked") return checked;
  const { raw, fieldSet, columns, issues } = checked;

  const textColumns = new Set<string>();
  const booleanColumns = new Set<string>();
  for (const field of fieldSet.fields) {
    const column = columns[field.key];
    if (column === undefined) continue;
    if (TEXT_KINDS.has(field.kind)) textColumns.add(column);
    else if (field.kind === "boolean") booleanColumns.add(column);
  }
  // Columns the user chose to carry are written as they are in the file, so
  // "01" stays "01" and "NA" stays "NA", rather than guessed as numbers.
  for (const column of [...checked.additionalColumns, ...(input.extraTextColumns ?? [])]) {
    if (raw.columns.includes(column)) textColumns.add(column);
  }

  const invalid = [
    ...blankRequiredNotices(checked),
    ...booleanNotices(checked, [...booleanColumns]),
  ];
  if (invalid.length > 0) return { kind: "blocked", status: "error", notices: invalid };

  let typed: Table;
  try {
    typed = context.deps.typeTable(raw, {
      textColumns: [...textColumns],
      booleanColumns: [...booleanColumns],
    });
  } catch (error) {
    return {
      kind: "blocked",
      status: "error",
      notices: [
        typingFailedNotice({
          tableLabel: input.tableLabel,
          tableId: issues.tableId,
          error,
        }),
      ],
    };
  }
  return { ...checked, typed, issues: { ...issues, typed } };
}

export { mappedColumns };

/** What {@link columnOptions} returns. */
export interface ColumnOptions<K extends string> {
  readonly options: Partial<Record<K, string>>;
  /** Field keys that name no builder option. A mismatch between the field set and the builder. */
  readonly unknownKeys: readonly string[];
}

/**
 * Turns mapped fields into builder column options by the key rule in
 * `FieldSpec`: field `targetName` becomes option `targetNameCol`.
 */
export function columnOptions<K extends string>(
  columns: Readonly<Record<string, string>>,
  optionNames: readonly K[],
  ignoreKeys: readonly string[] = [],
): ColumnOptions<K> {
  const known = new Set<string>(optionNames);
  const isOption = (name: string): name is K => known.has(name);
  const options: Partial<Record<K, string>> = {};
  const unknownKeys: string[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (ignoreKeys.includes(key)) continue;
    const name = `${key}Col`;
    if (isOption(name)) options[name] = column;
    else unknownKeys.push(key);
  }
  return { options, unknownKeys };
}

/** A warning for field keys the builder does not know, so a contract drift is visible. */
export function unknownKeysNotice(keys: readonly string[], tableLabel: string): Notice[] {
  if (keys.length === 0) return [];
  const table = tableLabel;
  const fields = quoteItems(keys);
  return [
    makeNotice(
      "warning",
      "build/unused-fields",
      t({
        message: `Some fields of the ${table} are not used when building: ${fields}.`,
        comment:
          "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). {fields} is a list of quoted field keys.",
      }),
    ),
  ];
}
