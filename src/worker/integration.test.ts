/**
 * The MAD4HATTER example through the real import, fields and matching
 * modules: files parsed by `parseFile`, columns matched by `suggestMapping`,
 * tables typed by `typeTable`. The other engine tests use stand-ins.
 */
import { describe, expect, it } from "vitest";

import {
  LIBRARY_SAMPLE_COLUMN_OPTIONS,
  MHAP_COLUMN_OPTIONS,
  PANEL_COLUMN_OPTIONS,
  READ_COUNT_STAGE_OPTIONS,
  READ_COUNT_TOTAL_OPTIONS,
  SPECIMEN_COLUMN_OPTIONS,
} from "@/domain/build";
import { exampleBlob } from "@/domain/build/testing";
import {
  GENOME_FORM_FIELDS,
  METHOD_STEP_FORM_FIELDS,
  PROJECT_FORM_FIELDS,
  RUN_FORM_FIELDS,
  SEQUENCING_FORM_FIELDS,
  createEmptyDraft,
  createPanelEntry,
  fieldSetForSlot,
  type Draft,
  type MappedTable,
  type TableSlot,
} from "@/domain/draft";
import { getFieldSet } from "@/domain/fields";
import { suggestMapping } from "@/domain/matching";
import { FIELD_SET_IDS, type FieldSetId } from "@/domain/types";

import { createInThreadEngine, type Engine } from "./engine";

/** Imports an example file and maps it with the plain suggested mapping, as the app does. */
async function importInto(engine: Engine, slot: TableSlot, name: string): Promise<MappedTable> {
  const outcome = await engine.importFile({ file: exampleBlob(name), fileName: name });
  if (outcome.kind !== "imported") throw new Error(outcome.notice.message);
  const { mapping } = suggestMapping(getFieldSet(fieldSetForSlot(slot)), outcome.table.columns);
  return { table: outcome.table, mapping };
}

describe("the example with the real import, fields and matching modules", () => {
  it("builds a valid PMO from suggested mappings", async () => {
    const engine = createInThreadEngine();
    const empty = createEmptyDraft();
    const panel = createPanelEntry("Mad4hatter");
    const draft: Draft = {
      ...empty,
      microhaplotypes: {
        ...empty.microhaplotypes,
        table: await importInto(
          engine,
          { section: "microhaplotypes" },
          "mad4hatter_allele_data_example.csv",
        ),
      },
      panel: {
        panels: [
          {
            ...panel,
            table: await importInto(
              engine,
              { section: "panel", panelId: panel.id, part: "targets" },
              "mad4hatter_panel_info_example.csv",
            ),
          },
        ],
      },
      specimens: {
        table: await importInto(
          engine,
          { section: "specimens" },
          "mad4hatter_metadata_example.tsv",
        ),
      },
      librarySamples: {
        table: await importInto(
          engine,
          { section: "librarySamples" },
          "mad4hatter_metadata_example.tsv",
        ),
      },
      readCounts: {
        ...empty.readCounts,
        totals: await importInto(
          engine,
          { section: "readCounts", part: "totals" },
          "example_raw_reads.txt",
        ),
        byStage: await importInto(
          engine,
          { section: "readCounts", part: "byStage" },
          "reads_per_stage.txt",
        ),
      },
    };
    const outcome = await engine.build(draft, { creationDate: "2026-01-01" });
    if (outcome.kind !== "built") throw new Error("superseded");
    const { sections, overall } = outcome.view;
    const problems = Object.entries(sections).flatMap(([id, section]) =>
      section.notices.map((notice) => `${id}: ${notice.code}: ${notice.message}`),
    );
    expect(problems).toEqual([]);
    // No project or sequencing run is entered, so the names the metadata gives link to nothing.
    expect(overall.notices.map((notice) => notice.code)).toEqual([
      "draft/unlinked-project-names",
      "draft/unlinked-sequencing-names",
    ]);
    expect(overall).toMatchObject({ status: "ready", pmo: "valid" });
    expect(overall.summary).toEqual({
      specimens: 50,
      librarySamples: 50,
      librarySamplesWithDetections: 49,
      panels: 1,
      targets: 276,
      targetsWithCalls: 21,
      genomes: 0,
      sequencingRuns: 0,
      projects: 0,
      bioinformaticsRuns: 0,
      librarySamplesWithReadCounts: 3,
    });
  });
});

describe("field keys and builder options", () => {
  const builderOptions: Readonly<Partial<Record<FieldSetId, readonly string[]>>> = {
    microhaplotypes: MHAP_COLUMN_OPTIONS,
    panelTargets: PANEL_COLUMN_OPTIONS,
    specimens: SPECIMEN_COLUMN_OPTIONS,
    librarySamples: LIBRARY_SAMPLE_COLUMN_OPTIONS,
    readCountTotals: READ_COUNT_TOTAL_OPTIONS,
    readCountsByStage: [...READ_COUNT_STAGE_OPTIONS, "librarySampleNameCol"],
  };
  const formFields: Readonly<Partial<Record<FieldSetId, readonly { readonly key: string }[]>>> = {
    genomes: GENOME_FORM_FIELDS,
    project: PROJECT_FORM_FIELDS,
    sequencing: SEQUENCING_FORM_FIELDS,
    bioinformaticsMethods: METHOD_STEP_FORM_FIELDS,
    bioinformaticsRuns: RUN_FORM_FIELDS,
  };

  it.each(FIELD_SET_IDS)("every %s field is used by the build", (id) => {
    const keys = getFieldSet(id).fields.map((field) => field.key);
    const options = builderOptions[id];
    const known =
      options === undefined
        ? (formFields[id] ?? []).map((field) => field.key)
        : options.map((o) => o.replace(/Col$/, ""));
    expect(keys.filter((key) => !known.includes(key))).toEqual([]);
  });
});
