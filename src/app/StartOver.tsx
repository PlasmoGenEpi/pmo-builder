import { t } from "@lingui/core/macro";
import { RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";

import { Button, ConfirmDialog, useToast, type ButtonSize, type ButtonVariant } from "@/ui";

import { useStartOver } from "./draftHooks";

/** Props for {@link StartOverDialog}. */
export interface StartOverDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Called after the draft is removed, such as to close a menu. */
  readonly onDone?: (() => void) | undefined;
}

/**
 * Asks before removing the draft, then removes it and goes home. Every way of
 * starting over opens this, so each one says and does the same.
 */
export function StartOverDialog({ open, onOpenChange, onDone }: StartOverDialogProps) {
  const startOver = useStartOver();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t`Start over?`}
      description={t`This removes from this browser your tables, your column choices, everything you typed in, and any earlier draft that could not be opened. Saved panels are kept: delete them on the Panel step. This cannot be undone.`}
      confirmLabel={t`Start over`}
      tone="danger"
      onConfirm={async () => {
        try {
          await startOver();
          navigate("/");
          onDone?.();
          toast({ title: t`Your draft was removed`, tone: "success" });
        } catch (error) {
          console.error(error);
          toast({
            title: t`Your draft could not be removed`,
            description: t`Reload the page and try again.`,
            tone: "error",
          });
        }
      }}
    />
  );
}

/** Props for {@link StartOverButton}. */
export interface StartOverButtonProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string;
  readonly onDone?: () => void;
  /** Default: "Start over". */
  readonly children?: ReactNode;
}

/** A button that clears the draft for a new PMO, after asking. */
export function StartOverButton({
  variant = "secondary",
  size = "md",
  className,
  onDone,
  children,
}: StartOverButtonProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={RotateCcw}
        className={className}
        onClick={() => setConfirming(true)}
      >
        {children ?? t`Start over`}
      </Button>
      <StartOverDialog open={confirming} onOpenChange={setConfirming} onDone={onDone} />
    </>
  );
}
