import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { EXAMPLE_MAPPINGS, exampleBlob } from "@/domain/build/testing";
import {
  checkDraft,
  createDraftStorage,
  createEmptyDraft,
  createMemoryBackend,
  createProjectRecord,
  isDraft,
  type Draft,
  type MappedTable,
  type TableRef,
} from "@/domain/draft";
import type { ColumnMapping } from "@/domain/types";
import {
  createAppStore,
  instrumentAppStore,
  ANALYTICS_RECORDER,
  type UsageRecorder,
} from "@/state";
import { endpointPair } from "@/test/workers";

import {
  EngineStoppedError,
  createEngineClient,
  createRestartingEngine,
  type WorkerHandle,
} from "./client";
import { createInThreadEngine, type ImportOutcome } from "./engine";
import { isCallMessage, isProgressMessage, serveEngine, type ProgressMessage } from "./protocol";
import type { BuildProgress } from "./types";

const EXAMPLES = join(process.cwd(), "public/examples/");

function imported(outcome: ImportOutcome): TableRef {
  if (outcome.kind !== "imported") throw new Error(outcome.notice.message);
  return outcome.table;
}

function mapped(table: TableRef, mapping: ColumnMapping): MappedTable {
  return { table, mapping };
}

function makeAlleleCsv(rowCount: number, options?: { readonly includeRun?: boolean }): string {
  const includeRun = options?.includeRun ?? false;
  const header = includeRun ? "SampleID,Target,Seq,Reads,RunName" : "SampleID,Target,Seq,Reads";
  const lines = [header];
  for (let i = 0; i < rowCount; i += 1) {
    const sample = `S${Math.floor(i / 25)}`;
    const target = `T${i % 25}`;
    const seq = `ACGT${String(i % 10).padStart(2, "0")}`;
    const reads = String(10 + (i % 90));
    lines.push(
      includeRun
        ? `${sample},${target},${seq},${reads},run_${i % 3}`
        : `${sample},${target},${seq},${reads}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

const SYNTHETIC_MAPPING: ColumnMapping = {
  fields: {
    librarySampleName: "SampleID",
    targetName: "Target",
    seq: "Seq",
    reads: "Reads",
  },
  additionalColumns: [],
};

describe("streaming microhaplotypes engine", () => {
  it("streams plain and gzipped allele tables, leaves rowCount null past preview scan, and updates exactRowCount after build", async () => {
    const engine = createInThreadEngine();

    // Small gzipped file (<= PREVIEW_SCAN_ROWS): exact rowCount known immediately on import.
    const exampleCsv = readFileSync(`${EXAMPLES}mad4hatter_allele_data_example.csv`);
    const gzExample = new Blob([gzipSync(exampleCsv)]);
    const smallRef = imported(
      await engine.importFile({
        file: gzExample,
        fileName: "mad4hatter_allele_data_example.csv.gz",
        stream: true,
      }),
    );
    expect(smallRef.rowCount).toBe(981);
    expect(smallRef.format).toBe("delimited");

    // Large file (> PREVIEW_SCAN_ROWS = 2,000): rowCount is null until Pass 1 finishes.
    const bigCsv = makeAlleleCsv(2_500, { includeRun: true });
    const bigGz = new Blob([gzipSync(Buffer.from(bigCsv, "utf8"))]);
    const bigRef = imported(
      await engine.importFile({
        file: bigGz,
        fileName: "large_alleles.csv.gz",
        stream: true,
      }),
    );
    expect(bigRef.rowCount).toBeNull();
    expect(bigRef.columns).toEqual(["SampleID", "Target", "Seq", "Reads", "RunName"]);

    // Preview within cached rows serves immediately with totalRows: null.
    const firstPage = await engine.previewRows({ tableId: bigRef.id, offset: 0, limit: 3 });
    expect(firstPage).toMatchObject({
      kind: "ready",
      columns: ["SampleID", "Target", "Seq", "Reads", "RunName"],
      offset: 0,
      totalRows: null,
    });
    if (firstPage.kind !== "ready") throw new Error("expected ready preview");
    expect(firstPage.rows).toHaveLength(3);
    expect(firstPage.rows[0]).toMatchObject({ SampleID: "S0", Target: "T0", RunName: "run_0" });

    // Preview beyond PREVIEW_KEEP_ROWS (200) stream-skips to the requested offset.
    const latePage = await engine.previewRows({ tableId: bigRef.id, offset: 250, limit: 2 });
    expect(latePage).toMatchObject({ kind: "ready", offset: 250, totalRows: null });
    if (latePage.kind !== "ready") throw new Error("expected ready late preview");
    expect(latePage.rows).toHaveLength(2);
    expect(latePage.rows[0]).toMatchObject({ SampleID: "S10", Target: "T0" });

    // distinctValues streams with early exit at limit.
    expect(
      await engine.distinctValues({ tableId: bigRef.id, column: "RunName", limit: 10 }),
    ).toEqual({
      values: ["run_0", "run_1", "run_2"],
      truncated: false,
    });
    expect(
      await engine.distinctValues({ tableId: bigRef.id, column: "SampleID", limit: 2 }),
    ).toEqual({
      values: ["S0", "S1"],
      truncated: true,
    });
    expect(await engine.distinctValues({ tableId: bigRef.id, column: "NoSuchCol" })).toBeNull();

    // Build runs two-pass streaming builder, updates exactRowCount, and populates runNames suggestions.
    const empty = createEmptyDraft();
    const draft: Draft = {
      ...empty,
      microhaplotypes: {
        table: mapped(bigRef, SYNTHETIC_MAPPING),
        runName: { mode: "column", fixedName: "", column: "RunName" },
        representativeColumns: [],
      },
    };
    const built = await engine.build(draft, { creationDate: "2026-01-01" });
    if (built.kind !== "built") throw new Error("expected built outcome");
    expect(built.view.sections.microhaplotypes).toMatchObject({
      status: "ready",
      summary: { rows: 2_500, librarySamples: 100, targets: 25 },
    });
    expect(built.view.suggestions.runNames).toEqual(["run_0", "run_1", "run_2"]);

    // Subsequent previewRows now reports the exact totalRows learned from Pass 1.
    const afterBuild = await engine.previewRows({ tableId: bigRef.id, offset: 0, limit: 2 });
    expect(afterBuild).toMatchObject({ kind: "ready", totalRows: 2_500 });
  });

  it("falls back transparently to workbook parsing when stream is true for an .xlsx file", async () => {
    const engine = createInThreadEngine();
    const xlsx = exampleBlob("PMO_building_template.xlsx");
    const table = imported(
      await engine.importFile({
        file: xlsx,
        fileName: "PMO_building_template.xlsx",
        stream: true,
      }),
    );
    expect(table.format).toBe("xlsx");
    expect(table.sheetNames).not.toBeNull();
    expect((table.sheetNames ?? []).length).toBeGreaterThan(1);
    expect(table.rowCount).toBeTypeOf("number");

    // Restoring an .xlsx with stream: true also falls back cleanly.
    await engine.restoreFile({
      tableId: "restored-xlsx",
      file: xlsx,
      fileName: "PMO_building_template.xlsx",
      sheetName: table.sheetName,
      stream: true,
    });
    const preview = await engine.previewRows({ tableId: "restored-xlsx", limit: 2 });
    expect(preview).toMatchObject({ kind: "ready", totalRows: table.rowCount });
  });

  it("re-reads the stored Blob when remapping and reuses the memo when other sections change", async () => {
    const progressEvents: BuildProgress[] = [];
    const engine = createInThreadEngine({
      onProgress: (progress) => progressEvents.push(progress),
    });

    const csv = makeAlleleCsv(2_200, { includeRun: true });
    const table = imported(
      await engine.importFile({
        file: new Blob([csv]),
        fileName: "alleles.csv",
        stream: true,
      }),
    );
    expect(table.rowCount).toBeNull();

    const empty = createEmptyDraft();
    const initial: Draft = {
      ...empty,
      microhaplotypes: {
        table: mapped(table, SYNTHETIC_MAPPING),
        runName: { mode: "none", fixedName: "", column: null },
        representativeColumns: [],
      },
    };
    const first = await engine.build(initial);
    if (first.kind !== "built") throw new Error("superseded");
    expect(first.view.sections.microhaplotypes).toMatchObject({
      status: "ready",
      summary: { rows: 2_200 },
    });
    expect(progressEvents.some((p) => p.phase === "reading" && p.stage === "checking")).toBe(true);
    expect(progressEvents.some((p) => p.phase === "reading" && p.stage === "building")).toBe(true);
    expect(progressEvents.at(-1)).toEqual({ phase: "idle" });

    // Editing another section (project) hits the microhaplotypes memo and does NOT re-read the allele file.
    progressEvents.length = 0;
    const editedProject: Draft = {
      ...initial,
      project: {
        ...initial.project,
        records: [createProjectRecord({ project_name: "StudyA", project_description: "Desc" })],
      },
    };
    const second = await engine.build(editedProject);
    if (second.kind !== "built") throw new Error("superseded");
    expect(second.view.rebuilt).toEqual(["project"]);
    expect(progressEvents).toEqual([]);

    // Changing a column mapping (adding RunName column) re-reads the stored Blob and rebuilds.
    const remapped: Draft = {
      ...editedProject,
      microhaplotypes: {
        ...editedProject.microhaplotypes,
        runName: { mode: "column", fixedName: "", column: "RunName" },
      },
    };
    const third = await engine.build(remapped);
    if (third.kind !== "built") throw new Error("superseded");
    expect(third.view.rebuilt).toEqual(["microhaplotypes"]);
    expect(third.view.sections.microhaplotypes).toMatchObject({
      status: "ready",
      summary: { rows: 2_200, runNames: ["run_0", "run_1", "run_2"] },
    });
    expect(third.view.suggestions.runNames).toEqual(["run_0", "run_1", "run_2"]);
    expect(progressEvents.some((p) => p.phase === "reading")).toBe(true);
    expect(progressEvents.at(-1)).toEqual({ phase: "idle" });
  });

  it("persists a draft with rowCount: null and restores it in streaming mode via DraftStorage", async () => {
    const backends = new Map<string, ReturnType<typeof createMemoryBackend>>();
    const storage = createDraftStorage({
      openBackend: (name) => {
        const existing = backends.get(name);
        if (existing !== undefined) return existing;
        const created = createMemoryBackend();
        backends.set(name, created);
        return created;
      },
    });

    const firstStore = createAppStore({
      engine: createInThreadEngine(),
      storage,
      rebuildDelayMs: 1,
      saveDelayMs: 1,
    });
    await firstStore.getState().actions.initialise();

    const csv = makeAlleleCsv(2_100);
    const outcome = await firstStore
      .getState()
      .actions.importFile({ section: "microhaplotypes" }, new Blob([csv]), "big.csv");
    expect(outcome.kind).toBe("imported");
    if (outcome.kind !== "imported") throw new Error("import failed");
    expect(outcome.table.rowCount).toBeNull();
    await firstStore.getState().actions.flush();

    // Draft with rowCount: null passes the draft guard and reloads cleanly.
    const savedDraft = firstStore.getState().draft;
    expect(isDraft(savedDraft)).toBe(true);
    expect(checkDraft(JSON.parse(JSON.stringify(savedDraft)))).toMatchObject({ ok: true });

    const secondStore = createAppStore({
      engine: createInThreadEngine(),
      storage,
      rebuildDelayMs: 1,
      saveDelayMs: 1,
    });
    await secondStore.getState().actions.initialise();
    await secondStore.getState().actions.flush();
    expect(secondStore.getState().restore).toMatchObject({ kind: "restored", missingFiles: [] });
    expect(secondStore.getState().draft.microhaplotypes.table?.table.rowCount).toBeNull();
    expect(secondStore.getState().build.view?.sections.microhaplotypes).toMatchObject({
      status: "ready",
      summary: { rows: 2_100 },
    });
  });

  it("records a non-zero row bucket in usage counts when a large streamed file has rowCount: null", async () => {
    const recorded: { readonly table: string; readonly rows: number }[] = [];
    const recorder: UsageRecorder = {
      ...ANALYTICS_RECORDER,
      recordTableImported: (input) => recorded.push({ table: input.table, rows: input.rows }),
      recordSectionStatus: () => undefined,
      recordValidation: () => undefined,
      recordBuild: () => undefined,
      recordIssue: () => undefined,
    };
    const store = createAppStore({
      engine: createInThreadEngine(),
      storage: createDraftStorage({ openBackend: () => createMemoryBackend() }),
      rebuildDelayMs: 1,
      saveDelayMs: 1,
    });
    instrumentAppStore(store, recorder);
    await store.getState().actions.initialise();

    await store
      .getState()
      .actions.importFile(
        { section: "microhaplotypes" },
        new Blob([makeAlleleCsv(2_100)]),
        "big.csv",
      );
    expect(recorded).toEqual([{ table: "microhaplotypes", rows: 2_001 }]);
  });

  it("supersedes a streamed build mid-stream and resets progress to idle", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    let streamOpens = 0;
    const baseText = new TextEncoder().encode(makeAlleleCsv(2_100));
    // A Blob whose third stream open (Pass 2, after Pass 1 has emitted reading progress) pauses mid-stream.
    class GatedBlob extends Blob {
      override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
        streamOpens += 1;
        const openNumber = streamOpens;
        let offset = 0;
        const step = 4_096;
        return new ReadableStream<Uint8Array<ArrayBuffer>>({
          async pull(controller) {
            if (openNumber === 3 && offset > 0 && gate.release === null) {
              await new Promise<void>((resolve) => {
                gate.release = resolve;
              });
            }
            if (offset >= baseText.byteLength) {
              controller.close();
              return;
            }
            const end = Math.min(offset + step, baseText.byteLength);
            controller.enqueue(baseText.slice(offset, end));
            offset = end;
          },
        });
      }
    }
    const gatedBlob = new GatedBlob([baseText]);

    const progressEvents: BuildProgress[] = [];
    const engine = createInThreadEngine({
      onProgress: (progress) => progressEvents.push(progress),
    });
    const table = imported(
      await engine.importFile({ file: gatedBlob, fileName: "gated.csv", stream: true }),
    );
    const empty = createEmptyDraft();
    const draft1: Draft = {
      ...empty,
      microhaplotypes: {
        table: mapped(table, SYNTHETIC_MAPPING),
        runName: { mode: "none", fixedName: "", column: null },
        representativeColumns: [],
      },
    };
    const firstBuild = engine.build(draft1);
    // Wait until Pass 2 pauses on the gated chunk.
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (gate.release !== null) resolve();
        else setTimeout(check, 5);
      };
      check();
    });

    // Supersede by removing the table before the first build resumes.
    const secondBuild = engine.build(empty);
    gate.release?.();

    expect(await firstBuild).toEqual({ kind: "superseded" });
    const latest = await secondBuild;
    expect(latest.kind).toBe("built");
    expect(progressEvents.some((p) => p.phase === "reading" && p.stage === "checking")).toBe(true);
    expect(progressEvents.at(-1)).toEqual({ phase: "idle" });
  });
});

describe("streaming worker protocol and progress", () => {
  it("validates ProgressMessage shapes strictly with isProgressMessage", () => {
    expect(isProgressMessage({ type: "progress", progress: { phase: "idle" } })).toBe(true);
    expect(
      isProgressMessage({
        type: "progress",
        progress: {
          phase: "reading",
          stage: "checking",
          bytesRead: 100,
          totalBytes: 1000,
          rowsRead: 50,
        },
      }),
    ).toBe(true);
    expect(
      isProgressMessage({
        type: "progress",
        progress: {
          phase: "reading",
          stage: "building",
          bytesRead: 1000,
          totalBytes: 1000,
          rowsRead: 500,
        },
      }),
    ).toBe(true);
    expect(isProgressMessage({ type: "result", id: 1, ok: true, value: null })).toBe(false);
    expect(
      isProgressMessage({
        type: "progress",
        progress: {
          phase: "reading",
          stage: "other",
          bytesRead: 0,
          totalBytes: 1,
          rowsRead: 0,
        },
      }),
    ).toBe(false);
    expect(
      isProgressMessage({
        type: "progress",
        progress: {
          phase: "reading",
          stage: "checking",
          bytesRead: Number.NaN,
          totalBytes: 1,
          rowsRead: 0,
        },
      }),
    ).toBe(false);
  });

  it("delivers progress messages across the worker boundary and resets to idle on crash", async () => {
    const progressEvents: BuildProgress[] = [];
    const spawned: { readonly crash: (reason: string) => void }[] = [];

    const spawn = (): WorkerHandle => {
      const [page, worker] = endpointPair();
      const inner = createInThreadEngine({
        onProgress: (progress) => {
          const message: ProgressMessage = { type: "progress", progress };
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- not a window
          worker.postMessage(message);
        },
      });
      serveEngine(inner, worker);
      const stopListeners: ((reason: string) => void)[] = [];
      spawned.push({ crash: (reason) => stopListeners.forEach((listener) => listener(reason)) });
      return {
        endpoint: page,
        terminate: () => undefined,
        onStopped: (listener) => stopListeners.push(listener),
      };
    };

    const engine = createRestartingEngine(spawn, {
      onProgress: (progress) => progressEvents.push(progress),
    });

    const table = imported(
      await engine.importFile({
        file: new Blob([makeAlleleCsv(2_100)]),
        fileName: "alleles.csv",
        stream: true,
      }),
    );
    expect(table.rowCount).toBeNull();
    const empty = createEmptyDraft();
    const draft: Draft = {
      ...empty,
      microhaplotypes: {
        table: mapped(table, SYNTHETIC_MAPPING),
        runName: { mode: "none", fixedName: "", column: null },
        representativeColumns: [],
      },
    };
    const built = await engine.build(draft);
    expect(built.kind).toBe("built");
    expect(progressEvents.some((p) => p.phase === "reading" && p.stage === "checking")).toBe(true);
    expect(progressEvents.some((p) => p.phase === "reading" && p.stage === "building")).toBe(true);
    expect(progressEvents.at(-1)).toEqual({ phase: "idle" });

    // Crash emits idle progress and preserves stream: true when restoring onto the restarted worker.
    progressEvents.length = 0;
    const inFlight = engine.build({ ...draft, project: { ...draft.project, mode: "table" } });
    spawned[0]?.crash("Worker stopped.");
    await expect(inFlight).rejects.toBeInstanceOf(EngineStoppedError);
    expect(progressEvents).toContainEqual({ phase: "idle" });

    const rebuilt = await engine.build(draft);
    if (rebuilt.kind !== "built") throw new Error("expected rebuilt outcome");
    expect(rebuilt.view.sections.microhaplotypes).toMatchObject({
      status: "ready",
      summary: { rows: 2_100 },
    });
  });

  it("accepts previewRows with null or numeric totalRows and rejects invalid totalRows", async () => {
    const [pageOk, workerOk] = endpointPair();
    workerOk.addEventListener("message", (event) => {
      const data: unknown = event.data;
      if (!isCallMessage(data)) return;
      const reply = {
        type: "result",
        id: data.id,
        ok: true,
        value: { kind: "ready", columns: ["a"], rows: [{ a: "1" }], offset: 0, totalRows: null },
      };
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- not a window
      workerOk.postMessage(reply);
    });
    const clientOk = createEngineClient(pageOk);
    expect(await clientOk.previewRows({ tableId: "t1" })).toEqual({
      kind: "ready",
      columns: ["a"],
      rows: [{ a: "1" }],
      offset: 0,
      totalRows: null,
    });

    const [pageBad, workerBad] = endpointPair();
    workerBad.addEventListener("message", (event) => {
      const data: unknown = event.data;
      if (!isCallMessage(data)) return;
      const reply = {
        type: "result",
        id: data.id,
        ok: true,
        value: { kind: "ready", columns: ["a"], rows: [], offset: 0, totalRows: "many" },
      };
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- not a window
      workerBad.postMessage(reply);
    });
    const clientBad = createEngineClient(pageBad);
    await expect(clientBad.previewRows({ tableId: "t1" })).rejects.toThrow(
      "unexpected answer to previewRows",
    );
  });

  it("builds the real example allele table identically via streaming", async () => {
    const engine = createInThreadEngine();
    const alleles = imported(
      await engine.importFile({
        file: exampleBlob("mad4hatter_allele_data_example.csv"),
        fileName: "mad4hatter_allele_data_example.csv",
        stream: true,
      }),
    );
    const empty = createEmptyDraft();
    const draft: Draft = {
      ...empty,
      microhaplotypes: {
        ...empty.microhaplotypes,
        table: mapped(alleles, EXAMPLE_MAPPINGS.alleles),
      },
    };
    const outcome = await engine.build(draft);
    if (outcome.kind !== "built") throw new Error("superseded");
    expect(outcome.view.sections.microhaplotypes).toMatchObject({
      status: "ready",
      summary: { rows: 981, librarySamples: 49, targets: 21 },
    });
  });

  it("handles late Windows-1252 fallback cleanly in previewRows past row 200 after non-ASCII UTF-8", async () => {
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [encoder.encode("id,site\n")];
    // Row 1 (index 0) holds valid UTF-8 ("é"), which decodes as "Ã©" in Windows-1252.
    parts.push(new Uint8Array([...encoder.encode("1,"), 0xc3, 0xa9, 0x0a]));
    for (let i = 2; i <= 2_100; i += 1) {
      parts.push(encoder.encode(`${i},ASCII_${i}\n`));
    }
    // Row 2101 (index 2100) has 0xe9 (invalid UTF-8 -> "é" in Windows-1252), past PREVIEW_SCAN_ROWS.
    parts.push(new Uint8Array([...encoder.encode("2101,S"), 0xe3, 0x6f, 0x0a]));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const combined = new Uint8Array(total);
    let pos = 0;
    for (const part of parts) {
      combined.set(part, pos);
      pos += part.length;
    }

    const engine = createInThreadEngine();
    const table = imported(
      await engine.importFile({
        file: new Blob([combined]),
        fileName: "late-preview.csv",
        stream: true,
      }),
    );
    expect(table.rowCount).toBeNull();

    // Streaming past row 200 hits the late CP-1252 byte after yielding non-ASCII UTF-8 chunks,
    // restarts cleanly via onRestart, and returns consistent Windows-1252 rows.
    const latePage = await engine.previewRows({ tableId: table.id, offset: 2_099, limit: 5 });
    expect(latePage).toMatchObject({
      kind: "ready",
      offset: 2_099,
      rows: [
        { id: "2100", site: "ASCII_2100" },
        { id: "2101", site: "São" },
      ],
    });

    // Cached preview rows and encoding are refreshed to Windows-1252 too.
    const firstPage = await engine.previewRows({ tableId: table.id, offset: 0, limit: 1 });
    expect(firstPage).toMatchObject({
      kind: "ready",
      rows: [{ id: "1", site: "Ã©" }],
    });
  });

  it("releases stale latestPmo before a streamed allele rebuild and retains it on non-allele edits", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    let streamOpens = 0;
    const alleleBytes = new TextEncoder().encode(makeAlleleCsv(2_100, { includeRun: true }));
    // Opens: 1 = inspect, 2 = build1 Pass 1, 3 = build1 Pass 2, 4 = rebuild Pass 1 (paused).
    class RebuildGatedBlob extends Blob {
      override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
        streamOpens += 1;
        const openNumber = streamOpens;
        let offset = 0;
        const step = 8_192;
        return new ReadableStream<Uint8Array<ArrayBuffer>>({
          async pull(controller) {
            if (openNumber === 4 && offset > 0 && gate.release === null) {
              await new Promise<void>((resolve) => {
                gate.release = resolve;
              });
            }
            if (offset >= alleleBytes.byteLength) {
              controller.close();
              return;
            }
            const end = Math.min(offset + step, alleleBytes.byteLength);
            controller.enqueue(alleleBytes.slice(offset, end));
            offset = end;
          },
        });
      }
    }

    const engine = createInThreadEngine();
    const alleles = imported(
      await engine.importFile({
        file: new RebuildGatedBlob([alleleBytes]),
        fileName: "gated_alleles.csv",
        stream: true,
      }),
    );
    // Minimal panel matching targets T0..T24 with distinct primer pairs so the merged PMO builds.
    const bases = ["A", "C", "G", "T"] as const;
    const tagOf = (n: number): string =>
      `${bases[n % 4] ?? "A"}${bases[Math.floor(n / 4) % 4] ?? "A"}${bases[Math.floor(n / 16) % 4] ?? "A"}`;
    const panelLines = [
      "target_name,forward_primer,reverse_primer",
      ...Array.from(
        { length: 25 },
        (_, i) => `T${i},ACGTACGTACGT${tagOf(i)},TGCATGCATGCA${tagOf(i)}`,
      ),
    ].join("\n");
    const panel = imported(
      await engine.importFile({
        file: new Blob([`${panelLines}\n`]),
        fileName: "panel.csv",
      }),
    );

    const empty = createEmptyDraft();
    const firstPanel = empty.panel.panels[0];
    if (firstPanel === undefined) throw new Error("missing default panel");
    const panelMapping: ColumnMapping = {
      fields: {
        targetName: "target_name",
        forwardPrimersSeq: "forward_primer",
        reversePrimersSeq: "reverse_primer",
      },
      additionalColumns: [],
    };
    const draft1: Draft = {
      ...empty,
      microhaplotypes: {
        table: mapped(alleles, SYNTHETIC_MAPPING),
        runName: { mode: "none", fixedName: "", column: null },
        representativeColumns: [],
      },
      panel: {
        panels: [{ ...firstPanel, name: "P1", table: mapped(panel, panelMapping) }],
      },
    };

    const first = await engine.build(draft1, { creationDate: "2026-01-01" });
    if (first.kind !== "built") throw new Error("first build superseded");
    expect(first.view.overall.pmo).not.toBe("none");
    expect(await engine.getPmoText({ maxLength: 50 })).not.toBeNull();
    expect(streamOpens).toBe(3);

    // Non-allele edit hits the microhaplotypes memo: stream is not opened again and latestPmo stays intact.
    const draftProject: Draft = {
      ...draft1,
      project: {
        ...draft1.project,
        records: [createProjectRecord({ project_name: "Study1", project_description: "Desc" })],
      },
    };
    const second = await engine.build(draftProject, { creationDate: "2026-01-01" });
    if (second.kind !== "built") throw new Error("second build superseded");
    expect(second.view.rebuilt).toEqual(["project"]);
    expect(streamOpens).toBe(3);
    expect(await engine.getPmoText({ maxLength: 50 })).not.toBeNull();

    // Allele edit triggers a streamed rebuild and releases latestPmo/caches BEFORE Pass 2 allocates.
    const draftRebuild: Draft = {
      ...draftProject,
      microhaplotypes: {
        ...draftProject.microhaplotypes,
        runName: { mode: "fixed", fixedName: "run_fixed", column: null },
      },
    };
    const rebuilding = engine.build(draftRebuild, { creationDate: "2026-01-01" });
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (gate.release !== null) resolve();
        else setTimeout(check, 5);
      };
      check();
    });

    // While the streamed rebuild is paused, stale PMO caches must already be released.
    expect(await engine.getPmoText({ maxLength: 50 })).toBeNull();
    expect(await engine.getPmoFile({ gzip: false })).toBeNull();
    expect(await engine.getPmoFileSize({ gzip: false })).toBeNull();

    gate.release?.();
    const third = await rebuilding;
    if (third.kind !== "built") throw new Error("third build superseded");
    expect(third.view.rebuilt).toEqual(["microhaplotypes"]);
    expect(third.view.sections.microhaplotypes.summary?.runNames).toEqual(["run_fixed"]);
    expect(await engine.getPmoText({ maxLength: 50 })).not.toBeNull();
  });
});
