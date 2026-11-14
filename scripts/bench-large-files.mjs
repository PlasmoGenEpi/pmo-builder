// Runs large tables through the engine in Node and reports the time and
// peak memory of each stage: import, section build, merge, validation and
// export.
//
//   node scripts/generate-large-tables.mjs <dir>
//   node scripts/bench-large-files.mjs <dir> [--pass engine|breakdown] [--src <folder>]
//
// `--pass engine` (the default) goes through the engine's own methods, as
// the worker would. `--pass breakdown` calls the build functions one by one
// to split the build into its parts. `--src` runs another copy of `src`, to
// compare before and after a change.
//
// Peak memory is the process's resident set size, sampled every 5 ms from a
// separate thread while the stage runs, after a garbage collection.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { join, resolve } from "node:path";
import { getHeapStatistics } from "node:v8";
import { Worker } from "node:worker_threads";

if (typeof globalThis.gc !== "function") {
  const result = spawnSync(
    process.execPath,
    ["--expose-gc", ...process.execArgv, ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const dir = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
if (dir === undefined) {
  console.error("Usage: node scripts/bench-large-files.mjs <dir> [--pass engine|breakdown]");
  process.exit(2);
}
const pass = option("--pass", "engine");
const src = option("--src", undefined);
register("./lib/ts-hooks.mjs", import.meta.url, {
  data: { src: src === undefined ? undefined : resolve(src) },
});

// Peak RSS, sampled from another thread so it keeps sampling while the main thread works.
const peak = new BigInt64Array(new SharedArrayBuffer(16));
const sampler = new Worker(
  `const { workerData } = require("node:worker_threads");
   const peak = new BigInt64Array(workerData);
   setInterval(() => {
     const rss = BigInt(process.memoryUsage.rss());
     if (rss > Atomics.load(peak, 0)) Atomics.store(peak, 0, rss);
   }, 5);`,
  { eval: true, workerData: peak.buffer },
);
sampler.unref();

const MB = 1_048_576;
const rows = [];

/** Runs one stage after a garbage collection, and records its time and peak memory. */
async function stage(name, run) {
  globalThis.gc();
  await new Promise((done) => setTimeout(done, 20));
  const before = process.memoryUsage();
  Atomics.store(peak, 0, BigInt(before.rss));
  const started = performance.now();
  const result = await run();
  const ms = performance.now() - started;
  await new Promise((done) => setTimeout(done, 10));
  const after = process.memoryUsage();
  rows.push({
    stage: name,
    ms: Math.round(ms),
    peakRssMb: Math.round(Number(Atomics.load(peak, 0)) / MB),
    rssBeforeMb: Math.round(before.rss / MB),
    heapAfterMb: Math.round(after.heapUsed / MB),
  });
  return result;
}

const files = {
  alleles: join(dir, "large_allele_table.csv"),
  panel: join(dir, "large_panel_table.csv"),
  metadata: join(dir, "large_metadata_table.tsv"),
};
// An in-memory Blob: Node cannot post a file-backed one across a channel.
const blob = async (path) => new Blob([readFileSync(path)]);

const { createEmptyDraft, fieldSetForSlot } = await import("@/domain/draft");
const { getFieldSet } = await import("@/domain/fields");
const { suggestMapping } = await import("@/domain/matching");

const mappedFor = (slot, table) => ({
  table,
  mapping: suggestMapping(getFieldSet(fieldSetForSlot(slot)), table.columns).mapping,
});

function draftFor(tables) {
  const empty = createEmptyDraft();
  const panel = empty.panel.panels[0];
  const panelSlot = { section: "panel", panelId: panel.id, part: "targets" };
  return {
    ...empty,
    microhaplotypes: {
      ...empty.microhaplotypes,
      table: mappedFor({ section: "microhaplotypes" }, tables.alleles),
    },
    panel: {
      panels: [{ ...panel, name: "Mad4hatter", table: mappedFor(panelSlot, tables.panel) }],
    },
    specimens: { table: mappedFor({ section: "specimens" }, tables.specimens) },
    librarySamples: { table: mappedFor({ section: "librarySamples" }, tables.librarySamples) },
  };
}

/**
 * The engine behind a real message channel, as in the app: every call and
 * answer is structured-cloned, so the draft reaches the engine as a copy.
 */
async function engineThroughChannel() {
  const { createInThreadEngine } = await import("@/worker/engine");
  const { createEngineClient, serveEngine } = await import("@/worker");
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveEngine(createInThreadEngine(), port2);
  const client = createEngineClient(port1);
  return { engine: client, close: () => (port1.close(), port2.close()) };
}

/** Times `count` builds of the same draft, as the store sends after each change elsewhere. */
async function unchangedBuilds(engine, draft, count) {
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line no-await-in-loop
    await engine.build(draft, { creationDate: "2026-11-14" });
  }
  return (performance.now() - started) / count;
}

async function enginePass() {
  const { engine, close } = await engineThroughChannel();
  const importOne = async (path) => {
    const outcome = await engine.importFile({ file: await blob(path), fileName: path });
    if (outcome.kind !== "imported") throw new Error(outcome.notice.message);
    return outcome.table;
  };
  const alleles = await stage("import allele table", () => importOne(files.alleles));
  const panel = await stage("import panel table", () => importOne(files.panel));
  const specimens = await stage("import metadata table", () => importOne(files.metadata));
  const librarySamples = await importOne(files.metadata);
  const draft = draftFor({ alleles, panel, specimens, librarySamples });

  const first = await stage("build: sections, merge, validation", () =>
    engine.build(draft, { creationDate: "2026-11-14" }),
  );
  if (first.kind !== "built") throw new Error("superseded");
  const view = first.view;
  const unchanged = await stage("build again, nothing changed", () =>
    engine.build(draft, { creationDate: "2026-11-14" }),
  );
  const projectEdit = {
    ...draft,
    project: {
      ...draft.project,
      records: draft.project.records.map((record) => ({
        ...record,
        values: { ...record.values, project_name: "P1" },
      })),
    },
  };
  const edited = await stage("build after a project edit", () =>
    engine.build(projectEdit, { creationDate: "2026-11-14" }),
  );
  const runName = {
    ...projectEdit,
    microhaplotypes: {
      ...projectEdit.microhaplotypes,
      runName: { mode: "fixed", fixedName: "run1", column: null },
    },
  };
  await stage("build after a run name edit (allele table rebuilt)", () =>
    engine.build(runName, { creationDate: "2026-11-14" }),
  );

  // Change detection alone: the same draft again, with the panel from the
  // saved-panel library, so the draft carries the whole panel fragment.
  const fragment = await engine.getPanelFragment(draft.panel.panels[0].id);
  const saved = {
    ...runName,
    panel: {
      panels: [
        {
          ...runName.panel.panels[0],
          source: "saved",
          saved: { savedPanelId: "p1", name: "Mad4hatter", savedAt: "2026-11-14", fragment },
        },
      ],
    },
  };
  await engine.build(saved, { creationDate: "2026-11-14" });
  const perBuild = await stage("20 unchanged builds, saved panel in draft", () =>
    unchangedBuilds(engine, saved, 20),
  );
  const gz = await stage("export gzip", () => engine.getPmoFile({ gzip: true }));
  const plain = await stage("export plain", () => engine.getPmoFile({ gzip: false }));
  await stage("preview text (200,000 characters)", () => engine.getPmoText({ maxLength: 200_000 }));
  await stage("preview text again, same build", () => engine.getPmoText({ maxLength: 200_000 }));
  close();
  return {
    statuses: Object.fromEntries(
      Object.entries(view.sections).map(([id, section]) => [id, section.status]),
    ),
    overall: view.overall.status,
    pmo: view.overall.pmo,
    notices: view.overall.notices.map((notice) => notice.code),
    rebuiltWhenUnchanged: unchanged.kind === "built" ? unchanged.view.rebuilt : "superseded",
    rebuiltAfterEdit: edited.kind === "built" ? edited.view.rebuilt : "superseded",
    unchangedBuildMs: +perBuild.toFixed(2),
    savedFragmentKb: Math.round(JSON.stringify(fragment).length / 1024),
    gzipMb: gz === null ? null : +(gz.blob.size / MB).toFixed(1),
    plainMb: plain === null ? null : +(plain.blob.size / MB).toFixed(1),
  };
}

/** A table reference for a parsed file, as an import would give. */
const ref = (id, file) => ({
  id,
  fileName: id,
  fileSize: 0,
  format: "delimited",
  sheetNames: null,
  sheetName: null,
  columns: file.table.columns,
  rowCount: file.table.rows.length,
});

async function breakdownPass() {
  const { parseFile } = await import("@/domain/import");
  const { createBuildContext, buildSection, mergeSections, exportPmo } =
    await import("@/domain/build");
  const { validatePmo, checkPmoIntegrity, stringifyPmo } = await import("pmotools-ts");
  const parsed = await stage("parse allele table", async () =>
    parseFile(await blob(files.alleles), "large_allele_table.csv"),
  );
  const panel = await parseFile(await blob(files.panel), "large_panel_table.csv");
  const metadata = await parseFile(await blob(files.metadata), "large_metadata_table.tsv");
  const tables = new Map([
    ["alleles", parsed.table],
    ["panel", panel.table],
    ["specimens", metadata.table],
    ["librarySamples", metadata.table],
  ]);
  const draft = draftFor({
    alleles: ref("alleles", parsed),
    panel: ref("panel", panel),
    specimens: ref("specimens", metadata),
    librarySamples: ref("librarySamples", metadata),
  });
  const context = createBuildContext(tables);
  const sections = {};
  sections.microhaplotypes = await stage("section: microhaplotypes (type + build)", () =>
    buildSection("microhaplotypes", draft, context),
  );
  for (const id of ["panel", "specimens", "librarySamples"]) {
    sections[id] = buildSection(id, draft, context);
  }
  for (const id of ["project", "sequencing", "bioinformatics", "readCounts"]) {
    sections[id] = buildSection(id, draft, context);
  }
  const merged = await stage("merge + validate + integrity (mergeSections)", () =>
    mergeSections(sections, { creationDate: "2026-11-14" }),
  );
  if (merged.outcome.kind !== "built") throw new Error(`not built: ${merged.status}`);
  const pmo = merged.outcome.pmo;
  await stage("validatePmo alone", () => validatePmo(pmo));
  await stage("checkPmoIntegrity alone", () => checkPmoIntegrity(pmo));
  await stage("stringifyPmo", () => stringifyPmo(pmo));
  await stage("exportPmo gzip", () => exportPmo(pmo, { gzip: true }));
  return { status: merged.status, valid: merged.outcome.valid };
}

const summary = pass === "breakdown" ? await breakdownPass() : await enginePass();
console.table(rows);
console.log(JSON.stringify(summary, null, 2));
console.log(
  `Node ${process.version}, heap limit ${Math.round(getHeapStatistics().heap_size_limit / MB)} MB`,
);
process.exit(0);
