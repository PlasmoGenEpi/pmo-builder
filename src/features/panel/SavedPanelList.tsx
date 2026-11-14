import { Trash2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import type { SavedPanelSummary } from "@/domain/draft";
import { useActions } from "@/state";
import { Button, ConfirmDialog, IconButton, useToast } from "@/ui";

import { countTargets, formatSavedDate } from "./panelModel";

/** Props for {@link SavedPanelList}. */
export interface SavedPanelListProps {
  /** The panel the chosen saved panel fills. */
  readonly panelId: string;
  readonly panels: readonly SavedPanelSummary[];
  /** Heading, such as "Use a panel you saved before". */
  readonly title: string;
  /** One line under the heading. */
  readonly description: string;
  /** Called after a saved panel is applied. */
  readonly onApplied?: () => void;
  /** A button at the end of the heading row, such as "Cancel". */
  readonly action?: ReactNode;
}

/**
 * The panels saved in this browser, newest first, each with its target count
 * and date, a Use button and a Delete button that asks first.
 */
export function SavedPanelList({
  panelId,
  panels,
  title,
  description,
  onApplied,
  action,
}: SavedPanelListProps) {
  const actions = useActions();
  const { toast } = useToast();
  const headingId = useId();
  const [applying, setApplying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SavedPanelSummary | null>(null);

  async function apply(saved: SavedPanelSummary) {
    setApplying(saved.id);
    try {
      const result = await actions.applySavedPanel(panelId, saved.id);
      if (result.ok) onApplied?.();
      else
        toast({
          title: "The saved panel could not be used",
          description: result.reason,
          tone: "error",
        });
    } finally {
      setApplying(null);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-subtle p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={headingId} className="text-md font-semibold text-text">
            {title}
          </h3>
          <p className="max-w-prose text-sm text-text-muted">{description}</p>
        </div>
        {action}
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
        {panels.map((saved) => (
          <li key={saved.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-sm font-medium text-text">{saved.name}</span>
              <span className="text-sm text-text-muted">
                {countTargets(saved.targetCount)}, saved {formatSavedDate(saved.savedAt)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="primary"
                loading={applying === saved.id}
                aria-label={`Use the saved panel ${saved.name}`}
                onClick={() => {
                  void apply(saved);
                }}
              >
                Use
              </Button>
              <IconButton
                label={`Delete the saved panel ${saved.name}`}
                icon={Trash2}
                size="sm"
                onClick={() => setDeleting(saved)}
              />
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete the saved panel "${deleting?.name ?? ""}"?`}
        description="It is removed from this browser and will not be offered again. Drafts that already use it keep their targets."
        confirmLabel="Delete panel"
        tone="danger"
        onConfirm={async () => {
          if (deleting !== null) await actions.deleteSavedPanel(deleting.id);
        }}
      />
    </section>
  );
}
