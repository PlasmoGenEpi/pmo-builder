import { describe, expect, it } from "vitest";

import { filterDatasets, NO_FILTERS } from "./catalogue";
import { buildCoverage, cellIntensity, MIN_DATASETS_FOR_COVERAGE } from "./coverage";
import { dataset, largeCatalogue } from "./testing";

describe("buildCoverage", () => {
  it("uses 5 as the minimum catalogue size for showing coverage", () => {
    expect(MIN_DATASETS_FOR_COVERAGE).toBe(5);
  });

  it("returns an empty matrix for an empty list or entries lacking country or year", () => {
    expect(buildCoverage([])).toEqual({
      countries: [],
      years: [],
      rows: [],
      maxSpecimens: 0,
      populatedCells: 0,
    });

    const incomplete = [
      dataset({ id: "1", countries: ["Kenya"], collectionYears: null }),
      dataset({ id: "2", countries: [], collectionYears: { first: 2020, last: 2020 } }),
    ];
    expect(buildCoverage(incomplete)).toEqual({
      countries: [],
      years: [],
      rows: [],
      maxSpecimens: 0,
      populatedCells: 0,
    });
  });

  it("builds contiguous collection years and sums specimens per country and year without double-counting row totals", () => {
    const entries = [
      dataset({
        id: "1",
        countries: ["Uganda"],
        collectionYears: { first: 2018, last: 2018 },
        summary: { ...dataset({ id: "0" }).summary, specimens: 120 },
      }),
      dataset({
        id: "2",
        countries: ["Kenya", "Uganda"],
        collectionYears: { first: 2015, last: 2016 },
        summary: { ...dataset({ id: "0" }).summary, specimens: 50 },
      }),
      dataset({
        id: "3",
        countries: ["Kenya"],
        collectionYears: { first: 2016, last: 2016 },
        summary: { ...dataset({ id: "0" }).summary, specimens: 300 },
      }),
    ];

    const matrix = buildCoverage(entries);
    expect(matrix.countries).toEqual(["Kenya", "Uganda"]);
    expect(matrix.years).toEqual([2015, 2016, 2017, 2018]);
    expect(matrix.maxSpecimens).toBe(350);
    expect(matrix.populatedCells).toBe(5);

    const [kenya, uganda] = matrix.rows;
    expect(kenya).toEqual({
      country: "Kenya",
      totalSpecimens: 350,
      totalDatasets: 2,
      cells: [
        { country: "Kenya", year: 2015, specimens: 50, datasets: 1 },
        { country: "Kenya", year: 2016, specimens: 350, datasets: 2 },
        { country: "Kenya", year: 2017, specimens: 0, datasets: 0 },
        { country: "Kenya", year: 2018, specimens: 0, datasets: 0 },
      ],
    });
    expect(uganda).toEqual({
      country: "Uganda",
      totalSpecimens: 170,
      totalDatasets: 2,
      cells: [
        { country: "Uganda", year: 2015, specimens: 50, datasets: 1 },
        { country: "Uganda", year: 2016, specimens: 50, datasets: 1 },
        { country: "Uganda", year: 2017, specimens: 0, datasets: 0 },
        { country: "Uganda", year: 2018, specimens: 120, datasets: 1 },
      ],
    });
  });

  it("matches the specimens and counts of filterDatasets for every cell in the 150-entry catalogue", () => {
    const { datasets } = largeCatalogue(150);
    const matrix = buildCoverage(datasets);

    expect(matrix.countries).toHaveLength(26);
    expect(matrix.years[0]).toBe(2008);
    expect(matrix.years.at(-1)).toBe(2026);
    expect(matrix.years).toHaveLength(19);
    expect(matrix.maxSpecimens).toBeGreaterThan(0);
    expect(matrix.populatedCells).toBeGreaterThan(0);

    for (const row of matrix.rows) {
      expect(row.cells).toHaveLength(matrix.years.length);
      for (const cell of row.cells) {
        const matching = filterDatasets(datasets, {
          ...NO_FILTERS,
          countries: [cell.country],
          year: cell.year,
        });
        const expectedSpecimens = matching.reduce((sum, item) => sum + item.summary.specimens, 0);
        expect(cell.datasets).toBe(matching.length);
        expect(cell.specimens).toBe(expectedSpecimens);
      }
    }
  });

  it("clamps typo collection year ranges so one bad year cannot create thousands of columns", () => {
    const entries = [
      dataset({
        id: "1",
        countries: ["Kenya"],
        collectionYears: { first: 202, last: 2020 },
      }),
    ];
    const matrix = buildCoverage(entries);
    expect(matrix.years[0]).toBe(1920);
    expect(matrix.years.at(-1)).toBe(2020);
    expect(matrix.years).toHaveLength(101);
  });
});

describe("cellIntensity", () => {
  it("returns 0 for zero specimens, rises monotonically on a log scale, and reaches 1 at the maximum", () => {
    expect(cellIntensity(0, 1000)).toBe(0);
    expect(cellIntensity(10, 0)).toBe(0);
    expect(cellIntensity(1000, 1000)).toBe(1);
    expect(cellIntensity(1, 1)).toBe(1);

    const low = cellIntensity(20, 10_000);
    const mid = cellIntensity(500, 10_000);
    const high = cellIntensity(5_000, 10_000);
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(high).toBeLessThan(1);
  });
});
