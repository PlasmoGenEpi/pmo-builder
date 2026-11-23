import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { distinctValues } from "@/domain/build/suggestions";
import type { RawRow } from "@/domain/types";

import { exampleBlob, exampleNames } from "./exampleFiles.testing";
import {
  IMPORT_LIMITS,
  ImportError,
  importFailureMessage,
  inspectDelimitedStream,
  parseFile,
  streamDelimitedChunks,
  streamDistinctValues,
  type DelimitedStreamInspection,
  type DelimitedStreamMeta,
  type ImportErrorCode,
  type StreamReadProgress,
} from "./index";

function textBlob(text: string): Blob {
  return new Blob([text]);
}

function bytesBlob(bytes: readonly number[] | Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

/**
 * Wraps a Blob so its `.stream()` yields slices of at most `chunkBytes` bytes,
 * exercising arbitrary chunk boundaries through the production Blob path.
 */
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

function expectDelimited(inspection: DelimitedStreamInspection): DelimitedStreamMeta {
  if (inspection.kind !== "delimited") {
    throw new Error(`Expected delimited inspection, got ${inspection.kind}`);
  }
  return inspection.meta;
}

async function failureOf(
  promise: Promise<unknown>,
): Promise<{ readonly code: ImportErrorCode; readonly message: string } | string> {
  return promise.then(
    () => "resolved",
    (caught: unknown) =>
      caught instanceof ImportError
        ? { code: caught.code, message: caught.message }
        : `not an ImportError: ${String(caught)}`,
  );
}

async function collectAllRows(
  source: Blob,
  fileName: string,
  chunkSize?: number,
): Promise<{ readonly meta: DelimitedStreamMeta; readonly rows: RawRow[] }> {
  const meta = expectDelimited(await inspectDelimitedStream(source, { fileName }));
  const rows: RawRow[] = [];
  for await (const chunk of streamDelimitedChunks(source, {
    fileName,
    delimiter: meta.delimiter,
    encoding: meta.encoding,
    columns: meta.columns,
    chunkSize,
  })) {
    rows.push(...chunk);
  }
  return { meta, rows };
}

describe("inspectDelimitedStream", () => {
  it("rejects empty, header-only, unsupported, legacy .xls, corrupt gzip and oversized files", async () => {
    expect(
      await failureOf(inspectDelimitedStream(bytesBlob([]), { fileName: "t.csv" })),
    ).toMatchObject({ code: "empty-file" });
    expect(
      await failureOf(inspectDelimitedStream(textBlob("\n \r\n\t\n"), { fileName: "t.csv" })),
    ).toMatchObject({ code: "empty-file" });
    expect(
      await failureOf(inspectDelimitedStream(textBlob("a,b\n\n"), { fileName: "t.csv" })),
    ).toMatchObject({ code: "no-rows" });
    expect(
      await failureOf(inspectDelimitedStream(textBlob("{}"), { fileName: "data.json" })),
    ).toMatchObject({ code: "unsupported-type" });

    const legacy = await inspectDelimitedStream(textBlob("a,b"), { fileName: "old.xls" }).catch(
      (error: unknown) => error,
    );
    expect(legacy).toMatchObject({ code: "unsupported-type", detail: { kind: "legacy-excel" } });

    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0];
    expect(
      await failureOf(inspectDelimitedStream(bytesBlob(ole), { fileName: "renamed.xlsx" })),
    ).toMatchObject({ code: "unsupported-type" });
    expect(
      await failureOf(inspectDelimitedStream(textBlob("a,b\n1,2\n"), { fileName: "book.xlsx" })),
    ).toMatchObject({ code: "unreadable-workbook" });
    expect(
      await failureOf(
        inspectDelimitedStream(bytesBlob([0x1f, 0x8b, 8, 0, 1, 2, 3]), { fileName: "t.csv.gz" }),
      ),
    ).toMatchObject({ code: "unreadable-file" });

    const bigText = `a,b\n${"1,2\n".repeat(100)}`;
    const tooLarge = await inspectDelimitedStream(textBlob(bigText), {
      fileName: "big.csv",
      maxTextBytes: 100,
    }).catch((error: unknown) => error);
    expect(tooLarge).toMatchObject({
      code: "too-large",
      detail: { kind: "too-large", measure: "text", limitBytes: 100 },
    });
  });

  it("returns workbook for .xlsx and ZIP magic bytes so callers fall back to parseFile", async () => {
    const workbook = await exampleBlob("mad4hatter_metadata_example.xlsx");
    expect(await inspectDelimitedStream(workbook, { fileName: "meta.xlsx" })).toEqual({
      kind: "workbook",
    });
    expect(
      await failureOf(
        inspectDelimitedStream(workbook, { fileName: "meta.xlsx", maxWorkbookBytes: 100 }),
      ),
    ).toMatchObject({ code: "too-large" });
  });

  it("matches parseFile on headers, delimiter, encoding, exactRowCount and previewRows", async () => {
    const blob = await exampleBlob("mad4hatter_allele_data_example.csv");
    const parsed = await parseFile(blob, "mad4hatter_allele_data_example.csv");
    const meta = expectDelimited(
      await inspectDelimitedStream(blob, {
        fileName: "mad4hatter_allele_data_example.csv",
      }),
    );
    expect(meta.delimiter).toBe(parsed.delimiter);
    expect(meta.encoding).toBe("utf-8");
    expect(meta.columns).toEqual(parsed.table.columns);
    expect(meta.exactRowCount).toBe(parsed.table.rows.length);
    expect(meta.previewRows).toEqual(parsed.table.rows.slice(0, 200));
  });

  it("returns exactRowCount = null when a file exceeds 2,000 data rows and keeps first 200 preview rows", async () => {
    const lines = ["a,b"];
    for (let i = 1; i <= 2_050; i += 1) lines.push(`s${i},${i}`);
    const blob = textBlob(`${lines.join("\n")}\n`);
    const meta = expectDelimited(await inspectDelimitedStream(blob, { fileName: "many.csv" }));
    expect(meta.exactRowCount).toBeNull();
    expect(meta.previewRows).toHaveLength(200);
    expect(meta.previewRows[0]).toEqual({ a: "s1", b: "1" });
    expect(meta.previewRows[199]).toEqual({ a: "s200", b: "200" });
  });

  it("handles BOMs, UTF-16LE, UTF-16BE, Windows-1252 fallback, and gzip across 1-byte chunks", async () => {
    const utf8Bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("site,note\nSão Tomé,€10😀\n"),
    ]);
    const utf8 = expectDelimited(
      await inspectDelimitedStream(chunkedBlob(bytesBlob(utf8Bytes), 1), {
        fileName: "bom.csv",
      }),
    );
    expect(utf8.encoding).toBe("utf-8");
    expect(utf8.columns).toEqual(["site", "note"]);
    expect(utf8.previewRows).toEqual([{ site: "São Tomé", note: "€10😀" }]);

    const utf16Text = "sample\treads\nS1\t5\n";
    const utf16LeBytes: number[] = [0xff, 0xfe];
    for (const char of utf16Text) utf16LeBytes.push(char.charCodeAt(0), 0);
    const utf16Le = expectDelimited(
      await inspectDelimitedStream(chunkedBlob(bytesBlob(utf16LeBytes), 1), {
        fileName: "u16le.txt",
      }),
    );
    expect(utf16Le.encoding).toBe("utf-16le");
    expect(utf16Le.previewRows).toEqual([{ sample: "S1", reads: "5" }]);

    const utf16BeBytes: number[] = [0xfe, 0xff];
    for (const char of utf16Text) utf16BeBytes.push(0, char.charCodeAt(0));
    const utf16Be = expectDelimited(
      await inspectDelimitedStream(chunkedBlob(bytesBlob(utf16BeBytes), 1), {
        fileName: "u16be.txt",
      }),
    );
    expect(utf16Be.encoding).toBe("utf-16be");
    expect(utf16Be.previewRows).toEqual([{ sample: "S1", reads: "5" }]);

    const cp1252Bytes = [
      ...new TextEncoder().encode("site\nS"),
      0xe3,
      0x6f,
      0x20,
      0x54,
      0x6f,
      0x6d,
      0xe9,
      0x20,
      0x96,
      0x20,
      0x31,
      0x0a,
    ];
    const cp1252 = expectDelimited(
      await inspectDelimitedStream(chunkedBlob(bytesBlob(cp1252Bytes), 2), {
        fileName: "cp.csv",
      }),
    );
    expect(cp1252.encoding).toBe("windows-1252");
    expect(cp1252.previewRows).toEqual([{ site: "São Tomé – 1" }]);

    const packed = gzipSync(Buffer.from("a\tb\n1\t2\n"));
    const gz = expectDelimited(
      await inspectDelimitedStream(chunkedBlob(bytesBlob(packed), 3), {
        fileName: "t.tsv.gz",
      }),
    );
    expect(gz.delimiter).toBe("\t");
    expect(gz.previewRows).toEqual([{ a: "1", b: "2" }]);
  });
});

describe("streamDelimitedChunks parity and chunk-boundary resilience", () => {
  it("matches parseFile byte-for-byte on every delimited file in public/examples/", async () => {
    const names = (await exampleNames()).filter((name) => !name.endsWith(".xlsx"));
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      // oxlint-disable-next-line no-await-in-loop -- checking each example file sequentially
      const blob = await exampleBlob(name);
      // oxlint-disable-next-line no-await-in-loop -- checking each example file sequentially
      const parsed = await parseFile(blob, name);
      // oxlint-disable-next-line no-await-in-loop -- checking each example file sequentially
      const streamed = await collectAllRows(blob, name, 137);
      expect(streamed.meta.delimiter).toBe(parsed.delimiter);
      expect(streamed.meta.columns).toEqual(parsed.table.columns);
      expect(streamed.rows).toEqual(parsed.table.rows);
    }
  });

  it.each([1, 2, 3, 7, 13, 64, 4096])(
    "matches parseFile across %i-byte chunks with quotes, escapes, embedded newlines, mixed line endings and UTF-8",
    async (byteChunkSize) => {
      const text =
        '\ufeffid,note,site\n1,"a, ""quoted""\r\nline",São Tomé\r\n2,"multi\nline""quote""end",€10😀\n\n3, x y ,0012\r\n4,"",plain\n5,trailing';
      const plainBlob = textBlob(text);
      const expected = await parseFile(plainBlob, "torture.csv");

      const streamedPlain = await collectAllRows(
        chunkedBlob(plainBlob, byteChunkSize),
        "torture.csv",
        2,
      );
      expect(streamedPlain.meta.columns).toEqual(expected.table.columns);
      expect(streamedPlain.rows).toEqual(expected.table.rows);

      const gzipped = bytesBlob(gzipSync(Buffer.from(text, "utf8")));
      const streamedGzip = await collectAllRows(
        chunkedBlob(gzipped, byteChunkSize),
        "torture.csv.gz",
        2,
      );
      expect(streamedGzip.meta.columns).toEqual(expected.table.columns);
      expect(streamedGzip.rows).toEqual(expected.table.rows);

      // CR-only line endings across chunk boundaries.
      const crOnly = textBlob('a,b\r1,"x\ry"\r2,3\r');
      const expectedCr = await parseFile(crOnly, "mac.csv");
      const streamedCr = await collectAllRows(chunkedBlob(crOnly, byteChunkSize), "mac.csv", 1);
      expect(streamedCr.meta.columns).toEqual(expectedCr.table.columns);
      expect(streamedCr.rows).toEqual(expectedCr.table.rows);
    },
  );

  it("handles CRLF, LF and CR mixed in any order across 1-byte chunks", async () => {
    const mixed = textBlob('id,val\r\n1,"a\r\nb"\n2,c\r3,d\r\n');
    const streamed = await collectAllRows(chunkedBlob(mixed, 1), "mixed.csv", 2);
    expect(streamed.meta.columns).toEqual(["id", "val"]);
    expect(streamed.rows).toEqual([
      { id: "1", val: "a\r\nb" },
      { id: "2", val: "c" },
      { id: "3", val: "d" },
    ]);
  });

  it("matches gridToRawTable on blank rows, trailing blank unnamed columns, duplicate headers and wider rows", async () => {
    const cases: readonly { readonly name: string; readonly text: string }[] = [
      {
        name: "duplicate-headers.csv",
        text: "reads, ,reads,reads (2),  reads  \n1,2,3,4,5\n",
      },
      {
        name: "trailing-blank-cols.csv",
        text: "\n a ,b,,\n1,2,,\n,,,\n  \t \n3,,x,\n\n",
      },
      {
        name: "wider-rows.csv",
        text: "a,b\n1\n2,3,4\n",
      },
      {
        name: "whitespace-cells.csv",
        text: "a,b,c\n  , x y ,0012\n",
      },
    ];

    for (const testCase of cases) {
      const blob = textBlob(testCase.text);
      // oxlint-disable-next-line no-await-in-loop -- checking each edge case sequentially
      const expected = await parseFile(blob, testCase.name);
      // oxlint-disable-next-line no-await-in-loop -- checking each edge case sequentially
      const streamed = await collectAllRows(chunkedBlob(blob, 3), testCase.name, 1);
      expect(streamed.meta.columns).toEqual(expected.table.columns);
      expect(streamed.rows).toEqual(expected.table.rows);
    }
  });

  it("restarts automatically to Windows-1252 when a non-UTF-8 byte appears in a late chunk", async () => {
    // Enough ASCII rows (> 2,000 rows and > 256 KiB) that inspectDelimitedStream stops before the CP-1252 row.
    const encoder = new TextEncoder();
    const pad = "x".repeat(120);
    const parts: Uint8Array[] = [encoder.encode("id,site\n")];
    for (let i = 1; i <= 2_500; i += 1) {
      parts.push(encoder.encode(`${i},ASCII_${i}_${pad}\n`));
    }
    // Row 2501: "2501,São Tomé – 1\n" in Windows-1252
    parts.push(
      new Uint8Array([
        ...encoder.encode("2501,S"),
        0xe3,
        0x6f,
        0x20,
        0x54,
        0x6f,
        0x6d,
        0xe9,
        0x20,
        0x96,
        0x20,
        0x31,
        0x0a,
      ]),
    );
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      combined.set(part, offset);
      offset += part.length;
    }
    const blob = bytesBlob(combined);
    const expected = await parseFile(blob, "late-cp1252.csv");

    const meta = expectDelimited(
      await inspectDelimitedStream(chunkedBlob(blob, 4096), { fileName: "late-cp1252.csv" }),
    );
    expect(meta.encoding).toBe("utf-8");
    expect(meta.exactRowCount).toBeNull();

    const rows: RawRow[] = [];
    for await (const chunk of streamDelimitedChunks(chunkedBlob(blob, 4096), {
      fileName: "late-cp1252.csv",
      delimiter: meta.delimiter,
      encoding: meta.encoding,
      columns: meta.columns,
      chunkSize: 500,
    })) {
      rows.push(...chunk);
    }
    expect(rows).toEqual(expected.table.rows);
    expect(rows.at(-1)).toEqual({ id: "2501", site: "São Tomé – 1" });
  });

  it("invokes onRestart when non-ASCII UTF-8 rows were yielded before a late invalid UTF-8 byte", async () => {
    const encoder = new TextEncoder();
    // Bytes 0xc3 0xa9 in row 1 are valid UTF-8 ("é") but decode as "Ã©" in Windows-1252.
    // Row 3 has 0xe9 (invalid UTF-8), forcing whole-file Windows-1252 fallback to match decodeText.
    const bytes = new Uint8Array([
      ...encoder.encode("id,site\n1,"),
      0xc3,
      0xa9,
      ...encoder.encode("\n2,plain\n3,"),
      0xe9,
      ...encoder.encode("\n"),
    ]);
    const blob = bytesBlob(bytes);
    const expected = await parseFile(blob, "mixed.csv");

    let rows: RawRow[] = [];
    const restarts: string[] = [];
    for await (const chunk of streamDelimitedChunks(chunkedBlob(blob, 2), {
      fileName: "mixed.csv",
      delimiter: ",",
      encoding: "utf-8",
      chunkSize: 1,
      onRestart: (encoding) => {
        restarts.push(encoding);
        rows = [];
      },
    })) {
      rows.push(...chunk);
    }
    expect(restarts).toEqual(["windows-1252"]);
    expect(rows).toEqual(expected.table.rows);
  });

  it("throws instead of mixing encodings when late Windows-1252 follows non-ASCII UTF-8 without onRestart", async () => {
    const encoder = new TextEncoder();
    const bytes = new Uint8Array([
      ...encoder.encode("id,site\n1,"),
      0xc3,
      0xa9,
      ...encoder.encode("\n2,plain\n3,"),
      0xe9,
      ...encoder.encode("\n"),
    ]);
    const drain = async (): Promise<RawRow[]> => {
      const collected: RawRow[] = [];
      for await (const chunk of streamDelimitedChunks(chunkedBlob(bytesBlob(bytes), 2), {
        fileName: "mixed.csv",
        delimiter: ",",
        encoding: "utf-8",
        chunkSize: 1,
      })) {
        collected.push(...chunk);
      }
      return collected;
    };
    await expect(drain()).rejects.toThrow(/onRestart/);
  });

  it("reports monotonic compressed/raw byte progress for both plain and gzipped files", async () => {
    const raw = new Uint8Array(
      await (await exampleBlob("mad4hatter_allele_data_example.csv")).arrayBuffer(),
    );
    const plain = chunkedBlob(bytesBlob(raw), 1024);
    const gzipped = chunkedBlob(bytesBlob(gzipSync(raw)), 512);

    for (const [label, blob] of [
      ["alleles.csv", plain],
      ["alleles.csv.gz", gzipped],
    ] as const) {
      const updates: StreamReadProgress[] = [];
      let totalChunks = 0;
      // oxlint-disable-next-line no-await-in-loop -- checking plain then gzipped sequentially
      for await (const chunk of streamDelimitedChunks(blob, {
        fileName: label,
        delimiter: "\t",
        chunkSize: 200,
        onProgress: (progress) => updates.push(progress),
      })) {
        if (chunk.length > 0) totalChunks += 1;
      }
      expect(totalChunks).toBeGreaterThan(1);
      expect(updates.length).toBeGreaterThan(1);
      let prevBytes = 0;
      let prevRows = 0;
      for (const update of updates) {
        expect(update.totalBytes).toBe(blob.size);
        expect(update.bytesRead).toBeGreaterThanOrEqual(prevBytes);
        expect(update.bytesRead).toBeLessThanOrEqual(blob.size);
        expect(update.rowsRead).toBeGreaterThanOrEqual(prevRows);
        prevBytes = update.bytesRead;
        prevRows = update.rowsRead;
      }
      expect(prevBytes).toBe(blob.size);
      expect(prevRows).toBe(981);
    }
  });

  it("stops reading cleanly when superseded", async () => {
    const lines = ["a,b"];
    for (let i = 1; i <= 500; i += 1) lines.push(`s${i},${i}`);
    const blob = chunkedBlob(textBlob(`${lines.join("\n")}\n`), 64);

    let chunksSeen = 0;
    for await (const chunk of streamDelimitedChunks(blob, {
      fileName: "abort.csv",
      delimiter: ",",
      chunkSize: 50,
      isSuperseded: () => chunksSeen >= 2,
    })) {
      if (chunk.length > 0) chunksSeen += 1;
    }
    expect(chunksSeen).toBe(2);
  });

  it("stops unpacking a gzipped file once unpacked bytes exceed maxTextBytes", async () => {
    const packed = gzipSync(Buffer.from(`a,b\n${"1,2\n".repeat(100_000)}`));
    expect(packed.length).toBeLessThan(10_000);
    const drain = async (): Promise<number> => {
      let count = 0;
      for await (const chunk of streamDelimitedChunks(bytesBlob(packed), {
        fileName: "bomb.csv.gz",
        delimiter: ",",
        maxTextBytes: 50_000,
      })) {
        count += chunk.length;
      }
      return count;
    };
    expect(await failureOf(drain())).toMatchObject({ code: "too-large" });
  });
});

describe("streamDistinctValues", () => {
  it("matches distinctValues and stops early once limit + 1 distinct trimmed values are found", async () => {
    const blob = await exampleBlob("mad4hatter_allele_data_example.csv");
    const parsed = await parseFile(blob, "mad4hatter_allele_data_example.csv");

    const full = await streamDistinctValues(blob, {
      fileName: "mad4hatter_allele_data_example.csv",
      delimiter: "\t",
      column: "Locus",
      limit: 200,
    });
    expect(full).toEqual(distinctValues(parsed.table, "Locus", 200));

    const capped = await streamDistinctValues(chunkedBlob(blob, 128), {
      fileName: "mad4hatter_allele_data_example.csv",
      delimiter: "\t",
      column: "SampleID",
      limit: 5,
    });
    expect(capped).toEqual(distinctValues(parsed.table, "SampleID", 5));
    expect(capped.truncated).toBe(true);
    expect(capped.values).toHaveLength(5);
  });

  it("stops reading early on a huge stream without reading the rest of the Blob", async () => {
    const lines = ["run,val"];
    for (let i = 1; i <= 5_000; i += 1) lines.push(`r${i},${i}`);
    const base = textBlob(`${lines.join("\n")}\n`);
    let bytesPulled = 0;
    const tracked = base.slice(0, base.size);
    Object.defineProperty(tracked, "stream", {
      configurable: true,
      value: (): ReadableStream<Uint8Array<ArrayBuffer>> => {
        let offset = 0;
        return new ReadableStream<Uint8Array<ArrayBuffer>>({
          async pull(controller) {
            if (offset >= base.size) {
              controller.close();
              return;
            }
            const end = Math.min(offset + 256, base.size);
            const buf = await base.slice(offset, end).arrayBuffer();
            offset = end;
            bytesPulled += buf.byteLength;
            controller.enqueue(new Uint8Array(buf));
          },
        });
      },
    });

    const result = await streamDistinctValues(tracked, {
      fileName: "runs.csv",
      delimiter: ",",
      column: "run",
      limit: 3,
    });
    expect(result).toEqual({ values: ["r1", "r2", "r3"], truncated: true });
    expect(bytesPulled).toBeLessThan(base.size / 10);
  });

  it("resets seen values on late Windows-1252 fallback after non-ASCII UTF-8 values", async () => {
    const encoder = new TextEncoder();
    // Row 1 holds valid UTF-8 ("é") which decodes as "Ã©" in Windows-1252; row 3 has 0xe9 (invalid UTF-8).
    const bytes = new Uint8Array([
      ...encoder.encode("id,site\n1,"),
      0xc3,
      0xa9,
      ...encoder.encode("\n2,plain\n3,"),
      0xe9,
      ...encoder.encode("\n"),
    ]);
    const blob = bytesBlob(bytes);
    const parsed = await parseFile(blob, "mixed-distinct.csv");

    const result = await streamDistinctValues(chunkedBlob(blob, 2), {
      fileName: "mixed-distinct.csv",
      delimiter: ",",
      encoding: "utf-8",
      column: "site",
      limit: 50,
    });
    expect(result).toEqual(distinctValues(parsed.table, "site", 50));
    expect(result.values).toEqual(["Ã©", "plain", "é"]);
  });
});

/** A tiny Blob reporting a synthetic byte size without allocating gigabytes. */
function fakeSizedBlob(content: string, reportedSize: number): Blob {
  const blob = new Blob([content]);
  Object.defineProperty(blob, "size", { configurable: true, value: reportedSize });
  return blob;
}

describe("allele table size limit and limit formatting", () => {
  it("raises the streamed allele table limit to 3 GB while keeping 300 MB for other tables and 50 MB for workbooks", async () => {
    expect(IMPORT_LIMITS.alleleTextBytes).toBe(3 * 1024 * 1024 * 1024);
    expect(IMPORT_LIMITS.textBytes).toBe(300 * 1024 * 1024);
    expect(IMPORT_LIMITS.workbookBytes).toBe(50 * 1024 * 1024);

    // 500 MB passes the streamed allele table limit, but parseFile rejects it at 300 MB.
    const midSized = fakeSizedBlob("a,b\n1,2\n", 500 * 1024 * 1024);
    const inspected = await inspectDelimitedStream(midSized, { fileName: "alleles.csv" });
    expect(inspected.kind).toBe("delimited");

    const wholeTableError = await parseFile(midSized, "metadata.tsv").catch(
      (error: unknown) => error,
    );
    expect(wholeTableError).toMatchObject({
      code: "too-large",
      detail: { kind: "too-large", measure: "text", limitBytes: IMPORT_LIMITS.textBytes },
    });
    expect(wholeTableError instanceof ImportError ? wholeTableError.message : "").toContain(
      "300 MB",
    );

    // Over 3 GB fails inspectDelimitedStream, streamDelimitedChunks, and streamDistinctValues with "3 GB".
    const overAlleleLimit = fakeSizedBlob("a,b\n1,2\n", IMPORT_LIMITS.alleleTextBytes + 1);
    const inspectError = await inspectDelimitedStream(overAlleleLimit, {
      fileName: "huge.csv",
    }).catch((error: unknown) => error);
    expect(inspectError).toMatchObject({
      code: "too-large",
      detail: { kind: "too-large", measure: "text", limitBytes: IMPORT_LIMITS.alleleTextBytes },
    });
    expect(inspectError instanceof ImportError ? inspectError.message : "").toContain("3 GB");

    const streamChunksError = await (async () => {
      let seen = 0;
      for await (const chunk of streamDelimitedChunks(overAlleleLimit, {
        fileName: "huge.csv",
        delimiter: ",",
      })) {
        seen += chunk.length;
      }
      return seen;
    })().catch((error: unknown) => error);
    expect(streamChunksError).toMatchObject({
      code: "too-large",
      detail: { kind: "too-large", measure: "text", limitBytes: IMPORT_LIMITS.alleleTextBytes },
    });

    const distinctError = await streamDistinctValues(overAlleleLimit, {
      fileName: "huge.csv",
      delimiter: ",",
      column: "a",
    }).catch((error: unknown) => error);
    expect(distinctError).toMatchObject({
      code: "too-large",
      detail: { kind: "too-large", measure: "text", limitBytes: IMPORT_LIMITS.alleleTextBytes },
    });

    // Workbooks still enforce the 50 MB limit.
    const zipHead = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const bigWorkbook = new Blob([zipHead]);
    Object.defineProperty(bigWorkbook, "size", {
      configurable: true,
      value: IMPORT_LIMITS.workbookBytes + 1,
    });
    const wbError = await parseFile(bigWorkbook, "big.xlsx").catch((error: unknown) => error);
    expect(wbError).toMatchObject({
      code: "too-large",
      detail: { kind: "too-large", measure: "workbook", limitBytes: IMPORT_LIMITS.workbookBytes },
    });
    expect(wbError instanceof ImportError ? wbError.message : "").toContain("50 MB");
  });

  it("formats gigabyte and megabyte limits cleanly in importFailureMessage", () => {
    const alleleNamed = importFailureMessage(
      {
        code: "too-large",
        detail: { kind: "too-large", measure: "text", limitBytes: IMPORT_LIMITS.alleleTextBytes },
      },
      "huge.csv",
    );
    expect(alleleNamed).toContain('"huge.csv"');
    expect(alleleNamed).toContain("3 GB");
    expect(alleleNamed).not.toContain("3,072 MB");

    const alleleUnnamed = importFailureMessage({
      code: "too-large",
      detail: { kind: "too-large", measure: "text", limitBytes: IMPORT_LIMITS.alleleTextBytes },
    });
    expect(alleleUnnamed).toContain("3 GB");

    const otherTable = importFailureMessage(
      {
        code: "too-large",
        detail: { kind: "too-large", measure: "text", limitBytes: IMPORT_LIMITS.textBytes },
      },
      "samples.tsv",
    );
    expect(otherTable).toContain("300 MB");

    const workbook = importFailureMessage(
      {
        code: "too-large",
        detail: { kind: "too-large", measure: "workbook", limitBytes: IMPORT_LIMITS.workbookBytes },
      },
      "samples.xlsx",
    );
    expect(workbook).toContain("50 MB");
  });
});
