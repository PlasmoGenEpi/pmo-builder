import { StepPage } from "@/app/StepPage";
import type { ReadCountsSummary } from "@/domain/build";
import type { RunNameChoice } from "@/domain/draft";
import { RunNameChoice as RunNameField, SectionResult, type ResultStat } from "@/features/shared";
import { TableImport, type ColumnMatching } from "@/features/table-import";
import { useDraftSection, useSectionState, useSuggestions } from "@/state";
import { Badge, SectionHeading } from "@/ui";

const TOTALS = { section: "readCounts", part: "totals" } as const;
const BY_STAGE = { section: "readCounts", part: "byStage" } as const;

/**
 * How the read counts name their bioinformatics run. Offers run names from
 * the Bioinformatics step and the allele table.
 */
function TotalsRunName({ matching }: { readonly matching: ColumnMatching }) {
  const typed = useSectionState("bioinformatics")?.summary?.runNames ?? [];
  const { runNames } = useSuggestions();
  return (
    <RunNameField
      section="readCounts"
      matching={matching}
      headingLevel={3}
      description="The analysis run these counts come from. Use the same name as on the Bioinformatics step to link them."
      modeDescriptions={{
        none: "The counts are not tied to an analysis run.",
        fixed: "Every count came from the same analysis run.",
        column: "The totals table holds several runs, with the run name in one column.",
      }}
      tableName="totals table"
      knownNames={[...typed, ...runNames]}
      knownLabel="Run names already given:"
    />
  );
}

/** The first few names, then "and N more". */
function listNames(names: readonly string[], shown = 4): string {
  const first = names.slice(0, shown);
  const more = names.length - first.length;
  return more > 0 ? `${first.join(", ")} and ${more} more` : first.join(", ");
}

function stats(summary: ReadCountsSummary, runName: RunNameChoice): ResultStat[] {
  const result: ResultStat[] = [
    { label: "Samples", value: summary.librarySamples, hint: "With read counts" },
    {
      label: "Stages",
      value: summary.stages.length,
      hint: summary.stages.length === 0 ? "Totals only" : listNames(summary.stages),
    },
  ];
  if (runName.mode === "fixed") {
    result.push({ label: "Run", value: 1, hint: runName.fixedName.trim() });
  } else if (runName.mode === "column") {
    result.push({ label: summary.runs === 1 ? "Run" : "Runs", value: summary.runs });
  }
  return result;
}

/**
 * The read counts step: what the counts are for, the totals table with the
 * run name, then the optional by-stage table once the totals are there, and
 * the result.
 */
export function ReadCountsStep() {
  const { totals, byStage, runName } = useDraftSection("readCounts");
  const showByStage = totals !== null || byStage !== null;

  return (
    <StepPage stepId="readCounts">
      <div className="flex flex-col gap-10">
        <div className="flex max-w-prose flex-col gap-4 text-md text-text">
          <p>
            Read counts show how many reads each sample had when it came off the sequencer, and, if
            you have them, how many were left for each target after each stage of your pipeline.
            Others use them to judge how deep and how clean each sample's data is.
          </p>
          <p className="text-base text-text-muted">
            This step is optional. To use it, add a table of total reads per sample. The reads at
            each stage are a second, optional table.
          </p>
        </div>

        <section aria-labelledby="totals-heading" className="flex flex-col gap-6">
          <SectionHeading
            id="totals-heading"
            title="Total reads per sample"
            description="Needed for this step. One row for each sample, with its sample name and its number of raw reads."
          />
          <TableImport
            slot={TOTALS}
            label="Totals table"
            headingLevel={3}
            description="One row for each sample, with its total raw reads."
          >
            {(matching) => <TotalsRunName matching={matching} />}
          </TableImport>
        </section>

        <section aria-labelledby="by-stage-heading" className="flex flex-col gap-6">
          <SectionHeading
            id="by-stage-heading"
            title={
              <span className="flex flex-wrap items-center gap-2">
                Reads at each stage <Badge>Optional</Badge>
              </span>
            }
            description="One row for each sample, target and pipeline stage, with the reads left at that stage."
          />
          {showByStage ? (
            <TableImport
              slot={BY_STAGE}
              label="By-stage table"
              headingLevel={3}
              description="One row for each sample, target and stage, such as demultiplexed or filtered."
            />
          ) : (
            <p className="max-w-prose rounded-lg border border-dashed border-border px-4 py-3 text-base text-text-muted">
              Add the totals table first. You can then add reads at each stage here, if your
              pipeline reports them.
            </p>
          )}
        </section>

        <SectionResult
          section="readCounts"
          emptyMessage="Nothing here yet. This step is optional: skip it if you do not have read counts."
          stats={(summary) => stats(summary, runName)}
        />
      </div>
    </StepPage>
  );
}
