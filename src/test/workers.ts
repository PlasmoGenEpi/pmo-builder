/**
 * Test helpers for the worker protocol: a fake channel between a page and
 * its worker, and an engine served through workers that a test can stop.
 */
import {
  createRestartingEngine,
  serveEngine,
  type Endpoint,
  type Engine,
  type WorkerHandle,
} from "@/worker";

/** One side of a fake channel: it delivers what the other side posts. */
export class FakeEndpoint implements Endpoint {
  /** The other side, which receives what this side posts. `null` until joined. */
  peer: FakeEndpoint | null = null;
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  /** Sends a copy of `message` to the other side, which receives it later. */
  postMessage(message: unknown): void {
    const copy = structuredClone(message);
    setTimeout(() => this.peer?.deliver(copy), 0);
  }

  /** Listens for messages from the other side. */
  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  /** Stops listening. */
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  private deliver(data: unknown): void {
    for (const listener of this.listeners) listener(new MessageEvent("message", { data }));
  }
}

/** Two endpoints joined like a page and its worker: messages are cloned and arrive later. */
export function endpointPair(): readonly [FakeEndpoint, FakeEndpoint] {
  const page = new FakeEndpoint();
  const worker = new FakeEndpoint();
  page.peer = worker;
  worker.peer = page;
  return [page, worker];
}

/** An engine in fake workers that a test can stop, as a browser stops a worker out of memory. */
export interface StoppableWorkers {
  /** The engine, which starts a new worker on the next call after one stops. */
  readonly engine: Engine;
  /** Stops the current worker. Its pending calls fail, and what it held is lost. */
  readonly stop: (reason?: string) => void;
  /** How many workers have been started. */
  readonly started: () => number;
}

/**
 * Serves engines through fake workers wrapped in the restarting engine, as
 * the app does. `makeEngine` makes the engine of each worker, given how many
 * were started before it.
 */
export function stoppableWorkers(makeEngine: (index: number) => Engine): StoppableWorkers {
  let count = 0;
  let stopCurrent: ((reason: string) => void) | null = null;
  const spawn = (): WorkerHandle => {
    const [page, worker] = endpointPair();
    const unserve = serveEngine(makeEngine(count), worker);
    count += 1;
    const listeners: ((reason: string) => void)[] = [];
    stopCurrent = (reason) => {
      unserve();
      for (const listener of listeners) listener(reason);
    };
    return {
      endpoint: page,
      terminate: unserve,
      onStopped: (listener) => listeners.push(listener),
    };
  };
  return {
    engine: createRestartingEngine(spawn),
    stop: (reason = "The background worker stopped.") => {
      const current = stopCurrent;
      stopCurrent = null;
      current?.(reason);
    },
    started: () => count,
  };
}
