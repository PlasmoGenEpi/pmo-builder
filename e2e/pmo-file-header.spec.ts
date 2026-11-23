/**
 * End-to-end checks for the compact My PMO file header and single-row view
 * toolbar: first-screen data at laptop (1280x800) and phone (390x844) sizes,
 * Replace, Remove, the Original/Subset choice in the same bar, and the full
 * drop area when no file is open. Uses the privacy fixture so no external
 * origin is ever contacted.
 */
import { readFile } from "node:fs/promises";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT, downloadFrom, loadExample } from "./support/review";

/** Loads the example draft and opens its built PMO in My PMO file. */
async function openExamplePmo(page: Page): Promise<void> {
  await loadExample(page);
  await page.evaluate(() => {
    globalThis.location.hash = "/pmo/open-built";
  });
  await expect(page.getByRole("tab", { name: "Summary" })).toBeVisible({ timeout: BUILD_TIMEOUT });
}

/** Bounding box of a visible element, failing clearly if missing. */
async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: BUILD_TIMEOUT });
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error("Element has no bounding box");
  return box;
}

test("at 1280x800 the Summary headline is on the first screen, toolbar is one row, and controls work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  // No file open: full drop area shows.
  await page.goto("/#/pmo");
  await expect(
    page.getByRole("button", { name: /PMO: Drag a file here or choose a file/ }),
  ).toBeVisible();

  await openExamplePmo(page);

  // Full drop area is gone; compact bar holds file name, size, Replace and Remove on one row.
  await expect(
    page.getByRole("button", { name: /PMO: Drag a file here or choose a file/ }),
  ).toHaveCount(0);
  const bar = page.locator("main header").first();
  const title = bar.getByRole("heading", { level: 1, name: "Mad4hatter.pmo.json.gz" });
  const replaceButton = bar.getByRole("button", { name: "Replace pmo file" });
  const removeButton = bar.getByRole("button", { name: "Remove pmo file" });
  await expect(title).toBeVisible();
  await expect(replaceButton).toBeVisible();
  await expect(removeButton).toBeVisible();
  const titleBox = await boxOf(title);
  const removeBox = await boxOf(removeButton);
  expect(Math.max(titleBox.y, removeBox.y)).toBeLessThan(
    Math.min(titleBox.y + titleBox.height, removeBox.y + removeBox.height),
  );

  // Summary tab: first headline number is within the first screen, and toolbar is one row.
  await page.getByRole("tab", { name: "Summary" }).click();
  const firstStat = page.getByText("Samples with data", { exact: true }).first().locator("..");
  const firstStatBox = await boxOf(firstStat);
  expect(firstStatBox.y + firstStatBox.height).toBeLessThanOrEqual(800);

  const minReadsInput = page.getByLabel("Minimum reads per microhaplotype");
  const jumpsNav = page.getByRole("navigation", { name: "On this page" });
  const jumpButtons = jumpsNav.getByRole("button");
  const inputBox = await boxOf(minReadsInput);
  const firstJumpBox = await boxOf(jumpButtons.first());
  const lastJumpBox = await boxOf(jumpButtons.last());
  // Input and every jump link share one horizontal row.
  expect(Math.abs(firstJumpBox.y - lastJumpBox.y)).toBeLessThanOrEqual(4);
  expect(Math.max(inputBox.y, firstJumpBox.y)).toBeLessThan(
    Math.min(inputBox.y + inputBox.height, firstJumpBox.y + firstJumpBox.height),
  );

  // Compare tab: group selector and min reads share one horizontal row at 1280px.
  await page.getByRole("tab", { name: "Compare" }).click();
  const groupSelectBox = await boxOf(page.getByRole("combobox", { name: "Group specimens by" }));
  const compareMinReadsBox = await boxOf(page.getByLabel("Minimum reads per microhaplotype"));
  expect(Math.max(groupSelectBox.y, compareMinReadsBox.y)).toBeLessThan(
    Math.min(
      groupSelectBox.y + groupSelectBox.height,
      compareMinReadsBox.y + compareMinReadsBox.height,
    ),
  );

  // Make a subset and confirm Original / Subset sits inside the same compact bar.
  await page.getByRole("tab", { name: "Subset" }).click();
  await page.getByLabel(/Minimum reads per microhaplotype/).fill("100");
  const makeButton = page.getByRole("button", { name: "Make the subset" });
  await expect(makeButton).toBeEnabled({ timeout: BUILD_TIMEOUT });
  await makeButton.click();
  await expect(page.getByText("The subset is ready")).toBeVisible({ timeout: BUILD_TIMEOUT });

  const sourceSwitch = bar.getByRole("radiogroup", { name: "Work with" });
  await expect(sourceSwitch).toBeVisible();
  await expect(sourceSwitch.getByRole("radio", { name: "Subset" })).toBeChecked();

  // Switch back to Summary: headline still fits on the first screen with the switch visible.
  await page.getByRole("tab", { name: "Summary" }).click();
  const subsetStatBox = await boxOf(firstStat);
  expect(subsetStatBox.y + subsetStatBox.height).toBeLessThanOrEqual(800);

  // Switching Original / Subset updates the Summary count.
  const subsetText = await firstStat.innerText();
  await sourceSwitch.getByRole("radio", { name: "Original" }).click();
  await expect(sourceSwitch.getByRole("radio", { name: "Original" })).toBeChecked();
  await expect(firstStat).not.toHaveText(subsetText, { timeout: BUILD_TIMEOUT });

  // Save a copy of the built PMO from Overview so Replace can load a real file.
  await page.getByRole("tab", { name: "Overview" }).click();
  const download = await downloadFrom(page, page.getByRole("button", { name: "Download" }));
  const savedBytes = await readFile(await download.path());

  // Replace via the Replace button's file chooser replaces the working PMO.
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), replaceButton.click()]);
  await chooser.setFiles({
    name: "replacement.pmo.json.gz",
    mimeType: "application/gzip",
    buffer: savedBytes,
  });
  await expect(bar.getByRole("heading", { level: 1, name: "replacement.pmo.json.gz" })).toBeVisible(
    { timeout: BUILD_TIMEOUT },
  );
  await expect(sourceSwitch).toHaveCount(0);

  // Remove closes the file and restores the full drop area.
  await removeButton.click();
  await expect(
    page.getByRole("button", { name: /PMO: Drag a file here or choose a file/ }),
  ).toBeVisible();
});

test("at 390x844 visible data appears on the first screen of Summary and Compare", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openExamplePmo(page);

  // Summary: first headline stat fits within the first screen.
  await page.getByRole("tab", { name: "Summary" }).click();
  const firstStat = page.getByText("Samples with data", { exact: true }).first().locator("..");
  const firstStatBox = await boxOf(firstStat);
  expect(firstStatBox.y + firstStatBox.height).toBeLessThanOrEqual(844);

  // Clicking a Summary jump link lands the heading below the sticky two-row top bar.
  const jumpsNav = page.getByRole("navigation", { name: "On this page" });
  await jumpsNav.getByRole("button", { name: "Samples" }).click();
  const topBarBox = await boxOf(page.getByRole("banner"));
  const samplesHeadingBox = await boxOf(page.getByRole("heading", { level: 2, name: "Samples" }));
  expect(samplesHeadingBox.y).toBeGreaterThanOrEqual(topBarBox.y + topBarBox.height - 0.5);

  // Scroll back up so the tab strip is reachable before switching to Compare.
  await page.evaluate(() => window.scrollTo(0, 0));

  // Compare: at least the first row of the Groups table is within the first screen,
  // and the group selector fits inside the 390px viewport.
  await page.getByRole("tab", { name: "Compare" }).click();
  const groupSelect = page.getByRole("combobox", { name: "Group specimens by" });
  const selectBox = await boxOf(groupSelect);
  expect(selectBox.x + selectBox.width).toBeLessThanOrEqual(390);

  const groupsTable = page.getByRole("table", { name: "Groups" });
  const firstRow = groupsTable.getByRole("row").nth(1);
  const firstRowBox = await boxOf(firstRow);
  expect(firstRowBox.y + firstRowBox.height).toBeLessThanOrEqual(844);
});
