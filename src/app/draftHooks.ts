/**
 * Draft actions and saving state the shell needs, read from the app store.
 * The rest of `src/app` goes through these rather than the store itself.
 */
import { useCallback } from "react";

import { SECTION_IDS } from "@/domain/types";
import {
  useActions,
  useAppState,
  usePersistence,
  useRestoreReport,
  type PersistenceState,
  type RestoreReport,
} from "@/state";

/**
 * Whether this browser holds a draft with something in it. The home page
 * then offers to continue it. Follows the latest build, so it is false until
 * the restored draft has been built once.
 */
export function useHasSavedDraft(): boolean {
  return useAppState((state) => {
    const sections = state.build.view?.sections;
    if (sections === undefined) return false;
    return SECTION_IDS.some((id) => sections[id].status !== "empty");
  });
}

/**
 * Returns a function that clears the draft and its imported files from this
 * browser. The top bar asks the user to confirm before calling it.
 */
export function useStartOver(): () => Promise<void> {
  const actions = useActions();
  return useCallback(() => actions.startOver(), [actions]);
}

/**
 * Returns a function that replaces the draft with the example tables in
 * `public/examples`. It rejects with a message for the user when the example
 * cannot be loaded.
 */
export function useLoadExampleData(): () => Promise<void> {
  const actions = useActions();
  return useCallback(async () => {
    const result = await actions.loadExample();
    if (!result.ok) throw new Error(result.reason);
  }, [actions]);
}

/** Whether the draft is kept in this browser. See `PersistenceState`. */
export function useSaveState(): PersistenceState {
  return usePersistence();
}

/** What happened to the saved draft when the app started. */
export function useStartupRestore(): RestoreReport {
  return useRestoreReport();
}
