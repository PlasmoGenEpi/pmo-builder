import { PmoError, validatePmo } from "pmotools-ts";
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
} from "@/domain/draft";
import type { RawTable } from "@/domain/types";

import { getFieldSet } from "@/domain/fields";

import { buildAllSections, buildDraft, mergeSections, pathInWords } from "./merge";
import type { SectionResults } from "./results";
import { errorNotice, withLibraryDetail } from "./notices";
import {
  EXAMPLE_MAPPINGS,
  mappedTable,
  mapping,
  rawTable,
  readExample,
  testContext,
} from "./testing";

const tables: Record<string, RawTable> = {
  alleles: readExample("mad4hatter_allele_data_example.csv"),
  panel: readExample("mad4hatter_panel_info_example.csv"),
  metadata: readExample("mad4hatter_metadata_example.tsv"),
  totals: readExample("example_raw_reads.txt"),
  byStage: readExample("reads_per_stage.txt"),
};

/** The whole MAD4HATTER example, with every optional section filled in. */
function exampleDraft(): Draft {
  const empty = createEmptyDraft();
  const method = createMethodRecord("mad4hatter");
  const step = createMethodStep({
    program: "mad4hatter",
    program_version: "v1.0.0",
    program_description: "amplicon pipeline",
  });
  return {
    ...empty,
    microhaplotypes: {
      table: mappedTable("alleles", tables.alleles ?? rawTable([]), EXAMPLE_MAPPINGS.alleles),
      runName: { mode: "fixed", fixedName: "bioinfo_run1", column: null },
      representativeColumns: [],
    },
    panel: {
      panels: [
        {
          ...createPanelEntry("Mad4hatter"),
          table: mappedTable("panel", tables.panel ?? rawTable([]), EXAMPLE_MAPPINGS.panel),
        },
      ],
    },
    specimens: {
      table: mappedTable("metadata", tables.metadata ?? rawTable([]), EXAMPLE_MAPPINGS.specimens),
    },
    librarySamples: {
      table: mappedTable(
        "metadata",
        tables.metadata ?? rawTable([]),
        EXAMPLE_MAPPINGS.librarySamples,
      ),
    },
    project: {
      mode: "manual",
      records: [
        createProjectRecord({
          project_name: "PRJNA1040019",
          project_description: "MAD4HATTER example",
        }),
      ],
      table: null,
    },
    sequencing: {
      mode: "manual",
      records: [
        createSequencingRecord({
          sequencing_info_name: "run1",
          seq_platform: "ILLUMINA",
          seq_instrument_model: "NextSeq 2000",
          library_layout: "paired-end",
          library_strategy: "AMPLICON",
          library_source: "GENOMIC",
          library_selection: "PCR",
          seq_date: "2023-05",
        }),
      ],
      table: null,
    },
    bioinformatics: {
      methods: { ...empty.bioinformatics.methods, records: [{ ...method, steps: [step] }] },
      runs: {
        ...empty.bioinformatics.runs,
        records: [
          createRunRecord(
            { bioinformatics_run_name: "bioinfo_run1", run_date: "2023-06-01" },
            method.id,
          ),
        ],
      },
    },
    readCounts: {
      totals: mappedTable("totals", tables.totals ?? rawTable([]), EXAMPLE_MAPPINGS.totals),
      byStage: mappedTable("byStage", tables.byStage ?? rawTable([]), EXAMPLE_MAPPINGS.byStage),
      runName: { mode: "fixed", fixedName: "bioinfo_run1", column: null },
    },
  };
}

describe("buildDraft on the MAD4HATTER example", () => {
  const { sections, merge } = buildDraft(exampleDraft(), testContext(tables), {
    creationDate: "2026-01-01",
  });

  it("builds every section", () => {
    for (const result of Object.values(sections)) {
      expect({ section: result.section, notices: result.notices }).toEqual({
        section: result.section,
        notices: [],
      });
      expect(result.status).toBe("ready");
    }
  });

  it("merges into a valid PMO with no integrity errors", () => {
    expect(merge.notices).toEqual([]);
    expect(merge.status).toBe("ready");
    if (merge.outcome.kind !== "built") throw new Error("not built");
    expect(merge.outcome.valid).toBe(true);
    expect(validatePmo(merge.outcome.pmo).valid).toBe(true);
    expect(merge.outcome.pmo.pmo_header.creation_date).toBe("2026-01-01");
  });

  it("reports the merge summary", () => {
    if (merge.outcome.kind !== "built") throw new Error("not built");
    expect(merge.outcome.summary).toEqual({
      specimens: 50,
      librarySamples: 50,
      librarySamplesWithDetections: 49,
      panels: 1,
      targets: 276,
      targetsWithCalls: 21,
      genomes: 0,
      sequencingRuns: 1,
      projects: 1,
      bioinformaticsRuns: 1,
      librarySamplesWithReadCounts: 3,
    });
  });

  it("links specimens to the project and library samples to the sequencing run", () => {
    if (merge.outcome.kind !== "built") throw new Error("not built");
    const { pmo } = merge.outcome;
    expect(pmo.specimen_info[0]?.["project_id"]).toBe(0);
    expect(pmo.library_sample_info[0]?.["sequencing_info_id"]).toBe(0);
    expect(pmo.specimen_info[0]?.["specimen_taxon_id"]).toEqual([5833]);
    expect(pmo.specimen_info[0]?.["collection_date"]).toBe("2019-01");
  });
});

describe("buildDraft with several taxon IDs for a specimen", () => {
  it("writes them as whole numbers in a PMO that passes the format check", () => {
    const metadata = tables.metadata ?? rawTable([]);
    const edited: RawTable = {
      columns: metadata.columns,
      // oxlint-disable-next-line oxc/no-map-spread -- builds fresh fixtures; nothing to mutate in place
      rows: metadata.rows.map((row, index) =>
        index === 0 ? { ...row, samp_taxon_id: "5833,5855" } : row,
      ),
    };
    const draft = exampleDraft();
    const { merge } = buildDraft(
      {
        ...draft,
        specimens: { table: mappedTable("edited", edited, EXAMPLE_MAPPINGS.specimens) },
      },
      testContext({ ...tables, edited }),
    );
    expect(merge.status).toBe("ready");
    if (merge.outcome.kind !== "built") throw new Error("not built");
    expect(merge.outcome.pmo.specimen_info[0]?.["specimen_taxon_id"]).toEqual([5833, 5855]);
    expect(validatePmo(merge.outcome.pmo).valid).toBe(true);
  });
});

/** The example draft with the project and sequencing run name columns unmapped. */
function withoutNames(base: Draft): Draft {
  const { projectName: _project, ...specimenFields } = EXAMPLE_MAPPINGS.specimens.fields;
  const { sequencingInfoName: _run, ...libraryFields } = EXAMPLE_MAPPINGS.librarySamples.fields;
  const metadata = tables.metadata ?? rawTable([]);
  return {
    ...base,
    specimens: { table: mappedTable("metadata", metadata, mapping(specimenFields)) },
    librarySamples: { table: mappedTable("metadata", metadata, mapping(libraryFields)) },
  };
}

describe("linking projects and sequencing runs", () => {
  const draft = exampleDraft();
  it("applies one project and one run to every specimen and library sample when no table names one", () => {
    const { merge } = buildDraft(
      { ...draft, specimens: { table: null }, librarySamples: { table: null } },
      testContext(tables),
    );
    expect(merge.status).toBe("ready");
    if (merge.outcome.kind !== "built") throw new Error("not built");
    const { pmo } = merge.outcome;
    expect(validatePmo(pmo).valid).toBe(true);
    expect(pmo.project_info?.map((p) => p.project_name)).toEqual(["PRJNA1040019"]);
    expect(pmo.specimen_info.every((s) => s["project_id"] === 0)).toBe(true);
    expect(pmo.library_sample_info.every((l) => l["sequencing_info_id"] === 0)).toBe(true);
    expect(pmo.specimen_info.some((s) => "project_name" in s)).toBe(false);
    expect(merge.notices).toEqual([
      expect.objectContaining({
        severity: "info",
        code: "draft/one-project-for-all",
        sections: ["project", "specimens"],
        message:
          'Project "PRJNA1040019" is applied to all 49 specimens, because there is no specimen table to name a project for each.',
      }),
      expect.objectContaining({
        severity: "info",
        code: "draft/one-run-for-all",
        sections: ["sequencing", "librarySamples"],
        message:
          'Sequencing run "run1" is applied to all 49 library samples, because there is no library sample table to name a run for each.',
      }),
    ]);
  });

  it("says when the tables are there but name no project or run", () => {
    const { merge } = buildDraft(withoutNames(draft), testContext(tables));
    expect(merge.status).toBe("ready");
    expect(merge.notices.map((n) => n.message)).toEqual([
      'Project "PRJNA1040019" is applied to all 50 specimens, because the specimen table names no project.',
      'Sequencing run "run1" is applied to all 50 library samples, because the library sample table names no sequencing run.',
    ]);
  });

  it("does not guess with two projects, and says what is needed", () => {
    const second = createProjectRecord({ project_name: "P2", project_description: "other" });
    const { merge } = buildDraft(
      {
        ...withoutNames(draft),
        project: { ...draft.project, records: [...draft.project.records, second] },
      },
      testContext(tables),
    );
    expect(merge.status).toBe("error");
    expect(merge.notices).toEqual([
      expect.objectContaining({
        code: "merge/incomplete-name-fields",
        sections: ["specimens", "project"],
        message:
          "There are 2 projects, so each specimen needs to name its project. Choose the project name column of the specimen table, and fill it in for every specimen.",
      }),
    ]);
  });

  it("names the records that lack a name when only some give one", () => {
    // A blank cell in a mapped name column stops the library sample table
    // itself, so take the names out of two built records.
    const built = buildAllSections(draft, testContext(tables));
    const sections: SectionResults = {
      ...built,
      librarySamples: {
        ...built.librarySamples,
        fragment: (built.librarySamples.fragment ?? []).map((library, index) => {
          if (index >= 2) return library;
          const { sequencing_info_name: _name, ...rest } = library;
          return rest;
        }),
      },
    };
    const merge = mergeSections(sections);
    expect(merge.status).toBe("error");
    expect(merge.notices).toEqual([
      expect.objectContaining({
        code: "merge/incomplete-name-fields",
        sections: ["librarySamples", "sequencing"],
        message:
          'Sequencing runs are entered, but 2 library samples have no sequencing run name ("example_sample_01" and "example_sample_02"). Fill in the sequencing run name column of the library sample table in every row.',
      }),
    ]);
  });

  it("warns when the tables name projects and runs that nothing links to", () => {
    const { merge } = buildDraft(
      {
        ...draft,
        project: { ...draft.project, records: [] },
        sequencing: { ...draft.sequencing, records: [] },
      },
      testContext(tables),
    );
    expect(merge.status).toBe("ready");
    expect(merge.notices).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "draft/unlinked-project-names",
        sections: ["specimens", "project"],
        message:
          'The specimen table names the project "PRJNA1040019", but no project is entered, so the PMO keeps the name without linking it to a project. Add the project on the Project step, or unmap the project name column.',
      }),
      expect.objectContaining({
        severity: "warning",
        code: "draft/unlinked-sequencing-names",
        sections: ["librarySamples", "sequencing"],
        message:
          'The library sample table names the sequencing run "run1", but no sequencing run is entered, so the PMO keeps the name without linking it to a run. Add the run on the Sequencing step, or unmap the sequencing run name column.',
      }),
    ]);
    // The names stay in the file, outside the fields the format defines, so it is still valid.
    if (merge.outcome.kind !== "built") throw new Error("not built");
    expect(merge.outcome.valid).toBe(true);
    expect(merge.outcome.pmo.specimen_info[0]?.["project_name"]).toBe("PRJNA1040019");
    expect(merge.outcome.pmo.specimen_info[0]?.["project_id"]).toBeUndefined();
  });
});

describe("format problems in words", () => {
  it("says a value is blank rather than that it has characters the format does not allow", () => {
    const alleles = rawTable([{ sample: "S1", target: "t1", seq: "ACGT", reads: "5" }]);
    const built = buildAllSections(
      smallDraft({ alleles }),
      testContext({ alleles, panel1: PANEL_1 }),
    );
    const panel = built.panel.fragment;
    if (panel === null) throw new Error("panel not built");
    const sections: SectionResults = {
      ...built,
      panel: {
        ...built.panel,
        fragment: {
          ...panel,
          merged: {
            ...panel.merged,
            // oxlint-disable-next-line oxc/no-map-spread -- builds fresh fixtures; nothing to mutate in place
            target_info: panel.merged.target_info.map((target) => ({
              ...target,
              reverse_primer: { ...target.reverse_primer, seq: "" },
            })),
          },
        },
      },
    };
    const notice = mergeSections(sections).notices.find((n) => n.code === "schema/pattern");
    expect(notice?.message).toBe(
      'Target "t1", reverse primer, field "seq" is blank. The PMO format needs a value there.',
    );
  });
});

describe("buildDraft with only the required sections", () => {
  it("creates specimens and library samples from the allele table", () => {
    const draft = exampleDraft();
    const minimal: Draft = {
      ...createEmptyDraft(),
      microhaplotypes: {
        ...draft.microhaplotypes,
        runName: { mode: "none", fixedName: "", column: null },
      },
      panel: draft.panel,
    };
    const { merge } = buildDraft(minimal, testContext(tables));
    expect(merge.status).toBe("ready");
    if (merge.outcome.kind !== "built") throw new Error("not built");
    expect(merge.outcome.summary.librarySamples).toBe(49);
    expect(merge.outcome.summary.specimens).toBe(49);
  });

  it("says which required section is missing", () => {
    const draft = exampleDraft();
    const { merge } = buildDraft(
      { ...createEmptyDraft(), panel: draft.panel },
      testContext(tables),
    );
    expect(merge.status).toBe("incomplete");
    expect(merge.outcome.kind).toBe("not-built");
    expect(merge.notices).toEqual([
      expect.objectContaining({ code: "draft/required-section", sections: ["microhaplotypes"] }),
    ]);
  });

  it("is empty when nothing is entered", () => {
    const { merge } = buildDraft(createEmptyDraft(), testContext({}));
    expect(merge).toEqual({ status: "empty", notices: [], outcome: { kind: "not-built" } });
  });
});

/** A small draft built from hand-written tables. */
function smallDraft(input: {
  readonly alleles: RawTable;
  readonly samples?: RawTable;
  readonly panels?: readonly { readonly name: string; readonly table: string }[];
}): Draft {
  const empty = createEmptyDraft();
  const panels = input.panels ?? [{ name: "P1", table: "panel1" }];
  return {
    ...empty,
    microhaplotypes: {
      ...empty.microhaplotypes,
      table: mappedTable(
        "alleles",
        input.alleles,
        mapping({ librarySampleName: "sample", targetName: "target", seq: "seq", reads: "reads" }),
      ),
    },
    panel: {
      // oxlint-disable-next-line oxc/no-map-spread -- builds fresh fixtures; nothing to mutate in place
      panels: panels.map((panel) => ({
        ...createPanelEntry(panel.name),
        table: mappedTable(
          panel.table,
          rawTable([{ t: "x", f: "A", r: "C" }]),
          mapping({ targetName: "t", forwardPrimersSeq: "f", reversePrimersSeq: "r" }),
        ),
      })),
    },
    librarySamples:
      input.samples === undefined
        ? empty.librarySamples
        : {
            table: mappedTable(
              "samples",
              input.samples,
              mapping({
                librarySampleName: "library",
                specimenName: "specimen",
                panelName: "panel",
              }),
            ),
          },
  };
}

const PANEL_1 = rawTable([
  { t: "t1", f: "AAAA", r: "CCCC" },
  { t: "t2", f: "AAAG", r: "CCCG" },
]);
const PANEL_2 = rawTable([{ t: "t3", f: "AAAT", r: "CCCT" }]);

describe("names that look like numbers", () => {
  it("keeps leading zeros in sample names", () => {
    const alleles = rawTable([
      { sample: "0012", target: "t1", seq: "ACGT", reads: "5" },
      { sample: "0013", target: "t1", seq: "ACGA", reads: "7" },
    ]);
    const { merge } = buildDraft(
      smallDraft({ alleles }),
      testContext({ alleles, panel1: PANEL_1 }),
    );
    if (merge.outcome.kind !== "built") throw new Error(JSON.stringify(merge.notices));
    expect(merge.outcome.pmo.library_sample_info.map((s) => s.library_sample_name)).toEqual([
      "0012",
      "0013",
    ]);
    expect(merge.outcome.pmo.specimen_info.map((s) => s.specimen_name)).toEqual(["0012", "0013"]);
  });

  it("links a numeric sample name between the allele table and the sample table", () => {
    const alleles = rawTable([
      { sample: "101", target: "t1", seq: "ACGT", reads: "5" },
      { sample: "102", target: "t2", seq: "ACGA", reads: "7" },
    ]);
    const samples = rawTable([
      { library: "101", specimen: "9001", panel: "P1" },
      { library: "102", specimen: "9002", panel: "P1" },
    ]);
    const { merge } = buildDraft(
      smallDraft({ alleles, samples }),
      testContext({ alleles, samples, panel1: PANEL_1 }),
    );
    // pmotools-ts makes each library sample its own specimen when there is no specimen table.
    expect(merge.notices).toEqual([
      expect.objectContaining({
        code: "draft/specimen-names-unused",
        sections: ["librarySamples", "specimens"],
      }),
    ]);
    if (merge.outcome.kind !== "built") throw new Error("not built");
    const { pmo } = merge.outcome;
    expect(pmo.library_sample_info.map((s) => s.library_sample_name)).toEqual(["101", "102"]);
    expect(pmo.specimen_info.map((s) => s.specimen_name)).toEqual(["101", "102"]);
    expect(
      pmo.detected_microhaplotypes[0]?.library_samples.map((s) => s.library_sample_id),
    ).toEqual([0, 1]);
  });
});

describe("cross-section problems", () => {
  it("merges two panels and assigns samples to each", () => {
    const alleles = rawTable([
      { sample: "S1", target: "t1", seq: "ACGT", reads: "5" },
      { sample: "S2", target: "t3", seq: "ACGA", reads: "7" },
    ]);
    const samples = rawTable([
      { library: "S1", specimen: "S1", panel: "P1" },
      { library: "S2", specimen: "S2", panel: "P2" },
    ]);
    const draft = smallDraft({
      alleles,
      samples,
      panels: [
        { name: "P1", table: "panel1" },
        { name: "P2", table: "panel2" },
      ],
    });
    const { sections, merge } = buildDraft(
      draft,
      testContext({ alleles, samples, panel1: PANEL_1, panel2: PANEL_2 }),
    );
    expect(sections.panel.summary).toEqual(
      expect.objectContaining({
        targets: 3,
        panels: [
          expect.objectContaining({ name: "P1", targets: 2 }),
          expect.objectContaining({ name: "P2", targets: 1 }),
        ],
      }),
    );
    expect(merge.status).toBe("ready");
    if (merge.outcome.kind !== "built") throw new Error("not built");
    expect(merge.outcome.pmo.panel_info.map((p) => p.panel_name)).toEqual(["P1", "P2"]);
    expect(merge.outcome.pmo.library_sample_info.map((s) => s.panel_id)).toEqual([0, 1]);
  });

  it("names a sample that is in the allele table but missing from the sample table", () => {
    const alleles = rawTable([
      { sample: "S1", target: "t1", seq: "ACGT", reads: "5" },
      { sample: "S3", target: "t1", seq: "ACGA", reads: "7" },
    ]);
    const samples = rawTable([{ library: "S1", specimen: "S1", panel: "P1" }]);
    const { merge } = buildDraft(
      smallDraft({ alleles, samples }),
      testContext({ alleles, samples, panel1: PANEL_1 }),
    );
    expect(merge.status).toBe("error");
    expect(merge.outcome.kind).toBe("merge-failed");
    expect(merge.notices).toEqual([
      expect.objectContaining({
        code: "merge/unresolved-names",
        sections: ["microhaplotypes", "librarySamples"],
        message: expect.stringContaining('"S3"'),
      }),
    ]);
  });

  it("names a target that is in the allele table but not in the panel", () => {
    const alleles = rawTable([{ sample: "S1", target: "t9", seq: "ACGT", reads: "5" }]);
    const { merge } = buildDraft(
      smallDraft({ alleles }),
      testContext({ alleles, panel1: PANEL_1 }),
    );
    expect(merge.notices).toEqual([
      expect.objectContaining({
        code: "merge/unresolved-names",
        sections: ["microhaplotypes", "panel"],
        message: expect.stringContaining('"t9"'),
      }),
    ]);
  });

  it("asks for a run name in the allele table when bioinformatics runs are entered", () => {
    const alleles = rawTable([{ sample: "S1", target: "t1", seq: "ACGT", reads: "5" }]);
    const base = smallDraft({ alleles });
    const method = {
      ...createMethodRecord("m"),
      steps: [createMethodStep({ program: "p", program_version: "v1" })],
    };
    const draft: Draft = {
      ...base,
      bioinformatics: {
        methods: { ...base.bioinformatics.methods, records: [method] },
        runs: {
          ...base.bioinformatics.runs,
          records: [createRunRecord({ bioinformatics_run_name: "r1" })],
        },
      },
    };
    const { merge } = buildDraft(draft, testContext({ alleles, panel1: PANEL_1 }));
    expect(merge.notices).toEqual([
      expect.objectContaining({
        code: "merge/incomplete-name-fields",
        sections: ["microhaplotypes", "bioinformatics"],
      }),
    ]);
  });

  it("blocks the merge while a section has errors, and leaves out unfinished optional sections", () => {
    const alleles = rawTable([{ sample: "S1", target: "t1", seq: "ACGT", reads: "5" }]);
    const base = smallDraft({ alleles });
    const unfinished: Draft = {
      ...base,
      project: { ...base.project, records: [createProjectRecord({ project_name: "P" })] },
    };
    const left = buildDraft(unfinished, testContext({ alleles, panel1: PANEL_1 }));
    expect(left.merge.status).toBe("ready");
    expect(left.merge.notices).toEqual([
      expect.objectContaining({ code: "draft/section-left-out", sections: ["project"] }),
    ]);

    const broken: Draft = {
      ...base,
      project: {
        ...base.project,
        records: [createProjectRecord({ project_name: "bad*name", project_description: "d" })],
      },
    };
    const blocked = buildDraft(broken, testContext({ alleles, panel1: PANEL_1 }));
    expect(blocked.merge.status).toBe("error");
    expect(blocked.merge.outcome.kind).toBe("not-built");
    expect(blocked.merge.notices).toEqual([
      expect.objectContaining({ code: "draft/section-errors", sections: ["project"] }),
    ]);
  });

  it("reports schema problems with the record they are in", () => {
    const alleles = rawTable([{ sample: "S1", target: "t1", seq: "ACGT", reads: "5" }]);
    const samples = rawTable([{ library: "S1", specimen: "S1", panel: "P1", lat: "north" }]);
    const base = smallDraft({ alleles, samples });
    const draft: Draft = {
      ...base,
      specimens: {
        table: mappedTable(
          "specimens",
          rawTable([{ specimen: "S1", latlon: "far away" }]),
          mapping({ specimenName: "specimen", latLon: "latlon" }),
        ),
      },
    };
    const { merge } = buildDraft(
      draft,
      testContext({
        alleles,
        samples,
        panel1: PANEL_1,
        specimens: rawTable([{ specimen: "S1", latlon: "far away" }]),
      }),
    );
    expect(merge.status).toBe("error");
    expect(merge.notices).toEqual([
      expect.objectContaining({
        code: "schema/pattern",
        sections: ["specimens"],
        message: expect.stringContaining('Specimen "S1", field "lat_lon" is "far away"'),
        path: "/specimen_info/0/lat_lon",
      }),
    ]);
  });

  it("makes one notice for each bad cell, listing every rule it breaks", () => {
    const alleles = rawTable([
      { sample: "S1", target: "t1", seq: "ACGT", reads: "5" },
      { sample: "S2", target: "t1", seq: "ACGT", reads: "5" },
    ]);
    const samples = rawTable([
      { library: "S1", specimen: "S1", panel: "P1" },
      { library: "S2", specimen: "S2", panel: "P1" },
    ]);
    const specimens = rawTable([
      { specimen: "S1", host: "human", latlon: "far away" },
      { specimen: "S2", host: "human", latlon: "also far" },
    ]);
    const base = smallDraft({ alleles, samples });
    const draft: Draft = {
      ...base,
      specimens: {
        table: mappedTable(
          "specimens",
          specimens,
          mapping({ specimenName: "specimen", latLon: "latlon" }),
        ),
      },
    };
    const context = testContext({ alleles, samples, panel1: PANEL_1, specimens });
    // The specimen builder now refuses text in a taxon ID column, so put the
    // text straight into the built specimens to reach the format check.
    const built = buildAllSections(draft, context);
    const sections: SectionResults = {
      ...built,
      specimens: {
        ...built.specimens,
        // oxlint-disable-next-line oxc/no-map-spread -- builds fresh fixtures; nothing to mutate in place
        fragment: (built.specimens.fragment ?? []).map((specimen) => ({
          ...specimen,
          host_taxon_id: "human",
        })),
      },
    };
    const merge = mergeSections(sections);
    const schema = merge.notices.filter((notice) => notice.code.startsWith("schema/"));
    // Four cells, and the host taxon ID cells each break two rules.
    expect(schema.map((notice) => notice.path)).toEqual([
      "/specimen_info/0/host_taxon_id",
      "/specimen_info/0/lat_lon",
      "/specimen_info/1/host_taxon_id",
      "/specimen_info/1/lat_lon",
    ]);
    expect(schema[0]).toEqual(
      expect.objectContaining({
        code: "schema/type",
        sections: ["specimens"],
        message:
          'Specimen "S1", field "host_taxon_id" is "human". It should be integer or null, and it has characters the PMO format does not allow there.',
      }),
    );
    expect(merge.outcome.kind === "built" && merge.outcome.schemaErrors).toBe(4);

    const capped = mergeSections(sections, { maxSchemaNotices: 1 });
    expect(capped.notices.filter((notice) => notice.code.startsWith("schema/"))).toEqual([
      expect.objectContaining({ path: "/specimen_info/0/host_taxon_id" }),
      expect.objectContaining({
        code: "schema/more",
        message: "3 more problems with the PMO format are not listed.",
      }),
    ]);
  });
});

describe("wording the library's own messages", () => {
  it("puts a schema path into words: the part of the PMO and the field", () => {
    expect(pathInWords(["collection_country"])).toBe('field "collection_country"');
    expect(pathInWords(["targets", 0, "microhaplotypes", 2, "seq"])).toBe(
      'target 1, microhaplotype 3, field "seq"',
    );
  });

  it("leads with where the problem is and what to try, the library's text after", () => {
    expect(withLibraryDetail("Check the panel.", "  bad thing ")).toBe(
      "Check the panel. Details: bad thing",
    );
    const notice = errorNotice(new PmoError("mhap/brand-new", "Raw library text."), {
      tableLabel: "allele table",
      tableId: "t1",
      fieldSet: getFieldSet("microhaplotypes"),
      columns: {},
      typed: null,
      raw: null,
    });
    expect(notice.message).toMatch(
      /^The allele table could not be turned into its part of the PMO\. Check the column mapping.* Details: Raw library text\.$/,
    );
  });

  it("says a damaged saved panel cannot be used and how to replace it", () => {
    const draft = createEmptyDraft();
    const panel = draft.panel.panels[0];
    if (panel === undefined) throw new Error("no panel");
    const result = buildDraft(
      {
        ...draft,
        panel: {
          panels: [
            {
              ...panel,
              source: "saved",
              saved: { savedPanelId: "s", name: "Old", savedAt: "", fragment: { nope: 1 } },
            },
          ],
        },
      },
      testContext({}),
    );
    expect(result.sections.panel.notices[0]?.message).toMatch(
      /The saved panel "Old" is damaged .* import the panel's target table again.* Details: /,
    );
  });
});
