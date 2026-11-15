import { describe, expect, it, vi } from "vitest";

import {
  citationOf,
  facetsOf,
  filterDatasets,
  isRepositoryIndex,
  loadCatalogue,
  longDate,
  NO_FILTERS,
  taxonName,
  totalsOf,
  yearsText,
} from "./catalogue";
import { catalogue, dataset, DATASETS } from "./testing";

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
