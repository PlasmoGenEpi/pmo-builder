import { plural, t } from "@lingui/core/macro";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useTheme } from "@/app/theme";
import type { PmoSummary, SampleSummary } from "@/domain/tools/types";
import {
  Button,
  CANVAS_SELECTION,
  CANVAS_TEXT,
  EMPTY_CELL,
  SEQUENTIAL,
  SERIES,
  cn,
  formatCount,
  rampColour,
} from "@/ui";

/** Stable row key shared by the reads grid and the Samples table. */
export function sampleRowKey(sample: Pick<SampleSummary, "run" | "name">): string {
  return `${sample.run}\u0000${sample.name}`;
}

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
  /** The target currently selected in the Targets table, if any. */
  readonly selectedTarget?: string | null;
  /** The sample row key currently marked in the Samples table, if any. */
  readonly selectedSampleKey?: string | null;
  /** Called when a target is chosen via a cell or column heading. */
  readonly onTargetSelect?: (targetName: string) => void;
  /** Called when a sample is chosen via a cell or row label. */
  readonly onSampleSelect?: (sampleKey: string) => void;
}

/** Space between two groups of columns. */
const GROUP_GAP = 6;
/** Minimum column width in CSS pixels to show individual target names along the top. */
const TARGET_LABEL_MIN_CELL_WIDTH = 16;
/** Minimum horizontal space in CSS pixels for a fallback group label. */
const MIN_GROUP_SPAN_PX = 96;
/** Minimum horizontal space for contiguous prefix groups to stay readable without colliding. */
const MIN_PREFIX_SPAN_PX = 72;
const GROUP_STEPS = [10, 20, 25, 50, 100, 200, 500] as const;

interface GroupSpan {
  readonly label: string;
  readonly x: number;
  readonly width: number;
}

/** Where each column starts, with a gap before each new group, and each group's span. */
function layout(options: {
  readonly count: number;
  readonly groups: ReadsGridProps["groups"];
  readonly cellWidth: number;
}): { readonly xs: number[]; readonly starts: GroupSpan[] } {
  const groupOf: number[] = [];
  (options.groups ?? [{ label: "", count: options.count }]).forEach((group, index) => {
    for (let column = 0; column < group.count; column += 1) groupOf.push(index);
  });
  const xs = Array.from(
    { length: options.count },
    (_, index) => index * options.cellWidth + (groupOf[index] ?? 0) * GROUP_GAP,
  );
  const starts: GroupSpan[] = [];
  let first = 0;
  for (const group of options.groups ?? []) {
    const startX = xs[first] ?? 0;
    const endX = (xs[first + group.count - 1] ?? startX) + options.cellWidth;
    starts.push({ label: group.label, x: startX, width: Math.max(0, endX - startX) });
    first += group.count;
  }
  return { xs, starts };
}

/** Prefix before the first `-`, `:` or `/`, when non-empty and shorter than the full name. */
function targetPrefix(targetName: string): string | null {
  const match = /^([^:/-]+)[/:-]/.exec(targetName);
  const prefix = match?.[1]?.trim() ?? "";
  return prefix.length > 0 && prefix.length < targetName.length ? prefix : null;
}

/**
 * Fallback column group headings when individual target names do not fit and no
 * reaction groups are active. Uses contiguous name prefixes when each span is
 * wide enough to read, otherwise clean numbered target ranges.
 */
function fallbackGroups(options: {
  readonly summary: PmoSummary;
  readonly columns: readonly number[];
  readonly xs: readonly number[];
  readonly cellWidth: number;
}): GroupSpan[] {
  const { summary, columns, xs, cellWidth } = options;
  if (columns.length === 0) return [];

  const prefixRuns: { readonly label: string; readonly first: number; count: number }[] = [];
  let allHavePrefix = true;
  for (let index = 0; index < columns.length; index += 1) {
    const targetName = summary.targets[columns[index] ?? -1]?.name ?? "";
    const prefix = targetPrefix(targetName);
    if (prefix === null) {
      allHavePrefix = false;
      break;
    }
    const previous = prefixRuns.at(-1);
    if (previous !== undefined && previous.label === prefix) {
      previous.count += 1;
    } else {
      prefixRuns.push({ label: prefix, first: index, count: 1 });
    }
  }

  if (allHavePrefix && prefixRuns.length >= 2) {
    const prefixSpans: GroupSpan[] = prefixRuns.map((run) => {
      const startX = xs[run.first] ?? 0;
      const endX = (xs[run.first + run.count - 1] ?? startX) + cellWidth;
      return { label: run.label, x: startX, width: Math.max(0, endX - startX) };
    });
    if (prefixSpans.every((span) => span.width >= MIN_PREFIX_SPAN_PX)) {
      return prefixSpans;
    }
  }

  const step =
    GROUP_STEPS.find((candidate) => candidate * cellWidth >= MIN_GROUP_SPAN_PX) ??
    Math.max(1, Math.ceil(MIN_GROUP_SPAN_PX / Math.max(cellWidth, 0.1)));
  const ranges: { readonly first: number; last: number }[] = [];
  for (let first = 0; first < columns.length; first += step) {
    const last = Math.min(columns.length - 1, first + step - 1);
    const count = last - first + 1;
    const previous = ranges.at(-1);
    if (previous !== undefined && count < Math.ceil(step / 3)) {
      previous.last = last;
    } else {
      ranges.push({ first, last });
    }
  }

  return ranges.map((range) => {
    const startX = xs[range.first] ?? 0;
    const endX = (xs[range.last] ?? startX) + cellWidth;
    const startNumber = formatCount(range.first + 1);
    const endNumber = formatCount(range.last + 1);
    return {
      label:
        range.first === range.last
          ? t`Target ${startNumber}`
          : t`Targets ${startNumber}–${endNumber}`,
      x: startX,
      width: Math.max(0, endX - startX),
    };
  });
}

interface Hover {
  readonly row: number;
  readonly column: number;
  readonly viewX: number;
  readonly viewY: number;
  readonly viewHeight: number;
}

interface ChosenKey {
  readonly sampleKey: string;
  readonly targetName: string;
}

const LABEL_WIDTH = 140;
const MIN_CELL_WIDTH = 2;
const MAX_HEIGHT = 640;
const TOOLTIP_WIDTH = 240;
const TOOLTIP_HEIGHT = 96;

function readsText(readCount: number): string {
  return plural(readCount, { one: "# read", other: "# reads" });
}

function allelesText(alleleCount: number): string {
  return plural(alleleCount, { one: "# microhaplotype", other: "# microhaplotypes" });
}

/**
 * Reads per sample (rows) and target (columns), on a log scale. Target names
 * sit along the top when columns are wide enough, or group names when they are
 * not. A cell can be chosen by click, tap or arrow keys to inspect its sample,
 * target, reads and microhaplotype count and find them in the tables below.
 */
export function ReadsGrid({
  summary,
  columns,
  groups,
  selectedTarget = null,
  selectedSampleKey = null,
  onTargetSelect,
  onSampleSelect,
}: ReadsGridProps) {
  const { resolved } = useTheme();
  const descriptionId = useId();
  const wrapper = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const labelsCanvas = useRef<HTMLCanvasElement>(null);
  const cellsCanvas = useRef<HTMLCanvasElement>(null);
  const lastPointerType = useRef<string>("mouse");
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<Hover | null>(null);
  const [chosen, setChosen] = useState<ChosenKey | null>(null);
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
  const showTargetNames = cellWidth >= TARGET_LABEL_MIN_CELL_WIDTH && columns.length > 0;
  const controlWord = t({
    message: "control",
    comment: "Marks a control sample in the reads grid",
  });

  const { xs, starts: groupStarts } = useMemo(
    () => layout({ count: columns.length, groups, cellWidth }),
    [columns.length, groups, cellWidth],
  );

  const headerGroups = useMemo(() => {
    if (groupStarts.length > 1) return groupStarts;
    if (showTargetNames) return [];
    return fallbackGroups({ summary, columns, xs, cellWidth });
  }, [groupStarts, showTargetNames, summary, columns, xs, cellWidth]);

  const chosenCoords = useMemo(() => {
    if (chosen === null) return null;
    const row = summary.samples.findIndex((sample) => sampleRowKey(sample) === chosen.sampleKey);
    const column = columns.findIndex(
      (targetIndex) => summary.targets[targetIndex]?.name === chosen.targetName,
    );
    if (row < 0 || column < 0) return null;
    return { row, column };
  }, [chosen, summary.samples, summary.targets, columns]);

  const chosenSample = chosenCoords === null ? undefined : summary.samples[chosenCoords.row];
  const highlightedSampleKey =
    selectedSampleKey ?? (chosenSample === undefined ? null : sampleRowKey(chosenSample));

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
    context.textBaseline = "middle";
    for (let row = 0; row < rows; row += 1) {
      const y = row * rowHeight;
      const sample = summary.samples[row];
      if (sample === undefined) continue;
      const isSelected = highlightedSampleKey === sampleRowKey(sample);
      if (isSelected) {
        context.fillStyle = SERIES[resolved];
        context.fillRect(0, y, 3, Math.max(2, rowHeight - 1));
      }
      context.fillStyle = CANVAS_TEXT[resolved];
      context.font = isSelected ? "600 10px system-ui, sans-serif" : "10px system-ui, sans-serif";
      const sampleName = sample.name;
      const control = sample.control !== null;
      const short =
        sampleName.length > (control ? 12 : 22)
          ? `${sampleName.slice(0, control ? 11 : 21)}…`
          : sampleName;
      context.fillText(
        control ? `${short} (${controlWord})` : short,
        6,
        y + rowHeight / 2,
        LABEL_WIDTH - 14,
      );
    }
  }, [summary, height, rows, rowHeight, showLabels, resolved, controlWord, highlightedSampleKey]);

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
    if (chosenCoords !== null) {
      const { outer, inner } = CANVAS_SELECTION[resolved];
      const x = xs[chosenCoords.column] ?? 0;
      const y = chosenCoords.row * rowHeight;
      const w = Math.max(2, cellWidth - gap);
      const h = Math.max(2, rowHeight - gap);
      if (w >= 6 && h >= 6) {
        context.strokeStyle = outer;
        context.lineWidth = 2;
        context.strokeRect(
          Math.max(1, Math.min(x + 1, cellsWidth - 1)),
          Math.max(1, Math.min(y + 1, height - 1)),
          Math.max(1, w - 2),
          Math.max(1, h - 2),
        );
        context.strokeStyle = inner;
        context.lineWidth = 1;
        context.strokeRect(
          Math.max(2.5, Math.min(x + 2.5, cellsWidth - 2.5)),
          Math.max(2.5, Math.min(y + 2.5, height - 2.5)),
          Math.max(1, w - 5),
          Math.max(1, h - 5),
        );
      } else {
        const pad = 2;
        const ox = Math.max(1, Math.min(x - pad, cellsWidth - w - pad * 2 - 1));
        const oy = Math.max(1, Math.min(y - pad, height - h - pad * 2 - 1));
        const ow = Math.min(cellsWidth - ox - 1, w + pad * 2);
        const oh = Math.min(height - oy - 1, h + pad * 2);
        context.strokeStyle = inner;
        context.lineWidth = 3;
        context.strokeRect(ox, oy, ow, oh);
        context.strokeStyle = outer;
        context.lineWidth = 1.5;
        context.strokeRect(ox, oy, ow, oh);
      }
    }
  }, [
    summary,
    columns,
    cellsWidth,
    height,
    rows,
    rowHeight,
    cellWidth,
    maxLog,
    resolved,
    xs,
    chosenCoords,
  ]);

  function scrollCellIntoView(row: number, column: number): void {
    const container = wrapper.current;
    if (container === null) return;
    const visibleCellsWidth = container.clientWidth - left;
    if (visibleCellsWidth > 0) {
      const cellLeft = xs[column] ?? 0;
      const cellRight = cellLeft + cellWidth;
      if (cellLeft < container.scrollLeft) {
        container.scrollLeft = cellLeft;
      } else if (cellRight > container.scrollLeft + visibleCellsWidth) {
        container.scrollLeft = cellRight - visibleCellsWidth;
      }
    }
    const headerHeight = headerRef.current?.offsetHeight ?? 0;
    const visibleCellsHeight = container.clientHeight - headerHeight;
    if (visibleCellsHeight > 0) {
      const cellTop = row * rowHeight;
      const cellBottom = cellTop + rowHeight;
      if (cellTop < container.scrollTop) {
        container.scrollTop = cellTop;
      } else if (cellBottom > container.scrollTop + visibleCellsHeight) {
        container.scrollTop = cellBottom - visibleCellsHeight;
      }
    }
  }

  function selectCell(row: number, column: number, options?: { readonly scroll?: boolean }): void {
    const sample = summary.samples[row];
    const targetIndex = columns[column];
    const target = targetIndex === undefined ? undefined : summary.targets[targetIndex];
    if (sample === undefined || target === undefined) return;
    const key = sampleRowKey(sample);
    setChosen({ sampleKey: key, targetName: target.name });
    onTargetSelect?.(target.name);
    onSampleSelect?.(key);
    if (options?.scroll) scrollCellIntoView(row, column);
  }

  function locateCell(
    clientX: number,
    clientY: number,
    box: DOMRect,
  ): { readonly row: number; readonly column: number } | null {
    const x = clientX - box.left;
    const y = clientY - box.top;
    const column = xs.findLastIndex((start) => start <= x);
    const row = Math.floor(y / rowHeight);
    const inCell = column >= 0 && x < (xs[column] ?? 0) + cellWidth;
    if (!inCell || row < 0 || row >= rows) return null;
    return { row, column };
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.target !== wrapper.current || rows === 0 || columns.length === 0) return;
    const current = chosenCoords;
    let nextRow: number;
    let nextColumn: number;
    switch (event.key) {
      case "ArrowRight":
        nextRow = current?.row ?? 0;
        nextColumn = current === null ? 0 : Math.min(columns.length - 1, current.column + 1);
        break;
      case "ArrowLeft":
        nextRow = current?.row ?? 0;
        nextColumn = current === null ? 0 : Math.max(0, current.column - 1);
        break;
      case "ArrowDown":
        nextRow = current === null ? 0 : Math.min(rows - 1, current.row + 1);
        nextColumn = current?.column ?? 0;
        break;
      case "ArrowUp":
        nextRow = current === null ? 0 : Math.max(0, current.row - 1);
        nextColumn = current?.column ?? 0;
        break;
      case "Home":
        nextRow = event.ctrlKey || event.metaKey ? 0 : (current?.row ?? 0);
        nextColumn = 0;
        break;
      case "End":
        nextRow = event.ctrlKey || event.metaKey ? rows - 1 : (current?.row ?? 0);
        nextColumn = columns.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectCell(nextRow, nextColumn, { scroll: true });
  }

  const hovered =
    hover === null
      ? null
      : (() => {
          const targetIndex = columns[hover.column] ?? -1;
          const cellIndex = hover.row * summary.grid.columns + targetIndex;
          return {
            sample: summary.samples[hover.row],
            target: summary.targets[targetIndex],
            reads: targetIndex < 0 ? 0 : (summary.grid.reads[cellIndex] ?? 0),
            alleles: targetIndex < 0 ? 0 : (summary.grid.alleles[cellIndex] ?? 0),
          };
        })();

  const chosenDetails =
    chosenCoords === null
      ? null
      : (() => {
          const targetIndex = columns[chosenCoords.column];
          const sample = summary.samples[chosenCoords.row];
          const target = targetIndex === undefined ? undefined : summary.targets[targetIndex];
          if (sample === undefined || target === undefined || targetIndex === undefined) {
            return null;
          }
          const cellIndex = chosenCoords.row * summary.grid.columns + targetIndex;
          return {
            sample,
            target,
            reads: summary.grid.reads[cellIndex] ?? 0,
            alleles: summary.grid.alleles[cellIndex] ?? 0,
          };
        })();

  const maxReads = formatCount(Math.round(10 ** maxLog - 1));
  const sampleCount = formatCount(rows);
  const targetCount = formatCount(columns.length);
  const ramp = SEQUENTIAL[resolved];
  const hasHeader = headerGroups.length > 0 || showTargetNames;

  const chosenSampleName = chosenDetails?.sample.name ?? "";
  const chosenTargetName = chosenDetails?.target.name ?? "";
  const chosenReadsLabel =
    chosenDetails === null
      ? ""
      : chosenDetails.reads === 0
        ? t({ message: "no reads", comment: "Part of a chosen reads-grid cell summary" })
        : readsText(chosenDetails.reads);
  const chosenAllelesLabel = chosenDetails === null ? "" : allelesText(chosenDetails.alleles);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p id={descriptionId} className="sr-only">
        {t`A grid of reads for ${sampleCount} samples at ${targetCount} targets. Use the arrow keys to move between cells and read each sample and target's figures. The tables below give totals per sample and per target, not individual cells.`}
      </p>
      <div className="relative min-w-0">
        {/* Focusable scroll region that also handles arrow-key cell navigation as one control. */}
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <section
          ref={wrapper}
          aria-label={t`Reads by sample and target`}
          aria-describedby={descriptionId}
          // Focusable so keyboard users can scroll and step through cells with the arrow keys.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="isolate max-h-[40rem] min-w-0 overflow-auto focus-visible:outline-offset-0"
          onScroll={() => setHover(null)}
          onKeyDown={handleGridKeyDown}
        >
          {hasHeader ? (
            <div
              ref={headerRef}
              className="sticky top-0 z-20 flex flex-col bg-canvas"
              style={{ width: `${left + cellsWidth}px` }}
            >
              {headerGroups.length > 0 ? (
                <div className="flex pb-1.5">
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
                    {headerGroups.map((group) => (
                      <span
                        key={`${group.label}${group.x}`}
                        className="absolute top-0 truncate border-l border-border pl-1 first:border-l-0 first:pl-0"
                        style={{
                          left: group.x,
                          maxWidth: Math.max(0, group.width - 4),
                        }}
                      >
                        {group.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {showTargetNames ? (
                <div className="flex border-b border-border pb-1">
                  {showLabels ? (
                    <div
                      className="sticky left-0 z-10 shrink-0 bg-canvas"
                      style={{ width: `${left}px` }}
                    />
                  ) : null}
                  <div
                    className="relative h-36 shrink-0 overflow-hidden"
                    style={{ width: `${cellsWidth}px` }}
                  >
                    {columns.map((targetIndex, index) => {
                      const target = summary.targets[targetIndex];
                      if (target === undefined) return null;
                      const isSelected = selectedTarget === target.name;
                      return (
                        <Button
                          key={target.name}
                          variant="ghost"
                          size="sm"
                          aria-pressed={isSelected}
                          title={target.name}
                          onClick={() => onTargetSelect?.(target.name)}
                          style={{ left: `${xs[index] ?? 0}px`, width: `${cellWidth}px` }}
                          className={cn(
                            "absolute inset-y-0 h-auto! min-w-0 rotate-180 justify-start rounded-none px-0.5 py-1 text-xs font-normal [writing-mode:vertical-rl]",
                            isSelected
                              ? "bg-accent-subtle font-medium text-accent-text"
                              : "text-text-muted hover:text-text",
                          )}
                        >
                          <span className="truncate">{target.name}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex" style={{ width: `${left + cellsWidth}px` }}>
            {showLabels ? (
              <canvas
                ref={labelsCanvas}
                aria-hidden="true"
                style={{ width: `${left}px`, height: `${height}px` }}
                className="sticky left-0 z-10 block shrink-0 cursor-pointer bg-canvas"
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  const row = Math.floor((event.clientY - box.top) / rowHeight);
                  const sample = summary.samples[row];
                  if (row >= 0 && row < rows && sample !== undefined) {
                    onSampleSelect?.(sampleRowKey(sample));
                  }
                }}
              />
            ) : null}
            <canvas
              ref={cellsCanvas}
              aria-hidden="true"
              style={{ width: `${cellsWidth}px`, height: `${height}px` }}
              className="block shrink-0 cursor-pointer"
              onPointerDown={(event) => {
                lastPointerType.current = event.pointerType;
                if (event.pointerType === "touch") setHover(null);
              }}
              onPointerMove={(event) => {
                lastPointerType.current = event.pointerType;
              }}
              onMouseMove={(event) => {
                if (lastPointerType.current === "touch") return;
                const box = event.currentTarget.getBoundingClientRect();
                const cell = locateCell(event.clientX, event.clientY, box);
                if (cell === null) {
                  setHover(null);
                } else {
                  const container = wrapper.current?.getBoundingClientRect();
                  const viewX =
                    container === undefined
                      ? left + (event.clientX - box.left)
                      : event.clientX - container.left;
                  const viewY =
                    container === undefined
                      ? event.clientY - box.top
                      : event.clientY - container.top;
                  const viewHeight = container?.height ?? height;
                  setHover({ row: cell.row, column: cell.column, viewX, viewY, viewHeight });
                }
              }}
              onMouseLeave={() => setHover(null)}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const cell = locateCell(event.clientX, event.clientY, box);
                if (cell !== null) selectCell(cell.row, cell.column);
              }}
            />
          </div>
        </section>
        {hovered === null || hover === null ? null : (
          <div
            role="tooltip"
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
            <div>{hovered.reads === 0 ? t`No reads` : readsText(hovered.reads)}</div>
            {hovered.alleles > 0 ? (
              <div className="text-xs text-text-muted">{allelesText(hovered.alleles)}</div>
            ) : null}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
        <div className="flex flex-wrap items-center gap-3">
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
        <output
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            "min-w-0 text-sm",
            chosenDetails === null
              ? "text-text-muted"
              : "rounded-md border border-border bg-surface-subtle px-2.5 py-1 text-text",
          )}
        >
          {chosenDetails === null
            ? t`Choose a cell or use the arrow keys to inspect a sample and target.`
            : t`${chosenSampleName} at ${chosenTargetName}: ${chosenReadsLabel}, ${chosenAllelesLabel}.`}
        </output>
      </div>
    </div>
  );
}
