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

createRoot(root).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
