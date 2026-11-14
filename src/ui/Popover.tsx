import { Popover as RadixPopover } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

import { cn } from "./cn";

/** Props for {@link Popover}. */
export interface PopoverProps {
  /** The button that opens the popover. */
  trigger: ReactElement;
  /** Content of the panel. Give it a heading or `aria-label` when it is not obvious. */
  children: ReactNode;
  /** Accessible name of the panel. */
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}

/** A small non-modal panel anchored to a button, for extra detail or quick settings. */
export function Popover({
  trigger,
  children,
  label,
  open,
  onOpenChange,
  side = "bottom",
  align = "center",
  className,
}: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-label={label}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-50 w-72 max-w-[calc(100vw-1rem)] animate-pop-in rounded-lg border border-border bg-surface-raised p-4 text-base text-text shadow-lg",
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
