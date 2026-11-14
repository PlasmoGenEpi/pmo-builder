import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

/** Colour family of a {@link Badge}. Always pair it with words; colour alone carries no meaning. */
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-subtle text-text-muted",
  accent: "border-transparent bg-accent-subtle text-accent-text",
  success: "border-transparent bg-success-subtle text-success-text",
  warning: "border-transparent bg-warning-subtle text-warning-text",
  danger: "border-transparent bg-danger-subtle text-danger-text",
  info: "border-transparent bg-info-subtle text-info-text",
};

/** Props for {@link Badge}. */
export interface BadgeProps {
  tone?: BadgeTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

/** A short label such as "Required", "Optional" or a count. */
export function Badge({ tone = "neutral", icon: Icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
      {children}
    </span>
  );
}
