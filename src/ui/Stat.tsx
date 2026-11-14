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
  className?: string;
}

/** A large number with a label, such as a count of samples or targets. */
export function Stat({ value, label, hint, className }: StatProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-2xl font-semibold tracking-tight text-text tabular-nums">
        {typeof value === "number" ? formatCount(value) : value}
      </span>
      {hint ? <span className="text-sm text-text-subtle">{hint}</span> : null}
    </div>
  );
}
