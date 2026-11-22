import type { ReactNode } from "react";

import { cn } from "./cn";
import { formatCount } from "./format";

/** Props for {@link Stat}. */
export interface StatProps {
  /** Numbers get thousands separators. */
  value: number | string;
  label: ReactNode;
  /** A short line under the label, such as "3 with warnings". */
  hint?: ReactNode;
  /** Makes the stat a clickable tile button when provided. */
  onClick?: () => void;
  className?: string;
}

/** A large number with a label, such as a count of samples or targets. */
export function Stat({ value, label, hint, onClick, className }: StatProps) {
  const content = (
    <>
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-2xl font-semibold tracking-tight text-text tabular-nums">
        {typeof value === "number" ? formatCount(value) : value}
      </span>
      {hint ? <span className="text-sm text-text-subtle">{hint}</span> : null}
    </>
  );

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full min-w-0 cursor-pointer flex-col items-start justify-start gap-0.5 rounded-lg border border-border bg-surface p-3 text-left shadow-xs transition-colors duration-100 hover:border-border-strong hover:bg-surface-subtle active:bg-surface-muted",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return <div className={cn("flex flex-col gap-0.5", className)}>{content}</div>;
}
