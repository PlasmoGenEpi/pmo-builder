import { Trans } from "@lingui/react/macro";
import { ChartColumn, CircleCheck, CircleDashed, TriangleExclamationPoint } from "lucide-react";
import { Link as RouterLink } from "wouter";

import { StepPage } from "@/app/StepPage";
import { unreachable } from "@/domain/draft";
import { useBuildState } from "@/state";
import { Badge, ButtonLink, Card } from "@/ui";

import { PmoContents } from "./PmoContents";
import { PmoPreview } from "./PmoPreview";
import { PublishToZenodo } from "./PublishToZenodo";
import { getVerdict, reviewNotices, type Verdict } from "./reviewModel";
import { SectionChecklist } from "./SectionChecklist";
import { ThingsToCheck } from "./ThingsToCheck";
import { VerdictCard } from "./VerdictCard";
import { WhatNext } from "./WhatNext";
import { zenodoConfig, type ZenodoConfig } from "./zenodo";

function VerdictBadge({ verdict }: { readonly verdict: Verdict }) {
  switch (verdict.kind) {
    case "ready":
      return (
        <Badge tone="success" icon={CircleCheck}>
          <Trans context="PMO file" comment="The PMO file is ready to download">
            Ready
          </Trans>
        </Badge>
      );
    case "check":
      return (
        <Badge tone="warning" icon={TriangleExclamationPoint}>
          <Trans>Ready, with things to check</Trans>
        </Badge>
      );
    case "waiting":
    case "empty":
    case "not-ready":
      return (
        <Badge icon={CircleDashed}>
          <Trans>Not ready yet</Trans>
        </Badge>
      );
    default:
      return unreachable(verdict);
  }
}

/** The way into My PMO file, where the built PMO can be looked into. */
function ExploreCard() {
  // The address My PMO file opens the built PMO at; see PmoFilePage.
  const href = "/pmo/open-built";
  return (
    <Card as="section" className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex max-w-prose flex-col gap-1">
        <h2 className="text-lg font-semibold text-text">
          <Trans>Look into your PMO</Trans>
        </h2>
        <p className="text-base text-text-muted">
          <Trans>
            See a summary of its samples and targets, compare groups of specimens, download its
            tables, or make a subset.
          </Trans>
        </p>
      </div>
      <RouterLink href={href} asChild>
        <ButtonLink href={href}>
          <ChartColumn aria-hidden="true" className="size-4" />
          <Trans>Open in My PMO file</Trans>
        </ButtonLink>
      </RouterLink>
    </Card>
  );
}

/**
 * The review step: whether a PMO can be downloaded, the download and how to
 * publish a valid PMO, what to check, the way into My PMO file, where each
 * step stands, what the PMO holds, a preview, and what to do next. While a rebuild runs the last result stays on screen.
 */
export function ReviewStep({
  zenodo = zenodoConfig(),
}: {
  /** Where to publish, or `null` to leave the publish panel out. */
  readonly zenodo?: ZenodoConfig | null;
} = {}) {
  const build = useBuildState();
  const view = build.view;
  const verdict = getVerdict(view);
  const built = view !== null && view.overall.pmo !== "none";

  return (
    <StepPage stepId="review" status={<VerdictBadge verdict={verdict} />}>
      <div className="flex flex-col gap-8">
        <VerdictCard verdict={verdict}>
          {zenodo !== null &&
          view?.overall.pmo === "valid" &&
          view.overall.summary !== null &&
          view.overall.publication !== null ? (
            <PublishToZenodo
              zenodo={zenodo}
              summary={view.overall.summary}
              publication={view.overall.publication}
            />
          ) : null}
        </VerdictCard>
        {view === null ? null : <ThingsToCheck notices={reviewNotices(view)} built={built} />}
        {view?.overall.pmo === "valid" ? <ExploreCard /> : null}
        <SectionChecklist view={view} />
        {view === null ? null : <PmoContents summary={built ? view.overall.summary : null} />}
        {built ? <PmoPreview /> : null}
        <WhatNext />
      </div>
    </StepPage>
  );
}
