import { t } from "@lingui/core/macro";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { Button, cn } from "@/ui";

/** One column of a {@link SortableTable}. */
export interface SortableColumn<Row> {
  readonly key: string;
  readonly label: string;
  /** What the column sorts by. */
  readonly value: (row: Row) => string | number | null;
  /** How a cell shows. Default: the value. */
  readonly render?: (row: Row) => ReactNode;
  /** Inline style for a cell, such as value shading. Omit or return `undefined` to leave unstyled. */
  readonly cellStyle?: (row: Row) => CSSProperties | undefined;
  /** Right-aligned, for numbers. */
  readonly numeric?: boolean;
}

/** Props for {@link SortableTable}. */
export interface SortableTableProps<Row> {
  /** Names the table for screen readers. */
  readonly label: string;
  readonly columns: readonly SortableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** Makes rows choosable; the chosen one is marked. */
  readonly onRowSelect?: (row: Row) => void;
  readonly selectedKey?: string | null;
  /** The column sorted by at first, and its direction. */
  readonly initialSort?: { readonly key: string; readonly descending: boolean };
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** A table whose columns sort when their heading is chosen. Missing values sort last. */
export function SortableTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  onRowSelect,
  selectedKey = null,
  initialSort,
}: SortableTableProps<Row>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    const column = columns.find((candidate) => candidate.key === sort?.key);
    if (column === undefined || sort === null) return rows;
    return rows.toSorted((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      const order = compareValues(left, right);
      return sort.descending ? -order : order;
    });
  }, [rows, columns, sort]);

  return (
    <section
      aria-label={label}
      // Focusable so keyboard users can scroll it.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="max-h-[28rem] overflow-auto rounded-lg border border-border focus-visible:outline-offset-0"
    >
      <table className="w-full border-collapse text-sm" aria-label={label}>
        <thead className="sticky top-0 z-10 bg-surface-subtle">
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const Icon = !active ? ArrowUpDown : sort.descending ? ArrowDown : ArrowUp;
              const columnLabel = column.label;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={!active ? "none" : sort.descending ? "descending" : "ascending"}
                  className={cn(
                    "border-b border-border px-3 py-2 align-bottom font-medium text-text-muted",
                    column.numeric ? "text-right" : "text-left",
                  )}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "-mx-2.5 h-auto! max-w-full py-1 font-medium",
                      column.numeric ? "justify-end text-right" : "justify-start text-left",
                    )}
                    aria-label={t`Sort by ${columnLabel}`}
                    onClick={() =>
                      setSort((before) => ({
                        key: column.key,
                        descending:
                          before?.key === column.key ? !before.descending : column.numeric === true,
                      }))
                    }
                  >
                    <span className="whitespace-normal">{column.label}</span>
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                  </Button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const key = rowKey(row);
            const selected = key === selectedKey;
            return (
              <tr
                key={key}
                data-selected={selected || undefined}
                onClick={onRowSelect === undefined ? undefined : () => onRowSelect(row)}
                className={cn(
                  "border-b border-border last:border-b-0",
                  onRowSelect !== undefined && "cursor-pointer hover:bg-surface-muted",
                  selected && "bg-accent-subtle",
                )}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    style={column.cellStyle?.(row)}
                    className={cn(
                      "px-3 py-1.5 text-text",
                      column.numeric ? "text-right tabular-nums" : "break-all",
                      selected &&
                        (index === 0
                          ? "bg-accent-subtle shadow-[inset_3px_0_0_var(--color-accent),inset_0_1px_0_var(--color-accent),inset_0_-1px_0_var(--color-accent)]"
                          : "shadow-[inset_0_1px_0_var(--color-accent),inset_0_-1px_0_var(--color-accent)]"),
                    )}
                  >
                    {index === 0 && onRowSelect !== undefined ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={selected}
                        className="-mx-2.5 h-auto! max-w-full justify-start py-0.5 text-left font-medium text-accent-text"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRowSelect(row);
                        }}
                      >
                        <span className="whitespace-normal">
                          {column.render?.(row) ?? column.value(row)}
                        </span>
                      </Button>
                    ) : (
                      (column.render?.(row) ?? column.value(row) ?? "–")
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
