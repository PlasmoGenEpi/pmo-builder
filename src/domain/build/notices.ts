/**
 * Turning what pmotools-ts reports (a thrown `PmoError`, a `PmoWarning`, a
 * mapping problem) into notices a lab user can act on: what is wrong, which
 * column, which rows or values, and what to do.
 *
 * Rows are numbered as a spreadsheet shows them: the header is row 1, so the
 * first data row is row 2.
 */
import { plural, t } from "@lingui/core/macro";
import { PmoError, isMissing, type IssueDetails, type PmoWarning, type Table } from "pmotools-ts";

import { intlLocale } from "@/i18n/languages";

import type {
  FieldRequirement,
  FieldSetSpec,
  MappingProblem,
  Notice,
  NoticePointers,
  RawTable,
} from "@/domain/types";
import { unreachable } from "@/domain/draft";

/** Most names or rows quoted in one message before the rest are counted. */
const MAX_LISTED = 8;

/**
 * A plain lead-in that says where the problem is and what to try, followed
 * by the library's own text as secondary detail, for problems this app does
 * not word itself.
 */
export function withLibraryDetail(leadIn: string, libraryMessage: string): string {
  const detail = libraryMessage.trim();
  if (detail === "") return leadIn;
  return t({
    message: `${leadIn} Details: ${detail}`,
    comment:
      "{leadIn} is a translated message saying what went wrong and what to do. {detail} is the technical message from the PMO library, in English.",
  });
}

/** Makes a notice, with pointers to what it is about when they are known. */
export function makeNotice(
  severity: Notice["severity"],
  code: string,
  message: string,
  pointers: NoticePointers = {},
): Notice {
  const notice: { -readonly [K in keyof Notice]: Notice[K] } = { severity, code, message };
  if (pointers.sections !== undefined && pointers.sections.length > 0)
    notice.sections = pointers.sections;
  if (pointers.tableId !== undefined) notice.tableId = pointers.tableId;
  if (pointers.fieldKey !== undefined) notice.fieldKey = pointers.fieldKey;
  if (pointers.column !== undefined) notice.column = pointers.column;
  if (pointers.panelId !== undefined) notice.panelId = pointers.panelId;
  return notice;
}

/**
 * Joins items as "a, b and c" in the interface language, listing at most
 * {@link MAX_LISTED} and counting the rest ("a, b and 3 more").
 */
export function listItems(items: readonly string[], max = MAX_LISTED): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const all =
    rest > 0
      ? [
          ...shown,
          t({
            message: plural(rest, { one: "# more", other: "# more" }),
            comment:
              'The last item of a list of names that is cut short, such as \'"S1", "S2" and 3 more\'.',
          }),
        ]
      : shown;
  return new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(all);
}

/** Joins items as "a or b" in the interface language. */
export function listAlternatives(items: readonly string[]): string {
  return new Intl.ListFormat(intlLocale(), { type: "disjunction" }).format(items);
}

/** Quotes each value and joins them with {@link listItems}. */
export function quoteItems(items: readonly unknown[], max = MAX_LISTED): string {
  return listItems(
    items.map((item) => `"${String(item)}"`),
    max,
  );
}

/**
 * "row 5" or "rows 5, 9 and 12", from 0-based data row indexes. It has no
 * article, so the message around it supplies one where its language needs it.
 */
export function describeRows(indexes: readonly number[]): string {
  const rowCount = indexes.length;
  const rowList = listItems(indexes.map((index) => String(index + 2)));
  return t({
    message: plural(rowCount, { one: `row ${rowList}`, other: `rows ${rowList}` }),
    comment:
      "Spreadsheet rows, used inside other messages, such as 'is blank in rows 5, 9 and 12'. {rowList} is the list of row numbers. Write it without an article: the message around it adds any article or preposition your language needs.",
  });
}

/** Indexes of the rows whose cell in `column` is missing, optionally only those matching `where`. */
export function blankRowIndexes(
  table: Table,
  column: string,
  where: (row: Table[number]) => boolean = () => true,
): number[] {
  const indexes: number[] = [];
  table.forEach((row, index) => {
    const cell = row[column];
    if ((isMissing(cell) || (typeof cell === "string" && cell.trim() === "")) && where(row)) {
      indexes.push(index);
    }
  });
  return indexes;
}

/** Indexes of the rows whose raw cell in `column` equals `value`. */
export function rowIndexesWithValue(table: RawTable, column: string, value: string): number[] {
  const indexes: number[] = [];
  table.rows.forEach((row, index) => {
    if ((row[column] ?? "").trim() === value) indexes.push(index);
  });
  return indexes;
}

function strings(details: IssueDetails, key: string): string[] {
  const value = details[key];
  if (!Array.isArray(value)) return [];
  return value.map((item: unknown) => String(item));
}

function text(details: IssueDetails, key: string): string | null {
  const value = details[key];
  if (value === null || value === undefined) return null;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : null;
}

function count(details: IssueDetails, key: string): number | null {
  const value = details[key];
  return typeof value === "number" ? value : null;
}

/** Where a table problem happened, for wording messages. */
export interface TableIssueContext {
  /**
   * The table as the user knows it, in lower case, to go inside a sentence:
   * "allele table". Translators start every table name with the same word
   * ("tableau", "tabela"), so a sentence can agree with any of them.
   */
  readonly tableLabel: string;
  /** The imported table's id, or `null` when the problem is not in an imported table. */
  readonly tableId: string | null;
  readonly fieldSet: FieldSetSpec;
  /** Field key to column, for the fields that are mapped. */
  readonly columns: Readonly<Record<string, string>>;
  /** The typed table the builder saw, for finding rows. */
  readonly typed: Table | null;
  /** The raw table, for finding rows by their text. */
  readonly raw: RawTable | null;
}

/**
 * The field a column is mapped to, as it reads in brackets after the column
 * ("sample name"), or `null` when it is not mapped or its name says no more
 * than the column's own name does.
 */
function bracketedField(context: TableIssueContext, column: string): string | null {
  const key = Object.entries(context.columns).find(([, mapped]) => mapped === column)?.[0];
  const label =
    key === undefined ? undefined : context.fieldSet.fields.find((f) => f.key === key)?.label;
  if (label === undefined || sameWords(label, column)) return null;
  return inSentence(label);
}

/**
 * `column "SampleID" (sample name)`, to go inside a sentence, naming the
 * field it is mapped to when there is one and its name says more than the
 * column's own name does. It has no article: the sentence around it supplies
 * one where its language needs it. To start a sentence, use
 * {@link describeColumnAtStart}.
 */
export function describeColumn(context: TableIssueContext, column: string): string {
  const field = bracketedField(context, column);
  if (field === null) {
    return t({
      message: `column "${column}"`,
      comment:
        "Names a column of the user's table inside other messages, such as 'is blank in column \"SampleID\"'. {column} is the column's name in the file. Write it without an article: the message around it adds any article or preposition your language needs.",
    });
  }
  return t({
    message: `column "${column}" (${field})`,
    comment:
      "Names a column of the user's table inside other messages. {column} is the column's name in the file; {field} is the field it is matched to, in lower case, such as 'sample name'. Write it without an article: the message around it adds any article or preposition your language needs.",
  });
}

/**
 * `Column "SampleID" (sample name)`, to start a sentence: like
 * {@link describeColumn}, but its own message, so a translator can give it
 * a capital and the article a sentence starts with.
 */
export function describeColumnAtStart(context: TableIssueContext, column: string): string {
  const field = bracketedField(context, column);
  if (field === null) {
    return t({
      message: `Column "${column}"`,
      comment:
        "Names a column of the user's table at the start of a sentence, such as 'Column \"Start\" must hold whole numbers'. {column} is the column's name in the file. Include the article your language starts the sentence with, such as French 'La colonne'.",
    });
  }
  return t({
    message: `Column "${column}" (${field})`,
    comment:
      "Names a column of the user's table at the start of a sentence. {column} is the column's name in the file; {field} is the field it is matched to, in lower case, such as 'sample name'. Include the article your language starts the sentence with, such as French 'La colonne'.",
  });
}

/**
 * A field label as it reads in brackets after a column name: lower case,
 * except acronyms such as "ID". Used only there, where no article or other
 * word has to agree with it.
 */
export function inSentence(label: string): string {
  return label
    .split(" ")
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}

/** A name without case, spaces, dashes or underscores, for comparing. */
function plainName(value: string): string {
  return value.toLowerCase().replaceAll(/[\s_-]+/g, "");
}

/** Whether two names differ only in case, spaces, dashes and underscores. */
function sameWords(a: string, b: string): boolean {
  return plainName(a) === plainName(b);
}

/** A field label quoted as a name, “Sample name”, for lists of fields inside a sentence. */
export function quoteLabel(label: string): string {
  return `“${label}”`;
}

function fieldLabel(context: TableIssueContext, key: string): string {
  return context.fieldSet.fields.find((field) => field.key === key)?.label ?? key;
}

function columnFor(context: TableIssueContext, key: string): string | null {
  return context.columns[key] ?? null;
}

/** The largest group whose size the "map all or none" advice spells out. */
const MAX_SPELLED_GROUP = 6;

function requirementLabel(context: TableIssueContext, requirement: FieldRequirement): string {
  if (typeof requirement === "string") return fieldLabel(context, requirement);
  const [first = "", ...rest] = requirement.anyOf.map((key) => fieldLabel(context, key));
  if (rest.length === 0) return first;
  const alternatives = listAlternatives(rest);
  return t({
    message: `${first} (or ${alternatives})`,
    comment:
      "A field that another field can stand in for, such as 'Chromosome (or Pseudo-CIGAR chromosome)'.",
  });
}

/**
 * "Insert start is mapped, but Chromosome and Insert end are not. Map all
 * three or none." When the fields that switch the rule on are all among the
 * fields it needs, the advice is to map all or none; otherwise to map the
 * missing fields or unmap the others.
 */
function incompleteGroupMessage(
  context: TableIssueContext,
  problem: Extract<MappingProblem, { kind: "incomplete-group" }>,
): string {
  const mappedCount = problem.mappedKeys.length;
  const missingCount = problem.missing.length;
  const mappedFields = listItems(problem.mappedKeys.map((key) => fieldLabel(context, key)));
  const missingFields = listItems(
    problem.missing.map((requirement) => requirementLabel(context, requirement)),
  );
  const opening = t({
    message: plural(mappedCount, {
      one: plural(missingCount, {
        one: `${mappedFields} is mapped, but ${missingFields} is not.`,
        other: `${mappedFields} is mapped, but ${missingFields} are not.`,
      }),
      other: plural(missingCount, {
        one: `${mappedFields} are mapped, but ${missingFields} is not.`,
        other: `${mappedFields} are mapped, but ${missingFields} are not.`,
      }),
    }),
    comment:
      "Fields that only work together. {mappedFields} and {mappedCount} are the fields matched to a column; {missingFields} and {missingCount} are the ones still to match.",
  });
  const plain = problem.missing.every((requirement) => typeof requirement === "string");
  const group = [
    ...new Set([
      ...problem.mappedKeys,
      ...problem.missing.flatMap((r) => (typeof r === "string" ? [r] : [])),
    ]),
  ];
  const total = group.length;
  const advice =
    plain && total >= 2 && total <= MAX_SPELLED_GROUP
      ? t({
          message: plural(total, {
            2: "Map both or neither.",
            3: "Map all three or none.",
            4: "Map all four or none.",
            5: "Map all five or none.",
            6: "Map all six or none.",
            other: "Map all # or none.",
          }),
          comment:
            "Advice for fields that only work together: match all of them to columns, or none.",
        })
      : t({
          message: plural(missingCount, {
            one: `Map it too, or unmap ${mappedFields}.`,
            other: `Map them too, or unmap ${mappedFields}.`,
          }),
          comment:
            "Advice for fields that only work together: match the missing fields to columns too, or unmatch {mappedFields}.",
        });
  return `${opening} ${advice}`;
}

/** A notice for one problem with a column mapping. */
export function mappingProblemNotice(problem: MappingProblem, context: TableIssueContext): Notice {
  const tableId = context.tableId ?? undefined;
  const table = context.tableLabel;
  switch (problem.kind) {
    case "missing-required": {
      const field = fieldLabel(context, problem.fieldKey);
      return makeNotice(
        "error",
        "mapping/missing-required",
        t({
          message: `Choose the column of the ${table} that holds “${field}”.`,
          comment:
            "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). {field} is a field label, quoted as a name, such as 'Sample name'.",
        }),
        { tableId, fieldKey: problem.fieldKey },
      );
    }
    case "duplicate-column": {
      const column = problem.column;
      const fields = listItems(
        problem.fieldKeys.map((key) => quoteLabel(fieldLabel(context, key))),
      );
      return makeNotice(
        "error",
        "mapping/duplicate-column",
        t({
          message: `Column "${column}" is chosen for ${fields}. Each column can feed only one field.`,
          comment:
            "{column} is a column of the user's table. {fields} is a list of quoted field labels, such as '“Sample name” and “Target name”'.",
        }),
        { tableId, column: problem.column, fieldKey: problem.fieldKeys[0] },
      );
    }
    case "unknown-column": {
      const column = problem.column;
      const field = fieldLabel(context, problem.fieldKey);
      return makeNotice(
        "error",
        "mapping/unknown-column",
        t({
          message: `The ${table} has no column "${column}", which is chosen for “${field}”. Choose another column.`,
          comment:
            "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). {field} is a field label, quoted as a name, such as 'Sample name'.",
        }),
        { tableId, fieldKey: problem.fieldKey, column: problem.column },
      );
    }
    case "incomplete-group":
      return makeNotice(
        "error",
        "mapping/incomplete-group",
        incompleteGroupMessage(context, problem),
        {
          tableId,
          fieldKey: problem.mappedKeys[0],
        },
      );
    case "unknown-additional-column": {
      const column = problem.column;
      return makeNotice(
        "error",
        "mapping/unknown-additional-column",
        t({
          message: `The ${table} has no column "${column}", chosen to carry into the PMO. Untick it.`,
          comment:
            "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
        }),
        { tableId, column: problem.column },
      );
    }
    case "additional-column-mapped": {
      const column = problem.column;
      const field = fieldLabel(context, problem.fieldKey);
      return makeNotice(
        "error",
        "mapping/additional-column-mapped",
        t({
          message: `Column "${column}" is chosen for “${field}” and also to carry into the PMO as it is. Untick it, or choose another column for the field.`,
          comment: "{field} is a field label, quoted as a name, such as 'Sample name'.",
        }),
        { tableId, column: problem.column, fieldKey: problem.fieldKey },
      );
    }
    default:
      return unreachable(problem);
  }
}

/** Where a pmotools-ts issue points: the table, and the column its details name, with its field. */
function issuePointers(details: IssueDetails, context: TableIssueContext): NoticePointers {
  const tableId = context.tableId ?? undefined;
  const named =
    text(details, "column") ??
    (strings(details, "columns").length === 1 ? strings(details, "columns")[0] : undefined);
  if (named === undefined) return { tableId };
  const fieldKey = Object.entries(context.columns).find(([, column]) => column === named)?.[0];
  return { tableId, column: named, fieldKey };
}

/** Turns anything a builder threw into an error notice. A non-`PmoError` is reported as unexpected. */
export function errorNotice(error: unknown, context: TableIssueContext): Notice {
  if (error instanceof PmoError) {
    return makeNotice(
      "error",
      error.code,
      describeIssue(error.code, error.message, error.details, context),
      issuePointers(error.details, context),
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  const table = context.tableLabel;
  return makeNotice(
    "error",
    "build/unexpected",
    withLibraryDetail(
      t({
        message: `Something went wrong while reading the ${table}. Check its column mapping and the values in the mapped columns, then try again.`,
        comment:
          "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
      }),
      message,
    ),
    { tableId: context.tableId ?? undefined },
  );
}

/** Turns a builder warning into a warning notice. */
export function warningNotice(warning: PmoWarning, context: TableIssueContext): Notice {
  return makeNotice(
    "warning",
    warning.code,
    describeIssue(warning.code, warning.message, warning.details, context),
    issuePointers(warning.details, context),
  );
}

function readCountTableLabel(details: IssueDetails, fallback: string): string {
  const table = text(details, "table");
  if (table === "total_raw_count_table") {
    return t({
      message: "totals table",
      comment:
        "The table of total reads per sample: a table name in lower case, used inside other messages. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
    });
  }
  if (table === "reads_by_stage_table") {
    return t({
      message: "by-stage table",
      comment:
        "The table of reads per sample, target and processing stage: a table name in lower case, used inside other messages. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
    });
  }
  return fallback;
}

/**
 * The rows of `column` that are blank, as " (rows 5 and 9)" to follow a
 * column, or `null` when none are found.
 */
function blankRows(context: TableIssueContext, column: string): string | null {
  const rows = context.typed === null ? [] : blankRowIndexes(context.typed, column);
  return rows.length > 0 ? describeRows(rows) : null;
}

/**
 * Words one pmotools-ts issue for the user. Falls back to the library's own
 * message, followed by advice to check the mapping, for codes it does not know.
 */
function describeIssue(
  code: string,
  libraryMessage: string,
  details: IssueDetails,
  context: TableIssueContext,
): string {
  const table = context.tableLabel;
  switch (code) {
    case "mhap/missing-columns":
    case "panel/missing-columns":
    case "metatable/missing-columns":
    case "read-counts/missing-columns": {
      const issueTable = readCountTableLabel(details, table);
      const columnCount = strings(details, "columns").length;
      const columns = quoteItems(strings(details, "columns"));
      return t({
        message: plural(columnCount, {
          one: `The ${issueTable} has no column ${columns}. Check the column mapping.`,
          other: `The ${issueTable} has no columns ${columns}. Check the column mapping.`,
        }),
        comment:
          "{issueTable} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). {columns} is a list of quoted column names.",
      });
    }
    case "mhap/missing-additional-columns":
    case "panel/missing-additional-columns":
    case "read-counts/missing-additional-columns": {
      const issueTable = readCountTableLabel(details, table);
      const columnCount = strings(details, "columns").length;
      const columns = quoteItems(strings(details, "columns"));
      return t({
        message: plural(columnCount, {
          one: `The extra column ${columns} chosen to carry into the PMO is not in the ${issueTable}. Untick it.`,
          other: `The extra columns ${columns} chosen to carry into the PMO are not in the ${issueTable}. Untick them.`,
        }),
        comment:
          "{issueTable} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). {columns} is a list of quoted column names.",
      });
    }
    case "metatable/null-values": {
      const parts = strings(details, "columns").map((column) => {
        const columnText = describeColumn(context, column);
        const rows = blankRows(context, column);
        if (rows === null) return columnText;
        return t({
          message: `${columnText} (${rows})`,
          comment:
            "An item of a list: a column and the rows where it is blank, such as 'column \"Date\" (rows 5 and 9)'. {columnText} and {rows} have no article.",
        });
      });
      const columns = listItems(parts);
      return t({
        message: `These columns of the ${table} have blank cells, which these fields do not allow: ${columns}. Fill them in, or unmap the column if the field is optional.`,
        comment:
          "{table} is a table name in lower case, such as 'specimen table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). {columns} lists the columns and their blank rows, after a colon, such as 'column \"Date\" (rows 5 and 9)'.",
      });
    }
    case "metatable/duplicate-selected-columns": {
      const columns = quoteItems(strings(details, "columns"));
      return t`The same column is chosen for more than one field: ${columns}. Each column can feed only one field.`;
    }
    case "metatable/duplicate-output-columns": {
      const field = text(details, "field") ?? "";
      const columns = quoteItems(strings(details, "columns"));
      return t({
        message: `More than one column would be written as "${field}": ${columns}. Untick the extra column or change the mapping.`,
        comment: "{field} is a PMO field name. {columns} is a list of quoted column names.",
      });
    }
    case "mhap/missing-reads": {
      const sample = text(details, "library_sample_name") ?? "";
      const target = text(details, "target_name");
      const readsColumn = columnFor(context, "reads");
      const sampleColumn = columnFor(context, "librarySampleName");
      const rowIndexes =
        context.typed !== null && readsColumn !== null
          ? blankRowIndexes(
              context.typed,
              readsColumn,
              (row) => sampleColumn === null || String(row[sampleColumn] ?? "") === sample,
            )
          : [];
      if (readsColumn === null) {
        return target === null
          ? t`Sample "${sample}" has no read count in the read count column. Every row needs a read count.`
          : t`Sample "${sample}", target "${target}" has no read count in the read count column. Every row needs a read count.`;
      }
      const column = describeColumn(context, readsColumn);
      if (rowIndexes.length > 0) {
        const rows = describeRows(rowIndexes);
        return target === null
          ? t({
              message: `Sample "${sample}" has no read count in ${column} (${rows}). Every row needs a read count.`,
              comment:
                "{column} names a column without an article, such as 'column \"Reads\"'; add any article your language needs. {rows} is such as 'rows 5 and 9'.",
            })
          : t({
              message: `Sample "${sample}", target "${target}" has no read count in ${column} (${rows}). Every row needs a read count.`,
              comment:
                "{column} names a column without an article, such as 'column \"Reads\"'; add any article your language needs. {rows} is such as 'rows 5 and 9'.",
            });
      }
      return target === null
        ? t({
            message: `Sample "${sample}" has no read count in ${column}. Every row needs a read count.`,
            comment:
              "{column} names a column without an article, such as 'column \"Reads\"'; add any article your language needs.",
          })
        : t({
            message: `Sample "${sample}", target "${target}" has no read count in ${column}. Every row needs a read count.`,
            comment:
              "{column} names a column without an article, such as 'column \"Reads\"'; add any article your language needs.",
          });
    }
    case "mhap/missing-seq":
    case "mhap/missing-run-name":
    case "mhap/incomplete-location": {
      const key =
        code === "mhap/missing-seq" ? "seq" : code === "mhap/missing-run-name" ? null : "start";
      const columnName = key === null ? text(details, "column") : columnFor(context, key);
      const target = text(details, "target_name") ?? "";
      const rows = columnName === null ? null : blankRows(context, columnName);
      if (code === "mhap/missing-run-name") {
        if (columnName === null) {
          return t`The run name comes from a column, but it is blank in some rows. Fill them in or give one run name for the whole table.`;
        }
        const column = describeColumn(context, columnName);
        return rows === null
          ? t({
              message: `The run name comes from ${column}, but it is blank in some rows. Fill them in or give one run name for the whole table.`,
              comment:
                "{column} names a column without an article, such as 'column \"Run\"'; add any article your language needs.",
            })
          : t({
              message: `The run name comes from ${column}, but it is blank in some rows (${rows}). Fill them in or give one run name for the whole table.`,
              comment:
                "{column} names a column without an article, such as 'column \"Run\"'; add any article your language needs. {rows} is such as 'rows 5 and 9'.",
            });
      }
      if (code === "mhap/missing-seq") {
        if (columnName === null) {
          return t`A row for target "${target}" has no sequence in the sequence column.`;
        }
        const column = describeColumn(context, columnName);
        return rows === null
          ? t({
              message: `A row for target "${target}" has no sequence in ${column}.`,
              comment:
                "{column} names a column without an article, such as 'column \"ASV\"'; add any article your language needs.",
            })
          : t({
              message: `A row for target "${target}" has no sequence in ${column} (${rows}).`,
              comment:
                "{column} names a column without an article, such as 'column \"ASV\"'; add any article your language needs. {rows} is such as 'rows 5 and 9'.",
            });
      }
      return t`Target "${target}" has a chromosome but no start or end in its first row. Fill in the location or unmap the location columns.`;
    }
    case "mhap/invalid-masking": {
      const columnName = text(details, "column") ?? "";
      const value = text(details, "value") ?? "";
      const rowIndexes =
        context.raw === null ? [] : rowIndexesWithValue(context.raw, columnName, value);
      const column = describeColumnAtStart(context, columnName);
      if (rowIndexes.length > 0) {
        const rows = describeRows(rowIndexes);
        return t({
          message: `${column} must hold whole numbers separated by commas, but holds "${value}" (${rows}).`,
          comment:
            "{column} starts the sentence and names a column, with any article, such as 'Column \"Masking\"'. {rows} is such as 'rows 5 and 9'.",
        });
      }
      return t({
        message: `${column} must hold whole numbers separated by commas, but holds "${value}".`,
        comment:
          "{column} starts the sentence and names a column, with any article, such as 'Column \"Masking\"'.",
      });
    }
    case "mhap/incomplete-masking-columns":
      return t`Masking needs three columns: masking start, segment size and replacement size. Map all three, or none.`;
    case "mhap/incomplete-location-columns":
      return t`A location needs the chromosome, start and end columns. Map all three, or unmap the strand and reference sequence columns.`;
    case "mhap/pseudocigar-ref-loc-columns-unset":
      return t`A pseudo-CIGAR column is mapped, so the location it refers to is needed too. Map the chromosome, start and end columns (or the pseudo-CIGAR ones), or unmap the pseudo-CIGAR column.`;
    case "mhap/pseudocigar-ref-loc-missing": {
      const target = text(details, "target_name") ?? "";
      return t`Target "${target}" has a pseudo-CIGAR but its chromosome, start or end is blank.`;
    }
    case "mhap/duplicate-target-seq": {
      const duplicates = Array.isArray(details["duplicates"]) ? details["duplicates"] : [];
      const targetNames = duplicates.map((entry: unknown) =>
        typeof entry === "object" && entry !== null && "target_name" in entry
          ? String(entry.target_name)
          : "",
      );
      const targets = quoteItems([...new Set(targetNames)]);
      return t`Some targets list the same sequence more than once with different details (${targets}). Reads are counted against the last copy. Check the extra columns carried onto each microhaplotype.`;
    }
    case "panel/invalid-integer": {
      const column = describeColumnAtStart(context, text(details, "column") ?? "");
      const target = text(details, "target") ?? "";
      const value = text(details, "value") ?? "";
      return t({
        message: `${column} must hold whole numbers, but target "${target}" has "${value}".`,
        comment:
          "{column} starts the sentence and names a column, with any article, such as 'Column \"Start\"'.",
      });
    }
    case "panel/duplicate-target-names": {
      const columnName = columnFor(context, "targetName");
      const targets = quoteItems(strings(details, "targets"));
      if (columnName === null) {
        return t`These targets appear more than once in the target name column: ${targets}. Each target needs one row.`;
      }
      const column = describeColumn(context, columnName);
      return t({
        message: `These targets appear more than once in ${column}: ${targets}. Each target needs one row.`,
        comment:
          "{column} names a column without an article, such as 'column \"Target\"'; add any article your language needs.",
      });
    }
    case "panel/duplicate-target-info": {
      const groups = Array.isArray(details["groups"]) ? details["groups"] : [];
      const sets = groups.map((group: unknown) =>
        typeof group === "object" &&
        group !== null &&
        "targets" in group &&
        Array.isArray(group.targets)
          ? listItems(group.targets.map((target: unknown) => `"${String(target)}"`))
          : "",
      );
      const targetGroups = sets.filter((set) => set !== "").join("; ");
      return t({
        message: `Some targets have exactly the same primers and location as another target: ${targetGroups}. Each target needs its own primers or location. Remove the repeated rows or correct them.`,
        comment:
          "{targetGroups} lists groups of quoted target names, the groups separated by semicolons.",
      });
    }
    case "panel/empty-table":
      return t({
        message: `The ${table} has no rows.`,
        comment:
          "{table} is a table name in lower case, such as 'target table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
      });
    case "panel/location-without-genome": {
      const target = text(details, "target") ?? "";
      return t`Target "${target}" has a location, so the panel needs genome information. Add a genome, or unmap the location columns.`;
    }
    case "panel/invalid-location-columns":
      return t`Location columns are mapped without the chromosome column. Map the chromosome column, or unmap the start and end columns.`;
    case "panel/missing-location": {
      const location =
        text(details, "location") ??
        t({ message: "location", comment: "A target's place on the genome." });
      const targets = quoteItems(strings(details, "targets"));
      return t({
        message: `The ${location} was left out for targets with blank location cells: ${targets}.`,
        comment:
          "{location} is the part of a target's location left out, in English, such as 'strand'.",
      });
    }
    case "panel/invalid-genome-info":
      return withLibraryDetail(
        t`The panel's genome information is incomplete or not in the right form. Check the genome's name, version, taxon ID and web address on the Panel step.`,
        libraryMessage,
      );
    case "metatable/plate-position-conflict":
      return t({
        message: `Plate columns of the ${table} are mapped twice over: give the plate position, or the plate row and column, not both. Unmap one of them.`,
        comment:
          "{table} is a table name in lower case, such as 'specimen table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
      });
    case "metatable/plate-row-col-mismatch":
      return t({
        message: `The plate row and plate column of the ${table} go together. Map both or neither.`,
        comment:
          "{table} is a table name in lower case, such as 'specimen table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
      });
    case "metatable/invalid-plate-position": {
      const column = describeColumnAtStart(context, text(details, "column") ?? "");
      const valueList = Array.isArray(details["values"]) ? details["values"] : [];
      const values = quoteItems([...new Set(valueList.map((value: unknown) => String(value)))]);
      return t({
        message: `${column} must hold wells such as A01 or H12 (a letter A to H, then 1 to 12), but holds ${values}.`,
        comment:
          "{column} starts the sentence and names a column, with any article, such as 'Column \"Well\"'. {values} is a list of quoted values.",
      });
    }
    case "metatable/invalid-taxon-id":
    case "metatable/invalid-integer":
    case "metatable/invalid-number": {
      const column = describeColumnAtStart(context, text(details, "column") ?? "");
      const rowIndex = count(details, "row");
      const value = text(details, "value") ?? "";
      if (rowIndex === null) {
        if (code === "metatable/invalid-taxon-id") {
          return t({
            message: `${column} must hold NCBI taxonomy numbers such as 5833, separated by commas, but a row holds "${value}". Correct it, or unmap the column if the field is optional.`,
            comment:
              "{column} starts the sentence and names a column, with any article, such as 'Column \"Host taxon\"'.",
          });
        }
        if (code === "metatable/invalid-integer") {
          return t({
            message: `${column} must hold whole numbers, but a row holds "${value}". Correct it, or unmap the column if the field is optional.`,
            comment:
              "{column} starts the sentence and names a column, with any article, such as 'Column \"Age\"'.",
          });
        }
        return t({
          message: `${column} must hold numbers, but a row holds "${value}". Correct it, or unmap the column if the field is optional.`,
          comment:
            "{column} starts the sentence and names a column, with any article, such as 'Column \"Density\"'.",
        });
      }
      const row = describeRows([rowIndex]);
      if (code === "metatable/invalid-taxon-id") {
        return t({
          message: `${column} must hold NCBI taxonomy numbers such as 5833, separated by commas, but ${row} holds "${value}". Correct it, or unmap the column if the field is optional.`,
          comment:
            "{column} starts the sentence and names a column, with any article, such as 'Column \"Host taxon\"'. {row} is one row without an article, such as 'row 5'.",
        });
      }
      if (code === "metatable/invalid-integer") {
        return t({
          message: `${column} must hold whole numbers, but ${row} holds "${value}". Correct it, or unmap the column if the field is optional.`,
          comment:
            "{column} starts the sentence and names a column, with any article, such as 'Column \"Age\"'. {row} is one row without an article, such as 'row 5'.",
        });
      }
      return t({
        message: `${column} must hold numbers, but ${row} holds "${value}". Correct it, or unmap the column if the field is optional.`,
        comment:
          "{column} starts the sentence and names a column, with any article, such as 'Column \"Density\"'. {row} is one row without an article, such as 'row 5'.",
      });
    }
    case "metatable/density-method-without-density":
      return t({
        message: `The parasite density method of the ${table} is mapped without the parasite density. Map both or neither.`,
        comment:
          "{table} is a table name in lower case, such as 'specimen table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
      });
    case "read-counts/invalid-count": {
      const issueTable = readCountTableLabel(details, table);
      const column = text(details, "column") ?? "";
      const value = text(details, "value") ?? "";
      const rowIndex = count(details, "row");
      if (rowIndex === null) {
        return t({
          message: `Column "${column}" of the ${issueTable} needs a whole number, but holds "${value}".`,
          comment:
            "{issueTable} is a table name in lower case, such as 'totals table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
        });
      }
      const rows = describeRows([rowIndex]);
      return t({
        message: `Column "${column}" of the ${issueTable} needs a whole number in ${rows}, but holds "${value}".`,
        comment:
          "{issueTable} is a table name in lower case, such as 'totals table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). {rows} is one row without an article, such as 'row 5'.",
      });
    }
    case "read-counts/duplicate-library-sample-names": {
      const samples = quoteItems(strings(details, "names"));
      return t`These samples appear more than once in the totals table: ${samples}. Each sample needs one row.`;
    }
    case "read-counts/missing-name": {
      const rowIndex = count(details, "row");
      const column = text(details, "column");
      if (rowIndex !== null && column !== null) {
        const issueTable = readCountTableLabel(details, table);
        const row = rowIndex + 2;
        return t({
          message: `Row ${row} of the ${issueTable} has no value in column "${column}".`,
          comment:
            "{row} is a spreadsheet row number. {issueTable} is a table name in lower case, such as 'totals table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
        });
      }
      const sample = text(details, "library_sample_name") ?? "";
      return t`The by-stage table has a row with no target or stage, for sample "${sample}".`;
    }
    case "read-counts/unmatched-library-samples": {
      const samples = quoteItems(strings(details, "names"));
      return t`The by-stage table has reads for samples that are not in the totals table, and they were left out: ${samples}.`;
    }
    case "read-counts/unmatched-runs": {
      const runs = quoteItems(strings(details, "runs"));
      return t`The by-stage table has reads for runs that are not in the totals table, and they were left out: ${runs}.`;
    }
    case "read-counts/duplicate-stages":
      return t`The by-stage table repeats some sample, target and stage combinations. The last count of each was kept.`;
    default:
      return withLibraryDetail(
        t({
          message: `The ${table} could not be turned into its part of the PMO. Check the column mapping of the ${table} and the values in the mapped columns.`,
          comment:
            "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
        }),
        libraryMessage,
      );
  }
}
