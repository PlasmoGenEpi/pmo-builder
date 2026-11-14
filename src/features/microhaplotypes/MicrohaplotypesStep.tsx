import { useCallback } from "react";

import { StepPage } from "@/app/StepPage";
import type { ColumnMapping } from "@/domain/types";
import { RunNameChoice, SectionResult } from "@/features/shared";
import { TableImport, type ColumnMatching } from "@/features/table-import";
import { useActions, useDraftSection, useSectionState } from "@/state";
import { Checkbox, SectionHeading } from "@/ui";

const SLOT = { section: "microhaplotypes" } as const;
const LABEL = "Allele table";

/**
 * How the allele table names its bioinformatics run. Offers run names typed
 * on the Bioinformatics step.
 */
function AlleleRunName({ matching }: { readonly matching: ColumnMatching }) {
  const runNames = useSectionState("bioinformatics")?.summary?.runNames ?? [];
  return (
    <RunNameChoice
      section="microhaplotypes"
      matching={matching}
      description="The analysis run that produced this table. The same name links it to a run on the Bioinformatics step."
      modeDescriptions={{
        none: "The PMO does not say which analysis run found these alleles.",
        fixed: "Every row came from the same analysis run.",
        column: "The table holds several runs, with the run name in one column.",
      }}
      tableName="allele table"
      knownNames={runNames}
      knownLabel="From the Bioinformatics step:"
    />
  );
}

/**
 * Which extra columns describe the allele itself rather than one sample's
 * detection of it. Shown when at least one extra column is carried.
 */
function AlleleColumns({ matching }: { readonly matching: ColumnMatching }) {
  const { representativeColumns } = useDraftSection("microhaplotypes");
  const actions = useActions();
  const extra = matching.mapped.mapping.additionalColumns;
  if (extra.length === 0) return null;
  const chosen = new Set(representativeColumns);
  return (
    <section aria-labelledby="allele-columns-heading" className="flex flex-col gap-4">
      <SectionHeading
        id="allele-columns-heading"
        title="Where extra columns go"
        description="Extra columns are stored with each detection: one sample's reads of one allele. Tick the ones that describe the allele itself, the same in every sample, to store them once with the allele instead."
      />
      <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {extra.map((column) => (
          <li key={column} className="min-w-0">
            <Checkbox
              label={<span className="font-mono text-sm break-all">{column}</span>}
              description={
                chosen.has(column) ? "Stored with the allele" : "Stored with each detection"
              }
              checked={chosen.has(column)}
              onCheckedChange={(checked) =>
                actions.updateSection("microhaplotypes", (current) => ({
                  ...current,
                  representativeColumns: checked
                    ? [...current.representativeColumns.filter((c) => c !== column), column]
                    : current.representativeColumns.filter((c) => c !== column),
                }))
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The microhaplotypes step: the allele table, its column matches, the
 * bioinformatics run name and where extra columns go, then the result.
 * The reference for steps built on `@/features/table-import`.
 */
export function MicrohaplotypesStep() {
  const actions = useActions();
  // Allele columns must stay among the extra columns; forget any that leave.
  const keepAlleleColumns = useCallback(
    (mapping: ColumnMapping) =>
      actions.updateSection("microhaplotypes", (current) => {
        const kept = current.representativeColumns.filter((column) =>
          mapping.additionalColumns.includes(column),
        );
        return kept.length === current.representativeColumns.length
          ? current
          : { ...current, representativeColumns: kept };
      }),
    [actions],
  );

  return (
    <StepPage stepId="microhaplotypes">
      <div className="flex flex-col gap-10">
        <TableImport
          slot={SLOT}
          label={LABEL}
          description="One row for each allele found in each sample, with its read count."
          onMappingChange={keepAlleleColumns}
        >
          {(matching) => (
            <>
              <AlleleRunName matching={matching} />
              <AlleleColumns matching={matching} />
            </>
          )}
        </TableImport>
        <SectionResult
          section="microhaplotypes"
          emptyMessage="Nothing here yet. Add your allele table above to see what goes into the PMO."
          stats={(summary) => [
            { label: "Library samples", value: summary.librarySamples },
            { label: "Targets", value: summary.targets },
            { label: "Distinct alleles", value: summary.microhaplotypes },
            {
              label: "Rows read",
              value: summary.rows,
              hint:
                summary.runNames.length === 0
                  ? undefined
                  : `${summary.runNames.length} ${summary.runNames.length === 1 ? "run" : "runs"}`,
            },
          ]}
        />
      </div>
    </StepPage>
  );
}
