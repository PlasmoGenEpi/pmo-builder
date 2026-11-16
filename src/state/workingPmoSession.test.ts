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
import { createDraftStorage, createMemoryBackend } from "@/domain/draft";
import type { WorkingPmoRequest } from "@/domain/tools/types";
import type { Engine } from "@/worker";
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
