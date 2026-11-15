import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

import { StepPage } from "@/app/StepPage";
import { StepIntro } from "@/features/records";
import { SectionResult } from "@/features/shared";

import { MethodsPart } from "./MethodsPart";
import { RunsPart } from "./RunsPart";

/**
 * The bioinformatics step: the methods (pipelines and their programs) and
 * the runs that used them, each typed in or imported from a table.
 */
export function BioinformaticsStep() {
  return (
    <StepPage stepId="bioinformatics">
      <div className="flex flex-col gap-12">
        <StepIntro>
          <Trans>
            Optional. This tells readers of the PMO which programs and versions turned the reads
            into alleles, and links each run in the allele table to its pipeline.
          </Trans>
        </StepIntro>
        <MethodsPart />
        <RunsPart />
        <SectionResult
          section="bioinformatics"
          emptyMessage={t`Nothing here yet. Add a method and a run above to add them to the PMO.`}
          stats={(summary) => [
            {
              label: plural(summary.methods.length, { one: "Method", other: "Methods" }),
              value: summary.methods.length,
            },
            {
              label: t({ message: "Steps", comment: "Heading for a count of pipeline steps" }),
              value: summary.methods.reduce((sum, method) => sum + method.steps, 0),
            },
            {
              label: plural(summary.runs, { one: "Run", other: "Runs" }),
              value: summary.runs,
              hint:
                summary.runNames.length > 0 ? summary.runNames.slice(0, 3).join(", ") : undefined,
            },
          ]}
        />
      </div>
    </StepPage>
  );
}
