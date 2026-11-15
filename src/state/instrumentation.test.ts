/**
 * Usage counts through the real `@/analytics` module: a session that loads
 * the example, changes a match and downloads the PMO, and what its record
 * holds. Like `src/analytics/leak.test.ts`, it then checks that nothing in
 * the record (or the log) holds a file name, column name or cell value from
 * the example files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import * as analytics from "@/analytics";
import { createDraftStorage, createMemoryBackend } from "@/domain/draft";
import { createInThreadEngine } from "@/worker/engine";

import { EXAMPLE_FILES } from "./example";
import {
  ANALYTICS_RECORDER,
  importIssueCode,
  instrumentAppStore,
  type UsageRecorder,
} from "./instrumentation";
import { createAppStore, type AppStore } from "./store";

const EXAMPLES = join(process.cwd(), "public/examples/");

function exampleText(name: string): string {
  return readFileSync(`${EXAMPLES}${name}`, "utf8");
}

function makeStore(): AppStore {
  return createAppStore({
    engine: createInThreadEngine(),
    storage: createDraftStorage({ openBackend: () => createMemoryBackend() }),
    rebuildDelayMs: 1,
    saveDelayMs: 1,
    fetchExample: (path) => {
      const name = path.replace("examples/", "");
      return Promise.resolve(new File([readFileSync(`${EXAMPLES}${name}`)], name));
    },
  });
}

/**
 * What must never reach a usage record: every example file name, every
 * column name, and every cell value long enough to mean something (short
 * ones such as `1` or `A` also occur in bucket labels).
 */
function userData(): string[] {
  const values = new Set<string>();
  for (const { fileName } of EXAMPLE_FILES) {
    values.add(fileName);
    values.add(fileName.replace(/\.[a-z]+$/, ""));
    const lines = exampleText(fileName).split(/\r?\n/);
    for (const line of lines) {
      for (const cell of line.split("\t")) {
        const value = cell.trim();
        if (value.length >= 4 && !/^[\d.,-]+$/.test(value)) values.add(value);
      }
    }
  }
  return [...values];
}

describe("usage counts from the store", () => {
  it("record a session with the example, with nothing from the files in it", async () => {
    const store = makeStore();
    const stop = instrumentAppStore(store);
    const { actions } = store.getState();
    await actions.initialise();
    expect(analytics.previewSessionSummary()).toBeNull();

    expect(await actions.loadExample()).toEqual({ ok: true });
    await actions.flush();
    // The user picks another column for one field, then downloads.
    const mapped = store.getState().draft.microhaplotypes.table;
    if (mapped === null) throw new Error("no allele table");
    actions.setMapping(
      { section: "microhaplotypes" },
      { ...mapped.mapping, fields: { ...mapped.mapping.fields, microhaplotypeName: null } },
    );
    await actions.flush();
    // Plain JSON: jsdom's Blob cannot stream, which gzip needs.
    const file = await actions.downloadPmo({ gzip: false });
    expect(store.getState().engine).toEqual({ kind: "running" });
    expect(store.getState().build.view?.overall.pmo).toBe("valid");
    expect(file).not.toBeNull();
    stop();

    const pending = analytics.previewSessionSummary();
    if (pending === null) throw new Error("no session record");
    const record: unknown = JSON.parse(pending);
    expect(record).toMatchObject({
      v: 2,
      kind: "session",
      tables: {
        microhaplotypes: {
          import: { route: "example", format: "csv", gzip: false, rows: "100-999", columns: "5-9" },
          mappingEdited: true,
        },
        panelTargets: {
          import: { route: "example", format: "csv", rows: "100-999", columns: "10-19" },
          mappingEdited: false,
        },
        specimens: { import: { route: "example", format: "tsv", rows: "10-99" } },
        librarySamples: { import: { route: "example", format: "tsv", rows: "10-99" } },
        readCountTotals: { import: { route: "example", format: "txt", rows: "1-9" } },
        readCountsByStage: { import: { route: "example", format: "txt", rows: "1-9" } },
      },
      sections: {
        microhaplotypes: "ready",
        panel: "ready",
        specimens: "ready",
        librarySamples: "ready",
        readCounts: "ready",
        project: "empty",
        sequencing: "empty",
        bioinformatics: "empty",
      },
      build: {
        validation: "valid",
        schemaErrors: "0",
        downloads: { plain: "1", gzip: "0" },
      },
      draftRestored: false,
    });
    expect(record).toHaveProperty("build.built", expect.stringMatching(/^(1|2-4|5-9)$/));
    expect(record).toHaveProperty("build.failed", "0");
    expect(record).toHaveProperty("build.downloadSize", expect.stringMatching(/kb|mb/));

    const texts = [pending, ...analytics.getTransparencyLog().map((entry) => entry.body)].join(
      "\n",
    );
    const leaked = userData().filter((value) => texts.includes(value));
    expect(leaked).toEqual([]);
  });

  it("counts the user's change to a match, not the automatic one, and a failed import by its code", async () => {
    const calls: string[] = [];
    const recorder: UsageRecorder = {
      ...ANALYTICS_RECORDER,
      recordMappingEdited: (table) => calls.push(`mapping:${table}`),
      recordTableImported: (input) => calls.push(`import:${input.table}:${input.route}`),
      recordIssue: (input) => calls.push(`issue:${input.code}`),
      recordBuild: (input) => calls.push(`build:${input.outcome}`),
      recordSectionStatus: () => undefined,
      recordValidation: () => undefined,
    };
    const store = makeStore();
    instrumentAppStore(store, recorder);
    const { actions } = store.getState();
    await actions.initialise();
    await actions.flush();
    expect(calls).toEqual([]);

    const slot = { section: "specimens" } as const;
    await actions.importFile(
      slot,
      new File([exampleText("mad4hatter_metadata_example.tsv")], "m.tsv"),
    );
    const mapped = store.getState().draft.specimens.table;
    if (mapped === null) throw new Error("no table");
    // Setting the same mapping again is not a change.
    actions.setMapping(slot, mapped.mapping);
    actions.setMapping(slot, { ...mapped.mapping, additionalColumns: [] });
    await actions.importFile(slot, new File([""], "empty.csv"));
    await actions.flush();
    expect(calls.filter((call) => /^(import|mapping|issue:import)/.test(call))).toEqual([
      "import:specimens:upload",
      "mapping:specimens",
      "issue:import/empty-file",
    ]);
    expect(calls).toContain("build:built");
  });

  it("counts publishing steps and file checks by their fixed names", async () => {
    const calls: string[] = [];
    const recorder: UsageRecorder = {
      ...ANALYTICS_RECORDER,
      recordPublishOpened: (source) => calls.push(`opened:${source}`),
      recordDepositStarted: (source) => calls.push(`started:${source}`),
      recordDepositFinished: (outcome) => calls.push(`finished:${outcome}`),
      recordFileChecked: (result) => calls.push(`checked:${result}`),
      recordSectionStatus: () => undefined,
      recordValidation: () => undefined,
      recordBuild: () => undefined,
    };
    const store = makeStore();
    instrumentAppStore(store, recorder);
    const { actions } = store.getState();
    await actions.initialise();
    actions.notePublishing({ kind: "publish-opened", source: "file" });
    actions.notePublishing({ kind: "deposit-started", source: "file" });
    actions.notePublishing({ kind: "deposit-finished", outcome: "pop-up-blocked" });
    await actions.checkPmoFile(new File(["sample,reads"], "Kisumu_patient_042.json"));
    await actions.checkPmoFile(new File(['{"pmo_header": {"pmo_version": "1.0.0"}}'], "old.json"));
    expect(calls).toEqual([
      "opened:file",
      "started:file",
      "finished:pop-up-blocked",
      "checked:unreadable",
      "checked:wrong-version",
    ]);
  });

  it("does not let a restored draft alone count as a build", async () => {
    const recordBuild = vi.fn<UsageRecorder["recordBuild"]>();
    const store = makeStore();
    instrumentAppStore(store, { ...ANALYTICS_RECORDER, recordBuild });
    await store.getState().actions.initialise();
    await store.getState().actions.flush();
    expect(recordBuild).not.toHaveBeenCalled();
  });

  it("names import failures with the codes the usage vocabulary knows", () => {
    expect(importIssueCode({ code: "unsupported-type", detail: { kind: "legacy-excel" } })).toBe(
      "import/unsupported-format",
    );
    expect(importIssueCode({ code: "engine-stopped" })).toBe("worker/crashed");
    expect(importIssueCode({ code: "empty-file", detail: { kind: "none" } })).toBe(
      "import/empty-file",
    );
  });
});
