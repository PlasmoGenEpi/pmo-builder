/**
 * The specimens and library samples sections, through
 * `specimenInfoTableToPmo` and `librarySampleInfoTableToPmo`.
 */
import { t } from "@lingui/core/macro";
import {
  librarySampleInfoTableToPmo,
  specimenInfoTableToPmo,
  type LibrarySampleInfoTableOptions,
  type SpecimenInfoTableOptions,
} from "pmotools-ts";

import type { TableSectionDraft } from "@/domain/draft";

import type { BuildContext } from "./context";
import { notReady, ready, runBuilder, type SectionResult } from "./results";
import { columnOptions, prepareTable, unknownKeysNotice } from "./table";

/** Builder options that name a column of the specimen table. */
export const SPECIMEN_COLUMN_OPTIONS = [
  "specimenNameCol",
  "specimenTaxonIdCol",
  "hostTaxonIdCol",
  "collectionDateCol",
  "collectionCountryCol",
  "projectNameCol",
  "alternateIdentifiersCol",
  "bloodMealCol",
  "drugUsageCol",
  "envBroadScaleCol",
  "envLocalScaleCol",
  "envMediumCol",
  "geoAdmin1Col",
  "geoAdmin2Col",
  "geoAdmin3Col",
  "gravidCol",
  "gravidityCol",
  "hasTravelOutSixMonthCol",
  "hostAgeCol",
  "hostSexCol",
  "hostSubjectNameCol",
  "latLonCol",
  "parasiteDensityCol",
  "parasiteDensityMethodCol",
  "specimenAccessionCol",
  "storagePlateColCol",
  "storagePlateNameCol",
  "storagePlateRowCol",
  "storagePlatePositionCol",
  "specimenCollectDeviceCol",
  "specimenCommentsCol",
  "specimenStoreLocCol",
  "specimenTypeCol",
  "treatmentStatusCol",
] as const satisfies readonly (keyof SpecimenInfoTableOptions)[];

/** Builder options that name a column of the library sample table. */
export const LIBRARY_SAMPLE_COLUMN_OPTIONS = [
  "librarySampleNameCol",
  "specimenNameCol",
  "panelNameCol",
  "sequencingInfoNameCol",
  "alternateIdentifiersCol",
  "experimentAccessionCol",
  "fastqsLocCol",
  "libraryPrepPlateNameCol",
  "libraryPrepPlateColCol",
  "libraryPrepPlateRowCol",
  "libraryPrepPlatePositionCol",
  "parasiteDensityCol",
  "parasiteDensityMethodCol",
  "runAccessionCol",
] as const satisfies readonly (keyof LibrarySampleInfoTableOptions)[];

/**
 * Builds the specimens section. `empty` without a table; `incomplete` while
 * the specimen name is unmapped; `error` when the builder throws.
 */
export function buildSpecimens(
  section: TableSectionDraft,
  context: BuildContext,
): SectionResult<"specimens"> {
  if (section.table === null) return notReady("specimens", "empty");
  const tableLabel = t({
    message: "specimen table",
    comment:
      "A table name in lower case, used inside other messages, such as 'The specimen table has no rows.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
  });
  const prepared = prepareTable(
    { mapped: section.table, fieldSetId: "specimens", tableLabel },
    context,
  );
  if (prepared.kind === "blocked") return notReady("specimens", prepared.status, prepared.notices);
  const { options, unknownKeys } = columnOptions(prepared.columns, SPECIMEN_COLUMN_OPTIONS);
  const run = runBuilder(prepared.issues, (onWarning) =>
    specimenInfoTableToPmo(prepared.typed, {
      ...options,
      ...(prepared.additionalColumns.length > 0
        ? { additionalSpecimenCols: prepared.additionalColumns }
        : {}),
      onWarning,
    }),
  );
  const notices = [...unknownKeysNotice(unknownKeys, tableLabel), ...run.notices];
  if (!run.ok) return notReady("specimens", "error", notices);
  return ready("specimens", run.result, { specimens: run.result.length }, notices);
}

/**
 * Builds the library samples section. Same status rules as
 * {@link buildSpecimens}. Specimen and panel name columns that are not
 * mapped are passed as `null`, because the builder's defaults would
 * otherwise look for columns named `specimen_name` and `panel_name`.
 */
export function buildLibrarySamples(
  section: TableSectionDraft,
  context: BuildContext,
): SectionResult<"librarySamples"> {
  if (section.table === null) return notReady("librarySamples", "empty");
  const tableLabel = t({
    message: "library sample table",
    comment:
      "A table name in lower case, used inside other messages, such as 'The library sample table has no rows.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
  });
  const prepared = prepareTable(
    { mapped: section.table, fieldSetId: "librarySamples", tableLabel },
    context,
  );
  if (prepared.kind === "blocked")
    return notReady("librarySamples", prepared.status, prepared.notices);
  const { options, unknownKeys } = columnOptions(prepared.columns, LIBRARY_SAMPLE_COLUMN_OPTIONS);
  const run = runBuilder(prepared.issues, (onWarning) =>
    librarySampleInfoTableToPmo(prepared.typed, {
      specimenNameCol: null,
      panelNameCol: null,
      ...options,
      ...(prepared.additionalColumns.length > 0
        ? { additionalLibrarySampleInfoCols: prepared.additionalColumns }
        : {}),
      onWarning,
    }),
  );
  const notices = [...unknownKeysNotice(unknownKeys, tableLabel), ...run.notices];
  if (!run.ok) return notReady("librarySamples", "error", notices);
  return ready("librarySamples", run.result, { librarySamples: run.result.length }, notices);
}
