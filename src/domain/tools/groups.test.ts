import { describe, expect, it } from "vitest";

import { compareGroups } from "./groups";
import { controlKind, groupFieldsOf, groupValue } from "./sampleDetails";
import { summaryOf } from "./summary";
import { richPmo } from "./testing";

const PMO = richPmo();

describe("controlKind", () => {
  it.each([
    ["negative_control", "negative"],
    ["Negative Control", "negative"],
    ["positive_control", "positive"],
    ["extraction_control", "other"],
    ["field_sample", null],
    [null, null],
  ])("reads %s as %s", (type, kind) => {
    expect(controlKind(type)).toBe(kind);
  });
});

describe("the summary's optional details", () => {
  const summary = summaryOf(PMO, 0);
  const [s1, s2, s3] = summary.samples;

  it("marks controls, and only controls", () => {
    expect([s1?.control, s2?.control, s3?.control]).toEqual([null, null, "negative"]);
  });

  it("gives a plate position when complete, upper-casing the row", () => {
    expect(s1?.plate).toEqual({ plate: "P1", row: "A", col: 1 });
    expect(s3?.plate).toBeNull();
  });

  it("prefers the library sample's qPCR density to the specimen's", () => {
    expect(s1?.density).toEqual({ value: 1200, method: "microscopy", from: "specimen" });
    expect(s2?.density).toEqual({ value: 35, method: "qPCR", from: "library" });
    expect(s3?.density).toBeNull();
  });

  it("sums reads at each stage over targets, with nulls where not given", () => {
    expect(summary.stages).toEqual(["demux", "denoised"]);
    expect(s1?.rawReads).toBe(500);
    expect(s1?.stageReads).toEqual([350, 100]);
    expect(s2?.rawReads).toBeNull();
    expect(s2?.stageReads).toEqual([null, null]);
  });

  it("lists the panel's reactions", () => {
    expect(summary.reactions).toEqual([
      { panel: "p", name: "pool1", targets: [0, 1] },
      { panel: "p", name: "pool2", targets: [2] },
    ]);
  });
});

describe("groupFieldsOf", () => {
  it("offers only fields some specimen has, with how many have each", () => {
    expect(groupFieldsOf(PMO)).toEqual([
      { key: "collection_country", present: 2, total: 3, distinct: 1 },
      { key: "geo_admin1", present: 2, total: 3, distinct: 2 },
      { key: "collection_year", present: 3, total: 3, distinct: 2 },
      { key: "collection_month", present: 2, total: 3, distinct: 2 },
      { key: "project", present: 2, total: 3, distinct: 1 },
    ]);
  });

  it("reads a month only from a date that gives one", () => {
    expect([0, 1, 2].map((index) => groupValue(PMO, index, "collection_month"))).toEqual([
      "2019-01",
      "2019-03",
      null,
    ]);
  });
});

describe("compareGroups", () => {
  it("puts specimens without a value in their own group, last", () => {
    const comparison = compareGroups(PMO, "geo_admin1", 0);
    expect(comparison.groups.map((group) => group.name)).toEqual(["Gaza", "Maputo", null]);
    expect(comparison.groups.map((group) => group.specimens)).toEqual([1, 1, 1]);
  });

  it("counts samples with data, more than one allele, and alleles per group", () => {
    const comparison = compareGroups(PMO, "collection_year", 0);
    expect(comparison.groups).toEqual([
      {
        name: "2019",
        specimens: 2,
        librarySamples: 2,
        withData: 2,
        polyclonal: 1,
        meanHeterozygosity: (1 - (4 / 9 + 1 / 9) + 0) / 2,
        alleles: 3,
      },
      {
        name: "2020",
        specimens: 1,
        librarySamples: 1,
        withData: 1,
        polyclonal: 0,
        meanHeterozygosity: 0,
        alleles: 1,
      },
    ]);
  });

  it("gives each target's allele frequencies per group, most frequent overall first", () => {
    const [t1] = compareGroups(PMO, "collection_year", 0).targets;
    expect(t1?.name).toBe("t1");
    expect(t1?.alleles.map((allele) => [allele.label.label, allele.freqs])).toEqual([
      ["most common", [2 / 3, 0]],
      ["A4T", [1 / 3, 1]],
    ]);
  });

  it("applies the read threshold: the control's 3 reads drop out at 5", () => {
    const comparison = compareGroups(PMO, "collection_year", 5);
    expect(comparison.groups.find((group) => group.name === "2020")?.withData).toBe(0);
  });

  it("draws the timeline by month when any date gives one, counting the dated specimens", () => {
    const comparison = compareGroups(PMO, "project", 0);
    expect(comparison.timelineUnit).toBe("month");
    // February has no specimens but keeps its place, so the bars follow time.
    expect(comparison.timeline).toEqual([
      { period: "2019-01", specimens: 1 },
      { period: "2019-02", specimens: 0 },
      { period: "2019-03", specimens: 1 },
    ]);
    expect(comparison.dated).toBe(2);
  });
});
