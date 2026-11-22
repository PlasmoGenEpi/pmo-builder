import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "./run";

const FALLBACK = "https://example.org/repository";
const LAST_INDEX = JSON.stringify({
  version: 1,
  harvestedAt: "2026-11-14T00:00:00.000Z",
  community: "pmocommunity",
  datasets: [],
});
const LAST_SPECIMENS = JSON.stringify([]);

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("run", () => {
  let out = "";

  beforeEach(async () => {
    out = await mkdtemp(path.join(os.tmpdir(), "pmo-harvest-run-"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (out !== "") await rm(out, { recursive: true, force: true });
  });

  it("keeps the last published catalogue when Zenodo reports more records than it returns", async () => {
    const fakeFetch = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.startsWith("https://zenodo.org/api/communities/pmocommunity/records")) {
        return Promise.resolve(
          new Response(JSON.stringify({ hits: { hits: [], total: 10 }, links: {} })),
        );
      }
      if (url === `${FALLBACK}/index.json`) return Promise.resolve(new Response(LAST_INDEX));
      if (url === `${FALLBACK}/specimens.json`)
        return Promise.resolve(new Response(LAST_SPECIMENS));
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const exitCode = await run(
      ["--community", "pmocommunity", "--out", out, "--fallback", FALLBACK],
      { fetch: fakeFetch },
    );

    expect(exitCode).toBe(0);
    expect(await readFile(path.join(out, "index.json"), "utf8")).toBe(LAST_INDEX);
    expect(await readFile(path.join(out, "specimens.json"), "utf8")).toBe(LAST_SPECIMENS);
  });

  it("keeps the last published catalogue when Zenodo's listing never ends", async () => {
    let page = 1;
    const fakeFetch = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.startsWith("https://zenodo.org/api/communities/pmocommunity/records")) {
        page += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hits: { hits: [] },
              links: {
                next: `https://zenodo.org/api/communities/pmocommunity/records?page=${page}`,
              },
            }),
          ),
        );
      }
      if (url === `${FALLBACK}/index.json`) return Promise.resolve(new Response(LAST_INDEX));
      if (url === `${FALLBACK}/specimens.json`)
        return Promise.resolve(new Response(LAST_SPECIMENS));
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const exitCode = await run(
      ["--community", "pmocommunity", "--out", out, "--fallback", FALLBACK],
      { fetch: fakeFetch },
    );

    expect(exitCode).toBe(0);
    expect(await readFile(path.join(out, "index.json"), "utf8")).toBe(LAST_INDEX);
    expect(await readFile(path.join(out, "specimens.json"), "utf8")).toBe(LAST_SPECIMENS);
  });

  it("returns 1 on a listing shortfall when no fallback is given", async () => {
    const fakeFetch = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.startsWith("https://zenodo.org/api/communities/pmocommunity/records")) {
        return Promise.resolve(
          new Response(JSON.stringify({ hits: { hits: [], total: 10 }, links: {} })),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const exitCode = await run(["--community", "pmocommunity", "--out", out], { fetch: fakeFetch });

    expect(exitCode).toBe(1);
    expect(await readdir(out)).toEqual([]);
  });
});
