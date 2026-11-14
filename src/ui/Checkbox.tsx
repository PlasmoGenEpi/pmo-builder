import { Check, Minus } from "lucide-react";
import { Checkbox as RadixCheckbox } from "radix-ui";
import { useId, type ReactNode } from "react";

import { cn } from "./cn";

/** Props for {@link Checkbox}. */
export interface CheckboxProps {
  label: ReactNode;
  /** One short line under the label. */
  description?: ReactNode;
  /** `"indeterminate"` shows a dash, for "some of these are selected". */
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** A checkbox with a clickable label. */
export function Checkbox({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
}: CheckboxProps) {
  const generated = useId();
  const controlId = id ?? `checkbox-${generated}`;
  const descriptionId = `${controlId}-description`;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <RadixCheckbox.Root
        id={controlId}
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className={cn(
          "mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-surface shadow-xs",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg",
          "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-fg",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <RadixCheckbox.Indicator>
          {checked === "indeterminate" ? (
            <Minus aria-hidden="true" className="size-3" strokeWidth={3} />
          ) : (
            <Check aria-hidden="true" className="size-3" strokeWidth={3} />
          )}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <div className="flex min-w-0 flex-col">
        <label
          htmlFor={controlId}
          className={cn(
            "cursor-pointer text-base text-text",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-sm text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
