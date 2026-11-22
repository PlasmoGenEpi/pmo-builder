import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "./run";
import {
  LISTING_PREFIX,
  listingPage,
  minimalPmoBytes,
  requestUrl,
  zenodoFileUrl,
  zenodoRecord,
} from "./testing";
import { INDEX_VERSION } from "./types";

const FALLBACK = "https://example.org/repository";
const LAST_INDEX = JSON.stringify({
  version: INDEX_VERSION,
  harvestedAt: "2026-11-14T00:00:00.000Z",
  community: "pmocommunity",
  datasets: [],
});
const LAST_SPECIMENS = JSON.stringify([]);

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
      if (url.startsWith(LISTING_PREFIX)) {
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
      if (url.startsWith(LISTING_PREFIX)) {
        page += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              hits: { hits: [] },
              links: { next: listingPage(page) },
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
      if (url.startsWith(LISTING_PREFIX)) {
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

  it("carries unchanged records over from --fallback and reports carried over, downloaded and left out", async () => {
    const bytes = minimalPmoBytes();
    const kept = zenodoRecord("101", { files: ["kept.pmo.json"] });
    const added = zenodoRecord("102", { files: ["added.pmo.json"] });
    const invalid = {
      id: "103",
      metadata: { title: "No JSON" },
      files: { entries: { "notes.pdf": { key: "notes.pdf", size: 10 } } },
    };

    // First run builds a valid catalogue to serve from --fallback.
    const seedOut = await mkdtemp(path.join(os.tmpdir(), "pmo-harvest-seed-"));
    const previousSummary = process.env["GITHUB_STEP_SUMMARY"];
    const summaryPath = path.join(out, "summary.md");
    try {
      const seedFetch = vi.fn<typeof fetch>((input) => {
        const url = requestUrl(input);
        if (url.startsWith(LISTING_PREFIX)) {
          return Promise.resolve(
            new Response(JSON.stringify({ hits: { hits: [kept], total: 1 }, links: {} })),
          );
        }
        if (url === zenodoFileUrl("101", "kept.pmo.json")) {
          return Promise.resolve(new Response(Uint8Array.from(bytes)));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });
      expect(
        await run(["--community", "pmocommunity", "--out", seedOut], { fetch: seedFetch }),
      ).toBe(0);
      const savedIndex = await readFile(path.join(seedOut, "index.json"), "utf8");
      const savedSpecimens = await readFile(path.join(seedOut, "specimens.json"), "utf8");

      const asked: string[] = [];
      const secondFetch = vi.fn<typeof fetch>((input) => {
        const url = requestUrl(input);
        asked.push(url);
        if (url === `${FALLBACK}/index.json`) return Promise.resolve(new Response(savedIndex));
        if (url === `${FALLBACK}/specimens.json`)
          return Promise.resolve(new Response(savedSpecimens));
        if (url.startsWith(LISTING_PREFIX)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ hits: { hits: [kept, added, invalid], total: 3 }, links: {} }),
            ),
          );
        }
        if (url === zenodoFileUrl("102", "added.pmo.json")) {
          return Promise.resolve(new Response(Uint8Array.from(bytes)));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const warnSpy = vi.spyOn(console, "warn");
      process.env["GITHUB_STEP_SUMMARY"] = summaryPath;
      const exitCode = await run(
        ["--community", "pmocommunity", "--out", out, "--fallback", FALLBACK],
        { fetch: secondFetch },
      );

      expect(exitCode).toBe(0);
      expect(asked).not.toContain(zenodoFileUrl("101", "kept.pmo.json"));
      expect(asked).toContain(zenodoFileUrl("102", "added.pmo.json"));
      expect(JSON.parse(await readFile(path.join(out, "index.json"), "utf8"))).toMatchObject({
        version: INDEX_VERSION,
        datasets: [expect.objectContaining({ id: "101" }), expect.objectContaining({ id: "102" })],
      });
      expect(JSON.parse(await readFile(path.join(out, "specimens.json"), "utf8"))).toEqual([
        expect.objectContaining({ dataset: "101" }),
        expect.objectContaining({ dataset: "102" }),
      ]);

      const summary = await readFile(summaryPath, "utf8");
      expect(summary).toMatch(/1 carried over/);
      expect(summary).toMatch(/1 downloaded/);
      expect(summary).toMatch(/1 left out/);
      const logged = warnSpy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(logged).toMatch(/1 carried over/);
      expect(logged).toMatch(/1 downloaded/);
      expect(logged).toMatch(/1 records? left out/);
    } finally {
      if (previousSummary === undefined) delete process.env["GITHUB_STEP_SUMMARY"];
      else process.env["GITHUB_STEP_SUMMARY"] = previousSummary;
      await rm(seedOut, { recursive: true, force: true });
    }
  });

  it("carries unchanged records over from --out when --fallback is omitted", async () => {
    const bytes = minimalPmoBytes();
    const kept = zenodoRecord("101", { files: ["kept.pmo.json"] });

    const firstAsked: string[] = [];
    const firstFetch = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      firstAsked.push(url);
      if (url.startsWith(LISTING_PREFIX)) {
        return Promise.resolve(
          new Response(JSON.stringify({ hits: { hits: [kept], total: 1 }, links: {} })),
        );
      }
      if (url === zenodoFileUrl("101", "kept.pmo.json")) {
        return Promise.resolve(new Response(Uint8Array.from(bytes)));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    expect(await run(["--community", "pmocommunity", "--out", out], { fetch: firstFetch })).toBe(0);
    expect(firstAsked).toContain(zenodoFileUrl("101", "kept.pmo.json"));

    const secondAsked: string[] = [];
    const secondFetch = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      secondAsked.push(url);
      if (url.startsWith(LISTING_PREFIX)) {
        return Promise.resolve(
          new Response(JSON.stringify({ hits: { hits: [kept], total: 1 }, links: {} })),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    expect(await run(["--community", "pmocommunity", "--out", out], { fetch: secondFetch })).toBe(
      0,
    );
    expect(secondAsked).not.toContain(zenodoFileUrl("101", "kept.pmo.json"));
    expect(JSON.parse(await readFile(path.join(out, "index.json"), "utf8"))).toMatchObject({
      datasets: [expect.objectContaining({ id: "101" })],
    });
    expect(JSON.parse(await readFile(path.join(out, "specimens.json"), "utf8"))).toEqual([
      expect.objectContaining({ dataset: "101" }),
    ]);
  });

  it("forces a full rebuild when --full is passed", async () => {
    const bytes = minimalPmoBytes();
    const kept = zenodoRecord("101", { files: ["kept.pmo.json"] });

    const makeFetch = (asked: string[]) =>
      vi.fn<typeof fetch>((input) => {
        const url = requestUrl(input);
        asked.push(url);
        if (url.startsWith(LISTING_PREFIX)) {
          return Promise.resolve(
            new Response(JSON.stringify({ hits: { hits: [kept], total: 1 }, links: {} })),
          );
        }
        if (url === zenodoFileUrl("101", "kept.pmo.json")) {
          return Promise.resolve(new Response(Uint8Array.from(bytes)));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

    expect(await run(["--community", "pmocommunity", "--out", out], { fetch: makeFetch([]) })).toBe(
      0,
    );
    const savedIndex = await readFile(path.join(out, "index.json"), "utf8");
    const savedSpecimens = await readFile(path.join(out, "specimens.json"), "utf8");

    const diskAsked: string[] = [];
    expect(
      await run(["--community", "pmocommunity", "--out", out, "--full"], {
        fetch: makeFetch(diskAsked),
      }),
    ).toBe(0);
    expect(diskAsked).toContain(zenodoFileUrl("101", "kept.pmo.json"));

    const fallbackAsked: string[] = [];
    const fallbackFetch = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      fallbackAsked.push(url);
      if (url === `${FALLBACK}/index.json`) return Promise.resolve(new Response(savedIndex));
      if (url === `${FALLBACK}/specimens.json`)
        return Promise.resolve(new Response(savedSpecimens));
      if (url.startsWith(LISTING_PREFIX)) {
        return Promise.resolve(
          new Response(JSON.stringify({ hits: { hits: [kept], total: 1 }, links: {} })),
        );
      }
      if (url === zenodoFileUrl("101", "kept.pmo.json")) {
        return Promise.resolve(new Response(Uint8Array.from(bytes)));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    expect(
      await run(["--community", "pmocommunity", "--out", out, "--fallback", FALLBACK, "--full"], {
        fetch: fallbackFetch,
      }),
    ).toBe(0);
    expect(fallbackAsked).not.toContain(`${FALLBACK}/index.json`);
    expect(fallbackAsked).toContain(zenodoFileUrl("101", "kept.pmo.json"));
  });

  it("falls back to a full harvest when the previous catalogue cannot be read", async () => {
    const bytes = minimalPmoBytes();
    const kept = zenodoRecord("101", { files: ["kept.pmo.json"] });

    // Unreadable --fallback (404 / corrupt JSON).
    const fallbackAsked: string[] = [];
    const brokenFallback = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      fallbackAsked.push(url);
      if (url === `${FALLBACK}/index.json`) return Promise.resolve(new Response("{not json"));
      if (url === `${FALLBACK}/specimens.json`)
        return Promise.resolve(new Response(null, { status: 404 }));
      if (url.startsWith(LISTING_PREFIX)) {
        return Promise.resolve(
          new Response(JSON.stringify({ hits: { hits: [kept], total: 1 }, links: {} })),
        );
      }
      if (url === zenodoFileUrl("101", "kept.pmo.json")) {
        return Promise.resolve(new Response(Uint8Array.from(bytes)));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    expect(
      await run(["--community", "pmocommunity", "--out", out, "--fallback", FALLBACK], {
        fetch: brokenFallback,
      }),
    ).toBe(0);
    expect(fallbackAsked).toContain(zenodoFileUrl("101", "kept.pmo.json"));

    // Corrupt files in --out on disk.
    await writeFile(path.join(out, "index.json"), "{corrupt");
    await writeFile(path.join(out, "specimens.json"), "[]");
    const diskAsked: string[] = [];
    const diskFetch = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      diskAsked.push(url);
      if (url.startsWith(LISTING_PREFIX)) {
        return Promise.resolve(
          new Response(JSON.stringify({ hits: { hits: [kept], total: 1 }, links: {} })),
        );
      }
      if (url === zenodoFileUrl("101", "kept.pmo.json")) {
        return Promise.resolve(new Response(Uint8Array.from(bytes)));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    expect(await run(["--community", "pmocommunity", "--out", out], { fetch: diskFetch })).toBe(0);
    expect(diskAsked).toContain(zenodoFileUrl("101", "kept.pmo.json"));
  });
});
