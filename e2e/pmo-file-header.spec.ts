/**
 * End-to-end checks for the compact My PMO file header and single-row view
 * toolbar: first-screen data at laptop (1280x800) and phone (390x844) sizes,
 * Replace, Remove, the Original/Subset choice in the same bar, and the full
 * drop area when no file is open. Uses the privacy fixture so no external
 * origin is ever contacted.
 */
import { readFile } from "node:fs/promises";

import { expect, test } from "./fixtures/privacy";
import {
  expectNoHorizontalOverflow,
  openBuiltExample,
  requireVisibleBox,
  type Box,
} from "./support/pmoFile";
import { BUILD_TIMEOUT, downloadFrom } from "./support/review";

/** Asserts that two boxes share one horizontal row (at least half the shorter height overlaps). */
function expectSameRow(a: Box, b: Box, label: string): void {
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const minHeight = Math.min(a.height, b.height);
  expect(minHeight, `${label}: positive height`).toBeGreaterThan(0);
  expect(overlap, `${label}: vertical overlap on same row`).toBeGreaterThanOrEqual(minHeight * 0.5);
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

  await openBuiltExample({ page, tab: "summary" });

  // Full drop area is gone; compact bar holds file name, size, Replace and Remove on one row.
  await expect(
    page.getByRole("button", { name: /PMO: Drag a file here or choose a file/ }),
  ).toHaveCount(0);
  const bar = page.locator("main header").first();
  const title = bar.getByRole("heading", { level: 1, name: "Mad4hatter.pmo.json.gz" });
  const replaceButton = bar.getByRole("button", { name: "Replace this PMO file" });
  const removeButton = bar.getByRole("button", { name: "Remove this PMO file" });
  await expect(title).toBeVisible();
  await expect(replaceButton).toBeVisible();
  await expect(removeButton).toBeVisible();
  const titleBox = await requireVisibleBox(title, "header title");
  const removeBox = await requireVisibleBox(removeButton, "header remove button");
  expectSameRow(titleBox, removeBox, "header title and remove button");

  // Summary tab: first headline number is within the first screen, and toolbar is one row.
  await page.getByRole("tab", { name: "Summary" }).click();
  const firstStat = page.getByText("Samples with data", { exact: true }).first().locator("..");
  const firstStatBox = await requireVisibleBox(firstStat, "first headline stat");
  expect(firstStatBox.y + firstStatBox.height).toBeLessThanOrEqual(800);

  const minReadsInput = page.getByLabel("Minimum reads per microhaplotype");
  const showEmptyTargets = page.getByRole("switch", { name: "Show targets with no data" });
  const jumpsNav = page.getByRole("navigation", { name: "On this page" });
  const jumpButtons = jumpsNav.getByRole("button");
  const inputBox = await requireVisibleBox(minReadsInput, "min reads input");
  const toggleBox = await requireVisibleBox(showEmptyTargets, "show empty targets toggle");
  const firstJumpBox = await requireVisibleBox(jumpButtons.first(), "first jump button");
  const lastJumpBox = await requireVisibleBox(jumpButtons.last(), "last jump button");
  // Input, empty-targets toggle and every jump link share one horizontal row.
  expect(Math.abs(firstJumpBox.y - lastJumpBox.y)).toBeLessThanOrEqual(4);
  expectSameRow(inputBox, toggleBox, "min reads input and empty targets toggle");
  expectSameRow(inputBox, firstJumpBox, "min reads input and jump links");

  // Compare tab: group selector and min reads share one horizontal row at 1280px.
  await page.getByRole("tab", { name: "Compare" }).click();
  const groupSelectBox = await requireVisibleBox(
    page.getByRole("combobox", { name: "Group specimens by" }),
    "group selector",
  );
  const compareMinReadsBox = await requireVisibleBox(
    page.getByLabel("Minimum reads per microhaplotype"),
    "compare min reads input",
  );
  expectSameRow(groupSelectBox, compareMinReadsBox, "Compare group selector and min reads");

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
  const subsetStatBox = await requireVisibleBox(firstStat, "subset headline stat");
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
  const viewportHeight = 844;
  await page.setViewportSize({ width: 390, height: viewportHeight });
  await openBuiltExample({ page, tab: "summary" });

  // Summary: toolbar wraps cleanly without horizontal overflow, and headline tiles fit on screen.
  await page.getByRole("tab", { name: "Summary" }).click();
  const showEmptyTargets = page.getByRole("switch", { name: "Show targets with no data" });
  const toggleBox = await requireVisibleBox(showEmptyTargets, "show empty targets toggle");
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(390);
  await expectNoHorizontalOverflow(page, "Summary at 390px");

  const firstStat = page.getByText("Samples with data", { exact: true }).first().locator("..");
  const secondStat = page.getByText("Targets with data", { exact: true }).first().locator("..");
  const thirdStat = page
    .getByText("Median targets per sample", { exact: true })
    .first()
    .locator("..");
  const fourthStat = page
    .getByText("Samples with more than one clone", { exact: true })
    .first()
    .locator("..");
  const firstStatBox = await requireVisibleBox(firstStat, "first headline stat");
  const secondStatBox = await requireVisibleBox(secondStat, "second headline stat");
  const thirdStatBox = await requireVisibleBox(thirdStat, "third headline stat");
  const fourthStatBox = await requireVisibleBox(fourthStat, "fourth headline stat");
  expect(firstStatBox.y + firstStatBox.height).toBeLessThanOrEqual(viewportHeight);
  expect(Math.abs(firstStatBox.y - secondStatBox.y)).toBeLessThanOrEqual(4);
  expect(secondStatBox.x).toBeGreaterThan(firstStatBox.x);
  expect(secondStatBox.x + secondStatBox.width).toBeLessThanOrEqual(390);
  expect(Math.abs(thirdStatBox.y - fourthStatBox.y)).toBeLessThanOrEqual(4);
  expect(thirdStatBox.y).toBeGreaterThan(firstStatBox.y);
  expect(fourthStatBox.x + fourthStatBox.width).toBeLessThanOrEqual(390);

  // Choosing a headline tile moves to its section below the top bar and focuses the heading.
  await secondStat.click();
  const topBarBox = await requireVisibleBox(page.getByRole("banner"), "top bar");
  const topBarBottom = topBarBox.y + topBarBox.height;
  const targetsHeading = page.getByRole("heading", { level: 2, name: "Targets" });
  await expect
    .poll(async () => {
      const box = await targetsHeading.boundingBox();
      return box !== null && box.y >= topBarBottom && box.y < viewportHeight;
    })
    .toBe(true);
  const targetsHeadingBox = await requireVisibleBox(targetsHeading, "Targets heading");
  expect(targetsHeadingBox.y).toBeGreaterThanOrEqual(topBarBottom);
  expect(targetsHeadingBox.y).toBeLessThan(viewportHeight);
  await expect(targetsHeading).toBeFocused();

  await page.evaluate(() => window.scrollTo(0, 0));

  // Clicking a Summary jump link lands the heading below the sticky two-row top bar and focuses it.
  const jumpsNav = page.getByRole("navigation", { name: "On this page" });
  await jumpsNav.getByRole("button", { name: "Samples" }).click();
  const samplesHeading = page.getByRole("heading", { level: 2, name: "Samples" });
  await expect
    .poll(async () => {
      const box = await samplesHeading.boundingBox();
      return box !== null && box.y >= topBarBottom && box.y < viewportHeight;
    })
    .toBe(true);
  const samplesHeadingBox = await requireVisibleBox(samplesHeading, "Samples heading");
  expect(samplesHeadingBox.y).toBeGreaterThanOrEqual(topBarBottom);
  expect(samplesHeadingBox.y).toBeLessThan(viewportHeight);
  await expect(samplesHeading).toBeFocused();

  // Scroll back up so the tab strip is reachable before switching to Compare.
  await page.evaluate(() => window.scrollTo(0, 0));

  // Compare: at least the first row of the Groups table is within the first screen,
  // and the group selector fits inside the 390px viewport.
  await page.getByRole("tab", { name: "Compare" }).click();
  const groupSelect = page.getByRole("combobox", { name: "Group specimens by" });
  const selectBox = await requireVisibleBox(groupSelect, "group selector");
  expect(selectBox.x + selectBox.width).toBeLessThanOrEqual(390);

  const groupsTable = page.getByRole("table", { name: "Groups" });
  const firstRow = groupsTable.getByRole("row").nth(1);
  const firstRowBox = await requireVisibleBox(firstRow, "first Groups row");
  expect(firstRowBox.y + firstRowBox.height).toBeLessThanOrEqual(viewportHeight);
});
