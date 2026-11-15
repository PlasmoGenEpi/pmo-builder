import { t } from "@lingui/core/macro";

import { defineFieldSet } from "./define";

/**
 * Total raw reads per library sample. Keys are `readCountByStageTableToPmo`
 * options without `Col`. `additionalLibrarySampleCols` is fed by
 * `additionalColumns`.
 */
export const READ_COUNT_TOTAL_FIELDS = defineFieldSet({
  id: "readCountTotals",
  title: t`Total reads per sample`,
  allowsAdditionalColumns: true,
  fields: [
    {
      key: "librarySampleName",
      label: t`Library sample name`,
      description: t`The name of the sequenced sample, as used in the allele table.`,
      required: true,
      kind: "text",
      aliases: [
        "library_sample_id",
        "sample_id",
        "sample_name",
        "sample",
        "sampleID",
        "library_id",
        "biosample_id",
        "specimen_id",
      ],
    },
    {
      key: "totalRawCount",
      label: t`Total raw reads`,
      description: t`How many reads came off the sequencer for this sample.`,
      required: true,
      kind: "integer",
      aliases: [
        "raw_count",
        "raw_counts",
        "raw_read_count",
        "raw_reads",
        "total_reads",
        "total_raw_reads",
        "read_count",
        "reads",
        "demultiplexed_read_count",
        "demuliplexed_read_count",
        "demultiplexed",
      ],
    },
  ],
});

/**
 * Reads per sample, target and pipeline stage, in long format. Keys are
 * `readCountByStageTableToPmo` options without `Col`. Wide format (one column
 * per stage) needs a list of columns for `stageCol`, which a single-column
 * field cannot express. `additionalTargetCols` is fed by `additionalColumns`.
 */
export const READ_COUNTS_BY_STAGE_FIELDS = defineFieldSet({
  id: "readCountsByStage",
  title: t`Reads per stage`,
  allowsAdditionalColumns: true,
  fields: [
    {
      key: "librarySampleName",
      label: t`Library sample name`,
      description: t`The name of the sequenced sample, as used in the allele table.`,
      required: true,
      kind: "text",
      aliases: [
        "library_sample_id",
        "sample_id",
        "sample_name",
        "sample",
        "library_id",
        "biosample_id",
      ],
    },
    {
      key: "targetName",
      label: t`Target name`,
      description: t`The name of the target (amplicon or locus).`,
      required: true,
      kind: "text",
      aliases: ["target_id", "target", "locus", "locus_id", "marker_id", "amplicon"],
    },
    {
      key: "stage",
      label: t({ message: "Stage", comment: "Field label: a step of the bioinformatics pipeline" }),
      description: t`The step of the pipeline the count was taken at, such as demultiplexed or filtered.`,
      required: true,
      kind: "text",
      aliases: ["pipeline_stage", "step", "pipeline_step", "stage_name"],
    },
    {
      key: "readCount",
      label: t({ message: "Reads", comment: "Field label: a count of sequencing reads" }),
      description: t`How many reads were left for this sample and target at this stage.`,
      required: true,
      kind: "integer",
      aliases: ["reads", "read_counts", "count", "sequence_reads", "read_depth", "depth"],
    },
  ],
});
