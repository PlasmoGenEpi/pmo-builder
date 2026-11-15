// Stands in for Lingui's macros (`@lingui/core/macro`) when scripts run the
// app's TypeScript directly in Node, without the build that compiles the
// macros away. Each returns the English text, which is all a script such as
// the benchmark needs. Loaded by `ts-hooks.mjs`.

function interpolate(strings, values) {
  return strings.reduce(
    (text, part, index) => text + part + (index < values.length ? String(values[index]) : ""),
    "",
  );
}

function choose(value, branches) {
  const exact = branches[`=${value}`] ?? branches[value];
  if (exact !== undefined) return exact;
  return value === 1 && branches.one !== undefined ? branches.one : branches.other;
}

/** `t`...`` or `t({ message })`. */
export function t(first, ...values) {
  if (Array.isArray(first) && "raw" in first) return interpolate(first, values);
  if (typeof first === "string") return first;
  return first?.message ?? "";
}

/** `msg` and `defineMessage` give a descriptor; scripts only need its text. */
export const msg = t;
export const defineMessage = t;

/** `plural(count, { one, other })`, with `#` for the count. */
export function plural(count, branches) {
  return String(choose(count, branches)).replaceAll("#", String(count));
}

/** `select(value, { ...cases, other })`. */
export function select(value, branches) {
  return String(branches[value] ?? branches.other);
}

/** `selectOrdinal`, as `plural`: English scripts need no ordinal forms. */
export const selectOrdinal = plural;
