import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { createEmptyDraft, createProjectRecord, type Draft } from "./model";
import { panelContentKey } from "./panels";
import {
  createDraftStorage,
  createMemoryBackend,
  type KeyValueBackend,
  type StoreName,
} from "./persistence";

let databaseCount = 0;
function freshPrefix(): string {
  databaseCount += 1;
  return `test-${databaseCount}`;
}

function draftWithProject(name: string): Draft {
  const draft = createEmptyDraft();
  return {
    ...draft,
    project: { ...draft.project, records: [createProjectRecord({ project_name: name })] },
  };
}

const FRAGMENT = {
  panel_info: [{ panel_name: "P1", reactions: [] }],
  target_info: [{ target_name: "t1" }, { target_name: "t2" }],
};

describe("draft storage on IndexedDB", () => {
  it("keeps the draft, its files and saved panels across sessions", async () => {
    const databasePrefix = freshPrefix();
    const first = createDraftStorage({
      databasePrefix,
      now: () => new Date("2026-02-03T04:05:06Z"),
    });
    expect(await first.probe()).toEqual({ kind: "persistent" });
    const draft = draftWithProject("Study");
    expect(await first.saveDraft(draft)).toEqual({ ok: true });
    expect(await first.saveFile("table-1", new Blob(["a\tb\n1\t2"]))).toEqual({ ok: true });
    const saved = await first.savePanel({ name: "Mad4hatter v1", fragment: FRAGMENT });
    if (!saved.ok) throw new Error(saved.reason);

    const second = createDraftStorage({ databasePrefix });
    expect(await second.loadDraft()).toEqual({
      kind: "loaded",
      draft,
      savedAt: "2026-02-03T04:05:06.000Z",
    });
    const file = await second.loadFile("table-1");
    expect(await file?.text()).toBe("a\tb\n1\t2");
    expect(await second.loadFile("other")).toBeNull();
    expect(await second.listSavedPanels()).toEqual([
      {
        id: saved.panel.id,
        name: "Mad4hatter v1",
        savedAt: "2026-02-03T04:05:06.000Z",
        targetCount: 2,
        contentKey: panelContentKey(FRAGMENT),
      },
    ]);
    expect(await second.loadSavedPanel(saved.panel.id)).toEqual(saved.panel);
    expect(await second.deleteSavedPanel(saved.panel.id)).toEqual({ ok: true });
    expect(await second.listSavedPanels()).toEqual([]);
  });

  it("replaces a saved panel in place when asked", async () => {
    const storage = createDraftStorage({ databasePrefix: freshPrefix() });
    const first = await storage.savePanel({ name: "P", fragment: FRAGMENT });
    if (!first.ok) throw new Error(first.reason);
    const changed = { panel_info: [{ panel_name: "P", targets: [] }], target_info: [] };
    const second = await storage.savePanel({
      name: "P",
      fragment: changed,
      replaceId: first.panel.id,
    });
    if (!second.ok) throw new Error(second.reason);
    const listed = await storage.listSavedPanels();
    expect(listed.map((panel) => panel.id)).toEqual([first.panel.id]);
    expect(listed[0]?.contentKey).toBe(panelContentKey(changed));
    expect(listed[0]?.contentKey).not.toBe(panelContentKey(FRAGMENT));
  });

  it("finds nothing in a new browser", async () => {
    const storage = createDraftStorage({ databasePrefix: freshPrefix() });
    expect(await storage.loadDraft()).toEqual({ kind: "none" });
  });

  it("sets aside a stored draft that fails the guard, without deleting it", async () => {
    const backends = new Map<StoreName, KeyValueBackend>();
    const openBackend = (name: StoreName): KeyValueBackend => {
      const backend = backends.get(name) ?? createMemoryBackend();
      backends.set(name, backend);
      return backend;
    };
    const storage = createDraftStorage({
      openBackend,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    const corrupt = {
      format: "pmo-builder-draft",
      savedAt: "x",
      draft: { ...createEmptyDraft(), panel: { panels: "oops" } },
    };
    await openBackend("drafts").set("draft", corrupt);

    const result = await storage.loadDraft();
    expect(result).toEqual({
      kind: "rejected",
      problem: "draft.panel.panels is not a list",
      rejectedKey: "rejected:2026-01-01T00:00:00.000Z",
    });
    expect(await openBackend("drafts").get("rejected:2026-01-01T00:00:00.000Z")).toEqual(corrupt);
    expect(await storage.loadDraft()).toEqual({ kind: "none" });
  });

  it("keeps only the latest set-aside draft, and drops it once a later session saves a new draft", async () => {
    const backend = createMemoryBackend();
    const keys = async (): Promise<string[]> =>
      (await backend.keys()).filter((key) => key.startsWith("rejected:")).toSorted();
    const corrupt = { format: "pmo-builder-draft", savedAt: "x", draft: { version: 1 } };
    let clock = Date.parse("2026-01-01T00:00:00Z");
    const session = () =>
      createDraftStorage({
        openBackend: () => backend,
        now: () => {
          clock += 1000;
          return new Date(clock);
        },
      });

    // Two sessions in a row find a broken draft: only the newest is kept.
    await backend.set("draft", corrupt);
    expect(await session().loadDraft()).toMatchObject({ kind: "rejected" });
    await backend.set("draft", corrupt);
    const second = session();
    const result = await second.loadDraft();
    expect(result).toMatchObject({ kind: "rejected" });
    const kept = result.kind === "rejected" ? result.rejectedKey : "";
    expect(await keys()).toEqual([kept]);

    // The session that reported it keeps it while the user starts a new draft.
    await second.saveDraft(createEmptyDraft());
    expect(await keys()).toEqual([kept]);

    // A later session that saves drops it, without being told again.
    const third = session();
    expect(await third.loadDraft()).toMatchObject({ kind: "loaded" });
    expect(await keys()).toEqual([kept]);
    await third.saveDraft(draftWithProject("P"));
    expect(await keys()).toEqual([]);
  });

  it("rejects a draft from another version with a plain reason", async () => {
    const databasePrefix = freshPrefix();
    const storage = createDraftStorage({ databasePrefix });
    await storage.saveDraft({ ...createEmptyDraft() });
    const backend = createMemoryBackend();
    await backend.set("draft", { ...createEmptyDraft(), version: 99 });
    const old = createDraftStorage({ openBackend: () => backend });
    expect(await old.loadDraft()).toMatchObject({
      kind: "rejected",
      problem: "The saved draft is version 99; this app reads version 1.",
    });
  });

  it("starts over by clearing the draft and its files but keeping saved panels", async () => {
    const storage = createDraftStorage({ databasePrefix: freshPrefix() });
    await storage.saveDraft(draftWithProject("Study"));
    await storage.saveFile("a", new Blob(["1"]));
    await storage.saveFile("b", new Blob(["2"]));
    await storage.savePanel({ name: "Kept", fragment: FRAGMENT });

    expect(await storage.clearDraft()).toEqual({ ok: true });
    expect(await storage.loadDraft()).toEqual({ kind: "none" });
    expect(await storage.loadFile("a")).toBeNull();
    expect(await storage.loadFile("b")).toBeNull();
    expect((await storage.listSavedPanels()).map((panel) => panel.name)).toEqual(["Kept"]);
  });

  it("starts over by also removing a draft set aside because it could not be opened", async () => {
    const backends = new Map<StoreName, KeyValueBackend>();
    const openBackend = (name: StoreName): KeyValueBackend => {
      const opened = backends.get(name) ?? createMemoryBackend();
      backends.set(name, opened);
      return opened;
    };
    const backend = openBackend("drafts");
    const storage = createDraftStorage({ openBackend });
    await backend.set("draft", {
      format: "pmo-builder-draft",
      savedAt: "x",
      draft: { version: 1 },
    });
    expect(await storage.loadDraft()).toMatchObject({ kind: "rejected" });
    expect((await backend.keys()).some((key) => key.startsWith("rejected:"))).toBe(true);

    expect(await storage.clearDraft()).toEqual({ ok: true });
    expect(await backend.keys()).toEqual([]);
  });

  it("prunes files the draft no longer refers to", async () => {
    const storage = createDraftStorage({ databasePrefix: freshPrefix() });
    await storage.saveFile("keep", new Blob(["1"]));
    await storage.saveFile("drop", new Blob(["2"]));
    await storage.pruneFiles(["keep"]);
    expect(await storage.loadFile("keep")).not.toBeNull();
    expect(await storage.loadFile("drop")).toBeNull();
  });
});

function rejectInsecure(): Promise<never> {
  return Promise.reject(new Error("The operation is insecure."));
}

function throwingBackend(): KeyValueBackend {
  return { get: rejectInsecure, set: rejectInsecure, del: rejectInsecure, keys: rejectInsecure };
}

describe("draft storage without IndexedDB", () => {
  it("keeps working for the session when IndexedDB fails, and says the draft will not be kept", async () => {
    const storage = createDraftStorage({ openBackend: throwingBackend });
    const availability = await storage.probe();
    expect(availability).toEqual({
      kind: "session-only",
      reason:
        "This browser is not letting the app save data (The operation is insecure.). Your work is kept until you close this tab.",
    });
    const draft = draftWithProject("Session");
    expect(await storage.saveDraft(draft)).toEqual({ ok: true });
    expect(await storage.loadDraft()).toMatchObject({ kind: "loaded", draft });
    expect((await storage.savePanel({ name: "P", fragment: FRAGMENT })).ok).toBe(true);
    expect(await storage.listSavedPanels()).toHaveLength(1);
    expect(storage.availability().kind).toBe("session-only");
  });

  it("does not throw when IndexedDB is missing altogether", async () => {
    const storage = createDraftStorage({
      openBackend: () => {
        throw new ReferenceError("indexedDB is not defined");
      },
    });
    await expect(storage.loadDraft()).resolves.toEqual({ kind: "none" });
    expect(storage.availability().kind).toBe("session-only");
    await expect(storage.saveFile("x", new Blob(["1"]))).resolves.toEqual({ ok: true });
    await expect(storage.clearDraft()).resolves.toEqual({ ok: true });
  });

  it("falls back to memory when IndexedDB starts failing mid-session", async () => {
    let healthy = true;
    const memory = createMemoryBackend();
    const flaky: KeyValueBackend = {
      get: (key) => (healthy ? memory.get(key) : Promise.reject(new Error("quota"))),
      set: (key, value) => (healthy ? memory.set(key, value) : Promise.reject(new Error("quota"))),
      del: (key) => (healthy ? memory.del(key) : Promise.reject(new Error("quota"))),
      keys: () => (healthy ? memory.keys() : Promise.reject(new Error("quota"))),
    };
    const storage = createDraftStorage({ openBackend: () => flaky });
    expect(await storage.probe()).toEqual({ kind: "persistent" });
    healthy = false;
    expect(await storage.saveDraft(createEmptyDraft())).toEqual({ ok: true });
    expect(storage.availability().kind).toBe("session-only");
  });
});
