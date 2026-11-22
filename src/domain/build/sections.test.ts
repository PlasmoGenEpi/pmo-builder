import { mhapTableToPmo, panelInfoTableToPmo, stringifyPmo } from "pmotools-ts";
import { describe, expect, it } from "vitest";

import {
  createEmptyDraft,
  createMethodRecord,
  createMethodStep,
  createPanelEntry,
  createProjectRecord,
  createRunRecord,
  createSequencingRecord,
  type Draft,
  panelContentKey,
  toJsonValue,
  type PanelEntry,
} from "@/domain/draft";
import type { RawTable } from "@/domain/types";

import { buildBioinformatics } from "./bioinformatics";
import { typeTable } from "@/domain/import";

import { createBuildContext, type BuildContext } from "./context";
import { buildAllSections, mergeSections } from "./merge";
import { buildMicrohaplotypes, DEFAULT_MHAP_CHUNK_SIZE } from "./microhaplotypes";
import { buildPanel } from "./panel";
import { buildReadCounts } from "./readCounts";
import { buildProject, buildSequencing } from "./records";
import { buildLibrarySamples, buildSpecimens } from "./samples";
import { collectSuggestions } from "./suggestions";
import {
  EXAMPLE_MAPPINGS,
  TEST_DEPS,
  mappedTable,
  mapping,
  rawTable,
  readExample,
  testContext,
} from "./testing";

const empty = createEmptyDraft();

const ALLELES = rawTable([
  { sample: "S1", target: "t1", seq: "ACGT", reads: "5", run: "r1", note: "a" },
  { sample: "S2", target: "t1", seq: "ACGA", reads: "7", run: "r2", note: "b" },
  { sample: "S2", target: "t2", seq: "TTGA", reads: "3", run: "r2", note: "c" },
]);
const ALLELE_MAPPING = mapping({
  librarySampleName: "sample",
  targetName: "target",
  seq: "seq",
  reads: "reads",
});

/** A test context that types tables as the app does, so "NA" in a text column stays "NA". */
function realTyping(tables: Readonly<Record<string, RawTable>>): BuildContext {
  return createBuildContext(new Map(Object.entries(tables)), { ...TEST_DEPS, typeTable });
}

function codes(result: { readonly notices: readonly { readonly code: string }[] }): string[] {
  return result.notices.map((notice) => notice.code);
}

describe("microhaplotypes", () => {
  const context = testContext({ alleles: ALLELES });
  const withTable = (patch: Partial<Draft["microhaplotypes"]> = {}): Draft["microhaplotypes"] => ({
    ...empty.microhaplotypes,
    table: mappedTable("alleles", ALLELES, ALLELE_MAPPING),
    ...patch,
  });

  it("is empty with nothing entered", () => {
    expect(buildMicrohaplotypes(empty.microhaplotypes, context)).toMatchObject({
      status: "empty",
      notices: [],
    });
  });

  it("is incomplete while a required field is unmapped", () => {
    const section = withTable({
      table: mappedTable("alleles", ALLELES, mapping({ ...ALLELE_MAPPING.fields, reads: null })),
    });
    const result = buildMicrohaplotypes(section, context);
    expect(result.status).toBe("incomplete");
    expect(codes(result)).toEqual(["mapping/missing-required"]);
    expect(result.notices[0]?.message).toContain("reads");
  });

  it("is ready once mapped, with a summary", () => {
    const result = buildMicrohaplotypes(withTable(), context);
    expect(result.status).toBe("ready");
    expect(result.summary).toEqual({
      rows: 3,
      librarySamples: 2,
      targets: 2,
      microhaplotypes: 3,
      runNames: [],
    });
  });

  it("is an error when a read count is missing, naming the column and row", () => {
    const table = rawTable([
      { sample: "S1", target: "t1", seq: "ACGT", reads: "5" },
      { sample: "S2", target: "t1", seq: "ACGA", reads: null },
    ]);
    const result = buildMicrohaplotypes(
      { ...empty.microhaplotypes, table: mappedTable("alleles", table, ALLELE_MAPPING) },
      testContext({ alleles: table }),
    );
    expect(result.status).toBe("error");
    expect(codes(result)).toEqual(["table/blank-required"]);
    expect(result.notices[0]?.message).toBe(
      'Column "reads" is blank in row 3. Every row needs a value for “reads”. Fill it in.',
    );
  });

  it("is incomplete when the file is not loaded", () => {
    const result = buildMicrohaplotypes(withTable(), testContext({}));
    expect(result.status).toBe("incomplete");
    expect(codes(result)).toEqual(["table/file-missing"]);
  });

  it("splits runs by a column and refuses a fixed name that is also a column", () => {
    const byColumn = buildMicrohaplotypes(
      withTable({ runName: { mode: "column", fixedName: "", column: "run" } }),
      context,
    );
    expect(byColumn.summary?.runNames).toEqual(["r1", "r2"]);
    const clash = buildMicrohaplotypes(
      withTable({ runName: { mode: "fixed", fixedName: "run", column: null } }),
      context,
    );
    expect(clash.status).toBe("error");
    expect(codes(clash)).toEqual(["run-name/same-as-column"]);
    const blank = buildMicrohaplotypes(
      withTable({ runName: { mode: "fixed", fixedName: " ", column: null } }),
      context,
    );
    expect(blank.status).toBe("incomplete");
  });

  it("carries a list of extra columns onto representative microhaplotypes", () => {
    const result = buildMicrohaplotypes(withTable({ representativeColumns: ["note"] }), context);
    expect(result.status).toBe("ready");
    const mhaps = result.fragment?.representative_microhaplotypes.targets[0]?.microhaplotypes;
    expect(mhaps?.map((m) => m["note"])).toEqual(["a", "b"]);
  });
});

describe("microhaplotypes with repeated rows", () => {
  // The allele example as two analysis runs, the second repeating five rows
  // of the first. (The multi-run example file has no repeats: its runs hold
  // different rows.)
  const single = readExample("mad4hatter_allele_data_example.csv");
  const multi: RawTable = {
    columns: [...single.columns, "bioinfo_runs"],
    rows: [
      ...single.rows.map((row) => ({ ...row, bioinfo_runs: "run1" })),
      // oxlint-disable-next-line oxc/no-map-spread -- builds fresh fixtures; nothing to mutate in place
      ...single.rows.slice(0, 5).map((row) => ({ ...row, bioinfo_runs: "run2" })),
    ],
  };
  const section = (runName: Draft["microhaplotypes"]["runName"]): Draft["microhaplotypes"] => ({
    ...empty.microhaplotypes,
    table: mappedTable("multi", multi, EXAMPLE_MAPPINGS.alleles),
    runName,
  });
  const context = testContext({ multi });

  it("is an error naming the rows and the run column when a table holds several runs", () => {
    const result = buildMicrohaplotypes(
      section({ mode: "none", fixedName: "", column: null }),
      context,
    );
    expect(result.status).toBe("error");
    expect(codes(result)).toEqual(["table/repeated-rows"]);
    const message = result.notices[0]?.message ?? "";
    expect(message).toMatch(
      /^5 rows repeat the sample, target and sequence of an earlier row: rows 983, 984, 985, 986 and 987 \(such as sample "\w+", target "[^"]+"\)/,
    );
    expect(message).toContain("their reads would be counted twice");
    expect(message).toContain(
      'Column "bioinfo_runs" tells them apart, so the table probably holds several analysis runs. Choose that column under "Bioinformatics run name".',
    );
  });

  it("clears once the run column is chosen", () => {
    const result = buildMicrohaplotypes(
      section({ mode: "column", fixedName: "", column: "bioinfo_runs" }),
      context,
    );
    expect(result.notices).toEqual([]);
    expect(result.status).toBe("ready");
  });

  it("asks to remove repeats that no column explains", () => {
    const table = rawTable([
      { sample: "S1", target: "t1", seq: "ACGT", reads: "5" },
      { sample: "S1", target: "t1", seq: "ACGT", reads: "5" },
    ]);
    const result = buildMicrohaplotypes(
      { ...empty.microhaplotypes, table: mappedTable("twice", table, ALLELE_MAPPING) },
      testContext({ twice: table }),
    );
    expect(result.status).toBe("error");
    expect(result.notices[0]?.message).toBe(
      '1 row repeats the sample, target and sequence of an earlier row: row 3 (sample "S1", target "t1"), so their reads would be counted twice. Remove the repeated rows. If the table holds several analysis runs, choose the column that names the run under "Bioinformatics run name".',
    );
  });
});

describe("microhaplotypes with extra columns", () => {
  const table = rawTable([
    { sample: "S1", target: "t1", seq: "ACGT", reads: "5", tag: "01", lot: "007" },
    { sample: "S2", target: "t1", seq: "ACGA", reads: "7", tag: "02", lot: "NA" },
  ]);
  it("keeps carried columns as text, on each microhaplotype and each detection", () => {
    const result = buildMicrohaplotypes(
      {
        ...empty.microhaplotypes,
        table: mappedTable("tagged", table, mapping(ALLELE_MAPPING.fields, ["tag", "lot"])),
        representativeColumns: ["tag"],
      },
      realTyping({ tagged: table }),
    );
    expect(result.status).toBe("ready");
    const mhaps = result.fragment?.representative_microhaplotypes.targets[0]?.microhaplotypes;
    expect(mhaps?.map((m) => m["tag"])).toEqual(["01", "02"]);
    const detected = result.fragment?.detected_microhaplotypes[0]?.library_samples.flatMap((s) =>
      s.target_results.flatMap((t) => t.mhaps.map((m) => m["lot"])),
    );
    expect(detected).toEqual(["007", "NA"]);
  });
});

describe("microhaplotypes chunked building", () => {
  const exampleAlleles = readExample("mad4hatter_allele_data_example.csv");
  const examplePanel = readExample("mad4hatter_panel_info_example.csv");
  const exampleMetadata = readExample("mad4hatter_metadata_example.tsv");

  it("produces identical PMOs for the example table across chunk sizes", () => {
    const context = testContext({
      alleles: exampleAlleles,
      panel: examplePanel,
      metadata: exampleMetadata,
    });
    const draft: Draft = {
      ...empty,
      microhaplotypes: {
        ...empty.microhaplotypes,
        table: mappedTable("alleles", exampleAlleles, EXAMPLE_MAPPINGS.alleles),
      },
      panel: {
        panels: [
          {
            ...createPanelEntry("Mad4hatter"),
            table: mappedTable("panel", examplePanel, EXAMPLE_MAPPINGS.panel),
          },
        ],
      },
      specimens: {
        table: mappedTable("metadata", exampleMetadata, EXAMPLE_MAPPINGS.specimens),
      },
      librarySamples: {
        table: mappedTable("metadata", exampleMetadata, EXAMPLE_MAPPINGS.librarySamples),
      },
    };
    const baseSections = buildAllSections(draft, context);
    const referenceFragment = mhapTableToPmo(
      TEST_DEPS.typeTable(exampleAlleles, {
        textColumns: ["SampleID", "Locus", "ASV"],
        booleanColumns: [],
      }),
      {
        librarySampleNameCol: "SampleID",
        targetNameCol: "Locus",
        seqCol: "ASV",
        readsCol: "Reads",
      },
    );
    const referenceMerge = mergeSections(
      {
        ...baseSections,
        microhaplotypes: {
          ...baseSections.microhaplotypes,
          fragment: referenceFragment,
        },
      },
      { creationDate: "2026-01-01" },
    );
    if (referenceMerge.outcome.kind !== "built") throw new Error("reference did not build");
    const expectedJson = stringifyPmo(referenceMerge.outcome.pmo);

    const chunkSizes = [1, 2, 7, 64, DEFAULT_MHAP_CHUNK_SIZE, exampleAlleles.rows.length + 50];
    for (const chunkSize of chunkSizes) {
      const mhap = buildMicrohaplotypes(draft.microhaplotypes, context, { chunkSize });
      expect(mhap.status).toBe("ready");
      const merged = mergeSections(
        { ...baseSections, microhaplotypes: mhap },
        { creationDate: "2026-01-01" },
      );
      if (merged.outcome.kind !== "built") throw new Error(`chunkSize ${chunkSize} did not build`);
      expect(stringifyPmo(merged.outcome.pmo)).toBe(expectedJson);
    }
  });

  it("matches across chunk sizes for multi-run tables with extra columns and duplicate-seq warnings", () => {
    const table = rawTable([
      { sample: "S1", target: "t1", seq: "ACGT", reads: "5", run: "r2", note: "first", lot: "L1" },
      { sample: "S2", target: "t1", seq: "ACGT", reads: "8", run: "r2", note: "second", lot: "L2" },
      { sample: "S1", target: "t2", seq: "TTGG", reads: "3", run: "r1", note: "a", lot: "L3" },
      { sample: "S3", target: "t1", seq: "ACGA", reads: "11", run: "r1", note: "b", lot: "L4" },
      { sample: "S2", target: "t2", seq: "TTGC", reads: "9", run: "r2", note: "c", lot: "L5" },
      { sample: "S3", target: "t2", seq: "TTGG", reads: "4", run: "r1", note: "a", lot: "L6" },
    ]);
    const section: Draft["microhaplotypes"] = {
      table: mappedTable("multi", table, mapping(ALLELE_MAPPING.fields, ["note", "lot"])),
      runName: { mode: "column", fixedName: "", column: "run" },
      representativeColumns: ["note"],
    };
    const context = realTyping({ multi: table });
    const baseline = buildMicrohaplotypes(section, context);
    expect(baseline.status).toBe("ready");
    expect(codes(baseline)).toEqual(["mhap/duplicate-target-seq"]);

    for (const chunkSize of [1, 2, 3, 5, DEFAULT_MHAP_CHUNK_SIZE, 100]) {
      const result = buildMicrohaplotypes(section, context, { chunkSize });
      expect(result.status).toBe("ready");
      expect(result.fragment).toEqual(baseline.fragment);
      expect(result.summary).toEqual(baseline.summary);
      expect(result.notices).toEqual(baseline.notices);
    }
  });

  it("builds a zero-row allele table cleanly across chunk sizes", () => {
    const emptyTable: RawTable = { columns: ["sample", "target", "seq", "reads"], rows: [] };
    const section: Draft["microhaplotypes"] = {
      ...empty.microhaplotypes,
      table: mappedTable("empty", emptyTable, ALLELE_MAPPING),
    };
    const context = testContext({ empty: emptyTable });
    for (const chunkSize of [1, DEFAULT_MHAP_CHUNK_SIZE]) {
      const result = buildMicrohaplotypes(section, context, { chunkSize });
      expect(result.status).toBe("ready");
      expect(result.summary).toEqual({
        rows: 0,
        librarySamples: 0,
        targets: 0,
        microhaplotypes: 0,
        runNames: [],
      });
      expect(result.fragment).toEqual({
        representative_microhaplotypes: { targets: [] },
        detected_microhaplotypes: [{ library_samples: [] }],
      });
    }
  });

  it("rejects a non-positive or non-integer chunkSize", () => {
    const context = testContext({ alleles: ALLELES });
    const section: Draft["microhaplotypes"] = {
      ...empty.microhaplotypes,
      table: mappedTable("alleles", ALLELES, ALLELE_MAPPING),
    };
    expect(() => buildMicrohaplotypes(section, context, { chunkSize: 0 })).toThrow(RangeError);
    expect(() => buildMicrohaplotypes(section, context, { chunkSize: -5 })).toThrow(RangeError);
    expect(() => buildMicrohaplotypes(section, context, { chunkSize: 2.5 })).toThrow(RangeError);
  });
});

const TARGETS = rawTable([
  { name: "t1", fwd: "AAAA", rev: "CCCC", chrom: "chr1", start: "10", end: "20" },
  { name: "t2", fwd: "AAAG", rev: "CCCG", chrom: "chr1", start: "30", end: "40" },
]);
const TARGET_MAPPING = mapping({
  targetName: "name",
  forwardPrimersSeq: "fwd",
  reversePrimersSeq: "rev",
});

function panel(patch: Partial<PanelEntry> = {}): PanelEntry {
  return {
    ...createPanelEntry("P1"),
    table: mappedTable("targets", TARGETS, TARGET_MAPPING),
    ...patch,
  };
}

describe("panel", () => {
  const context = testContext({ targets: TARGETS });

  it("is empty with one blank panel", () => {
    expect(buildPanel(empty.panel, context).status).toBe("empty");
  });

  it("is incomplete without a name, prefixing the panel", () => {
    const result = buildPanel({ panels: [panel({ name: "" })] }, context);
    expect(result.status).toBe("incomplete");
    expect(result.notices).toEqual([
      expect.objectContaining({
        code: "panel/missing-name",
        message: "Panel 1: Give the panel a name.",
      }),
    ]);
  });

  it("is ready with a summary and the fragment of each panel", () => {
    const entry = panel();
    const result = buildPanel({ panels: [entry] }, context);
    expect(result.status).toBe("ready");
    expect(result.summary).toEqual({
      panels: [
        { id: entry.id, name: "P1", targets: 2, genomes: 0, contentKey: expect.any(String) },
      ],
      targets: 2,
      genomes: 0,
    });
    expect(result.summary?.panels[0]?.contentKey).toBe(
      panelContentKey(result.fragment?.byPanel[entry.id]),
    );
    expect(result.fragment?.byPanel[entry.id]?.panel_info[0]?.panel_name).toBe("P1");
  });

  it("is an error for blank primers and names, naming every column and its rows up to a cap", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      name: index === 3 ? "" : `t${index}`,
      fwd: "AAAA",
      rev: index === 0 ? "CCCC" : " ",
    }));
    const table = rawTable(rows);
    const result = buildPanel(
      { panels: [panel({ table: mappedTable("blanks", table, TARGET_MAPPING) })] },
      testContext({ blanks: table }),
    );
    expect(result.status).toBe("error");
    expect(result.notices.map((n) => [n.code, n.column, n.message])).toEqual([
      [
        "table/blank-required",
        "name",
        'Panel "P1": Column "name" (targetname) is blank in row 5. Every row needs a value for “targetName”. Fill it in.',
      ],
      [
        "table/blank-required",
        "rev",
        'Panel "P1": Column "rev" (reverseprimersseq) is blank in rows 3, 4, 5, 6, 7, 8, 9, 10 and 3 more. Every row needs a value for “reversePrimersSeq”. Fill them in.',
      ],
    ]);
  });

  it("is an error for a repeated target", () => {
    const table = rawTable([
      { name: "t1", fwd: "AAAA", rev: "CCCC" },
      { name: "t1", fwd: "AAAG", rev: "CCCG" },
    ]);
    const result = buildPanel(
      { panels: [panel({ table: mappedTable("dup", table, TARGET_MAPPING) })] },
      testContext({ dup: table }),
    );
    expect(result.status).toBe("error");
    expect(codes(result)).toEqual(["panel/duplicate-target-names"]);
    expect(result.notices[0]?.message).toContain('"t1"');
  });

  it("needs a genome for locations, and accepts one typed in", () => {
    const located = mapping({
      ...TARGET_MAPPING.fields,
      chrom: "chrom",
      insertStart: "start",
      insertEnd: "end",
    });
    const noGenome = buildPanel(
      { panels: [panel({ table: mappedTable("targets", TARGETS, located) })] },
      context,
    );
    expect(noGenome.status).toBe("error");
    expect(codes(noGenome)).toEqual(["panel/location-without-genome"]);

    const half = panel({
      table: mappedTable("targets", TARGETS, located),
      genome: { ...createPanelEntry().genome, mode: "manual" },
    });
    const halfResult = buildPanel(
      {
        panels: [
          {
            ...half,
            genome: {
              ...half.genome,
              manual: {
                ...half.genome.manual,
                values: { ...half.genome.manual.values, name: "3D7" },
              },
            },
          },
        ],
      },
      context,
    );
    expect(halfResult.status).toBe("incomplete");
    expect(codes(halfResult)).toEqual(["form/missing-required"]);

    const genome = {
      ...half.genome,
      manual: {
        ...half.genome.manual,
        values: {
          name: "3D7",
          genome_version: "2020_09",
          taxon_id: "5833",
          url: "https://example.org/3d7.fasta",
          gff_url: "",
          chromosomes: "",
        },
      },
    };
    const full = buildPanel({ panels: [{ ...half, genome }] }, context);
    expect(full.status).toBe("ready");
    expect(full.fragment?.merged.targeted_genomes).toEqual([
      {
        name: "3D7",
        genome_version: "2020_09",
        taxon_id: [5833],
        url: "https://example.org/3d7.fasta",
      },
    ]);
  });

  it("uses a saved panel, and rejects a damaged one", () => {
    const fragment = panelInfoTableToPmo(
      [{ target_name: "s1", fwd_primer: "AC", rev_primer: "GT" }],
      { panelName: "Saved" },
    );
    const json = toJsonValue(fragment);
    if (json === null) throw new Error("not JSON");
    const saved = {
      savedPanelId: "x",
      name: "Saved",
      savedAt: "2026-01-01T00:00:00.000Z",
      fragment: json,
    };
    const result = buildPanel(
      { panels: [panel(), { ...createPanelEntry(), source: "saved", saved }] },
      context,
    );
    expect(result.status).toBe("ready");
    expect(result.summary?.targets).toBe(3);
    expect(result.fragment?.merged.panel_info.map((p) => p.panel_name)).toEqual(["P1", "Saved"]);

    const broken = buildPanel(
      {
        panels: [
          { ...createPanelEntry(), source: "saved", saved: { ...saved, fragment: { nope: 1 } } },
        ],
      },
      context,
    );
    expect(broken.status).toBe("error");
  });

  it("renames a saved panel in the draft, and checks the new name", () => {
    const fragment = toJsonValue(
      panelInfoTableToPmo([{ target_name: "s1", fwd_primer: "AC", rev_primer: "GT" }], {
        panelName: "Saved",
      }),
    );
    if (fragment === null) throw new Error("not JSON");
    const saved = { savedPanelId: "x", name: "Lab_panel", savedAt: "2026-01-01", fragment };
    const entry: PanelEntry = { ...createPanelEntry(), source: "saved", saved };
    const result = buildPanel({ panels: [entry] }, context);
    expect(result.status).toBe("ready");
    expect(result.summary?.panels[0]?.name).toBe("Lab_panel");
    expect(result.fragment?.merged.panel_info.map((p) => p.panel_name)).toEqual(["Lab_panel"]);

    const spaced = buildPanel(
      { panels: [{ ...entry, saved: { ...saved, name: "Lab panel" } }] },
      context,
    );
    expect(spaced.status).toBe("error");
    expect(spaced.notices[0]).toMatchObject({ code: "panel/invalid-name", panelId: entry.id });
  });

  it("points each panel's notices at that panel, even when two share a name", () => {
    const first = panel();
    const second = { ...createPanelEntry("P1") };
    const result = buildPanel({ panels: [first, second] }, context);
    expect(result.notices).toMatchObject([
      {
        code: "table/not-imported",
        panelId: second.id,
        message: 'Panel "P1": Import the target table.',
      },
    ]);
    const blank = createPanelEntry();
    expect(buildPanel({ panels: [first, blank] }, context).notices).toMatchObject([
      { code: "panel/empty", panelId: blank.id },
    ]);
  });

  it("flags an extra empty panel and repeated panel names", () => {
    expect(codes(buildPanel({ panels: [panel(), createPanelEntry()] }, context))).toEqual([
      "panel/empty",
    ]);
    const twice = buildPanel({ panels: [panel(), panel()] }, context);
    expect(twice.status).toBe("error");
    expect(codes(twice)).toEqual(["panel/duplicate-panel-names"]);
  });
});

const SPECIMENS = rawTable([
  { id: "0007", date: "2020-01", country: "Kenya" },
  { id: "0008", date: null, country: "Kenya" },
]);

describe("specimens and library samples", () => {
  const context = testContext({ specimens: SPECIMENS });

  it("goes from empty to incomplete to ready to error", () => {
    expect(buildSpecimens({ table: null }, context).status).toBe("empty");
    const unmapped = buildSpecimens(
      { table: mappedTable("specimens", SPECIMENS, mapping({ specimenName: null })) },
      context,
    );
    expect(unmapped.status).toBe("incomplete");
    const mappedResult = buildSpecimens(
      {
        table: mappedTable(
          "specimens",
          SPECIMENS,
          mapping({ specimenName: "id", collectionCountry: "country" }),
        ),
      },
      context,
    );
    expect(mappedResult.status).toBe("ready");
    expect(mappedResult.fragment?.map((s) => s.specimen_name)).toEqual(["0007", "0008"]);
    const blanks = buildSpecimens(
      {
        table: mappedTable(
          "specimens",
          SPECIMENS,
          mapping({ specimenName: "id", collectionDate: "date" }),
        ),
      },
      context,
    );
    expect(blanks.status).toBe("error");
    expect(codes(blanks)).toEqual(["metatable/null-values"]);
    expect(blanks.notices[0]?.message).toContain('column "date" (collectiondate) (row 3)');
  });

  it("keeps extra columns as text, as written", () => {
    const table = rawTable([
      { id: "S1", plate: "01", code: "007" },
      { id: "S2", plate: "NA", code: "12" },
    ]);
    const result = buildSpecimens(
      {
        table: mappedTable("plates", table, mapping({ specimenName: "id" }, ["plate", "code"])),
      },
      realTyping({ plates: table }),
    );
    expect(result.status).toBe("ready");
    expect(result.fragment?.map((s) => [s["plate"], s["code"]])).toEqual([
      ["01", "007"],
      ["NA", "12"],
    ]);
  });

  it("is an error when a column is mapped twice", () => {
    const result = buildSpecimens(
      {
        table: mappedTable(
          "specimens",
          SPECIMENS,
          mapping({ specimenName: "id", geoAdmin3: "id" }),
        ),
      },
      context,
    );
    expect(result.status).toBe("error");
    expect(codes(result)).toEqual(["mapping/duplicate-column"]);
  });

  it("builds library samples without the builder's default column names", () => {
    const table = rawTable([{ lib: "L1", spec: "S1", panel: "P1", seq: "run1" }]);
    const result = buildLibrarySamples(
      {
        table: mappedTable(
          "libs",
          table,
          mapping({ librarySampleName: "lib", specimenName: "spec", panelName: "panel" }),
        ),
      },
      testContext({ libs: table }),
    );
    expect(result.status).toBe("ready");
    expect(result.fragment).toEqual([
      { library_sample_name: "L1", specimen_name: "S1", panel_name: "P1" },
    ]);
  });
});

describe("project and sequencing", () => {
  const context = testContext({});

  it("treats blank records as nothing entered", () => {
    expect(buildProject(empty.project, context).status).toBe("empty");
    expect(buildSequencing(empty.sequencing, context).status).toBe("empty");
  });

  it("is incomplete without a required field and an error for a bad value", () => {
    const missing = buildProject(
      { ...empty.project, records: [createProjectRecord({ project_name: "P1" })] },
      context,
    );
    expect(missing.status).toBe("incomplete");
    expect(missing.notices).toEqual([
      expect.objectContaining({
        code: "form/missing-required",
        message: "Project 1: fill in “Description”.",
      }),
    ]);
    const bad = buildProject(
      {
        ...empty.project,
        records: [createProjectRecord({ project_name: "P*1", project_description: "d" })],
      },
      context,
    );
    expect(bad.status).toBe("error");
    expect(codes(bad)).toEqual(["form/invalid-value"]);
  });

  it("drops blanks, splits lists and writes extra fields", () => {
    const record = {
      ...createProjectRecord({
        project_name: "P1",
        project_description: "Study",
        project_contributors: "Ann\n\nBen\n",
      }),
      extra: [{ id: "e", key: "funder", value: "NIH" }],
    };
    const result = buildProject({ ...empty.project, records: [record] }, context);
    expect(result.status).toBe("ready");
    expect(result.fragment).toEqual([
      {
        project_name: "P1",
        project_description: "Study",
        project_contributors: ["Ann", "Ben"],
        funder: "NIH",
      },
    ]);
  });

  it("reads records from a table, naming the row at fault", () => {
    const table = rawTable([
      { name: "P1", about: "first" },
      { name: "P2", about: null },
    ]);
    const result = buildProject(
      {
        mode: "table",
        records: [],
        table: mappedTable(
          "projects",
          table,
          mapping({ project_name: "name", project_description: "about" }),
        ),
      },
      testContext({ projects: table }),
    );
    expect(result.status).toBe("incomplete");
    expect(result.notices[0]?.message).toBe("Row 3: fill in “Description”.");
  });

  it("checks dates and repeated names", () => {
    const base = {
      sequencing_info_name: "run1",
      seq_platform: "ILLUMINA",
      seq_instrument_model: "MiSeq",
      library_layout: "paired-end",
      library_strategy: "AMPLICON",
      library_source: "GENOMIC",
      library_selection: "PCR",
    };
    const badDate = buildSequencing(
      { ...empty.sequencing, records: [createSequencingRecord({ ...base, seq_date: "May 2024" })] },
      context,
    );
    expect(badDate.status).toBe("error");
    expect(badDate.notices[0]?.message).toContain("YYYY-MM");
    const twice = buildSequencing(
      {
        ...empty.sequencing,
        records: [createSequencingRecord(base), createSequencingRecord(base)],
      },
      context,
    );
    expect(codes(twice)).toEqual(["form/duplicate-name"]);
    const fine = buildSequencing(
      { ...empty.sequencing, records: [createSequencingRecord(base)] },
      context,
    );
    expect(fine.summary).toEqual({ runs: 1, names: ["run1"] });
  });
});

describe("bioinformatics", () => {
  const context = testContext({});
  const method = {
    ...createMethodRecord("pipeline"),
    steps: [createMethodStep({ program: "dada2", program_version: "v1.26" })],
  };

  it("is empty with blank records, and lists methods for runs to pick", () => {
    expect(buildBioinformatics(empty.bioinformatics, context).status).toBe("empty");
    const result = buildBioinformatics(
      { ...empty.bioinformatics, methods: { ...empty.bioinformatics.methods, records: [method] } },
      context,
    );
    expect(result.status).toBe("ready");
    expect(result.summary?.methods).toEqual([{ key: method.id, name: "pipeline", steps: 1 }]);
  });

  it("needs a method for each run", () => {
    const runs = {
      ...empty.bioinformatics.runs,
      records: [createRunRecord({ bioinformatics_run_name: "r1" })],
    };
    const result = buildBioinformatics({ ...empty.bioinformatics, runs }, context);
    expect(result.status).toBe("incomplete");
    expect(codes(result)).toEqual(["bioinformatics/no-methods"]);
    const linked = buildBioinformatics(
      { methods: { ...empty.bioinformatics.methods, records: [method] }, runs },
      context,
    );
    expect(linked.fragment?.runs).toEqual([
      { bioinformatics_run_name: "r1", bioinformatics_methods_id: 0 },
    ]);
    expect(linked.fragment?.methods).toEqual([
      {
        methods: [{ program: "dada2", program_version: "v1.26" }],
        bioinformatics_method_name: "pipeline",
      },
    ]);
  });

  it("keeps each run's own method when a run before it holds only an extra field name", () => {
    const methodA = { ...method, id: "method-a", name: "A" };
    const methodB = {
      ...createMethodRecord("B"),
      id: "method-b",
      steps: [createMethodStep({ program: "seekdeep", program_version: "v3" })],
    };
    const onlyExtraName = {
      ...createRunRecord({}, "method-a"),
      extra: [{ id: "x", key: "note", value: "" }],
    };
    const result = buildBioinformatics(
      {
        methods: { ...empty.bioinformatics.methods, records: [methodA, methodB] },
        runs: {
          ...empty.bioinformatics.runs,
          records: [
            onlyExtraName,
            createRunRecord({ bioinformatics_run_name: "r2" }, "method-b"),
            createRunRecord({ bioinformatics_run_name: "r3" }, "method-a"),
          ],
        },
      },
      context,
    );
    expect(result.status).toBe("ready");
    expect(result.fragment?.runs).toEqual([
      { bioinformatics_run_name: "r2", bioinformatics_methods_id: 1 },
      { bioinformatics_run_name: "r3", bioinformatics_methods_id: 0 },
    ]);
  });

  it("explains that a program link cannot hold a colon", () => {
    const step = createMethodStep({
      program: "dada2",
      program_version: "v1",
      program_url: "https://github.com/benjjneb/dada2",
    });
    const result = buildBioinformatics(
      {
        ...empty.bioinformatics,
        methods: { ...empty.bioinformatics.methods, records: [{ ...method, steps: [step] }] },
      },
      context,
    );
    expect(result.status).toBe("error");
    expect(result.notices[0]?.message).toContain("leave out https://");
  });

  it("imports methods grouped by a column and runs that name them", () => {
    const steps = rawTable([
      { method: "A", program: "cutadapt", version: "v4" },
      { method: "A", program: "dada2", version: "v1" },
      { method: "B", program: "seekdeep", version: "v3" },
    ]);
    const runs = rawTable([
      { run: "r1", method: "B" },
      { run: "r2", method: "C" },
    ]);
    const draft: Draft["bioinformatics"] = {
      methods: {
        mode: "table",
        records: [],
        table: {
          table: mappedTable(
            "steps",
            steps,
            mapping({ program: "program", program_version: "version" }),
          ),
          groupColumn: "method",
        },
      },
      runs: {
        mode: "table",
        records: [],
        table: {
          table: mappedTable("runs", runs, mapping({ bioinformatics_run_name: "run" })),
          methodMode: "column",
          methodRef: null,
          methodColumn: "method",
        },
      },
    };
    const result = buildBioinformatics(draft, testContext({ steps, runs }));
    expect(result.summary?.methods.map((m) => [m.name, m.steps])).toEqual([
      ["A", 2],
      ["B", 1],
    ]);
    expect(result.status).toBe("error");
    expect(result.notices).toEqual([
      expect.objectContaining({
        code: "bioinformatics/unknown-method",
        message: expect.stringContaining('"C"'),
      }),
    ]);
  });
});

describe("read counts", () => {
  const totals = rawTable([
    { id: "S1", total: "10" },
    { id: "S2", total: "12" },
  ]);
  const stages = rawTable([
    { sample: "S1", target: "t1", stage: "demux", count: "8" },
    { sample: "S9", target: "t1", stage: "demux", count: "3" },
  ]);
  const context = testContext({ totals, stages });
  const totalsTable = mappedTable(
    "totals",
    totals,
    mapping({ librarySampleName: "id", totalRawCount: "total" }),
  );
  const stagesTable = mappedTable(
    "stages",
    stages,
    mapping({
      librarySampleName: "sample",
      targetName: "target",
      stage: "stage",
      readCount: "count",
    }),
  );

  it("goes from empty to incomplete to ready", () => {
    expect(buildReadCounts(empty.readCounts, context).status).toBe("empty");
    const onlyStages = buildReadCounts({ ...empty.readCounts, byStage: stagesTable }, context);
    expect(onlyStages.status).toBe("incomplete");
    expect(codes(onlyStages)).toEqual(["read-counts/no-totals"]);
    const result = buildReadCounts(
      { ...empty.readCounts, totals: totalsTable, byStage: stagesTable },
      context,
    );
    expect(result.status).toBe("ready");
    expect(result.summary).toEqual({ librarySamples: 2, runs: 1, stages: ["demux"] });
    expect(codes(result)).toEqual(["read-counts/unmatched-library-samples"]);
    expect(result.notices[0]?.message).toContain('"S9"');
  });

  it("refuses to rename the by-stage sample column onto a column it already has", () => {
    // pmotools-ts reads both tables' sample column from one option, so the
    // by-stage column "sample" is renamed to "id". Here "id" already exists.
    const clashing = rawTable([
      { sample: "S1", id: "x", target: "t1", stage: "demux", count: "8" },
    ]);
    const result = buildReadCounts(
      {
        ...empty.readCounts,
        totals: totalsTable,
        byStage: mappedTable("clashing", clashing, stagesTable.mapping),
      },
      testContext({ totals, clashing }),
    );
    expect(result.status).toBe("error");
    expect(codes(result)).toEqual(["read-counts/sample-column-clash"]);
  });

  it("is an error for a count that is not a whole number", () => {
    const bad = rawTable([{ id: "S1", total: "ten" }]);
    const result = buildReadCounts(
      {
        ...empty.readCounts,
        totals: mappedTable(
          "bad",
          bad,
          mapping({ librarySampleName: "id", totalRawCount: "total" }),
        ),
      },
      testContext({ bad }),
    );
    expect(result.status).toBe("error");
    expect(codes(result)).toEqual(["read-counts/invalid-count"]);
    expect(result.notices[0]?.message).toBe(
      'Column "total" of the totals table needs a whole number in row 2, but holds "ten".',
    );
  });
});

describe("suggestions", () => {
  it("offers panel, sequencing, project and run names from the tables", () => {
    const libs = rawTable([
      { lib: "L1", panel: "P1", seq: "run1" },
      { lib: "L2", panel: "P1", seq: "run2" },
    ]);
    const specimens = rawTable([{ id: "S1", project: "Study" }]);
    const draft: Draft = {
      ...empty,
      microhaplotypes: {
        ...empty.microhaplotypes,
        table: mappedTable("alleles", ALLELES, ALLELE_MAPPING),
        runName: { mode: "column", fixedName: "", column: "run" },
      },
      librarySamples: {
        table: mappedTable(
          "libs",
          libs,
          mapping({ panelName: "panel", sequencingInfoName: "seq" }),
        ),
      },
      specimens: {
        table: mappedTable("specimens", specimens, mapping({ projectName: "project" })),
      },
    };
    const lookup = testContext({
      alleles: ALLELES,
      libs,
      specimens: specimens satisfies RawTable,
    }).tables;
    expect(collectSuggestions(draft, lookup)).toEqual({
      panelNames: ["P1"],
      sequencingNames: ["run1", "run2"],
      projectNames: ["Study"],
      runNames: ["r1", "r2"],
    });
  });
});

function specimensWith(table: RawTable, fields: Record<string, string>): Draft["specimens"] {
  return { table: mappedTable("specimens", table, mapping({ specimenName: "id", ...fields })) };
}

describe("with the real field sets and mapping checks", () => {
  const PANEL = rawTable([
    { target: "t1", fwd: "AC", rev: "GT", insert_start: "10", insert_end: "20", note: "x" },
    { target: "t2", fwd: "AA", rev: "TT", insert_start: "30", insert_end: "40", note: "y" },
  ]);
  const panelContext = createBuildContext(new Map([["targets", PANEL]]));
  const panelWith = (
    fields: Record<string, string | null>,
    extra: string[] = [],
  ): Draft["panel"] => ({
    panels: [
      {
        ...createPanelEntry("P1"),
        table: mappedTable(
          "targets",
          PANEL,
          mapping(
            { targetName: "target", forwardPrimersSeq: "fwd", reversePrimersSeq: "rev", ...fields },
            extra,
          ),
        ),
      },
    ],
  });

  it("turns a partly mapped location into an incomplete status and a notice, not a builder error", () => {
    const result = buildPanel(panelWith({ insertStart: "insert_start" }), panelContext);
    expect(result.status).toBe("incomplete");
    expect(result.notices).toEqual([
      {
        severity: "error",
        code: "mapping/incomplete-group",
        message:
          'Panel "P1": Insert start is mapped, but Chromosome and Insert end are not. Map all three or none.',
        tableId: "targets",
        fieldKey: "insertStart",
        panelId: result.notices[0]?.panelId,
      },
    ]);
    expect(result.notices[0]?.panelId).toEqual(expect.any(String));
  });

  it("reports an extra column that is also mapped to a field", () => {
    const result = buildPanel(panelWith({}, ["target", "note"]), panelContext);
    expect(result.status).toBe("error");
    expect(result.notices).toMatchObject([
      {
        code: "mapping/additional-column-mapped",
        column: "target",
        fieldKey: "targetName",
        tableId: "targets",
      },
    ]);
  });

  const HOSTS = rawTable([
    { id: "S1", pregnant: "TRUE", travel: "yes", meal: "1", taxon: "5833" },
    { id: "S2", pregnant: "false", travel: "No", meal: "0", taxon: "5833" },
    { id: "S3", pregnant: null, travel: "NA", meal: "", taxon: "5833" },
  ]);
  const specimenContext = createBuildContext(new Map([["specimens", HOSTS]]));

  it("writes yes-or-no columns as booleans, and leaves blanks out", () => {
    const result = buildSpecimens(
      specimensWith(HOSTS, {
        gravid: "pregnant",
        hasTravelOutSixMonth: "travel",
        bloodMeal: "meal",
      }),
      specimenContext,
    );
    expect(result.status).toBe("ready");
    expect(result.fragment).toMatchObject([
      { specimen_name: "S1", gravid: true, has_travel_out_six_month: true, blood_meal: true },
      { specimen_name: "S2", gravid: false, has_travel_out_six_month: false, blood_meal: false },
      { specimen_name: "S3" },
    ]);
    const third = result.fragment?.[2] ?? {};
    expect(Object.keys(third)).not.toContain("gravid");
  });

  it("reports a yes-or-no value it does not recognise instead of passing it on", () => {
    const table = rawTable([
      { id: "S1", pregnant: "TRUE" },
      { id: "S2", pregnant: "maybe" },
      { id: "S3", pregnant: "maybe" },
    ]);
    const result = buildSpecimens(
      specimensWith(table, { gravid: "pregnant" }),
      createBuildContext(new Map([["specimens", table]])),
    );
    expect(result.status).toBe("error");
    expect(result.notices).toEqual([
      {
        severity: "error",
        code: "table/invalid-boolean",
        message:
          'Column "pregnant" must hold yes or no (such as TRUE, FALSE, yes, no, 1 or 0), but rows 3 and 4 hold "maybe". Correct them, leave them blank, or unmap the column.',
        tableId: "specimens",
        column: "pregnant",
        fieldKey: "gravid",
      },
    ]);
  });

  it("writes several taxon IDs in one cell as whole numbers", () => {
    const table = rawTable([
      { id: "S1", taxon: "5833" },
      { id: "S2", taxon: "5833,5855" },
    ]);
    const result = buildSpecimens(
      specimensWith(table, { specimenTaxonId: "taxon" }),
      createBuildContext(new Map([["specimens", table]])),
    );
    expect(result.status).toBe("ready");
    expect(result.fragment?.map((s) => s.specimen_taxon_id)).toEqual([[5833], [5833, 5855]]);
  });

  it.each([
    {
      field: "specimenTaxonId",
      cell: "5833,human",
      code: "metatable/invalid-taxon-id",
      message:
        'Column "value" (specimen taxon ID) must hold NCBI taxonomy numbers such as 5833, separated by commas, but row 3 holds "human". Correct it, or unmap the column if the field is optional.',
    },
    {
      field: "gravidity",
      cell: "two",
      code: "metatable/invalid-integer",
      message:
        'Column "value" (previous pregnancies) must hold whole numbers, but row 3 holds "two". Correct it, or unmap the column if the field is optional.',
    },
    {
      field: "hostAge",
      cell: "old",
      code: "metatable/invalid-number",
      message:
        'Column "value" (host age) must hold numbers, but row 3 holds "old". Correct it, or unmap the column if the field is optional.',
    },
  ])("names the column, row and value for $code", ({ field, cell, code, message }) => {
    const table = rawTable([
      { id: "S1", value: "1" },
      { id: "S2", value: cell },
    ]);
    const result = buildSpecimens(
      specimensWith(table, { [field]: "value" }),
      createBuildContext(new Map([["specimens", table]])),
    );
    expect(result.status).toBe("error");
    expect(result.notices).toEqual([
      expect.objectContaining({ code, message, column: "value", fieldKey: field }),
    ]);
  });

  it("writes single taxon IDs as numbers", () => {
    const result = buildSpecimens(
      specimensWith(HOSTS, { specimenTaxonId: "taxon" }),
      specimenContext,
    );
    expect(result.status).toBe("ready");
    expect(result.fragment?.[0]?.specimen_taxon_id).toEqual([5833]);
  });
});
