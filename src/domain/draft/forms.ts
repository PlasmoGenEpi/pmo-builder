/**
 * Form fields for the sections a user can type in by hand: project,
 * sequencing, bioinformatics methods and runs, and a panel's genome.
 *
 * Each field is defined once in `@/domain/fields` (`./records` there), with
 * the column field sets for the same tables, so a table row and a form
 * record are checked the same way. The `satisfies` clauses check every key
 * against the PMO types that pmotools-ts generates from the schema.
 */
import { plural, t } from "@lingui/core/macro";
import type {
  BioMethod,
  BioinformaticsRunInfo,
  GenomeInfo,
  ProjectInfo,
  SequencingInfo,
} from "pmotools-ts";

import {
  GENOME_RECORD_FIELDS,
  METHOD_STEP_RECORD_FIELDS,
  PROJECT_RECORD_FIELDS,
  RUN_RECORD_FIELDS,
  SEQUENCING_RECORD_FIELDS,
  toFormFields,
  type FormFieldSpec,
  type FormatRule,
} from "@/domain/fields";

export { SEQUENCING_VOCABULARIES } from "@/domain/fields";
export type { FormFieldKind, FormFieldSpec, FormatRule } from "@/domain/fields";

/** The named keys of a generated PMO type, without its `[k: string]: unknown` index signature. */
type Keys<T> = Extract<
  keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] },
  string
>;

/** Fields of a project record (`ProjectInfo`). */
export const PROJECT_FORM_FIELDS = toFormFields(
  PROJECT_RECORD_FIELDS,
) satisfies readonly FormFieldSpec<Keys<ProjectInfo>>[];

/** Fields of a sequencing record (`SequencingInfo`). */
export const SEQUENCING_FORM_FIELDS = toFormFields(
  SEQUENCING_RECORD_FIELDS,
) satisfies readonly FormFieldSpec<Keys<SequencingInfo>>[];

/** Fields of one step of a bioinformatics method (`BioMethod`). */
export const METHOD_STEP_FORM_FIELDS = toFormFields(
  METHOD_STEP_RECORD_FIELDS,
) satisfies readonly FormFieldSpec<Keys<BioMethod>>[];

/** Fields of a bioinformatics run (`BioinformaticsRunInfo`), apart from its method. */
export const RUN_FORM_FIELDS = toFormFields(RUN_RECORD_FIELDS) satisfies readonly FormFieldSpec<
  Keys<BioinformaticsRunInfo>
>[];

/** Fields of a reference genome (`GenomeInfo`). */
export const GENOME_FORM_FIELDS = toFormFields(
  GENOME_RECORD_FIELDS,
) satisfies readonly FormFieldSpec<Keys<GenomeInfo>>[];

/** The field of a form with this key. Every key of `K` is one of the fields, so it is always found. */
export function formField<K extends string>(
  fields: readonly FormFieldSpec<K>[],
  key: NoInfer<K>,
): FormFieldSpec<K> {
  const found = fields.find((field) => field.key === key);
  if (found === undefined) throw new Error(`No form field "${key}"`);
  return found;
}

/** Field keys of a project record. */
export type ProjectFieldKey = (typeof PROJECT_FORM_FIELDS)[number]["key"];
/** Field keys of a sequencing record. */
export type SequencingFieldKey = (typeof SEQUENCING_FORM_FIELDS)[number]["key"];
/** Field keys of a bioinformatics method step. */
export type MethodStepFieldKey = (typeof METHOD_STEP_FORM_FIELDS)[number]["key"];
/** Field keys of a bioinformatics run, apart from its method. */
export type RunFieldKey = (typeof RUN_FORM_FIELDS)[number]["key"];
/** Field keys of a reference genome. */
export type GenomeFieldKey = (typeof GENOME_FORM_FIELDS)[number]["key"];

/** Where a value came from, which decides how a list is split. */
export type ValueOrigin = "form" | "table";

/** What {@link readFieldValue} makes of one entered value. */
export type FieldValue =
  | { readonly kind: "blank" }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "list"; readonly value: readonly string[] }
  | { readonly kind: "integers"; readonly value: readonly number[] }
  | { readonly kind: "invalid"; readonly message: string };

/**
 * Splits a list value: one item per line in a form, comma-separated in a
 * table cell (as pmotools-ts splits list columns). Items are trimmed and
 * blank items dropped.
 */
export function splitListValue(raw: string, origin: ValueOrigin): string[] {
  const parts = origin === "form" ? raw.split(/\r?\n/) : raw.split(",");
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * Reads one entered value against its field: trims it, treats an empty value
 * as blank, splits lists, parses whole numbers and checks the schema format.
 * The message of an `invalid` result names the field and says what is
 * allowed; the caller adds where it was (record or row).
 */
export function readFieldValue(
  spec: FormFieldSpec,
  raw: string | null | undefined,
  origin: ValueOrigin,
): FieldValue {
  const text = (raw ?? "").trim();
  if (text === "") return { kind: "blank" };
  if (spec.kind === "list" || spec.kind === "integerList") {
    const items = splitListValue(text, origin);
    if (items.length === 0) return { kind: "blank" };
    const format = spec.format;
    const bad = format === null ? [] : items.filter((item) => !matches(format, item));
    if (bad.length > 0 && format !== null) {
      const field = spec.label;
      const values = quoteList(bad);
      const allowed = format.hint;
      return {
        kind: "invalid",
        message: t({
          message: `${field} has ${values}, but it can only hold ${allowed}.`,
          comment:
            "{field} is a field label, such as 'Contributors'. {values} is a list of quoted values. {allowed} says what the field takes, such as 'letters, numbers and . _ -'.",
        }),
      };
    }
    if (spec.kind === "integerList") return { kind: "integers", value: items.map(Number) };
    return { kind: "list", value: items };
  }
  if (spec.format !== null && !matches(spec.format, text)) {
    const field = spec.label;
    const allowed = spec.format.hint;
    return {
      kind: "invalid",
      message:
        spec.kind === "date" || spec.kind === "url"
          ? t({
              message: `${field} is "${text}", but it must be ${allowed}.`,
              comment:
                "{field} is a field label, such as 'Collection date'. {allowed} says what the value must be, such as 'a date as YYYY-MM-DD'.",
            })
          : t({
              message: `${field} is "${text}", but it can only hold ${allowed}.`,
              comment:
                "{field} is a field label, such as 'Panel name'. {allowed} says what the field takes, such as 'letters, numbers and . _ -'.",
            }),
    };
  }
  return { kind: "text", value: text };
}

function matches(rule: FormatRule, value: string): boolean {
  return rule.pattern.test(value);
}

/** The first three values, quoted, and how many more there are. */
function quoteList(values: readonly string[]): string {
  const shown = values
    .slice(0, 3)
    .map((value) => `"${value}"`)
    .join(", ");
  const more = values.length - 3;
  if (more <= 0) return shown;
  return t({
    message: plural(more, { one: `${shown} and # more`, other: `${shown} and # more` }),
    comment: "{shown} is a list of quoted values, cut short.",
  });
}

/** The separators a pasted contributor list may use. */
export type ListSeparator = "newline" | "comma" | "tab" | "semicolon";

/**
 * Turns pasted or uploaded text into a list value with one item per line, as
 * list form fields store it. Use it for a contributors file or a pasted list.
 */
export function toListText(text: string, separator: ListSeparator): string {
  const pattern = { newline: /\r?\n/, comma: /,/, tab: /\t/, semicolon: /;/ }[separator];
  return text
    .split(pattern)
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .join("\n");
}
