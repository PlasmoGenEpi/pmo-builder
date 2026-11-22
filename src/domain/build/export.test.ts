import { constants as bufferConstants } from "node:buffer";
import { gunzipSync } from "node:zlib";

import {
  PmoError,
  gzipPmo,
  stringifyPmo,
  stringifyPmoChunks,
  type PortableMicrohaplotypeObject,
} from "pmotools-ts";
import { describe, expect, it } from "vitest";

import { exportPmo, measurePmoSize, pmoFileName, previewPmo } from "./export";
import { buildExamplePmo } from "./testing";

describe("exportPmo and measurePmoSize", () => {
  const example = buildExamplePmo();

  it("streams plain JSON and gzipped PMO blobs byte-for-byte matching stringifyPmo and gzipPmo", async () => {
    const plain = await exportPmo(example, { gzip: false });
    const gz = await exportPmo(example, { gzip: true });

    expect(plain.fileName).toBe("Mad4hatter.pmo.json");
    expect(plain.blob.type).toBe("application/json");
    expect(gz.fileName).toBe("Mad4hatter.pmo.json.gz");
    expect(gz.blob.type).toBe("application/gzip");

    const plainBytes = new Uint8Array(await plain.blob.arrayBuffer());
    const expectedPlainBytes = new TextEncoder().encode(stringifyPmo(example));
    expect(plainBytes).toEqual(expectedPlainBytes);

    const gzBytes = new Uint8Array(await gz.blob.arrayBuffer());
    const expectedGzBytes = await gzipPmo(example);
    expect(gzBytes).toEqual(expectedGzBytes);
    expect([gzBytes[0], gzBytes[1]]).toEqual([0x1f, 0x8b]);
    expect(new Uint8Array(gunzipSync(gzBytes))).toEqual(plainBytes);
  });

  it("counts plain and gzipped byte sizes from the stream matching the exported Blobs", async () => {
    const [plain, gz, plainSize, gzSize] = await Promise.all([
      exportPmo(example, { gzip: false }),
      exportPmo(example, { gzip: true }),
      measurePmoSize(example, { gzip: false }),
      measurePmoSize(example, { gzip: true }),
    ]);

    expect(plainSize).toBe(plain.blob.size);
    expect(gzSize).toBe(gz.blob.size);
    expect(await measurePmoSize(example)).toBe(gz.blob.size);
  });

  it("matches Blob sizes when the PMO contains non-ASCII characters", async () => {
    const unicodePmo: PortableMicrohaplotypeObject = {
      ...example,
      project_info: [
        {
          project_name: "Étude café 日本",
          project_description: "Données avec accents: éàü — β",
        },
      ],
    };

    const [plain, gz, plainSize, gzSize] = await Promise.all([
      exportPmo(unicodePmo, { gzip: false }),
      exportPmo(unicodePmo, { gzip: true }),
      measurePmoSize(unicodePmo, { gzip: false }),
      measurePmoSize(unicodePmo, { gzip: true }),
    ]);

    expect(pmoFileName(unicodePmo, true)).toBe("tude_caf.pmo.json.gz");
    expect(plainSize).toBe(plain.blob.size);
    expect(gzSize).toBe(gz.blob.size);
    expect(new Uint8Array(await plain.blob.arrayBuffer())).toEqual(
      new TextEncoder().encode(stringifyPmo(unicodePmo)),
    );
  });
});

describe("previewPmo", () => {
  const example = buildExamplePmo();

  it("matches stringifyPmo with ensureAscii: false for full, boundary, truncated, and zero lengths", () => {
    const unicodePmo: PortableMicrohaplotypeObject = {
      ...example,
      project_info: [
        {
          project_name: "Étude café",
          project_description: "Données avec accents: éàü",
        },
      ],
    };
    const expectedFull = stringifyPmo(unicodePmo, { ensureAscii: false });

    const full = previewPmo(unicodePmo, expectedFull.length + 100);
    expect(full).toEqual({
      text: expectedFull,
      truncated: false,
      length: expectedFull.length,
    });
    expect(full.text).toContain("Étude café");

    const exact = previewPmo(unicodePmo, expectedFull.length);
    expect(exact).toEqual({
      text: expectedFull,
      truncated: false,
      length: expectedFull.length,
    });

    const cut = previewPmo(unicodePmo, 500);
    expect(cut).toEqual({
      text: expectedFull.slice(0, 500),
      truncated: true,
      length: null,
    });

    const empty = previewPmo(unicodePmo, 0);
    expect(empty).toEqual({
      text: "",
      truncated: true,
      length: null,
    });
  });

  it("stops early without walking the rest of a large PMO", () => {
    const sharedMhap = { seq: "ACGT".repeat(25) };
    let tailTouched = false;
    const poisonedTail = {
      seq: "AAAA",
      toJSON(): string {
        tailTouched = true;
        throw new Error("preview walked to the end of the PMO");
      },
    };
    // > 50,000 nodes and > 3 MiB of formatted JSON so stringifyPmoChunks yields multiple pieces.
    const microhaplotypes = [...Array.from({ length: 30_000 }, () => sharedMhap), poisonedTail];
    const largePmo: PortableMicrohaplotypeObject = {
      ...example,
      representative_microhaplotypes: {
        targets: [{ target_id: 0, microhaplotypes }],
      },
    };

    expect(() => stringifyPmo(largePmo)).toThrow(PmoError);
    expect(tailTouched).toBe(true);

    tailTouched = false;
    const preview = previewPmo(largePmo, 400_000);
    expect(tailTouched).toBe(false);
    expect(preview.text).toHaveLength(400_000);
    expect(preview.truncated).toBe(true);
    expect(preview.length).toBeNull();
    expect(preview.text.startsWith("{\n")).toBe(true);

    // Exact first-piece boundary: peeks only far enough to know more text exists.
    const firstPiece = stringifyPmoChunks(largePmo, { ensureAscii: false }).next().value;
    if (typeof firstPiece !== "string") throw new Error("expected first piece");
    tailTouched = false;
    const atBoundary = previewPmo(largePmo, firstPiece.length);
    expect(tailTouched).toBe(false);
    expect(atBoundary.text).toBe(firstPiece);
    expect(atBoundary.truncated).toBe(true);
    expect(atBoundary.length).toBeNull();
  });
});

describe("oversized PMO exceeding V8 max string length", () => {
  it("exports as .json.gz and previews cleanly when JSON exceeds MAX_STRING_LENGTH", async () => {
    const base = buildExamplePmo();
    // Each entry serialises to ~16,030 bytes and counts as 2 nodes; 36,000 shared references
    // exceed MAX_STRING_LENGTH (~512 MiB) while keeping JS heap under 1 MiB.
    const seqLength = 16_000;
    const count = Math.ceil((bufferConstants.MAX_STRING_LENGTH + 20_000_000) / seqLength);
    const sharedMhap = { seq: "A".repeat(seqLength) };
    const oversizedPmo: PortableMicrohaplotypeObject = {
      ...base,
      representative_microhaplotypes: {
        targets: [
          { target_id: 0, microhaplotypes: Array.from({ length: count }, () => sharedMhap) },
        ],
      },
    };

    expect(() => stringifyPmo(oversizedPmo)).toThrow(PmoError);

    const preview = previewPmo(oversizedPmo, 400_000);
    expect(preview.text).toHaveLength(400_000);
    expect(preview.truncated).toBe(true);
    expect(preview.length).toBeNull();

    const plainSize = await measurePmoSize(oversizedPmo, { gzip: false });
    expect(plainSize).toBeGreaterThan(bufferConstants.MAX_STRING_LENGTH);

    const exported = await exportPmo(oversizedPmo, { gzip: true });
    expect(exported.fileName).toBe("Mad4hatter.pmo.json.gz");
    expect(exported.blob.type).toBe("application/gzip");
    expect(exported.blob.size).toBeGreaterThan(0);

    const header = new Uint8Array(await exported.blob.slice(0, 2).arrayBuffer());
    expect([header[0], header[1]]).toEqual([0x1f, 0x8b]);
  }, 30_000);
});
