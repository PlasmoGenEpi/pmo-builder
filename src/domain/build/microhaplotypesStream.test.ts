import { gzipSync } from "node:zlib";

import { stringifyPmo } from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { createEmptyDraft, createPanelEntry, type Draft, type MappedTable } from "@/domain/draft";
import {
  inspectDelimitedStream,
  parseFile,
  typeTable,
  type DelimitedStreamMeta,
} from "@/domain/import";
import { exampleBlob } from "@/domain/import/exampleFiles.testing";
import type { ColumnMapping } from "@/domain/types";

import { createBuildContext } from "./context";
import { buildAllSections, mergeSections } from "./merge";
import {
  buildMicrohaplotypes,
  buildMicrohaplotypesStream,
  type MicrohaplotypesStreamProgress,
  type StreamMicrohaplotypesOutput,
} from "./microhaplotypes";
import { EXAMPLE_MAPPINGS, TEST_DEPS, mappedTable, mapping, readExample } from "./testing";

const empty = createEmptyDraft();

const SIMPLE_MAPPING = mapping({
  librarySampleName: "sample",
  targetName: "target",
  seq: "seq",
  reads: "reads",
});

function chunkedBlob(source: Blob, chunkBytes: number): Blob {
  const clone = source.slice(0, source.size, source.type);
  Object.defineProperty(clone, "stream", {
    configurable: true,
    value: (): ReadableStream<Uint8Array<ArrayBuffer>> => {
      let offset = 0;
      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        async pull(controller) {
          if (offset >= source.size) {
            controller.close();
            return;
          }
          const end = Math.min(offset + chunkBytes, source.size);
          const buffer = await source.slice(offset, end).arrayBuffer();
          offset = end;
          controller.enqueue(new Uint8Array(buffer));
        },
      });
    },
  });
  return clone;
}

/** A Blob that throws if `.stream()` is ever called, proving zero I/O on header-only blocks. */
function forbiddenStreamBlob(size = 100): Blob {
  const blob = new Blob(["x".repeat(size)]);
  Object.defineProperty(blob, "stream", {
    configurable: true,
    value: () => {
      throw new Error("Expected zero I/O, but Blob.stream() was called");
    },
  });
  return blob;
}

async function inspectOrThrow(blob: Blob, fileName: string): Promise<DelimitedStreamMeta> {
  const inspected = await inspectDelimitedStream(blob, { fileName });
  if (inspected.kind !== "delimited") {
    throw new Error(`Expected delimited file, got ${inspected.kind}`);
  }
  return inspected.meta;
}

function mappedFromMeta(
  id: string,
  fileName: string,
  blob: Blob,
  meta: DelimitedStreamMeta,
  colMapping: ColumnMapping,
): MappedTable {
  return {
    table: {
      id,
      fileName,
      fileSize: blob.size,
      format: "delimited",
      sheetNames: null,
      sheetName: null,
      columns: meta.columns,
      rowCount: meta.exactRowCount ?? meta.previewRows.length,
    },
    mapping: colMapping,
    confirmedMatches: {},
  };
}

function expectDone(
  output: StreamMicrohaplotypesOutput,
): Extract<StreamMicrohaplotypesOutput, { readonly kind: "done" }> {
  if (output.kind !== "done") throw new Error(`Expected done, got ${output.kind}`);
  return output;
}

describe("buildMicrohaplotypesStream", () => {
  it("matches buildMicrohaplotypes and produces byte-for-byte identical PMO JSON on example tables (plain and gzipped)", async () => {
    const allelesBlob = await exampleBlob("mad4hatter_allele_data_example.csv");
    const gzippedAlleles = new Blob([
      new Uint8Array(gzipSync(Buffer.from(await allelesBlob.arrayBuffer()))),
    ]);
    const parsedAlleles = await parseFile(allelesBlob, "mad4hatter_allele_data_example.csv");
    const examplePanel = readExample("mad4hatter_panel_info_example.csv");
    const exampleMetadata = readExample("mad4hatter_metadata_example.tsv");

    const syncContext = createBuildContext(
      new Map([
        ["alleles", parsedAlleles.table],
        ["panel", examplePanel],
        ["metadata", exampleMetadata],
      ]),
      { ...TEST_DEPS, typeTable },
    );
    const draft: Draft = {
      ...empty,
      microhaplotypes: {
        ...empty.microhaplotypes,
        table: mappedTable("alleles", parsedAlleles.table, EXAMPLE_MAPPINGS.alleles),
      },
      panel: {
        panels: [
          {
            ...createPanelEntry("Mad4hatter"),
            table: mappedTable("panel", examplePanel, EXAMPLE_MAPPINGS.panel),
          },
        ],
      },
      specimens: {
        table: mappedTable("metadata", exampleMetadata, EXAMPLE_MAPPINGS.specimens),
      },
      librarySamples: {
        table: mappedTable("metadata", exampleMetadata, EXAMPLE_MAPPINGS.librarySamples),
      },
    };

    const syncSections = buildAllSections(draft, syncContext);
    const syncMerge = mergeSections(syncSections, { creationDate: "2026-01-01" });
    if (syncMerge.outcome.kind !== "built") throw new Error("sync merge did not build");
    const expectedJson = stringifyPmo(syncMerge.outcome.pmo);

    for (const [label, blob] of [
      ["mad4hatter_allele_data_example.csv", chunkedBlob(allelesBlob, 512)],
      ["mad4hatter_allele_data_example.csv.gz", chunkedBlob(gzippedAlleles, 256)],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- checking plain then gzipped sequentially
      const meta = await inspectOrThrow(blob, label);
      const progressEvents: MicrohaplotypesStreamProgress[] = [];
      // oxlint-disable-next-line no-await-in-loop -- checking plain then gzipped sequentially
      const built = await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("alleles", label, blob, meta, EXAMPLE_MAPPINGS.alleles),
        },
        source: { kind: "ready", blob, meta },
        chunkSize: 137,
        onProgress: (event) => progressEvents.push(event),
      });
      const output = expectDone(built);

      expect(output.totalRows).toBe(parsedAlleles.table.rows.length);
      expect(output.result.status).toBe("ready");
      expect(output.result.summary).toEqual(syncSections.microhaplotypes.summary);
      expect(output.result.notices).toEqual(syncSections.microhaplotypes.notices);

      const streamedMerge = mergeSections(
        { ...syncSections, microhaplotypes: output.result },
        { creationDate: "2026-01-01" },
      );
      if (streamedMerge.outcome.kind !== "built") throw new Error("streamed merge did not build");
      expect(stringifyPmo(streamedMerge.outcome.pmo)).toBe(expectedJson);

      const stages = new Set(progressEvents.map((event) => event.stage));
      expect(stages.has("checking")).toBe(true);
      expect(stages.has("building")).toBe(true);
    }
  });

  it("matches buildMicrohaplotypes on the multi-run example and collects runNameValues", async () => {
    const fileName = "mad4hatter_allele_data_example_multi_bioinfo.csv";
    const blob = await exampleBlob(fileName);
    const parsed = await parseFile(blob, fileName);
    const meta = await inspectOrThrow(blob, fileName);

    const section: Draft["microhaplotypes"] = {
      ...empty.microhaplotypes,
      table: mappedTable("multi", parsed.table, EXAMPLE_MAPPINGS.alleles),
      runName: { mode: "column", fixedName: "", column: "bioinfo_runs" },
    };
    const syncResult = buildMicrohaplotypes(
      section,
      createBuildContext(new Map([["multi", parsed.table]]), { ...TEST_DEPS, typeTable }),
    );
    const streamed = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...section,
          table: mappedFromMeta("multi", fileName, blob, meta, EXAMPLE_MAPPINGS.alleles),
        },
        source: { kind: "ready", blob: chunkedBlob(blob, 1024), meta },
        chunkSize: 100,
      }),
    );

    expect(streamed.result).toEqual(syncResult);
    expect(streamed.totalRows).toBe(parsed.table.rows.length);
    expect(streamed.runNameValues).toEqual(syncResult.summary?.runNames);
  });

  it("handles header-only checks with zero file I/O", async () => {
    const meta: DelimitedStreamMeta = {
      delimiter: ",",
      encoding: "utf-8",
      columns: ["sample", "target", "seq", "reads", "run"],
      rawHeaders: ["sample", "target", "seq", "reads", "run"],
      previewRows: [],
      exactRowCount: 10,
    };
    const noIoBlob = forbiddenStreamBlob();

    const emptyOut = expectDone(
      await buildMicrohaplotypesStream({
        section: empty.microhaplotypes,
        source: { kind: "missing" },
      }),
    );
    expect(emptyOut.result.status).toBe("empty");

    const startedNoTable = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          runName: { mode: "fixed", fixedName: "r1", column: null },
        },
        source: { kind: "missing" },
      }),
    );
    expect(startedNoTable.result.status).toBe("incomplete");
    expect(startedNoTable.result.notices.map((n) => n.code)).toEqual(["table/not-imported"]);

    const missingSource = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("a", "a.csv", noIoBlob, meta, SIMPLE_MAPPING),
        },
        source: { kind: "missing" },
      }),
    );
    expect(missingSource.result.status).toBe("incomplete");
    expect(missingSource.result.notices.map((n) => n.code)).toEqual(["table/file-missing"]);

    const failedSource = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("a", "a.csv", noIoBlob, meta, SIMPLE_MAPPING),
        },
        source: { kind: "failed", message: "corrupt" },
      }),
    );
    expect(failedSource.result.status).toBe("error");
    expect(failedSource.result.notices.map((n) => n.code)).toEqual(["table/unreadable"]);

    const unmappedRequired = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta(
            "a",
            "a.csv",
            noIoBlob,
            meta,
            mapping({ ...SIMPLE_MAPPING.fields, reads: null }),
          ),
        },
        source: { kind: "ready", blob: noIoBlob, meta },
      }),
    );
    expect(unmappedRequired.result.status).toBe("incomplete");
    expect(unmappedRequired.result.notices.map((n) => n.code)).toEqual([
      "mapping/missing-required",
    ]);

    const clashRun = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("a", "a.csv", noIoBlob, meta, SIMPLE_MAPPING),
          runName: { mode: "fixed", fixedName: "run", column: null },
        },
        source: { kind: "ready", blob: noIoBlob, meta },
      }),
    );
    expect(clashRun.result.status).toBe("error");
    expect(clashRun.result.notices.map((n) => n.code)).toEqual(["run-name/same-as-column"]);

    const missingRep = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("a", "a.csv", noIoBlob, meta, SIMPLE_MAPPING),
          representativeColumns: ["ghost"],
        },
        source: { kind: "ready", blob: noIoBlob, meta },
      }),
    );
    expect(missingRep.result.status).toBe("error");
    expect(missingRep.result.notices.map((n) => n.code)).toEqual([
      "mapping/unknown-additional-column",
    ]);
  });

  it("preserves literal 'NA' in text, extra and representative columns (parity with typeTable)", async () => {
    const csv = "sample,target,seq,reads,tag,lot\nS1,t1,ACGT,5,01,007\nS2,t1,ACGA,7,NA,NA\n";
    const blob = new Blob([csv]);
    const parsed = await parseFile(blob, "extra.csv");
    const meta = await inspectOrThrow(blob, "extra.csv");
    const colMapping = mapping(SIMPLE_MAPPING.fields, ["tag", "lot"]);

    const syncResult = buildMicrohaplotypes(
      {
        ...empty.microhaplotypes,
        table: mappedTable("extra", parsed.table, colMapping),
        representativeColumns: ["tag"],
      },
      createBuildContext(new Map([["extra", parsed.table]]), { ...TEST_DEPS, typeTable }),
    );

    const streamed = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("extra", "extra.csv", blob, meta, colMapping),
          representativeColumns: ["tag"],
        },
        source: { kind: "ready", blob, meta },
      }),
    );

    expect(streamed.result).toEqual(syncResult);
    const mhaps =
      streamed.result.fragment?.representative_microhaplotypes.targets[0]?.microhaplotypes;
    expect(mhaps?.map((m) => m["tag"])).toEqual(["01", "NA"]);
    const detected = streamed.result.fragment?.detected_microhaplotypes[0]?.library_samples.flatMap(
      (s) => s.target_results.flatMap((t) => t.mhaps.map((m) => m["lot"])),
    );
    expect(detected).toEqual(["007", "NA"]);
  });

  it("detects repeated rows identically to buildMicrohaplotypes, including run-like column hints and >32 alleles per target", async () => {
    // 1. Repeats explained by an unused run column.
    const multiRunCsv = [
      "sample,target,seq,reads,bioinfo_runs",
      "S1,t1,ACGT,5,run1",
      "S2,t1,ACGA,7,run1",
      "S1,t1,ACGT,6,run2",
      "S2,t1,ACGA,8,run2",
    ].join("\n");
    const multiBlob = new Blob([`${multiRunCsv}\n`]);
    const multiParsed = await parseFile(multiBlob, "multi.csv");
    const multiMeta = await inspectOrThrow(multiBlob, "multi.csv");

    const syncMulti = buildMicrohaplotypes(
      {
        ...empty.microhaplotypes,
        table: mappedTable("multi", multiParsed.table, SIMPLE_MAPPING),
      },
      createBuildContext(new Map([["multi", multiParsed.table]]), { ...TEST_DEPS, typeTable }),
    );
    const streamedMulti = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("multi", "multi.csv", multiBlob, multiMeta, SIMPLE_MAPPING),
        },
        source: { kind: "ready", blob: multiBlob, meta: multiMeta },
        chunkSize: 2,
      }),
    );
    expect(streamedMulti.result).toEqual(syncMulti);
    expect(streamedMulti.result.notices[0]?.message).toContain(
      'Column "bioinfo_runs" tells them apart',
    );

    // 2. Over 32 distinct alleles on one (sample, target), promoting array -> Set, then repeating allele 35.
    const polyLines = ["sample,target,seq,reads"];
    for (let i = 1; i <= 40; i += 1) {
      polyLines.push(`S1,t1,SEQ_${i},${i}`);
    }
    polyLines.push("S1,t1,SEQ_35,99");
    const polyBlob = new Blob([`${polyLines.join("\n")}\n`]);
    const polyParsed = await parseFile(polyBlob, "poly.csv");
    const polyMeta = await inspectOrThrow(polyBlob, "poly.csv");

    const syncPoly = buildMicrohaplotypes(
      {
        ...empty.microhaplotypes,
        table: mappedTable("poly", polyParsed.table, SIMPLE_MAPPING),
      },
      createBuildContext(new Map([["poly", polyParsed.table]]), { ...TEST_DEPS, typeTable }),
    );
    const streamedPoly = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("poly", "poly.csv", polyBlob, polyMeta, SIMPLE_MAPPING),
        },
        source: { kind: "ready", blob: polyBlob, meta: polyMeta },
        chunkSize: 10,
      }),
    );
    expect(streamedPoly.result).toEqual(syncPoly);
    expect(streamedPoly.result.notices[0]?.message).toContain("row 42");
  });

  it("reports exact spreadsheet row numbers for errors 200,000+ rows into a streamed table", async () => {
    const TOTAL = 200_005;
    const BAD_INDEX = 200_000; // spreadsheet row 200002
    const makeLines = (header: string, rowFor: (index: number) => string): Blob => {
      const parts: string[] = [`${header}\n`];
      for (let i = 0; i < TOTAL; i += 1) {
        parts.push(`${rowFor(i)}\n`);
      }
      return new Blob([parts.join("")]);
    };

    // 1. Blank required cell at row 200002.
    const blankBlob = makeLines("sample,target,seq,reads", (i) =>
      i === BAD_INDEX
        ? `S${i % 500},t${Math.floor(i / 500)},ACGT,`
        : `S${i % 500},t${Math.floor(i / 500)},ACGT,5`,
    );
    const blankMeta = await inspectOrThrow(blankBlob, "blank.csv");
    const blankOut = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("blank", "blank.csv", blankBlob, blankMeta, SIMPLE_MAPPING),
        },
        source: { kind: "ready", blob: blankBlob, meta: blankMeta },
      }),
    );
    expect(blankOut.result.status).toBe("error");
    expect(blankOut.result.notices[0]?.code).toBe("table/blank-required");
    expect(blankOut.result.notices[0]?.message).toContain("row 200002");

    // 2. "NA" in reads -> mhap/missing-reads at row 200002.
    const naReadsBlob = makeLines("sample,target,seq,reads", (i) =>
      i === BAD_INDEX
        ? `S${i % 500},t${Math.floor(i / 500)},ACGT,NA`
        : `S${i % 500},t${Math.floor(i / 500)},ACGT,5`,
    );
    const naReadsMeta = await inspectOrThrow(naReadsBlob, "nareads.csv");
    const naReadsOut = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("nareads", "nareads.csv", naReadsBlob, naReadsMeta, SIMPLE_MAPPING),
        },
        source: { kind: "ready", blob: naReadsBlob, meta: naReadsMeta },
      }),
    );
    expect(naReadsOut.result.status).toBe("error");
    expect(naReadsOut.result.notices[0]?.code).toBe("mhap/missing-reads");
    expect(naReadsOut.result.notices[0]?.message).toContain("row 200002");

    // 3. Blank run-name cell -> mhap/missing-run-name at row 200002.
    const blankRunBlob = makeLines("sample,target,seq,reads,run", (i) =>
      i === BAD_INDEX
        ? `S${i % 500},t${Math.floor(i / 500)},ACGT,5,`
        : `S${i % 500},t${Math.floor(i / 500)},ACGT,5,r1`,
    );
    const blankRunMeta = await inspectOrThrow(blankRunBlob, "blankrun.csv");
    const blankRunOut = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta(
            "blankrun",
            "blankrun.csv",
            blankRunBlob,
            blankRunMeta,
            SIMPLE_MAPPING,
          ),
          runName: { mode: "column", fixedName: "", column: "run" },
        },
        source: { kind: "ready", blob: blankRunBlob, meta: blankRunMeta },
      }),
    );
    expect(blankRunOut.result.status).toBe("error");
    expect(blankRunOut.result.notices[0]?.code).toBe("mhap/missing-run-name");
    expect(blankRunOut.result.notices[0]?.message).toContain("row 200002");

    // 4. Invalid masking -> mhap/invalid-masking at row 200002.
    const maskMapping = mapping({
      ...SIMPLE_MAPPING.fields,
      maskingSeqStart: "m_start",
      maskingSeqSegmentSize: "m_size",
      maskingReplacementSize: "m_repl",
    });
    const maskBlob = makeLines("sample,target,seq,reads,m_start,m_size,m_repl", (i) =>
      i === BAD_INDEX
        ? `S${i % 500},t${Math.floor(i / 500)},SEQ_BAD,5,bad,2,1`
        : `S${i % 500},t${Math.floor(i / 500)},ACGT,5,1,2,1`,
    );
    const maskMeta = await inspectOrThrow(maskBlob, "mask.csv");
    const maskOut = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("mask", "mask.csv", maskBlob, maskMeta, maskMapping),
        },
        source: { kind: "ready", blob: maskBlob, meta: maskMeta },
      }),
    );
    expect(maskOut.result.status).toBe("error");
    expect(maskOut.result.notices[0]?.code).toBe("mhap/invalid-masking");
    expect(maskOut.result.notices[0]?.message).toContain("row 200002");
  }, 15_000);

  it("re-reads the stored Blob cleanly when mapping, runName or representativeColumns change", async () => {
    const csv = [
      "sample,target,seq,reads,alt_reads,run,tag",
      "S1,t1,ACGT,5,50,r1,alpha",
      "S2,t1,ACGA,7,70,r2,beta",
    ].join("\n");
    const blob = new Blob([`${csv}\n`]);
    const meta = await inspectOrThrow(blob, "remap.csv");

    const first = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("remap", "remap.csv", blob, meta, SIMPLE_MAPPING),
        },
        source: { kind: "ready", blob, meta },
      }),
    );
    expect(first.result.status).toBe("ready");
    expect(first.result.summary?.runNames).toEqual([]);

    const remappedMapping = mapping({ ...SIMPLE_MAPPING.fields, reads: "alt_reads" }, ["tag"]);
    const second = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("remap", "remap.csv", blob, meta, remappedMapping),
          runName: { mode: "column", fixedName: "", column: "run" },
          representativeColumns: ["tag"],
        },
        source: { kind: "ready", blob, meta },
      }),
    );
    expect(second.result.status).toBe("ready");
    expect(second.result.summary?.runNames).toEqual(["r1", "r2"]);
    expect(second.runNameValues).toEqual(["r1", "r2"]);
    const firstDetectedReads =
      second.result.fragment?.detected_microhaplotypes[0]?.library_samples[0]?.target_results[0]
        ?.mhaps[0]?.reads;
    expect(firstDetectedReads).toBe(50);
    const repTags =
      second.result.fragment?.representative_microhaplotypes.targets[0]?.microhaplotypes.map(
        (m) => m["tag"],
      );
    expect(repTags).toEqual(["alpha", "beta"]);
  });

  it("aborts cleanly with { kind: 'superseded' } during Pass 1 or Pass 2", async () => {
    const lines = ["sample,target,seq,reads"];
    for (let i = 1; i <= 500; i += 1) lines.push(`S${i},t1,ACGT,${i}`);
    const blob = chunkedBlob(new Blob([`${lines.join("\n")}\n`]), 128);
    const meta = await inspectOrThrow(blob, "abort.csv");

    let seenChecking = false;
    const abortedPass1 = await buildMicrohaplotypesStream({
      section: {
        ...empty.microhaplotypes,
        table: mappedFromMeta("abort", "abort.csv", blob, meta, SIMPLE_MAPPING),
      },
      source: { kind: "ready", blob, meta },
      chunkSize: 50,
      onProgress: (p) => {
        if (p.stage === "checking") seenChecking = true;
      },
      isSuperseded: () => seenChecking,
    });
    expect(abortedPass1).toEqual({ kind: "superseded" });

    let seenBuilding = false;
    const abortedPass2 = await buildMicrohaplotypesStream({
      section: {
        ...empty.microhaplotypes,
        table: mappedFromMeta("abort", "abort.csv", blob, meta, SIMPLE_MAPPING),
      },
      source: { kind: "ready", blob, meta },
      chunkSize: 50,
      onProgress: (p) => {
        if (p.stage === "building") seenBuilding = true;
      },
      isSuperseded: () => seenBuilding,
    });
    expect(abortedPass2).toEqual({ kind: "superseded" });
  });

  it("handles late Windows-1252 fallback identically to parseFile + buildMicrohaplotypes", async () => {
    const encoder = new TextEncoder();
    const pad = "A".repeat(120);
    const parts: Uint8Array[] = [encoder.encode("sample,target,seq,reads\n")];
    for (let i = 1; i <= 2_500; i += 1) {
      parts.push(encoder.encode(`S${i},t1,${pad}_${i},${i}\n`));
    }
    // Late CP-1252 sample name ("São")
    parts.push(new Uint8Array([...encoder.encode("S"), 0xe3, ...encoder.encode("o,t1,ACGT,9\n")]));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      combined.set(part, offset);
      offset += part.length;
    }
    const blob = new Blob([combined]);
    const parsed = await parseFile(blob, "late-cp1252.csv");
    const meta = await inspectOrThrow(chunkedBlob(blob, 4096), "late-cp1252.csv");
    expect(meta.encoding).toBe("utf-8");

    const syncResult = buildMicrohaplotypes(
      {
        ...empty.microhaplotypes,
        table: mappedTable("cp", parsed.table, SIMPLE_MAPPING),
      },
      createBuildContext(new Map([["cp", parsed.table]]), { ...TEST_DEPS, typeTable }),
    );
    const streamed = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("cp", "late-cp1252.csv", blob, meta, SIMPLE_MAPPING),
        },
        source: { kind: "ready", blob: chunkedBlob(blob, 4096), meta },
        chunkSize: 500,
      }),
    );
    expect(streamed.result).toEqual(syncResult);
  });

  it("reports a gzipped allele table exceeding maxTextBytes during Pass 1 naming the file once and the limit", async () => {
    const header = "sample,target,seq,reads\n";
    const row = "S1,t1,ACGTACGTACGTACGTACGTACGTACGTACGT,10\n";
    // ~1.5 MB unpacked, compresses to a few kilobytes so inspection succeeds and Pass 1 hits the 1 MB cap.
    const packed = gzipSync(Buffer.from(header + row.repeat(40_000), "utf8"));
    const blob = new Blob([new Uint8Array(packed)]);
    const fileName = "oversized.csv.gz";
    const meta = await inspectOrThrow(blob, fileName);

    const out = expectDone(
      await buildMicrohaplotypesStream({
        section: {
          ...empty.microhaplotypes,
          table: mappedFromMeta("big", fileName, blob, meta, SIMPLE_MAPPING),
        },
        source: { kind: "ready", blob, meta },
        maxTextBytes: 1024 * 1024,
      }),
    );

    expect(out.result.status).toBe("error");
    expect(out.result.notices).toHaveLength(1);
    const notice = out.result.notices[0];
    expect(notice?.code).toBe("table/unreadable");
    expect(notice?.message).toContain("1 MB");
    expect(notice?.message.split(fileName)).toHaveLength(2);
  });
});
