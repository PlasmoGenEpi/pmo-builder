import { describe, expect, it } from "vitest";

import { isPrecached, serviceWorkerSource } from "./serviceWorker";

describe("isPrecached", () => {
  it("keeps the app's files and leaves out maps, daily data and sign-in pages", () => {
    expect(isPrecached("index.html")).toBe(true);
    expect(isPrecached("assets/index-abc.js")).toBe(true);
    expect(isPrecached("assets/engine.worker-abc.js")).toBe(true);
    expect(isPrecached("examples/mad4hatter_allele_data_example.csv")).toBe(true);
    expect(isPrecached("assets/index-abc.js.map")).toBe(false);
    expect(isPrecached("repository/index.json")).toBe(false);
    expect(isPrecached("zenodo-callback.html")).toBe(false);
    expect(isPrecached("assets/fr-abc.po")).toBe(false);
    expect(isPrecached("sw.js")).toBe(false);
  });
});

describe("serviceWorkerSource", () => {
  it("names its cache after the build, and lists the files it keeps", () => {
    const source = serviceWorkerSource("0123456789abcdef", ["index.html", "assets/a.js"]);
    expect(source).toContain('const VERSION = "0123456789abcdef";');
    expect(source).toContain('const FILES = ["index.html","assets/a.js"];');
  });

  it("leaves requests to other sites alone and handles only GET", () => {
    const source = serviceWorkerSource("v", []);
    expect(source).toContain('if (request.method !== "GET") return;');
    expect(source).toContain("if (url.origin !== self.location.origin");
    // A new worker waits for old tabs to close, so it never calls skipWaiting.
    expect(source).not.toContain("skipWaiting");
  });
});
