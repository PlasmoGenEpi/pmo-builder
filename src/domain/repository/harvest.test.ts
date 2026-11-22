import { gzipPmo } from "pmotools-ts";
import { describe, expect, it, vi } from "vitest";

import { buildDraft } from "@/domain/build";
import {
  buildExamplePmo as examplePmo,
  EXAMPLE_MAPPINGS,
  mappedTable,
  rawTable,
  testContext,
} from "@/domain/build/testing";
import { createEmptyDraft, createPanelEntry } from "@/domain/draft";

import { harvest, HarvestError, latestVersions, pmoFileOf } from "./harvest";

/** A minimal valid PMO as UTF-8 JSON bytes, fast to parse across hundreds of records. */
function minimalPmoBytes(): Uint8Array {
  const alleles = rawTable([{ SampleID: "s1", Locus: "t1", ASV: "ACGT", Reads: "10" }]);
  const panel = rawTable([{ amplicon: "t1", fwd_primer: "AAAA", rev_primer: "TTTT" }]);
  const empty = createEmptyDraft();
  const { merge } = buildDraft(
    {
      ...empty,
      microhaplotypes: {
        table: mappedTable("alleles", alleles, EXAMPLE_MAPPINGS.alleles),
        runName: { mode: "fixed", fixedName: "run1", column: null },
        representativeColumns: [],
      },
      panel: {
        panels: [
          {
            ...createPanelEntry("Panel1"),
            table: mappedTable("panel", panel, EXAMPLE_MAPPINGS.panel),
          },
        ],
      },
    },
    testContext({ alleles, panel }),
    { creationDate: "2026-01-01" },
  );
  if (merge.outcome.kind !== "built") throw new Error("minimal PMO did not build");
  return new TextEncoder().encode(JSON.stringify(merge.outcome.pmo));
}

function record(id: string, files: readonly string[], title = `Dataset ${id}`): unknown {
  return {
    id,
    pids: { doi: { identifier: `10.5281/zenodo.${id}` } },
    links: { self_html: `https://zenodo.org/records/${id}` },
    metadata: {
      title,
      publication_date: "2026-11-14",
      creators: [
        { person_or_org: { type: "personal", name: "Okello, Grace" } },
        { person_or_org: { type: "organizational", name: "PlasmoGenEpi" } },
      ],
      rights: [
        { id: "cc-by-4.0", title: { en: "Creative Commons Attribution 4.0 International" } },
      ],
    },
    files: {
      entries: Object.fromEntries(files.map((key) => [key, { key, size: 1234 }])),
    },
  };
}

/** A `fetch` over a table of addresses. Each value is JSON, bytes, or a status. */
function fakeZenodo(answers: Readonly<Record<string, unknown>>) {
  const asked: string[] = [];
  const send = vi.fn<typeof fetch>((input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    const answer = answers[url];
    if (answer === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    if (typeof answer === "number") return Promise.resolve(new Response(null, { status: answer }));
    if (answer instanceof Uint8Array) return Promise.resolve(new Response(Uint8Array.from(answer)));
    return Promise.resolve(new Response(JSON.stringify(answer)));
  });
  return { send, asked };
}

const LISTING =
  "https://zenodo.org/api/communities/pmocommunity/records?q=metadata.subjects.subject%3A%22Portable+Microhaplotype+Object%22&size=25&sort=newest";
const listingPage = (page: number): string =>
  page === 1 ? LISTING : `https://zenodo.org/api/communities/pmocommunity/records?page=${page}`;
const file = (id: string, name: string): string =>
  `https://zenodo.org/api/records/${id}/files/${encodeURIComponent(name)}/content`;

describe("harvest", () => {
  it("lists the community's PMO records and describes each from its file", async () => {
    const bytes = await gzipPmo(examplePmo());
    const { send, asked } = fakeZenodo({
      [LISTING]: { hits: { hits: [record("101", ["study.pmo.json.gz"])] }, links: {} },
      [file("101", "study.pmo.json.gz")]: bytes,
    });
    const result = await harvest({
      community: "pmocommunity",
      fetch: send,
      now: new Date("2026-11-15T03:00:00Z"),
    });
    expect(asked).toEqual([LISTING, file("101", "study.pmo.json.gz")]);
    expect(result.skipped).toEqual([]);
    expect(result.index).toMatchObject({
      version: 1,
      harvestedAt: "2026-11-15T03:00:00.000Z",
      community: "pmocommunity",
    });
    expect(result.index.datasets).toEqual([
      {
        id: "101",
        title: "Dataset 101",
        creators: ["Okello, Grace", "PlasmoGenEpi"],
        published: "2026-11-14",
        version: null,
        licence: { id: "cc-by-4.0", title: "Creative Commons Attribution 4.0 International" },
        doi: "10.5281/zenodo.101",
        zenodoUrl: "https://zenodo.org/records/101",
        file: { name: "study.pmo.json.gz", size: 1234, url: file("101", "study.pmo.json.gz") },
        summary: expect.objectContaining({ specimens: 50, librarySamples: 50, targets: 276 }),
        panels: ["Mad4hatter"],
        countries: ["Mozambique"],
        collectionYears: { first: 2015, last: 2019 },
        taxa: [5833],
        bioProjects: [],
      },
    ]);
    expect(result.specimens).toHaveLength(50);
    expect(result.specimens[0]).toEqual({
      dataset: "101",
      specimen: "example_specimen_01",
      country: "Mozambique",
      date: "2019-01",
      taxa: [5833],
      librarySamples: 1,
    });
  });

  it("follows the listing to its next page", async () => {
    const bytes = await gzipPmo(examplePmo());
    const second = "https://zenodo.org/api/communities/pmocommunity/records?page=2";
    const { send } = fakeZenodo({
      [LISTING]: { hits: { hits: [record("101", ["a.pmo.json.gz"])] }, links: { next: second } },
      [second]: { hits: { hits: [record("102", ["b.pmo.json.gz"])] }, links: {} },
      [file("101", "a.pmo.json.gz")]: bytes,
      [file("102", "b.pmo.json.gz")]: bytes,
    });
    const result = await harvest({ community: "pmocommunity", fetch: send });
    expect(result.index.datasets.map((dataset) => dataset.id)).toEqual(["101", "102"]);
  });

  it("reads every record past 1,250 across all listing pages", async () => {
    const bytes = minimalPmoBytes();
    const total = 1275;
    const pageSize = 25;
    const pageCount = total / pageSize;
    const pages = new Map<string, unknown>();
    for (let page = 1; page <= pageCount; page += 1) {
      const start = (page - 1) * pageSize;
      const hits = Array.from({ length: pageSize }, (_, offset) => {
        const id = String(start + offset + 1);
        return record(id, [`study-${id}.pmo.json`]);
      });
      pages.set(listingPage(page), {
        hits: { hits, total },
        links: page < pageCount ? { next: listingPage(page + 1) } : {},
      });
    }
    const send = vi.fn<typeof fetch>((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const page = pages.get(url);
      if (page !== undefined) return Promise.resolve(new Response(JSON.stringify(page)));
      if (url.endsWith("/content")) return Promise.resolve(new Response(Uint8Array.from(bytes)));
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result = await harvest({ community: "pmocommunity", fetch: send });
    expect(result.index.datasets).toHaveLength(1275);
    expect(result.index.datasets[0]?.id).toBe("1");
    expect(result.index.datasets[1274]?.id).toBe("1275");
  });

  it("leaves out records it cannot use and says why", async () => {
    const bytes = await gzipPmo(examplePmo());
    const text = new TextEncoder();
    const log = vi.fn<(message: string) => void>();
    const { send } = fakeZenodo({
      [LISTING]: {
        hits: {
          hits: [
            record("101", ["good.pmo.json.gz"]),
            record("102", ["notes.pdf"], "Only a PDF"),
            record("103", ["empty.json"], "Not a PMO"),
            record("104", ["broken.json.gz"], "Not gzip"),
            record("105", ["gone.pmo.json"], "File missing"),
          ],
        },
        links: {},
      },
      [file("101", "good.pmo.json.gz")]: bytes,
      [file("103", "empty.json")]: text.encode("{}"),
      [file("104", "broken.json.gz")]: Uint8Array.from([0x1f, 0x8b, 1, 2, 3]),
    });
    const result = await harvest({ community: "pmocommunity", fetch: send, log });
    expect(result.index.datasets.map((dataset) => dataset.id)).toEqual(["101"]);
    expect(result.specimens.every((row) => row.dataset === "101")).toBe(true);
    expect(result.skipped.map((skip) => [skip.id, skip.title])).toEqual([
      ["102", "Only a PDF"],
      ["103", "Not a PMO"],
      ["104", "Not gzip"],
      ["105", "File missing"],
    ]);
    expect(result.skipped[0]?.reason).toBe("it has no .json or .json.gz file");
    expect(result.skipped[1]?.reason).toMatch(/does not match the PMO format/);
    expect(result.skipped[2]?.reason).toMatch(/could not be read/);
    expect(result.skipped[3]?.reason).toBe("Zenodo answered 404 for gone.pmo.json");
    expect(log).toHaveBeenCalledTimes(5);
  });

  it("gives an empty catalogue for a community with no PMO records", async () => {
    const { send } = fakeZenodo({ [LISTING]: { hits: { hits: [] }, links: {} } });
    const result = await harvest({ community: "pmocommunity", fetch: send });
    expect(result.index.datasets).toEqual([]);
    expect(result.specimens).toEqual([]);
  });

  it("fails as a whole when the listing cannot be read, so the last catalogue can be kept", async () => {
    await expect(
      harvest({ community: "pmocommunity", fetch: fakeZenodo({ [LISTING]: 503 }).send }),
    ).rejects.toThrow(HarvestError);
    await expect(
      harvest({
        community: "pmocommunity",
        fetch: fakeZenodo({ [LISTING]: { nonsense: true } }).send,
      }),
    ).rejects.toThrow(HarvestError);
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));
    await expect(harvest({ community: "pmocommunity", fetch: offline })).rejects.toThrow(
      HarvestError,
    );
  });

  it("fails with both numbers when the listing reports more records than it returns", async () => {
    const second = "https://zenodo.org/api/communities/pmocommunity/records?page=2";
    const page1 = Array.from({ length: 25 }, (_, i) => record(String(i + 1), ["a.pmo.json"]));
    const page2 = Array.from({ length: 10 }, (_, i) => record(String(i + 26), ["a.pmo.json"]));
    const { send, asked } = fakeZenodo({
      [LISTING]: { hits: { hits: page1, total: 60 }, links: { next: second } },
      [second]: { hits: { hits: page2, total: 60 }, links: {} },
    });

    await expect(harvest({ community: "pmocommunity", fetch: send })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HarvestError &&
        /\b60\b/.test(error.message) &&
        /\b35\b/.test(error.message),
    );
    expect(asked).toEqual([LISTING, second]);
  });

  it("fails instead of stopping quietly when the listing never ends", async () => {
    let page = 1;
    const endless = vi.fn<typeof fetch>(() => {
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
    });

    await expect(harvest({ community: "pmocommunity", fetch: endless })).rejects.toThrow(
      HarvestError,
    );
    expect(endless.mock.calls.length).toBeGreaterThan(50);
  });
});

describe("pmoFileOf", () => {
  it("takes the .pmo. file when a record has several JSON files", () => {
    expect(pmoFileOf(record("1", ["a.json", "z.pmo.json.gz", "readme.txt"]))).toEqual({
      name: "z.pmo.json.gz",
      size: 1234,
    });
    expect(pmoFileOf(record("1", ["b.json", "a.json.gz"]))?.name).toBe("a.json.gz");
  });

  it("is null without a JSON file", () => {
    expect(pmoFileOf(record("1", ["data.csv"]))).toBeNull();
    expect(pmoFileOf({})).toBeNull();
  });
});

function version(id: string, parent: string, index: number) {
  return { id, parent: { id: parent }, versions: { index } };
}

describe("latestVersions", () => {
  it("keeps the newest version of each record, in listing order", () => {
    const kept = latestVersions([
      version("11", "10", 1),
      version("21", "20", 1),
      version("12", "10", 2),
    ]);
    expect(kept).toEqual([version("12", "10", 2), version("21", "20", 1)]);
  });
});
