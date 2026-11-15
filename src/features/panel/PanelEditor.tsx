import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Archive, BookmarkPlus, Check } from "lucide-react";
import { useState } from "react";

import type { PanelEntry, SavedPanelSummary } from "@/domain/draft";
import type { Notice } from "@/domain/types";
import { TableImport } from "@/features/table-import";
import { useActions, useSavedPanels } from "@/state";
import { Button, ConfirmDialog, useToast } from "@/ui";

import { GenomeSection } from "./GenomeSection";
import { PanelNameField } from "./PanelNameField";
import { formatSavedDate, isPanelEmpty, matchInLibrary, panelName } from "./panelModel";
import { SavedPanelList } from "./SavedPanelList";

/** Props for {@link PanelEditor}. */
export interface PanelEditorProps {
  readonly entry: PanelEntry;
  /** This panel's notices from the latest build, without the panel's label. */
  readonly notices: readonly Notice[];
  /** Whether this panel built. */
  readonly built: boolean;
  /** The content key of the built panel, or `null` when it has not built. */
  readonly contentKey: string | null;
  /** Targets in this panel, once built. */
  readonly targets: number | null;
  /** 2 when the panel is the whole page, 3 inside a panel card. */
  readonly headingLevel: 2 | 3;
}

/**
 * Offers to keep a built panel in this browser for the next run. Whether it
 * is already kept comes from the library: a saved panel with the same name
 * and the same content. When only the name is taken, saving offers to
 * replace that saved panel.
 */
function SavePanel({
  entry,
  contentKey,
  library,
}: {
  readonly entry: PanelEntry;
  readonly contentKey: string;
  readonly library: readonly SavedPanelSummary[];
}) {
  const actions = useActions();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const name = panelName(entry);
  const match = matchInLibrary(library, { name, contentKey });
  const saved = match.kind === "saved";
  const savedDate = match.kind === "name-taken" ? formatSavedDate(match.existing.savedAt) : null;

  async function save(replace?: string) {
    setSaving(true);
    try {
      const result = await actions.savePanelToLibrary(
        entry.id,
        replace === undefined ? {} : { replace },
      );
      if (result.ok) {
        toast({
          title: t`Panel saved`,
          description: t`It is offered on this page the next time you build a PMO in this browser.`,
          tone: "success",
        });
      } else {
        toast({ title: t`The panel was not saved`, description: result.reason, tone: "error" });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-border bg-surface-subtle px-4 py-3">
      <p className="min-w-0 flex-1 basis-64 text-sm text-text-muted">
        {saved
          ? t`Saved in this browser. Next time, pick it instead of adding the file again.`
          : t`Using the same panel for every run? Save it in this browser and pick it next time instead of adding the file again.`}
      </p>
      {saved ? (
        <span className="flex items-center gap-1.5 text-sm font-medium text-success-text">
          <Check aria-hidden="true" className="size-4" />
          <Trans comment="Status: this panel is saved in this browser">Saved</Trans>
        </span>
      ) : (
        <Button
          size="sm"
          icon={BookmarkPlus}
          loading={saving}
          onClick={() => {
            if (match.kind === "name-taken") setConfirming(true);
            else void save();
          }}
        >
          <Trans>Save this panel for next time</Trans>
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t`Replace the saved panel "${name}"?`}
        description={
          savedDate === null
            ? t`A different panel called "${name}" is already saved in this browser. Replacing it keeps one panel with this name. To keep both, give this panel another name first.`
            : t`A different panel called "${name}" is already saved in this browser, saved ${savedDate}. Replacing it keeps one panel with this name. To keep both, give this panel another name first.`
        }
        confirmLabel={t`Replace saved panel`}
        onConfirm={async () => {
          if (match.kind === "name-taken") await save(match.existing.id);
        }}
      />
    </div>
  );
}

/** A panel filled from the saved-panel library. */
function SavedPanelSource({
  entry,
  targets,
}: {
  readonly entry: PanelEntry;
  readonly targets: number | null;
}) {
  const actions = useActions();
  const saved = entry.saved;
  const savedPanels = useSavedPanels();
  // The draft may rename the panel; say which saved panel it came from by its name in the library.
  const libraryName =
    (savedPanels.kind === "ready"
      ? savedPanels.panels.find((panel) => panel.id === saved?.savedPanelId)?.name
      : undefined) ??
    saved?.name ??
    "";
  const savedDate = saved === null ? "" : formatSavedDate(saved.savedAt);
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-subtle p-4">
      <div className="flex items-start gap-3">
        <Archive aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-text-muted" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-base text-text">
            <Trans>
              Using the saved panel{" "}
              <span className="font-mono font-medium break-all">{libraryName}</span>
            </Trans>
          </p>
          <p className="text-sm text-text-muted">
            {targets === null
              ? t`saved ${savedDate}. Its targets and genome come from the saved copy. To change them, add the target table instead.`
              : plural(targets, {
                  one: `# target, saved ${savedDate}. Its targets and genome come from the saved copy. To change them, add the target table instead.`,
                  other: `# targets, saved ${savedDate}. Its targets and genome come from the saved copy. To change them, add the target table instead.`,
                })}
          </p>
        </div>
      </div>
      <div>
        <Button
          size="sm"
          onClick={() =>
            actions.setMode({ target: "panelSource", panelId: entry.id, mode: "table" })
          }
        >
          <Trans>Add a target table instead</Trans>
        </Button>
      </div>
    </div>
  );
}

/**
 * Everything about one panel: a saved panel to start from, the name, the
 * target table, the genome, and saving it for next time.
 */
export function PanelEditor({
  entry,
  notices,
  built,
  contentKey,
  targets,
  headingLevel,
}: PanelEditorProps) {
  const savedPanels = useSavedPanels();
  const [picking, setPicking] = useState(false);
  const library = savedPanels.kind === "ready" ? savedPanels.panels : [];
  const empty = isPanelEmpty(entry);
  const offerSaved = library.length > 0 && entry.source === "table" && (empty || picking);

  if (entry.source === "saved") {
    return (
      <div className="flex flex-col gap-6">
        <SavedPanelSource entry={entry} targets={targets} />
        <PanelNameField entry={entry} notices={notices} />
        {picking && library.length > 0 ? (
          <SavedPanelList
            panelId={entry.id}
            panels={library}
            title={t`Choose another saved panel`}
            description={t`Saved in this browser after an earlier run.`}
            onApplied={() => setPicking(false)}
            action={
              <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
                <Trans>Cancel</Trans>
              </Button>
            }
          />
        ) : library.length > 1 ? (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
              <Trans>Choose another saved panel</Trans>
            </Button>
          </div>
        ) : null}
        {built &&
        contentKey !== null &&
        panelName(entry) !== "" &&
        matchInLibrary(library, { name: panelName(entry), contentKey }).kind !== "saved" ? (
          <SavePanel entry={entry} contentKey={contentKey} library={library} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {offerSaved ? (
        <SavedPanelList
          panelId={entry.id}
          panels={library}
          title={t`Use a panel you saved before`}
          description={
            empty
              ? t`Pick one to skip the steps below, or add the target table as usual.`
              : t`Picking one replaces the target table below for this panel. The table is kept in case you switch back.`
          }
          onApplied={() => setPicking(false)}
          action={
            empty ? null : (
              <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
                <Trans>Cancel</Trans>
              </Button>
            )
          }
        />
      ) : null}
      <div className="flex flex-col gap-6">
        <PanelNameField entry={entry} notices={notices} />
        <TableImport
          slot={{ section: "panel", panelId: entry.id, part: "targets" }}
          label={t`Target table`}
          description={t`One row for each target, with its forward and reverse primer.`}
          headingLevel={headingLevel}
        />
        {!offerSaved && library.length > 0 && entry.table === null ? (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
              <Trans>Use a saved panel instead</Trans>
            </Button>
          </div>
        ) : null}
      </div>
      {entry.table === null ? null : (
        <GenomeSection entry={entry} notices={notices} headingLevel={headingLevel} />
      )}
      {built && contentKey !== null && panelName(entry) !== "" ? (
        <SavePanel entry={entry} contentKey={contentKey} library={library} />
      ) : null}
    </div>
  );
}
