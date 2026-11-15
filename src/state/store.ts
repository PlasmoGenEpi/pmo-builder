/**
 * The app store: the draft, the latest build from the engine, and where
 * saving stands, with the actions the step pages call.
 *
 * Changing the draft schedules a rebuild in the engine and a save to the
 * browser, each debounced. Pages never build or save themselves.
 */
import { t } from "@lingui/core/macro";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { PmoFile, PmoFileCheck, Suggestions } from "@/domain/build";
import type {
  GroupComparison,
  GroupKey,
  OpenOutcome,
  PmoSummary,
  SubsetOutcome,
  SubsetRequest,
  TableFile,
  TableFormat,
  TableId,
  WorkingSource,
} from "@/domain/tools/types";
// Not the `@/domain/build` or `@/domain/import` barrels: they would bring
// pmotools-ts onto the main thread.
import { NO_SUGGESTIONS } from "@/domain/build/suggestions";
import { importFailureMessage } from "@/domain/import/messages";
import {
  addListItem,
  applyModeChange,
  confirmSlotMatch,
  createEmptyDraft,
  fieldSetForSlot,
  getSlotTable,
  listFilledSlots,
  moveListItem,
  referencedTableIds,
  removeListItem,
  setRecordValue,
  setSlotTable,
  slotExists,
  slotKey,
  unreachable,
  updateListItem,
  type Draft,
  type DraftStorage,
  type ItemUpdate,
  type ListPath,
  type MappedTable,
  type ModeChange,
  type RecordValueChange,
  type SavedPanelSummary,
  type TableRef,
  type TableSlot,
} from "@/domain/draft";
import { getFieldSet as realGetFieldSet } from "@/domain/fields";
import { suggestMapping as realSuggestMapping } from "@/domain/matching";
import type {
  ColumnMapping,
  FieldSetId,
  FieldSetSpec,
  MappingSuggestion,
  Notice,
  SectionId,
} from "@/domain/types";
import {
  isEngineStoppedError,
  type BuildView,
  type DistinctValuesRequest,
  type Engine,
  type ImportFailure,
  type ImportOutcome,
  type PmoTextPreview,
  type PreviewRequest,
  type TablePreview,
} from "@/worker";

import { createSoleEditorLock, type EditorLock } from "./editorLock";
import { EXAMPLE_FILES, type ExampleFile } from "./example";

/** Where saving to the browser stands. */
export type PersistenceState =
  /** Reading the saved draft at start-up. */
  | { readonly kind: "restoring" }
  /** Everything is saved. */
  | { readonly kind: "saved"; readonly savedAt: string | null }
  /** Changes are waiting to be saved. */
  | { readonly kind: "unsaved" }
  /** The browser does not let the app keep data. Work lasts until the tab is closed. */
  | { readonly kind: "session-only"; readonly reason: string }
  /** The last save failed. */
  | { readonly kind: "failed"; readonly reason: string }
  /** Another tab is editing this draft, so this tab does not save. */
  | { readonly kind: "other-tab" };

/**
 * Whether this tab edits the draft. Only one tab does, so two tabs never
 * overwrite each other's saved work.
 */
export type EditingState =
  /** Finding out at start-up, or while taking over from another tab. */
  | { readonly kind: "checking" }
  | { readonly kind: "editor" }
  /** Another tab has the draft open. This tab shows it but does not save. */
  | { readonly kind: "other-tab" };

/** What happened to the saved draft at start-up. */
export type RestoreReport =
  | { readonly kind: "pending" }
  /** Nothing was saved: a fresh start. */
  | { readonly kind: "fresh" }
  /** The saved draft was restored. `missingFiles` lists files whose bytes were not kept. */
  | {
      readonly kind: "restored";
      readonly savedAt: string;
      readonly missingFiles: readonly string[];
    }
  /** The saved draft could not be read. It was set aside, and a new draft started. */
  | { readonly kind: "set-aside"; readonly problem: string };

/** Where the build stands. `view` is the latest finished build, kept while a newer one runs. */
export type BuildState =
  | { readonly phase: "idle"; readonly view: BuildView | null }
  /** The draft changed since `view`; a build is scheduled or running. */
  | { readonly phase: "pending"; readonly view: BuildView | null }
  /** The engine failed. Building again may help; reloading will. */
  | { readonly phase: "failed"; readonly view: BuildView | null; readonly message: string };

/** An import in progress, or the last one that failed, for one slot. */
export type ImportState =
  | { readonly kind: "importing"; readonly fileName: string }
  | {
      readonly kind: "failed";
      readonly notice: Notice;
      /** Why, as a code to word with `importFailureMessage` from `@/domain/import/messages`. */
      readonly failure: ImportFailure;
      /** The file that failed. */
      readonly fileName: string;
    };

/**
 * Whether the engine's background worker is running. When it stops (it ran
 * out of memory, say) the work in flight fails, the state says so, and the
 * next change starts it again with the same files.
 */
export type EngineState =
  | { readonly kind: "running" }
  | { readonly kind: "stopped"; readonly message: string };

/**
 * Something that happened in the store that a page cannot see in the state:
 * how a table arrived, a change the user made to a mapping, a download. For
 * usage counts (see `instrumentAppStore`); subscribe with {@link subscribeAppEvents}.
 */
export type AppEvent =
  | {
      readonly kind: "table-imported";
      readonly slot: TableSlot;
      /** `upload` for the user's own file, `example` for the example's. */
      readonly route: "upload" | "example";
      readonly table: TableRef;
    }
  | {
      readonly kind: "import-failed";
      readonly slot: TableSlot;
      readonly route: "upload" | "example";
      readonly failure: ImportFailure;
    }
  /** A panel was filled from the saved-panel library. */
  | { readonly kind: "saved-panel-applied"; readonly targets: number }
  /** The user changed which columns feed which fields, as opposed to the automatic match on import. */
  | { readonly kind: "mapping-edited"; readonly slot: TableSlot }
  | { readonly kind: "pmo-downloaded"; readonly gzip: boolean; readonly bytes: number }
  /** The saved draft came back at start-up. */
  | { readonly kind: "draft-restored" }
  /** The saved draft could not be read and was set aside. */
  | { readonly kind: "draft-set-aside" }
  | { readonly kind: "save-failed" }
  | { readonly kind: "engine-stopped" }
  /** A PMO file was checked on the publish page. */
  | { readonly kind: "pmo-file-checked"; readonly result: PmoFileCheckResult }
  | PublishingEvent;

/** Where the PMO being published came from. */
export type PublishingSource = "built" | "file";

/** How a deposit on Zenodo ended. */
export type DepositEnd =
  | "draft-ready"
  | "cancelled"
  | "pop-up-blocked"
  | "sign-in-refused"
  | "sign-in-timed-out"
  | "signed-out"
  | "not-allowed"
  | "no-community"
  | "too-large"
  | "offline"
  | "refused"
  | "no-record"
  | "not-owner"
  | "other-community"
  | "failed";

/** What checking a PMO file found, in a word. `failed` when the check could not run. */
export type PmoFileCheckResult =
  | "ready"
  | "example"
  | "too-large"
  | "unreadable"
  | "not-pmo"
  | "wrong-version"
  | "invalid"
  | "failed";

/** Publishing steps the publish panel reports, for usage counts. */
export type PublishingEvent =
  | { readonly kind: "publish-opened"; readonly source: PublishingSource }
  | { readonly kind: "deposit-started"; readonly source: PublishingSource }
  | { readonly kind: "deposit-finished"; readonly outcome: DepositEnd };

/** The word for what a file check found. */
export function fileCheckResult(check: PmoFileCheck | null): PmoFileCheckResult {
  if (check === null) return "failed";
  switch (check.kind) {
    case "ready":
      return check.publication.exampleData ? "example" : "ready";
    case "unreadable":
      return check.reason === "not-pmo" ? "not-pmo" : "unreadable";
    case "too-large":
    case "wrong-version":
    case "invalid":
      return check.kind;
    default:
      return unreachable(check);
  }
}

const eventListeners = new WeakMap<AppStore, Set<(event: AppEvent) => void>>();

/** Calls `listener` with every {@link AppEvent} of a store. Returns a function that stops. */
export function subscribeAppEvents(
  store: AppStore,
  listener: (event: AppEvent) => void,
): () => void {
  const listeners = eventListeners.get(store) ?? new Set();
  eventListeners.set(store, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Options for `AppActions.savePanelToLibrary`. */
export interface SavePanelOptions {
  /** The name to save under. Defaults to the panel's own name. */
  readonly name?: string;
  /** The id of a saved panel to replace. */
  readonly replace?: string;
}

/** The saved-panel library. */
export type SavedPanelsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly panels: readonly SavedPanelSummary[] };

/** Loading the example. */
export type ExampleState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string };

/** The result of an action that can fail with a reason for the user. */
export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** What the step pages can do. Every action is safe to call at any time. */
export interface AppActions {
  /** Restores the saved draft and its files. Called once by `AppStoreProvider`; later calls wait for the first. */
  initialise(): Promise<void>;
  /**
   * Imports a file into a slot, replacing any table there, with a suggested
   * mapping. Pass a `File` from an input or a drop; its name is used unless
   * `fileName` is given. When a newer import into the same slot starts
   * before this one finishes, the newer one wins and this one is dropped.
   */
  importFile(slot: TableSlot, file: Blob, fileName?: string): Promise<ImportOutcome>;
  /** Reads another sheet of the workbook in a slot. The mapping is kept when the columns are the same. */
  chooseSheet(slot: TableSlot, sheetName: string): Promise<ImportOutcome | null>;
  /** Empties a slot and forgets its file. */
  removeTable(slot: TableSlot): void;
  /** Replaces the mapping of the table in a slot. Counts as the user's change to the automatic match. */
  setMapping(slot: TableSlot, mapping: ColumnMapping): void;
  /**
   * Records that the user checked a match made from a similar column name
   * and kept it. Kept in the draft with the table, until another file is
   * imported into the slot.
   */
  confirmMatch(slot: TableSlot, fieldKey: string, column: string): void;
  /** Changes one section of the draft. */
  updateSection<S extends SectionId>(section: S, recipe: (current: Draft[S]) => Draft[S]): void;
  /** Adds a blank item to a list and returns its id. */
  addItem(path: ListPath): string;
  removeItem(path: ListPath, id: string): void;
  moveItem(path: ListPath, id: string, toIndex: number): void;
  /** Changes one list item with a recipe. */
  updateItem(update: ItemUpdate): void;
  /** Sets one value of a hand-entered record. */
  setValue(change: RecordValueChange): void;
  /** Switches a mode. What was entered under the other mode is kept. */
  setMode(change: ModeChange): void;
  /**
   * Saves a panel's built fragment to the library, under `options.name` or the
   * panel's own name. With `options.replace`, it takes the place of that saved
   * panel instead of being added beside it.
   */
  savePanelToLibrary(panelId: string, options?: SavePanelOptions): Promise<ActionResult>;
  /** Fills a panel from the library. */
  applySavedPanel(panelId: string, savedPanelId: string): Promise<ActionResult>;
  deleteSavedPanel(savedPanelId: string): Promise<void>;
  /** Clears the draft and its files. Saved panels stay. */
  startOver(): Promise<void>;
  /** Replaces the draft with the MAD4HATTER example, imported like a user's files. */
  loadExample(): Promise<ActionResult>;
  /** Some rows of an imported table. */
  previewRows(request: PreviewRequest): Promise<TablePreview>;
  /** The distinct values of a column, capped. */
  distinctValues(
    request: DistinctValuesRequest,
  ): Promise<{ readonly values: readonly string[]; readonly truncated: boolean } | null>;
  /** Builds now if needed, then gives the PMO file, or `null` when there is no PMO. */
  downloadPmo(options?: { readonly gzip?: boolean }): Promise<PmoFile | null>;
  /**
   * Builds now if needed, then gives the name and size of the PMO file in
   * one format, or `null` when there is no PMO. It is not a download and is
   * not counted as one; a download of the same build reuses the file.
   */
  pmoFileSize(options?: {
    readonly gzip?: boolean;
  }): Promise<{ readonly fileName: string; readonly size: number } | null>;
  /** Builds now if needed, then gives the PMO's text for a preview. */
  previewPmo(options?: { readonly maxLength?: number }): Promise<PmoTextPreview | null>;
  /**
   * Checks a PMO file the user already has, for publishing. The draft is not
   * touched. `null` when the engine failed.
   */
  checkPmoFile(file: Blob): Promise<PmoFileCheck | null>;
  /**
   * Opens a PMO file the user already has, to subset it or export its
   * tables. The draft is not touched. `null` when the engine failed.
   */
  openPmo(file: Blob, fileName: string): Promise<OpenOutcome | null>;
  /**
   * Builds now if needed, then opens the built PMO as the working file.
   * `null` when nothing could be built or the engine failed.
   */
  openBuiltPmo(): Promise<{ readonly outcome: OpenOutcome; readonly file: PmoFile } | null>;
  /** Makes a subset of the opened PMO. `null` when the engine failed. */
  subsetPmo(request: SubsetRequest): Promise<SubsetOutcome | null>;
  /** One table of the opened PMO or its subset. `null` when there is none or the engine failed. */
  workingPmoTable(request: {
    readonly source: WorkingSource;
    readonly id: TableId;
    readonly format: TableFormat;
  }): Promise<TableFile | null>;
  /** A summary of the opened PMO or its subset. `null` when there is none or the engine failed. */
  workingPmoSummary(request: {
    readonly source: WorkingSource;
    readonly minReads: number;
  }): Promise<PmoSummary | null>;
  /** The opened PMO or its subset grouped by a specimen field. `null` when there is none or the engine failed. */
  workingPmoGroups(request: {
    readonly source: WorkingSource;
    readonly minReads: number;
    readonly key: GroupKey;
  }): Promise<GroupComparison | null>;
  /** The subset as a file. `null` when there is none or the engine failed. */
  workingPmoFile(request: { readonly gzip: boolean }): Promise<PmoFile | null>;
  /** Reports a publishing step, for usage counts. Changes nothing. */
  notePublishing(event: PublishingEvent): void;
  /** Runs any scheduled build and save now, the save without waiting for the build. */
  flush(): Promise<void>;
  /**
   * Starts saving the draft now, without waiting for anything. Call when the
   * page is hidden or closed: the page may be gone before a build finishes.
   */
  saveNow(): Promise<void>;
  /**
   * Makes this tab the one that edits the draft: the other tab saves and
   * steps back, and the draft is read again from storage here.
   */
  takeOverEditing(): Promise<void>;
}

/** Everything in the store. */
export interface AppState {
  readonly draft: Draft;
  readonly build: BuildState;
  readonly persistence: PersistenceState;
  readonly restore: RestoreReport;
  /** Imports in progress or failed, keyed by `slotKey`. */
  readonly imports: Readonly<Record<string, ImportState>>;
  readonly savedPanels: SavedPanelsState;
  readonly example: ExampleState;
  /** Whether the engine's worker is running, or stopped and why. */
  readonly engine: EngineState;
  /** Whether this tab edits the draft, or another tab does. */
  readonly editing: EditingState;
  readonly actions: AppActions;
}

/** The store. */
export type AppStore = StoreApi<AppState>;

/** What {@link createAppStore} needs. */
export interface AppStoreOptions {
  readonly engine: Engine;
  readonly storage: DraftStorage;
  /** Wait after the last change before building. Default 200 ms. */
  readonly rebuildDelayMs?: number;
  /** Wait after the last change before saving. Default 600 ms. */
  readonly saveDelayMs?: number;
  /** Fetches an example file. Default: `fetch` from the app's own origin, relative to the page. */
  readonly fetchExample?: (path: string) => Promise<Blob>;
  /** Default: the real function from `@/domain/matching`. */
  readonly suggestMapping?: (
    fieldSet: FieldSetSpec,
    columns: readonly string[],
  ) => MappingSuggestion;
  /** Default: the real function from `@/domain/fields`. */
  readonly getFieldSet?: (id: FieldSetId) => FieldSetSpec;
  /** Which tab edits the draft. Default: this one, always. */
  readonly editorLock?: EditorLock;
}

const EMPTY_MAPPING: ColumnMapping = { fields: {}, additionalColumns: [] };

async function fetchFromOrigin(path: string): Promise<Blob> {
  const response = await fetch(path);
  const status = response.status;
  if (!response.ok) throw new Error(t`${path} could not be fetched (${status}).`);
  return response.blob();
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((column, index) => column === b[index]);
}

/**
 * Drops references to columns that the new table in a slot does not have:
 * run name, grouping and method columns, and extra representative columns.
 */
function forgetMissingColumns(draft: Draft, slot: TableSlot, columns: readonly string[]): Draft {
  const keep = (column: string | null): string | null =>
    column !== null && columns.includes(column) ? column : null;
  switch (slot.section) {
    case "microhaplotypes":
      return {
        ...draft,
        microhaplotypes: {
          ...draft.microhaplotypes,
          runName: {
            ...draft.microhaplotypes.runName,
            column: keep(draft.microhaplotypes.runName.column),
          },
          representativeColumns: draft.microhaplotypes.representativeColumns.filter((c) =>
            columns.includes(c),
          ),
        },
      };
    case "readCounts":
      return slot.part === "totals"
        ? {
            ...draft,
            readCounts: {
              ...draft.readCounts,
              runName: {
                ...draft.readCounts.runName,
                column: keep(draft.readCounts.runName.column),
              },
            },
          }
        : draft;
    case "bioinformatics": {
      const bio = draft.bioinformatics;
      return slot.part === "methods"
        ? {
            ...draft,
            bioinformatics: {
              ...bio,
              methods: {
                ...bio.methods,
                table: { ...bio.methods.table, groupColumn: keep(bio.methods.table.groupColumn) },
              },
            },
          }
        : {
            ...draft,
            bioinformatics: {
              ...bio,
              runs: {
                ...bio.runs,
                table: { ...bio.runs.table, methodColumn: keep(bio.runs.table.methodColumn) },
              },
            },
          };
    }
    case "panel":
    case "specimens":
    case "librarySamples":
    case "project":
    case "sequencing":
      return draft;
    default:
      return draft;
  }
}

/** Creates the app store. Call `actions.initialise()` once (the provider does) to restore the saved draft. */
export function createAppStore(options: AppStoreOptions): AppStore {
  const { engine, storage } = options;
  const rebuildDelay = options.rebuildDelayMs ?? 200;
  const saveDelay = options.saveDelayMs ?? 600;
  const fetchExample = options.fetchExample ?? fetchFromOrigin;
  const suggest = options.suggestMapping ?? realSuggestMapping;
  const fieldSetOf = options.getFieldSet ?? realGetFieldSet;
  const editorLock = options.editorLock ?? createSoleEditorLock();

  let buildTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let buildRunning: Promise<void> | null = null;
  /** Saves that have started and not finished. Start over waits for them, so none writes after it. */
  const savesInFlight = new Set<Promise<void>>();
  let builtDraft: Draft | null = null;
  let savedDraft: Draft | null = null;
  let initialising: Promise<void> | null = null;
  let quiet = false;
  /** The latest import started for each slot, so an older one that finishes later is dropped. */
  const latestImport = new Map<string, number>();
  let importCount = 0;
  /** Counts builds as they start, so an older build that ends late cannot undo a newer one. */
  let buildCount = 0;
  /** The newest build whose result (or failure) is in the state. */
  let buildShown = 0;

  const emit = (event: AppEvent): void => {
    for (const listener of eventListeners.get(store) ?? []) {
      try {
        listener(event);
      } catch {
        // A listener (usage counts) must never break the app.
      }
    }
  };

  /** Notes an engine call that failed, and says so when the worker stopped. Returns the message. */
  const engineFailed = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    if (isEngineStoppedError(error)) {
      store.setState({ engine: { kind: "stopped", message } });
      emit({ kind: "engine-stopped" });
    }
    return message;
  };

  const suggestedMapping = (slot: TableSlot, columns: readonly string[]): ColumnMapping => {
    try {
      return suggest(fieldSetOf(fieldSetForSlot(slot)), columns).mapping;
    } catch {
      return EMPTY_MAPPING;
    }
  };

  /** Whether this tab may write the draft and its files. */
  const isEditor = (): boolean => store.getState().editing.kind === "editor";

  const persistenceAfterWrite = (result: {
    readonly ok: boolean;
    readonly reason?: string;
  }): PersistenceState => {
    if (!isEditor()) return { kind: "other-tab" };
    const availability = storage.availability();
    if (availability.kind === "session-only")
      return { kind: "session-only", reason: availability.reason };
    if (!result.ok)
      return { kind: "failed", reason: result.reason ?? t`The draft could not be saved.` };
    return { kind: "saved", savedAt: new Date().toISOString() };
  };

  /** An import that failed because the engine stopped or broke. */
  const stoppedOutcome = (error: unknown, fileName: string): ImportOutcome => {
    engineFailed(error);
    const failure: ImportFailure = isEngineStoppedError(error)
      ? { code: "engine-stopped" }
      : { code: "unexpected" };
    return {
      kind: "failed",
      notice: {
        severity: "error",
        code: `import/${failure.code}`,
        message: importFailureMessage(failure, fileName),
      },
      failure,
    };
  };

  const store = createStore<AppState>()((set, get) => {
    const setDraft = (recipe: (draft: Draft) => Draft): void => {
      const draft = get().draft;
      const next = recipe(draft);
      if (next !== draft) set({ draft: next });
    };

    const forgetTable = (tableId: string): void => {
      if (referencedTableIds(get().draft).includes(tableId)) return;
      void engine.dropTable(tableId);
      void storage.deleteFile(tableId);
    };

    const setImport = (slot: TableSlot, value: ImportState | null): void => {
      const key = slotKey(slot);
      const imports = { ...get().imports };
      if (value === null) delete imports[key];
      else imports[key] = value;
      set({ imports });
    };

    const refreshSavedPanels = async (): Promise<void> => {
      set({ savedPanels: { kind: "ready", panels: await storage.listSavedPanels() } });
    };

    const clearDraftAndFiles = async (): Promise<void> => {
      clearTimeout(buildTimer);
      clearTimeout(saveTimer);
      // A save already under way would otherwise write the draft back after it is cleared.
      await Promise.all(savesInFlight);
      const ids = referencedTableIds(get().draft);
      await Promise.all(ids.map((id) => engine.dropTable(id)));
      const result = isEditor() ? await storage.clearDraft() : { ok: true };
      // Quietly: storage is now empty, and the change listener would schedule a
      // save that writes the new empty draft straight back into it.
      quiet = true;
      try {
        set({
          draft: createEmptyDraft(),
          imports: {},
          persistence: persistenceAfterWrite(result),
        });
      } finally {
        quiet = false;
      }
      savedDraft = get().draft;
      scheduleBuild(rebuildDelay);
    };

    /**
     * Reads the saved draft and its files into this tab, and starts a build.
     * Only the editing tab tidies storage: another tab's files may belong to
     * a draft it has not saved yet.
     */
    const restoreFromStorage = async (
      availability: Awaited<ReturnType<DraftStorage["probe"]>>,
      /** The draft to keep when nothing is saved. */
      fallback: Draft,
    ): Promise<void> => {
      const loaded = await storage.loadDraft();
      let restore: RestoreReport = { kind: "fresh" };
      let draft = fallback;
      if (loaded.kind === "rejected") {
        restore = { kind: "set-aside", problem: loaded.problem };
        emit({ kind: "draft-set-aside" });
      }
      if (loaded.kind === "loaded") {
        draft = loaded.draft;
        const missingFiles: string[] = [];
        const ids = referencedTableIds(draft);
        await Promise.all(
          ids.map(async (id) => {
            const ref = findTableRef(draft, id);
            if (ref === null) return;
            const file = await storage.loadFile(id);
            if (file === null) missingFiles.push(ref.fileName);
            else
              await engine
                .restoreFile({
                  tableId: id,
                  file,
                  fileName: ref.fileName,
                  sheetName: ref.sheetName,
                })
                .catch(engineFailed);
          }),
        );
        if (isEditor()) await storage.pruneFiles(ids);
        restore = { kind: "restored", savedAt: loaded.savedAt, missingFiles };
        emit({ kind: "draft-restored" });
      }
      quiet = true;
      savedDraft = draft;
      set({
        draft,
        imports: {},
        restore,
        persistence: !isEditor()
          ? { kind: "other-tab" }
          : availability.kind === "session-only"
            ? { kind: "session-only", reason: availability.reason }
            : { kind: "saved", savedAt: loaded.kind === "loaded" ? loaded.savedAt : null },
      });
      quiet = false;
      scheduleBuild(0);
    };

    const importInto = async (input: {
      readonly slot: TableSlot;
      readonly file: Blob;
      readonly fileName: string | undefined;
      readonly route: "upload" | "example";
    }): Promise<ImportOutcome> => {
      const { slot, file, route } = input;
      const name =
        input.fileName ?? ("name" in file && typeof file.name === "string" ? file.name : "table");
      setImport(slot, { kind: "importing", fileName: name });
      importCount += 1;
      const ticket = importCount;
      latestImport.set(slotKey(slot), ticket);
      let outcome: ImportOutcome;
      try {
        outcome = await engine.importFile({ file, fileName: name });
      } catch (error) {
        outcome = stoppedOutcome(error, name);
      }
      if (latestImport.get(slotKey(slot)) !== ticket) {
        // A newer import into this slot started meanwhile; it wins, whenever it finishes.
        if (outcome.kind === "imported") void engine.dropTable(outcome.table.id).catch(() => {});
        return outcome;
      }
      if (outcome.kind === "failed") {
        setImport(slot, {
          kind: "failed",
          notice: outcome.notice,
          failure: outcome.failure,
          fileName: name,
        });
        emit({ kind: "import-failed", slot, route, failure: outcome.failure });
        return outcome;
      }
      const table = outcome.table;
      if (!slotExists(get().draft, slot)) {
        void engine.dropTable(table.id).catch(() => {});
        setImport(slot, null);
        return outcome;
      }
      if (isEditor()) {
        const saved = await storage.saveFile(table.id, file);
        if (!saved.ok || storage.availability().kind === "session-only") {
          set({ persistence: persistenceAfterWrite(saved) });
        }
      }
      const previous = getSlotTable(get().draft, slot);
      const mapped: MappedTable = {
        table,
        mapping: suggestedMapping(slot, table.columns),
        confirmedMatches: {},
      };
      setDraft((draft) =>
        forgetMissingColumns(setSlotTable(draft, slot, mapped), slot, table.columns),
      );
      setImport(slot, null);
      if (previous !== null) forgetTable(previous.table.id);
      emit({ kind: "table-imported", slot, route, table });
      return outcome;
    };

    const actions: AppActions = {
      initialise() {
        initialising ??= (async () => {
          set({ persistence: { kind: "restoring" }, restore: { kind: "pending" } });
          const availability = await storage.probe();
          const claim = await editorLock.claim();
          set({ editing: { kind: claim === "editor" ? "editor" : "other-tab" } });
          await restoreFromStorage(availability, get().draft);
          await refreshSavedPanels();
        })();
        return initialising;
      },

      importFile(slot, file, fileName) {
        return importInto({ slot, file, fileName, route: "upload" });
      },

      async chooseSheet(slot, sheetName) {
        const current = getSlotTable(get().draft, slot);
        if (current === null) return null;
        let outcome: ImportOutcome;
        try {
          outcome = await engine.chooseSheet(current.table.id, sheetName);
        } catch (error) {
          outcome = stoppedOutcome(error, current.table.fileName);
        }
        if (outcome.kind === "failed") {
          setImport(slot, {
            kind: "failed",
            notice: outcome.notice,
            failure: outcome.failure,
            fileName: current.table.fileName,
          });
          return outcome;
        }
        const table = outcome.table;
        const mapping = sameColumns(table.columns, current.table.columns)
          ? current.mapping
          : suggestedMapping(slot, table.columns);
        setDraft((draft) =>
          getSlotTable(draft, slot)?.table.id === table.id
            ? forgetMissingColumns(
                setSlotTable(draft, slot, {
                  table,
                  mapping,
                  // Confirmations hold while the mapping does.
                  confirmedMatches:
                    mapping === current.mapping ? (current.confirmedMatches ?? {}) : {},
                }),
                slot,
                table.columns,
              )
            : draft,
        );
        setImport(slot, null);
        return outcome;
      },
      removeTable(slot) {
        const current = getSlotTable(get().draft, slot);
        if (current === null) return;
        setDraft((draft) => setSlotTable(draft, slot, null));
        setImport(slot, null);
        forgetTable(current.table.id);
      },

      setMapping(slot, mapping) {
        const current = getSlotTable(get().draft, slot);
        if (current === null || current.mapping === mapping) return;
        setDraft((draft) => setSlotTable(draft, slot, { ...current, mapping }));
        emit({ kind: "mapping-edited", slot });
      },

      confirmMatch(slot, fieldKey, column) {
        setDraft((draft) => confirmSlotMatch(draft, slot, { fieldKey, column }));
      },

      updateSection(section, recipe) {
        setDraft((draft) => {
          const current = draft[section];
          const next = recipe(current);
          return next === current ? draft : { ...draft, [section]: next };
        });
      },

      addItem(path) {
        const { draft, id } = addListItem(get().draft, path);
        set({ draft });
        return id;
      },

      removeItem(path, id) {
        const before = get().draft;
        setDraft((draft) => removeListItem(draft, path, id));
        for (const tableId of referencedTableIds(before)) forgetTable(tableId);
      },

      moveItem(path, id, toIndex) {
        setDraft((draft) => moveListItem(draft, path, id, toIndex));
      },

      updateItem(update) {
        setDraft((draft) => updateListItem(draft, update));
      },

      setValue(change) {
        setDraft((draft) => setRecordValue(draft, change));
      },

      setMode(change) {
        setDraft((draft) => applyModeChange(draft, change));
      },

      async savePanelToLibrary(panelId, saveOptions = {}) {
        const { name, replace } = saveOptions;
        await actions.flush();
        const entry = get().draft.panel.panels.find((panel) => panel.id === panelId);
        if (entry === undefined)
          return { ok: false, reason: t`That panel is no longer in the draft.` };
        const fragment = await engine.getPanelFragment(panelId);
        if (fragment === null) {
          return {
            ok: false,
            reason: t`The panel has not built yet. Fix its problems, then save it.`,
          };
        }
        const label = (
          name ?? (entry.source === "saved" ? (entry.saved?.name ?? "") : entry.name)
        ).trim();
        const result = await storage.savePanel({
          name: label === "" ? "Panel" : label,
          fragment,
          ...(replace === undefined ? {} : { replaceId: replace }),
        });
        await refreshSavedPanels();
        if (!result.ok) return result;
        if (storage.availability().kind === "session-only") {
          return {
            ok: false,
            reason: t`The panel is saved for this session only, because this browser is not letting the app keep data.`,
          };
        }
        return { ok: true };
      },

      async applySavedPanel(panelId, savedPanelId) {
        const saved = await storage.loadSavedPanel(savedPanelId);
        if (saved === null)
          return {
            ok: false,
            reason: t`That saved panel could not be found. It may have been deleted.`,
          };
        setDraft((draft) =>
          updateListItem(draft, {
            list: "panels",
            id: panelId,
            recipe: (panel) => ({
              ...panel,
              source: "saved",
              saved: {
                savedPanelId: saved.id,
                name: saved.name,
                savedAt: saved.savedAt,
                fragment: saved.fragment,
              },
            }),
          }),
        );
        emit({ kind: "saved-panel-applied", targets: saved.targetCount });
        return { ok: true };
      },

      async deleteSavedPanel(savedPanelId) {
        await storage.deleteSavedPanel(savedPanelId);
        await refreshSavedPanels();
      },

      async startOver() {
        await clearDraftAndFiles();
        scheduleBuild(0);
      },

      async loadExample() {
        set({ example: { kind: "loading" } });
        try {
          const files = await Promise.all(
            EXAMPLE_FILES.map(async (example: ExampleFile) => ({
              example,
              file: await fetchExample(example.path),
            })),
          );
          await clearDraftAndFiles();
          const panelId = get().draft.panel.panels[0]?.id ?? "";
          for (const { example, file } of files) {
            const slot: TableSlot =
              example.slot.section === "panel" ? { ...example.slot, panelId } : example.slot;
            // One at a time, in order: each import changes the draft the next one reads.
            // oxlint-disable-next-line no-await-in-loop
            const outcome = await importInto({
              slot,
              file,
              fileName: example.fileName,
              route: "example",
            });
            if (outcome.kind === "failed") throw new Error(outcome.notice.message);
          }
          const panelName = await examplePanelName();
          actions.updateItem({
            list: "panels",
            id: panelId,
            recipe: (panel) => ({ ...panel, name: panelName }),
          });
          set({ example: { kind: "idle" } });
          return { ok: true };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          const message = t`The example could not be loaded: ${detail}`;
          set({ example: { kind: "failed", message } });
          return { ok: false, reason: message };
        }
      },

      async previewRows(request) {
        try {
          return await engine.previewRows(request);
        } catch (error) {
          return { kind: "failed", message: engineFailed(error) };
        }
      },

      async distinctValues(request) {
        try {
          return await engine.distinctValues(request);
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      async downloadPmo(downloadOptions) {
        await actions.flush();
        let file: PmoFile | null;
        try {
          file = await engine.getPmoFile(downloadOptions);
        } catch (error) {
          engineFailed(error);
          return null;
        }
        if (file !== null) {
          emit({
            kind: "pmo-downloaded",
            gzip: downloadOptions?.gzip ?? true,
            bytes: file.blob.size,
          });
        }
        return file;
      },

      async pmoFileSize(sizeOptions) {
        await actions.flush();
        try {
          return await engine.getPmoFileSize(sizeOptions);
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      async previewPmo(previewOptions) {
        await actions.flush();
        try {
          return await engine.getPmoText(previewOptions);
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      async checkPmoFile(file) {
        let check: PmoFileCheck | null = null;
        try {
          check = await engine.checkPmoFile(file);
        } catch (error) {
          engineFailed(error);
        }
        emit({ kind: "pmo-file-checked", result: fileCheckResult(check) });
        return check;
      },

      async openPmo(file, fileName) {
        try {
          return await engine.openPmo(file, fileName);
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      async openBuiltPmo() {
        try {
          await actions.flush();
          return await engine.openBuiltPmo();
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      async subsetPmo(request) {
        try {
          return await engine.subsetPmo(request);
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      async workingPmoTable(request) {
        try {
          return await engine.workingPmoTable(request);
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      async workingPmoSummary(request) {
        try {
          return await engine.workingPmoSummary(request);
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      async workingPmoGroups(request) {
        try {
          return await engine.workingPmoGroups(request);
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      async workingPmoFile(request) {
        try {
          return await engine.workingPmoFile(request);
        } catch (error) {
          engineFailed(error);
          return null;
        }
      },

      notePublishing(event) {
        emit(event);
      },

      async flush() {
        // The save starts first and does not wait for the build.
        const saving = actions.saveNow();
        const building =
          get().draft !== builtDraft ? runBuild() : (buildRunning ?? Promise.resolve());
        await Promise.all([saving, building]);
      },

      async saveNow() {
        if (isEditor() && get().draft !== savedDraft) {
          await runSave();
          return;
        }
        await Promise.all(savesInFlight);
      },

      async takeOverEditing() {
        if (isEditor()) return;
        set({ editing: { kind: "checking" } });
        await editorLock.takeOver();
        set({ editing: { kind: "editor" } });
        await restoreFromStorage(await storage.probe(), createEmptyDraft());
      },
    };

    editorLock.onStepBack(async () => {
      // Save what this tab has before the other tab reads the draft.
      await actions.saveNow();
      clearTimeout(saveTimer);
      set({ editing: { kind: "other-tab" }, persistence: { kind: "other-tab" } });
    });

    /** The panel name the example's library sample table uses, so the two link. */
    const examplePanelName = async (): Promise<string> => {
      const table = get().draft.librarySamples.table;
      const column = table?.mapping.fields["panelName"] ?? null;
      if (table === null || column === null) return "Mad4hatter";
      const values = await engine.distinctValues({ tableId: table.table.id, column, limit: 1 });
      return values?.values[0] ?? "Mad4hatter";
    };

    return {
      draft: createEmptyDraft(),
      build: { phase: "idle", view: null },
      persistence: { kind: "saved", savedAt: null },
      restore: { kind: "pending" },
      imports: {},
      savedPanels: { kind: "loading" },
      example: { kind: "idle" },
      engine: { kind: "running" },
      editing: { kind: "checking" },
      actions,
    };
  });

  const runBuild = (): Promise<void> => {
    clearTimeout(buildTimer);
    const draft = store.getState().draft;
    builtDraft = draft;
    buildCount += 1;
    const ticket = buildCount;
    const run = (async () => {
      const previous = store.getState().build.view;
      store.setState({ build: { phase: "pending", view: previous } });
      try {
        const outcome = await engine.build(draft);
        // A newer build's result is already shown: this one is out of date.
        if (outcome.kind === "superseded" || ticket < buildShown) return;
        buildShown = ticket;
        const current = store.getState();
        store.setState({
          build: {
            phase: current.draft === draft && ticket === buildCount ? "idle" : "pending",
            view: outcome.view,
          },
          ...(current.engine.kind === "stopped" ? { engine: { kind: "running" } } : {}),
        });
      } catch (error) {
        const message = engineFailed(error);
        // Only the newest build may say the build failed: a newer one is
        // running or has finished, and its result stands.
        if (ticket !== buildCount) return;
        buildShown = ticket;
        store.setState({
          build: {
            phase: "failed",
            view: store.getState().build.view,
            message: isEngineStoppedError(error)
              ? message
              : t`Something went wrong while working out the PMO: ${message}`,
          },
        });
      }
    })();
    buildRunning = run;
    return run;
  };

  const runSave = (): Promise<void> => {
    clearTimeout(saveTimer);
    if (store.getState().editing.kind !== "editor") return Promise.resolve();
    const draft = store.getState().draft;
    savedDraft = draft;
    const run = (async () => {
      const result = await storage.saveDraft(draft);
      const availability = storage.availability();
      let persistence: PersistenceState;
      if (availability.kind === "session-only")
        persistence = { kind: "session-only", reason: availability.reason };
      else if (!result.ok) {
        persistence = { kind: "failed", reason: result.reason };
        emit({ kind: "save-failed" });
      } else
        persistence =
          store.getState().draft === draft
            ? { kind: "saved", savedAt: new Date().toISOString() }
            : { kind: "unsaved" };
      store.setState({ persistence });
    })();
    savesInFlight.add(run);
    void run.finally(() => savesInFlight.delete(run));
    return run;
  };

  function scheduleBuild(delay: number): void {
    clearTimeout(buildTimer);
    const view = store.getState().build.view;
    if (store.getState().build.phase !== "pending")
      store.setState({ build: { phase: "pending", view } });
    buildTimer = setTimeout(() => void runBuild(), delay);
  }

  const scheduleSave = (): void => {
    clearTimeout(saveTimer);
    if (store.getState().editing.kind !== "editor") return;
    const persistence = store.getState().persistence;
    if (persistence.kind !== "session-only" && persistence.kind !== "restoring") {
      store.setState({ persistence: { kind: "unsaved" } });
    }
    // While the page is hidden it may be closed at any moment, so save at once.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void runSave();
      return;
    }
    saveTimer = setTimeout(() => void runSave(), saveDelay);
  };

  store.subscribe((state, previous) => {
    if (quiet || state.draft === previous.draft) return;
    scheduleBuild(rebuildDelay);
    scheduleSave();
  });

  return store;
}

function findTableRef(draft: Draft, tableId: string): TableRef | null {
  return (
    listFilledSlots(draft).find((filled) => filled.table.table.id === tableId)?.table.table ?? null
  );
}

/** The suggestions of the latest build, or none. */
export function selectSuggestions(state: AppState): Suggestions {
  return state.build.view?.suggestions ?? NO_SUGGESTIONS;
}
