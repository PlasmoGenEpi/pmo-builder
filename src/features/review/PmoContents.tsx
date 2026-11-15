import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

import type { MergeSummary } from "@/domain/build";
import { Card, Stat, formatCount } from "@/ui";

interface Group {
  /** Stays English: a key and a test id. */
  readonly id: string;
  readonly title: string;
  readonly stats: readonly {
    /** Stays English: a key and a test id. */
    readonly id: string;
    readonly label: string;
    readonly value: number;
  }[];
}

function groups(summary: MergeSummary): readonly Group[] {
  return [
    {
      id: "Samples",
      title: t`Samples`,
      stats: [
        { id: "Specimens", label: t`Specimens`, value: summary.specimens },
        { id: "Library samples", label: t`Library samples`, value: summary.librarySamples },
        {
          id: "With alleles found",
          label: t`With alleles found`,
          value: summary.librarySamplesWithDetections,
        },
        {
          id: "With read counts",
          label: t`With read counts`,
          value: summary.librarySamplesWithReadCounts,
        },
      ],
    },
    {
      id: "Panel",
      title: t`Panel`,
      stats: [
        { id: "Panels", label: t`Panels`, value: summary.panels },
        { id: "Targets", label: t`Targets`, value: summary.targets },
        {
          id: "Targets with alleles",
          label: t`Targets with alleles`,
          value: summary.targetsWithCalls,
        },
        { id: "Genomes", label: t`Genomes`, value: summary.genomes },
      ],
    },
    {
      id: "Study and methods",
      title: t`Study and methods`,
      stats: [
        { id: "Projects", label: t`Projects`, value: summary.projects },
        { id: "Sequencing runs", label: t`Sequencing runs`, value: summary.sequencingRuns },
        {
          id: "Bioinformatics runs",
          label: t`Bioinformatics runs`,
          value: summary.bioinformaticsRuns,
        },
      ],
    },
  ];
}

/** One sentence that reads the main numbers out. */
function lead(summary: MergeSummary): string {
  const librarySamples = summary.librarySamples;
  const specimens = summary.specimens;
  const targets = summary.targets;
  const samplesWithAlleles = formatCount(summary.librarySamplesWithDetections);
  const targetsWithAlleles = formatCount(summary.targetsWithCalls);
  return t`${plural(librarySamples, { one: "# library sample", other: "# library samples" })} from ${plural(specimens, { one: "# specimen", other: "# specimens" })}, with alleles found in ${samplesWithAlleles} of them at ${targetsWithAlleles} of the panel's ${plural(targets, { one: "# target", other: "# targets" })}.`;
}

/** What the built PMO holds: a sentence, then the merge summary numbers in three groups. */
export function PmoContents({ summary }: { readonly summary: MergeSummary | null }) {
  return (
    <Card as="section" aria-labelledby="review-contents-heading">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2
            id="review-contents-heading"
            className="text-lg font-semibold tracking-tight text-text"
          >
            <Trans>What is in the PMO</Trans>
          </h2>
          <p className="text-base text-text-muted">
            {summary === null ? t`The numbers appear here once a PMO can be built.` : lead(summary)}
          </p>
        </div>
        {summary === null ? null : (
          <div className="flex flex-col gap-6">
            {groups(summary).map((group) => (
              <section
                key={group.id}
                aria-label={group.title}
                className="flex flex-col gap-3 border-t border-border pt-4"
              >
                <h3 className="text-sm font-medium text-text-subtle">{group.title}</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                  {group.stats.map((stat) => (
                    <div key={stat.id} data-stat={stat.id}>
                      <Stat label={stat.label} value={stat.value} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
