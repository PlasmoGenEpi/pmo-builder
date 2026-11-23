import { t } from "@lingui/core/macro";
import { Check, ChevronDown } from "lucide-react";
import { Select as RadixSelect } from "radix-ui";

import { cn } from "./cn";
import { inputClassName, useFieldControl } from "./Field";

/** One choice in a {@link Select}. */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Height and text size of a {@link Select}. */
export type SelectSize = "sm" | "md";

/** Props for {@link Select}. */
export interface SelectProps {
  options: readonly SelectOption[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  placeholder?: string;
  size?: SelectSize;
  disabled?: boolean;
  /** Wires a visible `<label htmlFor={id}>` when the select is not inside a `Field`. */
  id?: string;
  /** Needed when the select is not inside a `Field` and has no visible `<label>`. */
  "aria-label"?: string;
  className?: string;
}

/**
 * A drop-down for short lists (up to about 15 options). Put it inside a
 * `Field` for its label. For long or searchable lists use `Combobox`.
 */
export function Select({
  options,
  value,
  onValueChange,
  placeholder = t`Choose`,
  size = "md",
  disabled,
  id,
  className,
  ...aria
}: SelectProps) {
  const control = useFieldControl();
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        {...control}
        id={id ?? control?.id}
        aria-label={aria["aria-label"]}
        className={cn(
          inputClassName,
          "inline-flex cursor-pointer items-center justify-between gap-2 text-left data-placeholder:text-text-subtle",
          size === "sm" ? "h-control-sm text-sm" : "h-control text-base",
          className,
        )}
      >
        <span className="truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon>
          <ChevronDown aria-hidden="true" className="size-4 text-text-muted" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) animate-pop-in overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex cursor-pointer items-center rounded-md py-1.5 pr-8 pl-2.5 text-base text-text outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-surface-muted"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2 inline-flex">
                  <Check aria-hidden="true" className="size-4 text-accent-text" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
