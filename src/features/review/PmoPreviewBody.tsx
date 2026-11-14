import { usePmoPreview } from "@/state";
import { CodeBlock, formatBytes } from "@/ui";

import { PreviewSkeleton } from "./PreviewSkeleton";

/** Characters fetched for the preview. The download always has the whole file. */
const PREVIEW_LENGTH = 400_000;

/** The start of the PMO as JSON. Loaded with its own code when the preview is first opened. */
export function PmoPreviewBody() {
  const preview = usePmoPreview(PREVIEW_LENGTH);
  if (preview === null) return <PreviewSkeleton />;
  return (
    <div className="flex flex-col gap-2">
      {preview.truncated ? (
        <p className="text-sm text-text-muted">
          The file is {formatBytes(preview.length)}. The first {formatBytes(preview.text.length)}{" "}
          are shown here; the download has all of it.
        </p>
      ) : null}
      <CodeBlock label="PMO preview" code={preview.text} />
    </div>
  );
}
