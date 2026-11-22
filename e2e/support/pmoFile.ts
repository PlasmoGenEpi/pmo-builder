/**
 * Shared helpers for My PMO file end-to-end tests: opening the built example
 * or a synthetic PMO JSON on a chosen tab, and measuring layout geometry.
 */
import type { Locator, Page } from "@playwright/test";

import { expect } from "../fixtures/privacy";

import { BUILD_TIMEOUT, loadExample } from "./review";

/** A bounding box in viewport CSS pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Reads a locator's bounding box, failing clearly if it is absent. */
export async function requireBox(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${label} bounding box`).not.toBeNull();
  if (box === null) throw new Error(`Missing bounding box for ${label}`);
  return box;
}

/** Shortest Euclidean distance in pixels between two axis-aligned boxes. */
export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

/** Asserts that `box` lies completely inside the current viewport. */
export function expectInsideViewport(
  box: Box,
  viewport: { readonly width: number; readonly height: number },
): void {
  expect(box.x, "left inside viewport").toBeGreaterThanOrEqual(0);
  expect(box.y, "top inside viewport").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "right inside viewport").toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, "bottom inside viewport").toBeLessThanOrEqual(viewport.height);
}

/** Tabs on My PMO file that E2E specs open. */
export type PmoFileTab = "overview" | "summary" | "compare";

const TAB_LABELS: Readonly<Record<"en" | "fr", Readonly<Record<PmoFileTab, string>>>> = {
  en: { overview: "Overview", summary: "Summary", compare: "Compare" },
  fr: { overview: "Aperçu", summary: "Résumé", compare: "Comparer" },
};

/** Options for {@link openBuiltExample}. */
export interface OpenBuiltExampleOptions {
  readonly page: Page;
  /** Interface language to load. Default: `"en"`. */
  readonly lang?: "en" | "fr";
  /** Tab to select after opening the built PMO. Default: `"overview"`. */
  readonly tab?: PmoFileTab;
}

/** Loads the example draft, opens the built PMO in My PMO file, and optionally switches tab. */
export async function openBuiltExample(options: OpenBuiltExampleOptions): Promise<void> {
  const { page, lang = "en", tab = "overview" } = options;
  if (lang === "en") {
    await loadExample(page);
    await page.evaluate(() => {
      globalThis.location.hash = "/pmo/open-built";
    });
  } else {
    await page.goto("/?lang=fr");
    await page.getByRole("button", { name: "Essayer avec des données d’exemple" }).click();
    await expect(page).toHaveURL(/#\/build\/microhaplotypes$/, { timeout: BUILD_TIMEOUT });
    await expect(page.getByRole("region", { name: "Résultat" }).getByText(/^Prête?$/)).toBeVisible({
      timeout: BUILD_TIMEOUT,
    });
    await page.evaluate(() => {
      globalThis.location.hash = "/pmo/open-built";
    });
  }
  // The built PMO opens on its Summary tab.
  const summary = page.getByRole("tab", { name: TAB_LABELS[lang].summary });
  await expect(summary).toBeVisible({ timeout: BUILD_TIMEOUT });
  if (tab !== "summary") {
    await page.getByRole("tab", { name: TAB_LABELS[lang][tab] }).click();
  }
}

/** Options for {@link openSyntheticPmo}. */
export interface OpenSyntheticPmoOptions {
  readonly page: Page;
  readonly fileName: string;
  readonly pmo: Record<string, unknown>;
  /** Tab to select after opening the file. Default: `"overview"`. */
  readonly tab?: PmoFileTab;
}

/** Uploads a synthetic PMO JSON on My PMO file and optionally switches tab. */
export async function openSyntheticPmo(options: OpenSyntheticPmoOptions): Promise<void> {
  const { page, fileName, pmo, tab = "overview" } = options;
  await page.goto("/#/pmo");
  await page.getByLabel("Choose pmo file").setInputFiles({
    name: fileName,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pmo)),
  });
  await expect(page.getByText("This file is a valid PMO")).toBeVisible({ timeout: BUILD_TIMEOUT });
  if (tab !== "overview") {
    await page.getByRole("tab", { name: TAB_LABELS.en[tab] }).click();
  }
}
