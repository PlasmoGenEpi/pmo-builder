import { plural, t } from "@lingui/core/macro";
import { Link as RouterLink, useLocation } from "wouter";

import { StatusIcon, cn } from "@/ui";

import { useHasSavedDraft } from "./draftHooks";
import { StartOverButton } from "./StartOver";
import { STEP_GROUP_LABELS, STEPS, stepsByGroup } from "./steps";
import { useStepStatuses } from "./stepStatus";

const itemClass =
  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-base transition-colors duration-100";

/** The steps of the Build section, in the sidebar and the narrow-screen drawer. */
export function StepNav({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const statuses = useStepStatuses();
  const groups = stepsByGroup();
  const hasDraft = useHasSavedDraft();
  const required = STEPS.filter((step) => step.required);
  const readyCount = required.filter((step) => statuses[step.id] === "ready").length;
  const requiredCount = required.length;

  return (
    <nav
      aria-label={t({ message: "Steps", comment: "Name of the sidebar navigation" })}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-0.5 px-2.5">
        <p className="text-md font-semibold text-text">{t`Build a PMO`}</p>
        <p className="text-sm text-text-muted">
          {plural(requiredCount, {
            one: `${readyCount} of # required step ready`,
            other: `${readyCount} of # required steps ready`,
          })}
        </p>
      </div>
      {groups.map(({ group, steps }) => (
        <div key={group} className="flex flex-col gap-0.5">
          <h2 className="px-2.5 pb-1 text-xs font-medium text-text-subtle">
            {STEP_GROUP_LABELS[group]}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {steps.map((step) => {
              const active = location === step.path;
              return (
                <li key={step.id}>
                  <RouterLink
                    href={step.path}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      itemClass,
                      active
                        ? "bg-surface-muted font-medium text-text"
                        : "text-text-muted hover:bg-surface-muted hover:text-text",
                    )}
                  >
                    <StatusIcon status={statuses[step.id]} />
                    <span className="min-w-0 flex-1 truncate">{step.title}</span>
                  </RouterLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {hasDraft ? (
        <div className="border-t border-border pt-4">
          <StartOverButton
            variant="ghost"
            className="w-full justify-start gap-2.5 px-2.5"
            onDone={onNavigate}
          />
          <p className="px-2.5 pt-1 text-xs text-text-subtle">
            {t`Clears this draft for a new PMO.`}
          </p>
        </div>
      ) : null}
    </nav>
  );
}
