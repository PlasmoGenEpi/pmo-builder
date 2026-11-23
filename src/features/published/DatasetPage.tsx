import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowLeft, ChartColumn, Download } from "lucide-react";
import type { ReactNode } from "react";
import { Link as RouterLink, useParams } from "wouter";

import { PageContainer } from "@/app/PageContainer";
import type { PublishedDataset } from "@/domain/repository/types";
import { PmoContents } from "@/features/review/PmoContents";
import { CopyValue } from "@/features/shared/CopyValue";
import {
  buttonClassName,
  ButtonLink,
  Callout,
  Card,
  formatBytes,
  KeyValueList,
  Link,
  type KeyValueItem,
} from "@/ui";

import { citationOf, doiUrl, longDate, taxonName, yearsText } from "./catalogue";
import { CatalogueProblem } from "./CatalogueProblem";
import { loadSharedCatalogue, useCatalogue, type CatalogueLoader } from "./useCatalogue";

function BackLink() {
  return (
    <RouterLink
      href="/published"
      className="inline-flex items-center gap-1.5 self-start rounded-sm text-base text-text-muted underline-offset-2 hover:text-text hover:underline"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      <Trans>All published PMOs</Trans>
    </RouterLink>
  );
}

function detailsOf(dataset: PublishedDataset): KeyValueItem[] {
  const doi = doiUrl(dataset);
  const panelCount = dataset.panels.length;
  const countryCount = dataset.countries.length;
  const bioProjectCount = dataset.bioProjects.length;
  const rows: (readonly [string, ReactNode, boolean?] | null)[] = [
    panelCount === 0
      ? null
      : [plural(panelCount, { one: "Panel", other: "Panels" }), dataset.panels.join(", ")],
    countryCount === 0
      ? null
      : [
          plural(countryCount, { one: "Country", other: "Countries" }),
          dataset.countries.join(", "),
        ],
    yearsText(dataset) === null ? null : [t`Collected`, yearsText(dataset)],
    dataset.taxa.length === 0 ? null : [t`Species`, dataset.taxa.map(taxonName).join(", ")],
    bioProjectCount === 0
      ? null
      : [
          plural(bioProjectCount, { one: "BioProject", other: "BioProjects" }),
          dataset.bioProjects.join(", "),
          true,
        ],
    dataset.licence === null ? null : [t`Licence`, dataset.licence.title],
    dataset.version === null ? null : [t`Version`, dataset.version],
    doi === null
      ? null
      : [
          "DOI",
          <Link key="doi" href={doi} external>
            {dataset.doi}
          </Link>,
        ],
  ];
  return rows
    .filter((row) => row !== null)
    .map(([label, value, mono]) => ({ label, value, mono: mono === true }));
}

function Dataset({ dataset }: { readonly dataset: PublishedDataset }) {
  const publishedDate = longDate(dataset.published);
  const fileName = dataset.file.name;
  const fileSize = formatBytes(dataset.file.size);
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 border-b border-border pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-text">
          {dataset.title}
        </h1>
        {dataset.creators.length === 0 ? null : (
          <p className="text-md text-text">{dataset.creators.join("; ")}</p>
        )}
        <p className="flex flex-wrap gap-x-3 text-base text-text-muted">
          <span>
            <Trans>Published {publishedDate}</Trans>
          </span>
          <Link href={dataset.zenodoUrl} external>
            <Trans>See the record on Zenodo</Trans>
          </Link>
        </p>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-3 pt-2">
          {/* Opens the read-only published view at its own address, leaving the working PMO alone. */}
          <RouterLink
            href={`/published/${dataset.id}/summary`}
            className={buttonClassName({ variant: "primary", size: "lg" })}
          >
            <ChartColumn aria-hidden="true" className="size-4.5" />
            <Trans>See its summary</Trans>
          </RouterLink>
          <div className="flex flex-col gap-1.5">
            <ButtonLink
              size="lg"
              href={dataset.file.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-describedby="published-file"
            >
              <Download aria-hidden="true" className="size-4.5" />
              <Trans>Download from Zenodo</Trans>
            </ButtonLink>
            <span id="published-file" className="text-sm break-all text-text-muted">
              {t`${fileName}, ${fileSize}`}
            </span>
          </div>
        </div>
      </header>

      <PmoContents summary={dataset.summary} />

      <Card as="section" aria-labelledby="published-details-heading">
        <div className="flex flex-col gap-4">
          <h2
            id="published-details-heading"
            className="text-lg font-semibold tracking-tight text-text"
          >
            <Trans>About the data</Trans>
          </h2>
          <KeyValueList items={detailsOf(dataset)} />
        </div>
      </Card>

      <section aria-labelledby="published-cite-heading" className="flex flex-col gap-3">
        <h2 id="published-cite-heading" className="text-lg font-semibold tracking-tight text-text">
          <Trans>How to cite</Trans>
        </h2>
        <p className="max-w-prose text-base text-text-muted">
          <Trans>If you use this data, cite the record so its authors get the credit.</Trans>
        </p>
        <CopyValue
          copyLabel={t({
            message: "Copy citation",
            comment: "Button: copy the dataset's citation to the clipboard",
          })}
          value={citationOf(dataset)}
        />
      </section>
    </article>
  );
}

/** Props for {@link DatasetPage}. */
export interface DatasetPageProps {
  /** The Zenodo record's identifier, from the address. */
  readonly id: string;
  readonly load?: CatalogueLoader;
}

/** One published PMO: what it holds, how to get it from Zenodo, and how to cite it. */
export function DatasetPage({ id, load = loadSharedCatalogue }: DatasetPageProps) {
  const state = useCatalogue(load);
  const dataset =
    state.kind === "ready" ? state.index.datasets.find((entry) => entry.id === id) : undefined;

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <BackLink />
        {state.kind !== "ready" ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              <Trans>Published PMO</Trans>
            </h1>
            <CatalogueProblem state={state} />
          </>
        ) : dataset === undefined ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              <Trans>Published PMO</Trans>
            </h1>
            <Callout tone="warning" title={t`This PMO is not in the list`}>
              <Trans>
                It may have been withdrawn from the community, or the address may be mistyped.
              </Trans>
            </Callout>
          </>
        ) : (
          <Dataset dataset={dataset} />
        )}
      </div>
    </PageContainer>
  );
}

/** {@link DatasetPage} for the address `/published/:id`. */
export function DatasetRoute() {
  const { id } = useParams<{ id: string }>();
  return <DatasetPage id={id} />;
}
