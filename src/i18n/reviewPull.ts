/**
 * Taking translation reviewers' suggestions into a catalog. Pure: the
 * command `pnpm translations pull` reads the suggestions from the review
 * database and the catalog from disk, and writes back what this returns.
 *
 * For each message, a change is taken only if the reviewer saw the
 * translation the catalog has now, so a suggestion never overwrites a later
 * fix. When reviewers suggest different changes, the newest is taken and the
 * others are reported.
 */
import { translationProblem } from "./messageShape";
import { messageKey, parsePo, setTranslation, type MessageId } from "./poFile";

/** One stored suggestion, as the review database returns it. */
export interface StoredSuggestion extends MessageId {
  readonly id: number;
  readonly reviewer: string;
  /** The label of the link it came through. */
  readonly link: string;
  /** The translation the reviewer was shown. */
  readonly seen: string;
  readonly verdict: "ok" | "edit";
  /** The reviewer's wording. For "ok", the same as `seen`. */
  readonly text: string;
  /** ISO time it was sent. */
  readonly at: string;
}

/** What became of one suggestion. */
export type Outcome =
  | { readonly kind: "applied"; readonly suggestion: StoredSuggestion; readonly was: string }
  | { readonly kind: "approved"; readonly suggestion: StoredSuggestion }
  /** It matches the catalog already: an approval of the current text, or a change made before. */
  | { readonly kind: "current"; readonly suggestion: StoredSuggestion }
  /** Another reviewer's newer change was taken instead. */
  | { readonly kind: "passed-over"; readonly suggestion: StoredSuggestion; readonly taken: string }
  /** The translation changed after the reviewer saw it. */
  | { readonly kind: "outdated"; readonly suggestion: StoredSuggestion; readonly now: string }
  | { readonly kind: "invalid"; readonly suggestion: StoredSuggestion; readonly problem: string }
  /** The catalog has no such message: the English has changed since. */
  | { readonly kind: "unknown"; readonly suggestion: StoredSuggestion };

/** Groups items by a key, keeping first-seen order. `Map.groupBy` is ES2024, past the build target. */
function groupBy<T>(items: Iterable<T>, keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

/** The catalog with the suggestions taken in, and what became of each. */
export interface PullResult {
  readonly catalog: string;
  readonly outcomes: readonly Outcome[];
}

/** Takes `suggestions` into `catalog`. */
export function applySuggestions(
  catalog: string,
  suggestions: readonly StoredSuggestion[],
): PullResult {
  const current = new Map(parsePo(catalog).map((entry) => [messageKey(entry), entry.msgstr]));
  const byMessage = groupBy(
    suggestions.toSorted((a, b) => a.id - b.id),
    (suggestion) => messageKey(suggestion),
  );
  let result = catalog;
  const outcomes: Outcome[] = [];

  for (const [key, group] of byMessage) {
    const now = current.get(key);
    if (now === undefined) {
      outcomes.push(...group.map((suggestion) => ({ kind: "unknown", suggestion }) as const));
      continue;
    }
    const problems = new Map(
      group.map((suggestion) => [
        suggestion.id,
        suggestion.verdict === "edit"
          ? translationProblem(suggestion.msgid, suggestion.text)
          : null,
      ]),
    );
    const changes = group.filter(
      (suggestion) =>
        suggestion.verdict === "edit" &&
        suggestion.seen === now &&
        suggestion.text !== now &&
        problems.get(suggestion.id) === null,
    );
    const taken = changes.at(-1)?.text ?? null;
    if (taken !== null) {
      const changed = setTranslation(result, group[0] ?? { context: "", msgid: "" }, taken);
      if (changed !== null) result = changed;
    }
    for (const suggestion of group) {
      const problem = problems.get(suggestion.id) ?? null;
      if (problem !== null) outcomes.push({ kind: "invalid", suggestion, problem });
      else if (taken !== null && suggestion.seen === now)
        outcomes.push(
          suggestion.text === taken
            ? { kind: "applied", suggestion, was: now }
            : { kind: "passed-over", suggestion, taken },
        );
      else if (suggestion.seen !== now)
        outcomes.push(
          suggestion.text === now
            ? { kind: "current", suggestion }
            : { kind: "outdated", suggestion, now },
        );
      else if (suggestion.verdict === "ok") outcomes.push({ kind: "approved", suggestion });
      else outcomes.push({ kind: "current", suggestion });
    }
  }
  return { catalog: result, outcomes };
}

function quoted(text: string): string {
  return text === "" ? "(empty)" : `“${text.replaceAll("\n", " ")}”`;
}

function message(suggestion: StoredSuggestion): string {
  const context = suggestion.context === "" ? "" : ` (${suggestion.context})`;
  return `${quoted(suggestion.msgid)}${context}`;
}

function who(suggestion: StoredSuggestion): string {
  return `${suggestion.reviewer} (${suggestion.link}, ${suggestion.at.slice(0, 10)})`;
}

/** A Markdown report of a pull for one language, for the pull request. */
export function formatReport(language: string, outcomes: readonly Outcome[]): string {
  const of = <K extends Outcome["kind"]>(kind: K) =>
    outcomes.filter((outcome): outcome is Extract<Outcome, { kind: K }> => outcome.kind === kind);
  const applied = of("applied");
  const lines = [`## ${language}`, ""];
  const approvals = groupBy(
    [...of("approved"), ...of("current")].filter((item) => item.suggestion.verdict === "ok"),
    (item) => item.suggestion.reviewer,
  );
  const reviewers = new Set(outcomes.map((outcome) => outcome.suggestion.reviewer));
  lines.push(
    `${outcomes.length} suggestions from ${reviewers.size} ${reviewers.size === 1 ? "reviewer" : "reviewers"}: ` +
      `${new Set(applied.map((item) => messageKey(item.suggestion))).size} messages changed, ` +
      `${[...approvals.values()].reduce((sum, items) => sum + items.length, 0)} approvals.`,
    "",
  );
  if (applied.length > 0) {
    lines.push("### Changed", "");
    const byMessage = groupBy(applied, (item) => messageKey(item.suggestion));
    for (const items of byMessage.values()) {
      const [first] = items;
      if (first === undefined) continue;
      lines.push(
        `- ${message(first.suggestion)}: ${quoted(first.was)} → ${quoted(first.suggestion.text)}. ` +
          `By ${items.map((item) => who(item.suggestion)).join("; ")}.`,
      );
      for (const other of of("passed-over").filter(
        (item) => messageKey(item.suggestion) === messageKey(first.suggestion),
      )) {
        lines.push(
          `  - Not taken: ${quoted(other.suggestion.text)} by ${who(other.suggestion)}` +
            (other.suggestion.verdict === "ok" ? " (said the old wording was right)" : ""),
        );
      }
    }
    lines.push("");
  }
  if (approvals.size > 0) {
    lines.push("### Approved as they are", "");
    for (const [reviewer, items] of approvals) lines.push(`- ${reviewer}: ${items.length}`);
    lines.push("");
  }
  const skipped = [...of("outdated"), ...of("invalid"), ...of("unknown")];
  if (skipped.length > 0) {
    lines.push("### Not taken", "");
    for (const item of skipped) {
      const reason =
        item.kind === "invalid"
          ? item.problem
          : item.kind === "outdated"
            ? `the translation has changed since; it is now ${quoted(item.now)}`
            : "the English message has changed or was removed";
      lines.push(
        `- ${message(item.suggestion)}: ${quoted(item.suggestion.text)} by ${who(item.suggestion)}. ${reason}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
