import { stringifyPmo, validatePmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { buildExamplePmo } from "@/domain/build/testing";

import type { SubsetRequest } from "./types";
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
    const [field] = choices.metadata;
    if (field === undefined) return;
    const counted = choices.specimens.filter((specimen) => field.field in specimen.values).length;
    expect(counted).toBe(field.values.reduce((sum, value) => sum + value.count, 0));
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
    const [field] = choices.metadata;
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
  const [field] = choices.metadata;
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
