/**
 * Pure conversion between the published PMOs list's view state and the query
 * string kept inside the hash route (`#/published?q=...&country=...&sort=...`).
 */
import { DEFAULT_SORT, isSortOrder, type SortOrder } from "./catalogue";

/** View state of the published PMOs list. */
export interface PublishedListState {
  /** Words searched across each published PMO's metadata. */
  readonly search: string;
  /** Chosen country, or `null` for any country. */
  readonly country: string | null;
  /** Chosen panel, or `null` for any panel. */
  readonly panel: string | null;
  /** Chosen collection year, or `null` for any year. */
  readonly year: number | null;
  /** Order of entries in the list. */
  readonly sort: SortOrder;
}

/** The default, unfiltered list state. Serializes to an empty query string. */
export const DEFAULT_LIST_STATE: PublishedListState = {
  search: "",
  country: null,
  panel: null,
  year: null,
  sort: DEFAULT_SORT,
};

function nonEmpty(value: string | null): string | null {
  return value !== null && value.trim() !== "" ? value : null;
}

function parseYear(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const year = Number(raw);
  return Number.isSafeInteger(year) && year > 0 ? year : null;
}

function parseSort(raw: string | null): SortOrder {
  return raw !== null && isSortOrder(raw) ? raw : DEFAULT_SORT;
}

/** Reads the list's view state from a query string (with or without a leading `?`). */
export function readListState(search: string): PublishedListState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawQuery = params.get("q") ?? "";
  return {
    search: rawQuery.trim() === "" ? "" : rawQuery,
    country: nonEmpty(params.get("country")),
    panel: nonEmpty(params.get("panel")),
    year: parseYear(params.get("year")),
    sort: parseSort(params.get("sort")),
  };
}

/** Writes the list's view state to a query string without a leading `?`, or `""` for the default state. */
export function writeListState(state: PublishedListState): string {
  const params = new URLSearchParams();
  if (state.search.trim() !== "") params.set("q", state.search);
  if (state.country !== null && state.country.trim() !== "") params.set("country", state.country);
  if (state.panel !== null && state.panel.trim() !== "") params.set("panel", state.panel);
  if (state.year !== null && Number.isSafeInteger(state.year) && state.year > 0) {
    params.set("year", String(state.year));
  }
  if (state.sort !== DEFAULT_SORT) params.set("sort", state.sort);
  return params.toString();
}

/** Builds the hash-router path for a list state (`/published`, or `/published?...` when non-default). */
export function publishedHref(state: PublishedListState): string {
  const query = writeListState(state);
  return query === "" ? "/published" : `/published?${query}`;
}
