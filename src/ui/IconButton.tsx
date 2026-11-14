import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";

import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

const sizes = {
  sm: "size-control-sm [&>svg]:size-4",
  md: "size-control [&>svg]:size-4.5",
} as const;

const variants = {
  ghost: "text-text-muted hover:bg-surface-muted hover:text-text",
  secondary: "border border-border bg-surface text-text shadow-xs hover:bg-surface-subtle",
} as const;

/** Props for {@link IconButton}. */
export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> {
  /** What the button does. Used as its accessible name and shown as a tooltip. */
  label: string;
  icon: LucideIcon;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Set to false where a tooltip would get in the way, such as inside a tooltip. */
  showTooltip?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** A square button that shows only an icon. The label is required and shown on hover and focus. */
export function IconButton({
  label,
  icon: Icon,
  variant = "ghost",
  size = "md",
  showTooltip = true,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      {...rest}
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-100",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      <Icon aria-hidden="true" />
    </button>
  );
  if (!showTooltip) return button;
  return <Tooltip content={label}>{button}</Tooltip>;
}
