/**
 * Quality checks for the Summary tab that need fields PMO leaves optional:
 * controls (`specimen_type`), plate positions (`library_prep_plate_info`),
 * parasite densities, and read counts by stage. Each view shows only when
 * the file has its data, and says how much of the file it covers.
 */
import { plural, t } from "@lingui/core/macro";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

import { SortableTable, type SortableColumn, type SortableTableDownload } from "./SortableTable";

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
            <li key={`n:${sample.run}:${sample.libraryId}`}>
              {plural(reads, {
                one: `Negative control ${name} has # read.`,
                other: `Negative control ${name} has # reads.`,
              })}
            </li>
          );
        })}
        {failed.map((sample) => {
          const name = sample.name;
          return (
            <li key={`p:${sample.run}:${sample.libraryId}`}>
              {t`Positive control ${name} has no data.`}
            </li>
          );
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

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const TOOLTIP_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * Places a plate well's tooltip beside the well, in coordinates relative to the
 * container holding the plates, flipping or clamping so it stays inside the viewport.
 */
function placeWellTooltip(options: {
  readonly well: Box;
  readonly container: Box;
  readonly tooltip: { readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number; readonly height: number };
}): { readonly left: number; readonly top: number } {
  const { well, container, tooltip, viewport } = options;

  let vx = well.left;
  if (vx + tooltip.width > viewport.width - VIEWPORT_MARGIN) {
    vx = well.right - tooltip.width;
  }
  const maxX = Math.max(VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - tooltip.width);
  vx = Math.max(VIEWPORT_MARGIN, Math.min(vx, maxX));

  let vy = well.bottom + TOOLTIP_GAP;
  if (vy + tooltip.height > viewport.height - VIEWPORT_MARGIN) {
    vy = well.top - TOOLTIP_GAP - tooltip.height;
  }
  const maxY = Math.max(VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN - tooltip.height);
  vy = Math.max(VIEWPORT_MARGIN, Math.min(vy, maxY));

  return {
    left: vx - container.left,
    top: vy - container.top,
  };
}

interface ActiveWell {
  readonly id: string;
  readonly libraryId: number;
  readonly run: string;
  readonly plate: string;
  readonly coord: string;
}

function targetsWithDataLabel(targets: number): string {
  return plural(targets, { one: "# target with data", other: "# targets with data" });
}

function positionWellTooltip(options: {
  readonly wellId: string;
  readonly container: HTMLElement | null;
  readonly tooltip: HTMLElement | null;
}): void {
  const { wellId, container, tooltip } = options;
  if (container === null || tooltip === null) return;
  const wellElement = container.querySelector(`[data-plate-well="${wellId}"]`);
  if (wellElement === null) return;
  const wellRect = wellElement.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const pos = placeWellTooltip({
    well: {
      left: wellRect.left,
      top: wellRect.top,
      right: wellRect.right,
      bottom: wellRect.bottom,
    },
    container: containerRect,
    tooltip: { width: tooltipRect.width, height: tooltipRect.height },
    viewport: {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    },
  });
  tooltip.style.left = `${pos.left}px`;
  tooltip.style.top = `${pos.top}px`;
}

interface PlateWellCell {
  readonly wellId: string;
  readonly row: number;
  readonly col: number;
  readonly coord: string;
  readonly sample: SampleSummary;
}

/** Finds the next filled well on a plate for Arrow, Home or End navigation. */
function nextPlateWell(options: {
  readonly filled: readonly PlateWellCell[];
  readonly current: PlateWellCell;
  readonly key: string;
  readonly ctrlOrMeta: boolean;
}): PlateWellCell | null {
  const { filled, current, key, ctrlOrMeta } = options;
  switch (key) {
    case "ArrowRight":
      return filled.find((cell) => cell.row === current.row && cell.col > current.col) ?? null;
    case "ArrowLeft":
      return filled.findLast((cell) => cell.row === current.row && cell.col < current.col) ?? null;
    case "ArrowDown": {
      const sameCol = filled.find((cell) => cell.col === current.col && cell.row > current.row);
      if (sameCol !== undefined) return sameCol;
      const below = filled.filter((cell) => cell.row > current.row);
      const nextRow = below[0]?.row;
      if (nextRow === undefined) return null;
      return (
        below
          .filter((cell) => cell.row === nextRow)
          .toSorted((a, b) => Math.abs(a.col - current.col) - Math.abs(b.col - current.col))[0] ??
        null
      );
    }
    case "ArrowUp": {
      const sameCol = filled.findLast((cell) => cell.col === current.col && cell.row < current.row);
      if (sameCol !== undefined) return sameCol;
      const above = filled.filter((cell) => cell.row < current.row);
      const prevRow = above.at(-1)?.row;
      if (prevRow === undefined) return null;
      return (
        above
          .filter((cell) => cell.row === prevRow)
          .toSorted((a, b) => Math.abs(a.col - current.col) - Math.abs(b.col - current.col))[0] ??
        null
      );
    }
    case "Home": {
      if (ctrlOrMeta) return filled[0] ?? null;
      return filled.find((cell) => cell.row === current.row) ?? null;
    }
    case "End": {
      if (ctrlOrMeta) return filled.at(-1) ?? null;
      return filled.findLast((cell) => cell.row === current.row) ?? null;
    }
    default:
      return null;
  }
}

/** Each plate as a grid of wells, coloured by how many targets have data. */
export function PlateView({ summary, headingId }: QualityViewProps) {
  const { resolved } = useTheme();
  const platesRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const wellRefs = useRef(new Map<string, SVGRectElement>());
  const [hovered, setHovered] = useState<ActiveWell | null>(null);
  const [focused, setFocused] = useState<ActiveWell | null>(null);
  const [pinned, setPinned] = useState<ActiveWell | null>(null);
  const [activeWellByPlate, setActiveWellByPlate] = useState<Record<string, string>>({});

  const placed = summary.samples.filter((sample) => sample.plate !== null);
  const rawActive = hovered ?? focused ?? pinned;
  const activeSample =
    rawActive === null
      ? null
      : (placed.find(
          (sample) => sample.libraryId === rawActive.libraryId && sample.run === rawActive.run,
        ) ?? null);
  const activeId = rawActive === null || activeSample === null ? null : rawActive.id;
  // Live-region readout follows hover or explicit pin so focusing a well does not double-speak its aria-label.
  const rawLive = hovered ?? pinned;
  const liveSample =
    rawLive === null
      ? null
      : (placed.find(
          (sample) => sample.libraryId === rawLive.libraryId && sample.run === rawLive.run,
        ) ?? null);
  const hasPinned = pinned !== null;

  const setWellRef = useCallback((wellId: string, node: SVGRectElement | null) => {
    if (node === null) {
      wellRefs.current.delete(wellId);
    } else {
      wellRefs.current.set(wellId, node);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setPinned(null);
    setFocused(null);
    setHovered(null);
  }, []);

  const togglePinned = (well: ActiveWell) => {
    if (pinned?.id === well.id) {
      clearSelection();
    } else {
      setPinned(well);
    }
  };

  useEffect(() => {
    if (activeId === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearSelection();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeId, clearSelection]);

  useEffect(() => {
    if (!hasPinned) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-plate-well]") === null) {
        clearSelection();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [hasPinned, clearSelection]);

  useLayoutEffect(() => {
    if (activeId === null) return;
    positionWellTooltip({
      wellId: activeId,
      container: platesRef.current,
      tooltip: tooltipRef.current,
    });
  }, [activeId]);

  if (!showsPlates(summary)) return null;
  const plates = [...new Set(placed.map((sample) => sample.plate?.plate ?? ""))];
  const maxTargets = Math.max(1, ...placed.map((sample) => sample.targets));
  const ramp = SEQUENTIAL[resolved];
  const have = new Set(placed.map((sample) => sample.libraryId)).size;
  const total = summary.librarySamples;
  const haveCount = formatCount(have);
  const totalCount = formatCount(total);
  const cell = 26;
  const activeTargets = activeSample?.targets ?? 0;
  const activeCoord = rawActive?.coord ?? "";
  const liveTargets = liveSample?.targets ?? 0;
  const livePlate = rawLive?.plate ?? "";
  const liveCoord = rawLive?.coord ?? "";
  const liveSampleName = liveSample?.name ?? "";

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
      <div ref={platesRef} className="relative flex min-w-0 flex-wrap gap-8">
        {plates.map((plate, plateIndex) => {
          const wells = placed.filter((sample) => sample.plate?.plate === plate);
          const rows = Math.max(
            8,
            ...wells.map((sample) => ROW_LETTERS.indexOf(sample.plate?.row ?? "A") + 1),
          );
          const cols = Math.max(12, ...wells.map((sample) => sample.plate?.col ?? 1));
          const resolvedSlots = Array.from({ length: rows * cols }, (_, index) => {
            const row = Math.floor(index / cols);
            const col = index % cols;
            const rowLetter = ROW_LETTERS[row] ?? "";
            const coord = `${rowLetter}${col + 1}`;
            const sample = wells.find(
              (item) => item.plate?.row === rowLetter && item.plate?.col === col + 1,
            );
            const wellId = `${plateIndex}-${row}-${col}`;
            return { index, row, col, coord, wellId, sample };
          });
          const filledCells: PlateWellCell[] = resolvedSlots.flatMap((slot) =>
            slot.sample === undefined
              ? []
              : [
                  {
                    wellId: slot.wellId,
                    row: slot.row,
                    col: slot.col,
                    coord: slot.coord,
                    sample: slot.sample,
                  },
                ],
          );
          const storedActiveId = activeWellByPlate[plate];
          const rovingWellId =
            storedActiveId !== undefined &&
            filledCells.some((item) => item.wellId === storedActiveId)
              ? storedActiveId
              : (filledCells[0]?.wellId ?? null);
          const sampleCount = filledCells.length;
          const plateLandmarkLabel = plate === "" ? t`Plate` : t`Plate ${plate}`;
          return (
            <figure key={plate} className="flex min-w-0 max-w-full flex-col gap-2">
              <figcaption className="text-sm font-medium text-text">{plate}</figcaption>
              <p className="sr-only">
                {plate === ""
                  ? t`Plate: ${plural(sampleCount, {
                      one: "# library sample",
                      other: "# library samples",
                    })}. The sample table gives the same figures.`
                  : t`Plate ${plate}: ${plural(sampleCount, {
                      one: "# library sample",
                      other: "# library samples",
                    })}. The sample table gives the same figures.`}
              </p>
              <section
                aria-label={plateLandmarkLabel}
                // Focusable so keyboard users can scroll wide plates.
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={0}
                onScroll={() => {
                  setHovered(null);
                  const remaining = focused ?? pinned;
                  if (remaining !== null) {
                    positionWellTooltip({
                      wellId: remaining.id,
                      container: platesRef.current,
                      tooltip: tooltipRef.current,
                    });
                  }
                }}
                className="max-w-full overflow-x-auto focus-visible:outline-offset-0"
              >
                <svg
                  width={(cols + 1) * cell}
                  height={(rows + 1) * cell}
                  className="block"
                  // SVG has no native group element; role="group" names the plate grid.
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                  role="group"
                  aria-label={t`Wells on ${plate}`}
                >
                  {Array.from({ length: cols }, (_, col) => (
                    <text
                      key={`c${col}`}
                      aria-hidden="true"
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
                      aria-hidden="true"
                      x={cell * 0.5}
                      y={(row + 1.6) * cell}
                      textAnchor="middle"
                      className="fill-text-muted text-[10px]"
                    >
                      {ROW_LETTERS[row]}
                    </text>
                  ))}
                  {resolvedSlots.map(({ index, row, col, coord, wellId, sample }) => {
                    if (sample === undefined) {
                      return (
                        <rect
                          key={index}
                          aria-hidden="true"
                          x={(col + 1) * cell + 2}
                          y={(row + 1) * cell + 2}
                          width={cell - 4}
                          height={cell - 4}
                          rx={4}
                          fill="transparent"
                          className="stroke-border"
                          strokeDasharray="2 2"
                        />
                      );
                    }
                    const sampleName = sample.name;
                    const wellTargets = sample.targets;
                    const fill =
                      wellTargets === 0
                        ? EMPTY_CELL[resolved]
                        : rampColour(ramp, wellTargets / maxTargets);
                    const wellLabel = plural(wellTargets, {
                      one: `${coord}, ${sampleName}: # target with data`,
                      other: `${coord}, ${sampleName}: # targets with data`,
                    });
                    const isPinned = pinned?.id === wellId;
                    const well: ActiveWell = {
                      id: wellId,
                      libraryId: sample.libraryId,
                      run: sample.run,
                      plate,
                      coord,
                    };
                    const currentCell: PlateWellCell = { wellId, row, col, coord, sample };
                    return (
                      <rect
                        key={index}
                        ref={(node) => setWellRef(wellId, node)}
                        data-plate-well={wellId}
                        // SVG wells are <rect> shapes inside the plate grid, not HTML <button>s.
                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                        role="button"
                        tabIndex={wellId === rovingWellId ? 0 : -1}
                        aria-label={wellLabel}
                        aria-pressed={isPinned}
                        x={(col + 1) * cell + 2}
                        y={(row + 1) * cell + 2}
                        width={cell - 4}
                        height={cell - 4}
                        rx={4}
                        fill={fill}
                        className={
                          isPinned
                            ? "cursor-pointer stroke-text focus-visible:outline-offset-0"
                            : "cursor-pointer focus-visible:outline-offset-0"
                        }
                        strokeWidth={isPinned ? 2 : undefined}
                        onMouseEnter={() => setHovered(well)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => {
                          setHovered(null);
                          setFocused(well);
                          setActiveWellByPlate((previous) =>
                            previous[plate] === wellId
                              ? previous
                              : { ...previous, [plate]: wellId },
                          );
                        }}
                        onBlur={() => setFocused(null)}
                        onClick={() => togglePinned(well)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            togglePinned(well);
                          } else if (event.key === "Escape") {
                            clearSelection();
                          } else {
                            const next = nextPlateWell({
                              filled: filledCells,
                              current: currentCell,
                              key: event.key,
                              ctrlOrMeta: event.ctrlKey || event.metaKey,
                            });
                            if (next !== null) {
                              event.preventDefault();
                              setActiveWellByPlate((previous) => ({
                                ...previous,
                                [plate]: next.wellId,
                              }));
                              const element = wellRefs.current.get(next.wellId);
                              if (element !== undefined) {
                                element.focus();
                                if (typeof element.scrollIntoView === "function") {
                                  element.scrollIntoView({ block: "nearest", inline: "nearest" });
                                }
                              }
                            }
                          }
                        }}
                      />
                    );
                  })}
                  {filledCells
                    .filter((item) => item.sample.targets === 0)
                    .map((item) => {
                      const x = (item.col + 1) * cell + 8;
                      const y = (item.row + 1) * cell + 8;
                      return (
                        <path
                          key={`x-${item.wellId}`}
                          aria-hidden="true"
                          d={`M${x},${y} l${cell - 16},${cell - 16} M${x + cell - 16},${y} l${-(cell - 16)},${cell - 16}`}
                          className="pointer-events-none stroke-text-muted"
                          strokeWidth={1.5}
                        />
                      );
                    })}
                </svg>
              </section>
              <ul
                aria-label={t`Plate legend`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-text-muted"
              >
                <li className="inline-flex items-center gap-1.5">
                  <span>{formatCount(1)}</span>
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-24 rounded-sm"
                    style={{ backgroundImage: `linear-gradient(to right, ${ramp.join(", ")})` }}
                  />
                  <span>{targetsWithDataLabel(maxTargets)}</span>
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="relative inline-block size-3.5 shrink-0 rounded-sm border border-border"
                    style={{ backgroundColor: EMPTY_CELL[resolved] }}
                  >
                    <span className="absolute top-1/2 left-1/2 h-px w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-text-muted" />
                    <span className="absolute top-1/2 left-1/2 h-px w-2.5 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-text-muted" />
                  </span>
                  {t`No data`}
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3.5 shrink-0 rounded-sm border border-dashed border-border"
                  />
                  {t`Empty well`}
                </li>
              </ul>
            </figure>
          );
        })}
        {activeId === null || activeSample === null ? null : (
          <div
            ref={tooltipRef}
            className="pointer-events-none absolute top-0 left-0 z-10 w-max max-w-64 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text shadow-md"
          >
            <div className="text-xs text-text-muted">{activeCoord}</div>
            <div className="font-medium break-all">{activeSample.name}</div>
            <div className="text-text-muted">{targetsWithDataLabel(activeTargets)}</div>
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {rawLive === null || liveSample === null
          ? ""
          : plural(liveTargets, {
              one: `${livePlate}, well ${liveCoord}, ${liveSampleName}: # target with data.`,
              other: `${livePlate}, well ${liveCoord}, ${liveSampleName}: # targets with data.`,
            })}
      </p>
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
  const hoverTargetCount = hover?.targets ?? 0;

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
      <figure className="flex min-w-0 flex-col gap-2">
        <p className="sr-only">{t`Targets with data against parasite density for ${pointCount} samples. The sample table gives the same figures.`}</p>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full"
          style={{ maxWidth: width }}
          aria-hidden="true"
        >
          {ticks.map((tick, index) => (
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
                textAnchor={index === ticks.length - 1 ? "end" : "middle"}
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
            x={(width + pad.left - pad.right) / 2}
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
              {formatCount(value)}
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
            : t`${hoverName}: ${hoverDensity} per µL, ${plural(hoverTargetCount, {
                one: "# target with data",
                other: "# targets with data",
              })}.`}
        </p>
      </figure>
    </section>
  );
}

/** Props for {@link StagesView}. */
export interface StagesViewProps extends QualityViewProps {
  /** Offers a browser-side download of the pipeline stage table. */
  readonly download?: SortableTableDownload;
}

/** Reads at each pipeline stage: where reads are lost between demultiplexing and the final calls. */
export function StagesView({ summary, headingId, download }: StagesViewProps) {
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
        searchableColumns={["name"]}
        searchPlaceholder={t`Search sample`}
        download={download}
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
