/**
 * Shared constants, notices, and summaries used by both the in-memory and
 * streaming microhaplotypes builders.
 */
import { plural, t } from "@lingui/core/macro";
import type { MhapTableToPmoOptions, MhapTableToPmoResult } from "pmotools-ts";

import type { Notice, RawRow } from "@/domain/types";

import { describeRowSample, makeNotice, quoteItems, type RowSample } from "./notices";
import type { MicrohaplotypesSummary } from "./results";

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

/** Lower-case table label for microhaplotypes notices. */
export const MHAP_TABLE_LABEL = t({
  message: "allele table",
  comment:
    "The table of microhaplotypes: a table name in lower case, used inside other messages, such as 'The allele table has no rows.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
});

/** Default number of rows fed to `createMhapTableBuilder` per chunk. */
export const DEFAULT_MHAP_CHUNK_SIZE = 50_000;

/** Most distinct values a column may hold to be offered as the run column. */
export const MAX_RUN_VALUES = 50;

/** Notice when chosen representative columns are not present in the allele table. */
export function missingRepresentativeNotice(missingRepresentative: readonly string[]): Notice {
  const columnCount = missingRepresentative.length;
  const columns = quoteItems(missingRepresentative);
  return makeNotice(
    "error",
    "mapping/unknown-additional-column",
    plural(columnCount, {
      one: `The allele table has no column ${columns}, chosen to carry onto each microhaplotype. Untick it.`,
      other: `The allele table has no columns ${columns}, chosen to carry onto each microhaplotype. Untick them.`,
    }),
  );
}

/** Summarises a built microhaplotypes fragment for the section view. */
export function summariseMicrohaplotypes(
  fragment: MhapTableToPmoResult,
  rows: number,
): MicrohaplotypesSummary {
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

/** A raw cell, trimmed, with a missing cell as `""`. */
export function trimmedCell(row: RawRow, column: string): string {
  return (row[column] ?? "").trim();
}

/** Input for {@link formatRepeatedRowsNotice}. */
export interface RepeatedRowsNoticeInput {
  readonly sampleName: string;
  readonly targetName: string;
  readonly rows: RowSample;
  readonly runColumn: string | null;
  readonly runLike: string | undefined;
}

/** Formats the error notice for repeated `(run, sample, target, seq)` rows. */
export function formatRepeatedRowsNotice(input: RepeatedRowsNoticeInput): Notice {
  const { sampleName, targetName, rows, runColumn, runLike } = input;
  const rowCount = rows.count;
  const rowList = describeRowSample(rows);
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
