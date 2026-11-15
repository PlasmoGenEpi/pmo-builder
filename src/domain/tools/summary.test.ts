import type { PortableMicrohaplotypeObject } from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { buildExamplePmo } from "@/domain/build/testing";

import { summaryOf } from "./summary";

/**
 * Two library samples, three targets. t1 is seen in both (S1 carries two
 * microhaplotypes there), t2 only in S2, t3 never.
 */
const PMO: PortableMicrohaplotypeObject = {
  pmo_header: { pmo_version: "1.1.0" },
  panel_info: [{ panel_name: "p", reactions: [{ reaction_name: "r", panel_targets: [0, 1, 2] }] }],
  target_info: ["t1", "t2", "t3"].map((target_name) => ({
    target_name,
    forward_primer: { seq: "ACGT" },
    reverse_primer: { seq: "TGCA" },
  })),
  specimen_info: [{ specimen_name: "spec1" }, { specimen_name: "spec2" }],
  library_sample_info: [
    { library_sample_name: "S1", specimen_id: 0, panel_id: 0 },
    { library_sample_name: "S2", specimen_id: 1, panel_id: 0 },
  ],
  bioinformatics_methods_info: [{ methods: [{ program: "x", program_version: "1" }] }],
  bioinformatics_run_info: [{ bioinformatics_run_name: "runA", bioinformatics_methods_id: 0 }],
  representative_microhaplotypes: {
    targets: [
      { target_id: 0, microhaplotypes: [{ seq: "AAAA" }, { seq: "AAAT" }] },
      { target_id: 1, microhaplotypes: [{ seq: "CCCC" }] },
    ],
  },
  detected_microhaplotypes: [
    {
      bioinformatics_run_id: 0,
      library_samples: [
        {
          library_sample_id: 0,
          target_results: [
            {
              mhaps_target_id: 0,
              mhaps: [
                { mhap_id: 0, reads: 90 },
                { mhap_id: 1, reads: 10 },
              ],
            },
          ],
        },
        {
          library_sample_id: 1,
          target_results: [
            { mhaps_target_id: 0, mhaps: [{ mhap_id: 0, reads: 50 }] },
            { mhaps_target_id: 1, mhaps: [{ mhap_id: 0, reads: 5 }] },
          ],
        },
      ],
    },
  ],
};

describe("summaryOf", () => {
  it("counts each sample's targets, reads and most alleles at a target", () => {
    const summary = summaryOf(PMO, 0);
    expect(summary.samples).toEqual([
      { name: "S1", specimen: "spec1", run: "runA", targets: 1, reads: 100, maxAlleles: 2 },
      { name: "S2", specimen: "spec2", run: "runA", targets: 2, reads: 55, maxAlleles: 1 },
    ]);
  });

  it("gives each target its samples, allele frequencies and heterozygosity", () => {
    const [t1, t2, t3] = summaryOf(PMO, 0).targets;
    expect(t1).toEqual({
      name: "t1",
      samples: 2,
      alleles: [
        {
          mhapId: 0,
          seq: "AAAA",
          label: { label: "most common", source: "alignment", note: null },
          count: 2,
          freq: 2 / 3,
        },
        {
          mhapId: 1,
          seq: "AAAT",
          label: { label: "A4T", source: "alignment", note: null },
          count: 1,
          freq: 1 / 3,
        },
      ],
      heterozygosity: 1 - (4 / 9 + 1 / 9),
    });
    expect(t2).toMatchObject({ name: "t2", samples: 1, heterozygosity: 0 });
    expect(t3).toEqual({ name: "t3", samples: 0, alleles: [], heterozygosity: null });
  });

  it("lays out the reads grid by sample and target", () => {
    expect(summaryOf(PMO, 0).grid).toEqual({ columns: 3, reads: [100, 0, 0, 50, 5, 0] });
  });

  it("applies one read threshold to every figure", () => {
    const summary = summaryOf(PMO, 20);
    expect(summary.minReads).toBe(20);
    expect(
      summary.samples.map((sample) => [sample.name, sample.targets, sample.maxAlleles]),
    ).toEqual([
      ["S1", 1, 1],
      ["S2", 1, 1],
    ]);
    expect(summary.grid.reads).toEqual([90, 0, 0, 50, 0, 0]);
    expect(summary.targets[0]?.alleles.map((allele) => allele.mhapId)).toEqual([0]);
    expect(summary.headline).toEqual({
      samplesWithData: 2,
      targetsWithData: 1,
      medianTargets: 1,
      medianReads: 70,
      polyclonal: 0,
    });
  });

  it("keeps a sample whose reads all fall below the threshold, with zeros", () => {
    const summary = summaryOf(PMO, 60);
    expect(summary.samples.map((sample) => [sample.name, sample.targets, sample.reads])).toEqual([
      ["S1", 1, 90],
      ["S2", 0, 0],
    ]);
    expect(summary.headline.samplesWithData).toBe(1);
  });

  it("lists a library sample with no detections at all", () => {
    const withSpare: PortableMicrohaplotypeObject = {
      ...PMO,
      library_sample_info: [
        ...PMO.library_sample_info,
        { library_sample_name: "S3", specimen_id: 1, panel_id: 0 },
      ],
    };
    const last = summaryOf(withSpare, 0).samples.at(-1);
    expect(last).toEqual({
      name: "S3",
      specimen: "spec2",
      run: "",
      targets: 0,
      reads: 0,
      maxAlleles: 0,
    });
  });

  it("sums up the example PMO", () => {
    const example = buildExamplePmo();
    const summary = summaryOf(example, 0);
    expect(summary.samples.length).toBeGreaterThan(0);
    expect(summary.grid.reads).toHaveLength(summary.samples.length * example.target_info.length);
    expect(summary.headline.targetsWithData).toBe(
      example.representative_microhaplotypes.targets.length,
    );
    const totals = summary.targets
      .filter((target) => target.alleles.length > 0)
      .map((target) => target.alleles.reduce((sum, allele) => sum + allele.freq, 0));
    for (const total of totals) expect(total).toBeCloseTo(1);
  });
});
