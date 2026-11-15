import { t } from "@lingui/core/macro";

import { cn } from "./cn";

const sizes = {
  sm: "size-3.5 border-[1.5px]",
  md: "size-4 border-2",
  lg: "size-6 border-2",
} as const;

/** Props for {@link Spinner}. */
export interface SpinnerProps {
  size?: keyof typeof sizes;
  /** Announced to screen readers. Pass `null` when nearby text already says it is loading. */
  label?: string | null;
  className?: string;
}

/** A small loading indicator. Stops spinning when the user prefers reduced motion. */
export function Spinner({ size = "md", label = t`Loading`, className }: SpinnerProps) {
  return (
    <span
      role={label === null ? undefined : "status"}
      className={cn("inline-flex shrink-0 items-center", className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block animate-spin rounded-full border-current border-r-transparent opacity-80",
          sizes[size],
        )}
      />
      {label === null ? null : <span className="sr-only">{label}</span>}
    </span>
  );
}
