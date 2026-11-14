import { crc32, gzipSync } from "node:zlib";

import { inferColumnTypes } from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { getFieldSet } from "../fields";
import type { ColumnMapping } from "../types";

import { exampleBlob, exampleNames } from "./exampleFiles.testing";
import {
  ImportError,
  excelCellToText,
  parseFile,
  textColumnsFor,
  readBooleanCell,
  typeTable,
  type ImportErrorCode,
} from "./index";

function textBlob(text: string): Blob {
  return new Blob([text]);
}

function bytesBlob(bytes: readonly number[] | Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

/** What a parse failed with, in a form one `expect` can check. */
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

// ---------------------------------------------------------------------------
// A minimal .xlsx writer (stored zip entries), so workbook cells of every type
// can be tested without a spreadsheet library.
// ---------------------------------------------------------------------------

type TestCell =
  | { readonly t: "s"; readonly v: string }
  | { readonly t: "n"; readonly v: number; readonly style?: "date" | "datetime" }
  | { readonly t: "b"; readonly v: boolean }
  | null;

function zip(entries: Readonly<Record<string, string>>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function sheetXml(rows: readonly (readonly TestCell[])[]): string {
  const letters = "ABCDEFGHIJ";
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const ref = `${letters[c] ?? "Z"}${r + 1}`;
          if (cell === null) return "";
          if (cell.t === "s") {
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.v)}</t></is></c>`;
          }
          if (cell.t === "b") return `<c r="${ref}" t="b"><v>${cell.v ? 1 : 0}</v></c>`;
          const style =
            cell.style === "date" ? ' s="1"' : cell.style === "datetime" ? ' s="2"' : "";
          return `<c r="${ref}"${style}><v>${cell.v}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function xlsx(sheets: Readonly<Record<string, readonly (readonly TestCell[])[]>>): Blob {
  const names = Object.keys(sheets);
  const entries: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="22" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };
  for (const [i, name] of names.entries()) {
    entries[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[name] ?? []);
  }
  return new Blob([new Uint8Array(zip(entries))]);
}

const s = (v: string): TestCell => ({ t: "s", v });
const n = (v: number, style?: "date" | "datetime"): TestCell =>
  style === undefined ? { t: "n", v } : { t: "n", v, style };
const b = (v: boolean): TestCell => ({ t: "b", v });

// ---------------------------------------------------------------------------

describe("parseFile with the example files", () => {
  const expected: Record<string, { columns: number; rows: number; delimiter: string | null }> = {
    "PMO_building_template.xlsx": { columns: 3, rows: 20, delimiter: null },
    "example_contributors.txt": { columns: 1, rows: 2, delimiter: "\t" },
    "example_raw_reads.txt": { columns: 2, rows: 3, delimiter: "\t" },
    // Named .csv, but tab-delimited.
    "mad4hatter_allele_data_example.csv": { columns: 6, rows: 981, delimiter: "\t" },
    "mad4hatter_allele_data_example_multi_bioinfo.csv": { columns: 7, rows: 781, delimiter: "\t" },
    "mad4hatter_metadata_example.tsv": { columns: 17, rows: 50, delimiter: "\t" },
    "mad4hatter_metadata_example.xlsx": { columns: 17, rows: 50, delimiter: null },
    "mad4hatter_metadata_example_multi_panel.xlsx": { columns: 17, rows: 50, delimiter: null },
    "mad4hatter_panel_info_example.csv": { columns: 10, rows: 276, delimiter: "\t" },
    "reads_per_stage.txt": { columns: 4, rows: 8, delimiter: "\t" },
  };

  it("covers every example file", async () => {
    expect(await exampleNames()).toEqual(Object.keys(expected).toSorted());
  });

  for (const [name, want] of Object.entries(expected)) {
    it(`parses ${name}`, async () => {
      const parsed = await parseFile(await exampleBlob(name), name);
      expect(parsed.table.columns).toHaveLength(want.columns);
      expect(parsed.table.rows).toHaveLength(want.rows);
      expect(parsed.delimiter).toBe(want.delimiter);
      expect(parsed.format).toBe(want.delimiter === null ? "xlsx" : "delimited");
      expect(new Set(parsed.table.columns).size).toBe(parsed.table.columns.length);
    });
  }

  it("reads the same table from the metadata .tsv and .xlsx", async () => {
    const tsv = await parseFile(await exampleBlob("mad4hatter_metadata_example.tsv"), "m.tsv");
    const workbook = await parseFile(
      await exampleBlob("mad4hatter_metadata_example.xlsx"),
      "m.xlsx",
    );
    expect(workbook.sheetNames).toEqual(["Sheet1"]);
    expect(workbook.sheetName).toBe("Sheet1");
    expect(workbook.table).toEqual(tsv.table);
  });

  it("lists the template's sheets and reads the one asked for", async () => {
    const blob = await exampleBlob("PMO_building_template.xlsx");
    const first = await parseFile(blob, "PMO_building_template.xlsx");
    expect(first.sheetNames).toHaveLength(12);
    expect(first.sheetName).toBe("Overview");
    expect(first.table.columns).toEqual(["Overview", "Column 2", "Column 3"]);
    // The other sheets hold headers only.
    expect(
      await failureOf(
        parseFile(blob, "PMO_building_template.xlsx", { sheetName: "Required Microhaplotype" }),
      ),
    ).toMatchObject({ code: "no-rows" });
  });
});

describe("parseFile with delimited text", () => {
  it.each([
    [",", "a,b,c\n1,2,3\n"],
    ["\t", "a\tb\tc\n1\t2\t3\n"],
    [";", "a;b;c\n1,5;2;3\n"],
    ["|", "a|b|c\n1|2|3\n"],
  ])("detects %j", async (delimiter, text) => {
    const parsed = await parseFile(textBlob(text), "table.txt");
    expect(parsed.delimiter).toBe(delimiter);
    expect(parsed.table.columns).toEqual(["a", "b", "c"]);
  });

  it("is not fooled by commas inside tab-delimited cells", async () => {
    const text = "name\tlat_lon\tcollector\nS1\t25.58,32.35\tDoe, Jane\nS2\t1.0,2.0\tRoe, Ray\n";
    const parsed = await parseFile(textBlob(text), "table.csv");
    expect(parsed.delimiter).toBe("\t");
    expect(parsed.table.rows[0]).toEqual({
      name: "S1",
      lat_lon: "25.58,32.35",
      collector: "Doe, Jane",
    });
  });

  it("handles quoted fields with delimiters, quotes and line breaks", async () => {
    const text = 'id,note\r\n1,"a, ""quoted""\r\nline"\r\n2,plain\r\n';
    const parsed = await parseFile(textBlob(text), "t.csv");
    expect(parsed.table.rows).toEqual([
      { id: "1", note: 'a, "quoted"\r\nline' },
      { id: "2", note: "plain" },
    ]);
  });

  it("handles LF, CRLF and mixed line endings", async () => {
    const texts = ["a,b\n1,2\n3,4", "a,b\r\n1,2\r\n3,4\r\n", "a,b\n1,2\r\n3,4\n"];
    const parsed = await Promise.all(texts.map((text) => parseFile(textBlob(text), "t.csv")));
    expect(parsed.map((file) => file.table.rows)).toEqual(
      texts.map(() => [
        { a: "1", b: "2" },
        { a: "3", b: "4" },
      ]),
    );
  });

  it("strips a UTF-8 byte order mark", async () => {
    const bytes = [0xef, 0xbb, 0xbf, ...new TextEncoder().encode("sample,reads\nS1,5\n")];
    const parsed = await parseFile(bytesBlob(bytes), "t.csv");
    expect(parsed.table.columns).toEqual(["sample", "reads"]);
  });

  it("reads UTF-16 with a byte order mark", async () => {
    const text = "sample\treads\nS1\t5\n";
    const bytes = [0xff, 0xfe];
    for (const char of text) bytes.push(char.charCodeAt(0), 0);
    const parsed = await parseFile(bytesBlob(bytes), "t.txt");
    expect(parsed.table.rows).toEqual([{ sample: "S1", reads: "5" }]);
  });

  it("keeps UTF-8 text and falls back to Windows-1252 for other bytes", async () => {
    const utf8 = await parseFile(textBlob("site\nSão Tomé\n"), "t.csv");
    expect(utf8.table.rows[0]).toEqual({ site: "São Tomé" });
    // "São Tomé – 1" in Windows-1252: ã = e3, é = e9, en dash = 96.
    const ascii = [...new TextEncoder().encode("site\nS")];
    const bytes = [
      ...ascii,
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
    const cp1252 = await parseFile(bytesBlob(bytes), "t.csv");
    expect(cp1252.table.rows[0]).toEqual({ site: "São Tomé – 1" });
  });

  it("recognises gzip from the bytes, whatever the name", async () => {
    const packed = gzipSync(Buffer.from("a\tb\n1\t2\n"));
    const names = ["t.tsv.gz", "t.gz", "t.tsv", "t.txt.gzip"];
    const parsed = await Promise.all(names.map((name) => parseFile(bytesBlob(packed), name)));
    expect(parsed.map((file) => file.table.rows)).toEqual(names.map(() => [{ a: "1", b: "2" }]));
  });

  it("reads a gzipped allele table", async () => {
    const raw = new Uint8Array(
      await (await exampleBlob("mad4hatter_allele_data_example.csv")).arrayBuffer(),
    );
    const parsed = await parseFile(bytesBlob(gzipSync(raw)), "alleles.csv.gz");
    expect(parsed.table.rows).toHaveLength(981);
  });

  it("names blank headers and makes repeated headers unique", async () => {
    const text = "reads, ,reads,reads (2),  reads  \n1,2,3,4,5\n";
    const parsed = await parseFile(textBlob(text), "t.csv");
    expect(parsed.table.columns).toEqual([
      "reads",
      "Column 2",
      "reads (3)",
      "reads (2)",
      "reads (4)",
    ]);
  });

  it("drops blank rows and trailing blank columns, keeps unnamed columns with data", async () => {
    const text = "\n a ,b,,\n1,2,,\n,,,\n  \t \n3,,x,\n\n";
    const parsed = await parseFile(textBlob(text), "t.csv");
    expect(parsed.table.columns).toEqual(["a", "b", "Column 3"]);
    expect(parsed.table.rows).toEqual([
      { a: "1", b: "2", "Column 3": null },
      { a: "3", b: null, "Column 3": "x" },
    ]);
  });

  it("turns whitespace-only cells into null and keeps other text exactly", async () => {
    const parsed = await parseFile(textBlob("a,b,c\n  , x y ,0012\n"), "t.csv");
    expect(parsed.table.rows).toEqual([{ a: null, b: " x y ", c: "0012" }]);
  });

  it("fills short rows with null and names extra cells", async () => {
    const parsed = await parseFile(textBlob("a,b\n1\n2,3,4\n"), "t.csv");
    expect(parsed.table.columns).toEqual(["a", "b", "Column 3"]);
    expect(parsed.table.rows[0]).toEqual({ a: "1", b: null, "Column 3": null });
  });
});

describe("parseFile with workbooks", () => {
  it("writes cells as a careful CSV export would", async () => {
    const workbook = xlsx({
      Data: [
        [s("name"), s("count"), s("ratio"), s("date"), s("time"), s("flag"), s(" padded ")],
        [s("0012"), n(12), n(0.1), n(45293, "date"), n(45293.5, "datetime"), b(true), s("  ")],
        [s("S2"), n(-0), n(1e21), n(45293, "datetime"), null, b(false), s(" x ")],
      ],
      Other: [[s("x")], [n(1)]],
    });
    const parsed = await parseFile(workbook, "book.xlsx");
    expect(parsed.sheetNames).toEqual(["Data", "Other"]);
    expect(parsed.table.columns).toEqual([
      "name",
      "count",
      "ratio",
      "date",
      "time",
      "flag",
      "padded",
    ]);
    expect(parsed.table.rows).toEqual([
      {
        name: "0012",
        count: "12",
        ratio: "0.1",
        date: "2024-01-02",
        time: "2024-01-02 12:00:00",
        flag: "TRUE",
        padded: null,
      },
      {
        name: "S2",
        count: "0",
        ratio: "1e+21",
        date: "2024-01-02",
        time: null,
        flag: "FALSE",
        padded: " x ",
      },
    ]);
    const other = await parseFile(workbook, "book.xlsx", { sheetName: "Other" });
    expect(other.sheetName).toBe("Other");
    expect(other.table.rows).toEqual([{ x: "1" }]);
  });

  it("converts single cells", () => {
    expect(excelCellToText(12)).toBe("12");
    expect(excelCellToText(12.25)).toBe("12.25");
    expect(excelCellToText(0.30000000000000004)).toBe("0.30000000000000004");
    expect(excelCellToText(new Date(Date.UTC(2024, 0, 2)))).toBe("2024-01-02");
    expect(excelCellToText(new Date(Date.UTC(2024, 0, 2, 8, 30, 0, 250)))).toBe(
      "2024-01-02 08:30:00.250",
    );
    expect(excelCellToText(true)).toBe("TRUE");
    expect(excelCellToText(null)).toBeNull();
  });
});

describe("parseFile errors", () => {
  it("rejects an empty file", async () => {
    expect(await failureOf(parseFile(bytesBlob([]), "t.csv"))).toMatchObject({
      code: "empty-file",
    });
    expect(await failureOf(parseFile(textBlob("\n \r\n\t\n"), "t.csv"))).toMatchObject({
      code: "empty-file",
    });
  });

  it("rejects a header with no rows", async () => {
    expect(await failureOf(parseFile(textBlob("a,b,c\n\n"), "t.csv"))).toMatchObject({
      code: "no-rows",
    });
  });

  it("rejects unsupported types, including .xls", async () => {
    expect(await failureOf(parseFile(textBlob("{}"), "data.json"))).toMatchObject({
      code: "unsupported-type",
    });
    expect(await failureOf(parseFile(textBlob("a,b"), "noextension"))).toMatchObject({
      code: "unsupported-type",
    });
    expect(await failureOf(parseFile(textBlob("a,b"), "old.xls"))).toMatchObject({
      code: "unsupported-type",
    });
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0];
    expect(await failureOf(parseFile(bytesBlob(ole), "renamed.xlsx"))).toMatchObject({
      code: "unsupported-type",
      message: expect.stringContaining("save it as .xlsx"),
    });
  });

  it("rejects an unreadable workbook", async () => {
    expect(await failureOf(parseFile(textBlob("a,b\n1,2\n"), "book.xlsx"))).toMatchObject({
      code: "unreadable-workbook",
    });
    const broken = [0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(await failureOf(parseFile(bytesBlob(broken), "book.xlsx"))).toMatchObject({
      code: "unreadable-workbook",
    });
  });

  it("rejects damaged gzip", async () => {
    expect(
      await failureOf(parseFile(bytesBlob([0x1f, 0x8b, 8, 0, 1, 2, 3]), "t.csv.gz")),
    ).toMatchObject({ code: "unreadable-file" });
  });

  it("says when the file is an old .xls workbook, so the message can say to save it as .xlsx", async () => {
    const caught = await parseFile(textBlob("a,b"), "old.xls").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ImportError);
    expect(caught).toMatchObject({ detail: { kind: "legacy-excel" } });
    const other = await parseFile(textBlob("{}"), "data.json").catch((error: unknown) => error);
    expect(other).toMatchObject({ code: "unsupported-type", detail: { kind: "none" } });
  });

  it("refuses text over the size limit before reading it, with the limit in the error", async () => {
    const text = `a,b\n${"1,2\n".repeat(100)}`;
    const caught = await parseFile(textBlob(text), "big.csv", {
      limits: { textBytes: 100 },
    }).catch((error: unknown) => error);
    expect(caught).toMatchObject({
      code: "too-large",
      detail: { kind: "too-large", measure: "text", limitBytes: 100 },
    });
    // Under the limit, the same file reads.
    const parsed = await parseFile(textBlob(text), "big.csv", { limits: { textBytes: 10_000 } });
    expect(parsed.table.rows).toHaveLength(100);
  });

  it("stops unpacking a .gz once it passes the limit", async () => {
    const packed = gzipSync(Buffer.from(`a,b\n${"1,2\n".repeat(100_000)}`));
    expect(packed.length).toBeLessThan(10_000);
    expect(
      await failureOf(parseFile(bytesBlob(packed), "t.csv.gz", { limits: { textBytes: 50_000 } })),
    ).toMatchObject({ code: "too-large" });
  });

  it("refuses a workbook over the workbook limit", async () => {
    const blob = await exampleBlob("mad4hatter_metadata_example.xlsx");
    expect(
      await failureOf(parseFile(blob, "m.xlsx", { limits: { workbookBytes: 1000 } })),
    ).toMatchObject({ code: "too-large", message: expect.stringContaining(".csv") });
  });

  it("rejects a missing sheet", async () => {
    const blob = await exampleBlob("mad4hatter_metadata_example.xlsx");
    expect(await failureOf(parseFile(blob, "m.xlsx", { sheetName: "Sheet9" }))).toMatchObject({
      code: "missing-sheet",
    });
  });
});

describe("typeTable", () => {
  const table = {
    columns: ["sample", "year", "reads", "flag"],
    rows: [
      { sample: "0012", year: "2024", reads: "0012", flag: "TRUE" },
      { sample: "NA", year: null, reads: "7", flag: "false" },
    ],
  };

  it("keeps text columns exactly and types the rest", () => {
    expect(typeTable(table, { textColumns: ["sample", "year", "not-a-column"] })).toEqual([
      { sample: "0012", year: "2024", reads: 12, flag: true },
      { sample: "NA", year: null, reads: 7, flag: false },
    ]);
  });

  it("types every column when none is text", () => {
    expect(typeTable(table, { textColumns: [] })).toEqual([
      { sample: 12, year: 2024, reads: 12, flag: true },
      { sample: null, year: null, reads: 7, flag: false },
    ]);
  });

  it("matches inferColumnTypes on an example table when no column is text", async () => {
    const parsed = await parseFile(await exampleBlob("mad4hatter_metadata_example.tsv"), "m.tsv");
    expect(typeTable(parsed.table, { textColumns: [] })).toEqual(
      inferColumnTypes(parsed.table.rows),
    );
  });

  it("keeps every column in table order", () => {
    const typed = typeTable(table, { textColumns: ["reads"] });
    expect(Object.keys(typed[0] ?? {})).toEqual(table.columns);
  });

  it("derives text columns from a mapping", () => {
    const mapping: ColumnMapping = {
      fields: {
        specimenName: "specimen_id",
        collectionDate: "collection_date",
        hostTaxonId: "host_taxon_id",
        drugUsage: "drugs",
        hostAge: "age",
        geoAdmin1: null,
      },
      additionalColumns: ["extra"],
    };
    expect(textColumnsFor(getFieldSet("specimens"), mapping)).toEqual([
      "specimen_id",
      "collection_date",
      "drugs",
    ]);
  });
});

describe("yes-or-no cells", () => {
  it("reads the usual spellings in any case, and blanks", () => {
    for (const text of ["TRUE", "true", "True", " yes ", "Y", "1", "t"]) {
      expect(readBooleanCell(text)).toEqual({ kind: "value", value: true });
    }
    for (const text of ["FALSE", "false", "No", "n", "0", "F"]) {
      expect(readBooleanCell(text)).toEqual({ kind: "value", value: false });
    }
    for (const text of [null, "", "  ", "NA", "N/A", "null"]) {
      expect(readBooleanCell(text)).toEqual({ kind: "blank" });
    }
  });

  it("reports anything else rather than guessing", () => {
    for (const text of ["maybe", "2", "yes please", "-1", "na"]) {
      expect(readBooleanCell(text)).toEqual({ kind: "invalid", text });
    }
  });

  it("types boolean columns with typeTable, keeping unknown text as it is", () => {
    const table = {
      columns: ["id", "gravid", "travel"],
      rows: [
        { id: "1", gravid: "TRUE", travel: "yes" },
        { id: "2", gravid: "false", travel: "1" },
        { id: "3", gravid: null, travel: "maybe" },
      ],
    };
    expect(typeTable(table, { textColumns: [], booleanColumns: ["gravid", "travel"] })).toEqual([
      { id: 1, gravid: true, travel: true },
      { id: 2, gravid: false, travel: true },
      { id: 3, gravid: null, travel: "maybe" },
    ]);
  });

  it("would have passed yes and 1 through as text and numbers without the boolean kind", () => {
    // What pandas-style inference alone does, and why the boolean kind exists.
    const table = {
      columns: ["a", "b"],
      rows: [
        { a: "yes", b: "1" },
        { a: "no", b: "0" },
      ],
    };
    expect(typeTable(table, { textColumns: [] })).toEqual([
      { a: "yes", b: 1 },
      { a: "no", b: 0 },
    ]);
  });
});
