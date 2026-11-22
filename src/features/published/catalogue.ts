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

function coveredYears(dataset: PublishedDataset): number[] {
  const range = dataset.collectionYears;
  if (range === null) return [];
  // A typo such as the year 202 must not make thousands of choices.
  const first = Math.max(range.first, range.last - 100);
  const years: number[] = [];
  for (let year = first; year <= range.last; year += 1) years.push(year);
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
  return {
    countries: [...countries].toSorted((a, b) => a.localeCompare(b)),
    panels: [...panels].toSorted((a, b) => a.localeCompare(b)),
    species: [...species].toSorted((a, b) => taxonName(a).localeCompare(taxonName(b)) || a - b),
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

function countBy<T>(
  keys: readonly T[],
  datasets: readonly PublishedDataset[],
  valuesOf: (dataset: PublishedDataset) => Iterable<T>,
): Map<T, number> {
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
    countries: countBy(facets.countries, forCountries, (dataset) => dataset.countries),
    panels: countBy(facets.panels, forPanels, (dataset) => dataset.panels),
    species: countBy(facets.species, forSpecies, (dataset) => dataset.taxa),
    years: countBy(facets.years, forYears, coveredYears),
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

/** "2019", or "2015 to 2019". */
export function yearsText(dataset: PublishedDataset): string | null {
  const years = dataset.collectionYears;
  if (years === null) return null;
  const firstYear = years.first;
  const lastYear = years.last;
  return firstYear === lastYear ? String(firstYear) : t`${firstYear} to ${lastYear}`;
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

/** How to cite the dataset: authors, year, title, Zenodo and the DOI. */
export function citationOf(dataset: PublishedDataset): string {
  const authors = dataset.creators.length === 0 ? "" : `${dataset.creators.join("; ")} `;
  const year = /^\d{4}/.exec(dataset.published)?.[0];
  const title = /[.!?]$/.test(dataset.title) ? dataset.title : `${dataset.title}.`;
  return `${authors}${year === undefined ? "" : `(${year}). `}${title} Zenodo. ${doiUrl(dataset) ?? dataset.zenodoUrl}`;
}
