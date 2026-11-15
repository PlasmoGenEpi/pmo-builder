/**
 * Cutting a usage record into facts, and keeping only the facts on the
 * allowed list. Pure, so the app's tests can check it against real records.
 */

/** What may be stored: for each metric, its values, or a pattern its value must match. */
export interface AllowedFacts {
  readonly values: Readonly<Record<string, readonly string[]>>;
  readonly patterns: Readonly<Record<string, string>>;
}

/** One `[metric, value]` pair, such as `["steps", "panel"]`. */
export type Fact = readonly [metric: string, value: string];

/** The most facts kept from one record. A real session record has well under 200. */
export const MAX_FACTS = 400;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Cuts a record into facts, such as `["tables.panelTargets.import.route",
 * "upload"]`. Each item of a list is its own fact, and an object inside the
 * `issues` list is one fact with its values joined by spaces.
 */
export function factsOf(value: unknown, path = "", out: Fact[] = []): Fact[] {
  if (Array.isArray(value)) {
    for (const item of value) factsOf(item, path, out);
  } else if (isRecord(value) && path === "issues") {
    out.push([path, Object.values(value).map(String).join(" ")]);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      factsOf(item, path === "" ? key : `${path}.${key}`, out);
    }
  } else {
    out.push([path, String(value)]);
  }
  return out;
}

/** What a record gave. `null` when it is not a usage record at all. */
export type SortedFacts = {
  readonly kept: readonly Fact[];
  /** Facts left out: not on the list, or past {@link MAX_FACTS}. */
  readonly dropped: number;
} | null;

/**
 * Returns a function that sorts a parsed record's facts into those to keep
 * and a count of the rest. A value that is not on the list costs only its
 * own fact, so a record from a newer app still counts for everything else.
 */
export function createFactFilter(allowed: AllowedFacts): (record: unknown) => SortedFacts {
  const values = new Map(
    Object.entries(allowed.values).map(([metric, list]) => [metric, new Set(list)]),
  );
  const patterns = new Map(
    Object.entries(allowed.patterns).map(([metric, pattern]) => [metric, new RegExp(pattern)]),
  );
  const isAllowed = ([metric, value]: Fact): boolean =>
    values.get(metric)?.has(value) === true || patterns.get(metric)?.test(value) === true;

  return (record) => {
    if (!isRecord(record) || (record["kind"] !== "visit" && record["kind"] !== "session")) {
      return null;
    }
    const all = factsOf(record);
    const kept = all.filter(isAllowed).slice(0, MAX_FACTS);
    return { kept, dropped: all.length - kept.length };
  };
}
