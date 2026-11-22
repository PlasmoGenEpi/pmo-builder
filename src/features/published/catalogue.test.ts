import { describe, expect, it, vi } from "vitest";

import {
  citationOf,
  facetsOf,
  filterDatasets,
  isRepositoryIndex,
  loadCatalogue,
  longDate,
  NO_FILTERS,
  sortDatasets,
  taxonName,
  totalsOf,
  yearsText,
} from "./catalogue";
import { catalogue, dataset, DATASETS, largeCatalogue } from "./testing";

const ids = (datasets: readonly { readonly id: string }[]): string[] =>
  datasets.map((entry) => entry.id);

/** A `fetch` that gives one answer. */
function answer(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

function search(text: string): string[] {
  return ids(filterDatasets(DATASETS, { ...NO_FILTERS, search: text }));
}

describe("loadCatalogue", () => {
  it("reads the catalogue from this site", async () => {
    const send = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(catalogue()))),
    );
    const load = await loadCatalogue(send, "/pmo-builder/");
    expect(send).toHaveBeenCalledExactlyOnceWith("/pmo-builder/repository/index.json");
    expect(load).toEqual({ kind: "ready", index: catalogue() });
  });

  it("tells a copy without a catalogue from one that failed to load", async () => {
    expect(await loadCatalogue(answer(new Response(null, { status: 404 })), "/")).toEqual({
      kind: "missing",
    });
    expect(await loadCatalogue(answer(new Response(null, { status: 500 })), "/")).toEqual({
      kind: "failed",
    });
    expect(await loadCatalogue(answer(new Response("<html>")), "/")).toEqual({ kind: "failed" });
    expect(await loadCatalogue(answer(new Response(JSON.stringify({ version: 99 }))), "/")).toEqual(
      { kind: "failed" },
    );
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));
    expect(await loadCatalogue(offline, "/")).toEqual({ kind: "failed" });
  });
});

describe("isRepositoryIndex", () => {
  it("accepts this version only", () => {
    expect(isRepositoryIndex(catalogue())).toBe(true);
    expect(isRepositoryIndex({ ...catalogue(), version: 2 })).toBe(false);
    expect(isRepositoryIndex({ ...catalogue(), datasets: null })).toBe(false);
    expect(isRepositoryIndex(null)).toBe(false);
  });
});

describe("filterDatasets", () => {
  it("returns everything without filters", () => {
    expect(ids(filterDatasets(DATASETS, NO_FILTERS))).toEqual(["301", "302", "303"]);
  });

  it("narrows by country and by panel", () => {
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, country: "Mozambique" }))).toEqual([
      "301",
      "303",
    ]);
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, panel: "AMPLseq" }))).toEqual([
      "302",
      "303",
    ]);
    expect(
      ids(filterDatasets(DATASETS, { ...NO_FILTERS, panel: "AMPLseq", country: "Uganda" })),
    ).toEqual(["302"]);
  });

  it("keeps the datasets whose collection covers the year", () => {
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, year: 2017 }))).toEqual(["301"]);
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, year: 2021 }))).toEqual(["302"]);
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, year: 2020 }))).toEqual([]);
  });

  it("searches titles, authors, countries, panels, BioProjects and DOIs, all words at once", () => {
    expect(search("uganda")).toEqual(["302"]);
    expect(search("ACHAN")).toEqual(["302"]);
    expect(search("mozambique mad4hatter")).toEqual(["301", "303"]);
    expect(search("PRJNA0000001")).toEqual(["301"]);
    expect(search("zenodo.303")).toEqual(["303"]);
    expect(search("  ")).toEqual(["301", "302", "303"]);
    expect(search("uganda mozambique")).toEqual([]);
  });
});

describe("sortDatasets", () => {
  const baseSummary = dataset({ id: "base" }).summary;
  const sample = [
    dataset({
      id: "oldest-big",
      title: "Zambia sentinel cohort",
      published: "2024-03-10",
      collectionYears: { first: 2018, last: 2022 },
      summary: { ...baseSummary, specimens: 900 },
    }),
    dataset({
      id: "newest-small",
      title: "Angola resistance study",
      published: "2026-10-01",
      collectionYears: { first: 2019, last: 2020 },
      summary: { ...baseSummary, specimens: 40 },
    }),
    dataset({
      id: "mid-latest-year",
      title: "Kenya border survey",
      published: "2025-07-15",
      collectionYears: { first: 2020, last: 2025 },
      summary: { ...baseSummary, specimens: 300 },
    }),
    dataset({
      id: "no-years",
      title: "Benin archive",
      published: "2026-01-20",
      collectionYears: null,
      summary: { ...baseSummary, specimens: 120 },
    }),
  ];

  it("orders by newest published, most specimens, latest collection year or title without mutating input", () => {
    const originalIds = ids(sample);
    expect(ids(sortDatasets(sample, "newest"))).toEqual([
      "newest-small",
      "no-years",
      "mid-latest-year",
      "oldest-big",
    ]);
    expect(ids(sortDatasets(sample, "specimens"))).toEqual([
      "oldest-big",
      "mid-latest-year",
      "no-years",
      "newest-small",
    ]);
    expect(ids(sortDatasets(sample, "year"))).toEqual([
      "mid-latest-year",
      "oldest-big",
      "newest-small",
      "no-years",
    ]);
    expect(ids(sortDatasets(sample, "title"))).toEqual([
      "newest-small",
      "no-years",
      "mid-latest-year",
      "oldest-big",
    ]);
    expect(ids(sample)).toEqual(originalIds);
  });

  it("falls back to newest published when specimens, collection year or title tie", () => {
    const tiedSpecimens = [
      dataset({
        id: "older",
        published: "2024-05-01",
        summary: { ...baseSummary, specimens: 500 },
      }),
      dataset({
        id: "newer",
        published: "2026-02-01",
        summary: { ...baseSummary, specimens: 500 },
      }),
    ];
    expect(ids(sortDatasets(tiedSpecimens, "specimens"))).toEqual(["newer", "older"]);

    const tiedYear = [
      dataset({
        id: "older-2024",
        published: "2024-11-01",
        collectionYears: { first: 2022, last: 2024 },
      }),
      dataset({
        id: "newer-2024",
        published: "2026-04-12",
        collectionYears: { first: 2020, last: 2024 },
      }),
      dataset({
        id: "older-null",
        published: "2024-01-01",
        collectionYears: null,
      }),
      dataset({
        id: "newer-null",
        published: "2025-09-01",
        collectionYears: null,
      }),
    ];
    expect(ids(sortDatasets(tiedYear, "year"))).toEqual([
      "newer-2024",
      "older-2024",
      "newer-null",
      "older-null",
    ]);

    const tiedTitle = [
      dataset({ id: "older-title", title: "Maputo cohort", published: "2023-08-01" }),
      dataset({ id: "newer-title", title: "maputo cohort", published: "2026-06-01" }),
    ];
    expect(ids(sortDatasets(tiedTitle, "title"))).toEqual(["newer-title", "older-title"]);
  });

  it("puts the expected first entries at the top of the made-up 150-entry catalogue", () => {
    const entries = largeCatalogue(150).datasets;

    const byNewest = sortDatasets(entries, "newest");
    expect(byNewest[0]?.id).toBe("10001");
    expect(byNewest[0]?.published).toBe("2026-11-14");
    expect(byNewest[1]?.id).toBe("10002");

    const bySpecimens = sortDatasets(entries, "specimens");
    const maxSpecimens = Math.max(...entries.map((entry) => entry.summary.specimens));
    expect(bySpecimens[0]?.summary.specimens).toBe(maxSpecimens);
    expect(bySpecimens[0]?.summary.specimens).toBeGreaterThanOrEqual(
      bySpecimens[1]?.summary.specimens ?? 0,
    );

    const byYear = sortDatasets(entries, "year");
    expect(byYear[0]?.collectionYears?.last).toBe(2026);
    expect(byYear[1]?.collectionYears?.last).toBe(2026);
    expect((byYear[0]?.published ?? "") >= (byYear[1]?.published ?? "")).toBe(true);
    const first2026 = entries.find((entry) => entry.collectionYears?.last === 2026);
    expect(byYear[0]?.id).toBe(first2026?.id);

    const byTitle = sortDatasets(entries, "title");
    expect(byTitle[0]?.title.startsWith("Angola ")).toBe(true);
    expect(
      (byTitle[0]?.title ?? "").localeCompare(byTitle[1]?.title ?? "", "en", {
        sensitivity: "base",
        numeric: true,
      }),
    ).toBeLessThanOrEqual(0);
  });
});

describe("facetsOf and totalsOf", () => {
  it("lists each country, panel and covered year once", () => {
    expect(facetsOf(DATASETS)).toEqual({
      countries: ["Eswatini", "Mozambique", "Uganda"],
      panels: ["AMPLseq", "Mad4hatter"],
      years: [2021, 2019, 2018, 2017, 2016, 2015],
    });
  });

  it("does not list centuries of years for a mistyped date", () => {
    const odd = dataset({ id: "9", collectionYears: { first: 202, last: 2021 } });
    expect(facetsOf([odd]).years).toHaveLength(101);
  });

  it("adds up the datasets, specimens and countries", () => {
    expect(totalsOf(DATASETS)).toEqual({ datasets: 3, specimens: 1258, countries: 3 });
    expect(totalsOf(filterDatasets(DATASETS, { ...NO_FILTERS, country: "Mozambique" }))).toEqual({
      datasets: 2,
      specimens: 58,
      countries: 2,
    });
    expect(totalsOf(filterDatasets(DATASETS, { ...NO_FILTERS, search: "uganda" }))).toEqual({
      datasets: 1,
      specimens: 1200,
      countries: 1,
    });
    expect(totalsOf([])).toEqual({ datasets: 0, specimens: 0, countries: 0 });
  });
});

describe("wording", () => {
  it("names the common parasites and falls back to the identifier", () => {
    expect(taxonName(5833)).toBe("Plasmodium falciparum");
    expect(taxonName(5855)).toBe("Plasmodium vivax");
    expect(taxonName(9606)).toBe("NCBI taxon 9606");
  });

  it("writes years and dates in words", () => {
    expect(yearsText(dataset({ id: "1" }))).toBe("2015 to 2019");
    expect(yearsText(dataset({ id: "1", collectionYears: { first: 2021, last: 2021 } }))).toBe(
      "2021",
    );
    expect(yearsText(dataset({ id: "1", collectionYears: null }))).toBeNull();
    expect(longDate("2026-11-14")).toBe("14 November 2026");
    expect(longDate("2026-11-15T03:00:00.000Z")).toBe("15 November 2026");
    expect(longDate("2026")).toBe("2026");
  });

  it("writes a citation with authors, year, title and DOI", () => {
    expect(citationOf(dataset({ id: "301", title: "Maputo surveillance" }))).toBe(
      "Okello, Grace; Mensah, Kofi (2026). Maputo surveillance. Zenodo. https://doi.org/10.5281/zenodo.301",
    );
    expect(citationOf(dataset({ id: "5", title: "Done?", creators: [], doi: null }))).toBe(
      "(2026). Done? Zenodo. https://zenodo.org/records/5",
    );
  });
});

describe("largeCatalogue", () => {
  it("produces a deterministic 150-entry catalogue covering the expected distributions", () => {
    const first = largeCatalogue();
    const second = largeCatalogue();
    expect(first).toEqual(second);
    expect(first.datasets).toHaveLength(150);

    const facets = facetsOf(first.datasets);
    expect(facets.countries).toHaveLength(26);
    expect(facets.panels).toHaveLength(8);
    expect(facets.years[0]).toBe(2026);
    expect(facets.years.at(-1)).toBe(2008);

    const totals = totalsOf(first.datasets);
    expect(totals.specimens).toBeGreaterThan(100_000);
    expect(first.datasets.some((entry) => entry.title.length > 120)).toBe(true);
    expect(first.datasets.some((entry) => entry.countries.length === 5)).toBe(true);
    expect(first.datasets.some((entry) => entry.creators.length === 1)).toBe(true);
    expect(first.datasets.some((entry) => entry.creators.length === 2)).toBe(true);
    expect(first.datasets.some((entry) => entry.creators.length >= 10)).toBe(true);
    expect(first.datasets.some((entry) => entry.taxa.includes(5855))).toBe(true);
    expect(first.datasets.some((entry) => entry.taxa.includes(5833))).toBe(true);
  });
});
