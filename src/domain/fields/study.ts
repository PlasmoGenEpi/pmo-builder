import { t } from "@lingui/core/macro";

import { defineFieldSet } from "./define";
import {
  GENOME_RECORD_FIELDS,
  METHOD_STEP_RECORD_FIELDS,
  PROJECT_RECORD_FIELDS,
  RUN_RECORD_FIELDS,
  SEQUENCING_RECORD_FIELDS,
  toColumnFields,
} from "./records";

/**
 * Reference genomes. No pmotools-ts builder; keys are the PMO `GenomeInfo`
 * field names. The fields are defined once, in `./records`.
 */
export const GENOME_FIELDS = defineFieldSet({
  id: "genomes",
  title: t`Reference genomes`,
  allowsAdditionalColumns: true,
  fields: toColumnFields(GENOME_RECORD_FIELDS),
});

/** The project table. No builder; keys are the PMO `ProjectInfo` field names. */
export const PROJECT_FIELDS = defineFieldSet({
  id: "project",
  title: t({ message: "Project", comment: "Title of the project table" }),
  allowsAdditionalColumns: true,
  fields: toColumnFields(PROJECT_RECORD_FIELDS),
});

/** The sequencing table. No builder; keys are the PMO `SequencingInfo` field names. */
export const SEQUENCING_FIELDS = defineFieldSet({
  id: "sequencing",
  title: t`Sequencing runs`,
  allowsAdditionalColumns: true,
  fields: toColumnFields(SEQUENCING_RECORD_FIELDS),
});

/**
 * One step of a bioinformatics method. No builder; keys are the PMO
 * `BioMethod` field names.
 */
export const BIOINFORMATICS_METHOD_FIELDS = defineFieldSet({
  id: "bioinformaticsMethods",
  title: t`Bioinformatics methods`,
  allowsAdditionalColumns: true,
  fields: toColumnFields(METHOD_STEP_RECORD_FIELDS),
});

/**
 * Bioinformatics runs. No builder; keys are the PMO `BioinformaticsRunInfo`
 * field names. `bioinformatics_methods_id` is an index the app assigns, so it
 * is not a column field.
 */
export const BIOINFORMATICS_RUN_FIELDS = defineFieldSet({
  id: "bioinformaticsRuns",
  title: t`Bioinformatics runs`,
  allowsAdditionalColumns: true,
  fields: toColumnFields(RUN_RECORD_FIELDS),
});
