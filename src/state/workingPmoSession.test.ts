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
import { examplePmoWithReadCounts, richPmo } from "@/domain/tools/testing";
import { createDraftStorage, createMemoryBackend } from "@/domain/draft";
import type { SubsetRequest, WorkingPmoRequest } from "@/domain/tools/types";
import type { Engine } from "@/worker";
import { readZip } from "@/domain/tools/zipTesting";
import { createInThreadEngine } from "@/worker/engine";
import { stoppableWorkers } from "@/test/workers";

import { createAppStore } from "./store";
import {
  createWorkingPmoSession,
  type PmoToOpen,
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
function chosen(file: File): PmoToOpen {
  return { kind: "file", file, name: file.name, origin: { kind: "chosen" } };
}

const SUMMARY: WorkingPmoRequest<"summary"> = { kind: "summary", source: "original", minReads: 0 };

const EXAMPLES = join(process.cwd(), "public/examples/");

describe("working PMO session: opening", () => {
  it("answers for the file opened last when a slow open finishes after a quick one", async () => {
    const { session } = makeSession();
    const started = gate();
    const finish = gate();
    const slowPmo = smallerPmo(3);
    // The two files must differ in what the summary counts, to tell which one it sums up.
    expect(slowPmo.library_sample_info.length).not.toBe(EXAMPLE.library_sample_info.length);
    const slowOpen = session.open({
      kind: "file",
      file: slowFile(pmoFile(slowPmo, "slow.json"), { started, finish }),
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

  it("records a failed open when the built PMO cannot be exported", async () => {
    const engine = createInThreadEngine();
    const broken: Engine = {
      ...engine,
      getPmoFile: () => Promise.reject(new Error("out of memory")),
    };
    const { session, events } = makeSession({ engine: broken });
    expect(await session.open({ kind: "built" })).toEqual({ kind: "failed" });
    expect(session.state.getState().open).toMatchObject({ kind: "failed", cause: "open" });
    expect(events).toEqual([{ kind: "pmo-file-checked", result: "failed" }]);
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

  it("answers as stale a query still running when another file is opened", async () => {
    const engine = createInThreadEngine();
    const started = gate();
    const finish = gate();
    // The summary waits until told to, as a slow one on a large file would.
    const slow: Engine = {
      ...engine,
      workingPmo: async (call) => {
        if (call.request.kind === "summary" && call.generation === 1) {
          started.open();
          await finish.promise;
        }
        return engine.workingPmo(call);
      },
    };
    const { session } = makeSession({ engine: slow });
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    const pending = session.query(SUMMARY);
    await started.promise;
    await session.open(chosen(pmoFile(smallerPmo(3), "second.json")));
    finish.open();
    expect(await pending).toEqual({ kind: "stale" });
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
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    const names = EXAMPLE.specimen_info.slice(0, 2).map((specimen) => specimen.specimen_name);
    await session.subset({
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

  it("writes read counts by stage for original and subset, and includes it in the archive", async () => {
    const { session } = makeSession();
    const withCounts = examplePmoWithReadCounts();
    await session.open(chosen(pmoFile(withCounts, "study.json")));
    const open = session.state.getState().open;
    expect(open.kind === "opened" && open.opened.tables).toContainEqual({
      id: "readCounts",
      rows: 8,
    });

    const original = await session.query({
      kind: "table",
      source: "original",
      id: "readCounts",
      format: "csv",
    });
    if (original.kind !== "ok") throw new Error(original.kind);
    expect(original.value.fileName).toBe("study-read-counts.csv");
    expect(original.value.text.trimEnd().split("\n")).toHaveLength(9);

    const sample01Specimen =
      withCounts.specimen_info[
        withCounts.library_sample_info.find(
          (library) => library.library_sample_name === "example_sample_01",
        )?.specimen_id ?? -1
      ]?.specimen_name;
    if (sample01Specimen === undefined) throw new Error("expected specimen");

    await session.subset({
      specimens: { kind: "names", names: [sample01Specimen] },
      targets: { kind: "all" },
      minReads: 0,
    });
    const subset = session.state.getState().subset;
    expect(subset.kind === "made" && subset.made.tables).toContainEqual({
      id: "readCounts",
      rows: 2,
    });

    const subsetTable = await session.query({
      kind: "table",
      source: "subset",
      id: "readCounts",
      format: "tsv",
    });
    if (subsetTable.kind !== "ok") throw new Error(subsetTable.kind);
    expect(subsetTable.value.fileName).toBe("study-subset-read-counts.tsv");
    expect(subsetTable.value.text.trimEnd().split("\n")).toEqual([
      "library_sample_name\ttotal_raw_count\ttarget_name\tstage\treads",
      "example_sample_01\t10\tPf3D7_01_v3-145388-145662-1A\tdemux\t10",
      "example_sample_01\t10\tPf3D7_01_v3-145388-145662-1A\tdada2\t7",
    ]);

    const archive = await session.query({ kind: "tables", source: "subset", format: "tsv" });
    if (archive.kind !== "ok") throw new Error(archive.kind);
    const files = await readZip(archive.value.blob);
    expect(files.map((file) => file.name)).toContain("study-subset-read-counts.tsv");
  });

  it("previews the first 20 rows of a table for original and subset, matching the download", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));

    const preview = await session.query({
      kind: "tablePreview",
      source: "original",
      id: "alleles",
    });
    const downloaded = await session.query({
      kind: "table",
      source: "original",
      id: "alleles",
      format: "tsv",
    });
    if (preview.kind !== "ok" || downloaded.kind !== "ok") {
      throw new Error(`expected ok, got ${preview.kind} / ${downloaded.kind}`);
    }
    const [header, ...dataLines] = downloaded.value.text.trimEnd().split("\n");
    expect(preview.value.columns).toEqual(header?.split("\t"));
    expect(preview.value.totalRows).toBe(dataLines.length);
    expect(preview.value.rows).toHaveLength(20);
    expect(
      preview.value.rows.map((row) =>
        row.map((cell) => (cell === null ? "" : String(cell))).join("\t"),
      ),
    ).toEqual(dataLines.slice(0, 20));

    const names = EXAMPLE.specimen_info.slice(0, 2).map((specimen) => specimen.specimen_name);
    await session.subset({
      specimens: { kind: "names", names },
      targets: { kind: "all" },
      minReads: 0,
    });
    const subsetPreview = await session.query({
      kind: "tablePreview",
      source: "subset",
      id: "specimens",
    });
    if (subsetPreview.kind !== "ok") throw new Error(subsetPreview.kind);
    expect(subsetPreview.value.totalRows).toBe(2);
    expect(subsetPreview.value.rows).toHaveLength(2);
    const nameColumn = subsetPreview.value.columns.indexOf("specimen_name");
    expect(subsetPreview.value.rows.map((row) => row[nameColumn])).toEqual(names);
  });

  it("answers tablePreview with not-open, no-subset, and stale as other queries do", async () => {
    const engine = createInThreadEngine();
    const { session } = makeSession({ engine });
    const request: WorkingPmoRequest<"tablePreview"> = {
      kind: "tablePreview",
      source: "original",
      id: "specimens",
    };

    expect(await session.query(request)).toEqual({ kind: "not-open" });

    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    expect(await session.query({ ...request, source: "subset" })).toEqual({ kind: "no-subset" });

    const { generation } = session.state.getState();
    await session.open(chosen(pmoFile(smallerPmo(3), "second.json")));
    expect(await engine.workingPmo({ generation, request })).toEqual({ kind: "stale" });
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

describe("working PMO session: worker restarts", () => {
  it("sums up the original and the subset after the worker stops", async () => {
    const workers = stoppableWorkers(() => createInThreadEngine());
    const { session } = makeSession({ engine: workers.engine });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    workers.stop();

    expect(await session.query(SUMMARY)).toMatchObject({
      kind: "ok",
      value: { librarySamples: EXAMPLE.library_sample_info.length },
    });
    expect(await session.query({ ...SUMMARY, source: "subset" })).toMatchObject({
      kind: "ok",
      value: { librarySamples: 3 },
    });
    expect(session.state.getState().open).toMatchObject({ kind: "opened", name: "study.json" });
    expect(workers.started()).toBe(2);
  });

  it("answers a request the worker stopped while working on, and counts the stop", async () => {
    const workers = stoppableWorkers(() => createInThreadEngine());
    const { session, events } = makeSession({ engine: workers.engine });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    const pending = session.query(SUMMARY);
    workers.stop();
    expect(await pending).toMatchObject({
      kind: "ok",
      value: { librarySamples: EXAMPLE.library_sample_info.length },
    });
    expect(events).toContainEqual({ kind: "engine-stopped" });
  });

  it("makes the subset asked for when the worker stops while making it", async () => {
    const workers = stoppableWorkers(() => createInThreadEngine());
    const { session } = makeSession({ engine: workers.engine });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    const pending = session.subset(keepFirst(5));
    workers.stop();
    expect(await pending).toMatchObject({ kind: "ok", value: { summary: { specimens: 5 } } });
    expect(await session.query({ ...SUMMARY, source: "subset" })).toMatchObject({
      kind: "ok",
      value: { librarySamples: 5 },
    });
  });

  it("ends with the file opened last when the worker stops while it is being read", async () => {
    const started = gate();
    const finish = gate();
    const workers = stoppableWorkers((index) => {
      const engine = createInThreadEngine();
      if (index > 0) return engine;
      // The first worker is still reading latest.json when it stops.
      return {
        ...engine,
        workingPmo: async (call) => {
          if ("fileName" in call.request && call.request.fileName === "latest.json") {
            started.open();
            await finish.promise;
          }
          return engine.workingPmo(call);
        },
      };
    });
    const { session } = makeSession({ engine: workers.engine });
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    const latestSpecimens = 4;
    const opening = session.open(chosen(pmoFile(smallerPmo(latestSpecimens), "latest.json")));
    await started.promise;
    workers.stop();
    finish.open();

    expect(await opening).toEqual({ kind: "opened" });
    expect(session.state.getState().open).toMatchObject({ kind: "opened", name: "latest.json" });
    expect(await session.query(SUMMARY)).toMatchObject({
      kind: "ok",
      value: { librarySamples: latestSpecimens },
    });
  });

  it("answers as stale a request for a file replaced while the worker restarts", async () => {
    const workers = stoppableWorkers(() => createInThreadEngine());
    const { session } = makeSession({ engine: workers.engine });
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    const pending = session.query(SUMMARY);
    workers.stop();
    const latestSpecimens = 4;
    await session.open(chosen(pmoFile(smallerPmo(latestSpecimens), "latest.json")));
    expect(await pending).toEqual({ kind: "stale" });
    expect(await session.query(SUMMARY)).toMatchObject({
      kind: "ok",
      value: { librarySamples: latestSpecimens },
    });
  });

  it("reads a file once more when the worker stops while reading it, then fails", async () => {
    const reads: number[] = [];
    const workers = stoppableWorkers((index) => {
      const engine = createInThreadEngine();
      // Every worker stops while reading, as with a file too large for memory.
      return {
        ...engine,
        workingPmo: async (call) => {
          if (call.request.kind === "open") {
            reads.push(index);
            workers.stop();
            return new Promise<never>(() => undefined);
          }
          return engine.workingPmo(call);
        },
      };
    });
    const { session } = makeSession({ engine: workers.engine });
    expect(await session.open(chosen(pmoFile(EXAMPLE, "huge.json")))).toEqual({ kind: "failed" });
    expect(session.state.getState().open).toMatchObject({ kind: "failed", cause: "open" });
    expect(reads).toEqual([0, 1]);
  });

  it("fails the open state when the file cannot be opened again", async () => {
    const workers = stoppableWorkers((index) => {
      const engine = createInThreadEngine();
      if (index === 0) return engine;
      return {
        ...engine,
        workingPmo: (call) =>
          call.request.kind === "open"
            ? Promise.reject(new Error("out of memory"))
            : engine.workingPmo(call),
      };
    });
    const { session } = makeSession({ engine: workers.engine });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    workers.stop();

    expect((await session.query(SUMMARY)).kind).toBe("failed");
    expect(session.state.getState()).toMatchObject({
      open: { kind: "failed", name: "study.json", cause: "lost" },
      subset: { kind: "none" },
    });
  });

  it("fails a query whose second try stops the worker again, without trying a third time", async () => {
    const summaries: number[] = [];
    const workers = stoppableWorkers((index) => {
      const engine = createInThreadEngine();
      if (index === 0) return engine;
      // Every later worker opens the file, then stops while summing it up.
      return {
        ...engine,
        workingPmo: (call) => {
          if (call.request.kind !== "summary") return engine.workingPmo(call);
          summaries.push(index);
          workers.stop();
          return new Promise<never>(() => undefined);
        },
      };
    });
    const { session } = makeSession({ engine: workers.engine });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    workers.stop();

    expect((await session.query(SUMMARY)).kind).toBe("failed");
    // Tried in the worker started after the first stop, then once more after opening the file again.
    expect(summaries).toEqual([1, 2]);
    expect(workers.started()).toBe(3);
  });

  it("opens the file again once for requests that find it lost together", async () => {
    const opens: number[] = [];
    const workers = stoppableWorkers((index) => {
      const engine = createInThreadEngine();
      return {
        ...engine,
        workingPmo: (call) => {
          if (call.request.kind === "open") opens.push(index);
          return engine.workingPmo(call);
        },
      };
    });
    const { session } = makeSession({ engine: workers.engine });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    workers.stop();
    const answers = await Promise.all([
      session.query(SUMMARY),
      session.query({ kind: "groupFields", source: "original" }),
    ]);
    expect(answers.map((answer) => answer.kind)).toEqual(["ok", "ok"]);
    expect(opens).toEqual([0, 1]);
  });
});

describe("working PMO session: subset files", () => {
  it("exports the subset as a gzipped file named with -subset, which opens as the subset", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    const answer = await session.query({ kind: "file", gzip: true });
    if (answer.kind !== "ok") throw new Error(`expected a file, got ${answer.kind}`);
    expect(answer.value.fileName).toBe("study-subset.json.gz");

    const { session: reader } = makeSession();
    expect(await reader.open(chosen(new File([answer.value.blob], answer.value.fileName)))).toEqual(
      { kind: "opened" },
    );
    expect(await reader.query(SUMMARY)).toMatchObject({
      kind: "ok",
      value: { librarySamples: 3 },
    });
  });

  it("exports the subset as plain JSON when not gzipped", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json.gz")));
    await session.subset(keepFirst(2));
    const answer = await session.query({ kind: "file", gzip: false });
    if (answer.kind !== "ok") throw new Error(`expected a file, got ${answer.kind}`);
    expect(answer.value.fileName).toBe("study-subset.json");
    const parsed: unknown = JSON.parse(await answer.value.blob.text());
    expect(parsed).toMatchObject({
      specimen_info: EXAMPLE.specimen_info
        .slice(0, 2)
        .map((specimen) => ({ specimen_name: specimen.specimen_name })),
    });
  });

  it("says no file is open, or no subset has been made", async () => {
    const { session } = makeSession();
    expect(await session.query({ kind: "file", gzip: true })).toEqual({ kind: "not-open" });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    expect(await session.query({ kind: "file", gzip: true })).toEqual({ kind: "no-subset" });
  });

  it("answers a file request for a file since replaced as stale", async () => {
    const engine = createInThreadEngine();
    const { session } = makeSession({ engine });
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    await session.subset(keepFirst(3));
    const { generation } = session.state.getState();
    await session.open(chosen(pmoFile(smallerPmo(3), "second.json")));
    expect(await engine.workingPmo({ generation, request: { kind: "file", gzip: true } })).toEqual({
      kind: "stale",
    });
  });
});

describe("working PMO session: original or subset", () => {
  it("works on the original until a subset is made", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    expect(session.state.getState().source).toBe("original");
    session.setSource("subset");
    expect(session.state.getState().source).toBe("original");
  });

  it("switches to the subset when one is made, and can switch back", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    expect(session.state.getState().source).toBe("subset");
    session.setSource("original");
    expect(session.state.getState().source).toBe("original");
    session.setSource("subset");
    expect(session.state.getState().source).toBe("subset");
  });

  it("stays on the subset when a new subset replaces it", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    await session.subset(keepFirst(2));
    expect(session.state.getState().source).toBe("subset");
  });

  it("switches to the subset made last, even from the original", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    session.setSource("original");
    await session.subset(keepFirst(2));
    expect(session.state.getState().source).toBe("subset");
  });

  it("keeps the subset and the choice while a new subset is being made", async () => {
    const engine = createInThreadEngine();
    const finish = gate();
    let holding = false;
    const { session } = makeSession({
      engine: {
        ...engine,
        workingPmo: async (call) => {
          if (call.request.kind === "subset" && holding) await finish.promise;
          return engine.workingPmo(call);
        },
      },
    });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    holding = true;
    const making = session.subset(keepFirst(2));
    expect(session.state.getState()).toMatchObject({
      source: "subset",
      subset: { kind: "made", request: keepFirst(3) },
    });
    finish.open();
    await making;
    expect(session.state.getState()).toMatchObject({
      source: "subset",
      subset: { kind: "made", request: keepFirst(2) },
    });
  });

  it("goes back to the original when a new subset fails", async () => {
    const engine = createInThreadEngine();
    let failing = false;
    const { session } = makeSession({
      engine: {
        ...engine,
        workingPmo: (call) =>
          call.request.kind === "subset" && failing
            ? Promise.reject(new Error("out of memory"))
            : engine.workingPmo(call),
      },
    });
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    failing = true;
    expect((await session.subset(keepFirst(2))).kind).toBe("failed");
    expect(session.state.getState()).toMatchObject({
      source: "original",
      subset: { kind: "none" },
    });
  });

  it("goes back to the original when a new subset would keep nothing", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    await session.subset({ ...keepFirst(3), minReads: 1e9 });
    expect(session.state.getState().source).toBe("original");
  });

  it("resets the choice to the original when another file is opened", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "first.json")));
    await session.subset(keepFirst(3));
    expect(session.state.getState().source).toBe("subset");
    await session.open(chosen(pmoFile(EXAMPLE, "second.json")));
    expect(session.state.getState().source).toBe("original");
  });

  it("resets the choice to the original when the file is closed", async () => {
    const { session } = makeSession();
    await session.open(chosen(pmoFile(EXAMPLE, "study.json")));
    await session.subset(keepFirst(3));
    await session.close();
    expect(session.state.getState().source).toBe("original");
  });
});
