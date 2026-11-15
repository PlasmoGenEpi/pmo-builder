import { t } from "@lingui/core/macro";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link as RouterLink } from "wouter";

import { Badge, StatusBadge, cn } from "@/ui";

import { PageContainer, type PageWidth } from "./PageContainer";
import { STEPS, getAdjacentSteps, getStep, type StepDefinition, type StepId } from "./steps";
import { useStepStatus } from "./stepStatus";

/** Props for {@link StepPage}. */
export interface StepPageProps {
  /** Which step this page is. Title, purpose and Back and Next come from the registry. */
  stepId: StepId;
  children: ReactNode;
  /** `full` for pages that show wide tables. Defaults to the build steps' width. */
  width?: PageWidth;
  /** Replaces the default status badge, for example with a badge and a short summary. */
  status?: ReactNode;
  /** Buttons at the end of the title row. */
  actions?: ReactNode;
}

function StepLink({
  step,
  direction,
}: {
  step: StepDefinition | null;
  direction: "back" | "next";
}) {
  const isBack = direction === "back";
  const href = step === null ? "/" : step.path;
  const title = step === null ? t`Home` : step.title;
  return (
    <RouterLink
      href={href}
      className={cn(
        "group flex min-w-0 flex-1 basis-0 flex-col gap-0.5 rounded-lg border border-border px-4 py-3 transition-colors duration-100 hover:border-border-strong hover:bg-surface-subtle sm:flex-none sm:basis-auto sm:min-w-52",
        isBack ? "items-start" : "ml-auto items-end text-right",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm text-text-muted">
        {isBack ? <ArrowLeft aria-hidden="true" className="size-3.5" /> : null}
        {isBack ? t`Back` : t`Next`}
        {isBack ? null : <ArrowRight aria-hidden="true" className="size-3.5" />}
      </span>
      <span className="max-w-full truncate text-base font-medium text-text group-hover:text-accent-text">
        {title}
      </span>
    </RouterLink>
  );
}

/**
 * The template every step page uses: title, one-sentence purpose, required or
 * optional badge, status, the page content, and Back and Next links that
 * follow the step registry.
 *
 * @example
 * export function PanelStep() {
 *   return <StepPage stepId="panel">...</StepPage>;
 * }
 */
export function StepPage({ stepId, children, width = "step", status, actions }: StepPageProps) {
  const step = getStep(stepId);
  const { previous, next } = getAdjacentSteps(stepId);
  const currentStatus = useStepStatus(stepId);
  const stepNumber = STEPS.findIndex((candidate) => candidate.id === stepId) + 1;
  const stepCount = STEPS.length;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the title when the step opens, so screen readers announce the new page.
  // Each step is its own route, so this page mounts once per visit.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <PageContainer width={width}>
      <header className="flex flex-col gap-2 border-b border-border pb-6">
        <p className="text-sm font-medium text-text-muted">
          {t`Step ${stepNumber} of ${stepCount}`}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight text-text outline-none"
            >
              {step.title}
            </h1>
            {stepId === "review" ? null : step.required ? (
              <Badge tone="accent">
                {t({
                  message: "Required",
                  context: "step",
                  comment: "Marks a step a PMO file needs",
                })}
              </Badge>
            ) : (
              <Badge>
                {t({
                  message: "Optional",
                  context: "step",
                  comment: "Marks a step a PMO file can do without",
                })}
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {status ?? <StatusBadge status={currentStatus} />}
            {actions}
          </div>
        </div>
        <p className="max-w-prose text-md text-text-muted">{step.description}</p>
      </header>
      <div className="pt-8">{children}</div>
      <nav
        aria-label={t`Previous and next step`}
        className="mt-12 flex flex-wrap gap-3 border-t border-border pt-6"
      >
        <StepLink step={previous} direction="back" />
        {next ? <StepLink step={next} direction="next" /> : null}
      </nav>
    </PageContainer>
  );
}
