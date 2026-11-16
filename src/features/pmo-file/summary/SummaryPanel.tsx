import { plural, t } from "@lingui/core/macro";
import { useMemo, useState } from "react";

import type {
  ControlKind,
  PmoSummary,
  SampleSummary,
  TargetSummary,
  WorkingPmoRequest,
  WorkingSource,
} from "@/domain/tools/types";
import { intlLocale } from "@/i18n/languages";
import { useWorkingPmoQuery } from "@/state";
import { Card, SectionHeading, Skeleton, Stat, Switch, formatCount } from "@/ui";

import { AlleleBars } from "./AlleleBars";
import {
  ControlsCheck,
  DensityView,
  PlateView,
  StagesView,
  showsDensity,
  showsPlates,
  showsStages,
} from "./QualityViews";
import { ReadsGrid } from "./ReadsGrid";
import { SortableTable, type SortableColumn } from "./SortableTable";
import { NoAnswer } from "../NoAnswer";
import { useSettled } from "../useSettled";

import { MinReadsField, SectionJumps, ViewToolbar, type Jump } from "./ViewToolbar";

function sampleColumns(summary: PmoSummary): SortableColumn<SampleSummary>[] {
  return [
    { key: "name", label: t`Library sample`, value: (row) => row.name },
    { key: "specimen", label: t`Specimen`, value: (row) => row.specimen },
    ...(summary.runs > 1
      ? [{ key: "run", label: t`Run`, value: (row: SampleSummary) => row.run || null }]
      : []),
    { key: "targets", label: t`Targets with data`, value: (row) => row.targets, numeric: true },
    {
      key: "reads",
      label: t`Reads`,
      value: (row) => row.reads,
      render: (row) => formatCount(row.reads),
      numeric: true,
    },
    {
      key: "maxAlleles",
      label: t`Most alleles at a target`,
      value: (row) => row.maxAlleles,
      numeric: true,
    },
    // Optional in PMO: each column shows only when some sample has the field.
    ...(summary.samples.some((row) => row.control !== null)
      ? [
          {
            key: "control",
            label: t`Control`,
            value: (row: SampleSummary) => (row.control === null ? null : controlName(row.control)),
          },
        ]
      : []),
    ...(summary.samples.some((row) => row.plate !== null)
      ? [
          {
            key: "plate",
            label: t`Plate well`,
            value: (row: SampleSummary) =>
              row.plate === null ? null : `${row.plate.plate} ${row.plate.row}${row.plate.col}`,
          },
        ]
      : []),
    ...(summary.samples.some((row) => row.density !== null)
      ? [
          {
            key: "density",
            label: t`Parasites per µL`,
            value: (row: SampleSummary) => row.density?.value ?? null,
            render: (row: SampleSummary) =>
              row.density === null ? "–" : formatCount(Math.round(row.density.value)),
            numeric: true,
          },
        ]
      : []),
  ];
}

/** The ids of the Summary's section headings. */
const HEADING = {
  reads: "summary-reads",
  samples: "summary-samples",
  targets: "summary-targets",
  plates: "summary-plates",
  density: "summary-density",
  stages: "summary-stages",
} as const;

/** The sections this summary shows, to jump to. */
function jumpsOf(summary: PmoSummary): Jump[] {
  return [
    {
      id: HEADING.reads,
      label: t({
        message: "Reads grid",
        comment: "Short name of the section 'Reads by sample and target'",
      }),
    },
    { id: HEADING.samples, label: t`Samples` },
    {
      id: HEADING.targets,
      label: t({ message: "Targets and alleles", comment: "Short name of the Targets section" }),
    },
    ...(showsPlates(summary) ? [{ id: HEADING.plates, label: t`Plates` }] : []),
    ...(showsDensity(summary)
      ? [
          {
            id: HEADING.density,
            label: t({
              message: "Parasite density",
              comment: "Short name of the section 'Parasite density and targets with data'",
            }),
          },
        ]
      : []),
    ...(showsStages(summary)
      ? [
          {
            id: HEADING.stages,
            label: t({
              message: "Pipeline stages",
              comment: "Short name of the section 'Reads at each pipeline stage'",
            }),
          },
        ]
      : []),
  ];
}

function controlName(kind: ControlKind): string {
  switch (kind) {
    case "negative":
      return t({ message: "Negative", comment: "A negative control" });
    case "positive":
      return t({ message: "Positive", comment: "A positive control" });
    case "other":
    default:
      return t({ message: "Other", comment: "A control that is neither negative nor positive" });
  }
}

/** The grid's columns in reaction order, with a heading per reaction that has any. */
function byReaction(
  summary: PmoSummary,
  shown: readonly number[],
): { readonly columns: number[]; readonly groups: { label: string; count: number }[] } {
  const visible = new Set(shown);
  const placed = new Set<number>();
  const columns: number[] = [];
  const groups: { label: string; count: number }[] = [];
  const panels = new Set(summary.reactions.map((reaction) => reaction.panel)).size;
  for (const reaction of summary.reactions) {
    const mine = reaction.targets.filter((target) => visible.has(target) && !placed.has(target));
    if (mine.length === 0) continue;
    for (const target of mine) placed.add(target);
    columns.push(...mine);
    groups.push({
      label: panels > 1 ? `${reaction.panel} · ${reaction.name}` : reaction.name,
      count: mine.length,
    });
  }
  const rest = shown.filter((target) => !placed.has(target));
  if (rest.length > 0) {
    columns.push(...rest);
    groups.push({ label: t`In no reaction`, count: rest.length });
  }
  return { columns, groups };
}

function targetColumns(): SortableColumn<TargetSummary>[] {
  const decimal = new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 });
  return [
    { key: "name", label: t`Target`, value: (row) => row.name },
    { key: "samples", label: t`Samples with data`, value: (row) => row.samples, numeric: true },
    { key: "alleles", label: t`Alleles`, value: (row) => row.alleles.length, numeric: true },
    {
      key: "heterozygosity",
      label: t`Heterozygosity`,
      value: (row) => row.heterozygosity,
      render: (row) => (row.heterozygosity === null ? "–" : decimal.format(row.heterozygosity)),
      numeric: true,
    },
  ];
}

function Headline({ summary }: { readonly summary: PmoSummary }) {
  const { headline } = summary;
  const all = formatCount(summary.librarySamples);
  const targets = formatCount(summary.targets.length);
  const medianReads = formatCount(Math.round(headline.medianReads ?? 0));
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label={t`Samples with data`}
        value={formatCount(headline.samplesWithData)}
        hint={t`of ${all}`}
      />
      <Stat
        label={t`Targets with data`}
        value={formatCount(headline.targetsWithData)}
        hint={t`of ${targets}`}
      />
      <Stat
        label={t`Median targets per sample`}
        value={headline.medianTargets === null ? "–" : formatCount(headline.medianTargets)}
        hint={
          headline.medianReads === null ? undefined : t`Median reads per sample: ${medianReads}`
        }
      />
      <Stat
        label={t`Samples with more than one clone`}
        value={formatCount(headline.polyclonal)}
        hint={t`Two or more alleles at some target`}
      />
    </div>
  );
}

/** Props for {@link SummaryPanel}. */
export interface SummaryPanelProps {
  /** Which PMO to sum up. */
  readonly source: WorkingSource;
  /** The minimum reads for a microhaplotype to count; `null` counts them all. */
  readonly minReads: number | null;
  readonly onMinReadsChange: (value: number | null) => void;
}

/**
 * The Summary tab: headline numbers, the reads grid, and per-sample and
 * per-target tables, with each target's allele frequencies. One read
 * threshold applies throughout. Counted in the worker.
 */
export function SummaryPanel({
  source,
  minReads: minReadsInput,
  onMinReadsChange,
}: SummaryPanelProps) {
  const minReads = useSettled(Math.max(0, minReadsInput ?? 0), 400);
  const [allTargets, setAllTargets] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const request = useMemo(
    (): WorkingPmoRequest<"summary"> => ({ kind: "summary", source, minReads }),
    [source, minReads],
  );
  const loaded = useWorkingPmoQuery(request);

  const summary = loaded.kind === "ok" ? loaded.value : null;
  const columns = useMemo(
    () =>
      summary === null
        ? []
        : summary.targets.flatMap((target, index) =>
            allTargets || target.samples > 0 ? [index] : [],
          ),
    [summary, allTargets],
  );
  const reactionsWithData =
    summary === null
      ? 0
      : summary.reactions.filter((reaction) =>
          reaction.targets.some((target) => columns.includes(target)),
        ).length;
  const grid = useMemo(
    () =>
      summary !== null && grouped && reactionsWithData > 1
        ? byReaction(summary, columns)
        : { columns: [...columns], groups: undefined },
    [summary, grouped, reactionsWithData, columns],
  );
  const targetsWithData = summary?.headline.targetsWithData ?? 0;
  const chosenTarget =
    summary?.targets.find((target) => target.name === selected) ??
    summary?.targets.toSorted((a, b) => b.samples - a.samples)[0] ??
    null;

  return (
    <div className="flex flex-col gap-8">
      <ViewToolbar>
        <MinReadsField value={minReadsInput} onValueChange={onMinReadsChange} />
        {summary === null ? null : <SectionJumps jumps={jumpsOf(summary)} />}
      </ViewToolbar>

      {loaded.kind === "ok" || loaded.kind === "loading" ? null : (
        <NoAnswer
          reason={loaded.kind}
          notOpen={t`Open a PMO file to see its summary.`}
          noSubset={t`Make one on the Subset tab, or sum up the whole file.`}
          failed={{ title: t`The summary could not be made`, body: t`Open the file again.` }}
        />
      )}

      {summary === null ? (
        loaded.kind === "loading" ? (
          <output className="flex flex-col gap-4" aria-busy="true" aria-label={t`Counting`}>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-64 w-full" />
          </output>
        ) : null
      ) : (
        <>
          <Headline summary={summary} />
          <ControlsCheck summary={summary} />

          <section className="flex flex-col gap-4">
            <SectionHeading
              id={HEADING.reads}
              title={t`Reads by sample and target`}
              description={t`Each row is a library sample and each column a target. The colour shows the reads, as in the legend below the grid. Hover over a cell to see its numbers.`}
              actions={
                <div className="flex flex-wrap items-center gap-4">
                  {reactionsWithData > 1 ? (
                    <Switch
                      label={t`Group targets by reaction`}
                      checked={grouped}
                      onCheckedChange={setGrouped}
                    />
                  ) : null}
                  <Switch
                    label={t`Show targets with no data`}
                    checked={allTargets}
                    onCheckedChange={setAllTargets}
                  />
                </div>
              }
            />
            {summary.samples.length === 0 ? (
              <p className="text-base text-text-muted">{t`No sample has any reads to show.`}</p>
            ) : (
              <ReadsGrid summary={summary} columns={grid.columns} groups={grid.groups} />
            )}
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeading
              id={HEADING.samples}
              title={t`Samples`}
              description={t`The most alleles a sample has at one target is a simple estimate of how many clones it carries.`}
            />
            <SortableTable
              label={t`Samples`}
              columns={sampleColumns(summary)}
              rows={summary.samples}
              rowKey={(row) => `${row.run}\u0000${row.name}`}
              initialSort={{ key: "reads", descending: false }}
            />
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeading
              id={HEADING.targets}
              title={t`Targets`}
              description={plural(targetsWithData, {
                one: "Choose a target to see its alleles. # target has data. Heterozygosity is 1 minus the sum of squared allele frequencies.",
                other:
                  "Choose a target to see its alleles. # targets have data. Heterozygosity is 1 minus the sum of squared allele frequencies.",
              })}
            />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <SortableTable
                label={t`Targets`}
                columns={targetColumns()}
                rows={summary.targets.filter((target) => allTargets || target.samples > 0)}
                rowKey={(row) => row.name}
                onRowSelect={(row) => setSelected(row.name)}
                selectedKey={chosenTarget?.name ?? null}
                initialSort={{ key: "samples", descending: true }}
              />
              <Card padding="md">
                {chosenTarget === null ? null : <AlleleBars target={chosenTarget} />}
              </Card>
            </div>
          </section>

          <PlateView summary={summary} headingId={HEADING.plates} />
          <DensityView summary={summary} headingId={HEADING.density} />
          <StagesView summary={summary} headingId={HEADING.stages} />
        </>
      )}
    </div>
  );
}
