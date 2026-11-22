import { describe, expect, it, vi } from "vitest";

import {
  citationOf,
  facetCountsOf,
  facetsOf,
  filterDatasets,
  isRepositoryIndex,
  loadCatalogue,
  longDate,
  NO_FILTERS,
  shortAuthors,
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

  it("narrows by one or more countries, by panel and by species", () => {
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, countries: ["Mozambique"] }))).toEqual([
      "301",
      "303",
    ]);
    expect(
      ids(filterDatasets(DATASETS, { ...NO_FILTERS, countries: ["Uganda", "Eswatini"] })),
    ).toEqual(["302", "303"]);
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, panel: "AMPLseq" }))).toEqual([
      "302",
      "303",
    ]);
    expect(
      ids(filterDatasets(DATASETS, { ...NO_FILTERS, panel: "AMPLseq", countries: ["Uganda"] })),
    ).toEqual(["302"]);
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, species: 5855 }))).toEqual(["303"]);
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, species: 5833 }))).toEqual([
      "301",
      "302",
      "303",
    ]);
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, species: 5850 }))).toEqual([]);
  });

  it("keeps the datasets whose collection covers the year", () => {
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, year: 2017 }))).toEqual(["301"]);
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, year: 2021 }))).toEqual(["302"]);
    expect(ids(filterDatasets(DATASETS, { ...NO_FILTERS, year: 2020 }))).toEqual([]);
  });

  it("searches titles, authors, countries, panels, species, covered years, BioProjects and DOIs", () => {
    expect(search("uganda")).toEqual(["302"]);
    expect(search("ACHAN")).toEqual(["302"]);
    expect(search("mozambique mad4hatter")).toEqual(["301", "303"]);
    expect(search("PRJNA0000001")).toEqual(["301"]);
    expect(search("zenodo.303")).toEqual(["303"]);
    expect(search("vivax")).toEqual(["303"]);
    expect(search("P. vivax")).toEqual(["303"]);
    expect(search("falciparum")).toEqual(["301", "302", "303"]);
    expect(search("2017")).toEqual(["301"]);
    expect(search("2021")).toEqual(["302"]);
    expect(search("2020")).toEqual([]);
    expect(search("uganda 2021")).toEqual(["302"]);
    expect(search("  ")).toEqual(["301", "302", "303"]);
    expect(search("uganda mozambique")).toEqual([]);

    const large = largeCatalogue().datasets;
    const vivaxSearch = ids(filterDatasets(large, { ...NO_FILTERS, search: "vivax" }));
    const vivaxFilter = ids(filterDatasets(large, { ...NO_FILTERS, species: 5855 }));
    expect(vivaxSearch.length).toBeGreaterThan(0);
    expect(vivaxSearch).toEqual(vivaxFilter);
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

describe("facetsOf, facetCountsOf and totalsOf", () => {
  it("lists each country, panel, species and covered year once", () => {
    expect(facetsOf(DATASETS)).toEqual({
      countries: ["Eswatini", "Mozambique", "Uganda"],
      panels: ["AMPLseq", "Mad4hatter"],
      species: [5833, 5855],
      years: [2021, 2019, 2018, 2017, 2016, 2015],
    });
  });

  it("sorts species by their display name", () => {
    const mixed = [dataset({ id: "1", taxa: [5855, 5858, 5833] })];
    expect(facetsOf(mixed).species).toEqual([5833, 5858, 5855]);
  });

  it("counts each choice reflecting the other active filters", () => {
    const unfiltered = facetCountsOf(DATASETS, NO_FILTERS);
    expect(Object.fromEntries(unfiltered.countries)).toEqual({
      Eswatini: 1,
      Mozambique: 2,
      Uganda: 1,
    });
    expect(Object.fromEntries(unfiltered.panels)).toEqual({ AMPLseq: 2, Mad4hatter: 2 });
    expect(Object.fromEntries(unfiltered.species)).toEqual({ 5833: 3, 5855: 1 });
    expect(Object.fromEntries(unfiltered.years)).toEqual({
      2021: 1,
      2019: 1,
      2018: 1,
      2017: 1,
      2016: 1,
      2015: 1,
    });

    // Active panel narrows country, species and year counts, while panel choices still show their own totals.
    const byPanel = facetCountsOf(DATASETS, { ...NO_FILTERS, panel: "AMPLseq" });
    expect(Object.fromEntries(byPanel.countries)).toEqual({
      Eswatini: 1,
      Mozambique: 1,
      Uganda: 1,
    });
    expect(Object.fromEntries(byPanel.panels)).toEqual({ AMPLseq: 2, Mad4hatter: 2 });
    expect(Object.fromEntries(byPanel.species)).toEqual({ 5833: 2, 5855: 1 });
    expect(byPanel.years.get(2021)).toBe(1);
    expect(byPanel.years.get(2017)).toBe(0);

    // Active countries narrow panel, species and year counts, while country choices keep their counts under the other filters.
    const byTwoCountries = facetCountsOf(DATASETS, {
      ...NO_FILTERS,
      countries: ["Uganda", "Eswatini"],
    });
    expect(Object.fromEntries(byTwoCountries.countries)).toEqual({
      Eswatini: 1,
      Mozambique: 2,
      Uganda: 1,
    });
    expect(Object.fromEntries(byTwoCountries.panels)).toEqual({ AMPLseq: 2, Mad4hatter: 1 });
    expect(Object.fromEntries(byTwoCountries.species)).toEqual({ 5833: 2, 5855: 1 });
    expect(byTwoCountries.years.get(2021)).toBe(1);
    expect(byTwoCountries.years.get(2017)).toBe(0);

    // Active search narrows every facet including species.
    const bySearch = facetCountsOf(DATASETS, { ...NO_FILTERS, search: "vivax" });
    expect(Object.fromEntries(bySearch.countries)).toEqual({
      Eswatini: 1,
      Mozambique: 1,
      Uganda: 0,
    });
    expect(Object.fromEntries(bySearch.panels)).toEqual({ AMPLseq: 1, Mad4hatter: 1 });
    expect(Object.fromEntries(bySearch.species)).toEqual({ 5833: 1, 5855: 1 });
    expect(bySearch.years.get(2021)).toBe(0);
  });

  it("does not list centuries of years for a mistyped date", () => {
    const odd = dataset({ id: "9", collectionYears: { first: 202, last: 2021 } });
    expect(facetsOf([odd]).years).toHaveLength(101);
  });

  it("adds up the datasets, specimens and countries", () => {
    expect(totalsOf(DATASETS)).toEqual({ datasets: 3, specimens: 1258, countries: 3 });
    expect(
      totalsOf(filterDatasets(DATASETS, { ...NO_FILTERS, countries: ["Mozambique"] })),
    ).toEqual({
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

  it("shortens author lists of more than two to the first author and et al.", () => {
    expect(shortAuthors([])).toBe("");
    expect(shortAuthors(["Achan, Sarah"])).toBe("Achan, Sarah");
    expect(shortAuthors(["Okello, Grace", "Mensah, Kofi"])).toBe("Okello, Grace; Mensah, Kofi");
    expect(shortAuthors(["Okello, Grace", "Mensah, Kofi", "Achan, Sarah"])).toBe(
      "Okello, Grace et al.",
    );
    const many = largeCatalogue(150).datasets.find((entry) => entry.creators.length >= 10);
    expect(many).toBeDefined();
    expect(shortAuthors(many?.creators ?? [])).toBe(`${many?.creators[0]} et al.`);
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
