import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { StepPage } from "@/app/StepPage";
import type { PanelEntry } from "@/domain/draft";
import { SectionResult } from "@/features/shared";
import { useActions, useDraftSection, useSectionState } from "@/state";
import { Button, ConfirmDialog, Disclosure, StatusBadge, formatCount } from "@/ui";

import { isPanelEmpty, noticesForPanel, panelStatus, panelTitle } from "./panelModel";
import { PanelEditor } from "./PanelEditor";

/** "1,200 before merging": the targets of every panel added up. */
function beforeMerging(panels: readonly { readonly targets: number }[]): string {
  const targetCount = formatCount(panels.reduce((sum, panel) => sum + panel.targets, 0));
  return t`${targetCount} before merging`;
}

/** One panel as a collapsible card, for drafts with two or more panels. */
function PanelCard({ entry, index }: { readonly entry: PanelEntry; readonly index: number }) {
  const actions = useActions();
  const view = useSectionState("panel");
  const [removing, setRemoving] = useState(false);
  const notices = noticesForPanel(view?.notices ?? [], entry, index);
  const status = panelStatus(entry, notices);
  const built = view?.summary?.panels.find((panel) => panel.id === entry.id) ?? null;
  const title = panelTitle(entry, index);

  return (
    <li>
      <Disclosure
        defaultOpen={status !== "ready"}
        title={<span className="font-mono">{title}</span>}
        summary={<StatusBadge status={status} />}
      >
        <div className="flex flex-col gap-8">
          <PanelEditor
            entry={entry}
            notices={notices}
            built={status === "ready" && !isPanelEmpty(entry)}
            contentKey={built?.contentKey ?? null}
            targets={built?.targets ?? null}
            headingLevel={3}
          />
          <div className="flex justify-end border-t border-border pt-4">
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoving(true)}>
              <Trans>Remove this panel</Trans>
            </Button>
          </div>
        </div>
      </Disclosure>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t`Remove the panel "${title}"?`}
        description={t`Its target table, genome and column choices are removed from this draft. Saved panels stay in this browser.`}
        confirmLabel={t`Remove panel`}
        tone="danger"
        onConfirm={() => actions.removeItem({ list: "panels" }, entry.id)}
      />
    </li>
  );
}

/** The only panel, shown as the page itself with no card around it. */
function SinglePanel({ entry }: { readonly entry: PanelEntry }) {
  const view = useSectionState("panel");
  const notices = noticesForPanel(view?.notices ?? [], entry, 0);
  const built = view?.summary?.panels.find((panel) => panel.id === entry.id) ?? null;
  return (
    <PanelEditor
      entry={entry}
      notices={notices}
      built={built !== null}
      contentKey={built?.contentKey ?? null}
      targets={built?.targets ?? null}
      headingLevel={2}
    />
  );
}

/**
 * The panel step: the targets and primers of each panel, from a file or a
 * panel saved earlier, with an optional reference genome. One panel is the
 * page itself; with two or more, each is a card.
 */
export function PanelStep() {
  const { panels } = useDraftSection("panel");
  const actions = useActions();
  const first = panels[0];
  const several = panels.length > 1;
  const canAdd = several || (first !== undefined && !isPanelEmpty(first));

  return (
    <StepPage stepId="panel">
      <div className="flex flex-col gap-10">
        {several ? (
          <div className="flex flex-col gap-3">
            <p className="max-w-prose text-base text-text-muted">
              {plural(panels.length, {
                one: "# panel. Targets that appear in more than one panel are kept once in the PMO, so panels that share targets are merged.",
                other:
                  "# panels. Targets that appear in more than one panel are kept once in the PMO, so panels that share targets are merged.",
              })}
            </p>
            <ul className="flex flex-col gap-3">
              {panels.map((entry, index) => (
                <PanelCard key={entry.id} entry={entry} index={index} />
              ))}
            </ul>
          </div>
        ) : first === undefined ? null : (
          <SinglePanel entry={first} />
        )}
        {canAdd ? (
          <div className="flex flex-col items-start gap-1.5">
            <Button icon={Plus} onClick={() => actions.addItem({ list: "panels" })}>
              <Trans>Add another panel</Trans>
            </Button>
            {several ? null : (
              <p className="max-w-prose text-sm text-text-muted">
                <Trans>
                  For runs that use more than one panel. Panels that share targets are merged.
                </Trans>
              </p>
            )}
          </div>
        ) : null}
        <SectionResult
          section="panel"
          emptyMessage={t`Nothing here yet. Name your panel and add its target table above to see what goes into the PMO.`}
          stats={(summary) => [
            {
              label: plural(summary.panels.length, { one: "Panel", other: "Panels" }),
              value: summary.panels.length,
              hint: summary.panels.map((panel) => panel.name).join(", "),
            },
            {
              label: t`Targets`,
              value: summary.targets,
              hint: summary.panels.length > 1 ? beforeMerging(summary.panels) : undefined,
            },
            {
              label: plural(summary.genomes, { one: "Genome", other: "Genomes" }),
              value: summary.genomes,
            },
          ]}
        />
      </div>
    </StepPage>
  );
}
