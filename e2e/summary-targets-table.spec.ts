/**
 * Targets table layout on the Summary tab against the production build:
 * at 1280 px all four columns fit without sideways scrolling in English and
 * French, the microhaplotype card stays readable beside the table, and the
 * two stack below the large breakpoint.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT, loadExample } from "./support/review";

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ScrollMetrics {
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

interface TargetsLayout {
  readonly section: Locator;
  readonly tableRegion: Locator;
  readonly alleleFigure: Locator;
}

async function requireBox(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${label} bounding box`).not.toBeNull();
  if (box === null) throw new Error(`Missing bounding box for ${label}`);
  return box;
}

async function scrollMetrics(locator: Locator): Promise<ScrollMetrics> {
  return locator.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
}

async function openEnglishSummaryTargets(page: Page): Promise<TargetsLayout> {
  await loadExample(page);
  await page.evaluate(() => {
    globalThis.location.hash = "/pmo/open-built";
  });
  await expect(page.getByText("This is the PMO built from your draft")).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  await page.getByRole("tab", { name: "Summary" }).click();
  const tableRegion = page.getByRole("region", { name: "Targets" });
  await expect(tableRegion).toBeVisible({ timeout: BUILD_TIMEOUT });
  const section = page.locator("section", {
    has: page.getByRole("heading", { name: "Targets", exact: true }),
  });
  const alleleFigure = section.locator("figure");
  await expect(alleleFigure).toBeVisible();
  return { section, tableRegion, alleleFigure };
}

async function openFrenchSummaryTargets(page: Page): Promise<TargetsLayout> {
  await page.goto("/?lang=fr");
  await page.getByRole("button", { name: "Essayer avec des données d’exemple" }).click();
  await expect(page).toHaveURL(/#\/build\/microhaplotypes$/, { timeout: BUILD_TIMEOUT });
  await expect(page.getByRole("region", { name: "Résultat" }).getByText(/^Prête?$/)).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  await page.evaluate(() => {
    globalThis.location.hash = "/pmo/open-built";
  });
  await expect(page.getByText("Voici le PMO créé à partir de votre brouillon")).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  await page.getByRole("tab", { name: "Résumé" }).click();
  const tableRegion = page.getByRole("region", { name: "Cibles" });
  await expect(tableRegion).toBeVisible({ timeout: BUILD_TIMEOUT });
  const section = page.locator("section", {
    has: page.getByRole("heading", { name: "Cibles", exact: true }),
  });
  const alleleFigure = section.locator("figure");
  await expect(alleleFigure).toBeVisible();
  return { section, tableRegion, alleleFigure };
}

async function expectAllColumnsFitWithoutHorizontalScroll(options: {
  readonly tableRegion: Locator;
  readonly expectedColumns: readonly string[];
}): Promise<void> {
  const { tableRegion, expectedColumns } = options;
  await tableRegion.scrollIntoViewIfNeeded();

  const metrics = await scrollMetrics(tableRegion);
  expect(
    metrics.scrollWidth,
    `Targets table scrollWidth (${metrics.scrollWidth}) should fit clientWidth (${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth);

  const regionBox = await requireBox(tableRegion, "Targets scroll region");
  const firstBodyRow = tableRegion.locator("tbody tr").first();
  const firstBodyRowBox = await requireBox(firstBodyRow, "first target row");

  await Promise.all(
    expectedColumns.map(async (name) => {
      const header = tableRegion.getByRole("columnheader", { name });
      await expect(header).toBeVisible();
      const sortButton = header.getByRole("button");
      const [headerBox, buttonHeight, buttonBox] = await Promise.all([
        requireBox(header, `column "${name}"`),
        sortButton.evaluate((element) => ({
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        })),
        requireBox(sortButton, `column "${name}" button`),
      ]);
      expect(headerBox.x, `column "${name}" left inside table box`).toBeGreaterThanOrEqual(
        regionBox.x - 1,
      );
      expect(
        headerBox.x + headerBox.width,
        `column "${name}" right inside table box`,
      ).toBeLessThanOrEqual(regionBox.x + regionBox.width + 1);
      expect(
        buttonHeight.scrollHeight,
        `column "${name}" button scrollHeight (${buttonHeight.scrollHeight}) should fit clientHeight (${buttonHeight.clientHeight})`,
      ).toBeLessThanOrEqual(buttonHeight.clientHeight + 1);
      expect(
        buttonBox.y + buttonBox.height,
        `column "${name}" button stays above the first data row`,
      ).toBeLessThanOrEqual(firstBodyRowBox.y + 1);
    }),
  );

  const firstTargetButton = firstBodyRow.getByRole("button").first();
  const targetButtonHeight = await firstTargetButton.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(
    targetButtonHeight.scrollHeight,
    `first target button scrollHeight (${targetButtonHeight.scrollHeight}) should fit clientHeight (${targetButtonHeight.clientHeight})`,
  ).toBeLessThanOrEqual(targetButtonHeight.clientHeight + 1);
}

async function expectAlleleCardReadableBeside(options: {
  readonly tableRegion: Locator;
  readonly alleleFigure: Locator;
}): Promise<void> {
  const { tableRegion, alleleFigure } = options;
  const tableBox = await requireBox(tableRegion, "Targets table");
  const figureBox = await requireBox(alleleFigure, "Microhaplotypes card");

  // Side by side at 1280 px: the microhaplotype card starts to the right of the table.
  expect(figureBox.x, "microhaplotype card sits to the right of Targets table").toBeGreaterThan(
    tableBox.x + tableBox.width,
  );
  // Stays wide enough to read labels, bars and values comfortably.
  expect(figureBox.width, "microhaplotype card width stays readable").toBeGreaterThanOrEqual(400);

  const figureMetrics = await scrollMetrics(alleleFigure);
  expect(
    figureMetrics.scrollWidth,
    "microhaplotype card does not overflow horizontally",
  ).toBeLessThanOrEqual(figureMetrics.clientWidth);
}

test("at 1280 px in English the Targets table fits without sideways scrolling, sits beside a readable microhaplotype card, and stacks below lg", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const { tableRegion, alleleFigure } = await openEnglishSummaryTargets(page);

  await expectAllColumnsFitWithoutHorizontalScroll({
    tableRegion,
    expectedColumns: ["Target", "Samples with data", "Alleles", "Heterozygosity"],
  });
  await expectAlleleCardReadableBeside({ tableRegion, alleleFigure });

  // Below the large breakpoint (1024 px), the table and microhaplotype card stack vertically.
  await page.setViewportSize({ width: 900, height: 900 });
  const stackedTableBox = await requireBox(tableRegion, "Targets table below lg");
  const stackedFigureBox = await requireBox(alleleFigure, "Microhaplotypes card below lg");
  expect(
    stackedFigureBox.y,
    "microhaplotype card stacks below Targets table under lg",
  ).toBeGreaterThanOrEqual(stackedTableBox.y + stackedTableBox.height);
});

test("at 1280 px in French the Targets table fits without sideways scrolling beside a readable microhaplotype card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const { tableRegion, alleleFigure } = await openFrenchSummaryTargets(page);

  await expectAllColumnsFitWithoutHorizontalScroll({
    tableRegion,
    expectedColumns: ["Cible", "Échantillons avec des données", "Allèles", "Hétérozygotie"],
  });
  await expectAlleleCardReadableBeside({ tableRegion, alleleFigure });
});
