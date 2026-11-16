import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";

import type { SubsetOutcome, WorkingSource } from "@/domain/tools/types";
import { PublishToZenodo } from "@/features/review/PublishToZenodo";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { useActions, type OpenState } from "@/state";
import { Callout, Link, SegmentedControl, Spinner } from "@/ui";

import { useUpdateWorkspace, useWorkspace } from "./workspace";

type Made = Extract<SubsetOutcome, { kind: "made" }>;

/** The subset as a file to deposit, made when the user chooses to publish it. */
type SubsetFile =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly blob: Blob; readonly fileName: string }
  | { readonly kind: "failed" };

function SubsetDeposit({
  zenodo,
  subset,
}: {
  readonly zenodo: ZenodoConfig;
  readonly subset: Made;
}) {
  const actions = useActions();
  const [file, setFile] = useState<SubsetFile>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    async function load(): Promise<void> {
      const made = await actions.workingPmoFile({ gzip: true });
      if (!live) return;
      setFile(
        made === null
          ? { kind: "failed" }
          : { kind: "ready", blob: made.blob, fileName: made.fileName },
      );
    }
    void load();
    return () => {
      live = false;
    };
    // The panel is mounted afresh each time the Publish tab opens, so a
    // newer subset is always the one fetched.
  }, [actions]);

  if (file.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-base text-text-muted">
        <Spinner />
        {t`Preparing the subset`}
      </div>
    );
  }
  if (file.kind === "failed") {
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
      source={{ kind: "file", file: file.blob, fileName: file.fileName }}
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
  const chosen = useWorkspace((state) => state.publishSource);
  const updateWorkspace = useUpdateWorkspace();
  const source: WorkingSource = subset === null ? "original" : chosen;
  const recordTitle = file.origin.kind === "published" ? file.origin.title : "";

  return (
    <div className="flex flex-col gap-6">
      {subset === null ? null : (
        <SegmentedControl<WorkingSource>
          label={t`What to publish`}
          value={source}
          onValueChange={(value) => updateWorkspace({ publishSource: value })}
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
