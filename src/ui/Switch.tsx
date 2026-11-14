import { Switch as RadixSwitch } from "radix-ui";
import { useId, type ReactNode } from "react";

import { cn } from "./cn";

/** Props for {@link Switch}. */
export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** An on and off setting that takes effect at once. For choices in a form, use `Checkbox`. */
export function Switch({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
}: SwitchProps) {
  const generated = useId();
  const controlId = id ?? `switch-${generated}`;
  const descriptionId = `${controlId}-description`;
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col">
        <label htmlFor={controlId} className="cursor-pointer text-base text-text">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-sm text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <RadixSwitch.Root
        id={controlId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-surface-muted transition-colors duration-150",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <RadixSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-text-muted shadow-xs transition-transform duration-150 data-[state=checked]:translate-x-[1.125rem] data-[state=checked]:bg-accent-fg" />
      </RadixSwitch.Root>
    </div>
  );
}
