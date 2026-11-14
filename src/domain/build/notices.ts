/**
 * Turning what pmotools-ts reports (a thrown `PmoError`, a `PmoWarning`, a
 * mapping problem) into notices a lab user can act on: what is wrong, which
 * column, which rows or values, and what to do.
 *
 * Rows are numbered as a spreadsheet shows them: the header is row 1, so the
 * first data row is row 2.
 */
import { PmoError, isMissing, type IssueDetails, type PmoWarning, type Table } from "pmotools-ts";

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
  return detail === "" ? leadIn : `${leadIn} Details: ${detail}`;
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

/** Joins items as "a, b and c", listing at most {@link MAX_LISTED} and counting the rest. */
export function listItems(items: readonly string[], max = MAX_LISTED): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length === 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
}

/** Quotes each value and joins them with {@link listItems}. */
export function quoteItems(items: readonly unknown[], max = MAX_LISTED): string {
  return listItems(
    items.map((item) => `"${String(item)}"`),
    max,
  );
}

/** "1 specimen" or "50 specimens". */
export function countText(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** "row 5" or "rows 5, 9 and 12", from 0-based data row indexes. */
export function describeRows(indexes: readonly number[]): string {
  const rows = indexes.map((index) => String(index + 2));
  return `${rows.length === 1 ? "row" : "rows"} ${listItems(rows)}`;
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
  /** The table as the user knows it, such as "allele table". */
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
 * `column "SampleID" (sample name)`, naming the field it is mapped to when
 * there is one and its name says more than the column's own name does.
 */
export function describeColumn(context: TableIssueContext, column: string): string {
  const key = Object.entries(context.columns).find(([, mapped]) => mapped === column)?.[0];
  const label =
    key === undefined ? undefined : context.fieldSet.fields.find((f) => f.key === key)?.label;
  if (label === undefined || sameWords(label, column)) return `column "${column}"`;
  return `column "${column}" (${inSentence(label)})`;
}

/** A field label as it reads mid-sentence: lower case, except acronyms such as "ID". */
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

function fieldLabel(context: TableIssueContext, key: string): string {
  return context.fieldSet.fields.find((field) => field.key === key)?.label ?? key;
}

function columnFor(context: TableIssueContext, key: string): string | null {
  return context.columns[key] ?? null;
}

function isAre(items: readonly string[]): string {
  return items.length === 1 ? "is" : "are";
}

const COUNT_WORDS = ["none", "one", "both", "three", "four", "five", "six"];

function requirementLabel(context: TableIssueContext, requirement: FieldRequirement): string {
  if (typeof requirement === "string") return fieldLabel(context, requirement);
  const [first, ...rest] = requirement.anyOf.map((key) => fieldLabel(context, key));
  return rest.length === 0 ? (first ?? "") : `${first ?? ""} (or ${rest.join(" or ")})`;
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
  const mapped = problem.mappedKeys.map((key) => fieldLabel(context, key));
  const missing = problem.missing.map((requirement) => requirementLabel(context, requirement));
  const opening = `${listItems(mapped)} ${isAre(mapped)} mapped, but ${listItems(missing)} ${isAre(missing)} not.`;
  const plain = problem.missing.every((requirement) => typeof requirement === "string");
  const group = [
    ...new Set([
      ...problem.mappedKeys,
      ...problem.missing.flatMap((r) => (typeof r === "string" ? [r] : [])),
    ]),
  ];
  const total = group.length;
  if (plain && total >= 2 && total < COUNT_WORDS.length) {
    return total === 2
      ? `${opening} Map both or neither.`
      : `${opening} Map all ${COUNT_WORDS[total] ?? String(total)} or none.`;
  }
  return `${opening} Map ${missing.length === 1 ? "it" : "them"} too, or unmap ${listItems(mapped)}.`;
}

/** A notice for one problem with a column mapping. */
export function mappingProblemNotice(problem: MappingProblem, context: TableIssueContext): Notice {
  const tableId = context.tableId ?? undefined;
  switch (problem.kind) {
    case "missing-required":
      return makeNotice(
        "error",
        "mapping/missing-required",
        `Choose the column of the ${context.tableLabel} that holds the ${fieldLabel(context, problem.fieldKey).toLowerCase()}.`,
        { tableId, fieldKey: problem.fieldKey },
      );
    case "duplicate-column":
      return makeNotice(
        "error",
        "mapping/duplicate-column",
        `Column "${problem.column}" is chosen for ${listItems(
          problem.fieldKeys.map((key) => fieldLabel(context, key).toLowerCase()),
        )}. Each column can feed only one field.`,
        { tableId, column: problem.column, fieldKey: problem.fieldKeys[0] },
      );
    case "unknown-column":
      return makeNotice(
        "error",
        "mapping/unknown-column",
        `The ${context.tableLabel} has no column "${problem.column}", which is chosen for ${fieldLabel(
          context,
          problem.fieldKey,
        ).toLowerCase()}. Choose another column.`,
        { tableId, fieldKey: problem.fieldKey, column: problem.column },
      );
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
    case "unknown-additional-column":
      return makeNotice(
        "error",
        "mapping/unknown-additional-column",
        `The ${context.tableLabel} has no column "${problem.column}", chosen to carry into the PMO. Untick it.`,
        { tableId, column: problem.column },
      );
    case "additional-column-mapped":
      return makeNotice(
        "error",
        "mapping/additional-column-mapped",
        `Column "${problem.column}" is chosen for ${fieldLabel(context, problem.fieldKey).toLowerCase()} and also to carry into the PMO as it is. Untick it, or choose another column for the field.`,
        { tableId, column: problem.column, fieldKey: problem.fieldKey },
      );
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
  return makeNotice(
    "error",
    "build/unexpected",
    withLibraryDetail(
      `Something went wrong while reading the ${context.tableLabel}. Check its column mapping and the values in the mapped columns, then try again.`,
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
  if (table === "total_raw_count_table") return "totals table";
  if (table === "reads_by_stage_table") return "by-stage table";
  return fallback;
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
    case "read-counts/missing-columns":
      return `The ${readCountTableLabel(details, table)} has no ${columnsPhrase(strings(details, "columns"))}. Check the column mapping.`;
    case "mhap/missing-additional-columns":
    case "panel/missing-additional-columns":
    case "read-counts/missing-additional-columns":
      return `The extra ${columnsPhrase(strings(details, "columns"))} chosen to carry into the PMO ${
        strings(details, "columns").length === 1 ? "is" : "are"
      } not in the ${readCountTableLabel(details, table)}. Untick ${strings(details, "columns").length === 1 ? "it" : "them"}.`;
    case "metatable/null-values": {
      const parts = strings(details, "columns").map((column) => {
        const rows = context.typed === null ? [] : blankRowIndexes(context.typed, column);
        const where = rows.length > 0 ? ` (${describeRows(rows)})` : "";
        return `${describeColumn(context, column)}${where}`;
      });
      return `These columns of the ${table} have blank cells, which these fields do not allow: ${listItems(parts)}. Fill them in, or unmap the column if the field is optional.`;
    }
    case "metatable/duplicate-selected-columns":
      return `The same column is chosen for more than one field: ${quoteItems(strings(details, "columns"))}. Each column can feed only one field.`;
    case "metatable/duplicate-output-columns":
      return `More than one column would be written as "${text(details, "field") ?? ""}": ${quoteItems(
        strings(details, "columns"),
      )}. Untick the extra column or change the mapping.`;
    case "mhap/missing-reads": {
      const sample = text(details, "library_sample_name") ?? "";
      const target = text(details, "target_name");
      const readsColumn = columnFor(context, "reads");
      const sampleColumn = columnFor(context, "librarySampleName");
      const rows =
        context.typed !== null && readsColumn !== null
          ? blankRowIndexes(
              context.typed,
              readsColumn,
              (row) => sampleColumn === null || String(row[sampleColumn] ?? "") === sample,
            )
          : [];
      const where = rows.length > 0 ? ` (${describeRows(rows)})` : "";
      const column =
        readsColumn === null ? "the read count column" : describeColumn(context, readsColumn);
      const targetText = target === null ? "" : `, target "${target}"`;
      return `Sample "${sample}"${targetText} has no read count in ${column}${where}. Every row needs a read count.`;
    }
    case "mhap/missing-seq":
    case "mhap/missing-run-name":
    case "mhap/incomplete-location": {
      const key =
        code === "mhap/missing-seq" ? "seq" : code === "mhap/missing-run-name" ? null : "start";
      const column = key === null ? text(details, "column") : columnFor(context, key);
      const target = text(details, "target_name");
      const rows =
        context.typed !== null && column !== null ? blankRowIndexes(context.typed, column) : [];
      const where = rows.length > 0 ? ` (${describeRows(rows)})` : "";
      if (code === "mhap/missing-run-name") {
        return `The run name comes from ${column === null ? "a column" : describeColumn(context, column)}, but it is blank in some rows${where}. Fill them in or give one run name for the whole table.`;
      }
      if (code === "mhap/missing-seq") {
        return `A row for target "${target ?? ""}" has no sequence in ${column === null ? "the sequence column" : describeColumn(context, column)}${where}.`;
      }
      return `Target "${target ?? ""}" has a chromosome but no start or end in its first row. Fill in the location or unmap the location columns.`;
    }
    case "mhap/invalid-masking": {
      const column = text(details, "column") ?? "";
      const value = text(details, "value") ?? "";
      const rows = context.raw === null ? [] : rowIndexesWithValue(context.raw, column, value);
      const where = rows.length > 0 ? ` (${describeRows(rows)})` : "";
      return `${capitalise(describeColumn(context, column))} must hold whole numbers separated by commas, but holds "${value}"${where}.`;
    }
    case "mhap/incomplete-masking-columns":
      return "Masking needs three columns: masking start, segment size and replacement size. Map all three, or none.";
    case "mhap/incomplete-location-columns":
      return "A location needs the chromosome, start and end columns. Map all three, or unmap the strand and reference sequence columns.";
    case "mhap/pseudocigar-ref-loc-columns-unset":
      return "A pseudo-CIGAR column is mapped, so the location it refers to is needed too. Map the chromosome, start and end columns (or the pseudo-CIGAR ones), or unmap the pseudo-CIGAR column.";
    case "mhap/pseudocigar-ref-loc-missing":
      return `Target "${text(details, "target_name") ?? ""}" has a pseudo-CIGAR but its chromosome, start or end is blank.`;
    case "mhap/duplicate-target-seq": {
      const duplicates = Array.isArray(details["duplicates"]) ? details["duplicates"] : [];
      const targets = duplicates.map((entry: unknown) =>
        typeof entry === "object" && entry !== null && "target_name" in entry
          ? String(entry.target_name)
          : "",
      );
      return `Some targets list the same sequence more than once with different details (${quoteItems(
        [...new Set(targets)],
      )}). Reads are counted against the last copy. Check the extra columns carried onto each microhaplotype.`;
    }
    case "panel/invalid-integer": {
      const column = text(details, "column") ?? "";
      return `${capitalise(describeColumn(context, column))} must hold whole numbers, but target "${
        text(details, "target") ?? ""
      }" has "${text(details, "value") ?? ""}".`;
    }
    case "panel/duplicate-target-names": {
      const column = columnFor(context, "targetName");
      return `These targets appear more than once in ${
        column === null ? "the target name column" : describeColumn(context, column)
      }: ${quoteItems(strings(details, "targets"))}. Each target needs one row.`;
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
      return `Some targets have exactly the same primers and location as another target: ${sets
        .filter((set) => set !== "")
        .join(
          "; ",
        )}. Each target needs its own primers or location. Remove the repeated rows or correct them.`;
    }
    case "panel/empty-table":
      return `The ${table} has no rows.`;
    case "panel/location-without-genome":
      return `Target "${text(details, "target") ?? ""}" has a location, so the panel needs genome information. Add a genome, or unmap the location columns.`;
    case "panel/invalid-location-columns":
      return "Location columns are mapped without the chromosome column. Map the chromosome column, or unmap the start and end columns.";
    case "panel/missing-location":
      return `The ${text(details, "location") ?? "location"} was left out for targets with blank location cells: ${quoteItems(
        strings(details, "targets"),
      )}.`;
    case "panel/invalid-genome-info":
      return withLibraryDetail(
        "The panel's genome information is incomplete or not in the right form. Check the genome's name, version, taxon ID and web address on the Panel step.",
        libraryMessage,
      );
    case "metatable/plate-position-conflict":
      return `Plate columns of the ${table} are mapped twice over: give the plate position, or the plate row and column, not both. Unmap one of them.`;
    case "metatable/plate-row-col-mismatch":
      return `The plate row and plate column of the ${table} go together. Map both or neither.`;
    case "metatable/invalid-plate-position": {
      const column = text(details, "column") ?? "";
      const values = Array.isArray(details["values"]) ? details["values"] : [];
      return `${capitalise(describeColumn(context, column))} must hold wells such as A01 or H12 (a letter A to H, then 1 to 12), but holds ${quoteItems(
        [...new Set(values.map((value: unknown) => String(value)))],
      )}.`;
    }
    case "metatable/invalid-taxon-id":
    case "metatable/invalid-integer":
    case "metatable/invalid-number": {
      const column = text(details, "column") ?? "";
      const row = count(details, "row");
      const what =
        code === "metatable/invalid-taxon-id"
          ? "NCBI taxonomy numbers such as 5833, separated by commas"
          : code === "metatable/invalid-integer"
            ? "whole numbers"
            : "numbers";
      const where = row === null ? "a row" : describeRows([row]);
      return `${capitalise(describeColumn(context, column))} must hold ${what}, but ${where} holds "${
        text(details, "value") ?? ""
      }". Correct it, or unmap the column if the field is optional.`;
    }
    case "metatable/density-method-without-density":
      return `The parasite density method of the ${table} is mapped without the parasite density. Map both or neither.`;
    case "read-counts/invalid-count": {
      const row = count(details, "row");
      const where = row === null ? "" : ` in ${describeRows([row])}`;
      return `Column "${text(details, "column") ?? ""}" of the ${readCountTableLabel(details, table)} needs a whole number${where}, but holds "${text(details, "value") ?? ""}".`;
    }
    case "read-counts/duplicate-library-sample-names":
      return `These samples appear more than once in the totals table: ${quoteItems(strings(details, "names"))}. Each sample needs one row.`;
    case "read-counts/missing-name": {
      const row = count(details, "row");
      const column = text(details, "column");
      if (row !== null && column !== null) {
        return `${capitalise(readCountTableLabel(details, table))} ${describeRows([row])} has no value in column "${column}".`;
      }
      return `The by-stage table has a row with no target or stage, for sample "${text(details, "library_sample_name") ?? ""}".`;
    }
    case "read-counts/unmatched-library-samples":
      return `The by-stage table has reads for samples that are not in the totals table, and they were left out: ${quoteItems(
        strings(details, "names"),
      )}.`;
    case "read-counts/unmatched-runs":
      return `The by-stage table has reads for runs that are not in the totals table, and they were left out: ${quoteItems(
        strings(details, "runs"),
      )}.`;
    case "read-counts/duplicate-stages":
      return "The by-stage table repeats some sample, target and stage combinations. The last count of each was kept.";
    default:
      return withLibraryDetail(
        `The ${table} could not be turned into its part of the PMO. Check the column mapping of the ${table} and the values in the mapped columns.`,
        libraryMessage,
      );
  }
}

function columnsPhrase(columns: readonly string[]): string {
  return `${columns.length === 1 ? "column" : "columns"} ${quoteItems(columns)}`;
}

/** The text with its first letter in upper case. */
export function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
