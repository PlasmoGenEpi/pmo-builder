import { describe, expect, it } from "vitest";

import { EXAMPLE_MAPPINGS, TEST_DEPS, exampleBlob, fakeParseFile } from "@/domain/build/testing";
import {
  createEmptyDraft,
  createPanelEntry,
  createProjectRecord,
  type Draft,
  type MappedTable,
  type TableRef,
} from "@/domain/draft";
import type { ColumnMapping } from "@/domain/types";

import {
  EngineStoppedError,
  createEngineClient,
  createRestartingEngine,
  type WorkerHandle,
} from "./client";
import { createInThreadEngine, type Engine, type ImportOutcome } from "./engine";
import { isCallMessage, serveEngine } from "./protocol";
import { endpointPair } from "./testing";

/** An engine on the test dependencies. */
function testEngine(): Engine {
  return createInThreadEngine({ parseFile: fakeParseFile, deps: TEST_DEPS });
}

function imported(outcome: ImportOutcome): TableRef {
  if (outcome.kind !== "imported") throw new Error(outcome.notice.message);
  return outcome.table;
}

function mapped(table: TableRef, mapping: ColumnMapping): MappedTable {
  return { table, mapping };
}

async function importExample(engine: Engine): Promise<Draft> {
  const load = async (name: string): Promise<TableRef> =>
    imported(await engine.importFile({ file: exampleBlob(name), fileName: name }));
  const [alleles, panel, metadata, totals, byStage] = await Promise.all([
    load("mad4hatter_allele_data_example.csv"),
    load("mad4hatter_panel_info_example.csv"),
    load("mad4hatter_metadata_example.tsv"),
    load("example_raw_reads.txt"),
    load("reads_per_stage.txt"),
  ]);
  const empty = createEmptyDraft();
  return {
    ...empty,
    microhaplotypes: { ...empty.microhaplotypes, table: mapped(alleles, EXAMPLE_MAPPINGS.alleles) },
    panel: {
      panels: [{ ...createPanelEntry("Mad4hatter"), table: mapped(panel, EXAMPLE_MAPPINGS.panel) }],
    },
    specimens: { table: mapped(metadata, EXAMPLE_MAPPINGS.specimens) },
    librarySamples: { table: mapped(metadata, EXAMPLE_MAPPINGS.librarySamples) },
    readCounts: {
      ...empty.readCounts,
      totals: mapped(totals, EXAMPLE_MAPPINGS.totals),
      byStage: mapped(byStage, EXAMPLE_MAPPINGS.byStage),
    },
  };
}

describe("engine", () => {
  it("imports a file and reports its metadata, or why it failed", async () => {
    const engine = testEngine();
    const table = imported(
      await engine.importFile({
        file: exampleBlob("example_raw_reads.txt"),
        fileName: "example_raw_reads.txt",
      }),
    );
    expect(table).toMatchObject({
      fileName: "example_raw_reads.txt",
      format: "delimited",
      columns: ["sample", "raw_count"],
      rowCount: 3,
      sheetNames: null,
    });
    expect(table.fileSize).toBeGreaterThan(0);
    const failed = await engine.importFile({ file: new Blob(["broken"]), fileName: "x.csv" });
    expect(failed).toEqual({
      kind: "failed",
      notice: expect.objectContaining({ code: "import/unexpected" }),
      failure: { code: "unexpected" },
    });
    // The file is named once, not twice.
    const message = failed.kind === "failed" ? failed.notice.message : "";
    expect(message.split('"x.csv"')).toHaveLength(2);
  });

  it("previews rows and lists distinct values of a column", async () => {
    const engine = testEngine();
    const table = imported(
      await engine.importFile({
        file: exampleBlob("reads_per_stage.txt"),
        fileName: "reads_per_stage.txt",
      }),
    );
    expect(await engine.previewRows({ tableId: table.id, offset: 1, limit: 2 })).toEqual({
      kind: "ready",
      columns: ["sample", "target", "stage", "reads"],
      rows: [
        {
          sample: "example_sample_01",
          target: "Pf3D7_01_v3-145388-145662-1A",
          stage: "dada2",
          reads: "7",
        },
        {
          sample: "example_sample_02",
          target: "Pf3D7_01_v3-145388-145662-1A",
          stage: "demux",
          reads: "6",
        },
      ],
      offset: 1,
      totalRows: 8,
    });
    expect(await engine.distinctValues({ tableId: table.id, column: "stage" })).toEqual({
      values: ["demux", "dada2"],
      truncated: false,
    });
    expect(await engine.distinctValues({ tableId: table.id, column: "sample", limit: 2 })).toEqual({
      values: ["example_sample_01", "example_sample_02"],
      truncated: true,
    });
    await engine.dropTable(table.id);
    expect(await engine.previewRows({ tableId: table.id })).toEqual({ kind: "missing" });
  });

  it("reads another sheet of a workbook under the same id", async () => {
    const engine = testEngine();
    const book = new Blob([JSON.stringify({ First: "a\tb\n1\t2", Second: "c\n3\n4" })]);
    const first = imported(await engine.importFile({ file: book, fileName: "book.xlsx" }));
    expect(first).toMatchObject({
      sheetNames: ["First", "Second"],
      sheetName: "First",
      columns: ["a", "b"],
    });
    const second = imported(await engine.chooseSheet(first.id, "Second"));
    expect(second).toMatchObject({
      id: first.id,
      sheetName: "Second",
      columns: ["c"],
      rowCount: 2,
    });
  });

  it("parses a restored file only when it is needed", async () => {
    let parses = 0;
    const engine = createInThreadEngine({
      deps: TEST_DEPS,
      parseFile: async (...args) => {
        parses += 1;
        return fakeParseFile(...args);
      },
    });
    await engine.restoreFile({
      tableId: "kept",
      file: exampleBlob("example_raw_reads.txt"),
      fileName: "example_raw_reads.txt",
      sheetName: null,
    });
    expect(parses).toBe(0);
    const preview = await engine.previewRows({ tableId: "kept", limit: 1 });
    expect(preview).toMatchObject({ kind: "ready", totalRows: 3 });
    await engine.previewRows({ tableId: "kept" });
    expect(parses).toBe(1);
  });

  it("builds the example and exports the PMO", async () => {
    const engine = testEngine();
    const draft = await importExample(engine);
    const outcome = await engine.build(draft, { creationDate: "2026-01-01" });
    if (outcome.kind !== "built") throw new Error("superseded");
    const { view } = outcome;
    expect(view.overall).toMatchObject({ status: "ready", pmo: "valid" });
    expect(view.overall.summary).toMatchObject({
      specimens: 50,
      librarySamplesWithReadCounts: 3,
      targets: 276,
    });
    expect(view.sections.microhaplotypes).toMatchObject({
      status: "ready",
      summary: { librarySamples: 49 },
    });
    expect(view.suggestions).toEqual({
      panelNames: ["Mad4hatter"],
      sequencingNames: ["run1"],
      projectNames: ["PRJNA1040019"],
      runNames: [],
    });
    expect(JSON.stringify(view)).not.toContain("representative_microhaplotypes");

    const size = await engine.getPmoFileSize();
    const gz = await engine.getPmoFile();
    if (gz === null) throw new Error("no file");
    // The size comes from the same file the download gives, made once.
    expect(size).toEqual({ fileName: gz.fileName, size: gz.blob.size });
    expect(await engine.getPmoFile()).toBe(gz);
    expect(gz.fileName).toBe("Mad4hatter.pmo.json.gz");
    const bytes = new Uint8Array(await gz.blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const plain = await engine.getPmoFile({ gzip: false });
    expect(plain?.fileName).toBe("Mad4hatter.pmo.json");
    const text = await engine.getPmoText({ maxLength: 40 });
    expect(text).toMatchObject({ truncated: true });
    expect(text?.text).toHaveLength(40);

    const panelId = draft.panel.panels[0]?.id ?? "";
    const fragment = await engine.getPanelFragment(panelId);
    expect(fragment).toMatchObject({ panel_info: [{ panel_name: "Mad4hatter" }] });
  });

  it("counts the errors that putting the tables together points at a section in its status", async () => {
    const engine = testEngine();
    const draft = await importExample(engine);
    // Every specimen is linked to a project that is not entered.
    const project = createProjectRecord({ project_name: "Other", project_description: "x" });
    const outcome = await engine.build({
      ...draft,
      project: { ...draft.project, records: [project] },
    });
    if (outcome.kind !== "built") throw new Error("superseded");
    const { sections, overall } = outcome.view;
    expect(overall.notices).toContainEqual(
      expect.objectContaining({
        code: "merge/unresolved-names",
        sections: ["specimens", "project"],
      }),
    );
    expect(sections.specimens.status).toBe("error");
    expect(sections.project.status).toBe("error");
    expect(sections.microhaplotypes.status).toBe("ready");
  });

  it("rebuilds only the sections that changed", async () => {
    const engine = testEngine();
    const draft = await importExample(engine);
    const first = await engine.build(draft);
    expect(first.kind === "built" && first.view.rebuilt).toHaveLength(8);

    const same = await engine.build(structuredClone(draft));
    expect(same.kind === "built" && same.view.rebuilt).toEqual([]);

    const edited: Draft = {
      ...draft,
      project: {
        ...draft.project,
        records: [
          createProjectRecord({ project_name: "PRJNA1040019", project_description: "Example" }),
        ],
      },
    };
    const second = await engine.build(edited);
    if (second.kind !== "built") throw new Error("superseded");
    expect(second.view.rebuilt).toEqual(["project"]);
    expect(second.view.overall.summary?.projects).toBe(1);
  });

  it("rebuilds a section when its table's sheet changes", async () => {
    const engine = testEngine();
    const book = new Blob([
      JSON.stringify({ A: "sample\traw_count\nS1\t5", B: "sample\traw_count\nS1\t5\nS2\t6" }),
    ]);
    const table = imported(await engine.importFile({ file: book, fileName: "counts.xlsx" }));
    const empty = createEmptyDraft();
    const draft: Draft = {
      ...empty,
      readCounts: { ...empty.readCounts, totals: mapped(table, EXAMPLE_MAPPINGS.totals) },
    };
    await engine.build(draft);
    await engine.chooseSheet(table.id, "B");
    const after = await engine.build(draft);
    if (after.kind !== "built") throw new Error("superseded");
    expect(after.view.rebuilt).toEqual(["readCounts"]);
    expect(after.view.sections.readCounts.summary).toMatchObject({ librarySamples: 2 });
  });

  it("lets a newer build supersede an older one", async () => {
    const engine = testEngine();
    const draft = await importExample(engine);
    const older = engine.build(draft);
    const newer = engine.build({ ...draft, specimens: { table: null } });
    expect(await older).toEqual({ kind: "superseded" });
    const latest = await newer;
    expect(latest.kind === "built" && latest.view.sections.specimens.status).toBe("empty");
  });

  it("carries the reason an import failed, and names the file once", async () => {
    const engine = createInThreadEngine();
    const empty = await engine.importFile({ file: new Blob([]), fileName: "empty.csv" });
    expect(empty).toMatchObject({
      kind: "failed",
      failure: { code: "empty-file" },
      notice: {
        code: "import/empty-file",
        message: expect.stringMatching(/^"empty.csv" is empty/),
      },
    });
    const old = await engine.importFile({ file: new Blob(["x"]), fileName: "old.xls" });
    expect(old).toMatchObject({
      failure: { code: "unsupported-type", detail: { kind: "legacy-excel" } },
    });
    expect(await engine.chooseSheet("gone", "Sheet1")).toMatchObject({
      failure: { code: "not-loaded" },
    });
  });

  it("types a table once for a set of text columns, not on every rebuild", async () => {
    let typed = 0;
    const engine = createInThreadEngine({
      parseFile: fakeParseFile,
      deps: {
        ...TEST_DEPS,
        typeTable: (table, options) => {
          typed += 1;
          return TEST_DEPS.typeTable(table, options);
        },
      },
    });
    const draft = await importExample(engine);
    await engine.build(draft);
    const first = typed;
    const renamed: Draft = {
      ...draft,
      microhaplotypes: {
        ...draft.microhaplotypes,
        runName: { mode: "fixed", fixedName: "run1", column: null },
      },
    };
    const again = await engine.build(renamed);
    expect(again.kind === "built" && again.view.rebuilt).toEqual(["microhaplotypes"]);
    expect(typed).toBe(first);
  });

  it("writes the preview text once per build", async () => {
    const engine = testEngine();
    await engine.build(await importExample(engine), { creationDate: "2026-01-01" });
    const first = await engine.getPmoText({ maxLength: 100 });
    expect(await engine.getPmoText({ maxLength: 100 })).toBe(first);
    expect(first?.text).toHaveLength(100);
  });

  it("reports a section whose file is not loaded", async () => {
    const engine = testEngine();
    const draft = await importExample(engine);
    const ghost: Draft = {
      ...draft,
      specimens: {
        table:
          draft.specimens.table === null
            ? null
            : { ...draft.specimens.table, table: { ...draft.specimens.table.table, id: "gone" } },
      },
    };
    const outcome = await engine.build(ghost);
    if (outcome.kind !== "built") throw new Error("superseded");
    expect(outcome.view.sections.specimens).toMatchObject({
      status: "incomplete",
      notices: [expect.objectContaining({ code: "table/file-missing" })],
    });
  });
});

describe("worker protocol", () => {
  it("gives the client the same results as the engine itself", async () => {
    const [page, worker] = endpointPair();
    const stop = serveEngine(testEngine(), worker);
    const client = createEngineClient(page);
    const draft = await importExample(client);
    const outcome = await client.build(draft, { creationDate: "2026-01-01" });
    if (outcome.kind !== "built") throw new Error("superseded");
    expect(outcome.view.overall).toMatchObject({ status: "ready", pmo: "valid" });
    const file = await client.getPmoFile({ gzip: false });
    expect(file?.blob).toBeInstanceOf(Blob);
    const pmo: unknown = JSON.parse((await file?.blob.text()) ?? "null");
    expect(pmo).toMatchObject({ pmo_header: { creation_date: "2026-01-01" } });
    const preview = await client.previewRows({
      tableId: draft.readCounts.totals?.table.id ?? "",
      limit: 1,
    });
    expect(preview).toMatchObject({ kind: "ready", rows: [{ sample: "example_sample_01" }] });
    stop();
  });

  it("supersedes an older build sent through the worker", async () => {
    const [page, worker] = endpointPair();
    serveEngine(testEngine(), worker);
    const client = createEngineClient(page);
    const draft = await importExample(client);
    const [older, newer] = await Promise.all([client.build(draft), client.build(draft)]);
    expect(older).toEqual({ kind: "superseded" });
    expect(newer.kind).toBe("built");
  });

  it("rejects a call that fails in the worker, and every call once the worker breaks", async () => {
    const [page, worker] = endpointPair();
    const engine = testEngine();
    serveEngine({ ...engine, dropTable: () => Promise.reject(new Error("no such table")) }, worker);
    const client = createEngineClient(page);
    await expect(client.dropTable("x")).rejects.toThrow("no such table");
    const pending = client.previewRows({ tableId: "x" });
    client.fail("The background worker stopped.");
    await expect(pending).rejects.toThrow("The background worker stopped.");
    await expect(pending).rejects.toBeInstanceOf(EngineStoppedError);
    await expect(client.dropTable("x")).rejects.toThrow("The background worker stopped.");
  });

  it("tells the worker which sections are unchanged, since a copied draft has new objects", async () => {
    const [page, worker] = endpointPair();
    serveEngine(testEngine(), worker);
    const client = createEngineClient(page);
    const draft = await importExample(client);
    const first = await client.build(draft);
    expect(first.kind === "built" && first.view.rebuilt).toHaveLength(8);
    const same = await client.build(draft);
    expect(same.kind === "built" && same.view.rebuilt).toEqual([]);
    const edited: Draft = { ...draft, specimens: { table: null } };
    const next = await client.build(edited);
    expect(next.kind === "built" && next.view.rebuilt).toEqual(["specimens"]);
  });

  it("starts a new worker after a crash, with the files it held", async () => {
    const spawned: { readonly crash: (reason: string) => void }[] = [];
    const spawn = (): WorkerHandle => {
      const [page, worker] = endpointPair();
      serveEngine(testEngine(), worker);
      const stopListeners: ((reason: string) => void)[] = [];
      spawned.push({ crash: (reason) => stopListeners.forEach((listener) => listener(reason)) });
      return {
        endpoint: page,
        terminate: () => undefined,
        onStopped: (listener) => stopListeners.push(listener),
      };
    };
    const engine = createRestartingEngine(spawn);
    const draft = await importExample(engine);
    const tableId = draft.readCounts.totals?.table.id ?? "";

    const pending = engine.build(draft);
    spawned[0]?.crash("The background worker stopped.");
    await expect(pending).rejects.toBeInstanceOf(EngineStoppedError);

    // The next call starts a new worker, which has the files again.
    const rebuilt = await engine.build(draft);
    expect(spawned).toHaveLength(2);
    expect(rebuilt.kind === "built" && rebuilt.view.overall.pmo).toBe("valid");
    expect(await engine.previewRows({ tableId, limit: 1 })).toMatchObject({ kind: "ready" });
    // A table dropped before a crash is not given to the next worker.
    await engine.dropTable(tableId);
    spawned[1]?.crash("again");
    expect(await engine.previewRows({ tableId })).toEqual({ kind: "missing" });
  });

  it("refuses an answer of the wrong shape", async () => {
    const [page, worker] = endpointPair();
    worker.addEventListener("message", (event) => {
      const data: unknown = event.data;
      if (!isCallMessage(data)) return;
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- not a window
      worker.postMessage({ type: "result", id: data.id, ok: true, value: { text: 1 } });
    });
    const client = createEngineClient(page);
    await expect(client.getPmoText()).rejects.toThrow("unexpected answer to getPmoText");
  });
});
