import { ArrowRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link as RouterLink } from "wouter";

import { PageContainer } from "@/app/PageContainer";
import type { PublishedDataset } from "@/domain/repository/types";
import { communityUrl, zenodoConfig, type ZenodoConfig } from "@/features/review/zenodo";
import { Button, Card, EmptyState, Field, formatCount, Link, Select, Stat, TextField } from "@/ui";

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

/** One line of facts under a dataset's title. */
function factsOf(dataset: PublishedDataset): string {
  return [
    plural(dataset.summary.specimens, "specimen"),
    plural(dataset.summary.targets, "target"),
    dataset.panels.join(", "),
    dataset.countries.join(", "),
    yearsText(dataset),
  ]
    .filter((fact) => fact !== null && fact !== "")
    .join(" · ");
}

function DatasetCard({ dataset }: { readonly dataset: PublishedDataset }) {
  return (
    <Card as="article" padding="sm" className="flex flex-col gap-1.5 sm:p-5">
      <h3 className="text-md font-semibold text-text">
        <RouterLink
          href={`/published/${dataset.id}`}
          className="rounded-sm underline-offset-2 hover:text-accent-text hover:underline"
        >
          {dataset.title}
        </RouterLink>
      </h3>
      <p className="text-base text-text-muted">
        {[dataset.creators.join("; "), /^\d{4}/.exec(dataset.published)?.[0]]
          .filter((part) => part !== undefined && part !== "")
          .join(" · ")}
      </p>
      <p className="text-base text-text">{factsOf(dataset)}</p>
    </Card>
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
      <TextField
        label="Search"
        hint="Title, author, country or panel"
        type="search"
        value={filters.search}
        onChange={(event) => onChange({ ...filters, search: event.target.value })}
      />
      <Field label="Country">
        <Select
          value={filters.country ?? ANY}
          onValueChange={(value) => onChange({ ...filters, country: value === ANY ? null : value })}
          options={[
            { value: ANY, label: "Any country" },
            ...facets.countries.map((country) => ({ value: country, label: country })),
          ]}
        />
      </Field>
      <Field label="Panel">
        <Select
          value={filters.panel ?? ANY}
          onValueChange={(value) => onChange({ ...filters, panel: value === ANY ? null : value })}
          options={[
            { value: ANY, label: "Any panel" },
            ...facets.panels.map((panel) => ({ value: panel, label: panel })),
          ]}
        />
      </Field>
      <Field label="Collected in">
        <Select
          value={filters.year === null ? ANY : String(filters.year)}
          onValueChange={(value) =>
            onChange({ ...filters, year: value === ANY ? null : Number(value) })
          }
          options={[
            { value: ANY, label: "Any year" },
            ...facets.years.map((year) => ({ value: String(year), label: String(year) })),
          ]}
        />
      </Field>
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

function Catalogue({ datasets }: { readonly datasets: readonly PublishedDataset[] }) {
  const [filters, setFilters] = useState<CatalogueFilters>(NO_FILTERS);
  const shown = useMemo(() => filterDatasets(datasets, filters), [datasets, filters]);
  const totals = useMemo(() => totalsOf(datasets), [datasets]);

  if (datasets.length === 0) {
    return (
      <EmptyState
        title="No PMO has been published yet"
        description="Build a PMO from your tables and deposit it from the last step. It appears here once a curator accepts it."
        action={
          <RouterLink
            href="/"
            className="inline-flex items-center gap-1.5 font-medium text-accent-text underline-offset-2 hover:underline"
          >
            Build a PMO
            <ArrowRight aria-hidden="true" className="size-4" />
          </RouterLink>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-3 gap-6">
        <Stat label={totals.datasets === 1 ? "Dataset" : "Datasets"} value={totals.datasets} />
        <Stat label="Specimens" value={totals.specimens} />
        <Stat label={totals.countries === 1 ? "Country" : "Countries"} value={totals.countries} />
      </div>
      <section aria-labelledby="published-list-heading" className="flex flex-col gap-5">
        <h2 id="published-list-heading" className="sr-only">
          Datasets
        </h2>
        <Filters datasets={datasets} filters={filters} onChange={setFilters} />
        <p className="text-sm text-text-muted" aria-live="polite">
          {isFiltered(filters)
            ? `${shown.length} of ${plural(datasets.length, "dataset")}`
            : plural(datasets.length, "dataset")}
        </p>
        {shown.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No published PMO matches"
            description="Try fewer words or a wider choice."
            action={<Button onClick={() => setFilters(NO_FILTERS)}>Clear the filters</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((dataset) => (
              <li key={dataset.id}>
                <DatasetCard dataset={dataset} />
              </li>
            ))}
          </ul>
        )}
      </section>
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
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-border pb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text">Published PMOs</h1>
          <p className="max-w-prose text-md text-text-muted">
            PMO files published in the{" "}
            {community === undefined ? (
              `${name} community`
            ) : (
              <Link href={communityUrl(community)} external>
                {name} community
              </Link>
            )}{" "}
            on Zenodo. Each has a DOI to cite and can be downloaded from Zenodo.
          </p>
          {state.kind === "ready" ? (
            <p className="text-sm text-text-subtle">
              Read from Zenodo on {longDate(state.index.harvestedAt)}. A newly accepted PMO shows up
              within a day.
            </p>
          ) : null}
        </header>
        {state.kind === "ready" ? (
          <Catalogue datasets={state.index.datasets} />
        ) : (
          <CatalogueProblem state={state} />
        )}
      </div>
    </PageContainer>
  );
}
