import { House } from "lucide-react";
import { Link as RouterLink, useLocation } from "wouter";

import { StatusIcon, cn } from "@/ui";

import { stepsByGroup } from "./steps";
import { useStepStatuses } from "./stepStatus";

const itemClass =
  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-base transition-colors duration-100";

/** The list of steps in the sidebar and the mobile menu, grouped as in the registry. */
export function StepNav({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const statuses = useStepStatuses();
  const groups = stepsByGroup();

  return (
    <nav aria-label="Steps" className="flex flex-col gap-5">
      <RouterLink
        href="/"
        onClick={onNavigate}
        aria-current={location === "/" ? "page" : undefined}
        className={cn(
          itemClass,
          location === "/"
            ? "bg-surface-muted font-medium text-text"
            : "text-text-muted hover:bg-surface-muted hover:text-text",
        )}
      >
        <House aria-hidden="true" className="size-4 shrink-0" />
        Home
      </RouterLink>
      {groups.map(({ group, steps }) => (
        <div key={group} className="flex flex-col gap-0.5">
          <h2 className="px-2.5 pb-1 text-xs font-medium text-text-subtle">{group}</h2>
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
                    {step.required ? (
                      <span className="shrink-0 text-xs font-normal text-text-subtle">
                        Required
                      </span>
                    ) : null}
                  </RouterLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
