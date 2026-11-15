/**
 * The column-matching screen as data: which column feeds each field, which
 * matches are worth checking, what is wrong with each row, and the counts.
 * Pure functions; the components render what these return.
 */
import { plural, t } from "@lingui/core/macro";

import type {
  ColumnMapping,
  FieldMatch,
  FieldRequirement,
  FieldSetSpec,
  FieldSpec,
  MappingProblem,
  RawRow,
} from "@/domain/types";

import { intlLocale } from "@/i18n/languages";

import { confirmationKey } from "./confirmations";

/** One field's row in the editor. */
export interface FieldRowModel {
  readonly field: FieldSpec;
  /** The column chosen for the field, or `null`. */
  readonly column: string | null;
  /**
   * True when the column was matched by a similar name rather than the
   * field's own name or a known alias, and the user has not confirmed it.
   */
  readonly needsCheck: boolean;
  /** What is wrong with this row, in words for the user. Empty when nothing is. */
  readonly problems: readonly string[];
}

/** Counts for the one-line summary. */
export interface MatchCounts {
  readonly requiredMatched: number;
  readonly requiredTotal: number;
  readonly optionalMatched: number;
  readonly optionalTotal: number;
  /** Matches by a similar name, not yet confirmed. */
  readonly toCheck: number;
  /** Rows with a problem. */
  readonly withProblems: number;
}

/** Everything the editor shows, worked out from the mapping. */
export interface MappingModel {
  readonly required: readonly FieldRowModel[];
  readonly optional: readonly FieldRowModel[];
  /** Columns not chosen for any field, in table order. */
  readonly unmappedColumns: readonly string[];
  /**
   * The columns the extra-columns list shows: the unmapped ones, then any
   * ticked as extra that are mapped or missing, so they can be unticked.
   */
  readonly extraColumnChoices: readonly string[];
  /** Problems with ticked extra columns, by column. */
  readonly extraProblems: ReadonlyMap<string, string>;
  readonly counts: MatchCounts;
}

/** What {@link describeMapping} needs. */
export interface DescribeMappingInput {
  readonly fieldSet: FieldSetSpec;
  readonly tableId: string;
  readonly columns: readonly string[];
  readonly mapping: ColumnMapping;
  /** How each field was matched by `suggestMapping` for these columns. */
  readonly matches: Readonly<Record<string, FieldMatch>>;
  /** From `checkMapping`. */
  readonly problems: readonly MappingProblem[];
  /** Keys made with `confirmationKey`. */
  readonly confirmed: ReadonlySet<string>;
}

function labelOf(fieldSet: FieldSetSpec, key: string): string {
  return fieldSet.fields.find((field) => field.key === key)?.label ?? key;
}

/** Joins labels for a sentence in the interface language: "a, b and c". */
function listLabels(labels: readonly string[]): string {
  return new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(labels);
}

function requirementText(fieldSet: FieldSetSpec, requirement: FieldRequirement): string {
  if (typeof requirement === "string") return labelOf(fieldSet, requirement);
  const labels = requirement.anyOf.map((key) => labelOf(fieldSet, key));
  return new Intl.ListFormat(intlLocale(), { type: "disjunction" }).format(labels);
}

function requirementKeys(requirement: FieldRequirement): readonly string[] {
  return typeof requirement === "string" ? [requirement] : requirement.anyOf;
}

/** The messages for one field from a list of mapping problems. */
export function problemsForField(
  fieldSet: FieldSetSpec,
  key: string,
  problems: readonly MappingProblem[],
): string[] {
  const messages: string[] = [];
  for (const problem of problems) {
    switch (problem.kind) {
      case "missing-required":
        if (problem.fieldKey === key) {
          messages.push(t`Choose a column. This field is needed to build the table.`);
        }
        break;
      case "duplicate-column":
        if (problem.fieldKeys.includes(key)) {
          const column = problem.column;
          const otherFields = listLabels(
            problem.fieldKeys
              .filter((other) => other !== key)
              .map((other) => labelOf(fieldSet, other)),
          );
          messages.push(
            t`"${column}" is also chosen for ${otherFields}. A column can feed only one field, so choose another for one of them.`,
          );
        }
        break;
      case "unknown-column":
        if (problem.fieldKey === key) {
          const column = problem.column;
          messages.push(t`This table has no column "${column}". Choose another.`);
        }
        break;
      case "incomplete-group": {
        const neededFields = listLabels(
          problem.missing.map((requirement) => requirementText(fieldSet, requirement)),
        );
        const matchedFields = listLabels(
          problem.mappedKeys.map((other) => labelOf(fieldSet, other)),
        );
        if (problem.mappedKeys.includes(key)) {
          messages.push(
            plural(problem.missing.length, {
              one: `This needs ${neededFields} as well. Match it too, or set this field to "Not in this table".`,
              other: `This needs ${neededFields} as well. Match them too, or set this field to "Not in this table".`,
            }),
          );
        } else if (
          problem.missing.some((requirement) => requirementKeys(requirement).includes(key))
        ) {
          messages.push(
            plural(problem.mappedKeys.length, {
              one: `Needed because ${matchedFields} is matched.`,
              other: `Needed because ${matchedFields} are matched.`,
            }),
          );
        }
        break;
      }
      case "additional-column-mapped":
        if (problem.fieldKey === key) {
          const column = problem.column;
          messages.push(
            t`"${column}" is also ticked under Extra columns. Untick it there, since this field already carries it.`,
          );
        }
        break;
      case "unknown-additional-column":
        break;
      default:
        return unreachableProblem(problem);
    }
  }
  return messages;
}

function unreachableProblem(problem: never): never {
  throw new Error(`Unknown mapping problem: ${JSON.stringify(problem)}`);
}

/** Problems with the extra columns: columns the table does not have, or columns also matched to a field. */
export function extraColumnProblems(
  fieldSet: FieldSetSpec,
  problems: readonly MappingProblem[],
): ReadonlyMap<string, string> {
  const messages = new Map<string, string>();
  for (const problem of problems) {
    if (problem.kind === "unknown-additional-column") {
      messages.set(problem.column, t`This table no longer has this column. Untick it.`);
    } else if (problem.kind === "additional-column-mapped") {
      const fieldLabel = labelOf(fieldSet, problem.fieldKey);
      messages.set(problem.column, t`Also matched to ${fieldLabel}. Untick it here.`);
    }
  }
  return messages;
}

/** Works out every row of the editor, the unmatched columns and the counts. */
export function describeMapping(input: DescribeMappingInput): MappingModel {
  const { fieldSet, tableId, columns, mapping, matches, problems, confirmed } = input;
  const rows = fieldSet.fields.map((field): FieldRowModel => {
    const column = mapping.fields[field.key] ?? null;
    const match = matches[field.key];
    const needsCheck =
      column !== null &&
      match !== undefined &&
      match.confidence === "fuzzy" &&
      match.column === column &&
      !confirmed.has(confirmationKey(tableId, field.key, column));
    return { field, column, needsCheck, problems: problemsForField(fieldSet, field.key, problems) };
  });
  const required = rows.filter((row) => row.field.required);
  const optional = rows.filter((row) => !row.field.required);
  const used = new Set(rows.flatMap((row) => (row.column === null ? [] : [row.column])));
  const unmappedColumns = columns.filter((column) => !used.has(column));
  const extraProblems = extraColumnProblems(fieldSet, problems);
  return {
    required,
    optional,
    unmappedColumns,
    extraColumnChoices: [
      ...unmappedColumns,
      ...mapping.additionalColumns.filter(
        (column, index, all) => !unmappedColumns.includes(column) && all.indexOf(column) === index,
      ),
    ],
    extraProblems,
    counts: {
      requiredMatched: required.filter((row) => row.column !== null).length,
      requiredTotal: required.length,
      optionalMatched: optional.filter((row) => row.column !== null).length,
      optionalTotal: optional.length,
      toCheck: rows.filter((row) => row.needsCheck).length,
      withProblems: rows.filter((row) => row.problems.length > 0).length + extraProblems.size,
    },
  };
}

/**
 * The summary in one or two sentences, such as "4 of 4 required fields
 * matched, 6 optional fields matched. 2 matches to check."
 */
export function summaryLine(counts: MatchCounts): string {
  const { requiredMatched, requiredTotal, optionalMatched, toCheck } = counts;
  const matched =
    counts.optionalTotal > 0
      ? t`${requiredMatched} of ${plural(requiredTotal, { one: "# required field", other: "# required fields" })} matched, ${plural(optionalMatched, { one: "# optional field", other: "# optional fields" })} matched.`
      : t`${requiredMatched} of ${plural(requiredTotal, { one: "# required field", other: "# required fields" })} matched.`;
  if (toCheck === 0) return matched;
  const checks = plural(toCheck, { one: "# match to check.", other: "# matches to check." });
  return `${matched} ${checks}`;
}

/**
 * The mapping with one field set to a column, or cleared with `null`. A
 * column chosen for a field stops being carried as an extra column.
 */
export function withFieldColumn(
  mapping: ColumnMapping,
  key: string,
  column: string | null,
): ColumnMapping {
  return {
    fields: { ...mapping.fields, [key]: column },
    additionalColumns:
      column === null
        ? mapping.additionalColumns
        : mapping.additionalColumns.filter((extra) => extra !== column),
  };
}

/** The mapping with the extra columns replaced, kept in table order. */
export function withAdditionalColumns(
  mapping: ColumnMapping,
  chosen: readonly string[],
  columns: readonly string[],
): ColumnMapping {
  const set = new Set(chosen);
  return { ...mapping, additionalColumns: columns.filter((column) => set.has(column)) };
}

/** The first non-blank value of each column in some rows, for showing an example. */
export function firstValues(
  columns: readonly string[],
  rows: readonly RawRow[],
): Readonly<Record<string, string>> {
  const examples: Record<string, string> = {};
  for (const column of columns) {
    for (const row of rows) {
      const value = row[column];
      if (value !== null && value !== undefined && value.trim() !== "") {
        examples[column] = value.trim();
        break;
      }
    }
  }
  return examples;
}

/** A heading and its rows, for the optional fields. */
export interface FieldGroup {
  readonly title: string;
  readonly rows: readonly FieldRowModel[];
}

/** Whether a row matches a filter text: its label, description, group, or chosen column. */
export function rowMatchesFilter(row: FieldRowModel, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = [row.field.label, row.field.description, row.field.group ?? "", row.column ?? ""]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Groups optional rows for display. Fields in `matchedFirst` come first under
 * "Matched"; the rest follow under their own group, in field set order.
 * `matchedFirst` is a snapshot taken when the list was opened, so a row does
 * not jump to another place while the user is changing it.
 */
export function groupOptionalRows(
  rows: readonly FieldRowModel[],
  options: { readonly filter: string; readonly matchedFirst: ReadonlySet<string> },
): FieldGroup[] {
  const shown = rows.filter((row) => rowMatchesFilter(row, options.filter));
  const groups: FieldGroup[] = [];
  const matched = shown.filter((row) => options.matchedFirst.has(row.field.key));
  if (matched.length > 0) {
    groups.push({
      title: t({
        message: "Matched",
        comment: "Heading over the optional fields already matched to a column",
      }),
      rows: matched,
    });
  }
  const byGroup = new Map<string, FieldRowModel[]>();
  for (const row of shown) {
    if (options.matchedFirst.has(row.field.key)) continue;
    const title =
      row.field.group ??
      t({ message: "Other", comment: "Heading over optional fields that belong to no group" });
    const list = byGroup.get(title);
    if (list === undefined) byGroup.set(title, [row]);
    else list.push(row);
  }
  for (const [title, list] of byGroup) groups.push({ title, rows: list });
  return groups;
}
