/**
 * The microhaplotypes section: the allele table, through `mhapTableToPmo`.
 */
import { mhapTableToPmo, type MhapTableToPmoOptions, type MhapTableToPmoResult } from "pmotools-ts";

import type { MicrohaplotypesDraft } from "@/domain/draft";
import type { RawRow, RawTable } from "@/domain/types";

import type { BuildContext } from "./context";
import { describeRows, makeNotice, quoteItems } from "./notices";
import {
  notReady,
  ready,
  runBuilder,
  type MicrohaplotypesSummary,
  type SectionResult,
} from "./results";
import { resolveRunName, runNameStarted } from "./runName";
import { columnOptions, prepareTable, unknownKeysNotice } from "./table";

/** Builder options that name a column of the allele table. */
export const MHAP_COLUMN_OPTIONS = [
  "librarySampleNameCol",
  "targetNameCol",
  "seqCol",
  "readsCol",
  "umisCol",
  "chromCol",
  "startCol",
  "endCol",
  "refSeqCol",
  "strandCol",
  "altAnnotationsCol",
  "maskingSeqStartCol",
  "maskingSeqSegmentSizeCol",
  "maskingReplacementSizeCol",
  "microhaplotypeNameCol",
  "pseudocigarCol",
  "pseudocigarChromCol",
  "pseudocigarStartCol",
  "pseudocigarEndCol",
  "pseudocigarRefSeqCol",
  "pseudocigarStrandCol",
  "pseudocigarGenerationDescriptionCol",
  "qualityCol",
] as const satisfies readonly (keyof MhapTableToPmoOptions)[];

const TABLE_LABEL = "allele table";

/**
 * Builds the microhaplotypes section.
 *
 * - `empty`: no table and no run name.
 * - `incomplete`: no table, a required field unmapped, or a run name chosen but not given.
 * - `error`: a mapping or run name problem, or `mhapTableToPmo` threw.
 */
export function buildMicrohaplotypes(
  section: MicrohaplotypesDraft,
  context: BuildContext,
): SectionResult<"microhaplotypes"> {
  if (section.table === null) {
    return runNameStarted(section.runName) || section.representativeColumns.length > 0
      ? notReady("microhaplotypes", "incomplete", [
          makeNotice("error", "table/not-imported", "Import the allele table."),
        ])
      : notReady("microhaplotypes", "empty");
  }

  const runName = resolveRunName(section.runName, section.table.table.columns, TABLE_LABEL);
  const prepared = prepareTable(
    {
      mapped: section.table,
      fieldSetId: "microhaplotypes",
      tableLabel: TABLE_LABEL,
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
      makeNotice(
        "error",
        "mapping/unknown-additional-column",
        `The allele table has no ${missingRepresentative.length === 1 ? "column" : "columns"} ${quoteItems(
          missingRepresentative,
        )}, chosen to carry onto each microhaplotype. Untick ${missingRepresentative.length === 1 ? "it" : "them"}.`,
      ),
    ]);
  }

  const repeated = repeatedRowsNotice(prepared.raw, prepared.columns, runName.textColumn);
  if (repeated !== null) return notReady("microhaplotypes", "error", [repeated]);

  const { options, unknownKeys } = columnOptions(prepared.columns, MHAP_COLUMN_OPTIONS);
  const representative = section.representativeColumns;
  const detected = prepared.additionalColumns.filter((column) => !representative.includes(column));
  const run = runBuilder(prepared.issues, (onWarning) =>
    mhapTableToPmo(prepared.typed, {
      ...options,
      ...(runName.option === undefined ? {} : { bioinformaticsRunName: runName.option }),
      ...(representative.length > 0 ? { additionalRepresentativeMhapCols: representative } : {}),
      ...(detected.length > 0 ? { additionalMhapDetectedCols: detected } : {}),
      onWarning,
    }),
  );
  const notices = [...unknownKeysNotice(unknownKeys, TABLE_LABEL), ...run.notices];
  if (!run.ok) return notReady("microhaplotypes", "error", notices);
  return ready(
    "microhaplotypes",
    run.result,
    summarise(run.result, prepared.raw.rows.length),
    notices,
  );
}

function summarise(fragment: MhapTableToPmoResult, rows: number): MicrohaplotypesSummary {
  const samples = new Set<string>();
  const runNames: string[] = [];
  for (const run of fragment.detected_microhaplotypes) {
    for (const sample of run.library_samples) samples.add(sample.library_sample_name);
    if (run.bioinformatics_run_name !== undefined) runNames.push(run.bioinformatics_run_name);
  }
  const targets = fragment.representative_microhaplotypes.targets;
  return {
    rows,
    librarySamples: samples.size,
    targets: targets.length,
    microhaplotypes: targets.reduce((total, target) => total + target.microhaplotypes.length, 0),
    runNames,
  };
}

/** A raw cell, trimmed, with a missing cell as "". */
function cell(row: RawRow, column: string): string {
  return (row[column] ?? "").trim();
}

/** Most distinct values a column may hold to be offered as the run column. */
const MAX_RUN_VALUES = 50;

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
): ReturnType<typeof makeNotice> | null {
  const sample = columns["librarySampleName"];
  const target = columns["targetName"];
  const seq = columns["seq"];
  if (sample === undefined || target === undefined || seq === undefined) return null;
  const keyOf = (row: RawRow, extra: string | null): string =>
    JSON.stringify([
      runColumn === null ? "" : cell(row, runColumn),
      cell(row, sample),
      cell(row, target),
      cell(row, seq),
      extra === null ? "" : cell(row, extra),
    ]);
  const repeats = (extra: string | null): number[] => {
    const seen = new Set<string>();
    const found: number[] = [];
    raw.rows.forEach((row, index) => {
      const key = keyOf(row, extra);
      if (seen.has(key)) found.push(index);
      else seen.add(key);
    });
    return found;
  };
  const rows = repeats(null);
  const [first] = rows;
  if (first === undefined) return null;
  const firstRow = raw.rows[first] ?? {};
  const one = rows.length === 1;
  const example = `${one ? "" : "such as "}sample "${cell(firstRow, sample)}", target "${cell(firstRow, target)}"`;
  const used = new Set([...Object.values(columns), ...(runColumn === null ? [] : [runColumn])]);
  const runLike = raw.columns.find((column) => {
    if (used.has(column)) return false;
    const values = new Set(raw.rows.map((row) => cell(row, column)));
    return values.size > 1 && values.size <= MAX_RUN_VALUES && repeats(column).length === 0;
  });
  const cause =
    runColumn === null && runLike !== undefined
      ? `Column "${runLike}" tells them apart, so the table probably holds several analysis runs. Choose that column under "Bioinformatics run name".`
      : runColumn === null
        ? 'Remove the repeated rows. If the table holds several analysis runs, choose the column that names the run under "Bioinformatics run name".'
        : "Remove the repeated rows.";
  return makeNotice(
    "error",
    "table/repeated-rows",
    `${rows.length} ${one ? "row repeats" : "rows repeat"} the sample, target and sequence of an earlier row${
      runColumn === null ? "" : " in the same run"
    }: ${describeRows(rows)} (${example}), so their reads would be counted twice. ${cause}`,
  );
}
