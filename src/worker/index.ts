/**
 * The engine that parses imports and builds drafts, and its web worker.
 * Use {@link createEngine} in the app.
 *
 * This entry is safe for the main thread: it holds the engine's types, the
 * worker client and the message protocol, but not the engine itself, which
 * loads in the worker. Tests that want an engine on their own thread import
 * `createInThreadEngine` from `@/worker/engine`.
 */
export * from "./client";
export * from "./protocol";
export type * from "./types";
