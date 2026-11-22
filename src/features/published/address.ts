/**
 * Pure conversion between the published PMOs list's view state and the query
 * string kept inside the hash route (`#/published?q=...&country=...`).
 */

/** View state of the published PMOs list. */
export interface PublishedListState {
  /** Words searched across each published PMO's metadata. */
  readonly search: string;
  /** Chosen countries; empty means any country. Matches a published PMO in any of them. */
  readonly countries: readonly string[];
  /** Chosen panel, or `null` for any panel. */
  readonly panel: string | null;
  /** Chosen species NCBI taxon identifier, or `null` for any species. */
  readonly species: number | null;
  /** Chosen collection year, or `null` for any year. */
  readonly year: number | null;
}

/** The default, unfiltered list state. Serializes to an empty query string. */
export const DEFAULT_LIST_STATE: PublishedListState = {
  search: "",
  countries: [],
  panel: null,
  species: null,
  year: null,
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
  return params.toString();
}

/** Builds the hash-router path for a list state (`/published`, or `/published?...` when non-default). */
export function publishedHref(state: PublishedListState): string {
  const query = writeListState(state);
  return query === "" ? "/published" : `/published?${query}`;
}
