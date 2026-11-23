/**
 * Reading and searching the catalogue of published PMOs. The catalogue is a
 * file on this site, written by the harvester; nothing here contacts Zenodo.
 */
import { t } from "@lingui/core/macro";

import { intlLocale } from "@/i18n/languages";
import {
  INDEX_VERSION,
  REPOSITORY_PATH,
  type PublishedDataset,
  type RepositoryIndex,
} from "@/domain/repository/types";

/** What loading the catalogue gave. `missing` means this copy of the app has none. */
export type CatalogueLoad =
  | { readonly kind: "ready"; readonly index: RepositoryIndex }
  | { readonly kind: "missing" }
  | { readonly kind: "failed" };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks that a parsed file is a catalogue this version of the app reads.
 * The entries are trusted beyond that: the same build wrote them.
 */
export function isRepositoryIndex(value: unknown): value is RepositoryIndex {
  return (
    isRecord(value) &&
    value["version"] === INDEX_VERSION &&
    typeof value["harvestedAt"] === "string" &&
    typeof value["community"] === "string" &&
    Array.isArray(value["datasets"])
  );
}

/** Fetches the catalogue from this site. */
export async function loadCatalogue(
  send: typeof fetch = globalThis.fetch,
  base: string = import.meta.env.BASE_URL,
): Promise<CatalogueLoad> {
  try {
    const response = await send(`${base}${REPOSITORY_PATH}/index.json`);
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "failed" };
    const parsed: unknown = await response.json();
    return isRepositoryIndex(parsed) ? { kind: "ready", index: parsed } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** What the list can be narrowed by. Empty or `null` means no limit. */
export interface CatalogueFilters {
  /** Words that must all appear in the title, authors, panels, countries, species, covered years, BioProjects or DOI. */
  readonly search: string;
  /** Chosen countries; matches a published PMO in any of them. Empty means any country. */
  readonly countries: readonly string[];
  readonly panel: string | null;
  /** NCBI taxon identifier, or `null` for any species. */
  readonly species: number | null;
  /** A year the collection must cover. */
  readonly year: number | null;
}

/** No limits. */
export const NO_FILTERS: CatalogueFilters = {
  search: "",
  countries: [],
  panel: null,
  species: null,
  year: null,
};

/** Maximum year span retained when clamping mistyped collection years. */
export const MAX_YEAR_SPAN = 100;

/**
 * Clamps a `[first, last]` year span to at most {@link MAX_YEAR_SPAN} years
 * ending at `last`, so a typo such as the year `202` cannot produce thousands
 * of choices or columns. Returns `null` when `first > last`.
 */
export function clampYearRange(
  first: number,
  last: number,
): { readonly first: number; readonly last: number } | null {
  if (first > last) return null;
  return { first: Math.max(first, last - MAX_YEAR_SPAN), last };
}

function coveredYears(dataset: PublishedDataset): number[] {
  const range = dataset.collectionYears;
  if (range === null) return [];
  const clamped = clampYearRange(range.first, range.last);
  if (clamped === null) return [];
  const years: number[] = [];
  for (let year = clamped.first; year <= clamped.last; year += 1) years.push(year);
  return years;
}

function searchableSpecies(taxa: readonly number[]): string[] {
  const terms: string[] = [];
  for (const taxon of taxa) {
    const name = taxonName(taxon);
    terms.push(name);
    if (name.startsWith("Plasmodium ")) {
      terms.push(`P. ${name.slice("Plasmodium ".length)}`);
    }
  }
  return terms;
}

function searchable(dataset: PublishedDataset): string {
  return [
    dataset.title,
    ...dataset.creators,
    ...dataset.panels,
    ...dataset.countries,
    ...searchableSpecies(dataset.taxa),
    ...coveredYears(dataset).map(String),
    ...dataset.bioProjects,
    dataset.doi ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** The datasets that pass every filter, in the catalogue's order. */
export function filterDatasets(
  datasets: readonly PublishedDataset[],
  filters: CatalogueFilters,
): PublishedDataset[] {
  const words = filters.search.toLowerCase().split(/\s+/).filter(Boolean);
  return datasets.filter((dataset) => {
    if (
      filters.countries.length > 0 &&
      !filters.countries.some((country) => dataset.countries.includes(country))
    ) {
      return false;
    }
    if (filters.panel !== null && !dataset.panels.includes(filters.panel)) return false;
    if (filters.species !== null && !dataset.taxa.includes(filters.species)) return false;
    if (filters.year !== null) {
      const years = dataset.collectionYears;
      if (years === null || filters.year < years.first || filters.year > years.last) return false;
    }
    if (words.length === 0) return true;
    const text = searchable(dataset);
    return words.every((word) => text.includes(word));
  });
}

/** The supported orders for the published PMOs list. */
export const SORT_ORDERS = ["newest", "specimens", "year", "title"] as const;

/** How the published PMOs list can be ordered. */
export type SortOrder = (typeof SORT_ORDERS)[number];

/** The default list order: newest published first. */
export const DEFAULT_SORT: SortOrder = "newest";

/** Checks whether a string is a supported {@link SortOrder}. */
export function isSortOrder(value: string): value is SortOrder {
  return SORT_ORDERS.some((order) => order === value);
}

function comparePublishedDesc(a: PublishedDataset, b: PublishedDataset): number {
  if (a.published === b.published) return 0;
  return b.published > a.published ? 1 : -1;
}

function compareLatestYearDesc(a: PublishedDataset, b: PublishedDataset): number {
  const aLast = a.collectionYears?.last ?? null;
  const bLast = b.collectionYears?.last ?? null;
  if (aLast === null && bLast === null) return 0;
  if (aLast === null) return 1;
  if (bLast === null) return -1;
  return bLast - aLast;
}

/**
 * Returns the datasets in the chosen order without mutating the input.
 * Ties in specimens, latest collection year or title fall back to newest published.
 */
export function sortDatasets(
  datasets: readonly PublishedDataset[],
  sort: SortOrder,
): PublishedDataset[] {
  if (sort === "newest") {
    return datasets.toSorted(comparePublishedDesc);
  }
  const locale = intlLocale();
  return datasets.toSorted((a, b) => {
    let primary = 0;
    if (sort === "specimens") {
      primary = b.summary.specimens - a.summary.specimens;
    } else if (sort === "year") {
      primary = compareLatestYearDesc(a, b);
    } else {
      primary = a.title.localeCompare(b.title, locale, { sensitivity: "base", numeric: true });
    }
    return primary !== 0 ? primary : comparePublishedDesc(a, b);
  });
}

/** The values the filters can take, each sorted. */
export interface CatalogueFacets {
  readonly countries: readonly string[];
  readonly panels: readonly string[];
  /** Distinct NCBI taxon identifiers present in the datasets, sorted by species name. */
  readonly species: readonly number[];
  /** Every year some dataset's collection covers, newest first. */
  readonly years: readonly number[];
}

/** The filter choices a set of datasets offers. */
export function facetsOf(datasets: readonly PublishedDataset[]): CatalogueFacets {
  const countries = new Set<string>();
  const panels = new Set<string>();
  const species = new Set<number>();
  const years = new Set<number>();
  for (const dataset of datasets) {
    for (const country of dataset.countries) countries.add(country);
    for (const panel of dataset.panels) panels.add(panel);
    for (const taxon of dataset.taxa) species.add(taxon);
    for (const year of coveredYears(dataset)) years.add(year);
  }
  const locale = intlLocale();
  return {
    countries: [...countries].toSorted((a, b) => a.localeCompare(b, locale)),
    panels: [...panels].toSorted((a, b) => a.localeCompare(b, locale)),
    species: [...species].toSorted(
      (a, b) => taxonName(a).localeCompare(taxonName(b), locale) || a - b,
    ),
    years: [...years].toSorted((a, b) => b - a),
  };
}

/** Number of published PMOs each filter choice would give with the other filters as they are. */
export interface FacetCounts {
  readonly countries: ReadonlyMap<string, number>;
  readonly panels: ReadonlyMap<string, number>;
  readonly species: ReadonlyMap<number, number>;
  readonly years: ReadonlyMap<number, number>;
}

function countBy<T>({
  keys,
  datasets,
  valuesOf,
}: {
  readonly keys: readonly T[];
  readonly datasets: readonly PublishedDataset[];
  readonly valuesOf: (dataset: PublishedDataset) => Iterable<T>;
}): Map<T, number> {
  const counts = new Map<T, number>();
  for (const key of keys) counts.set(key, 0);
  for (const dataset of datasets) {
    const seen = new Set<T>();
    for (const value of valuesOf(dataset)) {
      if (seen.has(value)) continue;
      seen.add(value);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Counts how many published PMOs each filter choice produces while holding all
 * other active filters (including search) in place.
 */
export function facetCountsOf(
  datasets: readonly PublishedDataset[],
  filters: CatalogueFilters,
): FacetCounts {
  const facets = facetsOf(datasets);
  const forCountries = filterDatasets(datasets, { ...filters, countries: [] });
  const forPanels = filterDatasets(datasets, { ...filters, panel: null });
  const forSpecies = filterDatasets(datasets, { ...filters, species: null });
  const forYears = filterDatasets(datasets, { ...filters, year: null });

  return {
    countries: countBy({
      keys: facets.countries,
      datasets: forCountries,
      valuesOf: (dataset) => dataset.countries,
    }),
    panels: countBy({
      keys: facets.panels,
      datasets: forPanels,
      valuesOf: (dataset) => dataset.panels,
    }),
    species: countBy({
      keys: facets.species,
      datasets: forSpecies,
      valuesOf: (dataset) => dataset.taxa,
    }),
    years: countBy({
      keys: facets.years,
      datasets: forYears,
      valuesOf: coveredYears,
    }),
  };
}

/** The numbers at the top of the list. */
export function totalsOf(datasets: readonly PublishedDataset[]): {
  readonly datasets: number;
  readonly specimens: number;
  readonly countries: number;
} {
  return {
    datasets: datasets.length,
    specimens: datasets.reduce((sum, dataset) => sum + dataset.summary.specimens, 0),
    countries: facetsOf(datasets).countries.length,
  };
}

const TAXA: Readonly<Record<number, string>> = {
  5820: "Plasmodium",
  5833: "Plasmodium falciparum",
  5850: "Plasmodium knowlesi",
  5855: "Plasmodium vivax",
  5858: "Plasmodium malariae",
  36329: "Plasmodium falciparum 3D7",
  36330: "Plasmodium ovale",
};

/** A species name for the common malaria parasites, or the identifier itself. */
export function taxonName(taxon: number): string {
  return TAXA[taxon] ?? t`NCBI taxon ${taxon}`;
}

/** Formats a collection year span as `"2019"` when single-year, or `"2015 to 2019"`. */
export function formatYearRange(firstYear: number, lastYear: number): string {
  return firstYear === lastYear ? String(firstYear) : t`${firstYear} to ${lastYear}`;
}

/** "2019", or "2015 to 2019". */
export function yearsText(dataset: PublishedDataset): string | null {
  const years = dataset.collectionYears;
  return years === null ? null : formatYearRange(years.first, years.last);
}

/** A date such as "14 November 2026" from `YYYY-MM-DD`, or the text as given. */
export function longDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(intlLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** The address of the DOI, or `null` when the record has none. */
export function doiUrl(dataset: PublishedDataset): string | null {
  return dataset.doi === null ? null : `https://doi.org/${dataset.doi}`;
}

/**
 * Formats an author list for compact views: empty when none, joined with `"; "`
 * for one or two authors, or the first author followed by `"et al."` when more
 * than two.
 */
export function shortAuthors(creators: readonly string[]): string {
  const firstAuthor = creators[0];
  if (firstAuthor === undefined) return "";
  if (creators.length <= 2) return creators.join("; ");
  return t({
    message: `${firstAuthor} et al.`,
    comment: "First author followed by et al. when there are more than two authors",
  });
}

/** How to cite the dataset: authors, year, title, Zenodo and the DOI. */
export function citationOf(dataset: PublishedDataset): string {
  const authors = dataset.creators.length === 0 ? "" : `${dataset.creators.join("; ")} `;
  const year = /^\d{4}/.exec(dataset.published)?.[0];
  const title = /[.!?]$/.test(dataset.title) ? dataset.title : `${dataset.title}.`;
  return `${authors}${year === undefined ? "" : `(${year}). `}${title} Zenodo. ${doiUrl(dataset) ?? dataset.zenodoUrl}`;
}
