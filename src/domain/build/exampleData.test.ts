import { describe, expect, it } from "vitest";

import { EXAMPLE_SAMPLE_PREFIX, isExampleData } from "./exampleData";
import { readExample } from "./testing";

function column(file: string, name: string): string[] {
  return readExample(file).rows.map((row) => row[name] ?? "");
}

describe("the example tables", () => {
  it.each([
    ["mad4hatter_allele_data_example.csv", "SampleID"],
    ["mad4hatter_allele_data_example_multi_bioinfo.csv", "SampleID"],
    ["mad4hatter_metadata_example.tsv", "experiment_sample_id"],
    ["example_raw_reads.txt", "sample"],
    ["reads_per_stage.txt", "sample"],
  ])("%s names every sample as an example sample", (file, name) => {
    const names = column(file, name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((sample) => !sample.startsWith(EXAMPLE_SAMPLE_PREFIX))).toEqual([]);
  });

  it("hold no accession of a real dataset as a sample or specimen name", () => {
    const names = [
      ...column("mad4hatter_allele_data_example.csv", "SampleID"),
      ...column("mad4hatter_metadata_example.tsv", "experiment_sample_id"),
      ...column("mad4hatter_metadata_example.tsv", "specimen_id"),
    ];
    expect(names.filter((name) => /^(SRR|SAMN)\d+$/.test(name))).toEqual([]);
  });
});

describe("isExampleData", () => {
  it("is true for the example, whole or in part", () => {
    expect(isExampleData(column("mad4hatter_metadata_example.tsv", "experiment_sample_id"))).toBe(
      true,
    );
    expect(isExampleData(["example_sample_07"])).toBe(true);
  });

  it("is true when example samples are mixed with a user's own", () => {
    expect(isExampleData(["mine-1", "mine-2", "example_sample_01"])).toBe(true);
  });

  it("is false for a user's own samples, real accessions included", () => {
    expect(isExampleData(["mine-1", "mine-2", "mine-3"])).toBe(false);
    expect(isExampleData(["SRR26819135", "SRR26819139"])).toBe(false);
    expect(isExampleData([])).toBe(false);
  });
});
