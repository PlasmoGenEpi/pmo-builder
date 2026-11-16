import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

import type { SubsetOutcome, WorkingPmoQuery, WorkingSource } from "@/domain/tools/types";
import { PublishToZenodo } from "@/features/review/PublishToZenodo";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { useWorkingPmo, useWorkingPmoQuery, useWorkingPmoSession, type OpenState } from "@/state";
import { Callout, Link, SegmentedControl, Spinner } from "@/ui";

type Made = Extract<SubsetOutcome, { kind: "made" }>;

/** The subset's file, gzipped as published PMOs are. */
const SUBSET_FILE: WorkingPmoQuery<"file"> = { kind: "file", gzip: true };

function SubsetDeposit({
  zenodo,
  subset,
}: {
  readonly zenodo: ZenodoConfig;
  readonly subset: Made;
}) {
  // The panel is mounted afresh each time the Publish tab opens, so a newer
  // subset is always the one exported.
  const file = useWorkingPmoQuery(SUBSET_FILE);

  if (file.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-base text-text-muted">
        <Spinner />
        {t`Preparing the subset`}
      </div>
    );
  }
  if (file.kind !== "ok") {
    return (
      <Callout tone="error" live title={t`The subset could not be prepared`}>
        <Trans>Make the subset again on the Subset tab.</Trans>
      </Callout>
    );
  }
  return (
    <PublishToZenodo
      zenodo={zenodo}
      summary={subset.summary}
      publication={subset.publication}
      source={{ kind: "file", file: file.value.blob, fileName: file.value.fileName }}
      variant="card"
    />
  );
}

/** Props for {@link PublishPanel}. */
export interface PublishPanelProps {
  readonly zenodo: ZenodoConfig;
  readonly file: Extract<OpenState, { kind: "opened" }>;
  /** The subset, when one has been made. */
  readonly subset: Made | null;
}

/** Depositing the open file, or its subset, in the Zenodo community. */
export function PublishPanel({ zenodo, file, subset }: PublishPanelProps) {
  const session = useWorkingPmoSession();
  const chosen = useWorkingPmo((state) => state.publishSource);
  const source: WorkingSource = subset === null ? "original" : chosen;
  const recordTitle = file.origin.kind === "published" ? file.origin.title : "";

  return (
    <div className="flex flex-col gap-6">
      {subset === null ? null : (
        <SegmentedControl<WorkingSource>
          label={t`What to publish`}
          value={source}
          onValueChange={(value) => session.setPublishSource(value)}
          segments={[
            { value: "original", label: t`The whole file` },
            { value: "subset", label: t`The subset` },
          ]}
        />
      )}
      {source === "subset" && subset !== null ? (
        <SubsetDeposit key={subset.fileName} zenodo={zenodo} subset={subset} />
      ) : file.origin.kind === "published" ? (
        <Callout tone="info" title={t`This file is already published`}>
          <Trans>
            It is the file of the Zenodo record{" "}
            <Link href={file.origin.recordUrl} external>
              {recordTitle}
            </Link>
            . To publish part of it as a new record, make a subset first.
          </Trans>
        </Callout>
      ) : (
        <PublishToZenodo
          zenodo={zenodo}
          summary={file.opened.summary}
          publication={file.opened.publication}
          source={{ kind: "file", file: file.file, fileName: file.name }}
          variant="card"
        />
      )}
    </div>
  );
}
