import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { FileSpreadsheet, Hammer } from "lucide-react";
import { useEffect, useState } from "react";
import { Link as RouterLink, useLocation, useParams } from "wouter";

import { PageContainer } from "@/app/PageContainer";
import { BUILD_PATH } from "@/app/steps";
// By path, not the barrel: the barrel would bring pmotools-ts onto the main thread.
import { PUBLISHABLE_PMO_VERSION } from "@/domain/build/checkFileResult";
import type { WorkingSource } from "@/domain/tools/types";
import { saveFile } from "@/features/review/saveFile";
import { zenodoConfig, type ZenodoConfig } from "@/features/review/zenodo";
import { useBuildState, useWorkingPmo, useWorkingPmoSession } from "@/state";
import {
  Button,
  Callout,
  FileDropActions,
  FileDropzone,
  Link,
  RadioGroup,
  Spinner,
  Tabs,
  buttonClassName,
  formatBytes,
  useFileDrop,
} from "@/ui";

import { Invalid, refusal } from "./FileRefusal";
import { PmoHeaderBar } from "./PmoHeaderBar";
import { PmoReading, readOnlyPmoTabs } from "./PmoReading";
import { PublishPanel } from "./PublishPanel";
import { SubsetPanel } from "./SubsetPanel";

/** My PMO file's tabs, which are also the last part of its address (`#/pmo/tables`). */
export const PMO_TABS = ["overview", "summary", "compare", "tables", "subset", "publish"] as const;

/** One of {@link PMO_TABS}. */
export type PmoTab = (typeof PMO_TABS)[number];

/** The address that opens the PMO the draft built. The Review step links here. */
export const OPEN_BUILT_PATH = "/pmo/open-built";

function isTab(value: string | undefined): value is PmoTab {
  return PMO_TABS.some((tab) => tab === value);
}

/**
 * Opens the PMO the draft built, then shows My PMO file: its summary, or
 * why it was refused or could not be opened, as for any other file. The
 * session runs the open to the end even if this page is left meanwhile; only
 * moving to My PMO file is skipped then.
 */
function OpenBuilt() {
  const session = useWorkingPmoSession();
  const [, navigate] = useLocation();
  const [noBuiltPmo, setNoBuiltPmo] = useState(false);

  useEffect(() => {
    let live = true;
    async function open(): Promise<void> {
      const result = await session.open({ kind: "built" });
      if (!live || result.kind === "superseded") return;
      if (result.kind === "no-built-pmo") setNoBuiltPmo(true);
      else navigate("/pmo/summary", { replace: true });
    }
    void open();
    return () => {
      live = false;
    };
  }, [session, navigate]);

  return noBuiltPmo ? (
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

const PMO_ACCEPT = [".json", ".json.gz", ".gz"] as const;

/** The compact top bar shown when a working PMO is open: file name, size, source switch, Replace and Remove. */
function WorkingPmoBar({
  name,
  size,
  hasSubset,
  hasZenodo,
  source,
  onSourceChange,
  onFileSelect,
  onRemove,
}: {
  readonly name: string;
  readonly size: number;
  readonly hasSubset: boolean;
  readonly hasZenodo: boolean;
  readonly source: WorkingSource;
  readonly onSourceChange: (source: WorkingSource) => void;
  readonly onFileSelect: (file: File) => void;
  readonly onRemove: () => void;
}) {
  const { choose, dragHandlers, dragging, rejection, clearRejection, input } = useFileDrop({
    label: "PMO",
    accept: PMO_ACCEPT,
    onFileSelect,
  });

  return (
    <PmoHeaderBar
      icon={<FileSpreadsheet aria-hidden="true" className="size-4" />}
      title={name}
      titleTooltip={name}
      monoTitle
      meta={formatBytes(size)}
      tone={dragging ? "dragging" : rejection ? "error" : "default"}
      dragHandlers={dragHandlers}
      error={rejection}
      actions={
        <>
          {hasSubset ? (
            <RadioGroup<WorkingSource>
              variant="segmented"
              label={t`Work with`}
              hint={
                hasZenodo
                  ? t`Summary, Compare, Tables and Publish use the PMO chosen here.`
                  : t`Summary, Compare and Tables use the PMO chosen here.`
              }
              value={source}
              onValueChange={onSourceChange}
              options={[
                {
                  value: "original",
                  label: t({ message: "Original", comment: "The PMO file as it was opened" }),
                },
                {
                  value: "subset",
                  label: t({ message: "Subset", comment: "A smaller PMO made from the original" }),
                },
              ]}
            />
          ) : null}
          <FileDropActions
            label="PMO"
            onReplace={choose}
            onRemove={() => {
              clearRejection();
              onRemove();
            }}
          />
        </>
      }
    >
      {input}
    </PmoHeaderBar>
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
  const source = useWorkingPmo((state) => state.source);
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

  if (file.kind === "opened") {
    return (
      // One width once a file is open, so the bar and the tabs stay put when
      // switching between the wide views (Summary, Compare) and the others.
      <PageContainer width="full" compact>
        <div className="flex flex-col gap-4">
          <WorkingPmoBar
            name={file.name}
            size={file.size}
            hasSubset={made !== null}
            hasZenodo={zenodo !== null}
            source={source}
            onSourceChange={(next) => session.setSource(next)}
            onFileSelect={open}
            onRemove={() => void session.close()}
          />

          <Tabs<PmoTab>
            label={t`What to do with the file`}
            value={zenodo === null && tab === "publish" ? "overview" : tab}
            onValueChange={(next) => navigate(`/pmo/${next}`)}
            tabs={[
              ...readOnlyPmoTabs({
                opened: file.opened,
                origin: file.origin,
                onDownload: () => saveFile(file.file, file.name),
                generation,
                source,
                maxReads:
                  source === "original" ? file.opened.choices.maxReads : (made?.maxReads ?? null),
                minReads,
                onMinReadsChange: (next) => session.setMinReads(next),
                subsetTables: made?.tables ?? null,
              }),
              {
                value: "subset",
                label: t`Subset`,
                content: (
                  <PmoReading>
                    <SubsetPanel
                      key={generation}
                      choices={file.opened.choices}
                      original={file.opened.summary}
                      onShowSummary={() => {
                        session.setSource("subset");
                        navigate("/pmo/summary");
                      }}
                      onShowTables={() => {
                        session.setSource("subset");
                        navigate("/pmo/tables");
                      }}
                      onPublish={
                        zenodo === null
                          ? null
                          : () => {
                              session.setSource("subset");
                              navigate("/pmo/publish");
                            }
                      }
                    />
                  </PmoReading>
                ),
              },
              ...(zenodo === null
                ? []
                : [
                    {
                      value: "publish" as const,
                      label: t`Publish to Zenodo`,
                      content: (
                        <PmoReading>
                          <PublishPanel zenodo={zenodo} file={file} subset={made} source={source} />
                        </PmoReading>
                      ),
                    },
                  ]),
            ]}
          />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="reading">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            <Trans>My PMO file</Trans>
          </h1>
          <p className="max-w-prose text-md text-text-muted">
            <Trans>
              Open a PMO file to see a summary of its samples and targets, compare groups of
              specimens, download its tables as CSV or TSV, make a smaller PMO with only some
              specimens, targets or reads, or publish it. The file stays in this browser.
            </Trans>
          </p>
        </header>

        <FileDropzone
          label="PMO"
          description={t`A PMO file in version ${version}, saved as .json or .json.gz.`}
          accept={PMO_ACCEPT}
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
