import { useShallow } from "zustand/react/shallow";

import type { SectionStatus } from "@/domain/types";
import { useAppState, type AppState } from "@/state";

import type { StepId } from "./steps";

/** The status of every step. */
export type StepStatuses = Readonly<Record<StepId, SectionStatus>>;

/**
 * Reads every step's status from the latest build. Before the first build
 * finishes every step reads "empty". The review step takes the status of the
 * whole draft.
 */
function selectStatuses(state: AppState): StepStatuses {
  const view = state.build.view;
  if (view === null) {
    return {
      microhaplotypes: "empty",
      panel: "empty",
      specimens: "empty",
      librarySamples: "empty",
      project: "empty",
      sequencing: "empty",
      bioinformatics: "empty",
      readCounts: "empty",
      review: "empty",
    };
  }
  const { sections } = view;
  return {
    microhaplotypes: sections.microhaplotypes.status,
    panel: sections.panel.status,
    specimens: sections.specimens.status,
    librarySamples: sections.librarySamples.status,
    project: sections.project.status,
    sequencing: sections.sequencing.status,
    bioinformatics: sections.bioinformatics.status,
    readCounts: sections.readCounts.status,
    review: view.overall.status,
  };
}

/**
 * The status of every step, for the sidebar and the review page. It follows
 * the latest finished build, so it keeps the previous value while a newer
 * build runs.
 */
export function useStepStatuses(): StepStatuses {
  return useAppState(useShallow(selectStatuses));
}

/** The status of one step. */
export function useStepStatus(id: StepId): SectionStatus {
  return useAppState((state) => selectStatuses(state)[id]);
}
