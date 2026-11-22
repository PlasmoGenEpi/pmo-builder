/**
 * React bindings for the app store. Each hook selects one slice, so a page
 * re-renders only when that slice changes.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import {
  createDraftStorage,
  getSlotTable,
  slotKey,
  type Draft,
  type MappedTable,
  type TableRef,
  type TableSlot,
} from "@/domain/draft";
import type { Suggestions } from "@/domain/build";
import type { SectionId } from "@/domain/types";
import {
  createEngine,
  type BuildProgress,
  type OverallView,
  type PmoTextPreview,
  type SectionView,
  type TablePreview,
} from "@/worker";

import { browserEditorLock } from "./editorLock";
import { instrumentAppStore } from "./instrumentation";
import {
  createAppStore,
  selectSuggestions,
  type AppActions,
  type AppState,
  type AppStore,
  type BuildState,
  type EngineState,
  type ExampleState,
  type ImportState,
  type PersistenceState,
  type RestoreReport,
  type SavedPanelsState,
} from "./store";

const AppStoreContext = createContext<AppStore | null>(null);

let defaultStore: AppStore | null = null;

/**
 * The app's store: an engine in a web worker and storage in IndexedDB, with
 * usage counts recorded (see `instrumentAppStore`). Created on first use and
 * initialised at once.
 */
export function getDefaultAppStore(): AppStore {
  if (defaultStore === null) {
    let created: AppStore | null = null;
    const engine = createEngine({
      onProgress: (progress) => {
        created?.setState({ progress });
      },
    });
    created = createAppStore({
      engine,
      storage: createDraftStorage(),
      editorLock: browserEditorLock("pmo-builder-draft-editor"),
    });
    defaultStore = created;
    instrumentAppStore(defaultStore);
    void defaultStore.getState().actions.initialise();
  }
  return defaultStore;
}

/** Whether the engine's worker is running, or stopped and why. */
export function useEngineState(): EngineState {
  return useAppState((state) => state.engine);
}

/** Props of {@link AppStoreProvider}. */
export interface AppStoreProviderProps {
  /** The store to provide. Default: {@link getDefaultAppStore}. Tests pass their own. */
  readonly store?: AppStore;
  readonly children: ReactNode;
}

/**
 * Provides the store to the hooks below, restores the saved draft once, and
 * starts saving pending changes at once when the page is hidden or closed.
 */
export function AppStoreProvider({ store, children }: AppStoreProviderProps): ReactNode {
  const [provided] = useState(() => store ?? getDefaultAppStore());
  useEffect(() => {
    void provided.getState().actions.initialise();
    // Save at once when the page may be about to go. Buffered text fields
    // commit in the capture phase of these events, so they are in the draft
    // by the time these listeners run.
    const save = (): void => {
      void provided.getState().actions.saveNow();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") save();
    };
    globalThis.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      globalThis.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [provided]);
  return <AppStoreContext value={provided}>{children}</AppStoreContext>;
}

/** The store in context, or the default store. */
export function useAppStore(): AppStore {
  return useContext(AppStoreContext) ?? getDefaultAppStore();
}

/** Selects any slice of the store. Prefer the named hooks; return stable values from `selector`. */
export function useAppState<T>(selector: (state: AppState) => T): T {
  return useStore(useAppStore(), selector);
}

/** The actions. The object never changes, so it is safe in effect dependencies. */
export function useActions(): AppActions {
  return useAppState((state) => state.actions);
}

/** The whole draft. Re-renders on every change; prefer {@link useDraftSection}. */
export function useDraft(): Draft {
  return useAppState((state) => state.draft);
}

/** One section of the draft, such as `useDraftSection("project")`. */
export function useDraftSection<S extends SectionId>(section: S): Draft[S] {
  return useAppState((state) => state.draft[section]);
}

/** The table in a slot and its mapping, or `null` when the slot is empty. */
export function useSlotTable(slot: TableSlot): MappedTable | null {
  return useAppState((state) => getSlotTable(state.draft, slot));
}

/** An import into a slot that is running or has failed, or `null`. */
export function useImportState(slot: TableSlot): ImportState | null {
  const key = slotKey(slot);
  return useAppState((state) => state.imports[key] ?? null);
}

/**
 * A section's status, notices and summary from the latest build, or `null`
 * before the first build finishes. While a newer build runs this keeps the
 * previous result; see {@link useBuildState} for whether one is running.
 */
export function useSectionState<S extends SectionId>(section: S): SectionView<S> | null {
  return useAppState((state): SectionView<S> | null => {
    const sections = state.build.view?.sections;
    return sections === undefined ? null : sections[section];
  });
}

/** Whether a build is pending or failed, with the latest finished build. */
export function useBuildState(): BuildState {
  return useAppState((state) => state.build);
}

/** Live reading/building progress while streaming a large allele table. */
export function useBuildProgress(): BuildProgress {
  return useAppState((state) => state.progress);
}

/** The whole-draft result of the latest build: status, notices, merge summary, PMO availability. */
export function useOverallState(): OverallView | null {
  return useAppState((state) => state.build.view?.overall ?? null);
}

/** Names found in one section's tables to suggest in another. */
export function useSuggestions(): Suggestions {
  return useAppState(selectSuggestions);
}

/** Whether the draft is saved, waiting, or kept for this session only. */
export function usePersistence(): PersistenceState {
  return useAppState((state) => state.persistence);
}

/** What happened to the saved draft at start-up. */
export function useRestoreReport(): RestoreReport {
  return useAppState((state) => state.restore);
}

/** The saved-panel library. */
export function useSavedPanels(): SavedPanelsState {
  return useAppState((state) => state.savedPanels);
}

/** Whether the example is loading or failed to load. */
export function useExampleState(): ExampleState {
  return useAppState((state) => state.example);
}

/** A preview being fetched, or what the engine gave. */
export type PreviewState = { readonly kind: "loading" } | TablePreview;

/** Options for {@link useTablePreview}. */
export interface TablePreviewOptions {
  readonly offset?: number;
  readonly limit?: number;
}

/**
 * Rows of an imported table, fetched from the engine. Refetches when the
 * table, its sheet or the requested rows change. `null` for no table.
 */
export function useTablePreview(
  table: TableRef | null,
  options: TablePreviewOptions = {},
): PreviewState | null {
  const actions = useActions();
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  const tableId = table?.id ?? null;
  const sheet = table?.sheetName ?? null;
  const [result, setResult] = useState<{
    readonly key: string;
    readonly preview: TablePreview;
  } | null>(null);
  const key = `${tableId ?? ""}|${sheet ?? ""}|${offset}|${limit}`;
  useEffect(() => {
    let current = true;
    const load = async (id: string): Promise<void> => {
      const preview = await actions.previewRows({ tableId: id, offset, limit });
      if (current) setResult({ key, preview });
    };
    if (tableId !== null) void load(tableId);
    return () => {
      current = false;
    };
  }, [actions, tableId, key, offset, limit]);
  if (tableId === null) return null;
  return result?.key === key ? result.preview : { kind: "loading" };
}

/** Distinct values of a column being fetched, or what the engine gave. */
export type ColumnValuesState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly values: readonly string[]; readonly truncated: boolean }
  | { readonly kind: "missing" };

/**
 * The distinct non-blank values of a column (at most `limit`, default 200),
 * for pickers such as the run-name or grouping column. `null` when no table
 * or column is given.
 */
export function useColumnValues(
  table: TableRef | null,
  column: string | null,
  limit = 200,
): ColumnValuesState | null {
  const actions = useActions();
  const tableId = table?.id ?? null;
  const key = `${tableId ?? ""}|${table?.sheetName ?? ""}|${column ?? ""}|${limit}`;
  const [result, setResult] = useState<{
    readonly key: string;
    readonly state: ColumnValuesState;
  } | null>(null);
  useEffect(() => {
    let current = true;
    const load = async (id: string, name: string): Promise<void> => {
      const values = await actions.distinctValues({ tableId: id, column: name, limit });
      if (current)
        setResult({
          key,
          state: values === null ? { kind: "missing" } : { kind: "ready", ...values },
        });
    };
    if (tableId !== null && column !== null) void load(tableId, column);
    return () => {
      current = false;
    };
  }, [actions, tableId, column, key, limit]);
  if (tableId === null || column === null) return null;
  return result?.key === key ? result.state : { kind: "loading" };
}

/**
 * The PMO's JSON text for a preview, refetched after each build. `null`
 * while loading or when there is no PMO.
 */
export function usePmoPreview(maxLength = 200_000): PmoTextPreview | null {
  const actions = useActions();
  const revision = useAppState((state) =>
    state.build.view?.overall.pmo === "none" ? null : (state.build.view?.revision ?? null),
  );
  const [result, setResult] = useState<{
    readonly revision: number;
    readonly preview: PmoTextPreview | null;
  } | null>(null);
  useEffect(() => {
    let current = true;
    const load = async (at: number): Promise<void> => {
      const preview = await actions.previewPmo({ maxLength });
      if (current) setResult({ revision: at, preview });
    };
    if (revision !== null) void load(revision);
    return () => {
      current = false;
    };
  }, [actions, revision, maxLength]);
  if (revision === null || result === null) return null;
  return result.preview;
}
