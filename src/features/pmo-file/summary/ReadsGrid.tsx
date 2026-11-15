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
export function ReadsGrid({ summary, columns }: ReadsGridProps) {
  const { resolved } = useTheme();
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<Hover | null>(null);
  const rows = summary.samples.length;
  const rowHeight = Math.max(3, Math.min(14, Math.floor(MAX_HEIGHT / Math.max(1, rows))));
  const showLabels = rowHeight >= 10;
  const left = showLabels ? LABEL_WIDTH : 0;
  const cellWidth = Math.max(2, (width - left) / Math.max(1, columns.length));
  const height = rows * rowHeight;

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
        const name = summary.samples[row]?.name ?? "";
        context.fillText(
          name.length > 22 ? `${name.slice(0, 21)}…` : name,
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
        context.fillRect(left + index * cellWidth, y, cellWidth - gap, rowHeight - gap);
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
    left,
    showLabels,
    maxLog,
    resolved,
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
            const column = Math.floor((x - left) / cellWidth);
            const row = Math.floor(y / rowHeight);
            if (x < left || column < 0 || column >= columns.length || row < 0 || row >= rows) {
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
