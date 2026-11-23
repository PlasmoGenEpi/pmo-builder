import type { LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";

import { cn } from "./cn";

/** One segment of a {@link SegmentedControl}. */
export interface Segment<V extends string = string> {
  value: V;
  label: string;
  icon?: LucideIcon;
  /** Hide the text and show only the icon. The label stays as the accessible name. */
  iconOnly?: boolean;
}

/** Props for {@link SegmentedControl}. */
export interface SegmentedControlProps<V extends string = string> {
  /** Accessible name of the whole control. */
  label: string;
  segments: readonly Segment<V>[];
  value: V;
  onValueChange: (value: V) => void;
  size?: "sm" | "md";
  className?: string;
}

/** Two to five mutually exclusive views or modes shown side by side. One is always chosen. */
export function SegmentedControl<V extends string = string>({
  label,
  segments,
  value,
  onValueChange,
  size = "md",
  className,
}: SegmentedControlProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        // Radix sends "" when the chosen segment is pressed again. Keep the choice.
        const match = segments.find((segment) => segment.value === next);
        if (match) onValueChange(match.value);
      }}
      className={cn(
        "inline-flex w-fit items-center gap-0.5 rounded-lg border border-border bg-surface-subtle p-0.5",
        className,
      )}
    >
      {segments.map(({ value: segmentValue, label: segmentLabel, icon: Icon, iconOnly }) => (
        <ToggleGroup.Item
          key={segmentValue}
          value={segmentValue}
          aria-label={iconOnly ? segmentLabel : undefined}
          className={cn(
            "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent font-medium text-text-muted transition-colors duration-100 hover:text-text",
            "data-[state=on]:border-accent data-[state=on]:bg-accent-subtle data-[state=on]:font-semibold data-[state=on]:text-accent-text data-[state=on]:shadow-xs",
            size === "sm" ? "h-6 px-2 text-sm" : "h-7.5 px-3 text-base",
          )}
        >
          {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
          {iconOnly ? null : segmentLabel}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
