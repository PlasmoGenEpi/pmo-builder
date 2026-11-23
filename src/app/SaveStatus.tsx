import { t } from "@lingui/core/macro";
import { HardDrive, LoaderCircle, TriangleExclamationPoint, type LucideIcon } from "lucide-react";

import { Button, Popover, cn } from "@/ui";

import { useSaveState } from "./draftHooks";

interface SaveStatusView {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly warning: boolean;
  readonly heading: string;
  readonly detail: string;
}

function describe(state: ReturnType<typeof useSaveState>): SaveStatusView {
  switch (state.kind) {
    case "restoring":
      return {
        label: t`Opening your draft`,
        icon: LoaderCircle,
        warning: false,
        heading: t`Opening your draft`,
        detail: t`Your saved work is being read from this browser.`,
      };
    case "saved":
    case "unsaved":
      return {
        label: t`Draft saved`,
        icon: HardDrive,
        warning: false,
        heading: t`Saved on this device`,
        detail: t`Your tables, column choices and everything you type are saved in this browser as you go. Come back later and carry on where you left off.`,
      };
    case "session-only": {
      const reason = state.reason;
      return {
        label: t`Not kept after you close this tab`,
        icon: TriangleExclamationPoint,
        warning: true,
        heading: t`This browser is not keeping your work`,
        detail: t`${reason} Download your PMO file before you close the tab.`,
      };
    }
    case "failed": {
      const reason = state.reason;
      return {
        label: t`Not saved`,
        icon: TriangleExclamationPoint,
        warning: true,
        heading: t`Your latest changes were not saved`,
        detail: t`${reason} Your work is still here while this tab stays open.`,
      };
    }
    case "other-tab":
      return {
        label: t`Open in another tab`,
        icon: TriangleExclamationPoint,
        warning: true,
        heading: t`This draft is open in another tab`,
        detail: t`Changes you make here are not saved, so the two tabs do not overwrite each other. Use this tab instead to carry on here.`,
      };
    default:
      return state;
  }
}

/** Whether the draft is being kept in this browser, in the top bar. Opens a short explanation. */
export function SaveStatus() {
  const view = describe(useSaveState());
  const Icon = view.icon;
  return (
    <Popover
      label={view.heading}
      align="end"
      trigger={
        <Button variant="ghost" size="sm" className="min-w-0 shrink! rounded-full">
          <Icon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              view.warning && "text-warning",
              view.icon === LoaderCircle && "motion-safe:animate-spin",
            )}
          />
          <span
            className={cn(
              "truncate",
              view.warning ? "text-warning-text max-sm:sr-only" : "max-lg:sr-only",
            )}
          >
            {view.label}
          </span>
        </Button>
      }
    >
      <div className="flex flex-col gap-1.5">
        <p className="font-semibold text-text">{view.heading}</p>
        <p className="text-sm text-text-muted">{view.detail}</p>
      </div>
    </Popover>
  );
}
