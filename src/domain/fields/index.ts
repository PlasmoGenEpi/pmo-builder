import type { FieldSetId, FieldSetSpec, FieldSpec } from "../types";

import { MICROHAPLOTYPE_FIELDS } from "./microhaplotypes";
import { PANEL_TARGET_FIELDS } from "./panel";
import { READ_COUNT_TOTAL_FIELDS, READ_COUNTS_BY_STAGE_FIELDS } from "./readCounts";
import { LIBRARY_SAMPLE_FIELDS, SPECIMEN_FIELDS } from "./samples";
import {
  BIOINFORMATICS_METHOD_FIELDS,
  BIOINFORMATICS_RUN_FIELDS,
  GENOME_FIELDS,
  PROJECT_FIELDS,
  SEQUENCING_FIELDS,
} from "./study";

export { defineFieldSet } from "./define";
export type {
  FieldSetDefinition,
  KeyedFieldDependency,
  KeyedFieldSetSpec,
  KeyedFieldSpec,
} from "./define";
export { MICROHAPLOTYPE_FIELDS } from "./microhaplotypes";
export {
  GENOME_RECORD_FIELDS,
  METHOD_STEP_RECORD_FIELDS,
  PROJECT_RECORD_FIELDS,
  RUN_RECORD_FIELDS,
  SEQUENCING_RECORD_FIELDS,
  SEQUENCING_VOCABULARIES,
  toColumnFields,
  toFormFields,
} from "./records";
export type { FormFieldKind, FormFieldSpec, FormatRule, RecordFieldDefinition } from "./records";
export { PANEL_TARGET_FIELDS } from "./panel";
export { READ_COUNT_TOTAL_FIELDS, READ_COUNTS_BY_STAGE_FIELDS } from "./readCounts";
export { LIBRARY_SAMPLE_FIELDS, SPECIMEN_FIELDS } from "./samples";
export {
  BIOINFORMATICS_METHOD_FIELDS,
  BIOINFORMATICS_RUN_FIELDS,
  GENOME_FIELDS,
  PROJECT_FIELDS,
  SEQUENCING_FIELDS,
} from "./study";

/** Every field set, keyed by id. The `satisfies` clause makes a missing id a compile error. */
const BY_ID = {
  microhaplotypes: MICROHAPLOTYPE_FIELDS,
  panelTargets: PANEL_TARGET_FIELDS,
  genomes: GENOME_FIELDS,
  specimens: SPECIMEN_FIELDS,
  librarySamples: LIBRARY_SAMPLE_FIELDS,
  project: PROJECT_FIELDS,
  sequencing: SEQUENCING_FIELDS,
  bioinformaticsMethods: BIOINFORMATICS_METHOD_FIELDS,
  bioinformaticsRuns: BIOINFORMATICS_RUN_FIELDS,
  readCountTotals: READ_COUNT_TOTAL_FIELDS,
  readCountsByStage: READ_COUNTS_BY_STAGE_FIELDS,
} as const satisfies Record<FieldSetId, FieldSetSpec>;

/** Every table the app can map, keyed by field set, in `FIELD_SET_IDS` order. */
export const FIELD_SETS: ReadonlyMap<FieldSetId, FieldSetSpec> = new Map(
  Object.values(BY_ID).map((fieldSet): [FieldSetId, FieldSetSpec] => [fieldSet.id, fieldSet]),
);

/** Looks up one field set. Every `FieldSetId` has one. */
export function getFieldSet(id: FieldSetId): FieldSetSpec {
  return BY_ID[id];
}

/** Looks up one field of a field set by key, or `undefined` when the set has no such field. */
export function getField(fieldSet: FieldSetSpec, key: string): FieldSpec | undefined {
  return fieldSet.fields.find((field) => field.key === key);
}
