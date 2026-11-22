/**
 * Flattening a PMO's `read_counts_by_stage` section into a tabular form for
 * preview and CSV/TSV export, plus counting its rows without allocating cells.
 */
import type { ColumnTable, PortableMicrohaplotypeObject, TableCell } from "pmotools-ts";

type Pmo = PortableMicrohaplotypeObject;

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

/** Whether `value` is a flat table cell primitive (`string`, `number`, `boolean`, or `null`). */
export function isPrimitive(value: unknown): value is TableCell {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function isPrimitiveList(value: unknown): value is readonly TableCell[] {
  return Array.isArray(value) && value.every(isPrimitive);
}

function extraCell(value: unknown): TableCell | undefined {
  if (isPrimitive(value)) return value;
  if (isPrimitiveList(value)) {
    return value.map((item) => (item === null ? "" : String(item))).join(",");
  }
  return undefined;
}

function addExtraCells(options: {
  readonly record: Readonly<Record<string, unknown>>;
  readonly row: Map<string, TableCell>;
  readonly extraKeys: Set<string>;
}): void {
  for (const [key, value] of Object.entries(options.record)) {
    if (READ_COUNTS_BUILTIN_KEYS.has(key)) continue;
    const cell = extraCell(value);
    if (cell !== undefined) {
      options.row.set(key, cell);
      options.extraKeys.add(key);
    }
  }
}

/** How many rows {@link readCountsTable} produces for `pmo`. */
export function readCountsRowCount(pmo: Pmo): number {
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

/** Flattens `pmo.read_counts_by_stage` into one row per sample, target, and stage. */
export function readCountsTable(pmo: Pmo): ColumnTable {
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
      addExtraCells({ record: sample, row: base, extraKeys });

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
          addExtraCells({ record: target, row, extraKeys });
          addExtraCells({ record: stage, row, extraKeys });
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
