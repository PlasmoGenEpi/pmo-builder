import { t } from "@lingui/core/macro";
import { CircleCheck, CircleExclamationPoint, Info, TriangleExclamationPoint } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

/** Kind of message in a {@link Callout}. */
export type CalloutTone = "info" | "success" | "warning" | "error";

const tones: Record<CalloutTone, { box: string; icon: string; Icon: typeof Info; label: string }> =
  {
    info: {
      box: "border-info/30 bg-info-subtle",
      icon: "text-info",
      Icon: Info,
      label: t({ message: "Note", comment: "Read out before an information message" }),
    },
    success: {
      box: "border-success/30 bg-success-subtle",
      icon: "text-success",
      Icon: CircleCheck,
      label: t({ message: "Done", comment: "Read out before a success message" }),
    },
    warning: {
      box: "border-warning/30 bg-warning-subtle",
      icon: "text-warning",
      Icon: TriangleExclamationPoint,
      label: t({ message: "Warning", comment: "Read out before a warning message" }),
    },
    error: {
      box: "border-danger/30 bg-danger-subtle",
      icon: "text-danger",
      Icon: CircleExclamationPoint,
      label: t({ message: "Error", comment: "Read out before an error message" }),
    },
  };

/** Props for {@link Callout}. */
export interface CalloutProps {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  /** A button or link that fixes or follows up on the message. */
  action?: ReactNode;
  /**
   * Announce the message when it appears. Use for messages caused by the
   * user's last action, not for ones present when the page loads.
   */
  live?: boolean;
  className?: string;
}

/** A message in the flow of the page: a note, a success, a warning or an error. */
export function Callout({ tone = "info", title, children, action, live, className }: CalloutProps) {
  const style = tones[tone];
  const Icon = style.Icon;
  const toneLabel = style.label;
  const prefix = t({
    message: `${toneLabel}:`,
    comment: "Read out before a message, such as Warning:",
  });
  const role = live ? (tone === "error" ? "alert" : "status") : undefined;
  return (
    <div role={role} className={cn("flex gap-3 rounded-lg border p-4", style.box, className)}>
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4.5 shrink-0", style.icon)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? (
          <p className="text-base font-semibold text-text">
            <span className="sr-only">{prefix} </span>
            {title}
          </p>
        ) : (
          <span className="sr-only">{prefix} </span>
        )}
        {children ? <div className="text-base text-text">{children}</div> : null}
        {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
