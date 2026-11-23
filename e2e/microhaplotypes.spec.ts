/**
 * The microhaplotypes step against the production build: the example data,
 * column matching, the result, and the draft surviving a reload. The privacy
 * fixture fails each test on any request to another origin or CSP violation.
 */
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { expect, test } from "./fixtures/privacy";

const TEMPLATE = fileURLToPath(
  new URL("../public/examples/PMO_building_template.xlsx", import.meta.url),
);

/** The Excel reader's chunk (read-excel-file). */
function isExcelChunk(name: string): boolean {
  return /universal-[\w-]+\.js$/.test(name);
}

test("loads the example, breaks and mends a match, and keeps the draft over a reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try with example data" }).click();
  await expect(page).toHaveURL(/#\/build\/microhaplotypes$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Microhaplotypes" })).toBeVisible();

  const result = page.getByRole("region", { name: "Result" });
  await expect(page.getByText("4 of 4 required fields matched")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Reads" })).toHaveValue("Reads");
  await expect(result.getByText("Ready", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Break it: the reads are no longer in the table.
  const reads = page.getByRole("combobox", { name: "Reads" });
  await reads.click();
  await page.getByRole("option", { name: "Not in this table" }).click();
  await expect(
    page.getByText("Choose a column. This field is needed to build the table."),
  ).toBeVisible();
  await expect(page.getByText("3 of 4 required fields matched")).toBeVisible();
  await expect(result.getByText("Incomplete", { exact: true })).toBeVisible();

  // Mend it from the keyboard.
  await reads.click();
  await reads.fill("Reads");
  await reads.press("Enter");
  await expect(reads).toHaveValue("Reads");
  await expect(result.getByText("Ready", { exact: true })).toBeVisible();

  // Let the debounced save land, then reload: the draft and its file come back from IndexedDB.
  await expect(page.getByRole("button", { name: "Draft saved" })).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.getByText("mad4hatter_allele_data_example.csv")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("combobox", { name: "Reads" })).toHaveValue("Reads");
  await expect(
    page.getByRole("region", { name: "Result" }).getByText("Ready", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const databases = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name ?? ""),
  );
  expect(databases.some((name) => name.startsWith("pmo-builder"))).toBe(true);
});

test("runs the engine in a worker that reads Excel workbooks", async ({ page }) => {
  await page.goto("/#/build/microhaplotypes");
  await expect(page.getByRole("heading", { level: 1, name: "Microhaplotypes" })).toBeVisible();
  await expect.poll(() => page.workers().length).toBeGreaterThan(0);
  const worker = page.workers().find((candidate) => candidate.url().includes("engine.worker"));
  expect(worker, "the engine worker").toBeDefined();
  expect(await worker?.evaluate(() => typeof document)).toBe("undefined");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Drag a file here/ }).click();
  await (await chooser).setFiles(TEMPLATE);
  await expect(page.getByRole("heading", { name: "Match columns" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("PMO_building_template.xlsx", { exact: true })).toBeVisible();
  // The template has several sheets. Its second sheet has headers only, and the worker says so.
  const sheet = page.getByRole("combobox", { name: "Sheet" });
  await expect(sheet).toHaveText("Overview");
  await sheet.click();
  await page.getByRole("option").nth(1).click();
  await expect(page.getByRole("alert")).toContainText("has a header row but no rows of data");
  await expect(sheet).toHaveText("Overview");

  // The Excel reader is a separate chunk, fetched by the worker, not the page.
  const workerScripts = await worker?.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
  const pageScripts = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
  expect(workerScripts?.some(isExcelChunk)).toBe(true);
  expect(pageScripts.some(isExcelChunk)).toBe(false);
});

test("streams a gzipped allele table, rebuilds after remapping, and restores from IndexedDB", async ({
  page,
}) => {
  // Build a >2,000-row gzipped allele table so the streaming import stops at the preview scan.
  const lines = ["SampleID,Target,Seq,Reads,RunName"];
  for (let i = 0; i < 2_200; i += 1) {
    lines.push(
      `S${Math.floor(i / 22)},T${i % 22},ACGT${String(i % 10).padStart(2, "0")},${10 + (i % 50)},run_${i % 2}`,
    );
  }
  const gzipped = gzipSync(Buffer.from(`${lines.join("\n")}\n`, "utf8"));

  await page.goto("/#/build/microhaplotypes");
  await expect(page.getByRole("heading", { level: 1, name: "Microhaplotypes" })).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Drag a file here/ }).click();
  await (
    await chooser
  ).setFiles({
    name: "streamed_alleles.csv.gz",
    mimeType: "application/gzip",
    buffer: gzipped,
  });

  await expect(page.getByRole("heading", { name: "Match columns" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("streamed_alleles.csv.gz", { exact: true })).toBeVisible();
  await expect(page.getByText("4 of 4 required fields matched")).toBeVisible();
  await expect(page.getByRole("button", { name: /Preview/ })).toBeVisible();

  const result = page.getByRole("region", { name: "Result" });
  await expect(result.getByText("Ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(result.getByText("2,200")).toBeVisible();

  // Change the bioinformatics run name to use the RunName column and confirm streaming rebuild.
  await page.getByRole("radio", { name: /From a column/i }).click();
  const runColumn = page.getByRole("combobox", { name: /Run name column/i });
  await runColumn.click();
  await page.getByRole("option", { name: "RunName" }).click();
  await expect(result.getByText("Ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(result.getByText("2 runs")).toBeVisible();

  // Change a column mapping (unmap Reads -> Incomplete, remap Reads -> Ready).
  const reads = page.getByRole("combobox", { name: "Reads" });
  await reads.click();
  await page.getByRole("option", { name: "Not in this table" }).click();
  await expect(result.getByText("Incomplete", { exact: true })).toBeVisible({ timeout: 30_000 });
  await reads.click();
  await reads.fill("Reads");
  await reads.press("Enter");
  await expect(result.getByText("Ready", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Wait for save, reload, and verify the streamed gzipped draft restores cleanly from IndexedDB.
  await expect(page.getByRole("button", { name: "Draft saved" })).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.getByText("streamed_alleles.csv.gz", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("region", { name: "Result" }).getByText("Ready", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Result" }).getByText("2,200")).toBeVisible();
});
