/**
 * What the panel page works out from the draft and the latest build: each
 * panel's name as the build labels it, its notices, its status, and whether
 * its target table gives positions on the genome.
 */
import {
  panelEntryName,
  panelLabel,
  type PanelEntry,
  type SavedPanelSummary,
} from "@/domain/draft";
import type { Notice, SectionStatus } from "@/domain/types";

/** Fields of the target table that place a target on the genome. */
export const POSITION_FIELDS = [
  "forwardPrimersStart",
  "forwardPrimersEnd",
  "reversePrimersStart",
  "reversePrimersEnd",
  "insertStart",
  "insertEnd",
] as const;

/** Codes that mean something is still missing rather than wrong. */
const MISSING_CODES: ReadonlySet<string> = new Set([
  "panel/missing-name",
  "panel/empty",
  "panel/no-saved-panel",
  "table/not-imported",
  "genome/missing",
  "form/missing-required",
  "mapping/missing-required",
  "mapping/incomplete-group",
]);

/** Codes about the panel's reference genome. */
const GENOME_CODES: ReadonlySet<string> = new Set([
  "genome/missing",
  "panel/invalid-genome-info",
  "panel/location-without-genome",
]);

/** The name a panel goes by: its saved panel's name, or the name typed in. */
export function panelName(entry: PanelEntry): string {
  return panelEntryName(entry);
}

/** The panel's title on screen: its name, or "Panel 2" when it has none yet. */
export function panelTitle(entry: PanelEntry, index: number): string {
  const name = panelName(entry);
  return name === "" ? `Panel ${index + 1}` : name;
}

/** Whether nothing has been entered for a panel. Mirrors the build's own test. */
export function isPanelEmpty(entry: PanelEntry): boolean {
  if (entry.source === "saved") return entry.saved === null;
  return entry.name.trim() === "" && entry.table === null && entry.genome.mode === "none";
}

/**
 * The notices of the panel section that are about one panel, found by the
 * panel's id. The panel's label is taken off the front of each message,
 * since they are shown inside the panel.
 */
export function noticesForPanel(
  notices: readonly Notice[],
  entry: PanelEntry,
  index: number,
): Notice[] {
  const lead = `${panelLabel(entry, index)}: `;
  return notices.flatMap((notice) => {
    if (notice.panelId !== entry.id) return [];
    return notice.message.startsWith(lead)
      ? [{ ...notice, message: notice.message.slice(lead.length) }]
      : [notice];
  });
}

/**
 * Where a built panel stands in the library: `saved` when a saved panel has
 * the same name and the same content, `name-taken` when one has the same name
 * but other content, and `new` otherwise.
 */
export type LibraryMatch =
  | { readonly kind: "saved" }
  | { readonly kind: "name-taken"; readonly existing: SavedPanelSummary }
  | { readonly kind: "new" };

/** Looks up a built panel in the library by its name and its content key. */
export function matchInLibrary(
  library: readonly SavedPanelSummary[],
  panel: { readonly name: string; readonly contentKey: string },
): LibraryMatch {
  const named = library.filter((saved) => saved.name === panel.name);
  if (named.some((saved) => saved.contentKey === panel.contentKey)) return { kind: "saved" };
  const existing = named[0];
  return existing === undefined ? { kind: "new" } : { kind: "name-taken", existing };
}

/** One panel's status from its own notices. */
export function panelStatus(entry: PanelEntry, notices: readonly Notice[]): SectionStatus {
  if (isPanelEmpty(entry)) return "empty";
  const errors = notices.filter((notice) => notice.severity === "error");
  if (errors.length === 0) return "ready";
  return errors.every((notice) => MISSING_CODES.has(notice.code)) ? "incomplete" : "error";
}

/** The first notice with one of these codes, or `null`. */
export function findNotice(notices: readonly Notice[], codes: readonly string[]): Notice | null {
  return notices.find((notice) => codes.includes(notice.code)) ?? null;
}

/** Notices about the genome: missing, incomplete, or needed for positions. */
export function genomeNotices(notices: readonly Notice[], genomeTableId: string | null): Notice[] {
  return notices.filter(
    (notice) =>
      GENOME_CODES.has(notice.code) || (genomeTableId !== null && notice.tableId === genomeTableId),
  );
}

/** The labels of the position fields mapped in a panel's target table. */
export function mappedPositionFields(entry: PanelEntry): string[] {
  const fields = entry.table?.mapping.fields ?? {};
  return POSITION_FIELDS.filter((key) => {
    const column = fields[key];
    return column !== null && column !== undefined && column !== "";
  });
}

/** A date such as "14 Nov 2026" from an ISO time, or the text as it is when unreadable. */
export function formatSavedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

/** "1 target" or "276 targets". */
export function countTargets(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "target" : "targets"}`;
}
