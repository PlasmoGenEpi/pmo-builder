import { plural, t } from "@lingui/core/macro";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import type { TableFormat } from "@/domain/tools/types";
import { Button, TextField, cn, formatCount } from "@/ui";

import { downloadDelimitedTable } from "./exportTable";

/** A table shows a search input only when it has more than this many rows. */
const SEARCH_ROW_THRESHOLD = 5;

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

/** Options for downloading a {@link SortableTable}'s rows as shown. */
export interface SortableTableDownload {
  /** File name without extension, such as `"study-summary-targets"`. */
  readonly fileName: string;
  /** Delimited format. Defaults to `"csv"`. */
  readonly format?: TableFormat;
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
  /**
   * Scrolls the matching row into view inside the table's scroll container,
   * clearing an active search first if it hides that row. Increment `seq` to
   * scroll to the same key again.
   */
  readonly scrollToRow?: { readonly key: string; readonly seq: number } | null;
  /** The column sorted by at first, and its direction. */
  readonly initialSort?: { readonly key: string; readonly descending: boolean };
  /** Column keys searched when the table has more than a handful of rows. */
  readonly searchableColumns?: readonly string[];
  /** Placeholder shown inside the search input. */
  readonly searchPlaceholder?: string;
  /** Offers a browser-side download of the rows as shown, with the headings as on screen. */
  readonly download?: SortableTableDownload;
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
  scrollToRow = null,
  initialSort,
  searchableColumns,
  searchPlaceholder,
  download,
}: SortableTableProps<Row>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [query, setQuery] = useState("");
  const [handledScrollSeq, setHandledScrollSeq] = useState<number | null>(null);
  const tableId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRegionRef = useRef<HTMLElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const rowElements = useRef(new Map<string, HTMLTableRowElement>());
  const lastScrolledSeq = useRef<number | null>(null);

  const showSearch =
    searchableColumns !== undefined &&
    searchableColumns.length > 0 &&
    rows.length > SEARCH_ROW_THRESHOLD;
  const showToolbar = showSearch || searchableColumns !== undefined || download !== undefined;
  const activeQuery = showSearch ? query.trim().toLowerCase() : "";

  const filtered = useMemo(() => {
    if (activeQuery === "" || searchableColumns === undefined) return rows;
    const targets = columns.filter((column) => searchableColumns.includes(column.key));
    if (targets.length === 0) return rows;
    return rows.filter((row) =>
      targets.some((column) => {
        const value = column.value(row);
        return value !== null && String(value).toLowerCase().includes(activeQuery);
      }),
    );
  }, [rows, columns, searchableColumns, activeQuery]);

  if (scrollToRow !== null && scrollToRow.seq !== handledScrollSeq) {
    setHandledScrollSeq(scrollToRow.seq);
    if (
      activeQuery !== "" &&
      rows.some((row) => rowKey(row) === scrollToRow.key) &&
      !filtered.some((row) => rowKey(row) === scrollToRow.key)
    ) {
      setQuery("");
    }
  }

  const sorted = useMemo(() => {
    const column = columns.find((candidate) => candidate.key === sort?.key);
    if (column === undefined || sort === null) return filtered;
    return filtered.toSorted((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      const order = compareValues(left, right);
      return sort.descending ? -order : order;
    });
  }, [filtered, columns, sort]);

  const scrollTargetPresent =
    scrollToRow !== null && sorted.some((row) => rowKey(row) === scrollToRow.key);

  useEffect(() => {
    if (
      scrollToRow === null ||
      !scrollTargetPresent ||
      lastScrolledSeq.current === scrollToRow.seq
    ) {
      return;
    }
    const container = scrollRegionRef.current;
    const rowElement = rowElements.current.get(scrollToRow.key);
    if (container === null || rowElement === undefined) return;
    lastScrolledSeq.current = scrollToRow.seq;

    const headerHeight = theadRef.current?.offsetHeight ?? 0;
    const containerRect = container.getBoundingClientRect();
    const rowRect = rowElement.getBoundingClientRect();
    const visibleTop = containerRect.top + headerHeight;
    const visibleBottom = containerRect.bottom;
    let targetTop = container.scrollTop;
    if (rowRect.top < visibleTop) {
      targetTop += rowRect.top - visibleTop;
    } else if (rowRect.bottom > visibleBottom) {
      targetTop += rowRect.bottom - visibleBottom;
    } else {
      return;
    }
    const clampedTop = Math.max(0, targetTop);
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: clampedTop, behavior: reducedMotion ? "auto" : "smooth" });
    } else {
      container.scrollTop = clampedTop;
    }
  }, [scrollToRow, scrollTargetPresent]);

  const title = label;
  const format: TableFormat = download?.format ?? "csv";
  const total = rows.length;
  const shownCount = formatCount(sorted.length);
  const totalCount = formatCount(total);

  function clearSearch(): void {
    setQuery("");
    searchInputRef.current?.focus();
  }

  function handleDownload(): void {
    if (download === undefined) return;
    downloadDelimitedTable({
      headers: columns.map((column) => column.label),
      rows: sorted.map((row) => columns.map((column) => column.value(row))),
      fileName: download.fileName,
      format,
    });
  }

  const tableRegion = (
    <section
      ref={scrollRegionRef}
      aria-label={label}
      // Focusable so keyboard users can scroll it.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="max-h-[28rem] overflow-auto rounded-lg border border-border focus-visible:outline-offset-0"
    >
      <table id={tableId} className="w-full border-collapse text-sm" aria-label={label}>
        <thead ref={theadRef} className="sticky top-0 z-10 bg-surface-subtle">
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
                    wrap
                    className={cn(
                      "-mx-2.5",
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
                    {column.label}
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                  </Button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && activeQuery !== "" ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-6 text-center text-sm text-text-muted"
              >
                {t`Nothing matches the search.`}
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const key = rowKey(row);
              const selected = key === selectedKey;
              return (
                <tr
                  key={key}
                  ref={(node) => {
                    if (node === null) {
                      rowElements.current.delete(key);
                    } else {
                      rowElements.current.set(key, node);
                    }
                  }}
                  aria-current={selected && onRowSelect === undefined ? "true" : undefined}
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
                        index === 0 && selected && "border-l-4 border-l-accent",
                        index === 0 && selected && onRowSelect === undefined && "font-medium",
                      )}
                    >
                      {index === 0 && onRowSelect !== undefined ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          wrap
                          aria-pressed={selected}
                          className="-mx-2.5 justify-start text-left text-accent-text"
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
            })
          )}
        </tbody>
      </table>
    </section>
  );

  if (!showToolbar) return tableRegion;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showSearch ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:max-w-xs">
            <TextField
              label={t`Search ${label}`}
              hideLabel
              type="search"
              placeholder={searchPlaceholder ?? t`Search ${label}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-controls={tableId}
              ref={searchInputRef}
              className="min-w-0 flex-1"
            />
            {query !== "" ? (
              <Button
                size="sm"
                variant="ghost"
                icon={X}
                aria-label={t`Clear search for ${label}`}
                onClick={clearSearch}
              >
                {t({ message: "Clear", comment: "Verb: clear a table search box" })}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:ml-auto">
          <p className="text-sm text-text-muted tabular-nums" aria-live="polite">
            {plural(total, {
              one: `Showing ${shownCount} of ${totalCount} row`,
              other: `Showing ${shownCount} of ${totalCount} rows`,
            })}
          </p>
          {download === undefined ? null : (
            <Button
              size="sm"
              variant="secondary"
              icon={Download}
              disabled={sorted.length === 0}
              aria-label={t`Download ${title} as ${format}`}
              onClick={handleDownload}
            >
              {t`Download`}
            </Button>
          )}
        </div>
      </div>
      {tableRegion}
    </div>
  );
}
