import { useId } from "react";

import { cn } from "./cn";
import { formatCount } from "./format";

/** A cell value as it comes from an imported table. */
export type CellValue = string | number | boolean | null;

const heights = { sm: "max-h-64", md: "max-h-[28rem]", lg: "max-h-[40rem]" } as const;

/** Props for {@link DataTable}. */
export interface DataTableProps {
  /** Accessible name, such as "Preview of the allele table". */
  label: string;
  columns: readonly string[];
  rows: readonly Readonly<Record<string, CellValue>>[];
  /** Rows in the whole table, when `rows` is only the first part of it. */
  totalRows?: number;
  /**
   * Columns to highlight, each with a short label shown under its header,
   * such as the field the column is mapped to.
   */
  highlightedColumns?: Readonly<Record<string, string>>;
  /** Overrides the caption under the table. */
  caption?: string;
  height?: keyof typeof heights;
  className?: string;
}

function isBlank(value: CellValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function rowCaption(shown: number, total: number | undefined): string {
  if (total !== undefined && total > shown) {
    return `Showing ${formatCount(shown)} of ${formatCount(total)} rows`;
  }
  return `${formatCount(shown)} ${shown === 1 ? "row" : "rows"}`;
}

/**
 * A read-only preview of a table. The header and row numbers stay in view
 * while the table scrolls inside its own box. Long cells are cut short and
 * show their full value on hover. Blank cells read "blank".
 */
export function DataTable({
  label,
  columns,
  rows,
  totalRows,
  highlightedColumns,
  caption,
  height = "md",
  className,
}: DataTableProps) {
  const captionId = useId();
  const highlights = highlightedColumns ?? {};
  const captionText = caption ?? rowCaption(rows.length, totalRows);

  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      <section
        aria-label={label}
        aria-describedby={captionId}
        // Focusable so keyboard users can scroll it.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className={cn(
          "overflow-auto rounded-lg border border-border bg-surface focus-visible:outline-offset-0",
          heights[height],
        )}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-20 border-r border-b border-border bg-surface-subtle px-3 py-2 text-right font-normal text-text-subtle"
              >
                <span className="sr-only">Row</span>
                <span aria-hidden="true">#</span>
              </th>
              {columns.map((column) => {
                const mapped = highlights[column];
                return (
                  <th
                    key={column}
                    scope="col"
                    className={cn(
                      "sticky top-0 z-10 max-w-64 border-b border-border px-3 py-2 text-left align-bottom font-medium whitespace-nowrap",
                      mapped === undefined
                        ? "bg-surface-subtle text-text"
                        : "border-b-accent bg-accent-subtle text-text shadow-[inset_0_-1px_0_var(--color-accent)]",
                    )}
                  >
                    <span className="block truncate font-mono text-xs" title={column}>
                      {column}
                    </span>
                    {mapped === undefined ? null : (
                      <span className="mt-0.5 block truncate text-xs font-medium text-accent-text">
                        <span className="sr-only">mapped to </span>
                        {mapped}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              // Preview rows have no identity of their own.
              // oxlint-disable-next-line react/no-array-index-key
              <tr key={rowIndex} className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-[5] border-r border-b border-border bg-surface-subtle px-3 py-1.5 text-right font-normal text-text-subtle tabular-nums group-last:border-b-0"
                >
                  {formatCount(rowIndex + 1)}
                </th>
                {columns.map((column) => {
                  const value = row[column];
                  const blank = isBlank(value);
                  const text = blank ? "" : String(value);
                  return (
                    <td
                      key={column}
                      className={cn(
                        "max-w-64 truncate border-b border-border px-3 py-1.5 text-text tabular-nums group-last:border-b-0 group-hover:bg-surface-subtle",
                        highlights[column] !== undefined && "bg-accent-subtle/40",
                      )}
                      title={blank ? undefined : text}
                    >
                      {blank ? <span className="text-text-subtle italic">blank</span> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <figcaption id={captionId} className="text-sm text-text-muted">
        {captionText}
      </figcaption>
    </figure>
  );
}
