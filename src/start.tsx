import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initAnalytics } from "@/analytics";
import { App } from "@/app/App";
import { getDefaultAppStore } from "@/state";

/**
 * Starts the app. Imported only after the interface language is chosen and
 * its catalog loaded (see `main.tsx`), so text worked out when a module loads
 * is already in that language.
 */
export function start(root: HTMLElement): void {
  initAnalytics();
  // Start the engine worker and begin restoring the saved draft before the first render.
  const store = getDefaultAppStore();

  createRoot(root).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
}
