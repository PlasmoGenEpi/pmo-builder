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
  filterPmoBySpecimenNames,
  filterPmoByTargetNames,
  formatDelimited,
  PmoError,
  validatePmo,
  type ColumnTable,
  type PortableMicrohaplotypeObject,
} from "pmotools-ts";

import { readPmoFile } from "@/domain/build/checkFile";
import { MAX_LISTED, PUBLISHABLE_PMO_VERSION } from "@/domain/build/checkFileResult";
import { summarisePmo } from "@/domain/build/merge";
import { summarisePublication } from "@/domain/build/publication";

import {
  MAX_META_VALUES,
  TABLE_IDS,
  type MetaField,
  type OpenOutcome,
  type PmoChoices,
  type SubsetOutcome,
  type SubsetRequest,
  type TableFile,
  type TableFormat,
  type TableId,
  type TableInfo,
} from "./types";

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

/** The metadata fields specimens can be chosen by, with their values. */
function metadataChoices(pmo: Pmo): MetaField[] {
  const projects = pmo.project_info ?? [];
  const fields = countSpecimenPerMetaFields(pmo).rows.flatMap((row) =>
    typeof row[0] === "string" ? [row[0]] : [],
  );
  return fields.flatMap((field): MetaField[] => {
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
          metadata.flatMap(({ field }) =>
            field in record ? [[field, asText(record[field])]] : [],
          ),
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

/** The tables `pmo` can give, with their row counts. Sections it lacks are left out. */
export function tablesOf(pmo: Pmo): TableInfo[] {
  const rows: Record<TableId, number | null> = {
    alleles: alleleCount(pmo),
    specimens: pmo.specimen_info.length,
    librarySamples: pmo.library_sample_info.length,
    targets: pmo.target_info.length,
    panels: pmo.panel_info.length === 0 ? null : exportPanelInfoMetaTable(pmo).rows.length,
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

/** Opens a PMO this app has just built, which needs no reading or format check. */
export function openBuiltPmo(pmo: Pmo, fileName: string): Extract<OpenOutcome, { kind: "opened" }> {
  const warnings = [
    ...new Set(
      checkPmoIntegrity(pmo)
        .filter((issue) => issue.severity === "warning")
        .map((issue) => issue.message),
    ),
  ].slice(0, MAX_LISTED);
  return describe(pmo, fileName, warnings);
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
    out = extractFromPmoSamplesWithMetaGroupings(out, [
      { criteria: request.specimens.criteria },
    ]).pmo;
  }
  if (request.targets.kind === "names") out = filterPmoByTargetNames(out, request.targets.names);
  if (request.minReads > 0) out = extractFromPmoWithReadFilter(out, request.minReads);
  return out;
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
