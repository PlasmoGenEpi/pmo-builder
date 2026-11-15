import { initLocale } from "@/i18n";
import "@/styles/index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element");

// Keeps a copy of the app in this browser so it opens without a connection.
// Only in a build: the dev server's files change with every edit.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => undefined);
  });
}

// The language comes first: the app's modules work out some of their text as they load.
await initLocale();
const { start } = await import("./start");
start(root);
