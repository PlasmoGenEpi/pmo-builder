import { ShieldCheck } from "lucide-react";
import { Suspense } from "react";

import { Button, Dialog, DialogClose, Skeleton } from "@/ui";

import { page } from "../steps";

/** The details load with their own code, the first time the dialog opens or the button is pointed at. */
const Details = page(() => import("./PrivacyDetails").then((module) => module.PrivacyDetails));

/** The privacy promise in the top bar. Opens a dialog with the details. */
export function PrivacyIndicator() {
  return (
    <Dialog
      title="Your data stays on this device"
      size="md"
      trigger={
        <Button
          size="sm"
          onPointerEnter={() => void Details.preload()}
          onFocus={() => void Details.preload()}
        >
          <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-success" />
          Your data stays on this device
        </Button>
      }
      footer={
        <DialogClose>
          <Button variant="primary">Got it</Button>
        </DialogClose>
      }
    >
      <Suspense
        fallback={
          <output className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
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
