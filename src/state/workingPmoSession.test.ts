// @vitest-environment node
// Node's Blob can stream, which gzip needs; the test DOM's cannot.
import {
  filterPmoBySpecimenNames,
  stringifyPmo,
  type PortableMicrohaplotypeObject,
} from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildExamplePmo } from "@/domain/build/testing";
import { richPmo } from "@/domain/tools/testing";
import { createDraftStorage, createMemoryBackend } from "@/domain/draft";
import type { SubsetRequest, WorkingPmoRequest } from "@/domain/tools/types";
import type { Engine } from "@/worker";
import { readZip } from "@/domain/tools/zipTesting";
import { createInThreadEngine } from "@/worker/engine";

import { createAppStore } from "./store";
import {
  createWorkingPmoSession,
  type OpenSource,
  type WorkingPmoEvent,
  type WorkingPmoSession,
} from "./workingPmoSession";

const EXAMPLE = buildExamplePmo();

/** The example with only its first `count` specimens, so two opened files tell apart. */
function smallerPmo(count: number): PortableMicrohaplotypeObject {
  return filterPmoBySpecimenNames(
    EXAMPLE,
    EXAMPLE.specimen_info.slice(0, count).map((specimen) => specimen.specimen_name),
  );
}

function pmoFile(pmo: PortableMicrohaplotypeObject, name: string): File {
  return new File([stringifyPmo(pmo)], name);
}

/** A promise that resolves when told to. */
class Gate {
  #resolve: () => void = () => undefined;
  readonly promise = new Promise<void>((resolve) => {
    this.#resolve = resolve;
  });

  open(): void {
    this.#resolve();
  }
}

function gate(): Gate {
  return new Gate();
}

/**
 * A file, standing in for a large one, whose bytes are read only once
 * `finish` opens. `started` opens when the worker starts reading it.
 */
function slowFile(file: File, gates: { readonly started: Gate; readonly finish: Gate }): File {
  return new (class extends File {
    override async arrayBuffer(): Promise<ArrayBuffer> {
      gates.started.open();
      await gates.finish.promise;
      return file.arrayBuffer();
    }
  })([file], file.name);
}

/**
 * A session on the real engine in this thread. Only the usage counts are
 * stubbed: they are collected in `events`.
 */
function makeSession(
  options: { readonly engine?: Engine; readonly flush?: () => Promise<void> } = {},
): { readonly session: WorkingPmoSession; readonly events: WorkingPmoEvent[] } {
  const events: WorkingPmoEvent[] = [];
  const session = createWorkingPmoSession({
    engine: options.engine ?? createInThreadEngine(),
    flush: options.flush ?? (() => Promise.resolve()),
    emit: (event) => events.push(event),
  });
  return { session, events };
}

/** A chosen file to open. */
function chosen(file: File): OpenSource {
  return { kind: "file", file, name: file.name, origin: { kind: "chosen" } };
}

const SUMMARY: WorkingPmoRequest<"summary"> = { kind: "summary", source: "original", minReads: 0 };

const EXAMPLES = join(process.cwd(), "public/examples/");

describe("working PMO session: opening", () => {
  it("answers for the file opened last when a slow open finishes after a quick one", async () => {
    const { session } = makeSession();
    const started = gate();
    const finish = gate();
    const slowSpecimens = 3;
    const slowOpen = session.open({
      kind: "file",
      file: slowFile(pmoFile(smallerPmo(slowSpecimens), "slow.json"), { started, finish }),
      name: "slow.json",
      origin: { kind: "chosen" },
    });
    // The worker is reading the slow file when the quick one is opened.
    await started.promise;
    await session.open({
      kind: "file",
      file: pmoFile(EXAMPLE, "quick.json"),
      name: "quick.json",
      origin: { kind: "chosen" },
    });
    finish.open();
    expect(await slowOpen).toEqual({ kind: "superseded" });

    expect(session.state.getState().open).toMatchObject({ kind: "opened", name: "quick.json" });
    const summary = await session.query({ kind: "summary", source: "original", minReads: 0 });
    expect(summary).toMatchObject({
      kind: "ok",
      value: { librarySamples: EXAMPLE.library_sample_info.length },
    });
    expect(EXAMPLE.library_sample_info.length).not.toBe(slowSpecimens);
  });

  it("opens a chosen file, keeping its bytes and origin, and counts the check", async () => {
    const { session, events } = makeSession();
    const file = pmoFile(EXAMPLE, "study.json");
    expect(await session.open(chosen(file))).toEqual({ kind: "opened" });
    expect(session.state.getState().open).toMatchObject({
      kind: "opened",
      file,
      name: "study.json",
      size: file.size,
      origin: { kind: "chosen" },
      opened: { fileName: "study.json" },
    });
    expect(events).toEqual([{ kind: "pmo-file-checked", result: "example" }]);
  });

  it("records a refused file and why, holding nothing", async () => {
    const { session, events } = makeSession();
    const old = { ...EXAMPLE, pmo_header: { ...EXAMPLE.pmo_header, pmo_version: "1.0.0" } };
    expect(await session.open(chosen(pmoFile(old, "old.json")))).toEqual({ kind: "refused" });
    expect(session.state.getState().open).toMatchObject({
      kind: "refused",
      name: "old.json",
      check: { kind: "wrong-version", declared: "1.0.0" },
    });
    expect(await session.query(SUMMARY)).toEqual({ kind: "not-open" });
    expect(events).toEqual([{ kind: "pmo-file-checked", result: "wrong-version" }]);
  });

  it("records a failed open when the engine fails", async () => {
    const engine = createInThreadEngine();
    const broken: Engine = {
      ...engine,
      workingPmo: () => Promise.reject(new Error("out of memory")),
    };
    const { session, events } = makeSession({ engine: broken });
    expect(await session.open(chosen(pmoFile(EXAMPLE, "study.json")))).toEqual({
      kind: "failed",
    });
    expect(session.state.getState().open).toMatchObject({ kind: "failed", name: "study.json" });
    expect(events).toEqual([{ kind: "pmo-file-checked", result: "failed" }]);
  });

  it("opens the PMO the draft builds, building it first", async () => {
    const engine = createInThreadEngine();
    const store = createAppStore({
      engine,
      storage: createDraftStorage({ openBackend: () => createMemoryBackend() }),
      rebuildDelayMs: 1,
      saveDelayMs: 1,
      fetchExample: (path) => {
        const name = path.replace("examples/", "");
        return Promise.resolve(new File([readFileSync(`${EXAMPLES}${name}`)], name));
      },
    });
    await store.getState().actions.initialise();
    await store.getState().actions.loadExample();
    const { session } = makeSession({ engine, flush: () => store.getState().actions.flush() });

    expect(await session.open({ kind: "built" })).toEqual({ kind: "opened" });
    const { open } = session.state.getState();
    expect(open).toMatchObject({ kind: "opened", origin: { kind: "built" } });
    expect(open.kind === "opened" && open.name).toMatch(/\.json\.gz$/);
    expect(await session.query(SUMMARY)).toMatchObject({ kind: "ok" });
  });

  it("says when the draft builds no PMO to open", async () => {
    const { session } = makeSession();
    expect(await session.open({ kind: "built" })).toEqual({ kind: "no-built-pmo" });
    expect(session.state.getState().open).toEqual({ kind: "none" });
  });
});

describe("working PMO session: queries", () => {
  it("sums up the original, and says when no subset has been made", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    const counted = await session.query({ kind: "summary", source: "original", minReads: 100 });
    expect(counted).toMatchObject({ kind: "ok", value: { minReads: 100 } });
    expect(await session.query({ kind: "summary", source: "subset", minReads: 0 })).toEqual({
      kind: "no-subset",
    });
  });

  it("says no file is open before any is", async () => {
    const { session } = makeSession();
    expect(await session.query(SUMMARY)).toEqual({ kind: "not-open" });
  });

  it("answers a query for a file since replaced as stale", async () => {
    const engine = createInThreadEngine();
    const { session } = makeSession({ engine });
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    const { generation } = session.state.getState();
    await session.open(chosen(pmoFile(smallerPmo(3), "second.json")));
    expect(await engine.workingPmo({ generation, request: SUMMARY })).toEqual({ kind: "stale" });
  });

  it("resets the minimum reads on each open", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    session.setMinReads(50);
    expect(session.state.getState().minReads).toBe(50);
    await session.open(chosen(pmoFile(EXAMPLE, "second.json")));
    expect(session.state.getState().minReads).toBeNull();
  });
});

describe("working PMO session: tables", () => {
  it("writes one table of the original, named after the file", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json.gz")));
    const answer = await session.query({
      kind: "table",
      source: "original",
      id: "alleles",
      format: "csv",
    });
    expect(answer).toMatchObject({ kind: "ok", value: { fileName: "study-alleles.csv" } });
    expect(answer.kind === "ok" && answer.value.text.split("\n")[0]).toBe(
      "library_sample_name,target_name,seq,bioinformatics_run_name,reads",
    );
  });

  it("zips every table of the subset, named with -subset", async () => {
    const engine = createInThreadEngine();
    const { session } = makeSession({ engine });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    // Made through the engine until the subset request moves to the session.
    const names = EXAMPLE.specimen_info.slice(0, 2).map((specimen) => specimen.specimen_name);
    await engine.subsetPmo({
      specimens: { kind: "names", names },
      targets: { kind: "all" },
      minReads: 0,
    });
    const answer = await session.query({ kind: "tables", source: "subset", format: "tsv" });
    if (answer.kind !== "ok") throw new Error(`expected tables, got ${answer.kind}`);
    expect(answer.value.fileName).toBe("study-subset-tables-tsv.zip");
    const files = await readZip(answer.value.blob);
    expect(files.map((file) => file.name)).toContain("study-subset-specimens.tsv");
    const specimens = files.find((file) => file.name === "study-subset-specimens.tsv");
    // A header row and one row per specimen kept.
    expect(specimens?.text.trim().split("\n")).toHaveLength(names.length + 1);
  });

  const TABLE: WorkingPmoRequest<"table"> = {
    kind: "table",
    source: "original",
    id: "specimens",
    format: "csv",
  };
  const TABLES: WorkingPmoRequest<"tables"> = { kind: "tables", source: "original", format: "csv" };

  it("says no file is open, for one table or all of them", async () => {
    const { session } = makeSession();
    expect(await session.query(TABLE)).toEqual({ kind: "not-open" });
    expect(await session.query(TABLES)).toEqual({ kind: "not-open" });
  });

  it("says no subset has been made, for one table or all of them", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    expect(await session.query({ ...TABLE, source: "subset" })).toEqual({ kind: "no-subset" });
    expect(await session.query({ ...TABLES, source: "subset" })).toEqual({ kind: "no-subset" });
  });

  it("answers a table request for a file since replaced as stale", async () => {
    const engine = createInThreadEngine();
    const { session } = makeSession({ engine });
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    const { generation } = session.state.getState();
    await session.open(chosen(pmoFile(smallerPmo(3), "second.json")));
    expect(await engine.workingPmo({ generation, request: TABLE })).toEqual({ kind: "stale" });
    expect(await engine.workingPmo({ generation, request: TABLES })).toEqual({ kind: "stale" });
  });

  it("keeps the Tables tab's choice of original or subset until the next open", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    expect(session.state.getState().tableSource).toBe("original");
    session.setTableSource("subset");
    expect(session.state.getState().tableSource).toBe("subset");
    await session.open(chosen(pmoFile(EXAMPLE, "second.json")));
    expect(session.state.getState().tableSource).toBe("original");
  });
});

describe("working PMO session: freeing memory", () => {
  it("lets go of the file when it is closed", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.close();
    expect(session.state.getState().open).toEqual({ kind: "none" });
    expect(await session.query(SUMMARY)).toEqual({ kind: "not-open" });
  });

  it("lets go of the previous file before reading the next one", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    const started = gate();
    const finish = gate();
    const next = session.open(
      chosen(slowFile(pmoFile(smallerPmo(3), "second.json"), { started, finish })),
    );
    await started.promise;
    // The worker is reading the second file, and holds nothing meanwhile.
    expect(await session.query(SUMMARY)).toEqual({ kind: "not-open" });
    finish.open();
    expect(await next).toEqual({ kind: "opened" });
    expect(await session.query(SUMMARY)).toMatchObject({
      kind: "ok",
      value: { librarySamples: 3 },
    });
  });
});

describe("working PMO session: comparing groups", () => {
  it("lists the fields specimens can be compared by, with how many have each", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(richPmo(), "rich.json")));
    expect(await session.query({ kind: "groupFields", source: "original" })).toEqual({
      kind: "ok",
      value: [
        { key: "collection_country", present: 2, total: 3, distinct: 1 },
        { key: "geo_admin1", present: 2, total: 3, distinct: 2 },
        { key: "collection_year", present: 3, total: 3, distinct: 2 },
        { key: "collection_month", present: 2, total: 3, distinct: 2 },
        { key: "project", present: 2, total: 3, distinct: 1 },
      ],
    });
  });

  it("leaves out a field that does not split the specimens into groups", async () => {
    const { session } = makeSession();
    const rich = richPmo();
    const oneCountry = {
      ...rich,
      specimen_info: rich.specimen_info.map((specimen) =>
        Object.assign({}, specimen, { collection_country: "Mozambique" }),
      ),
    };
    await session.open(chosen(pmoFile(oneCountry, "rich.json")));
    const fields = await session.query({ kind: "groupFields", source: "original" });
    expect(fields.kind === "ok" && fields.value.map((field) => field.key)).not.toContain(
      "collection_country",
    );
  });

  it("compares the groups of a field, counting only reads over the minimum", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(richPmo(), "rich.json")));
    const all = await session.query({
      kind: "groups",
      source: "original",
      key: "geo_admin1",
      minReads: 0,
    });
    expect(all).toMatchObject({
      kind: "ok",
      value: {
        key: "geo_admin1",
        groups: [
          { name: "Gaza", specimens: 1 },
          { name: "Maputo", specimens: 1 },
          { name: null, specimens: 1 },
        ],
      },
    });
    const none = await session.query({
      kind: "groups",
      source: "original",
      key: "geo_admin1",
      minReads: 1_000_000,
    });
    expect(none.kind === "ok" && none.value.groups.map((group) => group.withData)).toEqual([
      0, 0, 0,
    ]);
  });

  it("says when no file is open, or no subset has been made", async () => {
    const { session } = makeSession();
    expect(await session.query({ kind: "groupFields", source: "original" })).toEqual({
      kind: "not-open",
    });
    expect(
      await session.query({ kind: "groups", source: "original", key: "project", minReads: 0 }),
    ).toEqual({ kind: "not-open" });
    await session.open(chosen(pmoFile(richPmo(), "rich.json")));
    expect(await session.query({ kind: "groupFields", source: "subset" })).toEqual({
      kind: "no-subset",
    });
    expect(
      await session.query({ kind: "groups", source: "subset", key: "project", minReads: 0 }),
    ).toEqual({ kind: "no-subset" });
  });

  it("answers a comparison for a file since replaced as stale", async () => {
    const engine = createInThreadEngine();
    const { session } = makeSession({ engine });
    await session.open(chosen(pmoFile(richPmo(), "first.json")));
    const { generation } = session.state.getState();
    await session.open(chosen(pmoFile(richPmo(), "second.json")));
    expect(
      await engine.workingPmo({ generation, request: { kind: "groupFields", source: "original" } }),
    ).toEqual({ kind: "stale" });
    expect(
      await engine.workingPmo({
        generation,
        request: { kind: "groups", source: "original", key: "project", minReads: 0 },
      }),
    ).toEqual({ kind: "stale" });
  });
});

/** The names of the example's first `count` specimens. */
function firstSpecimens(count: number): readonly string[] {
  return EXAMPLE.specimen_info.slice(0, count).map((specimen) => specimen.specimen_name);
}

/** A subset keeping the example's first `count` specimens. */
function keepFirst(count: number): SubsetRequest {
  return {
    specimens: { kind: "names", names: firstSpecimens(count) },
    targets: { kind: "all" },
    minReads: 0,
  };
}

describe("working PMO session: subsets", () => {
  it("makes a subset of the original and remembers what it was made from", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    const answer = await session.subset(keepFirst(3));
    expect(answer).toMatchObject({
      kind: "ok",
      value: { kind: "made", fileName: "study-subset.json.gz", summary: { specimens: 3 } },
    });
    expect(session.state.getState().subset).toMatchObject({
      kind: "made",
      request: keepFirst(3),
      made: { fileName: "study-subset.json.gz" },
    });
    expect(await session.query({ ...SUMMARY, source: "subset" })).toMatchObject({
      kind: "ok",
      value: { librarySamples: 3 },
    });
  });
});

describe("working PMO session: replacing subsets", () => {
  it("replaces the first subset with the second", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    await session.subset(keepFirst(2));
    expect(session.state.getState().subset).toMatchObject({ request: keepFirst(2) });
    expect(await session.query({ ...SUMMARY, source: "subset" })).toMatchObject({
      kind: "ok",
      value: { librarySamples: 2 },
    });
  });

  it("makes each subset from the original, not from the subset before", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(2));
    expect(await session.subset(keepFirst(3))).toMatchObject({
      kind: "ok",
      value: { kind: "made", summary: { specimens: 3 } },
    });
  });

  it("keeps no subset when nothing would be left", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    const nothing: SubsetRequest = { ...keepFirst(3), minReads: 1e9 };
    expect(await session.subset(nothing)).toEqual({ kind: "ok", value: { kind: "empty" } });
    expect(session.state.getState().subset).toEqual({ kind: "none" });
    expect(await session.query({ ...SUMMARY, source: "subset" })).toEqual({ kind: "no-subset" });
  });

  it("says no file is open when asked for a subset before any is", async () => {
    const { session } = makeSession();
    expect(await session.subset(keepFirst(3))).toEqual({ kind: "not-open" });
    expect(session.state.getState().subset).toEqual({ kind: "none" });
  });

  it("answers a subset as stale when another file is opened meanwhile, and keeps none", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    const making = session.subset(keepFirst(3));
    const opening = session.open(chosen(pmoFile(smallerPmo(4), "second.json")));
    expect(await making).toEqual({ kind: "stale" });
    expect(await opening).toEqual({ kind: "opened" });
    expect(session.state.getState().subset).toEqual({ kind: "none" });
    expect(await session.query({ ...SUMMARY, source: "subset" })).toEqual({ kind: "no-subset" });
  });

  it("forgets the subset when another file is opened", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    await session.subset(keepFirst(3));
    await session.open(chosen(pmoFile(EXAMPLE, "second.json")));
    expect(session.state.getState().subset).toEqual({ kind: "none" });
    expect(await session.query({ ...SUMMARY, source: "subset" })).toEqual({ kind: "no-subset" });
  });
});

describe("working PMO session: previews", () => {
  it("counts what a subset of the original would keep, without making it", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(2));
    expect(await session.query({ kind: "preview", ...keepFirst(3) })).toEqual({
      kind: "ok",
      value: expect.objectContaining({ specimens: 3, librarySamples: 3 }),
    });
    expect(session.state.getState().subset).toMatchObject({ request: keepFirst(2) });
  });

  it("counts nothing left when no microhaplotype has enough reads", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    expect(await session.query({ kind: "preview", ...keepFirst(3), minReads: 1e9 })).toMatchObject({
      kind: "ok",
      value: { librarySamplesWithData: 0 },
    });
  });

  it("says no file is open before any is", async () => {
    const { session } = makeSession();
    expect(await session.query({ kind: "preview", ...keepFirst(3) })).toEqual({
      kind: "not-open",
    });
  });

  it("answers a preview for a file since replaced as stale", async () => {
    const engine = createInThreadEngine();
    const { session } = makeSession({ engine });
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    const { generation } = session.state.getState();
    await session.open(chosen(pmoFile(smallerPmo(3), "second.json")));
    expect(
      await engine.workingPmo({ generation, request: { kind: "preview", ...keepFirst(3) } }),
    ).toEqual({ kind: "stale" });
  });
});
