/**
 * Getting an imported table ready for a pmotools-ts builder: find its rows,
 * check its mapping, type it, and turn the mapping into builder options.
 */
import { plural, select, t } from "@lingui/core/macro";
import type { Table } from "pmotools-ts";

import { mappedColumns, type MappedTable } from "@/domain/draft";
import { readBooleanCell } from "@/domain/import";
import type {
  FieldSetId,
  FieldSetSpec,
  MappingProblem,
  Notice,
  RawTable,
  SectionStatus,
} from "@/domain/types";

import type { BuildContext } from "./context";
import {
  capitalise,
  describeColumn,
  describeRows,
  inSentence,
  makeNotice,
  mappingProblemNotice,
  quoteItems,
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
  /** The table as the user knows it, such as "allele table". */
  readonly tableLabel: string;
  /** More columns to keep as text, such as a run-name column. */
  readonly extraTextColumns?: readonly string[];
}

const TEXT_KINDS: ReadonlySet<string> = new Set(["text", "date", "list"]);

/** Problems that only need more mapping, as opposed to a wrong mapping. */
const INCOMPLETE_KINDS: ReadonlySet<MappingProblem["kind"]> = new Set([
  "missing-required",
  "incomplete-group",
]);

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
  const table = tableLabel;
  const fileName = mapped.table.fileName;
  const tableId = mapped.table.id;
  const fieldSet = context.deps.getFieldSet(input.fieldSetId);
  const lookup = context.tables(tableId);
  if (lookup.kind === "missing") {
    return {
      kind: "blocked",
      status: "incomplete",
      notices: [
        makeNotice(
          "error",
          "table/file-missing",
          t({
            message: `The file "${fileName}" for the ${table} is not loaded. Import it again.`,
            comment: "{table} is the name of a table, such as 'allele table'.",
          }),
          { tableId },
        ),
      ],
    };
  }
  if (lookup.kind === "failed") {
    const reason = lookup.message;
    return {
      kind: "blocked",
      status: "error",
      notices: [
        makeNotice(
          "error",
          "table/unreadable",
          t({
            message: `The file "${fileName}" for the ${table} could not be read: ${reason}`,
            comment:
              "{table} is the name of a table, such as 'allele table'. {reason} is a translated message saying why the file could not be read, or a technical message in English.",
          }),
          { tableId },
        ),
      ],
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
    const columnText = capitalise(describeColumn(checked.issues, column));
    const rowList = describeRows(rows);
    const rowCount = rows.length;
    const fieldName = inSentence(field.label);
    notices.push(
      makeNotice(
        "error",
        "table/blank-required",
        t({
          message: plural(rowCount, {
            one: select(englishArticle(fieldName), {
              an: `${columnText} is blank in ${rowList}. Every row needs an ${fieldName}. Fill it in.`,
              other: `${columnText} is blank in ${rowList}. Every row needs a ${fieldName}. Fill it in.`,
            }),
            other: select(englishArticle(fieldName), {
              an: `${columnText} is blank in ${rowList}. Every row needs an ${fieldName}. Fill them in.`,
              other: `${columnText} is blank in ${rowList}. Every row needs a ${fieldName}. Fill them in.`,
            }),
          }),
          comment:
            "{columnText} names a column, such as 'Column \"Target\"'. {rowList} is such as 'rows 5 and 9'. {fieldName} is a field, such as 'target name'. The 'an' or 'a' choice follows English spelling; use whatever your language needs.",
        }),
        { tableId: checked.issues.tableId ?? undefined, column, fieldKey: field.key },
      ),
    );
  }
  return notices;
}

/** "an" before a noun that starts with a vowel, otherwise "a": the English article, for `select`. */
function englishArticle(noun: string): "an" | "a" {
  return /^[aeiou]/i.test(noun) ? "an" : "a";
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
    const columnText = capitalise(describeColumn(checked.issues, column));
    const rowList = describeRows(rows);
    const rowCount = rows.length;
    const valueList = quoteItems([...values]);
    notices.push(
      makeNotice(
        "error",
        "table/invalid-boolean",
        t({
          message: plural(rowCount, {
            one: `${columnText} must hold yes or no (such as TRUE, FALSE, yes, no, 1 or 0), but ${rowList} holds ${valueList}. Correct it, leave it blank, or unmap the column.`,
            other: `${columnText} must hold yes or no (such as TRUE, FALSE, yes, no, 1 or 0), but ${rowList} hold ${valueList}. Correct them, leave them blank, or unmap the column.`,
          }),
          comment:
            "{columnText} names a column, such as 'Column \"Present\"'. {rowList} is such as 'rows 5 and 9'. {valueList} is a list of quoted values. TRUE, FALSE, yes, no, 1 and 0 are the values a file may hold; keep them in English.",
        }),
        {
          tableId: checked.issues.tableId ?? undefined,
          column,
          fieldKey: Object.entries(checked.columns).find(([, mapped]) => mapped === column)?.[0],
        },
      ),
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
    const detail = error instanceof Error ? error.message : String(error);
    const table = input.tableLabel;
    return {
      kind: "blocked",
      status: "error",
      notices: [
        makeNotice(
          "error",
          "table/typing-failed",
          t({
            message: `The ${table} could not be read: ${detail}`,
            comment:
              "{table} is the name of a table, such as 'allele table'. {detail} is a technical message from the PMO library, in English.",
          }),
          { tableId: issues.tableId ?? undefined },
        ),
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
          "{table} is the name of a table, such as 'allele table'. {fields} is a list of quoted field keys.",
      }),
    ),
  ];
}
