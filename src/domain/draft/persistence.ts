/**
 * Saving the draft, its imported files and the saved-panel library in the
 * browser, through IndexedDB (`idb-keyval`).
 *
 * Three key-value stores, each its own database so `idb-keyval` can create it:
 *
 * - drafts: the draft under `draft`, wrapped with the time it was saved, and
 *   the most recent draft that failed the guard under `rejected:<time>`. It
 *   is reported in the session that set it aside, and dropped at the first
 *   save of a later session, once the user has started a new draft, or when
 *   the user starts over.
 * - files: each imported file's original bytes, as a Blob keyed by table id.
 * - panels: saved panels keyed by id.
 *
 * Nothing here throws. When IndexedDB is missing or fails (a private window,
 * blocked storage), storage falls back to memory for the session and says so
 * through {@link DraftStorage.availability}.
 */
import { t } from "@lingui/core/macro";
import { createStore, del, get, keys, promisifyRequest } from "idb-keyval";

import { checkDraft } from "./guard";
import { describeError, isBlob, isJsonValue, newId, type Draft, type JsonValue } from "./model";
import { panelContentKey } from "./panels";

/** A minimal key-value store. Both IndexedDB and memory implement it. */
export interface KeyValueBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Opens one named key-value store. */
export type BackendFactory = (name: StoreName) => KeyValueBackend;

/** The three stores storage uses. */
export type StoreName = "drafts" | "files" | "panels";

/** Whether the draft will outlive the session. */
export type StorageAvailability =
  | { readonly kind: "persistent" }
  | {
      readonly kind: "session-only";
      /** Plain-language reason, for the user. */
      readonly reason: string;
    };

/** What {@link DraftStorage.loadDraft} found. */
export type LoadDraftResult =
  | { readonly kind: "none" }
  | { readonly kind: "loaded"; readonly draft: Draft; readonly savedAt: string }
  | {
      /** A stored draft failed the guard. It was moved aside under `rejectedKey`, not deleted. */
      readonly kind: "rejected";
      readonly problem: string;
      readonly rejectedKey: string;
    };

/** The result of a write. A failed write leaves the session working; only keeping it is lost. */
export type WriteResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** A saved panel without its fragment, for listing. */
export interface SavedPanelSummary {
  readonly id: string;
  readonly name: string;
  /** ISO 8601 time it was saved. */
  readonly savedAt: string;
  readonly targetCount: number;
  /** `panelContentKey` of the fragment, to tell whether a built panel is already saved. */
  readonly contentKey: string;
}

/** A saved panel: a built panel fragment the user chose to keep. */
export interface SavedPanel extends SavedPanelSummary {
  /** The fragment as `panelInfoTableToPmo` built it. */
  readonly fragment: JsonValue;
}

/** Persistence for the draft, its files and the saved-panel library. */
export interface DraftStorage {
  /** Whether storage is persistent. Settles after the first operation; probe with {@link DraftStorage.probe}. */
  availability(): StorageAvailability;
  /** Tries IndexedDB once and reports whether the draft will be kept. */
  probe(): Promise<StorageAvailability>;
  loadDraft(): Promise<LoadDraftResult>;
  saveDraft(draft: Draft): Promise<WriteResult>;
  /** Removes the draft, any draft set aside as unreadable, and every stored file. Saved panels stay. */
  clearDraft(): Promise<WriteResult>;
  saveFile(tableId: string, file: Blob): Promise<WriteResult>;
  /** The stored bytes of an imported file, or `null` when they are not stored. */
  loadFile(tableId: string): Promise<Blob | null>;
  deleteFile(tableId: string): Promise<WriteResult>;
  /** Deletes every stored file whose id is not in `keep`. */
  pruneFiles(keep: readonly string[]): Promise<WriteResult>;
  listSavedPanels(): Promise<SavedPanelSummary[]>;
  /** Saves a panel as a new entry, or in place of the saved panel with id `replaceId`. */
  savePanel(input: {
    readonly name: string;
    readonly fragment: JsonValue;
    readonly replaceId?: string;
  }): Promise<
    | { readonly ok: true; readonly panel: SavedPanel }
    | { readonly ok: false; readonly reason: string }
  >;
  loadSavedPanel(id: string): Promise<SavedPanel | null>;
  deleteSavedPanel(id: string): Promise<WriteResult>;
}

/** Options for {@link createDraftStorage}. */
export interface DraftStorageOptions {
  /** Opens the IndexedDB stores. Defaults to `idb-keyval` stores; tests inject failing ones. */
  readonly openBackend?: BackendFactory;
  /** Prefix of the database names. Default `pmo-builder`. */
  readonly databasePrefix?: string;
  /** The current time, for saved-at stamps. */
  readonly now?: () => Date;
}

const DRAFT_KEY = "draft";
const REJECTED_PREFIX = "rejected:";

/** Deletes every set-aside draft except `keep`. */
async function dropRejected(backend: KeyValueBackend, keep?: string): Promise<void> {
  const stale = (await backend.keys()).filter(
    (key) => key.startsWith(REJECTED_PREFIX) && key !== keep,
  );
  await Promise.all(stale.map((key) => backend.del(key)));
}
const DRAFT_ENVELOPE = "pmo-builder-draft";

/** A key-value backend in memory. Used when IndexedDB is unavailable, and in tests. */
export function createMemoryBackend(): KeyValueBackend {
  const data = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    del: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
  };
}

function idbBackendFactory(prefix: string): BackendFactory {
  return (name) => {
    // createStore opens the database at once and throws if IndexedDB is missing;
    // open it lazily so that failure surfaces as a rejected promise.
    let store: ReturnType<typeof createStore> | undefined;
    const open = (): ReturnType<typeof createStore> => {
      store ??= createStore(`${prefix}-${name}`, name);
      return store;
    };
    return {
      get: async (key) => get<unknown>(key, open()),
      // Commit at once rather than when the browser gets round to it: a save
      // started as the page is closed or reloaded must not wait for the page.
      set: async (key, value) =>
        open()("readwrite", async (objectStore) => {
          objectStore.put(value, key);
          objectStore.transaction.commit();
          await promisifyRequest(objectStore.transaction);
        }),
      del: async (key) => del(key, open()),
      keys: async () => (await keys<IDBValidKey>(open())).filter((key) => typeof key === "string"),
    };
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSavedPanel(value: unknown): SavedPanel | null {
  if (!isRecord(value)) return null;
  const { id, name, savedAt, targetCount, fragment } = value;
  if (typeof id !== "string" || typeof name !== "string" || typeof savedAt !== "string")
    return null;
  if (typeof targetCount !== "number" || !isJsonValue(fragment)) return null;
  return { id, name, savedAt, targetCount, contentKey: panelContentKey(fragment), fragment };
}

function countTargets(fragment: JsonValue): number {
  if (!isRecord(fragment)) return 0;
  const targets = fragment["target_info"];
  return Array.isArray(targets) ? targets.length : 0;
}

/**
 * Creates draft storage on IndexedDB, falling back to memory for the session
 * when IndexedDB cannot be used. Every method resolves; none rejects.
 */
export function createDraftStorage(options: DraftStorageOptions = {}): DraftStorage {
  const openBackend =
    options.openBackend ?? idbBackendFactory(options.databasePrefix ?? "pmo-builder");
  const now = options.now ?? (() => new Date());
  let availability: StorageAvailability = { kind: "persistent" };
  let probed: Promise<StorageAvailability> | undefined;
  const memory: Record<StoreName, KeyValueBackend> = {
    drafts: createMemoryBackend(),
    files: createMemoryBackend(),
    panels: createMemoryBackend(),
  };
  const persistent: Partial<Record<StoreName, KeyValueBackend>> = {};
  /** Whether this session set a draft aside. If so, it stays until a later session saves. */
  let setAsideThisSession = false;
  /** Whether set-aside drafts from earlier sessions have been dropped yet. */
  let rejectedChecked = false;

  const fallBack = (error: unknown): void => {
    if (availability.kind === "session-only") return;
    const detail = describeError(error);
    availability = {
      kind: "session-only",
      reason: t({
        message: `This browser is not letting the app save data (${detail}). Your work is kept until you close this tab.`,
        comment: "{detail} is the browser's own error message.",
      }),
    };
  };

  const probe = (): Promise<StorageAvailability> => {
    probed ??= (async () => {
      try {
        const backend = openBackend("drafts");
        await backend.set("probe", 1);
        await backend.get("probe");
        await backend.del("probe");
        persistent.drafts = backend;
        persistent.files = openBackend("files");
        persistent.panels = openBackend("panels");
      } catch (error) {
        fallBack(error);
      }
      return availability;
    })();
    return probed;
  };

  /** Runs an operation on the persistent store, or on memory once storage has failed. */
  const withBackend = async <T>(
    name: StoreName,
    run: (backend: KeyValueBackend) => Promise<T>,
  ): Promise<T> => {
    await probe();
    const backend = persistent[name];
    if (availability.kind === "persistent" && backend !== undefined) {
      try {
        return await run(backend);
      } catch (error) {
        fallBack(error);
      }
    }
    return run(memory[name]);
  };

  const write = async (
    name: StoreName,
    run: (backend: KeyValueBackend) => Promise<void>,
  ): Promise<WriteResult> => {
    try {
      await withBackend(name, run);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: describeError(error) };
    }
  };

  return {
    availability: () => availability,
    probe,

    async loadDraft() {
      try {
        const stored = await withBackend("drafts", (backend) => backend.get(DRAFT_KEY));
        if (stored === undefined) return { kind: "none" };
        const envelope = isRecord(stored) && stored["format"] === DRAFT_ENVELOPE ? stored : null;
        const result = checkDraft(envelope === null ? stored : envelope["draft"]);
        if (result.ok) {
          const savedAt =
            envelope !== null && typeof envelope["savedAt"] === "string" ? envelope["savedAt"] : "";
          return { kind: "loaded", draft: result.draft, savedAt };
        }
        const rejectedKey = `${REJECTED_PREFIX}${now().toISOString()}`;
        setAsideThisSession = true;
        await withBackend("drafts", async (backend) => {
          await backend.set(rejectedKey, stored);
          await backend.del(DRAFT_KEY);
          // Only the most recent set-aside draft is kept.
          await dropRejected(backend, rejectedKey);
        });
        return { kind: "rejected", problem: result.problem, rejectedKey };
      } catch (error) {
        fallBack(error);
        return { kind: "none" };
      }
    },

    saveDraft: (draft) =>
      write("drafts", async (backend) => {
        await backend.set(DRAFT_KEY, {
          format: DRAFT_ENVELOPE,
          savedAt: now().toISOString(),
          draft,
        });
        // A draft set aside in an earlier session was reported then; the
        // user has now started a new one, so it can go.
        if (!rejectedChecked && !setAsideThisSession) {
          rejectedChecked = true;
          await dropRejected(backend);
        }
      }),

    clearDraft: async () => {
      const draftResult = await write("drafts", async (backend) => {
        await backend.del(DRAFT_KEY);
        await dropRejected(backend);
      });
      setAsideThisSession = false;
      rejectedChecked = true;
      const filesResult = await write("files", async (backend) => {
        await Promise.all((await backend.keys()).map((key) => backend.del(key)));
      });
      return draftResult.ok ? filesResult : draftResult;
    },

    saveFile: (tableId, file) => write("files", (backend) => backend.set(tableId, file)),

    async loadFile(tableId) {
      try {
        const stored = await withBackend("files", (backend) => backend.get(tableId));
        return isBlob(stored) ? stored : null;
      } catch {
        return null;
      }
    },

    deleteFile: (tableId) => write("files", (backend) => backend.del(tableId)),

    pruneFiles: (keep) =>
      write("files", async (backend) => {
        const wanted = new Set(keep);
        const unwanted = (await backend.keys()).filter((key) => !wanted.has(key));
        await Promise.all(unwanted.map((key) => backend.del(key)));
      }),

    async listSavedPanels() {
      try {
        return await withBackend("panels", async (backend) => {
          const stored = await Promise.all((await backend.keys()).map((key) => backend.get(key)));
          const panels: SavedPanelSummary[] = stored.flatMap((value) => {
            const panel = toSavedPanel(value);
            if (panel === null) return [];
            const { id, name, savedAt, targetCount, contentKey } = panel;
            return [{ id, name, savedAt, targetCount, contentKey }];
          });
          return panels.toSorted((a, b) => b.savedAt.localeCompare(a.savedAt));
        });
      } catch {
        return [];
      }
    },

    async savePanel(input) {
      const panel: SavedPanel = {
        id: input.replaceId ?? newId(),
        name: input.name,
        savedAt: now().toISOString(),
        targetCount: countTargets(input.fragment),
        contentKey: panelContentKey(input.fragment),
        fragment: input.fragment,
      };
      const result = await write("panels", (backend) => backend.set(panel.id, panel));
      return result.ok ? { ok: true, panel } : result;
    },

    async loadSavedPanel(id) {
      try {
        return toSavedPanel(await withBackend("panels", (backend) => backend.get(id)));
      } catch {
        return null;
      }
    },

    deleteSavedPanel: (id) => write("panels", (backend) => backend.del(id)),
  };
}
