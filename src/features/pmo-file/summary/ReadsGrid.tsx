import { t } from "@lingui/core/macro";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "@/app/theme";
import type { PmoSummary } from "@/domain/tools/types";
import { CANVAS_TEXT, EMPTY_CELL, SEQUENTIAL, formatCount, rampColour } from "@/ui";

/** Props for {@link ReadsGrid}. */
export interface ReadsGridProps {
  readonly summary: PmoSummary;
  /** The target columns to draw, as indexes into `summary.targets`. */
  readonly columns: readonly number[];
  /**
   * Runs of `columns` to draw apart, with a heading each, such as the panel's
   * reactions. Their counts add up to `columns.length`.
   */
  readonly groups?: readonly { readonly label: string; readonly count: number }[];
}

/** Space between two groups of columns. */
const GROUP_GAP = 6;

/** Where each column starts, with a gap before each new group, and where each group starts. */
function layout(options: {
  readonly count: number;
  readonly groups: ReadsGridProps["groups"];
  readonly left: number;
  readonly cellWidth: number;
}): { readonly xs: number[]; readonly starts: { readonly label: string; readonly x: number }[] } {
  const groupOf: number[] = [];
  (options.groups ?? [{ label: "", count: options.count }]).forEach((group, index) => {
    for (let column = 0; column < group.count; column += 1) groupOf.push(index);
  });
  const xs = Array.from(
    { length: options.count },
    (_, index) => options.left + index * options.cellWidth + (groupOf[index] ?? 0) * GROUP_GAP,
  );
  const starts: { label: string; x: number }[] = [];
  let first = 0;
  for (const group of options.groups ?? []) {
    starts.push({ label: group.label, x: xs[first] ?? options.left });
    first += group.count;
  }
  return { xs, starts };
}

interface Hover {
  readonly row: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
}

const LABEL_WIDTH = 140;
const MAX_HEIGHT = 640;

/**
 * Reads per sample (rows) and target (columns), on a log scale. Hovering a
 * cell names the sample, the target and the reads. The tables below give the
 * same figures as text.
 */
export function ReadsGrid({ summary, columns, groups }: ReadsGridProps) {
  const { resolved } = useTheme();
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<Hover | null>(null);
  const rows = summary.samples.length;
  const rowHeight = Math.max(3, Math.min(14, Math.floor(MAX_HEIGHT / Math.max(1, rows))));
  const showLabels = rowHeight >= 10;
  const left = showLabels ? LABEL_WIDTH : 0;
  const gaps = groups === undefined ? 0 : Math.max(0, groups.length - 1) * GROUP_GAP;
  const cellWidth = Math.max(2, (width - left - gaps) / Math.max(1, columns.length));
  const height = rows * rowHeight;
  const controlWord = t({
    message: "control",
    comment: "Marks a control sample in the reads grid",
  });

  const { xs, starts: groupStarts } = useMemo(
    () => layout({ count: columns.length, groups, left, cellWidth }),
    [columns.length, groups, left, cellWidth],
  );

  const maxLog = useMemo(() => {
    let max = 0;
    for (const value of summary.grid.reads) if (value > max) max = value;
    return Math.log10(max + 1);
  }, [summary]);

  useEffect(() => {
    const element = wrapper.current;
    if (element === null || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (element === null || element === undefined || context === null || context === undefined) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.floor(width * ratio);
    element.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const ramp = SEQUENTIAL[resolved];
    const gap = cellWidth >= 4 && rowHeight >= 4 ? 1 : 0;
    const textColour = CANVAS_TEXT[resolved];
    context.font = "10px system-ui, sans-serif";
    context.textBaseline = "middle";
    for (let row = 0; row < rows; row += 1) {
      const y = row * rowHeight;
      if (showLabels) {
        context.fillStyle = textColour;
        const sample = summary.samples[row];
        const name = sample?.name ?? "";
        const control = sample?.control !== null && sample?.control !== undefined;
        const short =
          name.length > (control ? 12 : 22) ? `${name.slice(0, control ? 11 : 21)}…` : name;
        context.fillText(
          control ? `${short} (${controlWord})` : short,
          0,
          y + rowHeight / 2,
          LABEL_WIDTH - 8,
        );
      }
      columns.forEach((target, index) => {
        const reads = summary.grid.reads[row * summary.grid.columns + target] ?? 0;
        context.fillStyle =
          reads > 0
            ? rampColour(ramp, maxLog === 0 ? 1 : Math.log10(reads + 1) / maxLog)
            : EMPTY_CELL[resolved];
        context.fillRect(xs[index] ?? 0, y, cellWidth - gap, rowHeight - gap);
      });
    }
  }, [
    summary,
    columns,
    width,
    height,
    rows,
    rowHeight,
    cellWidth,
    showLabels,
    maxLog,
    resolved,
    xs,
    controlWord,
  ]);

  const hovered =
    hover === null
      ? null
      : {
          sample: summary.samples[hover.row],
          target: summary.targets[columns[hover.column] ?? -1],
          reads:
            summary.grid.reads[hover.row * summary.grid.columns + (columns[hover.column] ?? 0)] ??
            0,
        };
  const maxReads = formatCount(Math.round(10 ** maxLog - 1));
  const hoveredReads = formatCount(hovered?.reads ?? 0);
  const sampleCount = formatCount(rows);
  const targetCount = formatCount(columns.length);
  const ramp = SEQUENTIAL[resolved];

  return (
    <div className="flex flex-col gap-3">
      <p className="sr-only">
        {t`A grid of reads for ${sampleCount} samples at ${targetCount} targets. The tables below give the same figures.`}
      </p>
      {groupStarts.length > 1 ? (
        <div className="relative h-5 text-xs text-text-muted" aria-hidden="true">
          {groupStarts.map((group) => (
            <span
              key={`${group.label}${group.x}`}
              className="absolute top-0 whitespace-nowrap"
              style={{ left: group.x }}
            >
              {group.label}
            </span>
          ))}
        </div>
      ) : null}
      <div ref={wrapper} className="relative max-h-[40rem] overflow-y-auto">
        <canvas
          ref={canvas}
          aria-hidden="true"
          style={{ width: `${width}px`, height: `${height}px` }}
          className="block"
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - box.left;
            const y = event.clientY - box.top;
            const column = xs.findLastIndex((start) => start <= x);
            const row = Math.floor(y / rowHeight);
            const inCell = column >= 0 && x < (xs[column] ?? 0) + cellWidth;
            if (x < left || !inCell || row < 0 || row >= rows) {
              setHover(null);
            } else {
              setHover({ row, column, x, y });
            }
          }}
          onMouseLeave={() => setHover(null)}
        />
        {hovered === null || hover === null ? null : (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text shadow-md"
            style={{
              left: Math.min(hover.x + 12, Math.max(0, width - 240)),
              top: hover.y + 12,
            }}
          >
            <div className="font-medium break-all">{hovered.sample?.name}</div>
            <div className="text-text-muted break-all">{hovered.target?.name}</div>
            <div>{hovered.reads === 0 ? t`No reads` : t`${hoveredReads} reads`}</div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-sm border border-border"
            style={{ background: EMPTY_CELL[resolved] }}
          />
          {t`No reads`}
        </span>
        <span className="inline-flex items-center gap-1.5">
          1
          <span
            aria-hidden="true"
            className="inline-block h-3 w-32 rounded-sm"
            style={{ background: `linear-gradient(to right, ${ramp.join(", ")})` }}
          />
          {t`${maxReads} reads (log scale)`}
        </span>
      </div>
    </div>
  );
}
