import { stringifyPmo, validatePmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { buildExamplePmo } from "@/domain/build/testing";

import { examplePmoWithReadCounts, richPmo } from "./testing";
import { COLLECTION_YEAR_FIELD, type SubsetRequest } from "./types";
import {
  baseNameOf,
  choicesOf,
  makeSubset,
  openPmo,
  previewSubset,
  tableFile,
  tablesArchive,
  tablesOf,
} from "./workingPmo";
import { readZip } from "./zipTesting";

const EXAMPLE: PortableMicrohaplotypeObject = buildExamplePmo();

function blob(data: unknown): Blob {
  return new Blob([typeof data === "string" ? data : stringifyPmo(data)]);
}

describe("openPmo", () => {
  it("opens a valid 1.1.0 PMO with its summary, choices and tables", async () => {
    const { outcome, pmo } = await openPmo(blob(EXAMPLE), "study.json");
    expect(pmo).not.toBeNull();
    if (outcome.kind !== "opened") throw new Error(outcome.kind);
    expect(outcome.summary.specimens).toBe(EXAMPLE.specimen_info.length);
    expect(outcome.choices.specimens).toHaveLength(EXAMPLE.specimen_info.length);
    expect(outcome.tables.map((table) => table.id)).toContain("alleles");
  });

  it("refuses a file that is not a PMO, as the publishing check does", async () => {
    const { outcome, pmo } = await openPmo(blob("{}"), "x.json");
    expect(pmo).toBeNull();
    expect(outcome).toEqual({ kind: "refused", check: { kind: "unreadable", reason: "not-pmo" } });
  });

  it("refuses another PMO version", async () => {
    const old = { ...EXAMPLE, pmo_header: { ...EXAMPLE.pmo_header, pmo_version: "1.0.0" } };
    const { outcome } = await openPmo(blob(old), "x.json");
    expect(outcome).toMatchObject({ kind: "refused", check: { kind: "wrong-version" } });
  });
});

describe("choicesOf", () => {
  const choices = choicesOf(EXAMPLE);

  it("offers metadata fields with a few values, not names or free text", () => {
    const fields = choices.metadata.map((field) => field.field);
    expect(fields).not.toContain("specimen_name");
    for (const field of choices.metadata) {
      expect(field.values.length).toBeGreaterThanOrEqual(2);
      expect(field.values.reduce((sum, value) => sum + value.count, 0)).toBeLessThanOrEqual(
        EXAMPLE.specimen_info.length,
      );
    }
  });

  it("lists only targets with detected microhaplotypes, and counts the rest", () => {
    expect(choices.targets.length + choices.targetsWithoutData).toBe(EXAMPLE.target_info.length);
    expect(choices.targets.length).toBe(EXAMPLE.representative_microhaplotypes.targets.length);
  });

  it("gives each specimen's values for the offered fields", () => {
    for (const field of choices.metadata) {
      const counted = choices.specimens.filter((specimen) => field.field in specimen.values).length;
      expect(counted).toBe(field.values.reduce((sum, value) => sum + value.count, 0));
    }
  });

  it("offers collection_year right before collection_date, sorted ascending by year", () => {
    const fields = choices.metadata.map((field) => field.field);
    const yearIndex = fields.indexOf(COLLECTION_YEAR_FIELD);
    const dateIndex = fields.indexOf("collection_date");
    expect(yearIndex).toBeGreaterThanOrEqual(0);
    expect(yearIndex).toBe(dateIndex - 1);
    expect(choices.metadata[yearIndex]?.values).toEqual([
      { value: "2015", label: "2015", count: 5 },
      { value: "2016", label: "2016", count: 9 },
      { value: "2017", label: "2017", count: 14 },
      { value: "2018", label: "2018", count: 14 },
      { value: "2019", label: "2019", count: 8 },
    ]);
    expect(
      choices.specimens.find((s) => s.name === "example_specimen_04")?.values[
        COLLECTION_YEAR_FIELD
      ],
    ).toBe("2015");
    expect(
      choices.specimens.find((s) => s.name === "example_specimen_01")?.values[
        COLLECTION_YEAR_FIELD
      ],
    ).toBe("2019");
  });

  it("omits collection_year when fewer than two distinct years are present", () => {
    const oneYear: PortableMicrohaplotypeObject = {
      ...EXAMPLE,
      specimen_info: EXAMPLE.specimen_info.map((specimen) => ({
        ...specimen,
        collection_date: "2019-01",
      })),
    };
    expect(choicesOf(oneYear).metadata.map((field) => field.field)).not.toContain(
      COLLECTION_YEAR_FIELD,
    );
  });

  it("still offers collection_year when collection_date has too many distinct values", () => {
    const template = EXAMPLE.specimen_info[0];
    if (template === undefined) throw new Error("no specimen");
    const manyDates: PortableMicrohaplotypeObject = {
      ...EXAMPLE,
      specimen_info: Array.from({ length: 65 }, (_, index) => {
        const year = index < 35 ? 2018 : 2019;
        const month = String((index % 12) + 1).padStart(2, "0");
        const day = String((index % 28) + 1).padStart(2, "0");
        return {
          ...template,
          specimen_name: `s_${index}`,
          collection_date: `${year}-${month}-${day}`,
        };
      }),
    };
    const fields = choicesOf(manyDates).metadata;
    expect(fields.map((field) => field.field)).not.toContain("collection_date");
    expect(fields.find((field) => field.field === COLLECTION_YEAR_FIELD)?.values).toEqual([
      { value: "2018", label: "2018", count: 35 },
      { value: "2019", label: "2019", count: 30 },
    ]);
  });
});

describe("makeSubset", () => {
  const choices = choicesOf(EXAMPLE);
  const names = choices.specimens.slice(0, 5).map((specimen) => specimen.name);

  it("keeps the chosen specimens and gives a valid PMO", () => {
    const { outcome, subset } = makeSubset(
      EXAMPLE,
      { specimens: { kind: "names", names }, targets: { kind: "all" }, minReads: 0 },
      "study.json.gz",
    );
    if (outcome.kind !== "made" || subset === null) throw new Error(outcome.kind);
    expect(subset.specimen_info.map((specimen) => specimen.specimen_name)).toEqual(names);
    expect(outcome.problems).toEqual([]);
    expect(outcome.fileName).toBe("study-subset.json.gz");
    expect(validatePmo(subset).valid).toBe(true);
  });

  it("applies targets and reads after specimens", () => {
    const targets = choices.targets.slice(0, 10);
    const { outcome, subset } = makeSubset(
      EXAMPLE,
      { specimens: { kind: "all" }, targets: { kind: "names", names: targets }, minReads: 50 },
      "study.json",
    );
    if (outcome.kind !== "made" || subset === null) throw new Error(outcome.kind);
    expect(subset.target_info.map((target) => target.target_name).toSorted()).toEqual(
      targets.toSorted(),
    );
    for (const run of subset.detected_microhaplotypes) {
      for (const sample of run.library_samples) {
        for (const result of sample.target_results) {
          for (const mhap of result.mhaps) expect(mhap.reads).toBeGreaterThanOrEqual(50);
        }
      }
    }
  });

  it("chooses specimens by metadata", () => {
    const field = choices.metadata.find((item) => item.field !== COLLECTION_YEAR_FIELD);
    const [value] = field?.values ?? [];
    if (field === undefined || value === undefined) return;
    const { outcome } = makeSubset(
      EXAMPLE,
      {
        specimens: { kind: "metadata", criteria: { [field.field]: [value.value] } },
        targets: { kind: "all" },
        minReads: 0,
      },
      "study.json",
    );
    if (outcome.kind !== "made") throw new Error(outcome.kind);
    expect(outcome.summary.specimens).toBeLessThanOrEqual(value.count);
  });

  it("chooses specimens by collection year alone, keeping the exact specimens", () => {
    const { outcome, subset } = makeSubset(
      EXAMPLE,
      {
        specimens: { kind: "metadata", criteria: {}, collectionYears: ["2015", "2019"] },
        targets: { kind: "all" },
        minReads: 0,
      },
      "study.json",
    );
    if (outcome.kind !== "made" || subset === null) throw new Error(outcome.kind);
    expect(subset.specimen_info.map((specimen) => specimen.specimen_name)).toEqual([
      "example_specimen_01",
      "example_specimen_04",
      "example_specimen_05",
      "example_specimen_09",
      "example_specimen_10",
      "example_specimen_16",
      "example_specimen_22",
      "example_specimen_26",
      "example_specimen_29",
      "example_specimen_33",
      "example_specimen_35",
      "example_specimen_45",
      "example_specimen_50",
    ]);
    expect(outcome.problems).toEqual([]);
    expect(validatePmo(subset).valid).toBe(true);
  });

  it("combines collection year with raw metadata criteria", () => {
    const { outcome, subset } = makeSubset(
      EXAMPLE,
      {
        specimens: {
          kind: "metadata",
          criteria: { collection_date: ["2016-05", "2019-06"] },
          collectionYears: ["2019"],
        },
        targets: { kind: "all" },
        minReads: 0,
      },
      "study.json",
    );
    if (outcome.kind !== "made" || subset === null) throw new Error(outcome.kind);
    expect(subset.specimen_info.map((specimen) => specimen.specimen_name)).toEqual([
      "example_specimen_05",
      "example_specimen_22",
      "example_specimen_29",
      "example_specimen_45",
      "example_specimen_50",
    ]);
  });

  it("says when nothing is left for disjoint year and metadata criteria", () => {
    const { outcome, subset } = makeSubset(
      EXAMPLE,
      {
        specimens: {
          kind: "metadata",
          criteria: { collection_date: ["2016-05"] },
          collectionYears: ["2015"],
        },
        targets: { kind: "all" },
        minReads: 0,
      },
      "study.json",
    );
    expect(outcome).toEqual({ kind: "empty" });
    expect(subset).toBeNull();
  });

  it("says when nothing is left", () => {
    const { outcome, subset } = makeSubset(
      EXAMPLE,
      { specimens: { kind: "all" }, targets: { kind: "all" }, minReads: 10_000_000 },
      "study.json",
    );
    expect(outcome).toEqual({ kind: "empty" });
    expect(subset).toBeNull();
  });

  it("reports what pmotools-ts refuses, such as an unknown name", () => {
    const { outcome } = makeSubset(
      EXAMPLE,
      { specimens: { kind: "names", names: ["nobody"] }, targets: { kind: "all" }, minReads: 0 },
      "study.json",
    );
    expect(outcome.kind).toBe("failed");
  });
});

describe("previewSubset", () => {
  const choices = choicesOf(EXAMPLE);
  const field = choices.metadata.find((item) => item.field !== COLLECTION_YEAR_FIELD);
  const requests: readonly SubsetRequest[] = [
    { specimens: { kind: "all" }, targets: { kind: "all" }, minReads: 0 },
    {
      specimens: { kind: "names", names: choices.specimens.slice(0, 5).map((s) => s.name) },
      targets: { kind: "all" },
      minReads: 0,
    },
    {
      specimens: { kind: "all" },
      targets: { kind: "names", names: choices.targets.slice(0, 10) },
      minReads: 50,
    },
    {
      specimens: {
        kind: "metadata",
        criteria: field === undefined ? {} : { [field.field]: [field.values[0]?.value ?? ""] },
      },
      targets: { kind: "names", names: choices.targets.slice(3, 20) },
      minReads: 200,
    },
    {
      specimens: { kind: "metadata", criteria: {}, collectionYears: ["2015", "2019"] },
      targets: { kind: "all" },
      minReads: 0,
    },
    {
      specimens: {
        kind: "metadata",
        criteria: { collection_date: ["2016-05", "2019-06"] },
        collectionYears: ["2019"],
      },
      targets: { kind: "names", names: choices.targets.slice(0, 10) },
      minReads: 50,
    },
  ];

  it.each(requests)("counts what making the subset gives", (request) => {
    const { outcome } = makeSubset(EXAMPLE, request, "study.json");
    if (outcome.kind !== "made") throw new Error(outcome.kind);
    const preview = previewSubset(EXAMPLE, request);
    expect(preview).toEqual({
      specimens: outcome.summary.specimens,
      librarySamples: outcome.summary.librarySamples,
      librarySamplesWithData: outcome.summary.librarySamplesWithDetections,
      targetsWithCalls: outcome.summary.targetsWithCalls,
    });
  });

  it("counts the exact specimens kept by collection years", () => {
    expect(
      previewSubset(EXAMPLE, {
        specimens: { kind: "metadata", criteria: {}, collectionYears: ["2015", "2019"] },
        targets: { kind: "all" },
        minReads: 0,
      }),
    ).toMatchObject({ specimens: 13, librarySamples: 13 });
  });

  it("finds nothing left where making the subset would", () => {
    const request: SubsetRequest = {
      specimens: { kind: "all" },
      targets: { kind: "all" },
      minReads: 10_000_000,
    };
    expect(makeSubset(EXAMPLE, request, "study.json").outcome.kind).toBe("empty");
    expect(previewSubset(EXAMPLE, request)).toMatchObject({
      librarySamplesWithData: 0,
      targetsWithCalls: 0,
    });
  });
});

describe("tablesArchive", () => {
  it("zips every table as tableFile writes it", async () => {
    const archive = await tablesArchive(EXAMPLE, { format: "tsv", baseName: "study" });
    expect(archive.fileName).toBe("study-tables-tsv.zip");
    const files = await readZip(archive.blob);
    const expected = tablesOf(EXAMPLE).map(({ id }) =>
      tableFile(EXAMPLE, { id, format: "tsv", baseName: "study" }),
    );
    expect(files).toEqual(expected.map((file) => ({ name: file.fileName, text: file.text })));
  });
});

describe("tableFile", () => {
  it("writes the allele table as CSV, with reads, named after the file", () => {
    const file = tableFile(EXAMPLE, { id: "alleles", format: "csv", baseName: "study" });
    expect(file.fileName).toBe("study-alleles.csv");
    const [header, ...rows] = file.text.trimEnd().split("\n");
    expect(header).toBe("library_sample_name,target_name,seq,bioinformatics_run_name,reads");
    expect(rows).toHaveLength(
      tablesOf(EXAMPLE).find((table) => table.id === "alleles")?.rows ?? -1,
    );
  });

  it("writes TSV", () => {
    const file = tableFile(EXAMPLE, { id: "specimens", format: "tsv", baseName: "study" });
    expect(file.fileName).toBe("study-specimens.tsv");
    expect(file.text.split("\n")[0]).toContain("\tspecimen_name".slice(1));
    expect(file.text.split("\n")[0]).toContain("\t");
  });

  it("writes every table the PMO offers", () => {
    for (const table of tablesOf(EXAMPLE)) {
      const file = tableFile(EXAMPLE, { id: table.id, format: "csv", baseName: "x" });
      expect(file.text.trimEnd().split("\n")).toHaveLength(table.rows + 1);
    }
  });
});

describe("read counts by stage table", () => {
  const WITH_COUNTS = examplePmoWithReadCounts();

  it("omits read counts when the PMO has none", async () => {
    expect(tablesOf(EXAMPLE).map((table) => table.id)).not.toContain("readCounts");
    const archive = await tablesArchive(EXAMPLE, { format: "csv", baseName: "study" });
    const files = await readZip(archive.blob);
    expect(files.map((file) => file.name)).not.toContain("study-read-counts.csv");
  });

  it("lists read counts right after panels with its row count on the example PMO and includes it in the archive", async () => {
    const tables = tablesOf(WITH_COUNTS);
    const ids = tables.map((table) => table.id);
    expect(ids.indexOf("readCounts")).toBe(ids.indexOf("panels") + 1);
    expect(tables.find((table) => table.id === "readCounts")).toEqual({
      id: "readCounts",
      rows: 8,
    });

    const csv = tableFile(WITH_COUNTS, { id: "readCounts", format: "csv", baseName: "study" });
    expect(csv.fileName).toBe("study-read-counts.csv");
    expect(csv.text.trimEnd().split("\n")).toEqual([
      "library_sample_name,total_raw_count,target_name,stage,reads",
      "example_sample_01,10,Pf3D7_01_v3-145388-145662-1A,demux,10",
      "example_sample_01,10,Pf3D7_01_v3-145388-145662-1A,dada2,7",
      "example_sample_02,7,Pf3D7_01_v3-145388-145662-1A,demux,6",
      "example_sample_02,7,Pf3D7_01_v3-145388-145662-1A,dada2,4",
      "example_sample_03,25,Pf3D7_01_v3-145388-145662-1A,demux,10",
      "example_sample_03,25,Pf3D7_01_v3-145388-145662-1A,dada2,8",
      "example_sample_03,25,Pf3D7_14_v3-288429-288696-1B,demux,15",
      "example_sample_03,25,Pf3D7_14_v3-288429-288696-1B,dada2,15",
    ]);

    const archive = await tablesArchive(WITH_COUNTS, { format: "tsv", baseName: "study" });
    const files = await readZip(archive.blob);
    const entry = files.find((file) => file.name === "study-read-counts.tsv");
    expect(entry?.text).toBe(
      tableFile(WITH_COUNTS, { id: "readCounts", format: "tsv", baseName: "study" }).text,
    );
  });

  it("includes bioinformatics_run_name when a run names one, in TSV format", () => {
    const rich = richPmo();
    expect(tablesOf(rich).find((table) => table.id === "readCounts")).toEqual({
      id: "readCounts",
      rows: 3,
    });
    const tsv = tableFile(rich, { id: "readCounts", format: "tsv", baseName: "rich" });
    expect(tsv.fileName).toBe("rich-read-counts.tsv");
    expect(tsv.text.trimEnd().split("\n")).toEqual([
      "library_sample_name\tbioinformatics_run_name\ttotal_raw_count\ttarget_name\tstage\treads",
      "S1\trunA\t500\tt1\tdemux\t300",
      "S1\trunA\t500\tt1\tdenoised\t100",
      "S1\trunA\t500\tt2\tdemux\t50",
    ]);
  });

  it("writes one row per sample without target columns when only total raw counts are given", () => {
    const rich = richPmo();
    const totalsOnly: PortableMicrohaplotypeObject = {
      ...rich,
      read_counts_by_stage: [
        {
          read_counts_by_library_sample_by_stage: [
            { library_sample_id: 0, total_raw_count: 500 },
            { library_sample_id: 1, total_raw_count: 250, read_counts_for_targets: [] },
          ],
        },
      ],
    };
    expect(tablesOf(totalsOnly).find((table) => table.id === "readCounts")).toEqual({
      id: "readCounts",
      rows: 2,
    });
    const csv = tableFile(totalsOnly, { id: "readCounts", format: "csv", baseName: "totals" });
    expect(csv.text.trimEnd().split("\n")).toEqual([
      "library_sample_name,total_raw_count",
      "S1,500",
      "S2,250",
    ]);
  });

  it("keeps a total-only sample alongside staged samples and appends sorted extra primitive columns", () => {
    const rich = richPmo();
    const mixed: PortableMicrohaplotypeObject = {
      ...rich,
      read_counts_by_stage: [
        {
          bioinformatics_run_id: 0,
          read_counts_by_library_sample_by_stage: [
            {
              library_sample_id: 0,
              total_raw_count: 500,
              batch: "B1",
              ignored_obj: { nested: true },
              read_counts_for_targets: [
                {
                  target_id: 0,
                  pool_tags: ["p1", "p2"],
                  stages: [{ stage: "demux", reads: 300, note: "ok" }],
                },
              ],
            },
            {
              library_sample_id: 1,
              total_raw_count: 250,
              batch: "B2",
            },
          ],
        },
      ],
    };
    expect(tablesOf(mixed).find((table) => table.id === "readCounts")).toEqual({
      id: "readCounts",
      rows: 2,
    });
    const csv = tableFile(mixed, { id: "readCounts", format: "csv", baseName: "mixed" });
    expect(csv.text.trimEnd().split("\n")).toEqual([
      "library_sample_name,bioinformatics_run_name,total_raw_count,target_name,stage,reads,batch,note,pool_tags",
      'S1,runA,500,t1,demux,300,B1,ok,"p1,p2"',
      "S2,runA,250,,,,B2,,",
    ]);
  });

  it("follows subsets: narrows rows to kept specimens and omits read counts when none remain", () => {
    const sample01Specimen =
      WITH_COUNTS.specimen_info[
        WITH_COUNTS.library_sample_info.find(
          (library) => library.library_sample_name === "example_sample_01",
        )?.specimen_id ?? -1
      ]?.specimen_name;
    const sample10Specimen =
      WITH_COUNTS.specimen_info[
        WITH_COUNTS.library_sample_info.find(
          (library) => library.library_sample_name === "example_sample_10",
        )?.specimen_id ?? -1
      ]?.specimen_name;
    if (sample01Specimen === undefined || sample10Specimen === undefined) {
      throw new Error("expected example specimens");
    }

    const oneSample = makeSubset(
      WITH_COUNTS,
      {
        specimens: { kind: "names", names: [sample01Specimen] },
        targets: { kind: "all" },
        minReads: 0,
      },
      "study.json",
    );
    if (oneSample.outcome.kind !== "made" || oneSample.subset === null) {
      throw new Error(oneSample.outcome.kind);
    }
    expect(oneSample.outcome.tables.find((table) => table.id === "readCounts")).toEqual({
      id: "readCounts",
      rows: 2,
    });
    expect(
      tableFile(oneSample.subset, { id: "readCounts", format: "csv", baseName: "study-subset" })
        .text.trimEnd()
        .split("\n"),
    ).toEqual([
      "library_sample_name,total_raw_count,target_name,stage,reads",
      "example_sample_01,10,Pf3D7_01_v3-145388-145662-1A,demux,10",
      "example_sample_01,10,Pf3D7_01_v3-145388-145662-1A,dada2,7",
    ]);

    const noCounts = makeSubset(
      WITH_COUNTS,
      {
        specimens: { kind: "names", names: [sample10Specimen] },
        targets: { kind: "all" },
        minReads: 0,
      },
      "study.json",
    );
    if (noCounts.outcome.kind !== "made") throw new Error(noCounts.outcome.kind);
    expect(noCounts.outcome.tables.map((table) => table.id)).not.toContain("readCounts");
  });
});

describe("baseNameOf", () => {
  it.each([
    ["study.json.gz", "study"],
    ["study.json", "study"],
    ["study.pmo.json", "study"],
    ["Mad4hatter.pmo.json.gz", "Mad4hatter"],
    ["study.pmo", "study.pmo"],
    ["study.gz", "study"],
    [".json", "pmo"],
  ])("%s gives %s", (name, base) => {
    expect(baseNameOf(name)).toBe(base);
  });
});
