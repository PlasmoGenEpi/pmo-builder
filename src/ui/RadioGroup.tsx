import { RadioGroup as RadixRadioGroup } from "radix-ui";
import { useId, type ReactNode } from "react";

import { cn } from "./cn";

/** One choice in a {@link RadioGroup}. */
export interface RadioOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

/** Props for {@link RadioGroup}. */
export interface RadioGroupProps<V extends string = string> {
  /** The question the group answers, shown above the choices. */
  label: ReactNode;
  hint?: ReactNode;
  options: readonly RadioOption<V>[];
  value: V | undefined;
  onValueChange: (value: V) => void;
  orientation?: "vertical" | "horizontal";
  disabled?: boolean;
  className?: string;
}

/** A set of mutually exclusive choices, each with an optional description. */
export function RadioGroup<V extends string = string>({
  label,
  hint,
  options,
  value,
  onValueChange,
  orientation = "vertical",
  disabled,
  className,
}: RadioGroupProps<V>) {
  const id = useId();
  const labelId = `radio-${id}-label`;
  const hintId = `radio-${id}-hint`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-col gap-0.5">
        <span id={labelId} className="text-base font-medium text-text">
          {label}
        </span>
        {hint ? (
          <p id={hintId} className="text-sm text-text-muted">
            {hint}
          </p>
        ) : null}
      </div>
      <RadixRadioGroup.Root
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        value={value}
        onValueChange={(next) => {
          const match = options.find((option) => option.value === next);
          if (match) onValueChange(match.value);
        }}
        orientation={orientation}
        disabled={disabled}
        className={cn(
          "flex gap-2.5",
          orientation === "vertical" ? "flex-col" : "flex-row flex-wrap gap-x-6",
        )}
      >
        {options.map((option) => {
          const itemId = `radio-${id}-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-2.5">
              <RadixRadioGroup.Item
                id={itemId}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-strong bg-surface shadow-xs",
                  "data-[state=checked]:border-accent disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <RadixRadioGroup.Indicator className="block size-2 rounded-full bg-accent" />
              </RadixRadioGroup.Item>
              <div className="flex min-w-0 flex-col">
                <label htmlFor={itemId} className="cursor-pointer text-base text-text">
                  {option.label}
                </label>
                {option.description ? (
                  <p className="text-sm text-text-muted">{option.description}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </RadixRadioGroup.Root>
    </div>
  );
}
