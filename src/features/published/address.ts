/**
 * Pure conversion between the published PMOs list's view state and the query
 * string kept inside the hash route (`#/published?q=...&country=...&sort=...&view=...&shown=...`).
 */
import {
  DEFAULT_SORT,
  isSortOrder,
  NO_FILTERS,
  type CatalogueFilters,
  type SortOrder,
} from "./catalogue";

/** Number of published PMOs rendered at first and added by each "Show more" step. */
export const PAGE_SIZE = 50;

/** The supported layouts for the published PMOs list. */
export const LIST_VIEWS = ["list", "table"] as const;

/** How the published PMOs are laid out: compact list rows or a sortable table. */
export type ListView = (typeof LIST_VIEWS)[number];

/** The default layout: compact list rows. */
export const DEFAULT_VIEW: ListView = "list";

/** Checks whether a string is a supported {@link ListView}. */
export function isListView(value: string): value is ListView {
  return LIST_VIEWS.some((view) => view === value);
}

/** View state of the published PMOs list. */
export interface PublishedListState extends CatalogueFilters {
  /** Order of entries in the list. */
  readonly sort: SortOrder;
  /** Layout of entries: compact list or sortable table. */
  readonly view: ListView;
  /** Maximum number of matching entries currently shown (at least {@link PAGE_SIZE}). */
  readonly shown: number;
}

/** The default, unfiltered list state. Serializes to an empty query string. */
export const DEFAULT_LIST_STATE: PublishedListState = {
  ...NO_FILTERS,
  sort: DEFAULT_SORT,
  view: DEFAULT_VIEW,
  shown: PAGE_SIZE,
};

function nonEmpty(value: string | null): string | null {
  return value !== null && value.trim() !== "" ? value : null;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (value.trim() === "" || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parsePositiveInt(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseSort(raw: string | null): SortOrder {
  return raw !== null && isSortOrder(raw) ? raw : DEFAULT_SORT;
}

function parseView(raw: string | null): ListView {
  return raw !== null && isListView(raw) ? raw : DEFAULT_VIEW;
}

function parseShown(raw: string | null): number {
  const parsed = parsePositiveInt(raw);
  return parsed !== null && parsed > PAGE_SIZE ? parsed : PAGE_SIZE;
}

/** Reads the list's view state from a query string (with or without a leading `?`). */
export function readListState(search: string): PublishedListState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawQuery = params.get("q") ?? "";
  return {
    search: rawQuery.trim() === "" ? "" : rawQuery,
    countries: uniqueNonEmpty(params.getAll("country")),
    panel: nonEmpty(params.get("panel")),
    species: parsePositiveInt(params.get("species")),
    year: parsePositiveInt(params.get("year")),
    sort: parseSort(params.get("sort")),
    view: parseView(params.get("view")),
    shown: parseShown(params.get("shown")),
  };
}

/** Writes the list's view state to a query string without a leading `?`, or `""` for the default state. */
export function writeListState(state: PublishedListState): string {
  const params = new URLSearchParams();
  if (state.search.trim() !== "") params.set("q", state.search);
  for (const country of uniqueNonEmpty(state.countries)) {
    params.append("country", country);
  }
  if (state.panel !== null && state.panel.trim() !== "") params.set("panel", state.panel);
  if (state.species !== null && Number.isSafeInteger(state.species) && state.species > 0) {
    params.set("species", String(state.species));
  }
  if (state.year !== null && Number.isSafeInteger(state.year) && state.year > 0) {
    params.set("year", String(state.year));
  }
  if (state.sort !== DEFAULT_SORT) params.set("sort", state.sort);
  if (state.view !== DEFAULT_VIEW) params.set("view", state.view);
  if (Number.isSafeInteger(state.shown) && state.shown > PAGE_SIZE) {
    params.set("shown", String(state.shown));
  }
  return params.toString();
}

/** Builds the hash-router path for a list state (`/published`, or `/published?...` when non-default). */
export function publishedHref(state: PublishedListState): string {
  const query = writeListState(state);
  return query === "" ? "/published" : `/published?${query}`;
}
