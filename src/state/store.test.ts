import "fake-indexeddb/auto";

import { File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  TEST_DEPS,
  exampleSuggestMapping,
  fakeParseFile,
  testFieldSet,
} from "@/domain/build/testing";
import {
  createDraftStorage,
  createMemoryBackend,
  isBlob,
  type DraftStorage,
  type KeyValueBackend,
} from "@/domain/draft";
import { EngineStoppedError, type Engine } from "@/worker";
import { createInThreadEngine } from "@/worker/engine";

import type { EditorLock } from "./editorLock";
import { createAppStore, type AppStore } from "./store";

/** Tests run from the repository root. */
const EXAMPLES = join(process.cwd(), "public/examples/");

let prefixCount = 0;
function storage(): DraftStorage {
  prefixCount += 1;
  return createDraftStorage({ databasePrefix: `store-${prefixCount}` });
}

/**
 * Under jsdom, fake-indexeddb cannot clone jsdom's own `File` (it comes back
 * as `{}`), so tests use Node's `File`, which a browser's would match. The
 * guard checks the parts the app uses.
 */
function isUsableFile(value: unknown): value is File {
  return isBlob(value) && "name" in value && typeof value.name === "string";
}

function testFile(parts: readonly string[], name: string): File {
  const file: unknown = new NodeFile([...parts], name);
  if (!isUsableFile(file)) throw new Error("Node's File is not usable here");
  return file;
}

function exampleFile(name: string): File {
  return testFile([readFileSync(`${EXAMPLES}${name}`, "utf8")], name);
}

function makeStore(draftStorage: DraftStorage = storage()): AppStore {
  return createAppStore({
    engine: createInThreadEngine({ parseFile: fakeParseFile, deps: TEST_DEPS }),
    storage: draftStorage,
    rebuildDelayMs: 5,
    saveDelayMs: 5,
    suggestMapping: exampleSuggestMapping,
    getFieldSet: testFieldSet,
    fetchExample: (path) => Promise.resolve(exampleFile(path.replace("examples/", ""))),
  });
}

/** A promise and the function that resolves it. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  const parts: { done?: () => void } = {};
  const promise = new Promise<void>((done) => {
    parts.done = done;
  });
  return { promise, resolve: () => parts.done?.() };
}

function noSave(): Promise<void> {
  return Promise.resolve();
}

async function settle(store: AppStore): Promise<void> {
  await store.getState().actions.flush();
}

describe("app store", () => {
  it("starts fresh, imports a file with a suggested mapping, and rebuilds", async () => {
    const store = makeStore();
    const { actions } = store.getState();
    await actions.initialise();
    expect(store.getState().restore).toEqual({ kind: "fresh" });

    const importing = actions.importFile(
      { section: "microhaplotypes" },
      exampleFile("mad4hatter_allele_data_example.csv"),
    );
    expect(store.getState().imports["microhaplotypes"]).toEqual({
      kind: "importing",
      fileName: "mad4hatter_allele_data_example.csv",
    });
    const outcome = await importing;
    expect(outcome.kind).toBe("imported");
    expect(store.getState().imports).toEqual({});
    const table = store.getState().draft.microhaplotypes.table;
    expect(table?.mapping.fields).toMatchObject({ librarySampleName: "SampleID", reads: "Reads" });

    await settle(store);
    const build = store.getState().build;
    expect(build.phase).toBe("idle");
    expect(build.view?.sections.microhaplotypes).toMatchObject({
      status: "ready",
      summary: { librarySamples: 49 },
    });
    expect(build.view?.overall).toMatchObject({ status: "incomplete" });
    expect(store.getState().persistence.kind).toBe("saved");
  });

  it("debounces rebuilds and rebuilds only the edited section", async () => {
    const store = makeStore();
    const { actions } = store.getState();
    await actions.initialise();
    await settle(store);
    const recordId = store.getState().draft.project.records[0]?.id ?? "";
    actions.setValue({ list: "projects", id: recordId, key: "project_name", value: "P" });
    actions.setValue({ list: "projects", id: recordId, key: "project_description", value: "D" });
    expect(store.getState().build.phase).toBe("pending");
    expect(store.getState().persistence).toEqual({ kind: "unsaved" });
    await settle(store);
    const view = store.getState().build.view;
    expect(view?.rebuilt).toEqual(["project"]);
    expect(view?.sections.project).toMatchObject({ status: "ready", summary: { names: ["P"] } });
  });

  it("restores the draft and its files in a new session", async () => {
    const shared = storage();
    const first = makeStore(shared);
    await first.getState().actions.initialise();
    await first
      .getState()
      .actions.importFile(
        { section: "readCounts", part: "totals" },
        exampleFile("example_raw_reads.txt"),
      );
    first.getState().actions.setMode({ target: "readCountsRunName", mode: "fixed" });
    await settle(first);
    const draft = first.getState().draft;

    const second = makeStore(shared);
    await second.getState().actions.initialise();
    expect(second.getState().draft).toEqual(draft);
    expect(second.getState().restore).toMatchObject({ kind: "restored", missingFiles: [] });
    await settle(second);
    expect(second.getState().build.view?.sections.readCounts).toMatchObject({
      status: "incomplete",
      notices: [expect.objectContaining({ code: "run-name/missing" })],
    });
    second.getState().actions.updateSection("readCounts", (section) => ({
      ...section,
      runName: { ...section.runName, fixedName: "run1" },
    }));
    await settle(second);
    expect(second.getState().build.view?.sections.readCounts).toMatchObject({
      status: "ready",
      summary: { librarySamples: 3 },
    });
  });

  it("sets aside a corrupt saved draft and starts a new one", async () => {
    const drafts = createMemoryBackend();
    await drafts.set("draft", { version: 1, panel: "not a panel" });
    const store = makeStore(
      createDraftStorage({
        openBackend: (name) => (name === "drafts" ? drafts : createMemoryBackend()),
      }),
    );
    await store.getState().actions.initialise();
    expect(store.getState().restore).toEqual({
      kind: "set-aside",
      problem: "draft.microhaplotypes is not an object",
    });
    expect(store.getState().draft.microhaplotypes.table).toBeNull();
    expect((await drafts.keys()).filter((key) => key.startsWith("rejected:"))).toHaveLength(1);
  });

  it("starts over, keeping saved panels", async () => {
    const shared = storage();
    const store = makeStore(shared);
    const { actions } = store.getState();
    await actions.initialise();
    const panelId = store.getState().draft.panel.panels[0]?.id ?? "";
    await actions.importFile(
      { section: "panel", panelId, part: "targets" },
      exampleFile("mad4hatter_panel_info_example.csv"),
    );
    actions.updateItem({
      list: "panels",
      id: panelId,
      recipe: (panel) => ({ ...panel, name: "Mad4hatter" }),
    });
    expect(await actions.savePanelToLibrary(panelId)).toEqual({ ok: true });
    expect(store.getState().savedPanels).toMatchObject({
      kind: "ready",
      panels: [{ name: "Mad4hatter", targetCount: 276 }],
    });
    const tableId = store.getState().draft.panel.panels[0]?.table?.table.id ?? "";

    await actions.startOver();
    expect(store.getState().draft.panel.panels[0]?.table).toBeNull();
    expect(await shared.loadFile(tableId)).toBeNull();
    expect((await shared.listSavedPanels()).map((panel) => panel.name)).toEqual(["Mad4hatter"]);

    const savedId = (await shared.listSavedPanels())[0]?.id ?? "";
    const newPanelId = store.getState().draft.panel.panels[0]?.id ?? "";
    expect(await actions.applySavedPanel(newPanelId, savedId)).toEqual({ ok: true });
    await settle(store);
    expect(store.getState().build.view?.sections.panel).toMatchObject({
      status: "ready",
      summary: { targets: 276 },
    });
  });

  it("starts saving at once when asked, without waiting for a build", async () => {
    const real = storage();
    const engine = createInThreadEngine({ parseFile: fakeParseFile, deps: TEST_DEPS });
    const never = new Promise<never>(() => {});
    const stuck: Engine = { ...engine, build: () => never };
    let saves = 0;
    const counting: DraftStorage = {
      ...real,
      saveDraft: (draft) => {
        saves += 1;
        return real.saveDraft(draft);
      },
    };
    const store = createAppStore({ engine: stuck, storage: counting, saveDelayMs: 60_000 });
    const { actions } = store.getState();
    await actions.initialise();
    actions.updateSection("project", (project) => ({ ...project, mode: "table" }));
    void actions.saveNow();
    expect(saves).toBe(1);
    await vi.waitFor(async () =>
      expect(await real.loadDraft()).toMatchObject({
        kind: "loaded",
        draft: { project: { mode: "table" } },
      }),
    );
  });

  it("saves, then stops saving, when another tab takes over; and takes the draft back from storage", async () => {
    const shared = storage();
    let stepBack: () => Promise<void> = noSave;
    const tab = (claim: "editor" | "elsewhere"): AppStore => {
      const editorLock: EditorLock = {
        claim: () => Promise.resolve(claim),
        takeOver: () => Promise.resolve(),
        onStepBack: (handler) => {
          if (claim === "editor") stepBack = handler;
        },
      };
      const engine = createInThreadEngine({ parseFile: fakeParseFile, deps: TEST_DEPS });
      return createAppStore({ engine, storage: shared, saveDelayMs: 60_000, editorLock });
    };
    const first = tab("editor");
    await first.getState().actions.initialise();
    expect(first.getState().editing).toEqual({ kind: "editor" });

    // The second tab opens while the first edits: it does not save.
    const second = tab("elsewhere");
    await second.getState().actions.initialise();
    expect(second.getState().editing).toEqual({ kind: "other-tab" });
    expect(second.getState().persistence).toEqual({ kind: "other-tab" });
    second.getState().actions.updateSection("project", (p) => ({ ...p, mode: "table" }));
    await second.getState().actions.saveNow();
    expect(await shared.loadDraft()).toEqual({ kind: "none" });

    // The first tab has an unsaved change when the second takes over.
    first.getState().actions.updateSection("sequencing", (p) => ({ ...p, mode: "table" }));
    await stepBack();
    expect(first.getState().editing).toEqual({ kind: "other-tab" });
    expect(await shared.loadDraft()).toMatchObject({ draft: { sequencing: { mode: "table" } } });
    first.getState().actions.updateSection("project", (p) => ({ ...p, mode: "table" }));
    await first.getState().actions.saveNow();
    expect(await shared.loadDraft()).toMatchObject({ draft: { project: { mode: "manual" } } });

    await second.getState().actions.takeOverEditing();
    expect(second.getState().editing).toEqual({ kind: "editor" });
    expect(second.getState().draft.sequencing.mode).toBe("table");
    expect(second.getState().draft.project.mode).toBe("manual");
  });

  it("does not write the draft back when a save is in flight as the user starts over", async () => {
    const real = storage();
    const gate = deferred();
    let saves = 0;
    const slow: DraftStorage = {
      ...real,
      saveDraft: async (draft) => {
        saves += 1;
        await gate.promise;
        return real.saveDraft(draft);
      },
    };
    const store = makeStore(slow);
    const { actions } = store.getState();
    await actions.initialise();
    actions.updateSection("project", (project) => ({ ...project, mode: "table" }));
    const saving = actions.flush();
    await vi.waitFor(() => expect(saves).toBe(1));

    const startingOver = actions.startOver();
    gate.resolve();
    await Promise.all([saving, startingOver]);
    await settle(store);
    expect(await real.loadDraft()).toEqual({ kind: "none" });
  });

  it("saves nothing after the user starts over, however long it is left", async () => {
    const real = storage();
    const store = makeStore(real);
    const { actions } = store.getState();
    await actions.initialise();
    actions.updateSection("project", (project) => ({ ...project, mode: "table" }));
    await settle(store);
    expect(await real.loadDraft()).toMatchObject({ kind: "loaded" });

    await actions.startOver();
    // Longer than the wait before a save, so a save left scheduled would have run.
    await new Promise((resolve) => setTimeout(resolve, 60));
    await settle(store);
    expect(await real.loadDraft()).toEqual({ kind: "none" });
    expect(store.getState().persistence).toMatchObject({ kind: "saved" });
    expect(store.getState().draft.project.mode).toBe("manual");
  });

  it("keeps working for the session when IndexedDB throws", async () => {
    const failing: KeyValueBackend = {
      get: () => Promise.reject(new Error("blocked")),
      set: () => Promise.reject(new Error("blocked")),
      del: () => Promise.reject(new Error("blocked")),
      keys: () => Promise.reject(new Error("blocked")),
    };
    const store = makeStore(createDraftStorage({ openBackend: () => failing }));
    const { actions } = store.getState();
    await actions.initialise();
    expect(store.getState().persistence).toMatchObject({ kind: "session-only" });
    await actions.importFile(
      { section: "microhaplotypes" },
      exampleFile("mad4hatter_allele_data_example.csv"),
    );
    await settle(store);
    expect(store.getState().persistence).toMatchObject({ kind: "session-only" });
    expect(store.getState().build.view?.sections.microhaplotypes.status).toBe("ready");
  });

  it("reports a file that fails to import on its slot", async () => {
    const store = makeStore();
    const { actions } = store.getState();
    await actions.initialise();
    const broken = testFile(["broken"], "bad.csv");
    const outcome = await actions.importFile({ section: "specimens" }, broken);
    expect(outcome.kind).toBe("failed");
    expect(store.getState().imports["specimens"]).toMatchObject({
      kind: "failed",
      notice: { code: "import/unexpected" },
      failure: { code: "unexpected" },
      fileName: "bad.csv",
    });
    expect(store.getState().draft.specimens.table).toBeNull();
  });

  it("loads the example through the import path and builds a valid PMO", async () => {
    const store = makeStore();
    const { actions } = store.getState();
    await actions.initialise();
    expect(await actions.loadExample()).toEqual({ ok: true });
    const draft = store.getState().draft;
    expect(draft.panel.panels[0]?.name).toBe("Mad4hatter");
    expect(draft.specimens.table?.table.id).not.toBe(draft.librarySamples.table?.table.id);
    await settle(store);
    const overall = store.getState().build.view?.overall;
    expect(overall).toMatchObject({ status: "ready", pmo: "valid" });
    expect(overall?.summary).toMatchObject({
      specimens: 50,
      librarySamples: 50,
      librarySamplesWithReadCounts: 3,
    });
    const file = await actions.downloadPmo({ gzip: false });
    expect(file?.fileName).toBe("Mad4hatter.pmo.json");
  });

  it("loads the example with the real modules and the plain suggested mappings", async () => {
    // No stand-ins: the real parser, field sets, matcher and builders, and no
    // fields unmapped by hand. The matcher itself must leave out the
    // pseudo-CIGAR and insert columns that have no chromosome column.
    const store = createAppStore({
      engine: createInThreadEngine(),
      storage: storage(),
      rebuildDelayMs: 5,
      saveDelayMs: 5,
      fetchExample: (path) => Promise.resolve(exampleFile(path.replace("examples/", ""))),
    });
    const { actions } = store.getState();
    await actions.initialise();
    expect(await actions.loadExample()).toEqual({ ok: true });
    const draft = store.getState().draft;
    expect(draft.microhaplotypes.table?.mapping.fields["pseudocigar"]).toBeNull();
    expect(draft.panel.panels[0]?.table?.mapping.fields["insertStart"]).toBeNull();
    await settle(store);
    const view = store.getState().build.view;
    const notices = Object.values(view?.sections ?? {}).flatMap((section) =>
      section.notices.map((notice) => `${notice.code}: ${notice.message}`),
    );
    expect(notices).toEqual([]);
    expect(view?.overall).toMatchObject({ status: "ready", pmo: "valid" });
  });

  it("keeps the newer of two imports into one slot, whichever finishes first", async () => {
    const inner = createInThreadEngine({ parseFile: fakeParseFile, deps: TEST_DEPS });
    const firstHeld = deferred();
    let calls = 0;
    const engine: Engine = {
      ...inner,
      async importFile(input) {
        calls += 1;
        if (calls === 1) await firstHeld.promise;
        return inner.importFile(input);
      },
    };
    const store = createAppStore({
      engine,
      storage: storage(),
      rebuildDelayMs: 5,
      saveDelayMs: 5,
      suggestMapping: exampleSuggestMapping,
      getFieldSet: testFieldSet,
    });
    const { actions } = store.getState();
    await actions.initialise();
    const slot = { section: "readCounts", part: "totals" } as const;
    const older = actions.importFile(slot, exampleFile("example_raw_reads.txt"), "older.txt");
    const newer = await actions.importFile(slot, exampleFile("example_raw_reads.txt"), "newer.txt");
    firstHeld.resolve();
    await older;
    expect(newer.kind).toBe("imported");
    expect(store.getState().draft.readCounts.totals?.table.fileName).toBe("newer.txt");
    expect(store.getState().imports).toEqual({});
  });

  it("keeps a newer finished build when an older one fails afterwards", async () => {
    const inner = createInThreadEngine({ parseFile: fakeParseFile, deps: TEST_DEPS });
    const olderHeld = deferred();
    let calls = 0;
    const engine: Engine = {
      ...inner,
      async build(draft, options) {
        calls += 1;
        if (calls === 2) {
          // The older of the two builds below: it fails, but only after the newer one is done.
          await olderHeld.promise;
          throw new Error("The older build broke.");
        }
        return inner.build(draft, options);
      },
    };
    const store = createAppStore({ engine, storage: storage(), rebuildDelayMs: 60_000 });
    const { actions } = store.getState();
    await actions.initialise();
    await actions.flush();
    expect(calls).toBe(1);

    const recordId = store.getState().draft.project.records[0]?.id ?? "";
    actions.setValue({ list: "projects", id: recordId, key: "project_name", value: "Older" });
    const older = actions.flush();
    actions.setValue({ list: "projects", id: recordId, key: "project_name", value: "Newer" });
    await actions.flush();
    expect(store.getState().build).toMatchObject({ phase: "idle" });
    const newerView = store.getState().build.view;
    expect(newerView?.revision).toBe(2);

    olderHeld.resolve();
    await older;
    expect(store.getState().build).toEqual({ phase: "idle", view: newerView });
  });

  it("says when the worker stopped, and carries on once it builds again", async () => {
    const inner = createInThreadEngine({ parseFile: fakeParseFile, deps: TEST_DEPS });
    let stopped = true;
    const engine: Engine = {
      ...inner,
      build: (draft, options) =>
        stopped
          ? Promise.reject(new EngineStoppedError("The background worker stopped."))
          : inner.build(draft, options),
      importFile: (input) =>
        stopped
          ? Promise.reject(new EngineStoppedError("The background worker stopped."))
          : inner.importFile(input),
    };
    const store = createAppStore({ engine, storage: storage(), rebuildDelayMs: 60_000 });
    const { actions } = store.getState();
    await actions.initialise();
    await actions.flush();
    expect(store.getState().engine).toEqual({
      kind: "stopped",
      message: "The background worker stopped.",
    });
    expect(store.getState().build).toMatchObject({
      phase: "failed",
      message: "The background worker stopped.",
    });

    const outcome = await actions.importFile(
      { section: "specimens" },
      exampleFile("mad4hatter_metadata_example.tsv"),
    );
    expect(outcome).toMatchObject({ kind: "failed", failure: { code: "engine-stopped" } });
    expect(store.getState().imports["specimens"]).toMatchObject({
      kind: "failed",
      failure: { code: "engine-stopped" },
    });

    stopped = false;
    const recordId = store.getState().draft.project.records[0]?.id ?? "";
    actions.setValue({ list: "projects", id: recordId, key: "project_name", value: "P" });
    await actions.flush();
    expect(store.getState().engine).toEqual({ kind: "running" });
    expect(store.getState().build.phase).toBe("idle");
  });

  it("keeps a confirmed match with the table, through a save and a new session", async () => {
    const shared = storage();
    const store = makeStore(shared);
    const { actions } = store.getState();
    await actions.initialise();
    const slot = { section: "specimens" } as const;
    await actions.importFile(slot, exampleFile("mad4hatter_metadata_example.tsv"));
    expect(store.getState().draft.specimens.table?.confirmedMatches).toEqual({});
    actions.confirmMatch(slot, "specimenName", "specimen_id");
    await settle(store);

    const next = makeStore(shared);
    await next.getState().actions.initialise();
    expect(next.getState().draft.specimens.table?.confirmedMatches).toEqual({
      specimenName: "specimen_id",
    });
  });

  it("opens column matching and preview immediately for large streamed allele tables while saveFile finishes in background", async () => {
    const lines = ["SampleID,Target,Seq,Reads"];
    for (let i = 0; i < 2_100; i += 1) {
      lines.push(`S${Math.floor(i / 25)},T${i % 25},ACGT${i % 10},${10 + (i % 90)}`);
    }
    const largeCsv = `${lines.join("\n")}\n`;

    // 1. Slow saveFile that succeeds: draft, mapping and preview appear BEFORE saveFile resolves.
    const real = storage();
    const saveGate: {
      resolve:
        | ((
            result: { readonly ok: true } | { readonly ok: false; readonly reason: string },
          ) => void)
        | null;
    } = { resolve: null };
    let saveCalls = 0;
    const deferredStorage: DraftStorage = {
      ...real,
      saveFile: (id, blob) => {
        saveCalls += 1;
        return new Promise((resolve) => {
          saveGate.resolve = (result) => {
            if (result.ok) {
              void real.saveFile(id, blob).then(resolve);
            } else {
              resolve(result);
            }
          };
        });
      },
    };
    const store = createAppStore({
      engine: createInThreadEngine(),
      storage: deferredStorage,
      rebuildDelayMs: 60_000,
      saveDelayMs: 60_000,
    });
    await store.getState().actions.initialise();

    const outcome = await store
      .getState()
      .actions.importFile({ section: "microhaplotypes" }, testFile([largeCsv], "huge.csv"));
    expect(outcome.kind).toBe("imported");
    if (outcome.kind !== "imported") throw new Error("import failed");
    expect(outcome.table.rowCount).toBeNull();
    expect(saveCalls).toBe(1);

    // Draft table, suggested mapping and preview are already ready before saveFile resolves.
    const mapped = store.getState().draft.microhaplotypes.table;
    expect(mapped?.table.id).toBe(outcome.table.id);
    expect(mapped?.mapping.fields).toMatchObject({
      librarySampleName: "SampleID",
      targetName: "Target",
      seq: "Seq",
      reads: "Reads",
    });
    expect(store.getState().imports).toEqual({});
    const preview = await store.getState().actions.previewRows({
      tableId: outcome.table.id,
      offset: 0,
      limit: 2,
    });
    expect(preview).toMatchObject({ kind: "ready", totalRows: null });

    // Resolving saveFile allows flush() to finish and persists the file.
    const flushing = store.getState().actions.flush();
    saveGate.resolve?.({ ok: true });
    await flushing;
    expect(await real.loadFile(outcome.table.id)).not.toBeNull();
    expect(store.getState().persistence.kind).toBe("saved");

    // 2. Failing background saveFile updates persistence to failed.
    const failingReal = storage();
    const failGate: {
      resolve: ((result: { readonly ok: false; readonly reason: string }) => void) | null;
    } = { resolve: null };
    const failingStorage: DraftStorage = {
      ...failingReal,
      saveFile: () =>
        new Promise((resolve) => {
          failGate.resolve = resolve;
        }),
    };
    const failStore = createAppStore({
      engine: createInThreadEngine(),
      storage: failingStorage,
      rebuildDelayMs: 60_000,
      saveDelayMs: 60_000,
    });
    await failStore.getState().actions.initialise();
    await failStore
      .getState()
      .actions.importFile({ section: "microhaplotypes" }, testFile([largeCsv], "huge-fail.csv"));
    expect(failStore.getState().draft.microhaplotypes.table?.table.fileName).toBe("huge-fail.csv");
    const failFlush = failStore.getState().actions.flush();
    failGate.resolve?.({ ok: false, reason: "Quota exceeded" });
    await failFlush;
    expect(failStore.getState().persistence).toEqual({
      kind: "failed",
      reason: "Quota exceeded",
    });

    // 3. Dropping the table before background saveFile finishes deletes the orphan file.
    const dropReal = storage();
    const deleted: string[] = [];
    const dropGate: { resolve: (() => void) | null } = { resolve: null };
    const dropStorage: DraftStorage = {
      ...dropReal,
      saveFile: (id, blob) =>
        new Promise((resolve) => {
          dropGate.resolve = () => {
            void dropReal.saveFile(id, blob).then(resolve);
          };
        }),
      deleteFile: (id) => {
        deleted.push(id);
        return dropReal.deleteFile(id);
      },
    };
    const dropStore = createAppStore({
      engine: createInThreadEngine(),
      storage: dropStorage,
      rebuildDelayMs: 60_000,
      saveDelayMs: 60_000,
    });
    await dropStore.getState().actions.initialise();
    const dropOutcome = await dropStore
      .getState()
      .actions.importFile({ section: "microhaplotypes" }, testFile([largeCsv], "huge-drop.csv"));
    if (dropOutcome.kind !== "imported") throw new Error("import failed");
    dropStore.getState().actions.removeTable({ section: "microhaplotypes" });
    dropGate.resolve?.();
    await dropStore.getState().actions.saveNow();
    expect(deleted).toContain(dropOutcome.table.id);
    expect(await dropReal.loadFile(dropOutcome.table.id)).toBeNull();
  });
});
