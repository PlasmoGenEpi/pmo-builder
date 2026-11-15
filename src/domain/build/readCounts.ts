/**
 * The read counts section: a totals table and an optional by-stage table,
 * through `readCountByStageTableToPmo`.
 */
import { t } from "@lingui/core/macro";
import {
  readCountByStageTableToPmo,
  type ReadCountByStageOptions,
  type Row,
  type Table,
} from "pmotools-ts";

import type { ReadCountsDraft } from "@/domain/draft";
import type { Notice, SectionStatus } from "@/domain/types";

import type { BuildContext } from "./context";
import { makeNotice } from "./notices";
import {
  notReady,
  ready,
  runBuilder,
  worstStatus,
  type ReadCountsSummary,
  type SectionResult,
} from "./results";
import { resolveRunName, runNameStarted } from "./runName";
import { columnOptions, prepareTable, unknownKeysNotice, type PreparedTable } from "./table";

/** Builder options that name a column of the totals table. */
export const READ_COUNT_TOTAL_OPTIONS = [
  "librarySampleNameCol",
  "totalRawCountCol",
] as const satisfies readonly (keyof ReadCountByStageOptions)[];

/** Builder options that name a column of the by-stage table (apart from its sample column). */
export const READ_COUNT_STAGE_OPTIONS = [
  "targetNameCol",
  "stageCol",
  "readCountCol",
] as const satisfies readonly (keyof ReadCountByStageOptions)[];

/**
 * pmotools-ts reads the sample column of both tables from one option, so the
 * by-stage table's sample column is renamed to the totals table's name.
 */
function renameColumn(table: Table, from: string, to: string): Table {
  if (from === to) return table;
  return table.map((row): Row => {
    const copy: Record<string, Row[string]> = {};
    for (const [key, value] of Object.entries(row)) copy[key === from ? to : key] = value;
    return copy;
  });
}

/**
 * Builds the read counts section.
 *
 * - `empty`: no table and no run name.
 * - `incomplete`: the totals table is missing (it is needed whenever the
 *   by-stage table is given), a required field is unmapped, or a run name
 *   was chosen but not given.
 * - `error`: a mapping or run name problem, or the builder threw (a count
 *   that is not a whole number, a sample listed twice).
 */
export function buildReadCounts(
  section: ReadCountsDraft,
  context: BuildContext,
): SectionResult<"readCounts"> {
  if (section.totals === null) {
    if (section.byStage === null && !runNameStarted(section.runName))
      return notReady("readCounts", "empty");
    return notReady("readCounts", "incomplete", [
      makeNotice("error", "read-counts/no-totals", t`Import the table of total reads per sample.`),
    ]);
  }
  const totalsLabel = t({
    message: "totals table",
    comment: "The table of total reads per sample, named inside other messages.",
  });
  const byStageLabel = t({
    message: "by-stage table",
    comment:
      "The table of reads per sample, target and processing stage, named inside other messages.",
  });
  const runName = resolveRunName(section.runName, section.totals.table.columns, totalsLabel);
  const totals = prepareTable(
    {
      mapped: section.totals,
      fieldSetId: "readCountTotals",
      tableLabel: totalsLabel,
      extraTextColumns:
        runName.kind === "ok" && runName.textColumn !== null ? [runName.textColumn] : [],
    },
    context,
  );
  const byStage =
    section.byStage === null
      ? null
      : prepareTable(
          {
            mapped: section.byStage,
            fieldSetId: "readCountsByStage",
            tableLabel: byStageLabel,
          },
          context,
        );

  const blocked: Notice[] = [];
  const statuses: SectionStatus[] = [];
  if (totals.kind === "blocked") {
    blocked.push(...totals.notices);
    statuses.push(totals.status);
  }
  if (byStage !== null && byStage.kind === "blocked") {
    blocked.push(...byStage.notices);
    statuses.push(byStage.status);
  }
  if (runName.kind === "blocked") {
    blocked.push(runName.notice);
    statuses.push(runName.status);
  }
  if (
    totals.kind === "blocked" ||
    (byStage !== null && byStage.kind === "blocked") ||
    runName.kind === "blocked"
  ) {
    return notReady(
      "readCounts",
      worstStatus(statuses) === "error" ? "error" : "incomplete",
      blocked,
    );
  }
  const stage: PreparedTable | null = byStage;

  const totalOptions = columnOptions(totals.columns, READ_COUNT_TOTAL_OPTIONS);
  const sampleColumn = totalOptions.options.librarySampleNameCol ?? "library_sample_name";
  const notices: Notice[] = [...unknownKeysNotice(totalOptions.unknownKeys, totalsLabel)];
  let readsByStageTable: Table | null = null;
  let stageOptions: Partial<Record<(typeof READ_COUNT_STAGE_OPTIONS)[number], string>> = {};
  if (stage !== null) {
    const stageSample = stage.columns["librarySampleName"];
    if (
      stageSample !== undefined &&
      stageSample !== sampleColumn &&
      stage.raw.columns.includes(sampleColumn)
    ) {
      return notReady("readCounts", "error", [
        makeNotice(
          "error",
          "read-counts/sample-column-clash",
          t`The by-stage table takes sample names from column "${stageSample}" but also has a column "${sampleColumn}", the totals table's sample column. Rename one of them in the file.`,
        ),
      ]);
    }
    readsByStageTable =
      stageSample === undefined
        ? stage.typed
        : renameColumn(stage.typed, stageSample, sampleColumn);
    const converted = columnOptions(stage.columns, READ_COUNT_STAGE_OPTIONS, ["librarySampleName"]);
    stageOptions = converted.options;
    notices.push(...unknownKeysNotice(converted.unknownKeys, byStageLabel));
  }

  const run = runBuilder(totals.issues, (onWarning) =>
    readCountByStageTableToPmo(totals.typed, {
      ...totalOptions.options,
      ...stageOptions,
      ...(readsByStageTable === null ? {} : { readsByStageTable }),
      ...(runName.option === undefined ? {} : { bioinformaticsRunName: runName.option }),
      ...(totals.additionalColumns.length > 0
        ? { additionalLibrarySampleCols: totals.additionalColumns }
        : {}),
      ...(stage !== null && stage.additionalColumns.length > 0
        ? { additionalTargetCols: stage.additionalColumns }
        : {}),
      onWarning,
    }),
  );
  notices.push(...run.notices);
  if (!run.ok) return notReady("readCounts", "error", notices);
  return ready("readCounts", run.result, summarise(run.result), notices);
}

function summarise(result: ReturnType<typeof readCountByStageTableToPmo>): ReadCountsSummary {
  const samples = new Set<string>();
  const stages: string[] = [];
  for (const run of result) {
    for (const sample of run.read_counts_by_library_sample_by_stage) {
      samples.add(sample.library_sample_name);
      for (const target of sample.read_counts_for_targets ?? []) {
        for (const entry of target.stages)
          if (!stages.includes(entry.stage)) stages.push(entry.stage);
      }
    }
  }
  return { librarySamples: samples.size, runs: result.length, stages };
}
