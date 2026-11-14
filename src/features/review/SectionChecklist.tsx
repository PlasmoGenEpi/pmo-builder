import { CircleCheck, CircleDashed, CircleDot, CircleMinus, CircleX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link as RouterLink } from "wouter";

import { getStep } from "@/app/steps";
import { SECTION_IDS, type SectionId } from "@/domain/types";
import { Badge, Card, type BadgeTone } from "@/ui";
import type { BuildView } from "@/worker";

import {
  STATE_LINE,
  checklistState,
  count,
  isRequiredSection,
  summaryLine,
  type ChecklistState,
} from "./reviewModel";

const STATE_META: Readonly<
  Record<
    ChecklistState,
    { readonly label: string; readonly tone: BadgeTone; readonly icon: LucideIcon }
  >
> = {
  ready: { label: "Ready", tone: "success", icon: CircleCheck },
  errors: { label: "Has errors", tone: "danger", icon: CircleX },
  unfinished: { label: "Not finished", tone: "warning", icon: CircleDot },
  "left-out": { label: "Left out", tone: "neutral", icon: CircleMinus },
  needed: { label: "Needed", tone: "warning", icon: CircleDashed },
  "not-added": { label: "Not added", tone: "neutral", icon: CircleDashed },
};

function Row({ section, view }: { readonly section: SectionId; readonly view: BuildView | null }) {
  const step = getStep(section);
  const sectionView = view?.sections[section] ?? null;
  const state = checklistState(section, sectionView?.status ?? "empty");
  const meta = STATE_META[state];
  const warnings =
    sectionView?.notices.filter((notice) => notice.severity === "warning").length ?? 0;
  let line: string;
  if (sectionView === null) line = "Working out where this step stands.";
  else if (state === "ready" && sectionView.summary !== null) {
    line = summaryLine(section, sectionView.summary);
  } else if (state === "ready") line = "Ready.";
  else line = STATE_LINE[state];

  return (
    <li className="flex flex-col gap-0.5 py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <RouterLink
            href={step.path}
            className="rounded-sm text-base font-medium text-text underline-offset-2 hover:text-accent-text hover:underline"
          >
            {step.title}
          </RouterLink>
          {isRequiredSection(section) ? (
            <span className="text-xs text-text-subtle">Required</span>
          ) : null}
        </div>
        <Badge tone={meta.tone} icon={meta.icon}>
          {meta.label}
        </Badge>
      </div>
      <p className="text-base text-text-muted">
        {state === "ready" && warnings > 0
          ? `${line}. ${count(warnings, "warning")} to check.`
          : line}
      </p>
    </li>
  );
}

/** Every section with its status, a one-line summary and a link to its step. */
export function SectionChecklist({ view }: { readonly view: BuildView | null }) {
  return (
    <Card as="section" aria-labelledby="review-checklist-heading">
      <div className="flex flex-col gap-4">
        <h2
          id="review-checklist-heading"
          className="text-lg font-semibold tracking-tight text-text"
        >
          Steps
        </h2>
        <ul className="flex flex-col divide-y divide-border">
          {SECTION_IDS.map((section) => (
            <Row key={section} section={section} view={view} />
          ))}
        </ul>
      </div>
    </Card>
  );
}
