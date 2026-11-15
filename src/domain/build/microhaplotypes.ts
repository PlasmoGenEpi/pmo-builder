/**
 * The microhaplotypes section: the allele table, through `mhapTableToPmo`.
 */
import { plural, t } from "@lingui/core/macro";
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

const TABLE_LABEL = t({
  message: "allele table",
  comment:
    "The table of microhaplotypes: a table name in lower case, used inside other messages, such as 'The allele table has no rows.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
});

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
          makeNotice("error", "table/not-imported", t`Import the allele table.`),
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
    const columnCount = missingRepresentative.length;
    const columns = quoteItems(missingRepresentative);
    return notReady("microhaplotypes", "error", [
      makeNotice(
        "error",
        "mapping/unknown-additional-column",
        plural(columnCount, {
          one: `The allele table has no column ${columns}, chosen to carry onto each microhaplotype. Untick it.`,
          other: `The allele table has no columns ${columns}, chosen to carry onto each microhaplotype. Untick them.`,
        }),
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
    const value = cell(row, column);
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
  const sampleName = cell(firstRow, sample);
  const targetName = cell(firstRow, target);
  const used = new Set([...Object.values(columns), ...(runColumn === null ? [] : [runColumn])]);
  const runLike = raw.columns.find((column) => {
    if (used.has(column)) return false;
    const values = new Set(raw.rows.map((row) => cell(row, column)));
    return values.size > 1 && values.size <= MAX_RUN_VALUES && repeats(column).length === 0;
  });
  const rowCount = rows.length;
  const rowList = describeRows(rows);
  const repeatedText =
    runColumn === null
      ? t({
          message: plural(rowCount, {
            one: `# row repeats the sample, target and sequence of an earlier row: ${rowList} (sample "${sampleName}", target "${targetName}"), so their reads would be counted twice.`,
            other: `# rows repeat the sample, target and sequence of an earlier row: ${rowList} (such as sample "${sampleName}", target "${targetName}"), so their reads would be counted twice.`,
          }),
          comment: "{rowList} is such as 'rows 5 and 9'.",
        })
      : t({
          message: plural(rowCount, {
            one: `# row repeats the sample, target and sequence of an earlier row in the same run: ${rowList} (sample "${sampleName}", target "${targetName}"), so their reads would be counted twice.`,
            other: `# rows repeat the sample, target and sequence of an earlier row in the same run: ${rowList} (such as sample "${sampleName}", target "${targetName}"), so their reads would be counted twice.`,
          }),
          comment: "{rowList} is such as 'rows 5 and 9'.",
        });
  const cause =
    runColumn === null && runLike !== undefined
      ? t({
          message: `Column "${runLike}" tells them apart, so the table probably holds several analysis runs. Choose that column under "Bioinformatics run name".`,
          comment:
            '"Bioinformatics run name" is the label of a field on the page; use the same words as there.',
        })
      : runColumn === null
        ? t({
            message:
              'Remove the repeated rows. If the table holds several analysis runs, choose the column that names the run under "Bioinformatics run name".',
            comment:
              '"Bioinformatics run name" is the label of a field on the page; use the same words as there.',
          })
        : t`Remove the repeated rows.`;
  return makeNotice("error", "table/repeated-rows", `${repeatedText} ${cause}`);
}
