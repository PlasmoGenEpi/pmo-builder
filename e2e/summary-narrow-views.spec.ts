/**
 * Narrow-screen layout for the Summary tab's parasite density plot and large
 * (384-well) plates against the production build:
 * - At 390 px the density plot scales to fit the page and hover still names
 *   the right sample.
 * - At 390 px a 384-well plate scrolls inside its own area without making the
 *   page scroll sideways, and hovering a scrolled well keeps its tooltip beside
 *   the well and inside the viewport.
 * - At 1280 px both keep their natural sizes.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT } from "./support/review";

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Shortest Euclidean distance in pixels between two axis-aligned boxes. */
function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

/** Reads a locator's bounding box, failing clearly if it is absent. */
async function requireBox(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${label} bounding box`).not.toBeNull();
  if (box === null) throw new Error(`Missing bounding box for ${label}`);
  return box;
}

/** Asserts that `box` lies completely inside the current viewport. */
function expectInsideViewport(
  box: Box,
  viewport: { readonly width: number; readonly height: number },
): void {
  expect(box.x, "left inside viewport").toBeGreaterThanOrEqual(0);
  expect(box.y, "top inside viewport").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "right inside viewport").toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, "bottom inside viewport").toBeLessThanOrEqual(viewport.height);
}

interface SyntheticSample {
  readonly name: string;
  readonly targets: number;
  readonly density?: number;
  readonly plate?: { readonly row: string; readonly col: number };
}

/** Builds a valid PMO JSON object with configurable densities and/or 384-well plate positions. */
function buildSyntheticPmo(samples: readonly SyntheticSample[]): Record<string, unknown> {
  const targetNames = ["t1", "t2", "t3", "t4"];
  return {
    pmo_header: { pmo_version: "1.1.0" },
    panel_info: [
      {
        panel_name: "p1",
        reactions: [{ reaction_name: "pool1", panel_targets: [0, 1, 2, 3] }],
      },
    ],
    target_info: targetNames.map((target_name) => ({
      target_name,
      forward_primer: { seq: "ACGT" },
      reverse_primer: { seq: "TGCA" },
    })),
    specimen_info: samples.map((sample) => ({
      specimen_name: `spec_${sample.name}`,
      collection_country: "Mozambique",
      collection_date: "2024-01",
      ...(sample.density === undefined
        ? {}
        : {
            parasite_density_info: [
              { parasite_density: sample.density, parasite_density_method: "qPCR" },
            ],
          }),
    })),
    library_sample_info: samples.map((sample, index) => ({
      library_sample_name: sample.name,
      specimen_id: index,
      panel_id: 0,
      ...(sample.plate === undefined
        ? {}
        : {
            library_prep_plate_info: {
              plate_name: "Plate 384",
              plate_row: sample.plate.row,
              plate_col: sample.plate.col,
            },
          }),
    })),
    bioinformatics_methods_info: [{ methods: [{ program: "x", program_version: "1" }] }],
    bioinformatics_run_info: [{ bioinformatics_run_name: "runA", bioinformatics_methods_id: 0 }],
    representative_microhaplotypes: {
      targets: targetNames.map((_, targetId) => ({
        target_id: targetId,
        microhaplotypes: [{ seq: "AAAA" }],
      })),
    },
    detected_microhaplotypes: [
      {
        bioinformatics_run_id: 0,
        library_samples: samples.map((sample, index) => ({
          library_sample_id: index,
          target_results: Array.from({ length: sample.targets }, (_, targetId) => ({
            mhaps_target_id: targetId,
            mhaps: [{ mhap_id: 0, reads: 50 }],
          })),
        })),
      },
    ],
  };
}

const DENSITY_SAMPLES: readonly SyntheticSample[] = [
  { name: "dens_low", targets: 1, density: 10 },
  { name: "dens_mid_low", targets: 2, density: 100 },
  { name: "dens_mid_high", targets: 3, density: 1000 },
  { name: "dens_high", targets: 4, density: 10000 },
];

const PLATE_384_SAMPLES: readonly SyntheticSample[] = [
  { name: "well_a1", targets: 4, plate: { row: "A", col: 1 } },
  { name: "well_a24", targets: 3, plate: { row: "A", col: 24 } },
  { name: "well_h12", targets: 2, plate: { row: "H", col: 12 } },
  { name: "well_p1", targets: 1, plate: { row: "P", col: 1 } },
  { name: "well_p24", targets: 4, plate: { row: "P", col: 24 } },
];

const BOTH_SAMPLES: readonly SyntheticSample[] = [
  { name: "both_a1", targets: 1, density: 10, plate: { row: "A", col: 1 } },
  { name: "both_a24", targets: 2, density: 100, plate: { row: "A", col: 24 } },
  { name: "both_h12", targets: 3, density: 1000, plate: { row: "H", col: 12 } },
  { name: "both_p24", targets: 4, density: 10000, plate: { row: "P", col: 24 } },
];

/** Uploads a synthetic PMO JSON and opens the Summary tab. */
async function openSyntheticSummary(
  page: Page,
  fileName: string,
  pmo: Record<string, unknown>,
): Promise<void> {
  await page.goto("/#/pmo");
  await page.getByLabel("Choose pmo file").setInputFiles({
    name: fileName,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pmo)),
  });
  await expect(page.getByText("This file is a valid PMO")).toBeVisible({ timeout: BUILD_TIMEOUT });
  await page.getByRole("tab", { name: "Summary" }).click();
}

test("at 390 px the density plot fits the page and hover names the right sample", async ({
  page,
}) => {
  const viewport = { width: 390, height: 720 };
  await page.setViewportSize(viewport);
  await openSyntheticSummary(page, "density-only.json", buildSyntheticPmo(DENSITY_SAMPLES));

  const densitySection = page.locator("section", {
    has: page.getByRole("heading", { name: "Parasite density and targets with data", exact: true }),
  });
  await expect(densitySection).toBeVisible({ timeout: BUILD_TIMEOUT });

  const svg = densitySection.locator("figure svg");
  await svg.scrollIntoViewIfNeeded();

  const pageOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const svgBox = await requireBox(svg, "density svg");

  expect(svgBox.width, "density svg fits within 390 px viewport").toBeLessThanOrEqual(
    viewport.width,
  );
  expect(svgBox.width, "density svg scales down from natural 560 px width").toBeLessThan(560);
  expect(
    Math.abs(svgBox.width / svgBox.height - 560 / 260),
    "density svg keeps its 560:260 aspect ratio when scaled",
  ).toBeLessThan(0.05);
  expect(svgBox.x + svgBox.width, "density svg right edge inside viewport").toBeLessThanOrEqual(
    viewport.width,
  );
  expect(
    pageOverflow.scrollWidth,
    "page does not scroll sideways with density plot",
  ).toBeLessThanOrEqual(pageOverflow.clientWidth);

  const readout = densitySection.locator("figure p[aria-live='polite']");
  await svg.locator("circle").nth(0).hover();
  await expect(readout).toContainText("dens_low: 10 per µL, 1 targets with data.");

  await svg.locator("circle").nth(3).hover();
  await expect(readout).toContainText("dens_high: 10,000 per µL, 4 targets with data.");
});

test("at 390 px a 384-well plate scrolls inside its own area without page overflow", async ({
  page,
}) => {
  const viewport = { width: 390, height: 720 };
  await page.setViewportSize(viewport);
  await openSyntheticSummary(page, "plate-384.json", buildSyntheticPmo(PLATE_384_SAMPLES));

  const platesSection = page.locator("section", {
    has: page.getByRole("heading", { name: "Plates", exact: true }),
  });
  await expect(platesSection).toBeVisible({ timeout: BUILD_TIMEOUT });

  const figure = platesSection.locator("figure").first();
  const svg = figure.locator("svg");
  await figure.scrollIntoViewIfNeeded();

  const pageOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const figureBox = await requireBox(figure, "plate figure");

  expect(
    pageOverflow.scrollWidth,
    "page does not scroll sideways with 384-well plate",
  ).toBeLessThanOrEqual(pageOverflow.clientWidth);
  expect(figureBox.x + figureBox.width, "plate figure fits inside viewport").toBeLessThanOrEqual(
    viewport.width,
  );

  // The plate SVG's parent scroll box is narrower than the 650 px plate and scrolls horizontally.
  const scroller = svg.locator("..");
  const scrollMetrics = await scroller.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  expect(scrollMetrics.scrollWidth, "384-well plate content wider than box").toBeGreaterThan(
    scrollMetrics.clientWidth,
  );
  expect(["auto", "scroll"]).toContain(scrollMetrics.overflowX);

  // The plate scroll box can be focused and scrolled from the keyboard.
  await scroller.focus();
  await expect(scroller).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft), {
      message: "keyboard ArrowRight scrolls the 384-well plate",
    })
    .toBeGreaterThan(0);

  // Scroll the plate container to reveal column 24, then hover well P24 and check its tooltip.
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const wellP24 = svg.locator("rect").nth(15 * 24 + 23);
  await wellP24.scrollIntoViewIfNeeded();
  await wellP24.hover();

  const tooltip = platesSection.getByText("well_p24", { exact: true }).locator("..");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("4 targets with data");

  const wellBox = await requireBox(wellP24, "well P24");
  const tooltipBox = await requireBox(tooltip, "tooltip for P24");
  expectInsideViewport(tooltipBox, viewport);
  expect(
    boxDistance(wellBox, tooltipBox),
    "distance between scrolled well P24 and tooltip",
  ).toBeLessThanOrEqual(24);
});

test("at 1280 px the density plot and 384-well plate keep their natural sizes", async ({
  page,
}) => {
  const viewport = { width: 1280, height: 800 };
  await page.setViewportSize(viewport);
  await openSyntheticSummary(page, "density-and-384.json", buildSyntheticPmo(BOTH_SAMPLES));

  const platesSection = page.locator("section", {
    has: page.getByRole("heading", { name: "Plates", exact: true }),
  });
  const densitySection = page.locator("section", {
    has: page.getByRole("heading", { name: "Parasite density and targets with data", exact: true }),
  });
  await expect(platesSection).toBeVisible({ timeout: BUILD_TIMEOUT });
  await expect(densitySection).toBeVisible({ timeout: BUILD_TIMEOUT });

  const plateSvg = platesSection.locator("figure svg").first();
  const plateBox = await requireBox(plateSvg, "384-well plate svg at 1280");
  // 24 columns + 1 label column = 25 * 26 = 650 px; 16 rows + 1 label row = 17 * 26 = 442 px.
  expect(Math.round(plateBox.width)).toBe(650);
  expect(Math.round(plateBox.height)).toBe(442);

  const plateScroller = plateSvg.locator("..");
  const plateScroll = await plateScroller.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(plateScroll.scrollWidth).toBeLessThanOrEqual(plateScroll.clientWidth);

  const densitySvg = densitySection.locator("figure svg");
  const densityBox = await requireBox(densitySvg, "density svg at 1280");
  expect(Math.round(densityBox.width)).toBe(560);
  expect(Math.round(densityBox.height)).toBe(260);

  await densitySvg.scrollIntoViewIfNeeded();
  await densitySvg.locator("circle").nth(3).hover();
  await expect(densitySection.locator("figure p[aria-live='polite']")).toContainText(
    "both_p24: 10,000 per µL, 4 targets with data.",
  );
});
