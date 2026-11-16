/**
 * Quality checks for the Summary tab that need fields PMO leaves optional:
 * controls (`specimen_type`), plate positions (`library_prep_plate_info`),
 * parasite densities, and read counts by stage. Each view shows only when
 * the file has its data, and says how much of the file it covers.
 */
import { plural, t } from "@lingui/core/macro";
import { useState } from "react";

import { useTheme } from "@/app/theme";
import type { PmoSummary, SampleSummary } from "@/domain/tools/types";
import { intlLocale } from "@/i18n/languages";
import {
  Callout,
  EMPTY_CELL,
  SEQUENTIAL,
  SERIES,
  SectionHeading,
  formatCount,
  rampColour,
} from "@/ui";

import { SortableTable, type SortableColumn } from "./SortableTable";

/** "Plate positions are given for 40 of 50 library samples." and the like, when not all have it. */
function Coverage({
  have,
  total,
  children,
}: {
  readonly have: number;
  readonly total: number;
  readonly children: string;
}) {
  if (have >= total) return null;
  return <p className="text-sm text-text-muted">{children}</p>;
}

/** Warns about controls that look wrong: a negative control with reads, a positive one without. */
export function ControlsCheck({ summary }: { readonly summary: PmoSummary }) {
  const controls = summary.samples.filter((sample) => sample.control !== null);
  if (controls.length === 0) return null;
  const dirty = controls.filter((sample) => sample.control === "negative" && sample.reads > 0);
  const failed = controls.filter((sample) => sample.control === "positive" && sample.targets === 0);
  const count = controls.length;
  if (dirty.length === 0 && failed.length === 0) {
    return (
      <Callout tone="success" title={t`The controls look right`}>
        {plural(count, {
          one: "# control: no negative control has reads above the threshold, and every positive control has data.",
          other:
            "# controls: no negative control has reads above the threshold, and every positive control has data.",
        })}
      </Callout>
    );
  }
  return (
    <Callout tone="warning" title={t`Check the controls`}>
      <ul className="list-disc pl-5">
        {dirty.map((sample) => {
          const name = sample.name;
          const reads = sample.reads;
          return (
            <li key={`n${sample.libraryId}`}>
              {plural(reads, {
                one: `Negative control ${name} has # read.`,
                other: `Negative control ${name} has # reads.`,
              })}
            </li>
          );
        })}
        {failed.map((sample) => {
          const name = sample.name;
          return <li key={`p${sample.libraryId}`}>{t`Positive control ${name} has no data.`}</li>;
        })}
      </ul>
    </Callout>
  );
}

const ROW_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Props for the optional views of the Summary. */
export interface QualityViewProps {
  readonly summary: PmoSummary;
  /** The id of the view's heading, to jump to. */
  readonly headingId?: string;
}

/** Whether {@link PlateView} shows: some library sample has a plate position. */
export function showsPlates(summary: PmoSummary): boolean {
  return summary.samples.some((sample) => sample.plate !== null);
}

/** Whether {@link DensityView} shows: at least three samples with a density. */
export function showsDensity(summary: PmoSummary): boolean {
  return densityPoints(summary).length >= 3;
}

/** Whether {@link StagesView} shows: some library sample has read counts by stage. */
export function showsStages(summary: PmoSummary): boolean {
  return stageCounted(summary).length > 0;
}

function densityPoints(summary: PmoSummary): SampleSummary[] {
  return summary.samples.filter((sample) => sample.density !== null && sample.density.value > 0);
}

function stageCounted(summary: PmoSummary): SampleSummary[] {
  return summary.samples.filter(
    (sample) => sample.rawReads !== null || sample.stageReads.some((value) => value !== null),
  );
}

/** Each plate as a grid of wells, coloured by how many targets have data. */
export function PlateView({ summary, headingId }: QualityViewProps) {
  const { resolved } = useTheme();
  const [hover, setHover] = useState<{
    readonly sample: SampleSummary;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const placed = summary.samples.filter((sample) => sample.plate !== null);
  if (!showsPlates(summary)) return null;
  const plates = [...new Set(placed.map((sample) => sample.plate?.plate ?? ""))];
  const maxTargets = Math.max(1, ...placed.map((sample) => sample.targets));
  const ramp = SEQUENTIAL[resolved];
  const have = new Set(placed.map((sample) => sample.libraryId)).size;
  const total = summary.librarySamples;
  const haveCount = formatCount(have);
  const totalCount = formatCount(total);
  const cell = 26;
  const hoverTargets = hover?.sample.targets ?? 0;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        id={headingId}
        title={t`Plates`}
        description={t`Each well is a library sample, coloured by how many targets have data; a cross marks a sample with none. Patterns along a row, a column or the edge point to a problem with the plate rather than the samples.`}
      />
      <Coverage have={have} total={total}>
        {t`Plate positions are given for ${haveCount} of ${totalCount} library samples.`}
      </Coverage>
      <div className="relative flex flex-wrap gap-8">
        {plates.map((plate) => {
          const wells = placed.filter((sample) => sample.plate?.plate === plate);
          const rows = Math.max(
            8,
            ...wells.map((sample) => ROW_LETTERS.indexOf(sample.plate?.row ?? "A") + 1),
          );
          const cols = Math.max(12, ...wells.map((sample) => sample.plate?.col ?? 1));
          const wellCount = formatCount(wells.length);
          return (
            <figure key={plate} className="flex flex-col gap-2">
              <figcaption className="text-sm font-medium text-text">{plate}</figcaption>
              <p className="sr-only">{t`Plate ${plate}: ${wellCount} library samples. The sample table gives the same figures.`}</p>
              <svg width={(cols + 1) * cell} height={(rows + 1) * cell} aria-hidden="true">
                {Array.from({ length: cols }, (_, col) => (
                  <text
                    key={`c${col}`}
                    x={(col + 1.5) * cell}
                    y={cell * 0.65}
                    textAnchor="middle"
                    className="fill-text-muted text-[10px]"
                  >
                    {col + 1}
                  </text>
                ))}
                {Array.from({ length: rows }, (_, row) => (
                  <text
                    key={`r${row}`}
                    x={cell * 0.5}
                    y={(row + 1.6) * cell}
                    textAnchor="middle"
                    className="fill-text-muted text-[10px]"
                  >
                    {ROW_LETTERS[row]}
                  </text>
                ))}
                {Array.from({ length: rows * cols }, (_, index) => {
                  const row = Math.floor(index / cols);
                  const col = index % cols;
                  const sample = wells.find(
                    (item) => item.plate?.row === ROW_LETTERS[row] && item.plate?.col === col + 1,
                  );
                  const fill =
                    sample === undefined
                      ? "transparent"
                      : sample.targets === 0
                        ? EMPTY_CELL[resolved]
                        : rampColour(ramp, sample.targets / maxTargets);
                  return (
                    <rect
                      key={index}
                      x={(col + 1) * cell + 2}
                      y={(row + 1) * cell + 2}
                      width={cell - 4}
                      height={cell - 4}
                      rx={4}
                      fill={fill}
                      className={sample === undefined ? "stroke-border" : undefined}
                      strokeDasharray={sample === undefined ? "2 2" : undefined}
                      onMouseEnter={(event) => {
                        if (sample === undefined) return;
                        const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
                        const parent = event.currentTarget
                          .closest("section")
                          ?.getBoundingClientRect();
                        setHover({
                          sample,
                          x: (box?.left ?? 0) - (parent?.left ?? 0) + (col + 1.5) * cell,
                          y: (box?.top ?? 0) - (parent?.top ?? 0) + (row + 2) * cell,
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
                {wells
                  .filter((sample) => sample.targets === 0)
                  .map((sample) => {
                    const row = ROW_LETTERS.indexOf(sample.plate?.row ?? "A");
                    const col = (sample.plate?.col ?? 1) - 1;
                    const x = (col + 1) * cell + 8;
                    const y = (row + 1) * cell + 8;
                    return (
                      <path
                        key={`x${sample.libraryId}`}
                        d={`M${x},${y} l${cell - 16},${cell - 16} M${x + cell - 16},${y} l${-(cell - 16)},${cell - 16}`}
                        className="pointer-events-none stroke-text-muted"
                        strokeWidth={1.5}
                      />
                    );
                  })}
              </svg>
            </figure>
          );
        })}
      </div>
      {hover === null ? null : (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text shadow-md"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="font-medium">{hover.sample.name}</div>
          <div className="text-text-muted">
            {plural(hoverTargets, { one: "# target with data", other: "# targets with data" })}
          </div>
        </div>
      )}
    </section>
  );
}

/** Parasite density against targets with data: low-density samples tend to lose targets. */
export function DensityView({ summary, headingId }: QualityViewProps) {
  const { resolved } = useTheme();
  const [hover, setHover] = useState<SampleSummary | null>(null);
  const points = densityPoints(summary);
  if (points.length < 3) return null;
  const width = 560;
  const height = 260;
  const pad = { left: 48, right: 16, top: 12, bottom: 40 };
  const logs = points.map((sample) => Math.log10(sample.density?.value ?? 1));
  const minLog = Math.floor(Math.min(...logs));
  const maxLog = Math.ceil(Math.max(...logs));
  const maxTargets = Math.max(
    1,
    summary.targets.length > 0 ? Math.max(...summary.samples.map((s) => s.targets)) : 1,
  );
  const x = (value: number) =>
    pad.left +
    ((Math.log10(value) - minLog) / Math.max(1, maxLog - minLog)) * (width - pad.left - pad.right);
  const y = (targets: number) =>
    pad.top + (1 - targets / maxTargets) * (height - pad.top - pad.bottom);
  const have = new Set(points.map((sample) => sample.libraryId)).size;
  const total = summary.librarySamples;
  const ticks = Array.from({ length: maxLog - minLog + 1 }, (_, index) => minLog + index);
  const number = new Intl.NumberFormat(intlLocale());
  const haveCount = formatCount(have);
  const totalCount = formatCount(total);
  const pointCount = formatCount(points.length);
  const hoverName = hover?.name ?? "";
  const hoverDensity = number.format(hover?.density?.value ?? 0);
  const hoverTargets = formatCount(hover?.targets ?? 0);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        id={headingId}
        title={t`Parasite density and targets with data`}
        description={t`Samples with few parasites often lose targets. Each dot is a library sample; the density is its own qPCR measurement when it has one, else its specimen's.`}
      />
      <Coverage have={have} total={total}>
        {t`A density is given for ${haveCount} of ${totalCount} library samples.`}
      </Coverage>
      <figure className="flex flex-col gap-2">
        <p className="sr-only">{t`Targets with data against parasite density for ${pointCount} samples. The sample table gives the same figures.`}</p>
        <svg width={width} height={height} aria-hidden="true">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={x(10 ** tick)}
                x2={x(10 ** tick)}
                y1={pad.top}
                y2={height - pad.bottom}
                className="stroke-border"
              />
              <text
                x={x(10 ** tick)}
                y={height - pad.bottom + 16}
                textAnchor="middle"
                className="fill-text-muted text-[11px]"
              >
                {number.format(10 ** tick)}
              </text>
            </g>
          ))}
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={height - pad.bottom}
            y2={height - pad.bottom}
            className="stroke-border-strong"
          />
          <text
            x={(width + pad.left) / 2}
            y={height - 6}
            textAnchor="middle"
            className="fill-text-muted text-[11px]"
          >
            {t`Parasites per µL (log scale)`}
          </text>
          <text
            x={12}
            y={(height - pad.bottom + pad.top) / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${(height - pad.bottom + pad.top) / 2})`}
            className="fill-text-muted text-[11px]"
          >
            {t`Targets with data`}
          </text>
          {[0, maxTargets].map((value) => (
            <text
              key={value}
              x={pad.left - 8}
              y={y(value) + 4}
              textAnchor="end"
              className="fill-text-muted text-[11px]"
            >
              {value}
            </text>
          ))}
          {points.map((sample) => (
            <circle
              key={`${sample.run}:${sample.libraryId}`}
              cx={x(sample.density?.value ?? 1)}
              cy={y(sample.targets)}
              r={hover === sample ? 6 : 4.5}
              fill={SERIES[resolved]}
              className="stroke-surface"
              strokeWidth={2}
              onMouseEnter={() => setHover(sample)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <p className="min-h-5 text-sm text-text-muted" aria-live="polite">
          {hover === null
            ? t`Hover over a dot to see its sample.`
            : t`${hoverName}: ${hoverDensity} per µL, ${hoverTargets} targets with data.`}
        </p>
      </figure>
    </section>
  );
}

/** Reads at each pipeline stage: where reads are lost between demultiplexing and the final calls. */
export function StagesView({ summary, headingId }: QualityViewProps) {
  const counted = stageCounted(summary);
  if (counted.length === 0) return null;
  const percent = new Intl.NumberFormat(intlLocale(), {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const columns: SortableColumn<SampleSummary>[] = [
    { key: "name", label: t`Library sample`, value: (row) => row.name },
    {
      key: "raw",
      label: t`Raw reads`,
      value: (row) => row.rawReads,
      render: (row) => (row.rawReads === null ? "–" : formatCount(row.rawReads)),
      numeric: true,
    },
    ...summary.stages.map((stage, index): SortableColumn<SampleSummary> => ({
      key: `stage-${index}`,
      label: stage,
      value: (row) => row.stageReads[index] ?? null,
      render: (row) => {
        const value = row.stageReads[index];
        return value === null || value === undefined ? "–" : formatCount(value);
      },
      numeric: true,
    })),
    {
      key: "kept",
      label: t`Kept of raw`,
      value: (row) => keptShare(row),
      render: (row) => {
        const share = keptShare(row);
        return share === null ? "–" : percent.format(share);
      },
      numeric: true,
    },
  ];
  const have = new Set(counted.map((sample) => sample.libraryId)).size;
  const total = summary.librarySamples;
  const haveCount = formatCount(have);
  const totalCount = formatCount(total);
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        id={headingId}
        title={t`Reads at each pipeline stage`}
        description={t`Where reads are lost on the way to the final calls. Stage names are the pipeline's own; reads at a stage are summed over targets. Kept of raw is the last stage given, as a share of the raw reads.`}
      />
      <Coverage have={have} total={total}>
        {t`Read counts by stage are given for ${haveCount} of ${totalCount} library samples.`}
      </Coverage>
      <SortableTable
        label={t`Reads at each pipeline stage`}
        columns={columns}
        rows={counted}
        rowKey={(row) => `${row.run}\u0000${row.libraryId}`}
        initialSort={{ key: "kept", descending: false }}
      />
    </section>
  );
}

function keptShare(row: SampleSummary): number | null {
  const last = row.stageReads.findLast((value) => value !== null);
  if (row.rawReads === null || row.rawReads === 0 || last === undefined || last === null)
    return null;
  return last / row.rawReads;
}
