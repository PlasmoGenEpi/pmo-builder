import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactElement } from "react";

import { cn } from "./cn";

/** One entry of a {@link Menu}. */
export type MenuEntry =
  | {
      kind: "item";
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      /** Shows the entry in the danger colour, for destructive actions. */
      danger?: boolean;
      disabled?: boolean;
    }
  | {
      kind: "radio";
      /** Heading for the group, read by screen readers and shown above it. */
      label: string;
      value: string;
      options: readonly { value: string; label: string; icon?: LucideIcon }[];
      onValueChange: (value: string) => void;
    }
  | { kind: "separator" };

/** Props for {@link Menu}. */
export interface MenuProps {
  /** The button that opens the menu, usually an `IconButton`. */
  trigger: ReactElement;
  entries: readonly MenuEntry[];
  align?: "start" | "end";
}

const itemClass =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-base outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-surface-muted";

/** A drop-down list of actions, such as the overflow menu in the top bar. */
export function Menu({ trigger, entries, align = "end" }: MenuProps) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 min-w-52 animate-pop-in rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
        >
          {entries.map((entry, index) => {
            const key = `${entry.kind}-${index}`;
            if (entry.kind === "separator") {
              return <DropdownMenu.Separator key={key} className="my-1 h-px bg-border" />;
            }
            if (entry.kind === "item") {
              const Icon = entry.icon;
              return (
                <DropdownMenu.Item
                  key={key}
                  disabled={entry.disabled}
                  onSelect={entry.onSelect}
                  className={cn(itemClass, entry.danger ? "text-danger-text" : "text-text")}
                >
                  {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
                  {entry.label}
                </DropdownMenu.Item>
              );
            }
            return (
              <DropdownMenu.Group key={key}>
                <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-text-subtle">
                  {entry.label}
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={entry.value} onValueChange={entry.onValueChange}>
                  {entry.options.map((option) => {
                    const Icon = option.icon;
                    return (
                      <DropdownMenu.RadioItem
                        key={option.value}
                        value={option.value}
                        className={cn(itemClass, "text-text")}
                      >
                        {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
                        <span className="flex-1">{option.label}</span>
                        <DropdownMenu.ItemIndicator>
                          <Check aria-hidden="true" className="size-4 text-accent-text" />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    );
                  })}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Group>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
