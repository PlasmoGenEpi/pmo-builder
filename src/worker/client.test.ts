import { describe, expect, it } from "vitest";

import { exampleBlob } from "@/domain/build/testing";
import { createEmptyDraft } from "@/domain/draft";

import { createEngine, createLazyInThreadEngine } from "./client";

describe("the in-thread fallback", () => {
  it("is what createEngine gives where there is no Worker, and loads the engine on first use", async () => {
    expect(typeof Worker).toBe("undefined");
    const engine = createEngine();
    const outcome = await engine.importFile({
      file: exampleBlob("example_raw_reads.txt"),
      fileName: "example_raw_reads.txt",
    });
    expect(outcome).toMatchObject({
      kind: "imported",
      table: { columns: ["sample", "raw_count"] },
    });
    const built = await engine.build(createEmptyDraft(), { creationDate: "2026-01-01" });
    expect(built).toMatchObject({ kind: "built", view: { overall: { status: "empty" } } });
    await engine.dispose();
  });

  it("disposes without loading the engine when it was never used", async () => {
    await expect(createLazyInThreadEngine().dispose()).resolves.toBeUndefined();
  });
});
