import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CircleCheck, CircleDashed, Download, TriangleExclamationPoint } from "lucide-react";
import { StepLink } from "@/app/StepLink";
import type { ReactNode } from "react";

import { getStep } from "@/app/steps";
import { unreachable } from "@/domain/draft";
import { useBuildState } from "@/state";
import { Button, Callout, Card, cn, formatBytes } from "@/ui";

import type { Blocker, BlockerProblem, Verdict } from "./reviewModel";
import { usePmoDownload } from "./usePmoDownload";
import { usePmoFiles, type PmoFileInfo } from "./usePmoFiles";

/** What stops a step, as one sentence that starts with the step's name in bold. */
function ProblemText({
  stepTitle,
  problem,
}: {
  readonly stepTitle: string;
  readonly problem: BlockerProblem;
}) {
  switch (problem) {
    case "missing":
      return (
        <Trans>
          <span className="font-medium">{stepTitle}</span> is needed and has nothing in it yet.
        </Trans>
      );
    case "unfinished":
      return (
        <Trans>
          <span className="font-medium">{stepTitle}</span> is needed and is not finished yet.
        </Trans>
      );
    case "errors":
      return (
        <Trans>
          <span className="font-medium">{stepTitle}</span> has problems to fix.
        </Trans>
      );
    default:
      return unreachable(problem);
  }
}

function BlockerList({ blockers }: { readonly blockers: readonly Blocker[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {blockers.map(({ section, problem }) => {
        const stepTitle = getStep(section).title;
        return (
          <li key={section} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-base text-text">
              <ProblemText stepTitle={stepTitle} problem={problem} />
            </span>
            <StepLink step={section} variant="arrow">
              <Trans>Go to {stepTitle}</Trans>
            </StepLink>
          </li>
        );
      })}
    </ul>
  );
}

function sizeText(info: PmoFileInfo | null): string {
  if (info === null) return t`Working out the size`;
  const fileName = info.fileName;
  if (info.size === null) return t`${fileName}. Its size is worked out when you download it.`;
  const fileSize = formatBytes(info.size);
  return t`${fileName}, ${fileSize}`;
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
          <Trans>Download PMO</Trans>
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
          <Trans>Download as plain JSON</Trans>
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

/** What the verdict says when a PMO was built with things to check. */
function checkText(valid: boolean, errors: number, warnings: number): string {
  if (valid) {
    if (errors > 0 && warnings > 0)
      return t`Your PMO can be downloaded. There are ${plural(errors, { one: "# problem", other: "# problems" })} and ${plural(warnings, { one: "# warning", other: "# warnings" })} worth a look below.`;
    if (errors > 0)
      return plural(errors, {
        one: "Your PMO can be downloaded. There is # problem worth a look below.",
        other: "Your PMO can be downloaded. There are # problems worth a look below.",
      });
    return plural(warnings, {
      one: "Your PMO can be downloaded. There is # warning worth a look below.",
      other: "Your PMO can be downloaded. There are # warnings worth a look below.",
    });
  }
  if (errors > 0 && warnings > 0)
    return t`Your PMO can be downloaded, but it does not fully match the PMO format, so other tools may not read it. See the ${plural(errors, { one: "# problem", other: "# problems" })} and ${plural(warnings, { one: "# warning", other: "# warnings" })} below.`;
  if (warnings > 0)
    return plural(warnings, {
      one: "Your PMO can be downloaded, but it does not fully match the PMO format, so other tools may not read it. See the # warning below.",
      other:
        "Your PMO can be downloaded, but it does not fully match the PMO format, so other tools may not read it. See the # warnings below.",
    });
  return plural(errors, {
    one: "Your PMO can be downloaded, but it does not fully match the PMO format, so other tools may not read it. See the # problem below.",
    other:
      "Your PMO can be downloaded, but it does not fully match the PMO format, so other tools may not read it. See the # problems below.",
  });
}

function wording(verdict: Verdict): Wording {
  switch (verdict.kind) {
    case "waiting":
      return {
        icon: CircleDashed,
        iconClass: "text-text-subtle",
        title: t`Checking your draft`,
        body: t`Working out whether a PMO can be built from what you added.`,
      };
    case "empty":
      return {
        icon: CircleDashed,
        iconClass: "text-text-subtle",
        title: t`Not ready yet`,
        body: (
          <div className="flex flex-col gap-3">
            <p>
              <Trans>A PMO needs an allele table and a panel. Nothing has been added yet.</Trans>
            </p>
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
        title: t`Not ready yet`,
        body:
          verdict.blockers.length === 0 ? (
            <p>
              <Trans>
                Your tables could not be put together into a PMO. The problems are listed under
                Things to check below.
              </Trans>
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p>
                {plural(verdict.blockers.length, {
                  one: "One step needs your attention before a PMO can be built.",
                  other: "# steps need your attention before a PMO can be built.",
                })}
              </p>
              <BlockerList blockers={verdict.blockers} />
            </div>
          ),
      };
    case "check":
      return {
        icon: TriangleExclamationPoint,
        iconClass: "text-warning",
        title: t`Ready, with things to check`,
        body: <p>{checkText(verdict.valid, verdict.errors, verdict.warnings)}</p>,
      };
    case "ready":
      return {
        icon: CircleCheck,
        iconClass: "text-success",
        title: t`Ready to download`,
        body: (
          <p>
            <Trans>
              Your PMO matches the PMO format and every table links up. Nothing to check.
            </Trans>
          </p>
        ),
      };
    default:
      return unreachable(verdict);
  }
}

/** Why the build failed, then what to do. */
function FailureText({ message }: { readonly message: string }) {
  return <Trans>{message} Reload the page to try again.</Trans>;
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
            <Trans>Updating</Trans>
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
            <Callout tone="error" title={t`The PMO could not be worked out`}>
              <FailureText message={build.message} />
            </Callout>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
