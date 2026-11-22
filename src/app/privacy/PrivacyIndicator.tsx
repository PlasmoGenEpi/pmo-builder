import { t } from "@lingui/core/macro";
import { ShieldCheck } from "lucide-react";
import { Suspense, type ReactElement } from "react";

import { Button, Dialog, DialogClose, Skeleton } from "@/ui";

import { page } from "../steps";

/** The details load with their own code, the first time the dialog opens or the button is pointed at. */
const Details = page(() => import("./PrivacyDetails").then((module) => module.PrivacyDetails));

/** Loads the dialog's details ahead of time. */
export function preloadPrivacyDetails(): void {
  void Details.preload();
}

/** Props for {@link PrivacyDialog}. */
export interface PrivacyDialogProps {
  readonly trigger?: ReactElement;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** What stays on this device, what the browser keeps, and the usage counts, with their switch. */
export function PrivacyDialog({ trigger, open, onOpenChange }: PrivacyDialogProps) {
  return (
    <Dialog
      title={t`Your data stays on this device`}
      size="md"
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      footer={
        <DialogClose>
          <Button variant="primary">{t`Got it`}</Button>
        </DialogClose>
      }
    >
      <Suspense
        fallback={
          <output className="flex flex-col gap-3" aria-busy="true" aria-label={t`Loading`}>
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </output>
        }
      >
        <Details.component />
      </Suspense>
    </Dialog>
  );
}

/** The privacy promise in the top bar. Opens a dialog with the details. */
export function PrivacyIndicator() {
  return (
    <PrivacyDialog
      trigger={
        <Button size="sm" onPointerEnter={preloadPrivacyDetails} onFocus={preloadPrivacyDetails}>
          <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-success" />
          {/* On narrow screens the shield alone fits the top bar; screen readers still hear the words. */}
          <span className="max-lg:sr-only">{t`Your data stays on this device`}</span>
        </Button>
      }
    />
  );
}
