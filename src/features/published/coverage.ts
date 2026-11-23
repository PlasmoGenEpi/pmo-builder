/**
 * Pure computation of the country-by-collection-year coverage grid for the
 * Published PMOs list.
 */
import type { PublishedDataset } from "@/domain/repository/types";

import { clampYearRange } from "./catalogue";

/**
 * Smallest catalogue size for which the coverage grid is shown. With fewer
 * published PMOs, the list itself already shows the whole picture.
 */
export const MIN_DATASETS_FOR_COVERAGE = 5;

/** Figures for one country and collection year in the coverage grid. */
export interface CoverageCell {
  readonly country: string;
  readonly year: number;
  /** Total specimens across published PMOs matching this country and year. */
  readonly specimens: number;
  /** Number of published PMOs matching this country and year. */
  readonly datasets: number;
}

/** One row of the coverage grid: one country across every year column. */
export interface CoverageRow {
  readonly country: string;
  /** Cells aligned with `CoverageMatrix.years`, oldest year first. */
  readonly cells: readonly CoverageCell[];
}

/** Country-by-collection-year coverage matrix for a set of published PMOs. */
export interface CoverageMatrix {
  readonly countries: readonly string[];
  /** Contiguous collection years, oldest first. */
  readonly years: readonly number[];
  readonly rows: readonly CoverageRow[];
  /** Highest specimen total in any cell, or `0` when the matrix is empty. */
  readonly maxSpecimens: number;
}

interface QualifyingEntry {
  readonly countries: readonly string[];
  readonly firstYear: number;
  readonly lastYear: number;
  readonly specimens: number;
}

interface MutableCell {
  specimens: number;
  datasets: number;
}

const EMPTY_MATRIX: CoverageMatrix = {
  countries: [],
  years: [],
  rows: [],
  maxSpecimens: 0,
};

/**
 * Summarizes published PMOs into a grid of countries (rows, sorted
 * alphabetically) by contiguous collection years (columns, oldest first).
 * Each cell sums the specimens and count of published PMOs matching that
 * country and year. Entries without a country or collection year are omitted.
 */
export function buildCoverage(datasets: readonly PublishedDataset[]): CoverageMatrix {
  const entries: QualifyingEntry[] = [];
  const countrySet = new Set<string>();
  let minYear = Number.POSITIVE_INFINITY;
  let maxYear = Number.NEGATIVE_INFINITY;

  for (const dataset of datasets) {
    const range = dataset.collectionYears;
    if (range === null || dataset.countries.length === 0) continue;
    const clamped = clampYearRange(range.first, range.last);
    if (clamped === null) continue;

    const uniqueCountries = [...new Set(dataset.countries)];
    for (const country of uniqueCountries) countrySet.add(country);
    if (clamped.first < minYear) minYear = clamped.first;
    if (clamped.last > maxYear) maxYear = clamped.last;
    entries.push({
      countries: uniqueCountries,
      firstYear: clamped.first,
      lastYear: clamped.last,
      specimens: dataset.summary.specimens,
    });
  }

  if (entries.length === 0) return EMPTY_MATRIX;

  const span = clampYearRange(minYear, maxYear);
  if (span === null) return EMPTY_MATRIX;
  const clampedMinYear = span.first;
  const years: number[] = [];
  for (let year = clampedMinYear; year <= span.last; year += 1) years.push(year);

  const countries = [...countrySet].toSorted((a, b) => a.localeCompare(b));
  const countryIndex = new Map<string, number>();
  countries.forEach((country, index) => countryIndex.set(country, index));

  const grid: MutableCell[][] = countries.map(() =>
    years.map(() => ({ specimens: 0, datasets: 0 })),
  );

  for (const entry of entries) {
    const startYear = Math.max(entry.firstYear, clampedMinYear);
    for (const country of entry.countries) {
      const rIndex = countryIndex.get(country);
      if (rIndex === undefined) continue;
      const rowCells = grid[rIndex];
      if (rowCells === undefined) continue;

      for (let year = startYear; year <= entry.lastYear; year += 1) {
        const cell = rowCells[year - clampedMinYear];
        if (cell === undefined) continue;
        cell.specimens += entry.specimens;
        cell.datasets += 1;
      }
    }
  }

  let maxSpecimens = 0;
  const rows: CoverageRow[] = countries.map((country, rIndex) => {
    const rowCells = grid[rIndex] ?? [];
    const cells: CoverageCell[] = years.map((year, cIndex) => {
      const bucket = rowCells[cIndex] ?? { specimens: 0, datasets: 0 };
      if (bucket.specimens > maxSpecimens) maxSpecimens = bucket.specimens;
      return {
        country,
        year,
        specimens: bucket.specimens,
        datasets: bucket.datasets,
      };
    });
    return { country, cells };
  });

  return {
    countries,
    years,
    rows,
    maxSpecimens,
  };
}

/**
 * Position in `[0, 1]` along the sequential colour ramp for a cell's specimen
 * count, on a log scale so both small and large cohorts remain distinguishable.
 */
export function cellIntensity(specimens: number, maxSpecimens: number): number {
  if (specimens <= 0 || maxSpecimens <= 0) return 0;
  const maxLog = Math.log10(maxSpecimens + 1);
  if (maxLog <= 0) return 1;
  return Math.min(1, Math.max(0, Math.log10(specimens + 1) / maxLog));
}
