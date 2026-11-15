/**
 * Small facts about a panel that the build and the panel page must agree on:
 * its name, the label its notices carry, and a key for its content.
 */
import { t } from "@lingui/core/macro";

import type { PanelEntry } from "./model";

/** The name a panel goes by: its saved panel's name, or the name typed in. */
export function panelEntryName(entry: PanelEntry): string {
  return (entry.source === "saved" ? (entry.saved?.name ?? "") : entry.name).trim();
}

/** The label the build puts in front of a panel's notices: `Panel "x"`, or `Panel 2` with no name. */
export function panelLabel(entry: PanelEntry, index: number): string {
  const name = panelEntryName(entry);
  const position = index + 1;
  return name === ""
    ? t({
        message: `Panel ${position}`,
        comment: "A panel with no name yet, by its place in the list.",
      })
    : t({ message: `Panel "${name}"`, comment: "A panel, by its name." });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item: unknown) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A short key for a panel fragment's content. Two fragments with the same
 * data get the same key, whatever the order of their object keys, so the
 * panel page can tell whether a built panel is already in the library.
 */
export function panelContentKey(fragment: unknown): string {
  const text = canonicalJson(fragment);
  // cyrb53: a fast 53-bit string hash. Not for security; only to compare content.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length.toString(36)}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}
