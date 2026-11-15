import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

import { StepLink } from "@/app/StepLink";
import { StepPage } from "@/app/StepPage";
import { mappedColumns, type MappedTable } from "@/domain/draft";
import type { Notice } from "@/domain/types";
import { NameCheck, SectionResult, listNames, type ResultStat } from "@/features/shared";
import { TableImport } from "@/features/table-import";
import {
  useColumnValues,
  useDraftSection,
  useOverallState,
  useSectionState,
  useSlotTable,
  useSuggestions,
  type ColumnValuesState,
} from "@/state";
import { Callout, Card, SectionHeading } from "@/ui";

const SLOT = { section: "librarySamples" } as const;
const SPECIMEN_SLOT = { section: "specimens" } as const;

/** Enough distinct names to compare whole tables of a study. */
const NAME_LIMIT = 10_000;

/** The column a field is matched to, or `null`. */
function columnFor(mapped: MappedTable | null, fieldKey: string): string | null {
  if (mapped === null) return null;
  return mappedColumns(mapped)[fieldKey] ?? null;
}

function readyValues(state: ColumnValuesState | null): readonly string[] | null {
  return state?.kind === "ready" ? state.values : null;
}

/** Panel names on the Panel step: the built names, or the names typed so far. */
function usePanelNames(): readonly string[] {
  const built = useSectionState("panel")?.summary;
  const draft = useDraftSection("panel");
  if (built !== null && built !== undefined) return built.panels.map((panel) => panel.name);
  return draft.panels
    .map((panel) => (panel.source === "saved" ? (panel.saved?.name ?? "") : panel.name).trim())
    .filter((name) => name !== "");
}

/**
 * Notices from the whole-PMO check that concern this table, other than the
 * specimen, panel and sequencing names, which {@link References} checks.
 */
function useOtherLinkNotices(): readonly Notice[] {
  const overall = useOverallState();
  return (overall?.notices ?? []).filter((notice) => {
    const sections = notice.sections ?? [];
    return (
      sections.includes("librarySamples") &&
      !sections.includes("panel") &&
      !sections.includes("sequencing") &&
      !sections.includes("specimens")
    );
  });
}

/** What the library sample table refers to on other steps, and whether each name is found. */
function References({ mapped }: { readonly mapped: MappedTable }) {
  const suggestions = useSuggestions();
  const specimenTable = useSlotTable(SPECIMEN_SLOT);
  const specimenColumn = columnFor(mapped, "specimenName");
  const specimens = readyValues(useColumnValues(mapped.table, specimenColumn, NAME_LIMIT));
  const knownSpecimens = readyValues(
    useColumnValues(
      specimenTable?.table ?? null,
      columnFor(specimenTable, "specimenName"),
      NAME_LIMIT,
    ),
  );
  const panels = usePanelNames();
  const sequencing = useSectionState("sequencing")?.summary?.names ?? null;
  const notices = useOtherLinkNotices();

  return (
    <Card as="section" aria-labelledby="library-links-heading">
      <div className="flex flex-col gap-4">
        <SectionHeading
          id="library-links-heading"
          title={t`What this table refers to`}
          description={t`These names must match the other steps exactly, or the links are lost.`}
        />
        <dl className="flex flex-col divide-y divide-border">
          <NameCheck
            label={t`Specimens named in this table`}
            names={specimenColumn === null ? [] : specimens}
            noneMessage={t`No specimen name column is matched yet.`}
            stepId="specimens"
            known={knownSpecimens}
            things={t`specimens`}
          />
          <NameCheck
            label={t`Panels named in this table`}
            names={columnFor(mapped, "panelName") === null ? [] : suggestions.panelNames}
            noneMessage={t`No panel column is matched yet.`}
            stepId="panel"
            known={panels}
            things={t`named panels`}
          />
          <NameCheck
            label={t`Sequencing runs named in this table`}
            names={
              columnFor(mapped, "sequencingInfoName") === null ? [] : suggestions.sequencingNames
            }
            noneMessage={t`No sequencing run column. That is fine: it is optional.`}
            stepId="sequencing"
            known={sequencing}
            things={t({
              message: "runs",
              comment: "Sequencing runs, in: The Sequencing step has no runs yet.",
            })}
          />
        </dl>
        {notices.map((notice) => (
          <Callout key={notice.message} tone={notice.severity === "info" ? "info" : "warning"}>
            {notice.message}
          </Callout>
        ))}
      </div>
    </Card>
  );
}

/** What a library sample is and how its table links to the other steps. Shown above the table. */
function Introduction() {
  return (
    <div className="flex max-w-prose flex-col gap-4 text-md text-text">
      <p>
        <Trans>
          A library sample is one sequencing library made from a specimen. A specimen sequenced
          twice has two library samples. The library sample name is the sample name in your allele
          table.
        </Trans>
      </p>
      <div className="flex flex-col gap-2">
        <p>
          <Trans>Each row links to other steps by name:</Trans>
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-base marker:text-text-subtle">
          <li>
            <Trans>
              <span className="font-medium">Specimen name</span> must match a name in the table on
              the Specimens step.
            </Trans>
          </li>
          <li>
            <Trans>
              <span className="font-medium">Panel</span> must match the name of a panel on the Panel
              step.
            </Trans>
          </li>
          <li>
            <Trans>
              <span className="font-medium">Sequencing run</span>, if you have it, must match a run
              on the Sequencing step.
            </Trans>
          </li>
        </ul>
      </div>
      <p className="text-base text-text-muted">
        <Trans>
          Many labs keep specimens and library samples in one sheet. If yours does, add the same
          file here and on the <StepLink step="specimens">Specimens step</StepLink>.
        </Trans>
      </p>
    </div>
  );
}

/** A count with a few of the names. `label` gives the stat's label for the count. */
function countStat(
  names: readonly string[] | null,
  label: (count: number) => string,
): ResultStat[] {
  if (names === null || names.length === 0) return [];
  return [
    {
      label: label(names.length),
      value: names.length,
      hint: listNames(names, 3),
    },
  ];
}

/**
 * The library samples step: what a library sample is, the library sample
 * table, what it refers to on other steps, and the result.
 */
export function LibrarySamplesStep() {
  const mapped = useSlotTable(SLOT);
  const suggestions = useSuggestions();
  const specimenColumn = columnFor(mapped, "specimenName");
  const specimens = readyValues(useColumnValues(mapped?.table ?? null, specimenColumn, NAME_LIMIT));

  return (
    <StepPage stepId="librarySamples">
      <div className="flex flex-col gap-10">
        <Introduction />
        <TableImport
          slot={SLOT}
          label={t`Library sample table`}
          description={t`One row for each sequenced library, with its specimen and panel.`}
        >
          {(matching) => <References mapped={matching.mapped} />}
        </TableImport>
        <SectionResult
          section="librarySamples"
          emptyMessage={t`Nothing here yet. This step is optional. Without it, the samples come from the allele table and all use one panel, so add it if you have several panels.`}
          stats={(summary) => [
            { label: t`Library samples`, value: summary.librarySamples },
            ...(specimens === null || specimens.length === 0
              ? []
              : [{ label: t`Specimens`, value: specimens.length }]),
            ...countStat(suggestions.panelNames, (count) =>
              plural(count, { one: "Panel", other: "Panels" }),
            ),
            ...countStat(suggestions.sequencingNames, (count) =>
              plural(count, { one: "Sequencing run", other: "Sequencing runs" }),
            ),
          ]}
        />
      </div>
    </StepPage>
  );
}
