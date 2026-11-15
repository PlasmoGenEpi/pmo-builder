import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  FlaskConical,
  MapPin,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link as RouterLink } from "wouter";

import { PageContainer } from "@/app/PageContainer";
import type { PublishedDataset } from "@/domain/repository/types";
import { communityUrl, zenodoConfig, type ZenodoConfig } from "@/features/review/zenodo";
import { buttonClassName, cn, EmptyState, formatCount, inputClassName, Link, Select } from "@/ui";

import {
  facetsOf,
  filterDatasets,
  longDate,
  NO_FILTERS,
  totalsOf,
  yearsText,
  type CatalogueFilters,
} from "./catalogue";
import { CatalogueProblem } from "./CatalogueProblem";
import { loadSharedCatalogue, useCatalogue, type CatalogueLoader } from "./useCatalogue";

/** The `Select` value that stands for "no limit". Radix does not allow an empty one. */
const ANY = "any";

function plural(value: number, singular: string): string {
  return `${formatCount(value)} ${value === 1 ? singular : `${singular}s`}`;
}

/** A fact about a dataset with the icon that says what kind it is. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  readonly icon: LucideIcon;
  /** What the fact is, for screen readers: "Panel", "Country" or "Collected". */
  readonly label: string;
  readonly children: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-text-muted">
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
      <span className="sr-only">{label}: </span>
      {children}
    </span>
  );
}

/** One dataset in the list. The whole row opens its page. */
function DatasetRow({ dataset }: { readonly dataset: PublishedDataset }) {
  const years = yearsText(dataset);
  const year = /^\d{4}/.exec(dataset.published)?.[0];
  return (
    <article className="group relative flex items-center gap-5 px-5 py-4 transition-colors duration-100 hover:bg-surface-subtle sm:px-6 sm:py-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-md font-semibold text-pretty text-text">
          <RouterLink
            href={`/published/${dataset.id}`}
            className="rounded-sm underline-offset-2 group-hover:text-accent-text after:absolute after:inset-0"
          >
            {dataset.title}
          </RouterLink>
        </h3>
        <p className="text-base text-text-muted">
          {[dataset.creators.join("; "), year]
            .filter((part) => part !== undefined && part !== "")
            .join(" · ")}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          <span className="text-sm font-medium text-text sm:hidden">
            {plural(dataset.summary.specimens, "specimen")}
          </span>
          {dataset.panels.length === 0 ? null : (
            <Fact icon={FlaskConical} label="Panel">
              {dataset.panels.join(", ")}
            </Fact>
          )}
          {dataset.countries.length === 0 ? null : (
            <Fact icon={MapPin} label="Country">
              {dataset.countries.join(", ")}
            </Fact>
          )}
          {years === null ? null : (
            <Fact icon={CalendarDays} label="Collected">
              {years}
            </Fact>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right max-sm:hidden">
        <span className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold tracking-tight text-text tabular-nums">
            {formatCount(dataset.summary.specimens)}
          </span>
          <span className="text-sm text-text-muted">
            {dataset.summary.specimens === 1 ? "specimen" : "specimens"}
          </span>
        </span>
        <span className="text-sm text-text-subtle">
          {plural(dataset.summary.targets, "target")}
        </span>
      </div>
      <ChevronRight
        aria-hidden="true"
        className="size-4.5 shrink-0 text-text-subtle transition-transform duration-100 group-hover:translate-x-0.5 group-hover:text-accent-text"
      />
    </article>
  );
}

/** The totals, side by side in one band. */
function Totals({ datasets }: { readonly datasets: readonly PublishedDataset[] }) {
  const totals = useMemo(() => totalsOf(datasets), [datasets]);
  const items = [
    { label: totals.datasets === 1 ? "Dataset" : "Datasets", value: totals.datasets },
    { label: totals.specimens === 1 ? "Specimen" : "Specimens", value: totals.specimens },
    { label: totals.countries === 1 ? "Country" : "Countries", value: totals.countries },
  ];
  return (
    <dl className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-surface shadow-xs">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col-reverse gap-0.5 px-4 py-4 sm:px-6">
          <dt className="text-sm text-text-muted">{item.label}</dt>
          <dd className="text-2xl font-semibold tracking-tight text-text tabular-nums">
            {formatCount(item.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Filters({
  datasets,
  filters,
  onChange,
}: {
  readonly datasets: readonly PublishedDataset[];
  readonly filters: CatalogueFilters;
  readonly onChange: (filters: CatalogueFilters) => void;
}) {
  const facets = useMemo(() => facetsOf(datasets), [datasets]);
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-0 flex-1 basis-48 max-sm:basis-full">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle"
        />
        <input
          type="search"
          aria-label="Search"
          placeholder="Search datasets"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          className={cn(inputClassName, "h-control pl-9 text-base")}
        />
      </div>
      <div className="w-40 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-[calc(50%-0.3125rem)]">
        <Select
          aria-label="Country"
          value={filters.country ?? ANY}
          onValueChange={(value) => onChange({ ...filters, country: value === ANY ? null : value })}
          options={[
            { value: ANY, label: "Any country" },
            ...facets.countries.map((country) => ({ value: country, label: country })),
          ]}
        />
      </div>
      <div className="w-36 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-[calc(50%-0.3125rem)]">
        <Select
          aria-label="Panel"
          value={filters.panel ?? ANY}
          onValueChange={(value) => onChange({ ...filters, panel: value === ANY ? null : value })}
          options={[
            { value: ANY, label: "Any panel" },
            ...facets.panels.map((panel) => ({ value: panel, label: panel })),
          ]}
        />
      </div>
      <div className="w-28 max-sm:min-w-0 max-sm:grow-0 max-sm:basis-[calc(50%-0.3125rem)]">
        <Select
          aria-label="Collected in"
          value={filters.year === null ? ANY : String(filters.year)}
          onValueChange={(value) =>
            onChange({ ...filters, year: value === ANY ? null : Number(value) })
          }
          options={[
            { value: ANY, label: "Any year" },
            ...facets.years.map((year) => ({ value: String(year), label: String(year) })),
          ]}
        />
      </div>
    </div>
  );
}

function isFiltered(filters: CatalogueFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.country !== null ||
    filters.panel !== null ||
    filters.year !== null
  );
}

/** An invitation to add to the list, under it. */
function AddYours() {
  return (
    <section
      aria-label="Share your data"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-dashed border-border-strong px-5 py-4 sm:px-6"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-base font-medium text-text">Have data to share?</p>
        <p className="text-base text-text-muted">
          Build a PMO from your tables and deposit it from the last step.
        </p>
      </div>
      <RouterLink href="/" className={buttonClassName({ variant: "secondary" })}>
        Build a PMO
        <ArrowRight aria-hidden="true" className="size-4" />
      </RouterLink>
    </section>
  );
}

function Catalogue({ datasets }: { readonly datasets: readonly PublishedDataset[] }) {
  const [filters, setFilters] = useState<CatalogueFilters>(NO_FILTERS);
  const shown = useMemo(() => filterDatasets(datasets, filters), [datasets, filters]);
  const filtered = isFiltered(filters);

  if (datasets.length === 0) {
    return (
      <EmptyState
        title="No PMO has been published yet"
        description="Build a PMO from your tables and deposit it from the last step. It appears here once a curator accepts it."
        action={
          <RouterLink href="/" className={buttonClassName({ variant: "primary" })}>
            Build a PMO
            <ArrowRight aria-hidden="true" className="size-4" />
          </RouterLink>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Totals datasets={datasets} />
      <section aria-labelledby="published-list-heading" className="flex flex-col gap-3">
        <h2 id="published-list-heading" className="sr-only">
          Datasets
        </h2>
        {/* With a single dataset there is nothing to narrow down. */}
        {datasets.length > 1 ? (
          <Filters datasets={datasets} filters={filters} onChange={setFilters} />
        ) : null}
        {datasets.length > 1 ? (
          <div className="flex min-h-6 items-center justify-between gap-4 px-1">
            <p className="text-sm text-text-muted" aria-live="polite">
              {filtered
                ? `${shown.length} of ${plural(datasets.length, "dataset")}`
                : plural(datasets.length, "dataset")}
            </p>
            {filtered ? (
              <button
                type="button"
                onClick={() => setFilters(NO_FILTERS)}
                className="cursor-pointer rounded-sm text-sm font-medium text-accent-text underline-offset-2 hover:underline"
              >
                Clear the filters
              </button>
            ) : null}
          </div>
        ) : null}
        {shown.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No published PMO matches"
            description="Try fewer words or a wider choice."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
            {shown.map((dataset) => (
              <li key={dataset.id}>
                <DatasetRow dataset={dataset} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <AddYours />
    </div>
  );
}

/** Props for {@link PublishedPage}. For tests; the app passes none. */
export interface PublishedPageProps {
  readonly load?: CatalogueLoader;
  readonly zenodo?: ZenodoConfig | null;
}

/**
 * The list of PMOs published in the Zenodo community, with totals and
 * filters. It reads a file on this site that is rebuilt from Zenodo, so
 * browsing it contacts nothing else.
 */
export function PublishedPage({
  load = loadSharedCatalogue,
  zenodo = zenodoConfig(),
}: PublishedPageProps = {}) {
  const state = useCatalogue(load);
  const community =
    state.kind === "ready" ? (zenodo?.community ?? state.index.community) : zenodo?.community;
  const name = zenodo?.communityName ?? community ?? "Zenodo";

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">Published PMOs</h1>
          <p className="max-w-prose text-md text-text-muted">
            Microhaplotype datasets published in the{" "}
            {community === undefined ? (
              `${name} community`
            ) : (
              <Link href={communityUrl(community)} external>
                {name} community
              </Link>
            )}{" "}
            on Zenodo. Each one has a DOI to cite.
          </p>
        </header>
        {state.kind === "ready" ? (
          <>
            <Catalogue datasets={state.index.datasets} />
            <p className="text-sm text-text-subtle">
              Read from Zenodo on {longDate(state.index.harvestedAt)}. A newly accepted PMO shows up
              within a day.
            </p>
          </>
        ) : (
          <CatalogueProblem state={state} />
        )}
      </div>
    </PageContainer>
  );
}
