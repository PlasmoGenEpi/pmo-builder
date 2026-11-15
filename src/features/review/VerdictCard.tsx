import { CircleCheck, CircleDashed, Download, TriangleExclamationPoint } from "lucide-react";
import { StepLink } from "@/app/StepLink";
import type { ReactNode } from "react";

import { getStep } from "@/app/steps";
import { unreachable } from "@/domain/draft";
import { useBuildState } from "@/state";
import { Button, Callout, Card, cn, formatBytes } from "@/ui";

import { count, type Blocker, type BlockerProblem, type Verdict } from "./reviewModel";
import { usePmoDownload } from "./usePmoDownload";
import { usePmoFiles, type PmoFileInfo } from "./usePmoFiles";

const PROBLEM_TEXT: Readonly<Record<BlockerProblem, string>> = {
  missing: "is needed and has nothing in it yet.",
  unfinished: "is needed and is not finished yet.",
  errors: "has problems to fix.",
};

function BlockerList({ blockers }: { readonly blockers: readonly Blocker[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {blockers.map(({ section, problem }) => {
        const step = getStep(section);
        return (
          <li key={section} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-base text-text">
              <span className="font-medium">{step.title}</span> {PROBLEM_TEXT[problem]}
            </span>
            <StepLink step={section} variant="arrow">
              Go to {step.title}
            </StepLink>
          </li>
        );
      })}
    </ul>
  );
}

function sizeText(info: PmoFileInfo | null): string {
  if (info === null) return "Working out the size";
  if (info.size === null) return `${info.fileName}. Its size is worked out when you download it.`;
  return `${info.fileName}, ${formatBytes(info.size)}`;
}

/** The download buttons, each with the file name and size it gives. */
function DownloadActions() {
  const files = usePmoFiles();
  const { busy, download } = usePmoDownload();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:gap-6">
      <div className="flex flex-col gap-1.5">
        <Button
          variant="primary"
          size="lg"
          icon={Download}
          loading={busy === "gzip"}
          onClick={() => void download(true)}
          aria-describedby="review-download-gzip"
        >
          Download PMO
        </Button>
        <span id="review-download-gzip" className="text-sm break-all text-text-muted">
          {sizeText(files.gzip)}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Button
          size="lg"
          loading={busy === "json"}
          onClick={() => void download(false)}
          aria-describedby="review-download-json"
        >
          Download as plain JSON
        </Button>
        <span id="review-download-json" className="text-sm break-all text-text-muted">
          {sizeText(files.json)}
        </span>
      </div>
    </div>
  );
}

interface Wording {
  readonly icon: typeof CircleCheck;
  readonly iconClass: string;
  readonly title: string;
  readonly body: ReactNode;
}

function issueCount(errors: number, warnings: number): string {
  const parts = [
    errors > 0 ? count(errors, "problem") : null,
    warnings > 0 ? count(warnings, "warning") : null,
  ].filter((part) => part !== null);
  return parts.join(" and ");
}

function wording(verdict: Verdict): Wording {
  switch (verdict.kind) {
    case "waiting":
      return {
        icon: CircleDashed,
        iconClass: "text-text-subtle",
        title: "Checking your draft",
        body: "Working out whether a PMO can be built from what you added.",
      };
    case "empty":
      return {
        icon: CircleDashed,
        iconClass: "text-text-subtle",
        title: "Not ready yet",
        body: (
          <div className="flex flex-col gap-3">
            <p>A PMO needs an allele table and a panel. Nothing has been added yet.</p>
            <BlockerList
              blockers={[
                { section: "microhaplotypes", problem: "missing" },
                { section: "panel", problem: "missing" },
              ]}
            />
          </div>
        ),
      };
    case "not-ready":
      return {
        icon: CircleDashed,
        iconClass: "text-warning",
        title: "Not ready yet",
        body:
          verdict.blockers.length === 0 ? (
            <p>
              Your tables could not be put together into a PMO. The problems are listed under Things
              to check below.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p>
                {verdict.blockers.length === 1
                  ? "One step needs your attention before a PMO can be built."
                  : `${verdict.blockers.length} steps need your attention before a PMO can be built.`}
              </p>
              <BlockerList blockers={verdict.blockers} />
            </div>
          ),
      };
    case "check":
      return {
        icon: TriangleExclamationPoint,
        iconClass: "text-warning",
        title: "Ready, with things to check",
        body: verdict.valid ? (
          <p>
            Your PMO can be downloaded. There{" "}
            {verdict.errors + verdict.warnings === 1 ? "is" : "are"}{" "}
            {issueCount(verdict.errors, verdict.warnings)} worth a look below.
          </p>
        ) : (
          <p>
            Your PMO can be downloaded, but it does not fully match the PMO format, so other tools
            may not read it. See the {issueCount(verdict.errors, verdict.warnings)} below.
          </p>
        ),
      };
    case "ready":
      return {
        icon: CircleCheck,
        iconClass: "text-success",
        title: "Ready to download",
        body: <p>Your PMO matches the PMO format and every table links up. Nothing to check.</p>,
      };
    default:
      return unreachable(verdict);
  }
}

/**
 * The answer to "can I download a PMO": the verdict, what stops it, and the
 * download buttons whenever a PMO was built, with `children` under them.
 */
export function VerdictCard({
  verdict,
  children,
}: {
  readonly verdict: Verdict;
  /** What else can be done with the PMO, shown under the download buttons. */
  readonly children?: ReactNode;
}) {
  const build = useBuildState();
  const updating = build.phase === "pending";
  const { icon: Icon, iconClass, title, body } = wording(verdict);
  const canDownload = verdict.kind === "check" || verdict.kind === "ready";

  return (
    <Card as="section" aria-labelledby="review-verdict-heading" aria-busy={updating || undefined}>
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Icon aria-hidden="true" className={cn("mt-1 size-6 shrink-0", iconClass)} />
            <h2
              id="review-verdict-heading"
              className="text-xl font-semibold tracking-tight text-text"
              aria-live="polite"
            >
              {title}
            </h2>
          </div>
          <span
            className={cn(
              "mt-1.5 flex shrink-0 items-center gap-1.5 text-sm text-text-muted transition-opacity duration-150",
              updating ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={!updating}
          >
            <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
            Updating
          </span>
        </div>
        <div
          className={cn(
            "flex flex-col gap-5 text-md text-text transition-opacity",
            updating && "opacity-70",
          )}
        >
          {body}
          {canDownload ? <DownloadActions /> : null}
          {canDownload ? children : null}
          {build.phase === "failed" ? (
            <Callout tone="error" title="The PMO could not be worked out">
              {build.message} Reload the page to try again.
            </Callout>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
