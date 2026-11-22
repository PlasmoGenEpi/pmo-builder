import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  FlaskConical,
  ListFilter,
  MapPin,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import { Link as RouterLink, useLocation, useSearch } from "wouter";

import { lastNavigationKind } from "@/app/hashLocation";
import { PageContainer } from "@/app/PageContainer";
import { BUILD_PATH } from "@/app/steps";
import type { PublishedDataset } from "@/domain/repository/types";
import { communityUrl, zenodoConfig, type ZenodoConfig } from "@/features/review/zenodo";
import {
  Badge,
  buttonClassName,
  cn,
  EmptyState,
  formatCount,
  inputClassName,
  Link,
  Select,
} from "@/ui";

import {
  DEFAULT_LIST_STATE,
  publishedHref,
  readListState,
  type PublishedListState,
} from "./address";
import {
  facetsOf,
  filterDatasets,
  isSortOrder,
  longDate,
  sortDatasets,
  totalsOf,
  yearsText,
  type CatalogueFilters,
  type SortOrder,
} from "./catalogue";
import { CatalogueProblem } from "./CatalogueProblem";
import { loadSharedCatalogue, useCatalogue, type CatalogueLoader } from "./useCatalogue";

/** The `Select` value that stands for "no limit". Radix does not allow an empty one. */
const ANY = "any";

/** Scroll offset of the list per query string, kept for the current visit so Back returns to the same row. */
const scrollPositions = new Map<string, number>();

/** Clears saved scroll positions. Intended for tests. */
export function clearScrollPositionsForTests(): void {
  scrollPositions.clear();
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
      <span className="sr-only">
        {t({
          message: `${label}:`,
          comment: "Before a fact about a dataset, for screen readers",
        })}{" "}
      </span>
      {children}
    </span>
  );
}

/** One dataset in the list. The whole row opens its page. */
function DatasetRow({
  dataset,
  onOpen,
}: {
  readonly dataset: PublishedDataset;
  readonly onOpen: () => void;
}) {
  const years = yearsText(dataset);
  const year = /^\d{4}/.exec(dataset.published)?.[0];
  return (
    <article className="group relative flex items-center gap-5 px-5 py-4 transition-colors duration-100 hover:bg-surface-subtle sm:px-6 sm:py-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-md font-semibold text-pretty text-text">
          <RouterLink
            href={`/published/${dataset.id}`}
            onClick={onOpen}
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
            {plural(dataset.summary.specimens, { one: "# specimen", other: "# specimens" })}
          </span>
          {dataset.panels.length === 0 ? null : (
            <Fact icon={FlaskConical} label={t`Panel`}>
              {dataset.panels.join(", ")}
            </Fact>
          )}
          {dataset.countries.length === 0 ? null : (
            <Fact icon={MapPin} label={t`Country`}>
              {dataset.countries.join(", ")}
            </Fact>
          )}
          {years === null ? null : (
            <Fact icon={CalendarDays} label={t`Collected`}>
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
            {plural(dataset.summary.specimens, { one: "specimen", other: "specimens" })}
          </span>
        </span>
        <span className="text-sm text-text-subtle">
          {plural(dataset.summary.targets, { one: "# target", other: "# targets" })}
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
function Totals({
  datasets,
  filtered,
}: {
  readonly datasets: readonly PublishedDataset[];
  readonly filtered: boolean;
}) {
  const totals = useMemo(() => totalsOf(datasets), [datasets]);
  const items = [
    {
      id: "datasets",
      label: plural(totals.datasets, { one: "Dataset", other: "Datasets" }),
      value: totals.datasets,
    },
    {
      id: "specimens",
      label: plural(totals.specimens, { one: "Specimen", other: "Specimens" }),
      value: totals.specimens,
    },
    {
      id: "countries",
      label: plural(totals.countries, { one: "Country", other: "Countries" }),
      value: totals.countries,
    },
  ];
  return (
    <section
      aria-label={t`Totals`}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs"
    >
      {filtered ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-subtle px-4 py-2 sm:px-6">
          <Badge tone="accent" icon={ListFilter}>
            <Trans>Filtered list</Trans>
          </Badge>
          <p className="text-sm text-text-muted">
            <Trans>Totals for matching published PMOs</Trans>
          </p>
        </div>
      ) : null}
      <dl className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex min-w-0 items-baseline justify-between gap-4 px-4 py-3 sm:flex-col-reverse sm:items-start sm:justify-start sm:gap-0.5 sm:px-6 sm:py-4"
          >
            <dt className="text-sm text-text-muted">{item.label}</dt>
            <dd className="text-xl font-semibold tracking-tight text-text tabular-nums md:text-2xl">
              {formatCount(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Filters({
  datasets,
  filters,
  onChange,
}: {
  readonly datasets: readonly PublishedDataset[];
  readonly filters: CatalogueFilters;
  readonly onChange: (filters: CatalogueFilters, options?: { readonly replace?: boolean }) => void;
}) {
  const facets = useMemo(() => facetsOf(datasets), [datasets]);
  const countries =
    filters.country !== null && !facets.countries.includes(filters.country)
      ? [filters.country, ...facets.countries]
      : facets.countries;
  const panels =
    filters.panel !== null && !facets.panels.includes(filters.panel)
      ? [filters.panel, ...facets.panels]
      : facets.panels;
  const years =
    filters.year !== null && !facets.years.includes(filters.year)
      ? [filters.year, ...facets.years]
      : facets.years;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-0 flex-1 basis-48 max-sm:basis-full">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle"
        />
        <input
          type="search"
          aria-label={t`Search`}
          placeholder={t`Search datasets`}
          value={filters.search}
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value }, { replace: true })
          }
          className={cn(inputClassName, "h-control pl-9 text-base")}
        />
      </div>
      <div className="w-40 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-[calc(50%-0.3125rem)]">
        <Select
          aria-label={t`Country`}
          value={filters.country ?? ANY}
          onValueChange={(value) => onChange({ ...filters, country: value === ANY ? null : value })}
          options={[
            { value: ANY, label: t`Any country` },
            ...countries.map((country) => ({ value: country, label: country })),
          ]}
        />
      </div>
      <div className="w-36 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-[calc(50%-0.3125rem)]">
        <Select
          aria-label={t`Panel`}
          value={filters.panel ?? ANY}
          onValueChange={(value) => onChange({ ...filters, panel: value === ANY ? null : value })}
          options={[
            { value: ANY, label: t`Any panel` },
            ...panels.map((panel) => ({ value: panel, label: panel })),
          ]}
        />
      </div>
      <div className="w-28 max-sm:min-w-0 max-sm:grow-0 max-sm:basis-[calc(50%-0.3125rem)]">
        <Select
          aria-label={t`Collected in`}
          value={filters.year === null ? ANY : String(filters.year)}
          onValueChange={(value) =>
            onChange({ ...filters, year: value === ANY ? null : Number(value) })
          }
          options={[
            { value: ANY, label: t`Any year` },
            ...years.map((year) => ({ value: String(year), label: String(year) })),
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

/** Order menu for the published PMOs list, with a visible label. */
function SortControl({
  sort,
  onChange,
}: {
  readonly sort: SortOrder;
  readonly onChange: (sort: SortOrder) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium whitespace-nowrap text-text-muted">
        {t({ message: "Sort by", comment: "Label for the published list order menu" })}
      </label>
      <div className="min-w-48 max-w-full">
        <Select
          id={id}
          value={sort}
          onValueChange={(value) => {
            if (isSortOrder(value)) onChange(value);
          }}
          options={[
            { value: "newest", label: t`Newest published` },
            { value: "specimens", label: t`Most specimens` },
            { value: "year", label: t`Latest collection year` },
            { value: "title", label: t`Title` },
          ]}
        />
      </div>
    </div>
  );
}

/** An invitation to add to the list, under it. */
function AddYours() {
  return (
    <section
      aria-label={t`Share your data`}
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-dashed border-border-strong px-5 py-4 sm:px-6"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-base font-medium text-text">
          <Trans>Have data to share?</Trans>
        </p>
        <p className="text-base text-text-muted">
          <Trans>Build a PMO from your tables, or publish a PMO file you already have.</Trans>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <RouterLink href="/pmo/publish" className={buttonClassName({ variant: "secondary" })}>
          <Trans>Publish a file</Trans>
        </RouterLink>
        <RouterLink href={BUILD_PATH} className={buttonClassName({ variant: "secondary" })}>
          <Trans>Build a PMO</Trans>
          <ArrowRight aria-hidden="true" className="size-4" />
        </RouterLink>
      </div>
    </section>
  );
}

function Catalogue({
  datasets,
  search,
  onOpenDataset,
}: {
  readonly datasets: readonly PublishedDataset[];
  readonly search: string;
  readonly onOpenDataset: () => void;
}) {
  const [, navigate] = useLocation();
  const listState = useMemo(() => readListState(search), [search]);
  const shown = useMemo(
    () => sortDatasets(filterDatasets(datasets, listState), listState.sort),
    [datasets, listState],
  );
  const filtered = isFiltered(listState);
  const shownCount = formatCount(shown.length);

  const updateListState = (
    next: PublishedListState,
    options: { readonly replace?: boolean } = {},
  ) => {
    const nextHref = publishedHref(next);
    const currentHref = search === "" ? "/published" : `/published?${search}`;
    if (nextHref === currentHref) return;
    navigate(nextHref, { replace: options.replace === true });
  };

  if (datasets.length === 0) {
    return (
      <EmptyState
        title={t`No PMO has been published yet`}
        description={t`Build a PMO from your tables, or publish a PMO file you already have. It appears here once a curator accepts it.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <RouterLink href={BUILD_PATH} className={buttonClassName({ variant: "primary" })}>
              <Trans>Build a PMO</Trans>
              <ArrowRight aria-hidden="true" className="size-4" />
            </RouterLink>
            <RouterLink href="/pmo/publish" className={buttonClassName({ variant: "secondary" })}>
              <Trans>Publish a file</Trans>
            </RouterLink>
          </div>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Totals datasets={shown} filtered={filtered} />
      <section aria-labelledby="published-list-heading" className="flex flex-col gap-3">
        <h2 id="published-list-heading" className="sr-only">
          <Trans>Datasets</Trans>
        </h2>
        {/* With a single dataset there is nothing to narrow down. */}
        {datasets.length > 1 ? (
          <Filters
            datasets={datasets}
            filters={listState}
            onChange={(nextFilters, options) =>
              updateListState({ ...listState, ...nextFilters }, options)
            }
          />
        ) : null}
        {datasets.length > 1 ? (
          <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-sm text-text-muted" aria-live="polite">
                {filtered
                  ? plural(datasets.length, {
                      one: `${shownCount} of # dataset`,
                      other: `${shownCount} of # datasets`,
                    })
                  : plural(datasets.length, { one: "# dataset", other: "# datasets" })}
              </p>
              {filtered ? (
                <button
                  type="button"
                  onClick={() => updateListState({ ...DEFAULT_LIST_STATE, sort: listState.sort })}
                  className="cursor-pointer rounded-sm text-sm font-medium text-accent-text underline-offset-2 hover:underline"
                >
                  <Trans>Clear the filters</Trans>
                </button>
              ) : null}
            </div>
            <SortControl
              sort={listState.sort}
              onChange={(sort) => updateListState({ ...listState, sort })}
            />
          </div>
        ) : null}
        {shown.length === 0 ? (
          <EmptyState
            icon={Search}
            title={t`No published PMO matches`}
            description={t`Try fewer words or a wider choice.`}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
            {shown.map((dataset) => (
              <li key={dataset.id}>
                <DatasetRow dataset={dataset} onOpen={onOpenDataset} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <AddYours />
    </div>
  );
}

/** What the list is, with a link to the community on Zenodo. */
function CommunityIntro({
  community,
  name,
}: {
  readonly community: string;
  readonly name: string;
}) {
  return (
    <Trans>
      Microhaplotype datasets published in the{" "}
      <Link href={communityUrl(community)} external>
        {name} community
      </Link>{" "}
      on Zenodo. Each one has a DOI to cite.
    </Trans>
  );
}

/** When the list was last read from Zenodo. */
function HarvestNote({ harvestedAt }: { readonly harvestedAt: string }) {
  const harvestDate = longDate(harvestedAt);
  return (
    <p className="text-sm text-text-subtle">
      <Trans>Read from Zenodo on {harvestDate}. A newly accepted PMO shows up within a day.</Trans>
    </p>
  );
}

/** Props for {@link PublishedPage}. For tests; the app passes none. */
export interface PublishedPageProps {
  readonly load?: CatalogueLoader;
  readonly zenodo?: ZenodoConfig | null;
}

/**
 * Remembers the list's scroll offset by query string and restores it once the
 * catalogue has rendered after a browser Back or Forward navigation.
 */
function useListScrollRestoration(ready: boolean, search: string): () => void {
  const restoredKeyRef = useRef<string | null>(null);
  const restoringRef = useRef(false);

  useEffect(() => {
    if (!ready || restoredKeyRef.current === search) return undefined;
    restoredKeyRef.current = search;
    if (lastNavigationKind() !== "pop") return undefined;
    const savedY = scrollPositions.get(search);
    if (savedY === undefined || savedY <= 0) return undefined;

    restoringRef.current = true;
    if (typeof window.scrollTo === "function") window.scrollTo({ top: savedY });
    const frameId = window.requestAnimationFrame(() => {
      if (window.scrollY !== savedY && typeof window.scrollTo === "function") {
        window.scrollTo({ top: savedY });
      }
      restoringRef.current = false;
    });
    return () => {
      restoringRef.current = false;
      window.cancelAnimationFrame(frameId);
    };
  }, [ready, search]);

  useEffect(() => {
    if (!ready) return undefined;
    const onScroll = () => {
      if (!restoringRef.current) scrollPositions.set(search, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [ready, search]);

  return () => {
    scrollPositions.set(search, window.scrollY);
  };
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
  const search = useSearch();
  const recordScrollPosition = useListScrollRestoration(state.kind === "ready", search);
  const community =
    state.kind === "ready" ? (zenodo?.community ?? state.index.community) : zenodo?.community;
  const name = zenodo?.communityName ?? community ?? "Zenodo";

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            <Trans>Published PMOs</Trans>
          </h1>
          <p className="max-w-prose text-md text-text-muted">
            {community === undefined ? (
              <Trans>
                Microhaplotype datasets published in the {name} community on Zenodo. Each one has a
                DOI to cite.
              </Trans>
            ) : (
              <CommunityIntro community={community} name={name} />
            )}
          </p>
        </header>
        {state.kind === "ready" ? (
          <>
            <Catalogue
              datasets={state.index.datasets}
              search={search}
              onOpenDataset={recordScrollPosition}
            />
            <HarvestNote harvestedAt={state.index.harvestedAt} />
          </>
        ) : (
          <CatalogueProblem state={state} />
        )}
      </div>
    </PageContainer>
  );
}
