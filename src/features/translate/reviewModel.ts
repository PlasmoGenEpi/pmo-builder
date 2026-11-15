/**
 * The translation review page's model: the catalog's messages grouped by the
 * page they appear on, each with what reviewers have said about its current
 * translation. Pure.
 */
import { messageKey, type PoEntry } from "@/i18n/poFile";

import type { ReviewSuggestion } from "./reviewApi";

/** A part of the app a reviewer can check in one go. */
export interface ReviewGroup {
  readonly id: string;
  readonly title: string;
  /** Where in the app its messages show, for "Open this page". */
  readonly path: string;
}

/** The groups, in the order a user meets them. */
export const GROUPS: readonly ReviewGroup[] = [
  { id: "home", title: "Home page, menus and privacy", path: "/" },
  { id: "microhaplotypes", title: "Step: Microhaplotypes", path: "/build/microhaplotypes" },
  { id: "panel", title: "Step: Panel", path: "/build/panel" },
  { id: "specimens", title: "Steps: Specimens and library samples", path: "/build/specimens" },
  { id: "project", title: "Step: Project", path: "/build/project" },
  { id: "sequencing", title: "Step: Sequencing", path: "/build/sequencing" },
  { id: "bioinformatics", title: "Step: Bioinformatics", path: "/build/bioinformatics" },
  { id: "readCounts", title: "Step: Read counts by stage", path: "/build/read-counts" },
  { id: "review", title: "Step: Review and download", path: "/build/review" },
  {
    id: "tables",
    title: "Adding a table and matching its columns",
    path: "/build/microhaplotypes",
  },
  { id: "forms", title: "Forms and lists in the study steps", path: "/build/project" },
  { id: "checks", title: "Checks and warnings about the PMO", path: "/build/review" },
  { id: "publishing", title: "Publishing on Zenodo", path: "/pmo/publish" },
  { id: "published", title: "Published PMOs", path: "/published" },
  { id: "tools", title: "My PMO file", path: "/pmo" },
  { id: "controls", title: "Buttons and controls used everywhere", path: "/" },
];

/** Which group a source file's messages go in. The first rule that matches wins. */
const RULES: readonly (readonly [RegExp, string])[] = [
  [/^src\/features\/review\/(PublishToZenodo|zenodo)/, "publishing"],
  [/^src\/features\/published\//, "published"],
  [/^src\/features\/pmo-file\/PublishPanel/, "publishing"],
  [/^src\/(features\/pmo-file|domain\/tools)\//, "tools"],
  [/^src\/features\/review\/(noticeKinds|reviewModel|ThingsToCheck)/, "checks"],
  [/^src\/features\/librarySamples\//, "specimens"],
  [/^src\/features\/(table-import)\//, "tables"],
  [/^src\/features\/(records|shared)\//, "forms"],
  [
    /^src\/features\/(microhaplotypes|panel|specimens|project|sequencing|bioinformatics|readCounts|review)\//,
    "$1",
  ],
  [/^src\/domain\/(fields|build)\/(microhaplotypes|panel|readCounts|bioinformatics)\./, "$2"],
  [/^src\/domain\/(fields|build)\/samples\./, "specimens"],
  [/^src\/domain\/build\/runName\./, "sequencing"],
  [/^src\/domain\/(fields\/(records|study)|build\/records)\./, "forms"],
  [/^src\/domain\/(import|matching)\//, "tables"],
  [/^src\/domain\//, "checks"],
  [/^src\/ui\//, "controls"],
];

/** The group a message belongs to, from the first file it is used in. */
export function groupOf(origins: readonly string[]): string {
  const [first] = origins;
  if (first === undefined) return "home";
  for (const [pattern, group] of RULES) {
    const match = pattern.exec(first);
    if (match !== null)
      return group.replaceAll(/\$(\d)/g, (_, index: string) => match[Number(index)] ?? "");
  }
  return "home";
}

/** Where a message stands for the review. */
export type MessageStatus =
  /** Nobody has said anything about its current translation. */
  | "unchecked"
  /** Someone said the current translation looks right, or it was written from a suggestion. */
  | "approved"
  /** Someone suggested a change that has not been taken in yet. */
  | "changes";

/** One message on the page. */
export interface ReviewItem {
  readonly key: string;
  readonly entry: PoEntry;
  readonly group: string;
  /** What reviewers said about the current translation, oldest first. */
  readonly suggestions: readonly ReviewSuggestion[];
  readonly status: MessageStatus;
}

/**
 * Whether a suggestion is about the translation the catalog has now: it was
 * made on it, or the translation was written from it.
 */
function isAboutCurrent(suggestion: ReviewSuggestion, current: string): boolean {
  return (
    suggestion.seen === current || (suggestion.verdict === "edit" && suggestion.text === current)
  );
}

function statusOf(current: string, suggestions: readonly ReviewSuggestion[]): MessageStatus {
  if (
    suggestions.some(
      (suggestion) =>
        suggestion.verdict === "edit" && suggestion.seen === current && suggestion.text !== current,
    )
  ) {
    return "changes";
  }
  return suggestions.length > 0 ? "approved" : "unchecked";
}

/** Pairs each message with what reviewers have said about it. */
export function reviewItems(
  entries: readonly PoEntry[],
  suggestions: readonly ReviewSuggestion[],
): ReviewItem[] {
  const byKey = new Map<string, ReviewSuggestion[]>();
  for (const suggestion of suggestions) {
    const key = messageKey(suggestion);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [suggestion]);
    else list.push(suggestion);
  }
  return entries.map((entry) => {
    const key = messageKey(entry);
    const about = (byKey.get(key) ?? [])
      .filter((suggestion) => isAboutCurrent(suggestion, entry.msgstr))
      .toSorted((a, b) => a.id - b.id);
    return {
      key,
      entry,
      group: groupOf(entry.origins),
      suggestions: about,
      status: statusOf(entry.msgstr, about),
    };
  });
}

/** Counts for a set of items. */
export interface Progress {
  readonly total: number;
  readonly checked: number;
  readonly changes: number;
}

/** How far the review of `items` has got. */
export function progressOf(items: readonly ReviewItem[]): Progress {
  return {
    total: items.length,
    checked: items.filter((item) => item.status !== "unchecked").length,
    changes: items.filter((item) => item.status === "changes").length,
  };
}

/** Which messages to show. */
export type ReviewFilter = "unchecked" | "changes" | "all";

/** The items of one group that pass the filter and match the search text. */
export function visibleItems(
  items: readonly ReviewItem[],
  options: { readonly group: string; readonly filter: ReviewFilter; readonly search: string },
): ReviewItem[] {
  const needle = options.search.trim().toLowerCase();
  return items.filter(
    (item) =>
      (needle === "" ? item.group === options.group : true) &&
      (options.filter === "all" || item.status === options.filter) &&
      (needle === "" ||
        item.entry.msgid.toLowerCase().includes(needle) ||
        item.entry.msgstr.toLowerCase().includes(needle)),
  );
}

/**
 * The bar a language must clear before it is offered to users: every message
 * translated, and nearly every translation checked by a reviewer as it reads
 * now. `pnpm translations status` reports against it.
 */
export const READY_TO_OFFER = { translated: 1, checked: 0.95 } as const;

/** Where one language's translation stands. */
export interface LanguageStatus {
  readonly messages: number;
  /** Messages with a translation. */
  readonly translated: number;
  /** Messages whose current translation a reviewer approved or wrote. */
  readonly checked: number;
  /** Messages with a suggested change not yet taken in. */
  readonly changes: number;
  /** People who have sent anything for this language. */
  readonly reviewers: number;
  /** Whether it clears {@link READY_TO_OFFER}. */
  readonly ready: boolean;
}

/** Where a language stands, from its catalog and every suggestion sent for it. */
export function languageStatus(
  entries: readonly PoEntry[],
  suggestions: readonly ReviewSuggestion[],
): LanguageStatus {
  const items = reviewItems(entries, suggestions);
  const progress = progressOf(items);
  const translated = entries.filter((entry) => entry.msgstr.trim() !== "").length;
  const messages = entries.length;
  return {
    messages,
    translated,
    checked: progress.checked,
    changes: progress.changes,
    reviewers: new Set(suggestions.map((suggestion) => suggestion.reviewer)).size,
    ready:
      messages > 0 &&
      translated / messages >= READY_TO_OFFER.translated &&
      progress.checked / messages >= READY_TO_OFFER.checked,
  };
}
