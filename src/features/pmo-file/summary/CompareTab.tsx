/**
 * The Compare tab: the open file's specimens grouped by place, time or
 * project, side by side. Every grouping field is optional in PMO, so the tab
 * offers only fields the file has, says how many specimens have each, and
 * keeps specimens without a value as a "Not recorded" group.
 */
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMemo, useState } from "react";

import { useTheme } from "@/app/theme";
import type {
  GroupComparison,
  GroupField,
  GroupKey,
  GroupRow,
  TargetAcrossGroups,
  WorkingPmoRequest,
  WorkingSource,
} from "@/domain/tools/types";
import { intlLocale } from "@/i18n/languages";
import { usePmoQuery } from "@/state";
import {
  Callout,
  Combobox,
  Field,
  SectionHeading,
  Select,
  SERIES,
  Skeleton,
  formatCount,
} from "@/ui";

import { NoAnswer, type NoAnswerReason } from "../NoAnswer";
import { useSettled } from "../useSettled";

import { SortableTable, type SortableColumn } from "./SortableTable";
import { MinReadsField, ViewToolbar } from "./ViewToolbar";

/** What each grouping field is called on screen. */
function fieldName(key: GroupKey): string {
  switch (key) {
    case "collection_country":
      return t`Country`;
    case "geo_admin1":
      return t`Administrative area, level 1`;
    case "geo_admin2":
      return t`Administrative area, level 2`;
    case "geo_admin3":
      return t`Administrative area, level 3`;
    case "collection_year":
      return t`Collection year`;
    case "collection_month":
      return t`Collection month`;
    case "project":
      return t`Project`;
    default:
      return key;
  }
}

function groupName(row: { readonly name: string | null }): string {
  return (
    row.name ?? t({ message: "Not recorded", comment: "Specimens with no value for the field" })
  );
}

function groupColumns(): SortableColumn<GroupRow>[] {
  const percent = new Intl.NumberFormat(intlLocale(), {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const decimal = new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 });
  return [
    { key: "name", label: t`Group`, value: (row) => row.name, render: groupName },
    { key: "specimens", label: t`Specimens`, value: (row) => row.specimens, numeric: true },
    { key: "withData", label: t`Samples with data`, value: (row) => row.withData, numeric: true },
    {
      key: "polyclonal",
      label: t`More than one clone`,
      value: (row) => (row.withData === 0 ? null : row.polyclonal / row.withData),
      render: (row) => (row.withData === 0 ? "–" : percent.format(row.polyclonal / row.withData)),
      numeric: true,
    },
    {
      key: "he",
      label: t`Mean heterozygosity`,
      value: (row) => row.meanHeterozygosity,
      render: (row) =>
        row.meanHeterozygosity === null ? "–" : decimal.format(row.meanHeterozygosity),
      numeric: true,
    },
    { key: "alleles", label: t`Alleles seen`, value: (row) => row.alleles, numeric: true },
  ];
}

/** One target's microhaplotypes, with their frequency in each group as a bar. */
function AllelesByGroup({
  target,
  groups,
}: {
  readonly target: TargetAcrossGroups;
  readonly groups: readonly GroupRow[];
}) {
  const { resolved } = useTheme();
  const percent = new Intl.NumberFormat(intlLocale(), {
    style: "percent",
    maximumFractionDigits: 0,
  });
  return (
    <section
      aria-label={t`Microhaplotype frequencies by group`}
      // Focusable so keyboard users can scroll it.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border focus-visible:outline-offset-0"
    >
      <table
        className="w-full border-collapse text-sm"
        aria-label={t`Microhaplotype frequencies by group`}
      >
        <thead className="bg-surface-subtle">
          <tr>
            <th
              scope="col"
              className="border-b border-border px-3 py-2 text-left font-medium text-text-muted"
            >
              {t`Microhaplotype`}
            </th>
            {groups.map((group) => (
              <th
                key={group.name ?? ""}
                scope="col"
                className="border-b border-border px-3 py-2 text-left font-medium text-text-muted"
              >
                {groupName(group)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {target.alleles.slice(0, 20).map((allele) => (
            <tr key={allele.mhapId} className="border-b border-border last:border-b-0">
              <th
                scope="row"
                className="px-3 py-1.5 text-left font-mono text-xs font-normal text-text-muted"
                title={allele.seq}
              >
                {allele.label.label}
              </th>
              {allele.freqs.map((freq, index) => (
                <td key={groups[index]?.name ?? `none${index}`} className="px-3 py-1.5">
                  {freq === null ? (
                    <span className="text-text-subtle">–</span>
                  ) : freq === 0 ? (
                    <span className="tabular-nums text-text-subtle">{percent.format(0)}</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2.5 rounded-r-[4px]"
                        style={{
                          width: `${Math.max(2, freq * 64)}px`,
                          background: SERIES[resolved],
                        }}
                      />
                      <span className="tabular-nums text-text">{percent.format(freq)}</span>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Specimens per month or year, as bars. */
function Timeline({
  comparison,
  total,
}: {
  readonly comparison: GroupComparison;
  readonly total: number;
}) {
  const { resolved } = useTheme();
  const [hover, setHover] = useState<number | null>(null);
  if (comparison.timeline.length === 0) return null;
  const width = Math.max(360, comparison.timeline.length * 28 + 60);
  const height = 180;
  const pad = { left: 40, bottom: 44, top: 12 };
  const max = Math.max(...comparison.timeline.map((point) => point.specimens));
  const barWidth = (width - pad.left) / comparison.timeline.length;
  const dated = formatCount(comparison.dated);
  const all = formatCount(total);
  const hovered = hover === null ? null : comparison.timeline[hover];
  const hoverPeriod = hovered?.period ?? "";
  const hoverCount = hovered?.specimens ?? 0;
  const every = Math.ceil(comparison.timeline.length / 12);
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title={t`When specimens were collected`}
        description={
          comparison.timelineUnit === "month"
            ? t`Specimens per month of collection.`
            : t`Specimens per year of collection.`
        }
      />
      {comparison.dated < total ? (
        <p className="text-sm text-text-muted">
          {comparison.timelineUnit === "month"
            ? t`${dated} of ${all} specimens have a collection date that gives the month.`
            : t`${dated} of ${all} specimens have a collection date.`}
        </p>
      ) : null}
      <section
        aria-label={t`When specimens were collected`}
        // Focusable so keyboard users can scroll it.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="overflow-x-auto"
      >
        <p className="sr-only">
          {t`A bar chart of specimens per collection period. The figures are in the bars' tooltips and in the group table.`}
        </p>
        <svg width={width} height={height} aria-hidden="true">
          <line
            x1={pad.left}
            x2={width}
            y1={height - pad.bottom}
            y2={height - pad.bottom}
            className="stroke-border-strong"
          />
          <text
            x={pad.left - 8}
            y={pad.top + 4}
            textAnchor="end"
            className="fill-text-muted text-[11px]"
          >
            {max}
          </text>
          {comparison.timeline.map((point, index) => {
            const barHeight = (point.specimens / max) * (height - pad.top - pad.bottom);
            const x = pad.left + index * barWidth + 2;
            return (
              <g
                key={point.period}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={x - 2}
                  y={pad.top}
                  width={barWidth}
                  height={height - pad.top - pad.bottom}
                  fill="transparent"
                />
                {point.specimens === 0 ? null : (
                  <path
                    d={`M${x},${height - pad.bottom} v${-(barHeight - 4)} q0,-4 4,-4 h${barWidth - 12} q4,0 4,4 v${barHeight - 4} z`}
                    fill={SERIES[resolved]}
                    opacity={hover === null || hover === index ? 1 : 0.6}
                  />
                )}
                {index % every === 0 ? (
                  <text
                    x={x + (barWidth - 4) / 2}
                    y={height - pad.bottom + 14}
                    textAnchor="end"
                    transform={`rotate(-40 ${x + (barWidth - 4) / 2} ${height - pad.bottom + 14})`}
                    className="fill-text-muted text-[10px]"
                  >
                    {point.period}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </section>
      <p className="min-h-5 text-sm text-text-muted" aria-live="polite">
        {hovered === null
          ? t`Hover over a bar to see its count.`
          : plural(hoverCount, {
              one: `${hoverPeriod}: # specimen`,
              other: `${hoverPeriod}: # specimens`,
            })}
      </p>
    </section>
  );
}

/** Why there is nothing to compare. */
function NoComparison({ reason }: { readonly reason: NoAnswerReason }) {
  return (
    <NoAnswer
      reason={reason}
      notOpen={t`Open a PMO file to compare groups of its specimens.`}
      noSubset={t`Make one on the Subset tab. Until then, only the original can be compared.`}
      failed={{ title: t`The comparison could not be made`, body: t`Open the file again.` }}
    />
  );
}

/** The groups of one field, side by side, counted in the worker. */
function Comparison({
  source,
  field,
  minReads,
}: {
  readonly source: WorkingSource;
  readonly field: GroupField;
  readonly minReads: number;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const request = useMemo(
    (): WorkingPmoRequest<"groups"> => ({ kind: "groups", source, key: field.key, minReads }),
    [source, field.key, minReads],
  );
  const loaded = usePmoQuery(request);
  const comparison = loaded.kind === "ok" ? loaded.value : null;
  const shownTarget = useMemo(
    () =>
      comparison?.targets.find((item) => item.name === target) ??
      comparison?.targets.toSorted((a, b) => b.alleles.length - a.alleles.length)[0] ??
      null,
    [comparison, target],
  );
  const decimal = new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 });

  if (loaded.kind === "loading") return <Skeleton className="h-64 w-full" />;
  if (loaded.kind !== "ok") return <NoComparison reason={loaded.kind} />;
  const shown = loaded.value;
  return (
    <>
      <section className="flex flex-col gap-4">
        <SectionHeading
          title={t`Groups`}
          description={t`More than one clone is the share of samples with data that have two or more alleles at some target. Mean heterozygosity is over the targets with data in the group.`}
        />
        <SortableTable
          label={t`Groups`}
          columns={groupColumns()}
          rows={shown.groups}
          rowKey={(row) => row.name ?? "\u0000"}
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          title={t`Heterozygosity by target`}
          description={t`Expected heterozygosity of each target in each group: 1 minus the sum of squared allele frequencies.`}
        />
        <SortableTable
          label={t`Heterozygosity by target`}
          columns={[
            { key: "target", label: t`Target`, value: (row: TargetAcrossGroups) => row.name },
            ...shown.groups.map((group, index): SortableColumn<TargetAcrossGroups> => ({
              key: `g${index}`,
              label: groupName(group),
              value: (row) => row.heterozygosity[index] ?? null,
              render: (row) => {
                const value = row.heterozygosity[index];
                return value === null || value === undefined ? "–" : decimal.format(value);
              },
              numeric: true,
            })),
          ]}
          rows={shown.targets}
          rowKey={(row) => row.name}
          onRowSelect={(row) => setTarget(row.name)}
          selectedKey={shownTarget?.name ?? null}
        />
      </section>

      {shownTarget === null ? null : (
        <section className="flex flex-col gap-4">
          <SectionHeading
            title={t`Microhaplotypes by group`}
            description={t`How often each microhaplotype of the chosen target is seen in each group. Choose a target in the table above, or here.`}
          />
          <Field label={t`Target`} className="max-w-md">
            {(control) => (
              <Combobox
                {...control}
                options={shown.targets.map((item) => ({
                  value: item.name,
                  label: item.name,
                }))}
                value={shownTarget.name}
                onChange={(value) => setTarget(value)}
                noneLabel={false}
              />
            )}
          </Field>
          <AllelesByGroup target={shownTarget} groups={shown.groups} />
        </section>
      )}

      <Timeline comparison={shown} total={field.total} />
    </>
  );
}

/** Props for {@link CompareTab}. */
export interface CompareTabProps {
  /** Which PMO to compare the groups of. */
  readonly source: WorkingSource;
  /** The minimum reads for a microhaplotype to count; `null` counts them all. */
  readonly minReads: number | null;
  readonly onMinReadsChange: (value: number | null) => void;
}

/** Specimens grouped by a field the file has, compared side by side. */
export function CompareTab({ source, minReads: minReadsInput, onMinReadsChange }: CompareTabProps) {
  const minReads = useSettled(Math.max(0, minReadsInput ?? 0), 400);
  const fieldsRequest = useMemo(
    (): WorkingPmoRequest<"groupFields"> => ({ kind: "groupFields", source }),
    [source],
  );
  const fields = usePmoQuery(fieldsRequest);
  const [key, setKey] = useState<GroupKey | null>(null);

  if (fields.kind === "loading") return <Skeleton className="h-40 w-full" />;
  if (fields.kind !== "ok") return <NoComparison reason={fields.kind} />;
  const usable = fields.value;
  const chosen = usable.find((field) => field.key === key) ?? usable[0] ?? null;
  if (chosen === null) {
    return (
      <Callout tone="info" title={t`There is nothing to group the specimens by`}>
        <Trans>
          Comparing groups needs specimens with a country, an administrative area, a collection date
          or a project, and at least two different values. This file has none of these.
        </Trans>
      </Callout>
    );
  }

  const present = formatCount(chosen.present);
  const total = formatCount(chosen.total);
  const name = fieldName(chosen.key);

  return (
    <div className="flex flex-col gap-6">
      <ViewToolbar>
        <Field label={t`Group specimens by`} layout="compact" className="min-w-0 max-w-full">
          {(control) => (
            <div className="w-full min-w-0 sm:w-72">
              <Select
                {...control}
                options={usable.map((field) => {
                  const fieldPresent = formatCount(field.present);
                  const fieldTotal = formatCount(field.total);
                  const label = fieldName(field.key);
                  return {
                    value: field.key,
                    label: t`${label} (${fieldPresent} of ${fieldTotal} specimens)`,
                  };
                })}
                value={chosen.key}
                onValueChange={(value) =>
                  setKey(usable.find((field) => field.key === value)?.key ?? null)
                }
              />
            </div>
          )}
        </Field>
        <MinReadsField value={minReadsInput} onValueChange={onMinReadsChange} />
      </ViewToolbar>

      {chosen.present < chosen.total ? (
        <p className="text-sm text-text-muted">
          {t`${present} of ${total} specimens have a value for ${name}. The others are grouped as Not recorded.`}
        </p>
      ) : null}

      <Comparison source={source} field={chosen} minReads={minReads} />
    </div>
  );
}
