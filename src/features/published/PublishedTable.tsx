import { t } from "@lingui/core/macro";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Link as RouterLink } from "wouter";

import type { PublishedDataset } from "@/domain/repository/types";
import { Button, cn, formatCount } from "@/ui";

import { shortAuthors, taxonName, yearsText, type SortOrder } from "./catalogue";

/** Props for {@link PublishedTable}. */
export interface PublishedTableProps {
  /** Datasets to show, already filtered and ordered. */
  readonly datasets: readonly PublishedDataset[];
  /** Current sort order, shared with the sort menu above the table. */
  readonly sort: SortOrder;
  /** Called when the user sorts by a column header. */
  readonly onSortChange: (sort: SortOrder) => void;
  /** Called when the user opens a dataset so the list can remember its scroll offset. */
  readonly onOpenDataset: () => void;
}

type TableSortOrder = Exclude<SortOrder, "newest">;

function SortHeader({
  label,
  order,
  direction,
  activeSort,
  numeric = false,
  onSortChange,
}: {
  readonly label: string;
  readonly order: TableSortOrder;
  readonly direction: "ascending" | "descending";
  readonly activeSort: SortOrder;
  readonly numeric?: boolean;
  readonly onSortChange: (sort: SortOrder) => void;
}) {
  const active = activeSort === order;
  const Icon = !active ? ArrowUpDown : direction === "ascending" ? ArrowUp : ArrowDown;
  const columnLabel = label;
  return (
    <th
      scope="col"
      aria-sort={active ? direction : "none"}
      className={cn(
        "border-b border-border px-3 py-2 font-medium whitespace-nowrap text-text-muted",
        numeric ? "text-right" : "text-left",
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={t`Sort by ${columnLabel}`}
        onClick={() => onSortChange(order)}
        className={cn(
          "-mx-2 h-auto px-2 py-0.5 font-medium",
          active ? "text-text" : "text-text-muted",
        )}
      >
        {label}
        <Icon aria-hidden="true" className={cn("size-3.5", active && "text-accent-text")} />
      </Button>
    </th>
  );
}

function emptyCell() {
  return <span className="text-text-subtle">–</span>;
}

/**
 * Table view of published PMOs with sortable headers synced to {@link SortOrder}
 * and a focusable horizontal scroll wrapper so narrow viewports never scroll sideways.
 */
export function PublishedTable({
  datasets,
  sort,
  onSortChange,
  onOpenDataset,
}: PublishedTableProps) {
  return (
    <section
      aria-label={t`Published PMOs table`}
      // Focusable so keyboard users can scroll horizontally on narrow screens.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="overflow-x-auto rounded-xl border border-border bg-surface shadow-xs focus-visible:outline-offset-0"
    >
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-subtle">
          <tr>
            <SortHeader
              label={t`Title`}
              order="title"
              direction="ascending"
              activeSort={sort}
              onSortChange={onSortChange}
            />
            <th
              scope="col"
              className="border-b border-border px-3 py-2 text-left font-medium whitespace-nowrap text-text-muted"
            >
              {t`First author`}
            </th>
            <th
              scope="col"
              className="border-b border-border px-3 py-2 text-left font-medium whitespace-nowrap text-text-muted"
            >
              {t`Country`}
            </th>
            <SortHeader
              label={t`Collection years`}
              order="year"
              direction="descending"
              activeSort={sort}
              onSortChange={onSortChange}
            />
            <th
              scope="col"
              className="border-b border-border px-3 py-2 text-left font-medium whitespace-nowrap text-text-muted"
            >
              {t`Panel`}
            </th>
            <th
              scope="col"
              className="border-b border-border px-3 py-2 text-left font-medium whitespace-nowrap text-text-muted"
            >
              {t`Species`}
            </th>
            <SortHeader
              label={t`Specimens`}
              order="specimens"
              direction="descending"
              activeSort={sort}
              numeric
              onSortChange={onSortChange}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {datasets.map((dataset) => {
            const authors = shortAuthors(dataset.creators);
            const allAuthors =
              dataset.creators.length > 2 ? dataset.creators.join("; ") : undefined;
            const countries = dataset.countries.join(", ");
            const years = yearsText(dataset);
            const panels = dataset.panels.join(", ");
            const species = dataset.taxa.map(taxonName).join(", ");
            return (
              <tr
                key={dataset.id}
                className="transition-colors duration-100 hover:bg-surface-subtle"
              >
                <th
                  scope="row"
                  className="min-w-60 max-w-96 px-3 py-2 text-left align-top font-normal text-text"
                >
                  <RouterLink
                    href={`/published/${dataset.id}`}
                    onClick={onOpenDataset}
                    title={dataset.title}
                    className="line-clamp-2 rounded-sm font-medium text-text underline-offset-2 hover:text-accent-text hover:underline"
                  >
                    {dataset.title}
                  </RouterLink>
                </th>
                <td
                  className="min-w-36 max-w-48 truncate px-3 py-2 align-top text-text-muted"
                  title={allAuthors ?? (authors === "" ? undefined : authors)}
                >
                  {authors === "" ? emptyCell() : authors}
                </td>
                <td
                  className="min-w-36 max-w-52 px-3 py-2 align-top text-text-muted"
                  title={dataset.countries.length > 1 ? countries : undefined}
                >
                  {countries === "" ? (
                    emptyCell()
                  ) : (
                    <span className="line-clamp-2">{countries}</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-text-muted tabular-nums">
                  {years ?? emptyCell()}
                </td>
                <td className="min-w-28 max-w-44 px-3 py-2 align-top text-text-muted">
                  {panels === "" ? emptyCell() : <span className="line-clamp-2">{panels}</span>}
                </td>
                <td className="min-w-44 max-w-56 px-3 py-2 align-top text-text-muted">
                  {species === "" ? emptyCell() : <span className="line-clamp-2">{species}</span>}
                </td>
                <td className="px-3 py-2 text-right align-top font-medium whitespace-nowrap text-text tabular-nums">
                  {formatCount(dataset.summary.specimens)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
