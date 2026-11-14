/**
 * The engine worker's entry point: serves an in-thread engine to the main
 * thread. Started by `createWorkerEngine` in `client.ts`.
 */
import { createInThreadEngine } from "./engine";
import { serveEngine } from "./protocol";

serveEngine(createInThreadEngine(), self);
