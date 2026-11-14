import { Progress } from "radix-ui";
import { useId, type ReactNode } from "react";

import { cn } from "./cn";

/** Props for {@link ProgressBar}. */
export interface ProgressBarProps {
  /** What is in progress, such as "Reading allele table". */
  label: ReactNode;
  /** Done so far, or `null` when the amount is unknown. */
  value: number | null;
  max?: number;
  /** Show the percentage at the end of the label row. */
  showValue?: boolean;
  className?: string;
}

/** A horizontal bar showing how far a task has got. */
export function ProgressBar({
  label,
  value,
  max = 100,
  showValue = true,
  className,
}: ProgressBarProps) {
  const labelId = useId();
  const percent =
    value === null ? null : Math.round((Math.min(Math.max(value, 0), max) / max) * 100);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span id={labelId} className="text-text">
          {label}
        </span>
        {showValue && percent !== null ? (
          <span className="text-text-muted tabular-nums">{percent}%</span>
        ) : null}
      </div>
      <Progress.Root
        aria-labelledby={labelId}
        value={value}
        max={max}
        getValueLabel={(current, total) => `${Math.round((current / total) * 100)}%`}
        className="relative h-1.5 overflow-hidden rounded-full bg-surface-muted"
      >
        <Progress.Indicator
          className={cn(
            "h-full rounded-full bg-accent transition-[width] duration-200",
            percent === null && "w-1/3 animate-progress",
          )}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </Progress.Root>
    </div>
  );
}
