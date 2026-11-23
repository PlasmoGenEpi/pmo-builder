/**
 * The microhaplotypes section: the allele table, built in chunks through
 * `createMhapTableBuilder` (synchronously from an in-memory table; see
 * `./microhaplotypesStream` for the two-pass streaming builder).
 */
import { t } from "@lingui/core/macro";
import { createMhapTableBuilder } from "pmotools-ts";

import type { MicrohaplotypesDraft } from "@/domain/draft";
import type { Notice, RawRow, RawTable } from "@/domain/types";

import type { BuildContext } from "./context";
import {
  DEFAULT_MHAP_CHUNK_SIZE,
  MAX_RUN_VALUES,
  MHAP_COLUMN_OPTIONS,
  MHAP_TABLE_LABEL,
  formatRepeatedRowsNotice,
  missingRepresentativeNotice,
  summariseMicrohaplotypes,
  trimmedCell,
} from "./microhaplotypesShared";
import { MAX_ROW_SAMPLE, makeNotice } from "./notices";
import { notReady, ready, runBuilder, type SectionResult } from "./results";
import { resolveRunName, runNameStarted } from "./runName";
import { columnOptions, prepareTable, unknownKeysNotice } from "./table";

export { DEFAULT_MHAP_CHUNK_SIZE, MHAP_COLUMN_OPTIONS } from "./microhaplotypesShared";
export {
  buildMicrohaplotypesStream,
  type MicrohaplotypesStreamProgress,
  type MicrohaplotypesStreamSource,
  type StreamMicrohaplotypesInput,
  type StreamMicrohaplotypesOutput,
} from "./microhaplotypesStream";

/**
 * Builds the microhaplotypes section.
 *
 * - `empty`: no table and no run name.
 * - `incomplete`: no table, a required field unmapped, or a run name chosen but not given.
 * - `error`: a mapping or run name problem, or `createMhapTableBuilder` threw.
 */
export function buildMicrohaplotypes(
  section: MicrohaplotypesDraft,
  context: BuildContext,
): SectionResult<"microhaplotypes"> {
  const chunkSize = context.mhapChunkSize ?? DEFAULT_MHAP_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError(`mhapChunkSize must be a positive integer, got ${chunkSize}`);
  }
  if (section.table === null) {
    return runNameStarted(section.runName) || section.representativeColumns.length > 0
      ? notReady("microhaplotypes", "incomplete", [
          makeNotice("error", "table/not-imported", t`Import the allele table.`),
        ])
      : notReady("microhaplotypes", "empty");
  }

  const runName = resolveRunName(section.runName, section.table.table.columns, MHAP_TABLE_LABEL);
  const prepared = prepareTable(
    {
      mapped: section.table,
      fieldSetId: "microhaplotypes",
      tableLabel: MHAP_TABLE_LABEL,
      extraTextColumns: [
        ...section.representativeColumns,
        ...(runName.kind === "ok" && runName.textColumn !== null ? [runName.textColumn] : []),
      ],
    },
    context,
  );
  if (prepared.kind === "blocked") {
    const notices =
      runName.kind === "blocked" ? [...prepared.notices, runName.notice] : prepared.notices;
    const status =
      runName.kind === "blocked" && runName.status === "error" ? "error" : prepared.status;
    return notReady("microhaplotypes", status, notices);
  }
  if (runName.kind === "blocked")
    return notReady("microhaplotypes", runName.status, [runName.notice]);

  const missingRepresentative = section.representativeColumns.filter(
    (c) => !prepared.raw.columns.includes(c),
  );
  if (missingRepresentative.length > 0) {
    return notReady("microhaplotypes", "error", [
      missingRepresentativeNotice(missingRepresentative),
    ]);
  }

  const repeated = repeatedRowsNotice(prepared.raw, prepared.columns, runName.textColumn);
  if (repeated !== null) return notReady("microhaplotypes", "error", [repeated]);

  const { options, unknownKeys } = columnOptions(prepared.columns, MHAP_COLUMN_OPTIONS);
  const representative = section.representativeColumns;
  const detected = prepared.additionalColumns.filter((column) => !representative.includes(column));
  const run = runBuilder(prepared.issues, (onWarning) => {
    const builder = createMhapTableBuilder({
      ...options,
      ...(runName.option === undefined ? {} : { bioinformaticsRunName: runName.option }),
      ...(representative.length > 0 ? { additionalRepresentativeMhapCols: representative } : {}),
      ...(detected.length > 0 ? { additionalMhapDetectedCols: detected } : {}),
      onWarning,
    });
    if (prepared.typed.length <= chunkSize) {
      builder.add(prepared.typed);
    } else {
      for (let offset = 0; offset < prepared.typed.length; offset += chunkSize) {
        builder.add(prepared.typed.slice(offset, offset + chunkSize));
      }
    }
    return builder.finish();
  });
  const notices = [...unknownKeysNotice(unknownKeys, MHAP_TABLE_LABEL), ...run.notices];
  if (!run.ok) return notReady("microhaplotypes", "error", notices);
  return ready(
    "microhaplotypes",
    run.result,
    summariseMicrohaplotypes(run.result, prepared.raw.rows.length),
    notices,
  );
}

/**
 * An error for rows that repeat the sample, target and sequence of an earlier
 * row in the same run, or `null`. The builder would list the allele twice and
 * count its reads twice. When some other column tells the repeats apart, the
 * table most likely holds several analysis runs and that column names them.
 */
function repeatedRowsNotice(
  raw: RawTable,
  columns: Readonly<Record<string, string>>,
  runColumn: string | null,
): Notice | null {
  const sample = columns["librarySampleName"];
  const target = columns["targetName"];
  const seq = columns["seq"];
  if (sample === undefined || target === undefined || seq === undefined) return null;
  // A row's key is the numbers of its trimmed cells, such as "3,0,12,7,": short
  // whatever the sequence length, so a large table's keys stay small.
  const numbers = new Map<string, Map<string, number>>();
  const numberOf = (row: RawRow, column: string | null): string => {
    if (column === null) return "";
    let known = numbers.get(column);
    if (known === undefined) {
      known = new Map();
      numbers.set(column, known);
    }
    const value = trimmedCell(row, column);
    let number = known.get(value);
    if (number === undefined) {
      number = known.size;
      known.set(value, number);
    }
    return String(number);
  };
  const repeats = (extra: string | null): number[] => {
    const seen = new Set<string>();
    const found: number[] = [];
    raw.rows.forEach((row, index) => {
      const key = [runColumn, sample, target, seq, extra]
        .map((column) => numberOf(row, column))
        .join(",");
      if (seen.has(key)) found.push(index);
      else seen.add(key);
    });
    return found;
  };
  const rows = repeats(null);
  const [first] = rows;
  if (first === undefined) return null;
  const firstRow = raw.rows[first] ?? {};
  const sampleName = trimmedCell(firstRow, sample);
  const targetName = trimmedCell(firstRow, target);
  const used = new Set([...Object.values(columns), ...(runColumn === null ? [] : [runColumn])]);
  const runLike = raw.columns.find((column) => {
    if (used.has(column)) return false;
    const values = new Set(raw.rows.map((row) => trimmedCell(row, column)));
    return values.size > 1 && values.size <= MAX_RUN_VALUES && repeats(column).length === 0;
  });
  return formatRepeatedRowsNotice({
    sampleName,
    targetName,
    rows: { first: rows.slice(0, MAX_ROW_SAMPLE), count: rows.length },
    runColumn,
    runLike,
  });
}
