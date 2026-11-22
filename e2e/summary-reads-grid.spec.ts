/**
 * Reads grid layout on the Summary tab: when a panel has more targets than
 * fit across the page, the grid scrolls sideways inside its own area while
 * keeping sample names visible and hover tooltips accurate.
 */
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT, loadExample } from "./support/review";

/** Last target in `public/examples/mad4hatter_panel_info_example.csv` (276 targets). */
const FIRST_TARGET = "Pf3D7_01_v3-145388-145662-1A";
const LAST_TARGET = "Pf3D7_14_v3-294503-294768-2";

async function openBuiltSummary(page: Page): Promise<void> {
  await loadExample(page);
  await page.evaluate(() => {
    globalThis.location.hash = "/pmo/open-built";
  });
  await expect(page.getByText("This is the PMO built from your draft")).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  await page.getByRole("tab", { name: "Summary" }).click();
  await expect(page.getByRole("heading", { name: "Reads by sample and target" })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
}

test("at 390 px with all 276 targets, the reads grid scrolls sideways to the last target while keeping sample names visible and hover accurate", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBuiltSummary(page);

  await page.getByRole("switch", { name: "Show targets with no data" }).click();

  const readsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Reads by sample and target" }) })
    .first();
  const region = page.getByRole("region", { name: "Reads by sample and target" });
  await expect(region).toBeVisible();

  // The page itself must not scroll sideways.
  const pageOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.innerWidth);

  // The grid must scroll sideways inside its own area.
  const metrics = await region.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

  // Sample names canvas and cells canvas are separate so labels stay sticky.
  const canvases = region.locator("canvas");
  await expect(canvases).toHaveCount(2);
  const labelsCanvas = canvases.nth(0);
  const cellsCanvas = canvases.nth(1);

  await region.scrollIntoViewIfNeeded();
  const regionBoxBefore = await region.boundingBox();
  const labelsBoxBefore = await labelsCanvas.boundingBox();
  const cellsBoxBefore = await cellsCanvas.boundingBox();
  if (regionBoxBefore === null || labelsBoxBefore === null || cellsBoxBefore === null) {
    throw new Error("Expected reads grid region and canvases to have bounding boxes");
  }

  // Hover the first target in row 0 before scrolling to capture row 0's sample name.
  await page.mouse.move(cellsBoxBefore.x + 1, cellsBoxBefore.y + 6);
  const firstTargetTooltip = readsSection.getByText(FIRST_TARGET, { exact: true });
  await expect(firstTargetTooltip).toBeVisible();
  const row0Sample = await firstTargetTooltip.locator("..").locator("div").nth(0).innerText();
  expect(row0Sample).toMatch(/^example_sample_/);

  // Scroll the reads grid all the way to the right.
  const scrolledLeft = await region.evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth;
    return el.scrollLeft;
  });
  expect(scrolledLeft).toBeGreaterThan(0);

  // Sample names must stay visible at the left edge of the scroll region.
  const regionBoxAfter = await region.boundingBox();
  const labelsBoxAfter = await labelsCanvas.boundingBox();
  const cellsBoxAfter = await cellsCanvas.boundingBox();
  if (regionBoxAfter === null || labelsBoxAfter === null || cellsBoxAfter === null) {
    throw new Error("Expected reads grid region and canvases to have bounding boxes after scroll");
  }
  expect(Math.abs(labelsBoxAfter.x - regionBoxAfter.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(labelsBoxAfter.x - labelsBoxBefore.x)).toBeLessThanOrEqual(1);
  expect(labelsBoxAfter.width).toBeGreaterThan(0);

  // The right edge of the cells canvas (last target) must now be inside the scroll region.
  const cellsRight = cellsBoxAfter.x + cellsBoxAfter.width;
  const regionRight = regionBoxAfter.x + regionBoxAfter.width;
  expect(cellsRight).toBeLessThanOrEqual(regionRight + 1);
  expect(cellsRight).toBeGreaterThan(labelsBoxAfter.x + labelsBoxAfter.width);

  // Hover the last target column in row 0 after scrolling.
  await page.mouse.move(cellsRight - 1, cellsBoxAfter.y + 6);
  const lastTargetTooltip = readsSection.getByText(LAST_TARGET, { exact: true });
  await expect(lastTargetTooltip).toBeVisible();
  const tooltipCard = lastTargetTooltip.locator("..");
  await expect(tooltipCard).toContainText(row0Sample);

  // The tooltip stays within the 390 px viewport and the page still does not overflow.
  const tooltipBox = await tooltipCard.boundingBox();
  if (tooltipBox === null) throw new Error("Expected hover tooltip to have a bounding box");
  expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(390);

  const pageOverflowAfter = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(pageOverflowAfter.scrollWidth).toBeLessThanOrEqual(pageOverflowAfter.innerWidth);
});

test("at 1280 px with the default 21 targets, the reads grid fits without sideways scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBuiltSummary(page);

  const readsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Reads by sample and target" }) })
    .first();
  const region = page.getByRole("region", { name: "Reads by sample and target" });
  await expect(region).toBeVisible();

  const metrics = await region.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);

  const pageOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.innerWidth);

  const canvases = region.locator("canvas");
  await expect(canvases).toHaveCount(2);
  const cellsCanvas = canvases.nth(1);
  await region.scrollIntoViewIfNeeded();
  const cellsBox = await cellsCanvas.boundingBox();
  if (cellsBox === null) throw new Error("Expected cells canvas to have a bounding box");

  // Hover the first target in row 0.
  await page.mouse.move(cellsBox.x + 10, cellsBox.y + 6);
  await expect(readsSection.getByText(FIRST_TARGET, { exact: true })).toBeVisible();
});
