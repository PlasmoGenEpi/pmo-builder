/**
 * The main thread's side of the engine worker: an {@link Engine} whose
 * methods post calls to the worker and resolve with its checked answers.
 *
 * The engine itself, with pmotools-ts, loads in the worker. This module must
 * import it only dynamically, for the fallback when no worker can be made,
 * so that none of it lands in the main bundle.
 */
import { t } from "@lingui/core/macro";

import { currentLocale } from "@/i18n/languages";
import { isBlob, isJsonValue, type Draft } from "@/domain/draft";
import type { WorkingPmoAnswer, WorkingPmoKind, WorkingPmoValues } from "@/domain/tools/types";
import { SECTION_IDS, type SectionId } from "@/domain/types";

import {
  isResultMessage,
  type CallMessage,
  type Endpoint,
  type EngineArgs,
  type EngineMethod,
  type EngineResult,
  type ResultMessage,
} from "./protocol";
import type { BuildRequestOptions, Engine, RestoreFileInput } from "./types";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasKind(
  value: unknown,
  kinds: readonly string[],
): value is Readonly<Record<string, unknown>> {
  return isRecord(value) && typeof value["kind"] === "string" && kinds.includes(value["kind"]);
}

function isImportOutcome(value: unknown): boolean {
  if (!hasKind(value, ["imported", "failed"])) return false;
  return value["kind"] === "imported"
    ? isRecord(value["table"]) && typeof value["table"]["id"] === "string"
    : isRecord(value["notice"]) && typeof value["notice"]["message"] === "string";
}

/** The kinds of answer to a request about the working PMO. */
const WORKING_PMO_RESULTS = ["ok", "not-open", "no-subset", "stale", "failed"];

/** Shape checks for the value of each kind of working PMO request that succeeded. */
const WORKING_PMO_VALUES: {
  readonly [K in WorkingPmoKind]: (value: unknown) => value is WorkingPmoValues[K];
} = {
  open: (value): value is WorkingPmoValues["open"] => hasKind(value, ["opened", "refused"]),
  close: (value): value is null => value === null,
  summary: (value): value is WorkingPmoValues["summary"] =>
    isRecord(value) && Array.isArray(value["samples"]) && Array.isArray(value["targets"]),
  table: (value): value is WorkingPmoValues["table"] =>
    isRecord(value) && typeof value["fileName"] === "string" && typeof value["text"] === "string",
  tables: (value): value is WorkingPmoValues["tables"] =>
    isRecord(value) && isBlob(value["blob"]) && typeof value["fileName"] === "string",
  groupFields: (value): value is WorkingPmoValues["groupFields"] =>
    Array.isArray(value) &&
    value.every((field) => isRecord(field) && typeof field["key"] === "string"),
  groups: (value): value is WorkingPmoValues["groups"] =>
    isRecord(value) && Array.isArray(value["groups"]) && Array.isArray(value["targets"]),
};

/** Whether `value` is an answer to a working PMO request of kind `kind`. */
function isWorkingPmoAnswer<K extends WorkingPmoKind>(
  kind: K,
  value: unknown,
): value is WorkingPmoAnswer<K> {
  if (!hasKind(value, WORKING_PMO_RESULTS)) return false;
  if (value["kind"] === "failed") return typeof value["message"] === "string";
  if (value["kind"] !== "ok") return true;
  const guard: (candidate: unknown) => candidate is WorkingPmoValues[K] = WORKING_PMO_VALUES[kind];
  return guard(value["value"]);
}

/**
 * Shape checks for each method's answer. They check the envelope of each
 * answer (its kind and key fields), which is what can go wrong between two
 * builds of the same app; the engine on the other side is this app's own.
 */
const RESULT_GUARDS: {
  readonly [M in EngineMethod]: (value: unknown) => value is EngineResult<M>;
} = {
  importFile: (value): value is EngineResult<"importFile"> => isImportOutcome(value),
  chooseSheet: (value): value is EngineResult<"chooseSheet"> => isImportOutcome(value),
  restoreFile: (value): value is undefined => value === undefined,
  dropTable: (value): value is undefined => value === undefined,
  dispose: (value): value is undefined => value === undefined,
  previewRows: (value): value is EngineResult<"previewRows"> =>
    hasKind(value, ["ready", "missing", "failed"]) &&
    (value["kind"] !== "ready" || Array.isArray(value["rows"])),
  distinctValues: (value): value is EngineResult<"distinctValues"> =>
    value === null ||
    (isRecord(value) && Array.isArray(value["values"]) && typeof value["truncated"] === "boolean"),
  build: (value): value is EngineResult<"build"> =>
    hasKind(value, ["built", "superseded"]) &&
    (value["kind"] === "superseded" ||
      (isRecord(value["view"]) && typeof value["view"]["revision"] === "number")),
  getPmoFile: (value): value is EngineResult<"getPmoFile"> =>
    value === null ||
    (isRecord(value) && isBlob(value["blob"]) && typeof value["fileName"] === "string"),
  getPmoFileSize: (value): value is EngineResult<"getPmoFileSize"> =>
    value === null ||
    (isRecord(value) && typeof value["fileName"] === "string" && typeof value["size"] === "number"),
  getPmoText: (value): value is EngineResult<"getPmoText"> =>
    value === null ||
    (isRecord(value) && typeof value["text"] === "string" && typeof value["length"] === "number"),
  getPanelFragment: (value): value is EngineResult<"getPanelFragment"> => isJsonValue(value),
  checkPmoFile: (value): value is EngineResult<"checkPmoFile"> =>
    hasKind(value, ["ready", "too-large", "unreadable", "wrong-version", "invalid"]),
  workingPmo: (value): value is EngineResult<"workingPmo"> =>
    hasKind(value, WORKING_PMO_RESULTS) &&
    (value["kind"] !== "failed" || typeof value["message"] === "string"),
  subsetPmo: (value): value is EngineResult<"subsetPmo"> =>
    hasKind(value, ["made", "empty", "not-open", "failed"]),
  previewSubset: (value): value is EngineResult<"previewSubset"> =>
    value === null ||
    (isRecord(value) &&
      typeof value["specimens"] === "number" &&
      typeof value["librarySamplesWithData"] === "number" &&
      typeof value["targetsWithCalls"] === "number"),
  workingPmoTables: (value): value is EngineResult<"workingPmoTables"> =>
    value === null ||
    (isRecord(value) && isBlob(value["blob"]) && typeof value["fileName"] === "string"),
  workingPmoTable: (value): value is EngineResult<"workingPmoTable"> =>
    value === null ||
    (isRecord(value) && typeof value["fileName"] === "string" && typeof value["text"] === "string"),
  workingPmoSummary: (value): value is EngineResult<"workingPmoSummary"> =>
    value === null ||
    (isRecord(value) && Array.isArray(value["samples"]) && Array.isArray(value["targets"])),
  workingPmoGroups: (value): value is EngineResult<"workingPmoGroups"> =>
    value === null ||
    (isRecord(value) && Array.isArray(value["groups"]) && Array.isArray(value["targets"])),
  workingPmoFile: (value): value is EngineResult<"workingPmoFile"> =>
    value === null ||
    (isRecord(value) && isBlob(value["blob"]) && typeof value["fileName"] === "string"),
};

/**
 * The error every pending and later call rejects with once the worker has
 * stopped. A worker made by {@link createWorkerEngine} starts again on the
 * next call; one passed to {@link createEngineClient} does not.
 */
export class EngineStoppedError extends Error {
  override readonly name = "EngineStoppedError";
}

/** Whether an error means the engine's worker stopped. */
export function isEngineStoppedError(error: unknown): error is EngineStoppedError {
  return error instanceof EngineStoppedError;
}

/**
 * Tokens for the sections of drafts sent to the worker. A draft arrives in
 * the worker as a fresh copy, so the engine there cannot tell an unchanged
 * section by its identity; the token, given here where identity still holds,
 * tells it instead. Draft updates are immutable, so the same object means the
 * same content.
 */
function createSectionTokens(): (draft: Draft) => Readonly<Record<SectionId, string>> {
  const tokens = new WeakMap<object, string>();
  let count = 0;
  const tokenFor = (value: object): string => {
    const known = tokens.get(value);
    if (known !== undefined) return known;
    count += 1;
    const token = `s${count}`;
    tokens.set(value, token);
    return token;
  };
  return (draft) => {
    const entries: Partial<Record<SectionId, string>> = {};
    for (const id of SECTION_IDS) entries[id] = tokenFor(draft[id]);
    return {
      microhaplotypes: entries.microhaplotypes ?? "",
      panel: entries.panel ?? "",
      specimens: entries.specimens ?? "",
      librarySamples: entries.librarySamples ?? "",
      project: entries.project ?? "",
      sequencing: entries.sequencing ?? "",
      bioinformatics: entries.bioinformatics ?? "",
      readCounts: entries.readCounts ?? "",
    };
  };
}

/** Options for {@link createEngineClient}. */
export interface EngineClientOptions {
  /** Called by `dispose` after the engine has released its data, such as `worker.terminate`. */
  readonly terminate?: () => void;
}

/** An engine client, with a way to fail every pending call when the worker breaks. */
export interface EngineClient extends Engine {
  /** Rejects every pending call with `reason`. Later calls are rejected too. */
  fail(reason: string): void;
}

/** An engine that forwards every call to the engine served at `endpoint`. */
export function createEngineClient(
  endpoint: Endpoint,
  options: EngineClientOptions = {},
): EngineClient {
  const pending = new Map<number, (message: ResultMessage) => void>();
  let nextId = 1;
  let broken: string | null = null;

  endpoint.addEventListener("message", (event) => {
    const data: unknown = event.data;
    if (!isResultMessage(data)) return;
    const settle = pending.get(data.id);
    if (settle === undefined) return;
    pending.delete(data.id);
    settle(data);
  });

  const sectionTokens = createSectionTokens();
  const call = <M extends EngineMethod>(method: M, args: EngineArgs<M>): Promise<EngineResult<M>> =>
    new Promise((resolve, reject) => {
      if (broken !== null) {
        reject(new EngineStoppedError(broken));
        return;
      }
      const id = nextId;
      nextId += 1;
      const guard: (value: unknown) => value is EngineResult<M> = RESULT_GUARDS[method];
      pending.set(id, (message) => {
        if (!message.ok)
          reject(
            message.id === 0 && broken !== null
              ? new EngineStoppedError(message.error)
              : new Error(message.error),
          );
        else if (guard(message.value)) resolve(message.value);
        else reject(new Error(`The engine gave an unexpected answer to ${method}.`));
      });
      const message: CallMessage<M> = { type: "call", id, method, args };
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- workers and ports take no target origin
      endpoint.postMessage(message);
    });

  return {
    importFile: (...args) => call("importFile", args),
    restoreFile: (...args) => call("restoreFile", args),
    chooseSheet: (...args) => call("chooseSheet", args),
    dropTable: (...args) => call("dropTable", args),
    previewRows: (...args) => call("previewRows", args),
    distinctValues: (...args) => call("distinctValues", args),
    build: (draft, buildOptions: BuildRequestOptions = {}) =>
      call("build", [
        draft,
        { ...buildOptions, sectionTokens: buildOptions.sectionTokens ?? sectionTokens(draft) },
      ]),
    getPmoFile: (...args) => call("getPmoFile", args),
    getPmoFileSize: (...args) => call("getPmoFileSize", args),
    getPmoText: (...args) => call("getPmoText", args),
    getPanelFragment: (...args) => call("getPanelFragment", args),
    checkPmoFile: (...args) => call("checkPmoFile", args),
    async workingPmo(workingCall) {
      const answer: unknown = await call("workingPmo", [workingCall]);
      if (!isWorkingPmoAnswer(workingCall.request.kind, answer)) {
        throw new Error(`The engine gave an unexpected answer to ${workingCall.request.kind}.`);
      }
      return answer;
    },
    subsetPmo: (...args) => call("subsetPmo", args),
    previewSubset: (...args) => call("previewSubset", args),
    workingPmoTables: (...args) => call("workingPmoTables", args),
    workingPmoTable: (...args) => call("workingPmoTable", args),
    workingPmoSummary: (...args) => call("workingPmoSummary", args),
    workingPmoGroups: (...args) => call("workingPmoGroups", args),
    workingPmoFile: (...args) => call("workingPmoFile", args),
    async dispose(...args) {
      try {
        await call("dispose", args);
      } finally {
        options.terminate?.();
      }
    },
    fail(reason) {
      broken = reason;
      for (const settle of pending.values())
        settle({ type: "result", id: 0, ok: false, error: reason });
      pending.clear();
    },
  };
}

/** A started worker, as {@link createRestartingEngine} needs it. */
export interface WorkerHandle {
  readonly endpoint: Endpoint;
  /** Stops the worker. */
  readonly terminate: () => void;
  /** Calls `listener` with a reason if the worker stops by itself (an uncaught error, a message it cannot read). */
  readonly onStopped: (listener: (reason: string) => void) => void;
}

/**
 * An engine in a worker that starts again after the worker stops.
 *
 * When the worker stops, every pending call rejects with an
 * {@link EngineStoppedError}. The next call starts a new worker and first
 * hands it again every file it held (`restoreFile`, parsed when next needed),
 * so the draft builds as before. The latest build, PMO and memos are lost:
 * the next build makes them again.
 */
export function createRestartingEngine(spawn: () => WorkerHandle): Engine {
  let current: EngineClient | null = null;
  let stopped = false;
  /** Every file the worker holds, so a new worker can be given them again. */
  const files = new Map<string, RestoreFileInput>();

  const start = (): EngineClient => {
    const handle = spawn();
    const client = createEngineClient(handle.endpoint, { terminate: handle.terminate });
    handle.onStopped((reason) => {
      client.fail(reason);
      handle.terminate();
      if (current === client) current = null;
    });
    current = client;
    // Posted before any other call, so the worker has them when that call arrives.
    for (const file of files.values()) {
      client.restoreFile(file).catch(() => undefined);
    }
    return client;
  };
  const engine = (): EngineClient => {
    if (stopped) throw new EngineStoppedError(t`The engine was closed.`);
    return current ?? start();
  };

  return {
    async importFile(input) {
      const outcome = await engine().importFile(input);
      if (outcome.kind === "imported") {
        files.set(outcome.table.id, {
          tableId: outcome.table.id,
          file: input.file,
          fileName: input.fileName,
          sheetName: outcome.table.sheetName,
        });
      }
      return outcome;
    },
    async restoreFile(input) {
      files.set(input.tableId, input);
      await engine().restoreFile(input);
    },
    async chooseSheet(tableId, sheetName) {
      const outcome = await engine().chooseSheet(tableId, sheetName);
      const known = files.get(tableId);
      if (outcome.kind === "imported" && known !== undefined) {
        files.set(tableId, { ...known, sheetName: outcome.table.sheetName });
      }
      return outcome;
    },
    async dropTable(tableId) {
      files.delete(tableId);
      await engine().dropTable(tableId);
    },
    previewRows: async (...args) => engine().previewRows(...args),
    distinctValues: async (...args) => engine().distinctValues(...args),
    build: async (...args) => engine().build(...args),
    getPmoFile: async (...args) => engine().getPmoFile(...args),
    getPmoFileSize: async (...args) => engine().getPmoFileSize(...args),
    getPmoText: async (...args) => engine().getPmoText(...args),
    getPanelFragment: async (...args) => engine().getPanelFragment(...args),
    checkPmoFile: async (...args) => engine().checkPmoFile(...args),
    workingPmo: async (workingCall) => engine().workingPmo(workingCall),
    subsetPmo: async (...args) => engine().subsetPmo(...args),
    previewSubset: async (...args) => engine().previewSubset(...args),
    workingPmoTables: async (...args) => engine().workingPmoTables(...args),
    workingPmoTable: async (...args) => engine().workingPmoTable(...args),
    workingPmoSummary: async (...args) => engine().workingPmoSummary(...args),
    workingPmoGroups: async (...args) => engine().workingPmoGroups(...args),
    workingPmoFile: async (...args) => engine().workingPmoFile(...args),
    async dispose() {
      files.clear();
      const client = current;
      current = null;
      stopped = true;
      if (client !== null) await client.dispose();
    },
  };
}

/** The message for a worker that stopped by itself, with the browser's own words when it gives any. */
function workerStopped(detail?: string): string {
  return detail === undefined || detail === ""
    ? t`The background worker stopped, probably because it ran out of memory. It starts again on the next change; if a table is very large, try a smaller one.`
    : t({
        message: `The background worker stopped, probably because it ran out of memory. It starts again on the next change; if a table is very large, try a smaller one. (${detail})`,
        comment: "{detail} is the browser's own error message, in its language.",
      });
}

/** Starts one engine worker. */
function spawnWorker(): WorkerHandle {
  // The worker's name is the interface language: it loads that catalog for the messages it builds.
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), {
    type: "module",
    name: currentLocale(),
  });
  return {
    endpoint: worker,
    terminate: () => worker.terminate(),
    onStopped: (listener) => {
      worker.addEventListener("error", (event) => {
        listener(workerStopped(event.message));
      });
      worker.addEventListener("messageerror", () => listener(workerStopped()));
    },
  };
}

/**
 * Starts the engine in a web worker and returns a client for it. If the
 * worker crashes, pending calls are rejected with an
 * {@link EngineStoppedError} and the next call starts a new worker with the
 * same files. Throws when the browser refuses to create the worker at all.
 */
export function createWorkerEngine(): Engine {
  // The first worker starts at once, so a browser that refuses workers throws here.
  const first = spawnWorker();
  let used = false;
  return createRestartingEngine(() => {
    if (!used) {
      used = true;
      return first;
    }
    return spawnWorker();
  });
}

/**
 * An engine on the calling thread whose code is loaded on first use, with a
 * dynamic import, so it costs nothing where workers are available.
 */
export function createLazyInThreadEngine(): Engine {
  return createLazyEngine(() => import("./engine").then((module) => module.createInThreadEngine()));
}

/** An engine made by `make` the first time it is used. */
export function createLazyEngine(make: () => Promise<Engine>): Engine {
  let loading: Promise<Engine> | null = null;
  const load = (): Promise<Engine> => (loading ??= make());
  return {
    importFile: async (...args) => (await load()).importFile(...args),
    restoreFile: async (...args) => (await load()).restoreFile(...args),
    chooseSheet: async (...args) => (await load()).chooseSheet(...args),
    dropTable: async (...args) => (await load()).dropTable(...args),
    previewRows: async (...args) => (await load()).previewRows(...args),
    distinctValues: async (...args) => (await load()).distinctValues(...args),
    build: async (...args) => (await load()).build(...args),
    getPmoFile: async (...args) => (await load()).getPmoFile(...args),
    getPmoFileSize: async (...args) => (await load()).getPmoFileSize(...args),
    getPmoText: async (...args) => (await load()).getPmoText(...args),
    getPanelFragment: async (...args) => (await load()).getPanelFragment(...args),
    checkPmoFile: async (...args) => (await load()).checkPmoFile(...args),
    workingPmo: async (workingCall) => (await load()).workingPmo(workingCall),
    subsetPmo: async (...args) => (await load()).subsetPmo(...args),
    previewSubset: async (...args) => (await load()).previewSubset(...args),
    workingPmoTables: async (...args) => (await load()).workingPmoTables(...args),
    workingPmoTable: async (...args) => (await load()).workingPmoTable(...args),
    workingPmoSummary: async (...args) => (await load()).workingPmoSummary(...args),
    workingPmoGroups: async (...args) => (await load()).workingPmoGroups(...args),
    workingPmoFile: async (...args) => (await load()).workingPmoFile(...args),
    // Nothing to release if the engine was never loaded.
    dispose: async (...args) => (loading === null ? undefined : (await load()).dispose(...args)),
  };
}

/**
 * The engine for this environment: in a web worker where one can be made,
 * and otherwise on the calling thread, loaded lazily (tests, server-side
 * rendering, a browser that blocks module workers).
 */
export function createEngine(): Engine {
  if (typeof Worker !== "function") return createLazyInThreadEngine();
  try {
    return createWorkerEngine();
  } catch {
    return createLazyInThreadEngine();
  }
}
