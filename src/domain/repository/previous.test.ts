import { describe, expect, it } from "vitest";

import type { MergeSummary } from "@/domain/build";

import { parsePrevious } from "./previous";
import { INDEX_VERSION, type PublishedDataset, type SpecimenRow } from "./types";

const SUMMARY: MergeSummary = {
  specimens: 1,
  librarySamples: 1,
  librarySamplesWithDetections: 1,
  panels: 1,
  targets: 1,
  targetsWithCalls: 1,
  genomes: 0,
  sequencingRuns: 1,
  projects: 1,
  bioinformaticsRuns: 1,
  librarySamplesWithReadCounts: 0,
};

const SPECIMEN: SpecimenRow = {
  dataset: "301",
  specimen: "s1",
  country: "Mozambique",
  date: "2019-01",
  taxa: [5833],
  librarySamples: 1,
};

function previousDataset(
  fields: Partial<PublishedDataset> & { readonly id: string },
): PublishedDataset {
  return {
    title: `Dataset ${fields.id}`,
    creators: ["Okello, Grace"],
    published: "2026-11-14",
    version: null,
    licence: { id: "cc-by-4.0", title: "Creative Commons Attribution 4.0 International" },
    doi: `10.5281/zenodo.${fields.id}`,
    zenodoUrl: `https://zenodo.org/records/${fields.id}`,
    file: {
      name: "study.pmo.json.gz",
      size: 1234,
      url: `https://zenodo.org/api/records/${fields.id}/files/study.pmo.json.gz/content`,
      fingerprint: JSON.stringify([
        "checksum",
        fields.id,
        "study.pmo.json.gz",
        1234,
        `md5:${fields.id}`,
      ]),
    },
    summary: SUMMARY,
    panels: ["Panel1"],
    countries: ["Mozambique"],
    collectionYears: { first: 2015, last: 2019 },
    taxa: [5833],
    bioProjects: [],
    ...fields,
  };
}

function validPrevious(
  datasets: readonly unknown[] = [previousDataset({ id: "301" })],
  specimens: unknown = [SPECIMEN],
) {
  return {
    index: {
      version: INDEX_VERSION,
      harvestedAt: "2026-11-15T03:00:00.000Z",
      community: "pmocommunity",
      datasets,
    },
    specimens,
  };
}

describe("parsePrevious", () => {
  it("indexes datasets and specimen rows when the catalogue is valid", () => {
    const withNullYears = previousDataset({ id: "302", collectionYears: null });
    const parsed = parsePrevious(
      validPrevious([previousDataset({ id: "301" }), withNullYears], [SPECIMEN]),
      "pmocommunity",
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.datasets.get("301")?.collectionYears).toEqual({ first: 2015, last: 2019 });
    expect(parsed?.datasets.get("302")?.collectionYears).toBeNull();
    expect(parsed?.specimens.get("301")).toEqual([SPECIMEN]);
  });

  it("returns null for wrong version, wrong community, or invalid collectionYears", () => {
    const base = validPrevious();
    expect(parsePrevious(undefined, "pmocommunity")).toBeNull();
    expect(
      parsePrevious({ ...base, index: { ...base.index, version: 1 } }, "pmocommunity"),
    ).toBeNull();
    expect(parsePrevious(base, "other")).toBeNull();

    for (const badYears of ["2015-2019", { first: "2015", last: 2019 }, { first: 2015 }, 42]) {
      const badEntry = { ...previousDataset({ id: "301" }), collectionYears: badYears };
      expect(
        parsePrevious(
          { index: { ...base.index, datasets: [badEntry] }, specimens: [SPECIMEN] },
          "pmocommunity",
        ),
      ).toBeNull();
    }
  });

  it("returns null when a summary field or specimen row has the wrong shape", () => {
    const base = validPrevious();
    const badSummary = {
      ...previousDataset({ id: "301" }),
      summary: { ...SUMMARY, specimens: "50" },
    };
    expect(
      parsePrevious(
        { index: { ...base.index, datasets: [badSummary] }, specimens: [SPECIMEN] },
        "pmocommunity",
      ),
    ).toBeNull();
    expect(
      parsePrevious({ ...base, specimens: [{ ...SPECIMEN, taxa: ["5833"] }] }, "pmocommunity"),
    ).toBeNull();
  });
});
