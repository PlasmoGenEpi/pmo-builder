import { t } from "@lingui/core/macro";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button, cn } from "@/ui";

/** One column of a {@link SortableTable}. */
export interface SortableColumn<Row> {
  readonly key: string;
  readonly label: string;
  /** What the column sorts by. */
  readonly value: (row: Row) => string | number | null;
  /** How a cell shows. Default: the value. */
  readonly render?: (row: Row) => ReactNode;
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

function compare(a: string | number | null, b: string | number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
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
      const order = compare(column.value(a), column.value(b));
      return sort.descending ? -order : order;
    });
  }, [rows, columns, sort]);

  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
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
                    "border-b border-border px-3 py-2 font-medium text-text-muted",
                    column.numeric ? "text-right" : "text-left",
                  )}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mx-2 h-auto px-2 py-0.5 font-medium"
                    aria-label={t`Sort by ${columnLabel}`}
                    onClick={() =>
                      setSort((before) => ({
                        key: column.key,
                        descending:
                          before?.key === column.key ? !before.descending : column.numeric === true,
                      }))
                    }
                  >
                    {column.label}
                    <Icon aria-hidden="true" className="size-3.5" />
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
                aria-selected={onRowSelect === undefined ? undefined : selected}
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
                    className={cn(
                      "px-3 py-1.5 text-text",
                      column.numeric ? "text-right tabular-nums" : "break-all",
                    )}
                  >
                    {index === 0 && onRowSelect !== undefined ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-mx-2 h-auto px-2 py-0.5 text-left font-medium whitespace-normal text-accent-text"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRowSelect(row);
                        }}
                      >
                        {column.render?.(row) ?? column.value(row)}
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
    </div>
  );
}
