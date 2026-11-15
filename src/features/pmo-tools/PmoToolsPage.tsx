import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useRef, useState } from "react";

import { PageContainer } from "@/app/PageContainer";
// By path, not the barrel: the barrel would bring pmotools-ts onto the main thread.
import { PUBLISHABLE_PMO_VERSION, type PmoFileCheck } from "@/domain/build/checkFileResult";
import type { OpenOutcome, SubsetOutcome, WorkingSource } from "@/domain/tools/types";
import { PmoContents } from "@/features/review/PmoContents";
import { useActions } from "@/state";
import { Callout, FileDropzone, Tabs, formatBytes } from "@/ui";

import { SubsetPanel } from "./SubsetPanel";
import { TablesPanel } from "./TablesPanel";

type Opened = Extract<OpenOutcome, { kind: "opened" }>;

/** Where opening the chosen file stands. */
type FileState =
  | { readonly kind: "none" }
  | { readonly kind: "opening"; readonly file: File }
  | { readonly kind: "opened"; readonly file: File; readonly opened: Opened }
  | {
      readonly kind: "refused";
      readonly file: File;
      readonly check: Exclude<PmoFileCheck, { kind: "ready" }>;
    }
  | { readonly kind: "failed"; readonly file: File };

/** Why a file cannot be opened, as one sentence. */
function refusal(state: FileState): string | null {
  const version = PUBLISHABLE_PMO_VERSION;
  if (state.kind === "failed")
    return t`The file could not be opened. Reload the page and try again.`;
  if (state.kind !== "refused") return null;
  const { check } = state;
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
        ? t`This file does not say which PMO version it is. Only version ${version} files can be opened here.`
        : t`This file is in PMO version ${declared}. Only version ${version} files can be opened here.`;
    }
    case "invalid":
      return t`This file does not match the PMO format, so it cannot be worked with here. Check it on the Publish a PMO file page to see what is wrong.`;
    default:
      return null;
  }
}

type Tab = "tables" | "subset";

/**
 * Working with a PMO file the user already has: downloading its tables, and
 * making a smaller PMO with some specimens, targets or reads. The file is
 * read in this browser's worker; the draft is not touched.
 */
export function PmoToolsPage() {
  const actions = useActions();
  const [state, setState] = useState<FileState>({ kind: "none" });
  const [tab, setTab] = useState<Tab>("tables");
  const [subset, setSubset] = useState<SubsetOutcome | null>(null);
  const [source, setSource] = useState<WorkingSource>("original");
  /** The latest file chosen, so an older open that finishes late is ignored. */
  const latest = useRef<File | null>(null);
  const version = PUBLISHABLE_PMO_VERSION;

  async function open(file: File): Promise<void> {
    latest.current = file;
    setState({ kind: "opening", file });
    setSubset(null);
    setSource("original");
    const outcome = await actions.openPmo(file, file.name);
    if (latest.current !== file) return;
    if (outcome === null) setState({ kind: "failed", file });
    else if (outcome.kind === "opened") setState({ kind: "opened", file, opened: outcome });
    else setState({ kind: "refused", file, check: outcome.check });
  }

  const file = state.kind === "none" ? null : state.file;
  const made = subset?.kind === "made" ? subset : null;

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            <Trans>Subset or export a PMO</Trans>
          </h1>
          <p className="max-w-prose text-md text-text-muted">
            <Trans>
              Open a PMO file to download its tables as CSV or TSV, or to make a smaller PMO with
              only some specimens, targets or reads. The file stays in this browser.
            </Trans>
          </p>
        </header>

        <FileDropzone
          label="PMO"
          description={t`A PMO file in version ${version}, saved as .json or .json.gz.`}
          accept={[".json", ".json.gz", ".gz"]}
          file={file === null ? null : { name: file.name, size: file.size }}
          onFileSelect={(chosen) => void open(chosen)}
          onRemove={() => {
            latest.current = null;
            setState({ kind: "none" });
            setSubset(null);
          }}
          busy={state.kind === "opening" ? t`Opening the file` : false}
          error={refusal(state)}
        />

        {state.kind === "opened" ? (
          <>
            <PmoContents summary={state.opened.summary} />
            <Tabs<Tab>
              label={t`What to do with the file`}
              value={tab}
              onValueChange={setTab}
              tabs={[
                {
                  value: "tables",
                  label: t`Download tables`,
                  content: (
                    <TablesPanel
                      tables={state.opened.tables}
                      subsetTables={made?.tables ?? null}
                      source={made === null ? "original" : source}
                      onSourceChange={setSource}
                    />
                  ),
                },
                {
                  value: "subset",
                  label: t`Make a subset`,
                  content: (
                    <SubsetPanel
                      key={state.opened.fileName}
                      choices={state.opened.choices}
                      outcome={subset}
                      onMade={setSubset}
                      onShowTables={() => {
                        setSource("subset");
                        setTab("tables");
                      }}
                    />
                  ),
                },
              ]}
            />
          </>
        ) : null}

        {state.kind === "none" ? (
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
