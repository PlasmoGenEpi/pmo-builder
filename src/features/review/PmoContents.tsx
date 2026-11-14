import type { MergeSummary } from "@/domain/build";
import { Card, Stat } from "@/ui";

import { count } from "./reviewModel";

interface Group {
  readonly title: string;
  readonly stats: readonly { readonly label: string; readonly value: number }[];
}

function groups(summary: MergeSummary): readonly Group[] {
  return [
    {
      title: "Samples",
      stats: [
        { label: "Specimens", value: summary.specimens },
        { label: "Library samples", value: summary.librarySamples },
        { label: "With alleles found", value: summary.librarySamplesWithDetections },
        { label: "With read counts", value: summary.librarySamplesWithReadCounts },
      ],
    },
    {
      title: "Panel",
      stats: [
        { label: "Panels", value: summary.panels },
        { label: "Targets", value: summary.targets },
        { label: "Targets with alleles", value: summary.targetsWithCalls },
        { label: "Genomes", value: summary.genomes },
      ],
    },
    {
      title: "Study and methods",
      stats: [
        { label: "Projects", value: summary.projects },
        { label: "Sequencing runs", value: summary.sequencingRuns },
        { label: "Bioinformatics runs", value: summary.bioinformaticsRuns },
      ],
    },
  ];
}

/** One sentence that reads the main numbers out. */
function lead(summary: MergeSummary): string {
  const samples = `${count(summary.librarySamples, "library sample")} from ${count(summary.specimens, "specimen")}`;
  const found = `alleles found in ${new Intl.NumberFormat("en-US").format(summary.librarySamplesWithDetections)} of them`;
  const targets = `at ${new Intl.NumberFormat("en-US").format(summary.targetsWithCalls)} of the panel's ${count(summary.targets, "target")}`;
  return `${samples}, with ${found} ${targets}.`;
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
            What is in the PMO
          </h2>
          <p className="text-base text-text-muted">
            {summary === null ? "The numbers appear here once a PMO can be built." : lead(summary)}
          </p>
        </div>
        {summary === null ? null : (
          <div className="flex flex-col gap-6">
            {groups(summary).map((group) => (
              <section
                key={group.title}
                aria-label={group.title}
                className="flex flex-col gap-3 border-t border-border pt-4"
              >
                <h3 className="text-sm font-medium text-text-subtle">{group.title}</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                  {group.stats.map((stat) => (
                    <div key={stat.label} data-stat={stat.label}>
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
