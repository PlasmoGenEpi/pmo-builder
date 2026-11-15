import { describe, expect, it } from "vitest";

import { summarisePublication, type PublicationSource } from "./publication";

function pmo(specimens: PublicationSource["specimen_info"]): PublicationSource {
  return {
    specimen_info: specimens,
    panel_info: [{ panel_name: "Mad4hatter", reactions: [] }],
    project_info: [
      {
        project_name: "MOZ2021",
        project_description: "Routine surveillance in Maputo",
        BioProject_accession: " PRJNA1040019 ",
      },
    ],
  };
}

describe("summarisePublication", () => {
  it("counts the specimens that hold each personal field", () => {
    const summary = summarisePublication(
      pmo([
        { specimen_name: "s1", host_age: 12, host_sex: "F", lat_lon: "-25.9,32.6" },
        { specimen_name: "s2", host_age: 30, host_subject_name: "P-0042" },
        { specimen_name: "s3", host_age: Number.NaN, host_sex: " ", alternate_identifiers: [] },
      ]),
    );
    expect(summary.personalFields).toEqual([
      { field: "host_subject_name", specimens: 1 },
      { field: "lat_lon", specimens: 1 },
      { field: "host_age", specimens: 2 },
      { field: "host_sex", specimens: 1 },
    ]);
  });

  it("counts a collection date only when it names a day", () => {
    const summary = summarisePublication(
      pmo([
        { specimen_name: "s1", collection_date: "2021-03-15" },
        { specimen_name: "s2", collection_date: "2022-11" },
        { specimen_name: "s3", collection_date: "2019" },
        { specimen_name: "s4", collection_date: null },
      ]),
    );
    expect(summary.personalFields).toEqual([{ field: "collection_date", specimens: 1 }]);
    expect(summary.collectionYears).toEqual({ first: 2019, last: 2022 });
  });

  it("treats pregnancy and travel as personal whichever field holds them", () => {
    const summary = summarisePublication(
      pmo([
        { specimen_name: "s1", gravid: false },
        { specimen_name: "s2", gravidity: 2, has_travel_out_six_month: true },
      ]),
    );
    expect(summary.personalFields).toEqual([
      { field: "gravidity", specimens: 2 },
      { field: "travel_out_six_month", specimens: 1 },
    ]);
  });

  it("lists countries once, sorted, with panels and projects", () => {
    const summary = summarisePublication(
      pmo([
        { specimen_name: "s1", collection_country: "Mozambique" },
        { specimen_name: "s2", collection_country: "Angola " },
        { specimen_name: "s3", collection_country: "Mozambique" },
      ]),
    );
    expect(summary.countries).toEqual(["Angola", "Mozambique"]);
    expect(summary.panels).toEqual(["Mad4hatter"]);
    expect(summary.projects).toEqual([
      {
        name: "MOZ2021",
        description: "Routine surveillance in Maputo",
        accession: "PRJNA1040019",
      },
    ]);
  });

  it("reports nothing personal and no years for bare specimens", () => {
    const summary = summarisePublication({
      specimen_info: [{ specimen_name: "s1" }],
      panel_info: [],
    });
    expect(summary.personalFields).toEqual([]);
    expect(summary.countries).toEqual([]);
    expect(summary.collectionYears).toBeNull();
    expect(summary.projects).toEqual([]);
  });
});
