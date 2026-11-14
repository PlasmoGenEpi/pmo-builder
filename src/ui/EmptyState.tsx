import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  /** What this area will show and how to fill it. */
  description?: ReactNode;
  /** Usually one primary button. */
  action?: ReactNode;
  className?: string;
}

/** What to show where content will appear once the user adds something. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-muted text-text-muted">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-md font-semibold text-text">{title}</p>
        {description ? <p className="text-base text-text-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
