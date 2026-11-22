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

interface RecordOverrides {
  readonly title?: string | null;
  readonly checksums?: Readonly<Record<string, string | null>>;
  readonly sizes?: Readonly<Record<string, number>>;
  readonly updated?: string;
  readonly revisionId?: number;
  readonly creators?: readonly string[];
  readonly doi?: string | null;
  readonly published?: string;
  readonly version?: string;
  readonly licence?: { readonly id: string; readonly title: string } | null;
}

function record(
  id: string,
  files: readonly string[],
  titleOrOverrides: string | RecordOverrides = `Dataset ${id}`,
): unknown {
  const overrides: RecordOverrides =
    typeof titleOrOverrides === "string" ? { title: titleOrOverrides } : titleOrOverrides;
  const title = overrides.title === undefined ? `Dataset ${id}` : overrides.title;
  const creators = overrides.creators ?? ["Okello, Grace", "PlasmoGenEpi"];
  const doi = overrides.doi === undefined ? `10.5281/zenodo.${id}` : overrides.doi;
  const licence =
    overrides.licence === undefined
      ? { id: "cc-by-4.0", title: "Creative Commons Attribution 4.0 International" }
      : overrides.licence;
  return {
    id,
    ...(overrides.updated === undefined ? {} : { updated: overrides.updated }),
    ...(overrides.revisionId === undefined ? {} : { revision_id: overrides.revisionId }),
    pids: doi === null ? {} : { doi: { identifier: doi } },
    links: { self_html: `https://zenodo.org/records/${id}` },
    metadata: {
      ...(title === null ? {} : { title }),
      publication_date: overrides.published ?? "2026-11-14",
      ...(overrides.version === undefined ? {} : { version: overrides.version }),
      creators: creators.map((name) => ({ person_or_org: { type: "personal", name } })),
      rights: licence === null ? [] : [{ id: licence.id, title: { en: licence.title } }],
    },
    files: {
      entries: Object.fromEntries(
        files.map((key) => {
          const checksum =
            overrides.checksums !== undefined && key in overrides.checksums
              ? overrides.checksums[key]
              : `md5:${id}-${key}`;
          const size = overrides.sizes?.[key] ?? 1234;
          return [key, { key, size, ...(checksum === null ? {} : { checksum }) }];
        }),
      ),
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
    expect(result.carriedOver).toBe(0);
    expect(result.downloaded).toBe(1);
    expect(result.index).toMatchObject({
      version: 2,
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
        file: {
          name: "study.pmo.json.gz",
          size: 1234,
          url: file("101", "study.pmo.json.gz"),
          fingerprint: expect.any(String),
        },
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

  it("carries unchanged records over without downloading them and drops removed ones", async () => {
    const bytes = await gzipPmo(examplePmo());
    const kept = record("101", ["kept.pmo.json.gz"]);
    const removed = record("102", ["removed.pmo.json.gz"]);
    const first = await harvest({
      community: "pmocommunity",
      fetch: fakeZenodo({
        [LISTING]: { hits: { hits: [kept, removed], total: 2 }, links: {} },
        [file("101", "kept.pmo.json.gz")]: bytes,
        [file("102", "removed.pmo.json.gz")]: bytes,
      }).send,
      now: new Date("2026-11-15T03:00:00Z"),
    });

    const added = record("103", ["added.pmo.json.gz"]);
    const secondZenodo = fakeZenodo({
      [LISTING]: { hits: { hits: [kept, added], total: 2 }, links: {} },
      [file("103", "added.pmo.json.gz")]: bytes,
    });
    const second = await harvest({
      community: "pmocommunity",
      fetch: secondZenodo.send,
      now: new Date("2026-11-16T03:00:00Z"),
      previous: { index: first.index, specimens: first.specimens },
    });

    expect(secondZenodo.asked).toEqual([LISTING, file("103", "added.pmo.json.gz")]);
    expect(second.carriedOver).toBe(1);
    expect(second.downloaded).toBe(1);
    expect(second.skipped).toEqual([]);
    expect(second.index.datasets.map((dataset) => dataset.id)).toEqual(["101", "103"]);
    expect(second.index.datasets[0]).toEqual(first.index.datasets[0]);
    expect(second.specimens.filter((row) => row.dataset === "101")).toEqual(
      first.specimens.filter((row) => row.dataset === "101"),
    );
    expect(second.specimens.some((row) => row.dataset === "102")).toBe(false);
    expect(second.specimens.filter((row) => row.dataset === "103")).toHaveLength(50);
  });

  it("downloads and checks a record again when its file checksum changes", async () => {
    const firstBytes = await gzipPmo(examplePmo());
    const updatedBytes = minimalPmoBytes();
    const first = await harvest({
      community: "pmocommunity",
      fetch: fakeZenodo({
        [LISTING]: {
          hits: {
            hits: [
              record("101", ["study.pmo.json.gz"], {
                checksums: { "study.pmo.json.gz": "md5:aaa" },
              }),
            ],
            total: 1,
          },
          links: {},
        },
        [file("101", "study.pmo.json.gz")]: firstBytes,
      }).send,
    });

    const changedZenodo = fakeZenodo({
      [LISTING]: {
        hits: {
          hits: [
            record("101", ["study.pmo.json.gz"], {
              checksums: { "study.pmo.json.gz": "md5:bbb" },
            }),
          ],
          total: 1,
        },
        links: {},
      },
      [file("101", "study.pmo.json.gz")]: updatedBytes,
    });
    const second = await harvest({
      community: "pmocommunity",
      fetch: changedZenodo.send,
      previous: { index: first.index, specimens: first.specimens },
    });

    expect(changedZenodo.asked).toEqual([LISTING, file("101", "study.pmo.json.gz")]);
    expect(second.carriedOver).toBe(0);
    expect(second.downloaded).toBe(1);
    expect(second.index.datasets[0]?.summary.specimens).toBe(1);
    expect(second.specimens).toHaveLength(1);
    expect(second.index.datasets[0]?.file.fingerprint).not.toBe(
      first.index.datasets[0]?.file.fingerprint,
    );
  });

  it("refreshes changed title, authors and details from the listing without downloading", async () => {
    const bytes = await gzipPmo(examplePmo());
    const first = await harvest({
      community: "pmocommunity",
      fetch: fakeZenodo({
        [LISTING]: { hits: { hits: [record("101", ["study.pmo.json.gz"])], total: 1 }, links: {} },
        [file("101", "study.pmo.json.gz")]: bytes,
      }).send,
    });

    const updatedRecord = record("101", ["study.pmo.json.gz"], {
      title: "Maputo surveillance (corrected)",
      creators: ["Achan, Sarah", "Mensah, Kofi"],
      published: "2026-11-20",
      version: "1.1",
      licence: { id: "cc0-1.0", title: "Creative Commons Zero v1.0 Universal" },
      doi: "10.5281/zenodo.101.v2",
    });
    const carriedZenodo = fakeZenodo({
      [LISTING]: { hits: { hits: [updatedRecord], total: 1 }, links: {} },
    });
    const carried = await harvest({
      community: "pmocommunity",
      fetch: carriedZenodo.send,
      now: new Date("2026-11-20T03:00:00Z"),
      previous: { index: first.index, specimens: first.specimens },
    });
    const fresh = await harvest({
      community: "pmocommunity",
      fetch: fakeZenodo({
        [LISTING]: { hits: { hits: [updatedRecord], total: 1 }, links: {} },
        [file("101", "study.pmo.json.gz")]: bytes,
      }).send,
      now: new Date("2026-11-20T03:00:00Z"),
    });

    expect(carriedZenodo.asked).toEqual([LISTING]);
    expect(carried.carriedOver).toBe(1);
    expect(carried.downloaded).toBe(0);
    expect(carried.index).toEqual(fresh.index);
    expect(carried.specimens).toEqual(fresh.specimens);

    // If a carried-over record now has no title, it is skipped rather than carried over.
    const untitledZenodo = fakeZenodo({
      [LISTING]: {
        hits: {
          hits: [record("101", ["study.pmo.json.gz"], { title: null })],
          total: 1,
        },
        links: {},
      },
    });
    const untitled = await harvest({
      community: "pmocommunity",
      fetch: untitledZenodo.send,
      previous: { index: first.index, specimens: first.specimens },
    });
    expect(untitledZenodo.asked).toEqual([LISTING]);
    expect(untitled.index.datasets).toEqual([]);
    expect(untitled.carriedOver).toBe(0);
    expect(untitled.skipped).toEqual([
      { id: "101", title: "(no title)", reason: "the record has no title" },
    ]);
  });

  it("falls back to record revision when checksum is absent, and never matches missing markers", async () => {
    const bytes = minimalPmoBytes();
    const withRevision = record("101", ["study.pmo.json"], {
      checksums: { "study.pmo.json": null },
      updated: "2026-11-15T03:09:59Z",
      revisionId: 4,
    });
    const withoutMarkers = record("102", ["plain.pmo.json"], {
      checksums: { "plain.pmo.json": null },
    });
    const first = await harvest({
      community: "pmocommunity",
      fetch: fakeZenodo({
        [LISTING]: { hits: { hits: [withRevision, withoutMarkers], total: 2 }, links: {} },
        [file("101", "study.pmo.json")]: bytes,
        [file("102", "plain.pmo.json")]: bytes,
      }).send,
    });
    expect(first.index.datasets[0]?.file.fingerprint).toEqual(expect.any(String));
    expect(first.index.datasets[1]?.file.fingerprint).toBeNull();

    // Unchanged revision carries 101 over; 102 has null fingerprint and is downloaded again.
    const secondZenodo = fakeZenodo({
      [LISTING]: { hits: { hits: [withRevision, withoutMarkers], total: 2 }, links: {} },
      [file("102", "plain.pmo.json")]: bytes,
    });
    const second = await harvest({
      community: "pmocommunity",
      fetch: secondZenodo.send,
      previous: { index: first.index, specimens: first.specimens },
    });
    expect(secondZenodo.asked).toEqual([LISTING, file("102", "plain.pmo.json")]);
    expect(second.carriedOver).toBe(1);
    expect(second.downloaded).toBe(1);

    // A new revision on 101 downloads it again.
    const bumpedRevision = record("101", ["study.pmo.json"], {
      checksums: { "study.pmo.json": null },
      updated: "2026-11-16T03:09:59Z",
      revisionId: 5,
    });
    const thirdZenodo = fakeZenodo({
      [LISTING]: { hits: { hits: [bumpedRevision], total: 1 }, links: {} },
      [file("101", "study.pmo.json")]: bytes,
    });
    const third = await harvest({
      community: "pmocommunity",
      fetch: thirdZenodo.send,
      previous: { index: second.index, specimens: second.specimens },
    });
    expect(thirdZenodo.asked).toEqual([LISTING, file("101", "study.pmo.json")]);
    expect(third.carriedOver).toBe(0);
    expect(third.downloaded).toBe(1);
  });

  it("ignores a previous catalogue of another version, community or invalid shape", async () => {
    const bytes = minimalPmoBytes();
    const hit = record("101", ["study.pmo.json"]);
    const first = await harvest({
      community: "pmocommunity",
      fetch: fakeZenodo({
        [LISTING]: { hits: { hits: [hit], total: 1 }, links: {} },
        [file("101", "study.pmo.json")]: bytes,
      }).send,
    });

    const unusable = [
      { index: { ...first.index, version: 1 }, specimens: first.specimens },
      { index: { ...first.index, community: "other" }, specimens: first.specimens },
      { index: "not an object", specimens: first.specimens },
      { index: first.index, specimens: "not an array" },
      { index: first.index, specimens: [] },
    ];
    for (const previous of unusable) {
      const zenodo = fakeZenodo({
        [LISTING]: { hits: { hits: [hit], total: 1 }, links: {} },
        [file("101", "study.pmo.json")]: bytes,
      });
      // oxlint-disable-next-line no-await-in-loop -- sequential test cases
      const result = await harvest({
        community: "pmocommunity",
        fetch: zenodo.send,
        previous,
      });
      expect(zenodo.asked).toEqual([LISTING, file("101", "study.pmo.json")]);
      expect(result.carriedOver).toBe(0);
      expect(result.downloaded).toBe(1);
    }
  });

  it("retries a record that was left out on the previous run", async () => {
    const bytes = minimalPmoBytes();
    const first = await harvest({
      community: "pmocommunity",
      fetch: fakeZenodo({
        [LISTING]: { hits: { hits: [record("101", ["study.pmo.json"])], total: 1 }, links: {} },
        [file("101", "study.pmo.json")]: 503,
      }).send,
    });
    expect(first.skipped).toHaveLength(1);
    expect(first.index.datasets).toEqual([]);

    const secondZenodo = fakeZenodo({
      [LISTING]: { hits: { hits: [record("101", ["study.pmo.json"])], total: 1 }, links: {} },
      [file("101", "study.pmo.json")]: bytes,
    });
    const second = await harvest({
      community: "pmocommunity",
      fetch: secondZenodo.send,
      previous: { index: first.index, specimens: first.specimens },
    });
    expect(secondZenodo.asked).toEqual([LISTING, file("101", "study.pmo.json")]);
    expect(second.carriedOver).toBe(0);
    expect(second.downloaded).toBe(1);
    expect(second.skipped).toEqual([]);
    expect(second.index.datasets.map((dataset) => dataset.id)).toEqual(["101"]);
  });
});

describe("pmoFileOf", () => {
  it("takes the .pmo. file when a record has several JSON files", () => {
    expect(pmoFileOf(record("1", ["a.json", "z.pmo.json.gz", "readme.txt"]))).toEqual({
      name: "z.pmo.json.gz",
      size: 1234,
      checksum: "md5:1-z.pmo.json.gz",
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
