/**
 * What the Subset, Summary and Publish tabs keep about the working PMO until
 * they move to the working PMO session: the latest subset and each tab's
 * choice of original or subset. The file itself is the session's.
 *
 * Everything here belongs to one generation of the session, so opening or
 * closing a file starts again from nothing.
 */
import { useCallback } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { SubsetOutcome, WorkingSource } from "@/domain/tools/types";
import { useWorkingPmo } from "@/state";

/** What the tabs keep about the working PMO. */
export interface WorkspaceState {
  /** The latest subset made of the open file. */
  readonly subset: SubsetOutcome | null;
  /** Which PMO the Publish tab deposits. */
  readonly publishSource: WorkingSource;
  /** Which PMO the Summary and Compare tabs sum up. */
  readonly summarySource: WorkingSource;
}

const EMPTY: WorkspaceState = {
  subset: null,
  publishSource: "original",
  summarySource: "original",
};

/** The tabs' state, and the session generation it belongs to. */
const store = createStore<{ readonly generation: number; readonly state: WorkspaceState }>(() => ({
  generation: 0,
  state: EMPTY,
}));

/** Reads what the tabs keep about the file open now. */
export function useWorkspace<T>(select: (state: WorkspaceState) => T): T {
  const generation = useWorkingPmo((session) => session.generation);
  return useStore(store, (kept) => select(kept.generation === generation ? kept.state : EMPTY));
}

/** A function that changes what the tabs keep about the file open now. */
export function useUpdateWorkspace(): (change: Partial<WorkspaceState>) => void {
  const generation = useWorkingPmo((session) => session.generation);
  return useCallback(
    (change) => {
      store.setState((kept) =>
        // A change made for a file that has since been replaced is dropped.
        kept.generation > generation
          ? kept
          : {
              generation,
              state: { ...(kept.generation === generation ? kept.state : EMPTY), ...change },
            },
      );
    },
    [generation],
  );
}

/** Forgets everything. For tests. */
export function resetWorkspace(): void {
  store.setState({ generation: 0, state: EMPTY });
}
