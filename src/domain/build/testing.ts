/**
 * Test helpers for the build pipeline and the engine. Not used by the app.
 *
 * They stand in for the import, fields and matching modules so the build
 * tests do not depend on how those are implemented: tables are read with a
 * plain tab splitter, field sets list only what the tests map, and
 * `typeTable` and `checkMapping` do the simplest correct thing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { inferColumnTypes, type PortableMicrohaplotypeObject } from "pmotools-ts";

import {
  createEmptyDraft,
  createPanelEntry,
  METHOD_STEP_FORM_FIELDS,
  PROJECT_FORM_FIELDS,
  RUN_FORM_FIELDS,
  SEQUENCING_FORM_FIELDS,
  GENOME_FORM_FIELDS,
  type MappedTable,
} from "@/domain/draft";
import type {
  ParseOptions,
  ParsedFile,
  ColumnMapping,
  FieldKind,
  FieldSetId,
  FieldSetSpec,
  FieldSpec,
  MappingProblem,
  MappingSuggestion,
  RawRow,
  RawTable,
} from "@/domain/types";

import { createBuildContext, type BuildContext, type BuildDeps } from "./context";
import { buildDraft } from "./merge";

/** Tests run from the repository root. */
const EXAMPLES = join(process.cwd(), "public/examples/");

/** Reads a tab-separated text into a raw table. Blank cells become `null`. */
export function parseTsv(text: string): RawTable {
  const lines = text.split(/\r?\n/).filter((line) => line !== "");
  const columns = (lines[0] ?? "").split("\t");
  const rows = lines.slice(1).map((line): RawRow => {
    const cells = line.split("\t");
    const row: Record<string, string | null> = {};
    columns.forEach((column, index) => {
      const cell = cells[index] ?? "";
      row[column] = cell === "" ? null : cell;
    });
    return row;
  });
  return { columns, rows };
}

/** Reads one of the example files in `public/examples` (all are tab-separated). */
export function readExample(name: string): RawTable {
  return parseTsv(readFileSync(`${EXAMPLES}${name}`, "utf8"));
}

/** The bytes of an example file, as a Blob. */
export function exampleBlob(name: string): Blob {
  return new Blob([readFileSync(`${EXAMPLES}${name}`)]);
}

/** A raw table from rows of text. Column order is taken from the first row. */
export function rawTable(rows: readonly Readonly<Record<string, string | null>>[]): RawTable {
  return { columns: Object.keys(rows[0] ?? {}), rows };
}

function field(key: string, kind: FieldKind, required = false): FieldSpec {
  return { key, label: key, description: "", required, kind, aliases: [] };
}

const T = "text";
const I = "integer";

function fromForm(
  spec: readonly { readonly key: string; readonly required: boolean; readonly kind: string }[],
): FieldSpec[] {
  return spec.map((f) =>
    field(f.key, f.kind === "date" ? "date" : f.kind === "list" ? "list" : "text", f.required),
  );
}

/** Field sets with just the fields the tests use, and the kinds the real ones give them. */
export const TEST_FIELD_SETS: Readonly<Record<FieldSetId, readonly FieldSpec[]>> = {
  microhaplotypes: [
    field("librarySampleName", T, true),
    field("targetName", T, true),
    field("seq", T, true),
    field("reads", I, true),
    field("umis", I),
    field("chrom", T),
    field("start", I),
    field("end", I),
    field("microhaplotypeName", T),
    field("pseudocigar", T),
    field("quality", T),
  ],
  panelTargets: [
    field("targetName", T, true),
    field("forwardPrimersSeq", T, true),
    field("reversePrimersSeq", T, true),
    field("reactionName", T),
    field("insertStart", I),
    field("insertEnd", I),
    field("chrom", T),
    field("geneName", T),
  ],
  genomes: fromForm(GENOME_FORM_FIELDS),
  specimens: [
    field("specimenName", T, true),
    field("collectionDate", "date"),
    field("collectionCountry", T),
    field("projectName", T),
    field("specimenTaxonId", I),
    field("hostTaxonId", I),
    field("latLon", T),
    field("geoAdmin3", T),
    field("specimenCollectDevice", T),
    field("specimenStoreLoc", T),
    field("storagePlateName", T),
    field("storagePlateRow", T),
    field("storagePlateCol", I),
  ],
  librarySamples: [
    field("librarySampleName", T, true),
    field("specimenName", T, true),
    field("panelName", T, true),
    field("sequencingInfoName", T),
  ],
  project: fromForm(PROJECT_FORM_FIELDS),
  sequencing: fromForm(SEQUENCING_FORM_FIELDS),
  bioinformaticsMethods: fromForm(METHOD_STEP_FORM_FIELDS),
  bioinformaticsRuns: fromForm(RUN_FORM_FIELDS),
  readCountTotals: [field("librarySampleName", T, true), field("totalRawCount", I, true)],
  readCountsByStage: [
    field("librarySampleName", T, true),
    field("targetName", T, true),
    field("stage", T, true),
    field("readCount", I, true),
  ],
};

/** Looks up a test field set. */
export function testFieldSet(id: FieldSetId): FieldSetSpec {
  return {
    id,
    title: id,
    fields: TEST_FIELD_SETS[id],
    allowsAdditionalColumns: true,
    dependencies: [],
  };
}

/** The simplest correct mapping check: required fields mapped, columns present and used once. */
export function testCheckMapping(
  fieldSet: FieldSetSpec,
  columns: readonly string[],
  columnMapping: ColumnMapping,
): readonly MappingProblem[] {
  const problems: MappingProblem[] = [];
  const used = new Map<string, string[]>();
  for (const spec of fieldSet.fields) {
    const column = columnMapping.fields[spec.key] ?? null;
    if (column === null) {
      if (spec.required) problems.push({ kind: "missing-required", fieldKey: spec.key });
      continue;
    }
    if (!columns.includes(column))
      problems.push({ kind: "unknown-column", fieldKey: spec.key, column });
    used.set(column, [...(used.get(column) ?? []), spec.key]);
  }
  for (const [column, fieldKeys] of used) {
    if (fieldKeys.length > 1) problems.push({ kind: "duplicate-column", column, fieldKeys });
  }
  for (const column of columnMapping.additionalColumns) {
    if (!columns.includes(column)) problems.push({ kind: "unknown-additional-column", column });
  }
  return problems;
}

/** Build dependencies that do not touch the import, fields or matching modules. */
export const TEST_DEPS: BuildDeps = {
  getFieldSet: testFieldSet,
  checkMapping: testCheckMapping,
  typeTable: (table, options) => inferColumnTypes(table.rows, { textColumns: options.textColumns }),
};

/** A column mapping from field key to column. */
export function mapping(
  fields: Readonly<Record<string, string | null>>,
  additionalColumns: readonly string[] = [],
): ColumnMapping {
  return { fields, additionalColumns };
}

/** A mapped table referring to `id`, with metadata taken from the raw table. */
export function mappedTable(
  id: string,
  raw: RawTable,
  map: ColumnMapping,
  fileName = `${id}.tsv`,
): MappedTable {
  return {
    table: {
      id,
      fileName,
      fileSize: 0,
      format: "delimited",
      sheetNames: null,
      sheetName: null,
      columns: raw.columns,
      rowCount: raw.rows.length,
    },
    mapping: map,
  };
}

/** A build context over the given tables, with the test dependencies. */
export function testContext(tables: Readonly<Record<string, RawTable>>): BuildContext {
  return createBuildContext(new Map(Object.entries(tables)), TEST_DEPS);
}

/** Mappings for the MAD4HATTER example tables. */
export const EXAMPLE_MAPPINGS = {
  alleles: mapping({
    librarySampleName: "SampleID",
    targetName: "Locus",
    seq: "ASV",
    reads: "Reads",
  }),
  panel: mapping({
    targetName: "amplicon",
    forwardPrimersSeq: "fwd_primer",
    reversePrimersSeq: "rev_primer",
  }),
  specimens: mapping({
    specimenName: "specimen_id",
    collectionDate: "collection_date",
    collectionCountry: "collection_country",
    projectName: "project_name",
    specimenTaxonId: "samp_taxon_id",
    hostTaxonId: "host_taxon_id",
    latLon: "lat_lon",
    geoAdmin3: "geo_admin3",
    specimenCollectDevice: "samp_collect_device",
    specimenStoreLoc: "samp_store_loc",
    storagePlateName: "plate_name",
    storagePlateRow: "plate_row",
    storagePlateCol: "plate_col",
  }),
  librarySamples: mapping({
    librarySampleName: "experiment_sample_id",
    specimenName: "specimen_id",
    panelName: "panel_id",
    sequencingInfoName: "sequencing_info_id",
  }),
  totals: mapping({ librarySampleName: "sample", totalRawCount: "raw_count" }),
  byStage: mapping({
    librarySampleName: "sample",
    targetName: "target",
    stage: "stage",
    readCount: "reads",
  }),
} as const;

/**
 * Reads tab-separated text. A file named `.xlsx` holds JSON mapping sheet
 * names to tab-separated text, so sheet choice can be tested. Text starting
 * with "broken" fails to parse.
 */
export async function fakeParseFile(
  source: Blob,
  fileName: string,
  options?: ParseOptions,
): Promise<ParsedFile> {
  const text = await source.text();
  if (text.startsWith("broken")) throw new Error("This file is not a table.");
  if (fileName.endsWith(".xlsx")) {
    const sheets: unknown = JSON.parse(text);
    if (typeof sheets !== "object" || sheets === null) throw new Error("bad workbook");
    const sheetNames = Object.keys(sheets);
    const sheetName = options?.sheetName ?? sheetNames[0] ?? "";
    const sheet: unknown = Object.getOwnPropertyDescriptor(sheets, sheetName)?.value;
    if (typeof sheet !== "string") throw new Error(`No sheet ${sheetName}`);
    return { format: "xlsx", delimiter: null, sheetNames, sheetName, table: parseTsv(sheet) };
  }
  return {
    format: "delimited",
    delimiter: "\t",
    sheetNames: null,
    sheetName: null,
    table: parseTsv(text),
  };
}

/** Suggests the example mappings by field set, as the real matcher would for the example files. */
export function exampleSuggestMapping(fieldSet: FieldSetSpec): MappingSuggestion {
  const byFieldSet: Partial<Record<FieldSetId, ColumnMapping>> = {
    microhaplotypes: EXAMPLE_MAPPINGS.alleles,
    panelTargets: EXAMPLE_MAPPINGS.panel,
    specimens: EXAMPLE_MAPPINGS.specimens,
    librarySamples: EXAMPLE_MAPPINGS.librarySamples,
    readCountTotals: EXAMPLE_MAPPINGS.totals,
    readCountsByStage: EXAMPLE_MAPPINGS.byStage,
  };
  return { mapping: byFieldSet[fieldSet.id] ?? { fields: {}, additionalColumns: [] }, matches: {} };
}

const EXAMPLE_PMO_TABLES = {
  alleles: readExample("mad4hatter_allele_data_example.csv"),
  panel: readExample("mad4hatter_panel_info_example.csv"),
  metadata: readExample("mad4hatter_metadata_example.tsv"),
};

/** A valid PMO built from the example tables, as a deposit would hold. */
export function buildExamplePmo(): PortableMicrohaplotypeObject {
  const empty = createEmptyDraft();
  const { merge } = buildDraft(
    {
      ...empty,
      microhaplotypes: {
        table: mappedTable("alleles", EXAMPLE_PMO_TABLES.alleles, EXAMPLE_MAPPINGS.alleles),
        runName: { mode: "fixed", fixedName: "run1", column: null },
        representativeColumns: [],
      },
      panel: {
        panels: [
          {
            ...createPanelEntry("Mad4hatter"),
            table: mappedTable("panel", EXAMPLE_PMO_TABLES.panel, EXAMPLE_MAPPINGS.panel),
          },
        ],
      },
      specimens: {
        table: mappedTable("metadata", EXAMPLE_PMO_TABLES.metadata, EXAMPLE_MAPPINGS.specimens),
      },
      librarySamples: {
        table: mappedTable(
          "metadata",
          EXAMPLE_PMO_TABLES.metadata,
          EXAMPLE_MAPPINGS.librarySamples,
        ),
      },
    },
    testContext(EXAMPLE_PMO_TABLES),
    { creationDate: "2026-01-01" },
  );
  if (merge.outcome.kind !== "built") throw new Error("the example did not build");
  return merge.outcome.pmo;
}
