import { House, LibraryBig } from "lucide-react";
import { Link as RouterLink, useLocation } from "wouter";

import { zenodoConfig } from "@/features/review/zenodo";
import { StatusIcon, cn } from "@/ui";

import { useHasSavedDraft } from "./draftHooks";
import { StartOverButton } from "./StartOver";
import { stepsByGroup } from "./steps";
import { useStepStatuses } from "./stepStatus";

const itemClass =
  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-base transition-colors duration-100";

/** The list of steps in the sidebar and the mobile menu, grouped as in the registry. */
export function StepNav({
  onNavigate,
  showPublished = zenodoConfig() !== null,
}: {
  onNavigate?: () => void;
  /** Whether to link to the published PMOs. Default: when a Zenodo community is set. */
  showPublished?: boolean;
}) {
  const [location] = useLocation();
  const onPublished = location === "/published" || location.startsWith("/published/");
  const statuses = useStepStatuses();
  const groups = stepsByGroup();
  const hasDraft = useHasSavedDraft();

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
      {showPublished ? (
        <RouterLink
          href="/published"
          onClick={onNavigate}
          aria-current={onPublished ? "page" : undefined}
          className={cn(
            itemClass,
            "-mt-4",
            onPublished
              ? "bg-surface-muted font-medium text-text"
              : "text-text-muted hover:bg-surface-muted hover:text-text",
          )}
        >
          <LibraryBig aria-hidden="true" className="size-4 shrink-0" />
          Published PMOs
        </RouterLink>
      ) : null}
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
      {hasDraft ? (
        <div className="border-t border-border pt-4">
          <StartOverButton
            variant="ghost"
            className="w-full justify-start gap-2.5 px-2.5"
            onDone={onNavigate}
          />
          <p className="px-2.5 pt-1 text-xs text-text-subtle">Clears this draft for a new PMO.</p>
        </div>
      ) : null}
    </nav>
  );
}
