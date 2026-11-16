import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowRight, Download, Hammer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink, useLocation, useParams } from "wouter";

import { PageContainer } from "@/app/PageContainer";
import { BUILD_PATH } from "@/app/steps";
// By path, not the barrel: the barrel would bring pmotools-ts onto the main thread.
import {
  MAX_LISTED,
  PUBLISHABLE_PMO_VERSION,
  type PmoFileCheck,
} from "@/domain/build/checkFileResult";
import { PmoContents } from "@/features/review/PmoContents";
import { saveFile } from "@/features/review/saveFile";
import { zenodoConfig, type ZenodoConfig } from "@/features/review/zenodo";
import {
  useBuildState,
  useWorkingPmo,
  useWorkingPmoSession,
  type OpenState,
  type Opened,
  type WorkingPmoOrigin,
} from "@/state";
import {
  Button,
  Callout,
  FileDropzone,
  Link,
  Spinner,
  Tabs,
  buttonClassName,
  formatBytes,
} from "@/ui";

import { PublishPanel } from "./PublishPanel";
import { CompareTab } from "./summary/CompareTab";
import { SummaryPanel } from "./summary/SummaryPanel";
import { SubsetPanel } from "./SubsetPanel";
import { TablesPanel } from "./TablesPanel";

/** My PMO file's tabs, which are also the last part of its address (`#/pmo/tables`). */
export const PMO_TABS = ["overview", "summary", "compare", "tables", "subset", "publish"] as const;

/** One of {@link PMO_TABS}. */
export type PmoTab = (typeof PMO_TABS)[number];

/** The address that opens the PMO the draft built. The Review step links here. */
export const OPEN_BUILT_PATH = "/pmo/open-built";

function isTab(value: string | undefined): value is PmoTab {
  return PMO_TABS.some((tab) => tab === value);
}

/** Why a file cannot be opened, as one sentence. */
function refusal(file: OpenState): string | null {
  const version = PUBLISHABLE_PMO_VERSION;
  if (file.kind === "failed")
    return t`The file could not be opened. Reload the page and try again.`;
  if (file.kind !== "refused") return null;
  const { check } = file;
  switch (check.kind) {
    case "too-large": {
      const sizeLimit = formatBytes(check.limit);
      return t`This file is larger than ${sizeLimit}, more than this browser can open.`;
    }
    case "unreadable":
      if (check.reason === "gzip")
        return t`This file looks gzipped but could not be unpacked. Check that it downloaded completely.`;
      if (check.reason === "json")
        return t`This is not a PMO file. A PMO file holds JSON and is saved as .json or .json.gz.`;
      return t`This JSON file is not a PMO: it has no PMO header.`;
    case "wrong-version": {
      const declared = check.declared;
      return declared === null
        ? t`This file does not say which PMO version it is. Only version ${version} files can be opened here. Build it again from your tables to get a ${version} file.`
        : t`This file is in PMO version ${declared}. Only version ${version} files can be opened here. Build it again from your tables to get a ${version} file.`;
    }
    case "invalid":
      return null;
    default:
      return null;
  }
}

/** What does not match the PMO format, for a file refused as invalid. */
function Invalid({ check }: { readonly check: Extract<PmoFileCheck, { kind: "invalid" }> }) {
  const rest = check.unlisted;
  return (
    <Callout
      tone="error"
      live
      title={t`This file does not match the PMO format`}
      action={
        <RouterLink
          href={BUILD_PATH}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          <Trans>Build a PMO</Trans>
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </RouterLink>
      }
    >
      <div className="flex flex-col gap-2">
        <p>
          <Trans>
            It cannot be used as it is. Build the PMO again from your tables in PMO Builder, which
            checks it as you go.
          </Trans>
        </p>
        <ul className="list-disc pl-5">
          {check.problems.map((problem) => (
            <li key={problem} className="break-words">
              {problem}
            </li>
          ))}
        </ul>
        {rest > 0 ? (
          <p>
            {plural(rest, {
              one: "# more problem is not listed.",
              other: "# more problems are not listed.",
            })}
          </p>
        ) : null}
      </div>
    </Callout>
  );
}

/** A tab's content at reading width, under the page's full-width tabs. */
function Reading({ children }: { readonly children: ReactNode }) {
  return <div className="max-w-reading">{children}</div>;
}

/** The Overview tab: whether the file is valid, anything worth a look, and what it holds. */
function Overview({
  opened,
  origin,
  onDownload,
}: {
  readonly opened: Opened;
  readonly origin: WorkingPmoOrigin;
  /** Saves the file, offered for the built PMO, which has no copy on disk yet. */
  readonly onDownload: () => void;
}) {
  const version = PUBLISHABLE_PMO_VERSION;
  const recordTitle = origin.kind === "published" ? origin.title : "";
  return (
    <div className="flex flex-col gap-6">
      {origin.kind === "published" ? (
        <Callout tone="success" title={t`This is a published PMO`}>
          <Trans>
            From the Zenodo record{" "}
            <Link href={origin.recordUrl} external>
              {recordTitle}
            </Link>
            . It matches PMO version {version} and its tables link up.
          </Trans>
        </Callout>
      ) : (
        <Callout
          tone="success"
          action={
            origin.kind === "built" ? (
              <Button variant="secondary" size="sm" icon={Download} onClick={onDownload}>
                {t`Download`}
              </Button>
            ) : undefined
          }
          title={
            origin.kind === "built"
              ? t`This is the PMO built from your draft`
              : t`This file is a valid PMO`
          }
        >
          <Trans>It matches PMO version {version} and its tables link up.</Trans>
        </Callout>
      )}
      {opened.warnings.length === 0 ? null : (
        <Callout tone="warning" title={t`Worth a look`}>
          <ul className="list-disc pl-5">
            {opened.warnings.map((warning) => (
              <li key={warning} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
          {opened.warnings.length === MAX_LISTED ? (
            <p>
              <Trans>There may be more.</Trans>
            </p>
          ) : null}
        </Callout>
      )}
      <PmoContents summary={opened.summary} />
    </div>
  );
}

/**
 * Opens the PMO the draft built, then shows its overview. The session runs
 * the open to the end even if this page is left meanwhile; only moving to
 * the overview is skipped then.
 */
function OpenBuilt() {
  const session = useWorkingPmoSession();
  const [, navigate] = useLocation();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    async function open(): Promise<void> {
      const result = await session.open({ kind: "built" });
      if (!live || result.kind === "superseded") return;
      if (result.kind === "opened") navigate("/pmo/overview", { replace: true });
      else setFailed(true);
    }
    void open();
    return () => {
      live = false;
    };
  }, [session, navigate]);

  return failed ? (
    <Callout
      tone="error"
      live
      title={t`There is no built PMO to open`}
      action={
        <RouterLink
          href={BUILD_PATH}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          {t`Go to Build`}
        </RouterLink>
      }
    >
      <Trans>Finish the required steps first, so that the PMO can be built.</Trans>
    </Callout>
  ) : (
    <div className="flex items-center gap-2 text-base text-text-muted">
      <Spinner />
      {t`Opening the PMO built from your draft`}
    </div>
  );
}

/** Props for {@link PmoFilePage}. */
export interface PmoFilePageProps {
  /** The tab to show. Default the overview. */
  readonly tab?: PmoTab;
  /** Where to publish, or `null` to leave publishing out. Default: the build's settings. */
  readonly zenodo?: ZenodoConfig | null;
}

/**
 * My PMO file: one PMO file, opened once, to look over, download as tables,
 * subset, and publish. The file is read in this browser's worker; the draft
 * is not touched.
 */
export function PmoFilePage({ tab = "overview", zenodo = zenodoConfig() }: PmoFilePageProps) {
  const session = useWorkingPmoSession();
  const [, navigate] = useLocation();
  const file = useWorkingPmo((state) => state.open);
  const generation = useWorkingPmo((state) => state.generation);
  const minReads = useWorkingPmo((state) => state.minReads);
  const subset = useWorkingPmo((state) => state.subset);
  const tableSource = useWorkingPmo((state) => state.tableSource);
  const summarySource = useWorkingPmo((state) => state.summarySource);
  const build = useBuildState();
  const canOpenBuilt = build.view?.overall.pmo === "valid";
  const version = PUBLISHABLE_PMO_VERSION;

  function open(chosen: File): void {
    void session.open({
      kind: "file",
      file: chosen,
      name: chosen.name,
      origin: { kind: "chosen" },
    });
  }

  const made = subset.kind === "made" ? subset.made : null;
  const shownFile = file.kind === "none" ? null : { name: file.name, size: file.size };

  return (
    // One width once a file is open, so the file and the tabs stay put when
    // switching between the wide views (Summary, Compare) and the others.
    <PageContainer width={file.kind === "opened" ? "full" : "reading"}>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            <Trans>My PMO file</Trans>
          </h1>
          {file.kind === "opened" ? null : (
            <p className="max-w-prose text-md text-text-muted">
              <Trans>
                Open a PMO file to see a summary of its samples and targets, compare groups of
                specimens, download its tables as CSV or TSV, make a smaller PMO with only some
                specimens, targets or reads, or publish it. The file stays in this browser.
              </Trans>
            </p>
          )}
        </header>

        <FileDropzone
          label="PMO"
          description={t`A PMO file in version ${version}, saved as .json or .json.gz.`}
          accept={[".json", ".json.gz", ".gz"]}
          file={shownFile}
          onFileSelect={open}
          onRemove={() => void session.close()}
          busy={file.kind === "opening" ? t`Opening the file` : false}
          error={refusal(file)}
        />

        {file.kind === "none" && canOpenBuilt ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={Hammer} onClick={() => navigate(OPEN_BUILT_PATH)}>
              {t`Open the PMO you are building`}
            </Button>
          </div>
        ) : null}

        {file.kind === "refused" && file.check.kind === "invalid" ? (
          <Invalid check={file.check} />
        ) : null}

        {file.kind === "opened" ? (
          <Tabs<PmoTab>
            label={t`What to do with the file`}
            value={zenodo === null && tab === "publish" ? "overview" : tab}
            onValueChange={(next) => navigate(`/pmo/${next}`)}
            tabs={[
              {
                value: "overview",
                label: t`Overview`,
                content: (
                  <Reading>
                    <Overview
                      opened={file.opened}
                      origin={file.origin}
                      onDownload={() => saveFile(file.file, file.name)}
                    />
                  </Reading>
                ),
              },
              {
                value: "summary",
                label: t`Summary`,
                content: (
                  <SummaryPanel
                    key={generation}
                    hasSubset={made !== null}
                    source={summarySource}
                    onSourceChange={(next) => session.setSummarySource(next)}
                    minReads={minReads}
                    onMinReadsChange={(next) => session.setMinReads(next)}
                  />
                ),
              },
              {
                value: "compare",
                label: t`Compare`,
                content: (
                  <CompareTab
                    key={generation}
                    hasSubset={made !== null}
                    source={summarySource}
                    onSourceChange={(next) => session.setSummarySource(next)}
                    minReads={minReads}
                    onMinReadsChange={(next) => session.setMinReads(next)}
                  />
                ),
              },
              {
                value: "tables",
                label: t`Tables`,
                content: (
                  <Reading>
                    <TablesPanel
                      tables={file.opened.tables}
                      subsetTables={made?.tables ?? null}
                      source={made === null ? "original" : tableSource}
                      onSourceChange={(source) => session.setTableSource(source)}
                    />
                  </Reading>
                ),
              },
              {
                value: "subset",
                label: t`Subset`,
                content: (
                  <Reading>
                    <SubsetPanel
                      key={generation}
                      choices={file.opened.choices}
                      original={file.opened.summary}
                      onShowSummary={() => {
                        session.setSummarySource("subset");
                        navigate("/pmo/summary");
                      }}
                      onShowTables={() => {
                        session.setTableSource("subset");
                        navigate("/pmo/tables");
                      }}
                      onPublish={
                        zenodo === null
                          ? null
                          : () => {
                              session.setPublishSource("subset");
                              navigate("/pmo/publish");
                            }
                      }
                    />
                  </Reading>
                ),
              },
              ...(zenodo === null
                ? []
                : [
                    {
                      value: "publish" as const,
                      label: t`Publish to Zenodo`,
                      content: (
                        <Reading>
                          <PublishPanel zenodo={zenodo} file={file} subset={made} />
                        </Reading>
                      ),
                    },
                  ]),
            ]}
          />
        ) : null}

        {file.kind === "none" ? (
          <Callout tone="info" title={t`Where to get a PMO file`}>
            <Trans>
              Build one in this app from{" "}
              <RouterLink href={BUILD_PATH} asChild>
                <Link href={BUILD_PATH}>your tables</Link>
              </RouterLink>
              , or open one of the{" "}
              <RouterLink href="/published" asChild>
                <Link href="/published">published PMOs</Link>
              </RouterLink>
              .
            </Trans>
          </Callout>
        ) : null}
      </div>
    </PageContainer>
  );
}

/** The route: `/pmo` and `/pmo/:tab`. `/pmo/open-built` opens the built PMO. */
export function PmoFileRoute() {
  const { tab } = useParams<{ tab?: string }>();
  if (tab === "open-built") {
    return (
      <PageContainer>
        <OpenBuilt />
      </PageContainer>
    );
  }
  return <PmoFilePage tab={isTab(tab) ? tab : "overview"} />;
}
