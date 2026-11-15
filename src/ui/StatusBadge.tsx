import { t } from "@lingui/core/macro";
import { CircleCheck, CircleDashed, CircleDot, CircleX, type LucideIcon } from "lucide-react";

import type { SectionStatus } from "@/domain/types";

import { Badge, type BadgeTone } from "./Badge";
import { cn } from "./cn";

interface StatusMeta {
  label: string;
  icon: LucideIcon;
  tone: BadgeTone;
  /** Colour class for the icon on its own. */
  iconClass: string;
}

/** Words, icon and tone for each section status. Shared by the badge and the sidebar. */
export const STATUS_META: Readonly<Record<SectionStatus, StatusMeta>> = {
  empty: {
    label: t({ message: "Not started", comment: "Status of a step" }),
    icon: CircleDashed,
    tone: "neutral",
    iconClass: "text-text-subtle",
  },
  incomplete: {
    label: t({ message: "Incomplete", comment: "Status of a step" }),
    icon: CircleDot,
    tone: "warning",
    iconClass: "text-warning",
  },
  ready: {
    label: t({ message: "Ready", context: "step status", comment: "Status of a step" }),
    icon: CircleCheck,
    tone: "success",
    iconClass: "text-success",
  },
  error: {
    label: t({ message: "Has errors", comment: "Status of a step" }),
    icon: CircleX,
    tone: "danger",
    iconClass: "text-danger",
  },
};

/** Props for {@link StatusBadge}. */
export interface StatusBadgeProps {
  status: SectionStatus;
  className?: string;
}

/** Shows where a section stands, with an icon and words, never colour alone. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} icon={meta.icon} className={className}>
      {meta.label}
    </Badge>
  );
}

/** Props for {@link StatusIcon}. */
export interface StatusIconProps {
  status: SectionStatus;
  className?: string;
}

/**
 * The status icon alone, for tight spaces such as the sidebar. The status is
 * still announced to screen readers.
 */
export function StatusIcon({ status, className }: StatusIconProps) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex shrink-0", className)}>
      <Icon aria-hidden="true" className={cn("size-4", meta.iconClass)} />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}
