import { readFieldValue, toListText, type FormFieldSpec, type KeyValueEntry } from "@/domain/draft";

/** A one-click fix offered under a field, such as removing `https://`. */
export interface FieldFix {
  /** The button label, such as "Remove https://". */
  readonly label: string;
  readonly value: string;
}

/** Works out a fix for a value, or `null` when it needs none. */
export type FieldFixer = (value: string) => FieldFix | null;

/** What to say about a field's value, or `null` when it is fine. */
export function checkFieldValue(
  spec: FormFieldSpec,
  value: string,
  options: { readonly showBlank: boolean },
): string | null {
  const read = readFieldValue(spec, value, "form");
  if (read.kind === "invalid") return read.message;
  if (read.kind === "blank" && spec.required && options.showBlank)
    return `Fill in the ${spec.label.toLowerCase()}. The PMO needs it.`;
  return null;
}

/** The hint under a field: its description, with the expected format for dates and lists. */
export function fieldHint(spec: FormFieldSpec): string {
  switch (spec.kind) {
    case "date":
      return `${spec.description} Use YYYY-MM-DD, or YYYY-MM.`;
    case "list":
    case "integerList":
      return /one per line/i.test(spec.description)
        ? spec.description
        : `${spec.description} One per line.`;
    case "text":
    case "multiline":
    case "url":
      return spec.description;
    default:
      return spec.description;
  }
}

/** Offers to drop `http://`, `https://` or `ftp://` from a value whose format does not allow a colon. */
export const removeScheme: FieldFixer = (value) => {
  const match = /^\s*(https?|ftp):\/\//i.exec(value);
  if (match === null) return null;
  return {
    label: `Remove ${match[0].trim()}`,
    value: value.trim().slice(match[0].trim().length),
  };
};

/** Offers to put the items of a list typed on one line, separated by commas or semicolons, on their own lines. */
export const splitOneLineList: FieldFixer = (value) => {
  const text = value.trim();
  if (text === "" || text.includes("\n")) return null;
  const separator = text.includes(";") ? "semicolon" : text.includes(",") ? "comma" : null;
  if (separator === null) return null;
  return { label: "Put each one on its own line", value: toListText(text, separator) };
};

/** What is wrong with one extra detail, or `null`. */
export function checkExtraEntry(
  entry: KeyValueEntry,
  others: readonly KeyValueEntry[],
  fieldKeys: ReadonlySet<string>,
): string | null {
  const key = entry.key.trim();
  if (key === "") return entry.value.trim() === "" ? null : "Give this detail a name.";
  if (fieldKeys.has(key)) return `"${key}" is already a field above. Fill in that field instead.`;
  if (others.some((other) => other.id !== entry.id && other.key.trim() === key))
    return `"${key}" is used twice. Give each detail its own name.`;
  return null;
}

/** Where a typed-in record stands, from its committed values. */
export type RecordState =
  | { readonly kind: "blank" }
  | { readonly kind: "missing"; readonly count: number }
  | { readonly kind: "invalid"; readonly count: number }
  | { readonly kind: "complete" };

/** Checks a record's committed values against its form spec. */
export function recordState<K extends string>(
  fields: readonly FormFieldSpec<K>[],
  values: Readonly<Record<K, string>>,
  extra: readonly KeyValueEntry[] = [],
): RecordState {
  let missing = 0;
  let invalid = 0;
  let filled = 0;
  for (const field of fields) {
    const read = readFieldValue(field, values[field.key], "form");
    if (read.kind === "blank") {
      if (field.required) missing += 1;
    } else {
      filled += 1;
      if (read.kind === "invalid") invalid += 1;
    }
  }
  const keys = new Set<string>(fields.map((field) => field.key));
  for (const entry of extra) {
    if (entry.key.trim() !== "" || entry.value.trim() !== "") filled += 1;
    if (checkExtraEntry(entry, extra, keys) !== null) invalid += 1;
  }
  if (filled === 0) return { kind: "blank" };
  if (invalid > 0) return { kind: "invalid", count: invalid };
  if (missing > 0) return { kind: "missing", count: missing };
  return { kind: "complete" };
}
