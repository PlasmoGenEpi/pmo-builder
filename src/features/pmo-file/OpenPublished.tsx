import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link as RouterLink, Redirect, useLocation, useParams } from "wouter";

import { PageContainer } from "@/app/PageContainer";
import type { PublishedDataset } from "@/domain/repository/types";
import {
  loadSharedCatalogue,
  useCatalogue,
  type CatalogueLoader,
} from "@/features/published/useCatalogue";
import {
  PmoSessionProvider,
  usePublishedPmo,
  usePublishedPmoSession,
  useWorkingPmoSession,
  type OpenState,
  type WorkingPmoOrigin,
  type WorkingPmoSession,
} from "@/state";
import {
  Button,
  ButtonLink,
  Callout,
  ConfirmDialog,
  Link,
  Spinner,
  Tabs,
  buttonClassName,
  formatBytes,
} from "@/ui";

import { Invalid, refusal } from "./FileRefusal";
import { PmoHeaderBar } from "./PmoHeaderBar";
import { PmoReading, readOnlyPmoTabs } from "./PmoReading";
import { isPublishedTab, type PublishedTab } from "./publishedTabs";

/** The largest published file this opens: as much as the browser can check. */
const MAX_BYTES = 300 * 1024 * 1024;

/** Downloads a file. Tests pass their own. */
export type FileFetcher = (url: string) => Promise<Blob>;

const fetchFile: FileFetcher = async (url) => {
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`Zenodo answered ${response.status}`);
  return response.blob();
};

/** How many published-view mounts currently retain each session. */
const activePublishedMounts = new WeakMap<WorkingPmoSession, number>();

/**
 * Retains the published PMO session while a published view is mounted, and
 * closes it on a microtask once the last view unmounts. Deferring to a
 * microtask lets tab switches (which unmount and remount under
 * `<ErrorBoundary key={location}>` in the same commit) and StrictMode's dev
 * double-effect keep the open PMO and `minReads` without re-downloading.
 */
function useRetainPublishedPmo(session: WorkingPmoSession): void {
  useEffect(() => {
    const next = (activePublishedMounts.get(session) ?? 0) + 1;
    activePublishedMounts.set(session, next);
    return () => {
      const remaining = Math.max(0, (activePublishedMounts.get(session) ?? 1) - 1);
      activePublishedMounts.set(session, remaining);
      queueMicrotask(() => {
        if ((activePublishedMounts.get(session) ?? 0) === 0) {
          void session.close();
        }
      });
    };
  }, [session]);
}

/** Where downloading and opening a published PMO stands. */
type Opening =
  | { readonly kind: "downloading" }
  | { readonly kind: "too-large" }
  | { readonly kind: "download-failed" }
  | { readonly kind: "refused" }
  /** The file was downloaded, but opening it in this browser failed. */
  | { readonly kind: "failed" };

/** Where handing the published PMO off to My PMO file stands. */
type HandOff =
  | { readonly kind: "idle" }
  | {
      readonly kind: "confirming";
      readonly workingName: string;
      readonly subsetName: string | null;
    }
  | { readonly kind: "handing-off" };

type OpenedPublished = Extract<OpenState, { kind: "opened" }> & {
  readonly origin: Extract<WorkingPmoOrigin, { kind: "published" }>;
};

/** Whether `open` holds the published PMO with Zenodo record `id`. */
function isPublishedDatasetOpen(open: OpenState, id: string): open is OpenedPublished {
  return open.kind === "opened" && open.origin.kind === "published" && open.origin.id === id;
}

/** The slim header bar for a published PMO: title, authors, dataset page, Zenodo links and hand-off action. */
function PublishedHeaderBar({
  dataset,
  handingOff,
  onWorkWith,
}: {
  readonly dataset: PublishedDataset;
  readonly handingOff: boolean;
  readonly onWorkWith: (() => void) | undefined;
}) {
  const subtitle = dataset.creators.length === 0 ? undefined : dataset.creators.join("; ");
  return (
    <PmoHeaderBar
      title={dataset.title}
      titleTooltip={dataset.title}
      subtitle={subtitle}
      actions={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <RouterLink href={`/published/${dataset.id}`} asChild>
            <Link href={`/published/${dataset.id}`} variant="standalone">
              {t`Dataset page`}
            </Link>
          </RouterLink>
          <Link href={dataset.zenodoUrl} external variant="standalone">
            {t`Zenodo record`}
          </Link>
          {onWorkWith !== undefined ? (
            <Button variant="secondary" size="sm" loading={handingOff} onClick={onWorkWith}>
              {t`Work with this file`}
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

/**
 * Downloads one dataset's file into the published PMO session and shows its
 * read-only view (Overview, Summary, Compare and Tables). Never touches the
 * working PMO.
 */
function PublishedDatasetView({
  dataset,
  fetcher,
  onRetry,
  tab,
}: {
  readonly dataset: PublishedDataset;
  readonly fetcher: FileFetcher;
  /** The active tab in `/published/:id/:tab`. */
  readonly tab: PublishedTab;
  /** Starts again from the download. */
  readonly onRetry: () => void;
}) {
  const session = usePublishedPmoSession();
  const workingSession = useWorkingPmoSession();
  const [, navigate] = useLocation();
  const file = usePublishedPmo((state) => state.open);
  const generation = usePublishedPmo((state) => state.generation);
  const minReads = usePublishedPmo((state) => state.minReads);
  const [opening, setOpening] = useState<Opening>(() =>
    dataset.file.size > MAX_BYTES ? { kind: "too-large" } : { kind: "downloading" },
  );
  const [handOffState, setHandOffState] = useState<HandOff>({ kind: "idle" });
  const handOffRef = useRef<HandOff>({ kind: "idle" });
  const mountedRef = useRef(true);
  const fileName = dataset.file.name;
  const fileSize = formatBytes(dataset.file.size);

  const updateHandOff = (next: HandOff): void => {
    handOffRef.current = next;
    setHandOffState(next);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isThisOpen = isPublishedDatasetOpen(file, dataset.id);

  useEffect(() => {
    if (handOffRef.current.kind === "handing-off" || session.isPublishedOpen(dataset.id)) {
      return undefined;
    }
    // Drop any previous published record right away before downloading (or rejecting as too large).
    if (session.state.getState().open.kind !== "none") {
      void session.close();
    }
    if (dataset.file.size > MAX_BYTES) return undefined;
    let live = true;
    async function open(): Promise<void> {
      let blob: Blob;
      try {
        blob = await fetcher(dataset.file.url);
      } catch {
        if (live) setOpening({ kind: "download-failed" });
        return;
      }
      if (!live) return;
      const result = await session.open({
        kind: "file",
        file: blob,
        name: dataset.file.name,
        origin: {
          kind: "published",
          id: dataset.id,
          title: dataset.title,
          recordUrl: dataset.zenodoUrl,
        },
      });
      if (!live || result.kind === "superseded") return;
      switch (result.kind) {
        case "opened":
          return;
        case "refused":
          setOpening({ kind: "refused" });
          return;
        case "failed":
        case "no-built-pmo":
          setOpening({ kind: "failed" });
          return;
        default:
          return;
      }
    }
    void open();
    return () => {
      live = false;
    };
  }, [session, dataset, fetcher]);

  async function handOff(): Promise<void> {
    if (handOffRef.current.kind === "handing-off") return;
    const current = session.state.getState().open;
    if (!isPublishedDatasetOpen(current, dataset.id)) return;
    const { file: blob, name, origin } = current;
    // Mark hand-off before closing `publishedSession`, so closing it while
    // still mounted cannot flash "Downloading" or re-trigger the Zenodo fetch.
    updateHandOff({ kind: "handing-off" });
    // Free the published slot in the worker before parsing into the working
    // slot, avoiding a temporary 2x memory spike on large files.
    await session.close();
    const result = await workingSession.open({ kind: "file", file: blob, name, origin });
    if (!mountedRef.current) return;
    if (result.kind === "opened") {
      navigate(`/pmo/${tab}`);
    } else if (result.kind !== "superseded") {
      navigate("/pmo");
    } else {
      // Another open superseded the hand-off into My PMO file. Re-open the
      // already-downloaded bytes in the published slot instead of hanging.
      const restored = await session.open({ kind: "file", file: blob, name, origin });
      if (!mountedRef.current) return;
      updateHandOff({ kind: "idle" });
      if (restored.kind !== "opened" && restored.kind !== "superseded") {
        onRetry();
      }
    }
  }

  function requestWorkWith(): void {
    if (handOffRef.current.kind === "handing-off" || !isThisOpen) return;
    const { open: currentOpen, subset: currentSubset } = workingSession.state.getState();
    if (currentOpen.kind === "opened" || currentOpen.kind === "opening") {
      updateHandOff({
        kind: "confirming",
        workingName: currentOpen.name,
        subsetName:
          currentOpen.kind === "opened" && currentSubset.kind === "made"
            ? currentSubset.made.fileName
            : null,
      });
      return;
    }
    void handOff();
  }

  const download = (
    <ButtonLink href={dataset.file.url} size="sm" target="_blank" rel="noreferrer noopener">
      <Trans>Download it from Zenodo instead</Trans>
    </ButtonLink>
  );

  const handingOff = handOffState.kind === "handing-off";

  let body: ReactNode = null;
  if (handingOff) {
    body = (
      <output className="flex items-center gap-2 text-base text-text-muted">
        <Spinner />
        {t`Opening in My PMO file`}
      </output>
    );
  } else if (isThisOpen) {
    body = (
      <PmoSessionProvider session={session}>
        <Tabs<PublishedTab>
          label={t`Published PMO views`}
          value={tab}
          onValueChange={(next) => navigate(`/published/${dataset.id}/${next}`)}
          tabs={readOnlyPmoTabs({
            opened: file.opened,
            origin: null,
            generation,
            source: "original",
            minReads,
            maxReads: file.opened.choices.maxReads,
            onMinReadsChange: (next) => session.setMinReads(next),
            subsetTables: null,
          })}
        />
      </PmoSessionProvider>
    );
  } else if (file.kind === "failed" && file.cause === "lost") {
    body = (
      <PmoReading>
        <Callout
          tone="error"
          live
          title={t`The published file could not be opened`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onRetry}>
                {t`Try again`}
              </Button>
              {download}
            </div>
          }
        >
          {refusal(file, { published: true })}
        </Callout>
      </PmoReading>
    );
  } else {
    switch (opening.kind) {
      case "downloading":
        body = (
          <output className="flex items-center gap-2 text-base text-text-muted">
            <Spinner />
            {t`Downloading ${fileName} (${fileSize}) from Zenodo`}
          </output>
        );
        break;
      case "too-large":
        body = (
          <PmoReading>
            <Callout
              tone="error"
              title={t`This file is too large to open in the browser`}
              action={download}
            >
              <Trans>
                {fileName} is {fileSize}. Download it, and work with it in pmotools on your
                computer.
              </Trans>
            </Callout>
          </PmoReading>
        );
        break;
      case "download-failed":
        body = (
          <PmoReading>
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
          </PmoReading>
        );
        break;
      case "refused":
        body = (
          <PmoReading>
            {file.kind === "refused" && file.check.kind === "invalid" ? (
              <Invalid
                check={file.check}
                intro={t`It cannot be opened in this browser as it is.`}
                action={download}
              />
            ) : (
              <Callout
                tone="error"
                live
                title={t`The published file could not be opened`}
                action={download}
              >
                {refusal(file, { published: true }) ?? (
                  <Trans>It cannot be opened in this browser as it is.</Trans>
                )}
              </Callout>
            )}
          </PmoReading>
        );
        break;
      case "failed":
        body = (
          <PmoReading>
            <Callout
              tone="error"
              live
              title={t`The published file could not be opened`}
              action={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={onRetry}>
                    {t`Try again`}
                  </Button>
                  {download}
                </div>
              }
            >
              <Trans>Something went wrong in this browser while opening it. Try again.</Trans>
            </Callout>
          </PmoReading>
        );
        break;
      default:
        break;
    }
  }

  const workingName = handOffState.kind === "confirming" ? handOffState.workingName : "";
  const subsetName = handOffState.kind === "confirming" ? handOffState.subsetName : null;

  return (
    <PageContainer width="full" compact>
      <div className="flex flex-col gap-4">
        <PublishedHeaderBar
          dataset={dataset}
          handingOff={handingOff}
          onWorkWith={isThisOpen || handingOff ? requestWorkWith : undefined}
        />
        {body}
      </div>
      <ConfirmDialog
        open={handOffState.kind === "confirming"}
        onOpenChange={(open) => {
          if (!open && handOffRef.current.kind === "confirming") {
            updateHandOff({ kind: "idle" });
          }
        }}
        title={t`Replace the file open in My PMO file?`}
        description={
          subsetName !== null
            ? t`${workingName} and the subset you made from it (${subsetName}) are currently open in My PMO file. Opening this published PMO will replace them.`
            : t`${workingName} is currently open in My PMO file. Opening this published PMO will replace it.`
        }
        confirmLabel={t`Replace it`}
        tone="danger"
        onConfirm={handOff}
      />
    </PageContainer>
  );
}

/** Props for {@link OpenPublished}. */
export interface OpenPublishedProps {
  /** The Zenodo record id, as in `#/published/<id>/<tab>`. */
  readonly id: string;
  /** The active tab in the published view. Default the overview. */
  readonly tab?: PublishedTab;
  readonly load?: CatalogueLoader;
  readonly fetcher?: FileFetcher;
}

/**
 * The read-only published view: finds the record in the catalogue, downloads
 * its file from Zenodo into a slot apart from the working PMO, and shows
 * Overview, Summary, Compare and Tables. Only the public file is fetched;
 * nothing of the user's is sent.
 */
export function OpenPublished({
  id,
  tab = "overview",
  load = loadSharedCatalogue,
  fetcher = fetchFile,
}: OpenPublishedProps) {
  const session = usePublishedPmoSession();
  useRetainPublishedPmo(session);
  const catalogue = useCatalogue(load);
  const [attempt, setAttempt] = useState(0);

  const dataset =
    catalogue.kind === "ready"
      ? catalogue.index.datasets.find((candidate) => candidate.id === id)
      : undefined;

  useEffect(() => {
    if (catalogue.kind !== "loading" && dataset === undefined) {
      if (session.state.getState().open.kind !== "none") {
        void session.close();
      }
    }
  }, [catalogue.kind, dataset, session]);

  if (dataset !== undefined) {
    return (
      <PublishedDatasetView
        key={`${dataset.id}:${attempt}`}
        dataset={dataset}
        fetcher={fetcher}
        tab={tab}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }

  return (
    <PageContainer width="reading">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          <Trans>Published PMO</Trans>
        </h1>
        {catalogue.kind === "loading" ? (
          <output className="flex items-center gap-2 text-base text-text-muted">
            <Spinner />
            {t`Finding the published PMO`}
          </output>
        ) : (
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
        )}
      </div>
    </PageContainer>
  );
}

/** The route `/published/:id/:tab`. Unknown tab names redirect to `overview`. */
export function OpenPublishedRoute() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  if (!isPublishedTab(tab)) {
    return <Redirect to={`/published/${id}/overview`} replace />;
  }
  return <OpenPublished id={id} tab={tab} />;
}
