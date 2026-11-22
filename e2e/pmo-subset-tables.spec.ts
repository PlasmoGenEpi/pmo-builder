/**
 * Spec 6 (#53) end-to-end tests against the production build:
 * - Subset tab names fields in plain words and filters specimens by collection year
 * - Tables tab lists Read counts by stage on the example PMO
 * - Tables preview opens and closes from the keyboard with the first 20 rows and count line,
 *   follows the original/subset switch, and scrolls horizontally inside its own box without
 *   overflowing the viewport at desktop (1280px) or mobile (390px).
 */
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT, loadExample } from "./support/review";

/** Builds the example draft and opens the resulting PMO on My PMO file. */
async function openExamplePmo(page: Page): Promise<void> {
  await loadExample(page);
  await page.evaluate(() => {
    globalThis.location.hash = "/pmo/open-built";
  });
  // The built PMO opens on its Summary tab.
  await expect(page.getByRole("tab", { name: "Summary" })).toBeVisible({ timeout: BUILD_TIMEOUT });
}

test("previews tables by keyboard with 20 rows and count line, and lists read counts by stage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openExamplePmo(page);

  await page.getByRole("tab", { name: "Tables" }).click();

  // Read counts by stage is listed on the example PMO with 8 rows and previews cleanly.
  const readCountsItem = page.getByRole("listitem").filter({ hasText: "Read counts by stage" });
  const readCountsButton = readCountsItem.getByRole("button", {
    name: "Preview Read counts by stage",
  });
  await expect(readCountsButton).toBeVisible();
  await expect(readCountsItem).toContainText("8 rows");

  await readCountsButton.click();
  const readCountsRegion = page.getByRole("region", { name: "Preview of Read counts by stage" });
  await expect(readCountsRegion).toBeVisible();
  await expect(readCountsRegion.getByRole("table").getByRole("row")).toHaveCount(9);
  await expect(readCountsItem.getByText("Showing 8 of 8 rows")).toBeVisible();

  // Open and close the Allele table preview from the keyboard.
  const alleleItem = page.getByRole("listitem").filter({ hasText: "Allele table" });
  const alleleToggle = alleleItem.getByRole("button", { name: "Preview Allele table" });
  await expect(alleleToggle).toHaveAttribute("aria-expanded", "false");
  await alleleToggle.focus();
  await page.keyboard.press("Enter");

  const hideAlleleToggle = alleleItem.getByRole("button", { name: "Hide preview of Allele table" });
  await expect(hideAlleleToggle).toHaveAttribute("aria-expanded", "true");
  const alleleRegion = page.getByRole("region", { name: "Preview of Allele table" });
  await expect(alleleRegion).toBeVisible();
  await expect(alleleRegion).toHaveAttribute("tabindex", "0");

  const alleleTable = alleleRegion.getByRole("table");
  await expect(alleleTable.getByRole("row")).toHaveCount(21);
  await Promise.all(
    ["library_sample_name", "target_name", "seq", "reads"].map((column) =>
      expect(alleleTable.getByRole("columnheader", { name: column })).toBeVisible(),
    ),
  );
  await expect(alleleItem.getByText(/^Showing 20 of [\d,]+ rows$/)).toBeVisible();

  // Close from the keyboard with Space.
  await hideAlleleToggle.focus();
  await page.keyboard.press("Space");
  await expect(alleleRegion).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview Allele table" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`keeps preview horizontal scroll inside its box at ${viewport.name} (${viewport.width}px) without document overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openExamplePmo(page);

    await page.getByRole("tab", { name: "Tables" }).click();
    // Targets has many wide columns (primers, coordinates, sequences) so it overflows horizontally on both desktop and mobile.
    await page.getByRole("button", { name: "Preview Targets" }).click();

    const previewRegion = page.getByRole("region", { name: "Preview of Targets" });
    await expect(previewRegion).toBeVisible();
    await expect(previewRegion.getByRole("table").getByRole("row")).toHaveCount(21);

    const metrics = await previewRegion.evaluate((element) => {
      element.scrollLeft = 80;
      const rect = element.getBoundingClientRect();
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollLeft: element.scrollLeft,
        right: rect.right,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      };
    });

    expect(
      metrics.scrollWidth,
      "preview table should be wider than its scroll box",
    ).toBeGreaterThan(metrics.clientWidth);
    expect(metrics.scrollLeft, "preview box should scroll horizontally").toBeGreaterThan(0);
    expect(metrics.right, "preview box stays within viewport width").toBeLessThanOrEqual(
      viewport.width + 1,
    );
    expect(metrics.docScrollWidth, "document must not overflow horizontally").toBeLessThanOrEqual(
      metrics.docClientWidth,
    );
  });
}

test("names Subset fields in plain words, filters by collection year, and updates open table preview between Original and Subset", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openExamplePmo(page);

  await page.getByRole("tab", { name: "Subset" }).click();
  await page.getByRole("radio", { name: "Specimens with certain values" }).click();

  const fieldSelect = page.getByRole("combobox", { name: "Field" });
  await fieldSelect.click();
  const options = page.getByRole("option");
  await expect(options.filter({ hasText: /^Collection year$/ })).toBeVisible();
  await expect(options.filter({ hasText: /^Collection date$/ })).toBeVisible();
  await expect(
    options.filter({ hasText: /collection_date|collection_year|collection_country/ }),
  ).toHaveCount(0);

  // Pick Collection year and choose a single year.
  await options.filter({ hasText: /^Collection year$/ }).click();
  const yearGroup = page.getByRole("group", { name: "Values of Collection year" });
  const firstYear = yearGroup.getByRole("checkbox").first();
  const firstYearText = (await firstYear.locator("xpath=ancestor::div[1]").innerText()).trim();
  const expectedMatch = /(\d+)\s+specimens?/.exec(firstYearText);
  if (expectedMatch === null) throw new Error(`unexpected year text: ${firstYearText}`);
  const expectedCount = Number(expectedMatch[1]);
  expect(expectedCount).toBeGreaterThan(0);
  expect(expectedCount).toBeLessThan(50);

  await firstYear.click();
  await page.getByRole("button", { name: "Make the subset" }).click();
  await expect(page.getByText("The subset is ready")).toBeVisible({ timeout: BUILD_TIMEOUT });

  // Switch to Tables and verify preview follows Subset vs Original.
  await page.getByRole("button", { name: "Download its tables" }).click();
  await expect(page.getByRole("radio", { name: "Subset" })).toBeChecked();

  await page.getByRole("button", { name: "Preview Specimens" }).click();
  const specimensRegion = page.getByRole("region", { name: "Preview of Specimens" });
  await expect(specimensRegion).toBeVisible();
  const shownInSubset = Math.min(20, expectedCount);
  await expect(
    page.getByText(
      `Showing ${shownInSubset} of ${expectedCount} ${expectedCount === 1 ? "row" : "rows"}`,
    ),
  ).toBeVisible();
  await expect(specimensRegion.getByRole("table").getByRole("row")).toHaveCount(shownInSubset + 1);

  await page.getByRole("radio", { name: "Original" }).click();
  await expect(page.getByText("Showing 20 of 50 rows")).toBeVisible();
  await expect(specimensRegion.getByRole("table").getByRole("row")).toHaveCount(21);
});
