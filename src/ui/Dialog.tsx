import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

import { cn } from "./cn";
import { IconButton } from "./IconButton";

const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" } as const;

/** Props for {@link Dialog}. */
export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** An element that opens the dialog, such as a button. Optional when `open` is controlled. */
  trigger?: ReactElement;
  title: ReactNode;
  /** One sentence under the title. Read out when the dialog opens. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons at the bottom, primary last. */
  footer?: ReactNode;
  size?: keyof typeof widths;
}

/**
 * A modal window for a focused task or for details. Focus is trapped inside,
 * Escape closes it, and focus returns to the trigger.
 */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = "md",
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <RadixDialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "animate-pop-in rounded-xl border border-border bg-surface-raised shadow-lg",
            widths[size],
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-1">
            <div className="flex flex-col gap-1">
              <RadixDialog.Title className="text-lg font-semibold tracking-tight text-text">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="text-base text-text-muted">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close" icon={X} size="sm" showTooltip={false} className="-mr-2" />
            </RadixDialog.Close>
          </div>
          {children ? (
            <div className="min-h-0 overflow-y-auto px-6 py-4 text-base text-text">{children}</div>
          ) : null}
          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
              {footer}
            </div>
          ) : (
            <div className="pb-2" />
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Closes the surrounding `Dialog` when its child is clicked. Wrap a button in it. */
export function DialogClose({ children }: { children: ReactElement }) {
  return <RadixDialog.Close asChild>{children}</RadixDialog.Close>;
}
