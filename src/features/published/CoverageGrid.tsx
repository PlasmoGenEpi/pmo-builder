import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useTheme } from "@/app/theme";
import type { PublishedDataset } from "@/domain/repository/types";
import { cn, Disclosure, EMPTY_CELL, formatCount, rampColour, SEQUENTIAL } from "@/ui";

import { buildCoverage, cellIntensity, type CoverageCell } from "./coverage";

/** Props for {@link CoverageGrid}. */
export interface CoverageGridProps {
  /** Published PMOs matching the active non-coverage filters (`search`, `panel`, `species`). */
  readonly datasets: readonly PublishedDataset[];
  /** Currently chosen countries in the list filters. */
  readonly selectedCountries: readonly string[];
  /** Currently chosen collection year in the list filters, or `null` for any year. */
  readonly selectedYear: number | null;
  /** Called when the user chooses a country-by-year cell. */
  readonly onSelectCell: (country: string, year: number) => void;
  /** Whether the collapsible grid starts expanded. Defaults to `false`. */
  readonly defaultOpen?: boolean;
}

interface CellCoords {
  readonly row: number;
  readonly col: number;
}

interface CellKey {
  readonly country: string;
  readonly year: number;
}

function cellAccessibleLabel(cell: CoverageCell): string {
  const { country, year } = cell;
  if (cell.datasets === 0) {
    return t({
      message: `${country}, ${year}: 0 specimens`,
      comment: "Accessible description of an empty cell in the coverage grid",
    });
  }
  const specimensText = plural(cell.specimens, { one: "# specimen", other: "# specimens" });
  const pmosText = plural(cell.datasets, { one: "# published PMO", other: "# published PMOs" });
  return t({
    message: `${country}, ${year}: ${specimensText} in ${pmosText}`,
    comment: "Accessible description of a populated cell in the coverage grid",
  });
}

function Readout({ cell }: { readonly cell: CoverageCell | null }) {
  if (cell === null) {
    return (
      <p
        data-testid="coverage-readout"
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-muted"
      >
        <Trans>
          Move to a cell to read its figures. Choose a cell to filter by country and year.
        </Trans>
      </p>
    );
  }
  const { country, year } = cell;
  if (cell.datasets === 0) {
    return (
      <p
        data-testid="coverage-readout"
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-muted tabular-nums"
      >
        <Trans>
          <strong className="font-medium text-text">
            {country}, {year}:
          </strong>{" "}
          0 specimens
        </Trans>
      </p>
    );
  }
  const specimensText = plural(cell.specimens, { one: "# specimen", other: "# specimens" });
  const pmosText = plural(cell.datasets, { one: "# published PMO", other: "# published PMOs" });
  return (
    <p
      data-testid="coverage-readout"
      className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-muted tabular-nums"
    >
      <Trans>
        <strong className="font-medium text-text">
          {country}, {year}:
        </strong>{" "}
        {specimensText} in {pmosText}
      </Trans>
    </p>
  );
}

/**
 * Collapsible country-by-collection-year coverage grid shaded by specimen
 * count. Every cell exposes its figure as text, updates a high-contrast
 * readout on hover or focus, can be reached with arrow keys, and filters the
 * published PMOs list to its country and year when chosen.
 */
export function CoverageGrid({
  datasets,
  selectedCountries,
  selectedYear,
  onSelectCell,
  defaultOpen = false,
}: CoverageGridProps) {
  const { resolved } = useTheme();
  const matrix = useMemo(() => buildCoverage(datasets), [datasets]);
  const [activeCoords, setActiveCoords] = useState<CellCoords>({ row: 0, col: 0 });
  const [inspected, setInspected] = useState<CellKey | null>(null);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const rowCount = matrix.rows.length;
  const colCount = matrix.years.length;
  const clampedRow = Math.min(activeCoords.row, Math.max(0, rowCount - 1));
  const clampedCol = Math.min(activeCoords.col, Math.max(0, colCount - 1));

  const soleCountry = selectedCountries.length === 1 ? (selectedCountries[0] ?? null) : null;

  const findCell = (key: CellKey | null): CoverageCell | null => {
    if (key === null) return null;
    const row = matrix.rows.find((item) => item.country === key.country);
    if (row === undefined) return null;
    return row.cells.find((item) => item.year === key.year) ?? null;
  };

  const selectedCell =
    soleCountry !== null && selectedYear !== null
      ? findCell({ country: soleCountry, year: selectedYear })
      : null;
  const readoutCell = findCell(inspected) ?? selectedCell;

  const firstYear = matrix.years[0];
  const lastYear = matrix.years.at(-1);
  const summaryText = (() => {
    if (rowCount === 0 || firstYear === undefined || lastYear === undefined) {
      return t`No matching data`;
    }
    const countriesLabel = plural(matrix.countries.length, {
      one: "# country",
      other: "# countries",
    });
    const yearsRange = firstYear === lastYear ? String(firstYear) : t`${firstYear} to ${lastYear}`;
    return t({
      message: `${countriesLabel}, ${yearsRange}`,
      comment: "Summary in the coverage grid header: country count and collection year range",
    });
  })();

  const moveFocus = (nextRow: number, nextCol: number) => {
    setActiveCoords({ row: nextRow, col: nextCol });
    const button = cellRefs.current.get(`${nextRow}:${nextCol}`);
    if (button !== undefined) {
      button.focus();
      if (typeof button.scrollIntoView === "function") {
        button.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  };

  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    rowIndex: number,
    colIndex: number,
  ) => {
    let nextRow = rowIndex;
    let nextCol = colIndex;
    if (event.key === "ArrowRight") {
      nextCol = Math.min(colCount - 1, colIndex + 1);
    } else if (event.key === "ArrowLeft") {
      nextCol = Math.max(0, colIndex - 1);
    } else if (event.key === "ArrowDown") {
      nextRow = Math.min(rowCount - 1, rowIndex + 1);
    } else if (event.key === "ArrowUp") {
      nextRow = Math.max(0, rowIndex - 1);
    } else if (event.key === "Home") {
      nextRow = event.ctrlKey || event.metaKey ? 0 : rowIndex;
      nextCol = 0;
    } else if (event.key === "End") {
      nextRow = event.ctrlKey || event.metaKey ? rowCount - 1 : rowIndex;
      nextCol = colCount - 1;
    } else {
      return;
    }
    event.preventDefault();
    moveFocus(nextRow, nextCol);
  };

  const ramp = SEQUENTIAL[resolved];
  const emptyFill = EMPTY_CELL[resolved];
  const maxSpecimensText = formatCount(matrix.maxSpecimens);

  return (
    <Disclosure
      title={t`Coverage by country and year`}
      summary={summaryText}
      defaultOpen={defaultOpen}
      className="min-w-0"
    >
      {rowCount === 0 ? (
        <p className="text-sm text-text-muted">
          <Trans>No matching published PMOs have both a country and a collection year.</Trans>
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <Readout cell={readoutCell} />
          <div
            data-testid="coverage-scroll"
            className="max-h-96 w-full max-w-full overflow-auto rounded-lg border border-border bg-surface"
          >
            <table
              aria-label={t`Specimens by country and collection year`}
              className="w-max border-separate border-spacing-0 text-xs"
            >
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky top-0 left-0 z-20 border-r border-b border-border bg-surface-subtle px-3 py-2 text-left font-medium text-text"
                  >
                    <Trans>Country</Trans>
                  </th>
                  {matrix.years.map((year) => (
                    <th
                      key={year}
                      scope="col"
                      className="sticky top-0 z-10 border-b border-border bg-surface-subtle px-1 py-2 text-center font-medium text-text-muted tabular-nums"
                    >
                      {year}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row, rowIndex) => (
                  <tr key={row.country} className="group">
                    <th
                      scope="row"
                      title={row.country}
                      className="sticky left-0 z-10 max-w-36 truncate border-r border-b border-border bg-surface px-3 py-1 text-left font-medium text-text group-last:border-b-0 sm:max-w-44"
                    >
                      {row.country}
                    </th>
                    {row.cells.map((cell, colIndex) => {
                      const isSelected = soleCountry === cell.country && selectedYear === cell.year;
                      const isRovingTarget = rowIndex === clampedRow && colIndex === clampedCol;
                      const fill =
                        cell.specimens > 0
                          ? rampColour(ramp, cellIntensity(cell.specimens, matrix.maxSpecimens))
                          : emptyFill;
                      const refKey = `${rowIndex}:${colIndex}`;
                      const label = cellAccessibleLabel(cell);
                      return (
                        <td
                          key={cell.year}
                          className="border-b border-border/50 p-0.5 text-center group-last:border-b-0"
                        >
                          <button
                            ref={(node) => {
                              if (node === null) cellRefs.current.delete(refKey);
                              else cellRefs.current.set(refKey, node);
                            }}
                            type="button"
                            aria-label={label}
                            tabIndex={isRovingTarget ? 0 : -1}
                            aria-pressed={isSelected}
                            style={{ backgroundColor: fill }}
                            onClick={() => onSelectCell(cell.country, cell.year)}
                            onMouseEnter={() =>
                              setInspected({ country: cell.country, year: cell.year })
                            }
                            onMouseLeave={() =>
                              setInspected((current) =>
                                current?.country === cell.country && current.year === cell.year
                                  ? null
                                  : current,
                              )
                            }
                            onFocus={() => {
                              setActiveCoords({ row: rowIndex, col: colIndex });
                              setInspected({ country: cell.country, year: cell.year });
                            }}
                            onBlur={(event) => {
                              const nextTarget = event.relatedTarget;
                              if (
                                nextTarget instanceof Node &&
                                event.currentTarget.closest("table")?.contains(nextTarget)
                              ) {
                                return;
                              }
                              setInspected(null);
                            }}
                            onKeyDown={(event) => handleCellKeyDown(event, rowIndex, colIndex)}
                            className={cn(
                              "relative mx-auto block h-6 w-8 cursor-pointer rounded-xs border transition-transform duration-100 hover:scale-105 focus-visible:z-10",
                              isSelected
                                ? "z-10 border-text ring-2 ring-text ring-offset-1 ring-offset-surface"
                                : "border-border/60",
                            )}
                          >
                            <span className="sr-only">{label}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-3.5 rounded-sm border border-border"
                style={{ backgroundColor: emptyFill }}
              />
              <Trans>0 specimens</Trans>
            </span>
            {matrix.maxSpecimens > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="tabular-nums">1</span>
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-28 rounded-sm border border-border"
                  style={{ background: `linear-gradient(to right, ${ramp.join(", ")})` }}
                />
                <span className="tabular-nums">{t`${maxSpecimensText} specimens (log scale)`}</span>
              </span>
            ) : null}
          </div>
        </div>
      )}
    </Disclosure>
  );
}
