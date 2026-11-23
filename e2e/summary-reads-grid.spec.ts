/**
 * Reads grid layout on the Summary tab: when a panel has more targets than
 * fit across the page, the grid scrolls sideways inside its own area while
 * keeping sample names visible and hover tooltips accurate.
 */
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { openBuiltExample, requireBox } from "./support/pmoFile";
import { BUILD_TIMEOUT } from "./support/review";

/** Last target in `public/examples/mad4hatter_panel_info_example.csv` (276 targets). */
const FIRST_TARGET = "Pf3D7_01_v3-145388-145662-1A";
const LAST_TARGET = "Pf3D7_14_v3-294503-294768-2";

async function openBuiltSummary(page: Page): Promise<void> {
  await openBuiltExample({ page, tab: "summary" });
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

  // With 276 targets, group names appear along the top instead of individual target buttons.
  await expect(region.getByText("Targets 1–50")).toBeVisible();
  await expect(region.getByRole("button", { name: FIRST_TARGET })).toHaveCount(0);

  // Sample names canvas and cells canvas are separate so labels stay sticky.
  const canvases = region.locator("canvas");
  await expect(canvases).toHaveCount(2);
  const labelsCanvas = canvases.nth(0);
  const cellsCanvas = canvases.nth(1);

  await region.scrollIntoViewIfNeeded();
  const [labelsBoxBefore, cellsBoxBefore] = await Promise.all([
    requireBox(labelsCanvas, "labels canvas before scroll"),
    requireBox(cellsCanvas, "cells canvas before scroll"),
  ]);

  // Hover the first target in row 0 before scrolling to capture row 0's sample name.
  await page.mouse.move(cellsBoxBefore.x + 1, cellsBoxBefore.y + 6);
  const firstTooltip = readsSection.getByRole("tooltip");
  await expect(firstTooltip.getByText(FIRST_TARGET, { exact: true })).toBeVisible();
  const row0Sample = await firstTooltip.locator("div").nth(0).innerText();
  expect(row0Sample).toMatch(/^example_sample_/);

  // Scroll the reads grid all the way to the right.
  const scrolledLeft = await region.evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth;
    return el.scrollLeft;
  });
  expect(scrolledLeft).toBeGreaterThan(0);

  // Sample names must stay visible at the left edge of the scroll region.
  const [regionBoxAfter, labelsBoxAfter, cellsBoxAfter] = await Promise.all([
    requireBox(region, "reads grid region after scroll"),
    requireBox(labelsCanvas, "labels canvas after scroll"),
    requireBox(cellsCanvas, "cells canvas after scroll"),
  ]);
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
  const tooltipCard = readsSection.getByRole("tooltip");
  await expect(tooltipCard.getByText(LAST_TARGET, { exact: true })).toBeVisible();
  await expect(tooltipCard).toContainText(row0Sample);

  // The tooltip stays within the 390 px viewport and the page still does not overflow.
  const tooltipBox = await requireBox(tooltipCard, "hover tooltip");
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

  // Target names appear along the top when columns are wide enough.
  await expect(region.getByRole("button", { name: FIRST_TARGET })).toBeVisible();

  const canvases = region.locator("canvas");
  await expect(canvases).toHaveCount(2);
  const cellsCanvas = canvases.nth(1);
  await region.scrollIntoViewIfNeeded();
  const cellsBox = await requireBox(cellsCanvas, "cells canvas");

  // Hover the first target in row 0.
  await page.mouse.move(cellsBox.x + 10, cellsBox.y + 6);
  await expect(
    readsSection.getByRole("tooltip").getByText(FIRST_TARGET, { exact: true }),
  ).toBeVisible();

  // Click the first target in row 0 and confirm details persist and both tables update.
  await page.mouse.click(cellsBox.x + 10, cellsBox.y + 6);
  await page.mouse.move(0, 0);
  const status = readsSection.getByRole("status");
  await expect(status).toContainText(FIRST_TARGET);
  await expect(status).toContainText(/microhaplotype/);
  await expect(
    page
      .getByRole("table", { name: "Targets" })
      .getByRole("button", { name: FIRST_TARGET, pressed: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Samples" }).locator('tbody tr[aria-current="true"]'),
  ).toHaveCount(1);
});

test.describe("touch at 390 px", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("tapping a reads-grid cell shows its sample, target, reads and microhaplotype count in the details strip", async ({
    page,
  }) => {
    await openBuiltSummary(page);

    const readsSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Reads by sample and target" }) })
      .first();
    const region = page.getByRole("region", { name: "Reads by sample and target" });
    await expect(region).toBeVisible();
    await region.scrollIntoViewIfNeeded();

    const cellsCanvas = region.locator("canvas").nth(1);
    const cellsBox = await requireBox(cellsCanvas, "cells canvas at 390 px");

    await page.touchscreen.tap(cellsBox.x + 6, cellsBox.y + 6);

    const status = readsSection.getByRole("status");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/example_sample_/);
    await expect(status).toContainText(FIRST_TARGET);
    await expect(status).toContainText(/read|no reads/i);
    await expect(status).toContainText(/microhaplotype/);

    // No floating hover tooltip stays stuck over the grid after a touch tap.
    await expect(readsSection.getByRole("tooltip")).toHaveCount(0);

    // Selecting the cell still updates the Targets and Samples tables below.
    await expect(
      page
        .getByRole("table", { name: "Targets" })
        .getByRole("button", { name: FIRST_TARGET, pressed: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Samples" }).locator('tbody tr[aria-current="true"]'),
    ).toHaveCount(1);

    const pageOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.innerWidth);
  });
});
