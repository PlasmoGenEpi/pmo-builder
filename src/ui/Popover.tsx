import { Popover as RadixPopover } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

import { cn } from "./cn";

/** Width preset for a {@link Popover} panel. */
export type PopoverSize = "md" | "lg";
/** Padding preset for a {@link Popover} panel. */
export type PopoverPadding = "sm" | "md";

const sizeClasses: Record<PopoverSize, string> = {
  md: "w-72",
  lg: "w-96",
};

const paddingClasses: Record<PopoverPadding, string> = {
  sm: "p-3",
  md: "p-4",
};

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
  /** Panel width (`md` = 18 rem, `lg` = 24 rem). */
  size?: PopoverSize;
  /** Inner spacing (`md` = 1 rem, `sm` = 0.75 rem). */
  padding?: PopoverPadding;
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
  size = "md",
  padding = "md",
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
            "z-50 max-w-[calc(100vw-1rem)] animate-pop-in rounded-lg border border-border bg-surface-raised text-base text-text shadow-lg",
            sizeClasses[size],
            paddingClasses[padding],
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
