/**
 * Helpers for the review step's end-to-end tests: loading the example,
 * opening a step from the sidebar, reading the summary numbers, and
 * downloading and checking the PMO file.
 */
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import type { Download, Locator, Page } from "@playwright/test";
import { checkPmoIntegrity, validatePmo } from "pmotools-ts";

import { expect } from "../fixtures/privacy";

export { formatBytes } from "../../src/ui/format";

/** The merge summary numbers as the review page labels them. */
export const STAT_LABELS = [
  "Specimens",
  "Library samples",
  "With alleles found",
  "With read counts",
  "Panels",
  "Targets",
  "Targets with alleles",
  "Genomes",
  "Projects",
  "Sequencing runs",
  "Bioinformatics runs",
] as const;

/** One of {@link STAT_LABELS}. */
export type StatLabel = (typeof STAT_LABELS)[number];

/** Generous wait for imports and builds in the worker. */
export const BUILD_TIMEOUT = 30_000;

/** Loads the example from the home page and waits until the microhaplotypes step shows it built. */
export async function loadExample(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Try with example data" }).click();
  await expect(page).toHaveURL(/#\/build\/microhaplotypes$/, { timeout: BUILD_TIMEOUT });
  await expect(
    page.getByRole("region", { name: "Result" }).getByText("Ready", { exact: true }),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });
}

/** Routes of the steps the tests open. */
const STEP_PATHS: Readonly<Record<string, string>> = {
  Microhaplotypes: "#/build/microhaplotypes",
  Panel: "#/build/panel",
  "Review and download": "#/build/review",
};

/**
 * Opens a step from the sidebar, as a user would, without reloading the
 * page. At phone width, where the sidebar is folded away, it changes the
 * route in place instead.
 */
export async function openStep(page: Page, title: string): Promise<void> {
  const link = page.getByRole("navigation", { name: "Steps" }).getByRole("link", { name: title });
  if (await link.isVisible()) await link.click();
  else {
    await page.evaluate((hash) => {
      globalThis.location.hash = hash;
    }, STEP_PATHS[title] ?? "#/");
  }
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/** The verdict card. */
export function verdictCard(page: Page): Locator {
  return page.getByRole("region", { name: /^(Ready|Not ready|Checking)/ });
}

/** Reads every summary number shown under "What is in the PMO". */
export async function readStats(page: Page): Promise<Readonly<Record<string, number>>> {
  const contents = page.getByRole("region", { name: "What is in the PMO" });
  await expect(contents.locator("[data-stat]")).toHaveCount(STAT_LABELS.length);
  const entries = await Promise.all(
    STAT_LABELS.map(async (label) => {
      const value = await contents
        .locator(`[data-stat="${label}"]`)
        .locator("span")
        .nth(1)
        .innerText();
      return [label, Number(value.replaceAll(",", ""))] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** What the test found in a downloaded PMO. */
export interface CheckedPmo {
  readonly fileName: string;
  readonly bytes: number;
  readonly stats: Record<StatLabel, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(pmo: Record<string, unknown>, key: string): unknown[] {
  const value = pmo[key];
  return Array.isArray(value) ? value : [];
}

function numberField(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "number" ? field : null;
}

/** Counts a parsed PMO the way the page's merge summary does. */
function countPmo(pmo: Record<string, unknown>): Record<StatLabel, number> {
  const representative = isRecord(pmo["representative_microhaplotypes"])
    ? list(pmo["representative_microhaplotypes"], "targets")
    : [];
  const detected = new Set<number>();
  const called = new Set<number>();
  for (const run of list(pmo, "detected_microhaplotypes")) {
    if (!isRecord(run)) continue;
    for (const sample of list(run, "library_samples")) {
      if (!isRecord(sample)) continue;
      const id = numberField(sample, "library_sample_id");
      if (id !== null) detected.add(id);
      for (const result of list(sample, "target_results")) {
        const index = numberField(result, "mhaps_target_id");
        const target = numberField(index === null ? null : representative[index], "target_id");
        if (target !== null) called.add(target);
      }
    }
  }
  const counted = new Set<number>();
  for (const run of list(pmo, "read_counts_by_stage")) {
    if (!isRecord(run)) continue;
    for (const sample of list(run, "read_counts_by_library_sample_by_stage")) {
      const id = numberField(sample, "library_sample_id");
      if (id !== null) counted.add(id);
    }
  }
  return {
    Specimens: list(pmo, "specimen_info").length,
    "Library samples": list(pmo, "library_sample_info").length,
    "With alleles found": detected.size,
    "With read counts": counted.size,
    Panels: list(pmo, "panel_info").length,
    Targets: list(pmo, "target_info").length,
    "Targets with alleles": called.size,
    Genomes: list(pmo, "targeted_genomes").length,
    Projects: list(pmo, "project_info").length,
    "Sequencing runs": list(pmo, "sequencing_info").length,
    "Bioinformatics runs": list(pmo, "bioinformatics_run_info").length,
  };
}

/**
 * Reads a downloaded PMO, gunzipping it when `gzip`, parses it, and checks
 * it with `validatePmo` and `checkPmoIntegrity` from pmotools-ts.
 */
export async function checkDownload(download: Download, gzip: boolean): Promise<CheckedPmo> {
  const raw = await readFile(await download.path());
  // A gzip file starts with 0x1f 0x8b.
  expect(raw[0] === 0x1f && raw[1] === 0x8b, "gzip magic bytes").toBe(gzip);
  const text = (gzip ? gunzipSync(raw) : raw).toString("utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("The PMO is not a JSON object");
  const validation = validatePmo(parsed);
  if (!validation.valid) {
    throw new Error(`The PMO fails the schema: ${JSON.stringify(validation.errors.slice(0, 3))}`);
  }
  const errors = checkPmoIntegrity(validation.pmo).filter((issue) => issue.severity === "error");
  expect(errors).toEqual([]);
  return { fileName: download.suggestedFilename(), bytes: raw.length, stats: countPmo(parsed) };
}

/** Clicks a download button and waits for the browser's download. */
export async function downloadFrom(page: Page, button: Locator): Promise<Download> {
  const download = page.waitForEvent("download");
  await button.click();
  return download;
}
