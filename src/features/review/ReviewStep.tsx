import { CircleCheck, CircleDashed, TriangleExclamationPoint } from "lucide-react";

import { StepPage } from "@/app/StepPage";
import { unreachable } from "@/domain/draft";
import { useBuildState } from "@/state";
import { Badge } from "@/ui";

import { PmoContents } from "./PmoContents";
import { PmoPreview } from "./PmoPreview";
import { getVerdict, reviewNotices, type Verdict } from "./reviewModel";
import { SectionChecklist } from "./SectionChecklist";
import { ThingsToCheck } from "./ThingsToCheck";
import { VerdictCard } from "./VerdictCard";
import { WhatNext } from "./WhatNext";

function VerdictBadge({ verdict }: { readonly verdict: Verdict }) {
  switch (verdict.kind) {
    case "ready":
      return (
        <Badge tone="success" icon={CircleCheck}>
          Ready
        </Badge>
      );
    case "check":
      return (
        <Badge tone="warning" icon={TriangleExclamationPoint}>
          Ready, with things to check
        </Badge>
      );
    case "waiting":
    case "empty":
    case "not-ready":
      return <Badge icon={CircleDashed}>Not ready yet</Badge>;
    default:
      return unreachable(verdict);
  }
}

/**
 * The review step: whether a PMO can be downloaded and the download, where
 * each step stands, what the PMO holds, what to check, a preview, and what
 * to do next. While a rebuild runs the last result stays on screen.
 */
export function ReviewStep() {
  const build = useBuildState();
  const view = build.view;
  const verdict = getVerdict(view);
  const built = view !== null && view.overall.pmo !== "none";

  return (
    <StepPage stepId="review" status={<VerdictBadge verdict={verdict} />}>
      <div className="flex flex-col gap-8">
        <VerdictCard verdict={verdict} />
        <SectionChecklist view={view} />
        {view === null ? null : (
          <>
            <PmoContents summary={built ? view.overall.summary : null} />
            <ThingsToCheck notices={reviewNotices(view)} built={built} />
          </>
        )}
        {built ? <PmoPreview /> : null}
        <WhatNext />
      </div>
    </StepPage>
  );
}
