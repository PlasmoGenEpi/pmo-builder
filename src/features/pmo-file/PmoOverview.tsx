import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Download } from "lucide-react";

// By path, not the barrel: the barrel would bring pmotools-ts onto the main thread.
import { MAX_LISTED, PUBLISHABLE_PMO_VERSION } from "@/domain/build/checkFileResult";
import { PmoContents } from "@/features/review/PmoContents";
import type { WorkingPmoDetails, WorkingPmoOrigin } from "@/state";
import { Button, Callout, Link } from "@/ui";

/** Props for {@link PmoOverview}. */
export interface PmoOverviewProps {
  readonly opened: WorkingPmoDetails;
  /** Where the file came from in My PMO file, or `null` in the read-only published view. */
  readonly origin: WorkingPmoOrigin | null;
  /** Saves the file, offered for the built PMO, which has no copy on disk yet. */
  readonly onDownload?: () => void;
}

/** The Overview tab: whether the file is valid, anything worth a look, and what it holds. */
export function PmoOverview({ opened, origin, onDownload }: PmoOverviewProps) {
  const version = PUBLISHABLE_PMO_VERSION;
  const recordTitle = origin?.kind === "published" ? origin.title : "";
  return (
    <div className="flex flex-col gap-6">
      {origin?.kind === "published" ? (
        <Callout tone="success" title={t`This is a published PMO`}>
          <Trans>
            From the Zenodo record{" "}
            <Link href={origin.recordUrl} external>
              {recordTitle}
            </Link>
            . It matches PMO version {version} and its tables link up.
          </Trans>
        </Callout>
      ) : (
        <Callout
          tone="success"
          action={
            origin?.kind === "built" && onDownload !== undefined ? (
              <Button variant="secondary" size="sm" icon={Download} onClick={onDownload}>
                {t`Download`}
              </Button>
            ) : undefined
          }
          title={
            origin?.kind === "built"
              ? t`This is the PMO built from your draft`
              : t`This file is a valid PMO`
          }
        >
          <Trans>It matches PMO version {version} and its tables link up.</Trans>
        </Callout>
      )}
      {opened.warnings.length === 0 ? null : (
        <Callout tone="warning" title={t`Worth a look`}>
          <ul className="list-disc pl-5">
            {opened.warnings.map((warning) => (
              <li key={warning} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
          {opened.warnings.length === MAX_LISTED ? (
            <p>
              <Trans>There may be more.</Trans>
            </p>
          ) : null}
        </Callout>
      )}
      <PmoContents summary={opened.summary} />
    </div>
  );
}
