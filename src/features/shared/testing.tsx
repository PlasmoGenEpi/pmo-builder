/**
 * Test helpers for step pages: a store on the in-thread engine with the real
 * import, fields and matching, and storage in memory. Not used by the app.
 */
import { I18nProvider } from "@lingui/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { createDraftStorage, createMemoryBackend } from "@/domain/draft";
import { i18n } from "@/i18n";
import { AppStoreProvider, createAppStore, type AppStore, type AppStoreOptions } from "@/state";
import { ToastProvider } from "@/ui";
import { installDomPolyfills } from "@/ui/testPolyfills";
import { createInThreadEngine } from "@/worker/engine";

/** Tests run from the repository root. */
const EXAMPLES = join(process.cwd(), "public/examples/");

/** An example file from `public/examples`, as a `File`. */
export function exampleFile(name: string): File {
  return new File([readFileSync(`${EXAMPLES}${name}`)], name);
}

/** A file holding `text`, such as a small CSV written in the test. */
export function textFile(name: string, text: string): File {
  return new File([text], name, { type: "text/plain" });
}

/**
 * A store on the in-thread engine and memory storage, with short delays.
 * Examples are read from `public/examples`. Pass options to override.
 */
export function createTestStore(options: Partial<AppStoreOptions> = {}): AppStore {
  return createAppStore({
    engine: createInThreadEngine(),
    storage: createDraftStorage({ openBackend: () => createMemoryBackend() }),
    rebuildDelayMs: 1,
    saveDelayMs: 1,
    fetchExample: (path) => Promise.resolve(exampleFile(path.replace("examples/", ""))),
    ...options,
  });
}

/** What {@link renderWithStore} returns. */
export interface RenderedWithStore extends RenderResult {
  readonly store: AppStore;
}

/**
 * Renders `ui` inside the store, toasts and a memory router, after the store
 * has restored (an empty draft). Installs the DOM polyfills Radix needs.
 */
export async function renderWithStore(
  ui: ReactNode,
  options: { readonly store?: AppStore; readonly path?: string } = {},
): Promise<RenderedWithStore> {
  installDomPolyfills();
  const store = options.store ?? createTestStore();
  await store.getState().actions.initialise();
  const location = memoryLocation({ path: options.path ?? "/" });
  const result = render(
    <I18nProvider i18n={i18n}>
      <AppStoreProvider store={store}>
        <ToastProvider>
          <Router hook={location.hook}>{ui}</Router>
        </ToastProvider>
      </AppStoreProvider>
    </I18nProvider>,
  );
  return { ...result, store };
}
