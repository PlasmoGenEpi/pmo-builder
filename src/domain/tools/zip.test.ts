import { describe, expect, it } from "vitest";

import { crc32, zipFiles } from "./zip";
import { readZip } from "./zipTesting";

describe("crc32", () => {
  it("gives the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610_a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zipFiles", () => {
  it("writes entries that read back the same, with UTF-8 names", async () => {
    const encoder = new TextEncoder();
    const blob = await zipFiles([
      { name: "a.csv", data: encoder.encode("x,y\n1,2\n".repeat(1000)) },
      { name: "ação.tsv", data: encoder.encode("") },
    ]);
    expect(blob.type).toBe("application/zip");
    expect(await readZip(blob)).toEqual([
      { name: "a.csv", text: "x,y\n1,2\n".repeat(1000) },
      { name: "ação.tsv", text: "" },
    ]);
  });
});
