import { ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { Link as RouterLink } from "wouter";

import { PageContainer } from "@/app/PageContainer";
import { MAX_LISTED, PUBLISHABLE_PMO_VERSION, type PmoFileCheck } from "@/domain/build";
import { PmoContents } from "@/features/review/PmoContents";
import { PublishToZenodo } from "@/features/review/PublishToZenodo";
import { communityUrl, zenodoConfig, type ZenodoConfig } from "@/features/review/zenodo";
import { useActions } from "@/state";
import { buttonClassName, Callout, FileDropzone, formatBytes, Link } from "@/ui";

/** Where checking the chosen file stands. */
type FileState =
  | { readonly kind: "none" }
  | { readonly kind: "checking"; readonly file: File }
  | { readonly kind: "checked"; readonly file: File; readonly check: PmoFileCheck }
  | { readonly kind: "failed"; readonly file: File };

/** A sentence for a file that cannot be published, or `null` when the file is fine or needs a list. */
function problemOf(state: FileState): string | null {
  if (state.kind === "failed")
    return "The file could not be checked. Reload the page and try again.";
  if (state.kind !== "checked") return null;
  const { check } = state;
  switch (check.kind) {
    case "ready":
    case "invalid":
      return null;
    case "too-large":
      return `This file is larger than ${formatBytes(check.limit)}, more than this browser can check.`;
    case "unreadable":
      if (check.reason === "gzip")
        return "This file looks gzipped but could not be unpacked. Check that it downloaded completely.";
      if (check.reason === "json")
        return "This is not a PMO file. A PMO file holds JSON and is saved as .json or .json.gz.";
      return "This JSON file is not a PMO: it has no PMO header.";
    case "wrong-version":
      return `${
        check.declared === null
          ? "This file does not say which PMO version it is."
          : `This file is in PMO version ${check.declared}.`
      } Only version ${PUBLISHABLE_PMO_VERSION} files can be published. Build it again from your tables in PMO Builder to get a ${PUBLISHABLE_PMO_VERSION} file.`;
    default:
      return null;
  }
}

function RebuildLink() {
  return (
    <RouterLink href="/" className={buttonClassName({ variant: "secondary", size: "sm" })}>
      Build a PMO
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </RouterLink>
  );
}

function Invalid({
  problems,
  unlisted: rest,
}: {
  readonly problems: readonly string[];
  readonly unlisted: number;
}) {
  return (
    <Callout
      tone="error"
      live
      title="This file does not match the PMO format"
      action={<RebuildLink />}
    >
      <div className="flex flex-col gap-2">
        <p>
          It cannot be published as it is. Build the PMO again from your tables in PMO Builder,
          which checks it as you go.
        </p>
        <ul className="list-disc pl-5">
          {problems.map((problem) => (
            <li key={problem} className="break-words">
              {problem}
            </li>
          ))}
        </ul>
        {rest > 0 ? (
          <p>
            {rest} more {rest === 1 ? "problem is" : "problems are"} not listed.
          </p>
        ) : null}
      </div>
    </Callout>
  );
}

function Ready({
  zenodo,
  file,
  check,
}: {
  readonly zenodo: ZenodoConfig;
  readonly file: File;
  readonly check: Extract<PmoFileCheck, { readonly kind: "ready" }>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Callout tone="success" live title="This file is a valid PMO">
        It matches PMO version {PUBLISHABLE_PMO_VERSION} and its tables link up.
      </Callout>
      {check.warnings.length === 0 ? null : (
        <Callout tone="warning" title="Worth a look before you publish">
          <ul className="list-disc pl-5">
            {check.warnings.map((warning) => (
              <li key={warning} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
          {check.warnings.length === MAX_LISTED ? <p>There may be more.</p> : null}
        </Callout>
      )}
      <PublishToZenodo
        zenodo={zenodo}
        summary={check.summary}
        publication={check.publication}
        source={{ kind: "file", file, fileName: file.name }}
        variant="card"
      />
      <PmoContents summary={check.summary} />
    </div>
  );
}

/** Props for {@link PublishFilePage}. For tests; the app passes none. */
export interface PublishFilePageProps {
  readonly zenodo?: ZenodoConfig | null;
}

/**
 * Publishing a PMO file the user already has: it is checked in this browser,
 * then deposited in the Zenodo community the same way as a PMO built here.
 * The draft is not touched.
 */
export function PublishFilePage({ zenodo = zenodoConfig() }: PublishFilePageProps = {}) {
  const actions = useActions();
  const [state, setState] = useState<FileState>({ kind: "none" });
  /** The latest file chosen, so an older check that finishes late is ignored. */
  const latest = useRef<File | null>(null);

  async function check(file: File): Promise<void> {
    latest.current = file;
    setState({ kind: "checking", file });
    const result = await actions.checkPmoFile(file);
    if (latest.current !== file) return;
    setState(result === null ? { kind: "failed", file } : { kind: "checked", file, check: result });
  }

  const file = state.kind === "none" ? null : state.file;
  const problem = problemOf(state);

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">Publish a PMO file</h1>
          <p className="max-w-prose text-md text-text-muted">
            Already have a PMO file, built here earlier or with pmotools? Check it and deposit it
            {zenodo === null ? (
              " on Zenodo"
            ) : (
              <>
                {" "}
                in the{" "}
                <Link href={communityUrl(zenodo.community)} external>
                  {zenodo.communityName} community
                </Link>{" "}
                on Zenodo
              </>
            )}
            . The file is checked in this browser, and nothing is sent until you choose to deposit.
          </p>
        </header>

        {zenodo === null ? (
          <Callout tone="info" title="This copy of PMO Builder is not set up for publishing">
            Publishing needs the app to be set up with a Zenodo community.
          </Callout>
        ) : (
          <>
            <FileDropzone
              label="PMO"
              description={`A PMO file in version ${PUBLISHABLE_PMO_VERSION}, saved as .json or .json.gz.`}
              accept={[".json", ".json.gz", ".gz"]}
              file={file === null ? null : { name: file.name, size: file.size }}
              onFileSelect={(chosen) => void check(chosen)}
              onRemove={() => {
                latest.current = null;
                setState({ kind: "none" });
              }}
              busy={state.kind === "checking" ? "Checking the file" : false}
              error={problem}
            />
            {state.kind === "checked" && state.check.kind === "invalid" ? (
              <Invalid problems={state.check.problems} unlisted={state.check.unlisted} />
            ) : null}
            {state.kind === "checked" && state.check.kind === "ready" ? (
              <Ready zenodo={zenodo} file={state.file} check={state.check} />
            ) : null}
          </>
        )}
      </div>
    </PageContainer>
  );
}
