/**
 * Microhaplotype bars on the Summary tab against the production build: each
 * bar's length matches its share of the target's detections, the largest share
 * fills its track with nothing clamping it, and the layout holds at phone,
 * tablet and laptop widths in English and French.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { openBuiltExample, requireBox, type Box } from "./support/pmoFile";
import { BUILD_TIMEOUT } from "./support/review";

interface MeasuredRow {
  readonly share: number;
  readonly labelBox: Box;
  readonly trackBox: Box;
  readonly barBox: Box;
}

/** Opens the example PMO on the Summary tab in English or French. */
async function openExampleSummary(page: Page, language: "en" | "fr"): Promise<void> {
  await openBuiltExample({ page, lang: language, tab: "summary" });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: BUILD_TIMEOUT });
}

/** Reads each rendered microhaplotype row's share percentage and measured boxes. */
async function measureAlleleRows(figure: Locator): Promise<readonly MeasuredRow[]> {
  const items = figure.getByRole("listitem");
  await expect(items.first()).toBeVisible({ timeout: BUILD_TIMEOUT });
  const count = await items.count();
  expect(count, "at least two microhaplotypes shown").toBeGreaterThanOrEqual(2);

  return Promise.all(
    Array.from({ length: count }, async (_, index): Promise<MeasuredRow> => {
      const item = items.nth(index);
      const text = await item.innerText();
      const match = /(\d+(?:[.,]\d+)?)\s*%/.exec(text);
      if (match === null || match[1] === undefined) {
        throw new Error(`Could not read percentage from row ${index}: ${text}`);
      }
      const share = Number(match[1].replace(",", "."));
      const label = item.locator("[title]").first();
      const bar = item.locator('[aria-hidden="true"]').first();
      const track = bar.locator("..");
      const [labelBox, trackBox, barBox] = await Promise.all([
        requireBox(label, `row ${index} label`),
        requireBox(track, `row ${index} track`),
        requireBox(bar, `row ${index} bar`),
      ]);
      return { share, labelBox, trackBox, barBox };
    }),
  );
}

/** Asserts that every bar is visible, fills its track at the top share, and stays to scale. */
function expectBarsToScale(rows: readonly MeasuredRow[]): void {
  const first = rows[0];
  const second = rows[1];
  if (first === undefined || second === undefined) {
    throw new Error("Expected at least two microhaplotype rows");
  }
  // Example data, target seen in the most samples: 35.1% (26) and 17.6% (13).
  expect(first.share, "largest share in the example data").toBeCloseTo(35.1, 1);
  expect(second.share, "second share in the example data").toBeCloseTo(17.6, 1);

  expect(first.barBox.width, "largest bar is clearly visible").toBeGreaterThan(40);
  expect(first.barBox.height, "largest bar has height").toBeGreaterThan(0);

  for (const [index, row] of rows.entries()) {
    const expectedWidth = first.barBox.width * (row.share / first.share);
    expect(
      Math.abs(row.barBox.width - expectedWidth),
      `row ${index} (${row.share}%) bar length ${row.barBox.width.toFixed(1)}px matches expected ${expectedWidth.toFixed(1)}px`,
    ).toBeLessThanOrEqual(2);
  }

  // The largest share fills the full bar track, and every row uses the same track width.
  expect(
    Math.abs(first.barBox.width - first.trackBox.width),
    "largest bar fills its track",
  ).toBeLessThanOrEqual(1);
  for (const [index, row] of rows.entries()) {
    expect(
      Math.abs(row.trackBox.width - first.trackBox.width),
      `row ${index} shares the same track width`,
    ).toBeLessThanOrEqual(1);
  }
}

/** Asserts that each row's label sits beside its track without overlapping and vertically aligned. */
function expectLabelsBesideBars(rows: readonly MeasuredRow[]): void {
  for (const [index, row] of rows.entries()) {
    expect(
      row.labelBox.x + row.labelBox.width,
      `row ${index} label stays left of its bar track`,
    ).toBeLessThanOrEqual(row.trackBox.x);
    const labelCenterY = row.labelBox.y + row.labelBox.height / 2;
    const trackCenterY = row.trackBox.y + row.trackBox.height / 2;
    expect(
      Math.abs(labelCenterY - trackCenterY),
      `row ${index} label aligns vertically with its bar track`,
    ).toBeLessThanOrEqual(Math.max(row.labelBox.height, row.trackBox.height) / 2);
  }
}

test("draws microhaplotype bars to scale at 1280 px in English", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openExampleSummary(page, "en");

  const figure = page.getByRole("figure", { name: /^Microhaplotypes at / });
  await expect(figure).toBeVisible();
  const rows = await measureAlleleRows(figure);
  expectBarsToScale(rows);
  expectLabelsBesideBars(rows);
});

test("draws microhaplotype bars to scale at 768 px in English", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await openExampleSummary(page, "en");

  const figure = page.getByRole("figure", { name: /^Microhaplotypes at / });
  await expect(figure).toBeVisible();
  const rows = await measureAlleleRows(figure);
  expectBarsToScale(rows);
  expectLabelsBesideBars(rows);
});

test("keeps microhaplotype bars visible and to scale with labels above at 390 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openExampleSummary(page, "en");

  const figure = page.getByRole("figure", { name: /^Microhaplotypes at / });
  await expect(figure).toBeVisible();
  const rows = await measureAlleleRows(figure);
  expectBarsToScale(rows);

  const figureBox = await requireBox(figure, "allele figure");
  expect(
    figureBox.x + figureBox.width,
    "figure fits inside the 390 px viewport",
  ).toBeLessThanOrEqual(391);

  for (const [index, row] of rows.entries()) {
    expect(
      row.labelBox.y + row.labelBox.height,
      `row ${index} label sits above its bar at 390 px`,
    ).toBeLessThanOrEqual(row.barBox.y);
  }
});

test("draws microhaplotype bars to scale at 1280 px in French", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openExampleSummary(page, "fr");

  const figure = page.getByRole("figure", { name: /^Microhaplotypes de / });
  await expect(figure).toBeVisible();
  await expect(figure).toContainText("échantillons");
  const rows = await measureAlleleRows(figure);
  expectBarsToScale(rows);
  expectLabelsBesideBars(rows);
});
