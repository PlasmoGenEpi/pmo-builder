import { describe, expect, it } from "vitest";

import type { MergeSummary, PublicationSummary } from "@/domain/build";

import {
  formatCreators,
  parseCreator,
  parseCreators,
  PMO_KEYWORD,
  suggestRecord,
  uploadUrl,
  zenodoCommunity,
  zenodoRecordId,
} from "./zenodo";

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
    {
      name: "MOZ2021",
      description: "Routine surveillance in Maputo",
      accession: "PRJNA1040019",
      people: ["Grace Okello", "José Silva", "Okello, Grace", "Aoife O'Neil"],
    },
  ],
  panels: ["Mad4hatter"],
  countries: ["Angola", "Mozambique"],
  collectionYears: { first: 2021, last: 2022 },
  exampleData: false,
};

describe("zenodoCommunity", () => {
  it("accepts an identifier and trims it", () => {
    expect(zenodoCommunity(" pmocommunity ")).toBe("pmocommunity");
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
    expect(uploadUrl("pmocommunity")).toBe("https://zenodo.org/uploads/new?community=pmocommunity");
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

describe("authors", () => {
  it("suggests the project's people once each, as family and given names", () => {
    const record = suggestRecord(SUMMARY, PUBLICATION);
    expect(record.creators).toEqual([
      { family: "Okello", given: "Grace" },
      { family: "Silva", given: "José" },
      { family: "O'Neil", given: "Aoife" },
    ]);
    expect(record.accessions).toEqual(["PRJNA1040019"]);
  });

  it("reads an author written either way", () => {
    expect(parseCreator("Okello, Grace")).toEqual({ family: "Okello", given: "Grace" });
    expect(parseCreator("  Grace   Akinyi Okello ")).toEqual({
      family: "Okello",
      given: "Grace Akinyi",
    });
    expect(parseCreator("Diène")).toEqual({ family: "Diène", given: "" });
    expect(parseCreator(", Grace")).toEqual({ family: "Grace", given: "" });
    expect(parseCreator("  ")).toBeNull();
  });

  it("reads and writes one author to a line", () => {
    const creators = parseCreators("Okello, Grace\n\nJosé Silva\r\nDiène\n");
    expect(creators).toEqual([
      { family: "Okello", given: "Grace" },
      { family: "Silva", given: "José" },
      { family: "Diène", given: "" },
    ]);
    expect(formatCreators(creators)).toBe("Okello, Grace\nSilva, José\nDiène");
  });
});

describe("zenodoRecordId", () => {
  it("reads a record address, a DOI or a number", () => {
    expect(zenodoRecordId("https://zenodo.org/records/24237928")).toBe("24237928");
    expect(zenodoRecordId("zenodo.org/record/24237928")).toBe("24237928");
    expect(zenodoRecordId("https://zenodo.org/uploads/24237928")).toBe("24237928");
    expect(zenodoRecordId("https://doi.org/10.5281/zenodo.24237928")).toBe("24237928");
    expect(zenodoRecordId("10.5281/zenodo.24237928")).toBe("24237928");
    expect(zenodoRecordId(" 24237928 ")).toBe("24237928");
  });

  it("is null for anything else", () => {
    expect(zenodoRecordId("")).toBeNull();
    expect(zenodoRecordId("https://example.org/records/1")).toBeNull();
    expect(zenodoRecordId("10.1000/xyz123")).toBeNull();
  });
});
