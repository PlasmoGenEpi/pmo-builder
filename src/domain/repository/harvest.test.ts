import { gzipPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { describe, expect, it, vi } from "vitest";

import { buildDraft } from "@/domain/build";
import { EXAMPLE_MAPPINGS, mappedTable, readExample, testContext } from "@/domain/build/testing";
import { createEmptyDraft, createPanelEntry } from "@/domain/draft";

import { harvest, HarvestError, pmoFileOf } from "./harvest";

const tables = {
  alleles: readExample("mad4hatter_allele_data_example.csv"),
  panel: readExample("mad4hatter_panel_info_example.csv"),
  metadata: readExample("mad4hatter_metadata_example.tsv"),
};

/** A PMO built from the example tables, as a deposit would hold. */
function examplePmo(): PortableMicrohaplotypeObject {
  const empty = createEmptyDraft();
  const { merge } = buildDraft(
    {
      ...empty,
      microhaplotypes: {
        table: mappedTable("alleles", tables.alleles, EXAMPLE_MAPPINGS.alleles),
        runName: { mode: "fixed", fixedName: "run1", column: null },
        representativeColumns: [],
      },
      panel: {
        panels: [
          {
            ...createPanelEntry("Mad4hatter"),
            table: mappedTable("panel", tables.panel, EXAMPLE_MAPPINGS.panel),
          },
        ],
      },
      specimens: { table: mappedTable("metadata", tables.metadata, EXAMPLE_MAPPINGS.specimens) },
      librarySamples: {
        table: mappedTable("metadata", tables.metadata, EXAMPLE_MAPPINGS.librarySamples),
      },
    },
    testContext(tables),
    { creationDate: "2026-01-01" },
  );
  if (merge.outcome.kind !== "built") throw new Error("the example did not build");
  return merge.outcome.pmo;
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
  "https://zenodo.org/api/communities/plasmogenepi/records?q=metadata.subjects.subject%3A%22Portable+Microhaplotype+Object%22&size=25&sort=newest";
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
      community: "plasmogenepi",
      fetch: send,
      now: new Date("2026-11-15T03:00:00Z"),
    });
    expect(asked).toEqual([LISTING, file("101", "study.pmo.json.gz")]);
    expect(result.skipped).toEqual([]);
    expect(result.index).toMatchObject({
      version: 1,
      harvestedAt: "2026-11-15T03:00:00.000Z",
      community: "plasmogenepi",
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
    const second = "https://zenodo.org/api/communities/plasmogenepi/records?page=2";
    const { send } = fakeZenodo({
      [LISTING]: { hits: { hits: [record("101", ["a.pmo.json.gz"])] }, links: { next: second } },
      [second]: { hits: { hits: [record("102", ["b.pmo.json.gz"])] }, links: {} },
      [file("101", "a.pmo.json.gz")]: bytes,
      [file("102", "b.pmo.json.gz")]: bytes,
    });
    const result = await harvest({ community: "plasmogenepi", fetch: send });
    expect(result.index.datasets.map((dataset) => dataset.id)).toEqual(["101", "102"]);
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
    const result = await harvest({ community: "plasmogenepi", fetch: send, log });
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
    const result = await harvest({ community: "plasmogenepi", fetch: send });
    expect(result.index.datasets).toEqual([]);
    expect(result.specimens).toEqual([]);
  });

  it("fails as a whole when the listing cannot be read, so the last catalogue can be kept", async () => {
    await expect(
      harvest({ community: "plasmogenepi", fetch: fakeZenodo({ [LISTING]: 503 }).send }),
    ).rejects.toThrow(HarvestError);
    await expect(
      harvest({
        community: "plasmogenepi",
        fetch: fakeZenodo({ [LISTING]: { nonsense: true } }).send,
      }),
    ).rejects.toThrow(HarvestError);
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));
    await expect(harvest({ community: "plasmogenepi", fetch: offline })).rejects.toThrow(
      HarvestError,
    );
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
