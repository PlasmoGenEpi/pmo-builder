/**
 * The Compare tab: the open file's specimens grouped by place, time or
 * project, side by side. Every grouping field is optional in PMO, so the tab
 * offers only fields the file has, says how many specimens have each, and
 * keeps specimens without a value as a "Not recorded" group.
 */
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowUp, ChevronLeft, ChevronRight, TriangleExclamationPoint } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

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
  Button,
  Callout,
  Combobox,
  Field,
  SectionHeading,
  Select,
  SEQUENTIAL_CELL,
  SERIES,
  Skeleton,
  cn,
  formatCount,
  jumpToHeading,
  rampColour,
} from "@/ui";

import { NoAnswer, type NoAnswerReason } from "../NoAnswer";
import { specimenFieldLabel } from "../specimenFieldNames";
import { useSettled } from "../useSettled";

import { SequenceLabel } from "./SequenceLabel";
import { SortableTable, type SortableColumn } from "./SortableTable";
import {
  MinReadsField,
  NoReadsAboveMinimum,
  SectionJumps,
  ViewToolbar,
  type Jump,
} from "./ViewToolbar";

/** The ids of the Compare tab's section headings. */
const HEADING = {
  groups: "compare-groups",
  heterozygosity: "compare-heterozygosity",
  alleles: "compare-alleles",
  timeline: "compare-timeline",
} as const;

/** The sections this comparison shows, to jump to. */
function jumpsOf(comparison: GroupComparison, hasTarget: boolean): Jump[] {
  return [
    { id: HEADING.groups, label: t`Groups` },
    { id: HEADING.heterozygosity, label: t`Heterozygosity by target` },
    ...(hasTarget ? [{ id: HEADING.alleles, label: t`Microhaplotypes by group` }] : []),
    ...(comparison.timeline.length > 0
      ? [
          {
            id: HEADING.timeline,
            label: t({
              message: "Collection timeline",
              comment: "Short name of the section 'When specimens were collected'",
            }),
          },
        ]
      : []),
  ];
}

function groupName(row: { readonly name: string | null }): string {
  return (
    row.name ?? t({ message: "Not recorded", comment: "Specimens with no value for the field" })
  );
}

const SMALL_GROUP_THRESHOLD = 10;

function isSmallGroup(group: GroupRow): boolean {
  return group.withData < SMALL_GROUP_THRESHOLD;
}

function smallGroupLabel(): string {
  const threshold = formatCount(SMALL_GROUP_THRESHOLD);
  return t({
    message: `Small group (fewer than ${threshold} samples with data)`,
    comment:
      "Accessible explanation on a warning mark next to a small group; {threshold} is a sample count such as 10",
  });
}

/** Warning mark shown beside groups with fewer than {@link SMALL_GROUP_THRESHOLD} samples with data. */
function SmallGroupMark() {
  const label = smallGroupLabel();
  return (
    <span className="inline-flex items-center text-warning-text" title={label}>
      <TriangleExclamationPoint aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Sample count and small-group mark shown under a group's column heading. */
function GroupSizeNote({ group }: { readonly group: GroupRow }) {
  const sampleCount = group.withData;
  const count = formatCount(sampleCount);
  const fullCount = plural(sampleCount, {
    one: "# sample with data",
    other: "# samples with data",
  });
  const small = isSmallGroup(group);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-normal tabular-nums",
        small ? "text-warning-text" : "text-text-subtle",
      )}
    >
      <span aria-hidden="true">
        {t({
          message: `n = ${count}`,
          comment: "Compact sample count in a table column heading, e.g. n = 14",
        })}
      </span>
      <span className="sr-only">{fullCount}</span>
      {small ? (
        <>
          <span className="sr-only">, </span>
          <SmallGroupMark />
        </>
      ) : null}
    </span>
  );
}

function groupColumns(): SortableColumn<GroupRow>[] {
  const percent = new Intl.NumberFormat(intlLocale(), {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const decimal = new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 2 });
  return [
    {
      key: "name",
      label: t`Group`,
      value: (row) => row.name,
      render: (row) =>
        isSmallGroup(row) ? (
          <span className="inline-flex items-center gap-1.5">
            <span>{groupName(row)}</span>
            <span className="sr-only">, </span>
            <SmallGroupMark />
          </span>
        ) : (
          groupName(row)
        ),
    },
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

const MAX_ALLELES = 20;

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
  const shown = target.alleles.slice(0, MAX_ALLELES);
  const hiddenByLimit = target.alleles.length - shown.length;
  const maxFreq = shown.reduce((largest, allele) => {
    let next = largest;
    for (const freq of allele.freqs) {
      if (freq !== null && freq > next) next = freq;
    }
    return next;
  }, 0);

  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label={t`Microhaplotype frequencies by group`}
        // Focusable so keyboard users can scroll it.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="max-h-112 overflow-auto rounded-lg border border-border bg-surface focus-visible:outline-offset-0"
      >
        <table
          className="w-full border-separate border-spacing-0 text-sm"
          aria-label={t`Microhaplotype frequencies by group`}
        >
          <thead className="bg-surface-subtle">
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-30 min-w-32 border-r border-b border-border bg-surface-subtle px-3 py-2 align-bottom text-left font-medium text-text-muted"
              >
                {t`Microhaplotype`}
              </th>
              {groups.map((group) => (
                <th
                  key={group.name ?? ""}
                  scope="col"
                  className="sticky top-0 z-20 min-w-32 border-b border-border bg-surface-subtle px-3 py-2 align-bottom text-left font-medium text-text-muted"
                >
                  <div>{groupName(group)}</div>
                  <div className="mt-0.5 text-xs font-normal">
                    <GroupSizeNote group={group} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((allele) => (
              <tr key={allele.mhapId} className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-32 border-r border-b border-border bg-surface px-3 py-1.5 text-left font-mono text-xs font-normal text-text-muted group-last:border-b-0"
                >
                  <SequenceLabel
                    label={allele.label.label === "" ? `#${allele.mhapId}` : allele.label.label}
                    seq={allele.seq}
                    note={allele.label.note}
                    className="-mx-2.5 max-w-48"
                  />
                </th>
                {allele.freqs.map((freq, index) => (
                  <td
                    key={groups[index]?.name ?? `none${index}`}
                    className="min-w-32 border-b border-border bg-surface px-3 py-1.5 group-last:border-b-0"
                  >
                    {freq === null ? (
                      <span className="block text-right text-text-subtle">–</span>
                    ) : freq === 0 ? (
                      <span className="block text-right tabular-nums text-text-subtle">
                        {percent.format(0)}
                      </span>
                    ) : (
                      <span className="flex w-full items-center gap-2">
                        <span className="block h-2.5 flex-1 overflow-hidden rounded-sm bg-surface-subtle">
                          <span
                            aria-hidden="true"
                            className="block h-full min-w-0.5 rounded-r-sm"
                            style={{
                              width: `${maxFreq > 0 ? (freq / maxFreq) * 100 : 0}%`,
                              background: SERIES[resolved],
                            }}
                          />
                        </span>
                        <span className="w-11 shrink-0 text-right tabular-nums text-text">
                          {percent.format(freq)}
                        </span>
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {hiddenByLimit > 0 ? (
        <p className="text-sm text-text-muted">
          {plural(hiddenByLimit, {
            one: "# rarer microhaplotype is not shown.",
            other: "# rarer microhaplotypes are not shown.",
          })}
        </p>
      ) : null}
    </div>
  );
}

const TIMELINE_HEIGHT = 180;
const TIMELINE_PAD = { left: 40, right: 12, bottom: 44, top: 12 } as const;
const MIN_TIMELINE_SLOT = 14;
const PREFERRED_TIMELINE_SLOT = 28;
const MIN_TIMELINE_FALLBACK = 360;

/** Rounded-top bar path drawn strictly above `axisY`, never inverting when shorter than its corner radius. */
function timelineBarPath(options: {
  readonly x: number;
  readonly axisY: number;
  readonly width: number;
  readonly height: number;
}): string {
  const { x, axisY, width, height } = options;
  const radius = Math.min(4, height, width / 2);
  const straightY = height - radius;
  const topWidth = width - radius * 2;
  return `M${x},${axisY} v${-straightY} q0,${-radius} ${radius},${-radius} h${topWidth} q${radius},0 ${radius},${radius} v${straightY} z`;
}

function periodCountLabel(period: string, specimens: number): string {
  return plural(specimens, {
    one: `${period}: # specimen`,
    other: `${period}: # specimens`,
  });
}

/** Props for {@link Timeline}. */
export interface TimelineProps {
  /** The comparison whose collection timeline to plot. */
  readonly comparison: GroupComparison;
  /** Total specimens in the file, to note how many carry a collection date. */
  readonly total: number;
  /** Optional heading id for in-page jump links. */
  readonly headingId?: string;
}

/** Specimens per month or year, as an accessible bar chart. */
export function Timeline({ comparison, total, headingId }: TimelineProps) {
  const { resolved } = useTheme();
  const [hover, setHover] = useState<number | null>(null);
  const [roving, setRoving] = useState(0);
  const scroller = useRef<HTMLElement>(null);
  const chart = useRef<SVGSVGElement>(null);
  const barRefs = useRef<Map<number, SVGRectElement>>(new Map());
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [overflow, setOverflow] = useState<{ readonly left: boolean; readonly right: boolean }>({
    left: false,
    right: false,
  });

  const count = comparison.timeline.length;
  const minContentWidth = TIMELINE_PAD.left + TIMELINE_PAD.right + count * MIN_TIMELINE_SLOT;
  const preferredWidth = Math.max(
    MIN_TIMELINE_FALLBACK,
    TIMELINE_PAD.left + TIMELINE_PAD.right + count * PREFERRED_TIMELINE_SLOT,
  );
  const width =
    containerWidth === null || containerWidth <= 0
      ? preferredWidth
      : minContentWidth > containerWidth
        ? Math.ceil(minContentWidth)
        : Math.min(containerWidth, preferredWidth);

  const syncScroll = useCallback(() => {
    const element = scroller.current;
    if (element === null) return;
    const left = element.scrollLeft > 1;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setOverflow((previous) =>
      previous.left === left && previous.right === right ? previous : { left, right },
    );
  }, []);

  useEffect(() => {
    if (count === 0) return undefined;
    const element = scroller.current;
    const svg = chart.current;
    if (element === null) return undefined;
    const measure = () => {
      const next = Math.floor(element.clientWidth);
      if (next > 0) setContainerWidth((previous) => (previous === next ? previous : next));
      syncScroll();
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (svg !== null) observer.observe(svg);
    return () => observer.disconnect();
  }, [count, syncScroll]);

  useEffect(() => {
    if (hover === null) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setHover(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hover]);

  if (count === 0) return null;

  const setBarRef = (index: number, node: SVGRectElement | null) => {
    if (node === null) {
      barRefs.current.delete(index);
    } else {
      barRefs.current.set(index, node);
    }
  };

  const focusBar = (index: number) => {
    setRoving(index);
    setHover(index);
    const target = barRefs.current.get(index);
    if (target !== undefined) {
      target.focus();
      if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  };

  const handleBarKeyDown = (event: KeyboardEvent<SVGRectElement>, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setHover(null);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setRoving(index);
      setHover(index);
      return;
    }
    let next: number | null = null;
    if (event.key === "ArrowRight") {
      next = Math.min(count - 1, index + 1);
    } else if (event.key === "ArrowLeft") {
      next = Math.max(0, index - 1);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = count - 1;
    }
    if (next === null) return;
    event.preventDefault();
    focusBar(next);
  };

  const height = TIMELINE_HEIGHT;
  const pad = TIMELINE_PAD;
  const axisY = height - pad.bottom;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...comparison.timeline.map((point) => point.specimens));
  const barWidth = (width - pad.left - pad.right) / count;
  const barInset = Math.min(2, barWidth / 4);
  const innerBarWidth = Math.max(2, barWidth - barInset * 2);
  const dated = formatCount(comparison.dated);
  const all = formatCount(total);
  const safeRoving = Math.min(roving, count - 1);
  const hovered = hover === null ? null : (comparison.timeline[hover] ?? null);
  const lastIndex = count - 1;
  const every = Math.max(Math.ceil(count / 12), Math.ceil(36 / barWidth));
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionHeading
        id={headingId}
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
      <div className="relative min-w-0">
        <section
          ref={scroller}
          aria-label={t`When specimens were collected`}
          // Focusable so keyboard users can scroll it.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          onScroll={syncScroll}
          className="overflow-x-auto focus-visible:outline-offset-0"
        >
          <p className="sr-only">
            {t`A bar chart of specimens per collection period. Use the left and right arrow keys to move across bars, or read the counts in the table that follows.`}
          </p>
          <svg ref={chart} width={width} height={height} className="block">
            <line
              aria-hidden="true"
              x1={pad.left}
              x2={width - pad.right}
              y1={axisY}
              y2={axisY}
              className="stroke-border-strong"
            />
            <text
              aria-hidden="true"
              x={pad.left - 8}
              y={pad.top + 4}
              textAnchor="end"
              className="fill-text-muted text-[11px]"
            >
              {formatCount(max)}
            </text>
            {comparison.timeline.map((point, index) => {
              const barHeight = Math.max(2, (point.specimens / max) * plotHeight);
              const slotX = pad.left + index * barWidth;
              const barX = slotX + barInset;
              const labelX = barX + innerBarWidth / 2;
              const showLabel =
                index === lastIndex ||
                (index % every === 0 && (lastIndex - index) * barWidth >= 32);
              const barLabel = periodCountLabel(point.period, point.specimens);
              const isRoving = index === safeRoving;
              const isActive = hovered !== null && hover === index;
              return (
                <g
                  key={point.period}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover((current) => (current === index ? null : current))}
                >
                  <rect
                    ref={(node) => setBarRef(index, node)}
                    // SVG bar hit targets are <rect> shapes inside the chart, not HTML <button>s.
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                    role="button"
                    tabIndex={isRoving ? 0 : -1}
                    aria-label={barLabel}
                    x={slotX}
                    y={pad.top}
                    width={barWidth}
                    height={plotHeight}
                    fill="transparent"
                    className="cursor-pointer focus-visible:outline-offset-0"
                    onClick={() => focusBar(index)}
                    onFocus={() => {
                      setRoving(index);
                      setHover(index);
                    }}
                    onBlur={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (nextTarget instanceof Node && chart.current?.contains(nextTarget)) return;
                      setHover(null);
                    }}
                    onKeyDown={(event) => handleBarKeyDown(event, index)}
                  />
                  {point.specimens === 0 ? null : (
                    <path
                      aria-hidden="true"
                      d={timelineBarPath({
                        x: barX,
                        axisY,
                        width: innerBarWidth,
                        height: barHeight,
                      })}
                      fill={SERIES[resolved]}
                      opacity={hovered === null || isActive ? 1 : 0.6}
                      className="pointer-events-none"
                    />
                  )}
                  {showLabel ? (
                    <text
                      aria-hidden="true"
                      x={labelX}
                      y={axisY + 14}
                      textAnchor="end"
                      transform={`rotate(-40 ${labelX} ${axisY + 14})`}
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
        {overflow.left ? (
          <div
            aria-hidden="true"
            data-continues="left"
            className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-start bg-linear-to-r from-surface via-surface/80 to-transparent pl-1 text-text-muted"
          >
            <ChevronLeft className="size-4" />
          </div>
        ) : null}
        {overflow.right ? (
          <div
            aria-hidden="true"
            data-continues="right"
            className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-linear-to-l from-surface via-surface/80 to-transparent pr-1 text-text-muted"
          >
            <ChevronRight className="size-4" />
          </div>
        ) : null}
      </div>
      <p className="min-h-5 text-sm text-text-muted" aria-live="polite">
        {hovered === null
          ? t`Hover over or select a bar to see its count.`
          : periodCountLabel(hovered.period, hovered.specimens)}
      </p>
      <table className="sr-only" aria-label={t`Specimens per collection period`}>
        <thead>
          <tr>
            <th scope="col">{comparison.timelineUnit === "month" ? t`Month` : t`Year`}</th>
            <th scope="col">{t`Specimens`}</th>
          </tr>
        </thead>
        <tbody>
          {comparison.timeline.map((point) => (
            <tr key={point.period}>
              <th scope="row">{point.period}</th>
              <td>{formatCount(point.specimens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

interface ComparisonGrouping {
  readonly fields: readonly GroupField[];
  readonly field: GroupField;
  readonly onChange: (key: GroupKey | null) => void;
}

interface ComparisonReads {
  readonly min: number;
  readonly input: number | null;
  readonly max: number | null;
  readonly onChange: (value: number | null) => void;
}

interface ComparisonProps {
  readonly source: WorkingSource;
  readonly grouping: ComparisonGrouping;
  readonly reads: ComparisonReads;
}

/** The groups of one field, side by side, counted in the worker. */
function Comparison({ source, grouping, reads }: ComparisonProps) {
  const { fields, field, onChange: onFieldChange } = grouping;
  const { min: minReads, input: minReadsInput, max: maxReads, onChange: onMinReadsChange } = reads;
  const { resolved } = useTheme();
  const minReadsInputRef = useRef<HTMLInputElement>(null);
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
  const nothingPasses = comparison !== null && minReads > 0 && comparison.targets.length === 0;
  const present = formatCount(field.present);
  const total = formatCount(field.total);
  const name = specimenFieldLabel(field.key);
  const hasSmallGroups = comparison?.groups.some(isSmallGroup) ?? false;
  const threshold = formatCount(SMALL_GROUP_THRESHOLD);
  const heterozygosityRamp = SEQUENTIAL_CELL[resolved];

  return (
    <div className="flex flex-col gap-6">
      <ViewToolbar>
        <Field label={t`Group specimens by`} layout="compact" className="min-w-0 max-w-full">
          {(control) => (
            <div className="w-full min-w-0 sm:w-72">
              <Select
                {...control}
                size="sm"
                options={fields.map((candidate) => {
                  const fieldPresent = formatCount(candidate.present);
                  const fieldTotal = formatCount(candidate.total);
                  const label = specimenFieldLabel(candidate.key);
                  return {
                    value: candidate.key,
                    label: t`${label} (${fieldPresent} of ${fieldTotal} specimens)`,
                  };
                })}
                value={field.key}
                onValueChange={(value) =>
                  onFieldChange(fields.find((candidate) => candidate.key === value)?.key ?? null)
                }
              />
            </div>
          )}
        </Field>
        <MinReadsField
          value={minReadsInput}
          maxReads={maxReads}
          onValueChange={onMinReadsChange}
          inputRef={minReadsInputRef}
        />
        {comparison === null || nothingPasses ? null : (
          <SectionJumps jumps={jumpsOf(comparison, shownTarget !== null)} />
        )}
      </ViewToolbar>

      {loaded.kind === "loading" ? (
        <output aria-busy="true" aria-label={t`Loading`}>
          <Skeleton className="h-64 w-full" />
        </output>
      ) : loaded.kind !== "ok" ? (
        <NoComparison reason={loaded.kind} />
      ) : nothingPasses ? (
        <NoReadsAboveMinimum
          minReads={minReads}
          maxReads={maxReads}
          onClear={() => {
            onMinReadsChange(null);
            minReadsInputRef.current?.focus();
          }}
        />
      ) : (
        <>
          {field.present < field.total ? (
            <p className="text-sm text-text-muted">
              {t`${present} of ${total} specimens have a value for ${name}. The others are grouped as Not recorded.`}
            </p>
          ) : null}

          <section className="flex flex-col gap-4">
            <SectionHeading
              id={HEADING.groups}
              title={t`Groups`}
              description={t`More than one clone is the share of samples with data that have two or more alleles at some target. Mean heterozygosity is over the targets with data in the group. Alleles seen is the number of distinct alleles found in the group across targets.`}
            />
            <SortableTable
              label={t`Groups`}
              columns={groupColumns()}
              rows={loaded.value.groups}
              rowKey={(row) => row.name ?? "\u0000"}
            />
            {/* Under the first table that carries the mark, so it does not push the data down. */}
            {hasSmallGroups ? (
              <p className="flex items-start gap-1.5 text-sm text-text-muted">
                <TriangleExclamationPoint
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-warning-text"
                />
                <span>
                  {t({
                    message: `Groups marked with a warning have fewer than ${threshold} samples with data. Read their percentages with care.`,
                    comment: "{threshold} is a number of samples, such as 10",
                  })}
                </span>
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeading
              id={HEADING.heterozygosity}
              title={t`Heterozygosity by target`}
              description={t`Expected heterozygosity of each target in each group: 1 minus the sum of squared allele frequencies.`}
            />
            <SortableTable
              label={t`Heterozygosity by target`}
              stickyFirstColumn
              columns={[
                { key: "target", label: t`Target`, value: (row: TargetAcrossGroups) => row.name },
                ...loaded.value.groups.map((group, index): SortableColumn<TargetAcrossGroups> => ({
                  key: `g${index}`,
                  label: groupName(group),
                  headerNote: <GroupSizeNote group={group} />,
                  value: (row) => row.heterozygosity[index] ?? null,
                  render: (row) => {
                    const value = row.heterozygosity[index];
                    return value === null || value === undefined ? "–" : decimal.format(value);
                  },
                  cellStyle: (row) => {
                    const value = row.heterozygosity[index];
                    return value === null || value === undefined
                      ? undefined
                      : { backgroundColor: rampColour(heterozygosityRamp, value) };
                  },
                  numeric: true,
                })),
              ]}
              rows={loaded.value.targets}
              rowKey={(row) => row.name}
              onRowSelect={(row) => {
                setTarget(row.name);
                jumpToHeading(HEADING.alleles);
              }}
              selectedKey={shownTarget?.name ?? null}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="tabular-nums">
                  0
                </span>
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-32 rounded-sm border border-border"
                  style={{
                    background: `linear-gradient(to right, ${heterozygosityRamp.join(", ")})`,
                  }}
                />
                <span aria-hidden="true" className="tabular-nums">
                  1
                </span>
                <span>{t`Expected heterozygosity (0 to 1)`}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 w-5 items-center justify-center rounded-sm border border-border bg-surface text-xs text-text-muted"
                >
                  –
                </span>
                <span>{t`No value (unshaded)`}</span>
              </span>
            </div>
          </section>

          {shownTarget === null ? null : (
            <section className="flex flex-col gap-4">
              <SectionHeading
                id={HEADING.alleles}
                title={t`Microhaplotypes by group`}
                description={t`How often each microhaplotype of the chosen target is seen in each group. Choose a target in the table above, or here.`}
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={ArrowUp}
                    onClick={() => jumpToHeading(HEADING.heterozygosity)}
                  >
                    {t`Back to heterozygosity`}
                  </Button>
                }
              />
              <Field label={t`Target`} className="max-w-md">
                {(control) => (
                  <Combobox
                    {...control}
                    options={loaded.value.targets.map((item) => ({
                      value: item.name,
                      label: item.name,
                    }))}
                    value={shownTarget.name}
                    onChange={(value) => setTarget(value)}
                    noneLabel={false}
                  />
                )}
              </Field>
              <AllelesByGroup target={shownTarget} groups={loaded.value.groups} />
            </section>
          )}

          <Timeline comparison={loaded.value} total={field.total} headingId={HEADING.timeline} />
        </>
      )}
    </div>
  );
}

/** Props for {@link CompareTab}. */
export interface CompareTabProps {
  /** Which PMO to compare the groups of. */
  readonly source: WorkingSource;
  /** The minimum reads for a microhaplotype to count; `null` counts them all. */
  readonly minReads: number | null;
  readonly onMinReadsChange: (value: number | null) => void;
  /** The most reads any microhaplotype has in the working PMO, or `null` when unknown. */
  readonly maxReads: number | null;
}

/** Specimens grouped by a field the file has, compared side by side. */
export function CompareTab({
  source,
  minReads: minReadsInput,
  onMinReadsChange,
  maxReads,
}: CompareTabProps) {
  const minReads = useSettled(Math.max(0, minReadsInput ?? 0), 400);
  const fieldsRequest = useMemo(
    (): WorkingPmoRequest<"groupFields"> => ({ kind: "groupFields", source }),
    [source],
  );
  const fields = usePmoQuery(fieldsRequest);
  const [key, setKey] = useState<GroupKey | null>(null);

  if (fields.kind === "loading") {
    return (
      <output aria-busy="true" aria-label={t`Loading`}>
        <Skeleton className="h-40 w-full" />
      </output>
    );
  }
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

  return (
    <Comparison
      source={source}
      grouping={{ fields: usable, field: chosen, onChange: setKey }}
      reads={{ min: minReads, input: minReadsInput, max: maxReads, onChange: onMinReadsChange }}
    />
  );
}
