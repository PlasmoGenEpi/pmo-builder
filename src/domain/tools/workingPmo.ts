/**
 * Working with a PMO the user already has: opening it, listing what a subset
 * can keep, making the subset, and writing its tables. The PMO work itself is
 * pmotools-ts's (`filterPmo…`, `extract…`, `export…Table`); this chooses what
 * to call and checks the result.
 */
import {
  checkPmoIntegrity,
  countSpecimenByFieldValue,
  countSpecimenPerMetaFields,
  extractAllelesPerSampleTable,
  extractFromPmoSamplesWithMetaGroupings,
  extractFromPmoWithReadFilter,
  exportBioinformaticsMethodsInfoMetaTable,
  exportBioinformaticsRunInfoMetaTable,
  exportLibrarySampleMetaTable,
  exportPanelInfoMetaTable,
  exportPmoHeaderTable,
  exportProjectInfoMetaTable,
  exportSequencingInfoMetaTable,
  exportSpecimenMetaTable,
  exportSpecimenTravelMetaTable,
  exportTargetedGenomesMetaTable,
  exportTargetInfoMetaTable,
  filterPmoBySpecimenIds,
  filterPmoBySpecimenNames,
  filterPmoByTargetNames,
  formatDelimited,
  PmoError,
  validatePmo,
  type ColumnTable,
  type PortableMicrohaplotypeObject,
  type TableCell,
} from "pmotools-ts";

import { readPmoFile } from "@/domain/build/checkFile";
import { PUBLISHABLE_PMO_VERSION } from "@/domain/build/checkFileResult";
import { exportPmo, type PmoFile } from "@/domain/build/export";
import { summarisePmo } from "@/domain/build/merge";
import { summarisePublication } from "@/domain/build/publication";

import { groupValue } from "./sampleDetails";
import {
  COLLECTION_YEAR_FIELD,
  MAX_META_VALUES,
  TABLE_IDS,
  TABLE_PREVIEW_LIMIT,
  type MetaField,
  type OpenOutcome,
  type PmoChoices,
  type SubsetOutcome,
  type SubsetPreview,
  type SubsetRequest,
  type TableFile,
  type TableFormat,
  type TableId,
  type TableInfo,
  type TablePreview,
  type TablesArchive,
} from "./types";
import { zipFiles } from "./zip";

type Pmo = PortableMicrohaplotypeObject;

/** Fields never offered for choosing specimens: names, and free text or lists. */
const NOT_CHOSEN_BY = new Set([
  "specimen_name",
  "host_subject_name",
  "alternate_identifiers",
  "specimen_comments",
  "lat_lon",
  "specimen_accession",
]);

function isPrimitive(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

/** Derived collection year field, when between 2 and {@link MAX_META_VALUES} years exist. */
function collectionYearField(pmo: Pmo): MetaField | null {
  const counts = new Map<string, number>();
  pmo.specimen_info.forEach((_, index) => {
    const year = groupValue(pmo, index, "collection_year");
    if (year !== null) counts.set(year, (counts.get(year) ?? 0) + 1);
  });
  if (counts.size < 2 || counts.size > MAX_META_VALUES) return null;
  const values = [...counts.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([value, count]) => ({ value, label: value, count }));
  return { field: COLLECTION_YEAR_FIELD, values };
}

/** The metadata fields specimens can be chosen by, with their values. */
function metadataChoices(pmo: Pmo): MetaField[] {
  const projects = pmo.project_info ?? [];
  const fields = countSpecimenPerMetaFields(pmo).rows.flatMap((row) =>
    typeof row[0] === "string" ? [row[0]] : [],
  );
  const raw = fields.flatMap((field): MetaField[] => {
    if (NOT_CHOSEN_BY.has(field)) return [];
    const simple = pmo.specimen_info.every((specimen) => {
      const record: Readonly<Record<string, unknown>> = specimen;
      return !(field in record) || isPrimitive(record[field]);
    });
    if (!simple) return [];
    const counts = countSpecimenByFieldValue(pmo, [field]).rows.flatMap((row) => {
      const [value, count] = row;
      return typeof value === "string" && typeof count === "number" && value !== "NA"
        ? [{ value, count }]
        : [];
    });
    if (counts.length < 2 || counts.length > MAX_META_VALUES) return [];
    return [
      {
        field,
        values: counts.map(({ value, count }) => ({
          value,
          count,
          label: field === "project_id" ? (projects[Number(value)]?.project_name ?? value) : value,
        })),
      },
    ];
  });
  if (fields.includes(COLLECTION_YEAR_FIELD)) return raw;
  const years = collectionYearField(pmo);
  if (years === null) return raw;
  const dateIndex = raw.findIndex((item) => item.field === "collection_date");
  return dateIndex === -1
    ? [...raw, years]
    : [...raw.slice(0, dateIndex), years, ...raw.slice(dateIndex)];
}

/** A primitive written as Python's `str()` writes it, as the metadata filter compares. */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (value === null || value === undefined) return "None";
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

/** What a subset of `pmo` can keep. */
export function choicesOf(pmo: Pmo): PmoChoices {
  const metadata = metadataChoices(pmo);
  const librariesPerSpecimen = new Map<number, number>();
  for (const library of pmo.library_sample_info) {
    librariesPerSpecimen.set(
      library.specimen_id,
      (librariesPerSpecimen.get(library.specimen_id) ?? 0) + 1,
    );
  }
  const detected = new Set(
    pmo.representative_microhaplotypes.targets.map((target) => target.target_id),
  );
  let maxReads = 0;
  for (const run of pmo.detected_microhaplotypes) {
    for (const sample of run.library_samples) {
      for (const result of sample.target_results) {
        for (const mhap of result.mhaps) maxReads = Math.max(maxReads, mhap.reads);
      }
    }
  }
  return {
    specimens: pmo.specimen_info.map((specimen, index) => {
      const record: Readonly<Record<string, unknown>> = specimen;
      return {
        name: specimen.specimen_name,
        librarySamples: librariesPerSpecimen.get(index) ?? 0,
        values: Object.fromEntries(
          metadata.flatMap(({ field }): readonly [string, string][] => {
            if (field === COLLECTION_YEAR_FIELD && !(field in record)) {
              const year = groupValue(pmo, index, "collection_year");
              return year === null ? [] : [[field, year]];
            }
            return field in record ? [[field, asText(record[field])]] : [];
          }),
        ),
      };
    }),
    metadata,
    targets: pmo.target_info.flatMap((target, index) =>
      detected.has(index) ? [target.target_name] : [],
    ),
    targetsWithoutData: pmo.target_info.filter((_, index) => !detected.has(index)).length,
    maxReads,
  };
}

function alleleCount(pmo: Pmo): number {
  let count = 0;
  for (const run of pmo.detected_microhaplotypes) {
    for (const sample of run.library_samples) {
      for (const result of sample.target_results) count += result.mhaps.length;
    }
  }
  return count;
}

function readCountsRowCount(pmo: Pmo): number {
  let count = 0;
  for (const run of pmo.read_counts_by_stage ?? []) {
    for (const sample of run.read_counts_by_library_sample_by_stage) {
      const stageRows = (sample.read_counts_for_targets ?? []).reduce(
        (sum, target) => sum + target.stages.length,
        0,
      );
      count += stageRows > 0 ? stageRows : 1;
    }
  }
  return count;
}

const READ_COUNTS_BUILTIN_KEYS = new Set([
  "library_sample_id",
  "total_raw_count",
  "read_counts_for_targets",
  "target_id",
  "stages",
  "stage",
  "reads",
  "library_sample_name",
  "bioinformatics_run_name",
  "target_name",
]);

function extraCell(value: unknown): TableCell | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean" ||
        item === null,
    )
  ) {
    return value.map((item) => (item === null ? "" : String(item))).join(",");
  }
  return undefined;
}

function addExtraCells(
  record: Readonly<Record<string, unknown>>,
  row: Map<string, TableCell>,
  extraKeys: Set<string>,
): void {
  for (const [key, value] of Object.entries(record)) {
    if (READ_COUNTS_BUILTIN_KEYS.has(key)) continue;
    const cell = extraCell(value);
    if (cell !== undefined) {
      row.set(key, cell);
      extraKeys.add(key);
    }
  }
}

function readCountsTable(pmo: Pmo): ColumnTable {
  const runs = pmo.read_counts_by_stage ?? [];
  const hasRunName = runs.some(
    (run) =>
      run.read_counts_by_library_sample_by_stage.length > 0 &&
      run.bioinformatics_run_id !== null &&
      run.bioinformatics_run_id !== undefined,
  );
  let hasTargetStages = false;
  const extraKeys = new Set<string>();
  const records: Map<string, TableCell>[] = [];

  for (const run of runs) {
    const runId = run.bioinformatics_run_id;
    const runName =
      runId !== null && runId !== undefined
        ? (pmo.bioinformatics_run_info?.[runId]?.bioinformatics_run_name ?? String(runId))
        : null;
    for (const sample of run.read_counts_by_library_sample_by_stage) {
      const sampleName =
        pmo.library_sample_info[sample.library_sample_id]?.library_sample_name ??
        String(sample.library_sample_id);
      const base = new Map<string, TableCell>([["library_sample_name", sampleName]]);
      if (hasRunName) base.set("bioinformatics_run_name", runName);
      base.set("total_raw_count", sample.total_raw_count);
      addExtraCells(sample, base, extraKeys);

      let emittedForSample = false;
      for (const target of sample.read_counts_for_targets ?? []) {
        if (target.stages.length === 0) continue;
        const targetName =
          pmo.target_info[target.target_id]?.target_name ?? String(target.target_id);
        for (const stage of target.stages) {
          const row = new Map(base);
          row.set("target_name", targetName);
          row.set("stage", stage.stage);
          row.set("reads", stage.reads);
          addExtraCells(target, row, extraKeys);
          addExtraCells(stage, row, extraKeys);
          records.push(row);
          emittedForSample = true;
          hasTargetStages = true;
        }
      }
      if (!emittedForSample) records.push(base);
    }
  }

  if (records.length === 0) return { columns: [], rows: [] };

  const columns: string[] = ["library_sample_name"];
  if (hasRunName) columns.push("bioinformatics_run_name");
  columns.push("total_raw_count");
  if (hasTargetStages) columns.push("target_name", "stage", "reads");
  columns.push(...[...extraKeys].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

  return {
    columns,
    rows: records.map((record) => columns.map((column) => record.get(column) ?? null)),
  };
}

/** The tables `pmo` can give, with their row counts. Sections it lacks are left out. */
export function tablesOf(pmo: Pmo): TableInfo[] {
  const rows: Record<TableId, number | null> = {
    alleles: alleleCount(pmo),
    specimens: pmo.specimen_info.length,
    librarySamples: pmo.library_sample_info.length,
    targets: pmo.target_info.length,
    panels: pmo.panel_info.length === 0 ? null : exportPanelInfoMetaTable(pmo).rows.length,
    readCounts: readCountsRowCount(pmo),
    travel: pmo.specimen_info.reduce(
      (sum, specimen) => sum + (specimen.travel_out_six_month?.length ?? 0),
      0,
    ),
    projects: pmo.project_info?.length ?? null,
    sequencing: pmo.sequencing_info?.length ?? null,
    bioinformaticsRuns: pmo.bioinformatics_run_info?.length ?? null,
    bioinformaticsMethods:
      pmo.bioinformatics_methods_info?.reduce((sum, info) => sum + info.methods.length, 0) ?? null,
    genomes: pmo.targeted_genomes?.length ?? null,
    header: 1,
  };
  return TABLE_IDS.flatMap((id) => {
    const count = rows[id];
    return count === null || count === 0 ? [] : [{ id, rows: count }];
  });
}

/** What an opened PMO offers. */
function describe(
  pmo: Pmo,
  fileName: string,
  warnings: readonly string[],
): Extract<OpenOutcome, { kind: "opened" }> {
  return {
    kind: "opened",
    fileName,
    summary: summarisePmo(pmo),
    publication: summarisePublication(pmo),
    warnings,
    choices: choicesOf(pmo),
    tables: tablesOf(pmo),
  };
}

/** Opens a PMO file to work with: the checks for publishing, then the choices. */
export async function openPmo(
  file: Blob,
  fileName: string,
): Promise<{ readonly outcome: OpenOutcome; readonly pmo: Pmo | null }> {
  const { check, pmo } = await readPmoFile(file);
  if (check.kind !== "ready" || pmo === null) {
    return {
      outcome: {
        kind: "refused",
        check: check.kind === "ready" ? { kind: "unreadable", reason: "not-pmo" } : check,
      },
      pmo: null,
    };
  }
  return { outcome: describe(pmo, fileName, check.warnings), pmo };
}

/** A file name without `.json`, `.json.gz` or `.gz`, and without a `.pmo` before them. */
export function baseNameOf(fileName: string): string {
  const base = fileName.replace(/(?:\.pmo)?(?:\.json(?:\.gz)?|\.gz)$/i, "");
  return base === "" ? "pmo" : base;
}

/** Applies `request` to `pmo`: specimens, then targets, then reads. Throws what pmotools-ts throws. */
export function subsetOf(pmo: Pmo, request: SubsetRequest): Pmo {
  let out = pmo;
  if (request.specimens.kind === "names") {
    out = filterPmoBySpecimenNames(out, request.specimens.names);
  } else if (request.specimens.kind === "metadata") {
    if (Object.keys(request.specimens.criteria).length > 0) {
      out = extractFromPmoSamplesWithMetaGroupings(out, [
        { criteria: request.specimens.criteria },
      ]).pmo;
    }
    const years = request.specimens.collectionYears;
    if (years !== undefined && years.length > 0) {
      const wanted = new Set(years);
      const ids = out.specimen_info.flatMap((_, index) => {
        const year = groupValue(out, index, "collection_year");
        return year !== null && wanted.has(year) ? [index] : [];
      });
      out = filterPmoBySpecimenIds(out, ids);
    }
  }
  if (request.targets.kind === "names") out = filterPmoByTargetNames(out, request.targets.names);
  if (request.minReads > 0) out = extractFromPmoWithReadFilter(out, request.minReads);
  return out;
}

/** The indexes of the specimens `choice` names or matches, or `null` for all. */
function chosenSpecimens(pmo: Pmo, choice: SubsetRequest["specimens"]): Set<number> | null {
  if (choice.kind === "all") return null;
  const chosen = new Set<number>();
  if (choice.kind === "names") {
    const names = new Set(choice.names);
    pmo.specimen_info.forEach((specimen, index) => {
      if (names.has(specimen.specimen_name)) chosen.add(index);
    });
    return chosen;
  }
  const criteria = Object.entries(choice.criteria);
  const years =
    choice.collectionYears !== undefined && choice.collectionYears.length > 0
      ? new Set(choice.collectionYears)
      : null;
  if (criteria.length === 0 && years === null) return null;
  pmo.specimen_info.forEach((specimen, index) => {
    const record: Readonly<Record<string, unknown>> = specimen;
    const matchesCriteria = criteria.every(
      ([field, values]) => field in record && values.includes(asText(record[field])),
    );
    if (!matchesCriteria) return;
    if (years !== null) {
      const year = groupValue(pmo, index, "collection_year");
      if (year === null || !years.has(year)) return;
    }
    chosen.add(index);
  });
  return chosen;
}

/**
 * What {@link subsetOf} would keep, counted in one pass without copying
 * anything, for a preview while the user chooses.
 */
export function previewSubset(pmo: Pmo, request: SubsetRequest): SubsetPreview {
  const chosen = chosenSpecimens(pmo, request.specimens);
  const libraries = new Set<number>();
  const specimens = new Set<number>();
  pmo.library_sample_info.forEach((library, index) => {
    if (chosen !== null && !chosen.has(library.specimen_id)) return;
    libraries.add(index);
    specimens.add(library.specimen_id);
  });
  const targetNames = request.targets.kind === "names" ? new Set(request.targets.names) : null;
  const representative = pmo.representative_microhaplotypes.targets;
  const withData = new Set<number>();
  const called = new Set<number>();
  for (const run of pmo.detected_microhaplotypes) {
    for (const sample of run.library_samples) {
      if (!libraries.has(sample.library_sample_id)) continue;
      for (const result of sample.target_results) {
        const target = representative[result.mhaps_target_id];
        if (target === undefined) continue;
        const name = pmo.target_info[target.target_id]?.target_name;
        if (targetNames !== null && (name === undefined || !targetNames.has(name))) continue;
        if (request.minReads > 0 && !result.mhaps.some((mhap) => mhap.reads >= request.minReads))
          continue;
        withData.add(sample.library_sample_id);
        called.add(target.target_id);
      }
    }
  }
  return {
    // Choosing no specimens keeps every one, those without library samples too.
    specimens: chosen === null ? pmo.specimen_info.length : specimens.size,
    librarySamples: libraries.size,
    librarySamplesWithData: withData.size,
    targetsWithCalls: called.size,
  };
}

/** Checks a subset: the PMO schema, and that its tables link up. Returns the problems found. */
function problemsOf(pmo: Pmo): string[] {
  const validation = validatePmo(pmo, { schemaVersion: PUBLISHABLE_PMO_VERSION });
  if (!validation.valid) return validation.errors.slice(0, 5).map((error) => error.message);
  return checkPmoIntegrity(validation.pmo)
    .filter((issue) => issue.severity === "error")
    .slice(0, 5)
    .map((issue) => issue.message);
}

/** Makes a subset of `pmo` and describes it. */
export function makeSubset(
  pmo: Pmo,
  request: SubsetRequest,
  fileName: string,
): { readonly outcome: SubsetOutcome; readonly subset: Pmo | null } {
  let subset: Pmo;
  try {
    subset = subsetOf(pmo, request);
  } catch (error) {
    if (error instanceof PmoError) {
      return { outcome: { kind: "failed", message: error.message }, subset: null };
    }
    throw error;
  }
  const withData = subset.detected_microhaplotypes.some((run) => run.library_samples.length > 0);
  if (subset.library_sample_info.length === 0 || !withData) {
    return { outcome: { kind: "empty" }, subset: null };
  }
  return {
    outcome: {
      kind: "made",
      fileName: `${baseNameOf(fileName)}-subset.json.gz`,
      summary: summarisePmo(subset),
      publication: summarisePublication(subset),
      tables: tablesOf(subset),
      problems: problemsOf(subset),
    },
    subset,
  };
}

const FILE_PARTS: Readonly<Record<TableId, string>> = {
  alleles: "alleles",
  specimens: "specimens",
  librarySamples: "library-samples",
  targets: "targets",
  panels: "panels",
  readCounts: "read-counts",
  travel: "travel",
  projects: "projects",
  sequencing: "sequencing",
  bioinformaticsRuns: "bioinformatics-runs",
  bioinformaticsMethods: "bioinformatics-methods",
  genomes: "genomes",
  header: "header",
};

function tableOf(pmo: Pmo, id: TableId): ColumnTable {
  switch (id) {
    case "alleles": {
      const hasUmis = pmo.detected_microhaplotypes.some((run) =>
        run.library_samples.some((sample) =>
          sample.target_results.some((result) => result.mhaps.some((mhap) => "umis" in mhap)),
        ),
      );
      return extractAllelesPerSampleTable(pmo, {
        additionalMicrohapFields: hasUmis ? ["reads", "umis"] : ["reads"],
      });
    }
    case "specimens":
      return exportSpecimenMetaTable(pmo);
    case "librarySamples":
      return exportLibrarySampleMetaTable(pmo);
    case "targets":
      return exportTargetInfoMetaTable(pmo);
    case "panels":
      return exportPanelInfoMetaTable(pmo);
    case "readCounts":
      return readCountsTable(pmo);
    case "travel":
      return exportSpecimenTravelMetaTable(pmo);
    case "projects":
      return exportProjectInfoMetaTable(pmo);
    case "sequencing":
      return exportSequencingInfoMetaTable(pmo);
    case "bioinformaticsRuns":
      return exportBioinformaticsRunInfoMetaTable(pmo);
    case "bioinformaticsMethods":
      return exportBioinformaticsMethodsInfoMetaTable(pmo);
    case "genomes":
      return exportTargetedGenomesMetaTable(pmo);
    case "header":
      return exportPmoHeaderTable(pmo);
    default:
      throw new Error(`Unknown table: ${String(id)}`);
  }
}

/** One table of `pmo` as a CSV or TSV file named after `baseName`. */
export function tableFile(
  pmo: Pmo,
  options: { readonly id: TableId; readonly format: TableFormat; readonly baseName: string },
): TableFile {
  const text = formatDelimited(tableOf(pmo, options.id), {
    delimiter: options.format === "tsv" ? "\t" : ",",
  });
  return { fileName: `${options.baseName}-${FILE_PARTS[options.id]}.${options.format}`, text };
}

/** The column names and first rows of one table of `pmo`, matching {@link tableFile}. */
export function tablePreview(
  pmo: Pmo,
  options: { readonly id: TableId; readonly limit?: number },
): TablePreview {
  const table = tableOf(pmo, options.id);
  const limit = Math.max(0, options.limit ?? TABLE_PREVIEW_LIMIT);
  return {
    columns: table.columns,
    rows: table.rows.slice(0, limit),
    totalRows: table.rows.length,
  };
}

/** Every table of `pmo`, as {@link tableFile} writes them, in one zip named after `baseName`. */
export async function tablesArchive(
  pmo: Pmo,
  options: { readonly format: TableFormat; readonly baseName: string },
): Promise<TablesArchive> {
  const encoder = new TextEncoder();
  const entries = tablesOf(pmo).map(({ id }) => {
    const file = tableFile(pmo, { id, format: options.format, baseName: options.baseName });
    return { name: file.fileName, data: encoder.encode(file.text) };
  });
  return {
    fileName: `${options.baseName}-tables-${options.format}.zip`,
    blob: await zipFiles(entries),
  };
}

/** `pmo` as a PMO file, gzipped or not, named `baseName.json` or `baseName.json.gz`. */
export async function pmoFile(
  pmo: Pmo,
  options: { readonly gzip: boolean; readonly baseName: string },
): Promise<PmoFile> {
  const { blob } = await exportPmo(pmo, { gzip: options.gzip });
  return { blob, fileName: `${options.baseName}.json${options.gzip ? ".gz" : ""}` };
}
