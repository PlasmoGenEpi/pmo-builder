import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Link as RouterLink, useLocation, useParams } from "wouter";

import { PageContainer } from "@/app/PageContainer";
import type { PublishedDataset } from "@/domain/repository/types";
import {
  loadSharedCatalogue,
  useCatalogue,
  type CatalogueLoader,
} from "@/features/published/useCatalogue";
import { useActions } from "@/state";
import { Button, ButtonLink, Callout, Spinner, buttonClassName, formatBytes } from "@/ui";

import { PMO_TABS, type PmoTab } from "./PmoFilePage";
import { finishOpening, startOpening, workspaceState } from "./workspace";

/** The largest published file this opens: as much as the browser can check. */
const MAX_BYTES = 300 * 1024 * 1024;

/** Downloads a file. Tests pass their own. */
export type FileFetcher = (url: string) => Promise<Blob>;

const fetchFile: FileFetcher = async (url) => {
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`Zenodo answered ${response.status}`);
  return response.blob();
};

/** Where opening a published PMO stands. */
type Opening =
  | { readonly kind: "downloading" }
  | { readonly kind: "too-large" }
  | { readonly kind: "download-failed" }
  | { readonly kind: "refused" };

function isAlreadyOpen(id: string): boolean {
  const { file } = workspaceState();
  return file.kind === "opened" && file.origin.kind === "published" && file.origin.id === id;
}

/** Downloads one dataset's file and opens it, then shows the overview. */
function OpenDataset({
  dataset,
  fetcher,
  onRetry,
  tab,
}: {
  readonly dataset: PublishedDataset;
  readonly fetcher: FileFetcher;
  /** The tab to land on once it is open. */
  readonly tab: PmoTab;
  /** Starts again from the download. */
  readonly onRetry: () => void;
}) {
  const actions = useActions();
  const [, navigate] = useLocation();
  const [opening, setOpening] = useState<Opening>(() =>
    dataset.file.size > MAX_BYTES ? { kind: "too-large" } : { kind: "downloading" },
  );
  const fileName = dataset.file.name;
  const fileSize = formatBytes(dataset.file.size);

  useEffect(() => {
    if (dataset.file.size > MAX_BYTES) return undefined;
    if (isAlreadyOpen(dataset.id)) {
      navigate(`/pmo/${tab}`, { replace: true });
      return undefined;
    }
    let live = true;
    async function open(): Promise<void> {
      const generation = startOpening(dataset.file.name, dataset.file.size);
      let blob: Blob;
      try {
        blob = await fetcher(dataset.file.url);
      } catch {
        if (!live) return;
        finishOpening(generation, { kind: "none" });
        setOpening({ kind: "download-failed" });
        return;
      }
      const outcome = await actions.openPmo(blob, dataset.file.name);
      if (!live) return;
      const base = { name: dataset.file.name, size: blob.size };
      if (outcome?.kind !== "opened") {
        finishOpening(
          generation,
          outcome === null
            ? { kind: "failed", ...base }
            : { kind: "refused", ...base, check: outcome.check },
        );
        setOpening({ kind: "refused" });
        return;
      }
      finishOpening(generation, {
        kind: "opened",
        file: blob,
        ...base,
        opened: outcome,
        origin: {
          kind: "published",
          id: dataset.id,
          title: dataset.title,
          recordUrl: dataset.zenodoUrl,
        },
      });
      navigate(`/pmo/${tab}`, { replace: true });
    }
    void open();
    return () => {
      live = false;
    };
  }, [actions, dataset, fetcher, navigate, tab]);

  const download = (
    <ButtonLink href={dataset.file.url} size="sm" target="_blank" rel="noreferrer noopener">
      <Trans>Download it from Zenodo instead</Trans>
    </ButtonLink>
  );

  switch (opening.kind) {
    case "downloading":
      return (
        <output className="flex items-center gap-2 text-base text-text-muted">
          <Spinner />
          {t`Downloading ${fileName} (${fileSize}) from Zenodo`}
        </output>
      );
    case "too-large":
      return (
        <Callout
          tone="error"
          title={t`This file is too large to open in the browser`}
          action={download}
        >
          <Trans>
            {fileName} is {fileSize}. Download it, and work with it in pmotools on your computer.
          </Trans>
        </Callout>
      );
    case "download-failed":
      return (
        <Callout
          tone="error"
          live
          title={t`The file could not be downloaded from Zenodo`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onRetry}>
                {t`Try again`}
              </Button>
              {download}
            </div>
          }
        >
          <Trans>Check your connection. Zenodo may also be busy for a moment.</Trans>
        </Callout>
      );
    case "refused":
      return (
        <Callout
          tone="error"
          live
          title={t`The published file could not be opened`}
          action={
            <RouterLink
              href="/pmo"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {t`See why`}
            </RouterLink>
          }
        >
          <Trans>It may be in another PMO version. My PMO file says what is wrong with it.</Trans>
        </Callout>
      );
    default:
      return null;
  }
}

/** Props for {@link OpenPublished}. */
export interface OpenPublishedProps {
  /** The Zenodo record id, as in `#/published/<id>`. */
  readonly id: string;
  /** The tab to land on once it is open. Default the overview. */
  readonly tab?: PmoTab;
  readonly load?: CatalogueLoader;
  readonly fetcher?: FileFetcher;
}

/**
 * Opens a published PMO in My PMO file: finds the record in the catalogue,
 * downloads its file from Zenodo, and opens it as if it had been chosen. Only
 * the public file is fetched; nothing of the user's is sent.
 */
export function OpenPublished({
  id,
  tab = "overview",
  load = loadSharedCatalogue,
  fetcher = fetchFile,
}: OpenPublishedProps) {
  const catalogue = useCatalogue(load);
  const [attempt, setAttempt] = useState(0);
  let body;
  if (catalogue.kind === "loading") {
    body = (
      <output className="flex items-center gap-2 text-base text-text-muted">
        <Spinner />
        {t`Finding the published PMO`}
      </output>
    );
  } else {
    const dataset =
      catalogue.kind === "ready"
        ? catalogue.index.datasets.find((candidate) => candidate.id === id)
        : undefined;
    body =
      dataset === undefined ? (
        <Callout
          tone="error"
          title={t`This published PMO is not in the list`}
          action={
            <RouterLink
              href="/published"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {t`Browse published PMOs`}
            </RouterLink>
          }
        >
          <Trans>The link may be out of date, or the list could not be loaded.</Trans>
        </Callout>
      ) : (
        <OpenDataset
          key={attempt}
          dataset={dataset}
          fetcher={fetcher}
          tab={tab}
          onRetry={() => setAttempt((count) => count + 1)}
        />
      );
  }
  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          <Trans>My PMO file</Trans>
        </h1>
        {body}
      </div>
    </PageContainer>
  );
}

/** The routes `/pmo/published/:id` and `/pmo/published/:id/:tab`. The dataset pages link here. */
export function OpenPublishedRoute() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const landing = PMO_TABS.find((candidate) => candidate === tab) ?? "overview";
  return <OpenPublished id={id} tab={landing} />;
}
