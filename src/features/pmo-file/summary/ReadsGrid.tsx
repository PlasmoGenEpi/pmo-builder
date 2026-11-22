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
  readonly cellWidth: number;
}): { readonly xs: number[]; readonly starts: { readonly label: string; readonly x: number }[] } {
  const groupOf: number[] = [];
  (options.groups ?? [{ label: "", count: options.count }]).forEach((group, index) => {
    for (let column = 0; column < group.count; column += 1) groupOf.push(index);
  });
  const xs = Array.from(
    { length: options.count },
    (_, index) => index * options.cellWidth + (groupOf[index] ?? 0) * GROUP_GAP,
  );
  const starts: { label: string; x: number }[] = [];
  let first = 0;
  for (const group of options.groups ?? []) {
    starts.push({ label: group.label, x: xs[first] ?? 0 });
    first += group.count;
  }
  return { xs, starts };
}

interface Hover {
  readonly row: number;
  readonly column: number;
  readonly viewX: number;
  readonly viewY: number;
  readonly viewHeight: number;
}

const LABEL_WIDTH = 140;
const MIN_CELL_WIDTH = 2;
const MAX_HEIGHT = 640;
const TOOLTIP_WIDTH = 240;
const TOOLTIP_HEIGHT = 80;

/**
 * Reads per sample (rows) and target (columns), on a log scale. Hovering a
 * cell names the sample, the target and the reads. The tables below give the
 * same figures as text.
 */
export function ReadsGrid({ summary, columns, groups }: ReadsGridProps) {
  const { resolved } = useTheme();
  const wrapper = useRef<HTMLElement>(null);
  const labelsCanvas = useRef<HTMLCanvasElement>(null);
  const cellsCanvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<Hover | null>(null);
  const rows = summary.samples.length;
  const rowHeight = Math.max(3, Math.min(14, Math.floor(MAX_HEIGHT / Math.max(1, rows))));
  const showLabels = rowHeight >= 10;
  const left = showLabels ? LABEL_WIDTH : 0;
  const gaps = groups === undefined ? 0 : Math.max(0, groups.length - 1) * GROUP_GAP;
  const availableWidth = Math.max(0, width - left);
  const minCellsWidth = columns.length * MIN_CELL_WIDTH + gaps;
  const cellsWidth = Math.max(availableWidth, minCellsWidth);
  const cellWidth = columns.length === 0 ? MIN_CELL_WIDTH : (cellsWidth - gaps) / columns.length;
  const height = rows * rowHeight;
  const controlWord = t({
    message: "control",
    comment: "Marks a control sample in the reads grid",
  });

  const { xs, starts: groupStarts } = useMemo(
    () => layout({ count: columns.length, groups, cellWidth }),
    [columns.length, groups, cellWidth],
  );

  const maxLog = useMemo(() => {
    let max = 0;
    for (const value of summary.grid.reads) if (value > max) max = value;
    return Math.log10(max + 1);
  }, [summary]);

  useEffect(() => {
    const element = wrapper.current;
    if (element === null) return undefined;
    const measure = (next: number) => {
      if (next > 0) setWidth(Math.floor(next));
    };
    measure(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!showLabels) return;
    const element = labelsCanvas.current;
    const context = element?.getContext("2d");
    if (element === null || element === undefined || context === null || context === undefined) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.floor(LABEL_WIDTH * ratio);
    element.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, LABEL_WIDTH, height);
    context.fillStyle = CANVAS_TEXT[resolved];
    context.font = "10px system-ui, sans-serif";
    context.textBaseline = "middle";
    for (let row = 0; row < rows; row += 1) {
      const y = row * rowHeight;
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
  }, [summary, height, rows, rowHeight, showLabels, resolved, controlWord]);

  useEffect(() => {
    const element = cellsCanvas.current;
    const context = element?.getContext("2d");
    if (element === null || element === undefined || context === null || context === undefined) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.floor(cellsWidth * ratio);
    element.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cellsWidth, height);
    const ramp = SEQUENTIAL[resolved];
    const gap = cellWidth >= 4 && rowHeight >= 4 ? 1 : 0;
    for (let row = 0; row < rows; row += 1) {
      const y = row * rowHeight;
      columns.forEach((target, index) => {
        const reads = summary.grid.reads[row * summary.grid.columns + target] ?? 0;
        context.fillStyle =
          reads > 0
            ? rampColour(ramp, maxLog === 0 ? 1 : Math.log10(reads + 1) / maxLog)
            : EMPTY_CELL[resolved];
        context.fillRect(xs[index] ?? 0, y, cellWidth - gap, rowHeight - gap);
      });
    }
  }, [summary, columns, cellsWidth, height, rows, rowHeight, cellWidth, maxLog, resolved, xs]);

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
    <div className="flex min-w-0 flex-col gap-3">
      <p className="sr-only">
        {t`A grid of reads for ${sampleCount} samples at ${targetCount} targets. The tables below give the same figures.`}
      </p>
      <div className="relative min-w-0">
        <section
          ref={wrapper}
          aria-label={t`Reads by sample and target`}
          // Focusable so keyboard users can scroll it.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="isolate max-h-[40rem] min-w-0 overflow-auto focus-visible:outline-offset-0"
          onScroll={() => setHover(null)}
        >
          {groupStarts.length > 1 ? (
            <div
              className="sticky top-0 z-20 flex bg-canvas pb-2"
              style={{ width: `${left + cellsWidth}px` }}
              aria-hidden="true"
            >
              {showLabels ? (
                <div
                  className="sticky left-0 z-10 shrink-0 bg-canvas"
                  style={{ width: `${left}px` }}
                />
              ) : null}
              <div
                className="relative h-5 shrink-0 overflow-hidden text-xs text-text-muted"
                style={{ width: `${cellsWidth}px` }}
              >
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
            </div>
          ) : null}
          <div className="flex" style={{ width: `${left + cellsWidth}px` }}>
            {showLabels ? (
              <canvas
                ref={labelsCanvas}
                aria-hidden="true"
                style={{ width: `${left}px`, height: `${height}px` }}
                className="sticky left-0 z-10 block shrink-0 bg-canvas"
              />
            ) : null}
            <canvas
              ref={cellsCanvas}
              aria-hidden="true"
              style={{ width: `${cellsWidth}px`, height: `${height}px` }}
              className="block shrink-0"
              onMouseMove={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const x = event.clientX - box.left;
                const y = event.clientY - box.top;
                const column = xs.findLastIndex((start) => start <= x);
                const row = Math.floor(y / rowHeight);
                const inCell = column >= 0 && x < (xs[column] ?? 0) + cellWidth;
                if (!inCell || row < 0 || row >= rows) {
                  setHover(null);
                } else {
                  const container = wrapper.current?.getBoundingClientRect();
                  const viewX = container === undefined ? left + x : event.clientX - container.left;
                  const viewY = container === undefined ? y : event.clientY - container.top;
                  const viewHeight = container?.height ?? height;
                  setHover({ row, column, viewX, viewY, viewHeight });
                }
              }}
              onMouseLeave={() => setHover(null)}
            />
          </div>
        </section>
        {hovered === null || hover === null ? null : (
          <div
            className="pointer-events-none absolute z-20 max-w-60 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text shadow-md"
            style={{
              left: Math.max(0, Math.min(hover.viewX + 12, width - TOOLTIP_WIDTH)),
              top:
                hover.viewY + 12 + TOOLTIP_HEIGHT > hover.viewHeight
                  ? Math.max(0, hover.viewY - TOOLTIP_HEIGHT - 4)
                  : hover.viewY + 12,
            }}
          >
            <div className="font-medium break-all">{hovered.sample?.name}</div>
            <div className="text-text-muted break-all">{hovered.target?.name}</div>
            <div>{hovered.reads === 0 ? t`No reads` : t`${hoveredReads} reads`}</div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
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
