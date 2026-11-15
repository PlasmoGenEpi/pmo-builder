import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowRight, Hammer } from "lucide-react";
import { useEffect, useState } from "react";
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
import { zenodoConfig, type ZenodoConfig } from "@/features/review/zenodo";
import { useActions, useBuildState } from "@/state";
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
import {
  closeWorkspace,
  finishOpening,
  startOpening,
  updateWorkspace,
  useWorkspace,
  workspaceState,
  type FileOrigin,
  type Opened,
  type WorkspaceFile,
} from "./workspace";

/** The workspace's tabs, which are also the last part of its address (`#/pmo/tables`). */
export const PMO_TABS = ["overview", "summary", "compare", "tables", "subset", "publish"] as const;

/** One of {@link PMO_TABS}. */
export type PmoTab = (typeof PMO_TABS)[number];

/** The address that opens the PMO the draft built. The Review step links here. */
export const OPEN_BUILT_PATH = "/pmo/open-built";

function isTab(value: string | undefined): value is PmoTab {
  return PMO_TABS.some((tab) => tab === value);
}

/** Why a file cannot be opened, as one sentence. */
function refusal(file: WorkspaceFile): string | null {
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

/** The Overview tab: whether the file is valid, anything worth a look, and what it holds. */
function Overview({ opened, origin }: { readonly opened: Opened; readonly origin: FileOrigin }) {
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

/** Opens the PMO the draft built, then shows its overview. */
function OpenBuilt() {
  const actions = useActions();
  const [, navigate] = useLocation();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    async function open(): Promise<void> {
      const generation = startOpening(t`Your built PMO`, 0);
      const result = await actions.openBuiltPmo();
      if (!live) return;
      if (result === null || result.outcome.kind !== "opened") {
        finishOpening(generation, { kind: "none" });
        setFailed(true);
        return;
      }
      finishOpening(generation, {
        kind: "opened",
        file: result.file.blob,
        name: result.file.fileName,
        size: result.file.blob.size,
        opened: result.outcome,
        origin: { kind: "built" },
      });
      navigate("/pmo/overview", { replace: true });
    }
    void open();
    return () => {
      live = false;
    };
  }, [actions, navigate]);

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
  const actions = useActions();
  const [, navigate] = useLocation();
  const file = useWorkspace((state) => state.file);
  const subset = useWorkspace((state) => state.subset);
  const tableSource = useWorkspace((state) => state.tableSource);
  const summarySource = useWorkspace((state) => state.summarySource);
  const build = useBuildState();
  const canOpenBuilt = build.view?.overall.pmo === "valid";
  const version = PUBLISHABLE_PMO_VERSION;

  async function open(chosen: File): Promise<void> {
    const generation = startOpening(chosen.name, chosen.size);
    const outcome = await actions.openPmo(chosen, chosen.name);
    const base = { name: chosen.name, size: chosen.size };
    if (outcome === null) finishOpening(generation, { kind: "failed", ...base });
    else if (outcome.kind === "opened")
      finishOpening(generation, {
        kind: "opened",
        file: chosen,
        ...base,
        opened: outcome,
        origin: { kind: "chosen" },
      });
    else finishOpening(generation, { kind: "refused", ...base, check: outcome.check });
  }

  const made = subset?.kind === "made" ? subset : null;
  const shownFile = file.kind === "none" ? null : { name: file.name, size: file.size };

  return (
    <PageContainer
      width={
        (tab === "summary" || tab === "compare") && file.kind === "opened" ? "full" : "reading"
      }
    >
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            <Trans>My PMO file</Trans>
          </h1>
          <p className="max-w-prose text-md text-text-muted">
            <Trans>
              Open a PMO file to see what it holds, download its tables as CSV or TSV, make a
              smaller PMO with only some specimens, targets or reads, or publish it. The file stays
              in this browser.
            </Trans>
          </p>
        </header>

        <FileDropzone
          label="PMO"
          description={t`A PMO file in version ${version}, saved as .json or .json.gz.`}
          accept={[".json", ".json.gz", ".gz"]}
          file={shownFile}
          onFileSelect={(chosen) => void open(chosen)}
          onRemove={closeWorkspace}
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
                content: <Overview opened={file.opened} origin={file.origin} />,
              },
              {
                value: "summary",
                label: t`Summary`,
                content: (
                  <SummaryPanel
                    key={workspaceState().generation}
                    hasSubset={made !== null}
                    source={summarySource}
                    onSourceChange={(next) => updateWorkspace({ summarySource: next })}
                  />
                ),
              },
              {
                value: "compare",
                label: t`Compare`,
                content: (
                  <CompareTab
                    key={workspaceState().generation}
                    hasSubset={made !== null}
                    source={summarySource}
                    onSourceChange={(next) => updateWorkspace({ summarySource: next })}
                  />
                ),
              },
              {
                value: "tables",
                label: t`Tables`,
                content: (
                  <TablesPanel
                    tables={file.opened.tables}
                    subsetTables={made?.tables ?? null}
                    source={made === null ? "original" : tableSource}
                    onSourceChange={(source) => updateWorkspace({ tableSource: source })}
                  />
                ),
              },
              {
                value: "subset",
                label: t`Subset`,
                content: (
                  <SubsetPanel
                    key={workspaceState().generation}
                    choices={file.opened.choices}
                    outcome={subset}
                    onMade={(outcome) => updateWorkspace({ subset: outcome })}
                    onShowTables={() => {
                      updateWorkspace({ tableSource: "subset" });
                      navigate("/pmo/tables");
                    }}
                    onPublish={
                      zenodo === null
                        ? null
                        : () => {
                            updateWorkspace({ publishSource: "subset" });
                            navigate("/pmo/publish");
                          }
                    }
                  />
                ),
              },
              ...(zenodo === null
                ? []
                : [
                    {
                      value: "publish" as const,
                      label: t`Publish to Zenodo`,
                      content: <PublishPanel zenodo={zenodo} file={file} subset={made} />,
                    },
                  ]),
            ]}
          />
        ) : null}

        {file.kind === "none" ? (
          <Callout tone="info" title={t`Where to get a PMO file`}>
            <Trans>
              Build one in this app from your tables, or download one from the published PMOs.
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
