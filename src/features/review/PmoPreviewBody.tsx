import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

import { usePmoPreview } from "@/state";
import { CodeBlock, formatBytes } from "@/ui";

import { PreviewSkeleton } from "./PreviewSkeleton";

/** Characters fetched for the preview. The download always has the whole file. */
const PREVIEW_LENGTH = 400_000;

/** The start of the PMO as JSON. Loaded with its own code when the preview is first opened. */
export function PmoPreviewBody() {
  const preview = usePmoPreview(PREVIEW_LENGTH);
  if (preview === null) return <PreviewSkeleton />;
  const fileSize = preview.length === null ? null : formatBytes(preview.length);
  const shownSize = formatBytes(preview.text.length);
  return (
    <div className="flex flex-col gap-2">
      {preview.truncated ? (
        <p className="text-sm text-text-muted">
          {fileSize === null ? (
            <Trans>The first {shownSize} are shown here; the download has all of it.</Trans>
          ) : (
            <Trans>
              The file is {fileSize}. The first {shownSize} are shown here; the download has all of
              it.
            </Trans>
          )}
        </p>
      ) : null}
      <CodeBlock label={t`PMO preview`} code={preview.text} />
    </div>
  );
}
