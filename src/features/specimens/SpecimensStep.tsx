import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

import { StepPage } from "@/app/StepPage";
import { StepLink } from "@/app/StepLink";
import { mappedColumns, type MappedTable } from "@/domain/draft";
import { NameCheck, SectionResult, listNames, type ResultStat } from "@/features/shared";
import { TableImport } from "@/features/table-import";
import {
  useColumnValues,
  useSectionState,
  useSlotTable,
  useSuggestions,
  type ColumnValuesState,
} from "@/state";

const SLOT = { section: "specimens" } as const;

/** Enough distinct values to cover a study's countries and dates. */
const VALUE_LIMIT = 10_000;

/** The column a field is matched to, or `null`. */
function columnFor(mapped: MappedTable | null, fieldKey: string): string | null {
  if (mapped === null) return null;
  return mappedColumns(mapped)[fieldKey] ?? null;
}

function readyValues(state: ColumnValuesState | null): readonly string[] | null {
  return state?.kind === "ready" ? state.values : null;
}

/**
 * Earliest and latest collection dates. Dates are YYYY, YYYY-MM or
 * YYYY-MM-DD, which sort as text; anything else is left out.
 */
function dateRange(values: readonly string[]): ResultStat | null {
  const dates = values.filter((value) => /^\d{4}(-\d{2}){0,2}$/.test(value)).toSorted();
  const first = dates[0];
  const last = dates.at(-1);
  if (first === undefined || last === undefined) return null;
  const firstYear = first.slice(0, 4);
  const lastYear = last.slice(0, 4);
  return {
    label: t({
      message: "Collected",
      comment: "Stat label: the years the specimens were collected",
    }),
    value: firstYear === lastYear ? firstYear : `${firstYear}–${lastYear.slice(2)}`,
    hint: first === last ? undefined : t`${first} to ${last}`,
  };
}

/** Project names in the table, checked against the Project step, with a link to it. */
function ProjectNames() {
  const { projectNames } = useSuggestions();
  const known = useSectionState("project")?.summary?.names ?? null;
  if (projectNames.length === 0) return null;
  return (
    <dl>
      <NameCheck
        label={t`Projects named in this table`}
        names={projectNames}
        noneMessage={t`No project column is matched yet.`}
        stepId="project"
        known={known}
        things={t`projects`}
        emptyAdvice={t`Add them there to keep the link.`}
      />
    </dl>
  );
}

/** What a specimen is, how it differs from a library sample, and the one-sheet case. */
function Introduction() {
  return (
    <div className="flex max-w-prose flex-col gap-4 text-md text-text">
      <p>
        <Trans>
          A specimen is the physical sample as it was collected, such as a blood spot, with where
          and when it was taken and from whom. A library sample is one sequencing of a specimen, so
          one specimen can have several library samples.
        </Trans>
      </p>
      <p className="text-base text-text-muted">
        <Trans>
          Only the specimen name is needed. Many labs keep specimens and library samples in one
          sheet. If yours does, add the same file here and on the{" "}
          <StepLink step="librarySamples">Library samples step</StepLink>. Without a library sample
          table, the specimen names must be the sample names in your allele table.
        </Trans>
      </p>
    </div>
  );
}

/**
 * The specimens step: what a specimen is, the specimen table with its
 * optional fields grouped, the projects it names, and the result.
 */
export function SpecimensStep() {
  const mapped = useSlotTable(SLOT);
  const table = mapped?.table ?? null;
  const countries = readyValues(
    useColumnValues(table, columnFor(mapped, "collectionCountry"), VALUE_LIMIT),
  );
  const dates = readyValues(
    useColumnValues(table, columnFor(mapped, "collectionDate"), VALUE_LIMIT),
  );
  const { projectNames } = useSuggestions();
  const collected = dates === null ? null : dateRange(dates);

  return (
    <StepPage stepId="specimens">
      <div className="flex flex-col gap-10">
        <Introduction />
        <TableImport
          slot={SLOT}
          label={t`Specimen table`}
          description={t`One row for each specimen, with its name and any collection, place and host details.`}
        >
          <ProjectNames />
        </TableImport>
        <SectionResult
          section="specimens"
          emptyMessage={t`Nothing here yet. This step is optional. Without it, the PMO has no collection dates, places or host details.`}
          stats={(summary) => [
            { label: t`Specimens`, value: summary.specimens },
            ...(countries === null || countries.length === 0
              ? []
              : [
                  {
                    label: plural(countries.length, { one: "Country", other: "Countries" }),
                    value: countries.length,
                    hint: listNames(countries, 3),
                  },
                ]),
            ...(collected === null ? [] : [collected]),
            ...(projectNames.length === 0
              ? []
              : [
                  {
                    label: plural(projectNames.length, { one: "Project", other: "Projects" }),
                    value: projectNames.length,
                    hint: listNames(projectNames, 3),
                  },
                ]),
          ]}
        />
      </div>
    </StepPage>
  );
}
