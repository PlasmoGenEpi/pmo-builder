import { describe, expect, it } from "vitest";

import type { MergeSummary, PublicationSummary } from "@/domain/build";

import { PMO_KEYWORD, suggestRecord, uploadUrl, zenodoCommunity } from "./zenodo";

const SUMMARY: MergeSummary = {
  specimens: 1200,
  librarySamples: 1234,
  librarySamplesWithDetections: 1200,
  panels: 1,
  targets: 276,
  targetsWithCalls: 250,
  genomes: 1,
  sequencingRuns: 1,
  projects: 1,
  bioinformaticsRuns: 1,
  librarySamplesWithReadCounts: 0,
};

const PUBLICATION: PublicationSummary = {
  personalFields: [],
  projects: [
    { name: "MOZ2021", description: "Routine surveillance in Maputo", accession: "PRJNA1040019" },
  ],
  panels: ["Mad4hatter"],
  countries: ["Angola", "Mozambique"],
  collectionYears: { first: 2021, last: 2022 },
  exampleData: false,
};

describe("zenodoCommunity", () => {
  it("accepts an identifier and trims it", () => {
    expect(zenodoCommunity(" plasmogenepi ")).toBe("plasmogenepi");
    expect(zenodoCommunity("pmo-files_2")).toBe("pmo-files_2");
  });

  it("is null when unset or not an identifier", () => {
    expect(zenodoCommunity(undefined)).toBeNull();
    expect(zenodoCommunity("")).toBeNull();
    expect(zenodoCommunity("https://zenodo.org/communities/x")).toBeNull();
    expect(zenodoCommunity("a b")).toBeNull();
  });
});

describe("uploadUrl", () => {
  it("opens a new upload with the community chosen", () => {
    expect(uploadUrl("plasmogenepi")).toBe("https://zenodo.org/uploads/new?community=plasmogenepi");
  });
});

describe("suggestRecord", () => {
  it("names the record after a single project", () => {
    expect(suggestRecord(SUMMARY, PUBLICATION).title).toBe(
      "MOZ2021: microhaplotype data in PMO format",
    );
  });

  it("names the record after its samples and panel without a single project", () => {
    expect(suggestRecord(SUMMARY, { ...PUBLICATION, projects: [] }).title).toBe(
      "Microhaplotype data for 1,234 samples from the Mad4hatter panel in PMO format",
    );
  });

  it("describes the samples, place, time, project and reads", () => {
    expect(suggestRecord(SUMMARY, PUBLICATION).description).toBe(
      "Portable Microhaplotype Object (PMO) file with microhaplotype calls for 1,234 library samples from 1,200 specimens, genotyped with the Mad4hatter panel (276 targets). " +
        "Specimens were collected in Angola and Mozambique between 2021 and 2022. " +
        "MOZ2021: Routine surveillance in Maputo. " +
        "Raw reads: BioProject PRJNA1040019. " +
        "The PMO format is described at https://plasmogenepi.github.io/PMO_Docs/",
    );
  });

  it("leaves out what the PMO does not say", () => {
    const record = suggestRecord(SUMMARY, {
      ...PUBLICATION,
      projects: [],
      countries: [],
      collectionYears: { first: 2021, last: 2021 },
    });
    expect(record.description).toBe(
      "Portable Microhaplotype Object (PMO) file with microhaplotype calls for 1,234 library samples from 1,200 specimens, genotyped with the Mad4hatter panel (276 targets). " +
        "Specimens were collected in 2021. " +
        "The PMO format is described at https://plasmogenepi.github.io/PMO_Docs/",
    );
  });

  it("puts the collection keyword first and adds the panel names", () => {
    expect(suggestRecord(SUMMARY, PUBLICATION).keywords).toEqual([
      PMO_KEYWORD,
      "PMO",
      "microhaplotype",
      "targeted amplicon sequencing",
      "Mad4hatter",
    ]);
  });
});
