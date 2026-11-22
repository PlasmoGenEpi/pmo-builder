/**
 * The engine worker's entry point: serves an in-thread engine to the main
 * thread. Started by `createWorkerEngine` in `client.ts`, which names the
 * worker after the interface language.
 *
 * The language is loaded before the engine's modules are imported, as on the
 * main thread, so text they work out as they load is in that language. The
 * listener is attached at once, so no call is missed meanwhile.
 */
import { activateLocale, isLocale } from "@/i18n";

import { createLazyEngine } from "./client";
import { serveEngine, type ProgressMessage } from "./protocol";

const ready = (isLocale(self.name) ? activateLocale(self.name) : Promise.resolve()).catch(
  () => undefined,
);

serveEngine(
  createLazyEngine(async () => {
    await ready;
    const { createInThreadEngine } = await import("./engine");
    return createInThreadEngine({
      onProgress: (progress) => {
        const message: ProgressMessage = { type: "progress", progress };
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- workers take no target origin
        self.postMessage(message);
      },
    });
  }),
  self,
);
