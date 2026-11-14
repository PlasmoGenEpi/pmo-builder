import { AlertDialog } from "radix-ui";
import { useState, type ReactElement, type ReactNode } from "react";

import { Button } from "./Button";
import { cn } from "./cn";

/** Props for {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** An element that opens the dialog. Optional when `open` is controlled. */
  trigger?: ReactElement;
  /** A question, such as "Start over?". */
  title: ReactNode;
  /** What will happen, and whether it can be undone. */
  description: ReactNode;
  /** The verb for the action, such as "Delete table". Never "OK" or "Yes". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for actions that delete or discard work. */
  tone?: "default" | "danger";
  /** May return a promise; the dialog shows a spinner and closes when it settles. */
  onConfirm: () => void | Promise<void>;
}

/**
 * Asks the user to confirm an action before it happens. Focus starts on
 * Cancel, so pressing Enter by reflex never destroys work.
 */
export function ConfirmDialog({
  open: openProp,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
}: ConfirmDialogProps) {
  const [openState, setOpenState] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = openProp ?? openState;

  function setOpen(next: boolean) {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  }

  async function confirm() {
    const result = onConfirm();
    if (result instanceof Promise) {
      setBusy(true);
      try {
        await result;
      } finally {
        setBusy(false);
      }
    }
    setOpen(false);
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => (busy ? undefined : setOpen(next))}>
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <AlertDialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-5",
            "animate-pop-in rounded-xl border border-border bg-surface-raised p-6 shadow-lg",
          )}
        >
          <div className="flex flex-col gap-2">
            <AlertDialog.Title className="text-lg font-semibold tracking-tight text-text">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-base text-text-muted">
              {description}
            </AlertDialog.Description>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button disabled={busy}>{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              loading={busy}
              onClick={() => {
                void confirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
