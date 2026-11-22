import { CircleExclamationPoint } from "lucide-react";
import type { ReactNode } from "react";

import { cn, type FileDropHandlers } from "@/ui";

/** Props for {@link PmoHeaderBar}. */
export interface PmoHeaderBarProps {
  /** Leading icon, such as a file icon. */
  readonly icon?: ReactNode;
  /** The open PMO's file name or title, rendered as the page's `h1`. */
  readonly title: ReactNode;
  /** Tooltip for a truncated title, such as a long file name. */
  readonly titleTooltip?: string;
  /** Renders the title in monospace (for file names). */
  readonly monoTitle?: boolean;
  /** Short metadata beside the title, such as the file size. */
  readonly meta?: ReactNode;
  /** Optional second line under the title, such as a published PMO's authors. */
  readonly subtitle?: ReactNode;
  /** Controls or links on the right side of the bar. */
  readonly actions?: ReactNode;
  /** Visual state of the bar border and background. */
  readonly tone?: "default" | "dragging" | "error";
  /** Optional drag-and-drop handlers for dropping a replacement file onto the bar. */
  readonly dragHandlers?: FileDropHandlers;
  /** Error message shown under the bar and announced as an alert. */
  readonly error?: string | null;
  /** Hidden elements that belong with the bar, such as a file input. */
  readonly children?: ReactNode;
  readonly className?: string;
}

const TONE_CLASSES: Record<NonNullable<PmoHeaderBarProps["tone"]>, string> = {
  default: "border-border bg-surface",
  dragging: "border-accent bg-accent-subtle",
  error: "border-danger bg-surface",
};

/**
 * The slim header bar at the top of an open PMO view. Shared between My PMO
 * file (working PMO) and the read-only published PMO view so the tabs and
 * data start on the first screen.
 */
export function PmoHeaderBar({
  icon,
  title,
  titleTooltip,
  monoTitle = false,
  meta,
  subtitle,
  actions,
  tone = "default",
  dragHandlers,
  error,
  children,
  className,
}: PmoHeaderBarProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <header
        {...dragHandlers}
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border px-3 py-2 transition-colors",
          TONE_CLASSES[tone],
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {icon ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-text">
              {icon}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-baseline gap-x-2.5">
              <h1
                className={cn(
                  "min-w-0 truncate text-text",
                  monoTitle ? "font-mono text-sm font-medium" : "text-base font-semibold",
                )}
                title={titleTooltip}
              >
                {title}
              </h1>
              {meta ? (
                <span className="shrink-0 text-sm text-text-muted tabular-nums">{meta}</span>
              ) : null}
            </div>
            {subtitle ? <p className="truncate text-sm text-text-muted">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        {children}
      </header>
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
          <CircleExclamationPoint aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
