import { Suspense, lazy, useState } from "react";

import { Disclosure } from "@/ui";

import { PreviewSkeleton } from "./PreviewSkeleton";

const PmoPreviewBody = lazy(() =>
  import("./PmoPreviewBody").then((module) => ({ default: module.PmoPreviewBody })),
);

/**
 * The PMO as JSON, behind a disclosure. The text, and the code that shows
 * it, are fetched only when it is opened.
 */
export function PmoPreview() {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure title="Preview the PMO" summary="JSON" open={open} onOpenChange={setOpen}>
      {open ? (
        <Suspense fallback={<PreviewSkeleton />}>
          <PmoPreviewBody />
        </Suspense>
      ) : null}
    </Disclosure>
  );
}
