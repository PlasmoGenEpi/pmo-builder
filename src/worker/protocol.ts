/**
 * The message protocol between the main thread and the engine worker.
 *
 * Each {@link Engine} method is one request: `{ type: "call", id, method,
 * args }`. The worker answers each with `{ type: "result", id, ok, ... }`.
 * Nothing else crosses: no functions, no class instances other than `Blob`.
 * The client checks the shape of every answer before handing it on.
 */
import type { Engine } from "./types";

/** The engine methods that can be called across the boundary. */
export const ENGINE_METHODS = [
  "importFile",
  "restoreFile",
  "chooseSheet",
  "dropTable",
  "previewRows",
  "distinctValues",
  "build",
  "getPmoFile",
  "getPmoFileSize",
  "getPmoText",
  "getPanelFragment",
  "dispose",
] as const satisfies readonly (keyof Engine)[];

/** One engine method's name. */
export type EngineMethod = (typeof ENGINE_METHODS)[number];

/** The arguments of an engine method. */
export type EngineArgs<M extends EngineMethod> = Parameters<Engine[M]>;

/** What an engine method resolves to. */
export type EngineResult<M extends EngineMethod> = Awaited<ReturnType<Engine[M]>>;

/** A call from the main thread. */
export interface CallMessage<M extends EngineMethod = EngineMethod> {
  readonly type: "call";
  readonly id: number;
  readonly method: M;
  readonly args: EngineArgs<M>;
}

/** The worker's answer to one call. */
export type ResultMessage =
  | { readonly type: "result"; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly type: "result"; readonly id: number; readonly ok: false; readonly error: string };

/** The part of `Worker`, `MessagePort` or a worker's `self` the protocol uses. */
export interface Endpoint {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEngineMethod(value: unknown): value is EngineMethod {
  return ENGINE_METHODS.some((method) => method === value);
}

/**
 * Whether a message is a call. Checks its envelope and method name; the
 * arguments are passed to the engine as they came, since only the app's own
 * client sends them.
 */
export function isCallMessage(value: unknown): value is CallMessage {
  return (
    isRecord(value) &&
    value["type"] === "call" &&
    typeof value["id"] === "number" &&
    isEngineMethod(value["method"]) &&
    Array.isArray(value["args"])
  );
}

/** Whether a message is a result. */
export function isResultMessage(value: unknown): value is ResultMessage {
  if (!isRecord(value) || value["type"] !== "result" || typeof value["id"] !== "number")
    return false;
  return value["ok"] === true
    ? "value" in value
    : value["ok"] === false && typeof value["error"] === "string";
}

type Handlers = { readonly [M in EngineMethod]: (args: EngineArgs<M>) => Promise<EngineResult<M>> };

function handlersFor(engine: Engine): Handlers {
  return {
    importFile: (args) => engine.importFile(...args),
    restoreFile: (args) => engine.restoreFile(...args),
    chooseSheet: (args) => engine.chooseSheet(...args),
    dropTable: (args) => engine.dropTable(...args),
    previewRows: (args) => engine.previewRows(...args),
    distinctValues: (args) => engine.distinctValues(...args),
    build: (args) => engine.build(...args),
    getPmoFile: (args) => engine.getPmoFile(...args),
    getPmoFileSize: (args) => engine.getPmoFileSize(...args),
    getPmoText: (args) => engine.getPmoText(...args),
    getPanelFragment: (args) => engine.getPanelFragment(...args),
    dispose: (args) => engine.dispose(...args),
  };
}

function dispatch<M extends EngineMethod>(
  handlers: Handlers,
  call: CallMessage<M>,
): Promise<EngineResult<M>> {
  const handler: (args: EngineArgs<M>) => Promise<EngineResult<M>> = handlers[call.method];
  return handler(call.args);
}

/**
 * Answers calls arriving at `endpoint` with `engine`. Returns a function
 * that stops listening.
 */
export function serveEngine(engine: Engine, endpoint: Endpoint): () => void {
  const handlers = handlersFor(engine);
  const answer = async (call: CallMessage): Promise<void> => {
    let message: ResultMessage;
    try {
      message = { type: "result", id: call.id, ok: true, value: await dispatch(handlers, call) };
    } catch (error) {
      message = {
        type: "result",
        id: call.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- workers and ports take no target origin
    endpoint.postMessage(message);
  };
  const listener = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (isCallMessage(data)) void answer(data);
  };
  endpoint.addEventListener("message", listener);
  return () => endpoint.removeEventListener("message", listener);
}
