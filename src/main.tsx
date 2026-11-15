import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initAnalytics } from "@/analytics";
import { App } from "@/app/App";
import { getDefaultAppStore } from "@/state";
import "@/styles/index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element");

initAnalytics();
// Start the engine worker and begin restoring the saved draft before the first render.
const store = getDefaultAppStore();

// Keeps a copy of the app in this browser so it opens without a connection.
// Only in a build: the dev server's files change with every edit.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => undefined);
  });
}

createRoot(root).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
