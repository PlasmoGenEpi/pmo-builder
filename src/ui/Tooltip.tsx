import { Tooltip as RadixTooltip } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

/** Props for {@link Tooltip}. */
export interface TooltipProps {
  /** Short text shown on hover and keyboard focus. Not a place for essential information. */
  content: ReactNode;
  /** One focusable element, such as a button. */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  /** Milliseconds before it opens on hover. */
  delay?: number;
}

/** A small label that appears next to a control on hover and focus. */
export function Tooltip({ content, children, side = "top", delay = 400 }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delay} skipDelayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-50 max-w-xs animate-fade-in rounded-md bg-text px-2 py-1 text-xs font-medium text-surface shadow-md"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
